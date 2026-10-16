// Base class for all Figma node creators
import { FigmaNodeBase, SharedPluginDataMap } from '@html2figma/shared';
import { createLogger } from '@html2figma/shared';
import { LogModule } from '@html2figma/shared';

export abstract class BaseNodeCreator<T extends FigmaNodeBase, F> {
    protected figmaApi: any;
    protected logger = createLogger('BaseNodeCreator');

    constructor(figmaApi: any) {
        this.figmaApi = figmaApi;
    }

    /**
     * Create a Figma node from JSON data (only creates the node, doesn't set properties)
     */
    abstract create(data: T): F;

    /**
     * Set all properties for the node after creation
     */
    abstract setProperties(node: F, data: T): void;

    /**
     * Set basic properties common to all nodes
     */
    protected setBaseProperties(node: any, data: FigmaNodeBase): void {
        const nodeName = data.name || 'Layer';
        this.logger.info(`🔧 设置基础属性: "${nodeName}"`);
        
        node.name = nodeName;
        node.visible = data.visible !== false;
        node.locked = data.locked || false;
        
        this.logger.info(`  - 名称: "${nodeName}", 可见: ${node.visible}, 锁定: ${node.locked}`);

        // Set position — but skip for flow children in auto-layout frames.
        // In Figma, auto-layout manages the position of flow children via padding/gap/alignment.
        // Setting node.x/y on a flow child overrides auto-layout and breaks positioning.
        // Only absolute/fixed children (layoutPositioning = 'ABSOLUTE') need explicit x/y.
        const isAbsoluteChild = data.layoutPositioning === 'ABSOLUTE';
        const parentIsAutoLayout = this.isParentAutoLayout(node);
        const shouldSetPosition = !parentIsAutoLayout || isAbsoluteChild;

        if (shouldSetPosition) {
            if ('x' in data) {
                node.x = data.x || 0;
                this.logger.info(`  - X 位置: ${node.x}`);
            }
            if ('y' in data) {
                node.y = data.y || 0;
                this.logger.info(`  - Y 位置: ${node.y}`);
            }
        } else {
            this.logger.info(`  - 跳过 x/y 设置（父节点是 auto-layout，当前节点是 flow child）`);
        }
        
        // Note: Size will be set after layout properties are configured
        // This ensures auto-layout axis properties are set before dimensions

        // Set rotation if available
        if ('rotation' in data && data.rotation) {
            node.rotation = data.rotation;
            this.logger.info(`  - 旋转: ${data.rotation}°`);
        }

        // // Set layout sizing for auto-layout children
        // if ('layoutSizingHorizontal' in data && data.layoutSizingHorizontal) {
        //     (node as any).layoutSizingHorizontal = data.layoutSizingHorizontal;
        //     this.logger.info(`  - 水平尺寸: ${data.layoutSizingHorizontal}`);
        // }
        // if ('layoutSizingVertical' in data && data.layoutSizingVertical) {
        //     (node as any).layoutSizingVertical = data.layoutSizingVertical;
        //     this.logger.info(`  - 垂直尺寸: ${data.layoutSizingVertical}`);
        // }

        // Set opacity if available
        if ('opacity' in data && data.opacity !== undefined) {
            node.opacity = data.opacity;
            this.logger.info(`  - 透明度: ${data.opacity}`);
        }

        // Set blend mode if available
        if ('blendMode' in data && data.blendMode) {
            node.blendMode = data.blendMode;
            this.logger.info(`  - 混合模式: ${data.blendMode}`);
        }

        // Set layout positioning if available
        // 只要父节点是 auto layout，任何类型的子节点都可以设置 layoutPositioning
        if ('layoutPositioning' in data && data.layoutPositioning) {
            this.setLayoutPositioning(node, data);
        }
        
        // Write semantic metadata via sharedPluginData for round-trip mapping
        if (data.sharedPluginData) {
            this.setSharedPluginData(node, data.sharedPluginData);
        }

        this.logger.info(`✅ 基础属性设置完成: "${nodeName}"`);
    }

    /**
     * Write semantic metadata to Figma node via sharedPluginData.
     * Uses namespace 'html2figma' so any plugin can read it.
     */
    protected setSharedPluginData(node: any, dataMap: SharedPluginDataMap): void {
        const NAMESPACE = 'html2figma';
        try {
            if (typeof node.setSharedPluginData !== 'function') return;
            for (const [key, value] of Object.entries(dataMap)) {
                if (value !== undefined && value !== null) {
                    node.setSharedPluginData(NAMESPACE, key, String(value));
                }
            }
            this.logger.info(`  - 已写入 sharedPluginData (${Object.keys(dataMap).length} 个字段)`);
        } catch (error) {
            this.logger.warn(`⚠️ 写入 sharedPluginData 失败`, error);
        }
    }

    /**
     * Set size properties after layout properties are configured
     * This ensures auto-layout axis properties are set before dimensions
     */
    protected setSizeProperties(node: any, data: FigmaNodeBase): void {
        if ('width' in data && 'height' in data) {
            const width = data.width || 1;
            const height = data.height || 1;
            node.resize(width, height);
            this.logger.info(`📏 设置尺寸 (在布局属性之后): ${width} × ${height}`);
        }
    }

    /**
     * Set fill properties
     */
    protected setFills(node: any, fills: any[]): void {
        
        if (fills && fills.length > 0) {
            fills.forEach((fill, index) => {
                
                if (fill.type === 'GRADIENT_LINEAR' || fill.type === 'GRADIENT_RADIAL') {
                }
            });
            
            try {
                node.fills = fills;
            } catch (error) {
                throw error;
            }
        } else {
            node.fills = [];
        }
    }

    /**
     * Set stroke properties
     */
    protected setStrokes(node: any, strokes: any[], strokeWeight?: number, strokeAlign?: string, strokeTopWeight?: number, strokeRightWeight?: number, strokeBottomWeight?: number, strokeLeftWeight?: number, strokeDashPattern?: number[]): void {

        if (strokes && strokes.length > 0) {
            node.strokes = strokes;
        }

        
        if (strokeWeight !== undefined) {
            node.strokeWeight = strokeWeight;
        }
        
        if (strokeAlign) {
            node.strokeAlign = strokeAlign;
        }

       
        if (strokeTopWeight !== undefined || strokeRightWeight !== undefined || strokeBottomWeight !== undefined || strokeLeftWeight !== undefined) {
            node.strokeTopWeight = strokeTopWeight || 0;
            node.strokeRightWeight = strokeRightWeight || 0;
            node.strokeBottomWeight = strokeBottomWeight || 0;
            node.strokeLeftWeight = strokeLeftWeight || 0;
        }

        if (strokeDashPattern !== undefined) {
            node.dashPattern = strokeDashPattern;
        }
    }

    /**
     * Set corner radius for rectangular shapes
     */
    protected setCornerRadius(node: any, cornerRadius?: number): void {
        if (cornerRadius !== undefined && 'cornerRadius' in node) {
            node.cornerRadius = cornerRadius;
        }
    }

    /**
     * Set effects (shadows, blurs, etc.)
     */
    protected setEffects(node: any, effects: any[]): void {
        if (effects && effects.length > 0) {
            node.effects = effects;
        }
    }

    /**
     * Set layout positioning for element positioning
     * 只在父节点是 auto layout 时设置，子节点本身类型不限制
     */
    protected setLayoutPositioning(node: any, data: any): void {
        const layoutPositioning = data.layoutPositioning;
        if (!layoutPositioning || !node) {
            return;
        }

        try {
            // 检查父节点是否是 auto layout
            if (this.isParentAutoLayout(node)) {
                node.layoutPositioning = layoutPositioning;
                
                // 如果是绝对定位，恢复原始坐标
                if (layoutPositioning === 'ABSOLUTE' && data.x !== undefined && data.y !== undefined) {
                    node.x = data.x;
                    node.y = data.y;
                    this.logger.info(`  - 布局定位: ${layoutPositioning}，坐标: (${data.x}, ${data.y})`);
                } else {
                    this.logger.info(`  - 布局定位: ${layoutPositioning}`);
                }

                // Set constraints for absolute children (e.g. right-center for select chevron)
                if (data.constraints) {
                    try {
                        node.constraints = data.constraints;
                        this.logger.info(`  - 约束: H=${data.constraints.horizontal}, V=${data.constraints.vertical}`);
                    } catch (e) {
                        this.logger.warn(`⚠️ 设置约束失败`, e);
                    }
                }
            } else {
                // 父节点不是 auto layout，但如果是绝对定位，仍需确保坐标正确
                if (layoutPositioning === 'ABSOLUTE' && data.x !== undefined && data.y !== undefined) {
                    node.x = data.x;
                    node.y = data.y;
                    this.logger.info(`  - 绝对定位（父节点非 auto layout），坐标: (${data.x}, ${data.y})`);
                } else {
                    this.logger.info(`  - 跳过布局定位设置，父节点不是 auto layout`);
                }
            }
        } catch (error) {
            this.logger.warn(`⚠️ 设置布局定位失败: ${layoutPositioning}`, error);
            // Don't throw error, layout positioning is not critical for node creation
        }
    }

    /**
     * 检查父节点是否是 auto layout
     */
    protected isParentAutoLayout(node: any): boolean {
        try {
            // 检查节点是否有父节点
            if (!node.parent) {
                return false;
            }

            // 检查父节点是否有 layoutMode 属性且不为 'NONE'
            const parent = node.parent as any;
            if ('layoutMode' in parent && parent.layoutMode && parent.layoutMode !== 'NONE') {
                return true;
            } else {
                return false;
            }
        } catch (error) {
            this.logger.warn(`检查父节点 auto layout 状态失败:`, error);
            return false;
        }
    }


    /**
     * Validate node data before creation
     */
    protected validateData(data: T): boolean {
        if (!data) {
            throw new Error('Node data is required');
        }
        
        if (!data.type) {
            throw new Error('Node type is required');
        }
        
        return true;
    }

    /**
     * Log creation for debugging
     */
    protected logCreation(nodeType: string, nodeName: string): void {
        // Detailed logging now handled in specific creators
    }

    /**
     * Handle errors during node creation
     */
    protected handleError(error: Error, nodeType: string, data: T): never {
        const message = `Failed to create ${nodeType} node: ${error.message}`;
        throw new Error(message);
    }
}
