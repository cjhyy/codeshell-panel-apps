# Download cloud candidate fixture

`node scripts/prepare-download-fixture.mjs /new/fixture/directory` downloads the
official yt-dlp 2026.08.19 Python zipapp and verifies its pinned release SHA-256.
It needs Python 3 in the test project and works on both Linux CPU architectures.
The script refuses an existing output directory. It does not change the Panel's
normal dependency installer or add a downloader to the production Host image.

The cloud candidate copies these verified bytes into its disposable project's
managed executable directory, then uses the installed Panel and its reviewed
native task to download real media from a project-local HTTP fixture. FFmpeg is
provided by the candidate's runtime image. The project remains network-isolated;
the external release is downloaded before project startup.

This verifies dependency discovery, actual download execution, separate client
sessions, logout survival, file playback/download and restart recovery. It does
not verify public video sites, Cookie accounts, the online dependency installer
or a target server deployment. The upstream release is
<https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19>.
