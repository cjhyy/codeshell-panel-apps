import type { TranscriptSegment } from "./production";

/** One asset's real analysis. Detection and editing live in editor/spoken-edits.ts. */
export interface SpokenSource {
  assetId: string;
  transcript?: readonly TranscriptSegment[];
  /** Real detector intervals, in seconds relative to the original source. */
  silence?: readonly { start: number; end: number }[];
}
