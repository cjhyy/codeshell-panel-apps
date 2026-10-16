/**
 * Layout Resolver - Extract CSS layout info preserving CSS semantics
 */

import type { LayoutInfo, PositioningInfo, TransformInfo, FlexItemInfo, Spacing } from '@html2figma/shared';
import { parsePx, parseAngle, parseLengthValue, parseTransformOrigin } from '@html2figma/shared/css-utils';
import { parseSpacing, getStyle } from '../utils';

/**
 * Resolve layout info from computed styles
 */
export function resolveLayout(styles: Record<string, string>): LayoutInfo {
  const rawDisplay = getStyle(styles, 'display');
  const display = normalizeDisplay(rawDisplay);

  // Capture text-align for block containers (affects inline child alignment)
  const textAlignVal = getStyle(styles, 'text-align', 'textAlign');
  const textAlign = textAlignVal === 'center' ? 'center'
    : (textAlignVal === 'right' || textAlignVal === 'end') ? 'right'
    : undefined;

  // -webkit-line-clamp on container (display: -webkit-box → normalized to block)
  const lineClampStr = getStyle(styles, '-webkit-line-clamp', 'webkitLineClamp');
  const lineClamp = lineClampStr ? parseInt(lineClampStr, 10) : undefined;
  const hasLineClamp = lineClamp != null && lineClamp > 0;

  // When -webkit-line-clamp is set, the container is display: -webkit-box which is
  // a special block-level truncation mode. Browsers may compute it as 'flex', but it
  // should NOT be treated as a flex container — force to 'block'.
  const effectiveDisplay = hasLineClamp ? 'block' as const : display;

  // Extract table spacing (border-spacing) for table elements
  const tableSpacing = resolveTableSpacing(styles, rawDisplay);

  // border-collapse (only meaningful on table display)
  const borderCollapse = (rawDisplay === 'table' || rawDisplay === 'inline-table')
    && getStyle(styles, 'border-collapse', 'borderCollapse') === 'collapse';

  // Extract vertical-align for table cells
  const verticalAlign = resolveVerticalAlign(styles, rawDisplay);

  return {
    display: effectiveDisplay,
    textAlign,
    lineClamp: hasLineClamp ? lineClamp : undefined,
    verticalAlign,
    flex: resolveFlexInfo(styles, effectiveDisplay),
    grid: resolveGridInfo(styles, effectiveDisplay),
    float: normalizeFloat(getStyle(styles, 'float')),
    clear: normalizeClear(getStyle(styles, 'clear')),
    padding: parseSpacing(styles, 'padding'),
    margin: parseSpacing(styles, 'margin'),
    sizing: resolveSizing(styles),
    tableSpacing,
    borderCollapse: borderCollapse || undefined,
  };
}

/**
 * Resolve positioning info
 */
export function resolvePositioning(styles: Record<string, string>): PositioningInfo {
  const mode = normalizePosition(getStyle(styles, 'position'));
  const result: PositioningInfo = { mode };

  if (mode !== 'static') {
    const offsets: PositioningInfo['offsets'] = {};
    const top = getStyle(styles, 'top');
    const right = getStyle(styles, 'right');
    const bottom = getStyle(styles, 'bottom');
    const left = getStyle(styles, 'left');

    if (top && top !== 'auto') offsets.top = parsePx(top);
    if (right && right !== 'auto') offsets.right = parsePx(right);
    if (bottom && bottom !== 'auto') offsets.bottom = parsePx(bottom);
    if (left && left !== 'auto') offsets.left = parsePx(left);

    if (Object.keys(offsets).length > 0) {
      result.offsets = offsets;
    }
  }

  const zIndex = getStyle(styles, 'z-index', 'zIndex');
  if (zIndex && zIndex !== 'auto') {
    result.zIndex = parseInt(zIndex, 10);
  }

  return result;
}

/**
 * Resolve transform info
 */
export function resolveTransform(
  styles: Record<string, string>,
  boundingRect: { width: number; height: number }
): TransformInfo | undefined {
  const transform = getStyle(styles, 'transform');
  const writingMode = getStyle(styles, 'writing-mode', 'writingMode');

  // writing-mode: vertical-rl/vertical-lr → equivalent to 90° rotation in Figma
  const isVerticalWriting = writingMode === 'vertical-rl' || writingMode === 'vertical-lr';

  if ((!transform || transform === 'none') && !isVerticalWriting) return undefined;

  const result: TransformInfo = {};

  // Apply writing-mode rotation (vertical-rl = CW 90°, vertical-lr = CCW 90°)
  if (isVerticalWriting) {
    result.rotation = writingMode === 'vertical-rl' ? 90 : -90;
    result.writingModeRotation = true;
  }

  // Parse transform functions
  const funcRegex = /(\w+)\(([^)]+)\)/g;
  let match;

  while ((match = funcRegex.exec(transform)) !== null) {
    const fn = match[1];
    const args = match[2].split(',').map(s => s.trim());

    switch (fn) {
      case 'matrix':
        if (args.length === 6) {
          result.matrix = args.map(Number) as [number, number, number, number, number, number];
          // Extract scale from matrix
          const [a, b, c, d] = result.matrix;
          const scaleX = Math.sqrt(a * a + b * b);
          const scaleY = Math.sqrt(c * c + d * d);
          if (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001) {
            result.scale = { x: scaleX, y: scaleY };
          }
          // Extract rotation
          const rotation = Math.atan2(b, a) * (180 / Math.PI);
          if (Math.abs(rotation) > 0.1) {
            result.rotation = rotation;
          }
        }
        break;
      case 'rotate':
        result.rotation = parseAngle(args[0]);
        break;
      case 'scale':
        const sx = parseFloat(args[0]) || 1;
        const sy = args[1] ? parseFloat(args[1]) || 1 : sx;
        result.scale = { x: sx, y: sy };
        break;
      case 'scaleX':
        result.scale = { x: parseFloat(args[0]) || 1, y: result.scale?.y ?? 1 };
        break;
      case 'scaleY':
        result.scale = { x: result.scale?.x ?? 1, y: parseFloat(args[0]) || 1 };
        break;
      case 'translate': {
        const tx = parsePx(args[0]);
        const ty = args[1] ? parsePx(args[1]) : 0;
        result.translate = { x: tx, y: ty };
        break;
      }
      case 'translateX':
        result.translate = { x: parsePx(args[0]), y: result.translate?.y ?? 0 };
        break;
      case 'translateY':
        result.translate = { x: result.translate?.x ?? 0, y: parsePx(args[0]) };
        break;
    }
  }

  // Parse transform-origin
  const originStr = getStyle(styles, 'transform-origin', 'transformOrigin');
  if (originStr) {
    const fakeRect = { left: 0, top: 0, right: boundingRect.width, bottom: boundingRect.height, width: boundingRect.width, height: boundingRect.height } as DOMRect;
    const origin = parseTransformOrigin(originStr, fakeRect);
    result.origin = origin;
  }

  if (Object.keys(result).length === 0) return undefined;
  return result;
}

/**
 * Resolve flex item properties from computed styles.
 * These apply when the element is a child of a flex container.
 */
export function resolveFlexItem(styles: Record<string, string>): FlexItemInfo | undefined {
  const grow = parseFloat(getStyle(styles, 'flex-grow', 'flexGrow') || '0');
  const shrink = parseFloat(getStyle(styles, 'flex-shrink', 'flexShrink') || '1');
  const basisStr = getStyle(styles, 'flex-basis', 'flexBasis') || 'auto';
  const alignSelf = getStyle(styles, 'align-self', 'alignSelf') || undefined;
  const orderStr = getStyle(styles, 'order');
  const order = orderStr ? parseInt(orderStr, 10) : 0;

  const basis: number | 'auto' = basisStr === 'auto' ? 'auto' : parsePx(basisStr);

  // Only return flex item info if there are non-default values
  const isDefault = grow === 0 && shrink === 1 && basis === 'auto'
    && (!alignSelf || alignSelf === 'auto') && order === 0;
  if (isDefault) return undefined;

  return {
    grow,
    shrink,
    basis,
    alignSelf: alignSelf === 'auto' ? undefined : alignSelf,
    order: order !== 0 ? order : undefined,
  };
}

// ==================== Internal helpers ====================

function normalizeDisplay(value: string): LayoutInfo['display'] {
  const map: Record<string, LayoutInfo['display']> = {
    'block': 'block',
    'inline': 'inline',
    'inline-block': 'inline-block',
    'flex': 'flex',
    'inline-flex': 'inline-flex',
    'grid': 'grid',
    'inline-grid': 'inline-grid',
    'none': 'none',
    'list-item': 'block',
    'table': 'block',
    'table-row': 'block',
    'table-cell': 'block',
    '-webkit-box': 'block', // Legacy flexbox used for -webkit-line-clamp text truncation
  };
  return map[value] || 'block';
}

function normalizePosition(value: string): PositioningInfo['mode'] {
  const valid = ['static', 'relative', 'absolute', 'fixed', 'sticky'];
  return valid.includes(value) ? value as PositioningInfo['mode'] : 'static';
}

function normalizeFloat(value: string): LayoutInfo['float'] {
  if (value === 'left' || value === 'right') return value;
  return 'none';
}

function normalizeClear(value: string): LayoutInfo['clear'] {
  if (value === 'left' || value === 'right' || value === 'both') return value;
  return 'none';
}

function resolveFlexInfo(styles: Record<string, string>, display: string): LayoutInfo['flex'] {
  if (display !== 'flex' && display !== 'inline-flex') return undefined;

  const direction = (getStyle(styles, 'flex-direction', 'flexDirection') || 'row') as LayoutInfo['flex'] extends undefined ? never : NonNullable<LayoutInfo['flex']>['direction'];
  const wrap = (getStyle(styles, 'flex-wrap', 'flexWrap') || 'nowrap') as 'nowrap' | 'wrap' | 'wrap-reverse';
  const justifyContent = getStyle(styles, 'justify-content', 'justifyContent') || 'flex-start';
  const alignItems = getStyle(styles, 'align-items', 'alignItems') || 'stretch';
  const alignContent = getStyle(styles, 'align-content', 'alignContent') || undefined;

  const rowGapStr = getStyle(styles, 'row-gap', 'rowGap');
  const colGapStr = getStyle(styles, 'column-gap', 'columnGap');
  const gapStr = getStyle(styles, 'gap');

  let rowGap = 0;
  let colGap = 0;

  if (gapStr && gapStr !== 'normal') {
    const parts = gapStr.split(/\s+/);
    rowGap = parsePx(parts[0]);
    colGap = parts[1] ? parsePx(parts[1]) : rowGap;
  }
  if (rowGapStr && rowGapStr !== 'normal') rowGap = parsePx(rowGapStr);
  if (colGapStr && colGapStr !== 'normal') colGap = parsePx(colGapStr);

  return {
    direction,
    wrap,
    justifyContent,
    alignItems,
    alignContent,
    gap: { row: rowGap, column: colGap },
  };
}

function resolveGridInfo(styles: Record<string, string>, display: string): LayoutInfo['grid'] {
  if (display !== 'grid' && display !== 'inline-grid') return undefined;

  const rowGapStr = getStyle(styles, 'row-gap', 'rowGap');
  const colGapStr = getStyle(styles, 'column-gap', 'columnGap');
  const gapStr = getStyle(styles, 'gap');

  let rowGap = 0;
  let colGap = 0;

  if (gapStr && gapStr !== 'normal') {
    const parts = gapStr.split(/\s+/);
    rowGap = parsePx(parts[0]);
    colGap = parts[1] ? parsePx(parts[1]) : rowGap;
  }
  if (rowGapStr && rowGapStr !== 'normal') rowGap = parsePx(rowGapStr);
  if (colGapStr && colGapStr !== 'normal') colGap = parsePx(colGapStr);

  return {
    templateColumns: getStyle(styles, 'grid-template-columns', 'gridTemplateColumns') || 'none',
    templateRows: getStyle(styles, 'grid-template-rows', 'gridTemplateRows') || 'none',
    gap: { row: rowGap, column: colGap },
    autoFlow: getStyle(styles, 'grid-auto-flow', 'gridAutoFlow') || undefined,
    justifyItems: getStyle(styles, 'justify-items', 'justifyItems') || undefined,
    alignItems: getStyle(styles, 'align-items', 'alignItems') || undefined,
  };
}

function resolveTableSpacing(styles: Record<string, string>, rawDisplay: string): LayoutInfo['tableSpacing'] {
  if (!rawDisplay || !rawDisplay.startsWith('table')) return undefined;
  // border-spacing is only meaningful on 'table' display (not table-row, table-cell)
  if (rawDisplay !== 'table' && rawDisplay !== 'inline-table') return undefined;

  const spacing = getStyle(styles, 'border-spacing', 'borderSpacing');
  if (!spacing) return undefined;

  const parts = spacing.trim().split(/\s+/);
  const column = parsePx(parts[0]);
  const row = parts[1] ? parsePx(parts[1]) : column;
  if (column === 0 && row === 0) return undefined;

  return { row, column };
}

function resolveVerticalAlign(styles: Record<string, string>, rawDisplay: string): LayoutInfo['verticalAlign'] {
  if (rawDisplay !== 'table-cell') return undefined;
  const va = getStyle(styles, 'vertical-align', 'verticalAlign');
  if (va === 'middle') return 'middle';
  if (va === 'bottom') return 'bottom';
  return undefined; // 'top' is the default for table cells, no need to store
}

function resolveSizing(styles: Record<string, string>): LayoutInfo['sizing'] {
  const minWidth = parsePx(getStyle(styles, 'min-width', 'minWidth') || '0');
  const maxWidth = parsePx(getStyle(styles, 'max-width', 'maxWidth') || '0');
  const minHeight = parsePx(getStyle(styles, 'min-height', 'minHeight') || '0');
  const maxHeight = parsePx(getStyle(styles, 'max-height', 'maxHeight') || '0');
  const boxSizing = (getStyle(styles, 'box-sizing', 'boxSizing') || 'content-box') as 'content-box' | 'border-box';

  const hasConstraints = minWidth > 0 || maxWidth > 0 || minHeight > 0 || maxHeight > 0;
  if (!hasConstraints && boxSizing === 'content-box') return undefined;

  return {
    minWidth: minWidth > 0 ? minWidth : undefined,
    maxWidth: maxWidth > 0 ? maxWidth : undefined,
    minHeight: minHeight > 0 ? minHeight : undefined,
    maxHeight: maxHeight > 0 ? maxHeight : undefined,
    boxSizing,
  };
}
