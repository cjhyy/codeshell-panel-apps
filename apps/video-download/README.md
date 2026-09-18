# Mimi Download

Mimi Download 0.22.2 is a local-first CodeShell Panel App for `yt-dlp`. Its primary
**Install / Update** action is deterministic and does not invoke a model. It
resolves the latest stable yt-dlp release from the official GitHub API, tries a
safe update of an existing installation, and otherwise downloads the exact
official standalone binary for the current platform. The binary is verified
against the Release API's official `sha256:` asset digest, with
`SHA2-256SUMS` as a compatibility fallback, before it is installed into
CodeShell's Host-managed per-user executable directory. Windows and Linux use
the verified `yt-dlp/FFmpeg-Builds` GitHub Release when ffmpeg is missing;
macOS keeps the Homebrew route. Both dependencies are verified after install.

On Windows, setup tries curl first and automatically falls back to PowerShell
when curl's Schannel transport cannot complete a GitHub TLS handshake. Both
yt-dlp and the GitHub ffmpeg fallback land in the Host-managed directory, so
the panel can detect them immediately without restarting CodeShell.

Unusual environments have a separate **AI Initialize / Repair** action. Before
starting it, the user explicitly chooses a configured Provider and model. The
resulting bounded Task uses the bundled `video-download-setup` Skill but does
not inherit the current conversation, project instructions, memory, or
unrelated Skills. Model credentials remain in CodeShell and are never exposed
to the panel. Neither setup path inspects a video or starts a download.

The Download tab keeps dependency and version details in a compact disclosure,
with a prominent latest-version / update-needed tag. Expanding it shows the
installed yt-dlp version beside the latest stable tag from the official GitHub
Releases API. Both checks are deterministic
local-process operations and never start an AI Task. The passive version badge
uses an available `curl` executable with a fixed API URL; a timeout, missing
`curl`, or an unavailable GitHub response leaves only the latest-version field
unavailable and never blocks downloading. The setup action additionally uses
wget or Windows PowerShell as HTTPS fallbacks.

After initialization, paste a supported video URL, inspect its title, duration,
source, and available quality, then choose an actual resolution and download
without creating an Agent turn. Saved CodeShell Cookie accounts matching the
target website appear in a selector; users can also open the Host-owned login
window and save a new account. Downloads use
resume support, fragment retries, exponential backoff, bounded filenames, and
user-facing error classification. Playlist ranges remain optional. Subtitle
controls provide human/automatic source choices, language presets, and an
independent embed switch, so users can keep a separate SRT instead of embedding
it. The default flow is still paste, inspect, and download. Inspection
also renders the actual download list: a single link shows its metadata, while a
playlist marks every visible entry as `will download` or `skipped` as its range
changes.

The form has two explicit actions. **Download now** starts the selected links up to
the configured concurrency, with excess tasks waiting automatically for a free slot.
**Add to queue** saves them as **Waiting to start**, without starting any download.
Saved tasks remain waiting when other downloads finish or the panel reopens. Start
one from its card, or use **Download all**. Download now reuses a matching saved task
instead of adding a duplicate. Starting new links after Pause all leaves older
paused tasks untouched. The keyboard shortcut uses Download now. AI search's
**Add to queue** controls also save tasks for a later manual start.

Downloads run through a visible queue with **three concurrent tasks by default**.
The queue selector supports one to four tasks and remembers the setting per project.
Increasing the limit fills available slots; lowering it leaves in-flight tasks alone. Adding a task captures its
quality, playlist/subtitle options, output directory, and explicitly authorized
Cookie handle. The form stays editable during downloads, so another URL can be
added without changing earlier tasks. Video information can also be inspected during
active downloads, from the form or Chat, including batch inspection and retries.
Cancelling inspection leaves ongoing downloads alone. Download progress and
metadata results keep separate process ownership even when spawn receipts arrive late;
completed downloads wait for inspection to finish before checking their saved files.
Each running or scheduled task can be paused; saved tasks can be started or removed;
paused tasks can be continued or removed. **Download all / Continue all** starts
waiting and paused work up to the configured limit. **Pause all** stops active
download processes and holds pending work; it no longer just stops scheduling.
Completed and cancelled tasks are not restarted by the bulk control. Failed or
cancelled tasks can be retried individually. One
failure does not stop the other downloads. Each task owns its process identity, progress, logs and output inventory. The queue and up to 300 history records persist per project in Host storage.
Closing the panel stops active processes; reopening restores pending and interrupted
items without starting them. Paused tasks remain paused, keep their last progress,
and still participate in duplicate detection. **Continue all** or a task’s
**Continue** button reacquires directory and saved-account grants before continuing.
Continuing one task leaves the other paused tasks untouched.

Pause waits for the process to exit before enabling Continue. It retains local
partial files and uses the same output name with `yt-dlp --continue` on restart.
Byte or fragment continuation depends on the source; if it cannot resume, yt-dlp
may restart the transfer. Pausing creates no completed or failed history record.
A failed pause is visibly reported while the task stays running, so it can be retried.

No executable handle, directory grant, Cookie file handle,
Cookie value or process argument list is persisted. If storage fails, new work does
not start and the queue pauses.

Click a completed, failed or cancelled queue item to open and highlight its download
record. History filters are reset so the target remains visible. Clicking a running
or waiting item opens its own progress and log. Queue entries also support keyboard
activation. Removing a history record leaves its files intact.
The history locator uses a quiet blue highlight that clears after three seconds,
when leaving History, or when changing its search/filter. It does not mark an error,
and later history refreshes do not restore an expired highlight.

History uses a compact file list. Each row shows its title, status, format and a
short date, with direct **Play** and **Reveal** actions; missing or failed downloads
offer **Download again**. Expand a row to see its save location, individual filenames,
sizes and file checks. Secondary check, retry and delete actions live in **More**,
which supports keyboard activation, Escape and outside-click dismissal. File details
stay expanded after a check. Search and status filters update the record/file count,
and narrow panels retain the same actions as labeled icon buttons.

Paste up to 100 links at once (including ordinary share text). Canonical video
aliases are deduplicated within the batch and queue. The form lists every recognized
link, and the information button checks each video (up to 10 at a time) so titles
can be verified before adding the batch. Failed checks stay marked beside their
links and can be retried without discarding successful results. A running query
can be cancelled; the controls are released only after the process exits.
Selected quality is resolved independently
against each video's available formats when its queued task runs.
After inspecting a playlist,
checkboxes and select-all/none controls edit the exact episode range. Each queued
item keeps its original settings, even when the next form is changed.

Historical duplicates are checked against actual nonempty output files in the same
save directory with the same settings. A stored URL alone cannot block downloading.
Missing files may be downloaded again; a whole playlist is never blocked solely by
an earlier inventory because its online membership may change. inaccessible directories and incomplete old
records are reported as unverified. Existing files offer **Skip existing** or
**Save another copy**. Size/time changes remain distinct from the original download.
The helper checks only approved media/subtitle files under the authorized output
directory; it refuses escapes and symlinks. History supports search, status filters,
file checks, individual play/reveal actions, deleting one record, and retry with original settings.
A playlist records up to 200 reported output paths; larger/incomplete inventories
are explicitly unverified. Storage pressure removes oldest history before it can
remove any pending queue item. Clearing history never deletes disk files.

The output directory defaults to the currently bound, trusted project directory.
The Host supplies its authorized directory handle; users can still choose another
folder. The chosen path is remembered per project. On a Host with directory
bookmarks, reopening silently restores a fresh directory grant after checking
the original folder's identity. Older Hosts require selecting that folder once
more. Older Hosts that do not offer the `project` known directory show a prompt
to choose a directory instead of silently using the system Downloads folder.

Retry keeps the task's original options and account, and asks the Host to
authorize a fresh Cookie file for that saved account. It does not reuse stale
login data or switch silently to the account selected for the next task.

The layout uses the available panel width with left-aligned navigation, warm
neutral surfaces, and matching light/dark themes. Wide panels keep the queue
beside the form and separate links from download settings; narrow panels stack
the queue below the active tab and provide a header shortcut to it. The primary
link form comes before the collapsed environment and version controls.

The interface is split into four compact tabs: **Download** contains setup and
download options, **AI Find Videos** discovers real platform results, **Task**
shows every queued task with its own live progress, speed, status and pause/continue controls.
Selecting a task opens its detailed progress, logs and error analysis, while **History** contains download
records. Download failures open the Task tab; information-query failures stay
beside their links. Small badges keep dependency, progress, and history state
visible without making the page long. Search offers example prompts, visible
stages, a searchable archive, and a fresh-query action that retains saved results.

There is no AI configuration step in the normal download flow. If inspection or
a download fails, the panel reveals an **Analyze error with AI** action. It
starts a short tool-free Task using only sanitized diagnostics, then displays
the answer directly in the panel. It never changes settings, retries, starts a
download, or writes into the current conversation.
Error analysis stays available during other downloads, inspection and file checks.
Starting an analysis immediately locks only its own button, preventing duplicate
requests. Each result belongs to the error that started it, so a late result cannot
overwrite a newer failure. Missing models and catalog errors explain how to recover;
**Refresh models** picks up changed Provider settings without reopening the panel.

Error cards identify the video title, sanitized source URL, failed operation and
time, with a shortcut to the matching task. **Close notice** dismisses the card;
failed tasks retain **View error** in both the task list and queue, including after
reopening. Selecting a different task or retrying the failed task clears stale
error details. AI replies stay attached to the originating failure. **Stop AI analysis**
stops only that AI task, while **Stop and close** also dismisses the notice after
the task ends. A stop during task creation waits for the task receipt before
cancelling it; failed cancellation remains visible and retryable. Background task
checks recover missed completion events without reopening dismissed notices.

## Requirements

- CodeShell Desktop 0.9.17 or newer is recommended for automatic output-folder restoration and Panel execution without repeat dialogs. The full feature set requires Panel API v14, bundled Node, and `process`, `credentials.cookies`, `agent.task`, `storage`, `context.workspace`, and `external.open` permissions. Older Hosts retain basic downloading; file verification and platform search explain the required update.
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) available on the Desktop app's PATH, or initialize it from the panel.
- `ffmpeg` is recommended for merging video/audio streams and MP3 conversion.
- `curl` is optional and used only to read the official latest yt-dlp release tag.

The deterministic inspection and download path uses only `process`. CodeShell
resolves an executable to an opaque, app-scoped handle, runs it with
`shell: false`, and streams bounded stdout/stderr events back to the Panel. The
first execution of an executable requires Host confirmation. In current Desktop
Hosts, **Allow and remember** keeps that approval across Panel App updates and
Host restarts for the same app and executable. A changed executable still needs
confirmation; older per-version approvals retain their original scope until the
user confirms the new choice.

Panel API v10 authorizes a selected Cookie account as an opaque file-argument
handle bound to the resolved `yt-dlp` executable. CodeShell creates the
owner-only temporary Netscape file only after confirmation and removes it when
the Panel closes. Cookie values and the temporary path never cross the Panel
bridge.

Optional AI repair, error analysis, and AI video discovery use `agent.task`. They show
Provider/model selectors populated from secret-free Host metadata. Task state
and results return to the panel through `agent.task.changed`, so there is no
Session picker or manual binding step. The panel renders a bounded live
activity list for model, plan, tool, and error events; the private Task is
ephemeral and intentionally does not appear as a normal chat Session. The
deterministic setup uses `process.info` and CodeShell's `user-bin` directory,
both introduced in Panel API v9. The Panel exposes six domain tools:

- `inspect_video` sets an optional URL and retrieves video or playlist metadata with local `yt-dlp`.
- `get_video_download_context` reads metadata, configuration, destination, and task status.
- `refresh_video_download_dependencies` re-checks `yt-dlp` and `ffmpeg` after setup.
- The **刷新环境** action performs the same dependency re-check from the panel, then refreshes
  the installed and official `yt-dlp` versions without requiring an AI Task or an app restart.
- `apply_video_download_config` changes format, playlist range, and subtitle settings.
- `start_video_download` explicitly adds the configured download to the queue and starts it when the queue is ready.
- `cancel_video_download` cancels one running download; optional `queueId` selects a specific task.

This still lets an ordinary Session operate the Panel directly when the user
asks in the conversation. Starting a download remains a separate mutating tool.
Inspection and downloading themselves never need a Session or an LLM.

## AI Find Videos

Describe what you want and choose YouTube, Bilibili, or both. Choose a Provider
and text model from CodeShell's configured connections, including external custom
Providers. A bounded tool-free
model task produces search terms. A bounded local search helper reads YouTube's
public search page directly, with `yt-dlp` search as a backup. Bilibili uses
`yt-dlp` search first; if its connection or metadata lookup fails, the helper
looks for canonical video links in Bing's public search index. The index search
tries a shorter query when the planned terms return no matches. Indexed links
are labeled as such: their current platform availability is **not verified**.
The second tool-free model task selects only returned candidate IDs and receives
each candidate's evidence level. The panel never accepts model-generated URLs.
If ranking fails, retrieved candidates remain selectable. Queries sent to the
fallback index contain only the video's search terms, never Cookie values,
private conversation or project files.

Results open their source only when clicked, and enter the download queue only
when explicitly selected. Result downloads use the current quality/subtitle options,
single-video mode and no Cookie; **Preview** brings the link to Download where an
account can be chosen. Cancelling stops the active model task or local search and
ignores late results. Model/API and network availability remain prerequisites;
there is no promise that a platform will expose every video or bypass access limits.
Queries and up to eight verified results per query are retained per project in a
bounded archive. You can view old results, remove individual results or whole
queries, clear the archive, and repeat an earlier search to refresh platform data.
Saved links are labeled historical when reopened. In Chat, `find_videos` starts
the same asynchronous search, `get_video_search_results` reads its progress and
results, and `list_video_search_history` and `delete_video_search_record` manage
the archive. Chat search does not automatically queue or download results.

## Cookie safety

Mimi Download never reads a browser profile or asks the user to paste Cookie
contents. A saved account is matched to the target website by the Host, and the
user must explicitly select and authorize it before `yt-dlp` receives the
temporary file. Choosing **Do not use Cookie** keeps the public-media path
unchanged. Account lookup ignores stale responses, keeps explicit selections
for the same site during this panel session, and maps YouTube/Bilibili short
links to their login sites. Cookie access requires HTTPS. Empty, unavailable,
and failed account lookups are explained separately in the interface; the panel
does not automatically import a system browser profile.

## Install from GitHub

In CodeShell, choose **Extensions → Panel Apps → From GitHub** and enter:

- Repository: `https://github.com/cjhyy/codeshell-panel-apps`
- Branch or tag: `main`
- App subdirectory: `apps/video-download`

Only download media that you have permission to save, and follow the source
website's terms and applicable law.

### Playback and file actions

The history Play button checks the actual file and, on macOS, uses an installed
IINA or VLC first, then Chrome or Edge for MP4/M4V/WebM, falling back to the system
player. This avoids QuickTime silently presenting VP9/Opus downloads as audio only.
The expanded Open action still uses the system default application. No app is
installed and no file association is changed. History actions remain available
during background file checks, show launch feedback, and keep opener failures
separate from missing downloads. Restored task folders use fresh directory grants.
