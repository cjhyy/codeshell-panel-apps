import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { CaptionBrowser, findCaptionBrowser } from "./media-caption-renderer.js";
import { validateEditorDocument, sequenceDuration } from "../../src/editor/validation.js";
import { validateExportProfile, type ExportProfile } from "../../src/editor/export-settings.js";
import { assertTick, type Tick } from "../../src/editor/time.js";
import type { EditorDocument } from "../../src/editor/types.js";

export interface RenderMediaFile {
  /** Immutable, already-authorized task materialization; never a browser-supplied path. */
  path: string;
  mimeType: string;
}
export interface EditorFrameRendererOptions {
  document: EditorDocument;
  sequenceId: string;
  profile: ExportProfile;
  mediaFiles: ReadonlyMap<string, RenderMediaFile>;
  /** Build-time embedded panel-browser source; must not come from task JSON. */
  runtimeSource: string;
  workDir: string;
  signal: AbortSignal;
  browserPath?: string;
  timeoutMs?: number;
}
type Upload = { id: number; bytes?: Buffer; receiving: boolean };
const MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const abortError = () => new DOMException("画面渲染已取消", "AbortError");

/** One sequential frame session. It does not use or automate the user's browser. */
export class EditorFrameRenderer {
  private document: EditorDocument;
  private profile: ExportProfile;
  private duration: Tick;
  private server?: Server;
  private browser?: CaptionBrowser;
  private browserProfile = "";
  private sessionId = "";
  private origin = "";
  private base = `/${randomBytes(24).toString("hex")}`;
  private files = new Map<string, RenderMediaFile>();
  private requestId = 0;
  private upload?: Upload;
  private closed = false;
  private closing?: Promise<void>;
  private busy = false;
  private onAbort = () => {
    void this.close();
  };
  private constructor(private readonly options: EditorFrameRendererOptions) {
    this.document = validateEditorDocument(options.document);
    this.profile = validateExportProfile(options.profile);
    const sequence = this.document.sequences.find((item) => item.id === options.sequenceId);
    if (!sequence) throw new Error("渲染序列不存在");
    this.duration = sequenceDuration(sequence);
    if (!this.duration) throw new Error("空序列没有可导出的画面");
    if (!isAbsolute(options.workDir)) throw new Error("渲染工作目录无效");
    if (
      typeof options.runtimeSource !== "string" ||
      !options.runtimeSource ||
      options.runtimeSource.length > 4 * 1024 * 1024
    )
      throw new Error("渲染运行代码无效");
    if (
      options.timeoutMs !== undefined &&
      (!Number.isInteger(options.timeoutMs) ||
        options.timeoutMs < 100 ||
        options.timeoutMs > 300000)
    )
      throw new Error("渲染超时设置无效");
  }
  static async create(options: EditorFrameRendererOptions): Promise<EditorFrameRenderer> {
    const renderer = new EditorFrameRenderer(options);
    try {
      await renderer.bounded(() => renderer.initialize());
      return renderer;
    } catch (error) {
      await renderer.close();
      if (options.signal.aborted) throw abortError();
      throw error;
    }
  }
  private async initialize(): Promise<void> {
    if (this.options.signal.aborted) throw abortError();
    this.options.signal.addEventListener("abort", this.onAbort, { once: true });
    const urls: Record<string, string> = Object.create(null);
    let fileIndex = 0;
    for (const [assetId, file] of this.options.mediaFiles) {
      if (!this.document.assets.some((asset) => asset.id === assetId))
        throw new Error("渲染文件包含未知素材");
      if (!isAbsolute(file.path) || !MIME_TYPES.has(file.mimeType))
        throw new Error(`渲染素材类型或路径无效：${assetId}`);
      const info = await stat(file.path);
      if (!info.isFile() || info.size <= 0) throw new Error(`渲染素材不可读取：${assetId}`);
      const route = `${this.base}/media/${fileIndex++}`;
      this.files.set(route, { ...file });
      urls[assetId] = route;
      if (this.closed) throw abortError();
    }
    this.server = createServer((request, response) => {
      void this.serve(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    this.server.requestTimeout = 30000;
    this.server.headersTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => {
        this.server!.removeListener("error", reject);
        resolve();
      });
    });
    if (this.closed) {
      this.server.closeAllConnections();
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      throw abortError();
    }
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("无法准备画面渲染媒体服务");
    this.origin = `http://127.0.0.1:${address.port}`;
    const executable = this.options.browserPath ?? (await findCaptionBrowser());
    if (this.closed) throw abortError();
    if (!executable) throw new Error("视频渲染需要已安装的 Chrome、Chromium 或 Edge 浏览器");
    await mkdir(this.options.workDir, { recursive: true });
    if (this.closed) throw abortError();
    this.browserProfile = await mkdtemp(join(this.options.workDir, "editor-browser-"));
    if (this.closed) {
      await rm(this.browserProfile, { recursive: true, force: true });
      throw abortError();
    }
    this.browser = new CaptionBrowser(executable, this.browserProfile);
    const target = await this.browser.call("Target.createTarget", { url: "about:blank" });
    const session = await this.browser.call("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    this.sessionId = session.sessionId;
    await this.browser.call("Page.enable", {}, this.sessionId);
    await this.browser.call(
      "Page.navigate",
      { url: `${this.origin}${this.base}/` },
      this.sessionId,
    );
    for (;;) {
      const response = await this.browser.call(
        "Runtime.evaluate",
        {
          expression: `location.href === ${JSON.stringify(`${this.origin}${this.base}/`)} && document.readyState === 'complete'`,
          returnByValue: true,
        },
        this.sessionId,
      );
      if (response.result?.value === true) break;
      if (this.closed) throw abortError();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await this.evaluate(this.options.runtimeSource);
    for (const key of Object.keys(urls)) urls[key] = `${this.origin}${urls[key]}`;
    const args = [
      this.document,
      this.options.sequenceId,
      this.profile,
      urls,
      `${this.origin}${this.base}/frame`,
    ];
    await this.evaluate(`globalThis.videoStudioRender.initialize(...${JSON.stringify(args)})`);
  }
  private async evaluate(expression: string): Promise<void> {
    if (this.closed || !this.browser) throw abortError();
    const response = await this.browser.call(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      this.sessionId,
    );
    if (response.exceptionDetails) {
      // Surface the domain failure, not the CDP stack or local filesystem paths.
      const raw = response.exceptionDetails.exception?.description ?? "画面合成失败";
      const firstLine = String(raw).split("\n", 1)[0]!.slice(0, 500);
      throw new Error(`画面合成失败：${firstLine}`);
    }
  }
  private async bounded<T>(operation: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            void this.close();
            reject(new Error("画面渲染超时"));
          }, this.options.timeoutMs ?? 30000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async render(time: Tick): Promise<Buffer> {
    assertTick(time);
    if (time >= this.duration) throw new Error("渲染时间超出序列范围");
    if (this.closed || this.options.signal.aborted) throw abortError();
    if (this.busy) throw new Error("请等待上一画面绘制完成");
    this.busy = true;
    const current: Upload = { id: this.requestId++, receiving: false };
    this.upload = current;
    try {
      await this.bounded(() =>
        this.evaluate(`globalThis.videoStudioRender.render(${time}, ${current.id})`),
      );
      if (this.options.signal.aborted) throw abortError();
      if (!current.bytes) throw new Error("渲染器未返回画面");
      return current.bytes;
    } catch (error) {
      await this.close();
      if (this.options.signal.aborted) throw abortError();
      throw error;
    } finally {
      this.upload = undefined;
      this.busy = false;
    }
  }
  private async serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const deny = (code = 404) => {
      response.writeHead(code);
      response.end();
    };
    if (
      this.closed ||
      request.headers.host !== this.origin.slice(7) ||
      (request.headers.origin && request.headers.origin !== this.origin)
    )
      return deny(403);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const route = request.url ?? "";
    if (route === `${this.base}/` && request.method === "GET") {
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; img-src 'self'; media-src 'self'; connect-src 'self'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><meta charset=utf-8><title>Video Studio renderer</title>");
      return;
    }
    const current = this.upload;
    if (current && route === `${this.base}/frame/${current.id}` && request.method === "POST") {
      if (current.receiving || current.bytes || request.headers["content-type"] !== "image/png")
        return deny(409);
      current.receiving = true;
      const maxBytes = this.profile.width * this.profile.height * 5 + 1024 * 1024;
      if (Number(request.headers["content-length"]) > maxBytes) return deny(413);
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > maxBytes || this.closed) {
          request.destroy();
          return;
        }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks, length);
      if (
        bytes.length < 24 ||
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.readUInt32BE(16) !== this.profile.width ||
        bytes.readUInt32BE(20) !== this.profile.height
      )
        return deny(422);
      current.bytes = bytes;
      response.writeHead(204);
      response.end();
      return;
    }
    const file = this.files.get(route);
    if (!file || !["GET", "HEAD"].includes(request.method ?? "")) return deny();
    const info = await stat(file.path);
    if (!info.isFile()) return deny();
    let start = 0,
      end = info.size - 1,
      partial = false;
    if (request.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!match || (!match[1] && !match[2])) return deny(416);
      start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= info.size
      )
        return deny(416);
      partial = true;
    }
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Length", end - start + 1);
    if (partial) response.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
    response.writeHead(partial ? 206 : 200);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const stream = createReadStream(file.path, { start, end });
    response.once("close", () => stream.destroy());
    stream.once("error", () => response.destroy());
    stream.pipe(response);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.options.signal.removeEventListener("abort", this.onAbort);
    this.closing = (async () => {
      await this.browser?.close();
      if (this.server?.listening) {
        this.server.closeAllConnections();
        await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      }
      if (this.browserProfile) await rm(this.browserProfile, { recursive: true, force: true });
      this.files.clear();
      this.upload = undefined;
    })();
    return this.closing;
  }
}
