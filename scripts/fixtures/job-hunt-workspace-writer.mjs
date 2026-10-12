// Separate-process acceptance worker. Pauses the real commit primitive after
// its final revision check; production adapters expose no test-only hooks.
import fs from "node:fs";
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const target = join(fs.realpathSync(config.project), "job-hunt-panel.json");
const matchesTarget = path => {
  if (typeof path !== "string") return false;
  try { return fs.realpathSync(path) === target; }
  catch { return resolve(path) === target; }
};
const touch = path => fs.writeFileSync(path, "ready");
const commonLock = path => typeof path === "string" && /\/\.codeshell-workspace-write-[0-9a-f]{64}\.lock$/u.test(path);
const originalMkdir = fs.mkdirSync, originalAsyncMkdir = filesystem.mkdir;
fs.mkdirSync = function (path, ...args) {
  try { return originalMkdir.call(this, path, ...args); }
  catch (error) {
    if (error.code === "EEXIST" && commonLock(path)) touch(config.contendedMarker);
    throw error;
  }
};
filesystem.mkdir = async function (path, ...args) {
  try { return await originalAsyncMkdir.call(this, path, ...args); }
  catch (error) {
    if (error.code === "EEXIST" && commonLock(path)) touch(config.contendedMarker);
    throw error;
  }
};
const descriptors = new Map();
const originalOpen = fs.openSync, originalRead = fs.readFileSync, originalClose = fs.closeSync;
fs.openSync = function (path, ...args) {
  const fd = originalOpen.call(this, path, ...args);
  if (matchesTarget(path)) descriptors.set(fd, true);
  return fd;
};
fs.readFileSync = function (path, ...args) {
  const value = originalRead.call(this, path, ...args);
  if (config.readMarker && descriptors.has(path)) touch(config.readMarker);
  return value;
};
fs.closeSync = function (fd, ...args) {
  descriptors.delete(fd);
  return originalClose.call(this, fd, ...args);
};
const originalRename = fs.renameSync, originalAsyncRename = filesystem.rename;
const pauseSync = () => {
  touch(config.stageMarker);
  const deadline = Date.now() + 10_000, sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(config.releaseMarker)) {
    if (Date.now() > deadline) throw Error("test commit barrier timed out");
    Atomics.wait(sleeper, 0, 0, 10);
  }
};
fs.renameSync = function (from, to, ...args) {
  if (config.stageMarker && matchesTarget(to)) pauseSync();
  return originalRename.call(this, from, to, ...args);
};
filesystem.rename = async function (from, to, ...args) {
  if (config.stageMarker && matchesTarget(to)) {
    touch(config.stageMarker);
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(config.releaseMarker)) {
      if (Date.now() > deadline) throw Error("test commit barrier timed out");
      await new Promise(done => setTimeout(done, 10));
    }
  }
  return originalAsyncRename.call(this, from, to, ...args);
};
syncBuiltinESMExports();
touch(config.startedMarker);
try {
  let result;
  if (config.role === "host") {
    const { PanelRuntimeServices } = await import(pathToFileURL(join(config.serverRoot, "dist/panels/runtime-services.js")).href);
    const service = new PanelRuntimeServices({ dataDir: config.dataDir });
    result = await service.call({
      appId: "job-hunt-hq", cwd: config.project, projectPath: config.project,
      permissions: ["context.workspace", "workspace.read", "workspace.write"], isAuthorized: async () => true,
    }, "workspace.writeText", config.params);
  } else if (config.role === "node") {
    const { createNodeWorkspaceScope } = await import(pathToFileURL(join(config.packageRoot, "app/tools/node-workspace-scope.mjs")).href);
    const scope = await createNodeWorkspaceScope(config.project);
    result = await scope.call("workspace.writeText", config.params);
  } else if (config.role === "cli") {
    const { main } = await import(pathToFileURL(join(config.packageRoot, "app/tools/job-hunt.mjs")).href);
    result = await main(config.args, { cwd: config.project });
  } else throw Error("unknown acceptance worker role");
  process.stdout.write(JSON.stringify({ ok: true, result }) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: { code: error.code, message: error.message } }) + "\n");
}
