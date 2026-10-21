/* Identify only the image formats already supported by local design resources.
 * This identifies a signature; the browser/native decoder still validates the image. */
export function imageMimeFromBytes(bytes) {
  const signature = [...bytes.subarray(0, 12)];
  if (signature.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10") return "image/png";
  if (signature[0] === 255 && signature[1] === 216 && signature[2] === 255)
    return "image/jpeg";
  if (String.fromCharCode(...signature.slice(0, 6)).startsWith("GIF8")) return "image/gif";
  if (
    String.fromCharCode(...signature.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...signature.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return new TextDecoder()
    .decode(bytes.subarray(0, 1024))
    .replace(/^\uFEFF/u, "")
    .trimStart()
    .match(/^(?:<\?xml[^>]*>\s*)?<svg[\s>]/iu)
    ? "image/svg+xml"
    : null;
}
