import {
  createPrototypeStore,
  exportDesignPrototype,
  normalizePrototype,
  prototypeDiagnostics,
  repairPrototype,
  prototypePath,
  prototypeScopeKey,
} from "./prototype.mjs";

import { createReviewCommentsStore } from "./review-comments.mjs";
import { projectContextKey } from "./project-context.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const nodeList = (page) => {
  const all = [];
  const visit = (nodes) => {
    for (const node of nodes ?? []) {
      all.push(node);
      if (node.children) visit(node.children);
    }
  };
  visit(page.children ?? page.nodes);
  return all;
};

export function mountPrototypeEditor({
  getSnapshot,
  capture,
  captureComments,
  call,
  sha256,
  checkScope,
  notify = () => {},
}) {
  if (!document.querySelector("link[data-prototype-style]")) {
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = new URL("./prototype.css", import.meta.url).href;
    style.dataset.prototypeStyle = "";
    document.head.append(style);
  }
  const openButton = document.createElement("button");
  openButton.id = "open-prototype-editor";
  openButton.type = "button";
  openButton.className = "button";
  openButton.textContent = "交互原型";
  openButton.title = "页面跳转、返回、响应断点与离线原型";
  const menu = document.querySelector(".compact-actions-list");
  if (menu) menu.insertBefore(openButton, menu.querySelector("#run-audit"));
  const dialog = document.createElement("dialog");
  dialog.id = "prototype-editor-dialog";
  dialog.setAttribute("aria-labelledby", "prototype-editor-title");
  dialog.innerHTML = `<section class="dialog-card prototype-editor-card">
    <div class="dialog-header"><div><span class="dialog-kicker">INTERACTIVE PROTOTYPE</span><h2 id="prototype-editor-title">交互原型</h2></div><button id="prototype-editor-close" type="button" class="dialog-close" aria-label="关闭原型编辑">×</button></div>
    <p class="dialog-description">将选中图层连接到页面、返回或外部链接。配置保存在当前设计旁的 .prototype.json 文件中。</p>
    <p id="prototype-editor-path" class="prototype-path"></p>
    <section id="prototype-diagnostics" class="prototype-section" hidden><p id="prototype-diagnostic-text"></p><button id="prototype-repair" type="button" class="button">移除失效交互 / 断点并修复起始页</button></section>
    <div class="prototype-row"><label>起始页面<select id="prototype-start-page"></select></label><button id="prototype-refresh" type="button" class="button">重新读取</button></div>
    <section class="prototype-section"><h3>选中图层的点击动作</h3><p id="prototype-selected-layer"></p>
      <div class="prototype-row"><label>动作<select id="prototype-action"><option value="navigate">跳转页面</option><option value="back">返回上一页</option><option value="open-url">打开链接</option></select></label>
      <label id="prototype-target-page-label">目标页面<select id="prototype-target-page"></select></label>
      <label id="prototype-url-label" hidden>URL<input id="prototype-url" type="url" placeholder="https://example.com" maxlength="2048"></label></div>
      <button id="prototype-add-link" type="button" class="button">设置选中图层动作</button>
      <div id="prototype-links" class="prototype-list" aria-label="原型交互列表"></div>
    </section>
    <details class="prototype-section"><summary>响应断点</summary><p class="dialog-description">按窗口宽度选择初始页面；手动跳转后保留当前流程。断点范围不能重叠。</p>
      <div class="prototype-row"><label>最小宽度<input id="prototype-min-width" type="number" min="0" max="20000" value="0"></label><label>最大宽度（留空不限）<input id="prototype-max-width" type="number" min="0" max="20000"></label><label>页面<select id="prototype-breakpoint-page"></select></label></div>
      <button id="prototype-add-breakpoint" type="button" class="button">添加断点</button><div id="prototype-breakpoints" class="prototype-list" aria-label="响应断点列表"></div>
    </details>
    <div class="prototype-footer"><button id="prototype-save" type="button" class="primary-button">保存原型配置</button><button id="prototype-preview" type="button" class="button">预览</button><button id="prototype-download" type="button" class="button">下载全部页面 HTML</button><label><input id="prototype-include-comments" type="checkbox">包含评审评论</label></div>
    <p id="prototype-editor-status" class="html-import-status" role="status" aria-live="polite"></p>
    <section id="prototype-preview-section" hidden><div class="prototype-row"><h3>离线原型预览</h3><button id="prototype-preview-close" type="button" class="button">收起预览</button></div><iframe id="prototype-preview-frame" title="交互原型预览" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe></section>
  </section>`;
  document.body.append(dialog);
  const el = (id) => dialog.querySelector(`#${id}`);
  const start = el("prototype-start-page"),
    target = el("prototype-target-page"),
    action = el("prototype-action"),
    url = el("prototype-url");
  const status = el("prototype-editor-status"),
    links = el("prototype-links"),
    breakpoints = el("prototype-breakpoints");
  const store = createPrototypeStore({ getSnapshot, capture, call, sha256, checkScope });
  const drafts = new Map();
  let scopeKey,
    generation = 0,
    busy = false,
    loaded = null,
    draft = null,
    dirty = false,
    destroyed = false,
    wasReady = false;
  const draftKey = (snapshot) =>
    JSON.stringify([projectContextKey(snapshot.context ?? snapshot), snapshot.path]);
  function usable() {
    const snapshot = getSnapshot();
    try {
      prototypePath(snapshot.path);
    } catch {
      return false;
    }
    return snapshot.ready !== false && (snapshot.context ?? snapshot).trusted === true;
  }
  function state(message, error = false) {
    status.textContent = message;
    status.dataset.kind = error ? "error" : "idle";
  }
  function remember() {
    if (!draft || !dirty) return;
    drafts.set(draftKey(getSnapshot()), clone(draft));
  }
  function availability() {
    const enabled = usable();
    openButton.disabled = !enabled;
    for (const control of dialog.querySelectorAll(
      "button:not(#prototype-editor-close),input,select",
    ))
      control.disabled = busy || !enabled || (!loaded && control.id !== "prototype-refresh");
    el("prototype-add-link").disabled = busy || !enabled || !loaded || !getSnapshot().selectedNode;
    el("prototype-save").disabled = busy || !enabled || !loaded || !dirty;
    dialog.setAttribute("aria-busy", String(busy));
  }
  function selected() {
    const snapshot = getSnapshot();
    el("prototype-selected-layer").textContent = snapshot.selectedNode
      ? `${snapshot.selectedNode.name || snapshot.selectedNode.id} · ${snapshot.selectedNode.id}`
      : "请先在画布选择要添加交互的图层";
  }
  function actionVisibility() {
    el("prototype-target-page-label").hidden = action.value !== "navigate";
    el("prototype-url-label").hidden = action.value !== "open-url";
  }
  function optionList(select, value) {
    select.replaceChildren();
    for (const page of loaded?.document.pages ?? []) {
      const option = document.createElement("option");
      option.value = page.id;
      option.textContent = page.name;
      select.append(option);
    }
    if (value) select.value = value;
  }
  function markDirty() {
    dirty = true;
    remember();
    state("原型已修改；保存后供下次打开和前端交付使用。");
    renderLists();
    availability();
  }
  function listRow(text, remove, label) {
    const row = document.createElement("div");
    row.className = "prototype-list-row";
    const description = document.createElement("span");
    description.textContent = text;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button";
    button.textContent = "移除";
    button.setAttribute("aria-label", label);
    button.addEventListener("click", remove);
    row.append(description, button);
    return row;
  }
  function renderLists() {
    links.replaceChildren();
    breakpoints.replaceChildren();
    if (!draft || !loaded) {
      el("prototype-diagnostics").hidden = true;
      return;
    }
    const pages = new Map(loaded.document.pages.map((page) => [page.id, page]));
    const diagnostics = prototypeDiagnostics(draft, loaded.document);
    el("prototype-diagnostics").hidden = !diagnostics.length;
    el("prototype-diagnostic-text").textContent = diagnostics.length
      ? `${diagnostics.length} 项关联已失效。${diagnostics
          .slice(0, 8)
          .map((issue) => issue.message)
          .join("；")}。预览与导出前请修复并保存。`
      : "";
    for (const link of draft.links) {
      const page = pages.get(link.pageId),
        node = page && nodeList(page).find((node) => node.id === link.nodeId);
      const destination =
        link.action === "back"
          ? "返回上一页"
          : link.action === "open-url"
            ? link.url
            : `跳转到 ${pages.get(link.targetPageId)?.name ?? `${link.targetPageId}（已移除）`}`;
      links.append(
        listRow(
          `${page?.name ?? link.pageId} / ${node?.name ?? `${link.nodeId}（已移除）`} → ${destination}`,
          () => {
            draft.links = draft.links.filter((item) => item.id !== link.id);
            markDirty();
          },
          `移除交互 ${link.id}`,
        ),
      );
    }
    if (!draft.links.length) {
      const empty = document.createElement("p");
      empty.textContent = "尚未设置交互。";
      links.append(empty);
    }
    for (const point of draft.breakpoints ?? [])
      breakpoints.append(
        listRow(
          `${point.minWidth}–${point.maxWidth ?? "∞"} px → ${pages.get(point.pageId)?.name ?? point.pageId}`,
          () => {
            draft.breakpoints = draft.breakpoints.filter((item) => item.id !== point.id);
            markDirty();
          },
          `移除断点 ${point.id}`,
        ),
      );
  }
  function render() {
    optionList(start, draft?.startPageId);
    optionList(target);
    optionList(el("prototype-breakpoint-page"));
    selected();
    actionVisibility();
    renderLists();
    availability();
  }
  async function run(operation, completed) {
    update(false);
    if (busy || !usable()) return;
    const ticket = generation,
      expected = scopeKey;
    busy = true;
    state("正在处理原型…");
    availability();
    try {
      const result = await operation();
      if (destroyed || ticket !== generation || prototypeScopeKey(getSnapshot()) !== expected)
        return;
      completed?.(result);
      return result;
    } catch (error) {
      if (!destroyed && ticket === generation && prototypeScopeKey(getSnapshot()) === expected)
        state(`${error.message}；原型草稿已保留。`, true);
    } finally {
      if (!destroyed && ticket === generation) {
        busy = false;
        availability();
      }
    }
  }
  async function refresh() {
    return run(
      () => store.read(),
      (result) => {
        loaded = { ...result, draftStorageKey: draftKey(getSnapshot()) };
        const savedDraft = drafts.get(draftKey(getSnapshot()));
        draft = savedDraft ? clone(savedDraft) : clone(result.prototype);
        dirty = Boolean(savedDraft);
        render();
        state(
          dirty
            ? "已恢复此设计的原型草稿，尚未保存。"
            : `已读取原型配置 · ${draft.links.length} 个交互`,
        );
      },
    );
  }
  async function prepare() {
    return store.read();
  }
  async function prepareDraft() {
    const result = await store.read();
    const model = normalizePrototype(draft ?? result.prototype, result.document);
    return { ...result, prototype: model };
  }
  async function exportCurrent() {
    const snapshot = getSnapshot(),
      expected = prototypeScopeKey(snapshot),
      ticket = generation,
      basis = snapshot.stateRevision;
    const check = () => {
      if (
        generation !== ticket ||
        prototypeScopeKey(getSnapshot()) !== expected ||
        basis !== getSnapshot().stateRevision
      )
        throw Error("项目或设计在原型导出期间发生变化，请重新操作");
    };
    const result = await prepareDraft();
    check();
    let comments;
    if (el("prototype-include-comments").checked) {
      comments = captureComments ? await captureComments(snapshot, check) : result.comments;
      check();
      if (!comments) {
        const review = createReviewCommentsStore({
          getSnapshot,
          call,
          sha256,
          getOperationEpoch: () => generation,
        });
        comments = (await review.refresh()).document;
        check();
      }
    }
    check();
    return exportDesignPrototype(result.document, {
      prototype: result.prototype,
      resourceDataUrls: result.resourceDataUrls,
      comments,
    });
  }
  function update(autoRefresh = true) {
    if (destroyed) return;
    const snapshot = getSnapshot(),
      next = prototypeScopeKey(snapshot),
      changed = scopeKey !== next;
    if (changed) {
      // Keep unsaved models under their old project/path before invalidating async work.
      if (scopeKey && draft && dirty && loaded?.draftStorageKey)
        drafts.set(loaded.draftStorageKey, clone(draft));
      generation++;
      scopeKey = next;
      loaded = null;
      draft = null;
      dirty = false;
      busy = false;
      el("prototype-preview-section").hidden = true;
      el("prototype-preview-frame").removeAttribute("srcdoc");
      try {
        el("prototype-editor-path").textContent = prototypePath(snapshot.path);
      } catch (error) {
        el("prototype-editor-path").textContent = error.message;
      }
      render();
      state("打开或重新读取当前设计的原型配置。");
    }
    const ready = usable(),
      becameReady = ready && !wasReady;
    wasReady = ready;
    selected();
    availability();
    if (autoRefresh && dialog.open && ready && (changed || becameReady)) void refresh();
  }
  function open() {
    update(false);
    if (!usable()) return;
    if (!dialog.open) dialog.showModal();
    void refresh();
  }
  openButton.addEventListener("click", open);
  el("prototype-editor-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    remember();
    generation++;
    busy = false;
    el("prototype-preview-frame").removeAttribute("srcdoc");
    el("prototype-preview-section").hidden = true;
    availability();
  });
  el("prototype-refresh").addEventListener("click", () => void refresh());
  action.addEventListener("change", actionVisibility);
  start.addEventListener("change", () => {
    if (draft) {
      draft.startPageId = start.value;
      markDirty();
    }
  });
  el("prototype-repair").addEventListener("click", () => {
    if (!draft || !loaded) return;
    draft = repairPrototype(draft, loaded.document);
    markDirty();
    render();
    state("失效关联已从草稿移除；请保存原型配置。");
  });
  el("prototype-add-link").addEventListener("click", () => {
    const snapshot = getSnapshot();
    if (!draft || !snapshot.selectedNode) return;
    const old = draft.links.find(
      (link) => link.pageId === snapshot.pageId && link.nodeId === snapshot.selectedNode.id,
    );
    const link = {
      id: old?.id ?? `link-${crypto.randomUUID()}`,
      pageId: snapshot.pageId,
      nodeId: snapshot.selectedNode.id,
      event: "click",
      action: action.value,
      ...(action.value === "navigate"
        ? { targetPageId: target.value }
        : action.value === "open-url"
          ? { url: url.value.trim() }
          : {}),
    };
    try {
      const next = normalizePrototype(
        { ...draft, links: [...draft.links.filter((item) => item.id !== old?.id), link] },
        loaded.document,
      );
      draft = next;
      markDirty();
    } catch (error) {
      state(error.message, true);
    }
  });
  el("prototype-add-breakpoint").addEventListener("click", () => {
    if (!draft) return;
    const min = el("prototype-min-width").value,
      max = el("prototype-max-width").value;
    try {
      if (!min.trim()) throw Error("请输入最小宽度");
      const point = {
        id: `breakpoint-${crypto.randomUUID()}`,
        minWidth: Number(min),
        ...(max.trim() ? { maxWidth: Number(max) } : {}),
        pageId: el("prototype-breakpoint-page").value,
      };
      draft = normalizePrototype(
        { ...draft, breakpoints: [...(draft.breakpoints ?? []), point] },
        loaded.document,
      );
      markDirty();
    } catch (error) {
      state(error.message, true);
    }
  });
  el("prototype-save").addEventListener("click", () => {
    if (!draft || !loaded) {
      el("prototype-diagnostics").hidden = true;
      return;
    }
    const model = clone(draft),
      baseline = loaded.baseline;
    void run(
      () => store.save(model, { baseline }),
      (result) => {
        loaded = { ...result, draftStorageKey: draftKey(getSnapshot()) };
        draft = clone(result.prototype);
        dirty = false;
        drafts.delete(draftKey(getSnapshot()));
        state("原型配置已保存到当前项目。");
        render();
      },
    );
  });
  el("prototype-preview").addEventListener(
    "click",
    () =>
      void run(exportCurrent, (html) => {
        el("prototype-preview-frame").srcdoc = html;
        el("prototype-preview-section").hidden = false;
        state("预览已生成；可用键盘 Tab 选择交互并按 Enter 跳转。");
      }),
  );
  el("prototype-preview-close").addEventListener("click", () => {
    el("prototype-preview-section").hidden = true;
    el("prototype-preview-frame").removeAttribute("srcdoc");
  });
  el("prototype-download").addEventListener(
    "click",
    () =>
      void run(exportCurrent, (html) => {
        const objectUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = "design-interactive-prototype.html";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        state("全部页面交互原型已下载，可离线打开。");
      }),
  );
  update(false);
  return {
    open,
    update,
    contextChanged() {
      update();
    },
    prepare,
    destroy() {
      destroyed = true;
      generation++;
      dialog.remove();
      openButton.remove();
    },
  };
}
