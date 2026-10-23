import { isSafeDesignPath } from "./document.mjs";

export const MAX_RECENT_DESIGNS = 12;

export function designFileName(path) {
  return String(path ?? "").split("/").at(-1).replace(/\.codesign\.json$/u, "") || "未命名设计";
}

export function recentDesignPaths(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((path) => typeof path === "string" && isSafeDesignPath(path)))].slice(0, MAX_RECENT_DESIGNS);
}

export function rememberDesignPath(paths, path) {
  return recentDesignPaths([path, ...recentDesignPaths(paths)]);
}

/** Recency is navigation metadata; it never changes the file or its saved baseline. */
export function visibleDesignFiles(files, { query = "", recent = [], activePath = "" } = {}) {
  const search = query.trim().toLocaleLowerCase();
  const ranks = new Map(recentDesignPaths(recent).map((path, index) => [path, index]));
  const unique = new Map();
  for (const file of files ?? []) {
    if (!file || !isSafeDesignPath(file.path) || unique.has(file.path)) continue;
    if (search && !`${file.name ?? ""}\n${file.path}`.toLocaleLowerCase().includes(search)) continue;
    unique.set(file.path, file);
  }
  return [...unique.values()].sort((a, b) =>
    Number(b.path === activePath) - Number(a.path === activePath) ||
    (ranks.get(a.path) ?? MAX_RECENT_DESIGNS) - (ranks.get(b.path) ?? MAX_RECENT_DESIGNS) ||
    (Number(b.modifiedAt) || 0) - (Number(a.modifiedAt) || 0) ||
    a.path.localeCompare(b.path),
  );
}
