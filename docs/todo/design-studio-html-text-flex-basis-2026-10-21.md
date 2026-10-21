# Preserve flex basis when recovering editable HTML text

The original html2figma gallery case 21 has a `flex-basis: 200px` child whose
captured width is 200. The adapter already marks its main axis Fixed, but plain
text recovery sees `width:auto` and overwrites that mode with Hug. Browser then
renders about 110.3 pixels of text plus padding; canonical reflow also shrinks it.
This is a conversion mapping failure independent of CanvasKit drawing.

Keep the adapter's existing main-axis mode when the actual CSS parent is Flex
and Typed OM reports a finite nonnegative pixel basis. Text recovery may still recover Hug
on the other axis. Ordinary labels with an auto basis continue to Hug. No normal
flow becomes absolute, no geometry is fitted to a screenshot, and no new native
Figma capability is admitted.

The regression covers horizontal and vertical main axes, ordinary Hug labels,
canonical reflow, save/reopen, and actual Browser geometry without mutating the
canonical scene. The unfixed source fails with Hug instead of Fixed; the raw
CPU failure is retained in the external task evidence.

This bounded correction preserves the adapter's existing resolved size policy.
It does not add general CSS flex-shrink, percentage-basis or automatic minimum
content algorithms. In particular, arbitrary content edits can still expose
those existing model limitations. Whole-page and native Figma parity remain
separate failed or unexecuted qualifications.
