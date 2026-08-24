# Job Hunt HQ task modules

Run only the modules requested by the user or selected in the Panel task
composer. A request may target zero, one, or many explicitly shortlisted jobs.
Reuse the same candidate evidence across jobs, but write each job-specific
artifact with its own opaque `job_id`. Jobs in `inbox` are discovery results,
not evidence of user interest.

## Initialize the current project

Use this module when the Panel target kind is `project-bootstrap` or the user
asks the Panel to initialize, repair, scan, or complete the current project.

1. Invoke `get_job_search_context` with `scope=candidate`, inspect its bounded
   source and resume indexes, and read the
   current `CODESHELL.md` when present. Scan only obvious resume, biography,
   work-history, portfolio, project-summary, and interview-note files. Exclude
   dependencies, build output, caches, generated bundles, and large binaries.
2. Reuse existing paths. Do not move, rename, reformat, or duplicate candidate
   files merely to match a preferred layout.
3. If `CODESHELL.md` is absent, create it. If it exists, preserve unrelated
   project instructions and add or update only a concise `Job Hunt HQ` section
   that identifies authoritative paths, target directions, and fact rules.
4. Only when equivalent candidate-data files do not exist, create the missing
   files among:
   - `career-data/profile.md`
   - `career-data/work-experience.md`
   - `career-data/projects.md`
   - `career-data/interview-notes.md`
   - `career-data/jd/README.md`
     Keep incoming JD text, screenshots, PDFs, documents, and chat exports under
     `career-data/jd/inbox/`; do not mix them into candidate evidence files.
5. Write explicit `TODO` prompts into new templates. Never present a template,
   example, inferred metric, or guessed employment detail as candidate fact.
6. Inspect Git history read-only when it belongs to the current project. A Repo
   or commit is candidate evidence only after authorship and the substantive
   change are verified.
7. Invoke `save_candidate_context` with every verified fact and empty arrays
   for categories with no evidence. This creates or updates the current
   project's `job-hunt-panel.json` through the Panel.
8. Generate a first Base Resume only when one broad target category can be
   inferred and at least three resume claims can be supported. Otherwise finish
   initialization and report the smallest set of real facts still needed.

Do not open another repository, create a second chat, or ask the user to build
this directory structure manually.

## Import JD inbox sources

Use this module when the Panel target kind is `jd-intake` or the user asks to
import JD files, screenshots, pasted chat text, PDFs, Word files, or the project
JD inbox.

1. Invoke `get_job_search_context` with paginated `scope=intake` and process
   only the named `intakeId` /
   `sourcePath` values under `career-data/jd/inbox/`. A project scan stays in
   that directory and must not scan another Repo.
2. Read normal text files directly. For a Panel-staged
   `_attachments/*/manifest.json`, read its `parts` in order, concatenate and
   decode their base64 into exactly `reconstructedPath`, then verify
   `byteSize` and `sha256`. Never reconstruct outside the current project.
3. Extract from screenshots, PDFs, Word documents, chat exports, and text as
   supported by the available tools. One source may contain multiple jobs.
   Preserve its path, original link, visible dates, and uncertainty. Combine
   multiple screenshots into one JD only when company, role, context, and page
   order clearly agree; otherwise use `needs_review`.
4. Invoke `save_job_opportunities` for every verified candidate. Only a complete
   JD that passes the Panel gate returns a formal `savedJobs` ID. Partial text
   returns a `savedLeads` record and must not be treated as a `job_id`.
5. Invoke `save_jd_intake_results` for every processed source with one terminal
   status: `imported`, `duplicate`, `needs_review`, or `failed`. `imported`
   requires real formal `job_ids`; a source that produced only leads is
   `needs_review`. A Trace alone is never a completed import.
6. Stop after intake unless another module was explicitly selected. Imported
   jobs remain `inbox`; do not start resumes, research, or interview work.

## Dependency rules

- Treat the Panel's five stages—foundation, discovery, inbox triage,
  preparation, and follow-up—as state boundaries. They explain what is safe to
  do next; they are not a mandatory end-to-end scenario.
- Discovery can run alone.
- Company intelligence, match analysis, JD-grounded interview questions, and
  JD-grounded mocks require a shortlisted formal job with a complete JD. A
  canonical bank import does not require a job. A `jobLead`
  never qualifies. An `inbox`
  record qualifies only when the user explicitly names or selects that job for
  the requested task.
- A Base Resume requires a broad `category`, never a `job_id`. One project may
  maintain multiple bases for different directions.
- A job-specific resume is a JD Variant. It requires a saved Base Resume, its
  `base_resume_id`, and a target `job_id`. If no applicable base exists, create
  and save the base before deriving the variant.
- Commit interview questions can run without a saved job. They require a Git
  repository with substantive, candidate-attributable commits.
- Match analysis and preparation planning share `save_preparation_plan`; when
  both are requested, write one combined plan per job.
- A normal Panel mock is self-contained and does not invoke the Agent per
  answer. An explicitly requested direct-chat mock or post-hoc AI review should
  use a saved practice set when available and retain the Panel-provided
  practice Session ID. Finalize the mock separately from real interview
  debriefs.
- A real interview debrief requires user-provided interview facts. After saving
  it, update a preparation plan or resume only when those tasks were also
  selected.

## Verify one recruiting channel

Use this module when the Panel target kind is `channel-verification`.

1. Resolve exactly one provider from the Panel payload. Do not open, verify, or
   search any other provider during this run.
2. Invoke `get_job_search_context` with `scope=discovery`, confirm the current
   Session, and open only
   that provider in the connected visible browser. Do not search for jobs.
3. Treat Panel-managed login as already resolved by the CodeShell Host. The
   Panel may have opened an isolated login window, saved the Cookie, and
   restored it to this task browser before submitting verification. Do not call
   `UseCredential` or `InjectCredential` for a Panel-launched run. Only when a
   direct chat explicitly asks the Agent to restore a saved Cookie, read and
   follow [channel-login.md](channel-login.md).
4. Classify the final visible result as exactly one of:
   - `ready`: the channel can proceed to a real search in this Session;
   - `login_required`: the user must sign in;
   - `captcha_required`: the user must complete a visible challenge;
   - `blocked`: access is denied or restricted;
   - `unavailable`: the site cannot currently be reached or verified.
5. Treat the CodeShell browser profile as host-owned. Its current-Session
   partition is persistent across app restarts, so a user login can survive a
   restart without exposing Cookie values to the Panel or Agent. Never read,
   export, copy, or serialize accounts, passwords, cookies, tokens, CAPTCHA
   values, or browser storage. Panel-managed login and restoration remain
   entirely in the Host. A direct-chat, host-gated `InjectCredential` call is
   allowed because it does not expose Cookie values to the Agent. Never promise
   automatic cross-Session reuse: restoring a separate saved login always
   requires an explicit provider-scoped action and the Host's gate.
6. Invoke `save_channel_verification` with `provider_id`, the classification,
   and a concise user-visible `detail`. An injection count is not evidence of
   login; only the fresh visible page is.
7. Invoke `complete_execution_trace` and stop. When user action is required,
   leave the visible page available for the user; after they finish, the Panel
   starts a new verification run for that same provider.

A direct chat follow-up such as “inject my saved BOSS Cookie and check again”
continues the same one-provider verification through
[channel-login.md](channel-login.md). Re-read Panel context, perform the fresh
browser check, and actually invoke `save_channel_verification` after
the observation. Reuse the supplied Trace ID when it is still available; if
none is available, do not invent one or claim that a Trace was completed.

## Discover jobs

1. Resolve target roles, locations, seniority, freshness, work mode,
   exclusions, and providers from the Panel's `discoveryPreferences`, the
   request, and one pass over relevant project files. Explicit Panel values
   win; do not silently widen excluded roles, companies, locations, work
   modes, or date windows.
2. Read `channelVerifications`. Every requested provider must be `ready` for
   the current Session before a Panel-launched discovery starts. If any record
   is missing, stale, or not ready, do not browse or search; return the exact
   providers to the Panel's one-channel verification module.
3. Browse the requested provider as the user sees it. Prefer public listing
   pages, official careers pages, and public structured ATS pages. Never export
   browser credentials or replay authenticated requests outside the browser.
   If the visible access state changes, invoke `save_channel_verification` with
   the new state and stop only that provider.
4. Verify that each retained listing appears current. Save useful candidates in
   batches while continuing to their detail pages:
   - `listing_only`: title/company/URL and visible listing metadata
   - `partial`: a real excerpt or incomplete JD
   - `full`: the complete visible JD
5. Invoke `save_job_opportunities` with relevant records. `listing_only` and
   `partial` records land in `jobLeads`; only a `full` record with substantive
   responsibilities and requirements enters `jobs` as `inbox`. Leads do not
   count toward the requested total. Continue opening candidates until the
   formal target is reached, viable results are exhausted, or access is blocked.
   Do not move a new formal job to `saved` or start downstream preparation
   unless the user explicitly expresses interest or selects that exact job.
   Later calls should enrich matching URLs instead of creating duplicates.
6. Estimate match only when candidate evidence exists. Otherwise omit it.
7. Summarize successful providers in one `source` Trace event and report each
   blocked provider as a `warning`. Include provider coverage, inbox-added /
   updated counts, incomplete JDs, and access limitations in the final Trace
   outcome, including separate formal-job and lead counts.

Stop after saving discovery results unless another module was selected.

## Run scheduled discovery

Use this module when the prompt contains
`job-hunt-hq:scheduled-discovery:v1`.

1. Continue the bound project and Session. Re-read Panel context and use only
   the listed providers that remain `ready` in that Session.
2. Do not pause for login, CAPTCHA, approval, or user questions. Mark a changed
   provider state, skip it, and continue with public or still-ready sources.
3. Apply the normal discovery module and count only complete formal JDs.
4. Save through `save_job_opportunities` when Panel tools are available.
5. Always write one immutable JSON receipt under
   `career-data/discovery/runs/<UTC-time>-scheduled.json` with
   `schemaVersion: 1`, a stable `runId`, `generatedAt`, `source: "scheduled"`,
   and the exact candidate records in `jobs`. Never edit
   `job-hunt-panel.json` directly; the Panel imports and deduplicates unseen
   receipts when the project is next synchronized.

## Research company and interview intelligence

For a single selected job:

1. Inspect the official company site, careers site, product pages, and reliable
   current public sources.
2. Search public employee or candidate reviews and interview reports.
3. Summarize recurring themes and visible disagreement. Anonymous anecdotes
   remain subjective evidence.
4. Distinguish reported interview questions from questions predicted from the
   JD.
5. Invoke `save_job_research` with a deduplicated source list, risks,
   confidence, and gaps.

## Analyze match and build a preparation plan

For every selected job, or once without a job for general preparation:

1. Break requirements into high-signal capabilities and constraints.
2. Map each requirement to explicit project, work-history, or resume evidence.
3. Separate:
   - verified strengths,
   - skills the candidate truly lacks,
   - capabilities that may exist but lack usable evidence,
   - facts or metrics that still need verification.
4. Classify every gap as `profile`, `evidence`, or `skill`. Never infer a skill
   gap merely because candidate documentation is incomplete.
5. Rank gaps by likely interview or screening impact.
6. Create specific resume changes, evidence-gathering actions, and practice
   prompts. For real `skill` gaps only, create a staged learning Roadmap with a
   realistic duration, smallest useful tasks, a portfolio or practice
   deliverable, observable success criteria, and status. Prefer project output
   over course lists. Use an empty Roadmap when no real skill gap exists.
7. Invoke `save_preparation_plan`. Use one combined plan when both match and
   preparation tasks were selected.

## Build, tailor, or revise a resume

Start by resolving the requested layer. The durable flow is: verified candidate
facts and Source evidence → broad Base Resume → JD Variant → public application
file. Do not skip a prior layer or leak internal evidence notes into the public
Markdown/PDF.

1. Read [resume-quality.md](resume-quality.md), `baseResumes`,
   `selectedBaseResumeId`, `resume`, `resumeVersions`, and all verified
   candidate evidence.
2. For a Base Resume:
   - choose one broad category;
   - optimize the complete candidate story, structure, evidence strength, and
     outcome-led bullets without using an employer-specific JD;
   - rank facts by relevance, outcome, ownership, evidence, and
     differentiation; mark only the best 3–6 as `core`;
   - map the professional summary and every capability, work, and project
     bullet to source-backed `claim_evidence` using the exact rendered text;
     explain what each source proves and add point-specific interview questions;
   - save the usable draft first, then add 3–8 private `candidate_questions`
     targeting high-value facts the user may have forgotten; do not block the
     draft or confuse these with interviewer questions;
   - invoke `save_resume_draft` with `resume_kind: "base"`, `category`,
     `claim_evidence`, `candidate_questions`, and no `job_id` or
     `base_resume_id`.
3. For a JD Variant:
   - require an applicable saved base; create it first if missing;
   - read that complete base before the JD;
   - extract 6–10 high-signal JD requirements and map them to true base/project
     evidence;
   - preserve facts and chronology while changing emphasis, summary, ordering,
     and natural keyword coverage;
   - re-rank the 3–6 `core` claims for this JD and preserve or update exact
     claim-to-source mappings; never use the JD as the only source for a
     candidate capability;
   - preserve answered candidate QA and generate focused new questions only
     for unresolved facts that could strengthen this JD match;
   - invoke `save_resume_draft` with `resume_kind: "variant"`, the base's
     `category`, `base_resume_id`, `job_id`, and complete `claim_evidence`.
4. Put uncertain or missing facts in `notes` instead of filling them in.
5. Treat a Markdown/PDF export as an application file derived from one exact
   resume version. Export does not create new facts, alter the Base, or imply
   that the user applied. Do not cross this boundary while any public claim is
   `needs_review`, lacks a concrete evidence explanation, or lacks an interview
   defense. Keep the internal evidence ledger and private QA out of the public
   file.

For private resume QA, ask one saved question at a time. After the user's
answer, invoke `save_resume_qa_answer` with the exact resume and question IDs.
Treat explicit user confirmation as `user:resume-qa:<question-id>`; use
`needs_source` when a metric, date, ownership boundary, or outcome still needs
stable support. Do not change the public resume until the user separately asks
to apply answered QA.

Default section order:

1. Name, target role, contact, optional photo
2. Professional summary
3. Relevant skills
4. Reverse-chronological work experience
5. Selected projects or repositories
6. Education or other sections only when verified

## Generate interview questions

For every selected job:

1. Cross-reference the JD, current resume, verified repositories, work history,
   saved research, and current preparation gaps.
2. Cover technical foundations, project depth, system design, behavioral
   evidence, and material gaps unless a narrower focus was requested.
3. Give every question a reason, evidence references, grounded answer points,
   a practice-ready `recommended_answer` using only verified candidate facts,
   and realistic follow-ups.
4. Invoke `save_interview_question_set` with `source_mode: "jd"` and the exact
   `job_id`.

For a role-family aggregate:

1. Require 2–8 exact selected job IDs and cross-reference every complete JD.
2. Merge synonymous requirements and rank hiring signals by recurrence across
   the selected JDs. Distinguish shared signals from one-off requirements.
3. Build one coherent role-family set. Record JD coverage for recurring signals
   in the reason or evidence reference; never concatenate separate single-job
   sets.
4. Cross-reference candidate experience, Base Resume, repositories, commits,
   and known gaps. Every question still requires a source-backed
   `recommended_answer`, answer points, and a non-duplicative follow-up.
5. Invoke `save_interview_question_set` with `source_mode: "aggregate"`, exact
   `job_ids`, and no `job_id`.

Every saved practice set is a target-specific selection. The Panel links its
questions into the canonical question bank; do not create a second independent
long-term bank in the set itself.

## Import questions from the current Session

1. Read only the current Session content supplied by the Panel action. Do not
   claim access to another task or Session.
2. Extract questions that were actually asked or explicitly listed as
   interview questions. Exclude candidate answers, assistant analysis,
   headings, meta-instructions, and invented variants.
3. Preserve the question's meaning, then classify type, category, competency,
   difficulty, priority, origin, tags, and Source when the transcript supports
   them. Leave unsupported enrichment empty.
4. Invoke `save_interview_question_bank_items` once with 1–50 items and
   `origin: "session"`. The Panel fingerprints and merges duplicates and puts
   new Session questions in `inbox` for the user to review and edit.
5. Do not generate a practice set or start a mock unless the user separately
   requested it.

## Run or review a mock interview

The normal Panel mock is local: the Panel asks, records/transcribes, saves the
raw answer into the project, and advances without invoking this workflow. Do
not expect or manufacture a Session task for every Panel answer.

Only continue below when the user explicitly asks for a direct-chat mock or AI
review of answers already saved by the Panel.

1. Read the selected job when applicable, saved practice set, canonical bank
   items, and the Panel-provided practice Session ID. Use only the exact
   canonical `questionIds` captured for the Session; the Panel excludes
   `inbox` and `archived` items even if the saved set still references them.
2. For a direct-chat mock, ask one question at a time and withhold answer points
   until the user answers. For a post-hoc Panel review, use the raw saved answer
   and do not ask or advance questions in chat.
3. Score evidence and ownership, structure, answer depth, and role relevance
   from 0–100 according to the interview-coach rubric. Give concise strengths,
   prioritized improvements, and an optimized answer using verified facts.
4. Invoke `save_interview_practice_review` with the exact `bank_question_id`,
   `practice_session_id`, and available `interview_set_id` / `question_id`, then
   ask one follow-up or continue only in an explicitly requested direct-chat
   mock. In a post-hoc review, save feedback and stop at the requested scope.
5. Never turn an unsupported answer into a candidate fact.
6. End with strengths, risks, and the next practice focus. Invoke
   `save_mock_interview_session` with `completed`; use `abandoned` when the user
   explicitly stops. Include the summary, strengths, improvements, and
   observable next actions; do not send reviewed IDs or score totals because
   the Panel derives them from the saved per-question reviews. Save another
   artifact only if the user selected it.

## Update application progress

Use this module when the user changes a saved job's recruiting stage, reports
contact with a recruiter, schedules or finishes an interview, receives an
offer or rejection, withdraws, archives a role, or asks to set a follow-up.

1. Resolve one saved `job_id` and preserve the existing JD and artifacts.
2. Use only an explicit user action or user-provided recruiting event. Do not
   infer `applied` from a generated resume, `interviewing` from a practice
   session, or `offer` from positive feedback.
3. Choose one stage: `saved`, `tailoring`, `applied`, `screening`,
   `interviewing`, `offer`, `rejected`, `withdrawn`, or `archived`.
4. Keep a concise factual `note`. Add `next_action` and `next_action_at` when a
   follow-up, interview, decision, or preparation deadline is known.
5. Invoke `update_application_progress`. It appends to the job's timeline; do
   not overwrite history manually.

## Save a real interview debrief

1. Ask the user for the round, questions, answer summaries, interviewer
   feedback, outcome, and anything they felt went well or poorly. Accept rough
   notes; do not demand a polished format.
2. Separate directly reported facts from the Agent's interpretation. Put
   interviewer comments in `reported_feedback` and interpretation in
   `analysis`; either may be an empty string.
3. For each question, record the answer signal and better-answer points without
   inventing missing content.
4. Invoke `save_interview_debrief`.
5. If the user explicitly reported a recruiting stage or next action, also
   invoke `update_application_progress` for that job.
6. If preparation or resume iteration was also selected, use the debrief as new
   evidence and update only the corresponding artifacts.

## Long combinations

Planned steps may include discovery, JD verification, company research,
reviews, interviews, resume, preparation, debrief, and final artifacts. Save
useful business artifacts early; every tool call is already visible in the
active Trace. Finish that Trace with `completed`, `partial`, or `failed`.
