import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createRecoverySession } from "../../../apps/design-studio/app/recovery-session.mjs";

const revision = (value) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
function fixture() {
  let record = { exists: false, value: null, revision: null },
    epoch = 0;
  let availableMethods = ["storage.getSnapshot", "storage.compareAndSet"];
  const calls = [];
  const backend = async (method, params) => {
    calls.push({ method, ...structuredClone(params) });
    if (method === "storage.getSnapshot") return structuredClone(record);
    if (method === "storage.get") return structuredClone(record.value);
    if (method === "storage.compareAndSet") {
      if (record.revision !== params.expectedRevision)
        return { updated: false, snapshot: structuredClone(record) };
      record = params.remove
        ? { exists: false, value: null, revision: null }
        : { exists: true, value: structuredClone(params.value), revision: revision(params.value) };
      return { updated: true, snapshot: structuredClone(record) };
    }
    if (method === "storage.set")
      record = { exists: true, value: params.value, revision: revision(params.value) };
    if (method === "storage.delete") record = { exists: false, value: null, revision: null };
  };
  const session = (call = backend) =>
    createRecoverySession({
      call,
      key: "recovery",
      epoch,
      currentEpoch: () => epoch,
      getContext: () => ({ availableMethods }),
    });
  return {
    calls,
    backend,
    session,
    get record() {
      return record;
    },
    switchProject() {
      epoch++;
    },
    legacy() {
      availableMethods = [];
    },
  };
}

test("two windows cannot overwrite or delete each other's recovery; explicit reload establishes the new basis", async () => {
  const f = fixture(),
    a = f.session(),
    b = f.session();
  await Promise.all([a.load(), b.load()]);
  await a.save({ page: "A" });
  await assert.rejects(b.save({ page: "B" }), { code: "RECOVERY_CONFLICT" });
  await assert.rejects(b.clear(), { code: "RECOVERY_CONFLICT" });
  assert.deepEqual(f.record.value, { page: "A" });
  assert.deepEqual(await b.load(), { page: "A" });
  await b.save({ page: "B reviewed" });
  await assert.rejects(a.clear(), { code: "RECOVERY_CONFLICT" });
  await b.clear();
  assert.equal(f.record.exists, false);
});

test("failed or malformed reads cannot authorize save or deletion", async () => {
  for (const result of [
    undefined,
    { exists: true, value: {}, revision: "bad" },
    { exists: false, value: 1, revision: null },
  ]) {
    const f = fixture(),
      a = f.session(async () => result);
    await assert.rejects(a.load());
    await assert.rejects(a.save({ page: "A" }));
    await assert.rejects(a.clear());
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(),
    a = f.session(async () => {
      throw Error("offline");
    });
  await assert.rejects(a.load(), /offline/);
  await assert.rejects(a.save({}), /offline/);
});

test("lost write receipt is queried once and never resent", async () => {
  const f = fixture();
  const a = f.session(async (method, params) => {
    const result = await f.backend(method, params);
    if (method === "storage.compareAndSet") throw Error("lost receipt");
    return result;
  });
  await a.load();
  await a.save({ value: 1 });
  await a.clear();
  assert.equal(f.calls.filter((c) => c.method === "storage.compareAndSet").length, 2);
  assert.equal(a.blocked, null);
  assert.equal(f.record.exists, false);
});

test("uncertain writes and invalid acknowledgements block later edits", async () => {
  for (const mode of ["lost", "invalid"]) {
    const f = fixture();
    const a = f.session(async (method, params) => {
      if (method === "storage.compareAndSet") {
        if (mode === "lost") throw Error("offline before commit");
        return { updated: true, snapshot: { exists: false, value: null, revision: null } };
      }
      return f.backend(method, params);
    });
    await a.load();
    await assert.rejects(a.save({ value: 1 }), { code: "RECOVERY_UNCERTAIN" });
    await assert.rejects(a.clear(), { code: "RECOVERY_UNCERTAIN" });
    assert.equal(f.record.exists, false);
  }
});

test("queued writes detach inputs and cannot issue any call after project changes", async () => {
  const f = fixture();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const a = f.session(async (method, params) => {
    const result = await f.backend(method, params);
    if (method === "storage.compareAndSet") {
      entered();
      await pending;
    }
    return result;
  });
  await a.load();
  const value = { page: "original" };
  const first = a.save(value);
  value.page = "mutated";
  const second = a.save({ page: "queued" });
  const firstCheck = assert.rejects(first, { code: "PROJECT_CHANGED" });
  const secondCheck = assert.rejects(second, { code: "PROJECT_CHANGED" });
  await started;
  f.switchProject();
  release();
  await Promise.all([firstCheck, secondCheck]);
  assert.equal(f.calls.filter((c) => c.method === "storage.compareAndSet").length, 1);
  assert.deepEqual(f.record.value, { page: "original" });
});

test("capability changes cannot silently downgrade conditional saves", async () => {
  const f = fixture(),
    a = f.session();
  await a.load();
  f.legacy();
  await assert.rejects(a.save({}), { code: "RECOVERY_MODE_CHANGED" });
  assert.equal(f.calls.length, 1);
});

test("legacy mode is explicit and still requires a successful read", async () => {
  const f = fixture();
  f.legacy();
  const a = f.session();
  assert.equal(a.versioned, false);
  await assert.rejects(a.save({}), { code: "RECOVERY_NOT_LOADED" });
  await a.load();
  await a.save({ legacy: true });
  await a.clear();
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["storage.get", "storage.set", "storage.delete"],
  );
});
