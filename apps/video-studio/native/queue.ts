import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mediaAbortError } from "./process-runner.js";

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(mediaAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 150);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/**
 * A cross-process bakery queue. Each contender owns unique files, so reclaiming a dead
 * process never unlinks a new owner's lock. The choosing marker prevents half-written
 * tickets from being skipped. Children remain in the Host's process group.
 */
export async function acquireVoiceQueue(
  root: string,
  signal: AbortSignal,
  waiting: () => Promise<void>,
) {
  if (signal.aborted) throw mediaAbortError();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const identity = `${process.pid}-${randomUUID()}`;
  const choosing = join(root, `${identity}.choosing`);
  const ticketPath = join(root, `${identity}.ticket`);
  const partial = join(root, `${identity}.partial`);
  const release = async () => {
    await Promise.all([choosing, ticketPath, partial].map((path) => rm(path, { force: true })));
  };
  async function peers() {
    const names = await readdir(root);
    if (names.length > 4096) throw new Error("本地声音等待队列过长，请稍后重试");
    const entries = new Map<string, { choosing: boolean; ticket: number }>();
    for (const name of names) {
      const match = /^([1-9]\d*)-([a-f0-9-]{36})\.(choosing|ticket|partial)$/.exec(name);
      if (!match) continue;
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || !alive(pid)) {
        await rm(join(root, name), { force: true });
        continue;
      }
      const id = `${match[1]}-${match[2]}`;
      const entry = entries.get(id) ?? { choosing: false, ticket: 0 };
      if (match[3] === "choosing") entry.choosing = true;
      if (match[3] === "ticket") {
        try {
          const value = await readFile(join(root, name), "utf8");
          if (value.length > 32) throw new Error("invalid ticket");
          entry.ticket = Number(value);
          if (!Number.isSafeInteger(entry.ticket) || entry.ticket < 1)
            throw new Error("invalid ticket");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw new Error("本地声音等待队列需要重试", { cause: error });
        }
      }
      entries.set(id, entry);
    }
    return entries;
  }
  try {
    await writeFile(choosing, "", { flag: "wx", mode: 0o600 });
    const existing = await peers();
    const ticket = Math.max(0, ...Array.from(existing.values(), (entry) => entry.ticket)) + 1;
    if (!Number.isSafeInteger(ticket)) throw new Error("本地声音等待队列需要重试");
    await writeFile(partial, String(ticket), { flag: "wx", mode: 0o600 });
    await rename(partial, ticketPath);
    await rm(choosing);
    let reported = false;
    for (;;) {
      if (signal.aborted) throw mediaAbortError();
      const entries = await peers();
      const blocked = Array.from(entries).some(
        ([id, entry]) =>
          id !== identity &&
          (entry.choosing ||
            (entry.ticket > 0 &&
              (entry.ticket < ticket || (entry.ticket === ticket && id < identity)))),
      );
      if (!blocked) return release;
      if (!reported) {
        await waiting();
        reported = true;
      }
      await pause(signal);
    }
  } catch (error) {
    await release();
    throw error;
  }
}
