// The production html2figma exporter emits actual SDK nodes plus this report.
// A downloadable diagnostic file is not permission to import a partial design.
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => { throw Object.assign(Error("html2figma 原生导出报告无效或与图层数量不一致。"),
  { code: "NATIVE_EXPORT_REPORT_INVALID" }); };
function record(value, fields, required = fields) {
  if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !fields.includes(key) ||
      !Object.hasOwn(descriptors[key], "value") || !descriptors[key].enumerable) ||
      required.some(key => !Object.hasOwn(descriptors, key))) invalid();
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function array(value) {
  if (!Array.isArray(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), length = descriptors.length.value;
  if (Reflect.ownKeys(descriptors).length !== length + 1) invalid();
  return Array.from({ length }, (_, index) => {
    const item = descriptors[index];
    if (!item || !Object.hasOwn(item, "value") || !item.enumerable) invalid();
    return item.value;
  });
}
function diagnostic(value) {
  const item = record(value, ["code", "nodeId", "path", "message"], ["code", "path", "message"]);
  if (![item.code, item.path, item.message].every(value => typeof value === "string" && value.trim()) ||
      Object.hasOwn(item, "nodeId") && (typeof item.nodeId !== "string" || !item.nodeId)) invalid();
}
const counts = values => Object.values(values).every(value => Number.isSafeInteger(value) && value >= 0);
const finite = value => typeof value === "number" && Number.isFinite(value);
function rigidMatrix(value) {
  if (!Array.isArray(value) || value.length !== 2 || !Array.from(value).every(row =>
      Array.isArray(row) && row.length === 3 && Array.from(row).every(finite))) return false;
  const [[a, b], [c, d]] = value;
  return Math.abs(a * d - b * c - 1) <= 0.001 && Math.abs(a * a + c * c - 1) <= 0.001 &&
    Math.abs(b * b + d * d - 1) <= 0.001;
}

/** SDK local/world transforms are retained; unsupported transforms are never approximated here. */
export function isNativeExportGeometry(node) {
  return object(node) && typeof node.id === "string" && node.id.trim().length > 0 && typeof node.type === "string" &&
    ["x", "y", "width", "height"].every(key => finite(node[key])) && node.width > 0 && node.height > 0 &&
    rigidMatrix(node.relativeTransform) && rigidMatrix(node.absoluteTransform) &&
    node.relativeTransform[0][2] === node.x && node.relativeTransform[1][2] === node.y &&
    Object.hasOwn(node, "absoluteBoundingBox") && (node.absoluteBoundingBox === null ||
      object(node.absoluteBoundingBox) && ["x", "y", "width", "height"].every(key => finite(node.absoluteBoundingBox[key])) &&
        node.absoluteBoundingBox.width >= 0 && node.absoluteBoundingBox.height >= 0) &&
    (node.size === undefined || object(node.size) && node.size.x === node.width && node.size.y === node.height);
}

/** Validate both the raw nodes-array envelope and its retained REST-shaped source. */
export function assertCompleteNativeExportReport(input) {
  if (!object(input) || !Object.hasOwn(input, "exportReport")) return;
  const descriptor = Object.getOwnPropertyDescriptor(input, "exportReport");
  if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) invalid();
  const report = record(descriptor.value, ["ready", "partial", "nodes", "images", "json", "errors", "warnings"]),
    nodes = record(report.nodes, ["selected", "serialized", "unsupported"]),
    images = record(report.images, ["references", "resources", "embedded", "failed", "bytes", "payloadBytes"]),
    json = record(report.json, ["bytes", "budget"]), errors = array(report.errors), warnings = array(report.warnings);
  errors.forEach(diagnostic); warnings.forEach(diagnostic);
  if (typeof report.ready !== "boolean" || report.partial !== !report.ready || !counts(nodes) || !counts(images) || !counts(json) ||
      nodes.selected < 1 || nodes.serialized < nodes.selected || nodes.unsupported > nodes.serialized ||
      images.resources > images.references || images.embedded + images.failed > images.resources ||
      (images.references === 0 ? Object.values(images).some(value => value !== 0) : images.resources === 0) ||
      images.payloadBytes < images.bytes || json.bytes < 1 || json.budget < 1) invalid();
  if (!report.ready || report.partial || errors.length || nodes.unsupported || images.failed ||
      images.embedded !== images.resources || json.bytes > json.budget)
    throw Object.assign(Error("html2figma 原生导出不完整：诊断报告含错误或未完成资源，已阻止导入。"),
      { code: "NATIVE_EXPORT_INCOMPLETE" });
  const roots = Array.isArray(input.nodes) ? array(input.nodes) : object(input.nodes)
    ? Object.values(input.nodes).map(entry => entry?.document) : null;
  if (!roots || roots.length !== nodes.selected) invalid();
  let count = 0;
  const seen = new WeakSet(), ids = new Set(), inspect = (node, depth) => {
    if (!object(node) || seen.has(node) || depth > 32 || ++count > 50000 || Object.hasOwn(node, "exportReport")) invalid();
    if (!isNativeExportGeometry(node)) throw Object.assign(Error("html2figma 原生导出图层几何无效：需要一致尺寸及受支持的局部和绝对变换矩阵。"),
      { code: "NATIVE_EXPORT_GEOMETRY_INVALID" });
    if (ids.has(node.id)) throw Object.assign(Error("html2figma 原生导出图层 ID 重复；不能作为完整来源重新编号。"),
      { code: "NATIVE_EXPORT_NODE_ID_INVALID" });
    ids.add(node.id);
    seen.add(node);
    for (const child of node.children === undefined ? [] : array(node.children)) inspect(child, depth + 1);
  };
  roots.forEach(node => inspect(node, 0));
  if (count !== nodes.serialized) invalid();
}
