import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { ownerIdentity } from "./owner-identity.mjs";

const TOKEN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;

// The shared directory contains exactly one immutable owner file. Heartbeats
// are diagnostic only; age can NEVER authorize stealing a live owner's lock.
export async function inspectOwnerLock(path) {
  let names;
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) return { unknown: true, reason: "unsafe-directory" };
    names = await readdir(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (names.length !== 1 || !/^owner-[a-f0-9-]+\.json$/u.test(names[0])) return { unknown: true, reason: "invalid-owner-files" };
  try {
    const handle = await open(`${path}/${names[0]}`, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > 16384) return { unknown: true, reason: "unsafe-owner-file" };
      const owner = JSON.parse(await handle.readFile("utf8"));
      if (!owner || owner.format !== "owner-lock/1" || !TOKEN.test(owner.token ?? "") || owner.file !== `owner-${owner.token}.json` || owner.file !== names[0] || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return { unknown: true, reason: "invalid-owner-record" };
      if (owner.identity && ((owner.identity.boot != null && !/^(?:linux|darwin):[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(owner.identity.boot)) ||
        (owner.identity.machine != null && !/^[a-f0-9]{64}$/u.test(owner.identity.machine)) ||
        (owner.identity.start != null && !/^(?:darwin-unique:\d+:\d+|linux-ticks:\d+)$/u.test(owner.identity.start)))) return { unknown: true, reason: "invalid-owner-identity" };
      return owner;
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof SyntaxError || ["ENOENT", "ELOOP"].includes(error.code)) return { unknown: true, reason: "unreadable-owner-record" };
    throw error;
  }
}
export async function ownerConfirmedDead(owner) {
  return (await ownerIdentity.status(owner)).status === "dead";
}
export async function diagnoseOwnerLock(path, { identity = ownerIdentity } = {}) {
  const owner = await inspectOwnerLock(path);
  return owner ? { owner, ...await identity.status(owner) } : { owner: null, status: "unlocked", reason: "owner-absent" };
}
async function syncDirectory(path) {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function acquireOwnerLock(path, { metadata = {}, hooks = {}, identity = ownerIdentity,
  isDead = async owner => (await identity.status(owner)).status === "dead" } = {}) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const file = `owner-${token}.json`;
  const stage = `${path}.stage-${token}`;
  const heartbeatPath = `${path}.heartbeat-${token}`;
  const owner = { ...metadata, format: "owner-lock/1", token, file, pid: process.pid, hostname: hostname(),
    identity: await identity.capture(), startedAt: new Date().toISOString() };
  let acquired = false, staged = false;
  try {
    await mkdir(stage, { mode: 0o700 }); staged = true;
    const handle = await open(`${stage}/${file}`, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(owner)); await handle.sync();
      await hooks.afterOwnerWrite?.();
    } finally { await handle.close(); }
    await syncDirectory(stage);
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await rename(stage, path); acquired = true; await syncDirectory(dirname(path)); break; }
      catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error; }
      const old = await inspectOwnerLock(path);
      if (!old || old.unknown || !await isDead(old)) return { acquired: false, owner: old };
      await hooks.afterOwnerCheck?.(old);
      await hooks.beforeUnlink?.(old);
      try { await unlink(`${path}/${old.file}`); }
      catch (error) { if (error.code === "ENOENT") return { acquired: false, owner: await inspectOwnerLock(path) }; throw error; }
      await unlink(`${path}.heartbeat-${old.token}`).catch((error) => { if (error.code !== "ENOENT") throw error; });
      await hooks.beforeRmdir?.(old);
      try { await rmdir(path); }
      catch (error) { if (["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) return { acquired: false, owner: await inspectOwnerLock(path) }; throw error; }
    }
    if (!acquired) return { acquired: false, owner: await inspectOwnerLock(path) };
    let released = false;
    let inFlight = Promise.resolve();
    return {
      acquired: true, owner,
      async assertOwned() {
        if (released || (await inspectOwnerLock(path))?.token !== token) throw new Error("OWNER_LOCK_LOST");
      },
      heartbeat(value = new Date().toISOString()) {
        if (released) return Promise.resolve(false);
        const pending = inFlight.then(async () => {
          await hooks.beforeHeartbeat?.();
          const heartbeat = await open(heartbeatPath, "w", 0o600);
          try { await heartbeat.writeFile(String(value)); } finally { await heartbeat.close(); }
          await hooks.afterHeartbeat?.();
          return true;
        });
        inFlight = pending.catch(() => undefined);
        return pending;
      },
      async release() {
        if (released) return false;
        released = true;
        await inFlight;
        await unlink(heartbeatPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
        try { await unlink(`${path}/${file}`); } catch (error) { if (error.code === "ENOENT") return false; throw error; }
        await hooks.beforeRmdir?.(owner);
        await rmdir(path).catch((error) => { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; });
        return true;
      },
    };
  } catch (error) {
    // If publication/fsync failed before the handle was returned, remove only
    // this token; never leave an apparently live lock owned by an idle caller.
    if (acquired) {
      await unlink(`${path}/${file}`).catch(() => undefined);
      await rmdir(path).catch(() => undefined);
    }
    throw error;
  } finally {
    if (!acquired && staged) {
      await unlink(`${stage}/${file}`).catch((error) => { if (error.code !== "ENOENT") throw error; });
      await rmdir(stage).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }
}
