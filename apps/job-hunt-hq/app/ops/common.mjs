export function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} 参数格式不正确`);
  }
}

export function cleanText(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

export function cleanTextList(value, maxItems, maxLength) {
  return Array.isArray(value)
    ? value
        .map((item) => cleanText(item, maxLength))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

export function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function operationRuntime(ctx) {
  const now = cleanText(ctx?.now, 80);
  if (!now || !Number.isFinite(Date.parse(now)) || typeof ctx?.uid !== "function") {
    throw new Error("写入操作需要有效的 now 和 uid 运行上下文");
  }
  return { now, uid: ctx.uid };
}
