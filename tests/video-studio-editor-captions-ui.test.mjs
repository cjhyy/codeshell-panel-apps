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
      contents: `export {EditorCaptionsUI} from './apps/video-studio/src/editor/captions-ui';export {createCaptionController} from './apps/video-studio/src/editor/caption-controller';export {EditorSession} from './apps/video-studio/src/editor/session';export * from './apps/video-studio/src/editor/captions';export * from './apps/video-studio/src/editor/defaults';export {evaluateFrame} from './apps/video-studio/src/editor/evaluate';export {drawEvaluatedFrame} from './apps/video-studio/src/editor/compositor';export {applyEditorOperations} from './apps/video-studio/src/editor/operations';export {reconcileEditorProduction} from './apps/video-studio/src/editor/production-guard';`,
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
    globalThis.playhead = 0;
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
    if (options.narration) {
      const style = editor.defaultTextStyle();
      stored.sequences[0].clips.push(
        ...["draft-clip", "own-clip"].map((id, index) => ({
          id,
          trackId: "text",
          start: index * 2 * T,
          duration: T,
          label: "字幕",
          kind: "text",
          role: "subtitle",
          text: index ? "用户自己的字幕" : "文案估时字幕",
          style,
          words: [],
          transform: editor.defaultTransform(),
          color: editor.defaultColorAdjustment(),
          blendMode: "normal",
        })),
      );
      stored.production = {
        script: "文案估时字幕",
        narration: {
          phase: "approved",
          captionBasis: "draft",
          draftCaptionIds: ["draft-narration-1"],
          approvedScript: "文案估时字幕",
          approvedFingerprint: "a".repeat(64),
        },
        legacyAliases: [
          {
            sequenceId: "main",
            clipId: "draft-clip",
            collection: "captions",
            legacyId: "draft-narration-1",
          },
        ],
      };
    }
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
      // The main panel's shared helper adds the production guard to every caption edit.
      apply: (ops, identity, label) => {
        const before = session.read(),
          after = editor.applyEditorOperations(before, ops, before.revision);
        return session.dispatchDurable(
          [...ops, ...editor.reconcileEditorProduction(before, after)],
          identity,
          label,
          "user",
        );
      },
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
      ...(options.inline ? { presentation: "inline", currentTime: () => playhead } : {}),
      select: (sequenceId, ids) => (selection = ids),
      seek: (tick) => sought.push(tick),
      onError: (error) => errors.push(error.message),
      ...(options.recheck
        ? {
            transcriptionHint: () => globalThis.transcriptionHint,
            recheckTranscription: async () => {
              calls.push({ kind: "recheck" });
              globalThis.transcriptionHint = "";
              controller.setCapabilities({ canTranscribe: true, canTranslate: true });
            },
          }
        : {}),
    });
    if (options.recheck) {
      globalThis.transcriptionHint =
        options.recheck === "no-local-media"
          ? ""
          : "本机语音转写未就绪：缺少 base 模型 ~/.cache/whisper/base.pt。准备好模型后点“重新检测”，或先导入 SRT。";
      controller.setCapabilities({ canTranscribe: false, canTranslate: true });
    }
    if (options.inline) ui.mount(document.querySelector("#mount"));
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

test("unavailable transcription names the missing piece and 重新检测 refreshes readiness", async (t) => {
  const page = await fixture(t, { recheck: true });
  const generate = page.getByRole("button", { name: "生成所选声音字幕" });
  assert.equal(await generate.isDisabled(), true);
  await page.getByText("缺少 base 模型 ~/.cache/whisper/base.pt", { exact: false }).waitFor();
  await page.getByRole("button", { name: "重新检测" }).click();
  await page.waitForFunction(() => calls.some((call) => call.kind === "recheck"));
  await page.waitForFunction(
    () => !document.querySelector("[data-caption-generate]").disabled,
  );
  assert.equal(await page.getByRole("button", { name: "重新检测" }).isVisible(), false);
  assert.equal(await page.getByText("缺少 base 模型", { exact: false }).isVisible(), false);
});

test("without local media support the caption panel never asks to install whisper", async (t) => {
  const page = await fixture(t, { recheck: "no-local-media" });
  assert.equal(await page.getByRole("button", { name: "生成所选声音字幕" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "重新检测" }).isVisible(), false);
  assert.equal(await page.locator(".ec-note").isVisible(), false);
  assert.equal(
    await page.locator("[data-caption-generate]").getAttribute("title"),
    "当前环境未连接真实转写，可导入SRT",
  );
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

test("inline panel adds at the playhead, edits timing and deletes, each as one undo step", async (t) => {
  const page = await fixture(t, { inline: true });
  assert.equal(await page.locator("dialog").count(), 0);
  assert.equal(await page.locator("#mount > section.editor-captions.is-inline").isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "关闭字幕" }).count(), 0);
  await page.evaluate(() => (playhead = 1_234_567));
  await page.getByLabel("新字幕文字", { exact: true }).fill("播放头字幕");
  await page.getByRole("button", { name: "在播放头添加字幕", exact: true }).click();
  await page.waitForFunction(() => captions().length === 1);
  const added = await page.evaluate(() => captions()[0]);
  // 29.97 fps frames are 8008 ticks; the playhead snaps to the nearest frame.
  assert.equal(added.start, 154 * 8008);
  assert.equal(added.duration, 3 * 240000);
  assert.equal(added.text, "播放头字幕");
  assert.equal(await page.getByLabel("新字幕文字", { exact: true }).inputValue(), "");
  assert.equal(await page.evaluate(() => session.read().revision), 1);
  const row = page.locator(`[data-caption-id="${added.id}"]`);
  await row.getByLabel("开始（秒）").fill("2");
  await row.getByLabel("结束（秒）").fill("4.5");
  await row.getByRole("button", { name: "保存时间", exact: true }).click();
  await page.waitForFunction(() => captions()[0].start === 60 * 8008);
  assert.equal(await page.evaluate(() => captions()[0].duration), 135 * 8008 - 60 * 8008);
  assert.equal(await page.evaluate(() => session.read().revision), 2);
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await page.waitForFunction(() => captions().length === 0);
  assert.equal(await page.evaluate(() => session.read().revision), 3);
  await page.evaluate(() => session.undo());
  await page.waitForFunction(() => captions()[0]?.start === 60 * 8008);
  await page.evaluate(() => session.undo());
  await page.waitForFunction(() => captions()[0]?.start === 154 * 8008);
  await page.evaluate(() => session.undo());
  await page.waitForFunction(() => captions().length === 0);
});

test("inline timing keeps an unchanged off-frame start exactly and rejects an end before the start", async (t) => {
  const page = await fixture(t, { inline: true });
  const id = await page.evaluate(() =>
    controller.add("main", { start: 1_234_567, duration: 480_001, text: "实拍时间" }),
  );
  const row = page.locator(`[data-caption-id="${id}"]`);
  await row.waitFor();
  assert.equal(await row.getByLabel("开始（秒）").inputValue(), "5.144");
  await row.getByLabel("结束（秒）").fill("7");
  await row.getByRole("button", { name: "保存时间", exact: true }).click();
  await page.waitForFunction(() => captions()[0].duration !== 480_001);
  const caption = await page.evaluate(() => captions()[0]);
  assert.equal(caption.start, 1_234_567, "An untouched value is never re-snapped");
  assert.equal(caption.start + caption.duration, 210 * 8008);
  await row.getByLabel("结束（秒）").fill("1");
  await row.getByRole("button", { name: "保存时间", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "结束时间必须晚于开始时间" }).waitFor();
  assert.equal(await page.evaluate(() => captions()[0].start), 1_234_567);
});

test("inline panel moves into a rebuilt host without losing focus, typed text or a pending preview", async (t) => {
  const page = await fixture(t, { inline: true, disabled: true });
  await page.locator("[data-caption-srt-input]").setInputFiles({
    name: "候选.srt",
    mimeType: "text/plain",
    buffer: Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n等待应用\n"),
  });
  await page.locator(".ec-preview").waitFor({ state: "visible" });
  const draft = page.getByLabel("新字幕文字", { exact: true });
  await draft.fill("正在输入");
  await draft.evaluate((node) => node.setSelectionRange(2, 4));
  await page.evaluate(() => {
    const next = document.createElement("main");
    next.id = "rebuilt";
    document.querySelector("#mount").replaceWith(next);
    ui.mount(next);
  });
  assert.equal(await page.locator("#rebuilt > .editor-captions").count(), 1);
  assert.equal(await draft.inputValue(), "正在输入");
  assert.deepEqual(
    await draft.evaluate((node) => [
      node === document.activeElement,
      node.selectionStart,
      node.selectionEnd,
    ]),
    [true, 2, 4],
  );
  assert.equal(await page.locator(".ec-preview").isVisible(), true);
  await page.getByRole("button", { name: "应用预览" }).click();
  await page.waitForFunction(() => captions().length === 1);
});

test("temporary narration captions carry a badge and edits explain that approval returns to review", async (t) => {
  const page = await fixture(t, { inline: true, narration: true });
  const draft = page.locator('[data-caption-id="draft-clip"]'),
    own = page.locator('[data-caption-id="own-clip"]');
  assert.equal(await draft.locator(".ec-badge").textContent(), "临时字幕");
  assert.equal(await own.locator(".ec-badge").count(), 0);
  assert.match(await page.locator(".ec-narration").innerText(), /文案估时的临时字幕/);
  assert.match(await page.locator(".ec-narration").innerText(), /回到待确认/);
  await draft.getByLabel("字幕文字", { exact: true }).fill("改过的临时字幕");
  await draft.getByRole("button", { name: "保存文字", exact: true }).click();
  await page.waitForFunction(() => session.read().production.narration.phase === "review");
  await page.getByRole("status").filter({ hasText: "口播草稿已回到待确认" }).waitFor();
  await draft.getByRole("button", { name: "删除", exact: true }).click();
  await page.waitForFunction(() => !captions().some((clip) => clip.id === "draft-clip"));
  assert.deepEqual(
    await page.evaluate(() => session.read().production.narration.draftCaptionIds),
    ["draft-narration-1"],
    "Deleting a temporary caption keeps its provenance for later alignment",
  );
});

test("style preset select restyles every caption in one undo step and shows the shared choice", async (t) => {
  const page = await fixture(t, { inline: true });
  await page.evaluate(() => seed());
  await page.evaluate(() => controller.add("main", { start: 6 * 240000, text: "第二条" }));
  await page.waitForFunction(() => captions().length === 2);
  const revision = await page.evaluate(() => session.read().revision);
  await page.getByLabel("字幕样式", { exact: true }).selectOption("bold");
  await page.waitForFunction(() => captions().every((clip) => clip.style.color === "#ffe46b"));
  assert.equal(await page.evaluate(() => session.read().revision), revision + 1);
  assert.equal(await page.evaluate(() => session.read().production.legacyCaptionStyle), "bold");
  assert.equal(
    await page.evaluate(() => captions().find((clip) => clip.words.length).words.length),
    2,
  );
  assert.equal(await page.getByLabel("字幕样式", { exact: true }).inputValue(), "bold");
  await page.evaluate(() => session.undo());
  await page.waitForFunction(() => captions().every((clip) => clip.style.color !== "#ffe46b"));
});
