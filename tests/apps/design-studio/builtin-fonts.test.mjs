import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { BUILTIN_DESIGN_FONTS } from "../../../apps/design-studio/app/builtin-font-catalog.mjs";
import {
  prepareBuiltinDesignFontResources,
  ensureBuiltinDesignFonts,
  resourceDataUrlsFromPlans,
} from "../../../apps/design-studio/app/builtin-fonts.mjs";
import { prepareFigmaImport } from "../../../apps/design-studio/app/figma-bridge.mjs";
import {
  exportDesignSvg,
  serializeDesignDocument,
  MAX_LOCAL_SVG_EXPORT_BYTES,
} from "../../../apps/design-studio/app/document.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import {
  createPortableDesign,
  planPortableDesign,
} from "../../../apps/design-studio/app/portable-backup.mjs";
import {
  createFigmaBinding,
  createFigmaPatch,
} from "../../../apps/design-studio/app/figma-binding.mjs";
import { resolveDesignResource } from "../../../apps/design-studio/app/resource-store.mjs";

const readBytes = async (url) => new Uint8Array(await readFile(url));
const sha256Bytes = async (bytes) => createHash("sha256").update(bytes).digest("hex");
function source() {
  const texts = [
    ["Roboto", 400, "Actual regular type"],
    ["Roboto", 600, "Actual semibold type"],
    ["Roboto", 700, "Actual bold type"],
    ["Inter", 400, "Inter regular"],
    ["Inter", 700, "Inter bold"],
    ["Font Awesome 5 Free", 900, "\ue586"],
    ["Font Awesome 6 Free", 900, "\ue586"],
    ["Font Awesome 5 Brands", 400, "\uf099"],
  ];
  return {
    name: "Bundled fonts",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: texts.map(([fontFamily, fontWeight, characters], index) => ({
            id: `1:${index}`,
            type: "TEXT",
            name: `Text ${index}`,
            characters,
            absoluteBoundingBox: { x: 20, y: 20 + index * 50, width: 800, height: 40 },
            fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
            style: { fontFamily, fontWeight, fontSize: 24 },
          })),
        },
      ],
    },
  };
}
const prepared = () => prepareFigmaImport(source(), { readFontBytes: readBytes, sha256Bytes });

test("bundled fonts are complete official files with pinned byte digests and retained license notices", async () => {
  for (const font of BUILTIN_DESIGN_FONTS) {
    const bytes = await readBytes(
      new URL(`../../../apps/design-studio/app/${font.file}`, import.meta.url),
    );
    assert.equal(bytes.length, font.bytes);
    assert.equal(await sha256Bytes(bytes), font.sha256);
    assert.match(font.source, /^https:\/\/raw[.]githubusercontent[.]com\//u);
    assert.ok(bytes.length > 20000);
  }
  for (const file of ["Font-Awesome-LICENSE.md", "Roboto-OFL.md", "Inter-LICENSE.md"])
    assert.match(
      await readFile(
        new URL(`../../../apps/design-studio/app/fonts/${file}`, import.meta.url),
        "utf8",
      ),
      /OPEN FONT LICENSE|Open Font License/u,
    );
});

test("all used weights and FA5/6 aliases retain original families and glyphs while sharing immutable font bytes", async () => {
  const result = await prepared();
  assert.equal(result.document.resources.length, 8);
  assert.equal(result.document.nodes.length, 8);
  assert.equal(
    new Set(result.resourcePlans.flatMap((plan) => plan.parts.map((part) => part.path))).size,
    result.resourcePlans.reduce((count, plan) => count + plan.parts.length, 0),
  );
  const urls = resourceDataUrlsFromPlans(result.resourcePlans);
  const roboto = result.document.resources.filter((item) => item.family === "Roboto");
  assert.deepEqual(
    roboto.map((item) => item.weight),
    [400, 600, 700],
  );
  assert.equal(new Set(roboto.map((item) => item.sha256)).size, 1);
  for (const resource of result.document.resources) {
    const bytes = Buffer.from(urls.get(resource.id).split(",")[1], "base64");
    assert.equal(bytes.length, resource.bytes);
    assert.equal(await sha256Bytes(bytes), resource.sha256);
  }
  assert.equal(result.document.nodes[5].fontFamily, "Font Awesome 5 Free");
  assert.equal(result.document.nodes[5].text, "\ue586");
  assert.equal(result.document.nodes[5].fontRef, "builtin-fa-solid-5-900-normal");
  assert.equal(result.document.nodes[6].fontFamily, "Font Awesome 6 Free");
  assert.deepEqual(createFigmaPatch(createFigmaBinding(result), result.document).operations, []);
});

test("corrupt bundled bytes fail before assigning any partial font references", async () => {
  const result = await prepareFigmaImport(source());
  const before = serializeDesignDocument(result.document);
  await assert.rejects(
    prepareBuiltinDesignFontResources(result.document, {
      readBytes: async (url) => {
        const bytes = await readBytes(url);
        if (url.pathname.includes("fa-solid")) bytes[50] ^= 1;
        return bytes;
      },
      sha256Bytes,
    }),
    /integrity/u,
  );
  assert.equal(serializeDesignDocument(result.document), before);
});

test("portable SVG/HTML contains real font bytes; Host SVG budget stays strict and local 4MiB output is explicit", async () => {
  const result = await prepared(),
    urls = resourceDataUrlsFromPlans(result.resourcePlans);
  assert.throws(() => exportDesignSvg(result.document, { resourceDataUrls: urls }), /导出上限/u);
  const svg = exportDesignSvg(result.document, {
    resourceDataUrls: urls,
    maxBytes: MAX_LOCAL_SVG_EXPORT_BYTES,
  });
  assert.ok(Buffer.byteLength(svg) < MAX_LOCAL_SVG_EXPORT_BYTES);
  assert.match(svg, /font-weight:400 700/u);
  assert.equal((svg.match(/@font-face/gu) ?? []).length, 5);
  assert.match(svg, /Font Awesome 5 Free/u);
  assert.match(svg, /data:font\/ttf;base64,/u);
  const html = exportDesignFrontend(result.document, { resourceDataUrls: urls });
  assert.match(html, /@font-face/u);
  assert.match(html, /data:font\/woff2;base64,/u);
  assert.doesNotMatch(html, /url\(["']?https?:/u);
  assert.throws(
    () => exportDesignSvg(result.document, { maxBytes: MAX_LOCAL_SVG_EXPORT_BYTES + 1 }),
    /4 MiB/u,
  );
});

test("shared font parts resolve into a complete portable backup and restore without missing weight URLs", async () => {
  const result = await prepared();
  const parts = new Map(
    result.resourcePlans.flatMap((plan) => plan.parts.map((part) => [part.path, part.content])),
  );
  const readText = async (path) => ({ content: parts.get(path) });
  const resources = await Promise.all(
    result.document.resources.map((descriptor) =>
      resolveDesignResource({ descriptor, readText, sha256Bytes }),
    ),
  );
  const backup = await createPortableDesign({
    document: result.document,
    readText,
    source: {
      workspaceRoot: "/fixture",
      sessionId: "font-test",
      path: "designs/font-test.codesign.json",
    },
    sha256Bytes,
  });
  const restored = await planPortableDesign(backup, {
    sha256Bytes,
    sha256: async (text) => sha256Bytes(Buffer.from(text)),
  });
  assert.equal(restored.resourceCount, 8);
  assert.equal(resources[0].dataUrl, resources[2].dataUrl);
  assert.ok(restored.parts.length > 0);
});

test("FontFace readiness is awaited and failures are explicit instead of generic icon fallback", async () => {
  const result = await prepared();
  const faces = result.document.resources.map((descriptor) => ({
    descriptor,
    bytes: Buffer.from(
      resourceDataUrlsFromPlans(result.resourcePlans).get(descriptor.id).split(",")[1],
      "base64",
    ),
  }));
  const events = [];
  const fontSet = {
    add(face) {
      events.push(`added:${face.family}`);
    },
    ready: Promise.resolve(),
  };
  class Face {
    constructor(family) {
      this.family = family;
    }
    async load() {
      await Promise.resolve();
      events.push(`loaded:${this.family}`);
      return this;
    }
  }
  await ensureBuiltinDesignFonts(result.document, { fontSet, FontFaceConstructor: Face, faces });
  assert.equal(events.length, 16);
  assert.match(events[0], /^loaded:/u);
  assert.match(events[1], /^added:/u);
  class Broken {
    async load() {
      throw Error("Font unavailable");
    }
  }
  await assert.rejects(
    ensureBuiltinDesignFonts(result.document, {
      fontSet: { ...fontSet },
      FontFaceConstructor: Broken,
      faces,
    }),
    /Font unavailable/u,
  );
});

test("offline Chromium loads FA5/6 aliases and renders U+E586 as the real shared glyph rather than tofu", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
  let external = 0;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "fonts.test") {
      external += 1;
      return route.abort();
    }
    if (url.pathname === "/")
      return route.fulfill({ body: "<!doctype html><body>Fonts</body>", contentType: "text/html" });
    const path = resolve(root, decodeURIComponent(url.pathname.slice(1)));
    if (!path.startsWith(root + sep)) return route.abort();
    try {
      return route.fulfill({
        body: await readFile(path),
        contentType: [".mjs", ".js"].includes(extname(path))
          ? "text/javascript"
          : "application/octet-stream",
      });
    } catch {
      return route.fulfill({ status: 404, body: "missing" });
    }
  });
  await page.goto("https://fonts.test/");
  const result = await page.evaluate(async (input) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    const prepared = await prepareFigmaImport(input);
    function ink(family, text) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const context = canvas.getContext("2d");
      context.font = `900 80px "${family}"`;
      context.fillText(text, 8, 96);
      let digest = 2166136261;
      for (const value of context.getImageData(0, 0, 128, 128).data)
        digest = Math.imul(digest ^ value, 16777619);
      return digest >>> 0;
    }
    return {
      resources: prepared.document.resources.length,
      five: ink("Font Awesome 5 Free", "\ue586"),
      six: ink("Font Awesome 6 Free", "\ue586"),
      missing: ink("Arial", "\ue586"),
      ready: document.fonts.check('900 24px "Font Awesome 5 Free"', "\ue586"),
    };
  }, source());
  assert.equal(result.resources, 8);
  assert.equal(result.ready, true);
  assert.equal(result.five, result.six);
  assert.notEqual(result.five, result.missing);
  assert.equal(external, 0);
});
