import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { textMetricsSignature } from "../../../apps/design-studio/app/text-metrics.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";

/* SVG warning egress (review of the cross-surface batch). exportDesignSvg reports TEXT_LINE_BOX_SVG_UNMEASURED only into
 * options.diagnostics; the CLI and the panel passed none, so a Node export of non-provenanced finite typography kept
 * the receipt geometry (50.7 where the browser line box is 54) without any visible signal. */
const cli = fileURLToPath(new URL("../../../apps/design-studio/app/tools/design-studio.mjs", import.meta.url));
const textBase = { name: "t", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false, type: "text",
  fill: "#000000", fontFamily: "Arial", fontSize: 14, fontWeight: 400, lineHeight: 1.3, textAlign: "left", width: 260, height: 50 };
function finiteTypography(id = "typo") {
  const text = "Finite bold\nsecond Big";
  const node = { ...textBase, id, x: 20.3, y: 40.3, text, layoutBaselineOffset: 3.5,
    textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges: [{ start: 7, end: 11, fontWeight: 700 }, { start: 19, end: 22, fontSize: 18 }] } };
  node.textMetrics = { version: 1, signature: textMetricsSignature(node), lineWidths: [80, 75], lineInkBounds: [{ x: 0, y: -2, width: 80, height: 16 }, { x: 0, y: -2, width: 75, height: 20 }],
    height: 44, fontAvailable: true, alphabeticBaseline: 10.4, lineHeights: [18.2, 23.4], lineOffsets: [0, 22.8] };
  return node;
}
const designOf = children => normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "Egress", canvas: { width: 400, height: 200, background: "#ffffff" },
  tokens: { colors: [] }, resources: [], activePageId: "main", pages: [{ id: "main", name: "Main", children }] });
const rectangle = { id: "box", name: "box", type: "rectangle", x: 10, y: 10, width: 40, height: 20, fill: "#123456", stroke: "transparent", strokeWidth: 0, opacity: 1,
  rotation: 0, cornerRadius: 0, visible: true, locked: false };

async function project(t, children) {
  const root = await mkdtemp(join(tmpdir(), "svg-egress-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "designs")); await writeFile(join(root, "designs/egress.codesign.json"), serializeDesignDocument(designOf(children)));
  const run = async (name, input) => { const request = join(root, `request-${Math.random().toString(36).slice(2)}.json`); await writeFile(request, JSON.stringify(input));
    const result = await promisify(execFile)(process.execPath, [cli, "run", name, "--project", root, "--input-file", request], { cwd: tmpdir(), timeout: 15000 });
    const lines = result.stdout.trimEnd().split("\n"); return { stderr: result.stderr, lines, value: JSON.parse(result.stdout) }; };
  return { root, run };
}

test("actual CLI svg: an unmeasured finite-typography baseline is a structured warning in the single stdout JSON, with and without output", async t => {
  const p = await project(t, [finiteTypography()]);
  const inline = await p.run("svg", { path: "designs/egress.codesign.json" });
  assert.equal(inline.stderr, "", "nothing on stderr");
  assert.equal(inline.lines.length, 1, "stdout is a single JSON line");
  assert.equal(inline.value.ok, true);
  assert.match(inline.value.result.content, /<svg/u);
  assert.deepEqual(inline.value.result.warnings.map(({ code, severity, nodeId, pageId }) => ({ code, severity, nodeId, pageId })),
    [{ code: "TEXT_LINE_BOX_SVG_UNMEASURED", severity: "warning", nodeId: "typo", pageId: "main" }], "one warning per node (not per run or line), locatable");
  assert.match(inline.value.result.warnings[0].message, /font metrics/u);
  const written = await p.run("svg", { path: "designs/egress.codesign.json", output: "designs/egress.svg" });
  assert.equal(written.stderr, ""); assert.equal(written.lines.length, 1);
  assert.ok(written.value.result.output, "the output receipt is returned");
  assert.deepEqual(written.value.result.warnings.map(item => item.code), ["TEXT_LINE_BOX_SVG_UNMEASURED"], "the receipt carries the warning too");
  assert.match(await readFile(join(p.root, "designs/egress.svg"), "utf8"), /<svg/u);
});

test("actual CLI svg: a design with nothing unmeasured has no warnings field (no noise)", async t => {
  const p = await project(t, [rectangle]);
  const inline = await p.run("svg", { path: "designs/egress.codesign.json" });
  assert.equal(inline.stderr, "");
  assert.equal(Object.hasOwn(inline.value.result, "warnings"), false);
  const written = await p.run("svg", { path: "designs/egress.codesign.json", output: "designs/plain.svg" });
  assert.equal(Object.hasOwn(written.value.result, "warnings"), false);
});

test("supplied plain metrics only measure runs in the node's exact font; other runs are unmeasured, a resolver function measures each run", () => {
  const design = designOf([finiteTypography()]);
  // Plain value (the node font's metrics): the 18px and bold runs are not that font -> unmeasured, receipt geometry kept.
  const plainDiagnostics = [];
  const plain = exportDesignSvg(design, { textLineBoxMetrics: new Map([["typo", { ascent: 13, descent: 3 }]]), diagnostics: plainDiagnostics });
  assert.deepEqual([...plain.matchAll(/<text x="[^"]*" y="([^"]*)"/g)].map(m => +m[1]), [50.7, 73.5], "no baseline guessed from the node font's metrics");
  assert.deepEqual(plainDiagnostics, [{ code: "TEXT_LINE_BOX_SVG_UNMEASURED", nodeId: "typo" }]);
  // Resolver function: metrics per run font -> the mixed line box (line 0 alpha = max(floor((18.2+13-3)/2) = 14, bold 14) = 14).
  const resolverDiagnostics = [];
  const metricsFor = run => run.fontSize === 18 ? { ascent: 17, descent: 4 } : { ascent: 13, descent: 3 };
  const resolved = exportDesignSvg(design, { textLineBoxMetrics: new Map([["typo", metricsFor]]), diagnostics: resolverDiagnostics });
  assert.deepEqual(resolverDiagnostics, []);
  assert.deepEqual([...resolved.matchAll(/<text x="[^"]*" y="([^"]*)"/g)].map(m => +m[1]), [54, 77], "trunc(40.3) + 14 -> 54; + measured delta 22.8 -> 77");
});
