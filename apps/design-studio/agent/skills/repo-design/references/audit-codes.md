# Design Studio audit codes

Use the returned `pageId`, `pageName`, `nodeId`, blocking state, and message to localize the issue.
Apply the repair for its stable code:

- `layout.canvas-overflow`: move or resize the node inside the canvas.
- `layout.parent-overflow`: compare absolute child and parent edges; when blocking, the child is
  clipped.
- `layout.ancestor-clip-overflow`: a higher frame/component clips through an intermediate group;
  move the node or resize the complete ancestor chain.
- `layout.effect-canvas-overflow`: reduce or move the shadow, or move the node inward so its visible
  stroke, shadow, or instance content stays on the canvas.
- `layout.effect-clip-overflow`: reduce the effect, add inset, enlarge the clipping ancestor, or
  deliberately disable clipping.
- `layout.text-overflow`: increase the text box height or reduce or rewrite the text.
- `layout.text-width-overflow`: widen the text box, add an intentional line break, or shorten the
  copy. Design Studio does not silently auto-wrap fixed text nodes.
- `layout.manual-only-ui`: rebuild normal rows, columns, Wrap, and repeated regions with
  horizontal, vertical, or Grid containers. Keep manual coordinates only for canvas artwork or an
  explicit unsupported-CSS fallback.
- `a11y.text-contrast`: change foreground or background colors; do not dismiss it as cosmetic.
- `a11y.instance-text-contrast`: fix the master's surface, the target background, instance opacity,
  or rendered text size. `nodeId` identifies the instance and `sourceNodeId` its master text layer.
- `content.empty-text`: add intentional copy or remove the placeholder layer.
- `content.invisible-text`: use a visible fill or remove the unnecessary text layer.
