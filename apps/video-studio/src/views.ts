import { formatTime, timelineClips, timelineDuration, type Project, type Asset } from "./model";
import { icon, html, escapeHtml as esc } from "./icons";
import { renderWorkflowSummary } from "./workflow";
import { renderNarrationPanel } from "./narration-ui";
import type { PanelTask } from "./host";
import type { EditorProposalReview } from "./editor/proposal";
import { renderProductionJobs, type ProductionViewState } from "./production-views";
import { version as panelVersion } from "../.codeshell-panel/panel.json";
import { demoSceneIndex } from "./demo";
import { isExternalMedia } from "./external-media";
import { visibleMedia, type MediaLibraryPreferences } from "./media-library-ui";

/** Data needed to render a view; no host calls, media controls or state mutations. */
export interface ViewState {
  readonly project: Readonly<Project>;
  readonly mediaItems: ReadonlyMap<
    string,
    {
      readonly thumbnail?: string;
      readonly element?: HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
    }
  >;
  readonly missingAssetCount: number;
  readonly selected: string;
  readonly frame: number;
  readonly tab: string;
  readonly libraryTab?: string;
  readonly unifiedWorkspace?: boolean;
  readonly zoom: number;
  readonly snapping?: boolean;
  readonly search: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The reviewed plan, computed on the editor document. */
  readonly proposal: Readonly<EditorProposalReview> | null;
  readonly task: Readonly<PanelTask> | null;
  readonly taskStarting: boolean;
  readonly playing: boolean;
  readonly mediaImporting: boolean;
  readonly saveText: string;
  readonly projectError: string;
  readonly aiPrompt: string;
  readonly aiMessage: string;
  readonly workspace: string;
  readonly connected: boolean;
  readonly persistentStorage?: boolean;
  readonly editorClipCount?: number;
  /** Clips on the main picture track of the active editor sequence. */
  readonly mainTrackClipCount?: number;
  /** Subtitles on every text track of the shown sequence. */
  readonly captionCount?: number;
  readonly voiceoverMarkup?: string;
  readonly folderMarkup?: string;
  readonly voicePreparationActive?: boolean;
  readonly voicePreparationMarkup?: string;
  readonly roughcutMarkup?: string;
  readonly selectedMedia?: ReadonlySet<string>;
  readonly mediaPreferences?: MediaLibraryPreferences;
  readonly sourcePreview?: {
    readonly id?: string;
    readonly kind?: Asset["kind"];
    readonly name: string;
    readonly frame: number;
    readonly duration: number;
    readonly available: boolean;
    readonly width: number;
    readonly height: number;
  };
  readonly recordingMarkup?: string;
  readonly spokenMarkup?: string;
  readonly narrationScriptDraft?: string | null;
  readonly narrationHasPicture?: boolean;
  readonly narrationApprovalIssue?: string | null;
  readonly production?: ProductionViewState;
  /** The active sequence's frame rate as people write it, e.g. 29.97. */
  readonly frameRateLabel?: string;
  /** What the frame-based inspector cannot do with the selected clip. */
  readonly inspectorIssue?: { readonly reason?: string; readonly volume?: string };
}

export const button = (action: string, text: string, glyph?: string, cls = "", disabled = false) =>
  `<button type="button" data-action="${action}" class="${cls}" ${disabled ? "disabled" : ""}>${glyph ? icon(glyph) : ""}<span>${text}</span></button>`;
export const tool = (action: string, title: string, glyph: string, disabled = false) =>
  `<button type="button" data-action="${action}" class="icon-button" title="${title}" aria-label="${title}" ${disabled ? "disabled" : ""}>${icon(glyph)}</button>`;
export const seconds = (value: number) => (value / 30).toFixed(2);

/** Quote a URL as CSS before escaping the surrounding HTML attribute. */
function cssUrl(value: string): string {
  const quoted = value.replace(
    /[\u0000-\u001f\u007f"\\]/g,
    (character) => `\\${character.charCodeAt(0).toString(16)} `,
  );
  return `url("${quoted}")`;
}

/** Each invocation captures the current read-only view state for one render pass. */
export function createViews(state: ViewState) {
  const {
    project,
    mediaItems,
    missingAssetCount,
    selected,
    frame,
    tab,
    zoom,
    search,
    canUndo,
    canRedo,
    proposal,
    task,
    taskStarting,
    playing,
    mediaImporting,
    saveText,
    projectError,
    aiPrompt,
    aiMessage,
    workspace,
    connected,
  } = state;
  const duration = () => timelineDuration(project);
  const source = state.sourcePreview;
  const previewWidth = source?.width ?? project.width;
  const previewHeight = source?.height ?? project.height;
  const persistent = Boolean(state.production?.status.persistent);
  const autoActive =
    state.production?.auto &&
    state.production.auto.projectId === project.id &&
    ["preparing", "agent", "waiting"].includes(state.production.auto.phase);
  const taskRunning = Boolean(task && ["running", "queued", "cancelling"].includes(task.status));
  const narrationBusy =
    Boolean(autoActive) ||
    taskStarting ||
    mediaImporting ||
    Boolean(task && ["running", "queued", "cancelling"].includes(task.status));

  function shell(): string {
    return html`<header class="topbar">
        <div class="brand">
          <span class="brand-mark">${icon("film", 21)}</span><strong>mimi<span>studio</span></strong
          ><span class="version">${panelVersion}</span>
        </div>
        <div class="project-breadcrumb">
          <span>${esc(workspace)}</span>${icon("chevron", 13)}<input
            id="project-name"
            aria-label="工程名称"
            value="${esc(project.name)}"
            maxlength="160"
          />
        </div>
        <div class="header-actions">
          <span class="save-indicator"
            ><i></i><span id="save-state" title="${esc(projectError)}">${saveText}</span></span
          >${state.persistentStorage ? tool("versions", "工程历史版本", "undo") : ""}${tool(
            "projects",
            "最近工程 / 打开工程",
            "folder",
          )}${tool("save-project", "下载工程 JSON", "download")}${button(
            "export",
            "导出视频",
            "upload",
            "primary",
            !(state.editorClipCount ?? project.clips.length),
          )}
        </div>
      </header>
      <main class="workspace ${source ? "source-mode" : tab === "voiceover" ? "voice-mode" : ""}">
        <nav class="rail" aria-label="工作台导航">
          ${[
            ["media", "素材", "folder"],
            ["roughcut", "粗剪", "cut"],
            ["recording", "录制", "film"],
            ["spoken", "口播", "text"],
            ["transcript", "字幕", "text"],
            ["voiceover", "配音", "volume"],
            ["ai", "AI 制作", "spark"],
            ["jobs", "任务", "film"],
          ]
            .map(
              ([id, label, glyph]) =>
                `<button data-tab="${id}" class="rail-item ${tab === id ? "active" : ""}" aria-pressed="${tab === id}">${icon(glyph!, 22)}<span>${label}</span></button>`,
            )
            .join("")}
          <div class="rail-bottom">
            ${tool("new", "新建工程", "plus")}<span>v${panelVersion}</span>
          </div>
        </nav>
        <aside class="library-panel">${renderLibrary()}</aside>
        <section class="viewer-panel" aria-label="${source ? "原素材预览" : "视频预览"}">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">${source ? "SOURCE" : "PREVIEW"}</span
              ><span>${source ? esc(source.name) : "画面预览"}</span>
            </div>
            <span class="muted"
              >${source ? "原片时间" : `${project.width} × ${project.height}`}
              <span class="dot">·</span> ${state.frameRateLabel ?? "30"} fps</span
            >
          </div>
          <div class="preview-stage">
            <div class="canvas-wrap" style="aspect-ratio:${previewWidth}/${previewHeight}">
              <canvas
                id="preview"
                width="${previewWidth}"
                height="${previewHeight}"
                aria-label="${source ? "原素材画面" : "当前剪辑画面"}"
              ></canvas>
              ${source?.kind === "audio" && source.available
                ? `<div class="source-audio-preview" data-source-audio>${icon("volume", 42)}<strong>${esc(source.name)}</strong><span>音频素材 · 点击播放试听</span></div>`
                : ""}
            </div>
            ${source
              ? !source.duration
                ? '<div class="empty-start">' +
                  button("import", "导入视频或音频", "plus", "primary") +
                  "</div>"
                : ""
              : !project.clips.length
                ? '<div class="empty-start">' +
                  button("import", "导入素材", "plus", "primary") +
                  button("demo", "试试示例工程", "play", "quiet") +
                  "</div>"
                : ""}
          </div>
          ${source && tab === "media" && source.kind !== "image"
            ? `<label class="source-preview-scrub">原片位置<input type="range" data-source-scrub aria-label="原素材播放位置" min="0" max="${Math.max(0, source.duration - 1)}" step="1" value="${source.frame}" aria-valuetext="${formatTime(source.frame)}"${source.available ? "" : " disabled"}></label>`
            : ""}
          <div class="transport">
            <span id="time-current" class="timecode">${formatTime(source?.frame ?? frame)}</span>
            <div>
              ${tool("start", "回到开头", "back", source?.kind === "image")}${tool(
                "play",
                "播放 / 暂停（空格）",
                playing ? "pause" : "play",
                source ? !source.available || source.kind === "image" : !project.clips.length,
              )}${tool("end", "跳到结尾", "next", source?.kind === "image")}
            </div>
            <span class="timecode muted">${formatTime(source?.duration ?? duration())}</span>
          </div>
          <div class="preview-footer">
            ${source
              ? `<div class="source-history">${tool("undo", "撤销上一步（⌘ Z）", "undo", !canUndo)}${tool("redo", "重做上一步（⌘ ⇧ Z）", "redo", !canRedo)}</div>`
              : ""}
            ${source
              ? `<span>${source.available ? (source.kind === "image" ? "图片预览" : tab === "roughcut" ? "原素材预览 · 标记保留范围后加入成片" : "原素材预览 · 点击其他素材继续浏览") : "原素材待重连 · 可继续整理已保存的标记"}</span>${tab === "media" && ["video", "audio"].includes(source.kind ?? "") ? button("trim-source", "粗剪这份素材", "cut", "quiet") : ""}${button("return-composition", "返回成片", "film", "quiet")}`
              : html` <span
                    >${missingAssetCount
                      ? '<i class="warning-dot"></i> ' + missingAssetCount + " 个素材待重连"
                      : '<i class="status-dot"></i> 素材保留在本机'}</span
                  ><label
                    >画布
                    <select id="aspect" aria-label="画布比例">
                      <option
                        value="1280x720"
                        ${project.width / project.height > 1.5 ? "selected" : ""}
                      >
                        16:9 横屏
                      </option>
                      <option value="720x1280" ${project.width < project.height ? "selected" : ""}>
                        9:16 竖屏
                      </option>
                      <option
                        value="1080x1080"
                        ${project.width === project.height ? "selected" : ""}
                      >
                        1:1 方形
                      </option>
                    </select></label
                  >`}
          </div>
        </section>
        <aside class="inspector">${renderInspector()}</aside>
        <section class="timeline-panel" aria-label="剪辑时间轴">${renderTimeline()}</section>
        <div class="studio-resize-library workspace-resizer" data-resize-pane="library" role="separator" tabindex="0" aria-label="调整素材面板宽度" aria-orientation="vertical" aria-valuemin="180" aria-valuemax="500" aria-valuenow="260"></div>
        <div class="studio-resize-inspector workspace-resizer" data-resize-pane="inspector" role="separator" tabindex="0" aria-label="调整属性面板宽度" aria-orientation="vertical" aria-valuemin="220" aria-valuemax="500" aria-valuenow="270"></div>
        <div class="studio-resize-timeline workspace-resizer" data-resize-pane="timeline" role="separator" tabindex="0" aria-label="调整多轨时间线高度" aria-orientation="horizontal" aria-valuemin="200" aria-valuemax="720" aria-valuenow="308"></div>
      </main>
      <footer class="statusbar">
        <span><i class="status-dot"></i> ${connected ? "CodeShell 已连接" : "本地编辑模式"}</span
        ><span
          ><span data-studio-clip-count>${state.editorClipCount ?? project.clips.length}</span>
          个片段 <span class="dot">·</span> <span data-studio-caption-count>${state.captionCount ?? project.captions.length}</span> 条字幕
          <span class="dot">·</span> <span id="revision">rev ${project.revision}</span></span
        ><span
          >${tab === "roughcut"
            ? "I 起点 · O 终点 · + 保留"
            : source
              ? "点击素材预览 · ← → 逐帧"
              : "空格 播放 · S 切分"} <span class="dot">·</span> ⌘ Z 撤销</span
        >
      </footer>
      <dialog id="export-dialog"></dialog>
      <dialog id="plan-dialog"></dialog>
      <dialog id="media-delete-dialog" aria-labelledby="media-delete-heading"></dialog>`;
  }

  function renderLibraryContent(): string {
    const libraryTab = state.libraryTab ?? tab;
    if (libraryTab === "roughcut") return state.roughcutMarkup ?? "";
    if (libraryTab === "recording") return state.recordingMarkup ?? "";
    if (libraryTab === "spoken") return state.spokenMarkup ?? "";
    if (libraryTab === "voiceover")
      return (
        (state.voicePreparationMarkup ?? "") +
        (state.voicePreparationActive
          ? `<details class="voiceover-alternative"><summary>其他文字配音 · 使用预置音色</summary>${state.voiceoverMarkup ?? ""}</details>`
          : (state.voiceoverMarkup ?? ""))
      );
    if (libraryTab === "jobs" && state.production) return renderProductionJobs(state.production);
    // The caption workbench is one persistent section that main mounts into this host.
    if (libraryTab === "transcript") return '<div id="caption-panel-host"></div>';
    if (libraryTab === "ai")
      return html`<div class="section-title">
          <h2>AI 自动制作</h2>
          <span class="tiny-badge">PRODUCTION</span>
        </div>
        <p class="section-description">
          导入拍好的素材，说说你想表达什么。<br />先看文案、剪辑和字幕草稿，确认后再录自己的口播。
        </p>
        <div class="production-flow" aria-label="自动制作流程">
          <span><b>01</b>目标与素材</span><span><b>02</b>选片与叙事</span
          ><span><b>03</b>粗剪与精修</span><span><b>04</b>原声 / 配音</span
          ><span><b>05</b>字幕与包装</span><span><b>06</b>验收与导出</span>
        </div>
        <label class="input-label" for="ai-prompt">想做怎样的视频？</label
        ><textarea
          id="ai-prompt"
          rows="5"
          placeholder="例如：这些是周末探店素材，做一条 60 秒竖屏分享。先帮我写文案、排镜头和临时字幕，我确认后再录口播。"
        >
${esc(aiPrompt)}</textarea
        >
        <div class="prompt-chips">
          <button
            data-prompt="整理这批素材，按内容选择叙事顺序，做成 60 秒竖屏短片。优先保留原声，补充字幕，检查后导出。"
          >
            一批素材成片
          </button>
          <button data-prompt="保留开头的重点，把序列精简到 15 秒。">精简到 15 秒</button
          ><button data-prompt="根据已有字幕润色口播，保持原意，不修改没有证据的内容。">
            润色字幕</button
          ><button data-prompt="根据已有字幕给出更清晰的叙事顺序，提交可审阅的剪辑操作。">
            整理叙事
          </button>
        </div>
        ${button(
          "ask-draft",
          "生成文案与视频草稿",
          "spark",
          "primary full",
          !persistent || narrationBusy,
        )}
        <p class="capability-note">先出可审阅的草稿。等你确认、录好口播，再用真实声音完成视频。</p>
        ${renderNarrationPanel(project, {
          busy: narrationBusy,
          persistent,
          scriptDraft: state.narrationScriptDraft,
          ...(state.narrationHasPicture === undefined
            ? {}
            : { hasPicture: state.narrationHasPicture }),
          approvalIssue: state.narrationApprovalIssue ?? null,
        })}
        ${button(
          "initialize-video",
          "初始化制作单",
          "check",
          "quiet full",
          !persistent ||
            Boolean(autoActive) ||
            taskStarting ||
            Boolean(task && ["running", "queued", "cancelling"].includes(task.status)),
        )}
        <p class="capability-note">
          检查环境、盘点素材并保存目标与制作步骤。若选择本人声音，会准备引擎、参考与短句试听；初始化保留当前剪辑。
        </p>
        ${state.voicePreparationMarkup ?? ""}
        ${connected && !persistent
          ? // Connected without persistent media storage: one request, a reviewable plan.
            button(
              "ask-ai",
              taskStarting
                ? "正在创建任务…"
                : taskRunning
                  ? "正在生成方案…"
                  : "生成剪辑方案",
              "spark",
              "quiet full",
              !(state.editorClipCount ?? project.clips.length) || taskStarting || taskRunning,
            )
          : button(
              "ask-ai",
              persistent && taskStarting
                ? "正在创建任务…"
                : persistent && (autoActive || taskRunning)
                  ? "正在自动制作…"
                  : project.workflow
                    ? "按制作单继续制作"
                    : "开始全流程制作",
              "spark",
              "quiet full",
              !persistent || Boolean(autoActive) || taskStarting || taskRunning,
            )}
        ${!persistent
          ? `<p class="host-required" role="status">${esc(state.production?.error || "请在 CodeShell 面板中打开，启用自动制作和后台 MP4。")}</p>`
          : ""}
        ${autoActive || (task && ["running", "queued", "cancelling"].includes(task.status))
          ? button("cancel-ai", "取消任务", "close", "quiet full")
          : ""}
        <p class="capability-note">
          ${connected
            ? persistent
              ? "真实关键帧与文稿分析；自动修改前保留历史版本。后台导出完成后可播放与保存。"
              : "使用 CodeShell 当前模型。只读取工程与已有字幕，不声称识别未分析的画面或声音。"
            : "浏览器可体验时间轴、字幕和规则草案；自动制作需要在 CodeShell 桌面面板中使用。"}
        </p>
        <div class="ai-task-status" role="status">
          ${esc(aiMessage || task?.activity?.at(-1)?.message || "")}
        </div>
        ${renderWorkflowSummary(project.workflow, project.assets)}
        <div class="local-plan">
          ${connected ? "" : '<span class="eyebrow">BROWSER DEMO</span>'}
          <h3>先试一版 15 秒粗剪</h3>
          <p>按现有顺序保留前 15 秒，生成草案供你审阅。</p>
          ${button(
            "quick-plan",
            "创建规则草案",
            "cut",
            "full",
            !(state.mainTrackClipCount ?? project.clips.length),
          )}<span
            class="muted small"
            >本地规则 · 无需模型</span
          >
        </div>
        ${persistent
          ? button(
              "make-scene",
              "单独生成场景",
              "spark",
              "quiet full",
              state.production?.status.runtimeChecked !== false &&
                !state.production?.status.hyperframes.available,
            ) + button("versions", "查看历史版本", "undo", "quiet full")
          : ""}
        ${button("voiceover", "文字配音", "volume", "quiet full")}
        ${button("paste-plan", "导入剪辑方案 JSON", "text", "quiet full")}`;
    const preferences = state.mediaPreferences ?? {
      view: "large",
      filter: "all",
      sort: "original",
    };
    const assets = visibleMedia(project.assets, search, preferences);
    const filteringMedia = Boolean(search.trim()) || preferences.filter !== "all";
    const selectedAssets = project.assets.filter((asset) => state.selectedMedia?.has(asset.id));
    const roughCutSelected = selectedAssets.filter((asset) =>
      ["video", "audio"].includes(asset.kind),
    );
    return html`<div class="section-title">
        <h2>项目素材</h2>
        <span class="count-badge">${project.assets.length}</span>
      </div>
      <div class="library-actions">
        ${button(
          "import",
          mediaImporting ? "正在导入…" : "导入素材",
          "plus",
          "primary full",
          mediaImporting,
        )}
      </div>
      ${state.folderMarkup ?? ""} ${button("voiceover", "文字配音", "volume", "full")}
      <label class="search-field"
        >${icon("search", 15)}<input
          id="asset-search"
          value="${esc(search)}"
          placeholder="搜索素材"
          aria-label="搜索素材"
      /></label>
      ${persistent
        ? button(
            "make-scene",
            "生成章节 / 解释场景",
            "spark",
            "quiet full",
            state.production?.status.runtimeChecked !== false &&
              !state.production?.status.hyperframes.available,
          )
        : ""}
      <div class="media-library-toolbar">
        <div class="media-view-switch" role="group" aria-label="素材视图">
          ${(
            [
              ["large", "大图"],
              ["small", "小图"],
              ["list", "列表"],
            ] as const
          )
            .map(
              ([id, label]) =>
                `<button type="button" data-action="media-view" data-id="${id}" aria-pressed="${preferences.view === id}">${label}</button>`,
            )
            .join("")}
        </div>
        <label
          >类型<select data-media-filter aria-label="素材类型">
            ${(
              [
                ["all", "全部"],
                ["video", "视频"],
                ["audio", "音频"],
                ["image", "图片"],
                ["demo", "示例"],
              ] as const
            )
              .map(
                ([value, label]) =>
                  `<option value="${value}"${preferences.filter === value ? " selected" : ""}>${label}</option>`,
              )
              .join("")}
          </select></label
        >
        <label
          >排序<select data-media-sort aria-label="素材排序">
            ${(
              [
                ["original", "导入顺序"],
                ["name", "名称"],
                ["duration", "时长 · 长到短"],
              ] as const
            )
              .map(
                ([value, label]) =>
                  `<option value="${value}"${preferences.sort === value ? " selected" : ""}>${label}</option>`,
              )
              .join("")}
          </select></label
        >
      </div>
      <div class="library-label">
        <span>点击预览 · 右键管理</span
        ><span
          >${assets.length}
          份${selectedAssets.length ? ` · 已选 ${selectedAssets.length}` : ""}</span
        >
      </div>
      ${project.assets.length
        ? `<div class="media-selection-bar"><div>${button("select-media", search || preferences.filter !== "all" ? "全选当前结果" : "全选", undefined, "quiet", !assets.length)}${button("clear-media-selection", "清空选择", undefined, "quiet", !selectedAssets.length)}</div><div>${button("batch-roughcut", `批量粗剪${roughCutSelected.length ? `（${roughCutSelected.length}）` : ""}`, "cut", "quiet", !roughCutSelected.length)}${button("delete-media", "删除所选", "trash", "quiet danger", !selectedAssets.length)}</div></div>`
        : ""}
      <div class="asset-list" data-view="${preferences.view}">
        ${assets
          .map((asset) => {
            const demoIndex = demoSceneIndex(asset);
            const item = mediaItems.get(asset.id);
            const missing =
              asset.kind !== "demo" &&
              (!item || (item.element && "error" in item.element && !!item.element.error));
            return html`<article
              class="asset-card ${state.selectedMedia?.has(asset.id) ? "is-selected" : ""} ${missing
                ? "missing"
                : ""} ${source?.id === asset.id ? "is-previewing" : ""}"
              draggable="true"
              data-asset="${esc(asset.id)}"
              data-preview-asset="${esc(asset.id)}"
              tabindex="0"
              aria-label="素材 ${esc(asset.name)}"
            >
              <button
                type="button"
                aria-label="预览 ${esc(asset.name)}"
                class="asset-thumbnail ${asset.kind === "demo"
                  ? "demo-thumb demo-" + demoIndex
                  : ""}"
              >
                ${item?.thumbnail
                  ? `<img src="${item.thumbnail}" alt="${esc(asset.name)}" />`
                  : asset.kind === "demo"
                    ? '<span class="demo-thumb-kicker">MIMI ORIGINAL</span><strong>' +
                      [
                        "从想法，<br>到成片。",
                        "让每一帧，<br>恰到好处。",
                        "你的故事，<br>现在开始。",
                      ][demoIndex] +
                      "</strong>"
                    : icon(
                        missing
                          ? "link"
                          : asset.kind === "audio"
                            ? "volume"
                            : asset.kind === "image"
                              ? "image"
                              : "film",
                        30,
                      )}<span class="asset-duration">${seconds(asset.durationFrames)}s</span
                >${asset.kind === "demo" ? '<span class="demo-label">示例</span>' : ""}
              </button>
              <label class="asset-select"
                ><input
                  type="checkbox"
                  data-select-media="${esc(asset.id)}"
                  aria-label="选择 ${esc(asset.name)}"
                  ${state.selectedMedia?.has(asset.id) ? " checked" : ""}
                /><span>选择</span></label
              >
              <div class="asset-info">
                <div>
                  <button
                    type="button"
                    class="asset-preview-name"
                    title="${esc(asset.sourcePath || asset.name)}"
                    aria-label="预览 ${esc(asset.name)}"
                  >
                    <strong title="${esc(asset.sourcePath || asset.name)}"
                      >${esc(asset.name)}</strong
                    ></button
                  ><span
                    >${missing
                      ? "素材待重连"
                      : asset.kind === "demo"
                        ? "示例画面"
                        : `${isExternalMedia(asset.mediaId) ? "引用 · " : ""}${asset.kind.toUpperCase()}`}
                    ${asset.width ? " · " + asset.width + "×" + asset.height : ""}</span
                  >
                </div>
                ${missing || isExternalMedia(asset.mediaId)
                  ? `<button type="button" class="quiet" data-action="reconnect-media" data-id="${esc(asset.id)}">重新连接原文件</button>`
                  : ""}
                ${["video", "audio"].includes(asset.kind)
                  ? `<button type="button" class="quiet" data-rough-source="${esc(asset.id)}" title="预览原片并标记保留范围" aria-label="粗剪 ${esc(asset.name)}">粗剪</button>`
                  : ""}
                <button
                  type="button"
                  class="icon-button asset-more"
                  data-action="media-menu"
                  data-id="${esc(asset.id)}"
                  title="更多素材操作"
                  aria-label="更多 ${esc(asset.name)}"
                  aria-haspopup="menu"
                >
                  ${icon("more", 16)}
                </button>
                <button
                  class="icon-button"
                  data-add-asset="${esc(asset.id)}"
                  title="添加到时间轴"
                  aria-label="添加 ${esc(asset.name)} 到时间轴"
                >
                  ${icon("plus", 16)}
                </button>
              </div>
            </article>`;
          })
          .join("") ||
        `<div class="empty-state">${icon("folder", 32)}<h3>${filteringMedia ? "没有匹配的素材" : "你的素材，故事的起点"}</h3><p>${filteringMedia ? "试试其他类型或搜索词。" : "导入视频、音频或图片。<br>也可以将文件拖到这里。"}</p>${filteringMedia ? button("clear-media-filter", "清除筛选", undefined, "quiet") : button("demo", "打开示例工程", "play", "quiet")}</div>`}
      </div>
      <div class="library-note">
        ${icon("link", 14)}<span
          >${connected
            ? "素材信息随工程保存。引用素材需要保留原片；删除素材仅从当前工程移除。"
            : "导入素材保存在此浏览器，重新打开自动恢复；清除网站数据会移除本地副本。"}</span
        >
      </div>`;
  }

  function renderLibrary(): string {
    if (tab === "media" || !state.unifiedWorkspace) return renderLibraryContent();
    const label = (
      {
        roughcut: "粗剪",
        recording: "录制",
        spoken: "口播",
        transcript: "字幕",
        voiceover: "配音",
        ai: "AI 制作",
        jobs: "任务",
      } as Record<string, string>
    )[tab] ?? "工具";
    const assets = state.libraryTab === "media";
    return `<div class="library-view-switch" role="group" aria-label="左侧面板"><button type="button" data-library-view="assets" aria-pressed="${assets}">素材</button><button type="button" data-library-view="feature" aria-pressed="${!assets}">${esc(label)}</button></div>${renderLibraryContent()}`;
  }

  function renderInspector(): string {
    const audioClip = project.audioClips?.find((item) => item.id === selected);
    const clip = project.clips.find((item) => item.id === selected) ?? audioClip;
    const asset = project.assets.find((item) => item.id === clip?.assetId);
    const freeClip =
      !audioClip && project.timelineMode === "free"
        ? timelineClips(project).find((item) => item.id === selected)
        : undefined;
    const clipIssue = clip ? undefined : state.inspectorIssue?.reason;
    const volumeIssue = clip ? state.inspectorIssue?.volume : undefined;
    return html`<div class="section-title">
        <h2>片段属性</h2>
        <span class="muted">${clip || clipIssue ? "已选中" : "未选择"}</span>
      </div>
      ${audioClip
        ? `<div class="property-section"><label class="input-label">音轨在时间轴的位置（秒）<input id="audio-start" type="number" step="0.033333" min="0" value="${seconds(audioClip.startFrame)}" /></label></div>`
        : ""}
      ${freeClip
        ? `<div class="property-section"><label class="input-label">画面在时间轴的位置（秒）<input id="video-start" type="number" step="0.033333" min="0" max="86400" value="${seconds(freeClip.startFrame)}" /></label><p class="small muted">可自由拖动并保留空隙；空隙显示黑场，音乐与配音继续播放。</p></div>`
        : ""}
      ${clip && asset
        ? `<div class="selected-title">${icon(asset.kind === "audio" ? "volume" : "film", 18)}<strong>${esc(asset.name)}</strong></div><div class="property-section"><label class="input-label">源素材裁剪 <span>秒</span></label><div class="range-inputs"><label>入点<input id="trim-in" type="number" min="0" step="0.033333" value="${seconds(clip.inFrame)}" /></label><label>出点<input id="trim-out" type="number" min="0.033333" step="0.033333" max="${seconds(asset.durationFrames)}" value="${seconds(clip.outFrame)}" /></label></div>${button("trim", "应用裁剪", "cut", "full")}<div class="property-line"><span>片段时长</span><strong>${seconds(clip.outFrame - clip.inFrame)} s</strong></div><div class="property-line"><span>源素材时长</span><span>${seconds(asset.durationFrames)} s</span></div></div><div class="property-section"><label class="input-label" for="clip-volume">${audioClip ? "音轨音量" : "原声音量"} <span>${Math.round(clip.volume * 100)}%</span></label><div class="volume-slider">${icon("volume", 16)}<input id="clip-volume" type="range" min="0" max="200" value="${Math.round(clip.volume * 100)}"${volumeIssue ? ` disabled aria-describedby="clip-volume-issue"` : ""} /></div>${volumeIssue ? `<p class="small muted" id="clip-volume-issue" data-volume-issue>这个片段${esc(volumeIssue)}，请在属性面板中调整音量。</p>` : `<p class="small muted">${audioClip ? "独立调整这条音轨，不改变画面；可在时间轴拖动定位或裁剪。" : "画面与原声同步裁剪、同步移动。"}</p>`}</div><div class="reorder-actions">${button("move-left", freeClip ? "前移 1 秒" : "前移", "back", "", audioClip ? audioClip.startFrame === 0 : freeClip ? freeClip.startFrame === 0 : project.clips[0]?.id === selected)}${button("move-right", freeClip ? "后移 1 秒" : "后移", "next", "", audioClip ? audioClip.startFrame + audioClip.outFrame - audioClip.inFrame >= duration() : freeClip ? freeClip.endFrame >= 86400 * project.fps : project.clips.at(-1)?.id === selected)}</div>`
        : clipIssue
          ? `<div class="empty-inspector" data-inspector-issue role="status">${icon("film", 30)}<p>这个片段${esc(clipIssue)}，无法在这里调整。<br>点左侧“素材”，在属性面板中修改。</p></div>`
          : '<div class="empty-inspector">' +
            icon("film", 30) +
            "<p>选择时间轴上的片段<br>调整时长与音量</p></div>"}
      ${asset?.speech
        ? `<div class="property-section"><label class="input-label">配音文案</label><p class="speech-script">${esc(asset.speech.text)}</p><p class="small muted">${esc(asset.speech.voiceId)} · ${asset.speech.rate}×</p>${button("edit-voiceover", "修改文案 / 重新配音", "volume", "full")}</div>`
        : ""}
      <div id="proposal-panel">${renderProposal()}</div>`;
  }

  function renderProposal(): string {
    if (!proposal)
      return html`<div class="assistant-card">
        <span class="assistant-icon">${icon("spark", 22)}</span
        ><span class="eyebrow">A LITTLE HELP</span>
        <h3>从一个目标，<br />到一条成片。</h3>
        <p>分析素材、剪辑与场景制作，<br />在同一份工程里继续完成。</p>
        ${button("show-ai", "打开 AI 制作", "chevron", "quiet full")}
      </div>`;
    const { stale, after } = proposal;
    const changedTracks = proposal.tracks.filter(
      (track) => track.after !== null && track.after !== track.before,
    );
    return html`<div class="proposal-card">
      <div class="proposal-heading">
        ${icon("spark", 18)}<strong>待审阅的方案</strong
        ><span class="count-badge">${proposal.labels.length}</span>
      </div>
      <h3>${esc(proposal.title)}</h3>
      <p>${esc(proposal.explanation)}</p>
      <div class="proposal-duration">
        <span>${proposal.before.toFixed(2)}s</span>${icon("chevron", 14)}<strong
          >${stale || after === null ? "需重新生成" : after.toFixed(2) + "s"}</strong
        >
      </div>
      ${changedTracks.length
        ? `<ul class="proposal-tracks" aria-label="各轨道片段数">${changedTracks
            .map(
              (track) =>
                `<li><span>${esc(track.name)}</span> <span>${track.before} → ${track.after}</span></li>`,
            )
            .join("")}</ul>`
        : ""}
      <ol>
        ${proposal.labels
          .slice(0, 8)
          .map((label) => `<li>${esc(label)}</li>`)
          .join("")}${proposal.labels.length > 8
          ? `<li>另有 ${proposal.labels.length - 8} 项修改</li>`
          : ""}
      </ol>
      ${stale
        ? '<p class="conflict">工程已修改，这份方案已过期。请重新生成，避免覆盖手动剪辑。</p>'
        : ""}${button("apply-plan", "应用方案", "check", "primary full", stale)}${button(
        "dismiss-plan",
        "放弃方案",
        undefined,
        "quiet full",
      )}
    </div>`;
  }

  function renderTimeline(): string {
    const clips = timelineClips(project);
    const width = Math.max(
      650,
      (duration() / 30) * zoom + (project.timelineMode === "free" ? 650 : 120),
    );
    const audio = project.audioClips?.find((clip) => clip.id === selected);
    const splitTarget =
      audio ?? clips.find((clip) => frame > clip.startFrame && frame < clip.endFrame);
    const canSplit =
      splitTarget &&
      frame > splitTarget.startFrame &&
      frame < splitTarget.startFrame + splitTarget.outFrame - splitTarget.inFrame;
    return html`<div class="timeline-toolbar">
        <div class="timeline-tools">
          ${tool("undo", "撤销（⌘ Z）", "undo", !canUndo)}${tool(
            "redo",
            "重做（⌘ ⇧ Z）",
            "redo",
            !canRedo,
          )}<span class="separator"></span>${tool(
            "split",
            audio ? "切分选中音轨（S）" : "在播放头切分（S）",
            "cut",
            !canSplit,
          )}${tool("remove", "删除选中片段", "trash", !selected)}<span class="separator"></span
          ><span class="sequence-title">主序列</span>
          <button
            type="button"
            class="snap-toggle"
            data-action="toggle-magnetic"
            aria-pressed="${project.timelineMode !== "free"}"
            title="${project.timelineMode === "free"
              ? "开启磁吸排列，消除画面间空隙（可撤销）"
              : "关闭磁吸排列，允许自由拖动和留空"}（M）"
          >
            ${icon("film", 14)}<span
              >${project.timelineMode === "free" ? "自由排列" : "磁吸排列"}</span
            >
          </button>
          <button
            type="button"
            class="snap-toggle"
            data-action="toggle-snapping"
            aria-pressed="${state.snapping !== false}"
            title="边缘对齐吸附（N）；按住 Alt 临时关闭"
          >
            ${icon("link", 14)}<span>边缘吸附</span>
          </button>
        </div>
        <div class="zoom-control">
          ${tool("zoom-out", "缩小时间轴（−）", "minus")}
          <input
            id="timeline-zoom"
            aria-label="时间轴缩放"
            type="range"
            min="0.01"
            max="240"
            step="any"
            value="${zoom}"
          />
          ${tool("zoom-in", "放大时间轴（+）", "plus")}
          ${button("fit-timeline", "一屏看全", "fit", "timeline-fit", !clips.length)}
          ${tool("timeline-shortcuts", "剪辑快捷键（?）", "keyboard")}
        </div>
      </div>
      <div class="timeline-body">
        <div class="track-labels">
          <div class="ruler-label">时间轴</div>
          <div>${icon("film", 17)}<span>画面 / 原声</span></div>
          <div>${icon("volume", 17)}<span>音乐 / 配音</span></div>
        </div>
        <div class="timeline-scroll" id="timeline-scroll">
          <div class="timeline-content" style="width:${width}px">
            <div class="ruler" id="ruler"></div>
            <div class="video-track" id="video-track">
              ${clips
                .map((clip, index) => {
                  const asset = project.assets.find((item) => item.id === clip.assetId)!;
                  const item = mediaItems.get(asset.id);
                  return html`<div
                    tabindex="0"
                    role="button"
                    aria-label="片段 ${esc(asset.name)}"
                    aria-pressed="${selected === clip.id}"
                    class="timeline-clip clip-color-${index % 3} ${selected === clip.id
                      ? "selected"
                      : ""}"
                    draggable="${project.timelineMode !== "free"}"
                    data-clip="${esc(clip.id)}"
                    style="left:${(clip.startFrame / 30) * zoom}px;width:${((clip.endFrame -
                      clip.startFrame) /
                      30) *
                    zoom}px"
                  >
                    <div class="clip-title">
                      ${icon(asset.kind === "audio" ? "volume" : "film", 12)}<span
                        >${esc(asset.name)}</span
                      >
                    </div>
                    <div
                      class="clip-fill ${item?.thumbnail ? "has-thumbnail" : ""}"
                      ${item?.thumbnail
                        ? `style="--clip-thumbnail:${esc(cssUrl(item.thumbnail))}"`
                        : ""}
                    >
                      ${item?.thumbnail
                        ? `<img src="${esc(item.thumbnail)}" alt="" draggable="false"/>`
                        : `<span>${asset.kind === "demo" ? "MIMI" : asset.kind.toUpperCase()}</span>`.repeat(
                            12,
                          )}
                    </div>
                    <div class="clip-audio">
                      ${icon("volume", 10)}<span
                        >${Math.round(clip.volume * 100)}% ·
                        ${seconds(clip.outFrame - clip.inFrame)}s</span
                      >
                    </div>
                    <div class="trim-handle left" data-trim="in" title="拖动裁剪入点"></div>
                    <div class="trim-handle right" data-trim="out" title="拖动裁剪出点"></div>
                  </div>`;
                })
                .join("")}${!clips.length
                ? '<div class="timeline-empty">将素材拖到这里，或点击素材上的 ＋</div>'
                : ""}
            </div>
            <div class="audio-track">
              ${(project.audioClips ?? [])
                .map(
                  (clip) =>
                    `<button aria-label="音轨 ${esc(project.assets.find((a) => a.id === clip.assetId)?.name ?? "音轨")}" aria-pressed="${selected === clip.id}" class="timeline-audio ${selected === clip.id ? "selected" : ""}" data-audio-clip="${esc(clip.id)}" style="left:${(clip.startFrame / 30) * zoom}px;width:${((clip.outFrame - clip.inFrame) / 30) * zoom}px">${icon("volume", 12)}<span>${esc(project.assets.find((a) => a.id === clip.assetId)?.name ?? "音轨")} · ${Math.round(clip.volume * 100)}%</span><span class="trim-handle left" data-trim="in" title="拖动裁剪音轨入点"></span><span class="trim-handle right" data-trim="out" title="拖动裁剪音轨出点"></span></button>`,
                )
                .join("")}
            </div>
            <div class="playhead" id="playhead" style="left:${(frame / 30) * zoom}px">
              <span></span>
            </div>
          </div>
        </div>
      </div>
      <div class="timeline-hint">
        <span
          >${project.timelineMode === "free"
            ? "拖动画面自由定位 · 允许留空 · 同轨片段不能重叠"
            : "拖动画面排序 · 关闭磁吸排列可自由定位"}
          · Alt 暂停边缘吸附</span
        ><span>总时长 ${seconds(duration())} 秒</span>
      </div>`;
  }

  return { shell, renderLibrary, renderInspector, renderProposal, renderTimeline };
}
