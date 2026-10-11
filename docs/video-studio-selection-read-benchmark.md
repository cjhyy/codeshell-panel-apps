# Selection view reads

Run from a clean source checkout with the normal development dependencies and
Playwright Chromium installed. Keep other browser and media test processes idle:

```sh
node scripts/bench-video-studio-selection-read.mjs /tmp/selection-read.json
```

The script reuses the real workspace browser fixture, adds runtime read and render
counters, and performs real mouse presses. It does not modify application source.
The 5,000-clip document uses three legal sequences of 2,000/2,000/1,000 shape clips;
the active sequence has 2,000 clips. Shapes remove asset decoding and media I/O
from this measurement. The fixture mounts `EditorWorkspace` directly, so the
legacy main entry's subscribers are outside the measured scope.

The baseline is commit `891f04821bae09de18b8ce929d15588818bad0bf`.
[The recorded JSON](video-studio-selection-read-baseline.json) retains sample
counts, median/p95 times, read counts, draft flows and lifecycle boundaries.
At 5,000 clips, reselecting the same IDs took a median 36.3 ms in the selection
callback, including four `Session.read()` calls totaling 33.5 ms. Selecting new
IDs took 40.6 ms, including four reads totaling 33.2 ms. `beginGesture` adds its
own fresh read: the corresponding medians were 44.9 and 48.7 ms.

[The after-change JSON](video-studio-selection-read-after.json) was collected in
another exclusive CPU window on the same machine, using the same fixture and
sample counts. The production source blob is recorded with those results.

| Document clips | Selection | Selection callback median, before → after | Begin gesture median, before → after |
| --- | --- | --- | --- |
| 1,000 | Same IDs | 9.2 → 4.2 ms | 11.2 → 6.3 ms |
| 1,000 | New IDs | 11.7 → 7.1 ms | 13.4 → 9.1 ms |
| 5,000 | Same IDs | 36.3 → 10.4 ms | 44.9 → 18.5 ms |
| 5,000 | New IDs | 40.6 → 14.4 ms | 48.7 → 22.7 ms |

Every selection callback went from four session reads to one; `beginGesture`
went from five to two. At 5,000 clips, its p95 changed from 51.7 to 19.8 ms for
the same selection and from 50.5 to 23.5 ms for a new selection. Presses after
revision, generation and sequence changes still use two fresh reads, with
individual measured gesture times of 24.4, 24.1 and 25.0 ms.

Track-name and Inspector drafts are exercised before the next actual press.
Their complete flows contain 30 and 23 reads respectively. Those totals include
durable field commits, document refreshes and view updates; this change only
shares the four reads inside the final synchronous selection rendering batch.
After the change those complete flows have 27 and 20 reads: three fewer each.
An additional sample measures the first actual 16-pixel drag move and cancels it:
its planning work has no `Session.read()` calls and is a separate cost. It took
40.4 ms before and 39.0 ms after, which does not establish a planner improvement.

The internal sharing lifetime ends before the callback returns, including errors.
Every consumer checks document identity, revision, generation, sequence, selected
IDs and playhead against the captured owner before reusing the detached document.
Reentrant edits or view changes fall back to a fresh read. Public session reads
remain separate mutable copies. No graph validation, planner checks or final
commit validation are skipped, and no snapshot is cached between selections.

These are local headless Chromium measurements, not a playback or end-to-end
latency guarantee. Compare before/after on the same idle machine; changed
selection DOM work, draft commits, first-move planning and asset decoding remain.
