// Runtime facts derived from immutable font bytes, never from a resource ID or
// its CSS weight declaration. This does not change the persisted v3 descriptor.
import { BUILTIN_DESIGN_FONTS } from "./builtin-font-catalog.mjs";

const MAX_BYTES = 16 * 1024 * 1024;
const unknown = (format, status = "unsupported", detail) => ({ format, status, proof: "none", axes: [], ...(detail ? { detail } : {}) });
const tag = (view, offset) => String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, 4));
const fixed = (view, offset) => view.getInt32(offset) / 65536;

// Frozen WOFF2 assets were decoded with fontTools/Brotli and read from fvar and
// OS/2. The complete SHA-256 below comes from the adjacent original-byte catalog;
// changing even one byte removes this proof. Unknown WOFF2 stays unsupported.
const pinned = {
  inter: { weight: 400, axes: [{ tag: "opsz", min: 14, default: 14, max: 32 }, { tag: "wght", min: 100, default: 400, max: 900 }] },
  "inter-italic": { weight: 400, axes: [{ tag: "opsz", min: 14, default: 14, max: 32 }, { tag: "wght", min: 100, default: 400, max: 900 }] },
  "fa-solid": { weight: 900, axes: [] }, "fa-regular": { weight: 400, axes: [] }, "fa-brands": { weight: 400, axes: [] },
};

// Synchronous FIPS 180-4 digest keeps synchronous SVG/HTML export byte-verified.
// Font byte budgets are checked before allocating this bounded work buffer.
const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotate = (value, bits) => value >>> bits | value << (32 - bits);
function sha256(bytes) {
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64); padded.set(bytes); padded[bytes.length] = 128;
  const view = new DataView(padded.buffer); view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(padded.length - 4, bytes.length * 8 >>> 0);
  const state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]), words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const x = words[i-15], y = words[i-2]; words[i] = words[i-16] + (rotate(x,7)^rotate(x,18)^x>>>3) + words[i-7] + (rotate(y,17)^rotate(y,19)^y>>>10) >>> 0; }
    let [a,b,c,d,e,f,g,h] = state;
    for (let i = 0; i < 64; i++) { const first = h + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + (e&f^~e&g) + K[i] + words[i] >>> 0, second = (rotate(a,2)^rotate(a,13)^rotate(a,22)) + (a&b^a&c^b&c) >>> 0; h=g;g=f;f=e;e=d+first>>>0;d=c;c=b;b=a;a=first+second>>>0; }
    [a,b,c,d,e,f,g,h].forEach((value,i) => state[i] = state[i] + value >>> 0);
  }
  return [...state].map(value => value.toString(16).padStart(8,"0")).join("");
}

/** fvar Fixed 16.16 values; table addresses use the supplied view's byteOffset. */
export function inspectFontCapabilities(input) {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes || bytes.length < 12 || bytes.length > MAX_BYTES) return unknown("unknown", "invalid", "font byte budget/header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), signature = tag(view, 0);
  if (signature === "wOF2") {
    const candidates = BUILTIN_DESIGN_FONTS.filter(font => font.mime === "font/woff2" && font.bytes === bytes.length && pinned[font.id]);
    const digest = candidates.length ? sha256(bytes) : null, font = candidates.find(font => font.sha256 === digest);
    return font ? { format: "woff2", status: "verified", proof: "pinned-sha256", sha256: digest, style: font.style, ...structuredClone(pinned[font.id]) } : unknown("woff2");
  }
  if (!["\u0000\u0001\u0000\u0000", "OTTO", "true"].includes(signature)) return unknown(signature === "ttcf" ? "collection" : signature === "wOFF" ? "woff" : "unknown");
  const format = signature === "OTTO" ? "otf" : "ttf";
  try {
    const count = view.getUint16(4), tables = new Map();
    if (!count || count > 256 || 12 + count * 16 > bytes.length) throw Error("table directory");
    for (let index = 0; index < count; index++) {
      const at = 12 + index * 16, name = tag(view, at), offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
      if (tables.has(name) || offset < 12 + count * 16 || offset > bytes.length || length > bytes.length - offset) throw Error("table bounds/duplicate");
      tables.set(name, { offset, length });
    }
    const os2 = tables.get("OS/2"), metadata = {};
    if (os2?.length >= 6) { const weight = view.getUint16(os2.offset + 4); if (weight >= 1 && weight <= 1000) metadata.weight = weight; }
    if (os2?.length >= 64) metadata.style = view.getUint16(os2.offset + 62) & 1 ? "italic" : "normal";
    const fvar = tables.get("fvar");
    if (!fvar) return { format, status: "verified", proof: "sfnt-static", axes: [], ...metadata };
    if (fvar.length < 16) throw Error("fvar header");
    const at = fvar.offset, axisOffset = view.getUint16(at + 4), axisCount = view.getUint16(at + 8), axisSize = view.getUint16(at + 10), instanceCount = view.getUint16(at + 12), instanceSize = view.getUint16(at + 14);
    if (view.getUint16(at) !== 1 || view.getUint16(at + 2) !== 0 || axisOffset < 16 || axisCount < 1 || axisCount > 64 || axisSize < 20 ||
        axisOffset + axisCount * axisSize > fvar.length || instanceSize < 4 + axisCount * 4 || axisOffset + axisCount * axisSize + instanceCount * instanceSize > fvar.length) throw Error("fvar records");
    const axes = [], seen = new Set();
    for (let i = 0; i < axisCount; i++) {
      const axisAt = at + axisOffset + i * axisSize, name = tag(view, axisAt), min = fixed(view, axisAt + 4), defaultValue = fixed(view, axisAt + 8), max = fixed(view, axisAt + 12);
      if (!/^[\x20-\x7e]{4}$/u.test(name) || seen.has(name) || min > defaultValue || defaultValue > max || min >= max) throw Error("fvar axis");
      seen.add(name); axes.push({ tag: name, min, default: defaultValue, max });
    }
    return { format, status: "verified", proof: "sfnt-fvar", axes, ...metadata };
  } catch (error) { return unknown(format, "invalid", error.message); }
}

/** Data URLs are owned inline bytes; remote URLs never grant a capability. */
export function fontCapabilitiesFromDataUrl(url) {
  if (typeof url !== "string" || url.length > Math.ceil(MAX_BYTES / 3) * 4 + 100) return unknown("unknown");
  const match = /^data:(?:font\/[a-z0-9-]+|application\/(?:font-woff|x-font-ttf|x-font-opentype));base64,([a-zA-Z0-9+/]*={0,2})$/u.exec(url);
  if (!match) return unknown("unknown");
  try { return inspectFontCapabilities(Uint8Array.from(atob(match[1]), character => character.charCodeAt(0))); }
  catch { return unknown("unknown", "invalid", "font data URL"); }
}

export function fontWeightAxis(capability) {
  return capability?.status === "verified" ? capability.axes.find(axis => axis.tag === "wght") : undefined;
}
export function fontFaceWeight(capability, descriptor) {
  const axis = fontWeightAxis(capability);
  // A static file's OS/2 weight is a native glyph fact, not its authored CSS
  // face declaration. A deliberate CSS alias is not an extra variable axis.
  return axis ? `${Math.max(1, axis.min)} ${Math.min(1000, axis.max)}` : String(descriptor.weight ?? 400);
}
export function fontSupportsRequest(descriptor, capability, weight, style = "normal") {
  if ((descriptor.style ?? "normal") !== style || !Number.isFinite(weight)) return false;
  const axis = fontWeightAxis(capability);
  return axis ? weight >= axis.min && weight <= axis.max : weight === Number(descriptor.weight ?? 400);
}

/** Exact static face first, otherwise a validated variable instance. No nearest/synthesis. */
export function selectFontEntry(entries, { family, weight, style = "normal", preferredId } = {}) {
  const supported = entries.filter(entry => String(entry.family ?? entry.descriptor?.family).toLowerCase() === String(family).toLowerCase() &&
    fontSupportsRequest(entry.descriptor ?? entry, entry.capabilities, weight, style));
  return supported.find(entry => (entry.id ?? entry.descriptor?.id) === preferredId) ??
    supported.find(entry => !fontWeightAxis(entry.capabilities)) ?? supported[0];
}
