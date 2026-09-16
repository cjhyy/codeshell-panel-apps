import {
  planCreateMulticam,
  planMulticamCut,
  planMulticamSwitches,
  planRecordMulticamSwitches,
  planUpdateMulticamAngles,
  type MulticamAlignment,
  type MulticamAlignmentOptions,
} from "./multicam-edits";
import { EditorMediaPool, type EditorMediaPoolOptions } from "./media-pool";
import { FrameCompositor } from "./compositor";
import { defaultColorAdjustment, defaultTransform } from "./defaults";
import type { EvaluatedFrame, EvaluatedMediaLayer } from "./evaluate";
import type { EditorOperation } from "./operations";
import { secondsToTicks, snapToFrame, sourceTimeAt, TICKS_PER_SECOND, type Tick } from "./time";
import type { EditorDocument, MulticamClip } from "./types";

export interface EditorMulticamContext {
  read(): EditorDocument;
  selection(): { sequenceId: string; clipIds: string[] };
  time(): Tick;
  apply(operations: EditorOperation[], label: string): void | Promise<void>;
  select(selection: { sequenceId: string; clipIds: string[] }): void;
  onError(error: unknown): void;
  resolveAsset?: EditorMediaPoolOptions["resolveAsset"];
  alignSources?: (
    assetIds: string[],
    referenceAssetId: string,
    options: MulticamAlignmentOptions,
  ) => Promise<MulticamAlignment>;
  play?: () => void | Promise<void>;
  pause?: () => void;
  playing?: () => boolean;
}
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  text?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = cls;
  if (text !== undefined) element.textContent = text;
  return element;
};
const seconds = (time: number) => String(Number((time / TICKS_PER_SECOND).toFixed(6)));
function input(label: string, value: string, type = "text") {
  const element = node("input");
  element.type = type;
  element.value = value;
  element.setAttribute("aria-label", label);
  if (type === "number") element.step = "0.001";
  return element;
}
function field(label: string, element: HTMLElement) {
  const result = node("label", "emc-field");
  result.append(node("span", "", label), element);
  return result;
}
function select(label: string, options: Array<[string, string]>, value: string) {
  const result = node("select");
  result.setAttribute("aria-label", label);
  for (const [id, text] of options) {
    const option = node("option", "", text);
    option.value = id;
    result.append(option);
  }
  result.value = value;
  return result;
}
function value(element: HTMLInputElement) {
  if (!element.value.trim() || !Number.isFinite(element.valueAsNumber))
    throw new Error("请填写有效数值");
  return element.valueAsNumber;
}
interface Recording {
  documentId: string;
  revision: number;
  sequenceId: string;
  clipId: string;
  start: Tick;
  lastTime: Tick;
  cuts: MulticamClip["switches"];
  started?: boolean;
}

/** Four paused decoders monitor the current page; program audio remains owned by the shared preview. */
export class EditorMulticam {
  private root = node("section", "editor-multicam");
  private disposed = false;
  private visible = true;
  private pending = false;
  private error = "";
  private status = "";
  private signature = "";
  private picked = new Set<string>();
  private assetPage = 0;
  private anglePage = 0;
  private cutPage = 0;
  private alignment: MulticamAlignment | undefined;
  private controller: AbortController | undefined;
  private pool: EditorMediaPool | undefined;
  private compositor = new FrameCompositor();
  private monitorBusy = false;
  private monitorGeneration = 0;
  private lastMonitor = -Infinity;
  private raf = 0;
  private recording: Recording | undefined;
  private view: ReturnType<EditorMulticam["scope"]> | undefined;
  private program: HTMLCanvasElement | undefined;
  private tiles = new Map<
    string,
    { canvas: HTMLCanvasElement; button: HTMLButtonElement; label: HTMLElement }
  >();
  private open = new Set(["多机位监看", "切换记录"]);
  constructor(
    container: HTMLElement,
    private readonly context: EditorMulticamContext,
  ) {
    this.root.setAttribute("aria-label", "多机位剪辑");
    container.append(this.root);
    if (context.resolveAsset)
      this.pool = new EditorMediaPool({ resolveAsset: context.resolveAsset, maxInstances: 5 });
    this.render();
    this.raf = requestAnimationFrame(() => this.tick());
  }
  setVisible(visible: boolean) {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      cancelAnimationFrame(this.raf);
      this.controller?.abort();
      if (this.recording) {
        this.recording = undefined;
        this.context.pause?.();
        this.status = "离开多机位监看，本次未保存切点已放弃";
      }
      this.monitorGeneration++;
      this.pool?.reset();
      this.compositor.dispose();
      this.view = undefined;
    } else {
      this.signature = "";
      this.render();
      this.raf = requestAnimationFrame(() => this.tick());
    }
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controller?.abort();
    if (this.recording) this.context.pause?.();
    this.recording = undefined;
    this.pool?.dispose();
    this.compositor.dispose();
    this.root.remove();
  }
  private scope() {
    const document = this.context.read(),
      selection = this.context.selection(),
      sequence =
        document.sequences.find((seq) => seq.id === selection.sequenceId) ??
        document.sequences.find((seq) => seq.id === document.activeSequenceId)!;
    const selected =
        selection.clipIds.length === 1
          ? sequence.clips.find((clip) => clip.id === selection.clipIds[0])
          : undefined,
      clip = selected?.kind === "multicam" ? selected : undefined;
    return {
      document,
      sequence,
      clip,
      locked: !!clip && !!sequence.tracks.find((track) => track.id === clip.trackId)?.locked,
    };
  }
  private report(error: unknown) {
    const value = error instanceof Error ? error : new Error(String(error));
    this.error = value.message;
    this.context.onError(value);
  }
  private button(text: string, action: () => void, disabled = false) {
    const result = node("button", "", text);
    result.type = "button";
    result.disabled = disabled;
    result.addEventListener("click", action);
    return result;
  }
  private section(title: string) {
    const details = node("details", "emc-section");
    details.open = this.open.has(title);
    details.append(node("summary", "", title));
    details.addEventListener("toggle", () => {
      if (details.open) this.open.add(title);
      else this.open.delete(title);
    });
    const body = node("div", "emc-body");
    details.append(body);
    this.root.querySelector("fieldset")!.append(details);
    return body;
  }
  private async apply(
    label: string,
    make: (document: EditorDocument) => EditorOperation[],
    selectNew = false,
  ) {
    if (this.pending || this.disposed) return;
    try {
      const before = this.context.read(),
        ops = make(before);
      this.pending = true;
      this.error = "";
      this.status = "";
      this.root.querySelector("fieldset")!.disabled = true;
      await this.context.apply(ops, label);
      if (this.disposed) return;
      const after = this.context.read();
      if (selectNew && after.id === before.id && after.revision === before.revision + 1) {
        const added = ops.find((operation) => operation.type === "clip.add");
        if (added?.type === "clip.add")
          this.context.select({ sequenceId: added.sequenceId, clipIds: [added.clip.id] });
      }
      this.status = `${label}已完成，可整体撤销。`;
      this.alignment = undefined;
    } catch (error) {
      if (!this.disposed) this.report(error);
    } finally {
      this.pending = false;
      if (!this.disposed) {
        this.signature = "";
        this.render();
      }
    }
  }
  private active(clip: MulticamClip, local: Tick) {
    let id = clip.switches[0]!.angleId;
    for (const cut of this.recording?.cuts ?? clip.switches) {
      if (cut.time <= local) id = cut.angleId;
      else break;
    }
    return id;
  }
  private choose(angleId: string) {
    const { sequence, clip, locked } = this.scope();
    if (!clip || locked || this.pending) return;
    const local = snapToFrame(
      Math.max(0, this.context.time() - clip.start),
      sequence.frameRate,
      "floor",
    );
    if (this.context.time() < clip.start || local >= clip.duration) {
      this.report(new Error("播放头须位于多机位片段内"));
      this.signature = "";
      this.render();
      return;
    }
    if (this.recording) {
      const record = this.recording;
      if (local < record.lastTime) {
        this.cancelRecord("录制时播放头向后移动，切点未提交，请重新录制");
        return;
      }
      record.lastTime = local;
      const last = record.cuts.at(-1)!;
      if (last.time === local) last.angleId = angleId;
      else if (last.angleId !== angleId) record.cuts.push({ time: local, angleId });
      this.status = `录制中 · ${record.cuts.length} 个切点`;
      this.refreshStatus();
    } else
      void this.apply("切换机位", (doc) =>
        planMulticamCut(doc, sequence.id, clip.id, local, angleId),
      );
  }
  private cancelRecord(message: string) {
    this.recording = undefined;
    this.context.pause?.();
    this.report(new Error(message));
    this.signature = "";
    this.render();
  }
  private async beginRecord() {
    const { document, sequence, clip, locked } = this.scope();
    if (!clip || locked || !this.context.play || this.pending) return;
    const local = snapToFrame(
      Math.max(0, this.context.time() - clip.start),
      sequence.frameRate,
      "floor",
    );
    if (this.context.time() < clip.start || local >= clip.duration) {
      this.report(new Error("请将播放头移到多机位片段内再开始录制"));
      this.signature = "";
      this.render();
      return;
    }
    this.recording = {
      documentId: document.id,
      revision: document.revision,
      sequenceId: sequence.id,
      clipId: clip.id,
      start: local,
      lastTime: local,
      cuts: [{ time: local, angleId: this.active(clip, local) }],
    };
    this.error = "";
    this.status = "录制中 · 点击机位画面或使用 1–4 键切换";
    this.signature = "";
    this.render();
    const recording = this.recording;
    try {
      await this.context.play();
      if (this.recording === recording) recording.started = true;
      else this.context.pause?.();
    } catch (error) {
      if (this.recording === recording) {
        this.recording = undefined;
        this.report(error);
        this.signature = "";
        this.render();
      }
    }
  }
  private async stopRecord() {
    const record = this.recording;
    if (!record) return;
    this.recording = undefined;
    this.context.pause?.();
    const { document, sequence, clip } = this.scope();
    if (
      document.id !== record.documentId ||
      document.revision !== record.revision ||
      sequence.id !== record.sequenceId ||
      clip?.id !== record.clipId
    ) {
      this.cancelRecord("录制期间工程或选择已改变，切点未提交");
      return;
    }
    const end = Math.min(
      clip.duration,
      Math.max(record.lastTime + 1, this.context.time() - clip.start),
    );
    if (end <= record.start) {
      this.status = "未产生有效录制区间";
      this.signature = "";
      this.render();
      return;
    }
    await this.apply("录制机位切换", (doc) => {
      if (doc.id !== record.documentId || doc.revision !== record.revision)
        throw new Error("录制期间工程已改变，请重新录制");
      return planRecordMulticamSwitches(doc, sequence.id, clip.id, record.start, end, record.cuts);
    });
  }
  private refreshStatus() {
    const status = this.root.querySelector<HTMLElement>("[data-emc-status]");
    if (status) status.textContent = this.status;
  }
  private tick() {
    if (this.disposed || !this.visible) return;
    const scope = this.view ?? this.scope();
    if (this.recording) {
      const record = this.recording,
        local = this.context.time() - (scope.clip?.start ?? 0);
      if (
        scope.document.id !== record.documentId ||
        scope.document.revision !== record.revision ||
        scope.clip?.id !== record.clipId ||
        scope.sequence.id !== record.sequenceId
      )
        this.cancelRecord("录制期间工程或选择已改变，切点未提交");
      else if (local < record.lastTime)
        this.cancelRecord("录制时播放头向后移动，切点未提交，请重新录制");
      else if (
        local >= scope.clip.duration ||
        (record.started && this.context.playing?.() === false)
      )
        void this.stopRecord();
      else record.lastTime = snapToFrame(local, scope.sequence.frameRate, "floor");
    }
    if (scope.clip) {
      const local = Math.max(0, this.context.time() - scope.clip.start),
        active = this.active(scope.clip, local);
      for (const [id, tile] of this.tiles)
        tile.button.setAttribute("aria-pressed", String(id === active));
      if (!this.monitorBusy && performance.now() - this.lastMonitor >= 90) void this.drawMonitors();
    }
    this.raf = requestAnimationFrame(() => this.tick());
  }
  private async drawMonitors() {
    const { document, sequence, clip, locked } = this.view ?? this.scope();
    if (
      !clip ||
      !this.pool ||
      !this.tiles.size ||
      !this.visible ||
      !this.root.getClientRects().length
    )
      return;
    const local = this.context.time() - clip.start,
      source = sourceTimeAt(clip.timeMap, Math.max(0, Math.min(clip.duration - 1, local))),
      generation = this.monitorGeneration;
    const layers: EvaluatedMediaLayer[] = [];
    const active = this.active(clip, Math.max(0, local)),
      visible = clip.angles.slice(this.anglePage * 4, this.anglePage * 4 + 4);
    if (!visible.some((angle) => angle.id === active))
      visible.push(clip.angles.find((angle) => angle.id === active)!);
    for (const angle of visible) {
      const tile = this.tiles.get(angle.id),
        asset = document.assets.find((asset) => asset.id === angle.assetId)!;
      const time = source + angle.offset;
      if (local < 0 || local >= clip.duration || time < 0 || time >= asset.duration) {
        if (tile) {
          tile.label.textContent = "此刻无画面";
          tile.button.disabled = true;
          tile.canvas.getContext("2d")!.clearRect(0, 0, tile.canvas.width, tile.canvas.height);
        }
        continue;
      }
      if (tile) tile.button.disabled = locked || this.pending;
      layers.push({
        kind: "media",
        instanceId: `monitor:${sequence.id}:${clip.id}:${angle.id}`,
        sequenceId: sequence.id,
        clipId: clip.id,
        trackId: clip.trackId,
        localTime: local,
        transform: defaultTransform() as EvaluatedMediaLayer["transform"],
        color: defaultColorAdjustment() as EvaluatedMediaLayer["color"],
        blendMode: "normal",
        assetId: asset.id,
        assetKind: "video",
        sourceTime: time,
        naturalWidth: asset.width ?? 1920,
        naturalHeight: asset.height ?? 1080,
        angleId: angle.id,
      });
    }
    if (!layers.length) return;
    this.monitorBusy = true;
    this.lastMonitor = performance.now();
    const frame: EvaluatedFrame = {
      sequenceId: sequence.id,
      time: this.context.time(),
      width: 192,
      height: 108,
      background: "#000000",
      layers,
      audio: [],
    };
    try {
      const media = await this.pool.prepare(frame);
      if (this.disposed || generation !== this.monitorGeneration) return;
      for (const layer of layers) {
        if (layer.angleId === active && this.program) {
          this.compositor.draw(this.program, { ...frame, layers: [layer] }, media);
          this.program.dataset.angle = active;
          this.program.dataset.sourceTime = String(layer.sourceTime);
        }
        const tile = this.tiles.get(layer.angleId!);
        if (!tile) continue;
        this.compositor.draw(tile.canvas, { ...frame, layers: [layer] }, media);
        tile.label.textContent = `素材 ${seconds(layer.sourceTime)} 秒`;
        tile.canvas.dataset.sourceTime = String(layer.sourceTime);
      }
    } catch (error) {
      if (
        !this.disposed &&
        generation === this.monitorGeneration &&
        (error as Error).name !== "AbortError"
      ) {
        for (const tile of this.tiles.values()) tile.label.textContent = "画面读取失败";
        this.report(error);
        this.root.querySelector<HTMLElement>("[data-emc-error]")!.textContent = this.error;
      }
    } finally {
      this.monitorBusy = false;
    }
  }
  private async align(
    assetIds: string[],
    reference: string,
    windowSeconds: number,
    maxOffsetSeconds: number,
  ) {
    if (!this.context.alignSources || this.pending || this.recording) return;
    const before = this.context.read();
    const selection = JSON.stringify(this.context.selection());
    this.pending = true;
    this.error = "";
    this.root.querySelector("fieldset")!.disabled = true;
    this.controller = new AbortController();
    try {
      const result = await this.context.alignSources(assetIds, reference, {
        windowSeconds,
        maxOffsetSeconds,
        signal: this.controller.signal,
      });
      const after = this.context.read();
      if (this.disposed || !this.visible || this.controller?.signal.aborted) return;
      if (
        after.id !== before.id ||
        after.revision !== before.revision ||
        result.documentId !== before.id ||
        result.revision !== before.revision ||
        result.referenceAssetId !== reference ||
        JSON.stringify(this.context.selection()) !== selection
      )
        throw new Error("同步期间工程已改变，请重新分析");
      this.alignment = result;
      this.status = "声音匹配已完成；请检查置信度和偏移后应用。";
    } catch (error) {
      if (!this.disposed && (error as Error).name !== "AbortError") this.report(error);
    } finally {
      this.pending = false;
      this.controller = undefined;
      if (!this.disposed) {
        this.signature = "";
        this.render();
      }
    }
  }
  render() {
    if (this.disposed || this.pending || !this.visible) return;
    const scope = this.scope();
    this.view = scope;
    const { document, sequence, clip, locked } = scope;
    if (
      this.alignment &&
      (this.alignment.documentId !== document.id || this.alignment.revision !== document.revision)
    )
      this.alignment = undefined;
    this.assetPage = Math.min(
      this.assetPage,
      Math.max(
        0,
        Math.ceil(document.assets.filter((asset) => asset.kind === "video").length / 20) - 1,
      ),
    );
    this.anglePage = Math.min(
      this.anglePage,
      Math.max(0, Math.ceil((clip?.angles.length ?? 0) / 4) - 1),
    );
    this.cutPage = Math.min(
      this.cutPage,
      Math.max(0, Math.ceil((clip?.switches.length ?? 0) / 50) - 1),
    );
    const signature = JSON.stringify([
      document.id,
      document.revision,
      this.context.selection(),
      this.assetPage,
      this.anglePage,
      this.cutPage,
      [...this.picked],
      !!this.recording,
      this.alignment,
      this.error,
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.monitorGeneration++;
    this.pool?.reset();
    this.tiles.clear();
    this.program = undefined;
    this.root.replaceChildren(node("header", "emc-header", "多机位剪辑"));
    const fieldset = node("fieldset");
    this.root.append(fieldset);
    const create = this.section("创建机位组"),
      videos = document.assets.filter((asset) => asset.kind === "video");
    for (const id of this.picked)
      if (!videos.some((asset) => asset.id === id)) this.picked.delete(id);
    const checklist = node("div", "emc-assets");
    for (const asset of videos.slice(this.assetPage * 20, this.assetPage * 20 + 20)) {
      const check = input(`选择机位素材 ${asset.name}`, asset.id, "checkbox");
      check.checked = this.picked.has(asset.id);
      check.addEventListener("change", () => {
        if (check.checked) this.picked.add(asset.id);
        else this.picked.delete(asset.id);
        this.alignment = undefined;
        this.signature = "";
        this.render();
      });
      const row = node("label");
      row.append(check, node("span", "", asset.name));
      checklist.append(row);
    }
    create.append(checklist);
    const paging = node("div", "emc-actions");
    paging.append(
      this.button(
        "上一页素材",
        () => {
          this.assetPage--;
          this.render();
        },
        this.assetPage === 0,
      ),
      node("span", "emc-note", `${this.picked.size} 个已选 / ${videos.length} 个视频`),
      this.button(
        "下一页素材",
        () => {
          this.assetPage++;
          this.render();
        },
        (this.assetPage + 1) * 20 >= videos.length,
      ),
    );
    create.append(paging);
    const groupName = input("机位组名称", "多机位节目");
    create.append(
      field("机位组名称", groupName),
      this.button(
        "创建多机位片段",
        () =>
          void this.apply(
            "创建多机位片段",
            (doc) =>
              planCreateMulticam(doc, sequence.id, {
                assetIds: [...this.picked],
                at: this.context.time(),
                name: groupName.value,
                ...(this.alignment
                  ? {
                      offsets: Object.fromEntries(
                        this.alignment.results.map((item) => [item.assetId, item.offset]),
                      ),
                    }
                  : {}),
              }),
            true,
          ),
        this.picked.size < 2 ||
          this.picked.size > 32 ||
          !!this.recording ||
          !!this.alignment?.results.some((item) => !item.reliable),
      ),
    );
    create.append(
      node(
        "p",
        "emc-note",
        "使用各机位共同有效的时间范围；素材原片仍保留。同步偏移：该机位素材时间 = 基准时间 + 偏移。",
      ),
    );
    const assetIds = clip ? clip.angles.map((angle) => angle.assetId) : [...this.picked];
    if (assetIds.length >= 2) {
      const align = this.section("声音同步"),
        reference = select(
          "声音对齐基准",
          assetIds.map((id) => [id, document.assets.find((asset) => asset.id === id)!.name]),
          clip?.angles.find((angle) => angle.id === clip.audioAngleId)?.assetId ?? assetIds[0]!,
        );
      const window = input("分析开头（秒）", "30", "number"),
        maximum = input("最大偏移（秒）", "10", "number");
      window.step = maximum.step = "1";
      align.append(
        field("声音对齐基准", reference),
        field("分析开头（秒）", window),
        field("最大偏移（秒）", maximum),
        this.button(
          "分析真实声音",
          () => {
            try {
              void this.align(assetIds, reference.value, value(window), value(maximum));
            } catch (error) {
              this.report(error);
              this.signature = "";
              this.render();
            }
          },
          !this.context.alignSources || !!this.recording || locked,
        ),
      );
      align.append(
        node(
          "p",
          "emc-note",
          "分析前段共同声音，分辨率 5 毫秒。静音、重复节奏或相似度不足时不会自动应用。",
        ),
      );
      if (this.alignment) {
        const list = node("div", "emc-results");
        for (const result of this.alignment.results)
          list.append(
            node(
              "p",
              "",
              `${document.assets.find((asset) => asset.id === result.assetId)?.name} · ${seconds(result.offset)} 秒 · 匹配 ${(result.confidence * 100).toFixed(1)}%${result.reliable ? "" : " · 需手动确认"}${result.reason ? `：${result.reason}` : ""}`,
            ),
          );
        align.append(list);
        if (clip)
          align.append(
            this.button(
              "应用同步并裁剪共同范围",
              () =>
                void this.apply("同步多机位", (doc) =>
                  planUpdateMulticamAngles(
                    doc,
                    sequence.id,
                    clip.id,
                    {
                      angles: clip.angles.map((angle) => ({
                        ...angle,
                        offset: this.alignment!.results.find(
                          (result) => result.assetId === angle.assetId,
                        )!.offset,
                      })),
                    },
                    { trimToCommonRange: true },
                  ),
                ),
              locked || this.alignment.results.some((item) => !item.reliable),
            ),
          );
      }
    }
    if (clip) {
      const monitor = this.section("多机位监看"),
        grid = node("div", "emc-grid");
      for (const [index, angle] of clip.angles
        .slice(this.anglePage * 4, this.anglePage * 4 + 4)
        .entries()) {
        const button = this.button(
          `${index + 1} · ${angle.name}`,
          () => this.choose(angle.id),
          locked,
        );
        button.setAttribute("aria-label", `切换到机位 ${angle.name}`);
        button.setAttribute("aria-pressed", "false");
        const canvas = node("canvas"),
          label = node("small", "", this.pool ? "正在读取画面" : "未连接素材预览");
        canvas.width = 192;
        canvas.height = 108;
        button.append(canvas, label);
        grid.append(button);
        this.tiles.set(angle.id, { canvas, button, label });
      }
      const program = node("canvas", "emc-program");
      program.width = 192;
      program.height = 108;
      program.setAttribute("aria-label", "切换录制节目画面");
      this.program = program;
      monitor.append(node("span", "emc-note", "切换录制节目画面"), program, grid);
      const pages = node("div", "emc-actions");
      pages.append(
        this.button(
          "上一组机位",
          () => {
            this.anglePage--;
            this.render();
          },
          this.anglePage === 0,
        ),
        this.button(
          "下一组机位",
          () => {
            this.anglePage++;
            this.render();
          },
          (this.anglePage + 1) * 4 >= clip.angles.length,
        ),
      );
      monitor.append(pages);
      monitor.tabIndex = 0;
      monitor.setAttribute("aria-label", "机位切换键盘区");
      monitor.addEventListener("keydown", (event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
          return;
        const index = Number(event.key) - 1;
        if (index >= 0 && index < 4) {
          const angle = clip.angles[this.anglePage * 4 + index];
          if (angle) {
            event.preventDefault();
            this.choose(angle.id);
          }
        }
      });
      const recordControls = node("div", "emc-actions");
      recordControls.append(
        this.button(
          this.recording ? "停止并保存切换" : "播放并录制切换",
          () => {
            if (this.recording) void this.stopRecord();
            else void this.beginRecord();
          },
          locked || !this.context.play,
        ),
        this.button(
          "放弃本次录制",
          () => {
            this.recording = undefined;
            this.context.pause?.();
            this.status = "本次切点未保存";
            this.signature = "";
            this.render();
          },
          !this.recording,
        ),
      );
      monitor.append(
        recordControls,
        node(
          "p",
          "emc-note",
          "点击画面可在当前播放头建立切点。录制时聚焦机位区可按 1–4；声音始终使用选定主声音，不随画面跳转。",
        ),
      );
      const settings = this.section("机位偏移与主声音"),
        rows: Array<{ id: string; name: HTMLInputElement; offset: HTMLInputElement }> = [];
      for (const angle of clip.angles) {
        const row = node("div", "emc-angle"),
          name = input(`机位 ${angle.name} 名称`, angle.name),
          offset = input(`机位 ${angle.name} 偏移（秒）`, seconds(angle.offset), "number");
        rows.push({ id: angle.id, name, offset });
        row.append(field("机位名称", name), field("偏移（秒）", offset));
        settings.append(row);
      }
      const master = select(
          "连续主声音机位",
          clip.angles.map((angle) => [angle.id, angle.name]),
          clip.audioAngleId,
        ),
        trim = input("裁剪到所有机位的共同范围", "", "checkbox");
      settings.append(
        field("连续主声音机位", master),
        field("裁剪到所有机位的共同范围", trim),
        this.button(
          "保存机位设置",
          () =>
            void this.apply("更新机位设置", (doc) =>
              planUpdateMulticamAngles(
                doc,
                sequence.id,
                clip.id,
                {
                  angles: clip.angles.map((angle) => {
                    const row = rows.find((row) => row.id === angle.id)!;
                    return {
                      ...angle,
                      name: row.name.value,
                      offset: Math.round(value(row.offset) * TICKS_PER_SECOND),
                    };
                  }),
                  audioAngleId: master.value,
                },
                { trimToCommonRange: trim.checked },
              ),
            ),
          locked || !!this.recording,
        ),
      );
      const cuts = this.section("切换记录"),
        table = node("div", "emc-cuts"),
        cutRows: Array<{ index: number; time: HTMLInputElement; angle: HTMLSelectElement }> = [];
      for (const [pageIndex, cut] of clip.switches
        .slice(this.cutPage * 50, this.cutPage * 50 + 50)
        .entries()) {
        const index = this.cutPage * 50 + pageIndex,
          row = node("div", "emc-cut"),
          time = input(`切点 ${index + 1} 时间（秒）`, seconds(cut.time), "number"),
          angle = select(
            `切点 ${index + 1} 机位`,
            clip.angles.map((angle) => [angle.id, angle.name]),
            cut.angleId,
          );
        if (index === 0) time.disabled = true;
        cutRows.push({ index, time, angle });
        row.append(
          time,
          angle,
          this.button(
            `删除切点 ${index + 1}`,
            () =>
              void this.apply("删除机位切点", (doc) =>
                planMulticamSwitches(
                  doc,
                  sequence.id,
                  clip.id,
                  clip.switches.filter((_, i) => i !== index),
                ),
              ),
            index === 0 || locked || !!this.recording,
          ),
        );
        table.append(row);
      }
      cuts.append(
        table,
        this.button(
          "保存切点表",
          () =>
            void this.apply("编辑机位切点", (doc) => {
              const switches = structuredClone(clip.switches);
              for (const row of cutRows)
                switches[row.index] = {
                  time: secondsToTicks(value(row.time)),
                  angleId: row.angle.value,
                };
              return planMulticamSwitches(doc, sequence.id, clip.id, switches);
            }),
          locked || !!this.recording,
        ),
      );
      const cutPaging = node("div", "emc-actions");
      cutPaging.append(
        this.button(
          "上一页切点",
          () => {
            this.cutPage--;
            this.render();
          },
          this.cutPage === 0,
        ),
        node("span", "emc-note", `共 ${clip.switches.length} 个切点`),
        this.button(
          "下一页切点",
          () => {
            this.cutPage++;
            this.render();
          },
          (this.cutPage + 1) * 50 >= clip.switches.length,
        ),
      );
      cuts.append(cutPaging);
    } else
      this.root.append(node("p", "emc-empty", "从素材创建机位组，或在时间轴选择一个多机位片段。"));
    const error = node("p", "emc-error", this.error);
    error.dataset.emcError = "";
    error.setAttribute("role", "alert");
    const status = node("p", "emc-status", this.status);
    status.dataset.emcStatus = "";
    status.setAttribute("role", "status");
    this.root.append(error, status);
  }
}
export function mountEditorMulticam(
  container: HTMLElement,
  context: EditorMulticamContext,
): EditorMulticam {
  return new EditorMulticam(container, context);
}
