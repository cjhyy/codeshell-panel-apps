// Text processing utilities for Figma text nodes
import { FontName } from '../types';

export interface TextProcessingOptions {
    fallbackFonts?: FontName[];
    loadFontsAsync?: boolean;
    defaultFontSize?: number;
    maxTextLength?: number;
}

export class TextProcessor {
    private static readonly DEFAULT_FONTS: FontName[] = [
        { family: "Inter", style: "Regular" },
        { family: "Roboto", style: "Regular" },
        { family: "Arial", style: "Regular" },
        { family: "Helvetica", style: "Regular" }
    ];

    private figmaApi: any;
    private options: Required<TextProcessingOptions>;

    constructor(figmaApi: any, options: TextProcessingOptions = {}) {
        this.figmaApi = figmaApi;
        this.options = {
            fallbackFonts: TextProcessor.DEFAULT_FONTS,
            loadFontsAsync: true,
            defaultFontSize: 16,
            maxTextLength: 10000,
            ...options
        };
    }

    /**
     * Create text node with robust error handling
     */
    async createTextNode(
        text: string,
        fontName?: FontName,
        fontSize?: number
    ): Promise<any> {
        try {
            const textNode = this.figmaApi.createText();
            
            // Set text content first (required before other properties)
            textNode.characters = this.sanitizeText(text);
            
            // Set font with fallback handling
            if (fontName) {
                await this.setFontSafe(textNode, fontName);
            } else {
                await this.setDefaultFont(textNode);
            }
            
            // Set font size
            if (fontSize) {
                textNode.fontSize = Math.max(1, fontSize);
            } else {
                textNode.fontSize = this.options.defaultFontSize;
            }
            
            return textNode;
        } catch (error) {
            throw new Error(`Text node creation failed: ${(error as Error).message}`);
        }
    }

    /**
     * Set font with comprehensive fallback handling
     */
    async setFontSafe(textNode: any, fontName: FontName): Promise<boolean> {
        // Try the requested font first
        if (await this.trySetFont(textNode, fontName)) {
            return true;
        }

        // Try fallback fonts
        for (const fallbackFont of this.options.fallbackFonts) {
            if (await this.trySetFont(textNode, fallbackFont)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Try to set a specific font
     */
    private async trySetFont(textNode: any, fontName: FontName): Promise<boolean> {
        try {
            if (this.options.loadFontsAsync && this.figmaApi.loadFontAsync) {
                // Load font asynchronously if available
                await this.figmaApi.loadFontAsync(fontName);
            }
            
            textNode.fontName = fontName;
            return true;
        } catch (error) {
            // Font not available or failed to load
            return false;
        }
    }

    /**
     * Set default font
     */
    private async setDefaultFont(textNode: any): Promise<void> {
        for (const font of this.options.fallbackFonts) {
            if (await this.trySetFont(textNode, font)) {
                return;
            }
        }
        
        // If no fonts work, let Figma use its default
    }

    /**
     * Sanitize text content
     */
    private sanitizeText(text: string): string {
        if (!text || typeof text !== 'string') {
            return 'Text';
        }

        // Limit text length
        if (text.length > this.options.maxTextLength) {
            return text.substring(0, this.options.maxTextLength) + '...';
        }

        // Remove null characters and normalize line endings to spaces to avoid \n in Figma JSON
        const cleaned = text.replace(/\0/g, '').replace(/\r\n/g, ' ').replace(/\r/g, ' ').replace(/\n/g, ' ');
        
        // Clean up multiple spaces
        return cleaned.replace(/\s+/g, ' ').trim();
    }

    /**
     * Create text with specific styling
     */
    async createStyledText(config: {
        text: string;
        fontFamily?: string;
        fontStyle?: string;
        fontSize?: number;
        color?: { r: number; g: number; b: number };
        textAlign?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
        autoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT';
    }): Promise<any> {
        const fontName = config.fontFamily && config.fontStyle ? {
            family: config.fontFamily,
            style: config.fontStyle
        } : undefined;

        const textNode = await this.createTextNode(
            config.text,
            fontName,
            config.fontSize
        );

        // Set text alignment
        if (config.textAlign) {
            textNode.textAlignHorizontal = config.textAlign;
        }

        // Set auto resize
        if (config.autoResize) {
            textNode.textAutoResize = config.autoResize;
        }

        // Set text color
        if (config.color) {
            textNode.fills = [{
                type: 'SOLID',
                color: config.color,
                opacity: 1,
                visible: true
            }];
        }

        return textNode;
    }

    /**
     * Create multi-line text
     */
    async createMultiLineText(
        lines: string[],
        fontName?: FontName,
        fontSize?: number,
        lineHeight?: number
    ): Promise<any> {
        // Join lines with spaces instead of \n to avoid newlines in Figma JSON
        const text = lines.join(' ');
        const textNode = await this.createTextNode(text, fontName, fontSize);
        
        // Set auto resize for multi-line
        textNode.textAutoResize = 'WIDTH_AND_HEIGHT';
        
        // Set line height if specified
        if (lineHeight) {
            textNode.lineHeight = {
                value: lineHeight,
                unit: 'PIXELS'
            };
        }
        
        return textNode;
    }

    /**
     * Get available fonts (if supported by Figma API)
     */
    async getAvailableFonts(): Promise<FontName[]> {
        try {
            if (this.figmaApi.listAvailableFontsAsync) {
                return await this.figmaApi.listAvailableFontsAsync();
            }
        } catch (error) {
            // Could not get available fonts, use fallbacks
        }
        
        return this.options.fallbackFonts;
    }

    /**
     * Validate font availability
     */
    async validateFont(fontName: FontName): Promise<boolean> {
        try {
            if (this.figmaApi.loadFontAsync) {
                await this.figmaApi.loadFontAsync(fontName);
                return true;
            }
        } catch (error) {
            return false;
        }
        
        return false;
    }

    /**
     * Create text with gradient fill
     */
    async createGradientText(
        text: string,
        gradientStops: Array<{ position: number; color: { r: number; g: number; b: number; a?: number } }>,
        gradientType: 'LINEAR' | 'RADIAL' = 'LINEAR',
        fontName?: FontName,
        fontSize?: number
    ): Promise<any> {
        const textNode = await this.createTextNode(text, fontName, fontSize);
        
        const gradientFill = {
            type: `GRADIENT_${gradientType}` as const,
            gradientStops: gradientStops.map(stop => ({
                position: stop.position,
                color: { ...stop.color, a: stop.color.a ?? 1 }
            })),
            visible: true
        };
        
        textNode.fills = [gradientFill];
        
        return textNode;
    }

    /**
     * Estimate text width (rough calculation)
     */
    estimateTextWidth(text: string, fontSize: number = 16): number {
        // Very rough estimation - actual width depends on font
        const avgCharWidth = fontSize * 0.6;
        return text.length * avgCharWidth;
    }

    /**
     * Break text into lines based on width
     */
    breakTextIntoLines(text: string, maxWidth: number, fontSize: number = 16): string[] {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const estimatedWidth = this.estimateTextWidth(testLine, fontSize);
            
            if (estimatedWidth <= maxWidth) {
                currentLine = testLine;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    // Word is too long, break it
                    lines.push(word);
                }
            }
        }
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        return lines;
    }

    /**
     * Create text that fits within specified bounds
     */
    async createBoundedText(
        text: string,
        maxWidth: number,
        maxHeight?: number,
        fontName?: FontName,
        baseFontSize: number = 16
    ): Promise<any> {
        let fontSize = baseFontSize;
        let lines: string[] = [];
        
        // Try to fit text by adjusting font size and line breaks
        while (fontSize > 8) {
            lines = this.breakTextIntoLines(text, maxWidth, fontSize);
            
            if (!maxHeight) {
                break; // Only width constraint
            }
            
            const estimatedHeight = lines.length * fontSize * 1.2; // Rough line height
            if (estimatedHeight <= maxHeight) {
                break; // Fits within bounds
            }
            
            fontSize -= 1;
        }
        
        const textNode = await this.createMultiLineText(lines, fontName, fontSize);
        textNode.textAutoResize = 'WIDTH_AND_HEIGHT';
        textNode.resize(maxWidth, maxHeight || lines.length * fontSize * 1.2);
        
        return textNode;
    }
}
