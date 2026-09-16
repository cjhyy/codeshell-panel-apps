import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

let browser, page;
before(async () => {
  const repository = fileURLToPath(new URL("../", import.meta.url));
  const compiled = await build({
    stdin: {
      contents: `
      export * from "./apps/video-studio/src/editor/compositor";
      export * from "./apps/video-studio/src/editor/defaults";
      export * from "./apps/video-studio/src/editor/color";
      export { evaluateFrame } from "./apps/video-studio/src/editor/evaluate";
      export { migrateLegacyProject } from "./apps/video-studio/src/editor/migration";
      export { createProject } from "./apps/video-studio/src/model";
      export { drawCaptionLayer } from "./apps/video-studio/src/media";
    `,
      resolveDir: repository,
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "editor",
    platform: "browser",
    target: "chrome120",
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  await page.addScriptTag({
    content: `
    globalThis.tools = {
      canvas(w=100,h=100,color) { const c=document.createElement('canvas');c.width=w;c.height=h;
        if(color){const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,w,h);}return c; },
      base(id,patch={}) { return {instanceId:id,sequenceId:'main',clipId:id,trackId:'video',localTime:0,
        blendMode:'normal',...patch,transform:{...editor.defaultTransform(),...(patch.transform||{})},
        color:{...editor.defaultColorAdjustment(),...(patch.color||{})}}; },
      media(id,patch={}) { return {kind:'media',assetId:'same-source',assetKind:'video',sourceTime:0,naturalWidth:100,naturalHeight:100,...this.base(id,patch)}; },
      text(id,text,patch={}) {return {kind:'text',text,role:'title',words:[],activeWordIndices:[],animationProgress:.5,
        ...this.base(id,patch),style:{...editor.defaultTextStyle(),...(patch.style||{})}};},
      shape(id,patch={}) { return {kind:'shape',shape:'rectangle',fill:'#ff0000',stroke:'#00000000',strokeWidth:0,...this.base(id,patch)}; },
      frame(layers,patch={}) { return {sequenceId:'main',time:0,width:100,height:100,background:'#00000000',layers,audio:[],...patch}; },
      transition(from,to,kind='dissolve',progress=.5) {return {kind:'transition',instanceId:'join',sequenceId:'main',trackId:'video',transitionId:'join',transitionKind:kind,progress,from,to};},
      pixel(c,x,y) {return Array.from(c.getContext('2d').getImageData(x,y,1,1).data);},
      draw(frame,media=new Map()) {const canvas=this.canvas();editor.drawEvaluatedFrame(canvas,frame,media);return canvas;},
      mask(patch={}) {return {kind:'rectangle',x:0,y:0,width:1,height:1,rotation:0,feather:0,inverted:false,...patch};},
      stats(c) {const x=c.getContext('2d'),p=x.getImageData(0,0,c.width,c.height).data;let left=c.width,right=-1,top=c.height,bottom=-1,count=0,maxAlpha=0,rows=[];
        for(let y=0;y<c.height;y++){let ink=false;for(let j=0;j<c.width;j++){const a=p[(y*c.width+j)*4+3];if(a){count++;ink=true;left=Math.min(left,j);right=Math.max(right,j);top=Math.min(top,y);bottom=Math.max(bottom,y);maxAlpha=Math.max(maxAlpha,a);}}if(ink)rows.push(y);}
        let groups=0,last=-2;for(const y of rows){if(y>last+1)groups++;last=y;}return {left,right,top,bottom,count,maxAlpha,groups};}
    };
  `,
  });
  await page.evaluate(() => document.fonts.ready);
});
after(async () => {
  await browser?.close();
});

test("neutral transparent groups preserve every source-over pixel without extra alpha rounding", async () => {
  const result = await page.evaluate(() => {
    const layers = [
      tools.shape("a", { fill: "#2383de", transform: { opacity: 0.73 } }),
      tools.shape("b", { fill: "#e14b76", transform: { opacity: 0.38, scaleX: 0.6 } }),
    ];
    const group = {
      ...tools.base("group"),
      kind: "group",
      width: 100,
      height: 100,
      background: "#00000000",
      sourceSequenceId: "child",
      sourceTime: 0,
      layers,
    };
    const flat = tools.draw(tools.frame(layers, { background: "#3050a0" })),
      combined = tools.draw(tools.frame([group], { background: "#3050a0" }));
    return [
      Array.from(flat.getContext("2d").getImageData(0, 0, 100, 100).data),
      Array.from(combined.getContext("2d").getImageData(0, 0, 100, 100).data),
    ];
  });
  assert.equal(Buffer.compare(Buffer.from(result[0]), Buffer.from(result[1])), 0);
});

test("group optimization retains opacity, blend isolation and caption-stack recursion boundaries", async () => {
  const result = await page.evaluate(() => {
    const group = (layers, patch = {}) => ({
      ...tools.base("group", patch),
      kind: "group",
      width: 100,
      height: 100,
      background: "#00000000",
      sourceSequenceId: "child",
      sourceTime: 0,
      layers,
    });
    const opacity = tools.draw(
      tools.frame(
        [
          group([tools.shape("red"), tools.shape("blue", { fill: "#0000ff" })], {
            transform: { opacity: 0.5 },
          }),
        ],
        { background: "#ffffff" },
      ),
    );
    const isolation = tools.draw(
      tools.frame([group([tools.shape("red", { blendMode: "multiply" })])], {
        background: "#0000ff",
      }),
    );
    const inner = tools.text("inner", "内层", { style: { layout: "caption-stack", fontSize: 14 } }),
      outer = tools.text("outer", "外层", { style: { layout: "caption-stack", fontSize: 14 } });
    const actual = tools.draw(tools.frame([group([inner]), outer]));
    const expected = tools.canvas(),
      ctx = expected.getContext("2d");
    ctx.drawImage(tools.draw(tools.frame([inner])), 0, 0);
    ctx.drawImage(tools.draw(tools.frame([outer])), 0, 0);
    const a = actual.getContext("2d").getImageData(0, 0, 100, 100).data,
      b = expected.getContext("2d").getImageData(0, 0, 100, 100).data;
    return {
      opacity: tools.pixel(opacity, 50, 50),
      isolation: tools.pixel(isolation, 50, 50),
      captionsEqual: a.every((value, i) => value === b[i]),
    };
  });
  near(result.opacity, [128, 128, 255, 255]);
  near(result.isolation, [255, 0, 0, 255]);
  assert.equal(result.captionsEqual, true);
});

function near(actual, expected, tolerance = 1) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    assert.ok(Math.abs(value - expected[index]) <= tolerance, `${actual} differs from ${expected}`),
  );
}

test("different timeline instances of one source draw their distinct decoded frames", async () => {
  const value = await page.evaluate(() => {
    const a = tools.media("first", { transform: { x: -0.25, scaleX: 0.5 } }),
      b = tools.media("second", { transform: { x: 0.25, scaleX: 0.5 } });
    const frame = tools.frame([a, b]),
      c = tools.draw(
        frame,
        new Map([
          ["first", tools.canvas(32, 32, "red")],
          ["second", tools.canvas(32, 32, "blue")],
        ]),
      );
    return [tools.pixel(c, 25, 50), tools.pixel(c, 75, 50)];
  });
  near(value[0], [255, 0, 0, 255]);
  near(value[1], [0, 0, 255, 255]);
});

test("crop, fit, scale, rotation and flips share the actual source geometry", async () => {
  const value = await page.evaluate(() => {
    const source = tools.canvas(100, 50, "red"),
      s = source.getContext("2d");
    s.fillStyle = "blue";
    s.fillRect(50, 0, 50, 50);
    const draw = (transform) =>
      tools.draw(tools.frame([tools.media("a", { transform })]), new Map([["a", source]]));
    const contain = draw({}),
      crop = draw({ crop: { left: 0.5, top: 0, right: 0, bottom: 0 } }),
      flip = draw({ flipX: true }),
      rotate = draw({ rotation: 90 }),
      stretch = draw({ fit: "stretch" }),
      cover = draw({ fit: "cover" });
    return {
      contain: [tools.pixel(contain, 50, 10), tools.pixel(contain, 25, 50)],
      crop: [tools.pixel(crop, 10, 10), tools.pixel(crop, 90, 90)],
      flip: [tools.pixel(flip, 25, 50), tools.pixel(flip, 75, 50)],
      rotate: [tools.pixel(rotate, 50, 25), tools.pixel(rotate, 50, 75)],
      stretch: tools.pixel(stretch, 25, 10),
      cover: tools.pixel(cover, 75, 10),
    };
  });
  near(value.contain[0], [0, 0, 0, 0]);
  near(value.contain[1], [255, 0, 0, 255]);
  value.crop.forEach((p) => near(p, [0, 0, 255, 255]));
  near(value.flip[0], [0, 0, 255, 255]);
  near(value.flip[1], [255, 0, 0, 255]);
  near(value.rotate[0], [255, 0, 0, 255]);
  near(value.rotate[1], [0, 0, 255, 255]);
  near(value.stretch, [255, 0, 0, 255]);
  near(value.cover, [0, 0, 255, 255]);
});

test("opacity and layer blend modes retain transparent pixels and stationary lower tracks", async () => {
  const value = await page.evaluate(() => {
    const opacity = tools.draw(tools.frame([tools.shape("red", { transform: { opacity: 0.5 } })]));
    const blends = {};
    for (const mode of ["multiply", "screen", "overlay", "darken", "lighten"]) {
      const c = tools.draw(
        tools.frame([
          tools.shape("red"),
          tools.shape("blue", { fill: "#0000ff", blendMode: mode }),
        ]),
      );
      blends[mode] = tools.pixel(c, 50, 50);
    }
    return { opacity: tools.pixel(opacity, 50, 50), blends };
  });
  near(value.opacity, [255, 0, 0, 128]);
  near(value.blends.multiply, [0, 0, 0, 255]);
  near(value.blends.screen, [255, 0, 255, 255]);
  near(value.blends.overlay, [255, 0, 0, 255]);
  near(value.blends.darken, [0, 0, 0, 255]);
  near(value.blends.lighten, [255, 0, 255, 255]);
});

test("rectangle, ellipse, polygon and linear masks support inversion and normalized feather", async () => {
  const value = await page.evaluate(() => {
    const draw = (mask, transform = {}) =>
      tools.draw(tools.frame([tools.shape("red", { mask: tools.mask(mask), transform })]));
    const rectangle = draw({ width: 0.5 }),
      inverse = draw({ width: 0.5, inverted: true }),
      ellipse = draw({ kind: "ellipse" }),
      path = draw({
        kind: "path",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      }),
      linear = draw({ kind: "linear" }),
      feather = draw({ width: 0.5, feather: 0.1 });
    const originalCoordinates = draw(
      { x: 0.25, width: 0.5 },
      { crop: { left: 0.5, right: 0, top: 0, bottom: 0 } },
    );
    const flippedMask = draw({ x: -0.25, width: 0.5 }, { flipX: true });
    return {
      rectangle: [tools.pixel(rectangle, 10, 50), tools.pixel(rectangle, 50, 50)],
      inverse: [tools.pixel(inverse, 10, 50), tools.pixel(inverse, 50, 50)],
      ellipse: [tools.pixel(ellipse, 2, 2), tools.pixel(ellipse, 50, 50)],
      path: [tools.pixel(path, 10, 10), tools.pixel(path, 90, 90)],
      linear: [
        tools.pixel(linear, 10, 50)[3],
        tools.pixel(linear, 50, 50)[3],
        tools.pixel(linear, 90, 50)[3],
      ],
      feather: [
        tools.pixel(feather, 5, 50)[3],
        tools.pixel(feather, 24, 50)[3],
        tools.pixel(feather, 50, 50)[3],
      ],
      original: tools.pixel(originalCoordinates, 50, 50),
      flip: [tools.pixel(flippedMask, 25, 50), tools.pixel(flippedMask, 75, 50)],
    };
  });
  near(value.rectangle[0], [0, 0, 0, 0]);
  near(value.rectangle[1], [255, 0, 0, 255]);
  near(value.inverse[0], [255, 0, 0, 255]);
  near(value.inverse[1], [0, 0, 0, 0]);
  near(value.ellipse[0], [0, 0, 0, 0]);
  near(value.ellipse[1], [255, 0, 0, 255]);
  near(value.path[0], [255, 0, 0, 255]);
  near(value.path[1], [0, 0, 0, 0]);
  assert.ok(value.linear[0] > 0 && value.linear[0] < 50);
  assert.ok(value.linear[1] > 120 && value.linear[1] < 140);
  assert.ok(value.linear[2] > 220);
  assert.ok(value.feather[0] < 5);
  assert.ok(value.feather[1] > 50 && value.feather[1] < 200);
  assert.ok(value.feather[2] > 250);
  near(value.original, [255, 0, 0, 255]);
  near(value.flip[0], [0, 0, 0, 0]);
  near(value.flip[1], [255, 0, 0, 255]);
});

test("dissolve uses weighted premultiplied colors and honors endpoint opacity and blend modes", async () => {
  const value = await page.evaluate(() => {
    const a = tools.shape("a"),
      b = tools.shape("b", { fill: "#0000ff" });
    const draw = (from, to, background = "#00000000") =>
      tools.draw(tools.frame([tools.transition(from, to)], { background }));
    const opaque = draw(a, b),
      translucent = draw(
        { ...a, transform: { ...a.transform, opacity: 0.5 } },
        { ...b, transform: { ...b.transform, opacity: 0.5 } },
      );
    const lower = draw(
      { ...a, transform: { ...a.transform, opacity: 0.5 } },
      { ...b, transform: { ...b.transform, opacity: 0.5 } },
      "#00ff00",
    );
    const modes = draw({ ...a, blendMode: "multiply" }, { ...b, blendMode: "screen" }, "#ffff00");
    return [
      tools.pixel(opaque, 50, 50),
      tools.pixel(translucent, 50, 50),
      tools.pixel(lower, 50, 50),
      tools.pixel(modes, 50, 50),
    ];
  });
  near(value[0], [128, 0, 128, 255]);
  near(value[1], [128, 0, 128, 128], 2);
  near(value[2], [64, 127, 64, 255], 2);
  near(value[3], [255, 128, 128, 255]);
});

test("black fades, directional wipes and pushes draw distinct transition geometries", async () => {
  const value = await page.evaluate(() => {
    const a = tools.canvas(100, 100, "red"),
      b = tools.canvas(100, 100, "blue");
    a.getContext("2d").fillStyle = "#00ff00";
    a.getContext("2d").fillRect(50, 0, 50, 100);
    b.getContext("2d").fillStyle = "yellow";
    b.getContext("2d").fillRect(50, 0, 50, 100);
    const media = new Map([
        ["a", a],
        ["b", b],
      ]),
      values = {};
    for (const kind of ["fade-black", "wipe-left", "wipe-right", "push-left", "push-right"]) {
      const c = tools.draw(
        tools.frame([tools.transition(tools.media("a"), tools.media("b"), kind)]),
        media,
      );
      values[kind] = [tools.pixel(c, 25, 50), tools.pixel(c, 75, 50)];
    }
    const quarter = tools.draw(
      tools.frame([
        tools.transition(
          tools.shape("red"),
          tools.shape("blue", { fill: "#0000ff" }),
          "fade-black",
          0.25,
        ),
      ]),
    );
    return { values, quarter: tools.pixel(quarter, 50, 50) };
  });
  value.values["fade-black"].forEach((p) => near(p, [0, 0, 0, 255]));
  near(value.quarter, [128, 0, 0, 255]);
  near(value.values["wipe-left"][0], [255, 0, 0, 255]);
  near(value.values["wipe-left"][1], [255, 255, 0, 255]);
  near(value.values["wipe-right"][0], [0, 0, 255, 255]);
  near(value.values["wipe-right"][1], [0, 255, 0, 255]);
  near(value.values["push-left"][0], [0, 255, 0, 255]);
  near(value.values["push-left"][1], [0, 0, 255, 255]);
  near(value.values["push-right"][0], [255, 255, 0, 255]);
  near(value.values["push-right"][1], [255, 0, 0, 255]);
});

test("nested sequences isolate their canvas and apply parent transforms and opacity to the combined result", async () => {
  const value = await page.evaluate(() => {
    const child = tools.shape("child", { transform: { x: -0.25, scaleX: 0.5 } });
    const group = {
      kind: "group",
      sourceSequenceId: "nested",
      sourceTime: 0,
      width: 100,
      height: 50,
      background: "#0000ff",
      layers: [child],
      ...tools.base("group", { transform: { opacity: 0.5, x: 0.1 } }),
    };
    const c = tools.draw(tools.frame([group]));
    return [
      tools.pixel(c, 5, 50),
      tools.pixel(c, 25, 50),
      tools.pixel(c, 85, 50),
      tools.pixel(c, 50, 5),
    ];
  });
  near(value[0], [0, 0, 0, 0]);
  near(value[1], [255, 0, 0, 128]);
  near(value[2], [0, 0, 255, 128]);
  near(value[3], [0, 0, 0, 0]);
});

test("fractional wipe and push boundaries do not introduce translucent seams", async () => {
  const pixels = await page.evaluate(() => {
    return ["wipe-left", "wipe-right", "push-left", "push-right"].map((kind) => {
      const canvas = tools.draw(
        tools.frame([
          tools.transition(
            tools.shape("red"),
            tools.shape("blue", { fill: "#0000ff" }),
            kind,
            0.505,
          ),
        ]),
      );
      return { kind, values: [tools.pixel(canvas, 49, 50), tools.pixel(canvas, 50, 50)] };
    });
  });
  for (const item of pixels)
    for (const pixel of item.values) {
      assert.equal(pixel[3], 255, `${item.kind}: ${pixel}`);
      assert.ok(Math.abs(pixel[0] + pixel[2] - 255) <= 1, `${item.kind}: ${pixel}`);
    }
});

test("push transitions blend both endpoints against a stationary backdrop at fractional boundaries", async () => {
  const pixels = await page.evaluate(() => {
    const from = tools.shape("red", { blendMode: "multiply" });
    const to = tools.shape("blue", { fill: "#0000ff", blendMode: "screen" });
    const canvas = tools.draw(
      tools.frame([tools.transition(from, to, "push-left", 0.505)], { background: "#ffff00" }),
    );
    return [
      tools.pixel(canvas, 25, 50),
      tools.pixel(canvas, 49, 50),
      tools.pixel(canvas, 50, 50),
      tools.pixel(canvas, 75, 50),
    ];
  });
  near(pixels[0], [255, 0, 0, 255]);
  // Canvas may snap image edges to physical pixels. Either boundary sample must
  // stay on the opaque red-to-white path without exposing a yellow backdrop seam.
  for (const pixel of pixels.slice(1, 3)) {
    assert.equal(pixel[0], 255);
    assert.equal(pixel[3], 255);
    assert.equal(pixel[1], pixel[2]);
  }
  near(pixels[3], [255, 255, 255, 255]);
});

test("grading uses the shared pixel function and leaves alpha unchanged", async () => {
  const value = await page.evaluate(() => {
    const color = {
      ...editor.defaultColorAdjustment(),
      exposure: 1,
      temperature: 0.2,
      tint: -0.1,
      curves: [
        {
          channel: "red",
          points: [
            { x: 0, y: 0.1 },
            { x: 1, y: 0.9 },
          ],
        },
      ],
      hsl: [],
    };
    const source = tools.canvas(16, 16, "rgba(20,50,100,0.5)"),
      expected = new Uint8ClampedArray(tools.pixel(source, 5, 5));
    editor.applyColorToRgba(expected, color);
    const c = tools.draw(tools.frame([tools.media("a", { color })]), new Map([["a", source]]));
    return { expected: Array.from(expected), actual: tools.pixel(c, 50, 50) };
  });
  near(value.actual, value.expected, 2);
  assert.equal(value.actual[3], 128);
});

test("rectangle, ellipse and line primitives render fill and stroke through clip transforms", async () => {
  const value = await page.evaluate(() => {
    const rectangle = tools.draw(
      tools.frame([
        tools.shape("rectangle", { fill: "#ff000080", stroke: "#00ff00", strokeWidth: 4 }),
      ]),
    );
    const ellipse = tools.draw(tools.frame([tools.shape("ellipse", { shape: "ellipse" })]));
    const line = tools.draw(
      tools.frame([
        tools.shape("line", {
          shape: "line",
          stroke: "#00ff00",
          strokeWidth: 4,
          transform: { rotation: 90 },
        }),
      ]),
    );
    return {
      rectangle: [tools.pixel(rectangle, 50, 50), tools.pixel(rectangle, 1, 50)],
      ellipse: [tools.pixel(ellipse, 50, 50), tools.pixel(ellipse, 1, 1)],
      line: [tools.pixel(line, 50, 20), tools.pixel(line, 20, 50)],
    };
  });
  near(value.rectangle[0], [255, 0, 0, 128]);
  near(value.rectangle[1], [0, 255, 0, 255]);
  near(value.ellipse[0], [255, 0, 0, 255]);
  near(value.ellipse[1], [0, 0, 0, 0]);
  near(value.line[0], [0, 255, 0, 255]);
  near(value.line[1], [0, 0, 0, 0]);
});

test("migrated caption-stack pixels retain all three legacy styles and overlapping Chinese multiline stacking", async () => {
  const comparisons = await page.evaluate(() => {
    const texts = [
        "中文第一行\n第二行 subtitles",
        "另外一条很长的中文解释，需要自动换行，而且需要保留四行限制。".repeat(2),
      ],
      results = [];
    for (const style of ["classic", "bold", "minimal"]) {
      const project = {
        schemaVersion: 1,
        id: "caption-comparison",
        name: "字幕",
        revision: 0,
        fps: 30,
        width: 640,
        height: 360,
        captionStyle: style,
        assets: [],
        clips: [],
        captions: [],
      };
      project.assets = [
        { id: "source", name: "来源", kind: "video", durationFrames: 90, width: 640, height: 360 },
      ];
      project.clips = [{ id: "clip", assetId: "source", inFrame: 0, outFrame: 90, volume: 1 }];
      project.captions = texts.map((text, index) => ({
        id: "caption-" + index,
        startFrame: 0,
        endFrame: 60,
        text,
      }));
      const migrated = editor.migrateLegacyProject(project),
        frame = editor.evaluateFrame(migrated, migrated.activeSequenceId, 0);
      frame.background = "#00000000";
      frame.layers = frame.layers.filter((layer) => layer.kind === "text");
      const actual = tools.draw(frame),
        reference = tools.canvas(640, 360);
      editor.drawCaptionLayer(reference.getContext("2d"), {
        width: 640,
        height: 360,
        fontSize: 18,
        texts,
        style,
      });
      const a = actual.getContext("2d").getImageData(0, 0, 640, 360).data,
        b = reference.getContext("2d").getImageData(0, 0, 640, 360).data;
      let changed = 0,
        total = 0,
        max = 0;
      for (let i = 0; i < a.length; i++) {
        const delta = Math.abs(a[i] - b[i]);
        if (delta) {
          changed++;
          total += delta;
          max = Math.max(max, delta);
        }
      }
      results.push({ style, changed, total, max, pixels: tools.stats(actual).count });
    }
    return results;
  });
  for (const value of comparisons) {
    assert.ok(value.pixels > 0);
    assert.equal(value.changed, 0, JSON.stringify(value));
  }
});

test("general Chinese titles wrap explicit newlines and support typewriter, fade and word highlighting", async () => {
  const value = await page.evaluate(() => {
    const title = tools.text("title", "中文标题换行\n第二段内容", {
      style: { fontSize: 24, maxWidth: 0.6, lineHeight: 1.8 },
    });
    const wrapped = tools.draw(tools.frame([title], { width: 200, height: 260 }));
    const drawAnimation = (animation, progress) =>
      tools.draw(
        tools.frame(
          [
            tools.text("animated", "ABCDEFGH", {
              animationProgress: progress,
              style: { fontSize: 30, maxWidth: 1, animation },
            }),
          ],
          { width: 400, height: 120 },
        ),
      );
    const none = drawAnimation("typewriter", 0),
      half = drawAnimation("typewriter", 0.3),
      full = drawAnimation("typewriter", 0.8),
      fade = drawAnimation("fade", 0.05),
      opaque = drawAnimation("fade", 0.5);
    const highlight = tools.draw(
      tools.frame(
        [
          tools.text("words", "hello world", {
            words: [
              { text: "hello", start: 0, end: 50 },
              { text: "world", start: 50, end: 100 },
            ],
            activeWordIndices: [1],
            style: {
              fontSize: 30,
              maxWidth: 1,
              animation: "word-highlight",
              highlightColor: "#ffff00",
            },
          }),
        ],
        { width: 400, height: 120 },
      ),
    );
    const pixels = highlight.getContext("2d").getImageData(0, 0, 400, 120).data;
    let white = 0,
      yellow = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3] > 100) {
        if (pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240) white++;
        if (pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] < 10) yellow++;
      }
    return {
      wrapped: tools.stats(wrapped),
      none: tools.stats(none),
      half: tools.stats(half),
      full: tools.stats(full),
      fade: tools.stats(fade),
      opaque: tools.stats(opaque),
      white,
      yellow,
    };
  });
  assert.ok(value.wrapped.groups >= 3, JSON.stringify(value.wrapped));
  assert.ok(value.wrapped.left >= 35);
  assert.ok(value.wrapped.right < 165);
  assert.equal(value.none.count, 0);
  assert.ok(value.half.count > 0 && value.full.count > value.half.count);
  assert.ok(value.full.right - value.full.left > value.half.right - value.half.left);
  assert.ok(value.fade.maxAlpha >= 126 && value.fade.maxAlpha <= 129);
  assert.equal(value.opaque.maxAlpha, 255);
  assert.ok(value.white > 0 && value.yellow > 0);
});

test("static keyword colors span wrapped Chinese phrases, repeat in caption stacks and yield to live word highlighting", async () => {
  const result = await page.evaluate(() => {
    const count = (canvas) => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      const found = { yellow: 0, cyan: 0, white: 0, rows: [] };
      for (let y = 0; y < canvas.height; y++) {
        let yellow = false;
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          if (data[i + 3] < 200) continue;
          if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] < 10) {
            found.yellow++;
            yellow = true;
          }
          if (data[i] < 10 && data[i + 1] > 240 && data[i + 2] > 240) found.cyan++;
          if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) found.white++;
        }
        if (yellow) found.rows.push(y);
      }
      let groups = 0,
        previous = -2;
      for (const row of found.rows) {
        if (row > previous + 1) groups++;
        previous = row;
      }
      return { ...found, groups, rows: undefined };
    };
    const style = {
      fontSize: 30,
      maxWidth: 1,
      strokeWidth: 0,
      keywords: [{ text: "重点强调", color: "#ffff00" }],
    };
    const wrapped = count(
      tools.draw(
        tools.frame(
          [
            tools.text("wrapped", "重点强调", {
              style: { ...style, maxWidth: 0.3, lineHeight: 1.6 },
            }),
          ],
          { width: 220, height: 240 },
        ),
      ),
    );
    const stack = count(
      tools.draw(
        tools.frame(
          [
            tools.text("a", "重点强调", { style: { ...style, layout: "caption-stack" } }),
            tools.text("b", "重点强调", { style: { ...style, layout: "caption-stack" } }),
          ],
          { width: 400, height: 240 },
        ),
      ),
    );
    const animated = count(
      tools.draw(
        tools.frame(
          [
            tools.text("words", "重点强调 其他", {
              style: { ...style, animation: "word-highlight", highlightColor: "#00ffff" },
              words: [{ text: "重点", start: 0, end: 50 }],
              activeWordIndices: [0],
            }),
          ],
          { width: 400, height: 120 },
        ),
      ),
    );
    const overlap = count(
      tools.draw(
        tools.frame(
          [
            tools.text("rules", "重点强调", {
              style: {
                ...style,
                keywords: [...style.keywords, { text: "重点", color: "#00ffff" }],
              },
            }),
          ],
          { width: 400, height: 120 },
        ),
      ),
    );
    const reveal = count(
      tools.draw(
        tools.frame(
          [
            tools.text("reveal", "重点强调", {
              animationProgress: 0.3,
              style: { ...style, animation: "typewriter" },
            }),
          ],
          { width: 400, height: 120 },
        ),
      ),
    );
    return { wrapped, stack, animated, overlap, reveal };
  });
  assert.ok(result.wrapped.groups >= 2 && result.wrapped.yellow > 50, JSON.stringify(result));
  assert.ok(result.stack.groups >= 2 && result.stack.yellow > result.wrapped.yellow);
  for (const key of ["animated", "overlap"])
    assert.ok(result[key].yellow > 0 && result[key].cyan > 0);
  assert.ok(result.animated.white > 0);
  assert.ok(result.reveal.yellow > 0, "A revealed prefix keeps the full phrase's keyword color");
});

test("missing or released sources fail before clearing a frame and reusable buffers reset clipping and alpha", async () => {
  const value = await page.evaluate(() => {
    const c = tools.canvas(32, 32, "green"),
      instance = tools.media("required"),
      errors = [];
    for (const media of [new Map(), new Map([["required", tools.canvas(0, 0)]])]) {
      try {
        editor.drawEvaluatedFrame(c, tools.frame([instance]), media);
      } catch (error) {
        errors.push(error.message);
      }
    }
    const preserved = tools.pixel(c, 10, 10),
      size = [c.width, c.height],
      compositor = new editor.FrameCompositor();
    const context = c.getContext("2d");
    context.rect(0, 0, 1, 1);
    context.clip();
    context.globalAlpha = 0.1;
    compositor.draw(
      c,
      tools.frame([tools.shape("red", { mask: tools.mask({ width: 0.2 }) })]),
      new Map(),
    );
    compositor.draw(c, tools.frame([tools.shape("blue", { fill: "#0000ff" })]), new Map());
    const repeated = tools.pixel(c, 90, 90);
    compositor.dispose();
    let bounded;
    try {
      editor.drawEvaluatedFrame(c, tools.frame([], { width: 8193, height: 100 }), new Map());
    } catch (error) {
      bounded = error.message;
    }
    return { errors, preserved, size, repeated, bounded };
  });
  assert.equal(value.errors.length, 2);
  assert.match(value.errors[0], /required/);
  assert.match(value.errors[1], /尺寸/);
  near(value.preserved, [0, 128, 0, 255]);
  assert.deepEqual(value.size, [32, 32]);
  near(value.repeated, [0, 0, 255, 255]);
  assert.match(value.bounded, /8192/);
});
