import type { Project } from "./model";

/** Fixed templates only. No user text or CSS is interpolated into this control. */
export function renderCaptionControls(project: Project): string {
  const selected = project.captionStyle ?? "classic";
  return `<label for="caption-style">字幕样式</label><select id="caption-style" aria-label="字幕样式">${[
    ["classic", "经典 · 黑底白字"],
    ["bold", "醒目 · 黄字描边"],
    ["minimal", "简洁 · 白字无框"],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`,
    )
    .join("")}</select>`;
}
