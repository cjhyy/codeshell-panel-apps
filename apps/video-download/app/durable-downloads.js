import { cleanConfiguration, resourceFileFields, taskPackageReference } from "./download-library.js";
// The Host owns scheduling and execution. This adapter only reconciles project UI records.
export function supportsDurableDownloads(context) {
  const methods = context?.availableMethods || [];
  return (
    context?.capabilities?.tasks?.directoryBookmarks === true &&
    context?.capabilities?.tasks?.queueControl === true &&
    methods.includes("tasks.find")
  );
}

export function createDurableDownloads({
  panel,
  items,
  save,
  discover,
  changed,
  queueChanged,
  failed,
  requestDelay = 450,
}) {
  let queue,
    refreshing,
    submitting = false,
    closed = false;
  let calls = Promise.resolve(),
    lastCall = 0;
  const call = (method, args) => {
    const result = calls.then(async () => {
      const wait = lastCall + requestDelay - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (closed) throw new Error("项目页面已关闭，请重新打开。");
      lastCall = Date.now();
      return panel.call(method, args);
    });
    calls = result.catch(() => {});
    return result;
  };
  const operations = new Map();
  function forItem(item, operation) {
    const prior = operations.get(item.queueId) || Promise.resolve();
    const next = prior.catch(() => {}).then(operation);
    operations.set(item.queueId, next);
    void next
      .finally(() => {
        if (operations.get(item.queueId) === next) operations.delete(item.queueId);
      })
      .catch(() => {});
    return next;
  }
  const terminal = new Set(["succeeded", "failed", "cancelled", "interrupted"]);
  function apply(item, job) {
    if (closed) return;
    if (!job || job.entry?.name !== "download-runtime")
      throw new Error("后台任务与下载记录不匹配。");
    if (job.input?.request?.url && job.input.request.url !== item.url)
      throw new Error("后台任务网址与下载记录不匹配。");
    if (Number.isSafeInteger(item.nativeSequence) && item.nativeSequence > job.sequence) return;
    const previousMetadata = JSON.stringify([
      item.nativeReadOnly, item.nativePackage, item.nativeRetryBlocked,
    ]);
    if (typeof job.readOnly === "boolean") item.nativeReadOnly = job.readOnly;
    item.nativePackage = taskPackageReference(job.package);
    item.nativeRetryBlocked = item.nativeReadOnly || job.error?.retryable === false;
    // Access can change without the stored task sequence changing (e.g. project upgrade).
    if (item.nativeSequence === job.sequence) {
      if (previousMetadata !== JSON.stringify([
        item.nativeReadOnly, item.nativePackage, item.nativeRetryBlocked,
      ]))
        changed(item, terminal.has(job.status) && job.status !== "cancelled");
      return;
    }
    item.nativeTaskId = job.id;
    item.running = ["running", "cancelling"].includes(job.status);
    item.status =
      job.status === "succeeded"
        ? "completed"
        : job.status === "cancelled" && item.nativePaused
          ? "paused"
          : job.status === "cancelling"
            ? "running"
            : job.status;
    item.percent =
      job.status === "succeeded"
        ? 100
        : Number.isFinite(job.progress?.fraction)
          ? job.progress.fraction * 100
          : item.percent;
    item.error =
      job.status === "failed" || job.status === "interrupted"
        ? job.error?.message || "后台任务已中断，请明确重试。"
        : "";
    item.startedAt = job.startedAt;
    item.finishedAt = job.completedAt;
    item.stopPending = job.status === "cancelling";
    if (job.result) {
      item.files = (job.result.artifacts || [])
        .filter((artifact) => artifact.published?.path)
        .map((artifact) => ({
          path: artifact.published.path,
          ...resourceFileFields(artifact),
          bytes: artifact.bytes,
          status: "present",
        }));
      item.filesComplete = item.files.length === job.result.artifacts?.length;
    }
    item.nativeSequence = job.sequence;
    changed(
      item,
      (terminal.has(job.status) && job.status !== "cancelled") || item.status === "cancelled",
    );
  }
  function request(item) {
    if (!item.directory?.bookmark) throw new Error("请重新选择保存目录，授予后台下载权限。");
    if (
      item.cookieCredentialId &&
      (!/^[a-f0-9]{64}$/.test(item.cookieCredentialRevision || "") ||
        !/^https:\/\//.test(item.cookieCredentialUrl || ""))
    )
      throw new Error("缺少原账号授权版本，请重新选择账号后创建下载。");
    const { cookieAccount: _cookie, ...configuration } = cleanConfiguration(item.configuration);
    return {
      entry: "download-runtime",
      recovery: "retry",
      requestKey: item.nativeRequestKey,
      input: {
        request: {
          action: "download",
          url: item.url,
          configuration,
          ...(item.cookieCredentialId ? { useSavedLogin: true } : {}),
          ...(item.copySuffix ? { copySuffix: item.copySuffix } : {}),
        },
        directoryArguments: [
          { argumentName: "--job-dir", directory: "job" },
          {
            argumentName: "--output-dir",
            directory: "bookmark",
            bookmark: item.directory.bookmark,
          },
        ],
        ...(item.cookieCredentialId
          ? {
              cookieArgument: {
                argumentName: "--cookies-file",
                credentialId: item.cookieCredentialId,
                revision: item.cookieCredentialRevision,
                url: item.cookieCredentialUrl,
              },
            }
          : {}),
      },
    };
  }
  async function locate(item) {
    return item.nativeTaskId
      ? call("tasks.get", { id: item.nativeTaskId })
      : item.nativeRequestKey
        ? call("tasks.find", { requestKey: item.nativeRequestKey })
        : null;
  }
  async function submit(item) {
    // Save the correlation key before admitting work. A missing reply is queried, never replayed.
    const input = request(item);
    item.nativeRequestKey ||= `download:${item.queueId}`;
    input.requestKey = item.nativeRequestKey;
    await save();
    let job = await locate(item);
    if (!job) {
      try {
        job = await call("tasks.start", input);
      } catch (error) {
        job = await call("tasks.find", { requestKey: item.nativeRequestKey }).catch(() => null);
        if (!job) throw error;
      }
    }
    apply(item, job);
    await save();
    return job;
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      queue = await call("tasks.queue.get", {});
      if (closed) return;
      queueChanged(queue);
      await discover?.();
      if (closed) return;
      const own = items().filter((item) => item.nativeRequestKey || item.nativeTaskId);
      if (!own.length) return;
      const summaries = new Map();
      for (let offset = 0; offset < 2000; offset += 50) {
        const page = await call("tasks.list", { offset, limit: 50 });
        for (const job of page) summaries.set(job.id, job);
        if (
          page.length < 50 ||
          own.every((item) => item.nativeTaskId && summaries.has(item.nativeTaskId))
        )
          break;
      }
      let detailReads = 0;
      for (const item of own) {
        if (closed) return;
        let job = summaries.get(item.nativeTaskId);
        if (!job || (terminal.has(job.status) && item.nativeSequence !== job.sequence)) {
          if (detailReads++ >= 8) continue;
          job = await locate(item);
        }
        if (!job) {
          item.status = "interrupted";
          item.running = false;
          item.error = "未找到已接收的后台任务，请确认后重试。";
          changed(item, false);
          continue;
        }
        apply(item, job);
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }
  function observe(job) {
    const item = items().find((candidate) => candidate.nativeTaskId === job?.id);
    if (closed) return;
    if (!item) {
      if (discover && job?.entry?.name === "download-runtime") void refresh().catch(failed);
      return;
    }
    if (terminal.has(job.status)) {
      void forItem(item, async () => apply(item, await locate(item))).catch(failed);
    } else apply(item, job);
  }
  async function configure(paused, maxConcurrent) {
    if (!queue) queue = await call("tasks.queue.get", {});
    let result;
    try {
      result = await call("tasks.queue.set", {
        expectedRevision: queue.revision,
        paused,
        maxConcurrent,
      });
    } catch (error) {
      // Resolve the current state without replaying a possibly accepted mutation.
      queue = await call("tasks.queue.get", {});
      queueChanged(queue);
      throw new Error(`未确认队列修改，请核对当前设置后再操作：${error.message}`);
    }
    queue = result.queue;
    queueChanged(queue);
    if (!result.saved) throw new Error("另一设备已修改后台队列，请检查最新设置后再操作。");
  }
  async function pump() {
    if (submitting || closed) return;
    submitting = true;
    try {
      // Admit the entire requested queue; the Host decides when each job runs.
      for (const item of items()) {
        if (closed) break;
        if (item.status !== "queued" || item.nativeRequestKey || item.nativeTaskId) continue;
        try {
          await forItem(item, () => submit(item));
        } catch (error) {
          if (!item.nativeTaskId) {
            item.status = "failed";
            item.running = false;
          }
          item.error = error.message;
          changed(item, false);
          failed(error);
          break;
        }
      }
    } finally {
      submitting = false;
    }
  }
  async function stop(item, pause) {
    item.nativePaused = pause;
    let saveError;
    await save().catch((error) => {
      saveError = error;
    });
    const existing = await locate(item);
    if (!existing) {
      item.status = pause ? "paused" : "cancelled";
      item.running = false;
      changed(item, false);
    } else apply(item, await call("tasks.cancel", { id: existing.id }));
    await save().catch((error) => {
      saveError = error;
    });
    if (saveError)
      failed(new Error(`任务已停止，但界面记录未能保存，请重新打开面板：${saveError.message}`));
  }
  async function resume(item) {
    const job = await locate(item);
    if (!job) {
      item.nativePaused = false;
      return submit(item);
    }
    apply(item, job);
    if (job.readOnly || job.error?.retryable === false)
      throw new Error(job.readOnly
        ? "此任务仅可查看。请在下载页检查链接和设置后重新添加；原任务和结果会保留。"
        : job.error?.message || "此任务不能直接重试，请检查输入后重新添加。");
    item.nativePaused = false;
    if (["failed", "cancelled", "interrupted"].includes(job.status)) {
      apply(item, await call("tasks.retry", { id: job.id }));
      await save();
    } else apply(item, job);
  }
  return {
    refresh,
    observe,
    configure,
    pump,
    stop: (item, pause) => forItem(item, () => stop(item, pause)),
    resume: (item) => forItem(item, () => resume(item)),
    close() {
      closed = true;
    },
  };
}
