# Editable HTML image border boxes

An ordinary captured IMG with a uniform solid pixel border becomes a real
vertical Auto Layout Frame. The Frame keeps the source element's ID, semantic
notes, geometry, opacity and parent sizing. Its physical padding equals the
inside border width. One deterministic `-image-content` image child fills both
axes, uses the original asset bytes and object-fit, and has no border or absolute
positioning. The current producer registers that child with the existing
capture-local factory callback; this proof is never serialized as authority.

The maintained integration captures actual IMG object-position, paint and
geometry facts by semantic object identity before conversion. Own and ancestor
transform/rotate/scale/translate/zoom, padding, nonuniform/dashed borders, effects,
painted IMG backgrounds and noncentral object-position refuse this bounded
recovery. Missing or unsupported evidence fails before returning a document.
Natural intrinsic IMG axes remain measured Fixed, avoiding a new Hug/Fill cycle.

Uniform circular pixel radii produce an inset child radius `max(0,r-border)`.
Exactly 50% on all four corners is additionally accepted only for a measured
square with definite fixed axes and no relative/min/max/aspect sizing dependency.
The HTML width/height attributes' `auto <ratio>` hint has no sizing dependency
when both axes are definite. Parent sizing is checked again before returning.
This is a current-size pixel projection with an explicit warning. Resizing the
image box does **not** retain dynamic percentage/elliptical author intent.
Other percentage, elliptical, unequal or overlapping radii refuse recovery.

## Native fill representability

Canonical `objectFit:fill` remains unchanged. Figma IMAGE `FILL` is a cover
operation, so it can represent stretching only at an equal aspect ratio. A pure
bounded PNG/JPEG/GIF dimension parser reads original local bytes without DOM,
network or reencoding. It validates container/header bounds, not compressed
image data/CRC; the native image decoder remains responsible for decoding.
Unknown, truncated or ambiguous dimensions and unequal aspect ratios refuse
native transfer/creation. Cover and contain keep their existing behavior.
JPEG APP1, PNG eXIf, and nonzero GIF pixel-aspect metadata are conservatively
refused for fill; native orientation/metadata decoding has not been proved.
The existing validated SVG/WebP UI conversion route remains available with an
explicit pending-aspect warning. The bridge does not parse those dimensions.
Unconverted native packages still fail before writes; native validation checks
the actual converted PNG and final Auto Layout box, rather than trusting that
warning or a source-reported dimension.

Native validation checks canonical dimensions before document writes. It checks
all newly created fill images again after parent Auto Layout sizing, before
exposing owned pages or committing new patch creations. Failure removes only
new import pages or uses the existing patch undo boundary. No geometry repair or
fill-to-cover rewrite occurs. No new Image stroke schema is introduced.

## Validation limits

CPU Chromium controls retain original transparent PNG bytes, real 30×30 inset
content, opacity, Fixed/intrinsic sizing, Fill children, viewport resize,
portable/reopen state, and live frontend box edits. Square, natural, opacity,
cover and contain controls have strict zero SVG pixels. Frontend CSS controls,
including rounded variants, have strict zero pixels. Rounded SVG still differs:
8px corners 79 pixels/max23; 50% projected circle 189 pixels/max23. Their fidelity
receipts remain failed, with no antialiasing tolerance relaxation. These are
rendering negatives, not a native pixel parity claim.

Frozen official Bootstrap Features now produces valid 313-node documents at
1280/768/400 instead of aborting on an IMG border. Full-page pixel/flow failures
remain substantial, and its native transfer still refuses an existing
unrepresentable CSS shadow mask. This change does not claim the webpage solved.
Standalone html2figma's legacy direct DesignNode-to-native creator is unchanged;
the verified editable border-box route is HTML capture → canonical v3 → transfer.
