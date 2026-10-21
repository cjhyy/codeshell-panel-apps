import { captureNativeTextRangeObservations } from "./text-range-capture.mjs";
import { NATIVE_TEXT_RANGE_FIELDS, NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS,
  buildNativeTextRangeSource, nativeTextRangeSnapshot } from "../native-text-ranges-source.mjs";
import { buildNativeTextRangeHint } from "../native-text-range-hint.mjs";

export const NATIVE_TEXT_RANGE_HINT_KEY = "codeshellTextRangeIntent";
const MAX_HINTS_BYTES = 16 * 1024 * 1024;
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
function utf8(text) {
  let bytes = 0;
  for (const scalar of text) {
    const code = scalar.codePointAt(0);
    bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
  }
  return bytes;
}

/** Read current SDK values independently of any saved author metadata. */
export function captureBoundNativeTextRanges(target, rest, mixed) {
  const captured = captureNativeTextRangeObservations(target, mixed, {
    fields: NATIVE_TEXT_RANGE_FIELDS, scalarFields: NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS,
  });
  if (captured.status !== "captured") return captured;
  return buildNativeTextRangeSource({ rest, ...captured.observations });
}

/**
 * Creation only. The factory must call after ALL parent/child sizing, within its
 * owned-page rollback. assertOwned is runtime bookkeeping, never JSON authority.
 */
export async function finalizeCreatedNativeTextRanges(entries, { mixed, pluginId, assertOwned }) {
  if (!Array.isArray(entries) || entries.length > 10000 || typeof assertOwned !== "function")
    fail("TEXT_RANGES_NATIVE_FINALIZE_INPUT", "范围文字的最终校验上下文无效，已阻止创建副本");
  const pending = [];
  let bytes = 0;
  for (const { target, source } of entries) {
    assertOwned(target);
    if (target?.type !== "TEXT" || typeof target.exportAsync !== "function" ||
        typeof target.setPluginData !== "function")
      fail("TEXT_RANGES_NATIVE_FINALIZE_UNAVAILABLE", "范围文字的最终读取或意图保存能力不可用，已阻止创建副本");
    const response = await target.exportAsync({ format: "JSON_REST_V1" });
    assertOwned(target);
    const rest = response?.document ?? response?.nodes?.[target.id]?.document;
    if (rest?.id !== target.id || rest?.type !== "TEXT")
      fail("TEXT_RANGES_NATIVE_FINALIZE_IDENTITY", "范围文字的最终来源身份不匹配，已阻止创建副本");
    const current = captureBoundNativeTextRanges(target, rest, mixed);
    if (current.status !== "bound")
      fail("TEXT_RANGES_NATIVE_FINALIZE_SOURCE", "无法完整校验新建范围文字的最终原生状态，已阻止创建副本");
    const hint = buildNativeTextRangeHint({ rest, source: current.source, authorNode: source,
      pluginId, key: NATIVE_TEXT_RANGE_HINT_KEY });
    const text = JSON.stringify(hint);
    if ((bytes += utf8(text)) > MAX_HINTS_BYTES)
      fail("TEXT_RANGES_NATIVE_FINALIZE_BUDGET", "范围文字的完整意图快照合计超过 16 MiB，已阻止创建副本");
    pending.push({ target, rest, text, snapshot: nativeTextRangeSnapshot(current.source) });
  }
  // Any awaited export can allow another edit. Recheck every staged Text in one
  // final synchronous phase before the first plugin-data write.
  for (const entry of pending) {
    assertOwned(entry.target);
    const current = captureBoundNativeTextRanges(entry.target, entry.rest, mixed);
    if (current.status !== "bound" || nativeTextRangeSnapshot(current.source) !== entry.snapshot)
      fail("TEXT_RANGES_NATIVE_FINALIZE_RACE", "范围文字在最终读取期间发生变化，已阻止创建副本");
  }
  for (const entry of pending) entry.target.setPluginData(NATIVE_TEXT_RANGE_HINT_KEY, entry.text);
  return { texts: pending.length, bytes };
}
