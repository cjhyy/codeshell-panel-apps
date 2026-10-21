# Responsive CSS linear gradient intent

Base: `129158f`. Scope: bounded CSS gradient geometry and its rendering/transfer
behavior. Existing native Figma paints keep their normalized-handle semantics.

## Problem and evidence

CSS angles are physical angles in the current painting box. Pixel stops refer
to the current gradient line's physical length. A single normalized Figma handle
snapshot cannot retain both when the layer's aspect or size changes. The real
45-degree Fill fixture is exact at 640px, then differs at 22,783 pixels when
narrowed to 400px. Its original angle became tied to the captured aspect ratio.

References: [CSS gradient geometry](https://www.w3.org/TR/css-images-3/#linear-gradients),
[CSS stop fixup](https://www.w3.org/TR/css-images-3/#color-stop-fixup), and
[Figma GradientPaint](https://developers.figma.com/docs/plugins/api/Paint/#gradientpaint).

## Bounded representation

Add optional `cssLinear` only to `GRADIENT_LINEAR` paint records. It contains
structured geometry, never executable or arbitrary CSS:

- `direction`: either `{angle: number}` in normalized CSS degrees, or
  `{corner: [horizontal, vertical]}` with each component -1 or 1. Cardinal
  keywords become cardinal angles; named corners retain their size-dependent
  direction.
- `positions`: 2–16 entries, one per existing editable color stop. Each is
  `null` (an omitted CSS position), or `{unit: "px" | "percent", value: number}`.
  Numeric values have absolute limit 20,000. The reserved `"previous"` entry
  duplicates the preceding transparent stop's position, so the native RGB
  interpolation workaround does not turn an omitted CSS stop into a new stop
  during distribution. It requires adjacent zero-alpha stops and cannot chain.
  Stop colors/alpha continue to live in the existing editable `stops` array.
- Optional `sourceOnly: true`: retain authored geometry as provenance while
  rendering the normalized native paint snapshot. This is used when an imported
  native layer has diverged from the CSS geometry, including native resizing.

Existing `handles` and normalized `stops[].position` remain a valid initial
snapshot and support old documents/native APIs. With active CSS intent, those
coordinates are fallback data; the structured geometry is authoritative.
Changing stop count requires matching geometry positions. Color edits do not
require a second color copy. Inactive source-only positions can retain their
original count after a native stop edit. Source snapshots validate the same
paint grammar, dimensions 1–20,000 and a 32 KiB ceiling.

## Resolution and rendering

Resolve active CSS geometry from current width/height at paint consumption:
physical gradient direction/length, CSS endpoint defaults, monotonic stop
fixup, omission distribution, and existing bounded outer-stop extension. Apply
the result consistently to SVG, CPU sampling, CanvasKit, and native export.
Frontend export emits safe generated CSS linear gradients for active intent,
so browser Flex/Grid resizing also preserves the physical angle and units.
Native/legacy paints retain vector SVG fallback and normalized behavior.

Paint comparison includes authored intent and editable colors, and ignores
obsolete fallback snapshot coordinates for active CSS intent. Legacy and
source-only paints continue to compare normalized handles/stops.

## Native boundary

Export the resolved current appearance as an editable native gradient. Emit a
diagnostic for non-cardinal physical angles and nonzero pixel stops: arbitrary
native resizing cannot promise CSS angle/pixel-stop behavior. Do not claim a
native polyfill or silently reapply CSS after a user edits Figma.

Retain a bounded validated source-paint snapshot in plugin data and supplement
the plugin's JSON export with it. On import, restore active geometry only when
native paint geometry still agrees at the current dimensions and its layer
association is provable. Colors identify moved equal-geometry layers; distinct
geometry permits a native palette edit. Reordered or ambiguous layers with
different future intent remain source-only. Otherwise retain
it as `sourceOnly` and diagnose the native divergence. If native stop topology
was changed, preserve original source provenance in the exported source bundle
and diagnose that it cannot be attached to the new stop list.
Inactive source cannot become active merely because the dimensions later match.
An explicit authored descriptor edit is needed to remove `sourceOnly`.

Native/legacy handles retain their existing ±100 normalized-coordinate input
bound. A CSS descriptor edit or extreme aspect ratio can render geometry outside
that interchange subset. SVG/frontend/CanvasKit can still evaluate that bounded
numeric intent, while native transfer generation and native preflight reject it
with an actionable current-size error before mutation. This change does not
expand arbitrary native paint geometry acceptance. Explicit Design Studio resize
patches guard concurrent native paint/source edits before replacing the snapshot.

The standalone HTML plugin creates the current snapshot and displays a native
resize limitation warning. Preserving editable CSS geometry through v3 and
source plugin data uses the separate Design Studio → Design Bridge workflow.

## Validation

Real browser capture/save/reopen/resize/edit fixtures cover 45 degrees,
negative angles, non-square dimensions, px/percent/omitted/outside stops,
named corners, and supported layered alpha. Keep exact differing-pixel counts;
small backend quantization residuals remain explicit failures. Unit tests cover
metadata bounds, comparison, legacy invariance, native current-size conversion,
source-only retention, and missing/stale native metadata. GPU checks wait for
the root's available window; actual Figma UI remains root-owned.

## Recorded results

Evidence under the aggregate worktree's `evidence/gradient-responsive-angle/`:

| Case                                    | Import 640 | Relayout 640 | Narrow 400 | Maximum channel delta |
| --------------------------------------- | ---------: | -----------: | ---------: | --------------------: |
| Original 45° repro, `css-intent-first`  |          0 |            0 |          0 |                     0 |
| 45° matrix                              |          0 |            0 |          0 |                     0 |
| -30° with px/% stops                    |         14 |           14 |          4 |                     1 |
| Outside mixed px/%/omitted stops        |        103 |          103 |         95 |                     1 |
| Layered alpha with angled/corner paints |     41,216 |       41,216 |     23,725 |                     2 |

Counts are exact differing pixels. The latter three cases still fail the strict
production gate; no tolerance or allowed ratio changed. Their SVG backend
quantization residuals are retained in `css-intent-matrix/report.json`.
The named-corner control in `gradient-responsive-baseline/css-intent-control`
is 0/0/0 (the old narrow result was 38 pixels, maximum delta 1).

Generated frontend CSS is exact at 640×160, 400×160, and 200×320 for all four
gradient classes, including transparent interior stops and color edits. The real
CanvasKit GPU resize test matches a fresh current-size native paint snapshot at
every pixel for width and height changes, while the frozen old snapshot differs.
Native VM tests verify source plugin data, official JSON supplementation, inactive
intent after native resize, and preflight rejection of invalid descriptors.
Actual native Figma acceptance remains root-owned and is not claimed here.

Final scoped gate: Design Studio main command 421 pass / 1 existing optional skip / 0 fail; focused real CanvasKit shape + glyph resize test passes. Typecheck, package validation and deterministic Figma/HTML plugin generation checks pass. The whole-repository committed build check detects an existing stale Video Studio package; no Video Studio files were changed by this task.
