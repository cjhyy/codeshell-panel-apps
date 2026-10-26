import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";
import { chromium } from "playwright";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";

const root = fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url));
export const initialPath = "designs/first.codesign.json", secondPath = "designs/second.codesign.json";
const hash = value => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
export const source = name => serializeDesignDocument(normalizeDesignDocument({
  format: "codeshell.design", version: 3, name,
  canvas: { width: 800, height: 600, background: "#ffffff" }, tokens: { colors: [] },
  activePageId: "page-1", pages: [{ id: "page-1", name: "One", children: [] }],
}));

export async function fixture(t, { blank = false, browserOnly = false, sourceOverrides = new Map(), sourceRoot = root, initialSource, gpu = false, extraFiles = new Map() } = {}) {
  const serveRoot = `${resolve(sourceRoot)}${sep}`;
  const files = new Map(), records = new Map(), calls = [], errors = [], dialogs = [];
  for (const [path, content] of extraFiles) files.set(`/project/A:${path}`, content);
  if (!blank) {
    files.set(`/project/A:${initialPath}`, initialSource ?? source("First"));
    files.set(`/project/A:${secondPath}`, source("Second"));
  }
  const server = createServer(async (request, response) => {
    const path = resolve(serveRoot, `.${new URL(request.url, "http://test").pathname}`);
    if (path !== resolve(serveRoot) && !path.startsWith(serveRoot)) return response.writeHead(403).end();
    try {
      const target = path === resolve(serveRoot) || path.endsWith(sep) ? resolve(serveRoot, "index.html") : path;
      const relative = target.slice(serveRoot.length);
      const contents = sourceOverrides.has(relative) ? sourceOverrides.get(relative)
        : await readFile(target === resolve(serveRoot, "app.js") && process.env.DESIGN_STUDIO_AUTOSAVE_OLD_APP_JS
          ? process.env.DESIGN_STUDIO_AUTOSAVE_OLD_APP_JS : target);
      response.writeHead(200, { "content-type": ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".ttf": "font/ttf" })[extname(target)] ?? "application/octet-stream" }).end(contents);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, ...(gpu ? { args: ["--enable-webgl", "--enable-unsafe-swiftshader"] } : {}) });
  const context = await browser.newContext();
  const page = await context.newPage();
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  let rejectWrites = false, heldWrite, collideCreate = false, heldCall;
  if (!browserOnly) {
    await page.exposeFunction("autosaveHost", async (scope, method, params = {}) => {
      calls.push({ scope, method, ...structuredClone(params) });
      if (heldCall?.method === method && heldCall.matches(params)) {
        const hold = heldCall; heldCall = null; hold.enter(); await hold.gate;
      }
      const key = `${scope}:${params.key}`;
      const snapshot = () => records.has(key) ? { exists: true, value: structuredClone(records.get(key)), revision: hash(records.get(key)) } : { exists: false, value: null, revision: null };
      if (method === "storage.getSnapshot") return snapshot();
      if (method === "storage.compareAndSet") {
        if (params.expectedRevision !== snapshot().revision) return { updated: false, snapshot: snapshot() };
        if (params.remove) records.delete(key); else records.set(key, structuredClone(params.value));
        return { updated: true, snapshot: snapshot() };
      }
      if (method === "storage.get") return !blank && scope === "/project/A" && params.key.startsWith("lastPath.") ? { workspaceRoot: scope, path: initialPath } : records.get(key) ?? null;
      if (method === "storage.set") { records.set(key, structuredClone(params.value)); return true; }
      if (method === "workspace.info") return { name: scope.split("/").at(-1), root: scope, trusted: true };
      if (method === "workspace.list") return { entries: [...files].filter(([key]) => key.startsWith(`${scope}:${params.path}/`) && key.endsWith(".codesign.json")).map(([key, content]) => ({ name: key.split("/").at(-1), path: key.slice(scope.length + 1), kind: "file", size: content.length })), truncated: false };
      if (method === "workspace.readText") {
        const content = files.get(`${scope}:${params.path}`);
        if (content === undefined) throw Object.assign(Error("file not found"), { code: "ENOENT" });
        return { content, modifiedAt: 1, revision: hash(content) };
      }
      if (method === "workspace.writeText") {
        const key = `${scope}:${params.path}`, existing = files.get(key);
        if (rejectWrites && params.path.endsWith(".codesign.json")) throw Error("Autosave write intentionally denied");
        if (collideCreate && params.expectedModifiedAt === null && params.path.endsWith(".codesign.json")) {
          collideCreate = false; files.set(key, params.content); throw Error("file already exists");
        }
        if (params.expectedModifiedAt === null && existing !== undefined) throw Error("file already exists");
        if (params.expectedRevision && params.expectedRevision !== hash(existing)) throw Error("workspace file changed since it was opened");
        files.set(key, params.content);
        if (heldWrite && params.path.endsWith(".codesign.json")) { const hold = heldWrite; heldWrite = null; hold.enter(); await hold.gate; }
        return { modifiedAt: 1, revision: hash(params.content) };
      }
      throw Error(`Unsupported ${method}`);
    });
    await page.addInitScript(gpu => {
      let scope = "/project/A", listener;
      const state = { cwd: scope, sessionId: scope, trusted: true, visible: true, busy: false,
        ...(gpu ? { capabilities: { packageAssets: { wasm: true, fetch: "package" } } } : {}),
        availableMethods: ["storage.getSnapshot", "storage.compareAndSet", "storage.get", "storage.set", "workspace.info", "workspace.list", "workspace.readText", "workspace.writeText"] };
      window.tools = {};
      window.codeshellPanel = {
        getContext: async () => ({ ...state }), call: (method, params) => window.autosaveHost(scope, method, params),
        on: (name, callback) => { if (name === "context.changed") listener = callback; }, registerTool(name, callback) { window.tools[name] = callback; },
      };
      window.switchAutosaveProject = next => { scope = next; state.cwd = next; state.sessionId = next; listener?.({ ...state }); };
    }, gpu);
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(() => !document.querySelector(".workspace").inert);
  async function rename(name) { await page.locator("#prop-document-name").fill(name); }
  async function switchFile(path) {
    await page.locator("#open-files").click();
    await page.locator("#files-list .file-row").filter({ hasText: path }).click();
  }
  return { page, files, calls, records, errors, dialogs, rename, switchFile,
    denyWrites(value = true) { rejectWrites = value; },
    collideNextCreate() { collideCreate = true; },
    pauseCall(method, matches) {
      let enter, release;
      const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
      heldCall = { method, matches, enter, gate }; t.after(() => release()); return { entered, release };
    },
    pauseWrite() {
      let enter, release;
      const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
      heldWrite = { enter, gate }; t.after(() => release()); return { entered, release };
    },
  };
}
