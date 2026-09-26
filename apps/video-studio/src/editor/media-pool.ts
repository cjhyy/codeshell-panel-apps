import type { EvaluatedFrame, EvaluatedLayer, EvaluatedMediaLayer } from "./evaluate";
import { ticksToSeconds } from "./time";
import { drawDemo } from "../demo-drawing";

export interface ResolvedMediaResource {
  url: string;
  /** Transfer a blob URL's lifetime to this pool. All other URLs remain borrowed. */
  owned?: boolean;
}
export interface EditorMediaPoolOptions {
  resolveAsset(
    assetId: string,
    signal: AbortSignal,
  ): string | ResolvedMediaResource | Promise<string | ResolvedMediaResource>;
  maxInstances?: number;
  timeoutMs?: number;
}
export class MediaPoolError extends Error {
  constructor(
    readonly code:
      | "aborted"
      | "timeout"
      | "capacity"
      | "decode"
      | "resolve"
      | "disposed"
      | "conflict",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = code === "aborted" ? "AbortError" : "MediaPoolError";
  }
}
interface Resource extends ResolvedMediaResource {
  assetId: string;
}
interface Instance {
  assetId: string;
  kind: EvaluatedMediaLayer["assetKind"];
  element: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
  /** Image assets are the first static frame, even when their bytes contain an animation. */
  bitmap?: ImageBitmap;
  videoFrame?: VideoFrame;
  preparedSource?: number;
}
interface Request {
  controller: AbortController;
  generation: number;
}

const aborted = () => new MediaPoolError("aborted", "画面准备已取消或被较新的请求替代");
function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw aborted();
}

function boundedInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${label}必须是 ${min}–${max} 范围内的整数`);
  return value;
}

/** Every visible endpoint is required, including locally drawn legacy demo assets. */
function requiredMedia(frame: EvaluatedFrame): Map<string, EvaluatedMediaLayer> {
  const required = new Map<string, EvaluatedMediaLayer>();
  function visit(layer: EvaluatedLayer): void {
    if (layer.kind === "group") layer.layers.forEach(visit);
    else if (layer.kind === "transition") {
      if (layer.from) visit(layer.from);
      if (layer.to) visit(layer.to);
    } else if (layer.kind === "media") {
      const previous = required.get(layer.instanceId);
      if (
        previous &&
        (previous.assetId !== layer.assetId ||
          previous.assetKind !== layer.assetKind ||
          previous.sourceTime !== layer.sourceTime)
      )
        throw new MediaPoolError("conflict", `同一画面实例包含不同素材或时间：${layer.instanceId}`);
      if (layer.assetKind === "audio")
        throw new MediaPoolError("decode", "声音素材不能作为画面解码");
      required.set(layer.instanceId, layer);
    }
  }
  frame.layers.forEach(visit);
  return required;
}

function waitFor<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      error === undefined ? resolve(result!) : reject(error);
    };
    const cancel = () => finish(aborted());
    const timer = setTimeout(
      () => finish(new MediaPoolError("timeout", timeoutMessage)),
      timeoutMs,
    );
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(
      (result) => finish(undefined, result),
      (error) => finish(error),
    );
    if (signal.aborted) cancel();
  });
}

function videoReady(video: HTMLVideoElement): boolean {
  return (
    !video.seeking &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  );
}

function loadVideo(
  video: HTMLVideoElement,
  url: string,
  signal: AbortSignal,
  timeoutMs: number,
  assetId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const events = ["loadedmetadata", "loadeddata", "canplay"];
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const event of events) video.removeEventListener(event, inspect);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", cancel);
      error ? reject(error) : resolve();
    };
    const inspect = () => {
      if (videoReady(video)) finish();
    };
    const failed = () => finish(new MediaPoolError("decode", `无法解码视频素材：${assetId}`));
    const cancel = () => finish(aborted());
    const timer = setTimeout(
      () => finish(new MediaPoolError("timeout", `视频素材加载超时：${assetId}`)),
      timeoutMs,
    );
    for (const event of events) video.addEventListener(event, inspect);
    video.addEventListener("error", failed);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    video.src = url;
    video.load();
    inspect();
  });
}

function seekVideo(
  video: HTMLVideoElement,
  seconds: number,
  signal: AbortSignal,
  timeoutMs: number,
  assetId: string,
): Promise<VideoFrame> {
  // Media clocks have microsecond precision. Rounding a rational frame boundary
  // down can select the preceding picture forever (for example 26/30 seconds).
  // Choose the first representable instant at/after the requested source tick.
  const seekTime = Math.ceil(seconds * 1_000_000) / 1_000_000;
  return new Promise((resolve, reject) => {
    let settled = false,
      sought = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let callback: number | undefined;
    let presentedTime: number | undefined;
    let decodedTiming: { timestamp: number; duration: number | null } | undefined;
    const finish = (error?: unknown, frame?: VideoFrame) => {
      if (settled) {
        frame?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(poll);
      if (callback !== undefined) video.cancelVideoFrameCallback(callback);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", inspect);
      video.removeEventListener("canplay", inspect);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", cancel);
      error ? reject(error) : resolve(frame!);
    };
    const inspect = () => {
      clearTimeout(poll);
      if (settled) return;
      if (
        sought &&
        videoReady(video) &&
        Math.abs(video.currentTime - seconds) < 0.000_01
      ) {
        let frame: VideoFrame;
        try {
          frame = new VideoFrame(video);
        } catch (cause) {
          // HAVE_CURRENT_DATA may precede an accessible frame object in Chromium.
          // Only its transient no-frame state is retried, under the same deadline.
          if (cause instanceof DOMException && cause.name === "InvalidStateError") {
            poll = setTimeout(inspect, 16);
            return;
          }
          finish(new MediaPoolError("decode", `无法读取视频帧：${assetId}`, { cause }));
          return;
        }
        // The media clock can reach the seek target before the drawable surface.
        // Validate the decoded frame's own interval, then retain that exact frame
        // rather than drawing the mutable video element later. Use the browser's
        // microsecond media clock: requested rational frame boundaries may truncate.
        decodedTiming = { timestamp: frame.timestamp, duration: frame.duration };
        const time = Math.floor(video.currentTime * 1_000_000 + 0.000_1);
        if (
          frame.timestamp <= time + 1 &&
          ((frame.duration !== null &&
            frame.duration > 0 &&
            time < frame.timestamp + frame.duration) ||
            (presentedTime !== undefined && Math.abs(presentedTime - frame.timestamp) <= 1))
        ) {
          finish(undefined, frame);
          return;
        }
        frame.close();
      }
      // Paused/offscreen videos need not present a new frame, so presentation
      // callbacks must not be the only wake-up mechanism. This poll shares the
      // existing deadline and is cancelled with the request.
      poll = setTimeout(inspect, 16);
    };
    const onSeeked = () => {
      sought = true;
      inspect();
    };
    const failed = () => finish(new MediaPoolError("decode", `视频寻帧失败：${assetId}`));
    const cancel = () => finish(aborted());
    const timer = setTimeout(
      () => finish(new MediaPoolError("timeout", `视频寻帧或解码超时：${assetId} ${JSON.stringify({
        target: seconds, current: video.currentTime, sought, seeking: video.seeking,
        readyState: video.readyState, decodedTiming, presentedTime,
      })}`)),
      timeoutMs,
    );
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadeddata", inspect);
    video.addEventListener("canplay", inspect);
    video.addEventListener("error", failed);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    try {
      // Some containers round durations (WebM) or omit them. A presentation
      // receipt for this seek can also confirm the frozen frame, but is not
      // required when the frame's own interval already covers the target.
      if (typeof video.requestVideoFrameCallback === "function") {
        callback = video.requestVideoFrameCallback((_now, metadata) => {
          callback = undefined;
          if (videoReady(video) && Math.abs(video.currentTime - seconds) < 0.000_01)
            presentedTime = metadata.mediaTime * 1_000_000;
          inspect();
        });
      }
      video.currentTime = seekTime;
    } catch (cause) {
      finish(new MediaPoolError("decode", `无法定位视频素材：${assetId}`, { cause }));
    }
  });
}

/**
 * Frozen resource URLs are shared by asset, but every clip instance has its own
 * paused decoder. Consume a prepared map before starting another preparation:
 * its frozen video frames and image bitmaps may be released by the next request.
 * Reset when an existing asset ID is rebound to different resource bytes.
 */
export class EditorMediaPool {
  private readonly maxInstances: number;
  private readonly timeoutMs: number;
  private instances = new Map<string, Instance>();
  private resources = new Map<string, Resource>();
  private urlLifetimes = new Map<string, { references: number; owned: boolean }>();
  private pending?: Request;
  private generation = 0;
  private disposed = false;

  constructor(private readonly options: EditorMediaPoolOptions) {
    if (typeof options.resolveAsset !== "function") throw new Error("必须提供素材资源解析器");
    this.maxInstances = boundedInteger(options.maxInstances ?? 32, 1, 256, "同时解码实例上限");
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 15_000, 1, 120_000, "媒体等待时限");
  }

  private releaseInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    this.instances.delete(instanceId);
    instance.bitmap?.close();
    instance.videoFrame?.close();
    if (instance.element instanceof HTMLVideoElement) instance.element.pause();
    instance.element.removeAttribute("src");
    if (instance.element instanceof HTMLVideoElement) instance.element.load();
    if (instance.element instanceof HTMLCanvasElement) {
      instance.element.width = 0;
      instance.element.height = 0;
    }
    instance.element.remove();
  }

  private retainResource(resource: Resource): void {
    const lifetime = this.urlLifetimes.get(resource.url) ?? { references: 0, owned: false };
    lifetime.references++;
    lifetime.owned ||= Boolean(resource.owned);
    this.urlLifetimes.set(resource.url, lifetime);
  }

  private releaseResource(resource: Resource): void {
    const lifetime = this.urlLifetimes.get(resource.url);
    if (!lifetime) return;
    lifetime.references--;
    if (lifetime.references) return;
    this.urlLifetimes.delete(resource.url);
    if (lifetime.owned) URL.revokeObjectURL(resource.url);
  }

  private clearResources(): void {
    for (const instanceId of this.instances.keys()) this.releaseInstance(instanceId);
    for (const resource of this.resources.values()) this.releaseResource(resource);
    this.resources.clear();
  }

  /** Cancel pending work, release all decoders/owned URLs, and permit a new generation. */
  reset(): void {
    this.generation++;
    this.pending?.controller.abort();
    this.pending = undefined;
    this.clearResources();
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  private async resource(assetId: string, request: Request): Promise<Resource> {
    const existing = this.resources.get(assetId);
    if (existing) return existing;
    const promise = Promise.resolve()
      .then(() => {
        assertActive(request.controller.signal);
        return this.options.resolveAsset(assetId, request.controller.signal);
      })
      .then(
        (result) => {
          const raw = typeof result === "string" ? { url: result } : result;
          if (
            !raw ||
            typeof raw.url !== "string" ||
            !raw.url.trim() ||
            (raw.owned !== undefined && typeof raw.owned !== "boolean") ||
            (raw.owned && !raw.url.startsWith("blob:"))
          )
            throw new MediaPoolError("resolve", `素材资源 URL 或所有权无效：${assetId}`);
          const resource: Resource = { assetId, url: raw.url, owned: raw.owned ?? false };
          this.retainResource(resource);
          if (
            request.controller.signal.aborted ||
            request.generation !== this.generation ||
            this.disposed
          ) {
            // A resolver can ignore cancellation and return an owned URL later.
            this.releaseResource(resource);
            throw aborted();
          }
          this.resources.set(assetId, resource);
          return resource;
        },
        (cause) => {
          if (request.controller.signal.aborted) throw aborted();
          throw new MediaPoolError("resolve", `无法读取素材资源：${assetId}`, { cause });
        },
      );
    return waitFor(
      promise,
      request.controller.signal,
      this.timeoutMs,
      `素材资源解析超时：${assetId}`,
    );
  }

  private async decode(layer: EvaluatedMediaLayer, request: Request): Promise<CanvasImageSource> {
    const signal = request.controller.signal;
    assertActive(signal);
    let instance = this.instances.get(layer.instanceId);
    if (layer.assetKind === "demo") {
      if (!instance) {
        instance = {
          assetId: layer.assetId,
          kind: "demo",
          element: document.createElement("canvas"),
        };
        this.instances.set(layer.instanceId, instance);
      }
      const canvas = instance.element as HTMLCanvasElement;
      if (
        instance.preparedSource !== layer.sourceTime ||
        canvas.width !== layer.naturalWidth ||
        canvas.height !== layer.naturalHeight
      ) {
        canvas.width = layer.naturalWidth;
        canvas.height = layer.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new MediaPoolError("decode", "无法创建示例画面");
        const index = layer.assetId === "demo-city" ? 1 : layer.assetId === "demo-outro" ? 2 : 0;
        drawDemo(
          context,
          canvas.width,
          canvas.height,
          index,
          ticksToSeconds(layer.sourceTime) * 30,
        );
        instance.preparedSource = layer.sourceTime;
      }
      return canvas;
    }
    const resource = this.resources.get(layer.assetId)!;
    if (!instance) {
      const element = layer.assetKind === "image" ? new Image() : document.createElement("video");
      element.crossOrigin = "anonymous";
      instance = { assetId: layer.assetId, kind: layer.assetKind, element };
      this.instances.set(layer.instanceId, instance);
      if (element instanceof HTMLVideoElement) {
        element.muted = true;
        element.defaultMuted = true;
        element.playsInline = true;
        element.preload = "auto";
        await loadVideo(element, resource.url, signal, this.timeoutMs, layer.assetId);
      } else {
        element.src = resource.url;
        try {
          await waitFor(element.decode(), signal, this.timeoutMs, `图片解码超时：${layer.assetId}`);
        } catch (cause) {
          if (cause instanceof MediaPoolError) throw cause;
          throw new MediaPoolError("decode", `无法解码图片素材：${layer.assetId}`, { cause });
        }
        if (!element.naturalWidth || !element.naturalHeight)
          throw new MediaPoolError("decode", `图片没有可用画面：${layer.assetId}`);
        if (typeof createImageBitmap !== "function")
          throw new MediaPoolError("decode", "当前浏览器无法冻结图片的静态首帧");
        // createImageBitmap(HTMLImageElement) uses an animated image's default/first frame.
        // Keep the bitmap's lifetime with its instance, including late completion after cancellation.
        const owner = instance;
        const freezing = createImageBitmap(element).then((bitmap) => {
          if (
            signal.aborted ||
            request.generation !== this.generation ||
            this.instances.get(layer.instanceId) !== owner
          ) {
            bitmap.close();
            throw aborted();
          }
          owner.bitmap = bitmap;
          return bitmap;
        });
        try {
          await waitFor(freezing, signal, this.timeoutMs, `图片首帧准备超时：${layer.assetId}`);
        } catch (cause) {
          if (cause instanceof MediaPoolError) throw cause;
          throw new MediaPoolError("decode", `无法冻结图片首帧：${layer.assetId}`, { cause });
        }
        element.removeAttribute("src");
      }
    }
    assertActive(signal);
    const element = instance.element;
    if (element instanceof HTMLVideoElement) {
      const seconds = ticksToSeconds(layer.sourceTime);
      if (Number.isFinite(element.duration) && seconds >= element.duration)
        throw new MediaPoolError("decode", `请求画面已超出视频源时长：${layer.assetId}`);
      if (
        instance.preparedSource !== layer.sourceTime ||
        !videoReady(element) ||
        Math.abs(element.currentTime - seconds) >= 0.000_01
      ) {
        const decoded = await seekVideo(element, seconds, signal, this.timeoutMs, layer.assetId);
        if (signal.aborted || request.generation !== this.generation) {
          decoded.close();
          throw aborted();
        }
        instance.videoFrame?.close();
        instance.videoFrame = decoded;
      }
      assertActive(signal);
      instance.preparedSource = layer.sourceTime;
    }
    return instance.videoFrame ?? instance.bitmap ?? element;
  }

  async prepare(
    frame: EvaluatedFrame,
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, CanvasImageSource>> {
    if (this.disposed) throw new MediaPoolError("disposed", "媒体解码池已释放");
    if (this.pending) this.reset();
    const request: Request = { controller: new AbortController(), generation: this.generation };
    this.pending = request;
    const cancel = () => {
      request.controller.abort();
      if (this.pending === request) this.clearResources();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      assertActive(request.controller.signal);
      const required = requiredMedia(frame);
      if (required.size > this.maxInstances)
        throw new MediaPoolError(
          "capacity",
          `当前画面需要 ${required.size} 个解码实例，超过上限 ${this.maxInstances}`,
        );
      const assetIds = new Set(
        [...required.values()]
          .filter((layer) => layer.assetKind !== "demo")
          .map((layer) => layer.assetId),
      );
      for (const [id, instance] of this.instances) {
        const layer = required.get(id);
        if (!layer || layer.assetId !== instance.assetId || layer.assetKind !== instance.kind)
          this.releaseInstance(id);
      }
      for (const [id, resource] of this.resources) {
        if (assetIds.has(id)) continue;
        this.resources.delete(id);
        this.releaseResource(resource);
      }
      await Promise.all([...assetIds].map((id) => this.resource(id, request)));
      assertActive(request.controller.signal);
      const surfaces = await Promise.all(
        [...required.values()].map(
          async (layer) => [layer.instanceId, await this.decode(layer, request)] as const,
        ),
      );
      assertActive(request.controller.signal);
      return new Map(surfaces);
    } catch (error) {
      if (this.pending === request) {
        request.controller.abort();
        this.clearResources();
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
      if (this.pending === request) this.pending = undefined;
    }
  }
}
