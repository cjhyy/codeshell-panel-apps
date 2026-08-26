import assert from "node:assert/strict";
import {
  MAX_NOTES_BYTES,
  buildDecisionFacts,
  buildReviewTimeline,
  createEmptyNotes,
  createNote,
  parseNotes,
  resolveNoteLinks,
  serializeNotes,
} from "../apps/quant-lab/app/notes.mjs";
import {
  NotesStoreConflictError,
  commitNoteChange,
  loadNotes,
} from "../apps/quant-lab/app/notes-store.mjs";

const at = "2026-08-26T00:00:00.000Z";
const links = [
  { type: "instrument", symbol: "AAPL", market: "us" },
  { type: "transaction", transactionId: "tx-profit" },
  { type: "news", newsItemId: "news-1", fingerprint: "fnv1a32:11111111" },
  { type: "rule", ruleId: "review-due", evidenceAsOf: at },
];
const note = createNote({ title: "记录 <img src=x onerror=alert(1)>", body: "<script>evil()</script>\n原样纯文本", tags: ["AAPL", "复盘"], links }, { id: "note-1", now: at });
const source = serializeNotes({ ...createEmptyNotes(at), entries: [note], updatedAt: at });
const parsed = parseNotes(source);
assert.equal(parsed.format, "codeshell.journal");
assert.equal(parsed.version, 1);
assert.equal(parsed.entries[0].body, "<script>evil()</script>\n原样纯文本");
assert.equal(parsed.entries[0].links.length, 4);
assert.throws(() => parseNotes(source.replace('"version": 1', '"version": 2')), /invalid-version/u);
assert.throws(() => parseNotes(source.replace('"title":', '"unknown": true, "title":')), /unknown-field/u);
assert.throws(() => parseNotes(source.replace('"transactionId":', '"unknown": true, "transactionId":')), /unknown-field/u);
assert.throws(() => parseNotes("{"), /invalid-json/u);
assert.throws(() => parseNotes(`${JSON.stringify({ ...parsed, entries: [note, note] })}\n`), /duplicate-id/u);
assert.throws(() => createNote({ title: "x", body: "y", tags: [], links: [{ type: "news", newsItemId: "n" }] }, { id: "n", now: at }), /unknown-field|invalid-string/u);
assert.throws(() => createNote({ title: "x", body: "y", tags: [], links: [] }, { id: "   ", now: at }), /invalid-string/u);
assert.throws(() => createNote({ title: "x", body: "y", tags: [], links: [] }, { id: "bad/id", now: at }), /invalid-id/u);
assert.throws(() => createNote({ title: "x", body: "y", tags: [], links: [] }, { id: "n", now: "2026-02-31T00:00:00Z" }), /invalid-datetime/u);
assert.throws(() => createNote({ title: "x", body: "y", tags: [], links: [] }, { id: "n", now: "2026-02-28T24:00:00Z" }), /invalid-datetime/u);
assert.throws(() => createNote({ title: "x", body: "y", tags: [], links: [] }, { id: "n", now: "2026-02-28T12:00:00+15:00" }), /invalid-datetime/u);
assert.throws(() => createNote({ title: "x", body: "y", tags: [], links: [{ type: "rule", ruleId: "r", evidenceAsOf: "2026-08-26" }] }, { id: "n", now: at }), /invalid-datetime/u);
assert.throws(() => createNote({ title: "x", body: "y", tags: [], links: [links[0], links[0]] }, { id: "n", now: at }), /duplicate-link/u);
assert.throws(() => parseNotes(`{"x":"${"a".repeat(MAX_NOTES_BYTES)}"}`), /size-limit/u);

const ledger = {
  instruments: [{ id: "us-aapl", symbol: "AAPL", market: "us", name: "Apple" }],
  transactions: [
    { id: "tx-loss", instrumentId: "us-aapl", occurredAt: "2026-08-25T10:00:00Z", pnl: "-10.00" },
    { id: "tx-profit", instrumentId: "us-aapl", occurredAt: "2026-08-25T10:00:00Z", pnl: "10.00" },
  ],
};
const feed = { items: [{ id: "news-1", fingerprint: "fnv1a32:22222222", title: "<b>untrusted</b>", publishedAt: "2026-08-25T10:00:00Z", source: "sec-edgar" }] };
const rules = [{ id: "review-due", asOf: "2026-08-26T01:00:00Z", source: "portfolio-rules", status: "warning" }];
const resolved = resolveNoteLinks(note, { ledger, holdings: { derivedAt: at, positionsByAccount: [] }, news: feed, rules });
assert.deepEqual(resolved.links.map((item) => item.status), ["current", "current", "changed", "changed"]);
assert.equal(resolved.links[2].current.title, "<b>untrusted</b>");
const orphaned = resolveNoteLinks(note, { ledger: { instruments: [], transactions: [] }, holdings: null, news: { items: [] }, rules: [] });
assert(orphaned.links.every((item) => item.status === "orphan"));

const timeline = buildReviewTimeline({ notes: [note], ledger, holdings: { derivedAt: at, positionsByAccount: [] }, news: feed, rules });
assert.deepEqual(timeline.slice(0, 4).map((item) => `${item.type}:${item.id}`), [
  "rule:review-due",
  "holding:holdings-current",
  "note:note-1",
  "news:news-1",
]);
const paired = timeline.filter((item) => item.type === "transaction");
assert.deepEqual(paired.map((item) => item.id), ["tx-loss", "tx-profit"]);
assert.deepEqual(Object.keys(paired[0]).sort(), Object.keys(paired[1]).sort());
assert.equal(JSON.stringify(timeline).includes("correct"), false);
assert.equal(JSON.stringify(timeline).includes("错误"), false);
const facts = buildDecisionFacts([note], ledger.transactions, new Date("2026-08-27T00:00:00Z"));
assert.deepEqual(facts, { status: "available", linkedTransactions: 1, unlinkedTransactions: 1, source: "portfolio/journal.json", availableAt: at });

function hostFixture(initial = null) {
  let file = initial ? { content: initial, modifiedAt: 1, revision: "rev-1" } : null;
  let writes = 0;
  return {
    get file() { return file; },
    get writes() { return writes; },
    appear(content = serializeNotes(createEmptyNotes(at))) { file = { content, modifiedAt: 2, revision: "rev-2" }; },
    mutate(content) { file = { content, modifiedAt: (file?.modifiedAt ?? 0) + 1, revision: `rev-${(file?.modifiedAt ?? 0) + 1}` }; },
    async call(method, params) {
      if (method === "workspace.list") return { entries: file ? [{ kind: "file", path: "portfolio/journal.json", name: "journal.json" }] : [], truncated: false };
      if (method === "workspace.readText") {
        if (!file) throw new Error("ENOENT");
        return { ...file };
      }
      if (method === "workspace.writeText") {
        if (!file && params.expectedModifiedAt !== null) throw new Error("create condition missing");
        if (file && params.expectedModifiedAt === null) throw new Error("file exists");
        if (file && params.expectedRevision && params.expectedRevision !== file.revision) throw new Error("revision conflict");
        writes += 1;
        file = { content: params.content, modifiedAt: (file?.modifiedAt ?? 0) + 1, revision: `rev-w${writes}` };
        return { modifiedAt: file.modifiedAt, revision: file.revision };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

const host = hostFixture();
const base = await loadNotes(host.call.bind(host), { expectedEpoch: 1, currentEpoch: () => 1 });
const created = await commitNoteChange(host.call.bind(host), { type: "create", draft: { title: "draft", body: "body", tags: [], links } }, { baseFile: base.file, expectedEpoch: 1, currentEpoch: () => 1, now: at });
assert.equal(created.document.entries.length, 1);
assert.equal(host.writes, 1);
// Round 17: a stale expectedRevision must be rejected by the store itself even when the
// file token is unchanged; the draft is returned and nothing is written.
await assert.rejects(() => commitNoteChange(host.call.bind(host), { type: "update", id: created.note.id, expectedRevision: 99, draft: { title: "stale", body: "stale draft", tags: [], links } }, { baseFile: created.file, expectedEpoch: 1, currentEpoch: () => 1, now: at }), (error) => error instanceof NotesStoreConflictError && /revision changed/u.test(error.message) && error.draft.body === "stale draft");
assert.equal(host.writes, 1, "stale revision must not write");
const edited = await commitNoteChange(host.call.bind(host), { type: "update", id: created.note.id, expectedRevision: 1, draft: { title: "edited", body: "kept", tags: [], links } }, { baseFile: created.file, expectedEpoch: 1, currentEpoch: () => 1, now: "2026-08-26T00:01:00Z" });
assert.equal(edited.note.revision, 2);
const deleted = await commitNoteChange(host.call.bind(host), { type: "delete", id: edited.note.id, expectedRevision: 2 }, { baseFile: edited.file, expectedEpoch: 1, currentEpoch: () => 1, now: "2026-08-26T00:02:00Z" });
assert.equal(deleted.document.entries.length, 0);

const raceHost = hostFixture();
const absent = await loadNotes(raceHost.call.bind(raceHost), { expectedEpoch: 1, currentEpoch: () => 1 });
raceHost.appear();
await assert.rejects(() => commitNoteChange(raceHost.call.bind(raceHost), { type: "create", draft: { title: "preserve", body: "draft", tags: [], links: [] } }, { baseFile: absent.file, expectedEpoch: 1, currentEpoch: () => 1, now: at }), (error) => error instanceof NotesStoreConflictError && error.frozen && error.draft.body === "draft");
assert.equal(raceHost.writes, 0);

const conflictHost = hostFixture(source);
const conflictBase = await loadNotes(conflictHost.call.bind(conflictHost), { expectedEpoch: 1, currentEpoch: () => 1 });
conflictHost.mutate(source.replace("原样纯文本", "external edit"));
await assert.rejects(() => commitNoteChange(conflictHost.call.bind(conflictHost), { type: "update", id: "note-1", expectedRevision: 1, draft: { title: "keep", body: "my draft", tags: [], links: [] } }, { baseFile: conflictBase.file, expectedEpoch: 1, currentEpoch: () => 1, now: at }), (error) => error instanceof NotesStoreConflictError && error.draft.body === "my draft");
await assert.rejects(() => loadNotes(host.call.bind(host), { expectedEpoch: 1, currentEpoch: () => 2 }), /workspace epoch changed/u);

console.log("✓ Quant Lab M5 notes schema / links / timeline / store conflict tests");
