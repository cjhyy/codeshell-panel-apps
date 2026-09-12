import {
  CaptureRecorder,
  captureError,
  listRecordingDevices,
  type RecordingDevices,
  type RecordingMode,
} from "./recording";
import { escapeHtml as esc, html, icon } from "./icons";
import { button } from "./views";
interface RecordingContext {
  projectId(): string;
  save(blob: Blob, name: string, kind: "audio" | "video"): Promise<void>;
  saved?(): void;
  changed(): void;
  description?(): string;
  saveLabel?(): string;
  toast?(message: string): void;
}
const elapsed = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("已取消倒数", "AbortError"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("已取消倒数", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
export function createRecordingUI(context: RecordingContext) {
  let mode: RecordingMode = "microphone",
    microphoneId = "",
    cameraId = "",
    script = "",
    scrollSpeed = 32;
  let name = "",
    error = "",
    countdown = 0,
    saving = false,
    devicesLoading = false,
    disposed = false,
    prompterRunning = false;
  let originProject = "",
    devices: RecordingDevices = { microphones: [], cameras: [] };
  let countAbort: AbortController | null = null,
    resultUrl = "",
    resultBlob: Blob | null = null,
    raf = 0,
    lastTick = 0;
  let attempt = 0;
  const capture = new CaptureRecorder(() => {
    if (!disposed) context.changed();
  });
  const busy = () =>
    saving ||
    countdown > 0 ||
    ["preparing", "recording", "paused", "stopping"].includes(capture.snapshot.phase);
  const changed = () => {
    if (!disposed) context.changed();
  };
  function setScript(text: string): void {
    if (disposed) throw new Error("录制页面已关闭，无法载入提词稿");
    if (busy()) throw new Error("请先结束当前录制或保存，再载入提词稿");
    if (capture.snapshot.result) throw new Error("这次录制还未保存，请先保存或丢弃，再载入提词稿");
    if (typeof text !== "string" || text.length > 10000)
      throw new Error("提词稿需要是文字，且不超过 10000 字");
    script = text;
    prompterRunning = false;
    lastTick = 0;
    changed();
    const prompter = document.querySelector<HTMLElement>("#recording-prompter");
    if (prompter) prompter.scrollTop = 0;
  }
  function syncResultURL(): void {
    const blob = capture.snapshot.result?.blob ?? null;
    if (blob === resultBlob) return;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultBlob = blob;
    resultUrl = blob ? URL.createObjectURL(blob) : "";
  }
  function tick(now: number): void {
    raf = 0;
    if (disposed) return;
    const snapshot = capture.snapshot;
    const meter = document.querySelector<HTMLElement>("#recording-level");
    if (!meter || (!snapshot.stream && !prompterRunning)) {
      lastTick = 0;
      return;
    }
    if (meter) {
      const level = capture.level();
      meter.style.setProperty("--recording-level", `${Math.round(level * 100)}%`);
      meter.setAttribute("aria-valuenow", String(Math.round(level * 100)));
    }
    const clock = document.querySelector<HTMLElement>("#recording-time");
    if (clock) clock.textContent = elapsed(snapshot.elapsedSeconds);
    const prompter = document.querySelector<HTMLElement>("#recording-prompter");
    if (prompter && prompterRunning && snapshot.phase !== "paused" && lastTick)
      prompter.scrollTop += (scrollSpeed * Math.min(100, now - lastTick)) / 1000;
    lastTick = now;
    raf = requestAnimationFrame(tick);
  }
  function mount(): void {
    if (disposed) return;
    syncResultURL();
    const element = document.querySelector<HTMLMediaElement>("#recording-preview");
    if (element) {
      const snapshot = capture.snapshot;
      if (snapshot.stream) {
        element.muted = true;
        if (element.srcObject !== snapshot.stream) element.srcObject = snapshot.stream;
        void element.play().catch(() => {});
      } else if (resultUrl && element.getAttribute("src") !== resultUrl) {
        element.srcObject = null;
        element.muted = false;
        element.src = resultUrl;
      }
    }
    if (!raf && (capture.snapshot.stream || prompterRunning)) raf = requestAnimationFrame(tick);
  }
  async function refreshDevices(): Promise<void> {
    if (devicesLoading) return;
    devicesLoading = true;
    error = "";
    changed();
    try {
      devices = await listRecordingDevices();
    } catch (reason) {
      error = captureError(reason);
      throw reason;
    } finally {
      devicesLoading = false;
      changed();
    }
  }
  async function prepare(): Promise<void> {
    if (busy()) throw new Error("请先结束当前录制或保存");
    error = "";
    const version = ++attempt;
    originProject = context.projectId();
    await capture.prepare({
      mode,
      microphoneId: microphoneId || undefined,
      cameraId: cameraId || undefined,
    });
    if (version !== attempt) throw new DOMException("录制连接已取消", "AbortError");
    if (disposed || originProject !== context.projectId()) {
      capture.cancelPreview();
      throw new Error("工程已切换，录制设备已释放");
    }
    try {
      devices = await listRecordingDevices();
    } catch {
      /* The stream can still be recorded when labels cannot refresh. */
    }
    changed();
  }
  function cancelCountdown(): void {
    countAbort?.abort();
    countAbort = null;
    countdown = 0;
    prompterRunning = false;
  }
  async function start(): Promise<void> {
    if (busy()) throw new Error("当前录制已在进行");
    if (capture.snapshot.phase !== "preview") await prepare();
    if (disposed || capture.snapshot.phase !== "preview") return;
    const controller = new AbortController();
    countAbort = controller;
    try {
      for (countdown = 3; countdown > 0; countdown--) {
        changed();
        await delay(1000, controller.signal);
        if (capture.snapshot.phase !== "preview") throw new Error("设备已停止，请重新连接后录制");
      }
      if (originProject !== context.projectId()) throw new Error("工程已切换，未开始录制");
      capture.start();
      prompterRunning = Boolean(script.trim());
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        capture.cancelPreview();
        throw reason;
      }
    } finally {
      if (countAbort === controller) countAbort = null;
      countdown = 0;
      changed();
    }
  }
  function input(target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
    if (target.id === "recording-script") {
      script = target.value;
      const content = document.querySelector<HTMLElement>("#recording-prompter-text");
      if (content) content.textContent = script;
      return true;
    }
    if (target.id === "recording-scroll-speed") {
      scrollSpeed = Number(target.value);
      const label = document.querySelector("#recording-scroll-label");
      if (label) label.textContent = `${scrollSpeed} px/s`;
      return true;
    }
    if (target.id === "recording-name") {
      name = target.value;
      return true;
    }
    if (!["recording-mode", "recording-microphone", "recording-camera"].includes(target.id))
      return false;
    if (busy() || capture.snapshot.result) return true;
    attempt++;
    capture.cancelPreview();
    if (target.id === "recording-mode") mode = target.value as RecordingMode;
    if (target.id === "recording-microphone") microphoneId = target.value;
    if (target.id === "recording-camera") cameraId = target.value;
    changed();
    return true;
  }
  function takeName(): string {
    const extension = capture.snapshot.result?.mimeType.includes("mp4")
      ? "mp4"
      : capture.snapshot.result?.mimeType.includes("ogg")
        ? "ogg"
        : "webm";
    const base =
      name.trim() ||
      `${mode === "microphone" ? "口播录音" : mode === "camera" ? "镜头口播" : "屏幕讲解"}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`;
    return `${base.replace(/\.(?:webm|mp4|ogg)$/i, "")}.${extension}`;
  }
  async function action(value: string): Promise<boolean> {
    if (!value.startsWith("rec-")) return false;
    try {
      if (value === "rec-devices") await refreshDevices();
      else if (value === "rec-prepare") await prepare();
      else if (value === "rec-start") await start();
      else if (value === "rec-pause") {
        capture.pause();
        prompterRunning = false;
      } else if (value === "rec-resume") {
        capture.resume();
        prompterRunning = Boolean(script.trim());
      } else if (value === "rec-finish") {
        cancelCountdown();
        await capture.stop();
        prompterRunning = false;
      } else if (value === "rec-stop-preview") {
        attempt++;
        cancelCountdown();
        capture.cancelPreview();
      } else if (value === "rec-retake") {
        cancelCountdown();
        capture.discard();
        syncResultURL();
        await start();
      } else if (value === "rec-discard") {
        cancelCountdown();
        capture.discard();
        syncResultURL();
        error = "";
        prompterRunning = false;
        changed();
      } else if (value === "rec-prompter") {
        prompterRunning = !prompterRunning;
        changed();
      } else if (value === "rec-prompter-reset") {
        const element = document.querySelector("#recording-prompter");
        if (element) element.scrollTop = 0;
      } else if (value === "rec-download") {
        if (!capture.snapshot.result) throw new Error("还没有可下载的录制");
        syncResultURL();
        const anchor = document.createElement("a");
        anchor.href = resultUrl;
        anchor.download = takeName();
        anchor.click();
      } else if (value === "rec-save") {
        if (saving) return true;
        const result = capture.snapshot.result;
        if (!result) throw new Error("请先停止录制并试听结果");
        if (originProject !== context.projectId())
          throw new Error("这份录制属于之前的工程，请下载保留后再切换");
        saving = true;
        changed();
        try {
          await context.save(result.blob, takeName(), result.kind);
          if (originProject !== context.projectId())
            throw new Error("保存期间工程已切换，请检查已保存素材");
          capture.discard();
          syncResultURL();
          context.toast?.("录制已保存到素材库，原始内容保留，可继续转写和剪辑");
        } finally {
          saving = false;
          changed();
        }
        context.saved?.();
      } else return false;
      return true;
    } catch (reason) {
      error = captureError(reason);
      changed();
      throw new Error(error);
    }
  }
  function render(): string {
    syncResultURL();
    const snapshot = capture.snapshot;
    const recording = snapshot.phase === "recording",
      paused = snapshot.phase === "paused",
      preview = snapshot.phase === "preview",
      result = snapshot.result;
    const locked = busy() || Boolean(result);
    const statuses: Record<string, string> = {
      idle: "尚未连接设备",
      preparing: "等待设备授权…",
      preview: "预览就绪，尚未录制",
      recording: "正在录制",
      paused: "已暂停",
      stopping: "正在结束录制…",
      ready: "录制已完成，设备已释放",
      error: "录制未就绪",
    };
    const deviceOptions = (items: { id: string; name: string }[], selected: string) =>
      `<option value="">系统默认</option>${items.map((device) => `<option value="${esc(device.id)}" ${device.id === selected ? "selected" : ""}>${esc(device.name)}</option>`).join("")}`;
    return html`<div class="section-title">
        <h2>录制口播</h2>
        <span class="tiny-badge">RECORD</span>
      </div>
      <p class="section-description">
        ${esc(
          context.description?.() || "用自己的声音讲述。录好后试听、保存，再交给工作台转写和剪辑。",
        )}
      </p>
      <div class="recording-fields">
        <label class="input-label"
          >录制方式<select id="recording-mode" ${locked ? "disabled" : ""}>
            <option value="microphone" ${mode === "microphone" ? "selected" : ""}>
              麦克风 · 录声音
            </option>
            <option value="camera" ${mode === "camera" ? "selected" : ""}>摄像头 + 麦克风</option>
            <option value="screen" ${mode === "screen" ? "selected" : ""}>屏幕 + 麦克风</option>
          </select></label
        >
        <label class="input-label"
          >麦克风<select id="recording-microphone" ${locked ? "disabled" : ""}>
            ${deviceOptions(devices.microphones, microphoneId)}
          </select></label
        >${mode === "camera"
          ? `<label class="input-label">摄像头<select id="recording-camera" ${locked ? "disabled" : ""}>${deviceOptions(devices.cameras, cameraId)}</select></label>`
          : ""}
        ${button(
          "rec-devices",
          devicesLoading ? "正在读取…" : "刷新设备",
          "undo",
          "quiet full",
          locked || devicesLoading,
        )}
      </div>
      <div class="recording-monitor ${recording ? "is-recording" : ""}" aria-label="录制预览">
        ${mode !== "microphone"
          ? `<video id="recording-preview" playsinline ${result ? "controls" : "muted"}></video>`
          : result
            ? '<audio id="recording-preview" controls></audio>'
            : `<div class="recording-mic">${icon("volume", 36)}<span>麦克风电平</span></div>`}${countdown
          ? `<div class="recording-countdown" role="status">${countdown}</div>`
          : ""}
      </div>
      <div class="recording-status">
        <span>${esc(countdown ? "即将开始录制" : statuses[snapshot.phase])}</span
        ><time id="recording-time">${elapsed(snapshot.elapsedSeconds)}</time>
      </div>
      <div
        id="recording-level"
        class="recording-level"
        role="meter"
        aria-label="输入声音电平"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="0"
      >
        <i></i>
      </div>
      ${mode === "screen" && (snapshot.stream || result)
        ? `<p class="small muted">${snapshot.systemAudio ? "已接入麦克风和系统声音。" : "本次共享没有系统音轨，只录制麦克风声音。"}</p>`
        : ""}
      <div class="recording-actions">
        ${result
          ? `${button("rec-retake", "重录", "undo", "", saving)}${button("rec-discard", "丢弃这次录制", "trash", "quiet", saving)}`
          : recording
            ? `${button("rec-pause", "暂停", "pause")}${button("rec-finish", "结束录制", "check", "primary")}`
            : paused
              ? `${button("rec-resume", "继续录制", "play", "primary")}${button("rec-finish", "结束录制", "check")}`
              : countdown
                ? button("rec-stop-preview", "取消倒数", "close", "full")
                : snapshot.phase === "preparing"
                  ? button("rec-stop-preview", "取消连接", "close", "full")
                  : snapshot.phase === "stopping"
                    ? button("rec-finish", "正在结束…", "clock", "full", true)
                    : `${button("rec-prepare", preview ? "重新连接设备" : "连接并检查预览", "film", "full", busy())}${button("rec-start", "3 秒后开始录制", "volume", "primary full", busy())}${preview ? button("rec-stop-preview", "停止预览并释放设备", "close", "quiet full") : ""}`}
      </div>
      ${result
        ? `<label class="input-label recording-name">素材名称<input id="recording-name" maxlength="160" value="${esc(name)}" placeholder="我的口播" ${saving ? "disabled" : ""}/></label><p class="small muted">${elapsed(result.durationSeconds)} · ${(result.blob.size / 1024 / 1024).toFixed(1)} MB · 尚未保存</p>${button("rec-save", saving ? "正在保存…" : esc(context.saveLabel?.() || "保存到素材库"), "check", "primary full", saving)}${button("rec-download", "下载原始录制", "download", "quiet full", saving)}`
        : ""}
      ${error || snapshot.error
        ? `<p class="conflict" role="alert">${esc(error || snapshot.error)}</p>`
        : ""}
      <p class="small muted">
        点击连接或录制后才申请设备权限。最长 20 分钟或 200 MB；暂停时间不计入成片。
      </p>
      <details class="recording-script" ${script.trim() ? "open" : ""}>
        <summary>提词稿与滚动速度</summary>
        <textarea
          id="recording-script"
          rows="5"
          maxlength="10000"
          placeholder="把要讲的要点写在这里，提词器辅助你看稿。"
        >
${esc(script)}</textarea
        ><label class="input-label"
          >滚动速度 <span id="recording-scroll-label">${scrollSpeed} px/s</span
          ><input
            id="recording-scroll-speed"
            type="range"
            min="10"
            max="100"
            step="5"
            value="${scrollSpeed}"
        /></label>
        <div class="recording-actions">
          ${button("rec-prompter", prompterRunning ? "暂停提词" : "滚动提词", "play")}${button(
            "rec-prompter-reset",
            "回到稿件开头",
            "back",
          )}
        </div>
        <div id="recording-prompter" class="recording-prompter" aria-label="提词器">
          <p id="recording-prompter-text">${esc(script)}</p>
        </div>
        ${mode === "screen" ? '<p class="small muted">录屏时请把提词器放在共享区域之外。</p>' : ""}
      </details>`;
  }
  function assertSafeToLeave(): void {
    if (busy()) throw new Error("请先结束当前录制或保存，再切换工程");
    if (capture.snapshot.result)
      throw new Error("这次录制还未保存，请先保存、下载后丢弃，或直接丢弃后切换工程");
    capture.cancelPreview();
  }
  function dispose(): void {
    disposed = true;
    attempt++;
    cancelCountdown();
    capture.dispose();
    cancelAnimationFrame(raf);
    raf = 0;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = "";
    resultBlob = null;
  }
  return {
    render,
    mount,
    input,
    setScript,
    action,
    dispose,
    assertSafeToLeave,
    get busy() {
      return busy();
    },
    get hasUnsavedResult() {
      return Boolean(capture.snapshot.result);
    },
  };
}
