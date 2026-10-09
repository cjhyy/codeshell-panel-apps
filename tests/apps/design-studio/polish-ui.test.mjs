import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createDesignIndexPersistencePlan } from "../../../apps/design-studio/app/document-index.mjs";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const manifest = JSON.parse(await readFile(new URL("../../../apps/design-studio/.codeshell-panel/panel.json", import.meta.url)));
const path = "designs/polish.codesign.json";
const hash = value => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

function source(scope, imported = false) {
  const node = (id, type, name, x, y, width, height, extra = {}) => ({
    id, type, name, x, y, width, height, fill: "#333333", stroke: "transparent",
    strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false, ...extra,
  });
  return serializeDesignDocument(normalizeDesignDocument({ format: "codeshell.design", version: 3,
    name: `${scope} design`, canvas: { width: 800, height: 600, background: "#ffffff" },
    tokens: { colors: [] }, resources: [], activePageId: "page-1", pages: [
      { id: "page-1", name: "Home", children: [node("card", "frame", "Card", 100, 100, 500, 300, {
        fill: "#ffffff", layout: "none", gap: 16, padding: 24, alignItems: "start", justifyContent: "start",
        gridColumns: 2, clipContent: false, children: [
          node("heading", "text", "Heading", 140, 140, 200, 50, { text: `${scope} heading`,
            fontSize: 24, fontWeight: 600, lineHeight: 1.2, textAlign: "left",
            textSource: imported ? `${scope} complete imported heading` : `${scope} heading`,
            ...(imported ? { textOverflow: "ellipsis" } : {}),
            textMeasurement: "browser", textFlowWidth: 200 }),
          node("body", "text", "Body", 140, 220, 180, 40, { text: "Body copy", fontSize: 16,
            fontWeight: 400, lineHeight: 1.2, textAlign: "left" }),
        ],
      })] }, { id: "page-2", name: "Details", children: [] },
    ],
  }));
}

async function fixture(t, { mobile = false, agent = true, imported = false, indexed = false } = {}) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: 844 },
    hasTouch: mobile, isMobile: mobile });
  const page = await context.newPage(), calls = [], records = new Map(), errors = [], pauses = new Map();
  page.setDefaultTimeout(4000);
  const files = new Map(["A", "B"].map(scope => [`${scope}:${path}`, source(scope, imported)]));
  if (indexed) for (const scope of ["A", "B"]) {
    const raw = JSON.parse(source(scope, imported));
    raw.pages.push(...Array.from({ length: 10 }, (_, i) => ({ id: `page-${i + 3}`, name: `Page ${i + 3}`, children: [] })));
    const plan = await createDesignIndexPersistencePlan({ document: normalizeDesignDocument(raw),
      sha256: async value => createHash("sha256").update(value).digest("hex") });
    files.set(`${scope}:${path}`, plan.primarySource);
    for (const part of plan.parts) files.set(`${scope}:${part.path}`, part.content);
  }
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const url = new URL(route.request().url()), file = resolve(root, `.${url.pathname}`);
    if (url.origin !== "https://panel.test" || !file.startsWith(root + sep)) return route.abort();
    try { await route.fulfill({ body: await readFile(file), contentType: {
      ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css",
    }[extname(file)] }); } catch { await route.fulfill({ status: 404, body: "missing" }); }
  });
  await page.exposeFunction("hostBridge", async (scope, method, params = {}) => {
    calls.push({ scope, method, ...structuredClone(params) });
    const key = `${scope}:${params.key}`;
    const snapshot = () => ({ exists: records.has(key), value: records.get(key) ?? null,
      revision: records.has(key) ? hash(records.get(key)) : null });
    let result;
    if (method === "workspace.info") result = { cwd: "/workspace", name: scope };
    else if (method === "workspace.list") result = { entries: [], truncated: false };
    else if (method === "workspace.readText") {
      const content = files.get(`${scope}:${params.path}`);
      if (content === undefined) throw Error("file missing");
      result = { content, modifiedAt: 1, revision: hash(content) };
    } else if (method === "workspace.writeText") {
      const file = `${scope}:${params.path}`, previous = files.get(file);
      if (params.expectedModifiedAt === null && previous !== undefined) throw Error("file exists");
      if (params.expectedRevision && params.expectedRevision !== hash(previous)) throw Error("changed since read");
      files.set(file, params.content);
      result = { modifiedAt: 1, revision: hash(params.content) };
    } else if (method === "storage.get") result = params.key.startsWith("lastPath.")
      ? { workspaceRoot: "/workspace", path } : records.get(key) ?? null;
    else if (method === "storage.set") { records.set(key, structuredClone(params.value)); result = null; }
    else if (method === "storage.delete") { records.delete(key); result = null; }
    else if (method === "storage.getSnapshot") result = snapshot();
    else if (method === "storage.compareAndSet") {
      if (params.expectedRevision !== snapshot().revision) result = { updated: false, snapshot: snapshot() };
      else {
        if (params.remove) records.delete(key); else records.set(key, structuredClone(params.value));
        result = { updated: true, snapshot: snapshot() };
      }
    } else if (method === "agent.submitPrompt") result = { accepted: true };
    else throw Error(`Unsupported ${method}`);
    const pause = pauses.get(`${scope}:${method}`);
    if (pause) { pauses.delete(`${scope}:${method}`); pause.enter(); await pause.gate; }
    return result;
  });
  await page.addInitScript(({ permissions, agent }) => {
    let listener, scope = "A";
    const context = { trusted: true, busy: false,
      ...(permissions.includes("context.workspace") ? { cwd: "/workspace" } : {}),
      ...(permissions.includes("context.session") ? { sessionId: "A" } : {}),
      availableMethods: ["workspace.info", "workspace.list", "workspace.readText", "workspace.writeText",
        "storage.get", "storage.set", "storage.delete", "storage.getSnapshot", "storage.compareAndSet",
        ...(agent ? ["agent.submitPrompt"] : [])],
    };
    window.tools = {};
    window.codeshellPanel = {
      getContext: async () => ({ ...context }),
      on(name, callback) { if (name === "context.changed") listener = callback; },
      registerTool(name, callback) { window.tools[name] = callback; },
      call: (method, params) => window.hostBridge(scope, method, params),
    };
    window.switchProject = target => { scope = target; context.sessionId = target; listener?.({ ...context }); };
  }, { permissions: manifest.permissions, agent });
  await page.goto("https://panel.test/index.html");
  try {
    await page.waitForFunction(() => !document.querySelector(".workspace").inert &&
      document.querySelector('[data-text-node-id="heading"]')?.textContent === "A heading", null, { timeout: 3000 });
  } catch (error) {
    error.message += `\nErrors: ${JSON.stringify(errors)}; status: ${await page.locator("#toast").textContent()}; calls: ${JSON.stringify(calls.slice(-5))}`;
    throw error;
  }
  const read = () => page.evaluate(() => window.tools.get_design_context({}));
  const select = async id => {
    if (mobile) { await page.locator("#toggle-layers").tap(); await page.waitForFunction(() => document.querySelector(".workspace").classList.contains("layers-open")); }
    await page.locator(`.layer-row[data-id="${id}"]`).click();
    if (mobile) { await page.locator("#toggle-inspector").tap(); await page.waitForFunction(() => document.querySelector(".workspace").classList.contains("inspector-open")); }
  };
  return { page, calls, files, records, errors, read, select, pause(method, scope = "A") {
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
    pauses.set(`${scope}:${method}`, { enter, gate }); t.after(release);
    return { entered, release };
  } };
}

test("inline canvas text commits once, cancels without changing the document, and clears stale measured text", async t => {
  const f = await fixture(t), editor = f.page.locator("#inline-text-editor");
  await f.page.locator('[data-text-node-id="heading"]').dblclick();
  await editor.fill("Updated\nheading");
  await editor.press("Control+Enter");
  assert.equal(await editor.isVisible(), false);
  assert.equal(await f.page.locator('[data-text-node-id="heading"]').textContent(), "Updatedheading");
  await f.page.locator("#stage").press("Control+z");
  assert.equal(await f.page.locator('[data-text-node-id="heading"]').textContent(), "A heading");
  await f.page.locator("#stage").press("Control+Shift+z");
  await f.page.locator('[data-text-node-id="heading"]').dblclick();
  await editor.fill("Discard this"); await editor.press("Escape");
  assert.equal(await f.page.locator('[data-text-node-id="heading"]').textContent(), "Updatedheading");
  await f.page.locator("#save").click();
  await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存");
  const saved = normalizeDesignDocument(JSON.parse(f.files.get(`A:${path}`))).nodes.find(node => node.id === "heading");
  assert.equal(saved.text, "Updated\nheading"); assert.equal(saved.textSource, saved.text);
  assert.equal(saved.textMeasurement, undefined); assert.equal(saved.textFlowWidth, undefined);
  assert.deepEqual(f.errors, []);
});

test("saving during an inline edit flushes the buffer and a later project switch preserves only the old scoped draft", async t => {
  const f = await fixture(t), editor = f.page.locator("#inline-text-editor");
  await f.page.locator('[data-text-node-id="heading"]').dblclick(); await editor.fill("Saved from editor");
  await editor.press("Control+s");
  await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存");
  assert.match(f.files.get(`A:${path}`), /Saved from editor/);
  await f.page.locator('[data-text-node-id="heading"]').dblclick(); await editor.fill("A unsaved buffer");
  const before = f.calls.length;
  await f.page.evaluate(() => window.switchProject("B"));
  await f.page.waitForFunction(() => !document.querySelector(".workspace").inert && document.querySelector('[data-text-node-id="heading"]')?.textContent === "B heading");
  assert.equal(await editor.isVisible(), false);
  const downloading = f.page.waitForEvent("download");
  await f.page.locator("#recovery-backup").click();
  const draftBackup = await readFile(await (await downloading).path(), "utf8");
  assert.match(draftBackup, /A unsaved buffer/);
  assert.equal(f.calls.slice(before).filter(call => call.method === "workspace.writeText").length, 0);
  assert.doesNotMatch(f.files.get(`B:${path}`), /A unsaved/);
  assert.deepEqual(f.errors, []);
});

test("editing imported ellipsis uses the complete source and clearing it remains a valid saved text node", async t => {
  const f = await fixture(t, { imported: true }); await f.select("heading");
  assert.equal(await f.page.locator("#prop-text").inputValue(), "A complete imported heading");
  const editor = f.page.locator("#inline-text-editor"); await f.page.locator("#edit-text-selection").click();
  assert.equal(await editor.inputValue(), "A complete imported heading");
  await editor.fill("A complete imported heading!"); await editor.press("Control+Enter");
  assert.equal(await f.page.locator('[data-text-node-id="heading"]').textContent(), "A complete imported heading!");
  await f.page.locator("#edit-text-selection").click(); await editor.fill(""); await editor.press("Control+Enter");
  await f.page.locator("#save").click(); await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存");
  const saved = normalizeDesignDocument(JSON.parse(f.files.get(`A:${path}`))).nodes.find(node => node.id === "heading");
  assert.equal(saved.text, ""); assert.equal(saved.textOverflow, undefined);
  assert.deepEqual(f.errors, []);
});

test("layer comments save before submitting stable target context and the exact display text", async t => {
  const f = await fixture(t);
  await f.page.keyboard.press("c");
  await f.page.locator('[data-text-node-id="heading"]').click();
  assert.match(await f.page.locator("#element-comment-target").textContent(), /Card \/ Heading.*heading/);
  await f.page.locator("#element-comment-request").fill("让标题更突出");
  await f.page.locator("#element-comment-request").press("Control+Enter");
  await f.page.waitForFunction(() => !document.querySelector("#element-comment").open);
  const submitted = f.calls.find(call => call.method === "agent.submitPrompt");
  assert.ok(submitted); assert.equal(submitted.displayText, "让标题更突出");
  assert.match(submitted.prompt, /Home \(page-1\)/); assert.match(submitted.prompt, /"id": "heading"/);
  assert.match(submitted.prompt, /Card \/ Heading/); assert.match(submitted.prompt, /"x": 140/);
  assert.match(submitted.prompt, /"text": "A heading"/);
  assert.ok(f.calls.findIndex(call => call.method === "workspace.writeText") < f.calls.indexOf(submitted));
  assert.equal(await f.page.locator('[data-tool="select"]').getAttribute("aria-pressed"), "true");
  assert.deepEqual(f.errors, []);
});

test("a comment awaiting save never submits to a replacement project with the same cwd and node IDs", async t => {
  const f = await fixture(t); await f.select("heading");
  await f.page.locator("#comment-selection").click(); await f.page.locator("#element-comment-request").fill("Only project A");
  const pause = f.pause("workspace.writeText"); await f.page.locator("#submit-element-comment").click(); await pause.entered;
  await f.page.evaluate(() => window.switchProject("B"));
  await f.page.waitForFunction(() => !document.querySelector(".workspace").inert && document.querySelector('[data-text-node-id="heading"]')?.textContent === "B heading");
  pause.release(); await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(f.calls.filter(call => call.method === "agent.submitPrompt").length, 0);
  assert.equal(await f.page.locator("#element-comment").isVisible(), false);
  assert.deepEqual(f.errors, []);
});

test("an edited indexed design can save and submit its layer comment without confusing persistence metadata with edits", async t => {
  const f = await fixture(t, { indexed: true }); await f.select("heading");
  await f.page.locator("#prop-text").fill("Indexed edited heading");
  await f.page.locator("#comment-selection").click(); await f.page.locator("#element-comment-request").fill("Review saved indexed heading");
  await f.page.locator("#submit-element-comment").click();
  await f.page.waitForFunction(() => !document.querySelector("#element-comment").open);
  assert.match(f.calls.find(call => call.method === "agent.submitPrompt").prompt, /Indexed edited heading/);
  assert.equal((await f.page.evaluate(() => window.tools.get_design_metadata())).storageMode, "indexed");
  assert.deepEqual(f.errors, []);
});

test("starting a lazy page switch cancels the old comment even before the new page finishes loading", async t => {
  const f = await fixture(t, { indexed: true }); await f.select("heading");
  await f.page.locator("#comment-selection").click(); await f.page.locator("#element-comment-request").fill("Old page request");
  const saving = f.pause("workspace.writeText"); await f.page.locator("#submit-element-comment").click(); await saving.entered;
  await f.page.keyboard.press("Escape");
  const loading = f.pause("workspace.readText");
  await f.page.locator(".sidebar-page").filter({ hasText: "Page 12" }).click(); await loading.entered;
  saving.release(); await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(f.calls.filter(call => call.method === "agent.submitPrompt").length, 0);
  loading.release(); await f.page.waitForFunction(() => document.querySelector("#active-page").value === "page-12");
  assert.equal(f.calls.filter(call => call.method === "agent.submitPrompt").length, 0);
  assert.deepEqual(f.errors, []);
});

test("editing while a comment save is pending keeps the newer design dirty and cancels its outdated prompt", async t => {
  const f = await fixture(t); await f.select("heading");
  await f.page.locator("#comment-selection").click(); await f.page.locator("#element-comment-request").fill("Review old snapshot");
  const saving = f.pause("workspace.writeText"); await f.page.locator("#submit-element-comment").click(); await saving.entered;
  await f.page.keyboard.press("Escape"); await f.page.locator("#prop-text").fill("Newer heading during save");
  saving.release(); await f.page.waitForFunction(() => !document.querySelector("#submit-element-comment").disabled);
  assert.equal(f.calls.filter(call => call.method === "agent.submitPrompt").length, 0);
  assert.equal((await f.page.evaluate(() => window.tools.get_design_metadata())).dirty, true);
  assert.equal(await f.page.locator('[data-text-node-id="heading"]').textContent(), "Newer heading during save");
  assert.doesNotMatch(f.files.get(`A:${path}`), /Newer heading/);
  assert.deepEqual(f.errors, []);
});

test("Agent handoff captures the current selection and can explicitly target the entire design", async t => {
  const f = await fixture(t); await f.select("card");
  await f.page.locator("#open-ai").click();
  assert.match(await f.page.locator("#ai-target-context").textContent(), /Card.*card/);
  await f.page.locator("#ai-request").fill("检查卡片布局"); await f.page.locator("#submit-ai").click();
  await f.page.waitForFunction(() => !document.querySelector("#ai-dialog").open);
  assert.match(f.calls.find(call => call.method === "agent.submitPrompt").prompt, /"layout": "none"/);
  await f.page.locator("#open-ai").click(); await f.page.locator("#clear-ai-target").click();
  assert.equal(await f.page.locator("#ai-target-context").isVisible(), false);
  await f.page.locator("#ai-request").fill("检查整个设计"); await f.page.locator("#submit-ai").click();
  await f.page.waitForFunction(() => !document.querySelector("#ai-dialog").open);
  assert.doesNotMatch(f.calls.filter(call => call.method === "agent.submitPrompt").at(-1).prompt, /"id": "card"/);
  assert.deepEqual(f.errors, []);
});

for (const replacement of ["comment", "agent"]) {
  test(`a delayed comment receipt preserves a newly opened ${replacement} draft in the same design`, async t => {
    const f = await fixture(t); await f.select("heading");
    await f.page.locator("#comment-selection").click(); await f.page.locator("#element-comment-request").fill("Original request");
    const pause = f.pause("agent.submitPrompt"); await f.page.locator("#submit-element-comment").click(); await pause.entered;
    await f.page.keyboard.press("Escape"); await f.select("body");
    if (replacement === "comment") {
      await f.page.locator("#comment-selection").click(); await f.page.locator("#element-comment-request").fill("New comment draft");
    } else {
      await f.page.locator("#open-ai").click(); await f.page.locator("#ai-request").fill("New Agent draft");
    }
    pause.release();
    const dialog = replacement === "comment" ? "#element-comment" : "#ai-dialog";
    const button = replacement === "comment" ? "#submit-element-comment" : "#submit-ai";
    await f.page.waitForFunction(selector => !document.querySelector(selector).disabled, button);
    assert.equal(await f.page.locator(dialog).isVisible(), true);
    assert.equal(await f.page.locator(replacement === "comment" ? "#element-comment-request" : "#ai-request").inputValue(),
      replacement === "comment" ? "New comment draft" : "New Agent draft");
    assert.match(await f.page.locator(replacement === "comment" ? "#element-comment-target" : "#ai-target-context").textContent(), /Body.*body/);
    assert.equal(f.calls.filter(call => call.method === "agent.submitPrompt").length, 1);
    assert.deepEqual(f.errors, []);
  });
}

test("text creation opens inline input and Enter edits a selected text without changing the existing touch flow", async t => {
  const f = await fixture(t); await f.page.locator('[data-tool="text"]').click();
  const canvas = await f.page.locator("#stage").boundingBox();
  await f.page.mouse.click(canvas.x + canvas.width - 40, canvas.y + canvas.height - 80);
  const editor = f.page.locator("#inline-text-editor"); await editor.fill("Created text"); await editor.press("Control+Enter");
  assert.equal(await f.page.locator('[data-text-node-id]').filter({ hasText: "Created text" }).count(), 1);
  await f.select("heading"); await f.page.locator("#stage").focus(); await f.page.keyboard.press("Enter");
  assert.equal(await editor.inputValue(), "A heading"); await editor.press("Escape");
  assert.equal(await f.page.locator('[data-text-node-id="heading"]').textContent(), "A heading");
  assert.deepEqual(f.errors, []);
});

test("the visual layout controls use the existing model, support undo and stay disabled on locked containers", async t => {
  const f = await fixture(t); await f.select("card");
  await f.page.locator('[data-layout-direction="horizontal"]').click();
  assert.equal(await f.page.locator("#layout-status-chip").textContent(), "水平");
  await f.page.locator('[data-layout-align="center:end"]').click();
  await f.page.locator("#layout-space-between").click();
  await f.page.locator("#save").click(); await f.page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存");
  let model = normalizeDesignDocument(JSON.parse(f.files.get(`A:${path}`))), card = model.nodes.find(node => node.id === "card");
  assert.equal(card.layout, "horizontal"); assert.equal(card.justifyContent, "space-between"); assert.equal(card.alignItems, "end");
  assert.equal(model.nodes.find(node => node.id === "body").x, card.x + card.width - card.padding - 180);
  await f.page.locator("#stage").press("Control+z");
  assert.equal(await f.page.locator('[data-layout-align="center:end"]').getAttribute("aria-pressed"), "true");
  await f.page.locator("#toggle-lock").click();
  assert.equal(await f.page.locator('[data-layout-direction="vertical"]').isDisabled(), true);
  assert.equal(await f.page.locator('[data-layout-align="center:center"]').isDisabled(), true);
  assert.deepEqual(f.errors, []);
});

test("mobile text editing and comments remain reachable without overflow or a second custom select runtime", async t => {
  const f = await fixture(t, { mobile: true, agent: false }); await f.select("heading");
  await f.page.locator("#edit-text-selection").tap();
  const editor = f.page.locator("#inline-text-editor"); await editor.fill("Touch edit"); await editor.press("Control+Enter");
  assert.equal(await f.page.locator('[data-text-node-id="heading"]').textContent(), "Touch edit");
  await f.page.locator("#toggle-inspector").tap();
  await f.page.locator("#comment-selection").tap();
  assert.equal(await f.page.locator("#element-comment").isVisible(), true);
  assert.equal(await f.page.locator("#submit-element-comment").isDisabled(), true);
  assert.match(await f.page.locator(".comment-context").textContent(), /未连接/);
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.equal(await f.page.locator("#element-comment").evaluate(element => element.scrollWidth <= element.clientWidth), true);
  assert.equal(await f.page.locator('script[src="./panel-select.js"]').count(), 1);
  assert.equal(f.calls.filter(call => call.method === "agent.submitPrompt").length, 0);
  assert.deepEqual(f.errors, []);
});
