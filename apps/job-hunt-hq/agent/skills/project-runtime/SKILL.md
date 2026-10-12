---
name: project-runtime
description: Run the selected Job Hunt HQ package's project CLI for bounded context reads, candidate facts, private resume QA answers, and resume drafts from direct Chat or TUI requests without opening the panel.
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
| `get_job_search_context` | Read the smallest required scope; keep pagination and opaque IDs. |
| `save_candidate_context` | Save verified candidate facts and source indexes. |
| `save_resume_qa_answer` | Save an actual answer to an existing private resume question. |
| `save_resume_draft` | Save a Base Resume or JD Variant with complete evidence and private questions. |

Write one JSON object matching the selected schema to `--input-file`. Use the
same operation names and argument fields as the Panel tools. Do not load the
entire snapshot to bypass bounded reads. Keep existing evidence when a claim is
unchanged. A decision can be an existing resume `candidate_questions` entry
with `category: "decision"`; do not create a separate decisions entity or tool.

This version supports these four operations only. Discovery, JD intake,
application progress, interview writes, and `complete_execution_trace` still
require the Panel. If a direct request needs one of the other 12 tools, state
that it requires opening the Panel and use the workflow's Panel path; do not
claim a headless save or fabricate a CLI operation. Open the Panel for an
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
lock. Do not remove it merely because a command timed out. The Host does not
participate in this lock, so its writes still rely on the revision protocol.
Report other failures with their returned code and message. `--trace` is only
for an already known correlation ID; direct requests do not need a Trace or a
`complete_execution_trace` call. Resume saves and QA updates record
`source: "cli"` and the supplied Session ID on the resume; archived versions
retain that provenance. A candidate-profile change updates provenance on
affected existing resumes, and a supplied Trace updates its matching
`workflowRuns` entry. A standalone candidate save with neither an existing
resume nor a matching Trace has no durable provenance record in this version.
