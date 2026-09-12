import { createHash } from "node:crypto";
import { validateMediaConnections, type MediaConnection } from "./media-runtime.js";

/** Convert generic resolved configuration into panel-owned speech choices. */
export function resolveMediaConnections(
  raw: unknown,
  options: { publicOnly?: boolean } = {},
): { connections: MediaConnection[]; defaultModelId?: string } {
  if (Array.isArray(raw)) {
    if (options.publicOnly) throw new Error("公开连接须使用通用目录格式");
    return { connections: validateMediaConnections(raw) };
  }
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as any).connections))
    throw new Error("配音连接配置无效");
  const value = raw as any;
  if (value.connections.length > 1000) throw new Error("配音连接配置过多");
  const connections: MediaConnection[] = [],
    seen = new Set<string>();
  for (const c of value.connections) {
    if (
      !c ||
      c.tag !== "speech" ||
      c.entry?.tag !== "speech" ||
      c.adapterKind !== "openai" ||
      typeof c.id !== "string" ||
      seen.has(c.id) ||
      typeof c.catalogId !== "string" ||
      !c.preset ||
      typeof c.model !== "string" ||
      !c.model ||
      (options.publicOnly ? !c.hasCredentials : typeof c.apiKey !== "string" || !c.apiKey.trim())
    )
      continue;
    seen.add(c.id);
    const fingerprint =
      typeof c.fingerprint === "string" && /^[a-f0-9]{32}$/.test(c.fingerprint)
        ? c.fingerprint
        : undefined;
    if (options.publicOnly && !fingerprint && typeof c.baseUrl !== "string") continue;
    if (!options.publicOnly) {
      if (typeof c.baseUrl !== "string") continue;
      let url: URL;
      try {
        url = new URL(c.baseUrl);
      } catch {
        continue;
      }
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !(
          url.protocol === "https:" ||
          (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        )
      )
        continue;
    }
    const params = Array.isArray(c.preset.params) ? c.preset.params : [],
      values = c.paramValues ?? {};
    const voiceSpec = params.find((p: any) => p.name === "voice");
    const voiceIds: unknown[] =
      voiceSpec?.control === "enum"
        ? (voiceSpec.options ?? [])
        : typeof values.voice === "string"
          ? [values.voice]
          : [];
    if (!Array.isArray(voiceIds)) continue;
    const voices = [...new Set(voiceIds)]
      .filter((v): v is string => typeof v === "string" && Boolean(v.trim()) && v.length <= 200)
      .slice(0, 64)
      .map((id) => ({ id, name: id, language: "und" }));
    if (!voices.length) continue;
    const defaultVoiceId = values.voice ?? voiceSpec?.default ?? voices[0]!.id;
    if (!voices.some((v) => v.id === defaultVoiceId)) continue;
    const defaultRate = values.speed ?? params.find((p: any) => p.name === "speed")?.default ?? 1;
    if (
      typeof defaultRate !== "number" ||
      !Number.isFinite(defaultRate) ||
      defaultRate < 0.5 ||
      defaultRate > 2
    )
      continue;
    const supportsInstructions =
      params.some((p: any) => p.name === "instructions") &&
      !["tts-1", "tts-1-hd"].includes(c.model);
    const instructions = options.publicOnly ? undefined : values.instructions;
    if (
      instructions !== undefined &&
      (typeof instructions !== "string" ||
        instructions.length > 2000 ||
        (instructions.trim() && !supportsInstructions))
    )
      continue;
    const id = `speech-${
      options.publicOnly && fingerprint
        ? fingerprint
        : createHash("sha256")
            .update(JSON.stringify([c.id, c.catalogId, c.model, c.baseUrl]))
            .digest("hex")
            .slice(0, 32)
    }`;
    connections.push({
      description: {
        id,
        name: `${c.id} · ${c.preset.label ?? c.model}`.slice(0, 256),
        provider: String(c.providerName ?? c.entry.displayName ?? c.entry.id ?? c.catalogId).slice(
          0,
          256,
        ),
        available: true,
        voices,
        defaultVoiceId,
        maxTextLength: 4096,
        supportsInstructions,
      },
      connectionId: c.id,
      model: c.model,
      baseUrl: options.publicOnly ? "" : c.baseUrl,
      apiKey: options.publicOnly ? "" : c.apiKey,
      defaultRate,
      ...(instructions?.trim() ? { defaultInstructions: instructions.trim() } : {}),
    });
  }
  const preferred = connections.find((c) => c.connectionId === value.defaults?.speech);
  return { connections, ...(preferred ? { defaultModelId: preferred.description.id } : {}) };
}
