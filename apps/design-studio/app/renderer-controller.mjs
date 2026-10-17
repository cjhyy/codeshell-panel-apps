/* Owns one optional GPU surface. The saved design and the SVG editor stay external. */
export function createRendererController({
  canvas,
  assetsBaseUrl = "",
  loadRenderer,
  capability,
  onState = () => {},
  maxGpuZoom = 1,
} = {}) {
  let mode = "svg", document = null, generation = 0, disposed = false;
  let capable, suspended = false, suspensionReason = "editing";
  let lost = false, failure = null, slot = null, loaderPromise = null;
  let wanted = false, pump = null, viewportVersion = 0;
  let viewport = { width: 0, height: 0, dpr: 1, pan: { x: 0, y: 0 }, zoom: 1 };
  let lastState = { mode, active: false, loading: false, fallback: false, reason: "svg", key: null };
  const retired = new WeakSet();
  const isCurrent = (token, target) => !disposed && generation === token && document === target;
  const capabilityAllowed = (value) => value === true ||
    value?.packageAssets?.wasm === true || value?.capabilities?.packageAssets?.wasm === true;
  const validViewport = () => [viewport.width, viewport.height, viewport.dpr, viewport.zoom]
    .every((value) => Number.isFinite(value) && value > 0) &&
    [viewport.pan.x, viewport.pan.y].every(Number.isFinite);

  function blockedReason() {
    if (disposed) return "disposed";
    if (mode !== "gpu") return "svg";
    if (lost) return "context-lost";
    if (failure) return failure;
    if (suspended) return suspensionReason;
    if (!document) return "no-document";
    if (capable !== undefined && !capabilityAllowed(capable)) return "wasm-unavailable";
    if (!validViewport()) return "invalid-viewport";
    if (viewport.zoom > maxGpuZoom) return "zoom-limit";
    return null;
  }

  function publish({ active = false, loading = false, reason = blockedReason(), stats } = {}) {
    // Visibility is granted only by the successful current scene's final draw.
    active = active && !blockedReason();
    loading = Boolean(loading && !blockedReason());
    const next = { mode, active: Boolean(active), loading,
      fallback: mode === "gpu" && !active && !loading,
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
    try { await instance.dispose?.(); } catch { /* A broken surface still falls back to SVG. */ }
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
    return reason === suspensionReason || reason === "zoom-limit" || reason === "invalid-viewport";
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
      if (slot && (!retainWhileHidden(reason) || slot.document !== target)) await clearSlot();
      return;
    }
    if (slot?.ready && !slot.invalid && slot.document === target) {
      await draw(target, token);
      return;
    }
    if (slot) await clearSlot();
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
      if (!isCurrent(token, target) || blockedReason()) { await retire(instance); return; }
      for (const method of ["setScene", "resize", "render", "dispose"])
        if (typeof instance?.[method] !== "function") throw new Error(`GPU renderer has no ${method} method`);
      slot = { instance, document: target, ready: false, drawnVersion: -1 };
      stage = "setScene";
      await instance.setScene(target.design, { resources });
      if (!isCurrent(token, target)) { await clearSlot(); return; }
      slot.ready = true;
      try { slot.stats = instance.stats?.(); } catch { /* Diagnostics are optional. */ }
      await draw(target, token);
    } catch (error) {
      fail(error, token, target, stage);
      if (slot?.instance === instance) await clearSlot();
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
  canvas?.addEventListener?.("webglcontextlost", contextLost);

  return {
    /** Selecting GPU explicitly retries previous failures, including context loss. */
    setMode(next) {
      if (!["svg", "gpu"].includes(next)) throw new Error("Renderer mode must be svg or gpu");
      if (disposed) return Promise.resolve({ ...lastState });
      if (mode !== next || (next === "gpu" && (lost || failure))) {
        const failedResources = next === "gpu" && failure?.startsWith("resources:");
        mode = next; generation += 1;
        if (next === "gpu") {
          lost = false; failure = null;
          if (document && failedResources) document.resourcePromise = null;
        }
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
          // Hide the previous scene before cloning, fetching assets or loading SDKs.
          publish({ reason: "document-changed" });
          try {
            document = input.design === null ? null : { key: input.key, revision: input.revision,
              design: structuredClone(input.design), getResources: input.getResources,
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
    suspend(reason = "editing") {
      if (disposed) return Promise.resolve({ ...lastState });
      suspended = true; suspensionReason = reason;
      publish({ reason });
      return request();
    },
    resume() {
      if (disposed) return Promise.resolve({ ...lastState });
      suspended = false;
      return request();
    },
    state() { return { ...lastState }; },
    dispose() {
      if (!disposed) {
        disposed = true; generation += 1;
        canvas?.removeEventListener?.("webglcontextlost", contextLost);
        publish({ reason: "disposed" });
      }
      return pump ? pump.then(() => ({ ...lastState })) : clearSlot().then(() => ({ ...lastState }));
    },
  };
}
