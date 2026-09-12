import { validateProject, type Caption, type Project } from "./model";

const CAPTION_PREFIX = "recorded-narration-";
const MAX_CAPTIONS = 10000;
const ROUNDING_EPSILON = 1e-9;

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/** Replace draft narration captions using the recorded source's actual retained audio ranges. */
export function buildNarrationAlignment(
  project: Project,
  segments: readonly TranscriptSegment[],
): Project {
  const recordingId = project.narration?.recordingAssetId;
  const source = project.assets.find((asset) => asset.id === recordingId);
  if (!source || (source.kind !== "audio" && source.kind !== "video"))
    throw new Error("请先保存并绑定当前工程的本人录音，再对齐字幕");
  if (source.speech) throw new Error("合成配音不能作为本人录音生成正式字幕");
  const validated = validateProject(project);
  const clips = (validated.audioClips ?? [])
    .filter((clip) => clip.assetId === recordingId && clip.volume > 0)
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  if (!clips.length) throw new Error("请先将本人录音放入独立音轨并开启声音，再对齐字幕");
  if (!Array.isArray(segments) || !segments.length || segments.length > MAX_CAPTIONS)
    throw new Error("需要本人录音的真实转写分段，不能用文稿估算字幕时间");

  const duration = source.durationFrames / validated.fps;
  const transcript = Array.from(segments, (segment, index) => {
    if (
      !segment ||
      typeof segment !== "object" ||
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      segment.start < 0 ||
      segment.end <= segment.start ||
      segment.start >= duration ||
      segment.end > duration + 1 / validated.fps + ROUNDING_EPSILON ||
      typeof segment.text !== "string" ||
      !segment.text.trim() ||
      segment.text.length > 4000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(segment.text)
    )
      throw new Error(`本人录音第 ${index + 1} 段转写的文字或真实时间无效，请重新转写`);
    return { ...segment, end: Math.min(segment.end, duration) };
  });

  const retained: { start: number; end: number }[] = [];
  const ranges = clips
    .map((clip) => ({ start: clip.inFrame / validated.fps, end: clip.outFrame / validated.fps }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  for (const range of ranges) {
    const previous = retained[retained.length - 1];
    if (previous && range.start <= previous.end + ROUNDING_EPSILON)
      previous.end = Math.max(previous.end, range.end);
    else retained.push({ ...range });
  }
  for (const [index, segment] of transcript.entries()) {
    if (
      !retained.some(
        (range) =>
          range.start <= segment.start + ROUNDING_EPSILON &&
          range.end + ROUNDING_EPSILON >= segment.end,
      )
    )
      throw new Error(
        `本人录音第 ${index + 1} 段说话内容未完整保留。请先补足画面和音轨，不能为适配草稿时长截掉尾句或重说内容。`,
      );
  }

  const draftIds = new Set(validated.narration!.draftCaptionIds);
  const captions: Caption[] = validated.captions.filter(
    (caption) => !draftIds.has(caption.id) && !caption.id.startsWith(CAPTION_PREFIX),
  );
  for (const [clipIndex, clip] of clips.entries()) {
    for (const [segmentIndex, segment] of transcript.entries()) {
      const sourceStart = Math.max(
        clip.inFrame,
        Math.floor(segment.start * validated.fps + ROUNDING_EPSILON),
      );
      const sourceEnd = Math.min(
        clip.outFrame,
        Math.ceil(segment.end * validated.fps - ROUNDING_EPSILON),
      );
      if (sourceEnd <= sourceStart) continue;
      if (captions.length >= MAX_CAPTIONS) throw new Error("真实字幕超过 10000 段，请分成多个工程");
      captions.push({
        id: `${CAPTION_PREFIX}${clipIndex + 1}-${segmentIndex + 1}`,
        startFrame: clip.startFrame + sourceStart - clip.inFrame,
        endFrame: clip.startFrame + sourceEnd - clip.inFrame,
        text: segment.text,
      });
    }
  }
  return validateProject({ ...validated, captions });
}
