import { searchCareerLibrary } from "./career-library-model.mjs";
import { mountCareerLibraryVersions } from "./career-library-version-ui.mjs";

const COLLECTIONS = { sources: "sourceMaterials", episodes: "careerEpisodes", qa: "careerQa" };
const TITLES = { sources: "原始材料", episodes: "经历与决策", qa: "长期问答" };
const STATUS = { draft: "待确认", confirmed: "已确认", needs_review: "需复核", archived: "已归档" };
const CATEGORIES = { context: "背景", ownership: "本人职责", scope: "范围", decision: "决策与取舍", impact: "结果", collaboration: "协作", failure: "失败与复盘" };
const LIST_FIELDS = new Set(["actions", "alternatives", "tags"]);
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const options = (values, current) => Object.entries(values).map(([value, title]) => `<option value="${escape(value)}"${value === current ? " selected" : ""}>${escape(title)}</option>`).join("");
const label = (title, field, value, { multiline = false, max = 3000, placeholder = "" } = {}) => `<label>${title}${multiline
  ? `<textarea data-career-field="${field}" maxlength="${max}" placeholder="${escape(placeholder)}">${escape(Array.isArray(value) ? value.join("\n") : value)}</textarea>`
  : `<input data-career-field="${field}" maxlength="${max}" value="${escape(value)}" placeholder="${escape(placeholder)}" />`}</label>`;
const titleOf = (kind, record) => record.title || record.question || record.url || `${record.provider || "手动"}材料`;

export function mountCareerLibrary({ root, getState, getScopeKey, setDraft, mutate, reviewPending, requestAgent, openSource, versionActions }) {
  let scopeKey, kind = "sources", search = "", status = "active", cursor = 0, selectedId = "", editor = null, dirty = false, busy = false, draftStamp = "";
  root.innerHTML = `<header class="career-heading"><h1>经历与问答库</h1></header><div id="career-session-workspace"></div>
    <div class="career-stats" id="career-stats"></div>
    <div class="career-toolbar"><div class="career-tabs" aria-label="经历库分类">${Object.entries(TITLES).map(([key, title]) => `<button type="button" data-career-kind="${key}" aria-pressed="false">${title}</button>`).join("")}</div><input id="career-search" type="search" maxlength="200" aria-label="搜索材料、经历与问答" placeholder="搜索项目、决策、关键词…" /><select id="career-filter" aria-label="核验状态">${options({ active: "未归档", draft: "待确认", confirmed: "已确认", needs_review: "来源已更新", archived: "已归档", all: "全部" }, status)}</select><button class="button button-primary" id="career-add" type="button">＋ 添加材料</button></div>
    <p class="career-library-message" id="career-message" role="status" aria-live="polite"></p>
    <div class="career-layout"><div><div class="career-list" id="career-list"></div><div class="career-pagination" id="career-pagination"></div></div><section class="career-editor" id="career-editor" aria-label="经历库详情"></section></div>`;
  const el = id => root.querySelector(`#career-${id}`);
  function message(text, error = false) { el("message").textContent = text; el("message").dataset.error = String(error); }
  function records() { return getState()[COLLECTIONS[kind]] || []; }
  function keepDraft() {
    if (!editor) return;
    draftStamp = new Date().toISOString();
    setDraft({ kind, id: selectedId, record: structuredClone(editor), dirty, updatedAt: draftStamp });
  }
  function selectRecord(record, nextKind = kind, newRecord = false) {
    kind = nextKind; cursor = 0; selectedId = newRecord ? "" : record?.id || "";
    editor = structuredClone(record || {}); dirty = newRecord;
    keepDraft(); renderEditor(); renderList(); renderToolbar();
    el("editor").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function renderToolbar() {
    root.querySelectorAll("[data-career-kind]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.careerKind === kind)));
    el("add").textContent = `＋ ${kind === "sources" ? "添加材料" : kind === "episodes" ? "记录经历" : "添加问答"}`;
  }
  function renderList() {
    const result = searchCareerLibrary(getState(), { kind, search, status, cursor, limit: 12 });
    el("list").innerHTML = result.items.length ? result.items.map(record => `<button type="button" class="career-card" data-career-record="${escape(record.id)}" aria-current="${record.id === selectedId}"><span class="career-status" data-status="${escape(record.status)}">${STATUS[record.status] || "待确认"}${record.pendingRevision ? " · 有待审修订" : ""}</span><strong>${escape(titleOf(kind, record))}</strong><p>${escape(String(record.reason || record.answer || record.excerpt || record.background || "还可以继续补充。").slice(0, 110))}</p><small>${escape(record.project || record.provider || CATEGORIES[record.category] || "经历问答")} · v${record.version || 1}</small></button>`).join("")
      : `<div class="career-empty"><h2>${search ? "没有找到匹配内容" : `还没有${TITLES[kind]}`}</h2><p>${kind === "sources" ? "在当前聊天贴 Slack / GitHub 链接，让 Agent 读取并整理；材料会写回这里。也可以手动补充。" : kind === "episodes" ? "和 Agent 聊清楚你做了什么、为什么这样选，经历会从聊天沉淀到这里。" : "在聊天中回答当时的选择、原因和复盘。事实原话与表达草稿会分别保存。"}</p></div>`;
    el("pagination").innerHTML = `<button type="button" class="button button-quiet" data-career-page="prev" ${cursor === 0 ? "disabled" : ""}>上一页</button><span>${result.total} 条 · 第 ${Math.floor(cursor / 12) + 1} 页</span><button type="button" class="button button-quiet" data-career-page="next" ${result.nextCursor == null ? "disabled" : ""}>下一页</button>`;
  }
  function sourcePicker() {
    const materials = getState().sourceMaterials || [], picked = new Set(editor.sourceIds || []);
    return `<label>关联原始材料</label><div class="career-source-picker">${materials.length ? materials.map(source => `<label><input type="checkbox" data-career-source="${escape(source.id)}" ${picked.has(source.id) ? "checked" : ""} />${escape(titleOf("sources", source))} · ${STATUS[source.status] || "待确认"}</label>`).join("") : "先添加材料，或填写自己的真实记忆。"}</div>`;
  }
  function renderEditor() {
    if (!editor) {
      el("editor").innerHTML = `<div class="career-empty"><h2>聊天沉淀，随时回看。</h2><p>这里查看材料、经历和问答。你可以继续在当前 session 里补充，聊完保存一个知识库版本；也可以在这里修正单条内容。</p><p>保存知识库版本会保留未核实标记。需要写简历时，再选择并核实可公开的经历。</p></div>`;
      return;
    }
    const record = records().find(item => item.id === selectedId);
    let fields;
    if (kind === "sources") fields = `${label("材料标题", "title", editor.title, { max: 240, placeholder: "例如：缓存方案的 Slack 讨论" })}<div class="career-fields-row"><label>来源<select data-career-field="provider">${options({ manual: "本人记录", slack: "Slack", github: "GitHub", document: "文档", other: "其他" }, editor.provider || "manual")}</select></label>${label("作者 / 参与人", "author", editor.author, { max: 240 })}</div>${label("来源链接", "url", editor.url, { max: 2000, placeholder: "Slack permalink / GitHub repo、PR 或 commit" })}${label("原始内容 / 引用片段", "excerpt", editor.excerpt, { multiline: true, max: 16000, placeholder: "保留原话和上下文。只有链接时，保存后可让 Agent 读取。" })}<details><summary>来源定位与时间</summary><div class="career-form">${label("消息 / Commit 标识", "externalId", editor.externalId, { max: 240 })}${label("发生时间", "occurredAt", editor.occurredAt, { max: 80 })}${label("项目内文件位置", "localRef", editor.localRef, { max: 1000 })}</div></details>`;
    else if (kind === "episodes") fields = `${label("经历标题", "title", editor.title, { max: 240, placeholder: "例如：为什么将任务改为异步执行" })}${label("项目 / 任职", "project", editor.project, { max: 240 })}${label("背景", "background", editor.background, { multiline: true })}${label("要解决的问题", "problem", editor.problem, { multiline: true })}${label("我负责什么", "myRole", editor.myRole, { multiline: true, placeholder: "明确本人职责与团队工作的边界" })}${label("我的行动（每行一条）", "actions", editor.actions, { multiline: true })}${label("考虑过的方案（每行一条）", "alternatives", editor.alternatives, { multiline: true })}${label("最终选择", "decision", editor.decision, { multiline: true })}${label("为什么这样选", "reason", editor.reason, { multiline: true })}${label("取舍与代价", "tradeoffs", editor.tradeoffs, { multiline: true })}${label("结果 / 如何验证", "results", editor.results, { multiline: true, placeholder: "记录真实结果；不确定的指标保持不确定" })}${label("复盘：现在会怎么做", "retrospective", editor.retrospective, { multiline: true })}${label("标签（每行一个）", "tags", editor.tags, { multiline: true, max: 1000 })}${sourcePicker()}`;
    else fields = `<label>关联经历<select data-career-field="episodeId"><option value="">待归档 / 暂不关联</option>${(getState().careerEpisodes || []).map(episode => `<option value="${escape(episode.id)}" ${editor.episodeId === episode.id ? "selected" : ""}>${escape(episode.title)}</option>`).join("")}</select></label><label>问题类型<select data-career-field="category">${options(CATEGORIES, editor.category || "decision")}</select></label>${label("问题", "question", editor.question, { multiline: true, max: 1200, placeholder: "当时为什么没有选另一种方案？" })}${label("我的事实回答", "answer", editor.answer, { multiline: true, max: 10000, placeholder: "忠实记录你当时的想法、行动和结果" })}${label("表达草稿（可继续修改）", "draftAnswer", editor.draftAnswer, { multiline: true, max: 10000, placeholder: "AI 整理或面试表达版本，不会自动成为事实回答" })}${sourcePicker()}`;
    const pending = record?.pendingRevision;
    const history = record?.revisions || record?.history || [];
    el("editor").innerHTML = `<h2>${selectedId ? "查看与补充" : `新增${TITLES[kind]}`}</h2><p>${kind === "sources" ? "链接负责定位，原文负责追溯。仓库内容与本人的贡献需要分别核验。" : kind === "episodes" ? "把当时为什么这样做留下来，后续再派生简历要点与面试故事。" : "事实回答与表达草稿分开保存。练习得更顺畅，不会改变原始经历。"}</p>
      ${pending ? `<div class="career-notice"><strong>有一份待审修订，原已确认内容仍保留。</strong><details><summary>查看待审内容</summary><pre>${escape(JSON.stringify(pending.content, null, 2))}</pre></details><div class="career-actions"><button type="button" class="button button-primary" data-career-action="accept">采用并确认修订</button><button type="button" class="button button-quiet" data-career-action="reject">保留原文</button></div></div>` : ""}
      ${record?.status === "needs_review" ? '<div class="career-notice">关联来源发生了变化，请重新核对事实和本人职责。</div>' : ""}
      <form class="career-form" id="career-form">${fields}<div class="career-actions"><button type="submit" class="button button-quiet" data-career-action="save">保存待确认</button><button type="button" class="button button-primary" data-career-action="confirm">保存并确认事实</button><button type="button" class="button button-quiet" data-career-action="cancel">放弃当前草稿</button>${selectedId ? '<button type="button" class="button button-quiet" data-career-action="archive">归档</button>' : ""}</div></form>
      ${selectedId ? `<div class="career-actions">${kind === "sources" ? '<button type="button" class="button button-quiet" data-career-action="read">让 Agent 读取并整理</button><button type="button" class="button button-quiet" data-career-action="episode">从材料记录经历</button>' : kind === "episodes" ? '<button type="button" class="button button-quiet" data-career-action="question">添加经历问答</button><button type="button" class="button button-quiet" data-career-action="story">整理面试故事</button><button type="button" class="button button-quiet" data-career-action="resume">生成简历要点</button>' : '<button type="button" class="button button-quiet" data-career-action="polish">整理表达草稿</button>'}${kind === "sources" && record?.url ? '<button type="button" class="button button-quiet" data-career-action="open">打开原始来源</button>' : ""}</div>` : ""}
      <details class="career-history"><summary>修订记录（${history.length}） · ${record?.status ? STATUS[record.status] || record.status : "未保存"}</summary>${history.length ? history.slice().reverse().map(revision => `<details><summary>${escape(revision.at || revision.updatedAt || revision.createdAt || "历史修订")} · v${revision.version || ""}</summary><pre>${escape(JSON.stringify(revision, null, 2))}</pre></details>`).join("") : '<p>首次保存后，内容变更会保留修订。</p>'}</details>`;
    updateBusy();
  }
  function updateBusy() { el("editor").querySelectorAll("button, input, textarea, select").forEach(control => { control.disabled = busy; }); }
  async function action(name) {
    if (busy || !editor) return;
    const expectedScope = getScopeKey();
    busy = true; updateBusy();
    try {
      if (name === "cancel") { editor = null; selectedId = ""; dirty = false; setDraft(null); renderList(); renderEditor(); message("已退出编辑，已保存的记录仍保留。"); return; }
      if (dirty && ["episode", "question", "open"].includes(name)) throw Error("请先保存当前编辑，再继续操作。");
      if (["save", "confirm", "archive"].includes(name)) {
        const record = { ...editor, status: name === "archive" ? "archived" : name === "confirm" ? "confirmed" : "draft" };
        if (kind === "sources" && !record.url?.trim() && !record.excerpt?.trim() && !record.localRef?.trim()) throw Error("请填写来源链接、原始内容或项目内文件位置。");
        if (kind === "episodes" && !record.title?.trim()) throw Error("请给这段经历一个标题。");
        if (kind === "qa" && !record.question?.trim()) throw Error("请填写问题。");
        for (const field of LIST_FIELDS) if ((record[field] || []).some(value => value.length > (field === "tags" ? 120 : 1000))) throw Error(`${field === "tags" ? "每个标签最多120字" : "每条行动或备选方案最多1000字"}，请拆分后保存。`);
        if (name === "confirm" && kind === "qa" && !record.answer?.trim()) throw Error("先填写事实回答，再确认；表达草稿会单独保留。");
        const saved = await mutate(kind, record, { actor: "user", confirm: name === "confirm" });
        if (expectedScope !== getScopeKey()) return;
        editor = structuredClone(saved); selectedId = saved.id; dirty = false; keepDraft();
        message(name === "confirm" ? "事实已确认，并保存到当前项目。" : name === "archive" ? "已归档，仍可从归档筛选中找回。" : "已保存到项目，后续可以继续补充。因内容更新需要核对的记录会标记待确认。");
        renderList(); renderEditor();
      } else if (name === "accept" || name === "reject") {
        if (dirty) throw Error("请先保存当前编辑，再处理待审修订。");
        await reviewPending(kind, selectedId, name === "accept");
        if (expectedScope !== getScopeKey()) return;
        editor = structuredClone(records().find(item => item.id === selectedId)); keepDraft(); renderList(); renderEditor();
        message(name === "accept" ? "已采用修订，请继续核对受影响的关联经历与问答。" : "已保留原文，修订记录仍然可追溯。");
      } else if (name === "episode") selectRecord({ title: editor.title || "", sourceIds: [selectedId], status: "draft" }, "episodes", true);
      else if (name === "question") selectRecord({ episodeId: selectedId, question: "当时为什么选择这个方案？", category: "decision", sourceIds: editor.sourceIds || [], status: "draft" }, "qa", true);
      else if (name === "open") await openSource(editor.url);
      else {
        if (dirty) throw Error("请先保存当前内容，再让 Agent 整理。");
        if (name === "resume" && editor.status !== "confirmed") throw Error("先确认这段经历的事实，再生成简历要点。");
        await requestAgent(name, kind, selectedId);
        if (expectedScope === getScopeKey()) message("已发送到当前聊天。整理结果将作为待确认草稿写回，完成情况可在活动中查看。");
      }
    } catch (error) { if (expectedScope === getScopeKey()) message(`${error.message} 当前输入仍保留，可继续编辑或重试。`, true); }
    finally { if (expectedScope === getScopeKey()) { busy = false; updateBusy(); } }
  }
  root.addEventListener("input", event => {
    const field = event.target.dataset.careerField;
    if (field && editor) {
      editor[field] = LIST_FIELDS.has(field) ? event.target.value.split(/\n/).map(value => value.trim()).filter(Boolean) : event.target.value;
      if (kind === "sources" && field === "excerpt") delete editor.contentHash;
      dirty = true; keepDraft();
    }
  });
  root.addEventListener("change", event => {
    if (event.target.dataset.careerField && editor) {
      const field = event.target.dataset.careerField;
      editor[field] = LIST_FIELDS.has(field) ? event.target.value.split(/\n/).map(value => value.trim()).filter(Boolean) : event.target.value;
      dirty = true; keepDraft();
    }
    if (event.target.dataset.careerSource && editor) { editor.sourceIds = [...root.querySelectorAll("[data-career-source]:checked")].map(input => input.dataset.careerSource); dirty = true; keepDraft(); }
    if (event.target.id === "career-filter") { status = event.target.value; cursor = 0; renderList(); }
  });
  el("search").addEventListener("input", event => { search = event.target.value; cursor = 0; renderList(); });
  root.addEventListener("submit", event => { if (event.target.id === "career-form") { event.preventDefault(); void action("save"); } });
  root.addEventListener("click", event => {
    const button = event.target.closest("button"); if (!button || busy) return;
    if (dirty && (button.dataset.careerKind || button.dataset.careerRecord || button.id === "career-add")) { message("请先保存当前编辑，再切换记录。输入已保留在当前项目草稿中。", true); return; }
    if (button.dataset.careerKind) { kind = button.dataset.careerKind; selectedId = ""; editor = null; cursor = 0; setDraft(null); renderToolbar(); renderList(); renderEditor(); }
    else if (button.dataset.careerRecord) selectRecord(records().find(record => record.id === button.dataset.careerRecord));
    else if (button.dataset.careerPage) { cursor = button.dataset.careerPage === "next" ? cursor + 12 : Math.max(0, cursor - 12); renderList(); }
    else if (button.id === "career-add") selectRecord({ provider: "manual", category: "decision", status: "draft" }, kind, true);
    else if (button.dataset.careerAction && button.dataset.careerAction !== "save") void action(button.dataset.careerAction);
  });
  function render() {
    const nextScope = getScopeKey(), state = getState();
    if (nextScope !== scopeKey) { scopeKey = nextScope; kind = "sources"; selectedId = ""; editor = null; dirty = false; busy = false; draftStamp = ""; search = ""; cursor = 0; el("search").value = ""; message(""); }
    const draft = state.careerDraft;
    if (draft?.record && draft.updatedAt !== draftStamp && COLLECTIONS[draft.kind]) {
      kind = draft.kind; selectedId = draft.id || ""; dirty = draft.dirty;
      const saved = records().find(record => record.id === selectedId);
      editor = structuredClone(!dirty && saved ? saved : draft.record);
      draftStamp = draft.updatedAt; renderEditor();
    }
    else if (editor && !dirty && !busy && selectedId) {
      const record = records().find(item => item.id === selectedId);
      if (record && JSON.stringify(record) !== JSON.stringify(editor)) { editor = structuredClone(record); renderEditor(); }
    }
    const pending = Object.values(COLLECTIONS).flatMap(field => state[field] || []).filter(record => record.status === "draft" || record.status === "needs_review" || record.pendingRevision).length;
    el("stats").innerHTML = `<span><b>${(state.sourceMaterials || []).length}</b>材料</span><span><b>${(state.careerEpisodes || []).length}</b>经历</span><span><b>${(state.careerQa || []).length}</b>问答</span><span><b>${pending}</b>待确认</span>`;
    versionsUI.render(); renderToolbar(); renderList(); if (!editor) renderEditor();
  }
  const versionsUI = mountCareerLibraryVersions({ root: root.querySelector("#career-session-workspace"), getState, getScopeKey, hasUnsavedChanges: () => dirty || busy, ...versionActions });
  render();
  return { render, hasUnsavedChanges: () => dirty || busy || versionsUI.hasUnsavedChanges(), openVersion(id) {
    if (dirty || busy) { message("请先保存或退出当前编辑，再回看知识库版本。", true); return false; }
    return versionsUI.open(id);
  }, open(nextKind, id) {
    if (dirty || busy) { message("请先保存当前编辑，再打开活动结果。输入仍保留。", true); return false; }
    const record = getState()[COLLECTIONS[nextKind]]?.find(item => item.id === id);
    if (!record) return false;
    selectRecord(record, nextKind); return true;
  } };
}
