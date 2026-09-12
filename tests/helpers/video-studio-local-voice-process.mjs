/**
 * Browser-only fake of the generic Host process and binary-media boundary.
 * The production local-voice bridge, job journal, publication and UI remain real.
 * Model execution is deliberately simulated; audio playback uses each suite's MP3 fixture.
 * Install as a Playwright init script. The setter handles either init-script order.
 */
export function installLocalVoiceProcessMock(options = {}) {
  const settings = {
    installed: false,
    durationSeconds: 24,
    outputAssetId: "asset-" + "b".repeat(64),
    ...options,
  };
  const stateKey = "local-voice-process-test-installed";
  let installed = localStorage.getItem(stateKey) === "yes" || settings.installed;
  const processes = new Map(), listeners = new Map(), uploads = new Map();
  const output = new Uint8Array(96);
  const encode = (bytes) => btoa(String.fromCharCode(...bytes));
  window.__voiceRuntimeRequests = [];
  window.__voiceProcessCalls = [];
  const emit = (event, payload) => {
    for (const listener of listeners.get(event) || []) listener(structuredClone(payload));
  };
  const exit = (id, result, error = "", native = true) => {
    if (!processes.has(id)) throw Error("No running simulated process " + id);
    const line = JSON.stringify(native
      ? error ? { type: "error", message: error } : { type: "result", result }
      : result) + "\n";
    // Real process events can split anywhere, including inside a JSON object.
    const middle = Math.floor(line.length / 2);
    emit("process.output", { processId: id, stream: "stdout", text: line.slice(0, middle) });
    emit("process.output", { processId: id, stream: "stdout", text: line.slice(middle) });
    processes.delete(id);
    emit("process.exit", { processId: id, code: error ? 1 : 0, signal: null });
  };
  window.__completeLocalVoice = (action, error = "") => {
    const entry = [...processes].find(([, process]) => process.request?.action === action);
    if (!entry) throw Error("No running local voice action " + action);
    const [id, { request }] = entry;
    if (!error && action === "setup") {
      installed = true; localStorage.setItem(stateKey, "yes");
    }
    exit(id, action === "setup"
      ? { providerId: request.engine, available: true, state: "ready" }
      : { file: "output.wav", bytes: output.length, durationSeconds: settings.durationSeconds, sampleRate: 48000, channels: 1 }, error);
  };
  function wrap(raw) {
    if (!raw || raw.__localVoiceMock) return raw;
    return {
      ...raw,
      __localVoiceMock: true,
      on(event, listener) {
        if (!event.startsWith("process.")) return raw.on(event, listener);
        const set = listeners.get(event) || new Set(); set.add(listener); listeners.set(event, set);
        return () => set.delete(listener);
      },
      async call(method, args = {}) {
        if (method === "media.status") return { ...await raw.call(method, args), assetRead: { available: true, maxChunkBytes: 32768 } };
        if (method.startsWith("process.") || method === "filesystem.getKnownDirectory" || method === "media.assets.read" || method.startsWith("media.recording."))
          window.__voiceProcessCalls.push({ method, args: structuredClone(args) });
        if (method === "process.find") return { available: true, name: args.name, handle: "node-handle" };
        if (method === "filesystem.getKnownDirectory") return { handle: "voice-data-handle", name: "video-studio" };
        if (method === "process.spawn") {
          if (args.executableHandle !== "node-handle" || args.directoryHandle !== "voice-data-handle") throw Error("Missing generic process grants");
          const id = "process-" + crypto.randomUUID();
          const [, , code, ...values] = args.args;
          if (code.includes("const [raw, ...chunks]")) {
            const request = JSON.parse(values[0]);
            processes.set(id, { io: request });
            let result = {};
            if (request.kind === "tool" && request.action === "check") result = { valid: true };
            else if (request.action === "read") result = { dataBase64: encode(output.subarray(request.offset)), bytes: output.length, offset: request.offset, eof: true };
            exit(id, result, "", false);
          } else if (code.includes("await module.runCli")) {
            const request = JSON.parse(values.slice(1).join(""));
            processes.set(id, { request });
            window.__voiceRuntimeRequests.push(structuredClone(request));
            if (request.action === "status") exit(id, { available: installed, state: installed ? "ready" : "not-installed", reason: installed ? undefined : "本地声音引擎尚未安装" });
          } else throw Error("Unknown simulated Node entry");
          return { processId: id, executable: "node" };
        }
        if (method === "process.cancel") {
          if (processes.delete(args.processId)) emit("process.exit", { processId: args.processId, code: null, signal: "SIGTERM" });
          return { cancelled: true };
        }
        if (method === "media.assets.read") return { assetId: args.assetId, offset: args.offset, totalBytes: 16, dataBase64: encode(new Uint8Array(16)), mimeType: "audio/mpeg", eof: true };
        if (method === "media.recording.begin") {
          const sessionId = "upload-" + crypto.randomUUID(); uploads.set(sessionId, { offset: 0, sequence: 0, expected: args.expectedBytes });
          return { sessionId, maxChunkBytes: 32768 };
        }
        if (method === "media.recording.write") {
          const upload = uploads.get(args.sessionId);
          if (!upload || upload.offset !== args.offset || upload.sequence !== args.sequence) throw Error("Invalid simulated recording chunk order");
          upload.offset += atob(args.dataBase64).length; upload.sequence++;
          return { receivedBytes: upload.offset };
        }
        if (method === "media.recording.finish") {
          const upload = uploads.get(args.sessionId);
          if (!upload || upload.offset !== upload.expected) throw Error("Incomplete simulated recording");
          uploads.delete(args.sessionId);
          return { asset: { id: settings.outputAssetId, name: "本人声音真实试听.wav", mimeType: "audio/wav", bytes: output.length, createdAt: Date.now() },
            inspection: { kind: "audio", durationSeconds: settings.durationSeconds, audio: { sampleRate: 48000, channels: 1 } } };
        }
        if (method === "media.recording.cancel") { uploads.delete(args.sessionId); return { cancelled: true }; }
        return raw.call(method, args);
      },
    };
  }
  let bridge = wrap(window.codeshellPanel);
  Object.defineProperty(window, "codeshellPanel", { configurable: true, get: () => bridge, set: (value) => { bridge = wrap(value); } });
}
