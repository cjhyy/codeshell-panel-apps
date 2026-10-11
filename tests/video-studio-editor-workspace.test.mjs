import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { touchInput } from "./helpers/video-studio-touch.mjs";

let browser, source, css;
before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        export { EditorWorkspace } from './apps/video-studio/src/editor/workspace-ui';
        export { EditorCaptionsUI } from './apps/video-studio/src/editor/captions-ui';
        export { createCaptionController } from './apps/video-studio/src/editor/caption-controller';
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
        "editor-captions.css",
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

test("holding workspace undo and redo continues through repeated timeline key events", async (t) => {
  const page = await fixture(t),
    initial = await documentState(page);
  await page.locator('[data-et-clip="a"]').click();
  await page.evaluate(() => {
    globalThis.historyKeys = [];
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key.toLowerCase() === "z")
          historyKeys.push({ repeat: event.repeat, redo: event.shiftKey });
      },
      true,
    );
  });
  await page.keyboard.down("Control");
  for (let index = 0; index < 3; index++) {
    await page.keyboard.down("ArrowRight");
    await settle(page);
  }
  await page.keyboard.up("ArrowRight");
  const moved = await documentState(page);
  assert.equal(moved.sequences[0].clips[0].start, 24000);
  for (let index = 0; index < 3; index++) {
    await page.keyboard.down("z");
    await settle(page);
  }
  await page.keyboard.up("z");
  assert.deepEqual((await documentState(page)).sequences, initial.sequences);
  await page.keyboard.down("Shift");
  for (let index = 0; index < 3; index++) {
    await page.keyboard.down("z");
    await settle(page);
  }
  await page.keyboard.up("z");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  assert.deepEqual((await documentState(page)).sequences, moved.sequences);
  assert.deepEqual(await page.evaluate(() => historyKeys), [
    { repeat: false, redo: false },
    { repeat: true, redo: false },
    { repeat: true, redo: false },
    { repeat: false, redo: true },
    { repeat: true, redo: true },
    { repeat: true, redo: true },
  ]);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

async function fixture(t, options = {}) {
  let page = await browser.newPage({ viewport: { width: options.width ?? 1240, height: 900 } });
  const ownerPage = page;
  const uncaught = [];
  page.setDefaultTimeout(4000);
  page.on("pageerror", (error) => uncaught.push(String(error)));
  t.after(async () => {
    await ownerPage.close();
    assert.deepEqual(uncaught, [], "The real workspace must not emit uncaught errors");
  });
  await page.route("http://127.0.0.1:41789/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><main id="workspace"></main></body></html>',
    }),
  );
  await page.goto("http://127.0.0.1:41789/workspace");
  if (options.sandbox) {
    await page.setContent(
      '<iframe sandbox="allow-scripts allow-downloads" style="width:1200px;height:880px"></iframe>',
    );
    await page.locator("iframe").evaluate((frame) => {
      frame.srcdoc =
        '<!doctype html><meta http-equiv="Content-Security-Policy" content="form-action \'none\'"><main id="workspace"></main>';
    });
    page = await (await page.locator("iframe").elementHandle()).contentFrame();
    await page.locator("#workspace").waitFor({ state: "attached" });
  }
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
    const duration = options.duration ?? 4 * 240000;
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
          frameRate: options.frameRate ?? { numerator: 30, denominator: 1 },
          background: "#000000",
          timelineMode: "free",
          tracks: options.textBelow
            ? [
                editor.createTrack("text", "text", "文字轨"),
                editor.createTrack("video", "video", "画面轨"),
                editor.createTrack("audio", "audio", "声音轨"),
              ]
            : [
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
    if (options.clipCount) {
      const template = structuredClone(initial.sequences[0]);
      initial.assets = [];
      initial.sequences = [];
      for (let offset = 0; offset < options.clipCount; offset += 2000) {
        const sequence = structuredClone(template);
        sequence.id = offset ? `large-${offset}` : "main";
        sequence.clips = Array.from(
          { length: Math.min(2000, options.clipCount - offset) },
          (_, index) => ({
            id: offset + index ? `shape-${offset + index}` : "a",
            kind: "shape",
            trackId: "video",
            label: "性能测试图形",
            start: index * 8000,
            duration: 8000,
            shape: "rectangle",
            fill: "#ff0000",
            stroke: "#00000000",
            strokeWidth: 0,
            ...visual(),
          }),
        );
        initial.sequences.push(sequence);
      }
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
      imageRequests = [],
      frameDownloads = [];
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
      prepareAudio = (doc, sequenceId, signal, onProgress) =>
        new Promise((resolve, reject) => {
          const request = {
            documentId: doc.id,
            revision: doc.revision,
            sequenceId,
            signal,
            duration: editor.sequenceDuration(doc.sequences.find((s) => s.id === sequenceId)),
            resolve,
            reject,
            onProgress,
          };
          audioRequests.push(request);
        });
    const workspace = new editor.EditorWorkspace(document.querySelector("#workspace"), {
      layout: options.layout,
      previewQuality: options.qualityPreference ? {
        load: () => options.holdQualityLoad ? new Promise((resolve) => globalThis.releaseQualityLoad = resolve) : options.savedQuality,
        save: (value) => {
          (globalThis.qualityChoices ??= []).push(value);
          if (options.failQualitySave) return Promise.reject(new Error("偏好存储不可用"));
        },
      } : undefined,
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
      exportSequence: async (doc, sequenceId, profile, signal, range) => {
        const attempt = {
          doc: structuredClone(doc),
          sequenceId,
          profile: structuredClone(profile),
          signal,
          range: structuredClone(range),
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
          range: structuredClone(range),
        });
      },
      openProject: () => events.push("open"),
      newProject: () => events.push("new"),
      downloadFrame: options.frameCapture ? (blob, name) => frameDownloads.push({ blob, name }) : undefined,
      downloadProject: (doc) => events.push(`download:${doc.id}:${doc.revision}`),
      showSeparation: options.separation
        ? (sequenceId, clipId) => events.push(`separation:${sequenceId}:${clipId}`)
        : undefined,
      showProduction: (tab) => events.push(`production:${tab}`),
      onError: (error) => errors.push(String(error)),
    });
    globalThis.fixture = {
      internals: { session, workspace },
      read: () => session.read(),
      refreshMedia: () => workspace.refreshMedia(),
      addAsset: (assetId, placement) => workspace.addAsset(assetId, placement),
      playhead: () => workspace.getPlayhead(),
      playing: () => workspace.playing,
      selection: () => workspace.getSelection().clipIds,
      dispatch: (operations, label) =>
        session.dispatch(operations, session.getState().identity, label),
      state: () => session.getState(),
      stored: () => structuredClone(stored),
      writes,
      frameDownloads,
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
      audioProgress: (index, message) => audioRequests[index].onProgress?.(message),
      rejectAudio: (index, message) => audioRequests[index].reject(new Error(message)),
      resolveAudio: (index, stream = false, stale = false, mix) => {
        const request = audioRequests[index];
        request.resolve({
          documentId: request.documentId,
          revision: stale ? request.revision - 1 : request.revision,
          sequenceId: request.sequenceId,
          ...(mix ? { mix: { sampleCount: (request.duration / 240000) * 48000, ...mix } } : {}),
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
      replaceGeneration: async (name) => {
        const next = session.read();
        if (name !== undefined) next.name = name;
        await session.replace(next, { identity: session.getState().identity });
      },
      flush: () => session.flush(),
      sourcePreview: (active) => workspace.setSourcePreview(active),
      hide: () => workspace.setVisible(false),
      show: () => workspace.setVisible(true),
      dispose: () => workspace.dispose(),
    };
  }, options);
  await page.waitForFunction(
    (scale) =>
      document.querySelector("[data-ew-canvas]").width === 320 * scale &&
      document.querySelector("[data-ew-save]").textContent === "已保存",
    options.qualityPreference && !options.holdQualityLoad && [0.5, 0.25].includes(options.savedQuality) ? options.savedQuality : 1,
  );
  await settle(page);
  return page;
}
const action = (page, value) => page.locator(`[data-ew-action="${value}"]`);
const documentState = (page) => page.evaluate(() => fixture.read());
const clip = (page, id = "a") => page.locator(`[data-et-clip="${id}"]`);

async function countSelectionBatchReads(page) {
  await page.evaluate(() => {
    const { session, workspace } = fixture.internals,
      read = session.read.bind(session),
      select = workspace.timeline.context.select;
    globalThis.selectionBatchReads = [];
    let count;
    session.read = () => {
      if (count !== undefined) count++;
      return read();
    };
    workspace.timeline.context.select = (ids) => {
      const previous = count;
      count = 0;
      try { return select(ids); }
      finally { selectionBatchReads.push(count); count = previous; }
    };
  });
}

for (const selected of ["same", "different"]) {
  test(`a real timeline press shares one detached read across ${selected} selection views`, async (t) => {
    const page = await fixture(t, { audio: true });
    await clip(page).click();
    await countSelectionBatchReads(page);
    const id = selected === "same" ? "a" : "sound", bounds = await clip(page, id).boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    assert.deepEqual(await page.evaluate(() => selectionBatchReads), [1]);
    assert.deepEqual(await page.evaluate(() => fixture.selection()), [id]);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timeline.drag), true);
    await page.mouse.move(bounds.x + bounds.width / 2 + 32, bounds.y + bounds.height / 2);
    await page.mouse.up(); await settle(page);
    assert.equal((await documentState(page)).sequences[0].clips.find((value) => value.id === id).start, 120000);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

for (const field of ["track", "inspector"]) {
  test(`a real timeline press shares its fresh selection read after finishing a ${field} draft`, async (t) => {
    const page = await fixture(t);
    await clip(page).click();
    const before = await documentState(page);
    if (field === "track") await page.locator('[data-et-track-name="video"]').fill("已提交的轨道名称");
    else await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    await countSelectionBatchReads(page);
    const bounds = await clip(page).boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down(); await settle(page);
    assert.deepEqual(await page.evaluate(() => selectionBatchReads), [1]);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timeline.drag), true);
    await page.mouse.up(); await settle(page);
    const after = await documentState(page);
    assert.equal(after.revision, before.revision + 1);
    if (field === "track") assert.equal(after.sequences[0].tracks[0].name, "已提交的轨道名称");
    else assert.equal(after.sequences[0].clips[0].transform.x, 0.25);
    await action(page, "undo").click();
    assert.deepEqual(semantic(await documentState(page)), semantic(before));
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

for (const boundary of ["revision", "generation", "sequence"]) {
  test(`a selection batch reads the actual document after a ${boundary} boundary`, async (t) => {
    const page = await fixture(t, { sequenceCount: 2 });
    await clip(page).click();
    if (boundary === "revision") await page.evaluate(() => fixture.externalEdit());
    if (boundary === "generation") await page.evaluate(() => fixture.replaceGeneration("新代际工程"));
    if (boundary === "sequence") await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "切换序列"));
    await settle(page); await countSelectionBatchReads(page);
    const expected = await documentState(page), bounds = await clip(page).boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
    assert.deepEqual(await page.evaluate(() => selectionBatchReads), [1]);
    const actual = await page.evaluate(() => {
      const workspace = fixture.internals.workspace, document = workspace.timing.context.read();
      return { id: document.id, revision: document.revision, name: document.name, sequenceId: workspace.getSelection().sequenceId, scope: !!workspace.viewReadScope };
    });
    assert.deepEqual(actual, { id: expected.id, revision: expected.revision, name: expected.name, sequenceId: expected.activeSequenceId, scope: false });
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("selection read sharing does not escape to public session reads or later microtasks", async (t) => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const { session, workspace } = fixture.internals, render = workspace.inspector.render.bind(workspace.inspector);
    let shared, isolated, later;
    workspace.inspector.render = () => {
      shared = workspace.inspector.context.read();
      const publicRead = session.read(); publicRead.name = "外部副本";
      isolated = publicRead !== shared && shared === workspace.timing.context.read() && shared.name !== publicRead.name;
      Promise.resolve().then(() => { later = workspace.inspector.context.read(); });
      render();
    };
    workspace.timeline.context.select(["a"]);
    workspace.inspector.render = render;
    await Promise.resolve();
    const outside = workspace.inspector.context.read();
    outside.name = "下一次读取";
    return { isolated, later: later !== shared, detached: outside !== later && session.read().name !== outside.name, scope: !!workspace.viewReadScope };
  });
  assert.deepEqual(result, { isolated: true, later: true, detached: true, scope: false });
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

for (const failure of ["read", "consumer"]) {
  test(`a selection ${failure} failure restores the synchronous read scope`, async (t) => {
    const page = await fixture(t);
    await page.evaluate((failure) => {
      const { session, workspace } = fixture.internals, read = session.read.bind(session),
        select = workspace.timeline.context.select, render = workspace.inspector.render.bind(workspace.inspector);
      workspace.timeline.context.select = (ids) => {
        workspace.timeline.context.select = select;
        if (failure === "read") session.read = () => { session.read = read; throw new Error("本次读取失败"); };
        else workspace.inspector.render = () => { workspace.inspector.render = render; throw new Error("本次渲染失败"); };
        return select(ids);
      };
    }, failure);
    const bounds = await clip(page).boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.up();
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.viewReadScope), false);
    assert.equal((await page.evaluate(() => fixture.errors)).length, 1);
    await countSelectionBatchReads(page);
    await page.mouse.down();
    assert.deepEqual(await page.evaluate(() => selectionBatchReads), [1]);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timeline.drag), true);
    await page.mouse.up();
  });
}

for (const reentry of ["dispatch", "selection", "time", "sequence", "dispose"]) {
  test(`a synchronous ${reentry} reentry cannot reuse the earlier selection document`, async (t) => {
    const page = await fixture(t, { audio: true, sequenceCount: 2 });
    const result = await page.evaluate((reentry) => {
      const { session, workspace } = fixture.internals, render = workspace.inspector.render.bind(workspace.inspector);
      let stale, fresh, remaining;
      workspace.inspector.render = () => {
        workspace.inspector.render = render;
        stale = workspace.inspector.context.read();
        if (reentry === "dispatch") fixture.dispatch([{ type: "clip.update", sequenceId: "main", clipId: "a", patch: { transform: { ...stale.sequences[0].clips[0].transform, x: 0.3 } } }], "同步编辑");
        if (reentry === "selection") workspace.timeline.context.select(["sound"]);
        if (reentry === "time") workspace.seek(240000, true);
        if (reentry === "sequence") fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "同步切换");
        if (reentry === "dispose") void workspace.dispose();
        fresh = workspace.timing.context.read();
        remaining = { revision: fresh.revision, selected: workspace.getSelection(), time: workspace.getPlayhead(), disposed: workspace.disposed };
        render();
      };
      workspace.timeline.context.select(["a"]);
      return { reused: fresh === stale, scope: !!workspace.viewReadScope, remaining, current: session.getState().identity };
    }, reentry);
    assert.equal(result.reused, false);
    assert.equal(result.scope, false);
    assert.equal(result.remaining.revision, result.current.revision);
    if (reentry === "selection") assert.deepEqual(result.remaining.selected.clipIds, ["sound"]);
    if (reentry === "time") assert.equal(result.remaining.time, 240000);
    if (reentry === "sequence") assert.equal(result.remaining.selected.sequenceId, "sequence-2");
    if (reentry === "dispose") assert.equal(result.remaining.disposed, true);
    if (reentry === "dispatch") assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, 0.3);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("a synchronous dispatch during the batch's initial read cannot install its old snapshot", async (t) => {
  const page = await fixture(t);
  const result = await page.evaluate(() => {
    const { session, workspace } = fixture.internals, read = session.read.bind(session), select = workspace.timeline.context.select;
    workspace.timeline.context.select = (ids) => {
      workspace.timeline.context.select = select;
      session.read = () => {
        session.read = read;
        const old = read();
        fixture.dispatch([{ type: "clip.update", sequenceId: "main", clipId: "a", patch: { transform: { ...old.sequences[0].clips[0].transform, x: 0.3 } } }], "读取时编辑");
        return old;
      };
      return select(ids);
    };
    const render = workspace.inspector.render.bind(workspace.inspector);
    let seen;
    workspace.inspector.render = () => {
      seen = workspace.inspector.context.read(); render();
    };
    workspace.timeline.context.select(["a"]);
    workspace.inspector.render = render;
    return { seen: seen.revision, current: session.getState().identity.revision, x: seen.sequences[0].clips[0].transform.x, scope: !!workspace.viewReadScope };
  });
  assert.deepEqual(result, { seen: result.current, current: result.current, x: 0.3, scope: false });
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), "30");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

async function focusedTimelineIntent(page, kind, release = true) {
  const node = kind === "fade" ? clip(page, "sound").locator('[data-et-fade="fadeIn"]')
    : kind === "trim" ? clip(page).locator('[data-et-edge="left"]')
    : kind === "seek" ? page.locator(".et-ruler") : clip(page, kind === "select-other" ? "sound" : "a"),
    bounds = await node.boundingBox(),
    point = { x: bounds.x + (kind === "seek" ? 32 : bounds.width / 2), y: bounds.y + bounds.height / 2 };
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  if (!["seek", "select-other"].includes(kind)) await page.mouse.move(point.x + 32, point.y, { steps: 4 });
  if (release) await page.mouse.up();
  await settle(page);
  return point;
}
for (const kind of ["select-other", "drag", "trim", "seek", "fade"]) {
  test(`a focused inspector draft completes before the first timeline ${kind} and retains separate undo`, async (t) => {
    const page = await fixture(t, { audio: true });
    await page.evaluate((kind) => fixture.internals.workspace.selectClips("main", [kind === "fade" ? "sound" : "a"]), kind);
    const before = await documentState(page), label = kind === "fade" ? "音量（%）" : "水平位置（%）";
    await page.getByLabel(label, { exact: true }).fill(kind === "fade" ? "35" : "25");
    await focusedTimelineIntent(page, kind);
    const after = await documentState(page), a = after.sequences[0].clips[0], sound = after.sequences[0].clips[1],
      editsTimeline = ["drag", "trim", "fade"].includes(kind);
    assert.equal(after.revision, before.revision + 1 + Number(editsTimeline));
    if (kind === "fade") { assert.equal(sound.audio.volume, 0.35); assert.equal(sound.audio.fadeIn, 120000); }
    else assert.equal(a.transform.x, 0.25);
    assert.equal(a.start, ["drag", "trim"].includes(kind) ? 120000 : 0);
    assert.equal(a.duration, kind === "trim" ? before.sequences[0].clips[0].duration - 120000 : before.sequences[0].clips[0].duration);
    assert.equal(await page.evaluate(() => fixture.playhead()), kind === "seek" ? 120000 : 0);
    assert.deepEqual(await page.evaluate(() => fixture.selection()), kind === "select-other" || kind === "fade" ? ["sound"] : ["a"]);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
    if (editsTimeline) {
      await action(page, "undo").click(); await settle(page);
      const firstUndo = await documentState(page);
      assert.equal(firstUndo.sequences[0].clips[0].start, 0);
      assert.equal(firstUndo.sequences[0].clips[1].audio.fadeIn, 0);
      assert.equal(kind === "fade" ? firstUndo.sequences[0].clips[1].audio.volume : firstUndo.sequences[0].clips[0].transform.x,
        kind === "fade" ? 0.35 : 0.25);
    }
    await action(page, "undo").click(); await settle(page);
    assert.deepEqual((await documentState(page)).sequences, before.sequences);
  });
}
for (const [kind, label, value] of [["drag", "水平位置（%）", "1001"], ["fade", "音量（%）", "401"]]) {
  test(`invalid inspector input blocks timeline ${kind} and retains a correctable draft`, async (t) => {
    const page = await fixture(t, { audio: true });
    await page.evaluate((kind) => fixture.internals.workspace.selectClips("main", [kind === "fade" ? "sound" : "a"]), kind);
    const before = await documentState(page), selected = await page.evaluate(() => fixture.selection());
    await page.getByLabel(label, { exact: true }).fill(value); await focusedTimelineIntent(page, kind);
    assert.deepEqual(await documentState(page), before);
    assert.deepEqual(await page.evaluate(() => fixture.selection()), selected);
    assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value);
    assert.equal((await page.evaluate(() => fixture.errors)).length, 1);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timeline.pendingTrackGesture || !!fixture.internals.workspace.timeline.drag), false);
    await page.getByLabel(label, { exact: true }).fill("25"); await focusedTimelineIntent(page, kind);
    assert.equal((await documentState(page)).revision, before.revision + 2);
  });
}
test("a rejected focused inspector apply cannot continue its captured timeline drag", async (t) => {
  const page = await fixture(t); await clip(page).click(); const before = await documentState(page);
  await page.evaluate(() => {
    fixture.internals.workspace.inspector.context.apply = () => new Promise((_resolve, reject) =>
      globalThis.rejectTimelineField = () => reject(new Error("属性应用失败")));
  });
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25"); await focusedTimelineIntent(page, "drag");
  await page.evaluate(() => rejectTimelineField()); await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), "25");
  assert.deepEqual(await page.evaluate(() => fixture.errors), ["Error: 属性应用失败"]);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timeline.pendingTrackGesture || !!fixture.internals.workspace.timeline.drag), false);
});
test("an awaited inspector field retains the first timeline release through a second physical click", async (t) => {
  const page = await fixture(t); await clip(page).click(); const before = await documentState(page);
  await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  const point = await focusedTimelineIntent(page, "drag");
  await page.mouse.click(point.x + 96, point.y); await releaseCanvasField(page);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2); assert.equal(after.sequences[0].clips[0].start, 120000);
  assert.equal(after.sequences[0].clips[0].transform.x, 0.25);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timeline.pendingTrackGesture || !!fixture.internals.workspace.timeline.drag), false);
});
for (const ending of ["escape", "blur", "generation", "revision", "seek", "selection", "resize", "dispose"]) {
  test(`an awaited inspector field cannot revive a timeline gesture after ${ending}`, async (t) => {
    const page = await fixture(t); await clip(page).click();
    await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    await focusedTimelineIntent(page, "drag", false);
    if (ending === "escape") {
      assert.equal(await page.locator("[data-ew-timeline]").evaluate((node) => node === document.activeElement), true);
      await page.keyboard.press("Escape");
    }
    if (ending === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (ending === "generation") await page.evaluate(() => fixture.replaceGeneration());
    if (ending === "revision") await page.evaluate(() => fixture.externalEdit());
    if (ending === "seek") await page.evaluate(() => fixture.internals.workspace.seek(240000));
    if (ending === "selection") await page.evaluate(() => fixture.internals.workspace.selectClips("main", []));
    if (ending === "resize") await page.setViewportSize({ width: 1100, height: 900 });
    if (ending === "dispose") await page.evaluate(() => fixture.dispose());
    await settle(page); const beforeRelease = await documentState(page);
    await page.mouse.up(); await releaseCanvasField(page);
    assert.deepEqual(await documentState(page), beforeRelease);
    assert.equal((await documentState(page)).sequences[0].clips[0].start, 0);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timeline.pendingTrackGesture || !!fixture.internals.workspace.timeline.drag), false);
  });
}
for (const replacement of ["selection", "time", "dispose"]) {
  test(`a synchronous timeline selection callback cannot revive its old drag after ${replacement}`, async (t) => {
    const page = await fixture(t, { audio: true });
    await page.evaluate((replacement) => {
      const workspace = fixture.internals.workspace, select = workspace.timeline.context.select;
      let once = false;
      workspace.timeline.context.select = (ids) => {
        select(ids);
        if (once) return;
        once = true;
        if (replacement === "selection") workspace.selectClips("main", ["sound"]);
        if (replacement === "time") void workspace.seek(240000);
        if (replacement === "dispose") workspace.dispose();
      };
    }, replacement);
    const before = await documentState(page); await focusedTimelineIntent(page, "drag");
    assert.deepEqual(await documentState(page), before);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timeline.pendingTrackGesture || !!fixture.internals.workspace.timeline.drag), false);
    if (replacement === "selection") assert.deepEqual(await page.evaluate(() => fixture.selection()), ["sound"]);
    if (replacement === "time") assert.equal(await page.evaluate(() => fixture.playhead()), 240000);
  });
}

// Exercise the native focus/change boundary through EditorWorkspace and EditorSession.
async function canvasDraftFixture(t, label, options = {}) {
  const page = await fixture(t, { ...(label === "图形填充颜色" ? { clipCount: 1 } : {}), ...options });
  await page.evaluate(() => {
    const clip = fixture.read().sequences[0].clips[0];
    fixture.dispatch([{ type: "clip.update", sequenceId: "main", clipId: "a",
      patch: { transform: { ...clip.transform, scaleX: 0.6, scaleY: 0.6 } } }], "画布测试设置");
    fixture.internals.workspace.selectClips("main", ["a"]);
  });
  await settle(page);
  return page;
}
async function canvasDrag(page, gesture = "move", release = true) {
  const handle = page.locator(`[data-canvas-handle="${gesture === "resize" ? "se" : gesture === "crop" ? "left" : "move"}"]`),
    bounds = await handle.boundingBox(), x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 40, y + (gesture === "resize" ? 25 : 0), { steps: 4 });
  if (release) await page.mouse.up();
  await settle(page);
  return { x, y };
}
const canvasDrafts = [undefined, ["水平位置（%）", "25"], ["不透明度（%）", "60"],
  ["曝光（档）", "1.5"], ["图形填充颜色", "#00ff00"], ["轨道名称 画面轨", "未提交轨道名"],
  ["画面轨 音量百分比", "37.5"]];
for (const draft of canvasDrafts) for (const gesture of ["move", "resize", "crop"]) {
  test(`the first canvas ${gesture} preserves ${draft?.[0] ?? "no managed draft"} and each undo`, async (t) => {
    const page = await canvasDraftFixture(t, draft?.[0]);
    if (gesture === "crop") await page.getByRole("button", { name: "画布裁切工具", exact: true }).click();
    if (draft?.[0] === "曝光（档）") await page.getByRole("tab", { name: "调色", exact: true }).click();
    if (draft) await page.getByLabel(draft[0], { exact: true }).fill(draft[1]);
    const before = await documentState(page), bounds = await page.evaluate(() => fixture.internals.workspace.canvasEditor.box);
    await canvasDrag(page, gesture);
    const after = await documentState(page), item = after.sequences[0].clips[0],
      track = after.sequences[0].tracks.find((item) => item.id === "video"),
      baseX = draft?.[0] === "水平位置（%）" ? 0.25 : 0;
    assert.equal(after.revision, before.revision + Number(!!draft) + 1);
    assert.ok(Math.abs(item.transform.x - baseX - (gesture === "move" ? 40 / bounds.width : 0)) < 1e-9);
    const scale = gesture === "resize" ? 0.6 * Math.hypot(bounds.width * 0.3 + 40, bounds.height * 0.3 + 25) /
      Math.hypot(bounds.width * 0.3, bounds.height * 0.3) : 0.6;
    assert.ok(Math.abs(item.transform.scaleX - scale) < 1e-4, "native SVG handle coordinates may round by a fraction of one pixel");
    assert.ok(Math.abs(item.transform.scaleY - scale) < 1e-4);
    assert.ok(Math.abs(item.transform.crop.left - (gesture === "crop" ? 40 / (bounds.width * 0.6) : 0)) < 1e-4);
    assert.equal(item.transform.opacity, draft?.[0] === "不透明度（%）" ? 0.6 : 1);
    assert.equal(item.color.exposure, draft?.[0] === "曝光（档）" ? 1.5 : 0);
    if (draft?.[0] === "图形填充颜色") assert.equal(item.fill, "#00ff00");
    assert.equal(track.name, draft?.[0].startsWith("轨道名称") ? draft[1] : "画面轨");
    assert.equal(track.volume, draft?.[0].includes("音量") ? 0.375 : 1);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
    await action(page, "undo").click(); await settle(page);
    const firstUndo = await documentState(page);
    assert.deepEqual(firstUndo.sequences[0].clips[0].transform, { ...before.sequences[0].clips[0].transform,
      x: baseX, opacity: draft?.[0] === "不透明度（%）" ? 0.6 : 1 });
    if (draft) { await action(page, "undo").click(); await settle(page); }
    assert.deepEqual((await documentState(page)).sequences, before.sequences);
  });
}
for (const [label, value, corrected] of [["水平位置（%）", "1001", "25"], ["不透明度（%）", "101", "60"],
  ["图形填充颜色", "invalid", "#00ff00"], ["画面轨 音量百分比", "401", "37.5"], ["轨道名称 画面轨", "", "已修正轨道"]]) {
  test(`an invalid ${label} blocks the canvas gesture and retains its correctable native value`, async (t) => {
    const page = await canvasDraftFixture(t, label), before = await documentState(page);
    await page.getByLabel(label, { exact: true }).fill(value);
    await canvasDrag(page);
    assert.deepEqual(await documentState(page), before);
    assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value);
    assert.equal(await page.getByLabel(label, { exact: true }).evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => fixture.errors.length), 1);
    await page.getByLabel(label, { exact: true }).fill(corrected);
    await canvasDrag(page);
    assert.equal((await documentState(page)).revision, before.revision + 2);
    assert.equal(await page.evaluate(() => fixture.errors.length), 1);
  });
}
for (const [label, composition] of [["轨道名称 画面轨", "真实输入轨道"], ["图形填充颜色", "#00ff00"]]) {
  test(`native IME ${label} finishes once before the first canvas gesture`, async (t) => {
    const page = await canvasDraftFixture(t, label), before = await documentState(page),
      input = page.getByLabel(label, { exact: true }), cdp = await page.context().newCDPSession(page);
    await input.fill("");
    await input.evaluate((node) => {
      globalThis.canvasCompositionStarts = []; globalThis.canvasCompositionEnds = [];
      node.addEventListener("compositionstart", (event) => canvasCompositionStarts.push(event.isTrusted));
      node.addEventListener("compositionend", (event) => canvasCompositionEnds.push(event.data));
    });
    await cdp.send("Input.imeSetComposition", { text: composition, selectionStart: composition.length, selectionEnd: composition.length });
    await canvasDrag(page);
    const after = await documentState(page);
    assert.equal(after.revision, before.revision + 2);
    assert.ok(after.sequences[0].clips[0].transform.x > 0.06);
    assert.equal(label.startsWith("轨道名称") ? after.sequences[0].tracks.find((track) => track.id === "video").name :
      after.sequences[0].clips[0].fill, composition);
    assert.deepEqual(await page.evaluate(() => canvasCompositionStarts), [true]);
    assert.deepEqual(await page.evaluate(() => canvasCompositionEnds), [composition]);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("an asynchronous rejected inspector edit retains its draft and never starts a canvas gesture", async (t) => {
  const page = await canvasDraftFixture(t), before = await documentState(page);
  await page.evaluate(() => {
    fixture.internals.workspace.inspector.context.apply = () => new Promise((_resolve, reject) => {
      globalThis.rejectCanvasField = () => reject(new Error("属性应用失败"));
    });
  });
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await canvasDrag(page);
  assert.deepEqual(await documentState(page), before);
  await page.evaluate(() => rejectCanvasField()); await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), "25");
  assert.deepEqual(await page.evaluate(() => fixture.errors), ["Error: 属性应用失败"]);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.gesture || !!fixture.internals.workspace.canvasEditor.pendingGesture), false);
});

async function holdCanvasField(page, owner = "inspector") {
  await page.evaluate((owner) => {
    const context = fixture.internals.workspace[owner].context, original = context.apply;
    globalThis.canvasFieldReleases = [];
    context.apply = (operations, label) => {
      original(operations, label);
      return new Promise((resolve) => canvasFieldReleases.push(resolve));
    };
  }, owner);
}
async function releaseCanvasField(page, index = 0) {
  await page.evaluate((index) => canvasFieldReleases[index](), index); await settle(page);
}
for (const [label, value, owner] of [["水平位置（%）", "25", "inspector"], ["画面轨 音量百分比", "37.5", "timeline"]]) {
  test(`an awaited ${label} keeps the first release and ignores a second physical click`, async (t) => {
    const page = await canvasDraftFixture(t), before = await documentState(page);
    await holdCanvasField(page, owner); await page.getByLabel(label, { exact: true }).fill(value);
    const { x, y } = await canvasDrag(page);
    assert.equal((await documentState(page)).revision, before.revision + 1);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.pendingGesture), true);
    await page.mouse.click(x + 80, y);
    await releaseCanvasField(page);
    const after = await documentState(page);
    assert.equal(after.revision, before.revision + 2);
    assert.ok(Math.abs(after.sequences[0].clips[0].transform.x - (owner === "inspector" ? 0.25 : 0) -
      40 / (await page.evaluate(() => fixture.internals.workspace.canvasEditor.box.width))) < 1e-9);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.pendingGesture || !!fixture.internals.workspace.canvasEditor.gesture), false);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}
for (const cancellation of ["Escape", "blur", "pointercancel", "lostcapture", "generation", "same-id-revision", "sequence",
  "time", "selection", "mode", "external-revision", "lock", "resize", "dispose"]) {
  test(`an awaited canvas field cancels its gesture on ${cancellation}`, async (t) => {
    const page = await canvasDraftFixture(t, undefined, { sequenceCount: 2 }), before = await documentState(page);
    await holdCanvasField(page);
    await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    await canvasDrag(page, "move", false);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.pendingGesture), true);
    if (cancellation === "Escape") await page.keyboard.press("Escape");
    if (cancellation === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (cancellation === "pointercancel") await page.evaluate(() => {
      const controls = fixture.internals.workspace.canvasEditor;
      controls.overlay.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: controls.pendingGesture.start.pointerId }));
    });
    if (cancellation === "lostcapture") await page.evaluate(() => {
      const controls = fixture.internals.workspace.canvasEditor;
      controls.overlay.releasePointerCapture(controls.pendingGesture.start.pointerId);
    });
    if (cancellation === "generation") await page.evaluate(() => fixture.replaceGeneration());
    if (cancellation === "same-id-revision") await page.evaluate(async (before) => {
      await fixture.internals.session.replace({ ...before, id: "temporary-canvas-document" });
      await fixture.internals.session.replace(before);
    }, before);
    if (cancellation === "sequence") await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "切换序列"));
    if (cancellation === "time") await page.evaluate(() => fixture.internals.workspace.seek(240000));
    if (cancellation === "selection") await page.evaluate(() => fixture.internals.workspace.selectClips("main", []));
    if (cancellation === "mode") await page.evaluate(() => document.querySelector('[data-canvas-mode="crop"]').click());
    if (cancellation === "external-revision") await page.evaluate(() => fixture.externalEdit());
    if (cancellation === "lock") await page.evaluate(() => fixture.dispatch([{ type: "track.update", sequenceId: "main", trackId: "video", patch: { locked: true } }], "外部锁轨"));
    if (cancellation === "resize") await page.setViewportSize({ width: 1100, height: 780 });
    if (cancellation === "dispose") await page.evaluate(() => fixture.dispose());
    await page.mouse.up(); await settle(page);
    const canceled = await documentState(page), selection = await page.evaluate(() => fixture.selection());
    await releaseCanvasField(page);
    assert.deepEqual(await documentState(page), canceled);
    assert.deepEqual(await page.evaluate(() => fixture.selection()), selection);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.pendingGesture || !!fixture.internals.workspace.canvasEditor.gesture), false);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("a late canceled canvas field cannot release a new pending capture with the same mouse pointer", async (t) => {
  const page = await canvasDraftFixture(t);
  await holdCanvasField(page, "timeline");
  await page.getByLabel("画面轨 音量百分比", { exact: true }).fill("37.5");
  await canvasDrag(page, "move", false); await page.keyboard.press("Escape"); await page.mouse.up();
  await page.getByLabel("画面轨 音量百分比", { exact: true }).fill("50");
  await canvasDrag(page, "move", false);
  await releaseCanvasField(page, 0);
  assert.equal(await page.evaluate(() => {
    const controls = fixture.internals.workspace.canvasEditor;
    return !!controls.pendingGesture && controls.overlay.hasPointerCapture(controls.pendingGesture.start.pointerId);
  }), true);
  await page.mouse.up(); await releaseCanvasField(page, 1);
  assert.ok((await documentState(page)).sequences[0].clips[0].transform.x > 0.06);
  assert.equal((await documentState(page)).sequences[0].tracks.find((track) => track.id === "video").volume, 0.5);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("native two-touch canvas input retains the primary release while its field awaits", async (t) => {
  const page = await canvasDraftFixture(t), input = await touchInput(page, ".editor-canvas-controls"),
    bounds = await page.locator('[data-canvas-handle="move"]').boundingBox(),
    first = { id: 1, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    second = { id: 2, x: first.x + 20, y: first.y + 20 }, before = await documentState(page);
  await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await input.send("touchStart", [first]); await input.send("touchStart", [first, second]);
  const [owner, secondary] = await input.ids();
  await page.evaluate((pointerId) => document.querySelector(".editor-canvas-controls").dispatchEvent(
    new PointerEvent("pointercancel", { bubbles: true, pointerId, pointerType: "touch" })), secondary);
  await input.send("touchMove", [{ ...first, x: first.x + 40 }, { ...second, x: second.x + 5 }]);
  await input.send("touchEnd", [{ ...second, x: second.x + 5 }]);
  assert.equal(await page.evaluate(() => fixture.internals.workspace.canvasEditor.pendingGesture.up === undefined), true);
  await input.send("touchEnd");
  assert.equal(await page.evaluate(() => fixture.internals.workspace.canvasEditor.pendingGesture.up.pointerId), owner);
  await releaseCanvasField(page); await input.assertNative();
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2);
  assert.ok(after.sequences[0].clips[0].transform.x > 0.31 && after.sequences[0].clips[0].transform.x < 0.32);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a canvas field and gesture retain actual autosave failure and retry without claiming persistence", async (t) => {
  const page = await canvasDraftFixture(t), before = await documentState(page);
  await page.evaluate(() => fixture.writeMode("fail"));
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25"); await canvasDrag(page);
  await page.waitForFunction(() => fixture.state().saveState === "failed");
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2);
  assert.ok(after.sequences[0].clips[0].transform.x > 0.31);
  assert.deepEqual((await page.evaluate(() => fixture.stored())).sequences, before.sequences);
  await page.evaluate(() => fixture.writeMode("normal")); await action(page, "retry-save").click();
  await page.waitForFunction(() => fixture.state().saveState === "saved");
  assert.deepEqual((await page.evaluate(() => fixture.stored())).sequences, after.sequences);
});

test("a position draft continues the original canvas target after another layer occupies the old hit point", async (t) => {
  const page = await canvasDraftFixture(t);
  await page.evaluate(() => {
    const a = fixture.read().sequences[0].clips[0];
    fixture.dispatch([
      { type: "track.add", sequenceId: "main", track: editor.createTrack("other-video", "video", "另一画面轨") },
      { type: "clip.add", sequenceId: "main", clip: { ...a, id: "b", trackId: "other-video",
        transform: { ...a.transform, scaleX: 0.4, scaleY: 0.4 } } },
    ], "添加另一画面");
    fixture.internals.workspace.selectClips("main", ["a"]);
  });
  await settle(page);
  const before = await documentState(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25"); await canvasDrag(page);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2);
  assert.ok(after.sequences[0].clips.find((clip) => clip.id === "a").transform.x > 0.31);
  assert.deepEqual(after.sequences[0].clips.find((clip) => clip.id === "b"), before.sequences[0].clips.find((clip) => clip.id === "b"));
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("an awaiting track field rejection blocks the canvas and remains correctable", async (t) => {
  const page = await canvasDraftFixture(t), before = await documentState(page);
  await page.evaluate(() => {
    fixture.internals.workspace.timeline.context.apply = () => new Promise((_resolve, reject) => {
      globalThis.rejectCanvasTrack = () => reject(new Error("轨道应用失败"));
    });
  });
  await page.getByLabel("画面轨 音量百分比", { exact: true }).fill("37.5"); await canvasDrag(page);
  await page.evaluate(() => rejectCanvasTrack()); await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.getByLabel("画面轨 音量百分比", { exact: true }).inputValue(), "37.5");
  assert.equal(await page.getByLabel("画面轨 音量百分比", { exact: true }).evaluate((node) => node === document.activeElement), true);
  assert.deepEqual(await page.evaluate(() => fixture.errors), ["Error: 轨道应用失败"]);
});

test("a stationary Alt change during a canvas field wait controls the resumed resize", async (t) => {
  const page = await canvasDraftFixture(t);
  await holdCanvasField(page); await page.getByLabel("不透明度（%）", { exact: true }).fill("60");
  await canvasDrag(page, "resize", false); await page.keyboard.down("Alt");
  await releaseCanvasField(page);
  const preview = await page.evaluate(() => fixture.internals.workspace.canvasEditor.target.layer.transform);
  assert.ok(Math.abs(preview.scaleX - preview.scaleY) > 0.01);
  await page.mouse.up(); await page.keyboard.up("Alt"); await settle(page);
  const transform = (await documentState(page)).sequences[0].clips[0].transform;
  assert.ok(Math.abs(transform.scaleX - transform.scaleY) > 0.01);
  assert.equal(transform.opacity, 0.6);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a canvas field wait rechecks current editing availability before starting its gesture", async (t) => {
  const page = await canvasDraftFixture(t);
  await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await canvasDrag(page);
  await page.evaluate(() => {
    fixture.internals.workspace.canvasEditor.context.assertEditable = () => { throw new Error("当前不能编辑"); };
  });
  const before = await documentState(page); await releaseCanvasField(page);
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), ["Error: 当前不能编辑"]);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.gesture || !!fixture.internals.workspace.canvasEditor.pendingGesture), false);
});

test("actual session replacement never commits focused track drafts into the successor", async (t) => {
  for (const [label, draft] of [
    ["轨道名称 画面轨", "旧工程轨道草稿"],
    ["画面轨 音量百分比", "37.5"],
    ["画面轨 声像", "-80"],
  ]) {
    const page = await fixture(t), before = await documentState(page), identity = await page.evaluate(() => fixture.state().identity);
    await page.getByLabel(label, { exact: true }).fill(draft);
    await page.evaluate(() => fixture.replaceGeneration());
    await settle(page);
    const after = await documentState(page);
    assert.deepEqual(after.sequences, before.sequences);
    assert.equal(after.revision, before.revision + 1);
    assert.notEqual((await page.evaluate(() => fixture.state().identity)).generation, identity.generation);
    assert.deepEqual(await page.evaluate(() => fixture.writes.map((write) => write.label)), ["打开工程"]);
    assert.equal(await page.evaluate(() => fixture.state().canUndo), false);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  }
});

test("a same-id same-revision reopened session rejects the previous track input draft", async (t) => {
  const page = await fixture(t), before = await documentState(page), identity = await page.evaluate(() => fixture.state().identity);
  await page.getByLabel("轨道名称 画面轨", { exact: true }).fill("旧草稿");
  const stale = await page.getByLabel("轨道名称 画面轨", { exact: true }).elementHandle();
  await page.evaluate(async (before) => {
    const session = fixture.internals.session;
    await session.replace({ ...before, id: "intermediate-document" });
    await session.replace(before);
  }, before);
  await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.notEqual((await page.evaluate(() => fixture.state().identity)).generation, identity.generation);
  await stale.evaluate((node) => node.dispatchEvent(new Event("change", { bubbles: true })));
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.writes.map((write) => write.label)), ["打开工程", "打开工程"]);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a first track mute click retains both edits through actual autosave failure and retry", async (t) => {
  const page = await fixture(t), before = await documentState(page);
  await page.evaluate(() => fixture.writeMode("fail"));
  await page.getByLabel("画面轨 音量百分比", { exact: true }).fill("37.5");
  await page.getByLabel("静音画面轨", { exact: true }).click();
  await page.waitForFunction(() => fixture.state().saveState === "failed");
  const after = await documentState(page), track = after.sequences[0].tracks.find((item) => item.id === "video");
  assert.equal(track.volume, 0.375); assert.equal(track.muted, true);
  assert.equal(after.revision, before.revision + 2);
  assert.deepEqual((await page.evaluate(() => fixture.stored())).sequences, before.sequences);
  await page.evaluate(() => fixture.writeMode("normal"));
  await action(page, "retry-save").click();
  await page.waitForFunction(() => fixture.state().saveState === "saved");
  assert.deepEqual((await page.evaluate(() => fixture.stored())).sequences, after.sequences);
  assert.equal((await documentState(page)).revision, after.revision);
  await action(page, "undo").click(); await settle(page);
  const firstUndo = (await documentState(page)).sequences[0].tracks.find((item) => item.id === "video");
  assert.equal(firstUndo.volume, 0.375); assert.equal(firstUndo.muted, false);
  await action(page, "undo").click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences, before.sequences);
});

test("an awaited actual session replacement prevents a captured track toggle from entering the new project", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const { workspace, session } = fixture.internals, original = workspace.timeline.context.apply;
    workspace.timeline.context.apply = async (operations, label) => {
      original(operations, label);
      if (label === "调整轨道音量") {
        const successor = fixture.read(); successor.id = "track-successor";
        successor.sequences[0].tracks.find((item) => item.id === "video").volume = 1;
        await session.replace(successor);
      }
    };
  });
  await page.getByLabel("画面轨 音量百分比", { exact: true }).fill("37.5");
  await page.getByLabel("静音画面轨", { exact: true }).click();
  await page.waitForFunction(() => fixture.read().id === "track-successor" && fixture.state().phase === "ready");
  await settle(page);
  const track = (await documentState(page)).sequences[0].tracks.find((item) => item.id === "video");
  assert.equal(track.volume, 1); assert.equal(track.muted, false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  assert.equal(await page.evaluate(() => fixture.writes.some((write) => write.label === "调整轨道")), false);
});

for (const draft of [undefined, ["轨道名称 画面轨", "未提交轨道名"], ["画面轨 音量百分比", "37.5"]]) {
  for (const gesture of ["select", "drag", "contextmenu", "seek"]) {
    test(`the first workspace ${gesture} preserves ${draft?.[0] ?? "no track draft"} and its pointer intent`, async (t) => {
      const page = await fixture(t), before = await documentState(page);
      if (draft) await page.getByLabel(draft[0], { exact: true }).fill(draft[1]);
      const box = await clip(page).boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
      if (gesture === "select") await page.mouse.click(x, y);
      if (gesture === "drag") {
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + 64, y, { steps: 4 }); await page.mouse.up();
      }
      if (gesture === "contextmenu") await page.mouse.click(x, y, { button: "right" });
      if (gesture === "seek") {
        const ruler = await page.locator(".et-ruler").boundingBox();
        await page.mouse.click(ruler.x + 128, ruler.y + ruler.height / 2);
      }
      await settle(page);
      const after = await documentState(page), track = after.sequences[0].tracks.find((item) => item.id === "video");
      assert.equal(track.name, draft?.[0].startsWith("轨道名称") ? draft[1] : "画面轨");
      assert.equal(track.volume, draft?.[0].includes("音量") ? 0.375 : 1);
      assert.deepEqual(await page.evaluate(() => fixture.errors), []);
      assert.equal(after.revision, before.revision + Number(!!draft) + Number(gesture === "drag"));
      assert.equal(after.sequences[0].clips[0].start, gesture === "drag" ? 240000 : 0);
      assert.equal(await page.evaluate(() => fixture.playhead()), gesture === "seek" ? 480000 : 0);
      assert.deepEqual(await page.evaluate(() => fixture.selection()), gesture === "seek" ? [] : ["a"]);
      assert.equal(await page.locator("#timeline-context-menu").count(), Number(gesture === "contextmenu"));
      if (gesture === "drag") {
        await action(page, "undo").click(); await settle(page);
        const undoGesture = await documentState(page);
        assert.equal(undoGesture.sequences[0].clips[0].start, 0);
        assert.equal(undoGesture.sequences[0].tracks.find((item) => item.id === "video").volume, track.volume);
      }
    });
  }
}

test("a native IME track name finishes once before the first real workspace drag and each edit undoes separately", async (t) => {
  const page = await fixture(t), before = await documentState(page),
    input = page.getByLabel("轨道名称 画面轨", { exact: true }), cdp = await page.context().newCDPSession(page),
    box = await clip(page).boundingBox();
  await input.fill("");
  await input.evaluate((node) => {
    globalThis.trackCompositionStarts = []; globalThis.trackCompositionEnds = [];
    node.addEventListener("compositionstart", (event) => trackCompositionStarts.push(event.isTrusted));
    node.addEventListener("compositionend", (event) => trackCompositionEnds.push(event.isTrusted));
  });
  await cdp.send("Input.imeSetComposition", { text: "正式画面轨", selectionStart: 5, selectionEnd: 5 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 64, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  await settle(page);
  const after = await documentState(page);
  assert.equal(after.sequences[0].tracks.find((item) => item.id === "video").name, "正式画面轨");
  assert.equal(after.sequences[0].clips[0].start, 240000);
  assert.equal(after.revision, before.revision + 2);
  assert.deepEqual(await page.evaluate(() => trackCompositionStarts), [true]);
  assert.equal(await page.evaluate(() => trackCompositionEnds.length), 1);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  await action(page, "undo").click(); await settle(page);
  assert.equal((await documentState(page)).sequences[0].clips[0].start, 0);
  assert.equal((await documentState(page)).sequences[0].tracks.find((item) => item.id === "video").name, "正式画面轨");
  await action(page, "undo").click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences, before.sequences);
});

test("a track draft and first workspace drag retain the actual autosave dirty and retry behavior", async (t) => {
  const page = await fixture(t), before = await documentState(page), box = await clip(page).boundingBox();
  await page.evaluate(() => fixture.writeMode("fail"));
  await page.getByLabel("画面轨 音量百分比", { exact: true }).fill("37.5");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 64, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  await page.waitForFunction(() => fixture.state().saveState === "failed");
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2);
  assert.equal(after.sequences[0].clips[0].start, 240000);
  assert.equal(after.sequences[0].tracks.find((item) => item.id === "video").volume, 0.375);
  assert.deepEqual((await page.evaluate(() => fixture.stored())).sequences, before.sequences);
  await page.evaluate(() => fixture.writeMode("normal"));
  await action(page, "retry-save").click();
  await page.waitForFunction(() => fixture.state().saveState === "saved");
  assert.deepEqual((await page.evaluate(() => fixture.stored())).sequences, after.sequences);
  assert.equal((await documentState(page)).revision, after.revision);
});

test("an awaited actual session replacement cancels the track draft's captured workspace gesture", async (t) => {
  const page = await fixture(t), box = await clip(page).boundingBox();
  await page.evaluate(() => {
    const { workspace, session } = fixture.internals, original = workspace.timeline.context.apply;
    workspace.timeline.context.apply = async (operations, label) => {
      original(operations, label);
      if (label === "调整轨道音量") {
        const successor = fixture.read(); successor.id = "gesture-successor";
        successor.sequences[0].tracks.find((item) => item.id === "video").volume = 1;
        await session.replace(successor);
      }
    };
  });
  await page.getByLabel("画面轨 音量百分比", { exact: true }).fill("37.5");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 64, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  await page.waitForFunction(() => fixture.read().id === "gesture-successor" && fixture.state().phase === "ready");
  await settle(page);
  const after = await documentState(page);
  assert.equal(after.sequences[0].tracks.find((item) => item.id === "video").volume, 1);
  assert.equal(after.sequences[0].clips[0].start, 0);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), []);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  assert.equal(await page.evaluate(() => fixture.writes.some((write) => write.label === "移动片段")), false);
});

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
  assert.equal(sequence.tracks.length, 3, "Picture continues the main track instead of a new one");
  assert.equal(sequence.clips.at(-1).assetId, "imported");
  assert.equal(sequence.clips.at(-1).trackId, "video");
  assert.equal(sequence.clips.at(-1).start, 4 * 240000);
  assert.equal(await clip(page, sequence.clips.at(-1).id).getAttribute("aria-selected"), "true");
  await action(page, "undo").click();
  assert.deepEqual(semantic(await documentState(page)), semantic(imported));
  await page.getByRole("searchbox", { name: "搜索素材" }).fill("导入");
  assert.equal(await page.locator("[data-ew-asset]").count(), 1);
  assert.equal(await page.locator("[data-ew-asset]").getAttribute("data-ew-asset"), "imported");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("material + appends to the end of the main picture track even with the playhead at 0", async (t) => {
  const page = await fixture(t);
  assert.equal(await page.evaluate(() => fixture.playhead()), 0);
  const before = await documentState(page);
  await page.locator('[data-ew-asset="demo"]').click();
  await settle(page);
  const after = await documentState(page),
    sequence = after.sequences[0],
    added = sequence.clips.at(-1);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(sequence.tracks.length, before.sequences[0].tracks.length, "No new track");
  assert.deepEqual([added.trackId, added.start], ["video", 4 * 240000]);
  assert.deepEqual(sequence.clips[0], before.sequences[0].clips[0], "The original picture stays");
  assert.deepEqual(await page.evaluate(() => fixture.selection()), [added.id]);
  await page.waitForFunction(() => fixture.playhead() === 4 * 240000);
  // A second + keeps appending, never overlapping; a zoomed-in timeline scrolls to show it.
  await page.locator("[data-et-zoom]").fill("2.5");
  await page.locator(".et-scroll").evaluate((element) => {
    element.scrollLeft = 0;
  });
  await settle(page);
  await page.locator('[data-ew-asset="demo"]').click();
  const again = (await documentState(page)).sequences[0].clips.at(-1);
  assert.deepEqual([again.trackId, again.start], ["video", 8 * 240000]);
  await settle(page);
  const shown = await page.evaluate((id) => {
    const viewport = document.querySelector(".et-scroll").getBoundingClientRect();
    const segment = document.querySelector(`[data-et-clip="${id}"]`)?.getBoundingClientRect();
    return Boolean(segment) && segment.left >= viewport.left - 1 && segment.left < viewport.right;
  }, again.id);
  assert.equal(shown, true, "The appended clip is drawn and scrolled into view");
  // Inserting at the playhead stays available as an explicit choice.
  await page.evaluate(() => fixture.addAsset("demo", { anchor: "playhead" }));
  const inserted = (await documentState(page)).sequences[0];
  assert.equal(inserted.clips.at(-1).start, await page.evaluate(() => fixture.playhead()));
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("material + on a clip end between frames puts the playhead on the new clip, so 添加文字 starts with it", async (t) => {
  const page = await fixture(t);
  // The main picture ends at 3.98 s, between the 3.967 s and 4.000 s frames at 30 fps.
  const end = 4 * 240000 - 4800;
  await page.evaluate((end) => {
    fixture.dispatch(
      [
        {
          type: "clip.update",
          sequenceId: "main",
          clipId: "a",
          patch: {
            duration: end,
            timeMap: {
              points: [
                { time: 0, source: 0 },
                { time: end, source: end },
              ],
            },
          },
        },
      ],
      "缩短画面",
    );
  }, end);
  await settle(page);
  await page.locator('[data-ew-asset="demo"]').click();
  const added = (await documentState(page)).sequences[0].clips.at(-1);
  assert.equal(added.start, end);
  await page.waitForFunction((end) => fixture.playhead() === end, end);
  await settle(page);
  assert.equal(
    await page.evaluate(() => fixture.playhead()),
    end,
    "The playhead stays on the new clip",
  );
  await page.getByRole("button", { name: "添加文字", exact: true }).click();
  const title = (await documentState(page)).sequences[0].clips.at(-1);
  assert.equal(title.kind, "text");
  assert.equal(title.start, end);
});

test("sound + appends to the end of the first audio track", async (t) => {
  const page = await fixture(t, { audio: true });
  const before = await documentState(page);
  await page.locator('[data-ew-asset="audio"]').click();
  const sequence = (await documentState(page)).sequences[0],
    added = sequence.clips.at(-1);
  assert.equal(sequence.tracks.length, before.sequences[0].tracks.length);
  assert.deepEqual([added.assetId, added.trackId, added.start], ["audio", "audio", 4 * 240000]);
});

test("添加文字 puts an editable title above every picture at the playhead", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const seek = document.querySelector("[data-ew-seek]");
    seek.value = String(240000);
    seek.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => fixture.playhead() === 240000);
  const before = await documentState(page);
  await page.getByRole("button", { name: "添加文字", exact: true }).click();
  const after = await documentState(page),
    sequence = after.sequences[0],
    added = sequence.clips.at(-1);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(
    [added.kind, added.role, added.trackId, added.start, added.duration],
    ["text", "title", "text", 240000, 3 * 240000],
  );
  assert.deepEqual(await page.evaluate(() => fixture.selection()), [added.id]);
  assert.equal(
    await page.getByRole("tab", { name: "文字", exact: true }).getAttribute("aria-selected"),
    "true",
  );
  const field = page.getByLabel("文字内容（保留换行）", { exact: true });
  assert.equal(await field.inputValue(), "输入文字");
  assert.equal(await field.evaluate((node) => node === document.activeElement), true);
  assert.equal(await clip(page, added.id).locator(".et-clip-label").textContent(), "输入文字");
  await field.fill("  第一行标题\n第二行");
  await field.press("Tab");
  assert.equal(await clip(page, added.id).locator(".et-clip-label").textContent(), "第一行标题");
  // The track-only button says what it does.
  assert.equal(await page.getByRole("button", { name: "新建文字轨", exact: true }).count(), 1);
  await field.fill("");
  await field.press("Tab");
  assert.equal(await clip(page, added.id).locator(".et-clip-label").textContent(), "文字");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("添加文字 creates a top text track when the existing one sits below the picture", async (t) => {
  const page = await fixture(t, { textBelow: true });
  await page.getByRole("button", { name: "添加文字", exact: true }).click();
  const sequence = (await documentState(page)).sequences[0],
    added = sequence.clips.at(-1);
  assert.equal(sequence.tracks.length, 4);
  assert.equal(sequence.tracks.at(-1).kind, "text");
  assert.equal(added.trackId, sequence.tracks.at(-1).id, "Text is the top layer, visible");
  assert.equal(added.start, 0);
});

test("caption clips show their words on the timeline", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    fixture.dispatch(
      [
        {
          type: "clip.add",
          sequenceId: "main",
          clip: {
            id: "caption",
            kind: "text",
            role: "subtitle",
            label: "字幕",
            trackId: "text",
            start: 0,
            duration: 240000,
            text: "大家好，欢迎来到我的频道，今天我们聊一聊怎样把一段很长的口播剪得更紧凑",
            words: [],
            style: editor.defaultTextStyle(),
            transform: editor.defaultTransform(),
            color: editor.defaultColorAdjustment(),
            blendMode: "normal",
          },
        },
      ],
      "加字幕",
    ),
  );
  await settle(page);
  const label = await clip(page, "caption").locator(".et-clip-label").textContent();
  assert.match(label, /^大家好，欢迎来到我的频道/);
  assert.match(label, /…$/);
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
    assert.equal(added.duration, (shape ? 5 : 3) * 240000);
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

test("the play button replays a finished sequence without restarting a manual last-frame seek", async (t) => {
  const duration = 240000,
    lastFrame = duration - 8000,
    page = await fixture(t, { duration });
  await action(page, "play").click();
  await page.waitForFunction(
    (end) => !fixture.playing() && fixture.playhead() === end,
    duration,
  );
  await action(page, "play").click();
  await page.waitForFunction(
    (end) => fixture.playing() && fixture.playhead() > 0 && fixture.playhead() < end / 2,
    duration,
  );
  await action(page, "play").click();
  await page.getByRole("slider", { name: "播放位置", exact: true }).fill(String(lastFrame));
  await page.waitForFunction((last) => fixture.playhead() === last, lastFrame);
  await page.evaluate(() => {
    window.lastFrameTimes = [];
    new MutationObserver(() => window.lastFrameTimes.push(fixture.playhead())).observe(
      document.querySelector("[data-ew-time]"),
      { childList: true },
    );
  });
  await action(page, "play").click();
  await page.waitForFunction(
    (end) => !fixture.playing() && fixture.playhead() === end,
    duration,
  );
  const times = await page.evaluate(() => window.lastFrameTimes);
  assert.ok(times.length > 0);
  assert.ok(times.every((time) => time >= lastFrame), "A manual last-frame seek must play from there");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("dragging the playback slider seeks before release and holds the chosen frame while paused", async (t) => {
  const page = await fixture(t),
    before = await documentState(page),
    seek = page.getByRole("slider", { name: "播放位置", exact: true }),
    bounds = await seek.boundingBox();
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.playing() && fixture.playhead() > 0);
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.waitForFunction(
    () => !fixture.playing() && fixture.playhead() > 2.5 * 240000,
  );
  await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height / 2, { steps: 4 });
  await page.waitForFunction(
    () => fixture.playhead() > 240000 && fixture.playhead() < 1.5 * 240000,
  );
  const chosen = await page.evaluate(() => fixture.playhead());
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => fixture.playhead()), chosen);
  assert.equal(Number(await seek.inputValue()), chosen);
  await page.mouse.up();
  await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), chosen);
  assert.equal(await action(page, "play").textContent(), "播放");
  assert.deepEqual(await documentState(page), before);
  assert.equal((await page.evaluate(() => fixture.state())).canUndo, false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("slider input cancels audio preparation before change and ignores its late completion", async (t) => {
  const page = await fixture(t, { audio: true });
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await page.evaluate(() => {
    const seek = document.querySelector("[data-ew-seek]");
    seek.value = "240000";
    seek.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(
    () => fixture.audio()[0].aborted && fixture.playhead() === 240000,
  );
  await page.evaluate(() => fixture.resolveAudio(0));
  await settle(page);
  assert.equal(await page.evaluate(() => fixture.playing()), false);
  assert.equal(await page.evaluate(() => fixture.playhead()), 240000);
  assert.equal(await action(page, "play").textContent(), "播放");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("holding Space leaves playback and audio preparation unchanged until the next fresh press", async (t) => {
  const page = await fixture(t, { audio: true });
  await page.locator("[data-ew-timeline]").focus();
  await page.keyboard.down("Space");
  await page.waitForFunction(() => fixture.audio().length === 1);
  await page.keyboard.down("Space");
  assert.equal(await page.evaluate(() => fixture.audio()[0].aborted), false);
  assert.equal(await action(page, "play").textContent(), "取消播放准备");
  await page.evaluate(() => fixture.resolveAudio(0));
  await page.waitForFunction(() => fixture.playing());
  await page.keyboard.down("Space");
  assert.equal(await page.evaluate(() => fixture.playing()), true);
  await page.keyboard.up("Space");
  await page.keyboard.press("Space");
  assert.equal(await page.evaluate(() => fixture.playing()), false);
  assert.equal(await action(page, "play").textContent(), "播放");
  assert.equal(await page.evaluate(() => fixture.audio().length), 1);
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

test("playback preparation stays visible while task start waits, cancels locally and ignores stale progress", async (t) => {
  const page = await fixture(t, { audio: true, layout: "embedded" });
  const before = await documentState(page);
  const status = page.locator("[data-ew-preview-error]");
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  assert.equal(await status.isVisible(), true);
  assert.match(await status.textContent(), /正在准备播放素材/);
  assert.match(await status.textContent(), /素材复制可能仍会完成/);
  assert.equal(await action(page, "play").getAttribute("aria-busy"), "true");
  await page.evaluate(() => fixture.audioProgress(0, "正在准备视频素材并等待主程序提交任务…"));
  await settle(page);
  assert.match(await status.textContent(), /正在准备视频素材并等待主程序提交任务/);
  await action(page, "play").click();
  assert.equal(await status.isVisible(), false);
  assert.equal(await action(page, "play").getAttribute("aria-busy"), "false");
  assert.equal(await page.evaluate(() => fixture.audio()[0].aborted), true);
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 2);
  await page.evaluate(() => {
    fixture.audioProgress(1, "正在准备声音…");
    fixture.audioProgress(0, "过期任务的进度");
    fixture.resolveAudio(0);
  });
  await settle(page);
  assert.match(await status.textContent(), /正在准备声音/);
  await page.evaluate(() => fixture.resolveAudio(1));
  await page.waitForFunction(
    () => document.querySelector('[data-ew-action="play"]').getAttribute("aria-label") === "暂停",
  );
  assert.equal(await status.isVisible(), false);
  assert.equal(await status.getAttribute("data-preview-preparing"), null);
  assert.deepEqual(await documentState(page), before);
  await action(page, "play").click();
});

test("a long playback preparation keeps showing how long it has been waiting", async (t) => {
  const page = await fixture(t, { audio: true });
  await page.clock.install();
  const status = page.locator("[data-ew-preview-error]");
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await page.evaluate(() => fixture.audioProgress(0, "正在把原始素材交给本地任务…"));
  assert.doesNotMatch(await status.textContent(), /已等待/);
  // The Host may copy large originals inside tasks.start without any progress events.
  await page.clock.fastForward(65_000);
  assert.match(await status.textContent(), /正在把原始素材交给本地任务…（已等待 1 分 05 秒）/);
  assert.match(await status.textContent(), /再次点击播放按钮可取消等待/);
  // The live status sentence is announced once; only a hidden counter ticks.
  assert.equal(
    await status.locator("[data-ew-preview-elapsed]").getAttribute("aria-hidden"),
    "true",
  );
  await page.evaluate(() => {
    const output = document.querySelector("[data-ew-preview-error]");
    window.__statusMutations = [];
    new MutationObserver((records) =>
      window.__statusMutations.push(
        ...records.filter(
          (r) =>
            !r.target.closest?.("[data-ew-preview-elapsed]") &&
            !r.target.parentElement?.closest("[data-ew-preview-elapsed]"),
        ),
      ),
    ).observe(output, { childList: true, characterData: true, subtree: true });
  });
  await page.clock.fastForward(3_000);
  assert.match(await status.textContent(), /已等待 1 分 08 秒/);
  assert.equal(await page.evaluate(() => window.__statusMutations.length), 0);
  await action(page, "play").click();
  assert.equal(await status.isVisible(), false);
  await page.clock.fastForward(5_000);
  assert.equal(await status.isVisible(), false);
  await page.evaluate(() => fixture.resolveAudio(0));
});

test("preview quality is view-only, cancels pending preparation and leaves full-sized export settings", async (t) => {
  const page = await fixture(t, { audio: true });
  const before = await documentState(page),
    writes = await page.evaluate(() => fixture.writes.length);
  const quality = page.getByLabel("预览质量", { exact: true });
  assert.equal(await quality.inputValue(), "1");
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await quality.selectOption("0.25");
  await page.waitForFunction(() => document.querySelector("[data-ew-canvas]").width === 80);
  assert.equal(await page.evaluate(() => fixture.audio()[0].aborted), true);
  await page.evaluate(() => fixture.resolveAudio(0));
  await settle(page);
  assert.equal(await page.evaluate(() => fixture.playing()), false);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.evaluate(() => fixture.writes.length), writes);
  assert.equal(await action(page, "undo").isDisabled(), true);
  await action(page, "export").click();
  assert.equal(await page.locator('dialog [name="width"]').inputValue(), "320");
  assert.equal(await page.locator('dialog [name="height"]').inputValue(), "180");
  await page.locator("dialog button[type=submit]").click();
  await page.locator("dialog").waitFor({ state: "detached" });
  const exported = await page.evaluate(() => fixture.exports[0]);
  assert.deepEqual(exported.doc, before);
  assert.equal(exported.profile.width, 320);
  assert.equal(exported.profile.height, 180);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("successful quality redraw clears an earlier playback error without changing the document", async (t) => {
  const page = await fixture(t, { audio: true });
  const before = await documentState(page),
    status = page.locator("[data-ew-preview-error]");
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await page.evaluate(() => fixture.rejectAudio(0, "测试声音准备失败"));
  await page.waitForFunction(() => fixture.errors.length === 1);
  assert.equal(await status.isVisible(), true);
  await page.getByLabel("预览质量", { exact: true }).selectOption("0.5");
  await page.waitForFunction(() => document.querySelector("[data-ew-canvas]").width === 160);
  await status.waitFor({ state: "hidden" });
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.evaluate(() => fixture.errors.length), 1);
});

test("preview quality restores only valid preferences and never saves an initial or invalid value", async (t) => {
  for (const value of [0.5, 0.25, 1, null, 0, "0.25"]) {
    const page = await fixture(t, { qualityPreference: true, savedQuality: value }), before = await documentState(page);
    const expected = typeof value === "number" && [1, 0.5, 0.25].includes(value) ? value : 1;
    await page.waitForFunction((value) => document.querySelector("[data-ew-canvas]").width === 320 * value, expected);
    assert.equal(await page.getByLabel("预览质量", { exact: true }).inputValue(), String(expected));
    assert.deepEqual(await page.evaluate(() => globalThis.qualityChoices ?? []), []);
    assert.deepEqual(await documentState(page), before);
  }
});

test("a late preview quality load cannot overwrite a manual choice or interrupt audio preparation", async (t) => {
  const page = await fixture(t, { qualityPreference: true, holdQualityLoad: true, audio: true });
  await page.getByLabel("预览质量", { exact: true }).selectOption("0.25");
  await page.evaluate(() => releaseQualityLoad(0.5)); await settle(page);
  assert.equal(await page.getByLabel("预览质量", { exact: true }).inputValue(), "0.25");
  assert.deepEqual(await page.evaluate(() => qualityChoices), [0.25]);
  const playing = await fixture(t, { qualityPreference: true, holdQualityLoad: true, audio: true });
  await action(playing, "play").click(); await playing.waitForFunction(() => fixture.audio().length === 1);
  await playing.evaluate(() => releaseQualityLoad(0.25)); await settle(playing);
  assert.equal(await playing.getByLabel("预览质量", { exact: true }).inputValue(), "1");
  assert.equal(await playing.evaluate(() => fixture.audio()[0].aborted), false);
  await playing.evaluate(() => fixture.resolveAudio(0)); await playing.waitForFunction(() => fixture.playing());
});

test("a disposed workspace's late quality load cannot change a newer workspace in the same container", async (t) => {
  const page = await fixture(t, { qualityPreference: true, holdQualityLoad: true });
  await page.evaluate(async () => {
    const old = fixture.internals.workspace, options = old.options;
    await old.dispose();
    globalThis.successorQuality = new editor.EditorWorkspace(document.querySelector("#workspace"), {
      ...options, previewQuality: { load: () => 0.5, save: () => {} },
    });
  });
  await page.waitForFunction(() => document.querySelector("[data-ew-canvas]").width === 160);
  await page.evaluate(() => releaseQualityLoad(0.25)); await settle(page);
  assert.equal(await page.getByLabel("预览质量", { exact: true }).inputValue(), "0.5");
  assert.equal(await page.locator("[data-ew-canvas]").evaluate((canvas) => canvas.width), 160);
});

test("manual quality choices save before held image decodes finish and rejected preference writes leave editing usable", async (t) => {
  const page = await fixture(t, { qualityPreference: true, failQualitySave: true }), before = await documentState(page);
  await page.evaluate(() => fixture.pendingPicture());
  await page.waitForFunction(() => fixture.imageRequests().length === 1);
  await page.getByLabel("预览质量", { exact: true }).selectOption("0.5");
  await page.getByLabel("预览质量", { exact: true }).selectOption("0.25");
  assert.deepEqual(await page.evaluate(() => qualityChoices), [0.5, 0.25]);
  await page.evaluate(() => fixture.resolveImage(0)); await settle(page);
  assert.deepEqual(await page.evaluate(() => qualityChoices), [0.5, 0.25]);
  assert.equal(await page.getByLabel("预览质量", { exact: true }).inputValue(), "0.25");
  await page.getByLabel("工程名称", { exact: true }).fill("偏好失败后仍可编辑");
  await page.getByLabel("工程名称", { exact: true }).press("Tab"); await settle(page);
  assert.equal((await documentState(page)).name, "偏好失败后仍可编辑");
  assert.equal((await documentState(page)).revision, before.revision + 2);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("failed playback preparation clears busy state and explains an outdated panel without changing edits", async (t) => {
  const page = await fixture(t, { audio: true });
  await page.evaluate(() => fixture.externalEdit());
  await page.evaluate(() => fixture.flush());
  const before = await documentState(page);
  const status = page.locator("[data-ew-preview-error]");
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await page.evaluate(() =>
    fixture.rejectAudio(0, "Installed tool task version or permissions changed"),
  );
  await page.waitForFunction(() => fixture.errors.length === 1);
  assert.equal(await status.isVisible(), true);
  assert.match(await status.textContent(), /当前页面已过期/);
  assert.match(await status.textContent(), /确认工程已保存后，关闭并重新打开视频工作台/);
  assert.equal(await status.getAttribute("data-preview-preparing"), null);
  assert.equal(await action(page, "play").getAttribute("aria-busy"), "false");
  assert.equal(await action(page, "play").textContent(), "播放");
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.stored()), before);
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 2);
  assert.match(await status.textContent(), /正在准备播放素材/);
  await action(page, "play").click();
  assert.equal(await status.isVisible(), false);
  await page.evaluate(() => fixture.resolveAudio(1));
});

test("cancelled native audio completion never plays or contaminates the next preparation", async (t) => {
  const page = await fixture(t, { audio: true });
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  assert.equal(await action(page, "play").textContent(), "取消播放准备");
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

test("a wrong audio identity is released instead of being cached for the next resume", async (t) => {
  const page = await fixture(t, { audio: true });
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await page.evaluate(() => fixture.resolveAudio(0, true, true));
  await page.waitForFunction(() => fixture.errors.length === 1);
  assert.match(await page.locator("[data-ew-preview-error]").textContent(), /版本不一致/);
  assert.equal(await page.evaluate(() => fixture.audio()[0].disposed), 1);
  assert.equal(await page.evaluate(() => fixture.playing()), false);
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 2);
  await page.evaluate(() => fixture.resolveAudio(1, true));
  await page.waitForFunction(() => fixture.playing());
  await action(page, "play").click();
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.playing());
  assert.equal(await page.evaluate(() => fixture.audio().length), 2);
  assert.equal(await page.evaluate(() => fixture.audio()[1].disposed), 0);
  await action(page, "play").click();
});

test("same-revision media refresh releases a cached mix and fences a pending replacement", async (t) => {
  const page = await fixture(t, { audio: true });
  const warning = page.locator("[data-ew-audio-warning]");
  const before = await page.evaluate(() => fixture.state().identity);
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await page.evaluate(() => fixture.resolveAudio(0, true, false, { peak: 1.2, samplesOverFullScale: 100 }));
  await page.waitForFunction(() => fixture.playing());
  await action(page, "play").click();
  assert.equal(await warning.isVisible(), true);
  await page.evaluate(() => fixture.refreshMedia());
  assert.equal(await warning.isHidden(), true);
  assert.equal(await page.evaluate(() => fixture.audio()[0].disposed), 1);
  assert.equal(await page.evaluate(() => fixture.audio().length), 1);
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 2);
  await page.evaluate(() => fixture.refreshMedia());
  assert.equal(await page.evaluate(() => fixture.audio()[1].aborted), true);
  await page.evaluate(() => fixture.resolveAudio(1, true));
  await page.waitForFunction(() => fixture.audio()[1].disposed === 1);
  assert.equal(await page.evaluate(() => fixture.playing()), false);
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 3);
  await page.evaluate(() => fixture.resolveAudio(2, true));
  await page.waitForFunction(() => fixture.playing());
  await action(page, "play").click();
  assert.deepEqual(await page.evaluate(() => fixture.state().identity), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  await page.evaluate(() => { fixture.dispose(); fixture.refreshMedia(); });
  assert.equal(await page.evaluate(() => fixture.audio()[2].disposed), 1);
});

test("audio overload remains visible while paused and clears for revisions, sequences and document generations", async (t) => {
  const page = await fixture(t, { audio: true, sequenceCount: 2 });
  const warning = page.locator("[data-ew-audio-warning]");
  const prepare = async (index, report = { peak: 1.2, samplesOverFullScale: 100 }) => {
    await action(page, "play").click();
    await page.waitForFunction((count) => fixture.audio().length === count, index + 1);
    await page.evaluate(({ index, report }) => fixture.resolveAudio(index, true, false, report), {
      index,
      report,
    });
    await page.waitForFunction(() => fixture.playing());
    await action(page, "play").click();
  };
  const before = await documentState(page);
  await prepare(0);
  assert.equal(await warning.isVisible(), true);
  assert.match(await warning.textContent(), /\+1\.6 dBFS.*降低音轨或片段音量/);
  assert.deepEqual(await documentState(page), before, "Measuring overload never edits the project");
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.playing());
  await action(page, "play").click();
  assert.equal(await warning.isVisible(), true);
  assert.equal(
    await page.evaluate(() => fixture.audio().length),
    1,
    "Resume reuses the same measured mix",
  );
  await page.evaluate(() => fixture.sourcePreview(true));
  assert.equal(await warning.isVisible(), false, "Source browsing must not show the timeline mix warning");
  await page.evaluate(() => fixture.sourcePreview(false));
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.playing());
  await action(page, "play").click();
  assert.equal(await warning.isVisible(), true);
  await page.evaluate(() => fixture.externalEdit());
  assert.equal(await warning.isVisible(), false);
  await prepare(1, { peak: 0.4, samplesOverFullScale: 0 });
  assert.equal(await warning.isVisible(), false, "A safe corrected mix has no warning");
  await page.locator("[data-ew-sequence]").selectOption("sequence-2");
  await prepare(2);
  assert.equal(await warning.isVisible(), true);
  await page.locator("[data-ew-sequence]").selectOption("main");
  assert.equal(await warning.isVisible(), false);
  await prepare(3);
  await page.evaluate(() => fixture.replaceGeneration());
  assert.equal(
    await warning.isVisible(),
    false,
    "Same document and revision with a new generation invalidates the mix",
  );
  await prepare(4);
  await page.evaluate(() => fixture.replaceProject());
  assert.equal(await warning.isVisible(), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("cancelled, failed, invalid and stale audio reports never appear as current overload warnings", async (t) => {
  const page = await fixture(t, { audio: true });
  const warning = page.locator("[data-ew-audio-warning]");
  const overload = { peak: 1.2, samplesOverFullScale: 100 };
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 1);
  await action(page, "play").click();
  await page.evaluate((mix) => fixture.resolveAudio(0, true, false, mix), overload);
  await settle(page);
  assert.equal(await warning.isVisible(), false);
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 2);
  await page.evaluate(() => fixture.externalEdit());
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 3);
  await page.evaluate((mix) => fixture.resolveAudio(1, true, false, mix), overload);
  await settle(page);
  assert.equal(await warning.isVisible(), false);
  await page.evaluate(() => fixture.rejectAudio(2, "混音失败"));
  await page.waitForFunction(() => fixture.errors.length === 1);
  assert.equal(await warning.isVisible(), false);
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.audio().length === 4);
  await page.evaluate((mix) => fixture.resolveAudio(3, true, true, mix), overload);
  await page.waitForFunction(() => fixture.errors.length === 2);
  assert.equal(await warning.isVisible(), false);
  assert.equal(await page.evaluate(() => fixture.audio()[3].disposed), 1);
  for (const mix of [
    { peak: 1.2, samplesOverFullScale: 0 },
    { peak: 1.2, samplesOverFullScale: 100, sampleCount: 1 },
    { peak: 1.2, samplesOverFullScale: 1, sampleCount: 100 },
  ]) {
    const index = await page.evaluate(() => fixture.audio().length);
    await action(page, "play").click();
    await page.waitForFunction((count) => fixture.audio().length === count, index + 1);
    await page.evaluate(({ index, mix }) => fixture.resolveAudio(index, true, false, mix), {
      index,
      mix,
    });
    await page.waitForFunction((index) => fixture.audio()[index].disposed === 1, index);
    assert.equal(await page.evaluate(() => fixture.playing()), false);
    assert.equal(await warning.isVisible(), false);
  }
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
  assert.equal(await action(page, "play").textContent(), "取消播放准备");
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

test("sandboxed export forms submit once without permitting native form navigation", async (t) => {
  const page = await fixture(t, { sandbox: true });
  await action(page, "export").click();
  await page.locator("dialog button[type=submit]").click();
  await page.locator("dialog").waitFor({ state: "detached", timeout: 4000 });
  assert.equal(await page.evaluate(() => fixture.exports.length), 1);
  assert.equal(page.url(), "about:srcdoc");
  await action(page, "export").click();
  await page.locator('dialog [name="width"]').fill("15");
  await page.locator("dialog button[type=submit]").click();
  assert.equal(
    await page.evaluate(() => fixture.exports.length),
    1,
    "Invalid dimensions cannot submit",
  );
  await page.locator('dialog [name="width"]').fill("320");
  await page.locator('dialog [name="width"]').press("Enter");
  await page.locator("dialog").waitFor({ state: "detached", timeout: 4000 });
  assert.equal(await page.evaluate(() => fixture.exports.length), 2, "Keyboard submits once");
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

test("export summary uses effective profile rates across different sequences, custom toggles and multiple presets", async (t) => {
  const page = await fixture(t, { sequenceCount: 2 });
  await page.evaluate(() =>
    fixture.dispatch(
      [
        {
          type: "sequence.update",
          sequenceId: "main",
          patch: { frameRate: { numerator: 60000, denominator: 1001 } },
        },
        {
          type: "sequence.update",
          sequenceId: "sequence-2",
          patch: { width: 1080, height: 1920, frameRate: { numerator: 30000, denominator: 1001 } },
        },
      ],
      "序列参数",
    ),
  );
  await settle(page);
  const before = await documentState(page);
  await action(page, "export").click();
  const summary = page.getByLabel("导出摘要", { exact: true });
  assert.match(await summary.textContent(), /1 个序列：主序列.*59\.94 fps.*共 1 个成片/s);
  await page.locator('dialog [name="custom"]').uncheck();
  assert.match(await summary.textContent(), /待补充：.*选择.*导出预设/);
  await page.locator('dialog [name="profiles"][value="landscape-1080p"]').check();
  await page.locator('dialog [name="sequences"][value="sequence-2"]').check();
  const presetOnly = await summary.textContent();
  assert.match(presetOnly, /2 个序列：主序列、序列 2/);
  assert.match(presetOnly, /横屏 1080p · 1920 × 1080 · MP4 \/ H264 · 30 fps/);
  assert.match(presetOnly, /共 2 个成片/);
  assert.doesNotMatch(presetOnly, /59\.94|29\.97|自定义导出/);
  assert.equal(await page.locator('dialog [name="rate"]').inputValue(), "60000/1001");
  assert.equal(await page.locator('dialog [name="rate"]').isDisabled(), true);
  await page.locator('dialog [name="profiles"][value="portrait-1080p"]').check();
  assert.match(await summary.textContent(), /共 4 个成片/);
  await page.locator('dialog [name="custom"]').check();
  await page.locator('dialog [name="presetName"]').fill("网页发送版");
  await page.locator('dialog [name="width"]').fill("640");
  await page.locator('dialog [name="height"]').fill("360");
  await page.locator('dialog [name="rate"]').selectOption("24000/1001");
  await page.locator('dialog [name="format"]').selectOption("webm:vp9:opus");
  const selected = await summary.textContent();
  assert.match(selected, /网页发送版 · 640 × 360 · WEBM \/ VP9 · 23\.976 fps/);
  assert.match(selected, /竖屏 1080p · 1080 × 1920 · MP4 \/ H264 · 30 fps/);
  assert.match(selected, /共 6 个成片/);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.evaluate(() => fixture.exportAttempts().length), 0);
  await saveDialog(page);
  const exports = await page.evaluate(() => fixture.exports);
  assert.equal(exports.length, 6);
  for (const item of exports) {
    const rate = Number(
      (item.profile.frameRate.numerator / item.profile.frameRate.denominator).toFixed(3),
    );
    assert.ok(
      selected.includes(
        `${item.profile.name} · ${item.profile.width} × ${item.profile.height} · ${item.profile.container.toUpperCase()} / ${item.profile.videoCodec.toUpperCase()} · ${rate} fps`,
      ),
    );
    assert.deepEqual(item.doc, before);
  }
  assert.deepEqual(
    exports
      .filter((item) => item.profile.id === "interactive-custom-export")
      .map((item) => item.profile.frameRate),
    [
      { numerator: 24000, denominator: 1001 },
      { numerator: 24000, denominator: 1001 },
    ],
  );
});

test("invalid export summary gives actionable pending fields without writes and ignores disabled custom values", async (t) => {
  const page = await fixture(t);
  await action(page, "export").click();
  const before = await documentState(page),
    writes = await page.evaluate(() => fixture.writes.length),
    summary = page.getByLabel("导出摘要", { exact: true }),
    width = page.locator('dialog [name="width"]');
  await width.fill("");
  assert.match(await summary.textContent(), /待补充：请检查宽度/);
  await page.locator("dialog button[type=submit]").click();
  await width.fill("321");
  assert.match(await summary.textContent(), /待补充：.*宽度/);
  await width.fill("320");
  await page.locator('dialog [name="qualityMode"]').selectOption("bitrate");
  await page.locator('dialog [name="videoBitrate"]').fill("12.1234");
  assert.match(await summary.textContent(), /待补充：.*视频码率/);
  await page.locator('dialog [name="custom"]').uncheck();
  assert.match(await summary.textContent(), /待补充：.*导出预设/);
  await page.locator('dialog [name="profiles"][value="landscape-1080p"]').check();
  assert.doesNotMatch(await summary.textContent(), /待补充/);
  await page.locator('dialog [name="sequences"][value="main"]').uncheck();
  assert.match(await summary.textContent(), /待补充：请选择要导出的序列/);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.evaluate(() => fixture.writes.length), writes);
  assert.equal(await page.evaluate(() => fixture.exportAttempts().length), 0);
  await page.locator('dialog [name="sequences"][value="main"]').check();
  await saveDialog(page);
  assert.equal(await page.evaluate(() => fixture.exports.length), 1);
  assert.deepEqual(await page.evaluate(() => fixture.exports[0].profile.frameRate), {
    numerator: 30,
    denominator: 1,
  });
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
  assert.match(await page.locator("[data-export-progress]").textContent(), /提交已停止/);
  assert.equal(await page.locator("[data-export-progress]").getAttribute("data-submitting"), null);
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

async function replaceExportProject(page, replacement) {
  await page.evaluate(async (replacement) => {
    const next = fixture.read();
    next.name = "新的工程会话";
    if (replacement === "same-id-same-revision-reopen")
      // A direct same-ID restore deliberately increments revision. Opening B then reopening
      // the saved A version is the public workflow that returns to A's original ID/revision.
      await fixture.internals.session.replace({ ...next, id: "intermediate-project" });
    else if (replacement === "other-project") next.id = "successor-project";
    await fixture.internals.session.replace(next);
  }, replacement);
  return page.evaluate(() => fixture.state().identity);
}

for (const replacement of ["same-id-restore", "same-id-same-revision-reopen", "other-project"]) {
  test(`a frozen partial export cannot retry into ${replacement}`, async (t) => {
    const page = await fixture(t, { sequenceCount: 2, exportFailAt: 2 });
    await selectExportMatrix(page);
    await page.locator("dialog button[type=submit]").click();
    await page.waitForFunction(() =>
      document.querySelector(".ew-form-error").textContent.includes("第二项任务提交失败"),
    );
    assert.equal(await page.evaluate(() => fixture.exports.length), 1);
    const identity = await page.evaluate(() => fixture.state().identity);
    const successor = await replaceExportProject(page, replacement);
    assert.notEqual(successor.generation, identity.generation);
    assert.equal(
      successor.revision,
      identity.revision + (replacement === "same-id-restore" ? 1 : 0),
    );
    assert.equal(successor.documentId === identity.documentId, replacement !== "other-project");
    await page.locator("dialog button[type=submit]").click();
    await settle(page);
    assert.equal(
      await page.evaluate(() => fixture.exports.length),
      1,
      "A generation change must fence the frozen batch before another adapter call",
    );
    assert.match(
      await page.locator(".ew-form-error").textContent(),
      /工程已变化|工程.*切换|重新打开/,
    );
  });
}

for (const replacement of ["same-id-restore", "same-id-same-revision-reopen", "other-project"]) {
  test(`a batch awaiting an accepted receipt starts no next item after ${replacement}`, async (t) => {
    const page = await fixture(t, { sequenceCount: 2, exportHeldAt: 1 });
    const before = await documentState(page);
    await selectExportMatrix(page);
    await page.locator("dialog button[type=submit]").click();
    await page.waitForFunction(() => fixture.exportAttempts().length === 1);
    const identity = await page.evaluate(() => fixture.state().identity);
    const successor = await replaceExportProject(page, replacement);
    assert.equal(
      successor.revision,
      identity.revision + (replacement === "same-id-restore" ? 1 : 0),
    );
    assert.notEqual(successor.generation, identity.generation);
    await page.evaluate(() => fixture.releaseExport());
    await page.waitForFunction(() =>
      document.querySelector(".ew-form-error").textContent.includes("工程已切换或恢复"),
    );
    assert.equal(await page.evaluate(() => fixture.exportAttempts().length), 1);
    const accepted = await page.evaluate(() => fixture.exports);
    assert.equal(accepted.length, 1, "The already accepted receipt is kept exactly once");
    assert.deepEqual(accepted[0].doc, before);
    assert.match(await page.locator("[data-export-progress]").textContent(), /已提交 1\/4/);
    await page.locator("dialog button[type=submit]").click();
    await settle(page);
    assert.equal(await page.evaluate(() => fixture.exportAttempts().length), 1);
    await page.locator("[data-ew-close]").click();
    await action(page, "export").click();
    await saveDialog(page);
    const current = await page.evaluate(() => fixture.exports);
    assert.equal(current.length, 2);
    assert.equal(current[1].doc.name, "新的工程会话");
    assert.equal(current[1].doc.id, successor.documentId);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("cancel remaining submissions keeps a late accepted receipt and starts no further combinations", async (t) => {
  const page = await fixture(t, { sequenceCount: 2, exportHeldAt: 1 });
  await selectExportMatrix(page);
  await page.locator("dialog button[type=submit]").click();
  await page.waitForFunction(() => fixture.exportAttempts().length === 1);
  assert.equal(await page.locator("[data-ew-close]").textContent(), "取消剩余提交");
  assert.match(
    await page.locator("[data-export-progress]").textContent(),
    /正在准备导出素材并提交任务/,
  );
  assert.match(await page.locator("[data-export-progress]").textContent(), /素材复制可能仍会完成/);
  assert.equal(
    await page.locator("[data-export-progress]").getAttribute("data-submitting"),
    "true",
  );
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

test("range marker export submits only the current sequence window and restores full-sequence choices", async (t) => {
  const page = await fixture(t, { sequenceCount: 2, emptySequence: true });
  await page.evaluate(() => fixture.dispatch([
    { type: "marker.add", sequenceId: "main", marker: { id: "review", time: 80085, duration: 240240, name: '<审核>&"', note: "", color: "#ffcc00" } },
    { type: "marker.add", sequenceId: "main", marker: { id: "point", time: 0, duration: 0, name: "点标记", note: "", color: "#ffcc00" } },
    { type: "marker.add", sequenceId: "main", marker: { id: "outside", time: 3 * 240000, duration: 2 * 240000, name: "超出画面", note: "", color: "#ffcc00" } },
  ], "添加导出范围"));
  await settle(page);
  const before = await documentState(page);
  await action(page, "export").click();
  const range = page.locator('dialog [name="range"]'),
    main = page.locator('dialog [name="sequences"][value="main"]'),
    other = page.locator('dialog [name="sequences"][value="sequence-2"]'),
    summary = page.getByLabel("导出摘要", { exact: true });
  assert.equal(await range.locator('[value="point"]').count(), 0);
  assert.equal(await range.locator('[value="outside"]').getAttribute("disabled"), "", JSON.stringify(before.sequences[0]));
  assert.match(await range.locator('[value="review"]').textContent(), /<审核>&"/);
  assert.equal(await page.locator("[data-export-range-hint]").isVisible(), false);
  await other.check();
  assert.match(await summary.textContent(), /2 个序列：主序列、序列 2.*完整所选序列.*共 2 个成片/s);
  await range.selectOption("review");
  assert.match(
    await summary.textContent(),
    /1 个序列：主序列.*范围：主序列 · <审核>&" · 0\.333688–1\.334688 秒.*共 1 个成片/s,
  );
  assert.doesNotMatch(await summary.textContent(), /序列 2/);
  assert.equal(await page.locator("[data-export-range-hint]").isVisible(), true);
  assert.equal(await main.isChecked(), true);
  assert.equal(await main.isDisabled(), true);
  assert.equal(await other.isChecked(), false);
  assert.equal(await other.isDisabled(), true);
  await range.selectOption("");
  assert.match(await summary.textContent(), /2 个序列：主序列、序列 2.*完整所选序列.*共 2 个成片/s);
  assert.equal(await page.locator("[data-export-range-hint]").isVisible(), false);
  assert.equal(await other.isChecked(), true);
  assert.equal(await other.isEnabled(), true);
  await range.selectOption("review");
  await page.locator('dialog [name="profiles"]').first().check();
  assert.match(await summary.textContent(), /1 个序列：主序列.*共 2 个成片/s);
  await page.locator('dialog [type="submit"]').click();
  await page.waitForFunction(() => fixture.exports.length === 2);
  const exports = await page.evaluate(() => fixture.exports);
  assert.equal(exports[0].sequenceId, exports[1].sequenceId);
  for (const item of exports) {
    assert.deepEqual(item.doc, before);
    assert.equal(item.sequenceId, "main");
    assert.deepEqual(item.range, { start: 80085, duration: 240240 });
  }
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.stored()), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

for (const width of [620, 390])
  test(`export summary at ${width}px wraps long sequence and profile names without blocking the bottom actions`, async (t) => {
    const page = await fixture(t, { width, sequenceCount: 2 });
    await page.evaluate(() =>
      fixture.dispatch(
        [
          {
            type: "sequence.rename",
            sequenceId: "main",
            name: '<序列>&"' + "很长的名称".repeat(28),
          },
          { type: "sequence.rename", sequenceId: "sequence-2", name: "另一条竖屏序列".repeat(20) },
        ],
        "序列名称",
      ),
    );
    await settle(page);
    await action(page, "export").click();
    await page.locator('dialog [name="presetName"]').fill("发送版".repeat(40));
    await page.locator('dialog [name="sequences"][value="sequence-2"]').check();
    await page.locator('dialog [name="profiles"][value="landscape-1080p"]').check();
    const summary = page.getByLabel("导出摘要", { exact: true });
    await summary.scrollIntoViewIfNeeded();
    assert.match(await summary.textContent(), /2 个序列：<序列>&".*共 4 个成片/s);
    assert.equal(await summary.locator("img,script").count(), 0);
    const bounds = await summary.evaluate((node) => {
      const rect = node.getBoundingClientRect(),
        dialog = node.closest("dialog");
      return {
        left: rect.left,
        right: rect.right,
        width: innerWidth,
        scrollWidth: dialog.scrollWidth,
        clientWidth: dialog.clientWidth,
      };
    });
    assert.ok(bounds.left >= -1 && bounds.right <= bounds.width + 1, JSON.stringify(bounds));
    assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, JSON.stringify(bounds));
    if (process.env.VIDEO_STUDIO_EXPORT_EVIDENCE_DIR) {
      await mkdir(process.env.VIDEO_STUDIO_EXPORT_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({
        path: join(process.env.VIDEO_STUDIO_EXPORT_EVIDENCE_DIR, `summary-${width}.png`),
      });
    }
    const submit = page.locator('dialog [type="submit"]');
    await submit.scrollIntoViewIfNeeded();
    assert.equal(
      await submit.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      }),
      true,
    );
    await saveDialog(page);
    assert.equal(await page.evaluate(() => fixture.exports.length), 4);
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
for (const [navigation, width] of [["start", 1240], ["timeline", 1240], ["list", 1240], ["start", 390]]) {
  test(`reselecting a marker through ${navigation} at ${width}px preserves its unfinished form`, async (t) => {
    const page = await fixture(t, { width });
    await page.evaluate(() => fixture.dispatch([{ type: "marker.add", sequenceId: "main", marker: {
      id: "review-draft", time: 80085, duration: 240240, name: "审核范围 · 长名称检查字幕、声音与画面落点", note: "原备注", color: "#ffcc00",
    } }], "添加审核范围"));
    await page.locator('[data-et-marker="review-draft"]').click();
    const before = await documentState(page), form = await page.locator(".emarker-form").elementHandle();
    await page.getByLabel("标记名称", { exact: true }).fill("尚未保存的新名称");
    await page.getByLabel("标记备注", { exact: true }).fill("第一行审核\n第二行字幕与声音");
    await page.getByLabel("开始（秒）", { exact: true }).fill("1.234567");
    if (navigation === "start") await page.getByRole("button", { name: "定位开始", exact: true }).click();
    else await page.locator(navigation === "timeline" ? '[data-et-marker="review-draft"]' : '[data-emarker-id="review-draft"]').click();
    await settle(page);
    assert.equal(await form.evaluate((node) => node === document.querySelector(".emarker-form") && node.isConnected), true);
    assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), "尚未保存的新名称");
    assert.equal(await page.getByLabel("标记备注", { exact: true }).inputValue(), "第一行审核\n第二行字幕与声音");
    assert.equal(await page.getByLabel("开始（秒）", { exact: true }).inputValue(), "1.234567");
    assert.equal(await page.evaluate(() => fixture.playhead()), 80085, "Navigation uses the saved marker, leaving its draft uncommitted");
    assert.deepEqual(await documentState(page), before);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
    if (width === 390) {
      const root = page.locator(".editor-markers");
      await root.scrollIntoViewIfNeeded();
      const overflow = await root.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return [...node.querySelectorAll("input,textarea,select,button")].flatMap((control) => {
          const bounds = control.getBoundingClientRect();
          return bounds.left >= box.left - 1 && bounds.right <= box.right + 1 ? [] : [{ label: control.getAttribute("aria-label") ?? control.textContent, left: bounds.left - box.left, right: bounds.right - box.right }];
        });
      });
      assert.deepEqual(overflow, []);
      const pane = page.locator(".ew-properties");
      await pane.evaluate((node) => {
        const marker = node.querySelector(".editor-markers");
        node.scrollTop += marker.getBoundingClientRect().top - node.getBoundingClientRect().top;
      });
      await pane.screenshot({ path: join(tmpdir(), "video-studio-marker-navigation-390-top.png") });
      await page.getByRole("button", { name: "保存标记", exact: true }).scrollIntoViewIfNeeded();
      await pane.screenshot({ path: join(tmpdir(), "video-studio-marker-navigation-390-bottom.png") });
    }
  });
}

test("reselecting the current marker keeps native IME connected until the user's normal blur and saves once", async (t) => {
  const page = await fixture(t), cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => fixture.dispatch([{ type: "marker.add", sequenceId: "main", marker: {
    id: "review-ime", time: 80085, duration: 240240, name: "原名称", note: "", color: "#ffcc00",
  } }], "添加审核范围"));
  await page.locator('[data-et-marker="review-ime"]').click();
  await page.getByLabel("标记备注", { exact: true }).fill("保留第一行\n保留第二行");
  const before = await documentState(page), name = page.getByLabel("标记名称", { exact: true }), form = await page.locator(".emarker-form").elementHandle();
  await name.fill("");
  await name.evaluate((node) => {
    globalThis.markerImeStarts = []; globalThis.markerImeEnds = []; globalThis.markerNameInput = node;
    node.addEventListener("compositionstart", (event) => markerImeStarts.push(event.isTrusted));
    node.addEventListener("compositionend", (event) => markerImeEnds.push(event.isTrusted));
  });
  await cdp.send("Input.imeSetComposition", { text: "中文审核", selectionStart: 4, selectionEnd: 4 });
  await page.evaluate(() => fixture.internals.workspace.markers.select("review-ime"));
  await settle(page);
  assert.equal(await form.evaluate((node) => node === document.querySelector(".emarker-form")), true);
  assert.equal(await page.evaluate(() => markerNameInput.isConnected && document.activeElement === markerNameInput), true);
  assert.deepEqual(await page.evaluate(() => markerImeStarts), [true]);
  assert.deepEqual(await page.evaluate(() => markerImeEnds), []);
  await cdp.send("Input.imeSetComposition", { text: "中文审核完成", selectionStart: 6, selectionEnd: 6 });
  await page.getByRole("button", { name: "定位开始", exact: true }).click();
  await settle(page);
  assert.equal(await page.evaluate(() => markerImeEnds.length), 1);
  assert.equal(await name.inputValue(), "中文审核完成");
  assert.equal(await page.getByLabel("标记备注", { exact: true }).inputValue(), "保留第一行\n保留第二行");
  assert.deepEqual(await documentState(page), before);
  await page.getByRole("button", { name: "保存标记", exact: true }).click();
  await settle(page);
  const saved = await documentState(page);
  assert.equal(saved.revision, before.revision + 1);
  assert.deepEqual(saved.sequences[0].markers[0], { ...before.sequences[0].markers[0], name: "中文审核完成", note: "保留第一行\n保留第二行" });
  await action(page, "undo").click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences, before.sequences);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

for (const frameRate of [{ numerator: 30, denominator: 1 }, { numerator: 30000, denominator: 1001 }]) {
  test(`marker navigation retains exact range ticks at ${frameRate.numerator}/${frameRate.denominator} fps and bounds the half-open end`, async (t) => {
    const page = await fixture(t, { frameRate });
    await page.evaluate(() => fixture.dispatch([
      { type: "marker.add", sequenceId: "main", marker: { id: "review-exact", time: 80085, duration: 240240, name: "精确范围", note: "", color: "#ffcc00" } },
      { type: "marker.add", sequenceId: "main", marker: { id: "review-tail", time: 480005, duration: 960000 - 480005, name: "直到结束", note: "", color: "#ffcc00" } },
    ], "添加精确审核范围"));
    const before = await documentState(page);
    await page.locator('[data-et-marker="review-exact"]').click(); await settle(page);
    assert.equal(await page.evaluate(() => fixture.playhead()), 80085);
    await page.getByRole("button", { name: "定位结束", exact: true }).click(); await settle(page);
    assert.equal(await page.evaluate(() => fixture.playhead()), 320325);
    await page.getByRole("button", { name: "定位开始", exact: true }).click(); await settle(page);
    assert.equal(await page.evaluate(() => fixture.playhead()), 80085);
    await page.locator('[data-emarker-id="review-tail"]').click(); await settle(page);
    assert.equal(await page.evaluate(() => fixture.playhead()), 480005);
    await page.getByRole("button", { name: "定位结束", exact: true }).click(); await settle(page);
    assert.equal(await page.evaluate(() => fixture.playhead()), 959999, "The range end stays exclusive and preview remains inside the sequence");
    assert.deepEqual(await documentState(page), before);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

for (const interruption of ["remove", "dispose"]) {
  test(`a marker selection observer that triggers ${interruption} cannot continue its former seek`, async (t) => {
    const page = await fixture(t);
    await page.evaluate((interruption) => {
      fixture.dispatch([{ type: "marker.add", sequenceId: "main", marker: { id: "removed-on-select", time: 80085, duration: 240240, name: "将删除范围", note: "", color: "#ffcc00" } }], "添加范围");
      const markers = fixture.internals.workspace.markers, observe = markers.context.onSelection;
      markers.context.onSelection = (id) => {
        if (id) {
          if (interruption === "remove") fixture.dispatch([{ type: "marker.remove", sequenceId: "main", markerId: id }], "同步删除范围");
          else markers.dispose();
        }
        observe(id);
      };
      markers.select("removed-on-select");
    }, interruption);
    await settle(page);
    assert.equal(await page.evaluate(() => fixture.playhead()), 0);
    assert.equal((await documentState(page)).sequences[0].markers.length, Number(interruption === "dispose"));
    assert.equal(await page.locator(".emarker-form").count(), 0);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

for (const scope of ["project", "sequence"]) {
  test(`old exact marker navigation remains inert after a ${scope} switch`, async (t) => {
    const page = await fixture(t, { sequenceCount: 2 });
    await page.evaluate(() => fixture.dispatch([{ type: "marker.add", sequenceId: "main", marker: {
      id: "scope-exact", time: 80085, duration: 240240, name: "旧审核范围", note: "", color: "#ffcc00",
    } }], "添加审核范围"));
    await page.locator('[data-et-marker="scope-exact"]').click();
    const start = await page.getByRole("button", { name: "定位开始", exact: true }).elementHandle(),
      end = await page.getByRole("button", { name: "定位结束", exact: true }).elementHandle();
    if (scope === "project") await page.evaluate(() => fixture.replaceProject());
    else await page.getByLabel("当前序列", { exact: true }).selectOption("sequence-2");
    await settle(page);
    const before = await documentState(page), time = await page.evaluate(() => fixture.playhead());
    await start.evaluate((node) => node.click()); await end.evaluate((node) => node.click());
    await settle(page);
    assert.equal(await page.evaluate(() => fixture.playhead()), time);
    assert.deepEqual(await documentState(page), before);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

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

test("material + near the 24-hour limit explains it is too long and changes nothing", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    fixture.dispatch(
      [
        {
          type: "clip.update",
          sequenceId: "main",
          clipId: "a",
          patch: { start: 24 * 3600 * 240000 - 5 * 240000 },
        },
      ],
      "移到末尾",
    ),
  );
  await settle(page);
  const before = await documentState(page);
  await page.locator('[data-ew-asset="demo"]').click();
  await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), [
    "Error: 加入素材后超出时长上限（24 小时）",
  ]);
});

for (const clipCount of [1000, 5000]) {
  test(`${clipCount} legal clips share one isolated snapshot and one prepared canvas evaluator per frame`, async (t) => {
    const page = await fixture(t, { clipCount });
    const result = await page.evaluate(async () => {
      const { session, workspace } = fixture.internals;
      workspace.selectClips("main", ["a"]);
      await workspace.seek(0);
      const callback = workspace.preview.options.onFrame,
        prepared = workspace.canvasEditor.prepared.evaluator,
        field = document.querySelector('[aria-label="水平位置（%）"]'),
        read = session.read.bind(session),
        snapshots = [],
        costs = [];
      let reads = 0;
      session.read = () => {
        reads++;
        const document = read();
        snapshots.push(document);
        return document;
      };
      for (let index = 0; index < 3; index++) callback((index % 2) * 8000);
      reads = 0;
      snapshots.length = 0;
      for (let index = 0; index < 20; index++) {
        const start = performance.now();
        callback((index % 2) * 8000);
        costs.push(performance.now() - start);
      }
      const frameReads = reads,
        frameCount = snapshots.length,
        unchangedEvaluator = prepared === workspace.canvasEditor.prepared.evaluator,
        unchangedField = field === document.querySelector('[aria-label="水平位置（%）"]'),
        frameSnapshot = snapshots.at(-1);
      const seekCosts = [];
      for (let index = 0; index < 8; index++) {
        const start = performance.now();
        await workspace.seek((index % 2) * 8000);
        seekCosts.push(performance.now() - start);
      }
      const detached = workspace.inspector.context.read();
      detached.name = "caller mutation";
      const detachedRead = detached !== frameSnapshot && session.read().name !== detached.name;
      const timingRender = workspace.timing.render;
      let rejected = false;
      workspace.timing.render = () => {
        throw new Error("deliberate view failure");
      };
      try {
        callback(0);
      } catch {
        rejected = true;
      }
      workspace.timing.render = timingRender;
      const failedSnapshot = snapshots.at(-1),
        releasedAfterError = workspace.inspector.context.read() !== failedSnapshot;
      session.read = read;
      const freeze = (value) => {
        if (value && typeof value === "object" && !Object.isFrozen(value)) {
          Object.values(value).forEach(freeze);
          Object.freeze(value);
        }
        return value;
      };
      session.read = () => freeze(read());
      workspace.inspector.renderedSignature = "";
      workspace.timing.signature = "";
      workspace.sequences.signature = "";
      try {
        callback(0);
      } finally {
        session.read = read;
      }
      const revision = session.getState().identity.revision;
      session.dispatch(
        [{ type: "clip.update", sequenceId: "main", clipId: "a", patch: {
          transform: { ...session.read().sequences[0].clips[0].transform, x: 0.2 },
        } }],
        session.getState().identity,
        "画面变化",
      );
      await workspace.seek(0);
      return {
        frameReads,
        frameCount,
        unchangedEvaluator,
        unchangedField,
        detachedRead,
        rejected,
        releasedAfterError,
        revision: session.read().revision,
        expectedRevision: revision + 1,
        evaluatorChanged: prepared !== workspace.canvasEditor.prepared.evaluator,
        targetX: workspace.canvasEditor.targets[0].layer.transform.x,
        mean: costs.reduce((sum, value) => sum + value, 0) / costs.length,
        seekMean: seekCosts.reduce((sum, value) => sum + value, 0) / seekCosts.length,
        p95: costs.toSorted((a, b) => a - b)[18],
        errors: fixture.errors,
      };
    });
    assert.equal(result.frameReads, 20);
    assert.equal(result.frameCount, 20);
    for (const key of [
      "unchangedEvaluator", "unchangedField", "detachedRead",
      "rejected", "releasedAfterError", "evaluatorChanged",
    ])
      assert.equal(result[key], true, key);
    assert.equal(result.revision, result.expectedRevision);
    assert.equal(result.targetX, 0.2);
    assert.deepEqual(result.errors, []);
    t.diagnostic(
      `Chromium ${clipCount} clips: frame view mean ${result.mean.toFixed(2)}ms, ` +
      `p95 ${result.p95.toFixed(2)}ms; real seek ${result.seekMean.toFixed(2)}ms`,
    );
  });
}


test("opening a new generation replaces an unfinished project-name draft instead of renaming the successor on blur", async (t) => {
  const page = await fixture(t);
  const input = page.getByLabel("工程名称", { exact: true });
  await input.fill("上个工程的未提交名称");
  await page.evaluate(() => fixture.externalEdit());
  assert.equal(await input.inputValue(), "上个工程的未提交名称");
  await page.evaluate(() => fixture.replaceGeneration("已打开的工程名称"));
  assert.equal(await input.inputValue(), "已打开的工程名称");
  await input.blur();
  await page.evaluate(() => fixture.flush());
  assert.equal((await documentState(page)).name, "已打开的工程名称");
  assert.equal((await page.evaluate(() => fixture.stored())).name, "已打开的工程名称");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("durable timeline cut retains the old clipboard and selection after storage failure, retries once and undoes once", async (t) => {
  const page = await fixture(t, { narration: true });
  await page.evaluate(async () => {
    const b = structuredClone(fixture.read().sequences[0].clips[0]);
    b.id = b.label = "b";
    b.start = b.duration * 3;
    fixture.dispatch([{ type: "clip.add", sequenceId: "main", clip: b }], "另一个片段");
    await fixture.flush();
  });
  await clip(page, "b").click();
  await page.keyboard.press("Control+c");
  await clip(page, "a").click();
  const before = await documentState(page),
    writesBefore = await page.evaluate(() => fixture.writes.length);
  await page.evaluate(() => fixture.writeMode("fail"));
  await page.keyboard.press("Control+x");
  await page.waitForFunction(
    () => fixture.errors.length === 1 && fixture.state().phase === "ready",
  );
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.stored()), before);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
  assert.match(await page.locator("[data-ew-save]").textContent(), /保存失败.*重试原操作/);
  assert.equal(await page.evaluate(() => fixture.writes.length), writesBefore + 1);
  assert.equal(await page.locator('[data-et-action="paste"]').isDisabled(), false);
  await page.evaluate(() => fixture.writeMode("normal"));
  await page.evaluate(() => fixture.internals.workspace.seek(960001, true));
  await page.locator('[data-et-action="paste"]').click();
  await page.waitForFunction(() => fixture.read().sequences[0].clips.length === 3);
  const copied = (await documentState(page)).sequences[0].clips.find(
    (value) => !["a", "b"].includes(value.id),
  );
  assert.equal(copied.label, "b", "Failed cut must not replace the previous copy snapshot");
  assert.equal(copied.start, 960001);
  await action(page, "undo").click();
  await page.evaluate(() => fixture.flush());
  assert.deepEqual(semantic(await documentState(page)), semantic(before));
  await clip(page, "a").click();
  const retryBase = await documentState(page),
    retryWrites = await page.evaluate(() => fixture.writes.length);
  await page.evaluate(() => fixture.writeMode("hold"));
  await page.keyboard.press("Control+x");
  await page.waitForFunction(() => fixture.state().phase === "committing");
  assert.deepEqual(await documentState(page), retryBase);
  assert.deepEqual(await page.evaluate(() => fixture.stored()), retryBase);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
  await page.keyboard.press("Control+x");
  await page.keyboard.press("Control+d");
  assert.equal(await page.evaluate(() => fixture.writes.length), retryWrites + 1);
  await page.evaluate(() => fixture.releaseWrite());
  await page.waitForFunction(
    () => fixture.selection().length === 0 && fixture.state().phase === "ready",
  );
  const cut = await documentState(page);
  assert.equal(cut.revision, retryBase.revision + 1);
  assert.deepEqual(
    cut.sequences[0].clips.map((value) => value.id),
    ["b"],
  );
  assert.equal(cut.production.narration.phase, "review");
  assert.equal(cut.production.narrationPreviousApproval.approvedFingerprint, "approved-original");
  assert.deepEqual(await page.evaluate(() => fixture.stored()), cut);
  await action(page, "undo").click();
  await page.evaluate(() => fixture.flush());
  assert.deepEqual(semantic(await documentState(page)), semantic(retryBase));
  assert.deepEqual(await page.evaluate(() => fixture.stored()), await documentState(page));
  assert.equal((await page.evaluate(() => fixture.errors)).length, 1);
});

for (const operation of ["paste", "duplicate"])
  test(`durable timeline ${operation} keeps the real session unchanged on failure and persists one retry with one undo`, async (t) => {
    const page = await fixture(t, { emptySequence: operation === "paste" });
    await clip(page).click();
    await page.keyboard.press("Control+c");
    if (operation === "paste") {
      await page.locator("[data-ew-sequence]").selectOption("empty");
      await page.evaluate(() => fixture.flush());
    }
    const before = await documentState(page),
      selected = await page.evaluate(() => fixture.selection()),
      writes = await page.evaluate(() => fixture.writes.length);
    await page.evaluate(() => fixture.writeMode("fail"));
    await page.locator(`[data-et-action="${operation}"]`).click();
    await page.waitForFunction(
      () => fixture.errors.length === 1 && fixture.state().phase === "ready",
    );
    assert.deepEqual(await documentState(page), before);
    assert.deepEqual(await page.evaluate(() => fixture.stored()), before);
    assert.deepEqual(await page.evaluate(() => fixture.selection()), selected);
    await page.evaluate(() => fixture.writeMode("hold"));
    await page.locator(`[data-et-action="${operation}"]`).click();
    await page.waitForFunction(() => fixture.state().phase === "committing");
    assert.deepEqual(await documentState(page), before);
    assert.deepEqual(await page.evaluate(() => fixture.stored()), before);
    assert.deepEqual(await page.evaluate(() => fixture.selection()), selected);
    await page.locator("[data-ew-timeline]").focus();
    await page.keyboard.press(operation === "paste" ? "Control+v" : "Control+d");
    assert.equal(await page.evaluate(() => fixture.writes.length), writes + 2);
    await page.evaluate(() => fixture.releaseWrite());
    await page.waitForFunction(
      () => fixture.selection().length === 1 && fixture.state().phase === "ready",
    );
    const after = await documentState(page),
      sequence = after.sequences.find((value) => value.id === after.activeSequenceId);
    assert.equal(after.revision, before.revision + 1);
    assert.equal(sequence.clips.length, operation === "paste" ? 1 : 2);
    assert.notEqual((await page.evaluate(() => fixture.selection()))[0], "a");
    assert.deepEqual(await page.evaluate(() => fixture.stored()), after);
    await action(page, "undo").click();
    await page.evaluate(() => fixture.flush());
    assert.deepEqual(semantic(await documentState(page)), semantic(before));
    assert.deepEqual(await page.evaluate(() => fixture.stored()), await documentState(page));
    assert.equal((await page.evaluate(() => fixture.errors)).length, 1);
  });

test("detached marker navigation cannot move the playhead of a replacement generation", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => fixture.dispatch([{ type: "marker.add", sequenceId: "main", marker: { id: "review-scope", time: 240000, duration: 240000, name: "旧范围", note: "", color: "#ffcc00" } }], "标记"));
  await page.locator('[data-et-marker="review-scope"]').click();
  const old = await page.getByRole("button", { name: "定位结束", exact: true }).elementHandle();
  await page.evaluate(() => fixture.replaceGeneration());
  const before = await page.evaluate(() => fixture.playhead());
  await old.evaluate((button) => button.click());
  assert.equal(await page.evaluate(() => fixture.playhead()), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});


test("actual session replacement clears sequence and timing forms and fences their old buttons", async (t) => {
  const page = await fixture(t);
  await clip(page).click();
  await action(page, "sequences").click();
  await page.getByLabel("序列名称", { exact: true }).fill("旧工程序列草稿");
  await page.getByLabel("恒定速度（倍）", { exact: true }).fill("2");
  const rename = await page.getByRole("button", { name: "重命名序列", exact: true }).elementHandle();
  const speed = await page.getByRole("button", { name: "应用恒定速度", exact: true }).elementHandle();
  await page.evaluate(() => fixture.replaceGeneration());
  const expected = await documentState(page);
  await rename.evaluate((button) => button.click());
  await speed.evaluate((button) => button.click());
  await settle(page);
  assert.deepEqual(await documentState(page), expected);
  assert.equal(await page.getByLabel("序列名称", { exact: true }).inputValue(), expected.sequences[0].name);
  assert.equal(await page.getByLabel("恒定速度（倍）", { exact: true }).inputValue(), "1");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a late old marker seek failure does not report against a replacement session", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    fixture.dispatch([{ type: "marker.add", sequenceId: "main", marker: { id: "late-seek", time: 240000, duration: 0, name: "延迟定位", note: "", color: "#ffcc00" } }], "标记");
    fixture.internals.workspace.markers.context.seek = () => new Promise((_resolve, reject) => globalThis.rejectOldMarkerSeek = reject);
  });
  await page.locator('[data-et-marker="late-seek"]').click();
  await page.evaluate(async () => {
    await fixture.replaceGeneration();
    rejectOldMarkerSeek(new Error("旧定位失败"));
    await Promise.resolve();
  });
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  assert.equal(await page.getByLabel("标记名称", { exact: true }).count(), 0);
});

test("playhead jump uses the actual NTSC frame clock and reveals a long timeline without editing", async (t) => {
  const page = await fixture(t, { duration: 120 * 240000, frameRate: { numerator: 60000, denominator: 1001 } });
  await clip(page).click();
  const before = await documentState(page), selection = await page.evaluate(() => fixture.selection());
  await action(page, "jump-playhead").click();
  await page.getByLabel("定位单位", { exact: true }).selectOption("frames");
  await page.getByLabel("定位位置", { exact: true }).fill("1800");
  await page.getByRole("button", { name: "定位", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("dialog"));
  assert.equal(await page.evaluate(() => fixture.playhead()), 1800 * 4004);
  assert.equal(await page.locator("[data-ew-time]").innerText(), "00:30.03");
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), selection);
  const bounds = await page.locator(".et-scroll").evaluate((node) => {
    const viewport = node.getBoundingClientRect(), line = node.querySelector(".et-playhead").getBoundingClientRect();
    return { scroll: node.scrollLeft, left: viewport.left, right: viewport.right, clock: line.left };
  });
  assert.ok(bounds.scroll > 0);
  assert.ok(bounds.clock >= bounds.left && bounds.clock <= bounds.right, JSON.stringify(bounds));
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("seconds jump preserves exact ticks and minute carry while cancel and invalid entries leave the clock alone", async (t) => {
  const page = await fixture(t, { duration: 120 * 240000, sandbox: true });
  const before = await documentState(page);
  await action(page, "jump-playhead").click();
  await page.getByLabel("定位位置", { exact: true }).fill("0.000004");
  await page.getByLabel("定位位置", { exact: true }).press("Enter");
  await page.waitForFunction(() => !document.querySelector("dialog"));
  assert.equal(await page.evaluate(() => fixture.playhead()), 1);
  await action(page, "jump-playhead").click();
  assert.equal(await page.getByLabel("定位位置", { exact: true }).inputValue(), "0.000004");
  await page.getByLabel("定位位置", { exact: true }).fill("59.999996");
  await page.getByRole("button", { name: "定位", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("dialog"));
  assert.equal(await page.evaluate(() => fixture.playhead()), 60 * 240000 - 1);
  assert.equal(await page.locator("[data-ew-time]").innerText(), "01:00.00");
  await action(page, "jump-playhead").click();
  await page.getByLabel("定位位置", { exact: true }).fill("120");
  await page.getByRole("button", { name: "定位", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".ew-form-error").textContent.includes("超出"));
  assert.equal(await page.evaluate(() => fixture.playhead()), 60 * 240000 - 1);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("jump unit conversion uses the containing frame and opening the dialog pauses playback", async (t) => {
  const page = await fixture(t, { frameRate: { numerator: 30000, denominator: 1001 } });
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.playing() && fixture.playhead() > 0);
  await action(page, "jump-playhead").click();
  assert.equal(await page.evaluate(() => fixture.playing()), false);
  await page.getByLabel("定位位置", { exact: true }).fill("1.02");
  await page.getByLabel("定位单位", { exact: true }).selectOption("frames");
  assert.equal(await page.getByLabel("定位位置", { exact: true }).inputValue(), "30");
  await page.getByLabel("定位单位", { exact: true }).selectOption("seconds");
  assert.equal(await page.getByLabel("定位位置", { exact: true }).inputValue(), "1.001000");
  await page.getByRole("button", { name: "定位", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("dialog"));
  assert.equal(await page.evaluate(() => fixture.playhead()), 240240);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("jump controls cannot seek a replacement generation or a different viewed sequence", async (t) => {
  const page = await fixture(t);
  await action(page, "jump-playhead").click();
  await page.getByLabel("定位位置", { exact: true }).fill("1");
  const before = await page.evaluate(async () => {
    const { session } = fixture.internals;
    await session.replace(session.read());
    return session.read();
  });
  await page.getByRole("button", { name: "定位", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".ew-form-error").textContent.includes("重新打开"));
  assert.equal(await page.evaluate(() => fixture.playhead()), 0);
  assert.deepEqual(await documentState(page), before);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => {
    const next = structuredClone(fixture.read().sequences[0]);
    next.id = "other"; next.name = "另一序列";
    fixture.dispatch([{ type: "sequence.add", sequence: next }], "添加序列");
  });
  await action(page, "jump-playhead").click();
  await page.getByLabel("定位位置", { exact: true }).fill("2");
  await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "other" }], "切换序列"));
  await page.getByRole("button", { name: "定位", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".ew-form-error").textContent.includes("重新打开"));
  assert.equal(await page.evaluate(() => fixture.playhead()), 0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => fixture.dispatch([{ type: "clip.remove", sequenceId: "other", clipIds: ["a"] }], "删除片段"));
  await page.evaluate(() => fixture.internals.workspace.selectClips("other", []));
  assert.equal(await action(page, "jump-playhead").isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

async function transitionWorkflowFixture(t, options = {}) {
  const page = await fixture(t, options);
  await page.evaluate(() => {
    const operations = fixture.read().sequences.flatMap((sequence) => ["b", "c"].map((id, index) => ({
      type: "clip.add", sequenceId: sequence.id,
      clip: { ...sequence.clips[0], id, label: id, start: (index + 1) * 4 * 240000 },
    })));
    fixture.dispatch(operations, "添加相邻画面");
  });
  await settle(page);
  await page.locator(".editor-timing").getByText("相邻转场", { exact: true }).click();
  return page;
}

test("an explicitly chosen transition pair stays selected across add, adjust, remove and each undo", async (t) => {
  const page = await transitionWorkflowFixture(t), before = await documentState(page),
    pair = page.getByLabel("相邻片段", { exact: true }), duration = page.getByLabel("转场时长（秒）", { exact: true });
  await pair.selectOption("1"); await duration.fill("0.75");
  await page.getByLabel("转场效果", { exact: true }).selectOption("wipe-right");
  await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
  assert.equal(await pair.inputValue(), "1");
  assert.equal(await duration.inputValue(), "0.75");
  assert.equal(await page.getByLabel("转场效果", { exact: true }).inputValue(), "wipe-right");
  let transition = (await documentState(page)).sequences[0].transitions[0];
  assert.equal(transition.fromClipId, "b"); assert.equal(transition.toClipId, "c");
  await duration.fill("0.5"); await page.getByRole("button", { name: "应用转场调整", exact: true }).click(); await settle(page);
  assert.equal(await pair.inputValue(), "1"); assert.equal(await duration.inputValue(), "0.5");
  // Removing a saved transition does not validate an unrelated unfinished duration edit.
  await duration.fill(""); await page.getByRole("button", { name: "移除转场并接成硬切", exact: true }).click(); await settle(page);
  assert.equal(await pair.inputValue(), "1");
  assert.equal((await documentState(page)).sequences[0].transitions.length, 0);
  assert.deepEqual((await documentState(page)).sequences, before.sequences);
  await action(page, "undo").click(); await settle(page);
  assert.equal(await pair.inputValue(), "1"); assert.equal(await duration.inputValue(), "0.5");
  await action(page, "undo").click(); await settle(page);
  assert.equal(await pair.inputValue(), "1"); assert.equal(await duration.inputValue(), "0.75");
  await action(page, "undo").click(); await settle(page);
  assert.equal(await pair.inputValue(), "1");
  assert.deepEqual((await documentState(page)).sequences, before.sequences);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("transition pair ownership survives ordinary revisions but resets for real selection, sequence and generation changes", async (t) => {
  const page = await transitionWorkflowFixture(t, { sequenceCount: 2 }), pair = page.getByLabel("相邻片段", { exact: true });
  await pair.selectOption("1"); await page.evaluate(() => fixture.externalEdit()); await settle(page);
  assert.equal(await pair.inputValue(), "1");
  await page.evaluate(() => fixture.internals.workspace.selectClips("main", ["a"])); await settle(page);
  assert.equal(await pair.inputValue(), "0");
  await page.evaluate(() => fixture.internals.workspace.selectClips("main", [])); await settle(page);
  await pair.selectOption("1");
  await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "切换序列")); await settle(page);
  assert.equal(await pair.inputValue(), "0");
  await pair.selectOption("1");
  await page.evaluate(() => fixture.replaceGeneration()); await settle(page);
  assert.equal(await pair.inputValue(), "0");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a restored same-id same-revision generation cannot inherit transition pair state or detached picker changes", async (t) => {
  const page = await transitionWorkflowFixture(t), before = await documentState(page),
    pair = page.getByLabel("相邻片段", { exact: true });
  await pair.selectOption("1"); const old = await pair.elementHandle(), identity = await page.evaluate(() => fixture.state().identity);
  await page.evaluate(async (before) => {
    await fixture.internals.session.replace({ ...before, id: "temporary-transition-document" });
    await fixture.internals.session.replace(before);
  }, before); await settle(page);
  assert.equal(await pair.inputValue(), "0");
  assert.notEqual((await page.evaluate(() => fixture.state().identity)).generation, identity.generation);
  assert.deepEqual(await documentState(page), before);
  await pair.selectOption("1");
  await old.evaluate((node) => { node.value = "0"; node.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.evaluate(() => fixture.externalEdit()); await settle(page);
  assert.equal(await pair.inputValue(), "1");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a remembered transition pair is discarded when adjacency changes and locking remains atomic", async (t) => {
  const page = await transitionWorkflowFixture(t), pair = page.getByLabel("相邻片段", { exact: true });
  await pair.selectOption("1");
  await page.evaluate(() => fixture.dispatch([{ type: "clip.move", sequenceId: "main", clipIds: ["b"], delta: 8 * 240000 }], "移动画面"));
  await settle(page);
  assert.equal(await pair.inputValue(), "0");
  assert.match(await pair.locator("option:checked").textContent(), /a → c/);
  const stale = await page.getByRole("button", { name: "添加转场", exact: true }).elementHandle();
  await page.evaluate(() => fixture.dispatch([{ type: "track.update", sequenceId: "main", trackId: "video", patch: { locked: true } }], "锁定画面轨"));
  await settle(page); const before = await documentState(page);
  assert.equal(await page.getByRole("button", { name: "添加转场", exact: true }).isDisabled(), true);
  await stale.evaluate((node) => node.click()); await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

async function markerDraftFixture(t, options = {}) {
  const page = await fixture(t, options);
  await page.evaluate(() => fixture.dispatch([{ type: "marker.add", sequenceId: "main", marker: {
    id: "draft-review", time: 80085, duration: 240240, name: "审核范围", note: "原始备注", color: "#ffcc0088",
  } }], "添加审核范围"));
  await page.locator('[data-et-marker="draft-review"]').click();
  await settle(page);
  return page;
}
for (const creating of [false, true]) {
  test(`an external revision preserves the connected ${creating ? "new" : "selected"} marker draft until an explicit save`, async (t) => {
    const page = await markerDraftFixture(t);
    if (creating) await page.getByRole("button", { name: "添加范围", exact: true }).click();
    await page.getByLabel("标记备注", { exact: true }).fill("第一行未保存\n第二行中文，[*]$");
    await page.getByLabel("标记颜色", { exact: true }).fill("#1234");
    await page.getByLabel("标记名称", { exact: true }).fill("待保存的校对范围");
    const form = await page.locator(".emarker-form").elementHandle(), before = await documentState(page);
    await page.evaluate(() => fixture.externalEdit()); await settle(page);
    const updated = await documentState(page);
    assert.equal(await form.evaluate((node) => node.isConnected && node === document.querySelector(".emarker-form")), true);
    assert.equal(await page.getByLabel("标记名称", { exact: true }).evaluate((node) => document.activeElement === node), true);
    assert.equal(await page.getByLabel("标记备注", { exact: true }).inputValue(), "第一行未保存\n第二行中文，[*]$");
    assert.equal(await page.getByRole("button", { name: creating ? "添加标记" : "保存标记", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "保存当前草稿", exact: true }).isEnabled(), true);
    assert.match(await page.locator('.emarker-form [role="status"]').innerText(), /工程已更新，草稿已保留/);
    await page.getByLabel("标记名称", { exact: true }).press("Enter");
    assert.deepEqual(await documentState(page), updated);
    await page.getByRole("button", { name: "保存当前草稿", exact: true }).click(); await settle(page);
    const saved = await documentState(page), marker = saved.sequences[0].markers.find((item) => item.name === "待保存的校对范围");
    assert.equal(saved.revision, updated.revision + 1);
    assert.equal(marker.note, "第一行未保存\n第二行中文，[*]$");
    assert.equal(marker.color, "#1234");
    if (!creating) assert.deepEqual([marker.time, marker.duration], [80085, 240240]);
    assert.equal(saved.name, updated.name);
    await action(page, "undo").click(); await settle(page);
    assert.deepEqual((await documentState(page)).sequences, before.sequences);
    assert.equal((await documentState(page)).name, updated.name);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}
for (const creating of [false, true]) {
  test(`native IME survives a background revision in a ${creating ? "new" : "selected"} marker form`, async (t) => {
    const page = await markerDraftFixture(t);
    if (creating) await page.getByRole("button", { name: "添加范围", exact: true }).click();
    await page.getByLabel("标记备注", { exact: true }).fill("保持多行\n未提交备注");
    const input = page.getByLabel("标记名称", { exact: true }), form = await page.locator(".emarker-form").elementHandle(),
      cdp = await page.context().newCDPSession(page);
    await input.fill("");
    await input.evaluate((node) => {
      globalThis.markerDraftIme = { starts: [], ends: [], input: node };
      node.addEventListener("compositionstart", (event) => markerDraftIme.starts.push(event.isTrusted));
      node.addEventListener("compositionend", (event) => markerDraftIme.ends.push(event.data));
    });
    await cdp.send("Input.imeSetComposition", { text: "正在中文校对", selectionStart: 6, selectionEnd: 6 });
    await page.evaluate(() => fixture.externalEdit()); await settle(page);
    assert.equal(await form.evaluate((node) => node === document.querySelector(".emarker-form")), true);
    assert.deepEqual(await page.evaluate(() => ({ starts: markerDraftIme.starts, ends: markerDraftIme.ends,
      focused: document.activeElement === markerDraftIme.input })), { starts: [true], ends: [], focused: true });
    await cdp.send("Input.imeSetComposition", { text: "中文校对完成", selectionStart: 6, selectionEnd: 6 });
    await cdp.send("Input.insertText", { text: "中文校对完成" });
    await page.getByRole("button", { name: "保存当前草稿", exact: true }).click(); await settle(page);
    assert.deepEqual(await page.evaluate(() => markerDraftIme.ends), ["中文校对完成"]);
    const marker = (await documentState(page)).sequences[0].markers.find((item) => item.name === "中文校对完成");
    assert.ok(marker, JSON.stringify({ document: await documentState(page), errors: await page.evaluate(() => fixture.errors), value: await input.inputValue() }));
    assert.equal(marker.note, "保持多行\n未提交备注");
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}
for (const patch of [{ name: "外部名称" }, { note: "外部备注" }, { time: 80086 }, { duration: 240241 }, { color: "#123456" }]) {
  test(`a retained marker draft cannot overwrite an externally changed ${Object.keys(patch)[0]}`, async (t) => {
    const page = await markerDraftFixture(t);
    await page.getByLabel("标记名称", { exact: true }).fill("本地未保存名称");
    const form = await page.locator(".emarker-form").elementHandle();
    await page.evaluate((patch) => fixture.dispatch([{ type: "marker.update", sequenceId: "main", markerId: "draft-review", patch }], "外部标记修改"), patch);
    await settle(page);
    assert.equal(await form.evaluate((node) => node.isConnected), true);
    assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), "本地未保存名称");
    assert.equal(await page.getByRole("button", { name: "保存当前草稿", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "定位结束", exact: true }).isDisabled(), true);
    assert.match(await page.locator('.emarker-form [role="status"]').innerText(), /标记已被其他编辑修改/);
    const current = await documentState(page);
    await page.getByRole("button", { name: "保存当前草稿", exact: true }).evaluate((node) => node.dispatchEvent(new Event("click")));
    assert.deepEqual(await documentState(page), current);
    await page.getByRole("button", { name: "载入最新（放弃草稿）", exact: true }).click();
    assert.equal(await form.evaluate((node) => node.isConnected), false);
    assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), patch.name ?? "审核范围");
    assert.equal(await page.getByRole("button", { name: "保存标记", exact: true }).isEnabled(), true);
    assert.deepEqual(await documentState(page), current);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}
test("an externally deleted marker keeps its draft available to discard without resurrecting it", async (t) => {
  const page = await markerDraftFixture(t);
  await page.getByLabel("标记备注", { exact: true }).fill("删除后仍保留的草稿\n第二行");
  await page.evaluate(() => fixture.dispatch([{ type: "marker.remove", sequenceId: "main", markerId: "draft-review" }], "外部删除"));
  await settle(page);
  assert.match(await page.locator('.emarker-form [role="status"]').innerText(), /标记已删除/);
  assert.equal(await page.getByRole("button", { name: "保存当前草稿", exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("标记备注", { exact: true }).inputValue(), "删除后仍保留的草稿\n第二行");
  await page.getByRole("button", { name: "载入最新（放弃草稿）", exact: true }).click();
  assert.equal(await page.locator(".emarker-form").count(), 0);
  assert.deepEqual((await documentState(page)).sequences[0].markers, []);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});
test("a new marker draft cannot overwrite an ID claimed by another editor", async (t) => {
  const page = await markerDraftFixture(t);
  await page.getByRole("button", { name: "添加范围", exact: true }).click();
  await page.getByLabel("标记名称", { exact: true }).fill("本地新范围");
  await page.evaluate(() => {
    const marker = fixture.internals.workspace.markers.draft;
    fixture.dispatch([{ type: "marker.add", sequenceId: "main", marker: { ...marker, name: "其他编辑先保存" } }], "外部添加");
  });
  await settle(page);
  assert.match(await page.locator('.emarker-form [role="status"]').innerText(), /同一标记 ID 已存在/);
  assert.equal(await page.getByRole("button", { name: "保存当前草稿", exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), "本地新范围");
  await page.getByRole("button", { name: "载入最新（放弃草稿）", exact: true }).click();
  assert.equal(await page.locator(".emarker-form").count(), 0);
  assert.equal((await documentState(page)).sequences[0].markers.at(-1).name, "其他编辑先保存");
});
test("an explicit marker draft save rechecks a revision that changes synchronously during its fresh read", async (t) => {
  const page = await markerDraftFixture(t);
  await page.getByLabel("标记名称", { exact: true }).fill("保留待重试");
  await page.evaluate(() => fixture.externalEdit()); await settle(page);
  await page.evaluate(() => {
    const context = fixture.internals.workspace.markers.context, read = context.read;
    context.read = () => {
      context.read = read;
      const before = read(); fixture.externalEdit(); return before;
    };
  });
  await page.getByRole("button", { name: "保存当前草稿", exact: true }).click(); await settle(page);
  assert.equal((await documentState(page)).sequences[0].markers[0].name, "审核范围");
  assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), "保留待重试");
  assert.match((await page.evaluate(() => fixture.errors)).at(-1), /工程已变化/);
  await page.getByRole("button", { name: "保存当前草稿", exact: true }).click(); await settle(page);
  assert.equal((await documentState(page)).sequences[0].markers[0].name, "保留待重试");
});
for (const scope of ["generation", "sequence"]) {
  test(`retained marker drafts and detached explicit-save actions end at a ${scope} boundary`, async (t) => {
    const page = await markerDraftFixture(t, { sequenceCount: 2 });
    await page.getByLabel("标记名称", { exact: true }).fill("不能迁移的草稿");
    await page.evaluate(() => fixture.externalEdit()); await settle(page);
    const form = await page.locator(".emarker-form").elementHandle(), save = await page.getByRole("button", { name: "保存当前草稿", exact: true }).elementHandle();
    if (scope === "generation") await page.evaluate(() => fixture.replaceGeneration());
    else await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "切换序列"));
    await settle(page);
    const before = await documentState(page);
    assert.equal(await form.evaluate((node) => node.isConnected), false);
    await save.evaluate((node) => node.dispatchEvent(new Event("click")));
    await form.evaluate((node) => node.dispatchEvent(new Event("submit", { cancelable: true })));
    await settle(page);
    assert.deepEqual(await documentState(page), before);
    assert.equal(await page.locator(".emarker-form").count(), 0);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}
test("a rejected explicit marker save retains a correctable draft for one successful retry", async (t) => {
  const page = await markerDraftFixture(t);
  await page.getByLabel("标记名称", { exact: true }).fill("失败后重试草稿");
  await page.evaluate(() => fixture.externalEdit()); await settle(page);
  const before = await documentState(page);
  await page.evaluate(() => {
    const context = fixture.internals.workspace.markers.context;
    globalThis.restoreMarkerApply = context.apply;
    context.apply = async () => { throw new Error("标记提交失败"); };
  });
  await page.getByRole("button", { name: "保存当前草稿", exact: true }).click(); await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), "失败后重试草稿");
  assert.equal(await page.getByLabel("标记名称", { exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "保存当前草稿", exact: true }).isEnabled(), true);
  await page.evaluate(() => fixture.internals.workspace.markers.context.apply = restoreMarkerApply);
  await page.getByRole("button", { name: "保存当前草稿", exact: true }).click(); await settle(page);
  assert.equal((await documentState(page)).revision, before.revision + 1);
  assert.equal((await documentState(page)).sequences[0].markers[0].name, "失败后重试草稿");
});
test("a retained marker draft at 390px keeps its notice and explicit choices inside the pane", async (t) => {
  const page = await markerDraftFixture(t, { width: 390 });
  await page.getByLabel("标记备注", { exact: true }).fill("长备注第一行\n长备注第二行");
  await page.getByLabel("标记名称", { exact: true }).fill("窄屏校对中的长标记草稿名称");
  await page.evaluate(() => fixture.externalEdit()); await settle(page);
  await page.locator('.emarker-form [role="status"]').scrollIntoViewIfNeeded();
  const bounds = await page.locator(".editor-markers").evaluate((root) => ({ client: root.clientWidth, scroll: root.scrollWidth,
    actions: [...root.querySelectorAll('.emarker-form button')].map((button) => ({ left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right })),
    left: root.getBoundingClientRect().left, right: root.getBoundingClientRect().right }));
  assert.ok(bounds.scroll <= bounds.client + 1, JSON.stringify(bounds));
  assert.ok(bounds.actions.every((button) => button.left >= bounds.left && button.right <= bounds.right), JSON.stringify(bounds));
  await page.screenshot({ path: join(tmpdir(), "video-studio-marker-draft-390.png") });
});

test("a restored full marker baseline allows an explicit save after an external undo", async (t) => {
  const page = await markerDraftFixture(t);
  await page.getByLabel("标记名称", { exact: true }).fill("本地草稿仍在");
  await page.evaluate(() => fixture.dispatch([{ type: "marker.update", sequenceId: "main", markerId: "draft-review", patch: { color: "#123456" } }], "外部调色"));
  assert.equal(await page.getByRole("button", { name: "保存当前草稿", exact: true }).isDisabled(), true);
  await page.evaluate(() => fixture.internals.session.undo()); await settle(page);
  assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), "本地草稿仍在");
  assert.equal(await page.getByRole("button", { name: "保存当前草稿", exact: true }).isEnabled(), true);
  await page.getByRole("button", { name: "保存当前草稿", exact: true }).click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences[0].markers[0], {
    id: "draft-review", time: 80085, duration: 240240, name: "本地草稿仍在", note: "原始备注", color: "#ffcc0088",
  });
});
test("same marker navigation after a background revision keeps its retained form and exact ticks", async (t) => {
  const page = await markerDraftFixture(t);
  await page.getByLabel("标记名称", { exact: true }).fill("导航也不丢的草稿");
  const form = await page.locator(".emarker-form").elementHandle();
  await page.evaluate(() => fixture.externalEdit()); await settle(page);
  for (const [button, tick] of [["定位结束", 320325], ["定位开始", 80085]]) {
    await page.getByRole("button", { name: button, exact: true }).click(); await settle(page);
    assert.equal(await page.evaluate(() => fixture.playhead()), tick);
    assert.equal(await form.evaluate((node) => node.isConnected && node === document.querySelector(".emarker-form")), true);
    assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), "导航也不丢的草稿");
  }
});
test("an untouched new range draft remains available through a background revision", async (t) => {
  const page = await markerDraftFixture(t);
  await page.getByRole("button", { name: "添加范围", exact: true }).click();
  const form = await page.locator(".emarker-form").elementHandle();
  await page.evaluate(() => fixture.externalEdit()); await settle(page);
  assert.equal(await form.evaluate((node) => node.isConnected), true);
  assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), "新范围");
  await page.getByRole("button", { name: "载入最新（放弃草稿）", exact: true }).click();
  assert.equal(await page.locator(".emarker-form").count(), 0);
  assert.equal((await documentState(page)).sequences[0].markers.length, 1);
});
test("an unchanged marker form refreshes normally when another editor updates that marker", async (t) => {
  const page = await markerDraftFixture(t), form = await page.locator(".emarker-form").elementHandle();
  await page.evaluate(() => fixture.dispatch([{ type: "marker.update", sequenceId: "main", markerId: "draft-review", patch: { name: "最新名称" } }], "外部更新"));
  await settle(page);
  assert.equal(await form.evaluate((node) => node.isConnected), false);
  assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), "最新名称");
  assert.equal(await page.getByRole("button", { name: "保存当前草稿", exact: true }).count(), 0);
});

test("native composition preserves an existing marker form even before its text differs from baseline", async (t) => {
  const page = await markerDraftFixture(t), input = page.getByLabel("标记名称", { exact: true }),
    form = await page.locator(".emarker-form").elementHandle(), cdp = await page.context().newCDPSession(page);
  await input.focus(); await input.evaluate((node) => {
    node.select(); globalThis.unchangedMarkerImeEnds = [];
    node.addEventListener("compositionend", (event) => unchangedMarkerImeEnds.push(event.data));
  });
  await cdp.send("Input.imeSetComposition", { text: "审核范围", selectionStart: 4, selectionEnd: 4 });
  assert.equal(await input.inputValue(), "审核范围");
  await page.evaluate(() => fixture.externalEdit()); await settle(page);
  assert.equal(await form.evaluate((node) => node.isConnected && node === document.querySelector(".emarker-form")), true);
  assert.deepEqual(await page.evaluate(() => unchangedMarkerImeEnds), []);
  assert.equal(await input.evaluate((node) => document.activeElement === node), true);
  await cdp.send("Input.insertText", { text: "审核完成" });
  await page.getByRole("button", { name: "保存当前草稿", exact: true }).click(); await settle(page);
  assert.equal((await documentState(page)).sequences[0].markers[0].name, "审核完成");
  assert.deepEqual(await page.evaluate(() => unchangedMarkerImeEnds), ["审核完成"]);
});

test("a detached marker form cannot overwrite a new draft after reselecting the same marker", async (t) => {
  const page = await markerDraftFixture(t);
  await page.evaluate(() => fixture.dispatch([{ type: "marker.add", sequenceId: "main", marker: {
    id: "other-review", time: 480000, duration: 0, name: "其他标记", note: "", color: "#ffffff",
  } }], "第二标记"));
  await page.getByLabel("标记名称", { exact: true }).fill("已脱离的旧草稿");
  const oldForm = await page.locator(".emarker-form").elementHandle();
  await page.evaluate(() => fixture.internals.workspace.markers.select("other-review"));
  await page.evaluate(() => fixture.internals.workspace.markers.select("draft-review"));
  await page.getByLabel("标记名称", { exact: true }).fill("当前草稿");
  const before = await documentState(page);
  await oldForm.evaluate((node) => node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), "当前草稿");
  assert.match((await page.evaluate(() => fixture.errors)).at(-1), /标记选择已变化/);
});

test("a marker save rejects a target changed synchronously during its fresh read", async (t) => {
  const page = await markerDraftFixture(t);
  await page.evaluate(() => fixture.dispatch([{ type: "marker.add", sequenceId: "main", marker: {
    id: "other-review", time: 480000, duration: 0, name: "其他标记", note: "", color: "#ffffff",
  } }], "第二标记"));
  await page.getByLabel("标记名称", { exact: true }).fill("不应应用的旧目标草稿");
  const before = await documentState(page);
  await page.evaluate(() => {
    const context = fixture.internals.workspace.markers.context, read = context.read;
    context.read = () => {
      context.read = read;
      const document = read();
      fixture.internals.workspace.markers.select("other-review");
      return document;
    };
  });
  await page.getByRole("button", { name: "保存标记", exact: true }).click(); await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.evaluate(() => fixture.internals.workspace.markers.selected), "other-review");
  assert.equal(await page.getByLabel("标记名称", { exact: true }).inputValue(), "其他标记");
  assert.match((await page.evaluate(() => fixture.errors)).at(-1), /标记选择已变化/);
});
async function canvasSelectionFixture(t, mode = "empty", label, options = {}) {
  const page = await canvasDraftFixture(t, label, options);
  await page.evaluate(() => {
    const a = fixture.read().sequences[0].clips[0];
    fixture.dispatch([
      { type: "track.add", sequenceId: "main", track: editor.createTrack("other-video", "video", "另一画面轨") },
      { type: "clip.add", sequenceId: "main", clip: { ...a, id: "b", trackId: "other-video",
        transform: { ...a.transform, x: -0.25, scaleX: 0.3, scaleY: 0.3 } } },
    ], "添加可选择画面");
    fixture.internals.workspace.selectClips("main", ["a"]);
  });
  await settle(page);
  if (mode !== "empty") await page.getByRole("button", { name: mode === "crop" ? "画布裁切工具" : "画布蒙版工具", exact: true }).click();
  return page;
}
async function canvasSelectionPoint(page, mode = "empty") {
  return page.evaluate((mode) => {
    const box = fixture.internals.workspace.canvasEditor.box;
    return mode === "empty" ? { x: box.left + 8, y: box.top + 8 } :
      { x: box.left + box.width * 0.25, y: box.top + box.height * 0.5 };
  }, mode);
}
async function canvasSelectionClick(page, mode = "empty") {
  const { x, y } = await canvasSelectionPoint(page, mode); await page.mouse.click(x, y); await settle(page);
}
for (const mode of ["empty", "crop", "mask"]) {
  for (const draft of [undefined, ["水平位置（%）", "25"], ["轨道名称 画面轨", "选择前保存轨道名"]]) {
    test(`the first ${mode} canvas selection preserves ${draft?.[0] ?? "the synchronous no-draft path"} without a gesture`, async (t) => {
      const page = await canvasSelectionFixture(t, mode), before = await documentState(page);
      if (draft) await page.getByLabel(draft[0], { exact: true }).fill(draft[1]);
      if (!draft) await page.evaluate(() => {
        globalThis.canvasSelectionAtDown = undefined;
        fixture.internals.workspace.canvasEditor.overlay.addEventListener("pointerdown", () => {
          canvasSelectionAtDown = { ids: fixture.selection(), pending: !!fixture.internals.workspace.canvasEditor.pendingGesture };
        });
      });
      await canvasSelectionClick(page, mode);
      const after = await documentState(page), expected = mode === "empty" ? [] : ["b"];
      assert.deepEqual(await page.evaluate(() => fixture.selection()), expected);
      assert.equal(after.revision, before.revision + Number(!!draft));
      assert.equal(after.sequences[0].clips[0].transform.x, draft?.[0] === "水平位置（%）" ? 0.25 : 0);
      assert.equal(after.sequences[0].tracks[0].name, draft?.[0].startsWith("轨道名称") ? draft[1] : "画面轨");
      assert.deepEqual(after.sequences[0].clips[1], before.sequences[0].clips[1]);
      assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.gesture || !!fixture.internals.workspace.canvasEditor.pendingGesture), false);
      assert.deepEqual(await page.evaluate(() => fixture.errors), []);
      if (draft) { await action(page, "undo").click(); await settle(page); assert.deepEqual((await documentState(page)).sequences, before.sequences); }
      else assert.deepEqual(await page.evaluate(() => canvasSelectionAtDown), { ids: expected, pending: false });
    });
  }
  test(`an invalid inspector draft retains the old selection on a ${mode} canvas click`, async (t) => {
    const page = await canvasSelectionFixture(t, mode), before = await documentState(page);
    await page.getByLabel("水平位置（%）", { exact: true }).fill("1001"); await canvasSelectionClick(page, mode);
    assert.deepEqual(await documentState(page), before); assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
    assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), "1001");
    assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => fixture.errors.length), 1);
  });
  test(`a rejected inspector field cannot clear or change the ${mode} canvas selection`, async (t) => {
    const page = await canvasSelectionFixture(t, mode), before = await documentState(page);
    await page.evaluate(() => fixture.internals.workspace.inspector.context.apply = () => new Promise((_resolve, reject) => {
      globalThis.rejectSelectionField = () => reject(new Error("选择前属性提交失败"));
    }));
    await page.getByLabel("水平位置（%）", { exact: true }).fill("25"); await canvasSelectionClick(page, mode);
    assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
    await page.evaluate(() => rejectSelectionField()); await settle(page);
    assert.deepEqual(await documentState(page), before); assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
    assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), "25");
    assert.deepEqual(await page.evaluate(() => fixture.errors), ["Error: 选择前属性提交失败"]);
  });
  test(`an awaiting ${mode} canvas click keeps its original selection intent through release and a second click`, async (t) => {
    const page = await canvasSelectionFixture(t, mode), before = await documentState(page);
    await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    await canvasSelectionClick(page, mode);
    assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
    const other = await canvasSelectionPoint(page, mode === "empty" ? "crop" : "empty");
    await page.mouse.click(other.x, other.y); await releaseCanvasField(page);
    assert.deepEqual(await page.evaluate(() => fixture.selection()), mode === "empty" ? [] : ["b"]);
    assert.equal((await documentState(page)).revision, before.revision + 1);
    assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, 0.25);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.gesture || !!fixture.internals.workspace.canvasEditor.pendingGesture), false);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}
for (const [mode, label, composition] of [["empty", "图形填充颜色", "#00ff00"], ["crop", "轨道名称 画面轨", "选择前完成输入"]]) {
  test(`native IME finishes once before the ${mode} canvas selection`, async (t) => {
    const page = await canvasSelectionFixture(t, mode, label), before = await documentState(page),
      input = page.getByLabel(label, { exact: true }), cdp = await page.context().newCDPSession(page);
    await input.fill(""); await input.evaluate((node) => {
      globalThis.selectionCompositionStarts = []; globalThis.selectionCompositionEnds = [];
      node.addEventListener("compositionstart", (event) => selectionCompositionStarts.push(event.isTrusted));
      node.addEventListener("compositionend", (event) => selectionCompositionEnds.push(event.data));
    });
    await cdp.send("Input.imeSetComposition", { text: composition, selectionStart: composition.length, selectionEnd: composition.length });
    await canvasSelectionClick(page, mode);
    assert.equal((await documentState(page)).revision, before.revision + 1);
    assert.deepEqual(await page.evaluate(() => fixture.selection()), mode === "empty" ? [] : ["b"]);
    assert.deepEqual(await page.evaluate(() => selectionCompositionStarts), [true]);
    assert.deepEqual(await page.evaluate(() => selectionCompositionEnds), [composition]);
    assert.equal(label.startsWith("轨道名称") ? (await documentState(page)).sequences[0].tracks[0].name :
      (await documentState(page)).sequences[0].clips[0].fill, composition);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

for (const mode of ["empty", "crop"]) for (const ending of ["Escape", "generation", "same-id-revision", "sequence", "selection", "mode", "resize", "dispose"]) {
  test(`an awaited ${mode} canvas selection stays canceled after ${ending}`, async (t) => {
    const page = await canvasSelectionFixture(t, mode, undefined, { sequenceCount: 2 }), before = await documentState(page);
    await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    const { x, y } = await canvasSelectionPoint(page, mode); await page.mouse.move(x, y); await page.mouse.down();
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.pendingGesture), true);
    if (ending === "Escape") await page.keyboard.press("Escape");
    if (ending === "generation") await page.evaluate(() => fixture.replaceGeneration());
    if (ending === "same-id-revision") await page.evaluate(async (before) => {
      await fixture.internals.session.replace({ ...before, id: "temporary-selection-document" });
      await fixture.internals.session.replace(before);
    }, before);
    if (ending === "sequence") await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "切换序列"));
    if (ending === "selection") await page.evaluate((mode) => fixture.internals.workspace.selectClips("main", mode === "empty" ? ["b"] : []), mode);
    if (ending === "mode") await page.getByRole("button", { name: mode === "empty" ? "画布裁切工具" : "画布蒙版工具", exact: true }).evaluate((node) => node.click());
    if (ending === "resize") await page.setViewportSize({ width: 1000, height: 780 });
    if (ending === "dispose") await page.evaluate(() => fixture.dispose());
    await page.mouse.up(); await settle(page);
    const canceled = await documentState(page), selected = await page.evaluate(() => fixture.selection());
    await releaseCanvasField(page);
    assert.deepEqual(await documentState(page), canceled); assert.deepEqual(await page.evaluate(() => fixture.selection()), selected);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.gesture || !!fixture.internals.workspace.canvasEditor.pendingGesture), false);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("a native touch canvas selection waits for its field and commits no gesture", async (t) => {
  const page = await canvasSelectionFixture(t, "crop"), before = await documentState(page),
    input = await touchInput(page, ".editor-canvas-controls"), { x, y } = await canvasSelectionPoint(page, "crop");
  await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await input.send("touchStart", [{ id: 1, x, y }]); await input.send("touchMove", [{ id: 1, x: x + 10, y }]);
  await input.send("touchEnd");
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
  await releaseCanvasField(page); await input.assertNative();
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["b"]);
  assert.equal((await documentState(page)).revision, before.revision + 1);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.gesture), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a native touch canceled canvas selection ignores the field's late completion", async (t) => {
  const page = await canvasSelectionFixture(t, "crop"), input = await touchInput(page, ".editor-canvas-controls"),
    { x, y } = await canvasSelectionPoint(page, "crop");
  await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await input.send("touchStart", [{ id: 1, x, y }]); await input.send("touchCancel");
  const before = await documentState(page); await releaseCanvasField(page);
  assert.deepEqual(await documentState(page), before); assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.pendingGesture), false);
  assert.ok(await page.evaluate(() => touchTrace.some((event) => event.type === "pointercancel" && event.trusted)));
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("an old selection finisher cannot release the next selection's mouse capture", async (t) => {
  const page = await canvasSelectionFixture(t, "crop"); await holdCanvasField(page, "timeline");
  await page.getByLabel("画面轨 音量百分比", { exact: true }).fill("37.5");
  let point = await canvasSelectionPoint(page, "empty"); await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.keyboard.press("Escape"); await page.mouse.up();
  await page.getByLabel("画面轨 音量百分比", { exact: true }).fill("50");
  point = await canvasSelectionPoint(page, "crop"); await page.mouse.move(point.x, point.y); await page.mouse.down();
  await releaseCanvasField(page, 0);
  assert.equal(await page.evaluate(() => {
    const canvas = fixture.internals.workspace.canvasEditor;
    return !!canvas.pendingGesture && canvas.overlay.hasPointerCapture(canvas.pendingGesture.start.pointerId);
  }), true);
  await page.mouse.up(); await releaseCanvasField(page, 1);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["b"]);
  assert.equal((await documentState(page)).sequences[0].tracks[0].volume, 0.5);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.gesture), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a no-handle canvas click may select a locked layer after saving another layer's field", async (t) => {
  const page = await canvasSelectionFixture(t, "crop");
  await page.evaluate(() => fixture.dispatch([{ type: "track.update", sequenceId: "main", trackId: "other-video", patch: { locked: true } }], "锁定另一画面"));
  await settle(page); const before = await documentState(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25"); await canvasSelectionClick(page, "crop");
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["b"]);
  assert.equal((await documentState(page)).revision, before.revision + 1);
  assert.deepEqual((await documentState(page)).sequences[0].clips[1], before.sequences[0].clips[1]);
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a removed original canvas selection target never falls through to a different hit layer", async (t) => {
  const page = await canvasSelectionFixture(t, "crop");
  await page.evaluate(() => {
    const context = fixture.internals.workspace.inspector.context, original = context.apply;
    context.apply = (operations, label) => original([...operations, { type: "clip.remove", sequenceId: "main", clipIds: ["b"] }], label);
  });
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25"); await canvasSelectionClick(page, "crop");
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
  assert.equal((await documentState(page)).sequences[0].clips.length, 1);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.pendingGesture || !!fixture.internals.workspace.canvasEditor.gesture), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a synchronous selection disposer cannot focus a detached canvas after an empty click", async (t) => {
  const page = await canvasSelectionFixture(t);
  await page.evaluate(() => {
    const context = fixture.internals.workspace.canvasEditor.context, original = context.select;
    context.select = (ids) => { original(ids); fixture.dispose(); };
  });
  await canvasSelectionClick(page);
  assert.equal(await page.evaluate(() => fixture.internals.workspace.canvasEditor.disposed), true);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.pendingGesture || !!fixture.internals.workspace.canvasEditor.gesture), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

for (const intent of ["selection", "move"]) for (const change of ["selection", "dispose", "revision"]) {
  test(`a canvas ${intent} rechecks ownership after a synchronous render ${change}`, async (t) => {
    const page = await canvasSelectionFixture(t), before = await documentState(page);
    await page.evaluate((change) => {
      const context = fixture.internals.workspace.canvasEditor.context, read = context.read, select = context.select;
      globalThis.selectionRenderCalls = [];
      context.select = (ids) => { selectionRenderCalls.push(ids); select(ids); };
      context.beforeGesture = () => {
        context.read = () => {
          context.read = read;
          const saved = read();
          if (change === "selection") fixture.internals.workspace.selectClips("main", ["b"]);
          else if (change === "dispose") fixture.dispose();
          else fixture.dispatch([{ type: "clip.update", sequenceId: "main", clipId: "a", patch: { transform: { ...saved.sequences[0].clips[0].transform, x: 0.3 } } }], "读取画布期间外部编辑");
          return saved;
        };
        return true;
      };
    }, change);
    if (intent === "selection") await canvasSelectionClick(page);
    else await canvasDrag(page);
    assert.deepEqual(await page.evaluate(() => selectionRenderCalls), []);
    assert.deepEqual(await page.evaluate(() => fixture.selection()), [change === "selection" ? "b" : "a"]);
    if (change === "revision") {
      const after = await documentState(page);
      assert.equal(after.revision, before.revision + 1);
      assert.equal(after.sequences[0].clips[0].transform.x, 0.3);
      await action(page, "undo").click(); await settle(page);
      assert.deepEqual((await documentState(page)).sequences, before.sequences);
    } else assert.deepEqual(await documentState(page), before);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.canvasEditor.pendingGesture || !!fixture.internals.workspace.canvasEditor.gesture), false);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}


async function timelineControlDraftFixture(t, options = {}) {
  const page = await fixture(t, { audio: true, ...options });
  await clip(page).click();
  await settle(page);
  return page;
}
const timelineControl = (page, action) =>
  ["muted", "locked"].includes(action)
    ? page.locator(`[data-et-track="video"][data-et-toggle="${action}"]`)
    : action === "magnetic"
      ? page.locator('[data-et-mode="magnetic"]')
      : page.locator(`[data-et-action="${action}"]`);
for (const control of [
  "muted",
  "locked",
  "delete",
  "copy",
  "duplicate",
  "track-audio",
  "magnetic",
]) {
  test(`the first timeline ${control} click preserves an inspector draft and separate undo`, async (t) => {
    const page = await timelineControlDraftFixture(t),
      before = await documentState(page);
    await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    await timelineControl(page, control).click();
    await settle(page);
    await page.evaluate(() => fixture.flush());
    const after = await documentState(page),
      sequence = after.sequences[0],
      track = sequence.tracks.find((item) => item.id === "video");
    if (control !== "delete")
      assert.equal(sequence.clips.find((item) => item.id === "a").transform.x, 0.25);
    if (["muted", "locked"].includes(control)) assert.equal(track[control], true);
    if (control === "delete")
      assert.equal(sequence.clips.length, before.sequences[0].clips.length - 1);
    if (control === "copy")
      assert.equal(
        await page.evaluate(() => !!fixture.internals.workspace.timeline.clipboard),
        true,
      );
    if (control === "duplicate")
      assert.equal(sequence.clips.length, before.sequences[0].clips.length + 1);
    if (control === "track-audio")
      assert.equal(sequence.tracks.length, before.sequences[0].tracks.length + 1);
    if (control === "magnetic") assert.equal(sequence.timelineMode, "magnetic");
    assert.equal(after.revision, before.revision + (control === "copy" ? 1 : 2));
    assert.deepEqual(await page.evaluate(() => fixture.stored()), after);
    if (control !== "copy") {
      await action(page, "undo").click();
      await settle(page);
      const draftOnly = structuredClone(before.sequences);
      draftOnly[0].clips[0].transform.x = 0.25;
      assert.deepEqual((await documentState(page)).sequences, draftOnly);
    }
    await action(page, "undo").click();
    await settle(page);
    assert.deepEqual((await documentState(page)).sequences, before.sequences);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}
for (const control of ["cut", "paste"]) {
  test(`an inspector draft survives the first durable timeline ${control} click`, async (t) => {
    const page = await timelineControlDraftFixture(t);
    if (control === "paste") {
      await page.evaluate(() => {
        const clip = fixture.read().sequences[0].clips[0];
        fixture.dispatch(
          [
            { type: "track.add", sequenceId: "main", track: editor.createTrack("tail", "video") },
            {
              type: "clip.add",
              sequenceId: "main",
              clip: { ...clip, id: "tail", trackId: "tail", start: 960000 },
            },
          ],
          "延长序列",
        );
      });
      await timelineControl(page, "copy").click();
      await page.evaluate(() => fixture.internals.workspace.seek(960000, true));
      await settle(page);
    }
    const before = await documentState(page);
    await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    await timelineControl(page, control).click();
    await settle(page);
    await page.evaluate(() => fixture.flush());
    const after = await documentState(page);
    assert.equal(after.revision, before.revision + 2);
    assert.deepEqual(await page.evaluate(() => fixture.stored()), after);
    if (control === "cut") {
      assert.equal(
        after.sequences[0].clips.some((item) => item.id === "a"),
        false,
      );
      assert.equal(
        await page.evaluate(
          () =>
            fixture.internals.workspace.timeline.clipboard.payload.document.sequences[0].clips[0]
              .audio.volume,
        ),
        1,
      );
    } else {
      assert.equal(after.sequences[0].clips.find((item) => item.id === "a").transform.x, 0.25);
      const added = after.sequences[0].clips.find(
        (item) => !before.sequences[0].clips.some((old) => old.id === item.id),
      );
      assert.equal(added.start, 960000);
      assert.equal(added.transform.x, 0, "paste retains the earlier copy snapshot");
    }
    await action(page, "undo").click();
    await settle(page);
    assert.equal(
      (await documentState(page)).sequences[0].clips.find((item) => item.id === "a").transform.x,
      0.25,
    );
    await action(page, "undo").click();
    await settle(page);
    assert.deepEqual((await documentState(page)).sequences, before.sequences);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}
for (const failed of [false, true]) {
  test(`${failed ? "rejected" : "invalid"} inspector input retains its draft and blocks a timeline button`, async (t) => {
    const page = await timelineControlDraftFixture(t),
      before = await documentState(page);
    if (failed)
      await page.evaluate(() => {
        const context = fixture.internals.workspace.inspector.context;
        globalThis.restoreControlFieldApply = context.apply;
        context.apply = () =>
          new Promise(
            (_resolve, reject) =>
              (globalThis.rejectControlField = () => reject(new Error("属性提交失败"))),
          );
      });
    const field = page.getByLabel("水平位置（%）", { exact: true });
    await field.fill(failed ? "25" : "1001");
    await timelineControl(page, "muted").click();
    if (failed) await page.evaluate(() => rejectControlField());
    await settle(page);
    assert.deepEqual(await documentState(page), before);
    assert.equal(await field.inputValue(), failed ? "25" : "1001");
    assert.equal(await field.evaluate((node) => node === document.activeElement), true);
    assert.equal(
      await page.evaluate(() => !!fixture.internals.workspace.timeline.pendingControl),
      false,
    );
    if (failed)
      await page.evaluate(
        () => (fixture.internals.workspace.inspector.context.apply = restoreControlFieldApply),
      );
    await field.fill("50");
    await timelineControl(page, "muted").click();
    await settle(page);
    const after = await documentState(page);
    assert.equal(after.sequences[0].clips[0].transform.x, 0.5);
    assert.equal(after.sequences[0].tracks[0].muted, true);
    assert.equal((await page.evaluate(() => fixture.errors)).length, 1);
  });
}
async function beginHeldControl(page, control = "muted", released = true) {
  await holdCanvasField(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  const box = await timelineControl(page, control).boundingBox(),
    point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  if (released) await page.mouse.up();
  await settle(page);
  assert.equal(
    await page.evaluate(() => !!fixture.internals.workspace.timeline.pendingControl),
    true,
  );
  return point;
}
test("an awaited timeline button retains its first release and ignores a second click or Enter", async (t) => {
  const page = await timelineControlDraftFixture(t),
    before = await documentState(page),
    point = await beginHeldControl(page);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await releaseCanvasField(page);
  await settle(page);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2);
  assert.equal(after.sequences[0].tracks[0].muted, true);
  assert.equal(
    await page.evaluate(() => !!fixture.internals.workspace.timeline.pendingControl),
    false,
  );
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});
for (const cancellation of [
  "Escape",
  "blur",
  "pointercancel",
  "lostcapture",
  "generation",
  "same-id-revision",
  "sequence",
  "time",
  "selection",
  "revision",
  "resize",
  "dispose",
]) {
  test(`an awaited inspector-to-timeline button cancels on ${cancellation}`, async (t) => {
    const page = await timelineControlDraftFixture(t, { sequenceCount: 2 }),
      before = await documentState(page);
    await beginHeldControl(page, "muted", false);
    if (cancellation === "Escape") await page.keyboard.press("Escape");
    if (cancellation === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (cancellation === "pointercancel")
      await page.evaluate(() => {
        const c = fixture.internals.workspace.timeline;
        c.container.dispatchEvent(
          new PointerEvent("pointercancel", {
            bubbles: true,
            pointerId: c.pendingControl.pointerId,
          }),
        );
      });
    if (cancellation === "lostcapture")
      await page.evaluate(() => {
        const c = fixture.internals.workspace.timeline;
        c.container.releasePointerCapture(c.pendingControl.pointerId);
      });
    if (cancellation === "generation") await page.evaluate(() => fixture.replaceGeneration());
    if (cancellation === "same-id-revision")
      await page.evaluate(async (before) => {
        await fixture.internals.session.replace({ ...before, id: "temporary-control-project" });
        await fixture.internals.session.replace(before);
      }, before);
    if (cancellation === "sequence")
      await page.evaluate(() =>
        fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "切换序列"),
      );
    if (cancellation === "time")
      await page.evaluate(() => fixture.internals.workspace.seek(240000));
    if (cancellation === "selection")
      await page.evaluate(() => fixture.internals.workspace.selectClips("main", ["sound"]));
    if (cancellation === "revision") await page.evaluate(() => fixture.externalEdit());
    if (cancellation === "resize") await page.setViewportSize({ width: 1100, height: 780 });
    if (cancellation === "dispose") await page.evaluate(() => fixture.dispose());
    await page.mouse.up();
    await settle(page);
    const canceled = await documentState(page);
    await releaseCanvasField(page);
    assert.deepEqual(await documentState(page), canceled);
    assert.equal(
      await page.evaluate(() => !!fixture.internals.workspace.timeline.pendingControl),
      false,
    );
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}
test("moving outside a pressed timeline button cancels its action after finishing the field", async (t) => {
  const page = await timelineControlDraftFixture(t),
    before = await documentState(page),
    p = await beginHeldControl(page, "muted", false);
  await page.mouse.move(p.x + 150, p.y);
  await page.mouse.up();
  await releaseCanvasField(page);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.sequences[0].clips[0].transform.x, 0.25);
  assert.equal(after.sequences[0].tracks[0].muted, false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});
test("an old control completion cannot release a new pending gesture's capture", async (t) => {
  const page = await timelineControlDraftFixture(t);
  await beginHeldControl(page, "muted", false);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.evaluate(() => {
    fixture.internals.workspace.timeline.context.beforeGesture = () =>
      new Promise((resolve) => (globalThis.resolveNewControlGesture = resolve));
  });
  const b = await clip(page, "sound").boundingBox();
  await page.mouse.move(b.x + 30, b.y + 20);
  await page.mouse.down();
  await releaseCanvasField(page);
  assert.equal(
    await page.evaluate(() => {
      const c = fixture.internals.workspace.timeline;
      return (
        !!c.pendingTrackGesture &&
        c.container.hasPointerCapture(c.pendingTrackGesture.intent.pointer.pointerId)
      );
    }),
    true,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.evaluate(() => resolveNewControlGesture(true));
  await settle(page);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});
for (const key of ["Enter", "Space"]) {
  test(`a focused timeline button activates once through native ${key}`, async (t) => {
    const page = await timelineControlDraftFixture(t),
      before = await documentState(page),
      button = timelineControl(page, "muted");
    await button.focus();
    await page.keyboard.press(key);
    await settle(page);
    const after = await documentState(page);
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.sequences[0].tracks[0].muted, true);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}
test("native touch finishes an inspector field before the first timeline control action", async (t) => {
  const page = await timelineControlDraftFixture(t),
    input = await touchInput(page, ".editor-timeline"),
    before = await documentState(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  const r = await timelineControl(page, "muted").boundingBox(),
    p = { id: 1, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  await input.send("touchStart", [p]);
  await input.send("touchMove", [{ ...p, x: p.x + 1 }]);
  await input.send("touchEnd");
  await settle(page);
  await input.assertNative();
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2);
  assert.equal(after.sequences[0].tracks[0].muted, true);
  assert.equal(after.sequences[0].clips[0].transform.x, 0.25);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a pending inspector-to-timeline control keeps the primary native touch and ignores a second finger", async (t) => {
  const page = await timelineControlDraftFixture(t),
    before = await documentState(page),
    input = await touchInput(page, ".editor-timeline");
  await holdCanvasField(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  const r = await timelineControl(page, "muted").boundingBox(),
    first = { id: 1, x: r.x + r.width / 2, y: r.y + r.height / 2 },
    second = { id: 2, x: first.x + 3, y: first.y + 3 };
  await input.send("touchStart", [first]);
  await input.send("touchStart", [first, second]);
  const [owner, secondary] = await input.ids();
  await page.evaluate(
    (pointerId) =>
      fixture.internals.workspace.timeline.container.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId, pointerType: "touch" }),
      ),
    secondary,
  );
  await input.send("touchMove", [
    { ...first, x: first.x + 1 },
    { ...second, x: second.x + 1 },
  ]);
  await input.send("touchEnd", [{ ...second, x: second.x + 1 }]);
  assert.equal(
    await page.evaluate(() => fixture.internals.workspace.timeline.pendingControl.up),
    undefined,
  );
  assert.equal(
    await page.evaluate(() => fixture.internals.workspace.timeline.pendingControl.pointerId),
    owner,
  );
  await input.send("touchEnd");
  await releaseCanvasField(page);
  await input.assertNative();
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2);
  assert.equal(after.sequences[0].tracks[0].muted, true);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});
test("native touch cancellation blocks the old control and a new touch still activates once", async (t) => {
  const page = await timelineControlDraftFixture(t),
    input = await touchInput(page, ".editor-timeline"),
    before = await documentState(page);
  await holdCanvasField(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  const r = await timelineControl(page, "muted").boundingBox(),
    p = { id: 1, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  await input.send("touchStart", [p]);
  await input.send("touchMove", [{ ...p, x: p.x + 1 }]);
  await input.send("touchCancel");
  await releaseCanvasField(page);
  assert.equal((await documentState(page)).revision, before.revision + 1);
  assert.equal((await documentState(page)).sequences[0].tracks[0].muted, false);
  await input.send("touchStart", [{ ...p, id: 2 }]);
  await input.send("touchEnd");
  await settle(page);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2);
  assert.equal(after.sequences[0].tracks[0].muted, true);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});
for (const pointer of ["mouse", "touch"]) {
  test(`an asynchronous no-op field hook activates a timeline button once with ${pointer}`, async (t) => {
    const page = await timelineControlDraftFixture(t),
      before = await documentState(page);
    await page.evaluate(
      () =>
        (fixture.internals.workspace.timeline.context.beforeGesture = () => Promise.resolve(true)),
    );
    if (pointer === "mouse") await timelineControl(page, "muted").click();
    else {
      const input = await touchInput(page, ".editor-timeline"),
        r = await timelineControl(page, "muted").boundingBox(),
        p = { id: 1, x: r.x + r.width / 2, y: r.y + r.height / 2 };
      await input.send("touchStart", [p]);
      await input.send("touchEnd");
    }
    await settle(page);
    const after = await documentState(page);
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.sequences[0].tracks[0].muted, true);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}
test("a control rechecks exact document identity after a synchronously reentrant fresh read", async (t) => {
  const page = await timelineControlDraftFixture(t),
    before = await documentState(page);
  await page.evaluate(() => {
    fixture.internals.workspace.timeline.context.beforeGesture = () =>
      new Promise((resolve) => (globalThis.releaseNoopControl = resolve));
  });
  const r = await timelineControl(page, "muted").boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  assert.equal(
    await page.evaluate(() => !!fixture.internals.workspace.timeline.pendingControl),
    true,
  );
  await page.evaluate(() => {
    const context = fixture.internals.workspace.timeline.context,
      read = context.read;
    context.read = () => {
      context.read = read;
      const doc = read();
      fixture.externalEdit();
      return doc;
    };
    globalThis.releaseNoopControl(true);
  });
  await settle(page);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.sequences[0].tracks[0].muted, false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});
test("disposing synchronously inside a control finisher does not capture or report a late failure", async (t) => {
  const page = await timelineControlDraftFixture(t),
    before = await documentState(page);
  await page.evaluate(
    () =>
      (fixture.internals.workspace.timeline.context.beforeGesture = () => {
        fixture.dispose();
        return Promise.reject(new Error("旧控件已销毁"));
      }),
  );
  await timelineControl(page, "muted").click();
  await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});
test("native control focus reentry cannot replace a newer pending clip gesture", async (t) => {
  const page = await timelineControlDraftFixture(t),
    before = await documentState(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.evaluate(() => {
    const c = fixture.internals.workspace.timeline;
    let once = true;
    c.container.addEventListener(
      "focus",
      () => {
        if (!once) return;
        once = false;
        c.cancel();
        c.context.beforeGesture = () =>
          new Promise((resolve) => (globalThis.finishReentrantControl = resolve));
        const node = document.querySelector('[data-et-clip="sound"]'),
          r = node.getBoundingClientRect();
        node.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            pointerId: 1,
            button: 0,
            buttons: 1,
            clientX: r.x + 30,
            clientY: r.y + 20,
            pointerType: "mouse",
          }),
        );
      },
      true,
    );
  });
  const r = await timelineControl(page, "muted").boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await settle(page);
  assert.equal(
    await page.evaluate(() => {
      const c = fixture.internals.workspace.timeline;
      return (
        !!c.pendingTrackGesture &&
        c.container.hasPointerCapture(c.pendingTrackGesture.intent.pointer.pointerId) &&
        !c.pendingControl
      );
    }),
    true,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.evaluate(() => finishReentrantControl(true));
  await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

for (const pointer of ["mouse", "touch"]) {
  test(`a second ${pointer} press stays blocked if an awaited control finishes before its release`, async (t) => {
    const page = await timelineControlDraftFixture(t),
      before = await documentState(page);
    const point = await beginHeldControl(page);
    let input;
    if (pointer === "mouse") await page.mouse.down();
    else {
      input = await touchInput(page, ".editor-timeline");
      await input.send("touchStart", [{ id: 2, ...point }]);
    }
    await releaseCanvasField(page);
    await settle(page);
    assert.equal((await documentState(page)).sequences[0].tracks[0].muted, true);
    if (pointer === "mouse") await page.mouse.up();
    else await input.send("touchEnd");
    await settle(page);
    const after = await documentState(page);
    assert.equal(after.revision, before.revision + 2);
    assert.equal(after.sequences[0].tracks[0].muted, true);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

for (const outcome of ["false", "throw"]) {
  test(`a synchronous ${outcome} control finisher keeps the inspector draft without a native fallback action`, async (t) => {
    const page = await timelineControlDraftFixture(t),
      before = await documentState(page);
    const field = page.getByLabel("水平位置（%）", { exact: true });
    await field.fill("25");
    await page.evaluate((outcome) => {
      fixture.internals.workspace.timeline.context.beforeGesture = () => {
        if (outcome === "throw") throw new Error("同步属性提交失败");
        return false;
      };
    }, outcome);
    await timelineControl(page, "muted").click();
    await settle(page);
    assert.deepEqual(await documentState(page), before);
    assert.equal(await field.inputValue(), "25");
    assert.equal(await field.evaluate((node) => node === document.activeElement), true);
    assert.equal((await page.evaluate(() => fixture.errors)).length, outcome === "throw" ? 1 : 0);
  });
}

test("an inspector draft and first timeline mute retain real autosave failure and retry", async (t) => {
  const page = await timelineControlDraftFixture(t),
    before = await documentState(page);
  await page.evaluate(() => fixture.writeMode("fail"));
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await timelineControl(page, "muted").click();
  await page.waitForFunction(() => fixture.state().saveState === "failed");
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2);
  assert.equal(after.sequences[0].clips[0].transform.x, 0.25);
  assert.equal(after.sequences[0].tracks[0].muted, true);
  assert.deepEqual((await page.evaluate(() => fixture.stored())).sequences, before.sequences);
  await page.evaluate(() => fixture.writeMode("normal"));
  await action(page, "retry-save").click();
  await page.waitForFunction(() => fixture.state().saveState === "saved");
  assert.deepEqual((await page.evaluate(() => fixture.stored())).sequences, after.sequences);
  assert.equal((await documentState(page)).revision, after.revision);
  await action(page, "undo").click();
  await settle(page);
  assert.equal((await documentState(page)).sequences[0].tracks[0].muted, false);
  assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, 0.25);
});
test("a failed first inspector-to-cut keeps the earlier clipboard and retries through real durable storage", async (t) => {
  const page = await timelineControlDraftFixture(t);
  await timelineControl(page, "copy").click();
  const before = await documentState(page);
  const priorClipboard = await page.evaluate(() => fixture.internals.workspace.timeline.clipboard);
  await page.evaluate(() => fixture.writeMode("fail"));
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await timelineControl(page, "cut").click();
  await page.waitForFunction(
    () =>
      fixture.state().saveState === "failed" &&
      !fixture.internals.workspace.timeline.pendingControl,
  );
  const draftOnly = await documentState(page);
  assert.equal(draftOnly.revision, before.revision + 1);
  assert.equal(draftOnly.sequences[0].clips.find((clip) => clip.id === "a").transform.x, 0.25);
  assert.deepEqual(
    await page.evaluate(() => fixture.internals.workspace.timeline.clipboard),
    priorClipboard,
  );
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
  assert.deepEqual((await page.evaluate(() => fixture.stored())).sequences, before.sequences);
  await page.evaluate(() => fixture.writeMode("normal"));
  await timelineControl(page, "cut").click();
  await page.waitForFunction(
    () => !fixture.read().sequences[0].clips.some((clip) => clip.id === "a"),
  );
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2);
  assert.deepEqual(await page.evaluate(() => fixture.stored()), after);
  assert.equal(
    await page.evaluate(
      () =>
        fixture.internals.workspace.timeline.clipboard.payload.document.sequences[0].clips[0]
          .transform.x,
    ),
    0.25,
  );
  await action(page, "undo").click();
  await settle(page);
  assert.deepEqual((await documentState(page)).sequences, draftOnly.sequences);
});

test("matching a rebuilt control in a real 5000-clip workspace reads only its candidate track", async (t) => {
  const page = await timelineControlDraftFixture(t, { clipCount: 5000 });
  const result = await page.evaluate(() => {
    fixture.dispatch(
      Array.from({ length: 16 }, (_, index) => ({
        type: "track.add",
        sequenceId: "main",
        track: editor.createTrack(`control-track-${index}`, "audio"),
      })),
      "添加轨道",
    );
    const c = fixture.internals.workspace.timeline;
    const target = document.querySelector('[data-et-track="video"][data-et-toggle="muted"]');
    const intent = c.controlIntent(target),
      read = c.context.read;
    let reads = 0;
    c.context.read = () => {
      reads++;
      return read();
    };
    const matched = c.matchingControl(intent);
    c.context.read = read;
    return { matches: matched === target, reads };
  });
  assert.equal(result.matches, true);
  assert.equal(result.reads, 1);
});

for (const actionName of ["add", "adjust", "remove"]) {
  test(`the first transition ${actionName} saves the inspector draft and preserves the chosen transition form with separate undo`, async (t) => {
    const page = await transitionWorkflowFixture(t);
    await page.evaluate(() => fixture.internals.workspace.selectClips("main", ["a"])); await settle(page);
    await page.getByLabel("相邻片段", { exact: true }).selectOption("1");
    if (actionName !== "add") {
      await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
    }
    await page.getByLabel("转场时长（秒）", { exact: true }).fill(actionName === "remove" ? "" : "0.75");
    await page.getByLabel("转场效果", { exact: true }).selectOption("wipe-right");
    await page.getByLabel("重叠安排", { exact: true }).selectOption("overlap");
    const before = await documentState(page);
    await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    await page.getByRole("button", { name: actionName === "add" ? "添加转场" : actionName === "adjust" ? "应用转场调整" : "移除转场并接成硬切", exact: true }).click();
    await settle(page);
    const after = await documentState(page);
    assert.equal(after.revision, before.revision + 2);
    assert.equal(after.sequences[0].clips[0].transform.x, 0.25);
    if (actionName === "remove") assert.deepEqual(after.sequences[0].transitions, []);
    else {
      const transition = after.sequences[0].transitions[0];
      assert.equal(transition.fromClipId, "b"); assert.equal(transition.toClipId, "c");
      assert.equal(transition.duration, 0.75 * 240000); assert.equal(transition.kind, "wipe-right");
    }
    await action(page, "undo").click(); await settle(page);
    const firstUndo = await documentState(page);
    assert.equal(firstUndo.sequences[0].clips[0].transform.x, 0.25);
    assert.deepEqual(firstUndo.sequences[0].transitions, before.sequences[0].transitions);
    await action(page, "undo").click(); await settle(page);
    assert.deepEqual((await documentState(page)).sequences, before.sequences);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

async function transitionDraftFixture(t, options = {}) {
  const page = await transitionWorkflowFixture(t, options);
  await page.evaluate(() => fixture.internals.workspace.selectClips("main", ["a"])); await settle(page);
  await page.getByLabel("相邻片段", { exact: true }).selectOption("1");
  await page.getByLabel("转场时长（秒）", { exact: true }).fill("0.75");
  await page.getByLabel("转场效果", { exact: true }).selectOption("push-left");
  return page;
}
for (const failure of ["invalid", "reject"]) {
  test(`a ${failure} inspector draft blocks the first transition action and retains both correctable drafts`, async (t) => {
    const page = await transitionDraftFixture(t), before = await documentState(page);
    if (failure === "reject") await page.evaluate(() => fixture.internals.workspace.inspector.context.apply = () => Promise.reject(new Error("转场前属性提交失败")));
    await page.getByLabel("水平位置（%）", { exact: true }).fill(failure === "invalid" ? "1001" : "25");
    await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
    assert.deepEqual(await documentState(page), before);
    assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), failure === "invalid" ? "1001" : "25");
    assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.getByLabel("相邻片段", { exact: true }).inputValue(), "1");
    assert.equal(await page.getByLabel("转场时长（秒）", { exact: true }).inputValue(), "0.75");
    assert.equal(await page.getByLabel("转场效果", { exact: true }).inputValue(), "push-left");
    assert.equal(await page.evaluate(() => fixture.errors.length), 1);
    assert.equal(await page.getByRole("button", { name: "添加转场", exact: true }).isDisabled(), false);
    if (failure === "invalid") {
      await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
      await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
      const after = await documentState(page);
      assert.equal(after.revision, before.revision + 2); assert.equal(after.sequences[0].transitions[0].kind, "push-left");
    }
  });
}
for (const ending of ["generation", "same-id-revision", "sequence", "selection", "external-revision", "dispose"]) {
  test(`an awaiting transition field cannot apply its old action after ${ending}`, async (t) => {
    const page = await transitionDraftFixture(t, { sequenceCount: 2 }), original = await documentState(page);
    await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    const stale = await page.getByRole("button", { name: "添加转场", exact: true }).elementHandle();
    await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timing.fieldFinish), true);
    if (ending === "generation") await page.evaluate(() => fixture.replaceGeneration());
    if (ending === "same-id-revision") await page.evaluate(async (original) => {
      await fixture.internals.session.replace({ ...original, id: "temporary-transition-document" });
      await fixture.internals.session.replace(original);
    }, original);
    if (ending === "sequence") await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "切序列"));
    if (ending === "selection") await page.evaluate(() => fixture.internals.workspace.selectClips("main", ["b"]));
    if (ending === "external-revision") await page.evaluate(() => fixture.dispatch([{ type: "track.update", sequenceId: "main", trackId: "video", patch: { locked: true } }], "锁轨"));
    if (ending === "dispose") await page.evaluate(() => fixture.dispose());
    const canceled = await documentState(page), selected = await page.evaluate(() => fixture.selection());
    await releaseCanvasField(page); await stale.evaluate((button) => button.click()); await settle(page);
    assert.deepEqual(await documentState(page), canceled); assert.deepEqual(await page.evaluate(() => fixture.selection()), selected);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timing.fieldFinish), false);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("an awaited transition field ignores pointer and keyboard reentry and applies exactly once", async (t) => {
  const page = await transitionDraftFixture(t), before = await documentState(page);
  await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  const button = page.getByRole("button", { name: "添加转场", exact: true }); await button.click(); await settle(page);
  await button.evaluate((node) => node.click()); await page.keyboard.press("Enter");
  assert.equal((await documentState(page)).revision, before.revision + 1);
  assert.deepEqual((await documentState(page)).sequences[0].transitions, []);
  await releaseCanvasField(page);
  assert.equal((await documentState(page)).revision, before.revision + 2);
  assert.equal((await documentState(page)).sequences[0].transitions.length, 1);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a no-draft transition action stays synchronous and remains keyboard accessible", async (t) => {
  const page = await transitionDraftFixture(t), before = await documentState(page);
  await page.evaluate(() => {
    document.querySelector(".editor-timing").addEventListener("click", (event) => {
      if (event.target.textContent === "添加转场") globalThis.transitionAtClick = fixture.read().sequences[0].transitions.length;
    });
  });
  await page.getByRole("button", { name: "添加转场", exact: true }).focus();
  await page.keyboard.press("Enter"); await settle(page);
  assert.equal(await page.evaluate(() => transitionAtClick), 1);
  assert.equal((await documentState(page)).revision, before.revision + 1);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("native IME finishes exactly once before the first transition action", async (t) => {
  const page = await transitionDraftFixture(t, { clipCount: 1 }), cdp = await page.context().newCDPSession(page),
    input = page.getByLabel("图形填充颜色", { exact: true });
  await page.evaluate(() => fixture.dispatch(fixture.read().sequences[0].clips.map((clip) => ({ type: "clip.update", sequenceId: "main", clipId: clip.id, patch: { duration: 4 * 240000 } })), "延长测试图形"));
  await settle(page); await page.getByLabel("转场时长（秒）", { exact: true }).fill("0.75");
  await input.fill(""); const before = await documentState(page);
  await input.evaluate((node) => {
    globalThis.transitionComposition = [];
    globalThis.transitionCompositionStarts = [];
    node.addEventListener("compositionstart", (event) => transitionCompositionStarts.push(event.isTrusted));
    node.addEventListener("compositionend", (event) => transitionComposition.push(event.data));
  });
  await cdp.send("Input.imeSetComposition", { text: "#00ff00", selectionStart: 7, selectionEnd: 7 });
  await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
  assert.equal((await documentState(page)).revision, before.revision + 2);
  assert.equal((await documentState(page)).sequences[0].clips[0].fill, "#00ff00");
  assert.deepEqual(await page.evaluate(() => transitionCompositionStarts), [true]);
  assert.deepEqual(await page.evaluate(() => transitionComposition), ["#00ff00"]);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

for (const change of ["dispose", "selection"]) test(`a synchronous transition boundary ${change} cannot leave a pending action`, async (t) => {
  const page = await transitionDraftFixture(t), before = await documentState(page);
  await page.evaluate((change) => {
    fixture.internals.workspace.timing.context.beforeEdit = () => {
      if (change === "dispose") fixture.dispose();
      else fixture.internals.workspace.selectClips("main", ["b"]);
      return Promise.resolve(true);
    };
  }, change);
  await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timing.fieldFinish), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("an invalid transition duration reports its error without discarding either unfinished form", async (t) => {
  const page = await transitionDraftFixture(t), before = await documentState(page);
  await page.getByLabel("转场时长（秒）", { exact: true }).fill("");
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), "25");
  assert.equal(await page.getByLabel("转场时长（秒）", { exact: true }).inputValue(), "");
  assert.match(await page.locator(".editor-timing").getByRole("alert").innerText(), /有效的数字/);
});

test("a first transition click keeps normal autosave failure and retry semantics for both dispatched edits", async (t) => {
  const page = await transitionDraftFixture(t), before = await documentState(page);
  await page.evaluate(() => fixture.writeMode("fail"));
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "添加转场", exact: true }).click(); await page.evaluate(() => fixture.flush().catch(() => {})); await settle(page);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2);
  assert.equal(after.sequences[0].clips[0].transform.x, 0.25); assert.equal(after.sequences[0].transitions.length, 1);
  assert.match(await page.locator("[data-ew-save]").textContent(), /保存失败/);
  await page.evaluate(() => fixture.writeMode("normal")); await action(page, "retry-save").click();
  await page.evaluate(() => fixture.flush()); await settle(page);
  assert.deepEqual(await page.evaluate(() => fixture.stored()), after);
  await action(page, "undo").click(); await action(page, "undo").click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences, before.sequences);
});

test("transition planning rechecks fresh track locks after its inspector dispatch", async (t) => {
  const page = await transitionDraftFixture(t), before = await documentState(page);
  await page.evaluate(() => {
    const context = fixture.internals.workspace.inspector.context, apply = context.apply;
    context.apply = (operations, label) => apply([...operations, { type: "track.update", sequenceId: "main", trackId: "video", patch: { locked: true } }], label);
  });
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 1); assert.equal(after.sequences[0].clips[0].transform.x, 0.25);
  assert.deepEqual(after.sequences[0].transitions, []);
  assert.match(await page.locator(".editor-timing").getByRole("alert").innerText(), /锁定/);
  await action(page, "undo").click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences, before.sequences);
});

test("an old transition field completion cannot repeat or cancel a newer selection's action", async (t) => {
  const page = await transitionDraftFixture(t);
  await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
  await page.evaluate(() => fixture.internals.workspace.selectClips("main", ["b"])); await settle(page);
  await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
  const after = await documentState(page);
  assert.equal(after.sequences[0].transitions.length, 1);
  await releaseCanvasField(page);
  assert.deepEqual(await documentState(page), after);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["b"]);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

for (const change of ["generation", "sequence", "selection", "dispose"]) {
  test(`a late transition apply rejection cannot report into a different ${change} scope`, async (t) => {
    const page = await transitionDraftFixture(t, { sequenceCount: 2 });
    await page.evaluate(() => fixture.internals.workspace.timing.context.apply = () => new Promise((_resolve, reject) => {
      globalThis.rejectOldTransition = () => reject(new Error("旧转场提交失败"));
    }));
    await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
    if (change === "generation") await page.evaluate(() => fixture.replaceGeneration());
    if (change === "sequence") await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "切序列"));
    if (change === "selection") await page.evaluate(() => fixture.internals.workspace.selectClips("main", ["b"]));
    if (change === "dispose") await page.evaluate(() => fixture.dispose());
    const before = await documentState(page);
    await page.evaluate(() => rejectOldTransition()); await settle(page);
    assert.deepEqual(await documentState(page), before);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
    assert.equal(await page.locator(".editor-timing .etime-error").count(), 0);
  });
}

for (const change of ["selection", "revision"]) {
  test(`a transition finisher rechecks the owner after a synchronous read ${change}`, async (t) => {
    const page = await transitionDraftFixture(t), before = await documentState(page);
    await page.evaluate((change) => {
      const context = fixture.internals.workspace.timing.context, read = context.read;
      context.beforeEdit = () => {
        let reads = 0;
        context.read = () => {
          const saved = read();
          if (++reads === 2) {
            context.read = read;
            if (change === "selection") fixture.internals.workspace.selectClips("main", ["b"]);
            else fixture.dispatch([{ type: "clip.update", sequenceId: "main", clipId: "a", patch: { transform: { ...saved.sequences[0].clips[0].transform, x: 0.3 } } }], "完成转场字段时外部编辑");
          }
          return saved;
        };
        return true;
      };
    }, change);
    await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
    const after = await documentState(page);
    assert.deepEqual(after.sequences[0].transitions, []);
    assert.equal(after.revision, before.revision + Number(change === "revision"));
    assert.equal(after.sequences[0].clips[0].transform.x, change === "revision" ? 0.3 : 0);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timing.fieldFinish), false);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("a reentrant transition scope read cannot cancel the newly installed field owner", async (t) => {
  const page = await transitionDraftFixture(t);
  await page.evaluate(() => {
    const context = fixture.internals.workspace.timing.context, read = context.read;
    context.beforeEdit = () => {
      let reads = 0;
      context.read = () => {
        const saved = read();
        if (++reads === 2) {
          context.read = read;
          fixture.internals.workspace.selectClips("main", ["b"]);
          context.beforeEdit = () => new Promise((resolve) => globalThis.completeNewTransition = resolve);
          [...document.querySelectorAll(".editor-timing button")].find((button) => button.textContent === "添加转场").click();
        }
        return saved;
      };
      return true;
    };
  });
  await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timing.fieldFinish), true);
  assert.deepEqual((await documentState(page)).sequences[0].transitions, []);
  await page.evaluate(() => completeNewTransition(true)); await settle(page);
  assert.equal((await documentState(page)).sequences[0].transitions.length, 1);
  assert.equal((await documentState(page)).sequences[0].transitions[0].fromClipId, "b");
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timing.fieldFinish), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a reentrant timing render cannot abort a replacement transition field owner", async (t) => {
  const page = await transitionDraftFixture(t);
  await page.evaluate(() => fixture.internals.workspace.timing.context.beforeEdit = () => new Promise((resolve) => globalThis.completeOldTransition = resolve));
  await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
  await page.evaluate(() => {
    const timing = fixture.internals.workspace.timing, context = timing.context, read = context.read;
    context.read = () => {
      context.read = read;
      const saved = read();
      fixture.internals.workspace.selectClips("main", ["b"]);
      context.beforeEdit = () => new Promise((resolve) => globalThis.completeNewTransition = resolve);
      [...document.querySelectorAll(".editor-timing button")].find((button) => button.textContent === "添加转场").click();
      return saved;
    };
    timing.render();
  });
  await page.evaluate(() => completeOldTransition(true)); await settle(page);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timing.fieldFinish), true);
  await page.evaluate(() => completeNewTransition(true)); await settle(page);
  assert.equal((await documentState(page)).sequences[0].transitions.length, 1);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

const timingSubmitLabels = { speed: "应用恒定速度", reverse: "倒放所选片段", freeze: "用播放头画面定格", left: "保留播放头左侧", right: "保留播放头右侧", curve: "应用分段曲线", arrange: "整理所选画面轨间隙" };
async function timingSubmitFixture(t, mode, options = {}) {
  const page = await fixture(t, options);
  await page.evaluate((mode) => {
    fixture.internals.workspace.selectClips("main", ["a"]);
    if (mode === "arrange") fixture.dispatch([{ type: "clip.update", sequenceId: "main", clipId: "a", patch: { start: 240000 } }], "设置待整理间隙");
    fixture.internals.workspace.seek(240000, true);
  }, mode); await settle(page);
  if (mode === "speed") {
    await page.getByLabel("恒定速度（倍）", { exact: true }).fill("2");
    await page.getByLabel("变速时保持音高", { exact: true }).uncheck();
  }
  if (mode === "freeze") await page.getByLabel("定格时长（秒）", { exact: true }).fill("1.5");
  if (mode === "curve") {
    await page.locator(".editor-timing").getByText("分段速度曲线", { exact: true }).click();
    await page.getByLabel("节点 2 输出（秒）", { exact: true }).fill("2");
    await page.getByLabel("节点 2 输出（秒）", { exact: true }).press("Tab");
  }
  if (mode === "arrange") await page.locator(".editor-timing").getByText("时间线排列", { exact: true }).click();
  return page;
}
function assertTimingIntent(item, mode) {
  assert.equal(item.duration, ["speed", "curve"].includes(mode) ? 2 * 240000 : mode === "freeze" ? 1.5 * 240000 : mode === "left" ? 240000 : mode === "right" ? 3 * 240000 : 4 * 240000);
  assert.equal(item.start, mode === "right" ? 240000 : 0);
  if (mode === "speed") assert.equal(item.audio.preservePitch, false);
  if (mode === "reverse") assert.equal(item.timeMap.points[0].source, 4 * 240000);
  if (mode === "freeze") assert.deepEqual(item.timeMap.points.map((point) => point.source), [240000, 240000]);
  if (mode === "curve") assert.deepEqual(item.timeMap.points, [{ time: 0, source: 0 }, { time: 2 * 240000, source: 4 * 240000 }]);
}
test("Timing shows reverse then restore-forward intent and keeps each reversal and the inspector draft separately undoable", async (t) => {
  const page = await timingSubmitFixture(t, "reverse"), before = await documentState(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "倒放所选片段", exact: true }).click(); await settle(page);
  const reversed = await documentState(page);
  assert.equal(reversed.revision, before.revision + 2);
  assert.deepEqual(reversed.sequences[0].clips[0].timeMap.points.map((point) => point.source), [960000, 0]);
  assert.match(await page.locator("[data-playback-direction]").innerText(), /倒放 1/);
  await page.getByRole("button", { name: "恢复正放", exact: true }).click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences[0].clips[0].timeMap.points.map((point) => point.source), [0, 960000]);
  assert.match(await page.locator("[data-playback-direction]").innerText(), /正放 1/);
  assert.equal(await page.getByRole("button", { name: "倒放所选片段", exact: true }).count(), 1);
  await action(page, "undo").click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences, reversed.sequences);
  assert.equal(await page.getByRole("button", { name: "恢复正放", exact: true }).count(), 1);
  await action(page, "undo").click(); await settle(page);
  assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, 0.25);
  assert.match(await page.locator("[data-playback-direction]").innerText(), /正放 1/);
  await action(page, "undo").click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences, before.sequences);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});
test("Timing source bounds are revalidated against the fresh document after finishing an edit", async (t) => {
  const page = await timingSubmitFixture(t, "reverse");
  await page.evaluate(() => fixture.dispatch([{ type: "asset.update", assetId: "demo", patch: { duration: 10 * 240000 } }], "设置来源总长")); await settle(page);
  await page.locator(".editor-timing").getByText("分段速度曲线", { exact: true }).click();
  const source = page.getByLabel("节点 2 来源（秒）", { exact: true });
  assert.equal(await source.getAttribute("max"), "10");
  await source.fill("8"); assert.equal(await source.evaluate((input) => input.validity.valid), true);
  await page.evaluate(() => fixture.internals.workspace.timing.context.beforeEdit = () => {
    fixture.dispatch([{ type: "asset.update", assetId: "demo", patch: { duration: 6 * 240000 } }], "更新来源总长");
    return true;
  });
  await page.getByRole("button", { name: "应用分段曲线", exact: true }).click(); await settle(page);
  assert.equal((await documentState(page)).sequences[0].clips[0].timeMap.points[1].source, 4 * 240000);
  assert.match(await page.locator(".editor-timing [role=alert]").innerText(), /超出素材时长/);
  assert.equal(await source.getAttribute("max"), "6");
  await page.evaluate(() => fixture.internals.workspace.timing.context.beforeEdit = () => true);
  await page.locator(".editor-timing").getByText("分段速度曲线", { exact: true }).click();
  await source.fill("6"); await page.getByRole("button", { name: "应用分段曲线", exact: true }).click(); await settle(page);
  assert.equal((await documentState(page)).sequences[0].clips[0].timeMap.points[1].source, 6 * 240000);
  await action(page, "undo").click(); await settle(page);
  assert.equal((await documentState(page)).sequences[0].clips[0].timeMap.points[1].source, 4 * 240000);
});
for (const mode of Object.keys(timingSubmitLabels)) for (const draft of [false, true]) {
  test(`the first ${mode} Timing submit preserves ${draft ? "the inspector draft and two undo steps" : "the synchronous no-draft path"}`, async (t) => {
    const page = await timingSubmitFixture(t, mode), before = await documentState(page);
    if (draft) await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    else await page.evaluate(() => document.querySelector(".editor-timing").addEventListener("click", () => globalThis.timingRevisionAtClick = fixture.read().revision));
    await page.getByRole("button", { name: timingSubmitLabels[mode], exact: true }).click(); await settle(page);
    const after = await documentState(page);
    assert.equal(after.revision, before.revision + 1 + Number(draft));
    assertTimingIntent(after.sequences[0].clips[0], mode);
    assert.equal(after.sequences[0].clips[0].transform.x, draft ? 0.25 : 0);
    if (!draft) assert.equal(await page.evaluate(() => timingRevisionAtClick), after.revision);
    await action(page, "undo").click(); await settle(page);
    if (draft) {
      assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, 0.25);
      assert.equal((await documentState(page)).sequences[0].clips[0].duration, before.sequences[0].clips[0].duration);
      await action(page, "undo").click(); await settle(page);
    }
    assert.deepEqual((await documentState(page)).sequences, before.sequences);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

for (const mode of Object.keys(timingSubmitLabels)) for (const failure of ["invalid", "reject"]) {
  test(`a ${failure} inspector field blocks the ${mode} Timing action and remains correctable`, async (t) => {
    const page = await timingSubmitFixture(t, mode), before = await documentState(page);
    if (failure === "reject") await page.evaluate(() => fixture.internals.workspace.inspector.context.apply = () => Promise.reject(new Error("时间编辑前属性提交失败")));
    await page.getByLabel("水平位置（%）", { exact: true }).fill(failure === "invalid" ? "1001" : "25");
    await page.getByRole("button", { name: timingSubmitLabels[mode], exact: true }).click(); await settle(page);
    assert.deepEqual(await documentState(page), before);
    assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), failure === "invalid" ? "1001" : "25");
    assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.getByRole("button", { name: timingSubmitLabels[mode], exact: true }).isDisabled(), false);
    assert.equal(await page.evaluate(() => fixture.errors.length), 1);
  });
}
for (const mode of ["speed", "left"]) for (const change of ["generation", "sequence", "selection", "time", "revision", "dispose"]) {
  test(`an awaited ${mode} Timing action stays canceled after ${change}`, async (t) => {
    const page = await timingSubmitFixture(t, mode, { sequenceCount: 2 });
    await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    await page.getByRole("button", { name: timingSubmitLabels[mode], exact: true }).click(); await settle(page);
    if (change === "generation") await page.evaluate(() => fixture.replaceGeneration());
    if (change === "sequence") await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "切序列"));
    if (change === "selection") await page.evaluate(() => fixture.internals.workspace.selectClips("main", []));
    if (change === "time") await page.evaluate(() => fixture.internals.workspace.seek(2 * 240000, true));
    if (change === "revision") await page.evaluate(() => fixture.dispatch([{ type: "project.rename", name: "字段等待期间外部修订" }], "外部编辑"));
    if (change === "dispose") await page.evaluate(() => fixture.dispose());
    const canceled = await documentState(page), selection = await page.evaluate(() => fixture.selection());
    await releaseCanvasField(page);
    assert.deepEqual(await documentState(page), canceled); assert.deepEqual(await page.evaluate(() => fixture.selection()), selection);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timing.fieldFinish), false);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}
for (const mode of ["speed", "freeze", "curve", "arrange"]) {
  test(`an awaited ${mode} Timing action uses captured typed inputs and options`, async (t) => {
    const page = await timingSubmitFixture(t, mode);
    if (mode === "speed") {
      await page.evaluate(() => fixture.dispatch([{ type: "clip.add", sequenceId: "main", clip: { ...fixture.read().sequences[0].clips[0], id: "b", start: 4 * 240000 } }], "添加后续画面")); await settle(page);
      await page.getByLabel("恒定速度（倍）", { exact: true }).fill("2"); await page.getByLabel("变速时保持音高", { exact: true }).uncheck();
    }
    if (mode === "arrange") {
      await page.evaluate(() => fixture.dispatch([{ type: "track.add", sequenceId: "main", track: editor.createTrack("other-video", "video", "另一画面轨") }], "添加另一轨")); await settle(page);
    }
    await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    await page.getByRole("button", { name: timingSubmitLabels[mode], exact: true }).click(); await settle(page);
    await page.evaluate((mode) => {
      const input = (label) => document.querySelector(`[aria-label="${label}"]`);
      if (mode === "speed") { input("恒定速度（倍）").value = "3"; input("变速时保持音高").checked = true; input("联动后续片段").checked = true; }
      if (mode === "freeze") input("定格时长（秒）").value = "3";
      if (mode === "curve") { input("节点 2 输出（秒）").value = "3"; input("节点 2 输出（秒）").dispatchEvent(new Event("change", { bubbles: true })); }
      if (mode === "arrange") input("整理画面轨").value = "other-video";
    }, mode);
    await releaseCanvasField(page);
    const after = await documentState(page); assertTimingIntent(after.sequences[0].clips[0], mode);
    assert.equal(after.sequences[0].clips[0].transform.x, 0.25);
    if (mode === "speed") assert.equal(after.sequences[0].clips[1].start, 4 * 240000);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("a Timing submit's fresh read cannot report an old scope warning after synchronous sequence activation", async (t) => {
  const page = await timingSubmitFixture(t, "speed", { sequenceCount: 2 }), before = await documentState(page);
  await page.evaluate(() => {
    const context = fixture.internals.workspace.timing.context, read = context.read;
    globalThis.timingSubmitReads = 0;
    context.read = () => {
      const saved = read();
      if (++timingSubmitReads === 4) {
        context.read = read;
        fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "提交校验期间切序列");
      }
      return saved;
    };
  });
  await page.getByRole("button", { name: "应用恒定速度", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => timingSubmitReads), 4);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 1); assert.equal(after.activeSequenceId, "sequence-2");
  assert.deepEqual(after.sequences, before.sequences);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  assert.equal(await page.locator(".editor-timing .etime-error").count(), 0);
});

test("Timing speed preserves narration approval for the field and invalidates it only with the timing undo step", async (t) => {
  const page = await timingSubmitFixture(t, "speed", { narration: true }), before = await documentState(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "应用恒定速度", exact: true }).click(); await settle(page);
  const after = await documentState(page);
  assert.equal(after.production.narration.phase, "review");
  assert.equal(after.production.narrationPreviousApproval.approvedFingerprint, "approved-original");
  await action(page, "undo").click(); await settle(page);
  assert.deepEqual((await documentState(page)).production, before.production);
  assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, 0.25);
  await action(page, "undo").click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences, before.sequences);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

for (const fault of ["completion-read", "rejection-read", "repeated-read", "error-callback"]) {
  test(`a Timing field ${fault} failure releases its own controls and permits correction`, async (t) => {
    const page = await transitionDraftFixture(t), before = await documentState(page);
    await page.evaluate(() => {
      fixture.internals.workspace.timing.context.beforeEdit = () => new Promise((resolve, reject) => {
        globalThis.completeTimingFault = resolve; globalThis.rejectTimingFault = reject;
      });
    });
    await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
    assert.equal(await page.getByRole("button", { name: "添加转场", exact: true }).isDisabled(), true);
    await page.evaluate((fault) => {
      const context = fixture.internals.workspace.timing.context, read = context.read, onError = context.onError;
      let remaining = fault === "repeated-read" ? 2 : 1;
      context.read = () => {
        if (--remaining <= 0) context.read = read;
        throw new Error("时间操作完成时读取失败");
      };
      if (fault === "error-callback") context.onError = (error) => {
        context.onError = onError; onError(error); throw new Error("错误回调也失败");
      };
      if (fault === "rejection-read") rejectTimingFault(new Error("属性完成失败"));
      else completeTimingFault(true);
    }, fault); await settle(page);
    assert.deepEqual(await documentState(page), before);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timing.fieldFinish), false);
    assert.equal(await page.getByRole("button", { name: "添加转场", exact: true }).isDisabled(), false);
    assert.equal(await page.getByLabel("转场时长（秒）", { exact: true }).inputValue(), "0.75");
    assert.equal(await page.getByLabel("转场效果", { exact: true }).inputValue(), "push-left");
    assert.equal(await page.evaluate(() => fixture.errors.length), fault === "completion-read" || fault === "error-callback" ? 1 : 0);
    await page.evaluate(() => fixture.internals.workspace.timing.context.beforeEdit = () => true);
    await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
    assert.equal((await documentState(page)).sequences[0].transitions[0].kind, "push-left");
  });
}

test("a failed Timing completion read cannot clean up a reentrant replacement field owner", async (t) => {
  const page = await transitionDraftFixture(t);
  await page.evaluate(() => fixture.internals.workspace.timing.context.beforeEdit = () => new Promise((resolve) => globalThis.completeOldTimingFault = resolve));
  await page.getByRole("button", { name: "添加转场", exact: true }).click(); await settle(page);
  await page.evaluate(() => {
    const context = fixture.internals.workspace.timing.context, read = context.read;
    context.read = () => {
      context.read = read;
      fixture.internals.workspace.selectClips("main", ["b"]);
      context.beforeEdit = () => new Promise((resolve) => globalThis.completeNewTimingFault = resolve);
      [...document.querySelectorAll(".editor-timing button")].find((button) => button.textContent === "添加转场").click();
      throw new Error("旧时间操作读取失败");
    };
    completeOldTimingFault(true);
  }); await settle(page);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timing.fieldFinish), true);
  assert.equal(await page.getByRole("button", { name: "添加转场", exact: true }).isDisabled(), true);
  assert.deepEqual((await documentState(page)).sequences[0].transitions, []);
  await page.evaluate(() => completeNewTimingFault(true)); await settle(page);
  assert.equal((await documentState(page)).sequences[0].transitions[0].fromClipId, "b");
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timing.fieldFinish), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

for (const axis of ["输出", "来源"]) {
  test(`the first curve apply captures the focused node's unblurred ${axis} seconds`, async (t) => {
    const page = await timingSubmitFixture(t, "curve"), before = await documentState(page);
    await page.getByLabel(`节点 2 ${axis}（秒）`, { exact: true }).fill(axis === "输出" ? "1.5" : "3");
    await page.getByRole("button", { name: "应用分段曲线", exact: true }).click(); await settle(page);
    const after = await documentState(page), item = after.sequences[0].clips[0];
    assert.equal(after.revision, before.revision + 1);
    assert.deepEqual(item.timeMap.points, [{ time: 0, source: 0 }, { time: (axis === "输出" ? 1.5 : 2) * 240000, source: (axis === "来源" ? 3 : 4) * 240000 }]);
    await action(page, "undo").click(); await settle(page);
    assert.deepEqual((await documentState(page)).sequences, before.sequences);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("an invalid focused curve node remains correctable without blurring or applying its old value", async (t) => {
  const page = await timingSubmitFixture(t, "curve"), before = await documentState(page),
    node = page.getByLabel("节点 2 输出（秒）", { exact: true });
  await node.fill("-1"); await page.getByRole("button", { name: "应用分段曲线", exact: true }).click(); await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await node.inputValue(), "-1"); assert.equal(await node.evaluate((input) => input === document.activeElement), true);
  assert.equal(await page.getByRole("button", { name: "应用分段曲线", exact: true }).isDisabled(), false);
  assert.equal(await page.evaluate(() => fixture.errors.length), 1);
  await node.fill("1.5"); await page.getByRole("button", { name: "应用分段曲线", exact: true }).click(); await settle(page);
  assert.equal((await documentState(page)).sequences[0].clips[0].duration, 1.5 * 240000);
});

async function playbackFollowFixture(t, width = 620) {
  const page = await fixture(t, { width, duration: 20 * 240000, layout: "embedded" });
  await page.evaluate(() => {
    // The real production shell selects the visible dock on narrow panels.
    document.querySelector(".workspace").dataset.narrowPanel = "viewer";
    fixture.internals.workspace.selectClips("main", ["a"]);
  });
  await page.locator("[data-et-zoom]").focus();
  await page.locator("[data-et-zoom]").press("End");
  await page.evaluate(async () => {
    const { workspace } = fixture.internals, timeline = workspace.timeline,
      width = document.querySelector(".et-scroll").clientWidth;
    await workspace.seek(Math.round((width - 60) / timeline.scale * 240000), true);
  });
  return page;
}

for (const width of [620, 390]) test(`real demo playback follows the clock by pages at ${width}px without editing`, async (t) => {
  const page = await playbackFollowFixture(t, width), before = await documentState(page);
  const control = page.locator("[data-et-follow]"), bounds = await control.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, "Following is reachable without scrolling the toolbar");
  assert.equal(await control.getAttribute("aria-pressed"), "true");
  await action(page, "play").click();
  await page.waitForFunction(() => document.querySelector(".et-scroll").scrollLeft > 0);
  await action(page, "play").click();
  const state = await page.evaluate(() => {
    const viewport = document.querySelector(".et-scroll"), rect = viewport.getBoundingClientRect(),
      line = document.querySelector(".et-playhead").getBoundingClientRect();
    return { left: viewport.scrollLeft, width: viewport.clientWidth, head: line.left, min: rect.left, max: rect.right };
  });
  assert.ok(state.left > 0);
  assert.ok(state.head >= state.min && state.head <= state.max, JSON.stringify(state));
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("manual horizontal scrolling suspends one playback episode and resume, disable and paused seeks keep their meaning", async (t) => {
  const page = await playbackFollowFixture(t), before = await documentState(page);
  await action(page, "play").click();
  await page.waitForFunction(() => document.querySelector(".et-scroll").scrollLeft > 0);
  const viewport = await page.locator(".et-scroll").boundingBox();
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + 30);
  await page.keyboard.down("Shift"); await page.mouse.wheel(0, 200); await page.keyboard.up("Shift");
  await page.getByRole("button", { name: "恢复播放跟随", exact: true }).waitFor();
  const manual = await page.evaluate(() => ({ left: document.querySelector(".et-scroll").scrollLeft, time: fixture.playhead() }));
  await page.waitForFunction((time) => fixture.playhead() >= time + 120000, manual.time);
  assert.equal(await page.locator(".et-scroll").evaluate((el) => el.scrollLeft), manual.left);
  await page.getByRole("button", { name: "恢复播放跟随", exact: true }).click();
  await page.waitForFunction(() => !fixture.internals.workspace.timeline.followSuspended);
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + 30);
  await page.keyboard.down("Shift"); await page.mouse.wheel(0, 200); await page.keyboard.up("Shift");
  await page.getByRole("button", { name: "恢复播放跟随", exact: true }).waitFor();
  await action(page, "play").click();
  const paused = await page.locator(".et-scroll").evaluate((el) => el.scrollLeft);
  await page.evaluate(() => fixture.internals.workspace.seek(15 * 240000, true));
  assert.equal(await page.locator(".et-scroll").evaluate((el) => el.scrollLeft), paused, "A paused seek leaves the view where the user put it");
  await action(page, "play").click();
  await page.waitForFunction((left) => document.querySelector(".et-scroll").scrollLeft > left, paused);
  await page.locator("[data-et-follow]").click();
  assert.equal(await page.locator("[data-et-follow]").getAttribute("aria-pressed"), "false");
  const disabled = await page.evaluate(() => ({ left: document.querySelector(".et-scroll").scrollLeft, time: fixture.playhead() }));
  await page.waitForFunction((time) => fixture.playhead() >= time + 120000, disabled.time);
  assert.equal(await page.locator(".et-scroll").evaluate((el) => el.scrollLeft), disabled.left);
  await action(page, "play").click();
  await page.locator("[data-et-follow]").focus(); await page.keyboard.press("Space");
  assert.equal(await page.locator("[data-et-follow]").getAttribute("aria-pressed"), "true");
  assert.equal(await page.evaluate(() => fixture.playing()), false);
  assert.equal(await page.locator(".et-scroll").evaluate((el) => el.scrollLeft), disabled.left);
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

for (const field of ["inspector", "track"]) test(`playback following is a view preference and keeps an unfinished ${field} field focused`, async (t) => {
  const page = await fixture(t);
  await clip(page).click();
  const input = field === "inspector" ? page.getByLabel("水平位置（%）", { exact: true }) : page.locator('[data-et-track-name="video"]');
  const before = await documentState(page), value = field === "inspector" ? "25" : "仍在编辑的名称";
  await input.fill(value);
  await page.locator("[data-et-follow]").click();
  assert.equal(await input.inputValue(), value);
  assert.equal(await input.evaluate((el) => document.activeElement === el), true);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.locator("[data-et-follow]").getAttribute("aria-pressed"), "false");
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("in-page playback frames do not read or render the timeline and a page turn reuses its toolbar", async (t) => {
  const page = await playbackFollowFixture(t);
  await action(page, "play").focus();
  const result = await page.evaluate(() => {
    const { workspace } = fixture.internals, timeline = workspace.timeline,
      read = timeline.context.read, render = timeline.render,
      toolbar = document.querySelector(".et-toolbar");
    let reads = 0, renders = 0;
    timeline.context.read = () => { reads++; return read(); };
    timeline.render = function (...args) { renders++; return render.apply(this, args); };
    timeline.setPlaybackActive(true);
    for (let index = 0; index < 100; index++) timeline.updatePlayhead();
    const inPage = { reads, renders };
    workspace.playhead += 240000;
    timeline.updatePlayhead();
    const pageTurn = { reads, renders, sameToolbar: toolbar === document.querySelector(".et-toolbar") };
    for (let index = 0; index < 100; index++) timeline.updatePlayhead();
    timeline.setPlaybackActive(false);
    return { inPage, pageTurn, after: { reads, renders } };
  });
  assert.deepEqual(result.inPage, { reads: 0, renders: 0 });
  assert.equal(result.pageTurn.renders, 1);
  assert.equal(result.pageTurn.sameToolbar, true);
  assert.deepEqual(result.after, { reads: result.pageTurn.reads, renders: 1 });
});


test("playback following preserves a manual horizontal position before its queued scroll handler and ignores the replaced scroller", async (t) => {
  const page = await playbackFollowFixture(t);
  await action(page, "play").focus();
  const result = await page.evaluate(() => {
    const { workspace } = fixture.internals,
      timeline = workspace.timeline,
      original = document.querySelector(".et-scroll");
    timeline.setPlaybackActive(true);
    workspace.playhead += 240000;
    timeline.updatePlayhead();
    const afterPage = {
      suspended: timeline.followSuspended,
      left: document.querySelector(".et-scroll").scrollLeft,
    };
    original.dispatchEvent(new Event("scroll"));
    const afterStale = timeline.followSuspended,
      current = document.querySelector(".et-scroll");
    current.scrollLeft += 200;
    const manual = current.scrollLeft;
    timeline.updatePlayhead();
    const manualGuard = { suspended: timeline.followSuspended, left: current.scrollLeft };
    timeline.setPlaybackActive(false);
    timeline.setPlaybackActive(true);
    timeline.updatePlayhead();
    const resumed = {
      suspended: timeline.followSuspended,
      left: document.querySelector(".et-scroll").scrollLeft,
    };
    timeline.setPlaybackActive(false);
    return { afterPage, afterStale, manual, manualGuard, resumed };
  });
  assert.equal(result.afterPage.suspended, false);
  assert.equal(result.afterStale, false);
  assert.equal(result.manualGuard.suspended, true);
  assert.equal(result.manualGuard.left, result.manual);
  assert.equal(result.resumed.suspended, false);
  assert.notEqual(result.resumed.left, result.manual);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("playback following actual workspace replay cannot be suspended by the previous episode's queued manual scroll", async (t) => {
  const page = await playbackFollowFixture(t, 390);
  await action(page, "play").click();
  await page.waitForFunction(() => fixture.playing());
  const state = await page.evaluate(async () => {
    const { workspace } = fixture.internals,
      viewport = document.querySelector(".et-scroll");
    viewport.scrollLeft += 500;
    const manual = viewport.scrollLeft;
    await workspace.togglePlayback();
    await workspace.togglePlayback();
    return {
      manual,
      playing: fixture.playing(),
      suspended: workspace.timeline.followSuspended,
      time: fixture.playhead(),
    };
  });
  await page.waitForFunction((time) => fixture.playhead() > time + 160000, state.time);
  const after = await page.evaluate(() => ({
    playing: fixture.playing(),
    suspended: fixture.internals.workspace.timeline.followSuspended,
    left: document.querySelector(".et-scroll").scrollLeft,
  }));
  await action(page, "play").click();
  assert.equal(state.playing, true);
  assert.equal(after.playing, true);
  assert.equal(after.suspended, false);
  assert.notEqual(after.left, state.manual);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

async function timingTrimFixture(t, mode = "left") {
  const page = await timingSubmitFixture(t, mode);
  // Keep the sequence longer than the selected clip, so its end is a reachable playhead tick.
  await page.evaluate(() => fixture.dispatch([{ type: "clip.add", sequenceId: "main", clip: { ...fixture.read().sequences[0].clips[0], id: "later", start: 4 * 240000 } }], "添加后续画面")); await settle(page);
  if (mode === "curve") await page.locator(".editor-timing").getByText("分段速度曲线", { exact: true }).click();
  return page;
}
for (const side of ["左", "右"]) for (const seconds of [0, 4]) {
  test(`Timing trim ${side} stays disabled at the selected clip's ${seconds === 0 ? "start" : "end"}`, async (t) => {
    const page = await timingTrimFixture(t), before = await documentState(page);
    await page.evaluate((seconds) => fixture.internals.workspace.seek(seconds * 240000, true), seconds); await settle(page);
    const button = page.getByRole("button", { name: `保留播放头${side}侧`, exact: true });
    assert.equal(await button.isDisabled(), true);
    assert.match(await page.locator("[data-trim-reason]").innerText(), /每个所选片段内部/);
    await button.evaluate((node) => node.click()); await settle(page);
    assert.deepEqual(await documentState(page), before);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("Timing trim requires the playhead inside every selected clip", async (t) => {
  const page = await timingSubmitFixture(t, "left");
  await page.evaluate(() => {
    fixture.dispatch([{ type: "clip.add", sequenceId: "main", clip: { ...fixture.read().sequences[0].clips[0], id: "b", start: 4 * 240000 } }], "添加稍后片段");
    fixture.internals.workspace.selectClips("main", ["a", "b"]);
  }); await settle(page);
  const before = await documentState(page);
  for (const side of ["左", "右"]) assert.equal(await page.getByRole("button", { name: `保留播放头${side}侧`, exact: true }).isDisabled(), true);
  assert.match(await page.locator("[data-trim-reason]").innerText(), /每个所选片段内部/);
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("Timing trim clock eligibility updates keep the focused speed and curve drafts in the same DOM", async (t) => {
  const page = await timingTrimFixture(t, "curve"), before = await documentState(page),
    speed = page.getByLabel("恒定速度（倍）", { exact: true }), point = page.getByLabel("节点 2 输出（秒）", { exact: true });
  await speed.fill("1.75"); await point.fill("3.25");
  const oldSpeed = await speed.elementHandle(), oldPoint = await point.elementHandle(), oldDirection = await page.locator("[data-playback-direction]").elementHandle();
  for (const seconds of [0, 4, 2]) {
    await page.evaluate((seconds) => fixture.internals.workspace.seek(seconds * 240000, true), seconds); await settle(page);
    assert.equal(await oldSpeed.evaluate((input) => input.isConnected && input.value === "1.75"), true);
    assert.equal(await oldPoint.evaluate((input) => input.isConnected && input.value === "3.25" && input === document.activeElement), true);
    assert.equal(await oldDirection.evaluate((note) => note.isConnected && note.textContent.includes("正放 1")), true);
    for (const side of ["左", "右"]) assert.equal(await page.getByRole("button", { name: `保留播放头${side}侧`, exact: true }).isDisabled(), seconds !== 2);
    assert.equal(await page.locator("[data-trim-reason]").isVisible(), seconds !== 2);
  }
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

for (const side of ["左", "右"]) for (const seconds of [0, 4]) {
  test(`an awaited Timing trim ${side} cannot act after the playhead reaches ${seconds === 0 ? "start" : "end"}`, async (t) => {
    const page = await timingTrimFixture(t), before = await documentState(page);
    await holdCanvasField(page); await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
    await page.getByRole("button", { name: `保留播放头${side}侧`, exact: true }).click(); await settle(page);
    const savedField = await documentState(page);
    assert.equal(savedField.revision, before.revision + 1); assert.equal(savedField.sequences[0].clips.find((clip) => clip.id === "a").transform.x, 0.25);
    await page.evaluate((seconds) => fixture.internals.workspace.seek(seconds * 240000, true), seconds); await settle(page);
    await releaseCanvasField(page);
    assert.deepEqual(await documentState(page), savedField);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timing.fieldFinish), false);
    for (const label of ["左", "右"]) assert.equal(await page.getByRole("button", { name: `保留播放头${label}侧`, exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("Timing trim reports locked tracks and becomes eligible after unlocking", async (t) => {
  const page = await timingSubmitFixture(t, "left");
  await page.evaluate(() => fixture.dispatch([{ type: "track.update", sequenceId: "main", trackId: "video", patch: { locked: true } }], "锁轨")); await settle(page);
  for (const side of ["左", "右"]) assert.equal(await page.getByRole("button", { name: `保留播放头${side}侧`, exact: true }).isDisabled(), true);
  assert.match(await page.locator("[data-trim-reason]").innerText(), /锁定/);
  await page.evaluate(() => fixture.dispatch([{ type: "track.update", sequenceId: "main", trackId: "video", patch: { locked: false } }], "解锁")); await settle(page);
  for (const side of ["左", "右"]) assert.equal(await page.getByRole("button", { name: `保留播放头${side}侧`, exact: true }).isDisabled(), false);
  assert.equal(await page.locator("[data-trim-reason]").isVisible(), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("Timing trim rechecks the playhead if a fresh submit read synchronously seeks to the edge", async (t) => {
  const page = await timingSubmitFixture(t, "left"), before = await documentState(page);
  await page.evaluate(() => {
    const context = fixture.internals.workspace.timing.context, read = context.read;
    globalThis.trimSubmitReads = 0;
    context.read = () => {
      const saved = read();
      if (++trimSubmitReads === 4) { context.read = read; fixture.internals.workspace.seek(0, true); }
      return saved;
    };
  });
  await page.getByRole("button", { name: "保留播放头左侧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => trimSubmitReads), 4);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.getByRole("button", { name: "保留播放头左侧", exact: true }).isDisabled(), true);
  assert.match((await page.evaluate(() => fixture.errors))[0], /播放头已变化/);
});

for (const side of ["左", "右"]) {
  test(`a legal Timing trim ${side} preserves source captions in one undo`, async (t) => {
    const page = await timingSubmitFixture(t, "left");
    await page.evaluate(() => {
      fixture.dispatch([{ type: "clip.add", sequenceId: "main", clip: {
        id: "bound-caption", kind: "text", role: "subtitle", label: "来源字幕", trackId: "text", start: 0, duration: 4 * 240000,
        text: "你好世界", words: [{ text: "你好", start: 0, end: 2 * 240000 }, { text: "世界", start: 2 * 240000, end: 4 * 240000 }],
        sourceBinding: { clipId: "a", sourceStart: 0, sourceEnd: 4 * 240000 }, style: editor.defaultTextStyle(),
        transform: editor.defaultTransform(), color: editor.defaultColorAdjustment(), blendMode: "normal",
      } }], "添加来源字幕");
      fixture.internals.workspace.seek(2 * 240000, true);
    }); await settle(page);
    const before = await documentState(page);
    await page.getByRole("button", { name: `保留播放头${side}侧`, exact: true }).click(); await settle(page);
    const after = await documentState(page), picture = after.sequences[0].clips.find((clip) => clip.id === "a"), caption = after.sequences[0].clips.find((clip) => clip.id === "bound-caption");
    assert.equal(after.revision, before.revision + 1); assert.equal(picture.duration, 2 * 240000);
    assert.equal(picture.start, side === "左" ? 0 : 2 * 240000);
    assert.deepEqual(picture.timeMap.points.map((point) => point.source), side === "左" ? [0, 2 * 240000] : [2 * 240000, 4 * 240000]);
    assert.equal(caption.text, side === "左" ? "你好" : "世界"); assert.equal(caption.start, picture.start); assert.equal(caption.duration, picture.duration);
    assert.deepEqual(caption.words, [{ text: caption.text, start: 0, end: 2 * 240000 }]);
    assert.deepEqual(caption.sourceBinding, { clipId: "a", sourceStart: side === "左" ? 0 : 2 * 240000, sourceEnd: side === "左" ? 2 * 240000 : 4 * 240000 });
    await action(page, "undo").click(); await settle(page);
    assert.deepEqual((await documentState(page)).sequences, before.sequences);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}


for (const draft of ["track", "inspector", "invalid"]) {
  test(`fixed gain first drag finishes an actual ${draft} field without losing its pointer intent`, async (t) => {
    const page = await fixture(t, { audio: true }); await clip(page, "sound").click(); await settle(page);
    const before = await documentState(page);
    if (draft === "track") await page.getByLabel("声音轨 音量百分比", { exact: true }).fill("37.5");
    else await page.getByLabel("声像（%）", { exact: true }).fill(draft === "invalid" ? "101" : "-30");
    const handle = clip(page, "sound").locator('[data-et-gain]'), b = await handle.boundingBox(), p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x, p.y - 25, { steps: 3 }); await page.mouse.up(); await settle(page);
    const after = await documentState(page), sound = after.sequences[0].clips.find((item) => item.id === "sound");
    if (draft === "invalid") {
      assert.deepEqual(after, before); assert.equal(await page.getByLabel("声像（%）", { exact: true }).inputValue(), "101");
      assert.equal(await page.getByLabel("声像（%）", { exact: true }).evaluate((node) => node === document.activeElement), true);
    } else {
      assert.equal(sound.audio.volume, 1.25); assert.equal(after.revision, before.revision + 2);
      assert.equal(sound.audio.pan, draft === "inspector" ? -.3 : 0);
      assert.equal(after.sequences[0].tracks.find((track) => track.id === "audio").volume, draft === "track" ? .375 : 1);
      await action(page, "undo").click(); await settle(page);
      const undone = await documentState(page); assert.equal(undone.sequences[0].clips.find((item) => item.id === "sound").audio.volume, 1);
      assert.equal(undone.sequences[0].clips.find((item) => item.id === "sound").audio.pan, sound.audio.pan);
      assert.deepEqual(await page.evaluate(() => fixture.errors), []);
    }
  });
}

for (const width of [280, 390]) {
  test(`fixed gain is visible and operable in a ${width}px workspace without horizontal page overflow`, async (t) => {
    const page = await fixture(t, { audio: true, width, duration: 120 * 240000 });
    await clip(page, "sound").click({ position: { x: 40, y: 19 } }); await settle(page);
    await page.locator(".et-scroll").evaluate((node) => node.scrollLeft = 3000); await settle(page);
    const handle = clip(page, "sound").locator('[data-et-gain]'); await handle.focus(); await settle(page);
    const h = await handle.boundingBox(), v = await page.locator(".et-scroll").boundingBox();
    assert.ok(h.x >= v.x + 7 && h.x + h.width <= v.x + v.width); assert.equal(h.width, 44);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.keyboard.press("ArrowDown"); await settle(page);
    assert.equal((await documentState(page)).sequences[0].clips.find((item) => item.id === "sound").audio.volume, .99);
    await mkdir("/tmp/video-studio-audio-gain", { recursive: true });
    await page.screenshot({ path: `/tmp/video-studio-audio-gain/workspace-${width}.png` });
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("undo and redo hints identify the actual next edit through two property changes and history navigation", async (t) => {
  const page = await fixture(t);
  const undo = action(page, "undo"), redo = action(page, "redo");
  assert.match(await undo.getAttribute("title"), /没有可撤销/);
  await clip(page).click();
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByLabel("水平位置（%）", { exact: true }).press("Tab");
  await settle(page);
  assert.match(await undo.getAttribute("title"), /撤销：修改水平位置（%）/);
  const name = page.locator('[data-et-track-name="audio"]');
  const previousName = await name.inputValue();
  await name.fill("旁白轨");
  await name.press("Tab");
  await settle(page);
  assert.match(await undo.getAttribute("title"), /撤销：重命名轨道/);
  await undo.click();
  await settle(page);
  assert.equal(await name.inputValue(), previousName);
  assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, 0.25);
  assert.match(await undo.getAttribute("title"), /撤销：修改水平位置（%）/);
  assert.match(await redo.getAttribute("title"), /重做：重命名轨道/);
  await undo.click();
  await settle(page);
  assert.match(await redo.getAttribute("title"), /重做：修改水平位置（%）/);
  await redo.click();
  await redo.click();
  await settle(page);
  assert.equal(await name.inputValue(), "旁白轨");
  assert.match(await undo.getAttribute("title"), /撤销：重命名轨道/);
  assert.match(await redo.getAttribute("title"), /没有可重做/);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

async function keyframeLocationFixture(t, options = {}) {
  const page = await fixture(t, options);
  await page.evaluate(() => {
    const { workspace } = fixture.internals, a = fixture.read().sequences[0].clips[0];
    a.transform.opacity = { keyframes: [
      { time: 13, value: .2, easing: "linear" },
      { time: 240013, value: .7 },
      { time: a.duration, value: 1 },
    ] };
    fixture.dispatch([{ type: "clip.update", sequenceId: "main", clipId: "a", patch: { transform: a.transform } }], "准备关键帧");
    workspace.selectClips("main", ["a"]);
  });
  await settle(page);
  await openLocationKeys(page);
  return page;
}
async function openLocationKeys(page) {
  const details = page.locator('[data-ew-inspector] details[data-state-key="keys:transform.opacity"]');
  if (!await details.evaluate((node) => node.open)) await details.locator(":scope > summary").click();
  return details;
}

test("keyframe location preserves original ticks and the duration endpoint stays in its clip and reveals it", async (t) => {
  const page = await keyframeLocationFixture(t, { duration: 60 * 240000 + 13, frameRate: { numerator: 30000, denominator: 1001 } });
  await page.evaluate(() => {
    const a = fixture.read().sequences[0].clips[0];
    fixture.dispatch([{ type: "clip.add", sequenceId: "main", clip: {
      ...a, id: "next", start: a.duration, duration: 8000,
      transform: editor.defaultTransform(),
      timeMap: { points: [{ time: 0, source: 0 }, { time: 8000, source: 8000 }] },
    } }], "加入紧邻片段");
  });
  await settle(page);
  const before = await documentState(page), state = await page.evaluate(() => fixture.state());
  await page.getByRole("button", { name: "定位关键帧 1", exact: true }).click();
  await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 13);
  assert.equal(await page.evaluate(() => fixture.internals.workspace.preview.time), 13);
  const end = page.getByRole("button", { name: "定位关键帧 3", exact: true });
  assert.match(await end.getAttribute("title"), /末端关键帧定位到片段内最后时刻/);
  await end.click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), before.sequences[0].clips[0].duration - 1);
  assert.deepEqual(await page.evaluate(() => {
    const { preview } = fixture.internals.workspace;
    return preview.evaluator.evaluate("main", preview.time).layers.map((layer) => layer.clipId);
  }), ["a"]);
  assert.ok(await page.locator(".et-scroll").evaluate((node) => node.scrollLeft) > 0);
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.state().canUndo), state.canUndo);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("keyframe location commits the unblurred field on the first mouse click and only adds its undo", async (t) => {
  const page = await keyframeLocationFixture(t);
  const before = await documentState(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click();
  await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 240013);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.sequences[0].clips[0].transform.x, .25);
  await action(page, "undo").click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences, before.sequences);
});

for (const failure of ["invalid", "reject"]) test(`keyframe location preserves an unblurred ${failure} draft and does not jump`, async (t) => {
  const page = await keyframeLocationFixture(t), before = await documentState(page);
  if (failure === "reject") await page.evaluate(() => fixture.internals.workspace.inspector.context.apply = async () => { throw new Error("属性提交失败"); });
  await page.getByLabel("水平位置（%）", { exact: true }).fill(failure === "invalid" ? "99999" : "25");
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 0);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), failure === "invalid" ? "99999" : "25");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "水平位置（%）");
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), false);
});

test("keyframe location never follows a sorted index after the target time draft changes", async (t) => {
  const page = await keyframeLocationFixture(t), before = await documentState(page);
  await page.getByLabel("关键帧 1 时间（秒）", { exact: true }).fill("2");
  await page.getByRole("button", { name: "定位关键帧 1", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 0);
  assert.equal((await documentState(page)).revision, before.revision + 1);
  assert.deepEqual((await documentState(page)).sequences[0].clips[0].transform.opacity.keyframes.map((key) => key.time), [240013, 480000, 960000]);
  assert.match(await page.locator(".ei-error").innerText(), /关键帧已变化.*重新定位/);
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 480000);
});

for (const ending of ["sequence", "generation", "time", "escape"]) test(`keyframe location abandons a held field when ${ending} changes its owner`, async (t) => {
  const page = await keyframeLocationFixture(t, { sequenceCount: 2 });
  await page.evaluate(() => fixture.internals.workspace.inspector.context.apply = () => new Promise((resolve) => { globalThis.releaseLocationField = resolve; }));
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click();
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), true);
  if (ending === "sequence") await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "切换序列"));
  if (ending === "generation") await page.evaluate(() => fixture.replaceGeneration("新工程"));
  if (ending === "time") await page.evaluate(() => fixture.internals.workspace.seek(8000, true));
  if (ending === "escape") await page.keyboard.press("Escape");
  const before = await documentState(page), time = await page.evaluate(() => fixture.playhead());
  await page.evaluate(() => releaseLocationField()); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), time);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("keyframe location uses the individual clip start and remains read-only on a locked track with twenty rows per page", async (t) => {
  const page = await keyframeLocationFixture(t, { width: 390 });
  await page.evaluate(() => {
    const a = fixture.read().sequences[0].clips[0], b = structuredClone(a);
    b.id = "b"; b.label = "副镜头"; b.start = a.duration;
    b.transform.opacity = { keyframes: Array.from({ length: 25 }, (_, index) => ({ time: index * 8000 + 13, value: index / 25 })) };
    fixture.dispatch([{ type: "clip.add", sequenceId: "main", clip: b }], "第二个动画片段");
    fixture.internals.workspace.selectClips("main", ["a", "b"]);
  });
  await settle(page);
  const keys = await openLocationKeys(page);
  await keys.getByLabel("单独编辑片段", { exact: true }).selectOption("b");
  await keys.getByRole("button", { name: "下一页关键帧", exact: true }).click();
  await page.evaluate(() => fixture.dispatch([{ type: "track.update", sequenceId: "main", trackId: "video", patch: { locked: true } }], "锁定轨道"));
  await settle(page);
  assert.equal(await page.locator(".ei-panel").evaluate((node) => node.disabled), true);
  const readOnly = page.locator(".ei-keyframe-locations");
  assert.match(await readOnly.innerText(), /关键帧定位（只读）.*副镜头/s);
  assert.equal(await readOnly.getByRole("button", { name: /^定位关键帧/ }).count(), 5);
  assert.equal(await readOnly.getByRole("button", { name: /^(上一个|下一个)关键帧$/ }).count(), 2);
  assert.equal(await keys.getByRole("button", { name: /^定位关键帧/ }).count(), 0);
  const before = await documentState(page);
  const target = readOnly.getByRole("button", { name: "定位关键帧 21", exact: true });
  await target.focus(); await page.keyboard.press("Enter"); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 960000 + 20 * 8000 + 13);
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a", "b"]);
  assert.equal(await page.locator(".editor-inspector").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
  if (process.env.VIDEO_STUDIO_KEYFRAME_SCREENSHOTS) {
    await readOnly.scrollIntoViewIfNeeded();
    await readOnly.screenshot({ path: "/tmp/video-studio-keyframe-location-locked-390.png" });
  }
  await page.locator('[data-state-key="keys:transform.opacity"] > summary').click();
  await page.waitForFunction(() => !document.querySelector(".ei-keyframe-locations"));
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("keyframe location recovers from one fresh-read fault without an unhandled rejection or locked navigation", async (t) => {
  const page = await keyframeLocationFixture(t);
  await page.evaluate(() => {
    const context = fixture.internals.workspace.inspector.context, read = context.read;
    context.read = () => { context.read = read; throw new Error("读取暂时失败"); };
  });
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 0);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), false);
  assert.match(await page.locator(".ei-error").innerText(), /读取暂时失败/);
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 240013);
  assert.equal(await page.locator(".ei-error").count(), 0);
});

test("keyframe location keeps a late seek failure out of the next document revision", async (t) => {
  const page = await keyframeLocationFixture(t);
  await page.evaluate(() => fixture.internals.workspace.inspector.context.seek = () => new Promise((_resolve, reject) => { globalThis.rejectLocationSeek = reject; }));
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click();
  await page.evaluate(() => fixture.externalEdit()); await settle(page);
  await page.evaluate(() => rejectLocationSeek(new Error("旧时刻错误"))); await settle(page);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), false);
});

test("keyframe location supports native keyboard activation without editing or requiring a seek hook in standalone inspectors", async (t) => {
  const page = await keyframeLocationFixture(t), before = await documentState(page);
  await page.getByRole("button", { name: "定位关键帧 1", exact: true }).focus();
  await page.keyboard.press("Space"); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 13);
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).focus();
  await page.keyboard.press("Enter"); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 240013);
  assert.deepEqual(await documentState(page), before);
  await page.evaluate(() => {
    fixture.internals.workspace.inspector.context.seek = undefined;
    fixture.internals.workspace.inspector.render();
  });
  assert.equal(await page.getByRole("button", { name: /^定位关键帧/ }).count(), 0);
});

for (const change of ["revision", "generation", "selection", "time"]) test(`keyframe location rejects a synchronous fresh-read ${change} replacement`, async (t) => {
  const page = await keyframeLocationFixture(t);
  await page.evaluate((change) => {
    const { workspace, session } = fixture.internals, context = workspace.inspector.context, read = context.read;
    context.read = () => {
      const old = read(); context.read = read;
      if (change === "revision") fixture.externalEdit();
      if (change === "generation") { session.generation++; workspace.inspector.render(); }
      if (change === "selection") workspace.selectClips("main", []);
      if (change === "time") workspace.seek(8000, true);
      return old;
    };
  }, change);
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), change === "time" ? 8000 : 0);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("keyframe location cancelled old seek completion does not clear a new navigation owner", async (t) => {
  const page = await keyframeLocationFixture(t);
  await page.evaluate(() => {
    const { inspector } = fixture.internals.workspace;
    globalThis.locationSeeks = [];
    inspector.context.seek = (time) => new Promise((resolve, reject) => locationSeeks.push({ time, resolve, reject }));
  });
  await page.getByRole("button", { name: "定位关键帧 1", exact: true }).click();
  assert.equal(await page.evaluate(() => locationSeeks.length), 1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click();
  assert.equal(await page.evaluate(() => locationSeeks.length), 2);
  await page.evaluate(() => locationSeeks[0].reject(new Error("已取消的旧跳转"))); await settle(page);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), true);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  await page.evaluate(() => locationSeeks[1].resolve()); await settle(page);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), false);
});

test("keyframe location native touch commits the focused key value before the first jump", async (t) => {
  const page = await keyframeLocationFixture(t, { width: 390 }), before = await documentState(page),
    input = await touchInput(page, ".editor-inspector"), button = page.getByRole("button", { name: "定位关键帧 1", exact: true });
  await button.scrollIntoViewIfNeeded();
  await page.getByLabel("关键帧 1 不透明度（%）", { exact: true }).fill("45");
  const box = await button.boundingBox(), point = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await input.send("touchStart", [point]);
  await input.send("touchMove", [{ ...point, x: point.x + 1 }]);
  await input.send("touchEnd"); await settle(page);
  await input.assertNative();
  assert.equal(await page.evaluate(() => fixture.playhead()), 13);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.sequences[0].clips[0].transform.opacity.keyframes[0].value, .45);
  assert.equal(after.sequences[0].clips[0].transform.opacity.keyframes[0].time, 13);
  if (process.env.VIDEO_STUDIO_KEYFRAME_SCREENSHOTS) {
    await button.scrollIntoViewIfNeeded();
    await page.locator('[data-state-key="keys:transform.opacity"] .ei-card').first().screenshot({ path: "/tmp/video-studio-keyframe-location-390.png" });
  }
});

test("keyframe location render read reentry cannot cancel the new navigation owner", async (t) => {
  const page = await keyframeLocationFixture(t);
  const result = await page.evaluate(() => {
    const inspector = fixture.internals.workspace.inspector, context = inspector.context, read = context.read;
    context.seek = () => new Promise((resolve) => { globalThis.completeReentrantLocation = resolve; });
    let next;
    context.read = () => {
      const old = read(); context.read = read;
      fixture.externalEdit();
      document.querySelector('[aria-label="定位关键帧 2"]').click();
      next = inspector.keyframeNavigation;
      return old;
    };
    inspector.render();
    return { started: !!next, owned: inspector.keyframeNavigation === next, aborted: next?.controller.signal.aborted };
  });
  assert.deepEqual(result, { started: true, owned: true, aborted: false });
  await page.evaluate(() => completeReentrantLocation()); await settle(page);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("keyframe location focus reentry can start the new selection after aborting its old field finisher", async (t) => {
  const page = await keyframeLocationFixture(t);
  await page.evaluate(() => {
    const a = fixture.read().sequences[0].clips[0], b = structuredClone(a);
    b.id = "b"; b.start = a.duration;
    fixture.dispatch([{ type: "clip.add", sequenceId: "main", clip: b }], "第二个动画片段");
    const inspector = fixture.internals.workspace.inspector;
    inspector.root.addEventListener("focus", () => {
      fixture.internals.workspace.selectClips("main", ["b"]);
      document.querySelector('[aria-label="定位关键帧 1"]').click();
    }, { once: true });
  });
  await settle(page);
  const before = await documentState(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click(); await settle(page);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["b"]);
  assert.equal(await page.evaluate(() => fixture.playhead()), 960013);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("combined keyframe boundaries keep a pending navigation field from inserting a diamond action", async (t) => {
  const page = await keyframeLocationFixture(t), before = await documentState(page);
  await holdCanvasField(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click();
  await page.evaluate(() => {
    document.querySelector('[aria-label="添加不透明度（%）当前关键帧"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(await page.evaluate(() => {
    const inspector = fixture.internals.workspace.inspector;
    return { navigation: !!inspector.keyframeNavigation, action: !!inspector.keyframeAction, applies: canvasFieldReleases.length };
  }), { navigation: true, action: false, applies: 1 });
  await releaseCanvasField(page);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.sequences[0].clips[0].transform.x, .25);
  assert.deepEqual(after.sequences[0].clips[0].transform.opacity, before.sequences[0].clips[0].transform.opacity);
  assert.equal(await page.evaluate(() => fixture.playhead()), 240013);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("combined keyframe boundaries keep a pending diamond field from surrendering to navigation", async (t) => {
  const page = await keyframeLocationFixture(t), before = await documentState(page);
  await holdCanvasField(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "添加不透明度（%）当前关键帧", exact: true }).click();
  await page.evaluate(() => {
    document.querySelector('[aria-label="定位关键帧 2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(await page.evaluate(() => {
    const inspector = fixture.internals.workspace.inspector;
    return { navigation: !!inspector.keyframeNavigation, action: !!inspector.keyframeAction, applies: canvasFieldReleases.length };
  }), { navigation: false, action: true, applies: 1 });
  await releaseCanvasField(page);
  assert.equal(await page.evaluate(() => canvasFieldReleases.length), 2);
  await releaseCanvasField(page, 1);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 2);
  assert.equal(after.sequences[0].clips[0].transform.x, .25);
  assert.deepEqual(after.sequences[0].clips[0].transform.opacity.keyframes.map((key) => key.time), [0, 13, 240013, 960000]);
  assert.equal(await page.evaluate(() => fixture.playhead()), 0);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("combined keyframe boundaries allow the new selection's diamond after canceling an old navigation finisher", async (t) => {
  const page = await keyframeLocationFixture(t);
  await page.evaluate(() => {
    const { workspace } = fixture.internals, a = fixture.read().sequences[0].clips[0], b = structuredClone(a);
    b.id = "b"; b.start = a.duration;
    fixture.dispatch([{ type: "clip.add", sequenceId: "main", clip: b }], "第二个动画片段");
    workspace.inspector.root.addEventListener("focus", () => {
      workspace.selectClips("main", ["b"]);
      document.querySelector('[aria-label="添加不透明度（%）当前关键帧"]').click();
    }, { once: true });
  });
  await settle(page);
  const before = await documentState(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click(); await settle(page);
  const after = await documentState(page);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.sequences[0].clips[0], before.sequences[0].clips[0]);
  assert.deepEqual(after.sequences[0].clips[1].transform.opacity.keyframes.map((key) => key.time), [0, 13, 240013, 960000]);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["b"]);
  assert.equal(await page.evaluate(() => fixture.playhead()), 0);
  assert.deepEqual(await page.evaluate(() => {
    const inspector = fixture.internals.workspace.inspector;
    return { navigation: !!inspector.keyframeNavigation, action: !!inspector.keyframeAction, field: !!inspector.fieldFinish };
  }), { navigation: false, action: false, field: false });
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("combined keyframe boundaries preserve the new diamond owner through synchronous read and clock reentry", async (t) => {
  for (const getter of ["read", "time"]) {
    const page = await keyframeLocationFixture(t);
    await page.evaluate(() => {
      const a = fixture.read().sequences[0].clips[0], b = structuredClone(a);
      b.id = "b"; b.start = a.duration;
      fixture.dispatch([{ type: "clip.add", sequenceId: "main", clip: b }], "第二个动画片段");
      fixture.internals.workspace.inspector.context.seek = () => new Promise((resolve) => { globalThis.completeCombinedOldNavigation = resolve; });
    });
    await settle(page);
    await page.getByRole("button", { name: "定位关键帧 2", exact: true }).click();
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), true);
    const result = await page.evaluate((getter) => {
      const { workspace } = fixture.internals, inspector = workspace.inspector, context = inspector.context,
        original = context[getter], apply = context.apply;
      context.apply = (operations, label) => {
        apply(operations, label);
        return new Promise((resolve) => { globalThis.completeCombinedNewAction = resolve; });
      };
      let next;
      context[getter] = () => {
        const old = original(); context[getter] = original;
        workspace.selectClips("main", ["b"]);
        document.querySelector('[aria-label="添加不透明度（%）当前关键帧"]').click();
        next = inspector.keyframeAction;
        return old;
      };
      inspector.render();
      globalThis.combinedNewOwner = next;
      return { started: !!next, owned: inspector.keyframeAction === next, aborted: next?.controller.signal.aborted,
        navigation: !!inspector.keyframeNavigation, selection: fixture.selection() };
    }, getter);
    assert.deepEqual(result, { started: true, owned: true, aborted: false, navigation: false, selection: ["b"] }, getter);
    await page.evaluate(() => completeCombinedOldNavigation()); await settle(page);
    assert.equal(await page.evaluate(() => fixture.internals.workspace.inspector.keyframeAction === combinedNewOwner && !combinedNewOwner.controller.signal.aborted), true, getter);
    await page.evaluate(() => completeCombinedNewAction()); await settle(page);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeAction), false, getter);
    assert.equal(await page.evaluate(() => fixture.playhead()), 0, getter);
    assert.deepEqual(await page.evaluate(() => fixture.errors), [], getter);
  }
});

test("keyframe neighbors choose fresh click-time keys across pages without changing document or history", async (t) => {
  const page = await keyframeLocationFixture(t, { duration: 1100000, frameRate: { numerator: 30000, denominator: 1001 } });
  await page.evaluate(() => {
    const a = fixture.read().sequences[0].clips[0];
    a.transform.opacity = { keyframes: Array.from({ length: 25 }, (_, index) => ({ time: index * 40000 + 13, value: index / 25 })) };
    fixture.dispatch([{ type: "clip.update", sequenceId: "main", clipId: "a", patch: { transform: a.transform } }], "25个关键帧");
  }); await settle(page);
  const keys = await openLocationKeys(page), before = await documentState(page), state = await page.evaluate(() => fixture.state());
  assert.equal(await keys.getByRole("button", { name: "上一个关键帧", exact: true }).isDisabled(), true);
  assert.match(await keys.getByRole("button", { name: "上一个关键帧", exact: true }).getAttribute("title"), /之前没有/);
  // No inspector render between changing the clock and clicking: the old DOM cannot choose a target.
  await page.evaluate(() => fixture.internals.workspace.playhead = 20 * 40000 + 12);
  await keys.getByRole("button", { name: "下一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 800013);
  assert.equal(await keys.getByRole("button", { name: "定位关键帧 21", exact: true }).count(), 0);
  assert.equal(await keys.getByLabel("关键帧 1 时间（秒）", { exact: true }).count(), 1);
  await keys.getByRole("button", { name: "下一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 840013);
  await keys.getByRole("button", { name: "上一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 800013);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.evaluate(() => fixture.state().canUndo), state.canUndo);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a"]);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("keyframe neighbors exclude the current tick, bound the endpoint and activate once for held Enter or Space", async (t) => {
  const page = await keyframeLocationFixture(t, { frameRate: { numerator: 30000, denominator: 1001 } });
  await page.evaluate(() => {
    const context = fixture.internals.workspace.inspector.context, seek = context.seek;
    globalThis.neighborSeeks = [];
    context.seek = (time) => { neighborSeeks.push(time); return seek(time); };
  });
  const next = () => page.getByRole("button", { name: "下一个关键帧", exact: true });
  for (const key of ["Enter", "Space"]) {
    await next().focus();
    await page.keyboard.down(key);
    for (let index = 0; index < 3; index++) await page.keyboard.down(key);
    await page.keyboard.up(key); await settle(page);
  }
  assert.deepEqual(await page.evaluate(() => neighborSeeks), [13, 240013]);
  await next().click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 959999);
  assert.equal(await next().isDisabled(), true);
  assert.match(await next().getAttribute("title"), /之后没有/);
  await page.getByRole("button", { name: "上一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 240013);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("keyframe neighbors finish the first unblurred edit and preserve an invalid draft while clock state refreshes", async (t) => {
  const page = await keyframeLocationFixture(t), before = await documentState(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "下一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 13);
  assert.equal((await documentState(page)).revision, before.revision + 1);
  assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, .25);
  await action(page, "undo").click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences, before.sequences);
  const input = page.getByLabel("水平位置（%）", { exact: true });
  await input.fill("99999");
  const node = await input.elementHandle();
  await page.evaluate(() => { const { workspace } = fixture.internals; workspace.playhead = 960000; workspace.inspector.renderFrame(); });
  assert.equal(await node.evaluate((node) => node === document.activeElement && node.isConnected), true);
  assert.equal(await input.inputValue(), "99999");
  assert.equal(await page.getByRole("button", { name: "下一个关键帧", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "上一个关键帧", exact: true }).isEnabled(), true);
  await page.getByRole("button", { name: "上一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 960000);
  assert.equal(await input.inputValue(), "99999");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "水平位置（%）");
});

test("keyframe neighbors abort after the captured target time draft is moved and preserve rejected drafts for retry", async (t) => {
  const page = await keyframeLocationFixture(t);
  await page.getByLabel("关键帧 1 时间（秒）", { exact: true }).fill("2");
  await page.getByRole("button", { name: "下一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 0);
  assert.match(await page.locator(".ei-error").innerText(), /关键帧已变化.*重新定位/);
  await page.getByRole("button", { name: "下一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 240013);
  await page.evaluate(() => {
    const context = fixture.internals.workspace.inspector.context;
    globalThis.neighborApply = context.apply;
    context.apply = async () => { throw new Error("邻居定位前提交失败"); };
  });
  const before = await documentState(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("30");
  await page.getByRole("button", { name: "下一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 240013);
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), "30");
  assert.deepEqual(await documentState(page), before);
  await page.evaluate(() => fixture.internals.workspace.inspector.context.apply = neighborApply);
  await page.getByRole("button", { name: "下一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 480000);
  assert.equal((await documentState(page)).sequences[0].clips[0].transform.x, .3);
});

for (const change of ["sequence-aba", "clock-aba", "generation"]) test(`keyframe neighbors cancel a held field across ${change} and reject late old errors`, async (t) => {
  const page = await keyframeLocationFixture(t, { sequenceCount: 2 });
  await page.evaluate(() => fixture.internals.workspace.inspector.context.apply = () => new Promise((_resolve, reject) => { globalThis.rejectNeighborField = reject; }));
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "下一个关键帧", exact: true }).click();
  if (change === "sequence-aba") await page.evaluate(() => {
    fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "切换序列");
    fixture.dispatch([{ type: "sequence.activate", sequenceId: "main" }], "返回序列");
  });
  if (change === "clock-aba") {
    await page.evaluate(() => fixture.internals.workspace.seek(8000, true)); await settle(page);
    await page.evaluate(() => fixture.internals.workspace.seek(0, true)); await settle(page);
  }
  if (change === "generation") await page.evaluate(() => fixture.replaceGeneration("新工程"));
  const before = await documentState(page), clock = await page.evaluate(() => fixture.playhead());
  await page.evaluate(() => rejectNeighborField(new Error("旧字段错误"))); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), clock);
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), false);
});

test("keyframe neighbors use the current individual on locked tracks beyond twenty rows and keep paging unchanged", async (t) => {
  const page = await keyframeLocationFixture(t, { width: 390 });
  await page.evaluate(() => {
    const a = fixture.read().sequences[0].clips[0], b = structuredClone(a);
    b.id = "b"; b.label = "副镜头"; b.start = a.duration;
    b.transform.opacity = { keyframes: Array.from({ length: 25 }, (_, index) => ({ time: index * 8000 + 13, value: index / 25 })) };
    fixture.dispatch([{ type: "clip.add", sequenceId: "main", clip: b }], "第二个动画片段");
    fixture.internals.workspace.selectClips("main", ["a", "b"]);
  }); await settle(page);
  const keys = await openLocationKeys(page);
  await keys.getByLabel("单独编辑片段", { exact: true }).selectOption("b");
  await keys.getByRole("button", { name: "下一页关键帧", exact: true }).click();
  await page.evaluate(() => fixture.dispatch([{ type: "track.update", sequenceId: "main", trackId: "video", patch: { locked: true } }], "锁定轨道")); await settle(page);
  const readOnly = page.locator(".ei-keyframe-locations"), before = await documentState(page);
  assert.equal(await readOnly.getByRole("button", { name: /^定位关键帧/ }).count(), 5);
  await readOnly.getByRole("button", { name: "下一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 960013);
  assert.equal(await page.getByLabel("关键帧 21 时间（秒）", { exact: true }).count(), 1);
  assert.equal(await readOnly.getByRole("button", { name: /^定位关键帧/ }).count(), 5);
  assert.deepEqual(await documentState(page), before);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a", "b"]);
  for (let index = 0; index < 3; index++) {
    await keys.locator(":scope > summary").click(); await settle(page);
    assert.equal(await page.evaluate(() => fixture.internals.workspace.inspector.keyframeNeighbors.length), 0);
    await keys.locator(":scope > summary").click(); await settle(page);
    assert.equal(await page.evaluate(() => fixture.internals.workspace.inspector.keyframeNeighbors.length), 2);
  }
  await readOnly.scrollIntoViewIfNeeded();
  await readOnly.screenshot({ path: "/tmp/video-studio-keyframe-neighbors-locked-390.png" });
  assert.equal(await page.locator(".editor-inspector").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
});

test("keyframe neighbors accept native touch after an unblurred value and fit a 390 pixel panel", async (t) => {
  const page = await keyframeLocationFixture(t, { width: 390 }), input = await touchInput(page, ".editor-inspector");
  await page.getByLabel("关键帧 1 不透明度（%）", { exact: true }).fill("45");
  const next = page.getByRole("button", { name: "下一个关键帧", exact: true });
  await next.scrollIntoViewIfNeeded();
  const box = await next.boundingBox(), point = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await input.send("touchStart", [point]);
  await input.send("touchMove", [{ ...point, x: point.x + 1 }]);
  await input.send("touchEnd"); await settle(page);
  await input.assertNative();
  assert.equal(await page.evaluate(() => fixture.playhead()), 13);
  assert.equal((await documentState(page)).sequences[0].clips[0].transform.opacity.keyframes[0].value, .45);
  await next.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/video-studio-keyframe-neighbors-390.png" });
  assert.equal(await page.locator(".editor-inspector").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
});

test("keyframe neighbors reject fresh-read replacement and clock-getter reentry keeps the newer navigation", async (t) => {
  const page = await keyframeLocationFixture(t);
  await page.evaluate(() => {
    const context = fixture.internals.workspace.inspector.context, read = context.read;
    context.read = () => { const old = read(); context.read = read; fixture.externalEdit(); return old; };
  });
  await page.getByRole("button", { name: "下一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 0);
  const result = await page.evaluate(() => {
    const { workspace } = fixture.internals, inspector = workspace.inspector, context = inspector.context;
    const a = fixture.read().sequences[0].clips[0], b = structuredClone(a);
    b.id = "b"; b.start = a.duration;
    fixture.dispatch([{ type: "clip.add", sequenceId: "main", clip: b }], "副镜头");
    const time = context.time;
    context.seek = (tick) => new Promise((resolve) => { globalThis.finishNeighborSeek = resolve; globalThis.reentrantNeighborTick = tick; });
    let next;
    context.time = () => {
      const old = time(); context.time = time;
      workspace.selectClips("main", ["b"]);
      [...document.querySelectorAll('.editor-inspector button')].find((button) => button.textContent === "下一个关键帧").click();
      next = inspector.keyframeNavigation;
      return old;
    };
    [...document.querySelectorAll('.editor-inspector button')].find((button) => button.textContent === "下一个关键帧").click();
    return { owned: inspector.keyframeNavigation === next, aborted: next?.controller.signal.aborted, tick: reentrantNeighborTick };
  });
  assert.deepEqual(result, { owned: true, aborted: false, tick: 960013 });
  await page.evaluate(() => finishNeighborSeek()); await settle(page);
  assert.equal(await page.evaluate(() => !!fixture.internals.workspace.inspector.keyframeNavigation), false);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("keyframe neighbors keep different properties' individual targets and focused drafts independent", async (t) => {
  const page = await keyframeLocationFixture(t);
  await page.evaluate(() => {
    const a = fixture.read().sequences[0].clips[0], b = structuredClone(a);
    a.transform.x = { keyframes: [{ time: 13, value: 0 }, { time: a.duration, value: 1 }] };
    b.id = "b"; b.label = "副镜头"; b.start = a.duration;
    fixture.dispatch([
      { type: "clip.update", sequenceId: "main", clipId: "a", patch: { transform: a.transform } },
      { type: "clip.add", sequenceId: "main", clip: b },
    ], "两个动画片段");
    fixture.internals.workspace.selectClips("main", ["a", "b"]);
  }); await settle(page);
  const opacity = await openLocationKeys(page);
  await opacity.getByLabel("单独编辑片段", { exact: true }).selectOption("b");
  const x = page.locator('[data-state-key="keys:transform.x"]');
  await x.locator(":scope > summary").click();
  assert.equal(await opacity.getByRole("button", { name: "下一个关键帧", exact: true }).isEnabled(), true);
  const field = page.getByLabel("垂直位置（%）", { exact: true });
  await field.fill("30");
  const node = await field.elementHandle();
  await page.evaluate(() => { const { workspace } = fixture.internals; workspace.playhead = 480013; workspace.inspector.renderFrame(); });
  assert.equal(await node.evaluate((node) => document.activeElement === node && node.isConnected), true);
  assert.equal(await opacity.getByRole("button", { name: "上一个关键帧", exact: true }).isDisabled(), true);
  assert.equal(await opacity.getByRole("button", { name: "下一个关键帧", exact: true }).isEnabled(), true);
  assert.equal(await x.getByRole("button", { name: "上一个关键帧", exact: true }).isEnabled(), true);
  assert.equal(await x.getByRole("button", { name: "下一个关键帧", exact: true }).isEnabled(), true);
  await opacity.getByRole("button", { name: "下一个关键帧", exact: true }).click(); await settle(page);
  assert.equal(await page.evaluate(() => fixture.playhead()), 960013);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["a", "b"]);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("keyframe neighbors never recreate readonly controls from a queued callback after disposal", async (t) => {
  const page = await keyframeLocationFixture(t);
  await page.evaluate(() => fixture.dispatch([{ type: "track.update", sequenceId: "main", trackId: "video", patch: { locked: true } }], "锁定轨道"));
  await settle(page);
  const result = await page.evaluate(async () => {
    const inspector = fixture.internals.workspace.inspector;
    inspector.render(); // The locked details' location drawer is queued for this render.
    inspector.dispose();
    await Promise.resolve();
    return { controls: inspector.keyframeNeighbors.length, drawer: !!inspector.root.querySelector(".ei-keyframe-locations") };
  });
  assert.deepEqual(result, { controls: 0, drawer: false });
});

test("fit selection finishes the first inspector draft once and the view needs no undo entry", async (t) => {
  const page = await timelineControlDraftFixture(t), before = await documentState(page);
  await page.getByLabel("水平位置（%）", { exact: true }).fill("25");
  await timelineControl(page, "fit-selection").click(); await settle(page);
  const after = await documentState(page), view = await page.evaluate(() => {
    const c = fixture.internals.workspace.timeline; return { scale: c.scale, width: c.viewport().clientWidth };
  });
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.sequences[0].clips[0].transform.x, 0.25);
  assert.equal(view.scale, (view.width - 60) / (after.sequences[0].clips[0].duration / 240000));
  await action(page, "undo").click(); await settle(page);
  assert.deepEqual((await documentState(page)).sequences, before.sequences);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("fit selection retains an invalid inspector draft and does not change the timeline view", async (t) => {
  const page = await timelineControlDraftFixture(t), before = await documentState(page), view = await page.evaluate(() => fixture.internals.workspace.timeline.scale);
  const field = page.getByLabel("水平位置（%）", { exact: true }); await field.fill("1001");
  await timelineControl(page, "fit-selection").click(); await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.evaluate(() => fixture.internals.workspace.timeline.scale), view);
  assert.equal(await field.inputValue(), "1001"); assert.equal(await field.evaluate((node) => node === document.activeElement), true);
});

for (const ending of ["selection", "generation", "sequence", "revision"]) {
  test(`fit selection cannot apply an awaiting old view intent after ${ending}`, async (t) => {
    const page = await timelineControlDraftFixture(t, { sequenceCount: 2 });
    await beginHeldControl(page, "fit-selection");
    if (ending === "selection") await page.evaluate(() => fixture.internals.workspace.selectClips("main", ["sound"]));
    if (ending === "generation") await page.evaluate(() => fixture.replaceGeneration());
    if (ending === "sequence") await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "sequence-2" }], "切换序列"));
    if (ending === "revision") await page.evaluate(() => fixture.externalEdit());
    const before = await documentState(page), view = await page.evaluate(() => fixture.internals.workspace.timeline.scale);
    await releaseCanvasField(page); await settle(page);
    assert.deepEqual(await documentState(page), before);
    assert.equal(await page.evaluate(() => fixture.internals.workspace.timeline.scale), view);
    assert.equal(await page.evaluate(() => !!fixture.internals.workspace.timeline.pendingControl), false);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}

test("fit selection ignores a fresh-read reentry that changes the selected target", async (t) => {
  const page = await timelineControlDraftFixture(t), before = await documentState(page), view = await page.evaluate(() => fixture.internals.workspace.timeline.scale);
  await page.evaluate(() => {
    const c = fixture.internals.workspace.timeline, read = c.context.read;
    c.context.read = () => { const doc = read(); c.context.read = read; fixture.internals.workspace.selectClips("main", ["sound"]); return doc; };
  });
  await timelineControl(page, "fit-selection").click(); await settle(page);
  assert.deepEqual(await documentState(page), before);
  assert.equal(await page.evaluate(() => fixture.internals.workspace.timeline.scale), view);
  assert.deepEqual(await page.evaluate(() => fixture.selection()), ["sound"]);
});

test("fit selection keeps a native IME track-name draft and the first view action", async (t) => {
  const page = await timelineControlDraftFixture(t), before = await documentState(page), cdp = await page.context().newCDPSession(page);
  await page.getByLabel("轨道名称 画面轨", { exact: true }).fill("");
  await cdp.send("Input.imeSetComposition", { text: "正式画面轨", selectionStart: 5, selectionEnd: 5 });
  await timelineControl(page, "fit-selection").click(); await settle(page);
  const after = await documentState(page), view = await page.evaluate(() => {
    const c = fixture.internals.workspace.timeline; return { scale: c.scale, width: c.viewport().clientWidth };
  });
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.sequences[0].tracks[0].name, "正式画面轨");
  assert.equal(view.scale, (view.width - 60) / (after.sequences[0].clips[0].duration / 240000));
  assert.deepEqual(await page.evaluate(() => fixture.errors), []); await cdp.detach();
});

test("fit selection keeps the chosen view across playback frames without stopping the clock", async (t) => {
  const page = await playbackFollowFixture(t), before = await documentState(page);
  await page.evaluate(() => {
    const { workspace } = fixture.internals, doc = fixture.read(), original = doc.sequences[0].clips[0];
    fixture.dispatch([{ type: "track.add", sequenceId: "main", track: editor.createTrack("far", "video") },
      { type: "clip.add", sequenceId: "main", clip: { ...original, id: "far", trackId: "far", start: 100 * 240000, duration: 2 * 240000,
        timeMap: { points: [{ time: 0, source: 0 }, { time: 2 * 240000, source: 2 * 240000 }] } } }], "远处审核片段");
    workspace.selectClips("main", ["far"]); workspace.timeline.setPlaybackActive(true);
  });
  const selected = await documentState(page);
  await timelineControl(page, "fit-selection").click(); await settle(page);
  const fitted = await page.locator(".et-scroll").evaluate((node) => node.scrollLeft);
  const time = await page.evaluate(() => fixture.internals.workspace.getPlayhead());
  await page.evaluate(() => { const w = fixture.internals.workspace; w.preview.options.onFrame(w.getPlayhead() + 8000); });
  assert.equal(await page.evaluate(() => fixture.internals.workspace.getPlayhead()), time + 8000);
  assert.equal(await page.locator(".et-scroll").evaluate((node) => node.scrollLeft), fitted);
  assert.equal(await page.evaluate(() => fixture.internals.workspace.timeline.playbackActive), true);
  assert.deepEqual(await documentState(page), selected);
  assert.ok(selected.revision > before.revision);
});


for (const scope of ["current", "locked", "nested"]) {
  test(`caption row navigation shows the exact off-frame composition in a ${scope} sequence`, async (t) => {
    const page = await fixture(t, { sequenceCount: scope === "nested" ? 2 : 1 }), start = 240013;
    const id = await page.evaluate(async ({ scope, start }) => {
      const { session, workspace } = fixture.internals,
        sequenceId = scope === "nested" ? "sequence-2" : "main",
        controller = editor.createCaptionController({
          session: () => session,
          apply: async (operations, identity, label) => session.dispatch(operations, identity, label),
        }),
        id = await controller.add(sequenceId, { start, duration: 240000, text: "帧间字幕" });
      if (scope === "locked") fixture.dispatch([
        { type: "track.update", sequenceId, trackId: "text", patch: { locked: true } },
      ], "锁定字幕轨");
      if (scope === "nested") {
        const clip = structuredClone(session.read().sequences[0].clips[0]);
        delete clip.assetId;
        fixture.dispatch([
          { type: "clip.remove", sequenceId: "main", clipIds: [clip.id] },
          { type: "clip.add", sequenceId: "main", clip: { ...clip,
            id: "nested", kind: "sequence", sequenceId, trackId: "video" } },
          { type: "sequence.activate", sequenceId },
        ], "打开被引用的子序列");
      }
      const host = document.createElement("section"); document.body.append(host);
      const ui = new editor.EditorCaptionsUI(host, {
        session: () => session, controller, presentation: "inline",
        currentTime: () => workspace.currentTime(),
        select: (sequenceId, ids) => workspace.selectClips(sequenceId, ids),
        seek: (tick, exact) => workspace.seek(tick, exact),
      });
      ui.mount(host); ui.open();
      const draw = workspace.preview.compositor.draw.bind(workspace.preview.compositor);
      globalThis.captionFrames = [];
      workspace.preview.compositor.draw = (canvas, frame, ...args) => {
        captionFrames.push({ time: frame.time, captions: frame.layers.filter((layer) => layer.kind === "text").map((layer) => layer.clipId) });
        return draw(canvas, frame, ...args);
      };
      return id;
    }, { scope, start });
    const before = await documentState(page);
    await page.locator(`[data-caption-id="${id}"] .ec-seek`).click();
    await page.waitForFunction(({ id, start }) => captionFrames.at(-1)?.time === start && captionFrames.at(-1).captions.includes(id), { id, start });
    assert.equal(await page.evaluate(() => fixture.playhead()), start);
    assert.deepEqual(await page.evaluate(() => fixture.selection()), [id]);
    assert.deepEqual(await documentState(page), before, "Viewing a subtitle never edits or unlocks it");
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
}


async function framePng(page, index = 0) {
  return page.evaluate(async (index) => {
    const { blob, name } = fixture.frameDownloads[index], image = await createImageBitmap(blob), canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0); image.close();
    return { name, type: blob.type, width: canvas.width, height: canvas.height,
      center: [...ctx.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data],
      corner: [...ctx.getImageData(0,0,1,1).data] };
  }, index);
}
async function savedFrame(page, count = 1) {
  await page.getByRole("button", { name: "保存已应用画面 PNG", exact: true }).click();
  await page.waitForFunction((count) => fixture.frameDownloads.length === count, count);
}
async function holdFrameBlob(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector("[data-ew-canvas]"), original = canvas.toBlob.bind(canvas);
    globalThis.frameBlobCallbacks = [];
    canvas.toBlob = (callback, ...args) => original((blob) => frameBlobCallbacks.push(() => callback(blob)), ...args);
  });
}

test("PNG frame saves the exact applied composition at each viewer quality without changing project or selection", async (t) => {
  const page = await fixture(t, { frameCapture: true });
  await page.evaluate(() => {
    fixture.dispatch([{ type: "clip.remove", sequenceId: "main", clipIds: ["a"] }, { type: "clip.add", sequenceId: "main", clip: {
      id:"shape",label:"红色成片",kind:"shape",trackId:"video",start:123,duration:100000,shape:"rectangle",fill:"#ff0000",stroke:"#00000000",strokeWidth:0,
      transform:{...editor.defaultTransform(),scaleX:0.5,scaleY:0.5},color:editor.defaultColorAdjustment(),blendMode:"normal"
    } }], "精确画面");
    fixture.internals.workspace.selectClips("main", ["shape"]);
    return fixture.internals.workspace.seek(123,true);
  });
  const before = await documentState(page), selected = await page.evaluate(() => fixture.selection());
  for (const [index, quality, width, height] of [[0,"1",320,180],[1,"0.5",160,90],[2,"0.25",80,45]]) {
    await page.getByLabel("预览质量", {exact:true}).selectOption(quality);
    await savedFrame(page,index+1);
    const png = await framePng(page,index);
    assert.equal(png.type,"image/png"); assert.equal(png.width,width); assert.equal(png.height,height);
    assert.deepEqual(png.center,[255,0,0,255]); assert.deepEqual(png.corner,[0,0,0,255]);
    assert.match(png.name,new RegExp(`_t123_${width}x${height}\\.png$`));
    assert.equal(await page.getByLabel("预览质量",{exact:true}).inputValue(),quality);
  }
  assert.deepEqual(await documentState(page),before); assert.deepEqual(await page.evaluate(()=>fixture.selection()),selected);
});

test("PNG frame waits for the requested new composition instead of downloading the old pending-decode canvas", async (t) => {
  const page = await fixture(t, { frameCapture: true });
  await page.evaluate(() => fixture.pendingPicture());
  await page.waitForFunction(() => fixture.imageRequests().length === 1);
  await page.getByRole("button",{name:"保存已应用画面 PNG",exact:true}).click();
  await page.waitForFunction(() => fixture.imageRequests().length === 2);
  assert.equal(await page.evaluate(()=>fixture.frameDownloads.length),0);
  await page.evaluate(()=>{fixture.resolveImage(0);fixture.resolveImage(1);});
  await page.waitForFunction(()=>fixture.frameDownloads.length===1);
  assert.deepEqual((await framePng(page)).center,[255,0,0,255]);
});

for (const [field,value,owner] of [["水平位置（%）","25","inspector"],["轨道名称 画面轨","已保存轨道名","timeline"]]) {
  test(`PNG frame finishes a valid ${owner} draft on the first click with one independent undo`, async(t)=>{
    const page=await fixture(t,{frameCapture:true}); await page.locator('[data-et-clip="a"]').click();
    const before=await documentState(page); await page.getByLabel(field,{exact:true}).fill(value); await savedFrame(page);
    const after=await documentState(page); assert.equal(after.revision,before.revision+1);
    await action(page,"undo").click(); assert.deepEqual(semantic(await documentState(page)),semantic(before));
    assert.equal(await page.evaluate(()=>fixture.frameDownloads.length),1); assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);
  });
}

test("PNG frame retains invalid focused input and unapplied Timing/project-name drafts", async(t)=>{
  const page=await fixture(t,{frameCapture:true});await page.locator('[data-et-clip="a"]').click();
  const before=await documentState(page),input=page.getByLabel("水平位置（%）",{exact:true});
  await input.fill("1001");await page.getByRole("button",{name:"保存已应用画面 PNG",exact:true}).click();
  await page.waitForFunction(()=>!fixture.internals.workspace.frameCapture);
  assert.equal(await input.inputValue(),"1001");assert.equal(await input.evaluate(node=>node===document.activeElement),true);
  assert.equal(await page.evaluate(()=>fixture.frameDownloads.length),0); assert.deepEqual(await documentState(page),before);
  await input.fill("0");await input.press("Tab");
  const speed=page.getByLabel("恒定速度（倍）",{exact:true});await speed.fill("2");
  const name=page.getByLabel("工程名称",{exact:true});await name.fill("名称尚未应用");await savedFrame(page);
  assert.equal(await speed.inputValue(),"2");
  assert.equal(await name.inputValue(),"名称尚未应用");assert.equal((await documentState(page)).name,before.name);
  assert.ok((await framePng(page)).name.startsWith(before.name+"_"));
});

for (const change of ["revision","generation","sequence","selection","time","quality","source","hide","dispose"]) {
  test(`PNG frame discards a late encoded frame after ${change} changes`,async(t)=>{
    const page=await fixture(t,{frameCapture:true,sequenceCount:2});await holdFrameBlob(page);
    await page.getByRole("button",{name:"保存已应用画面 PNG",exact:true}).click();await page.waitForFunction(()=>frameBlobCallbacks.length===1);
    await page.evaluate(async(change)=>{
      if(change==="revision")fixture.externalEdit();
      if(change==="generation")await fixture.replaceGeneration();
      if(change==="sequence")fixture.dispatch([{type:"sequence.activate",sequenceId:"sequence-2"}],"切序列");
      if(change==="selection")fixture.internals.workspace.selectClips("main",["a"]);
      if(change==="time")await fixture.internals.workspace.seek(8000);
      if(change==="quality") {const el=document.querySelector('[data-ew-quality]');el.value="0.5";el.dispatchEvent(new Event("change",{bubbles:true}));}
      if(change==="source")fixture.sourcePreview(true);
      if(change==="hide")fixture.hide();
      if(change==="dispose")await fixture.dispose();
      frameBlobCallbacks[0]();
    },change);
    await settle(page);assert.equal(await page.evaluate(()=>fixture.frameDownloads.length),0);
    assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);
  });
}

test("PNG frame freezes playback, captures its latest completed tick and handles the natural end",async(t)=>{
  const page=await fixture(t,{frameCapture:true,duration:24000});await action(page,"play").click();
  await page.waitForFunction(()=>fixture.playing());await savedFrame(page);
  assert.equal(await page.evaluate(()=>fixture.playing()),false);
  const time=await page.evaluate(()=>fixture.playhead());assert.match((await framePng(page)).name,new RegExp(`_t${time}_`));
  await page.evaluate(()=>{fixture.internals.workspace.playhead=24000;});await savedFrame(page,2);
  assert.match((await framePng(page,1)).name,/_t23999_/);
});

for (const width of [280,390]) {
  test(`PNG frame remains visible and operable at ${width}px`,async(t)=>{
    const page=await fixture(t,{frameCapture:true,width,layout:"embedded"});
    await page.evaluate(()=>{document.querySelector(".workspace").dataset.narrowPanel="viewer";});
    await savedFrame(page);
    const snapshot=page.getByRole("button",{name:"保存已应用画面 PNG",exact:true}),quality=page.getByLabel("预览质量",{exact:true});
    const a=await snapshot.boundingBox(),b=await quality.boundingBox();
    assert.ok(a&&b);assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
    await page.screenshot({path:`/tmp/video-studio-frame-png-${width}.png`,fullPage:true});
  });
}


test("PNG frame supports text-only compositions and disables an actually empty sequence",async(t)=>{
  const page=await fixture(t,{frameCapture:true,clipCount:1});
  await page.evaluate(()=>fixture.dispatch([{type:"clip.remove",sequenceId:"main",clipIds:["a"]}],"清空片段"));
  assert.equal(await page.getByRole("button",{name:"保存已应用画面 PNG",exact:true}).isDisabled(),true);
  await action(page,"title").click();await savedFrame(page);
  assert.equal((await documentState(page)).assets.length,0);assert.equal((await framePng(page)).type,"image/png");
});

test("PNG frame failed draft dispatch is correctable and a later valid click still saves",async(t)=>{
  const page=await fixture(t,{frameCapture:true});await page.locator('[data-et-clip="a"]').click();
  const input=page.getByLabel("水平位置（%）",{exact:true});await input.fill("25");
  await page.evaluate(()=>{const context=fixture.internals.workspace.inspector.context,original=context.apply;context.apply=()=>{context.apply=original;return Promise.reject(new Error("属性保存未完成"));};});
  await page.getByRole("button",{name:"保存已应用画面 PNG",exact:true}).click();
  await page.waitForFunction(()=>!fixture.internals.workspace.frameCapture);
  assert.equal(await input.inputValue(),"25");assert.equal(await input.evaluate(node=>node===document.activeElement),true);
  assert.equal(await page.evaluate(()=>fixture.frameDownloads.length),0);await savedFrame(page);
  assert.equal((await documentState(page)).sequences[0].clips[0].transform.x,0.25);
});

for(const change of ["release","Escape","generation","selection","dispose"]){
  test(`PNG frame async owned field handles ${change} before taking a snapshot`,async(t)=>{
    const page=await fixture(t,{frameCapture:true});await page.locator('[data-et-clip="a"]').click();await holdCanvasField(page);
    await page.getByLabel("水平位置（%）",{exact:true}).fill("25");
    await page.getByRole("button",{name:"保存已应用画面 PNG",exact:true}).click();await page.waitForFunction(()=>canvasFieldReleases.length===1);
    if(change==="Escape")await page.keyboard.press("Escape");
    if(change==="generation")await page.evaluate(()=>fixture.replaceGeneration());
    if(change==="selection")await page.evaluate(()=>fixture.internals.workspace.selectClips("main",[]));
    if(change==="dispose")await page.evaluate(()=>fixture.dispose());
    await releaseCanvasField(page);if(change==="release")await page.waitForFunction(()=>fixture.frameDownloads.length===1);
    else assert.equal(await page.evaluate(()=>fixture.frameDownloads.length),0);
    assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);
  });
}

test("PNG frame an older toBlob completion cannot cancel a new save and keyboard activation works",async(t)=>{
  const page=await fixture(t,{frameCapture:true});await holdFrameBlob(page);
  const button=page.getByRole("button",{name:"保存已应用画面 PNG",exact:true});
  await button.click();await page.waitForFunction(()=>frameBlobCallbacks.length===1);await page.keyboard.press("Escape");
  await button.focus();await button.press("Enter");await page.waitForFunction(()=>frameBlobCallbacks.length===2);
  await page.evaluate(()=>frameBlobCallbacks[0]());await settle(page);
  assert.equal(await button.isDisabled(),true);assert.equal(await page.evaluate(()=>fixture.frameDownloads.length),0);
  await page.evaluate(()=>frameBlobCallbacks[1]());await page.waitForFunction(()=>fixture.frameDownloads.length===1);
  assert.equal(await button.isDisabled(),false);
});

test("PNG frame native composition ends once and captures the committed track name without changing selection",async(t)=>{
  const page=await fixture(t,{frameCapture:true});const input=page.getByLabel("轨道名称 画面轨",{exact:true});await input.fill("");await input.focus();
  const cdp=await page.context().newCDPSession(page);await cdp.send("Input.imeSetComposition",{text:"成片画面轨",selectionStart:5,selectionEnd:5});
  const before=await documentState(page);await savedFrame(page);
  const after=await documentState(page);assert.equal(after.revision,before.revision+1);assert.equal(after.sequences[0].tracks[0].name,"成片画面轨");
  assert.deepEqual(await page.evaluate(()=>fixture.selection()),[]);assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);
});

test("PNG frame a fresh-read external session edit cannot attach an old document to the new revision",async(t)=>{
  const page=await fixture(t,{frameCapture:true});
  await page.evaluate(()=>{
    const session=fixture.internals.session,original=session.read.bind(session);
    session.read=()=>{const old=original();session.read=original;fixture.externalEdit();return old;};
  });
  await page.getByRole("button",{name:"保存已应用画面 PNG",exact:true}).click();await settle(page);
  assert.equal(await page.evaluate(()=>fixture.frameDownloads.length),0);
  assert.equal((await documentState(page)).name,"外部编辑 3");assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);
});

test("PNG frame an identity getter cannot let an old completion clear a reentrant new capture",async(t)=>{
  const page=await fixture(t,{frameCapture:true});await holdFrameBlob(page);
  await page.getByRole("button",{name:"保存已应用画面 PNG",exact:true}).click();await page.waitForFunction(()=>frameBlobCallbacks.length===1);
  await page.evaluate(()=>{
    const {session,workspace}=fixture.internals,original=session.getState.bind(session);
    session.getState=()=>{
      const old=original();session.getState=original;workspace.cancelFrameCapture();void workspace.saveFrame();return old;
    };
    frameBlobCallbacks[0]();
  });
  await page.waitForFunction(()=>frameBlobCallbacks.length===2);
  assert.equal(await page.evaluate(()=>fixture.frameDownloads.length),0);assert.equal(await page.evaluate(()=>!!fixture.internals.workspace.frameCapture),true);
  await page.evaluate(()=>frameBlobCallbacks[1]());await page.waitForFunction(()=>fixture.frameDownloads.length===1);
});

test("PNG frame holding Enter does not repeatedly download after an earlier PNG has completed",async(t)=>{
  const page=await fixture(t,{frameCapture:true}),button=page.getByRole("button",{name:"保存已应用画面 PNG",exact:true});
  await button.focus();await page.keyboard.down("Enter");await page.waitForFunction(()=>fixture.frameDownloads.length===1);
  await button.focus();
  for(let index=0;index<3;index++){await page.keyboard.down("Enter");await settle(page);}
  await page.keyboard.up("Enter");assert.equal(await page.evaluate(()=>fixture.frameDownloads.length),1);
  await button.focus();await page.keyboard.press("Enter");await page.waitForFunction(()=>fixture.frameDownloads.length===2);
});

test("PNG frame keeps an off-frame last tick through same-clock redraw and quality refresh",async(t)=>{
  const page=await fixture(t,{frameCapture:true,duration:80001});
  await page.evaluate(()=>{
    fixture.dispatch([{type:"clip.add",sequenceId:"main",clip:{id:"last-thirteen",label:"最后13tick",kind:"shape",trackId:"video",start:80001,duration:13,
      shape:"rectangle",fill:"#ff0000",stroke:"#00000000",strokeWidth:0,transform:editor.defaultTransform(),color:editor.defaultColorAdjustment(),blendMode:"normal"}}],"添加尾部精确画面");
  });
  await settle(page);await page.evaluate(()=>{fixture.internals.workspace.playhead=80014;});
  await savedFrame(page);assert.equal(await page.evaluate(()=>fixture.playhead()),80013);
  assert.deepEqual((await framePng(page)).center,[255,0,0,255]);
  await page.evaluate(()=>fixture.internals.workspace.seek(fixture.playhead()));
  assert.equal(await page.evaluate(()=>fixture.playhead()),80013);
  assert.deepEqual(await page.evaluate(()=>[...document.querySelector('[data-ew-canvas]').getContext("2d").getImageData(160,90,1,1).data]),[255,0,0,255]);
  await page.getByLabel("预览质量",{exact:true}).selectOption("0.5");
  await page.waitForFunction(()=>document.querySelector('[data-ew-canvas]').width===160);
  assert.equal(await page.evaluate(()=>fixture.playhead()),80013);
  assert.deepEqual(await page.evaluate(()=>[...document.querySelector('[data-ew-canvas]').getContext("2d").getImageData(80,45,1,1).data]),[255,0,0,255]);
});

test("PNG save hint follows restored preview quality while image decoding is pending", async (t) => {
  const page = await fixture(t, { frameCapture: true, qualityPreference: true, holdQualityLoad: true });
  await page.evaluate(() => fixture.pendingPicture());
  await page.waitForFunction(() => fixture.imageRequests().length === 1);
  await page.evaluate(() => releaseQualityLoad(0.5));
  await page.waitForFunction(() => fixture.imageRequests().length === 2);
  assert.equal(await page.getByLabel("预览质量", { exact: true }).inputValue(), "0.5");
  assert.match(await page.getByRole("button", { name: "保存已应用画面 PNG", exact: true }).getAttribute("title"), /160 × 90/);
  await page.evaluate(() => fixture.imageRequests().forEach((_, index) => fixture.resolveImage(index)));
  await page.waitForFunction(() => document.querySelector("[data-ew-canvas]").width === 160);
  await savedFrame(page);
  const png = await framePng(page);
  assert.equal(png.width, 160); assert.equal(png.height, 90);
  assert.deepEqual(png.center, [255, 0, 0, 255]);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});
