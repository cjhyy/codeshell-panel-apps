---
name: job-intelligence
description: Find, collect, verify, compare, and research jobs, JDs, companies, public reviews, hiring signals, and interview reports. Use for recruitment-site discovery, official career pages, JD completeness, company due diligence, source freshness, or reported interview intelligence.
---

# Job Intelligence

Build a trustworthy formal job inbox first, while keeping incomplete discovery
results in a separate lead queue. Finding a listing never means the user wants
it and does not yet mean a real job was collected.

## Coordinate with Job Hunt HQ

- Use `job-hunt-hq:job-hunt-workflow` for Panel context, explicit target jobs,
  Trace correlation, structured writes, and completion.
- Invoke `get_job_search_context` before searching when Panel tools are
  available. Use `scope=discovery` for providers and filters, paginated
  `scope=jobs` for comparison indexes, and `scope=job` with an exact `job_id`
  for verification or research. Respect the submitted execution boundary.
- Read [references/source-quality.md](references/source-quality.md) before
  saving discovery or research results.

## Select one primary mode

1. **Discover** — find current listings, open enough detail pages to satisfy the
   requested count of complete JDs, and save incomplete candidates as leads.
2. **Verify JD** — enrich one existing listing with the canonical URL, full JD,
   dates, and missing-field notes.
3. **Compare** — compare only explicitly selected jobs using verified fields.
4. **Research company** — investigate the company, role, public reviews, and
   interview signals for one exact selected opportunity.

Do not automatically move from Discover to company research, resume writing,
or interview preparation. Stop at the requested boundary.

## Discover complete jobs and preserve leads

- Search only the requested channels. Prefer visible public listing pages,
  official company career pages, and public ATS pages.
- Save useful candidates in batches with company, title, URL, source, visible
  location, compensation, published date, and fetch time. A requested count is
  the number of formal complete JDs, not the number of search cards examined.
- Deduplicate by canonical URL first, then by company, title, and location.
- Mark records `listing_only`, `partial`, or `full` honestly. The Panel keeps
  the first two in `jobLeads`; they must not appear in formal `jobs`, receive a
  `job_id`, or feed resume/interview work. Update the same canonical URL after
  reading the full detail page so it can be promoted.
- A formal JD must be explicitly confirmed `full`, contain substantive source
  text, and include both responsibilities and candidate requirements. Marketing
  copy, search snippets, similar-job text, and inferred requirements never pass.
- Every newly discovered formal job remains `inbox`. Only an explicit user
  action can mark it interesting, ignored, applied, or otherwise active.
- Full normalized JDs belong in `career-data/jd/jobs/<job-id>.md`; the Panel
  writes that file when `save_job_opportunities` accepts the formal record.

## Scheduled discovery

- A Panel-created recurring run continues the same project and Session so it can
  reuse that Session's visible browser state. It may use only providers still
  marked `ready`; never wait unattended for login, CAPTCHA, or approval.
- Apply the same complete-JD target and lead separation as an interactive run.
- In addition to Panel writes, save a deterministic receipt under
  `career-data/discovery/runs/<UTC-time>-scheduled.json` using the requested
  `{schemaVersion, runId, generatedAt, source, jobs}` shape. Never edit
  `job-hunt-panel.json` directly. The Panel imports unseen receipts on its next
  project sync and deduplicates them.

## Verify and research selectively

For a selected opportunity:

1. Resolve the exact listing and canonical company identity.
2. Verify role facts from the employer or original publisher when possible.
3. Keep official facts, public subjective reviews, reported interview
   experiences, and predicted questions in separate fields.
4. Record publication and access dates, source URLs, confidence, disagreement,
   and unresolved gaps.
5. Save the JD with `save_job_opportunities` or the research report with
   `save_job_research` before summarizing.

Paraphrase reviews. Do not turn a small or anonymous sample into a company-wide
fact. Label a question `reported` only when a source supports it; otherwise it
is `predicted` and belongs to preparation, not reported interview history.

## Respect access boundaries

- Use current public pages and the connected visible browser when applicable.
- Never bypass login, CAPTCHA, robots, paywalls, rate limits, or site controls.
- Never export cookies, tokens, or authenticated requests into scripts or
  out-of-browser collectors.
- When a source is blocked, continue with official/public alternatives, save a
  transparent partial result, and record one concise warning in the Trace.

## Finish

Write each formal result to the Panel with its exact `job_id`, preserve source
and freshness metadata, and finish the Trace through the workflow Skill. Report
the number of formal JDs added or updated, the separate number of leads still
awaiting completion, which sources were limited, and what would justify deeper
research next.
