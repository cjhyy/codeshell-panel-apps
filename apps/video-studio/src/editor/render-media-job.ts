import type { MediaJob } from "../production";
import { taskValue } from "../sdk/panel-runtime";

export function isCanonicalRenderTask(value: unknown): boolean {
  const job = value as any,
    request = job?.input?.request ?? job?.input?.input?.request;
  return job?.entry?.name === "editor-runtime" && request?.action === "render";
}
/** Presents one authentic v2 render receipt through the legacy job reader, never starts a v1 render. */
export function canonicalRenderMediaJob(value: unknown): MediaJob {
  const job = taskValue(value),
    request = (job.input as any)?.request ?? (job.input as any)?.input?.request;
  if (
    !isCanonicalRenderTask(job) ||
    !/^[a-f0-9]{64}$/.test(request.documentHash ?? "") ||
    typeof request.sequenceId !== "string" ||
    !request.sequenceId ||
    request.sequenceId.length > 128
  )
    throw new Error("这不是有效的新版工程导出任务");
  const raw = job.result?.result ?? job.result;
  let result = raw;
  if (job.status === "succeeded") {
    const video = raw?.video;
    if (
      raw?.verified !== true ||
      !video ||
      !/^asset-[a-f0-9]{64}$/.test(video.id ?? "") ||
      video.sha256 !== video.id.slice(6) ||
      !Number.isSafeInteger(video.bytes) ||
      video.bytes < 1 ||
      !["video/mp4", "video/webm", "video/quicktime"].includes(video.mimeType) ||
      !Number.isSafeInteger(raw.frameCount) ||
      raw.frameCount < 1 ||
      !Number.isFinite(raw.durationSeconds) ||
      raw.durationSeconds <= 0 ||
      raw.durationSeconds > 86401 ||
      (raw.preparedAudio &&
        (raw.preparedAudio.documentHash !== request.documentHash ||
          raw.preparedAudio.sequenceId !== request.sequenceId))
    )
      throw new Error("导出任务没有返回已核验的实际成片，请查看原任务结果");
    const asset = {
      ...structuredClone(video),
      name:
        typeof video.name === "string" && video.name
          ? video.name
          : `导出成片.${video.mimeType === "video/webm" ? "webm" : video.mimeType === "video/quicktime" ? "mov" : "mp4"}`,
      createdAt: job.completedAt ?? job.updatedAt,
    };
    result = { ...structuredClone(raw), video: { ...structuredClone(video), asset } };
  }
  return {
    ...structuredClone(job),
    type: "render",
    ...(result === undefined ? {} : { result: structuredClone(result) }),
  };
}
