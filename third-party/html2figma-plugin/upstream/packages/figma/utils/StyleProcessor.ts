// Utility for processing and converting styles
import { Paint, Effect, RGBA, RGB } from '../types';

export class StyleProcessor {
    /**
     * Create a solid paint from RGB color
     */
    static createSolidPaint(color: RGB, opacity: number = 1): Paint {
        return {
            type: 'SOLID',
            color: color,
            opacity: opacity,
            visible: true
        };
    }

    /**
     * Create a gradient paint
     */
    static createGradientPaint(
        type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND',
        stops: { position: number; color: RGBA }[],
        transform?: number[][]
    ): Paint {
        // Default transform if not provided
        const defaultTransform: [[number, number, number], [number, number, number]] = [
            [1, 0, 0],
            [0, 0, 0.5]
        ];
        
        return {
            type: type,
            gradientStops: stops,
            gradientTransform: (transform as any) || defaultTransform,
            visible: true
        };
    }

    /**
     * Create an image paint
     */
    static createImagePaint(
        imageHash: string,
        scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' = 'FILL',
        transform?: number[][]
    ): Paint {
        return {
            type: 'IMAGE',
            imageHash: imageHash,
            scaleMode: scaleMode,
            imageTransform: transform as any,
            visible: true
        };
    }

    /**
     * Create a drop shadow effect
     */
    static createDropShadow(
        offset: { x: number; y: number },
        blur: number,
        spread: number = 0,
        color: RGBA = { r: 0, g: 0, b: 0, a: 0.25 }
    ): Effect {
        return {
            type: 'DROP_SHADOW',
            visible: true,
            radius: blur,
            color: color,
            blendMode: 'NORMAL',
            offset: offset,
            spread: spread,
            showShadowBehindNode: false
        };
    }

    /**
     * Create an inner shadow effect
     */
    static createInnerShadow(
        offset: { x: number; y: number },
        blur: number,
        spread: number = 0,
        color: RGBA = { r: 0, g: 0, b: 0, a: 0.25 }
    ): Effect {
        return {
            type: 'INNER_SHADOW',
            visible: true,
            radius: blur,
            color: color,
            blendMode: 'NORMAL',
            offset: offset,
            spread: spread
        };
    }

    /**
     * Create a blur effect
     */
    static createBlur(radius: number, type: 'LAYER_BLUR' | 'BACKGROUND_BLUR' = 'LAYER_BLUR'): Effect {
        return {
            type: type,
            visible: true,
            radius: radius
        };
    }

    /**
     * Convert hex color to RGB
     */
    static hexToRgb(hex: string): RGB | null {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        } : null;
    }

    /**
     * Convert RGB to hex
     */
    static rgbToHex(rgb: RGB): string {
        const toHex = (c: number) => {
            const hex = Math.round(c * 255).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
    }

    /**
     * Convert CSS color string to RGB
     */
    static cssColorToRgb(cssColor: string): RGB | null {
        // Handle hex colors
        if (cssColor.startsWith('#')) {
            return this.hexToRgb(cssColor);
        }

        // Handle rgb() and rgba() colors
        const rgbMatch = cssColor.match(/rgba?\(([^)]+)\)/);
        if (rgbMatch) {
            const values = rgbMatch[1].split(',').map(v => parseFloat(v.trim()));
            if (values.length >= 3) {
                return {
                    r: values[0] / 255,
                    g: values[1] / 255,
                    b: values[2] / 255
                };
            }
        }

        // Handle transparent keyword
        if (cssColor.toLowerCase() === 'transparent') {
            return { r: 0, g: 0, b: 0 }; // Black with 0 opacity (handled separately)
        }

        // Handle named colors (basic set)
        const namedColors: { [key: string]: RGB } = {
            'black': { r: 0, g: 0, b: 0 },
            'white': { r: 1, g: 1, b: 1 },
            'red': { r: 1, g: 0, b: 0 },
            'green': { r: 0, g: 1, b: 0 },
            'blue': { r: 0, g: 0, b: 1 },
            'yellow': { r: 1, g: 1, b: 0 },
            'cyan': { r: 0, g: 1, b: 1 },
            'magenta': { r: 1, g: 0, b: 1 },
            'gray': { r: 0.5, g: 0.5, b: 0.5 },
            'grey': { r: 0.5, g: 0.5, b: 0.5 }
        };

        return namedColors[cssColor.toLowerCase()] || null;
    }

    /**
     * Create gradient from any CSS gradient string (auto-detect type)
     */ 
    static createGradientFromCSS(cssGradient: string): Paint | null {
        if (cssGradient.includes('linear-gradient')) {
            return this.createLinearGradientFromCSS(cssGradient);
        } else if (cssGradient.includes('radial-gradient')) {
            return this.createRadialGradientFromCSS(cssGradient);
        } else if (cssGradient.includes('conic-gradient')) {
            return this.createConicGradientFromCSS(cssGradient);
        }
        return null;
    }

    /**
     * Create conic gradient from CSS conic-gradient (experimental)
     */
    static createConicGradientFromCSS(cssGradient: string): Paint | null {
        const match = cssGradient.match(/conic-gradient\(([^)]+)\)/);
        if (!match) return null;

        const content = match[1];
        const parts = this.parseGradientParts(content);
        const stops: { position: number; color: RGBA }[] = [];

        let colorIndex = 0;
        const colorParts = parts.filter(part => 
            !part.includes('from ') && !part.includes('at ')
        );

        for (const part of parts) {
            // Skip angle and position keywords
            if (part.includes('from ') || part.includes('at ')) {
                continue;
            }

            // Parse color with optional position and transparency support
            const colorStop = this.parseColorStop(part, colorIndex, colorParts.length);
            if (colorStop) {
                stops.push(colorStop);
                colorIndex++;
            }
        }

        if (stops.length < 2) {
            return null;
        }
        
        // Sort stops by position
        stops.sort((a, b) => a.position - b.position);
        
        // Use angular gradient as closest approximation to conic gradient
        return {
            type: 'GRADIENT_ANGULAR' as const,
            gradientStops: stops,
            gradientTransform: [
                [0.5, 0, 0.5],  // x-axis: centered
                [0, 0.5, 0.5]   // y-axis: centered
            ] as [[number, number, number], [number, number, number]],
            visible: true
        };
    }

    /**
     * Convert CSS color string to RGBA with opacity support
     */
    static cssColorToRgba(cssColor: string): RGBA | null {
        // Handle transparent keyword
        if (cssColor.toLowerCase() === 'transparent') {
            return { r: 0, g: 0, b: 0, a: 0 };
        }

        // Handle hex colors with optional alpha
        if (cssColor.startsWith('#')) {
            const rgb = this.hexToRgb(cssColor);
            return rgb ? { ...rgb, a: 1 } : null;
        }

        // Handle rgba() colors with alpha
        const rgbaMatch = cssColor.match(/rgba\(([^)]+)\)/);
        if (rgbaMatch) {
            const values = rgbaMatch[1].split(',').map(v => parseFloat(v.trim()));
            if (values.length >= 4) {
                return {
                    r: values[0] / 255,
                    g: values[1] / 255,
                    b: values[2] / 255,
                    a: values[3]
                };
            }
        }

        // Handle rgb() colors (no alpha)
        const rgbMatch = cssColor.match(/rgb\(([^)]+)\)/);
        if (rgbMatch) {
            const values = rgbMatch[1].split(',').map(v => parseFloat(v.trim()));
            if (values.length >= 3) {
                return {
                    r: values[0] / 255,
                    g: values[1] / 255,
                    b: values[2] / 255,
                    a: 1
                };
            }
        }

        // Handle named colors
        const rgb = this.cssColorToRgb(cssColor);
        return rgb ? { ...rgb, a: 1 } : null;
    }

    /**
     * Create gradient from CSS linear-gradient with enhanced transparency support
     */
    static createLinearGradientFromCSS(cssGradient: string): Paint | null {
        // Enhanced parser for linear-gradient with balanced parentheses
        const regex = /linear-gradient\(((?:[^()]|\([^)]*\))*)\)/;
        const match = cssGradient.match(regex);
        if (!match) {
            return null;
        }

        const content = match[1];
        const parts = this.parseGradientParts(content);
        
        const stops: { position: number; color: RGBA }[] = [];
        let angle = 180; // Default: 180deg (top to bottom in CSS)

        let colorIndex = 0;
        const colorParts = parts.filter(part => !part.includes('deg') && !part.includes('rad') && !part.includes('turn') && !part.includes('grad') && !part.includes('to '));
        
        for (const part of parts) {
            // Parse angle/direction
            if (part.includes('deg') || part.includes('rad') || part.includes('turn') || part.includes('grad')) {
                angle = this.parseAngle(part);
                continue;
            }
            
            // Parse direction keywords (to top, to right, etc.)
            if (part.includes('to ')) {
                angle = this.parseDirection(part);
                continue;
            }

            // Parse color with optional position and transparency support
            const colorStop = this.parseColorStop(part, colorIndex, colorParts.length);
            if (colorStop) {
                stops.push(colorStop);
                colorIndex++;
            }
        }

        if (stops.length < 2) {
            return null;
        }
        
        // Sort stops by position to ensure proper gradient ordering
        stops.sort((a, b) => a.position - b.position);
        
        // Create gradient with transform matrix based on angle
        const gradientTransform = this.calculateLinearGradientTransform(angle);
        
        const result = {
            type: 'GRADIENT_LINEAR' as const,
            gradientStops: stops,
            gradientTransform: gradientTransform,
            visible: true
        };
        return result;
    }

    /**
     * Parse angle from gradient string
     */
    private static parseAngle(angleStr: string): number {
        angleStr = angleStr.trim();
        
        if (angleStr.endsWith('deg')) {
            return parseFloat(angleStr);
        } else if (angleStr.endsWith('rad')) {
            return parseFloat(angleStr) * (180 / Math.PI);
        } else if (angleStr.endsWith('grad')) {
            return parseFloat(angleStr) * (180 / 200);
        } else if (angleStr.endsWith('turn')) {
            return parseFloat(angleStr) * 360;
        }
        
        return parseFloat(angleStr) || 180;
    }

    /**
     * Parse direction keywords (to top, to right, etc.)
     */
    private static parseDirection(direction: string): number {
        direction = direction.trim().toLowerCase();
        
        // Handle compound directions
        if (direction.includes('to top') && direction.includes('right')) {
            return 45;  // to top right
        }
        if (direction.includes('to top') && direction.includes('left')) {
            return 315;  // to top left
        }
        if (direction.includes('to bottom') && direction.includes('right')) {
            return 135;  // to bottom right
        }
        if (direction.includes('to bottom') && direction.includes('left')) {
            return 225;  // to bottom left
        }
        
        // Handle simple directions
        if (direction.includes('to top')) {
            return 0;
        }
        if (direction.includes('to right')) {
            return 90;
        }
        if (direction.includes('to bottom')) {
            return 180;
        }
        if (direction.includes('to left')) {
            return 270;
        }
        
        return 180; // default
    }

    /**
     * Calculate gradient transform matrix for linear gradient based on angle
     * CSS angle: 0deg = to top, 90deg = to right, 180deg = to bottom, 270deg = to left (顺时针)
     * Figma uses a transform matrix where the gradient goes from [0,0] to [1,0] by default (horizontal)
     */
    private static calculateLinearGradientTransform(angleDeg: number): [[number, number, number], [number, number, number]] {
        // CSS 渐变角度是顺时针的，从 "to top" (0deg) 开始
        // 需要转换为数学角度（逆时针，0度为水平向右）
        // CSS 0deg = to top = 数学 90deg
        // CSS 90deg = to right = 数学 0deg
        // CSS 180deg = to bottom = 数学 270deg (-90deg)
        // CSS 270deg = to left = 数学 180deg
        
        // 在屏幕坐标系中（Y轴向下），角度转换为：
        // 数学角度 = 90deg - CSS角度（因为 CSS 是顺时针，数学是逆时针）
        const mathAngleDeg = 90 - angleDeg;
        const angleRad = mathAngleDeg * (Math.PI / 180);
        
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        
        // Figma 渐变变换矩阵
        // 第一行 [a, b, tx]: 定义渐变终点的 x 分量
        // 第二行 [c, d, ty]: 定义渐变终点的 y 分量
        // 渐变从 (0.5, 0.5) 开始，沿着 (cos, sin) 方向
        return [
            [cos, -sin, 0.5 - cos / 2 + sin / 2],  // x-axis transformation
            [sin, cos, 0.5 - sin / 2 - cos / 2]     // y-axis transformation
        ];
    }

    /**
     * Create gradient from CSS radial-gradient with enhanced transparency support
     */
    static createRadialGradientFromCSS(cssGradient: string): Paint | null {
        
        // Enhanced parser for radial-gradient with balanced parentheses
        const regex = /radial-gradient\(((?:[^()]|\([^)]*\))*)\)/;
        const match = cssGradient.match(regex);
        if (!match) return null;

        const content = match[1];
        const parts = this.parseGradientParts(content);
        const stops: { position: number; color: RGBA }[] = [];
        
        // Parse shape (circle or ellipse, default is ellipse)
        let isCircle = false;
        let position = { x: 0.5, y: 0.5 }; // Default center
        let hasProcessedShapeOrPosition = false;

        let colorIndex = 0;
        
        // 第一步：先处理形状和位置参数
        for (const part of parts) {
            const trimmedPart = part.trim();
            
            // 检查是否是形状/位置关键字
            const isShapeOrPosition = 
                trimmedPart === 'circle' || 
                trimmedPart === 'ellipse' ||
                trimmedPart.startsWith('circle ') ||
                trimmedPart.startsWith('ellipse ') ||
                trimmedPart.includes('closest-side') || 
                trimmedPart.includes('farthest-side') ||
                trimmedPart.includes('closest-corner') || 
                trimmedPart.includes('farthest-corner') ||
                trimmedPart.includes(' at ');
            
            if (isShapeOrPosition) {
                hasProcessedShapeOrPosition = true;
                
                // 解析形状
                if (trimmedPart.includes('circle')) {
                    isCircle = true;
                }
                
                // 解析位置
                if (trimmedPart.includes(' at ')) {
                    position = this.parseRadialGradientPosition(trimmedPart);
                }
            }
        }
        
        // 第二步：过滤出颜色部分
        const colorParts = parts.filter(part => {
            const trimmedPart = part.trim();
            
            // 跳过形状/位置关键字
            if (trimmedPart === 'circle' || trimmedPart === 'ellipse') return false;
            if (trimmedPart.startsWith('circle ') || trimmedPart.startsWith('ellipse ')) return false;
            if (trimmedPart.includes('closest-') || trimmedPart.includes('farthest-')) return false;
            if (trimmedPart.includes(' at ') && !trimmedPart.match(/rgb|hsl|#|[a-z]+\s+\d+%/)) return false;
            
            return true;
        });

        // 第三步：解析颜色停止点
        for (const part of colorParts) {
            const colorStop = this.parseColorStop(part, colorIndex, colorParts.length);
            if (colorStop) {
                stops.push(colorStop);
                colorIndex++;
            }
        }

        if (stops.length < 2) {
            return null;
        }
        
        // Sort stops by position to ensure proper gradient ordering
        stops.sort((a, b) => a.position - b.position);
        
        // Create gradient transform matrix for radial gradient
        const gradientTransform = this.calculateRadialGradientTransform(isCircle, position);
        
        return {
            type: 'GRADIENT_RADIAL' as const,
            gradientStops: stops,
            gradientTransform: gradientTransform,
            visible: true
        };
    }

    /**
     * Parse radial gradient position from 'at' clause
     * 支持：at center, at left top, at 50% 50%, at 10px 20px 等
     */
    private static parseRadialGradientPosition(atClause: string): { x: number; y: number } {
        const defaultPos = { x: 0.5, y: 0.5 };
        
        // 提取 'at' 后面的内容
        const atMatch = atClause.match(/at\s+(.+)$/);
        if (!atMatch) return defaultPos;
        
        const positionStr = atMatch[1].trim();
        
        // 解析百分比位置: "50% 50%" 或 "at 25% 75%"
        const percentMatch = positionStr.match(/(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
        if (percentMatch) {
            return {
                x: parseFloat(percentMatch[1]) / 100,
                y: parseFloat(percentMatch[2]) / 100
            };
        }
        
        // 解析关键字位置
        const keywords = positionStr.toLowerCase().split(/\s+/);
        let x = 0.5; // default center
        let y = 0.5; // default center
        
        for (const keyword of keywords) {
            switch (keyword) {
                case 'left':
                    x = 0;
                    break;
                case 'right':
                    x = 1;
                    break;
                case 'top':
                    y = 0;
                    break;
                case 'bottom':
                    y = 1;
                    break;
                case 'center':
                    // center 可以应用于 x 或 y，取决于上下文
                    // 如果只有 center，则两者都是 0.5
                    // 如果 center 配合其他关键字，保持默认
                    if (keywords.length === 1) {
                        x = 0.5;
                        y = 0.5;
                    }
                    break;
            }
        }
        
        return { x, y };
    }

    /**
     * Calculate gradient transform matrix for radial gradient
     */
    private static calculateRadialGradientTransform(
        isCircle: boolean, 
        position: { x: number, y: number }
    ): [[number, number, number], [number, number, number]] {
        if (isCircle) {
            // For circle, use uniform scaling to ensure it's truly circular
            // Scale factor 0.5 means the gradient radius is 0.5 (from center to edge)
            return [
                [0.5, 0, position.x],  // x-axis: uniform scale, centered at position
                [0, 0.5, position.y]   // y-axis: uniform scale, centered at position
            ];
        } else {
            // For ellipse, can stretch differently on x and y
            // This allows the gradient to fill the shape naturally
            return [
                [0.5, 0, position.x],  // x-axis: centered at position
                [0, 0.5, position.y]   // y-axis: centered at position
            ];
        }
    }

    /**
     * Parse gradient parts from CSS gradient string
     */
    private static parseGradientParts(content: string): string[] {
        // Split by comma, but handle nested functions like rgba()
        const parts: string[] = [];
        let current = '';
        let depth = 0;
        
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            
            if (char === '(') depth++;
            else if (char === ')') depth--;
            else if (char === ',' && depth === 0) {
                parts.push(current.trim());
                current = '';
                continue;
            }
            
            current += char;
        }
        
        if (current.trim()) {
            parts.push(current.trim());
        }
        
        return parts;
    }

    /**
     * Parse a single color stop with enhanced transparency support
     */
    private static parseColorStop(part: string, index: number, totalParts: number): { position: number; color: RGBA } | null {
        // Match patterns like "red", "red 50%", "#ff0000 25%", "rgba(255,0,0,0.5) 75%", "transparent 30%"
        const percentRegex = /^(.+?)\s+(\d+(?:\.\d+)?)%$/;
        
        let colorStr: string;
        let positionStr: string | undefined;
        
        const withPercentMatch = part.match(percentRegex);
        if (withPercentMatch) {
            colorStr = withPercentMatch[1].trim();
            positionStr = withPercentMatch[2];
        } else {
            colorStr = part.trim();
            positionStr = undefined;
        }

        // Parse color with alpha support
        let colorWithAlpha: RGBA | null = null;
        
        // Use the enhanced cssColorToRgba method
        colorWithAlpha = this.cssColorToRgba(colorStr);

        if (!colorWithAlpha) {
            return null;
        }

        // Parse position
        let position: number;
        if (positionStr) {
            position = parseFloat(positionStr) / 100;
        } else {
            // Auto-distribute positions
            position = totalParts > 1 ? index / (totalParts - 1) : 0;
        }

        const result = {
            position: Math.max(0, Math.min(1, position)),
            color: colorWithAlpha
        };
        
        return result;
    }

    /**
     * Parse CSS box-shadow to Figma effects
     */
    static parseBoxShadow(boxShadow: string): Effect[] {
        if (!boxShadow || boxShadow === 'none') {
            return [];
        }

        const effects: Effect[] = [];
        const shadows = boxShadow.split(',').map(s => s.trim());

        shadows.forEach(shadow => {
            const parts = shadow.split(/\s+/);
            if (parts.length >= 4) {
                const offsetX = parseFloat(parts[0]) || 0;
                const offsetY = parseFloat(parts[1]) || 0;
                const blurRadius = parseFloat(parts[2]) || 0;
                const spreadRadius = parseFloat(parts[3]) || 0;
                
                let color: RGBA = { r: 0, g: 0, b: 0, a: 0.25 };
                if (parts[4]) {
                    const rgb = this.cssColorToRgb(parts[4]);
                    if (rgb) {
                        color = { ...rgb, a: 1 };
                    }
                }

                const isInset = shadow.includes('inset');
                const effect = isInset 
                    ? this.createInnerShadow({ x: offsetX, y: offsetY }, blurRadius, spreadRadius, color)
                    : this.createDropShadow({ x: offsetX, y: offsetY }, blurRadius, spreadRadius, color);

                effects.push(effect);
            }
        });

        return effects;
    }

    /**
     * Blend two colors
     */
    static blendColors(color1: RGB, color2: RGB, ratio: number): RGB {
        const clamp = (value: number) => Math.max(0, Math.min(1, value));
        
        return {
            r: clamp(color1.r * (1 - ratio) + color2.r * ratio),
            g: clamp(color1.g * (1 - ratio) + color2.g * ratio),
            b: clamp(color1.b * (1 - ratio) + color2.b * ratio)
        };
    }

    /**
     * Lighten a color
     */
    static lightenColor(color: RGB, amount: number): RGB {
        return this.blendColors(color, { r: 1, g: 1, b: 1 }, amount);
    }

    /**
     * Darken a color
     */
    static darkenColor(color: RGB, amount: number): RGB {
        return this.blendColors(color, { r: 0, g: 0, b: 0 }, amount);
    }

    /**
     * Get contrast ratio between two colors
     */
    static getContrastRatio(color1: RGB, color2: RGB): number {
        const getLuminance = (color: RGB) => {
            const { r, g, b } = color;
            const [rs, gs, bs] = [r, g, b].map(c => {
                return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
        };

        const lum1 = getLuminance(color1);
        const lum2 = getLuminance(color2);
        const brightest = Math.max(lum1, lum2);
        const darkest = Math.min(lum1, lum2);

        return (brightest + 0.05) / (darkest + 0.05);
    }
}
