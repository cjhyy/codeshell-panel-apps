// The fixed reviewed capture runtime runs inside an opaque sandbox, never user scripts.
import { convertToDesignDSL } from "../../../apps/design-studio/app/vendor/html2figma-browser.mjs";
declare const __captureOptions: { requestId: string; selector: string };
(async () => {
  try {
    await document.fonts.ready;
    if (document.querySelectorAll("*").length > 10000)
      throw new Error("HTML DOM 最多 10000 个元素");
    await Promise.all(
      [...document.images]
        .filter((image) => image.hasAttribute("src"))
        .map((image) => image.decode()),
    );
    for (const image of document.images)
      if (
        image.naturalWidth > 8192 ||
        image.naturalHeight > 8192 ||
        image.naturalWidth * image.naturalHeight > 16777216
      )
        throw new Error("图片最多 8192 像素边长、1600 万像素");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const root = document.querySelector(__captureOptions.selector);
    if (!root) throw new Error("找不到根选择器");
    const tree = convertToDesignDSL(root, { maxDepth: 60 });
    if (!tree) throw new Error("HTML 没有可见图层");
    parent.postMessage(
      { type: "html2figma-captured", requestId: __captureOptions.requestId, tree },
      "*",
    );
  } catch (error: any) {
    parent.postMessage(
      {
        type: "html2figma-captured",
        requestId: __captureOptions.requestId,
        error: error.message || String(error),
      },
      "*",
    );
  }
})();
