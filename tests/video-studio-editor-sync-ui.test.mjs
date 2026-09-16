import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
let browser, source, style;
before(async () => {
  const result = await build({
    stdin: {
      contents: `export {EditorSyncUI} from './apps/video-studio/src/editor/sync-ui';export * from './apps/video-studio/src/editor/snapshot-sync';export {editorSyncContentHash} from './apps/video-studio/src/editor/sync-storage';export {EditorSession} from './apps/video-studio/src/editor/session';export {createDemoProject} from './apps/video-studio/src/model';export {migrateLegacyProject} from './apps/video-studio/src/editor/migration';`,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "editor",
    target: "chrome120",
    outfile: "fixture.js",
  });
  source = result.outputFiles.find((file) => file.path.endsWith(".js")).text;
  style = result.outputFiles.find((file) => file.path.endsWith(".css")).text;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});
async function fixture(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: options.width ?? 920, height: 800 } }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(6000);
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
  });
  await page.route("http://127.0.0.1:41837/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<main></main>" }),
  );
  await page.goto("http://127.0.0.1:41837/sync");
  await page.addStyleTag({ content: style });
  await page.addScriptTag({ content: source });
  await page.evaluate(async (options) => {
    const f = (window.fixture = {
      calls: [],
      errors: [],
      exports: 0,
      imports: 0,
      captures: 0,
      picks: 0,
      publications: 0,
      replaceCalls: 0,
      replacements: 0,
      cleanups: 0,
      cwd: "/workspace",
      failReplace: false,
      failCleanup: false,
      failState: false,
      failCommitted: false,
      waitExport: false,
      waitFlush: false,
      waitImport: false,
    });
    const base = editor.migrateLegacyProject(editor.createDemoProject());
    base.id = "sync-ui-project";
    base.name = "共同起点";
    const left = structuredClone(base),
      right = structuredClone(base);
    left.name = "本机工程";
    right.name = "另一设备工程";
    if (options.conflict) {
      left.sequences[0].name = "本机序列改名🙂";
      right.sequences[0].background = "#112233";
    } else right.production = { note: "另一台设备的完整备注" };
    if (options.untrusted)
      right.name = "<img src=x onerror=window.injected=true> " + "超长工程名称".repeat(25);
    const device = "11111111-1111-4111-8111-111111111111",
      bundle = (hash) => ({
        id: `asset-${hash.repeat(64)}`,
        sha256: hash.repeat(64),
        bytes: 1234,
        mimeType: "application/zip",
      }),
      bundles = [bundle("a"), bundle("b"), bundle("c")],
      documents = new Map(bundles.map((value, index) => [value.id, [base, left, right][index]]));
    const make = (b, parents, note) =>
      editor.createSnapshot({
        projectId: base.id,
        bundle: { sha256: b.sha256, bytes: b.bytes },
        parents,
        deviceId: device,
        createdAt: "2026-09-16T00:00:00.000Z",
        note,
      });
    const origin = await make(bundles[0], [], "共同起点"),
      local = await make(bundles[1], [origin.id], "本机完整版本"),
      remote = await make(bundles[2], [origin.id], "另一设备完整版本");
    f.remoteId = remote.id;
    f.localId = local.id;
    f.baseId = origin.id;
    f.snapshots = options.incomplete ? [remote] : [origin, local, remote];
    let stored = structuredClone(left),
      sessionRevision = 1,
      stateRevision = options.unpublished ? 0 : 1;
    let state = options.unpublished
      ? null
      : {
          format: "mimi-video-sync-client",
          version: 1,
          projectId: base.id,
          deviceId: device,
          base: {
            parents: [local.id],
            contentHash: await editor.editorSyncContentHash(left),
            needsPublish: false,
          },
          pendingPublication: null,
          imports: [],
          pendingApply: null,
        };
    f.state = () => structuredClone(state);
    const session = await editor.EditorSession.open(
      {
        read: async () => ({ data: stored, revision: sessionRevision }),
        backupLegacy: async () => {},
        write: async (doc) => {
          if (f.failReplace) throw Error("工程磁盘已满");
          stored = structuredClone(doc);
          return { revision: ++sessionRevision };
        },
      },
      { autosaveDelayMs: 60000 },
    );
    f.session = session;
    const oldFlush = session.flush.bind(session);
    session.flush = async () => {
      if (f.waitFlush) await new Promise((resolve) => (f.finishFlush = resolve));
      return oldFlush();
    };
    const panel = {
      getContext: async () => {
        if (f.waitContext) {
          f.waitContext = false;
          await new Promise((resolve) => (f.finishContext = resolve));
        }
        return {
          cwd: f.cwd,
          availableMethods: ["media.document.get", "media.document.set"],
          capabilities: {
            bridge: {
              maxCallsPerWindow: 100000,
              maxTransferCallsPerWindow: 100000,
              rateWindowMs: 1000,
            },
          },
        };
      },
      on: () => () => {},
      call: async (method, params) => {
        f.calls.push({ method, params: structuredClone(params) });
        if (method === "media.document.get")
          return { data: structuredClone(state), revision: stateRevision };
        if (method === "media.document.set") {
          if (f.failState || (f.failCommitted && params.data.pendingApply?.phase === "committed"))
            throw Error("同步状态 CAS 保存失败");
          if (params.baseRevision !== stateRevision)
            throw Error("Media document changed in another window");
          state = structuredClone(params.data);
          return { revision: ++stateRevision, updatedAt: Date.now() };
        }
        throw Error("unknown " + method);
      },
    };
    const tasks = {
      exportProjectBundle: async (doc, opts) => {
        f.exports++;
        f.frozen = structuredClone(doc);
        if (f.waitExport) await new Promise((resolve) => (f.finishExport = resolve));
        if (opts.signal?.aborted) throw new DOMException("cancelled", "AbortError");
        const hash = String(f.exports + 3).repeat(64),
          b = { id: `asset-${hash}`, sha256: hash, bytes: 1234, mimeType: "application/zip" };
        documents.set(b.id, structuredClone(doc));
        return { bundle: b, snapshot: {}, job: {} };
      },
      importProjectBundle: async (id, opts) => {
        f.imports++;
        const doc = documents.get(id);
        if (!doc) throw Error("missing test doc");
        const receipt = opts.receipt ?? {
          transferId: opts.transferId,
          bundleHash: id.slice(6),
          sourceResourceId: id,
          manifest: {
            id: "asset-" + "d".repeat(64),
            sha256: "d".repeat(64),
            bytes: 999,
            mimeType: "application/json",
          },
          mediaCount: doc.assets.length,
          workspaceKey: "e".repeat(64),
        };
        await opts.onImportReceipt?.(receipt);
        if (f.waitImport) await new Promise((resolve) => (f.finishImport = resolve));
        if (opts.signal?.aborted) throw new DOMException("cancelled", "AbortError");
        return { document: structuredClone(doc), receipt };
      },
      discardProjectImport: async () => {
        f.cleanups++;
        if (f.failCleanup) throw Error("清理暂存失败");
        return { discarded: true };
      },
    };
    const sync = {
      pickDirectory: async () => {
        f.picks++;
        return { handle: "22222222-2222-4222-8222-222222222222", name: "示例共享目录" };
      },
      history: async () => ({
        graph: editor.analyzeSnapshotGraph(f.snapshots),
        entries: f.snapshots.map((snapshot) => ({
          snapshot,
          bundleState: options.incomplete ? "missing" : "present-unverified",
        })),
        issues: [],
        inventory: "f".repeat(64),
      }),
      publish: async (_dir, input, opts) => {
        const receipt = input.receipt ?? {
          snapshot: input.snapshot,
          token: crypto.randomUUID(),
          bundle: input.bundle,
          supersededTokens: [],
        };
        await opts.onReceipt?.(receipt);
        if (opts.signal?.aborted) throw new DOMException("cancelled", "AbortError");
        f.publications++;
        if (!f.snapshots.some((item) => item.id === input.snapshot.id))
          f.snapshots.push(input.snapshot);
        return { snapshot: input.snapshot, receipt };
      },
      readSnapshot: async (_dir, _project, id) => {
        f.captures++;
        if (options.incomplete) throw Error("同步工程包尚未到达");
        const snapshot = f.snapshots.find((item) => item.id === id);
        return {
          snapshot,
          bundle: {
            id: "asset-" + snapshot.bundle.sha256,
            ...snapshot.bundle,
            mimeType: "application/zip",
          },
        };
      },
      discardPublication: async () => ({ discarded: true }),
      dispose: () => {},
    };
    f.options = {
      panel,
      tasks,
      sync,
      session: () => session,
      assertEditable: () => {},
      onError: (error) => f.errors.push(error.message),
      replace: async (doc, identity) => {
        f.replaceCalls++;
        await session.replace(doc, { identity, label: "同步采用版本" });
        f.replacements++;
      },
    };
    f.reopen = async () => {
      f.ui?.dispose();
      f.ui = new editor.EditorSyncUI(f.options);
      await f.ui.open();
    };
    await f.reopen();
  }, options);
  return page;
}
async function connect(page) {
  await page.locator("[data-sync-connect]").click();
  await page.waitForFunction(() =>
    document.querySelector("[data-sync-status]").textContent.includes("已连接"),
  );
  await page.waitForFunction(() => !document.querySelector("[data-sync-refresh]").disabled);
}
async function previewRemote(page) {
  const id = await page.evaluate(() => fixture.remoteId);
  await page.locator(`[data-sync-snapshot="${id}"] [data-sync-preview]`).click();
  await page.waitForFunction(() => !!document.querySelector("[data-sync-review]"));
  await page.waitForFunction(() => !document.querySelector("[data-sync-back]").disabled);
}
test("directory status separates incomplete propagation from conflict and never guesses a fast-forward", async (t) => {
  const page = await fixture(t, { incomplete: true });
  await connect(page);
  assert.match(await page.locator("[data-sync-body]").innerText(), /尚未传播完整/);
  assert.match(await page.locator("[data-sync-body]").innerText(), /还没有传到此设备/);
  assert.equal(await page.locator("[data-sync-merge]").isDisabled(), true);
  await page.locator("[data-sync-preview]").click();
  await page.waitForFunction(() => fixture.errors.length === 1);
  assert.equal(await page.evaluate(() => fixture.replacements), 0);
});
test("adopting a reviewed complete version preserves parent branches and marks a merge publication as pending", async (t) => {
  const page = await fixture(t);
  await connect(page);
  assert.match(await page.locator("[data-sync-body]").innerText(), /2 个分支/);
  await previewRemote(page);
  await page.locator("[data-sync-apply]").click();
  await page.waitForFunction(
    () => fixture.replacements === 1 && !document.querySelector("[data-sync-publish]").disabled,
  );
  const state = await page.evaluate(() => fixture.state());
  assert.equal(state.pendingApply, null);
  assert.equal(state.base.needsPublish, true);
  assert.deepEqual(
    state.base.parents,
    [
      await page.evaluate(() => fixture.localId),
      await page.evaluate(() => fixture.remoteId),
    ].sort(),
  );
  assert.equal(await page.evaluate(() => fixture.session.read().name), "另一设备工程");
  await page.locator("[data-sync-publish]").click();
  await page.waitForFunction(
    () => fixture.publications === 1 && !document.querySelector("[data-sync-publish]").disabled,
  );
  assert.equal((await page.evaluate(() => fixture.state())).base.needsPublish, false);
  assert.equal(await page.evaluate(() => fixture.snapshots.length), 4);
});
test("replacement storage failure retains the candidate and retries without reimporting", async (t) => {
  const page = await fixture(t);
  await connect(page);
  await previewRemote(page);
  await page.evaluate(() => (fixture.failReplace = true));
  await page.locator("[data-sync-apply]").click();
  await page.waitForFunction(() => fixture.errors.length > 0);
  assert.equal(await page.evaluate(() => fixture.replacements), 0);
  const imports = await page.evaluate(() => fixture.imports);
  await page.evaluate(() => (fixture.failReplace = false));
  await page.locator("[data-sync-apply]").click();
  await page.waitForFunction(
    () => fixture.replacements === 1 && !document.querySelector("[data-sync-publish]").disabled,
  );
  assert.equal(await page.evaluate(() => fixture.imports), imports);
});
test("cleanup failure after durable adoption can only finish cleanup, never replace twice", async (t) => {
  const page = await fixture(t);
  await connect(page);
  await previewRemote(page);
  await page.evaluate(() => (fixture.failCleanup = true));
  await page.locator("[data-sync-apply]").click();
  await page.waitForFunction(() => fixture.replacements === 1 && fixture.errors.length > 0);
  assert.match(await page.locator("[data-sync-message]").innerText(), /工程已切换/);
  assert.equal((await page.evaluate(() => fixture.state())).pendingApply.phase, "committed");
  await page.evaluate(() => (fixture.failCleanup = false));
  await page.locator("[data-sync-apply]").click();
  await page.waitForFunction(() => fixture.state().pendingApply === null);
  assert.equal(await page.evaluate(() => fixture.replaceCalls), 1);
});
test("reload after replacement but failed committed-state CAS detects the already-applied hash and does not replace again", async (t) => {
  const page = await fixture(t);
  await connect(page);
  await previewRemote(page);
  await page.evaluate(() => (fixture.failCommitted = true));
  await page.locator("[data-sync-apply]").click();
  await page.waitForFunction(() => fixture.replacements === 1 && fixture.errors.length > 0);
  assert.equal((await page.evaluate(() => fixture.state())).pendingApply.phase, "prepared");
  await page.evaluate(async () => {
    fixture.failCommitted = false;
    await fixture.reopen();
  });
  await page.locator("[data-sync-recover]").click();
  await page.waitForFunction(() => fixture.state().pendingApply === null);
  assert.equal(await page.evaluate(() => fixture.replaceCalls), 1);
});
test("a newer editor generation blocks an in-flight preview and preserves local edits", async (t) => {
  const page = await fixture(t);
  await connect(page);
  await page.evaluate(() => (fixture.waitImport = true));
  const id = await page.evaluate(() => fixture.remoteId);
  await page.locator(`[data-sync-snapshot="${id}"] [data-sync-preview]`).click();
  await page.waitForFunction(() => !!fixture.finishImport);
  await page.evaluate(async () => {
    const doc = fixture.session.read();
    doc.name = "后来打开的本机工程";
    await fixture.session.replace(doc);
    fixture.finishImport();
  });
  await page.waitForFunction(() => fixture.errors.length > 0);
  assert.equal(await page.evaluate(() => fixture.replacements), 0);
  assert.equal(await page.evaluate(() => fixture.session.read().name), "后来打开的本机工程");
});
test("publishing freezes the initial document, while later local edits remain dirty against its content hash", async (t) => {
  const page = await fixture(t, { unpublished: true });
  await connect(page);
  await page.evaluate(() => (fixture.waitExport = true));
  await page.locator("[data-sync-publish]").click();
  await page.waitForFunction(() => !!fixture.finishExport);
  await page.evaluate(() => {
    fixture.session.dispatch(
      [{ type: "project.rename", name: "打包之后的新修改" }],
      fixture.session.getState().identity,
      "重命名",
    );
    fixture.finishExport();
  });
  await page.waitForFunction(
    () => fixture.publications === 1 && !document.querySelector("[data-sync-publish]").disabled,
  );
  assert.equal(await page.evaluate(() => fixture.frozen.name), "本机工程");
  assert.equal(await page.evaluate(() => fixture.session.read().name), "打包之后的新修改");
  assert.notEqual(
    await page.evaluate(() => fixture.state().base.contentHash),
    await page.evaluate(() => editor.editorSyncContentHash(fixture.session.read())),
  );
});
test("cancel while waiting for local save prevents export work and keeps the editor untouched", async (t) => {
  const page = await fixture(t, { unpublished: true });
  await connect(page);
  await page.evaluate(() => (fixture.waitFlush = true));
  await page.locator("[data-sync-publish]").click();
  await page.waitForFunction(() => !!fixture.finishFlush);
  await page.locator("[data-sync-cancel]").click();
  await page.evaluate(() => fixture.finishFlush());
  await page.waitForFunction(() => !document.querySelector("[data-sync-publish]").disabled);
  assert.equal(await page.evaluate(() => fixture.exports), 0);
  assert.equal(await page.evaluate(() => fixture.publications), 0);
});
test("publication receipt CAS failure starts no publication; explicit retry reuses the frozen ZIP", async (t) => {
  const page = await fixture(t, { unpublished: true });
  await connect(page);
  await page.evaluate(() => (fixture.failState = true));
  await page.locator("[data-sync-publish]").click();
  await page.waitForFunction(() => fixture.errors.length > 0);
  assert.equal(await page.evaluate(() => fixture.publications), 0);
  assert.equal(await page.evaluate(() => fixture.exports), 1);
  await page.evaluate(() => (fixture.failState = false));
  await page.locator("[data-sync-publish]").click();
  await page.waitForFunction(
    () => fixture.publications === 1 && !document.querySelector("[data-sync-publish]").disabled,
  );
  assert.equal(await page.evaluate(() => fixture.exports), 1);
  const serialized = await page.evaluate(() => JSON.stringify(fixture.state()));
  assert.equal(serialized.includes("directoryHandle"), false);
  assert.equal(serialized.includes("22222222-2222-4222-8222-222222222222"), false);
});
test("three-way merge retains each same-sequence conflict until an explicit choice and validates the resulting candidate", async (t) => {
  const page = await fixture(t, { conflict: true });
  await connect(page);
  const id = await page.evaluate(() => fixture.remoteId);
  await page.locator(`[data-sync-snapshot="${id}"] [data-sync-merge]`).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-sync-conflict]").length === 2 &&
      !document.querySelector("[data-sync-back]").disabled,
  );
  assert.equal(await page.locator("[data-sync-apply]").isDisabled(), true);
  const choices = page.locator("[data-sync-conflict]");
  await choices.nth(0).selectOption("left");
  await choices.nth(1).selectOption("right");
  await page.locator("[data-sync-apply]").click();
  await page.waitForFunction(
    () => fixture.replacements === 1 && !document.querySelector("[data-sync-publish]").disabled,
  );
  assert.equal(await page.evaluate(() => fixture.session.read().name), "本机工程");
  assert.equal(
    await page.evaluate(() => fixture.session.read().sequences[0].background),
    "#112233",
  );
  assert.equal(await page.evaluate(() => fixture.snapshots.length), 3);
});
test("dirty unpublished local edits must be preserved as a full snapshot before applying another branch", async (t) => {
  const page = await fixture(t, { unpublished: true });
  await connect(page);
  await previewRemote(page);
  assert.equal(await page.locator("[data-sync-apply]").isDisabled(), true);
  assert.match(await page.locator("[data-sync-body]").innerText(), /请先返回并发布本机版本/);
  assert.equal(await page.evaluate(() => fixture.replacements), 0);
});
test("review stays within a narrow screen and renders untrusted names as text", async (t) => {
  const page = await fixture(t, { width: 390, untrusted: true });
  await connect(page);
  await previewRemote(page);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector("[data-editor-sync]");
    return {
      width: dialog.getBoundingClientRect().width,
      scroll: dialog.scrollWidth,
      client: dialog.clientWidth,
    };
  });
  assert.ok(geometry.width <= 390);
  assert.ok(geometry.scroll <= geometry.client + 1);
  await page.screenshot({ path: join(tmpdir(), "video-studio-sync-review-390.png") });
});
async function execute(page, request) {
  const accepted = await page.evaluate(
    (request) =>
      fixture.ui.execute(
        {
          ...request,
          ...(["choose", "apply"].includes(request.action)
            ? { reviewId: fixture.ui.getState().review.reviewId }
            : {}),
          requestId: crypto.randomUUID(),
        },
        fixture.session.getState().identity,
      ),
    request,
  );
  await page.waitForFunction(
    (id) =>
      fixture.ui.getState().operation?.id === id &&
      fixture.ui.getState().operation.status !== "running",
    accepted.operationId,
  );
  return page.evaluate(() => fixture.ui.getState());
}
test("structured commands return an operation immediately, deduplicate request IDs and expose no directory capability", async (t) => {
  const page = await fixture(t);
  const result = await page.evaluate(() => {
    const request = { action: "connect", requestId: crypto.randomUUID() },
      identity = fixture.session.getState().identity,
      one = fixture.ui.execute(request, identity),
      two = fixture.ui.execute(request, identity);
    fixture.request = request;
    return { one, two, busy: fixture.ui.getState().busy };
  });
  assert.equal(result.one.operationId, result.two.operationId);
  assert.equal(result.busy, true);
  await page.waitForFunction(() => fixture.ui.getState().operation.status === "succeeded");
  assert.equal(await page.evaluate(() => fixture.picks), 1);
  const serialized = await page.evaluate(() =>
    JSON.stringify(fixture.ui.getState({ offset: 0, limit: 1 })),
  );
  assert.equal(serialized.includes("directoryHandle"), false);
  assert.equal(serialized.includes("22222222-2222-4222-8222-222222222222"), false);
  assert.equal(
    (await page.evaluate(() => fixture.ui.getState({ offset: 0, limit: 1 }))).history.records
      .length,
    1,
  );
  assert.equal(
    await page.evaluate(() => {
      try {
        fixture.ui.execute(
          { ...fixture.request, action: "refresh" },
          fixture.session.getState().identity,
        );
        return "no error";
      } catch (error) {
        return error.code;
      }
    }),
    "SYNC_REQUEST_REUSED",
  );
  assert.equal(
    await page.evaluate(() => {
      try {
        fixture.ui.getState({ limit: 51 });
        return "no error";
      } catch (error) {
        return error.code;
      }
    }),
    "INVALID_SYNC_REQUEST",
  );
});
test("structured action rechecks the exact editor identity after asynchronous load before opening the picker", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    fixture.waitContext = true;
    fixture.accepted = fixture.ui.execute(
      { action: "connect", requestId: crypto.randomUUID() },
      fixture.session.getState().identity,
    );
  });
  await page.waitForFunction(() => !!fixture.finishContext);
  await page.evaluate(() => {
    fixture.session.dispatch(
      [{ type: "project.rename", name: "load等待时的新修改" }],
      fixture.session.getState().identity,
    );
    fixture.finishContext();
  });
  await page.waitForFunction(() => fixture.ui.getState().operation.status === "failed");
  assert.equal(await page.evaluate(() => fixture.picks), 0);
  assert.equal(
    (await page.evaluate(() => fixture.ui.getState())).operation.error.code,
    "EDITOR_CHANGED",
  );
});
test("structured cancel binds to the requested active operation, including cancellation before its first microtask", async (t) => {
  const page = await fixture(t, { unpublished: true });
  await connect(page);
  const result = await page.evaluate(() => {
    const identity = fixture.session.getState().identity,
      operation = fixture.ui.execute(
        { action: "publish", requestId: crypto.randomUUID() },
        identity,
      );
    let wrong;
    try {
      fixture.ui.execute({ action: "cancel", operationId: crypto.randomUUID() }, identity);
    } catch (error) {
      wrong = error.code;
    }
    fixture.ui.execute({ action: "cancel", operationId: operation.operationId }, identity);
    return { wrong, id: operation.operationId };
  });
  assert.equal(result.wrong, "SYNC_OPERATION_MISMATCH");
  await page.waitForFunction(() => fixture.ui.getState().operation.status === "cancelled");
  assert.equal(await page.evaluate(() => fixture.exports), 0);
  assert.equal(await page.evaluate(() => fixture.publications), 0);
});
test("structured merge, explicit choices and apply reuse the UI path and cannot replay a completed replacement", async (t) => {
  const page = await fixture(t, { conflict: true });
  assert.equal((await execute(page, { action: "connect" })).operation.status, "succeeded");
  const id = await page.evaluate(() => fixture.remoteId),
    review = await execute(page, { action: "merge", snapshotId: id });
  assert.equal(review.review.conflictCount, 2);
  assert.equal(review.review.canApply, false);
  for (const conflict of review.review.conflicts)
    await execute(page, {
      action: "choose",
      conflictKey: conflict.key,
      choice: conflict.key === "name" ? "left" : "right",
    });
  const applied = await page.evaluate(() => {
    const request = {
      action: "apply",
      reviewId: fixture.ui.getState().review.reviewId,
      requestId: crypto.randomUUID(),
    };
    fixture.applyRequest = request;
    return fixture.ui.execute(request, fixture.session.getState().identity);
  });
  await page.waitForFunction(() => fixture.ui.getState().operation.status === "succeeded");
  assert.equal(await page.evaluate(() => fixture.replacements), 1);
  const again = await page.evaluate(() =>
    fixture.ui.execute(fixture.applyRequest, fixture.session.getState().identity),
  );
  assert.equal(again.operationId, applied.operationId);
  assert.equal(await page.evaluate(() => fixture.replacements), 1);
  assert.equal(
    await page.evaluate(() => fixture.session.read().sequences[0].background),
    "#112233",
  );
});
test("status notices an editor revision changed since the last content hash check", async (t) => {
  const page = await fixture(t);
  await connect(page);
  assert.equal((await page.evaluate(() => fixture.ui.getState())).dirty, false);
  await page.evaluate(() =>
    fixture.session.dispatch(
      [{ type: "project.rename", name: "未刷新状态的新修改" }],
      fixture.session.getState().identity,
    ),
  );
  assert.equal((await page.evaluate(() => fixture.ui.getState())).dirty, true);
});
test("structured status stays below 44 KiB with explicit text and parent truncation and a continuation offset", async (t) => {
  const page = await fixture(t);
  await page.evaluate(async () => {
    const records = [...fixture.snapshots];
    for (let index = 0; index < 90; index++) {
      records.push(
        await editor.createSnapshot({
          projectId: "sync-ui-project",
          bundle: { sha256: "a".repeat(64), bytes: 1234 },
          parents: records.slice(-16).map((item) => item.id),
          deviceId: "11111111-1111-4111-8111-111111111111",
          createdAt: "2026-09-16T00:00:00.000Z",
          note: "中文🙂".repeat(35),
        }),
      );
    }
    fixture.snapshots = records;
  });
  await connect(page);
  const result = await page.evaluate(() => {
    const state = fixture.ui.getState({ offset: 10, limit: 50 });
    return { state, bytes: new TextEncoder().encode(JSON.stringify(state)).length };
  });
  assert.ok(result.bytes <= 44 * 1024);
  assert.ok(
    result.state.history.records.every(
      (item) =>
        item.noteTruncated &&
        item.parentsTruncated &&
        item.parents.length === 4 &&
        item.parentCount > 4,
    ),
  );
  assert.ok(result.state.page.nextOffset > 10);
  assert.equal(result.state.page.requestedLimit, 50);
});
test("readonly conflict inspection returns the actual complete JSON across surrogate-safe pages bound to one review", async (t) => {
  const page = await fixture(t, { conflict: true });
  await execute(page, { action: "connect" });
  await execute(page, { action: "merge", snapshotId: await page.evaluate(() => fixture.remoteId) });
  const result = await page.evaluate(async () => {
    const state = fixture.ui.getState(),
      key = state.review.conflicts.find((item) => item.key.startsWith("sequences/")).key,
      reviewId = state.review.reviewId,
      identity = fixture.session.getState().identity;
    let text = "",
      offset = 0,
      count = 0;
    for (;;) {
      const chunk = await fixture.ui.inspectConflict(
        { expectedReviewId: reviewId, conflictKey: key, side: "left", offset, limit: 7 },
        identity,
      );
      if (chunk.reviewId !== reviewId) throw Error("review changed");
      if (chunk.text && chunk.text.charCodeAt(0) >= 0xdc00 && chunk.text.charCodeAt(0) <= 0xdfff)
        throw Error("split low surrogate");
      text += chunk.text;
      count++;
      if (chunk.nextOffset === null) {
        if (text.length !== chunk.length) throw Error("incomplete");
        break;
      }
      if (chunk.nextOffset <= offset) throw Error("no progress");
      offset = chunk.nextOffset;
    }
    let midError;
    try {
      await fixture.ui.inspectConflict(
        {
          expectedReviewId: reviewId,
          conflictKey: key,
          side: "left",
          offset: text.indexOf("🙂") + 1,
          limit: 7,
        },
        identity,
      );
    } catch (error) {
      midError = error.code;
    }
    return { parsed: JSON.parse(text), count, midError };
  });
  assert.ok(result.count > 10);
  assert.equal(result.parsed.present, true);
  assert.equal(result.parsed.value.name, "本机序列改名🙂");
  assert.ok(result.parsed.value.clips.length > 0);
  assert.equal(result.midError, "INVALID_SYNC_OFFSET");
  assert.equal(await page.evaluate(() => fixture.replacements), 0);
});
test("changing only the prepared review invalidates prior inspect and choose IDs without changing the editor", async (t) => {
  const page = await fixture(t, { conflict: true });
  await execute(page, { action: "connect" });
  const remote = await page.evaluate(() => fixture.remoteId),
    first = await execute(page, { action: "merge", snapshotId: remote });
  await execute(page, { action: "merge", snapshotId: remote });
  assert.equal(
    await page.evaluate(async (old) => {
      try {
        await fixture.ui.inspectConflict(
          {
            expectedReviewId: old.review.reviewId,
            conflictKey: old.review.conflicts[0].key,
            side: "left",
          },
          fixture.session.getState().identity,
        );
        return "no error";
      } catch (error) {
        return error.code;
      }
    }, first),
    "SYNC_REVIEW_CHANGED",
  );
  const accepted = await page.evaluate(
    (old) =>
      fixture.ui.execute(
        {
          action: "choose",
          requestId: crypto.randomUUID(),
          reviewId: old.review.reviewId,
          conflictKey: old.review.conflicts[0].key,
          choice: "right",
        },
        fixture.session.getState().identity,
      ),
    first,
  );
  await page.waitForFunction(
    (id) =>
      fixture.ui.getState().operation.id === id &&
      fixture.ui.getState().operation.status === "failed",
    accepted.operationId,
  );
  assert.equal(
    (await page.evaluate(() => fixture.ui.getState())).operation.error.code,
    "SYNC_REVIEW_CHANGED",
  );
  assert.equal(await page.evaluate(() => fixture.replacements), 0);
});
test("an unreplayable prepared replacement can keep the edited current document without clearing another receipt or losing imports", async (t) => {
  const page = await fixture(t);
  await connect(page);
  await previewRemote(page);
  await page.evaluate(() => (fixture.failReplace = true));
  await page.locator("[data-sync-apply]").click();
  await page.waitForFunction(() => fixture.errors.length > 0);
  await page.evaluate(async () => {
    fixture.failReplace = false;
    fixture.session.dispatch(
      [{ type: "project.rename", name: "失败之后的本机修改" }],
      fixture.session.getState().identity,
    );
    await fixture.session.flush();
    await fixture.ui.open();
  });
  const before = await page.evaluate(() => fixture.ui.getState());
  assert.equal(before.canKeepCurrent, true);
  const imports = await page.evaluate(() => fixture.state().imports);
  const wrong = await execute(page, {
    action: "keep-current",
    expectedApplyId: await page.evaluate(() => crypto.randomUUID()),
  });
  assert.equal(wrong.operation.error.code, "SYNC_APPLY_CHANGED");
  assert.equal(
    (await page.evaluate(() => fixture.ui.getState())).pendingApplyId,
    before.pendingApplyId,
  );
  await page.evaluate(() => (fixture.failState = true));
  const failed = await execute(page, {
    action: "keep-current",
    expectedApplyId: before.pendingApplyId,
  });
  assert.equal(failed.operation.status, "failed");
  assert.equal(
    (await page.evaluate(() => fixture.ui.getState())).pendingApplyId,
    before.pendingApplyId,
  );
  await page.evaluate(() => (fixture.failState = false));
  const kept = await execute(page, {
    action: "keep-current",
    expectedApplyId: before.pendingApplyId,
  });
  assert.equal(kept.operation.status, "succeeded");
  assert.equal(kept.pendingApply, null);
  assert.equal(kept.needsPublish, true);
  assert.equal(await page.evaluate(() => fixture.session.read().name), "失败之后的本机修改");
  assert.deepEqual(await page.evaluate(() => fixture.state().imports), imports);
  assert.equal(await page.evaluate(() => fixture.snapshots.length), 3);
  assert.equal(await page.evaluate(() => fixture.replacements), 0);
});
test("keep-current on an already committed replacement prioritizes idempotent cleanup rather than discarding its receipt", async (t) => {
  const page = await fixture(t);
  await connect(page);
  await previewRemote(page);
  await page.evaluate(() => (fixture.failCleanup = true));
  await page.locator("[data-sync-apply]").click();
  await page.waitForFunction(() => fixture.replacements === 1 && fixture.errors.length > 0);
  const id = (await page.evaluate(() => fixture.ui.getState())).pendingApplyId;
  await page.evaluate(() => (fixture.failCleanup = false));
  const result = await execute(page, { action: "keep-current", expectedApplyId: id });
  assert.equal(result.operation.status, "succeeded");
  assert.equal(result.pendingApply, null);
  assert.equal(await page.evaluate(() => fixture.replaceCalls), 1);
  assert.equal(await page.evaluate(() => fixture.state().imports.length), 0);
});
