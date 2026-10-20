// Rectangle node creator
import { FigmaRectangleNode } from '@html2figma/shared';
import { BaseNodeCreator } from '../base/BaseNodeCreator';

export class RectangleCreator extends BaseNodeCreator<FigmaRectangleNode, RectangleNode> {
    /**
     * Create a Rectangle node from JSON data (only creates the node)
     */
    create(data: FigmaRectangleNode): RectangleNode {
        try {
            this.validateData(data);
            
            const rectangle = this.figmaApi.createRectangle();
            
            return rectangle;
            
        } catch (error) {
            this.handleError(error as Error, 'Rectangle', data);
        }
    }

    /**
     * Set all properties for the rectangle after creation
     */
    setProperties(rectangle: RectangleNode, data: FigmaRectangleNode): void {
        try {
            // Set base properties (without size)
            this.setBaseProperties(rectangle, data);
            
            // Set rectangle-specific properties
            this.setRectangleProperties(rectangle, data);
            
            // Set size properties after other properties
            this.setSizeProperties(rectangle, data);
            
            // Layout positioning is now handled in BaseNodeCreator
            
            this.logCreation('Rectangle', data.name);
            
        } catch (error) {
            throw error;
        }
    }

    /**
     * Set layout-specific properties for child rectangles after they are added to parent
     */

    /**
     * Set rectangle-specific properties
     */
    private setRectangleProperties(rectangle: RectangleNode, data: FigmaRectangleNode): void {
        // Fills
        this.setFills(rectangle, data.fills || []);
        
        // Strokes
        this.setStrokes(rectangle, data.strokes || [], data.strokeWeight, data.strokeAlign, undefined, undefined, undefined, undefined, data.strokeDashPattern);
        
        // Stroke properties
        this.setStrokeProperties(rectangle, data);
        
        // Corner radius
        this.setCornerRadiusProperties(rectangle, data);
        
        // Effects
        if (data.effects) {
            this.setEffects(rectangle, data.effects);
        }
    }

    /**
     * Set stroke-specific properties
     */
    private setStrokeProperties(rectangle: RectangleNode, data: FigmaRectangleNode): void {
        // These properties are not available in the shared types, use any to access them
        const rect = rectangle as any;
        
        // Stroke miter limit
        if ((data as any).strokeMiterLimit !== undefined) {
            rect.strokeMiterLimit = (data as any).strokeMiterLimit;
        }
        
        // Stroke cap
        if ((data as any).strokeCap) {
            rect.strokeCap = (data as any).strokeCap;
        }
        
        // Stroke join
        if ((data as any).strokeJoin) {
            rect.strokeJoin = (data as any).strokeJoin;
        }
        
        // Dash pattern
        if ((data as any).dashPattern && (data as any).dashPattern.length > 0) {
            rect.dashPattern = (data as any).dashPattern;
        }
    }

    /**
     * Set corner radius properties (支持统一圆角、独立圆角和数组格式)
     */
    private setCornerRadiusProperties(rectangle: RectangleNode, data: FigmaRectangleNode): void {
        const rect = rectangle as any;
        
        // 方式1: 使用 cornerRadii 数组 [topLeft, topRight, bottomRight, bottomLeft]
        if ((data as any).cornerRadii && Array.isArray((data as any).cornerRadii)) {
            const radii = (data as any).cornerRadii;
            if (radii.length === 4) {
                rect.topLeftRadius = radii[0];
                rect.topRightRadius = radii[1];
                rect.bottomRightRadius = radii[2];
                rect.bottomLeftRadius = radii[3];
                return; // 数组优先级最高，直接返回
            }
        }
        
        // 方式2: 统一圆角
        if (data.cornerRadius !== undefined) {
            rectangle.cornerRadius = data.cornerRadius;
            return; // 统一圆角优先于独立圆角
        }
        
        // 方式3: 独立圆角
        if ((data as any).topLeftRadius !== undefined) {
            rect.topLeftRadius = (data as any).topLeftRadius;
        }
        
        if ((data as any).topRightRadius !== undefined) {
            rect.topRightRadius = (data as any).topRightRadius;
        }
        
        if ((data as any).bottomLeftRadius !== undefined) {
            rect.bottomLeftRadius = (data as any).bottomLeftRadius;
        }
        
        if ((data as any).bottomRightRadius !== undefined) {
            rect.bottomRightRadius = (data as any).bottomRightRadius;
        }
        
        // Corner smoothing
        if ((data as any).cornerSmoothing !== undefined) {
            rect.cornerSmoothing = (data as any).cornerSmoothing;
        }
    }

    /**
     * Create a rectangle with gradient fill
     */
    createWithGradient(data: FigmaRectangleNode, gradientStops: any[], gradientType: 'LINEAR' | 'RADIAL' | 'ANGULAR' = 'LINEAR'): RectangleNode {
        const rectangle = this.create(data);
        
        const gradientFill = {
            type: `GRADIENT_${gradientType}` as any,
            gradientStops: gradientStops,
            gradientTransform: this.calculateGradientTransform(data, gradientType)
        };
        
        rectangle.fills = [gradientFill as any];
        
        return rectangle;
    }

    /**
     * Create a rectangle with image fill
     */
    createWithImage(data: FigmaRectangleNode, imageHash: string, scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' = 'FILL'): RectangleNode {
        const rectangle = this.create(data);
        
        const imageFill = {
            type: 'IMAGE' as any,
            imageHash: imageHash,
            scaleMode: scaleMode
        };
        
        rectangle.fills = [imageFill as any];
        
        return rectangle;
    }

    /**
     * Calculate gradient transform matrix
     */
    private calculateGradientTransform(data: FigmaRectangleNode, gradientType: string): number[][] {
        const width = data.width || 100;
        const height = data.height || 100;
        
        switch (gradientType) {
            case 'LINEAR':
                // Horizontal linear gradient
                return [
                    [1, 0, 0],
                    [0, 0, 1]
                ];
            case 'RADIAL':
                // Radial gradient from center
                return [
                    [width / 200, 0, 0.5],
                    [0, height / 200, 0.5]
                ];
            case 'ANGULAR':
                // Angular gradient
                return [
                    [0, -1, 1],
                    [1, 0, 0]
                ];
            default:
                return [
                    [1, 0, 0],
                    [0, 1, 0]
                ];
        }
    }

    /**
     * Validate rectangle-specific data
     */
    protected validateData(data: FigmaRectangleNode): boolean {
        super.validateData(data);
        
        if (data.type !== 'RECTANGLE') {
            throw new Error(`Expected RECTANGLE type, got ${data.type}`);
        }
        
        // Validate corner radius values
        if (data.cornerRadius !== undefined && data.cornerRadius < 0) {
            throw new Error('Corner radius cannot be negative');
        }
        
        // Validate stroke weight
        if (data.strokeWeight !== undefined && data.strokeWeight < 0) {
            throw new Error('Stroke weight cannot be negative');
        }
        
        return true;
    }
}
