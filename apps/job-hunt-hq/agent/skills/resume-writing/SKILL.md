---
name: resume-writing
description: Write, restructure, review, or tailor focused source-backed resumes and CVs for technical and product roles. Use whenever the user asks for a Base Resume, JD-specific resume, resume rewrite, stronger summary or bullets, ATS review, emphasis audit, evidence-backed claim selection, or an explanation of why a resume lacks focus.
---

# Resume Writing

Turn verified candidate evidence into a resume with a clear hiring thesis. Make
the strongest relevant proof visible in the first scan, remove low-signal
material, and keep every public claim defensible in an interview.

## Coordinate with Job Hunt HQ

- Use `job-hunt-hq:job-hunt-workflow` for Panel context, Trace correlation,
  project reads, and structured writes. Use this Skill for editorial judgment.
- Invoke `get_job_search_context` before drafting when the Job Hunt HQ tools are
  available. Read the applicable Base Resume, candidate sources, and JD only
  when the requested mode needs them.
- Build or repair a direction-level Base Resume before deriving a JD Variant.
  Do not make a base resume generic; give it one broad category and one clear
  candidate thesis.
- Read [references/focus-rubric.md](references/focus-rubric.md) before the final
  draft or review.

## Resolve the requested mode

Choose exactly one primary mode:

1. **Base** — establish the durable candidate story for one broad role family.
2. **Variant** — re-rank a saved Base Resume for one verified JD without
   changing facts or chronology.
3. **Revision** — preserve the current layer and fix a stated weakness.
4. **Audit** — diagnose focus, evidence, relevance, scanability, and credibility
   before proposing changes.

Do not require a JD for Base, Revision, or Audit. Do not produce a Variant
without a saved base and target job.

## Build the focus brief

Before writing, resolve these editorial decisions from verified sources:

- target category and plausible level;
- one-sentence hiring thesis: role identity + domain/scope + differentiating
  contribution + strongest proof;
- three primary signals the reader must remember;
- evidence that proves each signal;
- important facts to keep as support;
- weak, duplicated, irrelevant, or unsupported material to omit;
- facts that require the user's confirmation.

If the thesis or three signals cannot be supported, stop short of a polished
resume. Save only verified content, mark the run partial, and request the
smallest missing facts. Never fill the gap with adjectives, inflated seniority,
JD wording, or invented metrics.

## Select evidence by signal strength

Classify candidate facts before drafting:

- **Hero** — relevant, attributable, specific proof of ownership, technical or
  product judgment, and a meaningful outcome. Promote only 3–6 claims.
- **Support** — credible context that strengthens a hero signal without
  competing with it.
- **Needs review** — potentially valuable, but authorship, scope, result, date,
  or source is incomplete. Keep it out of the public resume or soften it.
- **Omit** — generic responsibility, repeated technology list, stale or
  irrelevant detail, unverifiable claim, or low-value implementation trivia.

Treat a repository as project context, not proof of personal contribution.
Inspect candidate-attributable commits or user-confirmed work before promoting
repo facts. Treat a JD only as employer demand, never as candidate evidence.

## Design the first scan

Make the top third answer four questions without scrolling:

1. What role family is this candidate credible for?
2. What difficult class of problem have they handled?
3. What did they personally change or decide?
4. Which result or concrete proof makes that believable?

Use this default hierarchy, adapting it when verified evidence warrants:

1. Name, contact, target headline, and optional user-provided photo
2. Two or three concise professional-summary statements
3. A short evidence-backed capability line or key-signal group
4. Reverse-chronological relevant experience
5. Selected projects only when they add distinct proof
6. Education, certifications, or other verified supporting sections

Do not repeat the same achievement in the summary, highlights, experience, and
projects. Mention it once prominently and add only genuinely new detail later.
Do not use a long skills inventory as the main value proposition.

## Write outcome-led bullets

Give each bullet one primary hiring signal. Prefer this sequence:

`problem or scope → candidate action/decision → mechanism or tradeoff → verified impact`

- Lead with the differentiating action or result, not “responsible for,”
  “participated in,” or a technology name.
- Show personal boundaries: what the candidate decided, built, changed,
  diagnosed, coordinated, or recovered.
- Name technologies only where they explain how the result was achieved.
- Use a metric only when its source supports the number and comparison basis.
- When no metric exists, use verified non-numeric impact: shipped capability,
  reliability behavior, risk removed, workflow enabled, constraint handled,
  decision adopted, or observable quality improvement.
- Keep one idea per bullet. Split a compound claim or remove its weaker half.
- Prefer precise plain language over action-verb decoration.

## Tailor without rewriting history

For a JD Variant:

1. Extract 6–10 explicit hiring signals from the complete JD.
2. Map each signal to strong candidate proof, adjacent proof, evidence gap, or
   real skill gap.
3. Promote the strongest truthful matches into the first scan.
4. Reorder and tighten Base Resume material; change terminology only where the
   candidate's source supports the equivalent concept.
5. Preserve unsupported JD requirements as gaps, never resume claims.

Tailoring changes emphasis, not identity. A Variant should remain recognizably
derived from its Base Resume.

## Attach evidence and interview defenses

For the professional summary, every capability line, and every experience or
project bullet:

- copy the exact public text into `claim_evidence[].claim`;
- mark only the 3–6 hero claims as `importance: "core"`;
- explain the hiring signal in `why_it_matters`;
- attach stable source locators and state what each source actually proves;
- use `needs_review` when attribution or result is incomplete;
- add 1–4 questions that test ownership, depth, tradeoff, outcome, or failure;
- put a concrete evidence or wording fix in `improvement` when weak.

If a claim cannot survive a five-minute interview deep dive, do not present it
as a core strength.

## Run the focus gate

Score the draft with the bundled rubric. Revise before saving when any blocker
is present or the score is below 80/100.

Require all of the following:

- one clear hiring thesis;
- exactly 3–6 core claims, with the strongest visible early;
- no unsupported public claim;
- no repeated section that competes with the primary story;
- no fabricated number or JD echo;
- every core point has a concrete Source explanation and interview defense;
- the resume remains readable when internal evidence annotations are hidden.

Do not raise the score by inventing data. Report the missing proof as the next
improvement instead.

## Write back through the Panel

When Job Hunt HQ is active, invoke `save_resume_draft` with the complete public
Markdown, complete `claim_evidence`, unresolved `notes`, and the correct resume
hierarchy fields. Preserve the Panel Trace ID on the write and finish the Trace
through the workflow Skill.

For an Audit without requested revision, explain the hiring thesis currently
visible, the three strongest signals, the competing noise, unsupported claims,
and the smallest high-value rewrite. Do not silently replace the resume.
