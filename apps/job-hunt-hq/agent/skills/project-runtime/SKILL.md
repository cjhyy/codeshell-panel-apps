---
name: project-runtime
description: Run the selected Job Hunt HQ package's project CLI for job opportunities, company research, evidence digests, finite existing-file observation, bounded context reads, candidate facts, private experiences and factual QA, named library versions, and resume drafts from direct Chat or TUI requests without opening the panel.
---

# Project Runtime

Use this runtime for direct Chat or TUI requests. When a prompt was submitted by
the Panel and carries a `Panel Trace ID` / `trace_id`, use the Panel tools through
`job-hunt-hq:job-hunt-workflow` so its task keeps the normal Trace lifecycle.

CodeShell supplies this Skill from the current project's selected Panel package.
Resolve `../../..` from `${CODESHELL_SKILL_DIR}` to get that package root. Read
its `.codeshell-panel/panel.json` and confirm `id` is `job-hunt-hq`; confirm
`app/tools/job-hunt.mjs` is readable. Keep package files read-only and the working
directory in the current project. Do not search another installation, version,
checkout, or the network for a replacement. If the Skill directory, matching
manifest, or CLI is unavailable, report `bundled-job-hunt-cli-not-found` and stop
that operation.

Require Node.js >= 20.10 on `PATH`; if it is unavailable, report that prerequisite
before running the CLI. Before `init` or any write operation, use the actual
CodeShell Bash tool to read its Host-injected protocol marker:

```sh
printf '%s\n' "${CODESHELL_WORKSPACE_WRITE_PROTOCOL-}"
```

Require the output to be exactly `1`. CodeShell 0.9.36 or later injects this
generic workspace-write capability marker into foreground and background Bash
processes; project environment settings cannot override it. If it is absent or
different, report `headless-host-upgrade-required` and do not run headless writes
or initialization. Never export, set, or fabricate this marker to pass the check.
A global `code-shell --version`, Panel API version 14, or the installed package
version cannot replace this probe of the actual Host. Read-only `ops` and
`get_job_search_context` / `get_job_research_digest` remain available. The manifest has no enforced minimum
Host version field, so this check is required even when installation succeeded.
Run the resolved CLI path as one properly quoted Node argument:

```sh
node "<package-root>/app/tools/job-hunt.mjs" ops
node "<package-root>/app/tools/job-hunt.mjs" init --project "<current-project>"
node "<package-root>/app/tools/job-hunt.mjs" run <operation> \
  --input-file "<request.json>" --project "<current-project>" \
  --session "<current-session-id>"
```

Only pass `--session` when the current Session ID is known; never invent one.
When `--project` is explicit, that exact directory must contain the snapshot.
Without it, `run` finds the nearest ancestor of the current directory containing
`job-hunt-panel.json`. If none exists, initialize the intended current project
with `init` before reading or writing. `init` creates only a missing snapshot,
`CODESHELL.md`, and candidate-data templates; it preserves existing files and
can complete missing templates after interrupted initialization. It does not
invent candidate facts. Candidate source inspection and updates to existing
project instructions still follow the workflow's initialization module.

`ops` reports the supported operations and their exact current schemas:

| Operation | Purpose |
| --- | --- |
| `get_job_research_digest` | Read Chinese Markdown + structured job/lead/company research digest; no web fetching or new match scores. |
| `save_job_opportunities` | Save 1–12 real opportunities; full JD gate, leads and immutable JD files share the Panel implementation. |
| `save_job_research` | Save one company report with real URLs and access times. |
| `get_job_search_context` | Read the smallest required scope; keep pagination and opaque IDs. |
| `save_candidate_context` | Save complete candidate facts or one source / episode / qa / library_version / career_update mode. |
| `save_resume_qa_answer` | Save an actual answer to an existing private resume question. |
| `save_resume_draft` | Save a Base Resume or JD Variant with complete evidence and private questions. |

Write one JSON object matching the selected schema to `--input-file`. Use the
same operation names and argument fields as the Panel tools. Do not load the
entire snapshot to bypass bounded reads. Keep existing evidence when a claim is
unchanged. Decisions belong in private `careerEpisodes` decision/reason/tradeoffs and
`careerQa`; existing resume `candidate_questions` with `category: "decision"`
remain compatible and linked to the permanent QA library. Do not add another
Tool or invent a separate decisions entity.

For conversational collection, confirmation, immutable named versions and
JSON preview/apply, follow `job-hunt-workflow` and its career-update reference.
Use `career_sources`, `career_episodes`, `career_qa`, and `career_versions`
scopes with exact opaque IDs or pagination. `version_id` reads immutable
historical facts; they must never silently replace current working records.
`save_candidate_context` accepts either the complete legacy profile/repositories/
work_history shape or exactly one incremental mode. Unconfirmed facts remain
drafts or pending revisions. Preserve the user's factual answer separately
from `draftAnswer`; only their exact explicit confirmation can confirm a fact.
Named versions do not confirm facts, authorize public disclosure, or generate
a resume. For JSON apply, preview first and use the returned `preview_token`;
file/library changes require another preview. A successful apply already saves
the named version, so do not also create a separate version for that batch.
If a receipt is lost, query the exact version before deciding to retry.
`library_version` and `career_update` previews do not write a snapshot.

This version supports the seven operations listed above. The digest is a CLI-only
read operation; the Panel UI uses its shared model without adding a seventeenth
manifest Tool. JD intake, application progress, interview writes and
`complete_execution_trace` still require the Panel. Do not invent CLI operations. Open the Panel for an
explicit visual preview or export request as well.

The CLI prints one JSON result on stdout. Treat `ok: true` as the write receipt;
do not report a saved artifact until the command succeeds. Exit codes are `0`
success, `2` invalid arguments, `3` revision conflict, and `1` other errors.
The CLI handles one conflict by rereading the snapshot, rerunning the pure
operation, and conditionally writing again. If it returns `REVISION_CONFLICT`
after that second attempt, reread the required bounded context and preserve both
edits; do not blindly rerun the same command or edit `job-hunt-panel.json` by hand.
CLI writers use the project-root `.job-hunt-write.lock` directory and wait at
most five seconds for another CLI writer. A crash may leave that lock behind;
verify that no CLI writer is still active before manually removing the stale
lock. Do not remove it merely because a command timed out. In addition,
compatible Host and CLI writers share a per-file lock in the target file's
parent directory, named
`.codeshell-workspace-write-<sha256(NFC-lowercase-filename)>.lock`. It uses the
same five-second wait and does not automatically remove stale locks; release
checks the acquired directory's device and inode. CodeShell versions before
0.9.36 do not participate, which is why Skill-driven writes require the actual
Bash protocol probe. The CLI remains usable from an independent terminal without
this environment marker; any Host concurrently using that project must still
support the shared protocol (CodeShell 0.9.36 or later).
Report other failures with their returned code and message. `--trace` is only
for an already known correlation ID; direct requests do not need a Trace or a
`complete_execution_trace` call. Resume saves and QA updates record
`source: "cli"` and the supplied Session ID on the resume; archived versions
retain that provenance. A candidate-profile change updates provenance on
affected existing resumes, and a supplied Trace updates its matching
`workflowRuns` entry. A standalone candidate save with neither an existing
resume nor a matching Trace has no durable provenance record in this version.

## Direct Chat: real job research

Read `job-intelligence` for the source workflow. Read the real official/ATS page
or browser-visible JD before saving. Preserve its HTTPS URL, `fetched_at` and
visible text. An HTTP 200 response or title alone is not evidence of active
hiring. When current hiring semantics were actually read, attach a `verification`
receipt: `state`, `checkedUrl`, `lastCheckedAt`, `sourceKind` (`official`/`ats`),
`method` (`browser-visible`/`ats-api`/`page-read`) and `evidenceExcerpt` containing
the relevant original sentence. `verified_live` requires those fields and a URL
matching the saved job; without adequate evidence use `unverified`. Receipts are
Agent-provided evidence, not independent CLI network verification. Never convert
mere reachability into `verified_live`. Closed/login/unreachable are distinct.

Save actual source text with `run save_job_opportunities`, 1–12 per batch. Only a
complete JD containing responsibilities and requirements enters the job pool;
fragments remain leads, cannot be used as `job_id`, and do not count as jobs.
The CLI writes a content-addressed immutable Markdown under `career-data/jd/jobs/`
before the root compare-and-save. It never deletes orphan evidence after conflicts.
Use returned `savedJobs[].jdPath`, not a guessed filename.
Use `run save_job_research` for company research with actual source access dates.
Then write `{ "limit": 10 }` to a request file and run:

```sh
node "<package-root>/app/tools/job-hunt.mjs" run get_job_research_digest --input-file "digest-request.json" --project "<current-project>"
```

The result contains `markdown` and structured data. Missing history/exclusion
information is unknown, never inferred as no changes. Evidence uses only current
`confirmed` career episodes and QA answers. Quotes/IDs are bounded excerpts;
read the full entity when omitted/truncated. Literal overlap does not establish
qualification; no new match percentage is computed. Legacy estimates are unverified.
Research does not authorize applications or contacting anyone. This CLI does not
fetch pages and has no `verify` or `discover-ats` command.

## Finite observation of existing files

`ops` also declares the `observe` command and schema. With the same Host write
protocol probe as above, pass one JSON request via `--input-file`:

```sh
node "<package-root>/app/tools/job-hunt.mjs" observe --project "<current-project>" --input-file "observe-request.json"
```

Plan example: `{ "action":"plan", "runId":"jobs-existing", "task":{"limit":10},
"intervalSeconds":3600, "maxTicks":24 }`.
Subsequent requests are `{ "action":"tick|status|stop", "runId":"jobs-existing" }`
using one concrete action. Each tick runs once and exits. Status is read-only;
stop writes a persistent marker. Records are separate under
`observations/<runId>/`; the snapshot is not changed. Each plan defaults to 24 hours from creation, or an explicitly earlier deadline.
The create-only plan cannot be extended through these commands. State, bounded tick receipts/logs, lock and final summary
belong to that project. A changed package halts the plan. Active locks are never
removed by age; damaged locks/state fail visibly. No network fetching, continuous
monitoring, agent development loop or OS timer is installed by these commands.
