// Image processing utilities for Figma nodes
import { Paint, RGBA } from '../types';

export interface ImageData {
    url?: string;
    base64?: string;
    hash?: string;
    width?: number;
    height?: number;
    format?: 'PNG' | 'JPG' | 'WEBP' | 'SVG';
    size?: number; // in bytes
}

export interface ImageProcessingOptions {
    maxSize?: number; // Maximum size in bytes before using URL fallback
    maxDimensions?: { width: number; height: number };
    quality?: number; // 0-1 for compression
    preferUrl?: boolean; // Prefer URL over base64 even for small images
    corsProxy?: string; // CORS proxy URL for external images
    timeout?: number; // Fetch timeout in milliseconds
}

export interface ProcessedImage {
    paint: Paint;
    isAsync: boolean; // true if image needs to be fetched asynchronously
    metadata?: ImageData;
}

export class ImageProcessor {
    private static readonly DEFAULT_OPTIONS: Required<ImageProcessingOptions> = {
        maxSize: 1024 * 1024, // 1MB
        maxDimensions: { width: 4096, height: 4096 },
        quality: 0.8,
        preferUrl: false,
        corsProxy: '',
        timeout: 10000
    };

    private figmaApi: any;
    private options: Required<ImageProcessingOptions>;

    constructor(figmaApi: any, options: ImageProcessingOptions = {}) {
        this.figmaApi = figmaApi;
        this.options = { ...ImageProcessor.DEFAULT_OPTIONS, ...options };
    }

    /**
     * Process image data and create appropriate Paint
     */
    async processImage(
        imageData: ImageData,
        scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' = 'FILL'
    ): Promise<ProcessedImage> {
        try {
            // If we have a hash already, use it directly
            if (imageData.hash) {
                return {
                    paint: this.createImagePaint(imageData.hash, scaleMode),
                    isAsync: false,
                    metadata: imageData
                };
            }

            // If we have base64 data, process it
            if (imageData.base64) {
                return await this.processBase64Image(imageData, scaleMode);
            }

            // If we have URL, decide whether to fetch or defer
            if (imageData.url) {
                return await this.processUrlImage(imageData, scaleMode);
            }

            throw new Error('No valid image data provided');
        } catch (error) {
            return this.createPlaceholderImage(scaleMode);
        }
    }

    /**
     * Process base64 image data
     */
    private async processBase64Image(
        imageData: ImageData,
        scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'
    ): Promise<ProcessedImage> {
        if (!imageData.base64) {
            throw new Error('No base64 data provided');
        }

        try {
            // Convert base64 to Uint8Array
            const base64Data = imageData.base64.replace(/^data:image\/[^;]+;base64,/, '');
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Check size limits
            if (bytes.length > this.options.maxSize && !this.options.preferUrl) {
                // If we have a URL fallback, use it
                if (imageData.url) {
                    return await this.processUrlImage(imageData, scaleMode);
                }
            }

            // Create Figma image
            const figmaImage = await this.figmaApi.createImage(bytes);
            
            return {
                paint: this.createImagePaint(figmaImage.hash, scaleMode),
                isAsync: false,
                metadata: { ...imageData, hash: figmaImage.hash, size: bytes.length }
            };
        } catch (error) {
            // Fallback to URL if available
            if (imageData.url) {
                return await this.processUrlImage(imageData, scaleMode);
            }
            
            throw error;
        }
    }

    /**
     * Process URL image - decide whether to fetch immediately or defer
     */
    private async processUrlImage(
        imageData: ImageData,
        scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'
    ): Promise<ProcessedImage> {
        if (!imageData.url) {
            throw new Error('No URL provided');
        }

        // Check if we should defer loading (for large images or external URLs)
        const shouldDefer = this.shouldDeferImageLoading(imageData);

        if (shouldDefer) {
            // Create a placeholder paint with URL metadata for async loading
            return {
                paint: this.createUrlPlaceholderPaint(imageData.url, scaleMode),
                isAsync: true,
                metadata: imageData
            };
        }

        // Try to fetch immediately
        try {
            const fetchedImage = await this.fetchImageAsBytes(imageData.url);
            const figmaImage = await this.figmaApi.createImage(fetchedImage.bytes);
            
            return {
                paint: this.createImagePaint(figmaImage.hash, scaleMode),
                isAsync: false,
                metadata: { 
                    ...imageData, 
                    hash: figmaImage.hash, 
                    size: fetchedImage.bytes.length,
                    width: fetchedImage.width,
                    height: fetchedImage.height
                }
            };
        } catch (error) {
            // Fallback to deferred loading
            return {
                paint: this.createUrlPlaceholderPaint(imageData.url, scaleMode),
                isAsync: true,
                metadata: imageData
            };
        }
    }

    /**
     * Fetch image from URL as bytes
     */
    private async fetchImageAsBytes(url: string): Promise<{
        bytes: Uint8Array;
        width?: number;
        height?: number;
    }> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

        try {
            // Use CORS proxy if configured and needed
            const fetchUrl = this.needsCorsProxy(url) && this.options.corsProxy 
                ? `${this.options.corsProxy}${encodeURIComponent(url)}`
                : url;

            // Figma plugin fetch has limited options support
            const response = await fetch(fetchUrl, {
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);

            // Try to get image dimensions (basic implementation)
            const dimensions = this.getImageDimensions(bytes);

            return {
                bytes,
                width: dimensions?.width,
                height: dimensions?.height
            };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Check if image loading should be deferred
     */
    private shouldDeferImageLoading(imageData: ImageData): boolean {
        // Defer if explicitly requested
        if (this.options.preferUrl) {
            return true;
        }

        // Defer for external URLs (cross-origin)
        if (imageData.url && this.isExternalUrl(imageData.url)) {
            return true;
        }

        // Defer if estimated size is too large
        if (imageData.size && imageData.size > this.options.maxSize) {
            return true;
        }

        // Defer if dimensions are too large
        if (imageData.width && imageData.height) {
            const { width, height } = this.options.maxDimensions;
            if (imageData.width > width || imageData.height > height) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if URL is external (cross-origin)
     */
    private isExternalUrl(url: string): boolean {
        try {
            const urlObj = new URL(url, window.location.href);
            return urlObj.origin !== window.location.origin;
        } catch {
            return false; // Relative URLs are not external
        }
    }

    /**
     * Check if URL needs CORS proxy
     */
    private needsCorsProxy(url: string): boolean {
        return this.isExternalUrl(url) && !url.startsWith('data:');
    }

    /**
     * Create image paint from hash
     */
    private createImagePaint(
        imageHash: string,
        scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'
    ): Paint {
        return {
            type: 'IMAGE',
            imageHash: imageHash,
            scaleMode: scaleMode,
            visible: true
        };
    }

    /**
     * Create placeholder paint for URL-based images
     */
    private createUrlPlaceholderPaint(
        url: string,
        scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'
    ): Paint {
        // Create a special paint type that includes URL for async loading
        return {
            type: 'IMAGE',
            imageHash: '', // Empty hash indicates pending
            scaleMode: scaleMode,
            visible: true,
            // Store URL in a custom property for async loading
            _pendingImageUrl: url
        } as any;
    }

    /**
     * Create placeholder image for failed loads
     */
    private createPlaceholderImage(scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'): ProcessedImage {
        // Create a simple colored rectangle as placeholder
        const placeholderPaint: Paint = {
            type: 'SOLID',
            color: { r: 0.9, g: 0.9, b: 0.9 }, // Light gray
            opacity: 1,
            visible: true
        };

        return {
            paint: placeholderPaint,
            isAsync: false,
            metadata: { format: 'PNG' }
        };
    }

    /**
     * Get basic image dimensions from bytes (simplified)
     */
    private getImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
        try {
            // PNG signature check
            if (bytes.length >= 24 && 
                bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
                const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
                const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
                return { width, height };
            }

            // JPEG signature check
            if (bytes.length >= 4 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
                // Basic JPEG dimension parsing would go here
                // For now, return null to indicate unknown dimensions
                return null;
            }

            return null;
        } catch {
            return null;
        }
    }

    /**
     * Process multiple images in batch
     */
    async processImageBatch(
        images: { data: ImageData; scaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE' }[]
    ): Promise<ProcessedImage[]> {
        const results = await Promise.allSettled(
            images.map(({ data, scaleMode }) => this.processImage(data, scaleMode))
        );

        return results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                return this.createPlaceholderImage(images[index].scaleMode || 'FILL');
            }
        });
    }

    /**
     * Async image loader for deferred images
     */
    async loadDeferredImage(
        paint: Paint & { _pendingImageUrl?: string },
        node: any
    ): Promise<boolean> {
        if (!paint._pendingImageUrl) {
            return false;
        }

        try {
            const fetchedImage = await this.fetchImageAsBytes(paint._pendingImageUrl);
            const figmaImage = await this.figmaApi.createImage(fetchedImage.bytes);
            
            // Update the node's fill with the actual image
            const updatedPaint: Paint = {
                type: 'IMAGE',
                imageHash: figmaImage.hash,
                scaleMode: (paint as any).scaleMode || 'FILL',
                visible: true
            };

            // Update node fills
            if (node.fills && Array.isArray(node.fills)) {
                const fillIndex = node.fills.findIndex((fill: any) => 
                    fill._pendingImageUrl === paint._pendingImageUrl
                );
                if (fillIndex >= 0) {
                    const newFills = [...node.fills];
                    newFills[fillIndex] = updatedPaint;
                    node.fills = newFills;
                }
            }

            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Load all deferred images in a node tree
     */
    async loadAllDeferredImages(rootNode: any): Promise<number> {
        let loadedCount = 0;

        const processNode = async (node: any) => {
            // Process current node's fills
            if (node.fills && Array.isArray(node.fills)) {
                for (const fill of node.fills) {
                    if (fill._pendingImageUrl) {
                        const success = await this.loadDeferredImage(fill, node);
                        if (success) loadedCount++;
                    }
                }
            }

            // Process children recursively
            if (node.children && Array.isArray(node.children)) {
                for (const child of node.children) {
                    await processNode(child);
                }
            }
        };

        await processNode(rootNode);
        return loadedCount;
    }
}
