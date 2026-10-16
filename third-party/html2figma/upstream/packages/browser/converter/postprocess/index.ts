/**
 * Post-processors for DesignNode tree transformation.
 */

export { relativeizeAbsoluteChildren, hoistFixedElements, relativizeAllFlowCoordinates } from './absolutePosition';
export { tryMergeInlineTextRun, extractTextSegments, type TextSegmentInfo, type RichTextContext } from './richText';
export { groupInlineChildren, isInlineNode, createInlineRunWrapper, applyInlineGaps } from './inlineGroup';
export { collapseMargins } from './marginCollapse';
export { sortByStackingOrder, createsStackingContext } from './stackingOrder';
export { restructureGrid } from './gridLayout';
export { restructureTable } from './tableLayout';
export { detectFloatContainer, adjustFloatSiblings } from './floatLayout';
export { expandCollapsedContainers } from './expandCollapsed';
