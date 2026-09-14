# CodeShell Panel Apps

Desktop Panel Apps for [CodeShell](https://github.com/cjhyy/codeshell). A
schema-v2 app may package its sandboxed UI, declared Agent tools, and read-only
Skills behind one reviewed installation. General Agents, Commands, Hooks, MCP
servers, and arbitrary plugin backends remain outside Panel Apps. A Panel may
include its own bounded Node tools, run through the reviewed Host `process`
permission; their application logic belongs to the Panel package.

## Included apps

| App                | Subdirectory          | Purpose                                                                                                                            |
| ------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Design Studio      | `apps/design-studio`  | Figma-like repo design with PRD handoff, responsive HTML generation, and implementation comparison                                 |
| Job Hunt HQ        | `apps/job-hunt-hq`    | Project/session-bound job discovery, company research, resume, and interview visualization                                         |
| Quant Lab          | `apps/quant-lab`      | Local-first investment desk with portfolio rules, linked plain-text notes, Today, reminders, opt-in news/SEC filings, and research |
| Video Download     | `apps/video-download` | Local yt-dlp downloads plus isolated setup and error-analysis Tasks                                                                |
| Video Studio 0.5.7 | `panels/video-studio` | Media organization, local video editing, source rough cuts, captions, AI workflows, and panel-owned media and voice tools          |
| Starter            | `templates/starter`   | Minimal template for creating another Panel App                                                                                    |

## Install from GitHub

In CodeShell, open **Extensions → Panel Apps → From GitHub**, then enter:

- Repository: `https://github.com/cjhyy/codeshell-panel-apps`
- Branch or tag: `main`
- App subdirectory: `apps/design-studio`, `apps/job-hunt-hq`, `apps/quant-lab`, `apps/video-download`, or `panels/video-studio`

You can also paste a complete tree URL and leave the other two fields empty:

- `https://github.com/cjhyy/codeshell-panel-apps/tree/main/apps/design-studio`
- `https://github.com/cjhyy/codeshell-panel-apps/tree/main/apps/job-hunt-hq`
- `https://github.com/cjhyy/codeshell-panel-apps/tree/main/apps/quant-lab`
- `https://github.com/cjhyy/codeshell-panel-apps/tree/main/apps/video-download`
- `https://github.com/cjhyy/codeshell-panel-apps/tree/main/panels/video-studio`

CodeShell clones the source into a temporary directory, validates the package,
shows its Host permissions, and installs an immutable snapshot. After new
commits are pushed, use **Update from source** on the installed app card to
review and apply the new version.

Video Studio 0.5.7 is maintained in `apps/video-studio/` and installed from the
prebuilt `panels/video-studio/` package. It owns media processing, subtitles,
Whisper transcription, HyperFrames rendering, and all voice adapters and model
setup. CodeShell 0.9.11+ / Panel API 14 supplies generic durable tasks, resource
custody, and reviewed entry handles; submitted native tasks continue after the
panel closes. Version 0.5.7 adds single and batch removal of demo and imported
assets, with confirmation for used assets and one-step undo. Related clips are
removed together, and captions and audio follow the adjusted timeline. Original
files and other projects remain intact. Large thumbnails, small thumbnails, and
list views share persistent display, type-filter, and name/duration-sort preferences;
context and More menus support keyboard and small-screen use. Real thumbnails
recover after reopening for copied, referenced, and browser-imported media,
including when old thumbnail URLs fail. Connected folders do not immediately
reimport unchanged files removed from the project; changed files may be imported
as new assets. These changes only require a Panel update; original-file references
still require **CodeShell 0.9.14**.

Version 0.5.6 adds source-card previews, manual multi-source rough-cut
queues, uniform head/tail trimming or fixed-duration selections, and AI-assisted
rough-cut candidates based on actual frame samples or transcripts. AI batches
support review, cancellation, continuation, and saved progress across restarts.
With **CodeShell 0.9.14**, desktop imports default to persistent read-only references
to original files without copying entire sources; explicit copy imports remain
available. Processing jobs may still create necessary temporary inputs. Moved
originals can be reconnected, and changed source contents are not silently swapped
into existing edits. The Host update supplies generic authorized file references;
editing and AI workflow logic remain in the Panel. Native tools require Node.js 20+ and their declared local
dependencies; voice initialization downloads the selected models. See the
[Video Studio guide](apps/video-studio/README.md) for requirements, reference
recordings, real previews, and export. GitHub installation itself does not
compile the source or install models.

Design Studio 0.18 keeps the complete PRD → responsive design → editable frontend → measured
comparison loop in one v3 layout model: Wrap/Wrap Reverse, Grid, independent axis gaps,
dual-axis Hug/Fill/Fixed sizing, Min/Max, reverse flow, Baseline, per-item alignment/auto margin,
and absolute children with Constraints inside Auto Layout. Guarded HTML import maps supported
Flex/Grid semantics, form values, wrapping, ellipsis, and browser baselines. Generated HTML keeps stable layer IDs and maps
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
  video-download/
    .codeshell-panel/panel.json
    app/
  video-studio/              # Source project: edit here
    .codeshell-panel/panel.json
    panel.build.json
    src/
    public/
    native/
    agent/skills/
panels/
  video-studio/              # Generated package: install this directory
    .codeshell-panel/panel.json
    app/
    agent/skills/
templates/
  starter/
scripts/
  validate.mjs
  build-panels.mjs
  check.mjs
```

Every Panel App is self-contained. Its manifest lives at
`.codeshell-panel/panel.json`; browser assets live under `app/`. Optional
schema-v2 Skills live at manifest-declared `agent/skills/<id>/SKILL.md` paths,
while tool handlers register through the sandboxed panel bridge.

## Develop

Existing apps and `templates/starter` keep browser-native HTML, CSS, and JavaScript
directly in `app/` and install from their existing directories. They need no
bundling step. Their existing validation command remains available:

```sh
node scripts/validate.mjs
```

Video Studio is the source-built app in this release. Its `panel.build.json`
declares `src/main.ts`; the build bundles browser ESM, copies `public/` into
`panels/video-studio/app/`, and includes the declared Skills. Entries under
`native/` are bundled separately as Node tools. Source files and generated
`panels/video-studio/` files are committed together; edit the source, then rebuild.
Do not install `apps/video-studio/` or migrate the Starter template as part of this
release. CodeShell installs the prebuilt package without running npm or a compiler.

Use Node.js 20+ for development:

```sh
npm ci
npm run typecheck
npm run build -- --app video-studio
npm run build:check -- --app video-studio
npm run test:build
npm run validate
npm test -- --suite video-studio
npm run check
```

`build:check` rebuilds twice in temporary directories and checks determinism and
committed output without replacing it. `check` runs type checks, build checks,
and the complete offline test catalog; `npm test` runs that catalog alone.
The Video Studio suite includes native-tool and project/Host contract tests;
it does not require downloading voice models or generating paid audio.

For browser and media verification, install Chromium once and run the separate
suites. Install FFmpeg (including `ffprobe`) on PATH as well: the rough-cut UI
suite generates real source videos, and media tests inspect actual exports.
These suites are not included in the default offline gate:

```sh
npx playwright install chromium
npm run test:ui:video-studio
npm run test:media:video-studio
```

`npm run dev -- --app video-studio` rebuilds on source changes; refresh the preview
after a successful build. `npm run preview -- --app video-studio` serves the built
package at `http://127.0.0.1:4173/`. Browser previews have no CodeShell Host bridge;
test local process, recording, and persistent media features in the installed
desktop panel. See [CONTRIBUTING.md](CONTRIBUTING.md) for `nativeEntries` and package
boundaries.

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
The second command runs 20 offline use cases adapted from html2figma's 64-template catalog,
including Hug/Fill/Fixed, Min/Max, reverse flow, Wrap, Grid spans, Constraints, Baseline, forms,
tables, inline text, SVG, shadows, and responsive widgets. It compares both initial and 760→520 px
reflow screenshots and requires zero blocking audit issues.
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

For local iteration, clone this repository and use **Choose source folder** with
the existing app directory, or `panels/video-studio/` for Video Studio.
For remote iteration, push a commit and use **Update from source**.

See [CONTRIBUTING.md](CONTRIBUTING.md) before adding another app.

## Disclaimer

Quant Lab is a research tool, not investment advice. Backtests are simplified
models and do not guarantee real-world execution or returns.

## License

MIT
