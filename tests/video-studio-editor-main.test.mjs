import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";

const seed = {
  schemaVersion: 1,
  id: "editor-main-project",
  name: "旧工程迁移测试",
  revision: 7,
  width: 640,
  height: 360,
  fps: 30,
  timelineMode: "free",
  script: "保留原始文稿。",
  assets: [
    { id: "demo", name: "示例画面", kind: "demo", durationFrames: 300, width: 640, height: 360 },
  ],
  clips: [{ id: "picture", assetId: "demo", inFrame: 0, outFrame: 300, startFrame: 0, volume: 1 }],
  captions: [{ id: "caption", text: "原始字幕", startFrame: 0, endFrame: 60 }],
};
let browser, server, url, directory;
before(async () => {
  const [project] = selectProjects(await discoverProjects(), "video-studio");
  directory = await mkdtemp(resolve(tmpdir(), "video-editor-main-"));
  const isolatedOutput = resolve(directory, "package");
  await buildProject({ ...project, output: isolatedOutput }, { log: false });
  const output = resolve(isolatedOutput, "app");
  server = createServer(async (request, response) => {
    const path = resolve(
      output,
      "." + new URL(request.url, "http://localhost").pathname.replace(/\/$/, "/index.html"),
    );
    if (!path.startsWith(output + sep)) return response.writeHead(403).end();
    try {
      const bytes = await readFile(path);
      response.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".mjs": "text/javascript",
            ".css": "text/css",
            ".mp3": "audio/mpeg",
          }[extname(path)] ?? "application/octet-stream",
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
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

async function openPage(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  const page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  await page.addInitScript(
    ({ seed, options }) => {
      const records = JSON.parse(localStorage.getItem("editor-main-host") ?? "null") ?? {
        "video-studio-current": [{ revision: 1, updatedAt: 1, label: "原始 V1", data: seed }],
      };
      const preferences = JSON.parse(localStorage.getItem("editor-main-preferences") ?? "{}");
      let failCurrent = false;
      const calls = [],
        attempted = [],
        tools = {},
        events = {};
      const persist = () => {
        localStorage.setItem("editor-main-host", JSON.stringify(records));
        localStorage.setItem("editor-main-preferences", JSON.stringify(preferences));
      };
      persist();
      window.__mainHost = {
        calls,
        attempted,
        tools,
        events,
        current: () => {
          const value = records["video-studio-current"][0].data;
          return structuredClone(
            value.format === "video-studio-packed-document" ? value.data : value,
          );
        },
        records: () => structuredClone(records),
        fail: (value) => {
          failCurrent = value;
        },
        latestStorageRevision: () => records["video-studio-current"][0].revision,
      };
      window.codeshellPanel = {
        getContext: async () => ({
          cwd: "/isolated/editor-main",
          theme: "dark",
          visible: true,
          capabilities: {
            bridge: {
              maxCallsPerWindow: 10000,
              maxTransferCallsPerWindow: 10000,
              rateWindowMs: 1000,
            },
          },
          availableMethods: [
            "storage.get",
            "storage.set",
            "media.document.get",
            "media.document.set",
            "media.document.versions",
            ...(options.nativeTasks
              ? ["tasks.start", "tasks.get", "tasks.list", "tasks.cancel", "resources.get"]
              : []),
            ...(options.translation
              ? ["agent.task.start", "agent.task.get", "agent.task.cancel"]
              : []),
          ],
        }),
        registerTool: (name, handler) => {
          tools[name] = handler;
          return () => {
            delete tools[name];
          };
        },
        on: (name, handler) => {
          (events[name] ??= []).push(handler);
          return () => {};
        },
        call: async (method, args = {}) => {
          calls.push({ method, args: structuredClone(args) });
          if (method === "tasks.list" && options.nativeTasks) return [];
          if (method === "agent.task.start" && options.translation) {
            const rows = JSON.parse(args.prompt.split("Subtitle data: ")[1]);
            return {
              id: "caption-translation-main",
              status: "completed",
              result: {
                text: JSON.stringify(
                  rows.map((row) => ({ id: row.id, text: `Translation: ${row.text}` })),
                ),
              },
            };
          }
          if (method === "storage.get") return structuredClone(preferences[args.key] ?? null);
          if (method === "storage.set") {
            preferences[args.key] = structuredClone(args.value);
            persist();
            return true;
          }
          if (method === "media.document.get") {
            if (options.failRead && args.key === "video-studio-current")
              throw Error("工程读取暂时失败");
            const found =
              args.revision === undefined
                ? records[args.key]?.[0]
                : records[args.key]?.find((value) => value.revision === args.revision);
            if (!found && args.revision !== undefined) throw Error("历史版本不存在");
            return structuredClone(found ?? { revision: 0, data: null });
          }
          if (method === "media.document.versions")
            return structuredClone(
              (records[args.key] ?? []).map(({ data, ...version }) => version),
            );
          if (method === "media.document.set") {
            attempted.push(structuredClone(args));
            if (failCurrent && args.key === "video-studio-current") throw Error("模拟磁盘保存失败");
            if ((records[args.key]?.[0].revision ?? 0) !== args.baseRevision)
              throw Error("Media document changed in another window");
            const receipt = {
              revision: args.baseRevision + 1,
              updatedAt: Date.now(),
              label: args.label,
            };
            records[args.key] = [
              { ...receipt, data: structuredClone(args.data) },
              ...(records[args.key] ?? []),
            ].slice(0, 20);
            persist();
            return receipt;
          }
          throw Error(`Host fixture does not implement ${method}`);
        },
      };
    },
    {
      seed: options.missingAudio
        ? {
            ...seed,
            assets: [
              ...seed.assets,
              { id: "missing-audio", name: "离线原声.wav", kind: "audio", durationFrames: 300 },
            ],
          }
        : (options.seed ?? seed),
      options,
    },
  );
  await page.goto(url);
  if (!options.failRead) {
    await page
      .locator("#editor-workspace")
      .waitFor({ state: "visible" })
      .catch(async (error) => {
        throw new Error(
          `${error.message}\n${(await page.locator("body").innerText()).slice(0, 8000)}`,
        );
      });
    await page.waitForFunction(() => window.__mainHost.tools.read_video_project);
    await settle(page);
  }
  return page;
}
const action = (page, name) => page.locator(`[data-ew-action="${name}"]`);
const oldAction = (page, name) => page.locator(`#studio [data-action="${name}"]`);
const settle = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const saved = (page) => page.evaluate(() => window.__mainHost.current());
async function waitSaved(page) {
  await page.waitForFunction(
    () =>
      document.querySelector("[data-ew-save]")?.textContent === "已保存" &&
      window.__mainHost.current().schemaVersion === 2,
  );
  return saved(page);
}
async function property(page, label, value) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(String(value));
  await field.press("Tab");
  return waitSaved(page);
}
async function production(page) {
  await action(page, "production").click();
  await page.locator("#studio").waitFor({ state: "visible" });
}
async function returnEditor(page) {
  await page.getByRole("button", { name: "返回多轨编辑", exact: true }).click();
}
const shapeFrom = (doc) =>
  doc.sequences.flatMap((sequence) => sequence.clips).find((clip) => clip.kind === "shape");

// Real built main, EditorSession, legacy adapter, IndexedDB-capable browser and media document CAS.
// The Host is a storage boundary fixture; no native engine or model is executed here.
test("main restores 0.5.16 multitrack without the optional old demo upgrade blocking task setup", async (t) => {
  const original = JSON.parse(
    await readFile(new URL("./fixtures/video-studio/project-0.5.16.json", import.meta.url), "utf8"),
  );
  const page = await openPage(t, { seed: original, nativeTasks: true });
  const doc = await waitSaved(page);
  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.id, original.id);
  assert.equal(doc.revision, original.revision);
  assert.equal(doc.sequences[0].magneticTrackId, "video-main");
  assert.equal(
    doc.sequences[0].clips.filter((clip) => clip.kind === "media").length,
    original.clips.length + original.audioClips.length,
  );
  assert.equal(
    await page.evaluate(() => window.__mainHost.calls.some((call) => call.method === "tasks.list")),
    true,
  );
  const backup = await page.evaluate(
    () =>
      Object.entries(window.__mainHost.records()).find(([key]) =>
        key.startsWith("video-studio-legacy-"),
      )?.[1][0].data.data,
  );
  assert.deepEqual(backup, original);
  await action(page, "rectangle").click();
  const edited = await waitSaved(page);
  assert.ok(shapeFrom(edited));
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.deepEqual(await saved(page), edited);
});
test("main migrates V1, preserves its exact backup, and retains v2 properties through old caption edits and reload", async (t) => {
  const page = await openPage(t);
  await action(page, "rectangle").click();
  let doc = await waitSaved(page);
  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.revision, seed.revision + 1);
  const backup = await page.evaluate(
    () =>
      Object.entries(window.__mainHost.records()).find(([key]) =>
        key.startsWith("video-studio-legacy-"),
      )?.[1][0].data.data,
  );
  assert.deepEqual(backup, seed, "Migration preserves exact old JSON, including omissions");
  doc = await property(page, "水平位置（%）", 27);
  doc = await property(page, "旋转（度）", 17);
  const shape = shapeFrom(doc);
  assert.equal(shape.transform.x, 0.27);
  assert.equal(shape.transform.rotation, 17);
  const revision = doc.revision;
  await production(page);
  await page.locator('#studio [data-tab="transcript"]').click();
  await oldAction(page, "add-caption").click();
  await page.locator("#caption-text").fill("旧制作流程添加的新字幕");
  await page.locator("#caption-start").fill("2");
  await page.locator("#caption-end").fill("3");
  assert.equal(
    await page.locator("#caption-form").evaluate((form) => form.checkValidity()),
    true,
    "Whole seconds must pass the real form constraints",
  );
  await page.locator('#caption-form button[type="submit"]').click();
  doc = await waitSaved(page);
  assert.equal(doc.revision, revision + 1, "Legacy commit dispatches exactly once");
  assert.deepEqual(shapeFrom(doc), shape);
  assert.equal(
    doc.sequences
      .flatMap((s) => s.clips)
      .filter((c) => c.kind === "text" && c.text === "旧制作流程添加的新字幕").length,
    1,
  );
  await returnEditor(page);
  await action(page, "undo").click();
  doc = await waitSaved(page);
  assert.deepEqual(shapeFrom(doc), shape);
  assert.equal(
    doc.sequences
      .flatMap((s) => s.clips)
      .filter((c) => c.kind === "text" && c.text === "旧制作流程添加的新字幕").length,
    0,
  );
  await action(page, "redo").click();
  doc = await waitSaved(page);
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.deepEqual(await saved(page), doc);
  await page.locator(`[data-et-clip="${shape.id}"]`).click();
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), "27");
  assert.equal(await page.getByLabel("旋转（度）", { exact: true }).inputValue(), "17");
});

test("main save failure retains advanced edits and retries without a duplicate commit", async (t) => {
  const page = await openPage(t);
  await action(page, "ellipse").click();
  const before = await waitSaved(page),
    shape = shapeFrom(before);
  await page.evaluate(() => window.__mainHost.fail(true));
  const input = page.getByLabel("水平缩放（%）", { exact: true });
  await input.fill("45");
  await input.press("Tab");
  await page.waitForFunction(
    () => document.querySelector("[data-ew-save]").textContent === "保存失败",
  );
  assert.deepEqual(await saved(page), before);
  assert.equal(await input.inputValue(), "45");
  await page.evaluate(() => window.__mainHost.fail(false));
  await action(page, "retry-save").click();
  const after = await waitSaved(page);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(shapeFrom(after).transform.scaleX, 0.45);
  assert.equal(shapeFrom(after).id, shape.id);
  await action(page, "undo").click();
  assert.deepEqual(shapeFrom(await waitSaved(page)), shape);
});

test("main restores a same-ID historical v2 document with monotonic revision and preserved properties", async (t) => {
  const page = await openPage(t);
  await action(page, "rectangle").click();
  await waitSaved(page);
  const target = await property(page, "水平位置（%）", 37);
  const targetStorageRevision = await page.evaluate(() =>
    window.__mainHost.latestStorageRevision(),
  );
  const changed = await property(page, "水平位置（%）", 64);
  await production(page);
  await oldAction(page, "versions").first().click();
  await page.locator(`[data-version="${targetStorageRevision}"]`).click();
  await page
    .waitForFunction(
      (previous) =>
        window.__mainHost.current().revision > previous &&
        window.__mainHost
          .current()
          .sequences.some((s) => s.clips.some((c) => c.kind === "shape" && c.transform.x === 0.37)),
      changed.revision,
    )
    .catch(async (error) => {
      throw new Error(
        error.message +
          "\n" +
          JSON.stringify(
            await page.evaluate(() => ({
              toast: document.querySelector("#toast").textContent,
              revision: window.__mainHost.current().revision,
              calls: window.__mainHost.calls
                .slice(-8)
                .map(({ method, args }) => ({ method, key: args.key, revision: args.revision })),
            })),
          ),
      );
    });
  const restored = await saved(page);
  assert.equal(restored.id, target.id);
  assert.ok(restored.revision > changed.revision);
  assert.deepEqual(shapeFrom(restored), shapeFrom(target));
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.deepEqual(await saved(page), restored);
});

test("main rejects a failed restore without replacing its current document", async (t) => {
  const page = await openPage(t);
  await action(page, "rectangle").click();
  const current = await property(page, "水平位置（%）", 31);
  const incoming = structuredClone(current);
  incoming.revision = 0;
  incoming.name = "不得激活的版本";
  shapeFrom(incoming).transform.x = 0.88;
  await page.evaluate(() => window.__mainHost.fail(true));
  await page.locator("#project-input").setInputFiles({
    name: "restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(incoming)),
  });
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("模拟磁盘保存失败"),
  );
  assert.deepEqual(await saved(page), current);
  assert.equal(await page.locator("[data-ew-project-name]").inputValue(), current.name);
  await page.locator(`[data-et-clip="${shapeFrom(current).id}"]`).click();
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), "31");
});

test("main initial read failure never writes an empty replacement over unreadable data", async (t) => {
  const page = await openPage(t, { failRead: true });
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("原有工程无法恢复"),
  );
  assert.equal(await page.locator("#editor-workspace").count(), 0);
  assert.deepEqual(await saved(page), seed);
  assert.equal(
    await page.evaluate(
      () => window.__mainHost.attempted.filter((c) => c.key === "video-studio-current").length,
    ),
    0,
  );
  assert.equal(await page.locator("#save-state").textContent(), "恢复失败");
});

test("manual legacy rough-cut markers and assembly preserve an advanced layer and remain single-step undoable", async (t) => {
  // Range editing of an offline source is supported; source decoding is outside this metadata test.
  const page = await openPage(t, { missingAudio: true });
  await action(page, "rectangle").click();
  const before = await property(page, "旋转（度）", 23),
    shape = shapeFrom(before);
  await production(page);
  await page.locator('#studio [data-tab="roughcut"]').click();
  await page.locator("#roughcut-source").selectOption("missing-audio");
  await page.locator("#roughcut-in").fill("00:00:01:00");
  await page.locator("#roughcut-in").press("Tab");
  await page.locator("#roughcut-out").fill("00:00:03:00");
  await page.locator("#roughcut-out").press("Tab");
  await page.locator('[data-roughcut-field="name"]').fill("保留中间两秒");
  await oldAction(page, "roughcut-save").click();
  await page.waitForFunction(
    (revision) => window.__mainHost.current().revision > revision,
    before.revision,
  );
  const marked = await waitSaved(page);
  assert.equal(marked.revision, before.revision + 1);
  assert.deepEqual(shapeFrom(marked), shape);
  assert.deepEqual(
    marked.production.roughCuts.map(({ assetId, inFrame, outFrame, name }) => ({
      assetId,
      inFrame,
      outFrame,
      name,
    })),
    [{ assetId: "missing-audio", inFrame: 30, outFrame: 90, name: "保留中间两秒" }],
  );
  await oldAction(page, "roughcut-append").click();
  await page.waitForFunction(
    (revision) => window.__mainHost.current().revision > revision,
    marked.revision,
  );
  const assembled = await waitSaved(page);
  assert.equal(assembled.revision, marked.revision + 1);
  const audio = assembled.sequences
    .flatMap((s) => s.clips)
    .find((c) => c.kind === "media" && c.assetId === "missing-audio");
  assert.ok(audio);
  assert.equal(audio.duration, 480000);
  assert.deepEqual(audio.timeMap.points, [
    { time: 0, source: 240000 },
    { time: 480000, source: 720000 },
  ]);
  assert.deepEqual(shapeFrom(assembled), shape);
  await returnEditor(page);
  await action(page, "undo").click();
  const undone = await waitSaved(page);
  assert.deepEqual(undone.sequences, marked.sequences);
  assert.deepEqual(undone.production, marked.production);
});

test("main exposes canonical agent edits with exact frame rate, durable save and shared undo", async (t) => {
  const page = await openPage(t);
  const result = await page.evaluate(async () => {
    const tools = window.__mainHost.tools;
    const current = tools.read_video_project({ editor: { view: "project" } });
    const saved = window.__mainHost.current();
    const sequenceId = tools.read_video_project({
      editor: { view: "project", path: "/activeSequenceId" },
    }).page.value;
    const result = await tools.apply_video_edit({
      editor: {
        identity: current.identity,
        label: "AI 更新帧率与工程名称",
        steps: [
          {
            kind: "operations",
            operations: [
              {
                type: "sequence.update",
                sequenceId,
                patch: { frameRate: { numerator: 30000, denominator: 1001 } },
              },
              { type: "project.rename", name: "精确 NTSC 工程" },
            ],
          },
        ],
      },
    });
    return {
      registered: Object.keys(tools),
      previous: current.identity,
      result,
      frameRate: tools.read_video_project({
        editor: { view: "project", identity: result.identity, path: "/sequences/0/frameRate" },
      }),
      document: window.__mainHost.current(),
    };
  });
  for (const name of ["read_video_project", "apply_video_edit", "render_video_project"])
    assert.ok(result.registered.includes(name));
  assert.equal(result.result.identity.revision, result.previous.revision + 1);
  assert.equal(result.document.name, "精确 NTSC 工程");
  assert.deepEqual(result.document.sequences[0].frameRate, { numerator: 30000, denominator: 1001 });
  assert.equal(result.frameRate.timebase, 240000);
  assert.deepEqual(
    result.frameRate.page.entries.map(({ key, value }) => [key, value]),
    [
      ["numerator", 30000],
      ["denominator", 1001],
    ],
  );
  assert.equal(await page.locator("[data-ew-project-name]").inputValue(), "精确 NTSC 工程");
  await action(page, "undo").click();
  const restored = await waitSaved(page);
  assert.equal(restored.name, seed.name);
  assert.deepEqual(restored.sequences[0].frameRate, { numerator: 30, denominator: 1 });
  await action(page, "redo").click();
  await waitSaved(page);
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.equal((await saved(page)).name, "精确 NTSC 工程");
});

test("main agent candidate save failure leaves canonical state unchanged and requires a fresh identity after manual edits", async (t) => {
  const page = await openPage(t);
  const before = await saved(page);
  const result = await page.evaluate(async () => {
    const tools = window.__mainHost.tools,
      identity = tools.read_video_project({ editor: { view: "project" } }).identity;
    const request = {
      identity,
      label: "AI 候选",
      steps: [{ kind: "operations", operations: [{ type: "project.rename", name: "未保存候选" }] }],
    };
    window.__mainHost.fail(true);
    let message;
    try {
      await tools.apply_video_edit({ editor: request });
    } catch (error) {
      message = String(error);
    }
    window.__mainHost.fail(false);
    return { message, identity, state: tools.read_video_project({ editor: { view: "project" } }) };
  });
  assert.match(result.message, /模拟磁盘保存失败/);
  assert.deepEqual(result.state.identity, result.identity);
  assert.deepEqual(await saved(page), before);
  assert.equal(await page.locator("[data-ew-project-name]").inputValue(), seed.name);
  await action(page, "rectangle").click();
  const edited = await waitSaved(page);
  const stale = await page.evaluate(async (identity) => {
    try {
      await window.__mainHost.tools.apply_video_edit({
        editor: {
          identity,
          label: "旧候选",
          steps: [
            { kind: "operations", operations: [{ type: "project.rename", name: "过期覆盖" }] },
          ],
        },
      });
      return "accepted";
    } catch (error) {
      return String(error);
    }
  }, result.identity);
  assert.match(stale, /版本已变化/);
  assert.deepEqual(await saved(page), edited);
});

test("main subtitle workbench reviews SRT, retries failed durable save, and shares undo and reload", async (t) => {
  const page = await openPage(t),
    before = await saved(page);
  await action(page, "captions").click();
  const dialog = page.getByRole("dialog", { name: "字幕工作台" });
  await dialog.waitFor({ state: "visible" });
  assert.equal(await dialog.getByRole("button", { name: "生成所选声音字幕" }).isDisabled(), true);
  assert.equal(await dialog.getByRole("button", { name: "预览翻译" }).isDisabled(), true);
  await dialog.locator("[data-caption-srt-input]").setInputFiles({
    name: "字幕.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from("1\n00:00:03,123 --> 00:00:04,987\n新导入字幕\n"),
  });
  await dialog.locator(".ec-candidate").filter({ hasText: "新导入字幕" }).waitFor();
  assert.deepEqual(await saved(page), before);
  await page.evaluate(() => window.__mainHost.fail(true));
  await dialog.getByRole("button", { name: "应用预览", exact: true }).click();
  await dialog.locator(".ec-status").filter({ hasText: "模拟磁盘保存失败" }).waitFor();
  assert.deepEqual(await saved(page), before);
  assert.equal(
    await dialog.getByRole("button", { name: "应用预览", exact: true }).isEnabled(),
    true,
  );
  await page.evaluate(() => window.__mainHost.fail(false));
  await dialog.getByRole("button", { name: "应用预览", exact: true }).click();
  await dialog.locator(".ec-status").filter({ hasText: "字幕已保存" }).waitFor();
  const changed = await waitSaved(page),
    imported = changed.sequences[0].clips.find((clip) => clip.text === "新导入字幕");
  assert.equal(imported.start, 749520);
  assert.equal(imported.duration, 447360);
  await dialog.getByRole("button", { name: "关闭字幕" }).click();
  await action(page, "undo").click();
  assert.equal(
    (await waitSaved(page)).sequences[0].clips.some((clip) => clip.text === "新导入字幕"),
    false,
  );
  await action(page, "redo").click();
  await waitSaved(page);
  await page.reload();
  await action(page, "captions").click();
  assert.ok(
    await page
      .getByRole("dialog", { name: "字幕工作台" })
      .getByRole("textbox", { name: "字幕文字", exact: true })
      .allTextContents(),
  );
  assert.equal(
    (await saved(page)).sequences[0].clips.find((clip) => clip.text === "新导入字幕").start,
    749520,
  );
});

test("main translation preview uses the Host model and applies bilingual subtitles only after review", async (t) => {
  const page = await openPage(t, { translation: true }),
    before = await saved(page);
  await action(page, "captions").click();
  const dialog = page.getByRole("dialog", { name: "字幕工作台" });
  await dialog.getByRole("button", { name: "预览翻译", exact: true }).click();
  await dialog.locator(".ec-candidate").filter({ hasText: "Translation: 原始字幕" }).waitFor();
  assert.deepEqual(await saved(page), before);
  const requests = await page.evaluate(() =>
    window.__mainHost.calls.filter((call) => call.method === "agent.task.start"),
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].args.toolNames, []);
  await dialog.getByRole("button", { name: "应用预览", exact: true }).click();
  await dialog.locator(".ec-status").filter({ hasText: "字幕已保存" }).waitFor();
  const result = await waitSaved(page),
    caption = result.sequences[0].clips.find((clip) => clip.kind === "text");
  assert.equal(caption.text, "原始字幕\nTranslation: 原始字幕");
  await page.screenshot({ path: "/tmp/video-studio-caption-workbench-main.png", fullPage: true });
  await dialog.getByRole("button", { name: "关闭字幕" }).click();
  await action(page, "undo").click();
  assert.equal(
    (await waitSaved(page)).sequences[0].clips.find((clip) => clip.kind === "text").text,
    "原始字幕",
  );
});

test("main mounts sequence management into the shared project, copy and rename survive reload", async (t) => {
  const page = await openPage(t);
  await action(page, "sequences").click();
  const section = page.getByRole("region", { name: "序列与复合片段" });
  await section.getByRole("textbox", { name: "副本名称", exact: true }).fill("短视频副本");
  await section.getByRole("button", { name: "复制完整序列", exact: true }).click();
  await page.waitForFunction(() => window.__mainHost.current().sequences?.length === 2);
  await waitSaved(page);
  assert.equal(await page.locator("[data-ew-sequence] option:checked").textContent(), "短视频副本");
  await section.getByRole("textbox", { name: "序列名称", exact: true }).fill("独立短版");
  await section.getByRole("button", { name: "重命名序列", exact: true }).click();
  await page.waitForFunction(() =>
    window.__mainHost.current().sequences?.some((seq) => seq.name === "独立短版"),
  );
  await waitSaved(page);
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  const result = await saved(page);
  assert.equal(result.sequences.length, 2);
  assert.equal(result.sequences.find((seq) => seq.id === result.activeSequenceId).name, "独立短版");
  assert.notDeepEqual(
    result.sequences[0].clips.map((clip) => clip.id),
    result.sequences[1].clips.map((clip) => clip.id),
  );
});

test("main mounts the open-format sync dialog with its bundled styles and never replaces on open", async (t) => {
  const page = await openPage(t, { nativeTasks: true }),
    before = await saved(page);
  await action(page, "sync-project").click();
  const dialog = page.getByRole("dialog", { name: "工程同步", exact: true });
  await dialog.waitFor({ state: "visible" });
  assert.match(await dialog.innerText(), /\.mimiproject/);
  const style = await dialog.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    maxWidth: getComputedStyle(element).maxWidth,
    classes: element.className,
  }));
  assert.equal(style.classes, "editor-sync-dialog");
  assert.notEqual(style.maxWidth, "none");
  assert.ok(style.width > 500 && style.width < 1280);
  assert.deepEqual(await saved(page), before);
  assert.equal(
    (
      await page.evaluate(() =>
        window.__mainHost.calls.filter((call) => call.method === "tasks.start"),
      )
    ).length,
    0,
  );
  assert.ok(await page.locator('link[href="./main.css"]').count());
});

test("main exposes sync through its existing AI tool and reports missing transport without editing", async (t) => {
  const page = await openPage(t, { nativeTasks: true }),
    before = await saved(page);
  const result = await page.evaluate(async () => {
    const tools = window.__mainHost.tools,
      identity = tools.read_video_project({ editor: { view: "project" } }).identity;
    const state = await tools.apply_video_edit({
      editor: { identity, sync: { action: "status" } },
    });
    const accepted = await tools.apply_video_edit({
      editor: {
        identity,
        sync: { action: "connect", requestId: "486e638f-78ab-47da-bc34-b4874970a936" },
      },
    });
    return { state, accepted };
  });
  assert.equal(result.state.sync.connected, false);
  assert.equal(result.accepted.sync.accepted, true);
  assert.ok(result.accepted.sync.operationId);
  await page.waitForFunction(async () => {
    const tools = window.__mainHost.tools,
      identity = tools.read_video_project({ editor: { view: "project" } }).identity;
    const state = await tools.apply_video_edit({
      editor: { identity, sync: { action: "status" } },
    });
    return state.sync.operation?.status === "failed";
  });
  assert.deepEqual(await saved(page), before);
});

test("main lazily opens multicam monitoring and releases it when returning to production", async (t) => {
  const page = await openPage(t),
    before = await saved(page);
  assert.equal(await page.getByRole("region", { name: "多机位剪辑", exact: true }).count(), 0);
  await action(page, "multicam").click();
  const section = page.getByRole("region", { name: "多机位剪辑", exact: true });
  await section.waitFor({ state: "visible" });
  assert.match(await section.innerText(), /创建机位组/);
  await page.screenshot({ path: "/tmp/video-studio-multicam-main.png", fullPage: true });
  await production(page);
  assert.equal(await section.isVisible(), false);
  await returnEditor(page);
  assert.equal(await section.isVisible(), true);
  await action(page, "multicam").click();
  assert.equal(await section.isVisible(), false);
  assert.deepEqual(await saved(page), before);
});
