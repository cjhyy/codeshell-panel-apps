import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalVoiceBridge } from "../apps/video-studio/src/local-voice-bridge.ts";
import type { PanelBridge } from "../apps/video-studio/src/host.ts";

const id = `asset-${"a".repeat(64)}`;
const worker = `
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
export async function runCli(r) {
 if(r.action!=='generate'){console.log(JSON.stringify({type:'result',result:{available:true,state:'ready'}}));return;}
 const dir=join('jobs',r.scopeKey,r.jobId);await mkdir(dir,{recursive:true});
 const reference=await readFile(join(dir,r.referenceFile));if(reference.length!==40001)throw Error('reference transfer');
 console.log(JSON.stringify({type:'progress',progress:{stage:'generating',message:'生成中',fraction:0.4}}));
 if(r.text==='等待'){await new Promise(resolve=>setTimeout(resolve,60000));}
 if(r.text==='出错'){console.log(JSON.stringify({type:'error',message:'测试生成失败'}));process.exitCode=1;return;}
 const b=Buffer.alloc(44+48000*2*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
 await writeFile(join(dir,'output.wav'),b);
 console.log(JSON.stringify({type:'result',result:{file:'output.wav',bytes:b.length,durationSeconds:4,sampleRate:48000,channels:1}}));
}`;

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), "panel-owned-voice-"));
  const events = new Map<string, Set<(data: unknown) => void>>();
  const children = new Map<string, ReturnType<typeof spawn>>();
  const documents = new Map<string, { revision: number; data: any }>();
  const uploads = new Map<string, Buffer[]>();
  const calls: { method: string; params: any; cwd: string }[] = [];
  let cwd = "/project-a",
    serial = 0;
  let failRead = false,
    failSave = false,
    cancelFailures = 0;
  const emit = (name: string, data: unknown) =>
    events.get(name)?.forEach((handler) => handler(data));
  const raw: PanelBridge = {
    getContext: async () => ({ cwd }),
    registerTool: () => () => {},
    on(name, handler) {
      const handlers = events.get(name) ?? new Set();
      handlers.add(handler);
      events.set(name, handlers);
      return () => {
        handlers.delete(handler);
      };
    },
    async call(method, params: any = {}) {
      calls.push({ method, params, cwd });
      if (method === "media.status")
        return { persistent: true, assetRead: { available: true }, tts: { available: true } };
      if (method === "media.tts.voices")
        return {
          available: true,
          models: [{ id: "system", available: true }],
          voices: [],
          defaultModelId: "system",
        };
      if (method === "process.find") return { available: true, handle: "node-handle" };
      if (method === "filesystem.getKnownDirectory") return { handle: "app-data-handle" };
      if (method === "process.spawn") {
        assert.equal(params.executableHandle, "node-handle");
        assert.equal(params.directoryHandle, "app-data-handle");
        assert(params.args.every((arg: string) => arg.length <= 8192));
        assert(Buffer.byteLength(JSON.stringify(params.args)) <= 65536);
        const processId = `process-${++serial}`;
        const child = spawn(process.execPath, params.args, {
          cwd: directory,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        children.set(processId, child);
        child.stdout!.on("data", (data) =>
          emit("process.output", { processId, stream: "stdout", text: data.toString() }),
        );
        child.stderr!.on("data", (data) =>
          emit("process.output", { processId, stream: "stderr", text: data.toString() }),
        );
        child.on("close", (code, signal) => {
          children.delete(processId);
          emit("process.exit", { processId, code, signal });
        });
        // Force real IO process output/exit to race the spawn response.
        await new Promise((resolve) => setTimeout(resolve, 70));
        return { processId };
      }
      if (method === "process.cancel") {
        if (cancelFailures-- > 0) throw new Error("Temporary Host rate limit");
        const child = children.get(params.processId);
        if (child?.pid)
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {}
        return { cancelled: Boolean(child) };
      }
      if (method === "media.document.get") {
        if (failRead) {
          failRead = false;
          throw new Error("Temporary read failure");
        }
        return structuredClone(
          documents.get(`${cwd}:${params.key}`) ?? { revision: 0, data: null },
        );
      }
      if (method === "media.document.set") {
        if (failSave) {
          failSave = false;
          throw new Error("Temporary save failure");
        }
        const key = `${cwd}:${params.key}`,
          prior = documents.get(key);
        assert.equal(params.baseRevision, prior?.revision ?? 0);
        const result = { revision: params.baseRevision + 1, data: structuredClone(params.data) };
        documents.set(key, result);
        return { revision: result.revision };
      }
      if (method === "media.assets.read") {
        assert.equal(cwd, "/project-a");
        assert.equal(params.assetId, id);
        const bytes = Buffer.alloc(40001, 17).subarray(
          params.offset,
          params.offset + params.length,
        );
        return {
          assetId: id,
          offset: params.offset,
          totalBytes: 40001,
          mimeType: "audio/wav",
          dataBase64: bytes.toString("base64"),
          eof: params.offset + bytes.length === 40001,
        };
      }
      if (method === "media.recording.begin") {
        const sessionId = `upload-${++serial}`;
        uploads.set(sessionId, []);
        return { sessionId, maxChunkBytes: 32768 };
      }
      if (method === "media.recording.write") {
        const parts = uploads.get(params.sessionId)!;
        assert.equal(params.sequence, parts.length);
        assert.equal(params.offset, Buffer.concat(parts).length);
        parts.push(Buffer.from(params.dataBase64, "base64"));
        return {};
      }
      if (method === "media.recording.finish") {
        const bytes = Buffer.concat(uploads.get(params.sessionId)!);
        assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
        assert.equal(bytes.length, 384044);
        return {
          asset: {
            id: `asset-${createHash("sha256").update(bytes).digest("hex")}`,
            name: "试听.wav",
            mimeType: "audio/wav",
            bytes: bytes.length,
            createdAt: Date.now(),
          },
          inspection: { kind: "audio", durationSeconds: 4 },
        };
      }
      if (method === "media.recording.cancel") {
        uploads.delete(params.sessionId);
        return {};
      }
      if (method === "media.jobs.list") return { jobs: [] };
      throw new Error(`Unexpected Host method: ${method}`);
    },
  };
  const native = { source: worker, sha256: createHash("sha256").update(worker).digest("hex") };
  let bridge = createLocalVoiceBridge(raw, native);
  t.after(async () => {
    bridge.dispose();
    for (const child of children.values())
      if (child.pid)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
    await rm(directory, { recursive: true, force: true });
  });
  return {
    get bridge() {
      return bridge;
    },
    calls,
    documents,
    directory,
    children,
    failNextRead() {
      failRead = true;
    },
    failNextSave() {
      failSave = true;
    },
    failNextCancel() {
      cancelFailures = 1;
    },
    refreshContext() {
      emit("context.changed", { cwd, busy: true, theme: "dark" });
    },
    switchProject() {
      cwd = "/project-b";
      emit("context.changed", { cwd });
    },
    reload() {
      bridge.dispose();
      bridge = createLocalVoiceBridge(raw, native);
    },
  };
}
async function terminal(bridge: PanelBridge, id: string) {
  for (let i = 0; i < 400; i++) {
    const job = (await bridge.call("media.jobs.get", { id })) as any;
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("job did not settle");
}
const request = {
  modelId: "audio8-tts",
  text: "你好世界",
  referenceAssetId: id,
  referenceText: "这是本人录音",
  rate: 1,
};

test("Panel performs setup and cloning through real generic processes and bounded audio IO", async (t) => {
  const f = await fixture(t);
  const catalog = (await f.bridge.call("media.tts.voices")) as any;
  assert.equal(catalog.defaultModelId, "system");
  assert(catalog.models.find((model: any) => model.id === "audio8-tts").available);
  const setup = (await f.bridge.call("media.tts.setup", { providerId: "audio8-tts" })) as any;
  assert.equal((await terminal(f.bridge, setup.id)).status, "succeeded");
  const job = (await f.bridge.call("media.tts", request)) as any;
  const done = await terminal(f.bridge, job.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done.error));
  assert.equal(done.result.speech.engine, "audio8-tts");
  assert.equal(done.result.inspection.durationSeconds, 4);
  assert(!f.calls.some((call) => ["media.tts", "media.tts.setup"].includes(call.method)));
  assert.equal(f.calls.filter((call) => call.method === "media.assets.read").length, 2);
  assert(
    (await readFile(
      join(f.directory, "tools", `${createHash("sha256").update(worker).digest("hex")}.mjs`),
      "utf8",
    )) === worker,
  );
  f.reload();
  assert.equal(
    ((await f.bridge.call("media.jobs.get", { id: job.id })) as any).result.speech.text,
    request.text,
  );
});

test("generation errors never publish an audio asset and remain retryable", async (t) => {
  const f = await fixture(t),
    job = (await f.bridge.call("media.tts", { ...request, text: "出错" })) as any;
  const done = await terminal(f.bridge, job.id);
  assert.equal(done.status, "failed");
  assert.equal(done.error.message, "测试生成失败");
  assert(!f.calls.some((call) => call.method === "media.recording.begin"));
});

test("project changes cancel native work and prevent writes or publication in the new project", async (t) => {
  const f = await fixture(t),
    job = (await f.bridge.call("media.tts", { ...request, text: "等待" })) as any;
  for (let i = 0; i < 300; i++) {
    const current = (await f.bridge.call("media.jobs.get", { id: job.id })) as any;
    if (current.progress?.stage === "generating") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  f.switchProject();
  await assert.rejects(f.bridge.call("media.jobs.get", { id: job.id }), /当前项目没有/);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert(
    !f.calls.some(
      (call) =>
        call.cwd === "/project-b" &&
        [
          "media.document.set",
          "media.recording.begin",
          "media.recording.finish",
          "media.assets.read",
        ].includes(call.method),
    ),
  );
});

test("restoring interrupted Panel jobs exposes a failed retryable state", async (t) => {
  const f = await fixture(t),
    job = (await f.bridge.call("media.tts", { ...request, text: "等待" })) as any;
  await new Promise((resolve) => setTimeout(resolve, 120));
  f.reload();
  const restored = (await f.bridge.call("media.jobs.get", { id: job.id })) as any;
  assert.equal(restored.status, "failed");
  assert.equal(restored.error.code, "PANEL_CLOSED");
});

test("busy/theme updates keep voice work running; temporary cancel failures are retried until exit", async (t) => {
  const f = await fixture(t),
    job = (await f.bridge.call("media.tts", { ...request, text: "等待" })) as any;
  for (let i = 0; i < 300; i++) {
    const current = (await f.bridge.call("media.jobs.get", { id: job.id })) as any;
    if (current.progress?.stage === "generating") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  f.refreshContext();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(((await f.bridge.call("media.jobs.get", { id: job.id })) as any).status, "running");
  assert(!f.calls.some((call) => call.method === "process.cancel"));
  f.failNextCancel();
  await f.bridge.call("media.jobs.cancel", { id: job.id });
  await assert.rejects(f.bridge.call("media.jobs.retry", { id: job.id }), /正在停止/);
  for (let i = 0; i < 250 && f.children.size; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.children.size, 0);
  assert(f.calls.filter((call) => call.method === "process.cancel").length >= 2);
});

test("temporary store failures recover and failed retry writes roll back the previous job", async (t) => {
  const f = await fixture(t);
  f.failNextRead();
  await assert.rejects(f.bridge.call("media.jobs.list", {}), /Temporary read failure/);
  assert.deepEqual(await f.bridge.call("media.jobs.list", {}), { jobs: [] });
  const job = (await f.bridge.call("media.tts", { ...request, text: "出错" })) as any;
  assert.equal((await terminal(f.bridge, job.id)).status, "failed");
  await new Promise((resolve) => setTimeout(resolve, 120));
  f.failNextSave();
  await assert.rejects(f.bridge.call("media.jobs.retry", { id: job.id }), /Temporary save failure/);
  const after = (await f.bridge.call("media.jobs.get", { id: job.id })) as any;
  assert.equal(after.status, "failed");
  assert.equal(after.attempt, 1);
});

test("archived receipts survive list pruning and concurrent retries execute only once", async (t) => {
  const f = await fixture(t),
    key = "video-studio-local-voice-v1";
  const history = Array.from({ length: 120 }, (_, index) => ({
    input: { action: "setup", engine: "audio8-tts" },
    job: {
      id: `job-panel-${crypto.randomUUID()}`,
      type: "tts-setup",
      status: "failed",
      attempt: 1,
      createdAt: Date.now() - index - 1000,
      updatedAt: Date.now() - index - 1000,
      error: { code: "INTERRUPTED", message: "旧任务", retryable: true },
    },
  }));
  f.documents.set(`/project-a:${key}`, {
    revision: 1,
    data: { schemaVersion: 1, entries: history },
  });
  const recent = (await f.bridge.call("media.tts.setup", { providerId: "audio8-tts" })) as any;
  await terminal(f.bridge, recent.id);
  const old = history.at(-1)!.job.id;
  assert(f.documents.has(`/project-a:${key}-${old}`));
  assert(f.documents.get(`/project-a:${key}`)!.data.entries.length <= 120);
  assert.equal(
    ((await f.bridge.call("media.jobs.get", { id: old })) as any).error.message,
    "旧任务",
  );
  const results = await Promise.allSettled([
    f.bridge.call("media.jobs.retry", { id: old }),
    f.bridge.call("media.jobs.retry", { id: old }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const retried = await terminal(f.bridge, old);
  assert.equal(retried.status, "succeeded");
  assert.equal(retried.attempt, 2);
  assert.equal(
    f.documents.get(`/project-a:${key}`)!.data.entries.filter((entry: any) => entry.job.id === old)
      .length,
    1,
  );
});
