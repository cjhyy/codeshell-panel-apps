// Main exports for the figma module
export { FigmaService } from './FigmaService';
export { NodeCreatorFactory } from './factory/NodeCreatorFactory';
export { FigmaAdapter } from '@html2figma/adapter';
import { FigmaService } from './FigmaService';

// Node creators
export { FrameCreator } from './creators/FrameCreator';
export { RectangleCreator } from './creators/RectangleCreator';
export { TextCreator } from './creators/TextCreator';
export { GroupCreator } from './creators/GroupCreator';
export { BaseNodeCreator } from './base/BaseNodeCreator';

// Font utilities
export { extractFontsFromJSON, loadFonts, loadFontsFromJSON } from './font-utils';
export type { FontDescriptor } from './font-utils';

// Utilities
export { StyleProcessor } from './utils/StyleProcessor';
export { LayoutProcessor } from './utils/LayoutProcessor';
export { ImageProcessor } from './utils/ImageProcessor';
export { TextProcessor } from './utils/TextProcessor';
export type { ImageData, ImageProcessingOptions, ProcessedImage } from './utils/ImageProcessor';
export type { TextProcessingOptions } from './utils/TextProcessor';

// Type exports
export type * from './types';

// Convenience function for quick setup
export function createFigmaService(figmaApi?: any, options?: any) {
    const api = figmaApi || (globalThis as any).figma;
    if (!api) {
        throw new Error('Figma API not available. Make sure this is running in a Figma plugin context.');
    }
    return new FigmaService(api, options);
}
