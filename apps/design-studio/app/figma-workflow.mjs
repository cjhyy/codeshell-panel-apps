import { importFigmaJson, createFigmaTransfer, MAX_FIGMA_JSON_BYTES } from "./figma-bridge.mjs";

// File conversion stays inside the Panel. Figma account access is not needed.
export function mountFigmaWorkflow({
  getScope,
  checkScope,
  capture,
  replace,
  prototype,
  prepareImport = (input) => importFigmaJson(input),
  transfer = (document) => createFigmaTransfer(document),
  source,
}) {
  const button = document.createElement("button");
  button.id = "open-figma-workflow";
  button.className = "button";
  button.type = "button";
  button.textContent = "Figma 导入与导回";
  button.title = "Figma JSON 导入、导回与 HTML 原型";
  document.querySelector("#open-html-import").before(button);

  const dialog = document.createElement("dialog");
  dialog.id = "figma-workflow-dialog";
  dialog.setAttribute("aria-labelledby", "figma-workflow-title");
  dialog.innerHTML = `<section class="dialog-card figma-workflow-card">
    <div class="dialog-header"><div><span class="dialog-kicker">FIGMA EXCHANGE</span>
      <h2 id="figma-workflow-title">Figma 与设计工作台</h2></div>
      <button id="figma-workflow-close" type="button" class="dialog-close" aria-label="关闭 Figma 转换">×</button></div>
    <p class="dialog-description">导入 JSON 后编辑设计、生成 HTML，并通过插件预览后更新原设计或创建新页面。</p>
    <div class="figma-workflow-step"><h3>1 · 导入设计</h3>
      <label for="figma-import-file">Figma REST API 或插件导出的 JSON</label>
      <input id="figma-import-file" type="file" accept=".json,application/json" />
      <p class="dialog-description">支持文字、形状、自动布局与包内图片。复杂图层可使用插件导出的预览，原始 Figma 属性保留用于回写。</p>
      <label for="figma-import-mode">导入方式</label>
      <select id="figma-import-mode"><option value="create">新建设计文件</option><option value="replace">替换当前画布（可撤销）</option></select>
      <label for="figma-import-target">新稿保存路径</label>
      <input id="figma-import-target" value="designs/figma-import.codesign.json" spellcheck="false" />
      <p id="figma-import-preview"></p>
      <p id="figma-import-audit" role="status"></p>
      <img id="figma-import-image" alt="转换后的设计预览" hidden />
      <ul id="figma-import-warnings" class="figma-warning-list" aria-label="转换差异"></ul>
      <button id="figma-import-apply" type="button" class="primary-button" disabled>导入到画布（可撤销）</button>
      <p class="dialog-description">新稿使用独立路径；替换模式保留撤销记录。导入后核对画布，再保存。</p>
    </div>
    <div class="figma-workflow-step"><h3>2 · 导回 Figma</h3>
      <button id="figma-transfer-download" type="button" class="button">下载 Figma 转换 JSON</button>
      <button id="figma-source-download" type="button" class="button">下载保留的 Figma 原始 JSON</button>
      <p id="figma-patch-preview" class="dialog-description"></p>
      <p class="dialog-description">插件可预览原节点的增删改与冲突，确认后只应用列出的改动；也可创建新的页面。</p>
      <details><summary>首次使用：下载并安装 Figma 开发插件</summary>
        <p class="dialog-description">先在 Figma 桌面端的 Plugins → Development → New plugin 创建带界面的插件，取得生成的 manifest.json 中的 id。填入下方后下载三个文件，放到同一文件夹，再用 Import plugin from manifest 选择下载的 manifest.json。</p>
        <label for="figma-plugin-id">Figma 分配的插件 ID</label>
        <input id="figma-plugin-id" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="从 Figma 生成的 manifest.json 复制 id" />
        <div class="figma-plugin-files">
          <button type="button" class="button" data-plugin-file="manifest.json">manifest.json</button>
          <button type="button" class="button" data-plugin-file="code.js">code.js</button>
          <button type="button" class="button" data-plugin-file="ui.html">ui.html</button>
        </div>
      </details>
    </div>
    <div class="figma-workflow-step"><h3>3 · HTML 原型</h3>
      <button id="figma-html-download" type="button" class="button">下载当前页 HTML 原型</button>
      <p class="dialog-description">可离线打开，保留图层 ID 与布局。交互逻辑可在“交付”中交给 Agent 继续实现。</p>
    </div>
    <div class="figma-workflow-step"><h3>4 · HTML to Figma 独立插件</h3>
      <p class="dialog-description">直接在 Figma 中粘贴 HTML 或选择本地 HTML 文件夹，预览后创建可编辑图层。无需 CodeShell 或服务地址。</p>
      <label for="html-plugin-id">此插件由 Figma 分配的 ID</label>
      <input id="html-plugin-id" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="先在 Figma 创建带 UI 的开发插件，再复制其 id" />
      <div class="figma-plugin-files">
        <button type="button" class="button" data-html-plugin-file="manifest.json">HTML 插件 manifest</button>
        <button type="button" class="button" data-html-plugin-file="code.js">HTML 插件 code.js</button>
        <button type="button" class="button" data-html-plugin-file="ui.html">HTML 插件 ui.html</button>
        <button type="button" class="button" data-html-plugin-file="NOTICE.md">来源许可</button>
        <button type="button" class="button" data-html-plugin-file="README.md">安装说明</button>
      </div>
      <p class="dialog-description">这五个文件放在独立文件夹。Figma → Plugins → Development → Import plugin from manifest。设计备份与增量导回继续使用上面的 Design Bridge。</p>
    </div>
    <p id="figma-workflow-status" class="html-import-status" role="status" aria-live="polite"></p>
  </section>`;
  document.body.append(dialog);
  const el = (id) => dialog.querySelector(`#${id}`);
  const fileInput = el("figma-import-file"),
    apply = el("figma-import-apply");
  const status = el("figma-workflow-status"),
    preview = el("figma-import-preview");
  const warnings = el("figma-import-warnings");
  const mode = el("figma-import-mode"),
    target = el("figma-import-target");
  const audit = el("figma-import-audit"),
    image = el("figma-import-image");
  const updateTarget = () => {
    target.disabled = busy || mode.value !== "create";
    apply.textContent =
      mode.value === "create" ? "导入到新稿（检查后保存）" : "替换当前画布（可撤销）";
  };
  mode.addEventListener("change", updateTarget);
  let generation = 0,
    pending = null,
    busy = false;
  const showStatus = (text, error = false) => {
    status.textContent = text;
    status.dataset.kind = error ? "error" : "idle";
  };
  const setBusy = (value) => {
    busy = value;
    dialog.setAttribute("aria-busy", String(value));
    for (const action of dialog.querySelectorAll(
      "button:not(#figma-workflow-close), input, select",
    )) {
      action.disabled = value;
    }
    apply.disabled = value || !pending;
    updateTarget();
  };
  const reset = () => {
    pending = null;
    fileInput.value = "";
    preview.textContent = "";
    audit.textContent = "";
    image.hidden = true;
    image.removeAttribute("src");
    mode.value = "create";
    warnings.replaceChildren();
    setBusy(false);
  };
  const start = (scope = getScope()) => {
    const ticket = ++generation;
    checkScope(scope);
    return {
      scope,
      ticket,
      check() {
        if (generation !== ticket || !dialog.open) throw Error("Figma 转换已取消，请重新操作");
        checkScope(scope);
      },
    };
  };
  const failed = (operation, error) => {
    if (dialog.open && (!operation || operation.ticket === generation)) {
      showStatus(error instanceof Error ? error.message : "转换失败", true);
    }
  };
  function download(content, filename, type = "application/json") {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function showWarnings(items) {
    warnings.replaceChildren();
    for (const warning of items.slice(0, 80)) {
      const item = document.createElement("li");
      item.textContent = `${warning.nodeId ? `${warning.nodeId} · ` : ""}${warning.message}`;
      warnings.append(item);
    }
    if (items.length > 80) {
      const item = document.createElement("li");
      item.textContent = `其余 ${items.length - 80} 条差异请分批核对；转换 JSON 会附带导出差异。`;
      warnings.append(item);
    }
  }
  button.addEventListener("click", () => {
    generation++;
    reset();
    showStatus("选择 JSON 可先查看转换结果；导入和下载均不会自动写入项目。");
    dialog.showModal();
  });
  el("figma-workflow-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    generation++;
    reset();
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file || busy) return;
    pending = null;
    preview.textContent = "";
    warnings.replaceChildren();
    let operation;
    setBusy(true);
    try {
      operation = start();
      // Bounds apply to this conversion operation, not the design document format.
      if (file.size > MAX_FIGMA_JSON_BYTES)
        throw Error("单次 JSON 导入最多 16 MiB，请在 Figma 中分批导出选区");
      const text = await file.text();
      operation.check();
      const result = await prepareImport(text, operation.scope);
      operation.check();
      pending = { ...result, scope: operation.scope };
      const stem =
        file.name
          .replace(/[.]json$/iu, "")
          .replace(/[^a-zA-Z0-9_-]/gu, "-")
          .slice(0, 80) || "figma-import";
      target.value = `designs/${stem}.codesign.json`;
      audit.textContent = result.audit
        ? `预检：${result.audit.blockingIssueCount} 个阻塞 · ${result.audit.warningCount} 个警告${result.audit.renderSafe ? "" : "；可保留草稿，需修正后交付"}`
        : "";
      audit.dataset.kind = result.audit?.renderSafe === false ? "error" : "idle";
      if (result.previewSvg) {
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.previewSvg)}`;
        image.hidden = false;
      }
      preview.textContent = `${result.document.name} · ${result.stats.pages} 页 · ${result.stats.importedNodes} 个可编辑图层 · ${result.stats.skippedNodes} 个跳过图层`;
      showWarnings(result.warnings);
      showStatus(
        result.warnings.length
          ? `转换包含 ${result.warnings.length} 条差异。核对后再导入。`
          : "转换完成，可以导入。",
      );
    } catch (error) {
      failed(operation, error);
    } finally {
      if (!operation || generation === operation.ticket) setBusy(false);
    }
  });
  apply.addEventListener("click", async () => {
    if (busy || !pending) return;
    const review = pending;
    let operation;
    setBusy(true);
    try {
      operation = start(review.scope);
      await replace(review.document, operation.check, review, {
        mode: mode.value,
        targetPath: target.value.trim(),
      });
      // Replacement changes the state revision by design. Only check the dialog ticket now.
      if (generation !== operation.ticket || !dialog.open) return;
      pending = null;
      showStatus(`已导入 ${review.stats.importedNodes} 个图层。请在画布核对差异，再保存设计。`);
      preview.textContent = "已导入；可关闭窗口查看画布，或继续下载转换 JSON / HTML。";
    } catch (error) {
      failed(operation, error);
    } finally {
      if (!operation || generation === operation.ticket) setBusy(false);
    }
  });
  el("figma-transfer-download").addEventListener("click", async () => {
    if (busy) return;
    let operation;
    setBusy(true);
    try {
      operation = start();
      const snapshot = await capture(operation.scope);
      operation.check();
      const output = await transfer(snapshot, operation.scope);
      operation.check();
      showWarnings(output.warnings);
      el("figma-patch-preview").textContent = output.patch
        ? `原设计修改：${output.patch.summary.creates} 项新增 · ${output.patch.summary.updates} 项更新 · ${output.patch.summary.deletes} 项删除。请在插件中预览冲突后应用。`
        : "当前设计没有 Figma 来源映射，插件将创建新页面。";
      download(`${JSON.stringify(output, null, 2)}\n`, "design.figma-transfer.json");
      showStatus(
        `已下载转换 JSON${output.warnings.length ? `，含 ${output.warnings.length} 条差异` : ""}。在 Figma 插件中载入后核对。`,
      );
    } catch (error) {
      failed(operation, error);
    } finally {
      if (!operation || generation === operation.ticket) setBusy(false);
    }
  });
  el("figma-source-download").addEventListener("click", async () => {
    if (busy) return;
    let operation;
    setBusy(true);
    try {
      operation = start();
      const original = await source?.(operation.scope);
      operation.check();
      if (!original) throw Error("当前设计没有保留的 Figma 来源，请先导入 Figma JSON");
      download(`${JSON.stringify(original, null, 2)}\n`, "design.figma-source.json");
      showStatus("已下载保留的原始 Figma JSON，包含未转换的来源属性。");
    } catch (error) {
      failed(operation, error);
    } finally {
      if (!operation || generation === operation.ticket) setBusy(false);
    }
  });
  el("figma-html-download").addEventListener("click", async () => {
    if (busy) return;
    let operation;
    setBusy(true);
    try {
      operation = start();
      const html = await prototype(operation.scope);
      operation.check();
      download(html, "design-prototype.html", "text/html");
      showStatus("当前页 HTML 原型已下载，可离线打开。更完整的前端交付请使用“交付”。");
    } catch (error) {
      failed(operation, error);
    } finally {
      if (!operation || generation === operation.ticket) setBusy(false);
    }
  });
  for (const action of dialog.querySelectorAll("[data-plugin-file], [data-html-plugin-file]")) {
    action.addEventListener("click", async () => {
      if (busy) return;
      const ticket = ++generation;
      setBusy(true);
      try {
        const htmlPlugin = Boolean(action.dataset.htmlPluginFile);
        const file = action.dataset.htmlPluginFile ?? action.dataset.pluginFile;
        const directory = htmlPlugin ? "html-to-figma-plugin" : "figma-plugin";
        const pluginId = el(htmlPlugin ? "html-plugin-id" : "figma-plugin-id").value.trim();
        if (file === "manifest.json" && !/^[0-9]{1,32}$/.test(pluginId)) {
          throw Error("请先创建 Figma 开发插件，并填入其 manifest.json 中由 Figma 分配的数字 id");
        }
        const response = await fetch(new URL(`./${directory}/${file}`, import.meta.url));
        if (!response.ok)
          throw Error("插件文件无法读取，请从 Design Studio 安装目录获取 figma-plugin 文件夹");
        let source = await response.text();
        if (ticket !== generation || !dialog.open) return;
        if (file === "manifest.json")
          source = `${JSON.stringify({ ...JSON.parse(source), id: pluginId }, null, 2)}\n`;
        download(
          source,
          file,
          file.endsWith("html")
            ? "text/html"
            : file.endsWith("js")
              ? "text/javascript"
              : "application/json",
        );
        showStatus(`已下载 ${file}。请将同一插件的文件放在独立文件夹。`);
      } catch (error) {
        if (ticket === generation && dialog.open) failed(null, error);
      } finally {
        if (ticket === generation) setBusy(false);
      }
    });
  }
  return {
    contextChanged() {
      generation++;
      reset();
      if (dialog.open) showStatus("设计或项目已切换，请重新选择 JSON 或发起下载。");
    },
  };
}
