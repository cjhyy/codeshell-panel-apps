import { nativeTextRangeCreationPlan } from "../native-text-ranges.mjs";

/** Called only for a newly created Text inside the factory's owned-page rollback. */
export function applyCreatedNativeTextRanges(target, source) {
  const plan = nativeTextRangeCreationPlan(source);
  if (!plan) return undefined;
  const methods = ["setRangeHyperlink", "setRangeFills", "setRangeTextDecoration"];
  if (target?.type !== "TEXT" || target.characters !== plan.characters ||
      methods.some(method => typeof target[method] !== "function")) {
    const error = new Error("范围文字的原生写入能力或完整来源不匹配，已阻止创建副本");
    error.code = "TEXT_RANGES_NATIVE_WRITE_UNAVAILABLE";
    throw error;
  }
  const [hyperlink, fills, decoration] = methods.map(method => target[method]);
  for (const run of plan.runs) {
    // Hyperlinks may apply native appearance defaults. Restore the authored
    // opaque color and explicit NONE decoration after setting/clearing the link.
    hyperlink.call(target, run.start, run.end, run.hyperlink);
    const channels = [1, 3, 5].map(index => parseInt(run.fill.slice(index, index + 2), 16) / 255);
    fills.call(target, run.start, run.end, [{ type: "SOLID", color: { r: channels[0], g: channels[1], b: channels[2] } }]);
    decoration.call(target, run.start, run.end, "NONE");
  }
  return plan;
}
