import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { fixture, initialPath } from "./autosave-ui.fixture.mjs";
import { prepareFigmaImport } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { createFigmaBinding, figmaBindingPath, readFigmaBinding } from "../../../apps/design-studio/app/figma-binding.mjs";
import { createDesignIndexPersistencePlan, resolveDesignIndexDocument } from "../../../apps/design-studio/app/document-index.mjs";
import { serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";

const hash = async text => createHash("sha256").update(text).digest("hex");
const fileKey = path => `/project/A:${path}`;
const rectangle = (id, x, y) => ({ id, type: "RECTANGLE", name: id,
  absoluteBoundingBox: { x, y, width: 60, height: 40 },
  fills: [{ type: "SOLID", color: { r: 0.2, g: 0.4, b: 0.7 } }],
});

// Two pages and a source page-origin offset exercise indexed metadata without
// requiring a large personal document. Unknown raw source fields must survive.
export async function indexedInfiniteCase() {
  const raw = { fileKey: "indexed-world-source", name: "Indexed provenance", document: {
    id: "0:0", type: "DOCUMENT", children: [
      { id: "0:1", type: "CANVAS", name: "Negative source origin", children: [
        { ...rectangle("1:1", -100, -80), type: "FRAME", name: "First artboard",
          absoluteBoundingBox: { x: -100, y: -80, width: 320, height: 240 },
          originalUnknownMetadata: { retain: "source-one" }, children: [rectangle("1:2", -80, -60)] },
      ] },
      { id: "0:2", type: "CANVAS", name: "Second page", children: [
        { ...rectangle("2:1", 4500, 300), type: "FRAME", name: "Second artboard",
          absoluteBoundingBox: { x: 4500, y: 300, width: 320, height: 240 },
          originalUnknownMetadata: { retain: "source-two" }, children: [rectangle("2:2", 4520, 320)] },
      ] },
    ],
  } };
  const imported = await prepareFigmaImport(raw);
  const plan = await createDesignIndexPersistencePlan({ document: imported.document, sha256: hash });
  const binding = createFigmaBinding(imported);
  const extraFiles = new Map(plan.parts.map(part => [part.path, part.content]));
  extraFiles.set(figmaBindingPath(initialPath), JSON.stringify(binding));
  return { raw, imported, plan, binding, extraFiles };
}

async function metadata(f) {
  return f.page.evaluate(() => window.tools.get_design_metadata({}));
}

async function saved(f, mode) {
  await f.page.waitForFunction(
    () => document.querySelector("#save-state").textContent === "已保存",
    undefined, { timeout: 4000 },
  );
  const primary = f.files.get(fileKey(initialPath));
  assert.equal(JSON.parse(primary).canvas.mode, mode);
  return primary;
}

async function assertPagesAndBinding(f, original, mode) {
  const meta = await metadata(f);
  assert.equal(meta.canvas.mode, mode);
  assert.equal(meta.storageMode, "indexed");
  assert.deepEqual(meta.pages.map(({ id, name, nodeCount }) => ({ id, name, nodeCount })),
    original.plan.manifest.pages.map(({ id, name, nodeCount }) => ({ id, name, nodeCount })));
  for (const page of original.plan.manifest.pages) {
    const read = await f.page.evaluate(pageId => window.tools.get_design_context({ page_id: pageId }), page.id);
    const expected = JSON.parse(serializeDesignDocument(original.imported.document)).pages.find(candidate => candidate.id === page.id);
    assert.deepEqual(read.document.pages[0], expected);
  }
  const primarySource = f.files.get(fileKey(initialPath));
  const restored = await resolveDesignIndexDocument({ primarySource, sha256: hash,
    readText: async path => f.files.get(fileKey(path)) });
  assert.deepEqual(restored.manifest.pages, original.plan.manifest.pages);
  for (const part of original.plan.parts) assert.equal(f.files.get(fileKey(part.path)), part.content);
  const binding = await readFigmaBinding({ path: initialPath, sourceContent: primarySource,
    call: async (_method, { path }) => {
      const content = f.files.get(fileKey(path));
      if (content === undefined) throw Object.assign(Error("file not found"), { code: "ENOENT" });
      return { content };
    }, check() {}, sha256: hash,
  });
  assert.deepEqual(binding.source, original.binding.source);
  assert.deepEqual(binding.mapping, original.binding.mapping);
  assert.deepEqual(binding.pageMappings, original.binding.pageMappings);
  assert.deepEqual(binding.baseline, original.binding.baseline);
  const current = await metadata(f);
  await f.page.evaluate(expected => window.tools.exchange_figma({ action: "export", path: "designs/index-world.figma-transfer.json", expected_state_revision: expected }), current.stateRevision);
  const transfer = JSON.parse(f.files.get(fileKey("designs/index-world.figma-transfer.json")));
  assert.deepEqual(transfer.patch.operations, []);
  assert.deepEqual(transfer.patch.mapping, original.binding.mapping);
  assert.deepEqual(transfer.patch.pageMappings, original.binding.pageMappings);
}

test("indexed legacy mode upgrade, save, Undo, Redo and reopen preserve page parts, coordinates and Figma provenance", async t => {
  const original = await indexedInfiniteCase();
  const f = await fixture(t, { initialSource: original.plan.primarySource, extraFiles: original.extraFiles,
    ...(process.env.DESIGN_STUDIO_INFINITE_OLD_ROOT ? { sourceRoot: process.env.DESIGN_STUDIO_INFINITE_OLD_ROOT } : {}),
  });
  await f.page.waitForFunction(() => Boolean(window.tools?.get_design_metadata));
  const initial = await metadata(f);
  assert.equal(initial.storageMode, "indexed");
  assert.equal(initial.canvas.mode, undefined);
  assert.equal(initial.pages[0].loaded, true);
  assert.equal(initial.pages[1].loaded, false);
  await f.page.locator("#enable-infinite-canvas").click({ timeout: 1500 });
  await saved(f, "infinite");
  await assertPagesAndBinding(f, original, "infinite");
  await f.page.locator(".brand").click();
  await f.page.keyboard.press("Control+z");
  await saved(f, undefined);
  await assertPagesAndBinding(f, original, undefined);
  await f.page.locator(".brand").click();
  await f.page.keyboard.press("Control+Shift+z");
  await saved(f, "infinite");
  await assertPagesAndBinding(f, original, "infinite");
  await f.page.reload();
  await f.page.waitForFunction(() => !document.querySelector(".workspace").inert && Boolean(window.tools?.get_design_metadata));
  await assertPagesAndBinding(f, original, "infinite");
  const partWrites = f.calls.filter(call => call.method === "workspace.writeText" && original.plan.parts.some(part => part.path === call.path));
  assert.deepEqual(partWrites, [], "metadata-only upgrade must reuse the original immutable page parts");
  assert.deepEqual(f.errors, []);
});
