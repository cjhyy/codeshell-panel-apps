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
 import {createProject,validateProject,applyOperations} from './apps/video-studio/src/model.ts';
 const base=createProject('实际交互测试');base.assets=[{id:'talk',name:'我的口播',kind:'video',durationFrames:600}];base.clips=[{id:'a',assetId:'talk',inFrame:30,outFrame:330,volume:1}];
 window.project=validateProject(base);window.historyStack=[];window.plans=[];window.previewed=[];window.enhanced=[];window.polished=[];window.errors=[];window.readResolvers=[];window.failRead=false;window.failApply=false;window.delayRead=false;window.prepareCount=0;
 window.transcript=[{start:4.2,end:5,text:'嗯',words:[{start:4.3,end:4.6,text:'嗯'}]},{start:5,end:6,text:'这个故事值得讲述。'},{start:6.2,end:7.2,text:'这个故事值得讲述。'},{start:8,end:10,text:'嗯，我们继续讲正文。'}];
 const root=document.querySelector('#root');const render=()=>{root.innerHTML=ui.render();};
 const wait=async()=>{if(window.delayRead)await new Promise(resolve=>window.readResolvers.push(resolve));if(window.failRead)throw Error('尚未转写');};
 const ui=createSpokenUI({project:()=>window.project,changed:render,
 prepare:async()=>{window.prepareCount++;window.project=validateProject({...window.project,revision:window.project.revision+1,assets:window.project.assets.map(a=>({...a,proxyId:'asset-'+ 'a'.repeat(64)}))});},
 fetchTranscript:async()=>{await wait();return window.transcript;},fetchSilence:async()=>{await wait();return [{start:2,end:4}];},
 apply:async plan=>{if(window.failApply)throw Error('保存失败，原片未改变');window.historyStack.push(window.project);window.project=applyOperations(window.project,plan.operations,plan.baseRevision);window.plans.push(plan);},
 undo:()=>{window.project=window.historyStack.pop()??window.project;},canUndo:()=>window.historyStack.length>0,
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
  await p.goto(url);
  await p.locator("#spoken-asset").waitFor();
  return p;
}
const click = (p, name) => p.getByRole("button", { name, exact: true }).click();

test("actual spoken UI reads real-shaped analysis, reviews source mapping, skips, atomically applies and undoes", async () => {
  const p = await page();
  await click(p, "读取已有结果");
  await p.locator(".spoken-candidate").first().waitFor();
  assert.equal(await p.locator("[data-spoken-candidate]:checked").count(), 0);
  assert.equal(await p.locator("[data-spoken-candidate]:disabled").count(), 1);
  const pause = p
    .locator(".spoken-candidate")
    .filter({ has: p.locator("strong", { hasText: "长停顿" }) });
  await pause.getByRole("button", { name: "试听定位" }).click();
  const preview = await p.evaluate(() => window.previewed[0]);
  assert.equal(preview.sourceStartFrame, 53);
  assert.equal(preview.timelineStartFrame, 23);
  assert.equal(preview.timelineEndFrame, 97);
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
  assert.equal(await p.evaluate(() => window.project.revision), 1);
  assert.deepEqual(
    await p.evaluate(() => window.project.clips.map((c) => [c.inFrame, c.outFrame])),
    [
      [30, 65],
      [115, 330],
    ],
  );
  await click(p, "撤销上次编辑");
  assert.deepEqual(
    await p.evaluate(() => window.project.clips.map((c) => [c.inFrame, c.outFrame])),
    [[30, 330]],
  );
  await p.close();
});
test("metadata-only preparation refreshes the revision, missing words stay honest, and original voice enhancement/polish pass actual choices", async () => {
  const p = await page();
  await click(p, "准备口播并分析");
  await p.locator(".spoken-candidate").first().waitFor();
  assert.equal(await p.evaluate(() => window.prepareCount), 1);
  assert.equal(await p.evaluate(() => window.project.revision), 1);
  await click(p, "勾选长停顿");
  await click(p, "应用所选删减");
  assert.equal(await p.evaluate(() => window.plans[0].baseRevision), 1);
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
  assert.equal(await p.evaluate(() => window.project.revision), 2);
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
  assert.equal(await p.evaluate(() => window.project.revision), 0);
  assert.equal(await p.locator("[data-spoken-candidate]:checked").count(), 1);
  await p.evaluate(() => {
    window.delayRead = true;
    window.failApply = false;
  });
  await click(p, "读取已有结果");
  await p.getByRole("status").waitFor();
  await p.evaluate(() => {
    window.project = { ...window.project, id: "another-project" };
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
  assert.equal(await p.evaluate(() => window.plans[0].projectId), "another-project");
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
