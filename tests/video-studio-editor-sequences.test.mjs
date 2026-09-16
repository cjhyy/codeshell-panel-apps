import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
let browser, page, server, origin;
before(async () => {
  const bundle = await build({
    stdin: {
      contents: `export * from './apps/video-studio/src/editor/sequences-ui';export * from './apps/video-studio/src/editor/sequence-edits';export * from './apps/video-studio/src/editor/defaults';export * from './apps/video-studio/src/editor/host-storage';export {EditorSession} from './apps/video-studio/src/editor/session';`,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "api",
    platform: "browser",
    target: "chrome120",
  });
  server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><html lang="zh-CN"><body style="margin:0;background:#0b1019"><main id="mount" style="width:380px;height:980px"></main></body></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 760, height: 980 } });
  page.setDefaultTimeout(5000);
  await page.goto(origin);
  await page.addStyleTag({
    content: await readFile(
      new URL("../apps/video-studio/public/editor-sequences.css", import.meta.url),
      "utf8",
    ),
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.addScriptTag({
    content: `
    const T=240000;let counter=0;
    globalThis.fixture=()=>{const v=()=>({transform:api.defaultTransform(),color:api.defaultColorAdjustment(),blendMode:'normal'});const a={id:'a',kind:'media',label:'开场镜头',trackId:'v',start:T+5,duration:2*T,assetId:'asset',timeMap:{points:[{time:0,source:0},{time:T,source:2*T},{time:2*T,source:3*T}]},audio:api.defaultAudioMix(),...v()};a.transform.x={keyframes:[{time:0,value:0,easing:'linear'},{time:2*T,value:.2,easing:'ease-in'}]};const sound={...structuredClone(a),id:'sound',label:'同期声',trackId:'audio'};a.linkGroupId=sound.linkGroupId='linked';const caption={id:'caption',kind:'text',role:'subtitle',label:'中文字幕',trackId:'text',start:T+5,duration:2*T,text:'你好\\n世界',style:api.defaultTextStyle(),words:[{text:'你好',start:0,end:T},{text:'世界',start:T,end:2*T}],sourceBinding:{clipId:'a',sourceStart:0,sourceEnd:3*T,provenance:{path:[],assetId:'asset',start:0,end:3*T}},...v()};return{schemaVersion:2,timebase:T,id:'project',name:'多序列交互',revision:0,activeSequenceId:'main',exportProfiles:[],assets:[{id:'asset',name:'素材',kind:'video',duration:10*T,width:160,height:90}],sequences:[{id:'main',name:'主序列',width:160,height:90,frameRate:{numerator:30000,denominator:1001},background:'#102030',timelineMode:'free',tracks:[api.createTrack('v','video','画面'),api.createTrack('audio','audio','同期声'),api.createTrack('text','text','字幕')],clips:[a,sound,caption],transitions:[],markers:[]}]};};
    globalThis.mount=()=>{globalThis.sequences?.dispose();globalThis.sequences=api.mountEditorSequences(document.querySelector('#mount'),{read:()=>session.read(),selection:()=>selected,time:()=>now,onError:error=>errors.push(error.message),select:value=>{selected=value;selectCalls.push(value);},activate:id=>navigation.push(id),apply:async(ops,label)=>{const identity=session.getState().identity;calls.push({ops,label});if(waitApply)await waitApply;session.dispatch(ops,identity,label);}});};
    globalThis.reset=async(initial=fixture(),ids=['a'])=>{sequences?.dispose();if(globalThis.session)await session.close({save:false});globalThis.scope='sequences-test-'+(++counter);globalThis.storage=await api.createEditorHostStorage(undefined,{persistent:true,scopeKey:scope});globalThis.session=await api.EditorSession.open(storage,{initialDocument:initial,autosaveDelayMs:60000});globalThis.selected={sequenceId:initial.activeSequenceId,clipIds:ids};globalThis.now=T;globalThis.errors=[];globalThis.calls=[];globalThis.selectCalls=[];globalThis.navigation=[];globalThis.waitApply=null;mount();};
  `.replace(
      "sequences?.dispose();if(globalThis.session)",
      "globalThis.sequences?.dispose();if(globalThis.session)",
    ),
  });
});
after(async () => {
  if (page) {
    await page.evaluate(async () => {
      await session.close({ save: false });
      sequences.dispose();
    });
  }
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});
beforeEach(async () => page.evaluate(() => reset()));
async function open(title) {
  const detail = page
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: title }) });
  if (!(await detail.evaluate((node) => node.open))) await detail.locator("summary").click();
  return detail;
}
async function click(text) {
  await page.getByRole("button", { name: text, exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".editor-sequences fieldset")?.disabled);
}
const documentValue = () => page.evaluate(() => session.read());

test("real forms create and open rational-fps sequence, rename and deep duplicate through one session", async () => {
  await open("新建空白序列");
  await page.getByLabel("新序列名称", { exact: true }).fill("竖屏预告");
  await page.getByLabel("画布宽度（像素）").fill("90");
  await page.getByLabel("画布高度（像素）").fill("160");
  await page.getByLabel("新序列帧率").selectOption("24000/1001");
  await click("创建并打开空白序列");
  let doc = await documentValue(),
    current = doc.sequences.find((s) => s.id === doc.activeSequenceId);
  assert.equal(current.name, "竖屏预告");
  assert.equal(current.width, 90);
  assert.deepEqual(current.frameRate, { numerator: 24000, denominator: 1001 });
  assert.equal(doc.revision, 1);
  assert.equal(await page.evaluate(() => navigation.length), 1);
  await page.getByLabel("序列名称", { exact: true }).fill("竖版正式稿");
  await click("重命名序列");
  assert.equal((await documentValue()).sequences[1].name, "竖版正式稿");
  await page.getByLabel("待管理序列").selectOption("main");
  await page.getByLabel("副本名称").fill("独立剪辑");
  await click("复制完整序列");
  doc = await documentValue();
  current = doc.sequences.find((s) => s.id === doc.activeSequenceId);
  assert.equal(current.name, "独立剪辑");
  assert.equal(current.clips.length, 3);
  assert.notEqual(current.clips[0].id, "a");
  assert.equal(doc.assets.length, 1);
});

test("compound UI expands linked sound and captions; real IndexedDB flush, undo, redo and reopen preserve the canonical document", async () => {
  const before = await documentValue();
  await page.getByLabel("复合片段名称").fill("完整开场");
  await click("创建复合片段");
  let doc = await documentValue();
  assert.equal(doc.sequences[0].clips.length, 1);
  assert.equal(doc.sequences[1].clips.length, 3);
  assert.deepEqual(doc.sequences[1].clips[0].timeMap, before.sequences[0].clips[0].timeMap);
  assert.match(await page.getByRole("status").innerText(), /3 个相关/);
  await page.evaluate(async () => {
    await session.flush();
    globalThis.saved = await storage.read();
    session.undo();
    sequences.render();
    await session.flush();
  });
  assert.deepEqual((await documentValue()).sequences, before.sequences);
  assert.deepEqual(await page.evaluate(() => saved.data.sequences), doc.sequences);
  await page.evaluate(async () => {
    session.redo();
    sequences.render();
    await session.flush();
    globalThis.expected = session.read();
    await session.close();
    storage = await api.createEditorHostStorage(undefined, { persistent: true, scopeKey: scope });
    session = await api.EditorSession.open(storage, { autosaveDelayMs: 60000 });
    mount();
  });
  assert.deepEqual(await documentValue(), await page.evaluate(() => expected));
  await click("解除复合片段");
  doc = await documentValue();
  assert.equal(doc.sequences.length, 2);
  assert.equal(doc.sequences[0].clips.length, 3);
  assert.equal(doc.sequences[0].clips[0].start, 240005);
  assert.equal(doc.sequences[0].clips.find((c) => c.kind === "text").text, "你好\n世界");
  assert.deepEqual(doc.sequences[0].clips[0].transform, before.sequences[0].clips[0].transform);
});

test("editing compound content opens its real sequence and nested insertion uses the click-time playhead", async () => {
  await click("创建复合片段");
  const combined = await documentValue(),
    child = combined.sequences[1].id;
  await click("编辑复合内容");
  assert.equal((await documentValue()).activeSequenceId, child);
  assert.deepEqual(await page.evaluate(() => selected), { sequenceId: child, clipIds: [] });
  await page.getByLabel("待管理序列").selectOption("main");
  await open("加入当前时间轴");
  await click("在播放头加入序列");
  assert.match(await page.getByRole("alert").innerText(), /环/);
  assert.equal((await documentValue()).sequences[1].clips.length, 3);
  await page.getByLabel("待管理序列").selectOption("main");
  await click("打开序列");
  await page.getByLabel("待管理序列").selectOption(child);
  await open("加入当前时间轴");
  await page.evaluate(() => {
    now = 5 * 240000 + 17;
  });
  await click("在播放头加入序列");
  assert.equal((await documentValue()).sequences[0].clips.at(-1).start, 5 * 240000 + 17);
});

test("direct and indirectly linked locks prevent edits, and retimed wrappers explain why unpack is unavailable", async () => {
  await page.evaluate(async () => {
    const doc = fixture();
    doc.sequences[0].tracks[0].locked = true;
    await reset(doc);
  });
  assert.equal(
    await page.getByRole("button", { name: "创建复合片段", exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.evaluate(() => calls.length), 0);
  await page.evaluate(async () => {
    const doc = fixture();
    doc.sequences[0].tracks[1].locked = true;
    await reset(doc);
  });
  await click("创建复合片段");
  assert.match(await page.getByRole("alert").innerText(), /锁定/);
  assert.equal(await page.evaluate(() => calls.length), 0);
  await page.evaluate(() => reset());
  await click("创建复合片段");
  await page.evaluate(() => {
    const doc = session.read(),
      clip = doc.sequences[0].clips[0];
    session.dispatch(
      [
        {
          type: "clip.update",
          sequenceId: "main",
          clipId: clip.id,
          patch: { transform: { ...clip.transform, scaleX: 1.2 } },
        },
      ],
      doc.revision,
      "缩放复合",
    );
    sequences.render();
  });
  await click("解除复合片段");
  assert.match(await page.getByRole("alert").innerText(), /整体效果/);
  assert.equal((await documentValue()).sequences[0].clips.length, 1);
});

test("editing text fields survives ordinary playhead render and names are rendered as text", async () => {
  await page.getByLabel("复合片段名称").fill("尚未提交的名称");
  await page.evaluate(() => {
    now += 12345;
    sequences.render();
  });
  assert.equal(await page.getByLabel("复合片段名称").inputValue(), "尚未提交的名称");
  await page.getByLabel("序列名称", { exact: true }).fill('<img src=x onerror="window.bad=1">');
  await click("重命名序列");
  assert.equal(await page.locator(".editor-sequences img").count(), 0);
  assert.equal(await page.evaluate(() => globalThis.bad), undefined);
});

test("renaming another managed sequence leaves active timeline and selection untouched; referenced delete stays disabled", async () => {
  await click("创建复合片段");
  const before = await page.evaluate(() => ({ selected, active: session.read().activeSequenceId }));
  await page.getByLabel("序列名称", { exact: true }).fill("内部镜头");
  await click("重命名序列");
  assert.deepEqual(
    await page.evaluate(() => ({ selected, active: session.read().activeSequenceId })),
    before,
  );
  assert.equal(await page.getByRole("button", { name: "删除空闲序列" }).isDisabled(), true);
});

test("pending operation cannot double-submit, stale session identity rejects and dispose prevents late navigation", async () => {
  await page.evaluate(() => {
    waitApply = new Promise((resolve) => {
      globalThis.release = resolve;
    });
  });
  await page.getByRole("button", { name: "创建复合片段", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "创建复合片段", exact: true }).isDisabled(),
    true,
  );
  await page.evaluate(() => {
    session.dispatch(
      [{ type: "project.rename", name: "外部更新" }],
      session.read().revision,
      "外部更新",
    );
    release();
  });
  await page.waitForFunction(() => !document.querySelector("fieldset").disabled);
  assert.match(await page.getByRole("alert").innerText(), /工程或版本已改变/);
  assert.equal((await documentValue()).sequences.length, 1);
  await page.evaluate(() => reset());
  await page.evaluate(() => {
    waitApply = new Promise((resolve) => {
      globalThis.release = resolve;
    });
  });
  await page.getByRole("button", { name: "复制完整序列", exact: true }).click();
  await page.evaluate(() => {
    sequences.dispose();
    release();
  });
  await page.waitForFunction(() => session.read().sequences.length === 2);
  assert.equal(await page.evaluate(() => navigation.length), 0);
  assert.equal(await page.locator(".editor-sequences").count(), 0);
});

test("narrow panel stays within its bounds and screenshot shows readable compound management", async () => {
  await click("创建复合片段");
  await page.locator("#mount").screenshot({ path: "/tmp/video-studio-editor-sequences.png" });
  assert.equal(
    await page
      .locator(".editor-sequences")
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
    true,
  );
});
