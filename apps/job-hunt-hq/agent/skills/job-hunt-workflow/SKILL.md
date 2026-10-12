---
name: job-hunt-workflow
description: Operate project-bound Job Hunt HQ from the current CodeShell chat. Use its Node CLI without opening the Panel to maintain private experiences, decisions, factual QA and named library versions, or save requested resumes. Use Panel tools for other job and interview tasks.
---

# Job Hunt Workflow

Keep the conversation in the current CodeShell session. Do not create a second
chat surface or ask the user to open another repository. The installed package,
its tools, CLI, and this Skill operate on the same project data. The four CLI
operations below do not require opening the Panel.

## Use the capability without opening the Panel

Use the local Node CLI for these operations when working directly in chat:

| Operation | Supported work |
| --- | --- |
| `get_job_search_context` | Bounded current context and saved knowledge-library history |
| `save_candidate_context` | Exactly one incremental `source`, `episode`, `qa`, `library_version`, or `career_update` mode |
| `save_resume_draft` | Save a requested Base Resume or JD Variant |
| `save_resume_qa_answer` | Save a factual answer associated with an existing resume claim |

The legacy complete `profile` + `repositories` + `work_history` replacement is
not supported by the CLI. Other operations in the 16-tool workflow, including
job intake, research, interview scoring, and execution traces, still use the
Panel tool protocol below. Saving knowledge does not request a resume.

`CODESHELL_SKILL_DIR` in the following commands is substituted by the Host in
this Skill's text with its installed absolute directory. It is not a shell
environment variable; do not export or guess it. Use the substituted path, or
an explicitly provided project-pinned package path. Local Node is required.
If the runtime or installed path is unavailable, report that limitation. If an
OS sandbox makes an installation under `~/.code-shell` inaccessible, report
the inaccessible path rather than bypassing the sandbox.

Read the CLI contract once when it is not already visible:

```sh
node "${CODESHELL_SKILL_DIR}/../../../app/tools/job-hunt-cli.mjs" ops
```

For a positional operation, the JSON file contains only that operation's
input. Write `career-data/requests/read.json` with `{"scope":"career_versions"}`,
then read the active project:

```sh
node "${CODESHELL_SKILL_DIR}/../../../app/tools/job-hunt-cli.mjs" get_job_search_context --project "$PWD" --input-file career-data/requests/read.json
```

Keep `--project` bound to the user's active project, or an explicitly selected
absolute project path. Request files are project-relative. Each UTF-8 request
is limited to 64 KiB; the separately referenced `career_update` document keeps
its 128 KiB limit. Do not move a batch into the request envelope to evade these
limits. The CLI validates the same operation input schemas as the Panel.

Alternatively, omit the positional operation and send a complete JSON envelope
on stdin. This read example does not change project data:

```sh
node "${CODESHELL_SKILL_DIR}/../../../app/tools/job-hunt-cli.mjs" --project "$PWD" <<'JSON'
{"operation":"get_job_search_context","input":{"scope":"career_versions"}}
JSON
```

For every mutation, first read the project and retain the returned top-level
`revision`. Supply that exact value as envelope `expectedRevision`, or as
`--expected-revision` with a positional operation. A missing root returns
`revision: null`; use JSON `null` or `--expected-revision null` for that new
project. Never guess a revision or force an overwrite. The optional envelope
`sessionId` (or `--session-id`) identifies this chat when available.

`library_version` preview and `career_update` preview are read-only and do not
require `expectedRevision`. For JSON batches, preview first, show the changes,
then apply the exact returned `preview_token` with the read revision when
saving is authorized. The token binds the update file, project identity, career
records and version index; it is separate from the root revision. If the file
or career library changes, preview again. On a revision conflict, read current
context and reconcile changes before retrying; never replace another writer's
work. On a busy project, let the current save finish before retrying.

The CLI and Panel share `job-hunt-panel.json`, its referenced shards, and
`career-data/` history, using the same root revision check and commit lock.
Successful writes appear when the Panel reads the project. This does not
include unsaved form text or browser drafts. A successful same-file,
same-version `career_update` apply retry returns the saved version without
overwriting subsequent edits. If a receipt is lost, query that exact version
before deciding to retry, as described below. An error or inaccessible file
is not a successful save. CLI calls do not complete Panel execution traces.

## Build knowledge-library versions through the current chat

The primary workflow is conversational: the user shares a Slack/GitHub link or
selects already connected data, discusses an experience in this session, and
asks to save a new version of their experiences, decisions and factual QA.
Keep three separate layers: original `sourceMaterials`, attributable
`careerEpisodes`, and factual `careerQa`. The Panel is for reviewing the
library, differences, and historical versions; manual forms are optional.
A knowledge-library version is distinct from a software release, a resume
revision, interview questions, practice answers, and AI scores. Do not generate
a resume unless the user requests one.

- When chat should produce a JSON file for the Panel, read
  [references/career-update.md](references/career-update.md), the linked
  [JSON Schema](references/career-update.schema.json), and the complete
  [synthetic example](references/career-update.example.json). Write the update
  through the available File tool, then use `save_candidate_context`'s
  `career_update` preview/apply mode. Apply the returned token directly when
  saving is already authorized; this atomically merges the records and saves
  their named version. Report the returned saved version ID/title and finish
  this batch; do not also call `library_version` preview/save for it. When only
  a file or preview was requested, stop at that requested output. A file or
  working-library change requires a new preview.
  If apply times out or loses its receipt, first query `career_versions` with
  that exact `version_id`; a timeout does not cancel the save. Use an attached
  result, wait for an ongoing save, or retry the same file and ID only after
  failure is established. Do not blindly repeat apply or invent a replacement ID.
  Writing the file alone does not import it; never write Panel snapshots,
  start an HTTP port or scan the update directory in the background.
- Read `career_sources`, `career_episodes`, or `career_qa` catalogs with
  `search`, `status`, and pagination. Read a record with its exact `source_id`,
  `episode_id`, or `qa_id` before proposing changes. Reuse existing IDs.
- Collect only the links or connected data authorized for this conversation.
  For Slack, preserve permalink, workspace/channel/thread identity, visible
  authors, timestamps and relevant context. For GitHub, verify the exact
  PR/commit, substantive diff and personal author identity; repository access,
  ownership, titles or merge attribution alone do not establish personal work.
  Do not search unrelated channels/repos or send messages.
- Discuss one high-value missing fact at a time: background, the candidate's
  own responsibility and action, considered alternatives, the decision, why,
  tradeoffs, actual outcomes, or retrospective. Keep unknowns explicit.
  Save the user's actual factual answer in `answer`; AI-polished expression
  belongs in `draftAnswer` and must not replace the original meaning.
- Save working records through `save_candidate_context` using exactly one
  nested `source`, `episode`, or `qa` object. These incremental modes preserve
  unrelated data. For file-backed batches use `career_update` instead; do not
  pre-save its records individually. Do not combine these modes with each other,
  `library_version`, `career_update`, or
  the complete legacy `profile` + `repositories` + `work_history` replacement.
- Unconfirmed writes remain drafts or pending revisions. If the current chat
  user explicitly verifies these exact facts, pass their actual original words
  in top-level `confirmation` with that one `source`, `episode`, or `qa`.
  Never invent or infer confirmation, quote another source participant as the
  user, send `actor`/`confirm`, or mark an AI expression as verified. Merely
  asking to read a link, polish wording, or save a version is not factual
  confirmation. The user can also review facts directly in the Panel; do not
  require them to repeat an explicit chat confirmation in a manual form.
- For records saved through the direct single-record modes above, call
  `save_candidate_context({library_version: {action: "preview"}})` to read the
  changes since the last saved knowledge-library version before finalizing
  this conversation's work, without writing. JSON batches use `career_update`
  instead; a successful apply has already saved their version.
  Explain the additions, revisions, unresolved facts, and pending proposals
  in chat. When the user asks to save this version, call the same tool with
  `library_version: {action: "save", title: "...", summary: "..."}`. An optional
  stable `id` makes a retry idempotent; reuse it only for that exact version.
  Saving freezes the current sources, experiences, decisions and QA, including
  draft/pending state. It does not confirm every fact or create a resume.
- Read `scope: "career_versions"` for bounded version metadata and counts,
  optionally exact `version_id`. To inspect historical material, pass that
  `version_id` with `career_sources`, `career_episodes`, or `career_qa` and
  exact record IDs or pagination. Metadata never expands into the whole
  library. Historical snapshots are immutable reference material; read the
  current working record before proposing updates, and never silently restore
  a historical version over current data.
- An unconfirmed AI edit to a reviewed episode or QA remains a pending
  revision, preserving the reviewed text. Source changes return dependent
  facts to review; rereading or AI regeneration does not reconfirm them.
- Source excerpts are limited to 16,000 characters. For longer Slack threads,
  save separate message sources or preserve the full text actually collected
  under `career-data/source-materials/` with `localRef`. Record actual pages,
  messages, missing ranges and truncated patches; never claim a complete read
  after silently slicing the input. A save does not fetch source content.
- Use only connected tools and project files actually available in this run.
  Explain inaccessible sources honestly; never invent authors, dates, hashes,
  metrics, personal ownership or results to fill gaps.
- Keep internal messages, code, source excerpts and factual QA private.
  Confirmation establishes factual accuracy, not permission to publish.
  Generate public-safe resume paraphrases only when separately requested,
  using current confirmed facts and exact `source_ids`, `episode_ids`, and
  `qa_ids` on each derived claim. Never copy private excerpts automatically.
- A working record retains at most 40 revisions and 280 KiB of serialized
  content. On a failed write, preserve all prior data and explain the failure;
  use an explicitly linked continuation when wanted. Never delete history to
  force a save. Named knowledge-library versions remain immutable.

Read [references/workflows.md](references/workflows.md) for conversational
collection and versioning, and [references/data-contract.md](references/data-contract.md)
for the exact tool shapes.

## Resolve jobs and tasks independently

Treat the request as two independent selections:

1. **Target jobs**: zero, one, or many explicitly shortlisted `job_id` values.
   Zero means a general candidate artifact such as a baseline resume or
   preparation plan. A discovered job in `inbox` may be inspected or compared,
   but it is not a downstream target until the user marks it as interesting or
   explicitly selects that exact job for a task.
2. **Requested tasks**: any combination of discovery, JD verification, match
   analysis, company/interview intelligence, resume revision, question sets,
   preparation planning, mock interviewing, debriefing, or progress updates.

The Panel task composer may pass explicit jobs and tasks. Treat those as the
execution boundary. In ordinary chat, infer the smallest useful combination
from the user's words. Never add research, resumes, questions, or mock
interviews merely because another task was requested. Presets are shortcuts,
not fixed workflows.

## Respect state boundaries without forcing a fixed journey

Use these boundaries to prevent accidental work, not to force every request
through every stage:

1. **Foundation**: candidate evidence and a direction-level Base Resume are the
   foundation for resume work. A Base Resume is required before a JD Variant,
   but discovery or company research can still run independently.
2. **Inbox**: discovery and manual JD import create formal `inbox` records only
   after a complete JD passes the Panel gate. Search-result cards and incomplete
   descriptions remain `jobLeads`; they are visible triage inputs but are not
   jobs, do not count toward a discovery target, and cannot drive downstream
   artifacts. Reading or collecting a JD never implies interest. Treat authenticated recruiting
   sites, public company pages, recruiter or friend forwards, chat or email
   text, and JD files in the current project as equal intake channels. Preserve
   the channel and original Source on every record.
   Files received through the Panel first live in `career-data/jd/inbox/` and
   have a `jdIntakeItems` status. A Session Trace is only the audit trail; it is
   never the import result. Every processed source must be finalized through
   `save_jd_intake_results`, even when recognition fails.
3. **Shortlist**: only an explicit user action moves a job to `saved`
   (interesting). Panel-launched downstream jobs should come from this set.
4. **Preparation**: run only the selected modules for the selected jobs. Do not
   turn one requested artifact into an automatic full job package.
5. **Follow-up**: application stages, reminders, interview facts, and debriefs
   change only from explicit user actions or user-provided recruiting events.

The Panel may recommend the earliest unresolved boundary as the next best
action. This recommendation is not an execution order: honor any other valid,
explicit user-selected module.

## Keep the resume foundation explicit

- Treat a Base Resume as a durable candidate artifact for one broad job
  category, such as frontend engineering or AI application engineering. It is
  not tied to a company or `job_id`.
- Treat a JD Variant as a derivative. It must identify both the saved
  `base_resume_id` and target `job_id`.
- Treat an exported application file as a public derivative of one exact Base
  or JD Variant. It must not expose private QA, Source notes, or the evidence
  ledger, and exporting it never implies that the user applied.
- Never jump from raw candidate files straight to a JD Variant when no
  applicable Base Resume exists. Build and save the Base Resume first, then
  derive the requested variant.
- A Base Resume may cover a broad direction, but it must still use only
  verified candidate evidence. Do not copy employer-specific JD language into
  it.
- Treat evidence as part of the resume version. The professional summary and
  every material Markdown bullet must have one exact `claim_evidence` entry
  and at least one traceable source. Remove or soften a claim when no source
  exists.
- Mark only 3–6 differentiating claims as `core`; mark the rest as
  `supporting`. Explain why each point matters, what each source actually
  proves, how to improve a weak point, and which interview questions can test
  it.

Read [references/workflows.md](references/workflows.md) for the selected task
modules and their dependencies.
Load only the specialized Skills required by the selected modules:

- `job-hunt-hq:job-intelligence` for discovery, JD verification, job
  comparison, company research, public reviews, or interview reports;
- `job-hunt-hq:resume-writing` for resume claims, selection, emphasis,
  wording, revision, tailoring, or editorial audit;
- `job-hunt-hq:resume-design` for every generated resume's template and visual
  gate, and whenever the request involves layout, photo, density, A4, PDF,
  ATS extraction, or export;
- `job-hunt-hq:interview-coach` for canonical-bank curation or Session import,
  JD-grounded practice sets, mock interviews, debriefs, gap
  classification, preparation plans, or roadmaps.

Do not load a specialist merely because its output could be useful later. For
example, discovery loads Job Intelligence but does not load resume or interview
Skills; reading an inbox JD loads no downstream preparation Skill.
Read [references/resume-quality.md](references/resume-quality.md) before every
resume generation, revision, or review.
Read [references/data-contract.md](references/data-contract.md) only before a
structured write whose fields are not already clear from the Panel tool schema.

## Start with project context

1. For the four CLI operations above, read `ops` unless their current contract
   is already visible. For other workflows, use `Panel` with `action: "tools"`
   and `panel_id: "panel-app:job-hunt-hq"`. Do not require an open Panel for
   supported CLI work. Use Panel tools for a Panel-launched task that requires
   its execution Trace.
2. Invoke `get_job_search_context` before browsing or drafting, but never ask
   it for a full project dump. With no arguments it returns only counts,
   selected-object summaries, available scopes, and policy. Then read the
   smallest sufficient slice:
   - `candidate` for profile, repositories, work history, and a paginated
     resume index;
   - `career_sources`, `career_episodes`, or `career_qa` for private durable
     career facts; pass exact IDs for detail rather than dumping the library;
   - `jobs` or exact `job_id` with `scope=job`;
   - `resumes` or exact `resume_id` with `scope=resume`;
   - `questions` for the paginated question index, `scope=practice` with an
     exact `bank_question_id` and `practice_attempt_id` for scoring, or
     `scope=interview` for a complete set / mock Session relationship;
   - `discovery` for providers and search preferences; `intake` for the JD
     inbox.
     Follow `nextCursor` for a catalog only when the requested task genuinely
     needs the rest of that catalog. Do not bypass a bounded context read by loading
     the entire project snapshot file. Preserve existing `claimEvidence` when
     its claims remain unchanged.
3. Check once for the active project's root `CODESHELL.md`. If present, follow
   it and read only the candidate files it identifies. Its absence is not a
   blocker and must not trigger repeated searches.
4. If the target is still unknown, inspect only obvious resume, profile, work
   history, or repository-summary files. Ask one concise question only when a
   target role or other essential constraint still cannot be inferred.
5. Treat project files and the user-confirmed career library as candidate
   sources of truth. The project snapshot persists these facts and their
   provenance; it is not disposable UI state. Use `save_candidate_context`'s
   legacy complete `profile` + `repositories` + `work_history` replacement
   through the Panel tool only when those verified facts changed. The incremental
   career modes may save draft/pending records and named library versions without
   changing those legacy fields; saving does not confirm unresolved facts.
6. When the Panel requests project initialization, follow the initialization
   module in `references/workflows.md`. Reuse existing files, preserve unrelated
   `CODESHELL.md` instructions, and create only missing candidate-data homes.
7. A website-discovery task launched by the Panel requires an initialized
   project snapshot and candidate data. An explicit search keyword may supply
   the target direction. If the Panel or
   `get_job_search_context` reports that initialization is missing, partial, or
   blocked, do not browse yet; return the user to project initialization. A Base
   Resume is not required for discovery. Manual, recruiter-forwarded, and
   project-local JDs remain valid intake channels and do not require recruiting
   site authentication.
8. Treat recruiting-channel verification as a separate, one-provider task.
   Verify only the provider named by the Panel, do not search jobs during that
   task, and invoke `save_channel_verification` with the visible result. A
   Panel-launched website search may use only providers whose verification is
   `ready` for the current Session. A record from another Session is stale.
   When login, CAPTCHA, blocking, or unavailability appears, write that exact
   state and stop; never count the provider as searched. When the user clicks
   the Panel's saved-login action or explicitly asks to inject a saved Cookie,
   follow `references/channel-login.md`. After manual login or CAPTCHA, wait
   for a new one-provider verification task.

## Panel tool protocol

Call Panel App tools through:

```json
{
  "action": "invoke",
  "panel_id": "panel-app:job-hunt-hq",
  "tool_name": "save_job_opportunities",
  "arguments": {}
}
```

Use the exact arguments reported by `Panel` `action: "tools"`. Do not pretend a
write succeeded when the invocation failed. A successful invocation updates
the current project's `job-hunt-panel.json`, which the panel renders.
Never say that a verification state or Trace was written unless that exact
Panel invocation occurred after the final browser observation and returned
success.

## Execution style

- Treat a `Panel Trace ID` in the submitted prompt as opaque correlation
  metadata. Do not rewrite it or ask the user to manage it. When the current
  Panel tool schema exposes `trace_id`, pass that exact ID to every non-readonly
  Panel invocation, including every `save_*` invocation and
  `complete_execution_trace`. The Panel records each tool invocation and its
  written artifacts automatically, keeping failures and the final output
  attached to the execution that produced them.
- Make progress in batches. Do not narrate each click, page read, or tool call.
  Give one short start update, then only report a material result or blocker.
- Produce the first useful panel write early. For discovery, write verified
  candidates in batches through `save_job_opportunities`. The Panel routes
  `listing_only` and `partial` records to `jobLeads`; only a `full` record with
  substantive responsibilities and requirements enters `jobs` as `inbox`.
  Continue opening relevant detail pages until the requested number of formal
  jobs is reached, viable candidates are exhausted, or access is blocked.
  Persistence never means the user is interested, applying, or ready to prepare.
- Continue automatically through the selected task combination. Do not stop after
  announcing the next step.
- For a task launched from the Panel, invoke `complete_execution_trace` after
  the last useful structured write and before the final response. Use
  `completed` when the selected work finished, `partial` when useful output was
  saved but access, evidence, or user input is still missing, and `failed` only
  when no requested result could be completed. Put saved artifact IDs or
  compact source locators in `output_refs`. Interactive mock interviews may
  finish the initiating turn as `partial` while waiting for the user's first
  answer.
- Do not add generic process Skills after this Skill is active. Use the module
  router above to load only the specialized capabilities needed for the
  explicit request.

## Evidence rules

- Use only candidate claims verified in the current project. Never invent
  employers, dates, ownership, technologies, metrics, results, education, or
  contact details.
- Use a stable source locator for every resume claim:
  `experience:<id>`, `repo:<path-or-id>`, `file:<path>#L<line>`, or
  `commit:<sha>`. `claim` must copy the rendered Markdown bullet text so the
  Panel can calculate coverage. Also explain in `sources[].evidence` what the
  referenced material proves; a locator alone is incomplete. A JD is context,
  not proof of candidate skill.
- For every claim, set `importance`, `why_it_matters`, and 1–4
  `interview_questions`. Use questions to verify ownership, technical depth,
  tradeoffs, results, or failures. Put a specific next improvement in
  `improvement` when scope, outcome, attribution, or evidence is weak.
- Verified Commit references may support a JD-grounded question or resume claim,
  but the interview workflow does not create a separate Commit-only question set.
- Prefer official company and careers pages for company and role facts.
- Search current public pages only. Never bypass login, CAPTCHA, robots,
  paywalls, rate limits, or other access controls.
- For a recruiting site that requires authentication, stay in the current
  Session's connected browser and hand control to the user for sign-in or
  CAPTCHA. Continue after the user finishes. CodeShell owns and persists that
  Session's browser partition across app restarts; the Panel only records the
  verification result. The Panel's **Login and save** and **Restore and verify**
  actions are completed by the CodeShell Host before this Agent run; do not
  repeat them with credential tools. Only for a direct chat request to restore
  a saved login, read `references/channel-login.md` and use its host-gated
  path. Never inspect, export, copy, serialize, or promise ungated cross-Session
  reuse of Cookie values. If the user cannot sign in now, save transparent
  partial results from other requested channels and ask for a pasted or
  project-local JD.
- For Panel-launched discovery, never combine channel verification with job
  search. Read `channelVerifications` and search only providers marked `ready`
  for the current Session. If access changes while searching, immediately call
  `save_channel_verification` with the new state, stop that provider, and do not
  count it as searched. For ordinary chat without Panel verification state,
  first perform the same one-provider verification module explicitly.
- Never request, reveal, export, or materialize Cookie values or credential
  secrets. Do not call `UseCredential` with a Cookie id during recruiting-site
  verification. Panel-managed saved-login restoration stays entirely in the
  Host. A direct-chat, user-requested, approval-gated `InjectCredential` call
  is the only Agent-side restoration path. Never replay authenticated
  recruiting-site requests with shell commands, scripts, `curl`, or an
  out-of-browser HTTP client. Use the connected browser as the user sees it;
  when blocked, use public web search, official careers pages, another
  requested provider, or ask the user to paste the JD.
- Keep facts, subjective reviews, and inference separate. Paraphrase public
  reviews and attach their URLs.
- Label interview questions as `reported` only when a source supports them;
  otherwise label them `predicted`.
- Preserve the available JD, canonical URL, publisher, visible dates, access
  time, completeness, and important missing evidence. A listing snippet is a
  valid lead, not a formal job or complete JD. Never count it toward a requested
  job total.
- Return a transparent partial result when sources are blocked or weak.
- A match analysis or preparation plan must distinguish a missing skill from a
  missing piece of evidence or missing candidate-profile fact. Classify them as
  `skill`, `evidence`, or `profile`. Build a learning Roadmap only for real
  `skill` gaps; evidence and profile gaps require fact-finding or Source work,
  not courses. Do not recommend inventing experience to close any gap.
- A real interview debrief must come from user-provided notes, questions,
  answers, feedback, or outcomes. Ask briefly for missing interview facts
  before saving; never fabricate a completed interview.

## Finish

Write every requested structured artifact through the supported CLI operation
or appropriate Panel App tool before the final response; stop at a file or
preview when that is all the user requested. For multiple selected jobs, write
one job-specific artifact at a time so each output keeps its `job_id`. When a Panel
Trace ID is present, finish with `complete_execution_trace` so the Panel shows
an explicit output summary instead of inferring success from Session busy
state. Then summarize briefly what was saved in the project, what remains
unverified, and the highest-value next step.
