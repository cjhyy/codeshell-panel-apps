# Official GitHub release resolution

Treat `https://github.com/yt-dlp/yt-dlp` as the only authority for the latest
stable yt-dlp version. Resolve the tag from:

```text
https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest
```

Read `tag_name` and the release assets using a web/API tool or a native JSON
reader available on the platform. Do not require Python merely to parse this
response. Do not hardcode the tag observed during Skill authoring.

Compare the resolved GitHub tag with `yt-dlp --version`. A package manager may
report "latest" while still trailing GitHub; package-manager state is not the
version authority.

## Python decision

Probe supported Python before selecting an artifact. The release file named
`yt-dlp` is a platform-independent zipimport executable and still needs Python.
Do not download that file when Python is unavailable.

When a supported Python exists and the current installation is pip/pipx-owned,
update through the same owner, then compare the installed version with the
GitHub tag. If that source is behind, install the exact official GitHub tag
through the same Python environment instead of claiming success.

When Python is unavailable, skip pip, pipx, and the generic `yt-dlp` artifact.
Download an official standalone executable even when a package manager would
otherwise be the normal install route:

| Platform | Architecture/runtime | Asset |
|---|---|---|
| macOS 10.15+ | universal Intel/Apple Silicon | `yt-dlp_macos` |
| Windows 8+ | x86_64 | `yt-dlp.exe` |
| Windows 8+ | x86 32-bit | `yt-dlp_x86.exe` |
| Windows 10+ | ARM64 | `yt-dlp_arm64.exe` |
| Linux glibc 2.17+ | x86_64 | `yt-dlp_linux` |
| Linux glibc 2.17+ | aarch64 | `yt-dlp_linux_aarch64` |
| Linux musl 1.2+ | x86_64 | `yt-dlp_musllinux` |
| Linux musl 1.2+ | aarch64 | `yt-dlp_musllinux_aarch64` |

For an architecture or runtime not represented here, inspect the current
release assets and official release-file table. Do not guess an asset name.

## Safe binary replacement

1. Resolve the exact asset from the same latest release response.
2. Download the asset, `SHA2-256SUMS`, and optionally its signature into a new
   temporary directory. Never overwrite the working executable during the
   download.
3. Verify the downloaded asset's SHA-256 against its exact line in
   `SHA2-256SUMS`. Abort and delete the temporary download on mismatch.
4. On macOS/Linux, add executable permission and run the temporary binary with
   `--version` before replacing the target.
5. Install into an existing user-writable PATH directory. Prefer
   `~/.local/bin`; do not write to a system directory or modify shell startup
   files without explicit approval. If another installation already exists,
   confirm which command wins PATH resolution and replace or remove nothing
   outside the user-writable target without explicit approval.
6. Run the installed executable with `--version` and confirm it matches the
   GitHub `tag_name`.

Official stable download URLs may use
`https://github.com/yt-dlp/yt-dlp/releases/latest/download/<asset>`, but still
resolve and record the tag before downloading so the version comparison and
result remain explicit.
