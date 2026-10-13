# Video Studio research archive, 2026-10-12

These three experiments preserve the evidence behind later production changes.
They are historical source transformations, not benchmarks of current `main`.
Their measurements describe the original source, browser and machine only.
No runtime, manifest, installable package or default test suite loads these scripts.

| Experiment | Original experiment commit | Application baseline |
| --- | --- | --- |
| [Owned gesture preview](../reports/video-studio-owned-preview-2026-10-12.md) | `a5f6352bba817062e00b5e1dee80fa000719dd53` | `9a22855f8defe3fb1ed6235cf87065e20f6b1223` |
| Rejected timeline audio plan caches | `61f7beaccf173b298d7e12d2e3e00184f8434bf8` | `b2ad2d20866dad9e51a88e8a279edc1cf41af001` |
| [Owned timeline audio plan](../todo/video-studio-timeline-owned-plan-research-2026-10-12.md) | `ff32d42a4dccd195beb20bd365b3000607096d3c` | `b2ad2d20866dad9e51a88e8a279edc1cf41af001` |

The original experiment commits add only their research scripts and documents;
their application files equal the listed parent baselines. The current scripts
reject other commits before loading browser dependencies or writing a temporary
fixture. `--help` prints the restoration command without running the experiment.
Do not update production modules to make these old text anchors match.

## Restore and rerun an original experiment

Choose a fresh directory and the original experiment commit from the table. For
example, from a checkout with the repository's historical Git objects available:

```sh
git worktree add --detach /tmp/video-studio-owned-preview-history a5f6352bba817062e00b5e1dee80fa000719dd53
cd /tmp/video-studio-owned-preview-history
npm ci
npx playwright install chromium
node scripts/video-studio-owned-preview-prototype.mjs
```

This restores the original script as well as its matching application source.
The original scripts predate the current baseline guard; run them only in that
separate historical checkout. If an object is missing, fetch the original
experiment commit from a retained repository or Git bundle before continuing.
Do not reset the primary checkout or copy old runtime files into current `main`.

Use Node.js 20+, the committed npm lockfile and Playwright Chromium. The two
timeline media experiments additionally require FFmpeg and `ffprobe` on PATH and
generate synthetic media through the existing browser fixture. The fixture
cleans up its temporary media, and each script removes its temporary test file.
Capture stdout to a separate log if results should be retained, then preserve
useful evidence before removing a completed historical worktree.

| Script in its original checkout | Modes |
| --- | --- |
| `node scripts/video-studio-owned-preview-prototype.mjs` | Default private clone; optional `--structured-clone` or `--unfrozen-base --structured-clone` |
| `node scripts/video-studio-timeline-media-plan-prototype.mjs` | Default `baseline naive guarded`; individual modes may be passed as arguments |
| `node scripts/video-studio-timeline-owned-plan-prototype.mjs` | Default `baseline owned`; individual modes may be passed as arguments |

The naive cache intentionally demonstrates invalid same-revision reuse; its
speed is not an acceptable implementation. The descriptor guard was rejected
because of its measured cost. The owned-snapshot research describes the separate
ownership design and its bounded benefit, including cold-render costs. Later
production implementation and validation live in the normal source and tests.

The preservation change checks syntax, help and baseline rejection on current
`main`, and baseline acceptance against retained original checkouts. It does not
rerun the original browser benchmarks or turn old timings into current results.
