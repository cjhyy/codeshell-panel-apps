---
name: project-runtime
description: Locate and run the Investment Desk programs from the Panel package selected by the current project. Use for Panel-generated market data, news synchronization, watch checks, and market pulse tasks.
---

# Project Runtime

Use the current task's input, output paths and data rules. This skill locates the
programs; it does not authorize additional network sources, credentials or actions.

CodeShell supplies this skill from the current project's selected Panel package.
The exact skill directory is `${CODESHELL_SKILL_DIR}`. Resolve `../../..` from
that directory to obtain the package root; do not change the working directory
away from the current project. All relative data paths belong to that project.

| Task program | Path relative to this package root |
| --- | --- |
| Market data synchronization | `app/tools/fetch-market-data.mjs` |
| News synchronization | `app/tools/fetch-news.mjs` |
| Market pulse | `app/tools/build-market-pulse.mjs` |
| Watch rule evaluation | `app/engine.mjs` |
| News validation and notification bookkeeping | `app/news-feed.mjs` |

Read the package's `.codeshell-panel/panel.json` and confirm `id` is `quant-lab`.
Check the requested program is readable. Pass its resolved path as one properly
quoted Node argument, with only the task's specified arguments. Use the same root
for imported calculation modules. Keep package files read-only.

Do not search the global installation registry, another version, a checkout, or
the network for a replacement. If the skill, manifest or requested program is
unavailable, report the task's `bundled-*-tool-not-found` / `unavailable` result
and stop that operation. Do not generate a replacement result or notify a trigger.
