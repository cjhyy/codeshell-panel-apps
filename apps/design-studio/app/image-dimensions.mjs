// Bounded header/container parsing, not a substitute for the native image
// decoder. It never fetches URLs, rewrites assets, or guesses a MIME type.
const invalid = (reason = "") => { const error = new Error(`原生 fill 图片需要可验证的 PNG/JPEG/GIF 字节尺寸${reason ? `：${reason}` : ""}`); error.code = "NATIVE_IMAGE_FILL"; throw error; };
export function imageByteDimensions(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 10 || bytes.length > 8 * 1024 * 1024) return invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (i, little = false) => view.getUint16(i, little);
  const text = (i, n) => String.fromCharCode(...bytes.subarray(i, i + n));
  const result = (width, height) => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > 32768 || height > 32768 || width * height > 16_777_216) return invalid();
    return { width, height };
  };
  if (text(0, 8) === "\x89PNG\r\n\x1a\n") {
    if (bytes.length < 45 || view.getUint32(8) !== 13 || text(12, 4) !== "IHDR") return invalid();
    const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || ![0, 1].includes(bytes[28])) return invalid();
    let offset = 8, data = false;
    for (let count = 0; count < 4096 && offset + 12 <= bytes.length; count++) {
      const length = view.getUint32(offset), type = text(offset + 4, 4);
      if (length > bytes.length - offset - 12 || !/^[A-Za-z]{4}$/u.test(type)) return invalid();
      if (type === "IHDR" && offset !== 8) return invalid();
      if (type === "eXIf") return invalid("EXIF 方向对原生解码尺寸的影响尚未证明");
      if (type === "IDAT" && length > 0) data = true;
      if (type === "IEND") {
        if (length !== 0 || offset + 12 !== bytes.length || !data) return invalid();
        return result(view.getUint32(16), view.getUint32(20));
      }
      offset += length + 12;
    }
    return invalid();
  }
  if (["GIF87a", "GIF89a"].includes(text(0, 6))) {
    if (bytes.length < 14 || bytes[12] !== 0) return invalid("GIF 像素宽高比元数据尚未证明");
    let offset = 13 + (bytes[10] & 128 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0), image = false;
    const blocks = () => {
      for (let count = 0; count < bytes.length && offset < bytes.length; count++) {
        const length = bytes[offset++];
        if (!length) return;
        if (offset + length > bytes.length) return invalid();
        offset += length;
      }
      return invalid();
    };
    for (let count = 0; count < 4096 && offset < bytes.length; count++) {
      const type = bytes[offset++];
      if (type === 0x3b) return image && offset === bytes.length ? result(u16(6, true), u16(8, true)) : invalid();
      if (type === 0x21) { if (offset >= bytes.length) return invalid(); offset++; blocks(); }
      else if (type === 0x2c) {
        if (offset + 10 > bytes.length) return invalid();
        const packed = bytes[offset + 8];
        if (!u16(offset + 4, true) || !u16(offset + 6, true) ||
            u16(offset, true) + u16(offset + 4, true) > u16(6, true) ||
            u16(offset + 2, true) + u16(offset + 6, true) > u16(8, true)) return invalid();
        offset += 9 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0);
        if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8) return invalid();
        offset++; blocks(); image = true;
      } else return invalid();
    }
    return invalid();
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    let offset = 2, size;
    for (let count = 0; count < 4096 && offset + 3 < bytes.length; count++) {
      if (bytes[offset++] !== 255) return invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (offset + 2 > bytes.length || [0, 216, 217].includes(marker)) return invalid();
      const length = u16(offset);
      if (length < 2 || length > bytes.length - offset) return invalid();
      if (marker === 0xe1) return invalid("JPEG APP1/EXIF 方向对原生解码尺寸的影响尚未证明");
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 11 || ![1, 3, 4].includes(bytes[offset + 7]) || length !== 8 + 3 * bytes[offset + 7] || size) return invalid();
        size = result(u16(offset + 5), u16(offset + 3));
      }
      if (marker === 0xda) return size && offset + length < bytes.length - 2 ? size : invalid();
      offset += length;
    }
  }
  return invalid();
}

export function assertNativeImageFill(node, bytes) {
  if (node.type !== "image" || node.objectFit !== "fill") return;
  const size = imageByteDimensions(bytes);
  if (!Number.isFinite(node.width) || !Number.isFinite(node.height) || node.width <= 0 || node.height <= 0 ||
      node.width * size.height !== node.height * size.width) {
    const error = new Error("object-fit:fill 的图像与内容框宽高比不同；原生 FILL 会裁剪，已拒绝而未改为 cover");
    error.code = "NATIVE_IMAGE_FILL";
    throw error;
  }
}
