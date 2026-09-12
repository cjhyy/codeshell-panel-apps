export interface LocalTtsVoice {
  id: string;
  name: string;
  language: string;
}
export interface LocalTtsInput {
  text: string;
  voiceId?: string;
  rate: number;
}

/** Plain text only: say's embedded control language must not bypass rate/duration bounds. */
export function validateLocalTtsInput(raw: unknown): LocalTtsInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("配音参数必须是对象");
  const input = raw as Record<string, unknown>;
  if (typeof input.text !== "string") throw new Error("请输入配音文字");
  const text = input.text.replace(/\r\n?/g, "\n").trim();
  if (!text || Array.from(text).length > 6000) throw new Error("配音文字须为 1 至 6000 字");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || /\[\[|\]\]/.test(text))
    throw new Error("配音仅支持普通文字，不支持语音控制标记或控制字符");
  let voiceId: string | undefined;
  if (input.voiceId !== undefined) {
    if (typeof input.voiceId !== "string" || !input.voiceId.trim() || input.voiceId.length > 200)
      throw new Error("声音标识无效");
    voiceId = input.voiceId.trim();
  }
  const rate = input.rate === undefined ? 1 : input.rate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0.5 || rate > 2)
    throw new Error("语速须在 0.5 至 2 倍之间");
  return { text, ...(voiceId ? { voiceId } : {}), rate };
}
