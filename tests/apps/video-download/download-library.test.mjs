import assert from "node:assert/strict";
import test from "node:test";
import {
  configurationKey,
  directoryIdentity,
  duplicateCandidates,
  fileInventoryState,
  LIBRARY_VERSION,
  MAX_QUEUE,
  mediaIdentity,
  parseVideoLinks,
  restoreLibrary,
  serializeLibrary,
  storedRecord,
  videoUrl,
} from "../../../apps/video-download/app/download-library.js";

function item(overrides = {}) {
  return {
    queueId: "download-one",
    url: "https://www.youtube.com/watch?v=example&si=tracking",
    title: "示例视频",
    configuration: { format: "1080", playlist: false, subtitles: false },
    directory: { path: "/downloads/one", name: "one", kind: "chosen" },
    status: "completed",
    files: [{ path: "/downloads/one/video.mp4", bytes: 50, modifiedAt: 1000, status: "present" }],
    filesComplete: true,
    ...overrides,
  };
}

test("media identity unifies service aliases without merging different videos or playlist modes", () => {
  const youtube = mediaIdentity("https://www.youtube.com/watch?v=example&list=other&si=tracking");
  assert.equal(youtube, mediaIdentity("https://youtu.be/example?si=another"));
  assert.equal(youtube, mediaIdentity("https://m.youtube.com/shorts/example"));
  assert.notEqual(youtube, mediaIdentity("https://youtube.com/watch?v=different"));
  assert.equal(
    mediaIdentity("https://youtube.com/watch?v=example&list=series", { playlist: true }),
    "youtube:list:series",
  );
  assert.notEqual(
    youtube,
    mediaIdentity("https://youtube.com/watch?v=example&list=series", { playlist: true }),
  );
  assert.notEqual(
    mediaIdentity("https://bilibili.com/video/BVexample?p=1"),
    mediaIdentity("https://bilibili.com/video/BVexample?p=2"),
  );
  assert.equal(
    mediaIdentity("https://site.example/watch?b=2&utm_source=test&a=1"),
    mediaIdentity("https://site.example/watch?a=1&b=2"),
  );
  assert.equal(videoUrl("file:///downloads/private.mp4"), "");
  assert.equal(videoUrl("https://user:password@site.example/video"), "");
});

test("queued duplicates require the same quality, options and output directory", () => {
  const candidate = item({ status: "queued" });
  const queue = [candidate];
  assert.equal(
    duplicateCandidates(item({ url: "https://youtu.be/example" }), queue, []).queued,
    candidate,
  );
  assert.equal(
    duplicateCandidates(item({ configuration: { format: "720" } }), queue, []).queued,
    undefined,
  );
  assert.equal(
    duplicateCandidates(item({ configuration: { format: "audio" } }), queue, []).queued,
    undefined,
  );
  assert.equal(
    duplicateCandidates(item({ directory: { path: "/downloads/two" } }), queue, []).queued,
    undefined,
  );
  assert.equal(
    duplicateCandidates(item({ configuration: { format: "1080", subtitles: true } }), queue, [])
      .queued,
    undefined,
  );
  assert.equal(duplicateCandidates(item(), [item({ status: "failed" })], []).queued, undefined);
  assert.equal(
    directoryIdentity({ path: "C:\\Downloads\\" }),
    directoryIdentity({ path: "C:/Downloads" }),
  );
  assert.equal(
    configurationKey({ format: "1080", playlist: false, playlistItems: "1-2" }),
    configurationKey({ format: "1080", playlist: false, playlistItems: "8" }),
  );
  assert.notEqual(
    configurationKey({ format: "1080", playlist: true, playlistItems: "1-2" }),
    configurationKey({ format: "1080", playlist: true, playlistItems: "8" }),
  );
});

test("history matching returns candidates requiring file validation rather than a skip verdict", () => {
  const history = [
    item({ filesComplete: false }),
    item({ configuration: { format: "720" } }),
    item({ status: "failed" }),
  ];
  const result = duplicateCandidates(item(), [], history);
  assert.deepEqual(result.history, [history[0]]);
  assert.equal(fileInventoryState(result.history[0]), "unknown");
  assert.equal("skip" in result, false);
});

test("pasted multiline links deduplicate video aliases and report invalid and overflowing inputs", () => {
  const parsed = parseVideoLinks(
    "第一个：https://youtube.com/watch?v=one\n第二个 https://youtu.be/one?si=copy\nhttps://site.example/video?id=two）。",
  );
  assert.deepEqual(parsed.urls, [
    "https://youtube.com/watch?v=one",
    "https://site.example/video?id=two",
  ]);
  assert.equal(parsed.duplicates.length, 1);
  assert.deepEqual(parseVideoLinks("这不是一个链接").invalid, ["这不是一个链接"]);
  assert.equal(parseVideoLinks("https://user:secret@site.example/watch").invalid.length, 1);
  const many = parseVideoLinks(
    Array.from(
      { length: MAX_QUEUE + 3 },
      (_, index) => `https://youtube.com/watch?v=video${index}`,
    ).join("\n"),
  );
  assert.equal(many.urls.length, MAX_QUEUE);
  assert.equal(many.overflow, 3);
});

test("missing, changed, empty and unknown inventories are never considered downloaded", () => {
  assert.equal(fileInventoryState(item()), "present");
  for (const status of ["missing", "empty", "changed"]) {
    assert.equal(
      fileInventoryState(item({ files: [{ status: "present" }, { status }] })),
      "missing",
    );
  }
  for (const record of [
    item({ filesComplete: false }),
    item({ files: [] }),
    item({ files: [{ status: "unavailable" }] }),
    item({ files: [{ status: "present" }, {}] }),
  ]) {
    assert.equal(fileInventoryState(record), "unknown");
  }
});

test("serialization retains metadata but never executable, directory or cookie authorization handles", () => {
  const record = item({
    executable: { handle: "SECRET_EXECUTABLE_HANDLE" },
    directory: { path: "/downloads/one", handle: "SECRET_DIRECTORY_HANDLE" },
    fileArgumentHandles: ["SECRET_COOKIE_FILE_HANDLE"],
    cookieAuthorization: { fileArgumentHandle: "SECRET_AUTH_HANDLE" },
    args: ["SECRET_RUNTIME_ARG"],
    cookieCredentialId: "public-account-id",
  });
  const snapshot = serializeLibrary(
    { queue: [record], history: [record], queuePaused: false },
    "/project",
  );
  assert.equal(snapshot.version, LIBRARY_VERSION);
  assert.equal(snapshot.scope, "/project");
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET_|"handle"|"fileArgumentHandles"/);
  assert.equal(snapshot.queue[0].cookieCredentialId, "public-account-id");
  assert.equal(snapshot.queue[0].files[0].bytes, 50);
  assert.equal(snapshot.queue[0].directory.path, "/downloads/one");
});

test("restoring interrupted or pending work pauses it and requires fresh process grants", () => {
  const snapshot = serializeLibrary(
    {
      queue: [
        item({ status: "running" }),
        item({ status: "queued", queueId: "two" }),
        item({ status: "failed", queueId: "three" }),
      ],
      history: [],
      queuePaused: false,
    },
    "/project",
  );
  const restored = restoreLibrary(snapshot, "/project");
  assert.deepEqual(
    restored.queue.map(({ status }) => status),
    ["interrupted", "restored", "failed"],
  );
  assert.equal(restored.queuePaused, true);
  assert(
    restored.queue.every(
      (record) => !record.executable && !record.directory.handle && !record.fileArgumentHandles,
    ),
  );
  assert.equal(restoreLibrary(snapshot, "/other-project"), null);
  assert.equal(restoreLibrary({ ...snapshot, version: LIBRARY_VERSION - 1 }, "/project"), null);
});

test("legacy history and truncated inventories retain conservative validation requirements", () => {
  const legacy = storedRecord({
    url: "https://youtube.com/watch?v=legacy",
    state: "completed",
    file: "/downloads/legacy.mp4",
  });
  assert.equal(legacy.status, "completed");
  assert.equal(fileInventoryState(legacy), "unknown");
  const oversized = storedRecord(
    item({
      files: Array.from({ length: 201 }, (_, index) => ({
        path: `/downloads/${index}.mp4`,
        status: "present",
      })),
    }),
  );
  assert.equal(oversized.files.length, 200);
  assert.equal(oversized.filesComplete, false);
  assert.equal(fileInventoryState(oversized), "unknown");
});

test("storage pressure discards historical data explicitly and never silently drops pending work", () => {
  const files = Array.from({ length: 200 }, (_, index) => ({
    path: `/downloads/${index}-${"x".repeat(1200)}.mp4`,
    status: "present",
  }));
  const terminal = serializeLibrary(
    { queue: [item({ files })], history: [item({ files })], queuePaused: false },
    "/project",
  );
  assert.equal(terminal.truncated, true);
  assert.equal(terminal.history.length, 0);
  assert.equal(terminal.queue.length, 1);
  assert.equal(terminal.queue[0].filesComplete, false);
  assert.throws(
    () =>
      serializeLibrary(
        { queue: [item({ status: "queued", files })], history: [], queuePaused: false },
        "/project",
      ),
    /空间已满/,
  );
});

test("copy downloads preserve their distinct output suffix when restored or used as history", () => {
  const copy = item({ status: "queued", copySuffix: "a1b2c3d4" });
  const snapshot = serializeLibrary(
    { queue: [copy], history: [item({ copySuffix: copy.copySuffix })], queuePaused: true },
    "/project",
  );
  assert.equal(snapshot.queue[0].copySuffix, "a1b2c3d4");
  assert.equal(snapshot.history[0].copySuffix, "a1b2c3d4");
  assert.equal(restoreLibrary(snapshot, "/project").queue[0].copySuffix, "a1b2c3d4");
});

test("concurrency preference round-trips and older or invalid preferences default to three", () => {
  for (const maxConcurrent of [1, 2, 3, 4]) {
    const saved = serializeLibrary({ queue: [], history: [], maxConcurrent }, "fixture");
    assert.equal(restoreLibrary(saved, "fixture").maxConcurrent, maxConcurrent);
  }
  for (const maxConcurrent of [undefined, null, 0, -1, 5, 2.5, "4"]) {
    assert.equal(
      restoreLibrary({ version: LIBRARY_VERSION, scope: "fixture", maxConcurrent }, "fixture")
        .maxConcurrent,
      3,
    );
    assert.equal(serializeLibrary({ queue: [], history: [], maxConcurrent }).maxConcurrent, 3);
  }
});
