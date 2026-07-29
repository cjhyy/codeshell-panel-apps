---
name: job-tailor
description: Use the active CodeShell project's CODESHELL.md and verified files with Job Hunt HQ to collect public JDs, tailor honest resumes, and generate evidence-grounded interview preparation.
---

# Job Tailor

Use this skill whenever the user asks to search for jobs, analyze a JD, tailor a
resume, improve a resume, generate interview questions, or run a mock interview
from the Job Hunt HQ panel.

## Workflow

1. Work only inside the active CodeShell project. Read its root
   `CODESHELL.md` first, then inspect the project files that contain candidate
   facts, work history, project evidence, or job-search rules.
2. Call `get_job_search_context` before writing or revising a resume. Treat its
   panel data as a visualization cache; the active project's verified files are
   the source of truth.
3. When the project files provide updated candidate facts, call
   `save_candidate_context` so the panel can visualize the extracted profile,
   project evidence, and work history.
4. Treat the selected JD as the target. If no job is selected, ask the user to
   select or add one before drafting.
5. Use only evidence present in the active project's verified files. Never
   invent employers, dates, metrics, ownership, technologies, or outcomes.
6. Extract 6–10 high-signal requirements from the JD. Map each requirement to
   explicit evidence and note genuine gaps.
7. Write concise Chinese Markdown unless the JD or user requests another
   language. Prefer outcome-led bullets and natural keyword coverage over
   keyword stuffing.
8. Call `save_resume_draft` with the selected `job_id`, a clear title, the full
   Markdown draft, and short notes for gaps or facts the user should verify.
9. Tell the user what was emphasized, what was omitted for lack of evidence, and
   which two additions would most improve the draft.

## Interview preparation

When asked to generate a question set:

1. Re-read the active project's `CODESHELL.md`, call
   `get_job_search_context`, and use the exact selected `job_id`.
2. Cross-reference the full JD with verified project files, extracted project
   evidence, work history, profile, and current resume. Do not turn an inferred
   skill into a claimed fact.
3. Unless the user selects a narrower mode, cover technical foundations, project
   depth, system design, behavioral evidence, and genuine capability gaps.
4. Every question must include:
   - a concise category and difficulty;
   - why the interviewer is likely to ask it;
   - explicit evidence references from the JD or candidate materials;
   - three-to-five answer points grounded in known facts;
   - one or more realistic follow-up questions.
5. Use gap questions to prepare an honest boundary and learning plan. Never
   invent a project, responsibility, technology, employer, metric, or result to
   make the answer look stronger.
6. Call `save_interview_question_set` with the selected job, requested mode,
   complete question set, and all evidence fields.

For an interactive mock interview:

- Re-read `CODESHELL.md`, then read the saved question set from
  `get_job_search_context`.
- Ask one question at a time and withhold answer points until the user responds.
- After each answer, give brief feedback on evidence, clarity, technical depth,
  and relevance, then ask one follow-up or continue.
- Flag claims that are not supported by panel evidence so the user can verify
  them instead of silently treating them as true.
- End with strengths, risks, and a short next-practice plan.

## Public job search

When asked to collect roles from one or more recruiting sites:

- Read the active project's `CODESHELL.md` and relevant candidate files first.
  If extracted candidate context changed, call `save_candidate_context`.
- Read `providerCatalog` from `get_job_search_context`, then honor the exact
  provider IDs selected by the user. The initial catalog covers BOSS 直聘,
  LinkedIn, 拉勾, 猎聘, 脉脉, 前程无忧, 智联招聘, and company career pages.
- Search each selected provider separately with available browser/search tools
  and inspect only current public listings.
- Do not bypass authentication, CAPTCHA, rate limits, robots restrictions, or
  other access controls. Skip a blocked provider and report the reason.
- Normalize every result to the same fields: company, title, location, salary,
  source, source_id, URL, published_at, employment_type, full available JD text,
  and an evidence-based preliminary match score.
- Deduplicate by normalized canonical URL first. When no canonical URL exists,
  use source_id + company + title + location. Preserve the original source and
  URL for user verification.
- Prefer a small set of relevant, current roles over a large noisy scrape.
- Call `save_job_opportunities` to return the structured results to the panel.
- Clearly mark incomplete or inferred fields, summarize per-provider coverage,
  and ask the user to verify each original listing before applying.

## Draft format

Use this order unless the user asks otherwise:

1. Name, target role, and contact line
2. Two-to-three sentence professional summary
3. Core skills aligned to the JD
4. Work experience in reverse chronological order
5. Selected projects / repositories
6. Education or other sections only when source evidence exists

Keep the first draft practical and editable. A rough, honest draft is better
than polished fiction.
