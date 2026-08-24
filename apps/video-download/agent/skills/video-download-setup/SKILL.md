---
name: video-download-setup
description: Initialize, repair, or update the local yt-dlp and ffmpeg dependencies used by the Mimi Download Panel App. Use when the user clicks the panel's one-click initialization action, asks to initialize or update the downloader, or the panel reports that yt-dlp or ffmpeg is missing, unavailable, outdated, or failing dependency checks. Always resolve the latest stable yt-dlp release from the official GitHub repository, update or install yt-dlp first, use the official standalone binary when Python is unavailable, then update or install ffmpeg.
---

# Mimi Download Setup

Run setup only inside the isolated Task created by `panel-app:video-download`.
This Skill prepares the local runtime for the panel; it does not read the
current conversation and it does not download media.

## Workflow

1. Use `Panel` with `action: "tools"` and
   `panel_id: "panel-app:video-download"`, unless the tool contract is already
   visible.
2. Invoke `get_video_download_context`. Treat its `capabilities` as the panel's
   current observation, not proof that software is absent from every location.
3. Probe the operating system, architecture, libc where applicable,
   installation owner, Python availability, existing package managers, PATH,
   and common installation locations before changing anything. Read
   [references/github-release.md](references/github-release.md) and
   [references/platform-install.md](references/platform-install.md) before an
   install or upgrade.
4. **Always handle `yt-dlp` first.** Resolve the latest stable release tag from
   `https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest`; never hardcode
   a version and never treat PyPI or a third-party package manager as the
   latest-version authority. Compare the installed version with that tag. When
   a supported Python is available, update an existing installation through
   its owner or install the exact GitHub release, then verify that the result
   matches the tag. When no supported Python is available, do not attempt a
   Python package install: select the official standalone asset for the exact
   OS, CPU architecture, and libc, verify it against the Release API asset's
   `sha256:` digest (or `SHA2-256SUMS` for an older Release), make it executable
   where required, and install it into a user-writable PATH directory. Verify
   `yt-dlp --version` before continuing.
5. **Handle `ffmpeg` second.** Preserve a working installation. When it is
   missing on Windows or Linux, prefer the matching SHA-256-verified asset from
   `https://github.com/yt-dlp/FFmpeg-Builds/releases/latest` and place `ffmpeg`
   plus `ffprobe` in CodeShell's Host-managed user bin. On macOS, use an
   existing Homebrew installation. Verify `ffmpeg -version`.
6. Invoke `refresh_video_download_dependencies`, then invoke
   `get_video_download_context` again. Report exactly what is ready, what
   remains unavailable. Do not claim that a restart is required until the
   panel refresh has checked both CodeShell's managed bin and Host-known
   package-manager link directories.

The panel's one-click initialization request is explicit permission to install
or upgrade these two core dependencies with an already installed package
manager. Still honor any approval prompt presented by the host or operating
system. Do not silently bootstrap a new package manager, use `sudo`, or modify
shell startup files; request the smallest missing decision if one of those is
required.

## Boundaries

- Never start a video inspection or download during initialization.
- Never read browser profiles, request Cookie contents, or call credential
  tools during initialization.
- Do not install Node.js, a PO Token provider, a proxy, browser extensions, or
  unrelated codecs as part of the core setup. Recommend them only after a
  specific diagnostic proves they are needed and the user asks to repair it.
- Never skip the yt-dlp update because only ffmpeg was reported missing. The
  fixed order is yt-dlp first, ffmpeg second, panel refresh last.
- When Python is available, prefer the existing installation owner. When it is
  unavailable, the official standalone release rule takes precedence. Avoid
  leaving duplicate pip, pipx, Homebrew, winget, and standalone commands with
  ambiguous PATH precedence.
- Do not claim that the panel sees a dependency until
  `refresh_video_download_dependencies` confirms it.
- If installation succeeds but the panel still cannot resolve the executable,
  rerun the panel refresh first. Recommend a restart only for a third-party
  package manager that installed outside both CodeShell's managed bin and the
  Host-known executable directories.
