# Range export preparation

Range export keeps the submitted document and original sequence clock. It does not
trim or rewrite clips, nested time maps, source-bound captions, transitions, or
animation. The encoded frame count still rounds up at the selected output frame
rate, and the final audio padding still follows that encoded duration.

## Work avoided

- Picture preparation visits overlapping visible clips and recursively maps the
  requested interval through nested time maps. Reverse, held and rounded source
  clocks are covered conservatively. Only potentially visible video/image assets
  receive export proxies or browser media URLs. Both active transition clips are
  retained; multicam picture switches retain their intersecting angles.
- Without ducking or intersecting pitched/stretched audio, mixing evaluates only
  original samples `ceil(start / 5)` through `ceil(end / 5) - 1`. Unrelated audio
  lanes do not resolve or decode their source files. Fades, volume/pan animation,
  track gain/mute and nested unity/reverse maps use the original sample clock.
- An already cached complete mix remains reusable. Otherwise a partial WAV uses a
  separate recipe containing the full recipe hash and exact range. Its receipt
  carries `range`; full preview preparation cannot consume that receipt, and a
  different export interval cannot reuse it. The muxer does not crop it twice.

## Deliberate full preparation

This is not a fully bounded import/decode pipeline. Snapshot staging still
authorizes, copies or links, and verifies the complete selected sequence's resource
closure. Range-external files must therefore remain available for staging. A
participating source's PCM is still decoded in full and shares the existing
content/version/duration cache. A participating video still receives the existing
full-source export proxy; this change does not seek-transcode only its source window.

Any ducking request keeps the complete mix and its detector/envelope history.
An intersecting span requiring WSOLA or pitch processing also keeps the complete
mix, preserving its original context and phase. A range containing no 48 kHz
sample falls back to the complete mix before the existing empty selection/padding
step. No quality setting, amplitude normalization or approximate audio is introduced.

The native export JSON report records `preparation.audio` (`range` or `full`),
`pictureAssetCount`, and, when newly planned, `audioFallback` (`ducking`, `stretch`,
or `sub-sample`). Range overload measurements read the actual selected float PCM.
All cache identities still include the document, sequence, material bindings and
FFmpeg version. Cancellation does not publish incomplete WAVs or export files.

## Verification

```sh
node scripts/run-typescript-tests.mjs tests/video-studio-editor-audio.test.ts tests/video-studio-editor-task.test.ts tests/video-studio-media-task-bridge.test.ts
node --test --test-concurrency=1 tests/video-studio-editor-audio-pcm.test.mjs tests/video-studio-editor-task-runtime.test.mjs tests/video-studio-editor-sequence-render.test.mjs
npm run typecheck
```

The real stereo PCM fixture reduces a ten-second nested sequence from 480,000
samples to 16,016 samples for an 80,080-tick window. Every resulting float sample
equals the original complete mix slice through reverse playback, animated gain and
pan, track gain/pan and fades. The native task fixture reduces a twelve-second
sequence from 576,000 samples to 16,016, skips an unrelated video proxy, and compares
the partial WAV with the complete preview WAV and its actual encoded range frames.
The independent nested/subtitle/alpha/transition fixture compares decoded RGB
pixels with the original range output; complex retiming keeps the full PCM.

Other regressions cover a one-tick/one-sample export, an empty sample interval at
the sequence endpoint, 59.94/29.97 fps, multicam switch boundaries, rounded nested
maps, full/range cache separation, mismatched receipts, changed source content,
cancelled mixing and unpublished-file cleanup. These are correctness and avoided
work measurements, not claims about end-to-end export speed or playback fps.
