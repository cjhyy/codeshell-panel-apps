# Plain text container flow: bounded capture identity

Base: `881688e02e69b5dffed444573889963638eb8c43`; new dependent worktree after
fresh origin fetch and ancestor verification. CPU Chromium only; native Figma,
registered plugin, GPU and CanvasKit remain root-owned.

## Existing behavior and observed root cause

`planHtmlBlockFlow` deliberately leaves a container with one text child to
`enableHtmlTextReflow`. That browser recovery currently finds its original DOM
element using only `notes.cssSelector`, and silently skips when that selector
matches anything except exactly one element. The converter's selectors describe
tag/classes and are not necessarily unique.

On the exact frozen GOV source at this base, all three `h2.govuk-heading-m` and
all three `p.govuk-body` frames have a single real text child and remain Freeform.
Each selector matches three elements. This prevents otherwise ordinary text
frames from receiving vertical Auto Layout and their text from receiving native
Fill/Hug relationships. Their matching CSS classes are not unique source IDs.

The current corpus contains 25 Freeform single-text candidates. Many are actual
`table-cell` dt/dd boxes, which this task must not reclassify as ordinary blocks.
The footer link is inline. Back/Change/button controls additionally contain
absolute generated or visually-hidden descendants; they are not single-child
plain text cases and remain excluded. The earlier provisional audit does not
show these complete child structures.

The complete frozen same-base baseline is **23329 / 23329 / 54075**, a strict
failure. Raw canonical files and DOM/selector/style inventory are retained under
aggregate `evidence/plain-text-flow/{baseline-881688e,plain-parent-inventory-881688e.json}`.

## Root-reviewed minimum scope

Retain an exact, capture-local semantic-ID-to-DOM binding at the maintained
conversion boundary; mark duplicate IDs as ambiguous. DOM elements never enter
the serialized design or native transfer. No new canonical field is needed.
Plain text recovery should use that exact original source relationship instead
of broadening ambiguous selector matching or guessing by displayed text.

Only a block/inline-block frame with one real text child, no real child elements,
generated content or mixed runs, normal whitespace, horizontal LTR writing,
supported line height/baseline, no transform/indent/word-spacing/text-transform
and zero border is in the first subset. Existing fixed/Fill/Hug sizing intent
still applies; table cells, arbitrary inline boxes and generated controls stay
diagnosed/measured. Inert transparent ordinary wrappers do not require absolute
positioning to retain the real text child.

Preserve source characters and baseline provenance. In particular, normal CSS
ASCII whitespace collapse must not use JavaScript `\\s` to erase NBSP. Retain
complete original whitespace provenance when the visible CSS string differs.
The primary whitespace rules are
[CSS Text 3](https://www.w3.org/TR/css-text-3/#white-space-processing).

## Required checks

Use identical repeated tag/class selectors and repeated text with differing
fonts/line heights to prove exact source identity, with nested/deduplicated IDs
as explicit rejection controls. Compare real baseline pixels, width changes,
fixed-height edits, source-text edits, following-block flow and save/reopen.
Assert actual parent vertical layout and a single real text child with native
Hug/Fill, original characters and measured baseline; generic AUTO flags or an
empty outer-root semantic report are insufficient. Retain table/complex inline,
generated, mixed-run, RTL and unsupported styling counterexamples. Pair frozen
GOV with this unchanged base and preserve all remaining strict failures.

## Implemented result

The maintained runtime reports each real element through an optional callback.
Its owning capture retains a semantic-ID→Element map only in memory. The same
element referenced again is harmless; different elements sharing an ID mark it
ambiguous. Missing/ambiguous bindings use only the old unique-selector fallback
and emit `html-text-source-binding`, including when fallback succeeds. No first
match or visible-text guess is used. Form controls, table cells, arbitrary inline
boxes, generated/mixed content and special styling remain outside this subset.

Upstream normal text can replace real NBSP with SPACE or append an NBSP spacer.
A separate comparison accepts only that legacy shape; active text and measured
wrapping use the exact bound DOM source with ASCII-only collapse. NBSP remains
unchanged. Different original ASCII whitespace is preserved in bounded,
read-only `notes.htmlTextOriginal`, with no runtime replay. Language-dependent
non-ASCII segment breaks remain conservative. No new canonical field is added.

The final same-base GOV pair remains **23329 / 23329 / 54075**, strictly failing.
All three source PNG byte streams are identical and converted decoded pixels
also remain identical before/after. Node count stays 188 and every source ID and
parent stays unchanged. Exactly six original h2/p frames become vertical Auto
Layout with one real Fill-width/Hug-height text child. Nineteen single-text
Freeform cases remain (17 table cells, one inline footer link and one synthetic
wrapper without an original DOM binding). Warnings rise from 55 to 74 by making
those unsupported cases explicit; their omission is not presented as success.

The minimal duplicate-selector fixture passes strict **0 / 0 / 0** through the
real production capture, portable file and outer-only resize. Its repeated
titles use different font sizes/line heights, so incorrect first-match binding
cannot pass by coincidence. Browser regressions also compare exact SVG pixels,
actual source box geometry, original NBSP and ASCII provenance at full/narrow
widths, after content edits and a fixed height edit, and after save/reopen.
Colliding identities retain measured layout; a distinct unique selector can
recover conservatively with an explicit binding diagnostic. No layers are added
by plain-text promotion, and no absolute positioning is introduced.

Evidence: aggregate `evidence/plain-text-flow/paired-baseline-receipt.json`,
`plain-parent-inventory-881688e.json`, `baseline-881688e`, `after-final-881688e`
and `minimal-final`. These are CPU Chromium (`--disable-gpu`) reports, not native
Figma acceptance. Four related browser/import/ellipsis/text-metric files pass
**52/52**; typecheck and validation pass. Root owns the combined main/UI/native
gates after integration.

Browser/Bridge/standalone generation checks, scoped native-app build check and
`git diff --check` pass. Browser bundle SHA-256 is
`69a74cb1d75f1c30a8e333cfa2bd9b45702aecc3d5db367fcaa1d242b21dbc21`;
the generated standalone UI embeds those reviewed bytes. Immutable upstream
sources remain untouched.
