import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createDesignSidecarPlan,
  designSidecarPath,
  readDesignSidecar,
  writeDesignSidecar,
  isMissingDesignSidecar,
} from "../../../apps/design-studio/app/design-sidecar.mjs";
const sha256 = async (text) => createHash("sha256").update(text).digest("hex");
test("large Unicode sidecars use checked bounded immutable parts and commit the root last", async () => {
  const content = JSON.stringify({ source: "源设计🌈".repeat(90000) });
  const files = new Map(),
    calls = [];
  const call = async (method, params) => {
    calls.push({ method, ...params });
    if (method.endsWith("readText")) {
      if (!files.has(params.path)) throw Object.assign(Error("missing"), { code: "ENOENT" });
      return { content: files.get(params.path), revision: "root-v1" };
    }
    if (params.expectedModifiedAt === null && files.has(params.path)) throw Error("exists");
    files.set(params.path, params.content);
    return {};
  };
  const path = designSidecarPath("designs/test.codesign.json", ".figma-source.json");
  await writeDesignSidecar({ path, content, expectedModifiedAt: null, call, sha256 });
  assert.equal(calls.at(-1).path, path);
  assert.equal((await readDesignSidecar({ path, call, sha256 })).content, content);
  const manifest = JSON.parse(files.get(path));
  files.set(manifest.parts[0].path, "altered");
  await assert.rejects(readDesignSidecar({ path, call, sha256 }), /校验/);
});
test("unsafe part paths and project changes stop subsequent reads and writes", async () => {
  const plan = await createDesignSidecarPlan("数据".repeat(100000), { sha256 });
  const manifest = JSON.parse(plan.primarySource);
  manifest.parts[0].path = "../secret";
  let calls = 0;
  await assert.rejects(
    readDesignSidecar({
      path: "designs/x.figma-source.json",
      sha256,
      call: async () => {
        calls++;
        return { content: JSON.stringify(manifest) };
      },
    }),
    /路径/,
  );
  assert.equal(calls, 1);
  let active = true;
  calls = 0;
  await assert.rejects(
    writeDesignSidecar({
      path: "designs/x.figma-source.json",
      content: "数据".repeat(100000),
      sha256,
      check() {
        if (!active) throw Error("switched");
      },
      call: async () => {
        calls++;
        active = false;
        return {};
      },
    }),
    /switched/,
  );
  assert.equal(calls, 1);
  assert.throws(() => designSidecarPath("../bad.codesign.json", ".prototype.json"));
});

test("a missing part of an existing sidecar is an integrity failure rather than absent optional data", async () => {
  const plan = await createDesignSidecarPlan("来源".repeat(100000), { sha256 });
  const call = async (_method, params) => {
    if (params.path === "designs/existing.figma-source.json")
      return { content: plan.primarySource };
    throw Object.assign(Error("ENOENT: no such file or directory"), { code: "ENOENT" });
  };
  await assert.rejects(
    readDesignSidecar({ path: "designs/existing.figma-source.json", call, sha256 }),
    (error) => {
      assert.equal(error.code, "SIDECAR_INCOMPLETE");
      assert.equal(isMissingDesignSidecar(error), false);
      return true;
    },
  );
});
