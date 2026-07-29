---
name: job-hunt-workflow
description: Operate the project-bound Job Hunt HQ panel from the current CodeShell session. Use whenever the user asks to find, select, or compare jobs; collect or verify JDs; research companies, reviews, or interview reports; analyze JD fit; tailor or revise a general or job-specific resume; create a preparation plan or interview questions; run a mock interview; save a real interview debrief; iterate materials from interview feedback; update application progress; or execute any user-selected combination of these tasks.
---

# Job Hunt Workflow

Keep the conversation in the current CodeShell session. Do not create a second
chat surface or ask the user to open another repository. The enabled Panel App,
its tools, and this Skill are one project-scoped product.

## Resolve jobs and tasks independently

Treat the request as two independent selections:

1. **Target jobs**: zero, one, or many saved `job_id` values. Zero means a
   general candidate artifact such as a baseline resume or preparation plan.
2. **Requested tasks**: any combination of discovery, JD verification, match
   analysis, company/interview intelligence, resume revision, question sets,
   preparation planning, mock interviewing, debriefing, or progress updates.

The Panel task composer may pass explicit jobs and tasks. Treat those as the
execution boundary. In ordinary chat, infer the smallest useful combination
from the user's words. Never add research, resumes, questions, or mock
interviews merely because another task was requested. Presets are shortcuts,
not fixed workflows.

Read [references/workflows.md](references/workflows.md) for the selected task
modules and their dependencies.
Read [references/data-contract.md](references/data-contract.md) only before a
structured write whose fields are not already clear from the Panel tool schema.

## Start with project context

1. Use `Panel` with `action: "tools"` and
   `panel_id: "panel-app:job-hunt-hq"` as the first useful tool call unless the
   current tool contract is already visible.
2. Invoke `get_job_search_context` before browsing or drafting.
3. Check once for the active project's root `CODESHELL.md`. If present, follow
   it and read only the candidate files it identifies. Its absence is not a
   blocker and must not trigger repeated searches.
4. If the target is still unknown, inspect only obvious resume, profile, work
   history, or repository-summary files. Ask one concise question only when a
   target role or other essential constraint still cannot be inferred.
5. Treat project files as candidate source of truth and panel data as a
   visualization snapshot. Invoke `save_candidate_context` only when verified
   candidate facts changed.

## Panel tool protocol

Call Panel App tools through:

```json
{
  "action": "invoke",
  "panel_id": "panel-app:job-hunt-hq",
  "tool_name": "save_job_opportunities",
  "arguments": {}
}
```

Use the exact arguments reported by `Panel` `action: "tools"`. Do not pretend a
write succeeded when the invocation failed. A successful invocation updates
the current project's `job-hunt-panel.json`, which the panel renders.

## Execution style

- Make progress in batches. Do not narrate each click, page read, or tool call.
  Give one short start update, then only report a material result or blocker.
- Produce the first useful panel write early. For discovery, save 3–8 relevant
  listing records as soon as their company, title, URL, and visible details are
  verified. Mark JD completeness honestly, then enrich the same records later.
- Continue automatically through the selected task combination. Do not stop after
  announcing the next step.
- Use `save_workflow_progress` only for genuinely long multi-job or multi-task
  work. A quick discovery or single artifact does not need a workflow run.
- Do not load generic process Skills after this Skill is active. Use another
  specialized Skill only when the user explicitly requests an artifact format
  that requires it.

## Evidence rules

- Use only candidate claims verified in the current project. Never invent
  employers, dates, ownership, technologies, metrics, results, education, or
  contact details.
- Prefer official company and careers pages for company and role facts.
- Search current public pages only. Never bypass login, CAPTCHA, robots,
  paywalls, rate limits, or other access controls.
- Never request, reveal, export, or reuse session cookies or credential secrets.
  Never replay authenticated recruiting-site requests with shell commands,
  scripts, `curl`, or an out-of-browser HTTP client. Use the connected browser
  as the user sees it; when blocked, use public web search, official careers
  pages, another requested provider, or ask the user to paste the JD.
- Keep facts, subjective reviews, and inference separate. Paraphrase public
  reviews and attach their URLs.
- Label interview questions as `reported` only when a source supports them;
  otherwise label them `predicted`.
- Preserve the available JD, canonical URL, publisher, visible dates, access
  time, completeness, and important missing evidence. A listing snippet is a
  valid partial result, not a complete JD.
- Return a transparent partial result when sources are blocked or weak.
- A match analysis or preparation plan must distinguish a missing skill from a
  missing piece of evidence. Do not recommend inventing experience to close
  either gap.
- A real interview debrief must come from user-provided notes, questions,
  answers, feedback, or outcomes. Ask briefly for missing interview facts
  before saving; never fabricate a completed interview.

## Finish

Write every requested structured artifact through the appropriate Panel App
tool before the final response. For multiple selected jobs, write one
job-specific artifact at a time so each output keeps its `job_id`. Then
summarize briefly what changed in the panel, what remains unverified, and the
highest-value next step.
