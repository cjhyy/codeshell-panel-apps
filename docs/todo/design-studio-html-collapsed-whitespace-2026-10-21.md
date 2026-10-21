# Source-bound collapsed whitespace correction

The pinned html2figma normalizer records an ASCII whitespace suffix, trims it,
then appends NBSP even when that suffix has no rendered width. Its later text
sanitizer preserves this synthetic character. An empty absolute link `::after`
is a separate captured child; it does not cause the NBSP, but also survives as an
unpainted absolute frame.

The maintained integration corrects a clone of the render tree. Only one actual
Text child under normal/nowrap horizontal LTR CSS qualifies. The exact raw source
must have no Unicode spacing or zero-width joiner, fit the 1,000 UTF-16-unit raw and JSON-escaped receipt
budget, and match the legacy normalized content. Every rectangle of the actual
trailing ASCII Range must have exactly zero width before the one synthetic final
NBSP is removed. The source DOM, captured bounds, styles and other text characters
are untouched. Canonical notes retain the exact raw source; this note is not a
layout qualification flag. Inline boundary spaces with nonzero extent, actual
NBSP, BR, mixed inline nodes, pre/pre-wrap/pre-line and ambiguous generated content
keep the pinned result, including existing unsupported behavior.

Empty generated before/after boxes qualify separately only when actual capture
proves block display, out-of-flow placement and no glyph, marker, fill, border,
shadow, outline, filter, mask, decoration, scrollbar, resize handle or native
appearance. Their omission records the pseudo names and emits
`html-empty-pseudo-hit-area`: the original real link and source attributes remain,
but its extended click target is not exported. Painted/generated or unproved
pseudo boxes are retained. This does not turn CSS AUTO tables or negative tag
margins into verified native Auto Layout.

The standalone HTML plugin uses the same correction and retains bounded raw
source through its existing semantic `sharedPluginData` channel. An informational
snapshot binds the record to the converted node's geometry and text. Preview,
create, downloaded JSON and JSON reimport show the hit-area warning. Changed or
malformed snapshots only warn and preserve the original record; they never trim,
restore, position or admit any imported node. No native layout marker or new
admission protocol is added. A real opaque standalone UI test covers edited
characters, download/reimport, actual NBSP and painted-pseudo controls using the
existing native service harness; actual Figma execution remains unperformed.

## Validation and retained failures

The focused CPU browser tests compare the maintained result with the immutable
pinned converter. They retain literal NBSP, visible inline spaces, explicit BR,
preserved whitespace, Unicode spacing, generated text, ordinary flow pseudos,
and paint/scrollbar/native-appearance controls. Save/reopen and Figma transfer
retain corrected characters and exact raw-source notes. The same unadorned Arial
control is strict zero at import, reflow and 400px. The original underlined Arial
control remains a strict failure: 203 pixels/max237 before versus184/max4 after.
Remaining changes are at the original underline's vertical boundary; the extra
NBSP extent beyond the source's rightmost paint is gone. The comparator remains
strict; this residual is not called a pixel pass.

Frozen actual Tasklist replay keeps original HTML/assets/reference PNG bytes:

| Capture / edit | Before differing pixels | After differing pixels |
| --- | ---: | ---: |
| 1280px initial / reflow | 14791 / 14791 | 12911 / 12911 |
| 768px initial / reflow | 14791 / 14791 | 12911 / 12911 |
| 400px fresh initial / reflow | 14720 / 14720 | 12842 / 12842 |
| 1280→400 outer-only edit | 30310 | 30264 |

All rows above remain failed strict comparisons. Font smoothing, underline
geometry, independent AUTO-table column allocation and negative vertical tag
margins remain separate limitations. Exactly five proven empty pseudo frames
are omitted (54→49 nodes, nine→four absolute flags); all retained nodes keep their
IDs and measured geometry. The four static tag boxes remain absolute and are
not claimed as ordinary flow success. CPU-only external evidence and original
failed attempts are preserved under the task's
`evidence/html-collapsed-link-whitespace/` directory. No GPU or native Figma trial
was performed for this change.
