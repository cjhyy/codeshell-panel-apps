import { readFile } from "node:fs/promises";

const actual = JSON.parse(await readFile(new URL("native-source.json", import.meta.url)));

// An independently labelled CPU control built from the saved content tree.
// This is not an additional native receipt. The immutable actual JSON remains
// untouched; a new vertical body places its real Fill owner inside a fixed root.
export function fillContextSource() {
  const value = structuredClone(actual), root = value.document.children[0], owner = root.children[0];
  const shift = (node) => {
    for (const key of ["absoluteBoundingBox", "absoluteRenderBounds"])
      if (node[key]) { node[key].x -= 10; node[key].y -= 10; }
    node.children?.forEach(shift);
  };
  shift(owner);
  owner.layoutSizingHorizontal = "FILL";
  const body = {
    ...structuredClone(owner), id: "900:1", name: "Bounded Fill body control",
    children: [owner], paddingTop: 30, paddingRight: 30, paddingBottom: 30, paddingLeft: 30,
    absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 329 },
    absoluteRenderBounds: { x: 0, y: 0, width: 1280, height: 329 },
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG",
  };
  Object.assign(root, {
    layoutMode: "VERTICAL", primaryAxisSizingMode: "FIXED", counterAxisSizingMode: "FIXED",
    layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED",
    primaryAxisAlignItems: "MIN", counterAxisAlignItems: "MIN", layoutWrap: "NO_WRAP",
    itemSpacing: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    children: [body], absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 600 },
    absoluteRenderBounds: { x: 0, y: 0, width: 1280, height: 600 },
  });
  return value;
}
