// Opaque-origin Panel sandboxes cannot access localStorage. Host storage remains
// authoritative; this page-lifetime buffer only retains pending input across
// project switches. It must never be described as durable browser persistence.
export function createBrowserDraftStorage(resolveStorage = () => globalThis.localStorage) {
  try {
    const storage = resolveStorage();
    // Some privacy policies allow the getter but deny access to its contents.
    void storage.length;
    return { storage, persistent: true };
  } catch (error) {
    if (error?.name !== "SecurityError") throw error;
    const values = new Map();
    return { persistent: false, storage: {
      get length() { return values.size; },
      key(index) { return [...values.keys()][index] ?? null; },
      getItem(key) { return values.get(String(key)) ?? null; },
      setItem(key, value) { values.set(String(key), String(value)); },
    } };
  }
}
