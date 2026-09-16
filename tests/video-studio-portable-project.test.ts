import assert from "node:assert/strict";
import { test } from "node:test";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { createDemoProject } from "../apps/video-studio/src/model";
import {
  validatePortableProjectManifest,
  remapPortableProjectResources,
  portableMediaPath,
  PORTABLE_PROJECT_FORMAT,
  PORTABLE_PROJECT_VERSION,
} from "../apps/video-studio/src/editor/portable-project";
function manifest() {
  const document = migrateLegacyProject(createDemoProject());
  document.assets = document.assets.filter((asset) => asset.kind === "demo");
  // Preserve complete sequences, but use ordinary synthetic media for portable identity assertions.
  document.assets.push({
    id: "source-one",
    name: "原片 A",
    kind: "video",
    duration: 480000,
    width: 32,
    height: 32,
    resourceId: "external-deviceA",
  });
  document.assets.push({
    id: "source-two",
    name: "原片 B",
    kind: "video",
    duration: 480000,
    width: 32,
    height: 32,
    resourceId: "external-deviceB",
  });
  for (const sequence of document.sequences)
    sequence.clips = sequence.clips.filter(
      (clip) => clip.kind !== "media" || document.assets.some((asset) => asset.id === clip.assetId),
    );
  return {
    format: PORTABLE_PROJECT_FORMAT,
    formatVersion: PORTABLE_PROJECT_VERSION,
    document,
    media: [{ sha256: "a".repeat(64), bytes: 100, assetIds: ["source-one", "source-two"] }],
  };
}
test("portable manifest preserves complete schema and remaps only media resource identity on the receiving device", () => {
  const source = manifest(),
    expected = structuredClone(source.document);
  const parsed = validatePortableProjectManifest(source);
  source.document.name = "后来编辑";
  assert.deepEqual(parsed.document, expected);
  const received = remapPortableProjectResources(parsed, [
    { sha256: "a".repeat(64), resourceId: "asset-new-device" },
  ]);
  for (const asset of expected.assets)
    if (asset.kind !== "demo") {
      asset.resourceId = "asset-new-device";
      asset.fingerprint = "a".repeat(64);
    }
  assert.deepEqual(received, expected);
  assert.equal(
    parsed.document.assets.find((asset) => asset.id === "source-one")!.resourceId,
    "external-deviceA",
  );
  assert.equal(portableMediaPath("a".repeat(64)), `media/${"a".repeat(64)}`);
});
test("incomplete, duplicate, unbound, procedural and mismatched asset mappings reject", () => {
  const source = manifest();
  for (const media of [
    [],
    [source.media[0]!, source.media[0]!],
    [{ ...source.media[0]!, assetIds: ["source-one"] }],
    [{ ...source.media[0]!, assetIds: ["source-one", "missing"] }],
    [
      {
        ...source.media[0]!,
        assetIds: ["source-one", "source-two", source.document.assets[0]!.id],
      },
    ],
  ])
    assert.throws(() => validatePortableProjectManifest({ ...source, media }));
  source.document.assets.find((asset) => asset.id === "source-one")!.fingerprint = "b".repeat(64);
  assert.throws(() => validatePortableProjectManifest(source), /摘要/);
});
test("unknown format versions and fields, prototype objects, accessors and sparse arrays fail without reading getters", () => {
  const source = manifest();
  assert.throws(() => validatePortableProjectManifest({ ...source, formatVersion: 2 }), {
    code: "UNSUPPORTED_BUNDLE_VERSION",
  });
  assert.throws(() => validatePortableProjectManifest({ ...source, path: "/tmp/anything" }));
  assert.throws(() => validatePortableProjectManifest(Object.assign(Object.create({}), source)));
  assert.throws(() => validatePortableProjectManifest({ ...source, media: new Array(1) }));
  assert.throws(() =>
    validatePortableProjectManifest({
      ...source,
      media: [{ ...source.media[0], assetIds: new Array(1) }],
    }),
  );
  let read = false;
  const getter = { ...source };
  Object.defineProperty(getter, "document", {
    enumerable: true,
    get() {
      read = true;
      throw new Error("executed");
    },
  });
  assert.throws(() => validatePortableProjectManifest(getter));
  assert.equal(read, false);
  for (const digest of ["../bad", "/tmp/file", "A".repeat(64), "a".repeat(63)])
    assert.throws(() => portableMediaPath(digest));
});
test("resource remap requires all blobs exactly once before replacement", () => {
  const source = manifest(),
    map = { sha256: "a".repeat(64), resourceId: "asset-received" };
  for (const resources of [
    [],
    [map, map],
    [{ ...map, sha256: "b".repeat(64) }],
    [{ ...map, resourceId: "/tmp/file" }],
    new Array(1),
  ])
    assert.throws(() => remapPortableProjectResources(source, resources));
});
