import { FrameCompositor } from "./compositor";
import { prepareEvaluator, type EvaluatedLayer } from "./evaluate";
import { validateExportProfile, type ExportProfile } from "./export-settings";
import { EditorMediaPool } from "./media-pool";
import type { EditorDocument } from "./types";
import type { Tick } from "./time";

function withoutSubtitles(layers: EvaluatedLayer[]): EvaluatedLayer[] {
  return layers.flatMap((layer): EvaluatedLayer[] => {
    if (layer.kind === "text" && layer.role === "subtitle") return [];
    if (layer.kind === "group") return [{ ...layer, layers: withoutSubtitles(layer.layers) }];
    if (layer.kind === "transition") {
      const from = layer.from ? (withoutSubtitles([layer.from])[0] ?? null) : null;
      const to = layer.to ? (withoutSubtitles([layer.to])[0] ?? null) : null;
      // Transitions cannot contain transitions in the validated frame graph.
      return [{ ...layer, from, to } as EvaluatedLayer];
    }
    return [layer];
  });
}

/** Bundled from the same evaluator/compositor as the interactive editor. No Host API. */
function createRenderRuntime() {
  let evaluator: ReturnType<typeof prepareEvaluator> | undefined;
  let media: EditorMediaPool | undefined;
  let compositor: FrameCompositor | undefined;
  let sequenceId = "";
  let profile: ExportProfile | undefined;
  let uploadUrl = "";
  let rendering = false;
  const scene = document.createElement("canvas");
  const output = document.createElement("canvas");
  const dispose = () => {
    media?.dispose();
    compositor?.dispose();
    media = undefined;
    compositor = undefined;
    evaluator = undefined;
    scene.width = scene.height = output.width = output.height = 1;
  };
  return {
    async initialize(
      documentValue: EditorDocument,
      id: string,
      settings: ExportProfile,
      urls: Record<string, string>,
      endpoint: string,
    ) {
      if (rendering) throw new Error("上一画面仍在绘制");
      dispose();
      profile = validateExportProfile(settings);
      evaluator = prepareEvaluator(documentValue);
      evaluator.evaluate(id, 0);
      sequenceId = id;
      uploadUrl = endpoint;
      if (new URL(endpoint).origin !== location.origin) throw new Error("渲染输出地址无效");
      media = new EditorMediaPool({
        resolveAsset: (assetId) => {
          const url = urls[assetId];
          if (!url || new URL(url).origin !== location.origin)
            throw new Error(`未提供渲染素材：${assetId}`);
          return url;
        },
      });
      compositor = new FrameCompositor();
      output.width = profile.width;
      output.height = profile.height;
      await document.fonts.ready;
      return true;
    },
    async render(time: Tick, requestId: number) {
      if (rendering || !evaluator || !media || !compositor || !profile)
        throw new Error("画面渲染器未就绪或正在工作");
      if (!Number.isSafeInteger(requestId) || requestId < 0) throw new Error("画面请求编号无效");
      rendering = true;
      try {
        const frame = evaluator.evaluate(sequenceId, time);
        if (!profile.includeCaptions) frame.layers = withoutSubtitles(frame.layers);
        const sources = await media.prepare(frame);
        compositor.draw(scene, frame, sources);
        const context = output.getContext("2d")!;
        context.reset();
        context.fillStyle = frame.background;
        context.fillRect(0, 0, output.width, output.height);
        // Changing export size preserves the sequence's composition and adds
        // letterboxing when the chosen output has a different aspect ratio.
        const scale = Math.min(output.width / scene.width, output.height / scene.height);
        context.drawImage(
          scene,
          (output.width - scene.width * scale) / 2,
          (output.height - scene.height * scale) / 2,
          scene.width * scale,
          scene.height * scale,
        );
        const blob = await new Promise<Blob>((resolve, reject) =>
          output.toBlob(
            (value) => (value ? resolve(value) : reject(new Error("无法编码画面 PNG"))),
            "image/png",
          ),
        );
        const response = await fetch(`${uploadUrl}/${requestId}`, {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          body: blob,
        });
        if (!response.ok) throw new Error("无法传递已完成的画面");
        return true;
      } finally {
        rendering = false;
      }
    },
    dispose,
  };
}

(
  globalThis as typeof globalThis & { videoStudioRender: ReturnType<typeof createRenderRuntime> }
).videoStudioRender = createRenderRuntime();
