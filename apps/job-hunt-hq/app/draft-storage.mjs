const STATE_KEY = "job-hunt-state-v1";
const OWNER_KEY = "job-hunt-draft-owner-v1";
export const LEGACY_DRAFT_KEY = "job-hunt-critical-drafts-v1";
const PREFIX = "job-hunt-critical-drafts-v2:";
const failure = (message) => new Error(message);

function snapshot(record) {
  if (!record || typeof record.exists !== "boolean" || !Object.hasOwn(record, "value") ||
      (record.exists ? !/^sha256:[a-f0-9]{64}$/.test(record.revision) :
        record.revision !== null || record.value !== null))
    throw failure("无法确认草稿存储版本，已停止覆盖，请先下载备份。");
  return record;
}

// The opaque owner lives in project-scoped Host storage. Paths alone cannot
// distinguish cloud projects that all mount their files at /workspace.
export function createDraftStorage({ call, methods = [], storage, check, randomId }) {
  const versioned = ["storage.getSnapshot", "storage.compareAndSet"].every(m => methods.includes(m));
  let revision = null, owner = null, loaded = false, blocked = null, observedState = null, browserBlocked = false;
  let tail = Promise.resolve();
  const writer = randomId();
  const invoke = async (method, params) => {
    check();
    const result = await call(method, params);
    check();
    return result;
  };
  const read = async (key) => snapshot(await invoke("storage.getSnapshot", { key }));
  const ownerValue = (value) => {
    if (!value || value.version !== 1 || !/^[a-f0-9]{32}$/.test(value.id))
      throw failure("草稿项目标识损坏，已保留原记录，请先下载备份。");
    return value.id;
  };
  const browserPrefix = () => owner ? PREFIX + owner + "." : null;
  const browserKey = () => owner ? browserPrefix() + writer : null;
  const browserRecords = () => {
    if (!owner) return [];
    const records = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(browserPrefix())) records.push({ key, raw: storage.getItem(key) });
    }
    return records;
  };
  const raw = (key) => { try { return storage.getItem(key); } catch { return null; } };
  return {
    versioned,
    get owner() { return owner; },
    backup() { return { owner, hostState: observedState, records: browserRecords(), legacyRaw: raw(LEGACY_DRAFT_KEY) }; },
    async load({ archiveDamagedBrowser = false } = {}) {
      loaded = false;
      check();
      if (versioned) {
        let identity = await read(OWNER_KEY);
        if (!identity.exists) {
          const value = { version: 1, id: randomId() };
          ownerValue(value);
          try {
            const result = await invoke("storage.compareAndSet", { key: OWNER_KEY, expectedRevision: null, value });
            if (typeof result?.updated !== "boolean") throw failure("草稿项目标识保存结果不明确");
            identity = snapshot(result.snapshot);
          } catch {
            // Another window or a lost acknowledgement may have created it.
            // Read once; never overwrite an existing identity or repeat the write.
            identity = await read(OWNER_KEY);
          }
        }
        if (!identity.exists) throw failure("草稿项目标识尚未保存，请重试读取。");
        owner = ownerValue(identity.value);
      }
      const record = versioned ? await read(STATE_KEY) : { value: await invoke("storage.get", { key: STATE_KEY }) };
      const saved = record.value;
      observedState = structuredClone(saved);
      if (saved !== null && (typeof saved !== "object" || Array.isArray(saved)))
        throw failure("草稿状态格式损坏，已停止覆盖，请先下载备份。");
      revision = record.revision ?? null;
      loaded = true;
      blocked = null;
      let recovery = null;
      try {
        const rawRecords = browserRecords();
        const quarantined = rawRecords.flatMap(record => {
          try {
            const entry = JSON.parse(record.raw);
            return entry?.version === 2 && entry.owner === owner && entry.archived === true &&
              typeof entry.rawBackup?.key === "string" && typeof entry.rawBackup?.raw === "string"
              ? [entry.rawBackup] : [];
          } catch { return []; }
        });
        const records = [];
        for (const record of rawRecords) {
          if (quarantined.some(copy => copy.key === record.key && copy.raw === record.raw)) continue;
          try {
            const entry = JSON.parse(record.raw);
            if (entry?.owner !== owner || entry?.version !== 2 || !entry?.drafts ||
                typeof entry.drafts !== "object" || !Number.isFinite(entry.savedAt)) throw new Error();
            if (!entry.archived) records.push(entry);
          } catch (error) {
            if (!archiveDamagedBrowser) throw error;
            // Preserve raw bytes first, without deleting/changing the original.
            // Future loads ignore only this exact archived key+value pair, so a
            // concurrent writer's changed value is still inspected normally.
            storage.setItem(browserPrefix() + "quarantine-" + randomId(), JSON.stringify({
              version: 2, owner, archived: true, savedAt: Date.now(), drafts: {}, rawBackup: record,
            }));
          }
        }
        records.sort((a, b) => b.savedAt - a.savedAt);
        browserBlocked = false;
        recovery = records[0]?.drafts ?? null;
      } catch {
        browserBlocked = true;
        blocked = failure("当前项目的浏览器草稿无法读取，已保留原始记录，请下载备份后处理。");
        throw blocked;
      }
      return { saved, recovery };
    },
    retain(drafts) {
      check();
      if (browserBlocked || !loaded || !browserKey()) return;
      // Keep an explicit empty record as a tombstone; never delete another
      // window's fallback by removing a global key.
      const previousTimes = browserRecords().map(record => {
        try { return Number(JSON.parse(record.raw).savedAt) || 0; } catch { return 0; }
      });
      const savedAt = Math.max(Date.now(), ...previousTimes.map(time => time + 1));
      storage.setItem(browserKey(), JSON.stringify({ version: 2, owner, savedAt, drafts }));
    },
    archive(drafts) {
      check();
      if (!loaded || !owner || blocked) throw blocked || failure("当前项目草稿尚未就绪，请先重新读取。");
      storage.setItem(browserPrefix() + "backup-" + randomId(), JSON.stringify({ version: 2, owner, savedAt: Date.now(), archived: true, drafts }));
    },
    save(value) {
      const copy = structuredClone(value);
      const action = tail.catch(() => {}).then(async () => {
        check();
        if (!loaded || blocked) throw blocked || failure("草稿尚未成功读取，已阻止覆盖。");
        if (!versioned) {
          try { await invoke("storage.set", { key: STATE_KEY, value: copy }); }
          catch (error) { blocked = error; throw error; }
          return;
        }
        const matches = (record) => record.exists && JSON.stringify(record.value) === JSON.stringify(copy);
        let result;
        try {
          result = await invoke("storage.compareAndSet", { key: STATE_KEY, expectedRevision: revision, value: copy });
        } catch (error) {
          check();
          const observed = await read(STATE_KEY).catch(() => null);
          check();
          if (observed && matches(observed)) { revision = observed.revision; return; }
          blocked = failure("无法确认草稿是否保存，已停止重发。请下载备份后重新读取。");
          throw blocked;
        }
        let record;
        try { record = snapshot(result?.snapshot); } catch (error) { blocked = error; throw error; }
        if (result.updated !== true || !matches(record)) {
          blocked = failure("其他窗口已更新草稿，当前输入仍保留；请下载备份后重新读取。");
          throw blocked;
        }
        revision = record.revision;
      });
      tail = action;
      return action;
    },
  };
}
