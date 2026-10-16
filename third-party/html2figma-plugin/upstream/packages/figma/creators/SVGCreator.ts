// SVG node creator
import { FigmaSVGNode } from '@html2figma/shared';
import { BaseNodeCreator } from '../base/BaseNodeCreator';

export class SVGCreator extends BaseNodeCreator<FigmaSVGNode, any> {
    /**
     * Create an SVG node from JSON data using figmaAPI.createNodeFromSvg
     */
    create(data: FigmaSVGNode): any {
        try {
            this.validateData(data);
            
            // Use figmaAPI.createNodeFromSvg to create SVG node
            const svgNode = this.figmaApi.createNodeFromSvg(data.svgContent);
            
            return svgNode;
            
        } catch (error) {
            this.handleError(error as Error, 'SVG', data);
        }
    }

    /**
     * Set all properties for the SVG node after creation
     */
    setProperties(svgNode: any, data: FigmaSVGNode): void {
        try {
            // Set base properties (name, position, size, etc.)
            this.setBaseProperties(svgNode, data);
            
            // Resize SVG node to match the target dimensions from HTML
            // This ensures SVG renders at the correct size in Figma, 
            // regardless of its internal viewBox or original dimensions
            if (data.width && data.height) {
                svgNode.resize(data.width, data.height);
                this.logger.info('Resized SVG node to match target dimensions', {
                    name: data.name,
                    width: data.width,
                    height: data.height
                });
            }
            
            // Set SVG-specific properties
            this.setSVGProperties(svgNode, data);
            
            
            this.logCreation('SVG', data.name);
            
        } catch (error) {
            throw error;
        }
    }

    /**
     * Set SVG-specific properties
     */
    private setSVGProperties(svgNode: any, data: FigmaSVGNode): void {
        try {
            // Set visibility
            if (typeof data.visible === 'boolean') {
                svgNode.visible = data.visible;
            }

            // Set locked state
            if (typeof data.locked === 'boolean') {
                svgNode.locked = data.locked;
            }

            // Set opacity
            if (typeof data.opacity === 'number' && data.opacity >= 0 && data.opacity <= 1) {
                svgNode.opacity = data.opacity;
            }

            // Set blend mode
            if (data.blendMode) {
                svgNode.blendMode = data.blendMode;
            }

            // Set effects
            if (data.effects && data.effects.length > 0) {
                svgNode.effects = data.effects;
            }

        } catch (error) {
            this.logger.error('Failed to set SVG properties', {
                error: error instanceof Error ? error.message : 'Unknown error',
                svgName: data.name
            });
            throw error;
        }
    }

    /**
     * Validate SVG-specific data
     */
    protected validateSpecificData(data: FigmaSVGNode): void {
        // Validate SVG content
        if (!data.svgContent || typeof data.svgContent !== 'string') {
            throw new Error('SVG node must have valid svgContent string');
        }

        // Basic SVG content validation
        if (!data.svgContent.trim().startsWith('<svg')) {
            throw new Error('SVG content must start with <svg tag');
        }

        if (!data.svgContent.includes('</svg>')) {
            throw new Error('SVG content must end with </svg> tag');
        }
    }

    /**
     * Get supported node type
     */
    getSupportedType(): string {
        return 'SVG';
    }

    /**
     * Check if this creator can handle the given data
     */
    canHandle(data: any): boolean {
        return data && data.type === 'SVG';
    }
}
