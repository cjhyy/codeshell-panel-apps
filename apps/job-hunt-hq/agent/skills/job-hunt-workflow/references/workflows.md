# Job Hunt HQ workflows

Select the smallest mode that satisfies the user's request. Combine modes only
when the user asks for a complete flow.

## Quick discovery

Use this for "看看有什么岗位", "从 BOSS 拉几个 JD", and similar requests.

1. Resolve target roles, locations, seniority, exclusions, and providers from
   the user message, panel context, and a single pass over relevant project
   files.
2. Browse the requested provider as the user sees it. Prefer public listing
   pages, official careers pages, and public structured ATS pages. Never export
   browser credentials or replay authenticated requests outside the browser.
3. Verify that each retained listing appears current. Save the first useful
   batch without waiting for every detail:
   - `listing_only`: title/company/URL and visible listing metadata
   - `partial`: a real excerpt or incomplete JD
   - `full`: the complete visible JD
4. Invoke `save_job_opportunities` with 3–8 relevant records. Later calls
   should enrich matching records instead of creating duplicates.
5. Estimate match only when candidate evidence exists. Otherwise omit it.
6. Try to enrich the strongest records to `full`. If access is blocked, keep
   the partial records and describe the limitation once.

Stop after saved discovery results unless the user requested another artifact.

## Research a job and company

1. Resolve the exact saved `job_id` from `get_job_search_context`.
2. Inspect the official company site, careers site, product pages, and reliable
   current public sources.
3. Search public employee or candidate reviews and interview reports.
4. Summarize recurring themes and visible disagreement. Anonymous anecdotes
   remain subjective evidence.
5. Distinguish reported interview questions from questions predicted from the
   JD.
6. Invoke `save_job_research` once for the job with a deduplicated source list,
   risks, confidence, and gaps.

## Tailor or revise a resume

1. Require a selected saved job and read its complete JD.
2. Extract 6–10 high-signal requirements.
3. Map each requirement to explicit project or work-history evidence and note
   genuine gaps.
4. Write concise Markdown in the user's requested language. Prefer
   outcome-led bullets and natural keyword coverage.
5. Invoke `save_resume_draft`. Put uncertain or missing facts in `notes`
   instead of filling them in.

Use this default order unless the user asks otherwise:

1. Name, target role, contact
2. Professional summary
3. Skills aligned with the JD
4. Reverse-chronological work experience
5. Selected projects or repositories
6. Education or other sections only when verified

## Prepare interview questions

1. Cross-reference the complete JD, current resume, verified repositories, work
   history, and saved company research.
2. Cover technical foundations, project depth, system design, behavioral
   evidence, and material gaps unless a narrower mode was requested.
3. Give every generated question a reason, evidence references, grounded answer
   points, and realistic follow-ups.
4. Invoke `save_interview_question_set`.

For a mock interview, read the saved set, ask one question at a time, withhold
answer points until the user answers, then give brief evidence, clarity,
technical-depth, and relevance feedback.

## Complete workflow

1. Invoke `save_workflow_progress` with `running` and planned steps.
2. Discover and verify roles; save them.
3. Research each retained company and job; save each report.
4. Generate requested resume and interview artifacts for the strongest or
   user-selected roles.
5. Reuse the returned `workflowId` as `workflow_id` for progress updates.
6. Finish with `completed`, `partial`, or `failed`. Use `partial` whenever
   important providers were blocked or evidence remains too weak.

Do not select a "representative" subset before reading target and candidate
context. Prefer a small ranked set with a short, evidence-based reason.
