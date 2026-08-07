---
name: resume-design
description: Design, beautify, audit, or export readable ATS-safe resumes. Use for resume templates, typography, spacing, visual hierarchy, density, photo placement, A4/PDF layout, print overflow, scanability, or when a correct resume still looks weak or crowded.
---

# Resume Design

Turn verified resume content into a calm, deliberate document that reads well
on screen, prints cleanly on A4, and keeps one reliable text reading order.

## Coordinate with Job Hunt HQ

- Use `job-hunt-hq:job-hunt-workflow` for project context, Panel writes, and
  Trace completion. Use `job-hunt-hq:resume-writing` for claims, emphasis, and
  wording. This Skill owns presentation and visual QA, not candidate facts.
- Read [references/layout-rubric.md](references/layout-rubric.md) before making
  a template decision or approving a final layout.
- Preserve the selected Panel template and density unless the user requests a
  change or the layout gate fails. Do not rewrite facts to solve overflow.

## Resolve the format brief

Before choosing a layout, resolve only what the request needs:

- target market and language;
- expected length, normally one or two A4 pages;
- selected template and density;
- whether the user supplied a photo and wants it shown;
- export target: Panel preview, PDF, Word, or plain ATS upload.

Ask only when a missing choice materially changes the result. A photo is
optional. Never infer or generate a candidate portrait. For markets or systems
where a photo may introduce risk, explain the tradeoff and prefer a no-photo
ATS version while preserving the user's choice.

## Choose the smallest useful template

Use the Panel's available template system:

1. **Editorial / 清晰专业** — restrained serif headings, an accent edge, and an
   optional portrait. Best for direct sharing and human review.
2. **Minimal / ATS 极简** — one conservative column, sans-serif type, minimal
   decoration, and no layout dependency on the portrait. Best for uploads,
   international applications, and uncertain parsers.
3. **Technical / 技术重点** — compact sans-serif hierarchy with subtle mono
   labels. Best when projects, systems, and implementation evidence are dense.

Use comfortable density by default. Use compact density only after removing
low-signal content and only when it prevents an otherwise minor page spill.

## Build visual hierarchy

- Make name, target identity, and contact information the first visual group.
- Give section headings a consistent scale and rhythm; do not style every
  section as equally important.
- Keep body copy at a readable print size and avoid thin gray text.
- Use alignment, spacing, and weight before adding boxes, colors, or icons.
- Keep bullets short enough to scan and prevent headings from becoming page
  orphans.
- Use one restrained accent color with sufficient contrast. The document must
  remain understandable in grayscale.
- Hide internal evidence annotations, action buttons, placeholders, and Panel
  controls from the exported document.

## Protect ATS extraction

- Keep all public content as real selectable text in one logical DOM or
  document order.
- Do not put essential identity, contact, dates, or skills in images,
  icon-only labels, headers, footers, or decorative pseudo-elements.
- Avoid tables, floating multi-column fragments, and absolute positioning that
  can scramble extraction. A floated optional portrait must not change the
  text order.
- Never hide keywords, shrink content to unreadable sizes, or repeat terms for
  parser gaming.
- When parser reliability matters, use the Minimal template and verify the
  extracted text order from the exported file.

## Run A4 and export QA

Check screen and print states separately:

1. Inspect the first scan at normal scale.
2. Inspect every A4 page for clipping, overflow, lonely headings, awkward
   single-line spills, and inconsistent margins.
3. Verify the portrait is cropped consistently and disappears cleanly when no
   image exists or the selected template suppresses it.
4. Verify links, text selection, grayscale contrast, and extracted reading
   order when the format supports them.
5. Re-run the rubric after any density or template change.

Do not approve the layout when a blocking failure remains or the layout score
is below 85/100. State what still needs manual inspection when the runtime
cannot render or extract the final file.

When Panel API v3 or newer is available, use the Panel's **保存 PDF** action to
export the prepared public resume view into `career-data/resumes/`. Do not ask
the Agent to manufacture PDF bytes or write a second rendering pipeline. The
exported file must exclude Sources, evidence controls, interview prompts,
placeholders, and Panel chrome. On an older Host, explain that the action falls
back to the system print dialog and that restarting CodeShell may enable native
project export after an update.

## Finish

When the Panel is active, keep the public Markdown and claim evidence intact,
apply or recommend the smallest template/density change, and finish through
the workflow Skill. Summarize the chosen visual system, photo behavior, page
fit, ATS tradeoff, and any unresolved export risk.
