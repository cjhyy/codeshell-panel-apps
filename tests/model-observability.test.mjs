import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const observer = pathToFileURL(join(root, "shared/model-observability.mjs")).href;
const request = `{provider:"fixture-provider",model:"fixture-model",purpose:"fixture-call",input:{messages:[{role:"user",content:"Actual prompt"}],parameters:{temperature:0.2}}}`;
async function execute(source, { fd = "3", bundle = false, extraEnv = {}, siblings = 1 } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), "panel-model-observation-"));
  try {
    const path = join(temporary, "fixture.mjs");
    if (bundle)
      await build({
        stdin: { contents: source, resolveDir: root },
        outfile: path,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node20",
        logLevel: "silent",
      });
    else await writeFile(path, source);
    const child = spawn(
      siblings === 1 ? process.execPath : "/bin/bash",
      siblings === 1
        ? [path]
        : [
            "-c",
            'for ((i=1;i<=$3;i++)); do "$1" "$2" "$i" & done; wait',
            "fixture",
            process.execPath,
            path,
            String(siblings),
          ],
      {
        stdio: ["ignore", "pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          ...extraEnv,
          ...(fd == null ? {} : { CODESHELL_MODEL_TRACE_FD: fd }),
        },
      },
    );
    let stdout = "",
      stderr = "",
      observation = "";
    child.stdout.setEncoding("utf8").on("data", (part) => (stdout += part));
    child.stderr.setEncoding("utf8").on("data", (part) => (stderr += part));
    child.stdio[3].setEncoding("utf8").on("data", (part) => (observation += part));
    const status = await new Promise((done, reject) => {
      child.on("error", reject);
      child.on("close", done);
    });
    assert.equal(status, 0, stderr);
    const messages = [];
    const partials = new Map();
    for (const line of observation.trim() ? observation.trim().split("\n") : []) {
      assert.ok(Buffer.byteLength(line) + 1 <= 512);
      const frame = JSON.parse(line);
      if (frame.type !== "model_trace_chunk") {
        messages.push(frame);
        continue;
      }
      const chunks = partials.get(frame.messageId) ?? [];
      assert.equal(frame.part, chunks.length);
      const bytes = Buffer.from(frame.data, "base64");
      assert.equal(bytes.toString("base64"), frame.data);
      chunks.push(bytes);
      if (frame.final) {
        messages.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        partials.delete(frame.messageId);
      } else partials.set(frame.messageId, chunks);
    }
    assert.equal(partials.size, 0);
    return {
      stdout,
      wire: observation,
      observation: messages.map((message) => JSON.stringify(message)).join("\n"),
      frames: messages,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

test("standalone inference never inspects observation data or changes stdout", async () => {
  for (const fd of [null, "", "4", "03"]) {
    const result = await execute(
      `
      import {observeModelCall} from ${JSON.stringify(observer)};
      let calls=0; const value={text:"result"};
      const returned=await observeModelCall({get input(){throw new Error("must not inspect");}},async()=>{calls++;return value;});
      if(returned!==value||calls!==1)throw new Error("changed operation");
      process.stdout.write(JSON.stringify({type:"result",result:value})+"\\n");
    `,
      { fd },
    );
    assert.equal(result.stdout, '{"type":"result","result":{"text":"result"}}\n');
    assert.equal(result.observation, "");
  }
});

test("start/finish use one opaque call id and preserve actual input, result identity and stdout", async () => {
  const result = await execute(`
    import {observeModelCall} from ${JSON.stringify(observer)};
    const value={sampleRate:48000,bytes:200};let calls=0;
    const returned=await observeModelCall(${request},async()=>{calls++;return value;},{output:v=>({data:v})});
    if(returned!==value||calls!==1)throw new Error("changed operation");
    process.stdout.write("normal tool output\\n");
  `);
  assert.equal(result.stdout, "normal tool output\n");
  assert.equal(result.frames.length, 2);
  const [start, finish] = result.frames;
  assert.match(start.callId, /^[a-f0-9-]{36}$/);
  assert.equal(finish.callId, start.callId);
  assert.deepEqual(start, {
    version: 1,
    type: "model_trace",
    phase: "start",
    callId: start.callId,
    provider: "fixture-provider",
    model: "fixture-model",
    purpose: "fixture-call",
    stream: false,
    input: {
      systemPrompt: "",
      messages: [{ role: "user", content: "Actual prompt" }],
      tools: [],
      parameters: { temperature: 0.2 },
    },
  });
  assert.deepEqual(finish.output.data, { sampleRate: 48000, bytes: 200 });
  assert.equal(finish.status, "completed");
  assert.equal("workspacePath" in start || "storageDir" in start || "startedAt" in start, false);
});

test("failure/cancellation close exactly once, preserve original error and never replay inference", async () => {
  const result = await execute(`
    import {observeModelCall} from ${JSON.stringify(observer)};
    let calls=0;
    for(const cancelled of [false,true]){
      const controller=new AbortController();const error=new Error("synthetic-private-key /private/provider");
      try{await observeModelCall(${request},async()=>{calls++;if(cancelled)controller.abort();throw error;},{signal:controller.signal});throw new Error("missing error");}
      catch(actual){if(actual!==error)throw new Error("changed error");}
    }
    if(calls!==2)throw new Error("replayed inference");
  `);
  assert.deepEqual(result.frames.map((frame) => frame.status).filter(Boolean), [
    "failed",
    "cancelled",
  ]);
  assert.equal(result.frames.length, 4);
  assert.doesNotMatch(result.observation, /synthetic-private-key|\/private\/provider/);
});

test("observation bounds content explicitly and excludes credentials and media bytes", async () => {
  const result = await execute(`
    import {observeModelCall} from ${JSON.stringify(observer)};
    const request=${request};
    request.input.messages[0].content="长".repeat(150000);
    request.input.parameters={Authorization:"Bearer fake-key",api_key:"synthetic-private-key",nested:{access_token:"private-token"},audioBytes:Buffer.from("private-audio"),image:"data:image/png;base64,cHJpdmF0ZQ=="};
    await observeModelCall(request,async()=>({text:"response"}),{output:()=>({text:"回".repeat(150000),data:{secret:"private-output"}})});
  `);
  for (const line of result.observation.trim().split("\n"))
    assert.ok(Buffer.byteLength(line) + 1 <= 256 * 1024);
  assert.equal(result.frames[0].inputState, "truncated");
  assert.equal(result.frames[1].outputState, "truncated");
  assert.match(result.observation, /truncated|binary content omitted/);
  assert.doesNotMatch(
    result.observation,
    /synthetic-private-key|private-token|private-audio|cHJpdmF0ZQ|private-output|fake-key/,
  );
});

test("a closed extra pipe cannot change a provider success", async () => {
  const result = await execute(`
    import {observeModelCall} from ${JSON.stringify(observer)};
    import {closeSync} from "node:fs";
    closeSync(3);const value={text:"still returned"};
    const actual=await observeModelCall(${request},async()=>value);
    if(actual!==value)throw new Error("changed return");
    process.stdout.write(value.text);
  `);
  assert.equal(result.stdout, "still returned");
  assert.equal(result.frames.length, 0);
});

test("large escaped fields and concurrent calls stay bounded and do not interleave protocol frames", async () => {
  const result = await execute(`
    import {observeModelCall} from ${JSON.stringify(observer)};
    const request=${request};request.input.messages=Array.from({length:200},()=>({role:"user",content:"\\0".repeat(16000)}));
    await Promise.all(Array.from({length:8},(_,index)=>observeModelCall(request,async()=>index,{output:value=>({text:String(value)})})));
  `);
  assert.equal(result.frames.length, 16);
  for (const line of result.observation.trim().split("\n"))
    assert.ok(Buffer.byteLength(line) + 1 <= 256 * 1024);
  const starts = result.frames.filter((frame) => frame.phase === "start");
  assert.equal(new Set(starts.map((frame) => frame.callId)).size, 8);
  assert.ok(starts.every((frame) => frame.inputState === "truncated"));
  for (const start of starts)
    assert.equal(
      result.frames.filter((frame) => frame.callId === start.callId && frame.phase === "finish")
        .length,
      1,
    );
});

test("sibling native CLIs sharing a Bash descriptor preserve every large prompt and leave stdout unchanged", async () => {
  const result = await execute(
    `
    import {observeModelCall} from ${JSON.stringify(observer)};
    const index=process.argv[2];
    for(let call=0;call<4;call++)await observeModelCall({provider:"fixture",model:"fixture",purpose:"sibling-call",input:{messages:Array.from({length:6},(_,part)=>({role:"user",content:index+":"+call+":"+part+":"+"x".repeat(15000)})),parameters:{}}},async()=>index+":"+call,{output:text=>({text})});
    process.stdout.write("ordinary-output-"+index+"\\n");
  `,
    { siblings: 16 },
  );
  assert.equal(result.frames.length, 128);
  const starts = result.frames.filter((frame) => frame.phase === "start");
  const finishes = result.frames.filter((frame) => frame.phase === "finish");
  assert.equal(starts.length, 64);
  assert.equal(finishes.length, 64);
  for (const finish of finishes) {
    const start = starts.find((frame) => frame.callId === finish.callId);
    assert.ok(start);
    assert.equal(start.input.messages[0].content, finish.output.text + ":0:" + "x".repeat(15000));
    assert.equal(finish.status, "completed");
  }
  assert.deepEqual(
    result.stdout.trim().split("\n").sort(),
    Array.from({ length: 16 }, (_, index) => "ordinary-output-" + (index + 1)).sort(),
  );
  assert.ok(result.wire.includes('"type":"model_trace_chunk"'));
});

test("installable Job Hunt observer matches the shared implementation", async () => {
  assert.deepEqual(
    await readFile(join(root, "apps/job-hunt-hq/app/model-observability.mjs")),
    await readFile(join(root, "shared/model-observability.mjs")),
  );
  const manifest = JSON.parse(
    await readFile(join(root, "apps/job-hunt-hq/.codeshell-panel/panel.json"), "utf8"),
  );
  assert.equal(
    manifest.nativeEntries["interview-transcribe"].sha256,
    createHash("sha256")
      .update(await readFile(join(root, "apps/job-hunt-hq/app/tools/interview-transcribe.mjs")))
      .digest("hex"),
  );
});

test("OpenAI-compatible speech traces the exact submitted JSON and audio metadata, excluding keys/bytes", async () => {
  const result = await execute(
    `
    import {generateOpenAiTts} from "./apps/video-studio/native/media/media-tts-openai.ts";
    import {mkdtemp,mkdir,writeFile,chmod,rm} from "node:fs/promises";
    import {join} from "node:path";import {tmpdir} from "node:os";
    const root=await mkdtemp(join(tmpdir(),"panel-speech-trace-"));
    try{
      const probe=join(root,"probe"),encode=join(root,"encode");
      await writeFile(probe,'#!/usr/bin/env node\\nconsole.log(JSON.stringify({format:{duration:"1"},streams:[{codec_type:"audio",codec_name:"pcm_s16le",sample_rate:"48000",channels:1}]}));');
      await writeFile(encode,'#!/usr/bin/env node\\nrequire("node:fs").copyFileSync(process.argv[process.argv.indexOf("-i")+1],process.argv.at(-1));');
      await chmod(probe,0o700);await chmod(encode,0o700);
      const workDir=join(root,"work"),outputDir=join(root,"output");await mkdir(workDir);await mkdir(outputDir);
      const bytes=Buffer.alloc(144,11);bytes.write("RIFF",0);bytes.write("WAVE",8);
      let submitted,calls=0;
      const value=await generateOpenAiTts({text:"  实际配音文稿  ",model:"speech-fixture",voiceId:"voice-1",rate:1.2,instructions:" 温和自然 "},{signal:new AbortController().signal,workDir,outputDir,reportProgress:async()=>{}},{baseUrl:"https://fixture.invalid/v1",apiKey:"synthetic-private-key",ffmpegPath:encode,ffprobePath:probe,fetchImpl:async(url,options)=>{calls++;submitted=JSON.parse(options.body);if(options.headers.Authorization!=="Bearer synthetic-private-key")throw new Error("changed authorization");return new Response(bytes,{headers:{"content-type":"audio/wav"}});}});
      if(calls!==1||value.durationSeconds!==1)throw new Error("invalid result");
      process.stdout.write(JSON.stringify({submitted,result:{mimeType:value.mimeType,durationSeconds:value.durationSeconds}}));
    }finally{await rm(root,{recursive:true,force:true});}
  `,
    { bundle: true },
  );
  assert.equal(result.frames.length, 2);
  assert.deepEqual(result.frames[0].input.parameters.request, JSON.parse(result.stdout).submitted);
  assert.equal(result.frames[0].input.messages[0].content, "实际配音文稿");
  assert.deepEqual(result.frames[1].output.data, {
    mimeType: "audio/wav",
    durationSeconds: 1,
    sampleRate: 48000,
    channels: 1,
    codec: "pcm_s16le",
    bytes: 144,
    binaryContent: "omitted",
  });
  assert.doesNotMatch(
    result.observation,
    /synthetic-private-key|fixture\.invalid|speech-response-|\/tmp\/|\/work\//,
  );
});

test("multipart transcription traces actual fields and returned text once; retained receipt makes no new trace", async () => {
  const result = await execute(
    `
    import {transcribeInterview} from ${JSON.stringify(pathToFileURL(join(root, "apps/job-hunt-hq/app/tools/interview-transcribe.mjs")).href)};
    import {createHash} from "node:crypto";import {mkdtemp,writeFile,mkdir,rm} from "node:fs/promises";
    import {join} from "node:path";import {tmpdir} from "node:os";
    const root=await mkdtemp(join(tmpdir(),"panel-transcribe-trace-"));const hash=v=>createHash("sha256").update(v).digest("hex");
    try{
      const bytes=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.alloc(100,11)]),audioPath=join(root,"input.webm"),directory=join(root,"job");
      await writeFile(audioPath,bytes);await mkdir(directory);
      const connection={id:"selected-audio",catalogId:"audio-fixture",tag:"audio",entry:{tag:"audio"},adapterKind:"openai",baseUrl:"https://fixture.invalid/v1",model:"transcribe-fixture",apiKey:"synthetic-private-key",hasCredentials:true};
      const request={action:"interview-transcribe",assetId:"asset-"+hash(bytes),mimeType:"audio/webm",language:"zh",connection:{id:connection.id,fingerprint:hash(JSON.stringify([connection.id,connection.catalogId,connection.model,connection.baseUrl])).slice(0,32)},source:{questionId:"q1",practiceSessionId:"s1",answerHash:hash("answer")}};
      let calls=0;const options={audioPath,directory,connections:{connections:[connection]},fetchImpl:async(url,options)=>{calls++;if(options.body.get("model")!==connection.model||options.body.get("language")!=="zh"||options.body.get("file").size!==bytes.length)throw new Error("changed request");return new Response(JSON.stringify({text:"实际模型转写回答"}));}};
      const result=await transcribeInterview(request,options),again=await transcribeInterview(request,options);
      if(calls!==1||JSON.stringify(result)!==JSON.stringify(again))throw new Error("replayed provider");
      process.stdout.write(JSON.stringify({assetId:request.assetId,result}));
    }finally{await rm(root,{recursive:true,force:true});}
  `,
    { bundle: false },
  );
  assert.equal(result.frames.length, 2);
  assert.equal(result.frames[0].purpose, "interview-transcribe");
  assert.deepEqual(result.frames[0].input.parameters.request, {
    model: "transcribe-fixture",
    response_format: "json",
    language: "zh",
    file: {
      assetId: JSON.parse(result.stdout).assetId,
      mimeType: "audio/webm",
      bytes: 104,
      filename: "recording.webm",
    },
  });
  assert.equal(result.frames[1].output.text, "实际模型转写回答");
  assert.doesNotMatch(
    result.observation,
    /synthetic-private-key|fixture\.invalid|input\.webm|answerHash|questionId|\[11,11/,
  );
});
