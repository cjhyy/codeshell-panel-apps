import type { Project } from "./model";
import { escapeHtml as esc, html, icon } from "./icons";

interface NarrationPanelOptions {
  busy: boolean;
  persistent: boolean;
  scriptDraft?: string | null;
  /** The editor sequence has picture to confirm (the 30 fps view may not show real footage). */
  hasPicture?: boolean;
}

function action(name: string, label: string, disabled: boolean, primary = false): string {
  return `<button type="button" data-action="${name}" class="${primary ? "primary" : "quiet"} full" ${disabled ? "disabled" : ""}>${icon(primary ? "check" : "volume")}<span>${esc(label)}</span></button>`;
}

/** Update editing affordances without replacing the textarea or disturbing its caret. */
export function syncNarrationDraftUI(
  project: Readonly<Project>,
  draft: string | null,
  busy = false,
  hasPicture = project.clips.length > 0,
): void {
  const panel = document.querySelector<HTMLElement>(".narration-panel");
  if (!panel || !project.narration) return;
  const text = draft ?? project.script ?? "";
  const changed = text !== (project.script ?? "");
  const locked = busy || changed;
  const hasRecording = project.assets.some(
    (asset) => (asset.kind === "audio" || asset.kind === "video") && !asset.speech,
  );
  const disable = (name: string, value: boolean) => {
    const button = panel.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
    if (button) button.disabled = value;
  };
  disable("save-narration-script", busy || !changed || !text.trim());
  disable("approve-draft", locked || !text.trim() || !hasPicture);
  disable("record-narration", locked);
  disable("bind-narration-recording", locked || !hasRecording);
  disable("align-narration", locked || panel.dataset.persistent !== "true");
  const script = panel.querySelector<HTMLTextAreaElement>("#narration-script");
  if (script) script.disabled = busy;
  const assets = panel.querySelector<HTMLSelectElement>("#narration-recording-asset");
  if (assets) assets.disabled = locked || !hasRecording;
  const note = panel.querySelector<HTMLElement>("[data-narration-draft-note]");
  if (note) note.hidden = !changed;
}

/** Presentation only: the caller owns drafts, approval, recording, and asynchronous work. */
export function renderNarrationPanel(
  project: Readonly<Project>,
  options: NarrationPanelOptions,
): string {
  const state = project.narration;
  if (!state) return "";
  const phases = ["draft", "review", "approved", "recorded", "aligned"];
  const step = phases.indexOf(state.phase);
  const text = options.scriptDraft ?? project.script ?? "";
  const changed = text !== (project.script ?? "");
  const locked = options.busy || changed;
  const hasPicture = options.hasPicture ?? project.clips.length > 0;
  const recordings = project.assets.filter(
    (asset) => (asset.kind === "audio" || asset.kind === "video") && !asset.speech,
  );
  const description = {
    draft: "先看文案和画面搭配。草稿完成后，再决定怎样用自己的声音讲。",
    review: "播放草稿，检查文案、镜头顺序和临时字幕。满意后确认，再开始口播。",
    approved: "草稿已确认。可以照稿录制，也可以选用已经录好的声音或视频。",
    recorded: "本人录音已保存。接下来按真实口播安排声音、调整画面长度并重排字幕。",
    aligned: "本人录音已进入成片。试听声音与字幕的配合，满意后即可导出。",
  }[state.phase];
  return html`<section
    class="narration-panel"
    aria-label="本人口播制作"
    data-persistent="${options.persistent}"
  >
    <div class="narration-heading"><h3>先看草稿，再用自己的声音讲</h3></div>
    <ol class="narration-steps" aria-label="本人口播制作阶段">
      ${["写稿粗剪", "审阅确认", "本人录音", "声音对齐", "字幕成片"]
        .map(
          (label, index) =>
            `<li class="${index === step ? "is-current" : index < step ? "is-complete" : ""}" ${index === step ? 'aria-current="step"' : ""}><span>${index + 1}</span>${label}</li>`,
        )
        .join("")}
    </ol>
    <p class="narration-description">${esc(description)}</p>
    <p
      class="narration-caption-basis ${state.captionBasis === "draft" ? "is-draft" : "is-recorded"}"
    >
      ${
        state.captionBasis === "draft"
          ? "临时字幕按文案估算时间，仅供草稿预览；录音完成后，按实际口播重新对齐。"
          : "正式字幕来自本人录音的真实转写，已按保留的声音片段对齐。"
      }
    </p>
    <label class="input-label" for="narration-script">口播文案</label>
    <textarea
      id="narration-script"
      rows="6"
      maxlength="10000"
      placeholder="草稿文案会保存在这里，也可以自己调整。"
      ${options.busy ? "disabled" : ""}
    >
${esc(text)}</textarea>
    ${action("save-narration-script", "保存文案", options.busy || !changed || !text.trim())}
    <p class="narration-edit-note" data-narration-draft-note ${changed ? "" : "hidden"}>
      文案尚未保存。保存后重新确认草稿，再继续录制或对齐。
    </p>
    <div class="narration-actions">
      ${
        state.phase === "review"
          ? action(
              "approve-draft",
              "确认草稿，去录口播",
              locked || !text.trim() || !hasPicture,
              true,
            )
          : ""
      }
      ${
        ["approved", "recorded", "aligned"].includes(state.phase)
          ? action("record-narration", "照稿录制", locked, state.phase === "approved")
          : ""
      }
      ${
        ["approved", "recorded", "aligned"].includes(state.phase)
          ? `<div class="narration-recording-choice"><label class="input-label" for="narration-recording-asset">或使用已录好的口播</label><select id="narration-recording-asset" ${locked || !recordings.length ? "disabled" : ""}><option value="" ${state.recordingAssetId ? "" : "selected"}>选择本人录音或视频</option>${recordings.map((asset) => `<option value="${esc(asset.id)}" ${asset.id === state.recordingAssetId ? "selected" : ""}>${esc(asset.name)}</option>`).join("")}</select>${action("bind-narration-recording", "使用这份口播", locked || !recordings.length)}<p class="narration-edit-note">可先在素材页导入录音。这里选择的是你本人录下的内容。</p></div>`
          : ""
      }
      ${
        state.phase === "recorded"
          ? action("align-narration", "用我的录音完成视频", locked || !options.persistent, true)
          : ""
      }
      ${
        state.phase === "recorded" && !options.persistent
          ? '<p class="host-required">自动转写、声音对齐与成片收尾，需要在桌面工作台中继续。</p>'
          : ""
      }
    </div>
  </section>`;
}
