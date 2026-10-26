import { parseDesignFontFamily } from "./font-family.mjs";
import { fontCapabilitiesFromDataUrl, fontFaceWeight, fontWeightAxis } from "./font-capabilities.mjs";
const runtimeFamilies = new WeakMap();

const escapeCss = (value) =>
  String(value)
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/</gu, "\\3c ")
    .replace(/[\r\n\f]/gu, " ");

const genericFamilies = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

/** Family names containing digits need CSS string quotes, including Font Awesome 5/6. */
export function designFontFamilyCss(family = "Inter, ui-sans-serif, system-ui, sans-serif") {
  const parsed = parseDesignFontFamily(String(family));
  if (parsed) return parsed.map(({ name, generic }) =>
    generic ? name.toLowerCase() : designNamedFontFamilyCss(name)).join(", ");
  // Keep the historical rendering fallback for invalid/over-budget existing
  // documents. HTML import reports why an exact current family was not admitted.
  return String(family)
    .split(",")
    .map((value) => {
      const name = value.trim().replace(/^(["'])(.*)\1$/u, "$2");
      return genericFamilies.has(name.toLowerCase()) ? name.toLowerCase() : `"${escapeCss(name)}"`;
    })
    .join(", ");
}

/** Resource descriptors contain one literal font name, including any comma. */
export function designNamedFontFamilyCss(family) {
  return `"${escapeCss(family)}"`;
}

/** A verified first-face resource must not discard the remaining glyph fallback chain. */
export function designResourceFontFamilyCss(family, resourceFamily, alias = resourceFamily) {
  const parsed = parseDesignFontFamily(family), first = parsed?.[0];
  if (!first || first.generic || first.name.toLowerCase() !== resourceFamily.toLowerCase())
    return designNamedFontFamilyCss(alias);
  if (alias === resourceFamily) return designFontFamilyCss(family);
  // A private FontFace aliases this exact first resource. Only replace that
  // named item; retain every remaining named/generic glyph fallback.
  return [designNamedFontFamilyCss(alias), ...parsed.slice(1).map(({name,generic}) =>
    generic ? name.toLowerCase() : designNamedFontFamilyCss(name))].join(", ");
}

/** Private runtime aliases do not change the canonical 120-unit family contract. */
export function createDesignRuntimeFontFamily(family, { resourceFamily, resourceAlias, aliases = [] } = {}) {
  const parsed = parseDesignFontFamily(family);
  if (!parsed || !Array.isArray(aliases) || aliases.length > 32) throw Error("Invalid canonical runtime font source");
  const literal = value => typeof value === "string" && value.length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(value);
  if (!aliases.every(value => value && literal(value.name) && literal(value.alias))) throw Error("Invalid runtime font alias");
  const first = parsed[0];
  const selected = resourceAlias !== undefined;
  if (selected && (!literal(resourceFamily) || !literal(resourceAlias))) throw Error("Invalid primary resource font alias");
  const explicitOverride = selected && (first.generic || first.name.toLowerCase() !== resourceFamily.toLowerCase());
  const css = explicitOverride ? designNamedFontFamilyCss(resourceAlias) : parsed.map((part, index) => {
    if (part.generic) return part.name.toLowerCase();
    const alias = selected && index === 0 ? resourceAlias : aliases.find(value => value.name.toLowerCase() === part.name.toLowerCase())?.alias;
    return designNamedFontFamilyCss(alias ?? part.name);
  }).join(", ");
  if (new TextEncoder().encode(css).length > 16 * 1024) throw Error("Runtime font CSS exceeds its separate 16 KiB budget");
  const token = Object.freeze({}); runtimeFamilies.set(token, css); return token;
}

export function designRuntimeFontFamilyCss(token) {
  if (!runtimeFamilies.has(token)) throw Error("Runtime font CSS requires a private generated family token");
  return runtimeFamilies.get(token);
}

/** Resource-backed named fallbacks participate in the same CSS family search. */
export function designTextFontResourceIds(node, resources = []) {
  if (node?.type !== "text") return [];
  const ids = new Set(node.fontRef ? [node.fontRef] : []);
  const parsed = parseDesignFontFamily(node.fontFamily), selected = resources.find(resource => resource.id === node.fontRef);
  const baseFamilies = !parsed || selected && (parsed[0].generic || parsed[0].name.toLowerCase() !== selected.family.toLowerCase()) ? [] : parsed;
  const ranges = (node.textRanges?.ranges ?? []).flatMap(range => range.fontFamily === undefined ? [] : parseDesignFontFamily(range.fontFamily) ?? []);
  const names = new Set([...baseFamilies, ...ranges].filter(part => !part.generic).map(part => part.name.toLowerCase()));
  for (const resource of resources) if (resource.kind === "font" && names.has(resource.family.toLowerCase())) ids.add(resource.id);
  return [...ids];
}

/** Variable built-in weights share one full font URL, keeping portable exports bounded. */
export function designFontFaceCss(resources = [], resourceDataUrls = new Map()) {
  const urls =
    resourceDataUrls instanceof Map ? resourceDataUrls : new Map(Object.entries(resourceDataUrls));
  const groups = new Map();
  for (const resource of resources) {
    if (resource.kind !== "font" || !urls.has(resource.id)) continue;
    const capabilities = fontCapabilitiesFromDataUrl(urls.get(resource.id));
    const variable = Boolean(fontWeightAxis(capabilities));
    const key = JSON.stringify([
      resource.family,
      resource.style,
      resource.sha256,
      variable ? null : resource.weight,
    ]);
    const group = groups.get(key) ?? {
      resource,
      weights: [],
      url: urls.get(resource.id),
      variable,
      weight: fontFaceWeight(capabilities, resource),
    };
    group.weights.push(resource.weight);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(
      ({ resource, url, weight }) =>
        `@font-face{font-family:"${escapeCss(resource.family)}";src:url("${escapeCss(url)}");font-weight:${weight};font-style:${resource.style};font-display:block;}`,
    )
    .join("\n");
}
