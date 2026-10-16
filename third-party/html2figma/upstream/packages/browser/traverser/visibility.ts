/**
 * NodeTraverserCore 工具函数
 */

/**
 * 检查文本节点是否有有效内容
 */
export function hasValidTextContent(textNode: Text, preserveWhitespace: boolean): boolean {
  const content = textNode.textContent || '';
  
  if (preserveWhitespace) {
    return content.length > 0;
  }
  
  // 不保留空白时，检查是否只有空白字符
  return content.trim().length > 0;
}

/**
 * 检查元素是否可见（是否参与布局）
 *
 * CSS visibility semantics:
 * - `display: none`       → no layout, no rendering  → invisible (skip)
 * - `visibility: hidden`  → occupies layout space, not rendered → visible for layout
 * - `opacity: 0`          → occupies layout space, rendered transparent → visible for layout
 *
 * Only `display: none` truly removes the element from layout flow.
 * `visibility: hidden` and `opacity: 0` still occupy space and must be
 * preserved in the tree (with opacity: 0 in output) so Figma auto-layout
 * keeps the correct spacing.
 */
export function isElementVisible(element: Element, computedStyle: CSSStyleDeclaration): boolean {
  // Only display:none removes from layout flow
  if (computedStyle.display === 'none') {
    return false;
  }

  return true;
}

