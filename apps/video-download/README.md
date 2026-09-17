# Mimi Download

Mimi Download 0.15 is a local-first CodeShell Panel App for `yt-dlp`. Its primary
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

The Download tab always shows the installed yt-dlp version beside the latest
stable tag from the official GitHub Releases API. Both checks are deterministic
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
also renders the actual download list: a single link shows one item, while a
playlist marks every visible entry as `will download` or `skipped` as its range
changes.

Downloads run through a visible, sequential queue. Adding a task captures its
quality, playlist/subtitle options, output directory, and explicitly authorized
Cookie handle. The form stays editable during downloads, so another URL can be
added without changing earlier tasks. Waiting tasks can be removed; the queue
can pause before the next task; failed or cancelled tasks can be retried. One
failure does not block the following task. The queue and up to 300 history records persist per project in Host storage.
Closing the panel stops active processes; reopening restores pending and interrupted
items without starting them. **Restore queue** reacquires directory and saved-account
grants before continuing. No executable handle, directory grant, Cookie file handle,
Cookie value or process argument list is persisted. If storage fails, new work does
not start and the queue pauses.

Paste up to 100 links at once (including ordinary share text). Canonical video
aliases are deduplicated within the batch and queue. After inspecting a playlist,
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
folder. The chosen path is remembered per project. After reopening, the panel shows
the last choice and asks the user to reselect that same folder to renew its Host
grant before downloading. Older Hosts that do not offer the `project` known directory show a prompt
to choose a directory instead of silently using the system Downloads folder.

Retry keeps the task's original options and account, and asks the Host to
authorize a fresh Cookie file for that saved account. It does not reuse stale
login data or switch silently to the account selected for the next task.

The layout uses the available panel width with left-aligned navigation and
readable controls. Wide panels keep the queue beside the form; narrow panels
stack the queue below the active tab. The primary link form comes before the
environment and version controls.

The interface is split into four compact tabs: **Download** contains setup and
download options, **Task** contains live progress, logs, and error analysis, and
**History** contains download records, and **AI Find Videos** discovers real platform results. Task failures automatically open the
Task tab, while small badges keep dependency, progress, and history state visible
without making the page long.

There is no AI configuration step in the normal download flow. If inspection or
a download fails, the panel reveals an **Analyze error with AI** action. It
starts a short tool-free Task using only sanitized diagnostics, then displays
the answer directly in the panel. It never changes settings, retries, starts a
download, or writes into the current conversation.

## Requirements

- CodeShell Desktop 0.9.16 or newer is recommended. The full feature set requires Panel API v14, bundled Node, and `process`, `credentials.cookies`, `agent.task`, `storage`, `context.workspace`, and `external.open` permissions. Older Hosts retain basic downloading; file verification and platform search explain the required update.
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
- `cancel_video_download` cancels the active download.

This still lets an ordinary Session operate the Panel directly when the user
asks in the conversation. Starting a download remains a separate mutating tool.
Inspection and downloading themselves never need a Session or an LLM.

## AI Find Videos

Describe what you want and choose YouTube, Bilibili, or both. Choose a Provider
and text model from CodeShell's configured connections, including external custom
Providers. A bounded tool-free
model task produces search terms. Local yt-dlp retrieves actual platform candidates
(`ytsearch` / `bilisearch`); Bilibili results without titles receive bounded metadata
lookups. A second tool-free task selects only existing candidate IDs. The panel
always takes title, author and canonical link from the platform result, never from
model-generated URLs. If ranking fails, the real candidates remain selectable.
If a platform fails, its error is shown alongside available results; connection
failures do not become fabricated results. Searches use public metadata and do not
send a Cookie account, private conversation or project files to the model.

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
