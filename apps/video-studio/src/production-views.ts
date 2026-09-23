import { html, escapeHtml as esc, icon } from "./icons";
import { button } from "./views";
import type { ExportJobSummary } from "./editor/jobs-ui";
import {
  transcriptionSetupMessage,
  type MediaJob,
  type AutoProduction,
  type ProductionStatus,
  type PreparedMedia,
} from "./production";
export interface ProductionViewState {
  connected?: boolean;
  status: ProductionStatus;
  jobs: MediaJob[];
  auto: AutoProduction | null;
  error: string;
  preparations: ReadonlyMap<string, PreparedMedia>;
  /** Video exports from the export record (Host editor tasks), newest first. */
  exports?: readonly ExportJobSummary[];
}
function renderExportJobs(exports: readonly ExportJobSummary[], statuses: Record<string, string>) {
  if (!exports.length) return "";
  return `<div class="section-title export-jobs-title"><h3>视频导出</h3><span class="count-badge">${exports.length}</span></div><div class="job-list export-job-list">${exports
    .slice(0, 30)
    .map((job) => {
      const progress =
        job.fraction === undefined ? undefined : Math.round(Math.max(0, Math.min(1, job.fraction)) * 100);
      return `<article class="job-card ${esc(job.status)}" data-export-job-id="${esc(job.id)}"><div class="job-heading"><strong>${esc(job.title)}</strong><span>${statuses[job.status] ?? ""}</span></div><p>${esc(job.message)}</p>${["queued", "running"].includes(job.status) ? (progress === undefined ? `<progress max="100"></progress>` : `<progress max="100" value="${progress}"></progress>`) : ""}<div class="job-footer">${progress === undefined ? "<span></span>" : `<span>${progress}%</span>`}<button type="button" class="text-button" data-action="open-export-jobs" data-id="${esc(job.id)}">在导出记录中查看</button></div></article>`;
    })
    .join("")}</div>`;
}
export function renderProductionJobs(state: ProductionViewState): string {
  const labels: Record<string, string> = {
    import: "导入素材",
    prepare: "预处理素材",
    transcribe: "语音转写",
    scene: "生成场景",
    render: "导出 MP4",
    tts: "文字配音",
    "tts-online": "在线配音",
    "tts-managed": "模型配音",
    "tts-clone": "本人声音配音",
    "tts-setup": "安装配音引擎",
    "audio-enhance": "优化原声",
  };
  const statuses: Record<string, string> = {
    queued: "排队中",
    running: "进行中",
    succeeded: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  const exports = state.exports ?? [];
  return html`<div class="section-title">
      <h2>制作任务</h2>
      <span class="count-badge">${state.jobs.length + exports.length}</span>
    </div>
    <p class="section-description">
      ${state.status.persistent
        ? "关闭面板后，已排队任务仍会继续。重新打开可恢复进度与结果。"
        : state.connected
          ? "制作工具尚未连接，已保存的素材与工程仍可恢复。"
          : "浏览器模式：素材保存在此浏览器，后台制作需要 CodeShell 桌面。"}
    </p>
    <div class="capability-grid">
      <span class="${state.status.tts?.available ? "ready" : "unavailable"}"
        >配音 ${state.status.tts?.available ? "已就绪" : "未就绪"}</span
      >
      <span class="${state.status.ffmpeg.available ? "ready" : "unavailable"}"
        >MP4 ${state.status.ffmpeg.available ? "已就绪" : "未就绪"}</span
      ><span class="${state.status.transcription.available ? "ready" : "unavailable"}"
        >转写 ${state.status.transcription.available ? "已就绪" : "未就绪"}</span
      ><span class="${state.status.hyperframes.available ? "ready" : "unavailable"}"
        >场景 ${state.status.hyperframes.available ? "已就绪" : "未就绪"}</span
      >${state.status.persistent && !state.status.transcription.available
        ? `${state.status.runtimeChecked === false ? "" : `<p class="capability-note">${esc(transcriptionSetupMessage(state.status.transcription.reason))}</p>`}<button type="button" class="text-button" data-action="recheck-transcription">重新检测</button>`
        : ""}
    </div>
    ${state.error ? `<p class="conflict">${esc(state.error)}</p>` : ""}${state.auto
      ? `<div class="production-goal"><span class="eyebrow">AUTOMATIC PRODUCTION</span><strong>${esc(state.auto.prompt)}</strong><p>${esc(state.auto.message ?? "")}</p></div>`
      : ""}
    ${renderExportJobs(exports, statuses)}
    <div class="job-list">
      ${state.jobs
        .slice(0, 30)
        .map((job) => {
          const result = job.result as
            | { video?: { asset?: { id: string } }; asset?: { id: string } }
            | undefined;
          const artifact =
            result?.video?.asset ??
            (["tts", "tts-online", "tts-managed", "tts-clone", "audio-enhance"].includes(job.type)
              ? result?.asset
              : undefined);
          const progress = Math.round(Math.max(0, Math.min(1, job.progress?.fraction ?? 0)) * 100);
          return `<article class="job-card ${job.status}"><div class="job-heading"><strong>${labels[job.type] ?? esc(job.type)}</strong><span>${statuses[job.status]}</span></div><p>${esc(job.error?.message ?? job.progress?.message ?? "")}</p>${["queued", "running"].includes(job.status) ? `<progress max="100" value="${progress}"></progress><div class="job-footer"><span>${progress}%</span><button class="text-button" data-job-action="cancel" data-job-id="${esc(job.id)}">取消</button></div>` : ""}${job.status === "failed" && job.error?.retryable ? `<button class="full" data-job-action="retry" data-job-id="${esc(job.id)}">重试任务</button>` : ""}${artifact ? `<div class="job-result"><button data-job-action="play" data-job-id="${esc(job.id)}" data-asset-id="${esc(artifact.id)}">${icon("play")}播放</button><button class="primary" data-job-action="save" data-job-id="${esc(job.id)}" data-asset-id="${esc(artifact.id)}">${icon("download")}保存${["tts", "tts-online", "tts-managed", "tts-clone", "audio-enhance"].includes(job.type) ? "音频" : " MP4"}</button></div>` : ""}</article>`;
        })
        .join("") ||
      (exports.length
        ? ""
        : `<div class="empty-state">${icon("film", 32)}<h3>从素材，走向成片</h3><p>导入、分析、场景与导出的进度都在这里。</p>${button("import", "导入素材", "plus", "primary")}</div>`)}
    </div>`;
}
