import assert from "node:assert/strict";
import test from "node:test";
import {
  captureTimelineMenuTarget,
  isTimelineMenuTargetCurrent,
} from "../apps/video-studio/src/timeline-context-menu";
import { createProject, type Project } from "../apps/video-studio/src/model";

function fixture(): Project {
  return {
    ...createProject("时间轴菜单"),
    id: "original",
    revision: 5,
    assets: [
      { id: "video", name: "video.mp4", kind: "video", durationFrames: 180 },
      { id: "voice", name: "录音", kind: "audio", durationFrames: 60 },
    ],
    clips: [
      { id: "first", assetId: "video", inFrame: 0, outFrame: 90, volume: 1 },
      { id: "second", assetId: "video", inFrame: 90, outFrame: 180, volume: 1 },
    ],
    audioClips: [
      { id: "audio", assetId: "voice", inFrame: 0, outFrame: 60, startFrame: 30, volume: 1 },
    ],
  };
}

test("menu targets identify timeline segments independently of their shared source", () => {
  const project = fixture();
  const first = captureTimelineMenuTarget(project, "first", 7)!;
  const second = captureTimelineMenuTarget(project, "second", 7)!;
  const audio = captureTimelineMenuTarget(project, "audio", 7)!;
  assert.equal(first.assetId, second.assetId);
  assert.notEqual(first.clipId, second.clipId);
  assert.equal(first.kind, "video");
  assert.equal(audio.kind, "audio");
  assert.ok(Object.isFrozen(second));
  assert.ok(isTimelineMenuTargetCurrent(second, structuredClone(project), 7));
  assert.equal(captureTimelineMenuTarget(project, "missing", 7), undefined);
});

test("old menus cannot act after an edit, project switch, reload, replacement, or removal", () => {
  const project = fixture();
  const target = captureTimelineMenuTarget(project, "second", 7)!;
  const scenarios: [string, Project, number][] = [
    ["edited", { ...project, revision: 6 }, 7],
    ["different project with same clip IDs", { ...project, id: "new-project" }, 7],
    ["reload of same project/revision", project, 8],
    ["removed target", { ...project, clips: project.clips.slice(0, 1) }, 7],
    [
      "same ID with changed source",
      {
        ...project,
        clips: project.clips.map((clip) =>
          clip.id === "second" ? { ...clip, assetId: "voice" } : clip,
        ),
      },
      7,
    ],
    [
      "same ID in another track",
      {
        ...project,
        clips: project.clips.slice(0, 1),
        audioClips: [{ ...project.clips[1]!, startFrame: 0 }],
      },
      7,
    ],
  ];
  for (const [label, current, generation] of scenarios)
    assert.equal(isTimelineMenuTargetCurrent(target, current, generation), false, label);
});

test("an ambiguous cross-track ID is never a menu deletion target", () => {
  const project = fixture();
  project.audioClips!.push({ ...project.clips[1]!, startFrame: 0 });
  assert.equal(captureTimelineMenuTarget(project, "second", 7), undefined);
});
