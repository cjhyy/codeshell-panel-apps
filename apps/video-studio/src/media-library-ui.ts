import type { Asset } from "./model";

export type MediaView = "large" | "small" | "list";
export type MediaFilter = "all" | Asset["kind"];
export type MediaSort = "original" | "name" | "duration";
export interface MediaLibraryPreferences {
  view: MediaView;
  filter: MediaFilter;
  sort: MediaSort;
}
const key = "video-studio-media-library-view-v1";
const defaults: MediaLibraryPreferences = { view: "large", filter: "all", sort: "original" };
export function readMediaLibraryPreferences(): MediaLibraryPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return {
      view: ["large", "small", "list"].includes(value?.view) ? value.view : "large",
      filter: ["all", "video", "audio", "image", "demo"].includes(value?.filter)
        ? value.filter
        : "all",
      sort: ["original", "name", "duration"].includes(value?.sort) ? value.sort : "original",
    };
  } catch {
    return { ...defaults };
  }
}
export function saveMediaLibraryPreferences(value: MediaLibraryPreferences): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* This view remains usable when preference storage is unavailable. */
  }
}
export function visibleMedia(
  assets: readonly Asset[],
  search: string,
  preferences: MediaLibraryPreferences,
): Asset[] {
  const query = search.trim().toLocaleLowerCase();
  const result = assets.filter(
    (asset) =>
      (preferences.filter === "all" || asset.kind === preferences.filter) &&
      `${asset.name}\n${asset.sourcePath ?? ""}`.toLocaleLowerCase().includes(query),
  );
  if (preferences.sort === "name")
    result.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  if (preferences.sort === "duration") result.sort((a, b) => b.durationFrames - a.durationFrames);
  return result;
}
