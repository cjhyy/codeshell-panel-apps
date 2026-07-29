---
name: job-hunt-workflow
description: Operate the project-bound Job Hunt HQ panel from the current CodeShell session. Use whenever the user asks to find or compare jobs, collect or verify a JD, research a company or careers site, summarize public company reviews, investigate interview processes or reported questions, tailor or revise a resume, generate candidate-specific interview questions, run a mock interview, update application progress, or run an end-to-end job-hunt workflow.
---

# Job Hunt Workflow

Keep the conversation in the current CodeShell session. Do not create a second
chat surface or ask the user to open another repository. The enabled Panel App,
its tools, and this Skill are one project-scoped product.

## Start every task

1. Read the active project's root `CODESHELL.md`.
2. Read only the project files it identifies as candidate facts, work history,
   repository evidence, search preferences, or job-search policy.
3. Use `Panel` with `action: "tools"` and
   `panel_id: "panel-app:job-hunt-hq"` to inspect the current tool contract.
4. Invoke `get_job_search_context` through `Panel` before relying on panel
   state. Treat project files as source of truth and panel data as a
   visualization snapshot.
5. When verified candidate facts changed, invoke `save_candidate_context`.

Read [references/workflows.md](references/workflows.md) for the requested mode.
Read [references/data-contract.md](references/data-contract.md) before invoking
research or workflow-progress writes.

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

## Evidence rules

- Use only candidate claims verified in the current project. Never invent
  employers, dates, ownership, technologies, metrics, results, education, or
  contact details.
- Prefer official company and careers pages for company and role facts.
- Search current public pages only. Never bypass login, CAPTCHA, robots,
  paywalls, rate limits, or other access controls.
- Keep facts, subjective reviews, and inference separate. Paraphrase public
  reviews and attach their URLs.
- Label interview questions as `reported` only when a source supports them;
  otherwise label them `predicted`.
- Preserve the full available JD, canonical URL, publisher, visible dates,
  access time, confidence, and important missing evidence.
- Return a transparent partial result when sources are blocked or weak.

## Finish

Write every structured artifact through the appropriate Panel App tool. Then
summarize in the current session what changed in the panel, what remains
unverified, which sources were blocked, and the highest-value next step.
