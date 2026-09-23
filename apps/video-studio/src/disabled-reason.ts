import { escapeHtml as esc } from "./icons";

/**
 * Important actions stay focusable while unavailable: aria-disabled plus a described reason lets
 * keyboard and screen-reader users hear why. Click handlers must ignore aria-disabled controls.
 */
export function announcedDisabled(id: string, disabled: boolean, reason: string) {
  return disabled && reason
    ? {
        attributes: ` aria-disabled="true" aria-describedby="${esc(id)}" title="${esc(reason)}"`,
        note: `<span id="${esc(id)}" class="disabled-reason" hidden>${esc(reason)}</span>`,
      }
    : { attributes: "", note: "" };
}

/** Update a rendered control in place with the same contract as announcedDisabled. */
export function setAnnouncedDisabled(
  button: HTMLButtonElement,
  id: string,
  disabled: boolean,
  reason: string,
): void {
  let note = button.ownerDocument.getElementById(id);
  if (disabled && reason) {
    if (!note) {
      note = button.ownerDocument.createElement("span");
      note.id = id;
      note.className = "disabled-reason";
      note.hidden = true;
      button.after(note);
    }
    note.textContent = reason;
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("aria-describedby", id);
    button.title = reason;
  } else {
    note?.remove();
    button.removeAttribute("aria-disabled");
    button.removeAttribute("aria-describedby");
    button.removeAttribute("title");
  }
  button.disabled = false;
}

/** True for a control that is present but currently unavailable. */
export const unavailable = (element: Element | null | undefined) =>
  element?.getAttribute("aria-disabled") === "true";
