import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repository = fileURLToPath(new URL("../", import.meta.url));
const S = 48000,
  T = 240000;
function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-nostdin", "-v", "error", ...args], {
    timeout: 20000,
    maxBuffer: 16 * 1024 ** 2,
  });
  assert.equal(result.status, 0, result.stderr?.toString() || String(result.error));
  return result.stdout;
}
function decode(path) {
  const buffer = ffmpeg([
    "-i",
    path,
    "-ac",
    "2",
    "-ar",
    String(S),
    "-c:a",
    "pcm_f32le",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  return Array.from({ length: buffer.length / 4 }, (_, index) => buffer.readFloatLE(index * 4));
}
function rms(pcm, start, end, channel = 0) {
  let power = 0,
    count = 0;
  for (let sample = Math.round(start * S); sample < Math.round(end * S); sample++) {
    power += pcm[sample * 2 + channel] ** 2;
    count++;
  }
  return Math.sqrt(power / count);
}
function frequency(pcm, start, end, channel = 0) {
  let crossings = 0;
  for (let sample = Math.round(start * S) + 1; sample < Math.round(end * S); sample++)
    if (pcm[(sample - 1) * 2 + channel] <= 0 && pcm[sample * 2 + channel] > 0) crossings++;
  return crossings / (end - start);
}
const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected} ± ${tolerance}`);

test(
  "editor audio renders real local PCM for preview and export",
  { timeout: 120000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "editor-audio-pcm-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const bundle = join(directory, "audio.mjs");
    await build({
      stdin: {
        resolveDir: repository,
        sourcefile: "audio-fixture.ts",
        contents: `
    export {renderEditorAudio} from "./apps/video-studio/native/media/editor-audio-renderer.ts";
    export {createTrack,defaultAudioMix,defaultTransform,defaultColorAdjustment} from "./apps/video-studio/src/editor/defaults.ts";
    export {constantTimeMap,freezeTimeMap} from "./apps/video-studio/src/editor/time.ts";
  `,
      },
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      logLevel: "silent",
    });
    const api = await import(pathToFileURL(bundle).href);
    const paths = new Map();
    for (const [id, expression] of [
      ["tone", "0.2*sin(2*PI*440*t)"],
      ["bed", "0.2*sin(2*PI*220*t)"],
      ["voice", "0.4*sin(2*PI*880*t)*between(t,1,2)"],
      ["silent", "0"],
      ["chirp", "0.2*sin(2*PI*(220*t+110*t*t))"],
    ]) {
      const path = join(directory, `${id}.wav`);
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        `aevalsrc='${expression}|${expression}':s=${S}:d=4`,
        "-c:a",
        "pcm_f32le",
        "-y",
        path,
      ]);
      paths.set(id, path);
    }
    const noAudio = join(directory, "no-audio.mp4");
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=black:s=32x32:r=10:d=4",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      noAudio,
    ]);
    paths.set("no-audio", noAudio);
    const offsetAudio = join(directory, "offset-audio.mp4");
    ffmpeg([
      "-i",
      noAudio,
      "-itsoffset",
      "0.75",
      "-i",
      paths.get("tone"),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-t",
      "4",
      "-y",
      offsetAudio,
    ]);
    paths.set("offset-audio", offsetAudio);
    const visual = () => ({
      transform: api.defaultTransform(),
      color: api.defaultColorAdjustment(),
      blendMode: "normal",
    });
    const clip = (id = "clip", assetId = "tone", duration = 2 * T, trackId = "video") => ({
      id,
      label: id,
      kind: "media",
      trackId,
      start: 0,
      duration,
      assetId,
      timeMap: api.constantTimeMap(0, duration).timeMap,
      audio: api.defaultAudioMix(),
      ...visual(),
    });
    const sequence = (id = "main") => ({
      id,
      name: id,
      width: 1280,
      height: 720,
      frameRate: { numerator: 30000, denominator: 1001 },
      background: "#000000",
      timelineMode: "free",
      tracks: [api.createTrack("video", "audio"), api.createTrack("sound", "audio")],
      clips: [],
      transitions: [],
      markers: [],
    });
    const document = (...sequences) => ({
      schemaVersion: 2,
      timebase: T,
      id: "doc",
      name: "Audio",
      revision: 0,
      assets: [...paths.keys()].map((id) => ({
        id,
        name: id,
        kind: id === "no-audio" ? "video" : "audio",
        duration: 4 * T,
        ...(id === "no-audio" ? { width: 32, height: 32 } : {}),
      })),
      sequences,
      activeSequenceId: sequences[0].id,
      exportProfiles: [],
    });
    let renderIndex = 0;
    const options = (doc, extra = {}) => ({
      document: doc,
      sequenceId: "main",
      resolveAssetPath: (id) => paths.get(id),
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workDir: join(directory, "work"),
      cacheDir: join(directory, "cache"),
      outputPath: join(directory, "outputs", `mix-${++renderIndex}.wav`),
      signal: new AbortController().signal,
      ...extra,
    });
    const render = async (seq, extra = {}) => {
      const result = await api.renderEditorAudio(options(document(seq), extra));
      return { result, pcm: decode(result.path) };
    };

    await t.test(
      "unity PCM, exact output sample count, stereo center and amplitude survive",
      async () => {
        const seq = sequence();
        seq.clips = [clip("clip", "tone", 2 * T + 3)];
        const { result, pcm } = await render(seq);
        assert.equal(result.sampleCount, 2 * S + 1);
        assert.equal(pcm.length, result.sampleCount * 2);
        near(frequency(pcm, 0.2, 1.8), 440, 1);
        near(rms(pcm, 0.2, 1.8), 0.2 / Math.sqrt(2), 0.0001);
        assert.deepEqual(
          pcm.filter((_, i) => i % 2 === 0),
          pcm.filter((_, i) => i % 2 === 1),
        );
        assert.equal(result.samplesOverFullScale, 0);
        near(result.peak, 0.2, 1e-6);
      },
    );

    await t.test(
      "volume and pan keyframes, cubic easing and fades affect actual samples",
      async () => {
        const seq = sequence(),
          media = clip();
        media.audio.volume = {
          keyframes: [
            {
              time: 0,
              value: 0,
              easing: { type: "cubic-bezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
            },
            { time: 2 * T, value: 1 },
          ],
        };
        media.audio.pan = {
          keyframes: [
            { time: 0, value: -1 },
            { time: 2 * T, value: 1 },
          ],
        };
        media.audio.fadeIn = T;
        media.audio.fadeOut = T;
        seq.clips = [media];
        const { pcm } = await render(seq);
        assert.ok(rms(pcm, 0.05, 0.1) < 0.001);
        assert.ok(rms(pcm, 0.2, 0.3, 0) > rms(pcm, 0.2, 0.3, 1) * 2);
        near(rms(pcm, 0.995, 1.005), (0.2 / Math.sqrt(2)) * 0.5, 0.003);
        assert.ok(rms(pcm, 1.8, 1.9, 1) > rms(pcm, 1.8, 1.9, 0) * 2);
        assert.ok(rms(pcm, 1.999, 2, 1) < 0.001);
      },
    );

    await t.test(
      "reverse reads actual source samples in descending order; freeze is explicitly silent",
      async () => {
        const seq = sequence(),
          media = clip("reverse", "chirp");
        media.timeMap = api.constantTimeMap(3 * T, T).timeMap;
        seq.clips = [media];
        const { pcm } = await render(seq),
          source = decode(paths.get("chirp"));
        for (const sample of [0, 1, 313, 9011, 24000, 65001, 95999])
          near(pcm[sample * 2], source[(3 * S - sample) * 2], 1e-7);
        media.timeMap = api.freezeTimeMap(T, 2 * T);
        const hold = await render(seq);
        assert.equal(hold.result.peak, 0);
        assert.ok(hold.pcm.every((value) => value === 0));
      },
    );

    await t.test(
      "2x speed preserves pitch when requested and changes it when disabled",
      async () => {
        const seq = sequence(),
          media = clip();
        media.timeMap = api.constantTimeMap(0, 4 * T, 2).timeMap;
        seq.clips = [media];
        const preserved = await render(seq);
        near(frequency(preserved.pcm, 0.3, 1.7), 440, 2);
        assert.equal(preserved.result.processing.processedSpans, 1);
        media.audio.preservePitch = false;
        const natural = await render(seq);
        near(frequency(natural.pcm, 0.3, 1.7), 880, 2);
        near(rms(natural.pcm, 0.3, 1.7), 0.2 / Math.sqrt(2), 0.003);
      },
    );

    await t.test(
      "independent octave pitch shifts preserve duration and reuse processed PCM",
      async () => {
        const seq = sequence(),
          media = clip();
        media.audio.pitchSemitones = 12;
        seq.clips = [media];
        const shifted = await render(seq);
        near(frequency(shifted.pcm, 0.3, 1.7), 880, 2);
        assert.equal(shifted.pcm.length, 2 * S * 2);
        const again = await render(seq);
        assert.equal(again.result.processing.spanCacheHits, 1);
        assert.ok(again.result.assets.every((asset) => asset.cacheHit));
        assert.deepEqual(again.pcm, shifted.pcm);
        media.audio.pitchSemitones = -12;
        const lowered = await render(seq);
        near(frequency(lowered.pcm, 0.3, 1.7), 220, 2);
      },
    );

    await t.test(
      "piecewise speed and reverse spans produce their own correct pitch and sample durations",
      async () => {
        const seq = sequence(),
          media = clip("curve", "tone", 3 * T);
        media.timeMap = {
          points: [
            { time: 0, source: 0 },
            { time: T, source: 2 * T },
            { time: 2 * T, source: (5 * T) / 2 },
            { time: 3 * T, source: (3 * T) / 2 },
          ],
        };
        media.audio.preservePitch = false;
        seq.clips = [media];
        const { pcm } = await render(seq);
        near(frequency(pcm, 0.2, 0.8), 880, 2);
        near(frequency(pcm, 1.2, 1.8), 220, 2);
        near(frequency(pcm, 2.2, 2.8), 440, 2);
        assert.equal(pcm.length, 3 * S * 2);
      },
    );

    await t.test(
      "real RMS sidechain lowers the bed and releases; muting that source removes the duck",
      async () => {
        const seq = sequence(),
          voice = clip("voice", "voice", 3 * T),
          bed = clip("bed", "bed", 3 * T, "sound");
        voice.audio.pan = 1;
        bed.audio.pan = -1;
        bed.audio.ducking = {
          sidechainTrackIds: ["video"],
          thresholdDb: -24,
          attenuationDb: 12,
          attack: 0.03 * T,
          release: 0.08 * T,
        };
        seq.clips = [voice, bed];
        const ducked = await render(seq);
        const baseline = rms(ducked.pcm, 0.4, 0.8),
          during = rms(ducked.pcm, 1.4, 1.8),
          recovered = rms(ducked.pcm, 2.7, 2.9);
        near(during / baseline, 10 ** (-12 / 20), 0.005);
        near(recovered / baseline, 1, 0.01);
        assert.equal(ducked.result.ducking.sidechain, "pre-ducking-scoped-bus");
        seq.tracks[0].muted = true;
        const muted = await render(seq);
        near(rms(muted.pcm, 1.4, 1.8) / rms(muted.pcm, 0.4, 0.8), 1, 0.001);
        seq.tracks[0].muted = false;
        voice.assetId = "silent";
        const silent = await render(seq);
        near(rms(silent.pcm, 1.4, 1.8) / rms(silent.pcm, 0.4, 0.8), 1, 0.001);
      },
    );

    await t.test("nested source time and parent gain affect actual audio", async () => {
      const root = sequence(),
        child = sequence("child"),
        media = clip("leaf", "tone", 4 * T);
      media.audio.volume = 0.5;
      child.clips = [media];
      const parent = {
        id: "nest",
        kind: "sequence",
        sequenceId: "child",
        label: "Nested",
        trackId: "video",
        start: 0,
        duration: 2 * T,
        timeMap: api.constantTimeMap(0, 4 * T, 2).timeMap,
        audio: { ...api.defaultAudioMix(), volume: 0.5, preservePitch: false },
        ...visual(),
      };
      root.clips = [parent];
      const result = await api.renderEditorAudio(options(document(root, child))),
        pcm = decode(result.path);
      near(frequency(pcm, 0.3, 1.7), 880, 2);
      near(rms(pcm, 0.3, 1.7), 0.05 / Math.sqrt(2), 0.002);
    });

    await t.test("multicam visual switches never interrupt the chosen master audio", async () => {
      const seq = sequence();
      seq.tracks[0].kind = "video";
      seq.clips = [
        {
          id: "multi",
          kind: "multicam",
          label: "Multi",
          trackId: "video",
          start: 0,
          duration: 2 * T,
          timeMap: api.constantTimeMap(0, 2 * T).timeMap,
          audio: api.defaultAudioMix(),
          ...visual(),
          angles: [
            { id: "a", name: "A", assetId: "tone", offset: 0 },
            { id: "b", name: "B", assetId: "bed", offset: T },
          ],
          switches: [
            { time: 0, angleId: "a" },
            { time: T, angleId: "b" },
          ],
          audioAngleId: "a",
        },
      ];
      // Schema multicam angles need video assets; these local WAV fixtures still contain the selected real sound stream.
      const doc = document(seq);
      for (const asset of doc.assets)
        if (["tone", "bed"].includes(asset.id))
          Object.assign(asset, { kind: "video", width: 1280, height: 720 });
      const result = await api.renderEditorAudio(options(doc)),
        pcm = decode(result.path);
      near(frequency(pcm, 0.2, 0.8), 440, 2);
      near(frequency(pcm, 1.2, 1.8), 440, 2);
      assert.deepEqual(
        result.assets.map((asset) => asset.assetId),
        ["tone"],
      );
    });

    await t.test(
      "actual no-audio video is reported, a false audio asset fails, and silence is never fabricated on failure",
      async () => {
        const seq = sequence();
        seq.clips = [clip("silent-video", "no-audio")];
        const video = await render(seq);
        assert.equal(video.result.assets[0].status, "no-audio-stream");
        assert.equal(video.result.peak, 0);
        const doc = document(seq);
        const asset = doc.assets.find((item) => item.id === "no-audio");
        asset.kind = "audio";
        delete asset.width;
        delete asset.height;
        await assert.rejects(api.renderEditorAudio(options(doc)), /no decodable audio stream/);
      },
    );

    await t.test(
      "cancellation releases temporary files and never publishes an incomplete WAV",
      async () => {
        const seq = sequence();
        seq.clips = [clip()];
        const controller = new AbortController();
        const args = options(document(seq), {
          signal: controller.signal,
          onProgress: ({ stage }) => {
            if (stage === "mix-audio") controller.abort();
          },
        });
        await assert.rejects(api.renderEditorAudio(args), (error) => error.name === "AbortError");
        await assert.rejects(stat(args.outputPath), { code: "ENOENT" });
        assert.deepEqual(await readdir(args.workDir), []);
        await assert.rejects(
          api.renderEditorAudio(options(document(seq), { maxPcmBytes: 8 })),
          /disk budget/,
        );
        await assert.rejects(
          api.renderEditorAudio(options(document(seq), { maxMixBytes: 8 })),
          /memory budget/,
        );
      },
    );

    await t.test(
      "empty timelines and a one-sample retimed clip keep their exact output bounds",
      async () => {
        const seq = sequence();
        const empty = await render(seq);
        assert.equal(empty.result.sampleCount, 0);
        assert.equal(empty.pcm.length, 0);
        const media = clip("tiny", "tone", 3);
        media.timeMap = {
          points: [
            { time: 0, source: T },
            { time: 3, source: T + 6 },
          ],
        };
        seq.clips = [media];
        const tiny = await render(seq);
        assert.equal(tiny.result.sampleCount, 1);
        assert.equal(tiny.pcm.length, 2);
        assert.ok(tiny.pcm.every(Number.isFinite));
      },
    );

    await t.test(
      "float WAV preserves chosen gain and reports overload instead of normalizing it",
      async () => {
        const seq = sequence(),
          media = clip();
        media.audio.volume = 4;
        seq.tracks[0].volume = 4;
        seq.clips = [media];
        const { result, pcm } = await render(seq);
        near(result.peak, 3.2, 0.0001);
        assert.ok(result.samplesOverFullScale > 0);
        near(rms(pcm, 0.2, 1.8), 3.2 / Math.sqrt(2), 0.001);
      },
    );

    await t.test(
      "container audio start timestamps retain real silence before a delayed sound stream",
      async () => {
        const seq = sequence();
        seq.clips = [clip("delayed", "offset-audio")];
        const { pcm } = await render(seq);
        assert.equal(rms(pcm, 0.1, 0.6), 0);
        near(frequency(pcm, 1, 1.8), 440, 2);
        near(rms(pcm, 1, 1.8), 0.2 / Math.sqrt(2), 0.005);
      },
    );

    await t.test(
      "audio outside a nested sequence trim never requests unused source files",
      async () => {
        const root = sequence(),
          child = sequence("child"),
          media = clip("outside", "tone", T);
        media.start = 2 * T;
        child.clips = [media];
        root.clips = [
          {
            id: "trim",
            kind: "sequence",
            label: "Trim",
            sequenceId: "child",
            trackId: "video",
            start: 0,
            duration: T,
            timeMap: api.constantTimeMap(0, T).timeMap,
            audio: api.defaultAudioMix(),
            ...visual(),
          },
        ];
        const result = await api.renderEditorAudio(
          options(document(root, child), {
            resolveAssetPath: () => {
              throw new Error("Unused audio must not be requested");
            },
          }),
        );
        assert.equal(result.peak, 0);
        assert.equal(result.sampleCount, S);
        assert.deepEqual(result.assets, []);
      },
    );

    await t.test("missing FFmpeg filters fail with a clear capability error", async () => {
      const executable = join(directory, "ffmpeg-without-atempo");
      await writeFile(
        executable,
        "#!/bin/sh\ncase \"$2\" in -version) echo fixture;; -filters) echo ' .. aresample A->A'; echo ' .. asetrate A->A'; echo ' .. atrim A->A';; esac\n",
        { mode: 0o755 },
      );
      const seq = sequence();
      seq.clips = [clip()];
      await assert.rejects(
        api.renderEditorAudio(options(document(seq), { ffmpegPath: executable })),
        /required atempo audio filter/,
      );
    });
  },
);
