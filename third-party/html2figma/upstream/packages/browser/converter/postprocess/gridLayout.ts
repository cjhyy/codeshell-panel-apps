/**
 * Grid layout post-processor.
 * Converts CSS Grid containers into Figma-compatible layouts.
 *
 * Strategy:
 * - Simple grids (uniform rows, no spanning) → nested flex containers with cell wrappers
 * - Complex grids (spanning, named areas, irregular layout) → absolute positioning
 *   (browser already computed exact positions for every child)
 */

import type { DesignNode, DesignContainerNode, BoundingBox } from '@html2figma/shared';
import { generateId, unionBounds } from '../utils';

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Parse grid-template-columns/rows (computed style returns resolved pixel values
 * like "200px 200px 200px") and return the widths/heights array.
 */
function parseTrackSizes(template: string): number[] {
  if (!template || template === 'none') return [];
  return template.trim().split(/\s+/).map(v => parseFloat(v));
}

/**
 * Group flow children by Y-coordinate into visual rows.
 * Children within 3px of the same Y are in the same row.
 * Returns rows sorted top-to-bottom, children sorted left-to-right within each row.
 */
function groupChildrenIntoRows(children: DesignNode[]): DesignNode[][] {
  if (children.length === 0) return [];

  const sorted = [...children].sort(
    (a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x,
  );

  const rows: DesignNode[][] = [];
  let currentRowY = sorted[0].bounds.y;
  let currentRow: DesignNode[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const child = sorted[i];
    if (Math.abs(child.bounds.y - currentRowY) <= 3) {
      currentRow.push(child);
    } else {
      rows.push(currentRow);
      currentRow = [child];
      currentRowY = child.bounds.y;
    }
  }
  rows.push(currentRow);
  return rows;
}

/**
 * Detect whether a grid layout is "simple" — can be represented by nested flex.
 * A simple grid has:
 * - Uniform row sizes (every non-last row has exactly columnCount children)
 * - No column spanning (no child wider than the largest column)
 * - No row spanning (no child extends into the next row's Y space)
 */
function isSimpleGrid(
  flowChildren: DesignNode[],
  columnCount: number,
  colWidths: number[],
): boolean {
  const rows = groupChildrenIntoRows(flowChildren);
  const maxColWidth = Math.max(...colWidths);

  for (let i = 0; i < rows.length; i++) {
    const isLastRow = i === rows.length - 1;
    const count = rows[i].length;
    // Every row except the last must have exactly columnCount children
    if (!isLastRow && count !== columnCount) return false;
    // No row should exceed the column count
    if (count > columnCount) return false;

    // Column spanning: any child wider than ~1.3× the largest column width
    for (const child of rows[i]) {
      if (child.bounds.width > maxColWidth * 1.3) return false;
    }

    // Row spanning: child extends beyond the next row's start Y
    if (!isLastRow && i + 1 < rows.length) {
      const nextRowY = rows[i + 1][0].bounds.y;
      for (const child of rows[i]) {
        if (child.bounds.y + child.bounds.height > nextRowY + 3) return false;
      }
    }
  }
  return true;
}

// ── Map CSS alignment to Figma ──────────────────────────────────────

function mapJustifyItems(value?: string): string {
  switch (value) {
    case 'center': return 'center';
    case 'end': case 'flex-end': case 'right': return 'flex-end';
    case 'start': case 'flex-start': case 'left': return 'flex-start';
    default: return 'stretch'; // CSS default for justify-items
  }
}

function mapAlignItems(value?: string): string {
  switch (value) {
    case 'center': return 'center';
    case 'end': case 'flex-end': return 'flex-end';
    case 'start': case 'flex-start': return 'flex-start';
    default: return 'stretch'; // CSS default for align-items
  }
}

// ── Empty node template ─────────────────────────────────────────────

const emptyBorder = {
  top: { width: 0, style: 'none' as const, color: { r: 0, g: 0, b: 0, a: 0 } },
  right: { width: 0, style: 'none' as const, color: { r: 0, g: 0, b: 0, a: 0 } },
  bottom: { width: 0, style: 'none' as const, color: { r: 0, g: 0, b: 0, a: 0 } },
  left: { width: 0, style: 'none' as const, color: { r: 0, g: 0, b: 0, a: 0 } },
  radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
};
const zeroPadding = { top: 0, right: 0, bottom: 0, left: 0 };

function makeWrapper(
  id: string,
  name: string,
  bounds: BoundingBox,
  children: DesignNode[],
  direction: 'row' | 'column',
  justifyContent: string,
  alignItems: string,
  gap: { row: number; column: number },
): DesignContainerNode {
  return {
    id,
    name,
    tag: 'div',
    role: 'container',
    nodeType: 'container',
    bounds,
    visible: true,
    opacity: 1,
    positioning: { mode: 'static' },
    children,
    layout: {
      display: 'flex',
      flex: {
        direction,
        wrap: 'nowrap',
        justifyContent,
        alignItems,
        gap,
      },
      padding: zeroPadding,
      margin: zeroPadding,
    },
    background: { layers: [] },
    border: emptyBorder,
    effects: { boxShadows: [] },
    overflow: 'visible',
  };
}

// ── Absolute fallback (complex grids) ───────────────────────────────

/**
 * Convert a complex grid to absolute positioning.
 * Children retain their browser-computed bounds (converted to parent-relative).
 */
function absoluteFallback(
  container: DesignContainerNode,
  flowChildren: DesignNode[],
  absoluteChildren: DesignNode[],
): void {
  const parentX = container.bounds.x;
  const parentY = container.bounds.y;

  for (const child of flowChildren) {
    child.positioning = { ...child.positioning, mode: 'absolute' };
    child.bounds = {
      ...child.bounds,
      x: child.bounds.x - parentX,
      y: child.bounds.y - parentY,
    };
  }

  // Container becomes a plain block (VERTICAL auto-layout in Figma);
  // all children are absolute-positioned so layout mode doesn't affect them.
  container.layout.display = 'block';
  container.layout.grid = undefined;
  container.children = [...flowChildren, ...absoluteChildren];
}

// ── Cell wrapper (handles justify-items / align-items) ──────────────

/**
 * Create a grid-cell wrapper for a single grid child.
 * The cell has the explicit column width and row height, with alignment.
 */
function createGridCell(
  child: DesignNode,
  cellWidth: number,
  cellHeight: number,
  justifyItems: string,
  alignItems: string,
): DesignContainerNode {
  // Floor cell dimensions to prevent rounding overflow.
  // The adapter rounds all bounds with Math.round; fractional column widths like
  // 335.5px would round UP to 336px, and multiple cells can then exceed the
  // container content width (e.g. 336+336+15=687 > 686), causing Figma wrapping.
  const flooredWidth = Math.floor(cellWidth);
  const flooredHeight = Math.floor(cellHeight);

  const isStretchH = justifyItems === 'stretch';
  const isStretchV = alignItems === 'stretch';

  // If stretching in both axes, no need for cell wrapper — just resize child
  if (isStretchH && isStretchV) {
    // Expand child to fill the cell
    child.bounds = { ...child.bounds, width: flooredWidth, height: flooredHeight };
    return child as DesignContainerNode; // pass through (caller handles)
  }

  // Create cell wrapper with alignment
  const cellBounds: BoundingBox = {
    x: child.bounds.x,
    y: child.bounds.y,
    width: flooredWidth,
    height: flooredHeight,
  };

  // For stretch in one axis, resize child in that axis
  if (isStretchH) {
    child.bounds = { ...child.bounds, width: flooredWidth };
  }
  if (isStretchV) {
    child.bounds = { ...child.bounds, height: flooredHeight };
  }

  return makeWrapper(
    generateId('grid-cell'),
    'grid-cell',
    cellBounds,
    [child],
    'row', // horizontal direction for justify-items mapping
    justifyItems,
    alignItems,
    { row: 0, column: 0 },
  );
}

// ── Row wrapper ─────────────────────────────────────────────────────

function createGridRowWrapper(
  children: DesignNode[],
  colWidths: number[],
  rowHeight: number,
  columnGap: number,
  justifyItems: string,
  alignItems: string,
): DesignContainerNode {
  // Wrap each child in a grid-cell with explicit column width and row height
  const cells: DesignNode[] = [];
  for (let i = 0; i < children.length; i++) {
    const cellWidth = colWidths[i] ?? colWidths[colWidths.length - 1] ?? children[i].bounds.width;
    const cell = createGridCell(children[i], cellWidth, rowHeight, justifyItems, alignItems);
    cells.push(cell);
  }

  // Compute row bounds from cells
  const rowWidth = colWidths.slice(0, children.length).reduce((a, b) => a + b, 0)
    + Math.max(0, children.length - 1) * columnGap;
  const rowBounds: BoundingBox = {
    x: cells[0]?.bounds.x ?? 0,
    y: cells[0]?.bounds.y ?? 0,
    width: rowWidth,
    height: rowHeight,
  };

  return makeWrapper(
    generateId('grid-row'),
    'grid-row',
    rowBounds,
    cells,
    'row',
    'flex-start',
    'stretch',
    { row: 0, column: columnGap },
  );
}

// ── Conversion strategies ───────────────────────────────────────────

function convertToFlexRow(
  container: DesignContainerNode,
  flowChildren: DesignNode[],
  absoluteChildren: DesignNode[],
  colWidths: number[],
  rowHeight: number,
  columnGap: number,
  justifyItems: string,
  alignItems: string,
): void {
  // Wrap each child in a grid-cell
  const cells: DesignNode[] = [];
  for (let i = 0; i < flowChildren.length; i++) {
    const cellWidth = colWidths[i] ?? colWidths[colWidths.length - 1] ?? flowChildren[i].bounds.width;
    const cell = createGridCell(flowChildren[i], cellWidth, rowHeight, justifyItems, alignItems);
    cells.push(cell);
  }

  container.layout.display = 'flex';
  container.layout.flex = {
    direction: 'row',
    wrap: 'nowrap',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    gap: { row: 0, column: columnGap },
  };
  container.layout.grid = undefined;
  container.children = [...cells, ...absoluteChildren];
}

function convertToFlexColumn(
  container: DesignContainerNode,
  flowChildren: DesignNode[],
  absoluteChildren: DesignNode[],
  rowGap: number,
): void {
  container.layout.display = 'flex';
  container.layout.flex = {
    direction: 'column',
    wrap: 'nowrap',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    gap: { row: rowGap, column: 0 },
  };
  container.layout.grid = undefined;
  container.children = [...flowChildren, ...absoluteChildren];
}

function convertToNestedFlex(
  container: DesignContainerNode,
  flowChildren: DesignNode[],
  absoluteChildren: DesignNode[],
  columnCount: number,
  colWidths: number[],
  rowHeights: number[],
  rowGap: number,
  columnGap: number,
  justifyItems: string,
  alignItems: string,
): void {
  const rows: DesignNode[][] = [];
  for (let i = 0; i < flowChildren.length; i += columnCount) {
    rows.push(flowChildren.slice(i, i + columnCount));
  }

  const rowWrappers = rows.map((row, rowIdx) => {
    const rowHeight = rowHeights[rowIdx] ?? rowHeights[rowHeights.length - 1] ?? unionBounds(row).height;
    return createGridRowWrapper(row, colWidths, rowHeight, columnGap, justifyItems, alignItems);
  });

  container.layout.display = 'flex';
  container.layout.flex = {
    direction: 'column',
    wrap: 'nowrap',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    gap: { row: rowGap, column: 0 },
  };
  container.layout.grid = undefined;
  container.children = [...rowWrappers, ...absoluteChildren];
}

// ── Main entry point ────────────────────────────────────────────────

/**
 * Restructure a CSS Grid container for Figma.
 *
 * Simple grids → nested flex containers with cell wrappers
 * Complex grids (spanning, named areas) → absolute positioning
 */
export function restructureGrid(container: DesignContainerNode): void {
  const display = container.layout.display;
  if (display !== 'grid' && display !== 'inline-grid') return;
  if (!container.children.length) return;

  const templateColumns = container.layout.grid?.templateColumns;
  if (!templateColumns || templateColumns === 'none') return;

  const colWidths = parseTrackSizes(templateColumns);
  const columnCount = colWidths.length;
  if (columnCount === 0) return;

  const templateRows = container.layout.grid?.templateRows ?? 'none';
  const rowHeights = parseTrackSizes(templateRows);

  const rowGap = container.layout.grid?.gap.row ?? 0;
  const columnGap = container.layout.grid?.gap.column ?? 0;

  const justifyItems = mapJustifyItems(container.layout.grid?.justifyItems);
  const alignItems = mapAlignItems(container.layout.grid?.alignItems);

  // Separate already-absolute/fixed children (don't participate in grid flow)
  const isOutOfFlow = (c: DesignNode) =>
    c.positioning?.mode === 'absolute' || c.positioning?.mode === 'fixed';
  const absoluteChildren = container.children.filter(isOutOfFlow);
  const flowChildren = container.children.filter(c => !isOutOfFlow(c));

  if (flowChildren.length === 0) return;

  // ── Complex grid detection ──
  if (!isSimpleGrid(flowChildren, columnCount, colWidths)) {
    absoluteFallback(container, flowChildren, absoluteChildren);
    return;
  }

  // ── Simple grid → nested flex ──

  // Single-column → flex-column (no cell wrappers needed)
  if (columnCount === 1) {
    convertToFlexColumn(container, flowChildren, absoluteChildren, rowGap);
    return;
  }

  // Single-row (children fit in one row) → direct flex-row with cells
  if (flowChildren.length <= columnCount) {
    const rowHeight = rowHeights[0] ?? unionBounds(flowChildren).height;
    convertToFlexRow(container, flowChildren, absoluteChildren, colWidths, rowHeight, columnGap, justifyItems, alignItems);
    return;
  }

  // Multi-row → nested flex (column of row wrappers with cells)
  convertToNestedFlex(
    container, flowChildren, absoluteChildren,
    columnCount, colWidths, rowHeights,
    rowGap, columnGap, justifyItems, alignItems,
  );
}
