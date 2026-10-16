/**
 * Image Resolver - Extract image info from RenderNode
 */

import type { ImageInfo } from '@html2figma/shared';
import { getStyle } from '../utils';

/**
 * Resolve image info from an <img>, <picture>, <video>, or <canvas> element's RenderNode.
 *
 * For <picture> elements, the actual image source lives in the child <img>
 * (with <source> elements providing responsive alternatives). We find the
 * inner <img> and read its resolved `src` and natural dimensions.
 */
export function resolveImageInfo(
  domNode: Node,
  styles: Record<string, string>
): ImageInfo {
  // For <picture>, resolve from the inner <img> element
  const imgElement = resolveImgElement(domNode);

  const src = imgElement.src || imgElement.getAttribute('src') || '';
  const alt = imgElement.alt || imgElement.getAttribute('alt') || undefined;

  // Try to get natural dimensions
  const width = imgElement.naturalWidth || imgElement.width || undefined;
  const height = imgElement.naturalHeight || imgElement.height || undefined;

  const objectFit = normalizeObjectFit(getStyle(styles, 'object-fit', 'objectFit'));

  return {
    src,
    alt,
    width,
    height,
    objectFit,
  };
}

/**
 * Resolve the actual <img> element from a DOM node.
 * For <picture>, finds the child <img>. For <img>, returns itself.
 * For other elements (video, canvas), returns as-is.
 */
export function resolveImgElement(domNode: Node): HTMLImageElement {
  const element = domNode as HTMLElement;
  if (element.tagName?.toLowerCase() === 'picture') {
    const img = element.querySelector('img');
    if (img) return img;
  }
  return element as HTMLImageElement;
}

/**
 * Check if a URL points to an SVG
 */
export function isSvgUrl(url: string): boolean {
  if (!url) return false;
  return url.endsWith('.svg') || url.includes('.svg?') || url.startsWith('data:image/svg');
}

/**
 * Try to convert an image to base64 (via canvas)
 */
export function imageToBase64(element: HTMLImageElement): string | undefined {
  try {
    if (!element.complete || element.naturalWidth === 0) {
      return undefined;
    }
    const canvas = document.createElement('canvas');
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(element, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    // CORS or other error
    return undefined;
  }
}

// ==================== Internal helpers ====================

function normalizeObjectFit(value: string): ImageInfo['objectFit'] {
  const valid: ImageInfo['objectFit'][] = ['fill', 'contain', 'cover', 'none', 'scale-down'];
  return valid.includes(value as any) ? value as ImageInfo['objectFit'] : 'fill';
}
