import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  MAX_DESIGN_CANVAS_SIZE,
  normalizeDesignDocument,
  serializeDesignDocument,
  exportDesignSvg,
} from "../../../apps/design-studio/app/document.mjs";
import {
  importFigmaJson,
  prepareFigmaImport,
  createFigmaTransfer,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import {
  createFigmaBinding,
  createFigmaPatch,
} from "../../../apps/design-studio/app/figma-binding.mjs";
import { auditDesignPages } from "../../../apps/design-studio/app/audit.mjs";
import { createDesignIndexPersistencePlan } from "../../../apps/design-studio/app/document-index.mjs";
import { readDesignSourcePath } from "../../../apps/design-studio/app/tools/check-design.mjs";
import { preparePluginFile } from "../../../apps/design-studio/app/figma-plugin/v3-input.mjs";
import { longFigmaSource } from "./fixtures/long-canvas.mjs";

const hash = async (text) => createHash("sha256").update(text).digest("hex");
const cli = new URL("../../../apps/design-studio/app/tools/check-design.mjs", import.meta.url);

test("a 1208-layer long Figma page expands only its canvas and preserves every editable source position", async () => {
  const source = longFigmaSource(),
    original = JSON.stringify(source);
  const result = await prepareFigmaImport(source);
  assert.equal(result.stats.importedNodes, 1208);
  assert.equal(result.stats.skippedNodes, 0);
  assert.deepEqual(result.document.canvas, { width: 4458, height: 11322, background: "#f5f5f2" });
  assert.equal(result.mapping.length, 1208);
  assert.equal(JSON.stringify(source), original);
  assert.equal(result.pageMappings[0].offsetX, 1);
  const nodes = new Map(result.document.nodes.map((node) => [node.id, node]));
  const frame = nodes.get("figma-1-0");
  assert.deepEqual([frame.x, frame.y, frame.width, frame.height], [0, 0, 4458, 11322]);
  for (const raw of source.document.children[0].children[0].children) {
    const node = nodes.get(raw.id.replace(":", "-").replace(/^/u, "figma-"));
    assert.equal(node.parentId, frame.id);
    assert.equal(node.name, raw.name);
    assert.deepEqual(
      [node.x, node.y, node.width, node.height],
      [
        raw.absoluteBoundingBox.x + 1,
        raw.absoluteBoundingBox.y,
        raw.absoluteBoundingBox.width,
        raw.absoluteBoundingBox.height,
      ],
    );
  }
  assert.deepEqual(auditDesignPages(result.document), []);
  assert.deepEqual(createFigmaPatch(createFigmaBinding(result), result.document).operations, []);
  const svg = exportDesignSvg(result.document);
  assert.match(svg, /width="4458" height="11322" viewBox="0 0 4458 11322"/u);
  assert.ok(result.warnings.every((warning) => warning.code !== "canvas-extent"));
});

test("positive source positions inside the enlarged finite canvas do not get rebased or scaled", () => {
  const result = importFigmaJson({
    type: "CANVAS",
    id: "0:1",
    children: [
      {
        id: "1:1",
        type: "RECTANGLE",
        name: "Far item",
        absoluteBoundingBox: { x: 16000, y: 19000, width: 80, height: 1000 },
      },
    ],
  });
  assert.deepEqual([result.document.nodes[0].x, result.document.nodes[0].y], [16000, 19000]);
  assert.deepEqual([result.document.canvas.width, result.document.canvas.height], [16080, 20000]);
  assert.equal(result.pageMappings[0].offsetX, 0);
  assert.equal(result.pageMappings[0].offsetY, 0);
});

test("the codec and published JSON schema keep a finite 20000px boundary and the existing node coordinate limits", async () => {
  const document = JSON.parse(serializeDesignDocument(importFigmaJson(longFigmaSource()).document));
  document.canvas = {
    width: MAX_DESIGN_CANVAS_SIZE,
    height: MAX_DESIGN_CANVAS_SIZE,
    background: "#ffffff",
  };
  assert.equal(normalizeDesignDocument(document).canvas.height, 20000);
  for (const value of [99, 20000.001, Infinity]) {
    assert.throws(
      () => normalizeDesignDocument({ ...document, canvas: { ...document.canvas, height: value } }),
      /canvas.height/u,
    );
  }
  const frame = document.pages[0].children[0];
  frame.y = 20000;
  assert.equal(normalizeDesignDocument(document).nodes[0].y, 20000);
  frame.y = 20001;
  assert.throws(() => normalizeDesignDocument(document), /\.y/u);
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../../../apps/design-studio/app/formats/codeshell-design-v3.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(schema.$defs.canvas.properties.width.maximum, MAX_DESIGN_CANVAS_SIZE);
  assert.equal(schema.$defs.canvas.properties.height.maximum, MAX_DESIGN_CANVAS_SIZE);
});

test("content beyond the finite canvas remains editable with an explicit extent warning instead of being dropped or scaled", () => {
  const result = importFigmaJson({
    type: "CANVAS",
    id: "0:1",
    children: [
      {
        id: "1:1",
        type: "RECTANGLE",
        name: "Beyond bounded canvas",
        absoluteBoundingBox: { x: 19990, y: 0, width: 80, height: 100 },
      },
    ],
  });
  assert.equal(result.document.canvas.width, 20000);
  assert.equal(result.stats.importedNodes, 1);
  assert.deepEqual([result.document.nodes[0].x, result.document.nodes[0].width], [19990, 80]);
  assert.ok(result.warnings.some((warning) => warning.code === "canvas-extent"));
  assert.ok(
    auditDesignPages(result.document).some((issue) => issue.code === "layout.canvas-overflow"),
  );
});

test("long canvases survive indexed storage, the Node CLI and the browser/plugin file adapter without coordinate changes", async (t) => {
  const document = importFigmaJson(longFigmaSource()).document;
  const plan = await createDesignIndexPersistencePlan({ document, sha256: hash });
  const project = await mkdtemp(join(tmpdir(), "design-long-canvas-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  for (const part of plan.parts) {
    await mkdir(dirname(join(project, part.path)), { recursive: true });
    await writeFile(join(project, part.path), part.content);
  }
  const path = join(project, "designs/long.codesign.json");
  await writeFile(path, plan.primarySource);
  const restored = await readDesignSourcePath(path, { workspaceRoot: project });
  assert.equal(restored.document.canvas.height, 11322);
  assert.equal(serializeDesignDocument(restored.document), serializeDesignDocument(document));
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [fileURLToPath(cli), "--strict-audit", path],
    { cwd: project },
  );
  assert.match(stdout, /1208 layer/u);
  const canonical = serializeDesignDocument(document);
  const prepared = await preparePluginFile(canonical);
  assert.equal(prepared.transfer.canvas.height, 11322);
  assert.equal(prepared.summary.nodes, 1208);
  assert.equal(prepared.transfer.pages[0].children[0].height, 11322);
  const maxDocument = JSON.parse(canonical);
  maxDocument.canvas.width = 20000;
  maxDocument.canvas.height = 20000;
  assert.equal((await preparePluginFile(JSON.stringify(maxDocument))).transfer.canvas.width, 20000);
  maxDocument.canvas.height = 20001;
  await assert.rejects(preparePluginFile(JSON.stringify(maxDocument)), /canvas.height/u);
  assert.equal(createFigmaTransfer(document).stats.exportedNodes, 1208);
});

test("the live Panel opens long canvases and raster screenshots retain the 2M pixel, 4096px height and transport budgets", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
  const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
  await page.route("https://long-canvas.test/**", async (route) => {
    const path = resolve(
      root,
      decodeURIComponent(new URL(route.request().url()).pathname.slice(1)) || "index.html",
    );
    if (!path.startsWith(`${root}${sep}`)) return route.fulfill({ status: 404, body: "missing" });
    try {
      return route.fulfill({
        body: await readFile(path),
        contentType: {
          ".html": "text/html",
          ".mjs": "text/javascript",
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
        }[extname(path)],
      });
    } catch {
      return route.fulfill({ status: 404, body: "missing" });
    }
  });
  const document = importFigmaJson(longFigmaSource()).document;
  await page.addInitScript(
    ({ source }) => {
      const path = "designs/long.codesign.json";
      window.tools = {};
      window.codeshellPanel = {
        getContext: async () => ({
          trusted: true,
          visible: true,
          cwd: "/workspace",
          sessionId: "long-canvas",
          projectScope: { version: 1, environmentId: "test", projectId: "long", rootId: "root" },
          availableMethods: [
            "workspace.info",
            "workspace.list",
            "workspace.readText",
            "workspace.writeText",
            "storage.get",
            "storage.set",
            "storage.delete",
            "storage.getSnapshot",
            "storage.compareAndSet",
          ],
        }),
        on() {},
        registerTool(name, callback) {
          window.tools[name] = callback;
        },
        async call(method, params) {
          if (method === "workspace.info")
            return { root: "/workspace", name: "Long", trusted: true };
          if (method === "workspace.list") return { entries: [], truncated: false };
          if (method === "workspace.readText") {
            if (params.path !== path) throw Error("ENOENT: no such file or directory");
            return { path, content: source, modifiedAt: 1, revision: "long-v1" };
          }
          if (method === "storage.get")
            return params.key.startsWith("lastPath.")
              ? { workspaceRoot: "/workspace", path }
              : null;
          if (method === "storage.getSnapshot")
            return { exists: false, value: null, revision: null };
          if (method === "storage.compareAndSet")
            return {
              updated: true,
              snapshot: {
                exists: !params.remove,
                value: params.value ?? null,
                revision: params.remove ? null : "stored",
              },
            };
          if (["storage.set", "storage.delete"].includes(method)) return true;
          throw Error(`Unexpected Host method: ${method}`);
        },
      };
    },
    { source: serializeDesignDocument(document) },
  );
  await page.goto("https://long-canvas.test/index.html");
  await page.waitForFunction(
    () =>
      !document.querySelector(".workspace").inert && Boolean(window.tools.get_design_screenshot),
  );
  const metadata = await page.evaluate(() => window.tools.get_design_metadata({}));
  assert.equal(metadata.canvas.height, 11322);
  assert.equal(metadata.pages[0].nodeCount, 1208);
  const screenshot = await page.evaluate(() =>
    window.tools.get_design_screenshot({ max_width: 1600 }),
  );
  assert.ok(screenshot.width <= 1600);
  assert.ok(screenshot.height <= 4096);
  assert.ok(screenshot.width * screenshot.height <= 2_000_000);
  assert.ok(screenshot.data.length <= 220_000);
  assert.equal(
    (await page.evaluate(() => window.tools.get_design_metadata({}))).stateRevision,
    metadata.stateRevision,
  );
});
