// Frame node creator
import { FigmaFrameNode } from '@html2figma/shared';
import { BaseNodeCreator } from '../base/BaseNodeCreator';
import { createLogger } from '@html2figma/shared';
import { LogModule } from '@html2figma/shared';
import { ImageCreator } from './ImageCreator';

export class FrameCreator extends BaseNodeCreator<FigmaFrameNode, FrameNode> {
    protected logger = createLogger(LogModule.FRAME_CREATOR);

    // Collect async image promises so callers can await them after tree creation
    private static pendingImagePromises: Promise<void>[] = [];

    static awaitPendingImages(): Promise<void[]> {
        const promises = FrameCreator.pendingImagePromises;
        FrameCreator.pendingImagePromises = [];
        return Promise.all(promises);
    }


    /**
     * Create a Frame node from JSON data
     */
    create(data: FigmaFrameNode): FrameNode {
        const frameName = data.name || 'Frame';
        this.logger.info(`Creating Frame node: "${frameName}"`);

        try {
            this.validateData(data);

            const frame = this.figmaApi.createFrame();

            return frame;

        } catch (error) {
            this.logger.error(`Frame node creation failed: "${frameName}"`, error);
            this.handleError(error as Error, 'Frame', data);
        }
    }

    setProperties(frame: FrameNode, data: FigmaFrameNode): void {
        try {
            // Set base properties (without size)
            this.setBaseProperties(frame, data);
            
            // Set frame-specific properties
            this.setFrameProperties(frame, data);
            
            // Set styling properties
            this.setFrameStyling(frame, data);

            // Process ALL image backgrounds (supports multiple IMAGE fills with unique hashes)
            this.processImageBackgrounds(frame, data);
            
            // Set layout properties FIRST (axis configuration)
            this.setLayoutProperties(frame, data);
            
            // Set size properties AFTER layout is configured
            this.setSizeProperties(frame, data);
            
            // Add children if present
            if (data.children && data.children.length > 0) {
                this.addChildren(frame, data.children);
            }
            
            this.logger.info(`Frame properties set: "${frame}"`);

        } catch (error) {
            this.logger.error(`Failed to set child layout properties: "${frame}"`, error);
            throw error;
        }
    }

    /**
     * Set frame-specific properties
     */
    private setFrameProperties(frame: FrameNode, data: FigmaFrameNode): void {
        // Clipping
        if (data.clipsContent !== undefined) {
            frame.clipsContent = data.clipsContent;
        }
        
        // Note: Frame fills are handled uniformly via setFills in setFrameStyling
        // No special handling needed here — consistent with Rectangle
    }

    /**
     * Set frame styling properties
     */
    private setFrameStyling(frame: FrameNode, data: FigmaFrameNode): void {
        // Fills — filter out IMAGE fills without imageHash, and strip internal properties
        const safeFills = (data.fills || []).filter((fill: any) =>
            fill.type !== 'IMAGE' || (fill.imageHash && typeof fill.imageHash === 'string' && fill.imageHash.length > 0)
        ).map((fill: any) => {
            // Strip internal underscore-prefixed properties that Figma rejects
            const clean: any = {};
            for (const key of Object.keys(fill)) {
                if (!key.startsWith('_')) {
                    clean[key] = fill[key];
                }
            }
            return clean;
        });
        this.setFills(frame, safeFills);
        
        // Strokes
       
        this.setStrokes(frame, data.strokes || [], data.strokeWeight, data.strokeAlign, data.strokeTopWeight, data.strokeRightWeight, data.strokeBottomWeight, data.strokeLeftWeight, data.strokeDashPattern);
        
        // Corner radius (uniform + per-corner)
        this.setCornerRadiusProperties(frame, data);
        
        // Effects
        if (data.effects) {
            this.setEffects(frame, data.effects);
        }
    }

    /**
     * Set corner radius properties (supports uniform, per-corner, and array formats)
     */
    private setCornerRadiusProperties(frame: FrameNode, data: FigmaFrameNode): void {
        const frameAny = frame as any;
        
        // Method 1: cornerRadii array [topLeft, topRight, bottomRight, bottomLeft]
        if ((data as any).cornerRadii && Array.isArray((data as any).cornerRadii)) {
            const radii = (data as any).cornerRadii;
            if (radii.length === 4) {
                frameAny.topLeftRadius = radii[0];
                frameAny.topRightRadius = radii[1];
                frameAny.bottomRightRadius = radii[2];
                frameAny.bottomLeftRadius = radii[3];
                this.logger.info(`  - Corner radius (array): [${radii.join(', ')}]`);
                return; // Array takes highest priority
            }
        }
        
        // Method 2: Uniform corner radius
        if (data.cornerRadius !== undefined) {
            frameAny.cornerRadius = data.cornerRadius;
            this.logger.info(`  - Corner radius (uniform): ${data.cornerRadius}`);
            return; // Uniform takes priority over per-corner
        }

        // Method 3: Individual per-corner radius
        let hasIndividualRadius = false;
        if ((data as any).topLeftRadius !== undefined) {
            frameAny.topLeftRadius = (data as any).topLeftRadius;
            hasIndividualRadius = true;
        }
        
        if ((data as any).topRightRadius !== undefined) {
            frameAny.topRightRadius = (data as any).topRightRadius;
            hasIndividualRadius = true;
        }
        
        if ((data as any).bottomLeftRadius !== undefined) {
            frameAny.bottomLeftRadius = (data as any).bottomLeftRadius;
            hasIndividualRadius = true;
        }
        
        if ((data as any).bottomRightRadius !== undefined) {
            frameAny.bottomRightRadius = (data as any).bottomRightRadius;
            hasIndividualRadius = true;
        }
        
        if (hasIndividualRadius) {
            this.logger.info(`  - Corner radius (individual): TL=${frameAny.topLeftRadius}, TR=${frameAny.topRightRadius}, BR=${frameAny.bottomRightRadius}, BL=${frameAny.bottomLeftRadius}`);
        }
        
        // Corner smoothing (if supported)
        if ((data as any).cornerSmoothing !== undefined) {
            frameAny.cornerSmoothing = (data as any).cornerSmoothing;
        }
    }

    /**
     * Set layout properties for auto-layout.
     * Order matters: set axis properties first, then sizing and other properties.
     */
    private setLayoutProperties(frame: FrameNode, data: FigmaFrameNode): void {
        this.logger.info(`Setting layout properties`);

    
        // Layout mode (auto-layout) - 首先设置布局模式
        if (data.layoutMode && data.layoutMode !== 'NONE') {
            frame.layoutMode = data.layoutMode;
            this.logger.info(`Enabling auto-layout: ${data.layoutMode}`);

            // Step 2: Set axis alignment properties (before sizing)
            if (data.primaryAxisAlignItems) {
                frame.primaryAxisAlignItems = data.primaryAxisAlignItems;
                this.logger.info(`  - Primary axis align: ${data.primaryAxisAlignItems}`);
            }
            
            if (data.counterAxisAlignItems) {
                frame.counterAxisAlignItems = data.counterAxisAlignItems;
                this.logger.info(`  - Counter axis align: ${data.counterAxisAlignItems}`);
            }
            
            // Step 3: Set axis sizing modes (after alignment)
            if (data.primaryAxisSizingMode) {
                frame.primaryAxisSizingMode = data.primaryAxisSizingMode;
                this.logger.info(`  - Primary axis sizing: ${data.primaryAxisSizingMode}`);
            }

            if (data.counterAxisSizingMode) {
                frame.counterAxisSizingMode = data.counterAxisSizingMode;
                this.logger.info(`  - Counter axis sizing: ${data.counterAxisSizingMode}`);
            }

            if (data.layoutSizingHorizontal) {
                frame.layoutSizingHorizontal = data.layoutSizingHorizontal;
                this.logger.info(`  - Horizontal sizing: ${data.layoutSizingHorizontal}`);
            }

            if (data.layoutSizingVertical) {
                frame.layoutSizingVertical = data.layoutSizingVertical;
                this.logger.info(`  - Vertical sizing: ${data.layoutSizingVertical}`);
            }
            
            // Step 4: Set layout sizing properties
            this.setLayoutSizing(frame, data);
            
            // Padding
            const paddingInfo: string[] = [];
            if (data.paddingLeft !== undefined) {
                frame.paddingLeft = data.paddingLeft;
                paddingInfo.push(`L: ${data.paddingLeft}`);
            }
            if (data.paddingRight !== undefined) {
                frame.paddingRight = data.paddingRight;
                paddingInfo.push(`R: ${data.paddingRight}`);
            }
            if (data.paddingTop !== undefined) {
                frame.paddingTop = data.paddingTop;
                paddingInfo.push(`T: ${data.paddingTop}`);
            }
            if (data.paddingBottom !== undefined) {
                frame.paddingBottom = data.paddingBottom;
                paddingInfo.push(`B: ${data.paddingBottom}`);
            }
            
            if (paddingInfo.length > 0) {
                this.logger.info(`  - Padding: ${paddingInfo.join(', ')}`);
            }
            
            // Item spacing
            if (data.itemSpacing !== undefined) {
                frame.itemSpacing = data.itemSpacing;
                this.logger.info(`  - Item spacing: ${data.itemSpacing}`);
            }

            // Wrap
            if (data.layoutWrap) {
                frame.layoutWrap = data.layoutWrap;
                this.logger.info(`  - Layout wrap: ${data.layoutWrap}`);
            }
            if (data.counterAxisSpacing !== undefined) {
                frame.counterAxisSpacing = data.counterAxisSpacing;
                this.logger.info(`  - Counter axis spacing: ${data.counterAxisSpacing}`);
            }

            this.logger.info(`Auto-layout setup complete`);
        } else {
            this.logger.info(`Using manual layout (NONE)`);
        }
        
        // layoutPositioning is now handled in BaseNodeCreator.setBaseProperties
        // All node types (FRAME, TEXT, RECTANGLE, etc.) are processed there automatically
    }

    // isParentAutoLayout has been moved to BaseNodeCreator — no duplicate needed

    /**
     * Set Auto Layout sizing properties.
     */
    private setLayoutSizing(frame: FrameNode, data: FigmaFrameNode): void {
        const sizingInfo = [];

        // Set horizontal sizing mode
        if (data.layoutSizingHorizontal) {
            (frame as any).layoutSizingHorizontal = data.layoutSizingHorizontal;
            sizingInfo.push(`H: ${data.layoutSizingHorizontal}`);
            this.logger.info(`Setting horizontal sizing: ${data.layoutSizingHorizontal}`);
        }
        
        // Set vertical sizing mode
        if (data.layoutSizingVertical) {
            (frame as any).layoutSizingVertical = data.layoutSizingVertical;
            sizingInfo.push(`V: ${data.layoutSizingVertical}`);
            this.logger.info(`Setting vertical sizing: ${data.layoutSizingVertical}`);
        }
        
        if (sizingInfo.length > 0) {
            this.logger.info(`✅ Layout Sizing 设置完成: ${frame.name} - ${sizingInfo.join(', ')}`);
        }
    }

    /**
     * Process all IMAGE fills in data.fills, getting unique imageHashes for each.
     * Falls back to frame-level imageMetadata for backward compatibility.
     */
    private processImageBackgrounds(frame: FrameNode, data: FigmaFrameNode): void {
        // Collect IMAGE fills with per-fill _imageMetadata
        const imageFillEntries: Array<{ meta: any; fillIndex: number; scaleMode: string }> = [];

        if (data.fills) {
            data.fills.forEach((fill: any, index: number) => {
                if (fill.type === 'IMAGE' && fill._imageMetadata) {
                    const meta = fill._imageMetadata;
                    imageFillEntries.push({
                        meta,
                        fillIndex: index,
                        scaleMode: meta.scaleMode || fill.scaleMode || 'FILL',
                    });
                }
            });
        }

        // Fallback: use frame-level imageMetadata when no per-fill metadata exists
        if (imageFillEntries.length === 0) {
            const imageMetadata = (data as any).imageMetadata;
            if (imageMetadata && (imageMetadata.base64 || imageMetadata.originalUrl)) {
                const firstImageIdx = (data.fills || []).findIndex((f: any) => f.type === 'IMAGE');
                if (firstImageIdx >= 0) {
                    const fill = (data.fills as any[])[firstImageIdx];
                    imageFillEntries.push({
                        meta: imageMetadata,
                        fillIndex: firstImageIdx,
                        scaleMode: imageMetadata.scaleMode || fill.scaleMode || 'FILL',
                    });
                }
            }
        }

        if (imageFillEntries.length === 0) return;

        this.logger.info(`Processing ${imageFillEntries.length} IMAGE fill(s)`);

        // Process each IMAGE fill individually
        const processedFills = new Map<number, any>();
        const promises: Promise<void>[] = [];

        for (const entry of imageFillEntries) {
            const { meta, fillIndex, scaleMode } = entry;

            const processOne = async (): Promise<void> => {
                try {
                    let figmaImage: any;

                    // Resolve svgContent: from meta directly, or decode from base64 data URI
                    let svgContent: string | null = meta.svgContent ?? null;
                    if (!svgContent && meta.base64?.startsWith('data:image/svg')) {
                        const ci = meta.base64.indexOf(',');
                        if (ci !== -1) {
                            const payload = meta.base64.substring(ci + 1);
                            const isB64 = meta.base64.substring(0, ci).includes('base64');
                            try {
                                const decoded = isB64 ? atob(payload) : decodeURIComponent(payload);
                                if (decoded.trimStart().startsWith('<svg')) svgContent = decoded;
                            } catch { /* ignore */ }
                        }
                    }

                    if (meta.isSvg && svgContent) {
                        this.logger.info(`🖼️ SVG fill → createNodeFromSvg (${svgContent.length} chars) for fill[${fillIndex}]`);
                        const svgNode = this.figmaApi.createNodeFromSvg(svgContent);
                        const pngBytes = await svgNode.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
                        figmaImage = this.figmaApi.createImage(pngBytes);
                        svgNode.remove();
                        this.logger.info(`🖼️ SVG fill converted to PNG image hash: ${figmaImage.hash.substring(0, 8)}...`);
                    } else if (meta.isSvg && !svgContent) {
                        this.logger.warn(`⚠️ SVG fill has isSvg=true but no svgContent for fill[${fillIndex}], url: ${meta.originalUrl?.substring(0, 60)}`);
                    } else if (meta.base64) {
                        let base64Data = meta.base64;
                        if (base64Data.startsWith('data:')) {
                            const commaIndex = base64Data.indexOf(',');
                            if (commaIndex !== -1) base64Data = base64Data.substring(commaIndex + 1);
                        }
                        const bytes = ImageCreator.decodeBase64ToBytes(base64Data);
                        figmaImage = this.figmaApi.createImage(bytes);
                    } else if (meta.originalUrl) {
                        const response = await fetch(meta.originalUrl);
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        const buffer = new Uint8Array(await response.arrayBuffer());
                        figmaImage = this.figmaApi.createImage(buffer);
                    } else {
                        return;
                    }

                    const fill: Record<string, any> = {
                        type: 'IMAGE',
                        imageHash: figmaImage.hash,
                        scaleMode,
                        visible: true,
                    };

                    if (scaleMode === 'TILE') {
                        fill.scalingFactor = 1;
                    }
                    if (meta.imageTransform) {
                        fill.imageTransform = meta.imageTransform;
                    }
                    if (scaleMode === 'TILE' && meta.tileSize) {
                        try {
                            const naturalSize = await figmaImage.getSizeAsync();
                            if (naturalSize.width > 0) {
                                fill.scalingFactor = meta.tileSize.width / naturalSize.width;
                            }
                        } catch (e) { /* ignore */ }
                    }

                    processedFills.set(fillIndex, fill);
                    this.logger.info(`Processed IMAGE fill at index ${fillIndex}, hash: ${figmaImage.hash.substring(0, 8)}...`);
                } catch (error) {
                    this.logger.error(`Failed to process image fill at index ${fillIndex}:`, error);
                }
            };

            promises.push(processOne());
        }

        const imagePromise = Promise.all(promises).then(() => {
            if (data.fills && processedFills.size > 0) {
                const rebuiltFills = data.fills.map((fill: any, index: number) => {
                    if (processedFills.has(index)) {
                        return processedFills.get(index);
                    }
                    // Non-IMAGE fill: strip internal properties
                    const clean: any = {};
                    for (const key of Object.keys(fill)) {
                        if (!key.startsWith('_')) {
                            clean[key] = fill[key];
                        }
                    }
                    return clean;
                });
                frame.fills = rebuiltFills;
                this.logger.info(`Rebuilt ${rebuiltFills.length} fills with ${processedFills.size} processed IMAGE(s)`);
            }
        }).catch(error => {
            this.logger.error('Failed to process image backgrounds:', error);
        });

        FrameCreator.pendingImagePromises.push(imagePromise);
    }

    /**
     * Process SVG background image (create temp SVG node → export PNG → apply as fill)
     */
    private async processSvgBackground(frame: FrameNode, imageMetadata: any): Promise<void> {
        try {
            const svgNode = this.figmaApi.createNodeFromSvg(imageMetadata.svgContent);
            const pngBytes = await svgNode.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
            const figmaImage = this.figmaApi.createImage(pngBytes);
            svgNode.remove();
            const scaleMode = imageMetadata.scaleMode || 'FILL';
            const fill: Record<string, any> = {
                type: 'IMAGE' as const,
                imageHash: figmaImage.hash,
                scaleMode,
            };
            // TILE mode requires scalingFactor > 0 — default to 1.0
            if (scaleMode === 'TILE') {
                fill.scalingFactor = 1;
            }
            // TILE with explicit size: calculate scalingFactor
            if (scaleMode === 'TILE' && imageMetadata.tileSize) {
                try {
                    const naturalSize = await figmaImage.getSizeAsync();
                    if (naturalSize.width > 0) {
                        fill.scalingFactor = imageMetadata.tileSize.width / naturalSize.width;
                    }
                } catch (e) { /* ignore */ }
            }
            ImageCreator.updateNodeFills(frame, fill);
        } catch (error) {
            this.logger.error('Failed to process SVG background:', error);
        }
    }

    /**
     * Process URL-based background image (fetch → create image → apply as fill)
     */
    private async processUrlBackground(frame: FrameNode, imageMetadata: any): Promise<void> {
        try {
            const response = await fetch(imageMetadata.originalUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = new Uint8Array(await response.arrayBuffer());
            const figmaImage = this.figmaApi.createImage(buffer);
            const scaleMode = imageMetadata.scaleMode || 'FILL';
            const fill: Record<string, any> = {
                type: 'IMAGE' as const,
                imageHash: figmaImage.hash,
                scaleMode,
            };
            // TILE mode requires scalingFactor > 0 — default to 1.0
            if (scaleMode === 'TILE') {
                fill.scalingFactor = 1;
            }
            // TILE with explicit size: calculate scalingFactor
            if (scaleMode === 'TILE' && imageMetadata.tileSize) {
                try {
                    const naturalSize = await figmaImage.getSizeAsync();
                    if (naturalSize.width > 0) {
                        fill.scalingFactor = imageMetadata.tileSize.width / naturalSize.width;
                    }
                } catch (e) { /* ignore */ }
            }
            ImageCreator.updateNodeFills(frame, fill);
        } catch (error) {
            this.logger.error('Failed to fetch background image URL:', error);
        }
    }

    /**
     * Add children to the frame
     */
    private addChildren(frame: FrameNode, children: any[]): void {
        // Note: Child creation is handled by the parent FigmaService
        // This method is called after children are already created and processed
        // We just need to ensure the frame structure is correct
        
        // The children will be added by the NodeCreatorFactory.createTree method
        // which handles the recursive creation and appendChild operations
        
        // Children are handled by the NodeCreatorFactory.createTree method
        // This method is called during frame creation but actual child processing
        // happens in the factory's recursive tree creation
    }

    /**
     * Validate frame-specific data
     */
    protected validateData(data: FigmaFrameNode): boolean {
        super.validateData(data);
        
        if (data.type !== 'FRAME') {
            throw new Error(`Expected FRAME type, got ${data.type}`);
        }
        
        // Validate layout properties if auto-layout is used
        if (data.layoutMode && data.layoutMode !== 'NONE') {
            if (!['HORIZONTAL', 'VERTICAL'].includes(data.layoutMode)) {
                throw new Error(`Invalid layout mode: ${data.layoutMode}`);
            }
        }
        
        return true;
    }
}
