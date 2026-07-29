# CodeShell Panel Apps

Desktop Panel Apps for [CodeShell](https://github.com/cjhyy/codeshell). A
schema-v2 app may package its sandboxed UI, declared Agent tools, and read-only
Skills behind one reviewed installation. General Agents, Commands, Hooks, MCP
servers, and arbitrary plugin backends remain outside Panel Apps.

## Included apps

| App           | Subdirectory         | Purpose                                                                                          |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| Design Studio | `apps/design-studio` | Figma-like repo design with PRD handoff, responsive HTML generation, and implementation comparison |
| Job Hunt HQ   | `apps/job-hunt-hq`   | Project/session-bound job discovery, company research, resume, and interview visualization          |
| Quant Lab     | `apps/quant-lab`     | Local-first stock data research, strategy backtesting, and Markdown reports                      |
| Starter       | `templates/starter`  | Minimal template for creating another Panel App                                                  |

## Install from GitHub

In CodeShell, open **Extensions → Panel Apps → From GitHub**, then enter:

- Repository: `https://github.com/cjhyy/codeshell-panel-apps`
- Branch or tag: `main`
- App subdirectory: `apps/design-studio`, `apps/job-hunt-hq`, or `apps/quant-lab`

You can also paste a complete tree URL and leave the other two fields empty:

- `https://github.com/cjhyy/codeshell-panel-apps/tree/main/apps/design-studio`
- `https://github.com/cjhyy/codeshell-panel-apps/tree/main/apps/job-hunt-hq`
- `https://github.com/cjhyy/codeshell-panel-apps/tree/main/apps/quant-lab`

CodeShell clones the source into a temporary directory, validates the package,
shows its Host permissions, and installs an immutable snapshot. After new
commits are pushed, use **Update from source** on the installed app card to
review and apply the new version.

Design Studio 0.17 adds a complete PRD → responsive design → editable frontend → measured
comparison loop while keeping one v3 layout model: Wrap, Grid, independent axis gaps,
dual-axis Hug/Fill/Fixed sizing, per-item alignment/auto margin, and absolute children with
Constraints inside Auto Layout. Guarded HTML import maps supported Flex/Grid semantics, form
values, wrapping, ellipsis, and browser baselines. Generated HTML keeps stable layer IDs and maps
Auto Layout back to Flex/Grid so it can be refined as ordinary frontend code. Logical designs have no whole-document byte
limit: larger sources become a small page index plus verified, content-addressed page objects;
the runtime loads and caches only the active page and its component dependencies, then reuses
unchanged pages on save. Images and fonts live in a deduplicated content-addressed resource
library, while undo and crash recovery store operations instead of repeated whole-document
snapshots. Host request budgets remain bounded without becoming product file limits. Local,
html2figma-derived, and opt-in real-page
fidelity probes verify measured and reflowed output.

## Repository layout

```text
apps/
  design-studio/
    .codeshell-panel/panel.json
    app/
    agent/skills/
  job-hunt-hq/
    .codeshell-panel/panel.json
    app/
    agent/skills/
  quant-lab/
    .codeshell-panel/panel.json
    app/
templates/
  starter/
scripts/
  validate.mjs
```

Every Panel App is self-contained. Its manifest lives at
`.codeshell-panel/panel.json`; browser assets live under `app/`. Optional
schema-v2 Skills live at manifest-declared `agent/skills/<id>/SKILL.md` paths,
while tool handlers register through the sandboxed panel bridge.

## Develop

The apps intentionally use browser-native HTML, CSS, and JavaScript, so installing them has no
runtime dependency or bundling step.

```sh
node scripts/validate.mjs
```

Design Studio also has a same-browser HTML fidelity gate. Install development dependencies once,
then generate source, converted, side-by-side, amplified difference, and JSON metric artifacts:

```sh
npm install
npx playwright install chromium
npm run test:fidelity -- --output artifacts/design-studio-html-fidelity
npm run test:fidelity:cases -- --output artifacts/design-studio-html2figma-cases
npm run test:fidelity:delivery -- --output artifacts/design-studio-delivery-fidelity
```

The gate checks both the exact browser-measured conversion and a second render after resolving all
imported Auto Layout containers. The measured render requires windowed SSIM ≥ 0.99, while the
reflowed semantic render requires ≥ 0.86; both enforce changed-pixel limits and zero blocking audit
issues.
The fixture must retain at least 20 semantic Auto Layout containers plus verified Grid, Wrap, and
an absolute child inside Auto Layout.
The second command runs 19 offline use cases adapted from html2figma's 64-template catalog,
including Hug/Fill/Fixed, Wrap, Grid spans, Constraints, forms, tables, inline text, SVG, shadows,
and responsive widgets. It compares both initial and 760→520 px reflow screenshots and requires
zero blocking audit issues.
The third command reverses the direction: it generates HTML from a realistic design, renders and
recaptures it, then gates pixel similarity, stable-ID coverage, and maximum geometry drift.

For an opt-in network check against curated public pages, run:

```sh
npm run test:fidelity:real -- --output artifacts/design-studio-real-html-fidelity
```

This probe currently covers Bootstrap Blog, Hacker News, and the W3C fixed-menu example. It records
the live page, measured/reflowed Design renders, pixel differences, editable design sources, audit
summaries, and per-page metrics. It is intentionally excluded from CI so external availability and
changing page content cannot make repository validation flaky.

For local iteration, clone this repository and use **Choose source folder**.
For remote iteration, push a commit and use **Update from source**.

See [CONTRIBUTING.md](CONTRIBUTING.md) before adding another app.

## Disclaimer

Quant Lab is a research tool, not investment advice. Backtests are simplified
models and do not guarantee real-world execution or returns.

## License

MIT
