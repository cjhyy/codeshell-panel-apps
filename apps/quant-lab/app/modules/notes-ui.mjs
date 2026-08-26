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
  if (link.type === "instrument") return `标的 ${link.symbol} · ${link.market}`;
  if (link.type === "transaction") return `交易 ${link.transactionId}`;
  if (link.type === "news") return `资讯 ${link.newsItemId} · ${link.fingerprint}`;
  return `规则 ${link.ruleId} · evidence ${link.evidenceAsOf}`;
}

function recordSummary(item, ctx) {
  if (item.type === "note") return `${item.record.title} · ${item.record.body}`.slice(0, 300);
  if (item.type === "transaction") {
    const instrument = (ctx.ledger?.instruments ?? []).find((entry) => entry.id === item.record.instrumentId);
    return `${item.record.type ?? "transaction"} · ${instrument?.symbol ?? item.record.instrumentId ?? item.record.currency ?? "—"} · ${item.record.id}`;
  }
  if (item.type === "news") return `external/untrusted title · ${item.record.title ?? "—"}`;
  if (item.type === "rule") return `${item.record.condition ?? item.record.name ?? item.record.id} · actual ${JSON.stringify(item.record.actual ?? null)}`;
  return `derived holding snapshot · positions ${(item.record.positionsByAccount ?? []).length}`;
}

export function createNotesController({ hostCall, root, currentEpoch, context, now = () => new Date(), onChange = () => {} }) {
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
    const instrument = elements.filterInstrument.value.trim().toUpperCase();
    const tag = elements.filterTag.value.trim();
    const type = elements.filterLink.value;
    return (state.document?.entries ?? []).filter((note) =>
      (!instrument || note.links.some((link) => link.type === "instrument" && link.symbol.includes(instrument))) &&
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
      appendText(identity, "small", `${note.id} · revision ${note.revision} · ${note.updatedAt}`);
      header.append(identity);
      appendText(header, "span", resolved.status, "note-link-state");
      card.append(header);
      appendText(card, "pre", note.body, "note-body");
      const tags = document.createElement("div");
      for (const tag of note.tags) appendText(tags, "span", `#${tag}`, "note-tag");
      card.append(tags);
      const linkList = document.createElement("div");
      linkList.className = "notes-link-list";
      for (const item of resolved.links) {
        let comparison = "";
        if (item.link.type === "news") comparison = ` · saved fingerprint ${item.link.fingerprint} → current fingerprint ${item.current?.fingerprint ?? "missing"}${item.current?.title ? ` · external/untrusted: ${item.current.title}` : ""}`;
        else if (item.link.type === "rule") comparison = ` · saved asOf ${item.link.evidenceAsOf} → current asOf ${item.current?.asOf ?? "missing"}`;
        else if (item.link.type === "instrument") comparison = ` · current ${item.current ? `${item.current.symbol} / ${item.current.name ?? item.current.id}` : "missing"}`;
        else comparison = ` · current ${item.current ? `${item.current.type ?? "transaction"} / ${item.current.id}` : "missing"}`;
        appendText(linkList, "span", `${item.status} · ${linkLabel(item.link)}${comparison}`, "notes-resolved-link");
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
      appendText(row, "b", `${item.type} · ${item.id}`);
      appendText(row, "p", `当时记录 · ${recordSummary(item, ctx)}`);
      appendText(row, "span", `${item.occurredAt ?? "time unavailable"} · ${item.source}`);
      appendText(row, "span", `current ${item.currentStatus} · 关联笔记 ${item.noteIds.length}`);
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
      setLive("笔记已条件写入并重新读取核对。", "success");
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
        setError(`保存失败：${error instanceof Error ? error.message : "unknown"}`);
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
    setLive("正在读取 portfolio/journal.json…");
    try {
      const result = await loadNotes(hostCall, { expectedEpoch, currentEpoch });
      if (expectedEpoch !== currentEpoch()) return;
      state.file = result.file;
      state.document = result.document;
      setLive(result.document ? `已读取 ${result.document.entries.length} 条笔记。` : "尚无 portfolio/journal.json；首次确认保存将 create-only 建立。");
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
