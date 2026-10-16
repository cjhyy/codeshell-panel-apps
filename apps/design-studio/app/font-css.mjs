const escapeCss = (value) =>
  String(value)
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/</gu, "\\3c ")
    .replace(/[\r\n\f]/gu, " ");

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
