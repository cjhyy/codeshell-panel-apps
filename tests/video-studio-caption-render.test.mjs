import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { chromium } from "playwright";

const repository = fileURLToPath(new URL("../", import.meta.url));
// Both repositories can run independently. When the Host checkout is alongside
// the Panel repo, also compare its actual serialized canvas function pixel for pixel.
const hostFile = new URL(
  "../../codeshell/packages/desktop/src/main/media/media-caption-renderer.ts",
  import.meta.url,
);

test(
  "three real caption templates match frame compositing and the Host PNG renderer",
  { timeout: 20000 },
  async (t) => {
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.route("http://127.0.0.1/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8>" }),
    );
    await page.goto("http://127.0.0.1/caption-test");
    const bundled = await build({
      stdin: {
        resolveDir: repository,
        contents:
          'import * as media from "./apps/video-studio/src/media.ts"; import * as model from "./apps/video-studio/src/model.ts"; window.captionTest={...media,...model};',
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      target: "es2022",
      logLevel: "silent",
    });
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const hostSource = await readFile(hostFile, "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (hostSource) {
      const ast = ts.createSourceFile("host-caption.ts", hostSource, ts.ScriptTarget.Latest, true);
      const names = new Set(["drawCaptionPng", "validateCaptionImageRequest"]);
      const actualFunctions = ast.statements
        .filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
        .map((node) => node.getText(ast).replace(/^export\s+/, ""))
        .join("\n");
      assert.equal(
        ast.statements.filter(
          (node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text),
        ).length,
        2,
      );
      const code = ts.transpileModule(actualFunctions, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      }).outputText;
      await page.addScriptTag({
        content: `${code}\nwindow.hostCaption={drawCaptionPng,validateCaptionImageRequest};`,
      });
    }
    const result = await page.evaluate(() => {
      const { drawCaptionLayer, renderFrame, createDemoProject, MediaLibrary } = window.captionTest;
      const request = {
        width: 640,
        height: 360,
        fontSize: 18,
        texts: ["同一段字幕，同一种呈现。\nKeep the story moving."],
      };
      const styles = {},
        hostParity = {},
        frameParity = {};
      const canvas = () => {
        const value = document.createElement("canvas");
        value.width = request.width;
        value.height = request.height;
        return value;
      };
      for (const style of ["classic", "bold", "minimal"]) {
        const layer = canvas(),
          context = layer.getContext("2d");
        drawCaptionLayer(context, { ...request, style });
        const pixels = context.getImageData(0, 0, 640, 360).data;
        let painted = 0,
          yellow = 0,
          white = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3]) painted++;
          if (pixels[i + 3] > 220 && pixels[i] > 220 && pixels[i + 1] > 160 && pixels[i + 2] < 170)
            yellow++;
          if (pixels[i + 3] > 220 && pixels[i] > 220 && pixels[i + 1] > 220 && pixels[i + 2] > 220)
            white++;
        }
        styles[style] = { png: layer.toDataURL(), painted, yellow, white };
        if (window.hostCaption) {
          window.hostCaption.validateCaptionImageRequest({ ...request, style });
          hostParity[style] =
            window.hostCaption.drawCaptionPng({ ...request, style }) === layer.toDataURL();
        }
        const project = {
          ...createDemoProject(),
          width: 640,
          height: 360,
          captions: [{ id: "one", startFrame: 0, endFrame: 60, text: request.texts[0] }],
          captionStyle: style,
        };
        const frame = canvas(),
          composed = canvas(),
          library = new MediaLibrary();
        renderFrame(frame, project, library, 5);
        renderFrame(composed, { ...project, captions: [] }, library, 5);
        composed.getContext("2d").drawImage(layer, 0, 0);
        const direct = frame.getContext("2d").getImageData(0, 0, 640, 360).data;
        const flattened = composed.getContext("2d").getImageData(0, 0, 640, 360).data;
        let maxDelta = 0;
        for (let i = 0; i < direct.length; i++)
          maxDelta = Math.max(maxDelta, Math.abs(direct[i] - flattened[i]));
        frameParity[style] = maxDelta;
      }
      const legacy = canvas();
      drawCaptionLayer(legacy.getContext("2d"), request);
      const invalid = [];
      if (window.hostCaption)
        for (const style of ["color:red", "url(https://example.com)", {}, null]) {
          try {
            window.hostCaption.validateCaptionImageRequest({ ...request, style });
            invalid.push(false);
          } catch {
            invalid.push(true);
          }
        }
      return { styles, hostParity, frameParity, legacy: legacy.toDataURL(), invalid };
    });
    assert.equal(result.legacy, result.styles.classic.png);
    assert.equal(new Set(Object.values(result.styles).map((style) => style.png)).size, 3);
    assert.ok(result.styles.bold.yellow > 80, "bold must visibly render yellow text");
    assert.equal(result.styles.classic.yellow, 0);
    assert.ok(result.styles.classic.white > 80 && result.styles.minimal.white > 80);
    assert.ok(
      result.styles.classic.painted > result.styles.minimal.painted * 1.5,
      "minimal must remove the caption background box",
    );
    // Alpha flattening can introduce one or two 8-bit rounding levels; position,
    // font, colour and wrapping must otherwise agree over the complete frame.
    for (const [style, delta] of Object.entries(result.frameParity))
      assert.ok(delta <= 3, `${style} compositing pixel delta ${delta}`);
    if (hostSource) {
      assert.deepEqual(result.hostParity, { classic: true, bold: true, minimal: true });
      assert.deepEqual(result.invalid, [true, true, true, true]);
    } else
      t.diagnostic(
        "Host checkout absent: standalone Panel rendering verified; cross-repository PNG parity skipped.",
      );
  },
);
