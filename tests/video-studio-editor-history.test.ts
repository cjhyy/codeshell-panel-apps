import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoProject } from "../apps/video-studio/src/model";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { EditorHistory } from "../apps/video-studio/src/editor/history";

test("undo and redo restore full content while revisions stay monotonic for stale AI protection", () => {
  const original = migrateLegacyProject(createDemoProject());
  const history = new EditorHistory(original);
  history.apply([{ type: "project.rename", name: "用户修改" }], 0);
  assert.equal(history.read().name, "用户修改");
  assert.equal(history.revision, 1);
  const restored = history.undo();
  assert.equal(restored.name, original.name);
  assert.equal(restored.revision, 2);
  assert.throws(() => history.apply([{ type: "project.rename", name: "过期 AI" }], 0));
  assert.throws(() => history.apply([{ type: "project.rename", name: "过期 AI" }], 1));
  assert.equal(history.read().name, original.name);
  assert.equal(history.redo().name, "用户修改");
  assert.equal(history.revision, 3);
});

test("failed batches preserve history and new edits after undo discard only redo", () => {
  const history = new EditorHistory(migrateLegacyProject(createDemoProject()));
  history.apply([{ type: "project.rename", name: "第一步" }], 0);
  assert.throws(() =>
    history.apply(
      [
        { type: "project.rename", name: "半完成批次" },
        { type: "project.rename", name: "" },
      ],
      1,
    ),
  );
  assert.equal(history.read().name, "第一步");
  assert.equal(history.revision, 1);
  history.undo();
  assert.equal(history.canRedo, true);
  history.apply([{ type: "project.rename", name: "另一条修改" }], 2, "改标题", "agent");
  assert.equal(history.canRedo, false);
  assert.equal(history.canUndo, true);
  assert.equal(history.redo().name, "另一条修改");
});

test("caller mutation cannot corrupt snapshots and bounded history retains newest receipts", () => {
  const original = migrateLegacyProject(createDemoProject());
  const history = new EditorHistory(original, 2);
  original.name = "外部篡改";
  const copy = history.read();
  copy.sequences[0]!.clips.length = 0;
  assert.notEqual(history.read().name, original.name);
  assert.ok(history.read().sequences[0]!.clips.length > 0);
  for (let index = 0; index < 3; index++)
    history.apply([{ type: "project.rename", name: `版本${index}` }], history.revision);
  assert.equal(history.undo().name, "版本1");
  assert.equal(history.undo().name, "版本0");
  assert.equal(history.canUndo, false);
  assert.equal(history.undo().name, "版本0");
});

test("empty batch does not erase redo and invalid replacement leaves the active project intact", () => {
  const history = new EditorHistory(migrateLegacyProject(createDemoProject()));
  history.apply([{ type: "project.rename", name: "更新" }], 0);
  history.undo();
  history.apply([], history.revision);
  assert.equal(history.canRedo, true);
  const before = history.read();
  assert.throws(() => history.replace({ ...before, activeSequenceId: "missing" }));
  assert.deepEqual(history.read(), before);
  const other = migrateLegacyProject(createDemoProject());
  history.replace(other);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  assert.deepEqual(history.read(), other);
});
