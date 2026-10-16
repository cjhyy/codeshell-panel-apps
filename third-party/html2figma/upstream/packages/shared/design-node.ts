/**
 * DesignNode DSL - Universal design node types
 *
 * Preserves HTML/CSS semantics without binding to any specific
 * design tool (Figma, Sketch, Canva, etc.)
 */

// ===== Node Types =====

/** Universal DSL node */
export type DesignNode =
  | DesignContainerNode
  | DesignTextNode
  | DesignImageNode
  | DesignSVGNode;

/** Node base properties */
export interface DesignNodeBase {
  id: string;
  name: string;

  // HTML semantics
  tag: string; // 'div' | 'button' | 'img' | 'span' | '#text' ...
  role?: string; // 'container' | 'text' | 'image' | 'svg' | 'button' | 'input' | 'video'

  // Semantic info for round-trip mapping and code generation
  semantic?: SemanticInfo;

  // Geometry (computed absolute coordinates)
  bounds: BoundingBox;

  // Visibility
  visible: boolean;
  opacity: number;

  // Positioning
  positioning: PositioningInfo;

  // Transform
  transform?: TransformInfo;

  // Margin (for non-container nodes like image/svg that also have CSS margins)
  margin?: { top: number; right: number; bottom: number; left: number };

  // Vertical alignment for inline elements (vertical-align CSS property)
  verticalAlign?: string;

  // Flex item properties (when this node is a child of a flex container)
  flexItem?: FlexItemInfo;

  // Original CSS (full preservation, optional)
  rawStyles?: Record<string, string>;
}

/** Semantic info - enables round-trip mapping and code generation */
export interface SemanticInfo {
  /** Stable semantic ID, derived from DOM structure, survives re-renders */
  semanticId: string;

  /** HTML attributes subset (only meaningful ones for code generation) */
  attributes?: SemanticAttributes;

  /** CSS class list applied to this element */
  classList?: string[];

  /** Best-match CSS selector for this element */
  cssSelector?: string;

  /** Component boundary info (detected via data-component or framework) */
  component?: ComponentInfo;

  /** Source code location (injected by caller, not auto-detected) */
  sourceLocation?: SourceLocation;
}

/** HTML attributes preserved for semantic mapping */
export interface SemanticAttributes {
  id?: string;
  // className is intentionally omitted — use SemanticInfo.classList instead
  // to avoid duplicate storage (especially on Tailwind pages with many classes).
  dataAttributes?: Record<string, string>;
  ariaAttributes?: Record<string, string>;
  href?: string;
  src?: string;
  alt?: string;
  type?: string;
  placeholder?: string;
}

/** Component boundary information */
export interface ComponentInfo {
  name: string;
  framework?: 'react' | 'vue' | 'svelte' | 'html';
  props?: Record<string, unknown>;
}

/** Source code location for code generation */
export interface SourceLocation {
  file?: string;
  line?: number;
  column?: number;
  selector?: string;
}

/** Flex item properties */
export interface FlexItemInfo {
  grow: number;
  shrink: number;
  basis: number | 'auto';
  alignSelf?: string;
  order?: number;
}

/** Container node */
export interface DesignContainerNode extends DesignNodeBase {
  nodeType: 'container';
  children: DesignNode[];

  // Layout (preserves CSS semantics)
  layout: LayoutInfo;

  /** Computed spacing between children after margin collapse (px) */
  computedItemSpacing?: number;

  // Visual styles
  background: BackgroundInfo;
  border: BorderInfo;
  effects: EffectInfo;

  // Clipping
  overflow: 'visible' | 'hidden' | 'scroll' | 'auto';

  /** CSS background-clip: controls where background paint is visible */
  backgroundClip?: 'border-box' | 'padding-box' | 'content-box';

  /** Gradient layers extracted from CSS gradient border trick
   * (transparent border + background-clip: border-box gradient).
   * These become gradient strokes in Figma. */
  borderGradientLayers?: BackgroundLayer[];

  /** Container's own computed text style (inherited by inline text children).
   * Used during rich text merge so postprocess doesn't need browser API. */
  textStyle?: TextStyleInfo;

  /** CSS list-style-type for <ul>/<ol> containers (e.g. 'disc', 'decimal', 'none') */
  listStyleType?: string;

  /** Generated list marker text for <li> elements (e.g. '•', '1.', 'a.') */
  listMarker?: string;
}

/** Text node */
export interface DesignTextNode extends DesignNodeBase {
  nodeType: 'text';

  // Text content (sanitized, full concatenated text)
  content: string;

  // Text style (base style for the whole text node)
  textStyle: TextStyleInfo;

  // Rich text segments (when text has mixed styles, e.g. <span>bold</span> normal <a>link</a>)
  // Each segment references a character range and its style overrides.
  // If absent, the entire text uses textStyle uniformly.
  styledSegments?: RichTextSegment[];

  // Figma native list type (merged from <ul>/<ol> children)
  listType?: 'ordered' | 'unordered';

  /** Whether this text segment has a line break after it (from traverser split mode) */
  hasLineBreakAfter?: boolean;

  // Text node background (e.g. <span> with background)
  background?: BackgroundInfo;
  border?: BorderInfo;
}

/** Rich text segment - a character range with its own style */
export interface RichTextSegment {
  /** Start character offset (inclusive) */
  start: number;
  /** End character offset (exclusive) */
  end: number;
  /** The text content of this segment */
  text: string;
  /** Style for this segment (overrides the parent textStyle) */
  style: TextStyleInfo;
  /** Original HTML tag that produced this segment */
  tag?: string;
  /** Link URL (if this segment is an <a> tag) */
  href?: string;
}

/** Image node */
export interface DesignImageNode extends DesignNodeBase {
  nodeType: 'image';

  // Image data
  imageData: ImageInfo;

  // Visual styles
  border: BorderInfo;
  effects: EffectInfo;
}

/** SVG node */
export interface DesignSVGNode extends DesignNodeBase {
  nodeType: 'svg';

  // SVG content
  svgContent: string;

  // Visual styles
  background?: BackgroundInfo;
  border?: BorderInfo;
  effects?: EffectInfo;
}

// ===== Structured Style Types =====

/** Bounding box */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Positioning info */
export interface PositioningInfo {
  mode: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  offsets?: { top?: number; right?: number; bottom?: number; left?: number };
  zIndex?: number;
}

/** Transform info */
export interface TransformInfo {
  matrix?: [number, number, number, number, number, number]; // CSS 2D matrix
  origin?: { x: number; y: number };
  scale?: { x: number; y: number };
  rotation?: number; // degrees
  translate?: { x: number; y: number };
  /** True when rotation comes from writing-mode (dims need swap, no originalRect) */
  writingModeRotation?: boolean;
}

/** Layout info - preserves CSS semantics */
export interface LayoutInfo {
  display: 'block' | 'inline' | 'inline-block' | 'flex' | 'inline-flex' | 'grid' | 'inline-grid' | 'none';

  // Flexbox (only when display is flex/inline-flex)
  flex?: {
    direction: 'row' | 'row-reverse' | 'column' | 'column-reverse';
    wrap: 'nowrap' | 'wrap' | 'wrap-reverse';
    justifyContent: string;
    alignItems: string;
    alignContent?: string;
    gap: { row: number; column: number };
  };

  // Grid (only when display is grid/inline-grid)
  grid?: {
    templateColumns: string;
    templateRows: string;
    gap: { row: number; column: number };
    autoFlow?: string;
    justifyItems?: string;
    alignItems?: string;
  };

  // -webkit-line-clamp on container (display: -webkit-box)
  lineClamp?: number;

  // Text alignment (for block containers with inline children)
  textAlign?: 'left' | 'center' | 'right';

  // Vertical alignment (for table-cell elements)
  verticalAlign?: 'top' | 'middle' | 'bottom';

  // Float
  float?: 'left' | 'right' | 'none';
  clear?: 'left' | 'right' | 'both' | 'none';
  hasFloatChildren?: boolean;

  // Box model spacing
  padding: Spacing;
  margin: Spacing;

  // Sizing constraints
  sizing?: {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    boxSizing: 'content-box' | 'border-box';
  };

  // Table layout info (only for table elements)
  tableSpacing?: { row: number; column: number };
  /** CSS border-collapse: collapse → true (merge adjacent cell borders) */
  borderCollapse?: boolean;
}

export interface Spacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Background info */
export interface BackgroundInfo {
  /** Background layers (bottom to top, supports multiple layers) */
  layers: BackgroundLayer[];
}

export type BackgroundLayer =
  | { type: 'color'; color: ColorValue }
  | { type: 'linear-gradient'; angle: number; stops: GradientStop[] }
  | { type: 'radial-gradient'; shape: 'circle' | 'ellipse'; position: { x: number; y: number }; stops: GradientStop[] }
  | { type: 'conic-gradient'; angle: number; position: { x: number; y: number }; stops: GradientStop[] }
  | { type: 'image'; url: string; base64?: string; size: 'cover' | 'contain' | 'auto' | { width: number; height: number }; position: { x: number; y: number }; repeat: string };

export interface GradientStop {
  position: number; // 0-1
  color: ColorValue;
}

/** Color value - universal format */
export interface ColorValue {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
  raw?: string; // Original CSS value
}

/** Border info */
export interface BorderInfo {
  top: BorderSide;
  right: BorderSide;
  bottom: BorderSide;
  left: BorderSide;
  radius: {
    topLeft: number;
    topRight: number;
    bottomRight: number;
    bottomLeft: number;
  };
}

export interface BorderSide {
  width: number;
  style: 'none' | 'solid' | 'dashed' | 'dotted' | 'double';
  color: ColorValue;
}

/** Effect info */
export interface EffectInfo {
  boxShadows: BoxShadow[];
  filters?: FilterEffect[];
  backdropFilters?: FilterEffect[];
  blendMode?: string;
}

export interface BoxShadow {
  inset: boolean;
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  spreadRadius: number;
  color: ColorValue;
}

export interface FilterEffect {
  type: 'blur' | 'brightness' | 'contrast' | 'grayscale' | 'hue-rotate' | 'invert' | 'saturate' | 'sepia' | 'drop-shadow';
  value: number | string;
}

/** Text style info */
export interface TextStyleInfo {
  fontFamily: string;
  fontSize: number;
  fontWeight: number | string;
  fontStyle: 'normal' | 'italic' | 'oblique';
  color: ColorValue;
  textAlign: 'left' | 'center' | 'right' | 'justify';
  verticalAlign?: string;
  textDecoration: 'none' | 'underline' | 'line-through' | 'overline';
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  lineHeight: { value: number; unit: 'px' | '%' | 'normal' };
  letterSpacing: { value: number; unit: 'px' | 'em' };
  whiteSpace?: string;
  wordBreak?: string;
  textOverflow?: 'clip' | 'ellipsis';
  maxLines?: number;
  textShadow?: BoxShadow[];
  /** Gradient fill for text (from CSS background-clip: text) */
  gradientFill?: BackgroundLayer[];
}

/** Image info */
export interface ImageInfo {
  src: string;
  alt?: string;
  base64?: string;
  width?: number;
  height?: number;
  objectFit: 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
}

// ===== Image Upload Strategy =====

/** Configuration for image upload strategy */
export interface ImageUploadConfig {
  /** 'base64' keeps images inline (default), 'upload' uploads to server */
  mode: 'base64' | 'upload';
  /** Server endpoint for upload mode, e.g. 'http://localhost:3000/api/images' */
  uploadEndpoint?: string;
  /** Server proxy endpoint for fetching cross-origin / 403 images.
   *  Used as fallback when direct browser fetch fails.
   *  e.g. '/api/image-proxy' — server fetches with proper headers */
  proxyEndpoint?: string;
}

/** Input for a single image upload operation */
export interface ImageUploadInput {
  /** Original image URL (e.g. <img src> or CSS background-image url) */
  url?: string;
  /** Base64-encoded image data (with or without data: prefix) */
  base64?: string;
  width?: number;
  height?: number;
}

/** Result of a single image upload operation */
export interface ImageUploadResult {
  /** Accessible URL for the image (server-local or S3) */
  url: string;
  /** Whether the upload succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}
