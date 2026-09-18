import { spawn } from "node:child_process";
import { constants } from "node:fs";
import * as filesystem from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_CHECK_FILES = 200;
const MAX_PATH_BYTES = 4_096;
const MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".webm",
  ".mov",
  ".m4v",
  ".avi",
  ".flv",
  ".mpeg",
  ".mpg",
  ".m2ts",
  ".3gp",
  ".ogv",
  ".wmv",
  ".mp3",
  ".m4a",
  ".aac",
  ".flac",
  ".wav",
  ".ogg",
  ".opus",
  ".aiff",
  ".alac",
  ".wma",
  ".srt",
  ".vtt",
  ".ass",
  ".ssa",
  ".lrc",
  ".ttml",
  ".dfxp",
]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseLibraryRequest(value) {
  if (!object(value) || Object.keys(value).some((key) => !["action", "files"].includes(key))) {
    throw new Error("invalid-request");
  }
  if (!["check", "play", "open", "reveal"].includes(value.action) || !Array.isArray(value.files)) {
    throw new Error("invalid-request");
  }
  if (
    value.files.length > MAX_CHECK_FILES ||
    (value.action !== "check" && value.files.length !== 1)
  ) {
    throw new Error("invalid-file-count");
  }
  const files = value.files.map((file) => {
    if (
      !object(file) ||
      Object.keys(file).some((key) => !["path", "bytes", "modifiedAt"].includes(key))
    ) {
      throw new Error("invalid-file-record");
    }
    if (
      typeof file.path !== "string" ||
      !file.path ||
      Buffer.byteLength(file.path) > MAX_PATH_BYTES
    ) {
      throw new Error("invalid-file-path");
    }
    for (const key of ["bytes", "modifiedAt"]) {
      if (file[key] !== undefined && (!Number.isSafeInteger(file[key]) || file[key] < 0)) {
        throw new Error("invalid-file-metadata");
      }
    }
    return {
      path: file.path,
      ...(file.bytes !== undefined ? { bytes: file.bytes } : {}),
      ...(file.modifiedAt !== undefined ? { modifiedAt: file.modifiedAt } : {}),
    };
  });
  return { action: value.action, files };
}

function unavailable(path, error) {
  return { path, status: "unavailable", error };
}

function inside(root, candidate) {
  const child = relative(root, candidate);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function checkedPath(root, input, authorizedRoot) {
  if (/[\x00-\x1f\x7f]/.test(input) || input.startsWith("//") || input.startsWith("\\\\")) {
    throw new Error("invalid-file-path");
  }
  // Reject URL schemes, drive-relative paths, and alternate data streams. On
  // Windows only an ordinary absolute drive prefix may contain a colon.
  const rest = process.platform === "win32" && /^[a-z]:[\\/]/i.test(input) ? input.slice(2) : input;
  if (rest.includes(":") || (process.platform !== "win32" && input.startsWith("\\"))) {
    throw new Error("invalid-file-path");
  }
  // The Host's authorized cwd may itself have a platform alias (for example
  // /var versus /private/var on macOS). Map only that exact authorized prefix.
  const candidate =
    isAbsolute(input) && inside(authorizedRoot, input)
      ? resolve(root, relative(authorizedRoot, input))
      : resolve(root, input);
  if (!inside(root, candidate)) throw new Error("outside-authorized-directory");
  if (!MEDIA_EXTENSIONS.has(extname(candidate).toLowerCase()))
    throw new Error("unsupported-file-type");
  return candidate;
}

async function checkComponents(root, candidate, fs) {
  let cursor = root;
  const parts = relative(root, candidate).split(sep);
  for (let index = 0; index < parts.length; index++) {
    cursor = resolve(cursor, parts[index]);
    const info = await fs.lstat(cursor);
    // Refuse all symlink components, including links within the directory. This
    // also prevents a missing child of an external link from leaking metadata.
    if (info.isSymbolicLink()) throw new Error("symbolic-link-not-allowed");
    if (index < parts.length - 1 && !info.isDirectory()) throw new Error("not-a-directory");
    if (index === parts.length - 1 && !info.isFile()) throw new Error("not-a-regular-file");
  }
}

async function inspectFile(root, file, fs, authorizedRoot) {
  let handle;
  try {
    const candidate = checkedPath(root, file.path, authorizedRoot);
    await checkComponents(root, candidate, fs);
    const resolved = await fs.realpath(candidate);
    if (!inside(root, resolved)) throw new Error("outside-authorized-directory");
    handle = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("not-a-regular-file");
    // Check the path again after opening; never return metadata from an escape
    // introduced while the request was being checked.
    await checkComponents(root, candidate, fs);
    if ((await fs.realpath(candidate)) !== resolved) throw new Error("file-changed-during-check");
    const current = await fs.lstat(resolved);
    if (
      current.dev !== info.dev ||
      current.ino !== info.ino ||
      current.size !== info.size ||
      current.mtimeMs !== info.mtimeMs
    )
      throw new Error("file-changed-during-check");
    const bytes = info.size;
    const modifiedAt = Math.trunc(info.mtimeMs);
    if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(modifiedAt)) {
      throw new Error("unavailable-file-metadata");
    }
    const changed =
      (file.bytes !== undefined && file.bytes !== bytes) ||
      (file.modifiedAt !== undefined && file.modifiedAt !== modifiedAt);
    return {
      result: {
        path: file.path,
        status: bytes === 0 ? "empty" : changed ? "changed" : "present",
        bytes,
        modifiedAt,
      },
      resolved,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { result: { path: file.path, status: "missing" } };
    const expected = new Set([
      "invalid-file-path",
      "outside-authorized-directory",
      "unsupported-file-type",
      "symbolic-link-not-allowed",
      "not-a-directory",
      "not-a-regular-file",
      "file-changed-during-check",
      "unavailable-file-metadata",
    ]);
    return {
      result: unavailable(
        file.path,
        expected.has(error?.message) ? error.message : "file-unavailable",
      ),
    };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function openCommand(
  action,
  file,
  { platform = process.platform, windowsRoot = process.env.SystemRoot || "C:\\Windows" } = {},
) {
  if (!["open", "reveal"].includes(action)) throw new Error("invalid-open-action");
  const absoluteFile =
    platform === "win32"
      ? /^[a-z]:[\\/]/i.test(file) && !file.slice(2).includes(":")
      : isAbsolute(file) && !file.startsWith("//");
  if (
    typeof file !== "string" ||
    !absoluteFile ||
    /[\x00-\x1f\x7f]/.test(file) ||
    !MEDIA_EXTENSIONS.has(extname(file).toLowerCase())
  ) {
    throw new Error("invalid-file-path");
  }
  if (platform === "darwin")
    return {
      command: "/usr/bin/open",
      args: action === "reveal" ? ["-R", "--", file] : ["--", file],
    };
  if (platform === "linux")
    return { command: "/usr/bin/xdg-open", args: [action === "reveal" ? dirname(file) : file] };
  if (platform === "win32") {
    if (
      !/^[a-z]:[\\/]/i.test(windowsRoot) ||
      windowsRoot.startsWith("\\\\") ||
      /[\x00-\x1f]/.test(windowsRoot)
    ) {
      throw new Error("unsupported-platform-opener");
    }
    return {
      command: win32.join(windowsRoot, "explorer.exe"),
      args: action === "reveal" ? [`/select,${file}`] : [file],
    };
  }
  throw new Error("unsupported-platform-opener");
}

async function launch(command, args, spawnProcess, platform) {
  await new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawnProcess(command, args, { shell: false, stdio: "ignore", windowsHide: true });
    child.once("error", rejectLaunch);
    // macOS open exits once Launch Services accepts the request. Other platform
    // openers may stay alive for the entire application session.
    if (platform !== "darwin")
      child.once("spawn", () => {
        child.unref();
        resolveLaunch();
      });
    child.once("close", (code) => {
      if (code === 0) resolveLaunch();
      else rejectLaunch(new Error("unable-to-open-file"));
    });
  });
}

async function playbackCommand(file, { fs, platform, windowsRoot }) {
  const fallback = {
    ...openCommand("open", file, { platform, windowsRoot }),
    player: "系统播放器",
  };
  if (platform !== "darwin") return fallback;
  // Downloaded MP4s can contain VP9/Opus rather than QuickTime-compatible media.
  // Prefer an existing compatible app; never install apps or change associations.
  const players = [
    ["IINA", "/Applications/IINA.app"],
    ["VLC", "/Applications/VLC.app"],
  ];
  if (/\.(mp4|m4v|webm)$/i.test(file))
    players.push(
      ["Google Chrome", "/Applications/Google Chrome.app"],
      ["Microsoft Edge", "/Applications/Microsoft Edge.app"],
    );
  for (const [player, app] of players) {
    if (
      await fs.stat(app).then(
        (metadata) => metadata.isDirectory(),
        () => false,
      )
    )
      return { command: "/usr/bin/open", args: ["-a", app, "--", file], player };
  }
  return fallback;
}

export async function handleLibraryRequest(
  value,
  {
    cwd = process.cwd(),
    fs = filesystem,
    spawnProcess = spawn,
    platform = process.platform,
    windowsRoot,
  } = {},
) {
  const request = parseLibraryRequest(value);
  let root;
  try {
    root = await fs.realpath(cwd);
    if (!(await fs.stat(root)).isDirectory()) throw new Error("invalid-directory");
  } catch {
    return {
      files: request.files.map((file) =>
        unavailable(file.path, "authorized-directory-unavailable"),
      ),
    };
  }
  const files = [];
  for (const file of request.files) {
    const checked = await inspectFile(root, file, fs, resolve(cwd));
    if (request.action !== "check" && checked.result.status === "present") {
      try {
        const { command, args, player } =
          request.action === "play"
            ? await playbackCommand(checked.resolved, { fs, platform, windowsRoot })
            : openCommand(request.action, checked.resolved, { platform, windowsRoot });
        await launch(command, args, spawnProcess, platform);
        if (player) checked.result.player = player;
      } catch {
        // Opening failure does not mean that a verified download disappeared.
        checked.result.error = "unable-to-open-file";
      }
    }
    files.push(checked.result);
  }
  return { files };
}

export async function readLibraryInput(stream) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) throw new Error("request-too-large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid-json");
  }
}

const directEntry =
  process.argv[1] && (await filesystem.realpath(process.argv[1]).catch(() => null));
if (directEntry && import.meta.url === pathToFileURL(directEntry).href) {
  try {
    const result = await handleLibraryRequest(await readLibraryInput(process.stdin));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const allowed = new Set([
      "request-too-large",
      "invalid-json",
      "invalid-request",
      "invalid-file-count",
      "invalid-file-record",
      "invalid-file-path",
      "invalid-file-metadata",
    ]);
    process.stdout.write(
      `${JSON.stringify({ files: [], error: allowed.has(error?.message) ? error.message : "request-failed" })}\n`,
    );
    process.exitCode = 1;
  }
}
