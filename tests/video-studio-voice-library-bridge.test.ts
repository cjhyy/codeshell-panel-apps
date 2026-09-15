import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runVoiceLibrary } from "../apps/video-studio/native/voice-library.ts";
import { createVoiceLibraryBridge } from "../apps/video-studio/src/voice-library-bridge.ts";
import { VOICE_IO, VOICE_LAUNCH } from "../apps/video-studio/src/local-voice-process.ts";
import type { PanelBridge } from "../apps/video-studio/src/host.ts";
import type { LibraryVoiceRecipe } from "../apps/video-studio/src/voice-library.ts";

function wav(value: number) {
  const b = Buffer.alloc(48, value);
  b.write("RIFF");
  b.writeUInt32LE(40, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(4, 40);
  return b;
}
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const audio = (data: Buffer) => ({ sha256: hash(data), bytes: data.length, mimeType: "audio/wav" });
const reference = wav(1),
  sample = wav(2);
const recipe: LibraryVoiceRecipe = {
  id: "voice-first",
  name: "我的声音",
  modelId: "audio8-tts",
  referenceMediaId: `asset-${hash(reference)}`,
  referenceText: "这是参考录音",
  sampleMediaId: `asset-${hash(sample)}`,
  sampleText: "这是试听",
  referenceName: "我的录音.wav",
  referenceDurationSeconds: 4,
};
const saved = (value = recipe) => ({
  schemaVersion: 1,
  recipe: value,
  reference: audio(reference),
  sample: audio(sample),
});
async function nativeFixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), "voice-library-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const call = (input: object, signal = new AbortController().signal) =>
    runVoiceLibrary({ action: "library", ...input }, signal, root) as Promise<any>;
  async function stage(entry = saved()) {
    const token = randomUUID();
    await call({ operation: "begin", token, entry });
    for (const [part, data] of [
      ["reference", reference],
      ["sample", sample],
    ] as const)
      await call({
        operation: "write",
        token,
        part,
        offset: 0,
        dataBase64: data.toString("base64"),
      });
    return token;
  }
  return { root, call, stage };
}

test("library publishes complete sounds atomically and returns stable copies across workspaces", async (t) => {
  const f = await nativeFixture(t);
  const token = await f.stage();
  assert.deepEqual(await f.call({ operation: "list" }), []);
  assert.deepEqual(await f.call({ operation: "commit", token }), recipe);
  assert.deepEqual(await f.call({ operation: "list" }), [recipe]);
  const data = await f.call({ operation: "read", id: recipe.id, part: "reference", offset: 0 });
  assert.deepEqual(Buffer.from(data.dataBase64, "base64"), reference);
  assert.equal(data.eof, true);
});

test("incomplete/corrupt saves and concurrent conflicting saves preserve the original voice", async (t) => {
  const f = await nativeFixture(t);
  await f.call({ operation: "commit", token: await f.stage() });
  const first = await f.stage(saved({ ...recipe, id: "voice-second", name: "第二个" }));
  const second = await f.stage(saved({ ...recipe, id: "voice-second", name: "冲突" }));
  const results = await Promise.allSettled([
    f.call({ operation: "commit", token: first }),
    f.call({ operation: "commit", token: second }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const corrupted = await f.stage({
    ...saved({ ...recipe, id: "broken" }),
    reference: { ...audio(reference), sha256: "0".repeat(64) },
  });
  await assert.rejects(f.call({ operation: "commit", token: corrupted }), /校验/);
  const list = await f.call({ operation: "list" });
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.find((item: any) => item.id === recipe.id),
    recipe,
  );
});

test("library rejects traversal tokens, symbolic-link blobs and cancelled commits", async (t) => {
  const f = await nativeFixture(t);
  await assert.rejects(f.call({ operation: "cancel", token: "../../outside" }), /无效/);
  const token = await f.stage();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.call({ operation: "commit", token }, controller.signal));
  assert.deepEqual(await f.call({ operation: "list" }), []);
  await f.call({ operation: "commit", token });
  const blob = join(f.root, "voices", "blobs", hash(reference));
  const outside = join(f.root, "private.wav");
  await writeFile(outside, reference);
  await rm(blob);
  await symlink(outside, blob);
  await assert.rejects(f.call({ operation: "read", id: recipe.id, part: "reference", offset: 0 }));
  assert.deepEqual(await readFile(outside), reference);
});

async function bridgeFixture(t: any, resources = false) {
  const f = await nativeFixture(t);
  let cwd = "/workspace-a",
    serial = 0,
    switchOnRead = false,
    failedWrite = false,
    visibilityEvents = false;
  const events = new Map<string, Set<(value: unknown) => void>>();
  const uploads = new Map<string, { cwd: string; chunks: Buffer[]; sequence: number }>();
  const scopes = new Map<string, Map<string, Buffer>>([
    [
      cwd,
      new Map([
        [recipe.referenceMediaId, reference],
        [recipe.sampleMediaId, sample],
      ]),
    ],
  ]);
  const calls: { method: string; cwd: string; params: any }[] = [];
  const emit = (name: string, value: unknown) => events.get(name)?.forEach((fn) => fn(value));
  const panel: PanelBridge = {
    async getContext() {
      return {
        cwd,
        availableMethods: resources
          ? ["begin", "write", "finish", "cancel"].map((part) => `resources.upload.${part}`)
          : [],
      };
    },
    registerTool() {
      return () => {};
    },
    on(name, fn) {
      const handlers = events.get(name) ?? new Set();
      handlers.add(fn);
      events.set(name, handlers);
      return () => {
        handlers.delete(fn);
      };
    },
    async call(method, params: any = {}) {
      calls.push({ method, cwd, params });
      if (visibilityEvents)
        emit("context.changed", { cwd, visible: serial % 2 === 0, theme: "dark", busy: true });
      if (method === "process.find") return { available: true, handle: "node" };
      if (method === "filesystem.getKnownDirectory") {
        assert.equal(params.name, "app-data");
        return { handle: "app-data" };
      }
      if (method === "process.spawn") {
        const processId = `proc-${++serial}`;
        const code = params.args[2];
        const operation =
          code === VOICE_IO
            ? Promise.resolve({ valid: true })
            : (async () => {
                assert.equal(code, VOICE_LAUNCH);
                return f.call(JSON.parse(params.args.slice(4).join("")));
              })();
        void operation.then(
          (value) => {
            emit("process.output", {
              processId,
              stream: "stdout",
              text:
                JSON.stringify(code === VOICE_IO ? value : { type: "result", result: value }) +
                "\n",
            });
            emit("process.exit", { processId, code: 0 });
          },
          () => {
            emit("process.output", {
              processId,
              stream: "stdout",
              text: JSON.stringify({ type: "error", message: "test error" }) + "\n",
            });
            emit("process.exit", { processId, code: 1 });
          },
        );
        return { processId };
      }
      if (method === "process.cancel") return { cancelled: true };
      if (method === "media.assets.get") {
        const data = scopes.get(cwd)?.get(params.id);
        assert.ok(data, "asset must belong to current workspace");
        return { asset: { id: params.id, ...audio(data) } };
      }
      if (method === "media.assets.read") {
        const data = scopes.get(cwd)?.get(params.assetId);
        assert.ok(data);
        const chunk = data.subarray(params.offset, params.offset + params.length);
        if (switchOnRead) {
          cwd = "/workspace-b";
          switchOnRead = false;
        }
        return {
          assetId: params.assetId,
          offset: params.offset,
          totalBytes: data.length,
          mimeType: "audio/wav",
          dataBase64: chunk.toString("base64"),
          eof: params.offset + chunk.length === data.length,
        };
      }
      const upload = /^(media\.recording|resources\.upload)\.(begin|write|finish|cancel)$/.exec(
        method,
      );
      if (upload) {
        if (upload[2] === "begin") {
          const sessionId = `upload-${++serial}`;
          uploads.set(sessionId, { cwd, chunks: [], sequence: 0 });
          return { sessionId, maxChunkBytes: 32768 };
        }
        const record = uploads.get(params.sessionId);
        assert.ok(record);
        assert.equal(record.cwd, cwd);
        if (upload[2] === "cancel") {
          uploads.delete(params.sessionId);
          return { cancelled: true };
        }
        if (upload[2] === "write") {
          if (failedWrite) throw new Error("write failed");
          assert.equal(record.sequence++, params.sequence);
          const offset = record.chunks.reduce((sum, part) => sum + part.length, 0);
          assert.equal(params.offset, offset);
          const data = Buffer.from(params.dataBase64, "base64");
          record.chunks.push(data);
          return {
            sessionId: params.sessionId,
            receivedBytes: offset + data.length,
            nextSequence: record.sequence,
          };
        }
        const data = Buffer.concat(record.chunks),
          id = `asset-${hash(data)}`;
        const assets = scopes.get(cwd) ?? new Map();
        assets.set(id, data);
        scopes.set(cwd, assets);
        uploads.delete(params.sessionId);
        return { asset: { id, ...audio(data) }, inspection: { durationSeconds: 4 } };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  const progress: number[] = [];
  const bridge = createVoiceLibraryBridge(
    panel,
    { source: "unused fixture", sha256: "a".repeat(64) },
    { onProgress: (value) => progress.push(value.fraction) },
  );
  t.after(() => bridge.dispose());
  return {
    ...f,
    bridge,
    calls,
    scopes,
    uploads,
    progress,
    setWorkspace(value: string) {
      cwd = value;
    },
    switchOnRead() {
      switchOnRead = true;
    },
    failWrite() {
      failedWrite = true;
    },
    visibilityEvents() {
      visibilityEvents = true;
    },
  };
}

for (const resources of [false, true])
  test(`bridge re-registers selected library audio in another workspace (${resources ? "resources" : "legacy media"})`, async (t) => {
    const f = await bridgeFixture(t, resources);
    assert.deepEqual(await f.bridge.saveVoice(recipe), recipe);
    f.setWorkspace("/workspace-b");
    assert.deepEqual(await f.bridge.listVoices(), [recipe]);
    const result = await f.bridge.importVoice(recipe.id);
    assert.deepEqual(result, {
      referenceMediaId: recipe.referenceMediaId,
      sampleMediaId: recipe.sampleMediaId,
      durationSeconds: 4,
    });
    assert.deepEqual(f.scopes.get("/workspace-b")?.get(recipe.referenceMediaId), reference);
    assert.equal(
      f.calls.filter((call) => call.method === "media.assets.read" && call.cwd === "/workspace-b")
        .length,
      0,
    );
    assert.equal(f.uploads.size, 0);
    assert.ok(f.progress.includes(1));
  });

test("switching workspace during save publishes no voice and cancels only its own staging session", async (t) => {
  const f = await bridgeFixture(t);
  f.switchOnRead();
  await assert.rejects(f.bridge.saveVoice(recipe), { name: "AbortError" });
  assert.deepEqual(await f.bridge.listVoices(), []);
  assert.deepEqual(await readdir(join(f.root, "voices", "staging")), []);
});

test("failed import cancels the scoped upload and keeps the shared voice intact", async (t) => {
  const f = await bridgeFixture(t);
  await f.bridge.saveVoice(recipe);
  f.setWorkspace("/workspace-b");
  f.failWrite();
  await assert.rejects(f.bridge.importVoice(recipe.id), /write failed/);
  assert.equal(f.uploads.size, 0);
  assert.deepEqual(await f.bridge.listVoices(), [recipe]);
});

test("same-workspace visibility, theme and busy events do not cancel saving a voice", async (t) => {
  const f = await bridgeFixture(t);
  f.visibilityEvents();
  assert.deepEqual(await f.bridge.saveVoice(recipe), recipe);
  assert.deepEqual(await f.bridge.listVoices(), [recipe]);
});

test("corrupted library bytes are rejected before publishing an imported asset", async (t) => {
  const f = await bridgeFixture(t);
  await f.bridge.saveVoice(recipe);
  await writeFile(join(f.root, "voices", "blobs", hash(reference)), wav(9));
  f.setWorkspace("/workspace-b");
  await assert.rejects(f.bridge.importVoice(recipe.id), /校验失败/);
  assert.equal(f.uploads.size, 0);
  assert.equal(f.scopes.get("/workspace-b"), undefined);
  assert.deepEqual(await f.bridge.listVoices(), [recipe]);
});
