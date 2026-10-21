/* Owns one selected surface; saved design and interaction overlays stay external. */
export function createRendererController({
  canvas,
  assetsBaseUrl = "",
  loadRenderer,
  capability,
  mode = "gpu",
  onState = () => {},
} = {}) {
  if (!["gpu", "browser"].includes(mode)) throw Error("Unknown explicit renderer mode");
  let document = null, generation = 0, disposed = false;
  let capable, suspended = false, suspensionReason = "suspended";
  let lost = false, failure = null, slot = null, loaderPromise = null;
  let wanted = false, pump = null, viewportVersion = 0;
  let viewport = { width: 0, height: 0, dpr: 1, pan: { x: 0, y: 0 }, zoom: 1 };
  let lastState = { mode, status: "loading", active: false, loading: true,
    fallback: false, reason: "initializing", key: null };
  const retired = new WeakSet();
  const isCurrent = (token, target) => !disposed && generation === token && document === target;
  const capabilityAllowed = (value) => mode === "browser" || value === true ||
    value?.packageAssets?.wasm === true || value?.capabilities?.packageAssets?.wasm === true;
  const validViewport = () => [viewport.width, viewport.height, viewport.dpr, viewport.zoom]
    .every((value) => Number.isFinite(value) && value > 0) &&
    [viewport.pan.x, viewport.pan.y].every(Number.isFinite);

  function blockedReason() {
    if (disposed) return "disposed";
    if (lost) return "context-lost";
    if (failure) return failure;
    if (suspended) return suspensionReason;
    if (!document) return "no-document";
    if (capable !== undefined && !capabilityAllowed(capable)) return "wasm-unavailable";
    if (!validViewport()) return "invalid-viewport";
    return null;
  }

  function publish({ active = false, loading = false, reason = blockedReason(), stats } = {}) {
    // Visibility is granted only by the successful current scene's final draw.
    active = active && !blockedReason();
    const status = active ? "active" : disposed ? "disposed" :
      reason === "wasm-unavailable" || reason === "invalid-viewport" ? "unavailable" :
      lost || failure ? "error" : "loading";
    loading = status === "loading";
    const next = { mode, status, active: Boolean(active), loading,
      fallback: false,
      reason: active ? null : reason, key: document?.key ?? null,
      revision: document?.revision ?? null,
      ...(stats !== undefined ? { stats } : {}) };
    const changed = Object.keys(next).some((key) => !Object.is(next[key], lastState[key])) ||
      Object.keys(lastState).some((key) => !Object.hasOwn(next, key));
    lastState = next;
    if (!changed) return { ...next };
    try { onState({ ...next }); } catch { /* UI observers do not own renderer lifetime. */ }
    return { ...next };
  }

  async function retire(instance) {
    if (!instance || !["object", "function"].includes(typeof instance) || retired.has(instance)) return;
    retired.add(instance);
    try { await instance.dispose?.(); } catch { /* A broken surface remains unavailable. */ }
  }
  async function clearSlot() {
    const previous = slot;
    slot = null;
    await retire(previous?.instance);
  }
  function fail(error, token, target, stage) {
    if (!isCurrent(token, target)) return;
    failure = `${stage}: ${error?.message ?? String(error)}`;
    publish({ reason: failure });
  }
  function retainWhileHidden(reason) {
    return reason === suspensionReason || reason === "invalid-viewport";
  }
  function reusableSlot(target = document) {
    return slot && !slot.invalid && !lost && !disposed && target &&
      Object.is(slot.document?.key, target.key);
  }

  async function draw(target, token) {
    while (isCurrent(token, target) && slot?.ready && slot.document === target) {
      const reason = blockedReason();
      if (reason) { publish({ reason }); return; }
      const current = slot, version = viewportVersion;
      if (current.drawnVersion === version) { publish({ active: true, stats: current.stats }); return; }
      const view = { ...viewport, pan: { ...viewport.pan } };
      const size = [view.width, view.height, view.dpr];
      let stage = "resize";
      try {
        if (!current.size || size.some((value, index) => value !== current.size[index])) {
          await current.instance.resize(...size);
          current.size = size;
        }
        if (!isCurrent(token, target) || blockedReason()) return;
        stage = "render";
        await current.instance.render({ pan: view.pan, zoom: view.zoom });
        if (!isCurrent(token, target) || blockedReason()) return;
        if (version !== viewportVersion) continue;
        current.drawnVersion = version;
        publish({ active: true, stats: current.stats });
        return;
      } catch (error) {
        fail(error, token, target, stage);
        await clearSlot();
        return;
      }
    }
  }

  async function reconcile() {
    const target = document, token = generation;
    const reason = blockedReason();
    if (reason) {
      publish({ reason });
      if (slot && (!retainWhileHidden(reason) || !reusableSlot(target))) await clearSlot();
      return;
    }
    if (slot?.ready && !slot.invalid && slot.document === target) {
      await draw(target, token);
      return;
    }
    if (slot && !reusableSlot(target)) await clearSlot();
    if (!isCurrent(token, target)) return;
    publish({ loading: true, reason: "loading" });
    let instance, stage = "capability";
    try {
      const supported = capable !== undefined ? capable :
        await (typeof capability === "function" ? capability() : capability);
      if (!isCurrent(token, target)) return;
      if (!capabilityAllowed(supported)) {
        failure = "wasm-unavailable";
        publish({ reason: failure });
        return;
      }
      stage = "resources";
      if (!target.resourcePromise) target.resourcePromise = Promise.resolve().then(() =>
        target.getResources?.({ key: target.key, revision: target.revision, design: target.design }) ?? new Map());
      const resources = await target.resourcePromise;
      if (!isCurrent(token, target) || blockedReason()) return;
      if (!(resources instanceof Map)) throw new Error("getResources must return a Map");
      instance = slot?.instance;
      if (!instance) {
        stage = "load";
        if (!loaderPromise) loaderPromise = Promise.resolve().then(() => {
          if (typeof loadRenderer !== "function") throw new Error("GPU renderer loader is unavailable");
          return loadRenderer();
        }).catch((error) => { loaderPromise = null; throw error; });
        const loaded = await loaderPromise;
        if (!isCurrent(token, target) || blockedReason()) return;
        stage = "create";
        const create = loaded?.createRenderer ?? (typeof loaded === "function" ? loaded : null);
        if (typeof create !== "function") throw new Error("GPU module has no createRenderer function");
        instance = await create({ canvas, assetsBaseUrl });
        for (const method of ["setScene", "resize", "render", "dispose"])
          if (typeof instance?.[method] !== "function") throw new Error(`GPU renderer has no ${method} method`);
        slot = { instance, document: target, ready: false, drawnVersion: -1 };
        if (!isCurrent(token, target) || blockedReason()) {
          if (!reusableSlot() || (blockedReason() && !retainWhileHidden(blockedReason()))) await clearSlot();
          return;
        }
      }
      slot.document = target;
      slot.ready = false;
      slot.drawnVersion = -1;
      slot.stats = undefined;
      stage = "setScene";
      const accepted = await instance.setScene(target.design, { resources, viewOptions: target.viewOptions });
      if (mode === "browser" && accepted === false) return;
      if (!isCurrent(token, target)) {
        // Content revisions share a healthy surface, but a different document,
        // page, workspace or lost context can never inherit the old surface.
        if (!reusableSlot()) await clearSlot();
        return;
      }
      slot.ready = true;
      try { slot.stats = instance.stats?.(); } catch { /* Diagnostics are optional. */ }
      await draw(target, token);
    } catch (error) {
      const currentFailure = isCurrent(token, target);
      fail(error, token, target, stage);
      if (currentFailure || slot?.instance === instance) await clearSlot();
      else await retire(instance);
    }
  }

  function request() {
    wanted = true;
    if (!pump) pump = Promise.resolve().then(async () => {
      // One async pipeline per canvas prevents an old factory or setScene from
      // finishing after, and clearing, a newer scene on the same GPU surface.
      while (wanted && !disposed) { wanted = false; await reconcile(); }
      if (disposed) await clearSlot();
    }).finally(() => { pump = null; });
    return pump.then(() => ({ ...lastState }));
  }
  function updateViewport(next) {
    if (!next) return;
    const view = { ...viewport, ...next, pan: { ...viewport.pan, ...next.pan } };
    if (["width", "height", "dpr", "zoom"].some((key) => view[key] !== viewport[key]) ||
      view.pan.x !== viewport.pan.x || view.pan.y !== viewport.pan.y) {
      viewport = view;
      viewportVersion += 1;
    }
  }
  const contextLost = (event) => {
    event?.preventDefault?.();
    if (disposed) return;
    lost = true; generation += 1;
    if (slot) slot.invalid = true;
    publish({ reason: "context-lost" });
    void request();
  };
  if (mode === "gpu") canvas?.addEventListener?.("webglcontextlost", contextLost);

  return {
    /** Explicitly retry GPU initialization or a failed/lost surface. */
    setMode(next = "gpu") {
      if (next !== mode) throw new Error(mode === "gpu" ? "Only GPU rendering is supported by this CanvasKit controller" : "Only browser rendering is supported by this browser controller");
      if (disposed) return Promise.resolve({ ...lastState });
      if (lost || failure) {
        const failedResources = failure?.startsWith("resources:");
        generation += 1;
        lost = false; failure = null;
        if (document && failedResources) document.resourcePromise = null;
        publish({ reason: blockedReason() ?? "loading", loading: !blockedReason() });
      }
      return request();
    },
    /** key/revision must change for content, page, workspace or resource changes.
     * A snapshot is captured once at that boundary, never during pan/selection. */
    update(input = {}) {
      if (disposed) return Promise.resolve({ ...lastState });
      updateViewport(input.viewport);
      if (Object.hasOwn(input, "capable")) capable = input.capable;
      if (Object.hasOwn(input, "suspended")) suspended = Boolean(input.suspended);
      if (Object.hasOwn(input, "design")) {
        const changed = !document || !Object.is(input.key, document.key) ||
          !Object.is(input.revision, document.revision) || input.design === null;
        if (changed) {
          generation += 1; failure = null;
          if (mode === "browser") slot?.instance.cancelPreparation?.();
          // Hide the previous scene before cloning, fetching assets or loading SDKs.
          publish({ reason: "document-changed" });
          try {
            document = input.design === null ? null : { key: input.key, revision: input.revision,
              design: structuredClone(input.design), getResources: input.getResources,
              viewOptions: structuredClone(input.viewOptions ?? {}),
              resourcePromise: null };
          } catch (error) {
            document = null; failure = `snapshot: ${error?.message ?? String(error)}`;
          }
        }
      }
      if (blockedReason()) publish({ reason: blockedReason() });
      return request();
    },
    render(next) {
      if (disposed) return Promise.resolve({ ...lastState });
      updateViewport(next);
      if (blockedReason()) publish({ reason: blockedReason() });
      return request();
    },
    suspend(reason = "suspended") {
      if (disposed) return Promise.resolve({ ...lastState });
      suspended = true; suspensionReason = reason;
      if (mode === "browser" && slot && !slot.ready) {
        generation += 1; slot.instance.cancelPreparation?.();
      }
      publish({ reason });
      return request();
    },
    resume() {
      if (disposed) return Promise.resolve({ ...lastState });
      suspended = false;
      return request();
    },
    state() { return { ...lastState }; },
    geometry() { return lastState.active && slot?.ready && slot.document === document ? slot.instance.geometry?.() ?? null : null; },
    hitTest(point) { return lastState.active && slot?.ready && slot.document === document ? slot.instance.hitTest?.(point) ?? null : null; },
    dispose() {
      if (!disposed) {
        disposed = true; generation += 1;
        if (mode === "browser") void retire(slot?.instance);
        if (mode === "gpu") canvas?.removeEventListener?.("webglcontextlost", contextLost);
        publish({ reason: "disposed" });
      }
      return pump ? pump.then(() => ({ ...lastState })) : clearSlot().then(() => ({ ...lastState }));
    },
  };
}
