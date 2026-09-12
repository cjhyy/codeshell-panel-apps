# Contributing

## Add a Panel App

1. Copy `templates/starter` into `apps/<app-id>`.
2. Update `.codeshell-panel/panel.json`.
3. Keep installable assets under `app/`. Schema-v2 apps may
   place manifest-declared read-only Skills under `agent/skills/`.
4. Run `node scripts/validate.mjs`.
5. Install the directory in CodeShell and review every requested Host
   permission before testing it.

App IDs use lowercase letters, digits, and hyphens. The manifest entry must be
a relative HTML path below `app/`.

The Starter template and existing apps remain directly installable from their
current directories. Do not migrate them to a build pipeline as part of a Video
Studio change. An app without `panel.build.json` keeps its native `app/` layout
and passes through `npm run build` unchanged.

## Source-built Video Studio

Video Studio 0.4.7 is the source-built app in this release. Edit
`apps/video-studio/`; install and publish **`panels/video-studio/`**. Its GitHub
installation subdirectory is `panels/video-studio`, not `apps/video-studio`.

- `src/` owns browser modules. `panel.build.json` declares their entry, currently
  `src/main.ts`; `.ts`, `.tsx`, `.js`, and `.mjs` entries are supported.
- `public/` owns HTML, CSS, and static assets copied into the generated `app/`.
  HTML loads `./main.mjs`. If CSS is imported from source, link the emitted
  `main.css` from HTML. Do not shadow generated files with static assets.
- `native/` owns declared Node tools; see `nativeEntries` below.
- `.codeshell-panel/panel.json` and manifest-declared `agent/skills/` are copied
  into the installable package. Development files and root `node_modules/` are
  not runtime dependencies of an installed Panel.

Source discovery and packaging live in `scripts/panel-projects.mjs` and
`scripts/build-panels.mjs`. A source project's directory name determines its
`panels/<directory-name>/` output and must be unique across `apps/` and
`templates/`. Builds validate installation dependencies before replacing the
previous package and include a deterministic SHA-256 file inventory. Browser
modules use inline source maps; standalone `.map` and `.ts` runtime assets are
not supported by the Host.

With Node.js 20+ and development dependencies installed, run:

```sh
npm ci
npm run typecheck
npm run build -- --app video-studio
npm run build:check -- --app video-studio
npm run validate
npm test -- --suite video-studio
```

Run `npm run test:build` for build-contract changes. Run `npm run check` before
release for source types, deterministic committed builds, and all offline suites.
`npm test` runs the suites without rebuilding; `tests/suites.mjs` owns that catalog.
TypeScript tests are bundled to temporary Node 20-compatible ESM by
`scripts/run-typescript-tests.mjs`. The Video Studio suite includes its native
provider and CLI tests without installing real voice models.

Browser and media suites are separate: after `npx playwright install chromium`,
run `npm run test:ui:video-studio` and `npm run test:media:video-studio` for the
affected UI or playback/export behavior. `npm run dev -- --app video-studio`
rebuilds on changes; refresh the browser after each successful build. Ordinary
browsers do not expose `window.codeshellPanel`, so previews must state which Host
features are unavailable. Verify those features in the installed desktop panel.

Commit source and generated `panels/video-studio/` output together. Never edit
generated files directly. The build checks validate them without replacing them.

## Native tool entries

`panel.build.json` may map tool names to entry files under `native/`:

```json
{
  "entry": "src/main.ts",
  "nativeEntries": { "voice-runtime": "native/voice-runtime.ts" }
}
```

Names must start with a lowercase letter and contain only lowercase letters,
digits, or hyphens, up to 64 characters. Entry paths must remain below `native/`
and end in `.ts`, `.js`, or `.mjs`. Each entry is bundled as Node 20 ESM at
`app/tools/<name>.mjs`, with its JavaScript dependencies included. Node builtins
are allowed in tools; browser imports must stay within installed browser assets.
External programs and model files are checked and prepared by the Panel's own
setup flow, not supplied by a development checkout.

Browser modules can import `source` and `sha256` from `panel-native:<name>` to
provision the exact bundled tool through the generic process API. Do not guess
an installed package path or import CodeShell implementation files. Request the
`process` permission and handle missing executables, approval, cancellation, and
panel closure explicitly. Bundling a tool does not start it automatically.

## System boundary

This repository is exclusively for Desktop Panel Apps. Packages must not
contain Agent Plugin manifests or general capability directories such as:

- `.claude-plugin`
- `.codex-plugin`
- `.codeshell-plugin`
- `.mcp.json`
- `agents`
- `commands`
- `hooks`
- package-root `skills`

Schema v2 may declare structured tools implemented by the sandboxed panel and
Skills at `agent/skills/<id>/SKILL.md`. Agents, Commands, Hooks, MCP servers,
and general-purpose plugin backends still belong in a separate Agent Plugin.
A Panel may own bounded native tools under `app/tools/`, executed through the
reviewed `process` permission. Model versions, installers, inference adapters,
and application workflows belong in those Panel tools. Host changes should
provide reusable file, permission, process, or media capabilities rather than
hardcode a Panel's models or product rules.

## Pull requests

Explain the user-visible behavior, list requested Host permissions, and include
the output of `node scripts/validate.mjs`. Source-built changes also need
`npm run typecheck`, `npm run build:check`, and the relevant test suites;
build changes need `npm run test:build`. Quantitative features should document
their assumptions and avoid performance claims.
