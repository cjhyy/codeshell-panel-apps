import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";

// The Host grants only this extra pipe to reviewed native entries. No paths,
// scope identifiers, credentials or network endpoints are accepted here.
const MAX_FRAME_BYTES = 256 * 1024;
const SECRET_KEY =
  /^(?:authorization|proxyAuthorization|apiKey|accessToken|refreshToken|password|secret|clientSecret|cookie|setCookie|credentials)$/i;
const OMITTED = "[binary content omitted]";

function safeBody(value) {
  let truncated = false,
    nodes = 0,
    remaining = 96 * 1024;
  const seen = new WeakSet();
  const visit = (item, depth = 0) => {
    if (++nodes > 2048 || depth > 12) {
      truncated = true;
      return "[truncated]";
    }
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? item : null;
    if (typeof item === "string") {
      if (/^data:[^,]*;base64,/i.test(item)) return OMITTED;
      let text = item
        .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]")
        .replace(/\b(?:sk|sk-proj|sk-ant)-[A-Za-z0-9_-]{8,}/g, "[redacted]");
      const maximum = Math.max(0, Math.min(16 * 1024, remaining));
      if (Buffer.byteLength(JSON.stringify(text)) > maximum) {
        let low = 0,
          high = text.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (Buffer.byteLength(JSON.stringify(text.slice(0, middle))) <= Math.max(0, maximum - 16))
            low = middle;
          else high = middle - 1;
        }
        text = text.slice(0, low) + " [truncated]";
        truncated = true;
      }
      remaining = Math.max(0, remaining - Buffer.byteLength(JSON.stringify(text)));
      return text;
    }
    if (typeof item !== "object") return undefined;
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return OMITTED;
    if (seen.has(item)) {
      truncated = true;
      return "[circular value omitted]";
    }
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > 256) truncated = true;
      return item.slice(0, 256).map((entry) => visit(entry, depth + 1));
    }
    const entries = Object.entries(item);
    if (entries.length > 64) truncated = true;
    const result = Object.create(null);
    for (const [key, entry] of entries.slice(0, 64)) {
      const keyBytes = Buffer.byteLength(JSON.stringify(key));
      if (key.length > 128 || keyBytes > remaining) {
        truncated = true;
        continue;
      }
      remaining -= keyBytes;
      result[key] = SECRET_KEY.test(key.replace(/[-_]/g, ""))
        ? "[redacted]"
        : /^(?:base64|audioBytes|imageBytes|fileBytes|binary)$/i.test(key)
          ? OMITTED
          : visit(entry, depth + 1);
    }
    return result;
  };
  return { value: visit(value), truncated };
}

function emit(frame) {
  try {
    const message = Buffer.from(JSON.stringify(frame));
    if (message.length > MAX_FRAME_BYTES) return false;
    const atomic = (line) => writeSync(3, line) === line.length;
    if (message.length + 1 <= 512) return atomic(Buffer.concat([message, Buffer.from("\n")]));
    // Sibling CLIs can inherit one Bash descriptor. A single small write stays
    // atomic even on systems whose PIPE_BUF is only 512 bytes (including macOS).
    const messageId = randomUUID();
    for (let offset = 0, part = 0; offset < message.length; offset += 192, part++) {
      const line = Buffer.from(
        JSON.stringify({
          version: 1,
          type: "model_trace_chunk",
          messageId,
          part,
          data: message.subarray(offset, offset + 192).toString("base64"),
          final: offset + 192 >= message.length,
        }) + "\n",
      );
      if (line.length > 512 || !atomic(line)) return false;
    }
    return true;
  } catch {
    // Observation loss never retries a provider request or changes its result.
    return false;
  }
}

/**
 * Observe actual inference only. Call after cache checks and immediately before
 * provider execution; standalone CLI stdout and return values stay unchanged.
 * @template T
 * @param {{provider:string,model:string,purpose:string,input:{systemPrompt?:string,messages?:unknown[],tools?:unknown[],parameters?:Record<string,unknown>},stream?:boolean}} request
 * @param {()=>Promise<T>} operation
 * @param {{signal?:AbortSignal,output?:(value:T)=>unknown,usage?:(value:T)=>unknown}} [options]
 * @returns {Promise<T>}
 */
export async function observeModelCall(request, operation, options = {}) {
  if (process.env.CODESHELL_MODEL_TRACE_FD !== "3") return operation();
  const callId = randomUUID();
  let admitted = false;
  try {
    const input = safeBody({
      systemPrompt: request.input.systemPrompt ?? "",
      messages: request.input.messages ?? [],
      tools: request.input.tools ?? [],
      parameters: request.input.parameters ?? {},
    });
    admitted = emit({
      version: 1,
      type: "model_trace",
      phase: "start",
      callId,
      provider: request.provider.slice(0, 200),
      model: request.model.slice(0, 200),
      purpose: request.purpose.slice(0, 200),
      stream: request.stream === true,
      input: input.value,
      ...(input.truncated ? { inputState: "truncated" } : {}),
    });
  } catch {
    // Bad observer data must not prevent the real operation.
  }
  try {
    const result = await operation();
    if (admitted) {
      try {
        const output = safeBody(options.output?.(result) ?? {});
        emit({
          version: 1,
          type: "model_trace",
          phase: "finish",
          callId,
          status: "completed",
          output: output.value,
          ...(output.truncated ? { outputState: "truncated" } : {}),
          ...(options.usage ? { usage: safeBody(options.usage(result)).value } : {}),
        });
      } catch {
        emit({ version: 1, type: "model_trace", phase: "finish", callId, status: "completed" });
      }
    }
    return result;
  } catch (error) {
    if (admitted) {
      const cancelled =
        options.signal?.aborted || (error instanceof Error && error.name === "AbortError");
      emit({
        version: 1,
        type: "model_trace",
        phase: "finish",
        callId,
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? "Model call cancelled" : "Model call failed",
      });
    }
    throw error;
  }
}
