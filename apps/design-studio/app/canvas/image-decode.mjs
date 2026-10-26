import { imageMimeFromBytes } from "../image-mime.mjs";
import { inertDesignSvg } from "../svg-resource.mjs";

export const MAX_SVG_IMAGE_PIXELS = 16 * 1024 * 1024;
const fail = detail => { throw Object.assign(new Error(`SVG image decode: ${detail}`), { code: "SVG_IMAGE_DECODE" }); };

/** A bounded render derivative only. Original SVG bytes/descriptors stay owned by the document. */
export async function decodeCanvasKitImage(CK, resource, documentValue, { remainingSvgPixels = MAX_SVG_IMAGE_PIXELS } = {}) {
  const mime = (resource.mimeType ?? resource.descriptor?.mime ?? "").toLowerCase();
  const svgBytes = imageMimeFromBytes(resource.bytes) === "image/svg+xml";
  if (mime !== "image/svg+xml" && !svgBytes)
    return { image: CK.MakeImageFromEncoded(resource.bytes), svgPixels: 0 };
  if (mime !== "image/svg+xml" || !svgBytes) fail("SVG MIME 类型与实际字节不一致");
  const source = inertDesignSvg(new TextDecoder("utf-8", { fatal: true }).decode(resource.bytes));
  const view = documentValue?.defaultView;
  if (!view?.Image || !view.URL?.createObjectURL || !documentValue?.createElement)
    fail("浏览器没有本地SVG图片解码能力");
  const url = view.URL.createObjectURL(new view.Blob([source], { type: "image/svg+xml" }));
  const image = new view.Image();
  let timeout, raster;
  try {
    image.src = url;
    await Promise.race([image.decode(), new Promise((_, reject) => {
      timeout = view.setTimeout(() => reject(new Error("SVG 图片解码超时")), 5000);
    })]);
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > 8192 || height > 8192 || width * height > remainingSvgPixels)
      fail("SVG原始尺寸无效或超过场景16M像素/8192边长解码预算");
    raster = documentValue.createElement("canvas"); raster.width = width; raster.height = height;
    const context = raster.getContext("2d", { willReadFrequently: true });
    if (!context) fail("浏览器无法建立SVG资源的本地像素缓存");
    context.drawImage(image, 0, 0, width, height);
    const decoded = CK.MakeImage({ width, height, colorType: CK.ColorType.RGBA_8888,
      alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }, context.getImageData(0, 0, width, height).data, width * 4);
    if (!decoded) fail("CanvasKit无法建立SVG资源的RGBA图片");
    return { image: decoded, svgPixels: width * height };
  } finally {
    if (timeout !== undefined) view.clearTimeout(timeout);
    image.removeAttribute("src"); view.URL.revokeObjectURL(url);
    if (raster) { raster.width = 0; raster.height = 0; }
  }
}
