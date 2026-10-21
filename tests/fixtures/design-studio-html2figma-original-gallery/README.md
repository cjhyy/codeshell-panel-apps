# Original html2figma gallery

This corpus contains all 64 original runtime templates from
`cjhyy/html2figma` commit `ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c`.
It is separate from the 20 compact adaptations in `design-studio-html2figma-cases`.
No template markup, inline styles, text or resource references were rewritten.

`catalogue.json` retains the exact original runtime HTML strings and gallery
order, names, descriptions and categories. The original module sorts its array;
the catalogue therefore follows the actual displayed order. Each entry includes
the raw UTF8 HTML SHA-256 and the separately labelled `.trim()` input used by the
original single-template gallery renderer. Categories are basic 8, components 9,
layout 19 and advanced 28.

`upstream/` preserves six original web files byte for byte: both template modules,
gallery index, main script, stylesheet and standalone runtime. `sources.json`
records their hashes, the complete 221-file original source inventory and original
archive/bundle hashes. The complete source archive and browser/network artifacts
remain in the task evidence directory; the six files here are source fixtures,
not a separately installed upstream application. Original MIT declarations and
the absence of a standalone upstream license file are documented in
[the vendor notice](../../../third-party/html2figma/NOTICE.md).

The actual original gallery parses template HTML, clones style/link elements,
and places body contents in its own preview body wrapper. It does not execute
head scripts. The Ruby Tailwind loader must not be injected to improve a screenshot.
Original gallery styles, viewport and preview containment form part of the source
environment. A standalone page with a different reset is a different test.

CPU Chromium source captures cover 64templates at1280/768/400×900: 192 source root
PNGs and DOM snapshots, plus 15 whole-gallery screenshots. Actual image responses
and redirect chains are frozen per URL for later paired comparisons. Capture
rectangles, scroll sizes and overflow are explicit; root screenshots do not
claim to contain every overflowing pixel. The corpus itself establishes no Studio,
browser-canonical, CanvasKit or native conversion success. Actual Figma execution
remains **NOT_RUN**, and pixel parity is **NOT_VERIFIED**.
