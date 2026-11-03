/** User acknowledgement for unresolved or manually recovered media requests. */
export function confirmMediaRequestRecovery(message: string): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    const title = document.createElement("h2");
    title.textContent = "核查原媒体请求";
    const explanation = document.createElement("p");
    explanation.textContent = message;
    const cancel = document.createElement("button");
    cancel.textContent = "保留原请求，不重发";
    const proceed = document.createElement("button");
    proceed.textContent = "已核查，创建新请求";
    let confirmed = false;
    cancel.addEventListener("click", () => dialog.close());
    proceed.addEventListener("click", () => { confirmed = true; dialog.close(); });
    dialog.addEventListener("close", () => { dialog.remove(); resolve(confirmed); }, { once: true });
    dialog.append(title, explanation, cancel, proceed);
    document.body.append(dialog);
    dialog.showModal();
  });
}
