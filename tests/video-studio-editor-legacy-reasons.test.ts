import assert from "node:assert/strict";
import test from "node:test";
import { validateProject } from "../apps/video-studio/src/model";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { projectLegacyView } from "../apps/video-studio/src/editor/legacy-adapter";
import {
  legacyClipIssue,
  legacyRestrictionReasons,
  userFacingMessage,
} from "../apps/video-studio/src/editor/legacy-reasons";
import { formatFrameRate } from "../apps/video-studio/src/editor/time";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { validateEditorDocument } from "../apps/video-studio/src/editor/validation";
import type { EditorDocument, MediaClip } from "../apps/video-studio/src/editor/types";

const F = 8000;

function overlay(id: string, trackId: string, start: number, duration: number): MediaClip {
  return {
    id,
    kind: "media",
    label: id,
    trackId,
    assetId: "video",
    start,
    duration,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: duration, source: duration },
      ],
    },
    audio: defaultAudioMix(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  } as MediaClip;
}

/** Real footage: an off-frame main clip, a second picture track and a clip with volume automation. */
function realMultitrack(): EditorDocument {
  const doc = structuredClone(
    migrateLegacyProject(
      validateProject({
        schemaVersion: 1,
        id: "reasons-project",
        name: "限制说明",
        revision: 2,
        width: 1280,
        height: 720,
        fps: 30,
        timelineMode: "free",
        assets: [
          { id: "video", name: "实拍.mp4", kind: "video", durationFrames: 900, width: 1280, height: 720 },
        ],
        clips: [
          { id: "loud", assetId: "video", inFrame: 0, outFrame: 90, startFrame: 0, volume: 1 },
          { id: "real", assetId: "video", inFrame: 100, outFrame: 190, startFrame: 200, volume: 1 },
        ],
        captions: [],
      }),
    ),
  );
  const sequence = doc.sequences.find((item) => item.id === doc.activeSequenceId)!;
  const real = sequence.clips.find((clip) => clip.id === "real") as MediaClip;
  real.duration += 1001;
  real.timeMap.points[1] = { time: real.duration, source: real.timeMap.points[0]!.source + real.duration };
  (sequence.clips.find((clip) => clip.id === "loud") as MediaClip).audio.volume = {
    keyframes: [
      { time: 0, value: 0.4 },
      { time: 90 * F, value: 1.4 },
    ],
  };
  sequence.tracks.push(createTrack("picture-in-picture", "video", "画中画"));
  sequence.clips.push(overlay("pip", "picture-in-picture", 0, 60 * F));
  return validateEditorDocument(doc);
}

test("restriction codes become plain reasons, once each, excluded rows only by default", () => {
  const view = projectLegacyView(realMultitrack());
  assert.equal(view.timelineComplete, false, "Real footage is not a whole number of old frames");
  const reasons = legacyRestrictionReasons(view.restrictions);
  assert.deepEqual(reasons, ["包含变速或非整帧时间", "包含附加画面轨或文字"]);
  assert.ok(
    legacyRestrictionReasons(view.restrictions, { all: true }).includes(
      "包含音量自动化或超过 200% 的音量",
    ),
  );
  for (const code of ["primary-overlap", "clip-kind", "caption-range", "unknown-code"])
    assert.doesNotMatch(
      legacyRestrictionReasons([{ code, message: "旧视图内部说明", excluded: true }])[0]!,
      /旧|新版|视图|流程/,
    );
  assert.deepEqual(
    legacyRestrictionReasons([
      { code: "time-map", message: "", clipId: "a", excluded: true },
      { code: "time-map", message: "", clipId: "b", excluded: true },
    ]),
    ["包含变速或非整帧时间"],
  );
});

test("a clip the old inspector cannot show or write explains why before any click", () => {
  const view = projectLegacyView(realMultitrack());
  assert.deepEqual(legacyClipIssue(view, "real"), {
    excluded: true,
    reason: "包含变速或非整帧时间",
  });
  assert.deepEqual(legacyClipIssue(view, "pip"), {
    excluded: true,
    reason: "包含附加画面轨或文字",
  });
  assert.deepEqual(legacyClipIssue(view, "loud"), {
    excluded: false,
    reason: null,
    volume: "包含音量自动化或超过 200% 的音量",
  });
  assert.equal(legacyClipIssue(view, "missing"), null);
});

test("compatibility refusals reach people as plain copy; ordinary messages stay unchanged", () => {
  for (const message of [
    "旧视图未包含全部片段，无法安全删除、移动或裁剪现有时间线；请使用新版时间线工具",
    "旧流程不能安全延长或滑移包含动画、淡化、绑定或转场的新版片段，请使用新版时间线",
    "此片段的自动化音量需要在新版属性面板中修改",
    "旧流程的基础视图已变化，请刷新后重试",
    "片段「a」包含变速、倒放或定格，旧方案无法按源素材帧编辑，请使用新版方案格式",
    "当前旧视图不完整，不能通过旧流程切换时间线模式",
  ]) {
    const plain = userFacingMessage(message);
    assert.doesNotMatch(plain, /旧视图|旧流程|旧投影|新版时间线|新版片段|新版属性|新版方案/, plain);
    assert.ok(plain.length > 6, plain);
  }
  assert.match(userFacingMessage("此片段的自动化音量需要在新版属性面板中修改"), /属性面板/);
  assert.equal(userFacingMessage("请先重连缺失的素材"), "请先重连缺失的素材");
  assert.equal(
    userFacingMessage("分阶段自动制作需要新版 CodeShell 桌面工作台"),
    "分阶段自动制作需要新版 CodeShell 桌面工作台",
  );
});

test("frame rates read as people write them", () => {
  assert.equal(formatFrameRate({ numerator: 30000, denominator: 1001 }), "29.97");
  assert.equal(formatFrameRate({ numerator: 24000, denominator: 1001 }), "23.976");
  assert.equal(formatFrameRate({ numerator: 30, denominator: 1 }), "30");
  assert.equal(formatFrameRate({ numerator: 50, denominator: 2 }), "25");
});
