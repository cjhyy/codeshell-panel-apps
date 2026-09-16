import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createDemoProject } from "../apps/video-studio/src/model";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import {
  EditorSession,
  EditorStorageConflictError,
  type EditorSessionOptions,
  type EditorSessionState,
  type EditorSessionStorage,
} from "../apps/video-studio/src/editor/session";
import type { EditorDocument } from "../apps/video-studio/src/editor/types";

function document(id = "project", name = "原工程", revision = 7): EditorDocument {
  return { ...migrateLegacyProject(createDemoProject()), id, name, revision };
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
interface Write {
  document: EditorDocument;
  base: number;
  label: string;
}
function memory(data: unknown = document(), version = 40) {
  const state = {
    data: structuredClone(data),
    revision: version,
    reads: 0,
    writes: [] as Write[],
    backups: [] as unknown[],
    beforeWrite: undefined as ((write: Write) => Promise<void>) | undefined,
    beforeBackup: undefined as ((raw: unknown) => Promise<void>) | undefined,
    readError: undefined as Error | undefined,
  };
  const storage: EditorSessionStorage = {
    async read() {
      state.reads++;
      if (state.readError) throw state.readError;
      return { data: structuredClone(state.data), revision: state.revision };
    },
    async write(value, base, label) {
      const write = { document: structuredClone(value), base, label };
      state.writes.push(write);
      await state.beforeWrite?.(write);
      if (base !== state.revision)
        throw new EditorStorageConflictError("存储版本不一致", state.revision);
      state.data = structuredClone(write.document);
      return { revision: ++state.revision };
    },
    async backupLegacy(raw) {
      state.backups.push(structuredClone(raw));
      await state.beforeBackup?.(raw);
    },
  };
  return { state, storage };
}
async function open(
  t: TestContext,
  storage: EditorSessionStorage,
  options: EditorSessionOptions = {},
) {
  const session = await EditorSession.open(storage, { autosaveDelayMs: 60000, ...options });
  t.after(() => session.close({ save: false }));
  return session;
}
function rename(session: EditorSession, name: string) {
  return session.dispatch(
    [{ type: "project.rename", name }],
    session.getState().identity.revision,
    `改名 ${name}`,
  );
}

test("durable proposals publish only after storage accepts them and preserve redo on failed writes", async (t) => {
  const { storage, state } = memory();
  const session = await open(t, storage);
  rename(session, "earlier");
  session.undo();
  await session.flush();
  const before = session.read(),
    identity = session.getState().identity;
  state.beforeWrite = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(
    session.dispatchDurable([{ type: "project.rename", name: "proposal" }], identity),
    /disk full/,
  );
  assert.deepEqual(session.read(), before);
  assert.equal(session.getState().canRedo, true);
  assert.equal(session.getState().dirty, false);
  assert.equal(session.getState().error?.stage, "commit");
  state.beforeWrite = undefined;
  await session.dispatchDurable([{ type: "project.rename", name: "proposal" }], identity);
  assert.equal(session.read().name, "proposal");
  assert.equal(session.read().revision, before.revision + 1);
  assert.equal(session.getState().canRedo, false);
  assert.deepEqual(session.read(), state.data);
  assert.equal(session.getState().saveState, "saved");
  session.undo();
  assert.equal(session.read().name, before.name);
});

test("durable proposals freeze their data, lock edits, and serialize concurrent flushes", async (t) => {
  const { storage, state } = memory(),
    gate = deferred(),
    started = deferred();
  const session = await open(t, storage);
  rename(session, "pending old edit");
  const before = session.read();
  state.beforeWrite = async (write) => {
    if (write.document.name === "proposal") {
      started.resolve();
      await gate.promise;
    }
  };
  const operation = { type: "project.rename" as const, name: "proposal" };
  const result = session.dispatchDurable([operation], session.getState().identity);
  operation.name = "mutated by caller";
  await started.promise;
  let flushed = false;
  const flush = session.flush().then(() => {
    flushed = true;
  });
  assert.deepEqual(session.read(), before);
  assert.equal(session.getState().phase, "committing");
  assert.throws(() => rename(session, "concurrent"), /稍候/);
  assert.throws(() => session.undo(), /稍候/);
  await assert.rejects(session.replace(document("other")), /稍候/);
  assert.equal(flushed, false);
  gate.resolve();
  await Promise.all([result, flush]);
  assert.deepEqual(
    state.writes.map((write) => write.document.name),
    ["pending old edit", "proposal"],
  );
  assert.equal(session.read().name, "proposal");
  assert.equal(session.getState().dirty, false);
  session.undo();
  assert.equal(session.read().name, "pending old edit");
});

test("durable cancellation before submission preserves the proposal; cancellation after commit activates it", async (t) => {
  const first = memory(),
    controller = new AbortController(),
    gate = deferred(),
    started = deferred();
  const session = await open(t, first.storage);
  rename(session, "old edit");
  first.state.beforeWrite = async () => {
    started.resolve();
    await gate.promise;
  };
  const operation = { type: "project.rename" as const, name: "proposal" };
  const pending = session.dispatchDurable(
    [operation],
    session.getState().identity,
    "apply",
    "user",
    controller.signal,
  );
  await started.promise;
  controller.abort();
  gate.resolve();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(session.read().name, "old edit");
  assert.equal(first.state.writes.length, 1);
  const second = memory(),
    late = new AbortController(),
    writeGate = deferred(),
    writeStarted = deferred();
  const other = await open(t, second.storage);
  second.state.beforeWrite = async () => {
    writeStarted.resolve();
    await writeGate.promise;
  };
  const committed = other.dispatchDurable(
    [operation],
    other.getState().identity,
    "apply",
    "user",
    late.signal,
  );
  await writeStarted.promise;
  late.abort();
  writeGate.resolve();
  await committed;
  assert.equal(other.read().name, "proposal");
  assert.deepEqual(other.read(), second.state.data);
});

test("durable proposals reject stale identities and uncertain storage receipts without consuming history", async (t) => {
  const { storage, state } = memory();
  const session = await open(t, storage);
  await assert.rejects(
    session.dispatchDurable([{ type: "project.rename", name: "proposal" }], {
      ...session.getState().identity,
      generation: -1,
    }),
    /版本已改变/,
  );
  assert.equal(state.writes.length, 0);
  const uncertain = await open(t, {
    ...storage,
    write: async () => ({ revision: state.revision }),
  });
  const before = uncertain.read();
  await assert.rejects(
    uncertain.dispatchDurable(
      [{ type: "project.rename", name: "proposal" }],
      uncertain.getState().identity,
    ),
    /回执/,
  );
  assert.deepEqual(uncertain.read(), before);
  assert.equal(uncertain.getState().saveState, "conflict");
  assert.equal(uncertain.getState().canUndo, false);
});

test("initial read and migration errors never create a writable fallback or overwrite stored data", async () => {
  for (const data of [
    undefined,
    { schemaVersion: 1, broken: true },
    { schemaVersion: 2, broken: true },
    null,
  ]) {
    const { storage, state } = memory(data === undefined ? { schemaVersion: 3 } : data);
    await assert.rejects(EditorSession.open(storage));
    assert.equal(state.writes.length, 0);
    assert.equal(state.backups.length, 0);
  }
  const { storage, state } = memory();
  state.readError = new Error("disk unavailable");
  await assert.rejects(
    EditorSession.open(storage, { initialDocument: document("new") }),
    /disk unavailable/,
  );
  assert.equal(state.writes.length, 0);
  const badRevision = { ...storage, read: async () => ({ data: null, revision: NaN }) };
  await assert.rejects(EditorSession.open(badRevision, { initialDocument: document("new") }));
  assert.equal(state.writes.length, 0);
  let read = false;
  const getterStorage = {
    ...storage,
    read: async () => ({
      data: {
        get schemaVersion() {
          read = true;
          return 1;
        },
      },
      revision: 0,
    }),
  };
  await assert.rejects(EditorSession.open(getterStorage));
  assert.equal(read, false);
});

test("only an explicitly empty successful read permits a new initial document", async (t) => {
  const { storage, state } = memory(null, 0),
    initial = document("new");
  const session = await open(t, storage, { initialDocument: initial });
  assert.equal(session.getState().dirty, true);
  assert.equal(session.getState().saveState, "pending");
  initial.name = "caller mutation";
  await session.flush();
  assert.equal(state.writes[0]!.document.name, "原工程");
  assert.equal(state.writes[0]!.base, 0);
  assert.equal(state.writes[0]!.label, "新建工程");
  assert.equal(state.backups.length, 0);
  assert.equal(session.getState().dirty, false);
  assert.equal(session.getState().storageRevision, 1);
});

test("all queued saves use detached snapshots and one ordered writer; flush waits for edits arriving during the write", async (t) => {
  const { storage, state } = memory(),
    firstStarted = deferred(),
    secondStarted = deferred(),
    first = deferred(),
    second = deferred();
  state.beforeWrite = async () => {
    if (state.writes.length === 1) {
      firstStarted.resolve();
      await first.promise;
    } else {
      secondStarted.resolve();
      await second.promise;
    }
  };
  const session = await open(t, storage);
  const a = rename(session, "A"),
    firstFlush = session.flush();
  await firstStarted.promise;
  a.name = "mutated A";
  a.sequences[0]!.clips.length = 0;
  rename(session, "B");
  const c = rename(session, "C");
  c.name = "mutated C";
  let finished = false;
  const secondFlush = session.flush().then(() => {
    finished = true;
  });
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0]!.document.name, "A");
  assert.equal(session.getState().dirty, true);
  assert.equal(session.getState().saveState, "saving");
  first.resolve();
  await secondStarted.promise;
  assert.equal(finished, false);
  assert.equal(state.writes[1]!.document.name, "C");
  assert.equal(state.writes[1]!.base, 41);
  assert.equal(state.writes[1]!.document.revision, 10);
  second.resolve();
  await Promise.all([firstFlush, secondFlush]);
  assert.equal(state.writes.length, 2);
  assert.equal((state.data as EditorDocument).name, "C");
  assert.equal(session.getState().dirty, false);
  assert.equal(session.getState().storageRevision, 42);
  assert.ok(state.writes[0]!.document.sequences[0]!.clips.length > 0);
  assert.equal(state.reads, 1);
});

test("zero-delay autosave reports completion and does not depend on an explicit flush", async (t) => {
  const { storage, state } = memory(),
    saved = deferred();
  const session = await open(t, storage, { autosaveDelayMs: 0 });
  const unsubscribe = session.subscribe((value) => {
    if (!value.dirty && value.storageRevision === 41) saved.resolve();
  });
  rename(session, "自动保存");
  await saved.promise;
  assert.equal(state.writes.length, 1);
  assert.equal((state.data as EditorDocument).name, "自动保存");
  unsubscribe();
});

test("failed save retains the newest pending snapshot and retries against the same base revision", async (t) => {
  const { storage, state } = memory(),
    started = deferred(),
    gate = deferred();
  state.beforeWrite = async () => {
    started.resolve();
    await gate.promise;
    throw new Error("disk full");
  };
  const session = await open(t, storage);
  rename(session, "older");
  const failed = assert.rejects(session.flush(), /disk full/);
  await started.promise;
  rename(session, "newest");
  gate.resolve();
  await failed;
  assert.equal(session.read().name, "newest");
  assert.equal(session.getState().dirty, true);
  assert.deepEqual(session.getState().error, {
    kind: "write",
    stage: "save",
    message: "disk full",
  });
  assert.equal(session.getState().canUndo, true);
  assert.equal(state.revision, 40);
  state.beforeWrite = undefined;
  await session.flush();
  assert.equal(state.writes[1]!.base, 40);
  assert.equal(state.writes[1]!.document.name, "newest");
  assert.equal(session.getState().dirty, false);
  assert.equal(session.getState().error, null);
});

test("CAS conflict stops retries without reading and replacing the active edits", async (t) => {
  const { storage, state } = memory(),
    session = await open(t, storage);
  rename(session, "local edits");
  state.revision = 80;
  state.data = document("external", "外部更新");
  await assert.rejects(session.flush(), EditorStorageConflictError);
  assert.equal(session.getState().saveState, "conflict");
  assert.equal(session.getState().dirty, true);
  rename(session, "more local edits");
  await assert.rejects(session.flush(), EditorStorageConflictError);
  assert.equal(state.reads, 1);
  assert.equal(state.writes.length, 1);
  assert.equal(session.read().name, "more local edits");
  assert.equal((state.data as EditorDocument).name, "外部更新");
});

test("uncertain or malformed save receipts stop further writes instead of inventing a storage version", async (t) => {
  for (const receipt of [{ revision: 40 }, { revision: NaN }, {}]) {
    const { storage, state } = memory();
    const adapter = {
      ...storage,
      write: async (doc: EditorDocument, base: number, label: string) => {
        await storage.write(doc, base, label);
        return receipt as { revision: number };
      },
    };
    const session = await open(t, adapter);
    rename(session, "written with missing receipt");
    await assert.rejects(session.flush(), EditorStorageConflictError);
    assert.equal(session.getState().storageRevision, 40);
    assert.equal(session.getState().dirty, true);
    await assert.rejects(session.flush(), EditorStorageConflictError);
    assert.equal(state.writes.length, 1);
  }
});

test("v1 migration backs up the exact original before any overwrite and backup failure leaves migration dirty", async (t) => {
  const legacy = createDemoProject();
  legacy.name = "  原始空白也保留  ";
  const original = structuredClone(legacy),
    { storage, state } = memory(legacy);
  state.beforeBackup = async (raw) => {
    (raw as any).name = "adapter mutation";
    throw new Error("backup failed");
  };
  const session = await open(t, storage);
  assert.equal(session.read().schemaVersion, 2);
  assert.equal(session.getState().legacyBackupPending, true);
  state.data = { corruptedOutside: true };
  await assert.rejects(session.flush(), /backup failed/);
  assert.equal(state.writes.length, 0);
  assert.deepEqual(state.backups[0], original);
  assert.equal(session.getState().dirty, true);
  assert.equal(session.getState().error?.kind, "backup");
  state.beforeBackup = undefined;
  await session.flush();
  assert.deepEqual(state.backups[1], original);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0]!.document.schemaVersion, 2);
  assert.equal(session.getState().legacyBackupPending, false);
});

test("successful legacy backup is not repeated when the later v2 write fails and retries", async (t) => {
  const { storage, state } = memory(createDemoProject());
  state.beforeWrite = async () => {
    throw new Error("write failed");
  };
  const session = await open(t, storage);
  await assert.rejects(session.flush(), /write failed/);
  assert.equal(state.backups.length, 1);
  assert.equal(session.getState().legacyBackupPending, false);
  state.beforeWrite = undefined;
  await session.flush();
  assert.equal(state.backups.length, 1);
  assert.equal(state.writes.length, 2);
});

test("undo, redo and agent edits share one history and persist monotonic document revisions", async (t) => {
  const { storage, state } = memory(),
    session = await open(t, storage),
    old = session.getState().identity;
  session.dispatch([{ type: "project.rename", name: "AI 修改" }], old, "AI 改名", "agent");
  assert.equal(session.getState().canUndo, true);
  assert.equal(session.read().revision, 8);
  session.undo();
  assert.equal(session.read().name, "原工程");
  assert.equal(session.read().revision, 9);
  assert.throws(
    () => session.dispatch([{ type: "project.rename", name: "过期" }], old, "AI 过期", "agent"),
    /版本/,
  );
  assert.throws(() => session.dispatch([], 9, "AI 缺少身份", "agent"), /身份/);
  assert.equal(session.getState().canRedo, true);
  session.redo();
  assert.equal(session.read().revision, 10);
  assert.equal(session.read().name, "AI 修改");
  await session.flush();
  assert.equal(state.writes[0]!.document.revision, 10);
  assert.equal(state.writes[0]!.label, "重做");
  const snapshot = session.read();
  snapshot.name = "外部篡改";
  assert.equal(session.read().name, "AI 修改");
});

test("replace saves the old snapshot first, freezes edits, and activates only after the validated new snapshot commits", async (t) => {
  const { storage, state } = memory(),
    oldStarted = deferred(),
    newStarted = deferred(),
    oldGate = deferred(),
    newGate = deferred();
  state.beforeWrite = async (write) => {
    if (write.document.id === "project") {
      oldStarted.resolve();
      await oldGate.promise;
    } else {
      newStarted.resolve();
      await newGate.promise;
    }
  };
  const session = await open(t, storage);
  rename(session, "旧工程未保存修改");
  const before = session.read(),
    identity = session.getState().identity,
    next = document("other", "新工程", 0);
  let preSwitchFlushed = false;
  const preSwitchFlush = session.flush().then(() => {
    preSwitchFlushed = true;
  });
  await oldStarted.promise;
  const replaced = session.replace(next, { identity, label: "打开别的工程" });
  next.name = "caller mutation";
  await oldStarted.promise;
  assert.equal(session.getState().phase, "replacing");
  assert.deepEqual(session.read(), before);
  assert.throws(() => rename(session, "unexpected"), /切换/);
  assert.throws(() => session.undo(), /切换/);
  assert.throws(() => session.redo(), /切换/);
  await assert.rejects(session.replace(document("third")), /切换/);
  oldGate.resolve();
  await newStarted.promise;
  let flushed = false;
  const duringReplacement = session.flush().then(() => {
    flushed = true;
  });
  await Promise.resolve();
  assert.equal(flushed, false, "A flush during switching must include the new document commit");
  assert.equal(
    preSwitchFlushed,
    false,
    "A flush already in progress also waits for a subsequently requested switch",
  );
  assert.equal(state.writes[0]!.document.name, before.name);
  assert.equal(state.writes[1]!.base, 41);
  assert.deepEqual(session.read(), before);
  assert.equal(state.writes[1]!.document.name, "新工程");
  newGate.resolve();
  const result = await replaced;
  await duringReplacement;
  await preSwitchFlush;
  assert.equal(result.id, "other");
  assert.equal(result.name, "新工程");
  assert.equal(session.getState().phase, "ready");
  assert.equal(session.getState().dirty, false);
  assert.equal(session.getState().canUndo, false);
  assert.equal(session.getState().canRedo, false);
  assert.notEqual(session.getState().identity.generation, identity.generation);
  assert.throws(() => session.dispatch([], identity, "旧 AI", "agent"), /工程|版本/);
});

test("invalid replacement performs no write and failed replacement keeps old document and undo history", async (t) => {
  const { storage, state } = memory(),
    session = await open(t, storage);
  rename(session, "保留的修改");
  const before = session.read(),
    identity = session.getState().identity;
  await assert.rejects(session.replace({ ...document("new"), activeSequenceId: "missing" }));
  assert.equal(state.writes.length, 0);
  assert.deepEqual(session.read(), before);
  state.beforeWrite = async (write) => {
    if (write.document.id === "new") throw new Error("new write failed");
  };
  await assert.rejects(session.replace(document("new")), /new write failed/);
  assert.deepEqual(session.read(), before);
  assert.deepEqual(session.getState().identity, identity);
  assert.equal(session.getState().canUndo, true);
  assert.equal(session.getState().dirty, false);
  assert.equal(session.getState().error?.stage, "replace");
  assert.equal((state.data as EditorDocument).id, "project");
  assert.equal(session.getState().storageRevision, 41);
  state.beforeWrite = undefined;
  await session.replace(document("new"));
  assert.equal(session.read().id, "new");
});

test("same-id version restore increases revision and generation while rejecting stale identities across opens", async (t) => {
  const { storage } = memory(),
    session = await open(t, storage);
  rename(session, "latest");
  const oldIdentity = session.getState().identity;
  const restored = await session.replace(document("project", "旧版本", 1));
  assert.equal(restored.revision, oldIdentity.revision + 1);
  assert.notEqual(session.getState().identity.generation, oldIdentity.generation);
  assert.throws(() => session.dispatch([], oldIdentity, "旧 AI", "agent"), /版本/);
  const second = await open(t, storage);
  assert.notEqual(second.getState().identity.generation, session.getState().identity.generation);
  assert.throws(
    () => second.dispatch([], session.getState().identity, "旧会话", "agent"),
    /工程|版本/,
  );
});

test("cancellation before replacement submission retains the saved old project", async (t) => {
  const { storage, state } = memory(),
    started = deferred(),
    gate = deferred(),
    controller = new AbortController();
  state.beforeWrite = async () => {
    started.resolve();
    await gate.promise;
  };
  const session = await open(t, storage);
  rename(session, "old edit");
  const before = session.read();
  const rejected = assert.rejects(session.replace(document("new"), { signal: controller.signal }), {
    name: "AbortError",
  });
  await started.promise;
  controller.abort();
  gate.resolve();
  await rejected;
  assert.equal(state.writes.length, 1);
  assert.deepEqual(session.read(), before);
  assert.equal(session.getState().phase, "ready");
  assert.equal(session.getState().dirty, false);
  assert.equal(session.getState().error, null);
});

test("cancellation after new write begins cannot hide a successful committed switch", async (t) => {
  const { storage, state } = memory(),
    started = deferred(),
    gate = deferred(),
    controller = new AbortController();
  state.beforeWrite = async () => {
    started.resolve();
    await gate.promise;
  };
  const session = await open(t, storage);
  const switched = session.replace(document("new"), { signal: controller.signal });
  await started.promise;
  controller.abort();
  gate.resolve();
  assert.equal((await switched).id, "new");
  assert.equal(session.read().id, "new");
  assert.equal((state.data as EditorDocument).id, "new");
  assert.equal(session.getState().dirty, false);
});

test("imported legacy replacement backup must finish before the new write and failure preserves the old history", async (t) => {
  const { storage, state } = memory(),
    session = await open(t, storage),
    legacy = createDemoProject();
  legacy.id = "legacy-import";
  state.beforeBackup = async () => {
    throw new Error("import backup failed");
  };
  await assert.rejects(session.replace(legacy), /import backup failed/);
  assert.equal(state.writes.length, 0);
  assert.equal(session.read().id, "project");
  assert.equal(session.getState().error?.kind, "backup");
  state.beforeBackup = undefined;
  await session.replace(legacy);
  assert.deepEqual(state.backups[1], legacy);
  assert.equal(state.writes[0]!.document.id, "legacy-import");
});

test("subscribers receive detached status and cannot break history or autosave by throwing", async (t) => {
  const { storage } = memory(),
    session = await open(t, storage),
    seen: EditorSessionState[] = [];
  const stop = session.subscribe((state) => {
    seen.push(structuredClone(state));
    state.identity.documentId = "mutated";
  });
  session.subscribe(() => {
    throw new Error("broken view");
  });
  rename(session, "still saved");
  await session.flush();
  assert.equal(session.read().name, "still saved");
  assert.equal(session.getState().identity.documentId, "project");
  assert.ok(seen.some((state) => state.saveState === "pending"));
  assert.ok(seen.some((state) => state.saveState === "saving"));
  assert.equal(seen.at(-1)!.saveState, "saved");
  const count = seen.length;
  stop();
  rename(session, "unsubscribed");
  await session.flush();
  assert.equal(seen.length, count);
});

test("close with discard cancels queued saves but waits for the in-flight snapshot and never writes a newer discarded edit", async (t) => {
  const { storage, state } = memory(),
    started = deferred(),
    gate = deferred();
  const session = await open(t, storage);
  rename(session, "not submitted");
  await session.close({ save: false });
  assert.equal(state.writes.length, 0);
  assert.equal(session.getState().phase, "closed");
  assert.throws(() => rename(session, "after close"), /关闭/);
  await assert.rejects(session.flush(), /关闭/);
  const live = await open(t, storage);
  state.beforeWrite = async () => {
    started.resolve();
    await gate.promise;
  };
  rename(live, "in flight");
  const flush = live.flush();
  await started.promise;
  rename(live, "discarded newer");
  let closed = false;
  const closing = live.close({ save: false }).then(() => {
    closed = true;
  });
  assert.equal(live.getState().phase, "closing");
  assert.equal(closed, false);
  gate.resolve();
  await Promise.all([flush, closing]);
  assert.equal(state.writes.length, 1);
  assert.equal((state.data as EditorDocument).name, "in flight");
  assert.equal(live.getState().phase, "closed");
});

test("close during legacy backup cancels the still-unsubmitted overwrite and default close failure leaves editing available", async (t) => {
  const { storage, state } = memory(createDemoProject()),
    started = deferred(),
    gate = deferred();
  state.beforeBackup = async () => {
    started.resolve();
    await gate.promise;
  };
  const session = await open(t, storage),
    flushing = session.flush();
  await started.promise;
  const closing = session.close({ save: false });
  gate.resolve();
  await Promise.all([flushing, closing]);
  assert.equal(state.backups.length, 1);
  assert.equal(state.writes.length, 0);
  const secondStore = memory(),
    second = await open(t, secondStore.storage);
  rename(second, "keep pending");
  secondStore.state.beforeWrite = async () => {
    throw new Error("cannot save");
  };
  await assert.rejects(second.close(), /cannot save/);
  assert.equal(second.getState().phase, "ready");
  assert.equal(second.getState().dirty, true);
  rename(second, "still editable");
  secondStore.state.beforeWrite = undefined;
  await second.close();
  assert.equal(second.getState().phase, "closed");
  assert.equal((secondStore.state.data as EditorDocument).name, "still editable");
});
