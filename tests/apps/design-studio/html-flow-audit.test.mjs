import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";
import {
  captureHtmlFlowObligations,
  evaluateHtmlFlowAudit,
  freezeHtmlFlowObligations,
} from "../../../apps/design-studio/app/html-flow-audit.mjs";

const style = (overrides) => ({
  display: "block",
  visibility: "visible",
  position: "static",
  cssFloat: "none",
  transform: "none",
  rotate: "none",
  scale: "none",
  translate: "none",
  perspective: "none",
  zoom: "1",
  columnCount: "auto",
  columnWidth: "auto",
  writingMode: "horizontal-tb",
  direction: "ltr",
  top: "auto",
  right: "auto",
  bottom: "auto",
  left: "auto",
  ...overrides,
});
function setup({ wrapper = true, svg = false } = {}) {
  const document = {
    defaultView: {
      getComputedStyle: (element, pseudo) => (pseudo ? { content: "none" } : element.style),
    },
  };
  const element = (tag, overrides = {}) => ({
    nodeType: 1,
    localName: tag,
    namespaceURI: tag === "svg" ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
    style: style(),
    children: [],
    childNodes: [],
    textContent: "",
    getBoundingClientRect: () => ({ width: 100, height: 40 }),
    contains(other) {
      return this === other || this.children.some((child) => child.contains(other));
    },
    ...overrides,
  });
  const parent = element("section"),
    child = element(svg ? "svg" : "div");
  parent.children = [child];
  parent.childNodes = [child];
  const root = { id: "parent", type: "frame", layout: "vertical", children: [] };
  const target = { id: "child", type: svg ? "rectangle" : "frame", layout: "none", children: [] };
  const spacer = { id: "wrapper", type: "frame", layout: "vertical", children: [target] };
  root.children = wrapper ? [spacer] : [target];
  const value = { pages: [{ children: [root] }] };
  const input = {
    root: parent,
    elements: new Map([
      ["parent-semantic", parent],
      ["child-semantic", child],
    ]),
    mapping: [
      { semanticId: "parent-semantic", designId: "parent" },
      { semanticId: "child-semantic", designId: "child" },
    ],
    document: value,
    syntheticIds: new Set(wrapper ? ["wrapper"] : []),
  };
  return { element, parent, child, root, target, spacer, input, value };
}
const clone = (value) => JSON.parse(JSON.stringify(value));

test("actual source relationships allow only capture-proven wrappers and reevaluate each current candidate", () => {
  const value = setup(),
    evidence = captureHtmlFlowObligations(value.input);
  const unproven = setup();
  unproven.input.syntheticIds.clear();
  unproven.spacer.name = "margin-wrapper";
  unproven.spacer.notes = JSON.stringify({ role: "container" });
  const missingProof = captureHtmlFlowObligations(unproven.input);
  assert.deepEqual(missingProof.obligations[0].wrapperIds, []);
  assert.equal(
    evaluateHtmlFlowAudit(unproven.value, missingProof).issues[0].code,
    "FLOW_SOURCE_PARENT_CHANGED",
  );
  assert(Object.isFrozen(evidence));
  assert(Object.isFrozen(evidence.obligations[0]));
  assert.equal(evidence.obligations.length, 1);
  assert.deepEqual(evidence.obligations[0].wrapperIds, ["wrapper"]);
  assert.equal(evaluateHtmlFlowAudit(value.value, evidence).status, "PASS");
  for (const broken of ["parent", "wrapper"]) {
    const candidate = clone(value.value),
      owner =
        broken === "parent"
          ? candidate.pages[0].children[0]
          : candidate.pages[0].children[0].children[0];
    owner.layout = "none";
    const result = evaluateHtmlFlowAudit(candidate, evidence);
    assert.equal(result.status, "FAIL");
    assert.equal(result.issues[0].code, "NESTED_MANUAL_FLOW");
  }
  for (const id of ["parent", "wrapper", "child"]) {
    const candidate = clone(value.value);
    const current =
      id === "parent"
        ? candidate.pages[0].children[0]
        : id === "wrapper"
          ? candidate.pages[0].children[0].children[0]
          : candidate.pages[0].children[0].children[0].children[0];
    current.visible = false;
    assert.equal(
      evaluateHtmlFlowAudit(candidate, evidence).issues[0].code,
      "FLOW_SOURCE_PARTICIPATION_LOST",
    );
  }
  value.target.layoutPositioning = "absolute";
  assert.equal(evaluateHtmlFlowAudit(value.value, evidence).issues[0].code, "FLOW_BECAME_ABSOLUTE");
  delete value.target.layoutPositioning;
  const foreign = {
    id: "real-sibling",
    type: "frame",
    layout: "vertical",
    children: [value.spacer],
  };
  value.root.children = [foreign];
  assert.equal(
    evaluateHtmlFlowAudit(value.value, evidence).issues[0].code,
    "FLOW_SOURCE_PARENT_CHANGED",
  );
  assert.throws(() => {
    evidence.obligations[0].wrapperIds.push("real-sibling");
  }, TypeError);
});

test("duplicate IDs, orphan/cyclic candidates and malformed evidence fail before any normalization", () => {
  const value = setup(),
    evidence = captureHtmlFlowObligations(value.input);
  const duplicate = clone(value.value);
  duplicate.pages[0].children.push(clone(duplicate.pages[0].children[0]));
  assert.throws(() => evaluateHtmlFlowAudit(duplicate, evidence), /duplicate/u);
  assert.throws(
    () => evaluateHtmlFlowAudit({ nodes: [{ id: "orphan", parentId: "missing" }] }, evidence),
    /orphan/u,
  );
  assert.throws(
    () =>
      evaluateHtmlFlowAudit(
        {
          nodes: [
            { id: "a", parentId: "b" },
            { id: "b", parentId: "a" },
          ],
        },
        evidence,
      ),
    /cyclic/u,
  );
  for (const change of [
    (v) => {
      v.obligations[0].wrapperIds = null;
    },
    (v) => {
      v.obligations[0].extra = {};
    },
    (v) => {
      v.bindings[0].semanticIds = [null];
    },
    (v) => {
      v.source.proven = 99;
    },
    (v) => {
      v.source.details = [{ reason: {} }];
    },
  ]) {
    const malformed = clone(evidence);
    change(malformed);
    assert.throws(() => freezeHtmlFlowObligations(malformed));
  }
});

test("same Element container/Text references are valid; different-Element semantic collisions stay ambiguous", () => {
  const value = setup({ wrapper: false });
  value.parent.children = [];
  value.parent.childNodes = [{ nodeType: 3, textContent: "Alpha" }];
  value.parent.textContent = "Alpha";
  value.root.children = [{ id: "text", type: "text", children: [] }];
  value.input.mapping = [
    { semanticId: "parent-semantic", designId: "parent" },
    { semanticId: "parent-semantic", designId: "text" },
  ];
  value.input.elements = new Map([["parent-semantic", value.parent]]);
  const evidence = captureHtmlFlowObligations(value.input);
  assert.equal(evidence.source.ambiguous, 0);
  assert.equal(evidence.obligations[0].kind, "plain-own-text");
  assert.equal(evaluateHtmlFlowAudit(value.value, evidence).status, "PASS");
  const flat = {
    nodes: [
      { id: "parent", type: "frame", layout: "vertical" },
      { id: "text", type: "text", parentId: "parent" },
    ],
  };
  const flatEvidence = captureHtmlFlowObligations({ ...value.input, document: flat });
  assert.equal(flatEvidence.obligations.length, 1);
  assert.equal(evaluateHtmlFlowAudit(flat, flatEvidence).status, "PASS");
  const collision = setup({ wrapper: false });
  collision.input.elements.set("child-semantic", null);
  collision.input.ambiguousElements = new WeakSet([collision.child]);
  const unresolved = captureHtmlFlowObligations(collision.input);
  assert.equal(unresolved.source.ambiguous, 1);
  assert.equal(unresolved.obligations.length, 0);
  assert.equal(evaluateHtmlFlowAudit(collision.value, unresolved).status, "PARTIAL");
});

test("SVG/image and empty leaves need no own Auto Layout; their ordinary parent relationship is audited", () => {
  for (const kind of ["svg", "img", "div"]) {
    const value = setup({ wrapper: false, svg: kind === "svg" });
    value.child.localName = kind;
    const evidence = captureHtmlFlowObligations(value.input);
    assert.equal(evidence.obligations.length, 1);
    assert.equal(evaluateHtmlFlowAudit(value.value, evidence).status, "PASS");
    value.root.layout = "none";
    assert.equal(evaluateHtmlFlowAudit(value.value, evidence).status, "FAIL");
  }
  const overlay = setup({ wrapper: false });
  overlay.child.style.position = "absolute";
  overlay.target.layoutPositioning = "absolute";
  const evidence = captureHtmlFlowObligations(overlay.input);
  assert.equal(evidence.source.excluded, 1);
  assert.equal(evidence.obligations.length, 0);
  assert.equal(evaluateHtmlFlowAudit(overlay.value, evidence).status, "PASS");
});

test("unproven transforms, columns, table/inline and zero/contents/mixed/generated source remain PARTIAL", () => {
  for (const overrides of [
    { rotate: "10deg" },
    { scale: "2" },
    { translate: "5px" },
    { zoom: "1.5" },
    { columnCount: "2" },
    { display: "contents" },
    { display: "table" },
  ]) {
    const value = setup({ wrapper: false });
    Object.assign(value.parent.style, overrides);
    if (overrides.display === "contents")
      value.parent.getBoundingClientRect = () => ({ width: 0, height: 0 });
    const evidence = captureHtmlFlowObligations(value.input);
    assert(evidence.source.unsupported > 0);
    assert.equal(evaluateHtmlFlowAudit(value.value, evidence).status, "PARTIAL");
  }
  const mixed = setup();
  mixed.parent.childNodes.push({ nodeType: 3, textContent: "anonymous" });
  assert(
    captureHtmlFlowObligations(mixed.input).source.details.some(
      (v) => v.reason === "mixed-anonymous-text-flow",
    ),
  );
  const generated = setup({ wrapper: false });
  generated.parent.ownerDocument.defaultView.getComputedStyle = (element, pseudo) =>
    pseudo ? { content: '"generated"' } : element.style;
  assert(
    captureHtmlFlowObligations(generated.input).source.details.some(
      (v) => v.reason === "generated-content-flow",
    ),
  );
});

async function pageFor(t) {
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 640, height: 240 },
    deviceScaleFactor: 1,
  });
  const root = resolve("apps/design-studio/app"),
    blocked = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url()),
      file = resolve(root, "." + url.pathname);
    if (url.href === "https://flow-audit.test/")
      return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
    if (
      url.origin === "https://flow-audit.test" &&
      file.startsWith(root + sep) &&
      file.endsWith(".mjs")
    )
      return route.fulfill({ contentType: "text/javascript", body: await readFile(file) });
    blocked.push(url.href);
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto("https://flow-audit.test/");
  t.after(() => assert.deepEqual(blocked, []));
  return page;
}
const fixture = `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0}#fixture{position:relative;display:flex;width:100%;height:240px;padding:20px;gap:12px}#nested{display:block;width:160px;height:88px}#nested>.tile{width:160px;height:40px;background:#2563eb}#nested>.tile+.tile{margin-top:8px;background:#f97316}#empty{width:20px;height:20px}#badge{position:absolute;left:20px;top:180px;width:20px;height:20px;background:#10b981}</style><main id="fixture"><section id="nested"><div class="tile"></div><div class="tile"></div></section><div id="empty"></div><div id="badge"></div></main>`;

test("real capture obligations survive duplicate selectors/wrappers and catch invisible SVG-equal NONE regression in each candidate", async (t) => {
  const page = await pageFor(t);
  const result = await page.evaluate(async (html) => {
    const { captureWorkspaceHtmlResult } = await import("/html-import.mjs"),
      { normalizeDesignDocument, exportDesignSvg, serializeDesignDocument } =
        await import("/document.mjs"),
      { evaluateHtmlFlowAudit, freezeHtmlFlowObligations } = await import("/html-flow-audit.mjs"),
      { applyAllAutoLayouts } = await import("/layout.mjs");
    const capture = (audit) =>
      captureWorkspaceHtmlResult({
        sourcePath: "source.html",
        html,
        readText: async () => {
          throw Error("external");
        },
        rootSelector: "#fixture",
        viewportWidth: 640,
        viewportHeight: 240,
        includeFlowAudit: audit,
      });
    const captured = await capture(true),
      plain = await capture(false),
      document = normalizeDesignDocument(captured.document),
      evidence = freezeHtmlFlowObligations(captured.report.flowObligations);
    const get = (id) =>
      document.nodes.find((n) => {
        try {
          return JSON.parse(n.notes).attributes?.id === id;
        } catch {
          return false;
        }
      });
    const nested = get("nested"),
      before = exportDesignSvg(document),
      initial = evaluateHtmlFlowAudit(document, evidence);
    nested.layout = "none";
    for (const n of document.nodes.filter((n) => n.parentId === nested.id))
      n.layoutPositioning = "auto";
    const fault = evaluateHtmlFlowAudit(document, evidence),
      equal = before === exportDesignSvg(document);
    nested.layout = "vertical";
    const resized = [];
    for (const width of [640, 400, 640]) {
      document.nodes.find((n) => n.id === "html-viewport").width = width;
      applyAllAutoLayouts(document.nodes);
      resized.push(evaluateHtmlFlowAudit(document, evidence).status);
    }
    const serialized = serializeDesignDocument(document);
    return {
      initial,
      fault,
      equal,
      resized,
      evidence,
      plainHasAudit: Object.hasOwn(plain.report, "flowObligations"),
      sourceUnaffected: exportDesignSvg(normalizeDesignDocument(plain.document)) === before,
      savedAdmissionFlag: /flowObligations|flow-obligations/u.test(serialized),
      badge: get("badge").layoutPositioning,
    };
  }, fixture);
  assert.equal(result.initial.status, "PASS");
  assert.equal(result.fault.status, "FAIL");
  assert(result.fault.issues.some((i) => i.code === "NESTED_MANUAL_FLOW"));
  assert.equal(result.equal, true);
  assert.deepEqual(result.resized, ["PASS", "PASS", "PASS"]);
  assert(result.evidence.obligations.some((e) => e.wrapperIds.length));
  assert.equal(result.badge, "absolute");
  assert.equal(result.plainHasAudit, false);
  assert.equal(result.sourceUnaffected, true);
  assert.equal(result.savedAdmissionFlag, false);
  const tileBindings = result.evidence.bindings.filter((b) =>
    b.semanticIds.some((id) => /div\.tile/u.test(id)),
  );
  assert.equal(tileBindings.length, 2);
  assert.notEqual(tileBindings[0].sourceId, tileBindings[1].sourceId);
});

test("real duplicate selector positions bind the actual elements and real SVG is a leaf obligation", async (t) => {
  const page = await pageFor(t);
  const result = await page.evaluate(async () => {
    const { captureWorkspaceHtmlResult } = await import("/html-import.mjs"),
      { normalizeDesignDocument } = await import("/document.mjs"),
      { evaluateHtmlFlowAudit } = await import("/html-flow-audit.mjs");
    const html =
      '<!doctype html><style>body{margin:0}main{display:flex;position:relative;height:200px}.tile{width:40px;height:40px;background:red}.tile+.tile{position:absolute;left:80px}svg{width:30px;height:30px}</style><main><div class="tile"></div><div class="tile"></div><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><rect width="30" height="30" fill="blue"/></svg></main>';
    const captured = await captureWorkspaceHtmlResult({
      sourcePath: "source.html",
      html,
      readText: async () => {
        throw Error("external");
      },
      rootSelector: "main",
      viewportWidth: 640,
      viewportHeight: 240,
      includeFlowAudit: true,
    });
    const evidence = captured.report.flowObligations,
      document = normalizeDesignDocument(captured.document);
    const tiles = evidence.bindings.filter((b) =>
      b.semanticIds.some((id) => /div\.tile/u.test(id)),
    );
    const svg = evidence.bindings.find((b) => b.semanticIds.some((id) => /svg/u.test(id)));
    return { tiles, svg, evidence, result: evaluateHtmlFlowAudit(document, evidence) };
  });
  assert.deepEqual(result.tiles.map((b) => b.position).sort(), ["absolute", "static"]);
  assert(result.svg);
  assert(result.evidence.obligations.some((e) => e.childId === result.svg.designId));
  assert.equal(result.result.status, "PASS");
  assert(result.evidence.source.excluded >= 2);
});

const floatFixture = (extra = "") => `<!doctype html><style>*{box-sizing:border-box}body{margin:0}main{width:100%;height:240px;padding:20px}.row::after{content:"";display:block;clear:both}.col{float:left;width:50%}.content{height:60px;background:#2563eb}${extra}</style><main><div class="row"><section class="col"><div class="content"></div></section><section class="col"><div class="content"></div></section></div></main>`;

test("only successful owned float/clear plans discharge exact source exceptions and current paths remain mandatory", async (t) => {
  const page = await pageFor(t);
  const observed = await page.evaluate(async (html) => {
    const { captureWorkspaceHtmlResult } = await import("/html-import.mjs");
    const { normalizeDesignDocument, serializeDesignDocument } = await import("/document.mjs");
    const { evaluateHtmlFlowAudit } = await import("/html-flow-audit.mjs");
    const capture = (audit, extra = "") => captureWorkspaceHtmlResult({ sourcePath: "source.html", html: html.replace("</style>", extra + "</style>"), readText: async () => "", rootSelector: "main", viewportWidth: 640, viewportHeight: 240, includeFlowAudit: audit });
    const captured = await capture(true), plain = await capture(false), value = normalizeDesignDocument(captured.document), ledger = captured.report.flowObligations;
    const row = value.nodes.find((n) => n.layout === "grid"), columns = value.nodes.filter((n) => n.parentId === row.id), broken = [];
    for (const target of [row, ...columns]) for (const kind of ["none", "absolute", "hidden"]) {
      const candidate = structuredClone(value), node = candidate.nodes.find((n) => n.id === target.id);
      if (kind === "none") node.layout = "none";
      if (kind === "absolute") node.layoutPositioning = "absolute";
      if (kind === "hidden") node.visible = false;
      broken.push(evaluateHtmlFlowAudit(candidate, ledger).status);
    }
    const foreign = structuredClone(value); foreign.nodes.find((n) => n.parentId === columns[0].id).parentId = columns[1].id;
    broken.push(evaluateHtmlFlowAudit(foreign, ledger).status);
    const negatives = [];
    for (const extra of ['.row::after{content:"real text"}', '.row::after{background:red}', '.row::after{height:1px}', '.row::before{content:"real"}', '.col{width:31.2345%}']) {
      const result = await capture(true, extra);
      negatives.push({ extra, status: evaluateHtmlFlowAudit(result.document, result.report.flowObligations).status });
    }
    const mobile = await capture(true, '.col{float:none;width:auto}');
    return { initial: evaluateHtmlFlowAudit(value, ledger), broken, negatives,
      sameDocument: serializeDesignDocument(value) === serializeDesignDocument(normalizeDesignDocument(plain.document)),
      sameWarnings: JSON.stringify(captured.report.warnings) === JSON.stringify(plain.report.warnings),
      mobile: evaluateHtmlFlowAudit(mobile.document, mobile.report.flowObligations) };
  }, floatFixture());
  assert.equal(observed.initial.status, "PASS"); assert.equal(observed.initial.obligations, 5);
  assert(observed.broken.every((status) => status === "FAIL"));
  assert(observed.negatives.every((result) => result.status !== "PASS"), JSON.stringify(observed.negatives));
  assert.equal(observed.sameDocument, true); assert.equal(observed.sameWarnings, true);
  assert.equal(observed.mobile.status, "PASS");
});

test("float/clear source proof rejects detached IDs, ambiguity, missing ownership, malformed clear and unpublished receipts", async (t) => {
  const page = await pageFor(t); await page.setContent(floatFixture());
  const results = await page.evaluate(async () => {
    const { convertToDesignDSL } = await import("/vendor/html2figma-browser.mjs");
    const { designNodeToV3 } = await import("/design-node-adapter.mjs");
    const { prepareHtmlLayoutFlowAudit, captureHtmlFlowObligations, evaluateHtmlFlowAudit } = await import("/html-flow-audit.mjs");
    const results = [];
    for (const mode of ["valid", "detached", "ambiguous", "missing-owner", "malformed-clear", "no-proof", "unbranded"]) {
      const root = document.querySelector("main"), elements = new Map(), canonicalBySource = new WeakMap(), ambiguousElements = new WeakSet(), receipts = [];
      const source = convertToDesignDSL(root, { onElement: (id, element) => elements.set(id, element) });
      const value = await designNodeToV3(source, { includeViewport: false, onNode: (source, node) => canonicalBySource.set(source, node), onRecoveredFlow: (proof) => receipts.push(proof) });
      if (mode === "ambiguous") ambiguousElements.add(root.querySelector(".col"));
      if (mode === "missing-owner") canonicalBySource.delete(receipts[0].source);
      if (mode === "malformed-clear") receipts.find((r) => r.type === "float").clears[0].rawStyles["box-shadow"] = "0 0 1px red";
      const recoveredLayouts = []; let rejected = false;
      if (mode !== "no-proof") for (const receipt of receipts) {
        try {
          const prepared = prepareHtmlLayoutFlowAudit({ root, elements, canonicalBySource, ambiguousElements, document: mode === "detached" ? structuredClone(value.document) : value.document }, receipt);
          recoveredLayouts.push(mode === "unbranded" ? { ...prepared } : prepared);
        } catch { rejected = true; }
      }
      const ledger = captureHtmlFlowObligations({ root, elements, canonicalBySource, ambiguousElements, mapping: value.mapping, document: value.document, recoveredLayouts });
      results.push({ mode, rejected, status: evaluateHtmlFlowAudit(value.document, ledger).status });
    }
    return results;
  });
  assert.equal(results[0].status, "PASS");
  for (const result of results.slice(1)) assert.equal(result.status, "PARTIAL", JSON.stringify(result));
  assert(results.filter((r) => ["detached", "ambiguous", "missing-owner", "malformed-clear"].includes(r.mode)).every((r) => r.rejected));
});
