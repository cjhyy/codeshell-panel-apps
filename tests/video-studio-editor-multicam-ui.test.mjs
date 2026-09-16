import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
let browser, page, server, dir, origin;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "multicam-ui-"));
  const video = join(dir, "colors.webm"),
    result = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=red:s=96x64:r=30:d=2",
        "-f",
        "lavfi",
        "-i",
        "color=blue:s=96x64:r=30:d=2",
        "-f",
        "lavfi",
        "-i",
        "color=green:s=96x64:r=30:d=2",
        "-f",
        "lavfi",
        "-i",
        "color=yellow:s=96x64:r=30:d=2",
        "-filter_complex",
        "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]",
        "-map",
        "[v]",
        "-c:v",
        "libvpx-vp9",
        "-lossless",
        "1",
        video,
      ],
      { encoding: "utf8" },
    );
  assert.equal(result.status, 0, result.stderr);
  const bytes = await readFile(video);
  server = createServer((req, res) => {
    if (req.url === "/video") {
      res.setHeader("Content-Type", "video/webm");
      res.setHeader("Accept-Ranges", "bytes");
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
      if (range) {
        const start = Number(range[1]),
          end = range[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
        res.setHeader("Content-Length", end - start + 1);
        res.end(bytes.subarray(start, end + 1));
      } else {
        res.setHeader("Content-Length", bytes.length);
        res.end(bytes);
      }
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<!doctype html><html lang="zh-CN"><body style="margin:0;background:#0b1019"><main id="mount" style="width:380px;height:1100px"></main></body></html>',
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const bundle = await build({
    stdin: {
      contents: `export * from './apps/video-studio/src/editor/multicam-ui';export * from './apps/video-studio/src/editor/multicam-edits';export * from './apps/video-studio/src/editor/defaults';export * from './apps/video-studio/src/editor/operations';export {EditorHistory} from './apps/video-studio/src/editor/history';`,
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
  page = await browser.newPage({ viewport: { width: 800, height: 1100 } });
  page.setDefaultTimeout(6000);
  await page.goto(origin);
  await page.addStyleTag({
    content: await readFile(
      new URL("../apps/video-studio/public/editor-multicam.css", import.meta.url),
      "utf8",
    ),
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.addScriptTag({
    content: `const T=240000;globalThis.fixture=()=>({schemaVersion:2,timebase:T,id:'doc',name:'多机位录制',revision:0,activeSequenceId:'main',exportProfiles:[],assets:[{id:'a',name:'正面',kind:'video',duration:8*T,width:96,height:64},{id:'b',name:'侧面',kind:'video',duration:8*T,width:96,height:64}],sequences:[{id:'main',name:'节目',width:96,height:64,frameRate:{numerator:30,denominator:1},background:'#000000',timelineMode:'free',tracks:[api.createTrack('v','video')],clips:[],transitions:[],markers:[]}]});globalThis.reset=(group=true)=>{globalThis.multicam?.dispose();let doc=fixture();if(group)doc=api.applyEditorOperations(doc,api.planCreateMulticam(doc,'main',{assetIds:['a','b'],name:'双机位',at:0,offsets:{b:2*T}}),doc.revision);globalThis.editorHistory=new api.EditorHistory(doc);globalThis.selected={sequenceId:'main',clipIds:doc.sequences[0].clips.map(c=>c.id)};globalThis.now=T/2;globalThis.playing=false;globalThis.errors=[];globalThis.calls=[];globalThis.readCalls=0;globalThis.playWait=null;globalThis.alignWait=null;globalThis.uncertain=false;globalThis.resolveCalls=0;globalThis.multicam=api.mountEditorMulticam(document.querySelector('#mount'),{read:()=>{readCalls++;return editorHistory.read();},selection:()=>selected,time:()=>now,select:value=>selected=value,onError:e=>errors.push(e.message),apply:async(ops,label)=>{calls.push({ops,label});editorHistory.apply(ops,editorHistory.revision,label);},resolveAsset:()=>{resolveCalls++;return location.origin+'/video';},play:async()=>{if(playWait)await playWait;playing=true;},pause:()=>playing=false,playing:()=>playing,alignSources:async(ids,reference,options)=>{globalThis.alignmentSignal=options.signal;const document=editorHistory.read();if(alignWait)await alignWait;return{documentId:document.id,revision:document.revision,documentHash:'a'.repeat(64),referenceAssetId:reference,reused:false,results:ids.map((assetId,index)=>({assetId,offset:index?T/4:0,confidence:uncertain?.3:1,secondPeak:0,overlapSeconds:5,precisionTicks:1200,reliable:!uncertain,reason:uncertain?'相似度不足':undefined}))};}});};globalThis.clip=()=>editorHistory.read().sequences[0].clips[0];globalThis.advance=t=>{now=t*T;};`,
  });
});
after(async () => {
  await page?.evaluate(() => multicam.dispose());
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => page.evaluate(() => reset()));
async function details(title) {
  const node = page
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: title }) });
  if (!(await node.evaluate((node) => node.open))) await node.locator("summary").click();
  return node;
}
async function click(text) {
  await page.getByRole("button", { name: text, exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".editor-multicam fieldset")?.disabled);
}
async function canvasColor(name) {
  const tile = page.getByRole("button", { name: `切换到机位 ${name}` });
  await page
    .waitForFunction(
      (name) =>
        document.querySelector(`button[aria-label="切换到机位 ${name}"] canvas`)?.dataset
          .sourceTime,
      name,
    )
    .catch(async (error) => {
      throw new Error(
        JSON.stringify(
          await page.evaluate(() => ({
            errors,
            reads: readCalls,
            resolves: resolveCalls,
            monitor: multicam.monitorBusy,
            signature: multicam.signature,
            labels: [...document.querySelectorAll(".emc-grid small")].map((n) => n.textContent),
          })),
        ) + error.message,
      );
    });
  return tile
    .locator("canvas")
    .evaluate((canvas) => Array.from(canvas.getContext("2d").getImageData(96, 54, 1, 1).data));
}
test("actual camera monitors seek the same source to independent offset times and cut changes only picture", async () => {
  const a = await canvasColor("正面"),
    b = await canvasColor("侧面");
  assert.ok(a[0] > 240 && a[2] < 10);
  assert.ok(b[2] > 240 && b[0] < 10);
  const master = await page.evaluate(() => clip().audioAngleId);
  await click("切换到机位 侧面");
  assert.equal(await page.evaluate(() => clip().audioAngleId), master);
  assert.equal(await page.evaluate(() => clip().switches.length), 2);
  assert.equal(await page.evaluate(() => clip().switches[1].time), 120000);
});
test("create form uses selected assets and adds a true multicam clip through one atomic operation", async () => {
  await page.evaluate(() => reset(false));
  await details("创建机位组");
  await page.getByLabel("选择机位素材 正面").check();
  await page.getByLabel("选择机位素材 侧面").check();
  await page.getByLabel("机位组名称").fill("访谈双机位");
  await click("创建多机位片段");
  assert.equal(await page.evaluate(() => clip().kind), "multicam");
  assert.equal(await page.evaluate(() => clip().label), "访谈双机位");
  assert.equal(await page.evaluate(() => calls.length), 1);
  assert.equal(await page.evaluate(() => selected.clipIds[0] === clip().id), true);
});
test("recording waits for media preparation, records live angle changes, keeps audio continuous and saves one undo step", async () => {
  await page.evaluate(() => {
    playWait = new Promise((resolve) => (globalThis.releasePlay = resolve));
  });
  await click("播放并录制切换");
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => calls.length), 0);
  assert.equal(await page.getByRole("button", { name: "停止并保存切换" }).count(), 1);
  await page.evaluate(() => releasePlay());
  await page.waitForFunction(() => playing);
  await page.evaluate(() => advance(1));
  await click("切换到机位 侧面");
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="切换录制节目画面"]').dataset.angle ===
      clip().angles[1].id,
  );
  assert.equal(await page.evaluate(() => clip().switches.length), 1);
  await page.evaluate(() => advance(1.5));
  await page.getByLabel("机位切换键盘区").focus();
  await page.keyboard.press("1");
  await page.evaluate(() => advance(2));
  await click("停止并保存切换");
  assert.equal(await page.evaluate(() => calls.length), 1);
  assert.deepEqual(
    await page.evaluate(() => clip().switches.map((c) => c.time)),
    [0, 240000, 360000],
  );
  assert.equal(await page.evaluate(() => clip().audioAngleId === clip().angles[0].id), true);
  await page.evaluate(() => {
    editorHistory.undo();
    multicam.render();
  });
  assert.equal(await page.evaluate(() => clip().switches.length), 1);
});
test("editable cut table changes precise seconds and delete restores the continuous first view", async () => {
  await click("切换到机位 侧面");
  await page.getByLabel("切点 2 时间（秒）").fill("0.725");
  await click("保存切点表");
  assert.equal(await page.evaluate(() => clip().switches[1].time), 174000);
  await click("删除切点 2");
  assert.equal(await page.evaluate(() => clip().switches.length), 1);
});
test("manual offset and master audio settings preserve nonedited effects; explicit common trimming keeps valid maps", async () => {
  await details("机位偏移与主声音");
  await page.getByLabel("机位 侧面 偏移（秒）").fill("2.25");
  await page.getByLabel("裁剪到所有机位的共同范围").check();
  await click("保存机位设置");
  assert.equal(await page.evaluate(() => clip().angles[1].offset), 540000);
  assert.equal(await page.evaluate(() => clip().duration), 5.75 * 240000);
  await details("机位偏移与主声音");
  await page
    .getByLabel("连续主声音机位")
    .selectOption(await page.evaluate(() => clip().angles[1].id));
  await click("保存机位设置");
  assert.equal(await page.evaluate(() => clip().audioAngleId === clip().angles[1].id), true);
});
test("uncertain audio analysis cannot apply, reliable result is reviewable and commits offsets atomically", async () => {
  await details("声音同步");
  await page.evaluate(() => (uncertain = true));
  await click("分析真实声音");
  assert.match(await page.locator(".emc-results").innerText(), /需手动确认/);
  assert.equal(
    await page.getByRole("button", { name: "应用同步并裁剪共同范围" }).isDisabled(),
    true,
  );
  assert.equal(await page.evaluate(() => calls.length), 0);
  await page.evaluate(() => (uncertain = false));
  await click("分析真实声音");
  await click("应用同步并裁剪共同范围");
  assert.equal(await page.evaluate(() => clip().angles[1].offset), 60000);
  assert.equal(await page.evaluate(() => calls.length), 1);
});
test("locked tracks block switches and settings; changing a document during recording discards its tentative cuts", async () => {
  await page.evaluate(() => {
    const doc = editorHistory.read();
    editorHistory.apply(
      [
        {
          type: "track.update",
          sequenceId: "main",
          trackId: clip().trackId,
          patch: { locked: true },
        },
      ],
      doc.revision,
      "锁定",
    );
    multicam.render();
  });
  assert.equal(await page.getByRole("button", { name: "播放并录制切换" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "切换到机位 侧面" }).isDisabled(), true);
  await page.evaluate(() => reset());
  await click("播放并录制切换");
  await page.evaluate(() => {
    editorHistory.apply(
      [{ type: "project.rename", name: "新版本" }],
      editorHistory.revision,
      "改名",
    );
    multicam.render();
  });
  await page.waitForFunction(() => errors.length > 0);
  assert.match(await page.getByRole("alert").innerText(), /工程或选择已改变/);
  assert.equal(await page.evaluate(() => clip().switches.length), 1);
});
test("hidden panels abort analysis, discard recording, stop document reads and release media instances", async () => {
  await canvasColor("正面");
  await click("播放并录制切换");
  await page.evaluate(() => {
    multicam.setVisible(false);
    globalThis.readsWhenHidden = readCalls;
    globalThis.resolvesWhenHidden = resolveCalls;
  });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => playing), false);
  assert.equal(await page.evaluate(() => readCalls), await page.evaluate(() => readsWhenHidden));
  assert.equal(
    await page.evaluate(() => resolveCalls),
    await page.evaluate(() => resolvesWhenHidden),
  );
  assert.equal(await page.evaluate(() => calls.length), 0);
  await page.evaluate(() => multicam.setVisible(true));
  await details("声音同步");
  await page.evaluate(() => {
    alignWait = new Promise((resolve) => (globalThis.releaseAlign = resolve));
  });
  await page.getByRole("button", { name: "分析真实声音" }).click();
  await page.evaluate(() => multicam.setVisible(false));
  assert.equal(await page.evaluate(() => alignmentSignal.aborted), true);
  await page.evaluate(() => {
    releaseAlign();
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => multicam.setVisible(true));
  assert.equal(await page.locator(".emc-results").count(), 0);
});
test("narrow multi-camera view remains bounded and is visually reviewed", async () => {
  await canvasColor("正面");
  await page.locator("#mount").screenshot({ path: "/tmp/video-studio-editor-multicam.png" });
  assert.equal(
    await page.locator(".editor-multicam").evaluate((node) => node.scrollWidth <= node.clientWidth),
    true,
  );
});

test("backwards playback seeks discard even when no cut was recorded at the later time", async () => {
  await click("播放并录制切换");
  await page.evaluate(() => advance(3));
  await page.waitForTimeout(60);
  await page.evaluate(() => advance(1));
  await page.waitForFunction(() => errors.length > 0);
  assert.match(await page.getByRole("alert").innerText(), /向后移动/);
  assert.equal(await page.evaluate(() => calls.length), 0);
  assert.equal(await page.evaluate(() => clip().switches.length), 1);
});
