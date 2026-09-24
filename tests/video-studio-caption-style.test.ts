import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOperations,
  createDemoProject,
  validateProject,
  type CaptionStyle,
  type EditOperation,
} from "../apps/video-studio/src/model.ts";
import {
  CAPTION_PRESETS,
  captionPresetStyle,
  captionTemplate,
  planCaptionPreset,
} from "../apps/video-studio/src/editor/caption-presets.ts";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration.ts";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations.ts";
import { projectLegacyView } from "../apps/video-studio/src/editor/legacy-adapter.ts";
import type { TextClip } from "../apps/video-studio/src/editor/types.ts";

test("caption templates round trip without changing legacy projects or source timing", () => {
  const legacy = createDemoProject();
  assert.equal(Object.hasOwn(validateProject(legacy), "captionStyle"), false);
  const original = JSON.stringify(legacy);
  for (const captionStyle of ["classic", "bold", "minimal"] as CaptionStyle[]) {
    const changed = applyOperations(legacy, [{ type: "settings", captionStyle }], legacy.revision);
    assert.equal(changed.captionStyle, captionStyle);
    assert.equal(changed.revision, legacy.revision + 1);
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(changed))), changed);
    assert.deepEqual(changed.captions, legacy.captions);
  }
  assert.equal(JSON.stringify(legacy), original);
});

test("caption settings reject CSS and invalid templates atomically", () => {
  const project = createDemoProject(),
    original = JSON.stringify(project);
  for (const captionStyle of ["yellow", "color:red", "url(https://example.com)", null, 1, {}]) {
    assert.throws(() => validateProject({ ...project, captionStyle }));
    assert.throws(() =>
      applyOperations(
        project,
        [
          { type: "settings", name: "must not commit" },
          { type: "settings", captionStyle },
        ] as EditOperation[],
        project.revision,
      ),
    );
  }
  assert.equal(JSON.stringify(project), original);
});

test("caption presets expose only the three named templates and match the migrated legacy styles", () => {
  assert.deepEqual(
    CAPTION_PRESETS.map((preset) => [preset.value, preset.label]),
    [
      ["classic", "经典 · 黑底白字"],
      ["bold", "醒目 · 黄字描边"],
      ["minimal", "简洁 · 白字无框"],
    ],
  );
  for (const captionStyle of ["classic", "bold", "minimal"] as CaptionStyle[]) {
    const migrated = migrateLegacyProject({ ...createDemoProject(), captionStyle });
    const sequence = migrated.sequences[0]!;
    const subtitle = sequence.clips.find(
      (clip): clip is TextClip => clip.kind === "text" && clip.role === "subtitle",
    )!;
    assert.deepEqual(captionPresetStyle(sequence, captionStyle), subtitle.style);
    assert.deepEqual(captionTemplate({ ...sequence, captionStyle }).style, subtitle.style);
  }
  assert.throws(() => captionPresetStyle({ width: 640, height: 360 }, "yellow" as any), /字幕样式/);
});

test("a caption preset restyles every subtitle, records the choice and keeps the old projection stable", () => {
  const document = migrateLegacyProject(createDemoProject());
  const sequenceId = document.activeSequenceId;
  for (const preset of ["bold", "minimal", "classic"] as CaptionStyle[]) {
    const next = applyEditorOperations(
      document,
      planCaptionPreset(document, sequenceId, preset),
      document.revision,
    );
    assert.equal(next.production?.legacyCaptionStyle, preset);
    assert.equal(projectLegacyView(next).project.captionStyle, preset);
    assert.deepEqual(projectLegacyView(next).project.captions, projectLegacyView(document).project.captions);
  }
  assert.throws(() => planCaptionPreset(document, sequenceId, "color:red" as any), /字幕样式/);
});
