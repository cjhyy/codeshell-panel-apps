/**
 * Table layout post-processor.
 * Converts HTML table elements into Figma-compatible flex layouts.
 *
 * Strategy:
 * - Simple tables (uniform row cell counts, no spanning) → nested flex containers
 *   - <table> → VERTICAL flex container
 *   - <tr> → HORIZONTAL flex container
 *   - <td>/<th> → flex items with fixed widths
 * - Complex tables (rowspan/colspan detected via bounds) → absolute positioning fallback
 */

import type { DesignNode, DesignContainerNode, BoundingBox } from '@html2figma/shared';
import { generateId, unionBounds } from '../utils';

// ── Constants ────────────────────────────────────────────────────────

const TABLE_TAGS = new Set(['table']);
const TABLE_SECTION_TAGS = new Set(['thead', 'tbody', 'tfoot']);
const TABLE_ROW_TAG = 'tr';
const TABLE_CELL_TAGS = new Set(['td', 'th']);

const emptyBorder = {
  top: { width: 0, style: 'none' as const, color: { r: 0, g: 0, b: 0, a: 0 } },
  right: { width: 0, style: 'none' as const, color: { r: 0, g: 0, b: 0, a: 0 } },
  bottom: { width: 0, style: 'none' as const, color: { r: 0, g: 0, b: 0, a: 0 } },
  left: { width: 0, style: 'none' as const, color: { r: 0, g: 0, b: 0, a: 0 } },
  radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
};
const zeroPadding = { top: 0, right: 0, bottom: 0, left: 0 };

// ── Helpers ──────────────────────────────────────────────────────────

function isContainer(node: DesignNode): node is DesignContainerNode {
  return node.nodeType === 'container';
}

function isOutOfFlow(node: DesignNode): boolean {
  return node.positioning?.mode === 'absolute' || node.positioning?.mode === 'fixed';
}

/**
 * Map CSS vertical-align to Figma counterAxisAlignItems value.
 */
function mapVerticalAlign(tag: string, node: DesignContainerNode): string {
  const va = node.layout.verticalAlign;
  if (va === 'middle') return 'center';
  if (va === 'bottom') return 'flex-end';
  return 'flex-start'; // top is default for table cells
}

/**
 * Create a flex wrapper node.
 */
function makeFlexWrapper(
  id: string,
  name: string,
  bounds: BoundingBox,
  children: DesignNode[],
  direction: 'row' | 'column',
  gap: { row: number; column: number },
  alignItems: string = 'stretch',
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
        justifyContent: 'flex-start',
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

/**
 * Collect all <tr> rows from a table, flattening through thead/tbody/tfoot sections.
 */
function collectRows(tableContainer: DesignContainerNode): DesignContainerNode[] {
  const rows: DesignContainerNode[] = [];
  for (const child of tableContainer.children) {
    if (!isContainer(child)) continue;
    if (child.tag === TABLE_ROW_TAG) {
      rows.push(child);
    } else if (TABLE_SECTION_TAGS.has(child.tag)) {
      // Flatten section children (tr elements)
      for (const sectionChild of child.children) {
        if (isContainer(sectionChild) && sectionChild.tag === TABLE_ROW_TAG) {
          rows.push(sectionChild);
        }
      }
    }
  }
  return rows;
}

/**
 * Get cell children from a row.
 */
function getCells(row: DesignContainerNode): DesignNode[] {
  return row.children.filter(c => {
    if (isOutOfFlow(c)) return false;
    // Accept td/th or any flow child within the row
    return true;
  });
}

/**
 * Detect whether a table is "simple" — can be represented by nested flex.
 * Simple: all rows have the same number of cells, no cell spans multiple rows.
 */
function isSimpleTable(rows: DesignContainerNode[]): boolean {
  if (rows.length === 0) return false;

  const cellCounts = rows.map(r => getCells(r).length);
  const firstCount = cellCounts[0];

  // All rows must have the same cell count
  for (const count of cellCounts) {
    if (count !== firstCount) return false;
  }

  // Check for row spanning: a cell that extends into the next row's Y space
  for (let i = 0; i < rows.length - 1; i++) {
    const nextRowY = rows[i + 1].bounds.y;
    const cells = getCells(rows[i]);
    for (const cell of cells) {
      if (cell.bounds.y + cell.bounds.height > nextRowY + 3) return false;
    }
  }

  // Check for column spanning: cells wider than ~1.5× the average column width
  if (firstCount > 0) {
    const avgWidth = rows[0].bounds.width / firstCount;
    for (const row of rows) {
      for (const cell of getCells(row)) {
        if (cell.bounds.width > avgWidth * 1.5) return false;
      }
    }
  }

  return true;
}

// ── Conversion strategies ───────────────────────────────────────────

/**
 * Convert a simple table to nested flex containers.
 */
function convertSimpleTable(
  container: DesignContainerNode,
  rows: DesignContainerNode[],
  spacing: { row: number; column: number },
): void {
  const rowWrappers: DesignNode[] = [];

  // Compute actual row gap from browser-rendered positions (more reliable than
  // border-spacing alone — captures all CSS effects including class-based margins).
  let rowGap = spacing.row;
  if (rows.length >= 2) {
    const gaps: number[] = [];
    for (let i = 0; i < rows.length - 1; i++) {
      const gap = Math.round(rows[i + 1].bounds.y - (rows[i].bounds.y + rows[i].bounds.height));
      if (gap > 0) gaps.push(gap);
    }
    if (gaps.length > 0) {
      // Use the most common gap (mode) to handle minor rounding differences
      rowGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    }
  }

  // Compute actual column gap from browser-rendered cell positions
  let colGap = spacing.column;
  if (rows.length > 0) {
    const firstCells = getCells(rows[0]);
    if (firstCells.length >= 2) {
      const gaps: number[] = [];
      for (let i = 0; i < firstCells.length - 1; i++) {
        const gap = Math.round(firstCells[i + 1].bounds.x - (firstCells[i].bounds.x + firstCells[i].bounds.width));
        if (gap > 0) gaps.push(gap);
      }
      if (gaps.length > 0) {
        colGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      }
    }
  }

  for (const row of rows) {
    const cells = getCells(row);
    const absCells = row.children.filter(isOutOfFlow);

    // Convert each cell: set fixed width, map vertical-align
    for (const cell of cells) {
      if (isContainer(cell) && TABLE_CELL_TAGS.has(cell.tag)) {
        // Map vertical-align to flex alignItems on the cell
        const va = mapVerticalAlign(cell.tag, cell);
        cell.layout.display = 'flex';
        cell.layout.flex = {
          direction: 'column',
          wrap: 'nowrap',
          justifyContent: va === 'center' ? 'center' : va === 'flex-end' ? 'flex-end' : 'flex-start',
          alignItems: 'stretch',
          gap: { row: 0, column: 0 },
        };
      }
    }

    // Convert the row to a horizontal flex container
    row.layout.display = 'flex';
    row.layout.flex = {
      direction: 'row',
      wrap: 'nowrap',
      justifyContent: 'flex-start',
      alignItems: 'stretch',
      gap: { row: 0, column: colGap },
    };
    row.children = [...cells, ...absCells];
    rowWrappers.push(row);
  }

  // Collect any absolute children from the table itself
  const absChildren = container.children.filter(isOutOfFlow);

  // Convert the table to a vertical flex container
  container.layout.display = 'flex';
  container.layout.flex = {
    direction: 'column',
    wrap: 'nowrap',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    gap: { row: rowGap, column: 0 },
  };
  container.children = [...rowWrappers, ...absChildren];
}

/**
 * Convert a complex table to absolute positioning fallback.
 */
function absoluteFallback(
  container: DesignContainerNode,
  rows: DesignContainerNode[],
): void {
  const parentX = container.bounds.x;
  const parentY = container.bounds.y;

  // Flatten all cells from all rows
  const allCells: DesignNode[] = [];
  for (const row of rows) {
    for (const cell of row.children) {
      if (!isOutOfFlow(cell)) {
        cell.positioning = { ...cell.positioning, mode: 'absolute' };
        cell.bounds = {
          ...cell.bounds,
          x: cell.bounds.x - parentX,
          y: cell.bounds.y - parentY,
        };
      }
      allCells.push(cell);
    }
  }

  // Also include any absolute children from the table itself
  const absChildren = container.children.filter(isOutOfFlow);

  container.layout.display = 'block';
  container.children = [...allCells, ...absChildren];
}

// ── Border collapse handling ────────────────────────────────────────

const ZERO_BORDER_SIDE = { width: 0, style: 'none' as const, color: { r: 0, g: 0, b: 0, a: 0 } };

/**
 * Deduplicate borders for border-collapse: collapse tables.
 *
 * CSS collapsed tables share borders between adjacent cells. In Figma,
 * each cell has independent strokes (INSIDE alignment), so adjacent
 * borders appear doubled.
 *
 * Strategy: for each cell, zero out the borders that would overlap with
 * a neighbour — keep only top+left borders, plus right border on the
 * last column and bottom border on the last row.
 */
function deduplicateCollapsedBorders(rows: DesignContainerNode[]): void {
  const totalRows = rows.length;

  for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
    const cells = getCells(rows[rowIdx]);
    const totalCols = cells.length;
    const isLastRow = rowIdx === totalRows - 1;

    for (let colIdx = 0; colIdx < totalCols; colIdx++) {
      const cell = cells[colIdx];
      if (!isContainer(cell)) continue;
      const isLastCol = colIdx === totalCols - 1;

      // Remove right border unless last column
      if (!isLastCol) {
        cell.border = { ...cell.border, right: { ...ZERO_BORDER_SIDE } };
      }
      // Remove bottom border unless last row
      if (!isLastRow) {
        cell.border = { ...cell.border, bottom: { ...ZERO_BORDER_SIDE } };
      }
    }
  }
}

// ── Recursive traversal ─────────────────────────────────────────────

/**
 * Process a single table container.
 */
function processTable(container: DesignContainerNode): void {
  const rows = collectRows(container);
  if (rows.length === 0) return;

  // Get border-spacing from the table's layout info.
  // CSS spec: border-collapse:collapse forces border-spacing to 0.
  const spacing = container.layout.borderCollapse
    ? { row: 0, column: 0 }
    : (container.layout.tableSpacing ?? { row: 0, column: 0 });

  if (isSimpleTable(rows)) {
    convertSimpleTable(container, rows, spacing);
  } else {
    absoluteFallback(container, rows);
  }

  // Deduplicate borders when border-collapse: collapse is active.
  // In CSS, collapsed tables merge adjacent cell borders into single borders.
  // In Figma, each cell has independent strokes, so adjacent borders double up.
  // Fix: keep top+left on each cell; keep right on last column, bottom on last row.
  if (container.layout.borderCollapse) {
    deduplicateCollapsedBorders(rows);
  }
}

// ── Main entry point ────────────────────────────────────────────────

/**
 * Restructure HTML table elements into Figma-compatible flex layouts.
 * Recursively processes all table elements in the DesignNode tree.
 */
export function restructureTable(container: DesignContainerNode): void {
  // Process children first (bottom-up, in case of nested tables)
  for (const child of container.children) {
    if (isContainer(child)) {
      restructureTable(child);
    }
  }

  // Check if this container is a table element
  if (TABLE_TAGS.has(container.tag)) {
    processTable(container);
  }

  // Also handle standalone <tbody>/<thead>/<tfoot> (when converted without <table> wrapper).
  // These contain <tr> children directly — treat them like a table.
  if (TABLE_SECTION_TAGS.has(container.tag)) {
    const rows = container.children.filter(
      c => isContainer(c) && (c as DesignContainerNode).tag === TABLE_ROW_TAG,
    ) as DesignContainerNode[];
    if (rows.length > 0) {
      const spacing = container.layout.tableSpacing ?? { row: 0, column: 0 };
      if (isSimpleTable(rows)) {
        convertSimpleTable(container, rows, spacing);
      } else {
        absoluteFallback(container, rows);
      }
    }
  }
}
