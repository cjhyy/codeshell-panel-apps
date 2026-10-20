# Bundled design fonts

These are complete, unmodified official fonts. They are loaded locally with
`FontFace` and copied into content-addressed project resources when needed by a
Figma import. They require no network at runtime and do not install system fonts.
`builtin-font-catalog.mjs` pins each source URL, byte length and SHA-256; the
adjacent license files ship with the binaries.

- [Font Awesome Free 6.7.2](https://github.com/FortAwesome/Font-Awesome/tree/6.7.2/webfonts):
  solid, regular and brands WOFF2, with `Font-Awesome-LICENSE.md`. Registering
  these files under the original Font Awesome 5/6 family aliases preserves both
  older private-use code points and the newer `U+E586` glyph. Icon text is never
  substituted with Arial or generic letters.
- [Roboto](https://github.com/google/fonts/tree/bf7c667ae010c0ffb39944ae85097021478cb91d/ofl/roboto):
  full variable normal and italic TTF files, with `Roboto-OFL.md`.
- [Inter 4.1](https://github.com/rsms/inter/tree/v4.1/docs/font-files): full variable
  normal and italic WOFF2 files, with `Inter-LICENSE.md`.

The resources retain the document's original family, numeric weight and style.
Several weights of one variable font share the same verified bytes and immutable
parts. Portable SVG/HTML embeds one variable face per family/style/byte digest,
with the used weight range. Font Awesome aliases may share bytes but retain
separate CSS family names. Original Figma source text and family metadata remain
available through the source binding.

The helpers accept `readBytes(url) -> Uint8Array` for Node callers. Browser callers
read only package-local URLs and wait for `FontFace.load()` before measurement.
Unavailable or damaged bundled fonts fail explicitly. Unbundled families retain
their existing platform fallback behavior; this package does not redistribute
proprietary system fonts or claim full CJK coverage from Latin font families.

SVG's normal Host-write budget stays at 384 KiB. Local previews, screenshots and
downloads may explicitly request up to 4 MiB; raster screenshot pixel/edge limits
remain independent. Larger deliverables need a complete backup or local export,
rather than omission of font bytes.
