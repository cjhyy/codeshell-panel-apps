import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdir, open, readFile, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";

// The shared directory contains exactly one immutable owner file. Heartbeats
// are diagnostic only; age can NEVER authorize stealing a live owner's lock.
export async function inspectOwnerLock(path) {
  let names;
  try { names = await readdir(path); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (names.length !== 1 || !/^owner-[a-f0-9-]+\.json$/u.test(names[0])) return { unknown: true };
  try {
    const owner = JSON.parse(await readFile(`${path}/${names[0]}`, "utf8"));
    if (owner.format !== "owner-lock/1" || owner.file !== names[0] || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return { unknown: true };
    return owner;
  } catch (error) { if (error.code === "ENOENT") return { unknown: true }; throw error; }
}
export function ownerConfirmedDead(owner) {
  if (!owner || owner.unknown || owner.hostname !== hostname()) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return error.code === "ESRCH"; }
}
async function syncDirectory(path) {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function acquireOwnerLock(path, { metadata = {}, hooks = {}, isDead = ownerConfirmedDead } = {}) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const file = `owner-${token}.json`;
  const stage = `${path}.stage-${token}`;
  const heartbeatPath = `${path}.heartbeat-${token}`;
  const owner = { ...metadata, format: "owner-lock/1", token, file, pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() };
  await mkdir(stage, { mode: 0o700 });
  const handle = await open(`${stage}/${file}`, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(stage);
  let acquired = false;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await rename(stage, path); acquired = true; await syncDirectory(dirname(path)); break; }
      catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error; }
      const old = await inspectOwnerLock(path);
      if (!old || !isDead(old)) return { acquired: false, owner: old };
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
  } finally {
    if (!acquired) {
      await unlink(`${stage}/${file}`).catch((error) => { if (error.code !== "ENOENT") throw error; });
      await rmdir(stage).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }
}
