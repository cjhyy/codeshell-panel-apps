# Capture-local distributed auto margins

Bootstrap Cover uses a vertical Flex container with header margin-bottom:auto and footer margin-top:auto. The old importer unwrapped the converter's margin containers, then kept the parent manual because trailing main-axis auto margins were unsupported. Its three direct children therefore failed the ordinary-flow audit.

The HTML importer now proves one bounded case from the current sanitized DOM and converts equal internal auto-margin boundaries to existing vertical Auto Layout space-between with zero gap. Real captured child IDs, source order, semantic notes, and Hug/Fill/fixed modes remain intact. No absolute positioning, synthetic spacer, new schema property, or native API is introduced.

## Required source proof

The callback exists only during a current HTML capture. Private original semantic/CSS/layout/child object identities and exact full-world rectangles bind it to the source graph and real Elements. Existing ancestor margin recovery can rebase coordinates while retaining those objects. Transparent upstream margin wrappers must match their pinned structure, padding and exact serialized CSSOM arithmetic. CSSOM may round a used auto margin string, so this wrapper metadata is corroborated separately from the exact real-child boxes and free-space distribution. Opaque plans are consumed once. Saved JSON and selector strings cannot provide this authority.

The proof requires a normal vertical, nonwrapping Flex line with at least two visible static real participants, DOM order zero, no generated or non-box participants, no transforms or unsafe containing spaces, no direct text, zero main gaps and fixed margins, no endpoint auto margins, and the same positive number of auto slots at every internal boundary. Source and current typed sizing/style declarations must agree. Parent padding and all distribution positions must match exactly; there is no tolerance or inferred pixel fitting.

The initial scope accepts auto cross width only. Main sizes must be auto or finite pixel lengths, with no positive minimum, maximum, percentage or non-auto flex basis. Grow is zero. Shrink is either zero or the bounded vertical automatic-height, automatic-minimum, visible-overflow path. Horizontal automatic-width shrink and relative main sizes remain unsupported. Original justification must be normal/start/flex-start or already space-between: center/end differ when free space becomes negative. Unsupported candidates retain diagnostics and the earlier guard.

CSS distributes positive free space to auto margins before justification and treats auto margins as zero otherwise. The existing canonical solver likewise distributes only positive free space and keeps zero gaps on overflow. This equivalence assumes the proved child sizing and participant topology. [CSS main-axis alignment](https://drafts.csswg.org/css-flexbox-1/#main-axis-alignment), [automatic minimum sizes](https://drafts.csswg.org/css-flexbox-1/#min-size-auto).

## Edit and native boundaries

Container resizing and supported intrinsic child growth preserve this layout. Hiding, deleting, or reordering participants requires review: a footer-only CSS child can keep its top auto margin and align at the end, while one space-between child starts at the beginning. The import warning names this fixed visible-topology limitation.

The plugin's existing VERTICAL, SPACE_BETWEEN and zero itemSpacing setters apply to newly created native frames. Figma's documented Latest layout clamps automatic gaps to zero on overflow; Legacy layout may differ, and existing frames keep their earlier behavior. This change creates no version getter, version setter, or upgrade of existing native frames. New frames use Latest by default according to the official documentation. [Latest and Legacy behavior](https://help.figma.com/hc/en-us/articles/42031586813719-Use-auto-layout-with-CSS-Flexbox-in-mind), [spacing behavior](https://help.figma.com/hc/en-us/articles/31289464393751-Use-the-horizontal-and-vertical-flows-in-auto-layout), [primaryAxisAlignItems](https://developers.figma.com/docs/plugins/api/properties/nodes-primaryaxisalignitems/).

The plugin VM test checks setters and ownership only. Actual Figma execution and native pixels for this change are NOT_RUN. The live capture proof is connected to Design Studio's HTML importer; the standalone HTML-to-Figma plugin has a separate capture route and gains no equivalent live proof merely because its generated bundle changes.

## Verification and known differences

The production pipeline test covers positive, zero and negative free space, fixed nonshrinking children, one/two auto slots at every boundary, repeated intrinsic growth, container resizing, portable save/reopen, and native transfer intent. Colored synthetic cases have strict zero changed pixels before/after reflow and at a narrow width. Twenty-two negative families preserve guards, including shrinkable definite sizes, percentage main sizes even with shrink zero, fallback alignment, unequal or endpoint auto margins, hidden/absolute/generated children, gaps, order and wrapping.

Frozen Bootstrap Cover HTML is exercised independently at 1280, 768 and 400 pixels, with source, Panel, difference, portable, transfer and resize artifacts outside the repository. Whole-page Cover source scroll height equals the 1000-pixel capture height at these original widths. The actual page still has text/font/inline-layout and responsive-header differences. A flow-audit improvement is not a whole-page pixel pass; cross-width pixels can worsen and remain recorded as failures.


The frozen final v5 capture receipt is d0d83a166b7b809cba025a8d2592761fe2161c6d3544f0fc4c45f838a99a6a08, under the task evidence directory cover-final-v5. At each original width the candidate's imported and relayout converted PNGs are byte-identical to the earlier 1bbe baseline; the three previously broken direct-child flow relationships now pass. Fifteen unresolved relationships at 1280/768 and seven at 400 remain unresolved.

| Independent import | Original pixels before/after | Reflow pixels before/after | Cross-width pixels before → after |
| --- | ---: | ---: | ---: |
| 1280 | 106,413 | 107,017 | 400: 93,225 → 95,459 |
| 768 | 87,286 | 87,871 | 400: 94,337 → 97,536 |
| 400 | 71,764 | 71,764 | 768: 118,621 → 116,674 |

Corrected resize-cause receipt 807ee53c6124ffdb56eb4be0779f2de8a21037c14635bf99d55f5026c501807c preserves the earlier diagnostic error and correction. At desktop-to-400 resize, the desktop header remains captured fixed-height 36 instead of the source media-query height 63.84375. Fill correctly narrows the three children from 640 to 368, causing main Hug growth, while captured responsive heading font sizes remain unchanged. In the 1280 import, main height becomes 286 instead of source 271.59375 and distributed main y becomes 355 instead of source 376.125. Footer y remains exactly 944. This explains the remaining responsive mismatch and why a restored layout can increase the whole-page pixel count. Candidate-before/after cross-width difference masks retain 27,423, 25,775 and 32,540 changed pixels, respectively; original-width candidate differences are zero.

The fractional live-browser control at 768 validates exact auto slot 54.890625 against the one serialized CSSOM string 54.8906px, then rejects nearby ±0.0001 wrapper padding and placement changes. This distinction does not remove the existing canonical document rounding to two decimals or fractional paint-edge differences. No pixel threshold is changed.
