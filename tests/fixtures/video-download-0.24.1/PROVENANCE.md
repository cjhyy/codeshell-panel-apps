# Video Download 0.24.1 queue fixture

`cli-store.mjs` is the exact unmodified file from Panels commit
`84348855be8ae4e5a31936b3c2b0d1d21410bd64`, path
`apps/video-download/app/tools/cli-store.mjs`.
SHA-256: `8bed5d8ad61a80ed0c8e7f3351bae71b57dac73986b4690b6f20c2497ecc06ed`.

The service regression suite runs its actual `claimWorker`, `admitWorker` and
`releaseSlot` in an owned IPC child. The child waits on parent messages instead
of timing its queue-polling loop. It uses only temporary projects and no network
or external executable. Keep these legacy bytes unchanged: the fixture must
retain the pre-pump queue parser requiring every slot to have a PID.
