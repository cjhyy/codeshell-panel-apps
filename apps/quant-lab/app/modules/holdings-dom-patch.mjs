// Patch display fields without replacing interactive elements. In particular,
// <details>.open and the focused button survive quote and valuation changes.
export function patchHoldingsNode(target, next) {
  if (target.nodeType === 3) {
    if (target.nodeValue !== next.nodeValue) target.nodeValue = next.nodeValue;
    return target;
  }
  target.className = next.className;
  if (target.dataset && next.dataset) {
    for (const key of Object.keys(target.dataset)) if (!(key in next.dataset)) delete target.dataset[key];
    Object.assign(target.dataset, next.dataset);
  }
  if (target.title !== next.title) target.title = next.title;
  const incoming = Array.from(next.childNodes ?? next.children ?? []);
  if (!incoming.length) {
    if (target.textContent !== next.textContent) target.textContent = next.textContent;
    return target;
  }
  const children = () => Array.from(target.childNodes ?? target.children ?? []);
  const key = (node, index) => node.dataset?.patchKey ?? `${node.nodeType ?? ''}:${node.tagName ?? ''}:${node.className ?? ''}:${index}`;
  const old = new Map(children().map((node, index) => [key(node, index), node]));
  const retained = new Set();
  incoming.forEach((node, index) => {
    const existing = old.get(key(node, index));
    const selected = existing ? patchHoldingsNode(existing, node) : node;
    retained.add(selected);
    if (children()[index] !== selected) {
      if (typeof target.insertBefore === 'function') target.insertBefore(selected, children()[index] ?? null);
      else target.append(selected);
    }
  });
  for (const node of children()) if (!retained.has(node)) node.remove();
  return target;
}
