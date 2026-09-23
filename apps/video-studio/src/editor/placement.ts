import { createTrack } from "./defaults";
import type { EditorOperation } from "./operations";
import type { Tick } from "./time";
import type { EditorSequence, EditorTrack } from "./types";

/*
 * General "where does new material go" rules shared by the editor's ＋, text insertion, voiceover
 * publication, the 15-second draft and rough-cut placement. Keeping one copy means every entry
 * point agrees on which track is the main picture track.
 */

/** Whether any clip on the track overlaps [start, start + duration). */
export const overlaps = (sequence: EditorSequence, trackId: string, start: Tick, duration: Tick) =>
  sequence.clips.some(
    (clip) =>
      clip.trackId === trackId &&
      clip.start < start + duration &&
      clip.start + clip.duration > start,
  );
/** End of the last clip on the track (0 when empty). */
export const trackEnd = (sequence: EditorSequence, trackId: string) =>
  sequence.clips
    .filter((clip) => clip.trackId === trackId)
    .reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);

/** First unlocked track of this kind free over [start, start + duration), else a new track. */
export function findFreeTrack(
  sequence: EditorSequence,
  kind: EditorTrack["kind"],
  start: Tick,
  duration: Tick,
  idFactory: (kind: "track") => string,
): { trackId: string; operations: EditorOperation[] } {
  const track = sequence.tracks.find(
    (item) => item.kind === kind && !item.locked && !overlaps(sequence, item.id, start, duration),
  );
  if (track) return { trackId: track.id, operations: [] };
  const created = createTrack(idFactory("track"), kind);
  return {
    trackId: created.id,
    operations: [{ type: "track.add", sequenceId: sequence.id, track: created }],
  };
}

/**
 * The main picture track, the one rule for ＋, the 15-second draft (and whether it is offered) and
 * rough-cut placement: on a magnetic timeline the magnetic track when set (even when locked, so
 * callers can explain the lock), otherwise the first unlocked video track. A free timeline ignores
 * a leftover magneticTrackId from a migrated project.
 */
export function mainPictureTrack(sequence: EditorSequence): EditorTrack | undefined {
  const firstFree = () => sequence.tracks.find((item) => item.kind === "video" && !item.locked);
  return sequence.timelineMode === "magnetic"
    ? (sequence.tracks.find((item) => item.id === sequence.magneticTrackId) ?? firstFree())
    : firstFree();
}

/**
 * Default "add to timeline" spot without an explicit drop position: picture continues the main
 * picture track, sound continues the first unlocked audio track. A track is created only when no
 * usable track of that kind exists; a new main picture track goes below every other layer.
 */
export function planAppendPlacement(
  sequence: EditorSequence,
  kind: "video" | "audio",
  idFactory: (kind: "track") => string,
): { trackId: string; start: Tick; operations: EditorOperation[] } {
  const target =
    kind === "video"
      ? mainPictureTrack(sequence)
      : sequence.tracks.find((item) => item.kind === "audio" && !item.locked);
  if (target?.locked) throw new Error("主画面轨道已锁定，请先解锁后再加入");
  if (target?.kind === kind)
    return { trackId: target.id, start: trackEnd(sequence, target.id), operations: [] };
  const created = createTrack(idFactory("track"), kind);
  return {
    trackId: created.id,
    start: 0,
    operations: [
      {
        type: "track.add",
        sequenceId: sequence.id,
        track: created,
        ...(kind === "video" ? { index: 0 } : {}),
      },
    ],
  };
}

const holdsRole = (sequence: EditorSequence, trackId: string, role: "title" | "subtitle") =>
  sequence.clips.some((clip) => clip.trackId === trackId && clip.kind === "text" && clip.role === role);

/**
 * A text track that is visible over every picture: an unlocked text track above all video tracks
 * that is free over [start, start + duration) and holds no subtitles, preferring one that already
 * holds titles; else a new text track on top.
 */
export function planTextPlacement(
  sequence: EditorSequence,
  start: Tick,
  duration: Tick,
  idFactory: (kind: "track") => string,
): { trackId: string; operations: EditorOperation[] } {
  const topPicture = sequence.tracks.reduce(
    (top, item, index) => (item.kind === "video" ? index : top),
    -1,
  );
  const candidates = sequence.tracks.filter(
    (item, index) =>
      index > topPicture &&
      item.kind === "text" &&
      !item.locked &&
      !holdsRole(sequence, item.id, "subtitle") &&
      !overlaps(sequence, item.id, start, duration),
  );
  const track =
    candidates.find((item) => holdsRole(sequence, item.id, "title")) ?? candidates[0];
  if (track) return { trackId: track.id, operations: [] };
  const created = createTrack(idFactory("track"), "text");
  return {
    trackId: created.id,
    operations: [{ type: "track.add", sequenceId: sequence.id, track: created }],
  };
}
