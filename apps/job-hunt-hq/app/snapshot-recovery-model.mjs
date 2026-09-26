const RESTORE_ID = /^g-[0-9a-f]{32}$/;

export function snapshotRestoreId(source, strict = false) {
  const id = source?.snapshotRestoreId;
  if (id === undefined || id === "") return "";
  if (typeof id === "string" && RESTORE_ID.test(id)) return id;
  if (strict) throw new Error("项目恢复标识无效，已停止自动恢复草稿");
  return null;
}

// A root replacement and the Host/browser draft stores are not one transaction.
// The marker committed WITH the root makes stale drafts in either store inert,
// even if the process exits before any cache acknowledgement arrives.
export function selectSnapshotLocalState(root, cached = {}, browserDrafts = []) {
  const id = snapshotRestoreId(root, true);
  const same = source => snapshotRestoreId(source) === id;
  const retired = [];
  const local = same(cached) ? structuredClone(cached || {}) : { localStateVersion: 2 };
  if (!same(cached)) retired.push(cached);
  for (const source of browserDrafts.filter(Boolean)) {
    if (!same(source)) { retired.push(source); continue; }
    for (const field of ["resumeDraft", "interviewDraft"]) {
      if (source[field] && (!local[field] ||
          String(source[field].updatedAt || "") > String(local[field].updatedAt || ""))) {
        local[field] = structuredClone(source[field]);
      }
    }
  }
  local.snapshotRestoreId = id;
  return { local, retired: retired.filter(source =>
    source?.resumeDraft?.markdown || source?.interviewDraft?.answer) };
}
