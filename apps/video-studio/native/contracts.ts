import type { LocalTtsVoice } from "./validation.js";

export interface MediaScope {
  appId: string;
  projectPath: string;
}
export interface MediaJobProgress {
  fraction?: number;
  stage?: string;
  message?: string;
}
export interface MediaJobContext {
  scope: MediaScope;
  jobId: string;
  attempt: number;
  signal: AbortSignal;
  workDir: string;
  outputDir: string;
  cacheDir: string;
  reportProgress(progress: MediaJobProgress): Promise<void>;
}
export interface ManagedTtsProviderStatus {
  id: "audio8-tts" | "qwen3-tts";
  name: string;
  mode: "online" | "offline";
  state: "not-installed" | "needs-setup" | "installing" | "ready" | "unavailable" | "failed";
  available: boolean;
  installed: boolean;
  voices: LocalTtsVoice[];
  defaultVoiceId?: string;
  reason?: string;
  downloadBytes: number;
  requiredDiskBytes: number;
  version?: string;
  verifiedAt?: number;
}
