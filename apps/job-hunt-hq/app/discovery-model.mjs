export const DEFAULT_DISCOVERY_PROVIDER_IDS = [
  "boss",
  "linkedin",
  "lagou",
  "liepin",
  "official",
];

export const CHANNEL_VERIFICATION_STATE_IDS = [
  "unchecked",
  "checking",
  "ready",
  "login_required",
  "captcha_required",
  "blocked",
  "unavailable",
];

const CHANNEL_VERIFICATION_STATES = new Set(CHANNEL_VERIFICATION_STATE_IDS);

const SENIORITY_VALUES = new Set(["1–3 年", "3–5 年", "5–10 年", "不限"]);
const WORK_MODE_VALUES = new Set(["any", "onsite", "hybrid", "remote"]);
const COUNT_VALUES = new Set([5, 8, 10]);
const FRESHNESS_VALUES = new Set([3, 7, 14, 30, 0]);

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizedProviderUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password) return "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function providerIdBase(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const slug = hostname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return `custom-${slug || "channel"}`;
  } catch {
    return "custom-channel";
  }
}

export function normalizeCustomProviders(
  input = [],
  { reservedProviderIds = [] } = {},
) {
  if (!Array.isArray(input)) return [];
  const usedIds = new Set(
    Array.isArray(reservedProviderIds)
      ? reservedProviderIds.filter((item) => typeof item === "string")
      : [],
  );
  const usedUrls = new Set();
  const providers = [];
  for (const item of input.slice(0, 20)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const label = text(item.label, 80);
    const url = normalizedProviderUrl(item.url);
    if (!label || !url || usedUrls.has(url)) continue;
    let id = text(item.id, 80).toLowerCase();
    if (!/^custom-[a-z0-9][a-z0-9-]*$/.test(id) || usedIds.has(id)) {
      const base = providerIdBase(url);
      id = base;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${base.slice(0, 72)}-${suffix}`;
        suffix += 1;
      }
    }
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    providers.push({
      id,
      label,
      domain: `${parsed.host}${path}`,
      url,
      custom: true,
    });
    usedIds.add(id);
    usedUrls.add(url);
  }
  return providers;
}

function inferredKeyword(profile = {}) {
  const candidates = [profile.target, profile.role]
    .map((item) => text(item, 120))
    .filter(
      (item) =>
        item &&
        !["当前项目", "目标职位待确认", "等待 Agent 识别"].includes(item),
    );
  return candidates[0] || "";
}

export function normalizeDiscoveryPreferences(
  input = {},
  { profile = {}, validProviderIds = [] } = {},
) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const validProviders = new Set(
    Array.isArray(validProviderIds) ? validProviderIds.filter((item) => typeof item === "string") : [],
  );
  const requestedProviders = Array.isArray(source.providers)
    ? source.providers.filter((item) => validProviders.has(item))
    : [];
  const explicitlyDisabledAllProviders =
    Array.isArray(source.providers) && source.providers.length === 0;
  const fallbackProviders = DEFAULT_DISCOVERY_PROVIDER_IDS.filter((item) =>
    validProviders.has(item),
  );
  const count = Number(source.count);
  const freshnessDays = Number(source.freshnessDays);
  const seniority = text(source.seniority, 40);
  const workMode = text(source.workMode, 20);

  return {
    keyword: text(source.keyword, 120) || inferredKeyword(profile),
    location: text(source.location ?? source.city, 120),
    seniority: SENIORITY_VALUES.has(seniority) ? seniority : "不限",
    count: COUNT_VALUES.has(count) ? count : 8,
    providers: [
      ...new Set(
        explicitlyDisabledAllProviders
          ? []
          : requestedProviders.length
            ? requestedProviders
            : fallbackProviders,
      ),
    ],
    freshnessDays: FRESHNESS_VALUES.has(freshnessDays) ? freshnessDays : 7,
    workMode: WORK_MODE_VALUES.has(workMode) ? workMode : "any",
    exclusions: text(source.exclusions, 500),
    lastRunAt: text(source.lastRunAt, 80),
  };
}

export function normalizeChannelVerification(input = {}, validProviderIds = []) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const validProviders = new Set(
    Array.isArray(validProviderIds)
      ? validProviderIds.filter((item) => typeof item === "string")
      : [],
  );
  const providerId = text(source.providerId, 80);
  if (!validProviders.has(providerId)) return null;
  const state = text(source.state, 40);
  return {
    providerId,
    state: CHANNEL_VERIFICATION_STATES.has(state) ? state : "unchecked",
    checkedAt: text(source.checkedAt, 80),
    sessionId: text(source.sessionId, 160),
    detail: text(source.detail, 1000),
  };
}

export function normalizeChannelVerifications(input = [], validProviderIds = []) {
  if (!Array.isArray(input)) return [];
  const records = new Map();
  for (const item of input) {
    const record = normalizeChannelVerification(item, validProviderIds);
    if (record) records.set(record.providerId, record);
  }
  return [...records.values()];
}

export function resolveChannelVerificationForSession(
  providerId,
  records = [],
  sessionId = "",
) {
  const record = Array.isArray(records)
    ? records.find((item) => item?.providerId === providerId)
    : null;
  if (!record) {
    return {
      providerId,
      state: "unchecked",
      checkedAt: "",
      sessionId: "",
      detail: "尚未在当前 Session 验证",
    };
  }
  const normalizedSessionId = text(sessionId, 160);
  if (!normalizedSessionId || record.sessionId !== normalizedSessionId) {
    return {
      ...record,
      state: "stale",
      detail: "上次验证属于另一个 Session，需要重新验证",
    };
  }
  return { ...record };
}

function validTime(value) {
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) ? time : null;
}

function ageInDays(time, now) {
  return Math.max(0, Math.floor((now - time) / 86_400_000));
}

export function resolveJobRecency(job = {}, now = Date.now()) {
  const published = validTime(job.publishedAt);
  if (published !== null) {
    const days = ageInDays(published, now);
    return {
      state: days <= 7 ? "fresh" : days <= 30 ? "recent" : "stale",
      label: days === 0 ? "今天发布" : `${days} 天前发布`,
      source: "published",
    };
  }
  const fetched = validTime(job.fetchedAt);
  if (fetched !== null) {
    const days = ageInDays(fetched, now);
    return {
      state: days <= 7 ? "verified" : "stale",
      label: days === 0 ? "今天核验" : `${days} 天前核验`,
      source: "fetched",
    };
  }
  return { state: "unknown", label: "时间待核验", source: "none" };
}
