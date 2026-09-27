import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createInterviewAudioTasks,
  prepareInterviewAudio,
  interviewTranscript,
  audioConnections,
} from "../../../apps/job-hunt-hq/app/interview-audio-tasks.mjs";
import { transcriptAnswer } from "../../../apps/job-hunt-hq/app/interview-audio-ui.mjs";
const asset = {
  id: `asset-${"a".repeat(64)}`,
  name: "recording.webm",
  mimeType: "audio/webm",
  bytes: 100,
};
const connection = { id: "audio-1", fingerprint: "b".repeat(32) };
const input = {
  asset,
  connection,
  questionId: "question-1",
  practiceSessionId: "practice-1",
  answer: "已有回答",
};
function fixture() {
  const calls = [],
    jobs = new Map(),
    state = { active: true, lose: false, reject: false, onCall: null };
  const options = {
    check() {
      if (!state.active) throw Error("project changed");
    },
    call: async (method, params) => {
      calls.push({ method, params });
      await state.onCall?.(method);
      if (method === "resources.get") return { asset };
      if (method === "tasks.find")
        return [...jobs.values()].find((job) => job.requestKey === params.requestKey) || null;
      if (method === "tasks.start") {
        if (state.reject) throw Error("connection lost");
        const job = {
          ...structuredClone(params),
          id: `task-${jobs.size}`,
          entry: { name: params.entry },
          status: "queued",
        };
        jobs.set(job.id, job);
        if (state.lose) throw Error("reply lost");
        return job;
      }
      if (method === "tasks.get") return structuredClone(jobs.get(params.id));
      if (method === "tasks.list")
        return [...jobs.values()].map(({ input, result, ...summary }) => summary);
      if (method === "tasks.cancel") {
        jobs.get(params.id).status = "cancelled";
        return {};
      }
      throw Error(method);
    },
  };
  return { options, calls, jobs, state, tasks: createInterviewAudioTasks(options) };
}
test("durable request binds the original answer, recording and selected connection without source text or secrets", async () => {
  const a = await prepareInterviewAudio(input),
    b = await prepareInterviewAudio(input);
  assert.equal(a.requestKey, b.requestKey);
  assert.equal(a.recovery, "manual");
  assert.deepEqual(a.input.resources, [{ assetId: asset.id, path: "inputs/recording.bin" }]);
  assert.deepEqual(a.input.connectionIds, [connection.id]);
  assert.equal(JSON.stringify(a).includes(input.answer), false);
  assert.notEqual(
    a.requestKey,
    (await prepareInterviewAudio({ ...input, answer: "新回答" })).requestKey,
  );
  assert.notEqual(
    a.requestKey,
    (await prepareInterviewAudio({ ...input, nonce: "explicit-retry" })).requestKey,
  );
});
test("lost start reply, repeated clicks and reopening use the same accepted task", async () => {
  const f = fixture();
  f.state.lose = true;
  const request = await prepareInterviewAudio(input);
  const [a, b] = await Promise.all([f.tasks.submit(request), f.tasks.submit(request)]);
  assert.equal(a.id, b.id);
  assert.equal((await createInterviewAudioTasks(f.options).submit(request)).id, a.id);
  assert.equal(f.calls.filter((c) => c.method === "tasks.start").length, 1);
  assert.equal((await f.tasks.cancel(a.id)).status, "cancelled");
  assert.equal((await f.tasks.list()).jobs[0].status, "cancelled");
  assert.equal(
    f.calls.some((c) => c.method === "tasks.retry"),
    false,
  );
});
test("uncertain start with no known receipt and project switch never automatically resubmit", async () => {
  const f = fixture();
  f.state.reject = true;
  await assert.rejects(f.tasks.submit(await prepareInterviewAudio(input)), /connection lost/);
  assert.equal(f.calls.filter((c) => c.method === "tasks.start").length, 1);
  const other = fixture();
  other.state.onCall = (method) => {
    if (method === "resources.get") other.state.active = false;
  };
  await assert.rejects(other.tasks.submit(await prepareInterviewAudio(input)), /project changed/);
  assert.equal(
    other.calls.some((c) => c.method === "tasks.start"),
    false,
  );
});
test("completed text can only join the unchanged question/session/answer; repeated application and forged receipts fail", async () => {
  const f = fixture(),
    job = await f.tasks.submit(await prepareInterviewAudio(input));
  job.status = "succeeded";
  job.result = {
    result: {
      text: "这是转写结果",
      assetId: asset.id,
      source: job.input.request.source,
      connection,
    },
  };
  const current = {
    questionId: input.questionId,
    practiceSessionId: input.practiceSessionId,
    answer: input.answer,
  };
  assert.equal(await transcriptAnswer(job, current), "已有回答\n这是转写结果");
  for (const change of [
    { questionId: "other" },
    { practiceSessionId: "other" },
    { answer: "新输入" },
    { answer: "已有回答\n这是转写结果" },
  ])
    await assert.rejects(transcriptAnswer(job, { ...current, ...change }), /已经变化/);
  const forged = structuredClone(job);
  forged.result.result.assetId = `asset-${"c".repeat(64)}`;
  assert.throws(() => interviewTranscript(forged), /回执不完整/);
});
test("connection choices expose only compatible configured audio metadata", () => {
  const valid = {
    ...connection,
    model: "whisper-fixture",
    providerName: "Fixture",
    tag: "audio",
    entry: { tag: "audio" },
    adapterKind: "openai",
    hasCredentials: true,
    apiKey: "never-public",
  };
  const choices = audioConnections({
    connections: [
      valid,
      { ...valid, id: "speech", tag: "speech" },
      { ...valid, id: "missing", hasCredentials: false },
    ],
  });
  assert.equal(choices.length, 1);
  assert.equal(JSON.stringify(choices).includes("never-public"), false);
});
