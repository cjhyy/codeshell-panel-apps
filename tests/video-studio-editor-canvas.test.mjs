import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
let browser, source, css;
before(async () => {
  source = (
    await build({
      stdin: {
        contents: `export { EditorCanvas } from './apps/video-studio/src/editor/canvas-ui'; export { EditorPreview } from './apps/video-studio/src/editor/preview'; export { EditorSession } from './apps/video-studio/src/editor/session'; export * from './apps/video-studio/src/editor/defaults'; export * from './apps/video-studio/src/editor/canvas-edits'; export * from './apps/video-studio/src/editor/visual-layout';`,
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      },
      bundle: true,
      write: false,
      format: "iife",
      globalName: "api",
      platform: "browser",
      target: "chrome120",
    })
  ).outputFiles[0].text;
  css = await readFile(
    new URL("../apps/video-studio/public/editor-workspace.css", import.meta.url),
    "utf8",
  );
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});
async function fixture(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const uncaught = [];
  page.on("pageerror", (error) => uncaught.push(String(error)));
  t.after(async () => {
    await page.close();
    assert.deepEqual(uncaught, []);
  });
  await page.route("http://127.0.0.1:40173/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><style>body{margin:0}.wrap{position:relative;margin:70px 30px;width:640px;height:480px}canvas{width:100%;height:100%;object-fit:contain}</style><div class="wrap"><canvas></canvas></div>',
    }),
  );
  await page.goto("http://127.0.0.1:40173/");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: source });
  await page.evaluate(async (options) => {
    const asset = {
      id: "image",
      kind: "image",
      name: "双色测试图片",
      duration: 0,
      width: 320,
      height: 180,
      resourceId: "source-image",
    };
    const clip = {
      id: "picture",
      kind: "media",
      trackId: "video",
      label: "图片",
      assetId: asset.id,
      start: 0,
      duration: 960000,
      timeMap: {
        points: [
          { time: 0, source: 0 },
          { time: 960000, source: 0 },
        ],
      },
      audio: api.defaultAudioMix(),
      transform: {
        ...api.defaultTransform(),
        scaleX: 0.5,
        scaleY: 0.5,
        ...(options.animated
          ? {
              x: {
                keyframes: [
                  { time: 0, value: 0, easing: "ease-in" },
                  { time: 480000, value: 0.2, easing: "hold" },
                ],
              },
            }
          : {}),
      },
      color: api.defaultColorAdjustment(),
      blendMode: "normal",
      ...(options.mask
        ? {
            mask: {
              kind: options.mask,
              x: 0,
              y: 0,
              width: 0.8,
              height: 0.8,
              rotation: 0,
              feather: 0,
              inverted: false,
              ...(options.mask === "path"
                ? {
                    points: [
                      { x: 0, y: 0 },
                      { x: 1, y: 0 },
                      { x: 1, y: 1 },
                      { x: 0, y: 1 },
                    ],
                  }
                : {}),
            },
          }
        : {}),
    };
    const documentValue = {
      schemaVersion: 2,
      timebase: 240000,
      id: "canvas-doc",
      name: "画布测试",
      revision: 1,
      assets: [asset],
      activeSequenceId: "main",
      exportProfiles: [],
      sequences: [
        {
          id: "main",
          name: "Main",
          width: 320,
          height: 180,
          frameRate: { numerator: 30, denominator: 1 },
          background: "#000000",
          timelineMode: "free",
          tracks: [
            { ...api.createTrack("video", "video"), locked: !!options.locked },
            ...(options.text ? [api.createTrack("text", "text")] : []),
          ],
          clips: [
            clip,
            ...(options.text
              ? [
                  {
                    id: "title",
                    kind: "text",
                    role: "title",
                    label: "独立标题",
                    trackId: "text",
                    start: 0,
                    duration: 960000,
                    text: "独立标题",
                    words: [],
                    style: {
                      ...api.defaultTextStyle(),
                      fontSize: 24,
                      background: "#222222",
                      padding: 4,
                    },
                    transform: { ...api.defaultTransform(), y: -0.3 },
                    color: api.defaultColorAdjustment(),
                    blendMode: "normal",
                  },
                ]
              : []),
          ],
          transitions: [],
          markers: [],
        },
      ],
    };
    let stored = structuredClone(documentValue),
      storedRevision = 1,
      selected = [options.text ? "title" : "picture"],
      time = 0,
      revision = "",
      controls;
    const errors = [],
      writes = [];
    let resolves = 0;
    const session = await api.EditorSession.open(
      {
        read: async () => ({ data: stored, revision: storedRevision }),
        write: async (doc, base, label) => {
          assertBase(base);
          stored = structuredClone(doc);
          writes.push(label);
          return { revision: ++storedRevision };
        },
      },
      {},
    );
    function assertBase(base) {
      if (base !== storedRevision) throw Error("storage conflict");
    }
    const preview = new api.EditorPreview(document.querySelector("canvas"), {
      resolveAsset: () => {
        resolves++;
        return (
          "data:image/svg+xml," +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="160" height="180" fill="#f00"/><rect x="160" width="160" height="180" fill="#00f"/></svg>',
          )
        );
      },
      onFrame: (value) => {
        time = value;
        controls?.render();
      },
    });
    preview.setDocument(session.read());
    await preview.seek(0);
    controls = new api.EditorCanvas(document.querySelector("canvas"), {
      read: () => session.read(),
      identity: () => session.getState().identity,
      selection: () => ({ sequenceId: "main", clipIds: selected }),
      time: () => time,
      select: (ids) => {
        selected = ids;
      },
      pause: () => preview.pause(),
      apply: (ops, label) => session.dispatch(ops, session.getState().identity, label),
      draft: (doc) => (doc ? preview.previewDraft(doc) : preview.seek(time)),
      onError: (error) => errors.push(String(error)),
    });
    session.subscribe((state) => {
      const key = JSON.stringify(state.identity);
      if (key === revision) return;
      revision = key;
      preview.setDocument(session.read());
      controls.render();
      void preview.seek(time).catch((error) => errors.push(String(error)));
    });
    globalThis.f = {
      read: () => session.read(),
      stored: () => stored,
      writes,
      errors,
      resolves: () => resolves,
      undo: () => session.undo(),
      redo: () => session.redo(),
      flush: () => session.flush(),
      mutate: () =>
        session.dispatch(
          [{ type: "project.rename", name: "外部改名" }],
          session.getState().identity,
          "外部编辑",
        ),
      cancel: () => controls.cancel(),
      dispose: () => {
        controls.dispose();
        return preview.dispose();
      },
      pixel: (x, y) => [
        ...document.querySelector("canvas").getContext("2d").getImageData(x, y, 1, 1).data,
      ],
      seek: async (value) => {
        time = value;
        await preview.seek(value);
        controls.render();
      },
    };
  }, options);
  await settle(page);
  return page;
}
const settle = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function drag(page, locator, dx, dy, beforeUp) {
  const box = await locator.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 4 });
  await settle(page);
  if (beforeUp) await beforeUp();
  await page.mouse.up();
  await settle(page);
}
const handle = (page, name) => page.locator(`[data-canvas-handle="${name}"]`);
test("canvas drag previews real pixels without publishing candidates or reopening the image, then commits once and undoes", async (t) => {
  const page = await fixture(t);
  const before = await page.evaluate(() => f.read());
  const beforePixel = await page.evaluate(() => f.pixel(95, 90));
  assert.deepEqual(beforePixel, [255, 0, 0, 255]);
  const imageResolves = await page.evaluate(() => f.resolves());
  await drag(page, handle(page, "move"), 80, 0, async () => {
    assert.deepEqual(await page.evaluate(() => f.read()), before);
    assert.deepEqual(await page.evaluate(() => f.pixel(95, 90)), [0, 0, 0, 255]);
    assert.equal(await page.evaluate(() => f.resolves()), imageResolves);
  });
  const after = await page.evaluate(() => f.read());
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.sequences[0].clips[0].transform.x, 0.125);
  await page.evaluate(() => f.flush());
  assert.equal(await page.evaluate(() => f.stored().sequences[0].clips[0].transform.x), 0.125);
  await page.evaluate(() => f.undo());
  await settle(page);
  assert.deepEqual(await page.evaluate(() => f.pixel(95, 90)), [255, 0, 0, 255]);
});
test("Escape cancels a candidate and concurrent session edits cannot be overwritten by pointerup", async (t) => {
  const page = await fixture(t);
  const before = await page.evaluate(() => f.read());
  await drag(page, handle(page, "move"), 70, 30, async () => {
    await page.keyboard.press("Escape");
  });
  assert.deepEqual(await page.evaluate(() => f.read()), before);
  assert.deepEqual(await page.evaluate(() => f.pixel(95, 90)), [255, 0, 0, 255]);
  await drag(page, handle(page, "move"), 90, 0, async () => {
    await page.evaluate(() => f.mutate());
  });
  const changed = await page.evaluate(() => f.read());
  assert.equal(changed.name, "外部改名");
  assert.equal(changed.revision, before.revision + 1);
  assert.equal(changed.sequences[0].clips[0].transform.x, 0);
});
test("scale handles and source-aware crop alter the actual composited image", async (t) => {
  const page = await fixture(t);
  await drag(page, handle(page, "se"), 80, 45);
  let transform = await page.evaluate(() => f.read().sequences[0].clips[0].transform);
  assert.ok(Math.abs(transform.scaleX - 0.75) < 0.01);
  assert.ok(Math.abs(transform.scaleY - 0.75) < 0.01);
  await page.evaluate(() => f.undo());
  await settle(page);
  await page.getByRole("button", { name: "画布裁切工具" }).click();
  await drag(page, handle(page, "left"), 160, 0);
  transform = await page.evaluate(() => f.read().sequences[0].clips[0].transform);
  assert.ok(Math.abs(transform.crop.left - 0.5) < 0.01);
  const pixels = await page.evaluate(() => [f.pixel(145, 90), f.pixel(180, 90)]);
  assert.deepEqual(pixels, [
    [0, 0, 255, 255],
    [0, 0, 255, 255],
  ]);
});
test("masked layer supports real polygon vertex edits and a single undo", async (t) => {
  const page = await fixture(t, { mask: "path" });
  const before = await page.evaluate(() => f.read());
  assert.deepEqual(await page.evaluate(() => f.pixel(105, 60)), [255, 0, 0, 255]);
  await page.getByRole("button", { name: "画布蒙版工具" }).click();
  await drag(page, handle(page, "point-0"), 70, 35);
  const after = await page.evaluate(() => f.read());
  const point = after.sequences[0].clips[0].mask.points[0];
  assert.ok(point.x > 0.25 && point.x < 0.3);
  assert.ok(point.y > 0.2 && point.y < 0.3);
  assert.deepEqual(await page.evaluate(() => f.pixel(105, 60)), [0, 0, 0, 255]);
  assert.equal(after.revision, before.revision + 1);
  await page.evaluate(() => f.undo());
  assert.deepEqual(
    await page.evaluate(() => f.read().sequences[0].clips[0].mask),
    before.sequences[0].clips[0].mask,
  );
});
test("animated drag changes only the playhead key and preserves later easing, while locked tracks reject pointer and keyboard edits", async (t) => {
  const page = await fixture(t, { animated: true });
  await drag(page, handle(page, "move"), 64, 0);
  const keys = await page.evaluate(() => f.read().sequences[0].clips[0].transform.x.keyframes);
  assert.deepEqual(keys, [
    { time: 0, value: 0.1, easing: "ease-in" },
    { time: 480000, value: 0.2, easing: "hold" },
  ]);
  const locked = await fixture(t, { locked: true });
  const before = await locked.evaluate(() => f.read());
  await drag(locked, handle(locked, "move"), 90, 0);
  await locked.locator(".editor-canvas-controls").focus();
  await locked.keyboard.press("ArrowRight");
  assert.deepEqual(await locked.evaluate(() => f.read()), before);
  assert.ok((await locked.evaluate(() => f.errors)).every((message) => /锁定/.test(message)));
});

test("rotation handle follows the displayed center and rotates actual source pixels by ninety degrees", async (t) => {
  const page = await fixture(t);
  const circle = await handle(page, "rotate").boundingBox(),
    box = await page.locator(".editor-canvas-controls").boundingBox();
  const start = { x: circle.x + circle.width / 2, y: circle.y + circle.height / 2 },
    center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(center.x + center.y - start.y, center.y + start.x - center.x, { steps: 5 });
  await page.mouse.up();
  await settle(page);
  assert.ok(
    Math.abs((await page.evaluate(() => f.read().sequences[0].clips[0].transform.rotation)) - 90) <
      0.01,
  );
  assert.deepEqual(await page.evaluate(() => [f.pixel(160, 50), f.pixel(160, 130)]), [
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
});

test("text selection follows measured content and lets the user select a lower picture outside the title", async (t) => {
  const page = await fixture(t, { text: true });
  const textBox = await handle(page, "move").boundingBox();
  const canvasBox = await page.locator(".editor-canvas-controls").boundingBox();
  assert.ok(textBox.width < canvasBox.width * 0.5);
  assert.ok(textBox.height < canvasBox.height * 0.4);
  await page.screenshot({ path: "/tmp/video-studio-canvas-text-controls.png" });
  await page.mouse.click(
    canvasBox.x + canvasBox.width * 0.35,
    canvasBox.y + canvasBox.height * 0.55,
  );
  assert.equal(
    await page.locator(".editor-canvas-controls").getAttribute("data-clip-id"),
    "picture",
  );
  assert.equal((await page.evaluate(() => f.read())).revision, 1);
});
