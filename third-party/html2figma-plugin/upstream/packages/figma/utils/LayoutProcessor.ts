// Utility for processing layout and positioning
import { createLogger } from '@html2figma/shared';
import { LogModule } from '@html2figma/shared';

export class LayoutProcessor {
    private static logger = createLogger(LogModule.LAYOUT_PROCESSOR);
    /**
     * Calculate auto-layout properties from CSS flexbox
     */
    static calculateAutoLayout(cssProperties: {
        display?: string;
        flexDirection?: string;
        justifyContent?: string;
        alignItems?: string;
        gap?: string;
        padding?: string;
    }, element?: Element, computedStyle?: CSSStyleDeclaration): {
        layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
        primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
        counterAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE';
        itemSpacing?: number;
        paddingLeft?: number;
        paddingRight?: number;
        paddingTop?: number;
        paddingBottom?: number;
        forceManualLayout?: boolean;
    } {
        this.logger.info(`🔄 计算自动布局属性`, cssProperties);
        
        const result: any = {
            layoutMode: 'NONE'
        };

        // 首先检查是否需要强制使用手动布局
        if (element && computedStyle && this.shouldForceManualLayout(element, computedStyle)) {
            this.logger.info(`🚫 强制使用手动布局 (检测到定位冲突或浮动子元素)`);
            result.forceManualLayout = true;
            return result;
        }

        // 检查是否是支持auto layout的容器类型
        const supportedDisplays = ['flex', 'inline-flex', 'grid', 'inline-grid'];
        const isFlexContainer = cssProperties.display === 'flex' || cssProperties.display === 'inline-flex';
        const isGridContainer = cssProperties.display === 'grid' || cssProperties.display === 'inline-grid';
        
        // 对于相对定位元素，即使不是flex/grid容器也可以使用auto layout
        if (computedStyle && computedStyle.position === 'relative') {
            // 相对定位元素默认使用垂直auto layout
            if (!supportedDisplays.includes(cssProperties.display || '')) {
                this.logger.info(`相对定位元素使用默认auto layout: position=relative, display=${cssProperties.display}`);
                result.layoutMode = 'VERTICAL';
                result.primaryAxisAlignItems = 'MIN';
                result.counterAxisAlignItems = 'MIN';
                return result;
            }
        } else if (!isFlexContainer && !isGridContainer) {
            this.logger.info(`非支持的容器类型，使用手动布局: display=${cssProperties.display}`);
            return result;
        }

        // 处理flex容器
        if (isFlexContainer) {
            // Determine layout direction
            const flexDirection = cssProperties.flexDirection || 'row';
            result.layoutMode = flexDirection.includes('column') ? 'VERTICAL' : 'HORIZONTAL';
            this.logger.info(`📐 检测到 Flex 布局: ${result.layoutMode} (flex-direction: ${flexDirection})`);
        } else if (isGridContainer) {
            // 对于grid容器，使用grid布局计算
            const gridLayout = this.calculateGridLayout(cssProperties as any, element);
            result.layoutMode = gridLayout.layoutMode;
            this.logger.info(`📐 检测到 Grid 布局: ${result.layoutMode}`);
        }

        // 处理对齐属性（适用于flex和grid容器）
        if (isFlexContainer || isGridContainer) {
            // Map justify-content to primary axis alignment
            const justifyContent = cssProperties.justifyContent;
            switch (justifyContent) {
                case 'flex-start':
                case 'start':
                    result.primaryAxisAlignItems = 'MIN';
                    break;
                case 'center':
                    result.primaryAxisAlignItems = 'CENTER';
                    break;
                case 'flex-end':
                case 'end':
                    result.primaryAxisAlignItems = 'MAX';
                    break;
                case 'space-between':
                    result.primaryAxisAlignItems = 'SPACE_BETWEEN';
                    break;
                default:
                    result.primaryAxisAlignItems = 'MIN';
            }
            this.logger.info(`  - 主轴对齐: ${justifyContent} -> ${result.primaryAxisAlignItems}`);

            // Map align-items to counter axis alignment
            const alignItems = cssProperties.alignItems;
            switch (alignItems) {
                case 'flex-start':
                case 'start':
                    result.counterAxisAlignItems = 'MIN';
                    break;
                case 'center':
                    result.counterAxisAlignItems = 'CENTER';
                    break;
                case 'flex-end':
                case 'end':
                    result.counterAxisAlignItems = 'MAX';
                    break;
                case 'baseline':
                    result.counterAxisAlignItems = 'BASELINE';
                    break;
                case 'stretch':
                    // Figma doesn't support stretch, use MIN as fallback
                    result.counterAxisAlignItems = 'MAX';
                    break;
                default:
                    result.counterAxisAlignItems = 'MIN';
            }
            this.logger.info(`  - 交叉轴对齐: ${alignItems} -> ${result.counterAxisAlignItems}`);
        }

        // Parse gap
        if (cssProperties.gap) {
            const gap = this.parseCSSValue(cssProperties.gap);
            if (gap) {
                result.itemSpacing = gap;
                this.logger.info(`  - 间距: ${cssProperties.gap} -> ${gap}px`);
            }
        }

        // Parse padding
        if (cssProperties.padding) {
            const padding = this.parsePadding(cssProperties.padding);
            Object.assign(result, padding);
            this.logger.info(`  - 内边距: ${cssProperties.padding}`, padding);
        }

        this.logger.info(`✅ 自动布局计算完成:`, result);
        return result;
    }

    /**
     * Calculate grid layout properties - 专注于Grid布局和FILL sizing
     */
    static calculateGridLayout(cssProperties: {
        display?: string;
        gridTemplateColumns?: string;
        gridTemplateRows?: string;
        gridTemplateAreas?: string;
        gap?: string;
        gridGap?: string;
        columnGap?: string;
        rowGap?: string;
        justifyContent?: string;
        alignContent?: string;
    }, element?: Element): {
        isGrid: boolean;
        columns: number;
        rows: number;
        columnGap: number;
        rowGap: number;
        templateColumns?: any;
        templateRows?: any;
        templateAreas?: string[][];
        areaMap?: Map<string, any>;
        justifyContent?: string;
        alignContent?: string;
        gridType: 'horizontal' | 'vertical' | '2d' | 'simple';
        layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
        childrenNeedFillSizing: boolean;
    } {
        this.logger.info(`🔲 计算Grid布局属性`, cssProperties);
        
        const result: any = {
            isGrid: false,
            columns: 1,
            rows: 1,
            columnGap: 0,
            rowGap: 0,
            gridType: 'simple',
            layoutMode: 'NONE',
            childrenNeedFillSizing: false
        };

        if (cssProperties.display !== 'grid' && cssProperties.display !== 'inline-grid') {
            return result;
        }

        result.isGrid = true;

        // Parse grid template columns with enhanced support
        if (cssProperties.gridTemplateColumns && cssProperties.gridTemplateColumns !== 'none') {
            result.templateColumns = this.parseGridTemplate(cssProperties.gridTemplateColumns);
            result.columns = result.templateColumns.tracks.length;
            this.logger.info(`📐 解析grid-template-columns: ${result.columns}列`, result.templateColumns);
        }

        // Parse grid template rows with enhanced support
        if (cssProperties.gridTemplateRows && cssProperties.gridTemplateRows !== 'none') {
            result.templateRows = this.parseGridTemplate(cssProperties.gridTemplateRows);
            result.rows = result.templateRows.tracks.length;
            this.logger.info(`📐 解析grid-template-rows: ${result.rows}行`, result.templateRows);
        }

        // Parse grid template areas
        if (cssProperties.gridTemplateAreas && cssProperties.gridTemplateAreas !== 'none') {
            result.templateAreas = this.parseGridTemplateAreas(cssProperties.gridTemplateAreas);
            result.areaMap = this.createGridAreaMap(result.templateAreas);
            this.logger.info(`🗺️ 解析grid-template-areas`, result.areaMap);
        }

        // 确定网格类型和布局模式
        if (result.columns > 1 && result.rows <= 1) {
            result.gridType = 'horizontal';
            result.layoutMode = 'HORIZONTAL';
            result.childrenNeedFillSizing = true; // 水平网格子元素需要FILL
        } else if (result.rows > 1 && result.columns <= 1) {
            result.gridType = 'vertical';
            result.layoutMode = 'VERTICAL';
            result.childrenNeedFillSizing = true; // 垂直网格子元素需要FILL
        } else if (result.columns > 1 && result.rows > 1) {
            result.gridType = '2d';
            result.layoutMode = 'VERTICAL'; // 二维网格使用垂直作为主轴
            result.childrenNeedFillSizing = true; // 二维网格子元素需要FILL
        } else {
            result.gridType = 'simple';
            result.layoutMode = 'VERTICAL';
            result.childrenNeedFillSizing = false;
        }

        // Parse gaps
        const gap = cssProperties.gap || cssProperties.gridGap;
        if (gap) {
            const gapValue = this.parseCSSValue(gap);
            if (gapValue) {
                result.columnGap = gapValue;
                result.rowGap = gapValue;
            }
        }

        if (cssProperties.columnGap) {
            const columnGap = this.parseCSSValue(cssProperties.columnGap);
            if (columnGap) {
                result.columnGap = columnGap;
            }
        }

        if (cssProperties.rowGap) {
            const rowGap = this.parseCSSValue(cssProperties.rowGap);
            if (rowGap) {
                result.rowGap = rowGap;
            }
        }

        // Store alignment properties for Figma mapping
        result.justifyContent = cssProperties.justifyContent;
        result.alignContent = cssProperties.alignContent;

        this.logger.info(`✅ Grid布局计算完成`, {
            type: result.gridType,
            columns: result.columns,
            rows: result.rows,
            layoutMode: result.layoutMode,
            childrenNeedFillSizing: result.childrenNeedFillSizing
        });

        return result;
    }

    /**
     * 检测是否需要强制使用手动布局（NONE）
     * 优化逻辑：相对定位元素默认使用auto layout，只有在特殊情况下才强制手动布局
     */
    static shouldForceManualLayout(element: Element, computedStyle: CSSStyleDeclaration): boolean {
        const position = computedStyle.position;
        const display = computedStyle.display;
        
        // 检测是否有浮动子元素
        // 如果父元素有浮动子元素，且不是 flex/grid 容器，应该使用手动布局
        if (display !== 'flex' && display !== 'inline-flex' && display !== 'grid' && display !== 'inline-grid') {
            if (this.hasFloatingChildren(element)) {
                this.logger.info(`🚫 检测到浮动子元素，强制使用手动布局`);
                return true;
            }
        }
        
        // 如果当前元素是相对定位，优先使用auto layout
        if (position === 'relative') {
            // 相对定位元素默认使用auto layout，除非有特殊情况需要手动布局
            // 特殊情况：有绝对定位子元素且不是flex/grid容器时才考虑手动布局
            if (display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid') {
                // flex/grid容器始终优先使用auto layout，绝对定位子元素单独处理
                return false;
            }
            
            // 对于非flex/grid的相对定位元素，如果有绝对定位子元素，仍然可以使用auto layout
            // 绝对定位子元素会脱离文档流，不影响父元素的布局模式
            // 只有在极特殊情况下才需要手动布局（比如复杂的定位依赖）
            return false; // 默认允许使用auto layout
        }
        
        // 如果当前元素是绝对定位，检查父元素是否是相对定位
        if (position === 'absolute' || position === 'fixed') {
            return this.hasRelativePositionedParent(element);
        }
        
        return false;
    }

    /**
     * 检测元素是否有浮动子元素
     * @param element - 父元素
     * @returns 如果有浮动子元素返回 true
     */
    static hasFloatingChildren(element: Element): boolean {
        const children = Array.from(element.children);
        
        for (const child of children) {
            const childStyle = window.getComputedStyle(child);
            const float = childStyle.float;
            
            // 如果子元素有浮动属性（left 或 right），返回 true
            if (float === 'left' || float === 'right') {
                this.logger.info(`  - 发现浮动子元素: ${child.tagName}, float: ${float}`);
                return true;
            }
        }
        
        return false;
    }



    /**
     * 检查元素是否有相对定位的父元素（定位上下文）
     */
    private static hasRelativePositionedParent(element: Element): boolean {
        let parent = element.parentElement;
        while (parent) {
            const parentStyle = window.getComputedStyle(parent);
            const position = parentStyle.position;
            
            // 找到定位上下文
            if (position === 'relative' || position === 'absolute' || position === 'fixed') {
                return position === 'relative';
            }
            
            // 如果遇到body或html，停止查找
            if (parent.tagName === 'BODY' || parent.tagName === 'HTML') {
                break;
            }
            
            parent = parent.parentElement;
        }
        return false;
    }

    /**
     * Calculate position information for positioned elements
     */
    static calculatePosition(cssProperties: {
        position?: string;
        top?: string;
        right?: string;
        bottom?: string;
        left?: string;
        width?: string;
        height?: string;
        zIndex?: string;
    }, parentBounds: { width: number; height: number }, boundingRect: DOMRect): {
        isPositioned: boolean;
        x: number;
        y: number;
        width: number;
        height: number;
        zIndex?: number;
    } {
        const result = {
            isPositioned: false,
            x: boundingRect.left,
            y: boundingRect.top,
            width: boundingRect.width,
            height: boundingRect.height
        };

        const position = cssProperties.position;
        if (!position || position === 'static') {
            return result;
        }

        result.isPositioned = true;

        // 对于绝对定位和固定定位，计算相对于定位上下文的位置
        if (position === 'absolute' || position === 'fixed') {
            // fixed 定位相对于视口，absolute 定位相对于最近的定位父元素
            const positionBounds = position === 'fixed' ? 
                { width: window.innerWidth, height: window.innerHeight } : 
                parentBounds;
            
            const absolutePos = this.calculateAbsolutePosition(cssProperties, positionBounds);
            result.x = absolutePos.x;
            result.y = absolutePos.y;
            result.width = absolutePos.width;
            result.height = absolutePos.height;
        }

        // 处理z-index
        if (cssProperties.zIndex && cssProperties.zIndex !== 'auto') {
            const zIndex = parseInt(cssProperties.zIndex, 10);
            if (!isNaN(zIndex)) {
                (result as any).zIndex = zIndex;
            }
        }

        return result;
    }

    /**
     * 创建堆叠上下文信息
     */
    static createStackingContext(element: Element, computedStyle: CSSStyleDeclaration): {
        createsStackingContext: boolean;
        zIndex?: number;
    } {
        const position = computedStyle.position;
        const zIndex = computedStyle.zIndex;
        const opacity = parseFloat(computedStyle.opacity);
        const transform = computedStyle.transform;
        
        // 检查是否创建新的堆叠上下文
        const createsStackingContext = 
            // 根元素
            element.tagName === 'HTML' ||
            // 定位元素且z-index不为auto
            ((position === 'absolute' || position === 'relative' || position === 'fixed') && zIndex !== 'auto') ||
            // 透明度小于1
            (!isNaN(opacity) && opacity < 1) ||
            // 有transform
            (transform && transform !== 'none') ||
            // 其他CSS属性也可能创建堆叠上下文，这里只列举主要的
            computedStyle.isolation === 'isolate';

        const result: any = { createsStackingContext };
        
        if (zIndex !== 'auto') {
            const zIndexValue = parseInt(zIndex, 10);
            if (!isNaN(zIndexValue)) {
                result.zIndex = zIndexValue;
            }
        }

        return result;
    }

    /**
     * Calculate absolute positioning
     */
    static calculateAbsolutePosition(cssProperties: {
        position?: string;
        top?: string;
        right?: string;
        bottom?: string;
        left?: string;
        width?: string;
        height?: string;
    }, parentBounds: { width: number; height: number }): {
        x: number;
        y: number;
        width: number;
        height: number;
    } {
        const result = {
            x: 0,
            y: 0,
            width: 100,
            height: 100
        };

        if (cssProperties.position !== 'absolute' && cssProperties.position !== 'fixed') {
            return result;
        }

        // First calculate dimensions as they might be needed for position calculations
        if (cssProperties.width) {
            const width = this.parseCSSValue(cssProperties.width, parentBounds.width);
            if (width !== null) {
                result.width = width;
            }
        }

        if (cssProperties.height) {
            const height = this.parseCSSValue(cssProperties.height, parentBounds.height);
            if (height !== null) {
                result.height = height;
            }
        }

        // Calculate X position
        if (cssProperties.left) {
            const left = this.parseCSSValue(cssProperties.left, parentBounds.width);
            if (left !== null) {
                result.x = left;
            }
        } else if (cssProperties.right) {
            const right = this.parseCSSValue(cssProperties.right, parentBounds.width);
            if (right !== null) {
                result.x = parentBounds.width - right - result.width;
            }
        }

        // Calculate Y position
        if (cssProperties.top) {
            const top = this.parseCSSValue(cssProperties.top, parentBounds.height);
            if (top !== null) {
                result.y = top;
            }
        } else if (cssProperties.bottom) {
            const bottom = this.parseCSSValue(cssProperties.bottom, parentBounds.height);
            if (bottom !== null) {
                result.y = parentBounds.height - bottom - result.height;
            }
        }
        return result;
    }

    /**
     * Calculate transform matrix from CSS transform
     */
    static calculateTransform(cssTransform: string): number[][] | null {
        if (!cssTransform || cssTransform === 'none') {
            return null;
        }

        // Parse simple transforms (translate, rotate, scale)
        const transforms = this.parseTransforms(cssTransform);
        let matrix = this.identityMatrix();

        transforms.forEach(transform => {
            switch (transform.type) {
                case 'translate':
                    matrix = this.multiplyMatrices(matrix, this.translateMatrix(transform.x || 0, transform.y || 0));
                    break;
                case 'rotate':
                    matrix = this.multiplyMatrices(matrix, this.rotateMatrix(transform.angle || 0));
                    break;
                case 'scale':
                    matrix = this.multiplyMatrices(matrix, this.scaleMatrix(transform.x || 1, transform.y || 1));
                    break;
            }
        });

        return matrix;
    }

    /**
     * Parse grid template (grid-template-columns/rows)
     */
    static parseGridTemplate(template: string): {
        tracks: Array<{
            type: 'length' | 'fr' | 'minmax' | 'repeat' | 'auto' | 'min-content' | 'max-content';
            value: string;
            size?: number;
        }>;
        names: string[];
    } {
        const tracks: any[] = [];
        const names: string[] = [];

        // 简单的解析，处理常见情况
        const parts = template.split(/\s+/);
        
        for (const part of parts) {
            if (part.startsWith('[') && part.endsWith(']')) {
                // 线名称
                names.push(part.slice(1, -1));
            } else if (part.includes('fr')) {
                // fr单位
                tracks.push({
                    type: 'fr',
                    value: part,
                    size: parseFloat(part)
                });
            } else if (part.includes('px') || part.includes('%') || part.includes('em') || part.includes('rem')) {
                // 长度单位
                tracks.push({
                    type: 'length',
                    value: part,
                    size: this.parseCSSValue(part)
                });
            } else if (part === 'auto') {
                tracks.push({
                    type: 'auto',
                    value: part
                });
            } else if (part === 'min-content') {
                tracks.push({
                    type: 'min-content',
                    value: part
                });
            } else if (part === 'max-content') {
                tracks.push({
                    type: 'max-content',
                    value: part
                });
            } else if (part.startsWith('minmax(')) {
                tracks.push({
                    type: 'minmax',
                    value: part
                });
            } else if (part.startsWith('repeat(')) {
                // 简单处理repeat函数
                const repeatMatch = part.match(/repeat\((\d+),\s*(.+)\)/);
                if (repeatMatch) {
                    const count = parseInt(repeatMatch[1]);
                    const trackValue = repeatMatch[2];
                    for (let i = 0; i < count; i++) {
                        tracks.push({
                            type: trackValue.includes('fr') ? 'fr' : 'length',
                            value: trackValue,
                            size: trackValue.includes('fr') ? parseFloat(trackValue) : this.parseCSSValue(trackValue)
                        });
                    }
                }
            }
        }

        return { tracks, names };
    }

    /**
     * Parse grid-template-areas
     */
    static parseGridTemplateAreas(areas: string): string[][] {
        return areas
            .split(/["']\s*["']/)
            .map(row => row.replace(/["']/g, '').trim())
            .filter(row => row.length > 0)
            .map(row => row.split(/\s+/));
    }

    /**
     * Create grid area map
     */
    static createGridAreaMap(areas: string[][]): Map<string, { rowStart: number; rowEnd: number; colStart: number; colEnd: number }> {
        const areaMap = new Map();
        
        for (let row = 0; row < areas.length; row++) {
            for (let col = 0; col < areas[row].length; col++) {
                const areaName = areas[row][col];
                if (areaName !== '.' && !areaMap.has(areaName)) {
                    // 找到区域的边界
                    let rowEnd = row + 1;
                    let colEnd = col + 1;
                    
                    // 查找行结束位置
                    while (rowEnd < areas.length && areas[rowEnd][col] === areaName) {
                        rowEnd++;
                    }
                    
                    // 查找列结束位置
                    while (colEnd < areas[row].length && areas[row][colEnd] === areaName) {
                        colEnd++;
                    }
                    
                    areaMap.set(areaName, {
                        rowStart: row + 1,
                        rowEnd,
                        colStart: col + 1,
                        colEnd
                    });
                }
            }
        }
        
        return areaMap;
    }


    /**
     * 检查Grid子元素是否需要FILL sizing
     */
    static shouldGridChildUseFillSizing(element: Element, gridInfo: any): {
        needsFillHorizontal: boolean;
        needsFillVertical: boolean;
    } {
        if (!gridInfo || !gridInfo.childrenNeedFillSizing) {
            return { needsFillHorizontal: false, needsFillVertical: false };
        }

        // 根据CSS Grid的真实行为：
        // - 子元素默认 align-items: stretch (拉伸填满行高)
        // - 子元素默认 justify-items: stretch (拉伸填满列宽)
        // - 在Figma Auto Layout中，这对应 layoutSizing = "FILL"
        
        let needsFillHorizontal = true;  // 对应 justify-items: stretch
        let needsFillVertical = true;    // 对应 align-items: stretch

        switch (gridInfo.gridType) {
            case 'horizontal':
                // 水平网格(1行多列): 模拟 justify-items: stretch + align-items: stretch
                needsFillHorizontal = true;  // justify-items: stretch → 填充列宽
                needsFillVertical = true;    // align-items: stretch → 拉伸填满行高
                break;
            
            case 'vertical':
                // 垂直网格(多行1列): 模拟 justify-items: stretch + align-items: stretch  
                needsFillHorizontal = true;  // justify-items: stretch → 填充列宽(整个容器宽度)
                needsFillVertical = true;    // align-items: stretch → 拉伸填满行高
                break;
            
            case '2d':
                // 二维网格(多行多列): 模拟 justify-items: stretch + align-items: stretch
                needsFillHorizontal = true;  // justify-items: stretch → 填充列宽
                needsFillVertical = true;    // align-items: stretch → 拉伸填满行高
                break;
                
            default:
                needsFillHorizontal = false;
                needsFillVertical = false;
        }

        return { needsFillHorizontal, needsFillVertical };
    }

    /**
     * Parse CSS value (px, %, em, rem, etc.)
     */
    private static parseCSSValue(value: string, parentSize?: number): number | null {
        if (!value) return null;

        const match = value.match(/^(-?\d*\.?\d+)(px|%|em|rem|vh|vw)?$/);
        if (!match) return null;

        const numValue = parseFloat(match[1]);
        const unit = match[2] || 'px';

        switch (unit) {
            case 'px':
                return numValue;
            case '%':
                return parentSize ? (numValue / 100) * parentSize : null;
            case 'em':
            case 'rem':
                return numValue * 16; // Assume 16px base font size
            case 'vh':
                return (numValue / 100) * (window.innerHeight || 800);
            case 'vw':
                return (numValue / 100) * (window.innerWidth || 1200);
            default:
                return numValue;
        }
    }

    /**
     * Parse CSS padding shorthand
     */
    private static parsePadding(padding: string): {
        paddingTop?: number;
        paddingRight?: number;
        paddingBottom?: number;
        paddingLeft?: number;
    } {
        const values = padding.split(/\s+/).map(v => this.parseCSSValue(v)).filter(v => v !== null) as number[];
        
        switch (values.length) {
            case 1:
                return {
                    paddingTop: values[0],
                    paddingRight: values[0],
                    paddingBottom: values[0],
                    paddingLeft: values[0]
                };
            case 2:
                return {
                    paddingTop: values[0],
                    paddingRight: values[1],
                    paddingBottom: values[0],
                    paddingLeft: values[1]
                };
            case 3:
                return {
                    paddingTop: values[0],
                    paddingRight: values[1],
                    paddingBottom: values[2],
                    paddingLeft: values[1]
                };
            case 4:
                return {
                    paddingTop: values[0],
                    paddingRight: values[1],
                    paddingBottom: values[2],
                    paddingLeft: values[3]
                };
            default:
                return {};
        }
    }

    /**
     * Parse CSS transforms
     */
    private static parseTransforms(cssTransform: string): Array<{
        type: string;
        x?: number;
        y?: number;
        angle?: number;
    }> {
        const transforms: Array<{ type: string; x?: number; y?: number; angle?: number }> = [];
        
        // Simple regex patterns for common transforms
        const patterns = [
            { regex: /translate\(([^,]+),?\s*([^)]*)\)/g, type: 'translate' },
            { regex: /translateX\(([^)]+)\)/g, type: 'translateX' },
            { regex: /translateY\(([^)]+)\)/g, type: 'translateY' },
            { regex: /rotate\(([^)]+)\)/g, type: 'rotate' },
            { regex: /scale\(([^,]+),?\s*([^)]*)\)/g, type: 'scale' }
        ];

        patterns.forEach(({ regex, type }) => {
            let match;
            while ((match = regex.exec(cssTransform)) !== null) {
                const transform: any = { type };
                
                switch (type) {
                    case 'translate':
                        transform.x = this.parseCSSValue(match[1]) || 0;
                        transform.y = this.parseCSSValue(match[2]) || 0;
                        break;
                    case 'translateX':
                        transform.type = 'translate';
                        transform.x = this.parseCSSValue(match[1]) || 0;
                        transform.y = 0;
                        break;
                    case 'translateY':
                        transform.type = 'translate';
                        transform.x = 0;
                        transform.y = this.parseCSSValue(match[1]) || 0;
                        break;
                    case 'rotate':
                        transform.angle = this.parseAngle(match[1]) || 0;
                        break;
                    case 'scale':
                        transform.x = parseFloat(match[1]) || 1;
                        transform.y = parseFloat(match[2]) || transform.x;
                        break;
                }
                
                transforms.push(transform);
            }
        });

        return transforms;
    }

    /**
     * Parse angle value (deg, rad, turn)
     */
    private static parseAngle(value: string): number {
        const match = value.match(/^(-?\d*\.?\d+)(deg|rad|turn)?$/);
        if (!match) return 0;

        const numValue = parseFloat(match[1]);
        const unit = match[2] || 'deg';

        switch (unit) {
            case 'deg':
                return (numValue * Math.PI) / 180;
            case 'rad':
                return numValue;
            case 'turn':
                return numValue * 2 * Math.PI;
            default:
                return numValue;
        }
    }

    /**
     * Matrix operations for transforms
     */
    private static identityMatrix(): number[][] {
        return [
            [1, 0, 0],
            [0, 1, 0]
        ];
    }

    private static translateMatrix(x: number, y: number): number[][] {
        return [
            [1, 0, x],
            [0, 1, y]
        ];
    }

    private static rotateMatrix(angle: number): number[][] {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return [
            [cos, -sin, 0],
            [sin, cos, 0]
        ];
    }

    private static scaleMatrix(x: number, y: number): number[][] {
        return [
            [x, 0, 0],
            [0, y, 0]
        ];
    }

    private static multiplyMatrices(a: number[][], b: number[][]): number[][] {
        const result = [
            [0, 0, 0],
            [0, 0, 0]
        ];

        for (let i = 0; i < 2; i++) {
            for (let j = 0; j < 3; j++) {
                result[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j];
                if (j === 2) {
                    result[i][j] += a[i][2];
                }
            }
        }

        return result;
    }

}
