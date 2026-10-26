// The toolbar owns presentation and navigation; existing command IDs keep their actions.
export function mountToolbarMenu(root = document) {
  const menu = root.querySelector("#compact-actions");
  const trigger = menu?.querySelector("summary");
  const commands = menu?.querySelector(".compact-actions-list");
  if (!menu || !trigger || !commands) return () => {};
  const doc = menu.ownerDocument;
  const syncExpanded = () => trigger.setAttribute("aria-expanded", String(menu.open));
  const close = (restoreFocus = false) => {
    menu.open = false;
    syncExpanded();
    if (restoreFocus) trigger.focus();
  };
  const buttons = () => [...commands.querySelectorAll("button:not(:disabled)")]
    .filter(button => !button.hidden && button.getClientRects().length > 0);
  const onKeyDown = event => {
    if (event.key === "Escape" && menu.open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    // Text fields retain the usual cursor, selection and editing keys.
    if (event.target.matches("input, textarea, select")) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (!menu.open && event.target !== trigger) return;
    event.preventDefault();
    event.stopPropagation();
    menu.open = true;
    syncExpanded();
    const options = buttons();
    if (!options.length) return;
    const current = options.indexOf(doc.activeElement);
    let next;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else if (event.key === "ArrowDown") next = (current + 1) % options.length;
    else next = current < 0 ? options.length - 1 : (current + options.length - 1) % options.length;
    options[next].focus();
  };
  const onCommand = event => {
    const button = event.target.closest("button");
    if (button && commands.contains(button) && !button.disabled) close(true);
  };
  const onPointerDown = event => { if (!menu.contains(event.target)) close(); };
  const onFocus = event => { if (!menu.contains(event.target)) close(); };
  menu.addEventListener("toggle", syncExpanded);
  menu.addEventListener("keydown", onKeyDown);
  // A dialog opened by the command can return focus to the visible More trigger.
  commands.addEventListener("click", onCommand, true);
  doc.addEventListener("pointerdown", onPointerDown);
  doc.addEventListener("focusin", onFocus);
  syncExpanded();
  return () => {
    menu.removeEventListener("toggle", syncExpanded);
    menu.removeEventListener("keydown", onKeyDown);
    commands.removeEventListener("click", onCommand, true);
    doc.removeEventListener("pointerdown", onPointerDown);
    doc.removeEventListener("focusin", onFocus);
  };
}

if (typeof document !== "undefined") mountToolbarMenu();
