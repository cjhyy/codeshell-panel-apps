import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import {
  htmlPluginHarness,
  frameFixture,
  textFixture,
  PNG,
} from "./fixtures/html-plugin-harness.mjs";

test("installable plugin is deterministic, standalone, offline and based on upstream service/adapter", async () => {
  execFileSync(process.execPath, ["scripts/build-design-studio-html-plugin.mjs", "--check"], {
    stdio: "pipe",
  });
  const root = new URL("../../../apps/design-studio/app/html-to-figma-plugin/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.deepEqual(manifest.networkAccess.allowedDomains, ["none"]);
  assert.equal(
    Object.hasOwn(manifest, "id"),
    false,
    "distributed template must not forge a Figma-assigned plugin ID",
  );
  const readme = await readFile(new URL("README.md", root), "utf8");
  assert.match(readme, /创建一个\*\*带 UI 的插件\*\*/u);
  assert.match(readme, /Figma 分配的 `id` 值/u);
  assert.match(readme, /已填入该 ID 的本包 `manifest\.json`/u);
  assert.match(readme, /不要使用上游插件的 ID，也不要自行编造 ID/u);
  const code = await readFile(new URL("code.js", root), "utf8");
  assert.match(code, /class|FigmaService/);
  assert.match(code, /NodeCreatorFactory/);
  assert.match(code, /mapDesignNodeToFigma/);
  assert.doesNotMatch(code, /localhost|https:\/\/api\.html2figma|import\s+.*from\s+["']/);
  const receipt = JSON.parse(await readFile(new URL("build.json", root), "utf8"));
  assert(
    receipt.runtimeInputs.some((path) => path.includes("upstream/packages/figma/FigmaService.ts")),
  );
  assert(
    receipt.runtimeInputs.some((path) =>
      path.includes("upstream/packages/adapter/figma/nodeMapper.ts"),
    ),
  );
});

test("real upstream FigmaService creates editable styled text/frame, preserves existing nodes and preloads fonts", async () => {
  const f = htmlPluginHarness();
  const result = await f.importDesign(frameFixture([textFixture("Missing")]));
  assert.equal(result.type, "import-success");
  assert.equal(result.count, 2);
  assert(result.warnings.some((w) => w.includes("Missing")));
  assert.equal(f.page.children[0], f.existing);
  assert.equal(f.existing.removed, false);
  const imported = f.page.selection[0];
  assert.equal(imported.type, "FRAME");
  assert.equal(imported.width, 400);
  assert.equal(imported.children[0].characters, "Editable title");
  assert.equal(imported.children[0].fontName.family, "Inter");
  assert.equal(imported.children[0].fontSize, 24);
  assert(f.calls.some((c) => c[0] === "undo"));
});

test("standalone raw inputs refuse staged text ranges before upstream mutation or font loading", async () => {
  const f = htmlPluginHarness(), text = textFixture();
  text.textRanges = { version: 1, sourceSignature: JSON.stringify([text.characters]), ranges: [{ start: 0, end: 1, fill: "#123456" }] };
  const before = JSON.stringify(text), callCount = f.calls.length;
  const result = await f.importDesign(frameFixture([text]));
  assert.equal(result.type, "import-error");
  assert.match(result.message, /范围文字.*已阻止互转/u);
  assert.deepEqual(f.page.children, [f.existing]);
  assert.equal(f.calls.length, callCount);
  assert.equal(f.fonts.size, 0);
  assert.equal(JSON.stringify(text), before);
});

test("missing and duplicate DesignNode IDs cannot leak retained gradient paints onto unrelated nodes", async () => {
  for (const id of [undefined, "duplicate"]) {
    const f = htmlPluginHarness();
    const text = (name) => ({
      ...(id ? { id } : {}), nodeType: "text", tag: "span", name, content: name,
      bounds: { x: 0, y: 0, width: 180, height: 30 }, opacity: 1,
      visible: true, positioning: { mode: "static" },
      textStyle: { fontFamily: "Arial", fontSize: 20, fontWeight: 400, fontStyle: "normal",
        color: { r: 0, g: 0, b: 255, a: 1 }, textAlign: "left", textDecoration: "none", textTransform: "none",
        lineHeight: { value: 28, unit: "px" }, letterSpacing: { value: 0, unit: "px" } },
    });
    const gradient = text("Gradient"), plain = text("Plain");
    gradient.cssBackground = { "background-image": "linear-gradient(rgb(255,0,0),rgb(0,255,0))" };
    gradient.background = { layers: [] };
    const native = { ...frameFixture(), ...(id ? { id } : { id: undefined }) };
    const result = await f.importDesign([gradient, plain, native]);
    assert.equal(result.type, "import-success", result.message);
    const created = f.page.selection;
    assert.equal(created[0].fills[0].type, "GRADIENT_LINEAR");
    assert.equal(created[1].fills[0].type, "SOLID");
    assert.equal(created[1].characters, "Plain");
    assert.equal(created[2].fills[0].type, "SOLID");
    assert.equal(gradient.id, id, "the caller's source must remain untouched");
  }
});

test("partial upstream child failure rolls back only newly created layers and restores selection", async () => {
  const f = htmlPluginHarness({ failText: true });
  const result = await f.importDesign(frameFixture([textFixture()]));
  assert.equal(result.type, "import-error");
  assert.match(result.message, /Injected text creation failure/);
  assert.deepEqual(f.page.children, [f.existing]);
  assert.equal(f.page.selection.length, 1);
  assert.equal(f.page.selection[0], f.existing);
});

test("upstream silent NBSP fallback, dropped text and truncation are detected and rolled back", async () => {
  for (const textSetter of ["throw", "drop", "truncate"]) {
    const f = htmlPluginHarness({ textSetter });
    const result = await f.importDesign(frameFixture([textFixture()]));
    assert.equal(result.type, "import-error", textSetter);
    assert.match(result.message, /文字内容未完整创建/u);
    assert.equal(result.rollback, "complete");
    assert.deepEqual(f.page.children, [f.existing]);
    assert.equal(f.page.selection.length, 1);
    assert.equal(f.page.selection[0], f.existing);
    assert(!f.calls.some((call) => call[0] === "undo"));
  }
});

test("rich text verifies the complete characters once, preserving unstyled gaps and Unicode", async () => {
  const f = htmlPluginHarness();
  const text = {
    ...textFixture(),
    characters: "Bold plain 中文",
    styledTextSegments: [
      { start: 0, end: 4, fontName: { family: "Inter", style: "Bold" }, fontSize: 24 },
      { start: 11, end: 13, fontName: { family: "Inter", style: "Regular" }, fontSize: 18 },
    ],
  };
  const result = await f.importDesign(frameFixture([text]));
  assert.equal(result.type, "import-success");
  assert.equal(f.page.selection[0].children[0].characters, "Bold plain 中文");
  assert(
    f.page.selection[0].children[0].ranges.some(
      (range) => range.name === "FontName" && range.start === 11,
    ),
  );
  assert(result.warnings.some((warning) => warning.includes("复杂效果")));
});

test("inline images are materialized without browser globals or external fetch, and GROUP stays editable", async () => {
  const f = htmlPluginHarness();
  const rect = {
    id: "image",
    type: "RECTANGLE",
    name: "Image",
    x: 5,
    y: 6,
    width: 50,
    height: 50,
    fills: [
      {
        type: "IMAGE",
        scaleMode: "FIT",
        _imageMetadata: { originalUrl: `data:image/png;base64,${PNG}` },
      },
    ],
  };
  const root = frameFixture([rect]);
  root.type = "GROUP";
  const result = await f.importDesign(root);
  assert.equal(result.type, "import-success");
  assert(result.warnings.some((w) => w.includes("GROUP")));
  assert.equal(f.images.length, 1);
  assert.equal(f.page.selection[0].children[0].fills[0].imageHash, "image-0");
  const second = await f.importDesign(
    frameFixture([
      {
        ...rect,
        fills: [{ type: "IMAGE", _pendingImageUrl: "https://private.invalid/secret.png" }],
      },
    ]),
  );
  assert.equal(second.type, "import-error");
  assert.match(second.message, /不能下载外部 URL/);
});

test("malformed trees, unsupported formats and active SVG fail before document mutation", async () => {
  const f = htmlPluginHarness();
  for (const input of [
    { format: "codeshell.design.v3" },
    frameFixture([{ type: "COMPONENT", width: 10, height: 10 }]),
    frameFixture([
      { type: "SVG", width: 10, height: 10, svgContent: "<svg><script>alert(1)</script></svg>" },
    ]),
    { ...frameFixture(), width: Infinity },
  ]) {
    assert.equal((await f.importDesign(input)).type, "import-error");
    assert.deepEqual(f.page.children, [f.existing]);
  }
});


test("whitespace source receipts are informational even when stale, malformed or supplied in JSON", async () => {
  for (const stored of ["not JSON", "x".repeat(8001), JSON.stringify({format:"codeshell.html.text-whitespace",version:1,
    source:{whiteSpace:"normal",rawSource:"Old caption ",removedTrailingNbsp:true},snapshot:{characters:"Old caption"}})]) {
    const f = htmlPluginHarness(), source = frameFixture([textFixture()]);
    source.children[0].characters = "Keep authored\u00a0 ";
    source.children[0].sharedPluginData = {htmlTextWhitespace:stored};
    const before = JSON.stringify(source), result = await f.importDesign(source);
    assert.equal(result.type,"import-success",result.message);
    assert(result.warnings.some(warning=>/来源备注/u.test(warning)));
    assert(f.nodes.some(node=>node.characters==="Keep authored\u00a0 "));
    assert.equal(JSON.stringify(source),before,"JSON source and raw receipt stay untouched");
    assert.equal(f.nodes.find(node=>node.characters==="Keep authored\u00a0 ").metadata["html2figma:htmlTextWhitespace"],stored);
  }
});


test("oversized standalone source snapshots never overwrite existing raw metadata", async () => {
  const compiled = (await build({entryPoints:['third-party/html2figma-plugin/integration/text-whitespace.ts'],bundle:true,write:false,platform:'node',format:'esm'})).outputFiles[0].text;
  const {retainTextWhitespace} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  for (const original of [undefined,'keep this unknown raw receipt']) {
    const node={type:'FRAME',width:400,height:200,children:Array.from({length:80},(_,index)=>({type:'TEXT',x:0,y:index,width:200,height:20,characters:'x'.repeat(200)})),
      ...(original?{sharedPluginData:{htmlTextWhitespace:original}}:{})};
    const before=JSON.stringify(node),warnings=[];
    retainTextWhitespace(node,{whiteSpace:'normal',rawSource:'Caption ',removedTrailingNbsp:true},warnings);
    assert.equal(JSON.stringify(node),before,'an overcap informational source must leave the entire caller payload unchanged');
    assert(warnings.some(warning=>/8000 UTF-16/u.test(warning)));
  }
});
