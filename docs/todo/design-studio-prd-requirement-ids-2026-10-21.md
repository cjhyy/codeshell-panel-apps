# Authored PRD requirement IDs

The PRD parser previously generated every requirement ID from its ordinal and an
ASCII slug. Adding one unrelated requirement changed existing English and Chinese
IDs before any design changed. The earlier read-only audit also found that a fresh
Figma reimport loses canonical `codeshellNotes`; raw source metadata survives. This
patch addresses requirement identity only and keeps that separate notes gap open.

## Bounded syntax

An author can put `[id:req-name]` at the start of a requirement list item, before an
optional priority. The existing `id` string retains that exact value. Valid IDs are
1–64 lowercase ASCII letters, digits or hyphens, starting with a letter. The `id:`
marker is case-insensitive; the identifier is not case-folded or translated.

The declaration is removed from the description before existing priority and
acceptance parsing. Invalid/missing IDs, absent descriptions, multiple leading
declarations and duplicate IDs fail explicitly. Collision checks cover explicit
IDs and legacy generated IDs in either order, including requirements beyond the
100-item returned limit. The existing inferred fallback retains its first50-item
limit when no requirement section exists.

Unannotated requirements retain the exact ordinal/slug algorithm. Their known
insertion/reordering/wording limitation is documented. No PRD, saved layer note,
screen ID, document schema/version or prototype configuration is migrated. An
author may explicitly retain an old generated ID after checking for collisions.

Both the live Panel's PRD submission and installed CLI `brief` call this same
parser. CLI discovery describes the syntax. The prompt still asks the Agent to
put IDs into existing layer notes. No arbitrary Figma `pluginData` is consumed.

## Regression evidence

The new fixture contains English and Chinese requirements, an unannotated legacy
requirement and two page hints. Parser tests cover insertion/reordering, translated
descriptions/headings, CRLF/numbered lists, changed priorities/acceptance criteria,
exact64-byte IDs and separate English/Chinese/Turkish Node process locales.
Parsed IDs pass through the actual brief prompt and existing canonical
notes/save/reopen/transfer paths. These are metadata checks, not actual Figma
execution or visual acceptance.

The isolated installed-CLI test reads the PRD, creates a design with those parsed
references, reorders/translates the PRD and reopens unchanged notes. Invalid,
duplicate and generated-ID collisions return one bounded error envelope and
leave both the design file and PRD unchanged. The existing CLI contract still
works without a webview or development dependencies.

The original baseline on unchanged `fe2eca7` passed1/7 new controls (legacy bytes)
and failed6/7, as expected. The baseline source/test/log and receipt remain under
`/Users/admin/.codex/worktrees/design-studio-prd-requirement-ids-20261021/evidence/`.
After the repair, focused parser/CLI/installed-discovery checks passed29/29
(`12678.103833ms`). This includes the added author-retained old-reference control.

Three generated-runtime checks, repository validation, TypeScript, Design Studio
native-app build check and diff check pass. The parser and CLI discovery module are
unbundled native `app/` files; generated browser/Figma/HTML plugin files have no
byte changes. Complete sequential CPU catalogue and independent peer evidence
are recorded separately after this source freeze. No native/UI/GPU/Host execution
is claimed.
