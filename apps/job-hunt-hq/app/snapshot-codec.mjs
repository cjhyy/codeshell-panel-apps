import {
  collectResumeRecords,
  normalizeResumeRecord,
  resumeRecordId,
  selectBaseResume,
} from "./resume-model.mjs";
import {
  compactProjectSnapshotPayload,
  hydrateProjectSnapshotDocuments,
  prepareProjectSnapshotDocuments,
  projectSnapshotShardDescriptors,
} from "./snapshot-sharding-model.mjs";
import { writeProjectSnapshotDocuments } from "./snapshot-storage.mjs";

const ROOT = "job-hunt-panel.json";
const FIELDS = [
  "selectedJobId",
  "selectedInterviewSetId",
  "selectedBaseResumeId",
  "discoveryPreferences",
  "channelVerifications",
  "customProviders",
  "jdIntakeItems",
  "jobLeads",
  "discoveryRunReceipts",
  "discoveryReceiptCutoff",
  "profile",
  "jobs",
  "repos",
  "experiences",
  "jobResearch",
  "workflowRuns",
  "resume",
  "versions",
  "questionBank",
  "interviewSets",
  "mockInterviewSessions",
  "preparationPlans",
  "interviewDebriefs",
];
const OBJECT_FIELDS = new Set(["profile", "resume", "discoveryPreferences"]);
const TEXT_FIELDS = new Set([
  "selectedJobId",
  "selectedInterviewSetId",
  "selectedBaseResumeId",
  "discoveryReceiptCutoff",
]);
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function validateSnapshotShape(snapshot) {
  const invalid = (field) => {
    throw Object.assign(new Error(`项目快照字段格式无效：${field}`), { code: "INVALID_SNAPSHOT" });
  };
  if (!plainObject(snapshot) || ![1, 2].includes(snapshot.schemaVersion)) invalid("schemaVersion");
  // Check before defaults/normalization: corrupt values must never become empty writable data.
  // Older snapshots may omit fields added later, so only present fields are checked.
  for (const field of FIELDS) {
    if (!Object.hasOwn(snapshot, field)) continue;
    const value = snapshot[field];
    if (OBJECT_FIELDS.has(field)) {
      if (!plainObject(value)) invalid(field);
    } else if (TEXT_FIELDS.has(field)) {
      if (typeof value !== "string") invalid(field);
    } else if (!Array.isArray(value) || value.some((item) => !plainObject(item))) invalid(field);
  }
  for (const [key, value] of Object.entries(snapshot.profile || {})) {
    if (typeof value !== "string") invalid(`profile.${key}`);
  }
  for (const [index, record] of [snapshot.resume, ...(snapshot.versions || [])].entries()) {
    if (!record) continue;
    for (const field of [
      "id",
      "versionId",
      "parentVersionId",
      "revisionReason",
      "kind",
      "category",
      "baseResumeId",
      "jobId",
      "title",
      "markdown",
      "updatedAt",
      "source",
      "sessionId",
    ]) {
      if (Object.hasOwn(record, field) && typeof record[field] !== "string")
        invalid(`resume[${index}].${field}`);
    }
    for (const field of ["claimEvidence", "candidateQuestions", "variantChanges", "pdfExports"]) {
      if (
        Object.hasOwn(record, field) &&
        (!Array.isArray(record[field]) || record[field].some((item) => !plainObject(item)))
      )
        invalid(`resume[${index}].${field}`);
    }
    if (Object.hasOwn(record, "style") && !plainObject(record.style))
      invalid(`resume[${index}].style`);
    if (
      Object.hasOwn(record, "notes") &&
      (!Array.isArray(record.notes) || record.notes.some((item) => typeof item !== "string"))
    )
      invalid(`resume[${index}].notes`);
  }
}

/** Blank durable data only: never initialize a real project with preview facts. */
export function emptyProjectSnapshot() {
  return {
    schemaVersion: 2,
    selectedJobId: "",
    selectedInterviewSetId: "",
    selectedBaseResumeId: "",
    discoveryPreferences: {
      keyword: "",
      location: "",
      seniority: "不限",
      count: 8,
      providers: ["boss", "linkedin", "official"],
      freshnessDays: 7,
      workMode: "any",
      exclusions: "",
      lastRunAt: "",
    },
    channelVerifications: [],
    customProviders: [],
    jdIntakeItems: [],
    jobLeads: [],
    discoveryRunReceipts: [],
    discoveryReceiptCutoff: "",
    profile: {
      name: "等待 Agent 识别",
      role: "当前项目",
      contact: "",
      target: "",
      summary: "",
      photoDataUrl: "",
      photoName: "",
    },
    jobs: [],
    repos: [],
    experiences: [],
    jobResearch: [],
    workflowRuns: [],
    resume: normalizeResumeRecord(
      {
        parentVersionId: "",
        revisionReason: "",
        kind: "base",
        category: "",
        baseResumeId: "",
        jobId: "",
        pdfExports: [],
        title: "",
        markdown: "",
        claimEvidence: [],
        candidateQuestions: [],
        notes: [],
        updatedAt: "",
      },
      { profileRole: "当前项目" },
    ),
    versions: [],
    questionBank: [],
    interviewSets: [],
    mockInterviewSessions: [],
    preparationPlans: [],
    interviewDebriefs: [],
  };
}

export function projectSnapshotPayload(source, { now = new Date().toISOString() } = {}) {
  const defaults = emptyProjectSnapshot();
  const payload = {
    ...(source.snapshotRestoreId ? { snapshotRestoreId: source.snapshotRestoreId } : {}),
    schemaVersion: 2,
    updatedAt: now,
  };
  for (const field of FIELDS) payload[field] = structuredClone(source[field] ?? defaults[field]);
  const resumeOptions = {
    profileTarget: payload.profile?.target,
    profileRole: payload.profile?.role,
  };
  payload.resume = normalizeResumeRecord(payload.resume, resumeOptions);
  payload.versions = payload.versions.map((record) => normalizeResumeRecord(record, resumeOptions));
  return compactProjectSnapshotPayload(payload);
}

export function hydrate(rootText, shards = new Map()) {
  const root = typeof rootText === "string" ? JSON.parse(rootText) : rootText;
  validateSnapshotShape(root);
  const snapshot = hydrateProjectSnapshotDocuments(root, shards);
  validateSnapshotShape(snapshot);
  delete snapshot.artifactStorage;
  const hydrated = { ...emptyProjectSnapshot(), ...snapshot };
  const resumeOptions = {
    profileTarget: hydrated.profile?.target,
    profileRole: hydrated.profile?.role,
  };
  hydrated.resume = normalizeResumeRecord(hydrated.resume, resumeOptions);
  hydrated.versions = (hydrated.versions || []).map((record) =>
    normalizeResumeRecord(record, resumeOptions),
  );
  const selectedBase = selectBaseResume(
    collectResumeRecords(hydrated.resume, hydrated.versions, resumeOptions),
    hydrated.selectedBaseResumeId,
  );
  hydrated.selectedBaseResumeId = selectedBase ? resumeRecordId(selectedBase) : "";
  return hydrated;
}

export async function readProjectSnapshot(scope) {
  scope.check();
  const previousSnapshot = await scope.call("workspace.readText", { path: ROOT });
  const root = JSON.parse(previousSnapshot.content);
  const shards = new Map();
  for (const descriptor of projectSnapshotShardDescriptors(root)) {
    scope.check();
    const document = await scope.call("workspace.readText", { path: descriptor.path });
    shards.set(descriptor.path, JSON.parse(document.content));
  }
  scope.check();
  return { snapshot: hydrate(root, shards), previousSnapshot };
}

/** A conflict replays the pure operation against a fresh read, never a stale payload. */
export async function applyOp(
  scope,
  op,
  args,
  ctx,
  { maxConflictRetries = 1, prepareOptions } = {},
) {
  const apply = async () => {
    for (let attempt = 0; ; attempt += 1) {
      const { snapshot: before, previousSnapshot } = await readProjectSnapshot(scope);
      const { snapshot, result } = op.run(before, args, ctx);
      if (!op.mutates) return { snapshot, result };
      const payload = projectSnapshotPayload(snapshot, { now: ctx.now });
      const prepared = prepareProjectSnapshotDocuments(
        payload,
        emptyProjectSnapshot(),
        prepareOptions,
      );
      try {
        const writeResult = await writeProjectSnapshotDocuments(prepared, {
          scope,
          previousSnapshot,
        });
        return { snapshot: payload, result: { ...result, projectSaved: true }, writeResult };
      } catch (error) {
        if (error?.code !== "REVISION_CONFLICT" || attempt >= maxConflictRetries) throw error;
      }
    }
  };
  return op.mutates && scope.withWriteLock ? scope.withWriteLock(apply) : apply();
}
