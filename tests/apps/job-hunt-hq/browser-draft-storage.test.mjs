import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserDraftStorage } from "../../../apps/job-hunt-hq/app/browser-draft-storage.mjs";

test("security denial uses a page-local buffer with an explicit non-persistent flag", () => {
  const denied = () => { throw new DOMException("opaque origin", "SecurityError"); };
  const a = createBrowserDraftStorage(denied), b = createBrowserDraftStorage(denied);
  assert.equal(a.persistent, false);
  a.storage.setItem("owner.writer", "pending input");
  assert.equal(a.storage.key(0), "owner.writer");
  assert.equal(a.storage.getItem("owner.writer"), "pending input");
  assert.equal(b.storage.getItem("owner.writer"), null, "another page cannot claim to recover an ephemeral draft");
  const contentsDenied = createBrowserDraftStorage(() => ({ get length() { return denied(); } }));
  assert.equal(contentsDenied.persistent, false);
});

test("available storage is passed through untouched and unrelated read errors are not hidden", () => {
  const storage = { length: 2 };
  assert.deepEqual(createBrowserDraftStorage(() => storage), { storage, persistent: true });
  assert.throws(() => createBrowserDraftStorage(() => { throw new Error("damaged storage"); }), /damaged/);
});
