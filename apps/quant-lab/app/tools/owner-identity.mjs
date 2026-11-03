import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { promisify } from "node:util";

const execute = promisify(execFile);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const START = /^(?:linux-ticks:\d+|darwin-unique:\d+:\d+)$/u;
const command = async (file, args, maxBuffer = 4096) => (await execute(file, args, {
  encoding: "utf8", timeout: 2000, killSignal: "SIGKILL", maxBuffer,
})).stdout;

// These are local kernel/machine identities, never a hostname or wall-clock boot
// estimate. Inspection is asynchronous so a waiting publisher cannot block the
// event loop of the publisher that currently owns the lock.
async function readSystemIdentity() {
  let boot = null, machine = null;
  if (process.platform === "linux") {
    [boot, machine] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8").catch(() => null),
      readFile("/etc/machine-id", "utf8").catch(() => null),
    ]);
  } else if (process.platform === "darwin") {
    [boot, machine] = await Promise.all([
      command("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"]).catch(() => null),
      command("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], 65536)
        .then(value => value.match(/"IOPlatformUUID"\s*=\s*"([a-f0-9-]+)"/iu)?.[1] ?? null).catch(() => null),
    ]);
  }
  boot = boot?.trim().toLowerCase(); machine = machine?.trim().toLowerCase();
  return {
    boot: UUID.test(boot ?? "") ? `${process.platform}:${boot}` : null,
    machine: /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/u.test(machine ?? "")
      ? createHash("sha256").update(`${process.platform}:${machine}`).digest("hex") : null,
  };
}

export function parseOwnerLinuxStat(value) {
  const fields = String(value).slice(String(value).lastIndexOf(")") + 2).trim().split(/\s+/u);
  if (!/^[A-Zt]$/u.test(fields[0] ?? "") || !/^\d+$/u.test(fields[19] ?? "")) return null;
  return { state: fields[0], start: `linux-ticks:${fields[19]}` };
}

async function readProcessIdentity(pid) {
  try {
    if (process.platform === "linux") return parseOwnerLinuxStat(await readFile(`/proc/${pid}/stat`, "utf8"));
    if (process.platform !== "darwin") return null;
    // PROC_PIDUNIQIDENTIFIERINFO returns the kernel's unique process ID and
    // exec version. ps/lstart timestamps cannot distinguish rapid PID reuse.
    const info = JSON.parse(await command("/usr/bin/osascript", ["-l", "JavaScript", "-e", `
      ObjC.import("Foundation");
      ObjC.bindFunction("proc_pidinfo", ["int", ["int", "int", "uint64", "void *", "int"]]);
      var data = $.NSMutableData.dataWithLength(56);
      var count = $.proc_pidinfo(${pid}, 17, 0, data.mutableBytes, 56);
      JSON.stringify({count: count, data: ObjC.unwrap(data.base64EncodedStringWithOptions(0))});
    `]));
    const bytes = Buffer.from(info.data, "base64");
    if (info.count !== 56 || bytes.length !== 56 || !bytes.readBigUInt64LE(16)) return null;
    return { start: `darwin-unique:${bytes.readBigUInt64LE(16)}:${bytes.readUInt32LE(32)}`, state: "R" };
  } catch { return null; }
}

function probeProcess(pid) {
  try { process.kill(pid, 0); return "present"; }
  catch (error) { return error.code === "ESRCH" ? "absent" : "unknown"; }
}

export function createOwnerIdentityReader({ system = readSystemIdentity, inspect = readProcessIdentity,
  probe = probeProcess, host = hostname, now = () => performance.now() } = {}) {
  let systemPromise, retryAt = 0, complete = false;
  let selfPromise, selfRetryAt = 0;
  const local = () => {
    if (!systemPromise || (!complete && now() >= retryAt)) {
      retryAt = now() + 1000;
      systemPromise = Promise.resolve().then(system).catch(() => ({ boot: null, machine: null }))
        .then(value => { complete = Boolean(value.boot && value.machine); return value; });
    }
    return systemPromise;
  };
  const capture = async () => {
    if (!selfPromise || now() >= selfRetryAt) {
      selfRetryAt = now() + 1000;
      selfPromise = Promise.all([local(), Promise.resolve().then(() => inspect(process.pid))]).then(([identity, processIdentity]) => {
        if (identity.boot && identity.machine && START.test(processIdentity?.start ?? "")) selfRetryAt = Infinity;
        return { ...identity, start: processIdentity?.start ?? null };
      }).catch(() => ({ boot: null, machine: null, start: null }));
    }
    return selfPromise;
  };
  const status = async (owner) => {
    if (!owner || owner.unknown || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return { status: "unknown", reason: "invalid-owner" };
    const identity = owner.identity;
    if (!identity?.boot) {
      // Old owner-lock/1 records are readable, but without OS identity neither
      // a hostname change nor a present/reused PID can prove the owner is dead.
      if (owner.hostname !== host()) return { status: "unknown", reason: "legacy-host-unverified" };
      return probe(owner.pid) === "absent" ? { status: "dead", reason: "legacy-pid-absent" }
        : { status: "unknown", reason: "legacy-process-unverified" };
    }
    const current = await local();
    if (!current.boot || (identity.machine && current.machine && identity.machine !== current.machine)) return { status: "unknown", reason: "machine-unverified" };
    if (identity.boot !== current.boot) return identity.machine && identity.machine === current.machine
      ? { status: "dead", reason: "previous-local-boot" } : { status: "unknown", reason: "boot-locality-unverified" };
    const pidStatus = probe(owner.pid);
    if (pidStatus === "absent") return { status: "dead", reason: "pid-absent" };
    if (pidStatus !== "present") return { status: "unknown", reason: "pid-inspection-denied" };
    const actual = await Promise.resolve().then(() => inspect(owner.pid)).catch(() => null);
    if (actual && ["Z", "X"].includes(actual.state)) return { status: "dead", reason: "process-exited" };
    if (!START.test(identity.start ?? "") || !START.test(actual?.start ?? "")) return { status: "unknown", reason: "process-start-unverified" };
    return actual.start === identity.start ? { status: "alive", reason: "same-process" } : { status: "dead", reason: "pid-reused" };
  };
  return { capture, status };
}

export const ownerIdentity = createOwnerIdentityReader();
