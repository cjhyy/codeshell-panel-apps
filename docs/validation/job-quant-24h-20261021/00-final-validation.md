# Parent completed validation evidence

Captured 2026-10-21T04:23:37.100Z. Actual subprocesses, all exit 0.

Latest CC budget/format repair: 34 tests, 34 passed, 0 failed. Browser/CLI parity: 10 tests, 10 passed, 0 failed. See 00-parent-receipts.json for commands and exit provenance.

✔ plan cutoff, package identity, path traversal, bad state and symlinks fail visibly (43.93675ms)
✔ receipt recovers state after an interrupted commit without executing another round (64.045583ms)
✔ concurrent dead-owner recovery keeps the new live owner and commits one tick (53.722792ms)
✔ recovering the final failed receipt still honors the failure cap before more work (127.160625ms)
✔ ending again preserves the original finish time instead of extending observation duration (85.083041ms)
✔ a new plan remains usable after the original task date and is capped at its own 24 hours (49.402958ms)
ℹ tests 34
ℹ suites 0
ℹ pass 34
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5283.308416

✔ career library Tools and CLI preserve the same sharded facts, immutable versions and legacy resume state (4507.74425ms)
✔ external CLI career facts reload a clean Panel but never overwrite an unsaved career editor (726.096ms)
✔ opening a migrated library and saving unrelated Tool or manual records preserves original oversized facts and extensions (510.443208ms)
✔ Tool and CLI reject schema-valid astral facts that exceed storage capacity without changing any project bytes (483.3285ms)
✔ shared job research CLI/Panel parity and evidence UI (direct) (1191.172334ms)
✔ shared job research CLI/Panel parity and evidence UI (sharded) (1530.963834ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15621.27975

## Final candidate beb31fb

Actual parent full Job suite session 90590 exit 0:
✔ plan cutoff, package identity, path traversal, bad state and symlinks fail visibly (94.484708ms)
✔ receipt recovers state after an interrupted commit without executing another round (89.987916ms)
✔ concurrent dead-owner recovery keeps the new live owner and commits one tick (82.644542ms)
✔ recovering the final failed receipt still honors the failure cap before more work (232.421375ms)
✔ ending again preserves the original finish time instead of extending observation duration (171.012875ms)
✔ a new plan remains usable after the original task date and is capped at its own 24 hours (125.431208ms)
ℹ tests 378
ℹ suites 0
ℹ pass 378
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 52812.354667

CLI gate session 67139: 6/6 passed; package validate completed exit 0. Stable Job package 94 files matches source; Core native-entry/manifest preview passed, candidate 5.1.0.
