// Saved prototype reads share the CLI's path, symlink and aggregate read budget.
import {
  createPrototype,
  normalizePrototype,
  prototypeDiagnostics,
  prototypePath,
  MAX_PROTOTYPE_BYTES,
} from "../prototype.mjs";
import { isMissingDesignSidecar, readDesignSidecar } from "../design-sidecar.mjs";
import { sha256 } from "./node-project.mjs";

const MAX_DIAGNOSTICS = 100;

/** No repairs or writes: missing primary is distinct from an invalid attachment. */
export async function readSavedPrototype(project, designPath, document) {
  const path = prototypePath(designPath);
  const result = (status, model, diagnostics, revision) => ({
    model,
    diagnostics,
    summary: {
      path,
      status,
      ...(status === "absent" ? { defaulted: true } : {}),
      ...(revision ? { revision } : {}),
      diagnosticCount: diagnostics.length,
      diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
      truncatedDiagnosticCount: Math.max(0, diagnostics.length - MAX_DIAGNOSTICS),
    },
  });
  const invalid = (error, revision) => result("invalid", null, [{
    code: "invalid-sidecar",
    message: String(error?.message ?? "Prototype sidecar could not be read.").slice(0, 1000),
    ...(typeof error?.code === "string" ? { sourceCode: error.code.slice(0, 100) } : {}),
  }], revision);
  let primary;
  try {
    primary = project.read(path, MAX_PROTOTYPE_BYTES);
  } catch (error) {
    if (isMissingDesignSidecar(error))
      return result("absent", createPrototype(document), []);
    return invalid(error);
  }
  try {
    // Reject an oversized declaration before readDesignSidecar requests parts.
    const header = JSON.parse(primary.content);
    if (header?.format === "codeshell.design.sidecar" && header.bytes > MAX_PROTOTYPE_BYTES)
      throw Error("Prototype sidecar exceeds its complete 2 MiB budget.");
    const source = await readDesignSidecar({
      path,
      sha256: async value => sha256(value),
      call: async (_method, params) => params.path === path
        ? primary
        : project.read(params.path, MAX_PROTOTYPE_BYTES),
    });
    if (Buffer.byteLength(source.content) > MAX_PROTOTYPE_BYTES)
      throw Error("Prototype sidecar exceeds its complete 2 MiB budget.");
    const model = normalizePrototype(JSON.parse(source.content));
    const diagnostics = prototypeDiagnostics(model, document);
    return result(diagnostics.length ? "invalid" : "valid", model, diagnostics, primary.revision);
  } catch (error) {
    // The primary exists. Missing/corrupt parts must never become a default.
    return invalid(error, primary.revision);
  }
}
