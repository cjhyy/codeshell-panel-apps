import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { previewLocalPanelApp } from "@cjhyy/code-shell-core";

test("published Host accepts the complete download panel and verifies its native entry", async () => {
  const preview = await previewLocalPanelApp({
    kind: "dir",
    path: fileURLToPath(new URL("../../../apps/video-download", import.meta.url)),
  });
  assert.equal(preview.id, "video-download");
  assert.equal(preview.version, "0.19.2");
  assert.equal(preview.nativeEntries["download-library"].entry, "app/tools/library.mjs");
  for (const permission of ["process", "storage", "agent.task", "external.open"])
    assert.ok(preview.permissions.includes(permission));
});
