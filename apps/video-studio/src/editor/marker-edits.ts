import { applyEditorOperations, type EditorOperation } from "./operations";
import type { EditorDocument, TimelineMarker } from "./types";

export type MarkerEditRequest =
  | { action: "add"; marker: TimelineMarker }
  | { action: "update"; markerId: string; patch: Partial<Omit<TimelineMarker, "id">> }
  | { action: "remove"; markerId: string };
export interface MarkerEditPlan {
  operations: EditorOperation[];
  sequenceId: string;
  markerId: string;
}

/** Point markers have zero duration; ranges use an exact, half-open tick interval. */
export function planMarkerEdit(
  document: EditorDocument,
  sequenceId: string,
  request: MarkerEditRequest,
): MarkerEditPlan {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(request))
  )
    throw new Error("标记操作格式无效");
  if (
    Reflect.ownKeys(request).some(
      (key) =>
        typeof key !== "string" ||
        !Object.getOwnPropertyDescriptor(request, key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(request, key)!, "value"),
    )
  )
    throw new Error("标记操作包含动态属性");
  const allowed =
    request.action === "add"
      ? ["action", "marker"]
      : request.action === "update"
        ? ["action", "markerId", "patch"]
        : request.action === "remove"
          ? ["action", "markerId"]
          : [];
  if (
    !allowed.length ||
    Reflect.ownKeys(request).some(
      (key) =>
        typeof key !== "string" ||
        !allowed.includes(key) ||
        !Object.getOwnPropertyDescriptor(request, key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(request, key)!, "value"),
    )
  )
    throw new Error("标记操作包含未知字段或动态属性");
  const operation: EditorOperation =
    request.action === "add"
      ? { type: "marker.add", sequenceId, marker: request.marker }
      : request.action === "update"
        ? { type: "marker.update", sequenceId, markerId: request.markerId, patch: request.patch }
        : { type: "marker.remove", sequenceId, markerId: request.markerId };
  // The same strict operation and document validation used by Session rejects duplicate IDs,
  // non-integral/overflowing times, missing markers and unsupported fields before any mutation.
  applyEditorOperations(document, [operation], document.revision);
  return {
    operations: structuredClone([operation]),
    sequenceId,
    markerId: request.action === "add" ? request.marker.id : request.markerId,
  };
}
