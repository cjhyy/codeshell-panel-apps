// Text node creator - simplified version
import { FigmaTextNode, FigmaStyledTextSegment } from '@html2figma/shared';
import { BaseNodeCreator } from '../base/BaseNodeCreator';
import { validateFontName } from '@html2figma/shared/utils';
import { ImageCreator } from './ImageCreator';

export class TextCreator extends BaseNodeCreator<FigmaTextNode, TextNode> {
    constructor(figmaApi: any) {
        super(figmaApi);
    }

    /**
     * Create a Text node from JSON data (only creates the node)
     */
    create(data: FigmaTextNode): TextNode {
        try {
            // Parameters validation
            this.logTextNodeParameters(data);
            
            this.validateData(data);
            
            const text = this.figmaApi.createText();
            
            // Set default font before setting text content to avoid font loading issues
            this.setDefaultFont(text);
            // Set basic text content with retry
            this.setTextContentSafely(text, data);
            
            return text;
            
        } catch (error) {
            this.handleError(error as Error, 'Text', data);
        }
    }

    /**
     * Set all properties for the text after creation
     */
    setProperties(text: TextNode, data: FigmaTextNode): void {
        try {
            // Set base properties (without size)
            this.setBaseProperties(text, data);
                      // Set size properties after other properties
            this.setSizeProperties(text, data);

            this.setLayoutSizing(text, data);
            // Set text-specific properties
            this.setTextProperties(text, data);
            
            // Set text styling
            this.setTextStyling(text, data);

            // Apply per-range styled segments (rich text)
            if (data.styledTextSegments && data.styledTextSegments.length > 0) {
                this.applyStyledSegments(text, data.styledTextSegments);
            }

            // Layout positioning is now handled in BaseNodeCreator
            
            this.logCreation('Text', data.name);
            
        } catch (error) {
            throw error;
        }
    }

   /**
     * 设置Auto Layout尺寸属性
     */
   private setLayoutSizing(frame: TextNode, data: FigmaTextNode): void {
    const sizingInfo = [];

    // 设置水平尺寸模式
    if (data.layoutSizingHorizontal) {
        (frame as any).layoutSizingHorizontal = data.layoutSizingHorizontal;
        sizingInfo.push(`水平: ${data.layoutSizingHorizontal}`);
        this.logger.info(`📏 设置水平尺寸模式: ${data.layoutSizingHorizontal}`);
    }
    
    // 设置垂直尺寸模式
    if (data.layoutSizingVertical) {
        (frame as any).layoutSizingVertical = data.layoutSizingVertical;
        sizingInfo.push(`垂直: ${data.layoutSizingVertical}`);
        this.logger.info(`📏 设置垂直尺寸模式: ${data.layoutSizingVertical}`);
    }
    
    if (sizingInfo.length > 0) {
        this.logger.info(`✅ Layout Sizing 设置完成: ${frame.name} - ${sizingInfo.join(', ')}`);
    }
}

    /**
     * Log all text node parameters before creation
     */
    private logTextNodeParameters(data: FigmaTextNode): void {
        // Logging removed
    }

    /**
     * Set default font and font size to avoid font loading issues
     * Uses the pre-loaded Inter font from plugin initialization
     */
    private setDefaultFont(text: any): void {
        try {
            // Use validated default font - Inter should be pre-loaded by now
            const defaultFont = validateFontName("Inter", "Regular");
            (text as any).fontName = defaultFont;
            
            // Set default font size (will be overridden if data has fontSize)
            (text as any).fontSize = 16;
        } catch (error) {
            // If Inter fails, try other common system fonts
            const fallbackFonts = [
                validateFontName("Arial", "Regular"),
                validateFontName("Helvetica", "Regular"),
                validateFontName("Times New Roman", "Regular")
            ];
            
            for (const font of fallbackFonts) {
                try {
                    (text as any).fontName = font;
                    (text as any).fontSize = 16;
                    return;
                } catch (fallbackError) {
                    // Continue to next fallback font
                }
            }
        }
    }

    /**
     * Set text content safely
     */
    private setTextContentSafely(text: TextNode, data: FigmaTextNode): void {
        const content = data.characters || '\u00A0';
        const sanitizedContent = this.sanitizeText(content);
      
        if (!sanitizedContent || sanitizedContent.trim() === '') {
            text.characters = '\u00A0';
            return;
        }
        
        try {
            text.characters = sanitizedContent;
        } catch (error) {
            // Use fallback text
            try {
                text.characters = '\u00A0';
            } catch (fallbackError) {
                // Fallback failed
            }
        }
    }

    /**
     * Sanitize text content
     */
    private sanitizeText(text: string): string {
        if (!text || typeof text !== 'string') {
            return '\u00A0';
        }

        // Remove null characters and normalize line endings to \n
        const cleaned = text.replace(/\0/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Only collapse regular spaces and tabs, NOT \u00A0 (non-breaking spaces).
        // The traverser intentionally places \u00A0 to preserve inter-word spacing,
        // and changing text length would break styledTextSegments character offsets.
        let result = cleaned.replace(/[ \t]+/g, ' ');

        // Check if text became empty after cleaning (only check regular whitespace)
        if (!result || result.replace(/[\s\u00A0]+/g, '') === '') {
            return '\u00A0';
        }

        // Limit text length to prevent performance issues
        const maxLength = 10000;
        if (result.length > maxLength) {
            result = result.substring(0, maxLength) + '...';
        }
        return result;
    }

    /**
     * Set text-specific properties
     */
    private setTextProperties(text: TextNode, data: FigmaTextNode): void {
        try {
            
            // Font properties - validate and apply font from data
            // const interFont = validateFontName("Inter", "Regular");
            // (text as any).fontName = interFont;
            //TODO: Try to set the font from the data 

            if (data.fontName) {
                const validatedFont = validateFontName(
                    data.fontName.family || "Inter",
                    data.fontName.style || "Regular"
                );
                
                // Check if this font is likely to be available
                const fontKey = `${validatedFont.family}:${validatedFont.style}`;
                try {
                    (text as any).fontName = validatedFont;
                } catch (fontError) {
                    this.logger.error('❌ [TextCreator] Failed to set font:', validatedFont, fontError);
                    // Try Inter as fallback
                    try {
                        const interFont = validateFontName("Inter", "Regular");
                        (text as any).fontName = interFont;
                    } catch (interError) {
                        this.logger.error('❌ [TextCreator] Even Inter font failed:', interError);
                        // Keep whatever default font was set
                    }
                }
            }
            
            // Font size - ensure minimum size
            if (data.fontSize !== undefined) {
                const finalFontSize = Math.max(data.fontSize, 8);
                (text as any).fontSize = finalFontSize;
            }
            

            if (data.fontWeight !== undefined) {
                try {
                    (text as any).fontWeight = data.fontWeight;
                } catch (fontWeightError) {
                    this.logger.error('❌ [TextCreator] Failed to set font weight:', data.fontWeight, fontWeightError);
                }
            }

            // Text alignment
            if (data.textAlignHorizontal) {
                text.textAlignHorizontal = data.textAlignHorizontal;
            }
            
            if (data.textAlignVertical) {
                text.textAlignVertical = data.textAlignVertical;
            }
            
            // Text auto-resize behavior
            if (data.textAutoResize) {
                text.textAutoResize = data.textAutoResize;
            } else {
                text.textAutoResize = 'WIDTH_AND_HEIGHT';
            }
            
            // Figma native list options (bullets/numbers)
            if (data.listOptions && data.listOptions.type !== 'NONE') {
                try {
                    const len = text.characters.length;
                    if (len > 0) {
                        (text as any).setRangeListOptions(0, len, data.listOptions);
                    }
                } catch (e) {
                    this.logger.info('listOptions not supported:', e);
                }
            }

            // Text truncation behavior
            if (data.textTruncation) {
                this.logger.info('data.textTruncation', data.textTruncation);
                (text as any).textTruncation = data.textTruncation;
                if (data.textTruncation === 'ENDING' ) {
                    (text as any).maxLines = data.maxLines || 1;
                }

            }
            //  else {
            //     (text as any).textTruncation = 'ENDING';
            //     (text as any).maxLines = 1;
            // }
            
            // Line height
            if (data.lineHeight) {
                (text as any).lineHeight = data.lineHeight;
            }
            
            // Letter spacing — only set when explicitly provided.
            // Figma API expects a LetterSpacing object, not a plain number.
            if (data.letterSpacing) {
                (text as any).letterSpacing = data.letterSpacing;
            }
            
            // Text decoration
            if (data.textDecoration) {
                (text as any).textDecoration = data.textDecoration;
            }
            
        } catch (error) {
            // Handle text properties setting errors silently
        }
    }


    /**
     * Set text styling properties
     */
    private setTextStyling(text: TextNode, data: FigmaTextNode): void {
        try {
            // Fills (text color)
            if (data.fills && data.fills.length > 0) {
                // Filter out IMAGE fills without imageHash — they'll be processed async
                const safeFills = data.fills.filter((fill: any) =>
                    fill.type !== 'IMAGE' || (fill.imageHash && typeof fill.imageHash === 'string' && fill.imageHash.length > 0)
                );

                if (safeFills.length > 0) {
                    this.setFills(text, safeFills);
                } else {
                    // All fills were IMAGE without imageHash — set transparent placeholder
                    // The async image processing will replace this
                    text.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0 }];
                }

                // Process image fills asynchronously (background-clip: text with image)
                const imageMetadata = (data as any).imageMetadata;
                if (imageMetadata && (imageMetadata.base64 || imageMetadata.originalUrl)) {
                    const jsonImageHash = (data.fills.find((fill: any) => fill.type === 'IMAGE') as any)?.imageHash;
                    if (imageMetadata.base64) {
                        ImageCreator.processAndApplyBase64Image(
                            text, imageMetadata, jsonImageHash, this.figmaApi
                        ).catch(error => {
                            this.logger.error('Failed to process text image fill:', error);
                        });
                    } else if (imageMetadata.originalUrl) {
                        this.processTextImageUrl(text, imageMetadata).catch(error => {
                            this.logger.error('Failed to fetch text image fill:', error);
                        });
                    }
                }
            } else {
                // Default to black text
                text.fills = [{
                    type: 'SOLID',
                    color: { r: 0, g: 0, b: 0 }
                }];
            }

        } catch (error) {
            // Fallback to black text
            try {
                text.fills = [{
                    type: 'SOLID',
                    color: { r: 0, g: 0, b: 0 }
                }];
            } catch (fallbackError) {
                // Fallback styling failed
            }
        }
    }

    /**
     * Process URL-based image fill for text (background-clip: text)
     */
    private async processTextImageUrl(text: TextNode, imageMetadata: any): Promise<void> {
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
            ImageCreator.updateNodeFills(text, fill);
        } catch (error) {
            this.logger.error('Failed to fetch text image URL:', error);
        }
    }


    /**
     * Apply per-range styled segments to a text node (rich text support).
     * Uses Figma's setRangeFontName, setRangeFills, etc. to style individual character ranges.
     */
    private applyStyledSegments(text: TextNode, segments: FigmaStyledTextSegment[]): void {
        const textLength = text.characters.length;
        this.logger.info(`[applyStyledSegments] textLength=${textLength} segments=${segments.length} text="${text.characters.substring(0, 40)}"`);

        for (const seg of segments) {
            // Validate range bounds
            if (seg.start < 0 || seg.end > textLength || seg.start >= seg.end) {
                this.logger.warn(`[applyStyledSegments] SKIP out-of-bounds segment [${seg.start}-${seg.end}] textLength=${textLength}`);
                continue;
            }

            const rangeText = text.characters.substring(seg.start, seg.end);
            this.logger.info(`[applyStyledSegments] segment [${seg.start}-${seg.end}] "${rangeText}" fontName=${seg.fontName ? seg.fontName.family + ':' + seg.fontName.style : 'inherit'} fills=${seg.fills ? 'yes' : 'no'}`);

            try {
                // Font name override
                if (seg.fontName) {
                    try {
                        const validatedFont = validateFontName(
                            seg.fontName.family || 'Inter',
                            seg.fontName.style || 'Regular'
                        );
                        (text as any).setRangeFontName(seg.start, seg.end, validatedFont);
                    } catch (fontError) {
                        this.logger.error('Failed to set range font:', seg.fontName, fontError);
                    }
                }

                // Font size override
                if (seg.fontSize !== undefined) {
                    try {
                        (text as any).setRangeFontSize(seg.start, seg.end, Math.max(seg.fontSize, 8));
                    } catch (e) {
                        // Font size setting may not be supported in all Figma API versions
                    }
                }

                // Fills (color) override
                if (seg.fills && seg.fills.length > 0) {
                    try {
                        (text as any).setRangeFills(seg.start, seg.end, seg.fills);
                    } catch (e) {
                        this.logger.error('Failed to set range fills:', e);
                    }
                }

                // Text decoration override
                if (seg.textDecoration) {
                    try {
                        (text as any).setRangeTextDecoration(seg.start, seg.end, seg.textDecoration);
                    } catch (e) {
                        // Decoration may fail silently
                    }
                }

                // Line height override
                if (seg.lineHeight) {
                    try {
                        (text as any).setRangeLineHeight(seg.start, seg.end, seg.lineHeight);
                    } catch (e) {
                        // Line height range setting
                    }
                }

                // Letter spacing override
                if (seg.letterSpacing) {
                    try {
                        (text as any).setRangeLetterSpacing(seg.start, seg.end, seg.letterSpacing);
                    } catch (e) {
                        // Letter spacing range setting
                    }
                }

                // Hyperlink
                if (seg.hyperlink) {
                    try {
                        (text as any).setRangeHyperlink(seg.start, seg.end, seg.hyperlink);
                    } catch (e) {
                        // Hyperlink setting may not be supported
                    }
                }
            } catch (error) {
                this.logger.error('Failed to apply styled segment:', seg, error);
            }
        }
    }

    /**
     * Validate text-specific data
     */
    protected validateData(data: FigmaTextNode): boolean {
        super.validateData(data);
        
        if (data.type !== 'TEXT') {
            throw new Error(`Expected TEXT type, got ${data.type}`);
        }
        
        return true;
    }
}
