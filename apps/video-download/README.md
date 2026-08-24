# Mimi Download

Mimi Download is a local-first CodeShell Panel App for `yt-dlp`. If `yt-dlp`
or `ffmpeg` is missing, a one-click setup action starts an isolated, bounded
Task with the bundled `video-download-setup` Skill. The Task does not inherit
the current conversation, project instructions, memory, or unrelated Skills. It
first resolves the latest stable yt-dlp release from the official GitHub API
and compares the installed version with that tag. With supported Python it
reuses the existing installation owner; without Python it downloads the exact
official standalone binary for the current platform, verifies
`SHA2-256SUMS`, and installs it to a user-writable PATH directory. It then
updates or installs ffmpeg, verifies both dependencies in that order, and asks
the panel to re-check its runtime. It never inspects or downloads media during
setup, and it never hardcodes a release version.

The Download tab always shows the installed yt-dlp version beside the latest
stable tag from the official GitHub Releases API. Both checks are deterministic
local-process operations and never start an AI Task. The GitHub lookup uses an
available `curl` executable with a fixed API URL; a timeout, missing `curl`, or
an unavailable GitHub response leaves only the latest-version field unavailable
and never blocks downloading.

After initialization, paste a supported video URL, inspect its title, duration,
source, and available quality, then choose a preset and download without
creating an Agent turn. Downloads use
resume support, fragment retries, exponential backoff, bounded filenames, and
user-facing error classification. Playlist ranges and subtitle languages remain
optional, so the default flow is still paste, inspect, and download. Inspection
also renders the actual download list: a single link shows one item, while a
playlist marks every visible entry as `will download` or `skipped` as its range
changes.

The interface is split into three compact tabs: **Download** contains setup and
download options, **Task** contains live progress, logs, and error analysis, and
**History** contains completed downloads. Task failures automatically open the
Task tab, while small badges keep dependency, progress, and history state visible
without making the page long.

There is no AI configuration step in the normal download flow. If inspection or
a download fails, the panel reveals an **Analyze error with AI** action. It
starts a short tool-free Task using only sanitized diagnostics, then displays
the answer directly in the panel. It never changes settings, retries, starts a
download, or writes into the current conversation.

## Requirements

- CodeShell Desktop with Panel API v8 and the atomic `process` and `agent.task` Host permissions.
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) available on the Desktop app's PATH, or initialize it from the panel.
- `ffmpeg` is recommended for merging video/audio streams and MP3 conversion.
- `curl` is optional and used only to read the official latest yt-dlp release tag.

The deterministic inspection and download path uses only `process`. CodeShell
resolves an executable to an opaque, app-scoped handle, runs it with
`shell: false`, and streams bounded stdout/stderr events back to the Panel. The
first execution of an executable requires Host confirmation.

One-click setup and error-only AI analysis use `agent.task`. Task state and
results return to the panel through `agent.task.changed`, so there is no Session
picker or manual binding step. Setup also renders a bounded live activity list
for model, plan, tool, and error events directly in the initialization card;
the private Task intentionally does not create a normal chat Session. The Panel
exposes six domain tools:

- `inspect_video` sets an optional URL and retrieves video or playlist metadata with local `yt-dlp`.
- `get_video_download_context` reads metadata, configuration, destination, and task status.
- `refresh_video_download_dependencies` re-checks `yt-dlp` and `ffmpeg` after setup.
- `apply_video_download_config` changes format, playlist range, and subtitle settings.
- `start_video_download` explicitly starts the configured download.
- `cancel_video_download` cancels the active download.

This still lets an ordinary Session operate the Panel directly when the user
asks in the conversation. Starting a download remains a separate mutating tool.
Inspection and downloading themselves never need a Session or an LLM.

## Current limitation

Publicly accessible media follows the same core yt-dlp path as the standalone
Mimi Download app. Login-restricted media is not yet supported: Panel Host v8
does not expose Cookie contents or a Cookie-file path to panel code, and the app
does not silently read a browser profile. Adding this later requires a generic,
Host-owned file-handle capability rather than a video-specific permission.

## Install from GitHub

In CodeShell, choose **Extensions → Panel Apps → From GitHub** and enter:

- Repository: `https://github.com/cjhyy/codeshell-panel-apps`
- Branch or tag: `main`
- App subdirectory: `apps/video-download`

Only download media that you have permission to save, and follow the source
website's terms and applicable law.
