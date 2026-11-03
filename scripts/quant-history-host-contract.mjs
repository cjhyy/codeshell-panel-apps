import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { repositoryRoot } from "./panel-projects.mjs";
import { createHistoryBatchClient } from "../apps/quant-lab/app/modules/history-batch-client.mjs";

// Compile the actual, read-only Desktop capability function. Its imports resolve
// against that Host's built public exports, never a hand-maintained method table.
export async function verifyQuantHistoryHostCapabilities(hostRoot, permissions) {
  const source = join(hostRoot, "packages/desktop/src/main/panel-app-capabilities.ts");
  const serverRoot = join(hostRoot, "packages/server");
  const serverPackage = JSON.parse(await readFile(join(serverRoot, "package.json"), "utf8"));
  const directory = await mkdtemp(join(tmpdir(), "quant-history-host-contract-"));
  try {
    const built = await build({
      entryPoints: [source], bundle: true, write: false, format: "esm", platform: "node",
      target: "node20", logLevel: "silent",
      plugins: [{ name: "actual-host-exports", setup(builder) {
        builder.onResolve({ filter: /^@cjhyy\// }, args => {
          assert(args.path.startsWith(`${serverPackage.name}/`), "unexpected Desktop capability dependency");
          const subpath = `.${args.path.slice(serverPackage.name.length)}`;
          const entry = serverPackage.exports[subpath]?.import;
          assert.equal(typeof entry, "string", `Host must export ${subpath} for ESM consumers`);
          return { path: resolve(serverRoot, entry), external: true };
        });
      } }],
    });
    const modulePath = join(directory, "capabilities.mjs");
    await writeFile(modulePath, built.outputFiles[0].contents);
    const { desktopPanelCapabilities } = await import(pathToFileURL(modulePath));
    const manifest = JSON.parse(await readFile(join(repositoryRoot, "apps/quant-lab/.codeshell-panel/panel.json"), "utf8"));
    const core = await import(pathToFileURL(join(hostRoot, "packages/core/dist/index.js")));
    core.PanelAppManifest.parse(manifest);
    const declared = permissions ?? manifest.permissions;
    assert.deepEqual(declared, manifest.permissions, "selected package must use its actual reviewed permission list");
    const options = { resources: { available: true }, tasks: { available: true }, services: true,
      audio: false, cookies: false, automations: false, mediaMethods: [] };
    const context = desktopPanelCapabilities(declared, options);
    const supports = value => createHistoryBatchClient({
      contextState: () => value, currentEpoch: () => 1,
      hostCall() { throw new Error("capability inspection must not submit work"); },
    }).supports();
    assert.equal(supports(context), true, "reviewed Quant permissions must expose every history client method");
    for (const missing of ["process", "resources", "storage"]) {
      const denied = desktopPanelCapabilities(declared.filter(value => value !== missing), options);
      assert.equal(supports(denied), false, `history must stay unavailable without ${missing}`);
    }
    assert.equal(supports(desktopPanelCapabilities(declared, { ...options, tasks: undefined })), false);
    return { version: manifest.version, permissions: declared, host: context.host,
      historySupported: true, requiredMethods: context.availableMethods.filter(name => name.startsWith("tasks.") || name.startsWith("storage.")) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/quant-history-host-contract.mjs /absolute/path/to/built/host");
  const report = await verifyQuantHistoryHostCapabilities(resolve(process.argv[2]));
  console.log(`PASS actual manifest -> Desktop capabilities -> historyBatch.supports ${JSON.stringify(report)}`);
}
