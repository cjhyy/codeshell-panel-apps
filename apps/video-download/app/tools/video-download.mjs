import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { cliError } from "./cli-store.mjs";
import { main } from "./download-runtime.mjs";

// Stable public import path and a thin executable adapter. All domain work is
// shared with the reviewed stdin service; workers launch this installed file.
export {
  main,
  findCliExecutable,
  runTaskOperation,
  handleServiceRequest,
} from "./download-runtime.mjs";
const clean = (value, limit = 500) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, limit) : "";

const direct = process.argv[1] && (await realpath(process.argv[1]).catch(() => null));
if (direct && import.meta.url === pathToFileURL(direct).href) {
  const controller = new AbortController(),
    stop = () => controller.abort(cliError("CANCELLED", "CLI 已收到停止请求。"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const response = await main(process.argv.slice(2), {
      signal: controller.signal,
      onProgress: (progress) =>
        process.stderr.write(JSON.stringify({ type: "progress", progress }) + "\n"),
    });
    process.stdout.write(JSON.stringify(response) + "\n");
    if (["failed", "cancelled", "interrupted"].includes(response.result?.status))
      process.exitCode = 1;
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: {
          code: error.code || "OPERATION_FAILED",
          message: clean(error.message),
          ...(error.jobId ? { jobId: error.jobId } : {}),
        },
      }) + "\n",
    );
    process.exitCode = ["INVALID_ARGUMENT", "INVALID_INPUT", "INVALID_JOB"].includes(error.code)
      ? 2
      : 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
