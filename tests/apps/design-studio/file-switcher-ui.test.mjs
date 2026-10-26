import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fixture, initialPath, secondPath, source } from "./autosave-ui.fixture.mjs";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createDesignIndexPersistencePlan } from "../../../apps/design-studio/app/document-index.mjs";
import { createDesignResourcePersistencePlan } from "../../../apps/design-studio/app/resource-store.mjs";

async function setup(t) {
  const sourceOverrides = new Map();
  if (process.env.DESIGN_STUDIO_FILE_SWITCH_OLD_ROOT) {
    for (const name of ["index.html", "app.js", "style.css"]) sourceOverrides.set(name,
      await readFile(`${process.env.DESIGN_STUDIO_FILE_SWITCH_OLD_ROOT}/${name}`, "utf8"));
  }
  return fixture(t, { sourceOverrides });
}

test("creating a new design flushes the current edit without a discard prompt", async t => {
  const f = await setup(t);
  await f.rename("Saved before creating another design");
  await f.page.locator("#open-files").click();
  await f.page.locator("#new-document").click();
  await f.page.waitForFunction(() => document.querySelector("#document-path").value === "designs/untitled.codesign.json", undefined, { timeout: 3000 });
  assert.equal(JSON.parse(f.files.get(`/project/A:${initialPath}`)).name, "Saved before creating another design");
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "Untitled");
  assert.deepEqual(f.dialogs, []);
  assert.deepEqual(f.errors, []);
});

test("a failed save blocks new design creation and preserves the current draft", async t => {
  const f = await setup(t);
  f.denyWrites();
  await f.rename("Keep this draft if creation cannot save it");
  await f.page.locator("#open-files").click();
  await f.page.locator("#new-document").click();
  await f.page.waitForFunction(() => document.querySelector("#file-switch-status")?.dataset.kind === "error", undefined, { timeout: 3000 });
  assert.equal(await f.page.locator("#document-path").inputValue(), initialPath);
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "Keep this draft if creation cannot save it");
  assert.equal(JSON.parse(f.files.get(`/project/A:${initialPath}`)).name, "First");
  assert.equal(await f.page.locator("#files-dialog").evaluate(el => el.open), true);
  assert.deepEqual(f.dialogs, []);
  assert.deepEqual(f.errors, []);
});

test("the filename opens a focused searchable picker that disambiguates paths and switches by keyboard", async t => {
  const f = await setup(t);
  const archivedPath = "designs/archive/second.codesign.json";
  f.files.set(`/project/A:${archivedPath}`, source("Archived second"));
  await f.page.locator("#open-files").click();
  const search = f.page.getByRole("searchbox", { name: "搜索设计文件" });
  await search.waitFor({ state: "visible", timeout: 1500 });
  assert.equal(await search.evaluate(el => el === document.activeElement), true);
  await search.fill("SECOND");
  assert.equal(await f.page.locator("#files-list .file-row").count(), 2);
  await search.fill("archive/");
  assert.equal(await f.page.locator("#files-list .file-row").count(), 1);
  assert.match(await f.page.locator("#files-list").innerText(), /designs\/archive\/second.codesign.json/);
  await search.press("ArrowDown");
  await f.page.keyboard.press("Enter");
  await f.page.waitForFunction(path => document.querySelector("#document-path").value === path, archivedPath);
  assert.equal(await f.page.locator("#files-dialog").evaluate(el => el.open), false);
  assert.equal(await f.page.locator("#document-title").innerText(), "second");
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "Archived second");
  assert.deepEqual(f.errors, []);
});

test("a failed open keeps the picker and current design, then permits the same row to retry", async t => {
  const f = await setup(t);
  f.files.set(`/project/A:${secondPath}`, "invalid design JSON");
  await f.page.locator("#open-files").click();
  await f.page.locator("#files-list .file-row").filter({ hasText: secondPath }).click();
  await f.page.waitForFunction(() => document.querySelector("#file-switch-status")?.dataset.kind === "error", undefined, { timeout: 2000 });
  assert.equal(await f.page.locator("#files-dialog").evaluate(el => el.open), true);
  assert.equal(await f.page.locator("#document-path").inputValue(), initialPath);
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "First");
  f.files.set(`/project/A:${secondPath}`, source("Second corrected"));
  await f.page.locator("#files-list .file-row").filter({ hasText: secondPath }).click();
  await f.page.waitForFunction(path => document.querySelector("#document-path").value === path, secondPath);
  assert.equal(await f.page.locator("#files-dialog").evaluate(el => el.open), false);
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "Second corrected");
  assert.deepEqual(f.errors, []);
});

test("a rejected font while switching files restores the saved design and allows the same file row to retry", async t => {
  const f = await setup(t);
  const resource = await createDesignResourcePersistencePlan({
    id: "rejected-font", kind: "font", mime: "font/woff2", family: "Rejected font",
    weight: 400, style: "normal",
    base64: Buffer.from("stable invalid font decoder input").toString("base64"),
    sha256Bytes: async value => createHash("sha256").update(value).digest("hex"),
  });
  const target = JSON.parse(source("Second with rejected font"));
  target.resources = [resource.descriptor];
  target.pages[0].children = [{
    id: "font-text", type: "text", name: "Font text", x: 0, y: 0, width: 200, height: 40,
    fill: "#000000", stroke: "transparent", strokeWidth: 0, opacity: 1,
    rotation: 0, cornerRadius: 0, visible: true, locked: false,
    text: "Hello", fontSize: 20, fontWeight: 400, lineHeight: 1.2, textAlign: "left",
    fontFamily: "Rejected font", fontRef: resource.descriptor.id,
  }];
  f.files.set(`/project/A:${secondPath}`, JSON.stringify(target));
  for (const part of resource.parts) f.files.set(`/project/A:${part.path}`, part.content);
  await f.rename("Saved before font rejection");
  await f.switchFile(secondPath);
  await f.page.waitForFunction(() => document.querySelector("#file-switch-status")?.dataset.kind === "error");
  assert.equal(await f.page.locator("#document-path").inputValue(), initialPath);
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "Saved before font rejection");
  assert.equal(JSON.parse(f.files.get(`/project/A:${initialPath}`)).name, "Saved before font rejection");
  assert.equal(await f.page.locator("#files-dialog").evaluate(dialog => dialog.open), true);
  f.files.set(`/project/A:${secondPath}`, source("Second corrected after font rejection"));
  await f.page.locator("#files-list .file-row").filter({ hasText: secondPath }).click();
  await f.page.waitForFunction(path => document.querySelector("#document-path").value === path, secondPath);
  await f.page.waitForFunction(() => !document.querySelector("#files-dialog").open);
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "Second corrected after font rejection");
  assert.deepEqual(f.errors, []);
});

test("recents persist per workspace and do not rearrange a replacement project's other files", async t => {
  const f = await setup(t);
  await f.switchFile(secondPath);
  await f.page.waitForFunction(path => document.querySelector("#document-path").value === path, secondPath);
  await f.page.waitForFunction(() => !document.querySelector("#files-dialog").open);
  await f.switchFile(initialPath);
  await f.page.waitForFunction(path => document.querySelector("#document-path").value === path, initialPath);
  await f.page.waitForFunction(() => !document.querySelector("#files-dialog").open);
  const aRecents = [...f.records.values()].find(record => record?.workspaceRoot === "/project/A" && Array.isArray(record.paths));
  assert.deepEqual(aRecents.paths.slice(0, 2), [initialPath, secondPath]);
  f.files.set(`/project/B:${initialPath}`, source("B first"));
  f.files.set(`/project/B:${secondPath}`, source("B second"));
  f.files.set("/project/B:designs/b-other.codesign.json", source("B other"));
  await f.page.evaluate(() => window.switchAutosaveProject("/project/B"));
  await f.page.waitForFunction(() => !document.querySelector(".workspace").inert && document.querySelector("#prop-document-name").value === "B other");
  await f.page.locator("#open-files").click();
  await f.page.locator("#files-list .file-row").first().waitFor();
  assert.deepEqual(await f.page.locator("#files-list .file-copy span").allTextContents(), ["designs/b-other.codesign.json", initialPath, secondPath]);
  assert.deepEqual(aRecents.paths.slice(0, 2), [initialPath, secondPath]);
  assert.deepEqual(f.errors, []);
});

test("an indexed read finishing after the picker closes cannot replace newer local edits", async t => {
  const f = await setup(t);
  const plan = await createDesignIndexPersistencePlan({
    document: normalizeDesignDocument(JSON.parse(source("Indexed second"))),
    sha256: async value => createHash("sha256").update(value).digest("hex"),
  });
  f.files.set(`/project/A:${secondPath}`, plan.primarySource);
  for (const part of plan.parts) f.files.set(`/project/A:${part.path}`, part.content);
  await f.page.evaluate(partPath => {
    const call = window.codeshellPanel.call.bind(window.codeshellPanel);
    window.codeshellPanel.call = async (method, params) => {
      if (method === "workspace.readText" && params.path === partPath && !window.openPartPaused) {
        window.openPartPaused = true;
        await new Promise(resolve => { window.releaseOpenPart = resolve; });
      }
      return call(method, params);
    };
  }, plan.parts[0].path);
  await f.switchFile(secondPath);
  await f.page.waitForFunction(() => window.openPartPaused);
  await f.page.keyboard.press("Escape");
  await f.rename("Newer edit while the target page loads");
  assert.equal(await f.page.locator("#files-dialog").evaluate(dialog => dialog.open), false);
  await f.page.evaluate(() => window.releaseOpenPart());
  await f.page.waitForFunction(path =>
    document.querySelector("#file-switch-status")?.dataset.kind === "error" ||
      document.querySelector("#document-path").value === path, secondPath);
  assert.equal(await f.page.locator("#document-path").inputValue(), initialPath);
  assert.equal(await f.page.locator("#prop-document-name").inputValue(), "Newer edit while the target page loads");
  await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存", undefined, { timeout: 3000 });
  assert.equal(JSON.parse(f.files.get(`/project/A:${initialPath}`)).name, "Newer edit while the target page loads");
  assert.equal(f.files.get(`/project/A:${secondPath}`), plan.primarySource);
  assert.deepEqual(f.errors, []);
});
