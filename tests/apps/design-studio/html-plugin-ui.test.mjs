import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  htmlPluginHarness,
  frameFixture,
  textFixture,
  PNG,
} from "./fixtures/html-plugin-harness.mjs";
const ui = await readFile(
  new URL("../../../apps/design-studio/app/html-to-figma-plugin/ui.html", import.meta.url),
  "utf8",
);
async function fixture(t) {
  const harness = htmlPluginHarness();
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 820, height: 850 } });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [],
    network = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("nativeImport", async (message) =>
    harness.importDesign(message.designData, message.requestId),
  );
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://plugin.test") {
      network.push(url.href);
      return route.abort();
    }
    if (url.pathname === "/ui.html") return route.fulfill({ contentType: "text/html", body: ui });
    return route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><iframe id="plugin" src="/ui.html" sandbox="allow-scripts allow-downloads" style="width:780px;height:790px;border:0"></iframe><script>window.requests=[];addEventListener("message",async e=>{const m=e.data?.pluginMessage;if(m?.type!=="import-design")return;requests.push(m);const reply=await nativeImport(m);document.querySelector("iframe").contentWindow.postMessage({pluginMessage:reply},"*")});</script>',
    });
  });
  await page.goto("https://plugin.test/");
  const frame = page.frameLocator("#plugin");
  await frame.locator("#preview").waitFor();
  return { page, frame, harness, errors, network };
}

test("real opaque Figma UI iframe previews static HTML with the upstream converter and creates editable text through the upstream service", async (t) => {
  const f = await fixture(t);
  await f.frame
    .locator("#source")
    .fill(
      '<section style="width:380px;height:220px;background:#f1f5f9;padding:24px"><h1 style="font:24px Arial;color:#123456">Hello editable Figma</h1><p>Real browser measured text</p></section>',
    );
  await f.frame.locator("#preview").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  const status = await f.frame.locator("#status").textContent();
  assert.match(status, /预览完成/);
  assert.equal(await f.frame.locator("#create").isDisabled(), false);
  assert(
    (await f.frame.locator("#source").boundingBox()).width > 250,
    "preview iframe must not collapse source column",
  );
  assert.equal(
    await f.frame.locator("body").evaluate((node) => node.scrollWidth > innerWidth),
    false,
    "plugin UI fits Figma viewport",
  );
  await f.frame.locator("#create").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /已在 Figma 创建/);
  assert(
    f.harness.nodes.some(
      (n) => n.type === "TEXT" && n.characters?.includes("Hello editable Figma"),
    ),
  );
  assert.equal(f.harness.existing.removed, false);
  assert.deepEqual(f.network, []);
  assert.deepEqual(f.errors, []);
});

test("standalone HTML plugin uses retained CSS for native 100px gradients and layered alpha instead of the unit-losing upstream paint parse", async (t) => {
  const f = await fixture(t);
  await f.frame.locator("#selector").fill("main");
  await f.frame.locator("#source").fill(`<style>body{margin:0}main{display:flex;width:400px;height:240px;background:linear-gradient(#ddd,white 100px)}div{width:200px;height:100px;flex:none}.first{background:linear-gradient(90deg,rgba(255,0,0,.5),transparent) blue}.second{background:linear-gradient(to bottom right,#eee,#555)}</style><main><div class="first"></div><div class="second"></div></main>`);
  await f.frame.locator("#preview").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /预览完成/u);
  await f.frame.locator("#create").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /已在 Figma 创建/u);
  const imported = f.harness.page.selection[0];
  assert.equal(imported.layoutMode, "HORIZONTAL");
  assert.equal(imported.fills[0].type, "GRADIENT_LINEAR");
  assert.equal(imported.fills[0].gradientStops[1].position, 100 / 240);
  const layered = imported.children[0];
  assert.equal(layered.fills.length, 2);
  assert.equal(layered.fills[0].type, "SOLID");
  assert.equal(layered.fills[0].color.b, 1);
  assert.equal(layered.fills[1].gradientStops[0].color.a, 0.5);
  assert.equal(layered.fills[1].gradientStops[1].color.r, 1);
  assert.equal(layered.fills[1].gradientStops[1].color.a, 0);
  assert.equal(f.harness.images.length, 0);
  assert.equal(imported.children.some((node) => node.layoutPositioning === "ABSOLUTE"), false);
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.network, []);

  await f.frame.locator("#source").fill('<main style="width:400px;height:240px;background:radial-gradient(red,blue) #123456"></main>');
  await f.frame.locator("#preview").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /渐变未导入/u);
  await f.frame.locator("#create").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(f.harness.page.selection[0].fills.length, 1);
  assert.equal(f.harness.page.selection[0].fills[0].type, "SOLID");
});

test("standalone Grid capture keeps its compatible native Flex-row hierarchy and reports lost Grid semantics", async (t) => {
  const f = await fixture(t);
  await f.frame.locator("#selector").fill("#fixture");
  await f.frame.locator("#source").fill(`<!doctype html><style>*{box-sizing:border-box}body{margin:0}#fixture{display:grid;width:640px;height:240px;padding:20px;gap:12px;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:80px 80px}.tile{height:80px;background:blue}</style><main id="fixture">${'<div class="tile"></div>'.repeat(6)}</main>`);
  await f.frame.locator("#preview").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /Grid.*未保留/u);
  await f.frame.locator("#create").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /已在 Figma 创建/u);
  assert.match(await f.frame.locator("#status").textContent(), /Grid.*未保留/u);
  const imported = f.harness.page.selection[0];
  assert.equal(imported.layoutMode, "VERTICAL");
  assert.equal(imported.children.length, 2);
  for (const row of imported.children) {
    assert.equal(row.layoutMode, "HORIZONTAL");
    assert.equal(row.children.length, 3);
    assert.deepEqual(row.children.map((child) => child.width), [192, 192, 192]);
  }
  const requests = await f.page.evaluate(() => window.requests);
  assert.equal(requests[0].designData[0].codeshellGridFallback, true);
  assert.deepEqual(f.network, []);
  assert.deepEqual(f.errors, []);
});

test("HTML scripts, network resources, navigation and event handlers stay inert; editing invalidates preview", async (t) => {
  const f = await fixture(t);
  await f.frame
    .locator("#source")
    .fill(
      '<script>parent.postMessage({pwned:true},"*")</script><meta http-equiv="refresh" content="0;url=https://attacker.invalid/"><style>@import "https://attacker.invalid/x.css";p{background:url(https://attacker.invalid/x.png)}</style><img src="https://attacker.invalid/a.png" onerror="alert(1)"><p>Hello safe</p><iframe src="https://attacker.invalid"></iframe>',
    );
  await f.frame.locator("#preview").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /预览完成/);
  assert.deepEqual(f.network, []);
  const nested = f.frame.frameLocator("#preview-stage iframe");
  assert.equal(await nested.locator("iframe,meta[http-equiv=refresh]").count(), 0);
  assert.equal(
    await nested.locator("script").count(),
    1,
    "only reviewed nonce capture runtime is present",
  );
  assert.equal(
    await f.frame.locator("#preview-stage iframe").getAttribute("sandbox"),
    "allow-scripts",
  );
  assert.equal(await nested.locator("[onerror]").count(), 0);
  await f.frame.locator("#source").fill("<p>Changed</p>");
  assert.equal(await f.frame.locator("#create").isDisabled(), true);
  assert.deepEqual(f.errors, []);
});

test("native JSON file and local HTML folder preserve local CSS and inline image bytes without a server", async (t) => {
  const f = await fixture(t);
  await f.frame.locator("#source-file").setInputFiles({
    name: "fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(frameFixture([textFixture()]))),
  });
  await f.frame.locator("#preview").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /预览完成/);
  await f.frame.locator("#create").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(f.harness.page.selection[0].children[0].characters, "Editable title");
  const directory = await mkdtemp(join(tmpdir(), "codeshell-html-plugin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "index.html"),
    '<link rel="stylesheet" href="style.css"><div><img src="pixel.png" width="40" height="40"><p>Folder local CSS</p></div>',
  );
  await writeFile(
    join(directory, "style.css"),
    "body{margin:0}div{background:rgb(12,34,56);width:300px;height:160px;padding:20px}p{color:white}",
  );
  await writeFile(join(directory, "pixel.png"), Buffer.from(PNG, "base64"));
  await f.frame.locator("#folder").setInputFiles(directory);
  await f.frame.locator("#source").filter({ hasText: "" }).waitFor();
  await f.frame.locator("#source").evaluate(async (element) => {
    for (let i = 0; i < 100 && !element.value.includes("Folder local CSS"); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
  });
  await f.frame.locator("#preview").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /预览完成/);
  const localFrame = f.frame.frameLocator("#preview-stage iframe");
  assert.equal(
    await localFrame.locator("div").evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgb(12, 34, 56)",
  );
  await f.frame.locator("#create").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /已在 Figma 创建/);
  // Inline assets use the same bounded data URL path as selected local resources.
  await f.frame.locator("#mode").selectOption("html");
  await f.frame
    .locator("#source")
    .fill(
      `<div style="width:180px;height:100px"><img width="40" height="40" src="data:image/png;base64,${PNG}"><p>Local image</p></div>`,
    );
  await f.frame.locator("#preview").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /预览完成/);
  await f.frame.locator("#create").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /已在 Figma 创建/);
  assert(f.harness.images.length > 0);
  assert.deepEqual(f.network, []);
  assert.deepEqual(f.errors, []);
});

test("DesignNode JSON import uses the native upstream adapter and maps editable text", async (t) => {
  const f = await fixture(t);
  const designNode = {
    id: "design-text",
    name: "DSL title",
    nodeType: "text",
    tag: "#text",
    role: "text",
    bounds: { x: 10, y: 20, width: 180, height: 30 },
    visible: true,
    opacity: 1,
    positioning: { mode: "static" },
    content: "Native DesignNode",
    textStyle: {
      fontFamily: "Arial",
      fontSize: 20,
      fontWeight: 700,
      fontStyle: "normal",
      color: { r: 0.2, g: 0.3, b: 0.5, a: 1 },
      textAlign: "left",
      textDecoration: "none",
      textTransform: "none",
      lineHeight: { value: 28, unit: "px" },
      letterSpacing: { value: 0, unit: "px" },
    },
  };
  await f.frame.locator("#mode").selectOption("json");
  await f.frame.locator("#source").fill(JSON.stringify(designNode));
  await f.frame.locator("#preview").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /预览完成/);
  await f.frame.locator("#create").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.equal(f.harness.page.selection[0].type, "TEXT");
  assert.equal(f.harness.page.selection[0].characters, "Native DesignNode");
  assert.equal(f.harness.page.selection[0].fontName.style, "Bold");
  assert.deepEqual(f.errors, []);
});


test("standalone CSS border compatibility warnings survive preview and native JSON reimport", async (t) => {
  const f = await fixture(t);
  await f.frame.locator("#selector").fill("#fixture");
  await f.frame.locator("#source").fill('<main id="fixture" style="width:400px;height:240px;border-bottom:1px solid #cecece"></main>');
  await f.frame.locator("#preview").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /边框.*未保留/u);
  await f.frame.locator("#create").click();
  await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(), /边框.*未保留/u);
  const requests = await f.page.evaluate(() => window.requests);
  assert.equal(requests[0].designData[0].codeshellBorderFallback, true);
  const again = await f.harness.importDesign(requests[0].designData);
  assert.equal(again.type, "import-success");
  assert(again.warnings.some(w => /边框.*未保留/u.test(w)));
  assert.deepEqual(f.network, []);
  assert.deepEqual(f.errors, []);
});

test("standalone float-column compatibility loss survives preview and native JSON import", async (t) => {
  const f=await fixture(t);
  await f.frame.locator("#selector").fill("#fixture");
  await f.frame.locator("#source").fill('<style>#fixture{width:400px;height:240px;display:flow-root}section{float:left;width:66.6666667%;height:100px;background:blue}</style><main id="fixture"><section></section></main>');
  await f.frame.locator("#preview").click();await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(),/浮动列.*未保留/u);
  await f.frame.locator("#create").click();await f.frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await f.frame.locator("#status").textContent(),/浮动列.*未保留/u);
  const requests=await f.page.evaluate(()=>window.requests);assert.equal(requests[0].designData[0].codeshellFloatFallback,true);
  const again=await f.harness.importDesign(requests[0].designData);assert.equal(again.type,"import-success");assert(again.warnings.some(w=>/浮动列.*未保留/u.test(w)));
  assert.deepEqual(f.network,[]);assert.deepEqual(f.errors,[]);
});
