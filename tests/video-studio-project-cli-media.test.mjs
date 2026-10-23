import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, appendFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// The installed CLI with real FFmpeg and Chrome: the same renderer the panel uses.
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "video-studio-cli-media-")),
    project = join(root, "project"),
    sources = join(root, "sources"),
    installed = join(root, "installed");
  await Promise.all([mkdir(project), mkdir(sources), cp("panels/video-studio", installed, { recursive: true })]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = join(installed, "app/tools/video-studio.mjs"),
    env = { ...process.env, VIDEO_STUDIO_CLI_HOME: join(root, "cli-home") };
  const run = (command, value, options = {}) =>
    new Promise(async (resolve, reject) => {
      const args = [cli, command, "--project", project];
      if (value !== undefined) {
        const path = join(root, `request-${randomUUID()}.json`);
        await writeFile(path, JSON.stringify(value));
        args.push("--input-file", path);
      }
      const child = spawn(process.execPath, args, { cwd: project, env: { ...env, ...options.env } });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.once("error", reject);
      child.once("close", (status) => {
        const lines = stdout.trim().split("\n");
        try {
          assert.equal(lines.length, 1, `one stdout receipt: ${stdout}${stderr}`);
          resolve({ status, stderr, ...JSON.parse(lines[0]) });
        } catch (error) {
          reject(error);
        }
      });
    });
  const revision = async () => (await run("inspect")).result.revision;
  const ffmpeg = (args) => {
    const done = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", ...args]);
    assert.equal(done.status, 0, String(done.stderr));
  };
  const probe = (path) =>
    JSON.parse(
      spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", path], {
        encoding: "utf8",
      }).stdout,
    );
  // Two seconds of moving test picture with a tone, and a still card.
  ffmpeg([
    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(sources, "clip.mp4"),
  ]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x225577:s=320x180", "-frames:v", "1", join(sources, "card.png")]);
  await run("init", { name: "CLI 成片", width: 320, height: 180 });
  return { root, project, sources, run, revision, probe };
}
const small = {
  id: "small",
  name: "小尺寸",
  width: 320,
  height: 180,
  frameRate: { numerator: 30, denominator: 1 },
  container: "mp4",
  videoCodec: "h264",
  audioCodec: "aac",
  quality: { mode: "quality", value: 62 },
  audioBitrate: 128000,
  sampleRate: 48000,
  includeCaptions: true,
};

test("add-media reads local files in place, places them in order and keeps paths out of the document", { timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.project, "footage"));
  await cp(join(f.sources, "clip.mp4"), join(f.project, "footage/inside.mp4"));
  const before = await f.revision();
  const added = await f.run("add-media", {
    expectedRevision: before,
    files: [{ path: join(f.sources, "card.png"), name: "标题卡" }, { path: "footage/inside.mp4" }],
    imageSeconds: 1,
  });
  assert.equal(added.ok, true, JSON.stringify(added));
  const [card, clip] = added.result.assets;
  assert.deepEqual([card.kind, clip.kind], ["image", "video"]);
  assert.deepEqual([card.clip.startSeconds, card.clip.durationSeconds], [0, 1]);
  assert.deepEqual([clip.clip.startSeconds, clip.clip.durationSeconds], [1, 2]);
  assert.equal(card.clip.trackId, clip.clip.trackId, "both continue the main picture track");
  assert.match(clip.resourceId, /^external-[a-f0-9]{64}$/);

  const document = await readFile(join(f.project, "video-studio-cli.json"), "utf8"),
    realSources = await realpath(f.sources);
  for (const path of [f.sources, realSources, f.project, await realpath(f.project)])
    assert.ok(!document.includes(path), "no local paths in the document");
  const registry = JSON.parse(await readFile(join(f.project, "video-studio-media.json"), "utf8"));
  assert.equal(registry.media[card.resourceId].path, join(realSources, "card.png"), "outside media keeps its real path");
  assert.equal(registry.media[clip.resourceId].path, "footage/inside.mp4", "project media stays relative");

  const stale = await f.run("add-media", { expectedRevision: before, files: [{ path: "footage/inside.mp4" }] });
  assert.equal(stale.status, 3);
  assert.equal(stale.error.code, "REVISION_CONFLICT");

  const again = await f.run("add-media", {
    expectedRevision: added.result.revision,
    files: [{ path: join(f.sources, "card.png") }],
    place: "none",
  });
  assert.equal(again.result.assets[0].reused, true, "the same bytes reuse their asset");
  assert.equal(again.result.assets[0].clip, undefined);
  assert.equal(JSON.parse(await readFile(join(f.project, "video-studio-cli.json"), "utf8")).assets.length, 2);

  const missing = await f.run("add-media", { expectedRevision: added.result.revision, files: [{ path: "nope.mp4" }] });
  assert.equal(missing.error.code, "INVALID_INPUT");
});

test("render writes a verified video once, frames show it, and changed or unknown media are refused", { timeout: 300000 }, async (t) => {
  const f = await fixture(t);
  const added = await f.run("add-media", {
    expectedRevision: await f.revision(),
    files: [{ path: join(f.sources, "card.png") }, { path: join(f.sources, "clip.mp4") }],
    imageSeconds: 1,
  });
  assert.equal(added.ok, true, JSON.stringify(added));
  const rendered = await f.run("render", { output: "renders/cut.mp4", profile: small });
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  assert.equal(rendered.result.verified, true);
  assert.match(rendered.stderr, /render: complete 100%/, "progress goes to stderr");
  const probed = f.probe(join(f.project, "renders/cut.mp4"));
  assert.ok(Math.abs(Number(probed.format.duration) - 3) < 0.1, probed.format.duration);
  assert.deepEqual(probed.streams.map((item) => item.codec_type).sort(), ["audio", "video"]);
  assert.deepEqual([probed.streams.find((item) => item.codec_type === "video").width], [320]);

  const frames = await f.run("frames", { path: "renders/cut.mp4", times: [0.5, 2], output: "review", width: 160 });
  assert.equal(frames.ok, true, JSON.stringify(frames));
  assert.deepEqual((await readdir(join(f.project, "review"))).sort(), [
    "frame-01-0.50s.jpg",
    "frame-02-2.00s.jpg",
    "sheet.jpg",
  ]);

  const again = await f.run("render", { output: "renders/cut.mp4", profile: small });
  assert.equal(again.status, 3);
  assert.equal(again.error.code, "OUTPUT_EXISTS");
  assert.equal(f.probe(join(f.project, "renders/cut.mp4")).format.duration, probed.format.duration);
  const wrongExtension = await f.run("render", { output: "renders/cut.mov", profile: small });
  assert.equal(wrongExtension.error.code, "INVALID_INPUT");

  // A touched but identical source still reads; changed bytes are refused.
  const clipAsset = added.result.assets[1];
  await utimes(join(f.sources, "clip.mp4"), new Date(), new Date(Date.now() + 5000));
  const touched = await f.run("frames", { assetId: clipAsset.assetId, times: [1], output: "touched", sheet: false });
  assert.equal(touched.ok, true, JSON.stringify(touched));
  await appendFile(join(f.sources, "clip.mp4"), Buffer.from("changed"));
  const changed = await f.run("render", { output: "renders/changed.mp4", profile: small });
  assert.equal(changed.error.code, "SOURCE_CHANGED");
  await access(join(f.project, "renders/changed.mp4")).then(
    () => assert.fail("no output for a refused render"),
    () => {},
  );

  const document = JSON.parse(await readFile(join(f.project, "video-studio-cli.json"), "utf8"));
  document.assets[0].resourceId = `external-${"a".repeat(64)}`;
  await writeFile(join(f.root, "foreign.json"), JSON.stringify(document));
  const imported = await f.run("import", { expectedRevision: await f.revision(), documentFile: join(f.root, "foreign.json") });
  assert.equal(imported.ok, true, JSON.stringify(imported));
  const unknown = await f.run("render", { output: "renders/unknown.mp4", profile: small });
  assert.equal(unknown.error.code, "MEDIA_NOT_REGISTERED");
});

test("macOS voiceover is saved in the project, registered and placed on a free audio track", { skip: process.platform !== "darwin", timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  const voices = await f.run("voices", { modelId: "macos-say", language: "zh" });
  assert.equal(voices.ok, true);
  assert.equal(voices.result.models[0].id, "macos-say");
  const spoken = await f.run("voiceover", {
    expectedRevision: await f.revision(),
    text: "命令行配音测试。",
    modelId: "macos-say",
    at: 0.5,
  });
  assert.equal(spoken.ok, true, JSON.stringify(spoken));
  assert.match(spoken.result.output, /^media\/voiceover-[a-f0-9]{12}\.wav$/);
  const [asset] = spoken.result.assets;
  assert.equal(asset.kind, "audio");
  assert.equal(asset.clip.startSeconds, 0.5);
  await access(join(f.project, spoken.result.output));
  const registry = JSON.parse(await readFile(join(f.project, "video-studio-media.json"), "utf8"));
  assert.equal(registry.media[asset.resourceId].path, spoken.result.output);
  const repeat = await f.run("voiceover", {
    expectedRevision: spoken.result.revision,
    text: "命令行配音测试。",
    modelId: "macos-say",
  });
  assert.equal(repeat.error.code, "OUTPUT_EXISTS", "the same narration is not written twice");
});

const whisperModel = join(homedir(), ".cache", "whisper", "tiny.pt");
const hasWhisper =
  spawnSync("whisper", ["--help"], { stdio: "ignore" }).status === 0 &&
  (await access(whisperModel).then(() => true, () => false));
test("transcribe writes source-time JSON and SRT into the project", { skip: !hasWhisper && "needs whisper and ~/.cache/whisper/tiny.pt", timeout: 300000 }, async (t) => {
  const f = await fixture(t);
  const spoken = spawnSync("say", ["-v", "Samantha", "-o", join(f.sources, "speech.aiff"), "Hello from the command line."]);
  if (spoken.status !== 0) return t.skip("needs macOS say for a spoken source");
  const added = await f.run("add-media", {
    expectedRevision: await f.revision(),
    files: [{ path: join(f.sources, "speech.aiff"), name: "speech" }],
    place: "none",
  });
  const result = await f.run("transcribe", { assetId: added.result.assets[0].assetId, language: "en", model: "tiny" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.result.textPreview, /command line/i);
  assert.match(result.result.files.srt, /^transcripts\/speech-[a-f0-9]{8}\.srt$/);
  assert.match(await readFile(join(f.project, result.result.files.srt), "utf8"), /-->/);
});
