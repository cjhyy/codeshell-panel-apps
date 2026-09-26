import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createPortableDesign, planPortableDesign, restorePortableDesign } from "../apps/design-studio/app/portable-backup.mjs";
import { planDesignBackup } from "../apps/design-studio/app/legacy-backup.mjs";
import { captureDesignOperationState, createDesignOperationRecord } from "../apps/design-studio/app/operation-log.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../apps/design-studio/app/document.mjs";
import { createDesignResourcePersistencePlan } from "../apps/design-studio/app/resource-store.mjs";
if (process.argv.length !== 3) throw Error("Usage: node scripts/design-studio-portable-host.mjs <built-server-package-directory>");
const serverRoot = resolve(process.argv[2]);
assert.equal(JSON.parse(await readFile(join(serverRoot, "package.json"), "utf8")).name, "@cjhyy/code-shell-server");
const { PanelRuntimeServices } = await import(pathToFileURL(join(serverRoot, "dist/panels/runtime-services.js")).href);
const hash = async value => createHash("sha256").update(value).digest("hex");
const root = await mkdtemp(join(tmpdir(), "design-portable-host-"));
try {
  const source = join(root, "source"), target = join(root, "target"), dataDir = join(root, "data");
  await mkdir(source); await mkdir(target);
  let authorized = true;
  const scope = cwd => ({ appId: "design-studio", cwd, projectPath: cwd,
    permissions: ["context.workspace", "workspace.info", "workspace.read", "workspace.write", "storage"],
    isAuthorized: async () => authorized });
  const runtime = new PanelRuntimeServices({ dataDir });
  const resource = await createDesignResourcePersistencePlan({ id: "pixel", kind: "image", mime: "image/png",
    base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", sha256Bytes: hash });
  for (const part of resource.parts) await runtime.call(scope(source), "workspace.writeText", { path: part.path, content: part.content, expectedModifiedAt: null });
  const document = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "Portable host fixture", canvas: { width: 800, height: 600, background: "#ffffff" }, tokens: { colors: [] }, resources: [resource.descriptor], activePageId: "page-1", pages: [{ id: "page-1", name: "One", children: [] }, { id: "page-2", name: "Two", children: [] }] });
  const text = await createPortableDesign({ document, source: { workspaceRoot: source, path: null, sessionId: "fixture" }, readText: path => runtime.call(scope(source), "workspace.readText", { path }), sha256Bytes: hash });
  const plan = await planPortableDesign(text, { sha256: hash, sha256Bytes: hash });
  const path = "designs/restored.codesign.json";
  await restorePortableDesign({ plan, path, call: (method, params) => runtime.call(scope(target), method, params), check() {} });
  const originalPath = "designs/original.codesign.json";
  await runtime.call(scope(source), "workspace.writeText", { path: originalPath, content: serializeDesignDocument(document), expectedModifiedAt: null });
  const original = await runtime.call(scope(source), "workspace.readText", { path: originalPath });
  const changed = structuredClone(document); changed.name = "Recovered journal title";
  const legacy = { format: "codeshell.design.recovery", version: 1, workspaceRoot: source,
    path: originalPath, baseDocument: null, baseRevision: original.revision, baseModifiedAt: original.modifiedAt,
    record: createDesignOperationRecord(captureDesignOperationState(document), captureDesignOperationState(changed)) };
  const legacyPlan = await planDesignBackup({ kind: "legacy", value: legacy }, { sha256: hash, sha256Bytes: hash,
    readText: path => runtime.call(scope(source), "workspace.readText", { path }) });
  assert.equal(legacyPlan.name, changed.name);
  const saveAsPlan = await planDesignBackup({ kind: "legacy", value: { ...legacy, version: 2,
    path: "designs/not-created-yet.codesign.json", basePath: originalPath } }, { sha256: hash, sha256Bytes: hash,
    readText: path => runtime.call(scope(source), "workspace.readText", { path }) });
  assert.equal(saveAsPlan.primarySource, legacyPlan.primarySource);
  await restorePortableDesign({ plan: legacyPlan, path: "designs/legacy.codesign.json", call: (method, params) => runtime.call(scope(target), method, params), check() {} });
  // Remove the original project to prove the restored file has no source dependency.
  await rm(source, { recursive: true });
  const reopened = new PanelRuntimeServices({ dataDir });
  const read = path => reopened.call(scope(target), "workspace.readText", { path });
  assert.equal((await read("designs/legacy.codesign.json")).content, legacyPlan.primarySource);
  assert.equal((await read(path)).content, plan.primarySource);
  for (const part of plan.parts) assert.equal((await read(part.path)).content, part.content);
  await restorePortableDesign({ plan, path, call: (method, params) => reopened.call(scope(target), method, params), check() {} });
  await assert.rejects(restorePortableDesign({ plan: { ...plan, primarySource: "different" }, path, call: (method, params) => reopened.call(scope(target), method, params), check() {} }), /冲突/);
  assert.equal((await read(path)).content, plan.primarySource);
  authorized = false;
  await assert.rejects(restorePortableDesign({ plan, path: "designs/revoked.codesign.json", call: (method, params) => reopened.call(scope(target), method, params), check() {} }));
  console.log("PASS: actual Node Host complete and legacy design backups, exact baseline revision, save-as v2, independent target resources, source removal, restart, safe retry, collision preservation and revoked access");
} finally { await rm(root, { recursive: true, force: true }); }
