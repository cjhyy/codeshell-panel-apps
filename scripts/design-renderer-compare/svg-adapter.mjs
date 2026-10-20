import { exportDesignSvg } from "../../apps/design-studio/app/document.mjs";
export async function createRenderer({ canvas }) {
  let svg = null;
  let group = null;
  let count = 0;
  const parent = canvas.parentElement;
  canvas.style.visibility = "hidden";
  return {
    async setScene(design, { resources = new Map() } = {}) {
      const urls = new Map(
        [...resources].map(([id, r]) => [
          id,
          URL.createObjectURL(new Blob([r.bytes], { type: r.mimeType })),
        ]),
      );
      try {
        const source = exportDesignSvg(design, {
          resourceDataUrls: urls,
          maxBytes: 4 * 1024 * 1024,
        });
        const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
        if (parsed.querySelector("parsererror")) throw Error("SVG reference failed to parse");
        svg?.remove();
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:hidden";
        group = document.createElementNS(svg.namespaceURI, "g");
        for (const child of [...parsed.documentElement.childNodes])
          group.append(document.importNode(child, true));
        svg.append(group);
        parent.append(svg);
        count = design.nodes.length;
        await document.fonts.ready;
      } finally {
        for (const url of urls.values()) URL.revokeObjectURL(url);
      }
    },
    resize(width, height) {
      if (svg) {
        svg.setAttribute("width", width);
        svg.setAttribute("height", height);
      }
    },
    render({ pan, zoom }) {
      group.setAttribute("transform", `translate(${pan.x} ${pan.y}) scale(${zoom})`);
    },
    stats() {
      return { engine: "svg-reference", nodeCount: count, unsupported: [] };
    },
    dispose() {
      svg?.remove();
      canvas.style.visibility = "";
    },
  };
}
