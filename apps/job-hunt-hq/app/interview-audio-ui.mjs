import {
  audioAnswerHash,
  createInterviewAudioTasks,
  interviewTranscript,
  prepareInterviewAudio,
} from "./interview-audio-tasks.mjs";

export async function transcriptAnswer(job, current) {
  const result = interviewTranscript(job);
  if (!result) throw new Error("转写任务尚未完成。");
  if (
    !current ||
    current.questionId !== result.source.questionId ||
    current.practiceSessionId !== result.source.practiceSessionId ||
    (await audioAnswerHash(current.answer)) !== result.source.answerHash
  )
    throw new Error("题目或回答已经变化，未自动覆盖；可复制转写文字后自行整理。");
  const answer = `${current.answer}${current.answer ? "\n" : ""}${result.text}`;
  if (answer.length > 6000) throw new Error("合并后超过 6000 字，请复制转写文字后自行整理。");
  return answer;
}
export function createInterviewAudioUI({
  root,
  scope,
  source,
  apply,
  notify,
  questionTitle = () => "原练习题",
}) {
  const tasks = createInterviewAudioTasks({ call: scope.call, check: scope.check });
  const section = document.createElement("section");
  section.className = "interview-cloud-audio";
  const node = (tag, text) => {
    const value = document.createElement(tag);
    value.textContent = text;
    return value;
  };
  const title = node("h4", "项目录音与后台转写");
  const description = node(
    "p",
    "先保存录音，再选择语音连接并确认转写。关闭页面后可刷新找回文件和任务；转写文字需要手动加入当前回答。",
  );
  const status = node("p", "");
  status.setAttribute("role", "status");
  const connections = document.createElement("select");
  connections.id = "interview-audio-connection";
  const connectionLabel = node("label", "语音转写连接");
  connectionLabel.htmlFor = connections.id;
  const assets = document.createElement("select");
  assets.id = "interview-audio-resource";
  const assetLabel = node("label", "已保存的项目音频");
  assetLabel.htmlFor = assets.id;
  const rows = document.createElement("div");
  let closed = false,
    working = false,
    refreshPending = null,
    timer;
  let choices = [],
    files = [],
    jobs = new Map(),
    resourceOffset = null,
    taskOffset = null,
    retryNonce = "";
  const active = () => !closed && scope.active();
  const check = () => {
    scope.check();
    if (closed) throw new Error("录音页面已关闭，原项目文件和任务仍保留。");
  };
  function button(label, run) {
    const control = node("button", label);
    control.type = "button";
    control.className = "button button-quiet";
    control.addEventListener("click", () => void action(run));
    return control;
  }
  async function action(run) {
    if (!active() || working) return;
    working = true;
    status.textContent = "正在读取项目或等待工作台确认…";
    controls();
    try {
      await run();
      check();
    } catch (error) {
      if (active()) {
        status.textContent = error.message;
        notify(error.message, "error");
      }
    } finally {
      if (active()) {
        working = false;
        if (status.textContent === "正在读取项目或等待工作台确认…") status.textContent = "";
        controls();
      }
    }
  }
  function controls() {
    for (const control of section.querySelectorAll("button,select")) control.disabled = working;
    submit.disabled = working || !connections.value || !assets.value || !source();
    open.disabled = working || !assets.value;
  }
  function renderChoices() {
    for (const [select, values, placeholder] of [
      [connections, choices, "请选择转写连接"],
      [assets, files, "请选择项目录音"],
    ]) {
      const previous = select.value;
      select.replaceChildren(
        new Option(placeholder, ""),
        ...values.map(
          (value) =>
            new Option(value.model ? `${value.name} · ${value.model}` : value.name, value.id),
        ),
      );
      if (values.some((value) => value.id === previous)) select.value = previous;
    }
    moreFiles.hidden = resourceOffset === null;
  }
  function renderJobs() {
    rows.replaceChildren();
    const labels = {
      queued: "排队中",
      running: "转写中",
      cancelling: "正在取消",
      succeeded: "已完成",
      failed: "失败",
      cancelled: "已取消",
      interrupted: "已中断",
    };
    for (const job of jobs.values()) {
      const row = document.createElement("article");
      row.dataset.audioTaskId = job.id;
      row.append(
        node(
          "p",
          `${questionTitle(job.input.request.source.questionId)} · ${labels[job.status] || job.status}${job.error?.message ? `：${job.error.message}` : ""}`,
        ),
      );
      row.append(button("打开原录音", () => tasks.open(job.input.request.assetId)));
      if (job.status === "succeeded") {
        let result;
        try {
          result = interviewTranscript(job);
        } catch (error) {
          row.append(node("p", error.message));
          rows.append(row);
          continue;
        }
        const text = document.createElement("textarea");
        text.readOnly = true;
        text.value = result.text;
        text.setAttribute("aria-label", "转写文字，可选中复制");
        row.append(
          text,
          button("加入当前回答", async () => {
            const before = source();
            const answer = await transcriptAnswer(job, before);
            check();
            if (JSON.stringify(before) !== JSON.stringify(source()))
              throw new Error("回答已变化，请重新检查转写文字。");
            await apply(answer, before);
            check();
            status.textContent = "已加入回答草稿，请校对后保存回答。";
          }),
        );
      } else if (["queued", "running", "cancelling"].includes(job.status)) {
        row.append(
          button("取消转写", async () => {
            await tasks.cancel(job.id);
            await refresh();
          }),
        );
      } else if (!job.readOnly) {
        row.append(
          button("选择原录音重新转写", async () => {
            const asset = (await scope.call("resources.get", { id: job.input.request.assetId }))
              ?.asset;
            check();
            if (!files.some((file) => file.id === asset.id)) files.push(asset);
            renderChoices();
            assets.value = asset.id;
            if (choices.some((choice) => choice.id === job.input.request.connection.id))
              connections.value = job.input.request.connection.id;
            retryNonce = crypto.randomUUID();
            submit.textContent = "确认再次发送转写";
            status.textContent =
              "原请求可能已被服务商处理。确认再次发送可能再次计费；不会自动重试。";
          }),
        );
      }
      rows.append(row);
    }
    moreTasks.hidden = taskOffset === null;
    controls();
  }
  function refresh({ more = false } = {}) {
    if (refreshPending) return refreshPending;
    if (!active()) return Promise.resolve();
    clearTimeout(timer);
    refreshPending = (async () => {
      const page = await tasks.list(more ? taskOffset || 0 : 0);
      check();
      if (!more) jobs.clear();
      for (const job of page.jobs) jobs.set(job.id, job);
      taskOffset = page.nextOffset;
      renderJobs();
    })().finally(() => {
      refreshPending = null;
      if (
        active() &&
        [...jobs.values()].some((job) => ["queued", "running", "cancelling"].includes(job.status))
      )
        timer = setTimeout(
          () =>
            void refresh().catch((error) => {
              if (active()) status.textContent = error.message;
            }),
          5000,
        );
    });
    return refreshPending;
  }
  async function refreshFiles(more = false) {
    const page = await tasks.resources(more ? resourceOffset || 0 : 0);
    check();
    files = [
      ...new Map(
        [...(more ? files : []), ...page.assets].map((value) => [value.id, value]),
      ).values(),
    ];
    resourceOffset = page.nextOffset;
    renderChoices();
  }
  const capture = button("打开项目录音器", async () => {
    const asset = await tasks.record();
    check();
    if (!asset) {
      status.textContent = "已取消录音。";
      return;
    }
    files = [asset, ...files.filter((item) => item.id !== asset.id)];
    renderChoices();
    assets.value = asset.id;
    retryNonce = "";
    submit.textContent = "确认发送录音并转写";
    status.textContent = "原录音已保存到项目。请选择连接，确认后才会发送给语音服务。";
  });
  const reload = button("刷新录音、连接与任务", async () => {
    choices = await tasks.connections();
    await refreshFiles();
    await refresh();
    check();
    status.textContent = choices.length
      ? "请选择录音与连接；已有任务不会自动重复提交。"
      : "尚无可用语音连接。请在当前项目配置音频转写模型；录音仍可保存和下载。";
  });
  const moreFiles = button("更多项目音频", () => refreshFiles(true));
  moreFiles.hidden = true;
  const moreTasks = button("更多转写任务", () => refresh({ more: true }));
  moreTasks.hidden = true;
  const open = button("打开／下载所选录音", () => tasks.open(assets.value));
  const submit = button("确认发送录音并转写", async () => {
    const before = source();
    const selected = files.find((file) => file.id === assets.value),
      connection = choices.find((choice) => choice.id === connections.value);
    const request = await prepareInterviewAudio({
      asset: selected,
      connection,
      ...before,
      nonce: retryNonce,
    });
    check();
    if (JSON.stringify(before) !== JSON.stringify(source()))
      throw new Error("题目或回答已变化，请重新确认转写。");
    const job = await tasks.submit(request);
    check();
    jobs.set(job.id, job);
    renderJobs();
    retryNonce = "";
    submit.textContent = "确认发送录音并转写";
    await refresh();
    status.textContent = "转写任务已保存；关闭页面后可刷新查看。完成后请校对并手动加入回答。";
  });
  connections.addEventListener("change", controls);
  assets.addEventListener("change", () => {
    retryNonce = "";
    submit.textContent = "确认发送录音并转写";
    controls();
  });
  section.append(
    title,
    description,
    capture,
    reload,
    connectionLabel,
    connections,
    assetLabel,
    assets,
    open,
    moreFiles,
    submit,
    status,
    rows,
    moreTasks,
  );
  root.append(section);
  controls();
  return {
    refresh,
    render: controls,
    close() {
      closed = true;
      clearTimeout(timer);
      section.remove();
    },
  };
}
