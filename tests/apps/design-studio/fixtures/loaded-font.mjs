import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PNG } from "pngjs";

/** Wait for the fixture's actual face after fresh markup or direct typography edits. */
export async function settleLoadedFont(page, family = "Inter") {
  return page.evaluate(async (family) => {
    const requests = new Map();
    for (const element of document.querySelectorAll("body *")) {
      if (![...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent)) continue;
      const style = getComputedStyle(element);
      if (!style.fontFamily.split(",").some((name) => name.trim().replace(/^["']|["']$/gu, "") === family)) continue;
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${JSON.stringify(family)}`;
      requests.set(font, `${requests.get(font) ?? ""}${element.textContent}`);
    }
    if (!requests.size) throw new Error(`No rendered ${family} fixture text was found`);
    const loaded = [];
    for (const [font, text] of requests) {
      const faces = await document.fonts.load(font, text);
      if (!faces.length || faces.some((face) => face.status !== "loaded")) {
        throw new Error(`Fixture font did not load: ${font}`);
      }
      loaded.push({ font, faces: faces.map((face) => ({ family: face.family, status: face.status })) });
    }
    await document.fonts.ready;
    // FontFaceSet.ready can predate the style/layout work following a DOM edit.
    // Read current geometry, then let both the layout and its paint commit.
    document.body.getBoundingClientRect();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return loaded;
  }, family);
}

/** Retain exact failed pixels and font/layout state without changing acceptance. */
export async function recordFontPixelMismatch(page, referencePage, actualBytes, expectedBytes, label) {
  const actual = PNG.sync.read(actualBytes), expected = PNG.sync.read(expectedBytes);
  if (actual.width === expected.width && actual.height === expected.height && actual.data.equals(expected.data)) return;
  let pixels = 0, maxDelta = 0, left = Infinity, top = Infinity, right = -1, bottom = -1;
  if (actual.width === expected.width && actual.height === expected.height) {
    for (let index = 0; index < actual.data.length; index += 4) {
      let changed = false;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(actual.data[index + channel] - expected.data[index + channel]);
        maxDelta = Math.max(maxDelta, delta); changed ||= delta !== 0;
      }
      if (!changed) continue;
      pixels++;
      const x = index / 4 % actual.width, y = Math.floor(index / 4 / actual.width);
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  const state = (target) => target.evaluate(() => ({
    fontStatus: document.fonts.status,
    faces: [...document.fonts].slice(0, 64).map((face) => ({ family: face.family, status: face.status, weight: face.weight, style: face.style })),
    text: [...document.querySelectorAll("body *")]
      .filter((element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent))
      .slice(0, 100).map((element) => {
        const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
        return { text: element.textContent.slice(0, 120), font: style.font, family: style.fontFamily,
          lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      }),
  }));
  const directory = resolve("artifacts/design-studio-ci/font-pixels", `${label.replace(/[^a-zA-Z0-9.-]+/gu, "-").slice(0, 100)}-${Date.now()}-${process.pid}`);
  await mkdir(directory, { recursive: true });
  const report = { label, actualSize: [actual.width, actual.height], expectedSize: [expected.width, expected.height],
    pixelsDifferent: pixels, maximumChannelDelta: maxDelta,
    differenceBounds: pixels ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : null,
    actual: await state(page), expected: await state(referencePage), directory };
  for (const [name, value] of [["actual.png", actualBytes], ["reference.png", expectedBytes],
    ["actual.html", await page.content()], ["reference.html", await referencePage.content()],
    ["report.json", JSON.stringify(report, null, 2) + "\n"]]) {
    await writeFile(resolve(directory, name), value, { flag: "wx" });
  }
  console.log(`Font pixel mismatch: ${JSON.stringify(report)}`);
}
