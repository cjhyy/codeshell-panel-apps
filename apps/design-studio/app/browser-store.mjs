// Browser-only workspace. Host calls never enter this module. Old localStorage
// values remain intact and are checked even after migration; IDB is not an
// atomic lock against an uncooperative old localStorage writer.
export const BROWSER_STORAGE_METHODS = ["storage.getSnapshot", "storage.compareAndSet"];
const PREFIX = "codeshell-design-studio:";
const failure = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const missing = () => failure("file not found", "ENOENT");
const conflict = () => failure("workspace file changed since it was opened", "BROWSER_STORAGE_CONFLICT");
const legacyConflict = (extra) => failure("旧浏览器页面已修改旧存储；新旧数据均已保留，已停止覆盖。请先下载当前画布备份并核对旧稿。", "BROWSER_LEGACY_CONFLICT", extra);
const wrapError = error => error?.name === "QuotaExceededError"
  ? failure("浏览器本地存储空间已满，文件尚未确认保存；当前画布仍保留，请下载完整备份。", "BROWSER_STORAGE_QUOTA", { cause: error })
  : error?.name === "AbortError" ? failure("浏览器保存事务已取消；原稿与附件保留，请重试或下载完整备份。", "BROWSER_STORAGE_ABORT", {cause:error}) : error;

export function createBrowserStore({ indexedDB = globalThis.indexedDB, localStorage = globalThis.localStorage,
  crypto = globalThis.crypto, databaseName = "codeshell-design-studio-v1", now = Date.now } = {}) {
  let database;
  const hash = async text => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(value => value.toString(16).padStart(2,"0")).join("");
  const fingerprint = raw => hash(JSON.stringify(raw));
  const legacy = key => ({ content: localStorage.getItem(PREFIX + key),
    mtime: key.startsWith("file:") ? localStorage.getItem(PREFIX + "mtime:" + key.slice(5)) : null });
  const sameLegacy = (a,b) => a.content === b.content && a.mtime === b.mtime;
  const open = () => database ??= new Promise((resolve, reject) => {
    if (!indexedDB) { reject(failure("浏览器本地数据库不可用；未改写旧存储，请下载完整备份。", "BROWSER_STORAGE_UNAVAILABLE")); return; }
    const request = indexedDB.open(databaseName, 1); let settled = false;
    const timer = setTimeout(() => { settled = true; reject(failure("浏览器本地数据库打开超时，请关闭冲突页面后重试；旧数据保留。", "BROWSER_STORAGE_UNAVAILABLE")); }, 10000);
    request.onupgradeneeded = () => { const db = request.result; db.createObjectStore("records", { keyPath: "key" }); db.createObjectStore("history", { keyPath: "key" }); };
    request.onblocked = () => { settled = true; clearTimeout(timer); reject(failure("浏览器本地数据库正被旧页面占用；旧数据保留。", "BROWSER_STORAGE_UNAVAILABLE")); };
    request.onerror = () => { settled = true; clearTimeout(timer); reject(wrapError(request.error)); };
    request.onsuccess = () => { clearTimeout(timer); if (settled) return request.result.close(); settled = true;
      const db = request.result; db.onversionchange = () => { db.close(); database = undefined; }; resolve(db); };
  }).catch(error => { database = undefined; throw error; });
  async function get(key) {
    const db = await open(); return new Promise((resolve,reject) => {
      const tx = db.transaction("records", "readonly"), request = tx.objectStore("records").get(key);
      let result; request.onsuccess = () => result = request.result;
      tx.oncomplete = () => resolve(result); tx.onabort = () => reject(wrapError(tx.error)); tx.onerror = () => {};
    });
  }
  async function observe(key) {
    const stored = await get(key), raw = legacy(key), legacyFingerprint = await fingerprint(raw);
    if (!sameLegacy(raw, legacy(key))) throw legacyConflict();
    if (stored && stored.legacyFingerprint !== legacyFingerprint) throw legacyConflict();
    const value = stored ?? (raw.content === null ? null : { key, content: raw.content, modifiedAt: Number(raw.mtime) || 0,
      revision: `legacy:${legacyFingerprint}`, legacyFingerprint, migratedFrom: "localStorage" });
    return { key, stored, raw, legacyFingerprint, value };
  }
  const response = (path, record) => {
    if (!record || record.deleted) throw missing();
    return { path, content: record.content, size: new TextEncoder().encode(record.content).length, modifiedAt: record.modifiedAt, revision: record.revision };
  };
  async function snapshot(record) {
    return !record || record.deleted ? { exists: false, value: null, revision: null }
      : { exists: true, value: JSON.parse(record.content), revision: `sha256:${await hash(record.content)}` };
  }
  async function paths() {
    const db = await open(), rows = await new Promise((resolve,reject) => { const tx = db.transaction("records", "readonly"), request = tx.objectStore("records").getAllKeys(); let result;
      request.onsuccess = () => result = request.result; tx.oncomplete = () => resolve(result); tx.onabort = () => reject(wrapError(tx.error)); });
    const result = new Set(rows.filter(key => key.startsWith("file:")).map(key => key.slice(5)));
    for (let i=0;i<localStorage.length;i++) { const key = localStorage.key(i); if (key?.startsWith(PREFIX+"file:")) result.add(key.slice((PREFIX+"file:").length)); }
    return [...result].sort();
  }
  function begin({ check = () => {} } = {}) {
    const observations = new Map(), writes = new Map(); let settled = false, bytes = 0;
    const read = async key => { check(); if (!observations.has(key)) observations.set(key, await observe(key)); check(); return writes.get(key) ?? observations.get(key).value; };
    const stage = async (key, content, deleted = false) => {
      const before = await read(key); bytes += content?.length ?? 0; if (bytes > 128 * 1024 * 1024) throw failure("浏览器保存批次超过 128 MiB 文本预算，请拆分设计。", "BROWSER_STORAGE_BUDGET");
      const record = { key, content, deleted, modifiedAt: Math.max(now(), (before?.modifiedAt ?? 0) + 1), revision: `browser:${crypto.randomUUID()}`,
        legacyFingerprint: observations.get(key).legacyFingerprint, migratedFrom: observations.get(key).raw.content === null ? null : "localStorage" };
      writes.set(key, record); return record;
    };
    async function call(method, params = {}) {
      if (settled) throw failure("浏览器保存事务已结束", "BROWSER_STORAGE_TRANSACTION_CLOSED"); check();
      if (method === "workspace.info") return { name: "浏览器本地", root: "/preview/codeshell", trusted: true, gitBranch: null, storageBackend: "indexeddb" };
      if (method === "workspace.readText") return response(params.path, await read("file:" + params.path));
      if (method === "workspace.writeText") {
        if (typeof params.path !== "string" || !params.path.startsWith("designs/") || params.path.split("/").some(part=>part===".."||part===".") || /[\\:\u0000-\u001f\u007f]/u.test(params.path) || typeof params.content !== "string") throw failure("浏览器文件路径或内容无效", "BROWSER_STORAGE_INVALID");
        const key = "file:" + params.path, record = await read(key), exists = record && !record.deleted;
        if (params.expectedRevision !== undefined ? params.expectedRevision !== (exists ? record.revision : null)
          : params.expectedModifiedAt === null ? exists : typeof params.expectedModifiedAt === "number" && params.expectedModifiedAt !== (exists ? record.modifiedAt : null)) throw conflict();
        return response(params.path, await stage(key, params.content));
      }
      if (method === "workspace.list") {
        const entries = new Map();
        for (const path of await paths()) {
          if (!path.startsWith(params.path + "/")) continue;
          const remainder = path.slice(params.path.length + 1), name = remainder.split("/")[0];
          if (remainder.includes("/")) entries.set(name, { name, path:params.path+"/"+name,kind:"directory" });
          else { const file = response(path, await read("file:"+path)); entries.set(name, {name,path,kind:"file",size:file.size,modifiedAt:file.modifiedAt}); }
        }
        return {path:params.path,entries:[...entries.values()].sort((a,b)=>a.name.localeCompare(b.name)),truncated:false};
      }
      if (method.startsWith("storage.")) {
        const key = "storage:"+params.key, record = await read(key);
        if (method === "storage.get") return record && !record.deleted ? JSON.parse(record.content) : null;
        if (method === "storage.getSnapshot") return snapshot(record);
        if (method === "storage.compareAndSet") {
          const current = await snapshot(record);
          if (params.expectedRevision !== current.revision) return {updated:false,snapshot:current};
          const next = await stage(key, params.remove ? null : JSON.stringify(params.value), params.remove === true);
          return {updated:true,snapshot:await snapshot(next)};
        }
        if (method === "storage.set") { await stage(key,JSON.stringify(params.value)); return true; }
        if (method === "storage.delete") { await stage(key,null,true); return true; }
      }
      throw failure("浏览器本地模式未连接此功能，请连接 CodeShell 后重试", "BROWSER_METHOD_UNAVAILABLE");
    }
    async function commit() {
      if (settled) throw failure("浏览器保存事务已结束", "BROWSER_STORAGE_TRANSACTION_CLOSED"); settled = true; check();
      if (!writes.size) return;
      const db = await open(); check();
      await new Promise((resolve,reject) => {
        const tx = db.transaction(["records","history"], "readwrite"), records = tx.objectStore("records"), history = tx.objectStore("history");
        let error, pending = observations.size;
        const abort = value => { error = value; try { tx.abort(); } catch {} };
        tx.onabort = () => reject(wrapError(error ?? tx.error ?? failure("浏览器保存事务已取消", "BROWSER_STORAGE_ABORT")));
        tx.onerror = () => {};
        tx.oncomplete = () => resolve();
        const publish = () => {
          try { check(); for (const observation of observations.values()) if (!sameLegacy(observation.raw, legacy(observation.key))) throw legacyConflict();
            for (const [key,record] of writes) {
              const previous = observations.get(key).value;
              if (previous) history.put({ key:`${key}\u0000${previous.revision}`, record:previous });
              records.put(record);
            }
          } catch (value) { abort(value); }
        };
        for (const observation of observations.values()) {
          const request = records.get(observation.key);
          request.onsuccess = () => {
            try { check(); if (request.result?.revision !== observation.stored?.revision) throw conflict();
              if (!sameLegacy(observation.raw, legacy(observation.key))) throw legacyConflict();
              if (--pending === 0) publish();
            } catch (value) { abort(value); }
          };
        }
      });
      // Old LS clients do not share IDB locks. If one wrote across commit, both
      // versions remain (including history); report uncertain publication and
      // continue refusing every later read instead of hiding its legacy write.
      try {
        for (const observation of observations.values()) if (!sameLegacy(observation.raw, legacy(observation.key)))
          throw legacyConflict();
        check();
      } catch (error) {
        // The IDB transaction has already completed. A late legacy/scope
        // refusal must not authorize the caller to undo the published draft.
        error.designPublicationUnknown = true;
        throw error;
      }
    }
    return {call,commit};
  }
  async function call(method, params) {
    const batch = begin(); const result = await batch.call(method,params);
    try { await batch.commit(); return result; }
    catch (error) {
      if (method === "storage.compareAndSet" && error.code === "BROWSER_STORAGE_CONFLICT") return {updated:false,snapshot:await call("storage.getSnapshot",{key:params.key})};
      throw error;
    }
  }
  return {call,begin};
}
