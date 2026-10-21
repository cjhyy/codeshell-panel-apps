import { parseDesignFontFamily } from "./font-family.mjs";

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

/** Variable built-in weights share one full font URL, keeping portable exports bounded. */
export function designFontFaceCss(resources = [], resourceDataUrls = new Map()) {
  const urls =
    resourceDataUrls instanceof Map ? resourceDataUrls : new Map(Object.entries(resourceDataUrls));
  const groups = new Map();
  for (const resource of resources) {
    if (resource.kind !== "font" || !urls.has(resource.id)) continue;
    const variable = /^builtin-(?:roboto|inter)(?:-italic)?-/u.test(resource.id);
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
    };
    group.weights.push(resource.weight);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(
      ({ resource, url, weights, variable }) =>
        `@font-face{font-family:"${escapeCss(resource.family)}";src:url("${escapeCss(url)}");font-weight:${variable ? `${Math.min(...weights)} ${Math.max(...weights)}` : resource.weight};font-style:${resource.style};font-display:block;}`,
    )
    .join("\n");
}
