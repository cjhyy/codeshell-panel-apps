import { escapeHtml as esc, icon } from "./icons";
import type { Project } from "./model";

/** A menu owns one timeline segment in one version of one open project. */
export interface TimelineMenuTarget {
  readonly projectId: string;
  readonly revision: number;
  readonly generation: number;
  readonly kind: "video" | "audio";
  readonly clipId: string;
  readonly assetId: string;
}

export function captureTimelineMenuTarget(
  project: Project,
  clipId: string,
  generation: number,
): TimelineMenuTarget | undefined {
  const video = project.clips.find((clip) => clip.id === clipId);
  const audio = project.audioClips?.find((clip) => clip.id === clipId);
  const clip = video ?? audio;
  if (!clip || (video && audio)) return;
  return Object.freeze({
    projectId: project.id,
    revision: project.revision,
    generation,
    kind: video ? "video" : "audio",
    clipId: clip.id,
    assetId: clip.assetId,
  });
}

export function isTimelineMenuTargetCurrent(
  target: TimelineMenuTarget,
  project: Project,
  generation: number,
): boolean {
  const current = captureTimelineMenuTarget(project, target.clipId, generation);
  return (
    !!current &&
    current.projectId === target.projectId &&
    current.revision === target.revision &&
    current.generation === target.generation &&
    current.kind === target.kind &&
    current.clipId === target.clipId &&
    current.assetId === target.assetId
  );
}

/** Deletion is delegated to the existing editor; this menu never touches source media. */
export function createTimelineContextMenu(context: {
  project(): Project;
  generation(): number;
  canRemove?(target: TimelineMenuTarget): boolean;
  remove(target: TimelineMenuTarget): void;
  restoreFocus(target: TimelineMenuTarget): void;
  stale?(): void;
}) {
  let menu: HTMLElement | undefined;
  let target: TimelineMenuTarget | undefined;
  const lifetime = new AbortController();
  const current = (value: TimelineMenuTarget) =>
    isTimelineMenuTargetCurrent(value, context.project(), context.generation());

  function close(restoreFocus = false): void {
    const previous = target;
    menu?.remove();
    menu = undefined;
    target = undefined;
    if (restoreFocus && previous && current(previous)) context.restoreFocus(previous);
  }

  function reconcile(): void {
    if (!menu || !target) return;
    if (!current(target)) {
      close();
      return;
    }
    const button = menu.querySelector<HTMLButtonElement>('[data-timeline-menu-action="remove"]');
    if (button) button.disabled = context.canRemove?.(target) === false;
  }

  function open(clipId: string, x: number, y: number): void {
    close();
    const ownTarget = captureTimelineMenuTarget(context.project(), clipId, context.generation());
    if (!ownTarget) return;
    target = ownTarget;
    menu = document.createElement("div");
    menu.id = "timeline-context-menu";
    menu.className = "timeline-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", ownTarget.kind === "audio" ? "音频片段操作" : "画面片段操作");
    menu.setAttribute("aria-describedby", "timeline-context-menu-note");
    const name = context.project().assets.find((asset) => asset.id === ownTarget.assetId)?.name;
    menu.innerHTML = `<div class="timeline-context-menu-title">${esc(name ?? "时间轴片段")}</div>
      <button type="button" role="menuitem" class="danger" data-timeline-menu-action="remove"${context.canRemove?.(ownTarget) === false ? " disabled" : ""}>${icon("trash", 16)}<span>从时间轴删除</span></button>
      <button type="button" role="menuitem" data-timeline-menu-action="cancel">${icon("close", 16)}<span>取消</span></button>
      <p id="timeline-context-menu-note">素材库与原文件保留，可撤销</p>`;
    menu.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-timeline-menu-action]",
      );
      if (!button || button.disabled) return;
      if (button.dataset.timelineMenuAction === "cancel") {
        close(true);
        return;
      }
      // The captured identity is checked again even if the caller forgot to reconcile its render.
      const valid = current(ownTarget);
      const allowed = valid && context.canRemove?.(ownTarget) !== false;
      close();
      if (!valid) context.stale?.();
      else if (allowed) context.remove(ownTarget);
    });
    menu.addEventListener("contextmenu", (event) => event.preventDefault());
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (menu && !menu.contains(event.target as Node)) close();
    },
    { capture: true, signal: lifetime.signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (!menu) return;
      // All timeline shortcuts pause while the menu has focus, including Delete and undo.
      event.stopPropagation();
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        close(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
    },
    { capture: true, signal: lifetime.signal },
  );
  // Programmatic scroll from a timeline rerender may arrive after open(); only user scroll closes.
  for (const name of ["wheel", "touchmove"] as const)
    document.addEventListener(
      name,
      (event) => {
        if (menu && !menu.contains(event.target as Node)) close();
      },
      { capture: true, passive: true, signal: lifetime.signal },
    );
  window.addEventListener("resize", () => close(), { signal: lifetime.signal });
  window.addEventListener("blur", () => close(), { signal: lifetime.signal });

  return {
    open,
    close,
    reconcile,
    get active() {
      return !!menu;
    },
    destroy() {
      close();
      lifetime.abort();
    },
  };
}
