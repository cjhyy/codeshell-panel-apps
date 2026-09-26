export const MAX_DRAFT_BACKUP_BYTES = 8 * 1024 * 1024;
const plain = value => value && typeof value === "object" && !Array.isArray(value);
const field = (value, max, name) => {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > max) throw new Error(`${name}格式或长度不受支持`);
  return value;
};
function drafts(value) {
  if (!plain(value)) throw new Error("缺少草稿内容");
  const resume = value.resumeDraft ?? {}, interview = value.interviewDraft ?? {};
  if (!plain(resume) || !plain(interview)) throw new Error("草稿结构不受支持");
  return {
    resumeDraft: {
      markdown: field(resume.markdown, 50000, "简历正文"),
      resumeVersionId: field(resume.resumeVersionId, 100, "简历版本"),
      parentVersionId: field(resume.parentVersionId, 100, "简历父版本"),
      updatedAt: field(resume.updatedAt, 80, "简历时间"),
    },
    interviewDraft: {
      answer: field(interview.answer, 6000, "面试回答"),
      questionId: field(interview.questionId, 100, "题目编号"),
      practiceSessionId: field(interview.practiceSessionId, 100, "练习编号"),
      inputMode: ["typed", "voice", "mixed"].includes(interview.inputMode) ? interview.inputMode : "typed",
      updatedAt: field(interview.updatedAt, 80, "回答时间"),
    },
  };
}

// Parse only text drafts. Never import arbitrary state, project paths, task IDs,
// profile claims, or executable content from a backup into the live model.
export function parseDraftBackup(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_DRAFT_BACKUP_BYTES)
    throw new Error("草稿备份超过 8 MB，请选择原始草稿文件");
  const value = JSON.parse(text);
  if (!plain(value)) throw new Error("草稿备份必须是 JSON 对象");
  const candidates = [], issues = [];
  let count = 0;
  const add = (value, label, cwd = "", owner = "") => {
    if (++count > 128) throw new Error("草稿记录超过 128 项，请拆分后导入");
    try {
      const selected = drafts(value);
      if (!selected.resumeDraft.markdown && !selected.interviewDraft.answer) return;
      candidates.push({ id: String(count), label, cwd: field(cwd, 4096, "来源项目"),
        owner: /^[a-f0-9]{32}$/.test(owner) ? owner : "", drafts: selected });
    } catch (error) { issues.push(`${label}：${error.message}`); }
  };
  const raw = (bytes, label, cwd = "") => {
    try {
      const parsed = JSON.parse(bytes);
      if (parsed?.version === 2 && parsed.drafts) add(parsed.drafts, parsed.archived ? `${label}（恢复前归档）` : label, cwd, parsed.owner);
      else add(parsed, label, cwd);
    } catch (error) { issues.push(`${label}：无法读取 JSON（${error.message.slice(0, 120)}）`); }
  };
  if (value.format === "codeshell.job-hunt.draft-backup") {
    if (value.version !== 1) throw new Error("不支持此草稿备份版本");
    if (value.current) add(value.current.drafts, "备份时的当前输入", value.current.cwd, value.current.owner);
    if (value.detached != null && (!Array.isArray(value.detached) || value.detached.length > 128))
      throw new Error("旧项目草稿列表不受支持");
    for (const [index, entry] of (value.detached ?? []).entries())
      add(entry?.drafts, `旧项目输入 ${index + 1}`, entry?.cwd, entry?.owner);
    if (value.stored?.hostState) add(value.stored.hostState, "已读取的项目草稿", value.current?.cwd, value.stored.owner);
    if (value.stored?.records != null && (!Array.isArray(value.stored.records) || value.stored.records.length > 128))
      throw new Error("浏览器草稿列表不受支持");
    for (const [index, entry] of (value.stored?.records ?? []).entries())
      raw(entry?.raw, `浏览器副本 ${index + 1}`, value.current?.cwd);
    if (value.legacyRaw) raw(value.legacyRaw, "旧版未标明项目的草稿");
    else if (value.stored?.legacyRaw) raw(value.stored.legacyRaw, "旧版未标明项目的草稿");
  } else if (value.format === undefined && (value.resumeDraft || value.interviewDraft)) {
    add(value, "旧版未标明项目的草稿");
  } else throw new Error("不是支持的求职草稿备份");
  if (!candidates.length) throw new Error(issues.join("；") || "备份中没有可恢复的正文或回答");
  return { candidates, issues };
}
