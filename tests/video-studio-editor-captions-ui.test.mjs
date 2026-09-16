import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
let browser, bundle, css;
before(async () => {
  const result = await build({
    stdin: {
      contents: `export {EditorCaptionsUI} from './apps/video-studio/src/editor/captions-ui';export {createCaptionController} from './apps/video-studio/src/editor/caption-controller';export {EditorSession} from './apps/video-studio/src/editor/session';export * from './apps/video-studio/src/editor/captions';export * from './apps/video-studio/src/editor/defaults';export {evaluateFrame} from './apps/video-studio/src/editor/evaluate';export {drawEvaluatedFrame} from './apps/video-studio/src/editor/compositor';`,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "editor",
    target: "chrome120",
  });
  bundle = result.outputFiles[0].text;
  css = await readFile(
    new URL("../apps/video-studio/public/editor-captions.css", import.meta.url),
    "utf8",
  );
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});
async function fixture(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: options.width ?? 1120, height: 850 } }),
    errors = [];
  page.setDefaultTimeout(4000);
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
  });
  await page.route("http://127.0.0.1:41999/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh"><body><main id="mount"></main></body></html>',
    }),
  );
  await page.goto("http://127.0.0.1:41999/captions");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(async (options) => {
    const T = 240000;
    globalThis.fail = false;
    globalThis.calls = [];
    globalThis.errors = [];
    globalThis.waitRead = null;
    globalThis.waitTranslate = null;
    globalThis.abortSignal = null;
    globalThis.selection = [];
    globalThis.sought = [];
    const clip = (id, assetId, start) => ({
      id,
      assetId,
      start,
      duration: 4 * T,
      trackId: "audio",
      kind: "media",
      label: id,
      transform: editor.defaultTransform(),
      color: editor.defaultColorAdjustment(),
      blendMode: "normal",
      audio: editor.defaultAudioMix(),
      timeMap: {
        points: [
          { time: 0, source: 0 },
          { time: 4 * T, source: 4 * T },
        ],
      },
    });
    let stored = {
        schemaVersion: 2,
        timebase: T,
        id: "caption-ui",
        name: "字幕界面",
        revision: 0,
        activeSequenceId: "main",
        exportProfiles: [],
        assets: [
          { id: "voice", name: "本人旁白", kind: "audio", duration: 4 * T },
          { id: "other", name: "背景声音", kind: "audio", duration: 4 * T },
        ],
        sequences: [
          {
            id: "main",
            name: "主时间线",
            width: 640,
            height: 360,
            frameRate: { numerator: 30000, denominator: 1001 },
            background: "#000000",
            timelineMode: "free",
            tracks: [editor.createTrack("audio", "audio"), editor.createTrack("text", "text")],
            clips: [clip("voice-clip", "voice", 0), clip("other-clip", "other", 6 * T)],
            transitions: [],
            markers: [],
          },
        ],
      },
      revision = 1;
    globalThis.session = await editor.EditorSession.open(
      {
        read: async () => ({ data: stored, revision }),
        write: async (doc, base) => {
          if (fail) throw new Error("磁盘保存失败");
          if (base !== revision) throw new Error("conflict");
          stored = structuredClone(doc);
          return { revision: ++revision };
        },
        backupLegacy: async () => {},
      },
      { autosaveDelayMs: 60000 },
    );
    globalThis.transcript = [
      {
        start: 1,
        end: 3,
        text: "Hello world",
        words: [
          { start: 1, end: 2, text: "Hello" },
          { start: 2, end: 3, text: " world" },
        ],
      },
    ];
    globalThis.controller = editor.createCaptionController({
      session: () => session,
      apply: (ops, identity, label) => session.dispatchDurable(ops, identity, label, "user"),
      ...(options.disabled
        ? {}
        : {
            prepare: async ({ assetIds }) => {
              calls.push({ kind: "prepare", assetIds });
            },
            transcript: async (request) => {
              calls.push({ kind: "read", assetId: request.assetId, offset: request.offset });
              abortSignal = request.signal;
              if (waitRead) await waitRead;
              return {
                assetId: request.assetId,
                offset: request.offset,
                total: 1,
                segments: transcript,
                revision: "asr-v1",
              };
            },
            translate: async (request) => {
              calls.push({ kind: "translate", items: request.items, language: request.language });
              abortSignal = request.signal;
              if (waitTranslate) await waitTranslate;
              return request.items.map((item) => ({ id: item.id, text: "你好世界" }));
            },
          }),
    });
    globalThis.ui = new editor.EditorCaptionsUI(document.querySelector("#mount"), {
      session: () => session,
      controller,
      select: (sequenceId, ids) => (selection = ids),
      seek: (tick) => sought.push(tick),
      onError: (error) => errors.push(error.message),
    });
    ui.open();
    globalThis.captions = () =>
      session.read().sequences[0].clips.filter((clip) => clip.kind === "text");
    globalThis.seed = async () => {
      await controller.generate({ sequenceId: "main", assetIds: ["voice"] });
      await controller.apply();
    };
  }, options);
  return page;
}
async function generate(page) {
  await page.locator('[data-caption-source="other"]').uncheck();
  await page.getByRole("button", { name: "生成所选声音字幕" }).click();
  await page.locator(".ec-preview").waitFor({ state: "visible" });
}

test("real source checkboxes preview then apply one saved transaction, with one Undo", async (t) => {
  const page = await fixture(t);
  await generate(page);
  assert.equal(await page.evaluate(() => captions().length), 0);
  assert.deepEqual(
    await page.evaluate(() => calls.find((call) => call.kind === "prepare").assetIds),
    ["voice"],
  );
  assert.match(await page.locator(".ec-candidates").innerText(), /Hello world/);
  await page.getByRole("button", { name: "应用预览" }).click();
  await page.waitForFunction(() => captions().length === 1);
  assert.equal(await page.evaluate(() => session.read().revision), 1);
  await page.evaluate(() => session.undo());
  await page.waitForFunction(() => captions().length === 0);
});

test("font and word-highlight controls edit real styles and shared renderer highlights distinct real words", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => seed());
  await page.getByRole("button", { name: "全选字幕" }).click();
  await page.getByLabel("字幕字体", { exact: true }).fill("Arial");
  await page.getByLabel("字幕字号").fill("42");
  await page.getByLabel("字幕动画").selectOption("word-highlight");
  await page.getByRole("button", { name: "应用到所选字幕" }).click();
  await page.waitForFunction(() => captions()[0].style.animation === "word-highlight");
  assert.equal(await page.evaluate(() => captions()[0].style.fontFamily), "Arial");
  const pixels = await page.evaluate(async () => {
    await document.fonts.ready;
    return [360000, 600000].map((time) => {
      const c = document.createElement("canvas");
      editor.drawEvaluatedFrame(c, editor.evaluateFrame(session.read(), "main", time), new Map());
      const bytes = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let total = 0,
        xsum = 0;
      for (let i = 0; i < bytes.length; i += 4)
        if (bytes[i] > 200 && bytes[i + 1] > 150 && bytes[i + 2] < 150) {
          total++;
          xsum += (i / 4) % c.width;
        }
      return { total, x: total ? xsum / total : 0 };
    });
  });
  assert.ok(pixels[0].total > 20 && pixels[1].total > 20);
  assert.ok(pixels[0].x < pixels[1].x);
});

test("translation shows original and bilingual preview before applying, preserves word metadata, and Undo restores original", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => seed());
  await page.getByRole("button", { name: "全选字幕" }).click();
  await page.getByLabel("目标语言").fill("简体中文");
  await page.getByRole("button", { name: "预览翻译" }).click();
  await page.locator(".ec-preview").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => captions()[0].text), "Hello world");
  assert.match(await page.locator(".ec-candidates").innerText(), /你好世界/);
  await page.getByRole("button", { name: "应用预览" }).click();
  await page.waitForFunction(() => captions()[0].translation?.language === "简体中文");
  assert.equal(await page.evaluate(() => captions()[0].text), "Hello world\n你好世界");
  await page.evaluate(() => session.undo());
  await page.waitForFunction(() => !captions()[0].translation);
});

test("SRT file input and real browser download preserve multiline exact millisecond cues", async (t) => {
  const page = await fixture(t, { disabled: true });
  await page.locator("[data-caption-srt-input]").setInputFiles({
    name: "双语.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from("1\n00:00:00,033 --> 00:00:01,067\n你好🙂\nHello\n"),
  });
  await page.locator(".ec-preview").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "应用预览" }).click();
  await page.waitForFunction(() => captions().length === 1);
  await page.getByRole("button", { name: "全选字幕" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出所选 SRT" }).click();
  const download = await downloadPromise;
  const result = await readFile(await download.path(), "utf8");
  assert.match(result, /00:00:00,033 --> 00:00:01,067/);
  assert.match(result, /你好🙂\nHello/);
});

test("failed save leaves preview and original document intact; retry saves once", async (t) => {
  const page = await fixture(t);
  await generate(page);
  await page.evaluate(() => (fail = true));
  await page.getByRole("button", { name: "应用预览" }).click();
  await page.getByRole("status").filter({ hasText: "磁盘保存失败" }).waitFor();
  assert.equal(await page.evaluate(() => captions().length), 0);
  assert.equal(await page.locator(".ec-preview").isVisible(), true);
  await page.evaluate(() => (fail = false));
  await page.getByRole("button", { name: "应用预览" }).click();
  await page.waitForFunction(() => captions().length === 1);
  assert.equal(await page.evaluate(() => session.read().revision), 1);
});

test("cancel and close abort pending ASR/translation and late callback never resurrects a candidate", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    waitRead = new Promise((resolve) => (globalThis.releaseRead = resolve));
  });
  await page.locator('[data-caption-source="other"]').uncheck();
  await page.getByRole("button", { name: "生成所选声音字幕" }).click();
  await page.waitForFunction(() => abortSignal !== null);
  await page.getByRole("button", { name: "取消任务 / 丢弃预览" }).click();
  assert.equal(await page.evaluate(() => abortSignal.aborted), true);
  await page.evaluate(() => releaseRead());
  await page.waitForTimeout(25);
  assert.equal(await page.evaluate(() => controller.getState().candidate), undefined);
  await page.evaluate(async () => {
    waitRead = null;
    await seed();
    waitTranslate = new Promise((resolve) => (globalThis.releaseTranslate = resolve));
  });
  await page.getByRole("button", { name: "全选字幕" }).click();
  await page.getByRole("button", { name: "预览翻译" }).click();
  await page.waitForFunction(() => calls.some((call) => call.kind === "translate"));
  await page.getByRole("button", { name: "关闭字幕" }).click();
  await page.evaluate(() => releaseTranslate());
  await page.waitForTimeout(25);
  assert.equal(await page.evaluate(() => controller.getState().candidate), undefined);
  assert.equal(await page.evaluate(() => captions()[0].translation), undefined);
});

test("autosave-only state keeps textarea focus and selection, while a changed revision invalidates pending work", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => seed());
  await page.getByRole("button", { name: "全选字幕" }).click();
  const input = page.getByLabel("字幕文字", { exact: true });
  await input.fill("正在校对");
  await page.evaluate(() => session.flush());
  assert.equal(await input.inputValue(), "正在校对");
  assert.equal(await input.evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.evaluate(() => selection.length), 1);
  await page.evaluate(() => {
    waitTranslate = new Promise((resolve) => (globalThis.releaseTranslate = resolve));
  });
  await page.getByRole("button", { name: "预览翻译" }).click();
  await page.waitForFunction(() => calls.some((call) => call.kind === "translate"));
  await page.evaluate(() =>
    session.dispatch([{ type: "project.rename", name: "外部修改" }], session.getState().identity),
  );
  await page.evaluate(() => releaseTranslate());
  await page.waitForFunction(() => controller.getState().phase === "stale");
  assert.equal(await page.evaluate(() => captions()[0].translation), undefined);
});

test("narrow layout stays inside viewport, source text is inert, and missing services leave SRT available", async (t) => {
  const page = await fixture(t, { width: 390, disabled: true });
  assert.equal(await page.getByRole("button", { name: "生成所选声音字幕" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "预览翻译" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "导入 SRT" }).isEnabled(), true);
  await page.locator("[data-caption-srt-input]").setInputFiles({
    name: "文字.srt",
    mimeType: "text/plain",
    buffer: Buffer.from("1\n00:00:00,000 --> 00:00:01,000\n<script>globalThis.unsafe=1</script>\n"),
  });
  await page.locator(".ec-preview").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => globalThis.unsafe), undefined);
  const bounds = await page.locator(".editor-captions").evaluate((node) => ({
    left: node.getBoundingClientRect().left,
    right: node.getBoundingClientRect().right,
    inner: node.querySelector(".ec-body").scrollWidth,
    width: node.querySelector(".ec-body").clientWidth,
  }));
  assert.ok(bounds.left >= 0 && bounds.right <= 390);
  assert.ok(bounds.inner <= bounds.width + 1);
});

test("explicit source unlink button preserves caption text and real words and can be undone", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => seed());
  await page.getByRole("button", { name: "全选字幕" }).click();
  await page.getByRole("button", { name: "解除所选来源绑定" }).click();
  await page.waitForFunction(() => !captions()[0].sourceBinding);
  assert.equal(await page.evaluate(() => captions()[0].words.length), 2);
  await page.evaluate(() => session.undo());
  await page.waitForFunction(() => !!captions()[0].sourceBinding);
});
