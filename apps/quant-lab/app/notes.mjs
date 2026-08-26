export const NOTES_PATH = "portfolio/journal.json";
export const MAX_NOTES_BYTES = 480 * 1024;

const MARKETS = new Set(["cn", "us"]);
const LINK_TYPES = new Set(["instrument", "transaction", "news", "rule"]);

export class NotesValidationError extends Error {
  constructor(code, path, message) {
    super(`${code} at ${path}: ${message}`);
    this.name = "NotesValidationError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new NotesValidationError(code, path, message);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid-object", path, "object required");
  return value;
}

function exact(value, allowed, path) {
  object(value, path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("unknown-field", `${path}.${key}`, "field is not allowed");
}

function string(value, path, maximum, { empty = false } = {}) {
  if (typeof value !== "string" || value.length > maximum || (!empty && !value.trim()) || /\u0000/u.test(value)) {
    fail("invalid-string", path, `${empty ? "string" : "non-empty string"} up to ${maximum} characters required`);
  }
  return value;
}

function iso(value, path) {
  string(value, path, 64);
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/u,
  );
  if (!match) {
    fail("invalid-datetime", path, "ISO date-time with timezone required");
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, _fraction, zone, _sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteText);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    fail("invalid-datetime", path, "valid calendar date, clock time and UTC offset required");
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail("invalid-datetime", path, "ISO date-time required");
  return new Date(milliseconds).toISOString();
}

function noteId(value, path) {
  const result = string(value, path, 96);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u.test(result)) {
    fail("invalid-id", path, "safe note id required");
  }
  return result;
}

function canonicalSymbol(value, market, path) {
  const symbol = string(value, path, 32).trim().toUpperCase();
  if (market === "cn" && /^(?:SH|SZ)\d{6}$/u.test(symbol)) return symbol;
  if (market === "us" && /^[A-Z][A-Z0-9.-]{0,15}$/u.test(symbol)) return symbol;
  fail("invalid-symbol", path, `canonical ${market} symbol required`);
}

function fingerprintText(input) {
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16_777_619);
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function linkKey(link) {
  if (link.type === "instrument") return `${link.type}:${link.market}:${link.symbol}`;
  if (link.type === "transaction") return `${link.type}:${link.transactionId}`;
  if (link.type === "news") return `${link.type}:${link.newsItemId}:${link.fingerprint}`;
  return `${link.type}:${link.ruleId}:${link.evidenceAsOf}`;
}

function validateLink(input, path) {
  object(input, path);
  if (!LINK_TYPES.has(input.type)) fail("invalid-link-type", `${path}.type`, "supported link type required");
  if (input.type === "instrument") {
    exact(input, ["type", "symbol", "market"], path);
    if (!MARKETS.has(input.market)) fail("invalid-market", `${path}.market`, "cn or us required");
    return { type: input.type, symbol: canonicalSymbol(input.symbol, input.market, `${path}.symbol`), market: input.market };
  }
  if (input.type === "transaction") {
    exact(input, ["type", "transactionId"], path);
    return { type: input.type, transactionId: string(input.transactionId, `${path}.transactionId`, 128) };
  }
  if (input.type === "news") {
    exact(input, ["type", "newsItemId", "fingerprint"], path);
    return {
      type: input.type,
      newsItemId: string(input.newsItemId, `${path}.newsItemId`, 180),
      fingerprint: string(input.fingerprint, `${path}.fingerprint`, 64),
    };
  }
  exact(input, ["type", "ruleId", "evidenceAsOf"], path);
  return {
    type: input.type,
    ruleId: string(input.ruleId, `${path}.ruleId`, 96),
    evidenceAsOf: iso(input.evidenceAsOf, `${path}.evidenceAsOf`),
  };
}

function validateNote(input, path) {
  exact(input, ["id", "createdAt", "updatedAt", "title", "body", "tags", "links", "revision", "fingerprint"], path);
  const createdAt = iso(input.createdAt, `${path}.createdAt`);
  const updatedAt = iso(input.updatedAt, `${path}.updatedAt`);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) fail("invalid-order", `${path}.updatedAt`, "updatedAt must not precede createdAt");
  if (!Array.isArray(input.tags) || input.tags.length > 20) fail("invalid-tags", `${path}.tags`, "up to 20 tags required");
  const tags = input.tags.map((tag, index) => string(tag, `${path}.tags[${index}]`, 32).trim());
  if (new Set(tags).size !== tags.length) fail("duplicate-tag", `${path}.tags`, "tags must be unique");
  if (!Array.isArray(input.links) || input.links.length > 32) fail("invalid-links", `${path}.links`, "up to 32 links required");
  const links = input.links.map((link, index) => validateLink(link, `${path}.links[${index}]`));
  if (new Set(links.map(linkKey)).size !== links.length) fail("duplicate-link", `${path}.links`, "links must be unique");
  if (!Number.isInteger(input.revision) || input.revision < 1) fail("invalid-revision", `${path}.revision`, "positive integer required");
  const note = {
    id: noteId(input.id, `${path}.id`),
    createdAt,
    updatedAt,
    title: string(input.title, `${path}.title`, 160),
    body: string(input.body, `${path}.body`, 100_000, { empty: true }),
    tags,
    links,
    revision: input.revision,
    fingerprint: string(input.fingerprint, `${path}.fingerprint`, 64),
  };
  const expected = noteFingerprint(note);
  if (note.fingerprint !== expected) fail("fingerprint-mismatch", `${path}.fingerprint`, "note content changed");
  return note;
}

export function noteFingerprint(note) {
  return fingerprintText(JSON.stringify({
    id: note.id,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    title: note.title,
    body: note.body,
    tags: note.tags,
    links: note.links,
    revision: note.revision,
  }));
}

export function createEmptyNotes(now = new Date().toISOString()) {
  return { format: "codeshell.journal", version: 1, updatedAt: iso(now, "$notes.updatedAt"), entries: [] };
}

export function createNote(draft, { id, now = new Date().toISOString(), createdAt = now, revision = 1 } = {}) {
  object(draft, "$draft");
  exact(draft, ["title", "body", "tags", "links"], "$draft");
  const candidate = {
    id: noteId(id, "$draft.id"),
    createdAt: iso(createdAt, "$draft.createdAt"),
    updatedAt: iso(now, "$draft.updatedAt"),
    title: draft.title,
    body: draft.body,
    tags: draft.tags,
    links: draft.links,
    revision,
    fingerprint: "pending",
  };
  candidate.fingerprint = noteFingerprint(candidate);
  return validateNote(candidate, "$note");
}

export function parseNotes(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_NOTES_BYTES) fail("size-limit", "$notes", `file exceeds ${MAX_NOTES_BYTES} bytes`);
  let value;
  try { value = JSON.parse(text); } catch { fail("invalid-json", "$notes", "valid JSON required"); }
  exact(value, ["format", "version", "updatedAt", "entries"], "$notes");
  if (value.format !== "codeshell.journal") fail("invalid-format", "$notes.format", "codeshell.journal required");
  if (value.version !== 1) fail("invalid-version", "$notes.version", "version 1 required");
  if (!Array.isArray(value.entries) || value.entries.length > 2000) fail("invalid-entries", "$notes.entries", "entry array required");
  const entries = value.entries.map((entry, index) => validateNote(entry, `$notes.entries[${index}]`));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) fail("duplicate-id", "$notes.entries", "note ids must be unique");
  return { format: value.format, version: 1, updatedAt: iso(value.updatedAt, "$notes.updatedAt"), entries };
}

export function serializeNotes(value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  parseNotes(text);
  return text;
}

function linkLookup(context) {
  const ledger = context.ledger ?? {};
  return {
    instruments: new Map((ledger.instruments ?? []).map((item) => [`${item.market}:${item.symbol}`, item])),
    transactions: new Map((ledger.transactions ?? []).map((item) => [item.id, item])),
    news: new Map((context.news?.items ?? []).map((item) => [item.id, item])),
    rules: new Map((context.rules ?? []).map((item) => [item.id, item])),
  };
}

export function resolveNoteLinks(note, context = {}) {
  const lookup = linkLookup(context);
  const links = note.links.map((link) => {
    let current = null;
    let changed = false;
    if (link.type === "instrument") current = lookup.instruments.get(`${link.market}:${link.symbol}`) ?? null;
    else if (link.type === "transaction") current = lookup.transactions.get(link.transactionId) ?? null;
    else if (link.type === "news") {
      current = lookup.news.get(link.newsItemId) ?? null;
      changed = Boolean(current && current.fingerprint !== link.fingerprint);
    } else {
      current = lookup.rules.get(link.ruleId) ?? null;
      changed = Boolean(current && current.asOf !== link.evidenceAsOf);
    }
    return { link, status: current ? (changed ? "changed" : "current") : "orphan", current, untrusted: link.type === "news" };
  });
  return { note, links, status: links.some((item) => item.status === "orphan") ? "orphan" : links.some((item) => item.status === "changed") ? "changed" : "current" };
}

function timeOf(value) {
  for (const field of ["occurredAt", "createdAt", "publishedAt", "availableAt", "asOf", "derivedAt", "tradeDate", "valuationDate", "effectiveDate"]) {
    if (!value?.[field]) continue;
    const raw = /^\d{4}-\d{2}-\d{2}$/u.test(value[field]) ? `${value[field]}T00:00:00.000Z` : value[field];
    if (Number.isFinite(Date.parse(raw))) return new Date(raw).toISOString();
  }
  return null;
}

export function buildReviewTimeline({ notes = [], ledger = {}, holdings = null, news = null, rules = [] } = {}) {
  const safeLedger = ledger ?? {};
  const noteByLink = new Map();
  for (const note of notes) for (const link of note.links) {
    const id = link.type === "instrument" ? `${link.market}:${link.symbol}` : link.transactionId ?? link.newsItemId ?? link.ruleId;
    const key = `${link.type}:${id}`;
    noteByLink.set(key, [...(noteByLink.get(key) ?? []), note.id]);
  }
  const base = (type, id, occurredAt, source, record, currentStatus, noteIds = []) => ({ type, id, occurredAt, source, record, currentStatus, noteIds });
  const items = notes.map((note) => base("note", note.id, note.createdAt, NOTES_PATH, note, resolveNoteLinks(note, { ledger: safeLedger, holdings, news, rules }).status, [note.id]));
  for (const transaction of safeLedger.transactions ?? []) items.push(base("transaction", transaction.id, timeOf(transaction), NOTES_PATH.replace("journal", "transactions"), transaction, "current", noteByLink.get(`transaction:${transaction.id}`) ?? []));
  if (holdings) items.push(base("holding", "holdings-current", timeOf(holdings), "portfolio/holdings.json", holdings, "current", []));
  for (const item of news?.items ?? []) {
    const ids = noteByLink.get(`news:${item.id}`) ?? [];
    const saved = notes.flatMap((note) => note.links).find((link) => link.type === "news" && link.newsItemId === item.id);
    items.push(base("news", item.id, timeOf(item), "data/news/feed.json · untrusted", item, saved && saved.fingerprint !== item.fingerprint ? "changed" : "current", ids));
  }
  for (const rule of rules) {
    const ids = noteByLink.get(`rule:${rule.id}`) ?? [];
    const saved = notes.flatMap((note) => note.links).find((link) => link.type === "rule" && link.ruleId === rule.id);
    items.push(base("rule", rule.id, timeOf(rule), rule.source ?? "portfolio-rules", rule, saved && saved.evidenceAsOf !== rule.asOf ? "changed" : "current", ids));
  }
  return items.sort((left, right) => (Date.parse(right.occurredAt ?? 0) - Date.parse(left.occurredAt ?? 0)) || left.type.localeCompare(right.type) || left.id.localeCompare(right.id));
}

export function buildDecisionFacts(notes, transactions, _now = new Date()) {
  const linked = new Set(notes.flatMap((note) => note.links).filter((link) => link.type === "transaction").map((link) => link.transactionId));
  const availableAt = notes.map((note) => note.updatedAt).sort().at(-1) ?? null;
  return {
    status: "available",
    linkedTransactions: transactions.filter((item) => linked.has(item.id)).length,
    unlinkedTransactions: transactions.filter((item) => !linked.has(item.id)).length,
    source: NOTES_PATH,
    availableAt,
  };
}
