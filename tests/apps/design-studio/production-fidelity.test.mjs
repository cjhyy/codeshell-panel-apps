import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  comparePixels,
  runProductionFidelity,
} from "../../../scripts/design-studio-production-fidelity.mjs";
import {
  loadFidelityLocalFixture,
  safeFidelityFixturePath,
} from "../../../scripts/design-studio-fidelity-local-assets.mjs";

function image(width, height, change) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  change?.(png.data);
  return PNG.sync.write(png);
}

test("production pixel comparison detects a single changed pixel and writes its diff", () => {
  const result = comparePixels(
    image(40, 20),
    image(40, 20, (data) => {
      data[97 * 4] = 254;
    }),
  );
  assert.equal(result.metrics.changedPixels, 1);
  assert.equal(result.metrics.pixelsOutsideTolerance, 1);
  assert.equal(result.metrics.changedPixelRatio, 1 / 800);
  assert.equal(result.metrics.maximumChannelDelta, 1);
  const diff = PNG.sync.read(result.diff);
  assert.equal(diff.data[97 * 4], 6);
  assert.equal(diff.data[97 * 4 + 3], 255);
});

test("pixel tolerance never hides exact changed-pixel or alpha measurements", () => {
  const result = comparePixels(
    image(2, 2),
    image(2, 2, (data) => {
      data[3] = 250;
    }),
    8,
  );
  assert.equal(result.metrics.changedPixels, 1);
  assert.equal(result.metrics.pixelsOutsideTolerance, 0);
  assert.equal(result.metrics.maximumChannelDelta, 5);
});

test("different image dimensions fail instead of resizing away evidence", () => {
  assert.throws(() => comparePixels(image(2, 2), image(3, 2)), /widths differ/u);
  assert.throws(() => comparePixels(image(2, 2), image(2, 3)), /heights differ/u);
});

test("production gate preserves authored overlays without mistaking them for degraded flow", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "production-fidelity-overlay-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await runProductionFidelity({
    output,
    cases: [
      {
        id: "authored-overlay",
        source: `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white}#fixture{position:relative;display:flex;width:100%;height:240px;gap:12px;padding:20px;background:#e2e8f0}#flow{width:100px;height:120px;background:#2563eb}#badge{position:absolute;left:20px;top:180px;width:20px;height:20px;background:#f97316}</style><main id="fixture"><div id="flow"></div><div id="badge"></div></main>`,
      },
    ],
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.cases[0].semanticIssues, []);
  assert.deepEqual(result.cases[0].flowAudits.map(audit => [audit.mode, audit.status]), [["imported", "PASS"], ["relayout", "PASS"], ["narrow", "PASS"]]);
  assert.deepEqual(result.cases[0].nativeTransfer, { supported: true, status: "prepared", stage: "production-v3-transfer" });
  assert.equal(JSON.parse(await readFile(join(output, "authored-overlay/figma-transfer.json"), "utf8")).format, "codeshell.figma.transfer");
  assert.ok(Object.values(result.cases[0].sourcePositioning).includes("absolute"));
  assert.ok(result.cases[0].comparisons.every((comparison) => comparison.changedPixels === 0));
});

test("selected local CSS/image bytes and a custom root feed reference/capture with zero strict pixel changes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fidelity-local-assets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const selected = join(directory, "selected"),
    output = join(directory, "output");
  await mkdir(join(selected, "assets"), { recursive: true });
  await mkdir(join(selected, "pages"));
  const asset = image(8, 8, (data) => {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;
      data[i + 1] = 80;
      data[i + 2] = 255;
    }
  });
  await writeFile(join(selected, "assets/tile.png"), asset);
  await writeFile(
    join(selected, "assets/style.css"),
    "*{box-sizing:border-box}body{margin:0;background:white}#app{display:flex;width:100%;height:240px;padding:20px;gap:12px;background:#e2e8f0}img{width:80px;height:80px}#fill{flex:1;height:80px;background:#f97316}",
  );
  await writeFile(
    join(selected, "pages/source.html"),
    '<!doctype html><link rel="stylesheet" href="../assets/style.css"><main id="app"><img src="../assets/tile.png"><div id="fill"></div></main>',
  );
  const result = await runProductionFidelity({
    output,
    cases: [
      {
        id: "local-assets",
        directory: selected,
        sourcePath: "pages/source.html",
        rootSelector: "main#app",
      },
    ],
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.blockedRequests, []);
  assert.deepEqual(result.browserErrors, []);
  assert.ok(result.cases[0].comparisons.every((comparison) => comparison.changedPixels === 0));
  assert.equal(result.cases[0].localFixture.files.length, 3);
  assert.deepEqual(
    await readFile(join(output, "local-assets/local-fixture/assets/tile.png")),
    asset,
  );
  const portable = JSON.parse(
    await readFile(join(output, "local-assets/complete.portable.json"), "utf8"),
  );
  assert.ok(
    portable.resources.some((resource) => Buffer.from(resource.base64, "base64").equals(asset)),
  );
});

test("fixture snapshot rejects escapes, symlinks and unsafe selected paths", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fidelity-paths-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const selected = join(directory, "selected");
  await mkdir(selected);
  await writeFile(join(selected, "source.html"), "<!doctype html><p>Fixture</p>");
  for (const path of [
    "../source.html",
    "/source.html",
    "a/../source.html",
    "a\\source.html",
    ".hidden.html",
    "node_modules/a.html",
    "con.html",
    "a.html?x",
    "a.html#x",
    "https://x/a.html",
  ])
    assert.equal(safeFidelityFixturePath(path), false, path);
  await assert.rejects(loadFidelityLocalFixture(selected, "../source.html"), /safe relative/u);
  await symlink(selected, join(directory, "alias"));
  await assert.rejects(loadFidelityLocalFixture(join(directory, "alias")), /symlink/u);
  await symlink(join(directory, "outside.png"), join(selected, "linked.png"));
  await assert.rejects(loadFidelityLocalFixture(selected), /symlink/u);
  await rm(join(selected, "linked.png"));
  await symlink(directory, join(selected, "linked-dir"));
  await assert.rejects(loadFidelityLocalFixture(selected), /symlink/u);
});

test("local font MIME follows the selected filename extension without modifying raw bytes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fidelity-font-mime-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "source.html"), "<!doctype html>");
  const bytes = Buffer.from([0x77, 0x4f, 0x46, 0x46]);
  await writeFile(join(directory, "original.woff"), bytes);
  const fixture = await loadFidelityLocalFixture(directory);
  assert.equal(fixture.resource("original.woff").mime, "font/woff");
  assert.deepEqual(Buffer.from((await fixture.readAsset("original.woff")).base64, "base64"), bytes);
  await assert.rejects(fixture.readText("original.woff"), /not HTML\/CSS/u);
  await assert.rejects(fixture.readAsset("../original.woff"), /unavailable/u);
});

test("fixture budgets match production source, individual asset, total asset and selected-file limits", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fidelity-budgets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "source.html"), "<!doctype html>");
  const blob = join(directory, "large.png");
  await writeFile(blob, "x");
  await truncate(blob, 8 * 1024 * 1024 + 1);
  await assert.rejects(loadFidelityLocalFixture(directory), /8 MiB/u);
  await truncate(blob, 7 * 1024 * 1024);
  await writeFile(join(directory, "second.png"), "x");
  await truncate(join(directory, "second.png"), 7 * 1024 * 1024);
  await assert.rejects(loadFidelityLocalFixture(directory), /12 MiB/u);
  await rm(blob);
  await rm(join(directory, "second.png"));
  await writeFile(join(directory, "large.css"), " ".repeat(512 * 1024));
  await assert.rejects(loadFidelityLocalFixture(directory), /512 KiB combined/u);
  await rm(join(directory, "large.css"));
  for (let offset = 0; offset < 2048; offset += 64)
    await Promise.all(
      Array.from({ length: 64 }, (_, i) =>
        writeFile(join(directory, `asset-${offset + i}.png`), "x"),
      ),
    );
  await assert.rejects(loadFidelityLocalFixture(directory), /2048 selected files/u);
});

test("external URLs stay blocked during a selected-folder comparison", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fidelity-external-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "source.html"),
    '<!doctype html><style>body{margin:0}#fixture{width:100%;height:240px;background:white}</style><main id="fixture"><img src="https://external.invalid/track.png"></main>',
  );
  const report = await runProductionFidelity({
    output: join(directory, "out"),
    cases: [{ id: "blocked", directory }],
    recordOnly: true,
  });
  assert.ok(
    report.cases[0].warnings.some((warning) => warning.code === "external-resource-blocked"),
  );
  assert.deepEqual(
    report.cases[0].localFixture.files.map((file) => file.path),
    ["source.html"],
  );
  assert.ok(report.blockedRequests.every((url) => new URL(url).hostname === "external.invalid"));
});

test('native-spacing rejection records strict failure and SVG evidence without a stale successful transfer',async(t)=>{
  const output=await mkdtemp(join(tmpdir(),'fidelity-native-spacing-'));t.after(()=>rm(output,{recursive:true,force:true}));
  await mkdir(join(output,'insufficient-inset'));
  await writeFile(join(output,'insufficient-inset/figma-transfer.json'),'{"stale":true}');
  const result=await runProductionFidelity({output,recordOnly:true,resizeMode:'viewport-only',cases:[{id:'insufficient-inset',
    source:'<!doctype html><style>*{box-sizing:border-box}body{margin:0;background:white}#fixture{padding:5px;height:240px;background:#eee}#row{display:flex;gap:10px;margin:0 -15px}#row>div{flex:1;height:50px;background:#2563eb}</style><main id="fixture"><section id="row"><div></div><div></div></section></main>'}]});
  const observed=result.cases[0];assert.equal(result.passed,false);assert.equal(observed.nativeTransfer.supported,false);
  assert.equal(observed.nativeTransfer.stage,'production-v3-transfer');assert.equal(observed.nativeTransfer.status,'unsupported');
  assert.equal(observed.nativeTransfer.error.code,'NATIVE_NEGATIVE_SPACING');
  assert(observed.semanticIssues.some(issue=>issue.startsWith('Native transfer rejected:')));
  assert.equal(observed.comparisons.length,3);assert(observed.comparisons.every(item=>item.changedPixels===0));
  assert.equal(JSON.parse(await readFile(join(output,'insufficient-inset/native-transfer-error.json'),'utf8')).status,'unsupported');
  await assert.rejects(()=>readFile(join(output,'insufficient-inset/figma-transfer.json')),error=>error.code==='ENOENT');
});

test('record-only native-spacing handling still throws unrelated native paint failures',async(t)=>{
  const output=await mkdtemp(join(tmpdir(),'fidelity-unrelated-transfer-'));t.after(()=>rm(output,{recursive:true,force:true}));
  await assert.rejects(()=>runProductionFidelity({output,recordOnly:true,cases:[{id:'mixed-border',
    source:'<!doctype html><style>*{box-sizing:border-box}body{margin:0;background:white}#fixture{display:flex;width:100%;height:240px;padding:20px}#tile{flex:1;height:100px;background:white;border-top:2px solid red;border-bottom:2px solid blue}</style><main id="fixture"><div id="tile"></div></main>'}]}),/多色边框/u);
  await assert.rejects(()=>readFile(join(output,'mixed-border/native-transfer-error.json')),error=>error.code==='ENOENT');
});
