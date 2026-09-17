import { buildDecisionFacts, buildReviewTimeline, resolveNoteLinks } from "../notes.mjs";
import { NotesStoreConflictError, commitNoteChange, loadNotes } from "../notes-store.mjs";

function appendText(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(text ?? "");
  parent.append(node);
  return node;
}

function linkLabel(link) {
  if (link.type === "instrument") return `标的 ${link.symbol} · ${link.market === "cn" ? "A 股" : "美股"}`;
  if (link.type === "transaction") return `交易 ${link.transactionId}`;
  if (link.type === "news") return `资讯 ${link.newsItemId}`;
  return `规则 ${link.ruleId} · 数据时点 ${link.evidenceAsOf}`;
}

const LINK_STATUS_LABELS = {
  current: "关联有效",
  changed: "关联内容有更新",
  orphan: "原关联已不存在",
};

const TIMELINE_TYPE_LABELS = {
  note: "笔记",
  transaction: "交易",
  news: "资讯",
  rule: "规则",
  holding: "持仓快照",
};

function sourceLabel(source) {
  const value = String(source ?? "");
  if (value.includes("journal.json")) return "本地笔记";
  if (value.includes("transactions.json")) return "交易记录";
  if (value.includes("holdings.json")) return "持仓快照";
  if (value.includes("news/feed.json")) return "资讯信息流";
  if (value.includes("portfolio-rules")) return "持仓规则";
  return value || "未知";
}

function recordSummary(item, ctx) {
  if (item.type === "note") return `${item.record.title} · ${item.record.body}`.slice(0, 300);
  if (item.type === "transaction") {
    const instrument = (ctx.ledger?.instruments ?? []).find((entry) => entry.id === item.record.instrumentId);
    const type = item.record.type === "buy" ? "买入" : item.record.type === "sell" ? "卖出" : "交易";
    return `${type} · ${instrument?.symbol ?? item.record.instrumentId ?? item.record.currency ?? "—"} · ${item.record.id}`;
  }
  if (item.type === "news") return `外部资讯标题 · ${item.record.title ?? "—"}`;
  if (item.type === "rule") return `${item.record.condition ?? item.record.name ?? item.record.id} · 当前结果 ${JSON.stringify(item.record.actual ?? null)}`;
  return `持仓快照 · ${(item.record.positionsByAccount ?? []).length} 个持仓`;
}

export function createNotesController({
  hostCall,
  root,
  currentEpoch,
  context,
  now = () => new Date(),
  onChange = () => {},
  resolveAShare = () => ({ ok: false }),
}) {
  const byId = (id) => root.querySelector(`#${id}`);
  const elements = {
    live: byId("notes-live"), newButton: byId("notes-new"), form: byId("notes-form"), editId: byId("notes-edit-id"),
    title: byId("notes-title"), body: byId("notes-body"), tags: byId("notes-tags"), draftLinks: byId("notes-draft-links"),
    error: byId("notes-form-error"), save: byId("notes-save"), cancel: byId("notes-cancel"), count: byId("notes-count"),
    empty: byId("notes-empty"), list: byId("notes-list"), timeline: byId("notes-timeline"),
    filterInstrument: byId("notes-filter-instrument"), filterTag: byId("notes-filter-tag"), filterLink: byId("notes-filter-link"),
  };
  const state = { file: null, document: null, draftLinks: [], saving: false, readError: null };
  const sourceContext = () => context?.() ?? {};
  const setLive = (text, tone = "idle") => { elements.live.textContent = text; elements.live.dataset.tone = tone; };
  const setError = (text = "") => { elements.error.textContent = text; };

  function facts() {
    if (!state.document) return { status: "unavailable", reason: state.readError ? "notes-read-failed" : "notes-not-created", source: "portfolio/journal.json" };
    return buildDecisionFacts(state.document.entries, sourceContext().ledger?.transactions ?? [], now());
  }

  function renderDraftLinks() {
    elements.draftLinks.replaceChildren();
    if (!state.draftLinks.length) appendText(elements.draftLinks, "span", "无关联；可从持仓、交易、资讯或规则卡预填。", "notes-link-empty");
    for (const link of state.draftLinks) {
      const chip = document.createElement("span");
      chip.className = "notes-link-chip";
      if (link.type === "news") chip.title = `资讯指纹 ${link.fingerprint}`;
      appendText(chip, "span", linkLabel(link));
      const remove = appendText(chip, "button", "移除");
      remove.type = "button";
      remove.setAttribute("aria-label", `移除关联 ${linkLabel(link)}`);
      remove.addEventListener("click", () => {
        const target = JSON.stringify(link);
        state.draftLinks = state.draftLinks.filter((item) => JSON.stringify(item) !== target);
        renderDraftLinks();
      });
      elements.draftLinks.append(chip);
    }
  }

  function openForm(link = null, note = null) {
    elements.form.hidden = false;
    elements.editId.value = note?.id ?? "";
    elements.title.value = note?.title ?? "";
    elements.body.value = note?.body ?? "";
    elements.tags.value = note?.tags.join(", ") ?? "";
    state.draftLinks = note ? structuredClone(note.links) : link ? [structuredClone(link)] : [];
    setError();
    renderDraftLinks();
    queueMicrotask(() => elements.title.focus());
  }

  function closeForm() {
    elements.form.hidden = true;
    elements.editId.value = "";
    state.draftLinks = [];
    setError();
  }

  function filteredEntries() {
    const instrumentInput = elements.filterInstrument.value.trim();
    const instrument = instrumentInput.toLocaleUpperCase("zh-CN");
    const resolved = resolveAShare(instrumentInput);
    const resolvedSymbol = resolved?.ok ? resolved.symbol : "";
    const ledgerInstruments = sourceContext().ledger?.instruments ?? [];
    const matchesInstrument = (note) => note.links.some((link) => {
      if (link.type !== "instrument") return false;
      const current = ledgerInstruments.find((item) => item.symbol === link.symbol);
      return [link.symbol, current?.name, current?.id]
        .filter(Boolean)
        .some((value) => {
          const normalized = String(value).toLocaleUpperCase("zh-CN");
          return normalized.includes(instrument) || (resolvedSymbol && normalized === resolvedSymbol);
        });
    });
    const tag = elements.filterTag.value.trim();
    const type = elements.filterLink.value;
    return (state.document?.entries ?? []).filter((note) =>
      (!instrument || matchesInstrument(note)) &&
      (!tag || note.tags.includes(tag)) &&
      (type === "all" || note.links.some((link) => link.type === type)));
  }

  function renderList() {
    elements.list.replaceChildren();
    const entries = filteredEntries().slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
    const completeness = state.document ? facts() : null;
    elements.count.textContent = completeness
      ? `${entries.length} 条 · ${completeness.linkedTransactions} 笔交易有笔记 / ${completeness.unlinkedTransactions} 笔无关联笔记`
      : `${entries.length} 条`;
    elements.empty.hidden = entries.length > 0;
    for (const note of entries) {
      const resolved = resolveNoteLinks(note, sourceContext());
      const card = document.createElement("article");
      card.className = "note-card";
      card.dataset.noteId = note.id;
      card.dataset.linkState = resolved.status;
      const header = document.createElement("header");
      const identity = document.createElement("div");
      appendText(identity, "h3", note.title);
      const updated = appendText(identity, "small", `更新于 ${note.updatedAt}`);
      updated.title = `笔记标识 ${note.id} · 版本 ${note.revision}`;
      header.append(identity);
      appendText(header, "span", LINK_STATUS_LABELS[resolved.status] ?? resolved.status, "note-link-state");
      card.append(header);
      appendText(card, "pre", note.body, "note-body");
      const tags = document.createElement("div");
      for (const tag of note.tags) appendText(tags, "span", `#${tag}`, "note-tag");
      card.append(tags);
      const linkList = document.createElement("div");
      linkList.className = "notes-link-list";
      for (const item of resolved.links) {
        let comparison = "";
        if (item.link.type === "news") comparison = item.status === "changed" ? " · 已保存内容与当前内容不同" : "";
        else if (item.link.type === "rule") comparison = ` · 当前数据时点 ${item.current?.asOf ?? "未找到"}`;
        else if (item.link.type === "instrument") comparison = ` · 当前 ${item.current ? `${item.current.symbol} / ${item.current.name ?? item.current.id}` : "未找到"}`;
        else comparison = ` · 当前 ${item.current ? `${item.current.type ?? "交易"} / ${item.current.id}` : "未找到"}`;
        const resolvedLink = appendText(
          linkList,
          "span",
          `${LINK_STATUS_LABELS[item.status] ?? item.status} · ${linkLabel(item.link)}${comparison}`,
          "notes-resolved-link",
        );
        if (item.link.type === "news") {
          resolvedLink.title = `保存指纹 ${item.link.fingerprint} · 当前指纹 ${item.current?.fingerprint ?? "missing"}`;
        }
      }
      card.append(linkList);
      const actions = document.createElement("div");
      actions.className = "note-actions";
      const edit = appendText(actions, "button", "编辑", "ghost-button");
      edit.type = "button";
      edit.addEventListener("click", () => openForm(null, note));
      const remove = appendText(actions, "button", "删除", "ghost-button");
      remove.type = "button";
      remove.addEventListener("click", () => void removeNote(note));
      card.append(actions);
      elements.list.append(card);
    }
  }

  function renderTimeline() {
    elements.timeline.replaceChildren();
    const ctx = sourceContext();
    const timeline = buildReviewTimeline({ notes: state.document?.entries ?? [], ...ctx });
    if (!timeline.length) {
      appendText(elements.timeline, "p", "暂无可陈列的时间线记录。", "portfolio-empty-line");
      return;
    }
    for (const item of timeline) {
      const row = document.createElement("article");
      row.className = "notes-timeline-item";
      row.dataset.type = item.type;
      row.dataset.linkState = item.currentStatus;
      appendText(row, "b", `${TIMELINE_TYPE_LABELS[item.type] ?? item.type} · ${item.id}`);
      appendText(row, "p", `当时记录 · ${recordSummary(item, ctx)}`);
      const source = appendText(
        row,
        "span",
        `时间 ${item.occurredAt ?? "未知"} · 来源 ${sourceLabel(item.source)}`,
      );
      source.title = String(item.source ?? "");
      appendText(row, "span", `当前状态 ${LINK_STATUS_LABELS[item.currentStatus] ?? item.currentStatus} · 关联笔记 ${item.noteIds.length}`);
      elements.timeline.append(row);
    }
  }

  function render() { renderList(); renderTimeline(); }

  function draft() {
    const tags = elements.tags.value.split(/[,，]/u).map((item) => item.trim()).filter(Boolean);
    return { title: elements.title.value, body: elements.body.value, tags: [...new Set(tags)], links: structuredClone(state.draftLinks) };
  }

  async function save(event) {
    event.preventDefault();
    if (state.saving) return;
    state.saving = true;
    elements.save.disabled = true;
    const expectedEpoch = currentEpoch();
    const value = draft();
    try {
      const existing = state.document?.entries.find((note) => note.id === elements.editId.value);
      const change = existing ? { type: "update", id: existing.id, expectedRevision: existing.revision, draft: value } : { type: "create", draft: value };
      const result = await commitNoteChange(hostCall, change, { baseFile: state.file, expectedEpoch, currentEpoch, now: now().toISOString() });
      if (currentEpoch() !== expectedEpoch) return;
      state.file = result.file;
      state.document = result.document;
      state.readError = null;
      closeForm();
      render();
      setLive("笔记已保存并重新读取核对。", "success");
      onChange(facts());
      elements.newButton.focus();
    } catch (error) {
      if (currentEpoch() !== expectedEpoch) return;
      if (error instanceof NotesStoreConflictError) {
        // Re-sync the file baseline so the user's next explicit confirmation can succeed;
        // the form and draft links stay untouched, nothing is written here.
        const resynced = await resyncAfterConflict(expectedEpoch);
        if (currentEpoch() !== expectedEpoch) return;
        setError(
          `冲突：草稿已冻结并保留。${error.message}${
            resynced ? " 已重新读取最新文件并刷新列表；核对后再次确认保存将以当前草稿写入。" : " 重新读取失败，草稿仍保留，请稍后重试。"
          }`,
        );
      } else {
        setError(`保存失败：${error instanceof Error ? error.message : "未知错误"}`);
      }
      elements.error.focus();
    } finally {
      state.saving = false;
      elements.save.disabled = false;
    }
  }

  async function resyncAfterConflict(expectedEpoch) {
    try {
      const result = await loadNotes(hostCall, { expectedEpoch, currentEpoch });
      if (currentEpoch() !== expectedEpoch) return false;
      state.file = result.file;
      state.document = result.document;
      state.readError = null;
      render();
      onChange(facts());
      return true;
    } catch (error) {
      if (currentEpoch() === expectedEpoch) state.readError = error instanceof Error ? error.message : "notes read failed";
      return false;
    }
  }

  async function removeNote(note) {
    if (!window.confirm(`确认删除笔记 ${note.title}？关联对象不会被删除。`)) return;
    const expectedEpoch = currentEpoch();
    try {
      const result = await commitNoteChange(hostCall, { type: "delete", id: note.id, expectedRevision: note.revision }, { baseFile: state.file, expectedEpoch, currentEpoch, now: now().toISOString() });
      if (currentEpoch() !== expectedEpoch) return;
      state.file = result.file;
      state.document = result.document;
      render();
      setLive("笔记已删除；关联对象未级联删除。", "success");
      onChange(facts());
    } catch (error) {
      setLive(error instanceof NotesStoreConflictError ? "删除冲突；未改写文件。" : error.message, "error");
    }
  }

  async function load(expectedEpoch = currentEpoch()) {
    reset();
    setLive("正在读取本地笔记…");
    try {
      const result = await loadNotes(hostCall, { expectedEpoch, currentEpoch });
      if (expectedEpoch !== currentEpoch()) return;
      state.file = result.file;
      state.document = result.document;
      setLive(
        result.document
          ? `已读取 ${result.document.entries.length} 条笔记。`
          : "还没有笔记；保存第一条后会在当前项目建立本地笔记文件。",
      );
      render();
      onChange(facts());
    } catch (error) {
      if (expectedEpoch !== currentEpoch()) return;
      state.readError = error instanceof Error ? error.message : "notes read failed";
      setLive(`笔记读取失败；已冻结写入：${state.readError}`, "error");
      onChange(facts());
    }
  }

  function reset() {
    state.file = null;
    state.document = null;
    state.draftLinks = [];
    state.saving = false;
    state.readError = null;
    closeForm();
    elements.list.replaceChildren();
    elements.timeline.replaceChildren();
    elements.count.textContent = "0 条";
  }

  elements.newButton.addEventListener("click", () => openForm());
  elements.cancel.addEventListener("click", closeForm);
  elements.form.addEventListener("submit", (event) => void save(event));
  for (const control of [elements.filterInstrument, elements.filterTag, elements.filterLink]) control.addEventListener("input", renderList);
  return { load, reset, render, facts, prefill(link) { openForm(link); }, state };
}
