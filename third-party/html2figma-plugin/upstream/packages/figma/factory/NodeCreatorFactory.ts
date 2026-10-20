// Factory for creating different types of Figma nodes
import { FigmaNode } from '@html2figma/shared';
import { FrameCreator } from '../creators/FrameCreator';
import { RectangleCreator } from '../creators/RectangleCreator';
import { TextCreator } from '../creators/TextCreator';
import { GroupCreator } from '../creators/GroupCreator';
import { ImageCreator } from '../creators/ImageCreator';
import { SVGCreator } from '../creators/SVGCreator';
import { createLogger } from '@html2figma/shared';
import { LogModule } from '@html2figma/shared';

export class NodeCreatorFactory {
    private frameCreator: FrameCreator;
    private rectangleCreator: RectangleCreator;
    private textCreator: TextCreator;
    private groupCreator: GroupCreator;
    private imageCreator: ImageCreator;
    private svgCreator: SVGCreator;
    private logger = createLogger(LogModule.FIGMA_CREATOR);

    constructor(figmaApi: any) {
        this.frameCreator = new FrameCreator(figmaApi);
        this.rectangleCreator = new RectangleCreator(figmaApi);
        this.textCreator = new TextCreator(figmaApi);
        this.groupCreator = new GroupCreator(figmaApi);
        this.imageCreator = new ImageCreator(figmaApi);
        this.svgCreator = new SVGCreator(figmaApi);
    }

    /**
     * Create a Figma node based on its type
     */
    create(nodeData: FigmaNode): any {
        const nodeName = nodeData.name || 'Unnamed';
        
        this.logger.info(`开始创建节点: ${nodeData.type} - "${nodeName}"`);
        try {
            let node: any;
            
            // Check if this is an image node (Rectangle with image fills or background image data)
            if (nodeData.type === 'RECTANGLE' && this.isImageNode(nodeData)) {
                this.logger.info(`检测到图片节点，使用 ImageCreator 创建: "${nodeName}"`);
                node = this.imageCreator.create(nodeData as any);
            } else {
                switch (nodeData.type) {
                    case 'FRAME':
                        this.logger.info(`使用 FrameCreator 创建框架节点: "${nodeName}"`);
                        node = this.frameCreator.create(nodeData as any);
                        break;
                    
                    case 'RECTANGLE':
                        this.logger.info(`使用 RectangleCreator 创建矩形节点: "${nodeName}"`);
                        node = this.rectangleCreator.create(nodeData as any);
                        break;
                    
                    case 'TEXT':
                        this.logger.info(`使用 TextCreator 创建文本节点: "${nodeName}"`,nodeData);
                        node = this.textCreator.create(nodeData as any);
                        break;
                    
                    case 'GROUP':
                        this.logger.info(`使用 GroupCreator 创建组节点: "${nodeName}"`);
                        node = this.groupCreator.create(nodeData as any);
                        break;
                    
                    case 'SVG':
                        this.logger.info(`使用 SVGCreator 创建SVG节点: "${nodeName}"`);
                        node = this.svgCreator.create(nodeData as any);
                        break;
                    
                    default:
                        this.logger.error(`不支持的节点类型: ${(nodeData as any).type}`);
                        throw new Error(`Unsupported node type: ${(nodeData as any).type}`);
                }
            }
            
            this.logger.info(`✅ 节点创建成功: ${nodeData.type} - "${nodeName}"`);
            return node;
            
        } catch (error) {
            this.logger.error(`❌ 节点创建失败: ${nodeData.type} - "${nodeName}"`, error);
            throw error;
        }
    }

    /**
     * Check if a rectangle node should be treated as an image node
     */
    private isImageNode(nodeData: FigmaNode): boolean {
        // Check for image fills
        if ('fills' in nodeData && nodeData.fills) {
            const hasImageFill = nodeData.fills.some((fill: any) => fill.type === 'IMAGE');
            if (hasImageFill) return true;
        }

        // Check for background image data
        if ((nodeData as any).backgroundImageData) {
            return true;
        }

        // Check for image metadata
        if ((nodeData as any).imageMetadata) {
            return true;
        }

        return false;
    }

    /**
     * Create multiple nodes from an array
     */
    createMultiple(nodesData: FigmaNode[]): any[] {
        return nodesData.map(nodeData => this.create(nodeData));
    }

    /**
     * Create a node tree recursively
     */
    createTree(rootNodeData: FigmaNode): any {
        const rootName = rootNodeData.name || 'Unnamed';
        this.logger.info(`🌳 开始创建节点树，根节点: ${rootNodeData.type} - "${rootName}"`);
        
        // Step 1: Create the node (without properties)
        const rootNode = this.create(rootNodeData);
        this.logger.info(`✅ 创建节点: "${rootName}"`);
        
        // Step 2: Set node properties
        this.setNodeProperties(rootNode, rootNodeData);
        this.logger.info(`✅ 设置节点属性: "${rootName}"`);
        
        // If the node has children, create them recursively
        if ('children' in rootNodeData && rootNodeData.children) {
            const childrenCount = rootNodeData.children.length;
            this.logger.info(`处理 ${childrenCount} 个子节点`);
            
            rootNodeData.children.forEach((childData, index) => {
                try {
                    const childName = childData.name || 'Unnamed';
                    this.logger.info(`创建子节点 ${index + 1}/${childrenCount}: ${childData.type} - "${childName}"`);
                    
                    // Only create the child node, don't set properties yet
                    const childNode = this.create(childData);

                    if (rootNode.appendChild && typeof rootNode.appendChild === 'function') {
                        // Add child to parent first
                        rootNode.appendChild(childNode);
                        this.logger.info(`✅ 添加子节点: "${childName}" -> "${rootName}"`);
                        
                        // Now set child properties (parent is already configured)
                        this.setNodeProperties(childNode, childData);
                        this.logger.info(`✅ 子节点属性设置完成: "${childName}"`);
                        
                        // Recursively process grandchildren
                        if ('children' in childData && childData.children && childData.children.length > 0) {
                            this.processChildrenRecursively(childNode, childData);
                        }
                        
                    } else {
                        this.logger.warn(`⚠️ 无法添加子节点，父节点不支持 appendChild: "${rootName}"`);
                    }
                } catch (error) {
                    const childName = childData.name || 'Unnamed';
                    this.logger.error(`❌ 创建子节点失败: "${childName}"`, error);
                    // Continue with other children instead of failing completely
                }
            });
        }
        
        // Re-resize root after all children are added (same reason as processChildrenRecursively)
        this.restoreFixedSize(rootNode, rootNodeData);

        this.logger.info(`🌳 节点树创建完成: "${rootName}"`);

        return rootNode;
    }

    /**
     * Recursively process children for a parent node that already has properties set
     */
    private processChildrenRecursively(parentNode: any, parentData: FigmaNode): void {
        if (!('children' in parentData) || !parentData.children || parentData.children.length === 0) {
            return;
        }

        const parentName = parentData.name || 'Unnamed';
        const childrenCount = parentData.children.length;
        this.logger.info(`递归处理 "${parentName}" 的 ${childrenCount} 个子节点`);

        parentData.children.forEach((childData, index) => {
            try {
                const childName = childData.name || 'Unnamed';
                this.logger.info(`递归创建子节点 ${index + 1}/${childrenCount}: ${childData.type} - "${childName}"`);

                // Step 1: Create child node (without properties)
                const childNode = this.create(childData);

                // Step 2: Add child to parent first
                if (parentNode.appendChild && typeof parentNode.appendChild === 'function') {
                    parentNode.appendChild(childNode);
                    this.logger.info(`递归添加子节点: "${childName}" -> "${parentName}"`);

                    // Step 3: Set child properties (after adding to parent)
                    this.setNodeProperties(childNode, childData);
                    this.logger.info(`递归子节点属性设置完成: "${childName}"`);

                    // Step 4: Recursively process grandchildren
                    if ('children' in childData && childData.children && childData.children.length > 0) {
                        this.processChildrenRecursively(childNode, childData);
                    }

                } else {
                    this.logger.warn(`⚠️ 递归无法添加子节点: "${parentName}"`);
                }

            } catch (error) {
                const childName = childData.name || 'Unnamed';
                this.logger.error(`❌ 递归处理子节点失败: "${childName}"`, error);
            }
        });

        // Re-resize parent after all children are added.
        // Figma auto-layout recalculates parent dimensions when children are appended,
        // which can override the intended FIXED size. Re-applying resize restores it.
        this.restoreFixedSize(parentNode, parentData);
    }

    /**
     * Re-apply resize for frames with FIXED sizing after children are added.
     * Figma auto-layout may recalculate dimensions during appendChild,
     * overriding the initial resize. This restores the intended size.
     */
    private restoreFixedSize(node: any, data: FigmaNode): void {
        if (data.type !== 'FRAME') return;
        const frameData = data as any;
        if (!frameData.width || !frameData.height) return;

        // Only restore for FIXED sizing axes. HUG (AUTO) frames should keep
        // their Figma-recalculated size after children are added.
        const isLayoutFrame = frameData.layoutMode && frameData.layoutMode !== 'NONE';
        if (!isLayoutFrame) return;

        const isVertical = frameData.layoutMode === 'VERTICAL';
        const primaryFixed = frameData.primaryAxisSizingMode === 'FIXED';
        const counterFixed = frameData.counterAxisSizingMode === 'FIXED';

        // Determine which axes need restoring
        const restoreW = isVertical ? counterFixed : primaryFixed;
        const restoreH = isVertical ? primaryFixed : counterFixed;
        if (!restoreW && !restoreH) return;

        const w = Math.round(frameData.width);
        const h = Math.round(frameData.height);

        try {
            if (node.resize && typeof node.resize === 'function') {
                const newW = restoreW ? w : Math.round(node.width);
                const newH = restoreH ? h : Math.round(node.height);
                if (Math.abs(node.width - newW) > 0.5 || Math.abs(node.height - newH) > 0.5) {
                    node.resize(newW, newH);
                    this.logger.info(`Restored size: "${frameData.name}" → ${newW}x${newH} (was ${Math.round(node.width)}x${Math.round(node.height)})`);
                }
            }
        } catch (error) {
            this.logger.warn(`Failed to restore size for "${frameData.name}":`, error);
        }
    }

    /**
     * Set properties for a node using the appropriate creator
     */
    private setNodeProperties(node: any, data: FigmaNode): void {
        const nodeName = data.name || 'Unnamed';
        this.logger.info(`🔧 设置节点属性: ${data.type} - "${nodeName}"`);
        
        try {
            switch (data.type) {
                case 'FRAME':
                    this.frameCreator.setProperties(node, data as any);
                    break;
                case 'GROUP':
                    this.groupCreator.setProperties(node, data as any);
                    break;
                case 'RECTANGLE':
                    if (this.isImageNode(data)) {
                        this.imageCreator.setProperties(node, data as any);
                    } else {
                        this.rectangleCreator.setProperties(node, data as any);
                    }
                    break;
                case 'TEXT':
                    this.textCreator.setProperties(node, data as any);
                    break;
                case 'SVG':
                    this.svgCreator.setProperties(node, data as any);
                    break;
                default:
                    this.logger.warn(`⚠️ 未知节点类型，无法设置属性: ${(data as any).type}`);
            }
            
            this.logger.info(`✅ 节点属性设置完成: ${data.type} - "${nodeName}"`);
            
        } catch (error) {
            this.logger.error(`❌ 设置节点属性失败: ${data.type} - "${nodeName}"`, error);
            throw error;
        }
    }

    /**
     * Get creator for specific node type
     */
    getCreator(nodeType: string) {
        switch (nodeType) {
            case 'FRAME':
                return this.frameCreator;
            case 'RECTANGLE':
                return this.rectangleCreator;
            case 'TEXT':
                return this.textCreator;
            case 'GROUP':
                return this.groupCreator;
            case 'SVG':
                return this.svgCreator;
            default:
                throw new Error(`No creator available for node type: ${nodeType}`);
        }
    }

    /**
     * Check if node type is supported
     */
    isSupported(nodeType: string): boolean {
        return ['FRAME', 'RECTANGLE', 'TEXT', 'GROUP', 'SVG'].includes(nodeType);
    }

    /**
     * Get list of supported node types
     */
    getSupportedTypes(): string[] {
        return ['FRAME', 'RECTANGLE', 'TEXT', 'GROUP', 'SVG'];
    }

    /**
     * Create node with validation
     */
    createSafe(nodeData: FigmaNode): { node: any | null; error: string | null } {
        try {
            if (!this.isSupported(nodeData.type)) {
                return {
                    node: null,
                    error: `Unsupported node type: ${nodeData.type}`
                };
            }

            const node = this.create(nodeData);
            return { node, error: null };
        } catch (error) {
            return {
                node: null,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Batch create nodes with error handling
     */
    createBatch(nodesData: FigmaNode[]): {
        successful: any[];
        failed: { nodeData: FigmaNode; error: string }[];
    } {
        const successful: any[] = [];
        const failed: { nodeData: FigmaNode; error: string }[] = [];

        nodesData.forEach(nodeData => {
            const result = this.createSafe(nodeData);
            if (result.node) {
                successful.push(result.node);
            } else {
                failed.push({ nodeData, error: result.error || 'Unknown error' });
            }
        });

        return { successful, failed };
    }
}
