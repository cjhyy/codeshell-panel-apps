import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
const app = new URL("../../../apps/design-studio/app/", import.meta.url);

async function setup(t) {
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 640, height: 240 }, deviceScaleFactor: 1 });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://zero-token.test") return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
    if (!/^\/[a-z0-9/_-]+\.mjs$/iu.test(url.pathname)) return route.abort();
    return route.fulfill({ contentType: "text/javascript", body: await readFile(new URL(url.pathname.slice(1), app)) });
  });
  await page.goto("https://zero-token.test/");
  return page;
}
const markup = (token = "<silent-config></silent-config>", css = "", before = "", after = "") =>
  `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white;font:16px/20px Arial}#fixture{display:block;width:100%;background:#eee}section{height:80px;background:#2563eb}footer{height:50px;background:#16a34a}${css}</style><main id="fixture"><section>First</section>${before}${token}${after}<footer>After</footer></main>`;

async function proof(page, html, mutation = "none") {
  await page.setContent(html);
  return page.evaluate(async mutation => {
    const { convertToDesignDSL } = await import("/vendor/html2figma-browser.mjs");
    const { createHtmlZeroFlowTokenCapture, consumeHtmlZeroFlowTokenPlan } = await import("/html-zero-flow-token.mjs");
    const root = document.querySelector("#fixture"), elements = new Map(), ambiguousElements = new WeakSet();
    if (mutation === "upgrade") customElements.define("upgraded-config", class extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: "closed" }); }
    });
    const tree = convertToDesignDSL(root, { onElement(id, element) {
      if (!elements.has(id)) elements.set(id, element);
      else if (elements.get(id) !== element) { ambiguousElements.add(element); if (elements.get(id)) ambiguousElements.add(elements.get(id)); elements.set(id, null); }
    } });
    const zero = tree.children.find(child => child.bounds.width === 0 && child.bounds.height === 0);
    let getterReads = 0;
    if (mutation === "accessor" && zero) Object.defineProperty(zero, "extra", { get() { getterReads++; throw Error("must not invoke"); } });
    if (mutation === "budget" && zero) zero.extra = "x".repeat(4001);
    const getterMutation = mutation.includes("parent-getter");
    const before = mutation === "accessor" || getterMutation ? null : JSON.stringify(tree), domBefore = root.outerHTML;
    const control = createHtmlZeroFlowTokenCapture({ tree, root, elements, ambiguousElements });
    const installParentGetter = () => {
      const key = mutation.replace(/^late-/u, "").slice("parent-getter-".length);
      Object.defineProperty(key === "child-index" ? tree.children : tree, key === "child-index" ? "0" : key,
        { configurable: true, get() { getterReads++; throw Error("must not invoke parent projection getter"); } });
    };
    if (getterMutation && !mutation.startsWith("late-")) installParentGetter();
    const candidate = control.capture(tree), opaque = !candidate || Object.isFrozen(candidate) && Reflect.ownKeys(candidate).length === 0;
    const plan = consumeHtmlZeroFlowTokenPlan(candidate, tree, tree);
    if (plan) plan.accept("parent");
    const secondUse = consumeHtmlZeroFlowTokenPlan(candidate, tree, tree);
    const token = root.querySelector("silent-config,span,upgraded-config");
    if (mutation === "replace" && token) token.replaceWith(token.cloneNode(true));
    if (mutation === "late-text" && token) token.textContent = "Visible";
    if (mutation === "late-shadow" && token) token.style.boxShadow = "0 0 3px 4px red";
    if (mutation === "late-source" && zero) zero.bounds.y += 1;
    if (mutation === "late-reorder" && token) root.append(token);
    if (mutation === "late-upgrade") customElements.define("silent-config", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "closed" }); } });
    if (getterMutation && mutation.startsWith("late-")) installParentGetter();
    await Promise.resolve();
    let finalError = null;
    try { control.verify(); } catch (error) { finalError = error.message; }
    return { admitted: Boolean(plan), opaque, secondUse: Boolean(secondUse), report: control.report(), finalError, getterReads,
      sourceUnchanged: before === null ? null : before === JSON.stringify(tree), domUnchanged: domBefore === root.outerHTML,
      fakePlan: consumeHtmlZeroFlowTokenPlan({ source: tree, tokens: new Set([zero]) }, tree, tree) };
  }, mutation);
}

test("only private current empty inline tokens between real block siblings receive source-only provenance", async t => {
  const page = await setup(t);
  for (const token of ["<silent-config></silent-config>", "<span></span>"]) {
    const p = await proof(page, markup(token, "", "\n ", "\n"));
    assert.equal(p.admitted, true, token); assert.equal(p.opaque, true); assert.equal(p.secondUse, false); assert.equal(p.fakePlan, null);
    assert.equal(p.report.admitted, 1); assert.equal(p.report.tokens[0].parentNodeId, "parent");
    assert.equal(p.report.tokens[0].sourceBounds.width, 0); assert.equal(p.report.tokens[0].sourceBounds.height, 0);
    assert.equal(p.finalError, null); assert(p.sourceUnchanged && p.domUnchanged);
  }
});

test("production source-only tokens preserve real block IDs, Fill/Hug, save/edit/transfer and strict resize pixels", async t => {
  const output = await mkdtemp(join(tmpdir(), "zero-token-flow-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const css = "#fixture{display:block;width:100%;padding:8px;background:#eee}section{height:80px;background:#2563eb}footer{height:50px;background:#16a34a}";
  const cases = ["silent-config", "span"].map(tag => ({ id: tag,
    html: `<main id="fixture"><section>First</section><${tag}></${tag}><footer>After</footer></main>`, css }));
  const r = await runProductionFidelity({ output, cases, cpuOnly: true, resizeMode: "viewport-only" });
  assert.equal(r.browserGpuDisabled, true); assert.equal(r.realFigmaExecuted, false);
  assert.deepEqual(r.browserErrors, []); assert.deepEqual(r.blockedRequests, []);
  const page = await setup(t);
  for (const observed of r.cases) {
    assert(observed.comparisons.every(item => item.changedPixels === 0));
    assert.equal(observed.sourceOnlyTokens.admitted, 1);
    assert.equal(observed.sourceOnlyTokens.tokens[0].tag, observed.id);
    assert(observed.warnings.some(item => item.code === "html-nonpainting-source-token"));
    await page.setContent(markup(`<${observed.id}></${observed.id}>`));
    const originalIds = await page.evaluate(async () => {
      const { convertToDesignDSL } = await import("/vendor/html2figma-browser.mjs");
      const { designNodeToV3 } = await import("/design-node-adapter.mjs");
      const result = await designNodeToV3(convertToDesignDSL(document.querySelector("#fixture")), { includeViewport: false,
        captureZeroFlowTokenPlan: source => ({ source, tokens: new Set(source.children ?? []) }) });
      const rows = [];
      const visit = node => { const semantic = JSON.parse(node.notes ?? "{}"); if (semantic.semanticId) rows.push([node.type + "/" + semantic.semanticId, node.id]); node.children?.forEach(visit); };
      result.document.pages[0].children.forEach(visit); return rows;
    });
    const ids = new Map(originalIds);
    assert.equal(originalIds.length, 6, "a public lookalike cannot authorize deleting real children or even the zero token");
    for (const [mode, width] of [["imported", 640], ["narrow", 400]]) {
      const design = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, `${mode}.codesign.json`), "utf8")));
      assert.equal(design.nodes.length, 6);
      for (const node of design.nodes) {
        const semantic = JSON.parse(node.notes ?? "{}");
        if (semantic.semanticId) assert.equal(node.id, ids.get(node.type + "/" + semantic.semanticId), "original source path indexes stay stable");
        assert.notEqual(node.layoutPositioning, "absolute"); assert.equal(node.visible, true);
        assert(!String(semantic.semanticId ?? "").endsWith(` > ${observed.id}`));
      }
      const owner = design.nodes.find(node => node.name === "main#fixture"), section = design.nodes.find(node => node.name === "section"), footer = design.nodes.find(node => node.name === "footer");
      assert.equal(owner.layout, "vertical"); assert.equal(owner.width, width);
      assert.equal(owner.layoutSizingVertical, "hug");
      for (const child of [section, footer]) {
        assert.equal(child.layoutSizingHorizontal, "fill"); assert.equal(child.width, width - 16);
      }
      const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(design)));
      assert.equal(applyAllAutoLayouts(reopened.nodes), false);
      reopened.nodes.find(node => node.id === section.id).height = 100;
      applyAllAutoLayouts(reopened.nodes);
      assert.equal(reopened.nodes.find(node => node.id === footer.id).y, 108);
      assert.equal(reopened.nodes.find(node => node.id === owner.id).height, 166);
      const transfer = createFigmaTransfer(reopened);
      const flat = node => [node, ...(node.children ?? []).flatMap(flat)];
      assert.equal(transfer.pages.flatMap(page => page.children.flatMap(flat)).length, 6, "prepared transfer retains only real editable content; native execution is not asserted");
    }
  }
});

test("actual image-await continuation cannot publish a token whose paint changed after block planning", async t => {
  const page = await setup(t);
  const r = await page.evaluate(async () => {
    const { captureWorkspaceHtmlResult } = await import("/html-import.mjs");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const html = `<style>html,body{margin:0}#fixture{display:block;width:100%;padding:8px}section{height:80px}footer{height:50px}</style><main id="fixture"><section><img width="1" height="1" src="data:image/png;base64,${png}"></section><silent-config></silent-config><footer>After</footer></main>`;
    let changed = false, error = null;
    try {
      await captureWorkspaceHtmlResult({ html, sourcePath: "source.html", readText: async () => "", rootSelector: "#fixture", viewportWidth: 640, viewportHeight: 240,
        sha256Bytes: async bytes => {
          const token = [...document.querySelectorAll("iframe")].map(frame => frame.contentDocument?.querySelector("silent-config")).find(Boolean);
          if (token) { token.style.boxShadow = "0 0 3px 4px red"; changed = true; }
          await Promise.resolve();
          return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
        } });
    } catch (failure) { error = failure.message; }
    return { changed, error, remainingFrames: document.querySelectorAll("iframe").length };
  });
  assert.equal(r.changed, true); assert.match(r.error, /HTML_ZERO_FLOW_TOKEN_UNVERIFIED/u);
  assert.equal(r.remainingFrames, 0);
});

test("false-zero paint, counters, line boxes, intrinsic and interactive semantics retain fallback", async t => {
  const page = await setup(t);
  const cases = [
    ["text", "<silent-config> </silent-config>", "silent-config{font-size:0;line-height:0}"],
    ["nbsp", "<silent-config>\u00a0</silent-config>", "silent-config{font-size:0;line-height:0}"],
    ["adjacent-text", "<silent-config></silent-config>", "", "Literal"],
    ["preserved-whitespace", "<silent-config></silent-config>", "#fixture{white-space:pre}", "\n"],
    ["inline-sibling", "<silent-config></silent-config>", "", "<span>Visible</span>"],
    ["break", "<br>", "br{font-size:0;line-height:0}"],
    ["zero-width-line-box", "<span>\u200b</span>", "span{font-size:0;line-height:40px}"],
    ["shadow", "<silent-config></silent-config>", "silent-config{box-shadow:0 0 3px 4px red}"],
    ["outline", "<silent-config></silent-config>", "silent-config{outline:2px solid red}"],
    ["filter", "<silent-config></silent-config>", "silent-config{filter:drop-shadow(0 0 3px red)}"],
    ...["counter-increment:x", "counter-reset:x", "counter-set:x", "content:open-quote", "content:close-quote", "float:left", "position:relative", "position:absolute", "margin-left:1px", "border:1px solid red", "contain:size", "clear:both", "break-after:page", "writing-mode:vertical-rl", "display:flow-root;width:0;height:0", "animation-name:future-paint", "transition:box-shadow 1s"].map(css => [css, "<silent-config></silent-config>", `silent-config{${css}}`]),
    ["pseudo-quote", "<silent-config></silent-config>", 'silent-config::before{content:open-quote}'],
    ["interactive", '<silent-config tabindex="0"></silent-config>', ""],
    ["role", '<silent-config role="status"></silent-config>', ""],
    ["named-destination", '<silent-config id="destination"></silent-config>', "", '<section><a href="#destination">Navigate</a></section>'],
    ["named-destination-without-local-link", '<silent-config id="destination"></silent-config>', ""],
    ["name-binding", '<silent-config name="destination"></silent-config>', ""],
    ["intrinsic", "<input>", "input{width:0;height:0;border:0;padding:0}"],
    ["attribute-budget", "<silent-config " + Array.from({length:65}, (_,index) => `data-${index}="x"`).join(" ") + "></silent-config>", ""],
    ["style-budget", "<silent-config></silent-config>", '#fixture{font-family:"' + "x".repeat(4001) + '"}'],
  ];
  for (const [id, token, css, before] of cases) {
    const p = await proof(page, markup(token, css, before));
    assert.equal(p.admitted, false, id); assert.equal(p.report.admitted, 0, id); assert(p.sourceUnchanged && p.domUnchanged, id);
  }
  for (const mutation of ["accessor", "budget"]) {
    const p = await proof(page, markup(), mutation);
    assert.equal(p.admitted, false, mutation); assert.equal(p.getterReads, 0); assert(p.domUnchanged);
  }
  const upgraded = await proof(page, markup("<upgraded-config></upgraded-config>"), "upgrade");
  assert.equal(upgraded.admitted, false); assert.equal(upgraded.report.admitted, 0);
});

test("final source-only proof refuses post-await identity, content, paint, source, order and upgrade changes", async t => {
  for (const mutation of ["replace", "late-text", "late-shadow", "late-source", "late-reorder", "late-upgrade"]) {
    const page = await setup(t), p = await proof(page, markup(), mutation);
    assert.equal(p.admitted, true, mutation); assert.match(p.finalError, /HTML_ZERO_FLOW_TOKEN_UNVERIFIED/u, mutation);
  }
});

test("parent projection and child-order descriptors refuse capture and final getters without executing them", async t => {
  const page = await setup(t);
  for (const field of ["name", "layout", "bounds", "semantic", "children", "child-index"]) {
    const early = await proof(page, markup(), "parent-getter-" + field);
    assert.equal(early.admitted, false, field); assert.equal(early.getterReads, 0, field); assert(early.domUnchanged);
    const late = await proof(page, markup(), "late-parent-getter-" + field);
    assert.equal(late.admitted, true, field); assert.equal(late.getterReads, 0, field);
    assert.match(late.finalError, /HTML_ZERO_FLOW_TOKEN_UNVERIFIED/u, field); assert(late.domUnchanged);
  }
});
