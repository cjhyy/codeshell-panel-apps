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

/** Resolve an explicit path or a command name to a canonical executable file, if one is installed. */
export async function findExecutable(name: string, explicit?: string): Promise<string | undefined> {
  const choices = explicit
    ? [explicit]
    : executableSearchDirectories().map((dir) =>
        join(dir, process.platform === "win32" ? `${name}.exe` : name),
      );
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
  return message.replace(new RegExp(`${escaped}(?=[\\\\/'"\`\\s:,;)]|$)`, "g"), "~");
}
