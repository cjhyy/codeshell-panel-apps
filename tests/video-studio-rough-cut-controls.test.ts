import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyOperations,
  createProject,
  validateProject,
  type Project,
} from "../apps/video-studio/src/model";
import {
  createRoughCutUI,
  parseRoughCutTime,
  roughCutTimecode,
} from "../apps/video-studio/src/rough-cut-ui";

function fixture() {
  let project = validateProject({
    ...createProject(),
    assets: [
      { id: "source-a", kind: "video", name: "原片 A.mp4", durationFrames: 900 },
      { id: "source-b", kind: "video", name: "原片 B.mp4", durationFrames: 600 },
      { id: "still", kind: "image", name: "静态照片", durationFrames: 90 },
    ],
  });
  let sourceId = "source-a",
    frame = 0;
  let changed = 0;
  let rejectEdits = false;
  const history: Project[] = [];
  const messages: string[] = [],
    downloads: { name: string; contents: string }[] = [];
  const plays: [number | undefined, number | undefined][] = [];
  const ui = createRoughCutUI({
    project: () => project,
    assetId: () => sourceId,
    frame: () => frame,
    playing: () => false,
    available: () => true,
    changed: () => {
      changed++;
    },
    edit: (ops) => {
      if (rejectEdits) throw new Error("请等待当前制作完成");
      history.push(structuredClone(project));
      project = applyOperations(project, ops, project.revision);
    },
    selectAsset: async (id) => {
      sourceId = id;
    },
    seek: async (next) => {
      frame = next;
    },
    play: async (start, end) => {
      plays.push([start, end]);
    },
    toast: (message) => {
      messages.push(message);
    },
    downloadCsv: (name, contents) => {
      downloads.push({ name, contents });
    },
  });
  const input = (field: string, value: string) =>
    ui.input({
      dataset: { roughcutField: field },
      value,
      setCustomValidity() {},
    } as unknown as HTMLInputElement);
  return {
    ui,
    input,
    project: () => project,
    undo: () => {
      project = validateProject({ ...history.pop()!, revision: project.revision + 1 });
    },
    rejectEdits: () => {
      rejectEdits = true;
    },
    frame: () => frame,
    setFrame: (next: number) => {
      frame = next;
    },
    setSource: (id: string) => {
      sourceId = id;
      ui.setAsset(id);
    },
    changed: () => changed,
    messages,
    downloads,
    plays,
  };
}

test("rough-cut time inputs round to frames and retain half-open endpoint precision", () => {
  for (const value of [0, 1, 29, 30, 1799, 1800, 108001])
    assert.equal(parseRoughCutTime(roughCutTimecode(value)), value);
  assert.equal(parseRoughCutTime("1.5"), 45);
  assert.equal(parseRoughCutTime("01:02.5"), 1875);
  assert.equal(parseRoughCutTime("01:02:03.5"), 111705);
  assert.equal(parseRoughCutTime("00:00:01:01"), 31);
  for (const value of ["", "-1", "1e9", "00:60:00:00", "00:00:00:30", "00:62", "oops"])
    assert.equal(parseRoughCutTime(value), undefined);
});

test("I/O retains the current O frame and successive saves add ranges instead of overwriting", async () => {
  const f = fixture();
  f.setFrame(30);
  await f.ui.action("roughcut-mark-in");
  f.setFrame(59);
  await f.ui.action("roughcut-mark-out");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 30, outFrame: 60 });
  await f.ui.action("roughcut-save");
  f.setFrame(90);
  await f.ui.action("roughcut-mark-in");
  f.setFrame(119);
  await f.ui.action("roughcut-mark-out");
  await f.ui.action("roughcut-save");
  assert.deepEqual(
    f.project().roughCuts!.map((cut) => [cut.inFrame, cut.outFrame]),
    [
      [30, 60],
      [90, 120],
    ],
  );
  const first = f.project().roughCuts![0]!;
  await f.ui.action("roughcut-select", first.id);
  f.input("name", "更精确的开场");
  f.input("out", "2.5");
  await f.ui.action("roughcut-save");
  assert.equal(f.project().roughCuts!.length, 2);
  assert.equal(f.project().roughCuts![0]!.outFrame, 75);
  assert.equal(f.project().roughCuts![0]!.name, "更精确的开场");
  assert.equal(f.project().clips.length, 0);
});

test("drafts are isolated by source and an explicit project reset clears same-id drafts", () => {
  const f = fixture();
  f.input("in", "3");
  f.input("out", "5");
  f.setSource("source-b");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 0, outFrame: 600 });
  f.input("in", "6");
  f.input("out", "8");
  f.setSource("source-a");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 90, outFrame: 150 });
  f.ui.setAsset("");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 0, outFrame: 900 });
  assert.equal(f.changed(), 0);
  assert.doesNotMatch(f.ui.render(), /<option value="still"/);
});

test("invalid bounds cannot save or preview; keyboard commands ignore editable controls", async () => {
  const f = fixture();
  f.input("in", "5");
  f.input("out", "3");
  assert.equal(f.ui.selectedRange(), undefined);
  await f.ui.action("roughcut-save");
  await f.ui.action("roughcut-preview");
  assert.equal((f.project().roughCuts ?? []).length, 0);
  assert.equal(f.plays.length, 0);
  const base = {
    key: "i",
    target: { closest: () => ({}) },
    preventDefault() {
      throw new Error("must not consume typing");
    },
  };
  assert.equal(f.ui.key(base as unknown as KeyboardEvent), false);
  assert.equal(await f.ui.action("split"), false);
  f.setFrame(0);
  await f.ui.action("roughcut-mark-in");
  f.setFrame(899);
  await f.ui.action("roughcut-mark-out");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 0, outFrame: 900 });
});

test("plus saves and source navigation seeks frame-by-frame without changing composition", () => {
  const f = fixture();
  const event = (key: string, shiftKey = false) =>
    ({ key, shiftKey, target: null, preventDefault() {} }) as unknown as KeyboardEvent;
  assert.equal(f.ui.key(event("+")), true);
  assert.equal(f.project().roughCuts!.length, 1);
  assert.equal(f.ui.key(event("ArrowRight")), true);
  assert.equal(f.frame(), 1);
  assert.equal(f.ui.key(event("ArrowRight", true)), true);
  assert.equal(f.frame(), 31);
  assert.equal(f.ui.key(event("ArrowLeft")), true);
  assert.equal(f.frame(), 30);
  assert.equal(f.project().clips.length, 0);
});

test("current-source export and append honor enabled list order", async () => {
  const f = fixture();
  f.input("in", "1");
  f.input("out", "2");
  await f.ui.action("roughcut-save");
  f.input("in", "3");
  f.input("out", "4");
  await f.ui.action("roughcut-save");
  const second = f.project().roughCuts![1]!;
  await f.ui.action("roughcut-up", second.id);
  await f.ui.action("roughcut-csv");
  assert.match(f.downloads[0]!.contents, /^"3","4"/);
  await f.ui.action("roughcut-append");
  assert.deepEqual(
    f.project().clips.map((clip) => [clip.inFrame, clip.outFrame]),
    [
      [90, 120],
      [30, 60],
    ],
  );
});

test("undo reloads a changed saved baseline even while a selection has an unapplied draft", async () => {
  const f = fixture();
  f.input("in", "1");
  f.input("out", "2");
  await f.ui.action("roughcut-save");
  await f.ui.action("roughcut-select", f.project().roughCuts![0]!.id);
  f.input("out", "3");
  await f.ui.action("roughcut-save");
  f.input("out", "4");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 30, outFrame: 120 });
  f.undo();
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 30, outFrame: 60 });
});

test("a rejected commit preserves the marked draft instead of advancing to a new range", async () => {
  const f = fixture();
  f.input("in", "1");
  f.input("out", "2");
  f.input("name", "保留这份草稿");
  f.rejectEdits();
  await f.ui.action("roughcut-save");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 30, outFrame: 60 });
  assert.match(f.ui.render(), /保留这份草稿/);
  assert.equal((f.project().roughCuts ?? []).length, 0);
});
