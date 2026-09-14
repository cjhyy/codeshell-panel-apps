import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createExternalMediaAccess,
  externalReference,
  isResourceId,
} from "../apps/video-studio/src/external-media";
import { createProject, validateProject } from "../apps/video-studio/src/model";

const reference = {
  id: `external-${"a".repeat(64)}`,
  kind: "external",
  name: "原片.mp4",
  mimeType: "video/mp4",
  bytes: 4096,
  lastModified: 123,
  createdAt: 456,
  state: "available",
};

test("external references use a separate identity and project metadata never acquires a Host locator", () => {
  const publicValue = externalReference({
    ...reference,
    path: "/private/original.mov",
    sha256: "fake",
  });
  assert.deepEqual(publicValue, reference);
  assert.ok(isResourceId(reference.id));
  assert.ok(isResourceId(`asset-${"b".repeat(64)}`));
  assert.equal(isResourceId("external-../../file"), false);
  const project = createProject();
  project.assets = [
    {
      id: "source",
      name: reference.name,
      kind: "video",
      durationFrames: 90,
      mediaId: reference.id,
    },
  ];
  project.roughCuts = [
    { id: "kept", assetId: "source", inFrame: 12, outFrame: 60, name: "保留", enabled: true },
  ];
  assert.deepEqual(validateProject(project).roughCuts, project.roughCuts);
  for (const patch of [
    { id: `asset-${"a".repeat(64)}` },
    { state: "unknown" },
    { bytes: 0 },
    { name: "../file" },
    { mimeType: "text/html" },
  ])
    assert.throws(() => externalReference({ ...reference, ...patch }));
});

test("selecting and reconnecting an external source never falls back to an upload or capture", async () => {
  const calls: string[] = [];
  let picked = reference;
  const bridge: any = {
    getContext: async () => ({
      availableMethods: ["resources.references.pick", "resources.references.get"],
    }),
    call: async (method: string) => {
      calls.push(method);
      if (method === "resources.references.pick") return { references: [picked] };
      if (method === "resources.references.get") return { reference: picked };
      throw new Error("Unexpected byte-copy call");
    },
  };
  const access = createExternalMediaAccess(bridge);
  try {
    assert.deepEqual(await access.pick(), [reference]);
    assert.deepEqual(await access.pick(reference.id), [reference]);
    assert.deepEqual(await access.get(reference.id), reference);
    picked = { ...reference, id: `external-${"b".repeat(64)}` };
    await assert.rejects(access.pick(reference.id), /已变化/);
    assert.ok(calls.every((method) => method.startsWith("resources.references.")));
  } finally {
    access.dispose();
  }
  const unavailable = createExternalMediaAccess({
    ...bridge,
    getContext: async () => ({ availableMethods: ["resources.capture"] }),
  });
  try {
    await assert.rejects(unavailable.pick(), /尚不支持引用原文件/);
  } finally {
    unavailable.dispose();
  }
});
