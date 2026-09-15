import {
  formatTime,
  timelineClips,
  timelineDuration,
  type EditOperation,
  type Project,
} from "./model";
import { snapFrame } from "./timeline-controls";

interface TimelineGestureHost {
  project(): Project;
  zoom(): number;
  frame(): number;
  snapping(): boolean;
  assertEditable(): void;
  stop(): void;
  select(id: string): void;
  edit(operations: EditOperation[], revision: number): void;
  fail(error: unknown): void;
  render(): void;
}

/** A drag previews geometry only; release commits one revision-checked undo step. */
export function createTimelineGestures(studio: HTMLElement, host: TimelineGestureHost) {
  let cancelActive: (() => void) | undefined;
  let gestureProject: Project | undefined;
  let renderPending = false;
  let suppressClick = false;
  let suppressionTimer = 0;

  function pointerdown(event: PointerEvent): boolean {
    const target = event.target as HTMLElement;
    const matchedElement = target.closest<HTMLElement>("[data-audio-clip],[data-clip]");
    const handle = target.closest<HTMLElement>("[data-trim]");
    if (
      !matchedElement ||
      (!matchedElement.dataset.audioClip && !handle && host.project().timelineMode !== "free") ||
      event.button !== 0
    )
      return false;
    const element = matchedElement;
    event.preventDefault();
    try {
      host.assertEditable();
    } catch (error) {
      host.fail(error);
      return true;
    }
    cancelActive?.();
    host.stop();
    const project = host.project();
    const isAudio = Boolean(element.dataset.audioClip);
    const freeVideo = !isAudio && project.timelineMode === "free";
    const id = element.dataset.audioClip ?? element.dataset.clip!;
    const matchedClip = isAudio
      ? project.audioClips?.find((item) => item.id === id)
      : timelineClips(project).find((item) => item.id === id);
    if (!matchedClip) return true;
    const clip = matchedClip;
    gestureProject = project;
    const asset = project.assets.find((item) => item.id === clip.assetId)!;
    const zoom = host.zoom();
    const length = clip.outFrame - clip.inFrame;
    const start = clip.startFrame;
    const end = start + length;
    const edge = handle?.dataset.trim;
    const originalStyle = element.getAttribute("style");
    const wasSelected = element.classList.contains("selected");
    const scroll = studio.querySelector<HTMLElement>("#timeline-scroll")!;
    const initialScroll = scroll.scrollLeft;
    const content = element.closest<HTMLElement>(".timeline-content")!;
    const contentWidth = content.style.width;
    const neighbours = timelineClips(project).filter((item) => item.id !== id);
    const previousEnd = Math.max(
      0,
      ...neighbours.filter((item) => item.endFrame <= start).map((item) => item.endFrame),
    );
    const nextStart = Math.min(
      86400 * project.fps,
      ...neighbours.filter((item) => item.startFrame >= end).map((item) => item.startFrame),
    );
    const candidates = [
      0,
      timelineDuration(project),
      host.frame(),
      ...timelineClips(project)
        .filter((item) => item.id !== id)
        .flatMap((item) => [item.startFrame, item.endFrame]),
      ...(project.audioClips ?? [])
        .filter((item) => item.id !== id)
        .flatMap((item) => [item.startFrame, item.startFrame + item.outFrame - item.inFrame]),
      ...project.captions.flatMap((item) => [item.startFrame, item.endFrame]),
    ];
    const guide = document.createElement("div");
    guide.className = "timeline-drag-guide";
    const label = document.createElement("span");
    guide.append(label);
    guide.hidden = true;
    element.closest(".timeline-content")!.append(guide);
    let operations: EditOperation[] = [];
    let moved = false;
    let invalid = false;
    let lastPointer: PointerEvent | undefined;
    let scrolling = 0;

    function autoScroll() {
      scrolling = 0;
      if (!lastPointer || !moved) return;
      scrolling = -1;
      const bounds = scroll.getBoundingClientRect();
      const delta =
        lastPointer.clientX < bounds.left + 32
          ? -12
          : lastPointer.clientX > bounds.right - 32
            ? 12
            : 0;
      if (delta) {
        if (
          delta > 0 &&
          freeVideo &&
          !edge &&
          scroll.scrollLeft + scroll.clientWidth >= content.offsetWidth - 24
        )
          content.style.width = `${Math.min(86400 * zoom + 120, content.offsetWidth + 120)}px`;
        const before = scroll.scrollLeft;
        scroll.scrollLeft += delta;
        if (before !== scroll.scrollLeft) move(lastPointer);
      }
      scrolling = requestAnimationFrame(autoScroll);
    }

    function move(next: PointerEvent) {
      if (next.pointerId !== event.pointerId) return;
      lastPointer = next;
      const pixels = next.clientX - event.clientX + scroll.scrollLeft - initialScroll;
      if (!moved && Math.abs(pixels) < 3) return;
      moved = true;
      if (!scrolling) scrolling = requestAnimationFrame(autoScroll);
      const delta = Math.round((pixels / zoom) * project.fps);
      const enabled = host.snapping() && !next.altKey;
      const snap = (value: number, minFrame: number, maxFrame: number, points = candidates) =>
        snapFrame(value, {
          candidates: points,
          fps: project.fps,
          pixelsPerSecond: zoom,
          minFrame,
          maxFrame,
          enabled,
        });
      let left = start;
      let right = end;
      let point: number;
      if (edge === "in") {
        const cut = snap(
          start + delta,
          freeVideo
            ? Math.max(previousEnd, start - clip.inFrame)
            : isAudio
              ? Math.max(0, start - clip.inFrame)
              : start - clip.inFrame,
          end - 1,
        );
        const inFrame = clip.inFrame + cut - start;
        left = isAudio || freeVideo ? cut : start;
        right = isAudio || freeVideo ? end : end - (cut - start);
        // Shrink before moving right; move left before extending the source range.
        const trim: EditOperation = {
          type: isAudio ? "audio-trim" : "trim",
          clipId: id,
          inFrame,
          outFrame: clip.outFrame,
        };
        const move: EditOperation = { type: "audio-move", clipId: id, startFrame: left };
        operations = isAudio ? (left > start ? [trim, move] : [move, trim]) : [trim];
        point = cut;
      } else if (edge === "out") {
        right = snap(
          end + delta,
          start + 1,
          Math.min(
            end + asset.durationFrames - clip.outFrame,
            isAudio ? timelineDuration(project) : freeVideo ? nextStart : Infinity,
          ),
        );
        operations = [
          {
            type: isAudio ? "audio-trim" : "trim",
            clipId: id,
            inFrame: clip.inFrame,
            outFrame: clip.outFrame + right - end,
          },
        ];
        point = right;
      } else {
        // Either edge may align to the playhead or another clip; free video can extend the sequence.
        left = snap(
          start + delta,
          0,
          freeVideo ? 86400 * project.fps - length : timelineDuration(project) - length,
          candidates.flatMap((value) => [value, value - length]),
        );
        right = left + length;
        operations = [
          { type: freeVideo ? "video-move" : "audio-move", clipId: id, startFrame: left },
        ];
        point = candidates.includes(left) ? left : candidates.includes(right) ? right : left;
      }
      if (left === start && right === end && (edge !== "in" || point === start)) operations = [];
      invalid =
        freeVideo && neighbours.some((item) => left < item.endFrame && right > item.startFrame);
      element.style.left = `${(left / project.fps) * zoom}px`;
      element.style.width = `${((right - left) / project.fps) * zoom}px`;
      element.classList.add("dragging", "selected");
      element.classList.toggle("drag-invalid", invalid);
      if (freeVideo)
        content.style.width = `${Math.max(content.offsetWidth, (right / project.fps) * zoom + 120)}px`;
      guide.hidden = false;
      guide.style.left = `${(point / project.fps) * zoom}px`;
      guide.classList.toggle("snapped", enabled && candidates.includes(point));
      guide.classList.toggle("invalid", invalid);
      label.textContent = invalid
        ? "此位置与其他片段重叠，请移到空位"
        : `${enabled && candidates.includes(point) ? "已吸附 · " : ""}${formatTime(Math.max(0, point))}`;
    }
    function cleanup(released = false) {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", pointercancel);
      document.removeEventListener("keydown", keydown, true);
      window.removeEventListener("blur", cancel);
      cancelAnimationFrame(scrolling);
      scrolling = 0;
      lastPointer = undefined;
      content.style.width = contentWidth;
      originalStyle === null
        ? element.removeAttribute("style")
        : element.setAttribute("style", originalStyle);
      element.classList.remove("dragging", "drag-invalid");
      element.classList.toggle("selected", wasSelected);
      guide.remove();
      cancelActive = undefined;
      gestureProject = undefined;
      queueMicrotask(() => {
        if (!renderPending || cancelActive) return;
        renderPending = false;
        host.render();
      });
      if (moved) {
        suppressClick = true;
        window.clearTimeout(suppressionTimer);
        if (released)
          suppressionTimer = window.setTimeout(() => {
            suppressClick = false;
          }, 0);
      }
    }
    function cancel() {
      cleanup();
    }
    function pointercancel(next: PointerEvent) {
      if (next.pointerId === event.pointerId) cancel();
    }
    function keydown(next: KeyboardEvent) {
      if (next.key === "Escape") {
        next.preventDefault();
        next.stopImmediatePropagation();
        cancel();
      }
    }
    function up(next: PointerEvent) {
      if (next.pointerId !== event.pointerId) return;
      move(next);
      cleanup(true);
      if (!operations.length) return;
      try {
        if (invalid) throw new Error("同一画面轨不能重叠，请把片段拖到空位或序列末尾");
        if (host.project().id !== project.id || host.project().revision !== project.revision)
          throw new Error("拖动期间工程已变化，请重试");
        host.assertEditable();
        host.select(id);
        host.edit(operations, project.revision);
      } catch (error) {
        host.fail(error);
      }
    }
    cancelActive = cancel;
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", pointercancel);
    document.addEventListener("keydown", keydown, true);
    window.addEventListener("blur", cancel);
    return true;
  }
  studio.addEventListener(
    "pointerdown",
    () => {
      if (!cancelActive) suppressClick = false;
    },
    true,
  );
  studio.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  return {
    pointerdown,
    cancel: () => cancelActive?.(),
    deferRender(): boolean {
      if (gestureProject) {
        const current = host.project();
        if (current.id === gestureProject.id && current.revision === gestureProject.revision) {
          // Media loading and job refreshes must not replace a clip under the pointer.
          renderPending = true;
          return true;
        }
        cancelActive?.();
      }
      renderPending = false;
      return false;
    },
  };
}
