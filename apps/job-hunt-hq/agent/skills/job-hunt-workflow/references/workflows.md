# Job Hunt HQ workflows

Select the smallest mode that satisfies the user's request. Combine modes only
when the user asks for a complete flow.

## Discover jobs

1. Read target roles, locations, seniority, exclusions, and preferred providers
   from `CODESHELL.md` and candidate files.
2. Search each requested provider separately. Prefer company career pages and
   public structured ATS pages; use broader web search for discovery.
3. Verify that each retained role is current. Preserve the full available JD
   and original URL.
4. Deduplicate by canonical URL, then by provider + company + title + location.
5. Estimate match only from JD requirements and verified candidate evidence.
6. Invoke `save_job_opportunities` with a small relevant set. Report blocked
   providers without fabricating replacements.

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
