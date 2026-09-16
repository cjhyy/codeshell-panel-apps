import type { ResolvedTransform } from "./evaluate";

export interface VisualPoint {
  x: number;
  y: number;
}
export interface VisualSize {
  width: number;
  height: number;
}

/** The same crop/fit rectangle is used for the rendered pixels and canvas handles. */
export function fitVisualSource(
  source: VisualSize,
  canvas: VisualSize,
  transform: ResolvedTransform,
) {
  const crop = transform.crop;
  const sourceX = crop.left * source.width,
    sourceY = crop.top * source.height;
  const croppedWidth = source.width * (1 - crop.left - crop.right);
  const croppedHeight = source.height * (1 - crop.top - crop.bottom);
  if (
    ![source.width, source.height, canvas.width, canvas.height, croppedWidth, croppedHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error("画面尺寸或裁切范围无效");
  const factor =
    transform.fit === "cover"
      ? Math.max(canvas.width / croppedWidth, canvas.height / croppedHeight)
      : Math.min(canvas.width / croppedWidth, canvas.height / croppedHeight);
  const fittedWidth = transform.fit === "stretch" ? canvas.width : croppedWidth * factor;
  const fittedHeight = transform.fit === "stretch" ? canvas.height : croppedHeight * factor;
  return {
    sourceX,
    sourceY,
    croppedWidth,
    croppedHeight,
    fittedWidth,
    fittedHeight,
    originalWidth: fittedWidth / (1 - crop.left - crop.right),
    originalHeight: fittedHeight / (1 - crop.top - crop.bottom),
  };
}

/** Local pixel coordinates are relative to the fitted source's center. */
export function visualPointToCanvas(
  point: VisualPoint,
  canvas: VisualSize,
  transform: ResolvedTransform,
): VisualPoint {
  const angle = (transform.rotation * Math.PI) / 180;
  const x = point.x * transform.scaleX * (transform.flipX ? -1 : 1);
  const y = point.y * transform.scaleY * (transform.flipY ? -1 : 1);
  return {
    x: canvas.width * (0.5 + transform.x) + Math.cos(angle) * x - Math.sin(angle) * y,
    y: canvas.height * (0.5 + transform.y) + Math.sin(angle) * x + Math.cos(angle) * y,
  };
}
export function canvasPointToVisual(
  point: VisualPoint,
  canvas: VisualSize,
  transform: ResolvedTransform,
): VisualPoint | undefined {
  if (transform.scaleX === 0 || transform.scaleY === 0) return undefined;
  const angle = (-transform.rotation * Math.PI) / 180;
  const x = point.x - canvas.width * (0.5 + transform.x),
    y = point.y - canvas.height * (0.5 + transform.y);
  return {
    x:
      (Math.cos(angle) * x - Math.sin(angle) * y) / (transform.scaleX * (transform.flipX ? -1 : 1)),
    y:
      (Math.sin(angle) * x + Math.cos(angle) * y) / (transform.scaleY * (transform.flipY ? -1 : 1)),
  };
}

export function sourcePointToCanvas(
  point: VisualPoint,
  source: VisualSize,
  canvas: VisualSize,
  transform: ResolvedTransform,
): VisualPoint {
  const fit = fitVisualSource(source, canvas, transform);
  return visualPointToCanvas(
    {
      x: (point.x - transform.crop.left) * fit.originalWidth - fit.fittedWidth / 2,
      y: (point.y - transform.crop.top) * fit.originalHeight - fit.fittedHeight / 2,
    },
    canvas,
    transform,
  );
}
export function canvasPointToSource(
  point: VisualPoint,
  source: VisualSize,
  canvas: VisualSize,
  transform: ResolvedTransform,
): VisualPoint | undefined {
  const local = canvasPointToVisual(point, canvas, transform);
  if (!local) return undefined;
  const fit = fitVisualSource(source, canvas, transform);
  return {
    x: (local.x + fit.fittedWidth / 2) / fit.originalWidth + transform.crop.left,
    y: (local.y + fit.fittedHeight / 2) / fit.originalHeight + transform.crop.top,
  };
}
