import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createHtmlAssetResolver } from "../../../apps/design-studio/app/html-import-assets.mjs";
import { normalizeFigmaAsset } from "../../../apps/design-studio/app/figma-assets.mjs";
import { imageMimeFromBytes } from "../../../apps/design-studio/app/image-mime.mjs";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { htmlPluginHarness } from "./fixtures/html-plugin-harness.mjs";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const gif = "R0lGODlhAQABAIAAAOAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="#345678" d="M0 0h8v8H0z"/></svg>';
const data = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const signatures = [
  ["image/png", Buffer.from(png, "base64")],
  ["image/jpeg", Uint8Array.of(255, 216, 255, 219)],
  ["image/gif", Buffer.from(gif, "base64")],
  ["image/webp", Buffer.from("RIFF0000WEBP")],
  ["image/svg+xml", Buffer.from(svg)],
];

test("HTML image MIME follows supported byte signatures while native validation remains strict", async () => {
  for (const [mime, bytes] of signatures) {
    assert.equal(imageMimeFromBytes(bytes), mime);
    const base64 = Buffer.from(bytes).toString("base64");
    const resolver = createHtmlAssetResolver({ readAsset: async () => ({ base64, mime: "text/plain" }) });
    const result = await resolver.resolve(`images/misleading.${mime === "image/svg+xml" ? "svg" : "png"}`, "source.html");
    assert.equal(result, data(mime, bytes));
    assert.deepEqual(normalizeFigmaAsset(result).bytes, new Uint8Array(bytes));
    assert.equal(await resolver.resolve(`data:${mime === "image/svg+xml" ? mime : "image/png"};base64,${base64}`, "source.html"), result);
    await assert.rejects(resolver.resolve(`data:${mime === "image/svg+xml" ? "image/png" : "image/svg+xml"};base64,${base64}`, "source.html"), /SVG 类型声明/u);
    assert.deepEqual(resolver.dataUrls(), [result], "corrected labels deduplicate the same bytes");
    if (mime !== "image/png") assert.throws(() => normalizeFigmaAsset({ mime: "image/png", base64 }), /MIME/u);
  }
  let reads = 0;
  const resolver = createHtmlAssetResolver({ readAsset: async () => { reads++; return { base64: png }; } });
  await resolver.resolve("a.png", "source.html");
  assert.equal(await resolver.css('div{background:url("a.png")}', "source.html"), `div{background:url("data:image/png;base64,${png}")}`);
  await resolver.resolve("a.png#fragment", "source.html");
  assert.equal(reads, 1, "selected path cache remains bounded");
  await assert.rejects(resolver.resolve("a.bin", "source.html"), /受支持/u);
  assert.equal(await resolver.resolve("https://example.test/a.png", "source.html"), null);
  assert.equal(reads, 2, "outside paths never reach selected file reads");
});

test("unknown/short image signatures fail and existing font and decoded-byte budgets stay bounded", async () => {
  for (const bytes of [Buffer.from("plain text"), Uint8Array.of(255, 216), Buffer.from([137, 80, 78, 71]), Buffer.from("RIFF")]) {
    assert.equal(imageMimeFromBytes(bytes), null);
    await assert.rejects(createHtmlAssetResolver().resolve(data("image/png", bytes)), /图片字节/u);
  }
  for (const invalid of ["data:image/png;base64,AAAA!===", "data:image/avif;base64,AAAA", "data:image/png;base64,"])
    await assert.rejects(createHtmlAssetResolver().resolve(invalid), /受支持/u);
  const font = "data:font/woff2;base64,AQIDBA==";
  assert.equal(await createHtmlAssetResolver().resolve(font), font, "font validation stays on its existing path");
  const large = Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64");
  await assert.rejects(createHtmlAssetResolver().resolve(`data:font/woff2;base64,${large}`), /8 MiB/u);
  const six = Buffer.alloc(6 * 1024 * 1024, 2).toString("base64");
  const resolver = createHtmlAssetResolver({ readAsset: async () => ({ base64: six }) });
  const first = `data:font/woff2;base64,${Buffer.alloc(7 * 1024 * 1024, 1).toString("base64")}`;
  await resolver.resolve(first);
  await resolver.resolve(first);
  const overBudget = `data:font/woff2;base64,${six}`;
  await assert.rejects(resolver.resolve(overBudget), /12 MiB/u);
  await assert.rejects(resolver.resolve(overBudget), /12 MiB/u, "a failed resource never enters the accepted dedup set");
  await assert.rejects(resolver.resolve("another.woff2", "source.html"), /12 MiB/u, "another selected path cannot alias a rejected resource");
  const inlineSvg = await createHtmlAssetResolver().resolve(`data:image/svg+xml,${encodeURIComponent(svg)}`);
  assert.equal(inlineSvg, data("image/svg+xml", svg));
});

async function generatedImages(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 8;
      const context = canvas.getContext("2d");
      context.fillStyle = "#345678"; context.fillRect(0, 0, 8, 8);
      context.fillStyle = "#abcdef"; context.fillRect(0, 0, 4, 4);
      return Object.fromEntries(["png", "jpeg", "webp"].map((mime) => [mime, canvas.toDataURL(`image/${mime}`)]));
    });
  } finally { await page.close(); }
}

test("actual production HTML retains decoded image bytes across filename mismatch, resize, portable transfer and reopen", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-asset-mime-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const launch = chromium.launch.bind(chromium);
  chromium.launch = (options = {}) => launch({ ...options, args: [...(options.args ?? []), "--disable-gpu"] });
  t.after(() => { chromium.launch = launch; });
  const browser = await chromium.launch();
  const generated = await generatedImages(browser);
  const decoder = await browser.newPage();
  const kinds = { ...generated, gif: `data:image/gif;base64,${gif}`, svg: data("image/svg+xml", svg) };
  const matrix = await decoder.evaluate(async (kinds) => {
    const results = [];
    for (const [kind, source] of Object.entries(kinds)) for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]) {
      const image = new Image(); image.src = source.replace(/^data:[^;]+/u, `data:${mime}`);
      try { await image.decode(); results.push({ kind, mime, decoded: true }); }
      catch { results.push({ kind, mime, decoded: false }); }
    }
    return results;
  }, kinds);
  for (const item of matrix) assert.equal(item.decoded, (item.kind === "svg") === (item.mime === "image/svg+xml"), JSON.stringify(item));
  await browser.close();
  const controls = [
    ["jpeg-png", "avatar.png", generated.jpeg],
    ["png-jpeg", "avatar.jpeg", generated.png],
    ["webp-png", "avatar.png", generated.webp],
    ["gif-jpeg", "avatar.jpeg", `data:image/gif;base64,${gif}`],
    ["svg", "avatar.svg", data("image/svg+xml", svg)],
  ];
  const cases = [];
  for (const [id, name, url] of controls) {
    const directory = join(output, id); await mkdir(directory);
    await writeFile(join(directory, name), Buffer.from(url.split(",")[1], "base64"));
    await writeFile(join(directory, "source.html"), `<!doctype html><style>html,body{margin:0;background:white}main{display:flex;flex-direction:column;width:100%;height:120px}img{display:block;width:32px;height:32px}</style><main><img alt="Own generated image" src="${name}"></main>`);
    cases.push({ id, directory, rootSelector: "body" });
  }
  cases.push({ id: "data-label", source: `<!doctype html><style>html,body{margin:0;background:white}main{display:flex;flex-direction:column;width:100%;height:120px}img{display:block;width:32px;height:32px}</style><main id="fixture"><img src="${generated.jpeg.replace("image/jpeg", "image/png")}"></main>` });
  const result = await runProductionFidelity({ output: join(output, "result"), cases, width: 640, height: 120, narrowWidth: 400, resizeMode: "viewport-only" });
  assert.equal(result.passed, true, JSON.stringify(result.cases));
  assert.deepEqual(result.blockedRequests, []); assert.deepEqual(result.browserErrors, []);
  for (const observed of result.cases) {
    assert(observed.comparisons.every((item) => item.changedPixels === 0 && item.maximumChannelDelta === 0), observed.id);
    assert(!observed.warnings.some((warning) => warning.code === "invalid-image"), observed.id);
    const directory = join(output, "result", observed.id);
    const document = normalizeDesignDocument(JSON.parse(await readFile(join(directory, "imported.codesign.json"), "utf8")));
    const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
    assert.equal(reopened.resources.length, 1, observed.id);
    assert.equal(reopened.nodes.filter((node) => node.type === "image").length, 1);
    assert.equal(applyAllAutoLayouts(reopened.nodes), false);
    const portable = JSON.parse(await readFile(join(directory, "complete.portable.json"), "utf8"));
    const expected = controls.find(([id]) => id === observed.id)?.[2] ?? generated.jpeg;
    assert.equal(portable.resources.length, 1);
    assert.equal(portable.resources[0].base64, expected.split(",")[1], `${observed.id}: original bytes survive portable backup`);
    const transfer = JSON.parse(await readFile(join(directory, "figma-transfer.json"), "utf8"));
    assert.equal(Object.keys(transfer.assets).length, 1);
  }
});

test("standalone folder UI decodes misleading local image names without changing pixels; corrupt images stay a capture error", async (t) => {
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const generated = await generatedImages(browser), harness = htmlPluginHarness(), received = [];
  const createImage = harness.api.createImage;
  harness.api.createImage = (bytes) => { received.push(Buffer.from(bytes)); return createImage(bytes); };
  const context = await browser.newContext({ viewport: { width: 820, height: 850 } }), page = await context.newPage();
  page.setDefaultTimeout(10000);
  const root = fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url));
  const errors = [], external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.exposeFunction("nativeImport", (message) => harness.importDesign(message.designData, message.requestId));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === "https://mime.test/ui.html") return route.fulfill({ contentType: "text/html", body: await readFile(join(root, "html-to-figma-plugin/ui.html")) });
    if (url.href === "https://mime.test/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><iframe id="plugin" src="/ui.html" sandbox="allow-scripts allow-downloads" style="width:780px;height:790px;border:0"></iframe><script>addEventListener("message",async e=>{const m=e.data?.pluginMessage;if(m?.type!=="import-design")return;const reply=await nativeImport(m);document.querySelector("iframe").contentWindow.postMessage({pluginMessage:reply},"*")});</script>' });
    if (url.origin === "https://mime.test" && url.pathname.startsWith("/app/") && url.pathname.endsWith(".mjs")) {
      const path = resolve(root, url.pathname.slice(5));
      if (path.startsWith(root)) return route.fulfill({ contentType: "text/javascript", body: await readFile(path) });
    }
    external.push(url.href); return route.abort();
  });
  await page.goto("https://mime.test/");
  const frame = page.frameLocator("#plugin"), directory = await mkdtemp(join(tmpdir(), "html-asset-mime-ui-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "source.html"), '<style>body{margin:0}main{display:flex;width:120px;height:120px}img{width:32px;height:32px}</style><main><img src="avatar.png"></main>');
  const jpeg = Buffer.from(generated.jpeg.split(",")[1], "base64");
  await writeFile(join(directory, "avatar.png"), jpeg);
  await frame.locator("#folder").setInputFiles(directory);
  await frame.locator("#source").evaluate(async (element) => { for (let attempt = 0; attempt < 100 && !element.value.includes("avatar.png"); attempt++) await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.match(await frame.locator("#source").inputValue(), /avatar\.png/u);
  await frame.locator("#preview").click(); await frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await frame.locator("#status").textContent(), /预览完成/u);
  const decoded = await frame.frameLocator("#preview-stage iframe").locator("img").evaluate((image) => ({ width: image.naturalWidth, src: image.src }));
  assert.equal(decoded.width, 8); assert.equal(decoded.src, generated.jpeg);
  await frame.locator("#create").click(); await frame.locator("body[aria-busy=false]").waitFor();
  assert.match(await frame.locator("#status").textContent(), /已在 Figma 创建/u);
  assert.equal(received.length, 1);
  // The pinned standalone converter already serializes decoded IMG pixels as PNG.
  // Its input retains original JPEG bytes; this change must not alter those pixels.
  const nativeImage = data(imageMimeFromBytes(received[0]), received[0]);
  const [originalPixels, convertedPixels] = await page.evaluate(async ({ original, converted }) => {
    async function pixels(source) {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, pixels: [...context.getImageData(0, 0, canvas.width, canvas.height).data] };
    }
    return [await pixels(original), await pixels(converted)];
  }, { original: generated.jpeg, converted: nativeImage });
  assert.deepEqual(convertedPixels, originalPixels);
  const corrupt = await page.evaluate(async () => {
    const { captureWorkspaceHtmlResult } = await import("/app/html-import.mjs");
    try { await captureWorkspaceHtmlResult({ sourcePath: "bad.html", html: '<main><img src="bad.png"></main>', readAsset: async () => ({ base64: "/9j/" }), readText: async () => "", viewportWidth: 120, viewportHeight: 120 }); return null; }
    catch (error) { return error.message; }
  });
  assert.match(corrupt, /无法解码/u, "signature recognition cannot bypass actual image decoding");
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
});
