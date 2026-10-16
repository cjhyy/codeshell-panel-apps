/**
 * FigmaAdapter - Main adapter for DesignNode → Figma conversion
 */

import type { DesignNode } from '@html2figma/shared';
import type { FigmaNode } from '@html2figma/shared';
import { mapDesignNodeToFigma } from './nodeMapper';

export class FigmaAdapter {
  /**
   * Convert DesignNode DSL → FigmaNode JSON
   *
   * Produces a pure JSON tree that can be:
   * 1. Sent to the Figma plugin for rendering
   * 2. Serialized for storage/transmission
   * 3. Used for testing and comparison
   */
  static toFigmaJSON(designNode: DesignNode): FigmaNode {
    return mapDesignNodeToFigma(designNode);
  }
}
