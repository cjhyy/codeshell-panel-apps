import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertExportEncodersAvailable,
  createExportPresets,
  exportEncodingArguments,
  requiredExportEncoders,
  validateExportProfile,
  verifyExportOutput,
  type ExportProfile,
} from "../apps/video-studio/src/editor/export-settings";

function profile(patch: Partial<ExportProfile> = {}): ExportProfile {
  return validateExportProfile({ ...createExportPresets()[0], ...patch });
}
function probe(p: ExportProfile = profile()) {
  return {
    streams: [
      {
        codec_type: "video",
        codec_name: p.videoCodec,
        width: p.width,
        height: p.height,
        avg_frame_rate: `${p.frameRate.numerator}/${p.frameRate.denominator}`,
        duration: "1.000000",
      },
      {
        codec_type: "audio",
        codec_name: p.audioCodec === "pcm" ? "pcm_s16le" : p.audioCodec,
        sample_rate: "48000",
        channels: 2,
      },
    ],
    format: {
      duration: "1.000000",
      format_name: p.container === "webm" ? "matroska,webm" : "mov,mp4,m4a,3gp,3g2,mj2",
    },
  };
}

test("export presets are independent portable profiles with strict bounded validation", () => {
  const presets = createExportPresets();
  assert.equal(presets.length, 3);
  assert.equal(new Set(presets.map((p) => p.id)).size, 3);
  assert.deepEqual(
    presets.map((p) => [p.width, p.height]),
    [
      [1920, 1080],
      [1080, 1920],
      [3840, 2160],
    ],
  );
  presets[0]!.frameRate.numerator = 60;
  assert.equal(presets[1]!.frameRate.numerator, 30);
  assert.equal(createExportPresets()[0]!.frameRate.numerator, 30);
  assert.deepEqual(profile({ frameRate: { numerator: 60000, denominator: 2002 } }).frameRate, {
    numerator: 30000,
    denominator: 1001,
  });
  for (const patch of [
    { width: 1919 },
    { height: 9000 },
    { frameRate: { numerator: 1, denominator: 0 } },
    { frameRate: { numerator: 240, denominator: 1 } },
    { id: "../../escape" },
    { includeCaptions: "true" },
    { quality: { mode: "quality", value: 101 } },
    { quality: { mode: "quality", value: 60, bitsPerSecond: 4000000 } },
    { quality: { mode: "bitrate", bitsPerSecond: Infinity } },
    { sampleRate: 44100 },
    { container: "mkv" },
    { audioBitrate: 0 },
    { arbitraryArguments: ["-report"] },
  ])
    assert.throws(() => validateExportProfile({ ...createExportPresets()[0], ...patch }));
});

test("container codec compatibility and ProRes quality policy are enforced before execution", () => {
  for (const patch of [
    { container: "webm", videoCodec: "h264", audioCodec: "opus" },
    { container: "mp4", videoCodec: "prores", audioCodec: "pcm", audioBitrate: 1536000 },
    { container: "webm", videoCodec: "vp9", audioCodec: "aac" },
    { container: "mov", videoCodec: "vp9", audioCodec: "opus" },
    { container: "mov", videoCodec: "prores", audioCodec: "pcm", audioBitrate: 192000 },
    {
      container: "mov",
      videoCodec: "prores",
      audioCodec: "pcm",
      audioBitrate: 1536000,
      quality: { mode: "bitrate", bitsPerSecond: 50000000 },
    },
  ])
    assert.throws(() => validateExportProfile({ ...createExportPresets()[0], ...patch }));
  assert.doesNotThrow(() =>
    profile({ container: "mov", videoCodec: "prores", audioCodec: "pcm", audioBitrate: 1536000 }),
  );
});

test("encoding configuration requires the actual selected video and audio encoders", () => {
  const p = profile({ container: "webm", videoCodec: "vp9", audioCodec: "opus" });
  assert.deepEqual(requiredExportEncoders(p), ["libvpx-vp9", "libopus"]);
  assert.throws(() => assertExportEncodersAvailable(p, ["libx264", "aac"]), /libvpx-vp9/);
  assert.throws(() => assertExportEncodersAvailable(p, ["libvpx-vp9", "opus"]), /libopus/);
  assert.doesNotThrow(() => assertExportEncodersAvailable(p, new Set(["libvpx-vp9", "libopus"])));
  const qualityArgs = exportEncodingArguments(p);
  assert.equal(
    qualityArgs[qualityArgs.indexOf("-b:v") + 1],
    "0",
    "VP9 unconstrained quality must disable target bitrate",
  );
  const bitrateArgs = exportEncodingArguments(
    profile({ quality: { mode: "bitrate", bitsPerSecond: 1234000 } }),
  );
  assert.equal(bitrateArgs[bitrateArgs.indexOf("-b:v") + 1], "1234000");
  assert.equal(bitrateArgs.includes("-crf"), false);
  const proresArgs = exportEncodingArguments(
    profile({ container: "mov", videoCodec: "prores", audioCodec: "pcm", audioBitrate: 1536000 }),
  );
  assert.equal(
    proresArgs.includes("-b:a"),
    false,
    "PCM bitrate derives from fixed sample format and channels",
  );
  assert.equal(proresArgs[proresArgs.indexOf("-pix_fmt") + 1], "yuv422p10le");
});

test("output verification rejects wrong frames, timing, dimensions, stream codecs and missing metadata", () => {
  const p = profile();
  assert.doesNotThrow(() => verifyExportOutput(p, probe(p), 1));
  for (const change of [
    (value: any) => {
      value.streams[0].width = 1280;
    },
    (value: any) => {
      value.streams[0].avg_frame_rate = "25/1";
    },
    (value: any) => {
      value.streams[0].codec_name = "hevc";
    },
    (value: any) => {
      value.streams[1].codec_name = "mp3";
    },
    (value: any) => {
      value.streams[1].channels = 1;
    },
    (value: any) => {
      value.streams[1].sample_rate = "44100";
    },
    (value: any) => {
      value.streams[0].duration = "1.040000";
    },
    (value: any) => {
      value.format.duration = "2.000000";
    },
    (value: any) => {
      value.streams = value.streams.slice(0, 1);
    },
    (value: any) => {
      value.streams.push(value.streams[0]);
    },
    (value: any) => {
      value.streams[0].duration = "N/A";
      value.format.duration = "N/A";
    },
    (value: any) => {
      value.format.format_name = "matroska,webm";
    },
  ]) {
    const invalid = probe(p);
    change(invalid);
    assert.throws(() => verifyExportOutput(p, invalid, 1));
  }
  const withinFrame = probe(p);
  withinFrame.streams[0]!.duration = "1.033333";
  assert.doesNotThrow(() => verifyExportOutput(p, withinFrame, 1));
  const ntsc = profile({ frameRate: { numerator: 30000, denominator: 1001 } });
  assert.doesNotThrow(() => verifyExportOutput(ntsc, probe(ntsc), 1));
});

const mediaEnabled = process.env.VIDEO_STUDIO_REAL_EXPORT_TESTS === "1";
test(
  "real FFmpeg exports verify H264, HEVC, VP9 and ProRes at rational frame rates",
  { skip: !mediaEnabled },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "video-studio-export-profiles-"));
    const encodersResult = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
    assert.equal(encodersResult.status, 0, encodersResult.stderr);
    const encoders = encodersResult.stdout
      .split("\n")
      .flatMap((line) => /^\s*[VAS][A-Z.]{5}\s+(\S+)/.exec(line)?.slice(1) ?? []);
    const options: Partial<ExportProfile>[] = [
      { videoCodec: "h264", frameRate: { numerator: 30000, denominator: 1001 } },
      { videoCodec: "hevc", frameRate: { numerator: 24, denominator: 1 } },
      {
        container: "webm",
        videoCodec: "vp9",
        audioCodec: "opus",
        frameRate: { numerator: 60, denominator: 1 },
      },
      {
        container: "mov",
        videoCodec: "prores",
        audioCodec: "pcm",
        audioBitrate: 1536000,
        frameRate: { numerator: 25, denominator: 1 },
      },
      {
        videoCodec: "h264",
        quality: { mode: "bitrate", bitsPerSecond: 500000 },
        frameRate: { numerator: 30, denominator: 1 },
      },
    ];
    try {
      for (const patch of options) {
        const p = profile({ ...patch, width: 160, height: 96 });
        assertExportEncodersAvailable(p, encoders);
        const output = join(directory, `${p.videoCodec}-${p.quality.mode}.${p.container}`);
        const result = spawnSync(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=160x96:rate=60",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-t",
            "1",
            ...exportEncodingArguments(p),
            "-threads",
            "1",
            output,
          ],
          { encoding: "utf8", timeout: 30000 },
        );
        assert.equal(
          result.status,
          0,
          `${p.videoCodec}: ${result.error?.message ?? result.stderr}`,
        );
        const inspected = spawnSync(
          "ffprobe",
          ["-v", "error", "-show_streams", "-show_format", "-of", "json", output],
          { encoding: "utf8", timeout: 10000 },
        );
        assert.equal(inspected.status, 0, inspected.stderr);
        assert.doesNotThrow(
          () => verifyExportOutput(p, JSON.parse(inspected.stdout), 1),
          `${p.videoCodec}: ${inspected.stdout}`,
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
