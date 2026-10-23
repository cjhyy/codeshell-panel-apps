// Stable world-coordinate regression: two independent artboards, a clipped
// child, hidden offscreen content, and visible effects beyond the old document.
export function worldNode(id, properties = {}) {
  return {
    id, type: "rectangle", name: id, x: 0, y: 0, width: 100, height: 80,
    fill: "#3366cc", stroke: "transparent", strokeWidth: 0, opacity: 1,
    rotation: 0, cornerRadius: 0, visible: true, locked: false,
    ...(["frame", "group", "component"].includes(properties.type)
      ? { layout: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start" }
      : {}),
    ...properties,
  };
}

export function infiniteCanvasFixture({ mode = "infinite", distant = false } = {}) {
  return {
    format: "codeshell.design", version: 3, name: "Independent artboards",
    canvas: { width: 1280, height: 820, background: "#f5f5f2", ...(mode ? { mode } : {}) },
    tokens: { colors: [] }, resources: [], activePageId: "page-1",
    pages: [{ id: "page-1", name: "Free placement", children: [
      worldNode("board-negative", { type: "frame", x: -600, y: -300, width: 320, height: 240,
        fill: "#ffffff", clipContent: true, children: [
          worldNode("clipped-child", { x: -300, y: -100, width: 200, height: 100 }),
        ] }),
      worldNode("board-right", { type: "frame", x: distant ? 800000 : 1800, y: 900,
        width: 320, height: 240, fill: "#ffffff", children: [] }),
      worldNode("effect", { x: -640, y: -350, width: 20, height: 20,
        stroke: "#111111", strokeWidth: 4,
        shadow: { color: "#000000", opacity: 0.5, x: -10, y: 6, blur: 8 } }),
      worldNode("hidden", { x: 19000, y: 19000, visible: false }),
    ] }],
  };
}

export function distantFigmaSource() {
  return { name: "World source", document: { id: "0:1", type: "CANVAS", name: "World", children: [
    { id: "1:1", type: "FRAME", name: "Negative board", absoluteBoundingBox: { x: -800000, y: -400, width: 320, height: 240 },
      children: [{ id: "1:2", type: "RECTANGLE", name: "Editable", absoluteBoundingBox: { x: -799980, y: -380, width: 50, height: 50 } }] },
    { id: "2:1", type: "FRAME", name: "Distant board", absoluteBoundingBox: { x: 800000, y: 900, width: 320, height: 240 }, children: [] },
  ] } };
}
