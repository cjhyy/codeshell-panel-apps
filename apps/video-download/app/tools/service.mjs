import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { handleServiceRequest } from "./download-runtime.mjs";

export { handleServiceRequest };
const MAX_INPUT_BYTES = 32 * 1024;

// A reviewed native entry. Project authority comes only from the Host-selected
// working directory, never a project, executable path or source in browser JSON.
export async function readServiceInput(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_INPUT_BYTES)
      throw Object.assign(new Error("服务输入超过 32 KiB。"), { code: "INVALID_INPUT" });
    chunks.push(bytes);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw Object.assign(new Error("服务输入不是有效 JSON。"), { code: "INVALID_INPUT" });
  }
}

const direct = process.argv[1] && (await realpath(process.argv[1]).catch(() => null));
if (direct && import.meta.url === pathToFileURL(direct).href) {
  const controller = new AbortController();
  const stop = () =>
    controller.abort(Object.assign(new Error("服务调用已取消。"), { code: "CANCELLED" }));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  let response;
  try {
    if (process.argv.length !== 2)
      throw Object.assign(new Error("服务仅接受 stdin JSON，不接受命令行参数。"), {
        code: "INVALID_ARGUMENT",
      });
    response = await handleServiceRequest(await readServiceInput(process.stdin), {
      signal: controller.signal,
    });
  } catch (error) {
    response = {
      format: "mimi-download.service",
      schemaVersion: 1,
      ok: false,
      error: {
        code: typeof error.code === "string" ? error.code : "OPERATION_FAILED",
        message: error.message,
      },
    };
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
  process.stdout.write(JSON.stringify(response) + "\n");
  if (!response.ok) process.exitCode = 1;
}
