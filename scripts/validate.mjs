import assert from "node:assert/strict";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["apps/design-studio", "apps/quant-lab", "templates/starter"];
const forbiddenNames = new Set([
  ".claude-plugin",
  ".codex-plugin",
  ".codeshell-plugin",
  ".mcp.json",
  "agents",
  "commands",
  "hooks",
  "skills",
]);
const allowedExtensions = new Set([
  ".html",
  ".js",
  ".mjs",
  ".md",
  ".css",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
]);
const allowedAgentExtensions = new Set([".md", ".json", ".png", ".jpg", ".jpeg", ".webp"]);

async function walk(directory, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const info = await lstat(absolute);
    const localPath = relative(root, absolute).split(sep).join("/");
    assert(!info.isSymbolicLink(), `${localPath}: symlinks are not allowed`);
    assert(
      localPath.includes("/") || !forbiddenNames.has(entry.name),
      `${localPath}: Agent Plugin content is not allowed`,
    );
    if (info.isDirectory()) files.push(...(await walk(absolute, root)));
    else {
      assert(info.isFile(), `${localPath}: unsupported file type`);
      files.push(localPath);
    }
  }
  return files;
}

async function validatePackage(packagePath) {
  const root = join(repositoryRoot, packagePath);
  const rootRealPath = await realpath(root);
  const manifestPath = join(root, ".codeshell-panel", "panel.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert(
    manifest.schemaVersion === 1 || manifest.schemaVersion === 2,
    `${packagePath}: schemaVersion must be 1 or 2`,
  );
  assert.match(manifest.id, /^[a-z][a-z0-9-]{0,63}$/, `${packagePath}: invalid id`);
  assert.equal(typeof manifest.version, "string", `${packagePath}: version is required`);
  assert.equal(typeof manifest.title?.default, "string", `${packagePath}: title is required`);
  assert.match(manifest.entry, /^app\/[^/].*\.html$/, `${packagePath}: entry must be below app/`);
  assert(Array.isArray(manifest.permissions), `${packagePath}: permissions must be an array`);
  const declaredSkillRoots = new Set();
  if (manifest.schemaVersion === 2 && manifest.agent) {
    assert(Array.isArray(manifest.agent.tools), `${packagePath}: agent.tools must be an array`);
    assert(Array.isArray(manifest.agent.skills), `${packagePath}: agent.skills must be an array`);
    const toolNames = new Set();
    for (const tool of manifest.agent.tools) {
      assert.match(tool.name, /^[a-z][a-z0-9_]{0,63}$/, `${packagePath}: invalid tool name`);
      assert(!toolNames.has(tool.name), `${packagePath}: duplicate tool ${tool.name}`);
      toolNames.add(tool.name);
      assert.equal(typeof tool.description, "string", `${packagePath}: tool description required`);
      assert.equal(tool.inputSchema?.type, "object", `${packagePath}: tool schema must be object`);
      assert.equal(typeof tool.readOnly, "boolean", `${packagePath}: tool readOnly required`);
    }
    for (const skill of manifest.agent.skills) {
      assert.match(
        skill,
        /^agent\/skills\/[a-z][a-z0-9-]{0,63}\/SKILL\.md$/,
        `${packagePath}: invalid Skill path`,
      );
      const skillInfo = await stat(join(root, ...skill.split("/")));
      assert(skillInfo.isFile(), `${packagePath}: declared Skill is not a file`);
      assert(skillInfo.size <= 256 * 1024, `${packagePath}: declared Skill exceeds 256 KiB`);
      declaredSkillRoots.add(skill.slice(0, -"/SKILL.md".length));
    }
  }

  const entry = resolve(root, ...manifest.entry.split("/"));
  const entryRealPath = await realpath(entry);
  assert(
    entryRealPath.startsWith(`${rootRealPath}${sep}`),
    `${packagePath}: entry escapes its package`,
  );
  assert((await stat(entryRealPath)).isFile(), `${packagePath}: entry is not a file`);

  const files = await walk(root);
  for (const file of files) {
    if (file === ".codeshell-panel/panel.json" || file === "README.md" || file === "LICENSE") {
      continue;
    }
    const declaredAgentAsset = [...declaredSkillRoots].some(
      (skillRoot) => file === skillRoot || file.startsWith(`${skillRoot}/`),
    );
    assert(
      file.startsWith("app/") || declaredAgentAsset,
      `${packagePath}/${file}: assets must live under app/ or a declared Skill`,
    );
    assert(
      (declaredAgentAsset ? allowedAgentExtensions : allowedExtensions).has(
        extname(file).toLowerCase(),
      ),
      `${packagePath}/${file}: unsupported asset extension`,
    );
  }

  const html = await readFile(entry, "utf8");
  assert(
    !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html),
    `${packagePath}: inline scripts are not allowed`,
  );
  if (manifest.id === "design-studio") {
    const appScript = await readFile(join(root, "app", "app.js"), "utf8");
    assert.match(html, /id="repo-files-tab-button"/, `${packagePath}: file tab is required`);
    assert.match(html, /id="repo-files-list"/, `${packagePath}: file list is required`);
    assert.match(html, /id="refresh-repo-files"/, `${packagePath}: file refresh is required`);
    assert.match(
      appScript,
      /refreshRepoFilesPanel/,
      `${packagePath}: file inventory refresh is required`,
    );
    assert.match(
      appScript,
      /renderDesignFileRows/,
      `${packagePath}: shared file rendering is required`,
    );
  }
  return { id: manifest.id, files: files.length };
}

const results = [];
for (const packagePath of packages) results.push(await validatePackage(packagePath));

const geometry = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/geometry.mjs"))
);
assert.deepEqual(
  geometry.selectionBounds([
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 20, y: 10, width: 5, height: 5 },
  ]),
  { x: 0, y: 0, width: 25, height: 15 },
);

const designCodec = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/document.mjs"))
);
const designAudit = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/audit.mjs"))
);
const designRepository = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/repository.mjs"))
);
const designLayout = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/layout.mjs"))
);
const baseNode = (id, type, name) => ({
  id,
  type,
  name,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  fill: type === "group" ? "transparent" : "#ffffff",
  stroke: "transparent",
  strokeWidth: 0,
  opacity: 1,
  rotation: 0,
  cornerRadius: 0,
  visible: true,
  locked: false,
});
const nestedDesign = {
  format: "codeshell.design",
  version: 3,
  name: "Nested smoke",
  canvas: { width: 1000, height: 800, background: "#eeeeee" },
  tokens: { colors: [] },
  activePageId: "page-1",
  pages: [
    {
      id: "page-1",
      name: "Page 1",
      children: [
        {
          ...baseNode("frame", "frame", "Frame"),
          layout: "grid",
          layoutWrap: "none",
          gap: 0,
          rowGap: 12,
          columnGap: 16,
          padding: 0,
          alignItems: "start",
          justifyContent: "start",
          alignContent: "stretch",
          gridColumns: 2,
          children: [
            {
              ...baseNode("group", "group", "Group"),
              fill: "transparent",
              layoutSizingHorizontal: "fill",
              layoutSizingVertical: "hug",
              gridColumnSpan: 2,
              layout: "none",
              gap: 0,
              padding: 0,
              alignItems: "start",
              justifyContent: "start",
              children: [{ ...baseNode("rect", "rectangle", "Rectangle") }],
            },
          ],
        },
      ],
    },
  ],
};
const designState = designCodec.normalizeDesignDocument(nestedDesign);
assert.equal(designState.nodes.length, 3);
assert.equal(designState.nodes[2].parentId, "group");
assert.equal(designState.nodes[0].layout, "grid");
assert.equal(designState.nodes[0].columnGap, 16);
assert.equal(designState.nodes[1].layoutSizingVertical, "hug");
const designRoundTrip = JSON.parse(designCodec.serializeDesignDocument(designState));
assert.equal(designRoundTrip.pages[0].children[0].children[0].children[0].id, "rect");
assert.equal(designRoundTrip.pages[0].children[0].gridColumns, 2);
assert.equal(designRoundTrip.pages[0].children[0].children[0].gridColumnSpan, 2);
for (const legacyField of ["layoutGrow", "layoutAlign"]) {
  const legacyDesign = structuredClone(nestedDesign);
  legacyDesign.pages[0].children[0].children[0][legacyField] =
    legacyField === "layoutGrow" ? 1 : "stretch";
  assert.throws(
    () => designCodec.normalizeDesignDocument(legacyDesign),
    new RegExp(`未知字段：${legacyField}`),
  );
}
const responsiveLayoutNodes = [
  {
    ...baseNode("responsive-row", "frame", "Responsive row"),
    x: 100,
    y: 50,
    width: 300,
    height: 100,
    layout: "horizontal",
    layoutWrap: "none",
    gap: 10,
    rowGap: 20,
    columnGap: 10,
    padding: 10,
    alignItems: "start",
    justifyContent: "start",
    alignContent: "start",
  },
  {
    ...baseNode("responsive-fixed", "rectangle", "Fixed"),
    parentId: "responsive-row",
    width: 50,
    height: 30,
    layoutAlignSelf: "end",
  },
  {
    ...baseNode("responsive-fill", "rectangle", "Fill"),
    parentId: "responsive-row",
    width: 20,
    height: 20,
    layoutSizingHorizontal: "fill",
    layoutSizingVertical: "fill",
  },
  {
    ...baseNode("responsive-overlay", "rectangle", "Overlay"),
    parentId: "responsive-row",
    x: 360,
    y: 55,
    width: 20,
    height: 20,
    layoutPositioning: "absolute",
  },
];
designLayout.applyAllAutoLayouts(responsiveLayoutNodes);
assert.equal(responsiveLayoutNodes[1].x, 110);
assert.equal(responsiveLayoutNodes[1].y, 110);
assert.equal(responsiveLayoutNodes[2].x, 170);
assert.equal(responsiveLayoutNodes[2].width, 220);
assert.equal(responsiveLayoutNodes[2].height, 80);
assert.equal(responsiveLayoutNodes[3].x, 360);
assert.equal(responsiveLayoutNodes[3].y, 55);

const wrapLayoutNodes = [
  {
    ...baseNode("wrap-row", "frame", "Wrap row"),
    width: 300,
    height: 120,
    layout: "horizontal",
    layoutWrap: "wrap",
    gap: 0,
    rowGap: 20,
    columnGap: 10,
    padding: 10,
    alignItems: "start",
    justifyContent: "start",
    alignContent: "start",
  },
  ...["a", "b", "c"].map((id) => ({
    ...baseNode(`wrap-${id}`, "rectangle", `Wrap ${id}`),
    parentId: "wrap-row",
    width: 120,
    height: 30,
  })),
];
designLayout.applyAllAutoLayouts(wrapLayoutNodes);
assert.deepEqual(
  wrapLayoutNodes.slice(1).map((node) => [node.x, node.y]),
  [
    [10, 10],
    [140, 10],
    [10, 60],
  ],
);

const hugLayoutNodes = [
  {
    ...baseNode("hug-row", "frame", "Hug row"),
    x: 20,
    y: 30,
    width: 1,
    height: 1,
    layout: "horizontal",
    gap: 8,
    padding: 12,
    alignItems: "start",
    justifyContent: "start",
    layoutSizingHorizontal: "hug",
    layoutSizingVertical: "hug",
  },
  {
    ...baseNode("hug-a", "rectangle", "Hug A"),
    parentId: "hug-row",
    width: 40,
    height: 20,
  },
  {
    ...baseNode("hug-b", "rectangle", "Hug B"),
    parentId: "hug-row",
    width: 60,
    height: 30,
  },
];
designLayout.applyAllAutoLayouts(hugLayoutNodes);
assert.equal(hugLayoutNodes[0].width, 132);
assert.equal(hugLayoutNodes[0].height, 54);
assert.deepEqual(
  hugLayoutNodes.slice(1).map((node) => [node.x, node.y]),
  [
    [32, 42],
    [80, 42],
  ],
);

const gridLayoutNodes = [
  {
    ...baseNode("grid", "frame", "Grid"),
    width: 320,
    height: 160,
    layout: "grid",
    gridColumns: 3,
    gap: 0,
    rowGap: 10,
    columnGap: 10,
    padding: 10,
    alignItems: "start",
    justifyContent: "start",
    alignContent: "start",
  },
  {
    ...baseNode("grid-wide", "rectangle", "Grid wide"),
    parentId: "grid",
    width: 20,
    height: 30,
    gridColumnSpan: 2,
    layoutSizingHorizontal: "fill",
  },
  {
    ...baseNode("grid-side", "rectangle", "Grid side"),
    parentId: "grid",
    width: 20,
    height: 30,
    layoutSizingHorizontal: "fill",
  },
  {
    ...baseNode("grid-next", "rectangle", "Grid next"),
    parentId: "grid",
    width: 20,
    height: 30,
    layoutSizingHorizontal: "fill",
  },
];
designLayout.applyAllAutoLayouts(gridLayoutNodes);
assert.equal(gridLayoutNodes[1].x, 10);
assert.equal(gridLayoutNodes[1].width, 196.67);
assert.equal(gridLayoutNodes[2].x, 216.67);
assert.equal(gridLayoutNodes[3].y, 50);
const manualOnlyNodes = Array.from({ length: 12 }, (_, index) => ({
  ...baseNode(`manual-frame-${index + 1}`, "frame", `Manual frame ${index + 1}`),
  x: (index % 6) * 120,
  y: Math.floor(index / 6) * 120,
  layout: "none",
  gap: 0,
  padding: 0,
  alignItems: "start",
  justifyContent: "start",
}));
const manualOnlyDocument = {
  canvas: { width: 1000, height: 800, background: "#eeeeee" },
  nodes: manualOnlyNodes,
};
assert(
  designAudit
    .auditDesign(manualOnlyDocument)
    .some((issue) => issue.code === "layout.manual-only-ui"),
);
assert(
  !designAudit
    .auditDesign({
      ...manualOnlyDocument,
      nodes: manualOnlyNodes.map((node, index) =>
        index === 0 ? { ...node, layout: "horizontal" } : node,
      ),
    })
    .some((issue) => issue.code === "layout.manual-only-ui"),
);
const defaultDesignEntry = {
  path: designRepository.DEFAULT_DESIGN_PATH,
  modifiedAt: 10,
};
assert.equal(
  designRepository.chooseRepoDesignFile([
    { path: "designs/newest.codesign.json", modifiedAt: 100 },
    defaultDesignEntry,
  ]),
  defaultDesignEntry,
);
assert.equal(
  designRepository.chooseRepoDesignFile([
    { path: "designs/older.codesign.json", modifiedAt: 10 },
    { path: "designs/newer.codesign.json", modifiedAt: 100 },
  ]).path,
  "designs/newer.codesign.json",
);

const quant = await import(pathToFileURL(join(repositoryRoot, "apps/quant-lab/app/engine.mjs")));
const bars = quant.generateDemoBars(260);
const run = quant.runBacktest(bars, {
  strategy: { type: "sma-cross", fast: 20, slow: 50 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 8,
});
assert.equal(run.equity.length, 260);
assert(Number.isFinite(run.metrics.finalEquity));

for (const result of results) {
  console.log(`✓ ${result.id}: ${result.files} files`);
}
console.log("✓ Design Studio geometry smoke test");
console.log("✓ Design Studio v3 recursive document smoke test");
console.log("✓ Design Studio responsive layout smoke test");
console.log("✓ Design Studio manual-only layout quality audit");
console.log("✓ Design Studio default repository file selection");
console.log("✓ Quant Lab engine smoke test");
