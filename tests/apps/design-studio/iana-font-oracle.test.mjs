// Run from candidate root: node --test tests/apps/design-studio/iana-font-oracle.test.mjs
// Public immutable fonts exercise the generic contract. IANA bytes remain external/ignored.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const appRoot = resolve('apps/design-studio/app');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtureText = 'IANA Public Technical Identifiers and ICANN';
const boldStart = fixtureText.indexOf('Public'), boldEnd = fixtureText.indexOf(' and');

async function context(t, gpu = false) {
  const browser = await chromium.launch({ headless: true, args: gpu ? process.platform === 'darwin' ? ['--use-angle=metal'] : ['--enable-webgl', '--enable-unsafe-swiftshader'] : ['--disable-gpu'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 500 }, deviceScaleFactor: 1 });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://font-oracle.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
    const path = resolve(appRoot, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(appRoot + sep)) return route.abort();
    return route.fulfill({ body: await readFile(path), contentType: { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.woff2': 'font/woff2' }[extname(path)] });
  });
  await page.goto('https://font-oracle.test/');
  return { page, browser };
}

async function rendererProbe(page, { file, family, text = fixtureText, start = boldStart, end = boldEnd, baseWeight = 400, useFontRef = true, paintRange = false, extraRanges = [], rangeOverrides, additionalFonts = [] }) {
  await page.addScriptTag({ url: '/canvas/vendor/canvaskit.js' });
  return page.evaluate(async ({ file, family, text, start, end, baseWeight, useFontRef, paintRange, extraRanges, rangeOverrides, additionalFonts }) => {
    const CK = await CanvasKitInit({ locateFile: name => '/canvas/vendor/' + name });
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 96; document.body.append(canvas);
    const surface = CK.MakeWebGLCanvasSurface(canvas);
    if (!surface) throw new Error('The native font oracle requires an actual CanvasKit WebGL surface; CPU substitution is not allowed.');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl'), debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const backend = { factory: 'MakeWebGLCanvasSurface', version: gl?.getParameter(gl.VERSION), renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) };
    const { createCanvasKitText } = await import('/canvas/canvaskit-text.mjs');
    const { textRangeSourceSignature } = await import('/text-ranges.mjs');
    const id = 'external-oracle-font';
    const descriptor = { id, kind: 'font', family, weight: 400, style: 'normal' };
    const bytes = new Uint8Array(await (await fetch('/fonts/' + file)).arrayBuffer());
    const resources = new Map([[id, { bytes, mimeType: file.endsWith('.ttf') ? 'font/ttf' : 'font/woff2', descriptor }]]);
    for (const font of additionalFonts) resources.set(font.id, { bytes: new Uint8Array(await (await fetch('/fonts/' + font.file)).arrayBuffer()),
      mimeType: 'font/ttf', descriptor: { id: font.id, kind: 'font', family: font.family, weight: 400, style: 'normal' } });
    const node = { id: 'oracle-copy', type: 'text', text, name: 'Variable mixed run', x: 0, y: 0, width: 900, height: 80,
      fontFamily: family, ...(useFontRef ? { fontRef: id } : {}), fontSize: 32, fontWeight: baseWeight, fontStyle: 'normal', lineHeight: 48, lineHeightUnit: 'pixels',
      fill: '#000000', opacity: 1, textAlign: 'left', textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges: [{ start, end, ...(rangeOverrides ?? (paintRange ? { fill: '#cc2200' } : { fontWeight: 700 })) }, ...extraRanges] } };
    const counters = { textLines: 0, rasterTextNodes: 0, nativeTextNodes: 0, gradientPaints: 0 }, warnings = [];
    const renderer = await createCanvasKitText({ CK, design: { nodes: [node], resources: [...resources.values()].map(resource => resource.descriptor) }, resources, document, fallbackFontUrls: new Map(), counters,
      unsupportedNode: (_node, code) => warnings.push(code), makePaint: () => { const paint = new CK.Paint(); paint.setColor(CK.Color(0, 0, 0, 1)); return paint; } });
    try {
      const shapes = [], images = [];
      const draw = value => {
        const target = surface.getCanvas(); target.clear(CK.WHITE);
        renderer.draw({ drawParagraph(paragraph, x, y) { shapes.push({ width: paragraph.getLongestLine(), height: paragraph.getHeight(),
          baseline: paragraph.getAlphabeticBaseline(), drawX: x, drawY: y, drawnBaseline: y + paragraph.getAlphabeticBaseline(),
          boldBounds: Array.from(paragraph.getGlyphInfoAt(start).graphemeLayoutBounds) });
          target.drawParagraph(paragraph, x, y); } }, value);
        surface.flush(); const image = surface.makeImageSnapshot();
        try { images.push(Array.from(image.encodeToBytes())); } finally { image.delete(); }
      };
      try {
        draw(node);
        const regular = structuredClone(node); for (const range of regular.textRanges.ranges) range.fontWeight = 400;
        draw(regular);
        return { accepted: true, shapes, images, backend, counters, warnings, stats: renderer.stats() };
      } catch (error) { return { accepted: false, code: error.code, message: error.message, backend, counters, warnings, stats: renderer.stats() }; }
    } finally { renderer.dispose(); surface.delete(); }
  }, { file, family, text, start, end, baseWeight, useFontRef, paintRange, extraRanges, rangeOverrides, additionalFonts });
}

async function recordRenderer(t, label, result) {
  const images = result.images?.map(bytes => Buffer.from(bytes)); delete result.images;
  result.pixels = images?.map(imageStats);
  if (process.env.CODESHELL_FONT_ORACLE_EVIDENCE_DIR) {
    const dir = resolve(process.env.CODESHELL_FONT_ORACLE_EVIDENCE_DIR, 'canvaskit-webgl'); await mkdir(dir, { recursive: true });
    for (const [index, image] of (images ?? []).entries()) await writeFile(resolve(dir, `${label}-${index}.png`), image, { flag: 'wx' });
    await writeFile(resolve(dir, `${label}.json`), JSON.stringify(result, null, 2), { flag: 'wx' });
  }
  t.diagnostic(JSON.stringify({ label, ...result })); return images;
}

test('external verified variable bytes support a 700 run without claiming builtin identity', async t => {
  const { page } = await context(t, true);
  const result = await rendererProbe(page, { file: 'Roboto-Variable.ttf', family: 'Oracle External Variable' });
  const images = await recordRenderer(t, 'public-base400-range700', result);
  assert.equal(result.accepted, true, 'generic supplied variable wght capability must admit the requested native run');
  assert.equal(result.counters.rasterTextNodes, 0);
  assert.equal(result.counters.nativeTextNodes, 2);
  assert.notEqual(result.shapes[0].width, result.shapes[1].width, '700 run must shape differently from its 400 control');
  assert.equal(pixelDelta(images[0], images[1]).equal, false, 'the real WebGL canvas must contain distinct variable glyphs');
});

test('external variable base 700 without fontRef remains native with an editable paint range', async t => {
  const { page } = await context(t, true);
  const result = await rendererProbe(page, { file: 'Roboto-Variable.ttf', family: 'Oracle External Variable', baseWeight: 700, useFontRef: false, paintRange: true });
  await recordRenderer(t, 'public-base700-no-ref', result);
  assert.equal(result.accepted, true, 'family-based variable resolution must admit base 700 without a fabricated fontRef');
  assert.equal(result.counters.rasterTextNodes, 0);
  assert.equal(result.counters.nativeTextNodes, 2);
});

test('a static 400 face does not acquire an invented variable 700 capability', async t => {
  const { page } = await context(t, true);
  const result = await rendererProbe(page, { file: 'fa-regular-400.woff2', family: 'Oracle Static Icons', text: '\uf004\uf004', start: 1, end: 2 });
  await recordRenderer(t, 'public-static-rejection', result);
  assert.equal(result.accepted, false);
  assert.equal(result.code, 'TEXT_RANGES_UNSUPPORTED');
});

/** Read fixture metadata independently of the implementation under test. */
function sfntAxes(bytes) {
  const count = bytes.readUInt16BE(4);
  for (let index = 0; index < count; index++) {
    const offset = 12 + index * 16;
    if (bytes.toString('ascii', offset, offset + 4) !== 'fvar') continue;
    const table = bytes.readUInt32BE(offset + 8), axisStart = table + bytes.readUInt16BE(table + 4);
    return Array.from({ length: bytes.readUInt16BE(table + 8) }, (_, axis) => {
      const base = axisStart + axis * bytes.readUInt16BE(table + 10);
      return { tag: bytes.toString('ascii', base, base + 4), min: bytes.readInt32BE(base + 4) / 65536,
        default: bytes.readInt32BE(base + 8) / 65536, max: bytes.readInt32BE(base + 12) / 65536 };
    });
  }
  return [];
}

/** Independent Unicode cmap oracle: no runtime capabilities/resolver code is used. */
function cmapGlyphs(bytes, scalar) {
  const count = bytes.readUInt16BE(4), tables = [];
  for (let index = 0; index < count; index++) {
    const entry = 12 + index * 16;
    if (bytes.toString('ascii', entry, entry + 4) !== 'cmap') continue;
    const cmap = bytes.readUInt32BE(entry + 8);
    for (let item = 0; item < bytes.readUInt16BE(cmap + 2); item++) {
      const record = cmap + 4 + item * 8, platform = bytes.readUInt16BE(record), encoding = bytes.readUInt16BE(record + 2);
      if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
      const base = cmap + bytes.readUInt32BE(record + 4), format = bytes.readUInt16BE(base); let glyph = 0;
      if (format === 12) {
        for (let group = 0; group < bytes.readUInt32BE(base + 12); group++) {
          const offset = base + 16 + group * 12, start = bytes.readUInt32BE(offset), end = bytes.readUInt32BE(offset + 4);
          if (scalar >= start && scalar <= end) { glyph = bytes.readUInt32BE(offset + 8) + scalar - start; break; }
        }
      } else if (format === 4 && scalar <= 0xffff) {
        const segments = bytes.readUInt16BE(base + 6) / 2, ends = base + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, offsets = deltas + segments * 2;
        for (let segment = 0; segment < segments; segment++) {
          const start = bytes.readUInt16BE(starts + segment * 2), end = bytes.readUInt16BE(ends + segment * 2);
          if (scalar < start || scalar > end) continue;
          const delta = bytes.readInt16BE(deltas + segment * 2), offsetPosition = offsets + segment * 2, offset = bytes.readUInt16BE(offsetPosition);
          glyph = offset ? bytes.readUInt16BE(offsetPosition + offset + (scalar - start) * 2) : (scalar + delta) & 0xffff;
          if (offset && glyph) glyph = (glyph + delta) & 0xffff;
          break;
        }
      } else continue;
      tables.push({ platform, encoding, format, glyph });
    }
  }
  assert(tables.length > 0, 'the frozen TTF must contain supported Unicode cmap records'); return tables;
}

const specimen = 'Sphinx office 0123 Example Domains';
const profileNames = ['narrow-400', 'url-default', 'wide-100-900', 'explicit-axis', 'narrow-axis'];
function oracleMarkup({ primary, secondary, profile, sourceLocal = false, staticGlyph = false }) {
  const source = sourceLocal ? 'local("Noto Sans"),local("NotoSans"),' : '';
  const faceWeight = profile === 'wide-100-900' || profile === 'explicit-axis' ? '100 900' : '400';
  const axis = weight => ['explicit-axis', 'narrow-axis'].includes(profile) ? `;font-variation-settings:'wght' ${weight}` : '';
  const copy = staticGlyph ? '\uf004\uf004\uf004' : specimen;
  const weights = [400, 500, 700].map(weight => `<p class="line" data-row="w${weight}"><span id="w${weight}" class="copy" style="font-weight:${weight}${axis(weight)}">${copy}</span><i class="baseline"></i></p>`);
  if (!staticGlyph) {
    weights.push(`<p class="line" data-row="mixed"><span id="mixed" class="copy" style="font-weight:400${axis(400)}"><span data-part="base">IANA </span><span data-part="bold" style="font-weight:700${axis(700)}">Public Technical Identifiers</span><span data-part="base"> and </span><span data-part="bold2" style="font-weight:700${axis(700)}">ICANN</span></span><i class="baseline"></i></p>`);
    weights.push(`<p class="line" data-row="cross-family"><span id="cross-family" class="copy" style="font-weight:400${axis(400)}"><span data-part="base">A number of domains </span><span data-part="mono" style="font-family:'Oracle Secondary'">example.com</span><span data-part="suffix"> for examples.</span></span><i class="baseline"></i></p>`);
  }
  return `<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:'Oracle Primary';src:${source}url(data:${primary.mime};base64,${primary.bytes.toString('base64')});${sourceLocal || profile === 'url-default' ? '' : `font-weight:${faceWeight};`}font-display:block}
  ${secondary ? `@font-face{font-family:'Oracle Secondary';src:url(data:${secondary.mime};base64,${secondary.bytes.toString('base64')});font-weight:400;font-display:block}` : ''}
  html,body{margin:0;background:#fff;color:#000}*{box-sizing:border-box}
  .line{width:1000px;height:72px;margin:0;padding:0;font:400 32px/48px 'Oracle Primary';font-synthesis:none;white-space:pre}
  .baseline{display:inline-block;width:0;height:0;vertical-align:baseline}
  </style>${weights.join('')}`;
}

function imageStats(png) {
  const image = PNG.sync.read(png);
  let minX = image.width, minY = image.height, maxX = -1, maxY = -1, inkPixels = 0, darkness = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const index = (y * image.width + x) * 4;
    if (image.data[index] < 254 || image.data[index + 1] < 254 || image.data[index + 2] < 254) {
      inkPixels++; darkness += 765 - image.data[index] - image.data[index + 1] - image.data[index + 2];
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return { width: image.width, height: image.height, rawPixelSHA256: hash(image.data), pngSHA256: hash(png), inkPixels, darkness,
    inkBounds: maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null };
}

function pixelDelta(first, second) {
  const a = PNG.sync.read(first), b = PNG.sync.read(second); assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let pixels = 0, channelDelta = 0;
  for (let index = 0; index < a.data.length; index += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel++) { const d = Math.abs(a.data[index + channel] - b.data[index + channel]); channelDelta += d; changed ||= d > 0; }
    if (changed) pixels++;
  }
  return { equal: pixels === 0, differentPixels: pixels, absoluteChannelDelta: channelDelta };
}

async function browserOracle(t, { primary, secondary, privateIana = false, staticGlyph = false, sourceCss }) {
  const { browser } = await context(t), profiles = [], screenshots = new Map();
  for (const profile of [...profileNames, ...(privateIana ? ['source-local-default'] : [])]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 500 }, deviceScaleFactor: 1 });
    // Data-only fonts; no network, tooling DOM patches, image transforms or registration.
    await page.route('**/*', route => route.abort());
    await page.setContent(oracleMarkup({ primary, secondary, profile, sourceLocal: profile === 'source-local-default', staticGlyph }));
    await page.evaluate(async () => { await Promise.all([400,500,700].map(weight => document.fonts.load(`${weight} 32px "Oracle Primary"`))); await document.fonts.ready;
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    const observation = await page.evaluate(() => {
      const rect = box => ({ x: box.x, y: box.y, width: box.width, height: box.height });
      const measure = element => { const range = document.createRange(); range.selectNodeContents(element); const box = range.getBoundingClientRect(), style = getComputedStyle(element);
        return { text: element.textContent, advance: box.width, range: rect(box), requested: { family: style.fontFamily, weight: style.fontWeight, style: style.fontStyle,
          synthesis: style.fontSynthesis, variations: style.fontVariationSettings, size: style.fontSize, lineHeight: style.lineHeight } }; };
      return { fontFaces: Array.from(document.fonts, face => ({ family: face.family, weight: face.weight, style: face.style, status: face.status })),
        rows: Array.from(document.querySelectorAll('.line'), row => ({ id: row.dataset.row, ...measure(row.querySelector('.copy')),
          baseline: row.querySelector('.baseline').getBoundingClientRect().top - row.getBoundingClientRect().top,
          parts: Array.from(row.querySelectorAll('[data-part]'), part => ({ part: part.dataset.part, ...measure(part) })) })) };
    });
    const session = await page.context().newCDPSession(page); await session.send('DOM.enable'); await session.send('CSS.enable');
    const doc = await session.send('DOM.getDocument', { depth: 0 });
    for (const row of observation.rows) {
      const selectors = [`#${row.id}`, ...row.parts.map(part => `#${row.id} [data-part="${part.part}"]`)];
      row.platformFonts = [];
      for (const selector of selectors) {
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
        row.platformFonts.push({ selector, ...(await session.send('CSS.getPlatformFontsForNode', { nodeId })) });
      }
      const image = await page.locator(`[data-row="${row.id}"]`).screenshot({ animations: 'disabled', scale: 'css' });
      screenshots.set(`${profile}/${row.id}`, image); row.pixels = imageStats(image);
      if (process.env.CODESHELL_FONT_ORACLE_EVIDENCE_DIR) {
        const dir = resolve(process.env.CODESHELL_FONT_ORACLE_EVIDENCE_DIR, privateIana ? 'iana-private' : staticGlyph ? 'public-static' : 'public-variable');
        await mkdir(dir, { recursive: true }); row.image = resolve(dir, `${profile}-${row.id}.png`); await writeFile(row.image, image, { flag: 'wx' });
      }
    }
    profiles.push({ profile, authoredPrimaryFace: { fontFamily: 'Oracle Primary', fontSynthesis: 'none',
      fontWeightDescriptor: profile === 'source-local-default' || profile === 'url-default' ? '(omitted)' : ['wide-100-900', 'explicit-axis'].includes(profile) ? '100 900' : '400',
      src: `${profile === 'source-local-default' ? 'local("Noto Sans"),local("NotoSans"),' : ''}url(data:${primary.mime};base64,<original-font-bytes-sha256:${hash(primary.bytes)}>)`,
      axisProperty: ['explicit-axis', 'narrow-axis'].includes(profile) ? "font-variation-settings:'wght' <requestedWeight>" : '(omitted)' }, ...observation }); await page.close();
  }
  const comparisons = [];
  for (const row of profiles[0].rows) for (const other of profiles.slice(1)) comparisons.push({ row: row.id, first: 'narrow-400', second: other.profile,
    ...pixelDelta(screenshots.get(`narrow-400/${row.id}`), screenshots.get(`${other.profile}/${row.id}`)) });
  const report = { browserVersion: browser.version(), dpr: 1, viewport: { width: 1000, height: 500 }, noScreenshotAdjustments: true,
    scope: 'Private Chromium glyph/selection oracle; not CodeShell Host, Figma, or whole-page fidelity acceptance.',
    primary: { source: primary.source, bytes: primary.bytes.length, sha256: hash(primary.bytes), axes: primary.mime === 'font/ttf' ? sfntAxes(primary.bytes) : 'WOFF2 not independently decoded by this oracle' },
    secondary: secondary ? { source: secondary.source, bytes: secondary.bytes.length, sha256: hash(secondary.bytes), axes: sfntAxes(secondary.bytes) } : null,
    originalSourceCss: sourceCss ? { sha256: hash(sourceCss), fontFaceRules: sourceCss.match(/@font-face\s*\{[^}]*\}/g)?.filter(rule => /Noto|IBMPlex/.test(rule)),
      fontSynthesis: sourceCss.match(/font-synthesis\s*:\s*[^;}]+/g) } : null, profiles, comparisons };
  if (process.env.CODESHELL_FONT_ORACLE_EVIDENCE_DIR) {
    const dir = resolve(process.env.CODESHELL_FONT_ORACLE_EVIDENCE_DIR, privateIana ? 'iana-private' : staticGlyph ? 'public-static' : 'public-variable');
    await mkdir(dir, { recursive: true }); await writeFile(resolve(dir, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  }
  for (const profile of profiles) for (const row of profile.rows) {
    assert.equal(row.pixels.width, 1000); assert.equal(row.pixels.height, 72); assert(row.pixels.inkPixels > 0);
    assert(row.platformFonts[0].fonts.length > 0);
    assert(row.platformFonts[0].fonts.every(font => font.isCustomFont), 'unexpected platform fallback must remain visible, not become an oracle');
  }
  const byName = name => profiles.find(profile => profile.profile === name);
  const narrow400 = byName('narrow-400').rows[0], wide400 = byName('wide-100-900').rows[0];
  assert.equal(narrow400.advance, wide400.advance); assert.equal(narrow400.baseline, wide400.baseline);
  assert(pixelDelta(screenshots.get('narrow-400/w400'), screenshots.get('wide-100-900/w400')).equal, '400 default face control must be pixel-identical');
  if (staticGlyph) {
    assert.equal(byName('narrow-400').rows[0].pixels.rawPixelSHA256, byName('narrow-400').rows[2].pixels.rawPixelSHA256,
      'font-synthesis:none must not invent a bold static glyph');
  } else {
    const wide = byName('wide-100-900');
    assert.notEqual(wide.rows[0].pixels.rawPixelSHA256, wide.rows[2].pixels.rawPixelSHA256, 'the supplied variable must provide distinct 400/700 glyphs');
    for (const weight of [400,500,700]) assert(pixelDelta(screenshots.get(`wide-100-900/w${weight}`), screenshots.get(`explicit-axis/w${weight}`)).equal,
      `wide auto weight ${weight} must match its directly selected axis control`);
    for (const row of wide.rows) assert(pixelDelta(screenshots.get(`url-default/${row.id}`), screenshots.get(`wide-100-900/${row.id}`)).equal,
      'the frozen variable font with an omitted descriptor must retain the observed source glyph selection');
    if (privateIana) for (const row of wide.rows) assert(pixelDelta(screenshots.get(`source-local-default/${row.id}`), screenshots.get(`url-default/${row.id}`)).equal,
      'the local() source clause must not silently change the frozen original-byte oracle');
  }
  t.diagnostic(JSON.stringify({ primary: report.primary, rows: profiles.map(profile => ({ profile: profile.profile, rows: profile.rows.map(row => ({ id: row.id,
    advance: row.advance, baseline: row.baseline, faces: row.platformFonts[0].fonts, pixelSHA: row.pixels.rawPixelSHA256 })) })), comparisons }));
  return report;
}

test('public browser font-selection oracle distinguishes declaration policy from variable glyph capability', async t => {
  await browserOracle(t, { primary: { source: 'repo Roboto-Variable.ttf', bytes: await readFile(resolve(appRoot, 'fonts/Roboto-Variable.ttf')), mime: 'font/ttf' },
    secondary: { source: 'repo Roboto-Variable.ttf (family mixing control)', bytes: await readFile(resolve(appRoot, 'fonts/Roboto-Variable.ttf')), mime: 'font/ttf' } });
});

test('public static glyph oracle records actual faces without synthetic weight', async t => {
  await browserOracle(t, { primary: { source: 'repo fa-regular-400.woff2', bytes: await readFile(resolve(appRoot, 'fonts/fa-regular-400.woff2')), mime: 'font/woff2' }, staticGlyph: true });
});

test('private frozen IANA Noto/IBM oracle records actual source declaration and mixed-run glyphs', { skip: !process.env.IANA_FONT_ASSETS_DIR }, async t => {
  const directory = resolve(process.env.IANA_FONT_ASSETS_DIR);
  const noto = await readFile(resolve(directory, 'NotoSans-Latin.b72e420edb95.ttf'));
  const mono = await readFile(resolve(directory, 'IBMPlexMono-Regular.560033d0c7f2.ttf'));
  assert.equal(hash(noto), '7b8cac46a1c86d2533a616b1fcf4e1926b8e39bda69034508b0df96791f56d97');
  assert.equal(hash(mono), '6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46');
  assert(sfntAxes(noto).some(axis => axis.tag === 'wght' && axis.min === 100 && axis.max === 900)); assert.deepEqual(sfntAxes(mono), []);
  const report = await browserOracle(t, { privateIana: true, primary: { source: 'frozen IANA NotoSans Latin original TTF', bytes: noto, mime: 'font/ttf' },
    secondary: { source: 'frozen IANA IBM Plex Mono Regular original TTF', bytes: mono, mime: 'font/ttf' }, sourceCss: await readFile(resolve(directory, '..', 'source.css'), 'utf8') });
  const { page } = await context(t, true);
  await page.route('**/fonts/oracle-noto.ttf', route => route.fulfill({ body: noto, contentType: 'font/ttf' }));
  await page.route('**/fonts/oracle-mono.ttf', route => route.fulfill({ body: mono, contentType: 'font/ttf' }));
  const cases = [
    { label: 'iana-base400-range700', options: { extraRanges: [{ start: fixtureText.lastIndexOf('ICANN'), end: fixtureText.length, fontWeight: 700 }] }, sourceRow: 'mixed' },
    { label: 'iana-base700-no-ref', options: { text: specimen, baseWeight: 700, useFontRef: false, paintRange: true }, sourceRow: 'w700' },
    { label: 'iana-mixed-noto-ibm', options: { text: 'A number of domains example.com for examples.', start: 20, end: 31,
      rangeOverrides: { fontFamily: 'Oracle IBM Mono', fontWeight: 400 }, additionalFonts: [{ id: 'oracle-ibm-mono', file: 'oracle-mono.ttf', family: 'Oracle IBM Mono' }] }, sourceRow: 'cross-family' },
  ];
  for (const { label, options, sourceRow } of cases) {
    const result = await rendererProbe(page, { file: 'oracle-noto.ttf', family: 'Oracle Noto', ...options });
    result.fontBytes = { noto: hash(noto), ibm: hash(mono) };
    result.baselineCoordinateSystems = 'Source DOM line-box baseline and model hanging-origin baseline are both recorded; raw glyph PNGs are not manually aligned or claimed pixel-equivalent.';
    result.sourceOracle = report.profiles.find(profile => profile.profile === 'url-default').rows.find(row => row.id === sourceRow);
    result.widthDeltaFromSource = result.accepted ? result.shapes[0].width - result.sourceOracle.advance : null;
    await recordRenderer(t, label, result);
    assert.equal(result.accepted, true, `${label} must preserve the supplied native font glyphs`);
    assert.equal(result.counters.nativeTextNodes, 2); assert.equal(result.counters.rasterTextNodes, 0);
    assert.equal(result.stats.nativeMissingGlyphs, 0);
    assert(Math.abs(result.widthDeltaFromSource) < 0.1, `${label} native advance must match the original-byte source selection`);
  }
});

test('private full IANA wrapper verifies native instances and explicitly reports the four original-byte missing glyphs', { skip: !process.env.IANA_FONT_ASSETS_DIR }, async t => {
  const inputPath = resolve(process.env.IANA_FONT_ASSETS_DIR, '..', 'frozen.colors.studio.json'), input = await readFile(inputPath);
  const notoBytes = await readFile(resolve(process.env.IANA_FONT_ASSETS_DIR, 'NotoSans-Latin.b72e420edb95.ttf'));
  const cmapProof = ['←', '▪', ' ', 'A'].map(character => ({ character, scalar: `U+${character.codePointAt(0).toString(16).toUpperCase()}`, records: cmapGlyphs(notoBytes, character.codePointAt(0)) }));
  for (const proof of cmapProof.slice(0, 2)) assert(proof.records.every(record => record.glyph === 0), 'arrow/square are absent from every original-byte Unicode cmap');
  for (const proof of cmapProof.slice(2)) assert(proof.records.some(record => record.glyph !== 0), 'space and A prove the cmap positive control works');
  const { page } = await context(t, true);
  await page.route('**/oracle/input.json', route => route.fulfill({ body: input, contentType: 'application/json' }));
  const report = await page.evaluate(async () => {
    const { prepareFigmaImport } = await import('/figma-bridge.mjs');
    const { createRenderer } = await import('/canvas/canvaskit-renderer.mjs');
    const source = await (await fetch('/oracle/input.json')).json(), before = JSON.stringify(source);
    const sha256Bytes = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const prepared = await prepareFigmaImport(source, { sha256Bytes, browserDocument: document });
    const resources = new Map();
    for (const plan of prepared.resourcePlans) {
      const binary = atob(plan.parts.map(part => part.content).join('')), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      resources.set(plan.descriptor.id, { bytes, mimeType: plan.descriptor.mime, descriptor: plan.descriptor });
    }
    document.body.style.margin = '0'; const canvas = document.createElement('canvas'); canvas.style.display = 'block'; document.body.append(canvas);
    const renderer = await createRenderer({ canvas, assetsBaseUrl: '/canvas/vendor/', tileCacheEnabled: false });
    try {
      renderer.resize(1000, 900, 1); await renderer.setScene(prepared.document, { resources });
      const zoom = Math.min(0.38, 960 / prepared.document.canvas.width, 860 / prepared.document.canvas.height);
      renderer.render({ pan: { x: 0, y: 0 }, zoom });
      const screenshot = canvas.toDataURL('image/png').split(',')[1];
      return { scope: 'Private source-only full-document CanvasKit WebGL render; not existing UI, CodeShell Host, Figma or whole-page pixel equivalence.',
        sourceUnchanged: before === JSON.stringify(source), nodes: prepared.document.nodes.length, textNodes: prepared.document.nodes.filter(node => node.type === 'text').length,
        nativeText: prepared.document.nodes.filter(node => node.type === 'text').map(node => ({ id: node.id, text: node.text, family: node.fontFamily, weight: node.fontWeight, fontRef: node.fontRef ?? null, ranges: node.textRanges?.ranges ?? [] })),
        importStats: prepared.stats, importWarnings: prepared.warnings, textMeasurement: prepared.textMeasurement,
        fonts: await Promise.all([...resources.values()].filter(resource => resource.descriptor.kind === 'font').map(async resource => ({ ...resource.descriptor,
          actualBytes: resource.bytes.length, actualSHA256: await sha256Bytes(resource.bytes) }))),
        stats: renderer.stats(), viewport: { width: 1000, height: 900, dpr: 1 }, zoom, screenshot };
    } finally { renderer.dispose(); }
  });
  const png = Buffer.from(report.screenshot, 'base64'); delete report.screenshot;
  report.originalFontCmapProof = { sha256: hash(notoBytes), controls: cmapProof };
  report.missingGlyphNodes = report.stats.unsupported.filter(issue => issue.code === 'native-missing-glyph').map(issue => {
    const node = report.nativeText.find(node => node.id === issue.nodeId);
    return { ...issue, text: node.text, nonWhitespaceScalars: [...node.text].filter(character => !/\s/u.test(character)).map(character => `U+${character.codePointAt(0).toString(16).toUpperCase()}`) };
  });
  report.input = { path: inputPath, bytes: input.length, sha256: hash(input) }; report.pixels = imageStats(png);
  if (process.env.CODESHELL_FONT_ORACLE_EVIDENCE_DIR) {
    const dir = resolve(process.env.CODESHELL_FONT_ORACLE_EVIDENCE_DIR, 'iana-whole-document'); await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, 'canvaskit-webgl.png'), png, { flag: 'wx' });
    await writeFile(resolve(dir, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  }
  t.diagnostic(JSON.stringify({ nodes: report.nodes, textNodes: report.textNodes, stats: report.stats, fonts: report.fonts, input: report.input, pixels: report.pixels }));
  assert.equal(report.sourceUnchanged, true); assert.equal(report.stats.backend, 'WebGL2');
  assert.equal(report.textNodes, 38); assert.equal(report.stats.nativeTextNodes, 34); assert.equal(report.stats.rasterTextNodes, 4);
  assert.equal(report.stats.nativeMissingGlyphs, 4); assert.equal(report.stats.missingImages, 0); assert.equal(report.stats.unsupportedCount, 4);
  assert.deepEqual(report.missingGlyphNodes.map(node => node.text).sort(), ['←', '▪ ', '▪ ', '▪ '].sort());
  assert(report.missingGlyphNodes.every(node => !report.nativeText.find(text => text.id === node.nodeId).ranges.length), 'all editable mixed-font/ranged text stays native; only independently proven missing glyphs rasterize');
  assert(report.pixels.inkPixels > 0); assert(report.stats.fontSelections.some(selection => selection.requestedWeight === 700 && selection.selection === 'variable-instance' && selection.proof === 'sfnt-fvar'));
  assert(report.fonts.some(font => font.actualSHA256 === '7b8cac46a1c86d2533a616b1fcf4e1926b8e39bda69034508b0df96791f56d97'));
  assert(report.fonts.some(font => font.actualSHA256 === '6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46'));
});
