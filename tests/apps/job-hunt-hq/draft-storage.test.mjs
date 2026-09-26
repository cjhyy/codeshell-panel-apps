import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createDraftStorage, LEGACY_DRAFT_KEY } from '../../../apps/job-hunt-hq/app/draft-storage.mjs';
const STATE = 'job-hunt-state-v1';
const OWNER = 'job-hunt-draft-owner-v1';
const methods = ['storage.getSnapshot', 'storage.compareAndSet'];
const randomId = () => randomBytes(16).toString('hex');
function browserStore() {
  const map = new Map();
  return { get length() { return map.size; }, key: i => [...map.keys()][i],
    getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
}
function host() {
  const data = new Map(), calls = [];
  const snapshot = key => data.has(key) ? { exists: true, value: structuredClone(data.get(key)),
    revision: 'sha256:' + createHash('sha256').update(JSON.stringify(data.get(key))).digest('hex') } :
    { exists: false, value: null, revision: null };
  return { data, calls, snapshot, async call(method, params) {
    calls.push({ method, params: structuredClone(params) });
    if (method === 'storage.getSnapshot') return snapshot(params.key);
    if (method === 'storage.get') return data.get(params.key) ?? null;
    if (method === 'storage.set') { data.set(params.key, structuredClone(params.value)); return true; }
    assert.equal(method, 'storage.compareAndSet');
    const updated = snapshot(params.key).revision === params.expectedRevision;
    if (updated) data.set(params.key, structuredClone(params.value));
    return { updated, snapshot: snapshot(params.key) };
  } };
}
const make = (h, storage, extra = {}) => createDraftStorage({ call: h.call, storage, methods, randomId, check() {}, ...extra });

test('same-path projects have separate stable browser drafts; legacy bytes are never adopted or removed', async () => {
  const storage = browserStore(), a = host(), b = host();
  storage.setItem(LEGACY_DRAFT_KEY, '{"resumeDraft":{"markdown":"foreign"}}');
  const first = make(a, storage); await first.load(); first.retain({ resumeDraft: { markdown: 'A' } });
  const second = make(b, storage); assert.equal((await second.load()).recovery, null);
  assert.notEqual(first.owner, second.owner);
  const reopened = make(a, storage); assert.equal((await reopened.load()).recovery.resumeDraft.markdown, 'A');
  assert.equal(reopened.backup().legacyRaw, storage.getItem(LEGACY_DRAFT_KEY));
});

test('competing startup converges on one owner while writer backups remain separate', async () => {
  const h = host(), storage = browserStore(), a = make(h, storage), b = make(h, storage);
  await Promise.all([a.load(), b.load()]); assert.equal(a.owner, b.owner);
  a.retain({ answer: 'first' }); b.retain({ answer: 'second' });
  assert.equal(a.backup().records.length, 2);
  await a.save({ answer: 'first' });
  await assert.rejects(b.save({ answer: 'second' }), /其他窗口/);
  await assert.rejects(b.save({ answer: 'third' }), /其他窗口/);
  b.retain({ answer: 'continued typing after conflict' });
  assert.ok(b.backup().records.some(r => r.raw.includes('continued typing')));
  assert.deepEqual(h.data.get(STATE), { answer: 'first' });
});

test('lost successful acknowledgement is read back, never resent', async () => {
  const h = host(); let drop = true;
  const store = make(h, browserStore(), { async call(method, params) {
    const result = await h.call(method, params);
    if (method === 'storage.compareAndSet' && params.key === STATE && drop) { drop = false; throw new Error('disconnected'); }
    return result;
  } });
  await store.load(); await store.save({ answer: 'retained' });
  assert.equal(h.calls.filter(c => c.method === 'storage.compareAndSet' && c.params.key === STATE).length, 1);
  await store.save({ answer: 'next' }); assert.equal(h.data.get(STATE).answer, 'next');
});

test('a failed read cannot become an empty writable state; corrupt browser records survive', async () => {
  const h = host(), storage = browserStore();
  const failed = make(h, storage, { async call(method, params) {
    if (params.key === STATE) throw new Error('read failed'); return h.call(method, params);
  } });
  await assert.rejects(failed.load(), /read failed/);
  await assert.rejects(failed.save({ answer: 'overwrite' }), /尚未成功读取/);
  const good = make(h, storage); await good.load(); good.retain({ answer: 'old' });
  const key = good.backup().records[0].key; storage.setItem(key, '{bad bytes');
  const bad = make(h, storage); await assert.rejects(bad.load(), /无法读取/);
  await assert.rejects(bad.save({ answer: 'overwrite' }), /无法读取/);
  assert.equal(storage.getItem(key), '{bad bytes');
});

test('old project queues and late read responses cannot dispatch or unlock writes', async () => {
  const h = host(), storage = browserStore(); let epoch = 1;
  const check = () => { if (epoch !== 1) throw new Error('project changed'); };
  const store = make(h, storage, { check }); await store.load();
  const pending = store.save({ answer: 'A' }); epoch = 2;
  await assert.rejects(pending, /project changed/);
  assert.equal(h.data.has(STATE), false);
  let release; epoch = 1;
  const slow = make(h, storage, { check, async call(method, params) {
    if (params.key === STATE) await new Promise(resolve => { release = resolve; });
    return h.call(method, params);
  } });
  const loading = slow.load(); while (!release) await new Promise(resolve => setImmediate(resolve));
  epoch = 2; release(); await assert.rejects(loading, /project changed/);
});

test('unsupported Host uses its scoped cache without global browser fallback', async () => {
  const h = host(), storage = browserStore(); storage.setItem(LEGACY_DRAFT_KEY, 'legacy');
  const store = make(h, storage, { methods: [] }); await store.load();
  store.retain({ answer: 'new' }); await store.save({ answer: 'new' });
  assert.equal(storage.length, 1); assert.equal(h.data.get(STATE).answer, 'new');
  assert.equal(h.data.has(OWNER), false);
});

test('an uncertain unsuccessful save and malformed acknowledgement block subsequent writes', async () => {
  for (const malformed of [false, true]) {
    const h = host();
    const store = make(h, browserStore(), { async call(method, params) {
      if (method === 'storage.compareAndSet' && params.key === STATE) {
        h.calls.push({ method, params });
        if (malformed) return { updated: true, snapshot: { value: null } };
        throw new Error('lost request');
      }
      return h.call(method, params);
    } });
    await store.load();
    await assert.rejects(store.save({ answer: 'first' }));
    await assert.rejects(store.save({ answer: 'second' }));
    assert.equal(h.calls.filter(c => c.method === 'storage.compareAndSet' && c.params.key === STATE).length, 1);
    assert.equal(h.data.has(STATE), false);
  }
});

test('explicit reread archives corrupt browser bytes without deleting them or ignoring later changes', async () => {
  const h = host(), storage = browserStore();
  const a = make(h, storage); await a.load(); a.retain({ answer: 'old' });
  const key = a.backup().records[0].key; storage.setItem(key, '{corrupt');
  await assert.rejects(make(h, storage).load(), /无法读取/);
  const reloaded = make(h, storage); await reloaded.load({ archiveDamagedBrowser: true });
  assert.equal(storage.getItem(key), '{corrupt');
  assert.ok(reloaded.backup().records.some(r => r.raw.includes('rawBackup') && r.raw.includes('{corrupt')));
  assert.equal((await make(h, storage).load()).recovery, null);
  storage.setItem(key, '{changed corrupt bytes');
  await assert.rejects(make(h, storage).load(), /无法读取/);
});

test('replacement archive must succeed before cache CAS and observes the last successful value', async () => {
  const h = host(), storage = browserStore();
  h.data.set(STATE, { snapshotRestoreId: '', answer: 'before restore' });
  let fail = true;
  const archived = [];
  const store = make(h, storage, { async beforeReplace(previous, next) {
    if (previous?.snapshotRestoreId === next.snapshotRestoreId) return;
    if (fail) throw new Error('archive unavailable');
    archived.push(structuredClone(previous));
  } });
  await store.load();
  const restored = { snapshotRestoreId: 'g-' + 'a'.repeat(32), answer: 'after restore' };
  await assert.rejects(store.save(restored), /archive unavailable/);
  assert.equal(h.data.get(STATE).answer, 'before restore');
  assert.equal(h.calls.filter(c => c.method === 'storage.compareAndSet' && c.params.key === STATE).length, 0);
  fail = false;
  await store.save(restored);
  await store.save({ ...restored, answer: 'next edit' });
  await store.flush();
  assert.deepEqual(archived, [{ snapshotRestoreId: '', answer: 'before restore' }]);
  assert.equal(store.backup().hostState.answer, 'next edit');
});

test('another cache writer during archival is preserved by the subsequent CAS', async () => {
  const h = host(); h.data.set(STATE, { answer: 'original' });
  const archived = [];
  const store = make(h, browserStore(), { async beforeReplace(previous) {
    archived.push(previous); h.data.set(STATE, { answer: 'concurrent winner' });
  } });
  await store.load();
  await assert.rejects(store.save({ answer: 'replacement' }), /其他窗口/);
  assert.deepEqual(archived, [{ answer: 'original' }]);
  assert.equal(h.data.get(STATE).answer, 'concurrent winner');
});
