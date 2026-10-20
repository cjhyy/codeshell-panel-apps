# HTML baseline refresh after typography edits

The number-line-height change preserves the CSS ratio, but the HTML hanging
offset stayed at its capture value when font size changed. In the paired Arial
19→24→19 fixture on `73d9ea0`, SVG changed 0→865→0 pixels while frontend CSS
stayed exact. The original references, failed PNGs and SVGs remain immutable in
`evidence/html-lineheight-intent-research/font-edit-paired`.

The new text-only provenance value `layoutBaselineSource: "html"` identifies an
existing verified ordinary HTML text recovery. It is distinct from native
Figma line-box provenance. The import must have an actual capture Element and
the existing single-style plain/pre/nowrap recovery contract. It enables
refresh only if the loaded browser font's `lineBoxOffset` reproduces the
captured y exactly. Import changes no geometry to obtain that proof. A mismatch
keeps the old baseline and emits `html-text-baseline-fixed`.

The shared layout refresh uses the current font, size, weight, style, letter
spacing, line height and line-height unit. It preserves the logical top
`y - layoutBaselineOffset`; width and text changes keep their existing text
measurement and wrapping paths. Node-only reflow retains provenance until a
browser measurer becomes available. Schema validation and save/reopen retain
the enum. Mixed, pseudo, bordered and otherwise unsupported sources do not
gain provenance. Untagged manually positioned text and existing native behavior
stay unchanged. An explicit public baseline-offset edit retires only HTML
refresh, so the requested manual offset remains authoritative.

The public tool schema continues to expose the existing nullable numeric
baseline offset, without adding a provenance editing API. HTML provenance is
omitted from native transfer; the physical offset still projects y to the
native line-box origin. Source binding continues to compare logical y, so
baseline-only metadata updates cannot create native translation operations.

New CPU browser checks compare every RGBA channel for SVG and frontend output
through 19→24→19, font-family/line-height changes, width 400 and save/reopen.
Initial captured node geometry remains exact. The same-base paired evidence
under `evidence/html-baseline-refresh-20261021/font-edit-paired` preserves the
old 865-pixel failure and records 0→0→0 for the candidate; frontend stays 0
for both. This is browser-font evidence, without a native Figma font claim.
All browser launches explicitly disable GPU. Native probes, registered plugin
files and existing source evidence are outside this change.

Paired frozen GOV Check Answers and no-actions captures retain all 3225 checked
geometry/baseline fields exactly across import, reflow and narrow modes. The
bounded provenance applies to 8 of 58 and 2 of 9 Text nodes respectively; the
other sources keep their old measured behavior. Reference PNGs are byte-identical
before/after and whole-page failures remain 28133/28133/63753 and
7536/7536/14116 pixels. These counts do not establish complete ordinary flow or
CSS media-query responsiveness.

The scoped CPU gate passed all 136 tests; the final new test file passed 6/6
after adding pre/nowrap and nullable manual-offset controls. Typecheck, validation,
the Design Studio package check and all three generated checks passed. Source-only
peer review found no concrete blocker. Figma UI adapter output is regenerated;
native plugin main and standalone HTML UI behavior are unchanged.
