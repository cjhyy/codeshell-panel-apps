export function readSelectionWatchDocument(source, normalize) {
  if (source != null) {
    if (typeof source !== "object" || Array.isArray(source))
      throw new Error("长期关注记录格式无效，已停止写入");
    if (source.version !== undefined && ![1, 2].includes(source.version))
      throw new Error("长期关注记录版本不受支持，已保留原记录");
    for (const field of ["stocks", "sectors"]) {
      if (source[field] !== undefined && !Array.isArray(source[field]))
        throw new Error("长期关注列表格式无效，已停止写入");
    }
  }
  const value = normalize(source);
  for (const field of ["stocks", "sectors"]) {
    if (value[field].length !== (source?.[field]?.length ?? 0))
      throw new Error("长期关注包含无效、重复或超出容量的记录，请先备份核对");
  }
  return value;
}

// Preserve fields written by compatible clients while allowing known optional
// fields (priority/source) to be removed. Removed entries are intentionally gone.
export function selectionWatchDocument(source, value, normalize) {
  const result = { ...(source ?? {}), ...value };
  for (const [field, key, known] of [
    ["stocks", "symbol", ["symbol", "name", "source", "priority"]],
    ["sectors", "id", ["id", "name", "priority"]],
  ]) {
    const old = new Map(
      (source?.[field] ?? []).map((item) => [
        normalize({ [field]: [item] })[field][0]?.[key],
        item,
      ]),
    );
    result[field] = value[field].map((item) => {
      const extra = { ...(old.get(item[key]) ?? {}) };
      for (const name of known) delete extra[name];
      return { ...extra, ...item };
    });
  }
  return result;
}
