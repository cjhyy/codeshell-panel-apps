// A project epoch opens only after saved navigation has been restored. Modules
// coalesce their own first read, and stale project work never opens the gate.
export function createPanelBootstrap({ currentEpoch }) {
  let openedEpoch = null;
  const loads = new Map();
  const ready = new Set();
  return {
    open(epoch) { if (epoch === currentEpoch()) openedEpoch = epoch; },
    close() { openedEpoch = null; loads.clear(); ready.clear(); },
    isOpen() { return openedEpoch === currentEpoch(); },
    invalidate(name) { const key = `${currentEpoch()}:${name}`; loads.delete(key); ready.delete(key); },
    isReady(name) { return ready.has(`${currentEpoch()}:${name}`); },
    has(name) { return loads.has(`${currentEpoch()}:${name}`); },
    ensure(name, load) {
      if (openedEpoch !== currentEpoch()) return Promise.resolve();
      const key = `${currentEpoch()}:${name}`;
      if (!loads.has(key)) {
        const promise = Promise.resolve().then(load).then(value => { if (loads.get(key) === promise) ready.add(key); return value; })
          .catch(error => { if (loads.get(key) === promise) loads.delete(key); throw error; });
        loads.set(key, promise);
      }
      return loads.get(key);
    },
  };
}
