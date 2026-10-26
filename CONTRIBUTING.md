# Contributing

## Branch and integration workflow

Follow [CODESHELL.md](CODESHELL.md#branch-names-and-task-isolation) for task
branches, worktree isolation, integration, and cleanup. Create the branch before
editing: `codex/<panel-id>/<topic>` for a Panel change or
`codex/panel-shared/<topic>` for shared infrastructure. Each concurrent task uses
its own worktree. Validate and commit on the task branch, then merge into `main`;
do not make development commits directly on `main`.

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

Video Studio 0.7.3 is the source-built app in this release. Edit
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

`@cjhyy/code-shell-core@0.9.23` is pinned as a development dependency for the
published Host's manifest schema and read-only installation preflight. It is
used only by package checks and is not bundled into the installed Panel runtime.

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
`shared/project-context.mjs` is the source for the execution identity helpers in
Design Studio, Job Hunt HQ and Quant Lab. After editing it, run
`node scripts/sync-project-context.mjs`; the default gate checks that the three
installable copies match.
`npm test` runs the suites without rebuilding; `tests/suites.mjs` owns that catalog.
TypeScript tests are bundled to temporary Node 20-compatible ESM by
`scripts/run-typescript-tests.mjs`. The Video Studio suite includes its native
provider and CLI tests without installing real voice models.

Browser and media suites are separate: after `npx playwright install chromium`,
run `npm run test:ui:video-studio` and `npm run test:media:video-studio` for the
affected UI or playback/export behavior. Both require FFmpeg and `ffprobe` on
PATH to generate and inspect real test media; CI installs these explicitly.
`npm run dev -- --app video-studio`
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
  "nativeEntries": { "media-runtime": "native/media/cli.ts" }
}
```

Names must start with a lowercase letter and contain only lowercase letters,
digits, or hyphens, up to 64 characters. Entry paths must remain below `native/`
and end in `.ts`, `.js`, or `.mjs`. Each entry is bundled as Node 20 ESM at
`app/tools/<name>.mjs`, with its JavaScript dependencies included. Node builtins
are allowed in tools; browser imports must stay within installed browser assets.
External programs and model files are checked and prepared by the Panel's own
setup flow, not supplied by a development checkout.

The builder emits each entry's installed path and SHA-256 in the generated
manifest `nativeEntries`. CodeShell 0.9.11+ / Panel API 14 resolves that reviewed
entry to an opaque handle, verifies the installed bytes, and authorizes its
execution. Use `tasks.start({entry, input, recovery})` for durable work, with
resource IDs materialized directly into the task directory. For short process
work, use `process.resolveEntry` and its returned handle. Do not guess installed
paths, transmit executable source through browser JSON, or import CodeShell
implementation files. The optional `panel-native:<name>` source/hash import is
retained for old callers; Video Studio uses reviewed entries and does not
bootstrap executable files through the browser.

Request the `process` permission. Keep model choices, dependency versions,
workflows, and retry policy in the Panel; the Host enforces access, process
lifecycle, and resource custody. Discover methods and limits through
`getContext()`, prefer structured `callResult` errors, and use sequence cursors
for process output. Handle missing executables, permission denial, cancellation,
and interrupted task records. Closing the panel does not cancel durable tasks;
explicit cancellation waits for process termination. Online work that might
incur charges uses manual recovery and checks existing results before another
request. Bundling an entry does not execute it automatically.

### Shared browser runtimes

`panel.build.json` can declare `browserEntries`, for example
`{ "editor-renderer": "src/editor/render-entry.ts" }`. The builder emits each
as a self-contained browser IIFE at `app/runtimes/<name>.mjs`. A native entry may
import `{ source, sha256 }` from `panel-browser:<name>` to embed those exact
reviewed bytes in its hashed executable. This supports independent browser
rendering with the same domain code used by the interactive UI. The native tool
must never accept executable source from task JSON.

These entries stay below `src/`; Node dependencies, unresolved runtime imports,
path escapes, and public-file collisions fail the build. They use the installed
package inventory and require no new Host capability. Run `npm run test:build`
after changing the declaration or build behavior.

### Native model observations

Use `shared/model-observability.mjs` around actual native inference. The reviewed
Host launcher grants a separate FD 3 pipe with `CODESHELL_MODEL_TRACE_FD=3`;
standalone CLI use without that grant emits no observations and keeps stdout
unchanged. Never accept the descriptor, storage path, workspace or trace identity
from task input. The Host supplies attribution and applies its recording policy.
Long observations use bounded fragments, each written once within the portable
512-byte atomic limit. Independent CLIs can therefore share a shell descriptor
without interleaving their prompts; the Host reassembles each opaque message.

Record the actual submitted text and model parameters, then returned text or
non-binary result metadata. Keep credentials, media bytes and private native
paths out of observations. Multipart and local inference are logical inputs;
they do not claim access to a provider's private wire. Place the observer after
cache checks so reuse produces no fictitious inference. Setup flows that run a
real synthesis sample use the same provider boundary and are observed too.
Failure and cancellation close the observation without retrying inference.

Video Studio bundles the shared helper into its native entries. Job Hunt keeps
an installable copy: after changing the helper, run
`node scripts/sync-model-observability.mjs` and commit both files. The normal check
gate verifies that copy; `tests/model-observability.test.mjs` uses only fake
providers and private temporary files to verify FD 3 and request identity.

## CLI companions

Panels that perform basic data or media work must include a package-local Node
CLI and a declared Runtime Skill so chat and terminal workflows can operate
without an open webview. Reuse the Panel's domain modules and keep the CLI's
stdout structured. Resolve the CLI from the current project's selected package;
do not depend on a development checkout or search another installed version.

Keep task ownership explicit. A CLI may run a foreground command or create an
independent worker with persistent status and cancellation; a Panel only displays
those records and must not terminate the worker on closure. Use project-owned
files with bounded, atomic writes and concurrency control. If a Panel already
uses Host storage/tasks/resources, document the separate CLI records or provide
a supported shared protocol; never modify private Host files by guessed paths.
Node does not supply external executables, account grants or model credentials.
Check actual runtime capabilities and report missing prerequisites.

Video Download's `app/tools/video-download.mjs` demonstrates independent media
tasks; Job Hunt HQ's `app/tools/job-hunt.mjs` demonstrates shared project data
with the Host's workspace write protocol. Design Studio, Quant Lab and Video
Studio also expose local domain operations through their package CLI. The Starter
template includes a shared browser/Node domain module and Runtime Skill by default.
Document each command's supported scope; having a CLI does not establish parity
with every webview action or access to Host-managed media resources.

Every public CLI must implement an offline, read-only `ops` command with one JSON
receipt on stdout. Run `npm test -- --suite panel-cli` after changing an entry,
its Skill or packaging. This gate copies each installable package away from the
repository and executes discovery with an empty project, no development modules
and no provider credentials. It also checks the declared Runtime Skill points
to the bundled CLI. Add domain-specific subprocess tests to the owning app suite
for actual reads/writes, malformed inputs, revision conflicts and prerequisites.

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

## Real Host storage check

With a separately built compatible CodeShell server package, run:

```sh
npm run test:host-storage -- /absolute/path/to/codeshell/packages/server
```

This runs five checks against the real `PanelRuntimeServices`: Design recovery,
portable/legacy design backup, Figma source/image and review exchange, Job Hunt
draft storage, and Job Hunt's reviewed installation, project-selected Skill and
installed CLI through the real Core
`Skill` and `Bash` tools without opening a Panel. It checks all four headless
operations, bidirectional Host persistence, stale-write rejection and retained
package selection. All checks use temporary projects,
temporary homes, a credential-free environment and a JavaScript network guard.
It verifies disk persistence, concurrent writes, restarts, revoked access and
restoration without reading personal projects. It is separate from the default
gate because the Host is a different repository. It does not establish physical
phone, provider, operating-system network isolation or deployed Cloud acceptance.

The Design exchange check can also run independently:

```sh
node scripts/design-studio-exchange-host.mjs /absolute/path/to/codeshell/packages/server
```

It creates its own isolated home and denies JavaScript network access. It verifies
the real Host text budgets and stale-write rejection, multipart image bytes,
source-binding reopen and recovery references, concurrent comments, draft CAS,
prototype configuration, and portable restoration under a new basename. It then
removes the original fixture project and reopens the restored data. This Node
gate does not execute the Figma plugin in an actual Figma account or replace its
separate end-to-end acceptance.

## Old-package upgrade and rollback check

For actual old-package install, project data upgrade and rollback, run:

```sh
npm run test:host-upgrade -- /absolute/path/to/codeshell/packages/server /tmp/panel-upgrade-report.json
```

This separate integration gate also requires the sibling built `packages/core`,
Chromium, Git, tar and the immutable historical Git objects listed in
`scripts/panel-host-upgrade.mjs`. Fetch tags/history before an offline run if
needed. It uses the real reviewed Core installer and project package selection,
then the real server storage/workspace services with installed Panel modules.
The optional report is create-only and records exact old/candidate package
digests, permissions and covered paths. The worker receives a temporary HOME,
private Host data/projects, no provider credentials and a JavaScript network
guard. Only the browser executable is read from the existing Playwright cache;
its test profile is private and its page requests are intercepted locally.
The parent captures the asynchronous worker process; timeout IPC/SIGTERM awaits
tracked Chromium launches and closes before sending a nonce-bound shutdown
receipt. Temporary HOME cleanup requires both that receipt and worker exit.
Missing or failed browser closure retains the private directory and fails the
gate; only the captured worker is signalled, with bounded escalation. Assertion,
shutdown and directory-cleanup errors remain visible together.
Run `npm test -- --suite upgrade-harness` for the offline owned-process fault gate.
See [the upgrade audit](docs/todo/p1-panel-upgrade-rollback-2026-10-12.md) for
fixture provenance, rollback semantics and the remaining device/deployment
acceptance. This gate does not run native tools, authenticate providers or
replace installed Desktop/Cloud acceptance.

## Installed Desktop package/IPC check

With a separately built compatible Host checkout containing Desktop `out/`, its
Electron/Playwright dependencies, and the maintained confinement helpers, run:

```sh
npm run test:desktop -- /absolute/path/to/built/codeshell /absolute/path/to/new-report.json
```

This separate macOS integration gate never rebuilds the Host. It installs all six
real repository packages through production Main/preload IPC, loads sandboxed
webviews and package modules, checks project storage/permission/digest isolation,
rejects changed reviewed sources and real staged-package publication failures,
and restores an exact retained package through reviewed IPC. Package, project and
native known directories are temporary; the optional report is create-only.

The existing Host harness performs its macOS metadata-only default Keychain
preflight; the gate does not configure credentials. Node HTTP is denied and every
Electron session cancels external HTTP(S). Owned curl/wget/yt-dlp CLI fixtures
avoid live native network clients, and Quant uses the normal `visible:false`
lifecycle to suppress automatic market collectors. These controls do not claim
an OS sandbox, real providers, native media, physical phones or deployed Cloud.
Record the actual output hashes and independently established build provenance;
the current Host source checkout/version can differ from its built outputs.
Cleanup preserves assertion, close, and filesystem failures together. It checks
the captured Electron ChildProcess has exited before deleting its temporary HOME;
an unverified live process retains that directory and fails the gate. Fallback
termination uses only that captured child handle. Final reports are written only
after verified shutdown and successful directory cleanup.

## Read-only release ZIP verification

Run `node scripts/verify-release-zip.mjs --tag <panel-id-vX.Y.Z> --zip <local.zip>
--dir <package-path>`. `--dir` is an exact repository-relative **installable**
directory at that tag (`apps/video-download`, `panels/video-studio`, or
`templates/starter`), not a checkout, extraction destination or source-built
`apps/video-studio`. The CLI always reads Git objects from this repository.
It never downloads, extracts, executes, installs or rebuilds the package.

Stdout is one JSON receipt: equal contents = exit 0, differences or incomplete
tag-generated output = exit 1, invalid/unsupported input = exit 2. It compares
uncompressed file SHA-256, records the original ZIP SHA-256 separately, and
checks manifest ID/version against the exact tag. A missing generated inventory
or missing/hash-mismatched inventory files cannot produce complete equality.
See [supported layouts, budgets and real receipts](docs/acceptance/panel-release-zip-20261026.md).
Run `npm test -- --suite release-zip` with a private HOME/XDG/TMPDIR and cleared
credentials; the handoff includes the exact isolation recipe, gate history and corrected result.

## Pull requests

Explain the user-visible behavior, list requested Host permissions, and include
the output of `node scripts/validate.mjs`. Source-built changes also need
`npm run typecheck`, `npm run build:check`, and the relevant test suites;
build changes need `npm run test:build`. Quantitative features should document
their assumptions and avoid performance claims.
