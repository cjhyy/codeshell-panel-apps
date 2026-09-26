import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createPortableDesign, planPortableDesign, restorePortableDesign } from "../../../apps/design-studio/app/portable-backup.mjs";
import { parseDesignIndexSource, resolveDesignIndexPages } from "../../../apps/design-studio/app/document-index.mjs";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createDesignResourcePersistencePlan } from "../../../apps/design-studio/app/resource-store.mjs";
const hash = async value => createHash("sha256").update(value).digest("hex");
const options = { sha256: hash, sha256Bytes: hash };
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
async function fixture() {
  const image = await createDesignResourcePersistencePlan({ id: "pixel", kind: "image", mime: "image/png", base64: pixel, sha256Bytes: hash });
  const font = await createDesignResourcePersistencePlan({ id: "font", kind: "font", mime: "font/woff2", family: "Fixture", base64: Buffer.from("font fixture bytes").toString("base64"), sha256Bytes: hash });
  const files = new Map([...image.parts, ...font.parts].map(p => [p.path, p.content]));
  const document = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "Two pages", canvas: { width: 800, height: 600, background: "#ffffff" }, tokens: { colors: [] }, activePageId: "page-1", resources: [image.descriptor, font.descriptor], pages: [{ id: "page-1", name: "One", children: [] }, { id: "page-2", name: "Two", children: [] }] });
  const source = { workspaceRoot: "/workspace", sessionId: "source-project", path: "designs/source.codesign.json" };
  const text = await createPortableDesign({ document, source, readText: async path => files.get(path), sha256Bytes: hash });
  return { text, files, document, source };
}
function host(files, hook = () => {}) {
  const calls = [];
  return { calls, call: async (method, params) => {
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
  } };
}
test("complete backup restores every page, image and font into an independent project", async () => {
  const f = await fixture(), plan = await planPortableDesign(f.text, options), target = new Map(), h = host(target);
  assert.equal(plan.pageCount, 2); assert.equal(plan.resourceCount, 2);
  await restorePortableDesign({ plan, path: "designs/restored.codesign.json", call: h.call, check() {} });
  for (const [path, content] of f.files) assert.equal(target.get(path), content);
  assert.equal(JSON.parse(target.get("designs/restored.codesign.json")).pages.length, 2);
  assert.equal(h.calls.at(-1).path, "designs/restored.codesign.json");
});
test("invalid, missing, duplicate and altered resources are rejected before restoration", async () => {
  const { text } = await fixture();
  for (const change of [v => v.resources.pop(), v => v.resources[0].base64 = "AA==", v => v.resources[1].id = v.resources[0].id, v => v.resources[0].path = "../outside", v => v.version = 2]) {
    const value = JSON.parse(text); change(value);
    await assert.rejects(planPortableDesign(JSON.stringify(value), options));
  }
  await assert.rejects(planPortableDesign('{"format":"codeshell.design.recovery-backup","version":1}', options));
});
test("failed part writes never commit a primary document; retry reuses only identical parts", async () => {
  const { text } = await fixture(), plan = await planPortableDesign(text, options), files = new Map();
  let fail = true;
  const h = host(files, part => { if (part.path === plan.parts[1].path && fail) throw Error("disk full"); });
  const request = { plan, path: "designs/retry.codesign.json", call: h.call, check() {} };
  await assert.rejects(restorePortableDesign(request), /disk full/);
  assert.equal(files.has(request.path), false);
  fail = false; await restorePortableDesign(request);
  assert.equal(files.has(request.path), true);
  files.set(request.path, "keep original");
  await assert.rejects(restorePortableDesign(request), /冲突/);
  assert.equal(files.get(request.path), "keep original");
});
test("a lost write receipt is checked without sending a duplicate write", async () => {
  const { text } = await fixture(), plan = await planPortableDesign(text, options), files = new Map(), h = host(files);
  const call = async (method, params) => {
    const result = await h.call(method, params);
    if (method === "workspace.writeText") throw Error("lost acknowledgement");
    return result;
  };
  await restorePortableDesign({ plan, path: "designs/lost.codesign.json", call, check() {} });
  assert.equal(h.calls.filter(c => c.method === "workspace.writeText").length, plan.parts.length + 1);
});
test("switching project after a write prevents subsequent reads and writes; invalid targets never write", async () => {
  const { text } = await fixture(), plan = await planPortableDesign(text, options), calls = [];
  let active = true;
  await assert.rejects(restorePortableDesign({ plan, path: "designs/copy.codesign.json", check() { if (!active) throw Error("project changed"); }, call: async (method, params) => { calls.push({ method, ...params }); active = false; throw Error("old response"); } }), /project changed/);
  assert.equal(calls.length, 1);
  await assert.rejects(restorePortableDesign({ plan, path: "../outside.codesign.json", call: async () => assert.fail(), check() {} }));
});


test("large complete backups restore indexed page parts with verified content", async () => {
  const f = await fixture(), raw = JSON.parse(f.text);
  raw.document.pages[0].children = Array.from({ length: 1000 }, (_, i) => ({
    id: `rect-${i}`, type: "rectangle", name: `Rectangle ${i}`, x: 0, y: 0,
    width: 10, height: 10, fill: "#ffffff", stroke: "transparent", strokeWidth: 0,
    opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false,
    notes: "设计备份内容".repeat(60),
  }));
  const plan = await planPortableDesign(JSON.stringify(raw), options);
  const manifest = parseDesignIndexSource(plan.primarySource);
  assert.ok(manifest, "large designs must use the indexed persistence path");
  const files = new Map(), h = host(files);
  await restorePortableDesign({ plan, path: "designs/large.codesign.json", call: h.call, check() {} });
  const pages = await resolveDesignIndexPages({ manifest, pageIds: manifest.pages.map(p => p.id),
    readText: async path => files.get(path), sha256: hash });
  assert.equal(pages.get("page-1").children.length, 1000);
  assert.equal(pages.get("page-1").children[999].notes, raw.document.pages[0].children[999].notes);
  assert.equal(pages.get("page-2").children.length, 0);
});
