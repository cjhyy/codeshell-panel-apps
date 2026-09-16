import { spawn } from "node:child_process";

export interface MediaProcessProgress {
  fraction?: number;
  stage?: string;
  message?: string;
}

export interface MediaProcessOptions {
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  durationSeconds?: number;
  progressStream?: "stdout" | "stderr";
  onProgress?: (progress: MediaProcessProgress) => void | Promise<void>;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: string) => void;
  maxStdoutBytes?: number;
  /** Produce stdin incrementally. Pending work must observe this signal so cancellation can await cleanup. */
  input?: (signal: AbortSignal) => AsyncIterable<Uint8Array>;
}

export function mediaAbortError(): Error {
  return Object.assign(new Error("Media processing was cancelled"), { name: "AbortError" });
}

/** Execute a local media tool without a shell; the Host owns its descendant process group. */
export async function runMediaProcess(
  executable: string,
  args: readonly string[],
  options: MediaProcessOptions,
): Promise<{ stdout: Buffer; stderr: string }> {
  if (options.signal.aborted) throw mediaAbortError();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      // Keep every descendant in the Host-owned tool process group.
      detached: false,
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    let bytes = 0;
    let stderr = "";
    let progressBuffer = "";
    let lastProgress = 0;
    let failure: Error | undefined;
    let spawnFailure: Error | undefined;
    let pipeFailure: Error | undefined;
    let exited = false;
    let inputFinished = !options.input;
    const inputController = new AbortController();
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let progressWork = Promise.resolve();
    let inputWork = Promise.resolve();
    const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));
    const kill = (signal: NodeJS.Signals) => {
      try {
        child.kill(signal);
      } catch {
        /* The process may have already exited. */
      }
    };
    const stop = () => {
      inputController.abort();
      child.stdin?.destroy();
      if (exited) return;
      kill("SIGTERM");
      killTimer ??= setTimeout(() => kill("SIGKILL"), 1500);
      killTimer.unref();
    };
    const cleanup = () => {
      options.signal.removeEventListener("abort", stop);
      if (killTimer) clearTimeout(killTimer);
    };
    options.signal.addEventListener("abort", stop, { once: true });
    if (options.signal.aborted) stop();
    const consumeProgress = (text: string) => {
      if (options.durationSeconds && options.onProgress) {
        progressBuffer += text;
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = (lines.pop() ?? "").slice(-4096);
        for (const line of lines) {
          const match = /^out_time_us=(\d+)$/.exec(line);
          if (!match || Date.now() - lastProgress < 150) continue;
          lastProgress = Date.now();
          const fraction = Math.min(0.999, Number(match[1]) / 1_000_000 / options.durationSeconds);
          progressWork = progressWork
            .then(async () => {
              await options.onProgress?.({ fraction });
            })
            .catch((error) => {
              failure = error instanceof Error ? error : new Error(String(error));
              stop();
            });
        }
      }
    };
    child.stdout!.on("data", (chunk: Buffer) => {
      try {
        if (options.onStdout) options.onStdout(chunk);
        else {
          bytes += chunk.length;
          if (bytes > (options.maxStdoutBytes ?? 4 * 1024 * 1024)) {
            failure = new Error("Media tool output exceeds its bounded result budget");
            stop();
            return;
          }
          stdout.push(chunk);
        }
        if (options.progressStream !== "stderr") consumeProgress(chunk.toString("utf8"));
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        stop();
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr = (stderr + text).slice(-128 * 1024);
      try {
        options.onStderr?.(text);
        if (options.progressStream === "stderr") consumeProgress(text);
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        stop();
      }
    });
    child.once("error", (error) => {
      spawnFailure = error;
      stop();
    });
    child.once("exit", () => {
      exited = true;
      inputController.abort();
      child.stdin?.destroy();
    });
    // Keep an error listener even after the producer stops: a late EPIPE must never
    // become an unhandled stream error. The process diagnostic takes precedence.
    child.stdin?.on("error", (error) => {
      if (!inputController.signal.aborted) {
        pipeFailure = error;
        stop();
      }
    });
    child.once("close", async (code) => {
      exited = true;
      inputController.abort();
      try {
        await Promise.all([inputWork, progressWork]);
        if (options.signal.aborted) throw mediaAbortError();
        if (spawnFailure) throw spawnFailure;
        if (failure) throw failure;
        if (code !== 0)
          throw new Error(`${executable} exited with code ${code}: ${stderr.slice(-4000)}`);
        if (pipeFailure) throw pipeFailure;
        if (!inputFinished)
          throw new Error(`${executable} exited before all media input was written`);
        resolve({ stdout: Buffer.concat(stdout), stderr });
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    });
    if (options.input) {
      const input = options.input;
      const signal = inputController.signal;
      // Await each write callback. At most one producer chunk is queued in the
      // writable stream, so even an unbounded movie cannot outrun the encoder.
      const write = (chunk?: Uint8Array) =>
        new Promise<void>((accept, decline) => {
          const aborted = () => {
            signal.removeEventListener("abort", aborted);
            decline(mediaAbortError());
          };
          const complete = (error?: Error | null) => {
            signal.removeEventListener("abort", aborted);
            if (error) decline(error);
            else accept();
          };
          signal.addEventListener("abort", aborted, { once: true });
          if (signal.aborted) return aborted();
          try {
            if (chunk) child.stdin!.write(chunk, complete);
            else child.stdin!.end(() => complete());
          } catch (error) {
            complete(asError(error));
          }
        });
      inputWork = (async () => {
        let iterator: AsyncIterator<Uint8Array> | undefined;
        let exhausted = false;
        try {
          if (signal.aborted) return;
          iterator = input(signal)[Symbol.asyncIterator]();
          while (!signal.aborted) {
            const next = await iterator.next();
            if (next.done) {
              exhausted = true;
              break;
            }
            if (signal.aborted) break;
            if (!(next.value instanceof Uint8Array))
              throw new Error("Media input must yield Uint8Array chunks");
            await write(next.value);
          }
          if (!signal.aborted && exhausted) {
            await write();
            inputFinished = true;
          }
        } catch (error) {
          if (!signal.aborted) {
            failure ??= asError(error);
            stop();
          }
        } finally {
          if (iterator && !exhausted) {
            try {
              await iterator.return?.();
            } catch (error) {
              failure ??= asError(error);
              stop();
            }
          }
        }
      })();
    }
  });
}
