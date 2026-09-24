import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

/** A macOS app started from Finder often lacks the shell PATH, so also search common install locations. */
export function executableSearchDirectories(): string[] {
  return [
    ...new Set(
      [
        ...(process.env.PATH ?? "").split(delimiter),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        join(homedir(), ".local/bin"),
      ].filter(isAbsolute),
    ),
  ];
}

/** Resolve an explicit path or a command name to a canonical executable file, if one is installed.
 * `directories` defaults to the shared search list; tests inject their own for hermetic lookups. */
export async function findExecutable(
  name: string,
  explicit?: string,
  directories: readonly string[] = executableSearchDirectories(),
): Promise<string | undefined> {
  const choices = explicit
    ? [explicit]
    : directories.map((dir) => join(dir, process.platform === "win32" ? `${name}.exe` : name));
  for (const path of choices) {
    try {
      await access(path, constants.X_OK);
      if ((await stat(path)).isFile()) return await realpath(path);
    } catch {
      /* Try next installed path. */
    }
  }
  return undefined;
}

/** Show paths under the user's home directory as `~` instead of discarding the message. */
export function redactHomePath(message: string): string {
  const home = homedir().replace(/[\\/]+$/, "");
  if (!home) return message;
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A following filename character means another path, e.g. /Users/name2 or /Users/name.bak;
  // a sentence-ending "." is still punctuation.
  return message.replace(new RegExp(`${escaped}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_-])`, "g"), "~");
}

/** True when an absolute local path remains after home redaction (`~/...` is allowed). */
export function containsAbsolutePath(message: string): boolean {
  return /(?:^|[\s'"`(\[<=:：，,])\/[^\s/]|[A-Za-z]:\\/.test(message);
}
