import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, mkdir, cp, symlink, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { init, parse } from "es-module-lexer";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimePath = "apps/design-studio/app/vendor/html2figma-browser.mjs";
const runtime = await readFile(resolve(repositoryRoot, runtimePath), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("html2figma runtime rebuilds from its pinned local snapshot with no external runtime imports", async (t) => {
  const receipt = JSON.parse(
    await readFile(resolve(repositoryRoot, "third-party/html2figma/build.json"), "utf8"),
  );
  const sources = JSON.parse(
    await readFile(resolve(repositoryRoot, "third-party/html2figma/sources.json"), "utf8"),
  );
  assert.equal(receipt.upstreamCommit, "ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c");
  assert.equal(receipt.sourceTreeSha256, sha256(JSON.stringify(sources.files)));
  assert.equal(receipt.sha256, sha256(runtime));
  assert.equal(receipt.bytes, Buffer.byteLength(runtime));
  await init;
  const [imports, exports] = parse(runtime);
  assert.deepEqual(imports, []);
  assert.deepEqual(exports.map((item) => item.n).sort(), [
    "HTML2FIGMA_PROVENANCE",
    "convertToDesignDSL",
  ]);
  assert.doesNotMatch(
    runtime,
    /\b(?:fetch|eval|XMLHttpRequest|WebSocket|EventSource)\s*\(|new\s+Function\b/u,
  );
  assert.doesNotMatch(
    runtime,
    /(?:\/Users\/|\/home\/|@html2figma\/adapter|FigmaAdapter|__HTML2FIGMA_LOG)/u,
  );

  const isolated = await mkdtemp(resolve(tmpdir(), "codeshell-html2figma-build-"));
  t.after(() => rm(isolated, { recursive: true, force: true }));
  await mkdir(resolve(isolated, "scripts"), { recursive: true });
  await cp(
    resolve(repositoryRoot, "third-party/html2figma"),
    resolve(isolated, "third-party/html2figma"),
    { recursive: true },
  );
  await cp(
    resolve(repositoryRoot, "scripts/build-html2figma-browser.mjs"),
    resolve(isolated, "scripts/build-html2figma-browser.mjs"),
  );
  await symlink(resolve(repositoryRoot, "node_modules"), resolve(isolated, "node_modules"), "dir");
  execFileSync(process.execPath, ["scripts/build-html2figma-browser.mjs"], {
    cwd: isolated,
    stdio: "pipe",
  });
  assert.equal(await readFile(resolve(isolated, runtimePath), "utf8"), runtime);
  execFileSync(process.execPath, ["scripts/build-html2figma-browser.mjs", "--check"], {
    cwd: isolated,
    stdio: "pipe",
  });
});

async function fixture(t) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage(),
    externalRequests = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.href === "https://runtime.test/html2figma-browser.mjs")
      return route.fulfill({ body: runtime, contentType: "text/javascript" });
    if (url.href === "https://runtime.test/")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><style>:root{font-size:77px;color:red}body{margin:0}</style><div id="parent-marker">Parent document</div>',
      });
    externalRequests.push(url.href);
    return route.abort();
  });
  await page.goto("https://runtime.test/");
  return { page, externalRequests, errors };
}

test("cross-iframe conversion uses the root realm for styles, Range, DOM classes, images and SVG without parent access", async (t) => {
  const f = await fixture(t);
  const result = await f.page.evaluate(async () => {
    const { convertToDesignDSL, HTML2FIGMA_PROVENANCE } = await import("/html2figma-browser.mjs");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    canvas.getContext("2d").fillRect(0, 0, 2, 2);
    const image = canvas.toDataURL("image/png");
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-same-origin";
    iframe.width = "420";
    iframe.height = "360";
    iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; connect-src 'none'">
      <style>:root{font-size:20px}body{margin:0}#root{display:flex;flex-direction:column;gap:8px;width:320px;height:280px;padding:12px;box-sizing:border-box;color:rgb(30,60,90);font-family:Arial}h1{font-size:1.5rem;line-height:36px;margin:0}svg{stroke:currentColor}img{width:16px;height:16px}#child{display:flex;gap:5px}#abs{position:absolute;left:200px;top:180px}</style>
      <script>parent.runtimePwned=1;fetch('https://leak.test/script')</script>
      <main id="root" data-component="Card"><h1 id="heading">目标 <em>iframe</em> 文本</h1><div id="child"><span>Alpha</span><span>Beta</span></div><img id="photo" src="${image}" onload="parent.runtimePwned=2"><svg id="icon" width="20" height="20" viewBox="0 0 20 20"><path d="M1 1L10 10" fill="none" stroke="currentColor"/></svg><input id="field" value="Input fixture"><div id="abs">Absolute</div><img src="https://leak.test/image"></main>`;
    const loaded = new Promise((resolve) =>
      iframe.addEventListener("load", resolve, { once: true }),
    );
    document.body.append(iframe);
    await loaded;
    const root = iframe.contentDocument.querySelector("#root");
    await root.querySelector("#photo").decode();
    const parentBefore = document.documentElement.outerHTML;
    const originalStyle = window.getComputedStyle;
    const originalRange = document.createRange;
    const originalElement = document.createElement;
    window.getComputedStyle = () => {
      throw Error("Parent getComputedStyle must not be used");
    };
    document.createRange = () => {
      throw Error("Parent createRange must not be used");
    };
    document.createElement = () => {
      throw Error("Parent createElement must not be used");
    };
    try {
      const designNode = convertToDesignDSL(root);
      return {
        designNode,
        provenance: HTML2FIGMA_PROVENANCE,
        parentUnchanged: document.documentElement.outerHTML === parentBefore,
        inputScriptRan: window.runtimePwned ?? null,
        frameHasNoScripts: !iframe.sandbox.contains("allow-scripts"),
        ownerRealmDifferent: root instanceof window.Element === false,
        logs: Object.keys(window).filter((key) => key.startsWith("__HTML2FIGMA")),
      };
    } finally {
      window.getComputedStyle = originalStyle;
      document.createRange = originalRange;
      document.createElement = originalElement;
      iframe.remove();
    }
  });
  assert.equal(result.ownerRealmDifferent, true);
  assert.equal(result.parentUnchanged, true);
  assert.equal(result.frameHasNoScripts, true);
  assert.equal(result.inputScriptRan, null);
  assert.deepEqual(result.logs, []);
  assert.equal(result.provenance.engine, "html2figma");
  assert.equal(result.designNode.nodeType, "container");
  assert.equal(result.designNode.layout.flex.direction, "column");
  assert.equal(result.designNode.rawStyles.display, "flex");
  assert.equal(result.designNode.bounds.width, 320);
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(result.designNode);
  assert.ok(
    nodes.some(
      (node) =>
        node.nodeType === "text" && node.content.includes("目标") && node.textStyle.fontSize === 30,
    ),
  );
  assert.ok(
    nodes.some((node) => node.nodeType === "text" && node.content.includes("Input fixture")),
  );
  assert.ok(
    nodes.some(
      (node) =>
        node.nodeType === "image" && node.imageData.base64?.startsWith("data:image/png;base64,"),
    ),
  );
  const svg = nodes.find((node) => node.nodeType === "svg");
  assert.match(svg.svgContent, /stroke="rgb\(30, 60, 90\)"/u);
  assert.ok(nodes.some((node) => node.positioning.mode === "absolute"));
  assert.deepEqual(f.externalRequests, []);
  assert.deepEqual(f.errors, []);
});

test("independent iframe calls keep their own semantics and current DOM metadata without shared realm state", async (t) => {
  const f = await fixture(t);
  const result = await f.page.evaluate(async () => {
    const { convertToDesignDSL } = await import("/html2figma-browser.mjs");
    async function frame(fontSize, width) {
      const item = document.createElement("iframe");
      item.sandbox = "allow-same-origin";
      item.srcdoc = `<!doctype html><style>body{margin:0}#root{display:flex;width:${width}px;font:${fontSize}px Arial}</style><div id="root" class="before">Different realm</div>`;
      const loaded = new Promise((resolve) =>
        item.addEventListener("load", resolve, { once: true }),
      );
      document.body.append(item);
      await loaded;
      return item;
    }
    const frames = await Promise.all([frame(18, 200), frame(42, 300)]);
    const roots = frames.map((item) => item.contentDocument.querySelector("#root"));
    try {
      const first = convertToDesignDSL(roots[0]);
      const second = convertToDesignDSL(roots[1]);
      roots[0].className = "after";
      const repeated = convertToDesignDSL(roots[0], { includeRawStyles: false });
      const errors = [];
      for (const [root, options] of [
        [{}, {}],
        [roots[0], { maxDepth: 101 }],
        [roots[0], null],
      ]) {
        try {
          convertToDesignDSL(root, options);
        } catch (error) {
          errors.push(error.name);
        }
      }
      return { first, second, repeated, errors };
    } finally {
      frames.forEach((item) => item.remove());
    }
  });
  const texts = (node) =>
    node.nodeType === "text" ? [node] : (node.children ?? []).flatMap(texts);
  assert.equal(result.first.bounds.width, 200);
  assert.equal(result.second.bounds.width, 300);
  assert.equal(texts(result.first)[0].textStyle.fontSize, 18);
  assert.equal(texts(result.second)[0].textStyle.fontSize, 42);
  assert.deepEqual(result.first.semantic.classList, ["before"]);
  assert.deepEqual(result.repeated.semantic.classList, ["after"]);
  assert.equal(result.repeated.rawStyles, undefined);
  assert.deepEqual(result.errors, ["TypeError", "RangeError", "TypeError"]);
  assert.deepEqual(f.externalRequests, []);
  assert.deepEqual(f.errors, []);
});

test("capture retains CSS sizing intent separately from resolved pixels and does not apply box sizes to anonymous text", async (t) => {
  const f = await fixture(t);
  const result = await f.page.evaluate(async () => {
    const { convertToDesignDSL } = await import("/html2figma-browser.mjs");
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-same-origin";
    iframe.srcdoc = `<!doctype html><style>body{margin:0}#root{display:flex;width:100%;height:120px}#fixed{width:40px;height:24px}#fluid{flex:1;height:24px;margin-left:auto}#hug{display:inline-flex;width:fit-content;height:auto}</style><main id="root"><div id="fixed"></div><div id="fluid"></div><div id="hug">Label</div></main>`;
    const loaded = new Promise((resolve) =>
      iframe.addEventListener("load", resolve, { once: true }),
    );
    document.body.append(iframe);
    await loaded;
    try {
      const root = iframe.contentDocument.querySelector("#root");
      const before = iframe.contentDocument.documentElement.outerHTML;
      const tree = convertToDesignDSL(root, { includeRawStyles: false });
      return { tree, unchanged: iframe.contentDocument.documentElement.outerHTML === before };
    } finally {
      iframe.remove();
    }
  });
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(result.tree);
  const byId = (id) =>
    nodes.find((node) => node.nodeType !== "text" && node.semantic?.attributes?.id === id);
  assert.equal(result.unchanged, true);
  assert.equal(byId("root").cssLayout.width, "100%");
  assert.equal(byId("fixed").cssLayout.height, "24px");
  assert.equal(byId("fluid").cssLayout.width, "auto");
  assert.equal(byId("fluid").cssLayout["margin-left"], "auto");
  assert.equal(byId("hug").cssLayout.width, "fit-content");
  assert.equal(byId("hug").cssLayout.height, "auto");
  assert.ok(
    nodes.filter((node) => node.nodeType === "text").every((node) => node.cssLayout === undefined),
  );
  assert.deepEqual(f.externalRequests, []);
  assert.deepEqual(f.errors, []);
});
