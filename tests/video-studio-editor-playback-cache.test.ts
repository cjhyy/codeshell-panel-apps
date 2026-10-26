import assert from "node:assert/strict";
import { test } from "node:test";
import { createTrack, defaultAudioMix, defaultColorAdjustment, defaultTextStyle, defaultTransform } from "../apps/video-studio/src/editor/defaults";
import { editorAudioContentKey, editorPreviewVideoPlan, editorSourceContentKey, editorVideoSourceKey, editorVisualSourceKey } from "../apps/video-studio/src/editor/playback-cache";
import { trackAuditionDocument } from "../apps/video-studio/src/editor/audio-audition";
import { constantTimeMap } from "../apps/video-studio/src/editor/time";
import type { EditorDocument, MediaClip, MulticamClip, SequenceClip } from "../apps/video-studio/src/editor/types";

const visual = () => ({ transform: defaultTransform(), color: defaultColorAdjustment(), blendMode: "normal" as const });
const media = (id: string, assetId: string): MediaClip => ({
  id, label: id, kind: "media", trackId: "video", assetId, start: 0, duration: 240000,
  timeMap: constantTimeMap(0, 240000).timeMap, audio: defaultAudioMix(), ...visual(),
});
function document(): EditorDocument {
  return {
    schemaVersion: 2, timebase: 240000, id: "project", name: "Project", revision: 1,
    activeSequenceId: "main", exportProfiles: [],
    assets: [
      { id: "source", kind: "video", name: "Source", duration: 480000, resourceId: "resource-one", fingerprint: "1".repeat(64), width: 1280, height: 720 },
      { id: "alternate", kind: "video", name: "Alternate", duration: 480000, resourceId: "resource-two" },
      { id: "image", kind: "image", name: "Image", duration: 0, resourceId: "image-one", width: 20, height: 20 },
      { id: "unused", kind: "video", name: "Unused", duration: 240000, resourceId: "unused-one" },
    ],
    sequences: [{
      id: "main", name: "Main", width: 1280, height: 720,
      frameRate: { numerator: 30, denominator: 1 }, background: "#000000", timelineMode: "free",
      tracks: [createTrack("video", "video"), createTrack("text", "text"), createTrack("sidechain", "audio")],
      clips: [media("clip", "source")], transitions: [], markers: [],
    }],
  };
}

test("playback prepares only visible video and warms at most two upcoming sources", () => {
  const doc = document(), sequence = doc.sequences[0]!;
  const current = sequence.clips[0]!, second = media("second", "alternate"), third = media("third", "unused");
  second.start = 240000;
  third.start = 480000;
  sequence.clips.push(second, third);
  const names = (time: number) => {
    const plan = editorPreviewVideoPlan(doc, "main", time);
    return { current: plan.current.map((asset) => asset.id), upcoming: plan.upcoming.map((asset) => asset.id) };
  };
  assert.deepEqual(names(0), { current: ["source"], upcoming: ["alternate", "unused"] });
  assert.deepEqual(names(240000), { current: ["alternate"], upcoming: ["unused"] });
  assert.deepEqual(names(720000), names(0), "Replay from the sequence end prepares its opening frame");
  current.assetId = "image";
  current.timeMap = { points: [{ time: 0, source: 0 }, { time: current.duration, source: 0 }] };
  assert.deepEqual(names(0), { current: [], upcoming: ["alternate", "unused"] });
  sequence.tracks[0]!.hidden = true;
  assert.deepEqual(names(0), { current: [], upcoming: [] });
});

test("playback preparation follows visible nested and transition video endpoints", () => {
  const doc = document(), main = doc.sequences[0]!, child = structuredClone(main);
  child.id = "child";
  const { assetId: _assetId, ...base } = media("nested", "source");
  main.clips = [{ ...base, kind: "sequence", sequenceId: "child" }];
  doc.sequences.push(child);
  assert.deepEqual(editorPreviewVideoPlan(doc, "main", 0).current.map((asset) => asset.id), ["source"]);
  main.clips = [media("first", "source"), { ...media("second", "alternate"), start: 192000 }];
  main.transitions = [{ id: "mix", fromClipId: "first", toClipId: "second", start: 192000, duration: 48000, kind: "dissolve" }];
  assert.deepEqual(editorPreviewVideoPlan(doc, "main", 216000).current.map((asset) => asset.id).sort(), ["alternate", "source"]);
});

test("playback keys ignore visual edits and labels while source identity remains stable", () => {
  const before = document(), after = structuredClone(before), sequence = after.sequences[0]!, clip = sequence.clips[0]!;
  after.revision++;
  after.name = "Renamed project";
  after.assets[0]!.name = "Renamed source";
  after.assets[0]!.width = 1920;
  after.assets[0]!.height = 1080;
  after.assets[0]!.metadata = { editorInspection: { checked: true } };
  sequence.name = "Renamed sequence";
  sequence.width = 1920;
  sequence.height = 1080;
  sequence.background = "#112233";
  sequence.tracks[0]!.name = "Renamed track";
  clip.label = "Renamed clip";
  clip.transform.x = 0.25;
  clip.color.brightness = 0.2;
  sequence.clips.push({
    id: "caption", kind: "text", role: "subtitle", label: "Caption", trackId: "text", start: 0, duration: 120000,
    text: "Corrected caption", words: [], style: defaultTextStyle(), ...visual(),
  });
  sequence.markers.push({ id: "note", time: 0, duration: 0, name: "Review", note: "note", color: "#ff0000" });
  assert.equal(editorAudioContentKey(after, "main"), editorAudioContentKey(before, "main"));
  assert.equal(editorVisualSourceKey(after, "main"), editorVisualSourceKey(before, "main"));
});

for (const change of ["resource", "fingerprint", "source-duration", "volume", "pan", "fade", "track-mute", "timing", "time-map", "ducking"] as const) {
  test(`audio content changes for ${change}, including replacement bytes under the same asset ID`, () => {
    const before = document(), after = structuredClone(before), clip = after.sequences[0]!.clips[0] as MediaClip;
    if (change === "resource") after.assets[0]!.resourceId = "replacement-resource";
    if (change === "fingerprint") after.assets[0]!.fingerprint = "2".repeat(64);
    if (change === "source-duration") after.assets[0]!.duration++;
    if (change === "volume") clip.audio.volume = 0.5;
    if (change === "pan") clip.audio.pan = 0.5;
    if (change === "fade") clip.audio.fadeIn = 12000;
    if (change === "track-mute") after.sequences[0]!.tracks[0]!.muted = true;
    if (change === "timing") clip.start = 8000;
    if (change === "time-map") clip.timeMap = constantTimeMap(8000, clip.duration + 8000).timeMap;
    if (change === "ducking") clip.audio.ducking = { sidechainTrackIds: ["sidechain"], thresholdDb: -24, attenuationDb: 12, attack: 2400, release: 24000 };
    assert.notEqual(editorAudioContentKey(after, "main"), editorAudioContentKey(before, "main"));
  });
}

test("solo muting changes the audio recipe without changing source decoder identity", () => {
  const before = document(), second = media("other", "alternate");
  second.trackId = "sound";
  before.sequences[0]!.tracks.push(createTrack("sound", "audio"));
  before.sequences[0]!.clips.push(second);
  const solo = trackAuditionDocument(before, "main", new Set(["video"]));
  assert.notEqual(editorAudioContentKey(solo, "main"), editorAudioContentKey(before, "main"));
  assert.equal(editorVideoSourceKey(solo, "main"), editorVideoSourceKey(before, "main"));
});

test("source keys follow nested sequences and every multicam angle, ignoring unrelated library assets", () => {
  const before = document(), main = before.sequences[0]!, child = structuredClone(main);
  child.id = "child";
  const { assetId: _assetId, ...base } = media("camera", "source");
  const camera: MulticamClip = {
    ...base, kind: "multicam", angles: [
      { id: "a", assetId: "source", name: "Camera A", offset: 0 },
      { id: "b", assetId: "alternate", name: "Camera B", offset: 0 },
    ], audioAngleId: "a", switches: [{ time: 0, angleId: "a" }],
  };
  child.clips = [camera];
  const nested: SequenceClip = { ...base, id: "nested", kind: "sequence", sequenceId: "child" };
  main.clips = [nested];
  before.sequences.push(child);
  const replaced = structuredClone(before);
  replaced.assets.find((asset) => asset.id === "alternate")!.resourceId = "new-angle";
  assert.notEqual(editorVideoSourceKey(replaced, "main"), editorVideoSourceKey(before, "main"));
  assert.equal(editorAudioContentKey(replaced, "main"), editorAudioContentKey(before, "main"), "An inactive audio angle does not change the mix");
  const unused = structuredClone(before);
  unused.assets.find((asset) => asset.id === "unused")!.resourceId = "new-unused-source";
  unused.assets.reverse();
  assert.equal(editorVideoSourceKey(unused, "main"), editorVideoSourceKey(before, "main"));
  assert.equal(editorAudioContentKey(unused, "main"), editorAudioContentKey(before, "main"));
});

test("image replacement invalidates media decoders without invalidating the audio or video recipe", () => {
  const before = document(), image = media("still", "image");
  image.trackId = "overlay";
  before.sequences[0]!.tracks.push(createTrack("overlay", "video"));
  image.timeMap = { points: [{ time: 0, source: 0 }, { time: image.duration, source: 0 }] };
  before.sequences[0]!.clips.push(image);
  const after = structuredClone(before);
  after.assets.find((asset) => asset.id === "image")!.resourceId = "image-two";
  assert.equal(editorVideoSourceKey(after, "main"), editorVideoSourceKey(before, "main"));
  assert.equal(editorAudioContentKey(after, "main"), editorAudioContentKey(before, "main"));
  assert.notEqual(editorVisualSourceKey(after, "main"), editorVisualSourceKey(before, "main"));
  assert.notEqual(editorSourceContentKey({ ...before.assets[0]!, resourceId: "a:b", fingerprint: "c" }),
    editorSourceContentKey({ ...before.assets[0]!, resourceId: "a", fingerprint: "b:c" }));
});

test("changing the installed demo narration discriminator cannot reuse the old built-in sound", () => {
  const before = document();
  before.assets[0] = { id: "demo-narration-v1", name: "示例旁白 · 从想法，到成片。", kind: "audio", duration: 24 * 240000, metadata: { mimeType: "audio/mpeg" } };
  (before.sequences[0]!.clips[0] as MediaClip).assetId = "demo-narration-v1";
  before.sequences[0]!.clips[0]!.trackId = "sidechain";
  const after = structuredClone(before);
  after.assets[0]!.name = "Ordinary unbound audio";
  assert.notEqual(editorAudioContentKey(after, "main"), editorAudioContentKey(before, "main"));
});
