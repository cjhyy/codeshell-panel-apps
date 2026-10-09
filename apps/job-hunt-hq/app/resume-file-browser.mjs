let openDirectoryDialog = null;
export function closeResumeDirectories() { openDirectoryDialog?.close(); }

// File access remains in the originating project scope, including when two
// cloud projects expose the same /workspace path.
export async function downloadResumeMarkdown(path, scope) {
  const result = await scope.call("workspace.readText", { path });
  if (typeof result?.content !== "string") throw new Error("项目文件没有返回有效文本，请重新读取。");
  scope.check();
  const url = URL.createObjectURL(new Blob([result.content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = path.split("/").pop() || "resume.md";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function browseResumeDirectory(path, scope, notify) {
  closeResumeDirectories();
  const dialog = document.createElement("dialog");
  openDirectoryDialog = dialog;
  dialog.setAttribute("aria-label", "项目投递文件");
  const heading = document.createElement("h2");
  heading.textContent = "项目投递文件";
  const location = document.createElement("p");
  const list = document.createElement("div");
  list.className = "resume-file-list";
  const close = document.createElement("button");
  close.className = "button button-quiet";
  close.textContent = "关闭";
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (openDirectoryDialog === dialog) openDirectoryDialog = null;
    dialog.remove();
  }, { once: true });
  dialog.append(heading, location, list, close);
  document.body.append(dialog);
  dialog.showModal();
  const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
  try {
    const result = await scope.call("workspace.list", { path: directory });
    if (!dialog.open) return;
    location.textContent = `当前项目 · ${directory}`;
    const entries = Array.isArray(result?.entries) ? result.entries : [];
    for (const entry of entries) {
      const row = document.createElement("p");
      const label = document.createElement("span");
      label.textContent = entry.name;
      row.append(label);
      if (entry.kind === "file" && /\.md$/i.test(entry.path)) {
        const download = document.createElement("button");
        download.className = "card-session-action";
        download.textContent = "下载 Markdown";
        download.addEventListener("click", () => {
          void downloadResumeMarkdown(entry.path, scope).catch(error => {
            if (scope.active()) notify(error.message, "error"); else dialog.close();
          });
        });
        row.append(download);
      }
      list.append(row);
    }
    if (!entries.length) list.textContent = "这个项目目录暂无文件。";
    const hint = document.createElement("p");
    hint.textContent = "可下载 PDF 显示在投递文件列表；旧版路径 PDF 可回到简历内容重新导出。";
    dialog.insertBefore(hint, close);
  } catch (error) {
    dialog.close();
    throw error;
  }
}
