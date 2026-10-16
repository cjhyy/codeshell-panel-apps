// High-level service for Figma operations
import { FigmaFrameNode, FigmaNode, generateId } from '@html2figma/shared';
import { NodeCreatorFactory } from './factory/NodeCreatorFactory';
import { FrameCreator } from './creators/FrameCreator';
import { StyleProcessor } from './utils/StyleProcessor';
import { LayoutProcessor } from './utils/LayoutProcessor';
import { ImageProcessor, ImageProcessingOptions } from './utils/ImageProcessor';
import { ImageProcessingConfig } from './types';

export interface FigmaServiceOptions {
    autoFocus?: boolean;
    validateNodes?: boolean;
    logOperations?: boolean;
    imageProcessing?: ImageProcessingConfig;
}

export class FigmaService {
    private factory: NodeCreatorFactory;
    private imageProcessor: ImageProcessor;
    private options: Required<FigmaServiceOptions>;
    private figmaApi: any;

    constructor(figmaApi: any, options: FigmaServiceOptions = {}) {
        this.figmaApi = figmaApi;
        this.factory = new NodeCreatorFactory(figmaApi);
        this.imageProcessor = new ImageProcessor(figmaApi, options.imageProcessing);
        this.options = {
            autoFocus: true,
            validateNodes: true,
            logOperations: false,
            imageProcessing: {},
            ...options
        };
    }

    /**
     * Add layers from Figma JSON to a parent node
     */
    async addLayersToFrame(
        figmaJson: FigmaFrameNode,
        parentNode: any = (globalThis as any).figma?.currentPage
    ): Promise<any> {
        try {
            // Adding layers to frame

            // Validate input if enabled
            if (this.options.validateNodes) {
                this.validateFigmaJson(figmaJson);
            }

            // Create the root frame
            const rootFrame = this.factory.createTree(figmaJson);

            // Wait for all async image fills (processImageBackgrounds) to complete
            await FrameCreator.awaitPendingImages();

            // Add to parent (only if parentNode is provided and not null)
            if (parentNode && typeof parentNode.appendChild === 'function') {
                // Appending root frame to parent
                parentNode.appendChild(rootFrame);
            } else if (parentNode === null) {
                // Parent node is null, skipping appendChild
            }

            // Auto-focus if enabled
            if (this.options.autoFocus && (globalThis as any).figma?.viewport) {
                (globalThis as any).figma.viewport.scrollAndZoomIntoView([rootFrame]);
            }


            // Successfully added layers to frame

            return rootFrame;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Create a single Figma node from JSON
     */
    createFigmaNode(nodeData: FigmaNode): any {
        try {
            if (this.options.validateNodes) {
                this.validateNodeData(nodeData);
            }

            return this.factory.create(nodeData);
        } catch (error) {
            throw error;
        }
    }

    /**
     * Batch create multiple nodes
     */
    createMultipleNodes(nodesData: FigmaNode[]): {
        successful: any[];
        failed: { nodeData: FigmaNode; error: string }[];
    } {
        return this.factory.createBatch(nodesData);
    }

    /**
     * Create a frame with auto-layout from HTML structure
     */
    createAutoLayoutFrame(
        name: string,
        children: FigmaNode[],
        layoutOptions: {
            direction?: 'HORIZONTAL' | 'VERTICAL';
            alignment?: 'MIN' | 'CENTER' | 'MAX';
            spacing?: number;
            padding?: number;
        } = {}
    ): any {
        const frameData: FigmaFrameNode = {
            id: generateId('svc'),
            name: name,
            type: 'FRAME',
            visible: true,
            locked: false,
            x: 0,
            y: 0,
            width: 200,
            height: 200,
            children: children,
            layoutMode: layoutOptions.direction || 'VERTICAL',
            primaryAxisAlignItems: layoutOptions.alignment || 'MIN',
            counterAxisAlignItems: 'MIN',
            itemSpacing: layoutOptions.spacing || 10,
            paddingLeft: layoutOptions.padding || 0,
            paddingRight: layoutOptions.padding || 0,
            paddingTop: layoutOptions.padding || 0,
            paddingBottom: layoutOptions.padding || 0,
            clipsContent: false
        };

        return this.factory.create(frameData);
    }

    /**
     * Create a styled rectangle
     */
    createStyledRectangle(
        name: string,
        dimensions: { width: number; height: number; x?: number; y?: number },
        styling: {
            fill?: { r: number; g: number; b: number };
            stroke?: { r: number; g: number; b: number };
            strokeWidth?: number;
            cornerRadius?: number;
            opacity?: number;
        } = {}
    ): any {
        const fills = styling.fill ? [StyleProcessor.createSolidPaint(styling.fill)] : [];
        const strokes = styling.stroke ? [StyleProcessor.createSolidPaint(styling.stroke)] : [];

        const rectangleData = {
            id: generateId('svc'),
            name: name,
            type: 'RECTANGLE' as const,
            visible: true,
            locked: false,
            x: dimensions.x || 0,
            y: dimensions.y || 0,
            width: dimensions.width,
            height: dimensions.height,
            fills: fills,
            strokes: strokes,
            strokeWeight: styling.strokeWidth || 0,
            cornerRadius: styling.cornerRadius || 0,
            opacity: styling.opacity || 1
        };

        return this.factory.create(rectangleData as any);
    }

    /**
     * Create formatted text
     */
    createFormattedText(
        text: string,
        formatting: {
            fontSize?: number;
            fontFamily?: string;
            fontStyle?: string;
            color?: { r: number; g: number; b: number };
            alignment?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
            width?: number;
            height?: number;
            x?: number;
            y?: number;
        } = {}
    ): any {
        const fills = formatting.color ? [StyleProcessor.createSolidPaint(formatting.color)] : [];

        const textData = {
            id: generateId('svc'),
            name: text.substring(0, 50),
            type: 'TEXT' as const,
            visible: true,
            locked: false,
            x: formatting.x || 0,
            y: formatting.y || 0,
            width: formatting.width || 200,
            height: formatting.height || 50,
            characters: text,
            fontSize: formatting.fontSize || 16,
            fontName: formatting.fontFamily ? {
                family: formatting.fontFamily,
                style: formatting.fontStyle || 'Regular'
            } : undefined,
            textAlignHorizontal: formatting.alignment || 'LEFT',
            fills: fills,
            textAutoResize: 'WIDTH_AND_HEIGHT' as const
        };

        return this.factory.create(textData as any);
    }

    /**
     * Get service statistics
     */
    getStatistics(): {
        supportedNodeTypes: string[];
        createdNodesCount: number;
        lastOperation: string | null;
    } {
        return {
            supportedNodeTypes: this.factory.getSupportedTypes(),
            createdNodesCount: 0, // Would track in real implementation
            lastOperation: null // Would track in real implementation
        };
    }

    /**
     * Validate Figma JSON structure
     */
    private validateFigmaJson(figmaJson: FigmaFrameNode): void {
        if (!figmaJson) {
            throw new Error('Figma JSON is required');
        }

        if (!figmaJson.type) {
            throw new Error('Node type is required');
        }

        if (!figmaJson.name) {
            throw new Error('Node name is required');
        }

        // Validate dimensions
        if (figmaJson.width <= 0 || figmaJson.height <= 0) {
            throw new Error('Node dimensions must be positive');
        }

        // Recursively validate children
        if (figmaJson.children) {
            figmaJson.children.forEach((child, index) => {
                try {
                    this.validateNodeData(child);
                } catch (error) {
                    throw new Error(`Invalid child node at index ${index}: ${(error as Error).message}`);
                }
            });
        }
    }

    /**
     * Validate individual node data
     */
    private validateNodeData(nodeData: FigmaNode): void {
        if (!nodeData) {
            throw new Error('Node data is required');
        }

        if (!this.factory.isSupported(nodeData.type)) {
            throw new Error(`Unsupported node type: ${nodeData.type}`);
        }

        // Type-specific validation would go here
    }

    /**
     * Generate unique ID
     */
    /**
     * Process images in a node tree and handle large images asynchronously
     */
    async processImagesInTree(rootNode: any): Promise<{
        processedCount: number;
        deferredCount: number;
    }> {
        let processedCount = 0;
        let deferredCount = 0;

        const processNode = async (node: any) => {
            // Process fills that might contain images
            if (node.fills && Array.isArray(node.fills)) {
                const newFills = [];
                
                for (const fill of node.fills) {
                    if (fill.type === 'IMAGE' && (fill as any)._pendingImageUrl) {
                        // This is a deferred image, count it
                        deferredCount++;
                        newFills.push(fill);
                    } else if (fill.type === 'IMAGE' && fill.imageHash) {
                        // This is a processed image
                        processedCount++;
                        newFills.push(fill);
                    } else {
                        newFills.push(fill);
                    }
                }
                
                node.fills = newFills;
            }

            // Process children recursively
            if (node.children && Array.isArray(node.children)) {
                for (const child of node.children) {
                    await processNode(child);
                }
            }
        };

        await processNode(rootNode);

        // Image processing complete

        return { processedCount, deferredCount };
    }

    /**
     * Load all deferred images in a node tree
     */
    async loadDeferredImages(rootNode: any): Promise<number> {
        const loadedCount = await this.imageProcessor.loadAllDeferredImages(rootNode);
        
        // Loaded deferred images

        return loadedCount;
    }

    /**
     * Get image processor instance for advanced usage
     */
    getImageProcessor(): ImageProcessor {
        return this.imageProcessor;
    }

    /**
     * Update image processing configuration
     */
    updateImageProcessingConfig(config: Partial<ImageProcessingOptions>): void {
        this.imageProcessor = new ImageProcessor(this.figmaApi, {
            ...this.options.imageProcessing,
            ...config
        });
    }

    /**
     * Process a single image and return the paint
     */
    async processImage(
        imageData: { url?: string; base64?: string; hash?: string },
        scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' = 'FILL'
    ) {
        return await this.imageProcessor.processImage(imageData, scaleMode);
    }

    /**
     * Batch process multiple images
     */
    async processImageBatch(
        images: { 
            data: { url?: string; base64?: string; hash?: string }; 
            scaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE' 
        }[]
    ) {
        return await this.imageProcessor.processImageBatch(images);
    }

    /**
     * Create a node with image processing support
     */
    async createNodeWithImages(nodeData: FigmaNode): Promise<any> {
        // Create the base node
        const node = this.factory.create(nodeData);

        // Process any images in the node's fills (only for nodes that have fills)
        if ((nodeData as any).fills && Array.isArray((nodeData as any).fills)) {
            const processedFills = [];

            for (const fill of (nodeData as any).fills) {
                if (fill.type === 'IMAGE' && (fill as any).imageUrl) {
                    // Process image URL
                    const imageData = { url: (fill as any).imageUrl };
                    const processedImage = await this.imageProcessor.processImage(
                        imageData, 
                        fill.scaleMode || 'FILL'
                    );
                    processedFills.push(processedImage.paint);
                } else {
                    processedFills.push(fill);
                }
            }

            node.fills = processedFills;
        }

        return node;
    }
}
