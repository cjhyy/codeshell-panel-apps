export function selectionActivity({ ready, visible, module, backgroundRestored }) {
  const permitted = ready && visible;
  return {
    active: permitted && ["today", "watch"].includes(module),
    backgroundWatch: permitted && backgroundRestored,
  };
}

export function canApplySelectionSource(state) {
  return selectionActivity(state).active;
}
