# Job Hunt HQ task modules

Run only the modules requested by the user or selected in the Panel task
composer. A request may target zero, one, or many saved jobs. Reuse the same
candidate evidence across jobs, but write each job-specific artifact with its
own opaque `job_id`.

## Dependency rules

- Discovery can run alone.
- Company intelligence, match analysis, job-specific resume work, question
  sets, and mock interviews require a saved job with enough JD evidence.
- A general resume or preparation plan does not require a job. Omit `job_id`
  when saving it.
- Match analysis and preparation planning share `save_preparation_plan`; when
  both are requested, write one combined plan per job.
- A mock interview should use a saved question set when available. If the user
  requested both generation and simulation, save the set before asking the
  first interactive question.
- A real interview debrief requires user-provided interview facts. After saving
  it, update a preparation plan or resume only when those tasks were also
  selected.

## Discover jobs

1. Resolve target roles, locations, seniority, exclusions, and providers from
   the request, panel context, and one pass over relevant project files.
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

Stop after saving discovery results unless another module was selected.

## Research company and interview intelligence

For every selected job:

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
4. Rank gaps by likely interview or screening impact.
5. Create specific resume changes, evidence-gathering actions, study tasks, and
   practice prompts.
6. Invoke `save_preparation_plan`. Use one combined plan when both match and
   preparation tasks were selected.

## Tailor or revise a resume

For every selected job, or once without a job for a general baseline:

1. Read the current resume and all verified candidate evidence.
2. For a job-specific version, extract 6–10 high-signal JD requirements and
   map them to true evidence. For a general version, optimize structure,
   clarity, evidence strength, and the candidate's stated target direction.
3. Write concise Markdown in the requested language. Prefer outcome-led bullets
   and natural keyword coverage.
4. Invoke `save_resume_draft`. Put uncertain or missing facts in `notes`
   instead of filling them in. Omit `job_id` for a general version.

Default section order:

1. Name, target role, contact
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
   and realistic follow-ups.
4. Invoke `save_interview_question_set`.

## Run a mock interview

1. Read the selected job and saved question set.
2. Ask one question at a time and withhold answer points until the user
   answers.
3. Give brief feedback on evidence, clarity, technical depth, and job
   relevance, then ask one follow-up or continue.
4. Never turn an unsupported answer into a candidate fact.
5. End with strengths, risks, and the next practice focus. Save another
   artifact only if the user selected it.

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
5. If preparation or resume iteration was also selected, use the debrief as new
   evidence and update only the corresponding artifacts.

## Long combinations

Use `save_workflow_progress` for multi-job or multi-stage work. Planned steps
may include discovery, JD verification, company research, reviews, interviews,
resume, preparation, debrief, and final artifacts. Save useful partial writes
early, reuse the returned `workflowId`, and finish with `completed`, `partial`,
or `failed`.
