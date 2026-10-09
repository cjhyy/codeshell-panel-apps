import assert from "node:assert/strict";
import { test } from "node:test";
import { browserExportReason } from "../apps/video-studio/src/editor/browser-export";
import { createDemoProject } from "../apps/video-studio/src/model";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { projectLegacyView } from "../apps/video-studio/src/editor/legacy-adapter";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";

test("canonical WebM admits the entire original render-safe audio/visual subset", () => {
  const original = createDemoProject();
  for (const volume of [0, 0.5, 1, 2]) {
    const legacy = structuredClone(original);
    legacy.assets.push({ id: "voice", name: "原声", kind: "audio", durationFrames: 600 });
    legacy.clips[0]!.volume = volume;
    legacy.audioClips = [
      { id: "one", assetId: "voice", startFrame: 0, inFrame: 0, outFrame: 90, volume },
      { id: "two", assetId: "voice", startFrame: 0, inFrame: 30, outFrame: 120, volume },
    ];
    const document = migrateLegacyProject(legacy);
    assert.equal(projectLegacyView(document).renderSafe, true);
    assert.equal(browserExportReason(document, document.activeSequenceId), undefined);
  }
});

test("advanced DSP refusal only applies to audio the old exporter could not render", () => {
  for (const change of ["pitch", "speed", "ducking"] as const) {
    const doc = migrateLegacyProject(createDemoProject()),
      seq = doc.sequences[0]!;
    seq.tracks.push(createTrack("sound", "audio"));
    doc.assets.push({ id: "voice", name: "声音", kind: "audio", duration: 480000 });
    const audio = defaultAudioMix();
    if (change === "pitch") audio.pitchSemitones = 3;
    if (change === "ducking")
      audio.ducking = {
        sidechainTrackIds: [seq.tracks[0]!.id],
        thresholdDb: -20,
        attenuationDb: 6,
        attack: 2400,
        release: 24000,
      };
    seq.clips.push({
      id: "voice-clip",
      kind: "media",
      assetId: "voice",
      trackId: "sound",
      label: "声音",
      start: 0,
      duration: 240000,
      timeMap: {
        points: [
          { time: 0, source: 0 },
          { time: 240000, source: change === "speed" ? 480000 : 240000 },
        ],
      },
      transform: defaultTransform(),
      color: defaultColorAdjustment(),
      blendMode: "normal",
      audio,
    });
    assert.equal(projectLegacyView(doc).renderSafe, false);
    assert.match(browserExportReason(doc, seq.id)!, /原生导出/);
  }
});

test("sub-frame positive sources keep cache/display identities without rounding canonical time", () => {
  for (const duration of [5, 7999, 8000, 8001, 56056]) {
    const doc = migrateLegacyProject(createDemoProject());
    doc.assets.push({
      id: "short",
      name: "短声音",
      kind: "audio",
      duration,
      metadata: { size: 46, mimeType: "audio/wav", lastModified: 1 },
    });
    const original = structuredClone(doc),
      view = projectLegacyView(doc);
    assert.equal(
      view.project.assets.find((asset) => asset.id === "short")!.durationFrames,
      Math.max(1, Math.floor(duration / 8000)),
    );
    assert.equal(
      view.restrictions.some((item) => item.code === "asset-tail" && item.assetId === "short"),
      duration % 8000 !== 0,
    );
    assert.deepEqual(doc, original);
  }
});
