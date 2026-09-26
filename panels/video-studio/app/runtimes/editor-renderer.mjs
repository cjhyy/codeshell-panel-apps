"use strict";
(() => {
  // src/editor/color.ts
  var clamp = (value) => Math.max(0, Math.min(1, value));
  var wrap = (degrees) => (degrees % 360 + 360) % 360;
  function evaluateColorCurve(points, input) {
    const value = clamp(input);
    if (!points.length) return value;
    if (value <= points[0].x) return points[0].y;
    if (value >= points.at(-1).x) return points.at(-1).y;
    let left = 0, right = points.length - 1;
    while (left + 1 < right) {
      const middle = left + right >> 1;
      if (points[middle].x <= value) left = middle;
      else right = middle;
    }
    const a = points[left], b = points[right];
    return a.y + (value - a.x) / (b.x - a.x) * (b.y - a.y);
  }
  function hasColorAdjustment(color2) {
    return color2.exposure !== 0 || color2.brightness !== 0 || color2.contrast !== 1 || color2.saturation !== 1 || color2.temperature !== 0 || color2.tint !== 0 || color2.hue !== 0 || color2.curves.some((curve) => curve.points.some((point) => point.x !== point.y)) || color2.hsl.some((band) => band.hueShift !== 0 || band.saturation !== 0 || band.lightness !== 0);
  }
  function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const lightness = (max + min) / 2, delta = max - min;
    if (delta === 0) return [0, 0, lightness];
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    const hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return [wrap(hue * 60), saturation, lightness];
  }
  function hslToRgb(hue, saturation, lightness) {
    const h = wrap(hue) / 60;
    const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = c * (1 - Math.abs(h % 2 - 1));
    const m = lightness - c / 2;
    const rgb = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
  }
  function applyColorToRgba(pixels, color2) {
    if (pixels.length % 4) throw new Error("颜色缓冲必须包含完整 RGBA 像素");
    if (!hasColorAdjustment(color2)) return;
    const exposure = 2 ** color2.exposure;
    const redGain = exposure * (1 + color2.temperature * 0.25 + color2.tint * 0.1);
    const greenGain = exposure * (1 - color2.tint * 0.2);
    const blueGain = exposure * (1 - color2.temperature * 0.25 + color2.tint * 0.1);
    const curves = new Map(color2.curves.map((curve) => [curve.channel, curve.points]));
    const tone = (input, channel) => {
      const master = curves.get("rgb");
      const specific = curves.get(channel);
      const value = master ? evaluateColorCurve(master, input) : input;
      return specific ? evaluateColorCurve(specific, value) : value;
    };
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 0) continue;
      let r = clamp(
        (pixels[index] / 255 * redGain - 0.5) * color2.contrast + 0.5 + color2.brightness
      );
      let g = clamp(
        (pixels[index + 1] / 255 * greenGain - 0.5) * color2.contrast + 0.5 + color2.brightness
      );
      let b = clamp(
        (pixels[index + 2] / 255 * blueGain - 0.5) * color2.contrast + 0.5 + color2.brightness
      );
      if (color2.hue !== 0 || color2.saturation !== 1 || color2.hsl.length) {
        let [h, s, l] = rgbToHsl(r, g, b);
        let hueDelta = color2.hue, saturationDelta = 0, lightnessDelta = 0;
        if (s > 0)
          for (const band of color2.hsl) {
            const distance = Math.min(wrap(h - band.hue), wrap(band.hue - h));
            const weight = distance >= band.width / 2 ? 0 : (1 + Math.cos(2 * Math.PI * distance / band.width)) / 2;
            hueDelta += band.hueShift * weight;
            saturationDelta += band.saturation * weight;
            lightnessDelta += band.lightness * weight;
          }
        h += hueDelta;
        s = clamp(s * color2.saturation + saturationDelta);
        l = clamp(l + lightnessDelta);
        [r, g, b] = hslToRgb(h, s, l);
      }
      pixels[index] = Math.round(clamp(tone(r, "red")) * 255);
      pixels[index + 1] = Math.round(clamp(tone(g, "green")) * 255);
      pixels[index + 2] = Math.round(clamp(tone(b, "blue")) * 255);
    }
  }

  // src/editor/visual-layout.ts
  function fitVisualSource(source, canvas, transform2) {
    const crop = transform2.crop;
    const sourceX = crop.left * source.width, sourceY = crop.top * source.height;
    const croppedWidth = source.width * (1 - crop.left - crop.right);
    const croppedHeight = source.height * (1 - crop.top - crop.bottom);
    if (![source.width, source.height, canvas.width, canvas.height, croppedWidth, croppedHeight].every(
      (value) => Number.isFinite(value) && value > 0
    ))
      throw new Error("画面尺寸或裁切范围无效");
    const factor = transform2.fit === "cover" ? Math.max(canvas.width / croppedWidth, canvas.height / croppedHeight) : Math.min(canvas.width / croppedWidth, canvas.height / croppedHeight);
    const fittedWidth = transform2.fit === "stretch" ? canvas.width : croppedWidth * factor;
    const fittedHeight = transform2.fit === "stretch" ? canvas.height : croppedHeight * factor;
    return {
      sourceX,
      sourceY,
      croppedWidth,
      croppedHeight,
      fittedWidth,
      fittedHeight,
      originalWidth: fittedWidth / (1 - crop.left - crop.right),
      originalHeight: fittedHeight / (1 - crop.top - crop.bottom)
    };
  }

  // src/editor/compositor.ts
  var MAX_SIDE = 8192;
  var MAX_ACTIVE_PIXELS = 128 * 1024 * 1024;
  var MAX_CACHED_PIXELS = 16 * 1024 * 1024;
  var clamp2 = (value) => Math.max(0, Math.min(1, value));
  function dimensions(width, height) {
    if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0 && value <= MAX_SIDE))
      throw new Error("合成画面宽高必须是 1–8192 范围内的整数");
  }
  function context(canvas) {
    const value = canvas.getContext("2d");
    if (!value) throw new Error("当前浏览器无法创建二维画面合成器");
    return value;
  }
  function reset(buffer) {
    buffer.context.reset();
  }
  function composite(mode) {
    return mode === "normal" ? "source-over" : mode;
  }
  function directGroup(layer, width, height) {
    const transform2 = layer.transform;
    return layer.width === width && layer.height === height && /^#[0-9a-f]{6}00$/i.test(layer.background) && layer.blendMode === "normal" && !layer.mask && transform2.x === 0 && transform2.y === 0 && transform2.scaleX === 1 && transform2.scaleY === 1 && transform2.rotation === 0 && transform2.opacity === 1 && !transform2.flipX && !transform2.flipY && transform2.fit === "contain" && Object.values(transform2.crop).every((value) => value === 0) && !hasColorAdjustment(layer.color) && layer.color.curves.length === 0 && layer.color.hsl.length === 0 && layer.layers.every(
      (child) => child.kind === "transition" ? (!child.from || child.from.blendMode === "normal") && (!child.to || child.to.blendMode === "normal") : child.blendMode === "normal"
    );
  }
  function sourceDimensions(source, instanceId) {
    const item = source;
    if (typeof item.videoWidth === "number" && Number(item.readyState) < 2 || item.complete === false)
      throw new Error(`素材画面尚未就绪：${instanceId}`);
    const width = item.videoWidth ?? item.naturalWidth ?? item.displayWidth ?? item.width?.baseVal?.value ?? item.width;
    const height = item.videoHeight ?? item.naturalHeight ?? item.displayHeight ?? item.height?.baseVal?.value ?? item.height;
    if (![width, height].every(
      (value) => typeof value === "number" && Number.isFinite(value) && value > 0
    ))
      throw new Error(`素材画面尺寸无效或已释放：${instanceId}`);
    return [width, height];
  }
  var FrameCompositor = class {
    free = [];
    active = /* @__PURE__ */ new Set();
    allocatedPixels = 0;
    drawing = false;
    dispose() {
      if (this.drawing) throw new Error("正在合成画面，暂时无法释放合成器");
      for (const item of this.free) {
        item.canvas.width = 1;
        item.canvas.height = 1;
      }
      this.free = [];
      this.allocatedPixels = 0;
    }
    take(width, height) {
      dimensions(width, height);
      const position = this.free.findIndex(
        (item) => item.canvas.width === width && item.canvas.height === height
      );
      let buffer = position < 0 ? void 0 : this.free.splice(position, 1)[0];
      if (!buffer) {
        while (this.free.length && this.allocatedPixels + width * height > MAX_ACTIVE_PIXELS) {
          const evicted = this.free.pop();
          this.allocatedPixels -= evicted.pixels;
          evicted.canvas.width = 1;
          evicted.canvas.height = 1;
        }
        if (this.allocatedPixels + width * height > MAX_ACTIVE_PIXELS || this.active.size >= 64)
          throw new Error("画面合成缓冲超过上限，请减小画面尺寸或减少嵌套层级");
        const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
        buffer = { canvas, context: context(canvas), pixels: width * height };
        this.allocatedPixels += buffer.pixels;
      }
      reset(buffer);
      this.active.add(buffer);
      return buffer;
    }
    release(buffer) {
      if (!this.active.delete(buffer)) throw new Error("画面缓冲已释放");
      if (this.free.length < 4 && this.free.reduce((sum, item) => sum + item.pixels, 0) + buffer.pixels <= MAX_CACHED_PIXELS)
        this.free.push(buffer);
      else {
        this.allocatedPixels -= buffer.pixels;
        buffer.canvas.width = 1;
        buffer.canvas.height = 1;
      }
    }
    preflight(layers, media, depth = 0) {
      if (depth > 50 || layers.length > 2e3) throw new Error("画面层数或嵌套深度超过上限");
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
            [layer.from, layer.to].filter((item) => item !== null),
            media,
            depth + 1
          );
      }
    }
    draw(canvas, frame, media) {
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
        for (const item of [...this.active]) this.release(item);
        this.drawing = false;
      }
    }
    drawLayers(target, layers, width, height, media) {
      for (let index = 0; index < layers.length; index++) {
        const layer = layers[index];
        if (layer.kind === "transition") this.drawTransition(target, layer, width, height, media);
        else if (layer.kind === "group" && directGroup(layer, width, height)) {
          this.drawLayers(target, layer.layers, width, height, media);
        } else {
          let captions;
          if (layer.kind === "text" && layer.style.layout === "caption-stack" && layer.style.animation === "none") {
            captions = [layer.text];
            const key = captionKey(layer);
            while (index + 1 < layers.length) {
              const next = layers[index + 1];
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
    visual(layer, width, height, media, captions) {
      const picture = this.take(width, height);
      let content;
      try {
        let source;
        let sourceWidth, sourceHeight;
        if (layer.kind === "media") {
          source = media.get(layer.instanceId);
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
        const { sourceX, sourceY, croppedWidth, croppedHeight, fittedWidth, fittedHeight } = fitVisualSource(
          { width: sourceWidth, height: sourceHeight },
          { width, height },
          layer.transform
        );
        const placement = (target) => {
          target.translate(width * (0.5 + layer.transform.x), height * (0.5 + layer.transform.y));
          target.rotate(layer.transform.rotation * Math.PI / 180);
          target.scale(
            layer.transform.scaleX * (layer.transform.flipX ? -1 : 1),
            layer.transform.scaleY * (layer.transform.flipY ? -1 : 1)
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
          fittedHeight
        );
        ctx.restore();
        if (hasColorAdjustment(layer.color)) {
          let pixels;
          try {
            pixels = ctx.getImageData(0, 0, width, height);
          } catch {
            throw new Error(`素材画面无法读取像素进行调色：${layer.instanceId}`);
          }
          applyColorToRgba(pixels.data, layer.color);
          ctx.putImageData(pixels, 0, 0);
        }
        if (layer.mask) {
          const mask2 = this.take(width, height);
          try {
            const originalWidth = fittedWidth / (1 - crop.left - crop.right);
            const originalHeight = fittedHeight / (1 - crop.top - crop.bottom);
            const originX = -fittedWidth / 2 - crop.left * originalWidth;
            const originY = -fittedHeight / 2 - crop.top * originalHeight;
            const radius = layer.mask.feather * Math.min(
              originalWidth * layer.transform.scaleX,
              originalHeight * layer.transform.scaleY
            ) / 2;
            if (radius > 0) mask2.context.filter = `blur(${Math.min(MAX_SIDE, radius)}px)`;
            mask2.context.save();
            placement(mask2.context);
            drawMask(mask2.context, layer.mask, originX, originY, originalWidth, originalHeight);
            mask2.context.restore();
            ctx.save();
            ctx.globalCompositeOperation = layer.mask.inverted ? "destination-out" : "destination-in";
            ctx.drawImage(mask2.canvas, 0, 0);
            ctx.restore();
          } finally {
            this.release(mask2);
          }
        }
        if (layer.transform.opacity < 1) {
          ctx.save();
          ctx.globalCompositeOperation = "destination-in";
          ctx.fillStyle = `rgba(0,0,0,${clamp2(layer.transform.opacity)})`;
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
    group(layer, media) {
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
    drawTransition(target, transition, width, height, media) {
      const progress2 = clamp2(transition.progress);
      let from, to;
      try {
        if (transition.from) from = this.visual(transition.from, width, height, media);
        if (transition.to) to = this.visual(transition.to, width, height, media);
        const draw = (ctx, picture, layer, x = 0) => {
          if (!picture || !layer) return;
          ctx.globalCompositeOperation = composite(layer.blendMode);
          ctx.drawImage(picture.canvas, x, 0);
        };
        if (transition.transitionKind === "dissolve" || transition.transitionKind === "fade-black") {
          const a = this.take(width, height), b = this.take(width, height);
          try {
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
              target.globalAlpha = Math.abs(progress2 * 2 - 1);
              target.drawImage(progress2 < 0.5 ? a.canvas : b.canvas, 0, 0);
            } else {
              target.globalCompositeOperation = "lighter";
              target.globalAlpha = 1 - progress2;
              target.drawImage(a.canvas, 0, 0);
              target.globalAlpha = progress2;
              target.drawImage(b.canvas, 0, 0);
            }
            target.restore();
          } finally {
            this.release(a);
            this.release(b);
          }
        } else if (transition.transitionKind === "push-left" || transition.transitionKind === "push-right") {
          const direction = transition.transitionKind === "push-left" ? -1 : 1;
          const a = this.take(width, height);
          let b;
          try {
            if ((!transition.from || transition.from.blendMode === "normal") && (!transition.to || transition.to.blendMode === "normal")) {
              a.context.globalCompositeOperation = "lighter";
              if (from) a.context.drawImage(from.canvas, direction * progress2 * width, 0);
              if (to) a.context.drawImage(to.canvas, -direction * (1 - progress2) * width, 0);
              target.save();
              target.globalCompositeOperation = "source-over";
              target.drawImage(a.canvas, 0, 0);
              target.restore();
            } else {
              b = this.take(width, height);
              a.context.drawImage(target.canvas, 0, 0);
              b.context.drawImage(target.canvas, 0, 0);
              draw(a.context, from, transition.from, direction * progress2 * width);
              draw(b.context, to, transition.to, -direction * (1 - progress2) * width);
              let backdrop, first, second;
              try {
                backdrop = target.getImageData(0, 0, width, height);
                first = a.context.getImageData(0, 0, width, height);
                second = b.context.getImageData(0, 0, width, height);
              } catch {
                throw new Error("素材画面无法读取像素进行推移转场");
              }
              for (let i = 0; i < backdrop.data.length; i += 4) {
                const originalAlpha = backdrop.data[i + 3] / 255;
                const aAlpha = first.data[i + 3] / 255, bAlpha = second.data[i + 3] / 255;
                const alpha = clamp2(aAlpha + bAlpha - originalAlpha);
                for (let channel = 0; channel < 3; channel++)
                  backdrop.data[i + channel] = alpha === 0 ? 0 : (first.data[i + channel] * aAlpha + second.data[i + channel] * bAlpha - backdrop.data[i + channel] * originalAlpha) / alpha;
                backdrop.data[i + 3] = Math.round(alpha * 255);
              }
              target.putImageData(backdrop, 0, 0);
            }
          } finally {
            this.release(a);
            if (b) this.release(b);
          }
        } else {
          const split = transition.transitionKind === "wipe-left" ? width * (1 - progress2) : width * progress2;
          const incomingLeft = transition.transitionKind === "wipe-right";
          const a = this.take(width, height), b = this.take(width, height);
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
  };
  function drawMask(ctx, mask2, originX, originY, width, height) {
    ctx.translate(originX + width * (0.5 + mask2.x), originY + height * (0.5 + mask2.y));
    ctx.rotate(mask2.rotation * Math.PI / 180);
    const w = width * mask2.width, h = height * mask2.height;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    if (mask2.kind === "ellipse") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (mask2.kind === "path") {
      mask2.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo((point.x - 0.5) * w, (point.y - 0.5) * h);
        else ctx.lineTo((point.x - 0.5) * w, (point.y - 0.5) * h);
      });
      ctx.closePath();
    } else {
      ctx.rect(-w / 2, -h / 2, w, h);
      if (mask2.kind === "linear") {
        const gradient = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
        gradient.addColorStop(0, "#ffffff00");
        gradient.addColorStop(1, "#ffffff");
        ctx.fillStyle = gradient;
      }
    }
    ctx.fill();
  }
  function captionKey(layer) {
    return JSON.stringify([
      layer.trackId,
      layer.style,
      layer.transform,
      layer.color,
      layer.blendMode,
      layer.mask
    ]);
  }
  function font(ctx, style) {
    ctx.font = `${style.italic ? "italic " : ""}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
    ctx.letterSpacing = `${style.letterSpacing}px`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  function graphemes(text2) {
    const segmenter = new Intl.Segmenter(void 0, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text2), (segment) => ({
      text: segment.segment,
      index: segment.index
    }));
  }
  function keywordRanges(text2, keywords) {
    const colors = new Uint8Array(text2.length);
    for (const [index, keyword] of (keywords ?? []).entries()) {
      if (!keyword.text) continue;
      for (let at = text2.indexOf(keyword.text); at >= 0; at = text2.indexOf(keyword.text, at + keyword.text.length))
        colors.fill(index + 1, at, at + keyword.text.length);
    }
    const ranges = [];
    for (let start = 0; start < colors.length; ) {
      let end = start + 1;
      while (end < colors.length && colors[end] === colors[start]) end++;
      if (colors[start]) ranges.push({ start, end, color: keywords[colors[start] - 1].color });
      start = end;
    }
    return ranges;
  }
  function wrap2(ctx, text2, maxWidth, maximum = 1e4) {
    const result = [];
    let line = "", start = 0;
    for (const item of graphemes(text2)) {
      if (item.text === "\n" || line && ctx.measureText(line + item.text).width > maxWidth) {
        result.push({ text: line, start });
        if (result.length >= maximum) return result;
        line = item.text === "\n" ? "" : item.text;
        start = item.index + (item.text === "\n" ? 1 : 0);
      } else line += item.text;
    }
    if (line) result.push({ text: line, start });
    return result.slice(0, maximum);
  }
  function drawText(ctx, layer, width, height, captions) {
    const style = layer.style;
    font(ctx, style);
    let text2 = layer.text.replace(/\r\n?/g, "\n");
    if (style.animation === "typewriter") {
      const letters = graphemes(text2), count = Math.floor(clamp2(layer.animationProgress / 0.6) * letters.length);
      text2 = letters.slice(0, count).map((item) => item.text).join("");
    }
    if (style.animation === "fade")
      ctx.globalAlpha = clamp2(
        Math.min(layer.animationProgress / 0.1, (1 - layer.animationProgress) / 0.1)
      );
    const stack = style.layout === "caption-stack";
    const textLines = (item, maximum = 1e4) => {
      const sourceText = item.replace(/\r\n?/g, "\n");
      const emphasis = keywordRanges(
        style.animation === "typewriter" ? layer.text.replace(/\r\n?/g, "\n") : sourceText,
        style.keywords
      );
      return wrap2(ctx, sourceText, width * style.maxWidth, maximum).map((line) => ({
        ...line,
        emphasis
      }));
    };
    const lines = stack ? (captions ?? [text2]).flatMap((item) => textLines(item, 4)).slice(0, 4) : textLines(text2);
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
    const highlights = [];
    if (style.animation === "word-highlight") {
      let cursor = 0;
      layer.words.forEach((word, index) => {
        const start = text2.indexOf(word.text, cursor);
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
      const x = style.align === "left" ? (width - textWidth) / 2 : style.align === "right" ? (width + textWidth) / 2 - lineWidth : (width - lineWidth) / 2;
      const y = stack ? top + lineHeight * (index + 1) - style.fontSize * 0.1 : top + lineHeight * index + (lineHeight - ascent - descent) / 2 + ascent;
      if (style.strokeWidth > 0) ctx.strokeText(line.text, x, y);
      ctx.fillText(line.text, x, y);
      for (const highlight of [...line.emphasis, ...highlights]) {
        const from = Math.max(0, highlight.start - line.start), to = Math.min(line.text.length, highlight.end - line.start);
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
  function drawShape(ctx, layer, width, height) {
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

  // src/editor/time.ts
  var TICKS_PER_SECOND = 24e4;
  var MAX_TICK = BigInt(Number.MAX_SAFE_INTEGER);
  var SUPPORTED_RATES = /* @__PURE__ */ new Set([
    "24/1",
    "25/1",
    "30/1",
    "48/1",
    "50/1",
    "60/1",
    "24000/1001",
    "30000/1001",
    "60000/1001"
  ]);
  function assertTick(value, label2 = "时间") {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      throw new Error(`${label2}必须是非负安全整数刻度`);
    return value;
  }
  function object(value, label2, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${label2}必须是对象`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error(`${label2}必须是普通对象`);
    if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)))
      throw new Error(`${label2}包含不支持的字段`);
    return value;
  }
  function validateFrameRate(value) {
    const data = object(value, "帧率", ["numerator", "denominator"]);
    let numerator = assertTick(data.numerator, "帧率分子");
    let denominator = assertTick(data.denominator, "帧率分母");
    if (!numerator || !denominator) throw new Error("帧率分子和分母必须大于零");
    let a = numerator, b = denominator;
    while (b) [a, b] = [b, a % b];
    numerator /= a;
    denominator /= a;
    if (!SUPPORTED_RATES.has(`${numerator}/${denominator}`)) throw new Error("不支持此工程帧率");
    return { numerator, denominator };
  }
  function ticksToSeconds(tick2) {
    return assertTick(tick2) / TICKS_PER_SECOND;
  }
  function tickFromBigInt(value) {
    if (value < 0n || value > MAX_TICK) throw new Error("时间超过安全整数刻度范围");
    return Number(value);
  }
  function validateTimeMap(value, duration, sourceDuration) {
    assertTick(duration, "片段时长");
    assertTick(sourceDuration, "素材时长");
    if (!duration) throw new Error("片段时长必须大于零");
    const data = object(value, "时间映射", ["points"]);
    if (!Array.isArray(data.points) || data.points.length < 2 || data.points.length > 1e5)
      throw new Error("时间映射需要 2 至 100000 个节点");
    if (Object.getPrototypeOf(data.points) !== Array.prototype || Reflect.ownKeys(data.points).length !== data.points.length + 1)
      throw new Error("时间映射节点必须是连续的普通数组");
    for (let index = 0; index < data.points.length; index++)
      if (!Object.hasOwn(data.points, index)) throw new Error("时间映射节点不能留空");
    let previous = -1;
    const points = data.points.map((raw) => {
      const point = object(raw, "时间映射节点", ["time", "source"]);
      const time = assertTick(point.time, "局部时间");
      const source = assertTick(point.source, "源时间");
      if (time <= previous || time > duration) throw new Error("时间映射的局部时间必须严格递增");
      if (source > sourceDuration) throw new Error("时间映射超出素材时长");
      previous = time;
      return { time, source };
    });
    if (points[0].time !== 0 || points.at(-1).time !== duration)
      throw new Error("时间映射必须覆盖片段的完整时长");
    return { points };
  }
  function interpolateSource(a, b, time) {
    const width = BigInt(b.time - a.time);
    const elapsed = BigInt(time - a.time);
    const numerator = BigInt(a.source) * (width - elapsed) + BigInt(b.source) * elapsed;
    return tickFromBigInt((2n * numerator + width) / (2n * width));
  }
  function sourceTimeAt(map, time) {
    assertTick(time, "局部时间");
    if (map.points.length < 2) throw new Error("时间映射缺少节点");
    if (time <= map.points[0].time) return map.points[0].source;
    if (time >= map.points.at(-1).time) return map.points.at(-1).source;
    let left = 0, right = map.points.length - 1;
    while (left + 1 < right) {
      const middle = left + Math.floor((right - left) / 2);
      if (map.points[middle].time <= time) left = middle;
      else right = middle;
    }
    return interpolateSource(map.points[left], map.points[right], time);
  }

  // src/editor/animation.ts
  function finite(value, label2) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label2}必须是有限数`);
    return value;
  }
  function object2(value, allowed, label2) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${label2}必须是对象`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error(`${label2}必须是普通对象`);
    if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)))
      throw new Error(`${label2}包含不支持的字段`);
    return value;
  }
  function validateEasing(value) {
    if (typeof value === "string" && ["linear", "hold", "ease-in", "ease-out", "ease-in-out"].includes(value))
      return value;
    const data = object2(value, ["type", "x1", "y1", "x2", "y2"], "关键帧缓动");
    if (data.type !== "cubic-bezier") throw new Error("未知关键帧缓动");
    const result = {
      type: "cubic-bezier",
      x1: finite(data.x1, "贝塞尔 x1"),
      y1: finite(data.y1, "贝塞尔 y1"),
      x2: finite(data.x2, "贝塞尔 x2"),
      y2: finite(data.y2, "贝塞尔 y2")
    };
    if (result.x1 < 0 || result.x1 > 1 || result.x2 < 0 || result.x2 > 1 || result.y1 < -4 || result.y1 > 4 || result.y2 < -4 || result.y2 > 4)
      throw new Error("贝塞尔横轴控制点须在 0–1，纵轴控制点须在 -4–4");
    return result;
  }
  function validateKeyframes(value, duration) {
    if (duration !== void 0) assertTick(duration, "动画时长");
    if (!Array.isArray(value) || !value.length || value.length > 1e5)
      throw new Error("动画需要 1 至 100000 个关键帧");
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1)
      throw new Error("关键帧必须是连续的普通数组");
    for (let index = 0; index < value.length; index++)
      if (!Object.hasOwn(value, index)) throw new Error("关键帧不能留空");
    let previous = -1;
    return value.map((raw) => {
      const data = object2(raw, ["time", "value", "easing"], "关键帧");
      const time = assertTick(data.time, "关键帧时间");
      if (time <= previous || duration !== void 0 && time > duration)
        throw new Error("关键帧时间必须严格递增且位于动画时长内");
      previous = time;
      return {
        time,
        value: finite(data.value, "关键帧数值"),
        ...data.easing === void 0 ? {} : { easing: validateEasing(data.easing) }
      };
    });
  }
  function validateAnimatedNumber(value, duration) {
    if (duration !== void 0) assertTick(duration, "动画时长");
    if (typeof value === "number") return finite(value, "动画数值");
    const data = object2(value, ["keyframes"], "动画数值");
    return { keyframes: validateKeyframes(data.keyframes, duration) };
  }
  function cubicFor(easing) {
    if (typeof easing === "object") return easing;
    if (easing === "ease-in") return { type: "cubic-bezier", x1: 0.42, y1: 0, x2: 1, y2: 1 };
    if (easing === "ease-out") return { type: "cubic-bezier", x1: 0, y1: 0, x2: 0.58, y2: 1 };
    if (easing === "ease-in-out") return { type: "cubic-bezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
    return void 0;
  }
  function coordinate(t, p1, p2) {
    const rest = 1 - t;
    return 3 * rest * rest * t * p1 + 3 * rest * t * t * p2 + t * t * t;
  }
  function parameterAtX(cubic, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let left = 0, right = 1;
    for (let i = 0; i < 56; i++) {
      const middle = (left + right) / 2;
      if (coordinate(middle, cubic.x1, cubic.x2) < x) left = middle;
      else right = middle;
    }
    return (left + right) / 2;
  }
  function progress(easing, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    if (easing === "hold") return 0;
    const cubic = cubicFor(easing);
    return cubic ? coordinate(parameterAtX(cubic, x), cubic.y1, cubic.y2) : x;
  }
  function preceding(keys, time) {
    let left = 0, right = keys.length - 1;
    while (left + 1 < right) {
      const middle = left + Math.floor((right - left) / 2);
      if (keys[middle].time <= time) left = middle;
      else right = middle;
    }
    return left;
  }
  function evaluateAnimatedNumber(value, time) {
    assertTick(time, "动画时间");
    if (typeof value === "number") return value;
    const keys = value.keyframes;
    if (!keys.length) throw new Error("动画缺少关键帧");
    if (time <= keys[0].time) return keys[0].value;
    if (time >= keys.at(-1).time) return keys.at(-1).value;
    const index = preceding(keys, time), left = keys[index], right = keys[index + 1];
    if (time === left.time || left.value === right.value) return left.value;
    const amount = progress(left.easing ?? "linear", (time - left.time) / (right.time - left.time));
    return left.value * (1 - amount) + right.value * amount;
  }

  // src/editor/export-settings.ts
  var VIDEO_ENCODERS = {
    h264: "libx264",
    hevc: "libx265",
    vp9: "libvpx-vp9",
    prores: "prores_ks"
  };
  var AUDIO_ENCODERS = { aac: "aac", opus: "libopus", pcm: "pcm_s16le" };
  var PROFILE_KEYS = [
    "id",
    "name",
    "width",
    "height",
    "frameRate",
    "container",
    "videoCodec",
    "audioCodec",
    "quality",
    "audioBitrate",
    "sampleRate",
    "includeCaptions"
  ];
  function object3(value, keys, label2) {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some((key) => !keys.includes(key)))
      throw new Error(`${label2}格式无效或包含未知字段`);
    return value;
  }
  function integer(value, min, max, label2) {
    if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
      throw new Error(`${label2}必须是 ${min}–${max} 范围内的整数`);
    return Number(value);
  }
  function label(value, max, name) {
    if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value))
      throw new Error(`${name}无效`);
    return value;
  }
  function rate(value) {
    const data = object3(value, ["numerator", "denominator"], "导出帧率");
    return validateFrameRate(data);
  }
  function validateExportProfile(value) {
    const data = object3(value, PROFILE_KEYS, "导出配置");
    const id2 = label(data.id, 128, "导出配置 ID");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id2)) throw new Error("导出配置 ID 无效");
    const name = label(data.name, 200, "导出配置名称");
    const width = integer(data.width, 16, 8192, "导出宽度");
    const height = integer(data.height, 16, 8192, "导出高度");
    if (width % 2 || height % 2) throw new Error("导出画面宽高必须是偶数");
    const frameRate = rate(data.frameRate);
    if (!["mp4", "mov", "webm"].includes(data.container)) throw new Error("不支持此导出容器");
    if (!Object.hasOwn(VIDEO_ENCODERS, data.videoCodec)) throw new Error("不支持此视频编码");
    if (!Object.hasOwn(AUDIO_ENCODERS, data.audioCodec)) throw new Error("不支持此音频编码");
    const container = data.container;
    const videoCodec = data.videoCodec;
    const audioCodec = data.audioCodec;
    const compatible = container === "webm" ? videoCodec === "vp9" && audioCodec === "opus" : container === "mp4" ? ["h264", "hevc"].includes(videoCodec) && audioCodec === "aac" : ["h264", "hevc"].includes(videoCodec) && audioCodec === "aac" || videoCodec === "prores" && audioCodec === "pcm";
    if (!compatible) throw new Error("所选容器与音视频编码不兼容");
    const rawQuality = object3(data.quality, ["mode", "value", "bitsPerSecond"], "导出质量");
    let quality;
    if (rawQuality.mode === "quality") {
      if (Object.hasOwn(rawQuality, "bitsPerSecond")) throw new Error("质量模式不能同时指定码率");
      quality = { mode: "quality", value: integer(rawQuality.value, 0, 100, "导出质量") };
    } else if (rawQuality.mode === "bitrate") {
      if (Object.hasOwn(rawQuality, "value")) throw new Error("码率模式不能同时指定质量");
      if (videoCodec === "prores")
        throw new Error("ProRes 请使用质量模式，编码器不支持此目标码率控制");
      quality = {
        mode: "bitrate",
        bitsPerSecond: integer(rawQuality.bitsPerSecond, 1e5, 5e8, "视频目标码率")
      };
    } else throw new Error("导出质量模式无效");
    const audioBitrate = audioCodec === "pcm" ? integer(data.audioBitrate, 1536e3, 1536e3, "PCM 音频码率") : integer(data.audioBitrate, 32e3, audioCodec === "opus" ? 51e4 : 512e3, "音频目标码率");
    if (data.sampleRate !== 48e3) throw new Error("导出音频采样率必须为 48000 Hz");
    if (typeof data.includeCaptions !== "boolean") throw new Error("请明确是否导出字幕");
    return {
      id: id2,
      name,
      width,
      height,
      frameRate,
      container,
      videoCodec,
      audioCodec,
      quality,
      audioBitrate,
      sampleRate: 48e3,
      includeCaptions: data.includeCaptions
    };
  }

  // src/editor/validation.ts
  var MAX_EDITOR_TICK = 24 * 60 * 60 * TICKS_PER_SECOND;
  var MAX_DOCUMENT_NODES = 1e6;
  var MAX_DOCUMENT_CHARACTERS = 16 * 1024 * 1024;
  var controls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
  function copyData(value) {
    let nodes = 0, characters = 0;
    const ancestors = /* @__PURE__ */ new Set();
    function visit(item, depth) {
      if (++nodes > MAX_DOCUMENT_NODES || depth > 64) throw new Error("工程结构超过容量限制");
      if (item === null || typeof item === "boolean") return item;
      if (typeof item === "number") {
        if (!Number.isFinite(item)) throw new Error("工程不能包含非有限数字");
        return item;
      }
      if (typeof item === "string") {
        characters += item.length;
        if (characters > MAX_DOCUMENT_CHARACTERS) throw new Error("工程文字超过容量限制");
        return item;
      }
      if (!item || typeof item !== "object") throw new Error("工程必须只包含 JSON 数据");
      if (ancestors.has(item)) throw new Error("工程 JSON 数据不能循环引用");
      const array = Array.isArray(item);
      const prototype = Object.getPrototypeOf(item);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
        throw new Error("工程数据必须是普通对象或数组");
      ancestors.add(item);
      try {
        const result = array ? [] : {};
        const keys = Reflect.ownKeys(item);
        if (array && keys.length !== item.length + 1)
          throw new Error("工程数组不能有空洞或额外属性");
        for (const key of keys) {
          if (array && key === "length") continue;
          if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key))
            throw new Error("工程包含不安全的数据键");
          characters += key.length;
          if (characters > MAX_DOCUMENT_CHARACTERS) throw new Error("工程文字超过容量限制");
          if (array && !/^(0|[1-9]\d*)$/.test(key)) throw new Error("工程数组包含额外属性");
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          if (!descriptor.enumerable || !("value" in descriptor))
            throw new Error("工程不接受隐藏属性或访问器");
          result[key] = visit(descriptor.value, depth + 1);
        }
        return result;
      } finally {
        ancestors.delete(item);
      }
    }
    return visit(value, 0);
  }
  function object4(value, allowed, label2) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${label2}必须是对象`);
    const data = value;
    for (const key of Object.keys(data))
      if (!allowed.includes(key)) throw new Error(`${label2}包含未知字段：${key}`);
    return data;
  }
  function list(value, limit, label2, minimum = 0) {
    if (!Array.isArray(value) || value.length < minimum || value.length > limit)
      throw new Error(`${label2}需要 ${minimum} 至 ${limit} 项`);
    return value;
  }
  function number(value, min, max, label2) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
      throw new Error(`${label2}必须在 ${min} 至 ${max} 之间`);
    return value;
  }
  function integer2(value, min, max, label2) {
    const result = number(value, min, max, label2);
    if (!Number.isSafeInteger(result)) throw new Error(`${label2}必须是安全整数`);
    return result;
  }
  function tick(value, label2, positive = false) {
    return integer2(value, positive ? 1 : 0, MAX_EDITOR_TICK, label2);
  }
  function text(value, max, label2, empty = false, multiline = false) {
    if (typeof value !== "string" || value.length > max || !empty && !value.trim() || controls.test(value) || !multiline && /[\n\r\t]/.test(value))
      throw new Error(`${label2}文字无效或超过 ${max} 字符`);
    return value;
  }
  function id(value, label2) {
    const result = text(value, 128, label2);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(result)) throw new Error(`${label2}无效`);
    return result;
  }
  function bool(value, label2) {
    if (typeof value !== "boolean") throw new Error(`${label2}必须是布尔值`);
    return value;
  }
  function choice(value, allowed, label2) {
    if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label2}无效`);
    return value;
  }
  function color(value, label2) {
    if (typeof value !== "string" || !(value === "transparent" || /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)))
      throw new Error(`${label2}须为十六进制颜色或 transparent`);
    return value;
  }
  function unique(items, label2) {
    const result = /* @__PURE__ */ new Map();
    for (const item of items) {
      if (result.has(item.id)) throw new Error(`${label2} ID 重复：${item.id}`);
      result.set(item.id, item);
    }
    return result;
  }
  function dataObject(value, label2) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${label2}必须是对象`);
    return value;
  }
  function animated(value, duration, min, max, label2) {
    if (typeof value === "number") return number(value, min, max, label2);
    const data = object4(value, ["keyframes"], label2);
    for (const raw of list(data.keyframes, 1e4, `${label2}关键帧`, 1)) {
      const frame = object4(raw, ["time", "value", "easing"], "关键帧");
      number(frame.value, min, max, label2);
      if (typeof frame.easing === "object")
        object4(frame.easing, ["type", "x1", "y1", "x2", "y2"], "缓动曲线");
    }
    return validateAnimatedNumber(data, duration);
  }
  function timeMap(value, duration, sourceDuration) {
    const data = object4(value, ["points"], "时间映射");
    for (const point of list(data.points, 1e4, "时间映射节点", 2))
      object4(point, ["time", "source"], "时间映射节点");
    return validateTimeMap(data, duration, sourceDuration);
  }
  function assertNoEmptyHold(map, sourceDuration, label2) {
    if (map.points.some(
      (point, index) => index > 0 && point.source === sourceDuration && map.points[index - 1].source === sourceDuration
    ))
      throw new Error(`${label2}不能在素材结束边界定格`);
  }
  function transform(value, duration) {
    const data = object4(
      value,
      ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "flipX", "flipY", "fit", "crop"],
      "构图"
    );
    const crop = object4(data.crop, ["left", "top", "right", "bottom"], "裁切");
    const bounds = {
      left: number(crop.left, 0, 1, "左裁切"),
      top: number(crop.top, 0, 1, "上裁切"),
      right: number(crop.right, 0, 1, "右裁切"),
      bottom: number(crop.bottom, 0, 1, "下裁切")
    };
    if (bounds.left + bounds.right >= 1 || bounds.top + bounds.bottom >= 1)
      throw new Error("裁切后必须保留有效画面");
    return {
      x: animated(data.x, duration, -10, 10, "水平位置"),
      y: animated(data.y, duration, -10, 10, "垂直位置"),
      scaleX: animated(data.scaleX, duration, 0, 100, "水平缩放"),
      scaleY: animated(data.scaleY, duration, 0, 100, "垂直缩放"),
      rotation: animated(data.rotation, duration, -36e4, 36e4, "旋转"),
      opacity: animated(data.opacity, duration, 0, 1, "不透明度"),
      flipX: bool(data.flipX, "水平翻转"),
      flipY: bool(data.flipY, "垂直翻转"),
      fit: choice(data.fit, ["contain", "cover", "stretch"], "画面适配"),
      crop: bounds
    };
  }
  function adjustment(value, duration) {
    const data = object4(
      value,
      [
        "exposure",
        "brightness",
        "contrast",
        "saturation",
        "temperature",
        "tint",
        "hue",
        "curves",
        "hsl"
      ],
      "调色"
    );
    const channels = /* @__PURE__ */ new Set();
    const curves = list(data.curves, 4, "调色曲线").map((raw) => {
      const curve = object4(raw, ["channel", "points"], "调色曲线");
      const channel = choice(curve.channel, ["rgb", "red", "green", "blue"], "曲线通道");
      if (channels.has(channel)) throw new Error("调色曲线通道重复");
      channels.add(channel);
      let last = -1;
      const points = list(curve.points, 256, "曲线节点", 2).map((entry) => {
        const point = object4(entry, ["x", "y"], "曲线节点");
        const x = number(point.x, 0, 1, "曲线输入"), y = number(point.y, 0, 1, "曲线输出");
        if (x <= last) throw new Error("调色曲线输入必须严格递增");
        last = x;
        return { x, y };
      });
      if (points[0].x !== 0 || points.at(-1).x !== 1) throw new Error("调色曲线必须覆盖 0 至 1");
      return { channel, points };
    });
    const hsl = list(data.hsl, 24, "HSL 调整").map((raw) => {
      const band = object4(raw, ["hue", "width", "hueShift", "saturation", "lightness"], "HSL 调整");
      return {
        hue: number(band.hue, 0, 360, "HSL 色相"),
        width: number(band.width, 1e-3, 360, "HSL 范围"),
        hueShift: number(band.hueShift, -180, 180, "HSL 色相偏移"),
        saturation: number(band.saturation, -1, 1, "HSL 饱和度"),
        lightness: number(band.lightness, -1, 1, "HSL 明度")
      };
    });
    return {
      exposure: animated(data.exposure, duration, -10, 10, "曝光"),
      brightness: animated(data.brightness, duration, -1, 1, "亮度"),
      contrast: animated(data.contrast, duration, 0, 4, "对比度"),
      saturation: animated(data.saturation, duration, 0, 4, "饱和度"),
      temperature: animated(data.temperature, duration, -1, 1, "色温"),
      tint: animated(data.tint, duration, -1, 1, "色调"),
      hue: animated(data.hue, duration, -360, 360, "色相"),
      curves,
      hsl
    };
  }
  function mask(value) {
    const data = object4(
      value,
      ["kind", "x", "y", "width", "height", "rotation", "feather", "inverted", "points"],
      "蒙版"
    );
    const kind = choice(data.kind, ["rectangle", "ellipse", "linear", "path"], "蒙版类型");
    let points;
    if (kind === "path") {
      points = list(data.points, 256, "蒙版顶点", 3).map((raw) => {
        const point = object4(raw, ["x", "y"], "蒙版顶点");
        return { x: number(point.x, 0, 1, "蒙版顶点 x"), y: number(point.y, 0, 1, "蒙版顶点 y") };
      });
      if (new Set(points.map((point) => `${point.x}:${point.y}`)).size < 3)
        throw new Error("路径蒙版至少需要三个不同顶点");
    } else if (data.points !== void 0) throw new Error("只有路径蒙版可以保存顶点");
    return {
      kind,
      x: number(data.x, -2, 2, "蒙版 x"),
      y: number(data.y, -2, 2, "蒙版 y"),
      width: number(data.width, 1e-3, 4, "蒙版宽度"),
      height: number(data.height, 1e-3, 4, "蒙版高度"),
      rotation: number(data.rotation, -36e4, 36e4, "蒙版旋转"),
      feather: number(data.feather, 0, 1, "蒙版羽化"),
      inverted: bool(data.inverted, "蒙版反转"),
      ...points ? { points } : {}
    };
  }
  function visual(data, duration) {
    return {
      transform: transform(data.transform, duration),
      color: adjustment(data.color, duration),
      blendMode: choice(
        data.blendMode,
        ["normal", "multiply", "screen", "overlay", "darken", "lighten"],
        "混合模式"
      ),
      ...data.mask === void 0 ? {} : { mask: mask(data.mask) }
    };
  }
  function audio(value, duration) {
    const data = object4(
      value,
      ["volume", "pan", "fadeIn", "fadeOut", "pitchSemitones", "preservePitch", "ducking"],
      "音频混音"
    );
    let ducking;
    if (data.ducking !== void 0) {
      const sidechain = object4(
        data.ducking,
        ["sidechainTrackIds", "thresholdDb", "attenuationDb", "attack", "release"],
        "自动压低背景声"
      );
      const sidechainTrackIds = list(sidechain.sidechainTrackIds, 64, "参考音轨", 1).map(
        (value2) => id(value2, "参考音轨 ID")
      );
      if (new Set(sidechainTrackIds).size !== sidechainTrackIds.length)
        throw new Error("参考音轨重复");
      ducking = {
        sidechainTrackIds,
        thresholdDb: number(sidechain.thresholdDb, -96, 0, "压低触发电平"),
        attenuationDb: number(sidechain.attenuationDb, 0, 60, "压低分贝"),
        attack: integer2(sidechain.attack, 0, TICKS_PER_SECOND * 10, "压低启动时间"),
        release: integer2(sidechain.release, 0, TICKS_PER_SECOND * 30, "压低恢复时间")
      };
    }
    return {
      volume: animated(data.volume, duration, 0, 4, "音量"),
      pan: animated(data.pan, duration, -1, 1, "声像"),
      fadeIn: integer2(data.fadeIn, 0, duration, "声音淡入"),
      fadeOut: integer2(data.fadeOut, 0, duration, "声音淡出"),
      pitchSemitones: number(data.pitchSemitones, -24, 24, "音高"),
      preservePitch: bool(data.preservePitch, "保持音高"),
      ...ducking ? { ducking } : {}
    };
  }
  function textStyle(value) {
    const data = object4(
      value,
      [
        "layout",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "italic",
        "color",
        "strokeColor",
        "strokeWidth",
        "background",
        "backgroundRadius",
        "padding",
        "align",
        "lineHeight",
        "letterSpacing",
        "maxWidth",
        "highlightColor",
        "keywords",
        "shadow",
        "animation"
      ],
      "文字样式"
    );
    const shadow = object4(data.shadow, ["color", "blur", "x", "y"], "文字阴影");
    return {
      layout: choice(data.layout, ["box", "caption-stack"], "文字布局"),
      fontFamily: text(data.fontFamily, 200, "字体"),
      fontSize: number(data.fontSize, 1, 2048, "字号"),
      fontWeight: integer2(data.fontWeight, 1, 1e3, "字重"),
      italic: bool(data.italic, "斜体"),
      color: color(data.color, "文字颜色"),
      strokeColor: color(data.strokeColor, "文字描边颜色"),
      strokeWidth: number(data.strokeWidth, 0, 100, "文字描边宽度"),
      background: color(data.background, "文字背景"),
      backgroundRadius: number(data.backgroundRadius, 0, 512, "文字背景圆角"),
      padding: number(data.padding, 0, 512, "文字背景内边距"),
      align: choice(data.align, ["left", "center", "right"], "文字对齐"),
      lineHeight: number(data.lineHeight, 0.5, 5, "文字行高"),
      letterSpacing: number(data.letterSpacing, -100, 100, "字间距"),
      maxWidth: number(data.maxWidth, 0.01, 1, "文字最大宽度比例"),
      highlightColor: color(data.highlightColor, "文字高亮颜色"),
      ...data.keywords === void 0 ? {} : {
        keywords: list(data.keywords, 32, "关键词强调").map((value2) => {
          const keyword = object4(value2, ["text", "color"], "关键词强调");
          return {
            text: text(keyword.text, 200, "关键词"),
            color: color(keyword.color, "关键词颜色")
          };
        })
      },
      shadow: {
        color: color(shadow.color, "文字阴影颜色"),
        blur: number(shadow.blur, 0, 256, "文字阴影模糊"),
        x: number(shadow.x, -2048, 2048, "文字阴影水平偏移"),
        y: number(shadow.y, -2048, 2048, "文字阴影垂直偏移")
      },
      animation: choice(data.animation, ["none", "fade", "typewriter", "word-highlight"], "文字动画")
    };
  }
  function asset(value) {
    const data = object4(
      value,
      ["id", "name", "kind", "duration", "width", "height", "resourceId", "fingerprint", "metadata"],
      "素材"
    );
    const kind = choice(data.kind, ["video", "audio", "image", "demo"], "素材类型");
    let resourceId;
    if (data.resourceId !== void 0) {
      resourceId = text(data.resourceId, 256, "素材资源 ID");
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(resourceId))
        throw new Error("素材资源 ID 无效");
    }
    if (data.fingerprint !== void 0 && (typeof data.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.fingerprint)))
      throw new Error("素材指纹须为 SHA-256");
    return {
      id: id(data.id, "素材 ID"),
      name: text(data.name, 256, "素材名称"),
      kind,
      duration: tick(data.duration, "素材时长", kind !== "image"),
      ...data.width === void 0 ? {} : { width: integer2(data.width, 1, 32768, "素材宽度") },
      ...data.height === void 0 ? {} : { height: integer2(data.height, 1, 32768, "素材高度") },
      ...resourceId === void 0 ? {} : { resourceId },
      ...data.fingerprint === void 0 ? {} : { fingerprint: data.fingerprint },
      ...data.metadata === void 0 ? {} : { metadata: dataObject(data.metadata, "素材元数据") }
    };
  }
  function track(value) {
    const data = object4(
      value,
      ["id", "name", "kind", "locked", "hidden", "muted", "volume", "pan"],
      "轨道"
    );
    return {
      id: id(data.id, "轨道 ID"),
      name: text(data.name, 200, "轨道名称"),
      kind: choice(data.kind, ["video", "audio", "text"], "轨道类型"),
      locked: bool(data.locked, "锁定轨道"),
      hidden: bool(data.hidden, "隐藏轨道"),
      muted: bool(data.muted, "静音轨道"),
      volume: number(data.volume, 0, 4, "轨道音量"),
      pan: number(data.pan, -1, 1, "轨道声像")
    };
  }
  var clipKeys = [
    "id",
    "kind",
    "trackId",
    "start",
    "duration",
    "label",
    "groupId",
    "linkGroupId",
    "transform",
    "color",
    "blendMode",
    "mask"
  ];
  function clip(value, assets) {
    const raw = object4(
      value,
      [
        ...clipKeys,
        "assetId",
        "timeMap",
        "audio",
        "role",
        "text",
        "style",
        "words",
        "sourceBinding",
        "translation",
        "shape",
        "fill",
        "stroke",
        "strokeWidth",
        "sequenceId",
        "angles",
        "switches",
        "audioAngleId"
      ],
      "片段"
    );
    const kind = choice(raw.kind, ["media", "text", "shape", "sequence", "multicam"], "片段类型");
    const keys = {
      media: ["assetId", "timeMap", "audio"],
      text: ["role", "text", "style", "words", "sourceBinding", "translation"],
      shape: ["shape", "fill", "stroke", "strokeWidth"],
      sequence: ["sequenceId", "timeMap", "audio"],
      multicam: ["timeMap", "angles", "switches", "audioAngleId", "audio"]
    };
    const data = object4(raw, [...clipKeys, ...keys[kind]], "片段");
    const start = tick(data.start, "片段起点"), duration = tick(data.duration, "片段时长", true);
    if (start + duration > MAX_EDITOR_TICK) throw new Error("片段末端超过 24 小时");
    const base = {
      id: id(data.id, "片段 ID"),
      trackId: id(data.trackId, "片段轨道 ID"),
      start,
      duration,
      label: text(data.label, 256, "片段名称", true),
      ...data.groupId === void 0 ? {} : { groupId: id(data.groupId, "分组 ID") },
      ...data.linkGroupId === void 0 ? {} : { linkGroupId: id(data.linkGroupId, "关联组 ID") },
      ...visual(data, duration)
    };
    if (kind === "media") {
      const assetId = id(data.assetId, "片段素材 ID"), source = assets.get(assetId);
      if (!source) throw new Error(`片段引用不存在的素材：${assetId}`);
      const mapping = timeMap(data.timeMap, duration, source.duration);
      if (source.kind !== "image") assertNoEmptyHold(mapping, source.duration, "媒体片段");
      return { ...base, kind, assetId, timeMap: mapping, audio: audio(data.audio, duration) };
    }
    if (kind === "sequence")
      return {
        ...base,
        kind,
        sequenceId: id(data.sequenceId, "嵌套序列 ID"),
        timeMap: timeMap(data.timeMap, duration, MAX_EDITOR_TICK),
        audio: audio(data.audio, duration)
      };
    if (kind === "shape")
      return {
        ...base,
        kind,
        shape: choice(data.shape, ["rectangle", "ellipse", "line"], "图形类型"),
        fill: color(data.fill, "图形填充"),
        stroke: color(data.stroke, "图形描边"),
        strokeWidth: number(data.strokeWidth, 0, 1024, "图形描边宽度")
      };
    if (kind === "multicam") {
      const angles = list(data.angles, 32, "多机位", 2).map((raw2) => {
        const angle = object4(raw2, ["id", "name", "assetId", "offset"], "机位");
        const assetId = id(angle.assetId, "机位素材 ID");
        if (assets.get(assetId)?.kind !== "video") throw new Error("多机位须引用有效的视频素材");
        return {
          id: id(angle.id, "机位 ID"),
          name: text(angle.name, 200, "机位名称"),
          assetId,
          offset: integer2(angle.offset, -MAX_EDITOR_TICK, MAX_EDITOR_TICK, "机位同步偏移")
        };
      });
      const anglesById = unique(angles, "机位");
      let previous = -1;
      const switches = list(data.switches, 1e4, "机位切换", 1).map((raw2) => {
        const change = object4(raw2, ["time", "angleId"], "机位切换");
        const time = integer2(change.time, 0, duration - 1, "机位切换时间");
        if (time <= previous) throw new Error("机位切换时间必须严格递增");
        previous = time;
        const angleId = id(change.angleId, "切换机位 ID");
        if (!anglesById.has(angleId)) throw new Error("切换引用不存在的机位");
        return { time, angleId };
      });
      if (switches[0].time !== 0) throw new Error("多机位须从零时刻指定画面");
      const audioAngleId = id(data.audioAngleId, "主声音机位 ID");
      if (!anglesById.has(audioAngleId)) throw new Error("主声音引用不存在的机位");
      return {
        ...base,
        kind,
        timeMap: timeMap(data.timeMap, duration, MAX_EDITOR_TICK),
        angles,
        switches,
        audioAngleId,
        audio: audio(data.audio, duration)
      };
    }
    let previousStart = -1, previousEnd = -1;
    const words = list(data.words, 1e4, "逐字字幕").map((raw2) => {
      const word = object4(raw2, ["text", "start", "end"], "字幕词");
      const start2 = integer2(word.start, 0, duration - 1, "字幕词入点");
      const end = integer2(word.end, start2 + 1, duration, "字幕词出点");
      if (start2 < previousStart || end < previousEnd) throw new Error("字幕词时间必须按顺序排列");
      previousStart = start2;
      previousEnd = end;
      return { text: text(word.text, 1e3, "字幕词"), start: start2, end };
    });
    let sourceBinding;
    if (data.sourceBinding !== void 0) {
      const binding = object4(
        data.sourceBinding,
        ["clipId", "sourceStart", "sourceEnd", "provenance"],
        "字幕来源"
      );
      const sourceStart = tick(binding.sourceStart, "字幕源入点"), sourceEnd = tick(binding.sourceEnd, "字幕源出点");
      if (sourceEnd <= sourceStart) throw new Error("字幕来源须有有效时长");
      sourceBinding = { clipId: id(binding.clipId, "字幕来源片段 ID"), sourceStart, sourceEnd };
      if (binding.provenance !== void 0) {
        const raw2 = object4(binding.provenance, ["path", "assetId", "start", "end"], "字幕实际音源");
        const start2 = tick(raw2.start, "转写素材入点"), end = tick(raw2.end, "转写素材出点");
        if (end <= start2) throw new Error("字幕实际音源须有正时长");
        sourceBinding.provenance = {
          path: list(raw2.path, 50, "嵌套音源路径").map((value2) => id(value2, "嵌套来源片段 ID")),
          assetId: id(raw2.assetId, "转写素材 ID"),
          start: start2,
          end
        };
      }
    }
    let translation;
    if (data.translation !== void 0) {
      const translated = object4(
        data.translation,
        ["original", "language", "mode", "originalWords"],
        "字幕翻译"
      );
      translation = {
        original: text(translated.original, 1e4, "字幕原文", false, true),
        language: text(translated.language, 80, "字幕语言"),
        mode: choice(translated.mode, ["bilingual", "translated"], "字幕翻译模式")
      };
      if (translated.originalWords !== void 0) {
        let previousStart2 = -1, previousEnd2 = -1;
        translation.originalWords = list(translated.originalWords, 1e4, "字幕原文词时间").map(
          (raw2) => {
            const word = object4(raw2, ["text", "start", "end"], "原文词");
            const start2 = integer2(word.start, 0, duration - 1, "原文词入点"), end = integer2(word.end, start2 + 1, duration, "原文词出点");
            if (start2 < previousStart2 || end < previousEnd2)
              throw new Error("原文词时间必须按顺序排列");
            previousStart2 = start2;
            previousEnd2 = end;
            return { text: text(word.text, 1e3, "原文词"), start: start2, end };
          }
        );
      }
    }
    return {
      ...base,
      kind: "text",
      role: choice(data.role, ["title", "subtitle"], "文字用途"),
      text: text(data.text, 1e4, "文字内容", true, true),
      style: textStyle(data.style),
      words,
      ...sourceBinding ? { sourceBinding } : {},
      ...translation ? { translation } : {}
    };
  }
  function sequenceDuration(sequence2) {
    let duration = 0;
    for (const clip2 of sequence2.clips) {
      const end = tick(clip2.start, "片段起点") + tick(clip2.duration, "片段时长", true);
      if (end > MAX_EDITOR_TICK) throw new Error("序列超过 24 小时");
      duration = Math.max(duration, end);
    }
    return duration;
  }
  function sequence(value, assets) {
    const data = object4(
      value,
      [
        "id",
        "name",
        "width",
        "height",
        "frameRate",
        "background",
        "timelineMode",
        "magneticTrackId",
        "tracks",
        "clips",
        "transitions",
        "markers"
      ],
      "序列"
    );
    object4(data.frameRate, ["numerator", "denominator"], "序列帧率");
    const tracks = list(data.tracks, 128, "轨道").map(track);
    unique(tracks, "轨道");
    const magneticTrackId = data.magneticTrackId === void 0 ? void 0 : id(data.magneticTrackId, "磁吸主轨 ID");
    if (magneticTrackId !== void 0 && !tracks.some((track2) => track2.id === magneticTrackId && track2.kind === "video"))
      throw new Error("磁吸主轨必须引用现有画面轨");
    const clips = list(data.clips, 2e3, "片段").map((value2) => clip(value2, assets));
    unique(clips, "片段");
    const transitions = list(data.transitions, 2e3, "转场").map((raw) => {
      const transition = object4(
        raw,
        ["id", "fromClipId", "toClipId", "start", "duration", "kind"],
        "转场"
      );
      const start = tick(transition.start, "转场起点"), duration = tick(transition.duration, "转场时长", true);
      if (start + duration > MAX_EDITOR_TICK) throw new Error("转场超过 24 小时");
      return {
        id: id(transition.id, "转场 ID"),
        fromClipId: id(transition.fromClipId, "转场起始片段"),
        toClipId: id(transition.toClipId, "转场结束片段"),
        start,
        duration,
        kind: choice(
          transition.kind,
          ["dissolve", "fade-black", "wipe-left", "wipe-right", "push-left", "push-right"],
          "转场类型"
        )
      };
    });
    unique(transitions, "转场");
    const markers = list(data.markers, 1e4, "时间轴标记").map((raw) => {
      const marker = object4(raw, ["id", "time", "duration", "name", "note", "color"], "时间轴标记");
      const time = tick(marker.time, "标记时间"), duration = tick(marker.duration, "标记范围");
      if (time + duration > MAX_EDITOR_TICK) throw new Error("标记范围超过 24 小时");
      return {
        id: id(marker.id, "标记 ID"),
        time,
        duration,
        name: text(marker.name, 200, "标记名称"),
        note: text(marker.note, 1e4, "标记备注", true, true),
        color: color(marker.color, "标记颜色")
      };
    });
    unique(markers, "标记");
    return {
      id: id(data.id, "序列 ID"),
      name: text(data.name, 200, "序列名称"),
      width: integer2(data.width, 16, 8192, "序列宽度"),
      height: integer2(data.height, 16, 8192, "序列高度"),
      frameRate: validateFrameRate(data.frameRate),
      background: color(data.background, "序列背景"),
      timelineMode: choice(data.timelineMode, ["magnetic", "free"], "排列方式"),
      ...magneticTrackId === void 0 ? {} : { magneticTrackId },
      tracks,
      clips,
      transitions,
      markers
    };
  }
  function compatibleTrack(clip2, track2, assets) {
    if (clip2.kind === "text") return track2.kind === "text";
    if (clip2.kind === "shape" || clip2.kind === "multicam") return track2.kind === "video";
    if (clip2.kind === "sequence") return track2.kind !== "text";
    const source = assets.get(clip2.assetId);
    return source.kind === "audio" ? track2.kind === "audio" : source.kind === "video" ? track2.kind !== "text" : track2.kind === "video";
  }
  function multicamBounds(clip2, assets) {
    const angles = new Map(clip2.angles.map((angle) => [angle.id, angle]));
    function range(angleId, start, end) {
      const angle = angles.get(angleId), source = assets.get(angle.assetId);
      const coordinates = [
        sourceTimeAt(clip2.timeMap, start),
        ...clip2.timeMap.points.filter((point) => point.time > start && point.time < end).map((point) => point.source),
        sourceTimeAt(clip2.timeMap, end)
      ];
      if (coordinates.some(
        (position) => position + angle.offset < 0 || position + angle.offset > source.duration
      ))
        throw new Error(`机位 ${angle.name} 的画面或声音范围超出素材`);
      if (coordinates.some(
        (position, index) => index > 0 && position + angle.offset === source.duration && coordinates[index - 1] + angle.offset === source.duration
      ))
        throw new Error(`机位 ${angle.name} 不能在素材结束边界定格`);
    }
    for (const [index, change] of clip2.switches.entries())
      range(change.angleId, change.time, clip2.switches[index + 1]?.time ?? clip2.duration);
    const volume = clip2.audio.volume;
    if (typeof volume === "number" ? volume > 0 : volume.keyframes.some((frame) => frame.value > 0))
      range(clip2.audioAngleId, 0, clip2.duration);
  }
  function checkSequenceReferences(sequence2, assets, sequences) {
    const tracks = new Map(sequence2.tracks.map((track2) => [track2.id, track2]));
    const clips = new Map(sequence2.clips.map((clip2) => [clip2.id, clip2]));
    for (const clip2 of sequence2.clips) {
      const track2 = tracks.get(clip2.trackId);
      if (!track2) throw new Error(`片段引用不存在的轨道：${clip2.trackId}`);
      if (!compatibleTrack(clip2, track2, assets)) throw new Error(`片段 ${clip2.id} 与轨道类型不兼容`);
      if (clip2.kind === "sequence") {
        const source = sequences.get(clip2.sequenceId);
        if (!source) throw new Error(`嵌套引用不存在的序列：${clip2.sequenceId}`);
        const sourceDuration = sequenceDuration(source);
        if (!sourceDuration) throw new Error("嵌套片段不能引用空序列");
        validateTimeMap(clip2.timeMap, clip2.duration, sourceDuration);
        assertNoEmptyHold(clip2.timeMap, sourceDuration, "嵌套片段");
      }
      if (clip2.kind === "multicam") multicamBounds(clip2, assets);
      if ("audio" in clip2 && clip2.audio.ducking)
        for (const trackId of clip2.audio.ducking.sidechainTrackIds) {
          const source = tracks.get(trackId);
          if (!source || source.kind === "text" || source.id === clip2.trackId)
            throw new Error("压低背景声须引用其他有效声音轨道");
        }
      if (clip2.kind === "text" && clip2.sourceBinding) {
        const binding = clip2.sourceBinding, source = clips.get(binding.clipId);
        if (!source || !("timeMap" in source)) throw new Error("字幕来源须引用有效的媒体或序列片段");
        const sourceSequence = source.kind === "sequence" ? sequences.get(source.sequenceId) : void 0;
        if (source.kind === "sequence" && !sourceSequence)
          throw new Error("字幕来源引用不存在的嵌套序列");
        const sourceDuration = source.kind === "media" ? assets.get(source.assetId).duration : source.kind === "sequence" ? sequenceDuration(sourceSequence) : MAX_EDITOR_TICK;
        if (binding.sourceEnd > sourceDuration) throw new Error("字幕来源范围超出素材");
        if (binding.provenance) {
          let leaf = source;
          for (const clipId of binding.provenance.path) {
            if (leaf.kind !== "sequence") throw new Error("字幕嵌套音源路径须经过序列片段");
            const child = sequences.get(leaf.sequenceId)?.clips.find((item) => item.id === clipId);
            if (!child || !("timeMap" in child)) throw new Error("字幕嵌套音源不存在");
            leaf = child;
          }
          const assetId = leaf.kind === "media" ? leaf.assetId : leaf.kind === "multicam" ? leaf.angles.find((angle) => angle.id === leaf.audioAngleId)?.assetId : void 0;
          const asset2 = assets.get(binding.provenance.assetId);
          if (assetId !== binding.provenance.assetId || !asset2 || !["audio", "video"].includes(asset2.kind) || binding.provenance.end > asset2.duration)
            throw new Error("字幕实际音源或转写范围与来源片段不一致");
        }
      }
    }
    const pairs = /* @__PURE__ */ new Set();
    for (const transition of sequence2.transitions) {
      const from = clips.get(transition.fromClipId), to = clips.get(transition.toClipId);
      if (!from || !to || from.id === to.id || from.trackId !== to.trackId || tracks.get(from.trackId)?.kind !== "video")
        throw new Error("转场两端须为同一画面轨的两个有效片段");
      const end = from.start + from.duration;
      if (from.start >= to.start || end >= to.start + to.duration || to.start >= end || transition.start !== to.start || transition.duration !== end - to.start)
        throw new Error("转场时间须精确覆盖前后片段的重叠范围");
      const key = JSON.stringify([from.id, to.id]);
      if (pairs.has(key)) throw new Error("同一片段交界不能重复设置转场");
      pairs.add(key);
    }
    for (const track2 of sequence2.tracks.filter((track3) => track3.kind === "video")) {
      const placed = sequence2.clips.filter((clip2) => clip2.trackId === track2.id).sort((a, b) => a.start - b.start || a.duration - b.duration);
      let active = [];
      for (const clip2 of placed) {
        active = active.filter((previous) => previous.start + previous.duration > clip2.start);
        if (active.length > 1) throw new Error("同一画面轨不能同时重叠三个片段");
        for (const previous of active)
          if (!pairs.has(JSON.stringify([previous.id, clip2.id])))
            throw new Error("同轨画面重叠需要明确的转场");
        active.push(clip2);
      }
    }
  }
  function validateEditorDocument(value) {
    const data = object4(
      copyData(value),
      [
        "schemaVersion",
        "timebase",
        "id",
        "name",
        "revision",
        "assets",
        "sequences",
        "activeSequenceId",
        "exportProfiles",
        "production"
      ],
      "工程"
    );
    if (data.schemaVersion !== 2 || data.timebase !== TICKS_PER_SECOND)
      throw new Error("不支持此工程版本或时间基准");
    const assets = list(data.assets, 1e3, "素材").map(asset), assetsById = unique(assets, "素材");
    const sequences = list(data.sequences, 50, "序列", 1).map((value2) => sequence(value2, assetsById));
    const sequencesById = unique(sequences, "序列");
    const activeSequenceId = id(data.activeSequenceId, "活动序列 ID");
    if (!sequencesById.has(activeSequenceId)) throw new Error("活动序列不存在");
    for (const sequence2 of sequences) checkSequenceReferences(sequence2, assetsById, sequencesById);
    const visiting = /* @__PURE__ */ new Set(), visited = /* @__PURE__ */ new Set();
    function acyclic(id2) {
      if (visiting.has(id2)) throw new Error("嵌套序列不能循环引用");
      if (visited.has(id2)) return;
      visiting.add(id2);
      for (const clip2 of sequencesById.get(id2).clips)
        if (clip2.kind === "sequence") acyclic(clip2.sequenceId);
      visiting.delete(id2);
      visited.add(id2);
    }
    for (const sequence2 of sequences) acyclic(sequence2.id);
    const exportProfiles = list(data.exportProfiles, 64, "导出配置").map(validateExportProfile);
    unique(exportProfiles, "导出配置");
    return {
      schemaVersion: 2,
      timebase: TICKS_PER_SECOND,
      id: id(data.id, "工程 ID"),
      name: text(data.name, 200, "工程名称"),
      revision: integer2(data.revision, 0, Number.MAX_SAFE_INTEGER - 1, "修订号"),
      assets,
      sequences,
      activeSequenceId,
      exportProfiles,
      ...data.production === void 0 ? {} : { production: dataObject(data.production, "制作记录") }
    };
  }

  // src/editor/evaluate.ts
  var neutralAudio = () => ({
    gain: 1,
    pan: 0,
    pitchSemitones: 0,
    preservePitch: true,
    playbackRate: 1,
    fadeGain: 1,
    ducking: [],
    trackInstancePath: []
  });
  var clamp3 = (value, min, max) => Math.max(min, Math.min(max, value));
  var pathPart = (kind, id2) => `${kind}:${encodeURIComponent(id2)}`;
  var inside = (clip2, time) => time >= clip2.start && time - clip2.start < clip2.duration;
  function resolveTransform(value, local) {
    const number2 = (key) => evaluateAnimatedNumber(value[key], local);
    return {
      x: clamp3(number2("x"), -10, 10),
      y: clamp3(number2("y"), -10, 10),
      scaleX: clamp3(number2("scaleX"), 0, 100),
      scaleY: clamp3(number2("scaleY"), 0, 100),
      rotation: clamp3(number2("rotation"), -36e4, 36e4),
      opacity: clamp3(number2("opacity"), 0, 1),
      flipX: value.flipX,
      flipY: value.flipY,
      fit: value.fit,
      crop: { ...value.crop }
    };
  }
  function resolveColor(value, local) {
    const number2 = (key) => evaluateAnimatedNumber(value[key], local);
    return {
      exposure: clamp3(number2("exposure"), -10, 10),
      brightness: clamp3(number2("brightness"), -1, 1),
      contrast: clamp3(number2("contrast"), 0, 4),
      saturation: clamp3(number2("saturation"), 0, 4),
      temperature: clamp3(number2("temperature"), -1, 1),
      tint: clamp3(number2("tint"), -1, 1),
      hue: clamp3(number2("hue"), -360, 360),
      curves: value.curves.map((curve) => ({
        ...curve,
        points: curve.points.map((point) => ({ ...point }))
      })),
      hsl: value.hsl.map((range) => ({ ...range }))
    };
  }
  function timeMapRate(map, time) {
    let left = 0, right = map.points.length - 1;
    while (left + 1 < right) {
      const middle = left + Math.floor((right - left) / 2);
      if (map.points[middle].time <= time) left = middle;
      else right = middle;
    }
    const a = map.points[left], b = map.points[right];
    return (b.source - a.source) / (b.time - a.time);
  }
  function audioContext(clip2, track2, local, parent, sequenceId, sequencePath) {
    const mix = clip2.audio;
    const fade = (mix.fadeIn ? clamp3(local / mix.fadeIn, 0, 1) : 1) * (mix.fadeOut ? clamp3((clip2.duration - local) / mix.fadeOut, 0, 1) : 1);
    const playbackRate = parent.playbackRate * timeMapRate(clip2.timeMap, local);
    const ducking = parent.ducking.map((item) => ({
      ...item,
      sidechainTrackIds: [...item.sidechainTrackIds],
      sidechainTrackInstanceIds: [...item.sidechainTrackInstanceIds]
    }));
    if (mix.ducking)
      ducking.push({
        ...mix.ducking,
        sidechainTrackIds: [...mix.ducking.sidechainTrackIds],
        sequenceId,
        sequenceTime: clip2.start + local,
        trackInstanceId: `${sequencePath}/${pathPart("track", track2.id)}`,
        sidechainTrackInstanceIds: mix.ducking.sidechainTrackIds.map(
          (id2) => `${sequencePath}/${pathPart("track", id2)}`
        )
      });
    return {
      gain: track2.muted || !playbackRate ? 0 : clamp3(evaluateAnimatedNumber(mix.volume, local), 0, 4) * track2.volume * fade * parent.gain,
      pan: clamp3(
        parent.pan + track2.pan + clamp3(evaluateAnimatedNumber(mix.pan, local), -1, 1),
        -1,
        1
      ),
      pitchSemitones: parent.pitchSemitones + mix.pitchSemitones,
      preservePitch: parent.preservePitch && mix.preservePitch,
      playbackRate,
      fadeGain: parent.fadeGain * fade,
      ducking,
      trackInstancePath: [
        ...parent.trackInstancePath,
        `${sequencePath}/${pathPart("track", track2.id)}`
      ]
    };
  }
  function prepareEvaluator(value) {
    const document2 = validateEditorDocument(value);
    const assets = new Map(document2.assets.map((asset2) => [asset2.id, asset2]));
    const sequences = new Map(document2.sequences.map((sequence2) => [sequence2.id, sequence2]));
    const durations = new Map(
      document2.sequences.map((sequence2) => [sequence2.id, sequenceDuration(sequence2)])
    );
    const tracks = new Map(
      document2.sequences.map((sequence2) => [
        sequence2.id,
        sequence2.tracks.map((track2) => ({
          track: track2,
          clips: sequence2.clips.filter((clip2) => clip2.trackId === track2.id).sort((a, b) => a.start - b.start)
        }))
      ])
    );
    function evaluateSequence(sequence2, tick2, sequencePath, parent, visible) {
      const frame = {
        sequenceId: sequence2.id,
        time: tick2,
        width: sequence2.width,
        height: sequence2.height,
        background: sequence2.background,
        layers: [],
        audio: []
      };
      if (tick2 >= durations.get(sequence2.id)) return frame;
      for (const { track: track2, clips } of tracks.get(sequence2.id)) {
        const visual2 = /* @__PURE__ */ new Map();
        const active = clips.filter((clip2) => inside(clip2, tick2));
        const picture = visible && !track2.hidden && track2.kind !== "audio";
        for (const clip2 of active) {
          const localTime = tick2 - clip2.start;
          const instanceId = `${sequencePath}/${pathPart("clip", clip2.id)}`;
          const base = () => ({
            instanceId,
            sequenceId: sequence2.id,
            clipId: clip2.id,
            trackId: track2.id,
            localTime,
            transform: resolveTransform(clip2.transform, localTime),
            color: resolveColor(clip2.color, localTime),
            blendMode: clip2.blendMode,
            ...clip2.mask ? { mask: structuredClone(clip2.mask) } : {}
          });
          const mediaLayer = (asset2, sourceTime, angleId) => picture && asset2.kind !== "audio" && sourceTime >= 0 && (asset2.kind === "image" || sourceTime < asset2.duration) ? {
            ...base(),
            kind: "media",
            assetId: asset2.id,
            assetKind: asset2.kind,
            sourceTime,
            naturalWidth: asset2.width ?? sequence2.width,
            naturalHeight: asset2.height ?? sequence2.height,
            ...angleId ? { angleId } : {}
          } : null;
          const addAudio = (asset2, sourceTime, context2, angleId) => {
            if (asset2.kind !== "video" && asset2.kind !== "audio" || sourceTime < 0 || sourceTime >= asset2.duration)
              return;
            frame.audio.push({
              ...context2,
              instanceId: `${instanceId}/audio`,
              sequenceId: sequence2.id,
              clipId: clip2.id,
              trackId: track2.id,
              trackInstanceId: `${sequencePath}/${pathPart("track", track2.id)}`,
              assetId: asset2.id,
              sourceTime,
              localTime,
              ...angleId ? { angleId } : {}
            });
          };
          if (clip2.kind === "media") {
            const asset2 = assets.get(clip2.assetId), sourceTime = sourceTimeAt(clip2.timeMap, localTime);
            visual2.set(clip2.id, mediaLayer(asset2, sourceTime));
            addAudio(
              asset2,
              sourceTime,
              audioContext(clip2, track2, localTime, parent, sequence2.id, sequencePath)
            );
          } else if (clip2.kind === "multicam") {
            const source = sourceTimeAt(clip2.timeMap, localTime);
            let switchIndex = clip2.switches.length - 1;
            while (switchIndex > 0 && clip2.switches[switchIndex].time > localTime) switchIndex--;
            const activeSwitch = clip2.switches[switchIndex];
            const angle = clip2.angles.find((item) => item.id === activeSwitch.angleId);
            const audioAngle = clip2.angles.find((item) => item.id === clip2.audioAngleId);
            visual2.set(
              clip2.id,
              mediaLayer(assets.get(angle.assetId), source + angle.offset, angle.id)
            );
            addAudio(
              assets.get(audioAngle.assetId),
              source + audioAngle.offset,
              audioContext(clip2, track2, localTime, parent, sequence2.id, sequencePath),
              audioAngle.id
            );
          } else if (clip2.kind === "sequence") {
            const sourceTime = sourceTimeAt(clip2.timeMap, localTime), nested = sequences.get(clip2.sequenceId);
            const child = evaluateSequence(
              nested,
              sourceTime,
              `${instanceId}/${pathPart("sequence", nested.id)}`,
              audioContext(clip2, track2, localTime, parent, sequence2.id, sequencePath),
              picture
            );
            frame.audio.push(...child.audio);
            visual2.set(
              clip2.id,
              picture && sourceTime < durations.get(nested.id) ? {
                ...base(),
                kind: "group",
                sourceSequenceId: nested.id,
                sourceTime,
                width: nested.width,
                height: nested.height,
                background: nested.background,
                layers: child.layers
              } : null
            );
          } else if (clip2.kind === "text") {
            visual2.set(
              clip2.id,
              picture ? {
                ...base(),
                kind: "text",
                role: clip2.role,
                text: clip2.text,
                style: structuredClone(clip2.style),
                words: clip2.words.map((word) => ({ ...word })),
                activeWordIndices: clip2.words.flatMap(
                  (word, index) => localTime >= word.start && localTime < word.end ? [index] : []
                ),
                animationProgress: localTime / clip2.duration
              } : null
            );
          } else {
            visual2.set(
              clip2.id,
              picture ? {
                ...base(),
                kind: "shape",
                shape: clip2.shape,
                fill: clip2.fill,
                stroke: clip2.stroke,
                strokeWidth: clip2.strokeWidth
              } : null
            );
          }
        }
        if (!picture) continue;
        const transitionByClip = /* @__PURE__ */ new Map();
        for (const transition of sequence2.transitions) {
          if (tick2 < transition.start || tick2 - transition.start >= transition.duration || !visual2.has(transition.fromClipId) || !visual2.has(transition.toClipId))
            continue;
          transitionByClip.set(transition.fromClipId, transition);
          transitionByClip.set(transition.toClipId, transition);
        }
        const emitted = /* @__PURE__ */ new Set();
        for (const clip2 of active) {
          const transition = transitionByClip.get(clip2.id);
          if (transition) {
            if (emitted.has(transition.id)) continue;
            emitted.add(transition.id);
            frame.layers.push({
              kind: "transition",
              instanceId: `${sequencePath}/${pathPart("transition", transition.id)}`,
              sequenceId: sequence2.id,
              trackId: track2.id,
              transitionId: transition.id,
              transitionKind: transition.kind,
              progress: (tick2 - transition.start) / transition.duration,
              from: visual2.get(transition.fromClipId) ?? null,
              to: visual2.get(transition.toClipId) ?? null
            });
          } else {
            const layer = visual2.get(clip2.id);
            if (layer) frame.layers.push(layer);
          }
        }
      }
      return frame;
    }
    return {
      evaluate(sequenceId, tick2) {
        assertTick(tick2, "求值时间");
        const sequence2 = sequences.get(sequenceId);
        if (!sequence2) throw new Error("待求值的序列不存在");
        return evaluateSequence(
          sequence2,
          tick2,
          pathPart("sequence", sequenceId),
          neutralAudio(),
          true
        );
      }
    };
  }

  // src/demo-drawing.ts
  function rounded(ctx, x, y, w, h, radius, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
  }
  function drawDemo(ctx, width, height, index, frame) {
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
    ctx.fillText(["01 / THE IDEA", "02 / THE EDIT", "03 / YOUR STORY"][index % 3], 98, 193);
    ctx.fillStyle = "#edf7ee";
    ctx.font = "600 76px system-ui";
    ctx.fillText(["从想法，", "让每一帧，", "你的故事，"][index % 3], 78, 316);
    ctx.fillStyle = "#b6efca";
    ctx.fillText(["到成片。", "恰到好处。", "现在开始。 "][index % 3], 78, 416);
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
    rounded(ctx, -141, -170, 254, 243, 12, g);
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

  // src/editor/media-pool.ts
  var MediaPoolError = class extends Error {
    constructor(code, message, options) {
      super(message, options);
      this.code = code;
      this.name = code === "aborted" ? "AbortError" : "MediaPoolError";
    }
    code;
  };
  var aborted = () => new MediaPoolError("aborted", "画面准备已取消或被较新的请求替代");
  function assertActive(signal) {
    if (signal.aborted) throw aborted();
  }
  function boundedInteger(value, min, max, label2) {
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`${label2}必须是 ${min}–${max} 范围内的整数`);
    return value;
  }
  function requiredMedia(frame) {
    const required = /* @__PURE__ */ new Map();
    function visit(layer) {
      if (layer.kind === "group") layer.layers.forEach(visit);
      else if (layer.kind === "transition") {
        if (layer.from) visit(layer.from);
        if (layer.to) visit(layer.to);
      } else if (layer.kind === "media") {
        const previous = required.get(layer.instanceId);
        if (previous && (previous.assetId !== layer.assetId || previous.assetKind !== layer.assetKind || previous.sourceTime !== layer.sourceTime))
          throw new MediaPoolError("conflict", `同一画面实例包含不同素材或时间：${layer.instanceId}`);
        if (layer.assetKind === "audio")
          throw new MediaPoolError("decode", "声音素材不能作为画面解码");
        required.set(layer.instanceId, layer);
      }
    }
    frame.layers.forEach(visit);
    return required;
  }
  function waitFor(promise, signal, timeoutMs, timeoutMessage) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        error === void 0 ? resolve(result) : reject(error);
      };
      const cancel = () => finish(aborted());
      const timer = setTimeout(
        () => finish(new MediaPoolError("timeout", timeoutMessage)),
        timeoutMs
      );
      signal.addEventListener("abort", cancel, { once: true });
      promise.then(
        (result) => finish(void 0, result),
        (error) => finish(error)
      );
      if (signal.aborted) cancel();
    });
  }
  function videoReady(video) {
    return !video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0;
  }
  function loadVideo(video, url, signal, timeoutMs, assetId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const events = ["loadedmetadata", "loadeddata", "canplay"];
      const finish = (error) => {
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
        timeoutMs
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
  function seekVideo(video, seconds, signal, timeoutMs, assetId) {
    const seekTime = Math.ceil(seconds * 1e6) / 1e6;
    return new Promise((resolve, reject) => {
      let settled = false, sought = false;
      let poll;
      let callback;
      let presentedTime;
      let decodedTiming;
      const finish = (error, frame) => {
        if (settled) {
          frame?.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        clearTimeout(poll);
        if (callback !== void 0) video.cancelVideoFrameCallback(callback);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("loadeddata", inspect);
        video.removeEventListener("canplay", inspect);
        video.removeEventListener("error", failed);
        signal.removeEventListener("abort", cancel);
        error ? reject(error) : resolve(frame);
      };
      const inspect = () => {
        clearTimeout(poll);
        if (settled) return;
        if (sought && videoReady(video) && Math.abs(video.currentTime - seconds) < 1e-5) {
          let frame;
          try {
            frame = new VideoFrame(video);
          } catch (cause) {
            if (cause instanceof DOMException && cause.name === "InvalidStateError") {
              poll = setTimeout(inspect, 16);
              return;
            }
            finish(new MediaPoolError("decode", `无法读取视频帧：${assetId}`, { cause }));
            return;
          }
          decodedTiming = { timestamp: frame.timestamp, duration: frame.duration };
          const time = Math.floor(video.currentTime * 1e6 + 1e-4);
          if (frame.timestamp <= time + 1 && (frame.duration !== null && frame.duration > 0 && time < frame.timestamp + frame.duration || presentedTime !== void 0 && Math.abs(presentedTime - frame.timestamp) <= 1)) {
            finish(void 0, frame);
            return;
          }
          frame.close();
        }
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
          target: seconds,
          current: video.currentTime,
          sought,
          seeking: video.seeking,
          readyState: video.readyState,
          decodedTiming,
          presentedTime
        })}`)),
        timeoutMs
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
        const seekStartedAt = performance.now();
        const unchangedPosition = videoReady(video) && video.currentTime === seekTime;
        const requestPresentation = () => {
          if (settled || typeof video.requestVideoFrameCallback !== "function") return;
          callback = video.requestVideoFrameCallback((_now, metadata) => {
            callback = void 0;
            if (unchangedPosition || metadata.presentationTime >= seekStartedAt)
              presentedTime = metadata.mediaTime * 1e6;
            inspect();
            requestPresentation();
          });
        };
        requestPresentation();
        video.currentTime = seekTime;
      } catch (cause) {
        finish(new MediaPoolError("decode", `无法定位视频素材：${assetId}`, { cause }));
      }
    });
  }
  var EditorMediaPool = class {
    constructor(options) {
      this.options = options;
      if (typeof options.resolveAsset !== "function") throw new Error("必须提供素材资源解析器");
      this.maxInstances = boundedInteger(options.maxInstances ?? 32, 1, 256, "同时解码实例上限");
      this.timeoutMs = boundedInteger(options.timeoutMs ?? 15e3, 1, 12e4, "媒体等待时限");
    }
    options;
    maxInstances;
    timeoutMs;
    instances = /* @__PURE__ */ new Map();
    resources = /* @__PURE__ */ new Map();
    urlLifetimes = /* @__PURE__ */ new Map();
    pending;
    generation = 0;
    disposed = false;
    releaseInstance(instanceId) {
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
    retainResource(resource) {
      const lifetime = this.urlLifetimes.get(resource.url) ?? { references: 0, owned: false };
      lifetime.references++;
      lifetime.owned ||= Boolean(resource.owned);
      this.urlLifetimes.set(resource.url, lifetime);
    }
    releaseResource(resource) {
      const lifetime = this.urlLifetimes.get(resource.url);
      if (!lifetime) return;
      lifetime.references--;
      if (lifetime.references) return;
      this.urlLifetimes.delete(resource.url);
      if (lifetime.owned) URL.revokeObjectURL(resource.url);
    }
    clearResources() {
      for (const instanceId of this.instances.keys()) this.releaseInstance(instanceId);
      for (const resource of this.resources.values()) this.releaseResource(resource);
      this.resources.clear();
    }
    /** Cancel pending work, release all decoders/owned URLs, and permit a new generation. */
    reset() {
      this.generation++;
      this.pending?.controller.abort();
      this.pending = void 0;
      this.clearResources();
    }
    dispose() {
      this.disposed = true;
      this.reset();
    }
    async resource(assetId, request) {
      const existing = this.resources.get(assetId);
      if (existing) return existing;
      const promise = Promise.resolve().then(() => {
        assertActive(request.controller.signal);
        return this.options.resolveAsset(assetId, request.controller.signal);
      }).then(
        (result) => {
          const raw = typeof result === "string" ? { url: result } : result;
          if (!raw || typeof raw.url !== "string" || !raw.url.trim() || raw.owned !== void 0 && typeof raw.owned !== "boolean" || raw.owned && !raw.url.startsWith("blob:"))
            throw new MediaPoolError("resolve", `素材资源 URL 或所有权无效：${assetId}`);
          const resource = { assetId, url: raw.url, owned: raw.owned ?? false };
          this.retainResource(resource);
          if (request.controller.signal.aborted || request.generation !== this.generation || this.disposed) {
            this.releaseResource(resource);
            throw aborted();
          }
          this.resources.set(assetId, resource);
          return resource;
        },
        (cause) => {
          if (request.controller.signal.aborted) throw aborted();
          throw new MediaPoolError("resolve", `无法读取素材资源：${assetId}`, { cause });
        }
      );
      return waitFor(
        promise,
        request.controller.signal,
        this.timeoutMs,
        `素材资源解析超时：${assetId}`
      );
    }
    async decode(layer, request) {
      const signal = request.controller.signal;
      assertActive(signal);
      let instance = this.instances.get(layer.instanceId);
      if (layer.assetKind === "demo") {
        if (!instance) {
          instance = {
            assetId: layer.assetId,
            kind: "demo",
            element: document.createElement("canvas")
          };
          this.instances.set(layer.instanceId, instance);
        }
        const canvas = instance.element;
        if (instance.preparedSource !== layer.sourceTime || canvas.width !== layer.naturalWidth || canvas.height !== layer.naturalHeight) {
          canvas.width = layer.naturalWidth;
          canvas.height = layer.naturalHeight;
          const context2 = canvas.getContext("2d");
          if (!context2) throw new MediaPoolError("decode", "无法创建示例画面");
          const index = layer.assetId === "demo-city" ? 1 : layer.assetId === "demo-outro" ? 2 : 0;
          drawDemo(
            context2,
            canvas.width,
            canvas.height,
            index,
            ticksToSeconds(layer.sourceTime) * 30
          );
          instance.preparedSource = layer.sourceTime;
        }
        return canvas;
      }
      const resource = this.resources.get(layer.assetId);
      if (!instance) {
        const element2 = layer.assetKind === "image" ? new Image() : document.createElement("video");
        element2.crossOrigin = "anonymous";
        instance = { assetId: layer.assetId, kind: layer.assetKind, element: element2 };
        this.instances.set(layer.instanceId, instance);
        if (element2 instanceof HTMLVideoElement) {
          element2.muted = true;
          element2.defaultMuted = true;
          element2.playsInline = true;
          element2.preload = "auto";
          await loadVideo(element2, resource.url, signal, this.timeoutMs, layer.assetId);
        } else {
          element2.src = resource.url;
          try {
            await waitFor(element2.decode(), signal, this.timeoutMs, `图片解码超时：${layer.assetId}`);
          } catch (cause) {
            if (cause instanceof MediaPoolError) throw cause;
            throw new MediaPoolError("decode", `无法解码图片素材：${layer.assetId}`, { cause });
          }
          if (!element2.naturalWidth || !element2.naturalHeight)
            throw new MediaPoolError("decode", `图片没有可用画面：${layer.assetId}`);
          if (typeof createImageBitmap !== "function")
            throw new MediaPoolError("decode", "当前浏览器无法冻结图片的静态首帧");
          const owner = instance;
          const freezing = createImageBitmap(element2).then((bitmap) => {
            if (signal.aborted || request.generation !== this.generation || this.instances.get(layer.instanceId) !== owner) {
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
          element2.removeAttribute("src");
        }
      }
      assertActive(signal);
      const element = instance.element;
      if (element instanceof HTMLVideoElement) {
        const seconds = ticksToSeconds(layer.sourceTime);
        if (Number.isFinite(element.duration) && seconds >= element.duration)
          throw new MediaPoolError("decode", `请求画面已超出视频源时长：${layer.assetId}`);
        if (instance.preparedSource !== layer.sourceTime || !videoReady(element) || Math.abs(element.currentTime - seconds) >= 1e-5) {
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
    async prepare(frame, signal) {
      if (this.disposed) throw new MediaPoolError("disposed", "媒体解码池已释放");
      if (this.pending) this.reset();
      const request = { controller: new AbortController(), generation: this.generation };
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
            `当前画面需要 ${required.size} 个解码实例，超过上限 ${this.maxInstances}`
          );
        const assetIds = new Set(
          [...required.values()].filter((layer) => layer.assetKind !== "demo").map((layer) => layer.assetId)
        );
        for (const [id2, instance] of this.instances) {
          const layer = required.get(id2);
          if (!layer || layer.assetId !== instance.assetId || layer.assetKind !== instance.kind)
            this.releaseInstance(id2);
        }
        for (const [id2, resource] of this.resources) {
          if (assetIds.has(id2)) continue;
          this.resources.delete(id2);
          this.releaseResource(resource);
        }
        await Promise.all([...assetIds].map((id2) => this.resource(id2, request)));
        assertActive(request.controller.signal);
        const surfaces = await Promise.all(
          [...required.values()].map(
            async (layer) => [layer.instanceId, await this.decode(layer, request)]
          )
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
        if (this.pending === request) this.pending = void 0;
      }
    }
  };

  // src/editor/render-entry.ts
  function withoutSubtitles(layers) {
    return layers.flatMap((layer) => {
      if (layer.kind === "text" && layer.role === "subtitle") return [];
      if (layer.kind === "group") return [{ ...layer, layers: withoutSubtitles(layer.layers) }];
      if (layer.kind === "transition") {
        const from = layer.from ? withoutSubtitles([layer.from])[0] ?? null : null;
        const to = layer.to ? withoutSubtitles([layer.to])[0] ?? null : null;
        return [{ ...layer, from, to }];
      }
      return [layer];
    });
  }
  function createRenderRuntime() {
    let evaluator;
    let media;
    let compositor;
    let sequenceId = "";
    let profile;
    let uploadUrl = "";
    let rendering = false;
    const scene = document.createElement("canvas");
    const output = document.createElement("canvas");
    const dispose = () => {
      media?.dispose();
      compositor?.dispose();
      media = void 0;
      compositor = void 0;
      evaluator = void 0;
      scene.width = scene.height = output.width = output.height = 1;
    };
    return {
      async initialize(documentValue, id2, settings, urls, endpoint) {
        if (rendering) throw new Error("上一画面仍在绘制");
        dispose();
        profile = validateExportProfile(settings);
        evaluator = prepareEvaluator(documentValue);
        evaluator.evaluate(id2, 0);
        sequenceId = id2;
        uploadUrl = endpoint;
        if (new URL(endpoint).origin !== location.origin) throw new Error("渲染输出地址无效");
        media = new EditorMediaPool({
          resolveAsset: (assetId) => {
            const url = urls[assetId];
            if (!url || new URL(url).origin !== location.origin)
              throw new Error(`未提供渲染素材：${assetId}`);
            return url;
          }
        });
        compositor = new FrameCompositor();
        output.width = profile.width;
        output.height = profile.height;
        await document.fonts.ready;
        return true;
      },
      async render(time, requestId) {
        if (rendering || !evaluator || !media || !compositor || !profile)
          throw new Error("画面渲染器未就绪或正在工作");
        if (!Number.isSafeInteger(requestId) || requestId < 0) throw new Error("画面请求编号无效");
        rendering = true;
        try {
          const frame = evaluator.evaluate(sequenceId, time);
          if (!profile.includeCaptions) frame.layers = withoutSubtitles(frame.layers);
          const sources = await media.prepare(frame);
          compositor.draw(scene, frame, sources);
          const context2 = output.getContext("2d");
          context2.reset();
          context2.fillStyle = frame.background;
          context2.fillRect(0, 0, output.width, output.height);
          const scale = Math.min(output.width / scene.width, output.height / scene.height);
          context2.drawImage(
            scene,
            (output.width - scene.width * scale) / 2,
            (output.height - scene.height * scale) / 2,
            scene.width * scale,
            scene.height * scale
          );
          const blob = await new Promise(
            (resolve, reject) => output.toBlob(
              (value) => value ? resolve(value) : reject(new Error("无法编码画面 PNG")),
              "image/png"
            )
          );
          const response = await fetch(`${uploadUrl}/${requestId}`, {
            method: "POST",
            headers: { "Content-Type": "image/png" },
            body: blob
          });
          if (!response.ok) throw new Error("无法传递已完成的画面");
          return true;
        } finally {
          rendering = false;
        }
      },
      dispose
    };
  }
  globalThis.videoStudioRender = createRenderRuntime();
})();
