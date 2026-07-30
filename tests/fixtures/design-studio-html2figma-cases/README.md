# html2figma parity cases

This offline fixture adapts 20 representative templates from the 64-template catalog in
`cjhyy/html2figma` at revision `ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c`
(`packages/test/web/templates.ts`). The markup is intentionally compact, deterministic, and free
of network resources so it can gate Design Studio capture and v3 reflow in CI.

| Case | Source template | Main coverage |
| --- | --- | --- |
| `flex-hug-fill-fixed` | `[Layout] Flex Basis Zero` | horizontal Hug / Fill / Fixed |
| `flex-column-fill` | `[Layout] HUG vs FIXED Height` | vertical Fill and footer |
| `flex-wrap-tags` | `[Layout] Text - Flex Layout with Spans` | Wrap and independent gaps |
| `grid-spans` | `[Layout] CSS Grid Layout Test` | equal Grid tracks and spans |
| `absolute-constraints` | `[Layout] Absolute Positioning Layout` | absolute children and Constraints |
| `navigation-bar` | `[Layout] Navigation Bar` | distribution and nested rows |
| `feature-cards` | `[Layout] Feature Section` | repeated Fill cards |
| `product-card` | `[Components] Product Card` | nested card and auto margin |
| `contact-form` | `[Components] Form Example` | control values and form layout |
| `basic-table` | `[Components] Table - Basic` | collapsed table geometry |
| `complex-table` | `[Components] Table - Complex` | table spans and spacing |
| `mixed-inline-text` | `[Basic] Text - Multiple Inline Spans` | mixed inline typography |
| `text-overflow` | `[Advanced] Text - Overflow and Wrapping` | wrapping and ellipsis |
| `semantic-list` | `🌟🌟🌟 [Basic] List Markers & Semantic Tags` | lists and block content |
| `svg-vectors` | `[Advanced] SVG Vector Test` | editable SVG primitives |
| `borders-shadows` | `[Advanced] Box Shadow Transparency` | borders, radii, and shadows |
| `nested-relative` | `[Advanced] Relative + Flex Mixed Layout` | nested relative Flex |
| `dashboard-widget` | `[Advanced] Dashboard Widget` | dense Grid/Flex composition |
| `reverse-min-max` | `[Layout] Flex Direction and Min Max` | reverse flow and bounded Fill |
| `baseline-alignment` | `[Layout] Baseline Alignment` | mixed-size text baseline |

Run all cases with:

```sh
npm run test:fidelity:cases -- --output artifacts/design-studio-html2figma-cases
```

Each case compares source HTML against editable Design SVG at its import width and again after
shrinking from 760 px to 520 px. The output includes source/converted screenshots, amplified
diffs, side-by-side images, both `.codesign.json` documents, audit summaries, and `report.json`.
The initial gate requires SSIM ≥ 0.94 and no more than 8% of pixels changing by over 24 channel
levels. The narrow-width gate requires SSIM ≥ 0.87 and no more than 12% changed pixels. Both
require zero blocking layout issues and the expected Auto Layout, Grid, Wrap, reverse-flow,
Min/Max, Baseline, or absolute-child structure for each case.
