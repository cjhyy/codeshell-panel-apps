import { escapeHtml as esc, html } from "./icons";
import { button, tool } from "./views";
import { listProjectVersions, readProjectVersion, type ProjectVersion } from "./host";
import {
  captionSourceAssetIds,
  transcriptCaptions,
  mediaUrl,
  type ProductionController,
} from "./production";
import { type Project, validateProject, type Caption } from "./model";
interface ProductionUIContext {
  project(): Project;
  commit(project: Project): void;
  replace(project: unknown): Promise<void>;
  versions?(): Promise<ProjectVersion[]>;
  readVersion?(revision: number): Promise<unknown>;
  restoreMedia(): Promise<void>;
  toast(message: string): void;
  render(): void;
}
export function createProductionUI(production: ProductionController, context: ProductionUIContext) {
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector)!;
  function sceneDialog(): void {
    const dialog = $<HTMLDialogElement>("#plan-dialog");
    dialog.innerHTML = html`<div class="dialog-heading">
        <div>
          <span class="eyebrow">CREATE A SCENE</span>
          <h2>给故事一个章节。</h2>
        </div>
        ${tool("close-dialog", "关闭", "close")}
      </div>
      <p class="section-description">生成可编辑的 HyperFrames 源码，并在后台制作成 MP4 素材。</p>
      <label class="input-label"
        >场景类型<select id="scene-kind">
          <option value="chapter">章节卡</option>
          <option value="explainer">解释场景</option>
        </select></label
      ><label class="input-label"
        >标题<input id="scene-title" maxlength="120" placeholder="从想法，到成片。" /></label
      ><label class="input-label"
        >副标题<input
          id="scene-subtitle"
          maxlength="240"
          placeholder="一个好故事，从这里开始。" /></label
      ><label class="input-label"
        >要点（解释场景，每行一条，最多 4 条）<textarea
          id="scene-points"
          rows="4"
        ></textarea></label
      ><label class="input-label"
        >时长（秒）<input id="scene-duration" type="number" min="0.5" max="60" step="0.1" value="4"
      /></label>
      <div class="dialog-actions">${button("create-scene", "生成场景", "spark", "primary")}</div>`;
    dialog.showModal();
  }
  async function versionsDialog(): Promise<void> {
    const versions = await (context.versions?.() ?? listProjectVersions());
    const dialog = $<HTMLDialogElement>("#plan-dialog");
    dialog.innerHTML = html`<div class="dialog-heading">
        <h2>工程历史版本</h2>
        ${tool("close-dialog", "关闭", "close")}
      </div>
      <p class="section-description">
        保留最近 20 次持久保存。恢复会创建新版本，当前工程不会被静默覆盖。
      </p>
      <div class="recent-projects">
        ${versions
          .map(
            (v) =>
              `<button class="full recent-project" data-version="${v.revision}"><span>${esc(v.label)}</span><small>${new Date(v.updatedAt).toLocaleString()} · #${v.revision}</small></button>`,
          )
          .join("") || '<p class="muted">还没有历史版本。</p>'}
      </div>`;
    dialog.querySelectorAll<HTMLElement>("[data-version]").forEach((b) =>
      b.addEventListener("click", () => {
        const original = context.project();
        void (
          context.readVersion?.(Number(b.dataset.version)) ??
          readProjectVersion(Number(b.dataset.version))
        )
          .then(async (value) => {
            if (context.project() !== original)
              throw new Error("读取期间工程已变化，请重新选择版本");
            if (context.readVersion) await context.replace(value);
            else if (validateProject(value).id === original.id) {
              context.commit(
                validateProject({ ...validateProject(value), revision: original.revision + 1 }),
              );
              await context.restoreMedia();
            } else await context.replace(value);
            context.toast("已恢复历史版本");
          })
          .catch((error) => context.toast(String(error)));
      }),
    );
    dialog.showModal();
  }
  async function captionsFromTranscript(): Promise<void> {
    if (production.enabled === false)
      throw new Error("当前无法读取真实转写，请在桌面视频工作台使用，或导入 SRT 字幕");
    const original = context.project();
    const sourceIds = captionSourceAssetIds(original, production.preparations);
    if (!sourceIds.length)
      throw new Error("请先把已保存且有声音的素材加入画面或独立音轨，并开启音量");
    const captions: Caption[] = [];
    let missing = 0;
    for (const id of sourceIds) {
      let offset = 0,
        total = 1;
      while (offset < total) {
        let result;
        try {
          result = await production.transcript(id, offset, 100);
        } catch (error) {
          if (offset === 0 && /ENOENT|not found|文稿.*不存在|转写.*不存在/i.test(String(error))) {
            missing++;
            break;
          }
          throw error;
        }
        if (
          !Number.isSafeInteger(result.total) ||
          result.total < 0 ||
          result.total > 100000 ||
          result.offset !== offset ||
          !Array.isArray(result.segments) ||
          result.segments.length > 100 ||
          offset + result.segments.length > result.total ||
          (offset > 0 && result.total !== total) ||
          (!result.segments.length && offset < result.total)
        )
          throw new Error("文稿分页不完整或已变化，请重新读取后生成字幕");
        total = result.total;
        if (!total) {
          missing++;
          break;
        }
        captions.push(...transcriptCaptions(original, id, result.segments));
        offset += result.segments.length;
      }
    }
    if (context.project() !== original) throw new Error("读取文稿期间工程已变化，请重新生成字幕");
    const existingById = new Map(original.captions.map((caption) => [caption.id, caption]));
    const existingIds = new Set(existingById.keys());
    const updated = new Map<string, Caption>();
    const captionKey = (caption: Caption) =>
      JSON.stringify([caption.startFrame, caption.endFrame, caption.text]);
    const exists = new Set(original.captions.map(captionKey));
    const added = captions.filter((caption) => {
      const key = captionKey(caption);
      const existing = existingById.get(caption.id);
      if (existing) {
        if (existing.startFrame !== caption.startFrame || existing.endFrame !== caption.endFrame)
          updated.set(caption.id, {
            ...existing,
            startFrame: caption.startFrame,
            endFrame: caption.endFrame,
          });
        return false;
      }
      if (existingIds.has(caption.id) || exists.has(key)) return false;
      existingIds.add(caption.id);
      exists.add(key);
      return true;
    });
    if (!added.length && !updated.size && captions.length) {
      context.toast(
        `当前剪辑的文稿字幕已存在，保留已校对的文字${missing ? `；${missing} 个素材尚无文稿` : ""}`,
      );
      return;
    }
    if (!added.length && !updated.size)
      throw new Error("没有新的文稿字幕。请先完成语音转写，并确认素材已加入时间轴。");
    context.commit(
      validateProject({
        ...original,
        revision: original.revision + 1,
        captions: [
          ...original.captions.map((caption) => updated.get(caption.id) ?? caption),
          ...added,
        ],
      }),
    );
    context.toast(
      `已按当前剪辑生成 ${added.length} 条字幕${updated.size ? `，更新 ${updated.size} 条时间` : ""}${missing ? `；${missing} 个素材尚无文稿，未生成其字幕` : ""}`,
    );
  }
  async function handleJobAction(action: string, id: string, assetId?: string): Promise<void> {
    if (action === "cancel") await production.cancel(id);
    else if (action === "retry") await production.retry(id);
    else if (assetId && action === "save") await production.exportAsset(assetId);
    else if (assetId && action === "reveal") await production.revealAsset(assetId);
    else if (assetId && action === "play") {
      const audio = ["tts", "tts-online", "tts-managed", "tts-clone", "audio-enhance"].includes(
        production.jobs.find((job) => job.id === id)?.type ?? "",
      );
      const dialog = $<HTMLDialogElement>("#plan-dialog");
      dialog.innerHTML = html`<div class="dialog-heading">
          <h2>制作结果</h2>
          ${tool("close-dialog", "关闭", "close")}
        </div>
        ${audio
          ? `<audio class="result-audio" src="${mediaUrl(assetId)}" controls autoplay></audio>`
          : `<video class="result-video" src="${mediaUrl(assetId)}" controls autoplay playsinline></video>`}
        <div class="dialog-actions">
          <button
            data-job-action="save"
            data-job-id="${esc(id)}"
            data-asset-id="${esc(assetId)}"
            class="primary"
          >
            ${audio ? "保存音频" : "保存 MP4"}
          </button>
        </div>`;
      dialog.showModal();
      return;
    }
    context.render();
  }
  return { sceneDialog, versionsDialog, captionsFromTranscript, handleJobAction };
}
