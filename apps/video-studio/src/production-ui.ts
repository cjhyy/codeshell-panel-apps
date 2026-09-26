import { escapeHtml as esc, html } from "./icons";
import { userFacingError } from "./editor/legacy-reasons";
import { button, tool } from "./views";
import { listProjectVersions, readProjectVersion, type ProjectVersion } from "./host";
import { mediaUrl, type ProductionController } from "./production";
import { type Project, validateProject } from "./model";
import type { EditorUpgradeBackup } from "./editor/host-storage";
interface ProductionUIContext {
  project(): Project;
  commit(project: Project): void;
  replace(project: unknown): Promise<void>;
  versions?(): Promise<ProjectVersion[]>;
  readVersion?(revision: number): Promise<unknown>;
  upgradeBackups?(): Promise<EditorUpgradeBackup[]>;
  readUpgradeBackup?(digest: string): Promise<unknown>;
  exportUpgradeBackup?(value: unknown, name: string): void;
  restoreMedia(): Promise<void>;
  toast(message: string): void;
  render(): void;
}
export function createProductionUI(production: ProductionController, context: ProductionUIContext) {
  let versionRequest = 0;
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector)!;
  function sceneDialog(): void {
    const dialog = $<HTMLDialogElement>("#plan-dialog");
    dialog.innerHTML = html`<div class="dialog-heading">
        <div>
          <span class="eyebrow">制作场景</span>
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
    const request = ++versionRequest;
    const original = context.project();
    const versions = await (context.versions?.() ?? listProjectVersions());
    let backups: EditorUpgradeBackup[] = [],
      backupError = "";
    try {
      backups = (await context.upgradeBackups?.()) ?? [];
    } catch (error) {
      backupError = userFacingError(error);
    }
    if (request !== versionRequest || context.project() !== original)
      throw new Error("读取期间工程已变化，请重新打开历史版本");
    const dialog = $<HTMLDialogElement>("#plan-dialog");
    dialog.innerHTML = html`<div class="dialog-heading">
        <h2>工程历史版本</h2>
        ${tool("close-dialog", "关闭", "close")}
      </div>
      <p class="section-description">
        保留最近 20 次持久保存。恢复会创建新版本，当前工程不会被静默覆盖。
      </p>
      <div class="recent-projects">
        ${
          versions
            .map(
              (v) =>
                `<button class="full recent-project" data-version="${v.revision}"><span>${esc(v.label)}</span><small>${new Date(v.updatedAt).toLocaleString()} · #${v.revision}</small></button>`,
            )
            .join("") || '<p class="muted">还没有历史版本。</p>'
        }
      </div>
      ${
        context.upgradeBackups
          ? html`<h3>升级前原始工程</h3>
              <p class="section-description">
                升级备份独立保留。恢复会先保存当前工程，再将备份转换为当前编辑格式；导出保留原格式，供旧版应用重新打开。媒体文件需另行保留。
              </p>
              ${
                backupError
                  ? `<p role="alert">${esc(backupError)}</p>`
                  : backups
                      .map(
                        (backup) => `<div class="upgrade-backup"><span>${esc(backup.name)}</span>
            <small>${new Date(backup.createdAt).toLocaleString()} · 原工程 #${backup.revision}</small>
            <div class="dialog-actions">
            <button data-upgrade-restore="${backup.digest}">恢复为当前工程</button>
            ${context.exportUpgradeBackup ? `<button data-upgrade-export="${backup.digest}">导出原格式</button>` : ""}</div></div>`,
                      )
                      .join("") || '<p class="muted">没有可查找的升级前备份。</p>'
              }`
          : ""
      }`;
    const heading = dialog.querySelector("h2")!;
    dialog.addEventListener(
      "close",
      () => {
        if (request === versionRequest) versionRequest += 1;
      },
      { once: true },
    );
    let busy = false;
    const run = (work: () => Promise<void>) => {
      if (busy) return;
      busy = true;
      dialog
        .querySelectorAll<HTMLButtonElement>(
          "[data-version], [data-upgrade-restore], [data-upgrade-export]",
        )
        .forEach((button) => {
          button.disabled = true;
        });
      void work()
        .catch((error) => context.toast(userFacingError(error)))
        .finally(() => {
          busy = false;
          if (request !== versionRequest || !dialog.contains(heading)) return;
          dialog
            .querySelectorAll<HTMLButtonElement>(
              "[data-version], [data-upgrade-restore], [data-upgrade-export]",
            )
            .forEach((button) => {
              button.disabled = false;
            });
        });
    };
    const assertCurrent = () => {
      if (
        request !== versionRequest ||
        context.project() !== original ||
        !dialog.open ||
        !dialog.contains(heading)
      )
        throw new Error("工程或历史窗口已变化，请重新选择版本");
    };
    dialog.querySelectorAll<HTMLElement>("[data-version]").forEach((b) =>
      b.addEventListener("click", () => {
        run(async () => {
          assertCurrent();
          const value = await (context.readVersion?.(Number(b.dataset.version)) ??
            readProjectVersion(Number(b.dataset.version)));
          assertCurrent();
          if (context.readVersion) await context.replace(value);
          else if (validateProject(value).id === original.id) {
            context.commit(
              validateProject({ ...validateProject(value), revision: original.revision + 1 }),
            );
            await context.restoreMedia();
          } else await context.replace(value);
          context.toast("已恢复历史版本");
        });
      }),
    );
    dialog
      .querySelectorAll<HTMLElement>("[data-upgrade-restore], [data-upgrade-export]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          run(async () => {
            assertCurrent();
            const digest = button.dataset.upgradeRestore ?? button.dataset.upgradeExport;
            const backup = backups.find((entry) => entry.digest === digest);
            if (!backup || !context.readUpgradeBackup)
              throw new Error("备份入口不可用，请重新打开历史版本");
            const value = await context.readUpgradeBackup(backup.digest);
            assertCurrent();
            if (button.dataset.upgradeExport) {
              if (!context.exportUpgradeBackup) throw new Error("导出入口不可用");
              context.exportUpgradeBackup(value, backup.name);
              context.toast("已导出升级前原格式工程，请同时保留原媒体文件");
            } else {
              await context.replace(value);
              context.toast("已从升级前备份恢复工程");
            }
          }),
        ),
      );
    if (!dialog.open) dialog.showModal();
  }
  async function handleJobAction(action: string, id: string, assetId?: string): Promise<void> {
    if (action === "cancel") await production.cancel(id);
    else if (action === "retry") await production.retry(id);
    else if (assetId && action === "save") await production.exportAsset(assetId);
    else if (assetId && action === "reveal") await production.revealAsset(assetId);
    else if (assetId && action === "play") {
      if (production.delivery.save === "preview") {
        await production.exportAsset(assetId);
        return;
      }
      const audio = ["tts", "tts-online", "tts-managed", "tts-clone", "audio-enhance"].includes(
        production.jobs.find((job) => job.id === id)?.type ?? "",
      );
      const dialog = $<HTMLDialogElement>("#plan-dialog");
      dialog.innerHTML = html`<div class="dialog-heading">
          <h2>制作结果</h2>
          ${tool("close-dialog", "关闭", "close")}
        </div>
        ${
          audio
            ? `<audio class="result-audio" src="${mediaUrl(assetId)}" controls autoplay></audio>`
            : `<video class="result-video" src="${mediaUrl(assetId)}" controls autoplay playsinline></video>`
        }
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
  return { sceneDialog, versionsDialog, handleJobAction };
}
