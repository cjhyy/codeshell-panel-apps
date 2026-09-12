import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOperations,
  createDemoProject,
  exportSrt,
  validateProject,
  type CaptionStyle,
  type EditOperation,
} from "../apps/video-studio/src/model.ts";
import { renderCaptionControls } from "../apps/video-studio/src/caption-controls.ts";

test("caption templates round trip without changing legacy projects, source timing or SRT", () => {
  const legacy = createDemoProject();
  assert.equal(Object.hasOwn(validateProject(legacy), "captionStyle"), false);
  const original = JSON.stringify(legacy),
    srt = exportSrt(legacy);
  for (const captionStyle of ["classic", "bold", "minimal"] as CaptionStyle[]) {
    const changed = applyOperations(legacy, [{ type: "settings", captionStyle }], legacy.revision);
    assert.equal(changed.captionStyle, captionStyle);
    assert.equal(changed.revision, legacy.revision + 1);
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(changed))), changed);
    assert.deepEqual(changed.captions, legacy.captions);
    assert.equal(exportSrt(changed), srt);
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

test("caption style controls expose only the three named templates and restore their selection", () => {
  const project = createDemoProject();
  assert.match(renderCaptionControls(project), /id="caption-style"/);
  assert.match(renderCaptionControls(project), /value="classic" selected/);
  for (const style of ["classic", "bold", "minimal"] as CaptionStyle[]) {
    const html = renderCaptionControls({
      ...project,
      captionStyle: style,
      name: "<script>unsafe()</script>",
    });
    assert.equal((html.match(/<option /g) ?? []).length, 3);
    assert.match(html, new RegExp(`value="${style}" selected`));
    assert.equal(html.includes("unsafe"), false);
  }
});
