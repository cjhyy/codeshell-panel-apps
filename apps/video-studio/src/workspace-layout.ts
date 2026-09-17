export interface WorkspaceLayoutSizes {
  library: number;
  inspector: number;
  timeline: number;
}

type Pane = keyof WorkspaceLayoutSizes;
type LayoutStore = {
  load(): Promise<unknown>;
  save(sizes: WorkspaceLayoutSizes): Promise<void>;
};

const defaults: WorkspaceLayoutSizes = { library: 260, inspector: 270, timeline: 308 };
const paneOf = (target: EventTarget | null): Pane | undefined => {
  if (!(target instanceof Element)) return;
  const value = target.closest<HTMLElement>("[data-resize-pane]")?.dataset.resizePane;
  return value === "library" || value === "inspector" || value === "timeline"
    ? value
    : undefined;
};
const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, Math.max(low, high)));

/** Layout preferences belong to this device, never to the video document. */
export function createWorkspaceLayout(studio: HTMLElement, store: LayoutStore) {
  let sizes = { ...defaults };
  let changed = false;
  let drag:
    | { pane: Pane; pointerId: number; origin: number; initial: number; before: WorkspaceLayoutSizes; handle: HTMLElement }
    | undefined;

  const workspace = () => studio.querySelector<HTMLElement>(".workspace.editor-mode");
  const limits = (pane: Pane): [number, number] => {
    const host = workspace();
    if (!host) return pane === "timeline" ? [200, 600] : [180, 500];
    const rail = host.querySelector<HTMLElement>(".rail")?.getBoundingClientRect().width ?? 66;
    const width = host.getBoundingClientRect().width;
    if (pane === "library") return [180, Math.min(500, width - rail - sizes.inspector - 320)];
    if (pane === "inspector") return [220, Math.min(500, width - rail - sizes.library - 320)];
    const toolbar = host.querySelector<HTMLElement>(".ew-tools")?.getBoundingClientRect().height ?? 44;
    return [200, Math.min(720, host.getBoundingClientRect().height - toolbar - 260)];
  };
  const apply = () => {
    const host = workspace();
    if (!host) return;
    const rail = host.querySelector<HTMLElement>(".rail")?.getBoundingClientRect().width ?? 66;
    const width = host.getBoundingClientRect().width;
    const library = clamp(sizes.library, 180, Math.min(500, width - rail - 320 - 220));
    const inspector = clamp(sizes.inspector, 220, Math.min(500, width - rail - library - 320));
    const toolbar = host.querySelector<HTMLElement>(".ew-tools")?.getBoundingClientRect().height ?? 44;
    const timeline = clamp(sizes.timeline, 200, Math.min(720, host.getBoundingClientRect().height - toolbar - 260));
    host.style.setProperty("--studio-library-width", `${library}px`);
    host.style.setProperty("--studio-inspector-width", `${inspector}px`);
    host.style.setProperty("--studio-timeline-height", `${timeline}px`);
    for (const [pane, value] of Object.entries({ library, inspector, timeline })) {
      host.querySelector<HTMLElement>(`[data-resize-pane="${pane}"]`)?.setAttribute(
        "aria-valuenow",
        String(Math.round(value)),
      );
    }
  };
  const persist = () => {
    changed = true;
    void store.save({ ...sizes }).catch(() => {});
  };
  const set = (pane: Pane, value: number, save = false) => {
    const [min, max] = limits(pane);
    sizes[pane] = clamp(value, min, max);
    apply();
    if (save) persist();
  };
  const endDrag = (commit: boolean) => {
    if (!drag) return;
    if (!commit) sizes = drag.before;
    if (drag.handle.hasPointerCapture(drag.pointerId))
      drag.handle.releasePointerCapture(drag.pointerId);
    drag = undefined;
    studio.classList.remove("is-resizing-workspace");
    apply();
    if (commit) persist();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag.pane === "timeline" ? event.clientY : event.clientX;
    const direction = drag.pane === "inspector" || drag.pane === "timeline" ? -1 : 1;
    set(drag.pane, drag.initial + (current - drag.origin) * direction);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) endDrag(true);
  };
  const onPointerCancel = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) endDrag(false);
  };
  const onPointerDown = (event: PointerEvent) => {
    const pane = paneOf(event.target);
    if (!pane || !workspace() || window.innerWidth <= 900 || event.button !== 0) return;
    const handle = (event.target as Element).closest<HTMLElement>("[data-resize-pane]")!;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const host = workspace()!;
    const actual = Number.parseFloat(
      getComputedStyle(host).getPropertyValue(
        pane === "library"
          ? "--studio-library-width"
          : pane === "inspector"
            ? "--studio-inspector-width"
            : "--studio-timeline-height",
      ),
    );
    drag = {
      pane,
      pointerId: event.pointerId,
      origin: pane === "timeline" ? event.clientY : event.clientX,
      initial: Number.isFinite(actual) ? actual : sizes[pane],
      before: { ...sizes },
      handle,
    };
    studio.classList.add("is-resizing-workspace");
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && drag) {
      endDrag(false);
      return;
    }
    const pane = paneOf(event.target);
    if (!pane || !workspace()) return;
    if (event.key === "Home") {
      event.preventDefault();
      set(pane, defaults[pane], true);
      return;
    }
    const direction =
      pane === "timeline"
        ? event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0
        : event.key === "ArrowRight" ? (pane === "library" ? 1 : -1)
          : event.key === "ArrowLeft" ? (pane === "library" ? -1 : 1) : 0;
    if (!direction) return;
    event.preventDefault();
    set(pane, sizes[pane] + direction * (event.shiftKey ? 40 : 16), true);
  };
  const onDoubleClick = (event: MouseEvent) => {
    const pane = paneOf(event.target);
    if (pane) set(pane, defaults[pane], true);
  };
  studio.addEventListener("pointerdown", onPointerDown);
  studio.addEventListener("keydown", onKeyDown);
  studio.addEventListener("dblclick", onDoubleClick);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("resize", apply);
  return {
    apply,
    async load() {
      try {
        const saved = await store.load();
        if (changed || !saved || typeof saved !== "object") return;
        const value = saved as Partial<WorkspaceLayoutSizes>;
        sizes = {
          library: finite(value.library, defaults.library),
          inspector: finite(value.inspector, defaults.inspector),
          timeline: finite(value.timeline, defaults.timeline),
        };
        apply();
      } catch {
        apply();
      }
    },
    dispose() {
      studio.removeEventListener("pointerdown", onPointerDown);
      studio.removeEventListener("keydown", onKeyDown);
      studio.removeEventListener("dblclick", onDoubleClick);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("resize", apply);
    },
  };
}
