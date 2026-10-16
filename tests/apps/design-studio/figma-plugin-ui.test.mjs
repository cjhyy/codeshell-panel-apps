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

async function fixture(t, { nativeBridge = false } = {}) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 460, height: 780 },
  });
  const page = await context.newPage(),
    errors = [],
    networkAttempts = [];
  page.setDefaultTimeout(4000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      nativeBridge &&
      ["https://www.figma.com", "https://untrusted.test"].includes(url.origin) &&
      url.pathname === "/plugin-bridge.html"
    )
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><script>addEventListener('message',event=>parent.frames[0].postMessage(event.data,'*'));</script>`,
      });
    if (url.origin !== "https://plugin.test") {
      networkAttempts.push(route.request().url());
      return route.abort();
    }
    if (url.pathname === "/ui.html") return route.fulfill({ contentType: "text/html", body: ui });
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="margin:0"><iframe id="plugin" title="Figma plugin" src="/ui.html" sandbox="allow-scripts allow-downloads" style="width:420px;height:520px;border:0"></iframe>
      ${nativeBridge ? '<iframe id="native-bridge" title="Native Figma bridge" src="https://www.figma.com/plugin-bridge.html" sandbox="allow-scripts allow-same-origin" hidden></iframe><iframe id="untrusted-bridge" title="Untrusted bridge" src="https://untrusted.test/plugin-bridge.html" sandbox="allow-scripts allow-same-origin" hidden></iframe>' : ""}<script>
      window.requests=[];addEventListener('message',event=>{const message=event.data?.pluginMessage;if(message&&['import-transfer','export-json','preview-patch','apply-patch'].includes(message.type))requests.push(message)});
      window.reply=message=>document.querySelector('#plugin').contentWindow.postMessage({pluginMessage:message},'*');
      window.relayReply=(data,bridge)=>document.getElementById(bridge).contentWindow.postMessage(data,'*');
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
  const relayReply = async (data, bridge = "native-bridge") =>
    page.evaluate(({ data, bridge }) => window.relayReply(data, bridge), { data, bridge });
  const request = async (count) => {
    await page.waitForFunction((count) => window.requests.length >= count, count);
    return (await page.evaluate(() => window.requests)).at(-1);
  };
  return { page, frame, errors, networkAttempts, paste, reply, relayReply, request };
}

test("native Figma bridge replies work from a non-parent window while unrelated transports and envelopes are ignored", async (t) => {
  const f = await fixture(t, { nativeBridge: true });
  await f.frame.locator("body").evaluate(() => {
    window.receivedReplies = [];
    addEventListener("message", (event) => {
      window.receivedReplies.push({
        origin: event.origin,
        sourceIsParent: event.source === parent,
        sourceIsSelf: event.source === window,
        trusted: event.isTrusted,
      });
      document.body.dataset.bridgeReceived = String(window.receivedReplies.length);
    });
  });
  const content = JSON.stringify({
    format: "codeshell.figma.source",
    version: 1,
    nodes: { "0:1": { document: { id: "0:1", name: "Empty", type: "CANVAS", children: [] } } },
  });
  const exported = { type: "exported", content, filename: "native-page.json" };
  await f.frame.locator("#export-page").click();
  await f.request(1);

  const ignored = [
    { bridge: "untrusted-bridge", data: { pluginMessage: exported } },
    { data: exported },
    { data: { pluginMessage: null } },
    { data: { pluginMessage: [exported] } },
    { data: { pluginMessage: { type: ["exported"], content } } },
    { data: { pluginMessage: { type: "imported", pages: 1, nodes: 0, warnings: [] } } },
  ];
  for (const [index, item] of ignored.entries()) {
    await f.relayReply(item.data, item.bridge);
    await f.frame.locator(`body[data-bridge-received="${index + 1}"]`).waitFor();
    assert.equal(await f.frame.locator("body").getAttribute("aria-busy"), "true");
    assert.equal(await f.frame.locator("#export-json").inputValue(), "");
  }

  const downloadEvent = f.page.waitForEvent("download");
  await f.relayReply({ pluginMessage: exported });
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "native-page.json");
  assert.equal(await readFile(await download.path(), "utf8"), content);
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(await f.frame.locator("#export-json").inputValue(), content);
  assert.deepEqual(
    await f.frame.locator("body").evaluate(() => window.receivedReplies.at(-1)),
    { origin: "https://www.figma.com", sourceIsParent: false, sourceIsSelf: false, trusted: true },
    "the callback must be a genuine cross-window browser message, not a synthetic dispatch",
  );

  await f.paste(transfer(true));
  await f.frame.locator("#preview-patch").click();
  await f.request(2);
  await f.relayReply({
    pluginMessage: {
      type: "patch-preview",
      token: "native-review-token",
      operations: [],
      conflicts: [],
      deletions: 0,
      identity: { message: "Verified native preview" },
    },
  });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(await f.frame.locator("#apply-patch").isDisabled(), false);
  await f.frame.locator("#apply-patch").click();
  assert.equal((await f.request(3)).token, "native-review-token");
  await f.relayReply({ pluginMessage: { type: "error", message: "Native preflight rejected" } });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /Native preflight rejected/);
  assert.equal(await f.frame.locator("#apply-patch").isDisabled(), true);
  assert.deepEqual(f.errors, []);
});

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
  await f.frame.locator("#file").setInputFiles({
    name: "correct.json",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(JSON.stringify(transfer())),
  });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(await f.frame.locator("#import").isDisabled(), false);
  await f.frame.locator("#file").setInputFiles({
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

test("plugin file picker accepts ordinary v3 and sends all editable pages through the existing import protocol", async (t) => {
  const { plainFixture } = await import("./fixtures/figma-plugin-v3.mjs");
  const f = await fixture(t),
    document = plainFixture();
  await f.frame
    .locator("#file")
    .setInputFiles({
      name: "edited.codesign.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(document)),
    });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(await f.frame.locator("#import").isEnabled(), true);
  assert.equal(await f.frame.locator("#preview-patch").isEnabled(), false);
  assert.match(await f.frame.locator("#status").textContent(), /已验证 2 页、3 个图层/u);
  await f.frame.locator("#import").click();
  const request = await f.request(1),
    transfer = JSON.parse(request.content);
  assert.equal(request.type, "import-transfer");
  assert.equal(transfer.format, "codeshell.figma.transfer");
  assert.equal(transfer.pages[0].children[0].children[0].text, "Direct v3");
  assert.equal(transfer.pages.length, 2);
  await f.reply({ type: "imported", pages: 2, nodes: 3, warnings: [] });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /2 个页面、3 个可编辑图层/u);
  assert.deepEqual(f.errors, []);
});

test("complete-file paste verifies attached metadata and inline image/font bytes before import, with explicit restoration limits", async (t) => {
  const { portableFixture, pixel } = await import("./fixtures/figma-plugin-v3.mjs");
  const f = await fixture(t),
    portable = await portableFixture();
  await f.paste(portable);
  assert.equal(await f.frame.locator("#import").isEnabled(), true);
  assert.match(await f.frame.locator("#status").textContent(), /不能安装字体/u);
  assert.match(await f.frame.locator("#status").textContent(), /不导入 Figma 云评论/u);
  await f.frame.locator("#import").click();
  const request = await f.request(1),
    transfer = JSON.parse(request.content);
  assert.equal(transfer.assets.photo.base64, pixel);
  assert.equal(transfer.patch, undefined);
  await f.reply({ type: "imported", pages: 2, nodes: 4, warnings: [] });
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /不能安装字体/u);
  assert.match(await f.frame.locator("#status").textContent(), /不导入 Figma 云评论/u);
  assert.deepEqual(f.networkAttempts, []);
  assert.deepEqual(f.errors, []);
});

test("corrupt complete-file attachments and referenced-only v3 cannot enable import or emit creation commands", async (t) => {
  const { portableFixture } = await import("./fixtures/figma-plugin-v3.mjs");
  const f = await fixture(t),
    portable = await portableFixture();
  portable.attachments[0].sha256 = "0".repeat(64);
  await f.paste(portable);
  assert.equal(await f.frame.locator("#import").isDisabled(), true);
  assert.match(await f.frame.locator("#status").textContent(), /校验失败/u);
  await f.paste(portable.document);
  assert.equal(await f.frame.locator("#import").isDisabled(), true);
  assert.match(await f.frame.locator("#status").textContent(), /普通 v3.*完整设计文件/u);
  assert.deepEqual(await f.page.evaluate(() => window.requests), []);
  assert.deepEqual(f.errors, []);
});

test("late full-file hashing after a programmatic file switch cannot replace the new v3 selection", async (t) => {
  const { portableFixture, plainFixture } = await import("./fixtures/figma-plugin-v3.mjs");
  const f = await fixture(t),
    portable = await portableFixture();
  const frame = f.page.frames().find((frame) => frame.url().endsWith("/ui.html"));
  await frame.evaluate(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle);
    window.releaseDigest = null;
    crypto.subtle.digest = async (...args) => {
      await new Promise((resolve) => {
        window.releaseDigest = resolve;
      });
      return original(...args);
    };
  });
  await f.frame.locator("#paste-transfer-details summary").click();
  await f.frame.locator("#paste-json").fill(JSON.stringify(portable));
  await f.frame.locator("#load-pasted-json").click();
  await frame.waitForFunction(() => typeof window.releaseDigest === "function");
  // The browser picker is disabled while validation is busy. A host replacement
  // can still invalidate the generation; no stale async result may become active.
  await frame.evaluate(() => {
    document.querySelector("#file").dispatchEvent(new Event("change"));
  });
  await frame.evaluate(() => window.releaseDigest());
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(await f.frame.locator("#import").isDisabled(), true);
  const next = plainFixture();
  next.name = "New selection";
  await f.paste(next);
  await f.frame.locator("#import").click();
  assert.equal(JSON.parse((await f.request(1)).content).name, "New selection");
  assert.deepEqual(f.errors, []);
});

test("complete-file inline SVG images are rasterized locally without project-path or external network reads", async (t) => {
  const { portableFixture } = await import("./fixtures/figma-plugin-v3.mjs");
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="12"><rect width="20" height="12" fill="#2563eb"/></svg>';
  const f = await fixture(t),
    portable = await portableFixture({
      imageMime: "image/svg+xml",
      imageBase64: Buffer.from(svg).toString("base64"),
    });
  await f.paste(portable);
  await f.frame.locator("#import").click();
  const request = await f.request(1),
    transfer = JSON.parse(request.content);
  assert.equal(transfer.assets.photo.mime, "image/png");
  assert(
    Buffer.from(transfer.assets.photo.base64, "base64")
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  );
  assert.deepEqual(f.networkAttempts, []);
  assert.deepEqual(f.errors, []);
});
