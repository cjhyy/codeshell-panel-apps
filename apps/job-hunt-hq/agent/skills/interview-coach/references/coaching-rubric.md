# Interview coaching rubric

## Canonical-bank curation gate

Keep one normalized item per equivalent question. Normalize full-width forms,
case, whitespace, punctuation, and symbols for matching, but retain the user's
preferred display wording. Merge Source, tags, job links, practice-set links,
and review history. A newly generated item must never overwrite user-curated
wording, notes, answer content, status, or mastery state.

Questions copied from a Session start as `inbox`. Promote one to `ready` only
after it is a genuine interview question, readable without the old transcript,
classified by type and competency, and either linked to a real Source or
clearly marked as a standalone reported/manual question. Archive noise and
duplicates instead of silently converting them into practice material.
Single-question practice and a new mock session may select only `ready` or
`mastered` canonical items. Never ask an `inbox` or `archived` item merely
because an older practice set still references it.

Use these boundaries consistently:

- the canonical bank is durable knowledge;
- a practice set is a temporary selection for a JD, JD cluster, commit set, or
  mixed target;
- a mock session is one Panel practice event whose raw answers are durable even
  when no AI score is requested;
- a debrief records a real interview and must never be synthesized from a mock.

## Question-set gate

Every saved question must name the competency or hiring signal it evaluates,
have a real evidence reference, a concise reason, a usable answer structure, a source-backed
`recommended_answer`, and at least one non-duplicative follow-up. Reject generic
trivia that the JD and candidate evidence do not justify. A recommended answer
must use only verified candidate facts and visibly leave unsupported metrics or
ownership as gaps for the user to fill.

Balance a normal set across role fundamentals, candidate project depth,
decision tradeoffs, and the most material gaps. Difficulty should come from
depth and ambiguity, not obscure facts.

For a JD-cluster set, require 2–8 exact job IDs. Merge synonymous requirements,
rank signals by recurrence across the selected JDs, and make the set primarily
test the role family's shared signals. Preserve a count or equivalent reference
showing how many selected JDs support a recurring signal. Reject a simple
concatenation of separate single-JD question sets.

## Optional mock feedback loop

Panel practice itself does not invoke the Agent. Score only raw answers already
saved in `practiceAttempts` when the user explicitly asks for review, or answers
given during an explicitly requested direct-chat mock. Never make scoring a
precondition for saving an answer or advancing to the next Panel question.

After each answer, assign four 0–100 integer scores:

- **Evidence and ownership**: factual support, attribution of personal action,
  and no unsupported metric or outcome.
- **Structure**: direct opening, coherent context-action-result or equivalent
  sequence, concision, and an explicit close.
- **Depth**: reasoning, decisions, tradeoffs, failure handling, validation, and
  role-appropriate technical, product, or operational detail.
- **Role relevance**: direct coverage of the hiring signal in the selected JD
  or recurring signal in the selected JD cluster.

Compute the displayed overall score as the rounded arithmetic mean. Interpret
85–100 as strong, 70–84 as usable with focused improvement, 55–69 as needing a
substantial rebuild, and below 55 as weak or unsupported. These bands are
coaching guidance, not a hiring probability.

Return concise strengths and at most three improvements ordered by expected
interview impact. The optimized answer must preserve the candidate's actual
meaning and use only verified facts; unsupported ownership, metrics, or results
remain visible gaps rather than polished inventions. Save each completed review
with `save_interview_practice_review` before continuing.

Pass the active practice Session ID on every review. For a direct-chat mock,
finalize the session with `save_mock_interview_session`, including a faithful
summary, no more than three cross-question improvements, and observable next
actions. Do not send reviewed question IDs or score totals in the final call:
the Panel derives both from the per-question reviews already saved under that
practice Session ID. A completed Panel session may receive post-hoc reviews for
its already saved answers without changing its answer progress.

Ask one question at a time. Never write a fictional ideal answer using facts
the user has not supplied.

## Gap and roadmap gate

Classify every gap as `profile`, `evidence`, or `skill`. Only `skill` gaps may
become learning milestones. Every milestone needs a timebox, a concrete
practice task, an observable artifact, and a completion check linked to the
target role.

## Debrief gate

Keep user-reported questions, answers, feedback, and outcome separate from
analysis. Do not save a real debrief until at least the round and some actual
interview content are known. Preserve uncertainty rather than reconstructing
missing events.
