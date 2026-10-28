import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { acquireOwnerLock } from "./owner-lock.mjs";
import { collectorArguments, resolveLibraryRoot, withNativeDataRoot } from "./native-data-context.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function collectorRequestKey(key, request, scope = "cli", libraryId = null) {
  return createHash("sha256").update(JSON.stringify([key, scope, libraryId, canonical(request)])).digest("hex");
}

// Reviewed short-lived collectors share process authority even when callers
// belong to different webviews. Querying a committed snapshot is always read-only.
export async function runCollector(key, argv, work, { root = process.cwd(), hooks, maxConcurrent = 4, normalizeRequest = args => ({ mode: "collect", args }) } = {}) {
  const { args, scope, libraryId } = collectorArguments(argv);
  // The owning CLI parser decides aliases, defaults and read-only mode. A flag
  // used as another flag's value must never bypass mutual exclusion or the pool.
  const request = normalizeRequest(args);
  const readOnly = ["read-local", "help"].includes(request.mode);
  const selectedRoot = await resolveLibraryRoot(root, libraryId, { create: !readOnly });
  const execute = () => withNativeDataRoot(selectedRoot, () => work(args));
  if (readOnly) return execute();
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(key)) throw new Error("COLLECTOR_KEY_INVALID");
  const base = resolve(root, ".quant-collector-locks-v3");
  const lock = await acquireOwnerLock(resolve(base, "requests", collectorRequestKey(key, request, scope, libraryId)), { hooks });
  if (!lock.acquired) throw Object.assign(new Error("另一个窗口正在更新相同请求，已保留快照，请稍后读取共享结果。"), { code: "QUANT_COLLECTOR_BUSY" });
  let slot;
  try {
    for (let index = 0; index < Math.min(4, Math.max(1, maxConcurrent)); index++) {
      const candidate = await acquireOwnerLock(resolve(base, "slots", String(index)));
      if (candidate.acquired) { slot = candidate; break; }
    }
    if (!slot) throw Object.assign(new Error("行情并发已满，请稍后重试；其他请求仍在正常运行。"), { code: "QUANT_COLLECTOR_CAPACITY" });
    return await execute();
  } finally { await slot?.release(); await lock.release(); }
}
