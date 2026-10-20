import { BUILTIN_DESIGN_FONTS } from "./builtin-font-catalog.mjs";
import { createDesignResourcePersistencePlan, designResourcePartPath } from "./resource-store.mjs";

const loadedFaces = new WeakMap();
const textNodes = (document) => {
  const nodes = new Map();
  const visit = (values) => {
    for (const node of values ?? []) {
      if (node.type === "text") nodes.set(node.id, node);
      visit(node.children);
    }
  };
  for (const page of document.pages ?? []) visit(page.nodes ?? page.children);
  visit(document.nodes);
  return [...nodes.values()];
};

export function builtinDesignFontForNode(node) {
  const family = String(node.fontFamily ?? "")
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/gu, "");
  const style = node.fontStyle === "italic" ? "italic" : "normal";
  const weight = Number(node.fontWeight) || 400;
  return (
    BUILTIN_DESIGN_FONTS.find(
      (font) =>
        font.families.includes(family) &&
        font.style === style &&
        (font.id !== "fa-solid" || weight >= 600) &&
        (font.id !== "fa-regular" || weight < 600),
    ) ?? null
  );
}

export async function readBuiltinDesignFontBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Bundled design font is unavailable: ${url.pathname}`);
  return new Uint8Array(await response.arrayBuffer());
}

const sha256 = async (bytes) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const encode = (bytes) => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
};

async function fontBytes(font, readBytes, hash) {
  const value = await readBytes(new URL(font.file, import.meta.url));
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.length !== font.bytes || (await hash(bytes)) !== font.sha256)
    throw Error(`Bundled design font integrity check failed: ${font.id}`);
  return bytes;
}

/** Attach complete verified font resources to editable text; never rewrite its family or glyphs. */
export async function prepareBuiltinDesignFontResources(
  document,
  { readBytes = readBuiltinDesignFontBytes, sha256Bytes = sha256 } = {},
) {
  const existing = new Map((document.resources ?? []).map((item) => [item.id, item]));
  const assignments = [];
  const files = new Map(),
    plans = new Map(),
    faces = [],
    parts = new Set();
  for (const node of textNodes(document)) {
    if (node.fontRef) continue;
    const font = builtinDesignFontForNode(node);
    if (!font) continue;
    const family = String(node.fontFamily)
      .split(",")[0]
      .trim()
      .replace(/^["']|["']$/gu, "");
    const weight = Number(node.fontWeight) || 400;
    const style = node.fontStyle === "italic" ? "italic" : "normal";
    const alias = family.includes(" 5 ") ? "-5" : family.includes(" 6 ") ? "-6" : "";
    const id = `builtin-${font.id}${alias}-${weight}-${style}`;
    if (!plans.has(id)) {
      if (!files.has(font.id)) files.set(font.id, fontBytes(font, readBytes, sha256Bytes));
      const bytes = await files.get(font.id);
      const plan = await createDesignResourcePersistencePlan({
        id,
        kind: "font",
        mime: font.mime,
        family,
        weight,
        style,
        base64: encode(bytes),
        sha256Bytes,
      });
      if (existing.has(id) && JSON.stringify(existing.get(id)) !== JSON.stringify(plan.descriptor))
        throw Error(`Built-in font resource ID conflicts with the design: ${id}`);
      existing.set(id, plan.descriptor);
      faces.push({ descriptor: plan.descriptor, bytes });
      plan.parts = plan.parts.filter((part) => {
        if (parts.has(part.path)) return false;
        parts.add(part.path);
        return true;
      });
      plans.set(id, plan);
    }
    assignments.push([node, id]);
  }
  document.resources = [...existing.values()];
  for (const [node, id] of assignments) node.fontRef = id;
  return { document, resourcePlans: [...plans.values()], faces };
}

/** Wait for real local FontFaces before canvas/SVG text measurement. No generic icon fallback. */
export async function ensureBuiltinDesignFonts(
  document,
  {
    readBytes = readBuiltinDesignFontBytes,
    sha256Bytes = sha256,
    fontSet = globalThis.document?.fonts,
    FontFaceConstructor = globalThis.FontFace,
    faces,
  } = {},
) {
  if (!fontSet || typeof FontFaceConstructor !== "function") return { available: false, loaded: 0 };
  if (!faces) {
    const draft = structuredClone(document);
    for (const node of textNodes(draft))
      if (node.fontRef?.startsWith("builtin-")) delete node.fontRef;
    faces = (await prepareBuiltinDesignFontResources(draft, { readBytes, sha256Bytes })).faces;
  }
  let cache = loadedFaces.get(fontSet);
  if (!cache) {
    cache = new Map();
    loadedFaces.set(fontSet, cache);
  }
  for (const { descriptor, bytes } of faces) {
    const key = JSON.stringify([
      descriptor.family,
      descriptor.weight,
      descriptor.style,
      descriptor.sha256,
    ]);
    if (!cache.has(key)) {
      const operation = (async () => {
        const face = new FontFaceConstructor(
          descriptor.family,
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          { weight: String(descriptor.weight), style: descriptor.style },
        );
        await face.load();
        fontSet.add(face);
      })();
      cache.set(key, operation);
      void operation.catch(() => cache.delete(key));
    }
    await cache.get(key);
  }
  await fontSet.ready;
  return { available: true, loaded: faces.length };
}

/** Resolve URLs even when several weight descriptors share one set of immutable parts. */
export function resourceDataUrlsFromPlans(plans) {
  const parts = new Map(
    plans.flatMap((plan) => plan.parts.map((part) => [part.path, part.content])),
  );
  return new Map(
    plans.map(({ descriptor }) => {
      const base64 = Array.from({ length: descriptor.partCount }, (_, index) => {
        const content = parts.get(designResourcePartPath(descriptor, index));
        if (typeof content !== "string")
          throw Error(`Prepared resource is missing a part: ${descriptor.id}`);
        return content;
      }).join("");
      return [descriptor.id, `data:${descriptor.mime};base64,${base64}`];
    }),
  );
}
