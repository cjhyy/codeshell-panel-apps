// Image node creator for handling image fills and background images
import { FigmaRectangleNode } from '@html2figma/shared';
import { createLogger } from '@html2figma/shared';
import { LogModule } from '@html2figma/shared';
import { BaseNodeCreator } from '../base/BaseNodeCreator';

// Module-level logger for static methods
const staticLogger = createLogger(LogModule.IMAGE_CREATOR);

export class ImageCreator extends BaseNodeCreator<FigmaRectangleNode, RectangleNode> {
    // Static cache: JSON imageHash -> Figma imageHash
    // 缓存从 JSON 中的 imageHash 到 Figma 实际生成的 hash 的映射
    private static imageHashCache: Map<string, string> = new Map();
    private static cacheStats = { hits: 0, misses: 0 };

    // ── Image processing concurrency limiter ──
    // Prevents Figma from freezing when many images are processed at once.
    private static readonly CONCURRENCY_LIMIT = 3;
    private static activeTasks = 0;
    private static waitQueue: (() => void)[] = [];

    private static async acquireSlot(): Promise<void> {
        if (ImageCreator.activeTasks < ImageCreator.CONCURRENCY_LIMIT) {
            ImageCreator.activeTasks++;
            return;
        }
        return new Promise<void>(resolve => {
            ImageCreator.waitQueue.push(resolve);
        });
    }

    private static releaseSlot(): void {
        ImageCreator.activeTasks--;
        if (ImageCreator.waitQueue.length > 0) {
            ImageCreator.activeTasks++;
            const next = ImageCreator.waitQueue.shift()!;
            next();
        }
    }

    /**
     * 通用辅助方法：更新 node 的 fills，支持多层 fills（渐变+图片）
     * @param node - Figma 节点
     * @param newFill - 新的 fill（通常是 IMAGE 类型）
     * @param existingFills - 现有的 fills 数组（可选，如果不提供则从 node.fills 获取）
     */
    static updateNodeFills(node: any, newFill: any, existingFills?: any[]): void {
        const currentFills = existingFills || node.fills || [];

        const hasImageFill = currentFills.some((fill: any) => fill.type === 'IMAGE');

        if (hasImageFill) {
            // Replace existing IMAGE fills with new fill, preserve others (e.g. gradient)
            const updatedFills = currentFills.map((fill: any) => {
                if (fill.type === 'IMAGE') {
                    return newFill;
                }
                return fill;
            });
            node.fills = updatedFills;
        } else if (currentFills.length > 0) {
            // No IMAGE fill exists — insert at bottom (fills[0]) so overlays stay on top.
            // Figma renders fills bottom-to-top: fills[0] = bottom, fills[last] = top.
            node.fills = [newFill, ...currentFills];
        } else {
            // Empty: just set the new fill
            node.fills = [newFill];
        }
    }
    /**
     * Create an Image node (Rectangle with image fill) from JSON data (only creates the node)
     */
    create(data: FigmaRectangleNode): RectangleNode {
        try {
            this.validateData(data);
            
            const rectangle = this.figmaApi.createRectangle();
            return rectangle;
            
        } catch (error) {
            this.handleError(error as Error, 'Image', data);
        }
    }

    /**
     * Set all properties for the image after creation
     */
    setProperties(rectangle: RectangleNode, data: FigmaRectangleNode): void {
        try {
            // Set base properties (without size)
            this.setBaseProperties(rectangle, data);
            
            // Set rectangle-specific properties
            this.setRectangleProperties(rectangle, data);
            
            // Set size properties after other properties
            this.setSizeProperties(rectangle, data);
            
            // Check if we have imageMetadata with URL for downloading
            const imageMetadata = (data as any).imageMetadata;
            const hasImageMetadataUrl = imageMetadata && imageMetadata.originalUrl;
            
            // Check if we can handle image properties synchronously
            const hasValidImageHash = data.fills?.some((fill: any) => 
                fill.type === 'IMAGE' && fill.imageHash && typeof fill.imageHash === 'string' && fill.imageHash.length > 0
            );
            
            if (hasImageMetadataUrl) {
                // Clear default Figma fills (gray solid) — image processing will set the correct fill.
                // Without this, the default gray fill stays on top of the image.
                rectangle.fills = [];

                // Priority 1: Check if it's SVG — use svgContent or decode from base64
                let resolvedMeta = imageMetadata;
                if (!resolvedMeta.svgContent && resolvedMeta.base64?.startsWith('data:image/svg')) {
                    const ci = resolvedMeta.base64.indexOf(',');
                    if (ci !== -1) {
                        const payload = resolvedMeta.base64.substring(ci + 1);
                        const isB64 = resolvedMeta.base64.substring(0, ci).includes('base64');
                        try {
                            const decoded = isB64 ? atob(payload) : decodeURIComponent(payload);
                            if (decoded.trimStart().startsWith('<svg')) {
                                resolvedMeta = { ...resolvedMeta, isSvg: true, svgContent: decoded };
                            }
                        } catch { /* ignore */ }
                    }
                }
                if (resolvedMeta.isSvg && resolvedMeta.svgContent) {
                    this.logger.info(`🎨 SVG imageMetadata → createNodeFromSvg (${resolvedMeta.svgContent.length} chars): ${resolvedMeta.originalUrl?.substring(0, 60)}`);
                    // Process SVG asynchronously
                    this.processSvgContent(rectangle, resolvedMeta).catch(error => {
                        this.logger.error('❌ Failed to process SVG from svgContent:', error);
                        ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill(`SVG processing failed: ${error}`), data.fills);
                    });
                } else if (resolvedMeta.isSvg && !resolvedMeta.svgContent) {
                    this.logger.warn(`⚠️ isSvg=true but no svgContent: ${resolvedMeta.originalUrl?.substring(0, 60)}`);
                }
                // Priority 2: Check if imageMetadata contains base64 data (preprocessed by browser)
                else if (imageMetadata.base64) {
                    // Process base64 data to create Figma image
                    const jsonImageHash = (data.fills?.find((fill: any) => fill.type === 'IMAGE') as any)?.imageHash;
                    this.processBase64Image(rectangle, imageMetadata, jsonImageHash)
                        .catch(error => {
                            this.logger.warn(`⚠️ Base64 failed for "${data.name}", falling back to URL download:`, error);
                            // Fallback: try URL download if base64 processing fails
                            if (imageMetadata.originalUrl) {
                                this.setImageProperties(rectangle, data).catch(urlError => {
                                    ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill(`Image failed: ${error}`), data.fills);
                                });
                            } else {
                                ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill(`Base64 processing failed: ${error}`), data.fills);
                            }
                        });

                } else {
                    // Fallback to URL download
                    this.setImageProperties(rectangle, data).catch(error => {
                        ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill('Image download failed - no base64 data'), data.fills);
                    });
                }
            } else if (hasValidImageHash) {
                // Check cache and replace with Figma hash if available
                const processedFills = data.fills?.map(fill => {
                    if (fill.type === 'IMAGE' && (fill as any).imageHash) {
                        const jsonImageHash = (fill as any).imageHash;
                        
                        // 检查缓存
                        if (ImageCreator.imageHashCache.has(jsonImageHash)) {
                            const cachedFigmaHash = ImageCreator.imageHashCache.get(jsonImageHash)!;
                            ImageCreator.cacheStats.hits++;
                            
                            return {
                                ...fill,
                                imageHash: cachedFigmaHash
                            };
                        } else {
                            // 缓存未命中，保留原始 hash（警告：这可能导致图片无法显示）
                            ImageCreator.cacheStats.misses++;
                            this.logger.warn(`⚠️ [setProperties] Cache MISS for ${data.name}! JSON hash ${jsonImageHash.substring(0, 8)}... not found in cache. Image may not render. (Misses: ${ImageCreator.cacheStats.misses})`);
                            return fill;
                        }
                    }
                    return fill;
                }) || [];
                
                rectangle.fills = processedFills as any[];
            } else {
                // Set image-specific properties (async operation)
                this.setImageProperties(rectangle, data).catch(error => {
                    // Set placeholder fill on error
                    ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill('Image loading failed'), data.fills);
                });
            }
            
            // Layout positioning is now handled in BaseNodeCreator
            
            this.logCreation('Image', data.name);
            
        } catch (error) {
            throw error;
        }
    }

    /**
     * Set layout-specific properties for child image nodes after they are added to parent
     */

    /**
     * Set rectangle-specific properties
     * NOTE: Fills are NOT set here for image nodes — they are handled by the
     * image processing logic in setProperties() to avoid setting invalid
     * IMAGE fills (no imageHash) which would throw and prevent strokes from being applied.
     */
    private setRectangleProperties(rectangle: RectangleNode, data: FigmaRectangleNode): void {
        // Strokes (set before any fill logic to ensure borders always appear)
        this.setStrokes(rectangle, data.strokes || [], data.strokeWeight, data.strokeAlign, undefined, undefined, undefined, undefined, data.strokeDashPattern);

        // Corner radius
        this.setCornerRadius(rectangle, data.cornerRadius);

        // Effects
        if (data.effects) {
            this.setEffects(rectangle, data.effects);
        }
    }


    /**
     * Process SVG content directly without network request
     * @param rectangle - The rectangle node to apply the SVG as image fill
     * @param imageMetadata - Image metadata containing svgContent
     */
    private async processSvgContent(rectangle: RectangleNode, imageMetadata: any): Promise<void> {
        await ImageCreator.acquireSlot();
        try {
            this.logger.info('🎨 Creating SVG node from svgContent...');
            // Create SVG node from content
            const svgNode = this.figmaApi.createNodeFromSvg(imageMetadata.svgContent);

            // Export SVG as PNG to use as image fill
            this.logger.info('📸 Exporting SVG to PNG...');
            const pngBytes = await svgNode.exportAsync({
                format: 'PNG',
                constraint: { type: 'SCALE', value: 2 }
            });

            // Create Figma image from PNG bytes
            const figmaImage = this.figmaApi.createImage(pngBytes);

            // Remove temporary SVG node
            svgNode.remove();
            
            // Apply image fill to rectangle
            const imageFill = {
                type: 'IMAGE' as const,
                imageHash: figmaImage.hash,
                scaleMode: imageMetadata.scaleMode || 'FILL'
            };
            ImageCreator.updateNodeFills(rectangle, imageFill);
            
            this.logger.info('✅ SVG processed from svgContent successfully (no network request)');
        } catch (error) {
            this.logger.error('❌ SVG processing error:', error);
            throw error;
        } finally {
            ImageCreator.releaseSlot();
        }
    }

    /**
     * Process base64 image data from browser preprocessing
     * @param rectangle - The rectangle node to apply the image fill to
     * @param imageMetadata - Image metadata containing base64 data
     * @param jsonImageHash - The imageHash from JSON (used as cache key)
     */
    private async processBase64Image(rectangle: RectangleNode, imageMetadata: any, jsonImageHash?: string): Promise<void> {
        // 直接调用静态方法
        const success = await ImageCreator.processAndApplyBase64Image(
            rectangle,
            imageMetadata,
            jsonImageHash,
            this.figmaApi
        );
        
        if (!success) {
            throw new Error('Failed to process base64 image');
        }
    }

    /**
     * Static method to process base64 image and apply to any node
     * Can be reused by FrameCreator and other creators
     */
    static async processAndApplyBase64Image(
        node: any,
        imageMetadata: any,
        jsonImageHash: string | undefined,
        figmaApi: any
    ): Promise<boolean> {
        try {
            const nodeName = node?.name || 'unknown';
            staticLogger.info(`[processBase64] Starting for "${nodeName}", base64 length: ${imageMetadata.base64?.length || 0}, url: ${imageMetadata.originalUrl?.substring(0, 60) || 'none'}`);

            // 检查缓存：如果有 JSON imageHash 且已缓存，直接使用
            if (jsonImageHash && ImageCreator.imageHashCache.has(jsonImageHash)) {
                const cachedFigmaHash = ImageCreator.imageHashCache.get(jsonImageHash)!;
                ImageCreator.cacheStats.hits++;

                // 直接使用缓存的 Figma hash
                const scaleMode = imageMetadata.scaleMode || 'FILL';
                const imageFill: Record<string, any> = {
                    type: 'IMAGE' as const,
                    imageHash: cachedFigmaHash,
                    scaleMode: scaleMode
                };
                // TILE mode requires scalingFactor > 0 — default to 1.0
                if (scaleMode === 'TILE') {
                    imageFill.scalingFactor = 1;
                }
                if (imageMetadata.imageTransform) {
                    imageFill.imageTransform = imageMetadata.imageTransform;
                }
                // TILE mode with explicit size: get natural dimensions for scalingFactor
                if (scaleMode === 'TILE' && imageMetadata.tileSize) {
                    try {
                        const figmaImage = figmaApi.getImageByHash(cachedFigmaHash);
                        if (figmaImage) {
                            const naturalSize = await figmaImage.getSizeAsync();
                            if (naturalSize.width > 0) {
                                imageFill.scalingFactor = imageMetadata.tileSize.width / naturalSize.width;
                            }
                        }
                    } catch (e) {
                        staticLogger.warn(`[processBase64] Failed to get image size from cache for "${nodeName}"`, e);
                    }
                }
                ImageCreator.updateNodeFills(node, imageFill);
                staticLogger.info(`[processBase64] Cache HIT for "${nodeName}", hash: ${cachedFigmaHash.substring(0, 8)}...`);
                return true;
            }

            // 缓存未命中，需要处理图片
            if (jsonImageHash) {
                ImageCreator.cacheStats.misses++;
            }

            // Extract base64 data (remove data URL prefix if present)
            let base64Data = imageMetadata.base64;
            if (base64Data.startsWith('data:')) {
                const commaIndex = base64Data.indexOf(',');
                if (commaIndex !== -1) {
                    base64Data = base64Data.substring(commaIndex + 1);
                }
            }

            staticLogger.info(`[processBase64] Decoding base64 for "${nodeName}", raw length: ${base64Data.length}`);

            // Convert base64 to Uint8Array
            const bytes = ImageCreator.decodeBase64ToBytes(base64Data);
            staticLogger.info(`[processBase64] Decoded ${bytes.length} bytes for "${nodeName}"`);

            // ── Concurrency gate: wait for a slot ──
            await ImageCreator.acquireSlot();
            let figmaImage: any;
            try {
                figmaImage = figmaApi.createImage(bytes);
            } finally {
                ImageCreator.releaseSlot();
            }

            const figmaImageHash = figmaImage.hash;
            staticLogger.info(`[processBase64] Created Figma image for "${nodeName}", hash: ${figmaImageHash.substring(0, 8)}...`);

            // 存入缓存
            if (jsonImageHash) {
                ImageCreator.imageHashCache.set(jsonImageHash, figmaImageHash);
            }

            // Create image fill
            const scaleMode = imageMetadata.scaleMode || 'FILL';
            const imageFill: Record<string, any> = {
                type: 'IMAGE' as const,
                imageHash: figmaImageHash,
                scaleMode: scaleMode
            };

            // TILE mode requires scalingFactor > 0 — default to 1.0 (natural size)
            if (scaleMode === 'TILE') {
                imageFill.scalingFactor = 1;
            }

            // Apply imageTransform for explicit background-size + position (e.g. 80px at top-left)
            if (imageMetadata.imageTransform) {
                imageFill.imageTransform = imageMetadata.imageTransform;
                staticLogger.info(`[processBase64] imageTransform for "${nodeName}": ${JSON.stringify(imageMetadata.imageTransform)}`);
            }

            // TILE mode with explicit size: calculate scalingFactor from natural image dimensions
            if (scaleMode === 'TILE' && imageMetadata.tileSize) {
                try {
                    const naturalSize = await figmaImage.getSizeAsync();
                    if (naturalSize.width > 0) {
                        imageFill.scalingFactor = imageMetadata.tileSize.width / naturalSize.width;
                        staticLogger.info(`[processBase64] TILE scalingFactor for "${nodeName}": ${imageFill.scalingFactor} (tile ${imageMetadata.tileSize.width}px / natural ${naturalSize.width}px)`);
                    }
                } catch (sizeError) {
                    staticLogger.warn(`[processBase64] Failed to get natural image size for "${nodeName}", using default scalingFactor=1`, sizeError);
                }
            }

            // Apply the image fill
            ImageCreator.updateNodeFills(node, imageFill);
            staticLogger.info(`[processBase64] ✅ Image fill applied for "${nodeName}", scaleMode=${scaleMode}`);
            return true;

        } catch (error) {
            staticLogger.error('[processBase64] ❌ Failed to process base64 image:', error);
            return false;
        }
    }

    /**
     * Decode base64 string to Uint8Array (static method for reuse)
     */
    static decodeBase64ToBytes(base64Data: string): Uint8Array {
        // Try using Buffer first (Node.js/Figma plugin environment)
        if (typeof (globalThis as any).Buffer !== 'undefined' && (globalThis as any).Buffer.from) {
            const BufferConstructor = (globalThis as any).Buffer;
            const buffer = BufferConstructor.from(base64Data, 'base64');
            return new Uint8Array(buffer);
        } else if (typeof atob !== 'undefined') {
            // Fallback to atob if Buffer is not available
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes;
        } else {
            // Manual base64 decoding as last resort
            return ImageCreator.decodeBase64Manually(base64Data);
        }
    }

    /**
     * Manual base64 decoding implementation for environments without Buffer or atob
     * Static method for reuse by other creators
     */
    static decodeBase64Manually(base64: string): Uint8Array {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        const lookup = new Uint8Array(256);
        
        // Build lookup table
        for (let i = 0; i < chars.length; i++) {
            lookup[chars.charCodeAt(i)] = i;
        }
        
        let bufferLength = base64.length * 0.75;
        const len = base64.length;
        let p = 0;
        
        // Handle padding
        if (base64[len - 1] === '=') {
            bufferLength--;
            if (base64[len - 2] === '=') {
                bufferLength--;
            }
        }
        
        const bytes = new Uint8Array(bufferLength);
        
        for (let i = 0; i < len; i += 4) {
            const encoded1 = lookup[base64.charCodeAt(i)];
            const encoded2 = lookup[base64.charCodeAt(i + 1)];
            const encoded3 = lookup[base64.charCodeAt(i + 2)];
            const encoded4 = lookup[base64.charCodeAt(i + 3)];
            
            bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
            if (p < bufferLength) {
                bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
            }
            if (p < bufferLength) {
                bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
            }
        }
        
        return bytes;
    }

    /**
     * Set image-specific properties and handle image loading
     */
    private async setImageProperties(rectangle: RectangleNode, data: FigmaRectangleNode): Promise<void> {
        await ImageCreator.acquireSlot();
        try {
            await this.setImagePropertiesInner(rectangle, data);
        } finally {
            ImageCreator.releaseSlot();
        }
    }

    private async setImagePropertiesInner(rectangle: RectangleNode, data: FigmaRectangleNode): Promise<void> {
        // Get image metadata first
        const imageMetadata = (data as any).imageMetadata;
        
        // Priority 1: If we have imageMetadata with URL, download the image
        if (imageMetadata && imageMetadata.originalUrl) {
            try {
                // Download image from metadata URL
                const downloadedImageFill = await this.downloadImageFromMetadata(imageMetadata);
                
                // ✅ Check if we have multiple fills (e.g., gradient + image)
                if (data.fills && data.fills.length > 1) {
                    // Multi-layer fills: replace IMAGE fills while keeping others
                    const updatedFills = data.fills.map(fill => {
                        if (fill.type === 'IMAGE') {
                            return downloadedImageFill;
                        }
                        return fill;
                    });
                    
                    try {
                        rectangle.fills = updatedFills as any[];
                    } catch (fillError) {
                        throw fillError;
                    }
                } else {
                    // Single fill: just set the image
                    try {
                        rectangle.fills = [downloadedImageFill];
                    } catch (fillError) {
                        throw fillError;
                    }
                }
                
                return;
            } catch (error) {
                // Continue to fallback processing
            }
        }
        
        // Priority 2: Process existing fills
        if (data.fills && Array.isArray(data.fills)) {
            const processedFills = [];
            
            for (const fill of data.fills) {
                if (fill.type === 'IMAGE') {
                    // If we already have a valid imageHash, check cache and use cached Figma hash if available
                    if (fill.imageHash && typeof fill.imageHash === 'string' && fill.imageHash.length > 0) {
                        const jsonImageHash = fill.imageHash;
                        
                        // 检查缓存：如果这个 JSON imageHash 已经缓存，替换为 Figma hash
                        if (ImageCreator.imageHashCache.has(jsonImageHash)) {
                            const cachedFigmaHash = ImageCreator.imageHashCache.get(jsonImageHash)!;
                            ImageCreator.cacheStats.hits++;
                            
                            processedFills.push({
                                ...fill,
                                imageHash: cachedFigmaHash
                            });
                        } else {
                            // 缓存未命中，使用原始 hash（这可能意味着需要后续处理）
                            processedFills.push(fill);
                        }
                    } else {
                        // Process image fill asynchronously
                        const fillWithMetadata = { ...fill } as any;
                        if (imageMetadata?.originalUrl && !fill.imageHash && !(fill as any).imageUrl) {
                            fillWithMetadata._imageMetadata = imageMetadata;
                        }
                        
                        const processedFill = await this.processImageFill(fillWithMetadata as any);
                        processedFills.push(processedFill);
                    }
                } else {
                    processedFills.push(fill);
                }
            }
            
            rectangle.fills = processedFills as any[];
        }

        // Priority 3: Handle background image data if present
        const backgroundImageData = (data as any).backgroundImageData;
        if (backgroundImageData) {
            await this.handleBackgroundImageData(rectangle, backgroundImageData);
        }

        // Priority 4: Apply image metadata as fallback (if no fills were processed)
        if (imageMetadata && (!data.fills || data.fills.length === 0)) {
            await this.applyImageMetadata(rectangle, imageMetadata);
        }
    }

    /**
     * Parse URL manually since URL constructor is not available in Figma plugin
     */
    private parseUrl(url: string): { url: string; domain: string; protocol: string; pathname: string } {
        const urlParts = url.match(/^(https?):\/\/([^\/]+)(\/.*)?$/);
        return {
            url: url,
            domain: urlParts ? urlParts[2] : 'unknown',
            protocol: urlParts ? urlParts[1] + ':' : 'unknown',
            pathname: urlParts ? (urlParts[3] || '/') : 'unknown'
        };
    }

    /**
     * Download image from metadata URL and create Figma image fill
     */
    private async downloadImageFromMetadata(imageMetadata: any): Promise<any> {
        const fetchId = Math.random().toString(36).substr(2, 9);
        const startTime = Date.now();
        
        try {
            // Parse URL manually since URL constructor is not available in Figma plugin
            const urlInfo = this.parseUrl(imageMetadata.originalUrl);
            
            // Check if fetch is available and is a function
            if (typeof fetch !== 'function') {
                throw new Error(`FETCH-${fetchId}: fetch is not a function, type: ${typeof fetch}`);
            }
            
            // Wrap fetch in Promise to catch any unhandled rejections
            let fetchPromise;
            try {
                fetchPromise = fetch(imageMetadata.originalUrl);
            } catch (fetchError) {
                throw fetchError;
            }
            
            // Add timeout and better error handling
            const response = await Promise.race([
                fetchPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(`FETCH-${fetchId}: Timeout after 30 seconds`)), 30000)
                )
            ]);
            
            // Type assertion for response
            const fetchResponse = response as Response;
            
            if (!fetchResponse.ok) {
                throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
            }
            
            // Convert to buffer
            // Check if arrayBuffer method exists
            if (typeof fetchResponse.arrayBuffer !== 'function') {
                throw new Error(`FETCH-${fetchId}: response.arrayBuffer is not a function, type: ${typeof fetchResponse.arrayBuffer}`);
            }
            
            let arrayBuffer;
            try {
                arrayBuffer = await fetchResponse.arrayBuffer();
            } catch (arrayBufferError) {
                throw arrayBufferError;
            }
            
            const uint8Array = new Uint8Array(arrayBuffer);
            
            // Create Figma image
            // Check if createImage method exists
            if (!this.figmaApi || typeof this.figmaApi.createImage !== 'function') {
                throw new Error(`FETCH-${fetchId}: figmaApi.createImage is not a function, figmaApi: ${this.figmaApi}, createImage type: ${typeof this.figmaApi?.createImage}`);
            }
            
            let figmaImage;
            try {
                figmaImage = await this.figmaApi.createImage(uint8Array);
            } catch (createImageError) {
                throw createImageError;
            }
            
            const processingTime = Date.now() - startTime;
            
            // Create image fill with proper Figma format
            const imageFill = {
                type: 'IMAGE' as const,
                imageHash: figmaImage.hash,
                scaleMode: 'FILL' as const,
                visible: true,
                opacity: 1,
                blendMode: 'NORMAL' as const
            };
            
            return imageFill;
            
        } catch (error) {
            const err = error as Error;
            const processingTime = Date.now() - startTime;
            
            // Check if it's a CORS error specifically
            if (err.message.includes('CORS') || err.message.includes('cors') || 
                err.message.includes('Cross-Origin') || err.name === 'TypeError') {
                // CORS policy issue detected
            }
            
            // Try simple fallback for tanka.ai (Figma plugin doesn't support mode options)
            try {
                const fallbackResponse = await fetch(imageMetadata.originalUrl);
                
                if (fallbackResponse.type === 'opaque') {
                    return this.createPlaceholderFill('CORS restricted: tanka.ai does not allow cross-origin access');
                }
            } catch (fallbackError) {
                // Fallback also failed
            }
            
            // Return placeholder fill with specific tanka.ai message
            return this.createPlaceholderFill(`Failed to download from tanka.ai: CORS policy likely blocking access`);
        }
    }

    /**
     * Process image fill and load image data
     */
    private async processImageFill(fill: any): Promise<any> {
        const startTime = Date.now();
        const jsonImageHash = fill.imageHash; // 保存 JSON 中的原始 imageHash 用于缓存
        
        // Check if we have a URL in the fill metadata that needs to be fetched
        const imageUrl = fill.imageUrl || this.extractUrlFromMetadata(fill._imageMetadata);
        if (imageUrl) {
            try {
                const buffer = await this.fetchImageFromUrl(imageUrl);
                const figmaImage = await this.figmaApi.createImage(buffer);
                
                const processingTime = Date.now() - startTime;
                
                // 缓存结果
                if (jsonImageHash) {
                    ImageCreator.imageHashCache.set(jsonImageHash, figmaImage.hash);
                }
                
                return {
                    ...fill,
                    imageHash: figmaImage.hash,
                    visible: true,
                    type: 'IMAGE'
                };
            } catch (error) {
                const processingTime = Date.now() - startTime;
                return this.createPlaceholderFill(`Failed to fetch: ${imageUrl}`);
            }
        }

        if (!jsonImageHash) {
            return fill;
        }

        // 检查缓存
        if (ImageCreator.imageHashCache.has(jsonImageHash)) {
            const cachedFigmaHash = ImageCreator.imageHashCache.get(jsonImageHash)!;
            ImageCreator.cacheStats.hits++;
            return {
                ...fill,
                imageHash: cachedFigmaHash,
                visible: true,
                type: 'IMAGE'
            };
        }

        try {
            // Check if we have image data available
            const imageData = this.getImageData(jsonImageHash);
            
            if (imageData?.failed) {
                return this.createPlaceholderFill('Image failed to load');
            }
            
            if (imageData?.corsRestricted) {
                return this.createPlaceholderFill('CORS restricted image');
            }
            
            if (imageData?.buffer) {
                // Create Figma image from buffer
                const figmaImage = await this.figmaApi.createImage(imageData.buffer);
                
                const processingTime = Date.now() - startTime;
                
                // 缓存结果
                ImageCreator.imageHashCache.set(jsonImageHash, figmaImage.hash);
    
                return {
                    ...fill,
                    imageHash: figmaImage.hash,
                    visible: true
                };
            } else if (imageData?.base64) {
                // Convert base64 to buffer and create image
                const buffer = this.base64ToBuffer(imageData.base64);
                
                const figmaImage = await this.figmaApi.createImage(buffer);
                
                const processingTime = Date.now() - startTime;
                
                // 缓存结果
                ImageCreator.imageHashCache.set(jsonImageHash, figmaImage.hash);
                return {
                    ...fill,
                    imageHash: figmaImage.hash,
                    visible: true
                };
            } else {
                // Use existing hash (might be a placeholder)
                return this.createPlaceholderFill('No image data');
            }
        } catch (error) {
            const processingTime = Date.now() - startTime;
            return this.createPlaceholderFill('Processing failed');
        }
    }

    /**
     * Create placeholder fill for failed images
     */
    private createPlaceholderFill(reason: string): any {
        const placeholderFill = {
            type: 'SOLID' as const,
            color: { r: 0.9, g: 0.9, b: 0.9 },
            opacity: 1,
            visible: true,
            blendMode: 'NORMAL' as const
        };
        
        return placeholderFill;
    }

    /**
     * Handle background image data (Frame + Image combination)
     */
    private async handleBackgroundImageData(rectangle: RectangleNode, backgroundImageData: any): Promise<void> {
        // This method would be called by a parent Frame creator
        // For now, we'll store the data for later processing
        (rectangle as any)._backgroundImageData = backgroundImageData;
    }

    /**
     * Apply image metadata to the node and handle URL fetching if needed
     */
    private async applyImageMetadata(rectangle: RectangleNode, metadata: any): Promise<void> {
        // Store metadata for debugging or future use
        (rectangle as any)._imageMetadata = metadata;
        
        // If metadata contains a URL, try to download and create image fill
        const fills = rectangle.fills as readonly any[] | undefined;
        if (metadata.originalUrl && !fills?.some((fill: any) => fill.type === 'IMAGE' && fill.imageHash)) {
            try {
                // Use the new downloadImageFromMetadata method
                const imageFill = await this.downloadImageFromMetadata(metadata);
                
                // Replace or add the image fill with error handling
                try {
                    ImageCreator.updateNodeFills(rectangle, imageFill);
                } catch (fillError) {
                    throw fillError;
                }
            
            } catch (error) {
                // Keep existing fills or create placeholder
                if (!fills || (fills as any[]).length === 0) {
                    ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill(`Failed to fetch: ${metadata.originalUrl}`));
                }
            }
        } else if (!metadata.originalUrl) {
            // Fallback to old method if no originalUrl
            const imageUrl = this.extractUrlFromMetadata(metadata);
            if (imageUrl && !fills?.some((fill: any) => fill.type === 'IMAGE' && fill.imageHash)) {
                try {
                    const buffer = await this.fetchImageFromUrl(imageUrl);
                    const figmaImage = await this.figmaApi.createImage(buffer);
                    
                    // Create image fill
                    const imageFill = {
                        type: 'IMAGE' as const,
                        imageHash: figmaImage.hash,
                        scaleMode: 'FILL' as const,
                        visible: true
                    };
                    
                    // Replace or add the image fill
                    ImageCreator.updateNodeFills(rectangle, imageFill);
                    
                } catch (error) {
                    // Keep existing fills or create placeholder
                    if (!fills || (fills as any[]).length === 0) {
                        ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill(`Failed to fetch: ${imageUrl}`));
                    }
                }
            }
        }
        
        // Optionally adjust node size based on image dimensions
        if (metadata.width && metadata.height && this.shouldPreserveImageDimensions()) {
            // Only adjust if the current size is default/placeholder
            if (rectangle.width === 100 && rectangle.height === 100) {
                const maxSize = 500; // Maximum size limit
                const scale = Math.min(maxSize / metadata.width, maxSize / metadata.height, 1);

                rectangle.resize(metadata.width * scale, metadata.height * scale);
            }
        }
    }

    /**
     * Get image data from global context or cache
     */
    private getImageData(imageHash: string): any {
        // This would typically access a global image data store
        // For now, we'll check if it's available on the global context
        const globalContext = (globalThis as any).__imageDataContext;
        return globalContext?.imageData?.get(imageHash);
    }

    /**
     * Fetch image from URL and convert to buffer
     */
    private async fetchImageFromUrl(url: string): Promise<Uint8Array> {
        try {
            // Use fetch to get the image
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            // Check content type
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.startsWith('image/')) {
                throw new Error(`Invalid content type: ${contentType}`);
            }
            
            // Convert to array buffer then to Uint8Array
            const fetchResponse = response as Response;
            const arrayBuffer = await fetchResponse.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);
            
            return buffer;
            
        } catch (error) {
            // Check for common error types
            if (error instanceof TypeError && error.message.includes('CORS')) {
                throw new Error(`CORS error when fetching image: ${url}`);
            }
            
            if (error instanceof TypeError && error.message.includes('network')) {
                throw new Error(`Network error when fetching image: ${url}`);
            }
            
            throw error;
        }
    }

    /**
     * Convert base64 to Uint8Array buffer
     */
    private base64ToBuffer(base64: string): Uint8Array {
        // Remove data URL prefix if present
        const base64Data = base64.replace(/^data:image\/[^;]+;base64,/, '');
        
        // Decode base64
        const binaryString = atob(base64Data);
        const buffer = new Uint8Array(binaryString.length);
        
        for (let i = 0; i < binaryString.length; i++) {
            buffer[i] = binaryString.charCodeAt(i);
        }
        
        return buffer;
    }

    /**
     * Check if we should preserve original image dimensions
     */
    private shouldPreserveImageDimensions(): boolean {
        // This could be configurable
        return false; // Default: don't auto-resize
    }

    /**
     * Extract URL from various metadata formats
     */
    private extractUrlFromMetadata(metadata: any): string | null {
        if (!metadata) return null;
        
        // Check common URL properties
        if (metadata.originalUrl) return metadata.originalUrl;
        if (metadata.url) return metadata.url;
        if (metadata.src) return metadata.src;
        if (metadata.href) return metadata.href;
        
        return null;
    }

    /**
     * Clear the image hash cache
     * 清空图片哈希缓存
     */
    static clearImageCache(): void {
        ImageCreator.imageHashCache.clear();
        ImageCreator.cacheStats = { hits: 0, misses: 0 };
    }

    /**
     * Get cache statistics
     * 获取缓存统计信息
     */
    static getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        const { hits, misses } = ImageCreator.cacheStats;
        const total = hits + misses;
        const hitRate = total > 0 ? (hits / total) * 100 : 0;
        
        return {
            size: ImageCreator.imageHashCache.size,
            hits,
            misses,
            hitRate: Math.round(hitRate * 100) / 100 // 保留两位小数
        };
    }

    /**
     * Log cache statistics
     * 输出缓存统计信息
     */
    static logCacheStats(): void {
        const stats = ImageCreator.getCacheStats();
    }

    /**
     * Validate image-specific data
     */
    protected validateData(data: FigmaRectangleNode): boolean {
        super.validateData(data);
        
        if (data.type !== 'RECTANGLE') {
            throw new Error(`Expected RECTANGLE type for image, got ${data.type}`);
        }
        
        // Validate image fills if present
        if (data.fills) {
            for (const fill of data.fills) {
                if (fill.type === 'IMAGE' && !(fill as any).imageHash) {
                    // Image fill missing imageHash, will use placeholder
                }
            }
        }
        
        return true;
    }
}
