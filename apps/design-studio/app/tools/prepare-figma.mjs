#!/usr/bin/env node
/* Prepare a local Figma source for workspace.readText without opening a Panel. */
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, open, realpath, rmdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeFigmaSource, MAX_FIGMA_SOURCE_BYTES } from "../figma-assets.mjs";
import { normalizeHtml2FigmaJson } from "../figma-bridge.mjs";
import { isSafeDesignPath } from "../document.mjs";
import { createDesignSidecarPlan, DESIGN_SIDECAR_PART_BYTES } from "../design-sidecar.mjs";

export const HOST_READ_TEXT_BYTES = 480 * 1024;
const digest = (content) => createHash("sha256").update(content).digest("hex");
const fail = (code, message) => Object.assign(new Error(message), { code });
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

async function readBounded(stream, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw fail("INPUT_TOO_LARGE", `Input exceeds ${limit} bytes.`);
    chunks.push(buffer);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw fail("INVALID_UTF8", "Input must be valid UTF-8 text.");
  }
}

async function readSource(path) {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw fail("INVALID_INPUT", "Input must be a regular local file.");
    if (stat.size > MAX_FIGMA_SOURCE_BYTES)
      throw fail("INPUT_TOO_LARGE", "Figma input exceeds 16 MiB.");
    return await readBounded(handle.createReadStream({ autoClose: false }), MAX_FIGMA_SOURCE_BYTES);
  } finally {
    await handle.close();
  }
}

function validateSource(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw fail(
      "INVALID_JSON",
      "Input is not complete Figma JSON; binary .fig files are unsupported.",
    );
  }
  if (
    parsed?.truncated === true ||
    parsed?.content?.truncated === true ||
    parsed?.data?.truncated === true
  )
    throw fail("INCOMPLETE_SOURCE", "Input is marked truncated; provide the complete source file.");
  // LinkAction saves an explicit result envelope. Unwrap only this known Figma
  // transport shape, preserving every field of the original official response.
  if (parsed?.kind === "action_result") {
    if (parsed.provider !== "figma" || !object(parsed.data) || parsed.error)
      throw fail("INVALID_SOURCE", "Expected a successful Figma LinkAction result.");
    parsed = parsed.data;
    source = JSON.stringify(parsed);
  }
  let normalized;
  try {
    normalized = normalizeFigmaSource(normalizeHtml2FigmaJson(source));
  } catch (error) {
    throw fail("INVALID_SOURCE", error.message);
  }
  let nodeCount = 0;
  const inspect = (node) => {
    if (typeof node.id !== "string" || !node.id || typeof node.type !== "string" || !node.type)
      throw fail("INVALID_SOURCE", "Every Figma node must have an id and type.");
    if (["DOCUMENT", "CANVAS"].includes(node.type) && !Array.isArray(node.children))
      throw fail(
        "INCOMPLETE_SOURCE",
        "Figma documents and pages must include their children arrays.",
      );
    nodeCount += 1;
    for (const child of node.children ?? []) inspect(child);
  };
  for (const entry of Object.values(normalized.nodes)) inspect(entry.document);
  return { source, nodeCount, rootCount: Object.keys(normalized.nodes).length };
}

function validateRequest(request) {
  if (
    !object(request) ||
    Object.keys(request).some((key) => !["input", "output", "project"].includes(key))
  )
    throw fail("INVALID_ARGUMENT", "Expected an object with input, output and optional project.");
  for (const key of ["input", "output", "project"]) {
    const value = request[key];
    if (key === "project" && value === undefined) continue;
    if (
      typeof value !== "string" ||
      !value ||
      value.length > 4096 ||
      /[\u0000-\u001f\u007f]/u.test(value)
    )
      throw fail("INVALID_ARGUMENT", `${key} must be a nonempty local path.`);
  }
  const output = request.output;
  if (
    !output.endsWith(".figma-source.json") ||
    !isSafeDesignPath(output.replace(/\.figma-source\.json$/u, ".codesign.json"))
  )
    throw fail(
      "UNSAFE_OUTPUT",
      "Output must be a portable relative designs/*.figma-source.json path.",
    );
}

// Every output ancestor must be a real directory below the canonical project.
// Never follow a preexisting symlink, even when it points back into the project.
async function inspectParents(project, path, create = false) {
  let current = project;
  for (const segment of path.split("/").slice(0, -1)) {
    current = join(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (!create) return;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      stat = await lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw fail("UNSAFE_OUTPUT", `Output ancestor is not a real directory: ${current}`);
  }
}

async function existingPart(project, part) {
  await inspectParents(project, part.path);
  const target = join(project, part.path);
  let handle;
  try {
    // O_NOFOLLOW also rejects dangling symlinks. Comparing bytes, not just the
    // path's digest, prevents reusing a damaged immutable content-addressed part.
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== part.bytes)
      throw fail("PART_CONFLICT", `Existing chunk conflicts with source: ${part.path}`);
    const content = await readBounded(
      handle.createReadStream({ autoClose: false }),
      DESIGN_SIDECAR_PART_BYTES,
    );
    if (content !== part.content || digest(content) !== part.sha256)
      throw fail("PART_CONFLICT", `Existing chunk conflicts with source: ${part.path}`);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    if (["ELOOP", "EMLINK"].includes(error.code))
      throw fail("UNSAFE_OUTPUT", `Chunk must not be a symlink: ${part.path}`);
    throw error;
  } finally {
    await handle?.close();
  }
}

async function requireAbsent(project, path) {
  await inspectParents(project, path);
  try {
    await lstat(join(project, path));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw fail("OUTPUT_EXISTS", `Output already exists; choose a new basename: ${path}`);
}

async function publishFile(project, path, content) {
  await inspectParents(project, path, true);
  const parent = dirname(join(project, path));
  const temporary = await mkdtemp(join(parent, ".prepare-figma-"));
  const staged = join(temporary, "source");
  try {
    const handle = await open(staged, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await inspectParents(project, path);
    // A hard link publishes the complete staged file atomically and fails if a
    // competing writer created the destination. rename would overwrite it.
    await link(staged, join(project, path));
  } finally {
    // Only these two private staging paths are removed; existing project files
    // and already-published immutable chunks are never deleted on failure.
    await unlink(staged).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rmdir(temporary);
  }
}

export async function prepareFigmaInput(request, { stdin = process.stdin } = {}) {
  validateRequest(request);
  const project = await realpath(resolve(request.project ?? process.cwd()));
  if (!(await lstat(project)).isDirectory())
    throw fail("INVALID_PROJECT", "Project must be a directory.");
  await requireAbsent(project, request.output);
  const inputPath =
    request.input === "-"
      ? null
      : isAbsolute(request.input)
        ? request.input
        : resolve(project, request.input);
  const raw = inputPath
    ? await readSource(inputPath)
    : await readBounded(stdin, MAX_FIGMA_SOURCE_BYTES);
  const { source, nodeCount, rootCount } = validateSource(raw);
  const plan = await createDesignSidecarPlan(source, { sha256: async (text) => digest(text) });
  if (
    Buffer.byteLength(plan.primarySource) > HOST_READ_TEXT_BYTES ||
    plan.parts.some((part) => part.bytes > DESIGN_SIDECAR_PART_BYTES)
  )
    throw fail("OUTPUT_TOO_LARGE", "Prepared files exceed the workspace text budget.");
  // Check every known collision before creating any file or directory.
  for (const part of plan.parts) await existingPart(project, part);
  await requireAbsent(project, request.output);
  let createdPartCount = 0;
  let reusedPartCount = 0;
  for (const part of plan.parts) {
    if (await existingPart(project, part)) {
      reusedPartCount += 1;
      continue;
    }
    try {
      await publishFile(project, part.path, part.content);
      createdPartCount += 1;
    } catch (error) {
      if (error.code !== "EEXIST" || !(await existingPart(project, part))) throw error;
      reusedPartCount += 1;
    }
  }
  try {
    await publishFile(project, request.output, plan.primarySource);
  } catch (error) {
    if (error.code === "EEXIST")
      throw fail("OUTPUT_EXISTS", "Output was created concurrently; existing file was preserved.");
    throw error;
  }
  return {
    ok: true,
    version: 1,
    projectRoot: project,
    inputPath,
    outputPath: request.output,
    mode: plan.parts.length ? "sidecar" : "single",
    bytes: Buffer.byteLength(source),
    sha256: digest(source),
    nodeCount,
    rootCount,
    partCount: plan.parts.length,
    createdPartCount,
    reusedPartCount,
    hostReadTextBytes: HOST_READ_TEXT_BYTES,
    partBytes: DESIGN_SIDECAR_PART_BYTES,
  };
}

async function main(args) {
  try {
    let request;
    if (!args.length) {
      const text = await readBounded(process.stdin, 64 * 1024);
      try {
        request = JSON.parse(text);
      } catch {
        throw fail("INVALID_JSON", "Stdin must contain one JSON request.");
      }
      validateRequest(request);
      if (request.input === "-")
        throw fail("INVALID_ARGUMENT", "JSON request mode requires an input file path.");
    } else {
      request = {};
      for (let index = 0; index < args.length; index += 2) {
        const key = args[index]?.replace(/^--/u, "");
        if (
          !["input", "output", "project"].includes(key) ||
          !args[index].startsWith("--") ||
          request[key] !== undefined ||
          !args[index + 1] ||
          args[index + 1].startsWith("--")
        )
          throw fail(
            "INVALID_ARGUMENT",
            "Usage: prepare-figma.mjs --input <file|-> --output designs/<name>.figma-source.json [--project <directory>]",
          );
        request[key] = args[index + 1];
      }
    }
    process.stdout.write(`${JSON.stringify(await prepareFigmaInput(request))}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { code: error.code ?? "PREPARE_FAILED", message: error.message } })}\n`,
    );
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2));
