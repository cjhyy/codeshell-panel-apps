#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, compactHistoryBridgeSummary } from "./initialize-a-share-history.mjs";

export async function runHistoryBatch(request, { root, ...dependencies } = {}) {
  if (!request || Object.keys(request).some((key) => !["scope", "source", "maxItems", "repair", "jobId", "scopeKey", "libraryId"].includes(key)) || !root) throw new Error("HISTORY_BATCH_INPUT_INVALID");
  const maxItems = request.maxItems ?? 20;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20) throw new Error("HISTORY_BATCH_LIMIT_INVALID");
  const argv = ["--stdout", "--scope", request.scope ?? "core", "--source", request.source ?? "tencent-ifzq", "--max-items", String(maxItems)];
  if (request.repair === true) argv.push("--repair");
  if (request.libraryId != null) argv.push("--library-id", request.libraryId);
  const result = await runCli(argv, { ...dependencies, root, stdout: () => {}, progress: dependencies.progress ?? (() => {}) });
  return { ...compactHistoryBridgeSummary(result), batchLimit: maxItems };
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--data-dir") throw new Error("HISTORY_AUTHORIZED_DIRECTORY_REQUIRED");
  let input = "";
  for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 8192) throw new Error("HISTORY_INPUT_TOO_LARGE"); }
  const request = JSON.parse(input);
  const result = await runHistoryBatch(request, { root: resolve(args[1]) });
  process.stdout.write(`${JSON.stringify({ type: "result", result })}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
