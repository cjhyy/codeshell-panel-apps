// Reports belong to input design roots/envelopes, never descendants. This is
// an admission gate only: generated glyphs remain independent source nodes.
const invalid = () => { throw Object.assign(new Error(
  "html2figma conversionReport 无效：需要严格的根转换报告；children 或其他嵌套位置不能声明报告。",
), { code: "CONVERSION_REPORT_INVALID" }); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const plain = value => object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const valueOf = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const pathKey = path => JSON.stringify(path);
function record(value, fields, required = fields) {
  if (!plain(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== "string" || !fields.includes(key) ||
      !Object.hasOwn(descriptors[key], "value") || !descriptors[key].enumerable) ||
      required.some(key => !Object.hasOwn(descriptors, key))) invalid();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function array(value) {
  if (!Array.isArray(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), length = descriptors.length.value;
  if (Reflect.ownKeys(descriptors).length !== length + 1) invalid();
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[index];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) invalid();
    return descriptor.value;
  });
}
function diagnostic(value) {
  const item = record(value, ["code", "message", "sourceOffset", "sourcePath", "nodeId"], ["code", "message"]);
  if (typeof item.code !== "string" || !item.code.trim() || typeof item.message !== "string" || !item.message.trim() ||
      Object.hasOwn(item, "nodeId") && (typeof item.nodeId !== "string" || !item.nodeId.trim()) ||
      Object.hasOwn(item, "sourceOffset") && (!Number.isSafeInteger(item.sourceOffset) || item.sourceOffset < 0)) invalid();
  if (Object.hasOwn(item, "sourcePath") && array(item.sourcePath).some(index => !Number.isSafeInteger(index) || index < 0)) invalid();
}
function report(value) {
  const item = record(value, ["version", "ready", "partial", "errors", "warnings"]);
  if (item.version !== 1 || typeof item.ready !== "boolean" || typeof item.partial !== "boolean" ||
      item.partial !== !item.ready) invalid();
  const errors = array(item.errors), warnings = array(item.warnings);
  errors.forEach(diagnostic); warnings.forEach(diagnostic);
  if (!item.ready || item.partial || errors.length) throw Object.assign(new Error(
    "html2figma 转换尚未完成：缺少原生文字布局或生成 glyph 的完整观测，已阻止作为完整设计导入。" +
    (errors.length ? ` ${valueOf(errors[0], "code")}: ${valueOf(errors[0], "message").slice(0, 300)}` : ""),
  ), { code: "CONVERSION_INCOMPLETE" });
}

/** Validate every supported raw/REST design root without changing the input. */
export function assertCompleteConversionReports(input) {
  const owners = new Set();
  let longestOwnerPath = 0;
  const addOwner = path => {
    longestOwnerPath = Math.max(longestOwnerPath, path.length);
    owners.add(pathKey(path));
  };
  // Follow only the bridge's supported input-envelope boundaries. Merely
  // placing a nodes/document property in a child or asset creates no new root.
  const roots = (value, path, depth = 0) => {
    if (depth > 4 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)))
        if (/^(?:0|[1-9][0-9]*)$/u.test(key) && object(descriptor.value)) addOwner([...path, key]);
      return;
    }
    addOwner(path);
    const document = valueOf(value, "document"), nodes = valueOf(value, "nodes");
    if (object(document)) roots(document, [...path, "document"], depth + 1);
    else if (Array.isArray(nodes)) roots(nodes, [...path, "nodes"], depth + 1);
    else if (object(nodes)) for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(nodes))) {
      const document = object(descriptor.value) ? valueOf(descriptor.value, "document") : undefined;
      if (object(document)) roots(document, [...path, "nodes", key, "document"], depth + 1);
    }
  };
  roots(input, []);
  // Metadata may be deep even when the established source serializer will
  // reject it. Keep traversal linear instead of copying every ancestor path
  // before that existing budget runs. A linked path still distinguishes a
  // legal root from the same object aliased beneath a child or metadata.
  const linkedPathKey = tail => {
    const path = [];
    for (let part = tail; part; part = part.parent) path.push(part.key);
    return pathKey(path.reverse());
  };
  const pending = [{ value: input, path: null }], seen = new WeakSet();
  while (pending.length) {
    const { value, path } = pending.pop();
    if (value === null || typeof value !== "object") continue;
    const descriptors = Object.getOwnPropertyDescriptors(value), declared = descriptors.conversionReport;
    if (declared) {
      if ((path?.length ?? 0) > longestOwnerPath || !owners.has(linkedPathKey(path)) ||
          !Object.hasOwn(declared, "value") || !declared.enumerable) invalid();
      report(declared.value);
    }
    if (seen.has(value)) continue;
    seen.add(value);
    for (const [key, descriptor] of Object.entries(descriptors))
      if (key !== "conversionReport" && Object.hasOwn(descriptor, "value") && descriptor.value !== null && typeof descriptor.value === "object")
        pending.push({ value: descriptor.value, path: { parent: path, key, length: (path?.length ?? 0) + 1 } });
  }
}
