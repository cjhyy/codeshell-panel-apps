import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot } from "./panel-projects.mjs";

const candidateCore = resolve(process.argv[2]);
const root = await mkdtemp(join(tmpdir(), "quant-background-upgrade-"));
try {
  const old = join(root, "old"); await mkdir(old);
  // Immutable pre-services fixture; HEAD becomes the candidate after commit.
  const archive = spawnSync("git", ["archive", "84348855be8ae4e5a31936b3c2b0d1d21410bd64", "apps/quant-lab"], { cwd: repositoryRoot, maxBuffer: 64 << 20 });
  assert.equal(archive.status, 0, String(archive.stderr));
  const unpack = spawnSync("tar", ["-xf", "-", "-C", old], { input: archive.stdout });
  assert.equal(unpack.status, 0, String(unpack.stderr));
  const script = join(root, "check.mjs");
  await writeFile(script, `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const core = await import(process.argv[2]);
const oldPath = process.argv[3], nextPath = process.argv[4];
const preview = await core.previewLocalPanelApp({kind:'dir',path:oldPath});
const before = await core.installReviewedLocalPanelApp({kind:'dir',path:oldPath}, preview.reviewToken, '2026-10-27T00:00:00.000Z');
if(process.argv[5] === 'old') {
  await assert.rejects(core.previewLocalPanelApp({kind:'dir',path:nextPath}), /background|permission|Unrecognized|Invalid/i);
  const after = (await core.listInstalledPanelApps()).find(app => app.id==='quant-lab');
  assert.equal(after.packageDigest,before.packageDigest); assert.equal(after.version,'0.47.0');
  console.log('PASS old strict Host rejects service manifest and retains installed Quant 0.47.0');
} else {
  const next = await core.previewLocalPanelApp({kind:'dir',path:nextPath});
  assert(next.permissions.includes('background.services'));
  assert(next.permissions.includes('resources'));
  assert(!before.permissions.includes('resources'));
  const preConsent = (await core.listInstalledPanelApps()).find(app => app.id==='quant-lab');
  assert.equal(preConsent.packageDigest,before.packageDigest,'previewing added resources grant cannot replace the current package');
  assert(!before.permissions.includes('background.services'));
  const installed = await core.installReviewedLocalPanelApp({kind:'dir',path:nextPath},next.reviewToken,'2026-10-28T00:00:00.000Z',{overwrite:true});
  assert.equal(installed.version,'0.51.0'); assert(installed.backgroundServices['market-feed']);
  const rollback = await core.previewLocalPanelApp({kind:'dir',path:oldPath});
  const restored = await core.installReviewedLocalPanelApp({kind:'dir',path:oldPath},rollback.reviewToken,'2026-10-28T01:00:00.000Z',{overwrite:true});
  assert.equal(restored.packageDigest,before.packageDigest); assert(!restored.permissions.includes('background.services')); assert(!restored.permissions.includes('resources'));
  console.log('PASS candidate reviewed permission upgrade and reviewed package rollback preserve exact identities');
}
`);
  for (const [label, module] of [["old", join(repositoryRoot, "node_modules/@cjhyy/code-shell-core/dist/index.js")], ["candidate", join(candidateCore, "dist/index.js")]]) {
    const home = join(root, `home-${label}`); await mkdir(home);
    const child = spawnSync(process.execPath, [script, pathToFileURL(module).href, join(old, "apps/quant-lab"), join(repositoryRoot, "apps/quant-lab"), label], { cwd: root, env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, LANG: "C.UTF-8", ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}) }, encoding: "utf8", timeout: 60000 });
    process.stdout.write(child.stdout ?? ""); process.stderr.write(child.stderr ?? "");
    assert.equal(child.status, 0, `${label} upgrade failed`);
  }
} finally { await rm(root, { recursive: true, force: true }); }
