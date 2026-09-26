const ENTRY = "resume-pdf";
const terminal = new Set(["succeeded", "failed", "cancelled", "interrupted"]);
const requiredMethods = ["tasks.start", "tasks.find", "tasks.get", "tasks.list", "tasks.cancel", "tasks.retry", "resources.open"];

export function supportsResumePdfTasks(context) {
  return requiredMethods.every((method) => context?.availableMethods?.includes(method));
}

export async function prepareResumePdfTask({ html, resumeId, updatedAt }) {
  if (typeof html !== "string" || !html.trim() || new TextEncoder().encode(html).length > 1900 * 1024 ||
      typeof resumeId !== "string" || !resumeId || resumeId.length > 100 ||
      typeof updatedAt !== "string" || updatedAt.length > 80)
    throw new Error("简历导出内容无效或过大，请检查简历与照片。");
  if (!globalThis.crypto?.subtle) throw new Error("云端 PDF 导出需要 HTTPS 安全连接。");
  // Keep the exact source snapshot as the task input. Its stable key survives a
  // lost start response and makes repeated clicks refer to the same task.
  const request = { action: ENTRY, html, source: { resumeId, updatedAt } };
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(request)));
  const digest = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    entry: ENTRY,
    recovery: "retry",
    requestKey: `resume-pdf:${digest}`,
    input: { request, directoryArguments: [{ argumentName: "--job-dir", directory: "job" }] },
  };
}

export function resumePdfReceipt(job) {
  if (job?.entry?.name !== ENTRY || job.status !== "succeeded") return null;
  const source = job.input?.request?.source;
  const artifact = job.result?.artifacts?.find((item) => item.role === "pdf");
  if (!source?.resumeId || !artifact?.asset?.id || artifact.mimeType !== "application/pdf" ||
      !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) || artifact.asset.id !== artifact.assetId)
    throw new Error("PDF 任务没有完整的项目文件回执，请刷新任务记录。");
  return {
    resumeId: source.resumeId,
    path: "resume.pdf",
    assetId: artifact.asset.id,
    taskId: job.id,
    size: artifact.bytes,
    exportedAt: new Date(job.completedAt || job.createdAt).toISOString(),
    sourceUpdatedAt: source.updatedAt,
  };
}

export function createResumePdfTasks({ call, check = () => {} }) {
  const operations = new Map();
  const cache = new Map();
  const invoke = async (method, params) => {
    check();
    const result = await call(method, params);
    check();
    return result;
  };
  function own(job, prepared) {
    if (!job || job.entry?.name !== ENTRY || !job.input?.request?.source?.resumeId ||
        (prepared && JSON.stringify(job.input.request) !== JSON.stringify(prepared.input.request)))
      throw new Error("PDF 任务与当前简历导出请求不匹配。");
    return job;
  }
  async function get(id) {
    const job = own(await invoke("tasks.get", { id }));
    cache.set(id, job);
    return job;
  }
  return {
    get,
    submit(prepared) {
      if (prepared?.entry !== ENTRY || !/^resume-pdf:[a-f0-9]{64}$/.test(prepared.requestKey))
        return Promise.reject(new Error("PDF 导出请求无效。"));
      if (operations.has(prepared.requestKey)) return operations.get(prepared.requestKey);
      // Freeze again so caller edits during an awaited read cannot change the
      // admitted input while retaining a different snapshot's correlation key.
      const input = structuredClone(prepared);
      const operation = (async () => {
        const existing = await invoke("tasks.find", { requestKey: input.requestKey });
        if (existing) return own(existing, input);
        try { return own(await invoke("tasks.start", input), input); }
        catch (error) {
          check();
          // No automatic resubmission after an uncertain response. Finding null
          // may mean the Host is still preparing this exact request.
          const accepted = await invoke("tasks.find", { requestKey: input.requestKey }).catch(() => null);
          check();
          if (accepted) return own(accepted, input);
          throw error;
        }
      })();
      operations.set(input.requestKey, operation);
      void operation.finally(() => operations.delete(input.requestKey)).catch(() => {});
      return operation;
    },
    async list({ offset = 0, limit = 50 } = {}) {
      const page = await invoke("tasks.list", { offset, limit });
      if (!Array.isArray(page)) throw new Error("无法读取 PDF 任务历史。");
      const jobs = [];
      for (const summary of page) {
        if (summary.entry?.name !== ENTRY) continue;
        const saved = cache.get(summary.id);
        jobs.push(saved && saved.sequence === summary.sequence && saved.status === summary.status
          ? own({ ...saved, ...summary }) : await get(summary.id));
      }
      return { jobs, nextOffset: page.length === limit ? offset + limit : null };
    },
    async cancel(id) {
      const job = await get(id);
      if (terminal.has(job.status)) return job;
      await invoke("tasks.cancel", { id });
      return get(id);
    },
    async retry(id) {
      const job = await get(id);
      if (job.readOnly || job.error?.retryable === false) throw new Error("此历史任务不能重试，请检查后重新导出当前简历。");
      if (!["failed", "cancelled", "interrupted"].includes(job.status)) return job;
      // This method is only called for an explicit user retry, never on reload.
      await invoke("tasks.retry", { id });
      return get(id);
    },
    async open(id) {
      const receipt = resumePdfReceipt(await get(id));
      if (!receipt) throw new Error("PDF 尚未生成完成。");
      return invoke("resources.open", { assetId: receipt.assetId });
    },
  };
}
