import assert from "node:assert/strict";
import test from "node:test";
import { prepareFolderFiles, sameFileContents } from "../apps/video-studio/src/folder-files";
import {
  applyOperations,
  createProject,
  validateProject,
  type Asset,
} from "../apps/video-studio/src/model";

function selected(path: string, content = "original media", type = "", lastModified = 123): File {
  const file = new File([content], path.split("/").at(-1) || "clip.mp4", { type, lastModified });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}
function projectWithPath(sourcePath?: unknown) {
  const project = createProject("文件夹素材");
  project.assets = [
    {
      id: "source",
      name: "同名.mp4",
      kind: "video",
      durationFrames: 120,
      width: 640,
      height: 360,
      size: 100,
      lastModified: 123,
      mediaId: `asset-${"a".repeat(64)}`,
      ...(sourcePath === undefined ? {} : { sourcePath }),
    } as Asset,
  ];
  project.clips = [{ id: "clip", assetId: "source", inFrame: 15, outFrame: 90, volume: 0.6 }];
  return project;
}

test("folder selection filters non-media, hidden paths, dependency directories and empty files", () => {
  const inputs = [
    selected("素材/视频.mp4"),
    selected("素材/音乐.wav"),
    selected("素材/封面.png"),
    selected("素材/readme.txt"),
    selected("素材/executable.exe", "binary", "video/mp4"),
    selected("素材/.hidden/clip.mp4"),
    selected("素材/.clip.mp4"),
    selected("素材/node_modules/example/clip.mp4"),
    selected("素材/empty.mp4", ""),
  ];
  const result = prepareFolderFiles(inputs);
  assert.equal(result.files.length, 3);
  assert.equal(result.skipped, 6);
  assert.deepEqual(
    result.files.map((file) => file.webkitRelativePath),
    ["素材/封面.png", "素材/视频.mp4", "素材/音乐.wav"],
  );
  assert.equal(inputs.length, 9, "Preparing a folder must not mutate its FileList snapshot");
});

test("extension MIME normalization preserves original bytes, modification time and relative paths", async () => {
  const cases = [
    ["片段.MP4", "video/mp4"],
    ["片段.MOV", "video/quicktime"],
    ["参考.WAV", "audio/wav"],
    ["音乐.M4A", "audio/mp4"],
    ["声音.OPUS", "audio/ogg"],
    ["封面.JPEG", "image/jpeg"],
    ["封面.AVIF", "image/avif"],
  ];
  for (const [name, mime] of cases) {
    const original = selected(
      `根目录/子目录/${name}`,
      `原始字节:${name}`,
      "application/octet-stream",
      456,
    );
    const normalized = prepareFolderFiles([original]).files[0]!;
    assert.notEqual(normalized, original);
    assert.equal(normalized.type, mime);
    assert.equal(normalized.lastModified, 456);
    assert.equal(normalized.name, name);
    assert.equal(normalized.webkitRelativePath, original.webkitRelativePath);
    assert.deepEqual(
      new Uint8Array(await normalized.arrayBuffer()),
      new Uint8Array(await original.arrayBuffer()),
    );
    assert.equal(original.type, "application/octet-stream");
  }
});

test("lexical path ordering is deterministic and nested identical names never collapse", async () => {
  const inputs = [selected("root/B/同名.mp4", "second"), selected("root/A/同名.mp4", "first")];
  const prepared = prepareFolderFiles(inputs);
  assert.deepEqual(
    prepared.files.map((file) => file.webkitRelativePath),
    ["root/A/同名.mp4", "root/B/同名.mp4"],
  );
  assert.deepEqual(await Promise.all(prepared.files.map((file) => file.text())), [
    "first",
    "second",
  ]);
  assert.deepEqual(
    inputs.map((file) => file.webkitRelativePath),
    ["root/B/同名.mp4", "root/A/同名.mp4"],
  );
  assert.deepEqual(
    prepareFolderFiles([...inputs].reverse()).files.map((file) => file.webkitRelativePath),
    prepared.files.map((file) => file.webkitRelativePath),
  );
});

test("ordinary File fallback uses its name while an empty folder is a harmless empty snapshot", () => {
  const input = new File(["audio"], "录音.wav", { lastModified: 100 });
  assert.equal(prepareFolderFiles([input]).files[0]!.webkitRelativePath, "录音.wav");
  assert.deepEqual(prepareFolderFiles([]), { files: [], skipped: 0 });
});

test("folder snapshots reject escaped, absolute or malformed relative paths before importing", () => {
  for (const path of [
    "/private/video.mp4",
    "C:/private/video.mp4",
    "C:video.mp4",
    "root/../video.mp4",
    "root/./video.mp4",
    "root//video.mp4",
    "root\\video.mp4",
    "root/\u0000video.mp4",
    "root/\nvideo.mp4",
    `root/${"a".repeat(241)}.mp4`,
    `${"a/".repeat(511)}video.mp4`,
  ])
    assert.throws(() => prepareFolderFiles([selected(path)]), undefined, path);
});

test("the 1000-file cap counts accepted media only and rejects oversized batches atomically", () => {
  const accepted = Array.from({ length: 1000 }, (_, i) => selected(`folder/${i}.png`, "image"));
  const result = prepareFolderFiles([...accepted, selected("folder/readme.txt")]);
  assert.equal(result.files.length, 1000);
  assert.equal(result.skipped, 1);
  assert.throws(() => prepareFolderFiles([...accepted, selected("folder/over.png")]), /1000/);
  assert.equal(accepted.length, 1000);
});

test("sourcePath survives portable JSON and edits without changing source or clip identity", () => {
  const original = projectWithPath("旅行/第一天/同名.mp4");
  const restored = validateProject(JSON.parse(JSON.stringify(original)));
  assert.equal(restored.assets[0]!.sourcePath, "旅行/第一天/同名.mp4");
  assert.deepEqual(restored.clips, original.clips);
  const trimmed = applyOperations(
    restored,
    [{ type: "trim", clipId: "clip", inFrame: 30, outFrame: 75 }],
    restored.revision,
  );
  assert.equal(trimmed.assets[0]!.sourcePath, original.assets[0]!.sourcePath);
  assert.equal(trimmed.assets[0]!.mediaId, original.assets[0]!.mediaId);
  assert.equal(trimmed.clips[0]!.assetId, "source");
  assert.equal(
    validateProject(JSON.parse(JSON.stringify(trimmed))).assets[0]!.sourcePath,
    "旅行/第一天/同名.mp4",
  );
  assert.equal(
    validateProject(projectWithPath()).assets[0]!.sourcePath,
    undefined,
    "Older projects remain compatible",
  );
});

test("the model rejects non-relative sourcePath data rather than restoring filesystem paths", () => {
  for (const path of [
    "",
    null,
    42,
    "/private/video.mp4",
    "C:/private/video.mp4",
    "C:video.mp4",
    "../video.mp4",
    "root/../video.mp4",
    "root//video.mp4",
    "root\\video.mp4",
    "root/\u0000video.mp4",
    "root/\nvideo.mp4",
    "x".repeat(1025),
  ])
    assert.throws(() => validateProject(projectWithPath(path)), undefined, String(path));
});

function trackedFile(bytes: Uint8Array, onRead?: (offset: number) => void) {
  const file = new File([bytes], "same.mp4", { type: "video/mp4", lastModified: 123 });
  const reads: { offset: number; bytes: number }[] = [];
  const originalSlice = file.slice.bind(file);
  Object.defineProperty(file, "slice", {
    value: (start: number, end: number) => {
      const part = originalSlice(start, end);
      assert.ok(part.size <= 1024 * 1024, "File comparisons must not allocate whole clips");
      const read = part.arrayBuffer.bind(part);
      Object.defineProperty(part, "arrayBuffer", {
        value: async () => {
          const result = await read();
          reads.push({ offset: start, bytes: result.byteLength });
          onRead?.(start);
          return result;
        },
      });
      return part;
    },
  });
  return { file, reads };
}

test("identical name, size and modification time cannot hide a different final chunk", async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024 + 17).fill(23);
  const changed = bytes.slice();
  changed[changed.length - 1] = 24;
  const left = trackedFile(bytes),
    right = trackedFile(changed);
  assert.equal(left.file.name, right.file.name);
  assert.equal(left.file.size, right.file.size);
  assert.equal(left.file.lastModified, right.file.lastModified);
  assert.equal(await sameFileContents(left.file, right.file), false);
  assert.deepEqual(
    left.reads.map((read) => read.bytes),
    [1024 * 1024, 1024 * 1024, 17],
  );
  assert.deepEqual(left.reads, right.reads);
});

test("equal content is compared through bounded chunks and different sizes need no reads", async () => {
  const bytes = new Uint8Array(1024 * 1024 + 5).fill(48);
  const left = trackedFile(bytes),
    right = trackedFile(bytes.slice());
  assert.equal(await sameFileContents(left.file, right.file), true);
  assert.deepEqual(left.reads, [
    { offset: 0, bytes: 1024 * 1024 },
    { offset: 1024 * 1024, bytes: 5 },
  ]);
  assert.deepEqual(left.reads, right.reads);
  const shorter = trackedFile(bytes.subarray(0, bytes.length - 1));
  const unread = trackedFile(bytes);
  assert.equal(await sameFileContents(unread.file, shorter.file), false);
  assert.deepEqual(unread.reads, []);
  assert.deepEqual(shorter.reads, []);
});

test("a project generation change during a chunk read stops comparison before the next chunk", async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024 + 17).fill(72);
  let generation = 1;
  const left = trackedFile(bytes, (offset) => {
    if (offset === 1024 * 1024) generation = 2;
  });
  const right = trackedFile(bytes.slice());
  await assert.rejects(
    sameFileContents(left.file, right.file, () => generation === 1),
    /工程已切换/,
  );
  assert.deepEqual(
    left.reads.map((read) => read.offset),
    [0, 1024 * 1024],
  );
  assert.deepEqual(left.reads, right.reads);
});
