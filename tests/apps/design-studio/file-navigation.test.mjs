import assert from "node:assert/strict";
import { test } from "node:test";
import { designFileName, recentDesignPaths, rememberDesignPath, visibleDesignFiles } from "../../../apps/design-studio/app/file-navigation.mjs";

const files = [
  { path: "designs/archive/首页.codesign.json", modifiedAt: 40 },
  { path: "designs/home.codesign.json", modifiedAt: 30 },
  { path: "designs/首页.codesign.json", modifiedAt: 10 },
];

test("file navigation distinguishes equal basenames by the searchable full path", () => {
  assert.equal(designFileName(files[0].path), "首页");
  assert.deepEqual(visibleDesignFiles(files, { query: "首页" }).map((f) => f.path), [files[0].path, files[2].path]);
  assert.deepEqual(visibleDesignFiles(files, { query: " archive/ " }).map((f) => f.path), [files[0].path]);
  assert.equal(visibleDesignFiles(files, { query: "HOME" })[0], files[1]);
});

test("current and recently opened files precede modified-time fallback without mutating inventory", () => {
  const snapshot = structuredClone(files);
  assert.deepEqual(visibleDesignFiles(files, { activePath: files[1].path, recent: [files[2].path] }).map((f) => f.path), [files[1].path, files[2].path, files[0].path]);
  assert.deepEqual(files, snapshot);
});

test("recents are bounded, deduplicated, validated, and move reopened files to the front", () => {
  const many = Array.from({ length: 20 }, (_, i) => `designs/${i}.codesign.json`);
  assert.equal(recentDesignPaths(many).length, 12);
  assert.deepEqual(recentDesignPaths([null, "../bad.codesign.json", "/private/file.codesign.json", "designs/a.codesign.json", "designs/a.codesign.json"]), ["designs/a.codesign.json"]);
  assert.deepEqual(rememberDesignPath(many, many[5]), [many[5], ...many.filter((p) => p !== many[5]).slice(0, 11)]);
});

test("stale recents do not invent missing files and duplicate inventory rows remain unique", () => {
  assert.deepEqual(visibleDesignFiles([...files, files[0], { path: "../bad.codesign.json" }], { recent: ["designs/missing.codesign.json"] }), files);
  assert.deepEqual(visibleDesignFiles(files, { query: "missing" }), []);
});
