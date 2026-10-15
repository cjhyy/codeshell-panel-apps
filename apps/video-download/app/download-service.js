const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const statuses = new Set(["pending", "queued", "running", "cancelling", "paused", "restored", "interrupted", "completed", "failed", "cancelled"]);
const error = (code, message) => Object.assign(new Error(message), { code });
const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const validJob = (job) => isObject(job) && UUID.test(job.id) && statuses.has(job.status);
const validQueue = (queue) => isObject(queue) && Number.isSafeInteger(queue.revision) && queue.revision >= 0 &&
  typeof queue.paused === "boolean" && Number.isInteger(queue.maxConcurrent) &&
  queue.maxConcurrent >= 1 && queue.maxConcurrent <= 4 &&
  Number.isSafeInteger(queue.active) && queue.active >= 0;

function projectIdentity(context) {
  const scope = context?.projectScope;
  return JSON.stringify([
    context?.cwd || context?.projectPath || context?.workspace?.root || "",
    context?.host || "", context?.appId || "",
    scope?.version, scope?.environmentId, scope?.projectId, scope?.rootId,
  ]);
}

// The service helper owns only a short request. Detached download workers belong
// to the project, so destroying this client never aborts or cancels them.
export function createDownloadService({
  panel, processes, getContext = () => ({}), assertCurrent = () => {},
  onChanged = () => {}, onError = () => {},
}) {
  let closed = false, invalidated = false, boundIdentity, entryPromise, records = [], queue = null;
  let tail = Promise.resolve(), refreshPromise = null, observingTimer;

  async function current() {
    if (closed) throw error("SERVICE_CLOSED", "下载面板已关闭。");
    if (invalidated) throw error("PROJECT_CHANGED", "项目或执行位置已变化，请重新打开面板查看下载任务。");
    assertCurrent();
    const context = await getContext();
    if (closed) throw error("SERVICE_CLOSED", "下载面板已关闭。");
    assertCurrent();
    const identity = projectIdentity(context);
    if (boundIdentity === undefined) boundIdentity = identity;
    if (boundIdentity !== identity) {
      invalidated = true;
      throw error("PROJECT_CHANGED", "项目或执行位置已变化，请重新打开面板查看下载任务。");
    }
  }

  function serialize(operation) {
    const pending = tail.then(operation);
    tail = pending.catch(() => {});
    return pending;
  }

  async function handles() {
    if (!entryPromise) entryPromise = (async () => {
      await current();
      if (!panel) throw error("SERVICE_UNAVAILABLE", "下载任务需要在 CodeShell 中管理。");
      const executable = await panel.call("process.find", { name: "node" });
      await current();
      if (!executable?.available || !executable.handle)
        throw error("NODE_MISSING", "未找到 Node，请准备运行环境后重试。");
      const entry = await panel.call("process.resolveEntry", {
        name: "download-service", executableHandle: executable.handle,
      });
      await current();
      if (!entry?.handle) throw error("SERVICE_UNAVAILABLE", "无法校验下载服务，请更新面板。");
      return { executableHandle: executable.handle, entryHandle: entry.handle };
    })().catch((failure) => { entryPromise = undefined; throw failure; });
    return entryPromise;
  }

  async function request(input, dispatched = () => {}) {
    await current();
    const entry = await handles();
    await current();
    const directory = await panel.call("filesystem.getKnownDirectory", { name: "project" });
    await current();
    if (!directory?.handle) throw error("PROJECT_UNAVAILABLE", "当前项目目录尚未授权。");
    dispatched();
    const receipt = await processes.run({
      ...entry, directoryHandle: directory.handle, input, timeout: 30_000,
    });
    await current();
    let response;
    try { response = JSON.parse(receipt.stdout); }
    catch { throw error("SERVICE_INVALID_RECEIPT", "下载服务未返回有效结果。"); }
    if (
      !isObject(response) || response.format !== "mimi-download.service" ||
      response.schemaVersion !== 1 || typeof response.ok !== "boolean"
    ) throw error("SERVICE_INVALID_RECEIPT", "下载服务结果不完整。");
    if (!response.ok) {
      const failure = error(response.error?.code || "SERVICE_FAILED",
        response.error?.message || "下载服务操作失败。");
      failure.confirmed = true;
      throw failure;
    }
    if (receipt.code !== 0) throw error("SERVICE_INVALID_RECEIPT", "下载服务退出状态与结果不一致。");
    return response.result;
  }

  function publish(result) {
    if (closed) return;
    onChanged(records.slice(), result);
  }

  async function readQueue() {
    const result = await request({ action: "queue" });
    if (!validQueue(result)) throw error("SERVICE_INVALID_RECEIPT", "下载队列结果不完整。");
    queue = result;
    return result;
  }

  async function readList() {
    const result = await request({ action: "list" });
    if (!isObject(result) || !Array.isArray(result.jobs) || result.jobs.length > 1000 ||
      result.jobs.some((job) => !validJob(job)))
      throw error("SERVICE_INVALID_RECEIPT", "下载任务列表不完整。");
    let nextQueue = result.queue;
    if (nextQueue === undefined) nextQueue = await readQueue();
    else if (!validQueue(nextQueue)) throw error("SERVICE_INVALID_RECEIPT", "下载队列结果不完整。");
    await current();
    records = result.jobs.slice();
    queue = nextQueue;
    publish({ ...result, queue });
    return { ...result, queue };
  }

  function report(failure) {
    if (failure.code === "PROJECT_CHANGED") {
      invalidated = true;
      clearInterval(observingTimer);
      observingTimer = undefined;
    }
    if (!closed) onError(failure);
    return failure;
  }

  function refresh() {
    if (refreshPromise) return refreshPromise;
    const pending = serialize(readList).catch((failure) => { throw report(failure); });
    refreshPromise = pending;
    pending.then(() => {
      if (refreshPromise === pending) refreshPromise = null;
    }, () => {
      if (refreshPromise === pending) refreshPromise = null;
    });
    return pending;
  }

  function validId(id) {
    if (typeof id !== "string" || !UUID.test(id)) throw error("INVALID_ARGUMENT", "任务 ID 无效。");
    return id;
  }

  function mutate(input, { queueResult = false } = {}) {
    return serialize(async () => {
      let dispatched = false, validated = false;
      try {
        const result = await request(input, () => { dispatched = true; });
        if (queueResult) {
          if (!validQueue(result)) throw error("SERVICE_INVALID_RECEIPT", "下载队列结果不完整。");
          queue = result;
        } else {
          if (!validJob(result) || (input.id && result.id !== input.id))
            throw error("SERVICE_INVALID_RECEIPT", "下载任务结果与请求不匹配。");
          records = records.filter((job) => job.id !== result.id);
          if (result.archived !== true && !(result.archivedAt > 0)) records.push(result);
        }
        validated = true;
        publish(result);
        return result;
      } catch (failure) {
        if (dispatched && !validated && !failure.confirmed && !closed && failure.code !== "PROJECT_CHANGED") {
          // A request can be accepted before its reply is lost. Only read back;
          // never resubmit a potentially accepted mutation automatically.
          let recoveryError;
          try { await readList(); } catch (readFailure) { recoveryError = readFailure; }
          if (closed || recoveryError?.code === "PROJECT_CHANGED") throw recoveryError || failure;
          const uncertain = error("SERVICE_UNCERTAIN", "操作可能已被后台接收，请核对任务状态后再操作。");
          uncertain.cause = failure;
          if (recoveryError) uncertain.recoveryError = recoveryError;
          throw uncertain;
        }
        throw failure;
      }
    }).catch((failure) => { throw report(failure); });
  }

  return {
    get records() { return records.slice(); },
    get queue() { return queue ? { ...queue } : null; },
    refresh,
    startObserving({ intervalMs = 5000 } = {}) {
      if (!Number.isFinite(intervalMs) || intervalMs < 1)
        return Promise.reject(error("INVALID_ARGUMENT", "刷新间隔无效。"));
      if (closed) return Promise.reject(error("SERVICE_CLOSED", "下载面板已关闭。"));
      if (!observingTimer) {
        observingTimer = setInterval(() => { void refresh().catch(() => {}); }, intervalMs);
        observingTimer.unref?.();
      }
      return refresh();
    },
    getQueue() {
      return serialize(async () => {
        const result = await readQueue();
        publish(result);
        return result;
      }).catch((failure) => { throw report(failure); });
    },
    configure({ expectedRevision, paused, maxConcurrent } = {}) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        typeof paused !== "boolean" || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4)
        return Promise.reject(error("INVALID_ARGUMENT", "下载队列设置无效。"));
      return mutate({ action: "configure", expectedRevision, paused, maxConcurrent }, { queueResult: true });
    },
    submit({ requestKey, request: download, source = "panel", start = true, title } = {}) {
      if (typeof requestKey !== "string" || !requestKey || requestKey.length > 160 ||
        /[\u0000-\u001f\u007f]/.test(requestKey) || !isObject(download) || source !== "panel" || typeof start !== "boolean" ||
        (title !== undefined && (typeof title !== "string" || title.length > 500)))
        return Promise.reject(error("INVALID_ARGUMENT", "下载请求无效。"));
      // Only media fields cross the boundary; Host grants and Cookie material do
      // not become CLI input through a view model or a copied form object.
      const { url, configuration, outputDirectory, copySuffix } = download;
      const mediaConfiguration = {};
      if (isObject(configuration)) for (const key of ["format", "playlist", "playlistItems", "playlistEnd",
        "subtitles", "subtitleMode", "subtitleLanguagePreset", "subtitleLanguages", "embedSubtitles"])
        if (Object.hasOwn(configuration, key)) mediaConfiguration[key] = configuration[key];
      return mutate({ action: "submit", requestKey, source, start, ...(title === undefined ? {} : { title }), request: {
        url, configuration: mediaConfiguration, ...(outputDirectory === undefined ? {} : { outputDirectory }),
        ...(copySuffix === undefined ? {} : { copySuffix }),
      } });
    },
    cancel(id) {
      try { return mutate({ action: "cancel", id: validId(id) }); }
      catch (failure) { return Promise.reject(failure); }
    },
    retry(id, expectedAttempt) {
      try {
        validId(id);
        if (!Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1)
          throw error("INVALID_ARGUMENT", "重试前请刷新任务版本。");
        return mutate({ action: "retry", id, expectedAttempt });
      } catch (failure) { return Promise.reject(failure); }
    },
    start(id, expectedAttempt) {
      try {
        validId(id);
        if (!Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1)
          throw error("INVALID_ARGUMENT", "开始前请刷新任务版本。");
        return mutate({ action: "start", id, expectedAttempt });
      } catch (failure) { return Promise.reject(failure); }
    },
    check(id) {
      try { return mutate({ action: "check", id: validId(id) }); }
      catch (failure) { return Promise.reject(failure); }
    },
    archive(id) {
      try { return mutate({ action: "archive", id: validId(id) }); }
      catch (failure) { return Promise.reject(failure); }
    },
    destroy() {
      closed = true;
      clearInterval(observingTimer);
      observingTimer = undefined;
    },
  };
}
