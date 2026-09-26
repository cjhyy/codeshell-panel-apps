import type { PanelBridge } from "./host";
import type { ManagedAsset } from "./production";
import { escapeHtml as esc } from "./icons";

interface Options {
  bridge(): PanelBridge | undefined;
  enabled(): boolean;
  scope(): string;
  maxDurationSeconds(): number;
  description(): string;
  saveLabel(): string;
  imported(id: string): boolean;
  publish(asset: ManagedAsset, name: string, check: () => void): Promise<void>;
  saved(): void;
  changed(): void;
}
function audioAsset(value: unknown): ManagedAsset {
  const asset = value as ManagedAsset | undefined;
  if (
    !asset ||
    !/^asset-[a-f0-9]{64}$/.test(asset.id) ||
    typeof asset.name !== "string" ||
    !asset.name ||
    asset.name.length > 1024 ||
    typeof asset.mimeType !== "string" ||
    !/^audio\/[a-z0-9.+-]+$/.test(asset.mimeType) ||
    !Number.isSafeInteger(asset.bytes) ||
    asset.bytes < 1 ||
    !Number.isFinite(asset.createdAt)
  )
    throw new Error("项目音频回执无效，请刷新已保存文件后重试。");
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
    }
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
        (asset: any) => typeof asset?.mimeType === "string" && asset.mimeType.startsWith("audio/"),
      )
      .map(audioAsset);
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
      const result = (await scope.call("resources.recordAudio", {
        maxDurationSeconds: options.maxDurationSeconds(),
      })) as { cancelled?: boolean; asset?: unknown };
      if (result?.cancelled === true) {
        notice = "已取消录音。";
        return;
      }
      const asset = audioAsset(result?.asset);
      assets = [asset, ...assets.filter((item) => item.id !== asset.id)];
      notice =
        "录音文件已保存在当前项目。可先打开试听，再加入本工程素材库；关闭页面后也能从项目音频找回。";
      changed();
    });
  }
  async function publish(id: string) {
    let completed: (() => void) | undefined;
    await operation(async (scope) => {
      const saved = assets.find((asset) => asset.id === id);
      if (!saved) throw new Error("请先刷新并选择当前项目的音频。");
      const current = (await scope.call("resources.get", { id })) as { asset?: unknown };
      const asset = audioAsset(current?.asset);
      if (asset.id !== saved.id || asset.bytes !== saved.bytes || asset.mimeType !== saved.mimeType)
        throw new Error("录音文件与原回执不一致，请刷新后重试。");
      await options.publish(asset, name.trim() || asset.name, scope.check);
      scope.check();
      notice = "录音已加入本工程素材库。";
      completed = scope.check;
    });
    // The caller may leave the recording page only after the operation released it.
    completed?.();
    options.saved();
  }
  async function open(id: string) {
    await operation(async (scope) => {
      if (!assets.some((asset) => asset.id === id)) throw new Error("请选择当前列表中的音频。");
      await scope.call("resources.open", { assetId: id });
    });
  }
  return {
    enabled: options.enabled,
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
      };
    },
    input(target: { id: string; value: string }) {
      if (target.id !== "host-recording-name") return false;
      if (!working) name = target.value.slice(0, 160);
      return true;
    },
    async action(value: string) {
      if (value === "rec-host-start") await capture();
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
      return `<div class="section-title"><h2>录制口播</h2><span class="tiny-badge">项目录音</span></div>
        <p class="section-description">${esc(options.description())}</p>
        <p>在工作台录制这台设备的声音，最长 ${options.maxDurationSeconds()} 秒。停止后试听并保存，再选择录音加入工程。</p>
        <div class="recording-actions"><button data-action="rec-host-start" ${disabled}>打开录音器</button><button data-action="rec-host-refresh" ${disabled}>刷新项目音频</button></div>
        <p class="small muted">网页的摄像头与屏幕录制尚未接入，可在桌面录制后导入；现有素材仍可在项目中编辑。</p>
        ${working ? '<p role="status">正在处理录音或项目文件，请完成工作台中的确认。</p>' : ""}
        ${error ? `<p class="conflict" role="alert">${esc(error)} 已保存的原始文件不会因加入工程失败而删除；可以刷新、打开或重试。</p>` : ""}
        ${notice ? `<p role="status">${esc(notice)}</p>` : ""}
        <label class="input-label">加入工程时的名称<input id="host-recording-name" maxlength="160" value="${esc(name)}" placeholder="沿用音频文件名" ${disabled}></label>
        <h3>已保存的项目音频</h3>
        <p class="small muted">包含本 Panel 在此项目保存的录音和其他音频；刷新可找回关闭页面前保存的文件。</p>
        ${assets.length ? assets.map((asset) => `<article class="recording-resource" data-recording-resource="${asset.id}"><strong>${esc(asset.name)}</strong><p>${(asset.bytes / 1024 / 1024).toFixed(1)} MB · ${options.imported(asset.id) ? "已在本工程素材库" : "项目文件"}</p><div class="recording-actions"><button data-action="rec-host-open:${asset.id}" ${disabled}>打开／下载音频</button><button data-action="rec-host-save:${asset.id}" ${disabled}>${esc(options.saveLabel())}</button></div></article>`).join("") : `<p>${loaded ? "这一页没有项目音频。可继续加载，或打开录音器。" : "点击刷新查看已保存音频，或开始新录音。"}</p>`}
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
