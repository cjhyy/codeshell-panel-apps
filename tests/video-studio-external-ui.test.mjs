import { enterLegacyProduction } from "./helpers/video-studio-editor-fixture.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";

test("referenced original previews, retains rough cuts across fresh browser contexts, and reconnects without a capture or upload", async () => {
  const temp = await mkdtemp(join(tmpdir(), "video-reference-ui-"));
  const [projectBuild] = selectProjects(await discoverProjects(), "video-studio");
  const isolatedOutput = join(temp, "package");
  await buildProject({ ...projectBuild, output: isolatedOutput }, { log: false });
  const original = join(temp, "original.mp4"),
    relocated = join(temp, "relocated.mp4");
  const result = spawnSync(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30:duration=4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      original,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const identity = await stat(original);
  const reference = {
    id: `external-${"e".repeat(64)}`,
    kind: "external",
    name: "original.mp4",
    mimeType: "video/mp4",
    bytes: identity.size,
    lastModified: Math.trunc(identity.mtimeMs),
    createdAt: Date.now(),
    state: "available",
  };
  const documents = new Map(),
    storage = new Map(),
    calls = [],
    reads = [],
    errors = [];
  let location = original,
    pickerLocation = original;
  const output = resolve(isolatedOutput, "app");
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://test").pathname;
      if (pathname === `/media/${reference.id}`) {
        const info = await stat(location);
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(info.size - 1, Number(range[2])) : info.size - 1;
        reads.push({ start, end, location });
        response.writeHead(range ? 206 : 200, {
          "Content-Type": "video/mp4",
          "Content-Length": end - start + 1,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
          ...(range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {}),
        });
        createReadStream(location, { start, end }).pipe(response);
        return;
      }
      const path = resolve(output, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!path.startsWith(output + sep)) {
        response.writeHead(403).end();
        return;
      }
      const bytes = await readFile(path);
      response.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".css": "text/css",
            ".mjs": "text/javascript",
            ".mp3": "audio/mpeg",
          }[extname(path)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  let context, page;
  async function open() {
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.exposeFunction("__referenceCall", async (method, params = {}) => {
      calls.push({ method, params });
      if (method === "media.status") return { persistent: false };
      if (method === "media.document.get")
        return documents.get(params.key) ?? { revision: 0, data: null };
      if (method === "media.document.set") {
        const old = documents.get(params.key) ?? { revision: 0 };
        assert.equal(params.baseRevision, old.revision);
        const next = {
          revision: old.revision + 1,
          data: params.data,
          label: params.label,
          updatedAt: Date.now(),
        };
        documents.set(params.key, structuredClone(next));
        return next;
      }
      if (method === "media.document.versions") return { versions: [] };
      if (method === "storage.get") return storage.get(params.key) ?? null;
      if (method === "storage.set") {
        storage.set(params.key, params.value);
        return true;
      }
      if (method === "resources.references.pick") {
        const selected = await stat(pickerLocation);
        if (params.id) {
          assert.equal(params.id, reference.id);
          assert.equal(params.multiple, false);
          assert.equal(selected.ino, identity.ino);
          assert.equal(selected.dev, identity.dev);
        }
        location = pickerLocation;
        return { references: [reference] };
      }
      if (method === "resources.references.get") {
        const present = await stat(location).catch(() => null);
        return {
          reference: {
            ...reference,
            state: !present
              ? "missing"
              : present.ino === identity.ino && present.dev === identity.dev
                ? "available"
                : "changed",
          },
        };
      }
      throw new Error(`Unexpected reference workflow call: ${method}`);
    });
    await page.addInitScript(() => {
      window.__referenceTools = {};
      window.__referenceVideos = [];
      const createElement = document.createElement.bind(document);
      document.createElement = function (name, ...args) {
        const element = createElement(name, ...args);
        if (name === "video") window.__referenceVideos.push(element);
        return element;
      };
      window.codeshellPanel = {
        getContext: async () => ({
          cwd: "/isolated/reference-ui",
          availableMethods: [
            "media.document.get",
            "media.document.set",
            "media.document.versions",
            "storage.get",
            "storage.set",
            "resources.references.pick",
            "resources.references.get",
            "resources.references.create",
            "filesystem.pickDirectory",
            "process.find",
            "process.resolveEntry",
            "process.spawn",
            "process.get",
            "process.cancel",
            "resources.capture",
          ],
        }),
        registerTool: (name, handler) => {
          window.__referenceTools[name] = handler;
          return () => {};
        },
        on: () => () => {},
        call: (method, params) => window.__referenceCall(method, params),
      };
    });
    await page.goto(url);
    await enterLegacyProduction(page);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-action="folder-mode-reference"]')
          ?.getAttribute("aria-pressed") === "true",
    );
  }
  async function project() {
    return page.evaluate(() => window.__referenceTools.read_video_project().project);
  }
  async function pixels() {
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#preview");
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      for (let i = 0; i < data.length; i += 400)
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return colors.size > 20;
    });
  }
  try {
    await open();
    await page.locator('[data-action="import"]').first().click();
    await page.waitForFunction(() => document.querySelectorAll(".asset-card").length === 1);
    const imported = await project();
    const asset = imported.assets[0];
    assert.equal(asset.mediaId, reference.id);
    assert.equal(imported.clips.length, 0);
    await page.locator(`[data-preview-asset="${asset.id}"] .asset-thumbnail`).click();
    await pixels();
    await page.locator('[data-action="trim-source"]').click();
    await page.locator('[data-roughcut-field="in"]').fill("1");
    await page.locator('[data-roughcut-field="out"]').fill("3");
    await page.locator('[data-action="roughcut-save"]').click();
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    const kept = await project();
    assert.deepEqual(
      kept.roughCuts.map((cut) => [cut.inFrame, cut.outFrame]),
      [[30, 90]],
    );
    await context.close();
    await open();
    await page.waitForFunction(
      () => document.querySelectorAll(".asset-card:not(.missing)").length === 1,
    );
    assert.deepEqual((await project()).roughCuts, kept.roughCuts);
    await page.locator(`[data-preview-asset="${asset.id}"]`).scrollIntoViewIfNeeded();
    await page
      .locator(`[data-preview-asset="${asset.id}"] .asset-thumbnail img`)
      .waitFor({ state: "visible" });
    assert.equal(
      await page.locator(`[data-preview-asset="${asset.id}"] .asset-thumbnail img`).count(),
      1,
      "Restart regenerates the referenced video's actual thumbnail",
    );
    await page.locator(`[data-preview-asset="${asset.id}"] .asset-thumbnail`).click();
    await pixels();
    // Invalidate an already-loaded decoder in this same session, then reconnect
    // the same reference URL. A connectManaged no-op must not retain that decoder.
    await rename(original, relocated);
    pickerLocation = relocated;
    await page.evaluate(() => {
      const element = window.__referenceVideos.find(
        (video) => video.hasAttribute("src") && video.readyState >= 2 && !video.error,
      );
      if (!element) throw new Error("The source preview must have a real loaded decoder");
      window.__referenceInvalidatedVideo = element;
      element.src += "?reload-after-move";
      element.load();
    });
    await page.waitForFunction(() => !!window.__referenceInvalidatedVideo?.error);
    await page.locator(`[data-action="reconnect-media"][data-id="${asset.id}"]`).click();
    await page.waitForFunction(
      () =>
        !window.__referenceInvalidatedVideo.hasAttribute("src") &&
        window.__referenceVideos.some(
          (video) =>
            video !== window.__referenceInvalidatedVideo &&
            video.hasAttribute("src") &&
            video.readyState >= 2 &&
            !video.error,
        ),
    );
    await pixels();
    assert.deepEqual((await project()).roughCuts, kept.roughCuts);
    await context.close();
    await rename(relocated, original);
    pickerLocation = original;
    await open();
    await page.waitForFunction(() => document.querySelectorAll(".asset-card.missing").length === 1);
    await page.locator(`[data-action="reconnect-media"][data-id="${asset.id}"]`).click();
    await page.waitForFunction(() => !document.querySelector(".asset-card.missing"));
    await page.locator(`[data-preview-asset="${asset.id}"] .asset-thumbnail`).click();
    await pixels();
    assert.deepEqual((await project()).roughCuts, kept.roughCuts);
    assert.equal((await project()).assets[0].mediaId, reference.id);
    assert.ok(
      reads.length > 0 &&
        reads.every((read) => read.location === original || read.location === relocated),
    );
    assert.equal(
      calls.filter(
        (call) =>
          call.method === "resources.capture" ||
          call.method.startsWith("resources.upload.") ||
          call.method === "tasks.start",
      ).length,
      0,
    );
    const artifacts = resolve("artifacts/video-studio");
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({
      path: join(artifacts, "referenced-source-preview.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
  } catch (error) {
    await mkdir(resolve("artifacts/video-studio"), { recursive: true });
    await page?.screenshot({
      path: resolve("artifacts/video-studio/reference-failure.png"),
      fullPage: true,
    });
    throw error;
  } finally {
    await context?.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});
