import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { designBackupCandidates, planDesignBackup } from "../../../apps/design-studio/app/legacy-backup.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { captureDesignOperationState, createDesignOperationRecord } from "../../../apps/design-studio/app/operation-log.mjs";
import { createRecoveryPersistencePlan } from "../../../apps/design-studio/app/recovery-store.mjs";
import { createDesignIndexPersistencePlan } from "../../../apps/design-studio/app/document-index.mjs";
const hash = async value => createHash("sha256").update(value).digest("hex");
const source = { workspaceRoot: "/original", path: "designs/source.codesign.json", sourceContext: { sessionId: "old-session" } };
const options = { sha256: hash, sha256Bytes: hash, readText: async () => { throw Error("missing baseline or resource"); } };
function fixture() {
  const base = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "Original", canvas: { width: 800, height: 600, background: "#ffffff" }, tokens: { colors: [] }, resources: [], activePageId: "page-1", pages: [{ id: "page-1", name: "One", children: [] }, { id: "page-2", name: "Two", children: [] }] });
  const next = structuredClone(base); next.name = "Recovered title"; next.pages[1].name = "Edited page";
  const record = createDesignOperationRecord(captureDesignOperationState(base), captureDesignOperationState(next));
  return { base, next, recovery: { format: "codeshell.design.recovery", version: 1, ...source, baseDocument: base, baseRevision: null, baseModifiedAt: null, record } };
}
const candidate = value => ({ kind: "legacy", value });
test("legacy backup selection preserves malformed candidates and can recover a selected embedded baseline without file writes", async () => {
  const f = fixture(), raw = JSON.stringify({ format: "codeshell.design.recovery-backup", version: 1, drafts: [{ broken: true }, f.recovery], storedRecovery: { value: { broken: "stored" } } });
  const choices = designBackupCandidates(raw); assert.equal(choices.length, 3);
  await assert.rejects(planDesignBackup(choices[0], options));
  const plan = await planDesignBackup(choices[1], options);
  assert.equal(plan.legacy, true); assert.equal(plan.name, f.next.name);
  assert.equal(JSON.parse(plan.primarySource).pages[1].name, "Edited page");
  assert.equal(plan.source.sessionId, "old-session");
  assert.equal(JSON.stringify({ format: "codeshell.design.recovery-backup", version: 1, drafts: [{ broken: true }, f.recovery], storedRecovery: { value: { broken: "stored" } } }), raw);
});
test("external and indexed baselines require the exact recorded content revision", async () => {
  const f = fixture();
  for (const indexed of [false, true]) {
    const persistence = indexed ? await createDesignIndexPersistencePlan({ document: f.base, sha256: hash }) : { primarySource: serializeDesignDocument(f.base), parts: [] };
    const files = new Map(persistence.parts.map(p => [p.path, p.content])); files.set(source.path, persistence.primarySource);
    const recovery = { ...f.recovery, baseDocument: null, baseModifiedAt: 12, baseRevision: `sha256:${await hash(persistence.primarySource)}` };
    const readText = async path => ({ content: files.get(path), modifiedAt: 12 });
    const plan = await planDesignBackup(candidate(recovery), { ...options, readText });
    assert.equal(plan.name, f.next.name);
    files.set(source.path, persistence.primarySource + " ");
    await assert.rejects(planDesignBackup(candidate(recovery), { ...options, readText }), /基础设计已变化/);
    await assert.rejects(planDesignBackup(candidate({ ...recovery, baseRevision: null }), { ...options, readText }), /没有可校验/);
  }
});
test("split recovery logs are verified before replay; modified parts are rejected", async () => {
  const f = fixture(), split = await createRecoveryPersistencePlan({ snapshot: f.recovery, sha256: hash, inlineByteLimit: 1 });
  const files = new Map(split.parts.map(p => [p.path, p.content])), readText = async path => files.get(path);
  assert.equal((await planDesignBackup(candidate(split.value), { ...options, readText })).name, f.next.name);
  files.set(split.parts[0].path, "changed");
  await assert.rejects(planDesignBackup(candidate(split.value), { ...options, readText }), /校验失败/);
});
test("unknown, unsafe and mismatched operations cannot silently change the reconstructed document", async () => {
  const f = fixture();
  for (const op of [{ type: "unknown" }, { type: "set-document", field: "__proto__", before: null, after: { polluted: true } }, { type: "set-document", field: "name", before: "wrong baseline", after: "replacement" }, { type: "remove-node", pageId: "page-1", index: 0, node: { id: "missing" } }]) {
    await assert.rejects(planDesignBackup(candidate({ ...f.recovery, record: { version: 1, operations: [op] } }), options));
  }
  assert.equal({}.polluted, undefined);
});
test("generated add, remove and reorder page journals keep every intended change", async () => {
  const f = fixture(), next = structuredClone(f.base);
  next.pages.reverse();
  next.pages.push({ id: "page-3", name: "New page", nodes: [], nodeCount: 0 });
  const record = createDesignOperationRecord(captureDesignOperationState(f.base), captureDesignOperationState(next));
  const plan = await planDesignBackup(candidate({ ...f.recovery, record }), options);
  assert.deepEqual(JSON.parse(plan.primarySource).pages.map(p => p.id), ["page-2", "page-1", "page-3"]);
  next.pages = [next.pages[1]];
  const removed = createDesignOperationRecord(captureDesignOperationState(f.base), captureDesignOperationState(next));
  const removedPlan = await planDesignBackup(candidate({ ...f.recovery, record: removed }), options);
  assert.deepEqual(JSON.parse(removedPlan.primarySource).pages.map(p => p.id), ["page-1"]);
});
