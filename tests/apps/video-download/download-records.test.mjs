import assert from "node:assert/strict";
import test from "node:test";
import {
  downloadSourceLabel, getHistoryRecords, getTaskRecords, normalizeCliRecord,
} from "../../../apps/video-download/app/download-records.js";

const id = "12345678-1234-4567-8901-123456789abc";
const otherId = "12345678-1234-4567-8901-123456789def";
const cli = (overrides = {}) => ({
  id, status: "running", url: "https://www.youtube.com/watch?v=fixture", title: "CLI video",
  configuration: { format: "1080" }, outputDirectory: "/project/downloads",
  files: [], createdAt: 100, updatedAt: 200, attempt: 1, source: "chat", ...overrides,
});

test("CLI records adapt to the shared display shape without inheriting Host grants", () => {
  const record = normalizeCliRecord(cli({
    progress: { fraction: 0.42 }, nativeTaskId: id, nativeRequestKey: `download:${id}`,
    nativePackage: { version: "old", packageDigest: "a".repeat(64) },
    cookieCredentialId: "secret-account", workerToken: "secret-token",
    configuration: { format: "audio", cookieAccount: "account" },
    files: [{ path: "/project/downloads/video.mp3", name: "video.mp3", bytes: 123,
      modifiedAt: 42, status: "present", assetId: `asset-${"a".repeat(64)}`, handle: "secret" }],
  }));
  assert.equal(record.queueId, `cli:${id}`);
  assert.equal(record.backend, "cli");
  assert.equal(record.cliJobId, id);
  assert.equal(record.percent, 42);
  assert.equal(record.configuration.format, "audio");
  assert.equal(record.configuration.cookieAccount, null);
  assert.deepEqual(record.directory, { path: "/project/downloads", name: "downloads", kind: "cli" });
  assert.deepEqual(record.files, [{ path: "/project/downloads/video.mp3", name: "video.mp3",
    bytes: 123, modifiedAt: 42, status: "present" }]);
  for (const field of ["nativeTaskId", "nativeRequestKey", "nativePackage", "cookieCredentialId", "workerToken"])
    assert.equal(Object.hasOwn(record, field), false, field);
  assert.equal(downloadSourceLabel(record), "聊天");
});

test("record normalization rejects malformed identities and preserves conservative file state", () => {
  for (const overrides of [
    { id: "../escape" }, { status: "invented" }, { url: "file:///etc/passwd" },
    { url: "https://user:secret@example.com/video" },
  ]) assert.equal(normalizeCliRecord(cli(overrides)), null);
  const record = normalizeCliRecord(cli({
    progress: { fraction: 2 }, files: [{ path: "video.mp4", status: "invented", bytes: -1 }, {}],
    source: "__proto__", error: { message: "x".repeat(600) }, createdAt: NaN,
  }));
  assert.equal(record.percent, 100);
  assert.equal(record.filesComplete, false);
  assert.deepEqual(record.files, [{ path: "video.mp4", status: "unavailable" }]);
  assert.equal(record.error.length, 500);
  assert.equal(record.addedAt, 0);
  assert.equal(record.source, "cli");
  assert.equal(downloadSourceLabel(record), "终端");
  assert.equal(normalizeCliRecord(cli({ progress: { fraction: -1 } })).percent, 0);
  assert.equal(normalizeCliRecord(cli({ progress: { fraction: "0.5" } })).percent, null);
});

test("active CLI tasks and finished history share stable IDs while Host items keep ownership", () => {
  const host = { queueId: id, status: "running", nativeTaskId: "host-native", handle: "host-handle" };
  const completed = cli({ id: otherId, status: "completed", finishedAt: 400 });
  const tasks = getTaskRecords([host, host], [cli(), completed]);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0], host);
  assert.deepEqual(tasks.map((item) => item.queueId), [id, `cli:${id}`]);
  assert.deepEqual(getHistoryRecords([], [cli(), completed]).map((item) => item.queueId), [`cli:${otherId}`]);
  assert.equal(getTaskRecords([host], [cli(), completed], { includeFinished: true }).length, 3);
  assert.equal(host.backend, undefined, "view composition never modifies legacy Host data");
});

test("newer CLI snapshots win once and terminal states move into history", () => {
  const pending = cli({ status: "pending", updatedAt: 100 });
  assert.equal(getTaskRecords([], [pending])[0].canStart, true);
  const failed = cli({ status: "failed", updatedAt: 400, finishedAt: 400 });
  assert.equal(getTaskRecords([], [pending, failed, cli()]).length, 0);
  assert.equal(getHistoryRecords([], [pending, failed, cli()]).length, 1);
  assert.equal(getHistoryRecords([], [pending, failed, cli()])[0].status, "failed");
  const interrupted = cli({ status: "interrupted", updatedAt: 500 });
  assert.equal(getHistoryRecords([], [interrupted])[0].status, "interrupted");
  const cancelled = cli({ status: "cancelled", updatedAt: 600, finishedAt: 600 });
  assert.equal(getHistoryRecords([], [cancelled])[0].status, "cancelled");
});

test("archived latest snapshots stay hidden and history sorts deterministically", () => {
  const old = cli({ status: "completed", finishedAt: 300, updatedAt: 300 });
  const archived = cli({ status: "completed", finishedAt: 300, updatedAt: 400, archivedAt: 400 });
  assert.deepEqual(getTaskRecords([], [old, archived], { includeFinished: true }), []);
  assert.deepEqual(getHistoryRecords([], [old, archived]), []);
  const host = { queueId: "host-old", status: "completed", finishedAt: 200 };
  const newer = cli({ id: otherId, status: "failed", finishedAt: 500, source: "panel" });
  const result = getHistoryRecords([host], [old, newer]);
  assert.deepEqual(result.map((record) => record.queueId), [`cli:${otherId}`, `cli:${id}`, "host-old"]);
  assert.equal(result.at(-1), host);
  assert.equal(downloadSourceLabel(result[0]), "面板");
  assert.equal(downloadSourceLabel(host), "面板");
});

test("file inventories retain checked metadata and disclose truncation", () => {
  const files = Array.from({ length: 201 }, (_, index) => ({
    path: `/project/video-${index}.mp4`, status: "changed", checkedAt: 200,
    sha256: "f".repeat(64), modifiedAt: 100, bytes: 123,
  }));
  const record = normalizeCliRecord(cli({ files, checkedAt: 200 }));
  assert.equal(record.files.length, 200);
  assert.equal(record.filesComplete, false);
  assert.equal(record.files[0].checkedAt, 200);
  assert.equal(record.files[0].sha256, "f".repeat(64));
  assert.equal(record.checkedAt, 200);
  assert.equal(normalizeCliRecord(cli({ files: files.slice(0, 1), filesComplete: false })).filesComplete, false);
});
