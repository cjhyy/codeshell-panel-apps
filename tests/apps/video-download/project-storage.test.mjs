import assert from "node:assert/strict";
import test from "node:test";
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
