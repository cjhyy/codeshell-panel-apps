import type { PanelBridge } from "./host";
import type { ManagedAsset } from "./production";
import type { RecordingMode } from "./recording";
import { escapeHtml as esc } from "./icons";

export interface HostVideoCapabilities {
  camera: boolean;
  screen: boolean;
  microphone: boolean;
  systemAudio: boolean;
  maxDurationSeconds: number;
  maxBytes: number;
}
export function hostVideoCapabilities(value: unknown): HostVideoCapabilities {
  const raw = value as HostVideoCapabilities | undefined;
  if (
    !raw ||
    [raw.camera, raw.screen, raw.microphone, raw.systemAudio].some(
      (value) => typeof value !== "boolean",
    ) ||
    !Number.isSafeInteger(raw.maxDurationSeconds) ||
    raw.maxDurationSeconds < 1 ||
    raw.maxDurationSeconds > 1200 ||
    !Number.isSafeInteger(raw.maxBytes) ||
    raw.maxBytes < 1 ||
    raw.maxBytes > 200 * 1024 * 1024
  )
    throw new Error("工作台视频采集能力回执无效。");
  return {
    camera: raw.camera,
    screen: raw.screen,
    microphone: raw.microphone,
    systemAudio: raw.systemAudio,
    maxDurationSeconds: raw.maxDurationSeconds,
    maxBytes: raw.maxBytes,
  };
}
interface Options {
  bridge(): PanelBridge | undefined;
  enabled(): boolean;
  audioEnabled?(): boolean;
  videoEnabled?(): boolean;
  videoCapabilities?(): HostVideoCapabilities | undefined;
  audioOnly?(): boolean;
  scope(): string;
  maxDurationSeconds(): number;
  description(): string;
  saveLabel(): string;
  imported(id: string): boolean;
  publish(asset: ManagedAsset, name: string, check: () => void): Promise<void>;
  saved(): void;
  changed(): void;
}
function recordingAsset(value: unknown, allowVideo = false): ManagedAsset {
  const asset = value as ManagedAsset | undefined;
  if (
    !asset ||
    !/^asset-[a-f0-9]{64}$/.test(asset.id) ||
    typeof asset.name !== "string" ||
    !asset.name ||
    asset.name.length > 1024 ||
    typeof asset.mimeType !== "string" ||
    !(allowVideo ? /^(audio|video)\/[a-z0-9.+-]+$/ : /^audio\/[a-z0-9.+-]+$/).test(
      asset.mimeType,
    ) ||
    !Number.isSafeInteger(asset.bytes) ||
    asset.bytes < 1 ||
    !Number.isFinite(asset.createdAt)
  )
    throw new Error("项目录制文件回执无效，请刷新已保存文件后重试。");
  return {
    id: asset.id,
    name: asset.name,
    mimeType: asset.mimeType,
    bytes: asset.bytes,
    createdAt: asset.createdAt,
  };
}

/** Resource discovery is the durable recovery path, including a lost capture reply.
 * Attaching to an editor document is a separate, explicit operation. */
export function createHostAudioRecording(options: Options) {
  let ownScope = "",
    epoch = 0,
    disposed = false,
    working = false,
    error = "",
    notice = "";
  let assets: ManagedAsset[] = [],
    offset = 0,
    total = 0,
    loaded = false,
    name = "";
  let mode: RecordingMode = "microphone",
    microphone = true,
    systemAudio = true;
  const modes = (): RecordingMode[] => [
    ...((options.audioEnabled?.() ?? options.enabled()) &&
    options.videoCapabilities?.()?.microphone !== false
      ? ["microphone" as const]
      : []),
    ...(!options.audioOnly?.() && options.videoCapabilities?.()?.camera ? ["camera" as const] : []),
    ...(!options.audioOnly?.() && options.videoCapabilities?.()?.screen ? ["screen" as const] : []),
  ];
  const allowVideo = () => (options.videoEnabled?.() ?? Boolean(options.videoCapabilities?.())) && !options.audioOnly?.();
  const changed = () => {
    if (!disposed) options.changed();
  };
  const observe = () => {
    const scope = options.scope();
    if (scope !== ownScope) {
      epoch++;
      ownScope = scope;
      working = false;
      error = "";
      notice = "";
      assets = [];
      offset = 0;
      total = 0;
      loaded = false;
      name = "";
      mode = "microphone";
      microphone = systemAudio = true;
    }
    if (!modes().includes(mode)) mode = modes()[0] ?? "microphone";
  };
  function request() {
    observe();
    if (disposed || !options.enabled()) throw new Error("当前项目没有工作台录音能力。");
    const bridge = options.bridge();
    if (!bridge) throw new Error("项目连接已关闭。");
    const token = epoch,
      scope = ownScope;
    const check = () => {
      if (disposed || token !== epoch || scope !== options.scope())
        throw new Error("工程已切换；录音文件仍保存在原项目，请回到原项目查看。");
    };
    const call = async (method: string, params: unknown) => {
      check();
      const value = await bridge.call(method, params);
      check();
      return value;
    };
    return { check, call, token };
  }
  async function operation(run: (scope: ReturnType<typeof request>) => Promise<void>) {
    const scope = request();
    if (working) throw new Error("请先完成当前录音或文件操作。");
    working = true;
    error = "";
    changed();
    try {
      await run(scope);
    } catch (cause) {
      if (!disposed && scope.token === epoch && ownScope === options.scope()) {
        error = cause instanceof Error ? cause.message : String(cause);
        changed();
      }
      throw cause;
    } finally {
      if (!disposed && scope.token === epoch && ownScope === options.scope()) {
        working = false;
        changed();
      }
    }
  }
  async function readPage(scope: ReturnType<typeof request>, more: boolean) {
    const start = more ? offset : 0;
    const result = (await scope.call("resources.list", { offset: start, limit: 50 })) as {
      assets?: unknown[];
      total?: number;
    };
    if (
      !result ||
      !Array.isArray(result.assets) ||
      !Number.isSafeInteger(result.total) ||
      Number(result.total) < 0
    )
      throw new Error("项目文件列表无效，已有录音仍保留。");
    const incoming = result.assets
      .filter(
        (asset: any) =>
          typeof asset?.mimeType === "string" &&
          (asset.mimeType.startsWith("audio/") ||
            (allowVideo() && asset.mimeType.startsWith("video/"))),
      )
      .map((value) => recordingAsset(value, allowVideo()));
    scope.check();
    assets = [
      ...new Map([...(more ? assets : []), ...incoming].map((asset) => [asset.id, asset])).values(),
    ];
    offset = start + result.assets.length;
    total = Number(result.total);
    loaded = true;
  }
  const refresh = (more = false) => operation((scope) => readPage(scope, more));
  async function capture() {
    await operation(async (scope) => {
      if (!modes().includes(mode))
        throw new Error("这台设备没有所选采集能力，请刷新或导入已有素材。");
      const capabilities = options.videoCapabilities?.();
      const result = (await scope.call(
        mode === "microphone" ? "resources.recordAudio" : "resources.recordVideo",
        mode === "microphone"
          ? { maxDurationSeconds: options.maxDurationSeconds() }
          : {
              source: mode,
              microphone: microphone && capabilities!.microphone,
              systemAudio: mode === "screen" && systemAudio && capabilities!.systemAudio,
              maxDurationSeconds: Math.min(
                options.maxDurationSeconds(),
                capabilities!.maxDurationSeconds,
              ),
              maxBytes: Math.min(200 * 1024 * 1024, capabilities!.maxBytes),
            },
      )) as {
        cancelled?: boolean;
        asset?: unknown;
        capture?: { source?: string; microphone?: boolean; systemAudio?: boolean };
      };
      if (result?.cancelled === true) {
        notice = "已取消录音。";
        return;
      }
      const asset = recordingAsset(result?.asset, mode !== "microphone");
      if (
        mode !== "microphone" &&
        (!asset.mimeType.startsWith("video/") ||
          result.capture?.source !== mode ||
          typeof result.capture.microphone !== "boolean" ||
          typeof result.capture.systemAudio !== "boolean")
      )
        throw new Error("视频采集回执无效；请刷新项目文件找回已保存原片。");
      assets = [asset, ...assets.filter((item) => item.id !== asset.id)];
      notice =
        mode === "microphone"
          ? "录音文件已保存在当前项目。可先打开试听，再加入本工程素材库；关闭页面后也能从项目音频找回。"
          : `视频原片已保存在当前项目。麦克风${result.capture!.microphone ? "已录入" : "未录入"}，系统声音${result.capture!.systemAudio ? "已录入" : "未录入"}。可先打开检查，再加入工程；关闭页面后可刷新项目文件找回。`;
      changed();
    });
  }
  async function publish(id: string) {
    let completed: (() => void) | undefined;
    await operation(async (scope) => {
      const saved = assets.find((asset) => asset.id === id);
      if (!saved) throw new Error("请先刷新并选择当前项目的录制文件。");
      const current = (await scope.call("resources.get", { id })) as { asset?: unknown };
      const asset = recordingAsset(current?.asset, allowVideo());
      if (asset.id !== saved.id || asset.bytes !== saved.bytes || asset.mimeType !== saved.mimeType)
        throw new Error("录制文件与原回执不一致，请刷新后重试。");
      await options.publish(asset, name.trim() || asset.name, scope.check);
      scope.check();
      notice = asset.mimeType.startsWith("video/")
        ? "视频已加入本工程素材库。"
        : "录音已加入本工程素材库。";
      completed = scope.check;
    });
    // The caller may leave the recording page only after the operation released it.
    completed?.();
    options.saved();
  }
  async function open(id: string) {
    await operation(async (scope) => {
      if (!assets.some((asset) => asset.id === id)) throw new Error("请选择当前列表中的录制文件。");
      await scope.call("resources.open", { assetId: id });
    });
  }
  return {
    enabled: options.enabled,
    modes,
    setMode(value: RecordingMode) {
      observe();
      if (working) throw new Error("请先完成当前录制或文件操作。");
      if (!modes().includes(value)) throw new Error("这台设备没有所选采集能力。");
      mode = value;
    },
    refresh,
    capture,
    publish,
    open,
    get busy() {
      observe();
      return working;
    },
    snapshot() {
      observe();
      return {
        assets: structuredClone(assets),
        busy: working,
        error,
        notice,
        loaded,
        hasMore: offset < total,
        mode,
        modes: modes(),
      };
    },
    input(target: { id: string; value: string }) {
      observe();
      if (
        ![
          "host-recording-name",
          "host-recording-microphone",
          "host-recording-system-audio",
        ].includes(target.id)
      )
        return false;
      if (!working) {
        if (target.id === "host-recording-name") name = target.value.slice(0, 160);
        if (target.id === "host-recording-microphone")
          microphone = (target as { checked?: boolean }).checked === true;
        if (target.id === "host-recording-system-audio")
          systemAudio = (target as { checked?: boolean }).checked === true;
      }
      return true;
    },
    async action(value: string) {
      if (value.startsWith("rec-host-mode:")) {
        const next = value.slice("rec-host-mode:".length) as RecordingMode;
        this.setMode(next);
        changed();
      } else if (value === "rec-host-start") await capture();
      else if (value === "rec-host-refresh") await refresh();
      else if (value === "rec-host-more") await refresh(true);
      else if (value.startsWith("rec-host-open:")) await open(value.slice("rec-host-open:".length));
      else if (value.startsWith("rec-host-save:"))
        await publish(value.slice("rec-host-save:".length));
      else return false;
      return true;
    },
    render(script: string) {
      observe();
      const disabled = working ? "disabled" : "";
      const capabilities = options.videoCapabilities?.();
      const video = allowVideo();
      const kind = video ? "录制文件" : "音频";
      const modeLabel = (value: RecordingMode) =>
        value === "microphone" ? "仅麦克风" : value === "camera" ? "摄像头" : "屏幕";
      return `<div class="section-title"><h2>录制口播</h2><span class="tiny-badge">项目录音</span></div>
        <p class="section-description">${esc(options.description())}</p>
        <p>在工作台录制这台设备的声音${video ? "或画面" : ""}，最长 ${mode === "microphone" ? options.maxDurationSeconds() : Math.min(options.maxDurationSeconds(), capabilities!.maxDurationSeconds)} 秒。停止后预览并保存，再选择文件加入工程。</p>
        ${
          video
            ? `<div class="recording-actions" role="group" aria-label="录制来源">${modes()
                .map(
                  (value) =>
                    `<button data-action="rec-host-mode:${value}" aria-pressed="${mode === value}" ${disabled}>${modeLabel(value)}</button>`,
                )
                .join("")}</div>
          ${mode !== "microphone" && capabilities?.microphone ? `<label><input id="host-recording-microphone" type="checkbox" ${microphone ? "checked" : ""} ${disabled}>录入麦克风</label>` : ""}
          ${mode === "screen" && capabilities?.systemAudio ? `<label><input id="host-recording-system-audio" type="checkbox" ${systemAudio ? "checked" : ""} ${disabled}>请求系统声音（以分享窗口实际提供为准）</label>` : ""}`
            : ""
        }
        <div class="recording-actions"><button data-action="rec-host-start" ${disabled || !modes().length ? "disabled" : ""}>${video ? "打开录制器" : "打开录音器"}</button><button data-action="rec-host-refresh" ${disabled}>刷新项目${kind}</button></div>
        <p class="small muted">${video ? "只显示当前设备支持的来源。开始录制仍需在工作台确认授权；录屏的系统声音取决于设备与分享来源。" : options.audioOnly?.() ? "声音参考只使用音频。" : "当前工作台未提供摄像头或屏幕录制，可导入已有视频；现有素材仍可在项目中编辑。"}</p>
        ${working ? '<p role="status">正在处理录音或项目文件，请完成工作台中的确认。</p>' : ""}
        ${error ? `<p class="conflict" role="alert">${esc(error)} 已保存的原始文件不会因加入工程失败而删除；可以刷新、打开或重试。</p>` : ""}
        ${notice ? `<p role="status">${esc(notice)}</p>` : ""}
        <label class="input-label">加入工程时的名称<input id="host-recording-name" maxlength="160" value="${esc(name)}" placeholder="沿用音频文件名" ${disabled}></label>
        <h3>已保存的项目${kind}</h3>
        <p class="small muted">包含本项目保存的${video ? "音视频" : "音频"}；刷新可找回关闭页面前保存的文件。</p>
        ${assets.length ? assets.map((asset) => `<article class="recording-resource" data-recording-resource="${asset.id}"><strong>${esc(asset.name)}</strong><p>${(asset.bytes / 1024 / 1024).toFixed(1)} MB · ${options.imported(asset.id) ? "已在本工程素材库" : "项目文件"}</p><div class="recording-actions"><button data-action="rec-host-open:${asset.id}" ${disabled}>打开／下载${asset.mimeType.startsWith("video/") ? "视频" : "音频"}</button><button data-action="rec-host-save:${asset.id}" ${disabled}>${esc(options.saveLabel())}</button></div></article>`).join("") : `<p>${loaded ? `这一页没有项目${kind}。可继续加载，或开始录制。` : `点击刷新查看已保存${kind}，或开始新录制。`}</p>`}
        ${offset < total ? `<button data-action="rec-host-more" ${disabled}>加载更多项目文件</button>` : ""}
        ${script ? `<details class="recording-script" open><summary>已确认的提词稿</summary><pre>${esc(script)}</pre></details>` : ""}`;
    },
    assertSafeToLeave() {
      observe();
      if (working) throw new Error("请先结束录音或文件操作，再切换工程。");
    },
    dispose() {
      disposed = true;
      epoch++;
      assets = [];
    },
  };
}
