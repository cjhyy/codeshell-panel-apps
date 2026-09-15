export const MIN_TIMELINE_SCALE = 0.01;
export const MAX_TIMELINE_SCALE = 240;

const MAX_FRAME = Number.MAX_SAFE_INTEGER;

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boundedFrame(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_FRAME, value)) : 0;
}

/** Pixels per second needed to show the complete sequence, including right-hand padding. */
export function fitTimelineScale(
  durationFrames: number,
  fps: number,
  viewportWidth: number,
  paddingPixels = 40,
): number {
  const seconds = Math.max(1, boundedFrame(durationFrames)) / positive(fps, 30);
  const availableWidth = Math.max(0, boundedFrame(viewportWidth) - boundedFrame(paddingPixels));
  return Math.max(MIN_TIMELINE_SCALE, Math.min(MAX_TIMELINE_SCALE, availableWidth / seconds));
}

export interface TimelineTickOptions {
  durationFrames: number;
  fps: number;
  pixelsPerSecond: number;
  visibleStartFrame?: number;
  visibleEndFrame?: number;
  minSpacingPixels?: number;
  maxTicks?: number;
}

export interface TimelineTicks {
  stepFrames: number;
  frames: number[];
}

function tickStep(requiredFrames: number, fps: number): number {
  const secondSteps = [
    1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400,
  ];
  const steps = [
    ...new Set([1, 5, 10, 15, ...secondSteps.map((seconds) => Math.round(seconds * fps))]),
  ]
    .filter((step) => step > 0 && Number.isSafeInteger(step))
    .sort((a, b) => a - b);
  const matched = steps.find((step) => step >= requiredFrames);
  if (matched !== undefined) return matched;
  // Very long sequences still need a bounded ruler, even without a viewport hint.
  const dayFrames = Math.max(1, Math.round(86400 * fps));
  return Math.min(MAX_FRAME, Math.max(1, Math.ceil(requiredFrames / dayFrames) * dayFrames));
}

/** Generate only visible ruler labels; maxTicks also bounds callers without viewport information. */
export function getTimelineTicks(options: TimelineTickOptions): TimelineTicks {
  const fps = positive(options.fps, 30);
  const scale = positive(options.pixelsPerSecond, MIN_TIMELINE_SCALE);
  const duration = Math.floor(boundedFrame(options.durationFrames));
  const start = Math.min(duration, boundedFrame(options.visibleStartFrame ?? 0));
  const end = Math.min(duration, boundedFrame(options.visibleEndFrame ?? duration));
  const limit = Math.min(1000, Math.max(1, Math.floor(positive(options.maxTicks ?? 200, 200))));
  const spacing = positive(options.minSpacingPixels ?? 72, 72);
  const requiredFrames = Math.max(
    1,
    (spacing / scale) * fps,
    (end - start) / Math.max(1, limit - 1),
  );
  const stepFrames = tickStep(Math.min(MAX_FRAME, requiredFrames), fps);
  const frames: number[] = [];
  if (end < start) return { stepFrames, frames };
  const first = Math.ceil(start / stepFrames) * stepFrames;
  const count = Math.min(limit, Math.max(0, Math.floor((end - first) / stepFrames) + 1));
  for (let index = 0; index < count; index++) frames.push(first + index * stepFrames);
  return { stepFrames, frames };
}

export interface SnapFrameOptions {
  candidates: readonly number[];
  fps: number;
  pixelsPerSecond: number;
  minFrame?: number;
  maxFrame?: number;
  enabled?: boolean;
  thresholdPixels?: number;
}

/** Snap to an integer candidate only when its on-screen distance is within the threshold. */
export function snapFrame(frame: number, options: SnapFrameOptions): number {
  const signedFrame = (value: number) =>
    Number.isFinite(value) ? Math.max(-MAX_FRAME, Math.min(MAX_FRAME, value)) : 0;
  const min = Math.ceil(signedFrame(options.minFrame ?? 0));
  const max = Math.max(min, Math.floor(signedFrame(options.maxFrame ?? MAX_FRAME)));
  const requested = Math.max(min, Math.min(max, signedFrame(frame)));
  const rounded = Math.max(min, Math.min(max, Math.round(requested)));
  if (
    options.enabled === false ||
    !Number.isFinite(options.fps) ||
    options.fps <= 0 ||
    !Number.isFinite(options.pixelsPerSecond) ||
    options.pixelsPerSecond <= 0
  )
    return rounded;

  const threshold = Number.isFinite(options.thresholdPixels ?? 8)
    ? Math.max(0, options.thresholdPixels ?? 8)
    : 8;
  let result = rounded;
  let closestDistance = Infinity;
  for (const candidate of options.candidates) {
    // Do not clamp a candidate into the allowed range: it is no longer the same boundary.
    if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) continue;
    const distance = (Math.abs(candidate - requested) / options.fps) * options.pixelsPerSecond;
    if (
      distance <= threshold &&
      (distance < closestDistance || (distance === closestDistance && candidate < result))
    ) {
      result = candidate;
      closestDistance = distance;
    }
  }
  return result;
}
