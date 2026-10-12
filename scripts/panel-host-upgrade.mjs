import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot } from "./panel-projects.mjs";
import { dataScenario } from "./panel-upgrade-scenarios.mjs";

// Immutable repository packages, never downloaded or installed into a real profile.
// The 4.1.0 snapshot exercises the original A/B writer; 4.1.1 is also installed below.
const cases = [
  ["design-studio", "design-studio-v0.18.1", "14c9a1819794d7db6ad3d6cbc2df53ec5cfd9f42", "apps/design-studio"],
  ["job-hunt-hq", "4929f80", "4929f80e0e2ae14945fe0533df3bd948f29ccf6e", "apps/job-hunt-hq"],
  ["job-hunt-hq", "job-hunt-hq-v4.1.1", "14c9a1819794d7db6ad3d6cbc2df53ec5cfd9f42", "apps/job-hunt-hq"],
  ["quant-lab", "quant-lab-v0.45.2", "e99f57c0350c28b41d134dec2e06bd4f76f89c00", "apps/quant-lab"],
  ["video-download", "video-download-v0.22.3", "a4cab15f1542b606607fe81296db8a9d0b35759c", "apps/video-download"],
  ["video-studio", "video-studio-v0.5.12", "2149c34087c5e692abe10ba36fa4082d7a416a34", "panels/video-studio"],
  ["starter-panel", "57703cbb", "57703cbb75ed44dce004215ad7075480c289becb", "templates/starter"],
];
const [serverRoot, sandbox, reportPath] = process.argv.slice(2).map(value => resolve(value));
assert.ok(sandbox && process.env.HOME === join(sandbox, "home"), "run through check-panel-host-upgrade.mjs");
const core = await import(pathToFileURL(resolve(serverRoot, "../core/dist/panel-apps/index.js")).href);
const { readInstalledPanelAppsRegistry } = await import(pathToFileURL(resolve(serverRoot, "../core/dist/panel-apps/registry.js")).href);
const { PanelRuntimeServices } = await import(pathToFileURL(join(serverRoot, "dist/panels/runtime-services.js")).href);
const hostCheckoutManifestVersion = JSON.parse(await readFile(join(serverRoot, "package.json"), "utf8")).version;
const dataDir = join(sandbox, "runtime-data");
let runtime = new PanelRuntimeServices({ dataDir });
const reports = [];
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repositoryRoot, encoding: null, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
};
const restart = () => { runtime = new PanelRuntimeServices({ dataDir }); };
async function extract(commit, path, destination) {
  await mkdir(destination, { recursive: true });
  const archive = git("archive", "--format=tar", commit, path);
  const result = spawnSync("tar", ["-x", "-C", destination], { input: archive });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, String(result.stderr));
  return join(destination, path);
}
async function pin(project, app) {
  await mkdir(join(project, ".code-shell"), { recursive: true });
  await writeFile(join(project, ".code-shell/settings.json"), JSON.stringify({
    panelAppBindings: [app.id],
    panelAppPins: { [app.id]: { version: app.version, packageDigest: app.packageDigest } },
  }));
  const selected = (await core.listProjectPanelApps(project, app.id)).find(item => item.id === app.id);
  assert.equal(selected.packageDigest, app.packageDigest);
  assert.equal(selected.version, app.version);
  return selected;
}
function context(project, selected, sourceRoot) {
  const valid = async () => {
    // pin() already verified immutable package bytes through the real resolver.
    // Each storage operation rechecks actual project selection and installation authority.
    const pin = core.projectPanelAppPackagePins(project, selected.id)[selected.id];
    return pin?.packageDigest === selected.packageDigest &&
      (await readInstalledPanelAppsRegistry()).some(app => app.id === selected.id);
  };
  const scope = { appId: selected.id, cwd: project, projectPath: project,
    permissions: selected.permissions, isAuthorized: valid };
  const call = (method, params) => runtime.call(scope, method, params);
  return { project, selected, sourceRoot, call, restart,
    // The synchronous UI hook is unused here; call() enforces actual Host authority.
    scope: { call, check() {} },
    module: path => import(pathToFileURL(join(selected.installPath, path)).href),
    assertAuthorized: async () => assert.equal(await valid(), true),
  };
}
async function replaceSource(source, packageRoot) {
  await rm(source, { recursive: true, force: true });
  await cp(packageRoot, source, { recursive: true });
}
async function update(id, source, packageRoot) {
  await replaceSource(source, packageRoot);
  const review = await core.previewInstalledPanelAppUpdate(id);
  assert.equal(review.id, id);
  const app = await core.installReviewedPanelAppUpdate(id, review.reviewToken, "2026-10-12T00:00:00.000Z");
  assert.equal(app.version, review.version);
  assert.deepEqual(app.permissions, review.permissions);
  return { app, review };
}

for (const [index, [id, ref, commit, packagePath]] of cases.entries()) {
  const root = join(sandbox, `case-${index}-${id}`);
  assert.equal(String(git("rev-parse", `${ref}^{commit}`)).trim(), commit, `${ref} moved`);
  const oldRoot = await extract(commit, packagePath, join(root, "old"));
  const oldSource = id === "video-studio"
    ? await extract(commit, "apps/video-studio", join(root, "source-model")) : oldRoot;
  const source = join(root, "reviewed-source");
  await replaceSource(source, oldRoot);
  const review = await core.previewLocalPanelApp({ kind: "dir", path: source });
  assert.equal(review.id, id);
  const old = await core.installReviewedLocalPanelApp({ kind: "dir", path: source }, review.reviewToken,
    "2026-10-11T00:00:00.000Z", { overwrite: index === 2 });
  assert.deepEqual(old.permissions, review.permissions);
  const project = join(root, "project-A"), other = join(root, "project-B");
  const oldSelected = await pin(project, old);
  await pin(other, old);
  const oldContext = context(project, oldSelected, oldSource);
  const scenario = await dataScenario(id, oldContext, root);
  const otherContext = context(other, oldSelected, oldSource);
  await scenario.verifyEmpty(otherContext);

  // Changing bytes after review must be rejected even for an unchanged version string.
  const pendingReview = await core.previewInstalledPanelAppUpdate(id);
  const candidateRoot = join(repositoryRoot, packagePath);
  await replaceSource(source, candidateRoot);
  await assert.rejects(core.installReviewedPanelAppUpdate(id, pendingReview.reviewToken,
    "2026-10-12T00:00:00.000Z"), core.PanelAppReviewChangedError);
  assert.equal((await core.listInstalledPanelApps(id))[0].packageDigest, old.packageDigest);
  const { app: current, review: upgradeReview } = await update(id, source, candidateRoot);
  assert.notEqual(current.packageDigest, old.packageDigest, `${id} must exercise different package bytes`);
  // Installation never silently advances either project's reviewed selection.
  assert.equal((await core.listProjectPanelApps(project, id))[0].packageDigest, old.packageDigest);
  assert.equal((await core.listProjectPanelApps(other, id))[0].packageDigest, old.packageDigest);
  await scenario.verifyEmpty(otherContext);
  await scenario.verifyOld(oldContext);
  const selected = await pin(project, current);
  await assert.rejects(oldContext.assertAuthorized());
  if (old.permissions.includes("storage"))
    await assert.rejects(oldContext.call("storage.get", { key: "upgrade-authority-probe" }), /authoriz|revok|permission/i);
  const currentContext = context(project, selected, candidateRoot);
  await scenario.upgrade(currentContext);
  restart();
  await scenario.verifyCurrent(currentContext);
  await scenario.prepareRollback(currentContext);
  const { app: rolledBack } = await update(id, source, oldRoot);
  assert.equal(rolledBack.packageDigest, old.packageDigest, "rollback installs exact retained old bytes");
  const restored = context(project, await pin(project, rolledBack), oldSource);
  restart();
  await scenario.verifyOld(restored);
  // Upgraded content remains archived and the candidate package remains resolvable.
  const retained = await core.listRetainedPanelAppPackages(id);
  assert.ok(retained.packages.some(app => app.packageDigest === current.packageDigest));
  assert.equal((await core.resolvePanelAppPackage(id, current.packageDigest)).packageDigest, current.packageDigest);
  const { app: upgradedAgain } = await update(id, source, candidateRoot);
  assert.equal(upgradedAgain.packageDigest, current.packageDigest);
  const reopened = context(project, await pin(project, upgradedAgain), candidateRoot);
  restart();
  await scenario.verifyReupgrade(reopened);
  reports.push({ id, old: { ref, commit, version: old.version, packageDigest: old.packageDigest,
    sourceKind: ref.includes("-v") ? "git-tag-package" : "historical-repository-package" },
    candidate: { version: current.version, packageDigest: current.packageDigest },
    permissionsAdded: current.permissions.filter(value => !old.permissions.includes(value)),
    permissionsRemoved: old.permissions.filter(value => !current.permissions.includes(value)),
    reviewedPermissions: upgradeReview.permissions,
    commonChecks: ["review token rejects changed source", "project pins remain old after global update",
      "independent project stays empty", "old scope revoked after project update", "exact old digest rollback",
      "candidate content retained", "uninstall revokes execution authority"], checks: scenario.checks,
    rollback: "exact-old-package-and-pre-upgrade-data; upgraded-content-archived" });
  console.log(`PASS ${id} ${old.version} -> ${current.version} -> ${old.version} -> ${current.version}: ${scenario.checks.join(", ")}`);
  await core.uninstallPanelApp(id);
  assert.deepEqual(await core.listProjectPanelApps(project, id), [], "retained bytes do not authorize an uninstalled Panel");
  await assert.rejects(reopened.assertAuthorized());
  if (current.permissions.includes("storage"))
    await assert.rejects(reopened.call("storage.get", { key: "upgrade-authority-probe" }), /authoriz|revok|permission/i);
}
const hostHead = spawnSync("git", ["-C", resolve(serverRoot, "../.."), "rev-parse", "HEAD"], { encoding: "utf8" });
await writeFile(reportPath, JSON.stringify({ hostCheckoutManifestVersion,
  // A checkout may have advanced since a build. Do not mislabel it as build provenance.
  hostCheckoutCommit: hostHead.status === 0 ? hostHead.stdout.trim() : null,
  hostRuntimeEntrySHA256: createHash("sha256").update(await readFile(join(serverRoot, "dist/panels/runtime-services.js"))).digest("hex"),
  coreInstallerEntrySHA256: createHash("sha256").update(await readFile(resolve(serverRoot, "../core/dist/panel-apps/installer.js"))).digest("hex"),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  candidateCommit: String(git("rev-parse", "HEAD")).trim(), cases: reports,
  boundary: "Temporary local Node Host/Core integration and domain adapters; no desktop shell, physical phone, deployed Cloud, provider requests or native download/model execution" }, null, 2) + "\n");
