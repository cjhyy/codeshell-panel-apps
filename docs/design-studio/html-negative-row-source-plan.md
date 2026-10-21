# Negative-margin row source proof (unhooked)

`app/html-negative-row-plan.mjs` is an isolated pure source planner. No adapter,
normalizer, renderer, native codec, public tool or inspector calls it. It neither
changes the current scene nor enables a previously refused layout. Every positive
result contains `activation: "blocked"` and the two remaining dependencies:
native negative-main-gap Hug behavior and the original row's inner flow model.

The first source is the frozen official Bootstrap 5.3 Features example. Current
production preserves its negative-margin Flex row as an absolute snapshot plus
the pinned converter's transparent flow placeholder. The placeholder is 24px
shorter and 24px narrower than the full real row. Removing it without preserving
the original negative interval would change geometry; retaining a fixed overlap
wrapper would keep the measured-layout failure.

## API and authority

`planHtmlNegativeRow({ root, parent, row, captures })` accepts the current
parent-relative converter tree and a capture-local `Map` keyed by current
DesignNode objects. Each real source record contains:

- `sourceId`, immutable `semanticId`, and the same `semantic` object;
- opaque actual `element` / `parentElement` identities and real direct child
  Element identities in DOM order;
- original full-precision root-relative `bounds`;
- Typed OM size/margin/padding values and actual computed transform, clipping,
  context and effect values in `css`;
- actual before/after content and direct nonblank-text status.

The Map is internal producer evidence, not serialized authority or a public JSON
admission protocol. Selector equality, a node name or an absence of semantic
metadata alone cannot establish real-source identity. The planner checks the
current graph for duplicate ids, shared objects, cycles, sparse children and
10,000-node / 32-level limits. A future hookup must build the Map during its own
current capture, rather than trusting a caller-supplied saved receipt.

The supported source pattern is deliberately narrow: two ordinary real direct
blocks, a positive-inset auto-height parent with both horizontal auto margins,
then a real static Flex row with auto width, zero bottom margin, significant
fixed-pixel negative top/side margins and no width/height-relative constraints.
The heading and row must correspond exactly to the captured direct DOM children.
Only the adjacent, unowned, paint-free pinned `neg-placeholder_…` object can be
listed for removal. Its complete expected producer shape, position, net size,
zero border/effects/padding/margins, visibility and lack of captured source must
match. The real row object, id, semantic object, children and bounds are retained.

The plan checks exact arithmetic, with no epsilon or two-decimal rounding:

```text
placeholderWidth  = rowWidth + rowMarginLeft + rowMarginRight
placeholderHeight = rowHeight + rowMarginTop
gap               = headingMarginBottom + rowMarginTop
rowLocalX         = parentPaddingLeft + rowMarginLeft
rowWidth          = parentWidth − parentPaddingLeft − parentPaddingRight
                    − rowMarginLeft − rowMarginRight
rowLocalY         = parentPaddingTop + headingHeight + gap
parentHeight      = parentPaddingTop + headingHeight + gap + rowHeight
                    + parentPaddingBottom
```

The parent auto margins are independently derived from its real DOM width owner,
the current fixed-pixel max-width (or none), and available owner content width.
When positive free space exists, the one intervening pinned `margin_…` wrapper
must have the exact same half-free-space positive padding and original bounds.
Transforms/individual transforms/zoom, clipping, effects, generated source,
positioned contexts, foreign wrappers and stale or missing evidence refuse.
Every real context node must also retain native-visible participation and actual
CSS `visibility:visible`; CSS hidden boxes retaining flow must not be confused
with native `visible:false`, which drops Auto Layout participation.

## Actual current-size contract

The browser proof used unmodified product base
`1bbe0e6a28afcba3d43ec63486d9ddc49788fa57`, CPU Chromium with `--disable-gpu`,
DPR1, and the same original complete 5691px crop at each width. All three full
source screenshots remain exactly equal to their previous frozen references.

| viewport | parent width / height | row x / y / width / height (parent local) | auto L/R |
| --- | --- | --- | --- |
| 1280 | 1140 / 509.78125 | 12 / 79.390625 / 1116 / 382.390625 | 70 |
| 768 | 720 / 919.875 | 12 / 74.71875 / 696 / 797.15625 | 24 |
| 400 | 400 / 1048 | 12 / 70.75 / 376 / 929.25 | 0 |

Each resolves to gap `−16`, original padding T48/R24/B48/L24, proposed positive
insets T48/R12/B48/L12, and heading compensation L12/R12. The 24px height
identity and 12px side bleed are observed independently at all three widths.

The original capture receipt contains **201 actual Element callback records at
each width**. A prior external prose proposal incorrectly said176; its immutable
JSON receipt was already correct. This document and the new tests record the
correction without changing the earlier evidence.

The checked-in fixtures are explicitly derived ownership-path projections.
They retain the actual ids, source boxes and current capture records needed by
the pure planner; unrelated sibling/descendant payloads and unused raw styles
are omitted. Full current converter graph runs (309/309/304 nodes), source PNG
hashes and owned-browser closure remain in external `source-plan-*.json` receipts.
The provenance file pins the unaltered local HTML, fixture bytes and the original
plus final-visibility browser receipts. Fixture ids and opaque Element tokens
come from the original capture; the later complete capture corroborated explicit
visibility at the same semantic identities. Fresh converter ids differ between
runs. These saved projections never authorize ownership in a later live import.

## Limits that remain failures

This is current-size source recovery, not a responsive or native pass. Existing
percentage/wrap and negative-gap Hug guards stay unchanged and have explicit
regressions. The original inner row can still be manual; percentage children,
media-query max widths, fluid heading sizes and nested flow need their own
representation proof. No breakpoint, min-width, font size or geometry is inferred
from the three samples. No actual native operation or GPU test ran for this
planner, and whole Features pixels/flow/native-shadow failures remain preserved.
