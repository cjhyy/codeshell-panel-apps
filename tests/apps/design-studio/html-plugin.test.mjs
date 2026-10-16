import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
