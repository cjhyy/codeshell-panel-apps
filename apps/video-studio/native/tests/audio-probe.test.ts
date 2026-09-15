import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeVoiceAudio } from "../providers/audio-probe.js";

let root: string, executable: string;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "voice-audio-probe-"));
  executable = join(root, "ffprobe-fixture");
  await writeFile(
    executable,
    `#!${process.execPath}
const a = process.argv.slice(2), mode = a.at(-1);
const requireArg = (key, value) => { if(a[a.indexOf(key)+1] !== value) throw Error('missing bound '+key); };
requireArg('-protocol_whitelist','file,pipe');
requireArg('-format_whitelist','wav,matroska,webm');
requireArg('-select_streams','a:0');
if(a.includes('packet=pts_time,dts_time,duration_time')) {
 requireArg('-read_intervals','%+31');
 if(mode==='no-audio' || mode==='na-duration' || mode==='wav') throw Error('unexpected fallback');
 if(mode==='invalid') console.log('pts_time=N/A|dts_time=N/A|duration_time=N/A');
 else if(mode==='oversize') process.stdout.write('x'.repeat(5*1024*1024));
 else {
  const origin=mode==='offset'?100:0;
  console.log('pts_time='+origin+'|duration_time=0.060000');
  const end=mode==='long'?31.02:3.24;
  console.log('pts_time=N/A|dts_time='+(origin+end-0.06)+'|duration_time=0.060000');
 }
} else {
 if(mode==='no-audio') console.log(JSON.stringify({streams:[],format:{duration:'3.2'}}));
 else if(mode==='na-duration') console.log(JSON.stringify({streams:[{codec_name:'pcm_s16le',duration:'N/A'}],format:{duration:'6.066667'}}));
 else if(mode==='wav') console.log(JSON.stringify({streams:[{codec_name:'pcm_s16le',duration:'4',sample_rate:'48000',channels:1}],format:{duration:'4'}}));
 else console.log(JSON.stringify({streams:[{codec_name:'opus',sample_rate:'48000',channels:1}],format:mode==='offset'?{start_time:'100'}:{}}));
}
`,
  );
  await chmod(executable, 0o700);
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});
const probe = (path: string, signal = new AbortController().signal) =>
  probeVoiceAudio(path, signal, { ffprobePath: executable, formats: "wav,matroska,webm" });

test("ordinary WAV and N/A stream duration use available positive metadata without scanning", async () => {
  const wav = await probe("wav");
  assert.equal(wav.durationSeconds, 4);
  assert.equal(wav.audio.codec_name, "pcm_s16le");
  assert.equal((await probe("na-duration")).durationSeconds, 6.066667);
});

test("MediaRecorder WebM with no Duration uses bounded audio packets including DTS fallback", async () => {
  const result = await probe("webm");
  assert.equal(result.audio.codec_name, "opus");
  assert.ok(Math.abs(result.durationSeconds - 3.24) < 0.000001);
  assert.ok(Math.abs((await probe("offset")).durationSeconds - 3.24) < 0.000001);
});

test("packet fallback preserves the existing 30-second reference rejection", async () => {
  assert.ok((await probe("long")).durationSeconds > 30);
});

test("missing audio and unmeasurable timelines give distinct useful errors", async () => {
  await assert.rejects(probe("no-audio"), /没有可用音轨/);
  await assert.rejects(probe("invalid"), /暂时无法测量/);
  await assert.rejects(probe("oversize"), /暂时无法测量/);
});

test("pre-cancelled duration inspection never starts a probe", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(probe("wav", controller.signal), { name: "AbortError" });
});

test(
  "optional local recording smoke only probes metadata and packet timestamps",
  { skip: !process.env.VIDEO_STUDIO_PROBE_SMOKE_FILE },
  async () => {
    const value = await probeVoiceAudio(
      process.env.VIDEO_STUDIO_PROBE_SMOKE_FILE!,
      new AbortController().signal,
      {
        formats: "wav,aiff,mp3,flac,ogg,mov,matroska,webm,aac,amr",
      },
    );
    assert.ok(
      Number.isFinite(value.durationSeconds) &&
        value.durationSeconds >= 3 &&
        value.durationSeconds <= 30,
    );
    console.log(
      `Voice probe: ${value.audio.codec_name}, ${value.durationSeconds.toFixed(3)} seconds; no decoding or inference`,
    );
  },
);
