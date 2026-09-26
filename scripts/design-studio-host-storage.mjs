import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
if (process.argv.length !== 3)
  throw new Error(
    "Usage: node scripts/design-studio-host-storage.mjs <built-server-package-directory>",
  );
const serverRoot = resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(join(serverRoot, "package.json"), "utf8"));
assert.equal(manifest.name, "@cjhyy/code-shell-server");
const { PanelRuntimeServices } = await import(
  pathToFileURL(join(serverRoot, "dist/panels/runtime-services.js")).href
);
import { createRecoverySession } from "../apps/design-studio/app/recovery-session.mjs";
const root = await mkdtemp(join(tmpdir(), "design-real-host-"));
try {
  const dataDir = join(root, "data"),
    project = join(root, "A"),
    other = join(root, "B");
  await mkdir(project);
  await mkdir(other);
  let authorized = true;
  const scope = {
    appId: "design-studio",
    cwd: project,
    projectPath: project,
    permissions: [
      "context.workspace",
      "workspace.info",
      "workspace.read",
      "workspace.write",
      "storage",
    ],
    isAuthorized: async () => authorized,
  };
  const create = (runtime) =>
    createRecoverySession({
      call: (method, params) => runtime.call(scope, method, params),
      key: "recovery-fixture",
      epoch: 0,
      currentEpoch: () => 0,
      getContext: () => ({ availableMethods: ["storage.getSnapshot", "storage.compareAndSet"] }),
    });
  const one = new PanelRuntimeServices({ dataDir }),
    two = new PanelRuntimeServices({ dataDir });
  const a = create(one),
    b = create(two);
  await Promise.all([a.load(), b.load()]);
  const values = [0, 1].map((window) => ({
    format: "codeshell.design.recovery",
    version: 1,
    workspaceRoot: project,
    path: "designs/test.codesign.json",
    window,
    record: { operations: [] },
  }));
  const results = await Promise.allSettled([a.save(values[0]), b.save(values[1])]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const winner = results[0].status === "fulfilled" ? 0 : 1;
  await assert.rejects([b, a][winner].clear(), { code: "RECOVERY_CONFLICT" });
  const restart = new PanelRuntimeServices({ dataDir }),
    reopened = create(restart);
  assert.deepEqual(await reopened.load(), values[winner]);
  assert.deepEqual(
    await restart.call({ ...scope, cwd: other, projectPath: other }, "storage.getSnapshot", {
      key: "recovery-fixture",
    }),
    { exists: false, value: null, revision: null },
  );
  const files = await readdir(join(dataDir, "panel-app-storage"));
  const json = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map((f) => readFile(join(dataDir, "panel-app-storage", f), "utf8")),
  );
  assert.ok(json.some((contents) => contents.includes("codeshell.design.recovery")));
  authorized = false;
  await assert.rejects(reopened.save({ revoked: true }));
  authorized = true;
  assert.deepEqual(await create(restart).load(), values[winner]);
  await reopened.load();
  await reopened.clear();
  assert.equal(await create(new PanelRuntimeServices({ dataDir })).load(), null);
  console.log(
    "PASS: actual Node Host disk storage, competing Design recovery sessions, stale deletion, independent project isolation, restart, revocation and conditional removal",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
