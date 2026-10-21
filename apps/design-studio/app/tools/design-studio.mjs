#!/usr/bin/env node
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditDesignPages, summarizeAudit } from "../audit.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
  exportDesignSvg,
  isSafeDesignPath,
} from "../document.mjs";
import {
  MAX_WORKSPACE_DESIGN_TEXT_BYTES,
  resolveDesignPersistenceSource,
} from "../document-bundle.mjs";
import {
  createDesignIndexPersistencePlan,
  resolveDesignIndexDocument,
  serializeDesignIndexManifest,
} from "../document-index.mjs";
import { resolveDesignResource } from "../resource-store.mjs";
import { exportDesignFrontend } from "../frontend-export.mjs";
import { parseProductBrief, isSafeProductBriefPath } from "../product-brief.mjs";
import { compareDesignDocuments } from "../design-compare.mjs";
import {
  createNodeProject,
  fail,
  isPortableProjectPath,
  MAX_INPUT_BYTES,
  readTextFile,
  sha256,
} from "./node-project.mjs";

export const MAX_RESULT_BYTES = 1024 * 1024;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = { type: "string", minLength: 1, maxLength: 512 };
const designPath = {
  ...text,
  description: "Portable project-relative designs/*.codesign.json path.",
};
const pageId = { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" };
const revision = {
  type: "string",
  pattern: "^[0-9a-f]{64}$",
  description: "Exact primary-file SHA-256 returned by inspect/read.",
};
const schema = (properties, required) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const documentSchema = {
  type: "object",
  description:
    "Complete CodeShell Design v3 repository document; nested page.children. The shared document codec validates every field and reference.",
  required: ["format", "version", "name", "canvas", "tokens", "activePageId", "pages"],
};
export const operations = [
  {
    name: "inspect",
    readOnly: true,
    description: "Read saved revision, page catalog and document metadata.",
    inputSchema: schema({ path: designPath }, ["path"]),
  },
  {
    name: "read",
    readOnly: true,
    description: "Read a saved document, page or node subtree; stdout is bounded to 1 MiB.",
    inputSchema: schema(
      {
        path: designPath,
        page_id: pageId,
        node_id: { ...text, maxLength: 160 },
        max_depth: { type: "integer", minimum: 0, maximum: 32 },
      },
      ["path"],
    ),
  },
  {
    name: "validate",
    readOnly: true,
    description: "Audit every saved page with the Panel's document codec and audit rules.",
    inputSchema: schema({ path: designPath }, ["path"]),
  },
  ...["svg", "frontend"].map((name) => ({
    name,
    readOnly: false,
    description:
      "Render one saved page. Output, when supplied, is create-only; otherwise content is returned in JSON.",
    inputSchema: schema(
      {
        path: designPath,
        page_id: pageId,
        output: {
          ...text,
          description: `New designs/ artifact ending in ${name === "svg" ? ".svg" : ".html"}.`,
        },
      },
      ["path"],
    ),
  })),
  {
    name: "brief",
    readOnly: true,
    description:
      "Parse a project-local Markdown, MDX or text PRD. A leading [id:req-name] preserves an authored requirement ID; unannotated requirements keep legacy positional IDs.",
    inputSchema: schema({ path: text }, ["path"]),
  },
  {
    name: "compare",
    readOnly: true,
    description:
      "Compare two saved Design v3 pages by geometry and styles; does not compute pixel similarity.",
    inputSchema: schema(
      { path: designPath, actual_path: designPath, page_id: pageId, actual_page_id: pageId },
      ["path", "actual_path"],
    ),
  },
  {
    name: "create",
    readOnly: false,
    description:
      "Create a missing design from a complete v3 document. Existing files are preserved.",
    inputSchema: schema({ path: designPath, document: documentSchema }, ["path", "document"]),
  },
  {
    name: "edit",
    readOnly: false,
    description:
      "Save a complete edited v3 document with exact primary-file revision CAS. Preserves companion files and verifies resources.",
    inputSchema: schema(
      { path: designPath, expected_revision: revision, document: documentSchema },
      ["path", "expected_revision", "document"],
    ),
  },
];

function validateInput(operation, input) {
  if (!object(input)) throw fail("INVALID_ARGUMENT", "Input must be one JSON object.");
  const { properties, required } = operation.inputSchema;
  for (const key of Object.keys(input))
    if (!Object.hasOwn(properties, key))
      throw fail("INVALID_ARGUMENT", `Unknown argument: ${key}.`);
  for (const key of required)
    if (!Object.hasOwn(input, key)) throw fail("INVALID_ARGUMENT", `Missing argument: ${key}.`);
  for (const [key, value] of Object.entries(input)) {
    const rule = properties[key];
    if (
      rule.type === "string" &&
      (typeof value !== "string" ||
        value.length < (rule.minLength ?? 0) ||
        value.length > (rule.maxLength ?? Infinity) ||
        (rule.pattern && !new RegExp(rule.pattern, "u").test(value)))
    )
      throw fail("INVALID_ARGUMENT", `Invalid ${key}.`);
    if (
      rule.type === "integer" &&
      (!Number.isInteger(value) || value < rule.minimum || value > rule.maximum)
    )
      throw fail("INVALID_ARGUMENT", `Invalid ${key}.`);
    if (rule.type === "object" && !object(value)) throw fail("INVALID_ARGUMENT", `Invalid ${key}.`);
  }
  if (operation.name !== "brief" && !isSafeDesignPath(input.path))
    throw fail("UNSAFE_PATH", "Design path must be a portable designs/*.codesign.json path.");
  if (input.actual_path !== undefined && !isSafeDesignPath(input.actual_path))
    throw fail("UNSAFE_PATH", "actual_path must be a portable designs/*.codesign.json path.");
  if (
    input.output !== undefined &&
    (!isPortableProjectPath(input.output) ||
      !input.output.startsWith("designs/") ||
      input.output.startsWith("designs/codesign-data/") ||
      !input.output.endsWith(operation.name === "svg" ? ".svg" : ".html"))
  )
    throw fail(
      "UNSAFE_PATH",
      "Output must be a new designs/ artifact with the required extension.",
    );
  if (operation.name === "brief" && !isSafeProductBriefPath(input.path))
    throw fail("UNSAFE_PATH", "Brief must be a portable project-relative .md, .mdx or .txt path.");
  if (input.max_depth !== undefined && input.node_id === undefined)
    throw fail("INVALID_ARGUMENT", "max_depth requires node_id.");
}

async function resourcesFor(project, document) {
  const resources = new Map();
  // Sequential reads keep the aggregate project-read budget and failures clear.
  for (const descriptor of document.resources ?? []) {
    const resource = await resolveDesignResource({
      descriptor,
      readText: async (path) => project.read(path, MAX_WORKSPACE_DESIGN_TEXT_BYTES).content,
      sha256Bytes: async (bytes) => sha256(bytes),
    });
    resources.set(descriptor.id, resource.dataUrl);
  }
  return resources;
}

async function loadDesign(project, path) {
  const primary = project.read(path);
  const readText = async (partPath) =>
    project.read(partPath, MAX_WORKSPACE_DESIGN_TEXT_BYTES).content;
  const indexed = await resolveDesignIndexDocument({
    primarySource: primary.content,
    readText,
    sha256: async (value) => sha256(value),
  });
  const persisted =
    indexed ??
    (await resolveDesignPersistenceSource({
      primarySource: primary.content,
      readText,
      sha256: async (value) => sha256(value),
    }));
  const source = indexed ? serializeDesignDocument(indexed.document) : persisted.source;
  if (Buffer.byteLength(source) > MAX_INPUT_BYTES)
    throw fail(
      "INPUT_TOO_LARGE",
      "Logical design exceeds the CLI's 16 MiB budget; use the Panel's bounded page tools.",
    );
  const document = normalizeDesignDocument(JSON.parse(source));
  const canonical = serializeDesignDocument(document);
  const primaryCanonical = indexed
    ? primary.content === serializeDesignIndexManifest(indexed.manifest)
    : persisted.mode === "bundle"
      ? primary.content === `${JSON.stringify(persisted.manifest, null, 2)}\n`
      : primary.content === canonical;
  return {
    path,
    document,
    primary,
    mode: persisted.mode,
    manifest: indexed?.manifest,
    canonical: primaryCanonical && source === canonical,
    resourceDataUrls: await resourcesFor(project, document),
  };
}

function catalog(saved) {
  const { document, primary, mode, path } = saved;
  return {
    path,
    revision: primary.revision,
    bytes: primary.bytes,
    storageMode: mode,
    name: document.name,
    canvas: document.canvas,
    tokens: document.tokens,
    resources: document.resources,
    activePageId: document.activePageId,
    pages: document.pages.map((page) => ({
      id: page.id,
      name: page.name,
      nodeCount: page.nodes.length,
    })),
    nodeCount: document.pages.reduce((count, page) => count + page.nodes.length, 0),
  };
}

function readContext(saved, input) {
  const repository = JSON.parse(serializeDesignDocument(saved.document));
  let page = input.page_id ? repository.pages.find((item) => item.id === input.page_id) : null;
  if (input.page_id && !page) throw fail("INVALID_ARGUMENT", `Page not found: ${input.page_id}.`);
  if (!input.node_id)
    return {
      revision: saved.primary.revision,
      path: saved.path,
      ...(page ? { page } : { document: repository }),
    };
  const find = (nodes) => {
    for (const node of nodes) {
      if (node.id === input.node_id) return node;
      const match = find(node.children ?? []);
      if (match) return match;
    }
    return null;
  };
  let node;
  for (const candidate of page ? [page] : repository.pages) {
    node = find(candidate.children);
    if (node) {
      page = candidate;
      break;
    }
  }
  if (!node)
    throw fail("INVALID_ARGUMENT", `Node not found in the requested scope: ${input.node_id}.`);
  const prune = (value, depth) => {
    if (!value.children?.length) return value;
    if (depth === 0) return { ...value, children: [], descendantsTruncated: true };
    return { ...value, children: value.children.map((child) => prune(child, depth - 1)) };
  };
  return {
    path: saved.path,
    revision: saved.primary.revision,
    pageId: page.id,
    pageName: page.name,
    node: prune(node, input.max_depth ?? 32),
  };
}

async function saveDesign(project, name, input) {
  return project.withWriteLock(async () => {
    let previous = null;
    if (name === "edit") {
      previous = await loadDesign(project, input.path);
      if (previous.primary.revision !== input.expected_revision)
        throw fail(
          "REVISION_CONFLICT",
          "Saved design changed. Read the current revision and preserve both edits.",
        );
    } else {
      try {
        project.read(input.path);
        throw fail(
          "REVISION_CONFLICT",
          "Design already exists; inspect it and use edit with its revision.",
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    let document;
    try {
      document = normalizeDesignDocument(input.document);
    } catch (error) {
      throw fail("INVALID_DESIGN", error.message);
    }
    const source = serializeDesignDocument(document);
    if (Buffer.byteLength(source) > MAX_INPUT_BYTES)
      throw fail("INPUT_TOO_LARGE", "Canonical design exceeds 16 MiB.");
    // Do not publish a descriptor that points to absent or unverified resource bytes.
    await resourcesFor(project, document);
    let mode = "single",
      primarySource = source,
      parts = [];
    if (
      previous?.mode === "indexed" ||
      Buffer.byteLength(source) > MAX_WORKSPACE_DESIGN_TEXT_BYTES
    ) {
      const plan = await createDesignIndexPersistencePlan({
        document,
        sha256: async (value) => sha256(value),
      });
      ({ mode, primarySource, parts } = plan);
    }
    if (Buffer.byteLength(primarySource) > MAX_WORKSPACE_DESIGN_TEXT_BYTES)
      throw fail(
        "INPUT_TOO_LARGE",
        "Design index exceeds the Host's text budget; reduce the page catalog.",
      );
    // Check all immutable collisions before publishing anything.
    const missing = [];
    for (const part of parts) {
      try {
        if (project.read(part.path, MAX_WORKSPACE_DESIGN_TEXT_BYTES).content !== part.content)
          throw fail("CONTENT_CONFLICT", `Immutable page object differs: ${part.path}.`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        missing.push(part);
      }
    }
    for (const part of missing) await project.write(part.path, part.content, null);
    const receipt = await project.write(
      input.path,
      primarySource,
      name === "edit" ? input.expected_revision : null,
    );
    return {
      ...receipt,
      storageMode: mode,
      createdPartCount: missing.length,
      reusedPartCount: parts.length - missing.length,
      audit: summarizeAudit(auditDesignPages(document)),
    };
  });
}

export async function runOperation(project, name, input) {
  const operation = operations.find((item) => item.name === name);
  if (!operation) throw fail("INVALID_ARGUMENT", `Unsupported operation: ${name}. Use ops.`);
  validateInput(operation, input);
  if (["create", "edit"].includes(name)) return saveDesign(project, name, input);
  if (name === "brief")
    return parseProductBrief(project.read(input.path, 512 * 1024).content, { path: input.path });
  const saved = await loadDesign(project, input.path);
  if (name === "inspect") return catalog(saved);
  if (name === "read") return readContext(saved, input);
  if (name === "validate") {
    const issues = auditDesignPages(saved.document);
    return {
      path: input.path,
      revision: saved.primary.revision,
      canonical: saved.canonical,
      ...summarizeAudit(issues),
      issues: issues.slice(0, 400),
      truncatedIssueCount: Math.max(0, issues.length - 400),
    };
  }
  if (name === "compare") {
    const actual = await loadDesign(project, input.actual_path);
    const comparison = compareDesignDocuments(saved.document, actual.document, {
      expectedPageId: input.page_id,
      actualPageId: input.actual_page_id,
    });
    return {
      path: input.path,
      revision: saved.primary.revision,
      actualPath: input.actual_path,
      actualRevision: actual.primary.revision,
      ...comparison,
      missing: comparison.missing.slice(0, 400),
      unexpected: comparison.unexpected.slice(0, 400),
      differences: comparison.differences.slice(0, 400),
      truncatedRecordCount:
        Math.max(0, comparison.missing.length - 400) +
        Math.max(0, comparison.unexpected.length - 400) +
        Math.max(0, comparison.differences.length - 400),
    };
  }
  const page = saved.document.pages.find(
    (item) => item.id === (input.page_id ?? saved.document.activePageId),
  );
  if (!page) throw fail("INVALID_ARGUMENT", "Page does not exist.");
  const document = { ...saved.document, activePageId: page.id, nodes: page.nodes };
  const content =
    name === "svg"
      ? exportDesignSvg(document, {
          resourceDataUrls: saved.resourceDataUrls,
          maxBytes: 4 * 1024 * 1024,
        })
      : exportDesignFrontend(document, {
          pageId: page.id,
          resourceDataUrls: saved.resourceDataUrls,
        });
  const provenance = { path: input.path, revision: saved.primary.revision, pageId: page.id };
  if (!input.output) return { ...provenance, content, bytes: Buffer.byteLength(content) };
  const receipt = await project.withWriteLock(() => project.write(input.output, content, null));
  return { ...provenance, output: receipt };
}

function parse(argv) {
  if (argv.length === 1 && argv[0] === "ops") return { command: "ops" };
  const [command, name, ...rest] = argv;
  if (command !== "run" || !name || name.startsWith("--"))
    throw fail(
      "INVALID_ARGUMENT",
      "Usage: design-studio.mjs ops | run <operation> --input-file request.json [--project directory]",
    );
  const options = {};
  while (rest.length) {
    const flag = rest.shift(),
      value = rest.shift();
    if (
      !["--input-file", "--project"].includes(flag) ||
      !value ||
      value.startsWith("--") ||
      Object.hasOwn(options, flag)
    )
      throw fail("INVALID_ARGUMENT", `Invalid option: ${flag}.`);
    options[flag] = value;
  }
  if (!options["--input-file"]) throw fail("INVALID_ARGUMENT", "run requires --input-file.");
  return { command, name, options };
}

export async function main(argv, { cwd = process.cwd() } = {}) {
  const parsed = parse(argv);
  if (parsed.command === "ops") return { ok: true, result: operations };
  let input;
  try {
    input = JSON.parse(readTextFile(resolve(cwd, parsed.options["--input-file"])).content);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw fail("INVALID_ARGUMENT", "input-file is not valid JSON.");
    throw error;
  }
  const project = createNodeProject(resolve(cwd, parsed.options["--project"] ?? "."));
  const result = await runOperation(project, parsed.name, input);
  const response = { ok: true, result };
  if (Buffer.byteLength(JSON.stringify(response)) > MAX_RESULT_BYTES)
    throw fail(
      "RESULT_TOO_LARGE",
      "Result exceeds 1 MiB. Read a page/node with max_depth, or render to a new output artifact.",
    );
  return response;
}

async function isMain() {
  if (!process.argv[1]) return false;
  try {
    return (await realpath(process.argv[1])) === (await realpath(fileURLToPath(import.meta.url)));
  } catch {
    return false;
  }
}
if (await isMain()) {
  try {
    process.stdout.write(`${JSON.stringify(await main(process.argv.slice(2)))}\n`);
  } catch (error) {
    const code = (
      typeof error?.code === "string"
        ? error.code
        : error instanceof SyntaxError
          ? "INVALID_DESIGN"
          : "OPERATION_FAILED"
    ).slice(0, 100);
    // Validation errors can include a caller-controlled field name. Keep the
    // failure envelope bounded too, even when that name fills the input budget.
    const message = String(error?.message || error).slice(0, 4096);
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
    process.exitCode =
      code === "INVALID_ARGUMENT" || code === "INVALID_DESIGN"
        ? 2
        : code === "REVISION_CONFLICT"
          ? 3
          : 1;
  }
}
