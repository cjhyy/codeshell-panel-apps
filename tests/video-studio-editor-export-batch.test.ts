import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorExportBatch } from "../apps/video-studio/src/editor/export-batch";
import { createExportPresets } from "../apps/video-studio/src/editor/export-settings";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { createDemoProject } from "../apps/video-studio/src/model";
function document() {
  const doc = migrateLegacyProject(createDemoProject()),
    first = doc.sequences[0]!;
  const second = structuredClone(first);
  second.id = "second";
  second.name = "第二序列";
  doc.sequences.push(second);
  return doc;
}
const signal = () => new AbortController().signal;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};

test("batch freezes the document and every profile, including copies passed to a mutating adapter", async () => {
  const doc = document(),
    profiles = createExportPresets().slice(0, 2),
    expected = structuredClone(doc),
    expectedProfiles = structuredClone(profiles),
    ids = doc.sequences.map((seq) => seq.id);
  const batch = new EditorExportBatch(doc, ids, profiles);
  doc.name = "后来修改";
  doc.sequences[0]!.clips = [];
  profiles[0]!.width = 640;
  profiles[0]!.frameRate.numerator = 60;
  ids.length = 0;
  const received: any[] = [];
  await batch.submit(async (snapshot, sequenceId, profile) => {
    received.push(structuredClone({ snapshot, sequenceId, profile }));
    snapshot.name = "适配器修改";
    snapshot.sequences = [];
    profile.width = 16;
    profile.frameRate.numerator = 24;
  }, signal());
  assert.equal(received.length, 4);
  assert.deepEqual(
    received.map((item) => [item.sequenceId, item.profile.id]),
    expected.sequences.flatMap((seq) => expectedProfiles.map((profile) => [seq.id, profile.id])),
  );
  for (let i = 0; i < received.length; i++) {
    assert.deepEqual(received[i].snapshot, expected);
    assert.deepEqual(received[i].profile, expectedProfiles[i % 2]);
  }
  assert.deepEqual(batch.progress, { completed: 4, total: 4 });
});
test("partial submission retries only the failed item and never resubmits accepted jobs", async () => {
  const doc = document(),
    profiles = createExportPresets().slice(0, 2),
    batch = new EditorExportBatch(
      doc,
      doc.sequences.map((seq) => seq.id),
      profiles,
    );
  const attempts: string[] = [],
    accepted: string[] = [];
  let fail = true;
  const accept = async (_doc: unknown, seq: string, profile: { id: string }) => {
    const key = `${seq}/${profile.id}`;
    attempts.push(key);
    if (fail && attempts.length === 2) throw new Error("本地任务队列暂时繁忙");
    accepted.push(key);
  };
  await assert.rejects(batch.submit(accept, signal()), /队列暂时繁忙/);
  assert.deepEqual(batch.progress, { completed: 1, total: 4 });
  fail = false;
  await batch.submit(accept, signal());
  assert.equal(attempts.length, 5);
  assert.equal(attempts[1], attempts[2]);
  assert.equal(new Set(accepted).size, 4);
  const count = attempts.length;
  await batch.submit(accept, signal());
  assert.equal(attempts.length, count);
});
test("cancellation during an accepted task keeps that receipt and stops remaining submissions", async () => {
  const doc = document(),
    profiles = createExportPresets().slice(0, 2),
    batch = new EditorExportBatch(
      doc,
      doc.sequences.map((seq) => seq.id),
      profiles,
    ),
    controller = new AbortController(),
    gate = deferred(),
    started = deferred();
  const accepted: string[] = [];
  const pending = batch.submit(async (_doc, seq, profile) => {
    started.resolve();
    await gate.promise;
    accepted.push(`${seq}/${profile.id}`);
  }, controller.signal);
  await started.promise;
  controller.abort();
  gate.resolve();
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(batch.progress, { completed: 1, total: 4 });
  await batch.submit(async (_doc, seq, profile) => {
    accepted.push(`${seq}/${profile.id}`);
  }, signal());
  assert.equal(accepted.length, 4);
  assert.equal(new Set(accepted).size, 4);
});
test("pre-aborted batches accept nothing and overlapping submissions are rejected", async () => {
  const doc = document(),
    batch = new EditorExportBatch(doc, [doc.sequences[0]!.id], createExportPresets().slice(0, 2));
  let calls = 0;
  await assert.rejects(
    batch.submit(async () => {
      calls++;
    }, AbortSignal.abort()),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
  const gate = deferred(),
    started = deferred(),
    pending = batch.submit(async () => {
      calls++;
      started.resolve();
      await gate.promise;
    }, signal());
  await started.promise;
  await assert.rejects(
    batch.submit(async () => {
      calls++;
    }, signal()),
    /正在提交/,
  );
  assert.equal(calls, 1);
  gate.resolve();
  await pending;
  assert.equal(calls, 2);
});
test("progress callback errors do not lose an accepted receipt or leave the batch locked", async () => {
  const doc = document(),
    batch = new EditorExportBatch(doc, [doc.sequences[0]!.id], createExportPresets().slice(0, 2));
  const accepted: string[] = [];
  await assert.rejects(
    batch.submit(
      async (_doc, _seq, profile) => {
        accepted.push(profile.id);
      },
      signal(),
      (progress) => {
        if (progress.completed === 1) throw new Error("进度视图错误");
      },
    ),
    /进度视图错误/,
  );
  assert.equal(batch.progress.completed, 1);
  const view = batch.progress;
  view.completed = 100;
  await batch.submit(async (_doc, _seq, profile) => {
    accepted.push(profile.id);
  }, signal());
  assert.equal(new Set(accepted).size, 2);
  assert.equal(batch.progress.completed, 2);
});
test("empty or missing sequences, duplicate choices, invalid profiles and oversized batches reject before acceptance", () => {
  const doc = document(),
    id = doc.sequences[0]!.id,
    profiles = createExportPresets();
  assert.throws(() => new EditorExportBatch(doc, [], profiles), /序列/);
  assert.throws(() => new EditorExportBatch(doc, [id], []), /预设/);
  assert.throws(() => new EditorExportBatch(doc, [id, id], profiles), /序列/);
  assert.throws(() => new EditorExportBatch(doc, ["missing"], profiles), /不存在/);
  assert.throws(() => new EditorExportBatch(doc, [id], [profiles[0]!, profiles[0]!]), /不同/);
  const empty = structuredClone(doc);
  empty.sequences[0]!.clips = [];
  empty.sequences[0]!.transitions = [];
  assert.throws(() => new EditorExportBatch(empty, [id], profiles), /没有可导出/);
  assert.throws(() => new EditorExportBatch(doc, [id], [{ ...profiles[0]!, width: 17 }]), /偶数/);
  assert.throws(
    () =>
      new EditorExportBatch(
        doc,
        [id],
        Array.from({ length: 513 }, (_, i) => ({ ...profiles[0]!, id: `profile-${i}` })),
      ),
    /512/,
  );
});
test("sparse selections cannot silently turn a requested export batch into an empty successful batch", () => {
  const doc = document(),
    profiles = createExportPresets();
  assert.throws(() => new EditorExportBatch(doc, new Array<string>(1), profiles));
  assert.throws(() => new EditorExportBatch(doc, [doc.sequences[0]!.id], new Array(1)));
});
