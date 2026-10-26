import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { fixture, initialPath } from "./autosave-ui.fixture.mjs";
import { gpuActive } from "./fixtures/canvas-test-observations.mjs";

const initial = serializeDesignDocument(normalizeDesignDocument({
  format: "codeshell.design", version: 3, name: "Small type in infinite space",
  canvas: { mode: "infinite", width: 800, height: 600, background: "#ffffff" },
  tokens: { colors: [] }, activePageId: "page-1", pages: [{ id: "page-1", name: "Type", children: [{
    id: "tiny-type", type: "text", name: "Small text", x: -48000, y: 65000,
    width: 120, height: 40, text: "Small text", fontFamily: "Inter", fontSize: 16,
    fontWeight: 400, fontStyle: "normal", lineHeight: 1.2, textAlign: "left",
    fill: "#111111", stroke: "transparent", strokeWidth: 0, opacity: 1,
    visible: true, locked: false, rotation: 0, cornerRadius: 0,
  }] }],
}));

async function current(page) {
  return page.evaluate(() => window.tools.get_design_context({ node_id: "tiny-type" }).then(result => result.node));
}
async function settledSave(page) {
  await page.waitForFunction(() => document.querySelector("#save-state").textContent === "已保存", undefined, { timeout: 5000 });
}

test("the real font-size inspector preserves 4px and 1px through autosave, Undo, Redo and infinite-page reopen", async t => {
  const sourceOverrides = new Map();
  if (process.env.DESIGN_STUDIO_FONT_EDITOR_OLD_APP_JS)
    sourceOverrides.set("app.js", await readFile(process.env.DESIGN_STUDIO_FONT_EDITOR_OLD_APP_JS, "utf8"));
  const f = await fixture(t, { initialSource: initial, sourceOverrides, gpu: true }), observations = [];
  await f.page.setViewportSize({ width: 1400, height: 900 });
  const remember = async label => observations.push({ label, node: await current(f.page), saved: f.files.get(`/project/A:${initialPath}`) });
  try {
    await gpuActive(f.page);
    await f.page.locator("#layers-list [data-id='tiny-type']").click();
    assert.equal(await f.page.locator("#prop-font-size").getAttribute("min"), "1");
    for (const size of [4, 1]) {
      await f.page.locator("#prop-font-size").fill(String(size));
      await f.page.locator("#prop-font-size").press("Tab");
      await remember(`edited-${size}`);
      assert.equal((await current(f.page)).fontSize, size);
      await settledSave(f.page);
      const saved = JSON.parse(f.files.get(`/project/A:${initialPath}`));
      assert.equal(saved.pages[0].children[0].fontSize, size);
      assert.equal(saved.canvas.mode, "infinite");
      assert.deepEqual([saved.pages[0].children[0].x, saved.pages[0].children[0].y], [-48000, 65000]);
    }
    await f.page.locator(".brand").click();
    await f.page.keyboard.press("Control+z");
    await settledSave(f.page); assert.equal((await current(f.page)).fontSize, 4);
    await f.page.keyboard.press("Control+Shift+z");
    await settledSave(f.page); assert.equal((await current(f.page)).fontSize, 1);
    await f.page.reload();
    await f.page.waitForFunction(() => !document.querySelector(".workspace").inert);
    await gpuActive(f.page);
    await remember("reopened");
    assert.equal((await current(f.page)).fontSize, 1);
    assert.deepEqual([(await current(f.page)).x, (await current(f.page)).y], [-48000, 65000]);
    await f.page.locator("#layers-list [data-id='tiny-type']").click();
    assert.equal(await f.page.locator("#prop-font-size").inputValue(), "1");
    assert.deepEqual(f.errors, []);
  } finally {
    if (process.env.DESIGN_STUDIO_FONT_EDITOR_EVIDENCE_DIR) {
      const directory = resolve(process.env.DESIGN_STUDIO_FONT_EDITOR_EVIDENCE_DIR);
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, "observations.json"), JSON.stringify({ observations, errors: f.errors }, null, 2) + "\n", { flag: "wx" });
      await writeFile(resolve(directory, "inspector.png"), await f.page.screenshot(), { flag: "wx" });
    }
  }
});
