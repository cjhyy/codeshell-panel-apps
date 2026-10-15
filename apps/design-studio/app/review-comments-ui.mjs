import {
  createReviewCommentsStore,
  MAX_REVIEW_COMMENT_TEXT,
  reviewCommentsPath,
  reviewDraftKey,
  reviewScopeKey,
} from "./review-comments.mjs";

function element(tag, className, text) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
}
function button(text, className = "button") {
  const value = element("button", className, text);
  value.type = "button";
  return value;
}

export function mountReviewComments({ getSnapshot, call, focusTarget, notify = () => {} }) {
  if (!document.querySelector("link[data-review-comments-style]")) {
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = new URL("./review-comments.css", import.meta.url).href;
    style.dataset.reviewCommentsStyle = "";
    document.head.append(style);
  }
  const openButton = button("讨论");
  openButton.id = "open-review-comments";
  openButton.title = "查看与保存设计评审评论";
  const toolbar = document.querySelector(".top-actions");
  toolbar?.insertBefore(openButton, toolbar.querySelector("#portable-backup-open, #open-ai"));
  const compactButton = button("设计讨论与评论", "");
  compactButton.dataset.toolbarAction = "open-review-comments";
  document.querySelector(".compact-actions-list")?.append(compactButton);

  const dialog = element("dialog", "review-comments-dialog");
  dialog.id = "review-comments-dialog";
  dialog.setAttribute("aria-labelledby", "review-comments-title");
  const card = element("div", "dialog-card review-comments-card");
  const header = element("header", "review-comments-header"),
    heading = element("div");
  heading.append(element("span", "dialog-kicker", "DESIGN REVIEW"));
  const title = element("h2", "", "设计讨论");
  title.id = "review-comments-title";
  heading.append(title);
  const close = button("×", "dialog-close");
  close.setAttribute("aria-label", "关闭设计讨论");
  header.append(heading, close);
  const description = element(
    "p",
    "dialog-description",
    "把问题关联到页面或图层，回复并标记解决。评论保存在项目的独立 JSON 文件中。",
  );
  const storage = element("p", "review-comments-storage");
  storage.id = "review-comments-storage";
  const status = element("p", "review-comments-status");
  status.id = "review-comments-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const controls = element("div", "review-comments-controls");
  const filterLabel = element("label", "", "显示");
  const filter = element("select");
  filter.id = "review-comments-filter";
  for (const [value, label] of [
    ["open", "待解决"],
    ["all", "全部讨论"],
    ["resolved", "已解决"],
  ]) {
    const option = element("option", "", label);
    option.value = value;
    filter.append(option);
  }
  filterLabel.append(filter);
  const refreshButton = button("刷新");
  refreshButton.id = "review-comments-refresh";
  controls.append(filterLabel, refreshButton);
  const list = element("div", "review-comments-list");
  list.id = "review-comments-list";
  const composer = element("form", "review-comments-composer");
  const target = element("p", "review-comments-target");
  target.id = "review-comments-target";
  const targetActions = element("div", "review-comments-target-actions");
  const selectionButton = button("关联当前选择"),
    pageButton = button("页面讨论");
  selectionButton.id = "review-comments-use-selection";
  pageButton.id = "review-comments-use-page";
  targetActions.append(selectionButton, pageButton);
  const inputLabel = element("label", "", "新讨论");
  const input = element("textarea");
  input.id = "review-comments-text";
  input.rows = 3;
  input.maxLength = MAX_REVIEW_COMMENT_TEXT;
  input.placeholder = "写下设计问题或修改建议…";
  inputLabel.append(input);
  const submit = button("保存评论", "primary-button");
  submit.type = "submit";
  submit.id = "review-comments-submit";
  const footer = element("div", "review-comments-composer-footer");
  footer.append(element("span", "", "仅保存到当前项目，未同步到 Figma"), submit);
  composer.append(target, targetActions, inputLabel, footer);
  card.append(header, description, storage, status, controls, list, composer);
  dialog.append(card);
  document.body.append(dialog);

  const drafts = new Map();
  let scopeKey = null,
    draftKey = null,
    generation = 0,
    loaded = null,
    busy = false,
    wasReady = false,
    destroyed = false;
  const store = createReviewCommentsStore({
    getSnapshot,
    call,
    getOperationEpoch: () => generation,
  });
  function currentDraft() {
    if (!drafts.has(draftKey)) drafts.set(draftKey, { text: "", target: null, replies: new Map() });
    return drafts.get(draftKey);
  }
  function selectedTarget(snapshot, pageOnly = false) {
    return {
      pageId: snapshot.pageId,
      nodeId: pageOnly ? null : (snapshot.selectedNode?.id ?? null),
      targetName: (!pageOnly && snapshot.selectedNode?.name) || snapshot.pageName || "当前页面",
    };
  }
  function stateText(text, kind = "") {
    status.textContent = text;
    status.dataset.kind = kind;
  }
  function usable() {
    const snapshot = getSnapshot();
    try {
      reviewCommentsPath(snapshot.path);
    } catch {
      return false;
    }
    return snapshot.ready !== false && (snapshot.context ?? snapshot).trusted !== false;
  }
  function renderTarget() {
    const value = currentDraft().target;
    target.textContent = value
      ? `${value.nodeId ? "图层" : "页面"}：${value.targetName} · ${value.nodeId ?? value.pageId}`
      : "选择一个页面或图层来发起讨论";
  }
  function renderAvailability() {
    const available = usable();
    openButton.disabled = !available;
    compactButton.disabled = !available;
    refreshButton.disabled = busy || !available;
    submit.disabled =
      busy || !available || !loaded || !currentDraft().target || !input.value.trim();
    selectionButton.disabled = busy || !available;
    pageButton.disabled = busy || !available;
    for (const control of list.querySelectorAll("button, textarea"))
      control.disabled = busy || !available;
    input.disabled = busy || !available;
    dialog.setAttribute("aria-busy", String(busy));
  }
  function renderList() {
    const threads = loaded?.threads ?? [],
      values = threads.filter((thread) => filter.value === "all" || thread.status === filter.value);
    const openCount = threads.filter((thread) => thread.status === "open").length;
    openButton.textContent = openCount ? `讨论 ${openCount}` : "讨论";
    list.replaceChildren();
    if (!values.length)
      list.append(
        element(
          "p",
          "review-comments-empty",
          loaded ? "当前筛选没有讨论。可在下方记录第一个问题。" : "评论尚未加载。",
        ),
      );
    for (const thread of values) {
      const item = element("article", "review-comment-thread");
      item.dataset.threadId = thread.id;
      item.dataset.status = thread.status;
      const itemHeader = element("div", "review-comment-thread-header");
      const location = button(
        `${thread.nodeId ? "图层" : "页面"} · ${thread.targetName || thread.nodeId || thread.pageId}`,
        "review-comment-location",
      );
      location.title = `${thread.pageId} / ${thread.nodeId ?? "页面"}`;
      location.dataset.reviewTarget = thread.id;
      const badge = element(
        "span",
        "review-comment-badge",
        thread.status === "resolved" ? "已解决" : "待解决",
      );
      itemHeader.append(location, badge);
      item.append(itemHeader);
      const appendMessage = (message, reply = false) => {
        const body = element(
          "div",
          reply ? "review-comment-message review-comment-reply" : "review-comment-message",
        );
        body.append(
          element(
            "p",
            "review-comment-meta",
            `${message.author} · ${new Date(message.createdAt).toLocaleString()}`,
          ),
          element("p", "review-comment-text", message.text),
        );
        item.append(body);
      };
      appendMessage(thread);
      for (const reply of thread.replies) appendMessage(reply, true);
      const replyForm = element("form", "review-comment-reply-form");
      const replyInput = element("textarea");
      replyInput.rows = 2;
      replyInput.maxLength = MAX_REVIEW_COMMENT_TEXT;
      replyInput.placeholder = "回复这条讨论…";
      replyInput.setAttribute("aria-label", "回复讨论");
      replyInput.dataset.replyThread = thread.id;
      replyInput.value = currentDraft().replies.get(thread.id) ?? "";
      replyInput.addEventListener("input", () =>
        currentDraft().replies.set(thread.id, replyInput.value),
      );
      const replyActions = element("div", "review-comment-actions");
      const resolve = button(thread.status === "resolved" ? "重新打开" : "标记解决");
      resolve.dataset.resolveThread = thread.id;
      const send = button("回复");
      send.type = "submit";
      replyActions.append(resolve, send);
      replyForm.append(replyInput, replyActions);
      item.append(replyForm);
      list.append(item);
      location.addEventListener("click", async () => {
        const expected = scopeKey;
        try {
          if (reviewScopeKey(getSnapshot()) !== expected) return;
          const found = await focusTarget({ pageId: thread.pageId, nodeId: thread.nodeId });
          if (reviewScopeKey(getSnapshot()) !== expected) return;
          if (found === false) throw Error("关联的页面或图层已移除；评论记录仍保留");
          dialog.close();
        } catch (error) {
          if (reviewScopeKey(getSnapshot()) === expected) {
            stateText(error.message, "error");
            notify(error.message, "error");
          }
        }
      });
      resolve.addEventListener(
        "click",
        () => void run(() => store.setResolved(thread.id, thread.status !== "resolved")),
      );
      replyForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const text = replyInput.value.trim();
        if (!text) return;
        const draft = currentDraft();
        void run(
          () => store.reply(thread.id, text),
          () => draft.replies.delete(thread.id),
        );
      });
    }
    renderAvailability();
  }

  async function run(action, committed) {
    if (reviewScopeKey(getSnapshot()) !== scopeKey) {
      update();
      stateText("设计已切换，请在当前设计中重新提交；原草稿已保留。", "error");
      return;
    }
    if (busy || !usable()) return;
    const ticket = generation,
      expected = scopeKey;
    busy = true;
    stateText("正在保存评论…");
    renderAvailability();
    try {
      const result = await action();
      if (
        destroyed ||
        generation !== ticket ||
        scopeKey !== expected ||
        reviewScopeKey(getSnapshot()) !== expected
      )
        return;
      committed?.();
      loaded = result.document;
      input.value = currentDraft().text;
      stateText("评论已保存到项目文件。", "saved");
      renderList();
    } catch (error) {
      if (!destroyed && generation === ticket && reviewScopeKey(getSnapshot()) === expected)
        stateText(`${error.message}；评论草稿已保留。`, "error");
    } finally {
      if (!destroyed && generation === ticket && scopeKey === expected) {
        busy = false;
        renderAvailability();
      }
    }
  }

  async function refresh() {
    update(false);
    if (busy || !usable()) return;
    const ticket = generation,
      expected = scopeKey;
    busy = true;
    stateText("正在读取项目评论…");
    renderAvailability();
    try {
      const result = await store.refresh();
      if (destroyed || ticket !== generation || reviewScopeKey(getSnapshot()) !== expected) return;
      loaded = result.document;
      stateText(`${loaded.threads.length} 条讨论 · ${result.path}`);
      renderList();
    } catch (error) {
      if (!destroyed && ticket === generation && reviewScopeKey(getSnapshot()) === expected) {
        loaded = null;
        stateText(error.message, "error");
        renderList();
      }
    } finally {
      if (!destroyed && ticket === generation) {
        busy = false;
        renderAvailability();
      }
    }
  }

  function update(autoRefresh = true) {
    if (destroyed) return;
    const snapshot = getSnapshot(),
      nextScope = reviewScopeKey(snapshot),
      ready = usable();
    const changed = scopeKey !== nextScope;
    if (changed) {
      generation++;
      scopeKey = nextScope;
      draftKey = reviewDraftKey(snapshot);
      busy = false;
      loaded = null;
      const draft = currentDraft();
      draft.target ??= selectedTarget(snapshot);
      input.value = draft.text;
      try {
        storage.textContent = reviewCommentsPath(snapshot.path);
      } catch (error) {
        storage.textContent = error.message;
      }
      stateText("打开或刷新以读取当前设计的讨论。");
      renderTarget();
      renderList();
    }
    const becameReady = ready && !wasReady;
    wasReady = ready;
    renderAvailability();
    if (autoRefresh && dialog.open && ready && (changed || becameReady)) void refresh();
  }

  function open(options = {}) {
    update(false);
    if (!usable()) return;
    const snapshot = getSnapshot(),
      draft = currentDraft();
    // A reopened empty composer follows the current selection. Typed drafts
    // remain attached to the original stable target until explicitly changed.
    if (
      !draft.text ||
      options.nodeId !== undefined ||
      options.pageId !== undefined ||
      options.text !== undefined
    ) {
      const pageId = options.pageId ?? snapshot.pageId;
      const nodeId =
        options.nodeId === undefined ? (snapshot.selectedNode?.id ?? null) : options.nodeId;
      draft.target = {
        pageId,
        nodeId,
        targetName:
          nodeId === snapshot.selectedNode?.id
            ? snapshot.selectedNode?.name || nodeId
            : nodeId || snapshot.pageName || "页面",
      };
    }
    if (options.text !== undefined) {
      const text = String(options.text);
      draft.text = draft.text && draft.text !== text ? `${draft.text}\n\n${text}` : text;
    }
    input.value = draft.text;
    renderTarget();
    renderAvailability();
    if (!dialog.open) dialog.showModal();
    document.querySelector("#compact-actions")?.removeAttribute("open");
    void refresh();
    input.focus();
  }

  openButton.addEventListener("click", () => open());
  close.addEventListener("click", () => dialog.close());
  refreshButton.addEventListener("click", () => void refresh());
  filter.addEventListener("change", renderList);
  input.addEventListener("input", () => {
    currentDraft().text = input.value;
    renderAvailability();
  });
  selectionButton.addEventListener("click", () => {
    currentDraft().target = selectedTarget(getSnapshot());
    renderTarget();
  });
  pageButton.addEventListener("click", () => {
    currentDraft().target = selectedTarget(getSnapshot(), true);
    renderTarget();
  });
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const draft = currentDraft(),
      text = input.value.trim();
    if (!draft.target || !text) return;
    void run(
      () => store.addThread({ ...draft.target, text }),
      () => {
        draft.text = "";
      },
    );
  });
  update(false);
  return {
    update,
    refresh,
    open,
    contextChanged() {
      generation++;
      scopeKey = null;
      loaded = null;
      busy = false;
      wasReady = false;
      list.replaceChildren();
      openButton.textContent = "讨论";
      stateText("项目已切换，旧操作已停止。草稿会在返回原设计时恢复。");
    },
    destroy() {
      destroyed = true;
      generation++;
      dialog.remove();
      openButton.remove();
      compactButton.remove();
    },
  };
}
