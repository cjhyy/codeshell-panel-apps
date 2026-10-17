import { normalizeDesignDocument } from "../../apps/design-studio/app/document.mjs";
const engine = new URL(location.href).searchParams.get("engine") || "svg";
const canvas = document.querySelector("canvas");
const stage = document.querySelector("#stage");
const portable = await (await fetch("/fixture.json")).json();
const design = normalizeDesignDocument(portable.document);
const resources = new Map(
  portable.resources.map((r) => {
    const descriptor = design.resources.find((d) => d.id === r.id);
    const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
    return [r.id, { bytes, descriptor, mimeType: descriptor.mime }];
  }),
);
// Load identical resource font families for the DOM reference and text fallback.
for (const r of resources.values())
  if (r.descriptor.kind === "font") {
    const d = r.descriptor;
    const familyFace = new FontFace(d.family, r.bytes, {
      weight: String(d.weight || 400),
      style: d.style || "normal",
    });
    await familyFace.load();
    document.fonts.add(familyFace);
  }
const { createRenderer } = await import(`./${engine}-adapter.mjs`);
const start = performance.now();
const renderer = await createRenderer({ canvas, assetsBaseUrl: `/vendor/${engine}/` });
await renderer.setScene(design, { resources });
renderer.resize(innerWidth, innerHeight, devicePixelRatio);
const viewport = { pan: { x: 0, y: 0 }, zoom: 1 };
let scheduled = 0;
let pendingAt = null;
let lastFrame = null;
let samples = [];
let recording = false;
let frameObserver = [];
const paint = () => {
  scheduled = 0;
  const at = performance.now();
  const interval = lastFrame === null ? null : at - lastFrame;
  lastFrame = at;
  const before = performance.now();
  renderer.render(viewport);
  const cpu = performance.now() - before;
  if (recording)
    samples.push({ at, interval, cpu, inputDelay: pendingAt === null ? null : at - pendingAt });
  pendingAt = null;
};
const schedule = () => {
  pendingAt ??= performance.now();
  if (!scheduled) scheduled = requestAnimationFrame(paint);
};
stage.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (event.ctrlKey) {
      const old = viewport.zoom,
        next = Math.max(0.03, Math.min(4, old * Math.exp(-event.deltaY * 0.002)));
      viewport.pan.x = event.clientX - ((event.clientX - viewport.pan.x) * next) / old;
      viewport.pan.y = event.clientY - ((event.clientY - viewport.pan.y) * next) / old;
      viewport.zoom = next;
    } else {
      viewport.pan.x -= event.deltaX;
      viewport.pan.y -= event.deltaY;
    }
    schedule();
  },
  { passive: false },
);
let drag = null;
stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 1) return;
  drag = { x: event.clientX, y: event.clientY, pan: { ...viewport.pan } };
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener("pointermove", (event) => {
  if (!drag) return;
  viewport.pan.x = drag.pan.x + event.clientX - drag.x;
  viewport.pan.y = drag.pan.y + event.clientY - drag.y;
  schedule();
});
stage.addEventListener("pointerup", () => {
  drag = null;
});
try {
  new PerformanceObserver((list) => {
    if (recording)
      frameObserver.push(
        ...list.getEntries().map((e) => ({ duration: e.duration, start: e.startTime })),
      );
  }).observe({ type: "long-animation-frame", buffered: false });
} catch {}
function summary() {
  const quantile = (values, p) => {
    const a = values.filter(Number.isFinite).sort((a, b) => a - b);
    return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null;
  };
  const intervals = samples.map((s) => s.interval).filter(Number.isFinite);
  return {
    engine,
    frames: samples.length,
    duration: samples.length > 1 ? samples.at(-1).at - samples[0].at : 0,
    intervalP50: quantile(intervals, 0.5),
    intervalP95: quantile(intervals, 0.95),
    intervalP99: quantile(intervals, 0.99),
    frameIntervalsOver25: intervals.filter((v) => v > 25).length,
    frameIntervalsOver50: intervals.filter((v) => v > 50).length,
    renderSubmitP50: quantile(
      samples.map((s) => s.cpu),
      0.5,
    ),
    renderSubmitP95: quantile(
      samples.map((s) => s.cpu),
      0.95,
    ),
    eventToRafP95: quantile(
      samples.map((s) => s.inputDelay),
      0.95,
    ),
    longAnimationFrames: frameObserver,
    stats: renderer.stats(),
    viewport: structuredClone(viewport),
    samples,
  };
}
window.comparison = {
  design,
  renderer,
  initializationMs: performance.now() - start,
  setViewport(value) {
    viewport.pan = { ...value.pan };
    viewport.zoom = value.zoom;
    lastFrame = null;
    paint();
  },
  async run({ frames = 180, kind = "pan", zoom = 0.75, focus = { x: 500, y: 500 } } = {}) {
    this.setViewport({
      pan: { x: innerWidth / 2 - focus.x * zoom, y: innerHeight / 2 - focus.y * zoom },
      zoom,
    });
    // Warm-up before collecting, including shader/image uploads.
    for (let i = 0; i < 40; i++)
      await new Promise((resolve) =>
        requestAnimationFrame(() => {
          renderer.render(viewport);
          resolve();
        }),
      );
    samples = [];
    frameObserver = [];
    lastFrame = null;
    recording = true;
    for (let i = 0; i < frames; i++)
      await new Promise((resolve) =>
        requestAnimationFrame(() => {
          stage.dispatchEvent(
            new WheelEvent("wheel", {
              deltaX: kind === "pan" ? Math.sin(i / 18) * 10 : 0,
              deltaY: kind === "pan" ? Math.cos(i / 23) * 8 : Math.sin(i / 19) * 5,
              ctrlKey: kind === "zoom",
              clientX: innerWidth / 2,
              clientY: innerHeight / 2,
              bubbles: true,
              cancelable: true,
            }),
          );
          resolve();
        }),
      );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    recording = false;
    return summary();
  },
  status() {
    return {
      engine,
      nodeCount: design.nodes.length,
      initializationMs: this.initializationMs,
      stats: renderer.stats(),
      viewport: structuredClone(viewport),
    };
  },
};
window.comparison.setViewport({
  pan: { x: 24, y: 24 },
  zoom: Math.min(
    (innerWidth - 48) / design.canvas.width,
    (innerHeight - 48) / design.canvas.height,
  ),
});
window.ready = true;
