import { applyColorToRgba, hasColorAdjustment } from "./color";
import type {
  EvaluatedFrame,
  EvaluatedGroupLayer,
  EvaluatedLayer,
  EvaluatedTextLayer,
  EvaluatedTransitionLayer,
  EvaluatedVisualLayer,
} from "./evaluate";
import type { Mask, TextStyle } from "./types";
import { fitVisualSource } from "./visual-layout";

type Surface = HTMLCanvasElement | OffscreenCanvas;
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Buffer = { canvas: Surface; context: Context; pixels: number };
type LayoutLine = { text: string; start: number };
const MAX_SIDE = 8192;
const MAX_ACTIVE_PIXELS = 128 * 1024 * 1024;
const MAX_CACHED_PIXELS = 16 * 1024 * 1024;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function dimensions(width: number, height: number): void {
  if (
    ![width, height].every((value) => Number.isSafeInteger(value) && value > 0 && value <= MAX_SIDE)
  )
    throw new Error("合成画面宽高必须是 1–8192 范围内的整数");
}
function context(canvas: Surface): Context {
  const value = canvas.getContext("2d") as Context | null;
  if (!value) throw new Error("当前浏览器无法创建二维画面合成器");
  return value;
}
function reset(buffer: Buffer): void {
  // A reset also removes a previous clipping region. clearRect alone does not.
  buffer.context.reset();
}
function composite(mode: EvaluatedVisualLayer["blendMode"]): GlobalCompositeOperation {
  return mode === "normal" ? "source-over" : mode;
}
/** Unit, transparent groups with normal children have no isolation effect. Avoid an extra
 * 8-bit premultiplication round trip when the user only groups existing timeline layers. */
function directGroup(layer: EvaluatedGroupLayer, width: number, height: number): boolean {
  const transform = layer.transform;
  return (
    layer.width === width &&
    layer.height === height &&
    /^#[0-9a-f]{6}00$/i.test(layer.background) &&
    layer.blendMode === "normal" &&
    !layer.mask &&
    transform.x === 0 &&
    transform.y === 0 &&
    transform.scaleX === 1 &&
    transform.scaleY === 1 &&
    transform.rotation === 0 &&
    transform.opacity === 1 &&
    !transform.flipX &&
    !transform.flipY &&
    transform.fit === "contain" &&
    Object.values(transform.crop).every((value) => value === 0) &&
    !hasColorAdjustment(layer.color) &&
    layer.color.curves.length === 0 &&
    layer.color.hsl.length === 0 &&
    layer.layers.every((child) =>
      child.kind === "transition"
        ? (!child.from || child.from.blendMode === "normal") &&
          (!child.to || child.to.blendMode === "normal")
        : child.blendMode === "normal",
    )
  );
}
function sourceDimensions(source: CanvasImageSource, instanceId: string): [number, number] {
  const item = source as unknown as Record<string, any>;
  if (
    (typeof item.videoWidth === "number" && Number(item.readyState) < 2) ||
    item.complete === false
  )
    throw new Error(`素材画面尚未就绪：${instanceId}`);
  const width =
    item.videoWidth ??
    item.naturalWidth ??
    item.displayWidth ??
    item.width?.baseVal?.value ??
    item.width;
  const height =
    item.videoHeight ??
    item.naturalHeight ??
    item.displayHeight ??
    item.height?.baseVal?.value ??
    item.height;
  if (
    ![width, height].every(
      (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
    )
  )
    throw new Error(`素材画面尺寸无效或已释放：${instanceId}`);
  return [width, height];
}

/** A bounded surface pool can be retained during playback, and released when closing a project. */
export class FrameCompositor {
  private free: Buffer[] = [];
  private active = new Set<Buffer>();
  private allocatedPixels = 0;
  private drawing = false;

  dispose(): void {
    if (this.drawing) throw new Error("正在合成画面，暂时无法释放合成器");
    for (const item of this.free) {
      item.canvas.width = 1;
      item.canvas.height = 1;
    }
    this.free = [];
    this.allocatedPixels = 0;
  }
  private take(width: number, height: number): Buffer {
    dimensions(width, height);
    const position = this.free.findIndex(
      (item) => item.canvas.width === width && item.canvas.height === height,
    );
    let buffer = position < 0 ? undefined : this.free.splice(position, 1)[0];
    if (!buffer) {
      while (this.free.length && this.allocatedPixels + width * height > MAX_ACTIVE_PIXELS) {
        const evicted = this.free.pop()!;
        this.allocatedPixels -= evicted.pixels;
        evicted.canvas.width = 1;
        evicted.canvas.height = 1;
      }
      if (this.allocatedPixels + width * height > MAX_ACTIVE_PIXELS || this.active.size >= 64)
        throw new Error("画面合成缓冲超过上限，请减小画面尺寸或减少嵌套层级");
      const canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement("canvas"), { width, height });
      buffer = { canvas, context: context(canvas), pixels: width * height };
      this.allocatedPixels += buffer.pixels;
    }
    reset(buffer);
    this.active.add(buffer);
    return buffer;
  }
  private release(buffer: Buffer): void {
    if (!this.active.delete(buffer)) throw new Error("画面缓冲已释放");
    if (
      this.free.length < 4 &&
      this.free.reduce((sum, item) => sum + item.pixels, 0) + buffer.pixels <= MAX_CACHED_PIXELS
    )
      this.free.push(buffer);
    else {
      this.allocatedPixels -= buffer.pixels;
      buffer.canvas.width = 1;
      buffer.canvas.height = 1;
    }
  }
  private preflight(
    layers: readonly EvaluatedLayer[],
    media: ReadonlyMap<string, CanvasImageSource>,
    depth = 0,
  ): void {
    if (depth > 50 || layers.length > 2000) throw new Error("画面层数或嵌套深度超过上限");
    for (const layer of layers) {
      if (layer.kind === "media") {
        const source = media.get(layer.instanceId);
        if (!source) throw new Error(`缺少已解码的素材画面：${layer.instanceId}`);
        sourceDimensions(source, layer.instanceId);
      } else if (layer.kind === "group") {
        dimensions(layer.width, layer.height);
        this.preflight(layer.layers, media, depth + 1);
      } else if (layer.kind === "transition")
        this.preflight(
          [layer.from, layer.to].filter((item): item is EvaluatedVisualLayer => item !== null),
          media,
          depth + 1,
        );
    }
  }
  draw(
    canvas: Surface,
    frame: EvaluatedFrame,
    media: ReadonlyMap<string, CanvasImageSource>,
  ): void {
    if (this.drawing) throw new Error("合成器不能同时绘制两个画面");
    dimensions(frame.width, frame.height);
    this.preflight(frame.layers, media);
    this.drawing = true;
    try {
      if (canvas.width !== frame.width) canvas.width = frame.width;
      if (canvas.height !== frame.height) canvas.height = frame.height;
      const target = context(canvas);
      target.reset();
      target.fillStyle = frame.background;
      target.fillRect(0, 0, frame.width, frame.height);
      this.drawLayers(target, frame.layers, frame.width, frame.height, media);
    } finally {
      // An exception must not retain large temporary images between failed export attempts.
      for (const item of [...this.active]) this.release(item);
      this.drawing = false;
    }
  }
  private drawLayers(
    target: Context,
    layers: readonly EvaluatedLayer[],
    width: number,
    height: number,
    media: ReadonlyMap<string, CanvasImageSource>,
  ): void {
    for (let index = 0; index < layers.length; index++) {
      const layer = layers[index]!;
      if (layer.kind === "transition") this.drawTransition(target, layer, width, height, media);
      else if (layer.kind === "group" && directGroup(layer, width, height)) {
        // Keep this recursive boundary: caption-stack aggregation must stay inside its group.
        this.drawLayers(target, layer.layers, width, height, media);
      } else {
        let captions: string[] | undefined;
        if (
          layer.kind === "text" &&
          layer.style.layout === "caption-stack" &&
          layer.style.animation === "none"
        ) {
          captions = [layer.text];
          const key = captionKey(layer);
          while (index + 1 < layers.length) {
            const next = layers[index + 1]!;
            if (next.kind !== "text" || next.style.animation !== "none" || captionKey(next) !== key)
              break;
            captions.push(next.text);
            index++;
          }
        }
        const picture = this.visual(layer, width, height, media, captions);
        try {
          target.save();
          target.globalCompositeOperation = composite(layer.blendMode);
          target.drawImage(picture.canvas, 0, 0);
          target.restore();
        } finally {
          this.release(picture);
        }
      }
    }
  }
  private visual(
    layer: EvaluatedVisualLayer,
    width: number,
    height: number,
    media: ReadonlyMap<string, CanvasImageSource>,
    captions?: string[],
  ): Buffer {
    const picture = this.take(width, height);
    let content: Buffer | undefined;
    try {
      let source: CanvasImageSource;
      let sourceWidth: number, sourceHeight: number;
      if (layer.kind === "media") {
        source = media.get(layer.instanceId)!;
        [sourceWidth, sourceHeight] = sourceDimensions(source, layer.instanceId);
      } else if (layer.kind === "group") {
        content = this.group(layer, media);
        source = content.canvas;
        sourceWidth = layer.width;
        sourceHeight = layer.height;
      } else {
        content = this.take(width, height);
        if (layer.kind === "text") drawText(content.context, layer, width, height, captions);
        else drawShape(content.context, layer, width, height);
        source = content.canvas;
        sourceWidth = width;
        sourceHeight = height;
      }
      const crop = layer.transform.crop;
      const { sourceX, sourceY, croppedWidth, croppedHeight, fittedWidth, fittedHeight } =
        fitVisualSource(
          { width: sourceWidth, height: sourceHeight },
          { width, height },
          layer.transform,
        );
      const placement = (target: Context) => {
        target.translate(width * (0.5 + layer.transform.x), height * (0.5 + layer.transform.y));
        target.rotate((layer.transform.rotation * Math.PI) / 180);
        target.scale(
          layer.transform.scaleX * (layer.transform.flipX ? -1 : 1),
          layer.transform.scaleY * (layer.transform.flipY ? -1 : 1),
        );
      };
      const ctx = picture.context;
      ctx.save();
      placement(ctx);
      ctx.drawImage(
        source,
        sourceX,
        sourceY,
        croppedWidth,
        croppedHeight,
        -fittedWidth / 2,
        -fittedHeight / 2,
        fittedWidth,
        fittedHeight,
      );
      ctx.restore();
      if (hasColorAdjustment(layer.color)) {
        let pixels: ImageData;
        try {
          pixels = ctx.getImageData(0, 0, width, height);
        } catch {
          throw new Error(`素材画面无法读取像素进行调色：${layer.instanceId}`);
        }
        applyColorToRgba(pixels.data, layer.color);
        ctx.putImageData(pixels, 0, 0);
      }
      if (layer.mask) {
        const mask = this.take(width, height);
        try {
          const originalWidth = fittedWidth / (1 - crop.left - crop.right);
          const originalHeight = fittedHeight / (1 - crop.top - crop.bottom);
          const originX = -fittedWidth / 2 - crop.left * originalWidth;
          const originY = -fittedHeight / 2 - crop.top * originalHeight;
          const radius =
            (layer.mask.feather *
              Math.min(
                originalWidth * layer.transform.scaleX,
                originalHeight * layer.transform.scaleY,
              )) /
            2;
          if (radius > 0) mask.context.filter = `blur(${Math.min(MAX_SIDE, radius)}px)`;
          mask.context.save();
          placement(mask.context);
          drawMask(mask.context, layer.mask, originX, originY, originalWidth, originalHeight);
          mask.context.restore();
          ctx.save();
          ctx.globalCompositeOperation = layer.mask.inverted ? "destination-out" : "destination-in";
          ctx.drawImage(mask.canvas, 0, 0);
          ctx.restore();
        } finally {
          this.release(mask);
        }
      }
      if (layer.transform.opacity < 1) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-in";
        ctx.fillStyle = `rgba(0,0,0,${clamp(layer.transform.opacity)})`;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
      return picture;
    } catch (error) {
      this.release(picture);
      throw error;
    } finally {
      if (content) this.release(content);
    }
  }
  private group(layer: EvaluatedGroupLayer, media: ReadonlyMap<string, CanvasImageSource>): Buffer {
    const buffer = this.take(layer.width, layer.height);
    try {
      buffer.context.fillStyle = layer.background;
      buffer.context.fillRect(0, 0, layer.width, layer.height);
      this.drawLayers(buffer.context, layer.layers, layer.width, layer.height, media);
      return buffer;
    } catch (error) {
      this.release(buffer);
      throw error;
    }
  }
  private drawTransition(
    target: Context,
    transition: EvaluatedTransitionLayer,
    width: number,
    height: number,
    media: ReadonlyMap<string, CanvasImageSource>,
  ): void {
    const progress = clamp(transition.progress);
    let from: Buffer | undefined, to: Buffer | undefined;
    try {
      if (transition.from) from = this.visual(transition.from, width, height, media);
      if (transition.to) to = this.visual(transition.to, width, height, media);
      const draw = (
        ctx: Context,
        picture: Buffer | undefined,
        layer: EvaluatedVisualLayer | null,
        x = 0,
      ) => {
        if (!picture || !layer) return;
        ctx.globalCompositeOperation = composite(layer.blendMode);
        ctx.drawImage(picture.canvas, x, 0);
      };
      if (transition.transitionKind === "dissolve" || transition.transitionKind === "fade-black") {
        const a = this.take(width, height),
          b = this.take(width, height);
        try {
          // Evaluate each endpoint against the same backdrop, preserving endpoint blend modes.
          // Adding weighted premultiplied images avoids source-over's dark crossfade midpoint.
          a.context.drawImage(target.canvas, 0, 0);
          b.context.drawImage(target.canvas, 0, 0);
          draw(a.context, from, transition.from);
          draw(b.context, to, transition.to);
          target.save();
          target.resetTransform();
          target.clearRect(0, 0, width, height);
          if (transition.transitionKind === "fade-black") {
            target.globalCompositeOperation = "source-over";
            target.fillStyle = "#000000";
            target.fillRect(0, 0, width, height);
            target.globalAlpha = Math.abs(progress * 2 - 1);
            target.drawImage(progress < 0.5 ? a.canvas : b.canvas, 0, 0);
          } else {
            target.globalCompositeOperation = "lighter";
            target.globalAlpha = 1 - progress;
            target.drawImage(a.canvas, 0, 0);
            target.globalAlpha = progress;
            target.drawImage(b.canvas, 0, 0);
          }
          target.restore();
        } finally {
          this.release(a);
          this.release(b);
        }
      } else if (
        transition.transitionKind === "push-left" ||
        transition.transitionKind === "push-right"
      ) {
        const direction = transition.transitionKind === "push-left" ? -1 : 1;
        const a = this.take(width, height);
        let b: Buffer | undefined;
        try {
          if (
            (!transition.from || transition.from.blendMode === "normal") &&
            (!transition.to || transition.to.blendMode === "normal")
          ) {
            a.context.globalCompositeOperation = "lighter";
            if (from) a.context.drawImage(from.canvas, direction * progress * width, 0);
            if (to) a.context.drawImage(to.canvas, -direction * (1 - progress) * width, 0);
            target.save();
            target.globalCompositeOperation = "source-over";
            target.drawImage(a.canvas, 0, 0);
            target.restore();
          } else {
            b = this.take(width, height);
            a.context.drawImage(target.canvas, 0, 0);
            b.context.drawImage(target.canvas, 0, 0);
            draw(a.context, from, transition.from, direction * progress * width);
            draw(b.context, to, transition.to, -direction * (1 - progress) * width);
            let backdrop: ImageData, first: ImageData, second: ImageData;
            try {
              backdrop = target.getImageData(0, 0, width, height);
              first = a.context.getImageData(0, 0, width, height);
              second = b.context.getImageData(0, 0, width, height);
            } catch {
              throw new Error("素材画面无法读取像素进行推移转场");
            }
            // The shifted images occupy complementary regions. Each endpoint was blended
            // over the stationary backdrop; sum premultiplied contributions and remove
            // the duplicated backdrop exactly once, including a fractional boundary pixel.
            for (let i = 0; i < backdrop.data.length; i += 4) {
              const originalAlpha = backdrop.data[i + 3]! / 255;
              const aAlpha = first.data[i + 3]! / 255,
                bAlpha = second.data[i + 3]! / 255;
              const alpha = clamp(aAlpha + bAlpha - originalAlpha);
              for (let channel = 0; channel < 3; channel++)
                backdrop.data[i + channel] =
                  alpha === 0
                    ? 0
                    : (first.data[i + channel]! * aAlpha +
                        second.data[i + channel]! * bAlpha -
                        backdrop.data[i + channel]! * originalAlpha) /
                      alpha;
              backdrop.data[i + 3] = Math.round(alpha * 255);
            }
            target.putImageData(backdrop, 0, 0);
          }
        } finally {
          this.release(a);
          if (b) this.release(b);
        }
      } else {
        const split =
          transition.transitionKind === "wipe-left" ? width * (1 - progress) : width * progress;
        const incomingLeft = transition.transitionKind === "wipe-right";
        const a = this.take(width, height),
          b = this.take(width, height);
        try {
          a.context.drawImage(target.canvas, 0, 0);
          b.context.drawImage(target.canvas, 0, 0);
          draw(a.context, from, transition.from);
          draw(b.context, to, transition.to);
          target.save();
          target.clearRect(0, 0, width, height);
          target.globalCompositeOperation = "lighter";
          target.save();
          target.beginPath();
          target.rect(incomingLeft ? split : 0, 0, incomingLeft ? width - split : split, height);
          target.clip();
          target.drawImage(a.canvas, 0, 0);
          target.restore();
          target.save();
          target.beginPath();
          target.rect(incomingLeft ? 0 : split, 0, incomingLeft ? split : width - split, height);
          target.clip();
          target.drawImage(b.canvas, 0, 0);
          target.restore();
          target.restore();
        } finally {
          this.release(a);
          this.release(b);
        }
      }
    } finally {
      if (from) this.release(from);
      if (to) this.release(to);
    }
  }
}

function drawMask(
  ctx: Context,
  mask: Mask,
  originX: number,
  originY: number,
  width: number,
  height: number,
): void {
  ctx.translate(originX + width * (0.5 + mask.x), originY + height * (0.5 + mask.y));
  ctx.rotate((mask.rotation * Math.PI) / 180);
  const w = width * mask.width,
    h = height * mask.height;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  if (mask.kind === "ellipse") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (mask.kind === "path") {
    mask.points!.forEach((point, index) => {
      if (index === 0) ctx.moveTo((point.x - 0.5) * w, (point.y - 0.5) * h);
      else ctx.lineTo((point.x - 0.5) * w, (point.y - 0.5) * h);
    });
    ctx.closePath();
  } else {
    ctx.rect(-w / 2, -h / 2, w, h);
    if (mask.kind === "linear") {
      const gradient = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      gradient.addColorStop(0, "#ffffff00");
      gradient.addColorStop(1, "#ffffff");
      ctx.fillStyle = gradient;
    }
  }
  ctx.fill();
}

function captionKey(layer: EvaluatedTextLayer): string {
  return JSON.stringify([
    layer.trackId,
    layer.style,
    layer.transform,
    layer.color,
    layer.blendMode,
    layer.mask,
  ]);
}
function font(ctx: Context, style: TextStyle): void {
  ctx.font = `${style.italic ? "italic " : ""}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
  ctx.letterSpacing = `${style.letterSpacing}px`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}
function graphemes(text: string): Array<{ text: string; index: number }> {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), (segment) => ({
    text: segment.segment,
    index: segment.index,
  }));
}
function keywordRanges(text: string, keywords: TextStyle["keywords"]) {
  const colors = new Uint8Array(text.length);
  for (const [index, keyword] of (keywords ?? []).entries()) {
    // Canonical input is validated; guard empty entries for direct evaluated-frame callers.
    if (!keyword.text) continue;
    for (
      let at = text.indexOf(keyword.text);
      at >= 0;
      at = text.indexOf(keyword.text, at + keyword.text.length)
    )
      colors.fill(index + 1, at, at + keyword.text.length);
  }
  const ranges: Array<{ start: number; end: number; color: string }> = [];
  for (let start = 0; start < colors.length; ) {
    let end = start + 1;
    while (end < colors.length && colors[end] === colors[start]) end++;
    if (colors[start]) ranges.push({ start, end, color: keywords![colors[start]! - 1]!.color });
    start = end;
  }
  return ranges;
}
function wrap(ctx: Context, text: string, maxWidth: number, maximum = 10000): LayoutLine[] {
  const result: LayoutLine[] = [];
  let line = "",
    start = 0;
  for (const item of graphemes(text)) {
    if (item.text === "\n" || (line && ctx.measureText(line + item.text).width > maxWidth)) {
      result.push({ text: line, start });
      if (result.length >= maximum) return result;
      line = item.text === "\n" ? "" : item.text;
      start = item.index + (item.text === "\n" ? 1 : 0);
    } else line += item.text;
  }
  if (line) result.push({ text: line, start });
  return result.slice(0, maximum);
}
let textMeasureContext: Context | undefined;
/** Editor handles use the same font measurement, wrapping and padding as the compositor.
 * The complete text stays selectable during a typewriter/fade animation. */
export function textSourceBounds(layer: EvaluatedTextLayer, width: number, height: number) {
  textMeasureContext ??= context(
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(1, 1)
      : document.createElement("canvas"),
  );
  const ctx = textMeasureContext,
    style = layer.style,
    stack = style.layout === "caption-stack";
  font(ctx, style);
  const lines = wrap(
    ctx,
    layer.text.replace(/\r\n?/g, "\n"),
    width * style.maxWidth,
    stack ? 4 : 10000,
  );
  if (!lines.length) return { left: 0, top: 0, right: 1, bottom: 1 };
  const textWidth = Math.max(...lines.map((line) => ctx.measureText(line.text).width));
  const textHeight = lines.length * style.fontSize * style.lineHeight;
  const boxWidth = Math.min(stack ? width * 0.93 : width, textWidth + style.padding * 2);
  const top = stack ? height / 2 - textHeight : (height - textHeight) / 2 - style.padding;
  const boxHeight = textHeight + (stack ? style.padding : style.padding * 2);
  const padding = style.strokeWidth / 2 + style.shadow.blur;
  return {
    left: clamp(((width - boxWidth) / 2 - padding + Math.min(0, style.shadow.x)) / width),
    right: clamp(((width + boxWidth) / 2 + padding + Math.max(0, style.shadow.x)) / width),
    top: clamp((top - padding + Math.min(0, style.shadow.y)) / height),
    bottom: clamp((top + boxHeight + padding + Math.max(0, style.shadow.y)) / height),
  };
}
function drawText(
  ctx: Context,
  layer: EvaluatedTextLayer,
  width: number,
  height: number,
  captions?: string[],
): void {
  const style = layer.style;
  font(ctx, style);
  let text = layer.text.replace(/\r\n?/g, "\n");
  if (style.animation === "typewriter") {
    // Reveal during the first 60% and hold the complete text before the clip ends.
    const letters = graphemes(text),
      count = Math.floor(clamp(layer.animationProgress / 0.6) * letters.length);
    text = letters
      .slice(0, count)
      .map((item) => item.text)
      .join("");
  }
  if (style.animation === "fade")
    ctx.globalAlpha = clamp(
      Math.min(layer.animationProgress / 0.1, (1 - layer.animationProgress) / 0.1),
    );
  const stack = style.layout === "caption-stack";
  const textLines = (item: string, maximum = 10000) => {
    const sourceText = item.replace(/\r\n?/g, "\n");
    const emphasis = keywordRanges(
      style.animation === "typewriter" ? layer.text.replace(/\r\n?/g, "\n") : sourceText,
      style.keywords,
    );
    return wrap(ctx, sourceText, width * style.maxWidth, maximum).map((line) => ({
      ...line,
      emphasis,
    }));
  };
  const lines = stack
    ? (captions ?? [text]).flatMap((item) => textLines(item, 4)).slice(0, 4)
    : textLines(text);
  if (!lines.length) return;
  const lineHeight = style.fontSize * style.lineHeight;
  const textWidth = Math.max(...lines.map((line) => ctx.measureText(line.text).width));
  const textHeight = lines.length * lineHeight;
  const top = stack ? height / 2 - textHeight : (height - textHeight) / 2;
  const boxWidth = Math.min(stack ? width * 0.93 : width, textWidth + style.padding * 2);
  const boxTop = stack ? top : top - style.padding;
  const boxHeight = textHeight + (stack ? style.padding : style.padding * 2);
  ctx.fillStyle = style.background;
  ctx.beginPath();
  ctx.roundRect((width - boxWidth) / 2, boxTop, boxWidth, boxHeight, style.backgroundRadius);
  ctx.fill();
  ctx.shadowColor = style.shadow.color;
  ctx.shadowBlur = style.shadow.blur;
  ctx.shadowOffsetX = style.shadow.x;
  ctx.shadowOffsetY = style.shadow.y;
  ctx.fillStyle = style.color;
  ctx.strokeStyle = style.strokeColor;
  ctx.lineWidth = style.strokeWidth;
  ctx.lineJoin = "round";
  const highlights: Array<{ start: number; end: number; color: string }> = [];
  if (style.animation === "word-highlight") {
    let cursor = 0;
    layer.words.forEach((word, index) => {
      const start = text.indexOf(word.text, cursor);
      if (start < 0) return;
      cursor = start + word.text.length;
      if (layer.activeWordIndices.includes(index))
        highlights.push({ start, end: cursor, color: style.highlightColor });
    });
  }
  const metrics = ctx.measureText("国M");
  const ascent = metrics.actualBoundingBoxAscent || style.fontSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent || style.fontSize * 0.2;
  lines.forEach((line, index) => {
    const lineWidth = ctx.measureText(line.text).width;
    const x =
      style.align === "left"
        ? (width - textWidth) / 2
        : style.align === "right"
          ? (width + textWidth) / 2 - lineWidth
          : (width - lineWidth) / 2;
    const y = stack
      ? top + lineHeight * (index + 1) - style.fontSize * 0.1
      : top + lineHeight * index + (lineHeight - ascent - descent) / 2 + ascent;
    if (style.strokeWidth > 0) ctx.strokeText(line.text, x, y);
    ctx.fillText(line.text, x, y);
    for (const highlight of [...line.emphasis, ...highlights]) {
      const from = Math.max(0, highlight.start - line.start),
        to = Math.min(line.text.length, highlight.end - line.start);
      if (to <= from) continue;
      const left = ctx.measureText(line.text.slice(0, from)).width;
      const right = ctx.measureText(line.text.slice(0, to)).width;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + left, y - style.fontSize * 1.5, right - left, style.fontSize * 2);
      ctx.clip();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.fillStyle = highlight.color;
      ctx.fillText(line.text, x, y);
      ctx.restore();
    }
  });
}
function drawShape(
  ctx: Context,
  layer: Extract<EvaluatedVisualLayer, { kind: "shape" }>,
  width: number,
  height: number,
): void {
  ctx.beginPath();
  if (layer.shape === "ellipse")
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  else if (layer.shape === "line") {
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
  } else ctx.rect(0, 0, width, height);
  if (layer.shape !== "line") {
    ctx.fillStyle = layer.fill;
    ctx.fill();
  }
  if (layer.strokeWidth > 0) {
    ctx.strokeStyle = layer.stroke;
    ctx.lineWidth = layer.strokeWidth;
    ctx.stroke();
  }
}

/** Convenience for an isolated draw; retain FrameCompositor for playback to reuse bounded buffers. */
export function drawEvaluatedFrame(
  canvas: Surface,
  frame: EvaluatedFrame,
  media: ReadonlyMap<string, CanvasImageSource>,
): void {
  const compositor = new FrameCompositor();
  try {
    compositor.draw(canvas, frame, media);
  } finally {
    compositor.dispose();
  }
}
