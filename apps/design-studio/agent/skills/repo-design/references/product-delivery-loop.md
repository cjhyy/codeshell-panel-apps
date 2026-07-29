# PRD → design → frontend → comparison

Use this workflow when the user starts from a PRD, asks for a design that can become frontend
content, or wants an implementation checked against a Design Studio source.

## 1. Build a traceable brief

Call `read_product_brief` with the workspace-relative Markdown, MDX, or text path. It returns:

- product title, summary, goals, and audience;
- requirements with stable `req-*` IDs and P0–P2 priority;
- screens or routes;
- acceptance criteria and constraints.

If the PRD is vague, make the smallest reversible assumptions needed to produce a useful first
design. Put the relevant requirement IDs in page, component, or important frame `notes`. Do not
invent a large product scope that the PRD does not support.

When working from the panel UI, the **开发** tab can read the same PRD and submit the structured
brief to the current Agent. The tool form is preferable when the Agent is already operating on the
design because the returned requirement records can be used directly.

## 2. Plan pages and components before drawing

Read `get_design_metadata`, then search existing tokens and components with
`search_design_system`. Map each screen or major state to a Design Studio page. Keep shared
components on a component page when they are reused across screens.

For normal product UI:

- use vertical Auto Layout for page sections and stacks;
- use horizontal Auto Layout for bars, rows, controls, and metadata;
- use Wrap for responsive chips, cards, and tool groups;
- use Grid for repeated equal-track content;
- choose Hug, Fill, or Fixed independently on both axes;
- use `layoutPositioning: "absolute"` only for overlays or decorations inside Auto Layout;
- keep `x/y` as resolved fallback geometry for flow children, not as their layout source.

Root-level screens may use Fill to follow the canvas width. Store breakpoint or interaction intent
in `notes` when the v3 document alone cannot express it.

## 3. Design in guarded iterations

Work one coherent region at a time:

1. inspect the smallest relevant page or subtree;
2. apply a guarded `use_design` transaction using the latest `stateRevision`;
3. call `validate_design`;
4. inspect a node crop and the complete page with `get_design_screenshot`;
5. fix the largest visual or layout defect before moving to micro-polish.

Blocking clipping, canvas overflow, or text-layout issues must be zero before frontend generation.
Contrast and content warnings still require a deliberate decision. Do not describe warnings as
harmless without reading their codes and inspecting the image.

## 4. Generate editable frontend

Call `generate_frontend` with:

- `path`: the workspace-relative `.html` output;
- optional `page_id`;
- the latest `expected_state_revision`.

The generated file is intentionally plain HTML and CSS:

- horizontal/vertical Auto Layout becomes Flexbox;
- Grid stays CSS Grid;
- Wrap becomes `flex-wrap`;
- Hug/Fill/Fixed maps to intrinsic, flexible, or fixed CSS sizing;
- Auto Layout absolute children retain responsive constraints;
- every source layer carries `data-codeshell-id`;
- `data-codeshell-source-id` preserves the originating Design v3 node;
- component instances render their master content through a scaled wrapper.

Treat the generated file as an implementation starting point, not a proprietary runtime. A
frontend engineer can split it into framework components while retaining `data-codeshell-id` on
important boundaries for later comparison.

The tool refuses to generate while blocking design issues remain. Fix the design instead of
working around that guard.

## 5. Compare implementation with the design

Call `compare_frontend` with the implementation path, the latest `stateRevision`, and optionally an
explicit viewport, root selector, and report path. It defaults to `body`; use a tighter selector
for one app shell or screen. Use the design canvas size unless the user names another breakpoint.

The tool:

1. renders the workspace HTML in an isolated browser viewport;
2. recaptures computed layout into Design v3;
3. matches source and implementation through stable IDs;
4. compares geometry and supported style fields;
5. rasterizes both Design SVGs at one viewport;
6. reports mean channel error, similarity, and changed-pixel ratio;
7. writes a Markdown report beside the implementation by default.

Read both signals:

- pixel metrics find broad visual drift even when structure changed;
- stable-ID coverage and per-node differences point to the component that should be fixed.

Prioritize missing IDs and the largest geometry delta, then typography/paint differences, then
isolated pixels. Re-run comparison after each coherent implementation change. Do not chase a
nominal 100% when the visible result, layout semantics, and acceptance criteria already match.

For a maintained repository gate, run:

```sh
npm run test:fidelity:delivery -- --output artifacts/design-studio-delivery-fidelity
```

The gate uses a realistic product interface and requires strong pixel similarity, bounded changed
pixels, at least 90% stable-ID coverage, and bounded maximum geometry drift. Review
`side-by-side.png`, `pixel-diff.png`, `generated.html`, `round-trip.codesign.json`, and
`report.json` together.

## 6. Close the traceability loop

Before finishing:

- `validate_design` has no blocking issue;
- complete-page and changed-region screenshots were inspected;
- the generated frontend path and page are named;
- the comparison report exists;
- missing IDs and largest differences are explained or fixed;
- implemented requirements are summarized by their `req-*` IDs;
- known format or browser-capture limitations are disclosed.

If implementation work intentionally diverges from the PRD, update the PRD or the design notes so
the next comparison does not encode an undocumented product decision.
