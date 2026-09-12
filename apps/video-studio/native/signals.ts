/** AbortSignal.any landed after Node 20.0; keep the standalone bundle compatible with Node 20. */
export function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  const abort = () => {
    for (const signal of signals) signal.removeEventListener("abort", abort);
    controller.abort();
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}
