import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { fixture, initialPath, secondPath, source } from "./autosave-ui.fixture.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createDesignResourcePersistencePlan } from "../../../apps/design-studio/app/resource-store.mjs";

const savedName = (f, path = initialPath, scope = "/project/A") => JSON.parse(f.files.get(`${scope}:${path}`)).name;

test("ordinary editing saves the principal automatically and reopens without clicking Save", async t => {
  const f = await fixture(t);
  await f.rename("Autosaved first");
  await assert.doesNotReject(async () => {
    await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存", undefined, { timeout: 3000 });
    assert.equal(savedName(f), "Autosaved first");
  });
  await f.page.reload(); await f.page.waitForFunction(() => !document.querySelector(".workspace").inert);
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "Autosaved first");
  assert.deepEqual(f.errors, []);
});

test("switching immediately flushes edits before opening the other file without a discard dialog", async t => {
  const f = await fixture(t); await f.rename("Immediate latest"); await f.switchFile(secondPath);
  await f.page.waitForFunction(path => document.querySelector("#document-path").value === path, secondPath, { timeout: 2500 });
  assert.equal(savedName(f), "Immediate latest"); assert.deepEqual(f.dialogs, []); assert.deepEqual(f.errors, []);
});

test("a switch waits for edits made during an in-flight save and persists the latest version", async t => {
  const f = await fixture(t), hold = f.pauseWrite();
  await f.rename("Captured first"); await f.page.keyboard.press("Control+s"); await hold.entered;
  await f.rename("Newer while saving"); await f.switchFile(secondPath); hold.release();
  await f.page.waitForFunction(path => document.querySelector("#document-path").value === path, secondPath, { timeout: 2500 });
  assert.equal(savedName(f), "Newer while saving"); assert.deepEqual(f.dialogs, []); assert.deepEqual(f.errors, []);
});

test("failed automatic save keeps the current draft, blocks the switch, and retries through Save", async t => {
  const f = await fixture(t); f.denyWrites(); await f.rename("Retained draft"); await f.switchFile(secondPath);
  await f.page.waitForFunction(() => /保存失败/u.test(document.querySelector("#save-state").textContent), undefined, { timeout: 2500 });
  assert.equal(await f.page.locator("#document-path").inputValue(), initialPath);
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "Retained draft");
  assert.equal(savedName(f), "First"); assert.deepEqual(f.dialogs, []);
  f.denyWrites(false);
  if (await f.page.locator("#files-dialog").evaluate(dialog => dialog.open))
    await f.page.locator("#files-dialog .dialog-close").click();
  await f.page.keyboard.press("Control+s");
  await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存");
  assert.equal(savedName(f), "Retained draft"); await f.switchFile(secondPath);
  await f.page.waitForFunction(path => document.querySelector("#document-path").value === path, secondPath);
  assert.deepEqual(f.errors, []);
});

test("a pending autosave never sends the old draft to a replacement project", async t => {
  const f = await fixture(t); await f.rename("Only project A");
  await f.page.evaluate(() => window.switchAutosaveProject("/project/B"));
  await f.page.waitForFunction(() => !document.querySelector(".workspace").inert);
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal(f.calls.some(call => call.scope === "/project/B" && call.method === "workspace.writeText" && call.content.includes("Only project A")), false);
  assert.equal(savedName(f), "First"); assert.deepEqual(f.errors, []);
});

test("the first unsaved document remains create-only and cannot replace an existing default file", async t => {
  const f = await fixture(t, { blank: true });
  const original = source("Existing default"); f.files.set("/project/A:designs/design.codesign.json", original);
  await f.rename("New draft cannot overwrite");
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal(f.files.get("/project/A:designs/design.codesign.json"), original);
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "New draft cannot overwrite");
  assert.deepEqual(f.errors, []);
});

test("a manually changed save path is never used by automatic editing", async t => {
  const f = await fixture(t);
  if (!await f.page.locator("#document-path").isVisible())
    await f.page.locator("#compact-actions summary").click();
  await f.page.locator("#document-path").fill("designs/manual-target.codesign.json");
  await f.page.locator("#document-path").dispatchEvent("change"); await f.rename("Explicit Save As needed");
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal(f.files.has("/project/A:designs/manual-target.codesign.json"), false);
  assert.equal(savedName(f), "First"); assert.deepEqual(f.errors, []);
});

test("a new draft with a manually changed path waits for explicit Save confirmation", async t => {
  const f = await fixture(t, { blank: true });
  if (!await f.page.locator("#document-path").isVisible())
    await f.page.locator("#compact-actions summary").click();
  await f.page.locator("#document-path").fill("designs/new-manual-target.codesign.json");
  await f.page.locator("#document-path").dispatchEvent("change"); await f.rename("Unconfirmed new destination");
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal(f.files.has("/project/A:designs/new-manual-target.codesign.json"), false);
  await f.page.keyboard.press("Control+s");
  await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存");
  assert.equal(savedName(f, "designs/new-manual-target.codesign.json"), "Unconfirmed new destination");
  assert.deepEqual(f.errors, []);
});

test("browser-only ordinary edits automatically create the principal and survive reload", async t => {
  const f = await fixture(t, { browserOnly: true }); await f.rename("Browser autosaved draft");
  await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存", undefined, { timeout: 3000 });
  await f.page.reload(); await f.page.waitForFunction(() => !document.querySelector(".workspace").inert);
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "Browser autosaved draft");
  assert.deepEqual(f.errors, []);
});

test("an old in-flight autosave receipt cannot affect a replacement project", async t => {
  const f = await fixture(t), hold = f.pauseWrite(); await f.rename("Captured project A only");
  let deadline;
  try { await Promise.race([hold.entered, new Promise((_, reject) => { deadline = setTimeout(() => reject(Error("automatic save did not reach principal write")), 3000); })]); }
  finally { clearTimeout(deadline); }
  await f.page.evaluate(() => window.switchAutosaveProject("/project/B")); hold.release();
  await f.page.waitForFunction(() => !document.querySelector(".workspace").inert);
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(f.calls.some(call => call.scope === "/project/B" &&
    ((call.method === "workspace.writeText" && call.content.includes("Captured project A only")) ||
      (call.method === "workspace.readText" && call.path === initialPath))), false);
  assert.notEqual(await f.page.locator("#prop-document-name").inputValue(), "Captured project A only");
  assert.equal(savedName(f), "Captured project A only"); assert.deepEqual(f.errors, []);
});

test("undo back to the initial blank still autosaves after a first file baseline exists", async t => {
  const f = await fixture(t, { blank: true }), path = "designs/design.codesign.json";
  const originalName = await f.page.locator("#prop-document-name").inputValue();
  await f.rename("First autosaved name");
  await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存", undefined, { timeout: 3000 });
  assert.equal(savedName(f, path), "First autosaved name");
  await f.page.locator(".brand").click(); await f.page.keyboard.press("Control+z");
  await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存", undefined, { timeout: 3000 });
  assert.equal(savedName(f, path), originalName); assert.deepEqual(f.errors, []);
});

test("an identical competing create is never adopted as an automatic file baseline", async t => {
  const f = await fixture(t, { blank: true }), path = "designs/design.codesign.json";
  f.collideNextCreate(); await f.rename("Concurrent identical draft");
  await f.page.waitForFunction(() => /已保存|保存失败/u.test(document.querySelector("#save-state").textContent), undefined, { timeout: 3000 });
  const original = f.files.get(`/project/A:${path}`); assert.equal(JSON.parse(original).name, "Concurrent identical draft");
  await f.rename("Must not overwrite the competing creator");
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal(f.files.get(`/project/A:${path}`), original);
  assert.match(await f.page.locator("#save-state").textContent(), /保存失败/u); assert.deepEqual(f.errors, []);
});

async function latestRecovery(f, name) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const entry = [...f.records].find(([, value]) => value?.record && value.figmaBinding === null &&
      value.record.operations.some(operation => operation.type === "set-document" && operation.field === "name" && operation.after === name));
    if (entry) return entry;
    assert.ok(Date.now() < deadline, "the latest unsaved recovery must reach Host storage");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test("finishing a resource load never deletes edits made while opening the file", { timeout: 12000 }, async t => {
  const f = await fixture(t);
  const resource = await createDesignResourcePersistencePlan({
    id: "open-asset", kind: "image", mime: "image/png",
    base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    sha256Bytes: async bytes => createHash("sha256").update(bytes).digest("hex"),
  });
  const document = JSON.parse(source("Second with resource"));
  document.resources = [resource.descriptor];
  document.pages[0].children = [{ id: "asset-node", type: "image", name: "Asset", x: 0, y: 0,
    width: 20, height: 20, strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0,
    fill: "#000000", stroke: "transparent", visible: true, locked: false,
    imageRef: resource.descriptor.id, objectFit: "contain" }];
  const original = serializeDesignDocument(normalizeDesignDocument(document));
  f.files.set(`/project/A:${secondPath}`, original);
  for (const part of resource.parts) f.files.set(`/project/A:${part.path}`, part.content);
  const hold = f.pauseCall("workspace.readText", params => params.path === resource.parts[0].path);
  await f.switchFile(secondPath); await hold.entered; await f.page.keyboard.press("Escape");
  f.denyWrites(); await f.rename("Newer edit while resources load");
  await f.page.waitForFunction(() => /自动保存失败/u.test(document.querySelector("#save-state").textContent), undefined, { timeout: 3000 });
  const [key, recovery] = await latestRecovery(f, "Newer edit while resources load");
  const expected = structuredClone(recovery); hold.release();
  await f.page.waitForFunction(() => !document.querySelector("#files-list").hasAttribute("aria-busy"));
  assert.deepEqual(f.records.get(key), expected, "completion must retain the newer unsaved recovery journal");
  assert.equal(await f.page.locator("#document-path").inputValue(), secondPath);
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "Newer edit while resources load");
  assert.equal(f.files.get(`/project/A:${secondPath}`), original); assert.deepEqual(f.errors, []);
});

test("a late open receipt cannot clear the replacement document's recovery journal", { timeout: 12000 }, async t => {
  const f = await fixture(t);
  const hold = f.pauseCall("storage.set", params => params.key.startsWith("lastPath."));
  await f.switchFile(secondPath); await hold.entered;
  f.denyWrites(); await f.page.locator("#new-document").click(); await f.rename("Replacement draft after open");
  await f.page.waitForFunction(() => /自动保存失败/u.test(document.querySelector("#save-state").textContent), undefined, { timeout: 3000 });
  const [key, recovery] = await latestRecovery(f, "Replacement draft after open");
  const expected = structuredClone(recovery); hold.release();
  await f.page.waitForFunction(() => !document.querySelector("#files-list").hasAttribute("aria-busy"));
  assert.deepEqual(f.records.get(key), expected, "the older open must not clear a replacement document's draft");
  assert.equal(await f.page.locator("#document-path").inputValue(), "designs/untitled.codesign.json");
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "Replacement draft after open");
  assert.match(await f.page.locator("#save-state").textContent(), /自动保存失败/u); assert.deepEqual(f.errors, []);
});
