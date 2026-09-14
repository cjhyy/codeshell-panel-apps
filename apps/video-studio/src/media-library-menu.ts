import { escapeHtml as esc, icon } from "./icons";
export interface MediaMenuItem {
  action: string;
  label: string;
  glyph?: string;
  disabled?: boolean;
  danger?: boolean;
}
/** A viewport-bound, keyboard-operable menu; it carries no project or file authority. */
export function createMediaLibraryMenu(context: {
  items(id: string): MediaMenuItem[];
  run(action: string, id: string): void;
  restoreFocus(id: string): void;
}) {
  let menu: HTMLElement | undefined;
  let sourceId = "";
  function close(restoreFocus = false) {
    const id = sourceId;
    menu?.remove();
    menu = undefined;
    sourceId = "";
    if (restoreFocus && id) context.restoreFocus(id);
  }
  function open(id: string, x: number, y: number) {
    close();
    sourceId = id;
    menu = document.createElement("div");
    menu.id = "media-context-menu";
    menu.className = "media-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "素材操作");
    menu.innerHTML = context
      .items(id)
      .map(
        (item) =>
          `<button type="button" role="menuitem" data-action="${esc(item.action)}" data-id="${esc(id)}"${item.disabled ? " disabled" : ""} class="${item.danger ? "danger" : ""}">${icon(item.glyph ?? "film", 16)}<span>${esc(item.label)}</span></button>`,
      )
      .join("");
    menu.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-action]",
      );
      if (!button || button.disabled) return;
      const action = button.dataset.action!;
      close();
      context.run(action, id);
    });
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        menu &&
        !menu.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest('[data-action="media-menu"]')
      )
        close();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (!menu) return;
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
      }
    },
    true,
  );
  window.addEventListener("resize", () => close());
  for (const name of ["wheel", "touchmove"] as const)
    document.addEventListener(
      name,
      (event) => {
        if (menu && !menu.contains(event.target as Node)) close();
      },
      { capture: true, passive: true },
    );
  return {
    open,
    close,
    get active() {
      return !!menu;
    },
    get assetId() {
      return sourceId;
    },
  };
}
