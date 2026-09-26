# Job Hunt HQ data contract

Use project snapshot schema version 2. Treat IDs as opaque strings.

Session traces are Panel-local execution telemetry, not part of the project
snapshot. A `Panel Trace ID` may appear in a submitted prompt; leave it intact.
Pass that exact value as `trace_id` to every non-readonly Panel tool exposed by
the current schema. This explicitly associates telemetry and write-back
artifacts with the correct execution even when older traces are still visible.
The read-only `get_job_search_context` call does not require `trace_id` and
returns the currently active ID for inspection. It is a bounded query API, not
a snapshot export. Its default `summary` response contains counts and selected
IDs; use `scope` plus exact opaque IDs for full objects, and `cursor` / `limit`
for catalogs. Never read the whole `job-hunt-panel.json` merely to compensate
for an overly broad context call.

Each business-tool invocation and written artifact is recorded automatically
in the active Trace. Keep Source locators on the durable artifact itself; do
not create duplicate telemetry or expose hidden reasoning.

For a Panel-launched run, call `complete_execution_trace` last. Its status is
the explicit run outcome:

- `completed`: every selected task reached a useful result;
- `partial`: useful artifacts exist, but evidence, access, or user input is
  still missing;
- `failed`: no requested result could be completed.

Put the short user-visible result in `summary`, a blocking reason in `error`,
and saved artifact IDs or compact source locators in `output_refs`. This trace
outcome remains Panel-local telemetry; do not duplicate it into
`job-hunt-panel.json`.

## Root snapshot

```json
{
  "schemaVersion": 2,
  "updatedAt": "ISO-8601",
  "selectedJobId": "job-id",
  "selectedInterviewSetId": "set-id",
  "selectedBaseResumeId": "resume-id",
  "discoveryPreferences": {},
  "channelVerifications": [],
  "jdIntakeItems": [],
  "jobLeads": [],
  "discoveryRunReceipts": [],
  "discoveryReceiptCutoff": "ISO-8601 reset boundary or empty string",
  "profile": {},
  "jobs": [],
  "repos": [],
  "experiences": [],
  "jobResearch": [],
  "resume": {},
  "versions": [],
  "questionBank": [],
  "interviewSets": [],
  "mockInterviewSessions": [],
  "preparationPlans": [],
  "interviewDebriefs": [],
  "workflowRuns": []
}
```

When this complete object fits the Host's safe single-file budget,
`job-hunt-panel.json` contains it directly. For a larger project, the root
remains schema-valid but may replace one or more large fields with empty
placeholders and add `artifactStorage`: schema version 2 with a fresh
`g-<32 lowercase hex digits>` generation and an exact list of bounded JSON
shards under `career-data/panel-shards/<generation>/`. The Panel hydrates every
listed shard before exposing context. Every save creates independent files with
create-only writes, then compares and replaces the root last. A losing or
interrupted writer cannot modify another root's data. Legacy storage version 1
(A/B) remains readable, but must never be overwritten by a new writer.

Before replacing a legacy sharded root, the Panel preserves its exact bytes in
`career-data/panel-shards/<new-generation>/previous-root.json`; a failed backup
blocks the save. The original A/B files remain intact. Old Panel versions cannot
read v2 shard indices: recovery to an old Panel requires stopping writers,
backing up the current project, then restoring the legacy root and referenced
shards together. That restores pre-migration data, not later edits. There is no
automatic downgrade or garbage collection; retained and orphaned generations
consume disk space and may still be referenced by another reader or backup.
Never edit, truncate, delete, or invent shard files manually; use
`get_job_search_context` and the Panel write tools. A missing or mismatched shard
is a hard read failure, not an empty question bank.

Root schema-v1 upgrades and requested storage migrations first persist a full
snapshot archive under `career-data/panel-backups/g-<random-id>/`. The final
`manifest.json` records SHA-256, UTF-8 byte length and part count; `part-NNNN.txt`
files contain contiguous original bundle text. Archives retain the exact root
text and every referenced shard, including unknown legacy fields. Completion is
published only after all parts succeed. Missing, altered or incomplete parts,
invalid shard references and project changes prevent reconstruction or migration.
The serialized archive is limited to 128 MiB. This is a structured-snapshot
archive, not a copy of JD originals, photos, external source files or browser
drafts. Do not delete incomplete or historical generations during task execution.
`readSnapshotBackup` validates and reconstructs without changing project files;
there is no automatic restore or downgrade. A recovery-selection/confirmation
interface is still pending.

`discoveryPreferences` stores the current project's last user-confirmed job
search criteria: keyword, location, seniority, count, provider IDs, freshness
window, work mode, exclusions, and last run time. Treat the Panel-submitted
values as the boundary for that discovery run. Do not silently widen a search
to excluded roles, locations, companies, or older listings.

`channelVerifications` stores one current record per provider:

```json
{
  "providerId": "boss",
  "state": "unchecked | checking | ready | login_required | captcha_required | blocked | unavailable",
  "checkedAt": "ISO-8601",
  "sessionId": "opaque-session-id",
  "detail": "Visible, user-readable result"
}
```

Only `ready` authorizes a later website search, and only when `sessionId`
matches the current Session. A different Session makes the record stale even
though `stale` is not persisted as a state. Verification is always one
provider per run. CodeShell may persist that Session's browser partition across
app restarts, but the record must never contain an account, password, cookie,
token, CAPTCHA value, browser storage value, or other credential material.

`jdIntakeItems` is the project-visible JD source inbox. It is distinct from
Session Trace telemetry:

```json
{
  "id": "jd-intake-id",
  "sourceKind": "pasted_text | image | pdf | document | file | project_file | project_scan | chat_export",
  "originalName": "WeChat screenshot.png",
  "sourcePath": "career-data/jd/inbox/...",
  "status": "staged | processing | imported | needs_review | duplicate | failed",
  "summary": "User-visible recognition result",
  "jobIds": ["job-id"],
  "receivedAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "error": ""
}
```

Panel-staged binary files use a text-safe manifest with ordered base64 chunks,
the exact project-local reconstruction path, byte size, and SHA-256. Rebuild
only that path before inspection. Finalize every processed source through
`save_jd_intake_results`; `imported` must reference actual saved job IDs.

`jobLeads` contains listing cards and incomplete JDs that have not passed the
formal gate. `discoveryRunReceipts` is a bounded ledger of scheduled JSON files
already imported from `career-data/discovery/runs/`. Neither collection is a
set of formal jobs, and neither may drive resume, match, research, application,
or interview artifacts. `discoveryReceiptCutoff` prevents receipts created at
or before the most recent project reset from repopulating a deliberately
cleared pool.

## Resume hierarchy

The candidate profile may contain a panel-managed, compressed
`photoDataUrl` and `photoName`. Preserve them when updating candidate facts;
do not synthesize or replace a user-selected photo.

Store the active resume in `resume` and older records in `versions`. Both use
the same shape:

```json
{
  "id": "archived-record-id",
  "versionId": "active-record-id",
  "kind": "base | variant",
  "category": "Frontend engineering",
  "baseResumeId": "base-id-or-empty",
  "jobId": "job-id-or-empty",
  "style": {
    "template": "editorial | minimal | technical",
    "density": "comfortable | compact"
  },
  "pdfExports": [
    {
      "path": "career-data/resumes/resume.pdf",
      "exportedAt": "ISO-8601",
      "size": 12345
    }
  ],
  "title": "Resume title",
  "markdown": "# Complete Markdown resume",
  "claimEvidence": [
    {
      "claim": "Exact text of one Markdown bullet",
      "status": "verified | needs_review",
      "importance": "core | supporting",
      "whyItMatters": "Why a recruiter should care about this point",
      "sources": [
        {
          "kind": "experience | repository | commit | file | user | other",
          "label": "Human-readable source",
          "locator": "commit:abc1234 or file:path#L20",
          "evidence": "What this exact source proves about the claim"
        }
      ],
      "interviewQuestions": [
        {
          "question": "Question that tests ownership, depth, tradeoff, or result",
          "focus": "What the interviewer is trying to verify"
        }
      ],
      "improvement": "Specific evidence or wording improvement, or empty"
    }
  ],
  "candidateQuestions": [
    {
      "id": "resume-qa-id",
      "category": "ownership | scope | impact | decision | collaboration | failure | context",
      "priority": "high | medium | low",
      "question": "One private question that helps the candidate remember a missing fact",
      "why": "Why this answer could materially improve the resume",
      "relatedClaim": "Exact public claim or empty",
      "sourceHints": ["Likely project file, PR, Commit, report, or user confirmation"],
      "status": "open | answered | needs_source | skipped",
      "answer": "Candidate's actual answer or empty",
      "sourceRefs": ["user:resume-qa:<id> or stable source locator"],
      "suggestedChange": "Possible evidence or wording improvement; not auto-applied",
      "answeredAt": "ISO-8601 or empty"
    }
  ],
  "notes": ["Unverified fact to resolve"],
  "updatedAt": "ISO-8601"
}
```

- A base has `kind: "base"`, an explicit broad `category`, and empty
  `baseResumeId` / `jobId`.
- A variant has `kind: "variant"`, inherits its base's `category`, and
  requires valid `baseResumeId` and `jobId`.
- Treat IDs as opaque. Read the resume index with `scope=resumes`, then read the
  selected base with `scope=resume` and its exact `resume_id` before deriving a
  variant.
- `claimEvidence.claim` must match its rendered professional-summary paragraph,
  capability-section line, or Markdown bullet after removing the bullet marker
  and Markdown emphasis. Pure Repo/portfolio URLs and contact metadata remain
  public text but are not evidence claims or interview prompts. Every actual
  claim requires at least one source. A
  `needs_review` source preserves a trace without presenting it as fully
  verified. Matching is stable across punctuation, whitespace, width, and case
  changes, but a substantive wording change needs a new verification pass.
- On Panel tool input, use snake_case names `why_it_matters` and
  `interview_questions`; the snapshot normalizes them to the camelCase shape
  above.
- Mark only 3–6 claims as `core`. Every claim requires a non-empty
  `why_it_matters`, at least one question, and a non-empty `evidence`
  explanation for every source. A stable locator says where to look;
  `evidence` says what the material proves.
- A resume with `needs_review` public claims may be saved as an editable draft,
  but it must not be saved as an application Markdown file or exported to PDF.
  The public name, role, and actionable contact must also be present in both the
  candidate profile and the rendered document header. Placeholder copy such as
  `待补充`, `TBD`, or `TODO` may remain in a private draft but cannot cross the
  publication boundary. Every public claim must be both structurally complete
  and `verified` before publication.
- Save 3–8 private `candidateQuestions` with every generated resume. They are
  internal memory prompts and must never appear in the public Markdown or PDF.
  Preserve exact matches and their real answers across revisions. The active
  version may additionally carry at most four unmatched resolved prompts so
  historical answers cannot crowd out every current gap; the archived prior
  resume version remains the complete historical record. Use
  `save_resume_qa_answer` for one answer at a time, and never treat an
  unanswered or `needs_source` item as a public fact.
- The user may mark a private question `skipped` or reopen it directly in the
  Panel. A skipped item stops blocking the current pipeline but remains in the
  exact resume version for later review.

## Interview system

The interview workspace has four different durable layers. Do not collapse
them into one collection:

1. `questionBank` is the canonical, long-lived knowledge base. One equivalent
   question appears once even when several JDs, generated sets, or Sessions
   reference it.
2. `interviewSets` are disposable, goal-specific practice selections. A set
   references canonical items through `bankQuestionId` and may preserve its
   local question ID for backward-compatible tool calls.
3. `mockInterviewSessions` are practice events: the exact set, questions
   reviewed, deterministic score summary, strengths, improvements, and next
   actions from one completed or abandoned simulation.
4. `interviewDebriefs` are real recruiting events reported by the user. Never
   write a mock session into this collection or advance an application stage
   because a practice session finished.

A canonical bank item uses this normalized shape:

```json
{
  "id": "bank-question-id",
  "fingerprint": "normalized-question-hash",
  "fingerprintAliases": ["historical-hash-before-a-user-rewrite"],
  "question": "One interview question",
  "category": "Architecture",
  "competency": "Trade-off judgment",
  "type": "behavioral | technical | system_design | project_deep_dive | resume_probe | scenario | role_knowledge | other",
  "difficulty": "基础 | 进阶 | 挑战",
  "priority": "high | medium | low",
  "status": "inbox | ready | mastered | archived",
  "origin": "generated | session | manual | real_interview | imported",
  "tags": ["distributed-systems"],
  "sourceRefs": ["commit:abc1234 or public URL"],
  "answerPoints": ["Context", "Decision", "Result"],
  "recommendedAnswer": "Verified-facts-only practice draft",
  "followUps": ["What would you change now?"],
  "notes": "Private candidate notes",
  "jobIds": ["job-id"],
  "sourceSetIds": ["set-id"],
  "practiceAttempts": [
    {
      "id": "practice-attempt-id",
      "answer": "The candidate's raw editable answer",
      "inputMode": "typed | voice | mixed",
      "practiceSessionId": "mock-session-id or empty",
      "interviewSetId": "set-id or empty",
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ],
  "practiceReviews": [],
  "lastPracticedAt": "ISO-8601 or empty",
  "revision": 1,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Questions imported from a Session or external file enter `inbox`. Only actual
questions visible in the supplied Session content may be imported; do not turn
assistant suggestions, user answers, or surrounding discussion into questions.
Use `session:current` as the minimum honest Source for current-Session imports;
add a file, Commit, JD, or URL only when that Source is actually present.
Normalize full-width forms, case, whitespace, punctuation, and symbols before
fingerprinting. On a duplicate, merge Source, tags, job links, set links, and
practice history. Never overwrite a user-curated question, answer, note,
status, or mastery decision with newly generated wording. The user may edit
bank items directly without invoking the Agent. When a direct edit changes the
question fingerprint, preserve the previous value in `fingerprintAliases` so a
later set using the old wording still resolves to the edited canonical item.
Treat a set-local question `id` as local to that set unless `bankQuestionId` is
already present; local IDs reused across sets must never merge unrelated
questions.

Once `bankQuestionId` resolves to a canonical input record, that record is the
only content authority. A stored set shadow may add the set/job reverse link,
but must not restore an older question, competency, tag, Source, answer, or
review that the user removed from the canonical item. Newly generated set
questions without a canonical ID may still enrich a semantic duplicate during
their first upsert.

An `inbox` item can move to `ready` only after it has a clear question, a real
category, the competency it evaluates, and at least one honest Source. New
mock sessions and standalone practice select only `ready` or `mastered`
canonical items. Set references to `inbox` or `archived` items remain useful
for provenance but are omitted from the live practice event.

Questions recorded in a real `interviewDebrief` also enter the canonical bank
as `origin: "real_interview"`, `status: "inbox"`, with a stable
`real-interview:<debrief-id>` Source. This promotion enriches an existing item
with provenance and answer points but must not downgrade a manual rewrite,
mastery decision, notes, or practice history. The debrief remains the durable
record of the real recruiting event; the bank item is only the reusable
practice representation.

Questions extracted from the current Session use `session:current` as their
minimum honest input reference. On write, the Panel replaces that alias with
the active Trace ID, or the bound Session ID when no Trace exists, and inserts
the stable Session reference if the caller omitted it. Other file, Commit, JD,
or public URL references remain supplemental provenance.

Use `sourceMode: "jd | aggregate | mixed"` for a new practice set. JD and mixed
sets require a valid `jobId`; aggregate sets require 2–8 valid `jobIds` and use
an empty `jobId`. Legacy snapshots may still contain `sourceMode: "commits"`;
the Panel keeps those sets readable and practiceable but does not generate new ones. Every generated
question needs a non-empty `competency`, at least one evidence reference, a
non-empty answer structure, a source-backed `recommendedAnswer`, and at least
one non-duplicative follow-up.
Unsupported facts in a recommended answer must remain explicit gaps for the
user to fill. Verified Commit locators may remain supplemental evidence in a
JD-grounded set.

Each canonical question may retain up to 40 raw `practiceAttempts`, saved
directly by the Panel before any optional AI work. The raw answer, input mode,
mock-session relation, and timestamps are authoritative; a review must never
replace or rewrite them. `mockInterviewSessions.answeredQuestionIds` tracks
Panel progress independently from `reviewedQuestionIds`, so a candidate can
complete a mock without invoking the Agent. Historical reviewed IDs migrate
into answered IDs for backward compatibility.

Each canonical question may also retain up to 20 recent optional reviews. A review contains
`answerSummary`, four 0–100 integer `dimensions` (`evidence`, `structure`,
`depth`, and `relevance`), the Panel-computed `overallScore`, concise
`strengths`, prioritized `improvements`, an `optimizedAnswer` limited to
verified candidate facts, a `followUp`, and a timestamp. Use
`save_interview_practice_review`; never save an answer that the candidate did
not actually give, and never score an `inbox` or `archived` item. Pass
`practice_session_id` during a mock, then finish the event with
`save_mock_interview_session` for a direct-chat mock or an explicitly requested
AI summary. A completed or abandoned Panel session may receive a post-hoc
review only for a question with a saved raw attempt; do not add answers or
overwrite Panel progress.

The Panel computes `scoreSummary` from the reviews actually saved with the same
practice Session ID: reviewed-question count, overall arithmetic mean, and the
mean of evidence, structure, depth, and relevance. The Agent must not supply or
estimate these numbers in the final session summary. Completed and abandoned
sessions keep this score snapshot and a bounded `questionCount` even after a
question trims older reviews from its 20-attempt history or an archived
canonical item is eventually evicted.

The snapshot bounds `questionBank` at 600 items and `interviewSets` at 20 sets
of at most 30 questions. On migration, active questions are retained before
archived records, set-local IDs are resolved in the scope of their own set,
and dangling set/session references are removed. Never silently replace an
active canonical item to make room; a new write must ask the user to archive
old material when no archived capacity remains.

## Formal job

Store one normalized record in `jobs` only after the complete JD passes the
Panel gate:

```json
{
  "id": "job-id",
  "company": "Company name",
  "title": "Role title",
  "location": "Location",
  "salary": "Source text",
  "source": "BOSS 直聘",
  "sourceId": "boss",
  "url": "https://canonical-job-url",
  "publishedAt": "Source date or empty",
  "employmentType": "Full-time or source text",
  "description": "Complete source JD text with responsibilities and requirements",
  "jdCompleteness": "full",
  "jdPath": "career-data/jd/jobs/job-id.md",
  "verificationNotes": "Missing fields or access limitation",
  "fetchedAt": "ISO-8601",
  "match": 82,
  "status": "inbox",
  "statusUpdatedAt": "ISO-8601 or empty",
  "application": {
    "nextAction": "Prepare screening call",
    "nextActionAt": "ISO-8601 or YYYY-MM-DD",
    "history": [
      {
        "id": "application-event-id",
        "stage": "applied",
        "previousStage": "tailoring",
        "note": "Submitted through official careers page",
        "nextAction": "Follow up in five working days",
        "nextActionAt": "2026-08-12",
        "occurredAt": "ISO-8601",
        "source": "user | agent | system"
      }
    ]
  },
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Deduplicate by canonical URL first, then
`sourceId + company + title + location`. Save partial candidates through the
same Panel tool, but expect them in `jobLeads`, not `jobs`. Re-submit the same
URL after reading the complete source page so the lead can be promoted without
changing its opaque ID. Never call or count a listing excerpt as a full JD.

Application stages are `inbox`, `saved`, `tailoring`, `applied`, `screening`,
`interviewing`, `offer`, `rejected`, `withdrawn`, or `archived`. Newly
discovered jobs default to `inbox`. That means the listing was collected for
review; it does not mean the user is interested. Move `inbox` to `saved` only
after an explicit user selection. Update later recruiting stages only from an
explicit user action or user-provided recruiting event. Generating a resume
does not prove that an application was submitted, and saving an interview plan
does not prove that an interview was scheduled.

## Job research

Store one current report per `jobId`:

```json
{
  "id": "research-id",
  "jobId": "job-id",
  "updatedAt": "ISO-8601",
  "company": {
    "officialName": "Company name",
    "website": "https://company.example",
    "careersUrl": "https://company.example/careers",
    "summary": "Sourced company summary",
    "industry": "Industry or empty",
    "stage": "Funding/listing stage or empty",
    "size": "Sourced range or empty",
    "locations": ["Shanghai"],
    "products": ["Product A"],
    "techSignals": ["React"],
    "hiringSignals": ["Growing AI product team"]
  },
  "reviews": [
    {
      "source": "Review publisher",
      "title": "Short label",
      "url": "https://public-source",
      "publishedAt": "Source date or empty",
      "sentiment": "positive | mixed | negative | unknown",
      "summary": "Paraphrased subjective account",
      "pros": ["Recurring positive theme"],
      "cons": ["Recurring concern"],
      "confidence": "high | medium | low"
    }
  ],
  "interviewIntel": {
    "summary": "Sourced process summary",
    "process": ["Recruiter screen", "Technical interview"],
    "themes": ["React performance", "Project depth"],
    "questions": [
      {
        "question": "Paraphrased reported or predicted question",
        "category": "Frontend",
        "origin": "reported | predicted",
        "sourceUrl": "https://public-source-or-empty"
      }
    ]
  },
  "risks": ["Fact or concern that needs verification"],
  "sources": [
    {
      "kind": "official | job | review | interview | news | other",
      "title": "Source title",
      "publisher": "Publisher",
      "url": "https://source",
      "publishedAt": "Source date or empty",
      "accessedAt": "ISO-8601",
      "notes": "Scope or limitation"
    }
  ]
}
```

Do not merge multiple anonymous reviews into a claimed company fact. Keep
conflicting themes and low-confidence evidence visible.

## Workflow run

Use one run to expose progress in the panel:

```json
{
  "id": "workflow-id",
  "status": "running | completed | partial | failed",
  "currentStep": "discover | verify-jd | company | reviews | interviews | artifacts",
  "message": "Current progress or limitation",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "steps": [
    {
      "id": "discover",
      "status": "pending | running | completed | skipped | failed",
      "message": "Optional detail"
    }
  ]
}
```

Reuse the returned `workflowId` for later progress updates.

`currentStep` also accepts `resume`, `prepare`, and `debrief`.

## Preparation plan

Store one current plan for each `jobId`, plus at most one general plan with an
empty `jobId`:

```json
{
  "id": "plan-id",
  "jobId": "job-id-or-empty",
  "title": "Preparation plan",
  "summary": "Evidence-grounded summary",
  "strengths": ["Verified strength"],
  "gaps": [
    {
      "area": "Gap area",
      "kind": "profile | evidence | skill",
      "evidence": "What is currently known",
      "impact": "Why it matters",
      "priority": "high | medium | low",
      "actions": ["Concrete next step"],
      "practice": "Practice prompt"
    }
  ],
  "roadmap": [
    {
      "phase": "Stage 1",
      "title": "Learn and apply one real skill gap",
      "kind": "foundation | project | practice | validation",
      "duration": "3 days",
      "objective": "Observable learning objective",
      "tasks": ["Smallest useful task"],
      "deliverable": "Source-backed artifact or practice output",
      "successCriteria": ["Observable completion criterion"],
      "status": "planned | in_progress | done"
    }
  ],
  "resumeChanges": ["Specific revision"],
  "nextActions": [
    {
      "title": "Action",
      "kind": "resume | evidence | study | practice | research",
      "detail": "Scope",
      "priority": "high | medium | low"
    }
  ],
  "updatedAt": "ISO-8601"
}
```

Classify missing personal facts or work-history fields as `profile`, candidate
claims without usable proof as `evidence`, and only genuinely absent capability
as `skill`. `roadmap` must contain stages only for `skill` gaps; pass an empty
array when the plan contains profile or evidence work only.

## Interview debrief

Append one record for every real interview. An empty `jobId` is allowed when
the exact role is not yet saved.

```json
{
  "id": "debrief-id",
  "jobId": "job-id-or-empty",
  "round": "Technical round",
  "interviewedAt": "ISO-8601",
  "outcome": "pending | pass | reject | unknown",
  "summary": "User-grounded debrief",
  "questions": [
    {
      "question": "What was asked",
      "answerSummary": "What the user recalls answering",
      "signal": "strong | mixed | weak | unknown",
      "reportedFeedback": "What the interviewer explicitly said, or empty",
      "analysis": "Agent interpretation kept separate from reported feedback",
      "betterAnswerPoints": ["Improvement point"]
    }
  ],
  "strengths": ["Observed strength"],
  "gaps": ["Observed gap"],
  "nextActions": ["Next action"],
  "createdAt": "ISO-8601"
}
```
