import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const appDirectory = process.env.DESIGN_STUDIO_EXPORT_APP_DIR
  ? resolve(process.env.DESIGN_STUDIO_EXPORT_APP_DIR)
  : resolve(import.meta.dirname, "../../../apps/design-studio/app");

export const { exportDesignFrontend, renderDesignFrontendPage, designFrontendCss } = await import(
  pathToFileURL(resolve(appDirectory, "frontend-export.mjs"))
);
export const { exportDesignPrototype } = await import(
  pathToFileURL(resolve(appDirectory, "prototype.mjs"))
);

function rectangle(id, x, y, width, height, extras = {}) {
  return {
    id,
    type: "rectangle",
    name: id,
    x,
    y,
    width,
    height,
    fill: "#334455",
    stroke: "transparent",
    strokeWidth: 0,
    cornerRadius: 0,
    opacity: 1,
    rotation: 0,
    visible: true,
    locked: false,
    ...extras,
  };
}

export function fixtureDocument({ infinite = true, rootConstraints = false } = {}) {
  const west = rectangle("west-board", -800, -500, 320, 240, {
    type: "frame",
    layout: "none",
    gap: 0,
    padding: 0,
    alignItems: "start",
    justifyContent: "start",
    clipContent: true,
    ...(rootConstraints
      ? {
          layoutPositioning: "absolute",
          layoutSizingHorizontal: "fill",
          layoutSizingVertical: "fill",
          constraintHorizontal: "stretch",
          constraintVertical: "center",
          constraintLeft: 10,
          constraintRight: 20,
          constraintTop: 15,
        }
      : {}),
    children: [
      rectangle("west-content", -780, -470, 270, 40, {
        layoutPositioning: "absolute",
        constraintHorizontal: "stretch",
        constraintLeft: 20,
        constraintRight: 30,
      }),
    ],
  });
  return {
    format: "codeshell.design",
    version: 3,
    name: "Infinite export regression",
    canvas: {
      width: 1200,
      height: 800,
      background: "#eeeeee",
      ...(infinite ? { mode: "infinite" } : {}),
    },
    tokens: { colors: [] },
    resources: [],
    activePageId: "boards",
    pages: [
      {
        id: "boards",
        name: "Two distant boards",
        children: [west, rectangle("east-board", 4000, 1400, 280, 180)],
      },
      {
        id: "detail",
        name: "Negative detail board",
        children: [rectangle("detail-board", -60, -90, 200, 100)],
      },
    ],
  };
}

export function fixturePrototype() {
  return {
    format: "codeshell.design.prototype",
    version: 1,
    startPageId: "boards",
    links: [
      {
        id: "to-detail",
        pageId: "boards",
        nodeId: "west-content",
        event: "click",
        action: "navigate",
        targetPageId: "detail",
      },
      {
        id: "back",
        pageId: "detail",
        nodeId: "detail-board",
        event: "click",
        action: "back",
      },
    ],
  };
}

export function styleFor(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const tag = html.match(new RegExp(`<[^>]+data-codeshell-id="${escaped}"[^>]*>`, "u"))?.[0];
  return tag?.match(/\bstyle="([^"]*)"/u)?.[1] ?? "";
}

export function pageTag(html, pageId) {
  return (
    html.match(new RegExp(`<main [^>]*data-codeshell-page-id="${pageId}"[^>]*>`, "u"))?.[0] ?? ""
  );
}
