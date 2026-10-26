import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canvasMime,
  launchCanvasBrowser,
  metadata,
  observeLocalTools,
} from "./fixtures/canvas-test-observations.mjs";

const app = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const fixturePath = new URL("../../fixtures/design-studio-html2figma-json/native-production-export.v1.json", import.meta.url);
const originalBytes = await readFile(fixturePath);
const original = JSON.parse(originalBytes);
const digest = value => createHash("sha256").update(value).digest("hex");
assert.equal(originalBytes.length, 5743);
assert.equal(digest(originalBytes), "2f67d578a5c51c87d787ee71294c8f7565848cbd8d38a7f00df8ea3be5266739");

async function evidence(name, content) {
  if (!process.env.H2F_NATIVE_EXPORT_UI_EVIDENCE_DIR) return;
  const directory = resolve(process.env.H2F_NATIVE_EXPORT_UI_EVIDENCE_DIR);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, name), content, { flag: "wx" });
}

async function toolbarAction(page, selector) {
  if (await page.locator("#compact-actions").getAttribute("open") === null)
    await page.locator("#compact-actions summary").click();
  await page.locator(selector).click();
}

async function fixture(t) {
  const browser = await launchCanvasBrowser();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage(), errors = [], externalRequests = [], dialogs = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", async dialog => {
    dialogs.push({ type: dialog.type(), message: dialog.message(), accepted: false });
    await dialog.dismiss();
  });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url()), path = resolve(app, "." + url.pathname);
    if (url.origin !== "https://native-export-ui.test" || !path.startsWith(app + sep)) {
      externalRequests.push(route.request().url());
      return route.abort();
    }
    try { await route.fulfill({ body: await readFile(path), contentType: canvasMime[extname(path)] }); }
    catch { await route.fulfill({ status: 404, body: "missing" }); }
  });
  await observeLocalTools(page);
  await page.goto("https://native-export-ui.test/index.html");
  await page.waitForFunction(() => !document.querySelector(".workspace").inert);

  async function choose(bytes = originalBytes) {
    await toolbarAction(page, "#open-figma-workflow");
    await page.locator("#figma-import-file").setInputFiles({
      name: "native-production-export.v1.json", mimeType: "application/json", buffer: bytes,
    });
    await page.waitForFunction(() => document.querySelector("#figma-workflow-dialog").getAttribute("aria-busy") === "false");
  }
  async function importOriginal(path) {
    await choose();
    assert.match(await page.locator("#figma-import-preview").textContent(), /2 个可编辑图层.*0 个跳过图层/u);
    assert.match(await page.locator("#figma-import-warnings").textContent(), /Native manual FRAME strokesIncludedInLayout=false/u);
    assert.equal(await page.locator("#figma-import-apply").isDisabled(), false);
    await page.locator("#figma-import-mode").selectOption("create");
    await page.locator("#figma-import-target").fill(path);
    await page.locator("#figma-import-apply").click();
    await page.waitForFunction(() => document.querySelector("#figma-workflow-status").textContent.includes("已导入 2 个图层"));
    await page.locator("#figma-workflow-close").click();
    assert.equal(await page.locator("#document-path").inputValue(), path);
    assert.equal((await metadata(page)).layers.length, 2);
  }
  async function backup() {
    await toolbarAction(page, "#portable-backup-open");
    const [download] = await Promise.all([
      page.waitForEvent("download"), page.locator("#portable-backup-export").click(),
    ]);
    const bytes = await readFile(await download.path());
    await page.keyboard.press("Escape");
    return { bytes, value: JSON.parse(bytes) };
  }
  return { page, errors, externalRequests, dialogs, choose, importOriginal, backup };
}

async function idbFileRecords(page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some(database => database.name === "codeshell-design-studio-v1"))
      throw Error("The actual browser database does not exist");
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("codeshell-design-studio-v1", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction("records", "readonly");
        const read = transaction.objectStore("records").getAll();
        let rows;
        read.onsuccess = () => { rows = read.result; };
        transaction.oncomplete = () => { db.close(); resolve(rows.filter(row => row.key.startsWith("file:") && !row.deleted)); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    });
  });
}

function assertOriginalBackup(backup, target) {
  assert.equal(backup.format, "codeshell.design.portable-backup");
  assert.equal(backup.version, 2);
  assert.equal(backup.source.path, target);
  assert.equal(backup.document.pages.length, 1);
  assert.equal(backup.document.pages[0].children.length, 1);
  const root = backup.document.pages[0].children[0], child = root.children[0];
  assert.equal(root.children.length, 1);
  assert.deepEqual([root.type, root.x, root.y, root.width, root.height, root.clipContent], ["frame", 1060, 0, 160, 80, false]);
  assert.deepEqual([child.type, child.x, child.y, child.width, child.height, child.fill], ["rectangle", 1200, 20, 60, 30, "#ff0000"]);
  assert.equal(child.x + child.width - root.x - root.width, 40);
  assert.deepEqual(backup.document.resources, []);
  assert.deepEqual(backup.resources, []);
  assert.equal(backup.attachments.length, 1);
  const attachment = backup.attachments[0];
  assert.equal(attachment.kind, "figma-binding");
  assert.equal(attachment.bytes, Buffer.byteLength(attachment.content));
  assert.equal(attachment.sha256, digest(attachment.content));
  const binding = JSON.parse(attachment.content);
  assert.deepEqual(binding.baseline, backup.document);
  assert.deepEqual(binding.source.exportReport, original.exportReport);
  const sourceRoots = Object.values(binding.source.nodes).map(entry => entry.document);
  assert.equal(sourceRoots.length, 1);
  const compareOriginal = (expected, actual) => {
    for (const [key, value] of Object.entries(expected)) {
      if (key === "children") {
        assert.equal(actual.children.length, value.length);
        value.forEach((node, index) => compareOriginal(node, actual.children[index]));
      } else assert.deepEqual(actual[key], value, "retained source field " + key);
    }
  };
  compareOriginal(original.nodes[0], sourceRoots[0]);
  assert.deepEqual(binding.mapping.map(entry => [entry.sourceId, entry.designId]).sort(),
    [["106:6433", root.id], ["106:6434", child.id]]);
  return attachment;
}

test("actual native export standard UI saves to IndexedDB, opens blank, and reopens with byte-exact complete backup", async t => {
  const f = await fixture(t), target = "designs/native-export-ui-portable.codesign.json";
  await f.importOriginal(target);
  await toolbarAction(f.page, "#save");
  await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存");
  assert.equal((await metadata(f.page)).dirty, false);
  const saved = await f.backup(), attachment = assertOriginalBackup(saved.value, target);
  const records = await idbFileRecords(f.page), principal = records.find(row => row.key === "file:" + target);
  assert.ok(principal, "the real IndexedDB records store must contain the principal design");
  assert.equal(JSON.parse(principal.content).format, "codeshell.design");
  assert.ok(principal.modifiedAt > 0 && typeof principal.revision === "string");
  assert.ok(records.some(row => row.key === `file:designs/codesign-data/figma/${attachment.sha256}.json` && row.content === attachment.content),
    "the complete source attachment must actually be present in IndexedDB");

  await f.page.locator("#open-files").click();
  await f.page.locator("#new-document").click();
  await f.page.waitForFunction(async () => (await window.tools.get_design_metadata()).layers.length === 0);
  assert.equal(await f.page.locator("#document-path").inputValue(), "designs/untitled.codesign.json");
  assert.equal((await metadata(f.page)).dirty, true, "the genuinely new blank has pending input before file switching flushes it");
  await f.page.locator("#open-files").click();
  await f.page.locator("#files-list .file-row").filter({ hasText: target }).click();
  await f.page.waitForFunction(async target => {
    const metadata = await window.tools.get_design_metadata();
    return !document.querySelector(".workspace").inert && document.querySelector("#document-path").value === target &&
      metadata.layers.length === 2 && metadata.dirty === false && document.querySelector("#repo-link-state").textContent.includes("已打开");
  }, target);
  assert.deepEqual(f.dialogs, [], "normal file switching saves the pending blank without a discard prompt");
  const blank = (await idbFileRecords(f.page)).find(row => row.key === "file:designs/untitled.codesign.json");
  assert.ok(blank, "file switching must actually save the previous pending blank in IndexedDB");
  assert.ok(blank.modifiedAt > 0 && typeof blank.revision === "string");
  assert.deepEqual(JSON.parse(blank.content).pages.flatMap(page => page.children), []);
  const reopened = await f.backup();
  assertOriginalBackup(reopened.value, target);
  assert.deepEqual(reopened.value, saved.value, "all portable fields, resources, binding and report must survive normal UI reopen");
  assert.deepEqual(reopened.bytes, saved.bytes, "the complete downloaded backup must remain byte exact");
  assert.deepEqual((await idbFileRecords(f.page)).find(row => row.key === "file:" + target), principal,
    "opening must not rewrite the saved principal revision, mtime or bytes");
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.externalRequests, []);
  assert.deepEqual(await readFile(fixturePath), originalBytes);
  await evidence("saved.complete-backup.json", saved.bytes);
  await evidence("reopened.complete-backup.json", reopened.bytes);
  await evidence("save-reopen.json", JSON.stringify({ originalBytes: originalBytes.length, originalSha256: digest(originalBytes),
    savedSha256: digest(saved.bytes), reopenedSha256: digest(reopened.bytes), completeBackupByteEqual: true, nodes: 2,
    sourceReportExact: true, indexedDbPrincipal: { bytes: Buffer.byteLength(principal.content), revision: principal.revision, modifiedAt: principal.modifiedAt },
    attachmentSha256: attachment.sha256, dialogs: f.dialogs, errors: f.errors, externalRequests: f.externalRequests,
    scope: "isolated Chromium formal test; not the pending IAB reopen receipt" }, null, 2) + "\n");
});

test("partial native export is refused by standard file import without changing existing canvas or source backup", async t => {
  const f = await fixture(t), target = "designs/native-export-ui-existing.codesign.json";
  await f.importOriginal(target);
  const before = await metadata(f.page), backupBefore = await f.backup(), filesBefore = await idbFileRecords(f.page);
  const partial = structuredClone(original);
  partial.exportReport.ready = false;
  partial.exportReport.partial = true;
  partial.exportReport.errors.push({ code: "NATIVE_EXPORT_FAILED", path: "nodes[0]", message: "Native export is incomplete" });
  await f.choose(Buffer.from(JSON.stringify(partial)));
  assert.equal(await f.page.locator("#figma-import-apply").isDisabled(), true);
  assert.match(await f.page.locator("#figma-workflow-status").textContent(), /原生导出不完整/u);
  await f.page.locator("#figma-workflow-close").click();
  assert.deepEqual(await metadata(f.page), before, "nodes, page, selection, dirty state and state revision must remain unchanged");
  const backupAfter = await f.backup();
  assert.deepEqual(backupAfter.bytes, backupBefore.bytes, "failed preparation must preserve every source/report/backup byte");
  assert.deepEqual(await idbFileRecords(f.page), filesBefore, "partial input must not publish source or design files");
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.dialogs, []);
  assert.deepEqual(f.externalRequests, []);
  assert.deepEqual(await readFile(fixturePath), originalBytes);
  await evidence("partial-refusal.json", JSON.stringify({ nodes: before.layers.length, metadataExact: true,
    backupByteEqual: true, fileRecordsUnchanged: true, originalSha256: digest(originalBytes), errors: f.errors }, null, 2) + "\n");
});
