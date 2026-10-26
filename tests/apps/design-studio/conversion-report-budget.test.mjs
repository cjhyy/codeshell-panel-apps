import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { assertCompleteConversionReports } from "../../../apps/design-studio/app/conversion-report.mjs";

const ready = () => ({ version: 1, ready: true, partial: false, errors: [], warnings: [] });

// Keep the adversarial input and all potentially expensive preflight work in a
// memory-capped child. A failure must terminate that child rather than hanging
// the complete browser/Node regression runner.
test("conversion report preflight reaches the existing source budget for deep metadata in a bounded child", () => {
  const moduleUrl = new URL("../../../apps/design-studio/app/figma-assets.mjs", import.meta.url).href;
  const program = `
    import assert from "node:assert/strict";
    import { normalizeFigmaSource, MAX_FIGMA_SOURCE_BYTES } from ${JSON.stringify(moduleUrl)};
    const ready = {version:1,ready:true,partial:false,errors:[],warnings:[]};
    const input = (depth, nativeNotes, nestedReport = false) => {
      const root = '{"id":"budget-root","type":"FRAME","name":"frame","absoluteBoundingBox":{"x":0,"y":0,"width":100,"height":80},"children":[],"metadata":';
      const notes = nativeNotes ? ',"nativeNotes":{"version":1,"pluginId":"budget-fixture","nodes":{"budget-root":{"type":"FRAME","notes":{"kind":"absent"}}}}' : '';
      const leaf = nestedReport ? '{"conversionReport":'+JSON.stringify(ready)+'}' : 'null';
      const json = root+'{"next":'.repeat(depth)+leaf+'}'.repeat(depth)+notes+'}';
      assert(Buffer.byteLength(json) < MAX_FIGMA_SOURCE_BYTES);
      return { source: JSON.parse(json), bytes: Buffer.byteLength(json) };
    };
    const checks = [];
    for (const [depth, nativeNotes] of [[8,true],[256,false]]) {
      const value = input(depth,nativeNotes), normalized = normalizeFigmaSource(value.source);
      assert.equal(Object.keys(normalized.nodes).length,1);
      checks.push({depth,nativeNotes,bytes:value.bytes,accepted:true});
    }
    const deep = input(60000,true);
    assert.throws(() => normalizeFigmaSource(deep.source), /循环或不可序列化/);
    checks.push({depth:60000,nativeNotes:true,bytes:deep.bytes,existingSourceBudgetRejected:true});
    const report = input(60000,true,true);
    assert.throws(() => normalizeFigmaSource(report.source), {code:'CONVERSION_REPORT_INVALID'});
    checks.push({depth:60000,nativeNotes:true,bytes:report.bytes,nestedReportRejected:true});
    console.log(JSON.stringify({checks}));
  `;
  const child = spawnSync(process.execPath, ["--max-old-space-size=96", "--input-type=module", "-e", program], {
    encoding: "utf8", timeout: 4000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
  });
  assert.equal(child.error, undefined, `bounded preflight child failed: ${child.error?.code}; ${child.stderr}`);
  assert.equal(child.status, 0, `preflight child status ${child.status}/${child.signal}: ${child.stderr}`);
  const result = JSON.parse(child.stdout);
  assert.equal(result.checks.length, 4);
  assert.equal(result.checks[1].accepted, true, "legacy metadata has no new arbitrary depth cutoff");
  assert.equal(result.checks[2].existingSourceBudgetRejected, true);
  assert.equal(result.checks[3].nestedReportRejected, true);
});

test("a report-bearing root aliased beneath metadata never gains root ownership there", () => {
  const owner = { id: "root", type: "FRAME", children: [], conversionReport: ready() };
  assert.doesNotThrow(() => assertCompleteConversionReports({ nodes: [owner] }));
  // The same identity is legal at nodes[0] and illegal at metadata.alias. Keep
  // owner paths distinct even after the traversal has already seen the object.
  assert.throws(() => assertCompleteConversionReports({ nodes: [owner], metadata: { alias: owner } }),
    { code: "CONVERSION_REPORT_INVALID" });
  assert.throws(() => assertCompleteConversionReports({ metadata: { alias: owner }, nodes: [owner] }),
    { code: "CONVERSION_REPORT_INVALID" });
  assert.deepEqual(owner.conversionReport, ready());
});
