// Fixture-only evidence and explicit comparison raster mode; no production changes,
// document/PNG rewriting, or relaxed acceptance thresholds.
export function fontComparisonRasterMode() {
  const mode = process.env.DESIGN_STUDIO_FONT_RASTER_MODE ?? "grayscale";
  if (!["grayscale", "browser-default"].includes(mode)) throw Error(`Unknown fixture raster mode: ${mode}`);
  return mode;
}

export function fontComparisonRasterArgs(mode = fontComparisonRasterMode()) {
  if (!["grayscale", "browser-default"].includes(mode)) throw Error(`Unknown fixture raster mode: ${mode}`);
  // An RGBA glyph texture carries one coverage value, not LCD's independent RGB coverages.
  // Use the same explicit grayscale contract for these Canvas/DOM comparisons on every OS.
  // browser-default remains a raw diagnostic/replay mode; its LCD parity is not certified.
  return mode === "grayscale" ? ["--disable-lcd-text"] : [];
}

export async function fontRasterObservation(page, selector) {
  const browser = page.context().browser();
  const observation = await page.evaluate(selector => {
    const roots = [...document.querySelectorAll(selector)];
    if (!roots.length) throw Error(`Missing font observation root: ${selector}`);
    const elements = [...new Set(roots.flatMap(root => [root, ...root.querySelectorAll("*")]))].filter(element =>
      !["STYLE", "SCRIPT"].includes(element.tagName) &&
      [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()));
    const aliases = [...document.fonts].filter(face => face.family.startsWith("ck-font-")).map(face => face.family);
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    const measure = (font, text) => {
      ctx.font = font; ctx.fontKerning = "normal"; ctx.letterSpacing = "0px"; ctx.textBaseline = "alphabetic";
      const result = ctx.measureText(text);
      return { font: ctx.font, width: result.width, left: result.actualBoundingBoxLeft, right: result.actualBoundingBoxRight,
        ascent: result.fontBoundingBoxAscent, descent: result.fontBoundingBoxDescent,
        inkAscent: result.actualBoundingBoxAscent, inkDescent: result.actualBoundingBoxDescent };
    };
    return { dpr: devicePixelRatio, userAgent: navigator.userAgent,
      faces: [...document.fonts].map(face => ({ family: face.family, weight: face.weight, style: face.style, status: face.status })),
      elements: elements.map(element => {
        const style = getComputedStyle(element), range = document.createRange(); range.selectNodeContents(element);
        const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        return { text: element.textContent, css: { font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
          fontKerning: style.fontKerning, fontOpticalSizing: style.fontOpticalSizing, fontFeatureSettings: style.fontFeatureSettings,
          textRendering: style.textRendering, transform: style.transform }, range: range.getBoundingClientRect().toJSON(),
          requested: measure(font, element.textContent), aliases: aliases.map(alias => ({ alias,
            metrics: measure(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} "${alias}"`, element.textContent) })) };
      }) };
  }, selector);
  observation.platformFonts = await platformFontObservation(page, selector);
  return { platform: process.platform, browserVersion: browser.version(), ...observation };
}

export async function platformFontObservation(page, selector) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("DOM.enable"); await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeIds } = await session.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
    if (!nodeIds.length) throw Error(`Missing platform font observation node: ${selector}`);
    const results = await Promise.all(nodeIds.map(nodeId => session.send("CSS.getPlatformFontsForNode", { nodeId })));
    const fonts = new Map();
    for (const font of results.flatMap(result => result.fonts)) {
      const key = JSON.stringify([font.familyName, font.postScriptName, font.isCustomFont]);
      const previous = fonts.get(key);
      fonts.set(key, { ...font, glyphCount: font.glyphCount + (previous?.glyphCount ?? 0) });
    }
    return [...fonts.values()];
  } finally { await session.detach(); }
}

export async function localFontObservation(page) {
  return page.evaluate(async () => {
    const load = async name => {
      try { return (await new FontFace("LocalFontAvailabilityProof", `local("${name}")`).load()).status === "loaded"; }
      catch { return false; }
    };
    const available = await load("PingFangSC-Regular");
    return { family: "PingFang SC", localFace: "PingFangSC-Regular", available,
      status: available ? "available" : "unavailable", certification: available ? "pending-probes" : "not-certified",
      missingFaceNegativeControl: await load("CodeShellIntentionallyMissingFont-792bfd0631") };
  });
}

export async function cjkFontObservation(page, fontFamily) {
  const text = "仓库地址中文汉国", selector = "#cjk-font-coverage-proof";
  await page.evaluate(({ text, fontFamily }) => {
    const probe = document.createElement("span"); probe.id = "cjk-font-coverage-proof"; probe.textContent = text;
    probe.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;font:400 13px ${fontFamily};white-space:pre`;
    document.body.append(probe);
  }, { text, fontFamily });
  try {
    // CDP reports fonts used by painted glyphs. An offscreen node can legitimately return no fonts.
    await page.screenshot();
    return { text, fontFamily, platformFonts: await platformFontObservation(page, selector) };
  }
  finally { await page.evaluate(selector => document.querySelector(selector).remove(), selector); }
}

export function assertCjkCoverage(observation) {
  const actual = observation.platformFonts;
  // Playwright's pinned Linux dependencies include WenQuanYi. Noto CJK is also
  // a verified system CJK family, but fontconfig may legitimately prefer WQY.
  // Keep exact family/PostScript pairs: an unknown/tofu face cannot count as coverage.
  const knownCjk = font => !font.isCustomFont && (
    font.familyName === "WenQuanYi Zen Hei" && font.postScriptName === "WenQuanYiZenHei" ||
    /^Noto Sans CJK (?:SC|TC|JP|KR|HK)$/u.test(font.familyName) && /^NotoSansCJK(?:sc|tc|jp|kr|hk)-(?:Regular|Medium|Bold)$/u.test(font.postScriptName));
  if (process.platform === "linux" && !actual.some(font => knownCjk(font) && font.glyphCount === observation.text.length))
    throw Error(`Expected a verified installed CJK face to cover every Chinese probe glyph: ${JSON.stringify(observation)}`);
  if (actual.reduce((sum, font) => sum + font.glyphCount, 0) !== observation.text.length)
    throw Error(`Chinese font observation did not cover all glyphs: ${JSON.stringify(observation)}`);
}

export function neutralTextColorObservation(image) {
  let nonNeutralPixels = 0, maximumRgbSpread = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const spread = Math.max(...image.data.subarray(offset, offset + 3)) - Math.min(...image.data.subarray(offset, offset + 3));
    if (spread) nonNeutralPixels++;
    maximumRgbSpread = Math.max(maximumRgbSpread, spread);
  }
  return { nonNeutralPixels, maximumRgbSpread };
}
