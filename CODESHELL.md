# CODESHELL.md

Instructions for assistants working in the CodeShell Panel Apps repository.
Read [CONTRIBUTING.md](CONTRIBUTING.md) for build, test, and packaging details.
This repository uses **npm**; the separate CodeShell Host repository uses Bun.

## Branch names and task isolation

`main` is the integration/release branch. Create and enter a task branch **before
editing**; do not make development commits directly on `main`. Updating `main`
by merging tested task commits is expected.

Use `codex/<panel-id>/<topic>`, with the actual Panel ID and a short task name:

| Scope | Example task branch |
| --- | --- |
| Quant Lab | `codex/quant-lab/selection-resume` |
| Video Download | `codex/video-download/project-storage` |
| Video Studio | `codex/video-studio/export-colors` |
| Design Studio | `codex/design-studio/canvas-selection` |
| Job Hunt HQ | `codex/job-hunt-hq/resume-preview` |
| Shared code, build, CI, or repository instructions | `codex/panel-shared/branch-workflow` |

Each task gets a fresh branch; do not maintain one permanent development branch
per Panel. Independent tasks for the same Panel have different topic names.
Concurrent tasks each need a separate **worktree and branch**. Switching branch
names in a shared directory does not isolate edits. Only an exclusively owned,
clean checkout may be switched in place; never switch another task's checkout.

## Required workflow

1. Inspect the branch, working-tree changes, and existing worktrees. Fetch
   `origin` and create a task branch/worktree from the latest `origin/main`.
   Reuse an existing worktree only when it belongs to this exact task.
2. Edit and commit only task-owned changes on that branch. Preserve existing
   changes from other tasks. If this task already edited `main`, identify its
   changes and transfer only those changes using a reviewed patch or checkpoint.
   Never blanket-stash, reset, stage, or commit another task's files. Do not copy
   an old worktree wholesale onto current `main`.
3. Run the affected build and test checks from `CONTRIBUTING.md`. For source-built
   Panels, commit source and generated installable output together. Docs-only
   changes need a diff/format/link review, not the application test suites.
4. Refresh `origin/main` before merging, integrate its new commits into the task
   branch, resolve conflicts there, and validate the final combined changes.
   Use a normal merge, fast-forward, or PR according to repository policy and
   branch protection. Do not use an `ours` merge to hide unreviewed work.
5. When delivery/merge is authorized, merge the tested branch into `main` and
   push through the permitted workflow. Do not request routine approval again.
   Use a clean checkout for integration. A dirty primary checkout may only be
   fast-forwarded if every incoming path is disjoint from existing changes and
   those changes are verified preserved. Otherwise leave that checkout untouched
   and report its pending synchronization; never force-update a branch checked
   out in another worktree.
6. After confirming the task commits are integrated, remove this task's clean,
   unused worktree and merged branch. Check for uncommitted/untracked work and
   active users first. Preserve unfinished work and other active tasks; a backup
   alone is not a reason to delete their worktrees. Report any remaining work.

## Release and ownership

- Each Panel is independently versioned. Bump and release the affected Panels
  when a release is requested; a docs-only change does not require a new app
  version. Use the merged commit that passed the applicable release checks.
- Build release packages from a clean checkout of that commit, run the documented
  checks and package preflight, and verify published assets against the built
  artifacts. New concurrent work is a later change, not an addition to an already
  verified release. Do not tag or package somebody else's dirty working tree.
- Install from a stable source/package, never a disposable task worktree that
  will be removed during cleanup. Video Studio's installable output is
  `panels/video-studio/`; its editable source is `apps/video-studio/`.
- Keep models, providers, installers, workflows, and other Panel business logic
  here. Change the CodeShell Host only for a demonstrated generic capability gap.
  Cross-repository changes use separate task branches in both repositories and
  must be checked for compatibility before release.
