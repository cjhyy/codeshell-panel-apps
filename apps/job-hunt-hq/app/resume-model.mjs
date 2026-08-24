export const DEFAULT_BASE_RESUME_CATEGORY = "通用方向";
export const DEFAULT_RESUME_STYLE = Object.freeze({
  template: "editorial",
  density: "comfortable",
});
export const RESUME_TEMPLATE_IDS = ["editorial", "minimal", "technical"];
export const RESUME_DENSITY_IDS = ["comfortable", "compact"];
export const RESUME_EVIDENCE_SOURCE_KINDS = [
  "experience",
  "repository",
  "commit",
  "file",
  "user",
  "other",
];
export const RESUME_CLAIM_IMPORTANCE = ["core", "supporting"];
export const RESUME_QA_CATEGORY_IDS = [
  "ownership",
  "scope",
  "impact",
  "decision",
  "collaboration",
  "failure",
  "context",
];
export const RESUME_QA_PRIORITY_IDS = ["high", "medium", "low"];
export const RESUME_QA_STATUS_IDS = ["open", "answered", "needs_source", "skipped"];
export const RESUME_VARIANT_CHANGE_TYPES = ["rewrite", "addition", "removal"];
export const RESUME_VARIANT_CHANGE_STATUSES = ["pending", "kept", "reverted"];

function boundedText(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function boundedList(value, maximumItems, maximumLength) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => boundedText(item, maximumLength)).filter(Boolean))].slice(
        0,
        maximumItems,
      )
    : [];
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeResumeClaim(value) {
  return boundedText(value, 800)
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resumeClaimKey(value) {
  return normalizeResumeClaim(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{Sm}#%&@]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

export function extractResumeClaims(markdown) {
  const claims = [];
  const seen = new Set();
  let section = "";
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const heading = line.match(/^\s*##\s+(.+)$/);
    if (heading) {
      section = normalizeResumeClaim(heading[1]);
      continue;
    }
    const isBullet = /^\s*[-*+]\s+\S/.test(line);
    const isSummaryClaim =
      /^(专业概述|职业概述|个人简介|professional summary|summary|profile)$/i.test(section) &&
      line.trim() &&
      !/^\s*#/.test(line);
    const isCapabilityClaim =
      /^(核心能力|专业能力|能力概览|技能|技能清单|技术栈|core skills|technical skills|skills|competencies|expertise)$/i.test(
        section,
      ) &&
      line.trim() &&
      !/^\s*#/.test(line);
    if (!isBullet && !isSummaryClaim && !isCapabilityClaim) continue;
    const claim = normalizeResumeClaim(line);
    const isPublicLocator =
      /^(?:(?:repo(?:sitory)?|github|gitlab|项目地址|代码地址|作品集|链接)\s*[:：]\s*)?(?:https?:\/\/|www\.|(?:github|gitlab|bitbucket)\.com\/)[^\s]+$/i.test(
        claim,
      ) || /^(?:repo(?:sitory)?|项目地址|代码地址)\s*[:：]\s*\S+$/i.test(claim);
    const isContactMetadata = /^(?:e-?mail|邮箱|电话|手机|linkedin)\s*[:：]\s*\S+/i.test(claim);
    const key = resumeClaimKey(claim);
    if (!claim || isPublicLocator || isContactMetadata || seen.has(key)) continue;
    seen.add(key);
    claims.push(claim);
  }
  return claims;
}

function extractResumeClaimEntries(markdown) {
  const acceptedClaims = new Set(extractResumeClaims(markdown).map(resumeClaimKey));
  const entries = [];
  let section = "";
  for (const sourceLine of String(markdown || "").split(/\r?\n/)) {
    const heading = sourceLine.match(/^\s*##\s+(.+)$/);
    if (heading) {
      section = normalizeResumeClaim(heading[1]);
      continue;
    }
    const claim = normalizeResumeClaim(sourceLine);
    if (!claim || !acceptedClaims.has(resumeClaimKey(claim))) continue;
    entries.push({
      claim,
      key: resumeClaimKey(claim),
      section,
      markdown: sourceLine.trim(),
    });
  }
  return entries;
}

function sequenceDifference(baseEntries, variantEntries) {
  const baseLength = baseEntries.length;
  const variantLength = variantEntries.length;
  const lcs = Array.from({ length: baseLength + 1 }, () => Array(variantLength + 1).fill(0));
  for (let baseIndex = baseLength - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let variantIndex = variantLength - 1; variantIndex >= 0; variantIndex -= 1) {
      lcs[baseIndex][variantIndex] =
        baseEntries[baseIndex].key === variantEntries[variantIndex].key
          ? lcs[baseIndex + 1][variantIndex + 1] + 1
          : Math.max(lcs[baseIndex + 1][variantIndex], lcs[baseIndex][variantIndex + 1]);
    }
  }
  const removed = [];
  const added = [];
  let baseIndex = 0;
  let variantIndex = 0;
  while (baseIndex < baseLength && variantIndex < variantLength) {
    if (baseEntries[baseIndex].key === variantEntries[variantIndex].key) {
      baseIndex += 1;
      variantIndex += 1;
    } else if (lcs[baseIndex + 1][variantIndex] >= lcs[baseIndex][variantIndex + 1]) {
      removed.push(baseEntries[baseIndex]);
      baseIndex += 1;
    } else {
      added.push(variantEntries[variantIndex]);
      variantIndex += 1;
    }
  }
  removed.push(...baseEntries.slice(baseIndex));
  added.push(...variantEntries.slice(variantIndex));
  return { removed, added };
}

function resumeClaimSimilarity(left, right) {
  const tokens = (value) =>
    new Set(
      String(value || "")
        .normalize("NFKC")
        .toLocaleLowerCase()
        .match(/[\p{Script=Han}]|[\p{L}\p{N}][\p{L}\p{N}+#.%/-]*/gu) || [],
    );
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / new Set([...leftTokens, ...rightTokens]).size;
}

function jobRequirementTokens(value) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase();
  const tokens = new Set(
    normalized.match(/[a-z][a-z0-9+#.%-]{1,}|\d+(?:\.\d+)?%?/g) || [],
  );
  for (const run of normalized.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.add(run.slice(index, index + 2));
    }
  }
  return tokens;
}

export function extractJobRequirementRefs(job) {
  const description = boundedText(job?.description, 20_000);
  if (!description) return [];
  const labeled = description.replace(
    /(?:^|[\n。；;])\s*(岗位职责|工作职责|职位职责|任职要求|岗位要求|职位要求|我们希望你|加分项|优先条件|公司介绍|关于我们|福利待遇|工作地址|工商信息|公司规模)\s*[：:]/g,
    "\n$1：",
  );
  const strictRefs = [];
  const fallbackRefs = [];
  const strictSeen = new Set();
  const fallbackSeen = new Set();
  let section = "";
  let inStopSection = false;
  for (const rawPart of labeled.split(/[\n。；;]+/)) {
    let part = rawPart.trim();
    const heading = part.match(
      /^(岗位职责|工作职责|职位职责|任职要求|岗位要求|职位要求|我们希望你|加分项|优先条件|公司介绍|关于我们|福利待遇|工作地址|工商信息|公司规模)\s*[：:]\s*(.*)$/,
    );
    if (heading) {
      inStopSection = /公司|关于|福利|地址|工商/.test(heading[1]);
      section = inStopSection
        ? ""
        : /要求|希望|加分|优先/.test(heading[1])
          ? "任职要求"
          : "岗位职责";
      part = heading[2].trim();
    }
    part = part.replace(/^\s*(?:[-*+•·]|\d+[.)、])\s*/, "").trim();
    if (part.length < 6 || inStopSection) continue;
    if (!/^(?:【|职位|薪资|地点(?:\/要求)?|招聘者|公司介绍|公司规模|工商信息|职位描述|定位)\s*[：:]/.test(part)) {
      const fallbackRef = `JD · ${boundedText(part, 420)}`;
      const fallbackKey = fallbackRef.normalize("NFKC").toLocaleLowerCase();
      if (!fallbackSeen.has(fallbackKey)) {
        fallbackSeen.add(fallbackKey);
        fallbackRefs.push(fallbackRef);
      }
    }
    if (!section) continue;
    const strictRef = `${section} · ${boundedText(part, 420)}`;
    const strictKey = strictRef.normalize("NFKC").toLocaleLowerCase();
    if (strictSeen.has(strictKey)) continue;
    strictSeen.add(strictKey);
    strictRefs.push(strictRef);
  }
  return (strictRefs.length ? strictRefs : fallbackRefs).slice(0, 40);
}

export function matchResumeChangeToJobRequirements(job, change, maximum = 3) {
  const refs = extractJobRequirementRefs(job);
  if (!refs.length) return [];
  const targetTokens = jobRequirementTokens(
    [change?.after || change?.before, change?.reason, job?.title].filter(Boolean).join(" "),
  );
  if (!targetTokens.size) return [];
  return refs
    .map((ref, index) => {
      const refTokens = jobRequirementTokens(ref.replace(/^[^·]+·\s*/, ""));
      const overlap = [...targetTokens].filter((token) => refTokens.has(token));
      const score = overlap.length
        ? overlap.length / Math.sqrt(targetTokens.size * Math.max(1, refTokens.size))
        : 0;
      return { ref, index, score, overlap: overlap.length };
    })
    .filter((item) => item.overlap > 0 && item.score >= 0.045)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, Math.min(6, Number(maximum) || 3)))
    .map((item) => item.ref);
}

function classifyResumeDifferences(difference) {
  const availableRemoved = new Set(difference.removed.map((_, index) => index));
  const classified = [];
  for (let addedIndex = 0; addedIndex < difference.added.length; addedIndex += 1) {
    const afterEntry = difference.added[addedIndex];
    let bestRemovedIndex = -1;
    let bestScore = 0;
    for (const removedIndex of availableRemoved) {
      const score = resumeClaimSimilarity(difference.removed[removedIndex].claim, afterEntry.claim);
      if (score > bestScore) {
        bestScore = score;
        bestRemovedIndex = removedIndex;
      }
    }
    if (bestRemovedIndex >= 0 && bestScore >= 0.2) {
      availableRemoved.delete(bestRemovedIndex);
      classified.push({
        beforeEntry: difference.removed[bestRemovedIndex],
        afterEntry,
        order: Math.min(bestRemovedIndex, addedIndex),
      });
    } else {
      classified.push({ beforeEntry: null, afterEntry, order: addedIndex + 0.25 });
    }
  }
  for (const removedIndex of availableRemoved) {
    classified.push({
      beforeEntry: difference.removed[removedIndex],
      afterEntry: null,
      order: removedIndex + 0.5,
    });
  }
  return classified.sort((left, right) => left.order - right.order);
}

export function normalizeResumeVariantChange(item, index = 0) {
  const input = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  const type = RESUME_VARIANT_CHANGE_TYPES.includes(input.type) ? input.type : "rewrite";
  const before = normalizeResumeClaim(input.before);
  const after = normalizeResumeClaim(input.after);
  const identity = `${type}\u0000${input.section || ""}\u0000${before}\u0000${after}`;
  return {
    id:
      boundedText(input.id, 100) || `resume-change-${stableHash(identity || `item-${index + 1}`)}`,
    type,
    section: boundedText(input.section, 160),
    before,
    after,
    beforeMarkdown: boundedText(input.beforeMarkdown || input.before_markdown, 1200),
    afterMarkdown: boundedText(input.afterMarkdown || input.after_markdown, 1200),
    reason: boundedText(input.reason, 500),
    jobRequirementRefs: boundedList(
      input.jobRequirementRefs || input.job_requirement_refs,
      6,
      500,
    ),
    sourceRefs: boundedList(input.sourceRefs || input.source_refs, 8, 500),
    status: RESUME_VARIANT_CHANGE_STATUSES.includes(input.status) ? input.status : "pending",
    userEdited: input.userEdited === true || input.user_edited === true,
    updatedAt: boundedText(input.updatedAt || input.updated_at, 80),
  };
}

export function normalizeResumeVariantChanges(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items
    .map(normalizeResumeVariantChange)
    .filter((item) => {
      if ((!item.before && !item.after) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 120);
}

export function deriveResumeVariantChanges(baseRecord, variantRecord, targetJob = null) {
  if (!baseRecord?.markdown || !variantRecord?.markdown) return [];
  const baseEntries = extractResumeClaimEntries(baseRecord.markdown);
  const variantEntries = extractResumeClaimEntries(variantRecord.markdown);
  const existingById = new Map(
    normalizeResumeVariantChanges(variantRecord.variantChanges).map((item) => [item.id, item]),
  );
  const evidenceByClaim = new Map(
    normalizeClaimEvidence([
      ...(Array.isArray(variantRecord.claimEvidence) ? variantRecord.claimEvidence : []),
      ...(Array.isArray(baseRecord.claimEvidence) ? baseRecord.claimEvidence : []),
    ]).map((item) => [resumeClaimKey(item.claim), item]),
  );
  const sections = [...new Set([...baseEntries, ...variantEntries].map((entry) => entry.section))];
  const changes = [];
  for (const section of sections) {
    const difference = sequenceDifference(
      baseEntries.filter((entry) => entry.section === section),
      variantEntries.filter((entry) => entry.section === section),
    );
    for (const { beforeEntry, afterEntry } of classifyResumeDifferences(difference)) {
      const type = beforeEntry && afterEntry ? "rewrite" : beforeEntry ? "removal" : "addition";
      const before = beforeEntry?.claim || "";
      const after = afterEntry?.claim || "";
      const id = `resume-change-${stableHash(`${type}\u0000${section}\u0000${before}\u0000${after}`)}`;
      const evidence = evidenceByClaim.get(resumeClaimKey(after || before));
      const existing = existingById.get(id);
      const reason =
        evidence?.whyItMatters ||
        evidence?.improvement ||
        (type === "removal"
          ? "岗位版暂时弱化了这条 Base 信息。"
          : "岗位版根据目标 JD 调整了信息重点。");
      changes.push(
        normalizeResumeVariantChange({
          id,
          type,
          section,
          before,
          after,
          beforeMarkdown: beforeEntry?.markdown || "",
          afterMarkdown: afterEntry?.markdown || "",
          reason,
          jobRequirementRefs:
            existing?.jobRequirementRefs?.length
              ? existing.jobRequirementRefs
              : matchResumeChangeToJobRequirements(targetJob, { before, after, reason }),
          sourceRefs: evidence?.sources?.map((source) => source.locator) || [],
          status: existing?.status || "pending",
          userEdited: existing?.userEdited === true,
          updatedAt: existing?.updatedAt || "",
        }),
      );
    }
  }
  return normalizeResumeVariantChanges(changes);
}

function updateResumeClaimLine(markdown, fromMarkdown, toMarkdown, section) {
  const lines = String(markdown || "").split(/\r?\n/);
  const fromClaim = normalizeResumeClaim(fromMarkdown);
  const sectionKey = resumeClaimKey(section);
  let currentSection = "";
  let fallbackIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^\s*##\s+(.+)$/);
    if (heading) {
      currentSection = normalizeResumeClaim(heading[1]);
      continue;
    }
    if (!fromClaim || resumeClaimKey(lines[index]) !== resumeClaimKey(fromClaim)) continue;
    if (fallbackIndex < 0) fallbackIndex = index;
    if (!sectionKey || resumeClaimKey(currentSection) === sectionKey) {
      fallbackIndex = index;
      break;
    }
  }
  if (fromClaim && fallbackIndex >= 0) {
    if (toMarkdown) lines[fallbackIndex] = toMarkdown;
    else lines.splice(fallbackIndex, 1);
    return {
      markdown: lines
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
      changed: true,
    };
  }
  if (fromClaim || !toMarkdown) return { markdown: String(markdown || ""), changed: false };

  let headingIndex = -1;
  let insertIndex = lines.length;
  if (!sectionKey) {
    const firstSectionIndex = lines.findIndex((line) => /^\s*##\s+/.test(line));
    lines.splice(firstSectionIndex >= 0 ? firstSectionIndex : lines.length, 0, toMarkdown);
    return {
      markdown: lines
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
      changed: true,
    };
  }
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^\s*##\s+(.+)$/);
    if (!heading) continue;
    if (headingIndex >= 0) {
      insertIndex = index;
      break;
    }
    if (resumeClaimKey(heading[1]) === sectionKey) headingIndex = index;
  }
  if (headingIndex < 0) return { markdown: String(markdown || ""), changed: false };
  lines.splice(insertIndex, 0, toMarkdown);
  return {
    markdown: lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    changed: true,
  };
}

export function decideResumeVariantChange(
  record,
  { changeId, decision, baseRecord = null, updatedAt = "" } = {},
) {
  if (!record || record.kind !== "variant") throw new Error("只有岗位版简历可以审核差异");
  if (!["kept", "reverted"].includes(decision)) throw new Error("岗位版差异决策无效");
  const changes = normalizeResumeVariantChanges(record.variantChanges);
  const index = changes.findIndex((item) => item.id === boundedText(changeId, 100));
  if (index < 0) throw new Error("这条岗位版差异已不存在");
  const change = changes[index];
  if (change.status === decision)
    return { record: { ...record, variantChanges: changes }, changed: false };
  const confirmingCurrentVariant = change.status === "pending" && decision === "kept";
  const result = confirmingCurrentVariant
    ? { markdown: record.markdown, changed: true }
    : updateResumeClaimLine(
        record.markdown,
        decision === "reverted" ? change.afterMarkdown : change.beforeMarkdown,
        decision === "reverted" ? change.beforeMarkdown : change.afterMarkdown,
        change.section,
      );
  if (!result.changed)
    throw new Error("当前简历已手动改动，无法安全应用这条差异；请重新生成岗位版");
  changes[index] = { ...change, status: decision, updatedAt: boundedText(updatedAt, 80) };
  const baseEvidence = normalizeClaimEvidence(baseRecord?.claimEvidence).find(
    (item) => resumeClaimKey(item.claim) === resumeClaimKey(change.before),
  );
  return {
    changed: true,
    record: {
      ...record,
      markdown: result.markdown,
      claimEvidence: normalizeClaimEvidence([
        ...(Array.isArray(record.claimEvidence) ? record.claimEvidence : []),
        ...(baseEvidence ? [baseEvidence] : []),
      ]),
      variantChanges: changes,
      updatedAt: boundedText(updatedAt, 80),
    },
  };
}

function resumeClaimMarkdown(template, claim) {
  const prefix = String(template || "").match(/^(\s*[-*+]\s+)/)?.[1] || "";
  return `${prefix}${claim}`;
}

export function editResumeVariantChange(
  record,
  { changeId, after, updatedAt = "" } = {},
) {
  if (!record || record.kind !== "variant") throw new Error("只有岗位版简历可以编辑差异");
  const changes = normalizeResumeVariantChanges(record.variantChanges);
  const index = changes.findIndex((item) => item.id === boundedText(changeId, 100));
  if (index < 0) throw new Error("这条岗位版差异已不存在");
  const change = changes[index];
  const editedAfter = normalizeResumeClaim(after);
  if (editedAfter.length < 8) throw new Error("岗位版表述至少需要 8 个字");
  if (resumeClaimKey(editedAfter) === resumeClaimKey(change.before)) {
    throw new Error("编辑结果与 Base 相同；请直接使用“恢复 Base 表述”");
  }
  const nextAfterMarkdown = resumeClaimMarkdown(
    change.afterMarkdown || change.beforeMarkdown,
    editedAfter,
  );
  const currentMarkdown = change.status === "reverted" ? change.beforeMarkdown : change.afterMarkdown;
  const result = updateResumeClaimLine(
    record.markdown,
    currentMarkdown,
    nextAfterMarkdown,
    change.section,
  );
  if (!result.changed) {
    throw new Error("当前简历已手动改动，无法安全编辑这条差异；请重新生成岗位版");
  }
  const evidence = normalizeClaimEvidence(record.claimEvidence);
  const sourceEvidence = evidence.find(
    (item) =>
      resumeClaimKey(item.claim) === resumeClaimKey(change.after) ||
      resumeClaimKey(item.claim) === resumeClaimKey(change.before),
  );
  const editedEvidence = sourceEvidence ? { ...sourceEvidence, claim: editedAfter } : null;
  changes[index] = normalizeResumeVariantChange({
    ...change,
    type: change.before ? "rewrite" : "addition",
    after: editedAfter,
    afterMarkdown: nextAfterMarkdown,
    status: "kept",
    userEdited: true,
    updatedAt,
  });
  return {
    changed: true,
    record: {
      ...record,
      markdown: result.markdown,
      claimEvidence: normalizeClaimEvidence([...(editedEvidence ? [editedEvidence] : []), ...evidence]),
      variantChanges: changes,
      updatedAt: boundedText(updatedAt, 80),
    },
  };
}

export function pendingResumeVariantChangeCount(record) {
  return normalizeResumeVariantChanges(record?.variantChanges).filter(
    (item) => item.status === "pending",
  ).length;
}

export function selectResumeQaClaims(markdown, maximum = 4) {
  const eligible = (claim) => {
    if (claim.length < 16) return false;
    if (/^(?:repo|github|https?):/i.test(claim)) return false;
    if (/待补充|请先|联系方式待补充|技术栈待补充/.test(claim)) return false;
    return true;
  };
  const actionBullets = String(markdown || "")
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*+]\s+\S/.test(line))
    .map(normalizeResumeClaim)
    .filter(eligible);
  const fallbackClaims = extractResumeClaims(markdown).filter(eligible);
  const candidates = [...new Set([...actionBullets, ...fallbackClaims])];
  const patterns = [
    /负责|主导|设计|实现|建设|推动|参与|协同|交付|落地|\b(?:led|owned|designed|implemented|built|drove|delivered|launched|collaborated)\b/i,
    /提升|降低|缩短|减少|改善|优化|效率|稳定|质量|增长|结果|\b(?:increased|reduced|improved|cut|saved|grew|accelerated|stabilized)\b/i,
    /用户|页面|模块|团队|业务线|平台|系统|工作台|跨端|规模|周期|\b(?:users?|pages?|modules?|teams?|products?|systems?|platforms?|across)\b/i,
    /架构|方案|取舍|重构|选择|决策|故障|恢复|回滚|验证|\b(?:architecture|trade-?off|chose|decision|rollback|recovery|migration|refactor(?:ed)?)\b/i,
  ];
  const selected = [];
  const used = new Set();
  for (const pattern of patterns) {
    const match = candidates.find((claim) => pattern.test(claim) && !used.has(claim));
    if (!match) continue;
    selected.push(match);
    used.add(match);
    if (selected.length >= maximum) return selected;
  }
  for (const claim of candidates) {
    if (used.has(claim)) continue;
    selected.push(claim);
    if (selected.length >= maximum) break;
  }
  return selected;
}

export function normalizeEvidenceSource(source) {
  const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const kind = RESUME_EVIDENCE_SOURCE_KINDS.includes(input.kind) ? input.kind : "other";
  return {
    kind,
    label: boundedText(input.label, 160),
    locator: boundedText(input.locator, 500),
    evidence: boundedText(input.evidence || input.detail || input.summary, 800),
  };
}

function mergeEvidenceSourceDetails(current, incoming) {
  const currentEvidence = boundedText(current.evidence, 800);
  const incomingEvidence = boundedText(incoming.evidence, 800);
  const evidence =
    !incomingEvidence || currentEvidence.includes(incomingEvidence)
      ? currentEvidence
      : !currentEvidence || incomingEvidence.includes(currentEvidence)
        ? incomingEvidence
        : `${currentEvidence}；${incomingEvidence}`;
  return {
    kind: current.kind,
    label: current.label || incoming.label,
    locator: current.locator,
    evidence: boundedText(evidence, 800),
  };
}

function normalizeEvidenceSources(items) {
  const merged = [];
  const byLocator = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const source = normalizeEvidenceSource(item);
    if (!source.label || !source.locator) continue;
    const key = `${source.kind}\u0000${source.locator.toLocaleLowerCase()}`;
    const existing = byLocator.get(key);
    if (existing) {
      Object.assign(existing, mergeEvidenceSourceDetails(existing, source));
      continue;
    }
    byLocator.set(key, source);
    merged.push(source);
    if (merged.length >= 8) break;
  }
  return merged;
}

export function normalizeInterviewQuestion(item) {
  const input =
    item && typeof item === "object" && !Array.isArray(item) ? item : { question: item };
  return {
    question: boundedText(input.question, 500),
    focus: boundedText(input.focus || input.why, 240),
  };
}

export function normalizeClaimEvidence(items) {
  if (!Array.isArray(items)) return [];
  const normalized = items
    .map((item) => {
      const input = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      return {
        claim: normalizeResumeClaim(input.claim),
        status: input.status === "verified" ? "verified" : "needs_review",
        importance: RESUME_CLAIM_IMPORTANCE.includes(input.importance)
          ? input.importance
          : "supporting",
        whyItMatters: boundedText(input.whyItMatters || input.why_it_matters, 400),
        sources: normalizeEvidenceSources(input.sources),
        interviewQuestions: Array.isArray(input.interviewQuestions || input.interview_questions)
          ? (input.interviewQuestions || input.interview_questions)
              .map(normalizeInterviewQuestion)
              .filter((question) => question.question)
              .slice(0, 4)
          : [],
        improvement: boundedText(input.improvement || input.improvement_suggestion, 800),
      };
    })
    .filter((item) => item.claim && item.sources.length)
    .slice(0, 120);
  const byClaim = new Map();
  for (const item of normalized) {
    const key = resumeClaimKey(item.claim);
    const current = byClaim.get(key);
    if (!current) {
      byClaim.set(key, item);
      continue;
    }
    const sourceByLocator = new Map(
      current.sources.map((source) => [
        `${source.kind}\u0000${source.locator.toLocaleLowerCase()}`,
        source,
      ]),
    );
    for (const source of item.sources) {
      const sourceKey = `${source.kind}\u0000${source.locator.toLocaleLowerCase()}`;
      const existingSource = sourceByLocator.get(sourceKey);
      if (existingSource) {
        Object.assign(existingSource, mergeEvidenceSourceDetails(existingSource, source));
        continue;
      }
      if (current.sources.length >= 8) continue;
      sourceByLocator.set(sourceKey, source);
      current.sources.push(source);
    }
    const questionKeys = new Set(
      current.interviewQuestions.map((question) => question.question.toLocaleLowerCase()),
    );
    for (const question of item.interviewQuestions) {
      const questionKey = question.question.toLocaleLowerCase();
      if (questionKeys.has(questionKey) || current.interviewQuestions.length >= 4) continue;
      questionKeys.add(questionKey);
      current.interviewQuestions.push(question);
    }
    if (item.status === "verified") current.status = "verified";
    if (item.importance === "core") current.importance = "core";
    current.whyItMatters ||= item.whyItMatters;
    current.improvement ||= item.improvement;
  }
  return [...byClaim.values()].slice(0, 120);
}

export function normalizeResumeQaQuestion(item, index = 0) {
  const input = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  const status = RESUME_QA_STATUS_IDS.includes(input.status) ? input.status : "open";
  const question = boundedText(input.question, 600);
  return {
    id: boundedText(input.id, 100) || `resume-qa-${stableHash(question || `item-${index + 1}`)}`,
    category: RESUME_QA_CATEGORY_IDS.includes(input.category) ? input.category : "context",
    priority: RESUME_QA_PRIORITY_IDS.includes(input.priority) ? input.priority : "medium",
    question,
    why: boundedText(input.why, 500),
    relatedClaim: normalizeResumeClaim(input.relatedClaim || input.related_claim),
    sourceHints: boundedList(input.sourceHints || input.source_hints, 6, 300),
    status,
    answer: boundedText(input.answer, 3000),
    sourceRefs: boundedList(input.sourceRefs || input.source_refs, 8, 500),
    suggestedChange: boundedText(input.suggestedChange || input.suggested_change, 1000),
    answeredAt: boundedText(input.answeredAt || input.answered_at, 80),
  };
}

export function normalizeResumeQaQuestions(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items
    .map(normalizeResumeQaQuestion)
    .filter((item) => {
      const key = item.question.toLocaleLowerCase();
      if (!item.question || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

export function updateResumeQaAnswer(
  items,
  { questionId, status, answer, sourceRefs = [], suggestedChange = "", answeredAt = "" } = {},
) {
  const questions = normalizeResumeQaQuestions(items);
  const index = questions.findIndex((item) => item.id === boundedText(questionId, 100));
  if (index < 0) throw new Error("question_id 不属于当前简历版本");
  if (!["answered", "needs_source", "skipped"].includes(status)) {
    throw new Error("简历事实回答状态无效");
  }
  const normalizedAnswer = boundedText(answer, 3000);
  if (!normalizedAnswer) throw new Error("候选人的实际回答为必填");
  const normalizedSources = boundedList(sourceRefs, 8, 500);
  if (status === "answered" && !normalizedSources.length) {
    throw new Error("标记 answered 时至少需要一个 Source");
  }
  const updated = {
    ...questions[index],
    status,
    answer: normalizedAnswer,
    sourceRefs: normalizedSources,
    suggestedChange: boundedText(suggestedChange, 1000),
    answeredAt: boundedText(answeredAt, 80),
  };
  questions[index] = updated;
  return { questions, question: updated };
}

export function mergeResumeQaQuestions(previousItems, incomingItems, maximum = 12) {
  const limit = Math.max(1, Math.min(12, Math.floor(Number(maximum) || 12)));
  const previous = normalizeResumeQaQuestions(previousItems);
  const incoming = normalizeResumeQaQuestions(incomingItems);
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const previousByQuestion = new Map(
    previous.map((item) => [item.question.toLocaleLowerCase(), item]),
  );
  const matchedPreviousIds = new Set();
  const mergedIncoming = incoming.map((item) => {
    const saved =
      previousById.get(item.id) || previousByQuestion.get(item.question.toLocaleLowerCase());
    if (!saved) return item;
    matchedPreviousIds.add(saved.id);
    if (saved.status === "open") return item;
    return {
      ...item,
      status: saved.status,
      answer: saved.answer,
      sourceRefs: saved.sourceRefs,
      suggestedChange: saved.suggestedChange,
      answeredAt: saved.answeredAt,
    };
  });
  const preservedResponses = previous.filter(
    (item) => item.status !== "open" && !matchedPreviousIds.has(item.id),
  );
  // Prior versions keep the complete historical answers. Reserve a small
  // carry-over window here so old resolved prompts cannot crowd every new,
  // higher-value question out of the active resume.
  const preserved = preservedResponses.slice(0, Math.min(4, limit));
  const roomForIncoming = Math.max(0, limit - preserved.length);
  return normalizeResumeQaQuestions([...mergedIncoming.slice(0, roomForIncoming), ...preserved]);
}

export function resumeQaCounts(record) {
  const questions = normalizeResumeQaQuestions(record?.candidateQuestions);
  return {
    total: questions.length,
    open: questions.filter((item) => item.status === "open").length,
    answered: questions.filter((item) => item.status === "answered").length,
    needsSource: questions.filter((item) => item.status === "needs_source").length,
    skipped: questions.filter((item) => item.status === "skipped").length,
  };
}

export function resumeClaimStrength(evidence) {
  if (!evidence?.sources?.length) return "missing";
  if (evidence.status !== "verified") return "needs_review";
  const explainedSources = evidence.sources.filter((source) => source.evidence);
  if (!explainedSources.length) return "referenced";
  if (
    explainedSources.some((source) =>
      ["experience", "repository", "commit", "file"].includes(source.kind),
    )
  ) {
    return "strong";
  }
  return "supported";
}

export function resumeEvidenceCoverage(markdown, claimEvidence) {
  const claims = extractResumeClaims(markdown);
  const evidenceByClaim = new Map(
    normalizeClaimEvidence(claimEvidence).map((item) => [resumeClaimKey(item.claim), item]),
  );
  const mapped = claims.map((claim) => ({
    claim,
    evidence: evidenceByClaim.get(resumeClaimKey(claim)) || null,
    strength: resumeClaimStrength(evidenceByClaim.get(resumeClaimKey(claim)) || null),
  }));
  const supported = mapped.filter((item) => item.evidence?.sources.length).length;
  const verified = mapped.filter((item) => item.evidence?.status === "verified").length;
  const explained = mapped.filter(
    (item) =>
      item.evidence?.sources.length &&
      item.evidence.sources.every((source) => Boolean(source.evidence)),
  ).length;
  const questionsReady = mapped.filter((item) => item.evidence?.interviewQuestions?.length).length;
  const prioritized = mapped.filter(
    (item) => item.evidence?.whyItMatters && item.evidence?.importance,
  ).length;
  const strong = mapped.filter((item) => item.strength === "strong").length;
  return {
    total: claims.length,
    supported,
    verified,
    explained,
    questionsReady,
    prioritized,
    strong,
    core: mapped.filter((item) => item.evidence?.importance === "core").length,
    complete: mapped.filter(
      (item) =>
        item.evidence?.sources.length &&
        item.evidence.sources.every((source) => Boolean(source.evidence)) &&
        item.evidence.whyItMatters &&
        item.evidence.interviewQuestions.length,
    ).length,
    publishable: mapped.filter(
      (item) =>
        item.evidence?.status === "verified" &&
        item.evidence.sources.length &&
        item.evidence.sources.every((source) => Boolean(source.evidence)) &&
        item.evidence.whyItMatters &&
        item.evidence.interviewQuestions.length,
    ).length,
    missing: mapped.filter((item) => !item.evidence).map((item) => item.claim),
    missingDetails: mapped
      .filter(
        (item) =>
          item.evidence &&
          (!item.evidence.whyItMatters ||
            !item.evidence.interviewQuestions.length ||
            item.evidence.sources.some((source) => !source.evidence)),
      )
      .map((item) => item.claim),
    mapped,
  };
}

export function resumeProfilePublicationGaps(profile = {}) {
  const source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const unresolved = (value) =>
    /待确认|待补充|待完善|待核验|未填写/.test(value) ||
    /^(?:unknown|placeholder|tbd|tbc)$/i.test(value.trim());
  const gaps = [];
  const name = boundedText(source.name, 100);
  const role = boundedText(source.role, 120);
  const contact = boundedText(source.contact, 300);
  if (!name || unresolved(name)) gaps.push("姓名");
  if (!role || unresolved(role)) gaps.push("职位定位");
  if (!hasActionableResumeContact(contact) || unresolved(contact)) gaps.push("联系方式");
  return gaps;
}

export function hasActionableResumeContact(value) {
  const contact = boundedText(value, 600);
  if (!contact) return false;
  if (/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/iu.test(contact)) return true;
  const digits = (contact.match(/\d/g) || []).length;
  const isBareDateRange = /^(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}$/.test(contact);
  const isBarePhone = /^\+?\d[\d\s().-]*\d$/.test(contact);
  if (!isBareDateRange && isBarePhone && digits >= 7) return true;
  const phoneCandidate = contact
    .match(/\+?\d[\d\s().-]{5,}\d/g)
    ?.some((candidate) => (candidate.match(/\d/g) || []).length >= 9);
  if (phoneCandidate) return true;
  if (digits >= 7 && /(?:电话|手机|phone|mobile|tel)\s*[:：]?/i.test(contact)) return true;
  if (/(?:https?:\/\/|www\.|(?:linkedin|github)\.com\/)[^\s·|]+/i.test(contact)) return true;
  return /(?:微信|wechat|telegram|whatsapp|line)\s*[:：]\s*[^\s·|]{3,}/i.test(contact);
}

export function resumeDocumentPublicationGaps(markdown = "") {
  const document = boundedText(markdown, 50000);
  const header = document.split(/^#{2,6}\s*/m)[0] || "";
  const nameHeading = header.match(/^#\s+(.+)$/m)?.[1] || "";
  const unresolved =
    /你的姓名|目标角色|联系方式待补充|请补充|待补充|待确认|待完善|待核验|未填写|to be confirmed|\b(?:tbd|tbc|todo)\b|^\s*(?:unknown|placeholder)(?:\s*[:：].*)?\s*$/im;
  const gaps = [];
  if (!nameHeading || unresolved.test(nameHeading)) gaps.push("简历姓名标题");
  if (!hasActionableResumeContact(header)) gaps.push("简历中的可用联系方式");
  if (unresolved.test(document)) gaps.push("公开简历占位内容");
  return gaps;
}

export function resumePublicationStatus(record = {}, profile = null) {
  const coverage = resumeEvidenceCoverage(record.markdown, record.claimEvidence);
  const profileGaps = profile ? resumeProfilePublicationGaps(profile) : [];
  const documentGaps = resumeDocumentPublicationGaps(record.markdown);
  return {
    ready:
      coverage.total > 0 &&
      coverage.publishable === coverage.total &&
      !profileGaps.length &&
      !documentGaps.length,
    total: coverage.total,
    complete: coverage.publishable,
    incompleteCount: Math.max(0, coverage.total - coverage.publishable),
    profileGaps,
    documentGaps,
  };
}

export function normalizeResumeKind(value, jobId = "") {
  if (value === "base" || value === "variant") return value;
  return String(jobId || "").trim() ? "variant" : "base";
}

export function normalizeResumeCategory(value, fallback = DEFAULT_BASE_RESUME_CATEGORY) {
  const category = String(value || "")
    .trim()
    .slice(0, 80);
  return (
    category ||
    String(fallback || DEFAULT_BASE_RESUME_CATEGORY)
      .trim()
      .slice(0, 80)
  );
}

export function normalizeResumeStyle(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    template: RESUME_TEMPLATE_IDS.includes(input.template)
      ? input.template
      : DEFAULT_RESUME_STYLE.template,
    density: RESUME_DENSITY_IDS.includes(input.density)
      ? input.density
      : DEFAULT_RESUME_STYLE.density,
  };
}

function normalizePdfExports(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      return {
        path: boundedText(source.path, 512),
        exportedAt: boundedText(source.exportedAt, 80),
        size: Number.isSafeInteger(source.size) && source.size >= 0 ? source.size : 0,
      };
    })
    .filter((item) => item.path.toLowerCase().endsWith(".pdf"))
    .sort((left, right) => {
      const leftTime = timestamp(left.exportedAt);
      const rightTime = timestamp(right.exportedAt);
      if (leftTime !== null || rightTime !== null) return (rightTime ?? -1) - (leftTime ?? -1);
      return right.exportedAt.localeCompare(left.exportedAt);
    })
    .slice(0, 12);
}

export function resumeRecordId(record) {
  return String(record?.versionId || record?.id || "").trim();
}

export function normalizeResumeRecord(record, options = {}) {
  const source = record && typeof record === "object" && !Array.isArray(record) ? record : {};
  const jobId = String(source.jobId || "")
    .trim()
    .slice(0, 80);
  const kind = normalizeResumeKind(source.kind, jobId);
  const fallbackCategory =
    options.profileTarget || options.profileRole || DEFAULT_BASE_RESUME_CATEGORY;
  return {
    id: boundedText(source.id, 100),
    versionId: boundedText(source.versionId, 100),
    parentVersionId: boundedText(source.parentVersionId || source.parent_version_id, 100),
    revisionReason: boundedText(source.revisionReason || source.revision_reason, 160),
    kind,
    category: normalizeResumeCategory(source.category, fallbackCategory),
    baseResumeId:
      kind === "variant"
        ? String(source.baseResumeId || "")
            .trim()
            .slice(0, 100)
        : "",
    jobId: kind === "variant" ? jobId : "",
    style: normalizeResumeStyle(source.style),
    pdfExports: normalizePdfExports(source.pdfExports),
    title: boundedText(source.title, 120),
    markdown: boundedText(source.markdown, 50000),
    claimEvidence: normalizeClaimEvidence(source.claimEvidence),
    candidateQuestions: normalizeResumeQaQuestions(source.candidateQuestions),
    variantChanges: kind === "variant" ? normalizeResumeVariantChanges(source.variantChanges) : [],
    notes: boundedList(source.notes, 12, 300),
    updatedAt: boundedText(source.updatedAt, 80),
  };
}

export function collectResumeRecords(active, versions, options = {}) {
  const records = [];
  const seen = new Set();
  for (const candidate of [active, ...(Array.isArray(versions) ? versions : [])]) {
    if (!candidate?.markdown) continue;
    const record = normalizeResumeRecord(candidate, options);
    const id = resumeRecordId(record);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    records.push(record);
  }
  return records;
}

export function baseResumeRecords(records) {
  return records
    .filter((record) => record.kind === "base")
    .sort((left, right) => {
      const leftTime = timestamp(left.updatedAt);
      const rightTime = timestamp(right.updatedAt);
      if (leftTime !== null || rightTime !== null) return (rightTime ?? -1) - (leftTime ?? -1);
      return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    });
}

export function resumeVersionRemovalPreview(active, versions, versionId, options = {}) {
  const id = String(versionId || "").trim();
  if (!id) return null;
  const records = collectResumeRecords(active, versions, options);
  const target = records.find((record) => resumeRecordId(record) === id);
  if (!target) return null;
  const current = resumeRecordId(active) === id;
  const dependentVariants =
    target.kind === "base"
      ? records
          .filter(
            (record) => record.kind === "variant" && String(record.baseResumeId || "") === id,
          )
          .map((record) => ({
            id: resumeRecordId(record),
            title: record.title,
            jobId: record.jobId,
          }))
      : [];
  const childRevisions = records
    .filter((record) => String(record.parentVersionId || "") === id)
    .map((record) => ({ id: resumeRecordId(record), title: record.title, kind: record.kind }));
  return {
    target,
    current,
    removable: !current && dependentVariants.length === 0,
    reason: current ? "current" : dependentVariants.length ? "base_in_use" : "",
    dependentVariants,
    childRevisions,
    exportCount: Array.isArray(target.pdfExports) ? target.pdfExports.length : 0,
  };
}

export function removeResumeVersion(
  active,
  versions,
  versionId,
  selectedBaseResumeId = "",
  options = {},
) {
  const preview = resumeVersionRemovalPreview(active, versions, versionId, options);
  if (!preview?.removable) {
    return { removed: null, preview, active, versions, selectedBaseResumeId };
  }
  const removedId = resumeRecordId(preview.target);
  const replacementParentId =
    preview.target.parentVersionId && preview.target.parentVersionId !== removedId
      ? preview.target.parentVersionId
      : "";
  const reconnect = (record) =>
    String(record?.parentVersionId || "") === removedId
      ? { ...record, parentVersionId: replacementParentId }
      : record;
  const nextActive = reconnect(active);
  const nextVersions = (Array.isArray(versions) ? versions : [])
    .filter((record) => resumeRecordId(record) !== removedId)
    .map(reconnect);
  const nextRecords = collectResumeRecords(nextActive, nextVersions, options);
  const selectedStillExists = nextRecords.some(
    (record) => resumeRecordId(record) === selectedBaseResumeId && record.kind === "base",
  );
  const nextSelectedBaseResumeId = selectedStillExists
    ? selectedBaseResumeId
    : resumeRecordId(baseResumeRecords(nextRecords)[0]);
  return {
    removed: preview.target,
    preview,
    active: nextActive,
    versions: nextVersions,
    selectedBaseResumeId: nextSelectedBaseResumeId,
    reconnectedRevisionCount: preview.childRevisions.length,
  };
}

export function resumeExportStatus(record = {}) {
  const exports = normalizePdfExports(record.pdfExports);
  const latestExportAt = exports[0]?.exportedAt || "";
  const updatedAt = String(record.updatedAt || "");
  const exportedTime = timestamp(latestExportAt);
  const updatedTime = timestamp(updatedAt);
  return {
    count: exports.length,
    latestExportAt,
    fresh: Boolean(
      latestExportAt &&
      (!updatedAt ||
        (exportedTime !== null && updatedTime !== null && exportedTime >= updatedTime)),
    ),
  };
}

export function resolveResumePipelineStep({
  records = [],
  activeResume = {},
  candidateSourceCount = 0,
  profile = null,
  eligibleJobs = [],
  selectedJobId = "",
} = {}) {
  const bases = records.filter((item) => item.kind === "base");
  const variants = records.filter((item) => item.kind === "variant");
  const qa = resumeQaCounts(activeResume);
  const profileGaps = profile ? resumeProfilePublicationGaps(profile) : [];
  if (!candidateSourceCount || profileGaps.length) return { action: "sources", profileGaps };
  if (!bases.length) return { action: "base" };
  if (qa.open + qa.needsSource > 0) return { action: "qa" };
  const publication = resumePublicationStatus(activeResume, profile);
  if (!publication.ready) {
    return {
      action: "evidence",
      profileGaps: publication.profileGaps,
      documentGaps: publication.documentGaps,
    };
  }

  const selectedTarget = eligibleJobs.find((item) => item.id === selectedJobId) || null;
  if (!selectedTarget && eligibleJobs.length > 1) return { action: "target" };
  const targetJob = selectedTarget || eligibleJobs[0] || null;
  if (!targetJob) return { action: "target" };
  const targetVariant = variants.find((item) => item.jobId === targetJob.id);
  if (!targetVariant) return { action: "variant", targetJobId: targetJob.id };
  if (
    activeResume.kind !== "variant" ||
    activeResume.jobId !== targetJob.id ||
    resumeRecordId(activeResume) !== resumeRecordId(targetVariant)
  ) {
    return {
      action: "open-variant",
      targetJobId: targetJob.id,
      targetResumeId: resumeRecordId(targetVariant),
    };
  }
  if (pendingResumeVariantChangeCount(activeResume)) {
    return {
      action: "review-variant",
      targetJobId: targetJob.id,
      targetResumeId: resumeRecordId(targetVariant),
      pendingChangeCount: pendingResumeVariantChangeCount(activeResume),
    };
  }
  return {
    action: "export",
    targetJobId: targetJob.id,
    targetResumeId: resumeRecordId(targetVariant),
    exportStatus: resumeExportStatus(activeResume),
  };
}

export function selectBaseResume(records, preferredId = "") {
  const bases = baseResumeRecords(records);
  return bases.find((record) => resumeRecordId(record) === preferredId) || bases[0] || null;
}

export function isSupportedResumePhoto(value) {
  const source = String(value || "");
  return (
    source.length <= 90_000 && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(source)
  );
}
