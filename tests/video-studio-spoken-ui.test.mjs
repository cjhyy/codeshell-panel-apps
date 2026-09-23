import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
let browser, server, directory, url;
const repository = fileURLToPath(new URL("../", import.meta.url));
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "video-spoken-ui-"));
  await build({
    stdin: {
      contents: `
 import {createSpokenUI} from './apps/video-studio/src/spoken-ui.ts';
 import {EditorHistory} from './apps/video-studio/src/editor/history.ts';
 import {createTrack,defaultAudioMix,defaultColorAdjustment,defaultTransform} from './apps/video-studio/src/editor/defaults.ts';
 import {validateEditorDocument} from './apps/video-studio/src/editor/validation.ts';
 const T=240000;
 const media=(id,trackId,assetId,start,source,duration)=>({id,kind:'media',label:id,trackId,start,duration,assetId,timeMap:{points:[{time:0,source},{time:duration,source:source+duration}]},audio:defaultAudioMix(),transform:defaultTransform(),color:defaultColorAdjustment(),blendMode:'normal'});
 window.makeDocument=(extra={})=>validateEditorDocument({schemaVersion:2,timebase:T,id:'spoken-ui',name:'实际交互测试',revision:0,activeSequenceId:'main',exportProfiles:[],
  assets:[{id:'talk',name:'我的口播',kind:'video',duration:20*T+1234,width:1280,height:720},{id:'music',name:'背景音乐',kind:'audio',duration:30*T}],
  sequences:[{id:'main',name:'主序列',width:1280,height:720,frameRate:{numerator:30,denominator:1},background:'#000000',timelineMode:'free',
   tracks:[createTrack('v1','video','口播'),createTrack('a3','audio','音乐')],
   clips:[media('a','v1','talk',0,T,10*T),...(extra.music?[media('bed','a3','music',0,0,10*T)]:[])],transitions:[],markers:[]}],
  ...(extra.production?{production:extra.production}:{})});
 window.editorHistory=new EditorHistory(window.makeDocument());window.generation=1;window.plans=[];window.previewed=[];window.enhanced=[];window.polished=[];window.errors=[];window.toasts=[];window.readResolvers=[];window.failRead=false;window.failApply=false;window.delayRead=false;window.prepareCount=0;
 window.transcript=[{start:4.2,end:5,text:'嗯',words:[{start:4.3,end:4.6,text:'嗯'}]},{start:5,end:6,text:'这个故事值得讲述。'},{start:6.2,end:7.2,text:'这个故事值得讲述。'},{start:8,end:10,text:'嗯，我们继续讲正文。'}];
 window.spans=(trackId='v1')=>window.editorHistory.read().sequences[0].clips.filter(c=>c.trackId===trackId).sort((a,b)=>a.start-b.start).map(c=>[c.start,c.start+c.duration,c.timeMap.points[0].source]);
 const root=document.querySelector('#root');const render=()=>{root.innerHTML=ui.render();};
 const wait=async()=>{if(window.delayRead)await new Promise(resolve=>window.readResolvers.push(resolve));if(window.failRead)throw Error('尚未转写');};
 const ui=createSpokenUI({document:()=>window.editorHistory.read(),sequenceId:()=>window.editorHistory.read().activeSequenceId,
 identity:()=>({documentId:window.editorHistory.read().id,generation:window.generation,revision:window.editorHistory.revision}),changed:render,toast:message=>window.toasts.push(message),
 prepare:async()=>{window.prepareCount++;window.editorHistory.apply([{type:'asset.update',assetId:'talk',patch:{metadata:{proxyId:'asset-'+'a'.repeat(64)}}}],window.editorHistory.revision,'准备素材');},
 fetchTranscript:async()=>{await wait();return window.transcript;},fetchSilence:async()=>{await wait();return [{start:2,end:4}];},
 apply:async plan=>{if(window.failApply)throw Error('保存失败，原片未改变');if(plan.identity.generation!==window.generation||plan.identity.documentId!==window.editorHistory.read().id)throw Error('工程已变化');window.editorHistory.apply(plan.operations,plan.identity.revision,plan.title);window.plans.push(plan);},
 undo:()=>{window.editorHistory.undo();},canUndo:()=>window.editorHistory.canUndo,
 preview:async range=>{window.previewed.push(range);},polish:async text=>{window.polished.push(text);},enhance:async input=>{window.enhanced.push(input);}});
 window.spoken=ui;window.render=render;
 root.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button)void ui.action(button.dataset.action).catch(error=>window.errors.push(error.message));});for(const event of ['input','change'])root.addEventListener(event,event=>ui.input(event.target));render();
 `,
      resolveDir: repository,
      sourcefile: "spoken-test.js",
    },
    outfile: join(directory, "test.mjs"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  const bundle = await readFile(join(directory, "test.mjs")),
    css = await readFile(join(repository, "apps/video-studio/public/style.css"));
  server = createServer((req, res) => {
    if (req.url === "/test.mjs") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(bundle);
    } else if (req.url === "/style.css") {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(css);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        '<!doctype html><link rel="stylesheet" href="/style.css"><div id="root" style="width:340px;padding:20px"></div><script type="module" src="/test.mjs"></script>',
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function page() {
  const p = await browser.newPage();
  p.on("pageerror", (error) => console.error("pageerror", error.message));
  await p.goto(url);
  await p.locator("#spoken-asset").waitFor();
  return p;
}
const click = (p, name) => p.getByRole("button", { name, exact: true }).click();

const T = 240000;
test("actual spoken UI reads real-shaped analysis, reviews source mapping, skips, atomically applies and undoes", async () => {
  const p = await page();
  await click(p, "读取已有结果");
  await p.locator(".spoken-candidate").first().waitFor();
  assert.equal(await p.locator("[data-spoken-candidate]:checked").count(), 0);
  assert.equal(await p.locator("[data-spoken-candidate]:disabled").count(), 1);
  const pause = p
    .locator(".spoken-candidate")
    .filter({ has: p.locator("strong", { hasText: "长停顿" }) });
  assert.match(await pause.textContent(), /00:01\.17 · 1\.67 秒/);
  await pause.getByRole("button", { name: "试听定位" }).click();
  // Source 2 s–4 s with breathing room, played from the clip's 1 s in-point, plus 0.4 s of context.
  assert.deepEqual(await p.evaluate(() => window.previewed[0]), {
    start: T + 40000 - 96000,
    end: 3 * T - 40000 + 96000,
  });
  await pause.getByRole("button", { name: "跳过", exact: true }).click();
  assert.equal(
    await p.locator(".spoken-candidate strong").filter({ hasText: "长停顿" }).count(),
    0,
  );
  await click(p, "恢复已跳过 1 项");
  await click(p, "勾选长停顿");
  assert.match(await p.locator("#spoken-selection").textContent(), /1 项.*1.67 秒/);
  await click(p, "应用所选删减");
  await p.waitForFunction(() => window.plans.length === 1);
  assert.equal(await p.evaluate(() => window.editorHistory.revision), 1);
  assert.deepEqual(await p.evaluate(() => window.spans()), [
    [0, T + 40000, T],
    [T + 40000, 10 * T - 400000, 4 * T - 40000],
  ]);
  assert.match(await p.evaluate(() => window.toasts[0]), /已删去 1\.67 秒，可撤销恢复/);
  await click(p, "撤销上次编辑");
  assert.deepEqual(await p.evaluate(() => window.spans()), [[0, 10 * T, T]]);
  await p.close();
});
test("metadata-only preparation refreshes the revision, missing words stay honest, and original voice enhancement/polish pass actual choices", async () => {
  const p = await page();
  await click(p, "准备口播并分析");
  await p.locator(".spoken-candidate").first().waitFor();
  assert.equal(await p.evaluate(() => window.prepareCount), 1);
  assert.equal(await p.evaluate(() => window.editorHistory.revision), 1);
  await click(p, "勾选长停顿");
  await click(p, "应用所选删减");
  await p.waitForFunction(() => window.plans.length === 1);
  assert.equal(await p.evaluate(() => window.plans[0].identity.revision), 1);
  await click(p, "读取已有结果");
  await p.locator(".spoken-candidate").first().waitFor();
  await p.locator(".spoken-enhance summary").click();
  await p.locator("#spoken-preset").selectOption("light");
  await p.locator("#spoken-normalize").uncheck();
  await click(p, "优化这份原声");
  assert.deepEqual(await p.evaluate(() => window.enhanced[0]), {
    assetId: "talk",
    preset: "light",
    denoise: true,
    normalize: false,
  });
  await p.locator(".spoken-transcript summary").click();
  await click(p, "让 AI 提供文稿建议");
  assert.match(await p.evaluate(() => window.polished[0]), /这个故事值得讲述/);
  assert.equal(await p.evaluate(() => window.editorHistory.revision), 2);
  await p.close();
});
test("a failed save preserves selected candidates, stale async results never apply to a new project, and read failures can retry", async () => {
  const p = await page();
  await p.evaluate(() => (window.failRead = true));
  await click(p, "读取已有结果");
  await p.getByRole("alert").waitFor();
  assert.equal(await p.locator(".spoken-candidate").count(), 0);
  await p.evaluate(() => (window.failRead = false));
  await click(p, "读取已有结果");
  await p.locator(".spoken-candidate").first().waitFor();
  await click(p, "勾选长停顿");
  await p.evaluate(() => (window.failApply = true));
  await click(p, "应用所选删减");
  await p.getByRole("alert").waitFor();
  assert.equal(await p.evaluate(() => window.editorHistory.revision), 0);
  assert.equal(await p.locator("[data-spoken-candidate]:checked").count(), 1);
  await p.evaluate(() => {
    window.delayRead = true;
    window.failApply = false;
  });
  await click(p, "读取已有结果");
  await p.getByRole("status").waitFor();
  await p.evaluate(() => {
    window.editorHistory = new window.editorHistory.constructor({
      ...window.makeDocument(),
      id: "another-project",
    });
    window.generation++;
    for (const resolve of window.readResolvers) resolve();
    window.readResolvers = [];
    window.delayRead = false;
  });
  await p.getByRole("alert").waitFor();
  assert.equal(await p.locator(".spoken-candidate").count(), 0);
  assert.match(await p.getByRole("alert").textContent(), /工程已变化/);
  await click(p, "读取已有结果");
  await p.locator(".spoken-candidate").first().waitFor();
  await click(p, "勾选长停顿");
  await click(p, "应用所选删减");
  await p.waitForFunction(() => window.plans.length === 1);
  assert.equal(await p.evaluate(() => window.plans[0].identity.documentId), "another-project");
  await p.close();
});
test("segment-only transcript retains real pause candidates and disables imprecise word deletion", async () => {
  const p = await page();
  await p.evaluate(() => {
    window.transcript = [{ start: 6, end: 9, text: "嗯，我们继续讲正文。" }];
  });
  await click(p, "读取已有结果");
  await p.locator(".spoken-candidate").first().waitFor();
  assert.match(await p.locator("#root").textContent(), /没有词时间戳/);
  assert.equal(await p.locator("[data-spoken-candidate]:disabled").count(), 1);
  assert.equal(await p.locator("[data-spoken-candidate]:not(:disabled)").count(), 1);
  const dimensions = await p
    .locator("#spoken-asset")
    .evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      parent: el.parentElement.getBoundingClientRect().width,
    }));
  assert.ok(dimensions.width <= dimensions.parent + 1);
  assert.ok(dimensions.width > 250);
  await p.close();
});
test("every track's voice is listed, approved narration is flagged, and 仅口播及关联轨 leaves the music bed alone", async () => {
  const p = await page();
  await p.evaluate(() => {
    window.editorHistory = new window.editorHistory.constructor(
      window.makeDocument({
        music: true,
        production: {
          narration: { phase: "approved", captionBasis: "recording", draftCaptionIds: [] },
        },
      }),
    );
    window.render();
  });
  assert.deepEqual(await p.locator("#spoken-asset option").allTextContents(), [
    "我的口播",
    "背景音乐",
  ]);
  await click(p, "读取已有结果");
  await p.locator(".spoken-candidate").first().waitFor();
  await click(p, "勾选长停顿");
  assert.match(await p.locator(".spoken-apply").textContent(), /已确认的口播.*重新审阅/);
  await p.getByLabel("仅口播及关联轨").check();
  await click(p, "应用所选删减");
  await p.waitForFunction(() => window.plans.length === 1);
  assert.deepEqual(await p.evaluate(() => window.spans("a3")), [[0, 10 * T, 0]]);
  assert.equal((await p.evaluate(() => window.spans("v1"))).length, 2);
  assert.match(await p.evaluate(() => window.toasts[0]), /重新审阅/);
  await click(p, "撤销上次编辑");
  await click(p, "读取已有结果");
  await p.locator(".spoken-candidate").first().waitFor();
  assert.equal(await p.getByLabel("仅口播及关联轨").isChecked(), true);
  await p.getByLabel("仅口播及关联轨").uncheck();
  await click(p, "勾选长停顿");
  await click(p, "应用所选删减");
  await p.waitForFunction(() => window.plans.length === 2);
  assert.equal((await p.evaluate(() => window.spans("a3"))).length, 2);
  assert.deepEqual(await p.evaluate(() => window.errors), []);
  await p.close();
});
