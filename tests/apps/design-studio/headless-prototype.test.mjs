import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { createDesignSidecarPlan } from "../../../apps/design-studio/app/design-sidecar.mjs";
import { createDesignResourcePersistencePlan } from "../../../apps/design-studio/app/resource-store.mjs";
import { readSavedPrototype } from "../../../apps/design-studio/app/tools/prototype-source.mjs";

const sourcePackage = fileURLToPath(new URL("../../../apps/design-studio/", import.meta.url));
const hash = value => createHash("sha256").update(value).digest("hex");
const path = "designs/flow.codesign.json", companion = "designs/flow.prototype.json";
const base = (id, type, extra = {}) => ({ id, type, name: id, x: 24, y: 24, width: 100, height: 27,
  rotation: 0, fill: "transparent", stroke: "transparent", strokeWidth: 0, cornerRadius: 0,
  opacity: 1, visible: true, locked: false, ...extra });
function design() {
  const page = (id, label, action) => ({ id, name: label, children: [base(id + "-root", "frame", {
    width: 712, height: 200, layout: "vertical", gap: 16, padding: 24,
    alignItems: "stretch", justifyContent: "start", layoutSizingHorizontal: "fill", layoutSizingVertical: "hug",
    children: [base(action, "text", { text: label, fontFamily: "Inter", fontSize: 18, fontWeight: 400,
      lineHeight: 1.5, textAlign: "left", fill: "#172033", layoutSizingHorizontal: "fill", layoutSizingVertical: "fixed", notes: "req-browse" })],
  })] });
  const state = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "CLI prototype",
    canvas: { width: 760, height: 800, background: "#ffffff" }, tokens: { colors: [] }, resources: [], activePageId: "home",
    pages: [page("home", "打开详情", "next"), page("detail", "返回首页", "previous")] });
  for (const page of state.pages) applyAllAutoLayouts(page.nodes);
  return JSON.parse(serializeDesignDocument(state));
}
const prototype = () => ({ format: "codeshell.design.prototype", version: 1, startPageId: "home", links: [
  { id: "forward", pageId: "home", nodeId: "next", event: "click", action: "navigate", targetPageId: "detail" },
  { id: "back", pageId: "detail", nodeId: "previous", event: "click", action: "back" },
] });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "headless-prototype-")), project = join(root, "project"), installed = join(root, "installed");
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(project); await cp(sourcePackage, installed, { recursive: true });
  let serial = 0;
  const invoke = async args => {
    const child = spawn(process.execPath, [join(installed, "app/tools/design-studio.mjs"), ...args],
      { cwd: project, env: { PATH: "" }, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", value => stdout.push(value)); child.stderr.on("data", value => stderr.push(value));
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    const code = await new Promise((done, reject) => { child.on("error", reject); child.on("close", done); }).finally(() => clearTimeout(timer));
    assert.equal(Buffer.concat(stderr).toString(), "");
    const output = Buffer.concat(stdout).toString(); assert.equal(output.trim().split("\n").length, 1);
    return { code, value: JSON.parse(output) };
  };
  const run = async (operation, input) => {
    const request = join(root, `request-${serial++}.json`); await writeFile(request, JSON.stringify(input));
    return invoke(["run", operation, "--project", project, "--input-file", request]);
  };
  const put = async (path, text) => { const target = join(project, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, text); };
  const created = await run("create", { path, document: design() }); assert.equal(created.code, 0);
  return { root, project, installed, invoke, run, put };
}

test("installed frontend schema admits only explicit prototype booleans and preserves static defaults", async t => {
  const f = await fixture(t), ops = (await f.invoke(["ops"])).value.result;
  assert.equal(ops.find(op => op.name === "frontend").inputSchema.properties.prototype.type, "boolean");
  assert.equal(ops.find(op => op.name === "svg").inputSchema.properties.prototype, undefined);
  for (const value of [0, 1, null, "true", [], {}]) {
    const result = await f.run("frontend", { path, prototype: value, output: "designs/rejected.html" });
    assert.equal(result.code, 2); assert.equal(result.value.error.code, "INVALID_ARGUMENT");
  }
  assert.equal((await f.run("frontend", { path, prototype: true, page_id: "home" })).code, 2);
  const original = await f.run("frontend", { path }), explicit = await f.run("frontend", { path, prototype: false });
  assert.equal(original.value.result.content, explicit.value.result.content);
  assert.equal((original.value.result.content.match(/<main /gu) ?? []).length, 1);
  assert.equal(original.value.result.content.includes("data-prototype-link"), false);
  await assert.rejects(readFile(join(f.project, "designs/rejected.html")), { code: "ENOENT" });
});

test("missing primary companion uses an explicit read-only all-page default", async t => {
  const f = await fixture(t), before = await readFile(join(f.project, path));
  const exported = await f.run("frontend", { path, prototype: true });
  assert.equal(exported.code, 0); assert.equal(exported.value.result.pageCount, 2);
  assert.equal(exported.value.result.startPageId, "home");
  assert.equal(exported.value.result.prototype.status, "absent"); assert.equal(exported.value.result.prototype.defaulted, true);
  assert.equal((exported.value.result.content.match(/<main /gu) ?? []).length, 2);
  const checked = (await f.run("validate", { path })).value.result;
  assert.equal(checked.valid, true); assert.equal(checked.prototype.status, "absent");
  await assert.rejects(readFile(join(f.project, companion)), { code: "ENOENT" });
  assert.deepEqual(await readFile(join(f.project, path)), before);
});

test("valid saved links and verified resources export all pages create-only without changing source", async t => {
  const f = await fixture(t), resource = await createDesignResourcePersistencePlan({ id: "pixel", kind: "image", mime: "image/png",
    base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", sha256Bytes: async bytes => hash(bytes) });
  for (const part of resource.parts) await f.put(part.path, part.content);
  const document = design(); document.resources = [resource.descriptor];
  document.pages[1].children[0].children.push(base("pixel-node", "image", { imageRef: "pixel", objectFit: "contain", width: 20, height: 20 }));
  const basis = (await f.run("inspect", { path })).value.result;
  assert.equal((await f.run("edit", { path, expected_revision: basis.revision, document })).code, 0);
  const raw = JSON.stringify(prototype()); await f.put(companion, raw);
  const before = await readFile(join(f.project, path));
  const exported = await f.run("frontend", { path, prototype: true, output: "designs/prototype.html" });
  assert.equal(exported.code, 0); assert.equal(exported.value.result.prototype.status, "valid");
  assert.equal(exported.value.result.prototype.revision, hash(raw));
  const content = await readFile(join(f.project, "designs/prototype.html"), "utf8");
  assert.match(content, /data-prototype-link="forward"/u); assert.match(content, /data:image\/png;base64,/u);
  assert.equal((content.match(/<main /gu) ?? []).length, 2);
  assert.equal((await f.run("frontend", { path, prototype: true, output: "designs/prototype.html" })).code, 3);
  assert.equal(await readFile(join(f.project, "designs/prototype.html"), "utf8"), content);
  assert.deepEqual(await readFile(join(f.project, path)), before); assert.equal(await readFile(join(f.project, companion), "utf8"), raw);
  await f.put(resource.parts[0].path, "AA==");
  assert.equal((await f.run("frontend", { path, prototype: true })).value.ok, false, "prototype uses the existing verified resource loader");
});

test("malformed, oversized and present-but-incomplete companions never silently default", async t => {
  const f = await fixture(t), original = await readFile(join(f.project, path));
  const cases = ["", "{", JSON.stringify({ ...prototype(), format: "foreign" }), " ".repeat(2 * 1024 * 1024 + 1)];
  const plan = await createDesignSidecarPlan(JSON.stringify(prototype()) + " ".repeat(400 * 1024), { sha256: async value => hash(value) });
  cases.push(plan.primarySource); // The primary exists; its absent part must be invalid.
  cases.push(JSON.stringify({ format: "codeshell.design.sidecar", version: 1, bytes: 2 * 1024 * 1024 + 1, sha256: "a".repeat(64), parts: [] }));
  for (const content of cases) {
    await f.put(companion, content);
    const checked = (await f.run("validate", { path })).value.result;
    assert.equal(checked.valid, false); assert.equal(checked.errorCount, 1); assert.equal(checked.blockingIssueCount, 1);
    assert.equal(checked.prototype.status, "invalid"); assert.equal(checked.prototype.defaulted, undefined);
    const exported = await f.run("frontend", { path, prototype: true, output: "designs/invalid.html" });
    assert.equal(exported.code, 2); assert.equal(exported.value.error.code, "INVALID_DESIGN");
    assert.equal(await readFile(join(f.project, companion), "utf8"), content);
  }
  await assert.rejects(readFile(join(f.project, "designs/invalid.html")), { code: "ENOENT" });
  assert.deepEqual(await readFile(join(f.project, path)), original);
  const reads = [];
  const declared = await readSavedPrototype({ read(path, limit) { reads.push({ path, limit }); return { content: cases.at(-1), revision: hash(cases.at(-1)) }; } }, path, normalizeDesignDocument(design()));
  assert.equal(declared.summary.status, "invalid"); assert.match(declared.diagnostics[0].message, /2 MiB/u); assert.equal(reads.length, 1);
});

test("verified multipart and symlink/error boundaries use the shared project reader", async t => {
  const f = await fixture(t), text = JSON.stringify(prototype()) + " ".repeat(400 * 1024);
  const plan = await createDesignSidecarPlan(text, { sha256: async value => hash(value) });
  for (const part of plan.parts) await f.put(part.path, part.content); await f.put(companion, plan.primarySource);
  assert.equal((await f.run("frontend", { path, prototype: true })).code, 0);
  await f.put(plan.parts[0].path, "wrong");
  assert.equal((await f.run("frontend", { path, prototype: true })).code, 2);
  await rm(join(f.project, plan.parts[0].path));
  const outsidePart = join(f.root, "outside-part.txt"); await writeFile(outsidePart, plan.parts[0].content);
  await symlink(outsidePart, join(f.project, plan.parts[0].path));
  const unsafePart = (await f.run("validate", { path })).value.result;
  assert.equal(unsafePart.prototype.status, "invalid"); assert.equal(unsafePart.prototype.defaulted, undefined);
  assert.equal((await f.run("frontend", { path, prototype: true })).code, 2);
  assert.equal(await readFile(outsidePart, "utf8"), plan.parts[0].content);
  await rm(join(f.project, companion)); const outside = join(f.root, "outside.json"); await writeFile(outside, JSON.stringify(prototype()));
  await symlink(outside, join(f.project, companion));
  const checked = (await f.run("validate", { path })).value.result;
  assert.equal(checked.prototype.status, "invalid"); assert.equal(checked.prototype.diagnostics[0].sourceCode, "UNSAFE_PATH");
  assert.equal((await f.run("frontend", { path, prototype: true })).code, 2);
  assert.equal(await readFile(outside, "utf8"), JSON.stringify(prototype()));
});

test("actual node ID replacement is reported as a blocking companion issue and diagnostics stay bounded", async t => {
  const f = await fixture(t); await f.put(companion, JSON.stringify(prototype()));
  const before = (await f.run("inspect", { path })).value.result, document = design();
  document.pages[0].children[0].children[0].id = "regenerated-next";
  assert.equal(document.pages[0].children[0].children[0].notes, "req-browse");
  assert.equal((await f.run("edit", { path, expected_revision: before.revision, document })).code, 0);
  const checked = (await f.run("validate", { path })).value.result;
  assert.equal(checked.valid, false); assert.equal(checked.errorCount, 1); assert.equal(checked.blockingIssueCount, 1);
  assert.equal(checked.issues[0].code, "prototype.missing-source"); assert.equal(checked.issues[0].linkId, "forward");
  assert.equal((await f.run("frontend", { path, prototype: true })).code, 2);
  const many = prototype(); many.links = Array.from({ length: 150 }, (_, index) => ({ ...many.links[0], id: `link-${index}`, nodeId: `missing-${index}` }));
  await f.put(companion, JSON.stringify(many));
  const bounded = (await f.run("validate", { path })).value.result;
  assert.equal(bounded.issueCount, 150); assert.equal(bounded.errorCount, 150); assert.equal(bounded.blockingIssueCount, 150);
  assert.equal(bounded.prototype.diagnosticCount, 150); assert.equal(bounded.prototype.diagnostics.length, 100); assert.equal(bounded.prototype.truncatedDiagnosticCount, 50);
});

test("actual installed CLI prototype export navigates forward/back at1280/400 with flow and IDs intact", async t => {
  const f = await fixture(t); await f.put(companion, JSON.stringify(prototype()));
  const exported = await f.run("frontend", { path, prototype: true, output: "designs/clickable.html" }); assert.equal(exported.code, 0);
  const html = await readFile(join(f.project, "designs/clickable.html"));
  const server = createServer((_request, response) => { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(html); });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-gpu", "--disable-webgl", "--disable-webgl2", "--disable-accelerated-2d-canvas", "--disable-features=WebGPU"] });
    for (const width of [1280, 400]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const networkDenied = [];
      await context.route("**/*", route => { if (route.request().url().startsWith(origin + "/")) return route.continue(); networkDenied.push(route.request().url()); return route.abort(); });
      await context.addInitScript(() => { window.gpuRequests = []; const wrap = prototype => { const original = prototype.getContext;
        prototype.getContext = function (type, ...args) { if (/webgl|webgpu/iu.test(String(type))) { window.gpuRequests.push(type); return null; } return original.call(this, type, ...args); }; };
        wrap(HTMLCanvasElement.prototype); if (typeof OffscreenCanvas === "function") wrap(OffscreenCanvas.prototype);
        try { Object.defineProperty(navigator, "gpu", { get() { window.gpuRequests.push("gpu"); return undefined; } }); } catch {} });
      const page = await context.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message)); await page.goto(origin + "/prototype.html");
      const check = async id => { assert.deepEqual(await page.locator("main.cs-page:not([hidden])").evaluateAll(nodes => nodes.map(node => node.dataset.codeshellPageId)), [id]);
        const flow = await page.locator(`[data-codeshell-id="${id === "home" ? "next" : "previous"}"]`).evaluate(node => ({ position: getComputedStyle(node).position, parent: getComputedStyle(node.parentElement).display, notes: node.title, width: node.clientWidth, scroll: node.scrollWidth }));
        assert.equal(flow.position, "relative"); assert.equal(flow.parent, "flex"); assert.equal(flow.notes, "req-browse"); assert(flow.scroll <= flow.width); };
      await check("home"); await page.locator('a[data-prototype-link="forward"]').click(); await check("detail");
      await page.locator('a[data-prototype-link="back"]').click(); await check("home");
      assert.deepEqual(await page.evaluate(() => window.gpuRequests), []); assert.deepEqual(errors, []); assert.deepEqual(networkDenied, []); await context.close();
    }
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
});
