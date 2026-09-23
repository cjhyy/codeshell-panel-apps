import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

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
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 } }),
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
      "\nbody{display:block;margin:0;padding:16px;overflow:auto;background:#202124}#timeline{width:1140px}#undo,#redo,#outside{margin:14px 6px 0 0}",
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
    const history = new editor.EditorHistory(doc);
    let selection = [],
      time = 0,
      generation = 1,
      timeline;
    const applied = [],
      errors = [];
    timeline = new editor.EditorTimeline(document.querySelector("#timeline"), {
      read: () => history.read(),
      identity: () => ({ documentId: doc.id, revision: history.revision, generation }),
      selection: () => ({ sequenceId: "main", clipIds: [...selection] }),
      // Selection alone is parent view state; the component owns its own render lifecycle.
      select: (ids) => {
        selection = [...ids];
      },
      time: () => time,
      seek: (value) => {
        time = value;
        timeline.updatePlayhead();
      },
      apply: (operations, label) => {
        const before = history.revision;
        history.apply(operations, before, label);
        applied.push({
          operations: structuredClone(operations),
          label,
          before,
          after: history.revision,
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
        errors: [...errors],
      }),
      externalChange: () => {
        history.apply([{ type: "project.rename", name: "外部更新" }], history.revision);
      },
      replaceGeneration: () => {
        generation++;
        timeline.render();
      },
      dispose: () => timeline.dispose(),
    };
  }, options);
  return page;
}
async function state(page) {
  return page.evaluate(() => fixture.read());
}
async function settle(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
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
  assert.equal(split.ariaDisabled, "true");
  assert.equal(split.reason, "一次只能切分一个片段");
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
