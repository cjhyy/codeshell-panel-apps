# Editable CSS shadow stacks

Design Studio v3 accepts an optional `shadowStack` on Frame, Rectangle, and
Component nodes. It is mutually exclusive with the older single `shadow` field.
The original CSS list order is retained: the first layer is painted in front.

```json
{
  "basis": "css-box",
  "layers": [
    {
      "kind": "inner",
      "color": "#000000",
      "opacity": 0.15,
      "x": 0,
      "y": 2,
      "blur": 8,
      "spread": 0,
      "visible": true
    }
  ]
}
```

The bounded grammar permits 1–8 layers, six-digit RGB colors, opacity 0–1,
offsets ±500 px, blur 0–200 px, and zero spread. Unknown fields, sparse arrays,
non-finite values, unsupported shapes, and a simultaneous legacy shadow are
rejected. The inspector and `use_design` can edit order, kind, color, opacity,
offset, blur, and visibility. Save/reopen retains the values and node identities.

CSS geometry is explicit. An outer layer is cut out at the border box; an inner
layer is clipped to the padding edge, independently of fill alpha. Authored
content padding does not move this paint edge. SVG and CanvasKit paint outer
layers, fills, inner layers, then borders. Children and ancestor clips retain
their existing order. Only visible outer layers expand effect/culling bounds;
changing a layer invalidates its cached node picture.

The first implementation supports square inside borders and rounded borderless
shapes. Center/outside borders and rounded shapes with positive border widths
are rejected rather than approximating their inner curves. HTML capture promotes
the complete supported list atomically. Unsupported spread, range, or border
geometry produces a diagnostic and retains source data; it never selects just
the first layer. Frontend export uses the native CSS list and positions structured
fill backgrounds at the border box.

## Native boundary

`css-box` must not be relabeled as native painted-alpha effects. Actual native
research found that a no-fill frame with `INNER_SHADOW` paints no interior alpha,
while the corresponding CSS inset shadows remain visible. Border and translucent
fill controls also differed. A native export therefore refuses visible CSS
outer shadows, bordered or non-opaque inner masks, and unverified multicolor inner
order before mutations. Borderless opaque inner layers retain editable native
parameters with an explicit warning. Their blur pixels are not claimed equal.

Native CSS metadata is restored only when a snapshot of live geometry, fills,
strokes, corners, clipping, and effects still matches, and the actual effect
array independently matches the proposed CSS parameters. Stale metadata falls
back to raw native source with an unsupported-effects diagnostic. General native
INNER_SHADOW rendering/copy is not implemented by this field.

## Verification and recorded failures

The production HTML controls cover ordered colors, transparent fills, translucent
borders, gradient fills, inner/outer combinations, and the frozen Headers/Cover
parameters. They edit only viewport width 640→400→640, then save/reopen without
changing identities or geometry. All direct frontend controls are exact; all
zero-blur SVG controls are exact. CanvasKit checks cover masks, order, borders,
positive-blur outer culling/knockout, cache invalidation, and integer-pan reuse.
Native VM checks cover preflight atomicity, current/stale metadata, no-op binding,
concurrent coupled paint conflicts, and replacing a stack with a legacy shadow.

Blur kernels remain a strict failure. For the isolated 640/400 controls, the
Header two-inset SVG differs at 6,924/4,524 pixels (maximum channel delta 4), and
Cover's 80 px inset differs at 13,528/7,768 pixels (maximum delta 1). No threshold,
source blur, backing paint, raster image, or absolute helper was fitted to hide
these differences. CanvasKit reports an explicit unverified-kernel diagnostic.

Frozen whole-page pairs use identical HTML bytes and identical source PNGs in all
three modes. Headers changed pixels improve from 309,241/589,188/370,744 to
80,921/360,868/315,545; Cover from 418,868/419,472/329,391 to
106,413/107,017/95,557. These are **failed strict comparisons**, not page acceptance.
The evidence lives outside Git under the task's `evidence/web-corpus/` parent.

The older canonical Text-shadow multiline red zero-blur case is retained with
its original authored copy. Separate baseline and candidate runs intermittently
produce either zero differences or one known pixel at (15,57), expected
`[35,39,43,255]`, actual `[33,37,41,255]`. Its test is an explicit negative-boundary
check and records all raw metrics. It does not label the feature a strict pixel
pass, permit arbitrary channel tolerance, or replace the original copy. A derived
`position:relative` reference did not eliminate the residual; its cause remains
unproved. The baseline full main suite reproduced it before this stack feature,
so a universal strict-zero assertion is not supported by the observations.

Primary references: [CSS box shadows](https://www.w3.org/TR/css-backgrounds-3/#the-box-shadow),
[Figma Effect API](https://developers.figma.com/docs/plugins/api/Effect/).
