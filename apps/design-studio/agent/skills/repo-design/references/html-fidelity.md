# HTML fidelity reference

Use this reference when importing HTML, changing capture/layout behavior, or reporting visual
fidelity.

## Supported responsive mapping

- Map Flex rows/columns, `row-reverse`/`column-reverse`, Wrap/Wrap Reverse, independent axis gaps,
  four-side padding, distribution, Baseline alignment, equal positive grow, and Min/Max dimensions
  to editable Auto Layout.
- Map equal-track CSS Grid to `gridColumns` with child column/row spans.
- Map independent horizontal/vertical sizing to Fixed, Hug, or Fill.
- Map absolute/fixed direct children to `layoutPositioning: "absolute"` with start, center, end,
  stretch, or scale Constraints and measured insets.
- Preserve measured absolute `x/y` as initial and fallback geometry. Let Auto Layout own only
  direct flow-child positions after reflow.
- Preserve form values, wrapping, ellipsis source text, browser text baselines, borders, clipping,
  and one non-inset shadow.

Fall back to measured manual geometry for unequal Flex grow factors, floats, unequal Grid tracks,
or decoration-heavy controls. Approximate four unequal corner radii with one representative
radius. Do not claim pixel-perfect support for raster images, SVG paths/references, gradients,
pseudo-elements, multiple backgrounds/shadows, filters, or rich text runs.

## Measurement loop

Render the HTML and exported Design SVG in the same browser, viewport, device scale, and font
environment. Save source, converted, side-by-side, and amplified-difference screenshots. Report
mean absolute channel error, changed-pixel ratios at explicit thresholds, and windowed SSIM.
Fix the largest connected difference region first.

Run the maintained 960×640 product fixture:

```sh
npm run test:fidelity -- --output artifacts/design-studio-html-fidelity
```

Require initial windowed SSIM ≥ 0.99, pixels changing by more than 8 levels ≤ 1%, pixels changing
by more than 24 levels ≤ 0.6%, and at least 20 Auto Layout containers. After reflow, require SSIM
≥ 0.86, changed-pixel ratios ≤ 8%/6%, and zero blocking issues.

Run the adapted html2figma catalog before changing capture or layout:

```sh
npm run test:fidelity:cases -- --output artifacts/design-studio-html2figma-cases
```

The 20 cases cover dual-axis Hug/Fill/Fixed, Min/Max, reverse flow, Wrap, Grid spans, absolute
Constraints, Baseline, navigation, cards, forms, tables, inline text, lists, SVG primitives,
effects, nesting, and dashboards at import and narrow widths. Require initial SSIM ≥ 0.94 with
changed pixels ≤ 8%, narrow-width SSIM ≥ 0.87 with changed pixels ≤ 12%, and zero blocking issues.

Use the opt-in public-page probe only for diagnostics:

```sh
npm run test:fidelity:real -- --output artifacts/design-studio-real-html-fidelity
```

Normalize the converted document, call `validate_design`, and inspect a Design Studio screenshot
before editing it further. Use `app/html-capture.mjs` directly only while developing the importer
or its browser fixtures.
