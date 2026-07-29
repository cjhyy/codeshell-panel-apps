#!/usr/bin/env node
/* Optional repository validation helper bundled as a Panel App asset. */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditDesignPages } from "../audit.mjs";
import { exportDesignSvg, normalizeDesignDocument, serializeDesignDocument } from "../document.mjs";
import { resolveDesignPersistenceSource } from "../document-bundle.mjs";
import { resolveDesignIndexDocument } from "../document-index.mjs";

export function inspectDesignSource(source, path = "design.codesign.json") {
  if (typeof source !== "string") throw new Error(`${path}: source must be UTF-8 text`);
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${path}: invalid JSON`, { cause: error });
  }
  const document = normalizeDesignDocument(parsed);
  const canonical = serializeDesignDocument(document);
  return {
    path,
    document,
    canonical,
    isCanonical: source === canonical,
    issues: auditDesignPages(document),
  };
}

export function decodeDesignSource(bytes, path = "design.codesign.json") {
  if (!(bytes instanceof Uint8Array)) throw new Error(`${path}: source must be bytes`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${path}: source is not valid UTF-8`, { cause: error });
  }
}

export function isDesignPreviewCurrent(document, svgSource) {
  return typeof svgSource === "string" && svgSource === exportDesignSvg(document);
}

export async function readDesignSourcePath(path, { workspaceRoot = process.cwd() } = {}) {
  const primarySource = decodeDesignSource(await readFile(path), path);
  const readText = async (partPath) =>
    decodeDesignSource(await readFile(resolve(workspaceRoot, partPath)), partPath);
  const sha256 = async (source) => createHash("sha256").update(source).digest("hex");
  const indexed = await resolveDesignIndexDocument({
    primarySource,
    readText,
    sha256,
  });
  if (indexed) {
    return {
      ...indexed,
      source: serializeDesignDocument(indexed.document),
      primaryCanonical:
        primarySource === `${JSON.stringify(indexed.manifest, null, 2)}\n`,
    };
  }
  const resolved = await resolveDesignPersistenceSource({
    primarySource,
    readText,
    sha256,
  });
  return {
    ...resolved,
    primaryCanonical:
      resolved.mode === "single" ||
      primarySource === `${JSON.stringify(resolved.manifest, null, 2)}\n`,
  };
}

async function main(arguments_) {
  const strictAudit = arguments_.includes("--strict-audit");
  const checkSvg = arguments_.includes("--check-svg");
  const paths = arguments_.filter(
    (argument) => argument !== "--strict-audit" && argument !== "--check-svg",
  );
  if (paths.length === 0) {
    process.stderr.write(
      "Usage: check-design.mjs [--strict-audit] [--check-svg] <file.codesign.json> [...files]\n",
    );
    return 2;
  }
  let failures = 0;
  for (const path of paths) {
    try {
      const persisted = await readDesignSourcePath(path);
      const inspection = inspectDesignSource(persisted.source, path);
      inspection.isCanonical = inspection.isCanonical && persisted.primaryCanonical;
      const warnings = inspection.issues.filter((issue) => issue.severity === "warning").length;
      const errors = inspection.issues.filter((issue) => issue.severity === "error").length;
      let failed = false;
      if (!inspection.isCanonical) {
        failed = true;
        process.stderr.write(`✗ ${path}: JSON is valid but not in canonical panel format\n`);
      }
      if (errors > 0 || (strictAudit && warnings > 0)) {
        failed = true;
        process.stderr.write(`✗ ${path}: ${errors} audit error(s), ${warnings} audit warning(s)\n`);
      }
      if (checkSvg) {
        if (!path.endsWith(".codesign.json")) {
          throw new Error(`${path}: expected a .codesign.json path for --check-svg`);
        }
        const svgPath = path.replace(/\.codesign\.json$/, ".svg");
        let svgSource;
        try {
          svgSource = decodeDesignSource(await readFile(svgPath), svgPath);
        } catch (error) {
          throw new Error(`${path}: missing sibling SVG preview ${svgPath}`, { cause: error });
        }
        if (!isDesignPreviewCurrent(inspection.document, svgSource)) {
          failed = true;
          process.stderr.write(`✗ ${path}: sibling SVG preview is stale\n`);
        }
      }
      if (failed) {
        failures += 1;
      } else {
        const totalNodeCount = inspection.document.pages.reduce(
          (count, page) => count + page.nodes.length,
          0,
        );
        process.stdout.write(
          `✓ ${path}: ${inspection.document.pages.length} page(s), ${totalNodeCount} layer(s), ${warnings} audit warning(s)${persisted.mode === "indexed" ? ", indexed pages" : persisted.mode === "bundle" ? ", legacy bundle" : ""}${checkSvg ? ", SVG current" : ""}\n`,
        );
      }
      for (const issue of inspection.issues) {
        process.stderr.write(
          `  ${issue.severity}: ${issue.pageId ?? inspection.document.activePageId}/${issue.nodeId}: ${issue.message.replaceAll("\n", " ")}\n`,
        );
      }
    } catch (error) {
      failures += 1;
      process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return failures === 0 ? 0 : 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
