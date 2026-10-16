import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const uiPath = new URL("../apps/design-studio/app/figma-plugin/ui.html", import.meta.url);
const begin = "<!-- BEGIN GENERATED V3 FILE ADAPTER -->";
const end = "<!-- END GENERATED V3 FILE ADAPTER -->";
const result = await build({
  absWorkingDir: root,
  entryPoints: ["apps/design-studio/app/figma-plugin/v3-input.mjs"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "CodeShellFigmaFile",
  target: "es2022",
  minify: true,
  legalComments: "inline",
  charset: "utf8",
  sourcemap: false,
  write: false,
  logLevel: "silent",
});
assert.equal(result.outputFiles.length, 1);
// HTML script data cannot contain a closing script tag, even inside strings.
const bundled = result.outputFiles[0].text.replace(/<\/script/giu, "<\\/script");
const block = `${begin}\n    <script>\n${bundled}    </script>\n    ${end}`;
const source = await readFile(uiPath, "utf8");
assert.equal(source.split(begin).length, 2, "ui.html must contain one generated adapter slot");
assert.equal(source.split(end).length, 2, "ui.html must contain one generated adapter slot");
const start = source.indexOf(begin),
  finish = source.indexOf(end) + end.length;
assert(start < finish);
const output = source.slice(0, start) + block + source.slice(finish);
if (process.argv.includes("--check"))
  assert(
    source === output,
    "Figma plugin UI is stale; run node scripts/build-design-studio-figma-plugin.mjs",
  );
else await writeFile(uiPath, output);
console.log(
  `Figma plugin self-contained v3 adapter ${process.argv.includes("--check") ? "verified" : "built"} (${Buffer.byteLength(bundled)} bytes)`,
);
