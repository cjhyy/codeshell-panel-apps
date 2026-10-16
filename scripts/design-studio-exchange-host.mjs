import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pngjs from "pngjs";
import { prepareFigmaImport } from "../apps/design-studio/app/figma-bridge.mjs";
import {
  createFigmaBinding,
  createFigmaPatch,
  readFigmaBinding,
  registerFigmaBinding,
  persistFigmaBinding,
} from "../apps/design-studio/app/figma-binding.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../apps/design-studio/app/document.mjs";
import { resolveDesignResource } from "../apps/design-studio/app/resource-store.mjs";
import {
  readDesignSidecar,
  writeDesignSidecar,
} from "../apps/design-studio/app/design-sidecar.mjs";
import {
  createReviewCommentsStore,
  createReviewDraftSession,
  reviewDraftKey,
  REVIEW_COMMENTS_FORMAT,
  REVIEW_DRAFT_FORMAT,
} from "../apps/design-studio/app/review-comments.mjs";
import {
  createPrototype,
  createPrototypeStore,
  exportDesignPrototype,
} from "../apps/design-studio/app/prototype.mjs";
import {
  createPortableDesign,
  planPortableDesign,
  restorePortableDesign,
} from "../apps/design-studio/app/portable-backup.mjs";
import { planDesignBackup } from "../apps/design-studio/app/legacy-backup.mjs";
import {
  captureDesignOperationState,
  createDesignOperationRecord,
} from "../apps/design-studio/app/operation-log.mjs";

if (process.argv.length !== 3)
  throw Error(
    "Usage: node scripts/design-studio-exchange-host.mjs <built-server-package-directory>",
  );
const serverRoot = resolve(process.argv[2]);
const hostPackage = JSON.parse(await readFile(join(serverRoot, "package.json"), "utf8"));
assert.equal(hostPackage.name, "@cjhyy/code-shell-server");
await readFile(join(serverRoot, "dist/panels/runtime-services.js"));

// Re-exec with a private home, no provider environment, and denied JavaScript
// network access. Only the explicitly supplied built Host and repo modules load.
if (process.env.PANEL_EXCHANGE_HOST_WORKER !== "1") {
  const isolated = await mkdtemp(join(tmpdir(), "design-exchange-host-gate-"));
  let passed = false;
  try {
    const home = join(isolated, "home"),
      guard = join(isolated, "deny-network.mjs");
    await mkdir(home);
    await writeFile(
      guard,
      `import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
const denied = () => { throw Error("Design exchange Host acceptance forbids network access"); };
globalThis.fetch = denied;
http.request = http.get = https.request = https.get = denied;
net.connect = net.createConnection = tls.connect = denied;
syncBuiltinESMExports();\n`,
    );
    const result = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(guard).href, fileURLToPath(import.meta.url), serverRoot],
      {
        cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
        encoding: "utf8",
        timeout: 60_000,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          TMPDIR: home,
          LANG: "C.UTF-8",
          PANEL_EXCHANGE_HOST_WORKER: "1",
        },
      },
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "Design exchange real Host acceptance failed");
    passed = true;
  } finally {
    if (passed) await rm(isolated, { recursive: true, force: true });
    else console.error(`Isolated exchange fixtures retained at ${isolated}`);
  }
} else {
  const { PanelRuntimeServices } = await import(
    pathToFileURL(join(serverRoot, "dist/panels/runtime-services.js")).href
  );
  const hash = async (value) => createHash("sha256").update(value).digest("hex");
  const root = await mkdtemp(join(tmpdir(), "design-exchange-real-host-"));
  let passed = false;
  try {
    const source = join(root, "source"),
      target = join(root, "target"),
      dataDir = join(root, "data");
    await mkdir(source);
    await mkdir(target);
    const path = "designs/product.codesign.json",
      copiedPath = "designs/copied.codesign.json";
    let authorized = true;
    const scope = (cwd) => ({
      appId: "design-studio",
      cwd,
      projectPath: cwd,
      permissions: [
        "context.workspace",
        "workspace.info",
        "workspace.read",
        "workspace.write",
        "storage",
      ],
      isAuthorized: async () => authorized,
    });
    const methods = ["storage.getSnapshot", "storage.compareAndSet"];
    const snapshot = (cwd, path) => ({
      context: {
        cwd,
        sessionId: "exchange-fixture",
        trusted: true,
        availableMethods: methods,
        projectScope: { version: 1, environmentId: "fixture", projectId: cwd, rootId: "root" },
      },
      workspaceEpoch: 1,
      documentEpoch: 1,
      path,
      ready: true,
    });
    let runtime = new PanelRuntimeServices({ dataDir });
    const successfulWrites = [],
      calls = [];
    const callFor = (cwd) => async (method, params) => {
      calls.push({ method, cwd, path: params?.path });
      const result = await runtime.call(scope(cwd), method, params);
      if (method === "workspace.writeText")
        successfulWrites.push({ path: params.path, bytes: Buffer.byteLength(params.content) });
      return result;
    };
    const sourceCall = callFor(source),
      targetCall = callFor(target);
    await assert.rejects(
      sourceCall("workspace.writeText", {
        path: "designs/oversized.json",
        content: "x".repeat(384 * 1024 + 1),
        expectedModifiedAt: null,
      }),
      /at most/,
    );
    await assert.rejects(
      sourceCall("workspace.writeText", { path: "designs/blind.json", content: "{}" }),
      /prevent blind overwrites/,
    );
    await sourceCall("workspace.writeText", {
      path: "designs/cas.json",
      content: "before",
      expectedModifiedAt: null,
    });
    const basis = await sourceCall("workspace.readText", { path: "designs/cas.json" });
    await sourceCall("workspace.writeText", {
      path: "designs/cas.json",
      content: "after",
      expectedRevision: basis.revision,
    });
    await assert.rejects(
      sourceCall("workspace.writeText", {
        path: "designs/cas.json",
        content: "stale",
        expectedRevision: basis.revision,
      }),
      /changed/,
    );
    assert.equal(
      (await sourceCall("workspace.readText", { path: "designs/cas.json" })).content,
      "after",
    );
    await writeFile(join(source, "designs/read-too-large.json"), "x".repeat(480 * 1024 + 1));
    await assert.rejects(
      sourceCall("workspace.readText", { path: "designs/read-too-large.json" }),
      /large|size|limit|file/iu,
    );

    // Deterministic valid PNG noise creates multiple real resource parts.
    const png = new pngjs.PNG({ width: 512, height: 512 });
    let random = 1;
    for (let index = 0; index < png.data.length; index++) {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      png.data[index] = index % 4 === 3 ? 255 : random & 255;
    }
    const image = pngjs.PNG.sync.write(png),
      base64 = image.toString("base64");
    assert.equal(pngjs.PNG.sync.read(image).width, 512);
    const prepared = await prepareFigmaImport(
      {
        name: "Real Host exchange",
        fileKey: "fixture-file",
        assets: { photo: { mime: "image/png", base64 } },
        document: {
          id: "0:0",
          type: "DOCUMENT",
          children: [
            {
              id: "0:1",
              type: "CANVAS",
              name: "Home",
              children: [
                {
                  id: "1:1",
                  type: "FRAME",
                  name: "Card",
                  absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 600 },
                  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
                  children: [
                    {
                      id: "1:2",
                      type: "TEXT",
                      name: "Heading",
                      characters: "Host-backed Figma design",
                      absoluteBoundingBox: { x: 30, y: 30, width: 500, height: 50 },
                      style: { fontFamily: "Inter", fontSize: 24, fontWeight: 600 },
                      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
                      pluginData: { retainedOpaqueSource: "source metadata ".repeat(40_000) },
                    },
                    {
                      id: "1:3",
                      type: "RECTANGLE",
                      name: "Photo",
                      absoluteBoundingBox: { x: 30, y: 120, width: 200, height: 150 },
                      fills: [{ type: "IMAGE", imageRef: "photo", scaleMode: "FIT" }],
                    },
                  ],
                },
              ],
            },
            { id: "0:2", type: "CANVAS", name: "Details", children: [] },
          ],
        },
      },
      { sha256Bytes: hash },
    );
    assert(prepared.resourcePlans[0].parts.length > 1);
    for (const resource of prepared.resourcePlans)
      for (const part of resource.parts)
        await sourceCall("workspace.writeText", {
          path: part.path,
          content: part.content,
          expectedModifiedAt: null,
        });
    const document = prepared.document,
      documentSource = serializeDesignDocument(document),
      binding = createFigmaBinding(prepared);
    await registerFigmaBinding({
      path,
      sourceContent: documentSource,
      binding,
      call: sourceCall,
      check() {},
      sha256: hash,
    });
    await sourceCall("workspace.writeText", {
      path,
      content: documentSource,
      expectedModifiedAt: null,
    });
    runtime = new PanelRuntimeServices({ dataDir });
    const persisted = await sourceCall("workspace.readText", { path });
    const reopenedBinding = await readFigmaBinding({
      path,
      sourceContent: persisted.content,
      call: sourceCall,
      check() {},
      sha256: hash,
    });
    assert.equal(reopenedBinding.source.assets.photo.base64, base64);
    assert.equal(
      reopenedBinding.source.nodes["0:0"].document.children[0].children[0].children[0].pluginData
        .retainedOpaqueSource.length,
      640_000,
    );

    const pageId = document.activePageId,
      heading = document.nodes.find((node) => node.type === "text"),
      date = "2026-10-16T08:00:00.000Z";
    const bindingRef = await persistFigmaBinding({
      binding: reopenedBinding,
      call: sourceCall,
      check() {},
      sha256: hash,
    });
    const recoveryDocument = structuredClone(document);
    recoveryDocument.nodes.find((node) => node.id === heading.id).text =
      "Recovered unsaved Figma edit";
    const recoveryPlan = await planDesignBackup(
      {
        kind: "legacy",
        value: {
          format: "codeshell.design.recovery",
          version: 2,
          workspaceRoot: source,
          path,
          basePath: path,
          sourceContext: { sessionId: "source-fixture" },
          baseDocument: null,
          baseRevision: persisted.revision,
          baseModifiedAt: persisted.modifiedAt,
          figmaBindingRef: bindingRef,
          record: createDesignOperationRecord(
            captureDesignOperationState(document),
            captureDesignOperationState(recoveryDocument),
          ),
        },
      },
      {
        readText: (path) => sourceCall("workspace.readText", { path }),
        sha256: hash,
        sha256Bytes: hash,
      },
    );
    assert.equal(recoveryPlan.attachmentCounts.attachments, 1);
    const comments = {
      format: REVIEW_COMMENTS_FORMAT,
      version: 1,
      designPath: path,
      threads: Array.from({ length: 45 }, (_, index) => ({
        id: `host-thread-${index}`,
        pageId,
        nodeId: heading.id,
        targetName: "Heading",
        author: "Host reviewer",
        text: `Issue ${index} ${"x".repeat(9000)}`,
        createdAt: date,
        updatedAt: date,
        status: "open",
        replies: [],
      })),
    };
    await writeDesignSidecar({
      path: "designs/product.comments.json",
      content: JSON.stringify(comments),
      expectedModifiedAt: null,
      call: sourceCall,
      check() {},
      sha256: hash,
    });
    const sourceSnapshot = snapshot(source, path),
      reviewOptions = { getSnapshot: () => sourceSnapshot, call: sourceCall, sha256: hash };
    const one = createReviewCommentsStore(reviewOptions),
      two = createReviewCommentsStore(reviewOptions);
    await Promise.all([
      one.reply("host-thread-0", "First concurrent reply"),
      two.reply("host-thread-0", "Second concurrent reply"),
    ]);
    await one.setResolved("host-thread-0", true);
    const reviewed = (await one.refresh()).document;
    assert.equal(reviewed.threads[0].replies.length, 2);
    assert.equal(reviewed.threads[0].status, "resolved");
    const draftOptions = {
      snapshot: sourceSnapshot,
      getSnapshot: () => sourceSnapshot,
      call: sourceCall,
    };
    const firstDraft = await createReviewDraftSession(draftOptions),
      secondDraft = await createReviewDraftSession(draftOptions);
    await firstDraft.load();
    await secondDraft.load();
    const draft = (text) => ({
      format: REVIEW_DRAFT_FORMAT,
      version: 1,
      scopeKey: reviewDraftKey(sourceSnapshot),
      text,
      target: { pageId, nodeId: heading.id, targetName: "Heading" },
      replies: [],
    });
    await firstDraft.save(draft("Retained first window draft"));
    await assert.rejects(secondDraft.save(draft("Concurrent overwrite")), /其他窗口/);
    assert.equal(
      (await (await createReviewDraftSession(draftOptions)).load()).text,
      "Retained first window draft",
    );

    const prototypeStore = createPrototypeStore({
      getSnapshot: () => sourceSnapshot,
      capture: async () => document,
      call: sourceCall,
      sha256: hash,
    });
    const initial = await prototypeStore.read(),
      model = createPrototype(document);
    model.links.push({
      id: "open-details",
      pageId,
      nodeId: heading.id,
      event: "click",
      action: "navigate",
      targetPageId: document.pages[1].id,
    });
    await prototypeStore.save(model, { baseline: initial.baseline });
    const savedPrototype = await prototypeStore.read();
    assert.equal(savedPrototype.prototype.links[0].targetPageId, document.pages[1].id);
    const sourceResource = await resolveDesignResource({
      descriptor: document.resources[0],
      readText: (path) => sourceCall("workspace.readText", { path }),
      sha256Bytes: hash,
    });
    const html = exportDesignPrototype(document, {
      prototype: model,
      comments: reviewed,
      resourceDataUrls: new Map([[document.resources[0].id, sourceResource.dataUrl]]),
    });
    assert(html.includes("First concurrent reply") && html.includes(base64));
    const text = await createPortableDesign({
      document,
      source: { workspaceRoot: source, sessionId: "source-fixture", path },
      readText: (path) => sourceCall("workspace.readText", { path }),
      sha256Bytes: hash,
      includeComments: true,
      attachments: [
        {
          kind: "figma-binding",
          suffix: ".figma-source.json",
          content: JSON.stringify(reopenedBinding),
        },
        {
          kind: "prototype",
          suffix: ".prototype.json",
          content: JSON.stringify(savedPrototype.prototype),
        },
      ],
    });
    const plan = await planPortableDesign(text, { sha256: hash, sha256Bytes: hash });
    assert.deepEqual(plan.attachmentCounts, { attachments: 3, threads: 45, replies: 2 });
    await targetCall("workspace.writeText", {
      path: "designs/occupied.comments.json",
      content: "Retained target data",
      expectedModifiedAt: null,
    });
    const beforeCollision = successfulWrites.length;
    await assert.rejects(
      restorePortableDesign({
        plan,
        path: "designs/occupied.codesign.json",
        call: targetCall,
        check() {},
        sha256Bytes: hash,
      }),
      /冲突/,
    );
    assert.equal(successfulWrites.length, beforeCollision);
    await restorePortableDesign({
      plan,
      path: copiedPath,
      call: targetCall,
      check() {},
      sha256Bytes: hash,
    });
    await restorePortableDesign({
      plan: recoveryPlan,
      path: "designs/recovered.codesign.json",
      call: targetCall,
      check() {},
      sha256Bytes: hash,
    });
    await rm(source, { recursive: true });
    runtime = new PanelRuntimeServices({ dataDir });
    const copiedSource = await targetCall("workspace.readText", { path: copiedPath }),
      copied = normalizeDesignDocument(JSON.parse(copiedSource.content));
    const recoveredSource = await targetCall("workspace.readText", {
      path: "designs/recovered.codesign.json",
    });
    const recoveredBinding = await readFigmaBinding({
      path: "designs/recovered.codesign.json",
      sourceContent: recoveredSource.content,
      call: targetCall,
      check() {},
      sha256: hash,
    });
    const recoveryPatch = createFigmaPatch(
      recoveredBinding,
      normalizeDesignDocument(JSON.parse(recoveredSource.content)),
    );
    assert.equal(
      recoveryPatch.operations.find((operation) => operation.sourceId === "1:2").after.text,
      "Recovered unsaved Figma edit",
    );
    const copiedBinding = await readFigmaBinding({
      path: copiedPath,
      sourceContent: copiedSource.content,
      call: targetCall,
      check() {},
      sha256: hash,
    });
    assert.equal(copiedBinding.source.assets.photo.base64, base64);
    const copiedComments = await readDesignSidecar({
      path: "designs/copied.comments.json",
      call: targetCall,
      check() {},
      sha256: hash,
    });
    assert.equal(JSON.parse(copiedComments.content).designPath, copiedPath);
    assert.equal(JSON.parse(copiedComments.content).threads[0].replies.length, 2);
    const copiedPrototype = await readDesignSidecar({
      path: "designs/copied.prototype.json",
      call: targetCall,
      check() {},
      sha256: hash,
    });
    assert.deepEqual(JSON.parse(copiedPrototype.content), model);
    const copiedResource = await resolveDesignResource({
      descriptor: copied.resources[0],
      readText: (path) => targetCall("workspace.readText", { path }),
      sha256Bytes: hash,
    });
    assert.equal(await hash(copiedResource.bytes), await hash(image));
    const changed = structuredClone(copied);
    changed.nodes.find((node) => node.id === heading.id).text = "Edited after portable restore";
    const patch = createFigmaPatch(copiedBinding, changed);
    assert.equal(
      patch.operations.find((operation) => operation.sourceId === "1:2").after.text,
      "Edited after portable restore",
    );
    assert.equal(
      (await targetCall("workspace.readText", { path: "designs/occupied.comments.json" })).content,
      "Retained target data",
    );
    assert(successfulWrites.every((write) => write.bytes <= 384 * 1024));
    authorized = false;
    await assert.rejects(targetCall("workspace.readText", { path: copiedPath }));
    authorized = true;
    console.log(
      JSON.stringify({
        result: "PASS",
        hostVersion: hostPackage.version,
        coverage: [
          "real workspace limits",
          "CAS rejection",
          "multipart PNG",
          "Figma source reopen",
          "Figma recovery ref",
          "concurrent comments",
          "draft CAS",
          "prototype",
          "portable rename",
          "source removal",
          "restart",
          "collision preservation",
          "revoked access",
        ],
        resourceParts: prepared.resourcePlans[0].parts.length,
        backupBytes: Buffer.byteLength(text),
        prototypeHtmlBytes: Buffer.byteLength(html),
        attachmentCounts: plan.attachmentCounts,
        maxSuccessfulWriteBytes: Math.max(...successfulWrites.map((write) => write.bytes)),
        sourceImageSha256: await hash(image),
        restoredImageSha256: await hash(copiedResource.bytes),
        hostCalls: calls.length,
      }),
    );
    passed = true;
  } finally {
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error(`Real Host exchange fixtures retained at ${root}`);
  }
}
