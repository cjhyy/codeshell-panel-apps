# Video Studio migration fixtures

`project-0.5.16.json` is a synthetic project validated and normalized by the actual
published 0.5.16 `src/model.ts` from the read-only multitrack checkout. It exercises
schema version 1 with explicit tracks, a magnetic main picture track, independently
positioned overlays, normalized transforms, hidden picture with audible sound,
muted audio, a locked audio tail, captions beyond the picture tail, and production
metadata. Its reserved-looking audio-track ID also checks generated caption-track
collision handling. It is not a copy of a user's private project.

The installed 0.5.16 `media.ts` preview and the v2 shared compositor were additionally
run against this fixture in the same Chromium with identical synthetic media:
frames 0, 115, 180, and 220 matched RGBA exactly; frames 20 and 70 (60% opacity
overlay) differed by at most one 8-bit RGB step due to the v2 offscreen composite.
Canvas placement, source times, audible gains and the 230-frame duration matched.
This differential used the actual external preview implementation, rather than a
reimplementation of its drawing math. The regular migration tests retain the
fixture and verify its canonical values, strict validation, save/backup/undo,
main-only magnetic editing, sequence copies, and legacy production projection.
