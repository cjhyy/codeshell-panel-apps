import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { CaptionImageRequest } from "./media-processors.js";
import type { MediaJobContext } from "./media-types.js";
import { mediaAbortError } from "./media-process-runner.js";
export function validateCaptionImageRequest(request: CaptionImageRequest): void {
  if (
    !request ||
    typeof request !== "object" ||
    Object.keys(request).some(
      (key) => !["width", "height", "fontSize", "texts", "style"].includes(key),
    )
  )
    throw new Error("Invalid caption image request");
  if (request.style !== undefined && !["classic", "bold", "minimal"].includes(request.style))
    throw new Error("Unsupported caption style");
  if (
    ![request.width, request.height].every(
      (value) => Number.isSafeInteger(value) && value >= 16 && value <= 8192,
    ) ||
    !Number.isSafeInteger(request.fontSize) ||
    request.fontSize < 1 ||
    request.fontSize > 512 ||
    !Array.isArray(request.texts) ||
    request.texts.length > 10000 ||
    request.texts.some((text) => typeof text !== "string" || text.length > 4000)
  )
    throw new Error("Invalid caption image dimensions or text");
}

// Kept consistent with Video Studio's canvas compositor so downloaded MP4s
// have the same Unicode shaping, wrapping, four-line cap and background box.
export function drawCaptionPng(request: CaptionImageRequest): string {
  const canvas = document.createElement("canvas");
  canvas.width = request.width;
  canvas.height = request.height;
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h, fontSize } = request;
  const style = request.style ?? "classic";
  if (!["classic", "bold", "minimal"].includes(style)) throw new Error("Unsupported caption style");
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.font = `${style === "bold" ? 800 : style === "minimal" ? 500 : 600} ${fontSize}px system-ui`;
  ctx.textAlign = "center";
  const lines: string[] = [];
  outer: for (const text of request.texts) {
    let line = "";
    for (const char of text) {
      if (char === "\n" || (line && ctx.measureText(line + char).width > w * 0.85)) {
        lines.push(line);
        if (lines.length === 4) break outer;
        line = char === "\n" ? "" : char;
      } else line += char;
    }
    if (line) lines.push(line);
    if (lines.length === 4) break;
  }
  const visible = lines.slice(0, 4),
    lineHeight = fontSize * 1.4;
  if (visible.length) {
    const y = h * 0.9 - visible.length * lineHeight;
    if (style === "classic") {
      const boxWidth = Math.min(
        w * 0.93,
        Math.max(...visible.map((line) => ctx.measureText(line).width)) + fontSize,
      );
      ctx.fillStyle = "#050909b8";
      ctx.beginPath();
      ctx.roundRect(
        (w - boxWidth) / 2,
        y,
        boxWidth,
        visible.length * lineHeight + fontSize * 0.5,
        8,
      );
      ctx.fill();
    } else if (style === "minimal") {
      ctx.shadowColor = "#000b";
      ctx.shadowBlur = Math.max(2, fontSize * 0.08);
      ctx.shadowOffsetY = Math.max(1, fontSize * 0.04);
    }
    ctx.fillStyle = style === "bold" ? "#ffe46b" : "#fff";
    if (style === "bold") {
      ctx.strokeStyle = "#101010";
      ctx.lineWidth = Math.max(2, fontSize * 0.12);
      ctx.lineJoin = "round";
    }
    visible.forEach((line, i) => {
      const baseline = y + lineHeight * (i + 1) - fontSize * 0.1;
      if (style === "bold") ctx.strokeText(line, w / 2, baseline);
      ctx.fillText(line, w / 2, baseline);
    });
  }
  ctx.restore();
  return canvas.toDataURL("image/png");
}

export async function findCaptionBrowser(): Promise<string | undefined> {
  const names =
    process.platform === "win32"
      ? ["chrome.exe", "msedge.exe"]
      : ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"];
  const candidates = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((path) => names.map((name) => join(path, name)));
  if (process.platform === "darwin")
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    );
  for (const root of [
    join(homedir(), "Library/Caches/ms-playwright"),
    join(homedir(), ".cache/ms-playwright"),
  ]) {
    for (const name of await readdir(root).catch(() => [])) {
      if (!/^chromium[-_]/.test(name)) continue;
      for (const binary of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux/chrome",
        "chrome-linux64/chrome",
        "chrome-win/chrome.exe",
      ])
        candidates.push(join(root, name, binary));
    }
  }
  for (const path of candidates)
    if (
      await access(path, constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return path;
  return undefined;
}

type Pending = { resolve(value: any): void; reject(error: Error): void };
class CaptionBrowser {
  private child: ChildProcess;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private buffer = Buffer.alloc(0);
  private closed = false;
  private closingStarted = false;
  private closing?: Promise<void>;
  private exited: Promise<void>;
  constructor(executable: string, profile: string) {
    this.child = spawn(
      executable,
      [
        "--headless=new",
        "--remote-debugging-pipe",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--disable-extensions",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      {
        detached: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
      },
    );
    this.exited = new Promise((resolve) =>
      this.child.once("close", () => {
        this.fail(new Error("字幕绘制进程已停止"));
        resolve();
      }),
    );
    this.child.once("error", () => this.fail(new Error("无法启动字幕绘制浏览器")));
    for (const pipe of [this.child.stdio[3]!, this.child.stdio[4]!])
      pipe.on("error", (error: NodeJS.ErrnoException) => {
        if (
          this.closingStarted &&
          ["ECONNRESET", "EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code ?? "")
        )
          return;
        this.fail(new Error("字幕绘制连接已中断"));
        void this.close();
      });
    this.child.stdio[4]!.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > 32 * 1024 * 1024) {
        this.fail(new Error("字幕图像超过大小限制"));
        void this.close();
        return;
      }
      let end: number;
      while ((end = this.buffer.indexOf(0)) >= 0) {
        const part = this.buffer.subarray(0, end);
        this.buffer = this.buffer.subarray(end + 1);
        let message: any;
        try {
          message = JSON.parse(part.toString("utf8"));
        } catch {
          this.fail(new Error("字幕绘制返回无效数据"));
          continue;
        }
        const entry = this.pending.get(message.id);
        if (!entry) continue;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error("字幕绘制命令失败"));
        else entry.resolve(message.result);
      }
    });
  }
  private fail(error: Error) {
    this.closed = true;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
  call(method: string, params: object = {}, sessionId?: string): Promise<any> {
    if (this.closed) return Promise.reject(new Error("字幕绘制进程已停止"));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      (this.child.stdio[3] as import("node:stream").Writable).write(
        JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0",
        (error) => {
          if (error) {
            this.pending.delete(id);
            reject(new Error("无法发送字幕绘制请求"));
          }
        },
      );
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closingStarted = true;
    this.fail(new Error("字幕绘制已取消"));
    this.closing = Promise.resolve().then(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (this.child.exitCode === null && this.child.signalCode === null) {
        this.child.kill("SIGTERM");
        timer = setTimeout(() => this.child.kill("SIGKILL"), 1500);
        timer.unref();
      }
      await this.exited;
      if (timer) clearTimeout(timer);
    });
    return this.closing;
  }
}

/** Independent Chromium, connected over private pipes; no Host renderer or package dependency. */
export class MediaCaptionRenderer {
  private closing = new Map<string, Promise<void>>();
  private browsers = new Map<
    string,
    {
      browser: CaptionBrowser;
      session: Promise<string>;
      profile: string;
      onAbort(): void;
      signal: AbortSignal;
    }
  >();
  constructor(private readonly options: { browserPath?: string; timeoutMs?: number } = {}) {}
  close(jobId: string): Promise<void> {
    const pending = this.closing.get(jobId);
    if (pending) return pending;
    const entry = this.browsers.get(jobId);
    if (!entry) return Promise.resolve();
    this.browsers.delete(jobId);
    entry.signal.removeEventListener("abort", entry.onAbort);
    const operation = (async () => {
      await entry.browser.close();
      await rm(entry.profile, { recursive: true, force: true }).catch(() => {});
    })().finally(() => {
      if (this.closing.get(jobId) === operation) this.closing.delete(jobId);
    });
    this.closing.set(jobId, operation);
    return operation;
  }
  async render(request: CaptionImageRequest, context: MediaJobContext): Promise<string> {
    validateCaptionImageRequest(request);
    await this.closing.get(context.jobId);
    if (context.signal.aborted) throw mediaAbortError();
    let entry = this.browsers.get(context.jobId);
    if (!entry) {
      const executable = this.options.browserPath ?? (await findCaptionBrowser());
      if (!executable) throw new Error("字幕渲染需要已安装的 Chrome、Chromium 或 Edge 浏览器");
      const profile = join(context.workDir, "caption-browser");
      await mkdir(profile, { recursive: true, mode: 0o700 });
      const browser = new CaptionBrowser(executable, profile);
      const session = (async () => {
        const target = await browser.call("Target.createTarget", { url: "about:blank" });
        const result = await browser.call("Target.attachToTarget", {
          targetId: target.targetId,
          flatten: true,
        });
        await browser.call("Network.enable", {}, result.sessionId);
        await browser.call("Network.setBlockedURLs", { urls: ["*"] }, result.sessionId);
        return result.sessionId as string;
      })();
      const onAbort = () => {
        void this.close(context.jobId);
      };
      entry = { browser, session, profile, onAbort, signal: context.signal };
      this.browsers.set(context.jobId, entry);
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (context.signal.aborted) onAbort();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const rendered = await Promise.race([
        (async () => {
          const sessionId = await entry!.session;
          const response = await entry!.browser.call(
            "Runtime.evaluate",
            {
              expression: `(async()=>{await document.fonts.ready;return (${drawCaptionPng.toString()})(${JSON.stringify(request)})})()`,
              awaitPromise: true,
              returnByValue: true,
            },
            sessionId,
          );
          if (response.exceptionDetails) throw new Error("字幕绘制失败");
          return response.result?.value;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            void this.close(context.jobId);
            reject(new Error("字幕绘制超时"));
          }, this.options.timeoutMs ?? 30000);
        }),
      ]);
      if (context.signal.aborted) throw mediaAbortError();
      if (typeof rendered !== "string" || !rendered.startsWith("data:image/png;base64,"))
        throw new Error("字幕绘制未返回 PNG");
      const path = join(
        context.workDir,
        `caption-${createHash("sha256").update(JSON.stringify(request)).digest("hex")}.png`,
      );
      const bytes = Buffer.from(rendered.slice("data:image/png;base64,".length), "base64");
      if (
        bytes.length < 24 ||
        bytes.readUInt32BE(16) !== request.width ||
        bytes.readUInt32BE(20) !== request.height
      )
        throw new Error("字幕图像尺寸无效");
      await writeFile(path, bytes, { signal: context.signal, mode: 0o600 });
      return path;
    } catch (error) {
      await this.close(context.jobId);
      if (context.signal.aborted) throw mediaAbortError();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
