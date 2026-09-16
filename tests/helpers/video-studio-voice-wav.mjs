import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Real decoded audio bytes and matching native TTS receipt; no inference quality claim. */
export async function createVoiceWavFixture(source, directory) {
  const path = resolve(directory, "voice-result.wav");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    source,
    "-ar",
    "48000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    path,
  ]);
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const durationSeconds = Number(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
      { encoding: "utf8" },
    ).trim(),
  );
  return {
    bytes,
    asset: {
      id: `asset-${sha256}`,
      sha256,
      name: "真实配音试听.wav",
      mimeType: "audio/wav",
      bytes: bytes.length,
      createdAt: 1,
    },
    inspection: {
      kind: "audio",
      durationSeconds,
      audio: { codec: "pcm_s16le", sampleRate: 48000, channels: 1 },
    },
  };
}
