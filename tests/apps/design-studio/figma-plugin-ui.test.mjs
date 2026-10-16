import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const ui = await readFile(
  new URL("../../../apps/design-studio/app/figma-plugin/ui.html", import.meta.url),
  "utf8",
);
const transfer = (patch) => ({
  format: "codeshell.figma.transfer",
  version: 1,
  name: "UI fixture",
  pages: [{ id: "home", name: "Home", children: [] }],
  assets: {},
  ...(patch ? { patch: { format: "codeshell.figma.patch", version: 1, operations: [] } } : {}),
});

async function fixture(t) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 460, height: 780 },
  });
  const page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(4000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://plugin.test") return route.abort();
    if (url.pathname === "/ui.html") return route.fulfill({ contentType: "text/html", body: ui });
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="margin:0"><iframe id="plugin" title="Figma plugin" src="/ui.html" sandbox="allow-scripts allow-downloads" style="width:420px;height:520px;border:0"></iframe><script>
      window.requests=[];addEventListener('message',event=>{const message=event.data?.pluginMessage;if(message&&['import-transfer','export-json','preview-patch','apply-patch'].includes(message.type))requests.push(message)});
      window.reply=message=>document.querySelector('#plugin').contentWindow.postMessage({pluginMessage:message},'*');
    </script></body></html>`,
    });
  });
  await page.goto("https://plugin.test/");
  const frame = page.frameLocator("#plugin");
  await frame.locator("#export-page").waitFor();
  const paste = async (value) => {
    if (!(await frame.locator("#paste-transfer-details").evaluate((node) => node.open)))
      await frame.locator("#paste-transfer-details summary").click();
    await frame
      .locator("#paste-json")
      .fill(typeof value === "string" ? value : JSON.stringify(value));
    await frame.locator("#load-pasted-json").click();
    await frame.locator("body[aria-busy=false]").waitFor();
  };
  const reply = async (value) => page.evaluate((value) => window.reply(value), value);
  const request = async (count) => {
    await page.waitForFunction((count) => window.requests.length >= count, count);
    return (await page.evaluate(() => window.requests)).at(-1);
  };
  return { page, frame, errors, paste, reply, request };
}

test("plugin accepts pasted transfer JSON through the same validation path and blocks duplicate work while busy", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.frame.locator("#file").getAttribute("accept"), ".json");
  await f.paste("<script>window.pluginPwned=1</script>");
  assert.match(await f.frame.locator("#status").textContent(), /JSON 无法解析/);
  assert.equal(await f.frame.locator("#import").isDisabled(), true);
  await f.paste({ format: "codeshell.figma.source", version: 1 });
  assert.match(await f.frame.locator("#status").textContent(), /传输包/);
  await f.paste(transfer());
  assert.equal(await f.frame.locator("#import").isDisabled(), false);
  assert.equal(await f.frame.locator("#preview-patch").isDisabled(), true);
  await f.frame.locator("#import").click();
  const request = await f.request(1);
  assert.equal(request.type, "import-transfer");
  assert.equal(JSON.parse(request.content).format, "codeshell.figma.transfer");
  for (const id of ["file", "paste-json", "load-pasted-json", "import", "export-page"])
    assert.equal(await f.frame.locator(`#${id}`).isDisabled(), true);
  await f.frame
    .locator("#export-page")
    .evaluate((button) => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await f.reply({ type: "exported", content: "{}", filename: "stale.json" });
  assert.equal(
    await f.frame.locator("#import").isDisabled(),
    true,
    "an unrelated reply must not unlock the pending import",
  );
  await f.reply({
    type: "imported",
    pages: 1,
    nodes: 0,
    warnings: ['<img id="injected" src=x onerror="window.pluginPwned=1">'],
  });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(await f.page.evaluate(() => window.requests.length), 1);
  assert.match(await f.frame.locator("#status").textContent(), /<img id=/);
  assert.equal(await f.frame.locator("#injected").count(), 0);
  assert.equal(await f.frame.locator("body").evaluate(() => window.pluginPwned), undefined);
  assert.deepEqual(f.errors, []);
});

test("pasted patches require preview and deletion confirmation, and changing pasted content invalidates old tokens", async (t) => {
  const f = await fixture(t);
  await f.paste(transfer(true));
  await f.frame.locator("#preview-patch").click();
  assert.equal((await f.request(1)).type, "preview-patch");
  const malicious = '<svg id="injected" onload="window.pluginPwned=1">';
  await f.reply({
    type: "patch-preview",
    token: "review-1",
    conflicts: [],
    deletions: 1,
    identity: { message: malicious },
    operations: [{ op: "delete", name: malicious, sourceId: "1:1", changed: [] }],
  });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(await f.frame.locator("#apply-patch").isDisabled(), true);
  assert.equal(await f.frame.locator("#delete-label").isVisible(), true);
  await f.frame.locator("#allow-deletes").check();
  await f.frame.locator("#apply-patch").click();
  assert.deepEqual(await f.request(2), {
    type: "apply-patch",
    token: "review-1",
    allowDeletes: true,
  });
  await f.reply({ type: "patched", operations: 1, warnings: [] });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(await f.frame.locator("#apply-patch").isDisabled(), true);
  await f.frame.locator("#preview-patch").click();
  await f.request(3);
  await f.reply({
    type: "patch-preview",
    token: "review-2",
    conflicts: [],
    deletions: 0,
    operations: [],
    identity: {},
  });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(await f.frame.locator("#apply-patch").isDisabled(), false);
  await f.frame.locator("#paste-json").fill(JSON.stringify(transfer()));
  assert.equal(await f.frame.locator("#apply-patch").isDisabled(), true);
  assert.equal(await f.frame.locator("#import").isDisabled(), true);
  await f.reply({
    type: "patch-preview",
    token: "stale-review",
    conflicts: [],
    deletions: 0,
    operations: [],
  });
  assert.equal(await f.frame.locator("#apply-patch").isDisabled(), true);
  assert.equal(await f.frame.locator("#injected").count(), 0);
  assert.deepEqual(f.errors, []);
});

test("pasted SVG assets become bounded PNG bytes and file input still validates actual JSON content", async (t) => {
  const f = await fixture(t),
    value = transfer();
  value.assets.photo = {
    mime: "image/svg+xml",
    base64: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>',
    ).toString("base64"),
  };
  await f.paste(value);
  await f.frame.locator("#import").click();
  const result = JSON.parse((await f.request(1)).content);
  assert.equal(result.assets.photo.mime, "image/png");
  assert.match(result.assets.photo.base64, /^iVBOR/);
  await f.reply({ type: "imported", pages: 1, nodes: 0, warnings: [] });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  await f.frame
    .locator("#file")
    .setInputFiles({
      name: "correct.json",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(JSON.stringify(transfer())),
    });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(await f.frame.locator("#import").isDisabled(), false);
  await f.frame
    .locator("#file")
    .setInputFiles({
      name: "wrong.json",
      mimeType: "application/json",
      buffer: Buffer.from("not JSON"),
    });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(await f.frame.locator("#import").isDisabled(), true);
  assert.match(await f.frame.locator("#status").textContent(), /无法解析/);
  assert.deepEqual(f.errors, []);
});

test("paste size checks use UTF-8 bytes and malformed converted assets never enable import", async (t) => {
  const f = await fixture(t);
  await f.frame.locator("#paste-transfer-details summary").click();
  await f.frame.locator("#paste-json").evaluate((node, value) => {
    node.value = JSON.stringify({ ...value, padding: "界".repeat(6 * 1024 * 1024) });
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }, transfer());
  await f.frame.locator("#load-pasted-json").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /16 MiB/);
  assert.equal(await f.frame.locator("#import").isDisabled(), true);
  await f.paste({
    ...transfer(),
    assets: { invalid: { mime: "image/svg+xml", base64: "<script>" } },
  });
  assert.match(await f.frame.locator("#status").textContent(), /Base64/);
  assert.equal(await f.frame.locator("#import").isDisabled(), true);
  await f.frame.locator("#export-page").click();
  await f.request(1);
  await f.reply({ type: "error", message: "Expected export failure" });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(
    await f.frame.locator("#import").isDisabled(),
    true,
    "a later busy transition cannot expose rejected content",
  );
  assert.deepEqual(f.errors, []);
});

test("export JSON can be viewed, copied and downloaded without executing JSON strings", async (t) => {
  const f = await fixture(t),
    payload = '</textarea><script>window.pluginPwned=1</script><img id="injected">';
  assert.equal(await f.frame.locator("#export-json-details").evaluate((node) => node.open), false);
  await f.frame.locator("#export-page").click();
  assert.equal((await f.request(1)).scope, "page");
  const content = JSON.stringify({
    format: "codeshell.figma.source",
    version: 1,
    name: payload,
    nodes: {},
  });
  const downloadEvent = f.page.waitForEvent("download");
  await f.reply({ type: "exported", content, filename: "figma-design.json" });
  const download = await downloadEvent;
  assert.equal(await readFile(await download.path(), "utf8"), content);
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(
    await f.frame.locator("#export-json-details").evaluate((node) => node.open),
    false,
    "large JSON stays collapsed by default",
  );
  await f.frame.locator("#export-json-details summary").click();
  assert.equal(await f.frame.locator("#export-json").inputValue(), content);
  await f.frame.locator("body").evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.copiedJson = text;
        },
      },
    }),
  );
  await f.frame.locator("#copy-export-json").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(await f.frame.locator("body").evaluate(() => window.copiedJson), content);
  const again = f.page.waitForEvent("download");
  await f.frame.locator("#download-export-json").click();
  assert.equal(await readFile(await (await again).path(), "utf8"), content);
  await f.frame.locator("body").evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw Error("denied");
    };
    document.execCommand = () => false;
  });
  await f.frame.locator("#copy-export-json").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /⌘\/Ctrl \+ C/);
  assert.equal(
    await f.frame
      .locator("#export-json")
      .evaluate((node) => node.selectionEnd - node.selectionStart),
    content.length,
  );
  assert.equal(await f.frame.locator("#injected").count(), 0);
  assert.equal(await f.frame.locator("body").evaluate(() => window.pluginPwned), undefined);
  assert.equal(
    await f.frame.locator("body").evaluate(() => document.documentElement.scrollWidth),
    420,
  );
  assert.deepEqual(f.errors, []);
});
