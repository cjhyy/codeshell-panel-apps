#!/usr/bin/env node
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { incrementCount } from "../counter.mjs";

const invalid = (message) => Object.assign(new Error(message), { code: "INVALID_ARGUMENT" });
const operations = [
  { name: "context", readOnly: true, description: "Read the selected local project directory." },
  {
    name: "counter", readOnly: true,
    description: "Evaluate the same counter operation used by the panel. No state is saved.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["value"],
      properties: {
        value: { type: "integer", minimum: 0 },
        amount: { type: "integer", minimum: 0, default: 1 },
      },
    },
  },
];

async function readInput(path) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    if (!(await handle.stat()).isFile()) throw invalid("input-file must be a regular file");
    const bytes = Buffer.alloc(16 * 1024 + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 16 * 1024) throw invalid("input-file exceeds 16 KiB");
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
    } catch {
      throw invalid("input-file must contain UTF-8 JSON");
    }
  } finally {
    await handle.close();
  }
}

export async function main(argv, { cwd = process.cwd() } = {}) {
  const [command, ...args] = argv;
  if (!["ops", "context", "counter"].includes(command))
    throw invalid("Usage: starter.mjs ops | context [--project dir] | counter --input-file request.json");
  const allowed = command === "context" ? ["--project"] : command === "counter" ? ["--input-file"] : [];
  const options = {};
  while (args.length) {
    const name = args.shift(), value = args.shift();
    if (!allowed.includes(name) || Object.hasOwn(options, name) || !value || value.startsWith("--"))
      throw invalid(`Invalid option: ${name ?? ""}`);
    options[name] = value;
  }
  if (command === "ops") return { ok: true, result: { operations } };
  if (command === "context") {
    const root = await realpath(resolve(cwd, options["--project"] || "."));
    if (!(await stat(root)).isDirectory()) throw invalid("project must be a directory");
    return { ok: true, result: { root, runtime: "node", persistence: "none" } };
  }
  if (!options["--input-file"]) throw invalid("counter requires --input-file");
  const input = await readInput(resolve(cwd, options["--input-file"]));
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["value", "amount"].includes(key)))
    throw invalid("counter input must be an object containing value and optional amount");
  return { ok: true, result: { value: incrementCount(input.value, input.amount) } };
}

const direct = process.argv[1] && await realpath(process.argv[1]).catch(() => null);
if (direct && pathToFileURL(direct).href === import.meta.url) {
  try {
    process.stdout.write(`${JSON.stringify(await main(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: {
      code: error.code || "OPERATION_FAILED", message: error.message,
    } })}\n`);
    process.exitCode = error.code === "INVALID_ARGUMENT" ? 2 : 1;
  }
}
