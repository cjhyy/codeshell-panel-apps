import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
let browser, page;
before(async () => {
  const bundle = await build({
    stdin: {
      contents: `export * from './apps/video-studio/src/editor/timing-ui';export * from './apps/video-studio/src/editor/defaults';export {EditorHistory} from './apps/video-studio/src/editor/history';export * from './apps/video-studio/src/editor/timing-edits';export {applyEditorOperations,prepareEditorOperationPreview} from './apps/video-studio/src/editor/operations';export {trimClip,prepareClipTrim} from './apps/video-studio/src/editor/clip-edits';export {validateEditorDocument} from './apps/video-studio/src/editor/validation';`,
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
  page = await browser.newPage({ viewport: { width: 760, height: 980 } });
  page.setDefaultTimeout(5000);
  await page.setContent(
    '<!doctype html><html lang="zh-CN"><body style="margin:0;background:#0b1019"><main id="mount" style="width:370px;height:980px"></main></body></html>',
  );
  await page.addStyleTag({
    content: await readFile(
      new URL("../apps/video-studio/public/editor-timing.css", import.meta.url),
      "utf8",
    ),
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.addScriptTag({
    content: `
    const T=240000;
    globalThis.fixture=()=>{
      const media=(id,start,trackId='v')=>({id,kind:'media',label:({a:'开场镜头',b:'第二镜头',c:'结尾镜头',sound:'同期声'})[id],trackId,start:start*T,duration:4*T,assetId:'asset',timeMap:{points:[{time:0,source:0},{time:4*T,source:4*T}]},audio:api.defaultAudioMix(),transform:api.defaultTransform(),color:api.defaultColorAdjustment(),blendMode:'normal'});
      const a=media('a',0),b=media('b',4),c=media('c',8),sound=media('sound',4,'audio');b.linkGroupId='link';sound.linkGroupId='link';
      a.transform.x={keyframes:[{time:0,value:0,easing:'linear'},{time:2*T,value:.5,easing:'ease-in'},{time:4*T,value:1,easing:'linear'}]};
      const caption=(id,owner,start)=>({id,kind:'text',role:'subtitle',label:'中文字幕',trackId:'text',start:start*T,duration:4*T,text:'你好世界',style:api.defaultTextStyle(),words:[{text:'你好',start:0,end:2*T},{text:'世界',start:2*T,end:4*T}],sourceBinding:{clipId:owner,sourceStart:0,sourceEnd:4*T},transform:api.defaultTransform(),color:api.defaultColorAdjustment(),blendMode:'normal'});
      return {schemaVersion:2,timebase:T,id:'project',name:'交互时序',revision:0,activeSequenceId:'main',exportProfiles:[],assets:[{id:'asset',name:'素材',kind:'video',duration:20*T,width:1920,height:1080}],sequences:[{id:'main',name:'主序列',width:1920,height:1080,frameRate:{numerator:30,denominator:1},background:'#000000',timelineMode:'free',tracks:[api.createTrack('v','video','主画面'),api.createTrack('audio','audio','同期声'),api.createTrack('text','text','字幕')],clips:[a,b,c,sound,caption('ca','a',0),caption('cb','b',4)],transitions:[],markers:[]}]};
    };
    globalThis.reset=(ids=['a'],initial=fixture())=>{globalThis.timing?.dispose();globalThis.editorHistory=new api.EditorHistory(initial);globalThis.selected=ids;globalThis.generation=(globalThis.generation??0)+1;globalThis.now=T;globalThis.errors=[];globalThis.calls=[];globalThis.waitApply=null;globalThis.timing=api.mountEditorTiming(document.querySelector('#mount'),{read:()=>editorHistory.read(),identity:()=>({documentId:editorHistory.read().id,generation,revision:editorHistory.revision}),selection:()=>({sequenceId:'main',clipIds:selected}),time:()=>now,onError:error=>errors.push(error.message),apply:async(ops,label)=>{calls.push({ops,label});if(waitApply)await waitApply;editorHistory.apply(ops,editorHistory.revision,label);}});};
    globalThis.clip=id=>editorHistory.read().sequences[0].clips.find(clip=>clip.id===id);
    globalThis.select=ids=>{selected=ids;timing.render();};
  `,
  });
});
after(async () => {
  if (process.env.VIDEO_STUDIO_TIMING_SCREENSHOTS) {
    await page.evaluate(() => reset());
    await details("分段速度曲线");
    await page.locator("#mount").screenshot({ path: "/tmp/video-studio-editor-timing.png" });
    await page.evaluate(() => reset(["a", "b"]));
    await details("相邻转场");
    await page
      .locator("#mount")
      .screenshot({ path: "/tmp/video-studio-editor-timing-transition.png" });
  }
  await browser?.close();
});
beforeEach(async () => page.evaluate(() => reset()));
async function details(text) {
  const node = page
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: text }) })
    .last();
  if (!(await node.evaluate((node) => node.open))) await node.locator(":scope > summary").click();
  return node;
}
async function click(text) {
  await page.getByRole("button", { name: text, exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".editor-timing fieldset")?.disabled ||
      document.querySelector("[role=alert]"),
  );
}
async function set(label, value, change = false) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(String(value));
  if (change) await input.dispatchEvent("change");
}
const read = (id = "a") => page.evaluate((id) => clip(id), id);

test("constant-speed form uses readable units, keeps linked captions aligned and one parent undo restores the edit", async () => {
  await page.getByLabel("联动后续片段", { exact: true }).check();
  await set("恒定速度（倍）", 2);
  await page.getByLabel("变速时保持音高", { exact: true }).uncheck();
  await click("应用恒定速度");
  assert.equal((await read()).duration, 2 * 240000);
  assert.equal((await read()).audio.preservePitch, false);
  assert.equal((await read("b")).start, 2 * 240000);
  assert.equal((await read("sound")).start, 2 * 240000);
  assert.equal((await read("cb")).start, 2 * 240000);
  assert.equal((await read("ca")).words[0].end, 240000);
  assert.equal(await page.evaluate(() => calls.length), 1);
  await page.evaluate(() => {
    editorHistory.undo();
    timing.render();
  });
  assert.equal((await read()).duration, 4 * 240000);
  assert.equal((await read("b")).start, 4 * 240000);
});

test("slow playback refuses free overlap and succeeds when the user chooses ripple", async () => {
  await set("恒定速度（倍）", 0.5);
  await click("应用恒定速度");
  assert.match(await page.getByRole("alert").innerText(), /重叠/);
  assert.equal(await page.evaluate(() => calls.length), 0);
  await page.getByLabel("联动后续片段", { exact: true }).check();
  await set("恒定速度（倍）", 0.5);
  await click("应用恒定速度");
  assert.equal((await read()).duration, 8 * 240000);
  assert.equal((await read("b")).start, 8 * 240000);
});

test("editable source/output seconds and graph produce a real nonlinear time map with retimed words", async () => {
  await page.getByLabel("联动后续片段", { exact: true }).check();
  await details("分段速度曲线");
  await click("在节点 1 后插入");
  await set("节点 2 输出（秒）", 1, true);
  await set("节点 3 输出（秒）", 6, true);
  assert.equal(await page.getByRole("img", { name: "输出时间与素材时间曲线" }).count(), 1);
  await click("应用分段曲线");
  assert.deepEqual((await read()).timeMap.points, [
    { time: 0, source: 0 },
    { time: 240000, source: 480000 },
    { time: 1440000, source: 960000 },
  ]);
  assert.equal((await read("ca")).words[0].end, 240000);
  assert.equal((await read("b")).start, 6 * 240000);
});

test("invalid point ordering cannot save and playhead renders preserve in-progress curve fields", async () => {
  await details("分段速度曲线");
  await click("在节点 1 后插入");
  await set("节点 2 输出（秒）", 5, true);
  await click("应用分段曲线");
  assert.match(await page.getByRole("alert").innerText(), /递增|局部时间/);
  assert.equal(await page.evaluate(() => calls.length), 0);
  await details("分段速度曲线");
  await set("节点 2 输出（秒）", "7.25");
  await page.evaluate(() => {
    now += 240000;
    timing.render();
  });
  assert.equal(await page.getByLabel("节点 2 输出（秒）", { exact: true }).inputValue(), "7.25");
});

test("invalid empty curve fields block publication and a selected linked picture applies its curve to both streams", async () => {
  await details("分段速度曲线");
  await set("节点 2 输出（秒）", "", true);
  await click("应用分段曲线");
  assert.match(await page.getByRole("alert").innerText(), /无效秒数/);
  assert.equal(await page.evaluate(() => calls.length), 0);
  await page.evaluate(() => reset(["b"]));
  await page.getByLabel("联动后续片段", { exact: true }).check();
  await details("分段速度曲线");
  await set("节点 2 输出（秒）", 2, true);
  await click("应用分段曲线");
  assert.equal((await read("b")).duration, 480000);
  assert.equal((await read("sound")).duration, 480000);
  assert.equal((await read("cb")).duration, 480000);
});

test("source/output fields retain tick precision finer than a millisecond", async () => {
  await page.getByLabel("联动后续片段", { exact: true }).check();
  await details("分段速度曲线");
  await click("在节点 1 后插入");
  await set("节点 2 输出（秒）", "1.000004", true);
  await click("应用分段曲线");
  assert.equal((await read()).timeMap.points[1].time, 240001);
  assert.deepEqual(await page.evaluate(() => errors), []);
});

test("reverse and held frames require explicit caption detachment and retain caption wording", async () => {
  await click("倒放所选片段");
  assert.match(await page.getByRole("alert").innerText(), /解除字幕绑定/);
  await page.getByLabel("保留字幕时间并解除来源绑定", { exact: true }).check();
  await click("倒放所选片段");
  assert.deepEqual(
    (await read()).timeMap.points.map((point) => point.source),
    [960000, 0],
  );
  assert.equal((await read("ca")).text, "你好世界");
  assert.equal((await read("ca")).sourceBinding, undefined);
  await page.evaluate(() => reset());
  await page.getByLabel("联动后续片段", { exact: true }).check();
  await page.getByLabel("保留字幕时间并解除来源绑定", { exact: true }).check();
  await set("定格时长（秒）", 1.5);
  await click("用播放头画面定格");
  assert.equal((await read()).duration, 360000);
  assert.deepEqual(
    (await read()).timeMap.points.map((point) => point.source),
    [240000, 240000],
  );
  assert.equal((await read("b")).start, 360000);
});

test("keep-right button trims source, wording and animation then moves the retained caption exactly once", async () => {
  await page.evaluate(() => {
    now = 2 * 240000;
    timing.render();
  });
  await page.getByLabel("联动后续片段", { exact: true }).check();
  await click("保留播放头右侧");
  assert.equal((await read()).start, 0);
  assert.equal((await read()).timeMap.points[0].source, 480000);
  assert.equal((await read("ca")).start, 0);
  assert.equal((await read("ca")).text, "世界");
  assert.equal((await read("b")).start, 480000);
});

test("adjacent-transition controls create, adjust and remove real overlap with linked audio and subtitles", async () => {
  await page.evaluate(() => select(["a", "b"]));
  await details("相邻转场");
  await page.getByLabel("转场效果", { exact: true }).selectOption("wipe-right");
  await set("转场时长（秒）", 1);
  await click("添加转场");
  assert.equal((await read("b")).start, 720000);
  assert.equal((await read("sound")).start, 720000);
  assert.equal((await read("cb")).start, 720000);
  assert.equal(
    await page.evaluate(() => editorHistory.read().sequences[0].transitions[0].kind),
    "wipe-right",
  );
  await set("转场时长（秒）", 0.5);
  await page.getByLabel("转场效果", { exact: true }).selectOption("push-left");
  await click("应用转场调整");
  assert.equal((await read("b")).start, 840000);
  await click("移除转场并接成硬切");
  assert.equal((await read("b")).start, 960000);
  assert.equal(await page.evaluate(() => editorHistory.read().sequences[0].transitions.length), 0);
});

test("existing transitions need an explicit removal choice for retiming and removal belongs to the same undo", async () => {
  await details("相邻转场");
  await click("添加转场");
  await set("恒定速度（倍）", 2);
  await page.getByLabel("联动后续片段", { exact: true }).check();
  await click("应用恒定速度");
  assert.match(await page.getByRole("alert").innerText(), /明确选择/);
  await page.getByLabel("联动后续片段", { exact: true }).check();
  await page.getByLabel("移除相关转场并消除重叠", { exact: true }).check();
  await set("恒定速度（倍）", 2);
  await click("应用恒定速度");
  assert.equal(await page.evaluate(() => editorHistory.read().sequences[0].transitions.length), 0);
  assert.equal((await read("b")).start, 480000);
  await page.evaluate(() => {
    editorHistory.undo();
    timing.render();
  });
  assert.equal(await page.evaluate(() => editorHistory.read().sequences[0].transitions.length), 1);
  assert.equal((await read()).duration, 960000);
});

test("magnetic switch compacts selected picture track with all links and free switch retains positions", async () => {
  await page.evaluate(() => {
    const doc = fixture();
    for (const clip of doc.sequences[0].clips) clip.start += 480000;
    doc.sequences[0].clips.find((clip) => clip.id === "c").start += 240000;
    reset([], doc);
  });
  await details("时间线排列");
  await page.getByLabel("排列方式", { exact: true }).selectOption("magnetic");
  await page.waitForFunction(() => editorHistory.read().sequences[0].timelineMode === "magnetic");
  assert.equal((await read()).start, 0);
  assert.equal((await read("b")).start, 960000);
  assert.equal((await read("cb")).start, 960000);
  assert.equal((await read("c")).start, 1920000);
  await page.getByLabel("排列方式", { exact: true }).selectOption("free");
  await page.waitForFunction(() => editorHistory.read().sequences[0].timelineMode === "free");
  assert.equal((await read("c")).start, 1920000);
});

test("locked direct selection disables controls and a locked linked track blocks the whole transaction", async () => {
  await page.evaluate(() => {
    const doc = fixture();
    doc.sequences[0].tracks[0].locked = true;
    reset(["a"], doc);
  });
  assert.equal(
    await page.getByRole("button", { name: "应用恒定速度", exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.evaluate(() => calls.length), 0);
  await page.evaluate(() => {
    const doc = fixture();
    doc.sequences[0].tracks[1].locked = true;
    reset(["b"], doc);
  });
  await set("恒定速度（倍）", 2);
  await click("应用恒定速度");
  assert.match(await page.getByRole("alert").innerText(), /锁定/);
  assert.equal(await page.evaluate(() => calls.length), 0);
  assert.equal((await read("b")).duration, 960000);
});

test("stale form submission does not apply to a new revision or a different selection", async () => {
  await set("恒定速度（倍）", 2);
  await page.evaluate(() =>
    editorHistory.apply(
      [{ type: "project.rename", name: "外部修改" }],
      editorHistory.revision,
      "外部修改",
    ),
  );
  await click("应用恒定速度");
  assert.match(await page.getByRole("alert").innerText(), /已变化/);
  assert.equal(await page.evaluate(() => calls.length), 0);
  await page.evaluate(() => reset());
  await set("恒定速度（倍）", 2);
  await page.evaluate(() => (selected = ["b"]));
  await click("应用恒定速度");
  assert.match(await page.getByRole("alert").innerText(), /已变化/);
  assert.equal(await page.evaluate(() => calls.length), 0);
});

test("pending parent persistence disables repeated submits and disposal removes all timing controls", async () => {
  await page.evaluate(() => {
    waitApply = new Promise((resolve) => {
      globalThis.releaseApply = resolve;
    });
  });
  await set("恒定速度（倍）", 2);
  await page.getByRole("button", { name: "应用恒定速度", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "应用恒定速度", exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.evaluate(() => calls.length), 1);
  await page.evaluate(() => releaseApply());
  await page.waitForFunction(() => editorHistory.revision === 1);
  await page.evaluate(() => timing.dispose());
  assert.equal(await page.getByRole("region", { name: "时间与转场" }).count(), 0);
  assert.equal(await page.locator(".editor-timing").count(), 0);
});

test("ripple trim keeps a later transition, audio and subtitles aligned through one parent edit and undo", async () => {
  const before = await page.evaluate(() => {
    const initial = fixture();
    const document = api.applyEditorOperations(initial, api.planTransition(initial, "main", "b", "c", {
      id: "bc", kind: "dissolve", duration: 240000,
    }), initial.revision);
    reset(["a"], document);
    now = 480000;
    timing.render();
    return editorHistory.read();
  });
  await page.getByLabel("联动后续片段", { exact: true }).check();
  await click("保留播放头左侧");
  const result = await page.evaluate(() => ({ document: editorHistory.read(), calls, errors }));
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].ops.filter((operation) => operation.type === "clip.move").length, 1);
  for (const id of ["b", "sound", "cb"]) assert.equal((await read(id)).start, 480000);
  assert.equal((await read("c")).start, 1200000);
  assert.equal(result.document.sequences[0].transitions[0].start, 1200000);
  assert.deepEqual(result.errors, []);
  await page.evaluate(() => { editorHistory.undo(); timing.render(); });
  assert.deepEqual(await page.evaluate(() => editorHistory.read()), { ...before, revision: before.revision + 2 });
  assert.equal(await page.evaluate(() => editorHistory.canUndo), false);
});

for (const count of [1000, 5000]) {
  test(`Chromium planning benchmark retains legal sequence limits for ${count} media clips`, async (t) => {
    const results = await page.evaluate((count) => {
      const make = (mode, spacing) => {
        const document = {
          schemaVersion: 2, timebase: 240000, id: "large", name: "规划基准", revision: 3,
          activeSequenceId: "main", exportProfiles: [], sequences: [],
          assets: [{ id: "demo", kind: "demo", name: "测试视频", duration: 8000, width: 320, height: 180 }],
        };
        for (let offset = 0; offset < count; offset += 2000) document.sequences.push({
          id: offset ? `sequence-${offset}` : "main", name: "序列", width: 320, height: 180,
          frameRate: { numerator: 30, denominator: 1 }, background: "#000000", timelineMode: mode,
          tracks: [api.createTrack("v", "video")], transitions: [], markers: [],
          clips: Array.from({ length: Math.min(2000, count - offset) }, (_, index) => ({
            id: `clip-${offset + index}`, kind: "media", assetId: "demo", trackId: "v", label: "视频",
            start: index * spacing, duration: 8000,
            timeMap: { points: [{ time: 0, source: 0 }, { time: 8000, source: 8000 }] },
            audio: api.defaultAudioMix(), transform: api.defaultTransform(),
            color: api.defaultColorAdjustment(), blendMode: "normal",
          })),
        });
        return api.validateEditorDocument(document);
      };
      const free = make("free", 16000),
        magnetic = make("magnetic", 16000),
        contiguous = make("magnetic", 8000),
        movePreview = api.prepareEditorOperationPreview(free),
        trimPreview = api.prepareClipTrim(free, "main", "clip-0"),
        functions = {
          prepareMove: () => api.prepareEditorOperationPreview(free).dispose(),
          prepareTrim: () => api.prepareClipTrim(free, "main", "clip-0").dispose(),
          ownedMove: () => movePreview.preview([{
            type: "clip.move", sequenceId: "main", clipIds: ["clip-0"], delta: 4000,
          }]),
          ownedTrim: () => trimPreview.plan(1000, 7000),
          freeMove: () => api.applyEditorOperations(free, [{
            type: "clip.move", sequenceId: "main", clipIds: ["clip-0"], delta: 4000,
          }], free.revision),
          freeTrim: () => api.trimClip(free, "main", "clip-0", 1000, 7000),
          gappedMagneticMove: () => api.planMagneticMove(magnetic, "main", ["clip-0"], { delta: 16000 }),
          gappedMagneticTrim: () => api.planClipTiming(magnetic, "main", ["clip-0"], { kind: "keep-left", time: 4000 }, { ripple: true }),
          contiguousMagneticMove: () => api.planMagneticMove(contiguous, "main", ["clip-0"], { delta: 8000 }),
          contiguousMagneticTrim: () => api.planClipTiming(contiguous, "main", ["clip-0"], { kind: "keep-left", time: 4000 }, { ripple: true }),
        },
        timings = [];
      for (const [name, plan] of Object.entries(functions)) {
        for (let index = 0; index < 2; index++) plan();
        const samples = [];
        for (let index = 0; index < 6; index++) {
          const started = performance.now();
          plan();
          samples.push(performance.now() - started);
        }
        timings.push({ name, mean: samples.reduce((sum, value) => sum + value, 0) / samples.length });
      }
      const operations = functions.contiguousMagneticTrim(),
        result = api.applyEditorOperations(contiguous, operations, contiguous.revision);
      movePreview.dispose(); trimPreview.dispose();
      let disposedMove = false, disposedTrim = false;
      try { movePreview.read(); } catch (error) { disposedMove = /预览已结束/.test(error.message); }
      try { trimPreview.plan(1000, 7000); } catch (error) { disposedTrim = /预览已结束/.test(error.message); }
      return {
        timings,
        disposedMove, disposedTrim,
        sequenceLengths: contiguous.sequences.map((sequence) => sequence.clips.length),
        movementCount: operations.filter((operation) => operation.type === "clip.move").length,
        afterStart: result.sequences[0].clips.at(-1).start,
        expectedStart: (contiguous.sequences[0].clips.length - 1) * 8000 - 4000,
        inactiveUnchanged: JSON.stringify(result.sequences.slice(1)) === JSON.stringify(contiguous.sequences.slice(1)),
      };
    }, count);
    assert.deepEqual(results.sequenceLengths, count === 5000 ? [2000, 2000, 1000] : [1000]);
    assert.equal(results.movementCount, 1);
    assert.equal(results.afterStart, results.expectedStart);
    assert.equal(results.inactiveUnchanged, true);
    assert.equal(results.disposedMove, true);
    assert.equal(results.disposedTrim, true);
    t.diagnostic(`${count} media clips: ${results.timings.map(({ name, mean }) => `${name} ${mean.toFixed(2)}ms`).join(", ")}`);
  });
}

test("same-id revision successor drops a focused speed draft and detached timing actions", async () => {
  await set("恒定速度（倍）", 2);
  await page.evaluate(() => {
    globalThis.oldTimingAction = [...document.querySelectorAll(".editor-timing button")].find((button) => button.textContent === "应用恒定速度");
    editorHistory = new api.EditorHistory(fixture());
    generation++;
    timing.render();
    oldTimingAction.click();
  });
  assert.equal(await page.getByLabel("恒定速度（倍）", { exact: true }).inputValue(), "1");
  assert.equal(await page.evaluate(() => calls.length), 0);
  assert.equal((await read()).duration, 4 * 240000);
  assert.deepEqual(await page.evaluate(() => errors), []);
});


test("old native curve changes and connected stale buttons stay inert before and after generation render", async () => {
  await details("分段速度曲线");
  const source = await page.getByLabel("节点 2 来源（秒）", { exact: true }).elementHandle();
  await page.evaluate(() => {
    globalThis.oldTimingButton = [...document.querySelectorAll(".editor-timing button")].find((button) => button.textContent === "倒放所选片段");
    editorHistory = new api.EditorHistory(fixture());
    generation++;
    oldTimingButton.click();
    timing.render();
  });
  await source.evaluate((input) => { input.value = "-1"; input.dispatchEvent(new Event("change", { bubbles: true })); });
  assert.equal(await page.evaluate(() => calls.length), 0);
  assert.deepEqual(await page.evaluate(() => errors), []);
  assert.equal((await read()).timeMap.points[1].source, 4 * 240000);
});

test("late timing persistence errors cannot add an alert to a replacement generation", async () => {
  await page.evaluate(() => {
    timing.context.apply = () => new Promise((_resolve, reject) => globalThis.rejectOldTiming = reject);
  });
  await set("恒定速度（倍）", 2);
  await page.getByRole("button", { name: "应用恒定速度", exact: true }).click();
  await page.evaluate(() => {
    editorHistory = new api.EditorHistory(fixture());
    generation++;
    timing.render();
    rejectOldTiming(new Error("旧工程写入失败"));
  });
  await page.waitForFunction(() => !document.querySelector(".editor-timing fieldset").disabled);
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.deepEqual(await page.evaluate(() => errors), []);
});
