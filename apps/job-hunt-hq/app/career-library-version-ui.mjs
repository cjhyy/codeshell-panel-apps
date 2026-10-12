const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&#39;" })[char]);
const collections = { sources: "sourceMaterials", episodes: "careerEpisodes", qa: "careerQa" };
const labels = { sources: "原始材料", episodes: "经历与决策", qa: "长期问答" };
const names = { title: "标题", project: "项目", background: "背景", problem: "问题", myRole: "本人职责", actions: "行动", alternatives: "考虑过的方案", decision: "选择", reason: "原因", tradeoffs: "取舍", results: "结果", retrospective: "复盘", question: "问题", answer: "事实回答", draftAnswer: "表达草稿", url: "来源链接", author: "作者", excerpt: "原始内容", sourceIds: "来源记录", episodeId: "关联经历", status: "事实状态" };
const title = record => record?.title || record?.question || record?.url || "未命名记录";
function content(record) {
  if (!record) return "这版没有该记录";
  return Object.entries(names).filter(([key]) => record[key]?.length).map(([key, label]) => `<div><dt>${label}</dt><dd>${escape(key === "status" ? ({ draft: "待核对", confirmed: "已核实", needs_review: "需复核", archived: "已归档" }[record[key]] || record[key]) : Array.isArray(record[key]) ? record[key].join("\n") : record[key])}</dd></div>`).join("") + (record.pendingRevision ? `<div><dt>待审修订</dt><dd><details><summary>查看提议的内容</summary><dl>${content(record.pendingRevision.content)}</dl></details></dd></div>` : "");
}

// This is a result/history view. Conversation stays in the existing session;
// no second chat composer or required per-record form is introduced here.
export function mountCareerLibraryVersions({ root, getState, getScopeKey, hasUnsavedChanges, requestChat, previewVersion, saveVersion, loadVersion }) {
  let scopeKey = getScopeKey(), busy = false, displayed = null, detailKind = "episodes", detailCursor = 0;
  root.innerHTML = `<section class="career-chat-entry"><div><span class="career-eyebrow">在当前 SESSION 里积累</span><h2>聊清楚一段经历，留下一个版本。</h2><p>直接在当前聊天贴 Slack / GitHub 链接，补充你的行动、选择和原因。聊完说「保存这一版经历与问答库」，结果会写回这里。简历需要时再生成。</p><blockquote>整理这段讨论和这个 repo。先问清楚我为什么这样选，再更新经历和问答库，保留来源。</blockquote></div><div class="career-actions"><button type="button" class="button button-primary" id="career-chat-start">在当前聊天开始整理</button><button type="button" class="button button-quiet" id="career-version-preview">查看本轮改动</button></div></section>
    <section class="career-version-section" aria-label="知识库版本"><div class="career-version-heading"><div><h2>知识库版本</h2><p id="career-version-summary"></p></div><select id="career-version-history" aria-label="回看知识库版本"><option value="">选择历史版本…</option></select></div><p id="career-version-message" role="status" aria-live="polite"></p><div id="career-version-detail" hidden></div></section>`;
  const el = suffix => root.querySelector(`#career-version-${suffix}`);
  const say = text => { el("message").textContent = text; };
  const updateBusy = () => root.querySelectorAll("button,select,input").forEach(button => {
    if (busy) { if (!Object.hasOwn(button.dataset, "versionWasDisabled")) button.dataset.versionWasDisabled = String(button.disabled); button.disabled = true; }
    else if (Object.hasOwn(button.dataset, "versionWasDisabled")) { button.disabled = button.dataset.versionWasDisabled === "true"; delete button.dataset.versionWasDisabled; }
  });
  async function run(work) {
    if (busy) return;
    const expectedScope = getScopeKey(); busy = true; updateBusy();
    try { await work(() => expectedScope === getScopeKey()); }
    catch (error) { if (expectedScope === getScopeKey()) say(error.message || "操作失败，请重试。"); }
    finally { if (expectedScope === getScopeKey()) { busy = false; updateBusy(); } }
  }
  function renderDetail() {
    if (!displayed) { el("detail").hidden = true; return; }
    const { version, comparison, snapshot, current } = displayed;
    const counts = comparison.counts;
    const unresolved = comparison.unresolved;
    el("detail").hidden = false;
    el("detail").innerHTML = `<h3>${current ? "本轮整理预览" : escape(version.title)}</h3><p>${current ? "与上一个保存版本比较" : escape(version.createdAt)} · 新增 ${counts.added} · 修改 ${counts.updated} · 归档 ${counts.archived}</p><p>仍待核对 ${unresolved.total} 条${unresolved.pending ? `，其中 ${unresolved.pending} 条有待审修订` : ""}。保存版本会保留这些标记，原已确认内容仍可追溯。</p>
      ${current ? `<label class="career-version-name">版本名称<input id="career-version-title" maxlength="240" value="${escape(version?.title || `${new Date().toISOString().slice(0, 10)} 经历与问答整理`)}" /></label><button type="button" class="button button-primary" id="career-version-save" ${!comparison.changes.length ? "disabled" : ""}>保存此知识库版本</button>` : `<p>${escape(version.summary || "")}</p>`}
      <details class="career-version-diff" open><summary>本版改动（${comparison.changes.length}）</summary>${comparison.changes.slice(0, 60).map(change => `<details><summary>${{ added: "新增", updated: "修改", archived: "归档 / 撤回" }[change.type]} · ${labels[change.kind] || change.kind} · ${escape(title(change.after || change.before))}</summary><div class="career-version-comparison"><section><h4>前一版</h4><dl>${content(change.before)}</dl></section><section><h4>这一版</h4><dl>${content(change.after)}</dl></section></div></details>`).join("") || "<p>还没有新的改动。</p>"}${comparison.changes.length > 60 ? "<p>这里只展开前60条，完整记录可在下方分页查看。</p>" : ""}</details>
      <details id="career-version-records"><summary>浏览这一版的材料、经历和问答</summary><div class="career-tabs">${Object.entries(labels).map(([key, label]) => `<button type="button" data-version-kind="${key}" aria-pressed="${detailKind === key}">${label}（${snapshot[collections[key]].length}）</button>`).join("")}</div><div id="career-version-record-list"></div></details>`;
    renderRecords(); updateBusy();
  }
  function renderRecords() {
    if (!displayed) return;
    const records = displayed.snapshot[collections[detailKind]];
    el("record-list").innerHTML = records.slice(detailCursor, detailCursor + 20).map(record => `<details><summary>${escape(title(record))}</summary><dl>${content(record)}</dl></details>`).join("") + `<div class="career-pagination"><button type="button" class="button button-quiet" data-version-page="prev" ${!detailCursor ? "disabled" : ""}>上一页</button><span>${records.length} 条 · ${Math.floor(detailCursor / 20) + 1} 页</span><button type="button" class="button button-quiet" data-version-page="next" ${detailCursor + 20 >= records.length ? "disabled" : ""}>下一页</button></div>`;
  }
  root.addEventListener("click", event => {
    const button = event.target.closest("button"); if (!button || busy || button.disabled) return;
    if (button.id === "career-chat-start") void run(async active => { await requestChat(); if (active()) say("已发送到当前聊天。直接在聊天中补充资料和原因即可。"); });
    else if (button.id === "career-version-preview") void run(async active => {
      if (hasUnsavedChanges()) throw Error("当前有未保存的手工编辑，请先保存或退出编辑，再预览本轮聊天结果。");
      const result = await previewVersion(); if (!active()) return;
      displayed = { ...result, current: true }; detailCursor = 0; renderDetail(); say("这是当前项目的整理结果，历史版本不会变化。");
    });
    else if (button.id === "career-version-save") void run(async active => {
      const versionTitle = el("title").value.trim(); if (!versionTitle) throw Error("请填写版本名称。");
      const result = await saveVersion({ title: versionTitle, expectedSnapshot: displayed.snapshot }); if (!active()) return;
      displayed = { ...displayed, version: result, current: false }; render(); renderDetail(); say("已保存知识库版本。你可以继续在当前聊天补充，下一次再保存新版本。");
    });
    else if (button.dataset.versionKind) { detailKind = button.dataset.versionKind; detailCursor = 0; renderDetail(); el("records").open = true; }
    else if (button.dataset.versionPage) { detailCursor = Math.max(0, detailCursor + (button.dataset.versionPage === "next" ? 20 : -20)); renderRecords(); }
  });
  el("history").addEventListener("change", event => {
    const id = event.target.value; if (!id) return;
    void run(async active => { const result = await loadVersion(id); if (!active()) return; displayed = { ...result, current: false }; detailCursor = 0; renderDetail(); say("正在回看历史版本，当前知识库保持原样。"); });
  });
  function render() {
    if (scopeKey !== getScopeKey()) { scopeKey = getScopeKey(); busy = false; displayed = null; renderDetail(); say(""); }
    const versions = getState().careerLibraryVersions || [];
    el("summary").textContent = versions.length ? `已保存 ${versions.length} 版 · 最近：${versions.at(-1).title}` : "还没有保存版本。你可以先在当前聊天整理，再保存这一轮的结果。";
    const selection = el("history").value;
    el("history").innerHTML = '<option value="">选择历史版本…</option>' + versions.slice().reverse().map(version => `<option value="${escape(version.id)}">${escape(version.title)} · ${escape(version.createdAt.slice(0, 10))}</option>`).join("");
    el("history").value = selection; updateBusy();
  }
  render();
  return { render, hasUnsavedChanges: () => busy, open(id) {
    if (busy || !getState().careerLibraryVersions.some(version => version.id === id)) return false;
    el("history").value = id; el("history").dispatchEvent(new Event("change", { bubbles: true }));
    root.scrollIntoView({ block: "start" }); return true;
  } };
}
