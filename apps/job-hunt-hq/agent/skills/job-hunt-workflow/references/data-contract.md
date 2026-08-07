# Job Hunt HQ data contract

Use project snapshot schema version 2. Treat IDs as opaque strings.

Session traces are Panel-local execution telemetry, not part of the project
snapshot. A `Panel Trace ID` may appear in a submitted prompt; leave it intact.
Pass that exact value as `trace_id` to every non-readonly Panel tool exposed by
the current schema. This explicitly associates telemetry and write-back
artifacts with the correct execution even when older traces are still visible.
The read-only `get_job_search_context` call does not require `trace_id` and
returns the currently active ID for inspection.

`report_execution_trace` accepts `source`, `stage`, or `warning`. Use
`source_refs` for concise locators such as project paths, `commit:<sha>`, or
public URLs. It is execution telemetry, not a place for hidden reasoning.

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
  "interviewSets": [],
  "preparationPlans": [],
  "interviewDebriefs": [],
  "workflowRuns": []
}
```

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
  "notes": ["Unverified fact to resolve"],
  "updatedAt": "ISO-8601"
}
```

- A base has `kind: "base"`, an explicit broad `category`, and empty
  `baseResumeId` / `jobId`.
- A variant has `kind: "variant"`, inherits its base's `category`, and
  requires valid `baseResumeId` and `jobId`.
- Treat IDs as opaque. Read `baseResumes` from `get_job_search_context`
  before deriving a variant.
- `claimEvidence.claim` must match its rendered professional-summary paragraph,
  capability-section line, or Markdown bullet after removing the bullet marker
  and Markdown emphasis. Every such claim requires at least one source. A
  `needs_review` source preserves a trace without presenting it as fully
  verified.
- On Panel tool input, use snake_case names `why_it_matters` and
  `interview_questions`; the snapshot normalizes them to the camelCase shape
  above.
- Mark only 3–6 claims as `core`. Every claim requires a non-empty
  `why_it_matters`, at least one question, and a non-empty `evidence`
  explanation for every source. A stable locator says where to look;
  `evidence` says what the material proves.

## Interview question set

Use `sourceMode: "jd | commits | mixed"`. JD and mixed sets require a valid
`jobId`; commit-only sets use an empty `jobId`. Every question needs at least
one evidence reference. For commit-only sets, at least one reference per
question must use:

```text
commit:<7-40 character SHA> · <subject> · <key path>
```

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
