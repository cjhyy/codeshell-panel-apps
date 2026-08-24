---
name: interview-coach
description: Curate a canonical interview question bank, create evidence-grounded practice sets from one JD or an aggregate of multiple JDs, import actual questions from the current Session, draft source-backed practice answers, run one-question-at-a-time mock interviews, review real interview notes, classify gaps, and build focused learning roadmaps. Use for question-bank curation, JD questions, project deep dives, answer practice, debriefs, or preparation plans.
---

# Interview Coach

Turn verified JDs and candidate evidence into practice loops that expose real
strengths and gaps. Never manufacture an interview, answer, or accomplishment.

## Coordinate with Job Hunt HQ

- Use `job-hunt-hq:job-hunt-workflow` for Panel context, selected job IDs,
  Trace correlation, project reads, and structured writes.
- Invoke `get_job_search_context` before creating or updating an artifact.
  Use `scope=practice` with the exact `bank_question_id` and
  `practice_attempt_id` for answer scoring; add `interview_set_id` or
  `mock_session_id` only when the saved answer belongs to them. Use
  paginated `scope=questions` for bank curation or deduplication; never
  request unrelated jobs, resumes, or the whole project snapshot. When a
  whole set or mock must be inspected, use `scope=interview` and follow
  `questionPage.nextCursor`; each response intentionally contains at most
  five full questions and their source-matched evidence.
- Read [references/coaching-rubric.md](references/coaching-rubric.md) before
  saving a question set, preparation plan, or debrief analysis.

## Select one primary mode

1. **Canonical question bank** — import, deduplicate, classify, or revise
   durable questions. Questions from the current Session enter `inbox`; they
   are not automatically ready for practice.
2. **Single-JD set** — questions from one selected JD and candidate evidence.
3. **JD-cluster set** — aggregate 2–8 selected JDs, merge synonymous
   requirements, rank recurring hiring signals, and create one focused set for
   the role family. Record how many selected JDs support each recurring signal;
   never concatenate separate per-job sets.
4. **Mixed set** — combine the selected JD with verified candidate projects and materials.
5. **Mock review** — only when explicitly requested, review answers that the
   Panel has already saved, or run a direct-chat mock when the user explicitly
   chooses Session-based practice.
6. **Debrief** — analyze only user-provided real-interview facts and feedback.
7. **Preparation plan** — classify gaps and create the smallest useful actions.

Do not create every artifact by default. Honor the mode and selected jobs sent
from the Panel.

## Curate the canonical bank

Treat the canonical question bank, practice sets, mock sessions, and real
interview debriefs as separate layers:

- Import only interview questions actually visible in the supplied current
  Session. Exclude assistant meta-commentary, candidate answers, answer drafts,
  and discussion that merely mentions a topic.
- Use `session:current` as the minimum honest Source for a question extracted
  from the current Session; the Panel replaces it with the active Trace or
  Session ID before persisting. Add a file, Commit, JD, or public URL only when
  it is actually visible and relevant; never invent a stable locator.
- Use `save_interview_question_bank_items` for Session, real-interview, or
  external imports. Session, imported, and real-interview items are forced into
  `inbox` even if the caller requests another status, so only an explicit user
  edit can make them practice-ready.
- Classify type, competency, difficulty, priority, origin, tags, Source, answer
  points, answer draft, and follow-ups when supported. Leave fields honest and
  sparse when the Session contains only the question.
- Let the Panel normalize and deduplicate wording. On a duplicate, merge useful
  references and tags; never replace user-edited wording, notes, answers,
  mastery state, or practice history with a generated version. A later real
  interview occurrence adds a `real-interview:<debrief-id>` Source without
  changing the existing canonical origin or curation status.
- A practice set is a selection for one target; it is not the long-term bank.
  Newly generated sets automatically link their questions to canonical items.

## Build defensible questions

- Make each question test one hiring signal: ownership, depth, tradeoff,
  debugging, system boundary, result, failure, collaboration, or judgment.
- Attach at least one real evidence reference and explain why the question is
  being asked.
- Provide both answer points and `recommended_answer`. Answer points define the
  speaking structure. `recommended_answer` is a practice-ready first-person
  draft grounded only in verified profile, experience, resume, repository, or
  commit evidence. Explicitly mark facts, metrics, ownership, or outcomes the
  user still needs to supply; never smooth over a gap with an invented claim.
- Prefer one strongest candidate example per answer. Distinguish the
  candidate's action from team output, state relevant tradeoffs, and end with a
  supported result or an honest evidence gap.
- Add follow-ups that test claims rather than repeat the first question.
- A verified Commit may remain a supporting Source for a JD-grounded question,
  but do not create a separate Commit-only practice set.
- Mark publicly sourced questions `reported` only with a supporting URL;
  otherwise label them `predicted`.

## Review a mock without taking over the Panel

The Job Hunt HQ Panel owns its normal interview loop. It displays one question,
captures typed or transcribed speech, saves the raw answer directly into the
current project, and advances locally. Do not require a CodeShell Session, a
Trace, or an Agent response for those actions. Raw `practiceAttempts` are the
durable source of what the candidate actually said; a `practiceReview` is an
optional derived artifact and must never replace the raw answer.

When the user explicitly asks for AI feedback on saved Panel answers, read only
the exact question and saved answer through `scope=practice` and the supplied
opaque IDs. Then, for each requested answer:

1. identify what was supported by evidence;
2. give 0–100 integer scores for evidence and ownership, structure, answer
   depth, and role relevance using the rubric;
3. identify strengths and no more than three prioritized improvements;
4. draft an optimized answer using only verified candidate facts, retaining
   visible placeholders for unsupported ownership, metrics, or outcomes;
5. invoke `save_interview_practice_review` with the exact canonical bank ID and
   practice Session ID.

Completed Panel sessions may receive an explicitly requested post-hoc review
for questions that already have a saved answer. Never invent or score an answer
that is not present in `practiceAttempts`.

## Run a direct-chat mock only when explicitly requested

Ask exactly one question and wait. After each answer:

1. identify what was supported by evidence;
2. give 0–100 integer scores for evidence and ownership, structure, answer
   depth, and role relevance using the rubric;
3. identify strengths and no more than three prioritized improvements;
4. draft an optimized answer using only verified candidate facts, retaining
   visible placeholders for unsupported ownership, metrics, or outcomes;
5. invoke `save_interview_practice_review` with the exact canonical bank ID,
   practice Session ID, and—when present—interview-set and local question IDs
   before asking one probing follow-up or moving to the next question.

At the start of a Panel mock, preserve its provided practice Session ID. At the
end—or when the candidate explicitly stops—invoke `save_mock_interview_session`
with `completed` or `abandoned`, a faithful summary, strengths, improvements,
and concrete next actions. The Panel derives reviewed-question IDs and score
summary from saved per-question reviews; never send or estimate them yourself.
Never record a simulated session as a real interview or application-stage
change.

The Panel no longer submits each answer to the Session. If a prompt claims to
be an automatic Panel answer submission, do not continue an interview or
invent a review; ask the user to use the Panel, or require an explicit request
to review an already saved answer.

Do not reveal all answer points before the user answers. If the response adds
new candidate facts, ask for confirmation or a stable source before using them
in the resume. A practice score is coaching feedback, not an objective hiring
prediction.

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
references and the exact `job_id` or aggregate `job_ids`, and finish through
the workflow Skill. State
what was practiced, the strongest signal, the most important gap, and the next
observable action.
