import assert from "node:assert/strict";
import { test } from "node:test";
import { compileAudioPlan } from "../apps/video-studio/src/editor/audio-plan";
import { liveAudioUnsupported, resolveLivePreviewAudio } from "../apps/video-studio/src/editor/live-audio";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { constantTimeMap, freezeTimeMap } from "../apps/video-studio/src/editor/time";
import type { EditorDocument, MediaClip, TimeMap } from "../apps/video-studio/src/editor/types";

const T = 240000;
function clip(id: string, start: number, timeMap: TimeMap, duration: number): MediaClip {
  return {
    id,
    kind: "media",
    label: id,
    trackId: "sound",
    start,
    duration,
    assetId: "voice",
    timeMap,
    audio: defaultAudioMix(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
}
function plain(id: string, start = 0, seconds = 2): MediaClip {
  const map = constantTimeMap(0, seconds * T);
  return clip(id, start, map.timeMap, map.duration);
}
function plan(...clips: MediaClip[]) {
  const document: EditorDocument = {
    schemaVersion: 2,
    timebase: T,
    id: "doc",
    name: "Live",
    revision: 0,
    assets: [{ id: "voice", name: "Voice", kind: "audio", duration: 10 * T }],
    activeSequenceId: "main",
    exportProfiles: [],
    sequences: [
      {
        id: "main",
        name: "main",
        width: 1280,
        height: 720,
        frameRate: { numerator: 30, denominator: 1 },
        background: "#000000",
        timelineMode: "free",
        tracks: [createTrack("sound", "audio"), createTrack("music", "audio")],
        clips,
        transitions: [],
        markers: [],
      },
    ],
  };
  return compileAudioPlan(document, "main");
}

test("forward clips with volume, pan and fade automation mix live", () => {
  const voice = plain("voice");
  voice.audio.volume = { keyframes: [{ time: 0, value: 1, easing: "linear" }, { time: T, value: 0.2, easing: "linear" }] };
  voice.audio.pan = 0.4;
  voice.audio.fadeIn = T / 4;
  voice.audio.fadeOut = T / 4;
  const later = plain("later", 3 * T);
  later.trackId = "music";
  assert.equal(liveAudioUnsupported(plan(voice, later)), undefined);
  // A held picture is silent and needs no live source.
  assert.equal(liveAudioUnsupported(plan(clip("hold", 0, freezeTimeMap(T, 2 * T), 2 * T))), undefined);
});

test("speed changes, reverse, pitch and ducking keep the prerendered mix", () => {
  const fast = constantTimeMap(0, 4 * T, 2);
  assert.match(liveAudioUnsupported(plan(clip("fast", 0, fast.timeMap, fast.duration)))!, /变速/);
  const reverse = constantTimeMap(2 * T, 0);
  assert.match(liveAudioUnsupported(plan(clip("reverse", 0, reverse.timeMap, reverse.duration)))!, /倒放/);
  const pitched = plain("pitched");
  pitched.audio.pitchSemitones = 3;
  assert.match(liveAudioUnsupported(plan(pitched))!, /变调/);
  const bed = plain("bed");
  bed.trackId = "music";
  bed.audio.ducking = { sidechainTrackIds: ["sound"], thresholdDb: -24, attenuationDb: 12, attack: 100, release: 200 };
  assert.match(liveAudioUnsupported(plan(plain("voice"), bed))!, /压低背景声/);
});

test("live sources resolve once per audible asset and any unavailable source keeps the prepared mix", async () => {
  const voice = plain("voice"), again = plain("again", 3 * T), muted = plain("muted", 6 * T);
  muted.audio.volume = 0;
  const resolved: string[] = [],
    signal = new AbortController().signal,
    resolve = async (id: string) => (resolved.push(id), `/media/${id}`);
  const live = await resolveLivePreviewAudio(plan(voice, again, muted), resolve, signal, async () => true);
  assert.deepEqual([...live!.sources], [["voice", "/media/voice"]]);
  assert.deepEqual(resolved, ["voice"]);
  assert.equal(await resolveLivePreviewAudio(plan(voice), resolve, signal, async () => false), undefined);
  const missing = async () => { throw new Error("请重新连接素材"); };
  assert.equal(await resolveLivePreviewAudio(plan(voice), missing, signal, async () => true), undefined);
  const reverse = constantTimeMap(2 * T, 0);
  assert.equal(
    await resolveLivePreviewAudio(plan(clip("reverse", 0, reverse.timeMap, reverse.duration)), resolve, signal, async () => true),
    undefined,
  );
});
