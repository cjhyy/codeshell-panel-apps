import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  createReviewCommentsStore,
  parseReviewComments,
  reviewCommentsPath,
  reviewDraftKey,
  REVIEW_COMMENTS_FORMAT,
} from "../../../apps/design-studio/app/review-comments.mjs";
import {
  createReviewDraftSession,
  REVIEW_DRAFT_FORMAT,
} from "../../../apps/design-studio/app/review-comments.mjs";
import {
  createDesignSidecarPlan,
  readDesignSidecar,
  DESIGN_SIDECAR_PART_BYTES,
} from "../../../apps/design-studio/app/design-sidecar.mjs";

const path = "designs/product.codesign.json",
  commentsPath = "designs/product.comments.json";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const date = "2026-10-16T08:00:00.000Z";
function document(threads = []) {
  return { format: REVIEW_COMMENTS_FORMAT, version: 1, designPath: path, threads };
}
function thread(id = "external", text = "External feedback") {
  return {
    id,
    text,
    author: "Reviewer",
    createdAt: date,
    updatedAt: date,
    pageId: "page-1",
    nodeId: "card",
    status: "open",
    replies: [],
  };
}
function fixture() {
  let snapshot = {
      cwd: "/workspace",
      sessionId: "session-A",
      workspaceEpoch: 1,
      documentEpoch: 1,
      path,
      ready: true,
      projectScope: { version: 1, environmentId: "cloud", projectId: "A", rootId: "root" },
    },
    nextId = 0;
  const files = new Map(),
    calls = [];
  const scope = () => snapshot.projectScope.projectId;
  const call = async (method, params) => {
    const key = `${scope()}:${params.path}`;
    calls.push({ method, scope: scope(), ...params });
    if (method === "workspace.readText") {
      const content = files.get(key);
      if (content === undefined) throw Error("file not found");
      return { content, modifiedAt: 1, revision: hash(content) };
    }
    if (method === "workspace.writeText") {
      const previous = files.get(key);
      if (params.expectedModifiedAt === null && previous !== undefined) throw Error("file exists");
      if (params.expectedRevision !== undefined && params.expectedRevision !== hash(previous))
        throw Error("file changed since it was opened");
      files.set(key, params.content);
      return { modifiedAt: 1, revision: hash(params.content) };
    }
    throw Error(`Unsupported ${method}`);
  };
  const options = {
    getSnapshot: () => snapshot,
    call,
    now: () => date,
    id: () => `comment-${++nextId}`,
  };
  return {
    files,
    calls,
    options,
    call,
    snapshot: () => snapshot,
    update: (value) => {
      snapshot = { ...snapshot, ...value };
    },
    store: createReviewCommentsStore(options),
  };
}
function gate() {
  let entered, release;
  return {
    entered: new Promise((resolve) => {
      entered = resolve;
    }),
    wait: new Promise((resolve) => {
      release = resolve;
    }),
    enter: () => entered(),
    release: () => release(),
  };
}

test("comments have a bounded safe companion path and reject unrelated or malformed data", () => {
  assert.equal(reviewCommentsPath(path), commentsPath);
  for (const unsafe of [
    "../product.codesign.json",
    "designs/../product.codesign.json",
    "/designs/product.codesign.json",
    "designs/product.json",
    "designs\\product.codesign.json",
  ])
    assert.throws(() => reviewCommentsPath(unsafe));
  const valid = document([thread()]);
  assert.deepEqual(parseReviewComments(JSON.stringify(valid), path), valid);
  for (const invalid of [
    "not json",
    JSON.stringify({ hello: "world" }),
    JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, designPath: "designs/other.codesign.json" }),
    JSON.stringify(document([thread(), thread()])),
    JSON.stringify(document([{ ...thread(), status: "pending" }])),
    JSON.stringify(document([{ ...thread(), text: "x".repeat(10_001) }])),
  ])
    assert.throws(() => parseReviewComments(invalid, path));
});

test("threads, replies and resolve state persist with stable targets and preserve external metadata", async () => {
  const f = fixture();
  f.files.set(
    `A:${commentsPath}`,
    JSON.stringify({ ...document(), extension: { retained: true } }),
  );
  await f.store.addThread({
    pageId: "page-1",
    nodeId: "card",
    targetName: "Card",
    text: "Improve contrast",
  });
  await f.store.reply("comment-1", "Updated the color");
  await f.store.setResolved("comment-1", true);
  const reopened = createReviewCommentsStore(f.options),
    result = await reopened.refresh();
  assert.equal(result.document.threads[0].status, "resolved");
  assert.equal(result.document.threads[0].nodeId, "card");
  assert.equal(result.document.threads[0].replies[0].text, "Updated the color");
  assert.deepEqual(result.document.extension, { retained: true });
  await reopened.setResolved("comment-1", false);
  await reopened.addThread({ pageId: "page-2", text: "Review the entire page" });
  const stored = JSON.parse(f.files.get(`A:${commentsPath}`));
  assert.equal(stored.threads[0].status, "open");
  assert.equal(stored.threads[1].nodeId, null);
  assert(
    f.calls
      .filter((item) => item.method === "workspace.writeText")
      .every((item) => item.expectedRevision),
  );
});

test("a competing editor append is merged after a CAS conflict without overwriting either discussion", async () => {
  const f = fixture();
  f.files.set(`A:${commentsPath}`, JSON.stringify(document()));
  let competingWrite = true;
  const store = createReviewCommentsStore({
    ...f.options,
    call: async (method, params) => {
      if (method === "workspace.writeText" && competingWrite) {
        competingWrite = false;
        f.files.set(`A:${commentsPath}`, JSON.stringify(document([thread()])));
      }
      return f.call(method, params);
    },
  });
  await store.addThread({ pageId: "page-1", nodeId: "card", text: "My feedback" });
  const result = JSON.parse(f.files.get(`A:${commentsPath}`));
  assert.deepEqual(
    result.threads.map((item) => item.text),
    ["External feedback", "My feedback"],
  );
  assert.equal(f.calls.filter((item) => item.method === "workspace.writeText").length, 2);
});

test("unreadable files, unknown formats and missing concurrency tokens never permit a write", async () => {
  for (const failure of ["permission", "malformed", "unversioned"]) {
    const f = fixture();
    f.files.set(
      `A:${commentsPath}`,
      failure === "malformed" ? "private data" : JSON.stringify(document()),
    );
    const store = createReviewCommentsStore({
      ...f.options,
      call: async (method, params) => {
        if (method === "workspace.readText" && failure === "permission")
          throw Error("permission denied");
        const result = await f.call(method, params);
        return failure === "unversioned" ? { content: result.content } : result;
      },
    });
    const before = f.files.get(`A:${commentsPath}`);
    await assert.rejects(store.addThread({ pageId: "page-1", text: "Keep this draft" }));
    assert.equal(f.files.get(`A:${commentsPath}`), before);
    assert.equal(f.calls.filter((item) => item.method === "workspace.writeText").length, 0);
  }
});

test("create-only writes preserve an unrelated file created between the missing read and write", async () => {
  const f = fixture();
  const store = createReviewCommentsStore({
    ...f.options,
    call: async (method, params) => {
      if (method === "workspace.writeText") f.files.set(`A:${commentsPath}`, "unrelated user file");
      return f.call(method, params);
    },
  });
  await assert.rejects(store.addThread({ pageId: "page-1", text: "Draft" }), /已有内容已保留/);
  assert.equal(f.files.get(`A:${commentsPath}`), "unrelated user file");
  assert.equal(
    f.calls.find((item) => item.method === "workspace.writeText").expectedModifiedAt,
    null,
  );
});

test("late reads cannot dispatch a write after project, session, document or path switches", async () => {
  for (const changed of [
    { projectScope: { version: 1, environmentId: "cloud", projectId: "B", rootId: "root" } },
    { sessionId: "session-B" },
    { documentEpoch: 2 },
    { path: "designs/other.codesign.json" },
  ]) {
    const f = fixture(),
      pause = gate();
    f.files.set(`A:${commentsPath}`, JSON.stringify(document()));
    const store = createReviewCommentsStore({
      ...f.options,
      call: async (method, params) => {
        const value = await f.call(method, params);
        if (method === "workspace.readText") {
          pause.enter();
          await pause.wait;
        }
        return value;
      },
    });
    const pending = store.addThread({ pageId: "page-1", text: "A feedback" });
    await pause.entered;
    f.update(changed);
    pause.release();
    await assert.rejects(pending, (error) => error.code === "STALE_REVIEW_SCOPE");
    assert.equal(f.calls.filter((item) => item.method === "workspace.writeText").length, 0);
  }
});

test("draft keys separate cloud projects at the same cwd and survive a document reload", () => {
  const f = fixture(),
    key = reviewDraftKey(f.snapshot());
  f.update({ documentEpoch: 2 });
  assert.equal(reviewDraftKey(f.snapshot()), key);
  f.update({ projectScope: { ...f.snapshot().projectScope, projectId: "B" } });
  assert.notEqual(reviewDraftKey(f.snapshot()), key);
});

test("explicit UI invalidation stops a pending write even before the Host snapshot changes", async () => {
  const f = fixture(),
    pause = gate();
  let epoch = 0;
  f.files.set(`A:${commentsPath}`, JSON.stringify(document()));
  const store = createReviewCommentsStore({
    ...f.options,
    getOperationEpoch: () => epoch,
    call: async (method, params) => {
      const value = await f.call(method, params);
      if (method === "workspace.readText") {
        pause.enter();
        await pause.wait;
      }
      return value;
    },
  });
  const pending = store.addThread({ pageId: "page-1", text: "Cancelled feedback" });
  await pause.entered;
  epoch++;
  pause.release();
  await assert.rejects(pending, (error) => error.code === "STALE_REVIEW_SCOPE");
  assert.equal(f.calls.filter((item) => item.method === "workspace.writeText").length, 0);
});

test("a lost comment write receipt is observed without duplicating the discussion", async () => {
  const f = fixture();
  let uncertain = true;
  const store = createReviewCommentsStore({
    ...f.options,
    call: async (method, params) => {
      const result = await f.call(method, params);
      if (method === "workspace.writeText" && uncertain) {
        uncertain = false;
        throw Error("lost receipt");
      }
      return result;
    },
  });
  const result = await store.addThread({ pageId: "page-1", text: "Exactly once" });
  assert.equal(result.document.threads.length, 1);
  assert.equal(f.calls.filter((call) => call.method === "workspace.writeText").length, 1);
});
test("large comments retain root CAS versions while reading and writing bounded sidecar parts", async () => {
  const f = fixture(),
    content = JSON.stringify(
      document(
        Array.from({ length: 80 }, (_, index) => thread(`review-${index}`, "x".repeat(5000))),
      ),
    );
  const sha256 = async (value) => hash(value),
    plan = await createDesignSidecarPlan(content, { sha256 });
  for (const part of plan.parts) f.files.set(`A:${part.path}`, part.content);
  f.files.set(`A:${commentsPath}`, plan.primarySource);
  const store = createReviewCommentsStore({ ...f.options, sha256 });
  await store.reply("review-0", "Checked");
  assert(
    f.calls
      .filter((call) => call.method === "workspace.writeText")
      .every((call) => Buffer.byteLength(call.content) <= DESIGN_SIDECAR_PART_BYTES),
  );
  const read = await readDesignSidecar({ path: commentsPath, call: f.call, sha256 });
  assert.equal(JSON.parse(read.content).threads[0].replies[0].text, "Checked");
  assert.equal(
    f.calls.findLast((call) => call.method === "workspace.writeText" && call.path === commentsPath)
      .expectedRevision,
    hash(plan.primarySource),
  );
});
function draft(snapshot, text) {
  return {
    format: REVIEW_DRAFT_FORMAT,
    version: 1,
    scopeKey: reviewDraftKey(snapshot),
    text,
    target: { pageId: "page-1", nodeId: "card", targetName: "Card" },
    replies: [],
  };
}
function draftHost() {
  const records = new Map(),
    calls = [];
  const snapshot = (key) =>
    records.has(key)
      ? {
          exists: true,
          value: structuredClone(records.get(key)),
          revision: `sha256:${hash(JSON.stringify(records.get(key)))}`,
        }
      : { exists: false, value: null, revision: null };
  return {
    records,
    calls,
    async call(method, params) {
      calls.push({ method, ...params });
      if (method === "storage.getSnapshot") return snapshot(params.key);
      assert.equal(method, "storage.compareAndSet");
      if (params.expectedRevision !== snapshot(params.key).revision)
        return { updated: false, snapshot: snapshot(params.key) };
      records.set(params.key, structuredClone(params.value));
      return { updated: true, snapshot: snapshot(params.key) };
    },
  };
}
test("draft persistence requires advertised CAS methods and never overwrites a concurrent window", async () => {
  const f = fixture(),
    h = draftHost();
  assert.equal(
    await createReviewDraftSession({
      snapshot: f.snapshot(),
      getSnapshot: f.options.getSnapshot,
      call: h.call,
    }),
    null,
  );
  f.update({ availableMethods: ["storage.getSnapshot", "storage.compareAndSet"] });
  const options = { snapshot: f.snapshot(), getSnapshot: f.options.getSnapshot, call: h.call };
  const first = await createReviewDraftSession(options),
    second = await createReviewDraftSession(options);
  await first.load();
  await second.load();
  await first.save(draft(f.snapshot(), "First window draft"));
  await assert.rejects(second.save(draft(f.snapshot(), "Concurrent draft")), /其他窗口/);
  assert(second.blocked);
  await assert.rejects(second.save(draft(f.snapshot(), "Blind retry")), /其他窗口/);
  assert.equal([...h.records.values()][0].text, "First window draft");
  const reopened = await createReviewDraftSession(options);
  assert.equal((await reopened.load()).text, "First window draft");
  assert(
    h.calls.every((call) => ["storage.getSnapshot", "storage.compareAndSet"].includes(call.method)),
  );
});
test("late draft reads and invalid imported draft scopes cannot authorize a new-project write", async () => {
  const f = fixture(),
    h = draftHost(),
    pause = gate();
  f.update({ availableMethods: ["storage.getSnapshot", "storage.compareAndSet"] });
  const session = await createReviewDraftSession({
    snapshot: f.snapshot(),
    getSnapshot: f.options.getSnapshot,
    call: async (method, params) => {
      const result = await h.call(method, params);
      pause.enter();
      await pause.wait;
      return result;
    },
  });
  const loading = session.load();
  await pause.entered;
  f.update({ projectScope: { ...f.snapshot().projectScope, projectId: "B" } });
  pause.release();
  await assert.rejects(loading, /项目已切换/);
  await assert.rejects(
    async () => session.save(draft(f.snapshot(), "Other project")),
    /项目来源无效/,
  );
  assert.equal(h.calls.filter((call) => call.method === "storage.compareAndSet").length, 0);
});
