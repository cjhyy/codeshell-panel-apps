import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url));
const fileValue = {
  name: "Figma UI fixture",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        name: "Landing",
        children: [
          {
            id: "1:1",
            type: "FRAME",
            name: "Card",
            absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 400 },
            fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
            children: [
              {
                id: "1:2",
                type: "TEXT",
                name: "Heading",
                characters: "Editable Figma title",
                absoluteBoundingBox: { x: 30, y: 30, width: 400, height: 50 },
                style: {
                  fontFamily: "Inter",
                  fontSize: 28,
                  fontWeight: 600,
                  textAlignHorizontal: "LEFT",
                },
                fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }],
              },
            ],
          },
        ],
      },
    ],
  },
};
async function fixture(t, { mobile = false } = {}) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1500, height: 1000 },
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url()),
      path = resolve(root, `.${url.pathname}`);
    if (url.origin !== "https://panel.test" || !path.startsWith(root)) return route.abort();
    try {
      await route.fulfill({
        body: await readFile(path),
        contentType: {
          ".html": "text/html",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
        }[extname(path)],
      });
    } catch {
      await route.fulfill({ status: 404, body: "missing" });
    }
  });
  await page.goto("https://panel.test/index.html");
  await page.waitForFunction(() => !document.querySelector(".workspace").inert);
  const open = async () => {
    if (mobile) {
      await page.locator("#compact-actions summary").click();
      await page.locator('[data-toolbar-action="open-figma-workflow"]').click();
    } else await page.locator("#open-figma-workflow").click();
    const frame = await page.locator("#figma-workflow-dialog").boundingBox();
    const title = await page.locator("#figma-workflow-title").boundingBox();
    assert.ok(
      title.x >= frame.x && title.x + title.width <= frame.x + frame.width,
      "dialog heading must remain inside the visible dialog",
    );
  };
  const choose = async (value = fileValue) => {
    await page
      .locator("#figma-import-file")
      .setInputFiles({
        name: "figma.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(value)),
      });
    await page.waitForFunction(
      () => document.querySelector("#figma-workflow-dialog").getAttribute("aria-busy") === "false",
    );
  };
  const download = async (selector) => {
    try {
      const [result] = await Promise.all([
        page.waitForEvent("download", { timeout: 5000 }),
        page.locator(selector).click(),
      ]);
      return {
        name: result.suggestedFilename(),
        text: await readFile(await result.path(), "utf8"),
      };
    } catch (error) {
      error.message += `\n${selector}: ${await page.locator("#figma-workflow-status").textContent()}`;
      throw error;
    }
  };
  return { page, errors, open, choose, download };
}

test("Figma JSON becomes editable layers, exports transfer and offline HTML, and the import is undoable", async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.choose();
  assert.match(await f.page.locator("#figma-import-preview").textContent(), /2 个可编辑图层/);
  await f.page.locator("#figma-import-apply").click();
  await f.page.waitForFunction(() =>
    document.querySelector("#figma-workflow-status").textContent.includes("已导入"),
  );
  const transfer = await f.download("#figma-transfer-download"),
    payload = JSON.parse(transfer.text);
  assert.equal(payload.format, "codeshell.figma.transfer");
  assert.match(transfer.text, /Editable Figma title/);
  const html = await f.download("#figma-html-download");
  assert.equal(html.name, "design-prototype.html");
  assert.match(html.text, /data-codeshell-id="figma-1-2"/);
  assert.match(html.text, /Editable Figma title/);
  await f.page.locator("#figma-workflow-close").click();
  await f.page.locator('[data-text-node-id="figma-1-2"]').dblclick();
  await f.page.locator("#inline-text-editor").fill("Edited inside panel");
  await f.page.locator("#inline-text-editor").press("Control+Enter");
  assert.equal(
    await f.page.locator('[data-text-node-id="figma-1-2"]').textContent(),
    "Edited inside panel",
  );
  await f.page.locator("#stage").press("Control+z");
  assert.equal(
    await f.page.locator('[data-text-node-id="figma-1-2"]').textContent(),
    "Editable Figma title",
  );
  await f.page.locator("#stage").press("Control+z");
  assert.equal(await f.page.locator("#stage [data-text-node-id]").count(), 0);
  assert.deepEqual(f.errors, []);
});

test("a changed design path or malformed input cannot apply a previously reviewed import", async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.choose();
  // Programmatic path changes do not emit change; operation scope must still catch them.
  await f.page.evaluate(() => {
    document.querySelector("#document-path").value = "designs/other.codesign.json";
  });
  await f.page.locator("#figma-import-apply").click();
  await f.page.waitForFunction(
    () => document.querySelector("#figma-workflow-status").dataset.kind === "error",
  );
  assert.match(await f.page.locator("#figma-workflow-status").textContent(), /路径/);
  assert.equal(await f.page.locator("#stage [data-text-node-id]").count(), 0);
  await f.choose({ unexpected: "invalid document" });
  assert.equal(await f.page.locator("#figma-import-apply").isDisabled(), true);
  assert.equal(await f.page.locator("#stage [data-text-node-id]").count(), 0);
  assert.deepEqual(f.errors, []);
});

test("mobile menu opens conversion without overflow, and each plugin file can be downloaded", async (t) => {
  const f = await fixture(t, { mobile: true });
  await f.open();
  await f.choose();
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth), 390);
  await f.page.locator("#figma-workflow-dialog summary").click();
  await f.page.locator("#figma-plugin-id").fill("1234567890123456789");
  for (const file of ["manifest.json", "code.js", "ui.html"]) {
    const result = await f.download(`[data-plugin-file="${file}"]`);
    assert.equal(result.name, file);
    assert.ok(result.text.length > 20);
  }
  const manifest = JSON.parse((await f.download('[data-plugin-file="manifest.json"]')).text);
  assert.equal(manifest.editorType[0], "figma");
  assert.equal(manifest.id, "1234567890123456789");
  assert.deepEqual(f.errors, []);
});

test("the canvas comment tool records a persistent anchored discussion without requiring an Agent", async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.choose();
  await f.page.locator("#figma-import-apply").click();
  await f.page.waitForFunction(() =>
    document.querySelector("#figma-workflow-status").textContent.includes("已导入"),
  );
  await f.page.locator("#figma-workflow-close").click();
  await f.page.locator('[data-tool="comment"]').click();
  await f.page.locator('[data-text-node-id="figma-1-2"]').click();
  await f.page.locator("#element-comment-request").fill("标题在手机上需要更明显");
  assert.equal(await f.page.locator("#submit-element-comment").isDisabled(), true);
  await f.page.locator("#save-review-comment").click();
  await f.page.waitForFunction(() => !document.querySelector("#review-comments-submit").disabled);
  assert.match(await f.page.locator("#review-comments-target").textContent(), /figma-1-2/);
  await f.page.locator("#review-comments-submit").click();
  await f.page.waitForFunction(
    () => document.querySelector("#review-comments-status").dataset.kind === "saved",
  );
  const saved = await f.page.evaluate(() =>
    JSON.parse(localStorage.getItem("codeshell-design-studio:file:designs/design.comments.json")),
  );
  assert.equal(saved.threads[0].nodeId, "figma-1-2");
  assert.equal(saved.threads[0].text, "标题在手机上需要更明显");
  await f.page.locator("[data-resolve-thread]").click();
  await f.page.waitForFunction(() =>
    document.querySelector("#review-comments-list").textContent.includes("当前筛选没有讨论"),
  );
  await f.page.locator("#review-comments-filter").selectOption("resolved");
  assert.match(await f.page.locator(".review-comment-text").textContent(), /手机/);
  assert.deepEqual(f.errors, []);
});
