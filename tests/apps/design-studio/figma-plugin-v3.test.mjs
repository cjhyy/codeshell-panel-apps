import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { plainFixture, portableFixture, pixel } from "./fixtures/figma-plugin-v3.mjs";
import {
  preparePluginFile,
  sha256PluginBytes,
} from "../../../apps/design-studio/app/figma-plugin/v3-input.mjs";

const hash = async (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = new URL("../../../", import.meta.url);
const clone = (value) => JSON.parse(JSON.stringify(value));

test("self-contained generated UI adapter matches shared schemas and has no runtime imports or machine paths", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["scripts/build-design-studio-figma-plugin.mjs", "--check"],
    { cwd: root },
  );
  assert.match(stdout, /verified/);
  const ui = await readFile(new URL("apps/design-studio/app/figma-plugin/ui.html", root), "utf8");
  const code = ui
    .split("<!-- BEGIN GENERATED V3 FILE ADAPTER -->")[1]
    .split("<!-- END GENERATED V3 FILE ADAPTER -->")[0]
    .match(/<script>([\s\S]*)<\/script>/u)[1];
  assert.doesNotMatch(code, /\bimport\s*(?:\(|["'{*])|\bfetch\s*\(|\/Users\/|file:\/\//u);
  const sandbox = {
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Uint32Array,
    DataView,
    atob,
    Map,
    Set,
    Blob,
    structuredClone,
  };
  vm.runInNewContext(code, sandbox);
  const prepared = await sandbox.CodeShellFigmaFile.preparePluginFile(
    JSON.stringify(plainFixture()),
  );
  assert.equal(prepared.kind, "document");
  assert.equal(prepared.transfer.pages.length, 2);
  assert.equal(prepared.transfer.pages[0].children[0].children[0].text, "Direct v3");
  const complete = await sandbox.CodeShellFigmaFile.preparePluginFile(
    JSON.stringify(await portableFixture()),
  );
  assert.equal(complete.transfer.assets.photo.base64, pixel);
  assert.equal(complete.summary.attachments, 2);
});
test("SHA-256 fallback matches WebCrypto/Node across padding boundaries and binary UTF8", async () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 511, 1025]) {
    const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 71 + 19) % 256);
    assert.equal(await sha256PluginBytes(bytes, { subtle: null }), await hash(bytes));
    assert.equal(await sha256PluginBytes(bytes), await hash(bytes));
  }
});
test("ordinary v3 becomes all editable pages with geometry, layout and semantic notes intact", async () => {
  const f = plainFixture(),
    result = await preparePluginFile(JSON.stringify(f));
  assert.equal(result.kind, "document");
  assert.deepEqual(result.summary, { pages: 2, nodes: 3, images: 0, fonts: 0, attachments: 0 });
  const card = result.transfer.pages[0].children[0];
  assert.equal(card.layout, "horizontal");
  assert.equal(card.gap, 12);
  assert.equal(card.children[0].x, 46);
  assert.equal(card.children[0].notes, f.pages[0].children[0].children[0].notes);
});
test("full v2 validates images, fonts, comments and prototype locally before producing transfer", async () => {
  const portable = await portableFixture(),
    result = await preparePluginFile(JSON.stringify(portable));
  assert.equal(result.kind, "portable");
  assert.deepEqual(result.summary, { pages: 2, nodes: 4, images: 1, fonts: 1, attachments: 2 });
  assert.equal(result.transfer.assets.photo.base64, pixel);
  assert.equal(result.transfer.pages[1].children[1].imageRef, "photo");
  assert.equal(result.transfer.patch, undefined);
  assert(result.warnings.some((message) => /不能安装字体/u.test(message)));
  assert(result.warnings.some((message) => /不导入 Figma 云评论/u.test(message)));
  const legacy = clone(portable);
  legacy.version = 1;
  delete legacy.attachments;
  delete legacy.coverage;
  delete legacy.counts;
  assert.equal((await preparePluginFile(JSON.stringify(legacy))).kind, "portable");
});
test("ordinary resource references and project indexes require complete files rather than partial success", async () => {
  const portable = await portableFixture();
  await assert.rejects(
    preparePluginFile(JSON.stringify(portable.document)),
    /普通 v3.*完整设计文件/u,
  );
  for (const format of ["codeshell.design.index", "codeshell.design.bundle"])
    await assert.rejects(preparePluginFile(JSON.stringify({ format, version: 3 })), /分片索引/u);
});
test("portable corruption, valid-hash malformed attachments and false image/font MIME block conversion", async () => {
  const original = await portableFixture();
  for (const edit of [
    (value) => value.resources.pop(),
    (value) => value.resources.push(value.resources[0]),
    (value) => (value.resources[0].base64 = Buffer.from("changed").toString("base64")),
    (value) => value.document.resources[0].bytes++,
    (value) => (value.document.resources[0].sha256 = "0".repeat(64)),
    (value) => (value.attachments[0].sha256 = "0".repeat(64)),
    (value) => value.counts.attachments++,
    async (value) => {
      const attachment = value.attachments[1];
      attachment.content = '{"format":"unknown"}';
      attachment.bytes = Buffer.byteLength(attachment.content);
      attachment.sha256 = await hash(attachment.content);
    },
  ]) {
    const value = clone(original);
    await edit(value);
    await assert.rejects(preparePluginFile(JSON.stringify(value)));
  }
  await assert.rejects(
    preparePluginFile(JSON.stringify(await portableFixture({ imageMime: "image/jpeg" }))),
    /MIME/u,
  );
  await assert.rejects(
    preparePluginFile(JSON.stringify(await portableFixture({ fontMime: "font/ttf" }))),
    /MIME/u,
  );
});
test("SVG external references are rejected locally and no payload escapes the canonical complete file", async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://untrusted.test/picture.png"/></svg>';
  const backup = await portableFixture({
    imageMime: "image/svg+xml",
    imageBase64: Buffer.from(svg).toString("base64"),
  });
  await assert.rejects(preparePluginFile(JSON.stringify(backup)), /SVG 图片引用了外部资源/u);
});
test("scope check stops an async hash validation before a converted file can become current", async () => {
  const f = await portableFixture();
  let stale = false;
  await assert.rejects(
    preparePluginFile(JSON.stringify(f), {
      sha256Bytes: async (bytes) => {
        const digest = await hash(bytes);
        stale = true;
        return digest;
      },
      check: () => {
        if (stale) throw Error("new file selected");
      },
    }),
    /new file selected/u,
  );
});

test("complete input above 16 MiB is accepted when the resulting editable-layer transfer fits its separate limit", async () => {
  const bytes = Buffer.alloc(13 * 1024 * 1024, 19);
  bytes.write("wOF2");
  const portable = await portableFixture({ fontBase64: bytes.toString("base64") }),
    text = JSON.stringify(portable);
  assert(Buffer.byteLength(text) > 16 * 1024 * 1024);
  const result = await preparePluginFile(text);
  assert.equal(result.summary.fonts, 1);
  assert(Buffer.byteLength(JSON.stringify(result.transfer)) < 16 * 1024 * 1024);
});
