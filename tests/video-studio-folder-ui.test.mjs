import assert from "node:assert/strict";
import {
  enterLegacyProduction,
  readSavedEditorDocument,
  readSavedLegacyProject,
  waitForProjectSwitch,
} from "./helpers/video-studio-editor-fixture.mjs";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let output;
const artifacts = resolve(root, "artifacts/video-studio");
const media = new Map();
const errors = [];
let browser, server, url, temporary, nativeEntry, nativeSha;

function wav(frequency = 440, seconds = 4) {
  const sampleRate = 16000,
    samples = sampleRate * seconds,
    bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((i * frequency * Math.PI * 2) / sampleRate) * 12000),
      44 + i * 2,
    );
  return bytes;
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7m8AAAAASUVORK5CYII=",
  "base64",
);
async function sourceFile(folder, path, bytes, modified = 1700000000000) {
  const file = join(folder, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  await utimes(file, modified / 1000, modified / 1000);
  return file;
}

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "video-folder-ui-"));
  const [project] = selectProjects(await discoverProjects(), "video-studio");
  const isolatedOutput = resolve(temporary, "package");
  await buildProject({ ...project, output: isolatedOutput }, { log: false });
  output = resolve(isolatedOutput, "app");
  const manifest = JSON.parse(
    await readFile(resolve(output, "../.codeshell-panel/panel.json"), "utf8"),
  );
  const entry = manifest.nativeEntries?.["folder-scan"];
  assert.ok(entry?.entry && entry?.sha256, "The release must declare its installed folder scanner");
  nativeEntry = resolve(output, "..", entry.entry);
  nativeSha = createHash("sha256")
    .update(await readFile(nativeEntry))
    .digest("hex");
  assert.equal(
    nativeSha,
    entry.sha256,
    "Exercise exactly the installed, integrity-checked scanner",
  );
  await mkdir(artifacts, { recursive: true });
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const resource = media.get(pathname.slice("/media/".length));
    if (pathname.startsWith("/media/") && resource) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "");
      const start = range ? Number(range[1]) : 0;
      const end =
        range && range[2]
          ? Math.min(Number(range[2]), resource.bytes.length - 1)
          : resource.bytes.length - 1;
      if (start > end) return response.writeHead(416).end();
      response.writeHead(range ? 206 : 200, {
        "Content-Type": resource.asset.mimeType,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${resource.bytes.length}` } : {}),
      });
      return response.end(resource.bytes.subarray(start, end + 1));
    }
    const file = resolve(output, "." + pathname.replace(/\/$/, "/index.html"));
    if (!file.startsWith(output + sep)) return response.writeHead(403).end();
    try {
      response.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".mjs": "text/javascript",
            ".css": "text/css",
            ".mp3": "audio/mpeg",
          }[extname(file)] || "application/octet-stream",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'",
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
  if (temporary) await rm(temporary, { recursive: true, force: true });
  assert.deepEqual(errors, [], "No uncaught browser or CSP errors");
});
function observe(page) {
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text()))
      errors.push(message.text());
  });
}
async function readProject(page) {
  return (
    (await page.evaluate(() => window.__panelTools?.read_video_project().project ?? null)) ??
    (await readSavedLegacyProject(page))
  );
}
async function saved(page) {
  await page.waitForFunction(
    () => document.querySelector("#save-state")?.textContent === "已自动保存",
  );
}
async function waitAssets(page, count) {
  await page.waitForFunction(
    (count) => document.querySelectorAll(".asset-card").length === count,
    count,
  );
  await saved(page);
}
async function folderChoice(page, folder) {
  const choosing = page.waitForEvent("filechooser");
  await page.locator('[data-action="import-folder"]').click();
  const chooser = await choosing;
  assert.equal(await chooser.element().getAttribute("webkitdirectory"), "");
  await chooser.setFiles(folder);
}
async function addCut(page, id, name) {
  await page.locator(`[data-rough-source="${id}"]`).click();
  await page.locator('[data-roughcut-field="name"]').fill(name);
  await page.locator('[data-action="roughcut-save"]').click();
  await saved(page);
}
async function playSource(page, id) {
  await page.locator('[data-tab="media"]').click();
  await page.locator(`[data-rough-source="${id}"]`).click();
  await page.waitForFunction(() => !document.querySelector(".roughcut-notice"));
  await page.locator('[data-action="roughcut-play"]').click();
  await page.waitForFunction(
    () => Number(document.querySelector("[data-roughcut-scrub]")?.value) > 0,
  );
  await page.locator('[data-action="roughcut-play"]').click();
}
function timeline(project) {
  return {
    clips: project.clips,
    audioClips: project.audioClips,
    captions: project.captions,
    roughCuts: project.roughCuts,
  };
}
async function editorComposition(page) {
  return {
    sequences: (await readSavedEditorDocument(page)).sequences,
    roughCuts: (await readProject(page)).roughCuts,
  };
}

test("a real recursive folder chooser preserves same-name sources, ignores unrelated files, avoids duplicate imports and restores bytes after a full browser restart", async () => {
  const folder = join(temporary, "一次性素材"),
    profile = join(temporary, "browser-profile");
  await sourceFile(folder, "a/voice.wav", wav(440));
  await sourceFile(folder, "b/voice.wav", wav(660));
  await sourceFile(folder, "images/still.png", png);
  await sourceFile(folder, "notes.txt", "ignore me");
  await sourceFile(folder, ".hidden/ignore.wav", wav());
  await sourceFile(folder, "empty.wav", "");
  let context;
  async function open() {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 1440, height: 960 },
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
    const page = await context.newPage();
    observe(page);
    await page.goto(`${url}/?legacyWorkspace=1`);
    await enterLegacyProduction(page);
    await page.locator('[data-action="import-folder"]').waitFor();
    return page;
  }
  try {
    let page = await open();
    await folderChoice(page, folder);
    await waitAssets(page, 3);
    let project = await readProject(page);
    assert.equal(project.clips.length, 0, "A folder import must not populate the timeline");
    const audio = project.assets.filter((asset) => asset.kind === "audio");
    assert.equal(audio.length, 2);
    assert.equal(audio[0].name, audio[1].name);
    assert.equal(audio[0].size, audio[1].size);
    assert.equal(audio[0].lastModified, audio[1].lastModified);
    assert.notEqual(audio[0].id, audio[1].id);
    assert.deepEqual(audio.map((asset) => asset.sourcePath).sort(), [
      "一次性素材/a/voice.wav",
      "一次性素材/b/voice.wav",
    ]);
    assert.ok(
      project.assets.every((asset) => !asset.mediaId),
      "Exercise real IndexedDB source custody",
    );
    await folderChoice(page, folder);
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent.includes("已跳过"),
    );
    assert.deepEqual(
      await readProject(page),
      project,
      "Selecting the same folder again adds no assets or revision",
    );
    await sourceFile(folder, "a/voice.wav", wav(880));
    await folderChoice(page, folder);
    await waitAssets(page, 4);
    const changed = await readProject(page);
    assert.equal(
      changed.assets.filter((asset) => asset.sourcePath === "一次性素材/a/voice.wav").length,
      2,
      "Same path, size and timestamp with new bytes must create a new source version",
    );
    assert.deepEqual(timeline(changed), timeline(project));
    assert.ok(changed.assets.some((asset) => asset.id === audio[0].id));
    for (const asset of changed.assets)
      assert.equal(
        await page.locator(`[data-asset="${asset.id}"] .asset-info strong`).getAttribute("title"),
        asset.sourcePath,
      );
    project = changed;
    const still = project.assets.find((asset) => asset.kind === "image");
    await page.locator(`[data-add-asset="${still.id}"]`).click();
    await saved(page);
    await addCut(page, audio[0].id, "原录音保留范围");
    project = await readProject(page);
    await page.locator('[data-tab="media"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-action="import-folder"]').scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () =>
        !document.querySelector("#toast.visible") &&
        getComputedStyle(document.querySelector("#toast")).opacity === "0",
    );
    await page.screenshot({ path: resolve(artifacts, "folder-import-390.png"), fullPage: true });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    await context.close();
    context = undefined;
    page = await open();
    try {
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".asset-card").length === 4 &&
          document.querySelectorAll(".asset-card.missing").length === 0,
      );
    } catch (error) {
      const diagnostic = await page.evaluate(async () => {
        const items = await new Promise((resolve, reject) => {
          const request = indexedDB.open("mimi-studio-recordings", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result,
              transaction = db.transaction("recordings", "readonly"),
              rows = transaction.objectStore("recordings").getAll();
            transaction.oncomplete = () => {
              db.close();
              resolve(rows.result);
            };
          };
        });
        return {
          project: JSON.parse(localStorage.getItem("video-studio-project-v1")),
          missing: [...document.querySelectorAll(".asset-card.missing")].map(
            (card) => card.dataset.asset,
          ),
          toast: document.querySelector("#toast")?.textContent,
          cached: await Promise.all(
            items.map(async (item) => {
              try {
                return { id: item.id, bytes: (await item.blob.arrayBuffer()).byteLength };
              } catch (error) {
                return { id: item.id, error: String(error) };
              }
            }),
          ),
        };
      });
      throw new Error(`Original media did not restore: ${JSON.stringify(diagnostic)}`, {
        cause: error,
      });
    }
    assert.deepEqual(
      await readProject(page),
      project,
      "Restart preserves IDs, source paths and the exact original cuts",
    );
    await playSource(page, audio[0].id);
    await playSource(page, audio[1].id);
  } finally {
    await context?.close();
  }
});

test("a folder picker opened for the old project cannot import into a newly created project", async () => {
  const folder = join(temporary, "旧工程素材");
  await sourceFile(folder, "voice.wav", wav());
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  observe(page);
  try {
    await page.goto(`${url}/?legacyWorkspace=1`);
    await enterLegacyProduction(page);
    await page.locator('[data-action="import-folder"]').waitFor();
    await saved(page);
    const previous = await readProject(page);
    assert.ok(previous?.id, "The old project is stored before the picker opens");
    const choosing = page.waitForEvent("filechooser");
    await page.locator('[data-action="import-folder"]').click();
    const chooser = await choosing;
    await page.getByRole("button", { name: "新建工程", exact: true }).click();
    await waitForProjectSwitch(page, previous.id, readProject);
    const project = await readProject(page);
    await chooser.setFiles(folder);
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent.includes("工程已切换"),
    );
    assert.deepEqual(await readProject(page), project);
    assert.equal(await page.locator(".asset-card").count(), 0);
  } finally {
    await page.close();
  }
});

/** A domain-neutral desktop fixture executes the installed scanner and captures real source bytes. */
function desktopHost(folder) {
  const calls = [],
    processes = new Map(),
    grants = new Map(),
    documents = new Map(),
    storage = new Map();
  const executableHandle = randomUUID(),
    entryHandle = randomUUID();
  const resources = new Map();
  let publication;
  const methods = [
    "filesystem.pickDirectory",
    "process.find",
    "process.resolveEntry",
    "process.spawn",
    "process.get",
    "process.cancel",
    "resources.capture",
    "resources.get",
    "resources.list",
    "media.document.get",
    "media.document.set",
    "media.document.versions",
    "storage.get",
    "storage.set",
  ];
  async function invoke(method, params = {}) {
    calls.push({ method, params: structuredClone(params) });
    if (method === "storage.get") return structuredClone(storage.get(params.key) ?? null);
    if (method === "storage.set") {
      storage.set(params.key, structuredClone(params.value));
      return true;
    }
    if (method === "media.document.get")
      return structuredClone(documents.get(params.key) ?? { revision: 0, data: null });
    if (method === "media.document.set") {
      const candidate =
        params.data?.format === "video-studio-packed-document" ? params.data.data : params.data;
      if (params.key === "video-studio-current" && candidate?.assets?.length && publication) {
        const waiting = publication;
        publication = undefined;
        waiting.started();
        await waiting.pending;
      }
      const previous = documents.get(params.key) ?? { revision: 0 };
      assert.equal(params.baseRevision, previous.revision);
      const next = {
        revision: previous.revision + 1,
        data: structuredClone(params.data),
        updatedAt: Date.now(),
        label: params.label ?? "保存",
      };
      documents.set(params.key, next);
      return next;
    }
    if (method === "media.document.versions") return { versions: [] };
    if (method === "filesystem.pickDirectory") {
      const handle = randomUUID();
      grants.set(handle, folder);
      return { handle, name: basename(folder) };
    }
    if (method === "process.find") {
      assert.equal(params.name, "node");
      return { available: true, handle: executableHandle, name: "node" };
    }
    if (method === "process.resolveEntry") {
      assert.equal(params.name, "folder-scan");
      assert.equal(params.executableHandle, executableHandle);
      return { handle: entryHandle, name: "folder-scan", sha256: nativeSha };
    }
    if (method === "process.spawn") {
      assert.equal(params.executableHandle, executableHandle);
      assert.equal(params.entryHandle, entryHandle);
      assert.deepEqual(params.args, []);
      assert.ok(grants.has(params.directoryHandle));
      const processId = randomUUID(),
        row = { events: [], status: "running", cancelRequested: false };
      const child = spawn(process.execPath, [nativeEntry], {
        cwd: grants.get(params.directoryHandle),
        stdio: ["ignore", "pipe", "pipe"],
      });
      row.child = child;
      processes.set(processId, row);
      const event = (event, payload) =>
        row.events.push({
          event,
          sequence: row.events.length + 1,
          payload: { processId, ...payload },
        });
      for (const stream of ["stdout", "stderr"])
        child[stream].setEncoding("utf8").on("data", (text) => {
          for (let at = 0; at < text.length; at += 16384)
            event("process.output", { stream, text: text.slice(at, at + 16384) });
        });
      child.on("error", (error) => errors.push(error.message));
      child.on("close", (code, signal) => {
        row.status = "exited";
        row.code = code;
        row.signal = signal;
        event("process.exit", { code, signal });
      });
      return { processId };
    }
    if (method === "process.get") {
      const row = processes.get(params.processId);
      assert.ok(row);
      assert.equal(params.limit, 128);
      assert.ok(Number.isSafeInteger(params.afterSequence));
      // Real output is intentionally paged one event at a time, including terminal receipts.
      const events = row.events
        .filter((event) => event.sequence > params.afterSequence)
        .slice(0, 1);
      const nextSequence = events.at(-1)?.sequence ?? params.afterSequence;
      return {
        found: true,
        processId: params.processId,
        status: row.status,
        code: row.code,
        signal: row.signal,
        events,
        nextSequence,
        sequence: row.events.length,
        hasMore: nextSequence < row.events.length,
        truncated: false,
        cancelRequested: row.cancelRequested,
      };
    }
    if (method === "process.cancel") {
      const row = processes.get(params.processId);
      if (row) {
        row.cancelRequested = true;
        row.child.kill("SIGTERM");
      }
      return { cancelled: true };
    }
    if (method === "resources.capture") {
      assert.ok(grants.has(params.directoryHandle));
      assert.ok(!params.path.startsWith("/") && !params.path.split("/").includes(".."));
      const path = join(grants.get(params.directoryHandle), params.path),
        bytes = await readFile(path);
      assert.equal(
        params.expectedBytes,
        bytes.length,
        "Capture must carry the stable scan byte size",
      );
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const asset = {
        id: `asset-${sha256}`,
        sha256,
        bytes: bytes.length,
        name: params.name,
        mimeType: params.mimeType,
        createdAt: Date.now(),
      };
      resources.set(asset.id, asset);
      media.set(asset.id, { bytes, asset });
      return { asset };
    }
    if (method === "resources.get") {
      assert.ok(resources.has(params.id));
      return { asset: resources.get(params.id) };
    }
    if (method === "resources.list")
      return { assets: [...resources.values()], total: resources.size };
    throw new Error(`Unexpected public Host method ${method}`);
  }
  return {
    calls,
    storage,
    documents,
    holdNextPublication() {
      let started, release;
      const entered = new Promise((done) => {
        started = done;
      });
      const pending = new Promise((done) => {
        release = done;
      });
      publication = { started, pending, release };
      return { entered, release };
    },
    async attach(page) {
      await page.exposeBinding("__folderHostInvoke", (_, method, params) => invoke(method, params));
      await page.addInitScript(
        ({ methods }) => {
          window.__panelTools = {};
          window.codeshellPanel = {
            getContext: async () => ({
              cwd: "/isolated/folder-ui",
              theme: "dark",
              apiVersion: 14,
              availableMethods: methods,
              capabilities: {
                bridge: {
                  maxCallsPerWindow: 10000,
                  maxTransferCallsPerWindow: 10000,
                  rateWindowMs: 1000,
                },
              },
            }),
            call: (method, params) => window.__folderHostInvoke(method, params),
            callResult: async (method, params) => ({
              ok: true,
              value: await window.__folderHostInvoke(method, params),
            }),
            on: () => () => {},
            registerTool(name, handler) {
              window.__panelTools[name] = handler;
              return () => {
                delete window.__panelTools[name];
              };
            },
          };
        },
        { methods },
      );
    },
    async close() {
      publication?.release();
      for (const row of processes.values()) if (row.status !== "exited") row.child.kill("SIGTERM");
    },
  };
}

test("an authorized desktop folder scans the installed tool, imports new and changed sources without editing clips, pauses, disconnects and requires a new grant after reopening", async () => {
  const folder = join(temporary, "持续素材");
  await sourceFile(folder, "a/voice.wav", wav(440));
  await sourceFile(folder, "images/still.png", png);
  const host = desktopHost(folder);
  let page;
  async function open() {
    page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    observe(page);
    await host.attach(page);
    await page.goto(`${url}/?legacyWorkspace=1`);
    await enterLegacyProduction(page);
    await page.waitForFunction(
      () => !document.querySelector('[data-action="folder-connect"]')?.disabled,
    );
  }
  async function settled() {
    await page.waitForFunction(
      () =>
        document.querySelector(".folder-status")?.textContent.includes("已导入") &&
        !document.querySelector('[data-action="folder-cancel"]'),
    );
  }
  async function check() {
    await page.locator('[data-action="folder-scan"]').click();
    await settled();
  }
  try {
    await open();
    await page.locator('[data-action="folder-connect"]').click();
    await settled();
    await waitAssets(page, 2);
    let project = await readProject(page);
    assert.equal(project.clips.length, 0);
    const original = project.assets.find((asset) => asset.kind === "audio"),
      still = project.assets.find((asset) => asset.kind === "image");
    assert.equal(original.sourcePath, "a/voice.wav");
    assert.match(original.mediaId, /^asset-[a-f0-9]{64}$/);
    await page.locator(`[data-add-asset="${still.id}"]`).click();
    await saved(page);
    assert.ok(
      (await readSavedEditorDocument(page)).sequences[0].clips.some(
        (clip) => clip.assetId === still.id,
      ),
      `The still image is inserted into the timeline: ${await page.locator("#toast").textContent()}`,
    );
    await page.locator(`[data-add-asset="${original.id}"]`).click();
    await saved(page);
    assert.ok(
      (await readSavedEditorDocument(page)).sequences[0].clips.some(
        (clip) => clip.assetId === original.id,
      ),
      `The source audio is inserted into the timeline: ${await page.locator("#toast").textContent()}`,
    );
    await addCut(page, original.id, "旧版本的保留段");
    const composition = await editorComposition(page);
    assert.ok(
      composition.sequences[0].clips.some(
        (clip) =>
          clip.assetId === original.id &&
          composition.sequences[0].tracks.some(
            (track) => track.id === clip.trackId && track.kind === "audio",
          ),
      ),
      "The original source is actually used by a saved audio clip",
    );
    await page.locator('[data-tab="media"]').click();
    const initialCaptures = host.calls.filter((call) => call.method === "resources.capture").length;
    await check();
    assert.equal(
      host.calls.filter((call) => call.method === "resources.capture").length,
      initialCaptures,
      "An unchanged scan must not recapture sources",
    );
    await sourceFile(folder, "b/voice.wav", wav(660));
    await check();
    await waitAssets(page, 3);
    assert.deepEqual(await editorComposition(page), composition);
    await sourceFile(folder, "a/voice.wav", wav(880), 1700000005000);
    await check();
    await waitAssets(page, 4);
    project = await readProject(page);
    const changed = project.assets.filter((asset) => asset.sourcePath === "a/voice.wav");
    assert.equal(changed.length, 2);
    assert.notEqual(changed[0].mediaId, changed[1].mediaId);
    assert.ok(
      changed.some((asset) => asset.id === original.id && asset.mediaId === original.mediaId),
    );
    assert.deepEqual(
      await editorComposition(page),
      composition,
      "New source versions preserve the exact existing timeline and cuts",
    );
    await sourceFile(folder, "automatic/new.wav", wav(330));
    await page.waitForFunction(
      () => document.querySelectorAll(".asset-card").length === 5,
      undefined,
      { timeout: 30000 },
    );
    await settled();
    await saved(page);
    assert.deepEqual(await editorComposition(page), composition);
    await page.locator('[data-action="folder-toggle"]').click();
    await page.waitForFunction(() =>
      document.querySelector(".folder-connection")?.textContent.includes("已暂停自动检查"),
    );
    await sourceFile(folder, "paused/later.wav", wav(220));
    const pausedStarts = host.calls.filter((call) => call.method === "process.spawn").length;
    await page.waitForTimeout(16000);
    assert.equal(
      host.calls.filter((call) => call.method === "process.spawn").length,
      pausedStarts,
      "Paused connections do not poll or import",
    );
    assert.equal((await readProject(page)).assets.length, 5);
    await page.screenshot({
      path: resolve(artifacts, "folder-connection-1440.png"),
      fullPage: true,
    });
    const beforeReload = await readProject(page);
    const beforeReloadComposition = await editorComposition(page);
    await page.close();
    page = undefined;
    await open();
    await page.waitForFunction(() =>
      document.querySelector(".folder-connection")?.textContent.includes("待重新连接"),
    );
    assert.deepEqual(await readProject(page), beforeReload);
    assert.deepEqual(await editorComposition(page), beforeReloadComposition);
    await playSource(page, original.id);
    await page.locator('[data-tab="media"]').click();
    await page.locator('[data-action="folder-reconnect"]').click();
    await settled();
    await waitAssets(page, 6);
    assert.equal(
      (await readProject(page)).assets.filter((asset) => asset.sourcePath === "a/voice.wav").length,
      2,
      "Reconnection does not duplicate an immutable managed source",
    );
    await page.locator('[data-action="folder-remove"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".folder-connection").length === 0);
    assert.equal((await readProject(page)).assets.length, 6);
    await playSource(page, original.id);
    assert.ok(
      host.calls.some(
        (call) => call.method === "process.resolveEntry" && call.params.name === "folder-scan",
      ),
    );
    assert.ok(
      host.calls.some((call) => call.method === "process.get" && call.params.afterSequence > 0),
      "Terminal output was drained through the real cursor contract",
    );
    assert.ok(
      host.calls
        .filter((call) => call.method === "resources.capture")
        .every(
          (call) =>
            Number.isSafeInteger(call.params.expectedBytes) && call.params.expectedBytes > 0,
        ),
    );
  } finally {
    await page?.close();
    await host.close();
  }
});

test("stopping while a successful source publication is pending keeps the saved asset visible and playable after reopening", async () => {
  const folder = join(temporary, "停止时保存的素材");
  await sourceFile(folder, "voice.wav", wav(550));
  const host = desktopHost(folder);
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  observe(page);
  let held, timer;
  try {
    await host.attach(page);
    await page.goto(`${url}/?legacyWorkspace=1`);
    await enterLegacyProduction(page);
    await page.waitForFunction(
      () => !document.querySelector('[data-action="folder-connect"]')?.disabled,
    );
    held = host.holdNextPublication();
    await page.locator('[data-action="folder-connect"]').click();
    await Promise.race([
      held.entered,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("Source never reached durable publication")), 15000);
      }),
    ]);
    clearTimeout(timer);
    await page.locator('[data-action="folder-cancel"]').click();
    held.release();
    await waitAssets(page, 1);
    const before = await readProject(page);
    assert.equal(before.assets[0].sourcePath, "voice.wav");
    assert.equal(before.clips.length, 0);
    assert.equal(await page.locator(".asset-card.missing").count(), 0);
    await page.reload();
    await enterLegacyProduction(page);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".asset-card").length === 1 &&
        !document.querySelector(".asset-card.missing"),
    );
    assert.deepEqual(
      await readProject(page),
      before,
      "Successful durable publication cannot disappear after a late stop",
    );
    await playSource(page, before.assets[0].id);
  } finally {
    clearTimeout(timer);
    held?.release();
    await page.close();
    await host.close();
  }
});
