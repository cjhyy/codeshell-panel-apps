import assert from "node:assert/strict";
import { test } from "node:test";
import { createDocumentAutosave } from "../../../apps/design-studio/app/document-autosave.mjs";

function fixture() {
  let scope = "A:first", current = 0, saved = 0, deferred = false, blockedReason = null, save;
  const timers = new Map(), writes = [], errors = [], blocked = [];
  let nextTimer = 0;
  const autosave = createDocumentAutosave({
    readState: () => ({ scope, dirty: current !== saved, deferred, blockedReason }),
    save: async () => { const captured = current; writes.push({ scope, value: captured }); if (save) await save(); saved = captured; },
    onError: error => errors.push(error.message), onBlocked: reason => blocked.push(reason),
    setTimer: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimer: id => timers.delete(id),
  });
  return { autosave, timers, writes, errors, blocked,
    edit(value) { current = value; autosave.schedule(); },
    scope(value) { scope = value; }, defer(value) { deferred = value; }, block(value) { blockedReason = value; },
    save(callback) { save = callback; },
    async tick() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test("debounce coalesces ordinary edits into one latest snapshot", async () => {
  const f = fixture(); f.edit(1); f.edit(2); assert.equal(f.timers.size, 1); await f.tick();
  assert.deepEqual(f.writes, [{ scope: "A:first", value: 2 }]); assert.deepEqual(f.errors, []);
});
test("flush publishes immediately and leaves no delayed duplicate", async () => {
  const f = fixture(); f.edit(1); await f.autosave.flush(); assert.equal(f.timers.size, 0); await f.tick();
  assert.equal(f.writes.length, 1);
});
test("overlapping flush callers share a drain which includes newer in-flight edits", async () => {
  const f = fixture(); let release;
  f.save(() => new Promise(resolve => { release = resolve; })); f.edit(1);
  const first = f.autosave.flush(); await new Promise(resolve => setImmediate(resolve));
  f.edit(2); const second = f.autosave.flush(); f.save(null); release(); await Promise.all([first, second]);
  assert.deepEqual(f.writes.map(entry => entry.value), [1, 2]);
});
test("failed publication rejects the switch drain and can be explicitly retried", async () => {
  const f = fixture(); f.save(() => { throw Error("denied"); }); f.edit(1);
  await assert.rejects(f.autosave.flush(), /denied/u); f.save(null); await f.autosave.flush();
  assert.equal(f.writes.length, 2);
});
test("a timer cannot adopt a replacement project, document or path", async () => {
  for (const scope of ["B:first", "A:second", "A:first:save-as"]) {
    const f = fixture(); f.edit(1); f.scope(scope); await f.tick(); assert.deepEqual(f.writes, []);
  }
});
test("a late old receipt cannot start another write for replacement scope", async () => {
  const f = fixture(); let release;
  f.save(() => new Promise(resolve => { release = resolve; })); f.edit(1);
  const pending = f.autosave.flush(); await new Promise(resolve => setImmediate(resolve));
  f.scope("B:first"); release(); await assert.rejects(pending, /已切换/u); assert.equal(f.writes.length, 1);
});
test("deferred transactions are rescheduled and never publish intermediate data", async () => {
  const f = fixture(); f.defer(true); f.edit(1); await f.tick(); assert.equal(f.writes.length, 0);
  assert.equal(f.timers.size, 1); f.defer(false); await f.tick(); assert.equal(f.writes.length, 1);
});
test("an explicit destination change stays blocked until the publisher establishes it", async () => {
  const f = fixture(); f.block("Confirm Save As"); f.edit(1);
  assert.deepEqual(f.blocked, ["Confirm Save As"]); assert.equal(f.timers.size, 0);
  await assert.rejects(f.autosave.flush(), /Confirm Save As/u); assert.deepEqual(f.writes, []);
});
