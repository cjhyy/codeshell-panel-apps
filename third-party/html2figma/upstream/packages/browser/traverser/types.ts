/**
 * NodeTraverserCore 类型定义
 */

/**
 * 渲染节点树的节点类型
 */
export interface RenderNode {
  /** 节点类型：'element' | 'text' */
  nodeType: 'element' | 'text';
  /** 元素标签名（小写），仅 element 类型有效 */
  tag?: string;
  /** 计算后的样式，仅 element 类型有效 */
  computedStyle?: CSSStyleDeclaration;
  /** 元素的边界矩形 */
  boundingRect?: DOMRect;
  /** 文本内容，仅 text 类型有效 */
  textContent?: string;
  /** 子节点列表 */
  children: RenderNode[];
  /** 原始 DOM 节点引用 */
  domNode: Node;
  /** 节点是否可见 */
  visible: boolean;
  /** 未变换的原始布局信息（offset*），仅在元素有 CSS transform 时存在 */
  originalRect?: { x: number; y: number; width: number; height: number };
  /** 自定义属性：用于存储额外的元数据 */
  metadata?: Record<string, any>;
}

/**
 * 遍历选项
 */
export interface TraverseOptions {
  /** 是否包含不可见元素，默认 false */
  includeInvisible?: boolean;
  /** 最大遍历深度，默认 Infinity */
  maxDepth?: number;
  /** 是否包含文本节点，默认 true */
  includeTextNodes?: boolean;
  /** 是否保留空白文本节点，默认 false */
  preserveWhitespace?: boolean;
  /** 自定义过滤器：返回 false 则跳过该节点 */
  filter?: (node: Node, depth: number) => boolean;
  /** 自定义元数据提取器 */
  extractMetadata?: (node: Node) => Record<string, any> | undefined;
}

/**
 * 元素位置信息
 */
export interface Position {
  /** 相对于父元素的 x 坐标 */
  relativeX: number;
  /** 相对于父元素的 y 坐标 */
  relativeY: number;
  /** 相对于根节点的 x 坐标 */
  rootRelativeX: number;
  /** 相对于根节点的 y 坐标 */
  rootRelativeY: number;
  /** 元素宽度 */
  width: number;
  /** 元素高度 */
  height: number;
}

/**
 * 渲染树的 DSL 表示（用于序列化和调试）
 */
export interface RenderDSL {
  /** 节点类型 */
  nodeType: 'element' | 'text';
  /** 节点是否可见 */
  visible: boolean;
  /** 元素标签名（仅 element 类型） */
  tag?: string;
  /** X 坐标（相对于视口） */
  x?: number;
  /** Y 坐标（相对于视口） */
  y?: number;
  /** 宽度 */
  width?: number;
  /** 高度 */
  height?: number;
  /** 元素位置和尺寸信息 */
  position?: Position;
  /** 原始边界矩形（用于调试和精确计算） */
  boundingRect?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  /** 文本内容（仅 text 类型） */
  textContent?: string;
  /** 过滤后的有效样式 */
  computedStyle?: Record<string, string>;
  /** 自定义元数据 */
  metadata?: Record<string, any>;
  /** 子节点列表 */
  children?: RenderDSL[];
}

