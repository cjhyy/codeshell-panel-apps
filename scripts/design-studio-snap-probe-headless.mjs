/* Bounded offline headless-Chromium run of the snap-grid probe.
 *
 *   node scripts/design-studio-snap-probe-headless.mjs --mode emulated-dsf2|forced-dsf2 --out /tmp/<new-dir>
 *
 * emulated-dsf2: Playwright context deviceScaleFactor 2 (DevTools emulation).
 * forced-dsf2:   --force-device-scale-factor=2 launch switch, no viewport/DSF emulation.
 * Serves only this checkout's apps/design-studio/app files on a private origin; every other request
 * is aborted. Ephemeral browser profile (no user profile). Outputs are create-only in a new
 * directory outside the repository. The whole run is bounded by a timeout.
 */
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { SNAP_CAMERAS, SNAP_PROBE_SIZE, analyzeSnapCapture, inferLayoutQuantum, snapProbeCollectSource, snapProbeDocument,
  snapProbeMountSource, snapProbeUnmountSource } from "./design-studio-snap-probe.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = join(repository, "apps/design-studio/app");
const args = process.argv.slice(2), arg = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const mode = arg("--mode"), out = arg("--out");
if (!["emulated-dsf2", "forced-dsf2"].includes(mode) || !out) throw new Error("usage: --mode emulated-dsf2|forced-dsf2 --out <new directory outside the repository>");
const realParent = await realpath(dirname(resolve(out)));
if (realParent === repository || realParent.startsWith(repository + sep)) throw new Error("output must be outside the repository");
const outDir = join(realParent, resolve(out).split(sep).pop());
await mkdir(outDir, { mode: 0o700 }); // non-recursive: refuses an existing directory
const write = (name, bytes) => writeFile(join(outDir, name), bytes, { flag: "wx", mode: 0o600 });

const codec = await import(join(appRoot, "document.mjs"));
const logicalSource = codec.serializeDesignDocument(codec.normalizeDesignDocument(snapProbeDocument()));
const timeout = 120_000;
const browser = await chromium.launch({ headless: true, timeout,
  args: mode === "forced-dsf2" ? ["--force-device-scale-factor=2", `--window-size=${1024},${720}`] : [] });
const watchdog = setTimeout(() => { browser.close().catch(() => {}); }, timeout);
const blocked = [];
try {
  const context = await browser.newContext(mode === "emulated-dsf2" ? { viewport: { width: 1024, height: 720 }, deviceScaleFactor: 2 } : { viewport: null });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.host !== "snap-probe.local") { blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/probe.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8><body style='margin:0'>" });
    const file = resolve(appRoot, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(appRoot + sep)) return route.abort();
    return route.fulfill({ body: await readFile(file),
      contentType: { ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" }[extname(file)] ?? "application/octet-stream" });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto("http://snap-probe.local/probe.html");
  const collect = await page.evaluate(source => (0, eval)(source), snapProbeCollectSource({ logicalSource, moduleBase: "/" }));
  const captures = [];
  for (const camera of SNAP_CAMERAS) {
    const mount = await page.evaluate(source => (0, eval)(source), snapProbeMountSource({ markup: collect.markup, camera, size: SNAP_PROBE_SIZE }));
    const png = await page.screenshot({ type: "png", clip: { x: mount.host.x, y: mount.host.y, width: mount.host.width, height: mount.host.height } });
    await page.evaluate(source => (0, eval)(source), snapProbeUnmountSource());
    await write(`snap-${camera.label}.png`, png);
    const image = PNG.sync.read(png);
    const dpr = image.width / mount.host.width;
    captures.push({ camera, dpr, png: { width: image.width, height: image.height }, mount, rows: analyzeSnapCapture({ image, camera, dpr, collect, mount }) });
  }
  const result = { environment: { mode, chromium: browser.version(), ...collect.env }, blocked,
    layout: { plain: inferLayoutQuantum(collect.layout.plain.map(v => ({ requested: v.requested, measured: v.left }))),
      scaled: inferLayoutQuantum(collect.layout.scaled.map(v => ({ requested: v.requested * 2, measured: v.left }))), raw: collect.layout },
    fonts: collect.fonts, inter: collect.inter, gpu: collect.gpu, captures };
  await write("snap-probe.json", `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ outDir, mode, chromium: result.environment.chromium, devicePixelRatio: result.environment.devicePixelRatio, blocked: blocked.length }));
} finally { clearTimeout(watchdog); await browser.close().catch(() => {}); }
