import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

let browser, source, css;
before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        export { EditorWorkspace } from './apps/video-studio/src/editor/workspace-ui';
        export { EditorSession, EditorStorageConflictError } from './apps/video-studio/src/editor/session';
        export * from './apps/video-studio/src/editor/defaults';
        export { sequenceDuration } from './apps/video-studio/src/editor/validation';
      `,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "editor",
    platform: "browser",
    target: "chrome120",
  });
  source = bundle.outputFiles[0].text;
  css = (
    await Promise.all(
      [
        "style.css",
        "editor-inspector.css",
        "editor-timeline.css",
        "editor-timing.css",
        "editor-workspace.css",
        "editor-markers.css",
      ].map((name) =>
        readFile(new URL(`../apps/video-studio/public/${name}`, import.meta.url), "utf8"),
      ),
    )
  ).join("\n");
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function fixture(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: options.width ?? 1240, height: 900 } });
  const uncaught = [];
  page.setDefaultTimeout(4000);
  page.on("pageerror", (error) => uncaught.push(String(error)));
  t.after(async () => {
    await page.close();
    assert.deepEqual(uncaught, [], "The real workspace must not emit uncaught errors");
  });
  await page.route("http://127.0.0.1:41789/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><main id="workspace"></main></body></html>',
    }),
  );
  await page.goto("http://127.0.0.1:41789/workspace");
  if (options.layout === "embedded")
    await page.evaluate(() => {
      const host = document.createElement("section");
      host.className = "workspace editor-mode";
      host.style.height = "900px";
      const root = document.querySelector("#workspace");
      root.before(host);
      host.append(root);
    });
  await page.addStyleTag({ content: css + "\nbody{display:block;margin:0;padding:0;}" });
  await page.addScriptTag({ content: source });
  await page.evaluate(async (options) => {
    const duration = 4 * 240000;
    const visual = () => ({
      transform: editor.defaultTransform(),
      color: editor.defaultColorAdjustment(),
      blendMode: "normal",
    });
    const media = (id, trackId, assetId) => ({
      id,
      label: id,
      trackId,
      assetId,
      kind: "media",
      start: 0,
      duration,
      timeMap: {
        points: [
          { time: 0, source: 0 },
          { time: duration, source: duration },
        ],
      },
      audio: editor.defaultAudioMix(),
      ...visual(),
    });
    const initial = {
      schemaVersion: 2,
      timebase: 240000,
      id: "workspace-document",
      name: "工作台测试",
      revision: 3,
      assets: [
        { id: "demo", name: "测试画面", kind: "demo", duration, width: 320, height: 180 },
        ...(options.audio
          ? [
              {
                id: "audio",
                name: "测试声音",
                kind: "audio",
                duration,
                resourceId: "authorized-audio",
              },
            ]
          : []),
      ],
      sequences: [
        {
          id: "main",
          name: "主序列",
          width: 320,
          height: 180,
          frameRate: { numerator: 30, denominator: 1 },
          background: "#000000",
          timelineMode: "free",
          tracks: [
            editor.createTrack("video", "video", "画面轨"),
            editor.createTrack("audio", "audio", "声音轨"),
            editor.createTrack("text", "text", "文字轨"),
          ],
          clips: [
            media("a", "video", "demo"),
            ...(options.audio ? [media("sound", "audio", "audio")] : []),
          ],
          transitions: [],
          markers: [],
        },
      ],
      activeSequenceId: "main",
      exportProfiles: [],
      ...(options.narration
        ? {
            production: {
              script: "已确认文案",
              narration: {
                phase: "approved",
                captionBasis: "draft",
                draftCaptionIds: [],
                approvedScript: "已确认文案",
                approvedFingerprint: "approved-original",
              },
            },
          }
        : {}),
    };
    for (let index = 1; index < (options.sequenceCount ?? 1); index++) {
      const next = structuredClone(initial.sequences[0]);
      next.id = `sequence-${index + 1}`;
      next.name = `序列 ${index + 1}`;
      initial.sequences.push(next);
    }
    if (options.emptySequence) {
      const empty = structuredClone(initial.sequences[0]);
      empty.id = "empty";
      empty.name = "空白序列";
      empty.clips = [];
      initial.sequences.push(empty);
    }
    let exportFailAt = options.exportFailAt ?? 0,
      exportHeldAt = options.exportHeldAt ?? 0,
      releaseExport;
    const exportAttempts = [];
    let stored = structuredClone(initial),
      storageRevision = 40,
      writeMode = "normal",
      releaseWrite;
    const writes = [],
      events = [],
      errors = [],
      exports = [],
      audioRequests = [],
      imageRequests = [];
    const session = await editor.EditorSession.open(
      {
        read: async () => ({ data: structuredClone(stored), revision: storageRevision }),
        backupLegacy: async () => {
          throw new Error("V2 must not enter legacy backup");
        },
        write: async (doc, base, label) => {
          writes.push({ doc: structuredClone(doc), base, label });
          events.push("write-start");
          if (writeMode === "hold")
            await new Promise((resolve) => {
              releaseWrite = resolve;
            });
          if (writeMode === "fail") throw new Error("磁盘暂时不可写");
          if (base !== storageRevision) throw new editor.EditorStorageConflictError("储存版本冲突");
          stored = structuredClone(doc);
          events.push("write-end");
          return { revision: ++storageRevision };
        },
      },
      { autosaveDelayMs: 0 },
    );
    let prepareAudio;
    if (options.audio)
      prepareAudio = (doc, sequenceId, signal) =>
        new Promise((resolve) => {
          const request = {
            documentId: doc.id,
            revision: doc.revision,
            sequenceId,
            signal,
            duration: editor.sequenceDuration(doc.sequences.find((s) => s.id === sequenceId)),
            resolve,
          };
          audioRequests.push(request);
        });
    const workspace = new editor.EditorWorkspace(document.querySelector("#workspace"), {
      layout: options.layout,
      session,
      resolveAsset: (assetId, signal) =>
        new Promise((resolve) => {
          imageRequests.push({ assetId, signal, resolve });
        }),
      prepareAudio,
      importMedia: () => {
        events.push("import");
        session.dispatch(
          [
            {
              type: "asset.add",
              asset: {
                id: "imported",
                name: "导入示例",
                kind: "demo",
                duration: 2 * 240000,
                width: 320,
                height: 180,
              },
            },
          ],
          session.getState().identity,
          "导入素材",
        );
      },
      exportSequence: async (doc, sequenceId, profile, signal) => {
        const attempt = {
          doc: structuredClone(doc),
          sequenceId,
          profile: structuredClone(profile),
          signal,
        };
        exportAttempts.push(attempt);
        if (exportAttempts.length === exportHeldAt)
          await new Promise((resolve) => {
            releaseExport = resolve;
          });
        if (exportAttempts.length === exportFailAt) {
          exportFailAt = 0;
          throw new Error("第二项任务提交失败，请重试剩余项");
        }
        events.push("export");
        exports.push({
          doc: structuredClone(doc),
          sequenceId,
          profile: structuredClone(profile),
          storedRevision: stored.revision,
        });
      },
      openProject: () => events.push("open"),
      newProject: () => events.push("new"),
      downloadProject: (doc) => events.push(`download:${doc.id}:${doc.revision}`),
      showSeparation: options.separation
        ? (sequenceId, clipId) => events.push(`separation:${sequenceId}:${clipId}`)
        : undefined,
      showProduction: (tab) => events.push(`production:${tab}`),
      onError: (error) => errors.push(String(error)),
    });
    globalThis.fixture = {
      read: () => session.read(),
      addAsset: (assetId, placement) => workspace.addAsset(assetId, placement),
      state: () => session.getState(),
      stored: () => structuredClone(stored),
      writes,
      events,
      errors,
      exports,
      exportAttempts: () =>
        exportAttempts.map(({ doc, sequenceId, profile, signal }) => ({
          doc,
          sequenceId,
          profile,
          aborted: signal?.aborted ?? false,
        })),
      releaseExport: () => {
        const release = releaseExport;
        releaseExport = undefined;
        exportHeldAt = 0;
        release?.();
      },
      imageRequests: () =>
        imageRequests.map(({ assetId, signal }) => ({ assetId, aborted: signal.aborted })),
      resolveImage: (index) =>
        imageRequests[index].resolve(
          "data:image/svg+xml," +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="red"/></svg>',
            ),
        ),
      pendingPicture: () =>
        session.dispatch(
          [
            {
              type: "asset.add",
              asset: {
                id: "pending-image",
                name: "待解码图片",
                kind: "image",
                duration: 0,
                width: 320,
                height: 180,
                resourceId: "authorized-image",
              },
            },
            {
              type: "clip.update",
              sequenceId: "main",
              clipId: "a",
              patch: {
                assetId: "pending-image",
                timeMap: {
                  points: [
                    { time: 0, source: 0 },
                    { time: duration, source: 0 },
                  ],
                },
              },
            },
          ],
          session.getState().identity,
          "载入图片",
        ),
      writeMode: (mode) => {
        writeMode = mode;
      },
      releaseWrite: () => {
        writeMode = "normal";
        const release = releaseWrite;
        releaseWrite = undefined;
        release?.();
      },
      audio: () =>
        audioRequests.map(({ documentId, revision, sequenceId, signal, disposed }) => ({
          documentId,
          revision,
          sequenceId,
          aborted: signal.aborted,
          disposed: disposed ?? 0,
        })),
      resolveAudio: (index, stream = false) => {
        const request = audioRequests[index];
        request.resolve({
          documentId: request.documentId,
          revision: request.revision,
          sequenceId: request.sequenceId,
          ...(stream
            ? {
                stream: {
                  sampleRate: 48000,
                  numberOfChannels: 2,
                  sampleCount: (request.duration / 240000) * 48000,
                  read: async (_start, count) => [new Float32Array(count), new Float32Array(count)],
                  dispose: () => {
                    request.disposed = (request.disposed ?? 0) + 1;
                  },
                },
              }
            : {
                buffer: new AudioBuffer({
                  length: (request.duration / 240000) * 48000,
                  numberOfChannels: 2,
                  sampleRate: 48000,
                }),
              }),
        });
      },
      externalEdit: () =>
        session.dispatch(
          [{ type: "project.rename", name: `外部编辑 ${session.read().revision}` }],
          session.getState().identity,
          "外部编辑",
          "agent",
        ),
      replaceProject: async () => {
        const next = session.read();
        next.id = "replacement-document";
        await session.replace(next, { identity: session.getState().identity });
      },
      flush: () => session.flush(),
      hide: () => workspace.setVisible(false),
      show: () => workspace.setVisible(true),
      dispose: () => workspace.dispose(),
    };
  }, options);
  await page.waitForFunction(
    () =>
      document.querySelector("[data-ew-canvas]").width === 320 &&
      document.querySelector("[data-ew-save]").textContent === "已保存",
  );
  await settle(page);
  return page;
}
const action = (page, value) => page.locator(`[data-ew-action="${value}"]`);
const documentState = (page) => page.evaluate(() => fixture.read());
const clip = (page, id = "a") => page.locator(`[data-et-clip="${id}"]`);

test("separation opens only the selected real media and stops pending preview without changing the project", async (t) => {
  const page = await fixture(t, { audio: true, separation: true }),
    before = await documentState(page);
  await action(page, "separate").click();
  assert.match((await page.evaluate(() => fixture.errors)).at(-1), /选择一个/);
  await clip(page).click();
  await action(page, "separate").click();
  assert.match((await page.evaluate(() => fixture.errors)).at(-1), /真实/);
  await clip(page, "sound").click();
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await action(page, "separate").click();
  assert.ok((await page.evaluate(() => fixture.events)).includes("separation:main:sound"));
  assert.equal((await page.evaluate(() => fixture.audio()))[0].aborted, true);
  assert.deepEqual(await documentState(page), before);
  assert.equal((await page.evaluate(() => fixture.state())).canUndo, false);
});
const settle = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const semantic = ({ revision, ...doc }) => doc;
async function commitInput(input, value) {
  await input.fill(String(value));
  await input.press("Tab");
}
async function saveDialog(page) {
  await page.locator("dialog button[type=submit]").click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await settle(page);
}

// All edits and persistence in this file use the actual EditorSession; no duplicated UI document exists.
test("workspace imports into its session and adds asset plus required track as one undoable edit", async (t) => {
  const page = await fixture(t);
  await action(page, "import").click();
  const imported = await documentState(page);
  assert.equal(imported.assets.at(-1).id, "imported");
  await page.locator('[data-ew-asset="imported"]').click();
  const added = await documentState(page),
    sequence = added.sequences[0];
  assert.equal(added.revision, imported.revision + 1);
  assert.equal(sequence.tracks.length, 4, "An overlapping picture gets a new video track");
  assert.equal(sequence.clips.at(-1).assetId, "imported");
  assert.equal(await clip(page, sequence.clips.at(-1).id).getAttribute("aria-selected"), "true");
  await action(page, "undo").click();
  assert.deepEqual(semantic(await documentState(page)), semantic(imported));
  await page.getByRole("searchbox", { name: "搜索素材" }).fill("导入");
  assert.equal(await page.locator("[data-ew-asset]").count(), 1);
  assert.equal(await page.locator("[data-ew-asset]").getAttribute("data-ew-asset"), "imported");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("material drops use the actual target track and snapped time, with atomic overlap and kind rejection", async (t) => {
  const page = await fixture(t, { audio: true });
  const initial = await documentState(page);
  const drop = (assetId, trackId, seconds) =>
    page.evaluate(
      ({ assetId, trackId, seconds }) => {
        const lane = document.querySelector(`[data-et-lane="${trackId}"]`);
        const viewport = document.querySelector(".et-scroll");
        const rect = viewport.getBoundingClientRect();
        const transfer = new DataTransfer();
        transfer.setData("text/plain", JSON.stringify({ assetId }));
        lane.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
            clientX: rect.left + seconds * 64 - viewport.scrollLeft,
            clientY: lane.getBoundingClientRect().top + 20,
          }),
        );
      },
      { assetId, trackId, seconds },
    );
  await drop("demo", "video", 5);
  await settle(page);
  const added = await documentState(page);
  assert.equal(added.revision, initial.revision + 1);
  assert.equal(added.sequences[0].tracks.length, initial.sequences[0].tracks.length);
  assert.equal(added.sequences[0].clips.at(-1).start, 5 * 240000);
  assert.equal(added.sequences[0].clips.at(-1).trackId, "video");
  await drop("demo", "video", 5);
  assert.match((await page.evaluate(() => fixture.errors)).at(-1), /已有片段/);
  assert.deepEqual(await documentState(page), added);
  await drop("audio", "video", 10);
  assert.match((await page.evaluate(() => fixture.errors)).at(-1), /类型/);
  assert.deepEqual(await documentState(page), added);
  await page.getByRole("button", { name: "锁定画面轨", exact: true }).click();
  const locked = await documentState(page);
  await drop("demo", "video", 10);
  assert.match((await page.evaluate(() => fixture.errors)).at(-1), /锁定/);
  assert.deepEqual(await documentState(page), locked);
  await action(page, "undo").click();
  await action(page, "undo").click();
  assert.deepEqual(semantic(await documentState(page)), semantic(initial));
});

test("explicit material placement validates missing targets and invalid time without changing the session", async (t) => {
  const page = await fixture(t);
  const before = await documentState(page);
  for (const placement of [
    { at: -1 },
    { at: 1.5 },
    { at: Number.MAX_SAFE_INTEGER },
    { trackId: "missing" },
    { trackId: "text" },
  ]) {
    const result = await page.evaluate((placement) => {
      try {
        fixture.addAsset("demo", placement);
        return "accepted";
      } catch (error) {
        return String(error);
      }
    }, placement);
    assert.notEqual(result, "accepted");
    assert.deepEqual(await documentState(page), before);
  }
});

test("embedded controls keep their handlers while containing legacy events and repeated visibility keeps audio preparation", async (t) => {
  const page = await fixture(t, { layout: "embedded", audio: true, separation: true });
  assert.equal(await page.locator(".editor-workspace-embedded").count(), 1);
  await page.locator(".ew-more summary").click();
  assert.equal(await page.locator('.ew-more [data-ew-action="title"]').count(), 1);
  assert.equal(await page.locator('.ew-more [data-ew-action="separate"]').count(), 1);
  await page.evaluate(() => {
    window.legacyClicks = 0;
    document.body.addEventListener("click", () => window.legacyClicks++);
  });
  await action(page, "title").click();
  assert.equal((await documentState(page)).sequences[0].clips.at(-1).kind, "text");
  assert.equal(await page.evaluate(() => window.legacyClicks), 0);
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await page.evaluate(() => {
    fixture.show();
    fixture.show();
  });
  assert.equal((await page.evaluate(() => fixture.audio()))[0].aborted, false);
  await page.evaluate(() => fixture.hide());
  assert.equal((await page.evaluate(() => fixture.audio()))[0].aborted, true);
});

test("title, rectangle and ellipse are real clips with a single undo for each addition", async (t) => {
  const page = await fixture(t);
  for (const [button, kind, shape] of [
    ["title", "text"],
    ["rectangle", "shape", "rectangle"],
    ["ellipse", "shape", "ellipse"],
  ]) {
    const before = await documentState(page);
    await action(page, button).click();
    const after = await documentState(page),
      added = after.sequences[0].clips.at(-1);
    assert.equal(after.revision, before.revision + 1);
    assert.equal(added.kind, kind);
    assert.equal(added.duration, 5 * 240000);
    if (shape) assert.equal(added.shape, shape);
    else assert.equal(added.text, "输入文字");
    assert.equal(await clip(page, added.id).getAttribute("aria-selected"), "true");
    await action(page, "undo").click();
    assert.deepEqual(semantic(await documentState(page)), semantic(before));
  }
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("Inspector property changes, undo and redo read the same session", async (t) => {
  const page = await fixture(t);
  await clip(page).click();
  await commitInput(page.getByLabel("水平位置（%）", { exact: true }), 25);
  assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, 0.25);
  await action(page, "undo").click();
  assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, 0);
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), "0");
  await action(page, "redo").click();
  assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, 0.25);
  await page.evaluate(() => fixture.flush());
  assert.deepEqual(await page.evaluate(() => fixture.stored()), await documentState(page));
});

test("new sequence is atomic, activates and edits canvas plus NTSC frame rate", async (t) => {
  const page = await fixture(t);
  const before = await documentState(page);
  await action(page, "new-sequence").click();
  await page.locator('dialog [name="name"]').fill("竖屏");
  await page.locator('dialog [name="width"]').fill("360");
  await page.locator('dialog [name="height"]').fill("640");
  await page.locator('dialog [name="rate"]').selectOption("30000/1001");
  await saveDialog(page);
  const doc = await documentState(page),
    created = doc.sequences.at(-1);
  assert.equal(doc.revision, before.revision + 1);
  assert.equal(doc.activeSequenceId, created.id);
  assert.equal(created.tracks.length, 3);
  assert.deepEqual(created.frameRate, { numerator: 30000, denominator: 1001 });
  await page.waitForFunction(
    () =>
      document.querySelector("canvas").width === 360 &&
      document.querySelector("canvas").height === 640,
  );
  assert.equal(await page.locator("[data-ew-fps]").textContent(), "29.97 fps");
  await action(page, "undo").click();
  assert.deepEqual(semantic(await documentState(page)), semantic(before));
  await action(page, "redo").click();
  await page.getByLabel("当前序列", { exact: true }).selectOption("main");
  assert.equal(await clip(page).count(), 1);
  const settingsBefore = await documentState(page);
  await action(page, "sequence-settings").click();
  await page.locator('dialog [name="name"]').fill("改名主序列");
  await page.locator('dialog [name="width"]').fill("640");
  await page.locator('dialog [name="height"]').fill("360");
  await page.locator('dialog [name="rate"]').selectOption("60000/1001");
  await saveDialog(page);
  const updated = (await documentState(page)).sequences[0];
  assert.equal(updated.name, "改名主序列");
  assert.deepEqual(updated.frameRate, { numerator: 60000, denominator: 1001 });
  await action(page, "undo").click();
  assert.deepEqual(semantic(await documentState(page)), semantic(settingsBefore));
});

test("seek and marker use the visible frame-aligned timeline position", async (t) => {
  const page = await fixture(t);
  const seek = page.getByRole("slider", { name: "播放位置", exact: true });
  await seek.focus();
  await seek.press("End");
  await settle(page);
  const time = Number(await seek.inputValue());
  assert.equal(time, 119 * 8000);
  await action(page, "marker").click();
  await page.getByRole("button", { name: "添加点标记", exact: true }).click();
  await page.getByLabel("标记名称", { exact: true }).fill("结尾检查");
  await page.getByLabel("标记备注", { exact: true }).fill("确认声音结束");
  await page.getByRole("button", { name: "添加标记", exact: true }).click();
  await settle(page);
  const marker = (await documentState(page)).sequences[0].markers[0];
  assert.equal(marker.time, time);
  assert.equal(marker.name, "结尾检查");
  assert.equal(marker.note, "确认声音结束");
  await action(page, "undo").click();
  assert.deepEqual((await documentState(page)).sequences[0].markers, []);
});

test("real demo preview plays, pauses, seeks, and a focused clip Space selects instead of playing", async (t) => {
  const page = await fixture(t);
  await action(page, "play").click();
  await page.waitForFunction(() => Number(document.querySelector("[data-ew-seek]").value) >= 24000);
  assert.equal(await action(page, "play").textContent(), "暂停");
  await action(page, "play").click();
  const paused = await page.locator("[data-ew-seek]").inputValue();
  await page.waitForTimeout(100);
  assert.equal(await page.locator("[data-ew-seek]").inputValue(), paused);
  const seek = page.getByRole("slider", { name: "播放位置", exact: true });
  await seek.focus();
  await seek.press("Home");
  await settle(page);
  assert.equal(await seek.inputValue(), "0");
  await clip(page).focus();
  await clip(page).press("Space");
  assert.equal(await clip(page).getAttribute("aria-selected"), "true");
  assert.equal(await action(page, "play").textContent(), "播放");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("autosave completion preserves selected DOM and an active timeline drag", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => fixture.writeMode("hold"));
  await commitInput(page.getByLabel("工程名称", { exact: true }), "等待保存测试");
  await page.waitForFunction(() => fixture.state().saveState === "saving");
  await clip(page).click();
  await page.locator("[data-et-snap]").uncheck();
  const before = await documentState(page),
    original = await clip(page).elementHandle(),
    box = await clip(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 64, box.y + box.height / 2, { steps: 4 });
  await page.evaluate(() => fixture.releaseWrite());
  await page.waitForFunction(() => fixture.state().saveState === "saved");
  assert.equal(
    await original.evaluate(
      (element) => element.isConnected && element === document.querySelector('[data-et-clip="a"]'),
    ),
    true,
  );
  assert.equal(await clip(page).getAttribute("aria-selected"), "true");
  await page.mouse.up();
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 1);
  assert.ok(
    after.sequences[0].clips[0].start > 0,
    "The gesture still commits after a save-state notification",
  );
  await action(page, "undo").click();
  assert.deepEqual(semantic(await documentState(page)), semantic(before));
});

test("failed autosave exposes retry and retains the edited session until persistence succeeds", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => fixture.writeMode("fail"));
  await commitInput(page.getByLabel("工程名称", { exact: true }), "保留的编辑");
  await page.waitForFunction(() => fixture.state().saveState === "failed");
  assert.equal(await page.locator("[data-ew-save]").textContent(), "保存失败");
  assert.equal((await documentState(page)).name, "保留的编辑");
  const revision = (await documentState(page)).revision;
  await page.evaluate(() => fixture.writeMode("normal"));
  await action(page, "retry-save").click();
  await page.waitForFunction(() => fixture.state().saveState === "saved");
  assert.equal((await documentState(page)).revision, revision);
  assert.equal(await page.evaluate(() => fixture.stored().name), "保留的编辑");
  assert.equal(await action(page, "retry-save").isVisible(), false);
});

test("cancelled native audio completion never plays or contaminates the next preparation", async (t) => {
  const page = await fixture(t, { audio: true });
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  assert.equal(await action(page, "play").textContent(), "取消声音准备");
  await action(page, "play").click();
  assert.equal(await page.evaluate(() => fixture.audio()[0].aborted), true);
  await page.evaluate(() => fixture.resolveAudio(0));
  await settle(page);
  assert.equal(await action(page, "play").textContent(), "播放");
  assert.equal(await page.locator("[data-ew-seek]").inputValue(), "0");
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 2);
  await page.evaluate(() => fixture.resolveAudio(1));
  await page.waitForFunction(
    () => document.querySelector('[data-ew-action="play"]').textContent === "暂停",
  );
  await action(page, "play").click();
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("workspace releases abandoned streamed readers and retains a paused current reader until the next edit", async (t) => {
  const page = await fixture(t, { audio: true });
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await action(page, "play").click();
  await page.evaluate(() => fixture.resolveAudio(0, true));
  await page.waitForFunction(() => fixture.audio()[0].disposed === 1);
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 2);
  await page.evaluate(() => fixture.resolveAudio(1, true));
  await page.waitForFunction(
    () => document.querySelector('[data-ew-action="play"]').textContent === "暂停",
  );
  await action(page, "play").click();
  assert.equal(await page.evaluate(() => fixture.audio()[1].disposed), 0);
  await page.evaluate(() => fixture.externalEdit());
  assert.equal(await page.evaluate(() => fixture.audio()[1].disposed), 1);
  await page.evaluate(() => fixture.dispose());
  assert.equal(await page.evaluate(() => fixture.audio()[1].disposed), 1);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("disposing a workspace releases a current streamed reader and a late preparation reader", async (t) => {
  for (const late of [false, true]) {
    const page = await fixture(t, { audio: true });
    await action(page, "play").click();
    await page.waitForFunction(() => fixture.audio().length === 1);
    if (!late) {
      await page.evaluate(() => fixture.resolveAudio(0, true));
      await page.waitForFunction(
        () => document.querySelector('[data-ew-action="play"]').textContent === "暂停",
      );
    }
    await page.evaluate(() => fixture.dispose());
    if (late) await page.evaluate(() => fixture.resolveAudio(0, true));
    await page.waitForFunction(() => fixture.audio()[0].disposed === 1);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  }
});

test("a stale audio request resolving after its replacement cannot cancel or replace the current request", async (t) => {
  const page = await fixture(t, { audio: true });
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await page.evaluate(() => fixture.externalEdit());
  await settle(page);
  assert.equal(await page.evaluate(() => fixture.audio()[0].aborted), true);
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 2);
  await page.evaluate(() => fixture.resolveAudio(0));
  await settle(page);
  assert.equal(await action(page, "play").textContent(), "取消声音准备");
  assert.equal(await page.locator("[data-ew-seek]").inputValue(), "0");
  assert.equal(await page.evaluate(() => fixture.audio()[1].aborted), false);
  await page.evaluate(() => fixture.resolveAudio(1));
  await page.waitForFunction(
    () => document.querySelector('[data-ew-action="play"]').textContent === "暂停",
  );
  assert.equal(
    await page.evaluate(() => fixture.audio()[1].revision),
    (await documentState(page)).revision,
  );
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("hiding and disposing the workspace cancels native audio and ignores late completion", async (t) => {
  const page = await fixture(t, { audio: true });
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await page.evaluate(() => fixture.hide());
  await page.evaluate(() => fixture.resolveAudio(0));
  await settle(page);
  assert.equal(await page.evaluate(() => fixture.audio()[0].aborted), true);
  await page.evaluate(() => fixture.show());
  await settle(page);
  assert.equal(await action(page, "play").textContent(), "播放");
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 2);
  await page.evaluate(() => fixture.dispose());
  await page.evaluate(() => fixture.resolveAudio(1));
  await settle(page);
  assert.equal(await page.evaluate(() => fixture.audio()[1].aborted), true);
  assert.equal(await page.locator("#workspace").innerHTML(), "");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("export dialog passes its real profile and a durably saved current sequence to the adapter", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => fixture.writeMode("hold"));
  await commitInput(page.getByLabel("工程名称", { exact: true }), "导出测试");
  await page.waitForFunction(() => fixture.state().saveState === "saving");
  await action(page, "export").click();
  await page.locator('dialog [name="width"]').fill("640");
  await page.locator('dialog [name="height"]').fill("360");
  await page.locator('dialog [name="rate"]').selectOption("30000/1001");
  await page.locator('dialog [name="format"]').selectOption("webm:vp9:opus");
  await page.locator('dialog [name="quality"]').fill("73");
  await page.locator('dialog [name="captions"]').uncheck();
  await page.locator("dialog button[type=submit]").click();
  assert.equal(await page.locator("dialog button[type=submit]").isDisabled(), true);
  assert.equal(await page.evaluate(() => fixture.exports.length), 0);
  await page.evaluate(() => fixture.releaseWrite());
  await page.locator("dialog").waitFor({ state: "detached" });
  const exported = await page.evaluate(() => fixture.exports[0]);
  assert.equal(exported.sequenceId, "main");
  assert.deepEqual(exported.doc, await documentState(page));
  assert.equal(exported.storedRevision, exported.doc.revision);
  assert.deepEqual(
    {
      width: exported.profile.width,
      height: exported.profile.height,
      frameRate: exported.profile.frameRate,
      container: exported.profile.container,
      videoCodec: exported.profile.videoCodec,
      audioCodec: exported.profile.audioCodec,
      audioBitrate: exported.profile.audioBitrate,
      quality: exported.profile.quality,
      includeCaptions: exported.profile.includeCaptions,
    },
    {
      width: 640,
      height: 360,
      frameRate: { numerator: 30000, denominator: 1001 },
      container: "webm",
      videoCodec: "vp9",
      audioCodec: "opus",
      audioBitrate: 192000,
      quality: { mode: "quality", value: 73 },
      includeCaptions: false,
    },
  );
  const events = await page.evaluate(() => fixture.events);
  assert.ok(events.indexOf("write-end") < events.indexOf("export"));
});

test("export refuses an edit that arrives while its save is awaiting completion", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => fixture.writeMode("hold"));
  await commitInput(page.getByLabel("工程名称", { exact: true }), "导出等待");
  await page.waitForFunction(() => fixture.state().saveState === "saving");
  await action(page, "export").click();
  await page.locator("dialog button[type=submit]").click();
  await page.evaluate(() => fixture.externalEdit());
  await page.evaluate(() => fixture.releaseWrite());
  await page.waitForFunction(() =>
    document.querySelector(".ew-form-error").textContent.includes("工程已变化"),
  );
  assert.equal(await page.evaluate(() => fixture.exports.length), 0);
  assert.equal(await page.locator("dialog button[type=submit]").isEnabled(), true);
  assert.equal(await page.evaluate(() => fixture.state().dirty), false);
});

test("project and production controls delegate without creating a second editable document", async (t) => {
  const page = await fixture(t);
  const before = await documentState(page);
  for (const name of [
    "new",
    "open",
    "download",
    "production",
    "captions",
    "voiceover",
    "recording",
    "roughcut",
  ])
    await action(page, name).click();
  assert.deepEqual(await page.evaluate(() => fixture.events), [
    "new",
    "open",
    "download:workspace-document:3",
    "production:ai",
    "production:captions",
    "production:voiceover",
    "production:recording",
    "production:roughcut",
  ]);
  assert.deepEqual(await documentState(page), before);
});

for (const width of [620, 390])
  test(`narrow ${width}px workspace keeps library, preview, inspector and timeline reachable`, async (t) => {
    const page = await fixture(t, { width });
    const bounds = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      main: document.querySelector(".ew-main").getBoundingClientRect().toJSON(),
      player: document.querySelector(".ew-player").getBoundingClientRect().toJSON(),
      canvas: document.querySelector("canvas").getBoundingClientRect().toJSON(),
    }));
    assert.ok(
      bounds.scroll <= width + 1,
      `Document spills horizontally: ${JSON.stringify(bounds)}`,
    );
    assert.ok(bounds.canvas.width >= 100 && bounds.canvas.height >= 100);
    await clip(page).click();
    await commitInput(page.getByLabel("水平位置（%）", { exact: true }), 20);
    assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, 0.2);
    await action(page, "rectangle").click();
    assert.equal((await documentState(page)).sequences[0].clips.at(-1).kind, "shape");
    await action(page, "export").click();
    const dialog = await page.locator("dialog").boundingBox();
    assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width);
    await page.locator("[data-ew-close]").click();
  });

test("a settings dialog opened before another edit refuses stale submission", async (t) => {
  const page = await fixture(t);
  await action(page, "sequence-settings").click();
  await page.locator('dialog [name="width"]').fill("640");
  await page.evaluate(() => fixture.externalEdit());
  const before = await documentState(page);
  await page.locator("dialog button[type=submit]").click();
  await page.waitForFunction(() =>
    document.querySelector(".ew-form-error").textContent.includes("工程已变化"),
  );
  assert.deepEqual(await documentState(page), before);
  await page.locator("[data-ew-close]").click();
});

test("many tracks remain reachable by real vertical scrolling inside the workspace timeline", async (t) => {
  const page = await fixture(t);
  for (let index = 0; index < 8; index++) await action(page, "rectangle").click();
  const doc = await documentState(page),
    last = doc.sequences[0].clips.find((clip) => clip.trackId === doc.sequences[0].tracks[0].id);
  const bounds = await page.evaluate(() => ({
    timeline: document.querySelector("[data-ew-timeline]").getBoundingClientRect().toJSON(),
    body: document.querySelector("[data-ew-timeline] .et-body").getBoundingClientRect().toJSON(),
  }));
  assert.ok(
    bounds.body.bottom <= bounds.timeline.bottom + 1,
    `Timeline scroll viewport extends outside its clipped workspace row: ${JSON.stringify(bounds)}`,
  );
  await page.mouse.move(
    bounds.body.x + bounds.body.width / 2,
    Math.min(bounds.body.bottom, bounds.timeline.bottom) - 30,
  );
  await page.mouse.wheel(0, 1500);
  await settle(page);
  const lastBox = await clip(page, last.id).boundingBox();
  assert.ok(
    lastBox.y >= bounds.body.y && lastBox.y + lastBox.height <= bounds.timeline.bottom,
    `The last track is physically visible after scrolling: ${JSON.stringify({ lastBox, bounds, scroll: await page.locator("[data-ew-timeline] .et-body").evaluate((e) => ({ top: e.scrollTop, height: e.clientHeight, full: e.scrollHeight })) })}`,
  );
  await page.mouse.click(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2);
  assert.equal(await clip(page, last.id).getAttribute("aria-selected"), "true");
});

test("disposing during picture preparation cancels seek and ignores a resolver completing late", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => fixture.pendingPicture());
  await page.waitForFunction(() => fixture.imageRequests().length === 1);
  await page.evaluate(() => fixture.dispose());
  assert.equal(await page.evaluate(() => fixture.imageRequests()[0].aborted), true);
  await page.evaluate(() => fixture.resolveImage(0));
  await settle(page);
  assert.equal(await page.locator("#workspace").innerHTML(), "");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("export bitrate inputs produce exact integer video and audio rates", async (t) => {
  const page = await fixture(t);
  await action(page, "export").click();
  await page.locator('dialog [name="qualityMode"]').selectOption("bitrate");
  assert.equal(await page.locator("[data-export-quality]").isVisible(), false);
  assert.equal(await page.locator('[name="quality"]').isDisabled(), true);
  assert.equal(await page.locator('[name="videoBitrate"]').isEnabled(), true);
  await page.locator('dialog [name="videoBitrate"]').fill("1.001");
  await page.locator('dialog [name="audioBitrate"]').fill("256");
  await page.locator('dialog [name="rate"]').selectOption("60000/1001");
  await saveDialog(page);
  const exported = await page.evaluate(() => fixture.exports[0]);
  assert.deepEqual(exported.profile.quality, { mode: "bitrate", bitsPerSecond: 1001000 });
  assert.equal(exported.profile.audioBitrate, 256000);
  assert.deepEqual(exported.profile.frameRate, { numerator: 60000, denominator: 1001 });
});

test("export controls enforce WebM audio limits and fixed PCM while restoring editable quality", async (t) => {
  const page = await fixture(t);
  await action(page, "export").click();
  await page.locator('dialog [name="qualityMode"]').selectOption("bitrate");
  await page.locator('dialog [name="format"]').selectOption("webm:vp9:opus");
  assert.equal(await page.locator('dialog [name="audioBitrate"]').getAttribute("max"), "510");
  await page.locator('dialog [name="format"]').selectOption("mov:prores:pcm");
  assert.equal(await page.locator('dialog [name="qualityMode"]').inputValue(), "quality");
  assert.equal(
    await page
      .locator('dialog [name="qualityMode"] option[value="bitrate"]')
      .evaluate((element) => element.disabled),
    true,
  );
  assert.equal(await page.locator('dialog [name="audioBitrate"]').isDisabled(), true);
  assert.equal(await page.locator("[data-export-pcm]").isVisible(), true);
  assert.equal(await page.locator('dialog [name="quality"]').isEnabled(), true);
  await page.locator('dialog [name="quality"]').fill("88");
  await saveDialog(page);
  const exported = await page.evaluate(() => fixture.exports[0]);
  assert.equal(exported.profile.audioBitrate, 1536000);
  assert.equal(exported.profile.audioCodec, "pcm");
  assert.deepEqual(exported.profile.quality, { mode: "quality", value: 88 });
});

test("project export presets save, reload every setting and delete through the actual session", async (t) => {
  const page = await fixture(t);
  await action(page, "export").click();
  await page.locator('dialog [name="presetName"]').fill("竖屏 WebM · 发送版");
  await page.locator('dialog [name="width"]').fill("360");
  await page.locator('dialog [name="height"]').fill("640");
  const availableRates = await page
    .locator('dialog [name="rate"] option')
    .evaluateAll((options) => options.map((option) => option.value));
  for (const rate of [
    "24/1",
    "25/1",
    "30/1",
    "48/1",
    "50/1",
    "60/1",
    "24000/1001",
    "30000/1001",
    "60000/1001",
  ])
    assert.ok(availableRates.includes(rate), `Missing export rate ${rate}`);
  await page.locator('dialog [name="rate"]').selectOption("24000/1001");
  await page.locator('dialog [name="format"]').selectOption("webm:vp9:opus");
  await page.locator('dialog [name="qualityMode"]').selectOption("bitrate");
  await page.locator('dialog [name="videoBitrate"]').fill("8.125");
  await page.locator('dialog [name="audioBitrate"]').fill("128");
  await page.locator('dialog [name="captions"]').uncheck();
  await page.locator("[data-save-export-preset]").click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await page.evaluate(() => fixture.flush());
  const profiles = (await documentState(page)).exportProfiles;
  assert.equal(profiles.length, 1);
  const profile = profiles[0];
  assert.equal(profile.name, "竖屏 WebM · 发送版");
  assert.deepEqual(profile.quality, { mode: "bitrate", bitsPerSecond: 8125000 });
  assert.deepEqual(await page.evaluate(() => fixture.stored().exportProfiles), profiles);
  assert.equal(await page.evaluate(() => fixture.exports.length), 0);
  await action(page, "export").click();
  assert.equal(await page.locator("[data-remove-export-preset]").isDisabled(), true);
  await page.locator('dialog [name="preset"]').selectOption(profile.id);
  for (const [name, value] of Object.entries({
    presetName: profile.name,
    width: "360",
    height: "640",
    rate: "24000/1001",
    format: "webm:vp9:opus",
    qualityMode: "bitrate",
    videoBitrate: "8.125",
    audioBitrate: "128",
  }))
    assert.equal(await page.locator(`dialog [name="${name}"]`).inputValue(), value);
  assert.equal(await page.locator('dialog [name="captions"]').isChecked(), false);
  assert.equal(await page.locator("[data-remove-export-preset]").isEnabled(), true);
  await page.locator("[data-remove-export-preset]").click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await page.evaluate(() => fixture.flush());
  assert.deepEqual((await documentState(page)).exportProfiles, []);
  assert.deepEqual(await page.evaluate(() => fixture.stored().exportProfiles), []);
  await action(page, "export").click();
  assert.equal(
    await page.locator(`dialog [name="preset"] option[value="${profile.id}"]`).count(),
    0,
  );
  await page.locator("[data-ew-close]").click();
});

async function selectExportMatrix(page) {
  await action(page, "export").click();
  await page.locator('dialog [name="sequences"][value="sequence-2"]').check();
  await page.locator('dialog [name="custom"]').uncheck();
  await page.locator('dialog [name="profiles"][value="landscape-1080p"]').check();
  await page.locator('dialog [name="profiles"][value="portrait-1080p"]').check();
}
const exportMatrix = [
  ["main", "landscape-1080p"],
  ["main", "portrait-1080p"],
  ["sequence-2", "landscape-1080p"],
  ["sequence-2", "portrait-1080p"],
];

test("two sequences and two presets submit each combination once while empty sequences stay unavailable", async (t) => {
  const page = await fixture(t, { sequenceCount: 2, emptySequence: true });
  const snapshot = await documentState(page);
  await selectExportMatrix(page);
  assert.equal(await page.locator('dialog [name="sequences"][value="empty"]').isDisabled(), true);
  await saveDialog(page);
  const exports = await page.evaluate(() => fixture.exports);
  assert.deepEqual(
    exports.map((item) => [item.sequenceId, item.profile.id]),
    exportMatrix,
  );
  for (const item of exports) {
    assert.deepEqual(item.doc, snapshot);
    assert.equal(item.storedRevision, snapshot.revision);
  }
});

test("cancelling export while saving never starts a task and clears the pending submission", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => fixture.writeMode("hold"));
  await commitInput(page.getByLabel("工程名称", { exact: true }), "取消等待中的导出");
  await page.waitForFunction(() => fixture.state().saveState === "saving");
  await action(page, "export").click();
  await page.locator("dialog button[type=submit]").click();
  assert.equal(await page.locator("dialog button[type=submit]").isDisabled(), true);
  await page.locator("[data-ew-close]").click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await page.evaluate(() => fixture.releaseWrite());
  await page.waitForFunction(() => fixture.state().saveState === "saved");
  await settle(page);
  assert.equal(await page.evaluate(() => fixture.exportAttempts().length), 0);
  await action(page, "export").click();
  assert.equal(await page.locator("dialog").isVisible(), true);
  await page.locator("[data-ew-close]").click();
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("partial export failure retries remaining combinations from the original frozen document", async (t) => {
  const page = await fixture(t, { sequenceCount: 2, exportFailAt: 2 });
  const snapshot = await documentState(page);
  await selectExportMatrix(page);
  await page.locator("dialog button[type=submit]").click();
  await page.waitForFunction(() =>
    document.querySelector(".ew-form-error").textContent.includes("第二项任务提交失败"),
  );
  assert.equal(await page.evaluate(() => fixture.exports.length), 1);
  assert.equal(
    await page.locator("[data-export-settings]").evaluate((element) => element.disabled),
    true,
  );
  assert.match(await page.locator("[data-export-progress]").textContent(), /已提交 1\/4/);
  assert.equal(await page.locator("dialog button[type=submit]").isEnabled(), true);
  await page.evaluate(() => fixture.externalEdit());
  await page.evaluate(() => fixture.flush());
  await saveDialog(page);
  const result = await page.evaluate(() => ({
    accepted: fixture.exports,
    attempts: fixture.exportAttempts(),
  }));
  assert.deepEqual(
    result.accepted.map((item) => [item.sequenceId, item.profile.id]),
    exportMatrix,
  );
  assert.equal(result.attempts.length, 5);
  assert.deepEqual(
    result.attempts.slice(1, 3).map((item) => [item.sequenceId, item.profile.id]),
    [exportMatrix[1], exportMatrix[1]],
  );
  for (const item of result.attempts) assert.deepEqual(item.doc, snapshot);
  assert.notEqual((await documentState(page)).revision, snapshot.revision);
});

test("cancel remaining submissions keeps a late accepted receipt and starts no further combinations", async (t) => {
  const page = await fixture(t, { sequenceCount: 2, exportHeldAt: 1 });
  await selectExportMatrix(page);
  await page.locator("dialog button[type=submit]").click();
  await page.waitForFunction(() => fixture.exportAttempts().length === 1);
  assert.equal(await page.locator("[data-ew-close]").textContent(), "取消剩余提交");
  await page.locator("[data-ew-close]").click();
  await page.locator("dialog").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => fixture.exportAttempts()[0].aborted), true);
  await page.evaluate(() => fixture.releaseExport());
  await page.waitForFunction(() => fixture.exports.length === 1);
  await settle(page);
  assert.equal(await page.evaluate(() => fixture.exportAttempts().length), 1);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("export rejects an empty selection before any adapter call", async (t) => {
  const page = await fixture(t);
  await action(page, "export").click();
  await page.locator('dialog [name="sequences"][value="main"]').uncheck();
  await page.locator("dialog button[type=submit]").click();
  assert.match(await page.locator(".ew-form-error").textContent(), /序列/);
  assert.equal(await page.evaluate(() => fixture.exportAttempts().length), 0);
  await page.locator('dialog [name="sequences"][value="main"]').check();
  await page.locator('dialog [name="custom"]').uncheck();
  await page.locator("dialog button[type=submit]").click();
  assert.match(await page.locator(".ew-form-error").textContent(), /预设/);
  assert.equal(await page.evaluate(() => fixture.exportAttempts().length), 0);
  await page.locator("[data-ew-close]").click();
});

for (const width of [620, 390])
  test(`long export form at ${width}px keeps bitrate fields and bottom actions inside its scrollable dialog`, async (t) => {
    const page = await fixture(t, { width, sequenceCount: 3, emptySequence: true });
    await action(page, "export").click();
    await page.locator('dialog [name="qualityMode"]').selectOption("bitrate");
    await page.locator('dialog [name="videoBitrate"]').fill("4.125");
    await page.locator('dialog [name="audioBitrate"]').fill("160");
    const bounds = await page.locator("dialog").evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect(),
        form = dialog.querySelector("form");
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: innerWidth,
        height: innerHeight,
        scrollWidth: dialog.scrollWidth,
        clientWidth: dialog.clientWidth,
        formScrollWidth: form.scrollWidth,
        formClientWidth: form.clientWidth,
      };
    });
    assert.ok(
      bounds.left >= 0 &&
        bounds.right <= bounds.width &&
        bounds.top >= 0 &&
        bounds.bottom <= bounds.height,
      JSON.stringify(bounds),
    );
    assert.ok(
      bounds.scrollWidth <= bounds.clientWidth + 1 &&
        bounds.formScrollWidth <= bounds.formClientWidth + 1,
      `Export fields overflow horizontally: ${JSON.stringify(bounds)}`,
    );
    for (const name of ["width", "height", "videoBitrate", "audioBitrate"]) {
      await page.locator(`dialog [name="${name}"]`).scrollIntoViewIfNeeded();
      const box = await page.locator(`dialog [name="${name}"]`).boundingBox();
      assert.ok(
        box.x >= bounds.left && box.x + box.width <= bounds.right,
        `${name} escapes the dialog: ${JSON.stringify(box)}`,
      );
    }
    await page.locator('dialog [name="sequences"][value="sequence-3"]').check();
    await page.locator('dialog [name="profiles"][value="portrait-1080p"]').check();
    await page.locator("dialog button[type=submit]").scrollIntoViewIfNeeded();
    await settle(page);
    const submit = await page.locator("dialog button[type=submit]").boundingBox(),
      cancel = await page.locator("[data-ew-close]").boundingBox();
    for (const box of [submit, cancel])
      assert.ok(
        box.y >= bounds.top &&
          box.y + box.height <= bounds.bottom &&
          box.x >= bounds.left &&
          box.x + box.width <= bounds.right,
        `Footer action escapes viewport: ${JSON.stringify(box)}`,
      );
    await page.screenshot({ path: join(tmpdir(), `video-studio-export-form-${width}.png`) });
    await page.locator("[data-ew-close]").click();
    assert.equal(await page.evaluate(() => fixture.exportAttempts().length), 0);
  });

test("manual visual edits preserve narration approval and timeline changes invalidate it in the same undo step", async (t) => {
  const page = await fixture(t, { narration: true });
  const before = await documentState(page);
  await clip(page, "a").click();
  await commitInput(page.getByLabel("水平位置（%）", { exact: true }), "15");
  await settle(page);
  let after = await documentState(page);
  assert.deepEqual(after.production, before.production);
  assert.equal(after.sequences[0].clips[0].transform.x, 0.15);
  await clip(page, "a").click();
  await page.keyboard.press("Delete");
  await settle(page);
  after = await documentState(page);
  assert.equal(after.sequences[0].clips.length, 0);
  assert.equal(after.production.narration.phase, "review");
  assert.equal(after.production.narration.captionBasis, "draft");
  assert.equal(after.production.narration.approvedFingerprint, undefined);
  assert.equal(after.production.narrationPreviousApproval.approvedFingerprint, "approved-original");
  await action(page, "undo").click();
  const restored = await documentState(page);
  assert.deepEqual(restored.production, before.production);
  assert.equal(restored.sequences[0].clips[0].transform.x, 0.15);
  await page.evaluate(() => fixture.flush());
  assert.deepEqual(await page.evaluate(() => fixture.stored()), restored);
});

test("range marker creation, timeline selection, exact tick retention, update and deletion share Session save and undo", async (t) => {
  const page = await fixture(t);
  const before = await documentState(page);
  await clip(page).click();
  await action(page, "marker").click();
  await page.getByRole("button", { name: "添加范围", exact: true }).click();
  assert.equal(await page.getByLabel("开始（秒）", { exact: true }).inputValue(), "0");
  assert.equal(await page.getByLabel("结束（秒）", { exact: true }).inputValue(), "4");
  await page.getByLabel("开始（秒）", { exact: true }).fill("0.0333666666666667");
  await page.getByLabel("结束（秒）", { exact: true }).fill("2.002");
  await page.getByLabel("标记名称", { exact: true }).fill("<审核片段>");
  await page.getByLabel("标记颜色", { exact: true }).fill("#abc8");
  await page.getByLabel("选择标记颜色", { exact: true }).fill("#112233");
  await page.getByLabel("标记备注", { exact: true }).fill("检查\n字幕和声音");
  await page.getByRole("button", { name: "添加标记", exact: true }).click();
  await settle(page);
  let doc = await documentState(page),
    marker = doc.sequences[0].markers[0];
  assert.equal(marker.time, 8008);
  assert.equal(marker.duration, 480480 - 8008);
  assert.deepEqual(doc.sequences[0].clips, before.sequences[0].clips);
  await page.evaluate(() => fixture.flush());
  assert.deepEqual((await page.evaluate(() => fixture.stored())).sequences[0].markers, [marker]);
  await page.locator(`[data-et-marker="${marker.id}"]`).click();
  assert.equal(
    await page.locator(`[data-et-marker="${marker.id}"]`).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), "<审核片段>");
  await page.getByLabel("标记名称", { exact: true }).fill("只改名称保留精度");
  await page.getByRole("button", { name: "保存标记", exact: true }).click();
  await settle(page);
  doc = await documentState(page);
  assert.equal(doc.sequences[0].markers[0].time, 8008);
  assert.equal(doc.sequences[0].markers[0].duration, marker.duration);
  assert.equal(doc.sequences[0].markers[0].color, "#11223388");
  await action(page, "undo").click();
  assert.deepEqual((await documentState(page)).sequences[0].markers, [marker]);
  await page.getByRole("button", { name: "删除标记", exact: true }).click();
  await settle(page);
  assert.deepEqual((await documentState(page)).sequences[0].markers, []);
  await action(page, "undo").click();
  assert.deepEqual((await documentState(page)).sequences[0].markers, [marker]);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});
test("range end must exceed start and a detached marker form cannot apply after another editor revision", async (t) => {
  const page = await fixture(t);
  await action(page, "marker").click();
  await page.getByRole("button", { name: "添加范围", exact: true }).click();
  await page.getByLabel("开始（秒）", { exact: true }).fill("2");
  await page.getByLabel("结束（秒）", { exact: true }).fill("1");
  await page.getByRole("button", { name: "添加标记", exact: true }).click();
  assert.match(await page.locator(".emarker-error").innerText(), /结束必须晚于开始/);
  assert.deepEqual((await documentState(page)).sequences[0].markers, []);
  await page.getByLabel("结束（秒）", { exact: true }).fill("3");
  const form = await page.locator(".emarker-form").elementHandle();
  await page.evaluate(() => fixture.externalEdit());
  const before = await documentState(page);
  await form.evaluate((form) =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.match((await page.evaluate(() => fixture.errors)).at(-1), /工程已变化/);
});
test("export dialog rejects a replacement generation even when the new project reuses the old revision", async (t) => {
  const page = await fixture(t);
  await action(page, "export").click();
  await page.evaluate(() => fixture.replaceProject());
  await page.locator('dialog [type="submit"]').click();
  await settle(page);
  assert.match(await page.locator(".ew-form-error").innerText(), /工程已变化/);
  assert.equal((await page.evaluate(() => fixture.exports)).length, 0);
});

for (const width of [390, 620])
  test(`range marker editor at ${width}px keeps controls within its pane`, async (t) => {
    const page = await fixture(t, { width });
    await action(page, "marker").click();
    await page.getByRole("button", { name: "添加范围", exact: true }).click();
    await page.getByLabel("标记名称", { exact: true }).fill("窄屏范围审核");
    await page.getByRole("button", { name: "添加标记", exact: true }).click();
    await page.locator(".editor-markers").scrollIntoViewIfNeeded();
    const bounds = await page.locator(".editor-markers").evaluate((root) => {
      const box = root.getBoundingClientRect();
      return [...root.querySelectorAll("input,textarea,select,button")].map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left - box.left, right: rect.right - box.right };
      });
    });
    assert.ok(bounds.every((item) => item.left >= -1 && item.right <= 1));
    if (width === 390)
      await page.screenshot({
        path: join(tmpdir(), "video-studio-markers-390.png"),
        fullPage: true,
      });
  });
test("missing font status stays separate from preview errors and clears after removing its text", async (t) => {
  const page = await fixture(t);
  await action(page, "title").click();
  await page.getByRole("tab", { name: "文字", exact: true }).click();
  const font = page.getByLabel("字体", { exact: true });
  await commitInput(font, "MissingMimiFont_987654321");
  const warning = page.locator("[data-ew-font-warning]");
  await page.waitForFunction(() => !document.querySelector("[data-ew-font-warning]").hidden);
  assert.match(await warning.innerText(), /MissingMimiFont_987654321/);
  assert.match(await warning.innerText(), /工程包.*字体/);
  assert.equal(await page.locator("[data-ew-preview-error]").isHidden(), true);
  await action(page, "undo").click();
  await settle(page);
  assert.equal(await warning.isHidden(), true);
});

test("changing only the selected marker invalidates a detached form without requiring a document edit", async (t) => {
  const page = await fixture(t);
  await action(page, "marker").click();
  for (const name of ["第一处", "第二处"]) {
    await page.getByRole("button", { name: "添加点标记", exact: true }).click();
    await page.getByLabel("标记名称", { exact: true }).fill(name);
    await page.getByRole("button", { name: "添加标记", exact: true }).click();
  }
  const doc = await documentState(page),
    [first, second] = doc.sequences[0].markers;
  await page.locator(`[data-emarker-id="${first.id}"]`).click();
  const old = await page.locator(".emarker-form").elementHandle();
  await page.getByLabel("标记名称", { exact: true }).fill("过期修改");
  await page.locator(`[data-emarker-id="${second.id}"]`).click();
  await old.evaluate((form) => form.dispatchEvent(new Event("submit", { cancelable: true })));
  await settle(page);
  assert.deepEqual(await documentState(page), doc);
  assert.match((await page.evaluate(() => fixture.errors)).at(-1), /标记选择已变化/);
});
