import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import {
  createPortableDesign,
  planPortableDesign,
} from "../../../apps/design-studio/app/portable-backup.mjs";
import { preparePluginFile } from "../../../apps/design-studio/app/figma-plugin/v3-input.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/design-studio/app");
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const hash = async (value) => createHash("sha256").update(value).digest("hex");
const allTransferNodes = (transfer) => {
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const page of transfer.pages) for (const node of page.children) visit(node);
  return nodes;
};
const byHtmlId = (document, id, type) =>
  document.nodes.find((node) => {
    if (type && node.type !== type) return false;
    try {
      return JSON.parse(node.notes).attributes?.id === id;
    } catch {
      return false;
    }
  });

async function fixture(t) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage(),
    external = [],
    errors = [];
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === "https://import.test/")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><div id="parent-marker">Parent stays intact</div>',
      });
    if (
      url.origin === "https://import.test" &&
      url.pathname.startsWith("/app/") &&
      url.pathname.endsWith(".mjs")
    ) {
      const path = resolve(appRoot, url.pathname.slice(5));
      if (path.startsWith(`${appRoot}/`))
        return route.fulfill({ body: await readFile(path), contentType: "text/javascript" });
    }
    external.push(url.href);
    return route.abort();
  });
  await page.goto("https://import.test/");
  const capture = async (html, options = {}) =>
    page.evaluate(
      async ({ html, options }) => {
        const { captureWorkspaceHtmlResult } = await import("/app/html-import.mjs");
        const textReads = [],
          assetReads = [];
        const readText = async (path) => {
          textReads.push(path);
          return options.textFiles?.[path];
        };
        const readAsset =
          options.assetFiles === undefined
            ? undefined
            : async (path) => {
                assetReads.push(path);
                return options.assetFiles[path];
              };
        const result = await captureWorkspaceHtmlResult({
          sourcePath: options.sourcePath ?? "pages/home.html",
          html,
          readText,
          readAsset,
          rootSelector: options.rootSelector ?? "html",
          viewportWidth: options.width ?? 480,
          viewportHeight: options.height ?? 360,
          ...(options.engine ? { engine: options.engine } : {}),
        });
        return {
          document: result.document,
          resourcePlans: result.resourcePlans,
          report: result.report,
          mapping: result.mapping,
          textReads,
          assetReads,
          remainingFrames: document.querySelectorAll("iframe").length,
          inputScriptRan: window.importPwned ?? null,
          parentMarker: document.querySelector("#parent-marker")?.textContent,
        };
      },
      { html, options },
    );
  return { page, capture, external, errors };
}

test("production HTML import keeps fixed-height flex children and CSS margins stable through reflow and resize", async (t) => {
  const f = await fixture(t);
  const html = `<style>*{box-sizing:border-box}body{margin:0}#root{display:flex;width:100%;height:240px;padding:20px;gap:16px}#fixed{width:100px;height:120px;background:blue}#fluid{flex:1;height:120px;background:orange}</style><main id="root"><div id="fixed"></div><div id="fluid"></div></main>`;
  const captured = await f.capture(html, { rootSelector: "#root", width: 640, height: 240 });
  const design = normalizeDesignDocument(captured.document);
  const fixed = byHtmlId(design, "fixed"),
    fluid = byHtmlId(design, "fluid");
  const geometry = (node) => [node.x, node.y, node.width, node.height];
  const before = design.nodes.map(geometry);
  applyAllAutoLayouts(design.nodes);
  assert.deepEqual(design.nodes.map(geometry), before);
  assert.deepEqual(geometry(fixed), [20, 20, 100, 120]);
  assert.deepEqual(geometry(fluid), [136, 20, 484, 120]);
  design.nodes.find((node) => node.id === "html-viewport").width = 400;
  byHtmlId(design, "root").width = 400;
  applyAllAutoLayouts(design.nodes);
  assert.deepEqual(geometry(fixed), [20, 20, 100, 120]);
  assert.deepEqual(geometry(fluid), [136, 20, 244, 120]);

  const margins = await f.capture(
    `<style>*{box-sizing:border-box}body{margin:0}#root{display:flex;width:100%;height:240px;padding:20px;gap:12px}.item{width:100px;height:100px;margin-right:8px}</style><main id="root"><div id="first" class="item"></div><div id="second" class="item"></div></main>`,
    { rootSelector: "#root", width: 640, height: 240 },
  );
  const marginDesign = normalizeDesignDocument(margins.document);
  assert.equal(byHtmlId(marginDesign, "root").layout, "horizontal");
  assert.equal(
    margins.report.warnings.some((warning) => warning.code === "layout-margin-fixed"),
    false,
  );
  applyAllAutoLayouts(marginDesign.nodes);
  assert.deepEqual(geometry(byHtmlId(marginDesign, "first")), [20, 20, 100, 100]);
  assert.deepEqual(geometry(byHtmlId(marginDesign, "second")), [140, 20, 100, 100]);
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("actual HTML capture imports editable v3, survives editing and a complete file, then the Figma plugin restores exact local assets", async (t) => {
  const f = await fixture(t);
  const html = `<!doctype html><title>End-to-end HTML</title><style>body{margin:0;font-family:Arial}.card{position:relative;width:400px;height:280px;background:#eef4ff}h1{margin:0;position:absolute;left:20px;top:20px;font-size:28px}img{position:absolute;left:20px;top:90px;width:24px;height:24px}svg{position:absolute;left:70px;top:90px}</style><main class="card" data-component="Card"><h1 id="heading">Original HTML title</h1><img src="data:image/png;base64,${PNG}" alt="Offline PNG"><svg width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" fill="blue"/></svg></main>`;
  const result = await f.capture(html),
    repeated = await f.capture(html);
  assert.equal(result.report.engine, "html2figma");
  assert.equal(result.report.upstreamCommit, "ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c");
  assert.equal(result.document.version, 3);
  assert.ok(result.resourcePlans.length >= 2, "PNG and SVG must be local resources");
  const document = normalizeDesignDocument(result.document),
    again = normalizeDesignDocument(repeated.document);
  assert.equal(new Set(document.nodes.map((node) => node.id)).size, document.nodes.length);
  assert.deepEqual(
    document.nodes.map((node) => node.id),
    again.nodes.map((node) => node.id),
    "random upstream ids must not alter persistent design ids",
  );
  assert.deepEqual(
    result.mapping.map((entry) => entry.designId),
    repeated.mapping.map((entry) => entry.designId),
  );
  const heading = document.nodes.find(
    (node) => node.type === "text" && node.text === "Original HTML title",
  );
  assert.ok(heading, "HTML text must remain editable text");
  heading.text = "Edited after HTML import";
  heading.fill = "#123456";
  const edited = normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
  assert.equal(edited.nodes.find((node) => node.id === heading.id).text, heading.text);

  const files = new Map(
    result.resourcePlans.flatMap((plan) => plan.parts.map((part) => [part.path, part.content])),
  );
  const portable = await createPortableDesign({
    document: edited,
    source: {
      workspaceRoot: "/fixture",
      sessionId: "html-import",
      path: "designs/html.codesign.json",
    },
    readText: async (path) => {
      if (!files.has(path)) throw Error("missing");
      return files.get(path);
    },
    sha256Bytes: hash,
  });
  const backup = JSON.parse(portable);
  assert.equal(backup.resources.length, edited.resources.length);
  const reopened = await planPortableDesign(portable, { sha256: hash, sha256Bytes: hash });
  assert.equal(
    normalizeDesignDocument(JSON.parse(reopened.primarySource)).nodes.find(
      (node) => node.id === heading.id,
    ).text,
    heading.text,
  );
  files.clear();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("The Figma converter must use only the complete file");
  };
  let prepared;
  try {
    prepared = await preparePluginFile(portable, { sha256Bytes: hash });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(prepared.kind, "portable");
  assert.equal(prepared.transfer.format, "codeshell.figma.transfer");
  assert.equal(prepared.summary.images, edited.resources.length);
  const exported = allTransferNodes(prepared.transfer);
  assert.equal(exported.find((node) => node.id === heading.id).text, heading.text);
  assert.equal(exported.find((node) => node.id === heading.id).fill, "#123456");
  assert.equal(new Set(exported.map((node) => node.id)).size, exported.length);
  for (const resource of backup.resources)
    assert.equal(prepared.transfer.assets[resource.id].base64, resource.base64);
  const damaged = structuredClone(backup);
  damaged.resources[0].base64 = "AA==";
  await assert.rejects(
    () => preparePluginFile(JSON.stringify(damaged), { sha256Bytes: hash }),
    /校验|资源/u,
  );
  const missing = structuredClone(backup);
  missing.resources.pop();
  await assert.rejects(
    () => preparePluginFile(JSON.stringify(missing), { sha256Bytes: hash }),
    /资源/u,
  );
  await assert.rejects(
    () => preparePluginFile(serializeDesignDocument(edited), { sha256Bytes: hash }),
    /普通 v3|完整备份/u,
  );
  assert.equal(result.remainingFrames, 0);
  assert.equal(result.parentMarker, "Parent stays intact");
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("workspace CSS and selected local image bytes resolve under their own paths and responsive viewports retain measured layout", async (t) => {
  const f = await fixture(t);
  const html =
    '<!doctype html><link rel="stylesheet" href="../styles/main.css"><main id="responsive"><div class="tiles"><section id="first" class="tile">First</section><section id="second" class="tile">Second</section></div><img id="local-photo" src="../assets/pixel.png"><div class="background-photo"></div></main>';
  const css =
    'body{margin:0;font:16px Arial}#responsive{width:100vw;padding:16px;box-sizing:border-box}.tiles{display:flex;gap:16px}.tile{width:calc((100vw - 48px)/2);height:40px;flex-shrink:0;background:#ddeeff}img{width:12px;height:12px}.background-photo{width:12px;height:12px;background-image:url("../assets/pixel.png")}@media(max-width:400px){.tiles{flex-direction:column}.tile{width:100%}}';
  const options = {
    textFiles: { "styles/main.css": css },
    assetFiles: { "assets/pixel.png": { base64: PNG } },
    rootSelector: "#responsive",
  };
  const wide = await f.capture(html, { ...options, width: 480 }),
    narrow = await f.capture(html, { ...options, width: 320 });
  assert.deepEqual(wide.textReads, ["styles/main.css"]);
  assert.deepEqual(
    wide.assetReads,
    ["assets/pixel.png"],
    "CSS and img references share the same bounded local resolver cache",
  );
  assert.ok(wide.resourcePlans.length >= 1);
  assert.deepEqual(wide.document.canvas, { width: 480, height: 360, background: "#ffffff" });
  assert.deepEqual(narrow.document.canvas, { width: 320, height: 360, background: "#ffffff" });
  const wideDocument = normalizeDesignDocument(wide.document),
    narrowDocument = normalizeDesignDocument(narrow.document);
  const firstWide = byHtmlId(wideDocument, "first", "frame"),
    secondWide = byHtmlId(wideDocument, "second", "frame");
  const firstNarrow = byHtmlId(narrowDocument, "first", "frame"),
    secondNarrow = byHtmlId(narrowDocument, "second", "frame");
  assert.ok(firstWide && secondWide && firstNarrow && secondNarrow);
  assert.ok(secondWide.x > firstWide.x && Math.abs(secondWide.y - firstWide.y) < 1);
  assert.ok(secondNarrow.y > firstNarrow.y && Math.abs(secondNarrow.x - firstNarrow.x) < 1);
  assert.equal(firstWide.width, 216);
  assert.equal(firstNarrow.width, 288);
  assert.deepEqual(
    wideDocument.nodes.map((node) => node.id),
    narrowDocument.nodes.map((node) => node.id),
  );
  assert.equal(wide.remainingFrames, 0);
  assert.equal(narrow.remainingFrames, 0);
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("actual HTML import blocks scripts, handlers, navigations and remote resources while reporting blocked assets", async (t) => {
  const f = await fixture(t);
  const html = `<!doctype html><base href="https://leak.test/"><meta http-equiv="refresh" content="0;url=https://leak.test/navigation"><link rel="stylesheet" href="https://leak.test/external.css"><style>@import "https://leak.test/import.css";body{margin:0}.remote{width:30px;height:30px;background-image:url(https://leak.test/background)}</style><script>parent.importPwned=1;fetch('https://leak.test/script')</script><iframe src="https://leak.test/frame"></iframe><main style="width:300px;height:160px"><p onclick="parent.importPwned=2">Safe text</p><img src="https://leak.test/image" onerror="parent.importPwned=3"><div class="remote"></div><form action="https://leak.test/form"><input value="Static form"></form><img src="data:image/png;base64,${PNG}" onload="parent.importPwned=4" width="12" height="12"></main>`;
  const result = await f.capture(html);
  assert.equal(result.inputScriptRan, null);
  assert.equal(result.parentMarker, "Parent stays intact");
  assert.equal(result.remainingFrames, 0);
  assert.ok(result.report.warnings.some((warning) => warning.code === "external-resource-blocked"));
  const nodes = normalizeDesignDocument(result.document).nodes;
  assert.ok(nodes.some((node) => node.type === "text" && node.text === "Safe text"));
  assert.ok(nodes.some((node) => node.type === "text" && node.text === "Static form"));
  assert.ok(!nodes.some((node) => node.type === "text" && node.text.includes("importPwned")));
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("missing local CSS or image data and undecodable inline images fail before a partial design can be returned", async (t) => {
  const f = await fixture(t);
  const cases = [
    {
      html: '<main><img src="../assets/missing.png"></main>',
      options: {},
      expected: /本地二进制资源|文件夹/u,
    },
    {
      html: '<main><img src="../assets/missing.png"></main>',
      options: { assetFiles: {} },
      expected: /没有受支持|资源/u,
    },
    {
      html: '<link rel="stylesheet" href="../styles/missing.css"><main>Missing CSS</main>',
      options: {},
      expected: /无法读取 HTML 样式表/u,
    },
    {
      html: '<main><img src="data:image/png;base64,YmFk" width="12" height="12"></main>',
      options: {},
      expected: /图片无法解码/u,
    },
  ];
  for (const item of cases) {
    await assert.rejects(() => f.capture(item.html, item.options), item.expected);
    assert.equal(await f.page.locator("iframe").count(), 0);
  }
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});
