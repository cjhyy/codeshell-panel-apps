import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
let source, browser;
before(async () => {
  source = (
    await build({
      stdin: {
        contents: `export {EditorPortableUI} from './apps/video-studio/src/editor/portable-ui';export {EditorSession} from './apps/video-studio/src/editor/session';export {migrateLegacyProject} from './apps/video-studio/src/editor/migration';export {createDemoProject} from './apps/video-studio/src/model';`,
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      },
      bundle: true,
      write: false,
      format: "iife",
      globalName: "editor",
      platform: "browser",
      target: "chrome120",
    })
  ).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});
async function fixture(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: options.width ?? 900, height: 740 } }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(5000);
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
  });
  await page.route("http://127.0.0.1:41839/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<main></main>" }),
  );
  await page.goto("http://127.0.0.1:41839/portable");
  await page.addScriptTag({ content: source });
  await page.evaluate(async () => {
    let stored = editor.migrateLegacyProject(editor.createDemoProject()),
      storageRevision = 1;
    const fixture = (window.fixture = {
      calls: [],
      errors: [],
      imports: 0,
      exports: 0,
      replacements: 0,
      cleanups: 0,
      failWrite: false,
      failCleanup: false,
      saveResult: { saved: true, name: "工程.mimiproject" },
      cwd: "/workspace",
    });
    const session = await editor.EditorSession.open(
      {
        read: async () => ({ data: stored, revision: storageRevision }),
        backupLegacy: async () => {},
        write: async (doc) => {
          if (fixture.holdWrite)
            await new Promise((resolve) => {
              fixture.finishWrite = resolve;
            });
          if (fixture.failWrite) throw new Error("磁盘已满");
          stored = structuredClone(doc);
          return { revision: ++storageRevision };
        },
      },
      { autosaveDelayMs: 60000 },
    );
    const candidate = structuredClone(session.read());
    candidate.id = "imported-project";
    candidate.name = "带素材的开放工程";
    const second = structuredClone(candidate.sequences[0]);
    second.id = "second";
    second.name = "第二序列";
    candidate.sequences.push(second);
    candidate.assets[0].metadata = { sourcePath: "/untrusted/old-device.mov" };
    const receipt = {
      transferId: "editor-00000000-0000-0000-0000-000000000000",
      sourceResourceId: "asset-" + "a".repeat(64),
      bundleHash: "a".repeat(64),
      manifest: {
        id: "asset-" + "b".repeat(64),
        sha256: "b".repeat(64),
        bytes: 1234,
        mimeType: "application/json",
      },
      mediaCount: candidate.assets.length,
      workspaceKey: "scope",
    };
    let received = 0,
      sequence = 0,
      expectedBytes = 0;
    const uploaded = () => ({
      id: "asset-" + "a".repeat(64),
      sha256: "a".repeat(64),
      bytes: expectedBytes,
      mimeType: "application/zip",
      state: "available",
    });
    const panel = {
      getContext: async () => {
        if (fixture.holdContext) {
          fixture.holdContext = false;
          await new Promise((resolve) => {
            fixture.releaseContext = resolve;
          });
        }
        return {
          cwd: fixture.cwd,
          availableMethods: [
            "resources.upload.begin",
            "resources.upload.write",
            "resources.upload.finish",
            "resources.upload.cancel",
            "resources.get",
            "media.export",
          ],
          capabilities: {
            bridge: { maxCallsPerWindow: 100000, maxTransferCallsPerWindow: 100000 },
          },
        };
      },
      on: () => () => {},
      async call(method, params) {
        fixture.calls.push({ method, params });
        if (method === "resources.upload.begin") {
          received = 0;
          sequence = 0;
          expectedBytes = params.expectedBytes;
          if (fixture.holdBegin)
            await new Promise((resolve) => {
              fixture.releaseBegin = resolve;
            });
          return {
            sessionId: "upload-00000000-0000-0000-0000-000000000001",
            state: "uploading",
            receivedBytes: 0,
            nextSequence: 0,
            maxChunkBytes: 65536,
            maxFileBytes: 20 * 1024 ** 3,
          };
        }
        if (method === "resources.upload.write") {
          if (params.offset !== received || params.sequence !== sequence)
            throw new Error("bad offsets");
          const bytes = atob(params.dataBase64).length;
          if (bytes > 32768) throw new Error("upload chunk too large");
          received += bytes;
          sequence++;
          return {
            sessionId: params.sessionId,
            state: "uploading",
            receivedBytes: received,
            nextSequence: sequence,
          };
        }
        if (method === "resources.upload.finish") {
          if (received !== expectedBytes) throw new Error("truncated upload");
          return { asset: uploaded() };
        }
        if (method === "resources.get") return { asset: fixture.resourceAsset ?? uploaded() };
        if (method === "resources.upload.cancel") return { cancelled: true };
        if (method === "media.export") {
          if (fixture.failSave) throw new Error("保存位置不可写");
          return fixture.saveResult;
        }
        throw new Error(method);
      },
    };
    const tasks = {
      async importProjectBundle(resourceId, options) {
        fixture.imports++;
        fixture.lastImportReceipt = options.receipt;
        fixture.importSignal = options.signal;
        options.onImportReceipt(receipt);
        options.onProgress({ phase: "resources", completed: 1, total: 3 });
        await new Promise((resolve, reject) => {
          fixture.finishImport = resolve;
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        });
        return { document: structuredClone(candidate), receipt: structuredClone(receipt) };
      },
      async exportProjectBundle(doc, options) {
        fixture.exports++;
        fixture.exportDoc = structuredClone(doc);
        fixture.exportSignal = options.signal;
        const snapshot = {
          kind: "project",
          transferId: receipt.transferId,
          documentHash: "c".repeat(64),
          documentId: doc.id,
          revision: doc.revision,
          sequenceId: doc.activeSequenceId,
          byteLength: 100,
          chunkCount: 1,
          resourceIds: [],
          workspaceKey: "scope",
        };
        options.onSnapshot(snapshot);
        if (fixture.holdExport)
          await new Promise((resolve, reject) => {
            fixture.finishExport = resolve;
            options.signal.addEventListener(
              "abort",
              () => reject(new DOMException("cancelled", "AbortError")),
              { once: true },
            );
          });
        return {
          bundle: {
            id: "asset-" + "d".repeat(64),
            sha256: "d".repeat(64),
            bytes: 1000,
            mimeType: "application/zip",
            ...(fixture.bundlePatch ?? {}),
          },
          snapshot,
        };
      },
      async discardProjectImport(value) {
        fixture.cleanups++;
        fixture.lastCleanup = value;
        if (fixture.failCleanup) throw new Error(fixture.cleanupError ?? "临时目录正在使用");
        return { discarded: true };
      },
    };
    const ui = new editor.EditorPortableUI({
      panel,
      tasks,
      session: () => session,
      replace: async (doc, expectedIdentity) => {
        fixture.replacements++;
        fixture.replaceIdentity = expectedIdentity;
        await session.replace(doc, { identity: expectedIdentity });
      },
      assertEditable: () => {
        if (fixture.readOnly) throw new Error("请先完成当前保存");
      },
      onError: (error) => fixture.errors.push(error.message),
    });
    const originalArrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      throw new Error("whole file buffering is forbidden");
    };
    Object.assign(fixture, {
      read: () => session.read(),
      state: () => session.getState(),
      stored: () => stored,
      ui,
      candidate,
      rename: () =>
        session.dispatch(
          [{ type: "project.rename", name: "后来修改" }],
          session.getState().identity,
        ),
      originalArrayBuffer,
    });
  });
  return page;
}
async function choose(page, bytes = 120000) {
  await page.locator("[data-editor-portable-input]").setInputFiles({
    name: "工程.mimiproject",
    mimeType: "application/zip",
    buffer: Buffer.alloc(bytes, 0x5a),
  });
  await page.waitForFunction(() => fixture.imports > 0);
}
async function review(page) {
  await page.evaluate(() => fixture.finishImport());
  await page.getByRole("button", { name: "打开这份工程", exact: true }).waitFor();
}
test("uploads bounded slices and presents a reviewable complete project before a single durable replacement", async (t) => {
  const page = await fixture(t),
    identity = await page.evaluate(() => fixture.state().identity);
  await choose(page);
  await review(page);
  assert.equal(await page.evaluate(() => fixture.replacements), 0);
  assert.match(
    await page.locator("[data-portable-summary]").innerText(),
    /带素材的开放工程[\s\S]*2 个序列[\s\S]*第二序列/,
  );
  const calls = await page.evaluate(() => fixture.calls);
  assert.deepEqual(
    calls
      .filter((call) => call.method === "resources.upload.write")
      .map((call) => Buffer.from(call.params.dataBase64, "base64").length),
    [32768, 32768, 32768, 21696],
  );
  await page.getByRole("button", { name: "打开这份工程", exact: true }).click();
  await page.waitForFunction(
    () => fixture.read().id === "imported-project" && fixture.cleanups === 1,
  );
  assert.equal(await page.evaluate(() => fixture.replacements), 1);
  assert.deepEqual(await page.evaluate(() => fixture.replaceIdentity), identity);
  assert.deepEqual(
    await page.evaluate(() => fixture.read()),
    await page.evaluate(() => fixture.stored()),
  );
  assert.equal(
    await page.evaluate(() => fixture.read().assets[0].metadata.sourcePath),
    "/untrusted/old-device.mov",
  );
});
test("storage failure retains candidate and receipt, retry opens without reupload or reimport", async (t) => {
  const page = await fixture(t);
  await choose(page);
  await review(page);
  await page.evaluate(() => {
    fixture.failWrite = true;
  });
  await page.getByRole("button", { name: "打开这份工程", exact: true }).click();
  await page.getByRole("button", { name: "重试打开工程" }).waitFor();
  assert.notEqual(await page.evaluate(() => fixture.read().id), "imported-project");
  assert.equal(await page.evaluate(() => fixture.cleanups), 0);
  await page.evaluate(() => {
    fixture.failWrite = false;
  });
  await page.getByRole("button", { name: "重试打开工程" }).click();
  await page.waitForFunction(() => fixture.read().id === "imported-project");
  assert.equal(await page.evaluate(() => fixture.imports), 1);
  assert.equal(
    await page.evaluate(
      () => fixture.calls.filter((call) => call.method === "resources.upload.begin").length,
    ),
    1,
  );
});
test("cleanup failure never repeats an already committed replacement", async (t) => {
  const page = await fixture(t);
  await choose(page);
  await review(page);
  await page.evaluate(() => {
    fixture.failCleanup = true;
  });
  await page.getByRole("button", { name: "打开这份工程", exact: true }).click();
  await page.getByRole("button", { name: "重试清理临时文件" }).waitFor();
  assert.equal(await page.evaluate(() => fixture.read().id), "imported-project");
  await page.evaluate(() => {
    fixture.failCleanup = false;
  });
  await page.getByRole("button", { name: "重试清理临时文件" }).click();
  await page.waitForFunction(() => fixture.cleanups === 2);
  assert.equal(await page.evaluate(() => fixture.replacements), 1);
});
test("cancelling while upload.begin is pending cancels its late ticket and never starts import", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    fixture.holdBegin = true;
  });
  await page
    .locator("[data-editor-portable-input]")
    .setInputFiles({ name: "a.zip", mimeType: "application/zip", buffer: Buffer.alloc(1000) });
  await page.waitForFunction(() => fixture.releaseBegin);
  await page.getByRole("button", { name: "取消此次操作" }).click();
  await page.evaluate(() => fixture.releaseBegin());
  await page.waitForFunction(() =>
    fixture.calls.some((call) => call.method === "resources.upload.cancel"),
  );
  assert.equal(await page.evaluate(() => fixture.imports), 0);
  assert.equal(
    await page.evaluate(
      () => fixture.calls.filter((call) => call.method === "resources.upload.write").length,
    ),
    0,
  );
});
test("cancelled native preparation resumes its receipt and reuses the persisted ZIP", async (t) => {
  const page = await fixture(t);
  await choose(page);
  await page.getByRole("button", { name: "取消此次操作" }).click();
  await page.getByRole("button", { name: "继续导入" }).waitFor();
  await page.getByRole("button", { name: "继续导入" }).click();
  await page.waitForFunction(() => fixture.imports === 2);
  assert.equal(await page.evaluate(() => fixture.lastImportReceipt.bundleHash), "a".repeat(64));
  assert.equal(
    await page.evaluate(
      () => fixture.calls.filter((call) => call.method === "resources.upload.begin").length,
    ),
    1,
  );
  await review(page);
});
test("stale initial identity blocks replacement after ordinary edits", async (t) => {
  const page = await fixture(t);
  await choose(page);
  await review(page);
  await page.evaluate(() => fixture.rename());
  await page.getByRole("button", { name: "打开这份工程", exact: true }).click();
  await page.waitForFunction(() =>
    fixture.errors.some((message) => message.includes("当前工程已变化")),
  );
  assert.equal(await page.evaluate(() => fixture.replacements), 0);
  assert.equal(await page.evaluate(() => fixture.read().name), "后来修改");
});
test("export cancels during pending save without starting package preparation", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    fixture.rename();
    fixture.holdWrite = true;
    void fixture.ui.exportCurrent();
  });
  await page.waitForFunction(() => fixture.finishWrite);
  await page.getByRole("button", { name: "取消此次操作" }).click();
  await page.evaluate(() => fixture.finishWrite());
  await page.getByRole("button", { name: "重试打包" }).waitFor();
  assert.equal(await page.evaluate(() => fixture.exports), 0);
});
test("cancelled or failed Host save reuses the same prepared bundle", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    fixture.saveResult = { cancelled: true };
    void fixture.ui.exportCurrent();
  });
  await page.getByRole("button", { name: "保存工程包", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => fixture.exports), 1);
  await page.evaluate(() => {
    fixture.failSave = true;
  });
  await page.getByRole("button", { name: "保存工程包", exact: true }).click();
  await page.waitForFunction(() => fixture.errors.includes("保存位置不可写"));
  await page.evaluate(() => {
    fixture.failSave = false;
    fixture.saveResult = { saved: true, name: "最终工程.mimiproject" };
  });
  await page.getByRole("button", { name: "保存工程包", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[role="status"]').textContent.includes("最终工程"),
  );
  assert.equal(await page.evaluate(() => fixture.exports), 1);
  assert.equal(
    await page.evaluate(
      () => fixture.calls.filter((call) => call.method === "media.export").length,
    ),
    3,
  );
});
test("export captures a complete frozen document while later editing continues", async (t) => {
  const page = await fixture(t),
    before = await page.evaluate(() => fixture.read());
  await page.evaluate(() => {
    fixture.holdExport = true;
    void fixture.ui.exportCurrent();
  });
  await page.waitForFunction(() => fixture.finishExport);
  await page.evaluate(() => {
    fixture.rename();
    fixture.finishExport();
  });
  await page.waitForFunction(() => fixture.calls.some((call) => call.method === "media.export"));
  assert.deepEqual(await page.evaluate(() => fixture.exportDoc), before);
  assert.equal(await page.evaluate(() => fixture.read().name), "后来修改");
});
test("disposal releases a late upload ticket and leaves no dialog or task startup", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    fixture.holdBegin = true;
  });
  await page
    .locator("[data-editor-portable-input]")
    .setInputFiles({ name: "a.zip", mimeType: "application/zip", buffer: Buffer.alloc(1000) });
  await page.waitForFunction(() => fixture.releaseBegin);
  await page.evaluate(() => {
    fixture.ui.dispose();
    fixture.releaseBegin();
  });
  await page.waitForFunction(() =>
    fixture.calls.some((call) => call.method === "resources.upload.cancel"),
  );
  assert.equal(await page.locator(".editor-portable-dialog").count(), 0);
  assert.equal(await page.evaluate(() => fixture.imports), 0);
});
test("narrow review stays inside viewport and untrusted names remain text", async (t) => {
  const page = await fixture(t, { width: 390 });
  await page.evaluate(() => {
    fixture.candidate.name = '<img src=x onerror="window.executed=true">开放工程名'.repeat(3);
    fixture.candidate.sequences[1].name = "很长的序列名称".repeat(12);
  });
  await choose(page);
  await review(page);
  assert.equal(await page.locator(".editor-portable-dialog img").count(), 0);
  assert.equal(await page.evaluate(() => window.executed === true), false);
  assert.equal(
    await page.evaluate(() => {
      const dialog = document.querySelector("dialog");
      const rect = dialog.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth;
    }),
    true,
  );
  await page.screenshot({ path: join(tmpdir(), "video-studio-portable-review-390.png") });
});

test("agent portable export receipts deduplicate, preserve frozen revision and require exact pending identity", async (t) => {
  const page = await fixture(t);
  const result = await page.evaluate(() => {
    fixture.holdExport = true;
    const request = { action: "export", requestId: "export-test" },
      identity = fixture.state().identity;
    const a = fixture.ui.execute(request, identity),
      b = fixture.ui.execute(
        { requestId: request.requestId, action: request.action },
        {
          revision: identity.revision,
          generation: identity.generation,
          documentId: identity.documentId,
        },
      );
    return { a, b };
  });
  assert.deepEqual(result.a, result.b);
  await page.waitForFunction(() => fixture.exports === 1 && fixture.finishExport);
  await page.evaluate(() => fixture.rename());
  await page.evaluate(() => fixture.finishExport());
  await page.waitForFunction(() => !fixture.ui.getState().busy);
  const state = await page.evaluate(() => fixture.ui.getState());
  assert.equal(state.pending.saved, true);
  assert.equal(state.operation.status, "completed");
  assert.equal(await page.evaluate(() => fixture.exportDoc.name === fixture.read().name), false);
  assert.equal(
    await page.evaluate(() => {
      try {
        fixture.ui.execute(
          { action: "save", requestId: "save-wrong", pendingId: "wrong" },
          fixture.state().identity,
        );
        return false;
      } catch (e) {
        return /已变化/.test(e.message);
      }
    }),
    true,
  );
});

test("agent portable import reads actual resource, exposes exact candidate and applies only a reviewed pending ID", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    fixture.resourceAsset = {
      id: "asset-" + "a".repeat(64),
      bytes: 1200,
      sha256: "a".repeat(64),
      mimeType: "application/zip",
    };
    fixture.ui.execute(
      { action: "import", requestId: "import-test", resourceId: fixture.resourceAsset.id },
      fixture.state().identity,
    );
  });
  await page.waitForFunction(() => fixture.imports === 1 && fixture.finishImport);
  await page.evaluate(() => fixture.finishImport());
  await page.waitForFunction(() => !fixture.ui.getState().busy);
  const review = await page.evaluate(() => {
    const s = fixture.ui.getState(),
      doc = fixture.ui.readCandidate(s.pending.pendingId);
    let refused = false;
    try {
      fixture.ui.execute(
        { action: "continue", requestId: "implicit-apply", pendingId: s.pending.pendingId },
        fixture.state().identity,
      );
    } catch (e) {
      refused = /明确应用/.test(e.message);
    }
    return { s, doc, refused };
  });
  assert.equal(review.doc.id, "imported-project");
  assert.equal(review.s.pending.sequenceCount, 2);
  assert.equal(review.refused, true);
  await page.evaluate(
    (id) =>
      fixture.ui.execute(
        { action: "apply", requestId: "apply-test", pendingId: id },
        fixture.state().identity,
      ),
    review.s.pending.pendingId,
  );
  await page.waitForFunction(() => !fixture.ui.getState().busy);
  assert.equal(await page.evaluate(() => fixture.read().id), "imported-project");
  assert.equal(await page.evaluate(() => fixture.replacements), 1);
  assert.equal(await page.evaluate(() => fixture.ui.getState().pending), null);
});

test("same-turn cancellation before apply starts preserves its candidate and never replaces the project", async (t) => {
  const page = await fixture(t);
  await choose(page);
  await review(page);
  await page.evaluate(() => {
    const pendingId = fixture.ui.getState().pending.pendingId,
      identity = fixture.state().identity;
    fixture.ui.execute({ action: "apply", requestId: "apply-before-cancel", pendingId }, identity);
    fixture.ui.execute({ action: "cancel", requestId: "cancel-before-start", pendingId }, identity);
  });
  await page.waitForFunction(() => !fixture.ui.getState().busy);
  assert.equal(await page.evaluate(() => fixture.replacements), 0);
  assert.equal(await page.evaluate(() => fixture.ui.getState().pending.ready), true);
  assert.equal(await page.evaluate(() => fixture.cleanups), 0);
  await page.evaluate(() =>
    fixture.ui.execute(
      {
        action: "apply",
        requestId: "apply-explicit-retry",
        pendingId: fixture.ui.getState().pending.pendingId,
      },
      fixture.state().identity,
    ),
  );
  await page.waitForFunction(() => !fixture.ui.getState().busy);
  assert.equal(await page.evaluate(() => fixture.replacements), 1);
});

test("pending context lookup is cancellable and a continued import keeps the original resource request", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    fixture.holdContext = true;
    fixture.resourceAsset = { id: "asset-" + "a".repeat(64), sha256: "a".repeat(64), bytes: 1200 };
    const request = {
      action: "import",
      requestId: "context-import",
      resourceId: fixture.resourceAsset.id,
    };
    fixture.ui.execute(request, fixture.state().identity);
    request.resourceId = "asset-" + "b".repeat(64);
  });
  await page.waitForFunction(() => fixture.releaseContext && fixture.ui.getState().pending);
  await page.evaluate(() => {
    const pendingId = fixture.ui.getState().pending.pendingId;
    fixture.ui.execute(
      { action: "cancel", requestId: "context-cancel", pendingId },
      fixture.state().identity,
    );
    fixture.releaseContext();
  });
  await page.waitForFunction(() => !fixture.ui.getState().busy);
  assert.equal(await page.evaluate(() => fixture.imports), 0);
  await page.evaluate(() =>
    fixture.ui.execute(
      {
        action: "continue",
        requestId: "context-resume",
        pendingId: fixture.ui.getState().pending.pendingId,
      },
      fixture.state().identity,
    ),
  );
  await page.waitForFunction(() => fixture.imports === 1);
  assert.equal(
    await page.evaluate(
      () => fixture.calls.find((c) => c.method === "resources.get").params.assetId,
    ),
    "asset-" + "a".repeat(64),
  );
  await review(page);
});

test("identity is rechecked after an asynchronous context lookup before any replacement callback", async (t) => {
  const page = await fixture(t);
  await choose(page);
  await review(page);
  await page.evaluate(() => {
    fixture.holdContext = true;
    fixture.ui.execute(
      {
        action: "apply",
        requestId: "stale-during-guard",
        pendingId: fixture.ui.getState().pending.pendingId,
      },
      fixture.state().identity,
    );
  });
  await page.waitForFunction(() => fixture.releaseContext);
  await page.evaluate(() => {
    fixture.rename();
    fixture.releaseContext();
  });
  await page.waitForFunction(() => !fixture.ui.getState().busy);
  assert.equal(await page.evaluate(() => fixture.replacements), 0);
  assert.equal(await page.evaluate(() => fixture.ui.getState().operation.status), "failed");
  assert.equal(await page.evaluate(() => fixture.read().name), "后来修改");
});

test("public status and candidate are detached, and failed cleanup exposes no native path or false success", async (t) => {
  const page = await fixture(t);
  await choose(page);
  await review(page);
  await page.evaluate(() => {
    const state = fixture.ui.getState();
    const candidate = fixture.ui.readCandidate(state.pending.pendingId);
    state.pending.identity.revision = 999999;
    candidate.name = "malicious mutation";
    fixture.failCleanup = true;
    fixture.cleanupError = "cannot unlink /private/var/task-cache/private-user/transfer.json";
    fixture.ui.execute(
      { action: "apply", requestId: "apply-cleanup-fail", pendingId: state.pending.pendingId },
      fixture.state().identity,
    );
  });
  await page.waitForFunction(() => !fixture.ui.getState().busy);
  const state = await page.evaluate(() => fixture.ui.getState());
  assert.equal(state.operation.status, "failed");
  assert.equal(state.pending.applied, true);
  assert.doesNotMatch(JSON.stringify(state), /\/private|transfer\.json/);
  assert.equal(await page.evaluate(() => fixture.read().name), "带素材的开放工程");
  await page.evaluate(() => {
    fixture.failCleanup = false;
    fixture.ui.execute(
      {
        action: "continue",
        requestId: "cleanup-only-retry",
        pendingId: fixture.ui.getState().pending.pendingId,
      },
      fixture.state().identity,
    );
  });
  await page.waitForFunction(() => !fixture.ui.getState().busy);
  assert.equal(await page.evaluate(() => fixture.replacements), 1);
  assert.equal(await page.evaluate(() => fixture.ui.getState().operation.status), "completed");
});

test("agent abandon reports a cleanup failure accurately and native preparation cancellation has a cancelled outcome", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    fixture.resourceAsset = { id: "asset-" + "a".repeat(64), sha256: "a".repeat(64), bytes: 1200 };
    fixture.ui.execute(
      { action: "import", requestId: "import-cancel-status", resourceId: fixture.resourceAsset.id },
      fixture.state().identity,
    );
  });
  await page.waitForFunction(() => fixture.imports === 1);
  await page.getByRole("button", { name: "取消此次操作" }).click();
  await page.waitForFunction(() => !fixture.ui.getState().busy);
  assert.equal(await page.evaluate(() => fixture.ui.getState().operation.status), "cancelled");
  await page.evaluate(() => {
    fixture.failCleanup = true;
    fixture.ui.execute(
      {
        action: "cancel",
        requestId: "abandon-cleanup-fail",
        pendingId: fixture.ui.getState().pending.pendingId,
      },
      fixture.state().identity,
    );
  });
  await page.waitForFunction(() => !fixture.ui.getState().busy);
  assert.equal(await page.evaluate(() => fixture.ui.getState().operation.status), "failed");
  assert.notEqual(await page.evaluate(() => fixture.ui.getState().pending), null);
  assert.equal(await page.evaluate(() => fixture.replacements), 0);
});

test("public export status bounds artifact metadata and never exposes private receipt paths", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    fixture.bundlePatch = {
      name: "/private/cache/" + "工程".repeat(3000) + ".mimiproject",
      path: "/private/cache/bundle.zip",
      privateMetadata: "x".repeat(100000),
    };
    fixture.saveResult = {
      saved: true,
      name: "/Users/private-person/Exports/最终工程.mimiproject",
    };
    fixture.ui.execute({ action: "export", requestId: "bounded-status" }, fixture.state().identity);
  });
  await page.waitForFunction(() => !fixture.ui.getState().busy);
  const state = await page.evaluate(() => fixture.ui.getState()),
    serialized = JSON.stringify(state);
  assert.equal(state.operation.status, "completed");
  assert.equal(state.pending.saved, true);
  assert.ok(Buffer.byteLength(serialized) < 4000);
  assert.ok(state.pending.bundle.name.length <= 200);
  assert.doesNotMatch(serialized, /\/private|\/Users|privateMetadata|private-person/);
  assert.match(state.message, /最终工程\.mimiproject/);
});
