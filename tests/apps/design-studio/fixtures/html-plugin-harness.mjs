import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const code = await readFile(
  new URL("../../../../apps/design-studio/app/html-to-figma-plugin/code.js", import.meta.url),
  "utf8",
);
export const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=";
export function htmlPluginHarness({ failText = false, failFont = "Missing" } = {}) {
  const messages = [],
    nodes = [],
    fonts = new Set(),
    images = [],
    calls = [];
  let serial = 0;
  const page = {
    type: "PAGE",
    children: [],
    selection: [],
    appendChild(node) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      this.children.push(node);
      node.parent = this;
    },
  };
  function create(type) {
    const node = {
      id: String(++serial),
      type,
      children: [],
      parent: null,
      removed: false,
      width: 100,
      height: 100,
      layoutMode: "NONE",
      fills: [],
      strokes: [],
      resize(w, h) {
        assert(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0);
        this.width = w;
        this.height = h;
      },
      appendChild(child) {
        page.appendChild.call(this, child);
      },
      remove() {
        if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
        this.removed = true;
        for (const child of this.children) child.removed = true;
      },
      setSharedPluginData(namespace, key, value) {
        (this.metadata ||= {})[`${namespace}:${key}`] = value;
      },
      exportAsync: async () => Uint8Array.from(Buffer.from(PNG, "base64")),
    };
    if (type === "TEXT") {
      let font, characters;
      Object.defineProperty(node, "fontName", {
        get: () => font,
        set(value) {
          assert(
            fonts.has(`${value.family}:${value.style}`),
            `Font not loaded ${value.family}:${value.style}`,
          );
          font = value;
        },
      });
      Object.defineProperty(node, "characters", {
        get: () => characters,
        set(value) {
          assert(font, "Font must precede text");
          characters = value;
        },
      });
      for (const name of [
        "FontName",
        "FontSize",
        "Fills",
        "TextDecoration",
        "LineHeight",
        "LetterSpacing",
        "Hyperlink",
        "ListOptions",
      ])
        node[`setRange${name}`] = (start, end, value) => {
          assert(start >= 0 && end <= characters.length);
          if (name === "FontName") assert(fonts.has(`${value.family}:${value.style}`));
          (node.ranges ||= []).push({ name, start, end, value });
        };
    }
    nodes.push(node);
    page.appendChild(node);
    return node;
  }
  const existing = create("FRAME");
  existing.name = "Existing artwork";
  page.selection = [existing];
  const api = {
    currentPage: page,
    viewport: {
      center: { x: 20, y: 30 },
      scrollAndZoomIntoView(roots) {
        calls.push(["zoom", roots.map((n) => n.id)]);
      },
    },
    ui: {
      postMessage(message) {
        messages.push(message);
      },
    },
    showUI(html, options) {
      calls.push(["ui", options]);
    },
    notify(message) {
      calls.push(["notify", message]);
    },
    commitUndo() {
      calls.push(["undo"]);
    },
    async loadFontAsync(font) {
      if (font.family === failFont) throw new Error("Font unavailable");
      fonts.add(`${font.family}:${font.style}`);
    },
    createFrame: () => create("FRAME"),
    createRectangle: () => create("RECTANGLE"),
    createText: () => {
      if (failText) throw new Error("Injected text creation failure");
      return create("TEXT");
    },
    createNodeFromSvg(svg) {
      assert.match(svg, /^<svg/);
      return create("FRAME");
    },
    createImage(bytes) {
      assert(bytes.length > 0);
      const image = {
        hash: `image-${images.length}`,
        getSizeAsync: async () => ({ width: 1, height: 1 }),
      };
      images.push(image);
      return image;
    },
    getImageByHash(hash) {
      return images.find((i) => i.hash === hash);
    },
  };
  vm.runInNewContext(
    code,
    { figma: api, __html__: "fixture UI", console, Uint8Array, setTimeout, clearTimeout },
    { timeout: 3000 },
  );
  const importDesign = async (designData, requestId = "fixture-import") => {
    const before = messages.length;
    await api.ui.onmessage({ type: "import-design", designData, requestId });
    assert.equal(messages.length, before + 1);
    return messages.at(-1);
  };
  return { api, page, nodes, fonts, images, messages, calls, existing, importDesign };
}
export const frameFixture = (children = []) => ({
  id: "root",
  type: "FRAME",
  name: "Card",
  x: 0,
  y: 0,
  width: 400,
  height: 220,
  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
  children,
});
export const textFixture = (font = "Inter") => ({
  id: "title",
  type: "TEXT",
  name: "Title",
  x: 24,
  y: 24,
  width: 260,
  height: 35,
  fontName: { family: font, style: "Regular" },
  fontSize: 24,
  characters: "Editable title",
  fills: [{ type: "SOLID", color: { r: 0.1, g: 0.2, b: 0.4 } }],
});
