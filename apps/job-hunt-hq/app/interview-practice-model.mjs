function text(value, maximum = 6000) {
  return String(value ?? "").slice(0, maximum);
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : -1;
}

export function normalizeInterviewAnswerDraft(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      questionId: "",
      practiceSessionId: "",
      answer: "",
      inputMode: "typed",
      updatedAt: "",
    };
  }
  return {
    questionId: text(input.questionId, 100).trim(),
    practiceSessionId: text(input.practiceSessionId, 100).trim(),
    answer: text(input.answer, 6000),
    inputMode: ["typed", "voice", "mixed"].includes(input.inputMode)
      ? input.inputMode
      : "typed",
    updatedAt: text(input.updatedAt, 80).trim(),
  };
}

export function resolveInterviewAnswerDraft(
  draftInput,
  question = {},
  savedAttempt = null,
  options = {},
) {
  const draft = normalizeInterviewAnswerDraft(draftInput);
  const practiceSessionId = text(options.practiceSessionId, 100).trim();
  if (
    !draft.questionId ||
    draft.questionId !== String(question.id || "") ||
    draft.practiceSessionId !== practiceSessionId ||
    !draft.answer.trim()
  ) {
    return {
      answer: text(savedAttempt?.answer, 6000),
      inputMode: ["typed", "voice", "mixed"].includes(savedAttempt?.inputMode)
        ? savedAttempt.inputMode
        : "typed",
      restored: false,
    };
  }
  const savedAt = timestamp(savedAttempt?.updatedAt || savedAttempt?.createdAt);
  const draftAt = timestamp(draft.updatedAt);
  const draftIsNewer = !savedAttempt || draftAt < 0 || savedAt < 0 || draftAt > savedAt;
  if (!draftIsNewer || draft.answer === savedAttempt?.answer) {
    return {
      answer: text(savedAttempt?.answer, 6000),
      inputMode: ["typed", "voice", "mixed"].includes(savedAttempt?.inputMode)
        ? savedAttempt.inputMode
        : "typed",
      restored: false,
    };
  }
  return {
    answer: draft.answer,
    inputMode: draft.inputMode,
    restored: true,
  };
}

const ANSWER_GUIDES = Object.freeze({
  behavioral: ["场景：当时发生了什么", "目标：你需要解决什么", "行动：你具体做了什么", "结果：结果与复盘"],
  project_deep_dive: [
    "背景：模块为什么难",
    "职责：你负责哪一段",
    "决策：难点、取舍与方案",
    "验证：结果如何确认",
  ],
  resume_probe: [
    "背景：项目与目标",
    "归属：你的职责边界",
    "行动：具体技术与协作",
    "证据：结果、Source 与反思",
  ],
  system_design: [
    "约束：规模、边界与目标",
    "方案：核心组件与链路",
    "取舍：为什么这样设计",
    "验证：风险、监控与恢复",
  ],
  technical: ["结论：先直接回答", "原理：关键机制", "实践：定位或实现步骤", "验证：边界与取舍"],
  scenario: ["澄清：先确认约束", "判断：风险与优先级", "行动：具体处理步骤", "验证：结果与兜底"],
  role_knowledge: ["结论：你的判断", "依据：岗位或业务信号", "行动：你会怎么做", "价值：如何验证效果"],
  other: ["结论：先回答问题", "证据：用真实例子支撑", "行动：说明你的做法", "结果：验证与反思"],
});

export function interviewAnswerGuide(question = {}) {
  const type = Object.hasOwn(ANSWER_GUIDES, question.type) ? question.type : "other";
  return { type, steps: [...ANSWER_GUIDES[type]] };
}

export function estimateInterviewSpeech(answer = "") {
  const value = text(answer, 6000).trim();
  if (!value) return { seconds: 0, label: "尚未作答", state: "empty" };
  const cjkCount = (value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || [])
    .length;
  const latinWords = (value.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, " ").match(/[\p{L}\p{N}]+/gu) || [])
    .length;
  const seconds = Math.max(1, Math.round((cjkCount / 220 + latinWords / 145) * 60));
  const state = seconds < 45 ? "short" : seconds <= 135 ? "target" : "long";
  const label =
    state === "short"
      ? `约 ${seconds} 秒 · 可以再补证据`
      : state === "target"
        ? `约 ${seconds} 秒 · 适合口述`
        : `约 ${Math.ceil(seconds / 60)} 分钟 · 建议收紧`;
  return { seconds, label, state };
}
