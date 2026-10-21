# Current HTML font-family preservation

The html2figma converter and adapter each kept only the first CSS family. On the
real WSS scrollbar-gutter article this turned the actual `ui-sans-serif,
system-ui, …` stack into `ui-sans-serif`, changing browser/SVG glyphs and wrapping.

The workspace HTML import now captures bounded private records during its real
Element callback. Before baseline/reflow measurement it restores the complete
current computed CSS family only for a unique current leaf with matching source
identity, parent/children/text/style, pseudo-font restrictions and the expected
upstream text/font projection. It never uses a selector, saved note or matching
visible text as admission authority. Unbound, replaced, mixed, variant,
over-budget or unsupported cases keep the old projection with scoped warnings.
The field remains at most 120 characters; a new stack is never truncated.

The shared parser distinguishes quoted commas, CSS escapes and quoted literal
generic-looking names. Canonical storage retains the original complete computed
CSS string. Resource descriptors retain a single literal decoded name; SVG
quotes that name correctly while keeping a compatible remaining glyph fallback
chain. The pass changes only font-family/resource binding. It does not change
source characters, source boxes, line-height, Auto Layout or paint to fit pixels.
Subsequent browser baseline and reflow measurement uses the admitted family.

New-page transfer creation refuses CSS lists, generic families and ambiguous
literal names with `NATIVE_CSS_FONT_FAMILY`. Named single families, including
existing Inter resources, keep their prior concrete SDK spelling. Raw transfer
files pass the same bounded read-only refusal before the production UI can send
them onward. These helpers do not prove installed SDK font availability or
native pixel parity. No manual native factory source is changed. The regenerated
TEXT bundle has identifier renaming; source changes outside its generated slot
remain separate from the frozen native candidate/probe.

The direct native factory/API bypass is not qualified by these browser/transfer
helpers. Existing original-node/range patch guards remain blocked. This task's
checks used CPU Chromium and software CanvasKit; no Figma, native application,
installation or existing design was exercised. A separate root peer used the
actual GPU workbench renderer to identify the resource-alias issue below.

## Evidence and limitations

Task-owned evidence is outside the repository:
`/Users/admin/.codex/worktrees/design-studio-figma-24h-20261021/evidence/web-corpus/real-stable-gutter/`.
The `handoff-receipt.json` preserves original HTML/CSS/assets, derived post-load
DOM, fetch times/hashes, intermediate failures and immutable e4bb70b sources.
At viewport 1280×900 and 400×900, full live pages are 1280×4324 and 400×6269.
The derived DOM reproduces both enabled live views at strict pixel 0. The
900px conversion comparisons are explicitly viewport crop diagnostics.

At the separate explicit 7000px-high viewport all source content fits. Live,
frozen and production reference full-page screenshots compare at strict 0 for
both 1280×7000 and 400×7000. Initial paired font candidate results against
e4bb70b are:

| Scope | Imported | Reflow | Narrow |
| --- | ---: | ---: | ---: |
| 900px crop, baseline | 141478 | 155405 | 183247 |
| 900px crop, font candidate | 118680 | 141558 | 184453 |
| 7000px whole page, baseline | 540091 | 685683 | 600215 |
| 7000px whole page, font candidate | 482233 | 670665 | 606326 |

Numbers count every unequal RGBA pixel with zero tolerance. Every conversion
remains a failed strict comparison. Narrow results worsen by 1206/6111 pixels;
this is retained, not described as a pass. The independent native CSS shadow
mask refusal also remains after the earlier font-family refusal.

`font-narrow-context-v1.json` records Range fragments, SVG text readbacks, stable
node IDs/parent chains, metric signatures and pixel-transition tiles. The narrow
title keeps the existing x=200.5, width=864, fontSize=36 while live narrow uses
x=16, width=353, fontSize=30. The fixed subtitle wrapper remains width=768 and
two lines while live narrow uses width=353 and four fragments. Its source bytes
and line-height remain unchanged and the family/signatures now match the live
CSS stack. The font correction cannot repair that existing responsive layout.
Flow results remain 198/213 covered, 15 broken and 252 unresolved relationships.

The first fixed-font test run exceeded the default 384KiB SVG budget because the
fixture embeds the complete verified Inter file. The test now explicitly uses
the existing bounded 4MiB export option used by the production fidelity harness;
no product budget was enlarged. A read-only context script initially found two
title strings (breadcrumb and H1); diagnostic association was narrowed by source
tag plus complete text, and is never used by production admission.

Focused parser/native boundary and actual CPU Chromium tests cover exact local
font bytes, quoted/escaped names, save/reopen, pre-measurement signatures, source
races, duplicate/foreign bindings, mixed/pseudo fallback and budgets. Final
combined gates, paired result pins and cleanup are recorded in the external
handoff receipt. Browser pixels, plugin VM/UI harnesses and real native execution
remain distinct categories.

## CanvasKit resource fallback correction

The first peer review found that CanvasKit's browser-raster fallback still
replaced the complete family list with its private resource alias. Real supplied
Font Awesome bytes lack the test's ordinary ASCII glyphs. With the resource
family `CaseFamily` and source family `CaseFamily, monospace`, the root's actual
workbench comparison differed by 6239 pixels: the alias-only width was 472.5,
while the complete fallback width was 501.908203125. The v1 peer evidence and
paired web-page results remain saved unchanged.

CanvasKit now retains each private alias's literal descriptor family. It replaces
only a verified matching first named source face with that alias, retaining all
later named and generic fallbacks. A first-face/resource mismatch keeps the
existing explicit resource override. No width, position, generic mapping, native
missing-glyph or ranged-text capability guard changes are involved.

The CPU software CanvasKit regression uses the same real font bytes and source
text. Matching ordinary, quoted-comma and escaped-quote names, plus a mismatched
resource control, each compare at strict pixel 0 against an independently loaded
public-family control. It records only 2d contexts and uses `CK.MakeSurface` with
`--disable-gpu`. Missing-glyph/unavailable-font diagnostics and ranged-text
refusal remain. This is a bounded renderer regression, not a whole-page or
native pixel pass. The first test setup incorrectly passed CSS quotes to the
FontFace constructor; the corrected fixture passes a literal name and reserves
CSS quoting for face selection. Both stages are recorded in the handoff.

## Full-suite pre text correction

The root's v2 actual GPU replay fixes its original 6239-pixel resource-alias
counterexample to strict 0. Its subsequent full main gate still failed one
unchanged pre-overflow assertion (731 tests: 729 pass, one fail, one skip);
the UI gate passed 106 with one skip. Those failures and receipts are retained.

The converter projects leading/trailing pre spaces to NBSP and collapses internal
space runs. Existing overflow recovery then restores the exact current raw DOM
bytes. Font admission previously required that recovered text to equal the
earlier display projection, producing an unnecessary unverified-font warning.
It now records descriptor-owned initial source/canonical text and style identities
in a private WeakMap at the actual adapter callback. A current owned pre leaf can
use its restored raw text only if the upstream projection is unchanged and both
canonical text and textSource exactly match the fresh private raw leaf. Saved
notes, manufactured provenance, changed source/canonical bytes or absent private
records do not authorize this path. Ordinary/mixed/pseudo restrictions remain.

The original overflow tests remain unchanged. Additional controls retain literal
leading/trailing NBSP, doubled spaces and blank LF lines, measure with the full
font list, and reopen with the same source bytes. Getter controls prove the
initial projection capture does not execute source/canonical accessors. No
source characters, geometry, clipping or overflow behavior is fitted or rewritten
by the font correction.
