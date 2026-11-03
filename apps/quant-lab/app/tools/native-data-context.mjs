import { AsyncLocalStorage } from "node:async_hooks";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";

const context = new AsyncLocalStorage();
export const nativeDataRoot = () => context.getStore()?.root ?? process.cwd();
export const withNativeDataRoot = (root, work) => context.run({ root }, work);

// The parent is an already-authorized cwd/app-data directory. The browser may
// select an opaque identifier, never a filesystem path or a Host-private root.
export async function resolveLibraryRoot(parent, libraryId, { create = false } = {}) {
  if (libraryId == null) return resolve(parent);
  if (!/^[a-f0-9]{32}$/u.test(libraryId)) throw new Error("HISTORY_LIBRARY_ID_INVALID");
  let current = await realpath(resolve(parent));
  for (const segment of ["quant-history-libraries", "v2", libraryId]) {
    current = resolve(current, segment);
    if (create) await mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(current).catch(error => { if (error.code === "ENOENT" && !create) return null; throw error; });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("HISTORY_LIBRARY_PATH_UNSAFE");
  }
  return current;
}

export function collectorArguments(argv) {
  const args = []; let scope = "cli", libraryId;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--collector-scope") {
      const value = argv[++i];
      if (!/^[a-f0-9]{64}$/u.test(value ?? "") || scope !== "cli") throw new Error("COLLECTOR_SCOPE_INVALID");
      scope = value;
    } else if (argv[i] === "--library-id") {
      if (libraryId !== undefined || !/^[a-f0-9]{32}$/u.test(argv[i + 1] ?? "")) throw new Error("HISTORY_LIBRARY_ID_INVALID");
      libraryId = argv[++i];
    } else args.push(argv[i]);
  }
  return { args, scope, libraryId };
}
