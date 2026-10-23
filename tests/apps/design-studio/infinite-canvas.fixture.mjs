import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";

export const infiniteViewport = { width: 1280, height: 800 };
export const shape = (id, x, y, width, height, fill, extra = {}) => ({
  id, type: "rectangle", name: id, x, y, width, height, fill,
  stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0,
  cornerRadius: 0, visible: true, locked: false, ...extra,
});
export const board = (id, x, y, fill = "#ffffff", children = []) => ({
  ...shape(id, x, y, 300, 200, fill), type: "frame", clipContent: true,
  layout: "none", layoutWrap: "none", gap: 0, padding: 0,
  alignItems: "start", justifyContent: "start", gridColumns: 2, children,
});
export function canvasCase({ infinite = true, far = false } = {}) {
  const left = far ? -48_000 : 40, right = far ? 64_000 : 420;
  return normalizeDesignDocument({
    format: "codeshell.design", version: 3, name: "Independent artboards",
    canvas: { width: 800, height: 600, background: "#e8e8e8", ...(infinite ? { mode: "infinite" } : {}) },
    tokens: { colors: [] }, resources: [], activePageId: "page-1",
    pages: [{ id: "page-1", name: "Workspace", children: [
      board("left-board", left, far ? -700 : 40, "#e23838", [
        shape("left-child", left + 40, far ? -650 : 90, 70, 60, "#24a35a"),
      ]),
      board("right-board", right, far ? 900 : 40, "#315fda"),
    ] }],
  });
}
export const canvasCaseSource = options => serializeDesignDocument(canvasCase(options));
