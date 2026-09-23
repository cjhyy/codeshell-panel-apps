/** Resolve package paths through the Host's project-aware Skill loader. */
export const PROJECT_RUNTIME_SKILL = "quant-lab:project-runtime";

export function projectRuntimePrompt(program, missingCode) {
  if (!/^[a-z][a-z0-9-]*\.mjs$/u.test(program) || !/^bundled-[a-z-]+-tool-not-found$/u.test(missingCode)) {
    throw new Error("Invalid reviewed Panel program");
  }
  return `先调用 Skill（skill="${PROJECT_RUNTIME_SKILL}"），按其返回的实际目录定位当前项目选定版本的 app/tools/${program}，将验证后的完整程序路径保存为本轮 shell 变量 PANEL_TOOL。这不是 Host 路径模板；每次执行命令都要在同一 shell 中设置该变量并正确引用，然后用 test -r 检查该文件。禁止使用全局安装目录或其他版本。Skill 不可用、包身份不符或程序不可读时报告 ${missingCode} / unavailable，停止该操作；禁止猜测路径、估算、补零或编造，也不得发送触发通知。`;
}
