// Local offline adaptation of upstream packages/plugin/code.ts handleImportDesign.
// Creation is performed by the vendored upstream FigmaService and creators.
import { FigmaService } from "../upstream/packages/figma/FigmaService";
import { extractFontsFromJSON } from "../upstream/packages/figma/font-utils";
import { ImageCreator } from "../upstream/packages/figma/creators/ImageCreator";
import { creatorErrors } from "./shared";
import { prepareDesignInput, inertDesignSvg } from "./input";
declare const figma: any;
declare const __html__: string;
let busy = false;
figma.showUI(__html__, { width: 780, height: 760, themeColors: true });

async function materializeImages(node: any, api: any) {
  const top = node.imageMetadata;
  const fills = [];
  for (const fill of node.fills ?? []) {
    if (fill.type !== "IMAGE") {
      fills.push(fill);
      continue;
    }
    const meta = fill._imageMetadata || top || {};
    const source = meta.base64 || meta.originalUrl || fill._pendingImageUrl || "";
    let image;
    if (meta.isSvg && meta.svgContent) {
      const svg = api.createNodeFromSvg(inertDesignSvg(meta.svgContent));
      try {
        image = api.createImage(await svg.exportAsync({ format: "PNG" }));
      } finally {
        svg.remove();
      }
    } else if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) {
      image = api.createImage(
        ImageCreator.decodeBase64ToBytes(source.slice(source.indexOf(",") + 1)),
      );
    } else if (
      fill.imageHash &&
      typeof api.getImageByHash === "function" &&
      api.getImageByHash(fill.imageHash)
    ) {
      image = { hash: fill.imageHash };
    } else
      throw new Error(
        "图片必须随 HTML/JSON 内嵌或选择本地文件；不能下载外部 URL 或跨文件 imageHash",
      );
    const clean: any = {
      type: "IMAGE",
      imageHash: image.hash,
      scaleMode: fill.scaleMode || "FILL",
    };
    for (const key of [
      "opacity",
      "visible",
      "imageTransform",
      "scalingFactor",
      "rotation",
      "filters",
    ])
      if (fill[key] !== undefined) clean[key] = fill[key];
    fills.push(clean);
  }
  if (node.fills) node.fills = fills;
  delete node.imageMetadata;
  delete node.backgroundImageData;
  for (const child of node.children ?? []) await materializeImages(child, api);
}
async function preloadFonts(roots: any[], api: any, warnings: string[]) {
  const fallback = { family: "Inter", style: "Regular" };
  await api.loadFontAsync(fallback);
  const loaded = new Set(["Inter:Regular"]);
  for (const root of roots)
    for (const font of extractFontsFromJSON(root).values()) {
      try {
        await api.loadFontAsync(font);
        loaded.add(`${font.family}:${font.style}`);
      } catch {
        warnings.push(`字体 ${font.family} ${font.style} 不可用，使用 Inter Regular`);
      }
    }
  function normalize(node: any) {
    if (node.type === "TEXT") {
      if (!node.fontName || !loaded.has(`${node.fontName.family}:${node.fontName.style}`))
        node.fontName = fallback;
      for (const seg of node.styledTextSegments ?? [])
        if (seg.fontName && !loaded.has(`${seg.fontName.family}:${seg.fontName.style}`))
          seg.fontName = fallback;
    }
    (node.children ?? []).forEach(normalize);
  }
  roots.forEach(normalize);
}
figma.ui.onmessage = async (message: any) => {
  if (message?.type !== "import-design" || typeof message.requestId !== "string" || busy) return;
  busy = true;
  const created: any[] = [];
  const selection = [...figma.currentPage.selection];
  const api = new Proxy(figma, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== "function") return value;
      if (
        ["createFrame", "createRectangle", "createText", "createNodeFromSvg"].includes(String(key))
      )
        return (...args: any[]) => {
          const node = value.apply(target, args);
          created.push(node);
          return node;
        };
      return value.bind(target);
    },
  });
  creatorErrors.length = 0;
  try {
    const { roots, count, warnings } = prepareDesignInput(message.designData);
    await preloadFonts(roots, api, warnings);
    for (const root of roots) await materializeImages(root, api);
    const service = new FigmaService(api, {
      autoFocus: false,
      validateNodes: true,
      logOperations: false,
    });
    const completed = [];
    let x = figma.viewport.center.x;
    for (const root of roots) {
      const frame = await service.addLayersToFrame(root, null);
      if (creatorErrors.length) throw new Error(`图层创建失败：${creatorErrors[0]}`);
      frame.x = x;
      frame.y = figma.viewport.center.y;
      x += frame.width + 80;
      figma.currentPage.appendChild(frame);
      completed.push(frame);
    }
    figma.currentPage.selection = completed;
    figma.viewport.scrollAndZoomIntoView(completed);
    figma.commitUndo?.();
    figma.ui.postMessage({
      type: "import-success",
      requestId: message.requestId,
      count,
      nodeIds: completed.map((n) => n.id),
      warnings: [...new Set(warnings)],
    });
    figma.notify(`已创建 ${count} 个可编辑图层`);
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const node of created.reverse())
      if (!node.removed) {
        try {
          node.remove();
        } catch (cleanupError) {
          rollbackErrors.push(String(cleanupError));
        }
      }
    try {
      figma.currentPage.selection = selection.filter((n) => !n.removed);
    } catch (selectionError) {
      rollbackErrors.push(String(selectionError));
    }
    figma.ui.postMessage({
      type: "import-error",
      requestId: message.requestId,
      message:
        (error instanceof Error ? error.message : String(error)) +
        (rollbackErrors.length ? `；部分新图层清理失败，请检查本次导入：${rollbackErrors[0]}` : ""),
      rollback: rollbackErrors.length ? "incomplete" : "complete",
    });
  } finally {
    busy = false;
  }
};
