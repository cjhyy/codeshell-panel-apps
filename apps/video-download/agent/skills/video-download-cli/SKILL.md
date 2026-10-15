---
name: video-download-cli
description: Inspect, search for, download and check videos through the selected Mimi Download package's Node CLI, including background task status, cancellation and retries, without opening or keeping the panel open.
---

# Video Download CLI

Use this CLI for direct chat or terminal requests. The panel is optional. Keep
Panel-originated operations using their existing Panel tools and Host queue.

CodeShell supplies this Skill from the current project's selected package.
Resolve `../../..` from `${CODESHELL_SKILL_DIR}` to locate that package. Confirm
`.codeshell-panel/panel.json` has id `video-download`, and that
`app/tools/video-download.mjs` exists. Use that exact CLI; do not search another
installation/version or modify package files. If unavailable, report
`bundled-video-download-cli-not-found`.

Run Node >=20.10 from the actual Bash environment. Desktop Hosts with managed
runtime PATH support supply bundled Node as a fallback; older Hosts, TUI and
standalone terminals require Node on PATH. Do not infer availability from the
application version. `doctor` checks yt-dlp and FFmpeg separately: Node does not
replace either program. An explicit `--bin-dir` may select the user's dependency
directory; never guess CodeShell's private data directories.

```sh
node "<package-root>/app/tools/video-download.mjs" ops
node "<package-root>/app/tools/video-download.mjs" doctor --project "<current-project>"
```

Read `ops` for current commands and schemas. Write structured request JSON to a
file and pass it as a quoted `--input-file` argument. Set `--project` to the
current trusted project, not the installed package directory. For example:

```sh
node "<package-root>/app/tools/video-download.mjs" inspect --project "<current-project>" --input-file "<inspect.json>"
node "<package-root>/app/tools/video-download.mjs" search --project "<current-project>" --input-file "<search.json>"
node "<package-root>/app/tools/video-download.mjs" download \
  --project "<current-project>" --input-file "<request.json>" --background
node "<package-root>/app/tools/video-download.mjs" jobs --project "<current-project>"
node "<package-root>/app/tools/video-download.mjs" status --project "<current-project>" --job "<task-id>"
node "<package-root>/app/tools/video-download.mjs" cancel --project "<current-project>" --job "<task-id>"
node "<package-root>/app/tools/video-download.mjs" retry --project "<current-project>" --job "<task-id>" --background
```

Search takes keywords and returns retrieved candidates with source evidence.
Use the current chat to interpret the user's request and rank those candidates;
the CLI has no model credentials or separate paid AI planning. Index results and
historical links are not proof of current platform availability. Inspect the
selected URL to check metadata. Do not claim to have watched its video contents.

Download only when requested. Each download keeps a stable task ID and its
original options. Use foreground download for a short operation, or
`--background` to return the task ID while a standalone Node worker runs.
Poll `status` or `jobs` for its real state and files; closing the panel has no
effect. Do not claim completion from the start receipt. If a start reply is
uncertain, inspect the project's jobs before starting another download.
Cancellation is cooperative and is complete only when the worker reports its
terminal state. Retry only after inspecting a failed/cancelled/interrupted task;
never automatically replay an uncertain network operation.

CLI records live in `.mimi-download-cli/` under the project. The panel's CLI
task section reads those records without owning their workers. The existing
Host queue, saved Cookie accounts and resource library remain separate: do not
edit Host app-storage files, fabricate resource IDs, or treat CLI task IDs as
Host task IDs. This CLI handles public-media downloads; a saved Host-account
download still uses the authorized Panel workflow. Never copy browser profiles,
Cookie contents or model keys into a request or a task record.

Use returned JSON and exit codes as receipts. Report missing dependencies,
output limits, conflicts and interrupted workers accurately. Preserve partial
files for an explicit retry; neither panel closure nor application restart is
permission to silently start a new network request.
