// Figma-specific types for node structures, paints, effects, and related utilities

// Layout positioning for element positioning (replaces constraints)
export type LayoutPositioning = 'AUTO' | 'ABSOLUTE';

export interface FigmaNodeBase {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  blendMode?: string;
  layoutPositioning?: LayoutPositioning;
  position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  // Additional base properties from Figma API
  constraints?: { horizontal: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE'; vertical: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE' };
  constrainProportions?: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  // Auto-layout child properties
  layoutAlign?: 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
  layoutGrow?: number;

  /** Semantic metadata persisted via sharedPluginData for round-trip mapping */
  sharedPluginData?: SharedPluginDataMap;
}

/** Semantic data stored in Figma sharedPluginData under namespace 'html2figma' */
export interface SharedPluginDataMap {
  /** Stable semantic ID for diff/mapping */
  semanticId?: string;
  /** Original HTML tag name */
  tag?: string;
  /** Semantic role */
  role?: string;
  /** CSS class list (JSON array) */
  classList?: string;
  /** Best-match CSS selector */
  cssSelector?: string;
  /** Component info (JSON) */
  component?: string;
  /** Source location (JSON) */
  sourceLocation?: string;
  /** HTML attributes (JSON) */
  attributes?: string;
}

export interface FigmaRectangleNode extends FigmaNodeBase {
  type: 'RECTANGLE';
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  strokeDashPattern?: number[];
  cornerRadius?: number;
  effects?: Effect[];
}

export interface FigmaTextNode extends FigmaNodeBase {
  type: 'TEXT';
  characters: string;
  fontSize?: number;
  fontName?: FontName;
  fontWeight?: number | string;
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  fills?: Paint[];
  lineHeight?: LineHeight;
  letterSpacing?: LetterSpacing;
  // Text auto-resize behavior
  textAutoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT';
  // Text truncation behavior
  textTruncation?: 'DISABLED' | 'ENDING';
  maxLines?: number;
  // Auto Layout sizing properties
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  // Auto-layout positioning for child elements
  layoutAlign?: 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
  layoutGrow?: number;
  // Figma native list options (ORDERED = 1. 2. 3., UNORDERED = • • •)
  listOptions?: { type: 'ORDERED' | 'UNORDERED' | 'NONE' };
  // Rich text: per-range style overrides (for mixed-style text like "<b>bold</b> normal")
  // Plugin uses these to call setRangeFontName, setRangeFills, etc.
  styledTextSegments?: FigmaStyledTextSegment[];
}

/** Styled text segment for per-range styling in Figma text nodes */
export interface FigmaStyledTextSegment {
  /** Start character offset (inclusive) */
  start: number;
  /** End character offset (exclusive) */
  end: number;
  /** Font name override for this range */
  fontName?: FontName;
  /** Font size override */
  fontSize?: number;
  /** Font weight override */
  fontWeight?: number | string;
  /** Fill (color) override */
  fills?: Paint[];
  /** Text decoration override */
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  /** Line height override */
  lineHeight?: LineHeight;
  /** Letter spacing override */
  letterSpacing?: LetterSpacing;
  /** Link URL (for hyperlinks) */
  hyperlink?: { type: 'URL'; value: string };
}

export interface FigmaFrameNode extends FigmaNodeBase {
  type: 'FRAME';
  children: FigmaNode[];
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  strokeDashPattern?: number[];
  cornerRadius?: number;
  clipsContent?: boolean;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE';
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  // Auto Layout sizing properties
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  effects?: Effect[];
  // Additional auto-layout properties from Figma API
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  counterAxisSpacing?: number;
  counterAxisAlignContent?: 'AUTO' | 'SPACE_BETWEEN';
  strokesIncludedInLayout?: boolean;
  layoutGrow?: number;
  layoutAlign?: 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
}

export interface FigmaGroupNode extends FigmaNodeBase {
  type: 'GROUP';
  children: FigmaNode[];
}

export interface FigmaImageNode extends FigmaNodeBase {
  type: 'RECTANGLE'; // Images are represented as rectangles with image fills
  fills: ImagePaint[];
}

export interface FigmaSVGNode extends FigmaNodeBase {
  type: 'SVG';
  svgContent: string;
  fills?: Paint[];
  strokes?: Paint[];
  effects?: Effect[];
  blendMode?: BlendMode;
}

export type FigmaNode =
  | FigmaRectangleNode
  | FigmaTextNode
  | FigmaFrameNode
  | FigmaGroupNode
  | FigmaImageNode
  | FigmaSVGNode;

// Paint types
export interface SolidPaint {
  type: 'SOLID';
  color: RGB;
  opacity?: number;
  visible?: boolean;
}

export interface GradientPaint {
  type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND';
  gradientStops: ColorStop[];
  gradientTransform?: Transform;
  opacity?: number;
  visible?: boolean;
}

export interface ImagePaint {
  type: 'IMAGE';
  imageHash?: string;
  scaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE';
  imageTransform?: Transform;
  scalingFactor?: number;
  rotation?: number;
  filters?: ImageFilters;
  opacity?: number;
  visible?: boolean;
}

export type Paint = SolidPaint | GradientPaint | ImagePaint;

// Supporting types
export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ColorStop {
  position: number;
  color: RGBA;
}

export interface RGBA extends RGB {
  a: number;
}

export interface FontName {
  family: string;
  style: string;
}

export interface LineHeight {
  value: number;
  unit: 'PIXELS' | 'PERCENT';
}

export interface LetterSpacing {
  value: number;
  unit: 'PIXELS' | 'PERCENT';
}

export type Transform = [
  [number, number, number],
  [number, number, number]
];

export interface ImageFilters {
  exposure?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  highlights?: number;
  shadows?: number;
}

// Effect types
export interface DropShadowEffect {
  type: 'DROP_SHADOW';
  visible: boolean;
  color: RGBA;
  blendMode: string;
  offset: { x: number; y: number };
  radius: number;
  spread?: number;
  showShadowBehindNode?: boolean;
}

export interface InnerShadowEffect {
  type: 'INNER_SHADOW';
  visible: boolean;
  color: RGBA;
  blendMode: string;
  offset: { x: number; y: number };
  radius: number;
  spread?: number;
}

export interface LayerBlurEffect {
  type: 'LAYER_BLUR';
  visible: boolean;
  radius: number;
}

export interface BackgroundBlurEffect {
  type: 'BACKGROUND_BLUR';
  visible: boolean;
  radius: number;
}

export type Effect = DropShadowEffect | InnerShadowEffect | LayerBlurEffect | BackgroundBlurEffect;

// Blend mode type from Figma API
export type BlendMode =
  | 'PASS_THROUGH'
  | 'NORMAL'
  | 'DARKEN'
  | 'MULTIPLY'
  | 'LINEAR_BURN'
  | 'COLOR_BURN'
  | 'LIGHTEN'
  | 'SCREEN'
  | 'LINEAR_DODGE'
  | 'COLOR_DODGE'
  | 'OVERLAY'
  | 'SOFT_LIGHT'
  | 'HARD_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY';

// Extended Paint types for Figma API compatibility
export type PaintType =
  | 'SOLID'
  | 'GRADIENT_LINEAR'
  | 'GRADIENT_RADIAL'
  | 'GRADIENT_ANGULAR'
  | 'GRADIENT_DIAMOND'
  | 'IMAGE'
  | 'EMOJI'
  | 'VIDEO';

// Extended Paint interface for async image loading
export interface AsyncImagePaint extends ImagePaint {
  _pendingImageUrl?: string;
  _imageMetadata?: {
    originalUrl?: string;
    size?: number;
    format?: string;
    width?: number;
    height?: number;
  };
}

// Image processing configuration
export interface ImageProcessingConfig {
  maxSize?: number;
  maxDimensions?: { width: number; height: number };
  quality?: number;
  preferUrl?: boolean;
  corsProxy?: string;
  timeout?: number;
}

// Image data information
export interface ImageDataInfo {
  base64?: string;
  buffer?: Uint8Array;
  width?: number;
  height?: number;
  format?: string;
  originalUrl?: string;
}
