// Re-export shared types for Figma module
export type {
  // Core Figma node types
  FigmaNode,
  FigmaNodeBase,
  FigmaRectangleNode,
  FigmaTextNode,
  FigmaFrameNode,
  FigmaGroupNode,
  FigmaImageNode,

  // Paint and style types
  Paint,
  SolidPaint,
  GradientPaint,
  ImagePaint,
  PaintType,
  RGB,
  RGBA,
  ColorStop,
  FontName,
  LineHeight,
  LetterSpacing,

  // Effect types
  Effect,
  DropShadowEffect,
  InnerShadowEffect,
  LayerBlurEffect,
  BackgroundBlurEffect,

  // Utility types
  Transform,
  ImageFilters,
  ImageDataInfo,
  LayoutPositioning,
  BlendMode,

  // Processing types
  AsyncImagePaint,
  ImageProcessingConfig
} from '@html2figma/shared';
