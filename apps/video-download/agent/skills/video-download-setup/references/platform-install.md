# Platform installation reference

Use these routes only after probing existing commands, their installation
owners, and common locations. Run version checks again after every mutation.
The GitHub release and no-Python decisions in
[github-release.md](github-release.md) take precedence over the package-manager
examples below.

The execution order is non-negotiable:

1. Update an existing yt-dlp or install it when missing, then verify it.
2. Update an existing ffmpeg or install it when missing, then verify it.
3. Ask the panel to refresh its dependency handles.

Do not combine both packages into one command when that would make their order
or individual result unclear.

## Common probe

Check `yt-dlp --version` and `ffmpeg -version`. Also inspect:

- macOS: `/opt/homebrew/bin`, `/usr/local/bin`, and the active login-shell PATH;
- Linux: `~/.local/bin`, `/usr/local/bin`, `/usr/bin`, and `pipx list`;
- Windows: `where.exe`, winget package state, and the current user PATH;
- Python fallback: `python3 -m yt_dlp --version` or
  `py -m yt_dlp --version`.

A Python module without a PATH-visible `yt-dlp` executable is not sufficient
for the panel. Prefer repairing the existing pipx or package-manager install
instead of creating a wrapper manually.

## macOS

When Homebrew already owns yt-dlp, run `brew upgrade yt-dlp`. When yt-dlp is
missing, run:

```bash
brew install yt-dlp
```

Verify yt-dlp, then run `brew upgrade ffmpeg` when Homebrew already owns
ffmpeg, or install it when missing:

```bash
brew install ffmpeg
```

On Apple Silicon, confirm `/opt/homebrew/bin` is part of the login-shell PATH;
on Intel, confirm `/usr/local/bin`.

Do not install Homebrew silently. If no supported package manager exists, offer
the official Homebrew route or a user-scoped yt-dlp fallback, and explain that
ffmpeg still needs a trusted package source.

## Windows

When winget already owns yt-dlp, run `winget upgrade --id yt-dlp.yt-dlp
--exact`. When it is missing, run:

```powershell
winget install --id yt-dlp.yt-dlp --exact
```

Verify yt-dlp, then update an existing ffmpeg with `winget upgrade --id
Gyan.FFmpeg --exact`, or install it when missing:

```powershell
winget install --id Gyan.FFmpeg --exact
```

Confirm both commands are visible from a newly opened shell. A CodeShell
restart may be needed after PATH changes.

## Linux

Update yt-dlp first through its detected installation owner. Prefer pipx for a
current yt-dlp because distribution packages are often stale. Use `pipx
upgrade yt-dlp` when it already owns the command, or install it when missing:

```bash
pipx upgrade yt-dlp
pipx install yt-dlp
```

Verify yt-dlp before touching ffmpeg. Then update or install ffmpeg with only
the command appropriate to the detected distribution, such as `apt install
--only-upgrade ffmpeg` / `apt install ffmpeg`, `dnf upgrade ffmpeg` / `dnf
install ffmpeg`, or `pacman -S ffmpeg`. Do not run a privileged command without
the host/user approval required for that system.

## Verification

Verify:

```bash
yt-dlp --version
ffmpeg -version
```

Use the panel tool `refresh_video_download_dependencies` only after both
ordered update/install steps and their version checks finish. Shell success
alone does not prove the running desktop process can resolve the binaries.
