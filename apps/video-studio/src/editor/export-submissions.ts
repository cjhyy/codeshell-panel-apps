import { randomId } from "../ids.js";
import type { SessionIdentity } from "./session";

export interface ExportSubmission {
  accepted: true;
  operationId: string;
  identity: SessionIdentity;
  sequenceId: string;
  profileId: string;
  requestId?: string;
  status: "preparing" | "submitted" | "cancelling" | "cancelled" | "failed";
  jobId?: string;
  error?: string;
}

/** Panel-owned preparation receipts. Only jobId denotes a durable native render task. */
export function createExportSubmissions() {
  const entries = new Map<
    string,
    {
      key: string;
      fingerprint: string;
      receipt: ExportSubmission;
      abort: AbortController;
      cancelJob?: (jobId: string) => Promise<unknown>;
    }
  >();
  const active = (status: ExportSubmission["status"]) =>
    status === "preparing" || status === "cancelling";
  return {
    list() {
      return structuredClone([...entries.values()].map((entry) => entry.receipt));
    },
    accept(
      request: Omit<ExportSubmission, "accepted" | "operationId" | "status" | "jobId" | "error">,
      start: (signal: AbortSignal) => Promise<{ jobId: string }>,
      cancelJob?: (jobId: string) => Promise<unknown>,
    ): ExportSubmission {
      const fingerprint = JSON.stringify([
        request.identity.documentId,
        request.identity.generation,
        request.identity.revision,
        request.sequenceId,
        request.profileId,
      ]);
      const key = request.requestId
        ? JSON.stringify([
            request.identity.documentId,
            request.identity.generation,
            request.requestId,
          ])
        : fingerprint;
      const previous = [...entries.values()].find((entry) => entry.key === key);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error("导出 requestId 已用于另一个版本或预设，请重新规划");
        return structuredClone(previous.receipt);
      }
      if ([...entries.values()].filter((entry) => active(entry.receipt.status)).length >= 8)
        throw new Error("已有 8 个导出正在准备，请等待或取消后再提交");
      while (entries.size >= 64) {
        const oldest = [...entries].find(([, entry]) => !active(entry.receipt.status));
        if (!oldest) break;
        entries.delete(oldest[0]);
      }
      const receipt: ExportSubmission = {
        ...structuredClone(request),
        accepted: true,
        operationId: `export-${randomId()}`,
        status: "preparing",
      };
      const entry = { key, fingerprint, receipt, abort: new AbortController(), cancelJob };
      entries.set(receipt.operationId, entry);
      // Own the promise in the panel, never keep the Host tool call open for media staging.
      void Promise.resolve()
        .then(async () => {
          if (entry.abort.signal.aborted) throw new DOMException("已取消导出准备", "AbortError");
          const result = await start(entry.abort.signal);
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(result.jobId))
            throw new Error("导出任务回执无效");
          receipt.jobId = result.jobId;
          if (entry.abort.signal.aborted) {
            if (!cancelJob) throw new Error("导出已提交，请在任务列表中取消");
            await cancelJob(result.jobId);
            receipt.status = "cancelled";
          } else receipt.status = "submitted";
        })
        .catch((error: unknown) => {
          // Never hide a real job if cancellation or transport failed after submission.
          receipt.status = entry.abort.signal.aborted && !receipt.jobId ? "cancelled" : "failed";
          receipt.error = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
        });
      return structuredClone(receipt);
    },
    cancel(operationId: string, identity: SessionIdentity): ExportSubmission {
      const entry = entries.get(operationId);
      if (
        !entry ||
        entry.receipt.identity.documentId !== identity.documentId ||
        entry.receipt.identity.generation !== identity.generation
      )
        throw new Error("这不是当前工程会话的导出回执");
      const receipt = entry.receipt;
      if (receipt.status === "cancelled" || receipt.status === "cancelling")
        return structuredClone(receipt);
      if (receipt.jobId) {
        if (!entry.cancelJob) throw new Error("请在后台任务列表中取消此导出");
        receipt.status = "cancelling";
        void entry
          .cancelJob(receipt.jobId)
          .then(() => {
            receipt.status = "cancelled";
            delete receipt.error;
          })
          .catch((error: unknown) => {
            receipt.status = "failed";
            receipt.error = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
          });
      } else if (receipt.status === "preparing") {
        receipt.status = "cancelling";
        entry.abort.abort();
      }
      return structuredClone(receipt);
    },
  };
}
