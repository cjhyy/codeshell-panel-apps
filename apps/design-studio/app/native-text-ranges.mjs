import { nativeTextRangePlan } from "./native-text-range-plan.mjs";

/**
 * Keep staged range authoring lossless while native consumers are implemented.
 * A successful SDK capability probe alone does not qualify production transfer.
 */
export function assertNativeTextRangeBoundary(node) {
  if (node?.textRanges === undefined) return;
  const label = (typeof node.name === "string" ? node.name : typeof node.id === "string" ? node.id : "Text").slice(0, 120);
  const error = new Error(
    label + "：范围文字的此项原生互转尚未完成验证；已阻止互转，未丢弃范围样式。",
  );
  error.code = "TEXT_RANGES_NATIVE_UNSUPPORTED";
  throw error;
}

/** Complete creation plan; original-node updates keep their separate hard boundary. */
export function nativeTextRangeCreationPlan(node) {
  if (node?.textRanges === undefined) return undefined;
  try { return nativeTextRangePlan(node); }
  catch (cause) {
    const messages = {
      TEXT_RANGES_NATIVE_UNSUPPORTED_LINK: "范围文字的原生链接目前只支持完整 HTTP(S) 地址和简单 mailto 地址",
      TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION: "范围文字的原生装饰仍待验证；请先移除下划线和删除线",
      TEXT_RANGES_NATIVE_UNSUPPORTED_PAINT: "范围文字的原生填充目前只支持不透明纯色",
    };
    const code = typeof cause?.code === "string" ? cause.code : "TEXT_RANGES_NATIVE_INVALID_SOURCE";
    const error = new Error(messages[code] ?? "范围文字的完整来源或区间无效，已阻止创建副本");
    error.code = code;
    throw error;
  }
}
