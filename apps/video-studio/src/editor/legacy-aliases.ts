import type { EditorClip, EditorDocument } from "./types";

/** Schema-1 collections a canonical clip can be known by in older records. */
export type LegacyCollection = "clips" | "audioClips" | "captions";

/** The old schema-1 ID of a canonical clip: explicit alias, migration remap, else its own ID. */
export function legacyClipId(
  document: EditorDocument,
  sequenceId: string,
  clip: EditorClip,
  collection: LegacyCollection,
): string {
  const aliases = document.production?.legacyAliases;
  if (Array.isArray(aliases)) {
    const found = aliases.find(
      (value) =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        value.sequenceId === sequenceId &&
        value.clipId === clip.id &&
        value.collection === collection,
    );
    if (
      found &&
      typeof found === "object" &&
      !Array.isArray(found) &&
      typeof found.legacyId === "string"
    )
      return found.legacyId;
  }
  const migration = document.production?.migration;
  if (
    migration &&
    typeof migration === "object" &&
    !Array.isArray(migration) &&
    Array.isArray(migration.remapped)
  ) {
    const found = migration.remapped.find(
      (value) =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        value.id === clip.id &&
        value.trackId === clip.trackId,
    );
    if (
      found &&
      typeof found === "object" &&
      !Array.isArray(found) &&
      typeof found.original === "string"
    )
      return found.original;
  }
  return clip.id;
}

/**
 * The canonical clip an old schema-1 ID refers to, read directly from the editor document
 * without building the 30 fps view. Only clips that can belong to the collection are
 * considered (sound clips on audio tracks for "audioClips", subtitles for "captions"), so a
 * video clip sharing the ID cannot stand in for a voice. Ambiguous or unknown IDs resolve to
 * nothing.
 *
 * The frame view gives a second clip with the same old ID a `-legacy-N` suffix, in an order
 * that depends on the whole projection. Such suffixed IDs deliberately do not resolve here;
 * callers treat that like a changed original and keep their result in the library.
 */
export function resolveLegacyClipId(
  document: EditorDocument,
  sequenceId: string,
  collection: LegacyCollection,
  legacyId: string,
): string | undefined {
  const sequence = document.sequences.find((item) => item.id === sequenceId);
  const eligible = (clip: EditorClip) =>
    collection === "captions"
      ? clip.kind === "text" && clip.role === "subtitle"
      : clip.kind === "media" &&
        (collection === "clips" ||
          sequence!.tracks.find((track) => track.id === clip.trackId)?.kind === "audio");
  const matches = (sequence?.clips ?? []).filter(
    (clip) => eligible(clip) && legacyClipId(document, sequenceId, clip, collection) === legacyId,
  );
  return matches.length === 1 ? matches[0]!.id : undefined;
}
