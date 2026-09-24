import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let adapter;
async function legacyAdapter() {
  adapter ??= build({
    stdin: {
      contents: `export { projectLegacyView } from './apps/video-studio/src/editor/legacy-adapter'; export { readEditorDocument } from './apps/video-studio/src/editor/migration'; export { createDemoProject } from './apps/video-studio/src/model';`,
      resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node20",
  }).then(
    (result) =>
      import(
        `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
      ),
  );
  return adapter;
}

/**
 * A project switch (「新建工程」, the demo, a recent project) archives the old project before it
 * commits the new one, and the save label keeps reading 已自动保存 for the old project meanwhile.
 * Wait until `readProject` reports a different project, then for that project's save.
 */
export async function waitForProjectSwitch(page, previousId, readProject, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while ((await readProject(page))?.id === previousId) {
    if (Date.now() > deadline) throw new Error("The new project was never committed");
    await page.waitForTimeout(25);
  }
  await page.waitForFunction(
    () => document.querySelector("#save-state")?.textContent === "已自动保存",
  );
}

/** Follow the actual visible product navigation; never toggle hidden styles or bypass its state. */
export async function enterLegacyProduction(page, tab = "media") {
  await page.waitForFunction(
    () =>
      document.querySelector("#editor-workspace") ||
      document.querySelector("#save-state")?.textContent === "恢复失败",
  );
  await page.locator("#studio").waitFor({ state: "visible" });
  if (tab) await page.locator(`#studio .rail [data-tab="${tab}"]`).click();
}

async function storedValue(page, key, revision) {
  return page.evaluate(
    async ({ key, revision }) => {
      if (window.codeshellPanel) {
        const context = await window.codeshellPanel.getContext();
        if (
          ["media.document.get", "media.document.set"].every((method) =>
            context.availableMethods?.includes(method),
          )
        )
          return (
            await window.codeshellPanel.call("media.document.get", {
              key,
              ...(revision === undefined ? {} : { revision }),
            })
          ).data;
      }
      const context = await window.codeshellPanel?.getContext();
      const scope = context?.cwd ?? "browser";
      return new Promise((resolve, reject) => {
        const request = indexedDB.open("video-studio-editor-v2", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("documents")) {
            db.close();
            reject(new Error("The canonical editor database has not been created"));
            return;
          }
          const transaction = db.transaction("documents", "readonly"),
            read = transaction.objectStore("documents").get(JSON.stringify([scope, key]));
          read.onerror = () => reject(read.error);
          read.onsuccess = () =>
            resolve(
              (revision === undefined
                ? read.result?.versions[0]
                : read.result?.versions.find((item) => item.revision === revision)
              )?.data ?? null,
            );
          transaction.oncomplete = () => db.close();
        };
      });
    },
    { key, revision },
  );
}

/** Read and verify what was actually persisted, independently of the live read-project tool. */
export async function readSavedEditorDocument(page, revision) {
  let raw = await storedValue(page, "video-studio-current", revision);
  if (raw === null) return null;
  if (raw?.format === "video-studio-packed-document") {
    const manifest = raw;
    const bytes = Object.hasOwn(manifest, "data")
      ? Buffer.from(JSON.stringify(manifest.data))
      : Buffer.concat(
          await Promise.all(
            manifest.chunks.map(async (reference) => {
              const chunk = await storedValue(page, reference.key);
              const part = Buffer.from(chunk.data, "base64");
              if (
                part.length !== reference.bytes ||
                createHash("sha256").update(part).digest("hex") !== reference.sha256
              )
                throw new Error("Stored editor chunk failed its integrity check");
              return part;
            }),
          ),
        );
    if (
      bytes.length !== manifest.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== manifest.sha256
    )
      throw new Error("Stored editor document failed its integrity check");
    raw = JSON.parse(bytes.toString("utf8"));
  }
  const api = await legacyAdapter();
  return api.readEditorDocument(raw);
}
export async function readSavedLegacyProject(page, revision) {
  const api = await legacyAdapter();
  const document = await readSavedEditorDocument(page, revision);
  return document === null ? null : structuredClone(api.projectLegacyView(document).project);
}
export async function legacyProjectFromDocument(value) {
  const api = await legacyAdapter();
  return structuredClone(api.projectLegacyView(api.readEditorDocument(value)).project);
}

/** The exact untouched v1 template, before a v2 projection adds compatibility metadata. */
export async function pristineLegacyDemoProject() {
  return (await legacyAdapter()).createDemoProject();
}
