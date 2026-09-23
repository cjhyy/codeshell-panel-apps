import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

let browser, page;
before(async () => {
  const compiled = await build({
    stdin: {
      contents: `
    export * from './apps/video-studio/src/editor/inspector-ui';
    export * from './apps/video-studio/src/editor/defaults';
    export { EditorHistory } from './apps/video-studio/src/editor/history';
    export { evaluateAnimatedNumber } from './apps/video-studio/src/editor/animation';
  `,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "api",
    platform: "browser",
    target: "chrome120",
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  page.setDefaultTimeout(5000);
  await page.setContent(
    '<!doctype html><html lang="zh-CN"><body style="background:#0d1118;margin:0"><main style="width:360px;height:800px" id="mount"></main></body></html>',
  );
  await page.addStyleTag({
    content: await readFile(
      new URL("../apps/video-studio/public/editor-inspector.css", import.meta.url),
      "utf8",
    ),
  });
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  await page.addScriptTag({
    content: `
    const T=240000;
    globalThis.makeDocument=()=>{
      const common=(id,trackId,start=0)=>({id,trackId,start,duration:4*T,label:({a:'主镜头',b:'副镜头',t:'主字幕',u:'副字幕',s:'图形'})[id],transform:api.defaultTransform(),color:api.defaultColorAdjustment(),blendMode:'normal'});
      const media=(id,trackId,start=0)=>({...common(id,trackId,start),kind:'media',assetId:'video',timeMap:{points:[{time:0,source:0},{time:4*T,source:4*T}]},audio:api.defaultAudioMix()});
      const a=media('a','v1'),b=media('b','v2',T);
      a.transform.x=.1;a.transform.y=.2;a.transform.scaleX=.8;a.transform.opacity=.9;a.transform.crop.left=.1;
      b.transform.x=.3;b.transform.y=.4;b.transform.scaleX=1.2;b.transform.opacity=.7;b.transform.crop.right=.2;
      a.color.temperature=.1;b.color.temperature=-.2;
      const t={...common('t','txt'),kind:'text',role:'subtitle',text:'你好世界',style:api.defaultTextStyle(),words:[]};
      const u={...common('u','txt2'),kind:'text',role:'title',text:'第二段文字',style:api.defaultTextStyle(),words:[]};
      u.style.fontSize=64;u.style.shadow.x=6;
      const s={...common('s','v3'),kind:'shape',shape:'rectangle',fill:'#ff0000',stroke:'#00000000',strokeWidth:0};
      return {schemaVersion:2,timebase:T,id:'project',name:'属性测试',revision:0,activeSequenceId:'main',exportProfiles:[],assets:[{id:'video',name:'素材',kind:'video',duration:10*T,width:1920,height:1080}],sequences:[{id:'main',name:'序列',width:1920,height:1080,frameRate:{numerator:30,denominator:1},background:'#000000',timelineMode:'free',tracks:[api.createTrack('v1','video','主视频'),api.createTrack('v2','video','副视频'),api.createTrack('v3','video','图形轨道'),api.createTrack('music','audio','音乐'),api.createTrack('txt','text','字幕'),api.createTrack('txt2','text','标题')],clips:[a,b,t,u,s],transitions:[],markers:[]}]};
    };
    globalThis.reset=(ids=['a'])=>{
      globalThis.inspector?.dispose();globalThis.editorHistory=new api.EditorHistory(makeDocument());globalThis.selected=ids;globalThis.now=2*T;globalThis.errors=[];globalThis.calls=[];globalThis.waitApply=null;
      globalThis.inspector=api.mountEditorInspector(document.querySelector('#mount'),{read:()=>editorHistory.read(),selection:()=>({sequenceId:'main',clipIds:selected}),time:()=>now,onError:error=>errors.push(error.message),apply:async(ops,label)=>{calls.push({ops,label});if(waitApply)await waitApply;editorHistory.apply(ops,editorHistory.revision,label);}});
    };
    globalThis.clip=id=>editorHistory.read().sequences[0].clips.find(c=>c.id===id);
    globalThis.select=ids=>{selected=ids;inspector.render();};
    globalThis.update=(id,patch)=>editorHistory.apply([{type:'clip.update',sequenceId:'main',clipId:id,patch}],editorHistory.revision,'外部修改');
  `,
  });
});
after(async () => {
  if (process.env.VIDEO_STUDIO_INSPECTOR_SCREENSHOTS && page) {
    await page.evaluate(() => reset(["a", "b"]));
    await page.locator("#mount").screenshot({ path: "/tmp/video-studio-editor-inspector.png" });
    await page.evaluate(() => select(["t"]));
    await tab("文字");
    await page
      .locator("#mount")
      .screenshot({ path: "/tmp/video-studio-editor-inspector-text.png" });
  }
  await browser?.close();
});
beforeEach(async () => {
  await page.evaluate(() => reset());
});
async function change(label, value) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(String(value));
  await input.dispatchEvent("change");
  await page.waitForFunction(
    () =>
      !document.querySelector(".ei-panel")?.disabled ||
      document.querySelector(".ei-notice") ||
      document.querySelector(".ei-error"),
  );
}
async function tab(name) {
  await page.getByRole("tab", { name, exact: true }).click();
}
async function read(id = "a") {
  return page.evaluate((id) => clip(id), id);
}
async function details(name) {
  const item = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: name }) })
    .first();
  if (!(await item.evaluate((node) => node.open))) await item.locator(":scope > summary").click();
  return item;
}

test("visual controls convert percentages, preserve unrelated properties, and expose keyboard-accessible tabs", async () => {
  await change("水平位置（%）", 25);
  await change("水平缩放（%）", 50);
  await change("旋转（度）", 45);
  await change("不透明度（%）", 75);
  await page.getByLabel("水平镜像", { exact: true }).check();
  await page.getByLabel("画面适配", { exact: true }).selectOption("cover");
  await change("顶部裁切（%）", 12.5);
  await page.getByLabel("混合模式", { exact: true }).selectOption("screen");
  const a = await read();
  assert.equal(a.transform.x, 0.25);
  assert.equal(a.transform.y, 0.2);
  assert.equal(a.transform.scaleX, 0.5);
  assert.equal(a.transform.scaleY, 1);
  assert.equal(a.transform.rotation, 45);
  assert.equal(a.transform.opacity, 0.75);
  assert.equal(a.transform.flipX, true);
  assert.equal(a.transform.fit, "cover");
  assert.equal(a.transform.crop.left, 0.1);
  assert.equal(a.transform.crop.top, 0.125);
  assert.equal(a.blendMode, "screen");
  assert.equal((await read("b")).transform.x, 0.3);
  await page.getByRole("tab", { name: "画面", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.getByRole("tab", { name: "调色", exact: true }).getAttribute("aria-selected"),
    "true",
  );
  await page.evaluate(() => select(["s"]));
  await tab("画面");
  await page.getByLabel("图形类型", { exact: true }).selectOption("ellipse");
  await change("图形描边宽度（像素）", 4);
  assert.equal((await read("s")).shape, "ellipse");
  assert.equal((await read("s")).strokeWidth, 4);
});

test("mixed selection edits one nested value per clip in a single undoable parent transaction", async () => {
  await page.evaluate(() => select(["a", "b"]));
  const input = page.getByLabel("水平位置（%）", { exact: true });
  assert.equal(await input.inputValue(), "");
  assert.equal(await input.getAttribute("placeholder"), "多个值");
  await change("水平位置（%）", -20);
  const state = await page.evaluate(() => ({
    a: clip("a"),
    b: clip("b"),
    calls,
    revision: editorHistory.revision,
    canUndo: editorHistory.canUndo,
  }));
  assert.equal(state.a.transform.x, -0.2);
  assert.equal(state.b.transform.x, -0.2);
  assert.equal(state.a.transform.y, 0.2);
  assert.equal(state.b.transform.y, 0.4);
  assert.equal(state.a.transform.crop.left, 0.1);
  assert.equal(state.b.transform.crop.right, 0.2);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].ops.length, 2);
  assert.equal(state.revision, 1);
  assert.equal(state.canUndo, true);
  await page.evaluate(() => {
    editorHistory.undo();
    inspector.render();
  });
  assert.equal((await read()).transform.x, 0.1);
  assert.equal((await read("b")).transform.x, 0.3);
  assert.equal(await input.inputValue(), "");
});

test("text preserves Chinese newlines and edits per-clip content, shared styles, words and shadows", async () => {
  await page.evaluate(() => select(["t", "u"]));
  await tab("文字");
  await change("文字内容（保留换行）", "第一行中文\n第二行 <img src=x>");
  assert.equal((await read("t")).text, "第一行中文\n第二行 <img src=x>");
  assert.equal((await read("u")).text, "第二段文字");
  assert.equal(await page.locator(".editor-inspector img").count(), 0);
  await change("字号（像素）", 52);
  await change("行高（%）", 160);
  await change("文字最大宽度（%）", 70);
  await change("阴影模糊（像素）", 8);
  await change("文字背景颜色", "#22446680");
  await page.getByLabel("文字动画", { exact: true }).selectOption("word-highlight");
  const t = await read("t"),
    u = await read("u");
  assert.equal(t.style.fontSize, 52);
  assert.equal(u.style.fontSize, 52);
  assert.equal(t.style.lineHeight, 1.6);
  assert.equal(t.style.maxWidth, 0.7);
  assert.equal(t.style.shadow.blur, 8);
  assert.equal(u.style.shadow.x, 6);
  assert.equal(t.style.background, "#22446680");
  assert.equal(t.style.animation, "word-highlight");
  await details("逐词时间");
  await page.getByRole("button", { name: "添加字幕词语", exact: true }).click();
  await change("词语 1", "第一行");
  await change("词语 1 结束（秒）", 0.4);
  assert.deepEqual((await read("t")).words, [{ text: "第一行", start: 0, end: 96000 }]);
  assert.deepEqual((await read("u")).words, []);
});

test("editing subtitle or title wording clears stale word timing and translation in one undoable change", async () => {
  for (const id of ["t", "u"]) {
    await page.evaluate((id) => {
      reset([id]);
      const item = clip(id);
      update(id, {
        text: "你好世界\nHello world",
        words: [{ text: "你好世界", start: 0, end: 240000 }],
        translation: {
          original: "你好世界",
          language: "英语",
          mode: "bilingual",
          originalWords: [{ text: "你好世界", start: 0, end: 240000 }],
        },
        style: { ...item.style, animation: "word-highlight", fontSize: 52 },
        ...(id === "t"
          ? { sourceBinding: { clipId: "a", sourceStart: 0, sourceEnd: 960000 } }
          : {}),
      });
      inspector.render();
    }, id);
    await tab("文字");
    const before = await read(id);
    await change("文字内容（保留换行）", "修正后的文字\n新的一行");
    const edited = await read(id);
    assert.equal(edited.text, "修正后的文字\n新的一行");
    assert.deepEqual(edited.words, []);
    assert.equal(edited.translation, undefined);
    assert.equal(edited.style.animation, "none");
    assert.equal(edited.style.fontSize, 52);
    assert.deepEqual(edited.sourceBinding, before.sourceBinding);
    assert.equal(await page.evaluate(() => calls.length), 1);
    await page.evaluate(() => {
      editorHistory.undo();
      inspector.render();
    });
    assert.deepEqual(await read(id), before);
  }
});

test("keyword forms preserve other selected text styles and offer one-step undo with stale-list and lock protection", async () => {
  await page.evaluate(() => select(["t", "u"]));
  await tab("文字");
  await page.getByLabel("新关键词", { exact: true }).fill("世界");
  await page.getByLabel("新关键词颜色", { exact: true }).fill("#ffbb00");
  await page.getByRole("button", { name: "添加关键词强调", exact: true }).click();
  assert.deepEqual((await read("t")).style.keywords, [{ text: "世界", color: "#ffbb00" }]);
  assert.equal((await read("u")).style.keywords, undefined);
  await details("关键词列表");
  await change("关键词 1 颜色", "#00ccff");
  assert.equal((await read("t")).style.keywords[0].color, "#00ccff");
  await page.evaluate(() => {
    editorHistory.undo();
    inspector.render();
  });
  assert.equal((await read("t")).style.keywords[0].color, "#ffbb00");
  const stale = await page.getByLabel("关键词 1", { exact: true }).elementHandle();
  await page.evaluate(() => {
    const t = clip("t");
    update("t", {
      style: { ...t.style, keywords: [{ text: "新规则", color: "#ffffff" }, ...t.style.keywords] },
    });
  });
  await stale.evaluate((input) => {
    input.value = "错行";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.deepEqual(
    (await read("t")).style.keywords.map((item) => item.text),
    ["新规则", "世界"],
  );
  assert.match((await page.evaluate(() => errors)).at(-1), /列表已变化/);
  await page.getByRole("button", { name: "删除关键词 2", exact: true }).click();
  assert.deepEqual(
    (await read("t")).style.keywords.map((item) => item.text),
    ["新规则"],
  );
  await page.evaluate(() => {
    editorHistory.apply(
      [{ type: "track.update", sequenceId: "main", trackId: "txt", patch: { locked: true } }],
      editorHistory.revision,
      "锁定",
    );
    inspector.render();
  });
  assert.equal(
    await page.getByRole("button", { name: "添加关键词强调", exact: true }).isDisabled(),
    true,
  );
});

test("named missing fonts show a non-blocking visible warning and choosing a generic font clears it", async () => {
  await page.evaluate(() => select(["t"]));
  await tab("文字");
  await change("字体", '"VideoStudio Deliberately Missing Font 92817", sans-serif');
  const warning = page.getByRole("status").filter({ hasText: "可能缺少字体" });
  assert.equal(await warning.count(), 1);
  assert.match(await warning.textContent(), /工程包不包含字体/);
  assert.match(await warning.textContent(), /检测仅供参考/);
  assert.equal(
    (await read("t")).style.fontFamily,
    '"VideoStudio Deliberately Missing Font 92817", sans-serif',
  );
  await change("字体", "system-ui");
  assert.equal(await warning.count(), 0);
});

test("audio controls use seconds and percentages and ducking selects real reference tracks", async () => {
  await tab("音频");
  await change("音量（%）", 50);
  await change("声像（%）", -25);
  await change("声音淡入（秒）", 0.25);
  await change("声音淡出（秒）", 0.75);
  await change("音高（半音）", 3);
  await page.getByLabel("变速时保持音高", { exact: true }).uncheck();
  await page.getByLabel("启用自动压低", { exact: true }).check();
  await change("触发电平（dB）", -30);
  await change("压低幅度（dB）", 9);
  await change("压低启动（秒）", 0.15);
  await change("音量恢复（秒）", 0.8);
  await page.getByLabel("参考轨道：音乐", { exact: true }).check();
  await page.getByLabel("参考轨道：副视频", { exact: true }).uncheck();
  const audio = (await read()).audio;
  assert.equal(audio.volume, 0.5);
  assert.equal(audio.pan, -0.25);
  assert.equal(audio.fadeIn, 60000);
  assert.equal(audio.fadeOut, 180000);
  assert.equal(audio.pitchSemitones, 3);
  assert.equal(audio.preservePitch, false);
  assert.deepEqual(audio.ducking, {
    sidechainTrackIds: ["music"],
    thresholdDb: -30,
    attenuationDb: 9,
    attack: 36000,
    release: 192000,
  });
  await page.getByLabel("参考轨道：音乐", { exact: true }).click();
  assert.equal(await page.getByRole("alert").innerText(), "至少保留一条参考声音轨道");
  assert.deepEqual((await read()).audio.ducking.sidechainTrackIds, ["music"]);
  await page.getByLabel("启用自动压低", { exact: true }).uncheck();
  assert.equal((await read()).audio.ducking, undefined);
});

test("mixed masks preserve each geometry and path vertex editing only affects the chosen clip", async () => {
  await page.evaluate(() => {
    update("b", {
      mask: {
        kind: "rectangle",
        x: 0.2,
        y: 0.1,
        width: 0.8,
        height: 0.6,
        rotation: 20,
        feather: 0,
        inverted: false,
      },
    });
    select(["a", "b"]);
  });
  await tab("蒙版");
  await page.getByLabel("蒙版类型", { exact: true }).selectOption("path");
  await change("蒙版宽度（%）", 50);
  await change("蒙版羽化（%）", 10);
  await page.getByLabel("反转蒙版", { exact: true }).check();
  assert.equal((await read()).mask.x, 0);
  assert.equal((await read("b")).mask.x, 0.2);
  assert.equal((await read("b")).mask.rotation, 20);
  assert.equal((await read()).mask.width, 0.5);
  assert.equal((await read("b")).mask.feather, 0.1);
  await page.getByLabel("单独编辑片段", { exact: true }).selectOption("b");
  await change("顶点 1 水平（%）", 25);
  await page.getByRole("button", { name: "添加路径顶点", exact: true }).click();
  assert.equal((await read()).mask.points.length, 4);
  assert.equal((await read()).mask.points[0].x, 0);
  assert.equal((await read("b")).mask.points.length, 5);
  assert.equal((await read("b")).mask.points[0].x, 0.25);
  await page.getByLabel("蒙版类型", { exact: true }).selectOption("ellipse");
  assert.equal((await read()).mask.points, undefined);
  assert.equal((await read("b")).mask.x, 0.2);
});

test("color controls, RGB curve points and HSL bands edit genuine document values without replacing neighboring adjustments", async () => {
  await page.evaluate(() => select(["a", "b"]));
  await tab("调色");
  await change("亮度（%）", 20);
  await change("对比度（%）", 150);
  await change("饱和度（%）", 80);
  await change("色相（度）", 35);
  assert.equal((await read()).color.brightness, 0.2);
  assert.equal((await read("b")).color.contrast, 1.5);
  assert.equal((await read("b")).color.saturation, 0.8);
  assert.equal((await read()).color.temperature, 0.1);
  assert.equal((await read("b")).color.temperature, -0.2);
  await details("红色曲线");
  await page.getByRole("button", { name: "添加红色曲线", exact: true }).click();
  await page.getByRole("button", { name: "添加红色节点", exact: true }).click();
  await change("红色节点 2 输出（%）", 65);
  assert.deepEqual((await read()).color.curves, [
    {
      channel: "red",
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.65 },
        { x: 1, y: 1 },
      ],
    },
  ]);
  assert.deepEqual((await read("b")).color.curves, []);
  assert.equal(await page.getByRole("img", { name: "红色调色曲线预览", exact: true }).count(), 1);
  const advanced = page
    .locator(".ei-section")
    .filter({ has: page.getByRole("heading", { name: "曲线与分色调整", exact: true }) });
  await advanced.getByLabel("单独编辑片段", { exact: true }).selectOption("b");
  await page.getByRole("button", { name: "添加颜色范围", exact: true }).click();
  await change("范围 1 目标色相（度）", 120);
  await change("范围 1 分色饱和度（%）", -30);
  assert.equal((await read("b")).color.hsl[0].hue, 120);
  assert.equal((await read("b")).color.hsl[0].saturation, -0.3);
  assert.deepEqual((await read()).color.hsl, []);
});

test("keyframes use each clip local time and edit easing curves without discarding neighboring animations", async () => {
  await page.evaluate(() => select(["a", "b"]));
  await page.getByRole("button", { name: "添加不透明度（%）当前关键帧", exact: true }).click();
  assert.deepEqual((await read()).transform.opacity, {
    keyframes: [{ time: 480000, value: 0.9, easing: "linear" }],
  });
  assert.deepEqual((await read("b")).transform.opacity, {
    keyframes: [{ time: 240000, value: 0.7, easing: "linear" }],
  });
  await change("不透明度（%）", 50);
  await page.evaluate(() => {
    now = 3 * 240000;
    inspector.render();
  });
  await page.getByRole("button", { name: "添加不透明度（%）当前关键帧", exact: true }).click();
  await change("不透明度（%）", 100);
  await details("不透明度（%） · 关键帧");
  await page.getByLabel("关键帧 1 缓动", { exact: true }).selectOption("cubic-bezier");
  await change("关键帧 1 控制点 1 时间（%）", 10);
  await change("关键帧 1 控制点 1 进度（%）", -20);
  await change("关键帧 1 时间（秒）", 1.5);
  const a = await read(),
    b = await read("b");
  assert.equal(a.transform.opacity.keyframes[0].time, 360000);
  assert.deepEqual(a.transform.opacity.keyframes[0].easing, {
    type: "cubic-bezier",
    x1: 0.1,
    y1: -0.2,
    x2: 0.25,
    y2: 1,
  });
  assert.equal(a.transform.opacity.keyframes[1].time, 720000);
  assert.equal(b.transform.opacity.keyframes[0].time, 240000);
  assert.equal(b.transform.opacity.keyframes[0].easing, "linear");
  assert.equal(await page.getByRole("img", { name: "缓动曲线预览", exact: true }).count(), 2);
  const before = await page.evaluate(() => editorHistory.read());
  await change("关键帧 2 时间（秒）", 1.5);
  assert.deepEqual(await page.evaluate(() => editorHistory.read()), before);
  assert.match(await page.getByRole("alert").innerText(), /严格递增/);
  await page.getByRole("button", { name: "移除不透明度（%）当前关键帧", exact: true }).click();
  assert.equal((await read()).transform.opacity.keyframes.length, 1);
  assert.equal((await read("b")).transform.opacity.keyframes.length, 1);
  await page.getByRole("button", { name: "删除关键帧 1", exact: true }).click();
  assert.equal((await read()).transform.opacity, 0.5);
  assert.equal(typeof (await read("b")).transform.opacity, "object");
});

test("locked selection and locks introduced after render cannot partially write other clips", async () => {
  await page.evaluate(() => {
    selected = ["a", "b"];
    editorHistory.apply(
      [{ type: "track.update", sequenceId: "main", trackId: "v2", patch: { locked: true } }],
      editorHistory.revision,
    );
    inspector.render();
  });
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).isDisabled(), true);
  await page.getByLabel("水平位置（%）", { exact: true }).evaluate((input) => {
    input.value = "50";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => calls.length), 0);
  assert.equal((await read()).transform.x, 0.1);
  assert.equal((await read("b")).transform.x, 0.3);
  await page.evaluate(() => {
    reset(["a", "b"]);
    editorHistory.apply(
      [{ type: "track.update", sequenceId: "main", trackId: "v2", patch: { locked: true } }],
      editorHistory.revision,
    );
  });
  await page.getByLabel("水平位置（%）", { exact: true }).fill("40");
  await page.getByLabel("水平位置（%）", { exact: true }).dispatchEvent("change");
  assert.equal(await page.evaluate(() => calls.length), 0);
  assert.match(await page.getByRole("alert").innerText(), /已锁定/);
});

test("invalid batches roll back, latest nested values survive, and stale selections never receive old form events", async () => {
  await page.evaluate(() => select(["a", "b"]));
  await change("左侧裁切（%）", 85);
  assert.equal((await read()).transform.crop.left, 0.1);
  assert.equal((await read("b")).transform.crop.left, 0);
  assert.equal(await page.evaluate(() => editorHistory.revision), 0);
  assert.match(await page.getByRole("alert").innerText(), /有效画面/);
  await tab("调色");
  await page.evaluate(() => {
    const a = clip("a");
    update("a", { color: { ...a.color, contrast: 2 } });
  });
  await change("亮度（%）", 15);
  assert.equal((await read()).color.contrast, 2);
  assert.equal((await read()).color.brightness, 0.15);
  await page.evaluate(() => {
    selected = ["b"];
  });
  const count = await page.evaluate(() => calls.length);
  await change("亮度（%）", 30);
  assert.equal(await page.evaluate(() => calls.length), count);
  assert.match(await page.getByRole("alert").innerText(), /选择已变化/);
  assert.equal((await read("b")).color.brightness, 0.15);
});

test("pending parent commits disable duplicate edits and disposal removes the mounted panel", async () => {
  await page.evaluate(() => {
    waitApply = new Promise((resolve) => (globalThis.finishApply = resolve));
  });
  await page.getByLabel("水平位置（%）", { exact: true }).fill("20");
  await page.getByLabel("水平位置（%）", { exact: true }).dispatchEvent("change");
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).isDisabled(), true);
  await page.getByLabel("水平位置（%）", { exact: true }).evaluate((input) => {
    input.value = "30";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => calls.length), 1);
  await page.evaluate(() => {
    finishApply();
  });
  await page.waitForFunction(() => editorHistory.revision === 1);
  assert.equal((await read()).transform.x, 0.2);
  await page.evaluate(() => inspector.dispose());
  assert.equal(await page.getByRole("region", { name: "片段属性", exact: true }).count(), 0);
  assert.equal(await page.locator("#mount").innerHTML(), "");
});

test("all inspector tabs fit a narrow dark sidebar without horizontal overflow", async () => {
  await page.evaluate(() => {
    document.querySelector("#mount").style.width = "300px";
    select(["a", "b", "t", "u", "s"]);
  });
  for (const name of ["画面", "调色", "蒙版", "文字", "音频"]) {
    await tab(name);
    const size = await page
      .locator(".editor-inspector")
      .evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    assert.ok(size.scroll <= size.width, `${name}: ${JSON.stringify(size)}`);
  }
  await page.evaluate(() => {
    document.querySelector("#mount").style.width = "360px";
  });
});

test("playhead changes use the new local time and externally inserted list rows never redirect stale edits", async () => {
  await page.getByRole("button", { name: "添加不透明度（%）当前关键帧", exact: true }).click();
  await page.evaluate(() => {
    now = 3 * 240000;
  });
  // The previous render showed an existing key; a current-time action must still
  // add the new key instead of removing an unrelated one.
  await page.getByRole("button", { name: "移除不透明度（%）当前关键帧", exact: true }).click();
  assert.deepEqual(
    (await read()).transform.opacity.keyframes.map((key) => key.time),
    [480000, 720000],
  );
  await page.evaluate(() => {
    update("t", { words: [{ text: "原词", start: 24000, end: 48000 }] });
    select(["t"]);
  });
  await tab("文字");
  await details("逐词时间");
  await page.evaluate(() =>
    update("t", {
      words: [
        { text: "新插入", start: 0, end: 12000 },
        { text: "原词", start: 24000, end: 48000 },
      ],
    }),
  );
  const count = await page.evaluate(() => calls.length);
  await change("词语 1", "错误目标");
  assert.equal(await page.evaluate(() => calls.length), count);
  assert.match(await page.getByRole("alert").innerText(), /列表已变化/);
  assert.deepEqual(
    (await read("t")).words.map((word) => word.text),
    ["新插入", "原词"],
  );
});

test("playhead-only refreshes preserve an unfinished focused text draft", async () => {
  await page.evaluate(() => select(["t"]));
  await tab("文字");
  const input = page.getByLabel("文字内容（保留换行）", { exact: true });
  await input.fill("尚未提交的中文\n第二行");
  await page.evaluate(() => {
    now += 24000;
    inspector.render();
  });
  assert.equal(await input.inputValue(), "尚未提交的中文\n第二行");
  assert.equal(await input.evaluate((node) => node === document.activeElement), true);
  assert.equal((await read("t")).text, "你好世界");
  await input.dispatchEvent("change");
  assert.equal((await read("t")).text, "尚未提交的中文\n第二行");
});

test("color fields offer a color picker synced with the typed value, keeping any transparency", async () => {
  await page.evaluate(() => select(["t"]));
  await tab("文字");
  const text = page.getByLabel("文字颜色", { exact: true }),
    picker = page.getByLabel("选择文字颜色", { exact: true });
  assert.equal(await picker.getAttribute("type"), "color");
  assert.equal(await picker.inputValue(), (await text.inputValue()).slice(0, 7).toLowerCase());
  await picker.fill("#336699");
  await picker.dispatchEvent("change");
  await page.waitForFunction(() => clip("t").style.color === "#336699");
  assert.equal(await page.getByLabel("文字颜色", { exact: true }).inputValue(), "#336699");
  // Picking keeps the alpha of an #RRGGBBAA background.
  await change("文字背景颜色", "#22446680");
  await page.getByLabel("选择文字背景颜色", { exact: true }).fill("#aabbcc");
  await page.getByLabel("选择文字背景颜色", { exact: true }).dispatchEvent("change");
  await page.waitForFunction(() => clip("t").style.background === "#aabbcc80");
  // Typing a color moves the picker too.
  await page.getByLabel("文字描边颜色", { exact: true }).fill("#102030");
  assert.equal(await page.getByLabel("选择文字描边颜色", { exact: true }).inputValue(), "#102030");
  await change("文字描边颜色", "#102030");
  assert.equal((await read("t")).style.strokeColor, "#102030");
  for (const label of ["逐词高亮颜色", "阴影颜色"])
    assert.equal(await page.getByLabel(`选择${label}`, { exact: true }).count(), 1, label);
  await page.evaluate(() => select(["s"]));
  await tab("画面");
  for (const label of ["图形填充颜色", "图形描边颜色"])
    assert.equal(await page.getByLabel(`选择${label}`, { exact: true }).count(), 1, label);
});
