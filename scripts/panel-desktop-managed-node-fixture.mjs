// Test-only Main spawn seam. Does not modify the managed executable or its probes.
import assert from "node:assert/strict";
import children from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { isAbsolute, join } from "node:path";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const policy = "(version 1) (allow default) (deny network*)";

export async function prepareManagedNodeNetworkFixture({ directory, executable }) {
  assert.equal(process.platform, "darwin", "Managed Node OS network fixture requires macOS sandbox-exec");
  assert.ok(isAbsolute(executable));
  const node = await realpath(executable);
  const root = join(directory, "managed-node-network-fixture");
  await mkdir(root, { mode: 0o700 });
  const policyFile = join(root, "network.sb"), receiptFile = join(root, "launches.jsonl");
  await writeFile(policyFile, policy + "\n", { mode: 0o600 });
  const spec = { node, nodeSha256: sha256(await readFile(node)), policyFile, receiptFile };
  return {
    spec,
    bootstrap: `await (await import(${JSON.stringify(import.meta.url)})).installManagedNodeNetworkBoundary(${JSON.stringify(spec)});\n`,
    async receipts() {
      return (await readFile(receiptFile, "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw error; }))
        .trim().split("\n").filter(Boolean).map(JSON.parse);
    },
  };
}

/** Install BEFORE confined-electron-fixture captures children.spawn, preserving its worker hook. */
export function installManagedNodeNetworkBoundary(spec) {
  assert.equal(process.platform, "darwin");
  assert.equal(realpathSync(spec.node), spec.node);
  assert.equal(sha256(readFileSync(spec.node)), spec.nodeSha256);
  assert.equal(readFileSync(spec.policyFile, "utf8").trim(), policy);
  const original = children.spawn;
  const log = value => appendFileSync(spec.receiptFile, JSON.stringify({ at: Date.now(), parentPid: process.pid, ...value }) + "\n", { mode: 0o600 });
  const wrapped = function (command, args, options) {
    let matching = false;
    if (typeof command === "string" && isAbsolute(command)) {
      try { matching = realpathSync(command) === spec.node; }
      catch { /* Preserve the original spawn error for an unrelated command. */ }
    }
    if (!matching) return original.call(this, command, args, options);
    assert.ok(Array.isArray(args), "Managed runtime fixture expects explicit spawn argv");
    assert.equal(sha256(readFileSync(spec.node)), spec.nodeSha256, "Signed managed Node bytes changed");
    const child = original.call(this, "/usr/bin/sandbox-exec", ["-f", spec.policyFile, command, ...args], options);
    log({ event: "spawn", pid: child.pid, executable: command, nodeSha256: spec.nodeSha256,
      argvSha256: sha256(JSON.stringify(args)), argvCount: args.length,
      detached: options?.detached === true, stdio: options?.stdio, nodeOptionsPresent: options?.env?.NODE_OPTIONS !== undefined });
    // Observing emit preserves the production custody reader's only listener and
    // its exact byte stream. It neither starts flowing nor consumes FD 3 early.
    const fd = child.stdio?.[3];
    if (fd) {
      const emit = fd.emit;
      let pending = "", bytes = 0;
      fd.emit = function (event, ...values) {
        if (event === "data") {
          bytes += Buffer.byteLength(values[0]);
          if (bytes <= 8192) {
            pending += Buffer.from(values[0]).toString("utf8");
            let end;
            while ((end = pending.indexOf("\n")) >= 0) {
              const line = pending.slice(0, end); pending = pending.slice(end + 1);
              try {
                const frame = JSON.parse(line);
                if (frame.t === "custody" || frame.t === "member")
                  log({ event: "custody", pid: child.pid, frame });
              } catch { log({ event: "invalid-custody-json", pid: child.pid }); }
            }
          } else log({ event: "custody-observation-limit", pid: child.pid });
        }
        return emit.call(this, event, ...values);
      };
    }
    child.once("error", error => log({ event: "spawn-error", pid: child.pid, code: error.code }));
    child.once("close", (code, signal) => log({ event: "close", pid: child.pid, code, signal }));
    return child;
  };
  children.spawn = wrapped;
  syncBuiltinESMExports();
  return () => {
    assert.equal(children.spawn, wrapped, "A later fixture hook must restore itself first");
    children.spawn = original;
    syncBuiltinESMExports();
  };
}
