import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
let browser, bundle, css;
before(async () => {
  bundle = (
    await build({
      stdin: {
        contents: `export {EditorSeparationUI} from './apps/video-studio/src/editor/separation-ui';export {createSeparationController} from './apps/video-studio/src/editor/separation-controller';export {EditorSession} from './apps/video-studio/src/editor/session';export * from './apps/video-studio/src/editor/defaults';`,
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "editor",
      target: "chrome120",
    })
  ).outputFiles[0].text;
  css = await readFile(
    new URL("../apps/video-studio/public/editor-separation.css", import.meta.url),
    "utf8",
  );
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});
async function fixture(t, { ready = true, width = 1000 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 800 } }),
    errors = [];
  page.setDefaultTimeout(5000);
  page.on("pageerror", (e) => errors.push(e.message));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
  });
  await page.route("http://127.0.0.1:41999/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><main></main>" }),
  );
  await page.goto("http://127.0.0.1:41999/separation");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(
    async ({ ready }) => {
      const T = 240000;
      globalThis.calls = [];
      globalThis.fail = false;
      globalThis.pending = null;
      globalThis.released = 0;
      globalThis.signal = null;
      const doc = {
        schemaVersion: 2,
        timebase: T,
        id: "separation-ui",
        revision: 0,
        name: "原片",
        activeSequenceId: "main",
        exportProfiles: [],
        assets: [
          {
            id: "a",
            name: "原始片段",
            kind: "video",
            duration: 10 * T,
            resourceId: "asset-" + "a".repeat(64),
          },
        ],
        sequences: [
          {
            id: "main",
            name: "主序列",
            width: 640,
            height: 360,
            frameRate: { numerator: 30000, denominator: 1001 },
            background: "#000000",
            timelineMode: "free",
            tracks: [editor.createTrack("video", "video")],
            clips: [
              {
                id: "clip",
                kind: "media",
                assetId: "a",
                trackId: "video",
                label: "原片",
                start: 1001,
                duration: 2 * T,
                transform: editor.defaultTransform(),
                color: editor.defaultColorAdjustment(),
                blendMode: "normal",
                audio: editor.defaultAudioMix(),
                timeMap: {
                  points: [
                    { time: 0, source: 5 * T },
                    { time: 2 * T, source: 3 * T },
                  ],
                },
              },
            ],
            transitions: [],
            markers: [],
          },
        ],
      };
      let stored = doc,
        revision = 1;
      globalThis.session = await editor.EditorSession.open(
        {
          read: async () => ({ data: stored, revision }),
          write: async (value, base) => {
            if (fail) throw new Error("磁盘保存失败");
            if (base !== revision) throw new Error("conflict");
            stored = structuredClone(value);
            return { revision: ++revision };
          },
          backupLegacy: async () => {},
        },
        { autosaveDelayMs: 60000 },
      );
      const result = {
        sourceResourceId: "asset-" + "a".repeat(64),
        sourceSha256: "a".repeat(64),
        modelId: "uvr-mdx-kara-2-v1",
        modelSha256: "bf32e15105a09c0f7dddd2b67346146334d6f3ecb399ed7638eba2ab07cbf5f4",
        sampleRate: 44100,
        sampleCount: 441000,
        durationSeconds: 10,
        stems: {
          vocals: {
            assetId: "asset-" + "b".repeat(64),
            sha256: "b".repeat(64),
            bytes: 3528080,
            mimeType: "audio/wav",
          },
          instrumental: {
            assetId: "asset-" + "c".repeat(64),
            sha256: "c".repeat(64),
            bytes: 3528080,
            mimeType: "audio/wav",
          },
        },
      };
      const capability = () => ({
        state: ready ? "ready" : "not-installed",
        canInstall: !ready,
        modelId: result.modelId,
        message: ready ? "模型已就绪" : "点击安装后下载公开模型和依赖",
      });
      globalThis.controller = editor.createSeparationController({
        session: () => session,
        guard() {},
        bridge: {
          dispose() {},
          list: async (id, offset) => {
            calls.push("list:" + offset);
            return {
              jobs: [{ id: "old-job", status: "succeeded", createdAt: 1000, retryable: false }],
              nextOffset: 1,
              complete: true,
            };
          },
          resume: async () => {
            calls.push("resume");
            return structuredClone(result);
          },
          status: async () => {
            calls.push("status");
            return capability();
          },
          setup: async () => {
            calls.push("setup");
            ready = true;
            return capability();
          },
          separate: async (_id, _duration, options) => {
            calls.push("separate");
            signal = options.signal;
            options.onTask({ id: "separate-job" });
            options.onChanged({ progress: { message: "真实处理器任务进度", fraction: 0.4 } });
            if (pending) await pending;
            return structuredClone(result);
          },
        },
        apply: (ops, identity, label) => session.dispatchDurable(ops, identity, label),
      });
      // A real PCM WAV URL lets Chromium exercise audio elements, metadata and playback.
      const bytes = new ArrayBuffer(44 + 44100 * 2 * 2),
        v = new DataView(bytes),
        str = (p, s) => {
          for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i));
        };
      str(0, "RIFF");
      v.setUint32(4, bytes.byteLength - 8, true);
      str(8, "WAVE");
      str(12, "fmt ");
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 2, true);
      v.setUint32(24, 44100, true);
      v.setUint32(28, 176400, true);
      v.setUint16(32, 4, true);
      v.setUint16(34, 16, true);
      str(36, "data");
      v.setUint32(40, bytes.byteLength - 44, true);
      for (let i = 44; i < bytes.byteLength; i += 4) {
        v.setInt16(i, 1000 * Math.sin(((i - 44) / 4 / 44100) * 2 * Math.PI * 440), true);
        v.setInt16(i + 2, 1000 * Math.sin(((i - 44) / 4 / 44100) * 2 * Math.PI * 440), true);
      }
      globalThis.ui = new editor.EditorSeparationUI(document.querySelector("main"), {
        controller,
        preview: async (id, signal) => {
          calls.push("preview:" + id);
          const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
          return {
            url,
            release() {
              released++;
              URL.revokeObjectURL(url);
            },
          };
        },
        onError: (e) => calls.push("error:" + e.message),
      });
      ui.open("main", "clip");
    },
    { ready },
  );
  await page.waitForFunction(() => controller.getState().phase === "idle");
  return page;
}
test("installation is explicit; opening never downloads and progress/results require preview before one-step application", async (t) => {
  const page = await fixture(t, { ready: false });
  assert.deepEqual(await page.evaluate(() => calls), ["status"]);
  assert.equal(await page.locator("[data-separation-start]").isDisabled(), true);
  await page.locator("[data-separation-install]").click();
  await page.waitForFunction(() => calls.includes("setup"));
  assert.equal(await page.locator("[data-separation-install]").isVisible(), false);
  await page.locator("[data-separation-start]").click();
  await page.waitForFunction(() => controller.getState().phase === "preview");
  assert.equal(await page.evaluate(() => session.read().sequences[0].clips.length), 1);
  await page.locator("[data-separation-mode]").selectOption("both");
  await page.locator("[data-separation-apply]").click();
  await page.waitForFunction(() => session.read().sequences[0].clips.length === 3);
  assert.equal(await page.evaluate(() => session.read().sequences[0].clips[0].audio.volume), 0);
  await page.evaluate(() => session.undo());
  assert.equal(await page.evaluate(() => session.read().sequences[0].clips.length), 1);
  assert.equal(await page.evaluate(() => session.read().sequences[0].clips[0].audio.volume), 1);
});
test("real audio preview loads all three resources, isolates playback and revokes URLs on close", async (t) => {
  const page = await fixture(t);
  await page.locator("[data-separation-start]").click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("audio")].every((a) => a.readyState >= 1),
  );
  assert.deepEqual(
    await page.locator("audio").evaluateAll((nodes) => nodes.map((a) => a.duration)),
    [1, 1, 1],
  );
  await page.locator('[data-stem="original"]').evaluate((a) => a.play());
  await page.locator('[data-stem="vocals"]').evaluate((a) => a.play());
  assert.equal(await page.locator('[data-stem="original"]').evaluate((a) => a.paused), true);
  assert.equal(await page.locator('[data-stem="vocals"]').evaluate((a) => a.paused), false);
  await page.locator("[data-separation-close]").click();
  assert.equal(await page.evaluate(() => released), 3);
  assert.equal(
    await page.locator("audio").evaluateAll((nodes) => nodes.every((a) => !a.hasAttribute("src"))),
    true,
  );
});
test("failed durable save leaves original plus preview for explicit retry", async (t) => {
  const page = await fixture(t);
  await page.locator("[data-separation-start]").click();
  await page.waitForFunction(() => controller.getState().phase === "preview");
  await page.evaluate(() => {
    fail = true;
  });
  await page.locator("[data-separation-apply]").click();
  await page.waitForFunction(() => controller.getState().phase === "error");
  assert.match(await page.locator("[data-separation-status]").innerText(), /磁盘保存失败/);
  assert.equal(await page.evaluate(() => session.read().sequences[0].clips.length), 1);
  assert.equal(await page.locator("[data-separation-preview]").isVisible(), true);
  await page.evaluate(() => {
    fail = false;
  });
  await page.locator("[data-separation-apply]").click();
  await page.waitForFunction(() => session.read().sequences[0].clips.length === 2);
  assert.equal(await page.evaluate(() => calls.filter((c) => c === "separate").length), 1);
});
test("cancel ignores a late result; closing a running durable task does not cancel it", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    pending = new Promise((resolve) => {
      globalThis.finish = resolve;
    });
  });
  await page.locator("[data-separation-start]").click();
  await page.waitForFunction(() => controller.getState().phase === "running");
  await page.locator("[data-separation-close]").click();
  assert.equal(await page.evaluate(() => signal.aborted), false);
  await page.evaluate(() => ui.open("main", "clip"));
  await page.locator("[data-separation-cancel]").click();
  assert.equal(await page.evaluate(() => signal.aborted), true);
  await page.evaluate(() => finish());
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(() => controller.getState().phase), "cancelled");
  assert.equal(await page.locator("[data-separation-preview]").isVisible(), false);
  assert.equal(await page.evaluate(() => session.read().revision), 0);
});
test("narrow dialog fits viewport and stale revision disables old result application", async (t) => {
  const page = await fixture(t, { width: 390 });
  await page.locator("[data-separation-start]").click();
  await page.waitForFunction(() => controller.getState().phase === "preview");
  const bounds = await page.locator("dialog").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.equal(await page.locator("dialog").evaluate((e) => e.scrollWidth <= e.clientWidth), true);
  await page.evaluate(() =>
    session.dispatch(
      [{ type: "project.rename", name: "changed" }],
      session.read().revision,
      "rename",
    ),
  );
  assert.equal(await page.locator("[data-separation-preview]").isVisible(), false);
  assert.match(await page.locator("[data-separation-status]").innerText(), /工程已更新/);
});
test("existing task can be reopened without starting new inference; selecting another clip clears the old candidate", async (t) => {
  const page = await fixture(t);
  await page.locator("summary").click();
  await page.locator("[data-separation-more]").click();
  await page.getByRole("button", { name: "重新试听" }).click();
  await page.waitForFunction(() => controller.getState().phase === "preview");
  assert.equal(await page.evaluate(() => calls.includes("resume")), true);
  assert.equal(await page.evaluate(() => calls.includes("separate")), false);
  assert.match(await page.locator("[data-separation-status]").innerText(), /原始片段/);
  await page.evaluate(() => ui.open("main", "other-clip"));
  assert.equal(await page.locator("[data-separation-preview]").isVisible(), false);
  assert.equal(await page.evaluate(() => controller.getState().candidate), undefined);
});
test("opening a different source while running is explicitly rejected and preserves the current task", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    pending = new Promise((resolve) => {
      globalThis.finish = resolve;
    });
  });
  await page.locator("[data-separation-start]").click();
  await page.waitForFunction(() => controller.getState().phase === "running");
  const message = await page.evaluate(() => {
    try {
      ui.open("main", "other-clip");
      return "";
    } catch (error) {
      return error.message;
    }
  });
  assert.match(message, /原始片段.*仍在处理/);
  assert.equal(await page.evaluate(() => signal.aborted), false);
  await page.locator("[data-separation-cancel]").click();
  await page.evaluate(() => finish());
});
