import { resolve } from "node:path";
import { acquireOwnerLock } from "./owner-lock.mjs";

// Reviewed short-lived collectors share process authority even when callers
// belong to different webviews. Querying a committed snapshot is always read-only.
export async function runCollector(key, argv, work, { root = process.cwd(), hooks } = {}) {
  if (argv.includes("--read-local") || argv.includes("--help")) return work();
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(key)) throw new Error("COLLECTOR_KEY_INVALID");
  const lock = await acquireOwnerLock(resolve(root, ".quant-collector-locks-v2", key), { hooks });
  if (!lock.acquired) throw Object.assign(new Error("另一个窗口正在更新同类行情，已保留快照，请稍后读取共享结果。"), { code: "QUANT_COLLECTOR_BUSY" });
  try { return await work(); } finally { await lock.release(); }
}
