// Test-only parent observation. The Host still owns, spawns and terminates its child.
import assert from "node:assert/strict";
import children from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readSync, realpathSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const contracts = new Map();
const inside = (root, path) => {
  const child = relative(root, path);
  return child && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

async function loadContract(spec) {
  if (!spec.packageContentModule) return;
  assert.equal(sha256(readFileSync(fileURLToPath(spec.packageContentModule))), spec.packageContentModuleSha256);
  contracts.set(spec.packageContentModule, await import(spec.packageContentModule));
}

function flatSnapshot(spec, root) {
  const contract = contracts.get(spec.packageContentModule);
  assert.ok(contract, "Flat NativeEntry observation requires the actual frozen Host package-content module");
  const limits = contract.PANEL_PACKAGE_LIMITS, files = [];
  let entries = 0, total = 0, manifestBytes;
  const walk = (directory, prefix = "", depth = 0) => {
    assert.ok(depth <= limits.depth, "Flat package is too deep");
    const info = lstatSync(directory);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), "Flat package directories must be ordinary directories");
    for (const name of readdirSync(directory)) {
      assert.ok(++entries <= limits.entries, "Flat package has too many entries");
      const path = join(directory, name), child = lstatSync(path);
      assert.ok(!child.isSymbolicLink(), "Flat package must not contain symlinks");
      if (child.isDirectory()) walk(path, prefix + name + "/", depth + 1);
      else { assert.ok(child.isFile(), "Flat package has an unsafe entry"); files.push(prefix + name); }
    }
  };
  walk(root);
  const hash = contract.createPanelPackageHash();
  for (const file of files.sort()) {
    const fd = openSync(join(root, ...file.split("/")), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = fstatSync(fd);
      assert.ok(info.isFile() && info.size <= limits.fileBytes && total + info.size <= limits.bytes, "Flat package exceeds its byte limit");
      const bytes = Buffer.alloc(info.size + 1);
      let offset = 0;
      while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); if (!count) break; offset += count; }
      assert.equal(offset, info.size, "Flat package changed while reading");
      total += offset;
      const content = bytes.subarray(0, offset);
      contract.hashPanelPackageFile(hash, file, content);
      if (file === ".codeshell-panel/panel.json") manifestBytes = content;
    } finally { closeSync(fd); }
  }
  assert.ok(manifestBytes, "Flat package manifest is missing");
  return { packageDigest: hash.digest("hex"), manifest: JSON.parse(manifestBytes.toString("utf8")), manifestSha256: sha256(manifestBytes) };
}

function declaration(spec, path) {
  if (!inside(spec.namespaceRoot, path)) return;
  const parts = relative(spec.namespaceRoot, path).split(sep), retained = parts[0] === ".versions";
  const [, retainedId, packageDigest] = parts;
  if (retained && !/^[a-f0-9]{64}$/u.test(packageDigest ?? "")) return;
  const appId = retained ? retainedId : parts[0], entry = parts.slice(retained ? 3 : 1);
  const declared = spec.entries.find(value => value.appId === appId && value.entry === entry.join("/"));
  if (!declared) return;
  if (retained) return { ...declared, packageDigest, layout: "retained" };
  const snapshot = flatSnapshot(spec, join(spec.namespaceRoot, appId));
  assert.equal(snapshot.manifest.id, appId);
  assert.equal(snapshot.manifestSha256, declared.manifestSha256, "Flat installed manifest differs from reviewed bytes");
  assert.ok(Object.values(snapshot.manifest.nativeEntries ?? {}).some(value => value.entry === declared.entry && value.sha256 === declared.sha256),
    "Flat NativeEntry is not declared by its actual installed manifest");
  return { ...declared, packageDigest: snapshot.packageDigest, layout: "flat", manifestSha256: snapshot.manifestSha256 };
}

export async function prepareNativeEntryParentObservation({ directory, receiptFile, executablePaths, namespaceRoot, entries, packageContentModule }) {
  assert.equal(process.platform, "darwin");
  const root = await realpath(directory);
  const namespace = await realpath(namespaceRoot);
  const receipts = await realpath(receiptFile);
  assert.ok(inside(root, namespace) && inside(root, receipts), "Parent observer must stay inside the private fixture");
  const executables = await Promise.all(executablePaths.map(async path => {
    const canonical = await realpath(path);
    assert.ok(inside(root, canonical), "Parent observer may only match private fixture wrappers");
    return { path: canonical, sha256: sha256(await readFile(canonical)) };
  }));
  const spec = { receiptFile: receipts, namespaceRoot: namespace, executables, entries };
  if (packageContentModule) {
    spec.packageContentModule = packageContentModule;
    spec.packageContentModuleSha256 = sha256(await readFile(fileURLToPath(packageContentModule)));
    await loadContract(spec);
  }
  return { spec,
    bootstrap: `await (await import(${JSON.stringify(import.meta.url)})).installNativeEntryParentObservation(${JSON.stringify(spec)});\n` };
}

/** Install before later Main fixture hooks capture children.spawn. */
export async function installNativeEntryParentObservation(spec) {
  assert.equal(process.platform, "darwin");
  await loadContract(spec);
  const original = children.spawn;
  const wrapped = function (command, args, options) {
    let executable;
    if (typeof command === "string" && isAbsolute(command)) {
      try { executable = spec.executables.find(value => value.path === realpathSync(command)); }
      catch { /* Preserve the original error of an unrelated spawn. */ }
    }
    if (!executable || !Array.isArray(args)) return original.call(this, command, args, options);
    assert.equal(sha256(readFileSync(executable.path)), executable.sha256, "Private Node wrapper changed");
    let observed;
    for (const argument of args) {
      if (typeof argument !== "string" || !isAbsolute(argument)) continue;
      let canonical;
      try { canonical = realpathSync(argument); } catch { continue; }
      const declared = declaration(spec, canonical);
      if (!declared) continue;
      assert.equal(sha256(readFileSync(canonical)), declared.sha256, "Parent observed unreviewed NativeEntry bytes");
      assert.equal(observed, undefined, "Ambiguous NativeEntry argv");
      observed = { entry: argument, entryRealPath: canonical, entrySha256: declared.sha256,
        appId: declared.appId, packageDigest: declared.packageDigest, layout: declared.layout,
        ...(declared.manifestSha256 ? { manifestSha256: declared.manifestSha256 } : {}),
        executable: executable.path, executableSha256: executable.sha256 };
    }
    const child = original.call(this, command, args, options);
    if (!observed) return child; // Version probes are not NativeEntry executions.
    const log = value => appendFileSync(spec.receiptFile, JSON.stringify({ at: Date.now(),
      pid: child.pid, ppid: process.pid, ...observed, ...value }) + "\n", { mode: 0o600 });
    log({ event: "entry-parent-start" });
    child.once("error", error => log({ event: "entry-parent-error", code: error.code }));
    child.once("close", (code, signal) => log({ event: "entry-parent-close", code, signal }));
    return child;
  };
  children.spawn = wrapped;
  syncBuiltinESMExports();
  return () => {
    assert.equal(children.spawn, wrapped, "Restore later fixture spawn hooks first");
    children.spawn = original;
    syncBuiltinESMExports();
  };
}

/** JS exit logs cannot run after a default signal termination. Require parent custody too. */
export function verifyNativeEntryExit({ started, receipts, observation, mainPid, selfTest }) {
  assert.ok(Number.isSafeInteger(started.pid) && started.pid > 1, "NativeEntry must have a captured positive PID");
  const ownSelfTest = started.pid === selfTest?.pid && started.entrySha256 === selfTest.entrySha256;
  let reviewed;
  if (!ownSelfTest) {
    reviewed = declaration(observation, realpathSync(started.entry));
    assert.ok(reviewed, `NativeEntry escaped the owned reviewed namespace: ${JSON.stringify(started)}`);
    assert.equal(started.entrySha256, reviewed.sha256);
  }
  const exit = receipts.find(value => value.event === "entry-exit" && value.pid === started.pid);
  const parentStart = receipts.find(value => value.event === "entry-parent-start" && value.pid === started.pid);
  const parentClose = receipts.find(value => value.event === "entry-parent-close" && value.pid === started.pid);
  if (started.ppid === mainPid || !exit) {
    assert.ok(parentStart && parentClose, `NativeEntry lacks captured parent close custody: ${JSON.stringify(started)}`);
    for (const receipt of [parentStart, parentClose]) {
      assert.equal(receipt.ppid, started.ppid);
      assert.equal(receipt.entry, started.entry);
      assert.equal(receipt.entryRealPath, realpathSync(started.entry));
      assert.equal(receipt.entrySha256, started.entrySha256);
      assert.equal(receipt.appId, parentStart.appId);
      assert.equal(receipt.layout, parentStart.layout);
      assert.match(receipt.packageDigest, /^[a-f0-9]{64}$/u);
      assert.equal(receipt.packageDigest, parentStart.packageDigest);
      assert.equal(receipt.manifestSha256, parentStart.manifestSha256);
      if (reviewed) {
        assert.equal(receipt.appId, reviewed.appId);
        assert.equal(receipt.layout, reviewed.layout);
        assert.equal(receipt.manifestSha256, reviewed.manifestSha256);
        if (reviewed.layout === "retained") assert.equal(receipt.packageDigest, reviewed.packageDigest);
      }
      assert.ok(observation.executables.some(value => value.path === receipt.executable && value.sha256 === receipt.executableSha256));
    }
  }
  if (!exit) {
    assert.equal(parentClose.code, null);
    assert.ok(["SIGTERM", "SIGKILL"].includes(parentClose.signal), "Missing JS exit requires actual parent-observed termination signal");
  } else if (parentClose) {
    assert.equal(parentClose.signal, null);
    assert.equal(parentClose.code, exit.code);
  }
  let absent = false;
  try { process.kill(started.pid, 0); }
  catch (error) { if (error.code === "ESRCH") absent = true; else throw error; }
  assert.equal(absent, true, `NativeEntry PID remains live or unverified: ${started.pid}`);
  return { pid: started.pid, entry: started.entry, entrySha256: started.entrySha256,
    proof: exit ? (parentClose ? "js-exit-and-parent-close" : "js-exit") : "parent-signal-close",
    ...(exit ? { exit } : {}), ...(parentClose ? { parentClose } : {}), osAbsent: true };
}
