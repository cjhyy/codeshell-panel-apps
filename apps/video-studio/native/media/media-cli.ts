import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { combineAbortSignals } from "../signals.js";
import { runMediaRequest, validateMediaRequest } from "./media-runtime.js";
import { resolveMediaConnections } from "./media-connections.js";
import { containsAbsolutePath, redactHomePath } from "./media-executables.js";

async function privateDirectory(root: string, parts: string[]): Promise<string> {
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    await mkdir(path, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("媒体任务目录无效");
  }
  return path;
}
async function sealedConnections() {
  const index = process.argv.indexOf("--connections-file");
  if (index < 0) return { connections: [] };
  const path = process.argv[index + 1];
  if (!path) throw new Error("配音连接配置不可用");
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.size > 2 * 1024 * 1024 ||
      info.nlink !== 1 ||
      (process.platform !== "win32" && info.mode & 0o077)
    )
      throw new Error("配音连接配置不可用");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.readFile("utf8"));
    } catch {
      // Parser errors quote the file; it may hold credentials.
      throw new Error("配音连接配置不可用");
    }
    return resolveMediaConnections(parsed);
  } finally {
    await file.close();
  }
}
/** Called by the installed package launcher. argv only carries opaque request JSON and sealed arguments. */
export async function runCli(raw?: unknown): Promise<void> {
  if (raw === undefined) {
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) {
        process.stdout.write(
          JSON.stringify({ type: "error", message: "媒体请求超过大小限制" }) + "\n",
        );
        process.exitCode = 1;
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      process.stdout.write(JSON.stringify({ type: "error", message: "媒体请求格式无效" }) + "\n");
      process.exitCode = 1;
      return;
    }
  }
  const controller = new AbortController(),
    abort = () => controller.abort();
  process.once("SIGTERM", abort);
  process.once("SIGINT", abort);
  const emit = (value: unknown) => {
    process.stdout.write(JSON.stringify(value) + "\n");
  };
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("媒体请求无效");
    const value = raw as Record<string, unknown>;
    if (
      Object.keys(value).some(
        (key) =>
          !["action", "params", "inputs", "publicConnections", "scopeKey", "jobId"].includes(key),
      )
    )
      throw new Error("媒体请求包含不支持的字段");
    const { scopeKey, jobId, ...input } = value;
    if (
      typeof scopeKey !== "string" ||
      !/^[a-f0-9]{64}$/.test(scopeKey) ||
      typeof jobId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(jobId)
    )
      throw new Error("媒体任务标识无效");
    const request = validateMediaRequest(input);
    const cwd = process.cwd();
    if ((await lstat(cwd)).isSymbolicLink()) throw new Error("媒体数据目录无效");
    const root = await realpath(cwd);
    const sealedDirectory = async (flag: string, fallback: () => Promise<string>) => {
      const index = process.argv.indexOf(flag);
      if (index < 0) return fallback();
      const path = process.argv[index + 1];
      if (!path || (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)))
        throw new Error("媒体运行目录无效");
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("媒体运行目录无效");
      return realpath(path);
    };
    const jobDir = await sealedDirectory("--job-dir", () =>
      privateDirectory(root, ["jobs", scopeKey, jobId]),
    );
    const runtimeDir = await sealedDirectory("--runtime-dir", () =>
      privateDirectory(root, ["runtime", "media"]),
    );
    const config = await sealedConnections();
    const signal = combineAbortSignals([
      controller.signal,
      AbortSignal.timeout(request.action === "tts-setup" ? 45 * 60_000 : 2 * 60 * 60_000),
    ]);
    const result = await runMediaRequest(request, {
      jobDir,
      runtimeDir,
      scopeKey,
      jobId,
      signal,
      ...config,
      reportProgress: async (progress) => emit({ type: "progress", progress }),
    });
    if (signal.aborted) throw new Error("媒体任务已取消");
    emit({ type: "result", result });
  } catch (error) {
    // Keep the concrete reason with home paths shown as ~; any other local path is withheld.
    const reason = error instanceof Error ? redactHomePath(error.message) : "";
    const message = controller.signal.aborted
      ? "媒体任务已取消"
      : reason && reason.length <= 350 && !/https?:/.test(reason) && !containsAbsolutePath(reason)
        ? reason
        : "媒体工具未完成，请检查依赖、素材和任务状态后重试";
    emit({ type: "error", message });
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", abort);
    process.removeListener("SIGINT", abort);
  }
}
export { runMediaRequest, validateMediaRequest } from "./media-runtime.js";
export { resolveMediaConnections } from "./media-connections.js";
