import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
let browser, moduleCode, css;
const errors = [];

before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { createTimelineContextMenu } from "./apps/video-studio/src/timeline-context-menu";
        import { applyOperations } from "./apps/video-studio/src/model";
        let project = {schemaVersion: 1, name: "菜单测试", width: 1920, height: 1080, fps: 30, captions: [], id: "timeline-menu-fixture", revision: 4,
          assets: [{ id: "video", kind: "video", name: "A & <video>.mp4", durationFrames: 180 },
            { id: "voice", kind: "audio", name: "录音", durationFrames: 60 }],
          clips: [{ id: "first", assetId: "video", inFrame: 0, outFrame: 90, volume: 1 },
            { id: "second", assetId: "video", inFrame: 90, outFrame: 180, volume: 1 }],
          audioClips: [{ id: "audio", assetId: "voice", inFrame: 0, outFrame: 60, startFrame: 30, volume: 1 }]
        };
        let generation = 1, blocked = false;
        const events = [], history = [];
        const menu = createTimelineContextMenu({
          project: () => project, generation: () => generation, canRemove: () => !blocked,
          remove(target) {
            history.push(structuredClone(project));
            events.push(["remove", target.clipId]);
            project = applyOperations(project, [{type: target.kind === "audio" ? "audio-remove" : "remove", clipId: target.clipId}], project.revision);
          },
          restoreFocus(target) { document.querySelector('[data-target="' + target.clipId + '"]')?.focus(); },
          stale() { events.push(["stale"]); }
        });
        window.fixture = { menu, events, history, project: () => project,
          mutate(kind) {
            if (kind === "project") project = {...project, id: "another-project"};
            if (kind === "revision") project = {...project, revision: project.revision + 1};
            if (kind === "generation") generation++;
            if (kind === "removed") project = {...project, clips: project.clips.filter(c => c.id !== "second")};
            if (kind === "blocked") blocked = true;
          }
        };
        document.addEventListener("keydown", event => events.push(["background-key", event.key]));
      `,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "es2022",
  });
  moduleCode = bundle.outputFiles[0].text;
  css = await readFile(resolve(root, "apps/video-studio/public/style.css"), "utf8");
  browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
});

after(async () => {
  await browser?.close();
  assert.deepEqual(errors, []);
});

async function modulePage() {
  const page = await browser.newPage({ viewport: { width: 390, height: 640 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(
    '<button data-target="first">First</button><button data-target="second">Second</button><button data-target="audio">Audio</button><button id="outside">Outside</button>',
  );
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: moduleCode });
  return page;
}
const menu = (page) => page.locator("#timeline-context-menu");
const remove = (page) => page.locator('[data-timeline-menu-action="remove"]');
const cancel = (page) => page.locator('[data-timeline-menu-action="cancel"]');

test("menu module: exact video/audio targets delete once while preserving source media and undo history", async () => {
  for (const id of ["second", "audio"]) {
    const page = await modulePage();
    try {
      const before = await page.evaluate(() => window.fixture.project());
      await page.evaluate((id) => window.fixture.menu.open(id, 389, 639), id);
      const bounds = await menu(page).boundingBox();
      assert.ok(
        bounds.x >= 8 &&
          bounds.y >= 8 &&
          bounds.x + bounds.width <= 382 &&
          bounds.y + bounds.height <= 632,
      );
      assert.match(await menu(page).textContent(), /素材库与原文件保留，可撤销/);
      if (id === "second")
        assert.equal(
          await page.locator(".timeline-context-menu-title").textContent(),
          "A & <video>.mp4",
        );
      await remove(page).click();
      const result = await page.evaluate(() => ({
        project: window.fixture.project(),
        events: window.fixture.events,
        history: window.fixture.history,
      }));
      assert.deepEqual(result.events, [["remove", id]]);
      assert.deepEqual(result.history, [before]);
      assert.deepEqual(result.project.assets, before.assets);
      const clips = id === "audio" ? result.project.audioClips : result.project.clips;
      assert.ok(!clips.some((clip) => clip.id === id));
      assert.equal(await menu(page).count(), 0);
    } finally {
      await page.close();
    }
  }
});

test("menu module: keyboard navigation, cancellation, outside click, scrolling and resize dismiss safely", async () => {
  const page = await modulePage();
  try {
    await page.evaluate(() => window.fixture.menu.open("second", 10, 10));
    assert.equal(
      await remove(page).evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await cancel(page).evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("Home");
    assert.equal(
      await remove(page).evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    assert.equal(await menu(page).count(), 0);
    assert.equal(
      await page
        .locator('[data-target="second"]')
        .evaluate((element) => element === document.activeElement),
      true,
    );
    for (const key of ["Escape", "Tab"]) {
      await page.evaluate(() => window.fixture.menu.open("second", 10, 10));
      await page.keyboard.press("Delete");
      await page.keyboard.press(key);
      assert.equal(await menu(page).count(), 0);
    }
    await page.evaluate(() => window.fixture.menu.open("second", 150, 200));
    await page.locator("#outside").click();
    assert.equal(await menu(page).count(), 0);
    for (const type of ["wheel", "touchmove"]) {
      await page.evaluate(() => window.fixture.menu.open("second", 10, 10));
      await page.evaluate(
        (type) => document.body.dispatchEvent(new Event(type, { bubbles: true })),
        type,
      );
      assert.equal(await menu(page).count(), 0);
    }
    await page.evaluate(() => window.fixture.menu.open("second", 10, 10));
    await page.evaluate(() => document.body.dispatchEvent(new Event("scroll", { bubbles: true })));
    assert.equal(
      await menu(page).isVisible(),
      true,
      "Deferred programmatic scroll must keep the menu actionable",
    );
    await page.setViewportSize({ width: 400, height: 640 });
    await menu(page).waitFor({ state: "detached" });
    assert.deepEqual(await page.evaluate(() => window.fixture.events), []);
  } finally {
    await page.close();
  }
});

test("menu module: stale projects, revisions, generations and deleted clips cannot be activated", async () => {
  for (const mutation of ["project", "revision", "generation", "removed", "blocked"]) {
    const page = await modulePage();
    try {
      await page.evaluate(() => window.fixture.menu.open("second", 10, 10));
      await page.evaluate((kind) => window.fixture.mutate(kind), mutation);
      await remove(page).click();
      assert.deepEqual(
        await page.evaluate(() => window.fixture.events),
        mutation === "blocked" ? [] : [["stale"]],
        mutation,
      );
      assert.deepEqual(await page.evaluate(() => window.fixture.history), []);
      assert.equal(await menu(page).count(), 0);
    } finally {
      await page.close();
    }
  }
});

test("menu module: reconciliation disables pending mutations and closes invalidated targets", async () => {
  const page = await modulePage();
  try {
    await page.evaluate(() => window.fixture.menu.open("second", 10, 10));
    await page.evaluate(() => {
      window.fixture.mutate("blocked");
      window.fixture.menu.reconcile();
    });
    assert.equal(await remove(page).isDisabled(), true);
    await page.evaluate(() => {
      window.fixture.mutate("revision");
      window.fixture.menu.reconcile();
    });
    assert.equal(await menu(page).count(), 0);
    await page.evaluate(() => {
      window.fixture.menu.open("audio", 10, 10);
      window.fixture.menu.destroy();
    });
    assert.equal(await menu(page).count(), 0);
    await page.keyboard.press("Delete");
    assert.deepEqual(await page.evaluate(() => window.fixture.events), [
      ["background-key", "Delete"],
    ]);
  } finally {
    await page.close();
  }
});
