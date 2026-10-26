/** The canonical weight/style tuple selects one explicit native font face. */
export function nativeTextFontName(source) {
  const family = source.fontFamily ?? "Inter", weight = source.fontWeight ?? 400, style = source.fontStyle ?? "normal";
  if (typeof family !== "string" || !family.length || family.length > 120 || family !== family.trim() ||
      /[\u0000-\u001f\u007f,"'\\]/u.test(family) ||
      ![100,200,300,400,500,600,700,800,900].includes(weight) || !["normal", "italic"].includes(style)) {
    const error = new Error("Native range fonts require one literal family and a supported weight/style tuple.");
    error.code = "TEXT_RANGES_NATIVE_UNSUPPORTED_FONT";
    throw error;
  }
  if (/^Font Awesome [56] (Free|Brands)$/u.test(family)) {
    if (style !== "normal") {
      const error = new Error("Native icon font ranges do not support an italic face.");
      error.code = "TEXT_RANGES_NATIVE_UNSUPPORTED_FONT";
      throw error;
    }
    return { family, style: family.endsWith(" Brands") || weight < 600 ? "Regular" : "Solid" };
  }
  const base = { 100:"Thin", 200:"Extra Light", 300:"Light", 400:"Regular", 500:"Medium",
    600:"Semi Bold", 700:"Bold", 800:"Extra Bold", 900:"Black" }[weight];
  return { family, style: style === "italic" ? base === "Regular" ? "Italic" : `${base} Italic` : base };
}
