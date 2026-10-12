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
    globalThis.mount=()=>{globalThis.sequences?.dispose();globalThis.sequences=api.mountEditorSequences(document.querySelector('#mount'),{read:()=>session.read(),identity:()=>session.getState().identity,selection:()=>selected,time:()=>now,onError:error=>errors.push(error.message),select:value=>{selected=value;selectCalls.push(value);},activate:id=>navigation.push(id),apply:async(ops,label)=>{const identity=session.getState().identity;calls.push({ops,label});if(waitApply)await waitApply;session.dispatch(ops,identity,label);}});};
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


test("same-id revision successor cannot inherit a focused sequence draft or detached rename", async () => {
  await page.getByLabel("序列名称", { exact: true }).fill("旧工程草稿");
  await page.evaluate(async () => {
    const old = [...document.querySelectorAll(".editor-sequences button")].find((button) => button.textContent === "重命名序列");
    const next = fixture();
    const slot = await api.createEditorHostStorage(undefined, { persistent: false });
    session = await api.EditorSession.open(slot, { initialDocument: next, autosaveDelayMs: 60000 });
    sequences.render();
    old.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  assert.equal(await page.getByLabel("序列名称", { exact: true }).inputValue(), "主序列");
  assert.equal((await documentValue()).sequences[0].name, "主序列");
  assert.equal(await page.evaluate(() => calls.length), 0);
  assert.deepEqual(await page.evaluate(() => errors), []);
});


test("a completed old sequence apply cannot navigate a same-id successor with the expected next revision", async () => {
  await page.evaluate(() => {
    const target = session;
    sequences.context.apply = async (ops, label) => {
      target.dispatch(ops, target.getState().identity, label);
      await new Promise((resolve) => globalThis.releaseCompletedSequence = resolve);
    };
  });
  await page.getByRole("button", { name: "复制完整序列", exact: true }).click();
  await page.evaluate(async () => {
    const next = session.read();
    const slot = await api.createEditorHostStorage(undefined, { persistent: false });
    session = await api.EditorSession.open(slot, { initialDocument: next, autosaveDelayMs: 60000 });
    sequences.render();
    releaseCompletedSequence();
  });
  await page.waitForFunction(() => !document.querySelector(".editor-sequences fieldset").disabled);
  assert.equal(await page.evaluate(() => navigation.length), 0);
  assert.equal(await page.evaluate(() => selectCalls.length), 0);
  assert.equal(await page.getByRole("status").count(), 0);
  assert.deepEqual(await page.evaluate(() => errors), []);
});

test("same-generation unrelated revisions still merge a connected sequence name form into fresh data", async () => {
  await page.getByLabel("序列名称", { exact: true }).fill("日常重命名草稿");
  await page.evaluate(() => session.dispatch([{ type: "project.rename", name: "同时修改的工程名称" }], session.getState().identity, "外部修改"));
  await click("重命名序列");
  const result = await documentValue();
  assert.equal(result.name, "同时修改的工程名称");
  assert.equal(result.sequences[0].name, "日常重命名草稿");
  await page.evaluate(() => session.undo());
  assert.equal((await documentValue()).sequences[0].name, "主序列");
  assert.equal((await documentValue()).name, "同时修改的工程名称");
  assert.deepEqual(await page.evaluate(() => errors), []);
});


test("sequence duplication finishing after an external scope switch does not navigate or announce the old operation", async () => {
  await page.evaluate(async () => {
    const doc = fixture();
    doc.sequences.push({ ...structuredClone(doc.sequences[0]), id: "other", name: "另一个序列", clips: [] });
    await reset(doc);
    const target = session;
    sequences.context.apply = async (ops, label) => {
      target.dispatch(ops, target.getState().identity, label);
      await new Promise((resolve) => globalThis.finishOldSequenceNavigation = resolve);
    };
  });
  await page.getByRole("button", { name: "复制完整序列", exact: true }).click();
  await page.evaluate(() => {
    selected = { sequenceId: "other", clipIds: [] };
    finishOldSequenceNavigation();
  });
  await page.waitForFunction(() => !document.querySelector(".editor-sequences fieldset").disabled);
  assert.equal(await page.evaluate(() => navigation.length), 0);
  assert.equal(await page.evaluate(() => selectCalls.length), 0);
  assert.equal(await page.getByRole("status").count(), 0);
  assert.deepEqual(await page.evaluate(() => selected), { sequenceId: "other", clipIds: [] });
  assert.deepEqual(await page.evaluate(() => errors), []);
});


test("late sequence persistence errors are not reported inside a different same-generation scope", async () => {
  await page.evaluate(async () => {
    const doc = fixture();
    doc.sequences.push({ ...structuredClone(doc.sequences[0]), id: "other", name: "另一个序列", clips: [] });
    await reset(doc);
    sequences.context.apply = () => new Promise((_resolve, reject) => globalThis.failOldSequence = reject);
  });
  await page.getByRole("button", { name: "重命名序列", exact: true }).click();
  await page.evaluate(() => {
    selected = { sequenceId: "other", clipIds: [] };
    failOldSequence(new Error("旧序列写入失败"));
  });
  await page.waitForFunction(() => !document.querySelector(".editor-sequences fieldset").disabled);
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.deepEqual(await page.evaluate(() => errors), []);
});

async function deletionFixture({ markersOnly = false, blank = false, name = "未使用的剪辑序列" } = {}) {
  await page.evaluate(async ({ markersOnly, blank, name }) => {
    const doc = fixture(), other = structuredClone(doc.sequences[0]);
    other.id = "other"; other.name = name;
    if (markersOnly || blank) other.clips = [];
    if (!blank) other.markers = [{ id: "note", time: 240000, duration: 0, name: "待核对", color: "#ffcc00", note: "保留标记" }];
    doc.sequences.push(other);
    await reset(doc);
  }, { markersOnly, blank, name });
  await page.getByLabel("待管理序列", { exact: true }).selectOption("other");
}

test("deleting an unused sequence with content first confirms its actual contents and cancels without changing history", async () => {
  await deletionFixture();
  const before = await documentValue();
  await click("删除空闲序列");
  assert.deepEqual(await documentValue(), before);
  assert.match(await page.locator("[data-sequence-remove-confirmation]").innerText(), /未使用的剪辑序列.*3 个片段.*1 个标记.*3\.00 秒/s);
  await click("取消删除");
  assert.equal(await page.locator("[data-sequence-remove-confirmation]").count(), 0);
  assert.equal(await page.evaluate(() => calls.length), 0);
  assert.deepEqual(await documentValue(), before);
});

test("confirming sequence deletion removes only its target and one undo restores its contents and markers", async () => {
  await deletionFixture();
  const before = await documentValue(), selection = await page.evaluate(() => selected);
  await click("删除空闲序列"); await click("确认删除");
  const after = await documentValue();
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.sequences, [before.sequences[0]]);
  assert.deepEqual(after.assets, before.assets);
  assert.deepEqual(await page.evaluate(() => selected), selection);
  assert.equal(await page.evaluate(() => navigation.length), 0);
  assert.match(await page.getByRole("status").innerText(), /已删除.*3 个片段.*1 个标记.*撤销/);
  await page.evaluate(() => { session.undo(); sequences.render(); });
  assert.deepEqual((await documentValue()).sequences, before.sequences);
  assert.equal(await page.locator("[data-sequence-remove-confirmation]").count(), 0);
  assert.deepEqual(await page.evaluate(() => errors), []);
});

test("empty unused sequences delete directly but a marker-only sequence still requires confirmation", async () => {
  await deletionFixture({ blank: true });
  const before = await documentValue();
  await click("删除空闲序列");
  assert.equal((await documentValue()).revision, before.revision + 1);
  assert.equal((await documentValue()).sequences.length, 1);
  assert.equal(await page.locator("[data-sequence-remove-confirmation]").count(), 0);
  await deletionFixture({ markersOnly: true });
  const marked = await documentValue();
  await click("删除空闲序列");
  assert.deepEqual(await documentValue(), marked);
  assert.match(await page.locator("[data-sequence-remove-confirmation]").innerText(), /0 个片段.*1 个标记.*0\.00 秒/s);
});

test("sequence deletion confirmation expires across revision, generation, management ABA and active sequence changes", async () => {
  for (const change of ["revision", "generation", "managed", "active"]) {
    await deletionFixture(); await click("删除空闲序列");
    const old = await page.getByRole("button", { name: "确认删除", exact: true }).elementHandle();
    await page.evaluate(async (change) => {
      if (change === "revision") session.dispatch([{ type: "project.rename", name: "后台更新" }], session.getState().identity);
      if (change === "generation") {
        const document = session.read(); await session.close({ save: false });
        const slot = await api.createEditorHostStorage(undefined, { persistent: true, scopeKey: scope + "-replacement" });
        session = await api.EditorSession.open(slot, { initialDocument: document, autosaveDelayMs: 60000 });
      }
      if (change === "active") {
        session.dispatch([{ type: "sequence.activate", sequenceId: "other" }], session.getState().identity);
        selected = { sequenceId: "other", clipIds: [] };
      }
      if (change !== "managed") sequences.render();
    }, change);
    if (change === "managed") {
      await page.getByLabel("待管理序列").selectOption("main");
      await page.getByLabel("待管理序列").selectOption("other");
    }
    const afterChange = await documentValue();
    await old.evaluate((button) => { button.click(); button.dispatchEvent(new MouseEvent("click")); });
    assert.deepEqual(await documentValue(), afterChange, change);
    assert.equal(await page.locator("[data-sequence-remove-confirmation]").count(), 0, change);
    assert.equal(await page.evaluate(() => calls.length), 0, change);
  }
});

test("a connected old delete button cannot delete newly added content without fresh confirmation", async () => {
  await deletionFixture({ blank: true });
  await page.evaluate(() => {
    const sequence = session.read().sequences[0], clip = structuredClone(sequence.clips[0]);
    session.dispatch([{ type: "clip.add", sequenceId: "other", clip }], session.getState().identity);
  });
  const before = await documentValue();
  await click("删除空闲序列");
  assert.deepEqual(await documentValue(), before);
  assert.equal(await page.evaluate(() => calls.length), 0);
  assert.match(await page.getByRole("alert").innerText(), /重新确认/);
  await click("删除空闲序列");
  assert.match(await page.locator("[data-sequence-remove-confirmation]").innerText(), /1 个片段/);
});

test("fresh locks and newly added nested references block an old sequence deletion confirmation atomically", async () => {
  for (const change of ["lock", "reference"]) {
    await deletionFixture(); await click("删除空闲序列");
    await page.evaluate((change) => {
      const doc = session.read();
      session.dispatch(change === "lock" ? [{ type: "track.update", sequenceId: "other", trackId: "v", patch: { locked: true } }] :
        api.planNestSequence(doc, "main", "other", { at: 4 * 240000 }).operations, session.getState().identity);
    }, change);
    const before = await documentValue();
    await click("确认删除");
    assert.deepEqual(await documentValue(), before, change);
    assert.equal(await page.getByRole("button", { name: "删除空闲序列", exact: true }).isDisabled(), true, change);
    assert.match(await page.locator(".editor-sequences").innerText(), change === "lock" ? /锁定轨道/ : /复合片段引用/);
    assert.equal(await page.evaluate(() => calls.length), 0);
  }
});

test("a held deletion ignores repeated confirmation, retries a failed apply and never navigates after a scope change", async () => {
  await deletionFixture(); await click("删除空闲序列");
  await page.evaluate(() => {
    sequences.context.apply = (ops, label) => {
      calls.push({ ops, label });
      return new Promise((_resolve, reject) => { globalThis.rejectDeletion = reject; });
    };
  });
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).dispatchEvent("click");
  assert.equal(await page.evaluate(() => calls.length), 1);
  await page.evaluate(() => rejectDeletion(new Error("磁盘暂时不可写")));
  await page.waitForFunction(() => !document.querySelector(".editor-sequences fieldset").disabled);
  assert.match(await page.getByRole("alert").innerText(), /磁盘暂时不可写/);
  assert.equal(await page.locator("[data-sequence-remove-confirmation]").count(), 1);
  await page.evaluate(() => {
    const target = session;
    sequences.context.apply = async (ops, label) => {
      calls.push({ ops, label }); target.dispatch(ops, target.getState().identity, label);
      await new Promise((resolve) => { globalThis.finishDeletion = resolve; });
    };
  });
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.evaluate(() => { selected = { sequenceId: "other", clipIds: [] }; finishDeletion(); });
  await page.waitForFunction(() => !document.querySelector(".editor-sequences fieldset").disabled);
  assert.equal(await page.evaluate(() => calls.length), 2);
  assert.equal((await documentValue()).sequences.length, 1);
  assert.equal(await page.evaluate(() => navigation.length), 0);
  assert.equal(await page.getByRole("status").count(), 0);
});

test("deletion confirmation renders long names as text inside a 390 pixel panel", async () => {
  await deletionFixture({ name: '<img src=x onerror="window.badSequence=1">' + "很长的剪辑序列名称".repeat(15) });
  await page.setViewportSize({ width: 390, height: 980 });
  await click("删除空闲序列");
  const box = page.locator("[data-sequence-remove-confirmation]");
  assert.equal(await box.locator("img").count(), 0);
  assert.equal(await page.evaluate(() => window.badSequence), undefined);
  assert.equal(await box.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  assert.equal(await page.locator(".editor-sequences").evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  await box.screenshot({ path: "/tmp/video-studio-sequence-delete-confirm-390.png" });
  await page.setViewportSize({ width: 760, height: 980 });
});

test("confirming deletion of the active sequence opens its planned replacement and one undo restores the original", async () => {
  await deletionFixture(); await page.getByLabel("待管理序列").selectOption("main");
  const before = await documentValue();
  await click("删除空闲序列"); await click("确认删除");
  assert.deepEqual((await documentValue()).sequences, [before.sequences[1]]);
  assert.equal((await documentValue()).activeSequenceId, "other");
  assert.deepEqual(await page.evaluate(() => selected), { sequenceId: "other", clipIds: [] });
  assert.deepEqual(await page.evaluate(() => navigation), ["other"]);
  await page.evaluate(() => { session.undo(); sequences.render(); });
  assert.deepEqual((await documentValue()).sequences, before.sequences);
  assert.equal((await documentValue()).activeSequenceId, "main");
});

test("an outer sequence render cannot discard a newer deletion confirmation created by read reentry", async () => {
  await deletionFixture();
  const result = await page.evaluate(() => {
    const context = sequences.context, read = context.read;
    let next;
    context.read = () => {
      const old = read(); context.read = read;
      session.dispatch([{ type: "project.rename", name: "新确认所属版本" }], session.getState().identity);
      sequences.render();
      [...document.querySelectorAll(".editor-sequences button")].find((button) => button.textContent === "删除空闲序列").click();
      next = sequences.removal;
      return old;
    };
    sequences.render();
    return { started: !!next, owned: sequences.removal === next };
  });
  assert.deepEqual(result, { started: true, owned: true });
  assert.equal(await page.locator("[data-sequence-remove-confirmation]").count(), 1);
  await click("确认删除");
  assert.equal((await documentValue()).sequences.length, 1);
});
