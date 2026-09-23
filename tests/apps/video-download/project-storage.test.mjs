import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createProjectStorage } from "../../../apps/video-download/app/project-storage.js";

test("project recovery uses advertised Host storage without browser storage", async () => {
  let record;
  const storage = createProjectStorage({
    panel: {
      async call(method, args) {
        if (method === "storage.set") record = structuredClone(args.value);
        else return record;
      },
    },
    key: "pending",
    getScope: () => "/one",
    getContext: () => ({
      cwd: "/one",
      apiVersion: 8,
      availableMethods: ["storage.get", "storage.set"],
    }),
  });
  await storage.save({ taskId: "task-1" });
  assert.deepEqual(await storage.load(), { taskId: "task-1" });
  record.scope = "/other";
  assert.equal(await storage.load(), null);
  await storage.save(null);
  assert.equal(await storage.load(), null);
});

test("workspace switches reject recovery writes without changing another project", async () => {
  let calls = 0;
  const storage = createProjectStorage({
    panel: {
      call() {
        calls++;
      },
    },
    key: "pending",
    getScope: () => "/old",
    getContext: () => ({ cwd: "/new", apiVersion: 14 }),
  });
  await assert.rejects(storage.save({ taskId: "old" }), /项目已变化/);
  assert.equal(calls, 0);
});

test("failed Host writes remain failures instead of silently using browser storage", async () => {
  const storage = createProjectStorage({
    panel: {
      call() {
        throw new Error("disk full");
      },
    },
    key: "pending",
    getScope: () => "/one",
    getContext: () => ({ cwd: "/one", apiVersion: 14 }),
  });
  await assert.rejects(storage.save({ taskId: "one" }), /disk full/);
});

test("an existing recovery store cannot follow a workspace switch", async () => {
  let scope = "/one";
  const calls = [];
  const storage = createProjectStorage({
    panel: {
      async call(method, args) {
        calls.push({ method, args });
        return null;
      },
    },
    key: "pending",
    getScope: () => scope,
    getContext: () => ({ cwd: scope, apiVersion: 14 }),
  });
  await storage.load();
  scope = "/two";
  await assert.rejects(storage.save({ taskId: "old-task" }), /项目已变化/);
  assert.equal(calls.length, 1);
});

function versionedFixture() {
  const values = new Map();
  const calls = [];
  let loseReply = false;
  let failBefore = false;
  const current = (key) =>
    values.has(key)
      ? {
          exists: true,
          value: structuredClone(values.get(key)),
          revision:
            "sha256:" +
            createHash("sha256")
              .update(JSON.stringify([key, values.get(key)]))
              .digest("hex"),
        }
      : { exists: false, value: null, revision: null };
  const panel = {
    async call(method, args) {
      calls.push({ method, args: structuredClone(args) });
      if (method === "storage.getSnapshot") return current(args.key);
      assert.equal(method, "storage.compareAndSet");
      if (failBefore) throw new Error("connection lost before saving");
      if (current(args.key).revision !== args.expectedRevision)
        return { updated: false, snapshot: current(args.key) };
      values.set(args.key, structuredClone(args.value));
      if (loseReply) throw new Error("reply lost after saving");
      return { updated: true, snapshot: current(args.key) };
    },
  };
  const options = {
    panel,
    key: "draft",
    getScope: () => "/one",
    getContext: () => ({
      cwd: "/one",
      availableMethods: ["storage.getSnapshot", "storage.compareAndSet"],
    }),
  };
  return {
    values,
    calls,
    panel,
    options,
    create: (extra) => createProjectStorage({ ...options, ...extra }),
    loseReply: () => {
      loseReply = true;
    },
    failBefore: () => {
      failBefore = true;
    },
  };
}

test("two devices reject stale saves until the losing device reloads", async () => {
  const f = versionedFixture();
  const desktop = f.create(),
    phone = f.create();
  assert.equal(await desktop.load(), null);
  assert.equal(await phone.load(), null);
  await desktop.save({ queue: ["desktop"] });
  await assert.rejects(phone.save({ queue: ["phone"] }), { code: "STORAGE_CONFLICT" });
  const count = f.calls.length;
  await assert.rejects(phone.save({ queue: ["retry"] }), { code: "STORAGE_CONFLICT" });
  assert.equal(f.calls.length, count, "a conflict must not silently adopt the returned revision");
  assert.deepEqual(await phone.load(), { queue: ["desktop"] });
  await phone.save({ queue: ["desktop", "phone"] });
  assert.deepEqual(await desktop.load(), { queue: ["desktop", "phone"] });
});

test("a missing save reply queries the exact result once without replaying the write", async () => {
  const f = versionedFixture();
  const storage = f.create();
  await storage.load();
  f.loseReply();
  await storage.save({ task: "stable-id" });
  assert.equal(f.calls.filter((call) => call.method === "storage.compareAndSet").length, 1);
  assert.deepEqual(await storage.load(), { task: "stable-id" });
});

test("an unconfirmed save blocks later queued writes without falling back to legacy storage", async () => {
  const f = versionedFixture();
  const storage = f.create();
  await storage.load();
  f.failBefore();
  const results = await Promise.allSettled([storage.save(1), storage.save(2)]);
  assert.ok(
    results.every(
      (result) => result.status === "rejected" && result.reason.code === "STORAGE_UNCERTAIN",
    ),
  );
  assert.equal(f.calls.filter((call) => call.method === "storage.compareAndSet").length, 1);
  assert.equal(f.values.size, 0);
});

test("same-page saves serialize revisions and capture values before awaiting", async () => {
  const f = versionedFixture();
  const storage = f.create();
  await storage.load();
  const value = { revision: 1 };
  const first = storage.save(value);
  value.revision = 99;
  const second = storage.save({ revision: 2 });
  await Promise.all([first, second]);
  const writes = f.calls.filter((call) => call.method === "storage.compareAndSet");
  assert.equal(writes[0].args.value.value.revision, 1);
  assert.notEqual(writes[1].args.expectedRevision, null);
  assert.deepEqual(await storage.load(), { revision: 2 });
});

test("raw storage preserves the existing queue and archive JSON layout", async () => {
  const f = versionedFixture();
  const original = { scope: "/one", queue: [1], schema: 2 };
  f.values.set("draft", original);
  const storage = f.create({ envelope: false });
  assert.deepEqual(await storage.load(), original);
  await storage.save({ ...original, queue: [1, 2] });
  assert.deepEqual(f.values.get("draft"), { ...original, queue: [1, 2] });
});

test("saving before loading may create an empty key but cannot overwrite unseen saved state", async () => {
  const f = versionedFixture();
  const first = f.create();
  await first.save("original");
  const second = f.create();
  await assert.rejects(second.save("unseen overwrite"), { code: "STORAGE_CONFLICT" });
  assert.equal(await second.load(), "original");
});

test("project switches while saving never apply another project's revision", async () => {
  const f = versionedFixture();
  let scope = "/one";
  const storage = f.create({
    getScope: () => scope,
    getContext: () => ({ ...f.options.getContext(), cwd: scope }),
  });
  await storage.load();
  const original = f.panel.call;
  f.panel.call = async (...args) => {
    const result = await original(...args);
    scope = "/two";
    return result;
  };
  await assert.rejects(storage.save("late"), /项目已变化/);
  await assert.rejects(storage.save("retry"), /项目已变化/);
  assert.equal(f.values.get("draft").scope, "/one");
});

test("a live capability downgrade cannot turn a conditional save into a blind legacy write", async () => {
  const f = versionedFixture();
  let methods = f.options.getContext().availableMethods;
  const storage = f.create({ getContext: () => ({ cwd: "/one", availableMethods: methods }) });
  await storage.load();
  methods = ["storage.get", "storage.set"];
  await assert.rejects(storage.save("old draft"), { code: "STORAGE_MODE_CHANGED" });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["storage.getSnapshot"],
  );
});
