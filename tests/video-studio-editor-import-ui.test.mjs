import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
let browser, source;
before(async () => {
  source = (
    await build({
      stdin: {
        contents: `export {EditorImportUI} from './apps/video-studio/src/editor/import-ui'; export {EditorSession} from './apps/video-studio/src/editor/session'; export {migrateLegacyProject} from './apps/video-studio/src/editor/migration'; export {createDemoProject} from './apps/video-studio/src/model';`,
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      },
      bundle: true,
      write: false,
      format: "iife",
      globalName: "editor",
      platform: "browser",
      target: "chrome120",
      plugins: [
        {
          name: "native-import-boundary",
          setup(build) {
            build.onResolve({ filter: /^\.\/import-media$/ }, () => ({
              path: "native-import-boundary",
              namespace: "fixture",
            }));
            build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents: `export function createEditorMediaImporter(_panel, options) { return { async importFiles(files,{signal}) { const identity=options.getIdentity(); window.fixture.uploads++; options.onProgress({index:0,total:files.length,name:files[0].name,phase:'inspect'}); return new Promise((resolve,reject) => { window.fixture.finish = (errors=[]) => resolve({identity,errors,assets:[{id:'new-source',name:files[0].name,kind:'video',duration:56056,width:320,height:180,resourceId:'asset-'+ 'a'.repeat(64)}]}); signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}); }); }, async importResources(resources) { const identity=options.getIdentity(); window.fixture.referenced.push(...resources.map((item)=>item.id)); return {identity,errors:[],assets:resources.map((item)=>({id:'ref-'+item.id.slice(-4),name:item.name,kind:'video',duration:56056,width:320,height:180,resourceId:item.id}))}; },dispose(){window.fixture.disposed=true;} }; }`,
              loader: "js",
            }));
          },
        },
      ],
    })
  ).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});
async function fixture(t, references) {
  const page = await browser.newPage();
  const uncaught = [];
  page.on("pageerror", (error) => uncaught.push(error.message));
  page.setDefaultTimeout(5000);
  t.after(async () => {
    await page.close();
    assert.deepEqual(uncaught, []);
  });
  await page.route("http://127.0.0.1:41789/**", (route) =>
    route.fulfill({ contentType: "text/html", body: '<main id="import"></main>' }),
  );
  await page.goto("http://127.0.0.1:41789/import");
  await page.addScriptTag({ content: source });
  await page.evaluate(async (references) => {
    let document = editor.migrateLegacyProject(editor.createDemoProject()),
      storageRevision = 4;
    window.fixture = { uploads: 0, fail: false, writes: 0, referenced: [], picks: 0, chooser: 0 };
    const session = await editor.EditorSession.open(
      {
        read: async () => ({ data: document, revision: storageRevision }),
        backupLegacy: async () => {},
        write: async (value) => {
          fixture.writes++;
          if (fixture.holdWrite) {
            fixture.holdWrite = false;
            await new Promise((resolve) => {
              fixture.releaseWrite = resolve;
            });
          }
          if (fixture.fail) throw new Error("磁盘已满");
          document = structuredClone(value);
          return { revision: ++storageRevision };
        },
      },
      { autosaveDelayMs: 60000 },
    );
    const ui = new editor.EditorImportUI(session, {}, window.document.querySelector("main"), {
      pickReferences: () =>
        references === "copy"
          ? undefined
          : references
            ? async () => {
                fixture.picks++;
                if (references === "fail") throw new Error("系统文件窗口打不开");
                return [{ id: "external-" + "b".repeat(64), name: "DJI_0001.MP4", lastModified: 7 }];
              }
            : undefined,
    });
    window.document.querySelector("[data-editor-media-input]").click = () => fixture.chooser++;
    Object.assign(fixture, {
      read: () => session.read(),
      state: () => session.getState(),
      stored: () => document,
      rename: () =>
        session.dispatch(
          [{ type: "project.rename", name: "导入时继续编辑" }],
          session.getState().identity,
        ),
      commitRename: () =>
        session.dispatchDurable(
          [{ type: "project.rename", name: "后台录音准备完成" }],
          session.getState().identity,
        ),
      replace: () => session.replace({ ...session.read(), id: "another" }),
      undo: () => session.undo(),
      dispose: () => ui.dispose(),
      choose: () => ui.choose(),
    });
  }, references);
  return page;
}
async function choose(page) {
  await page.locator("[data-editor-media-input]").setInputFiles({
    name: "NTSC-ProRes.mov",
    mimeType: "video/quicktime",
    buffer: Buffer.from("native boundary fixture"),
  });
  await page.waitForFunction(() => fixture.uploads === 1);
}
test("native import publishes exact ticks after concurrent edits and remains one undoable durable change", async (t) => {
  const page = await fixture(t);
  await choose(page);
  await page.evaluate(() => {
    fixture.rename();
    fixture.finish([{ name: "bad.mkv", message: "没有可读流" }]);
  });
  await page.waitForFunction(() => fixture.read().assets.some((a) => a.id === "new-source"));
  const value = await page.evaluate(() => ({ doc: fixture.read(), stored: fixture.stored() }));
  assert.equal(value.doc.name, "导入时继续编辑");
  assert.equal(value.doc.assets.find((a) => a.id === "new-source").duration, 56056);
  assert.deepEqual(value.doc, value.stored);
  assert.match(await page.locator(".editor-import-status").innerText(), /bad.mkv：没有可读流/);
  await page.evaluate(() => fixture.undo());
  assert.equal(
    await page.evaluate(() => fixture.read().assets.some((a) => a.id === "new-source")),
    false,
  );
  assert.equal(await page.evaluate(() => fixture.read().name), "导入时继续编辑");
});
test("failed project persistence retains imported assets for retry without another upload or early publish", async (t) => {
  const page = await fixture(t);
  await choose(page);
  await page.evaluate(() => {
    fixture.fail = true;
    fixture.finish();
  });
  await page.getByRole("button", { name: "重试加入工程" }).waitFor();
  assert.equal(
    await page.evaluate(() => fixture.read().assets.some((a) => a.id === "new-source")),
    false,
  );
  assert.match(await page.locator(".editor-import-status").innerText(), /磁盘已满/);
  await page.evaluate(() => {
    fixture.fail = false;
  });
  await page.getByRole("button", { name: "重试加入工程" }).click();
  await page.waitForFunction(() => fixture.read().assets.some((a) => a.id === "new-source"));
  assert.equal(await page.evaluate(() => fixture.uploads), 1);
  assert.equal(await page.evaluate(() => fixture.state().dirty), false);
});
test("cancelled native import leaves project content unchanged", async (t) => {
  const page = await fixture(t),
    before = await page.evaluate(() => fixture.read());
  await choose(page);
  await page.getByRole("button", { name: "取消此次导入" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".editor-import-status p").textContent.includes("取消"),
  );
  assert.deepEqual(await page.evaluate(() => fixture.read()), before);
  assert.equal(await page.evaluate(() => fixture.writes), 0);
  await page.getByRole("button", { name: "关闭导入提示" }).click();
  assert.equal(await page.locator(".editor-import-status").isVisible(), false);
});
test("late import results cannot enter a different document, and disposal removes controls", async (t) => {
  const page = await fixture(t);
  await choose(page);
  await page.evaluate(async () => {
    await fixture.replace();
    fixture.finish();
  });
  await page.waitForFunction(() =>
    document.querySelector(".editor-import-status p").textContent.includes("工程已切换"),
  );
  assert.equal(
    await page.evaluate(() => fixture.read().assets.some((a) => a.id === "new-source")),
    false,
  );
  await page.evaluate(() => fixture.dispose());
  assert.equal(await page.locator(".editor-import-status").count(), 0);
  assert.equal(await page.evaluate(() => fixture.disposed), true);
});
test("a clean import notice clears itself while partial failures stay until closed", async (t) => {
  const page = await fixture(t);
  // Controllable timers: the 3 s auto-hide is fast-forwarded instead of waited for.
  await page.clock.install();
  await choose(page);
  await page.evaluate(() => fixture.finish());
  await page.waitForFunction(() => fixture.read().assets.some((a) => a.id === "new-source"));
  await page.clock.runFor(3000);
  await page.locator(".editor-import-status").waitFor({ state: "hidden" });

  await page.evaluate(() => {
    fixture.uploads = 0;
  });
  await choose(page);
  await page.evaluate(() => fixture.finish([{ name: "bad.mkv", message: "没有可读流" }]));
  await page.waitForFunction(() =>
    document.querySelector(".editor-import-status p").textContent.includes("已导入"),
  );
  await page.clock.runFor(3500);
  assert.equal(await page.locator(".editor-import-status").isVisible(), true);
  await page.getByRole("button", { name: "关闭导入提示" }).click();
  assert.equal(await page.locator(".editor-import-status").isVisible(), false);
});

test("import waits for an in-flight durable publication and uses its saved revision", async (t) => {
  const page = await fixture(t);
  await choose(page);
  await page.evaluate(() => {
    fixture.holdWrite = true;
    fixture.commit = fixture.commitRename();
  });
  await page.waitForFunction(() => !!fixture.releaseWrite);
  await page.evaluate(() => fixture.finish());
  await page.getByRole("status").filter({ hasText: "等待工程保存完成" }).waitFor();
  assert.equal(await page.evaluate(() => fixture.writes), 1);
  assert.equal(
    await page.evaluate(() => fixture.read().assets.some((a) => a.id === "new-source")),
    false,
  );
  await page.evaluate(async () => {
    fixture.releaseWrite();
    await fixture.commit;
  });
  await page.waitForFunction(() => fixture.read().assets.some((a) => a.id === "new-source"));
  const result = await page.evaluate(() => ({
    doc: fixture.read(),
    stored: fixture.stored(),
    uploads: fixture.uploads,
    writes: fixture.writes,
  }));
  assert.equal(result.doc.name, "后台录音准备完成");
  assert.deepEqual(result.doc, result.stored);
  assert.equal(result.uploads, 1);
  assert.equal(result.writes, 2);
});

for (const action of ["cancel", "dispose", "replace"]) {
  test(`import waiting on a durable write cannot publish after ${action}`, async (t) => {
    const page = await fixture(t);
    await choose(page);
    await page.evaluate(() => {
      fixture.holdWrite = true;
      fixture.commit = fixture.commitRename();
    });
    await page.waitForFunction(() => !!fixture.releaseWrite);
    if (action === "replace") {
      await page.evaluate(() => {
        fixture.replacing = fixture.commit.then(() => fixture.replace());
      });
    }
    await page.evaluate(() => fixture.finish());
    await page.getByRole("status").filter({ hasText: "等待工程保存完成" }).waitFor();
    if (action === "cancel") await page.getByRole("button", { name: "取消此次导入" }).click();
    if (action === "dispose") await page.evaluate(() => fixture.dispose());
    await page.evaluate(async () => {
      fixture.releaseWrite();
      await fixture.commit;
      await fixture.replacing;
    });
    if (action === "cancel") await page.getByRole("button", { name: "重试加入工程" }).waitFor();
    if (action === "replace")
      await page.locator(".editor-import-status").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() => fixture.read().assets.some((a) => a.id === "new-source")),
      false,
    );
    assert.equal(await page.evaluate(() => fixture.uploads), 1);
    assert.equal(await page.evaluate(() => fixture.writes), action === "replace" ? 2 : 1);
  });
}

test("import references originals in place without the copy chooser or any upload", async (t) => {
  const page = await fixture(t, "reference");
  await page.evaluate(() => {
    fixture.choose();
    fixture.choose();
  });
  await page.waitForFunction(() =>
    fixture.read().assets.some((a) => a.resourceId === "external-" + "b".repeat(64)),
  );
  const value = await page.evaluate(() => ({
    picks: fixture.picks,
    chooser: fixture.chooser,
    uploads: fixture.uploads,
    referenced: fixture.referenced,
    stored: fixture.stored().assets.some((a) => a.resourceId === "external-" + "b".repeat(64)),
  }));
  assert.deepEqual(value, {
    picks: 1,
    chooser: 0,
    uploads: 0,
    referenced: ["external-" + "b".repeat(64)],
    stored: true,
  });
  assert.match(await page.locator(".editor-import-status").innerText(), /已引用 1 个素材.*未复制原片/);
});
test("the copy chooser opens only when the Host cannot reference originals", async (t) => {
  const page = await fixture(t, "copy");
  await page.evaluate(() => fixture.choose());
  assert.deepEqual(await page.evaluate(() => [fixture.chooser, fixture.picks]), [1, 0]);
});
test("a failed reference picker reports the error and leaves the project unchanged", async (t) => {
  const page = await fixture(t, "fail"),
    before = await page.evaluate(() => fixture.read());
  await page.evaluate(() => fixture.choose());
  await page.getByRole("status").filter({ hasText: "系统文件窗口打不开" }).waitFor();
  assert.deepEqual(await page.evaluate(() => fixture.read()), before);
  assert.equal(await page.evaluate(() => fixture.chooser), 0);
  await page.evaluate(() => fixture.choose());
  await page.waitForFunction(() => fixture.picks === 2);
});
