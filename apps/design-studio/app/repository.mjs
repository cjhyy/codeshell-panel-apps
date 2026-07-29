export const DEFAULT_DESIGN_PATH = "designs/design.codesign.json";

export function chooseRepoDesignFile(files, defaultPath = DEFAULT_DESIGN_PATH) {
  if (!Array.isArray(files) || files.length === 0) return undefined;
  const explicitDefault = files.find((file) => file?.path === defaultPath);
  if (explicitDefault) return explicitDefault;
  return [...files].sort(
    (left, right) =>
      (Number(right?.modifiedAt) || 0) - (Number(left?.modifiedAt) || 0) ||
      String(left?.path ?? "").localeCompare(String(right?.path ?? "")),
  )[0];
}
