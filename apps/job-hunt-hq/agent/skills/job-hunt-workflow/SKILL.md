---
name: job-hunt-workflow
description: Operate the project-bound Job Hunt HQ panel from the current CodeShell session. Use whenever the user asks to initialize or repair a project-local job-search workspace; import JD text, screenshots, PDFs, Word files, chat exports, or project files; find, select, or compare jobs; collect or verify JDs; research companies, reviews, or interview reports; build or revise a source-backed Base Resume; derive a job-specific resume from a saved base; trace resume claims to experience, repositories, files, or commits; curate or import a canonical interview question bank; generate practice sets and recommended answers from one JD or an aggregate of multiple JDs; analyze JD fit; create preparation plans; run mock interviews; save real interview debriefs; iterate materials from feedback; update application progress; or execute any user-selected combination of these tasks.
---

# Job Hunt Workflow

Keep the conversation in the current CodeShell session. Do not create a second
chat surface or ask the user to open another repository. The enabled Panel App,
its tools, and this Skill are one project-scoped product.

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

1. Use `Panel` with `action: "tools"` and
   `panel_id: "panel-app:job-hunt-hq"` as the first useful tool call unless the
   current tool contract is already visible.
2. Invoke `get_job_search_context` before browsing or drafting, but never ask
   it for a full project dump. With no arguments it returns only counts,
   selected-object summaries, available scopes, and policy. Then read the
   smallest sufficient slice:
   - `candidate` for profile, repositories, work history, and a paginated
     resume index;
   - `jobs` or exact `job_id` with `scope=job`;
   - `resumes` or exact `resume_id` with `scope=resume`;
   - `questions` for the paginated question index, `scope=practice` with an
     exact `bank_question_id` and `practice_attempt_id` for scoring, or
     `scope=interview` for a complete set / mock Session relationship;
   - `discovery` for providers and search preferences; `intake` for the JD
     inbox.
     Follow `nextCursor` for a catalog only when the requested task genuinely
     needs the rest of that catalog. Do not bypass a bounded Panel read by loading
     the entire project snapshot file. Preserve existing `claimEvidence` when
     its claims remain unchanged.
3. Check once for the active project's root `CODESHELL.md`. If present, follow
   it and read only the candidate files it identifies. Its absence is not a
   blocker and must not trigger repeated searches.
4. If the target is still unknown, inspect only obvious resume, profile, work
   history, or repository-summary files. Ask one concise question only when a
   target role or other essential constraint still cannot be inferred.
5. Treat project files as candidate source of truth and panel data as a
   visualization snapshot. Invoke `save_candidate_context` only when verified
   candidate facts changed.
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

Write every requested structured artifact through the appropriate Panel App
tool before the final response. For multiple selected jobs, write one
job-specific artifact at a time so each output keeps its `job_id`. When a Panel
Trace ID is present, finish with `complete_execution_trace` so the Panel shows
an explicit output summary instead of inferring success from Session busy
state. Then summarize briefly what changed in the panel, what remains
unverified, and the highest-value next step.
