import type { PanelBridge, Proposal } from "./host";
import type { Project } from "./model";
import type { ProductionController } from "./production";

interface ProductionTools {
  project(): Project;
  requestToken(): string;
  assertRequest(args: Record<string, unknown>, toolName?: string): void;
  apply(value: unknown): Promise<Proposal>;
  capture(assetId: string, seconds: number): Promise<unknown>;
  validateRender?(): Promise<void>;
  setScript?(text: string, baseRevision: number, finish: boolean): Promise<unknown>;
  finishSetup?(jobId: string): Promise<unknown>;
}
const strings = (value: unknown): string[] => {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 100 ||
    value.some((v) => typeof v !== "string")
  )
    throw new Error("需要 1–100 个素材 ID");
  return value;
};
const page = (value: unknown, fallback: number, max: number): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new Error("分页范围无效");
  return value;
};
export function registerProjectReadTool(
  panel: PanelBridge | undefined,
  production: ProductionController,
  readProject: () => unknown,
): void {
  panel?.registerTool("read_video_project", (args = {}) => {
    const view = args.view ?? "project";
    if (typeof view !== "string" || !["project", "jobs", "voices"].includes(view))
      throw new Error("请选择工程、制作任务或声音目录");
    if (args.jobIds !== undefined && view !== "jobs") throw new Error("任务 ID 仅用于读取制作任务");
    if (view === "project") return readProject();
    if (view === "voices") return production.voices();
    if (
      args.jobIds !== undefined &&
      (!Array.isArray(args.jobIds) ||
        !args.jobIds.length ||
        args.jobIds.length > 50 ||
        args.jobIds.some((id) => typeof id !== "string" || !id.length || id.length > 128))
    )
      throw new Error("需要 1–50 个有效的制作任务 ID");
    return production.waitForJobs(args.jobIds as string[] | undefined);
  });
}
export function registerProductionTools(
  panel: PanelBridge | undefined,
  production: ProductionController,
  handlers: ProductionTools,
): void {
  panel?.registerTool("finish_video_tts_setup", (args) => {
    handlers.assertRequest(args, "finish_video_tts_setup");
    if (!handlers.finishSetup || typeof args.jobId !== "string")
      throw new Error("需要已完成的安装任务");
    return handlers.finishSetup(args.jobId);
  });
  panel?.registerTool("setup_video_tts", (args) => {
    handlers.assertRequest(args, "setup_video_tts");
    if (
      typeof args.providerId !== "string" ||
      !["edge-tts", "kokoro", "qwen3-tts", "audio8-tts"].includes(args.providerId)
    )
      throw new Error("请选择受支持的引擎");
    return production.setupTts(args.providerId);
  });
  panel?.registerTool("enhance_video_audio", (args) => {
    handlers.assertRequest(args, "enhance_video_audio");
    if (
      typeof args.assetId !== "string" ||
      (args.preset !== undefined && args.preset !== "light" && args.preset !== "balanced") ||
      [args.denoise, args.normalize].some(
        (value) => value !== undefined && typeof value !== "boolean",
      )
    )
      throw new Error("原声优化参数无效");
    return production.enhanceAudio(
      args.assetId,
      {
        preset: args.preset as "light" | "balanced" | undefined,
        denoise: args.denoise as boolean | undefined,
        normalize: args.normalize as boolean | undefined,
      },
      false,
    );
  });
  panel?.registerTool("set_video_script", (args) => {
    handlers.assertRequest(args, "set_video_script");
    if (
      !handlers.setScript ||
      typeof args.text !== "string" ||
      !args.text.trim() ||
      args.text.length > 10000 ||
      !Number.isSafeInteger(args.baseRevision) ||
      (args.finish !== undefined && typeof args.finish !== "boolean")
    )
      throw new Error("文稿参数无效");
    return handlers.setScript(args.text, args.baseRevision as number, args.finish === true);
  });
  for (const name of ["create_video_voiceover", "prepare_video_voice"] as const)
    panel?.registerTool(name, (args) => {
      handlers.assertRequest(args, name);
      if (
        typeof args.text !== "string" ||
        (args.voiceId !== undefined && typeof args.voiceId !== "string") ||
        (args.modelId !== undefined && typeof args.modelId !== "string") ||
        (args.instructions !== undefined && typeof args.instructions !== "string") ||
        (args.referenceAssetId !== undefined && typeof args.referenceAssetId !== "string") ||
        (args.referenceText !== undefined && typeof args.referenceText !== "string") ||
        (args.rate !== undefined && typeof args.rate !== "number")
      )
        throw new Error("配音参数无效");
      const params = {
        text: args.text,
        modelId: args.modelId as string | undefined,
        instructions: args.instructions as string | undefined,
        voiceId: args.voiceId as string | undefined,
        rate: args.rate as number | undefined,
        ...(args.referenceAssetId !== undefined
          ? { referenceAssetId: args.referenceAssetId as string }
          : {}),
        ...(args.referenceText !== undefined
          ? { referenceText: args.referenceText as string }
          : {}),
      };
      return name === "prepare_video_voice"
        ? production.prepareVoice(params)
        : production.createVoiceover(params);
    });
  panel?.registerTool("extract_video_reference", (args) => {
    handlers.assertRequest(args, "extract_video_reference");
    if (
      typeof args.assetId !== "string" ||
      !Number.isSafeInteger(args.inFrame) ||
      !Number.isSafeInteger(args.outFrame)
    )
      throw new Error("参考提取需要素材 ID 与整数帧入出点");
    return production.extractReference(
      args.assetId,
      args.inFrame as number,
      args.outFrame as number,
    );
  });
  panel?.registerTool("prepare_video_assets", (args) => {
    handlers.assertRequest(args, "prepare_video_assets");
    return production.prepare(strings(args.assetIds), args.transcribe === true);
  });
  panel?.registerTool("get_video_transcript", (args) =>
    production.transcript(
      String(args.assetId),
      page(args.offset, 0, 100000),
      page(args.limit, 50, 100),
    ),
  );
  panel?.registerTool("get_video_analysis", (args) =>
    production.analysis(
      String(args.assetId),
      String(args.kind),
      page(args.offset, 0, 100000),
      page(args.limit, 50, 100),
    ),
  );
  panel?.registerTool("inspect_video_frame", (args) => {
    if (
      typeof args.assetId !== "string" ||
      !handlers.project().assets.some((a) => a.id === args.assetId)
    )
      throw new Error("素材不属于当前工程");
    const seconds = args.seconds ?? 0;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
      throw new Error("取帧时间无效");
    return handlers.capture(args.assetId, seconds);
  });
  panel?.registerTool("create_video_scene", (args) => {
    handlers.assertRequest(args, "create_video_scene");
    if (typeof args.title !== "string" || !args.title.trim()) throw new Error("场景标题不能为空");
    const palette = {
      background: args.background ?? "#142823",
      foreground: "#f2f4e9",
      accent: args.accent ?? "#b5e3ac",
    };
    return production.createScene({
      kind: args.kind ?? "chapter",
      title: args.title,
      subtitle: args.subtitle,
      bullets: args.bullets,
      durationSeconds: args.durationSeconds,
      palette,
    });
  });
  panel?.registerTool("apply_video_edit", async (args) => {
    handlers.assertRequest(args, "apply_video_edit");
    const proposal = await handlers.apply(args);
    return {
      applied: true,
      projectId: handlers.project().id,
      revision: handlers.project().revision,
      title: proposal.title,
      operationCount: proposal.operations.length,
    };
  });
  panel?.registerTool("render_video_project", async (args) => {
    handlers.assertRequest(args, "render_video_project");
    if (handlers.validateRender) {
      await handlers.validateRender();
      handlers.assertRequest(args, "render_video_project");
    }
    const project = handlers.project();
    if (args.projectId !== project.id || args.baseRevision !== project.revision)
      throw new Error("工程已变化，请重新读取后导出");
    return production.render(project);
  });
}
