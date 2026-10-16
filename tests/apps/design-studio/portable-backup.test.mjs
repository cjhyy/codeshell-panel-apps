import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  createPortableDesign,
  planPortableDesign,
  restorePortableDesign,
} from "../../../apps/design-studio/app/portable-backup.mjs";
import {
  parseDesignIndexSource,
  resolveDesignIndexPages,
} from "../../../apps/design-studio/app/document-index.mjs";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createDesignResourcePersistencePlan } from "../../../apps/design-studio/app/resource-store.mjs";
import { REVIEW_COMMENTS_FORMAT } from "../../../apps/design-studio/app/review-comments.mjs";
import {
  createDesignSidecarPlan,
  readDesignSidecar,
  DESIGN_SIDECAR_PART_BYTES,
} from "../../../apps/design-studio/app/design-sidecar.mjs";
import { createFigmaBinding } from "../../../apps/design-studio/app/figma-binding.mjs";
import { createPrototype } from "../../../apps/design-studio/app/prototype.mjs";
const hash = async (value) => createHash("sha256").update(value).digest("hex");
const options = { sha256: hash, sha256Bytes: hash };
const pixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
async function fixture() {
  const image = await createDesignResourcePersistencePlan({
    id: "pixel",
    kind: "image",
    mime: "image/png",
    base64: pixel,
    sha256Bytes: hash,
  });
  const font = await createDesignResourcePersistencePlan({
    id: "font",
    kind: "font",
    mime: "font/woff2",
    family: "Fixture",
    base64: Buffer.from("font fixture bytes").toString("base64"),
    sha256Bytes: hash,
  });
  const files = new Map([...image.parts, ...font.parts].map((p) => [p.path, p.content]));
  const document = normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: "Two pages",
    canvas: { width: 800, height: 600, background: "#ffffff" },
    tokens: { colors: [] },
    activePageId: "page-1",
    resources: [image.descriptor, font.descriptor],
    pages: [
      { id: "page-1", name: "One", children: [] },
      { id: "page-2", name: "Two", children: [] },
    ],
  });
  const source = {
    workspaceRoot: "/workspace",
    sessionId: "source-project",
    path: "designs/source.codesign.json",
  };
  const text = await createPortableDesign({
    document,
    source,
    readText: async (path) => files.get(path),
    sha256Bytes: hash,
  });
  return { text, files, document, source };
}
function host(files, hook = () => {}) {
  const calls = [];
  return {
    calls,
    call: async (method, params) => {
      calls.push({ method, ...params });
      if (method === "workspace.readText") {
        if (!files.has(params.path)) throw Error("missing");
        return { content: files.get(params.path) };
      }
      assert.equal(params.expectedModifiedAt, null);
      if (files.has(params.path)) throw Error("already exists");
      await hook(params);
      files.set(params.path, params.content);
      return {};
    },
  };
}
test("complete backup restores every page, image and font into an independent project", async () => {
  const f = await fixture(),
    plan = await planPortableDesign(f.text, options),
    target = new Map(),
    h = host(target);
  assert.equal(plan.pageCount, 2);
  assert.equal(plan.resourceCount, 2);
  await restorePortableDesign({
    plan,
    path: "designs/restored.codesign.json",
    call: h.call,
    check() {},
  });
  for (const [path, content] of f.files) assert.equal(target.get(path), content);
  assert.equal(JSON.parse(target.get("designs/restored.codesign.json")).pages.length, 2);
  assert.equal(h.calls.at(-1).path, "designs/restored.codesign.json");
});
test("invalid, missing, duplicate and altered resources are rejected before restoration", async () => {
  const { text } = await fixture();
  for (const change of [
    (v) => v.resources.pop(),
    (v) => (v.resources[0].base64 = "AA=="),
    (v) => (v.resources[1].id = v.resources[0].id),
    (v) => (v.resources[0].path = "../outside"),
    (v) => (v.version = 2),
  ]) {
    const value = JSON.parse(text);
    change(value);
    await assert.rejects(planPortableDesign(JSON.stringify(value), options));
  }
  await assert.rejects(
    planPortableDesign('{"format":"codeshell.design.recovery-backup","version":1}', options),
  );
});
test("failed part writes never commit a primary document; retry reuses only identical parts", async () => {
  const { text } = await fixture(),
    plan = await planPortableDesign(text, options),
    files = new Map();
  let fail = true;
  const h = host(files, (part) => {
    if (part.path === plan.parts[1].path && fail) throw Error("disk full");
  });
  const request = { plan, path: "designs/retry.codesign.json", call: h.call, check() {} };
  await assert.rejects(restorePortableDesign(request), /disk full/);
  assert.equal(files.has(request.path), false);
  fail = false;
  await restorePortableDesign(request);
  assert.equal(files.has(request.path), true);
  files.set(request.path, "keep original");
  await assert.rejects(restorePortableDesign(request), /冲突/);
  assert.equal(files.get(request.path), "keep original");
});
test("a lost write receipt is checked without sending a duplicate write", async () => {
  const { text } = await fixture(),
    plan = await planPortableDesign(text, options),
    files = new Map(),
    h = host(files);
  const call = async (method, params) => {
    const result = await h.call(method, params);
    if (method === "workspace.writeText") throw Error("lost acknowledgement");
    return result;
  };
  await restorePortableDesign({ plan, path: "designs/lost.codesign.json", call, check() {} });
  assert.equal(
    h.calls.filter((c) => c.method === "workspace.writeText").length,
    plan.parts.length + 1,
  );
});
test("switching project after a write prevents subsequent reads and writes; invalid targets never write", async () => {
  const { text } = await fixture(),
    plan = await planPortableDesign(text, options),
    calls = [];
  let active = true;
  await assert.rejects(
    restorePortableDesign({
      plan,
      path: "designs/copy.codesign.json",
      check() {
        if (!active) throw Error("project changed");
      },
      call: async (method, params) => {
        calls.push({ method, ...params });
        active = false;
        throw Error("old response");
      },
    }),
    /project changed/,
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    restorePortableDesign({
      plan,
      path: "../outside.codesign.json",
      call: async () => assert.fail(),
      check() {},
    }),
  );
});

test("large complete backups restore indexed page parts with verified content", async () => {
  const f = await fixture(),
    raw = JSON.parse(f.text);
  raw.document.pages[0].children = Array.from({ length: 1000 }, (_, i) => ({
    id: `rect-${i}`,
    type: "rectangle",
    name: `Rectangle ${i}`,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    fill: "#ffffff",
    stroke: "transparent",
    strokeWidth: 0,
    opacity: 1,
    rotation: 0,
    cornerRadius: 0,
    visible: true,
    locked: false,
    notes: "设计备份内容".repeat(60),
  }));
  const plan = await planPortableDesign(JSON.stringify(raw), options);
  const manifest = parseDesignIndexSource(plan.primarySource);
  assert.ok(manifest, "large designs must use the indexed persistence path");
  const files = new Map(),
    h = host(files);
  await restorePortableDesign({
    plan,
    path: "designs/large.codesign.json",
    call: h.call,
    check() {},
  });
  const pages = await resolveDesignIndexPages({
    manifest,
    pageIds: manifest.pages.map((p) => p.id),
    readText: async (path) => files.get(path),
    sha256: hash,
  });
  assert.equal(pages.get("page-1").children.length, 1000);
  assert.equal(pages.get("page-1").children[999].notes, raw.document.pages[0].children[999].notes);
  assert.equal(pages.get("page-2").children.length, 0);
});

function comments(designPath) {
  const date = "2026-10-16T08:00:00.000Z";
  return JSON.stringify({
    format: REVIEW_COMMENTS_FORMAT,
    version: 1,
    designPath,
    threads: [
      {
        id: "review-1",
        pageId: "page-1",
        nodeId: "card",
        text: "Improve contrast",
        author: "Reviewer",
        createdAt: date,
        updatedAt: date,
        status: "open",
        replies: [
          {
            id: "reply-1",
            text: "Adjusted",
            author: "Designer",
            createdAt: date,
          },
        ],
      },
    ],
  });
}
function backupFigmaBinding(document, opaque = "") {
  return createFigmaBinding({
    document,
    mapping: [],
    source: {
      format: "codeshell.figma.source",
      version: 1,
      nodes: {
        root: {
          document: {
            id: "0:0",
            type: "DOCUMENT",
            children: document.pages.map((page, index) => ({
              id: `0:${index + 1}`,
              type: "CANVAS",
              name: page.name,
              children: [],
              ...(index === 0 && opaque ? { raw: opaque } : {}),
            })),
          },
        },
      },
    },
    pageMappings: document.pages.map((page, index) => ({
      designId: page.id,
      sourceId: `0:${index + 1}`,
      offsetX: 0,
      offsetY: 0,
    })),
  });
}
async function completeFixture() {
  const f = await fixture();
  f.files.set("designs/source.comments.json", comments(f.source.path));
  const binding = backupFigmaBinding(f.document);
  const text = await createPortableDesign({
    ...f,
    sha256Bytes: hash,
    includeComments: true,
    attachments: [
      { kind: "figma-binding", suffix: ".figma-source.json", content: JSON.stringify(binding) },
      {
        kind: "prototype",
        suffix: ".prototype.json",
        content: JSON.stringify(createPrototype(f.document)),
      },
    ],
    readText: async (path) => {
      if (!f.files.has(path)) throw Error("file missing");
      return { content: f.files.get(path) };
    },
  });
  return { ...f, text, binding };
}
test("v2 backup verifies and restores comments, replies and generic attachments under the new basename", async () => {
  const f = await completeFixture(),
    backup = JSON.parse(f.text),
    plan = await planPortableDesign(f.text, options);
  assert.equal(backup.version, 2);
  assert.equal(backup.coverage.comments, "included");
  assert.deepEqual(backup.counts, { attachments: 3, threads: 1, replies: 1 });
  const target = new Map(),
    h = host(target);
  const result = await restorePortableDesign({
    plan,
    path: "designs/new-name.codesign.json",
    call: h.call,
    check() {},
  });
  const restored = JSON.parse(target.get("designs/new-name.comments.json"));
  assert.equal(restored.designPath, "designs/new-name.codesign.json");
  assert.equal(restored.threads[0].replies[0].text, "Adjusted");
  assert.equal(target.has("designs/source.comments.json"), false);
  assert.deepEqual(JSON.parse(target.get("designs/new-name.figma-source.json")), f.binding);
  assert.deepEqual(result.attachmentCounts, backup.counts);
  assert.equal(h.calls.at(-1).path, "designs/new-name.codesign.json");
});
test("v2 attachment tampering, wrong counts, duplicate paths and malformed comments are rejected read-only", async () => {
  const f = await completeFixture();
  for (const change of [
    (value) => (value.attachments[0].sha256 = "0".repeat(64)),
    (value) => value.attachments[0].bytes++,
    (value) => value.counts.replies++,
    (value) => value.attachments.push(value.attachments[0]),
    (value) => (value.attachments[1].suffix = "../outside"),
    (value) => (value.attachments[0].content = comments("designs/other.codesign.json")),
    (value) => (value.coverage.comments = "absent"),
  ]) {
    const value = JSON.parse(f.text);
    change(value);
    await assert.rejects(planPortableDesign(JSON.stringify(value), options));
  }
  const plan = await planPortableDesign(f.text, options);
  plan.attachments[1].content = "changed after review";
  await assert.rejects(
    restorePortableDesign({
      plan,
      path: "designs/keep.codesign.json",
      check() {},
      call: async () => assert.fail("must validate before any write"),
    }),
    /校验失败|不是有效 JSON/,
  );
});
test("known source and prototype attachments require valid schemas even when their hashes are correct", async () => {
  const f = await completeFixture();
  for (const [index, content] of [
    [1, '{"format":"unknown-source"}'],
    [2, JSON.stringify({ ...createPrototype(f.document), startPageId: "deleted-page" })],
  ]) {
    const backup = JSON.parse(f.text),
      entry = backup.attachments[index];
    entry.content = content;
    entry.bytes = Buffer.byteLength(content);
    entry.sha256 = await hash(content);
    await assert.rejects(planPortableDesign(JSON.stringify(backup), options));
  }
  await assert.rejects(
    createPortableDesign({
      ...f,
      sha256Bytes: hash,
      readText: async (path) => f.files.get(path),
      attachments: [{ kind: "unknown", suffix: ".unknown.json", content: "{}" }],
    }),
    /不支持/,
  );
});
test("a conflicting companion is detected before any resource or design write", async () => {
  const f = await completeFixture(),
    plan = await planPortableDesign(f.text, options),
    target = new Map();
  target.set("designs/new.comments.json", "User-owned discussion file");
  const h = host(target);
  await assert.rejects(
    restorePortableDesign({ plan, path: "designs/new.codesign.json", call: h.call, check() {} }),
    /冲突/,
  );
  assert.equal(h.calls.filter((call) => call.method === "workspace.writeText").length, 0);
  assert.equal(target.get("designs/new.comments.json"), "User-owned discussion file");
});
test("comment absence is explicit; unknown reads, malformed records and missing sidecar parts block download", async () => {
  const f = await fixture();
  const create = (readComments) =>
    createPortableDesign({
      ...f,
      includeComments: true,
      sha256Bytes: hash,
      readText: async (path) =>
        path === "designs/source.comments.json" ? readComments() : f.files.get(path),
    });
  const absent = JSON.parse(
    await create(() => {
      throw Error("file missing");
    }),
  );
  assert.equal(absent.coverage.comments, "absent");
  assert.equal(absent.counts.threads, 0);
  await assert.rejects(
    create(() => undefined),
    /读取失败/,
  );
  await assert.rejects(
    create(() => {
      throw Error("permission denied");
    }),
    /permission denied/,
  );
  await assert.rejects(
    create(() => "user data"),
    /JSON 格式无效/,
  );
  const sidecar = await createDesignSidecarPlan("x".repeat(DESIGN_SIDECAR_PART_BYTES + 100), {
    sha256: hash,
  });
  await assert.rejects(
    createPortableDesign({
      ...f,
      includeComments: true,
      sha256Bytes: hash,
      readText: async (path) => {
        if (path === "designs/source.comments.json") return { content: sidecar.primarySource };
        if (path.startsWith("designs/codesign-data/attachments/")) throw Error("file missing");
        return f.files.get(path);
      },
    }),
    /附属分片无法读取/,
  );
});
test("large opaque attachments restore through bounded immutable sidecar parts", async () => {
  const f = await fixture(),
    content = JSON.stringify(backupFigmaBinding(f.document, "源文件".repeat(100_000)));
  const text = await createPortableDesign({
    ...f,
    sha256Bytes: hash,
    readText: async (path) => f.files.get(path),
    attachments: [{ kind: "figma-binding", suffix: ".figma-source.json", content }],
  });
  const plan = await planPortableDesign(text, options),
    target = new Map(),
    h = host(target);
  await restorePortableDesign({
    plan,
    path: "designs/large-source.codesign.json",
    call: h.call,
    check() {},
  });
  assert(
    h.calls
      .filter((call) => call.method === "workspace.writeText")
      .every((call) => Buffer.byteLength(call.content) <= DESIGN_SIDECAR_PART_BYTES),
  );
  const restored = await readDesignSidecar({
    path: "designs/large-source.figma-source.json",
    call: h.call,
    sha256: hash,
  });
  assert.equal(restored.content, content);
});
