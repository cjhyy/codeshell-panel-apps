import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { touchInput } from "./helpers/video-studio-touch.mjs";

let browser, source, css;
before(async () => {
  const repository = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: {
      contents: `
    export { EditorTimeline } from './apps/video-studio/src/editor/timeline-ui';
    export { EditorHistory } from './apps/video-studio/src/editor/history';
    export { evaluateFrame } from './apps/video-studio/src/editor/evaluate';
    export * from './apps/video-studio/src/editor/defaults';
    export * from './apps/video-studio/src/editor/time';
  `,
      resolveDir: repository,
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
      ["style.css", "editor-timeline.css"].map((name) =>
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
  const page = await browser.newPage({ viewport: { width: options.touch ? 680 : 1240, height: 900 }, hasTouch: !!options.touch }),
    pageErrors = [];
  page.setDefaultTimeout(3000);
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  t.after(async () => {
    await page.close();
    assert.deepEqual(pageErrors, [], "UI must not emit uncaught exceptions");
  });
  // A localhost origin supplies the same secure-context randomUUID API as the installed desktop document.
  await page.route("http://127.0.0.1:41789/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><div id="timeline"></div><button id="undo">撤销最后一步</button><button id="redo">重做最后一步</button><input id="outside" aria-label="外部输入"></body></html>',
    }),
  );
  await page.goto("http://127.0.0.1:41789/timeline");
  await page.addStyleTag({
    content:
      css +
      `\nbody{display:block;margin:0;padding:16px;overflow:auto;background:#202124}#timeline{width:${options.touch ? 640 : 1140}px}#undo,#redo,#outside{margin:14px 6px 0 0}`,
  });
  await page.addScriptTag({ content: source });
  await page.evaluate((options) => {
    const sec = (value) => Math.round(value * 240000);
    const tracks = options.tracks ?? ["v1", "v2", "v3", "audio", "text"];
    const specifications = options.clips ?? [
      { id: "a", trackId: "v1", start: 1, duration: 2 },
      { id: "b", trackId: "v2", start: 2, duration: 2 },
      { id: "c", trackId: "v1", start: 6, duration: 2 },
    ];
    const visual = () => ({
      transform: editor.defaultTransform(),
      color: editor.defaultColorAdjustment(),
      blendMode: "normal",
    });
    const clips = specifications.map(({ id, trackId, start, duration, groupId, linkGroupId }) => ({
      id,
      label: id,
      kind: "media",
      trackId,
      start: sec(start),
      duration: sec(duration),
      assetId: "asset",
      timeMap: {
        points: [
          { time: 0, source: 0 },
          { time: sec(duration), source: sec(duration) },
        ],
      },
      ...visual(),
      audio: editor.defaultAudioMix(),
      ...(groupId ? { groupId } : {}),
      ...(linkGroupId ? { linkGroupId } : {}),
    }));
    if (options.caption) {
      const owner = clips.find((clip) => clip.id === "a");
      clips.push({
        id: "caption",
        label: "字幕",
        kind: "text",
        role: "subtitle",
        trackId: "text",
        start: owner.start,
        duration: owner.duration,
        ...visual(),
        text: "one two",
        style: editor.defaultTextStyle(),
        words: [
          { text: "one", start: 0, end: owner.duration / 2 },
          { text: "two", start: owner.duration / 2, end: owner.duration },
        ],
        sourceBinding: { clipId: owner.id, sourceStart: 0, sourceEnd: owner.duration },
      });
    }
    const doc = {
      schemaVersion: 2,
      timebase: 240000,
      id: "document",
      name: "时间线测试",
      revision: 3,
      assets: [
        {
          id: "asset",
          name: "素材",
          kind: "video",
          duration: sec(24 * 3600),
          resourceId: "authorized-fixture-resource",
        },
      ],
      sequences: [
        {
          id: "main",
          name: "主序列",
          width: 1920,
          height: 1080,
          frameRate: options.ntsc
            ? { numerator: 30000, denominator: 1001 }
            : { numerator: 30, denominator: 1 },
          background: "#000000",
          timelineMode: options.magnetic ? "magnetic" : "free",
          ...(options.magneticTrackId ? { magneticTrackId: options.magneticTrackId } : {}),
          tracks: tracks.map((id) =>
            editor.createTrack(
              id,
              id.startsWith("audio") ? "audio" : id.startsWith("text") ? "text" : "video",
              id,
            ),
          ),
          clips,
          transitions: (options.transitions ?? []).map((value) => ({
            ...value,
            start: sec(value.start),
            duration: sec(value.duration),
          })),
          markers: options.markers ?? [],
        },
      ],
      activeSequenceId: "main",
      exportProfiles: [],
    };
    if (options.destinationTracks)
      doc.sequences.push({
        ...structuredClone(doc.sequences[0]),
        id: "target",
        name: "目标序列",
        tracks: options.destinationTracks.map(({ id, kind }) => editor.createTrack(id, kind)),
        clips: [],
        transitions: [],
      });
    if (options.secondSequence) doc.sequences.push({
      ...structuredClone(doc.sequences[0]), id: "secondary", name: "第二序列",
    });
    let history = new editor.EditorHistory(doc);
    let selection = [],
      time = 0,
      generation = 1,
      timeline,
      deferNext = false,
      pendingEdit,
      activeSequenceId = doc.activeSequenceId,
      documentId = doc.id;
    const applied = [],
      drops = [],
      errors = [];
    timeline = new editor.EditorTimeline(document.querySelector("#timeline"), {
      read: () => history.read(),
      identity: options.noIdentity ? undefined : () => ({ documentId, revision: history.revision, generation }),
      selection: () => ({ sequenceId: activeSequenceId, clipIds: [...selection] }),
      // Selection alone is parent view state; the component owns its own render lifecycle.
      select: (ids) => {
        selection = [...ids];
      },
      time: () => time,
      seek: (value) => {
        time = value;
        timeline.updatePlayhead();
      },
      addAsset: (assetId, placement) => {
        drops.push({ assetId, ...placement });
      },
      apply: (operations, label) => {
        const owner = history,
          before = owner.revision;
        const commit = () => {
          owner.apply(operations, before, label);
          applied.push({
            operations: structuredClone(operations),
            label,
            before,
            after: owner.revision,
          });
        };
        if (!deferNext) return commit();
        deferNext = false;
        return new Promise((resolve, reject) => {
          pendingEdit = (failed) => {
            pendingEdit = undefined;
            if (failed) return reject(new Error("保存失败"));
            try {
              commit();
              resolve();
            } catch (error) {
              reject(error);
            }
          };
        });
      },
      onError: (error) => {
        errors.push(String(error));
      },
    });
    document.querySelector("#undo").onclick = () => {
      history.undo();
      timeline.render();
    };
    document.querySelector("#redo").onclick = () => {
      history.redo();
      timeline.render();
    };
    globalThis.fixture = {
      read: () => ({
        document: history.read(),
        audio: editor.evaluateFrame(history.read(), "main", 600000).audio,
        selected: [...selection],
        time,
        applied: structuredClone(applied),
        drops: structuredClone(drops),
        errors: [...errors],
      }),
      externalChange: () => {
        history.apply([{ type: "project.rename", name: "外部更新" }], history.revision);
      },
      replaceGeneration: (render = true) => {
        generation++;
        if (render) timeline.render();
      },
      restoreSameIdentity: () => {
        history = new editor.EditorHistory(history.read());
        generation++;
        timeline.render();
      },
      render: () => timeline.render(),
      gestureState: () => {
        const pending = timeline.pendingTrackGesture, drag = timeline.drag,
          pointerId = pending?.intent.pointer.pointerId ?? drag?.pointerId;
        return { pending: !!pending, drag: !!drag, pointerId, destroyed: timeline.destroyed,
          capture: pointerId !== undefined && timeline.container.hasPointerCapture(pointerId) };
      },
      externalTrackEdit: (trackId, patch) => {
        history.apply([{ type: "track.update", sequenceId: activeSequenceId, trackId, patch }], history.revision);
        timeline.render();
      },
      reorderTracks: () => {
        history.apply([{ type: "track.reorder", sequenceId: activeSequenceId,
          trackIds: [...history.read().sequences[0].tracks].reverse().map((track) => track.id) }], history.revision);
        timeline.render();
      },
      replaceDocument: () => {
        const next = history.read();
        next.id = "another-document";
        history = new editor.EditorHistory(next);
        documentId = next.id;
        selection = [];
        timeline.render();
      },
      setSequence: (sequenceId) => {
        history.apply([{ type: "sequence.activate", sequenceId }], history.revision);
        activeSequenceId = sequenceId;
        selection = [];
        timeline.render();
      },
      holdNextEdit: () => {
        deferNext = true;
      },
      finishEdit: (failed = false) => pendingEdit?.(failed),
      takePendingEdit: () => pendingEdit,
      switchSequence: (id = "secondary") => { activeSequenceId = id; selection = []; timeline.render(); },
      dispose: () => timeline.dispose(),
      seek: (value) => {
        time = value;
        timeline.updatePlayhead();
      },
    };
  }, options);
  return page;
}
async function state(page) {
  return page.evaluate(() => fixture.read());
}
async function captureOwnedPreviews(page) {
  await page.evaluate(() => {
    globalThis.ownedPreviews = [];
    globalThis.ownedPlanCalls = 0;
    const plan = editor.EditorTimeline.prototype.planDrag;
    editor.EditorTimeline.prototype.planDrag = function (...args) {
      ownedPlanCalls++;
      try { return plan.apply(this, args); }
      finally {
        const drag = args[2], preview = drag.movePreview ?? drag.trimPreview;
        if (preview && !ownedPreviews.includes(preview)) ownedPreviews.push(preview);
      }
    };
  });
}

test("free gestures lazily own one preview across stationary Alt and release, then commit through history once", async (t) => {
  const page = await fixture(t), before = (await state(page)).document;
  await captureOwnedPreviews(page);
  await clip(page, "a").click();
  assert.equal(await page.evaluate(() => ownedPreviews.length), 0, "A click does not prepare a graph");
  const point = await center(clip(page, "a"));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 32, point.y);
  await settle(page);
  await page.mouse.move(point.x + 80, point.y);
  await settle(page);
  await page.keyboard.down("Alt");
  await page.keyboard.up("Alt");
  await settle(page);
  const plans = await page.evaluate(() => ownedPlanCalls);
  assert.equal(await page.evaluate(() => ownedPreviews.length), 1);
  await page.mouse.up();
  await settle(page);
  assert.equal(await page.evaluate(() => ownedPlanCalls), plans, "Same-key release reuses its fully checked plan");
  assert.equal((await state(page)).applied.length, 1);
  assert.equal(await page.evaluate(() => {
    try { ownedPreviews[0].read(); return false; } catch (error) { return /预览已结束/.test(error.message); }
  }), true);
  assert.deepEqual((await state(page)).errors, []);
  await undo(page, before);
});

test("restoring a same-id and revision history discards focused track drafts without applying them", async (t) => {
  for (const [label, draft, saved] of [
    ["轨道名称 v1", "旧轨道草稿", "v1"],
    ["v1 音量百分比", "37.5", "100"],
    ["v1 声像", "-80", "0"],
  ]) {
    const page = await fixture(t), before = (await state(page)).document;
    const input = page.getByLabel(label, { exact: true });
    await input.fill(draft);
    const stale = await input.elementHandle();
    await page.evaluate(() => fixture.restoreSameIdentity());
    await settle(page);
    assert.deepEqual((await state(page)).document, before);
    assert.equal((await state(page)).applied.length, 0);
    assert.equal(await input.inputValue(), saved);
    await stale.evaluate((node) => node.dispatchEvent(new Event("change", { bubbles: true })));
    assert.deepEqual((await state(page)).document, before);
    assert.deepEqual((await state(page)).errors, []);
  }
});

test("track drafts cannot cross sequences with shared track ids or a generation change before rendering", async (t) => {
  const page = await fixture(t, { secondSequence: true }), before = (await state(page)).document;
  await page.getByLabel("轨道名称 v1", { exact: true }).fill("旧序列名称");
  await page.evaluate(() => fixture.switchSequence());
  await settle(page);
  assert.deepEqual((await state(page)).document, before);
  assert.equal((await state(page)).applied.length, 0);
  assert.equal(await page.getByLabel("轨道名称 v1", { exact: true }).inputValue(), "v1");
  await page.getByLabel("v1 音量百分比", { exact: true }).fill("50");
  await page.evaluate(() => fixture.replaceGeneration(false));
  await page.getByLabel("v1 音量百分比", { exact: true }).dispatchEvent("change");
  assert.deepEqual((await state(page)).document, before);
  assert.equal((await state(page)).applied.length, 0);
});

test("a removed track input cannot submit again even if reattached after an ordinary render", async (t) => {
  const page = await fixture(t), before = (await state(page)).document,
    stale = await page.getByLabel("轨道名称 v1", { exact: true }).elementHandle();
  await page.evaluate(() => fixture.render());
  await stale.evaluate((node) => {
    node.value = "已移除控件的草稿";
    document.querySelector("#timeline").append(node);
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.deepEqual((await state(page)).document, before);
  assert.equal((await state(page)).applied.length, 0);
  assert.deepEqual((await state(page)).errors, []);
});

test("ordinary revision refresh retains the focused track input and commits its draft exactly once", async (t) => {
  const page = await fixture(t), input = page.getByLabel("v1 音量百分比", { exact: true });
  await input.fill("37.5");
  const focused = await input.elementHandle();
  await page.evaluate(() => { fixture.externalChange(); fixture.render(); });
  await settle(page);
  assert.equal(await focused.evaluate((node) => node === document.activeElement), true);
  assert.equal(await input.inputValue(), "37.5");
  assert.equal((await state(page)).applied.length, 0);
  await input.press("Tab");
  await settle(page);
  const after = await state(page);
  assert.equal(after.document.name, "外部更新");
  assert.equal(after.document.sequences[0].tracks.find((track) => track.id === "v1").volume, 0.375);
  assert.equal(after.applied.length, 1);
  assert.equal(after.applied[0].label, "调整轨道音量");
});

test("a real native IME composition stays connected through ordinary timeline refreshes", async (t) => {
  const page = await fixture(t), input = page.getByLabel("轨道名称 v1", { exact: true });
  await input.fill("");
  const focused = await input.elementHandle();
  await input.evaluate((node) => {
    globalThis.compositionEvents = [];
    for (const type of ["compositionstart", "compositionupdate", "compositionend"])
      node.addEventListener(type, (event) => compositionEvents.push({ type, trusted: event.isTrusted }));
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "临时", selectionStart: 2, selectionEnd: 2 });
  await page.evaluate(() => { fixture.externalChange(); fixture.render(); });
  await settle(page);
  assert.equal(await focused.evaluate((node) => node === document.activeElement), true);
  assert.equal(await input.inputValue(), "临时");
  assert.equal((await state(page)).applied.length, 0);
  let events = await page.evaluate(() => compositionEvents);
  assert.equal(events[0].type, "compositionstart");
  assert.ok(events.every((event) => event.trusted));
  assert.equal(events.filter((event) => event.type === "compositionend").length, 0);
  await cdp.send("Input.imeSetComposition", { text: "完整轨道", selectionStart: 4, selectionEnd: 4 });
  await cdp.send("Input.insertText", { text: "完整轨道" });
  await input.press("Tab");
  await settle(page);
  events = await page.evaluate(() => compositionEvents);
  assert.equal(events.filter((event) => event.type === "compositionend").length, 1);
  const after = await state(page);
  assert.equal(after.document.sequences[0].tracks.find((track) => track.id === "v1").name, "完整轨道");
  assert.equal(after.applied.length, 1);
  assert.equal(after.document.name, "外部更新");
});

test("locking a track during a volume draft disables it without committing a native blur", async (t) => {
  const page = await fixture(t), input = page.getByLabel("v1 音量百分比", { exact: true });
  await input.fill("37.5");
  const before = (await state(page)).document;
  await page.evaluate(() => fixture.externalTrackEdit("v1", { locked: true }));
  await settle(page);
  const after = await state(page);
  assert.equal(await input.isDisabled(), true);
  assert.equal(await input.inputValue(), "100");
  assert.equal(after.document.revision, before.revision + 1);
  assert.equal(after.document.sequences[0].tracks.find((track) => track.id === "v1").volume, 1);
  assert.equal(after.applied.length, 0);
  assert.deepEqual(after.errors, []);
  assert.match(await page.locator(".et-notice").innerText(), /轨道已锁定.*输入已取消/);
});

test("a track reorder cancels its unfinished draft rather than committing while rebuilding", async (t) => {
  const page = await fixture(t), input = page.getByLabel("轨道名称 v1", { exact: true });
  await input.fill("尚未保存");
  const before = (await state(page)).document;
  await page.evaluate(() => fixture.reorderTracks());
  await settle(page);
  const after = await state(page);
  assert.equal(after.document.revision, before.revision + 1);
  assert.equal(after.document.sequences[0].tracks.find((track) => track.id === "v1").name, "v1");
  assert.equal(after.applied.length, 0);
  assert.deepEqual(after.errors, []);
  assert.match(await page.locator(".et-notice").innerText(), /轨道结构已变化.*输入已取消/);
});

for (const operation of ["muted", "hidden", "locked", "delete"]) {
  test(`a first track ${operation} click saves a valid volume draft and still performs the intended action`, async (t) => {
    const page = await fixture(t);
    await page.getByLabel("v1 音量百分比", { exact: true }).fill("37.5");
    await page.locator(operation === "delete"
      ? '[data-et-delete-track="v1"]'
      : `[data-et-track="v1"][data-et-toggle="${operation}"]`).click();
    await settle(page);
    const result = await state(page), track = result.document.sequences[0].tracks.find((item) => item.id === "v1");
    assert.equal(track.volume, 0.375, "the valid draft is kept before the button action");
    if (operation === "delete") assert.equal(await page.locator('[data-et-delete-confirm="v1"]').count(), 1);
    else assert.equal(track[operation], true);
    assert.deepEqual(result.errors, []);
  });
}

test("a track name draft and its lock action remain two separately undoable edits", async (t) => {
  const page = await fixture(t), before = (await state(page)).document;
  await page.getByLabel("轨道名称 v1", { exact: true }).fill("已编辑轨道名");
  await page.getByLabel("锁定v1", { exact: true }).click();
  await settle(page);
  let result = await state(page), track = result.document.sequences[0].tracks.find((item) => item.id === "v1");
  assert.equal(track.name, "已编辑轨道名");
  assert.equal(track.locked, true);
  assert.deepEqual(result.applied.map((item) => item.label), ["重命名轨道", "调整轨道"]);
  await page.locator("#undo").click(); await settle(page);
  track = (await state(page)).document.sequences[0].tracks.find((item) => item.id === "v1");
  assert.equal(track.name, "已编辑轨道名"); assert.equal(track.locked, false);
  await undo(page, before);
});

test("confirming or cancelling track deletion first saves a valid name draft without losing its intent", async (t) => {
  for (const confirmed of [true, false]) {
    const page = await fixture(t);
    await page.getByLabel("删除轨道v1", { exact: true }).click();
    assert.equal(await page.locator('[data-et-delete-confirm="v1"]').evaluate((node) => node === document.activeElement), true);
    await page.getByLabel("轨道名称 v1", { exact: true }).fill("删除前的名称");
    await page.locator(confirmed ? '[data-et-delete-confirm="v1"]' : '[data-track-head="v1"] [data-et-delete-cancel]').click();
    await settle(page);
    const result = await state(page), track = result.document.sequences[0].tracks.find((item) => item.id === "v1");
    assert.deepEqual(result.errors, []);
    if (confirmed) {
      assert.equal(track, undefined);
      assert.deepEqual(result.applied.map((item) => item.label), ["重命名轨道", "删除轨道"]);
      await page.locator("#undo").click(); await settle(page);
      assert.equal((await state(page)).document.sequences[0].tracks.find((item) => item.id === "v1").name, "删除前的名称");
    } else {
      assert.equal(track.name, "删除前的名称");
      assert.equal(await page.locator('[data-et-delete-confirm="v1"]').count(), 0);
      assert.deepEqual(result.applied.map((item) => item.label), ["重命名轨道"]);
    }
  }
});

test("a failed asynchronous track draft blocks the toggle and keeps the draft available for correction", async (t) => {
  const page = await fixture(t), before = (await state(page)).document;
  await page.evaluate(() => fixture.holdNextEdit());
  await page.getByLabel("v1 音量百分比", { exact: true }).fill("37.5");
  await page.getByLabel("静音v1", { exact: true }).click();
  await page.evaluate(() => fixture.finishEdit(true));
  await settle(page);
  assert.deepEqual((await state(page)).document, before);
  assert.equal(await page.getByLabel("v1 音量百分比", { exact: true }).inputValue(), "37.5");
  assert.equal(await page.getByLabel("v1 音量百分比", { exact: true }).evaluate((node) => node === document.activeElement), true);
  assert.match((await state(page)).errors[0], /保存失败/);
  await page.getByLabel("v1 音量百分比", { exact: true }).fill("50");
  await page.getByLabel("静音v1", { exact: true }).click(); await settle(page);
  const result = await state(page), track = result.document.sequences[0].tracks.find((item) => item.id === "v1");
  assert.equal(track.volume, 0.5); assert.equal(track.muted, true);
  assert.equal(result.applied.length, 2);
});

test("pending track controls reject double clicks and cannot finish an old intent in a successor scope", async (t) => {
  for (const change of ["none", "generation", "sequence"]) {
    const page = await fixture(t, { secondSequence: true });
    await page.evaluate(() => fixture.holdNextEdit());
    await page.getByLabel("v1 音量百分比", { exact: true }).fill("37.5");
    const button = page.getByLabel("静音v1", { exact: true }), box = await button.boundingBox();
    await button.click();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    if (change === "generation") await page.evaluate(() => fixture.restoreSameIdentity());
    if (change === "sequence") await page.evaluate(() => fixture.switchSequence());
    await page.evaluate(() => fixture.finishEdit()); await settle(page);
    const result = await state(page);
    assert.deepEqual(result.errors, []);
    if (change === "none") {
      assert.equal(result.applied.length, 2);
      assert.equal(result.document.sequences[0].tracks.find((item) => item.id === "v1").muted, true);
    } else {
      assert.equal(result.applied.length, 1, "only the initial draft belongs to the old history");
      assert.equal(result.document.sequences.find((item) => item.id === (change === "sequence" ? "secondary" : "main")).tracks.find((item) => item.id === "v1").muted, false);
    }
  }
});

test("invalid volume input blocks the track button without discarding the correctable draft", async (t) => {
  const page = await fixture(t), before = (await state(page)).document;
  await page.getByLabel("v1 音量百分比", { exact: true }).fill("401");
  await page.getByLabel("静音v1", { exact: true }).click(); await settle(page);
  assert.deepEqual((await state(page)).document, before);
  assert.equal(await page.getByLabel("v1 音量百分比", { exact: true }).inputValue(), "401");
  assert.match((await state(page)).errors[0], /400/);
});

test("track buttons finish native IME once before saving the name and retain reorder intent", async (t) => {
  const page = await fixture(t), input = page.getByLabel("轨道名称 v1", { exact: true });
  await input.fill("");
  await input.evaluate((node) => {
    globalThis.nativeEnds = [];
    globalThis.nativeStarts = [];
    node.addEventListener("compositionstart", (event) => nativeStarts.push(event.isTrusted));
    node.addEventListener("compositionend", (event) => nativeEnds.push(event.isTrusted));
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "正式轨道", selectionStart: 4, selectionEnd: 4 });
  await page.locator('[data-et-up="v1"]').click(); await settle(page);
  const result = await state(page);
  assert.equal(result.document.sequences[0].tracks.find((item) => item.id === "v1").name, "正式轨道");
  assert.deepEqual(result.document.sequences[0].tracks.map((item) => item.id), ["v2", "v1", "v3", "audio", "text"]);
  assert.deepEqual(result.applied.map((item) => item.label), ["重命名轨道", "轨道排序"]);
  assert.deepEqual(await page.evaluate(() => nativeStarts), [true]);
  assert.equal(await page.evaluate(() => nativeEnds.length), 1);
  assert.deepEqual(result.errors, []);
});

test("a newly locked track stops the button's second step after an awaited draft", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => fixture.holdNextEdit());
  await page.getByLabel("v1 音量百分比", { exact: true }).fill("37.5");
  await page.getByLabel("静音v1", { exact: true }).click();
  await page.evaluate(() => { fixture.finishEdit(); fixture.externalTrackEdit("v1", { locked: true }); });
  await settle(page);
  const result = await state(page), track = result.document.sequences[0].tracks.find((item) => item.id === "v1");
  assert.equal(track.volume, 0.375); assert.equal(track.muted, false); assert.equal(track.locked, true);
  assert.equal(result.applied.length, 1);
  assert.match(result.errors[0], /轨道已锁定/);
});

for (const released of [false, true]) {
  test(`an asynchronous track draft replays the latest pointer ${released ? "release" : "move"} without leaving an old gesture`, async (t) => {
    const page = await fixture(t), before = (await state(page)).document,
      point = await center(clip(page, "a")), cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => fixture.holdNextEdit());
    await page.getByLabel("v1 音量百分比", { exact: true }).fill("37.5");
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 32, y: point.y, button: "left", buttons: 1 });
    assert.equal((await page.evaluate(() => fixture.gestureState())).pending, true);
    if (released) await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 64, y: point.y, button: "left", buttons: 0, clickCount: 1 });
    await page.evaluate(() => fixture.finishEdit()); await settle(page);
    if (!released) {
      assert.equal((await page.evaluate(() => fixture.gestureState())).drag, true);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 64, y: point.y, button: "left", buttons: 0, clickCount: 1 });
      await settle(page);
    }
    const result = await state(page), gesture = await page.evaluate(() => fixture.gestureState());
    assert.equal(result.document.sequences[0].clips.find((item) => item.id === "a").start, 480000);
    assert.equal(result.document.sequences[0].tracks.find((item) => item.id === "v1").volume, 0.375);
    assert.deepEqual(result.applied.map((item) => item.label), ["调整轨道音量", "移动片段"]);
    assert.deepEqual([gesture.pending, gesture.drag, gesture.capture], [false, false, false]);
    assert.deepEqual(result.errors, []);
    await page.locator("#undo").click(); await settle(page);
    assert.equal((await state(page)).document.sequences[0].clips.find((item) => item.id === "a").start, 240000);
    await undo(page, before);
  });
}

for (const ending of ["escape", "blur", "lostcapture", "generation", "document", "sequence", "dispose"]) {
  test(`an asynchronous track draft cannot start a gesture after ${ending}`, async (t) => {
    const page = await fixture(t, { secondSequence: true }), point = await center(clip(page, "a"));
    await page.evaluate(() => fixture.holdNextEdit());
    await page.getByLabel("v1 音量百分比", { exact: true }).fill("37.5");
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 64, point.y);
    const pending = await page.evaluate(() => fixture.gestureState());
    assert.equal(pending.pending, true);
    if (ending === "escape") await page.keyboard.press("Escape");
    if (ending === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (ending === "lostcapture") {
      await page.evaluate((pointerId) => document.querySelector("#timeline").releasePointerCapture(pointerId), pending.pointerId);
      await page.mouse.move(point.x + 65, point.y);
    }
    if (ending === "generation") await page.evaluate(() => fixture.restoreSameIdentity());
    if (ending === "document") await page.evaluate(() => fixture.replaceDocument());
    if (ending === "sequence") await page.evaluate(() => fixture.switchSequence());
    if (ending === "dispose") await page.evaluate(() => fixture.dispose());
    await page.mouse.up();
    await page.evaluate(() => fixture.finishEdit()); await settle(page);
    const result = await state(page), after = await page.evaluate(() => fixture.gestureState());
    assert.deepEqual([after.pending, after.drag, after.capture], [false, false, false]);
    assert.equal(result.applied.length, 1, "only the already-submitted track draft may finish in its captured history");
    assert.equal(result.document.sequences[0].clips.find((item) => item.id === "a").start, 240000);
    assert.deepEqual(result.errors, []);
  });
}

test("native touch cancellation ends a pending track draft gesture before its asynchronous completion", async (t) => {
  const page = await fixture(t, { touch: true }), point = { ...await center(clip(page, "a")), id: 1 },
    input = await touchInput(page, "#timeline");
  await page.evaluate(() => fixture.holdNextEdit());
  await page.getByLabel("v1 音量百分比", { exact: true }).fill("37.5");
  await input.send("touchStart", [point]);
  await input.send("touchMove", [{ ...point, x: point.x + 64 }]);
  assert.equal((await page.evaluate(() => fixture.gestureState())).pending, true);
  await input.send("touchCancel");
  await page.evaluate(() => fixture.finishEdit()); await settle(page);
  const result = await state(page), after = await page.evaluate(() => fixture.gestureState());
  assert.deepEqual([after.pending, after.drag, after.capture], [false, false, false]);
  assert.equal(result.applied.length, 1);
  assert.equal(result.document.sequences[0].clips.find((item) => item.id === "a").start, 240000);
  assert.ok(await page.evaluate(() => touchTrace.some((event) => event.type === "pointercancel" && event.trusted)));
  assert.deepEqual(result.errors, []);
});

for (const failed of [false, true]) {
  test(`${failed ? "failed asynchronous" : "invalid"} track draft blocks and retains a correctable gesture input`, async (t) => {
    const page = await fixture(t), before = (await state(page)).document;
    if (failed) await page.evaluate(() => fixture.holdNextEdit());
    await page.getByLabel("v1 音量百分比", { exact: true }).fill(failed ? "37.5" : "401");
    await clip(page, "a").click();
    if (failed) await page.evaluate(() => fixture.finishEdit(true));
    await settle(page);
    const result = await state(page), after = await page.evaluate(() => fixture.gestureState());
    assert.deepEqual(result.document, before);
    assert.deepEqual(result.selected, []);
    assert.equal(await page.getByLabel("v1 音量百分比", { exact: true }).inputValue(), failed ? "37.5" : "401");
    assert.equal(await page.getByLabel("v1 音量百分比", { exact: true }).evaluate((node) => node === document.activeElement), true);
    assert.match(result.errors[0], failed ? /保存失败/ : /400/);
    assert.deepEqual([after.pending, after.drag, after.capture], [false, false, false]);
    await page.getByLabel("v1 音量百分比", { exact: true }).fill("50");
    await clip(page, "a").click(); await settle(page);
    assert.equal((await state(page)).document.sequences[0].tracks.find((item) => item.id === "v1").volume, 0.5);
    assert.deepEqual((await state(page)).selected, ["a"]);
  });
}

test("an old cancelled draft cannot release a newer pending gesture's capture on the same pointer", async (t) => {
  const page = await fixture(t), point = await center(clip(page, "a"));
  await page.evaluate(() => fixture.holdNextEdit());
  await page.getByLabel("v1 音量百分比", { exact: true }).fill("37.5");
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 32, point.y);
  await page.evaluate(() => { globalThis.firstEdit = fixture.takePendingEdit(); });
  await page.keyboard.press("Escape"); await page.mouse.up();
  await page.evaluate(() => fixture.holdNextEdit());
  await page.getByLabel("轨道名称 v1", { exact: true }).fill("第二次草稿");
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 64, point.y);
  await page.evaluate(() => { globalThis.secondEdit = fixture.takePendingEdit(); firstEdit(); });
  await settle(page);
  await page.mouse.move(point.x + 65, point.y);
  const active = await page.evaluate(() => fixture.gestureState());
  assert.deepEqual([active.pending, active.capture], [true, true]);
  await page.keyboard.press("Escape"); await page.mouse.up();
  await page.evaluate(() => secondEdit(true)); await settle(page);
  const result = await state(page), final = await page.evaluate(() => fixture.gestureState());
  assert.equal(result.applied.length, 1);
  assert.deepEqual(result.errors, [], "a late cancelled failure cannot overwrite the new interaction");
  assert.deepEqual([final.pending, final.drag, final.capture], [false, false, false]);
});

test("pending track drafts retain stationary Alt and freeze zoom until their pointer intent completes", async (t) => {
  for (const alt of [false, true]) {
    const page = await fixture(t, { ntsc: true, clips: [
      { id: "a", trackId: "v1", start: 1, duration: 2 },
      { id: "c", trackId: "v1", start: 6, duration: 2 },
    ] }), point = await center(clip(page, "a"));
    await page.evaluate(() => fixture.holdNextEdit());
    await page.getByLabel("v1 音量百分比", { exact: true }).fill("37.5");
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 64 * 2.94, point.y);
    const zoom = await page.locator("[data-et-zoom]").inputValue();
    assert.equal(await page.locator("[data-et-zoom]").isDisabled(), true);
    for (const action of ["fit", "zoom-in", "zoom-out"])
      assert.equal(await page.locator(`[data-et-action="${action}"]`).isDisabled(), true);
    await page.keyboard.down("Control"); await page.mouse.wheel(0, 200); await page.keyboard.up("Control");
    assert.equal(await page.locator("[data-et-zoom]").inputValue(), zoom);
    if (alt) await page.keyboard.down("Alt");
    else { await page.keyboard.down("Alt"); await page.keyboard.up("Alt"); }
    await page.evaluate(() => fixture.finishEdit()); await settle(page);
    await page.mouse.up(); if (alt) await page.keyboard.up("Alt"); await settle(page);
    const result = await state(page), expected = alt ? await page.evaluate(() => editor.frameToTicks(
      editor.ticksToFrame(Math.round(3.94 * 240000), { numerator: 30000, denominator: 1001 }),
      { numerator: 30000, denominator: 1001 },
    )) : 4 * 240000;
    assert.equal(result.document.sequences[0].clips.find((item) => item.id === "a").start, expected);
    assert.equal(await page.locator("[data-et-snap]").isChecked(), true);
    assert.equal(await page.locator("[data-et-zoom]").isDisabled(), false);
    assert.deepEqual(result.errors, []);
  }
});

test("a second physical click cannot overwrite a released gesture while its track draft is pending", async (t) => {
  const page = await fixture(t), point = await center(clip(page, "a"));
  await page.evaluate(() => fixture.holdNextEdit());
  await page.getByLabel("v1 音量百分比", { exact: true }).fill("37.5");
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 64, point.y); await page.mouse.up();
  await page.mouse.click(point.x + 128, point.y);
  await page.evaluate(() => fixture.finishEdit()); await settle(page);
  const result = await state(page), after = await page.evaluate(() => fixture.gestureState());
  assert.equal(result.document.sequences[0].clips.find((item) => item.id === "a").start, 480000);
  assert.equal(result.applied.length, 2);
  assert.deepEqual([after.pending, after.drag, after.capture], [false, false, false]);
  assert.deepEqual(result.errors, []);
});

test("owned move and trim capabilities release on every interruption and old generation releases cannot commit", async (t) => {
  for (const kind of ["move", "trim"]) for (const ending of ["escape", "blur", "generation", "sequence", "dispose"]) {
    const page = await fixture(t, { secondSequence: ending === "sequence" }), before = (await state(page)).document;
    await captureOwnedPreviews(page);
    const point = await center(kind === "move" ? clip(page, "a") : clip(page, "a").locator('[data-et-edge="right"]'));
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + (kind === "move" ? 32 : -32), point.y);
    await settle(page);
    assert.equal(await page.evaluate(() => ownedPreviews.length), 1);
    if (ending === "escape") await page.keyboard.press("Escape");
    if (ending === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (ending === "generation") await page.evaluate(() => fixture.replaceGeneration());
    if (ending === "sequence") await page.evaluate(() => fixture.switchSequence());
    if (ending === "dispose") await page.evaluate(() => fixture.dispose());
    assert.equal(await page.evaluate((kind) => {
      try {
        if (kind === "move") ownedPreviews[0].read();
        else ownedPreviews[0].plan(0, 240000);
        return false;
      } catch (error) { return /预览已结束/.test(error.message); }
    }, kind), true, `${kind}/${ending} must release its capability immediately`);
    await page.mouse.up();
    await settle(page);
    assert.equal((await state(page)).applied.length, 0);
    assert.deepEqual((await state(page)).document, before);
  }
});

test("contexts without a session identity retain the public per-candidate move and trim path", async (t) => {
  for (const kind of ["move", "trim"]) {
    const page = await fixture(t, { noIdentity: true }), before = (await state(page)).document;
    await captureOwnedPreviews(page);
    const point = await center(kind === "move" ? clip(page, "a") : clip(page, "a").locator('[data-et-edge="right"]'));
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + (kind === "move" ? 32 : -32), point.y); await settle(page);
    await page.mouse.up(); await settle(page);
    assert.equal(await page.evaluate(() => ownedPreviews.length), 0);
    assert.equal((await state(page)).applied.length, 1);
    assert.deepEqual((await state(page)).errors, []);
    await undo(page, before);
  }
});
test("two native touches retain the first timeline owner, commit once and undo together", async (t) => {
  const page = await fixture(t, { touch: true }),
    before = (await state(page)).document,
    input = await touchInput(page, "#timeline"),
    first = { ...await center(clip(page, "a")), id: 1 },
    second = { ...await center(clip(page, "b")), id: 2 };
  await input.send("touchStart", [first]);
  await input.send("touchStart", [first, second]);
  const [, secondaryId] = await input.ids();
  assert.deepEqual((await state(page)).selected, ["a"], "second touch cannot change selection");
  // Probe only the non-owner cancellation, then release its actual Chromium pointer capture.
  await page.evaluate((pointerId) => {
    const timeline = document.querySelector("#timeline");
    timeline.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId, pointerType: "touch" }));
    timeline.setPointerCapture(pointerId);
  }, secondaryId);
  await input.send("touchMove", [{ ...first, x: first.x + 64 }, { ...second, x: second.x + 30 }]);
  await page.evaluate((pointerId) => document.querySelector("#timeline").releasePointerCapture(pointerId), secondaryId);
  await input.send("touchMove", [{ ...first, x: first.x + 64 }, { ...second, x: second.x + 32 }]);
  assert.ok(await page.evaluate((pointerId) => touchTrace.some((event) => event.type === "lostpointercapture" && event.pointerId === pointerId && event.trusted), secondaryId));
  await input.send("touchEnd", [{ ...second, x: second.x + 32 }]);
  assert.ok(await page.evaluate((pointerId) => touchTrace.some((event) => event.type === "pointerup" && event.pointerId === pointerId && event.trusted), secondaryId));
  assert.equal((await state(page)).applied.length, 0, "releasing a secondary touch cannot commit");
  await input.send("touchEnd");
  await settle(page);
  const after = await state(page);
  assert.equal(after.applied.length, 1);
  assert.equal(after.document.sequences[0].clips.find((value) => value.id === "a").start, 480000);
  assert.deepEqual(after.document.sequences[0].clips.find((value) => value.id === "b"), before.sequences[0].clips.find((value) => value.id === "b"));
  await input.assertNative();
  await input.capture("timeline-owner", after);
  await undo(page, before);
});

test("native touch cancellation rolls back the timeline owner and late releases do not write", async (t) => {
  const page = await fixture(t, { touch: true }),
    before = (await state(page)).document,
    input = await touchInput(page, "#timeline"),
    first = { ...await center(clip(page, "a")), id: 1 },
    second = { ...await center(clip(page, "b")), id: 2 };
  await input.send("touchStart", [first]);
  await input.send("touchStart", [first, second]);
  const [ownerId] = await input.ids();
  await input.send("touchMove", [{ ...first, x: first.x + 64 }, second]);
  await input.send("touchCancel");
  await page.evaluate((pointerId) => document.querySelector("#timeline").dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, pointerId, pointerType: "touch" }),
  ), ownerId);
  await settle(page);
  assert.deepEqual((await state(page)).document, before);
  assert.equal((await state(page)).applied.length, 0);
  assert.ok(await page.evaluate(() => touchTrace.some((event) => event.type === "pointercancel" && event.trusted)));
  assert.equal(await clip(page, "a").evaluate((element) => element.style.transform), "");
  await input.capture("timeline-owner-cancel", await state(page));
});

test("a timeline open-generation switch fences both old native touch releases", async (t) => {
  const page = await fixture(t, { touch: true }),
    input = await touchInput(page, "#timeline"),
    first = { ...await center(clip(page, "a")), id: 1 },
    second = { ...await center(clip(page, "b")), id: 2 };
  await input.send("touchStart", [first]);
  await input.send("touchStart", [first, second]);
  await input.send("touchMove", [{ ...first, x: first.x + 64 }, { ...second, x: second.x + 64 }]);
  await page.evaluate(() => fixture.replaceGeneration());
  const switched = (await state(page)).document;
  await input.send("touchEnd", [first]);
  await input.send("touchEnd");
  await settle(page);
  assert.deepEqual((await state(page)).document, switched);
  assert.equal((await state(page)).applied.length, 0);
  await input.capture("timeline-generation-switch", await state(page));
});
async function settle(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

for (const { key, modifiers = [], grouped = false, pasted = false } of [
  { key: "s" },
  { key: "Delete" },
  { key: "Backspace" },
  { key: "x", modifiers: ["Control"] },
  { key: "d", modifiers: ["Meta"] },
  { key: "g", modifiers: ["Control"], grouped: true },
  { key: "g", modifiers: ["Meta", "Shift"], grouped: true },
  { key: "v", modifiers: ["Control"], pasted: true },
]) {
  test(`holding ${modifiers.join("+")}${key} runs one edit and a fresh press remains available`, async (t) => {
    const page = await fixture(t);
    await clip(page, "a").click();
    if (grouped) {
      await page.keyboard.down("Control");
      await clip(page, "b").click();
      await page.keyboard.up("Control");
      if (modifiers.includes("Shift")) await page.keyboard.press("Control+g");
    }
    if (pasted) await page.keyboard.press("Control+c");
    await page.evaluate((pasted) => {
      fixture.seek(pasted ? 2400000 : 480000);
      globalThis.heldEvents = [];
      window.addEventListener(
        "keydown",
        (event) => heldEvents.push({ key: event.key, repeat: event.repeat }),
        true,
      );
    }, pasted);
    const before = await state(page);
    for (const modifier of modifiers) await page.keyboard.down(modifier);
    await page.keyboard.down(key);
    await settle(page);
    const first = await state(page);
    for (let index = 0; index < 3; index++) {
      await page.keyboard.down(key);
      await settle(page);
    }
    await page.keyboard.up(key);
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
    const held = await state(page);
    assert.deepEqual(held.document, first.document, "OS repeat must not add another edit");
    assert.deepEqual(held.applied, first.applied);
    assert.deepEqual(held.errors, []);
    assert.equal(first.applied.length, before.applied.length + 1);
    assert.deepEqual(
      await page.evaluate(
        (key) => heldEvents.filter((event) => event.key === key).map((event) => event.repeat),
        key,
      ),
      [false, true, true, true],
    );
    if (!modifiers.includes("Shift")) {
      if (["Delete", "Backspace", "x"].includes(key)) await clip(page, "b").click();
      if (key === "s") await page.evaluate(() => fixture.seek(600000));
      if (pasted) await page.evaluate(() => fixture.seek(3360000));
      for (const modifier of modifiers) await page.keyboard.down(modifier);
      await page.keyboard.press(key);
      for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
      await settle(page);
      const fresh = await state(page);
      assert.equal(fresh.applied.length, first.applied.length + 1);
      assert.deepEqual(fresh.errors, []);
    }
  });
}

test("holding copy preserves the original clipboard when selection changes before key release", async (t) => {
  const page = await fixture(t);
  await clip(page, "a").click();
  await page.keyboard.down("Control");
  await page.keyboard.down("c");
  await clip(page, "a").click();
  await clip(page, "b").click();
  assert.deepEqual((await state(page)).selected, ["b"]);
  await page.keyboard.down("c");
  await page.keyboard.down("c");
  await page.keyboard.up("c");
  await page.keyboard.up("Control");
  await page.evaluate(() => fixture.seek(2400000));
  await page.keyboard.press("Control+v");
  await settle(page);
  const result = await state(page),
    pasted = result.document.sequences[0].clips.find((item) => result.selected.includes(item.id));
  assert.equal(pasted.label, "a");
  assert.equal(result.applied.length, 1);
  assert.deepEqual(result.errors, []);
});

test("held arrows still seek and move every frame while editable track input retains native repeats", async (t) => {
  const page = await fixture(t);
  await clip(page, "a").click();
  for (let index = 0; index < 4; index++) await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  assert.equal((await state(page)).time, 32000);
  assert.equal((await state(page)).applied.length, 0);
  await page.keyboard.down("Control");
  for (let index = 0; index < 4; index++) {
    await page.keyboard.down("ArrowRight");
    await settle(page);
  }
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("Control");
  const moved = await state(page);
  assert.equal(moved.document.sequences[0].clips.find((item) => item.id === "a").start, 272000);
  assert.equal(moved.applied.length, 4);
  assert.deepEqual(moved.errors, []);
  const input = page.locator('[data-et-track-name="v1"]');
  await input.fill("abcde");
  await page.keyboard.press("End");
  for (let index = 0; index < 4; index++) await page.keyboard.down("Backspace");
  await page.keyboard.up("Backspace");
  assert.equal(await input.inputValue(), "a");
  assert.equal((await state(page)).applied.length, 4);
});

test("a held cut stays one command before and after its asynchronous save finishes", async (t) => {
  const page = await fixture(t);
  await clip(page, "a").click();
  await page.evaluate(() => fixture.holdNextEdit());
  await page.keyboard.down("Control");
  await page.keyboard.down("x");
  await page.keyboard.down("x");
  await page.keyboard.down("x");
  assert.equal((await state(page)).applied.length, 0);
  await page.evaluate(() => fixture.finishEdit());
  await settle(page);
  await page.keyboard.down("x");
  await page.keyboard.down("x");
  await page.keyboard.up("x");
  await page.keyboard.up("Control");
  const result = await state(page);
  assert.equal(result.applied.length, 1);
  assert.deepEqual(result.errors, []);
  await page.evaluate(() => fixture.seek(2400000));
  await page.keyboard.press("Control+v");
  await settle(page);
  assert.equal((await state(page)).applied.length, 2);
  assert.deepEqual((await state(page)).errors, []);
});
const clip = (page, id) => page.locator(`[data-et-clip="${id}"]`);
async function center(locator) {
  const bounds = await locator.boundingBox();
  assert.ok(bounds);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}
async function clickClip(page, id, modifier) {
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(...Object.values(await center(clip(page, id))));
  if (modifier) await page.keyboard.up(modifier);
  await settle(page);
}
async function drag(page, id, dx, trackId, edge) {
  const source = edge ? clip(page, id).locator(`[data-et-edge="${edge}"]`) : clip(page, id),
    from = await center(source);
  const y = trackId ? (await center(page.locator(`[data-et-lane="${trackId}"]`))).y : from.y;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, y, { steps: 10 });
  await page.mouse.up();
  await settle(page);
}
async function seek(page, seconds) {
  const bounds = await page.locator(".et-ruler").boundingBox(),
    viewport = await page.locator(".et-scroll").boundingBox(),
    scroll = await page.locator(".et-scroll").evaluate((element) => element.scrollLeft);
  assert.ok(bounds);
  assert.ok(viewport);
  await page.mouse.click(viewport.x + seconds * 64 + 1 - scroll, bounds.y + 4);
  await settle(page);
}
function content(document) {
  const { revision, ...value } = document;
  return value;
}
async function undo(page, expected) {
  await page.locator("#undo").click();
  await settle(page);
  assert.deepEqual(
    content((await state(page)).document),
    content(expected),
    "One history undo must restore the entire atomic edit",
  );
}

test("real mouse selection focuses keyboard controls, NTSC stepping is exact, and editable fields keep their keys", async (t) => {
  const page = await fixture(t, { ntsc: true });
  await clickClip(page, "a");
  assert.equal(await page.evaluate(() => document.activeElement.id), "timeline");
  await page.keyboard.press("ArrowRight");
  await settle(page);
  assert.equal((await state(page)).time, 8008);
  await page.keyboard.press("Shift+ArrowRight");
  await settle(page);
  assert.equal((await state(page)).time, 88088);
  await page.keyboard.press("ArrowLeft");
  await settle(page);
  assert.equal((await state(page)).time, 80080);
  const before = (await state(page)).document;
  await page.keyboard.press("Control+ArrowRight");
  await settle(page);
  assert.equal(
    (await state(page)).document.sequences[0].clips.find((item) => item.id === "a").start,
    240000 + 8008,
  );
  await undo(page, before);
  const input = page.locator('[data-et-track-name="v1"]');
  await input.click();
  await page.keyboard.press("Control+a");
  assert.deepEqual((await state(page)).selected, ["a"]);
  await page.keyboard.press("ArrowLeft");
  assert.equal((await state(page)).time, 80080);
});

test("cut-point and endpoint keys reveal distant NTSC positions without changing selection or history", async (t) => {
  const page = await fixture(t, {
    ntsc: true,
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 2 },
      { id: "b", trackId: "v2", start: 3, duration: 2 },
      { id: "duplicate-edge", trackId: "v3", start: 3, duration: 1 },
      { id: "late", trackId: "v1", start: 100, duration: 2 },
    ],
  });
  await clickClip(page, "a");
  const before = (await state(page)).document;
  for (const [key, time] of [
    ["ArrowDown", 2 * 240000],
    ["ArrowDown", 3 * 240000],
    ["ArrowUp", 2 * 240000],
    ["Home", 0],
    ["End", Math.floor((102 * 240000 - 1) / 8008) * 8008],
    ["ArrowUp", 100 * 240000],
  ]) {
    await page.keyboard.press(key);
    await settle(page);
    assert.equal((await state(page)).time, time, key);
    assert.equal(await page.evaluate(() => document.activeElement.id), "timeline");
    const visible = await page.evaluate(() => {
      const viewport = document.querySelector(".et-scroll").getBoundingClientRect(),
        playhead = document.querySelector(".et-playhead").getBoundingClientRect();
      return playhead.left >= viewport.left && playhead.left < viewport.right;
    });
    assert.ok(visible, `${key} must reveal its playhead`);
  }
  assert.ok(await page.locator(".et-scroll").evaluate((element) => element.scrollLeft > 5000));
  assert.equal(await clip(page, "late").count(), 1, "Distant clips are drawn after navigation");
  await page.keyboard.press("Home");
  await settle(page);
  assert.equal(await page.locator(".et-scroll").evaluate((element) => element.scrollLeft), 0);
  assert.deepEqual((await state(page)).document, before);
  assert.deepEqual((await state(page)).selected, ["a"]);
  assert.deepEqual((await state(page)).applied, []);
  assert.deepEqual((await state(page)).errors, []);
});

test("timeline navigation handles empty sequences and leaves native input keys alone", async (t) => {
  const page = await fixture(t, { clips: [] });
  await page.locator("#timeline").focus();
  for (const key of ["End", "ArrowDown", "ArrowUp", "Home", "ArrowRight", "Shift+ArrowRight"])
    await page.keyboard.press(key);
  await settle(page);
  assert.equal((await state(page)).time, 0);
  assert.equal((await state(page)).document.revision, 3);
  assert.deepEqual((await state(page)).errors, []);
  await page.locator('[data-et-track-name="v1"]').fill("abcdef");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  assert.equal(await page.locator('[data-et-track-name="v1"]').evaluate((input) => input.value.slice(input.selectionStart, input.selectionEnd)), "abcdef");
  await page.keyboard.press("n");
  assert.equal(await page.locator('[data-et-track-name="v1"]').inputValue(), "n");
  assert.equal(await page.locator("[data-et-snap]").isChecked(), true);
  assert.equal((await state(page)).time, 0);
});

test("cut navigation includes exact edges inside the final frame and never reverses direction", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 1.035 },
      { id: "tail", trackId: "v1", start: 1.035, duration: 0.005 },
    ],
  });
  await page.locator("#timeline").focus();
  await page.keyboard.press("End");
  await settle(page);
  assert.equal((await state(page)).time, 248000);
  await page.keyboard.press("ArrowDown");
  await settle(page);
  assert.equal((await state(page)).time, 248400, "The cut is inside the final frame");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await settle(page);
  assert.equal((await state(page)).time, 248400, "Forward navigation cannot jump to an earlier frame");
  await page.keyboard.press("ArrowUp");
  await settle(page);
  assert.equal((await state(page)).time, 0);
  assert.equal((await state(page)).document.revision, 3);
  assert.deepEqual((await state(page)).errors, []);
});

test("fit and snapping shortcuts use the existing view controls and never create edits", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 1, duration: 2 },
      { id: "late", trackId: "v1", start: 100, duration: 2 },
    ],
  });
  await clickClip(page, "a");
  const before = (await state(page)).document;
  await page.keyboard.press("n");
  assert.equal(await page.locator("[data-et-snap]").isChecked(), false);
  await page.keyboard.down("n");
  await page.keyboard.down("n");
  await page.keyboard.up("n");
  assert.equal(await page.locator("[data-et-snap]").isChecked(), true, "Holding N must toggle only once");
  await page.keyboard.press("End");
  await settle(page);
  await page.keyboard.press("Shift+z");
  await settle(page);
  assert.equal(await page.locator(".et-scroll").evaluate((element) => element.scrollLeft), 0);
  assert.equal(await clip(page, "a").count(), 1);
  assert.equal(await clip(page, "late").count(), 1);
  assert.deepEqual((await state(page)).document, before);
  assert.deepEqual((await state(page)).errors, []);
});

test("Ctrl and Shift toggles, Escape, select all, and non-additive marquee maintain exact selection", async (t) => {
  const page = await fixture(t);
  await clickClip(page, "a");
  await clickClip(page, "b", "Control");
  assert.deepEqual((await state(page)).selected.sort(), ["a", "b"]);
  await clickClip(page, "a", "Control");
  assert.deepEqual((await state(page)).selected, ["b"]);
  await clickClip(page, "c", "Shift");
  assert.deepEqual((await state(page)).selected.sort(), ["b", "c"]);
  await page.keyboard.press("Escape");
  await settle(page);
  assert.deepEqual((await state(page)).selected, []);
  await page.keyboard.press("Control+a");
  await settle(page);
  assert.deepEqual((await state(page)).selected.sort(), ["a", "b", "c"]);
  const a = await clip(page, "a").boundingBox(),
    b = await clip(page, "b").boundingBox();
  await page.mouse.move(a.x - 12, b.y - 4);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 8, a.y + a.height + 3, { steps: 12 });
  await page.mouse.up();
  await settle(page);
  assert.deepEqual((await state(page)).selected.sort(), ["a", "b"]);
  assert.equal(await page.locator('[aria-selected="true"][data-et-clip]').count(), 2);
  assert.equal(await page.locator(".et-selection-box").count(), 0);
  assert.equal((await state(page)).document.revision, 3);
});

test("group and link IDs are separate namespaces during click selection", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 1, duration: 2, groupId: "same" },
      { id: "b", trackId: "v2", start: 2, duration: 2, groupId: "same" },
      { id: "c", trackId: "v1", start: 6, duration: 2, linkGroupId: "same" },
    ],
  });
  await clickClip(page, "a");
  assert.deepEqual((await state(page)).selected.sort(), ["a", "b"]);
  await clickClip(page, "c");
  assert.deepEqual((await state(page)).selected, ["c"]);
});

test("a new session generation invalidates a menu even when document id and revision are unchanged", async (t) => {
  const page = await fixture(t);
  await page.locator('[data-et-clip="a"]').click({ button: "right" });
  const before = await state(page);
  const remove = await page.locator('[data-timeline-menu-action="remove"]').elementHandle();
  await page.evaluate(() => fixture.replaceGeneration());
  assert.equal(await page.locator("#timeline-context-menu").count(), 0);
  await remove.evaluate((button) => button.click());
  const after = await state(page);
  assert.deepEqual(after.document, before.document);
  assert.deepEqual(after.applied, []);
  assert.deepEqual(after.errors, []);
});

const menuAction = (page, action) => page.locator(`[data-timeline-menu-action="${action}"]`);
async function openClipMenu(page, id = "a") {
  await clip(page, id).click({ button: "right" });
  await settle(page);
}

test("clip menu copy and paste share the clipboard and return keyboard focus to the timeline", async (t) => {
  const page = await fixture(t);
  await clickClip(page, "a");
  await clip(page, "a").focus();
  await page.keyboard.press("Shift+F10");
  assert.equal(await menuAction(page, "paste").isDisabled(), true);
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#timeline-context-menu").count(), 0);
  assert.equal(await clip(page, "a").evaluate((node) => node === document.activeElement), true);
  assert.equal((await state(page)).document.revision, 3, "Copy does not edit the document");
  await page.evaluate(() => fixture.seek(9 * 240000));
  await openClipMenu(page);
  await menuAction(page, "paste").click();
  await settle(page);
  const result = await state(page), pasted = result.document.sequences[0].clips.find((item) => result.selected.includes(item.id));
  assert.equal(pasted.start, 9 * 240000);
  assert.equal(pasted.duration, 2 * 240000);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].label, "粘贴片段");
  await page.locator("#undo").click();
  assert.deepEqual((await state(page)).document.sequences[0].clips.map((item) => item.id), ["a", "b", "c"]);
});

test("clip menu trims exact free-clock boundaries and source captions in one undo", async (t) => {
  const page = await fixture(t, { caption: true });
  const before = (await state(page)).document;
  const cut = 509628; // 2.12345 seconds: a valid tick, deliberately not a video-frame boundary.
  for (const side of ["right", "left"]) {
    await page.evaluate((time) => fixture.seek(time), cut);
    await openClipMenu(page);
    await menuAction(page, `keep-${side}`).click();
    await settle(page);
    const result = await state(page), sequence = result.document.sequences[0],
      owner = sequence.clips.find((item) => item.id === "a"),
      caption = sequence.clips.find((item) => item.id === "caption");
    assert.equal(owner.start, side === "right" ? cut : 240000);
    assert.equal(owner.duration, side === "right" ? 720000 - cut : cut - 240000);
    assert.equal(caption.start, owner.start);
    assert.equal(caption.duration, owner.duration);
    assert.equal(caption.sourceBinding.sourceStart, side === "right" ? cut - 240000 : 0);
    assert.equal(caption.sourceBinding.sourceEnd, side === "right" ? 480000 : cut - 240000);
    assert.equal(sequence.clips.find((item) => item.id === "c").start, 6 * 240000);
    assert.equal(result.applied.at(-1).label, `保留播放头${side === "right" ? "右" : "左"}侧`);
    await page.locator("#undo").click();
    assert.deepEqual((await state(page)).document.sequences, before.sequences);
  }
});

test("clip menu magnetic trim keeps linked sound and captions with the following picture", async (t) => {
  const page = await fixture(t, { magnetic: true, caption: true, clips: [
    { id: "a", trackId: "v1", start: 0, duration: 2, linkGroupId: "voice" },
    { id: "voice", trackId: "audio", start: 0, duration: 2, linkGroupId: "voice" },
    { id: "c", trackId: "v1", start: 2, duration: 2 },
  ] });
  const before = (await state(page)).document;
  await page.evaluate(() => fixture.seek(240000));
  await openClipMenu(page);
  await menuAction(page, "keep-left").click();
  await settle(page);
  const result = await state(page), clips = result.document.sequences[0].clips;
  for (const id of ["a", "voice", "caption"])
    assert.equal(clips.find((item) => item.id === id).duration, 240000);
  assert.equal(clips.find((item) => item.id === "c").start, 240000);
  assert.equal(result.applied.length, 1);
  await page.locator("#undo").click();
  assert.deepEqual((await state(page)).document.sequences, before.sequences);
});

test("clip menu group, ungroup, duplicate and cut reuse the selected clips and undo history", async (t) => {
  const page = await fixture(t);
  await clickClip(page, "a");
  await clickClip(page, "b", "Control");
  await openClipMenu(page);
  await menuAction(page, "group").click();
  await settle(page);
  let result = await state(page), members = result.document.sequences[0].clips.filter((item) => ["a", "b"].includes(item.id));
  assert.ok(members[0].groupId);
  assert.equal(members[0].groupId, members[1].groupId);
  await openClipMenu(page);
  await menuAction(page, "ungroup").click();
  await settle(page);
  assert.ok((await state(page)).document.sequences[0].clips.every((item) => !item.groupId));
  await openClipMenu(page);
  await menuAction(page, "duplicate").click();
  await settle(page);
  result = await state(page);
  assert.equal(result.document.sequences[0].clips.length, 5);
  assert.equal(result.selected.length, 2);
  assert.equal(result.applied.at(-1).label, "原位复制片段");
  await page.locator("#undo").click();
  await clickClip(page, "a");
  await openClipMenu(page);
  await menuAction(page, "cut").click();
  await settle(page);
  assert.equal(await clip(page, "a").count(), 0);
  assert.equal((await state(page)).applied.at(-1).label, "剪切片段");
  await page.locator("#undo").click();
  assert.equal(await clip(page, "a").count(), 1);
});

test("clip menu split uses the displayed opening clock even if playback moves afterwards", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => fixture.seek(2 * 240000));
  await openClipMenu(page);
  assert.match(await page.locator("#timeline-context-menu-note").textContent(), /2\.000000 秒/);
  await page.evaluate(() => fixture.seek(2.75 * 240000));
  await menuAction(page, "split").click();
  await settle(page);
  const result = await state(page), clips = result.document.sequences[0].clips;
  assert.equal(clips.find((item) => item.id === "a").duration, 240000);
  assert.equal(clips.find((item) => result.selected.includes(item.id)).start, 480000);
  assert.equal(result.time, 660000);
  assert.equal(result.applied.length, 1);
});

test("clip menu explains unavailable time and lock actions while readonly copy stays usable", async (t) => {
  const page = await fixture(t);
  await openClipMenu(page);
  for (const action of ["split", "keep-left", "keep-right"])
    assert.equal(await menuAction(page, action).isDisabled(), true);
  assert.match(await page.locator("#timeline-context-menu-note").textContent(), /每个所选片段内部/);
  await page.keyboard.press("Escape");
  await page.locator('[data-et-track="v1"][data-et-toggle="locked"]').click();
  await page.evaluate(() => fixture.seek(2 * 240000));
  await openClipMenu(page);
  for (const action of ["cut", "split", "keep-left", "keep-right", "group", "ungroup", "remove"])
    assert.equal(await menuAction(page, action).isDisabled(), true);
  assert.equal(await menuAction(page, "copy").isDisabled(), false);
  const before = (await state(page)).document;
  await menuAction(page, "copy").click();
  assert.deepEqual((await state(page)).document, before);
  assert.deepEqual((await state(page)).errors, []);
});

test("all clip menu actions fence an unrendered replacement generation", async (t) => {
  for (const action of ["copy", "cut", "duplicate", "split", "keep-left", "keep-right", "remove"]) {
    const page = await fixture(t);
    await page.evaluate(() => fixture.seek(2 * 240000));
    await openClipMenu(page);
    const before = (await state(page)).document;
    await page.evaluate(() => fixture.replaceGeneration(false));
    await menuAction(page, action).click();
    const after = await state(page);
    assert.deepEqual(after.document, before, action);
    assert.equal(after.applied.length, 0, action);
    assert.match(after.errors.at(-1), /工程或选择已变化/);
  }
});

test("clip menu keyboard skips unavailable actions and stays inside a short narrow viewport", async (t) => {
  const page = await fixture(t, { tracks: ["v1"], clips: [{ id: "a", trackId: "v1", start: 0, duration: 2 }] });
  await page.setViewportSize({ width: 280, height: 340 });
  await page.addStyleTag({ content: "body{padding:0}#timeline{width:280px}" });
  await settle(page);
  await clip(page, "a").focus();
  await page.keyboard.press("Shift+F10");
  assert.equal(await menuAction(page, "copy").evaluate((node) => node === document.activeElement), true);
  const assertFocusVisible = async () => {
    assert.equal(await page.locator("#timeline-context-menu").evaluate((node) => {
      const active = document.activeElement.getBoundingClientRect(), menu = node.getBoundingClientRect();
      return active.top >= menu.top + node.clientTop && active.bottom <= menu.top + node.clientTop + node.clientHeight;
    }), true, "The keyboard-focused menu action must be visible inside its scroller");
  };
  await page.keyboard.press("End");
  assert.equal(await menuAction(page, "cancel").evaluate((node) => node === document.activeElement), true);
  await assertFocusVisible();
  await page.keyboard.press("ArrowUp");
  assert.equal(await menuAction(page, "remove").evaluate((node) => node === document.activeElement), true);
  await assertFocusVisible();
  await page.keyboard.press("Home");
  await assertFocusVisible();
  await page.keyboard.press("ArrowDown");
  assert.equal(await menuAction(page, "cut").evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press("ArrowDown");
  assert.equal(await menuAction(page, "duplicate").evaluate((node) => node === document.activeElement), true);
  const bounds = await page.locator("#timeline-context-menu").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 280 && bounds.y + bounds.height <= 340);
  assert.equal(await page.locator("#timeline-context-menu").evaluate((node) => node.scrollHeight > node.clientHeight), true);
  await page.keyboard.press("End");
  await assertFocusVisible();
  await page.keyboard.press("Enter");
  assert.equal(await clip(page, "a").evaluate((node) => node === document.activeElement), true);
  assert.equal((await state(page)).document.revision, 3);
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp");
  await assertFocusVisible();
  await page.keyboard.press("Enter");
  await settle(page);
  assert.equal(await clip(page, "a").count(), 0);
  assert.equal((await state(page)).applied.at(-1).label, "删除片段");
});

test("multi-selection drag preserves relative time and track positions in one undoable batch", async (t) => {
  const page = await fixture(t);
  await clickClip(page, "a");
  await clickClip(page, "b", "Control");
  const before = (await state(page)).document;
  await drag(page, "a", 64, "v2");
  const after = await state(page),
    a = after.document.sequences[0].clips.find((item) => item.id === "a"),
    b = after.document.sequences[0].clips.find((item) => item.id === "b");
  assert.deepEqual([a.trackId, a.start, b.trackId, b.start], ["v2", 480000, "v3", 720000]);
  assert.equal(after.document.revision, before.revision + 1);
  assert.equal(after.applied.length, 1);
  assert.deepEqual(after.errors, []);
  await undo(page, before);
  await page.locator("#timeline").focus();
  await page.keyboard.press("Escape");
  await settle(page);
  await drag(page, "a", -32);
  const movedLeft = await state(page);
  assert.equal(movedLeft.document.sequences[0].clips.find((item) => item.id === "a").start, 120000);
  assert.deepEqual(movedLeft.errors, []);
});

test("moving a clip snaps its trailing edge to the next clip start", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 1, duration: 2 },
      { id: "c", trackId: "v1", start: 6, duration: 2 },
    ],
  });
  await drag(page, "a", 64 * 2.95);
  const after = await state(page),
    a = after.document.sequences[0].clips.find((item) => item.id === "a");
  assert.equal(
    a.start + a.duration,
    6 * 240000,
    "Both clip edges should participate in nearby edit-point snapping",
  );
  assert.deepEqual(after.errors, []);
  await page.locator("#undo").click();
  await settle(page);
  await page.locator("[data-et-snap]").uncheck();
  await drag(page, "a", 64 * 2.95);
  assert.notEqual(
    (await state(page)).document.sequences[0].clips.find((item) => item.id === "a").start +
      a.duration,
    6 * 240000,
  );
});

test("stationary Alt bypasses and restores edge snapping without changing its global toggle or undo batch", async (t) => {
  const page = await fixture(t, {
    ntsc: true,
    clips: [
      { id: "a", trackId: "v1", start: 1, duration: 2 },
      { id: "c", trackId: "v1", start: 6, duration: 2 },
    ],
  });
  const before = (await state(page)).document,
    initial = await clip(page, "a").boundingBox(),
    point = await center(clip(page, "a"));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 64 * 2.94, point.y, { steps: 8 });
  const snapped = await clip(page, "a").boundingBox();
  assert.ok(Math.abs(snapped.x - initial.x - 192) < 1);
  await page.keyboard.down("Alt");
  const bypassed = await clip(page, "a").boundingBox();
  assert.ok(bypassed.x < snapped.x - 1, "Alt must recompute the held ghost without a mouse move");
  assert.equal(await page.locator("[data-et-snap]").isChecked(), true);
  await page.keyboard.up("Alt");
  assert.ok(Math.abs((await clip(page, "a").boundingBox()).x - snapped.x) < 1);
  await page.keyboard.down("Alt");
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await settle(page);
  const after = await state(page),
    moved = after.document.sequences[0].clips.find((value) => value.id === "a"),
    expected = await page.evaluate(() => editor.frameToTicks(
      editor.ticksToFrame(Math.round(3.94 * 240000), { numerator: 30000, denominator: 1001 }),
      { numerator: 30000, denominator: 1001 },
    ));
  assert.equal(moved.start, expected, "Bypassing edge snapping still uses exact NTSC frame quantization");
  assert.equal(after.applied.length, 1);
  assert.deepEqual(after.errors, []);
  await undo(page, before);
});

test("Alt applies to held trim handles and ruler seeking, including restoration while stationary", async (t) => {
  const page = await fixture(t, {
    clips: [{ id: "a", trackId: "v1", start: 1, duration: 2 }],
    markers: [{ id: "cut", time: 480000, duration: 0, name: "切点", note: "", color: "#f88" }],
  });
  const before = (await state(page)).document,
    handle = await center(clip(page, "a").locator('[data-et-edge="right"]'));
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 64 * 0.95, handle.y, { steps: 8 });
  const snapped = await clip(page, "a").boundingBox();
  await page.keyboard.down("Alt");
  assert.ok((await clip(page, "a").boundingBox()).width > snapped.width + 1);
  await page.keyboard.up("Alt");
  assert.ok(Math.abs((await clip(page, "a").boundingBox()).width - snapped.width) < 1);
  await page.keyboard.down("Alt");
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await settle(page);
  const after = await state(page),
    trimmed = after.document.sequences[0].clips[0];
  assert.equal(trimmed.duration, 256000);
  assert.equal(trimmed.timeMap.points.at(-1).source, 256000);
  assert.equal(after.applied.length, 1);
  await undo(page, before);

  const ruler = await page.locator(".et-ruler").boundingBox(),
    viewport = await page.locator(".et-scroll").boundingBox();
  await page.mouse.move(viewport.x + 2.05 * 64, ruler.y + 4);
  await page.mouse.down();
  await page.mouse.move(viewport.x + 2.05 * 64 + 0.1, ruler.y + 4);
  assert.equal((await state(page)).time, 480000);
  await page.keyboard.down("Alt");
  assert.equal((await state(page)).time, 496000);
  await page.keyboard.up("Alt");
  assert.equal((await state(page)).time, 480000);
  await page.keyboard.down("Alt");
  await page.mouse.up();
  await page.keyboard.up("Alt");
  assert.equal((await state(page)).time, 496000);
  assert.equal((await state(page)).applied.length, 1, "Ruler navigation must not create an edit");
  assert.deepEqual((await state(page)).errors, []);
});

test("Alt asset drops bypass edge snapping and disabled snapping stays disabled after Alt is released", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const lane = document.querySelector('[data-et-lane="v1"]'),
      view = document.querySelector(".et-scroll").getBoundingClientRect(),
      rect = lane.getBoundingClientRect();
    for (const altKey of [false, true]) {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", JSON.stringify({ assetId: "asset" }));
      lane.dispatchEvent(new DragEvent("drop", {
        bubbles: true, cancelable: true, dataTransfer, altKey,
        clientX: view.left + 5.95 * 64, clientY: rect.top + 10,
      }));
    }
  });
  await settle(page);
  assert.deepEqual((await state(page)).drops, [
    { assetId: "asset", at: 1440000, trackId: "v1" },
    { assetId: "asset", at: 1424000, trackId: "v1" },
  ]);
  await page.locator("[data-et-snap]").uncheck();
  const point = await center(clip(page, "a"));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 64 * 2.94, point.y, { steps: 8 });
  const bypassed = await clip(page, "a").boundingBox();
  await page.keyboard.down("Alt");
  await page.keyboard.up("Alt");
  assert.ok(Math.abs((await clip(page, "a").boundingBox()).x - bypassed.x) < 1);
  assert.equal(await page.locator("[data-et-snap]").isChecked(), false);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal((await state(page)).applied.length, 0);
});

test("Alt keeps zero bounds and locked tracks intact and Escape cancels its preview", async (t) => {
  const page = await fixture(t),
    before = (await state(page)).document;
  await page.keyboard.down("Alt");
  await drag(page, "a", -64 * 1.1);
  await page.keyboard.up("Alt");
  assert.equal((await state(page)).document.sequences[0].clips.find((value) => value.id === "a").start, 0);
  await undo(page, before);
  await page.locator('[data-et-track="v1"][data-et-toggle="locked"]').click();
  const locked = (await state(page)).document;
  await page.keyboard.down("Alt");
  await drag(page, "a", 64);
  await page.keyboard.up("Alt");
  assert.deepEqual((await state(page)).document, locked);
  assert.match((await state(page)).errors.at(-1), /锁定/);
  const point = await center(clip(page, "a"));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 32, point.y);
  await page.keyboard.down("Alt");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.up("Alt");
  assert.deepEqual((await state(page)).document, locked);
  assert.equal(await clip(page, "a").evaluate((element) => element.style.transform), "");
});

test("marquee uses visible clip bounds at track borders and does not select the adjacent track or empty gutter", async (t) => {
  const page = await fixture(t, {
    tracks: ["v1", "v2"],
    clips: [
      { id: "a", trackId: "v1", start: 1, duration: 2 },
      { id: "b", trackId: "v2", start: 1, duration: 2 },
    ],
  });
  const before = (await state(page)).document,
    lane = await page.locator('[data-et-lane="v1"]').boundingBox(),
    a = await clip(page, "a").boundingBox();
  for (const [top, bottom, expected] of [[lane.y + 1, a.y + 2, ["a"]], [a.y + a.height + 0.5, lane.y + lane.height - 0.5, []]]) {
    await page.mouse.move(a.x - 12, top);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width + 12, bottom, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    assert.deepEqual((await state(page)).selected, expected);
  }
  assert.deepEqual((await state(page)).document, before);
  assert.equal((await state(page)).applied.length, 0);
  assert.deepEqual((await state(page)).errors, []);
});

test("collision feedback appears before release and clears when dragged back to a valid one-step edit", async (t) => {
  const page = await fixture(t),
    before = (await state(page)).document,
    point = await center(clip(page, "a"));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 64 * 4, point.y, { steps: 8 });
  assert.match(await page.locator(".et-notice").textContent(), /同轨画面重叠/);
  assert.equal(await clip(page, "a").evaluate((element) => element.classList.contains("drag-invalid")), true);
  assert.equal(await page.locator('[data-et-lane="v1"].drop-target-invalid').count(), 1);
  assert.deepEqual((await state(page)).document, before);
  assert.equal((await state(page)).applied.length, 0);
  assert.deepEqual((await state(page)).errors, [], "Expected preview rejection must not emit an error on each move");
  await page.mouse.move(point.x + 64, point.y, { steps: 8 });
  assert.equal(await page.locator(".et-notice").textContent(), "");
  assert.equal(await page.locator(".drag-invalid,.drop-target-invalid").count(), 0);
  await page.mouse.up();
  await settle(page);
  assert.equal((await state(page)).document.sequences[0].clips.find((value) => value.id === "a").start, 480000);
  assert.equal((await state(page)).applied.length, 1);
  assert.deepEqual((await state(page)).errors, []);
  await undo(page, before);

  const restored = (await state(page)).document;
  await drag(page, "a", 64 * 4);
  assert.deepEqual((await state(page)).document, restored);
  assert.equal((await state(page)).errors.length, 1, "Release reports exactly one error for an invalid preview");
  assert.match((await state(page)).errors[0], /同轨画面重叠/);
  assert.equal(await page.locator(".drag-invalid,.drop-target-invalid").count(), 0);
});

test("incompatible destination and locked subtitle dependencies explain invalid movement before committing", async (t) => {
  for (const scenario of ["incompatible", "locked-caption"]) {
    const page = await fixture(t, { caption: scenario === "locked-caption" });
    if (scenario === "locked-caption")
      await page.locator('[data-et-track="text"][data-et-toggle="locked"]').click();
    const before = await state(page),
      point = await center(clip(page, "a")),
      y = scenario === "incompatible"
        ? (await center(page.locator('[data-et-lane="text"]'))).y
        : point.y;
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 64, y, { steps: 8 });
    const reason = scenario === "incompatible" ? /轨道类型不兼容/ : /锁定/;
    assert.match(await page.locator(".et-notice").textContent(), reason);
    assert.equal(await clip(page, "a").evaluate((element) => element.classList.contains("drag-invalid")), true);
    assert.deepEqual((await state(page)).document, before.document);
    assert.equal((await state(page)).applied.length, before.applied.length);
    assert.deepEqual((await state(page)).errors, []);
    await page.mouse.up();
    await settle(page);
    const after = await state(page);
    assert.deepEqual(after.document, before.document);
    assert.equal(after.applied.length, before.applied.length);
    assert.equal(after.errors.length, 1);
    assert.match(after.errors[0], reason);
  }
});

test("out-of-range trim shows its reason immediately and can recover without spending undo history", async (t) => {
  const page = await fixture(t),
    before = (await state(page)).document,
    handle = await center(clip(page, "a").locator('[data-et-edge="right"]'));
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 32, handle.y, { steps: 8 });
  assert.match(await page.locator(".et-notice").textContent(), /裁剪范围须位于片段内/);
  assert.equal(await clip(page, "a").evaluate((element) => element.classList.contains("drag-invalid")), true);
  assert.deepEqual((await state(page)).document, before);
  assert.equal((await state(page)).applied.length, 0);
  assert.deepEqual((await state(page)).errors, []);
  await page.keyboard.down("Alt");
  assert.match(await page.locator(".et-notice").textContent(), /裁剪范围须位于片段内/);
  await page.mouse.move(handle.x - 32, handle.y, { steps: 8 });
  await page.keyboard.up("Alt");
  assert.equal(await page.locator(".et-notice").textContent(), "");
  assert.equal(await page.locator(".drag-invalid").count(), 0);
  await page.mouse.up();
  await settle(page);
  const trimmed = (await state(page)).document.sequences[0].clips.find((value) => value.id === "a");
  assert.equal(trimmed.duration, 360000);
  assert.equal(trimmed.timeMap.points.at(-1).source, 360000);
  assert.equal((await state(page)).applied.length, 1);
  assert.deepEqual((await state(page)).errors, []);
  await undo(page, before);
});

test("subframe pointer movement reuses the validated plan without cloning the project and cancellation clears feedback", async (t) => {
  const page = await fixture(t),
    before = (await state(page)).document,
    point = await center(clip(page, "a"));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 4.4, point.y);
  await page.evaluate(() => {
    globalThis.originalStructuredClone = globalThis.structuredClone;
    globalThis.dragCloneCalls = 0;
    globalThis.structuredClone = (...args) => {
      globalThis.dragCloneCalls++;
      return originalStructuredClone(...args);
    };
  });
  for (let step = 1; step <= 12; step++)
    await page.mouse.move(point.x + 4.4 + step * 0.04, point.y);
  assert.equal(await page.evaluate(() => dragCloneCalls), 0,
    "No full document clone is needed while the quantized move and destination are unchanged");
  await page.evaluate(() => { globalThis.structuredClone = originalStructuredClone; });
  await page.mouse.move(point.x + 64 * 4, point.y);
  assert.match(await page.locator(".et-notice").textContent(), /同轨画面重叠/);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await page.locator(".et-notice").textContent(), "");
  assert.equal(await page.locator(".drag-invalid,.drop-target-invalid").count(), 0);
  assert.deepEqual((await state(page)).document, before);
  assert.equal((await state(page)).applied.length, 0);
  assert.deepEqual((await state(page)).errors, []);
});

test("a burst of changed drag coordinates validates once before paint and release synchronously checks its final position", async (t) => {
  const page = await fixture(t),
    before = (await state(page)).document,
    point = await center(clip(page, "a"));
  await page.evaluate(() => {
    globalThis.dragPlanCalls = 0;
    const plan = editor.EditorTimeline.prototype.planDrag;
    editor.EditorTimeline.prototype.planDrag = function (...args) {
      dragPlanCalls++;
      return plan.apply(this, args);
    };
    document.querySelector("#timeline").addEventListener("pointerdown", (event) => {
      globalThis.dragPointerId = event.pointerId;
    }, { once: true });
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  const duringBurst = await page.evaluate(({ x, y }) => {
    const timeline = document.querySelector("#timeline");
    for (let step = 1; step <= 40; step++)
      timeline.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, pointerId: dragPointerId, buttons: 1,
        clientX: x + step * 4, clientY: y,
      }));
    return dragPlanCalls;
  }, point);
  assert.equal(duringBurst, 0, "Pointer events only queue the latest candidate before paint");
  await settle(page);
  assert.equal(await page.evaluate(() => dragPlanCalls), 1);
  assert.deepEqual((await state(page)).document, before);
  await page.evaluate(({ x, y }) => {
    // The release coordinate differs from the pending candidate and must be checked immediately.
    document.querySelector("#timeline").dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, pointerId: dragPointerId, buttons: 0,
      clientX: x + 64, clientY: y,
    }));
  }, point);
  await page.mouse.up();
  await settle(page);
  assert.equal(await page.evaluate(() => dragPlanCalls), 2);
  assert.equal((await state(page)).applied.length, 1);
  assert.equal((await state(page)).document.sequences[0].clips.find((value) => value.id === "a").start, 480000);
  assert.deepEqual((await state(page)).errors, []);
  await undo(page, before);
});

test("release validates a pending collision synchronously and Escape or stale identity cancels queued planning", async (t) => {
  for (const ending of ["release", "escape", "stale"]) {
    const page = await fixture(t),
      before = (await state(page)).document,
      point = await center(clip(page, "a"));
    await page.evaluate(() => {
      globalThis.dragPlanCalls = 0;
      const plan = editor.EditorTimeline.prototype.planDrag;
      editor.EditorTimeline.prototype.planDrag = function (...args) {
        dragPlanCalls++;
        return plan.apply(this, args);
      };
      document.querySelector("#timeline").addEventListener("pointerdown", (event) => {
        globalThis.dragPointerId = event.pointerId;
      }, { once: true });
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    const result = await page.evaluate(({ point, ending }) => {
      const timeline = document.querySelector("#timeline");
      timeline.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, pointerId: dragPointerId, buttons: 1,
        clientX: point.x + 256, clientY: point.y,
      }));
      if (ending === "escape")
        timeline.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      if (ending === "stale") fixture.externalChange();
      timeline.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true, pointerId: dragPointerId, buttons: 0,
        clientX: point.x + 256, clientY: point.y,
      }));
      return { plans: dragPlanCalls, errors: fixture.read().errors };
    }, { point, ending });
    await page.mouse.up();
    await settle(page);
    assert.equal((await state(page)).applied.length, 0);
    assert.equal(await page.evaluate(() => dragPlanCalls), ending === "release" ? 1 : 0);
    if (ending === "release") {
      assert.equal(result.plans, 1);
      assert.equal((await state(page)).errors.length, 1);
      assert.match((await state(page)).errors[0], /同轨画面重叠/);
    } else if (ending === "escape") {
      assert.deepEqual((await state(page)).document, before);
      assert.deepEqual((await state(page)).errors, []);
      assert.equal(await page.locator(".et-notice").textContent(), "");
    } else {
      assert.equal((await state(page)).document.name, "外部更新");
      assert.equal((await state(page)).errors.length, 1);
      assert.match((await state(page)).errors[0], /工程已变化/);
    }
    assert.equal(await page.locator(".drag-invalid,.drop-target-invalid").count(), 0);
  }
});

test("stationary Alt flushes pending movement before paint and restores its snapped plan synchronously", async (t) => {
  const page = await fixture(t),
    before = (await state(page)).document,
    point = await center(clip(page, "a"));
  await page.evaluate(() => {
    globalThis.dragPlanDeltas = [];
    const plan = editor.EditorTimeline.prototype.planDrag;
    editor.EditorTimeline.prototype.planDrag = function (document, sequence, drag) {
      dragPlanDeltas.push(drag.delta);
      return plan.call(this, document, sequence, drag);
    };
    document.querySelector("#timeline").addEventListener("pointerdown", (event) => {
      globalThis.dragPointerId = event.pointerId;
    }, { once: true });
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  const deltas = await page.evaluate(({ x, y }) => {
    const timeline = document.querySelector("#timeline");
    timeline.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, pointerId: dragPointerId, buttons: 1,
      clientX: x + 64 * 2.94, clientY: y,
    }));
    timeline.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Alt", altKey: true }));
    const bypassed = [...dragPlanDeltas];
    timeline.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Alt" }));
    return { bypassed, restored: [...dragPlanDeltas] };
  }, point);
  assert.deepEqual(deltas.bypassed, [704000]);
  assert.deepEqual(deltas.restored, [704000, 720000]);
  await settle(page);
  assert.deepEqual(await page.evaluate(() => dragPlanDeltas), [704000, 720000],
    "The canceled frame must not revalidate either stationary modifier result");
  assert.deepEqual((await state(page)).document, before);
  await page.evaluate(({ x, y }) => {
    document.querySelector("#timeline").dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, pointerId: dragPointerId, buttons: 0,
      clientX: x + 64 * 2.94, clientY: y,
    }));
  }, point);
  await page.mouse.up();
  await settle(page);
  assert.equal((await state(page)).applied.length, 1);
  assert.equal((await state(page)).document.sequences[0].clips.find((value) => value.id === "a").start, 960000);
  assert.deepEqual((await state(page)).errors, []);
  await undo(page, before);
});

test("left and right handles preview actual trim geometry and preserve source time with one undo", async (t) => {
  const page = await fixture(t),
    before = (await state(page)).document;
  const initial = await clip(page, "a").boundingBox(),
    handle = await center(clip(page, "a").locator('[data-et-edge="right"]'));
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 32, handle.y, { steps: 8 });
  const preview = await clip(page, "a").boundingBox();
  assert.ok(
    Math.abs(preview.x - initial.x) < 1,
    "Right trim must keep the left edge fixed during preview",
  );
  assert.ok(
    Math.abs(preview.width - (initial.width - 32)) < 2,
    `Right trim should preview its shorter duration: ${JSON.stringify({ initial, preview })}`,
  );
  await page.mouse.up();
  await settle(page);
  const right = (await state(page)).document.sequences[0].clips.find((item) => item.id === "a");
  assert.equal(right.duration, 360000);
  assert.equal(right.timeMap.points.at(-1).source, 360000);
  await undo(page, before);
  await drag(page, "a", 32, undefined, "left");
  const left = (await state(page)).document.sequences[0].clips.find((item) => item.id === "a");
  assert.equal(left.start, 360000);
  assert.equal(left.duration, 360000);
  assert.equal(left.timeMap.points[0].source, 120000);
  await undo(page, before);
});

test("locked tracks reject mouse and keyboard edits atomically and keep unlock available", async (t) => {
  const page = await fixture(t);
  await page.locator('[data-et-track="v1"][data-et-toggle="locked"]').click();
  await settle(page);
  const before = (await state(page)).document;
  assert.equal(
    await page.locator('[data-et-track="v1"][data-et-toggle="hidden"]').isDisabled(),
    true,
  );
  await drag(page, "a", 64);
  const dragged = await state(page);
  assert.deepEqual(dragged.document, before);
  assert.match(dragged.errors.at(-1), /锁定/);
  await page.keyboard.press("Control+ArrowRight");
  await settle(page);
  assert.deepEqual((await state(page)).document, before);
  assert.match((await state(page)).errors.at(-1), /锁定/);
  assert.equal(
    await page.locator('[data-et-track="v1"][data-et-toggle="locked"]').isDisabled(),
    false,
  );
  await page.locator('[data-et-track="v1"][data-et-toggle="locked"]').click();
  await settle(page);
  await drag(page, "a", 64);
  assert.equal(
    (await state(page)).document.sequences[0].clips.find((item) => item.id === "a").start,
    480000,
  );
});

test("cross-sequence paste maps picture, sound and bound subtitles at an exact playhead in one undo", async (t) => {
  const page = await fixture(t, {
    caption: true,
    clips: [
      { id: "a", trackId: "v1", start: 1, duration: 2, groupId: "group", linkGroupId: "av" },
      { id: "b", trackId: "v1", start: 2, duration: 2, groupId: "group" },
      { id: "voice", trackId: "audio", start: 1, duration: 3, linkGroupId: "av" },
    ],
    transitions: [
      { id: "transition", fromClipId: "a", toClipId: "b", start: 2, duration: 1, kind: "dissolve" },
    ],
    destinationTracks: [
      { id: "target-text", kind: "text" },
      { id: "target-audio", kind: "audio" },
      { id: "target-video", kind: "video" },
    ],
  });
  await clickClip(page, "a");
  await page.keyboard.press("Control+c");
  await page.evaluate(() => {
    fixture.setSequence("target");
    fixture.seek(1920007);
  });
  const before = (await state(page)).document;
  await page.locator("#timeline").focus();
  await page.keyboard.press("Control+v");
  await settle(page);
  const after = await state(page),
    target = after.document.sequences[1],
    owner = target.clips.find((clip) => clip.label === "a"),
    voice = target.clips.find((clip) => clip.label === "voice"),
    caption = target.clips.find((clip) => clip.kind === "text");
  assert.equal(target.clips.length, 4);
  assert.equal(owner.start, 1920007);
  assert.equal(target.clips.find((clip) => clip.label === "b").start, 2160007);
  assert.equal(owner.trackId, "target-video");
  assert.equal(voice.trackId, "target-audio");
  assert.equal(caption.trackId, "target-text");
  assert.equal(caption.sourceBinding.clipId, owner.id);
  assert.equal(owner.linkGroupId, voice.linkGroupId);
  assert.equal(owner.groupId, target.clips.find((clip) => clip.label === "b").groupId);
  assert.notEqual(owner.groupId, "group");
  assert.equal(target.transitions[0].start, 2160007);
  assert.equal(target.transitions[0].fromClipId, owner.id);
  assert.equal(after.selected.length, 4);
  assert.equal(after.applied.length, 1);
  assert.deepEqual(after.errors, []);
  await undo(page, before);
});

test("missing cross-sequence subtitle track gives an actionable reason and permits retry after adding it", async (t) => {
  const page = await fixture(t, {
    caption: true,
    destinationTracks: [{ id: "target-video", kind: "video" }],
  });
  await clickClip(page, "a");
  await page.keyboard.press("Control+c");
  await page.evaluate(() => fixture.setSequence("target"));
  await page.locator('[data-et-action="paste"]').click();
  await settle(page);
  let after = await state(page);
  assert.match(after.errors[0], /第 1 条文字轨.*添加/);
  assert.equal(after.document.sequences[1].clips.length, 0);
  assert.equal(after.applied.length, 0);
  await page.getByRole("button", { name: "新建文字轨", exact: true }).click();
  await page.locator('[data-et-action="paste"]').click();
  await settle(page);
  after = await state(page);
  assert.equal(after.document.sequences[1].clips.length, 2);
  assert.equal(after.applied.length, 2);
});

test("cross-sequence locked captions and occupied picture tracks refuse the entire paste", async (t) => {
  const page = await fixture(t, {
    caption: true,
    destinationTracks: [
      { id: "target-video", kind: "video" },
      { id: "target-text", kind: "text" },
    ],
  });
  await clickClip(page, "a");
  await page.keyboard.press("Control+c");
  await page.evaluate(() => fixture.setSequence("target"));
  const lock = page.locator('[data-et-track="target-text"][data-et-toggle="locked"]');
  await lock.click();
  let before = await state(page);
  await page.locator('[data-et-action="paste"]').click();
  await settle(page);
  let after = await state(page);
  assert.deepEqual(after.document, before.document);
  assert.match(after.errors[0], /锁定/);
  assert.equal(after.applied.length, before.applied.length);
  await lock.click();
  await page.locator('[data-et-action="paste"]').click();
  await settle(page);
  before = await state(page);
  assert.equal(before.document.sequences[1].clips.length, 2);
  await page.locator('[data-et-action="paste"]').click();
  await settle(page);
  after = await state(page);
  assert.deepEqual(after.document, before.document);
  assert.match(after.errors.at(-1), /重叠/);
  assert.equal(after.applied.length, before.applied.length);
});

test("clipboard stays within its document and open generation, but survives sequence switches", async (t) => {
  for (const method of ["replaceGeneration", "replaceDocument"]) {
    const page = await fixture(t);
    await clickClip(page, "a");
    await page.keyboard.press("Control+c");
    assert.equal(await page.locator('[data-et-action="paste"]').isDisabled(), false);
    await page.evaluate((method) => fixture[method](), method);
    assert.equal(await page.locator('[data-et-action="paste"]').isDisabled(), true);
    await page.locator("#timeline").focus();
    await page.keyboard.press("Control+v");
    await settle(page);
    assert.equal((await state(page)).applied.length, 0);
  }
});

test("failed pending cut retains the prior clipboard and blocks duplicate submissions", async (t) => {
  const page = await fixture(t);
  assert.match(
    await page.getByRole("button", { name: "剪切", exact: true }).getAttribute("title"),
    /Ctrl X/,
  );
  assert.match(
    await page.getByRole("button", { name: "粘贴", exact: true }).getAttribute("title"),
    /播放头.*同类轨道/,
  );
  assert.match(
    await page.getByRole("button", { name: "原位复制", exact: true }).getAttribute("title"),
    /平行轨/,
  );
  await clickClip(page, "b");
  await page.keyboard.press("Control+c");
  await clickClip(page, "a");
  await page.evaluate(() => fixture.holdNextEdit());
  await page.keyboard.press("Control+x");
  assert.equal(await page.locator('[data-et-action="paste"]').isDisabled(), true);
  await page.keyboard.press("Control+d");
  await page.evaluate(() => fixture.finishEdit(true));
  await settle(page);
  assert.equal((await state(page)).applied.length, 0);
  assert.match((await state(page)).errors[0], /保存失败/);
  await page.evaluate(() => fixture.seek(2400001));
  await page.locator('[data-et-action="paste"]').click();
  await settle(page);
  const after = await state(page),
    added = after.document.sequences[0].clips.filter((clip) => !["a", "b", "c"].includes(clip.id));
  assert.equal(added.length, 1);
  assert.equal(added[0].label, "b");
  assert.equal(after.applied.length, 1);
});

test("a cut finishing after a document or generation switch cannot publish its old clipboard", async (t) => {
  for (const method of ["replaceGeneration", "replaceDocument"]) {
    const page = await fixture(t);
    await clickClip(page, "b");
    await page.keyboard.press("Control+c");
    await clickClip(page, "a");
    await page.evaluate(() => fixture.holdNextEdit());
    await page.keyboard.press("Control+x");
    await page.evaluate((method) => {
      fixture[method]();
      fixture.finishEdit();
    }, method);
    await settle(page);
    assert.equal(await page.locator('[data-et-action="paste"]').isDisabled(), true);
    assert.deepEqual((await state(page)).errors, []);
    if (method === "replaceDocument") assert.ok(findStateClip(await state(page), "a"));
  }
});

test("group, clipboard paste and duplicate each commit one complete undoable operation", async (t) => {
  const page = await fixture(t);
  await clickClip(page, "a");
  await clickClip(page, "b", "Control");
  const before = (await state(page)).document;
  await page.locator('[data-et-action="group"]').click();
  await settle(page);
  let after = await state(page),
    grouped = after.document.sequences[0].clips.filter((item) => ["a", "b"].includes(item.id));
  assert.ok(grouped[0].groupId);
  assert.equal(grouped[0].groupId, grouped[1].groupId);
  assert.equal(after.document.revision, before.revision + 1);
  await undo(page, before);
  await clickClip(page, "a");
  await clickClip(page, "b", "Control");
  // Both may remain selected after undo; use keyboard selection deterministically through the real UI.
  await page.keyboard.press("Escape");
  await clickClip(page, "a");
  await clickClip(page, "b", "Control");
  await page.keyboard.press("Control+c");
  await settle(page);
  assert.equal(await page.locator('[data-et-action="paste"]').isDisabled(), false);
  await seek(page, 9);
  const pasteBefore = (await state(page)).document;
  await page.keyboard.press("Control+v");
  await settle(page);
  after = await state(page);
  const added = after.document.sequences[0].clips.filter(
    (item) => !["a", "b", "c"].includes(item.id),
  );
  assert.equal(added.length, 2);
  assert.equal(added[1].start - added[0].start, 240000);
  assert.equal(after.document.revision, pasteBefore.revision + 1);
  assert.deepEqual(after.errors, []);
  await undo(page, pasteBefore);
  await clickClip(page, "a");
  await clickClip(page, "b", "Control");
  await page.locator('[data-et-action="duplicate"]').click();
  await settle(page);
  assert.equal((await state(page)).document.sequences[0].clips.length, 5);
  await undo(page, pasteBefore);
});

test("split with bound captions is one edit and one undo restores both source and words", async (t) => {
  const page = await fixture(t, { caption: true });
  await clickClip(page, "a");
  await seek(page, 2);
  const before = (await state(page)).document;
  await page.locator('[data-et-action="split"]').click();
  await settle(page);
  const after = await state(page),
    captions = after.document.sequences[0].clips.filter((item) => item.kind === "text");
  assert.equal(after.document.revision, before.revision + 1);
  assert.equal(after.applied.length, 1);
  assert.equal(after.document.sequences[0].clips.length, before.sequences[0].clips.length + 2);
  assert.deepEqual(captions.map((item) => item.text).sort(), ["one", "two"]);
  assert.deepEqual(after.errors, []);
  await undo(page, before);
});

test("successive S cuts keep the right-hand NTSC source selected and bound captions undo together", async (t) => {
  const page = await fixture(t, {
    ntsc: true,
    caption: true,
    clips: [{ id: "a", trackId: "v1", start: 0, duration: 10 }],
  });
  await clickClip(page, "a");
  const original = (await state(page)).document;
  await seek(page, 3);
  await page.keyboard.press("s");
  await settle(page);
  const first = await state(page),
    firstRight = first.document.sequences[0].clips.find((clip) => clip.kind === "media" && clip.start === first.time);
  assert.deepEqual(first.selected, [firstRight.id]);
  await seek(page, 6);
  await page.keyboard.press("s");
  await settle(page);
  const second = await state(page),
    sequence = second.document.sequences[0],
    sources = sequence.clips.filter((clip) => clip.kind === "media").sort((a, b) => a.start - b.start);
  assert.equal(sources.length, 3, "Two cuts need no intermediate selection click");
  assert.deepEqual(second.selected, [sources[2].id]);
  assert.equal(second.document.revision, original.revision + 2);
  assert.equal(second.applied.length, 2);
  assert.equal(sources[0].start + sources[0].duration, sources[1].start);
  assert.equal(sources[1].start + sources[1].duration, sources[2].start);
  assert.equal(sources[2].start + sources[2].duration, 10 * 240000);
  for (const caption of sequence.clips.filter((clip) => clip.kind === "text")) {
    const owner = sources.find((clip) => clip.id === caption.sourceBinding.clipId);
    assert.ok(owner);
    assert.equal(caption.start, owner.start);
    assert.equal(caption.duration, owner.duration);
  }
  assert.deepEqual(second.errors, []);
  await undo(page, first.document);
  await undo(page, original);
});

test("S synchronously cuts linked picture and audio with a selected caption, retaining only right-side links", async (t) => {
  const page = await fixture(t, {
    ntsc: true,
    caption: true,
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 10, linkGroupId: "sync", groupId: "group" },
      { id: "voice", trackId: "audio", start: 0, duration: 10, linkGroupId: "sync", groupId: "group" },
      { id: "later", trackId: "v2", start: 12, duration: 2, groupId: "group" },
    ],
  });
  await clickClip(page, "a");
  assert.deepEqual((await state(page)).selected.sort(), ["a", "later", "voice"]);
  await clickClip(page, "caption", "Control");
  assert.equal(await page.locator('[data-et-action="split"]').getAttribute("aria-disabled"), null);
  const original = (await state(page)).document;
  await seek(page, 3);
  await page.keyboard.press("s");
  await settle(page);
  const first = await state(page),
    firstRight = first.document.sequences[0].clips.filter((clip) => first.selected.includes(clip.id) && clip.start === first.time);
  assert.equal(first.applied.length, 1);
  assert.equal(first.document.sequences[0].clips.length, 7, "A selected bound caption splits just once");
  assert.equal(firstRight.length, 2);
  assert.equal(first.selected.length, 3);
  assert.ok(first.selected.includes("later"));
  assert.ok(firstRight.every((clip) => clip.kind === "media" && clip.start === first.time));
  assert.equal(firstRight[0].linkGroupId, firstRight[1].linkGroupId);
  assert.notEqual(firstRight[0].linkGroupId, "sync");
  assert.equal(firstRight[0].groupId, firstRight[1].groupId);
  assert.notEqual(firstRight[0].groupId, "group");
  assert.equal(findStateClip(first, "later").groupId, firstRight[0].groupId);
  await seek(page, 6);
  await page.keyboard.press("s");
  await settle(page);
  const second = await state(page),
    sources = second.document.sequences[0].clips.filter((clip) => clip.kind === "media");
  assert.equal(second.applied.length, 2);
  assert.equal(second.document.revision, original.revision + 2);
  assert.equal(second.selected.length, 3);
  assert.ok(second.selected.includes("later"));
  for (const trackId of ["v1", "audio"]) {
    const pieces = sources.filter((clip) => clip.trackId === trackId).sort((a, b) => a.start - b.start);
    assert.equal(pieces.length, 3);
    assert.equal(pieces[0].start + pieces[0].duration, pieces[1].start);
    assert.equal(pieces[1].start + pieces[1].duration, pieces[2].start);
    assert.equal(pieces[2].timeMap.points[0].source, second.time);
    assert.ok(second.selected.includes(pieces[2].id));
  }
  for (const caption of second.document.sequences[0].clips.filter((clip) => clip.kind === "text")) {
    const owner = sources.find((clip) => clip.id === caption.sourceBinding.clipId);
    assert.ok(owner);
    assert.equal(caption.start, owner.start);
    assert.equal(caption.duration, owner.duration);
  }
  assert.deepEqual(second.errors, []);
  // Clicking the new picture must expand only the right-hand group, never the old left halves.
  await clickClip(page, sources.find((clip) => clip.trackId === "v1" && second.selected.includes(clip.id)).id);
  assert.deepEqual((await state(page)).selected.sort(), second.selected.sort());
  await undo(page, first.document);
  await undo(page, original);
});

test("toolbar splits unrelated selected clips under the playhead and rejects a locked linked track atomically", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 4 },
      { id: "b", trackId: "v2", start: 1, duration: 5 },
      { id: "later", trackId: "v3", start: 8, duration: 2 },
    ],
  });
  for (const [index, id] of ["a", "b", "later"].entries())
    await clickClip(page, id, index ? "Control" : undefined);
  const original = (await state(page)).document;
  await seek(page, 2);
  await page.locator('[data-et-action="split"]').click();
  await settle(page);
  const after = await state(page);
  assert.equal(after.document.sequences[0].clips.length, 5);
  assert.equal(after.selected.length, 2);
  assert.deepEqual(findStateClip(after, "later"), findStateClip({ document: original }, "later"));
  assert.equal(after.applied.length, 1);
  assert.deepEqual(after.errors, []);
  await undo(page, original);

  const locked = await fixture(t, {
    caption: true,
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 4, linkGroupId: "sync" },
      { id: "voice", trackId: "audio", start: 0, duration: 4, linkGroupId: "sync" },
    ],
  });
  await locked.locator('[data-et-track="audio"][data-et-toggle="locked"]').click();
  await settle(locked);
  await clickClip(locked, "a");
  await seek(locked, 2);
  const before = await state(locked);
  await locked.keyboard.press("s");
  await settle(locked);
  const refused = await state(locked);
  assert.deepEqual(refused.document, before.document);
  assert.deepEqual(refused.selected, before.selected);
  assert.equal(refused.applied.length, before.applied.length);
  assert.match(refused.errors[0], /锁定/);
});

test("a split selects the entire right-hand group for immediate nudging and deletion without selecting left halves", async (t) => {
  const page = await fixture(t, {
    caption: true,
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 4, linkGroupId: "sync", groupId: "group" },
      { id: "voice", trackId: "audio", start: 0, duration: 4, linkGroupId: "sync", groupId: "group" },
      { id: "later", trackId: "v2", start: 8, duration: 2, groupId: "group" },
    ],
  });
  await clickClip(page, "a");
  await seek(page, 2);
  await page.keyboard.press("s");
  await settle(page);
  const split = await state(page);
  assert.equal(split.selected.length, 3);
  assert.ok(split.selected.includes("later"));
  assert.ok(!split.selected.includes("a") && !split.selected.includes("voice"));
  assert.ok(split.selected.every((id) => findStateClip(split, id).kind === "media"));
  await page.keyboard.press("Control+ArrowRight");
  await settle(page);
  const moved = await state(page);
  for (const id of split.selected)
    assert.equal(findStateClip(moved, id).start, findStateClip(split, id).start + 8000);
  for (const id of ["a", "voice", "caption"])
    assert.deepEqual(findStateClip(moved, id), findStateClip(split, id));
  const rightCaption = split.document.sequences[0].clips.find((item) => item.kind === "text" && item.id !== "caption");
  assert.equal(findStateClip(moved, rightCaption.id).start, rightCaption.start + 8000);
  assert.deepEqual(moved.errors, []);
  await undo(page, split.document);
  await page.locator("#timeline").focus();
  await page.keyboard.press("Delete");
  await settle(page);
  const deleted = await state(page);
  assert.deepEqual(deleted.document.sequences[0].clips.map((item) => item.id).sort(), ["a", "caption", "voice"]);
  assert.deepEqual(deleted.errors, []);
  await undo(page, split.document);
});

test("splitting an independently selected bound caption keeps only its right caption selected", async (t) => {
  const page = await fixture(t, { caption: true });
  const original = await state(page);
  await clickClip(page, "caption");
  await seek(page, 2);
  await page.keyboard.press("s");
  await settle(page);
  const after = await state(page),
    selected = after.selected.map((id) => findStateClip(after, id));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].kind, "text");
  assert.equal(selected[0].sourceBinding.clipId, "a");
  assert.equal(selected[0].start, after.time);
  assert.deepEqual(findStateClip(after, "a"), findStateClip(original, "a"));
  assert.deepEqual(after.errors, []);
  await undo(page, original.document);
});

test("a future group member's link cannot select a clip before the cut for a nudge or Delete", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 2, duration: 4, groupId: "group" },
      { id: "future", trackId: "v2", start: 8, duration: 1, groupId: "group", linkGroupId: "link" },
      { id: "past", trackId: "v3", start: 0, duration: 1, linkGroupId: "link" },
      { id: "further", trackId: "audio", start: 10, duration: 1, linkGroupId: "link" },
    ],
  });
  await clickClip(page, "a");
  assert.deepEqual((await state(page)).selected.sort(), ["a", "further", "future", "past"]);
  await seek(page, 4);
  await page.keyboard.press("s");
  await settle(page);
  const split = await state(page),
    right = split.document.sequences[0].clips.find((item) => item.id !== "a" && item.trackId === "v1");
  assert.deepEqual(split.selected.sort(), [right.id, "future", "further"].sort());
  await page.keyboard.press("Control+ArrowRight");
  await settle(page);
  const moved = await state(page);
  for (const id of ["a", "past"]) assert.deepEqual(findStateClip(moved, id), findStateClip(split, id));
  for (const id of split.selected)
    assert.equal(findStateClip(moved, id).start, findStateClip(split, id).start + 8000);
  assert.deepEqual(moved.errors, []);
  await undo(page, split.document);
  await page.locator("#timeline").focus();
  await page.keyboard.press("Delete");
  await settle(page);
  const removed = await state(page);
  assert.deepEqual(removed.document.sequences[0].clips.map((item) => item.id).sort(), ["a", "past"]);
  assert.deepEqual(removed.errors, []);
  await undo(page, split.document);
});

test("paste and duplicate select only the new instances so immediate Delete preserves original clips", async (t) => {
  const page = await fixture(t, { caption: true }),
    before = (await state(page)).document;
  await clickClip(page, "a");
  await page.locator('[data-et-action="copy"]').click();
  await settle(page);
  await seek(page, 9);
  await page.locator('[data-et-action="paste"]').click();
  await settle(page);
  let added = await state(page);
  assert.equal(added.selected.length, 2);
  assert.ok(
    added.selected.every((id) => !before.sequences[0].clips.some((clip) => clip.id === id)),
  );
  assert.equal(await page.evaluate(() => document.activeElement.id), "timeline");
  await page.keyboard.press("Delete");
  await settle(page);
  assert.deepEqual(content((await state(page)).document), content(before));
  await clickClip(page, "a");
  await page.locator('[data-et-action="duplicate"]').click();
  await settle(page);
  added = await state(page);
  assert.equal(added.selected.length, 2);
  assert.ok(!added.selected.includes("a"));
  await page.keyboard.press("Delete");
  await settle(page);
  const removed = (await state(page)).document.sequences[0];
  assert.deepEqual(removed.clips, before.sequences[0].clips);
  assert.deepEqual(
    removed.tracks.filter((track) =>
      before.sequences[0].tracks.some((source) => source.id === track.id),
    ),
    before.sequences[0].tracks,
  );
  assert.ok(
    removed.tracks.length > before.sequences[0].tracks.length,
    "Explicitly created parallel tracks remain after deleting only their clips",
  );
  assert.deepEqual((await state(page)).errors, []);
});

test("Tab-focused clips support Enter and Space with additive group toggles while preserving visible focus", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 1, duration: 2, groupId: "pair" },
      { id: "b", trackId: "v2", start: 2, duration: 2, groupId: "pair" },
      { id: "c", trackId: "v1", start: 6, duration: 2 },
    ],
  });
  await page.locator("#outside").click();
  for (let index = 0; index < 3; index++) await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.etClip), "c");
  await page.keyboard.press("Space");
  await settle(page);
  assert.deepEqual((await state(page)).selected, ["c"]);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.etClip), "c");
  assert.equal(
    await clip(page, "c").evaluate((element) => getComputedStyle(element).outlineStyle),
    "dashed",
  );
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.etClip), "a");
  await page.keyboard.press("Control+Enter");
  await settle(page);
  assert.deepEqual((await state(page)).selected.sort(), ["a", "b", "c"]);
  await page.keyboard.press("Control+Space");
  await settle(page);
  assert.deepEqual((await state(page)).selected, ["c"]);
  await page.keyboard.press("Enter");
  await settle(page);
  assert.deepEqual((await state(page)).selected.sort(), ["a", "b"]);
  await page.keyboard.down("Control");
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  await page.keyboard.up("Control");
  await settle(page);
  assert.deepEqual(
    (await state(page)).selected,
    [],
    "Holding an additive selection key must toggle only once",
  );
  assert.equal((await state(page)).document.revision, 3);
});

async function startEdgeDrag(page) {
  const point = await center(clip(page, "a")),
    viewport = await page.locator(".et-scroll").boundingBox();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(viewport.x + viewport.width - 2, point.y, { steps: 10 });
  await page.waitForFunction(() => document.querySelector(".et-scroll").scrollLeft > 40);
}
async function scrollSnapshot(page) {
  return page.evaluate(() => ({
    left: document.querySelector(".et-scroll")?.scrollLeft,
    top: document.querySelector(".et-body")?.scrollTop,
    time: performance.now(),
  }));
}
async function assertScrollStopped(page) {
  const before = await scrollSnapshot(page);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 120)));
  const after = await scrollSnapshot(page);
  assert.equal(after.left, before.left);
  assert.equal(after.top, before.top);
}

test("holding a drag at the viewport edge scrolls at bounded speed, preserves its ghost and commits once on release", async (t) => {
  const page = await fixture(t, {
      clips: [
        { id: "a", trackId: "v1", start: 1, duration: 2 },
        { id: "far", trackId: "v1", start: 100, duration: 3 },
      ],
    }),
    before = (await state(page)).document;
  await startEdgeDrag(page);
  const first = await scrollSnapshot(page);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 180)));
  const second = await scrollSnapshot(page);
  assert.ok(second.left > first.left);
  assert.ok(second.left - first.left <= (second.time - first.time) * 0.48 + 18);
  await page.waitForFunction(() => document.querySelector(".et-scroll").scrollLeft > 320);
  assert.equal(
    await clip(page, "a").count(),
    1,
    "The original-position virtualization window must retain the moving ghost",
  );
  assert.deepEqual((await state(page)).document, before);
  assert.equal((await state(page)).applied.length, 0);
  await page.mouse.up();
  await settle(page);
  const committed = await state(page);
  assert.equal(committed.applied.length, 1);
  assert.equal(committed.document.revision, before.revision + 1);
  assert.ok(
    committed.document.sequences[0].clips.find((clip) => clip.id === "a").start > 15 * 240000,
  );
  assert.deepEqual(committed.errors, []);
  await assertScrollStopped(page);
  await undo(page, before);
});

test("Escape, lost pointer capture and disposal stop automatic scrolling without committing the unfinished drag", async (t) => {
  for (const ending of ["escape", "capture", "dispose"]) {
    const page = await fixture(t, {
        clips: [
          { id: "a", trackId: "v1", start: 1, duration: 2 },
          { id: "far", trackId: "v1", start: 100, duration: 3 },
        ],
      }),
      before = (await state(page)).document;
    await startEdgeDrag(page);
    if (ending === "escape") await page.keyboard.press("Escape");
    else if (ending === "capture")
      await page.evaluate(() => document.querySelector("#timeline").releasePointerCapture(1));
    else await page.evaluate(() => fixture.dispose());
    await page.mouse.up();
    await settle(page);
    await assertScrollStopped(page);
    assert.deepEqual((await state(page)).document, before);
    assert.equal((await state(page)).applied.length, 0);
    assert.deepEqual((await state(page)).errors, []);
  }
});

/** Rebuilds of the timeline DOM over a quiet period; an idle timeline must not rebuild at all. */
async function idleRenders(page, milliseconds = 300) {
  return page.evaluate(
    (milliseconds) =>
      new Promise((resolve) => {
        let count = 0;
        const observer = new MutationObserver((records) => {
          count += records.filter((record) => record.target.id === "timeline").length;
        });
        observer.observe(document.querySelector("#timeline"), { childList: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(count);
        }, milliseconds);
      }),
    milliseconds,
  );
}

test("selecting a clip at the right edge or releasing an edge drag leaves a scrolled timeline idle and clickable", async (t) => {
  const clips = [
    { id: "a", trackId: "v1", start: 1, duration: 2 },
    { id: "edge", trackId: "v2", start: 14.5, duration: 1.2 },
    { id: "far", trackId: "v1", start: 100, duration: 3 },
  ];
  const page = await fixture(t, { clips });
  const view = await page.locator(".et-scroll").boundingBox(),
    edge = await clip(page, "edge").boundingBox();
  assert.ok(
    edge.x < view.x + view.width && edge.x + edge.width > view.x + view.width,
    "The fixture clip must straddle the right edge of the viewport",
  );
  // Playwright reveals the clip like browser focus does, then clicks it without moving.
  await clip(page, "edge").click();
  await settle(page);
  const scrolled = await scrollSnapshot(page);
  assert.ok(scrolled.left > 0, "Revealing the straddling clip scrolls the timeline");
  assert.deepEqual((await state(page)).selected, ["edge"]);
  assert.equal(
    await idleRenders(page),
    0,
    "A finished click must not keep rebuilding the timeline",
  );
  await assertScrollStopped(page);
  assert.equal((await scrollSnapshot(page)).left, scrolled.left);
  await clickClip(page, "a");
  assert.deepEqual((await state(page)).selected, ["a"], "A later click still selects");
  assert.equal((await state(page)).applied.length, 0, "Selection alone never edits");

  // Two rebuilds in one task at a non-zero scroll position must also settle.
  await page.evaluate(() => {
    fixture.replaceGeneration();
    fixture.replaceGeneration();
  });
  await settle(page);
  assert.equal(await idleRenders(page), 0, "Back-to-back renders must not feed each other");

  const dragged = await fixture(t, { clips });
  await startEdgeDrag(dragged);
  await dragged.mouse.up();
  await settle(dragged);
  assert.equal((await state(dragged)).applied.length, 1);
  assert.equal(
    await idleRenders(dragged),
    0,
    "Releasing an auto-scrolled drag must leave the timeline idle",
  );
  await assertScrollStopped(dragged);
  await clickClip(dragged, "edge");
  assert.deepEqual((await state(dragged)).selected, ["edge"], "A later click still selects");
  assert.deepEqual((await state(dragged)).errors, []);
});

test("window blur and a hidden document stop automatic scrolling and orphaned moves never resume a drag", async (t) => {
  for (const ending of ["blur", "hidden", "orphaned"]) {
    const page = await fixture(t, {
        clips: [
          { id: "a", trackId: "v1", start: 1, duration: 2 },
          { id: "far", trackId: "v1", start: 100, duration: 3 },
        ],
      }),
      before = (await state(page)).document;
    await startEdgeDrag(page);
    if (ending === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else if (ending === "hidden")
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    else
      // A release the page never saw: later moves arrive with no button held.
      await page.evaluate(() => {
        const timeline = document.querySelector("#timeline"),
          view = document.querySelector(".et-scroll").getBoundingClientRect();
        timeline.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerId: 1,
            buttons: 0,
            clientX: view.right - 2,
            clientY: view.top + 60,
          }),
        );
      });
    await settle(page);
    await assertScrollStopped(page);
    await page.mouse.up();
    await settle(page);
    await assertScrollStopped(page);
    assert.deepEqual((await state(page)).document, before, `${ending} must not commit`);
    assert.equal((await state(page)).applied.length, 0);
    assert.equal(await idleRenders(page), 0);
    assert.deepEqual((await state(page)).errors, []);
  }
});

test("an external revision during automatic scrolling cancels the gesture before applying old coordinates", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 1, duration: 2 },
      { id: "far", trackId: "v1", start: 100, duration: 3 },
    ],
  });
  await startEdgeDrag(page);
  await page.evaluate(() => fixture.externalChange());
  await page.waitForFunction(() => fixture.read().errors.length > 0);
  await page.mouse.up();
  await settle(page);
  await assertScrollStopped(page);
  const result = await state(page);
  assert.equal(result.document.name, "外部更新");
  assert.equal(result.document.revision, 4);
  assert.equal(result.applied.length, 0);
  assert.equal(result.document.sequences[0].clips.find((clip) => clip.id === "a").start, 240000);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /工程已变化/);
});

test("left edge automatic scrolling stops at zero while the held gesture stays uncommitted", async (t) => {
  const page = await fixture(t, {
      clips: [
        { id: "a", trackId: "v1", start: 6, duration: 2 },
        { id: "far", trackId: "v1", start: 100, duration: 3 },
      ],
    }),
    before = (await state(page)).document;
  const view = await center(page.locator(".et-scroll"));
  await page.mouse.move(view.x, view.y);
  await page.mouse.wheel(320, 0);
  await page.waitForFunction(() => document.querySelector(".et-scroll").scrollLeft >= 300);
  await settle(page);
  const point = await center(clip(page, "a")),
    bounds = await page.locator(".et-scroll").boundingBox();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 2, point.y, { steps: 8 });
  await page.waitForFunction(() => document.querySelector(".et-scroll").scrollLeft === 0);
  await assertScrollStopped(page);
  assert.deepEqual((await state(page)).document, before);
  await page.mouse.up();
  await settle(page);
  assert.equal((await state(page)).applied.length, 1);
  assert.ok(
    (await state(page)).document.sequences[0].clips.find((clip) => clip.id === "a").start <
      6 * 240000,
  );
  assert.deepEqual((await state(page)).errors, []);
});

test("marquee selection across automatic scroll retains offscreen clips without editing the document", async (t) => {
  const page = await fixture(t, {
      clips: [
        { id: "a", trackId: "v1", start: 1, duration: 2 },
        { id: "later", trackId: "v1", start: 25, duration: 2 },
        { id: "far", trackId: "v1", start: 100, duration: 3 },
      ],
    }),
    before = (await state(page)).document;
  const lane = await page.locator('[data-et-lane="v1"]').boundingBox(),
    view = await page.locator(".et-scroll").boundingBox();
  await page.mouse.move(view.x + 32, lane.y + 2);
  await page.mouse.down();
  await page.mouse.move(view.x + view.width - 2, lane.y + lane.height - 2, { steps: 8 });
  await page.waitForFunction(() => document.querySelector(".et-scroll").scrollLeft > 900);
  assert.equal(
    await clip(page, "a").count(),
    0,
    "The first clip is virtualized out of the visible DOM",
  );
  await page.mouse.up();
  await settle(page);
  await assertScrollStopped(page);
  assert.deepEqual((await state(page)).selected.sort(), ["a", "later"]);
  assert.deepEqual((await state(page)).document, before);
  assert.equal((await state(page)).applied.length, 0);
  assert.deepEqual((await state(page)).errors, []);
});

test("vertical edge scrolling exposes more tracks and still moves the source in one batch", async (t) => {
  const tracks = Array.from({ length: 12 }, (_, index) => `v${index + 1}`);
  const page = await fixture(t, {
      tracks,
      clips: [
        { id: "a", trackId: "v12", start: 1, duration: 2 },
        { id: "far", trackId: "v1", start: 100, duration: 3 },
      ],
    }),
    before = (await state(page)).document;
  const point = await center(clip(page, "a")),
    body = await page.locator(".et-body").boundingBox();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x, body.y + body.height - 3, { steps: 10 });
  await page.waitForFunction(() => document.querySelector(".et-body").scrollTop > 90);
  assert.deepEqual((await state(page)).document, before);
  await page.mouse.up();
  await settle(page);
  await assertScrollStopped(page);
  const result = await state(page);
  assert.equal(result.applied.length, 1);
  assert.notEqual(
    result.document.sequences[0].clips.find((clip) => clip.id === "a").trackId,
    "v12",
  );
  assert.deepEqual(result.errors, []);
  await undo(page, before);
});

test("time ruler and markers remain aligned, seekable and clear of lower-track gestures after two-axis scrolling", async (t) => {
  const page = await fixture(t, {
    // Enough compact tracks that the 300px body scrolls well past 400px.
    tracks: Array.from({ length: 16 }, (_, index) => `v${index + 1}`),
    clips: [
      { id: "a", trackId: "v5", start: 8, duration: 2 },
      { id: "far", trackId: "v1", start: 100, duration: 3 },
    ],
    markers: [{ id: "cue", time: 12 * 240000, duration: 0, name: "检查点", note: "", color: "#e5c879" }],
  });
  await page.addStyleTag({ content: ".et-body{max-height:300px}" });
  const before = (await state(page)).document;
  const body = await page.locator(".et-body").boundingBox();
  await page.mouse.move(body.x + 300, body.y + 150);
  await page.mouse.wheel(0, 430);
  await page.waitForFunction(() => document.querySelector(".et-body").scrollTop >= 400);
  await settle(page);
  const vertical = await page.locator(".et-body").evaluate((element) => element.scrollTop);
  await page.mouse.wheel(320, 0);
  await page.waitForFunction(() => document.querySelector(".et-scroll").scrollLeft >= 300);
  await settle(page);
  assert.equal(await page.locator(".et-body").evaluate((element) => element.scrollTop), vertical);
  const geometry = await page.evaluate(() => {
    const bounds = (selector) => {
      const { top, bottom, left } = document.querySelector(selector).getBoundingClientRect();
      return { top, bottom, left };
    };
    const ruler = bounds(".et-ruler");
    return {
      body: bounds(".et-body"), ruler, markers: bounds(".et-marker-lane"),
      head: bounds(".et-track-top"), cap: bounds(".et-playhead > i"),
      rulerHit: !!document.elementFromPoint(document.querySelector(".et-scroll").getBoundingClientRect().left + 25, ruler.top + 10)?.closest(".et-ruler"),
    };
  });
  assert.ok(Math.abs(geometry.ruler.top - geometry.body.top) < 1);
  assert.ok(Math.abs(geometry.head.top - geometry.body.top) < 1, JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.markers.top - geometry.ruler.bottom) < 1);
  assert.ok(Math.abs(geometry.head.bottom - geometry.markers.bottom) < 1);
  assert.ok(Math.abs(geometry.cap.top - geometry.ruler.top) < 1);
  assert.equal(geometry.rulerHit, true, "The fixed ruler must receive input above scrolling clips");
  await seek(page, 10);
  assert.equal((await state(page)).time, 10 * 240000);
  await page.locator('[data-et-marker="cue"]').click();
  assert.equal((await state(page)).time, 12 * 240000);
  const clipPosition = await clip(page, "a").boundingBox();
  assert.ok(clipPosition.y > geometry.markers.bottom);
  await drag(page, "a", 64);
  const after = await state(page);
  assert.equal(after.document.sequences[0].clips.find((item) => item.id === "a").start, 9 * 240000);
  assert.equal(after.applied.length, 1);
  assert.deepEqual(after.errors, []);
  await undo(page, before);
});

test("dragging a source carries its bound subtitle in time while retaining the text track, and locked captions reject the entire move", async (t) => {
  const page = await fixture(t, { caption: true }),
    before = (await state(page)).document;
  await drag(page, "a", 64, "v3");
  const moved = await state(page),
    owner = moved.document.sequences[0].clips.find((item) => item.id === "a"),
    caption = moved.document.sequences[0].clips.find((item) => item.id === "caption");
  assert.deepEqual(
    [owner.start, owner.trackId, caption.start, caption.trackId],
    [480000, "v3", 480000, "text"],
  );
  assert.equal(caption.sourceBinding.clipId, owner.id);
  assert.equal(caption.text, "one two");
  assert.deepEqual(moved.errors, []);
  await undo(page, before);
  await page.locator('[data-et-track="text"][data-et-toggle="locked"]').click();
  await settle(page);
  const locked = (await state(page)).document;
  await drag(page, "a", 64, "v3");
  assert.deepEqual((await state(page)).document, locked);
  assert.match((await state(page)).errors.at(-1), /锁定/);
});

test("keyboard grouping and ungrouping use one atomic edit each", async (t) => {
  const page = await fixture(t);
  await clickClip(page, "a");
  await clickClip(page, "b", "Control");
  const before = (await state(page)).document;
  await page.keyboard.press("Control+g");
  await settle(page);
  const grouped = (await state(page)).document;
  assert.ok(grouped.sequences[0].clips[0].groupId);
  await page.keyboard.press("Control+Shift+g");
  await settle(page);
  const ungrouped = (await state(page)).document;
  assert.equal(ungrouped.revision, grouped.revision + 1);
  assert.deepEqual(content(ungrouped), content(before));
  await undo(page, grouped);
  await undo(page, before);
});

test("track hide, mute, rename, reorder and add controls operate on the shared document", async (t) => {
  const page = await fixture(t);
  for (const field of ["hidden", "muted"]) {
    const before = (await state(page)).document;
    await page.locator(`[data-et-track="v2"][data-et-toggle="${field}"]`).click();
    await settle(page);
    assert.equal(
      (await state(page)).document.sequences[0].tracks.find((track) => track.id === "v2")[field],
      true,
    );
    await undo(page, before);
  }
  const input = page.locator('[data-et-track-name="v2"]');
  await input.fill("补充画面");
  await input.press("Tab");
  await settle(page);
  assert.equal(
    (await state(page)).document.sequences[0].tracks.find((track) => track.id === "v2").name,
    "补充画面",
  );
  const before = (await state(page)).document;
  await page.locator('[data-et-up="v1"]').click();
  await settle(page);
  assert.deepEqual(
    (await state(page)).document.sequences[0].tracks.map((track) => track.id),
    ["v2", "v1", "v3", "audio", "text"],
  );
  assert.deepEqual(
    await page
      .locator("[data-track-head]")
      .evaluateAll((elements) => elements.map((element) => element.dataset.trackHead)),
    ["text", "audio", "v3", "v1", "v2"],
  );
  await undo(page, before);
  await page.locator('[data-et-action="track-audio"]').click();
  await settle(page);
  const tracks = (await state(page)).document.sequences[0].tracks;
  assert.equal(tracks.length, 6);
  assert.equal(tracks.at(-1).kind, "audio");
});

test("Escape cancels an unfinished drag and stale document gestures fail without overwriting external edits", async (t) => {
  const page = await fixture(t),
    before = (await state(page)).document;
  let point = await center(clip(page, "a"));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 100, point.y, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await settle(page);
  assert.deepEqual((await state(page)).document, before);
  assert.deepEqual((await state(page)).selected, []);
  assert.equal(await clip(page, "a").evaluate((element) => element.style.transform), "");
  point = await center(clip(page, "a"));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 64, point.y, { steps: 8 });
  await page.evaluate(() => fixture.externalChange());
  await page.mouse.up();
  await settle(page);
  const after = await state(page);
  assert.equal(after.document.name, "外部更新");
  assert.equal(after.document.revision, before.revision + 1);
  assert.equal(after.document.sequences[0].clips.find((item) => item.id === "a").start, 240000);
  assert.match(after.errors.at(-1), /工程已变化/);
  assert.equal(await clip(page, "a").evaluate((element) => element.style.transform), "");
});

test("long sequence wheel scroll and real zoom controls stay responsive with bounded ruler rendering", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 1, duration: 2 },
      { id: "late", trackId: "v1", start: 10800, duration: 3 },
    ],
  });
  await page.evaluate(() => {
    globalThis.renders = 0;
    new MutationObserver(() => renders++).observe(document.querySelector("#timeline"), {
      childList: true,
    });
  });
  const target = await center(page.locator(".et-scroll"));
  await page.mouse.move(target.x, target.y);
  await page.mouse.wheel(1e7, 0);
  await page.waitForFunction(() => document.querySelector(".et-scroll").scrollLeft > 600000);
  await settle(page);
  assert.equal(await clip(page, "late").count(), 1);
  assert.equal(await clip(page, "a").count(), 0);
  const initial = await page.evaluate(() => ({
    left: document.querySelector(".et-scroll").scrollLeft,
    renders,
  }));
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 120)));
  const later = await page.evaluate(() => ({
    left: document.querySelector(".et-scroll").scrollLeft,
    renders,
  }));
  assert.equal(later.left, initial.left);
  assert.ok(
    later.renders - initial.renders <= 2,
    "An unchanged scroll position must not perpetually rerender",
  );
  assert.ok((await page.locator(".et-ruler > span").count()) <= 301);
  await page.locator("[data-et-zoom]").focus();
  await page.keyboard.press("Home");
  await settle(page);
  await page.locator('[data-et-action="fit"]').click();
  await settle(page);
  assert.equal(await page.locator(".et-scroll").evaluate((element) => element.scrollLeft), 0);
  assert.equal(await clip(page, "a").count(), 1);
  assert.equal(await clip(page, "late").count(), 1);
  assert.deepEqual((await state(page)).errors, []);
  assert.equal((await state(page)).document.revision, 3);
});

test("native slider zoom stays live throughout a drag and anchors the visible playhead", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 120 },
      { id: "b", trackId: "v2", start: 1, duration: 2 },
    ],
  });
  await clickClip(page, "b");
  assert.deepEqual((await state(page)).selected, ["b"]);
  await page.evaluate(() => fixture.seek(12 * 240000));
  await page.locator(".et-scroll").evaluate((element) => { element.scrollLeft = 200; });
  await settle(page);
  const before = await state(page);
  const position = () => page.evaluate(() => {
    const viewport = document.querySelector(".et-scroll").getBoundingClientRect();
    return document.querySelector(".et-playhead").getBoundingClientRect().left - viewport.left;
  });
  const anchor = await position();
  await page.evaluate(() => { globalThis.originalZoom = document.querySelector("[data-et-zoom]"); });
  const bounds = await page.locator("[data-et-zoom]").boundingBox();
  const x = bounds.x + 8 + (bounds.width - 16) * (Math.log10(64) + 2) / 5;
  await page.mouse.move(x, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(x + 5, bounds.y + bounds.height / 2, { steps: 4 });
  await settle(page);
  const during = Number(await page.locator("[data-et-zoom]").inputValue());
  assert.ok(during > Math.log10(64), "input events must zoom before the pointer is released");
  assert.ok(Math.abs((await position()) - anchor) <= 2);
  await page.mouse.move(x + 10, bounds.y + bounds.height / 2, { steps: 4 });
  await page.mouse.up();
  await settle(page);
  assert.ok(Number(await page.locator("[data-et-zoom]").inputValue()) > during);
  assert.equal(await page.evaluate(() => originalZoom === document.querySelector("[data-et-zoom]")), true);
  assert.equal(await page.locator("[data-et-zoom]").evaluate((element) => element === document.activeElement), true);
  assert.ok(Math.abs((await position()) - anchor) <= 2);
  assert.deepEqual((await state(page)).document, before.document);
  assert.deepEqual((await state(page)).selected, before.selected);
  assert.deepEqual((await state(page)).errors, []);
});

test("resizing during a native zoom drag preserves the slider and its next input", async (t) => {
  const page = await fixture(t, {
    clips: [{ id: "a", trackId: "v1", start: 0, duration: 120 }],
  });
  await page.evaluate(() => { globalThis.originalZoom = document.querySelector("[data-et-zoom]"); });
  const bounds = await page.locator("[data-et-zoom]").boundingBox(),
    x = bounds.x + 8 + (bounds.width - 16) * (Math.log10(64) + 2) / 5,
    y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 4, y, { steps: 3 });
  await page.locator("#timeline").evaluate((element) => { element.style.width = "1000px"; });
  await settle(page);
  const during = Number(await page.locator("[data-et-zoom]").inputValue());
  assert.equal(await page.evaluate(() => originalZoom === document.querySelector("[data-et-zoom]")), true);
  await page.mouse.move(x + 9, y, { steps: 3 });
  await page.mouse.up();
  await settle(page);
  assert.ok(Number(await page.locator("[data-et-zoom]").inputValue()) > during);
  assert.equal(await page.evaluate(() => originalZoom === document.querySelector("[data-et-zoom]")), true);
  assert.equal((await state(page)).applied.length, 0);
  assert.deepEqual((await state(page)).errors, []);
});

test("Ctrl and Meta wheel zoom around the pointer, with keyboard zoom and horizontal navigation", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 120 },
      { id: "b", trackId: "v2", start: 1, duration: 2 },
    ],
  });
  await clickClip(page, "b");
  assert.deepEqual((await state(page)).selected, ["b"]);
  await page.locator(".et-scroll").evaluate((element) => { element.scrollLeft = 1200; });
  await settle(page);
  const before = await state(page);
  const snapshot = () => page.evaluate(() => ({
    left: document.querySelector(".et-scroll").scrollLeft,
    scale: parseFloat(document.querySelector('[data-et-clip="a"]').style.width) / 120,
    width: document.querySelector(".et-scroll").clientWidth,
  }));
  let view = await snapshot();
  const bounds = await page.locator(".et-scroll").boundingBox(),
    offset = bounds.width * 0.4;
  await page.mouse.move(bounds.x + offset, bounds.y + 70);
  for (const modifier of ["Control", "Meta"]) {
    const anchor = (view.left + offset) / view.scale;
    await page.keyboard.down(modifier);
    await page.mouse.wheel(0, -120);
    await page.keyboard.up(modifier);
    await settle(page);
    const after = await snapshot();
    assert.ok(after.scale > view.scale);
    assert.ok(Math.abs((after.left + offset) / after.scale - anchor) < 0.03, JSON.stringify({ modifier, view, after, offset, anchor }));
    view = after;
  }
  await page.locator("#timeline").focus();
  await page.keyboard.press("-");
  await settle(page);
  const smaller = await snapshot();
  assert.ok(smaller.scale < view.scale);
  assert.ok(Math.abs((smaller.left + smaller.width / 2) / smaller.scale - (view.left + view.width / 2) / view.scale) < 0.03,
    "keyboard zoom must keep the visible center when the playhead is off screen");
  await page.keyboard.press("=");
  await settle(page);
  assert.ok((await snapshot()).scale > smaller.scale);
  view = await snapshot();
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 180);
  await page.keyboard.up("Shift");
  await settle(page);
  assert.ok((await snapshot()).left > view.left);
  assert.equal((await snapshot()).scale, view.scale);
  await page.locator("#outside").focus();
  await page.keyboard.press("-");
  assert.equal(await page.locator("#outside").inputValue(), "-");
  assert.equal((await snapshot()).scale, view.scale);
  assert.deepEqual((await state(page)).document, before.document);
  assert.deepEqual((await state(page)).selected, before.selected);
  assert.deepEqual((await state(page)).errors, []);
});

test("zoom at the end of a long timeline clamps scroll and redraws the actual visible clips", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 2 },
      { id: "late", trackId: "v1", start: 3600, duration: 3 },
    ],
  });
  await page.locator(".et-scroll").evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await settle(page);
  await page.locator("[data-et-zoom]").focus();
  await page.keyboard.press("Home");
  await settle(page);
  assert.equal(await page.locator(".et-scroll").evaluate((element) => element.scrollLeft), 0);
  assert.equal(await clip(page, "a").count(), 1);
  assert.equal(await clip(page, "late").count(), 1);
  assert.equal(await page.locator("[data-et-zoom]").evaluate((element) => element === document.activeElement), true);
  assert.equal((await state(page)).applied.length, 0);
  assert.deepEqual((await state(page)).errors, []);
});

test("a day-long timeline keeps its zoom slider truthful at the bounded pixel limit", async (t) => {
  const page = await fixture(t, {
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 2 },
      { id: "late", trackId: "v1", start: 86399, duration: 1 },
    ],
  });
  const slider = page.locator("[data-et-zoom]"),
    limit = Math.log10(12000000 / 86400);
  await slider.focus();
  for (const key of ["End", "End", "ArrowRight", "ArrowRight"]) {
    await page.keyboard.press(key);
    await settle(page);
    assert.ok(Math.abs(Number(await slider.inputValue()) - limit) <= 0.025);
    const width = await page.locator(".et-content").evaluate((element) => ({
      style: element.style.width,
      pixels: element.getBoundingClientRect().width,
    }));
    assert.ok(width.pixels <= 12000151, JSON.stringify(width));
    assert.ok((await page.locator(".et-ruler > span").count()) <= 301);
  }
  assert.equal((await state(page)).applied.length, 0);
  assert.deepEqual((await state(page)).errors, []);
});

test("resizing a docked timeline fills the expanded viewport and preserves selection and scroll", async (t) => {
  const page = await fixture(t, {
    clips: [{ id: "a", trackId: "v1", start: 1, duration: 7 }],
  });
  await page.locator("#timeline").evaluate((element) => { element.style.width = "600px"; });
  await settle(page);
  await clickClip(page, "a");
  const before = (await state(page)).document;
  const selected = (await state(page)).selected;
  await clip(page, "a").focus();
  await page.locator(".et-scroll").evaluate((element) => { element.scrollLeft = 30; });
  await settle(page);
  assert.equal(await page.locator(".et-scroll").evaluate((element) => element.scrollLeft), 30);
  const narrow = await page.locator(".et-content").evaluate((element) => element.getBoundingClientRect().width);
  await page.locator("#timeline").evaluate((element) => { element.style.width = "1140px"; });
  await page.waitForFunction(() => {
    const content = document.querySelector(".et-content").getBoundingClientRect();
    const viewport = document.querySelector(".et-scroll").getBoundingClientRect();
    return content.width >= viewport.width;
  });
  await settle(page);
  const wide = await page.evaluate(() => ({
    content: document.querySelector(".et-content").getBoundingClientRect().width,
    lane: document.querySelector(".et-lane").getBoundingClientRect().width,
    ruler: document.querySelector(".et-ruler").getBoundingClientRect().width,
    viewport: document.querySelector(".et-scroll").getBoundingClientRect().width,
    left: document.querySelector(".et-scroll").scrollLeft,
    focused: document.activeElement?.dataset.etClip,
  }));
  assert.ok(wide.content > narrow);
  assert.ok(wide.lane >= wide.viewport);
  assert.equal(wide.ruler, wide.lane);
  assert.equal(wide.left, 0, "An expanded viewport clamps scroll when the short sequence now fits");
  assert.equal(wide.focused, "a");
  assert.deepEqual((await state(page)).selected, selected);
  await seek(page, 10);
  assert.equal((await state(page)).time, 10 * 240000);
  await page.locator("#timeline").evaluate((element) => { element.style.width = "600px"; });
  await page.waitForFunction((width) => document.querySelector(".et-content").getBoundingClientRect().width === width, narrow);
  await settle(page);
  assert.deepEqual((await state(page)).document, before);
  assert.deepEqual((await state(page)).selected, selected);
  assert.deepEqual((await state(page)).errors, []);
});

test("dispose removes pointer and keyboard handlers and leaves the shared history untouched", async (t) => {
  const page = await fixture(t);
  await clickClip(page, "a");
  const before = await state(page);
  await page.evaluate(() => fixture.dispose());
  await page.keyboard.press("Delete");
  await settle(page);
  assert.equal(await page.locator("[data-et-clip]").count(), 0);
  assert.deepEqual((await state(page)).document, before.document);
});

const magneticClips = [
  { id: "a", trackId: "v1", start: 0, duration: 2, linkGroupId: "sync" },
  { id: "b", trackId: "v1", start: 2, duration: 2 },
  { id: "c", trackId: "v1", start: 4, duration: 2 },
  { id: "sound", trackId: "audio", start: 0, duration: 2, linkGroupId: "sync" },
];
const findStateClip = (snapshot, id) =>
  snapshot.document.sequences[0].clips.find((clip) => clip.id === id);

test("magnetic mouse drag inserts a picture between existing clips with linked audio and captions in one undo", async (t) => {
  const page = await fixture(t, { magnetic: true, clips: magneticClips, caption: true });
  const before = (await state(page)).document;
  await drag(page, "a", 256);
  const after = await state(page);
  assert.deepEqual(after.errors, []);
  assert.equal(findStateClip(after, "b").start, 0);
  assert.equal(findStateClip(after, "a").start, 480000);
  assert.equal(findStateClip(after, "sound").start, 480000);
  assert.equal(findStateClip(after, "caption").start, 480000);
  assert.equal(findStateClip(after, "c").start, 960000);
  assert.equal(after.applied.length, 1);
  assert.equal(after.applied[0].after, after.applied[0].before + 1);
  await undo(page, before);
});

test("magnetic keyboard movement changes neighbor order while unmodified arrows still seek one frame", async (t) => {
  const page = await fixture(t, {
    magnetic: true,
    clips: magneticClips,
    caption: true,
    ntsc: true,
  });
  await clickClip(page, "a");
  await page.keyboard.press("Control+ArrowRight");
  await settle(page);
  assert.equal(findStateClip(await state(page), "a").start, 480000);
  assert.equal(findStateClip(await state(page), "caption").start, 480000);
  await page.keyboard.press("Control+ArrowLeft");
  await settle(page);
  assert.equal(findStateClip(await state(page), "a").start, 0);
  await page.keyboard.press("ArrowRight");
  await settle(page);
  assert.equal((await state(page)).time, 8008);
  assert.deepEqual((await state(page)).errors, []);
});

test("magnetic delete removes a source with its linked audio and owned caption and closes the gap atomically", async (t) => {
  const page = await fixture(t, { magnetic: true, clips: magneticClips, caption: true }),
    before = (await state(page)).document;
  await clickClip(page, "a");
  await page.keyboard.press("Delete");
  await settle(page);
  const after = await state(page);
  for (const id of ["a", "sound", "caption"]) assert.equal(findStateClip(after, id), undefined);
  assert.equal(findStateClip(after, "b").start, 0);
  assert.equal(findStateClip(after, "c").start, 480000);
  assert.deepEqual(after.errors, []);
  await undo(page, before);
});

test("magnetic cut closes the gap and retains a complete pasteable source/audio/caption clipboard", async (t) => {
  const page = await fixture(t, { magnetic: true, clips: magneticClips, caption: true });
  await clickClip(page, "a");
  await page.keyboard.press("Control+x");
  await settle(page);
  let after = await state(page);
  assert.equal(findStateClip(after, "a"), undefined);
  assert.equal(findStateClip(after, "b").start, 0);
  assert.equal(findStateClip(after, "c").start, 480000);
  await seek(page, 4);
  await page.keyboard.press("Control+v");
  await settle(page);
  after = await state(page);
  assert.deepEqual(after.errors, []);
  assert.equal(after.document.sequences[0].clips.length, 5);
  const pasted = after.document.sequences[0].clips.find((clip) => clip.kind === "text");
  assert.ok(pasted.sourceBinding);
  const owner = after.document.sequences[0].clips.find(
    (clip) => clip.id === pasted.sourceBinding.clipId,
  );
  assert.equal(pasted.start, owner.start);
  assert.equal(owner.start, after.time);
  assert.equal(after.applied.length, 2);
});

test("magnetic drag carries an existing transition block, while deleting one endpoint keeps the other source", async (t) => {
  const page = await fixture(t, {
    magnetic: true,
    caption: true,
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 3 },
      { id: "b", trackId: "v1", start: 2, duration: 3 },
      { id: "c", trackId: "v1", start: 5, duration: 2 },
    ],
    transitions: [
      { id: "ab", fromClipId: "a", toClipId: "b", start: 2, duration: 1, kind: "dissolve" },
    ],
  });
  const before = (await state(page)).document;
  await drag(page, "a", 512);
  let after = await state(page);
  assert.deepEqual(after.errors, []);
  assert.equal(findStateClip(after, "c").start, 0);
  assert.equal(findStateClip(after, "a").start, 480000);
  assert.equal(findStateClip(after, "b").start, 960000);
  assert.equal(after.document.sequences[0].transitions[0].start, 960000);
  await undo(page, before);
  await clickClip(page, "a");
  await page.keyboard.press("Delete");
  await settle(page);
  after = await state(page);
  assert.equal(findStateClip(after, "a"), undefined);
  assert.equal(findStateClip(after, "b").start, 0);
  assert.equal(findStateClip(after, "c").start, 720000);
  assert.equal(after.document.sequences[0].transitions.length, 0);
  assert.deepEqual(after.errors, []);
});

test("magnetic cross-track dragging closes the source lane and preserves relative grouped tracks and caption lane", async (t) => {
  const page = await fixture(t, {
    magnetic: true,
    caption: true,
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 2, groupId: "g" },
      { id: "overlay", trackId: "v2", start: 1, duration: 2, groupId: "g" },
      { id: "b", trackId: "v1", start: 2, duration: 2 },
      { id: "c", trackId: "v1", start: 4, duration: 2 },
    ],
  });
  const before = (await state(page)).document;
  await drag(page, "a", 0, "v2");
  const after = await state(page);
  assert.deepEqual(after.errors, []);
  assert.equal(findStateClip(after, "a").trackId, "v2");
  assert.equal(findStateClip(after, "overlay").trackId, "v3");
  assert.equal(findStateClip(after, "overlay").start, 240000);
  assert.equal(findStateClip(after, "caption").trackId, "text");
  assert.equal(findStateClip(after, "b").start, 0);
  assert.equal(findStateClip(after, "c").start, 480000);
  await undo(page, before);
});

test("magnetic ripple refuses a locked following caption dependency and does not change the document", async (t) => {
  const page = await fixture(t, {
    magnetic: true,
    clips: [
      { id: "a", trackId: "v1", start: 2, duration: 2 },
      { id: "b", trackId: "v1", start: 0, duration: 2 },
      { id: "c", trackId: "v1", start: 4, duration: 2 },
    ],
    caption: true,
  });
  await page.locator('[data-et-track="text"][data-et-toggle="locked"]').click();
  await settle(page);
  const before = (await state(page)).document;
  await clickClip(page, "b");
  await page.keyboard.press("Delete");
  await settle(page);
  assert.deepEqual(content((await state(page)).document), content(before));
  assert.match((await state(page)).errors.at(-1), /锁定/);
});

test("magnetic deletion of a caption alone preserves all picture timing", async (t) => {
  const page = await fixture(t, { magnetic: true, clips: magneticClips, caption: true });
  const before = (await state(page)).document;
  await clickClip(page, "caption");
  await page.keyboard.press("Delete");
  await settle(page);
  const after = await state(page);
  assert.equal(findStateClip(after, "caption"), undefined);
  for (const id of ["a", "b", "c", "sound"])
    assert.deepEqual(
      findStateClip(after, id),
      before.sequences[0].clips.find((clip) => clip.id === id),
    );
  assert.deepEqual(after.errors, []);
});

test("magnetic cut of a bound caption alone refuses to duplicate its owner into the clipboard", async (t) => {
  const page = await fixture(t, { magnetic: true, clips: magneticClips, caption: true });
  const before = (await state(page)).document;
  await clickClip(page, "caption");
  await page.keyboard.press("Control+x");
  await settle(page);
  const after = await state(page);
  assert.deepEqual(after.document, before);
  assert.match(after.errors.at(-1), /同时选择来源片段/);
  assert.equal(await page.locator('[data-et-action="paste"]').isDisabled(), true);
});

test("magnetic audio-only keyboard movement remains one frame and does not reorder pictures", async (t) => {
  const clips = magneticClips.map((clip) => {
    const copy = { ...clip };
    delete copy.linkGroupId;
    return copy;
  });
  const page = await fixture(t, { magnetic: true, clips, ntsc: true });
  const before = (await state(page)).document;
  await clickClip(page, "sound");
  await page.keyboard.press("Control+ArrowRight");
  await settle(page);
  const after = await state(page);
  assert.equal(findStateClip(after, "sound").start, 8008);
  for (const id of ["a", "b", "c"])
    assert.deepEqual(
      findStateClip(after, id),
      before.sequences[0].clips.find((clip) => clip.id === id),
    );
  assert.deepEqual(after.errors, []);
});

test("magnetic trim handles ripple the shortened source, linked audio and word-aligned caption in one undo", async (t) => {
  const page = await fixture(t, { magnetic: true, clips: magneticClips, caption: true }),
    before = (await state(page)).document;
  await drag(page, "a", 64, undefined, "left");
  const after = await state(page);
  assert.deepEqual(after.errors, []);
  assert.equal(findStateClip(after, "a").duration, 240000);
  assert.equal(findStateClip(after, "a").start, 0);
  assert.equal(findStateClip(after, "sound").duration, 240000);
  assert.equal(findStateClip(after, "sound").start, 0);
  assert.equal(findStateClip(after, "caption").text, "two");
  assert.equal(findStateClip(after, "caption").start, 0);
  assert.equal(findStateClip(after, "b").start, 240000);
  assert.equal(findStateClip(after, "c").start, 720000);
  await undo(page, before);
});

test("range bars show both bounds, navigate by identity, and extend the reachable ruler past media", async (t) => {
  const page = await fixture(t, {
    markers: [
      {
        id: "range",
        time: 480000,
        duration: 720000,
        name: "审核范围",
        note: "两端",
        color: "#98efba",
      },
      { id: "point", time: 1440000, duration: 0, name: "点检查", note: "", color: "#e5c879" },
      {
        id: "future",
        time: 60 * 240000,
        duration: 10 * 240000,
        name: "后续规划",
        note: "",
        color: "#f88",
      },
    ],
  });
  const before = (await state(page)).document;
  const range = page.locator('[data-et-marker="range"]');
  assert.ok((await range.boundingBox()).width > 180);
  assert.equal(await range.getAttribute("title"), "审核范围 · 0:02.00 — 0:05.00 · 两端");
  await range.click();
  assert.equal((await state(page)).time, 480000);
  await page.locator('[data-et-marker="point"]').click();
  assert.equal((await state(page)).time, 1440000);
  await page.locator('[data-et-action="fit"]').click();
  await page.locator('[data-et-marker="future"]').click();
  assert.equal((await state(page)).time, 60 * 240000);
  assert.deepEqual((await state(page)).document, before);
});
test("track volume and pan commit independently with correct bounds, locking and one-step undo", async (t) => {
  const page = await fixture(t),
    before = (await state(page)).document;
  const volume = page.getByLabel("v1 音量百分比", { exact: true });
  await volume.fill("37.5");
  await volume.press("Enter");
  await volume.blur();
  await settle(page);
  let changed = await state(page);
  assert.equal(
    changed.document.sequences[0].tracks.find((track) => track.id === "v1").volume,
    0.375,
  );
  assert.deepEqual(changed.document.sequences[0].clips, before.sequences[0].clips);
  assert.equal(changed.applied.length, 1);
  assert.equal(changed.audio.find((item) => item.clipId === "a").gain, 0.375);
  assert.equal(changed.audio.find((item) => item.clipId === "b").gain, 1);
  const afterVolume = changed.document;
  const pan = page.getByLabel("v1 声像", { exact: true });
  await pan.fill("-80");
  await pan.press("Enter");
  await pan.blur();
  await settle(page);
  changed = await state(page);
  assert.equal(changed.document.sequences[0].tracks.find((track) => track.id === "v1").pan, -0.8);
  assert.equal(changed.document.sequences[0].tracks.find((track) => track.id === "v2").pan, 0);
  assert.equal(changed.audio.find((item) => item.clipId === "a").pan, -0.8);
  assert.equal(changed.audio.find((item) => item.clipId === "b").pan, 0);
  await undo(page, afterVolume);
  await undo(page, before);
  await page.getByLabel("锁定v1", { exact: true }).click();
  assert.equal(await page.getByLabel("v1 音量百分比", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("v1 声像", { exact: true }).isDisabled(), true);
  await page.getByLabel("解锁v1", { exact: true }).click();
  const unchanged = (await state(page)).document;
  await page.getByLabel("v1 音量百分比", { exact: true }).fill("401");
  await page.getByLabel("v1 音量百分比", { exact: true }).dispatchEvent("change");
  assert.deepEqual((await state(page)).document, unchanged);
  assert.match((await state(page)).errors.at(-1), /400/);
});
test("free caption-only cut preserves both original media and the existing clipboard", async (t) => {
  const page = await fixture(t, { caption: true });
  await clickClip(page, "c");
  await page.keyboard.press("Control+c");
  const before = (await state(page)).document;
  await clickClip(page, "caption");
  await page.keyboard.press("Control+x");
  await settle(page);
  assert.deepEqual((await state(page)).document, before);
  assert.match((await state(page)).errors.at(-1), /同时选择来源片段/);
  await seek(page, 9);
  await page.keyboard.press("Control+v");
  await settle(page);
  const added = (await state(page)).document.sequences[0].clips.filter(
    (clip) => !before.sequences[0].clips.some((old) => old.id === clip.id),
  );
  assert.equal(added.length, 1);
  assert.equal(added[0].label, "c");
});
test("in-place duplicate creates new parallel instances at the exact same times and undoes as one edit", async (t) => {
  const page = await fixture(t, { caption: true });
  await clickClip(page, "a");
  const before = (await state(page)).document;
  await page.keyboard.press("Control+d");
  await settle(page);
  const after = await state(page),
    seq = after.document.sequences[0];
  assert.equal(after.applied.length, 1);
  assert.equal(seq.tracks.length, before.sequences[0].tracks.length + 2);
  const added = seq.clips.filter(
    (clip) => !before.sequences[0].clips.some((old) => old.id === clip.id),
  );
  assert.equal(added.length, 2);
  for (const copy of added) {
    const source = before.sequences[0].clips.find((clip) => clip.label === copy.label);
    assert.equal(copy.start, source.start);
    assert.equal(copy.duration, source.duration);
    assert.notEqual(copy.trackId, source.trackId);
  }
  assert.equal(
    added.find((clip) => clip.kind === "text").sourceBinding.clipId,
    added.find((clip) => clip.kind === "media").id,
  );
  await undo(page, before);
});

test("migrated main-only magnetism keeps overlay keyboard, drag, delete and cut in free placement", async (t) => {
  const page = await fixture(t, {
    magnetic: true,
    magneticTrackId: "v1",
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 2 },
      { id: "b", trackId: "v1", start: 2, duration: 2 },
      { id: "overlay", trackId: "v2", start: 1, duration: 1 },
      { id: "later", trackId: "v2", start: 6, duration: 1 },
    ],
  });
  const before = (await state(page)).document;
  await clickClip(page, "overlay");
  await page.keyboard.press("Control+ArrowRight");
  await settle(page);
  let after = await state(page);
  assert.equal(findStateClip(after, "overlay").start, 248000);
  assert.equal(findStateClip(after, "later").start, 1440000);
  assert.equal(findStateClip(after, "b").start, 480000);
  await undo(page, before);
  await drag(page, "overlay", 64);
  after = await state(page);
  assert.equal(findStateClip(after, "overlay").start, 480000);
  assert.equal(findStateClip(after, "later").start, 1440000);
  assert.deepEqual(after.errors, []);
  await undo(page, before);
  for (const key of ["Delete", "Control+x"]) {
    await clickClip(page, "overlay");
    await page.keyboard.press(key);
    await settle(page);
    after = await state(page);
    assert.equal(findStateClip(after, "overlay"), undefined);
    assert.equal(findStateClip(after, "later").start, 1440000);
    assert.equal(findStateClip(after, "b").start, 480000);
    assert.deepEqual(after.errors, []);
    await undo(page, before);
  }
  await clickClip(page, "a");
  await page.keyboard.press("Delete");
  await settle(page);
  after = await state(page);
  assert.equal(findStateClip(after, "b").start, 0);
  assert.equal(findStateClip(after, "overlay").start, 240000);
  assert.equal(findStateClip(after, "later").start, 1440000);
  assert.deepEqual(after.errors, []);
  await undo(page, before);
});

test("migrated overlay trim preserves the source offset without rippling a later overlay", async (t) => {
  const page = await fixture(t, {
    magnetic: true,
    magneticTrackId: "v1",
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: 2 },
      { id: "b", trackId: "v1", start: 2, duration: 2 },
      { id: "overlay", trackId: "v2", start: 1, duration: 2 },
      { id: "later", trackId: "v2", start: 6, duration: 1 },
    ],
  });
  const before = (await state(page)).document;
  await drag(page, "overlay", 64, undefined, "left");
  const after = await state(page);
  assert.equal(findStateClip(after, "overlay").start, 480000);
  assert.equal(findStateClip(after, "overlay").duration, 240000);
  assert.equal(findStateClip(after, "overlay").timeMap.points[0].source, 240000);
  assert.equal(findStateClip(after, "later").start, 1440000);
  assert.equal(findStateClip(after, "b").start, 480000);
  assert.deepEqual(after.errors, []);
  await undo(page, before);
});

test("dragging the last main-track clip right in magnetic mode explains why nothing moved", async (t) => {
  const page = await fixture(t, { magnetic: true, clips: magneticClips });
  const notice = page.locator(".et-notice");
  // One persistent live region: screen readers hear its text change.
  assert.equal(await notice.count(), 1);
  assert.equal(await notice.getAttribute("role"), "status");
  assert.equal(await notice.textContent(), "");
  await notice.evaluate((node) => (window.__noticeNode = node));
  const before = (await state(page)).document;
  await drag(page, "c", 200);
  const after = await state(page);
  assert.deepEqual(after.errors, []);
  assert.deepEqual(content(after.document), content(before));
  assert.equal(after.applied.length, 0);
  assert.match(await notice.textContent(), /磁吸/);
  assert.match(await notice.textContent(), /自由/);
  assert.equal(await notice.evaluate((node) => node === window.__noticeNode), true);
  // A later real edit clears the explanation.
  await drag(page, "a", 256);
  assert.equal(await notice.textContent(), "");
  assert.equal(await notice.evaluate((node) => node === window.__noticeNode), true);
});

test("the magnetic layout toggle says why it is unavailable without a picture track", async (t) => {
  const page = await fixture(t, { tracks: ["audio", "text"], clips: [] });
  const magnetic = page
    .getByRole("group", { name: "时间线模式", exact: true })
    .getByRole("button", { name: "磁吸", exact: true });
  assert.equal(await magnetic.isDisabled(), true);
  assert.match(await magnetic.getAttribute("title"), /还没有画面轨/);
});

test("the timeline toolbar switches between magnetic and free layout with the shared planner", async (t) => {
  const page = await fixture(t);
  const group = page.getByRole("group", { name: "时间线模式", exact: true });
  const magnetic = group.getByRole("button", { name: "磁吸", exact: true }),
    free = group.getByRole("button", { name: "自由", exact: true });
  assert.equal(await free.getAttribute("aria-pressed"), "true");
  assert.equal(await magnetic.getAttribute("aria-pressed"), "false");
  assert.match(await magnetic.getAttribute("title"), /首尾相接/);
  assert.match(await free.getAttribute("title"), /任意位置/);
  const before = (await state(page)).document;
  await magnetic.click();
  await settle(page);
  let after = await state(page);
  assert.deepEqual(after.errors, []);
  assert.equal(after.document.sequences[0].timelineMode, "magnetic");
  // The main picture track closes its gaps in the same undoable step.
  assert.equal(findStateClip(after, "a").start, 0);
  assert.equal(findStateClip(after, "c").start, 480000);
  assert.equal(findStateClip(after, "b").start, 480000);
  assert.equal(after.applied.length, 1);
  assert.equal(after.applied[0].label, "切换时间线排列");
  assert.equal(await magnetic.getAttribute("aria-pressed"), "true");
  await undo(page, before);
  await free.click();
  await settle(page);
  assert.equal((await state(page)).applied.length, 1, "Choosing the current mode is a no-op");
  await magnetic.click();
  await settle(page);
  await free.click();
  await settle(page);
  after = await state(page);
  assert.equal(after.document.sequences[0].timelineMode, "free");
  assert.equal(findStateClip(after, "c").start, 480000, "Free mode keeps positions");
});

test("disabled timeline tools say what they need, also to keyboard and screen-reader users", async (t) => {
  const page = await fixture(t);
  const describe = (name) =>
    page.locator(`[data-et-action="${name}"]`).evaluate((node) => ({
      disabled: node.disabled,
      ariaDisabled: node.getAttribute("aria-disabled"),
      title: node.title,
      reason: node.getAttribute("aria-describedby")
        ? document.getElementById(node.getAttribute("aria-describedby"))?.textContent
        : undefined,
    }));
  // Split and delete stay focusable so their reason is announced.
  assert.deepEqual(await describe("split"), {
    disabled: false,
    ariaDisabled: "true",
    title: "切分 · S（先选择一个片段）",
    reason: "先选择一个片段",
  });
  assert.deepEqual(await describe("delete"), {
    disabled: false,
    ariaDisabled: "true",
    title: "删除 · ⌫（先选择片段）",
    reason: "先选择片段",
  });
  await page.locator('[data-et-action="split"]').focus();
  await page.keyboard.press("Enter");
  await page.locator('[data-et-action="split"]').dispatchEvent("click");
  await settle(page);
  assert.deepEqual((await state(page)).errors, [], "An unavailable action does nothing");
  assert.equal((await state(page)).applied.length, 0);
  assert.match((await describe("paste")).title, /先复制片段/);
  assert.match((await describe("group")).title, /至少选择两个片段/);
  await clickClip(page, "a");
  await clickClip(page, "b", "Shift");
  const split = await describe("split");
  assert.equal(split.ariaDisabled, null);
  assert.equal(split.reason, undefined);
  assert.equal((await describe("delete")).ariaDisabled, null);
  assert.equal((await describe("group")).disabled, false);
  assert.equal((await describe("group")).title, "分组 · ⌘/Ctrl G");
});

test("track creation buttons are named the same way", async (t) => {
  const page = await fixture(t);
  assert.deepEqual(
    await page.getByRole("group", { name: "添加轨道", exact: true }).locator("button").allTextContents(),
    ["新建画面轨", "新建声音轨", "新建文字轨"],
  );
});

test("tracks can be deleted from their header: empty at once, occupied after confirming, locked never", async (t) => {
  const page = await fixture(t);
  const trackIds = async () =>
    (await state(page)).document.sequences[0].tracks.map((track) => track.id);
  const before = (await state(page)).document;
  // v3 holds no clips: one click removes it as a single undoable step.
  await page.locator('[data-et-delete-track="v3"]').click();
  await settle(page);
  assert.deepEqual(await trackIds(), ["v1", "v2", "audio", "text"]);
  await undo(page, before);
  assert.deepEqual(await trackIds(), ["v1", "v2", "v3", "audio", "text"]);

  // v2 holds clip b: the header asks first and names how many clips go with it.
  await page.locator('[data-et-delete-track="v2"]').click();
  await settle(page);
  assert.deepEqual(await trackIds(), ["v1", "v2", "v3", "audio", "text"]);
  const confirm = page.locator('[data-track-head="v2"] [data-et-delete-confirm="v2"]');
  await confirm.waitFor();
  assert.match(await page.locator('[data-track-head="v2"]').innerText(), /1 个片段/);
  await page.locator('[data-track-head="v2"] [data-et-delete-cancel]').click();
  await settle(page);
  assert.equal(await confirm.count(), 0);
  assert.deepEqual(await trackIds(), ["v1", "v2", "v3", "audio", "text"]);

  await page.locator('[data-et-delete-track="v2"]').click();
  await page.locator('[data-track-head="v2"] [data-et-delete-confirm="v2"]').click();
  await settle(page);
  const after = (await state(page)).document.sequences[0];
  assert.deepEqual(after.tracks.map((track) => track.id), ["v1", "v3", "audio", "text"]);
  assert.equal(after.clips.some((clip) => clip.id === "b"), false);
  await undo(page, before);
  assert.equal((await state(page)).document.sequences[0].clips.some((clip) => clip.id === "b"), true);

  // A locked track explains why it cannot be deleted.
  await page.locator('[data-et-track="v3"][data-et-toggle="locked"]').click();
  await settle(page);
  const locked = page.locator('[data-et-delete-track="v3"]');
  assert.equal(await locked.isDisabled(), true);
  assert.match(await locked.getAttribute("title"), /锁定/);
});

test("track deletion asks again after reopening the same document generation", async (t) => {
  const page = await fixture(t);
  await page.locator('[data-et-delete-track="v2"]').click();
  await page.locator('[data-et-delete-confirm="v2"]').waitFor();
  await page.evaluate(() => fixture.replaceGeneration());
  assert.equal(await page.locator('[data-et-delete-confirm="v2"]').count(), 0);
  assert.equal((await state(page)).applied.length, 0);
  await page.locator('[data-et-delete-track="v2"]').click();
  await page.locator('[data-et-delete-confirm="v2"]').waitFor();
});

for (const change of ["revision", "generation"]) {
  test(`a retained track deletion confirmation cannot delete after a ${change} change`, async (t) => {
    const page = await fixture(t);
    await page.locator('[data-et-delete-track="v2"]').click();
    await page.locator('[data-et-delete-confirm="v2"]').waitFor();
    await page.evaluate((change) => {
      if (change === "generation") fixture.replaceGeneration(false);
      else fixture.externalChange();
    }, change);
    const before = (await state(page)).document;
    await page.locator('[data-et-delete-confirm="v2"]').click();
    await settle(page);
    assert.deepEqual((await state(page)).document, before);
    assert.equal((await state(page)).applied.length, 0);
    assert.equal(await page.locator('[data-et-delete-confirm="v2"]').count(), 0);
    await page.locator('[data-et-delete-track="v2"]').click();
    await page.locator('[data-et-delete-confirm="v2"]').waitFor();
    await page.locator('[data-et-delete-confirm="v2"]').click();
    await settle(page);
    assert.equal((await state(page)).document.sequences[0].tracks.some((track) => track.id === "v2"), false);
    await undo(page, before);
  });
}

test("track deletion confirmation belongs to its sequence even when track IDs are shared", async (t) => {
  const page = await fixture(t, { secondSequence: true });
  await page.locator('[data-et-delete-track="v2"]').click();
  await page.locator('[data-et-delete-confirm="v2"]').waitFor();
  await page.evaluate(() => fixture.switchSequence("secondary"));
  assert.equal(await page.locator('[data-et-delete-confirm="v2"]').count(), 0);
  assert.equal((await state(page)).applied.length, 0);
  await page.locator('[data-et-delete-track="v2"]').click();
  await page.locator('[data-et-delete-confirm="v2"]').waitFor();
  await page.evaluate(() => fixture.switchSequence("main"));
  assert.equal(await page.locator('[data-et-delete-confirm="v2"]').count(), 0);
});

test("the magnetic main track keeps its delete button disabled with a reason", async (t) => {
  const page = await fixture(t, { magnetic: true, magneticTrackId: "v1" });
  const button = page.locator('[data-et-delete-track="v1"]');
  assert.equal(await button.isDisabled(), true);
  assert.match(await button.getAttribute("title"), /磁吸主轨/);
  assert.equal(await page.locator('[data-et-delete-track="v3"]').isDisabled(), false);
});


test("audio fade handles edit only the chosen grouped clip with one undo and keep timeline timing", async (t) => {
  const page = await fixture(t, { magnetic: true, clips: [
    { id: "a", trackId: "v1", start: 0, duration: 2, groupId: "pair", linkGroupId: "pair" },
    { id: "b", trackId: "audio", start: 0, duration: 2, groupId: "pair", linkGroupId: "pair" },
    { id: "c", trackId: "v1", start: 2, duration: 2 },
  ] });
  await clip(page, "a").click(); await settle(page);
  const before = (await state(page)).document;
  const handle = clip(page, "a").locator('[data-et-fade="fadeIn"]');
  assert.equal(await handle.count(), 1);
  const p = await center(handle);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 32, p.y, { steps: 4 }); await settle(page);
  assert.match(await handle.getAttribute("aria-valuetext"), /0.500000/);
  await page.mouse.up(); await settle(page);
  const after = await state(page), expected = structuredClone(before);
  expected.revision++; expected.sequences[0].clips[0].audio.fadeIn = 120000;
  assert.deepEqual(after.document, expected);
  assert.equal(after.applied.length, 1); assert.equal(after.applied[0].label, "调整声音淡入");
  assert.deepEqual(after.errors, []);
  await undo(page, before);
});

test("audio fade out uses the final release coordinate and Escape restores its visual preview", async (t) => {
  const page = await fixture(t); await clip(page, "a").click(); await settle(page);
  const before = (await state(page)).document, handle = clip(page, "a").locator('[data-et-fade="fadeOut"]'), p = await center(handle);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x - 32, p.y); await settle(page);
  assert.match(await handle.getAttribute("aria-valuetext"), /0.500000/);
  await page.keyboard.press("Escape"); await page.mouse.up(); await settle(page);
  assert.deepEqual((await state(page)).document, before);
  await clip(page, "a").click(); await settle(page);
  const q = await center(clip(page, "a").locator('[data-et-fade="fadeOut"]'));
  await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.move(q.x - 16, q.y);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: q.x - 32, y: q.y, button: "left", buttons: 0 });
  await cdp.detach(); await settle(page);
  assert.equal((await state(page)).document.sequences[0].clips[0].audio.fadeOut, 120000);
  assert.deepEqual((await state(page)).errors, []); await undo(page, before);
});

test("audio fade keyboard boundaries use the actual NTSC frame clock and retain slider focus", async (t) => {
  const page = await fixture(t, { ntsc: true }); await clip(page, "a").click(); await settle(page);
  let handle = clip(page, "a").locator('[data-et-fade="fadeIn"]');
  await handle.focus(); await page.keyboard.press("ArrowRight"); await settle(page);
  assert.equal((await state(page)).document.sequences[0].clips[0].audio.fadeIn, 8008);
  assert.equal(await handle.evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press("Shift+ArrowRight"); await settle(page);
  assert.equal((await state(page)).document.sequences[0].clips[0].audio.fadeIn, 88088);
  handle = clip(page, "a").locator('[data-et-fade="fadeOut"]'); await handle.focus();
  await page.keyboard.press("ArrowLeft"); await settle(page);
  const after = await state(page); assert.equal(after.document.sequences[0].clips[0].audio.fadeOut, 7528);
  assert.deepEqual(after.errors, []);
  await page.keyboard.press("End"); await settle(page);
  assert.equal((await state(page)).document.sequences[0].clips[0].audio.fadeOut, 0);
});

test("audio fade controls reject old generations and locked tracks without editing", async (t) => {
  const page = await fixture(t); await clip(page, "a").click(); await settle(page);
  const stale = await clip(page, "a").locator('[data-et-fade="fadeIn"]').elementHandle(), before = (await state(page)).document;
  await page.evaluate(() => fixture.replaceGeneration());
  await stale.evaluate((node) => document.querySelector('[data-et-clip="a"]').append(node));
  await stale.focus(); await page.keyboard.press("ArrowRight"); await settle(page);
  assert.deepEqual((await state(page)).document, before);
  await page.evaluate(() => fixture.externalTrackEdit("v1", { locked: true })); await settle(page);
  const locked = clip(page, "a").locator('[data-et-fade="fadeIn"]');
  assert.equal(await locked.getAttribute("aria-disabled"), "true");
  const p = await center(locked); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 32, p.y); await page.mouse.up(); await settle(page);
  const after = await state(page); assert.equal(after.document.sequences[0].clips[0].audio.fadeIn, 0);
  assert.equal(after.applied.length, 0);
});

test("audio fade drags clamp to clip duration and repeating the boundary adds no undo", async (t) => {
  const page = await fixture(t); await clip(page, "a").click(); await settle(page);
  const before = (await state(page)).document;
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = await center(clip(page, "a").locator('[data-et-fade="fadeIn"]'));
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x + 200, p.y, { steps: 4 }); await page.mouse.up(); await settle(page);
    const result = await state(page);
    assert.equal(result.document.sequences[0].clips[0].audio.fadeIn, 480000);
    assert.equal(result.applied.length, 1);
    assert.deepEqual(result.errors, []);
  }
  await undo(page, before);
});

test("audio fade keyboard waits for apply and remains correctable after a rejected save", async (t) => {
  const page = await fixture(t); await clip(page, "a").click(); await settle(page);
  const before = (await state(page)).document, handle = clip(page, "a").locator('[data-et-fade="fadeIn"]');
  await handle.focus(); await page.evaluate(() => fixture.holdNextEdit());
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await settle(page);
  assert.equal(await handle.getAttribute("aria-busy"), "true");
  assert.deepEqual((await state(page)).document, before);
  await page.evaluate(() => fixture.finishEdit(true)); await settle(page);
  assert.deepEqual((await state(page)).document, before);
  assert.deepEqual((await state(page)).errors, ["Error: 保存失败"]);
  assert.equal(await handle.getAttribute("aria-busy"), "false");
  assert.equal(await handle.evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press("ArrowRight"); await settle(page);
  assert.equal((await state(page)).document.sequences[0].clips[0].audio.fadeIn, 8000);
  assert.equal((await state(page)).applied.length, 1);
  await undo(page, before);
});

test("audio fade handles support native touch and cancellation leaves no partial edit", async (t) => {
  const page = await fixture(t, { touch: true }); await clip(page, "a").click(); await settle(page);
  const before = (await state(page)).document, input = await touchInput(page, "#timeline");
  let p = { ...await center(clip(page, "a").locator('[data-et-fade="fadeIn"]')), id: 1 };
  await input.send("touchStart", [p]); await input.send("touchMove", [{ ...p, x: p.x + 32 }]);
  await input.send("touchEnd"); await settle(page); await input.assertNative();
  assert.equal((await state(page)).document.sequences[0].clips[0].audio.fadeIn, 120000);
  assert.equal((await state(page)).applied.length, 1);
  await undo(page, before);
  const afterUndo = (await state(page)).document;
  p = { ...await center(clip(page, "a").locator('[data-et-fade="fadeOut"]')), id: 2 };
  await input.send("touchStart", [p]); await input.send("touchMove", [{ ...p, x: p.x - 32 }]);
  await input.send("touchCancel"); await settle(page);
  assert.deepEqual((await state(page)).document, afterUndo);
  assert.deepEqual((await state(page)).errors, []);
  assert.equal((await page.evaluate(() => fixture.gestureState())).drag, false);
});
