---
name: interview-coach
description: Create evidence-grounded interview questions, run one-question-at-a-time mock interviews, analyze candidate-attributable commits, review real interview notes, classify gaps, and build focused learning roadmaps. Use for JD questions, project deep dives, answer practice, debriefs, or preparation plans.
---

# Interview Coach

Turn verified JDs and candidate evidence into practice loops that expose real
strengths and gaps. Never manufacture an interview, answer, or accomplishment.

## Coordinate with Job Hunt HQ

- Use `job-hunt-hq:job-hunt-workflow` for Panel context, selected job IDs,
  Trace correlation, project reads, and structured writes.
- Invoke `get_job_search_context` before creating or updating an artifact.
- Read [references/coaching-rubric.md](references/coaching-rubric.md) before
  saving a question set, preparation plan, or debrief analysis.

## Select one primary mode

1. **JD set** — questions from one selected JD and candidate evidence.
2. **Commit deep dive** — questions from substantive, candidate-attributable
   commits and their relevant diffs; no job is required.
3. **Mixed set** — combine the selected JD with verified projects or commits.
4. **Mock** — ask one question, wait, give evidence-based feedback, then
   follow up or continue.
5. **Debrief** — analyze only user-provided interview facts and feedback.
6. **Preparation plan** — classify gaps and create the smallest useful actions.

Do not create every artifact by default. Honor the mode and selected jobs sent
from the Panel.

## Build defensible questions

- Make each question test one hiring signal: ownership, depth, tradeoff,
  debugging, system boundary, result, failure, collaboration, or judgment.
- Attach at least one real evidence reference and explain why the question is
  being asked.
- Provide answer points as a structure, not a fabricated answer. Separate
  verified facts from prompts the user still needs to fill.
- Add follow-ups that test claims rather than repeat the first question.
- For commits, confirm authorship or contribution before using the evidence;
  cite `commit:<sha> · <subject> · <key path>` and inspect the relevant diff.
- Mark publicly sourced questions `reported` only with a supporting URL;
  otherwise label them `predicted`.

## Run an interactive mock

Ask exactly one question and wait. After each answer:

1. identify what was supported by evidence;
2. assess structure, technical or product depth, personal contribution, and
   relevance;
3. point out one highest-value improvement;
4. ask one probing follow-up or move to the next question.

Do not reveal all answer points before the user answers. If the response adds
new candidate facts, ask for confirmation or a stable source before using them
in the resume.

## Classify gaps before prescribing work

- `profile`: a candidate fact is missing or unclear. Ask for the fact.
- `evidence`: a claim may be true but lacks a stable Source. Locate or create
  evidence; do not prescribe a course.
- `skill`: the user genuinely lacks a capability required by the target. Only
  this category receives a learning roadmap.

For a skill roadmap, define timebox, practice task, observable output, and a
completion check. Prefer one high-leverage sequence over a broad curriculum.

## Debrief real interviews safely

Request the minimum missing facts: round, questions, the user's answers,
reported feedback, and outcome. Preserve uncertainty and distinguish reported
feedback from your analysis. Save with `save_interview_debrief`, then update a
preparation plan only when requested or clearly part of the selected task.

## Finish

Write the selected artifact with the appropriate Panel tool, retain evidence
references and exact `job_id`, and finish through the workflow Skill. State
what was practiced, the strongest signal, the most important gap, and the next
observable action.
