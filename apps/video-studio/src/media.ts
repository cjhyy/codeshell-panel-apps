import {
  timelineClips,
  timelineDuration,
  type Asset,
  type Project,
  type CaptionStyle,
} from "./model";
import { isDemoNarration, demoSceneIndex } from "./demo";

export interface LocalMedia {
  file?: File;
  ownsUrl?: boolean;
  url: string;
  element: HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
  thumbnail?: string;
  source?: MediaElementAudioSourceNode;
  gain?: GainNode;
  audioConnected?: boolean;
  duration?: number;
  width?: number;
  height?: number;
}

function cancelled(): Error {
  return new Error("素材读取已取消");
}

function eventOnce(
  element: EventTarget,
  event: string,
  start?: () => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => done(new Error("素材读取超时，请检查文件格式")), 15000);
    function done(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      element.removeEventListener(event, success);
      element.removeEventListener("error", failure);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    }
    const success = () => done();
    const failure = () => done(new Error("浏览器无法解码此素材，请转换为 MP4 / WebM / WAV 后重试"));
    const abort = () => done(cancelled());
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    element.addEventListener(event, success, { once: true });
    element.addEventListener("error", failure, { once: true });
    try {
      start?.();
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function seekMedia(
  element: HTMLMediaElement,
  seconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw cancelled();
  if (
    !element.seeking &&
    Math.abs(element.currentTime - seconds) < 0.012 &&
    element.readyState >= 2
  )
    return;
  await eventOnce(
    element,
    "seeked",
    () => {
      element.currentTime = seconds;
    },
    signal,
  );
}

async function mediaDuration(element: HTMLMediaElement, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) throw cancelled();
  if (Number.isFinite(element.duration) && element.duration > 0) return element.duration;
  // MediaRecorder WebM files commonly omit Duration. Seeking beyond the end
  // asks Chromium to inspect the final cluster without copying the file.
  const probeTime = 1e10;
  const duration = await new Promise<number>((resolve, reject) => {
    let settled = false;
    const finish = (value?: number, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      element.removeEventListener("durationchange", inspect);
      element.removeEventListener("seeked", inspect);
      element.removeEventListener("error", failure);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value!);
    };
    const inspect = (event: Event) => {
      if (element.seeking) return;
      if (Number.isFinite(element.duration) && element.duration > 0) finish(element.duration);
      else if (
        event.type === "seeked" &&
        element.currentTime > 0 &&
        element.currentTime < probeTime
      )
        finish(element.currentTime);
    };
    const failure = () => finish(undefined, new Error("素材时长读取失败，请检查文件格式"));
    const abort = () => finish(undefined, cancelled());
    const timer = setTimeout(
      () => finish(undefined, new Error("素材时长探测超时，请转换为带时长信息的视频后重试")),
      15000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    element.addEventListener("durationchange", inspect);
    element.addEventListener("seeked", inspect);
    element.addEventListener("error", failure);
    try {
      element.currentTime = probeTime;
    } catch {
      failure();
    }
  });
  await seekMedia(element, 0, signal);
  return duration;
}

/** Wait for the sought frame to reach composition, not just the media clock. */
function firstVideoFrame(element: HTMLVideoElement, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false,
      sought = false,
      presented = false,
      videoCallback: number | undefined,
      animation: number | undefined;
    const frameCallbacks = typeof element.requestVideoFrameCallback === "function";
    // Covers are optional. Hidden or stalled renderers must not hold up imports.
    const timer = setTimeout(() => finish(false), 1000);
    function finish(ready: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (videoCallback !== undefined) element.cancelVideoFrameCallback(videoCallback);
      if (animation !== undefined) cancelAnimationFrame(animation);
      element.removeEventListener("seeked", onSeeked);
      element.removeEventListener("error", unavailable);
      signal.removeEventListener("abort", unavailable);
      resolve(ready);
    }
    const unavailable = () => finish(false);
    const onSeeked = () => {
      sought = true;
      if (presented) finish(true);
      else if (!frameCallbacks)
        animation = requestAnimationFrame(() => {
          animation = requestAnimationFrame(() => finish(true));
        });
    };
    element.addEventListener("seeked", onSeeked);
    element.addEventListener("error", unavailable);
    signal.addEventListener("abort", unavailable, { once: true });
    try {
      if (frameCallbacks)
        videoCallback = element.requestVideoFrameCallback(() => {
          presented = true;
          if (sought) finish(true);
        });
      // Register before seeking on a fresh decoder. It has not played or probed
      // the end for duration, so an older frame cannot satisfy this callback.
      element.currentTime = 0;
    } catch {
      finish(false);
    }
  });
}

/** Called only on a new decoder, before it becomes available to either player. */
async function sourceThumbnail(
  element: HTMLVideoElement | HTMLAudioElement | HTMLImageElement,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (element instanceof HTMLVideoElement) {
    if (!(await firstVideoFrame(element, signal))) return;
    if (!element.videoWidth || !element.videoHeight || element.readyState < 2) return;
  } else if (element instanceof HTMLImageElement) {
    await element.decode();
    if (!element.naturalWidth || !element.naturalHeight) return;
  } else return;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  try {
    contain(ctx, element, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    // An unavailable canvas must not make an otherwise playable source missing.
    return element instanceof HTMLImageElement ? element.src : undefined;
  }
}

export class MediaLibrary {
  items = new Map<string, LocalMedia>();
  audio?: AudioContext;
  destination?: MediaStreamAudioDestinationNode;
  private playbackOwner?: symbol;
  private voices = new Set<LocalMedia>();
  private generation = 0;
  private loads = new Map<string, AbortController>();
  private activeVideo?: LocalMedia;
  private seekRequest = 0;
  private videoQueue: Promise<unknown> = Promise.resolve();
  private videoRequests = new Set<AbortController>();
  private videoElements = new Set<HTMLVideoElement>();
  private thumbnails = new Map<string, Promise<string | undefined>>();

  /** One foreground video plus one serial import/frame probe, independent of library size. */
  async withVideoDecoder<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.videoRequests.add(controller);
    const run = this.videoQueue
      .catch(() => {})
      .then(async () => {
        if (controller.signal.aborted) throw cancelled();
        return operation(controller.signal);
      });
    this.videoQueue = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await run;
    } finally {
      this.videoRequests.delete(controller);
    }
  }

  private unloadVideo(item: LocalMedia): void {
    if (!(item.element instanceof HTMLVideoElement)) return;
    item.element.pause();
    item.source?.disconnect();
    item.gain?.disconnect();
    item.audioConnected = false;
    if (item.element.hasAttribute("src")) {
      item.element.removeAttribute("src");
      item.element.load();
    }
    this.videoElements.delete(item.element);
    if (this.activeVideo === item) this.activeVideo = undefined;
  }

  /** Release decoder buffers while retaining reconnectable assets and their covers. */
  suspend(): void {
    this.claimPlayback();
    this.seekRequest++;
    this.pause();
    this.videoRequests.forEach((controller) => controller.abort());
    this.thumbnails.clear();
    for (const item of this.items.values()) this.unloadVideo(item);
    for (const element of this.videoElements) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.videoElements.clear();
  }

  private async loadVideo(
    element: HTMLVideoElement,
    url: string,
    signal: AbortSignal,
  ): Promise<void> {
    this.videoElements.add(element);
    await eventOnce(
      element,
      "loadeddata",
      () => {
        element.preload = "auto";
        element.src = url;
      },
      signal,
    );
  }

  /** Populate a visible card without waking the rest of the library or seeking the player. */
  async ensureThumbnail(
    assetId: string,
    isCurrent: () => boolean = () => true,
  ): Promise<string | undefined> {
    const item = this.items.get(assetId);
    if (!item || !isCurrent()) return;
    if (item.thumbnail) return item.thumbnail;
    if (!(item.element instanceof HTMLVideoElement)) return;
    const existing = this.thumbnails.get(assetId);
    if (existing) return existing;
    const pending = this.withVideoDecoder(async (signal) => {
      if (!isCurrent() || this.items.get(assetId) !== item) return;
      const element = document.createElement("video");
      element.muted = true;
      element.playsInline = true;
      const temporary: LocalMedia = { url: item.url, element };
      try {
        await this.loadVideo(element, item.url, signal);
        if (!isCurrent()) return;
        const thumbnail = await sourceThumbnail(element, signal);
        if (signal.aborted) throw cancelled();
        if (this.items.get(assetId) !== item || !isCurrent()) return;
        item.thumbnail = thumbnail;
        return thumbnail;
      } finally {
        this.unloadVideo(temporary);
      }
    });
    this.thumbnails.set(assetId, pending);
    try {
      return await pending;
    } finally {
      if (this.thumbnails.get(assetId) === pending) this.thumbnails.delete(assetId);
    }
  }

  private rememberMetadata(item: LocalMedia, asset?: Asset): void {
    const element = item.element;
    item.duration =
      element instanceof HTMLMediaElement && Number.isFinite(element.duration)
        ? element.duration
        : (item.duration ?? (asset ? asset.durationFrames / 30 : undefined));
    item.width =
      element instanceof HTMLVideoElement ? element.videoWidth || asset?.width : asset?.width;
    item.height =
      element instanceof HTMLVideoElement ? element.videoHeight || asset?.height : asset?.height;
  }

  private async activateVideo(item: LocalMedia, signal: AbortSignal): Promise<void> {
    if (this.activeVideo !== item) {
      if (this.activeVideo) this.unloadVideo(this.activeVideo);
      this.activeVideo = item;
    }
    const element = item.element as HTMLVideoElement;
    if (!element.hasAttribute("src")) {
      try {
        await this.loadVideo(element, item.url, signal);
        // Refresh the cover only when this source is first used, including stale saved IDs.
        if (!item.thumbnail?.startsWith("data:"))
          item.thumbnail = (await sourceThumbnail(element, signal)) ?? item.thumbnail;
        if (signal.aborted) throw cancelled();
        this.rememberMetadata(item);
      } catch (error) {
        this.unloadVideo(item);
        throw error;
      }
    }
    this.connectAudio(item);
  }

  claimPlayback(): symbol {
    this.playbackOwner = Symbol("playback");
    return this.playbackOwner;
  }

  ownsPlayback(owner: symbol): boolean {
    return this.playbackOwner === owner;
  }

  async import(file: File, existing?: Asset, options: { defer?: boolean } = {}): Promise<Asset> {
    if (options.defer && existing?.kind === "video" && file.type.startsWith("video/")) {
      const previous = this.items.get(existing.id);
      if (previous) this.release(previous);
      const item: LocalMedia = {
        file,
        ownsUrl: true,
        url: URL.createObjectURL(file),
        element: document.createElement("video"),
        duration: existing.durationFrames / 30,
        width: existing.width,
        height: existing.height,
      };
      (item.element as HTMLVideoElement).playsInline = true;
      this.items.set(existing.id, item);
      return existing;
    }
    return file.type.startsWith("video/")
      ? this.withVideoDecoder((signal) => this.importSource(file, existing, signal))
      : this.importSource(file, existing);
  }

  private async importSource(file: File, existing?: Asset, signal?: AbortSignal): Promise<Asset> {
    const generation = this.generation,
      assetId = existing?.id ?? crypto.randomUUID();
    const kind = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("audio/")
        ? "audio"
        : file.type.startsWith("video/")
          ? "video"
          : null;
    if (!kind) throw new Error(`不支持的素材：${file.name}`);
    const ticket = new AbortController();
    this.loads.get(assetId)?.abort();
    this.loads.set(assetId, ticket);
    const url = URL.createObjectURL(file);
    const element = kind === "image" ? new Image() : document.createElement(kind);
    if (element instanceof HTMLMediaElement) {
      element.preload = "auto";
      if (element instanceof HTMLVideoElement) element.playsInline = true;
    }
    const abort = () => ticket.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const ready = eventOnce(
      element,
      kind === "image" ? "load" : "loadeddata",
      undefined,
      ticket.signal,
    );
    if (element instanceof HTMLVideoElement) this.videoElements.add(element);
    element.src = url;
    try {
      await ready;
      // Capture the initial frame before a metadata-less WebM duration probe
      // visits the end; that probe still returns the new decoder to zero.
      const thumbnail = await sourceThumbnail(element, ticket.signal);
      if (generation !== this.generation || this.loads.get(assetId) !== ticket)
        throw new Error("素材读取已取消");
      const duration =
        element instanceof HTMLMediaElement ? await mediaDuration(element, ticket.signal) : 5;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("素材缺少有效时长");
      const asset: Asset = existing || {
        id: assetId,
        name: file.name,
        kind,
        durationFrames: Math.max(1, Math.round(duration * 30)),
        width:
          element instanceof HTMLVideoElement
            ? element.videoWidth
            : element instanceof HTMLImageElement
              ? element.naturalWidth
              : undefined,
        height:
          element instanceof HTMLVideoElement
            ? element.videoHeight
            : element instanceof HTMLImageElement
              ? element.naturalHeight
              : undefined,
        size: file.size,
        lastModified: file.lastModified,
        mimeType: file.type,
      };
      if (existing && Math.abs(asset.durationFrames - Math.round(duration * 30)) > 2)
        throw new Error("重连素材的时长不匹配，请选择原文件");
      const item: LocalMedia = { file, url, element, ownsUrl: true };
      item.thumbnail = thumbnail;
      this.rememberMetadata(item, asset);
      if (generation !== this.generation || this.loads.get(assetId) !== ticket)
        throw new Error("素材读取已取消");
      const previous = this.items.get(asset.id);
      if (previous) this.release(previous);
      this.items.set(asset.id, item);
      this.unloadVideo(item);
      return asset;
    } catch (error) {
      element.removeAttribute("src");
      if (element instanceof HTMLMediaElement) element.load();
      if (element instanceof HTMLVideoElement) this.videoElements.delete(element);
      URL.revokeObjectURL(url);
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (this.loads.get(assetId) === ticket) this.loads.delete(assetId);
    }
  }

  async connectBuiltin(asset: Asset): Promise<void> {
    if (!isDemoNarration(asset)) throw new Error("不支持此内置素材");
    return this.connectSource(asset, new URL("demo-narration.mp3", document.baseURI).href);
  }

  async connectManaged(
    asset: Asset,
    options: { reload?: boolean; inspect?: boolean } = {},
  ): Promise<void> {
    const mediaId =
      asset.kind === "image" ? asset.mediaId || asset.thumbnailId : asset.proxyId || asset.mediaId;
    if (!mediaId || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(mediaId))
      throw new Error("素材缺少有效的本地媒体编号");
    if (asset.kind === "demo") return;
    return this.connectSource(
      asset,
      `/media/${encodeURIComponent(mediaId)}`,
      options.reload,
      options.inspect,
    );
  }

  /** Inspect an already captured immutable resource without requiring a media engine. */
  async inspectManaged(
    resource: { id: string; name: string; mimeType: string; bytes: number },
    sourcePath: string,
    lastModified: number,
  ): Promise<Asset> {
    const kind = resource.mimeType.startsWith("image/")
      ? "image"
      : resource.mimeType.startsWith("audio/")
        ? "audio"
        : resource.mimeType.startsWith("video/")
          ? "video"
          : undefined;
    if (!kind) throw new Error("文件类型不受支持");
    const asset: Asset = {
      id: crypto.randomUUID(),
      name: resource.name,
      mediaId: resource.id,
      mimeType: resource.mimeType,
      size: resource.bytes,
      sourcePath,
      lastModified,
      kind,
      durationFrames: 1,
    };
    await this.connectManaged(asset, { inspect: true });
    const item = this.items.get(asset.id);
    if (!item) throw cancelled();
    try {
      const element = item.element;
      const duration =
        item.duration ?? (element instanceof HTMLMediaElement ? await mediaDuration(element) : 5);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("素材缺少有效时长");
      asset.durationFrames = Math.max(1, Math.round(duration * 30));
      if (element instanceof HTMLVideoElement) {
        asset.width = item.width;
        asset.height = item.height;
      }
      if (element instanceof HTMLImageElement) {
        asset.width = element.naturalWidth;
        asset.height = element.naturalHeight;
      }
      return asset;
    } catch (error) {
      this.release(item);
      this.items.delete(asset.id);
      throw error;
    }
  }

  private async connectSource(
    asset: Asset,
    url: string,
    reload = false,
    inspect = false,
  ): Promise<void> {
    if (asset.kind === "video") {
      const existing = this.items.get(asset.id);
      if (existing?.url === url && !reload) return;
      if (!inspect) {
        if (existing) this.release(existing);
        const element = document.createElement("video");
        element.playsInline = true;
        element.preload = "none";
        this.items.set(asset.id, {
          url,
          element,
          ownsUrl: false,
          duration: asset.durationFrames / 30,
          width: asset.width,
          height: asset.height,
          thumbnail:
            asset.thumbnailId && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(asset.thumbnailId)
              ? `/media/${encodeURIComponent(asset.thumbnailId)}`
              : undefined,
        });
        return;
      }
      return this.withVideoDecoder((signal) => this.loadSource(asset, url, reload, signal));
    }
    return this.loadSource(asset, url, reload);
  }

  private async loadSource(
    asset: Asset,
    url: string,
    reload = false,
    signal?: AbortSignal,
  ): Promise<void> {
    if (asset.kind === "demo") return;
    const generation = this.generation;
    const existing = this.items.get(asset.id);
    if (existing?.url === url && !reload) return;
    if (reload && existing) {
      this.release(existing);
      this.items.delete(asset.id);
    }
    const ticket = new AbortController();
    this.loads.get(asset.id)?.abort();
    this.loads.set(asset.id, ticket);
    const element = asset.kind === "image" ? new Image() : document.createElement(asset.kind);
    if (element instanceof HTMLMediaElement) {
      element.preload = "auto";
      if (element instanceof HTMLVideoElement) element.playsInline = true;
    }
    const item: LocalMedia = { url, element, ownsUrl: false };
    const abort = () => ticket.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (element instanceof HTMLVideoElement) this.videoElements.add(element);
    try {
      await eventOnce(
        element,
        asset.kind === "image" ? "load" : "loadeddata",
        () => {
          element.src = url;
        },
        ticket.signal,
      );
      // Regenerate from the connected source for every storage mode. Saved
      // thumbnail IDs may be absent or stale; a decoded local image also avoids
      // a second request failing after the source has already been restored.
      item.thumbnail = await sourceThumbnail(element, ticket.signal);
      item.duration =
        element instanceof HTMLMediaElement ? await mediaDuration(element, ticket.signal) : 5;
      this.rememberMetadata(item, asset);
      if (generation !== this.generation || this.loads.get(asset.id) !== ticket)
        throw new Error("素材读取已取消");
      const previous = this.items.get(asset.id);
      if (previous) this.release(previous);
      this.items.set(asset.id, item);
      this.unloadVideo(item);
    } catch (error) {
      this.release(item);
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (this.loads.get(asset.id) === ticket) this.loads.delete(asset.id);
    }
  }

  private connectAudio(item: LocalMedia): void {
    if (
      !(item.element instanceof HTMLMediaElement) ||
      item.audioConnected ||
      (item.element instanceof HTMLVideoElement && !item.element.hasAttribute("src")) ||
      !this.audio ||
      !this.destination
    )
      return;
    item.source ??= this.audio.createMediaElementSource(item.element);
    item.gain ??= this.audio.createGain();
    item.element.volume = 1;
    item.source.connect(item.gain);
    item.gain.connect(this.audio.destination);
    item.gain.connect(this.destination);
    item.audioConnected = true;
  }

  async enableAudio(): Promise<void> {
    this.audio ??= new AudioContext();
    this.destination ??= this.audio.createMediaStreamDestination();
    for (const item of [...this.items.values(), ...this.voices]) this.connectAudio(item);
    await this.audio.resume();
  }

  // Each timeline audio clip has its own decoder and gain. Reusing the library's
  // source element would make overlapping uses of the same asset seek each other.
  async createAudioVoice(assetId: string): Promise<LocalMedia> {
    const source = this.items.get(assetId);
    if (!source || source.element instanceof HTMLImageElement)
      throw new Error("独立音轨缺少可播放素材");
    const element = document.createElement("audio");
    element.preload = "auto";
    const item: LocalMedia = { url: source.url, element, ownsUrl: false };
    this.voices.add(item);
    try {
      await eventOnce(element, "loadeddata", () => {
        element.src = source.url;
      });
      this.connectAudio(item);
      return item;
    } catch (error) {
      this.release(item);
      throw error;
    }
  }

  pause(): void {
    for (const item of [...this.items.values(), ...this.voices])
      if (item.element instanceof HTMLMediaElement) item.element.pause();
  }

  missing(project: Project): Asset[] {
    const used = new Set(
      [...project.clips, ...(project.audioClips ?? [])].map((clip) => clip.assetId),
    );
    return project.assets.filter(
      (asset) => used.has(asset.id) && asset.kind !== "demo" && !this.items.has(asset.id),
    );
  }

  release(item: LocalMedia): void {
    for (const [assetId, current] of this.items)
      if (current === item) {
        this.loads.get(assetId)?.abort();
        this.loads.delete(assetId);
      }
    this.unloadVideo(item);
    if (item.element instanceof HTMLMediaElement) item.element.pause();
    item.source?.disconnect();
    item.gain?.disconnect();
    item.element.removeAttribute("src");
    if (item.element instanceof HTMLMediaElement) item.element.load();
    if (item.ownsUrl) URL.revokeObjectURL(item.url);
    this.voices.delete(item);
  }

  clear(): void {
    this.generation++;
    this.suspend();
    this.loads.forEach((controller) => controller.abort());
    this.loads.clear();
    this.claimPlayback();
    this.pause();
    this.voices.forEach((item) => this.release(item));
    this.items.forEach((item) => this.release(item));
    this.items.clear();
  }

  async seek(project: Project, frame: number): Promise<void> {
    const request = ++this.seekRequest;
    const clip = timelineClips(project).find(
      (item) => frame >= item.startFrame && frame < item.endFrame,
    );
    if (!clip) {
      if (this.activeVideo) this.unloadVideo(this.activeVideo);
      return;
    }
    const item = this.items.get(clip.assetId);
    if (!(item?.element instanceof HTMLVideoElement) && this.activeVideo)
      this.unloadVideo(this.activeVideo);
    if (!(item?.element instanceof HTMLMediaElement)) return;
    const target = (clip.inFrame + frame - clip.startFrame) / 30;
    if (item.element instanceof HTMLVideoElement) {
      await this.withVideoDecoder(async (signal) => {
        if (request !== this.seekRequest) return;
        if (this.items.get(clip.assetId) !== item) throw cancelled();
        await this.activateVideo(item, signal);
        await seekMedia(item.element as HTMLVideoElement, target, signal);
      });
    } else await seekMedia(item.element, target);
  }
}

function contain(
  ctx: CanvasRenderingContext2D,
  image: HTMLVideoElement | HTMLImageElement,
  w: number,
  h: number,
): void {
  const iw = image instanceof HTMLVideoElement ? image.videoWidth : image.naturalWidth;
  const ih = image instanceof HTMLVideoElement ? image.videoHeight : image.naturalHeight;
  if (!iw || !ih) return;
  const scale = Math.min(w / iw, h / ih);
  ctx.drawImage(image, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale);
}

function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
}

export function drawDemo(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  index: number,
  frame: number,
): void {
  ctx.save();
  const s = Math.min(width / 1280, height / 720);
  ctx.fillStyle = "#101918";
  ctx.fillRect(0, 0, width, height);
  ctx.translate((width - 1280 * s) / 2, (height - 720 * s) / 2);
  ctx.scale(s, s);
  const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
  gradient.addColorStop(0, "#123b35");
  gradient.addColorStop(0.55, "#112b29");
  gradient.addColorStop(1, "#111a22");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1280, 720);
  ctx.strokeStyle = "#95c5ad0c";
  ctx.lineWidth = 1;
  for (let x = 0; x < 1280; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 720);
    ctx.stroke();
  }
  for (let y = 0; y < 720; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1280, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#bceac9";
  ctx.font = "500 18px system-ui";
  ctx.fillText("MIMI STUDIO   /   CREATE SOMETHING GOOD", 82, 90);
  rounded(ctx, 82, 170, 124, 34, 17, "#a6e5be19");
  ctx.fillStyle = "#bceac9";
  ctx.font = "500 15px system-ui";
  ctx.fillText(["01 / THE IDEA", "02 / THE EDIT", "03 / YOUR STORY"][index % 3]!, 98, 193);
  ctx.fillStyle = "#edf7ee";
  ctx.font = "600 76px system-ui";
  ctx.fillText(["从想法，", "让每一帧，", "你的故事，"][index % 3]!, 78, 316);
  ctx.fillStyle = "#b6efca";
  ctx.fillText(["到成片。", "恰到好处。", "现在开始。 "][index % 3]!, 78, 416);
  ctx.fillStyle = "#b5c6c1";
  ctx.font = "400 23px system-ui";
  ctx.fillText("留住值得讲述的瞬间。其余的，交给剪辑。", 82, 480);
  const p = frame / 30;
  ctx.save();
  ctx.translate(957, 337);
  ctx.rotate(-0.2 + Math.sin(p * 0.3) * 0.025);
  rounded(ctx, -158, -187, 288, 370, 24, "#0b171acc");
  rounded(ctx, -141, -170, 254, 243, 12, "#397765");
  const g = ctx.createLinearGradient(-141, -170, 113, 73);
  g.addColorStop(0, "#9bd5a4");
  g.addColorStop(1, "#254e4f");
  rounded(ctx, -141, -170, 254, 243, 12, g as unknown as string);
  ctx.fillStyle = "#e3ecc6";
  ctx.beginPath();
  ctx.arc(38, -94, 33, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#204f45";
  ctx.beginPath();
  ctx.moveTo(-141, 73);
  ctx.lineTo(-64, -77);
  ctx.lineTo(48, 73);
  ctx.fill();
  ctx.fillStyle = "#163a37";
  ctx.beginPath();
  ctx.moveTo(-37, 73);
  ctx.lineTo(60, -34);
  ctx.lineTo(113, 73);
  ctx.fill();
  rounded(ctx, -141, 99, 157, 9, 4, "#d9e9e0");
  rounded(ctx, -141, 122, 225, 6, 3, "#45655a");
  rounded(ctx, -141, 140, 178, 6, 3, "#45655a");
  ctx.restore();
  rounded(ctx, 827, 506, 271, 59, 12, "#b9edc6");
  ctx.fillStyle = "#173c2d";
  ctx.font = "500 19px system-ui";
  ctx.fillText("▶   Made of little moments", 845, 543);
  ctx.fillStyle = "#8dafa0";
  ctx.font = "400 15px system-ui";
  ctx.fillText("示例画面 · 可自由剪辑与导出", 82, 643);
  ctx.restore();
}

/** Matches the Host caption PNG compositor; preview and browser export call this same layer. */
export function drawCaptionLayer(
  ctx: CanvasRenderingContext2D,
  request: {
    width: number;
    height: number;
    fontSize: number;
    texts: string[];
    style?: CaptionStyle;
  },
): void {
  const { width: w, height: h, fontSize } = request;
  const style = request.style ?? "classic";
  if (!["classic", "bold", "minimal"].includes(style)) throw new Error("Unsupported caption style");
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.font = `${style === "bold" ? 800 : style === "minimal" ? 500 : 600} ${fontSize}px system-ui`;
  ctx.textAlign = "center";
  const lines: string[] = [];
  outer: for (const text of request.texts) {
    let line = "";
    for (const char of text) {
      if (char === "\n" || (line && ctx.measureText(line + char).width > w * 0.85)) {
        lines.push(line);
        if (lines.length === 4) break outer;
        line = char === "\n" ? "" : char;
      } else line += char;
    }
    if (line) lines.push(line);
    if (lines.length === 4) break;
  }
  const visible = lines.slice(0, 4),
    lineHeight = fontSize * 1.4;
  if (visible.length) {
    const y = h * 0.9 - visible.length * lineHeight;
    if (style === "classic") {
      const boxWidth = Math.min(
        w * 0.93,
        Math.max(...visible.map((line) => ctx.measureText(line).width)) + fontSize,
      );
      ctx.fillStyle = "#050909b8";
      ctx.beginPath();
      ctx.roundRect(
        (w - boxWidth) / 2,
        y,
        boxWidth,
        visible.length * lineHeight + fontSize * 0.5,
        8,
      );
      ctx.fill();
    } else if (style === "minimal") {
      ctx.shadowColor = "#000b";
      ctx.shadowBlur = Math.max(2, fontSize * 0.08);
      ctx.shadowOffsetY = Math.max(1, fontSize * 0.04);
    }
    ctx.fillStyle = style === "bold" ? "#ffe46b" : "#fff";
    if (style === "bold") {
      ctx.strokeStyle = "#101010";
      ctx.lineWidth = Math.max(2, fontSize * 0.12);
      ctx.lineJoin = "round";
    }
    visible.forEach((line, i) => {
      const baseline = y + lineHeight * (i + 1) - fontSize * 0.1;
      if (style === "bold") ctx.strokeText(line, w / 2, baseline);
      ctx.fillText(line, w / 2, baseline);
    });
  }
  ctx.restore();
}

export function renderFrame(
  canvas: HTMLCanvasElement,
  project: Project,
  library: MediaLibrary,
  frame: number,
): void {
  const ctx = canvas.getContext("2d")!;
  if (canvas.width !== project.width || canvas.height !== project.height) {
    canvas.width = project.width;
    canvas.height = project.height;
  }
  const w = canvas.width,
    h = canvas.height;
  const clip = timelineClips(project).find(
    (item) => frame >= item.startFrame && frame < item.endFrame,
  );
  ctx.fillStyle = !clip && project.clips.length ? "#000" : "#0a0e10";
  ctx.fillRect(0, 0, w, h);
  const asset = project.assets.find((item) => item.id === clip?.assetId);
  if (asset?.kind === "demo") drawDemo(ctx, w, h, demoSceneIndex(asset), frame);
  else if (asset) {
    const item = library.items.get(asset.id);
    if (item?.element instanceof HTMLVideoElement || item?.element instanceof HTMLImageElement)
      contain(ctx, item.element, w, h);
    else if (!item) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#8ca69f";
      ctx.font = `${w * 0.026}px system-ui`;
      ctx.fillText("重新选择原素材以恢复预览", w / 2, h / 2);
      ctx.textAlign = "left";
    }
  } else if (!project.clips.length) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#a7beb2";
    ctx.font = `500 ${w * 0.038}px system-ui`;
    ctx.fillText("让好故事，从这里开始。", w / 2, h * 0.46);
    ctx.font = `${w * 0.016}px system-ui`;
    ctx.fillStyle = "#748078";
    ctx.fillText("导入你的第一段素材，或打开示例工程", w / 2, h * 0.54);
    ctx.textAlign = "left";
  }
  const captions = project.captions.filter(
    (item) => frame >= item.startFrame && frame < item.endFrame,
  );
  if (captions.length) {
    drawCaptionLayer(ctx, {
      width: w,
      height: h,
      fontSize: Math.round(Math.min(w * 0.035, h * 0.05)),
      texts: captions.map((caption) => caption.text),
      style: project.captionStyle,
    });
  }
}

interface PlaybackHooks {
  onSeeking?: () => void | Promise<void>;
  onReady?: () => void | Promise<void>;
}

/** Playback and recording share the same compositor, source ranges, audio and caption clock. */
export function playSequence(
  project: Project,
  library: MediaLibrary,
  canvas: HTMLCanvasElement,
  from: number,
  signal: AbortSignal,
  onFrame: (frame: number) => void,
  hooks: PlaybackHooks = {},
): Promise<void> {
  return playOwnedSequence(
    project,
    library,
    canvas,
    from,
    signal,
    onFrame,
    library.claimPlayback(),
    hooks,
  );
}

async function playOwnedSequence(
  project: Project,
  library: MediaLibrary,
  canvas: HTMLCanvasElement,
  from: number,
  signal: AbortSignal,
  onFrame: (frame: number) => void,
  owner: symbol,
  hooks: PlaybackHooks = {},
): Promise<void> {
  const active = () => !signal.aborted && library.ownsPlayback(owner);
  const voices = new Map<string, LocalMedia>();
  await library.enableAudio();
  if (!active()) return;
  try {
    for (const clip of project.audioClips ?? []) {
      if (!active()) return;
      voices.set(clip.id, await library.createAudioVoice(clip.assetId));
    }
    if (!active()) return;
    const total = timelineDuration(project),
      clips = timelineClips(project);
    const boundaries = [
      ...new Set([
        from,
        total,
        ...clips.flatMap((clip) => [clip.startFrame, clip.endFrame]),
        ...(project.audioClips ?? []).flatMap((clip) => [
          clip.startFrame,
          Math.min(total, clip.startFrame + clip.outFrame - clip.inFrame),
        ]),
      ]),
    ]
      .filter((frame) => frame >= from && frame <= total)
      .sort((a, b) => a - b);
    for (let index = 0; index < boundaries.length - 1; index++) {
      if (!active()) break;
      const start = boundaries[index]!,
        end = boundaries[index + 1]!;
      const clip = clips.find((item) => start >= item.startFrame && start < item.endFrame);
      // A free timeline gap is a real span of black video. Keep its clock and
      // independent audio running, and stop the preceding source before it.
      library.pause();
      await hooks.onSeeking?.();
      if (!active()) break;
      await library.seek(project, start);
      if (!active()) break;
      const item = clip ? library.items.get(clip.assetId) : undefined;
      const media = item?.element instanceof HTMLMediaElement ? item.element : null;
      const audioClips = (project.audioClips ?? []).filter(
        (audio) =>
          start >= audio.startFrame && start < audio.startFrame + audio.outFrame - audio.inFrame,
      );
      for (const audio of audioClips) {
        const voice = voices.get(audio.id)!;
        await seekMedia(
          voice.element as HTMLMediaElement,
          (audio.inFrame + start - audio.startFrame) / 30,
        );
        if (!active()) break;
        voice.gain!.gain.setValueAtTime(audio.volume, library.audio!.currentTime);
      }
      if (!active()) break;
      renderFrame(canvas, project, library, start);
      if (media && clip) item!.gain!.gain.setValueAtTime(clip.volume, library.audio!.currentTime);
      await Promise.all([
        ...(media ? [media.play()] : []),
        ...audioClips.map((audio) => (voices.get(audio.id)!.element as HTMLMediaElement).play()),
      ]);
      if (!active()) break;
      const clockClip = media ? clip : audioClips[0];
      const clockMedia =
        media ?? (clockClip ? (voices.get(clockClip.id)!.element as HTMLMediaElement) : undefined);
      const since = library.audio!.currentTime;
      const currentFrame = () =>
        clockMedia && clockClip
          ? clockClip.startFrame + Math.floor(clockMedia.currentTime * 30) - clockClip.inFrame
          : start + Math.floor((library.audio!.currentTime - since) * 30);
      const firstFrame = Math.min(end - 1, Math.max(start, currentFrame()));
      renderFrame(canvas, project, library, firstFrame);
      onFrame(firstFrame);
      if (!active()) break;
      await hooks.onReady?.();
      if (!active()) break;
      let lastFrame = firstFrame,
        lastProgress = performance.now();
      while (active()) {
        const sourceFrame = currentFrame();
        if (sourceFrame >= end || clockMedia?.ended) break;
        // Decoded source time can sit just before its trim point after seeking.
        // Keep every displayed frame in this segment; use the raw clock above
        // for completion so bounding the playhead cannot prevent playback ending.
        const frame = Math.max(start, sourceFrame);
        if (frame !== lastFrame) {
          lastProgress = performance.now();
          lastFrame = frame;
        }
        if (performance.now() - lastProgress > 15000)
          throw new Error("素材播放中断，请检查文件或重试导出");
        renderFrame(canvas, project, library, frame);
        onFrame(frame);
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
    }
  } finally {
    voices.forEach((voice) => library.release(voice));
    if (library.ownsPlayback(owner)) library.pause();
  }
  if (active()) onFrame(timelineDuration(project));
}

export async function recordSequence(
  project: Project,
  library: MediaLibrary,
  signal: AbortSignal,
  onFrame: (frame: number) => void,
): Promise<Blob> {
  if (!project.clips.length) throw new Error("时间轴为空，请先添加素材");
  if (library.missing(project).length) throw new Error("请先重新连接缺失素材，再导出视频");
  if (timelineDuration(project) > 30 * 60 * 10)
    throw new Error("浏览器实时导出当前支持 10 分钟内的序列");
  if (document.visibilityState !== "visible") throw new Error("请保持视频工作台可见，再开始导出");
  if (typeof MediaRecorder === "undefined")
    throw new Error("此浏览器不支持视频导出，请使用新版 Chromium");
  const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(
    (type) => MediaRecorder.isTypeSupported(type),
  );
  if (!mimeType) throw new Error("此环境没有可用的 WebM 编码器");
  const owner = library.claimPlayback();
  const active = () => !signal.aborted && library.ownsPlayback(owner);
  const canvas = document.createElement("canvas");
  library.pause();
  await library.enableAudio();
  if (!active()) throw new Error("已取消导出");
  await library.seek(project, 0);
  if (!active()) throw new Error("已取消导出");
  renderFrame(canvas, project, library, 0);
  const stream = canvas.captureStream(30);
  library.destination!.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6000000 });
  } catch (error) {
    stream.getVideoTracks().forEach((track) => track.stop());
    throw error;
  }
  const chunks: Blob[] = [];
  let recordingError: Error | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const visibilityChanged = () => {
    if (document.visibilityState === "visible") return;
    recordingError = new Error("工作台已进入后台，导出已停止；请保持面板可见后重试");
    controller.abort();
  };
  signal.addEventListener("abort", abort, { once: true });
  document.addEventListener("visibilitychange", visibilityChanged);
  visibilityChanged();
  if (signal.aborted) controller.abort();
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onerror = () => {
    recordingError = new Error("视频编码失败，请降低画布尺寸后重试");
    controller.abort();
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  try {
    await playOwnedSequence(project, library, canvas, 0, controller.signal, onFrame, owner, {
      onSeeking: async () => {
        if (recorder.state === "recording")
          await eventOnce(recorder, "pause", () => recorder.pause());
      },
      onReady: () => {
        if (recorder.state === "inactive") recorder.start(1000);
        else if (recorder.state === "paused") recorder.resume();
      },
    });
  } finally {
    signal.removeEventListener("abort", abort);
    document.removeEventListener("visibilitychange", visibilityChanged);
    if (library.ownsPlayback(owner)) library.pause();
    if (recorder.state !== "inactive") {
      recorder.stop();
      await stopped;
    }
    stream.getVideoTracks().forEach((track) => track.stop());
  }
  if (recordingError) throw recordingError;
  if (!active()) throw new Error("已取消导出");
  if (!chunks.length) throw new Error("编码器没有生成有效视频");
  return new Blob(chunks, { type: mimeType });
}

export async function captureAssetFrame(library: MediaLibrary, assetId: string, seconds = 0) {
  return library.withVideoDecoder((signal) =>
    captureAssetFrameNow(library, assetId, seconds, signal),
  );
}

async function captureAssetFrameNow(
  library: MediaLibrary,
  assetId: string,
  seconds = 0,
  signal?: AbortSignal,
): Promise<{
  kind: "image";
  mediaType: "image/jpeg";
  data: string;
  width: number;
  height: number;
  summary: string;
}> {
  const item = library.items.get(assetId);
  if (!item || item.element instanceof HTMLAudioElement) throw new Error("此素材没有可采样画面");
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("采样位置必须是有效秒数");
  const element =
    item.element instanceof HTMLImageElement ? new Image() : document.createElement("video");
  try {
    if (element instanceof HTMLVideoElement) {
      element.preload = "auto";
      element.muted = true;
      element.playsInline = true;
    }
    await eventOnce(
      element,
      element instanceof HTMLImageElement ? "load" : "loadeddata",
      () => {
        element.src = item.url;
      },
      signal,
    );
    if (element instanceof HTMLVideoElement) {
      const duration = await mediaDuration(element, signal);
      if (seconds >= duration) throw new Error("采样位置超出素材时长");
      await seekMedia(element, seconds, signal);
      if (Math.abs(element.currentTime - seconds) > 0.05)
        throw new Error("素材无法精确定位到请求画面");
    }
    const width = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
    const height =
      element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
    if (!width || !height) throw new Error("素材没有有效画面尺寸");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 640 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d")!;
    let quality = 0.85,
      data = "";
    while (true) {
      ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
      data = canvas.toDataURL("image/jpeg", quality).split(",")[1]!;
      if (data.length < 200000) break;
      if (quality > 0.4) quality -= 0.15;
      else {
        canvas.width = Math.max(1, Math.floor(canvas.width / 2));
        canvas.height = Math.max(1, Math.floor(canvas.height / 2));
      }
    }
    return {
      kind: "image",
      mediaType: "image/jpeg",
      data,
      width: canvas.width,
      height: canvas.height,
      summary: `素材 ${assetId} 在 ${seconds.toFixed(3)} 秒的实际画面`,
    };
  } finally {
    if (element instanceof HTMLVideoElement) element.pause();
    element.removeAttribute("src");
    if (element instanceof HTMLVideoElement) element.load();
  }
}
