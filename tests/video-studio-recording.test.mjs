import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
let browser, server, directory, url;
const repository = fileURLToPath(new URL("../", import.meta.url));
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "video-recording-ui-"));
  await build({
    stdin: {
      contents: `
        import {createRecordingUI} from './apps/video-studio/src/recording-ui.ts';
        import {CaptureRecorder} from './apps/video-studio/src/recording.ts';
        window.CaptureRecorder = CaptureRecorder;
        window.saved = [];
        window.saveNotifications = [];
        window.failSave = false;
        window.errors = [];
        window.projectId = 'recording-project';
        const root = document.querySelector('#root');
        const render = () => { root.innerHTML = ui.render(); ui.mount(); };
        const ui = createRecordingUI({
          projectId: () => window.projectId,
          changed: render,
          description: () => window.recordingDescription,
          saveLabel: () => window.recordingSaveLabel,
          save: async (blob, name, kind) => {
            if (window.failSave) throw Error('保存暂时失败');
            if (window.holdSave) await new Promise(resolve => { window.releaseSave = resolve; });
            window.saved.push({blob, name, kind});
          },
          saved: () => {
            window.saveNotifications.push({
              busy: ui.busy,
              hasUnsavedResult: ui.hasUnsavedResult,
            });
            ui.assertSafeToLeave();
          },
        });
        window.recording = ui;
        root.addEventListener('click', event => {
          const button = event.target.closest('[data-action]');
          if (button) void ui.action(button.dataset.action).catch(error => window.errors.push(error.message));
        });
        for (const event of ['input', 'change']) root.addEventListener(event, event => ui.input(event.target));
        render();
      `,
      resolveDir: repository,
      sourcefile: "recording-test.js",
    },
    outfile: join(directory, "test.mjs"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  const bundle = await readFile(join(directory, "test.mjs")),
    css = await readFile(join(repository, "apps/video-studio/public/style.css"));
  server = createServer((req, res) => {
    if (req.url === "/test.mjs") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(bundle);
    } else if (req.url === "/style.css") {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(css);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        '<!doctype html><link rel="stylesheet" href="/style.css"><div id="root" style="width:320px;padding:20px"></div><script type="module" src="/test.mjs"></script>',
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function page() {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.tracks = [];
    window.deviceRequests = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.realCapture = original;
    navigator.mediaDevices.getUserMedia = async (options) => {
      window.deviceRequests++;
      const stream = await original(options);
      window.tracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.goto(url);
  await page.locator("#recording-mode").waitFor();
  return page;
}
const click = (page, name) => page.getByRole("button", { name, exact: true }).click();

test(
  "workflow script import never requests devices and cannot replace an active or unsaved take",
  { timeout: 20000 },
  async () => {
    const p = await page();
    const script = "这是确认好的口播稿。\n保留 <原声>，用自己的节奏讲完。";
    const rejectedImport = () =>
      p.evaluate(() => {
        try {
          window.recording.setScript("不应该覆盖的另一个版本");
          return "";
        } catch (error) {
          return error.message;
        }
      });
    await p.evaluate((text) => {
      window.recordingDescription = "本次为成片口播 <已审稿>";
      window.recordingSaveLabel = "保存并回到制作";
      window.recording.setScript(text);
    }, script);
    assert.equal(await p.evaluate(() => window.deviceRequests), 0);
    assert.equal(await p.locator("#recording-script").inputValue(), script);
    assert.equal(await p.locator("#recording-prompter-text").textContent(), script);
    assert.equal(await p.locator(".recording-script").getAttribute("open"), "");
    assert.equal(
      (await p.locator(".section-description").textContent()).trim(),
      "本次为成片口播 <已审稿>",
    );
    assert.equal(await p.locator("原声, 已审稿").count(), 0);
    assert.match(
      await p.evaluate(() => {
        try {
          window.recording.setScript("稿".repeat(10001));
          return "";
        } catch (error) {
          return error.message;
        }
      }),
      /10000/,
    );
    assert.equal(await p.locator("#recording-script").inputValue(), script);

    await click(p, "3 秒后开始录制");
    await p.locator(".recording-countdown").waitFor();
    assert.match(await rejectedImport(), /结束当前录制或保存/);
    assert.equal(await p.locator("#recording-script").inputValue(), script);
    await p.getByRole("button", { name: "暂停", exact: true }).waitFor();
    assert.match(await rejectedImport(), /结束当前录制或保存/);
    assert.equal(await p.locator("#recording-prompter-text").textContent(), script);
    await p.waitForTimeout(350);
    await click(p, "结束录制");
    await p.getByText("录制已完成，设备已释放", { exact: true }).waitFor();
    assert.match(await rejectedImport(), /还未保存/);
    assert.equal(await p.locator("#recording-script").inputValue(), script);
    assert.equal(await p.evaluate(() => window.recording.hasUnsavedResult), true);

    await p.evaluate(() => {
      window.holdSave = true;
    });
    await click(p, "保存并回到制作");
    await p.waitForFunction(() => typeof window.releaseSave === "function");
    assert.equal(await p.evaluate(() => window.saveNotifications.length), 0);
    assert.match(await rejectedImport(), /结束当前录制或保存/);
    assert.equal(await p.locator("#recording-script").inputValue(), script);
    await p.evaluate(() => window.releaseSave());
    await p.waitForFunction(() => window.saved.length === 1 && !window.recording.busy);
    assert.equal(await p.evaluate(() => window.recording.hasUnsavedResult), false);
    assert.deepEqual(await p.evaluate(() => window.saveNotifications), [
      { busy: false, hasUnsavedResult: false },
    ]);
    await p.evaluate(() => window.recording.setScript("下一条视频的口播稿"));
    assert.equal(await p.locator("#recording-script").inputValue(), "下一条视频的口播稿");
    assert.equal(await p.evaluate(() => window.deviceRequests), 1);
    await p.close();
  },
);

test(
  "microphone UI requests devices only on action, counts down, pauses, preserves failed saves and releases tracks",
  { timeout: 25000 },
  async () => {
    const p = await page();
    assert.equal(await p.evaluate(() => window.deviceRequests), 0);
    await click(p, "刷新设备");
    assert.equal(await p.evaluate(() => window.deviceRequests), 0);
    await click(p, "连接并检查预览");
    await p.getByText("预览就绪，尚未录制", { exact: true }).waitFor();
    await p.waitForFunction(
      () => Number(document.querySelector("#recording-level").getAttribute("aria-valuenow")) > 0,
    );
    assert.equal(
      await p.evaluate(() => window.tracks.every((track) => track.readyState === "live")),
      true,
    );
    await p.locator(".recording-script summary").click();
    await p
      .locator("#recording-script")
      .fill("这是我的真实口播提词稿。\n第二个要点。\n第三个要点。\n第四个要点。");
    await click(p, "3 秒后开始录制");
    await p.locator(".recording-countdown").waitFor();
    await click(p, "暂停");
    await p.getByText("已暂停", { exact: true }).waitFor();
    const time = await p.locator("#recording-time").textContent();
    await p.waitForTimeout(300);
    assert.equal(await p.locator("#recording-time").textContent(), time);
    await click(p, "继续录制");
    await p.waitForTimeout(700);
    await click(p, "结束录制");
    await p.getByText("录制已完成，设备已释放", { exact: true }).waitFor();
    assert.equal(
      await p.evaluate(() => window.tracks.every((track) => track.readyState === "ended")),
      true,
    );
    assert.equal(await p.evaluate(() => window.recording.hasUnsavedResult), true);
    assert.match(
      await p.evaluate(() => {
        try {
          window.recording.assertSafeToLeave();
          return "";
        } catch (error) {
          return error.message;
        }
      }),
      /还未保存/,
    );
    await p.evaluate(() => {
      window.failSave = true;
    });
    await click(p, "保存到素材库");
    await p.getByRole("alert").filter({ hasText: "保存暂时失败" }).waitFor();
    assert.equal(await p.evaluate(() => window.recording.hasUnsavedResult), true);
    assert.equal(await p.evaluate(() => window.saveNotifications.length), 0);
    await p.evaluate(() => {
      window.failSave = false;
    });
    await p.locator("#recording-name").fill("我的口播");
    await click(p, "保存到素材库");
    await p.waitForFunction(() => window.saved.length === 1);
    const result = await p.evaluate(async () => {
      const take = window.saved[0];
      const context = new AudioContext();
      try {
        const audio = await context.decodeAudioData(await take.blob.arrayBuffer());
        const samples = audio.getChannelData(0);
        return {
          name: take.name,
          kind: take.kind,
          bytes: take.blob.size,
          duration: audio.duration,
          rms: Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length),
        };
      } finally {
        await context.close();
      }
    });
    assert.equal(result.name, "我的口播.webm");
    assert.equal(result.kind, "audio");
    assert.ok(result.bytes > 1000);
    assert.ok(result.rms > 0.001, JSON.stringify(result));
    assert.ok(result.duration < 2.5, JSON.stringify(result));
    assert.equal(await p.evaluate(() => window.recording.hasUnsavedResult), false);
    await p.close();
  },
);

test(
  "camera result keeps real picture and microphone, and rejected or late permissions release every stream",
  { timeout: 20000 },
  async () => {
    const p = await page();
    await p.locator("#recording-mode").selectOption("camera");
    await click(p, "3 秒后开始录制");
    await p.getByRole("button", { name: "暂停", exact: true }).waitFor();
    await p.waitForTimeout(600);
    await click(p, "结束录制");
    await p.getByText("录制已完成，设备已释放", { exact: true }).waitFor();
    await p.waitForFunction(() => document.querySelector("#recording-preview").videoWidth > 0);
    assert.equal(
      await p.evaluate(() => window.tracks.every((track) => track.readyState === "ended")),
      true,
    );
    await click(p, "丢弃这次录制");
    await p.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("denied", "NotAllowedError");
      };
    });
    await click(p, "连接并检查预览");
    await p.getByRole("alert").filter({ hasText: "未获得录制权限" }).waitFor();
    await p.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async (options) => {
        await new Promise((resolve) => {
          window.releasePermission = resolve;
        });
        const stream = await window.realCapture(options);
        window.tracks.push(...stream.getTracks());
        return stream;
      };
    });
    await click(p, "连接并检查预览");
    await p.waitForFunction(() => typeof window.releasePermission === "function");
    await click(p, "取消连接");
    await p.evaluate(() => window.releasePermission());
    await p.waitForFunction(
      () =>
        window.tracks.length >= 4 && window.tracks.every((track) => track.readyState === "ended"),
    );
    assert.equal(await p.getByRole("button", { name: "3 秒后开始录制", exact: true }).count(), 1);
    await p.close();
  },
);

test(
  "screen branch mixes actual capture audio only when display stream contains an audio track",
  { timeout: 15000 },
  async () => {
    const p = await page();
    const results = await p.evaluate(async () => {
      const results = [];
      // The picker is substituted here, but both returned inputs and encoder are
      // real Chromium capture devices, including the microphone mix.
      for (const systemAudio of [false, true]) {
        navigator.mediaDevices.getDisplayMedia = async () => {
          const stream = await window.realCapture({ video: true, audio: systemAudio });
          window.tracks.push(...stream.getTracks());
          return stream;
        };
        const capture = new window.CaptureRecorder();
        try {
          await capture.prepare({ mode: "screen" });
          const status = capture.snapshot;
          capture.start();
          await new Promise((resolve) => setTimeout(resolve, 550));
          const result = await capture.stop();
          results.push({
            systemAudio: status.systemAudio,
            audioTracks: status.stream.getAudioTracks().length,
            kind: result.kind,
            bytes: result.blob.size,
            allEnded: window.tracks.every((track) => track.readyState === "ended"),
          });
        } finally {
          capture.dispose();
        }
      }
      return results;
    });
    assert.deepEqual(
      results.map((r) => r.systemAudio),
      [false, true],
    );
    for (const result of results) {
      assert.equal(result.audioTracks, 1);
      assert.equal(result.kind, "video");
      assert.ok(result.bytes > 1000);
      assert.equal(result.allEnded, true);
    }
    await p.close();
  },
);
