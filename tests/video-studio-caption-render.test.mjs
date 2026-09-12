import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { chromium } from "playwright";

const repository = fileURLToPath(new URL("../", import.meta.url));
// Compare the actual shared native canvas implementation without a Host checkout.
const nativeFile = new URL(
  "../apps/video-studio/native/media/media-caption-renderer.ts",
  import.meta.url,
);

// Replace only the subprocess transport to reproduce Linux pipe errors on every
// platform. The production renderer/session/cleanup code remains intact; actual
// Chromium pixels and complete video output have separate tests below and in
// native/media/tests/media-runtime.test.mjs.
async function captionTransportFixture(t, define = {}) {
  const workDir = await mkdtemp(join(tmpdir(), "caption-pipe-test-"));
  t.after(() => rm(workDir, { recursive: true, force: true }));
  const output = join(workDir, "caption.mjs");
  const transport = `
    import { EventEmitter } from "node:events";
    import { Writable, PassThrough } from "node:stream";
    export const children = [];
    export const control = { reply: false, resetOnKill: false, holdClose: false };
    export function spawn() {
      const child = new EventEmitter();
      child.exitCode = null; child.signalCode = null; child.kills = [];
      const output = new PassThrough();
      const input = new Writable({ write(chunk, encoding, done) {
        const message = JSON.parse(chunk.toString().replace(/\\0$/, ""));
        if (control.reply) queueMicrotask(() => {
          let result = {};
          if (message.method === "Target.createTarget") result = { targetId: "page" };
          if (message.method === "Target.attachToTarget") result = { sessionId: "session" };
          if (message.method === "Runtime.evaluate") {
            const png = Buffer.alloc(24);
            png.writeUInt32BE(320, 16); png.writeUInt32BE(180, 20);
            result = { result: { value: "data:image/png;base64," + png.toString("base64") } };
          }
          output.write(JSON.stringify({ id: message.id, result }) + "\\0");
        });
        done();
      }});
      child.stderr = new PassThrough();
      child.stdio = [null, null, child.stderr, input, output];
      child.kill = (signal) => {
        child.kills.push(signal); child.signalCode = signal;
        if (control.resetOnKill) {
          input.emit("error", Object.assign(new Error("private write pipe"), { code: "EPIPE" }));
          output.emit("error", Object.assign(new Error("private read pipe"), { code: "ECONNRESET" }));
        }
        if (!control.holdClose) setImmediate(() => child.emit("close", null, signal));
        return true;
      };
      children.push(child);
      return child;
    }
  `;
  await build({
    stdin: {
      contents: `export { MediaCaptionRenderer, findCaptionBrowser } from ${JSON.stringify(fileURLToPath(nativeFile))};
        export { children, control } from "node:child_process";`,
      resolveDir: repository,
    },
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    define,
    plugins: [
      {
        name: "controlled-caption-pipes",
        setup(builder) {
          builder.onResolve({ filter: /^node:child_process$/ }, () => ({
            path: "transport",
            namespace: "caption-test",
          }));
          builder.onLoad({ filter: /.*/, namespace: "caption-test" }, () => ({
            contents: transport,
            loader: "js",
          }));
        },
      },
    ],
  });
  const api = await import(pathToFileURL(output).href);
  const renderer = new api.MediaCaptionRenderer({
    browserPath: "controlled-browser",
    timeoutMs: 2000,
  });
  const context = { jobId: "caption-job", workDir, signal: new AbortController().signal };
  t.after(() => renderer.close(context.jobId));
  return {
    ...api,
    renderer,
    context,
    request: { width: 320, height: 180, fontSize: 18, texts: ["字幕"] },
  };
}

test("Linux caption discovery prefers packaged Chrome and retains Chromium fallback", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caption-browser-path-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const earlier = join(directory, "snapshot"),
    later = join(directory, "packaged");
  await mkdir(earlier);
  await mkdir(later);
  await writeFile(join(earlier, "chromium"), "fixture", { mode: 0o700 });
  for (const name of ["google-chrome", "google-chrome-stable"])
    await writeFile(join(later, name), "fixture", { mode: 0o700 });
  const fixture = await captionTransportFixture(t, {
    "process.platform": JSON.stringify("linux"),
    "process.env.PATH": JSON.stringify([earlier, later].join(delimiter)),
  });
  assert.equal(await fixture.findCaptionBrowser(), join(later, "google-chrome"));
  await rm(join(later, "google-chrome"));
  assert.equal(await fixture.findCaptionBrowser(), join(later, "google-chrome-stable"));
  await rm(join(later, "google-chrome-stable"));
  assert.equal(await fixture.findCaptionBrowser(), join(earlier, "chromium"));
});

for (const fd of [3, 4])
  test(`caption transport rejects active pipe ${fd} failure and waits for browser cleanup`, async (t) => {
    const fixture = await captionTransportFixture(t);
    const rendering = fixture.renderer.render(fixture.request, fixture.context);
    const rejected = assert.rejects(rendering, (error) => {
      assert.equal(error.message, "字幕绘制连接已中断");
      assert.ok(error.cause.message.includes("controlled browser failure"));
      assert.ok(error.cause.message.length <= 12288);
      assert.equal(error.message.includes("/private/pipe"), false);
      return true;
    });
    const deadline = Date.now() + 2000;
    while (!fixture.children.length && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(fixture.children.length, 1, "the renderer must start its browser transport");
    fixture.children[0].stderr.write("x".repeat(20000) + "controlled browser failure");
    fixture.children[0].stdio[fd].emit(
      "error",
      Object.assign(new Error("/private/pipe"), { code: "ECONNRESET" }),
    );
    await rejected;
    assert.deepEqual(fixture.children[0].kills, ["SIGTERM"]);
    await assert.rejects(access(join(fixture.context.workDir, "caption-browser")), {
      code: "ENOENT",
    });
  });

test("caption shutdown contains expected pipe resets and concurrent close waits for exit", async (t) => {
  const fixture = await captionTransportFixture(t);
  fixture.control.reply = true;
  const png = await fixture.renderer.render(fixture.request, fixture.context);
  await access(png);
  fixture.control.resetOnKill = true;
  fixture.control.holdClose = true;
  const first = fixture.renderer.close(fixture.context.jobId);
  const second = fixture.renderer.close(fixture.context.jobId);
  assert.equal(first, second, "all callers await the same in-flight browser cleanup");
  let settled = false;
  void second.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  await access(join(fixture.context.workDir, "caption-browser"));
  fixture.children[0].emit("close", null, "SIGTERM");
  await first;
  assert.deepEqual(fixture.children[0].kills, ["SIGTERM"]);
  await assert.rejects(access(join(fixture.context.workDir, "caption-browser")), {
    code: "ENOENT",
  });
  await access(png);
});

test("caption sandbox startup failure offers system Chrome guidance without exposing diagnostics", async (t) => {
  const fixture = await captionTransportFixture(t);
  const rendering = fixture.renderer.render(fixture.request, fixture.context);
  const rejected = assert.rejects(rendering, (error) => {
    assert.equal(
      error.message,
      "字幕浏览器的安全环境不可用，请安装或选择可用的系统版 Chrome 后重试",
    );
    assert.equal(error.message.includes("/private/"), false);
    assert.equal(error.message.includes("--no-sandbox"), false);
    return true;
  });
  const deadline = Date.now() + 2000;
  while (!fixture.children.length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(fixture.children.length, 1);
  fixture.children[0].stderr.write("/private/browser: FATAL No usable sandbox! --no-sandbox");
  fixture.children[0].stdio[4].emit(
    "error",
    Object.assign(new Error("reset"), { code: "ECONNRESET" }),
  );
  await rejected;
  assert.deepEqual(fixture.children[0].kills, ["SIGTERM"]);
});

test(
  "three real caption templates match frame compositing and the panel-native PNG renderer",
  { timeout: 20000 },
  async (t) => {
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.route("http://127.0.0.1/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8>" }),
    );
    await page.goto("http://127.0.0.1/caption-test");
    const bundled = await build({
      stdin: {
        resolveDir: repository,
        contents:
          'import * as media from "./apps/video-studio/src/media.ts"; import * as model from "./apps/video-studio/src/model.ts"; window.captionTest={...media,...model};',
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      target: "es2022",
      logLevel: "silent",
    });
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const nativeSource = await readFile(nativeFile, "utf8");
    assert.ok(nativeSource.trim(), "the packaged caption renderer must be present");
    if (nativeSource) {
      const ast = ts.createSourceFile(
        "native-caption.ts",
        nativeSource,
        ts.ScriptTarget.Latest,
        true,
      );
      const names = new Set(["drawCaptionPng", "validateCaptionImageRequest"]);
      const actualFunctions = ast.statements
        .filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
        .map((node) => node.getText(ast).replace(/^export\s+/, ""))
        .join("\n");
      assert.equal(
        ast.statements.filter(
          (node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text),
        ).length,
        2,
      );
      const code = ts.transpileModule(actualFunctions, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      }).outputText;
      await page.addScriptTag({
        content: `${code}\nwindow.nativeCaption={drawCaptionPng,validateCaptionImageRequest};`,
      });
    }
    const result = await page.evaluate(() => {
      const { drawCaptionLayer, renderFrame, createDemoProject, MediaLibrary } = window.captionTest;
      const request = {
        width: 640,
        height: 360,
        fontSize: 18,
        texts: ["同一段字幕，同一种呈现。\nKeep the story moving."],
      };
      const styles = {},
        nativeParity = {},
        frameParity = {};
      const canvas = () => {
        const value = document.createElement("canvas");
        value.width = request.width;
        value.height = request.height;
        return value;
      };
      for (const style of ["classic", "bold", "minimal"]) {
        const layer = canvas(),
          context = layer.getContext("2d");
        drawCaptionLayer(context, { ...request, style });
        const pixels = context.getImageData(0, 0, 640, 360).data;
        let painted = 0,
          yellow = 0,
          white = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3]) painted++;
          if (pixels[i + 3] > 220 && pixels[i] > 220 && pixels[i + 1] > 160 && pixels[i + 2] < 170)
            yellow++;
          if (pixels[i + 3] > 220 && pixels[i] > 220 && pixels[i + 1] > 220 && pixels[i + 2] > 220)
            white++;
        }
        styles[style] = { png: layer.toDataURL(), painted, yellow, white };
        if (window.nativeCaption) {
          window.nativeCaption.validateCaptionImageRequest({ ...request, style });
          nativeParity[style] =
            window.nativeCaption.drawCaptionPng({ ...request, style }) === layer.toDataURL();
        }
        const project = {
          ...createDemoProject(),
          width: 640,
          height: 360,
          captions: [{ id: "one", startFrame: 0, endFrame: 60, text: request.texts[0] }],
          captionStyle: style,
        };
        const frame = canvas(),
          composed = canvas(),
          library = new MediaLibrary();
        renderFrame(frame, project, library, 5);
        renderFrame(composed, { ...project, captions: [] }, library, 5);
        composed.getContext("2d").drawImage(layer, 0, 0);
        const direct = frame.getContext("2d").getImageData(0, 0, 640, 360).data;
        const flattened = composed.getContext("2d").getImageData(0, 0, 640, 360).data;
        let maxDelta = 0;
        for (let i = 0; i < direct.length; i++)
          maxDelta = Math.max(maxDelta, Math.abs(direct[i] - flattened[i]));
        frameParity[style] = maxDelta;
      }
      const legacy = canvas();
      drawCaptionLayer(legacy.getContext("2d"), request);
      const invalid = [];
      if (window.nativeCaption)
        for (const style of ["color:red", "url(https://example.com)", {}, null]) {
          try {
            window.nativeCaption.validateCaptionImageRequest({ ...request, style });
            invalid.push(false);
          } catch {
            invalid.push(true);
          }
        }
      return { styles, nativeParity, frameParity, legacy: legacy.toDataURL(), invalid };
    });
    assert.equal(result.legacy, result.styles.classic.png);
    assert.equal(new Set(Object.values(result.styles).map((style) => style.png)).size, 3);
    assert.ok(result.styles.bold.yellow > 80, "bold must visibly render yellow text");
    assert.equal(result.styles.classic.yellow, 0);
    assert.ok(result.styles.classic.white > 80 && result.styles.minimal.white > 80);
    assert.ok(
      result.styles.classic.painted > result.styles.minimal.painted * 1.5,
      "minimal must remove the caption background box",
    );
    // Alpha flattening can introduce one or two 8-bit rounding levels; position,
    // font, colour and wrapping must otherwise agree over the complete frame.
    for (const [style, delta] of Object.entries(result.frameParity))
      assert.ok(delta <= 3, `${style} compositing pixel delta ${delta}`);
    if (nativeSource) {
      assert.deepEqual(result.nativeParity, { classic: true, bold: true, minimal: true });
      assert.deepEqual(result.invalid, [true, true, true, true]);
    }
  },
);
