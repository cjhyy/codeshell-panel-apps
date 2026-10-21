/*! html2figma FigmaService/adapter; MIT. See NOTICE.md. */
"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // third-party/html2figma-plugin/integration/sandbox-globals.ts
  var TextEncoder = class {
    encode(value = "") {
      const bytes = [];
      for (const char of String(value)) {
        let code = char.codePointAt(0);
        if (code >= 55296 && code <= 57343) code = 65533;
        if (code < 128) bytes.push(code);
        else if (code < 2048) bytes.push(192 | code >> 6, 128 | code & 63);
        else if (code < 65536)
          bytes.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
        else
          bytes.push(
            240 | code >> 18,
            128 | code >> 12 & 63,
            128 | code >> 6 & 63,
            128 | code & 63
          );
      }
      return new Uint8Array(bytes);
    }
  };
  function atob(value) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "", bits = 0, buffer = 0;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4) throw new Error("Invalid base64");
    for (const char of value.replace(/=+$/, "")) {
      buffer = buffer << 6 | alphabet.indexOf(char);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode(buffer >> bits & 255);
      }
    }
    return out;
  }

  // third-party/html2figma/upstream/packages/shared/utils.ts
  var _idCounter = 0;
  function generateId(prefix = "node") {
    const timestamp = Date.now();
    const counter = ++_idCounter;
    const random = Math.random().toString(36).substring(2, 7);
    return `${prefix}_${timestamp}_${counter}_${random}`;
  }
  function validateFontName(family, style) {
    const styleMap = {
      "normal": "Regular",
      "regular": "Regular",
      "solid": "Solid",
      "medium": "Medium",
      "semibold": "Semi Bold",
      "semi-bold": "Semi Bold",
      "bold": "Bold",
      "extrabold": "Extra Bold",
      "extra-bold": "Extra Bold",
      "light": "Light",
      "thin": "Thin",
      "italic": "Italic",
      "oblique": "Italic"
    };
    const normalizedStyle = styleMap[style.toLowerCase()] || style;
    const validStyles = ["Regular", "Solid", "Bold", "Light", "Medium", "Semi Bold", "Extra Bold", "Italic"];
    const finalStyle = validStyles.includes(normalizedStyle) ? normalizedStyle : "Regular";
    return {
      family: family || "Inter",
      style: finalStyle
    };
  }

  // third-party/html2figma/upstream/packages/shared/logger-modules.ts
  var MODULE_GROUPS = {
    // Figma creators
    FIGMA_CREATORS: [
      "FrameCreator" /* FRAME_CREATOR */,
      "RectangleCreator" /* RECTANGLE_CREATOR */,
      "TextCreator" /* TEXT_CREATOR */,
      "ImageCreator" /* IMAGE_CREATOR */,
      "GroupCreator" /* GROUP_CREATOR */
    ],
    // Core services
    CORE_SERVICES: [
      "FigmaService" /* FIGMA_SERVICE */,
      "FigmaCreator" /* FIGMA_CREATOR */,
      "NodeTraverser" /* NODE_TRAVERSER */
    ],
    // Utilities
    UTILITIES: [
      "StyleProcessor" /* STYLE_PROCESSOR */,
      "LayoutProcessor" /* LAYOUT_PROCESSOR */
    ],
    // Extension
    EXTENSION: [
      "ExtImages" /* EXT_IMAGES */,
      "ExtBackground" /* EXT_BACKGROUND */,
      "ExtContent" /* EXT_CONTENT */
    ]
  };
  var CATEGORIZED_MODULES = {
    "Figma Creators": MODULE_GROUPS.FIGMA_CREATORS,
    "Core Services": MODULE_GROUPS.CORE_SERVICES,
    "Utilities": MODULE_GROUPS.UTILITIES,
    "Extension": MODULE_GROUPS.EXTENSION
  };

  // third-party/html2figma-plugin/integration/shared.ts
  var creatorErrors = [];
  var logger = {
    info() {
    },
    debug() {
    },
    warn() {
    },
    error(...args) {
      creatorErrors.push(
        args.map((v) => v instanceof Error ? v.message : typeof v === "string" ? v : "").filter(Boolean).join(" ").slice(0, 400)
      );
    }
  };
  function createLogger(..._args) {
    return logger;
  }

  // third-party/html2figma-plugin/upstream/packages/figma/base/BaseNodeCreator.ts
  var BaseNodeCreator = class {
    constructor(figmaApi) {
      __publicField(this, "figmaApi");
      __publicField(this, "logger", createLogger("BaseNodeCreator"));
      this.figmaApi = figmaApi;
    }
    /**
     * Set basic properties common to all nodes
     */
    setBaseProperties(node, data) {
      const nodeName = data.name || "Layer";
      this.logger.info(`\u{1F527} \u8BBE\u7F6E\u57FA\u7840\u5C5E\u6027: "${nodeName}"`);
      node.name = nodeName;
      node.visible = data.visible !== false;
      node.locked = data.locked || false;
      this.logger.info(`  - \u540D\u79F0: "${nodeName}", \u53EF\u89C1: ${node.visible}, \u9501\u5B9A: ${node.locked}`);
      const isAbsoluteChild = data.layoutPositioning === "ABSOLUTE";
      const parentIsAutoLayout = this.isParentAutoLayout(node);
      const shouldSetPosition = !parentIsAutoLayout || isAbsoluteChild;
      if (shouldSetPosition) {
        if ("x" in data) {
          node.x = data.x || 0;
          this.logger.info(`  - X \u4F4D\u7F6E: ${node.x}`);
        }
        if ("y" in data) {
          node.y = data.y || 0;
          this.logger.info(`  - Y \u4F4D\u7F6E: ${node.y}`);
        }
      } else {
        this.logger.info(`  - \u8DF3\u8FC7 x/y \u8BBE\u7F6E\uFF08\u7236\u8282\u70B9\u662F auto-layout\uFF0C\u5F53\u524D\u8282\u70B9\u662F flow child\uFF09`);
      }
      if ("rotation" in data && data.rotation) {
        node.rotation = data.rotation;
        this.logger.info(`  - \u65CB\u8F6C: ${data.rotation}\xB0`);
      }
      if ("opacity" in data && data.opacity !== void 0) {
        node.opacity = data.opacity;
        this.logger.info(`  - \u900F\u660E\u5EA6: ${data.opacity}`);
      }
      if ("blendMode" in data && data.blendMode) {
        node.blendMode = data.blendMode;
        this.logger.info(`  - \u6DF7\u5408\u6A21\u5F0F: ${data.blendMode}`);
      }
      if ("layoutPositioning" in data && data.layoutPositioning) {
        this.setLayoutPositioning(node, data);
      }
      if (data.sharedPluginData) {
        this.setSharedPluginData(node, data.sharedPluginData);
      }
      this.logger.info(`\u2705 \u57FA\u7840\u5C5E\u6027\u8BBE\u7F6E\u5B8C\u6210: "${nodeName}"`);
    }
    /**
     * Write semantic metadata to Figma node via sharedPluginData.
     * Uses namespace 'html2figma' so any plugin can read it.
     */
    setSharedPluginData(node, dataMap) {
      const NAMESPACE = "html2figma";
      try {
        if (typeof node.setSharedPluginData !== "function") return;
        for (const [key, value] of Object.entries(dataMap)) {
          if (value !== void 0 && value !== null) {
            node.setSharedPluginData(NAMESPACE, key, String(value));
          }
        }
        this.logger.info(`  - \u5DF2\u5199\u5165 sharedPluginData (${Object.keys(dataMap).length} \u4E2A\u5B57\u6BB5)`);
      } catch (error) {
        this.logger.warn(`\u26A0\uFE0F \u5199\u5165 sharedPluginData \u5931\u8D25`, error);
      }
    }
    /**
     * Set size properties after layout properties are configured
     * This ensures auto-layout axis properties are set before dimensions
     */
    setSizeProperties(node, data) {
      if ("width" in data && "height" in data) {
        const width = data.width || 1;
        const height = data.height || 1;
        node.resize(width, height);
        this.logger.info(`\u{1F4CF} \u8BBE\u7F6E\u5C3A\u5BF8 (\u5728\u5E03\u5C40\u5C5E\u6027\u4E4B\u540E): ${width} \xD7 ${height}`);
      }
    }
    /**
     * Set fill properties
     */
    setFills(node, fills) {
      if (fills && fills.length > 0) {
        fills.forEach((fill, index) => {
          if (fill.type === "GRADIENT_LINEAR" || fill.type === "GRADIENT_RADIAL") {
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
    setStrokes(node, strokes, strokeWeight, strokeAlign, strokeTopWeight, strokeRightWeight, strokeBottomWeight, strokeLeftWeight, strokeDashPattern) {
      if (strokes && strokes.length > 0) {
        node.strokes = strokes;
      }
      if (strokeWeight !== void 0) {
        node.strokeWeight = strokeWeight;
      }
      if (strokeAlign) {
        node.strokeAlign = strokeAlign;
      }
      if (strokeTopWeight !== void 0 || strokeRightWeight !== void 0 || strokeBottomWeight !== void 0 || strokeLeftWeight !== void 0) {
        node.strokeTopWeight = strokeTopWeight || 0;
        node.strokeRightWeight = strokeRightWeight || 0;
        node.strokeBottomWeight = strokeBottomWeight || 0;
        node.strokeLeftWeight = strokeLeftWeight || 0;
      }
      if (strokeDashPattern !== void 0) {
        node.dashPattern = strokeDashPattern;
      }
    }
    /**
     * Set corner radius for rectangular shapes
     */
    setCornerRadius(node, cornerRadius) {
      if (cornerRadius !== void 0 && "cornerRadius" in node) {
        node.cornerRadius = cornerRadius;
      }
    }
    /**
     * Set effects (shadows, blurs, etc.)
     */
    setEffects(node, effects) {
      if (effects && effects.length > 0) {
        node.effects = effects;
      }
    }
    /**
     * Set layout positioning for element positioning
     * 只在父节点是 auto layout 时设置，子节点本身类型不限制
     */
    setLayoutPositioning(node, data) {
      const layoutPositioning = data.layoutPositioning;
      if (!layoutPositioning || !node) {
        return;
      }
      try {
        if (this.isParentAutoLayout(node)) {
          node.layoutPositioning = layoutPositioning;
          if (layoutPositioning === "ABSOLUTE" && data.x !== void 0 && data.y !== void 0) {
            node.x = data.x;
            node.y = data.y;
            this.logger.info(`  - \u5E03\u5C40\u5B9A\u4F4D: ${layoutPositioning}\uFF0C\u5750\u6807: (${data.x}, ${data.y})`);
          } else {
            this.logger.info(`  - \u5E03\u5C40\u5B9A\u4F4D: ${layoutPositioning}`);
          }
          if (data.constraints) {
            try {
              node.constraints = data.constraints;
              this.logger.info(`  - \u7EA6\u675F: H=${data.constraints.horizontal}, V=${data.constraints.vertical}`);
            } catch (e) {
              this.logger.warn(`\u26A0\uFE0F \u8BBE\u7F6E\u7EA6\u675F\u5931\u8D25`, e);
            }
          }
        } else {
          if (layoutPositioning === "ABSOLUTE" && data.x !== void 0 && data.y !== void 0) {
            node.x = data.x;
            node.y = data.y;
            this.logger.info(`  - \u7EDD\u5BF9\u5B9A\u4F4D\uFF08\u7236\u8282\u70B9\u975E auto layout\uFF09\uFF0C\u5750\u6807: (${data.x}, ${data.y})`);
          } else {
            this.logger.info(`  - \u8DF3\u8FC7\u5E03\u5C40\u5B9A\u4F4D\u8BBE\u7F6E\uFF0C\u7236\u8282\u70B9\u4E0D\u662F auto layout`);
          }
        }
      } catch (error) {
        this.logger.warn(`\u26A0\uFE0F \u8BBE\u7F6E\u5E03\u5C40\u5B9A\u4F4D\u5931\u8D25: ${layoutPositioning}`, error);
      }
    }
    /**
     * 检查父节点是否是 auto layout
     */
    isParentAutoLayout(node) {
      try {
        if (!node.parent) {
          return false;
        }
        const parent = node.parent;
        if ("layoutMode" in parent && parent.layoutMode && parent.layoutMode !== "NONE") {
          return true;
        } else {
          return false;
        }
      } catch (error) {
        this.logger.warn(`\u68C0\u67E5\u7236\u8282\u70B9 auto layout \u72B6\u6001\u5931\u8D25:`, error);
        return false;
      }
    }
    /**
     * Validate node data before creation
     */
    validateData(data) {
      if (!data) {
        throw new Error("Node data is required");
      }
      if (!data.type) {
        throw new Error("Node type is required");
      }
      return true;
    }
    /**
     * Log creation for debugging
     */
    logCreation(nodeType, nodeName) {
    }
    /**
     * Handle errors during node creation
     */
    handleError(error, nodeType, data) {
      const message = `Failed to create ${nodeType} node: ${error.message}`;
      throw new Error(message);
    }
  };

  // third-party/html2figma-plugin/upstream/packages/figma/creators/ImageCreator.ts
  var staticLogger = createLogger("ImageCreator" /* IMAGE_CREATOR */);
  var _ImageCreator = class _ImageCreator extends BaseNodeCreator {
    static async acquireSlot() {
      if (_ImageCreator.activeTasks < _ImageCreator.CONCURRENCY_LIMIT) {
        _ImageCreator.activeTasks++;
        return;
      }
      return new Promise((resolve) => {
        _ImageCreator.waitQueue.push(resolve);
      });
    }
    static releaseSlot() {
      _ImageCreator.activeTasks--;
      if (_ImageCreator.waitQueue.length > 0) {
        _ImageCreator.activeTasks++;
        const next = _ImageCreator.waitQueue.shift();
        next();
      }
    }
    /**
     * 通用辅助方法：更新 node 的 fills，支持多层 fills（渐变+图片）
     * @param node - Figma 节点
     * @param newFill - 新的 fill（通常是 IMAGE 类型）
     * @param existingFills - 现有的 fills 数组（可选，如果不提供则从 node.fills 获取）
     */
    static updateNodeFills(node, newFill, existingFills) {
      const currentFills = existingFills || node.fills || [];
      const hasImageFill = currentFills.some((fill) => fill.type === "IMAGE");
      if (hasImageFill) {
        const updatedFills = currentFills.map((fill) => {
          if (fill.type === "IMAGE") {
            return newFill;
          }
          return fill;
        });
        node.fills = updatedFills;
      } else if (currentFills.length > 0) {
        node.fills = [newFill, ...currentFills];
      } else {
        node.fills = [newFill];
      }
    }
    /**
     * Create an Image node (Rectangle with image fill) from JSON data (only creates the node)
     */
    create(data) {
      try {
        this.validateData(data);
        const rectangle = this.figmaApi.createRectangle();
        return rectangle;
      } catch (error) {
        this.handleError(error, "Image", data);
      }
    }
    /**
     * Set all properties for the image after creation
     */
    setProperties(rectangle, data) {
      try {
        this.setBaseProperties(rectangle, data);
        this.setRectangleProperties(rectangle, data);
        this.setSizeProperties(rectangle, data);
        const imageMetadata = data.imageMetadata;
        const hasImageMetadataUrl = imageMetadata && imageMetadata.originalUrl;
        const hasValidImageHash = data.fills?.some(
          (fill) => fill.type === "IMAGE" && fill.imageHash && typeof fill.imageHash === "string" && fill.imageHash.length > 0
        );
        if (hasImageMetadataUrl) {
          rectangle.fills = [];
          let resolvedMeta = imageMetadata;
          if (!resolvedMeta.svgContent && resolvedMeta.base64?.startsWith("data:image/svg")) {
            const ci = resolvedMeta.base64.indexOf(",");
            if (ci !== -1) {
              const payload = resolvedMeta.base64.substring(ci + 1);
              const isB64 = resolvedMeta.base64.substring(0, ci).includes("base64");
              try {
                const decoded = isB64 ? atob(payload) : decodeURIComponent(payload);
                if (decoded.trimStart().startsWith("<svg")) {
                  resolvedMeta = { ...resolvedMeta, isSvg: true, svgContent: decoded };
                }
              } catch {
              }
            }
          }
          if (resolvedMeta.isSvg && resolvedMeta.svgContent) {
            this.logger.info(`\u{1F3A8} SVG imageMetadata \u2192 createNodeFromSvg (${resolvedMeta.svgContent.length} chars): ${resolvedMeta.originalUrl?.substring(0, 60)}`);
            this.processSvgContent(rectangle, resolvedMeta).catch((error) => {
              this.logger.error("\u274C Failed to process SVG from svgContent:", error);
              _ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill(`SVG processing failed: ${error}`), data.fills);
            });
          } else if (resolvedMeta.isSvg && !resolvedMeta.svgContent) {
            this.logger.warn(`\u26A0\uFE0F isSvg=true but no svgContent: ${resolvedMeta.originalUrl?.substring(0, 60)}`);
          } else if (imageMetadata.base64) {
            const jsonImageHash = data.fills?.find((fill) => fill.type === "IMAGE")?.imageHash;
            this.processBase64Image(rectangle, imageMetadata, jsonImageHash).catch((error) => {
              this.logger.warn(`\u26A0\uFE0F Base64 failed for "${data.name}", falling back to URL download:`, error);
              if (imageMetadata.originalUrl) {
                this.setImageProperties(rectangle, data).catch((urlError) => {
                  _ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill(`Image failed: ${error}`), data.fills);
                });
              } else {
                _ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill(`Base64 processing failed: ${error}`), data.fills);
              }
            });
          } else {
            this.setImageProperties(rectangle, data).catch((error) => {
              _ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill("Image download failed - no base64 data"), data.fills);
            });
          }
        } else if (hasValidImageHash) {
          const processedFills = data.fills?.map((fill) => {
            if (fill.type === "IMAGE" && fill.imageHash) {
              const jsonImageHash = fill.imageHash;
              if (_ImageCreator.imageHashCache.has(jsonImageHash)) {
                const cachedFigmaHash = _ImageCreator.imageHashCache.get(jsonImageHash);
                _ImageCreator.cacheStats.hits++;
                return {
                  ...fill,
                  imageHash: cachedFigmaHash
                };
              } else {
                _ImageCreator.cacheStats.misses++;
                this.logger.warn(`\u26A0\uFE0F [setProperties] Cache MISS for ${data.name}! JSON hash ${jsonImageHash.substring(0, 8)}... not found in cache. Image may not render. (Misses: ${_ImageCreator.cacheStats.misses})`);
                return fill;
              }
            }
            return fill;
          }) || [];
          rectangle.fills = processedFills;
        } else {
          this.setImageProperties(rectangle, data).catch((error) => {
            _ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill("Image loading failed"), data.fills);
          });
        }
        this.logCreation("Image", data.name);
      } catch (error) {
        throw error;
      }
    }
    /**
     * Set layout-specific properties for child image nodes after they are added to parent
     */
    /**
     * Set rectangle-specific properties
     * NOTE: Fills are NOT set here for image nodes — they are handled by the
     * image processing logic in setProperties() to avoid setting invalid
     * IMAGE fills (no imageHash) which would throw and prevent strokes from being applied.
     */
    setRectangleProperties(rectangle, data) {
      this.setStrokes(rectangle, data.strokes || [], data.strokeWeight, data.strokeAlign, void 0, void 0, void 0, void 0, data.strokeDashPattern);
      this.setCornerRadius(rectangle, data.cornerRadius);
      if (data.effects) {
        this.setEffects(rectangle, data.effects);
      }
    }
    /**
     * Process SVG content directly without network request
     * @param rectangle - The rectangle node to apply the SVG as image fill
     * @param imageMetadata - Image metadata containing svgContent
     */
    async processSvgContent(rectangle, imageMetadata) {
      await _ImageCreator.acquireSlot();
      try {
        this.logger.info("\u{1F3A8} Creating SVG node from svgContent...");
        const svgNode = this.figmaApi.createNodeFromSvg(imageMetadata.svgContent);
        this.logger.info("\u{1F4F8} Exporting SVG to PNG...");
        const pngBytes = await svgNode.exportAsync({
          format: "PNG",
          constraint: { type: "SCALE", value: 2 }
        });
        const figmaImage = this.figmaApi.createImage(pngBytes);
        svgNode.remove();
        const imageFill = {
          type: "IMAGE",
          imageHash: figmaImage.hash,
          scaleMode: imageMetadata.scaleMode || "FILL"
        };
        _ImageCreator.updateNodeFills(rectangle, imageFill);
        this.logger.info("\u2705 SVG processed from svgContent successfully (no network request)");
      } catch (error) {
        this.logger.error("\u274C SVG processing error:", error);
        throw error;
      } finally {
        _ImageCreator.releaseSlot();
      }
    }
    /**
     * Process base64 image data from browser preprocessing
     * @param rectangle - The rectangle node to apply the image fill to
     * @param imageMetadata - Image metadata containing base64 data
     * @param jsonImageHash - The imageHash from JSON (used as cache key)
     */
    async processBase64Image(rectangle, imageMetadata, jsonImageHash) {
      const success = await _ImageCreator.processAndApplyBase64Image(
        rectangle,
        imageMetadata,
        jsonImageHash,
        this.figmaApi
      );
      if (!success) {
        throw new Error("Failed to process base64 image");
      }
    }
    /**
     * Static method to process base64 image and apply to any node
     * Can be reused by FrameCreator and other creators
     */
    static async processAndApplyBase64Image(node, imageMetadata, jsonImageHash, figmaApi) {
      try {
        const nodeName = node?.name || "unknown";
        staticLogger.info(`[processBase64] Starting for "${nodeName}", base64 length: ${imageMetadata.base64?.length || 0}, url: ${imageMetadata.originalUrl?.substring(0, 60) || "none"}`);
        if (jsonImageHash && _ImageCreator.imageHashCache.has(jsonImageHash)) {
          const cachedFigmaHash = _ImageCreator.imageHashCache.get(jsonImageHash);
          _ImageCreator.cacheStats.hits++;
          const scaleMode2 = imageMetadata.scaleMode || "FILL";
          const imageFill2 = {
            type: "IMAGE",
            imageHash: cachedFigmaHash,
            scaleMode: scaleMode2
          };
          if (scaleMode2 === "TILE") {
            imageFill2.scalingFactor = 1;
          }
          if (imageMetadata.imageTransform) {
            imageFill2.imageTransform = imageMetadata.imageTransform;
          }
          if (scaleMode2 === "TILE" && imageMetadata.tileSize) {
            try {
              const figmaImage2 = figmaApi.getImageByHash(cachedFigmaHash);
              if (figmaImage2) {
                const naturalSize = await figmaImage2.getSizeAsync();
                if (naturalSize.width > 0) {
                  imageFill2.scalingFactor = imageMetadata.tileSize.width / naturalSize.width;
                }
              }
            } catch (e) {
              staticLogger.warn(`[processBase64] Failed to get image size from cache for "${nodeName}"`, e);
            }
          }
          _ImageCreator.updateNodeFills(node, imageFill2);
          staticLogger.info(`[processBase64] Cache HIT for "${nodeName}", hash: ${cachedFigmaHash.substring(0, 8)}...`);
          return true;
        }
        if (jsonImageHash) {
          _ImageCreator.cacheStats.misses++;
        }
        let base64Data = imageMetadata.base64;
        if (base64Data.startsWith("data:")) {
          const commaIndex = base64Data.indexOf(",");
          if (commaIndex !== -1) {
            base64Data = base64Data.substring(commaIndex + 1);
          }
        }
        staticLogger.info(`[processBase64] Decoding base64 for "${nodeName}", raw length: ${base64Data.length}`);
        const bytes = _ImageCreator.decodeBase64ToBytes(base64Data);
        staticLogger.info(`[processBase64] Decoded ${bytes.length} bytes for "${nodeName}"`);
        await _ImageCreator.acquireSlot();
        let figmaImage;
        try {
          figmaImage = figmaApi.createImage(bytes);
        } finally {
          _ImageCreator.releaseSlot();
        }
        const figmaImageHash = figmaImage.hash;
        staticLogger.info(`[processBase64] Created Figma image for "${nodeName}", hash: ${figmaImageHash.substring(0, 8)}...`);
        if (jsonImageHash) {
          _ImageCreator.imageHashCache.set(jsonImageHash, figmaImageHash);
        }
        const scaleMode = imageMetadata.scaleMode || "FILL";
        const imageFill = {
          type: "IMAGE",
          imageHash: figmaImageHash,
          scaleMode
        };
        if (scaleMode === "TILE") {
          imageFill.scalingFactor = 1;
        }
        if (imageMetadata.imageTransform) {
          imageFill.imageTransform = imageMetadata.imageTransform;
          staticLogger.info(`[processBase64] imageTransform for "${nodeName}": ${JSON.stringify(imageMetadata.imageTransform)}`);
        }
        if (scaleMode === "TILE" && imageMetadata.tileSize) {
          try {
            const naturalSize = await figmaImage.getSizeAsync();
            if (naturalSize.width > 0) {
              imageFill.scalingFactor = imageMetadata.tileSize.width / naturalSize.width;
              staticLogger.info(`[processBase64] TILE scalingFactor for "${nodeName}": ${imageFill.scalingFactor} (tile ${imageMetadata.tileSize.width}px / natural ${naturalSize.width}px)`);
            }
          } catch (sizeError) {
            staticLogger.warn(`[processBase64] Failed to get natural image size for "${nodeName}", using default scalingFactor=1`, sizeError);
          }
        }
        _ImageCreator.updateNodeFills(node, imageFill);
        staticLogger.info(`[processBase64] \u2705 Image fill applied for "${nodeName}", scaleMode=${scaleMode}`);
        return true;
      } catch (error) {
        staticLogger.error("[processBase64] \u274C Failed to process base64 image:", error);
        return false;
      }
    }
    /**
     * Decode base64 string to Uint8Array (static method for reuse)
     */
    static decodeBase64ToBytes(base64Data) {
      if (typeof globalThis.Buffer !== "undefined" && globalThis.Buffer.from) {
        const BufferConstructor = globalThis.Buffer;
        const buffer = BufferConstructor.from(base64Data, "base64");
        return new Uint8Array(buffer);
      } else if (typeof atob !== "undefined") {
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      } else {
        return _ImageCreator.decodeBase64Manually(base64Data);
      }
    }
    /**
     * Manual base64 decoding implementation for environments without Buffer or atob
     * Static method for reuse by other creators
     */
    static decodeBase64Manually(base64) {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const lookup = new Uint8Array(256);
      for (let i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i;
      }
      let bufferLength = base64.length * 0.75;
      const len = base64.length;
      let p = 0;
      if (base64[len - 1] === "=") {
        bufferLength--;
        if (base64[len - 2] === "=") {
          bufferLength--;
        }
      }
      const bytes = new Uint8Array(bufferLength);
      for (let i = 0; i < len; i += 4) {
        const encoded1 = lookup[base64.charCodeAt(i)];
        const encoded2 = lookup[base64.charCodeAt(i + 1)];
        const encoded3 = lookup[base64.charCodeAt(i + 2)];
        const encoded4 = lookup[base64.charCodeAt(i + 3)];
        bytes[p++] = encoded1 << 2 | encoded2 >> 4;
        if (p < bufferLength) {
          bytes[p++] = (encoded2 & 15) << 4 | encoded3 >> 2;
        }
        if (p < bufferLength) {
          bytes[p++] = (encoded3 & 3) << 6 | encoded4 & 63;
        }
      }
      return bytes;
    }
    /**
     * Set image-specific properties and handle image loading
     */
    async setImageProperties(rectangle, data) {
      await _ImageCreator.acquireSlot();
      try {
        await this.setImagePropertiesInner(rectangle, data);
      } finally {
        _ImageCreator.releaseSlot();
      }
    }
    async setImagePropertiesInner(rectangle, data) {
      const imageMetadata = data.imageMetadata;
      if (imageMetadata && imageMetadata.originalUrl) {
        try {
          const downloadedImageFill = await this.downloadImageFromMetadata(imageMetadata);
          if (data.fills && data.fills.length > 1) {
            const updatedFills = data.fills.map((fill) => {
              if (fill.type === "IMAGE") {
                return downloadedImageFill;
              }
              return fill;
            });
            try {
              rectangle.fills = updatedFills;
            } catch (fillError) {
              throw fillError;
            }
          } else {
            try {
              rectangle.fills = [downloadedImageFill];
            } catch (fillError) {
              throw fillError;
            }
          }
          return;
        } catch (error) {
        }
      }
      if (data.fills && Array.isArray(data.fills)) {
        const processedFills = [];
        for (const fill of data.fills) {
          if (fill.type === "IMAGE") {
            if (fill.imageHash && typeof fill.imageHash === "string" && fill.imageHash.length > 0) {
              const jsonImageHash = fill.imageHash;
              if (_ImageCreator.imageHashCache.has(jsonImageHash)) {
                const cachedFigmaHash = _ImageCreator.imageHashCache.get(jsonImageHash);
                _ImageCreator.cacheStats.hits++;
                processedFills.push({
                  ...fill,
                  imageHash: cachedFigmaHash
                });
              } else {
                processedFills.push(fill);
              }
            } else {
              const fillWithMetadata = { ...fill };
              if (imageMetadata?.originalUrl && !fill.imageHash && !fill.imageUrl) {
                fillWithMetadata._imageMetadata = imageMetadata;
              }
              const processedFill = await this.processImageFill(fillWithMetadata);
              processedFills.push(processedFill);
            }
          } else {
            processedFills.push(fill);
          }
        }
        rectangle.fills = processedFills;
      }
      const backgroundImageData = data.backgroundImageData;
      if (backgroundImageData) {
        await this.handleBackgroundImageData(rectangle, backgroundImageData);
      }
      if (imageMetadata && (!data.fills || data.fills.length === 0)) {
        await this.applyImageMetadata(rectangle, imageMetadata);
      }
    }
    /**
     * Parse URL manually since URL constructor is not available in Figma plugin
     */
    parseUrl(url) {
      const urlParts = url.match(/^(https?):\/\/([^\/]+)(\/.*)?$/);
      return {
        url,
        domain: urlParts ? urlParts[2] : "unknown",
        protocol: urlParts ? urlParts[1] + ":" : "unknown",
        pathname: urlParts ? urlParts[3] || "/" : "unknown"
      };
    }
    /**
     * Download image from metadata URL and create Figma image fill
     */
    async downloadImageFromMetadata(imageMetadata) {
      const fetchId = Math.random().toString(36).substr(2, 9);
      const startTime = Date.now();
      try {
        const urlInfo = this.parseUrl(imageMetadata.originalUrl);
        if (typeof fetch !== "function") {
          throw new Error(`FETCH-${fetchId}: fetch is not a function, type: ${typeof fetch}`);
        }
        let fetchPromise;
        try {
          fetchPromise = fetch(imageMetadata.originalUrl);
        } catch (fetchError) {
          throw fetchError;
        }
        const response = await Promise.race([
          fetchPromise,
          new Promise(
            (_, reject) => setTimeout(() => reject(new Error(`FETCH-${fetchId}: Timeout after 30 seconds`)), 3e4)
          )
        ]);
        const fetchResponse = response;
        if (!fetchResponse.ok) {
          throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
        }
        if (typeof fetchResponse.arrayBuffer !== "function") {
          throw new Error(`FETCH-${fetchId}: response.arrayBuffer is not a function, type: ${typeof fetchResponse.arrayBuffer}`);
        }
        let arrayBuffer;
        try {
          arrayBuffer = await fetchResponse.arrayBuffer();
        } catch (arrayBufferError) {
          throw arrayBufferError;
        }
        const uint8Array = new Uint8Array(arrayBuffer);
        if (!this.figmaApi || typeof this.figmaApi.createImage !== "function") {
          throw new Error(`FETCH-${fetchId}: figmaApi.createImage is not a function, figmaApi: ${this.figmaApi}, createImage type: ${typeof this.figmaApi?.createImage}`);
        }
        let figmaImage;
        try {
          figmaImage = await this.figmaApi.createImage(uint8Array);
        } catch (createImageError) {
          throw createImageError;
        }
        const processingTime = Date.now() - startTime;
        const imageFill = {
          type: "IMAGE",
          imageHash: figmaImage.hash,
          scaleMode: "FILL",
          visible: true,
          opacity: 1,
          blendMode: "NORMAL"
        };
        return imageFill;
      } catch (error) {
        const err = error;
        const processingTime = Date.now() - startTime;
        if (err.message.includes("CORS") || err.message.includes("cors") || err.message.includes("Cross-Origin") || err.name === "TypeError") {
        }
        try {
          const fallbackResponse = await fetch(imageMetadata.originalUrl);
          if (fallbackResponse.type === "opaque") {
            return this.createPlaceholderFill("CORS restricted: tanka.ai does not allow cross-origin access");
          }
        } catch (fallbackError) {
        }
        return this.createPlaceholderFill(`Failed to download from tanka.ai: CORS policy likely blocking access`);
      }
    }
    /**
     * Process image fill and load image data
     */
    async processImageFill(fill) {
      const startTime = Date.now();
      const jsonImageHash = fill.imageHash;
      const imageUrl = fill.imageUrl || this.extractUrlFromMetadata(fill._imageMetadata);
      if (imageUrl) {
        try {
          const buffer = await this.fetchImageFromUrl(imageUrl);
          const figmaImage = await this.figmaApi.createImage(buffer);
          const processingTime = Date.now() - startTime;
          if (jsonImageHash) {
            _ImageCreator.imageHashCache.set(jsonImageHash, figmaImage.hash);
          }
          return {
            ...fill,
            imageHash: figmaImage.hash,
            visible: true,
            type: "IMAGE"
          };
        } catch (error) {
          const processingTime = Date.now() - startTime;
          return this.createPlaceholderFill(`Failed to fetch: ${imageUrl}`);
        }
      }
      if (!jsonImageHash) {
        return fill;
      }
      if (_ImageCreator.imageHashCache.has(jsonImageHash)) {
        const cachedFigmaHash = _ImageCreator.imageHashCache.get(jsonImageHash);
        _ImageCreator.cacheStats.hits++;
        return {
          ...fill,
          imageHash: cachedFigmaHash,
          visible: true,
          type: "IMAGE"
        };
      }
      try {
        const imageData = this.getImageData(jsonImageHash);
        if (imageData?.failed) {
          return this.createPlaceholderFill("Image failed to load");
        }
        if (imageData?.corsRestricted) {
          return this.createPlaceholderFill("CORS restricted image");
        }
        if (imageData?.buffer) {
          const figmaImage = await this.figmaApi.createImage(imageData.buffer);
          const processingTime = Date.now() - startTime;
          _ImageCreator.imageHashCache.set(jsonImageHash, figmaImage.hash);
          return {
            ...fill,
            imageHash: figmaImage.hash,
            visible: true
          };
        } else if (imageData?.base64) {
          const buffer = this.base64ToBuffer(imageData.base64);
          const figmaImage = await this.figmaApi.createImage(buffer);
          const processingTime = Date.now() - startTime;
          _ImageCreator.imageHashCache.set(jsonImageHash, figmaImage.hash);
          return {
            ...fill,
            imageHash: figmaImage.hash,
            visible: true
          };
        } else {
          return this.createPlaceholderFill("No image data");
        }
      } catch (error) {
        const processingTime = Date.now() - startTime;
        return this.createPlaceholderFill("Processing failed");
      }
    }
    /**
     * Create placeholder fill for failed images
     */
    createPlaceholderFill(reason) {
      const placeholderFill = {
        type: "SOLID",
        color: { r: 0.9, g: 0.9, b: 0.9 },
        opacity: 1,
        visible: true,
        blendMode: "NORMAL"
      };
      return placeholderFill;
    }
    /**
     * Handle background image data (Frame + Image combination)
     */
    async handleBackgroundImageData(rectangle, backgroundImageData) {
      rectangle._backgroundImageData = backgroundImageData;
    }
    /**
     * Apply image metadata to the node and handle URL fetching if needed
     */
    async applyImageMetadata(rectangle, metadata) {
      rectangle._imageMetadata = metadata;
      const fills = rectangle.fills;
      if (metadata.originalUrl && !fills?.some((fill) => fill.type === "IMAGE" && fill.imageHash)) {
        try {
          const imageFill = await this.downloadImageFromMetadata(metadata);
          try {
            _ImageCreator.updateNodeFills(rectangle, imageFill);
          } catch (fillError) {
            throw fillError;
          }
        } catch (error) {
          if (!fills || fills.length === 0) {
            _ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill(`Failed to fetch: ${metadata.originalUrl}`));
          }
        }
      } else if (!metadata.originalUrl) {
        const imageUrl = this.extractUrlFromMetadata(metadata);
        if (imageUrl && !fills?.some((fill) => fill.type === "IMAGE" && fill.imageHash)) {
          try {
            const buffer = await this.fetchImageFromUrl(imageUrl);
            const figmaImage = await this.figmaApi.createImage(buffer);
            const imageFill = {
              type: "IMAGE",
              imageHash: figmaImage.hash,
              scaleMode: "FILL",
              visible: true
            };
            _ImageCreator.updateNodeFills(rectangle, imageFill);
          } catch (error) {
            if (!fills || fills.length === 0) {
              _ImageCreator.updateNodeFills(rectangle, this.createPlaceholderFill(`Failed to fetch: ${imageUrl}`));
            }
          }
        }
      }
      if (metadata.width && metadata.height && this.shouldPreserveImageDimensions()) {
        if (rectangle.width === 100 && rectangle.height === 100) {
          const maxSize = 500;
          const scale = Math.min(maxSize / metadata.width, maxSize / metadata.height, 1);
          rectangle.resize(metadata.width * scale, metadata.height * scale);
        }
      }
    }
    /**
     * Get image data from global context or cache
     */
    getImageData(imageHash) {
      const globalContext = globalThis.__imageDataContext;
      return globalContext?.imageData?.get(imageHash);
    }
    /**
     * Fetch image from URL and convert to buffer
     */
    async fetchImageFromUrl(url) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.startsWith("image/")) {
          throw new Error(`Invalid content type: ${contentType}`);
        }
        const fetchResponse = response;
        const arrayBuffer = await fetchResponse.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);
        return buffer;
      } catch (error) {
        if (error instanceof TypeError && error.message.includes("CORS")) {
          throw new Error(`CORS error when fetching image: ${url}`);
        }
        if (error instanceof TypeError && error.message.includes("network")) {
          throw new Error(`Network error when fetching image: ${url}`);
        }
        throw error;
      }
    }
    /**
     * Convert base64 to Uint8Array buffer
     */
    base64ToBuffer(base64) {
      const base64Data = base64.replace(/^data:image\/[^;]+;base64,/, "");
      const binaryString = atob(base64Data);
      const buffer = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        buffer[i] = binaryString.charCodeAt(i);
      }
      return buffer;
    }
    /**
     * Check if we should preserve original image dimensions
     */
    shouldPreserveImageDimensions() {
      return false;
    }
    /**
     * Extract URL from various metadata formats
     */
    extractUrlFromMetadata(metadata) {
      if (!metadata) return null;
      if (metadata.originalUrl) return metadata.originalUrl;
      if (metadata.url) return metadata.url;
      if (metadata.src) return metadata.src;
      if (metadata.href) return metadata.href;
      return null;
    }
    /**
     * Clear the image hash cache
     * 清空图片哈希缓存
     */
    static clearImageCache() {
      _ImageCreator.imageHashCache.clear();
      _ImageCreator.cacheStats = { hits: 0, misses: 0 };
    }
    /**
     * Get cache statistics
     * 获取缓存统计信息
     */
    static getCacheStats() {
      const { hits, misses } = _ImageCreator.cacheStats;
      const total = hits + misses;
      const hitRate = total > 0 ? hits / total * 100 : 0;
      return {
        size: _ImageCreator.imageHashCache.size,
        hits,
        misses,
        hitRate: Math.round(hitRate * 100) / 100
        // 保留两位小数
      };
    }
    /**
     * Log cache statistics
     * 输出缓存统计信息
     */
    static logCacheStats() {
      const stats = _ImageCreator.getCacheStats();
    }
    /**
     * Validate image-specific data
     */
    validateData(data) {
      super.validateData(data);
      if (data.type !== "RECTANGLE") {
        throw new Error(`Expected RECTANGLE type for image, got ${data.type}`);
      }
      if (data.fills) {
        for (const fill of data.fills) {
          if (fill.type === "IMAGE" && !fill.imageHash) {
          }
        }
      }
      return true;
    }
  };
  // Static cache: JSON imageHash -> Figma imageHash
  // 缓存从 JSON 中的 imageHash 到 Figma 实际生成的 hash 的映射
  __publicField(_ImageCreator, "imageHashCache", /* @__PURE__ */ new Map());
  __publicField(_ImageCreator, "cacheStats", { hits: 0, misses: 0 });
  // ── Image processing concurrency limiter ──
  // Prevents Figma from freezing when many images are processed at once.
  __publicField(_ImageCreator, "CONCURRENCY_LIMIT", 3);
  __publicField(_ImageCreator, "activeTasks", 0);
  __publicField(_ImageCreator, "waitQueue", []);
  var ImageCreator = _ImageCreator;

  // third-party/html2figma-plugin/upstream/packages/figma/creators/FrameCreator.ts
  var _FrameCreator = class _FrameCreator extends BaseNodeCreator {
    constructor() {
      super(...arguments);
      __publicField(this, "logger", createLogger("FrameCreator" /* FRAME_CREATOR */));
    }
    static awaitPendingImages() {
      const promises = _FrameCreator.pendingImagePromises;
      _FrameCreator.pendingImagePromises = [];
      return Promise.all(promises);
    }
    /**
     * Create a Frame node from JSON data
     */
    create(data) {
      const frameName = data.name || "Frame";
      this.logger.info(`Creating Frame node: "${frameName}"`);
      try {
        this.validateData(data);
        const frame = this.figmaApi.createFrame();
        return frame;
      } catch (error) {
        this.logger.error(`Frame node creation failed: "${frameName}"`, error);
        this.handleError(error, "Frame", data);
      }
    }
    setProperties(frame, data) {
      try {
        this.setBaseProperties(frame, data);
        this.setFrameProperties(frame, data);
        this.setFrameStyling(frame, data);
        this.processImageBackgrounds(frame, data);
        this.setLayoutProperties(frame, data);
        this.setSizeProperties(frame, data);
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
    setFrameProperties(frame, data) {
      if (data.clipsContent !== void 0) {
        frame.clipsContent = data.clipsContent;
      }
    }
    /**
     * Set frame styling properties
     */
    setFrameStyling(frame, data) {
      const safeFills = (data.fills || []).filter(
        (fill) => fill.type !== "IMAGE" || fill.imageHash && typeof fill.imageHash === "string" && fill.imageHash.length > 0
      ).map((fill) => {
        const clean = {};
        for (const key of Object.keys(fill)) {
          if (!key.startsWith("_")) {
            clean[key] = fill[key];
          }
        }
        return clean;
      });
      this.setFills(frame, safeFills);
      this.setStrokes(frame, data.strokes || [], data.strokeWeight, data.strokeAlign, data.strokeTopWeight, data.strokeRightWeight, data.strokeBottomWeight, data.strokeLeftWeight, data.strokeDashPattern);
      this.setCornerRadiusProperties(frame, data);
      if (data.effects) {
        this.setEffects(frame, data.effects);
      }
    }
    /**
     * Set corner radius properties (supports uniform, per-corner, and array formats)
     */
    setCornerRadiusProperties(frame, data) {
      const frameAny = frame;
      if (data.cornerRadii && Array.isArray(data.cornerRadii)) {
        const radii = data.cornerRadii;
        if (radii.length === 4) {
          frameAny.topLeftRadius = radii[0];
          frameAny.topRightRadius = radii[1];
          frameAny.bottomRightRadius = radii[2];
          frameAny.bottomLeftRadius = radii[3];
          this.logger.info(`  - Corner radius (array): [${radii.join(", ")}]`);
          return;
        }
      }
      if (data.cornerRadius !== void 0) {
        frameAny.cornerRadius = data.cornerRadius;
        this.logger.info(`  - Corner radius (uniform): ${data.cornerRadius}`);
        return;
      }
      let hasIndividualRadius = false;
      if (data.topLeftRadius !== void 0) {
        frameAny.topLeftRadius = data.topLeftRadius;
        hasIndividualRadius = true;
      }
      if (data.topRightRadius !== void 0) {
        frameAny.topRightRadius = data.topRightRadius;
        hasIndividualRadius = true;
      }
      if (data.bottomLeftRadius !== void 0) {
        frameAny.bottomLeftRadius = data.bottomLeftRadius;
        hasIndividualRadius = true;
      }
      if (data.bottomRightRadius !== void 0) {
        frameAny.bottomRightRadius = data.bottomRightRadius;
        hasIndividualRadius = true;
      }
      if (hasIndividualRadius) {
        this.logger.info(`  - Corner radius (individual): TL=${frameAny.topLeftRadius}, TR=${frameAny.topRightRadius}, BR=${frameAny.bottomRightRadius}, BL=${frameAny.bottomLeftRadius}`);
      }
      if (data.cornerSmoothing !== void 0) {
        frameAny.cornerSmoothing = data.cornerSmoothing;
      }
    }
    /**
     * Set layout properties for auto-layout.
     * Order matters: set axis properties first, then sizing and other properties.
     */
    setLayoutProperties(frame, data) {
      this.logger.info(`Setting layout properties`);
      if (data.layoutMode && data.layoutMode !== "NONE") {
        frame.layoutMode = data.layoutMode;
        this.logger.info(`Enabling auto-layout: ${data.layoutMode}`);
        if (data.primaryAxisAlignItems) {
          frame.primaryAxisAlignItems = data.primaryAxisAlignItems;
          this.logger.info(`  - Primary axis align: ${data.primaryAxisAlignItems}`);
        }
        if (data.counterAxisAlignItems) {
          frame.counterAxisAlignItems = data.counterAxisAlignItems;
          this.logger.info(`  - Counter axis align: ${data.counterAxisAlignItems}`);
        }
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
        this.setLayoutSizing(frame, data);
        const paddingInfo = [];
        if (data.paddingLeft !== void 0) {
          frame.paddingLeft = data.paddingLeft;
          paddingInfo.push(`L: ${data.paddingLeft}`);
        }
        if (data.paddingRight !== void 0) {
          frame.paddingRight = data.paddingRight;
          paddingInfo.push(`R: ${data.paddingRight}`);
        }
        if (data.paddingTop !== void 0) {
          frame.paddingTop = data.paddingTop;
          paddingInfo.push(`T: ${data.paddingTop}`);
        }
        if (data.paddingBottom !== void 0) {
          frame.paddingBottom = data.paddingBottom;
          paddingInfo.push(`B: ${data.paddingBottom}`);
        }
        if (paddingInfo.length > 0) {
          this.logger.info(`  - Padding: ${paddingInfo.join(", ")}`);
        }
        if (data.itemSpacing !== void 0) {
          frame.itemSpacing = data.itemSpacing;
          this.logger.info(`  - Item spacing: ${data.itemSpacing}`);
        }
        if (data.layoutWrap) {
          frame.layoutWrap = data.layoutWrap;
          this.logger.info(`  - Layout wrap: ${data.layoutWrap}`);
        }
        if (data.counterAxisSpacing !== void 0) {
          frame.counterAxisSpacing = data.counterAxisSpacing;
          this.logger.info(`  - Counter axis spacing: ${data.counterAxisSpacing}`);
        }
        this.logger.info(`Auto-layout setup complete`);
      } else {
        this.logger.info(`Using manual layout (NONE)`);
      }
    }
    // isParentAutoLayout has been moved to BaseNodeCreator — no duplicate needed
    /**
     * Set Auto Layout sizing properties.
     */
    setLayoutSizing(frame, data) {
      const sizingInfo = [];
      if (data.layoutSizingHorizontal) {
        frame.layoutSizingHorizontal = data.layoutSizingHorizontal;
        sizingInfo.push(`H: ${data.layoutSizingHorizontal}`);
        this.logger.info(`Setting horizontal sizing: ${data.layoutSizingHorizontal}`);
      }
      if (data.layoutSizingVertical) {
        frame.layoutSizingVertical = data.layoutSizingVertical;
        sizingInfo.push(`V: ${data.layoutSizingVertical}`);
        this.logger.info(`Setting vertical sizing: ${data.layoutSizingVertical}`);
      }
      if (sizingInfo.length > 0) {
        this.logger.info(`\u2705 Layout Sizing \u8BBE\u7F6E\u5B8C\u6210: ${frame.name} - ${sizingInfo.join(", ")}`);
      }
    }
    /**
     * Process all IMAGE fills in data.fills, getting unique imageHashes for each.
     * Falls back to frame-level imageMetadata for backward compatibility.
     */
    processImageBackgrounds(frame, data) {
      const imageFillEntries = [];
      if (data.fills) {
        data.fills.forEach((fill, index) => {
          if (fill.type === "IMAGE" && fill._imageMetadata) {
            const meta = fill._imageMetadata;
            imageFillEntries.push({
              meta,
              fillIndex: index,
              scaleMode: meta.scaleMode || fill.scaleMode || "FILL"
            });
          }
        });
      }
      if (imageFillEntries.length === 0) {
        const imageMetadata = data.imageMetadata;
        if (imageMetadata && (imageMetadata.base64 || imageMetadata.originalUrl)) {
          const firstImageIdx = (data.fills || []).findIndex((f) => f.type === "IMAGE");
          if (firstImageIdx >= 0) {
            const fill = data.fills[firstImageIdx];
            imageFillEntries.push({
              meta: imageMetadata,
              fillIndex: firstImageIdx,
              scaleMode: imageMetadata.scaleMode || fill.scaleMode || "FILL"
            });
          }
        }
      }
      if (imageFillEntries.length === 0) return;
      this.logger.info(`Processing ${imageFillEntries.length} IMAGE fill(s)`);
      const processedFills = /* @__PURE__ */ new Map();
      const promises = [];
      for (const entry of imageFillEntries) {
        const { meta, fillIndex, scaleMode } = entry;
        const processOne = async () => {
          try {
            let figmaImage;
            let svgContent = meta.svgContent ?? null;
            if (!svgContent && meta.base64?.startsWith("data:image/svg")) {
              const ci = meta.base64.indexOf(",");
              if (ci !== -1) {
                const payload = meta.base64.substring(ci + 1);
                const isB64 = meta.base64.substring(0, ci).includes("base64");
                try {
                  const decoded = isB64 ? atob(payload) : decodeURIComponent(payload);
                  if (decoded.trimStart().startsWith("<svg")) svgContent = decoded;
                } catch {
                }
              }
            }
            if (meta.isSvg && svgContent) {
              this.logger.info(`\u{1F5BC}\uFE0F SVG fill \u2192 createNodeFromSvg (${svgContent.length} chars) for fill[${fillIndex}]`);
              const svgNode = this.figmaApi.createNodeFromSvg(svgContent);
              const pngBytes = await svgNode.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
              figmaImage = this.figmaApi.createImage(pngBytes);
              svgNode.remove();
              this.logger.info(`\u{1F5BC}\uFE0F SVG fill converted to PNG image hash: ${figmaImage.hash.substring(0, 8)}...`);
            } else if (meta.isSvg && !svgContent) {
              this.logger.warn(`\u26A0\uFE0F SVG fill has isSvg=true but no svgContent for fill[${fillIndex}], url: ${meta.originalUrl?.substring(0, 60)}`);
            } else if (meta.base64) {
              let base64Data = meta.base64;
              if (base64Data.startsWith("data:")) {
                const commaIndex = base64Data.indexOf(",");
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
            const fill = {
              type: "IMAGE",
              imageHash: figmaImage.hash,
              scaleMode,
              visible: true
            };
            if (scaleMode === "TILE") {
              fill.scalingFactor = 1;
            }
            if (meta.imageTransform) {
              fill.imageTransform = meta.imageTransform;
            }
            if (scaleMode === "TILE" && meta.tileSize) {
              try {
                const naturalSize = await figmaImage.getSizeAsync();
                if (naturalSize.width > 0) {
                  fill.scalingFactor = meta.tileSize.width / naturalSize.width;
                }
              } catch (e) {
              }
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
          const rebuiltFills = data.fills.map((fill, index) => {
            if (processedFills.has(index)) {
              return processedFills.get(index);
            }
            const clean = {};
            for (const key of Object.keys(fill)) {
              if (!key.startsWith("_")) {
                clean[key] = fill[key];
              }
            }
            return clean;
          });
          frame.fills = rebuiltFills;
          this.logger.info(`Rebuilt ${rebuiltFills.length} fills with ${processedFills.size} processed IMAGE(s)`);
        }
      }).catch((error) => {
        this.logger.error("Failed to process image backgrounds:", error);
      });
      _FrameCreator.pendingImagePromises.push(imagePromise);
    }
    /**
     * Process SVG background image (create temp SVG node → export PNG → apply as fill)
     */
    async processSvgBackground(frame, imageMetadata) {
      try {
        const svgNode = this.figmaApi.createNodeFromSvg(imageMetadata.svgContent);
        const pngBytes = await svgNode.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
        const figmaImage = this.figmaApi.createImage(pngBytes);
        svgNode.remove();
        const scaleMode = imageMetadata.scaleMode || "FILL";
        const fill = {
          type: "IMAGE",
          imageHash: figmaImage.hash,
          scaleMode
        };
        if (scaleMode === "TILE") {
          fill.scalingFactor = 1;
        }
        if (scaleMode === "TILE" && imageMetadata.tileSize) {
          try {
            const naturalSize = await figmaImage.getSizeAsync();
            if (naturalSize.width > 0) {
              fill.scalingFactor = imageMetadata.tileSize.width / naturalSize.width;
            }
          } catch (e) {
          }
        }
        ImageCreator.updateNodeFills(frame, fill);
      } catch (error) {
        this.logger.error("Failed to process SVG background:", error);
      }
    }
    /**
     * Process URL-based background image (fetch → create image → apply as fill)
     */
    async processUrlBackground(frame, imageMetadata) {
      try {
        const response = await fetch(imageMetadata.originalUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = new Uint8Array(await response.arrayBuffer());
        const figmaImage = this.figmaApi.createImage(buffer);
        const scaleMode = imageMetadata.scaleMode || "FILL";
        const fill = {
          type: "IMAGE",
          imageHash: figmaImage.hash,
          scaleMode
        };
        if (scaleMode === "TILE") {
          fill.scalingFactor = 1;
        }
        if (scaleMode === "TILE" && imageMetadata.tileSize) {
          try {
            const naturalSize = await figmaImage.getSizeAsync();
            if (naturalSize.width > 0) {
              fill.scalingFactor = imageMetadata.tileSize.width / naturalSize.width;
            }
          } catch (e) {
          }
        }
        ImageCreator.updateNodeFills(frame, fill);
      } catch (error) {
        this.logger.error("Failed to fetch background image URL:", error);
      }
    }
    /**
     * Add children to the frame
     */
    addChildren(frame, children) {
    }
    /**
     * Validate frame-specific data
     */
    validateData(data) {
      super.validateData(data);
      if (data.type !== "FRAME") {
        throw new Error(`Expected FRAME type, got ${data.type}`);
      }
      if (data.layoutMode && data.layoutMode !== "NONE") {
        if (!["HORIZONTAL", "VERTICAL"].includes(data.layoutMode)) {
          throw new Error(`Invalid layout mode: ${data.layoutMode}`);
        }
      }
      return true;
    }
  };
  // Collect async image promises so callers can await them after tree creation
  __publicField(_FrameCreator, "pendingImagePromises", []);
  var FrameCreator = _FrameCreator;

  // third-party/html2figma-plugin/upstream/packages/figma/creators/RectangleCreator.ts
  var RectangleCreator = class extends BaseNodeCreator {
    /**
     * Create a Rectangle node from JSON data (only creates the node)
     */
    create(data) {
      try {
        this.validateData(data);
        const rectangle = this.figmaApi.createRectangle();
        return rectangle;
      } catch (error) {
        this.handleError(error, "Rectangle", data);
      }
    }
    /**
     * Set all properties for the rectangle after creation
     */
    setProperties(rectangle, data) {
      try {
        this.setBaseProperties(rectangle, data);
        this.setRectangleProperties(rectangle, data);
        this.setSizeProperties(rectangle, data);
        this.logCreation("Rectangle", data.name);
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
    setRectangleProperties(rectangle, data) {
      this.setFills(rectangle, data.fills || []);
      this.setStrokes(rectangle, data.strokes || [], data.strokeWeight, data.strokeAlign, void 0, void 0, void 0, void 0, data.strokeDashPattern);
      this.setStrokeProperties(rectangle, data);
      this.setCornerRadiusProperties(rectangle, data);
      if (data.effects) {
        this.setEffects(rectangle, data.effects);
      }
    }
    /**
     * Set stroke-specific properties
     */
    setStrokeProperties(rectangle, data) {
      const rect = rectangle;
      if (data.strokeMiterLimit !== void 0) {
        rect.strokeMiterLimit = data.strokeMiterLimit;
      }
      if (data.strokeCap) {
        rect.strokeCap = data.strokeCap;
      }
      if (data.strokeJoin) {
        rect.strokeJoin = data.strokeJoin;
      }
      if (data.dashPattern && data.dashPattern.length > 0) {
        rect.dashPattern = data.dashPattern;
      }
    }
    /**
     * Set corner radius properties (支持统一圆角、独立圆角和数组格式)
     */
    setCornerRadiusProperties(rectangle, data) {
      const rect = rectangle;
      if (data.cornerRadii && Array.isArray(data.cornerRadii)) {
        const radii = data.cornerRadii;
        if (radii.length === 4) {
          rect.topLeftRadius = radii[0];
          rect.topRightRadius = radii[1];
          rect.bottomRightRadius = radii[2];
          rect.bottomLeftRadius = radii[3];
          return;
        }
      }
      if (data.cornerRadius !== void 0) {
        rectangle.cornerRadius = data.cornerRadius;
        return;
      }
      if (data.topLeftRadius !== void 0) {
        rect.topLeftRadius = data.topLeftRadius;
      }
      if (data.topRightRadius !== void 0) {
        rect.topRightRadius = data.topRightRadius;
      }
      if (data.bottomLeftRadius !== void 0) {
        rect.bottomLeftRadius = data.bottomLeftRadius;
      }
      if (data.bottomRightRadius !== void 0) {
        rect.bottomRightRadius = data.bottomRightRadius;
      }
      if (data.cornerSmoothing !== void 0) {
        rect.cornerSmoothing = data.cornerSmoothing;
      }
    }
    /**
     * Create a rectangle with gradient fill
     */
    createWithGradient(data, gradientStops, gradientType = "LINEAR") {
      const rectangle = this.create(data);
      const gradientFill = {
        type: `GRADIENT_${gradientType}`,
        gradientStops,
        gradientTransform: this.calculateGradientTransform(data, gradientType)
      };
      rectangle.fills = [gradientFill];
      return rectangle;
    }
    /**
     * Create a rectangle with image fill
     */
    createWithImage(data, imageHash, scaleMode = "FILL") {
      const rectangle = this.create(data);
      const imageFill = {
        type: "IMAGE",
        imageHash,
        scaleMode
      };
      rectangle.fills = [imageFill];
      return rectangle;
    }
    /**
     * Calculate gradient transform matrix
     */
    calculateGradientTransform(data, gradientType) {
      const width = data.width || 100;
      const height = data.height || 100;
      switch (gradientType) {
        case "LINEAR":
          return [
            [1, 0, 0],
            [0, 0, 1]
          ];
        case "RADIAL":
          return [
            [width / 200, 0, 0.5],
            [0, height / 200, 0.5]
          ];
        case "ANGULAR":
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
    validateData(data) {
      super.validateData(data);
      if (data.type !== "RECTANGLE") {
        throw new Error(`Expected RECTANGLE type, got ${data.type}`);
      }
      if (data.cornerRadius !== void 0 && data.cornerRadius < 0) {
        throw new Error("Corner radius cannot be negative");
      }
      if (data.strokeWeight !== void 0 && data.strokeWeight < 0) {
        throw new Error("Stroke weight cannot be negative");
      }
      return true;
    }
  };

  // third-party/html2figma-plugin/upstream/packages/figma/creators/TextCreator.ts
  var TextCreator = class extends BaseNodeCreator {
    constructor(figmaApi) {
      super(figmaApi);
    }
    /**
     * Create a Text node from JSON data (only creates the node)
     */
    create(data) {
      try {
        this.logTextNodeParameters(data);
        this.validateData(data);
        const text = this.figmaApi.createText();
        this.setDefaultFont(text);
        this.setTextContentSafely(text, data);
        return text;
      } catch (error) {
        this.handleError(error, "Text", data);
      }
    }
    /**
     * Set all properties for the text after creation
     */
    setProperties(text, data) {
      try {
        this.setBaseProperties(text, data);
        this.setSizeProperties(text, data);
        this.setLayoutSizing(text, data);
        this.setTextProperties(text, data);
        this.setTextStyling(text, data);
        if (data.styledTextSegments && data.styledTextSegments.length > 0) {
          this.applyStyledSegments(text, data.styledTextSegments);
        }
        this.logCreation("Text", data.name);
      } catch (error) {
        throw error;
      }
    }
    /**
      * 设置Auto Layout尺寸属性
      */
    setLayoutSizing(frame, data) {
      const sizingInfo = [];
      if (data.layoutSizingHorizontal) {
        frame.layoutSizingHorizontal = data.layoutSizingHorizontal;
        sizingInfo.push(`\u6C34\u5E73: ${data.layoutSizingHorizontal}`);
        this.logger.info(`\u{1F4CF} \u8BBE\u7F6E\u6C34\u5E73\u5C3A\u5BF8\u6A21\u5F0F: ${data.layoutSizingHorizontal}`);
      }
      if (data.layoutSizingVertical) {
        frame.layoutSizingVertical = data.layoutSizingVertical;
        sizingInfo.push(`\u5782\u76F4: ${data.layoutSizingVertical}`);
        this.logger.info(`\u{1F4CF} \u8BBE\u7F6E\u5782\u76F4\u5C3A\u5BF8\u6A21\u5F0F: ${data.layoutSizingVertical}`);
      }
      if (sizingInfo.length > 0) {
        this.logger.info(`\u2705 Layout Sizing \u8BBE\u7F6E\u5B8C\u6210: ${frame.name} - ${sizingInfo.join(", ")}`);
      }
    }
    /**
     * Log all text node parameters before creation
     */
    logTextNodeParameters(data) {
    }
    /**
     * Set default font and font size to avoid font loading issues
     * Uses the pre-loaded Inter font from plugin initialization
     */
    setDefaultFont(text) {
      try {
        const defaultFont = validateFontName("Inter", "Regular");
        text.fontName = defaultFont;
        text.fontSize = 16;
      } catch (error) {
        const fallbackFonts = [
          validateFontName("Arial", "Regular"),
          validateFontName("Helvetica", "Regular"),
          validateFontName("Times New Roman", "Regular")
        ];
        for (const font of fallbackFonts) {
          try {
            text.fontName = font;
            text.fontSize = 16;
            return;
          } catch (fallbackError) {
          }
        }
      }
    }
    /**
     * Set text content safely
     */
    setTextContentSafely(text, data) {
      const content = data.characters || "\xA0";
      const sanitizedContent = this.sanitizeText(content);
      if (!sanitizedContent || sanitizedContent.trim() === "") {
        text.characters = "\xA0";
        return;
      }
      try {
        text.characters = sanitizedContent;
      } catch (error) {
        try {
          text.characters = "\xA0";
        } catch (fallbackError) {
        }
      }
    }
    /**
     * Sanitize text content
     */
    sanitizeText(text) {
      if (!text || typeof text !== "string") {
        return "\xA0";
      }
      const cleaned = text.replace(/\0/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      let result = cleaned.replace(/[ \t]+/g, " ");
      if (!result || result.replace(/[\s\u00A0]+/g, "") === "") {
        return "\xA0";
      }
      const maxLength = 1e4;
      if (result.length > maxLength) {
        result = result.substring(0, maxLength) + "...";
      }
      return result;
    }
    /**
     * Set text-specific properties
     */
    setTextProperties(text, data) {
      try {
        if (data.fontName) {
          const validatedFont = validateFontName(
            data.fontName.family || "Inter",
            data.fontName.style || "Regular"
          );
          const fontKey = `${validatedFont.family}:${validatedFont.style}`;
          try {
            text.fontName = validatedFont;
          } catch (fontError) {
            this.logger.error("\u274C [TextCreator] Failed to set font:", validatedFont, fontError);
            try {
              const interFont = validateFontName("Inter", "Regular");
              text.fontName = interFont;
            } catch (interError) {
              this.logger.error("\u274C [TextCreator] Even Inter font failed:", interError);
            }
          }
        }
        if (data.fontSize !== void 0) {
          const finalFontSize = Math.max(data.fontSize, 8);
          text.fontSize = finalFontSize;
        }
        if (data.fontWeight !== void 0) {
          try {
            text.fontWeight = data.fontWeight;
          } catch (fontWeightError) {
            this.logger.error("\u274C [TextCreator] Failed to set font weight:", data.fontWeight, fontWeightError);
          }
        }
        if (data.textAlignHorizontal) {
          text.textAlignHorizontal = data.textAlignHorizontal;
        }
        if (data.textAlignVertical) {
          text.textAlignVertical = data.textAlignVertical;
        }
        if (data.textAutoResize) {
          text.textAutoResize = data.textAutoResize;
        } else {
          text.textAutoResize = "WIDTH_AND_HEIGHT";
        }
        if (data.listOptions && data.listOptions.type !== "NONE") {
          try {
            const len = text.characters.length;
            if (len > 0) {
              text.setRangeListOptions(0, len, data.listOptions);
            }
          } catch (e) {
            this.logger.info("listOptions not supported:", e);
          }
        }
        if (data.textTruncation) {
          this.logger.info("data.textTruncation", data.textTruncation);
          text.textTruncation = data.textTruncation;
          if (data.textTruncation === "ENDING") {
            text.maxLines = data.maxLines || 1;
          }
        }
        if (data.lineHeight) {
          text.lineHeight = data.lineHeight;
        }
        if (data.letterSpacing) {
          text.letterSpacing = data.letterSpacing;
        }
        if (data.textDecoration) {
          text.textDecoration = data.textDecoration;
        }
      } catch (error) {
      }
    }
    /**
     * Set text styling properties
     */
    setTextStyling(text, data) {
      try {
        if (data.fills && data.fills.length > 0) {
          const safeFills = data.fills.filter(
            (fill) => fill.type !== "IMAGE" || fill.imageHash && typeof fill.imageHash === "string" && fill.imageHash.length > 0
          );
          if (safeFills.length > 0) {
            this.setFills(text, safeFills);
          } else {
            text.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0 }];
          }
          const imageMetadata = data.imageMetadata;
          if (imageMetadata && (imageMetadata.base64 || imageMetadata.originalUrl)) {
            const jsonImageHash = data.fills.find((fill) => fill.type === "IMAGE")?.imageHash;
            if (imageMetadata.base64) {
              ImageCreator.processAndApplyBase64Image(
                text,
                imageMetadata,
                jsonImageHash,
                this.figmaApi
              ).catch((error) => {
                this.logger.error("Failed to process text image fill:", error);
              });
            } else if (imageMetadata.originalUrl) {
              this.processTextImageUrl(text, imageMetadata).catch((error) => {
                this.logger.error("Failed to fetch text image fill:", error);
              });
            }
          }
        } else {
          text.fills = [{
            type: "SOLID",
            color: { r: 0, g: 0, b: 0 }
          }];
        }
      } catch (error) {
        try {
          text.fills = [{
            type: "SOLID",
            color: { r: 0, g: 0, b: 0 }
          }];
        } catch (fallbackError) {
        }
      }
    }
    /**
     * Process URL-based image fill for text (background-clip: text)
     */
    async processTextImageUrl(text, imageMetadata) {
      try {
        const response = await fetch(imageMetadata.originalUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = new Uint8Array(await response.arrayBuffer());
        const figmaImage = this.figmaApi.createImage(buffer);
        const scaleMode = imageMetadata.scaleMode || "FILL";
        const fill = {
          type: "IMAGE",
          imageHash: figmaImage.hash,
          scaleMode
        };
        ImageCreator.updateNodeFills(text, fill);
      } catch (error) {
        this.logger.error("Failed to fetch text image URL:", error);
      }
    }
    /**
     * Apply per-range styled segments to a text node (rich text support).
     * Uses Figma's setRangeFontName, setRangeFills, etc. to style individual character ranges.
     */
    applyStyledSegments(text, segments) {
      const textLength = text.characters.length;
      this.logger.info(`[applyStyledSegments] textLength=${textLength} segments=${segments.length} text="${text.characters.substring(0, 40)}"`);
      for (const seg of segments) {
        if (seg.start < 0 || seg.end > textLength || seg.start >= seg.end) {
          this.logger.warn(`[applyStyledSegments] SKIP out-of-bounds segment [${seg.start}-${seg.end}] textLength=${textLength}`);
          continue;
        }
        const rangeText = text.characters.substring(seg.start, seg.end);
        this.logger.info(`[applyStyledSegments] segment [${seg.start}-${seg.end}] "${rangeText}" fontName=${seg.fontName ? seg.fontName.family + ":" + seg.fontName.style : "inherit"} fills=${seg.fills ? "yes" : "no"}`);
        try {
          if (seg.fontName) {
            try {
              const validatedFont = validateFontName(
                seg.fontName.family || "Inter",
                seg.fontName.style || "Regular"
              );
              text.setRangeFontName(seg.start, seg.end, validatedFont);
            } catch (fontError) {
              this.logger.error("Failed to set range font:", seg.fontName, fontError);
            }
          }
          if (seg.fontSize !== void 0) {
            try {
              text.setRangeFontSize(seg.start, seg.end, Math.max(seg.fontSize, 8));
            } catch (e) {
            }
          }
          if (seg.fills && seg.fills.length > 0) {
            try {
              text.setRangeFills(seg.start, seg.end, seg.fills);
            } catch (e) {
              this.logger.error("Failed to set range fills:", e);
            }
          }
          if (seg.textDecoration) {
            try {
              text.setRangeTextDecoration(seg.start, seg.end, seg.textDecoration);
            } catch (e) {
            }
          }
          if (seg.lineHeight) {
            try {
              text.setRangeLineHeight(seg.start, seg.end, seg.lineHeight);
            } catch (e) {
            }
          }
          if (seg.letterSpacing) {
            try {
              text.setRangeLetterSpacing(seg.start, seg.end, seg.letterSpacing);
            } catch (e) {
            }
          }
          if (seg.hyperlink) {
            try {
              text.setRangeHyperlink(seg.start, seg.end, seg.hyperlink);
            } catch (e) {
            }
          }
        } catch (error) {
          this.logger.error("Failed to apply styled segment:", seg, error);
        }
      }
    }
    /**
     * Validate text-specific data
     */
    validateData(data) {
      super.validateData(data);
      if (data.type !== "TEXT") {
        throw new Error(`Expected TEXT type, got ${data.type}`);
      }
      return true;
    }
  };

  // third-party/html2figma-plugin/upstream/packages/figma/creators/GroupCreator.ts
  var GroupCreator = class extends BaseNodeCreator {
    /**
     * Create a Group node from JSON data (only creates the node)
     */
    create(data) {
      try {
        this.validateData(data);
        const group = this.figmaApi.createGroup();
        return group;
      } catch (error) {
        this.handleError(error, "Group", data);
      }
    }
    /**
     * Set all properties for the group after creation
     */
    setProperties(group, data) {
      try {
        this.setBaseProperties(group, data);
        this.setGroupProperties(group, data);
        this.setSizeProperties(group, data);
        this.logCreation("Group", data.name);
      } catch (error) {
        throw error;
      }
    }
    /**
     * Set group-specific properties
     */
    setGroupProperties(group, data) {
      if (data.blendMode) {
        group.blendMode = data.blendMode;
      }
      if (data.opacity !== void 0) {
        group.opacity = data.opacity;
      }
    }
    /**
     * Add children to the group
     */
    addChildren(group, children) {
    }
    /**
     * Create a group from existing nodes
     */
    createFromNodes(nodes, groupName = "Group") {
      const groupData = {
        id: generateId("grp"),
        name: groupName,
        type: "GROUP",
        visible: true,
        locked: false,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        children: []
      };
      const bounds = this.calculateBoundingBox(nodes);
      groupData.x = bounds.x;
      groupData.y = bounds.y;
      groupData.width = bounds.width;
      groupData.height = bounds.height;
      const group = this.create(groupData);
      nodes.forEach((node) => {
        if (node && typeof node.remove === "function") {
          node.x -= bounds.x;
          node.y -= bounds.y;
          group.appendChild(node);
        }
      });
      return group;
    }
    /**
     * Create a group with auto-layout behavior (using frame instead)
     */
    createAutoLayoutGroup(data, layoutMode = "VERTICAL") {
      const frameData = {
        ...data,
        type: "FRAME",
        layoutMode,
        clipsContent: false,
        fills: []
        // Transparent background
      };
      return this.figmaApi.createFrame();
    }
    /**
     * Ungroup - extract children from group
     */
    ungroup(group) {
      const children = [];
      const groupX = group.x;
      const groupY = group.y;
      while (group.children.length > 0) {
        const child = group.children[0];
        child.x += groupX;
        child.y += groupY;
        if (group.parent) {
          group.parent.appendChild(child);
        }
        children.push(child);
      }
      group.remove();
      return children;
    }
    /**
     * Calculate bounding box of multiple nodes
     */
    calculateBoundingBox(nodes) {
      if (nodes.length === 0) {
        return { x: 0, y: 0, width: 100, height: 100 };
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      nodes.forEach((node) => {
        if (node && typeof node.x === "number" && typeof node.y === "number") {
          const nodeMinX = node.x;
          const nodeMinY = node.y;
          const nodeMaxX = node.x + (node.width || 0);
          const nodeMaxY = node.y + (node.height || 0);
          minX = Math.min(minX, nodeMinX);
          minY = Math.min(minY, nodeMinY);
          maxX = Math.max(maxX, nodeMaxX);
          maxY = Math.max(maxY, nodeMaxY);
        }
      });
      return {
        x: minX === Infinity ? 0 : minX,
        y: minY === Infinity ? 0 : minY,
        width: maxX === -Infinity ? 100 : maxX - minX,
        height: maxY === -Infinity ? 100 : maxY - minY
      };
    }
    /**
     * Validate group-specific data
     */
    validateData(data) {
      super.validateData(data);
      if (data.type !== "GROUP") {
        throw new Error(`Expected GROUP type, got ${data.type}`);
      }
      return true;
    }
  };

  // third-party/html2figma-plugin/upstream/packages/figma/creators/SVGCreator.ts
  var SVGCreator = class extends BaseNodeCreator {
    /**
     * Create an SVG node from JSON data using figmaAPI.createNodeFromSvg
     */
    create(data) {
      try {
        this.validateData(data);
        const svgNode = this.figmaApi.createNodeFromSvg(data.svgContent);
        return svgNode;
      } catch (error) {
        this.handleError(error, "SVG", data);
      }
    }
    /**
     * Set all properties for the SVG node after creation
     */
    setProperties(svgNode, data) {
      try {
        this.setBaseProperties(svgNode, data);
        if (data.width && data.height) {
          svgNode.resize(data.width, data.height);
          this.logger.info("Resized SVG node to match target dimensions", {
            name: data.name,
            width: data.width,
            height: data.height
          });
        }
        this.setSVGProperties(svgNode, data);
        this.logCreation("SVG", data.name);
      } catch (error) {
        throw error;
      }
    }
    /**
     * Set SVG-specific properties
     */
    setSVGProperties(svgNode, data) {
      try {
        if (typeof data.visible === "boolean") {
          svgNode.visible = data.visible;
        }
        if (typeof data.locked === "boolean") {
          svgNode.locked = data.locked;
        }
        if (typeof data.opacity === "number" && data.opacity >= 0 && data.opacity <= 1) {
          svgNode.opacity = data.opacity;
        }
        if (data.blendMode) {
          svgNode.blendMode = data.blendMode;
        }
        if (data.effects && data.effects.length > 0) {
          svgNode.effects = data.effects;
        }
      } catch (error) {
        this.logger.error("Failed to set SVG properties", {
          error: error instanceof Error ? error.message : "Unknown error",
          svgName: data.name
        });
        throw error;
      }
    }
    /**
     * Validate SVG-specific data
     */
    validateSpecificData(data) {
      if (!data.svgContent || typeof data.svgContent !== "string") {
        throw new Error("SVG node must have valid svgContent string");
      }
      if (!data.svgContent.trim().startsWith("<svg")) {
        throw new Error("SVG content must start with <svg tag");
      }
      if (!data.svgContent.includes("</svg>")) {
        throw new Error("SVG content must end with </svg> tag");
      }
    }
    /**
     * Get supported node type
     */
    getSupportedType() {
      return "SVG";
    }
    /**
     * Check if this creator can handle the given data
     */
    canHandle(data) {
      return data && data.type === "SVG";
    }
  };

  // third-party/html2figma-plugin/upstream/packages/figma/factory/NodeCreatorFactory.ts
  var NodeCreatorFactory = class {
    constructor(figmaApi) {
      __publicField(this, "frameCreator");
      __publicField(this, "rectangleCreator");
      __publicField(this, "textCreator");
      __publicField(this, "groupCreator");
      __publicField(this, "imageCreator");
      __publicField(this, "svgCreator");
      __publicField(this, "logger", createLogger("FigmaCreator" /* FIGMA_CREATOR */));
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
    create(nodeData) {
      const nodeName = nodeData.name || "Unnamed";
      this.logger.info(`\u5F00\u59CB\u521B\u5EFA\u8282\u70B9: ${nodeData.type} - "${nodeName}"`);
      try {
        let node;
        if (nodeData.type === "RECTANGLE" && this.isImageNode(nodeData)) {
          this.logger.info(`\u68C0\u6D4B\u5230\u56FE\u7247\u8282\u70B9\uFF0C\u4F7F\u7528 ImageCreator \u521B\u5EFA: "${nodeName}"`);
          node = this.imageCreator.create(nodeData);
        } else {
          switch (nodeData.type) {
            case "FRAME":
              this.logger.info(`\u4F7F\u7528 FrameCreator \u521B\u5EFA\u6846\u67B6\u8282\u70B9: "${nodeName}"`);
              node = this.frameCreator.create(nodeData);
              break;
            case "RECTANGLE":
              this.logger.info(`\u4F7F\u7528 RectangleCreator \u521B\u5EFA\u77E9\u5F62\u8282\u70B9: "${nodeName}"`);
              node = this.rectangleCreator.create(nodeData);
              break;
            case "TEXT":
              this.logger.info(`\u4F7F\u7528 TextCreator \u521B\u5EFA\u6587\u672C\u8282\u70B9: "${nodeName}"`, nodeData);
              node = this.textCreator.create(nodeData);
              break;
            case "GROUP":
              this.logger.info(`\u4F7F\u7528 GroupCreator \u521B\u5EFA\u7EC4\u8282\u70B9: "${nodeName}"`);
              node = this.groupCreator.create(nodeData);
              break;
            case "SVG":
              this.logger.info(`\u4F7F\u7528 SVGCreator \u521B\u5EFASVG\u8282\u70B9: "${nodeName}"`);
              node = this.svgCreator.create(nodeData);
              break;
            default:
              this.logger.error(`\u4E0D\u652F\u6301\u7684\u8282\u70B9\u7C7B\u578B: ${nodeData.type}`);
              throw new Error(`Unsupported node type: ${nodeData.type}`);
          }
        }
        this.logger.info(`\u2705 \u8282\u70B9\u521B\u5EFA\u6210\u529F: ${nodeData.type} - "${nodeName}"`);
        return node;
      } catch (error) {
        this.logger.error(`\u274C \u8282\u70B9\u521B\u5EFA\u5931\u8D25: ${nodeData.type} - "${nodeName}"`, error);
        throw error;
      }
    }
    /**
     * Check if a rectangle node should be treated as an image node
     */
    isImageNode(nodeData) {
      if ("fills" in nodeData && nodeData.fills) {
        const hasImageFill = nodeData.fills.some((fill) => fill.type === "IMAGE");
        if (hasImageFill) return true;
      }
      if (nodeData.backgroundImageData) {
        return true;
      }
      if (nodeData.imageMetadata) {
        return true;
      }
      return false;
    }
    /**
     * Create multiple nodes from an array
     */
    createMultiple(nodesData) {
      return nodesData.map((nodeData) => this.create(nodeData));
    }
    /**
     * Create a node tree recursively
     */
    createTree(rootNodeData) {
      const rootName = rootNodeData.name || "Unnamed";
      this.logger.info(`\u{1F333} \u5F00\u59CB\u521B\u5EFA\u8282\u70B9\u6811\uFF0C\u6839\u8282\u70B9: ${rootNodeData.type} - "${rootName}"`);
      const rootNode = this.create(rootNodeData);
      this.logger.info(`\u2705 \u521B\u5EFA\u8282\u70B9: "${rootName}"`);
      this.setNodeProperties(rootNode, rootNodeData);
      this.logger.info(`\u2705 \u8BBE\u7F6E\u8282\u70B9\u5C5E\u6027: "${rootName}"`);
      if ("children" in rootNodeData && rootNodeData.children) {
        const childrenCount = rootNodeData.children.length;
        this.logger.info(`\u5904\u7406 ${childrenCount} \u4E2A\u5B50\u8282\u70B9`);
        rootNodeData.children.forEach((childData, index) => {
          try {
            const childName = childData.name || "Unnamed";
            this.logger.info(`\u521B\u5EFA\u5B50\u8282\u70B9 ${index + 1}/${childrenCount}: ${childData.type} - "${childName}"`);
            const childNode = this.create(childData);
            if (rootNode.appendChild && typeof rootNode.appendChild === "function") {
              rootNode.appendChild(childNode);
              this.logger.info(`\u2705 \u6DFB\u52A0\u5B50\u8282\u70B9: "${childName}" -> "${rootName}"`);
              this.setNodeProperties(childNode, childData);
              this.logger.info(`\u2705 \u5B50\u8282\u70B9\u5C5E\u6027\u8BBE\u7F6E\u5B8C\u6210: "${childName}"`);
              if ("children" in childData && childData.children && childData.children.length > 0) {
                this.processChildrenRecursively(childNode, childData);
              }
            } else {
              this.logger.warn(`\u26A0\uFE0F \u65E0\u6CD5\u6DFB\u52A0\u5B50\u8282\u70B9\uFF0C\u7236\u8282\u70B9\u4E0D\u652F\u6301 appendChild: "${rootName}"`);
            }
          } catch (error) {
            const childName = childData.name || "Unnamed";
            this.logger.error(`\u274C \u521B\u5EFA\u5B50\u8282\u70B9\u5931\u8D25: "${childName}"`, error);
          }
        });
      }
      this.restoreFixedSize(rootNode, rootNodeData);
      this.logger.info(`\u{1F333} \u8282\u70B9\u6811\u521B\u5EFA\u5B8C\u6210: "${rootName}"`);
      return rootNode;
    }
    /**
     * Recursively process children for a parent node that already has properties set
     */
    processChildrenRecursively(parentNode, parentData) {
      if (!("children" in parentData) || !parentData.children || parentData.children.length === 0) {
        return;
      }
      const parentName = parentData.name || "Unnamed";
      const childrenCount = parentData.children.length;
      this.logger.info(`\u9012\u5F52\u5904\u7406 "${parentName}" \u7684 ${childrenCount} \u4E2A\u5B50\u8282\u70B9`);
      parentData.children.forEach((childData, index) => {
        try {
          const childName = childData.name || "Unnamed";
          this.logger.info(`\u9012\u5F52\u521B\u5EFA\u5B50\u8282\u70B9 ${index + 1}/${childrenCount}: ${childData.type} - "${childName}"`);
          const childNode = this.create(childData);
          if (parentNode.appendChild && typeof parentNode.appendChild === "function") {
            parentNode.appendChild(childNode);
            this.logger.info(`\u9012\u5F52\u6DFB\u52A0\u5B50\u8282\u70B9: "${childName}" -> "${parentName}"`);
            this.setNodeProperties(childNode, childData);
            this.logger.info(`\u9012\u5F52\u5B50\u8282\u70B9\u5C5E\u6027\u8BBE\u7F6E\u5B8C\u6210: "${childName}"`);
            if ("children" in childData && childData.children && childData.children.length > 0) {
              this.processChildrenRecursively(childNode, childData);
            }
          } else {
            this.logger.warn(`\u26A0\uFE0F \u9012\u5F52\u65E0\u6CD5\u6DFB\u52A0\u5B50\u8282\u70B9: "${parentName}"`);
          }
        } catch (error) {
          const childName = childData.name || "Unnamed";
          this.logger.error(`\u274C \u9012\u5F52\u5904\u7406\u5B50\u8282\u70B9\u5931\u8D25: "${childName}"`, error);
        }
      });
      this.restoreFixedSize(parentNode, parentData);
    }
    /**
     * Re-apply resize for frames with FIXED sizing after children are added.
     * Figma auto-layout may recalculate dimensions during appendChild,
     * overriding the initial resize. This restores the intended size.
     */
    restoreFixedSize(node, data) {
      if (data.type !== "FRAME") return;
      const frameData = data;
      if (!frameData.width || !frameData.height) return;
      const isLayoutFrame = frameData.layoutMode && frameData.layoutMode !== "NONE";
      if (!isLayoutFrame) return;
      const isVertical = frameData.layoutMode === "VERTICAL";
      const primaryFixed = frameData.primaryAxisSizingMode === "FIXED";
      const counterFixed = frameData.counterAxisSizingMode === "FIXED";
      const restoreW = isVertical ? counterFixed : primaryFixed;
      const restoreH = isVertical ? primaryFixed : counterFixed;
      if (!restoreW && !restoreH) return;
      const w = Math.round(frameData.width);
      const h = Math.round(frameData.height);
      try {
        if (node.resize && typeof node.resize === "function") {
          const newW = restoreW ? w : Math.round(node.width);
          const newH = restoreH ? h : Math.round(node.height);
          if (Math.abs(node.width - newW) > 0.5 || Math.abs(node.height - newH) > 0.5) {
            node.resize(newW, newH);
            this.logger.info(`Restored size: "${frameData.name}" \u2192 ${newW}x${newH} (was ${Math.round(node.width)}x${Math.round(node.height)})`);
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to restore size for "${frameData.name}":`, error);
      }
    }
    /**
     * Set properties for a node using the appropriate creator
     */
    setNodeProperties(node, data) {
      const nodeName = data.name || "Unnamed";
      this.logger.info(`\u{1F527} \u8BBE\u7F6E\u8282\u70B9\u5C5E\u6027: ${data.type} - "${nodeName}"`);
      try {
        switch (data.type) {
          case "FRAME":
            this.frameCreator.setProperties(node, data);
            break;
          case "GROUP":
            this.groupCreator.setProperties(node, data);
            break;
          case "RECTANGLE":
            if (this.isImageNode(data)) {
              this.imageCreator.setProperties(node, data);
            } else {
              this.rectangleCreator.setProperties(node, data);
            }
            break;
          case "TEXT":
            this.textCreator.setProperties(node, data);
            break;
          case "SVG":
            this.svgCreator.setProperties(node, data);
            break;
          default:
            this.logger.warn(`\u26A0\uFE0F \u672A\u77E5\u8282\u70B9\u7C7B\u578B\uFF0C\u65E0\u6CD5\u8BBE\u7F6E\u5C5E\u6027: ${data.type}`);
        }
        this.logger.info(`\u2705 \u8282\u70B9\u5C5E\u6027\u8BBE\u7F6E\u5B8C\u6210: ${data.type} - "${nodeName}"`);
      } catch (error) {
        this.logger.error(`\u274C \u8BBE\u7F6E\u8282\u70B9\u5C5E\u6027\u5931\u8D25: ${data.type} - "${nodeName}"`, error);
        throw error;
      }
    }
    /**
     * Get creator for specific node type
     */
    getCreator(nodeType) {
      switch (nodeType) {
        case "FRAME":
          return this.frameCreator;
        case "RECTANGLE":
          return this.rectangleCreator;
        case "TEXT":
          return this.textCreator;
        case "GROUP":
          return this.groupCreator;
        case "SVG":
          return this.svgCreator;
        default:
          throw new Error(`No creator available for node type: ${nodeType}`);
      }
    }
    /**
     * Check if node type is supported
     */
    isSupported(nodeType) {
      return ["FRAME", "RECTANGLE", "TEXT", "GROUP", "SVG"].includes(nodeType);
    }
    /**
     * Get list of supported node types
     */
    getSupportedTypes() {
      return ["FRAME", "RECTANGLE", "TEXT", "GROUP", "SVG"];
    }
    /**
     * Create node with validation
     */
    createSafe(nodeData) {
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
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }
    /**
     * Batch create nodes with error handling
     */
    createBatch(nodesData) {
      const successful = [];
      const failed = [];
      nodesData.forEach((nodeData) => {
        const result = this.createSafe(nodeData);
        if (result.node) {
          successful.push(result.node);
        } else {
          failed.push({ nodeData, error: result.error || "Unknown error" });
        }
      });
      return { successful, failed };
    }
  };

  // third-party/html2figma-plugin/upstream/packages/figma/utils/StyleProcessor.ts
  var StyleProcessor = class {
    /**
     * Create a solid paint from RGB color
     */
    static createSolidPaint(color, opacity = 1) {
      return {
        type: "SOLID",
        color,
        opacity,
        visible: true
      };
    }
    /**
     * Create a gradient paint
     */
    static createGradientPaint(type, stops, transform) {
      const defaultTransform = [
        [1, 0, 0],
        [0, 0, 0.5]
      ];
      return {
        type,
        gradientStops: stops,
        gradientTransform: transform || defaultTransform,
        visible: true
      };
    }
    /**
     * Create an image paint
     */
    static createImagePaint(imageHash, scaleMode = "FILL", transform) {
      return {
        type: "IMAGE",
        imageHash,
        scaleMode,
        imageTransform: transform,
        visible: true
      };
    }
    /**
     * Create a drop shadow effect
     */
    static createDropShadow(offset, blur, spread = 0, color = { r: 0, g: 0, b: 0, a: 0.25 }) {
      return {
        type: "DROP_SHADOW",
        visible: true,
        radius: blur,
        color,
        blendMode: "NORMAL",
        offset,
        spread,
        showShadowBehindNode: false
      };
    }
    /**
     * Create an inner shadow effect
     */
    static createInnerShadow(offset, blur, spread = 0, color = { r: 0, g: 0, b: 0, a: 0.25 }) {
      return {
        type: "INNER_SHADOW",
        visible: true,
        radius: blur,
        color,
        blendMode: "NORMAL",
        offset,
        spread
      };
    }
    /**
     * Create a blur effect
     */
    static createBlur(radius, type = "LAYER_BLUR") {
      return {
        type,
        visible: true,
        radius
      };
    }
    /**
     * Convert hex color to RGB
     */
    static hexToRgb(hex2) {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex2);
      return result ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255
      } : null;
    }
    /**
     * Convert RGB to hex
     */
    static rgbToHex(rgb2) {
      const toHex = (c) => {
        const hex2 = Math.round(c * 255).toString(16);
        return hex2.length === 1 ? "0" + hex2 : hex2;
      };
      return `#${toHex(rgb2.r)}${toHex(rgb2.g)}${toHex(rgb2.b)}`;
    }
    /**
     * Convert CSS color string to RGB
     */
    static cssColorToRgb(cssColor2) {
      if (cssColor2.startsWith("#")) {
        return this.hexToRgb(cssColor2);
      }
      const rgbMatch = cssColor2.match(/rgba?\(([^)]+)\)/);
      if (rgbMatch) {
        const values = rgbMatch[1].split(",").map((v) => parseFloat(v.trim()));
        if (values.length >= 3) {
          return {
            r: values[0] / 255,
            g: values[1] / 255,
            b: values[2] / 255
          };
        }
      }
      if (cssColor2.toLowerCase() === "transparent") {
        return { r: 0, g: 0, b: 0 };
      }
      const namedColors = {
        "black": { r: 0, g: 0, b: 0 },
        "white": { r: 1, g: 1, b: 1 },
        "red": { r: 1, g: 0, b: 0 },
        "green": { r: 0, g: 1, b: 0 },
        "blue": { r: 0, g: 0, b: 1 },
        "yellow": { r: 1, g: 1, b: 0 },
        "cyan": { r: 0, g: 1, b: 1 },
        "magenta": { r: 1, g: 0, b: 1 },
        "gray": { r: 0.5, g: 0.5, b: 0.5 },
        "grey": { r: 0.5, g: 0.5, b: 0.5 }
      };
      return namedColors[cssColor2.toLowerCase()] || null;
    }
    /**
     * Create gradient from any CSS gradient string (auto-detect type)
     */
    static createGradientFromCSS(cssGradient) {
      if (cssGradient.includes("linear-gradient")) {
        return this.createLinearGradientFromCSS(cssGradient);
      } else if (cssGradient.includes("radial-gradient")) {
        return this.createRadialGradientFromCSS(cssGradient);
      } else if (cssGradient.includes("conic-gradient")) {
        return this.createConicGradientFromCSS(cssGradient);
      }
      return null;
    }
    /**
     * Create conic gradient from CSS conic-gradient (experimental)
     */
    static createConicGradientFromCSS(cssGradient) {
      const match = cssGradient.match(/conic-gradient\(([^)]+)\)/);
      if (!match) return null;
      const content = match[1];
      const parts = this.parseGradientParts(content);
      const stops = [];
      let colorIndex = 0;
      const colorParts = parts.filter(
        (part) => !part.includes("from ") && !part.includes("at ")
      );
      for (const part of parts) {
        if (part.includes("from ") || part.includes("at ")) {
          continue;
        }
        const colorStop = this.parseColorStop(part, colorIndex, colorParts.length);
        if (colorStop) {
          stops.push(colorStop);
          colorIndex++;
        }
      }
      if (stops.length < 2) {
        return null;
      }
      stops.sort((a, b) => a.position - b.position);
      return {
        type: "GRADIENT_ANGULAR",
        gradientStops: stops,
        gradientTransform: [
          [0.5, 0, 0.5],
          // x-axis: centered
          [0, 0.5, 0.5]
          // y-axis: centered
        ],
        visible: true
      };
    }
    /**
     * Convert CSS color string to RGBA with opacity support
     */
    static cssColorToRgba(cssColor2) {
      if (cssColor2.toLowerCase() === "transparent") {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      if (cssColor2.startsWith("#")) {
        const rgb3 = this.hexToRgb(cssColor2);
        return rgb3 ? { ...rgb3, a: 1 } : null;
      }
      const rgbaMatch = cssColor2.match(/rgba\(([^)]+)\)/);
      if (rgbaMatch) {
        const values = rgbaMatch[1].split(",").map((v) => parseFloat(v.trim()));
        if (values.length >= 4) {
          return {
            r: values[0] / 255,
            g: values[1] / 255,
            b: values[2] / 255,
            a: values[3]
          };
        }
      }
      const rgbMatch = cssColor2.match(/rgb\(([^)]+)\)/);
      if (rgbMatch) {
        const values = rgbMatch[1].split(",").map((v) => parseFloat(v.trim()));
        if (values.length >= 3) {
          return {
            r: values[0] / 255,
            g: values[1] / 255,
            b: values[2] / 255,
            a: 1
          };
        }
      }
      const rgb2 = this.cssColorToRgb(cssColor2);
      return rgb2 ? { ...rgb2, a: 1 } : null;
    }
    /**
     * Create gradient from CSS linear-gradient with enhanced transparency support
     */
    static createLinearGradientFromCSS(cssGradient) {
      const regex = /linear-gradient\(((?:[^()]|\([^)]*\))*)\)/;
      const match = cssGradient.match(regex);
      if (!match) {
        return null;
      }
      const content = match[1];
      const parts = this.parseGradientParts(content);
      const stops = [];
      let angle = 180;
      let colorIndex = 0;
      const colorParts = parts.filter((part) => !part.includes("deg") && !part.includes("rad") && !part.includes("turn") && !part.includes("grad") && !part.includes("to "));
      for (const part of parts) {
        if (part.includes("deg") || part.includes("rad") || part.includes("turn") || part.includes("grad")) {
          angle = this.parseAngle(part);
          continue;
        }
        if (part.includes("to ")) {
          angle = this.parseDirection(part);
          continue;
        }
        const colorStop = this.parseColorStop(part, colorIndex, colorParts.length);
        if (colorStop) {
          stops.push(colorStop);
          colorIndex++;
        }
      }
      if (stops.length < 2) {
        return null;
      }
      stops.sort((a, b) => a.position - b.position);
      const gradientTransform = this.calculateLinearGradientTransform(angle);
      const result = {
        type: "GRADIENT_LINEAR",
        gradientStops: stops,
        gradientTransform,
        visible: true
      };
      return result;
    }
    /**
     * Parse angle from gradient string
     */
    static parseAngle(angleStr) {
      angleStr = angleStr.trim();
      if (angleStr.endsWith("deg")) {
        return parseFloat(angleStr);
      } else if (angleStr.endsWith("rad")) {
        return parseFloat(angleStr) * (180 / Math.PI);
      } else if (angleStr.endsWith("grad")) {
        return parseFloat(angleStr) * (180 / 200);
      } else if (angleStr.endsWith("turn")) {
        return parseFloat(angleStr) * 360;
      }
      return parseFloat(angleStr) || 180;
    }
    /**
     * Parse direction keywords (to top, to right, etc.)
     */
    static parseDirection(direction) {
      direction = direction.trim().toLowerCase();
      if (direction.includes("to top") && direction.includes("right")) {
        return 45;
      }
      if (direction.includes("to top") && direction.includes("left")) {
        return 315;
      }
      if (direction.includes("to bottom") && direction.includes("right")) {
        return 135;
      }
      if (direction.includes("to bottom") && direction.includes("left")) {
        return 225;
      }
      if (direction.includes("to top")) {
        return 0;
      }
      if (direction.includes("to right")) {
        return 90;
      }
      if (direction.includes("to bottom")) {
        return 180;
      }
      if (direction.includes("to left")) {
        return 270;
      }
      return 180;
    }
    /**
     * Calculate gradient transform matrix for linear gradient based on angle
     * CSS angle: 0deg = to top, 90deg = to right, 180deg = to bottom, 270deg = to left (顺时针)
     * Figma uses a transform matrix where the gradient goes from [0,0] to [1,0] by default (horizontal)
     */
    static calculateLinearGradientTransform(angleDeg) {
      const mathAngleDeg = 90 - angleDeg;
      const angleRad = mathAngleDeg * (Math.PI / 180);
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      return [
        [cos, -sin, 0.5 - cos / 2 + sin / 2],
        // x-axis transformation
        [sin, cos, 0.5 - sin / 2 - cos / 2]
        // y-axis transformation
      ];
    }
    /**
     * Create gradient from CSS radial-gradient with enhanced transparency support
     */
    static createRadialGradientFromCSS(cssGradient) {
      const regex = /radial-gradient\(((?:[^()]|\([^)]*\))*)\)/;
      const match = cssGradient.match(regex);
      if (!match) return null;
      const content = match[1];
      const parts = this.parseGradientParts(content);
      const stops = [];
      let isCircle = false;
      let position = { x: 0.5, y: 0.5 };
      let hasProcessedShapeOrPosition = false;
      let colorIndex = 0;
      for (const part of parts) {
        const trimmedPart = part.trim();
        const isShapeOrPosition = trimmedPart === "circle" || trimmedPart === "ellipse" || trimmedPart.startsWith("circle ") || trimmedPart.startsWith("ellipse ") || trimmedPart.includes("closest-side") || trimmedPart.includes("farthest-side") || trimmedPart.includes("closest-corner") || trimmedPart.includes("farthest-corner") || trimmedPart.includes(" at ");
        if (isShapeOrPosition) {
          hasProcessedShapeOrPosition = true;
          if (trimmedPart.includes("circle")) {
            isCircle = true;
          }
          if (trimmedPart.includes(" at ")) {
            position = this.parseRadialGradientPosition(trimmedPart);
          }
        }
      }
      const colorParts = parts.filter((part) => {
        const trimmedPart = part.trim();
        if (trimmedPart === "circle" || trimmedPart === "ellipse") return false;
        if (trimmedPart.startsWith("circle ") || trimmedPart.startsWith("ellipse ")) return false;
        if (trimmedPart.includes("closest-") || trimmedPart.includes("farthest-")) return false;
        if (trimmedPart.includes(" at ") && !trimmedPart.match(/rgb|hsl|#|[a-z]+\s+\d+%/)) return false;
        return true;
      });
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
      stops.sort((a, b) => a.position - b.position);
      const gradientTransform = this.calculateRadialGradientTransform(isCircle, position);
      return {
        type: "GRADIENT_RADIAL",
        gradientStops: stops,
        gradientTransform,
        visible: true
      };
    }
    /**
     * Parse radial gradient position from 'at' clause
     * 支持：at center, at left top, at 50% 50%, at 10px 20px 等
     */
    static parseRadialGradientPosition(atClause) {
      const defaultPos = { x: 0.5, y: 0.5 };
      const atMatch = atClause.match(/at\s+(.+)$/);
      if (!atMatch) return defaultPos;
      const positionStr = atMatch[1].trim();
      const percentMatch = positionStr.match(/(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
      if (percentMatch) {
        return {
          x: parseFloat(percentMatch[1]) / 100,
          y: parseFloat(percentMatch[2]) / 100
        };
      }
      const keywords = positionStr.toLowerCase().split(/\s+/);
      let x = 0.5;
      let y = 0.5;
      for (const keyword of keywords) {
        switch (keyword) {
          case "left":
            x = 0;
            break;
          case "right":
            x = 1;
            break;
          case "top":
            y = 0;
            break;
          case "bottom":
            y = 1;
            break;
          case "center":
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
    static calculateRadialGradientTransform(isCircle, position) {
      if (isCircle) {
        return [
          [0.5, 0, position.x],
          // x-axis: uniform scale, centered at position
          [0, 0.5, position.y]
          // y-axis: uniform scale, centered at position
        ];
      } else {
        return [
          [0.5, 0, position.x],
          // x-axis: centered at position
          [0, 0.5, position.y]
          // y-axis: centered at position
        ];
      }
    }
    /**
     * Parse gradient parts from CSS gradient string
     */
    static parseGradientParts(content) {
      const parts = [];
      let current = "";
      let depth = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content[i];
        if (char === "(") depth++;
        else if (char === ")") depth--;
        else if (char === "," && depth === 0) {
          parts.push(current.trim());
          current = "";
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
    static parseColorStop(part, index, totalParts) {
      const percentRegex = /^(.+?)\s+(\d+(?:\.\d+)?)%$/;
      let colorStr;
      let positionStr;
      const withPercentMatch = part.match(percentRegex);
      if (withPercentMatch) {
        colorStr = withPercentMatch[1].trim();
        positionStr = withPercentMatch[2];
      } else {
        colorStr = part.trim();
        positionStr = void 0;
      }
      let colorWithAlpha = null;
      colorWithAlpha = this.cssColorToRgba(colorStr);
      if (!colorWithAlpha) {
        return null;
      }
      let position;
      if (positionStr) {
        position = parseFloat(positionStr) / 100;
      } else {
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
    static parseBoxShadow(boxShadow) {
      if (!boxShadow || boxShadow === "none") {
        return [];
      }
      const effects = [];
      const shadows = boxShadow.split(",").map((s) => s.trim());
      shadows.forEach((shadow) => {
        const parts = shadow.split(/\s+/);
        if (parts.length >= 4) {
          const offsetX = parseFloat(parts[0]) || 0;
          const offsetY = parseFloat(parts[1]) || 0;
          const blurRadius = parseFloat(parts[2]) || 0;
          const spreadRadius = parseFloat(parts[3]) || 0;
          let color = { r: 0, g: 0, b: 0, a: 0.25 };
          if (parts[4]) {
            const rgb2 = this.cssColorToRgb(parts[4]);
            if (rgb2) {
              color = { ...rgb2, a: 1 };
            }
          }
          const isInset = shadow.includes("inset");
          const effect = isInset ? this.createInnerShadow({ x: offsetX, y: offsetY }, blurRadius, spreadRadius, color) : this.createDropShadow({ x: offsetX, y: offsetY }, blurRadius, spreadRadius, color);
          effects.push(effect);
        }
      });
      return effects;
    }
    /**
     * Blend two colors
     */
    static blendColors(color1, color2, ratio) {
      const clamp = (value) => Math.max(0, Math.min(1, value));
      return {
        r: clamp(color1.r * (1 - ratio) + color2.r * ratio),
        g: clamp(color1.g * (1 - ratio) + color2.g * ratio),
        b: clamp(color1.b * (1 - ratio) + color2.b * ratio)
      };
    }
    /**
     * Lighten a color
     */
    static lightenColor(color, amount) {
      return this.blendColors(color, { r: 1, g: 1, b: 1 }, amount);
    }
    /**
     * Darken a color
     */
    static darkenColor(color, amount) {
      return this.blendColors(color, { r: 0, g: 0, b: 0 }, amount);
    }
    /**
     * Get contrast ratio between two colors
     */
    static getContrastRatio(color1, color2) {
      const getLuminance = (color) => {
        const { r, g, b } = color;
        const [rs, gs, bs] = [r, g, b].map((c) => {
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
  };

  // third-party/html2figma-plugin/upstream/packages/figma/utils/ImageProcessor.ts
  var _ImageProcessor = class _ImageProcessor {
    constructor(figmaApi, options = {}) {
      __publicField(this, "figmaApi");
      __publicField(this, "options");
      this.figmaApi = figmaApi;
      this.options = { ..._ImageProcessor.DEFAULT_OPTIONS, ...options };
    }
    /**
     * Process image data and create appropriate Paint
     */
    async processImage(imageData, scaleMode = "FILL") {
      try {
        if (imageData.hash) {
          return {
            paint: this.createImagePaint(imageData.hash, scaleMode),
            isAsync: false,
            metadata: imageData
          };
        }
        if (imageData.base64) {
          return await this.processBase64Image(imageData, scaleMode);
        }
        if (imageData.url) {
          return await this.processUrlImage(imageData, scaleMode);
        }
        throw new Error("No valid image data provided");
      } catch (error) {
        return this.createPlaceholderImage(scaleMode);
      }
    }
    /**
     * Process base64 image data
     */
    async processBase64Image(imageData, scaleMode) {
      if (!imageData.base64) {
        throw new Error("No base64 data provided");
      }
      try {
        const base64Data = imageData.base64.replace(/^data:image\/[^;]+;base64,/, "");
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        if (bytes.length > this.options.maxSize && !this.options.preferUrl) {
          if (imageData.url) {
            return await this.processUrlImage(imageData, scaleMode);
          }
        }
        const figmaImage = await this.figmaApi.createImage(bytes);
        return {
          paint: this.createImagePaint(figmaImage.hash, scaleMode),
          isAsync: false,
          metadata: { ...imageData, hash: figmaImage.hash, size: bytes.length }
        };
      } catch (error) {
        if (imageData.url) {
          return await this.processUrlImage(imageData, scaleMode);
        }
        throw error;
      }
    }
    /**
     * Process URL image - decide whether to fetch immediately or defer
     */
    async processUrlImage(imageData, scaleMode) {
      if (!imageData.url) {
        throw new Error("No URL provided");
      }
      const shouldDefer = this.shouldDeferImageLoading(imageData);
      if (shouldDefer) {
        return {
          paint: this.createUrlPlaceholderPaint(imageData.url, scaleMode),
          isAsync: true,
          metadata: imageData
        };
      }
      try {
        const fetchedImage = await this.fetchImageAsBytes(imageData.url);
        const figmaImage = await this.figmaApi.createImage(fetchedImage.bytes);
        return {
          paint: this.createImagePaint(figmaImage.hash, scaleMode),
          isAsync: false,
          metadata: {
            ...imageData,
            hash: figmaImage.hash,
            size: fetchedImage.bytes.length,
            width: fetchedImage.width,
            height: fetchedImage.height
          }
        };
      } catch (error) {
        return {
          paint: this.createUrlPlaceholderPaint(imageData.url, scaleMode),
          isAsync: true,
          metadata: imageData
        };
      }
    }
    /**
     * Fetch image from URL as bytes
     */
    async fetchImageAsBytes(url) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);
      try {
        const fetchUrl = this.needsCorsProxy(url) && this.options.corsProxy ? `${this.options.corsProxy}${encodeURIComponent(url)}` : url;
        const response = await fetch(fetchUrl, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const dimensions = this.getImageDimensions(bytes);
        return {
          bytes,
          width: dimensions?.width,
          height: dimensions?.height
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }
    /**
     * Check if image loading should be deferred
     */
    shouldDeferImageLoading(imageData) {
      if (this.options.preferUrl) {
        return true;
      }
      if (imageData.url && this.isExternalUrl(imageData.url)) {
        return true;
      }
      if (imageData.size && imageData.size > this.options.maxSize) {
        return true;
      }
      if (imageData.width && imageData.height) {
        const { width, height } = this.options.maxDimensions;
        if (imageData.width > width || imageData.height > height) {
          return true;
        }
      }
      return false;
    }
    /**
     * Check if URL is external (cross-origin)
     */
    isExternalUrl(url) {
      try {
        const urlObj = new URL(url, window.location.href);
        return urlObj.origin !== window.location.origin;
      } catch {
        return false;
      }
    }
    /**
     * Check if URL needs CORS proxy
     */
    needsCorsProxy(url) {
      return this.isExternalUrl(url) && !url.startsWith("data:");
    }
    /**
     * Create image paint from hash
     */
    createImagePaint(imageHash, scaleMode) {
      return {
        type: "IMAGE",
        imageHash,
        scaleMode,
        visible: true
      };
    }
    /**
     * Create placeholder paint for URL-based images
     */
    createUrlPlaceholderPaint(url, scaleMode) {
      return {
        type: "IMAGE",
        imageHash: "",
        // Empty hash indicates pending
        scaleMode,
        visible: true,
        // Store URL in a custom property for async loading
        _pendingImageUrl: url
      };
    }
    /**
     * Create placeholder image for failed loads
     */
    createPlaceholderImage(scaleMode) {
      const placeholderPaint = {
        type: "SOLID",
        color: { r: 0.9, g: 0.9, b: 0.9 },
        // Light gray
        opacity: 1,
        visible: true
      };
      return {
        paint: placeholderPaint,
        isAsync: false,
        metadata: { format: "PNG" }
      };
    }
    /**
     * Get basic image dimensions from bytes (simplified)
     */
    getImageDimensions(bytes) {
      try {
        if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
          const width = bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19];
          const height = bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23];
          return { width, height };
        }
        if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
          return null;
        }
        return null;
      } catch {
        return null;
      }
    }
    /**
     * Process multiple images in batch
     */
    async processImageBatch(images) {
      const results = await Promise.allSettled(
        images.map(({ data, scaleMode }) => this.processImage(data, scaleMode))
      );
      return results.map((result, index) => {
        if (result.status === "fulfilled") {
          return result.value;
        } else {
          return this.createPlaceholderImage(images[index].scaleMode || "FILL");
        }
      });
    }
    /**
     * Async image loader for deferred images
     */
    async loadDeferredImage(paint, node) {
      if (!paint._pendingImageUrl) {
        return false;
      }
      try {
        const fetchedImage = await this.fetchImageAsBytes(paint._pendingImageUrl);
        const figmaImage = await this.figmaApi.createImage(fetchedImage.bytes);
        const updatedPaint = {
          type: "IMAGE",
          imageHash: figmaImage.hash,
          scaleMode: paint.scaleMode || "FILL",
          visible: true
        };
        if (node.fills && Array.isArray(node.fills)) {
          const fillIndex = node.fills.findIndex(
            (fill) => fill._pendingImageUrl === paint._pendingImageUrl
          );
          if (fillIndex >= 0) {
            const newFills = [...node.fills];
            newFills[fillIndex] = updatedPaint;
            node.fills = newFills;
          }
        }
        return true;
      } catch (error) {
        return false;
      }
    }
    /**
     * Load all deferred images in a node tree
     */
    async loadAllDeferredImages(rootNode) {
      let loadedCount = 0;
      const processNode = async (node) => {
        if (node.fills && Array.isArray(node.fills)) {
          for (const fill of node.fills) {
            if (fill._pendingImageUrl) {
              const success = await this.loadDeferredImage(fill, node);
              if (success) loadedCount++;
            }
          }
        }
        if (node.children && Array.isArray(node.children)) {
          for (const child of node.children) {
            await processNode(child);
          }
        }
      };
      await processNode(rootNode);
      return loadedCount;
    }
  };
  __publicField(_ImageProcessor, "DEFAULT_OPTIONS", {
    maxSize: 1024 * 1024,
    // 1MB
    maxDimensions: { width: 4096, height: 4096 },
    quality: 0.8,
    preferUrl: false,
    corsProxy: "",
    timeout: 1e4
  });
  var ImageProcessor = _ImageProcessor;

  // third-party/html2figma-plugin/upstream/packages/figma/FigmaService.ts
  var FigmaService = class {
    constructor(figmaApi, options = {}) {
      __publicField(this, "factory");
      __publicField(this, "imageProcessor");
      __publicField(this, "options");
      __publicField(this, "figmaApi");
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
    async addLayersToFrame(figmaJson, parentNode = globalThis.figma?.currentPage) {
      try {
        if (this.options.validateNodes) {
          this.validateFigmaJson(figmaJson);
        }
        const rootFrame = this.factory.createTree(figmaJson);
        await FrameCreator.awaitPendingImages();
        if (parentNode && typeof parentNode.appendChild === "function") {
          parentNode.appendChild(rootFrame);
        } else if (parentNode === null) {
        }
        if (this.options.autoFocus && globalThis.figma?.viewport) {
          globalThis.figma.viewport.scrollAndZoomIntoView([rootFrame]);
        }
        return rootFrame;
      } catch (error) {
        throw error;
      }
    }
    /**
     * Create a single Figma node from JSON
     */
    createFigmaNode(nodeData) {
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
    createMultipleNodes(nodesData) {
      return this.factory.createBatch(nodesData);
    }
    /**
     * Create a frame with auto-layout from HTML structure
     */
    createAutoLayoutFrame(name, children, layoutOptions = {}) {
      const frameData = {
        id: generateId("svc"),
        name,
        type: "FRAME",
        visible: true,
        locked: false,
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        children,
        layoutMode: layoutOptions.direction || "VERTICAL",
        primaryAxisAlignItems: layoutOptions.alignment || "MIN",
        counterAxisAlignItems: "MIN",
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
    createStyledRectangle(name, dimensions, styling = {}) {
      const fills = styling.fill ? [StyleProcessor.createSolidPaint(styling.fill)] : [];
      const strokes = styling.stroke ? [StyleProcessor.createSolidPaint(styling.stroke)] : [];
      const rectangleData = {
        id: generateId("svc"),
        name,
        type: "RECTANGLE",
        visible: true,
        locked: false,
        x: dimensions.x || 0,
        y: dimensions.y || 0,
        width: dimensions.width,
        height: dimensions.height,
        fills,
        strokes,
        strokeWeight: styling.strokeWidth || 0,
        cornerRadius: styling.cornerRadius || 0,
        opacity: styling.opacity || 1
      };
      return this.factory.create(rectangleData);
    }
    /**
     * Create formatted text
     */
    createFormattedText(text, formatting = {}) {
      const fills = formatting.color ? [StyleProcessor.createSolidPaint(formatting.color)] : [];
      const textData = {
        id: generateId("svc"),
        name: text.substring(0, 50),
        type: "TEXT",
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
          style: formatting.fontStyle || "Regular"
        } : void 0,
        textAlignHorizontal: formatting.alignment || "LEFT",
        fills,
        textAutoResize: "WIDTH_AND_HEIGHT"
      };
      return this.factory.create(textData);
    }
    /**
     * Get service statistics
     */
    getStatistics() {
      return {
        supportedNodeTypes: this.factory.getSupportedTypes(),
        createdNodesCount: 0,
        // Would track in real implementation
        lastOperation: null
        // Would track in real implementation
      };
    }
    /**
     * Validate Figma JSON structure
     */
    validateFigmaJson(figmaJson) {
      if (!figmaJson) {
        throw new Error("Figma JSON is required");
      }
      if (!figmaJson.type) {
        throw new Error("Node type is required");
      }
      if (!figmaJson.name) {
        throw new Error("Node name is required");
      }
      if (figmaJson.width <= 0 || figmaJson.height <= 0) {
        throw new Error("Node dimensions must be positive");
      }
      if (figmaJson.children) {
        figmaJson.children.forEach((child, index) => {
          try {
            this.validateNodeData(child);
          } catch (error) {
            throw new Error(`Invalid child node at index ${index}: ${error.message}`);
          }
        });
      }
    }
    /**
     * Validate individual node data
     */
    validateNodeData(nodeData) {
      if (!nodeData) {
        throw new Error("Node data is required");
      }
      if (!this.factory.isSupported(nodeData.type)) {
        throw new Error(`Unsupported node type: ${nodeData.type}`);
      }
    }
    /**
     * Generate unique ID
     */
    /**
     * Process images in a node tree and handle large images asynchronously
     */
    async processImagesInTree(rootNode) {
      let processedCount = 0;
      let deferredCount = 0;
      const processNode = async (node) => {
        if (node.fills && Array.isArray(node.fills)) {
          const newFills = [];
          for (const fill of node.fills) {
            if (fill.type === "IMAGE" && fill._pendingImageUrl) {
              deferredCount++;
              newFills.push(fill);
            } else if (fill.type === "IMAGE" && fill.imageHash) {
              processedCount++;
              newFills.push(fill);
            } else {
              newFills.push(fill);
            }
          }
          node.fills = newFills;
        }
        if (node.children && Array.isArray(node.children)) {
          for (const child of node.children) {
            await processNode(child);
          }
        }
      };
      await processNode(rootNode);
      return { processedCount, deferredCount };
    }
    /**
     * Load all deferred images in a node tree
     */
    async loadDeferredImages(rootNode) {
      const loadedCount = await this.imageProcessor.loadAllDeferredImages(rootNode);
      return loadedCount;
    }
    /**
     * Get image processor instance for advanced usage
     */
    getImageProcessor() {
      return this.imageProcessor;
    }
    /**
     * Update image processing configuration
     */
    updateImageProcessingConfig(config) {
      this.imageProcessor = new ImageProcessor(this.figmaApi, {
        ...this.options.imageProcessing,
        ...config
      });
    }
    /**
     * Process a single image and return the paint
     */
    async processImage(imageData, scaleMode = "FILL") {
      return await this.imageProcessor.processImage(imageData, scaleMode);
    }
    /**
     * Batch process multiple images
     */
    async processImageBatch(images) {
      return await this.imageProcessor.processImageBatch(images);
    }
    /**
     * Create a node with image processing support
     */
    async createNodeWithImages(nodeData) {
      const node = this.factory.create(nodeData);
      if (nodeData.fills && Array.isArray(nodeData.fills)) {
        const processedFills = [];
        for (const fill of nodeData.fills) {
          if (fill.type === "IMAGE" && fill.imageUrl) {
            const imageData = { url: fill.imageUrl };
            const processedImage = await this.imageProcessor.processImage(
              imageData,
              fill.scaleMode || "FILL"
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
  };

  // third-party/html2figma-plugin/upstream/packages/figma/font-utils.ts
  function extractFontsFromJSON(node) {
    const fonts = /* @__PURE__ */ new Map();
    if (!node) return fonts;
    if (node.nodes?.length) {
      for (const n of node.nodes) {
        extractFontsFromJSON(n).forEach((f, k) => fonts.set(k, f));
      }
      return fonts;
    }
    if (node.type === "TEXT") {
      if (node.fontName?.family && node.fontName?.style) {
        const { family, style } = node.fontName;
        fonts.set(`${family}:${style}`, { family, style });
      }
      if (node.styledTextSegments?.length) {
        for (const seg of node.styledTextSegments) {
          if (seg.fontName?.family && seg.fontName?.style) {
            const { family, style } = seg.fontName;
            fonts.set(`${family}:${style}`, { family, style });
          }
        }
      }
    }
    if (node.children?.length) {
      for (const child of node.children) {
        if (!child) continue;
        const childFonts = extractFontsFromJSON(child);
        childFonts.forEach((font, key) => fonts.set(key, font));
      }
    }
    return fonts;
  }

  // apps/design-studio/app/corner-radii.mjs
  var CORNER_RADIUS_PROPERTIES = Object.freeze([
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius"
  ]);
  function normalizeCornerRadii(value) {
    if (!Array.isArray(value) || value.length !== 4 || Array.from(value).some((radius) => !Number.isFinite(radius) || radius < 0 || radius > 9999))
      throw new Error("cornerRadii \u5FC5\u987B\u662F\u56DB\u4E2A 0\u20139999 \u7684\u6709\u9650\u5706\u5F62\u50CF\u7D20\u534A\u5F84\uFF08\u5DE6\u4E0A\u3001\u53F3\u4E0A\u3001\u53F3\u4E0B\u3001\u5DE6\u4E0B\uFF09");
    return [...value];
  }
  function cssCornerRadii(values) {
    return normalizeCornerRadii(values.map((value) => {
      const parts = String(value).trim().split(/\s+/u);
      if (parts.length < 1 || parts.length > 2 || parts.some((part) => !/^(?:(?:\d+(?:\.\d+)?|\.\d+)px|0(?:\.0+)?)$/u.test(part)))
        throw new Error("CSS \u5706\u89D2\u53EA\u652F\u6301\u5706\u5F62 px \u534A\u5F84\uFF1B\u767E\u5206\u6BD4\u3001\u692D\u5706\u548C\u590D\u6742\u8868\u8FBE\u5F0F\u6682\u4E0D\u80FD\u4FDD\u7559");
      const radii = parts.map(Number.parseFloat);
      if (radii.length === 2 && radii[0] !== radii[1])
        throw new Error("CSS \u692D\u5706\u5706\u89D2\u6682\u4E0D\u80FD\u4FDD\u7559\uFF1B\u8BF7\u4F7F\u7528\u76F8\u7B49\u7684\u6C34\u5E73\u548C\u5782\u76F4 px \u534A\u5F84");
      return radii[0];
    }));
  }

  // third-party/html2figma-plugin/upstream/packages/adapter/figma/layoutMapper.ts
  function mapLayout(layout) {
    if (layout.hasFloatChildren) {
      return {
        paddingTop: Math.round(layout.padding.top),
        paddingRight: Math.round(layout.padding.right),
        paddingBottom: Math.round(layout.padding.bottom),
        paddingLeft: Math.round(layout.padding.left)
      };
    }
    const props = {};
    if (layout.display === "flex" || layout.display === "inline-flex") {
      props.layoutMode = mapFlexDirection(layout.flex?.direction);
      if (layout.flex) {
        props.primaryAxisAlignItems = mapJustifyContent(layout.flex.justifyContent);
        props.counterAxisAlignItems = mapAlignItems(layout.flex.alignItems);
        const isReversed = layout.flex.direction === "row-reverse" || layout.flex.direction === "column-reverse";
        if (isReversed) {
          props.primaryAxisAlignItems = flipAlignment(props.primaryAxisAlignItems);
        }
        props.itemSpacing = layout.flex.direction?.includes("column") ? layout.flex.gap.row : layout.flex.gap.column;
        if (layout.flex.wrap === "wrap" || layout.flex.wrap === "wrap-reverse") {
          props.layoutWrap = "WRAP";
          props.counterAxisSpacing = layout.flex.direction?.includes("column") ? layout.flex.gap.column : layout.flex.gap.row;
        }
        props.primaryAxisSizingMode = "FIXED";
        props.counterAxisSizingMode = "FIXED";
      }
    } else if (layout.display === "grid" || layout.display === "inline-grid") {
      props.layoutMode = "VERTICAL";
      props.primaryAxisAlignItems = "MIN";
      props.counterAxisAlignItems = "MIN";
      if (layout.grid) {
        props.itemSpacing = layout.grid.gap.row;
      }
    } else if (layout.display === "inline") {
      props.layoutMode = "HORIZONTAL";
      props.primaryAxisAlignItems = "MIN";
      props.counterAxisAlignItems = "CENTER";
      props.primaryAxisSizingMode = "FIXED";
      props.counterAxisSizingMode = "FIXED";
    } else {
      props.layoutMode = "VERTICAL";
      props.primaryAxisAlignItems = "MIN";
      if (layout.textAlign === "center") {
        props.counterAxisAlignItems = "CENTER";
      } else if (layout.textAlign === "right") {
        props.counterAxisAlignItems = "MAX";
      } else {
        props.counterAxisAlignItems = "MIN";
      }
      props.primaryAxisSizingMode = "AUTO";
      props.counterAxisSizingMode = "FIXED";
    }
    props.paddingTop = Math.round(layout.padding.top);
    props.paddingRight = Math.round(layout.padding.right);
    props.paddingBottom = Math.round(layout.padding.bottom);
    props.paddingLeft = Math.round(layout.padding.left);
    if (layout.sizing) {
      if (layout.sizing.minWidth) props.minWidth = Math.round(layout.sizing.minWidth);
      if (layout.sizing.maxWidth) props.maxWidth = Math.round(layout.sizing.maxWidth);
      if (layout.sizing.minHeight) props.minHeight = Math.round(layout.sizing.minHeight);
      if (layout.sizing.maxHeight) props.maxHeight = Math.round(layout.sizing.maxHeight);
    }
    return props;
  }
  function mapOverflow(overflow) {
    return overflow === "hidden" || overflow === "scroll" || overflow === "auto";
  }
  function mapPositioning(positioning) {
    const props = {};
    if (positioning.mode === "absolute" || positioning.mode === "fixed") {
      props.layoutPositioning = "ABSOLUTE";
    }
    return props;
  }
  function inferConstraints(child, parent) {
    const distL = child.x;
    const distR = parent.width - (child.x + child.width);
    const distT = child.y;
    const distB = parent.height - (child.y + child.height);
    const THRESHOLD = 3;
    let horizontal;
    if (Math.abs(distL - distR) <= THRESHOLD) {
      horizontal = distL < parent.width * 0.2 ? "STRETCH" : "CENTER";
    } else {
      horizontal = distL <= distR ? "MIN" : "MAX";
    }
    let vertical;
    if (Math.abs(distT - distB) <= THRESHOLD) {
      vertical = distT < parent.height * 0.2 ? "STRETCH" : "CENTER";
    } else {
      vertical = distT <= distB ? "MIN" : "MAX";
    }
    return { horizontal, vertical };
  }
  function mapFlexDirection(direction) {
    if (direction === "column" || direction === "column-reverse") return "VERTICAL";
    return "HORIZONTAL";
  }
  function mapJustifyContent(value) {
    switch (value) {
      case "center":
        return "CENTER";
      case "flex-end":
      case "end":
        return "MAX";
      case "space-between":
        return "SPACE_BETWEEN";
      case "space-around":
      case "space-evenly":
        return "SPACE_BETWEEN";
      default:
        return "MIN";
    }
  }
  function mapAlignItems(value) {
    switch (value) {
      case "center":
        return "CENTER";
      case "flex-end":
      case "end":
        return "MAX";
      case "baseline":
        return "BASELINE";
      default:
        return "MIN";
    }
  }
  function flipAlignment(align) {
    if (align === "MIN") return "MAX";
    if (align === "MAX") return "MIN";
    return align;
  }

  // third-party/html2figma-plugin/upstream/packages/adapter/figma/styleMapper.ts
  function colorToFigmaRGB(color) {
    return {
      r: color.r / 255,
      g: color.g / 255,
      b: color.b / 255
    };
  }
  function colorToFigmaRGBA(color) {
    return {
      r: color.r / 255,
      g: color.g / 255,
      b: color.b / 255,
      a: color.a
    };
  }
  function mapBlendMode(cssBlendMode) {
    const map = {
      "normal": "NORMAL",
      "multiply": "MULTIPLY",
      "screen": "SCREEN",
      "overlay": "OVERLAY",
      "darken": "DARKEN",
      "lighten": "LIGHTEN",
      "color-dodge": "COLOR_DODGE",
      "color-burn": "COLOR_BURN",
      "hard-light": "HARD_LIGHT",
      "soft-light": "SOFT_LIGHT",
      "difference": "DIFFERENCE",
      "exclusion": "EXCLUSION",
      "hue": "HUE",
      "saturation": "SATURATION",
      "color": "COLOR",
      "luminosity": "LUMINOSITY"
    };
    return map[cssBlendMode] || "NORMAL";
  }
  function mapBackgroundToFills(background) {
    const fills = [];
    for (const layer of background.layers) {
      const paint = mapBackgroundLayerToPaint(layer);
      if (paint) fills.push(paint);
    }
    return fills;
  }
  function mapBackgroundLayerToPaint(layer) {
    switch (layer.type) {
      case "color": {
        if (layer.color.a === 0) return null;
        return {
          type: "SOLID",
          color: colorToFigmaRGB(layer.color),
          opacity: layer.color.a,
          visible: true
        };
      }
      case "linear-gradient": {
        const stops = mapGradientStops(layer.stops);
        if (stops.length < 2) return null;
        return {
          type: "GRADIENT_LINEAR",
          gradientStops: stops,
          gradientTransform: calculateLinearGradientTransform(layer.angle),
          visible: true
        };
      }
      case "radial-gradient": {
        const stops = mapGradientStops(layer.stops);
        if (stops.length < 2) return null;
        return {
          type: "GRADIENT_RADIAL",
          gradientStops: stops,
          gradientTransform: calculateRadialGradientTransform(layer.position),
          visible: true
        };
      }
      case "conic-gradient": {
        const stops = mapGradientStops(layer.stops);
        if (stops.length < 2) return null;
        return {
          type: "GRADIENT_ANGULAR",
          gradientStops: stops,
          gradientTransform: [
            [0.5, 0, 0.5],
            [0, 0.5, 0.5]
          ],
          visible: true
        };
      }
      case "image": {
        return {
          type: "IMAGE",
          scaleMode: mapBackgroundSizeToScaleMode(layer.size, layer.repeat),
          visible: true,
          _pendingImageUrl: layer.url,
          _imageMetadata: {
            originalUrl: layer.url,
            ...layer.base64 ? { base64: layer.base64 } : {}
          }
        };
      }
      default:
        return null;
    }
  }
  function mapGradientStops(stops) {
    return stops.map((stop) => ({
      position: Math.max(0, Math.min(1, stop.position)),
      color: colorToFigmaRGBA(stop.color)
    }));
  }
  function calculateLinearGradientTransform(angleDeg) {
    const mathAngleDeg = 90 - angleDeg;
    const angleRad = mathAngleDeg * (Math.PI / 180);
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    return [
      [cos, -sin, 0.5 - cos / 2 + sin / 2],
      [sin, cos, 0.5 - sin / 2 - cos / 2]
    ];
  }
  function calculateRadialGradientTransform(position) {
    const cx = position.x;
    const cy = position.y;
    const fcx = Math.max(cx, 1 - cx);
    const fcy = Math.max(cy, 1 - cy);
    const SQRT2 = Math.SQRT2;
    const semiX = fcx > 0 ? SQRT2 * fcx : 0.5;
    const semiY = fcy > 0 ? SQRT2 * fcy : 0.5;
    const sx = 0.5 / semiX;
    const sy = 0.5 / semiY;
    const tx = 0.5 - sx * cx;
    const ty = 0.5 - sy * cy;
    return [
      [sx, 0, tx],
      [0, sy, ty]
    ];
  }
  function mapBackgroundSizeToScaleMode(size, repeat) {
    if (size === "cover") return "FILL";
    if (size === "contain") return "FIT";
    if (repeat === "repeat") return "TILE";
    if (size === "auto") return "CROP";
    if (typeof size === "object") return "CROP";
    return "FILL";
  }
  function mapBorderToStrokes(border) {
    const result = {};
    const colorsMatch = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
    const allSame = border.top.width === border.right.width && border.right.width === border.bottom.width && border.bottom.width === border.left.width && border.top.style === border.right.style && border.right.style === border.bottom.style && border.bottom.style === border.left.style && colorsMatch(border.top.color, border.right.color) && colorsMatch(border.right.color, border.bottom.color) && colorsMatch(border.bottom.color, border.left.color);
    const hasBorder = border.top.width > 0 || border.right.width > 0 || border.bottom.width > 0 || border.left.width > 0;
    const allTransparent = border.top.color.a === 0 && border.right.color.a === 0 && border.bottom.color.a === 0 && border.left.color.a === 0;
    if (hasBorder && !allTransparent) {
      const primarySide = [border.top, border.right, border.bottom, border.left].find((s) => s.width > 0);
      if (primarySide) {
        result.strokes = [{
          type: "SOLID",
          color: colorToFigmaRGB(primarySide.color),
          opacity: primarySide.color.a,
          visible: true
        }];
        if (allSame) {
          result.strokeWeight = border.top.width;
        } else {
          result.strokeTopWeight = border.top.width;
          result.strokeRightWeight = border.right.width;
          result.strokeBottomWeight = border.bottom.width;
          result.strokeLeftWeight = border.left.width;
        }
        result.strokeAlign = "INSIDE";
        const sw = allSame ? border.top.width : primarySide.width;
        if (primarySide.style === "dashed") result.strokeDashPattern = [sw * 3, sw];
        else if (primarySide.style === "dotted") result.strokeDashPattern = [sw, sw];
      }
    }
    const { topLeft, topRight, bottomRight, bottomLeft } = border.radius;
    const allSameRadius = topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft;
    if (allSameRadius && topLeft > 0) {
      result.cornerRadius = topLeft;
    } else if (topLeft > 0 || topRight > 0 || bottomRight > 0 || bottomLeft > 0) {
      result.topLeftRadius = topLeft;
      result.topRightRadius = topRight;
      result.bottomRightRadius = bottomRight;
      result.bottomLeftRadius = bottomLeft;
    }
    return result;
  }
  function mapGradientBorderToStrokes(layers, border) {
    if (!layers || layers.length === 0) return null;
    const strokes = [];
    for (const layer of layers) {
      const paint = mapBackgroundLayerToPaint(layer);
      if (paint) strokes.push(paint);
    }
    if (strokes.length === 0) return null;
    const strokeWeight = Math.max(border.top.width, border.right.width, border.bottom.width, border.left.width);
    return {
      strokes,
      strokeWeight,
      strokeAlign: "INSIDE"
    };
  }
  function mapEffects(effects) {
    const result = [];
    for (const shadow of effects.boxShadows) {
      if (shadow.inset) {
        result.push({
          type: "INNER_SHADOW",
          visible: true,
          color: colorToFigmaRGBA(shadow.color),
          blendMode: "NORMAL",
          offset: { x: shadow.offsetX, y: shadow.offsetY },
          radius: shadow.blurRadius,
          spread: shadow.spreadRadius
        });
      } else {
        result.push({
          type: "DROP_SHADOW",
          visible: true,
          color: colorToFigmaRGBA(shadow.color),
          blendMode: "NORMAL",
          offset: { x: shadow.offsetX, y: shadow.offsetY },
          radius: shadow.blurRadius,
          spread: shadow.spreadRadius,
          // CSS box-shadow only renders behind the element's own painted area,
          // never bleeding through to child content. Figma's default (true)
          // shows shadow behind transparent areas of the frame, causing
          // shadows to visually "leak" into children — inconsistent with CSS.
          showShadowBehindNode: false
        });
      }
    }
    if (effects.filters) {
      for (const filter of effects.filters) {
        if (filter.type === "blur" && typeof filter.value === "number") {
          result.push({
            type: "LAYER_BLUR",
            visible: true,
            radius: filter.value
          });
        } else if (filter.type === "drop-shadow" && typeof filter.value === "string") {
          const shadow = parseDropShadowFilter(filter.value);
          if (shadow) {
            result.push(shadow);
          }
        }
      }
    }
    if (effects.backdropFilters) {
      for (const filter of effects.backdropFilters) {
        if (filter.type === "blur" && typeof filter.value === "number") {
          result.push({
            type: "BACKGROUND_BLUR",
            visible: true,
            radius: filter.value
          });
        }
      }
    }
    return result;
  }
  function parseDropShadowFilter(value) {
    const tokens = [];
    let current = "";
    let depth = 0;
    for (const char of value) {
      if (char === "(") {
        depth++;
        current += char;
      } else if (char === ")") {
        depth--;
        current += char;
      } else if (char === " " && depth === 0) {
        if (current.trim()) tokens.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current.trim()) tokens.push(current.trim());
    const lengths = [];
    let colorStr = "";
    for (const token of tokens) {
      if (token.match(/^-?[\d.]+px$/) || token.match(/^-?[\d.]+$/)) {
        lengths.push(parseFloat(token));
      } else {
        colorStr += (colorStr ? " " : "") + token;
      }
    }
    if (lengths.length < 2) return null;
    let color = { r: 0, g: 0, b: 0, a: 0.25 };
    if (colorStr) {
      const rgbaMatch = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
      if (rgbaMatch) {
        color = {
          r: parseInt(rgbaMatch[1]) / 255,
          g: parseInt(rgbaMatch[2]) / 255,
          b: parseInt(rgbaMatch[3]) / 255,
          a: rgbaMatch[4] !== void 0 ? parseFloat(rgbaMatch[4]) : 1
        };
      }
    }
    return {
      type: "DROP_SHADOW",
      visible: true,
      color,
      blendMode: "NORMAL",
      offset: { x: lengths[0], y: lengths[1] },
      radius: lengths[2] || 0,
      spread: 0
    };
  }

  // third-party/html2figma-plugin/upstream/packages/adapter/figma/textMapper.ts
  function mapTextStyle(textStyle) {
    const props = {};
    props.fontName = mapFontName(textStyle.fontFamily, textStyle.fontWeight, textStyle.fontStyle);
    props.fontSize = Math.max(textStyle.fontSize, 8);
    props.fontWeight = textStyle.fontWeight;
    if (textStyle.gradientFill && textStyle.gradientFill.length > 0) {
      props.fills = mapBackgroundToFills({ layers: textStyle.gradientFill });
    } else if (textStyle.color && textStyle.color.a > 0) {
      props.fills = [{
        type: "SOLID",
        color: colorToFigmaRGB(textStyle.color),
        opacity: textStyle.color.a,
        visible: true
      }];
    }
    props.textAlignHorizontal = mapTextAlign(textStyle.textAlign);
    const lineHeight = mapLineHeight(textStyle.lineHeight);
    if (lineHeight) props.lineHeight = lineHeight;
    const letterSpacing = mapLetterSpacing(textStyle.letterSpacing, textStyle.fontSize);
    if (letterSpacing) props.letterSpacing = letterSpacing;
    props.textDecoration = mapTextDecoration(textStyle.textDecoration);
    const textCase = mapTextCase(textStyle.textTransform);
    if (textCase !== "ORIGINAL") props.textCase = textCase;
    const hasTruncation = textStyle.textOverflow === "ellipsis" && textStyle.whiteSpace === "nowrap" || textStyle.maxLines != null && textStyle.maxLines > 0;
    if (hasTruncation) {
      props.textTruncation = "ENDING";
      if (textStyle.maxLines != null && textStyle.maxLines > 0) {
        props.maxLines = textStyle.maxLines;
      }
      props.textAutoResize = "HEIGHT";
    } else {
      props.textAutoResize = "WIDTH_AND_HEIGHT";
    }
    return props;
  }
  function mapStyledSegments(segments, baseStyle) {
    return segments.map((seg) => {
      const figmaSeg = {
        start: seg.start,
        end: seg.end
      };
      const style = seg.style;
      const fontName = mapFontName(style.fontFamily, style.fontWeight, style.fontStyle);
      const baseFontName = mapFontName(baseStyle.fontFamily, baseStyle.fontWeight, baseStyle.fontStyle);
      if (fontName.family !== baseFontName.family || fontName.style !== baseFontName.style) {
        figmaSeg.fontName = fontName;
      }
      if (style.fontSize !== baseStyle.fontSize) {
        figmaSeg.fontSize = Math.max(style.fontSize, 8);
      }
      if (style.fontWeight !== baseStyle.fontWeight) {
        figmaSeg.fontWeight = style.fontWeight;
      }
      if (style.gradientFill && style.gradientFill.length > 0) {
        figmaSeg.fills = mapBackgroundToFills({ layers: style.gradientFill });
      } else if (style.color && (style.color.r !== baseStyle.color.r || style.color.g !== baseStyle.color.g || style.color.b !== baseStyle.color.b || style.color.a !== baseStyle.color.a)) {
        figmaSeg.fills = [{
          type: "SOLID",
          color: colorToFigmaRGB(style.color),
          opacity: style.color.a,
          visible: true
        }];
      }
      const decoration = mapTextDecoration(style.textDecoration);
      const baseDecoration = mapTextDecoration(baseStyle.textDecoration);
      if (decoration !== baseDecoration) {
        figmaSeg.textDecoration = decoration;
      }
      const lh = mapLineHeight(style.lineHeight);
      const baseLh = mapLineHeight(baseStyle.lineHeight);
      if (lh && (!baseLh || lh.value !== baseLh.value || lh.unit !== baseLh.unit)) {
        figmaSeg.lineHeight = lh;
      }
      const ls = mapLetterSpacing(style.letterSpacing, style.fontSize);
      const baseLs = mapLetterSpacing(baseStyle.letterSpacing, baseStyle.fontSize);
      if (ls && (!baseLs || ls.value !== baseLs.value)) {
        figmaSeg.letterSpacing = ls;
      }
      if (seg.href) {
        figmaSeg.hyperlink = { type: "URL", value: seg.href };
      }
      return figmaSeg;
    });
  }
  function mapFontName(family, weight, style) {
    const cleanFamily = family.split(",")[0].trim().replace(/['"]/g, "");
    const familyMap = {
      "sans-serif": "Inter",
      "serif": "Times New Roman",
      "monospace": "Monaco",
      "system-ui": "Inter",
      "-apple-system": "Inter"
    };
    const resolvedFamily = familyMap[cleanFamily.toLowerCase()] || cleanFamily || "Inter";
    const numericWeight = typeof weight === "string" ? parseInt(weight, 10) || 400 : weight;
    const isItalic = style === "italic" || style === "oblique";
    const iconFontStyle = mapIconFontStyle(resolvedFamily, numericWeight);
    if (iconFontStyle) return { family: resolvedFamily, style: iconFontStyle };
    let figmaStyle = "Regular";
    if (numericWeight >= 700) figmaStyle = isItalic ? "Bold Italic" : "Bold";
    else if (numericWeight >= 600) figmaStyle = isItalic ? "Semi Bold Italic" : "Semi Bold";
    else if (numericWeight >= 500) figmaStyle = isItalic ? "Medium Italic" : "Medium";
    else if (numericWeight <= 300) figmaStyle = isItalic ? "Light Italic" : "Light";
    else figmaStyle = isItalic ? "Italic" : "Regular";
    return { family: resolvedFamily, style: figmaStyle };
  }
  function mapIconFontStyle(family, weight) {
    const lf = family.toLowerCase();
    if (lf.includes("font awesome")) {
      if (lf.includes("brands")) return "Regular";
      if (weight >= 900) return "Solid";
      return "Regular";
    }
    if (lf.includes("material icons") || lf.includes("material symbols")) {
      return "Regular";
    }
    return void 0;
  }
  function mapTextAlign(align) {
    switch (align) {
      case "center":
        return "CENTER";
      case "right":
        return "RIGHT";
      case "justify":
        return "JUSTIFIED";
      default:
        return "LEFT";
    }
  }
  function mapLineHeight(lh) {
    if (lh.unit === "normal" || lh.value === 0) return void 0;
    if (lh.unit === "px") return { value: lh.value, unit: "PIXELS" };
    if (lh.unit === "%") return { value: lh.value, unit: "PERCENT" };
    return void 0;
  }
  function mapLetterSpacing(ls, fontSize = 16) {
    if (ls.value === 0) return void 0;
    if (ls.unit === "px") return { value: ls.value, unit: "PIXELS" };
    if (ls.unit === "em") return { value: ls.value * fontSize, unit: "PIXELS" };
    return void 0;
  }
  function mapTextCase(transform) {
    switch (transform) {
      case "uppercase":
        return "UPPER";
      case "lowercase":
        return "LOWER";
      case "capitalize":
        return "TITLE";
      default:
        return "ORIGINAL";
    }
  }
  function mapTextDecoration(dec) {
    switch (dec) {
      case "underline":
        return "UNDERLINE";
      case "line-through":
        return "STRIKETHROUGH";
      default:
        return "NONE";
    }
  }

  // third-party/html2figma-plugin/upstream/packages/adapter/figma/nodeMapper.ts
  function mapSemanticToPluginData(semantic) {
    const data = {
      semanticId: semantic.semanticId
    };
    if (semantic.classList && semantic.classList.length > 0) {
      data.classList = JSON.stringify(semantic.classList);
    }
    if (semantic.cssSelector) {
      data.cssSelector = semantic.cssSelector;
    }
    if (semantic.component) {
      data.component = JSON.stringify(semantic.component);
    }
    if (semantic.sourceLocation) {
      data.sourceLocation = JSON.stringify(semantic.sourceLocation);
    }
    if (semantic.attributes) {
      data.attributes = JSON.stringify(semantic.attributes);
    }
    return data;
  }
  function mapDesignNodeToFigma(node) {
    let figmaNode;
    switch (node.nodeType) {
      case "container":
        figmaNode = mapContainer(node);
        break;
      case "text":
        figmaNode = mapText(node);
        break;
      case "image":
        figmaNode = mapImage(node);
        break;
      case "svg":
        figmaNode = mapSVG(node);
        break;
      default: {
        const _exhaustive = node;
        throw new Error(`Unknown node type: ${_exhaustive.nodeType}`);
      }
    }
    if (node.semantic) {
      figmaNode.sharedPluginData = mapSemanticToPluginData(node.semantic);
      figmaNode.sharedPluginData.tag = node.tag;
      if (node.role) figmaNode.sharedPluginData.role = node.role;
    }
    return figmaNode;
  }
  function mapContainer(node) {
    const layoutProps = mapLayout(node.layout);
    if (layoutProps.counterAxisAlignItems === "BASELINE" && node.children.length >= 2) {
      const flowChildren = node.children.filter(
        (ch) => ch.positioning?.mode !== "absolute" && ch.positioning?.mode !== "fixed"
      );
      if (flowChildren.length >= 2) {
        const heights = flowChildren.map((ch) => Math.round(ch.bounds.height));
        const allSameHeight = heights.every((h) => h === heights[0]);
        if (allSameHeight) {
          layoutProps.counterAxisAlignItems = "CENTER";
        }
      }
    }
    if (layoutProps.layoutMode === "VERTICAL" && node.children.length >= 2) {
      const flowChildren = node.children.filter(
        (ch) => ch.positioning?.mode !== "absolute" && ch.positioning?.mode !== "fixed"
      );
      if (flowChildren.length >= 2) {
        const bandTop = Math.max(...flowChildren.map((ch) => ch.bounds.y));
        const bandBottom = Math.min(...flowChildren.map((ch) => ch.bounds.y + ch.bounds.height));
        const allOverlapVertically = bandBottom > bandTop;
        const sorted = [...flowChildren].sort((a, b) => a.bounds.x - b.bounds.x);
        const leftToRight = sorted.every(
          (ch, i) => i === 0 || ch.bounds.x >= sorted[i - 1].bounds.x + sorted[i - 1].bounds.width - 2
        );
        if (allOverlapVertically && leftToRight) {
          layoutProps.layoutMode = "HORIZONTAL";
          layoutProps.primaryAxisSizingMode = "FIXED";
          layoutProps.counterAxisSizingMode = "FIXED";
        }
      }
    }
    if (layoutProps.layoutMode === "HORIZONTAL" && node.children.length >= 2) {
      const wrapFlowChildren = node.children.filter(
        (ch) => ch.positioning?.mode !== "absolute" && ch.positioning?.mode !== "fixed"
      );
      let hasWrap = false;
      for (let i = 1; i < wrapFlowChildren.length; i++) {
        const prev = wrapFlowChildren[i - 1].bounds;
        const curr = wrapFlowChildren[i].bounds;
        if (curr.x < prev.x + prev.width - 1 && curr.y > prev.y + 1) {
          hasWrap = true;
          break;
        }
      }
      if (hasWrap) {
        layoutProps.layoutWrap = "WRAP";
      } else if (layoutProps.layoutWrap === "WRAP") {
        layoutProps.layoutWrap = "NO_WRAP";
      }
    }
    if (layoutProps.layoutWrap === "WRAP" && node.children.length >= 2) {
      const flowChildren = node.children.filter(
        (ch) => ch.positioning?.mode !== "absolute" && ch.positioning?.mode !== "fixed"
      );
      const sorted = [...flowChildren].sort((a, b) => a.bounds.y - b.bounds.y);
      const firstY = sorted[0]?.bounds.y ?? 0;
      const firstRowItems = sorted.filter((ch) => Math.abs(ch.bounds.y - firstY) < 3);
      const firstRowBottom = Math.max(...firstRowItems.map((ch) => ch.bounds.y + ch.bounds.height));
      const secondRowItem = sorted.find((ch) => ch.bounds.y > firstY + 3);
      if (secondRowItem) {
        const rowGap = Math.max(0, Math.round(secondRowItem.bounds.y - firstRowBottom));
        layoutProps.counterAxisSpacing = rowGap;
      }
    }
    if (layoutProps.primaryAxisAlignItems === "SPACE_BETWEEN") {
      const flowCount = node.children.filter(
        (ch) => ch.positioning?.mode !== "absolute" && ch.positioning?.mode !== "fixed"
      ).length;
      if (flowCount <= 1) {
        const dir = node.layout.flex?.direction;
        const isReversed = dir === "row-reverse" || dir === "column-reverse";
        layoutProps.primaryAxisAlignItems = isReversed ? "MAX" : "MIN";
      }
    }
    if (layoutProps.primaryAxisAlignItems === "MIN" && layoutProps.layoutMode === "HORIZONTAL") {
      if (isCenteredByPosition(node)) {
        layoutProps.primaryAxisAlignItems = "CENTER";
      } else if (isRightAlignedByPosition(node)) {
        layoutProps.primaryAxisAlignItems = "MAX";
      }
    }
    if (layoutProps.counterAxisAlignItems === "MIN" && layoutProps.layoutMode === "VERTICAL") {
      if (isCenteredByPosition(node)) {
        layoutProps.counterAxisAlignItems = "CENTER";
      } else if (isRightAlignedByPosition(node)) {
        layoutProps.counterAxisAlignItems = "MAX";
      }
    }
    if (layoutProps.layoutMode === "HORIZONTAL" && (node.name === "inline-group" || node.layout.display === "inline")) {
      layoutProps.counterAxisSizingMode = "AUTO";
    }
    const positionProps = mapPositioning(node.positioning);
    const normalBorderProps = mapBorderToStrokes(node.border);
    const gradientStrokeProps = node.borderGradientLayers ? mapGradientBorderToStrokes(node.borderGradientLayers, node.border) : null;
    const borderProps = gradientStrokeProps ? { ...normalBorderProps, ...gradientStrokeProps } : normalBorderProps;
    const fills = mapBackgroundToFills(node.background);
    const effects = mapEffects(node.effects);
    const W = node.bounds.width;
    const H = node.bounds.height;
    if (W > 0 && H > 0) {
      for (let i = 0; i < fills.length && i < node.background.layers.length; i++) {
        const layer = node.background.layers[i];
        const fill = fills[i];
        if (layer.type === "radial-gradient" && fill?.type === "GRADIENT_RADIAL" && layer.shape === "circle" && fill.gradientTransform) {
          const cx = layer.position.x;
          const cy = layer.position.y;
          const fcxPx = Math.max(cx * W, (1 - cx) * W);
          const fcyPx = Math.max(cy * H, (1 - cy) * H);
          const R = Math.sqrt(fcxPx * fcxPx + fcyPx * fcyPx);
          if (R > 0) {
            const sx = 0.5 * W / R;
            const sy = 0.5 * H / R;
            fill.gradientTransform = [
              [sx, 0, 0.5 - sx * cx],
              [0, sy, 0.5 - sy * cy]
            ];
          }
        }
      }
    }
    for (let i = 0; i < fills.length && i < node.background.layers.length; i++) {
      const layer = node.background.layers[i];
      const fill = fills[i];
      if (layer.type === "image" && fill?.type === "IMAGE" && fill._imageMetadata) {
        const imgLayer = layer;
        if (isSvgDataUri(imgLayer.url) || isSvgUrl(imgLayer.url)) {
          fill._imageMetadata.isSvg = true;
          const decoded = decodeSvgDataUri(imgLayer.url);
          if (decoded) fill._imageMetadata.svgContent = decoded;
        }
        if (W > 0 && H > 0 && typeof imgLayer.size === "object" && imgLayer.repeat !== "repeat" && imgLayer.position) {
          const transform = calculateImageTransform(W, H, imgLayer.size.width, imgLayer.size.height, imgLayer.position);
          if (transform) {
            fill._imageMetadata.imageTransform = transform;
            fill._imageMetadata.scaleMode = "CROP";
            fill.scaleMode = "CROP";
          }
        }
        if (typeof imgLayer.size === "object" && imgLayer.repeat === "repeat") {
          fill._imageMetadata.tileSize = { width: imgLayer.size.width, height: imgLayer.size.height };
          fill._imageMetadata.scaleMode = "TILE";
        }
      }
    }
    let bgClipChild = null;
    if (node.backgroundClip && node.backgroundClip !== "border-box" && fills.length > 0) {
      const bTop = node.border.top.width;
      const bRight = node.border.right.width;
      const bBottom = node.border.bottom.width;
      const bLeft = node.border.left.width;
      const pTop = node.backgroundClip === "content-box" ? node.layout.padding.top : 0;
      const pRight = node.backgroundClip === "content-box" ? node.layout.padding.right : 0;
      const pBottom = node.backgroundClip === "content-box" ? node.layout.padding.bottom : 0;
      const pLeft = node.backgroundClip === "content-box" ? node.layout.padding.left : 0;
      const insetL = bLeft + pLeft;
      const insetT = bTop + pTop;
      const clipW = Math.round(W - insetL - bRight - pRight);
      const clipH = Math.round(H - insetT - bBottom - pBottom);
      const radius = borderProps.cornerRadius ?? 0;
      const innerRadius = Math.max(0, radius - insetL);
      if (clipW > 0 && clipH > 0) {
        bgClipChild = {
          id: node.id + "_bgclip",
          name: "_bg-clip",
          type: "FRAME",
          visible: true,
          locked: true,
          x: Math.round(insetL),
          y: Math.round(insetT),
          width: clipW,
          height: clipH,
          opacity: 1,
          children: [],
          fills,
          clipsContent: true,
          layoutPositioning: "ABSOLUTE",
          ...innerRadius > 0 ? { cornerRadius: innerRadius } : {}
        };
      }
    }
    if (borderProps.strokeAlign === "INSIDE") {
      const bTop = node.border.top.width;
      const bRight = node.border.right.width;
      const bBottom = node.border.bottom.width;
      const bLeft = node.border.left.width;
      if (bTop > 0 || bRight > 0 || bBottom > 0 || bLeft > 0) {
        if (layoutProps.paddingTop !== void 0) layoutProps.paddingTop += bTop;
        if (layoutProps.paddingRight !== void 0) layoutProps.paddingRight += bRight;
        if (layoutProps.paddingBottom !== void 0) layoutProps.paddingBottom += bBottom;
        if (layoutProps.paddingLeft !== void 0) layoutProps.paddingLeft += bLeft;
      }
    }
    const children = mapContainerChildren(node);
    const syntheticChildren = /* @__PURE__ */ new Set();
    if (bgClipChild) {
      children.unshift(bgClipChild);
      syntheticChildren.add(bgClipChild);
    }
    if (layoutProps.primaryAxisSizingMode === "AUTO") {
      const flowChildrenHeight = node.children.filter((ch) => ch.positioning?.mode !== "absolute" && ch.positioning?.mode !== "fixed").reduce((sum, ch) => sum + ch.bounds.height, 0);
      const paddingV = (layoutProps.paddingTop || 0) + (layoutProps.paddingBottom || 0);
      const hugEstimate = flowChildrenHeight + paddingV;
      if (hugEstimate < node.bounds.height - 1) {
        layoutProps.primaryAxisSizingMode = "FIXED";
      }
    }
    const figmaNode = {
      id: node.id,
      name: node.name,
      type: "FRAME",
      visible: node.visible,
      locked: false,
      x: Math.round(node.bounds.x),
      y: Math.round(node.bounds.y),
      width: Math.round(node.bounds.width),
      height: Math.round(node.bounds.height),
      opacity: node.opacity,
      rotation: node.transform?.rotation != null ? -node.transform.rotation : void 0,
      children,
      // Layout
      ...layoutProps,
      // Containers with -webkit-line-clamp always need clipping — the CSS spec requires
      // overflow:hidden for line-clamp, but post-processors may change display from block
      // to flex, and the overflow may not propagate correctly through the pipeline.
      clipsContent: mapOverflow(node.overflow) || !!node.layout.lineClamp,
      // Positioning
      ...positionProps,
      // Visual — fills go to bgClipChild when background-clip is active
      fills: bgClipChild ? void 0 : fills.length > 0 ? fills : void 0,
      effects: effects.length > 0 ? effects : void 0,
      // Border
      ...borderProps
    };
    if (node.effects.blendMode && node.effects.blendMode !== "normal") {
      figmaNode.blendMode = mapBlendMode(node.effects.blendMode);
    }
    if (node.computedItemSpacing !== void 0 && node.computedItemSpacing !== 0) {
      figmaNode.itemSpacing = Math.round(node.computedItemSpacing);
    }
    const bgImageLayer = node.background.layers.find(
      (l) => l.type === "image"
    );
    if (bgImageLayer) {
      const meta = {
        originalUrl: bgImageLayer.url,
        ...bgImageLayer.base64 ? { base64: bgImageLayer.base64 } : {},
        ...isSvgDataUri(bgImageLayer.url) ? { isSvg: true, svgContent: decodeSvgDataUri(bgImageLayer.url) } : {}
      };
      if (typeof bgImageLayer.size === "object" && bgImageLayer.repeat !== "repeat") {
        const transform = calculateImageTransform(
          node.bounds.width,
          node.bounds.height,
          bgImageLayer.size.width,
          bgImageLayer.size.height,
          bgImageLayer.position
        );
        if (transform) {
          meta.imageTransform = transform;
          meta.scaleMode = "CROP";
        }
      }
      if (typeof bgImageLayer.size === "object" && bgImageLayer.repeat === "repeat") {
        meta.tileSize = { width: bgImageLayer.size.width, height: bgImageLayer.size.height };
        meta.scaleMode = "TILE";
      }
      const metaTarget = bgClipChild || figmaNode;
      metaTarget.imageMetadata = meta;
    }
    const childPairs = pairChildren(figmaNode, node, syntheticChildren);
    applyFlexChildSizing(childPairs, node);
    applyBlockChildSizing(childPairs, node);
    applyAbsoluteConstraints(childPairs, node);
    adjustTextInFlexContainer(figmaNode, node);
    const isFormTag = node.tag === "input" || node.tag === "select" || node.tag === "textarea";
    if (isFormTag && figmaNode.layoutMode === "HORIZONTAL") {
      const ta = node.layout.textAlign;
      figmaNode.primaryAxisAlignItems = ta === "center" ? "CENTER" : ta === "right" ? "MAX" : "MIN";
    }
    if (node.layout.lineClamp && figmaNode.children) {
      clampDescendantHeights(figmaNode.children, figmaNode.height);
    }
    for (const { design: dn, figma: fc } of childPairs) {
      if (dn.positioning?.mode === "absolute" || dn.positioning?.mode === "fixed") continue;
      if (dn.bounds.width === 0 && dn.bounds.height === 0) {
        fc.visible = false;
      }
    }
    return figmaNode;
  }
  function isCenteredByPosition(node) {
    const flowChildren = node.children.filter(
      (ch) => ch.positioning?.mode !== "absolute" && ch.positioning?.mode !== "fixed"
    );
    if (flowChildren.length === 0 || node.bounds.width <= 0) return false;
    const padL = node.layout.padding.left;
    const padR = node.layout.padding.right;
    const innerW = node.bounds.width - padL - padR;
    const contentLeft = Math.min(...flowChildren.map((ch) => ch.bounds.x)) - padL;
    const contentRight = Math.max(...flowChildren.map((ch) => ch.bounds.x + ch.bounds.width)) - padL;
    const spaceLeft = contentLeft;
    const spaceRight = innerW - contentRight;
    return spaceLeft > 5 && spaceRight > 5 && Math.abs(spaceLeft - spaceRight) < Math.max(5, innerW * 0.05);
  }
  function isRightAlignedByPosition(node) {
    const flowChildren = node.children.filter(
      (ch) => ch.positioning?.mode !== "absolute" && ch.positioning?.mode !== "fixed"
    );
    if (flowChildren.length === 0 || node.bounds.width <= 0) return false;
    const padL = node.layout.padding.left;
    const padR = node.layout.padding.right;
    const innerW = node.bounds.width - padL - padR;
    if (innerW <= 0) return false;
    const contentLeft = Math.min(...flowChildren.map((ch) => ch.bounds.x)) - padL;
    const contentRight = Math.max(...flowChildren.map((ch) => ch.bounds.x + ch.bounds.width)) - padL;
    const contentW = contentRight - contentLeft;
    const spaceLeft = contentLeft;
    const spaceRight = innerW - contentRight;
    return spaceRight < 5 && spaceLeft > Math.max(10, innerW * 0.1) && contentW < innerW * 0.85;
  }
  function mapContainerChildren(node) {
    const mapped = node.children.map(mapDesignNodeToFigma);
    const dir = node.layout.flex?.direction;
    if (dir === "row-reverse" || dir === "column-reverse") {
      mapped.reverse();
    }
    return mapped;
  }
  function pairChildren(figmaNode, designNode, syntheticChildren) {
    if (!figmaNode.children) return [];
    const realFigmaChildren = figmaNode.children.filter((c) => !syntheticChildren.has(c));
    const dir = designNode.layout.flex?.direction;
    const isReversed = dir === "row-reverse" || dir === "column-reverse";
    const pairs = [];
    for (let i = 0; i < designNode.children.length; i++) {
      const figmaIdx = isReversed ? designNode.children.length - 1 - i : i;
      const fc = realFigmaChildren[figmaIdx];
      if (!fc) continue;
      pairs.push({ design: designNode.children[i], figma: fc });
    }
    return pairs;
  }
  function clampDescendantHeights(children, maxH) {
    for (const child of children) {
      if (child.layoutPositioning === "ABSOLUTE") continue;
      if (child.height > maxH) {
        child.height = maxH;
      }
      if (Array.isArray(child.children)) {
        clampDescendantHeights(child.children, maxH);
      }
    }
  }
  function applyAbsoluteConstraints(pairs, designNode) {
    const parentW = designNode.bounds.width;
    const parentH = designNode.bounds.height;
    if (parentW <= 0 || parentH <= 0) return;
    for (const { design: child, figma: figmaChild } of pairs) {
      if (child.positioning?.mode !== "absolute" && child.positioning?.mode !== "fixed") continue;
      if (figmaChild.constraints) continue;
      figmaChild.constraints = inferConstraints(child.bounds, { width: parentW, height: parentH });
    }
  }
  function applyBlockChildSizing(pairs, designNode) {
    const display = designNode.layout.display;
    if (display === "flex" || display === "inline-flex" || display === "grid" || display === "inline-grid") return;
    for (const { design: childDesign, figma: childFigma } of pairs) {
      if (childDesign.positioning?.mode === "absolute" || childDesign.positioning?.mode === "fixed") continue;
      if (childFigma.type === "TEXT" && childDesign.bounds.width > designNode.bounds.width * 0.95) {
        childFigma.layoutSizingHorizontal = "FILL";
      }
      if (childFigma.type === "FRAME" && childDesign.nodeType === "container") {
        childFigma.layoutSizingHorizontal = "FILL";
      }
    }
  }
  function applyFlexChildSizing(pairs, designNode) {
    const isFlex = designNode.layout.display === "flex" || designNode.layout.display === "inline-flex";
    if (!isFlex) return;
    const dir = designNode.layout.flex?.direction;
    const isColumn = dir === "column" || dir === "column-reverse";
    const parentAlignItems = designNode.layout.flex?.alignItems || "stretch";
    for (const { design: childDesign, figma: childFigma } of pairs) {
      if (childDesign.positioning?.mode === "absolute" || childDesign.positioning?.mode === "fixed") continue;
      const flexItem = childDesign.flexItem;
      const effectiveAlignSelf = flexItem?.alignSelf || parentAlignItems;
      if (effectiveAlignSelf === "stretch") {
        if (isColumn) {
          childFigma.layoutSizingHorizontal = "FILL";
        } else {
          childFigma.layoutSizingVertical = "FILL";
        }
      } else if (childFigma.type === "FRAME") {
        if (isColumn) {
          childFigma.layoutSizingHorizontal = "HUG";
        } else {
          childFigma.layoutSizingVertical = "HUG";
        }
      }
      if (!isColumn && childFigma.type === "TEXT" && childDesign.nodeType === "text") {
        const textContent = childDesign.content;
        if (textContent && textContent.includes("\n")) {
          childFigma.layoutSizingHorizontal = "FILL";
        }
      }
      if (!flexItem) continue;
      if (typeof flexItem.basis === "number" && flexItem.grow === 0) {
        if (isColumn) {
          childFigma.height = Math.round(childDesign.bounds.height);
          childFigma.layoutSizingVertical = "FIXED";
        } else {
          childFigma.width = Math.round(childDesign.bounds.width);
          childFigma.layoutSizingHorizontal = "FIXED";
        }
      }
      if (flexItem.grow > 0) {
        if (isColumn) {
          childFigma.layoutSizingVertical = "FILL";
        } else {
          childFigma.layoutSizingHorizontal = "FILL";
        }
        childFigma.layoutGrow = flexItem.grow;
      }
      if (flexItem.alignSelf) {
        const alignMap = {
          "flex-start": "MIN",
          "start": "MIN",
          "flex-end": "MAX",
          "end": "MAX",
          "center": "CENTER",
          "stretch": "STRETCH"
        };
        const mapped = alignMap[flexItem.alignSelf];
        if (mapped) {
          childFigma.layoutAlign = mapped;
        }
      }
    }
  }
  function adjustTextInFlexContainer(figmaNode, designNode) {
    if (!figmaNode.children) return;
    const isFlex = designNode.layout.display === "flex" || designNode.layout.display === "inline-flex";
    const isInline = designNode.layout.display === "inline";
    const dir = designNode.layout.flex?.direction;
    const isColumn = dir === "column" || dir === "column-reverse";
    const hAlign = isFlex ? isColumn ? designNode.layout.flex?.alignItems : designNode.layout.flex?.justifyContent : void 0;
    const textAlign = hAlign === "center" ? "CENTER" : hAlign === "flex-end" || hAlign === "end" ? "RIGHT" : void 0;
    const isFormElement = designNode.tag === "input" || designNode.tag === "select" || designNode.tag === "textarea";
    for (const child of figmaNode.children) {
      if (child.type !== "TEXT") continue;
      const t = child;
      if (isInline && !t.textTruncation) {
        t.layoutSizingHorizontal = "HUG";
        t.layoutSizingVertical = "HUG";
      } else if (t.textTruncation === "ENDING") {
        t.layoutSizingHorizontal = "FILL";
        t.layoutSizingVertical = "HUG";
      } else if (isFlex) {
        t.layoutSizingHorizontal = "HUG";
        t.layoutSizingVertical = "HUG";
      }
      if (textAlign && !isFormElement) {
        t.textAlignHorizontal = textAlign;
      }
    }
  }
  function mapText(node) {
    const textProps = mapTextStyle(node.textStyle);
    const positionProps = mapPositioning(node.positioning);
    let characters = node.content;
    if (textProps.maxLines != null && textProps.maxLines > 0) {
      const isRichTextMerge = node.styledSegments != null && node.styledSegments.length > 0;
      if (characters.includes("\n")) {
        characters = characters.replace(/\n/g, " ").replace(/  +/g, " ");
      } else if (!isRichTextMerge) {
        delete textProps.textTruncation;
        delete textProps.maxLines;
        textProps.textAutoResize = "WIDTH_AND_HEIGHT";
      }
    }
    const figmaNode = {
      ...positionProps,
      ...textProps,
      id: node.id,
      name: node.name,
      type: "TEXT",
      visible: node.visible,
      locked: false,
      x: Math.round(node.bounds.x),
      y: Math.round(node.bounds.y),
      width: Math.round(node.bounds.width),
      height: Math.round(node.bounds.height),
      opacity: node.opacity,
      rotation: node.transform?.rotation != null ? -node.transform.rotation : void 0,
      characters
    };
    if (node.positioning.mode === "absolute" && node.transform?.rotation) {
      figmaNode.constraints = { horizontal: "MAX", vertical: "CENTER" };
      figmaNode.textAlignVertical = "CENTER";
    }
    if (node.textStyle.textShadow && node.textStyle.textShadow.length > 0) {
      const effects = node.textStyle.textShadow.map((shadow) => ({
        type: "DROP_SHADOW",
        visible: true,
        color: colorToFigmaRGBA(shadow.color),
        blendMode: "NORMAL",
        offset: { x: shadow.offsetX, y: shadow.offsetY },
        radius: shadow.blurRadius,
        spread: shadow.spreadRadius
      }));
      figmaNode.effects = effects;
    }
    if (node.listType) {
      figmaNode.listOptions = {
        type: node.listType === "ordered" ? "ORDERED" : "UNORDERED"
      };
    }
    if (node.styledSegments && node.styledSegments.length > 0) {
      figmaNode.styledTextSegments = mapStyledSegments(node.styledSegments, node.textStyle);
    }
    if (figmaNode.fills) {
      const imageFill = figmaNode.fills.find(
        (f) => f.type === "IMAGE" && !!f._imageMetadata
      );
      if (imageFill?._imageMetadata) {
        figmaNode.imageMetadata = {
          ...imageFill._imageMetadata,
          scaleMode: imageFill.scaleMode || "FILL"
        };
      }
    }
    return figmaNode;
  }
  function mapImage(node) {
    const positionProps = mapPositioning(node.positioning);
    const borderProps = mapBorderToStrokes(node.border);
    const effects = mapEffects(node.effects);
    const scaleModeMap = {
      "fill": "FILL",
      "contain": "FIT",
      "cover": "FILL",
      "none": "CROP",
      "scale-down": "FIT"
    };
    const scaleMode = scaleModeMap[node.imageData.objectFit] || "FILL";
    const figmaNode = {
      ...positionProps,
      ...borderProps,
      id: node.id,
      name: node.name,
      type: "RECTANGLE",
      visible: node.visible,
      locked: false,
      x: Math.round(node.bounds.x),
      y: Math.round(node.bounds.y),
      width: Math.round(node.bounds.width),
      height: Math.round(node.bounds.height),
      opacity: node.opacity,
      rotation: node.transform?.rotation != null ? -node.transform.rotation : void 0,
      // Image as fill — include base64 if browser captured it, otherwise pending URL for async fetch
      fills: [{
        type: "IMAGE",
        scaleMode,
        visible: true,
        _pendingImageUrl: node.imageData.src,
        _imageMetadata: {
          originalUrl: node.imageData.src,
          width: node.imageData.width,
          height: node.imageData.height,
          ...node.imageData.base64 ? { base64: node.imageData.base64 } : {}
        }
      }],
      effects: effects.length > 0 ? effects : void 0
    };
    if (node.effects.blendMode && node.effects.blendMode !== "normal") {
      figmaNode.blendMode = mapBlendMode(node.effects.blendMode);
    }
    if (node.imageData.src) {
      const isSvg = isSvgDataUri(node.imageData.src) || isSvgUrl(node.imageData.src) || isSvgDataUri(node.imageData.base64 || "");
      const svgContent = isSvg ? decodeSvgDataUri(node.imageData.src) ?? decodeSvgDataUri(node.imageData.base64 || "") : void 0;
      figmaNode.imageMetadata = {
        originalUrl: node.imageData.src,
        width: node.imageData.width,
        height: node.imageData.height,
        ...node.imageData.base64 && !isSvg ? { base64: node.imageData.base64 } : {},
        ...isSvg ? { isSvg: true, ...svgContent ? { svgContent } : {} } : {}
      };
    }
    return figmaNode;
  }
  function isSvgDataUri(src) {
    return !!src && src.startsWith("data:image/svg");
  }
  function isSvgUrl(src) {
    if (!src) return false;
    const path = src.split("?")[0].split("#")[0];
    return path.endsWith(".svg") || path.endsWith(".svgz");
  }
  function decodeSvgDataUri(src) {
    if (!src.startsWith("data:image/svg")) return void 0;
    const commaIdx = src.indexOf(",");
    if (commaIdx === -1) return void 0;
    const meta = src.substring(0, commaIdx);
    const payload = src.substring(commaIdx + 1);
    if (meta.includes("base64")) {
      try {
        return atob(payload);
      } catch {
        return void 0;
      }
    }
    try {
      return decodeURIComponent(payload);
    } catch {
      return payload;
    }
  }
  function calculateImageTransform(nodeW, nodeH, imgW, imgH, position) {
    if (imgW <= 0 || imgH <= 0 || nodeW <= 0 || nodeH <= 0) return null;
    const posX = position.x <= 1 ? position.x * (nodeW - imgW) : position.x;
    const posY = position.y <= 1 ? position.y * (nodeH - imgH) : position.y;
    const sx = nodeW / imgW;
    const sy = nodeH / imgH;
    const tx = -posX / imgW;
    const ty = -posY / imgH;
    return [[sx, 0, tx], [0, sy, ty]];
  }
  function mapSVG(node) {
    const positionProps = mapPositioning(node.positioning);
    const borderProps = node.border ? mapBorderToStrokes(node.border) : {};
    const effects = node.effects ? mapEffects(node.effects) : [];
    const svgNode = {
      ...positionProps,
      id: node.id,
      name: node.name,
      type: "SVG",
      visible: node.visible,
      locked: false,
      x: Math.round(node.bounds.x),
      y: Math.round(node.bounds.y),
      width: Math.round(node.bounds.width),
      height: Math.round(node.bounds.height),
      opacity: node.opacity,
      rotation: node.transform?.rotation != null ? -node.transform.rotation : void 0,
      svgContent: node.svgContent,
      effects: effects.length > 0 ? effects : void 0,
      strokes: borderProps.strokes,
      strokeWeight: borderProps.strokeWeight,
      strokeAlign: borderProps.strokeAlign,
      cornerRadius: borderProps.cornerRadius
    };
    if (node.effects?.blendMode && node.effects.blendMode !== "normal") {
      svgNode.blendMode = mapBlendMode(node.effects.blendMode);
    }
    return svgNode;
  }

  // third-party/html2figma-plugin/upstream/packages/adapter/figma/FigmaAdapter.ts
  var FigmaAdapter = class {
    /**
     * Convert DesignNode DSL → FigmaNode JSON
     *
     * Produces a pure JSON tree that can be:
     * 1. Sent to the Figma plugin for rendering
     * 2. Serialized for storage/transmission
     * 3. Used for testing and comparison
     */
    static toFigmaJSON(designNode) {
      return mapDesignNodeToFigma(designNode);
    }
  };

  // apps/design-studio/app/grid.mjs
  var GRID_CONTAINER_FIELDS = Object.freeze([
    "gridRows",
    "gridColumnSizes",
    "gridRowSizes",
    "gridItemsPositioning",
    "gridAutoTracks"
  ]);
  var GRID_CHILD_FIELDS = Object.freeze([
    "gridRowAnchorIndex",
    "gridColumnAnchorIndex",
    "gridChildHorizontalAlign",
    "gridChildVerticalAlign"
  ]);

  // apps/design-studio/app/stroke.mjs
  var STROKE_SIDES = Object.freeze(["top", "right", "bottom", "left"]);

  // apps/design-studio/app/html-auto-margin-distribution.mjs
  var nonReplaced = new Set("div main header footer section article aside nav ul ol li h1 h2 h3 h4 h5 h6 p form figure figcaption".split(" "));

  // apps/design-studio/app/html-zero-flow-token.mjs
  var sides = ["top", "right", "bottom", "left"];
  var forbiddenTags = new Set("a area audio br button canvas details dialog embed fieldset hr iframe img input label legend link math meter object option optgroup output picture progress script select slot source style summary svg table template textarea track video wbr".split(" "));
  var geometryKeys = ["display", "position", "top", "right", "bottom", "left", "float", "clear", "width", "height", "min-width", "max-width", "min-height", "max-height", "font-family", "font-size", "line-height", "white-space", "writing-mode", "direction", "vertical-align", "transform", "translate", "rotate", "scale", "perspective", "zoom", "contain", "content-visibility", "counter-reset", "counter-increment", "counter-set", "content", "break-before", "break-after", "break-inside", ...sides.flatMap((side) => ["margin-" + side, "padding-" + side, "border-" + side + "-width"])];
  var tokenKeys = [...geometryKeys, "visibility", "opacity", "background-color", "background-image", "border-image-source", "box-shadow", "text-shadow", "outline-style", "filter", "backdrop-filter", "mix-blend-mode", "appearance", "resize", "clip-path", "mask-image", "-webkit-mask-image", "overflow-x", "overflow-y", "animation-name", "transition-duration"];

  // apps/design-studio/app/text-ranges.mjs
  var MAX_TEXT_RANGES = 64;
  var MAX_TEXT_RANGES_BYTES = 32 * 1024;

  // apps/design-studio/app/linear-gradient-geometry.mjs
  var object = (v) => v && typeof v === "object" && !Array.isArray(v);
  var finite = (v) => typeof v === "number" && Number.isFinite(v);
  var keys = (v, allowed) => {
    if (!object(v) || Object.keys(v).some((key) => !allowed.includes(key)))
      throw new Error("CSS \u6E10\u53D8\u51E0\u4F55\u5305\u542B\u672A\u77E5\u5B57\u6BB5");
  };
  function normalizeCssLinear(value, stops) {
    keys(value, ["direction", "positions", "sourceOnly"]);
    const direction = value.direction;
    keys(direction, ["angle", "corner"]);
    let normalized;
    if (Object.keys(direction).length !== 1) throw new Error("CSS \u6E10\u53D8\u65B9\u5411\u5FC5\u987B\u552F\u4E00");
    if (direction.angle !== void 0) {
      if (!finite(direction.angle) || direction.angle < 0 || direction.angle >= 360)
        throw new Error("CSS \u6E10\u53D8\u89D2\u5EA6\u5FC5\u987B\u4E3A 0\u2013360\uFF08\u4E0D\u542B 360\uFF09");
      normalized = { angle: direction.angle };
    } else {
      if (!Array.isArray(direction.corner) || direction.corner.length !== 2 || !Array.from(direction.corner).every((v) => v === -1 || v === 1))
        throw new Error("CSS \u6E10\u53D8\u89D2\u65B9\u5411\u5FC5\u987B\u4E3A\u4E24\u4E2A \xB11");
      normalized = { corner: [...direction.corner] };
    }
    if (value.sourceOnly !== void 0 && value.sourceOnly !== true)
      throw new Error("CSS \u6E10\u53D8 sourceOnly \u53EA\u80FD\u4E3A true");
    if (!Array.isArray(value.positions) || value.positions.length < 2 || value.positions.length > 16 || !value.sourceOnly && value.positions.length !== stops.length)
      throw new Error("CSS \u6E10\u53D8\u4F4D\u7F6E\u5FC5\u987B\u4E3A 2\u201316 \u9879\u4E14\u4E0E\u53EF\u7F16\u8F91\u8272\u6807\u5BF9\u5E94");
    const positions = Array.from(value.positions, (position, index) => {
      if (position === null) return null;
      if (position === "previous") {
        if (!index || value.positions[index - 1] === "previous" || !value.sourceOnly && (stops[index].opacity !== 0 || stops[index - 1].opacity !== 0))
          throw new Error("CSS \u900F\u660E\u8272\u6807\u91CD\u590D\u4F4D\u7F6E\u65E0\u6548");
        return "previous";
      }
      keys(position, ["unit", "value"]);
      if (!["px", "percent"].includes(position.unit) || !finite(position.value) || Math.abs(position.value) > 2e4)
        throw new Error("CSS \u8272\u6807\u53EA\u652F\u6301\u6709\u754C px/percent \u5750\u6807");
      return { unit: position.unit, value: position.value };
    });
    if (positions.filter((p) => p !== "previous").length < 2)
      throw new Error("CSS \u6E10\u53D8\u81F3\u5C11\u9700\u8981\u4E24\u4E2A\u539F\u59CB\u8272\u6807");
    return { direction: normalized, positions, ...value.sourceOnly ? { sourceOnly: true } : {} };
  }
  function parseCssLinearDirection(value) {
    if (value.startsWith("to ")) {
      const words = value.slice(3).split(/\s+/u);
      if (!words.length || words.length > 2 || new Set(words).size !== words.length || words.some((word) => !["top", "right", "bottom", "left"].includes(word)))
        throw new Error("\u6E10\u53D8\u65B9\u5411\u4E0D\u53D7\u652F\u6301");
      const x = words.includes("right") ? 1 : words.includes("left") ? -1 : 0;
      const y = words.includes("bottom") ? 1 : words.includes("top") ? -1 : 0;
      if (words.length === 2 && (!x || !y)) throw new Error("\u6E10\u53D8\u65B9\u5411\u51B2\u7A81");
      return x && y ? { corner: [x, y] } : { angle: x ? x > 0 ? 90 : 270 : y > 0 ? 180 : 0 };
    }
    const match = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+))(deg|grad|rad|turn)$/u.exec(value);
    if (!match) throw new Error("\u6E10\u53D8\u89D2\u5EA6\u4E0D\u53D7\u652F\u6301");
    const degrees = Number(match[1]) * { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }[match[2]];
    if (!finite(degrees) || Math.abs(degrees) > 36e5) throw new Error("\u6E10\u53D8\u89D2\u5EA6\u8D85\u51FA\u8303\u56F4");
    return { angle: (degrees % 360 + 360) % 360 };
  }
  function cssLinearVector(direction, width, height) {
    if (direction.corner) {
      const diagonal = Math.hypot(width, height);
      return {
        x: direction.corner[0] * height / diagonal,
        y: direction.corner[1] * width / diagonal
      };
    }
    const angle = direction.angle * Math.PI / 180;
    const snap = (v) => Math.abs(v) < 1e-12 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-12 ? Math.sign(v) : v;
    return { x: snap(Math.sin(angle)), y: snap(-Math.cos(angle)) };
  }
  function resolveCssLinear(paint, width, height) {
    var _a, _b;
    const intent = paint.cssLinear;
    if (!intent || intent.sourceOnly || !(width > 0 && height > 0) || ![width, height].every(finite))
      return paint;
    const vector = cssLinearVector(intent.direction, width, height);
    const length = Math.abs(width * vector.x) + Math.abs(height * vector.y);
    const primary = intent.positions.flatMap(
      (p, index) => p === "previous" ? [] : [{ index, value: p === null ? null : p.value / (p.unit === "percent" ? 100 : length) }]
    );
    (_a = primary[0]).value ?? (_a.value = 0);
    (_b = primary.at(-1)).value ?? (_b.value = 1);
    let previous = -Infinity;
    for (const stop of primary)
      if (stop.value !== null) {
        stop.value = Math.max(previous, stop.value);
        previous = stop.value;
      }
    for (let i = 0; i < primary.length - 1; i++) {
      let next = i + 1;
      while (primary[next].value === null) next++;
      for (let j = i + 1; j < next; j++)
        primary[j].value = primary[i].value + (primary[next].value - primary[i].value) * (j - i) / (next - i);
      i = next - 1;
    }
    const values = [];
    for (const item of primary) values[item.index] = item.value;
    intent.positions.forEach((p, index) => {
      if (p === "previous") values[index] = values[index - 1];
    });
    const start = Math.min(0, values[0]), end = Math.max(1, values.at(-1));
    const point = (t, perpendicular = 0) => ({
      x: 0.5 + ((t - 0.5) * length * vector.x - perpendicular * length * vector.y) / width,
      y: 0.5 + ((t - 0.5) * length * vector.y + perpendicular * length * vector.x) / height
    });
    return {
      ...paint,
      handles: [point(start), point(end), point(start, (end - start) / 2)],
      stops: paint.stops.map((stop, index) => ({
        ...stop,
        position: (values[index] - start) / (end - start)
      }))
    };
  }
  function cssLinearNeedsNativeWarning(paint) {
    const intent = paint.cssLinear;
    return Boolean(
      intent && (intent.sourceOnly || intent.direction.angle !== void 0 && Math.abs(intent.direction.angle % 90) > 1e-9 || intent.positions.some((p) => p && p.unit === "px" && p.value !== 0))
    );
  }
  function validateCssLinearInterpolation(intent, stops) {
    if (intent.sourceOnly) return;
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1], b = stops[i], p = intent.positions[i - 1], q = intent.positions[i];
      const hard = q === "previous" || p && q && typeof p === "object" && typeof q === "object" && p.unit === q.unit && p.value >= q.value;
      if (!hard && a.opacity !== b.opacity && a.color !== b.color)
        throw new Error("\u4E0D\u540C\u989C\u8272\u4E14\u900F\u660E\u5EA6\u53D8\u5316\u7684 CSS \u9884\u4E58\u63D2\u503C\u65E0\u6CD5\u7531\u5F53\u524D\u539F\u751F\u6E10\u53D8\u65E0\u635F\u8868\u793A");
    }
  }

  // apps/design-studio/app/paint.mjs
  var hex = (value) => typeof value === "string" && /^#[a-f\d]{6}$/iu.test(value);
  var rgb = (value) => [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  function gradientMatrix(handles) {
    const [a, b, c] = handles;
    return [
      [b.x - a.x, 2 * (c.x - a.x), 2 * a.x - c.x],
      [b.y - a.y, 2 * (c.y - a.y), 2 * a.y - c.y]
    ];
  }
  function inverseGradientMatrix(handles) {
    const [[a, b, c], [d, e, f]] = gradientMatrix(handles), determinant = a * e - b * d;
    if (Math.abs(determinant) < 1e-8) throw new Error("\u7EBF\u6027\u6E10\u53D8\u5750\u6807\u4E0D\u53EF\u9006");
    return [
      [e / determinant, -b / determinant, (b * f - e * c) / determinant],
      [-d / determinant, a / determinant, (d * c - a * f) / determinant]
    ];
  }
  function designFillPaints(node) {
    const paints = node.fillPaints ?? (hex(node.fill) ? [{ type: "SOLID", color: node.fill, opacity: 1 }] : []);
    return paints.some((paint) => paint.cssLinear && !paint.cssLinear.sourceOnly) ? paints.map(
      (paint) => paint.cssLinear ? resolveCssLinear(paint, node.width, node.height) : paint
    ) : paints;
  }
  function designPaintsToFigma(node) {
    const paints = designFillPaints(node);
    if (paints.some(
      (paint) => paint.cssLinear && !paint.cssLinear.sourceOnly && paint.handles.some((point) => Math.abs(point.x) > 100 || Math.abs(point.y) > 100)
    ))
      throw new Error(
        "\u5F53\u524D CSS \u6E10\u53D8\u5C3A\u5BF8/\u50CF\u7D20\u8272\u6807\u4EA7\u751F\u8D85\u51FA \xB1100 \u7684\u539F\u751F\u63A7\u5236\u70B9\uFF1B\u8BF7\u8C03\u6574\u5C3A\u5BF8\u6216\u8272\u6807\u540E\u518D\u5BFC\u51FA\u3002\u539F\u59CB CSS \u610F\u56FE\u4ECD\u53EF\u5728 Design Studio \u4E2D\u7F16\u8F91\u3002"
      );
    return paints.map(
      (paint) => paint.type === "SOLID" ? {
        type: "SOLID",
        color: Object.fromEntries(
          ["r", "g", "b"].map((key, index) => [key, rgb(paint.color)[index]])
        ),
        opacity: paint.opacity
      } : {
        type: "GRADIENT_LINEAR",
        opacity: paint.opacity,
        gradientTransform: inverseGradientMatrix(paint.handles),
        gradientStops: paint.stops.map((stop) => ({
          position: stop.position,
          color: {
            ...Object.fromEntries(
              ["r", "g", "b"].map((key, index) => [key, rgb(stop.color)[index]])
            ),
            a: stop.opacity
          }
        }))
      }
    );
  }

  // apps/design-studio/app/document-bundle.mjs
  var MAX_WORKSPACE_DESIGN_TEXT_BYTES = 384 * 1024;
  var MAX_DESIGN_BUNDLE_PART_BYTES = 360 * 1024;
  var encoder = new TextEncoder();

  // apps/design-studio/app/resource-store.mjs
  var DESIGN_RESOURCE_KINDS = Object.freeze(["image", "font"]);
  var MAX_DESIGN_RESOURCE_BYTES = 64 * 1024 * 1024;

  // apps/design-studio/app/document.mjs
  var MAX_SVG_EXPORT_BYTES = 384 * 1024;
  var MAX_LOCAL_SVG_EXPORT_BYTES = 4 * 1024 * 1024;

  // apps/design-studio/app/native-text-ranges-source.mjs
  var MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES = 256 * 1024;
  var NATIVE_TEXT_RANGE_FIELDS = Object.freeze([
    "fontName",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "fills",
    "textDecoration",
    "textDecorationStyle",
    "textDecorationOffset",
    "textDecorationThickness",
    "textDecorationColor",
    "textDecorationSkipInk",
    "hyperlink",
    "textCase",
    "openTypeFeatures",
    "textStyleId",
    "fillStyleId",
    "listOptions",
    "listSpacing",
    "indentation",
    "paragraphIndent",
    "paragraphSpacing",
    "textStyleOverrides",
    "boundVariables",
    "textWrapStyle"
  ]);
  var NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS = Object.freeze([
    "hasMissingFont",
    "textTruncation",
    "maxLines",
    "leadingTrim",
    "hangingPunctuation",
    "hangingList",
    "textAlignHorizontal",
    "textAlignVertical",
    "textAutoResize",
    "layoutSizingHorizontal",
    "layoutSizingVertical"
  ]);

  // apps/design-studio/app/native-text-range-plan.mjs
  var MAX_NATIVE_TEXT_RANGE_RUNS = MAX_TEXT_RANGES * 2 + 1;
  var geometry = ["textDecorationThickness", "textUnderlineOffset", "textDecorationSkipInk"];
  var fields = [
    "type",
    "text",
    "textSource",
    "textFlow",
    "textRanges",
    "fill",
    "fillPaints",
    "textDecoration",
    ...geometry,
    "textOverflow",
    "fontSize"
  ];

  // apps/design-studio/app/native-text-range-hint.mjs
  var MAX_NATIVE_TEXT_RANGE_HINT_BYTES = 64 * 1024;

  // apps/design-studio/app/native-text-import.mjs
  var NATIVE_TEXT_SUPPLEMENT_KEY = "nativeTextRanges";
  var NATIVE_TEXT_RESERVED_RAW_KEYS = Object.freeze([
    "codeshellNativeTextRanges",
    "codeshellNativeTextRangeHint",
    "codeshellTextRangeIntent",
    NATIVE_TEXT_SUPPLEMENT_KEY
  ]);

  // apps/design-studio/app/native-notes.mjs
  var MAX_NATIVE_NOTE_BYTES = 16 * 1024;

  // apps/design-studio/app/figma-assets.mjs
  var MAX_FIGMA_ASSET_BYTES = 8 * 1024 * 1024;
  var MAX_FIGMA_ASSET_TOTAL_BYTES = 12 * 1024 * 1024;
  var MAX_FIGMA_SOURCE_BYTES = 16 * 1024 * 1024;

  // apps/design-studio/app/html-block-flow.mjs
  var intrinsicEmptyTags = new Set("input textarea select button option optgroup fieldset legend canvas img svg iframe object embed video audio meter progress details summary dialog table caption colgroup col thead tbody tfoot tr th td".split(" "));

  // apps/design-studio/app/css-linear-gradient.mjs
  var fail = (message) => {
    throw new Error(message);
  };
  var split = (value) => {
    const parts = [];
    let depth = 0, start = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === "(") depth++;
      if (value[i] === ")" && --depth < 0) fail("\u80CC\u666F\u62EC\u53F7\u65E0\u6548");
      if (value[i] === "," && depth === 0) {
        parts.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    if (depth) fail("\u80CC\u666F\u62EC\u53F7\u65E0\u6548");
    parts.push(value.slice(start).trim());
    return parts;
  };
  var numeric = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/u;
  function cssColor(value) {
    if (value === "transparent") return { color: "#000000", opacity: 0 };
    const match = /^rgba?\(([^()]*)\)$/u.exec(value);
    if (!match) fail("\u4EC5\u652F\u6301\u8BA1\u7B97\u540E\u7684 sRGB rgb/rgba \u989C\u8272");
    const parts = match[1].trim().split(/[\s,/]+/u);
    if (parts.length < 3 || parts.length > 4 || parts.some((part) => !numeric.test(part)))
      fail("\u989C\u8272\u901A\u9053\u683C\u5F0F\u4E0D\u53D7\u652F\u6301");
    const channels = parts.slice(0, 3).map(Number), opacity = Number(parts[3] ?? 1);
    if (channels.some((v) => !Number.isInteger(v) || v < 0 || v > 255) || opacity < 0 || opacity > 1)
      fail("\u989C\u8272\u8D85\u51FA\u516B\u4F4D sRGB/\u900F\u660E\u5EA6\u8303\u56F4");
    return { color: `#${channels.map((v) => v.toString(16).padStart(2, "0")).join("")}`, opacity };
  }
  function linear(value, width, height) {
    var _a, _b;
    const match = /^linear-gradient\((.*)\)$/u.exec(value);
    if (!match) fail("\u4EC5\u652F\u6301\u975E\u91CD\u590D linear-gradient\uFF1B\u5F84\u5411\u3001\u9525\u5F62\u6216\u91CD\u590D\u6E10\u53D8\u672A\u8F6C\u6362");
    const parts = split(match[1]);
    const hasDirection = /^(?:to\s|[-+]?(?:\d|\.))/u.test(parts[0]);
    const direction = parseCssLinearDirection(hasDirection ? parts.shift() : "180deg");
    const vector = cssLinearVector(direction, width, height);
    const length = Math.abs(width * vector.x) + Math.abs(height * vector.y);
    if (!Number.isFinite(length) || length < 1e-4) fail("\u6E10\u53D8\u7ED8\u5236\u533A\u57DF\u9000\u5316");
    const stops = [], authoredPositions = [];
    for (const part of parts) {
      const stop = /^(rgba?\([^()]*\)|transparent)(.*)$/u.exec(part);
      if (!stop) fail("\u989C\u8272\u63D0\u793A\u3001\u63D2\u503C\u8272\u5F69\u7A7A\u95F4\u6216\u590D\u6742\u8272\u6807\u672A\u8F6C\u6362");
      const color = cssColor(stop[1]);
      const positions = stop[2].trim() ? stop[2].trim().split(/\s+/u) : [null];
      if (positions.length > 2) fail("\u6E10\u53D8\u8272\u6807\u4F4D\u7F6E\u8FC7\u591A");
      for (const position of positions) {
        const parsed = position === null ? null : /^([-+]?(?:\d+(?:\.\d*)?|\.\d+))(%|px)?$/u.exec(position);
        if (position !== null && (!parsed || !parsed[2] && Number(parsed[1]) !== 0))
          fail("\u8272\u6807\u4EC5\u652F\u6301\u50CF\u7D20\u3001\u767E\u5206\u6BD4\u6216\u96F6\uFF1Bcalc/\u5176\u4ED6\u5355\u4F4D\u672A\u8F6C\u6362");
        const resolved = parsed ? Number(parsed[1]) / (parsed[2] === "%" ? 100 : length) : null;
        if (resolved !== null && !Number.isFinite(resolved)) fail("\u8272\u6807\u4F4D\u7F6E\u8D85\u51FA\u6570\u503C\u8303\u56F4");
        stops.push({ ...color, position: resolved });
        authoredPositions.push(
          parsed ? { unit: parsed[2] === "%" ? "percent" : "px", value: Number(parsed[1]) } : null
        );
      }
    }
    if (stops.length < 2 || stops.length > 16) fail("\u6E10\u53D8\u5FC5\u987B\u6709 2\u201316 \u4E2A\u8272\u6807");
    (_a = stops[0]).position ?? (_a.position = 0);
    (_b = stops.at(-1)).position ?? (_b.position = 1);
    let previous = -Infinity;
    for (const stop of stops)
      if (stop.position !== null) {
        stop.position = Math.max(previous, stop.position);
        previous = stop.position;
      }
    for (let i = 0; i < stops.length - 1; i++) {
      let next = i + 1;
      while (stops[next].position === null) next++;
      for (let j = i + 1; j < next; j++)
        stops[j].position = stops[i].position + (stops[next].position - stops[i].position) * (j - i) / (next - i);
      i = next - 1;
    }
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (a.position === b.position || a.opacity === b.opacity || a.color === b.color) continue;
      if (a.opacity === 0 && b.opacity > 0) a.color = b.color;
      else if (b.opacity === 0 && a.opacity > 0) b.color = a.color;
      else fail("\u4E0D\u540C\u989C\u8272\u4E14\u900F\u660E\u5EA6\u53D8\u5316\u7684 CSS \u9884\u4E58\u63D2\u503C\u65E0\u6CD5\u7531\u5F53\u524D\u539F\u751F\u6E10\u53D8\u65E0\u635F\u8868\u793A");
    }
    for (let i = 1; i < stops.length - 1; i++) {
      if (stops[i].opacity !== 0 || stops[i - 1].opacity === 0 || stops[i + 1].opacity === 0 || stops[i - 1].color === stops[i + 1].color)
        continue;
      const stop = stops[i];
      stop.color = stops[i - 1].color;
      stops.splice(i + 1, 0, { ...stop, color: stops[i + 1].color });
      authoredPositions.splice(i + 1, 0, "previous");
      i++;
    }
    if (stops.length > 16) fail("\u900F\u660E\u8272\u6807\u5C55\u5F00\u540E\u8D85\u8FC7 16 \u9879");
    const start = Math.min(0, stops[0].position), end = Math.max(1, stops.at(-1).position);
    const point = (t, perpendicular = 0) => ({
      x: 0.5 + ((t - 0.5) * length * vector.x - perpendicular * length * vector.y) / width,
      y: 0.5 + ((t - 0.5) * length * vector.y + perpendicular * length * vector.x) / height
    });
    const handles = [point(start), point(end), point(start, (end - start) / 2)];
    if (handles.some(
      (p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 100 || Math.abs(p.y) > 100
    ))
      fail("\u6E10\u53D8\u63A7\u5236\u70B9\u8D85\u51FA\u539F\u751F\u8303\u56F4");
    const cssLinear = normalizeCssLinear({ direction, positions: authoredPositions }, stops);
    validateCssLinearInterpolation(cssLinear, stops);
    return {
      type: "GRADIENT_LINEAR",
      opacity: 1,
      handles,
      stops: stops.map((stop) => ({ ...stop, position: (stop.position - start) / (end - start) })),
      cssLinear
    };
  }
  function cssLinearBackgroundPaints(style, width, height) {
    if (!(width > 0 && height > 0)) fail("\u6E10\u53D8\u7ED8\u5236\u533A\u57DF\u5FC5\u987B\u5927\u4E8E\u96F6");
    if (typeof style?.["background-image"] !== "string" || style["background-image"].length > 16e3)
      fail("\u7F3A\u5C11\u6709\u754C\u539F\u59CB CSS \u6E10\u53D8\uFF0C\u4E0D\u80FD\u4ECE\u4E0A\u6E38\u5DF2\u4E22\u5931\u5355\u4F4D\u7684\u8272\u6807\u731C\u6D4B");
    const images = split(style["background-image"]);
    if (images.length > 8) fail("\u80CC\u666F\u6700\u591A\u516B\u5C42");
    const perLayer = (property, index, fallback) => {
      const values = split(String(style[property] ?? fallback));
      return values[index % values.length];
    };
    const paints = [];
    const base = cssColor(style["background-color"] ?? "transparent");
    if (base.opacity > 0) paints.push({ type: "SOLID", ...base });
    for (let i = images.length - 1; i >= 0; i--) {
      if (images[i] === "none") continue;
      if (perLayer("background-size", i, "auto") !== "auto" && perLayer("background-size", i, "auto") !== "auto auto")
        fail("\u81EA\u5B9A\u4E49\u80CC\u666F\u5C3A\u5BF8\u7684\u6E10\u53D8\u672A\u8F6C\u6362");
      if (!/^(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)%|0(?:px)?)(?:\s+(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)%|0(?:px)?))?$/u.test(
        perLayer("background-position", i, "0% 0%")
      ))
        fail("\u5E26\u50CF\u7D20\u504F\u79FB\u7684\u6E10\u53D8\u80CC\u666F\u4F4D\u7F6E\u672A\u8F6C\u6362");
      if (perLayer("background-blend-mode", i, "normal") !== "normal") fail("\u80CC\u666F\u6DF7\u5408\u6A21\u5F0F\u672A\u8F6C\u6362");
      if (perLayer("background-attachment", i, "scroll") !== "scroll") fail("\u56FA\u5B9A\u6216\u5C40\u90E8\u80CC\u666F\u672A\u8F6C\u6362");
      const origin = perLayer("background-origin", i, "padding-box");
      if (origin !== "border-box" && (origin !== "padding-box" || ["top", "right", "bottom", "left"].some(
        (side) => parseFloat(style[`border-${side}-width`] ?? "0") !== 0
      )))
        fail("\u975E\u5B8C\u6574\u5BB9\u5668\u7684\u6E10\u53D8\u539F\u70B9\u672A\u8F6C\u6362");
      if (perLayer("background-clip", i, "border-box") !== "border-box") fail("\u6E10\u53D8\u80CC\u666F\u88C1\u526A\u672A\u8F6C\u6362");
      paints.push(linear(images[i], width, height));
    }
    if (!paints.length || paints.length > 8) fail("\u80CC\u666F\u7ED8\u5236\u5C42\u6570\u8D85\u51FA 1\u20138 \u5C42\u8303\u56F4");
    return paints;
  }

  // apps/design-studio/app/design-node-adapter.mjs
  var textBytes = (value) => new TextEncoder().encode(value);
  var svgElements = new Set(
    "svg g path rect circle ellipse line polyline polygon defs clipPath mask linearGradient radialGradient stop pattern text tspan title desc metadata filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feMorphology feTurbulence feDisplacementMap use symbol".toLowerCase().split(" ")
  );
  function inertDesignSvg(value) {
    if (typeof value !== "string" || textBytes(value).length > 1024 * 1024)
      throw new Error("SVG \u5FC5\u987B\u662F\u6700\u591A 1 MiB \u7684\u6587\u672C");
    const source = value.replace(/^\uFEFF/u, "").replace(/^\s*<\?xml[^?]*\?>/u, "").trim();
    if (!/^<svg[\s>]/iu.test(source) || /<!|<\?|&(?!(?:amp|lt|gt|quot|apos);)/iu.test(source))
      throw new Error("SVG \u5305\u542B\u58F0\u660E\u3001\u5B9E\u4F53\u6216\u4E0D\u652F\u6301\u7684\u6807\u8BB0");
    for (const tag of source.matchAll(/<\/?\s*([\w:-]+)\b([^<>]*)>/gu)) {
      if (!svgElements.has(tag[1].toLowerCase())) throw new Error(`SVG \u4E0D\u5141\u8BB8 ${tag[1]} \u5143\u7D20`);
      if (/\bon[\w:-]+\s*=|\b(?:src|xml:base)\s*=/iu.test(tag[2]))
        throw new Error("SVG \u4E0D\u5141\u8BB8\u4E8B\u4EF6\u6216\u5916\u90E8\u8D44\u6E90\u5C5E\u6027");
      for (const href of tag[2].matchAll(
        /\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/giu
      )) {
        if (!/^#[a-z0-9_.:-]+$/iu.test(href[1] ?? href[2] ?? href[3]))
          throw new Error("SVG \u5F15\u7528\u5FC5\u987B\u662F\u5185\u90E8 ID");
      }
    }
    if (/<(?:script|style|foreignObject)\b|\\|@import|(?:javascript|vbscript|data|file)\s*:|url\(\s*(?!['"]?#[a-z0-9_.:-]+['"]?\s*\))/iu.test(
      source
    ))
      throw new Error("SVG \u4E0D\u5141\u8BB8\u811A\u672C\u3001\u6837\u5F0F\u8868\u6216\u5916\u90E8 URL");
    return source;
  }

  // third-party/html2figma-plugin/integration/text-whitespace.ts
  var KEY = "htmlTextWhitespace";
  var object2 = (value) => value && typeof value === "object" && !Array.isArray(value);
  function textWhitespaceSource(value) {
    if (!object2(value) || !["normal", "nowrap"].includes(value.whiteSpace) || typeof value.rawSource !== "string" || value.rawSource.length > 1e3 || JSON.stringify(value.rawSource).length > 1e3 || value.removedTrailingNbsp !== void 0 && value.removedTrailingNbsp !== true || value.omittedPseudos !== void 0 && (!Array.isArray(value.omittedPseudos) || value.omittedPseudos.length < 1 || value.omittedPseudos.length > 2 || value.omittedPseudos.some((pseudo) => !["::before", "::after"].includes(pseudo)) || new Set(value.omittedPseudos).size !== value.omittedPseudos.length) || !value.removedTrailingNbsp && !value.omittedPseudos) return null;
    return {
      whiteSpace: value.whiteSpace,
      rawSource: value.rawSource,
      ...value.removedTrailingNbsp ? { removedTrailingNbsp: true } : {},
      ...value.omittedPseudos ? { omittedPseudos: [...value.omittedPseudos] } : {}
    };
  }
  var snapshot = (node) => ({
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    ...node.type === "TEXT" ? {
      characters: node.characters,
      fontName: node.fontName,
      fontSize: node.fontSize,
      lineHeight: node.lineHeight,
      letterSpacing: node.letterSpacing
    } : {},
    ...node.children ? { children: node.children.map((child) => ({
      type: child.type,
      x: child.x,
      y: child.y,
      width: child.width,
      height: child.height,
      ...child.type === "TEXT" ? { characters: child.characters } : {}
    })) } : {}
  });
  function retainTextWhitespace(node, source, warnings) {
    const receipt = textWhitespaceSource(source);
    if (receipt) {
      const serialized = JSON.stringify({
        format: "codeshell.html.text-whitespace",
        version: 1,
        source: receipt,
        snapshot: snapshot(node)
      });
      if (serialized.length <= 8e3) {
        node.sharedPluginData ?? (node.sharedPluginData = {});
        node.sharedPluginData[KEY] = serialized;
      } else warnings.push("HTML \u6587\u5B57\u6765\u6E90\u5FEB\u7167\u8D85\u8FC7 8000 UTF-16 \u5355\u5143\uFF1B\u672A\u8986\u76D6\u539F\u59CB\u5907\u6CE8\uFF0C\u672A\u4FEE\u6539\u6587\u5B57\u6216\u5E03\u5C40\u3002");
    }
    const raw = node.sharedPluginData?.[KEY];
    if (raw === void 0) return;
    let value;
    try {
      if (typeof raw === "string" && raw.length <= 8e3) value = JSON.parse(raw);
    } catch {
    }
    const original = textWhitespaceSource(value?.source);
    if (!original || value?.format !== "codeshell.html.text-whitespace" || value.version !== 1) {
      warnings.push("HTML \u6587\u5B57\u6765\u6E90\u5907\u6CE8\u65E0\u6548\uFF1B\u539F\u59CB\u5907\u6CE8\u4EC5\u4F5C\u8BB0\u5F55\uFF0C\u672A\u7528\u4E8E\u4FEE\u6539\u6587\u5B57\u6216\u5E03\u5C40\u3002");
      return;
    }
    if (JSON.stringify(value.snapshot) !== JSON.stringify(snapshot(node)))
      warnings.push("HTML \u6587\u5B57\u6765\u6E90\u5907\u6CE8\u4E0E\u5F53\u524D\u56FE\u5C42\u5FEB\u7167\u4E0D\u540C\uFF1B\u4EC5\u4FDD\u7559\u539F\u59CB\u8BB0\u5F55\uFF0C\u672A\u7528\u4E8E\u4FEE\u6539\u6587\u5B57\u6216\u5E03\u5C40\u3002");
    if (original.omittedPseudos)
      warnings.push("\u5DF2\u7701\u7565\u6355\u83B7\u65F6\u65E0\u7ED8\u5236\u3001\u65E0\u6587\u5B57\u4E14\u8131\u79BB\u6587\u6863\u6D41\u7684\u7A7A\u4F2A\u5143\u7D20\uFF1B\u4FDD\u7559\u771F\u5B9E\u8282\u70B9\uFF0C\u4F46\u4E0D\u4FDD\u7559\u4F2A\u5143\u7D20\u6269\u5C55\u7684\u70B9\u51FB\u533A\u57DF\u3002");
  }

  // apps/design-studio/app/native-text-ranges.mjs
  function assertNativeTextRangeBoundary(node) {
    if (node?.textRanges === void 0) return;
    const label = (typeof node.name === "string" ? node.name : typeof node.id === "string" ? node.id : "Text").slice(0, 120);
    const error = new Error(
      label + "\uFF1A\u8303\u56F4\u6587\u5B57\u7684\u6B64\u9879\u539F\u751F\u4E92\u8F6C\u5C1A\u672A\u5B8C\u6210\u9A8C\u8BC1\uFF1B\u5DF2\u963B\u6B62\u4E92\u8F6C\uFF0C\u672A\u4E22\u5F03\u8303\u56F4\u6837\u5F0F\u3002"
    );
    error.code = "TEXT_RANGES_NATIVE_UNSUPPORTED";
    throw error;
  }

  // third-party/html2figma-plugin/integration/input.ts
  var MAX_INPUT_BYTES = 12 * 1024 * 1024;
  var MAX_NODES = 3e3;
  var object3 = (v) => v && typeof v === "object" && !Array.isArray(v);
  function prepareDesignInput(input) {
    const text = typeof input === "string" ? input : JSON.stringify(input);
    if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_INPUT_BYTES)
      throw new Error("\u8F93\u5165\u6700\u591A 12 MiB");
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("JSON \u65E0\u6CD5\u89E3\u6790");
    }
    const roots = Array.isArray(data) ? data : Array.isArray(data?.nodes) ? data.nodes : [data];
    if (!roots.length || roots.length > 20) throw new Error("\u6BCF\u6B21\u5BFC\u5165 1\u201320 \u4E2A\u6839\u8282\u70B9");
    let count = 0;
    const warnings = [];
    const reservedIds = /* @__PURE__ */ new Set();
    const legacyGridWarning = "Grid \u4F7F\u7528\u6D4B\u91CF\u50CF\u7D20\u7684 Flex \u884C/\u56FA\u5B9A\u51E0\u4F55\u517C\u5BB9\u8F6C\u6362\uFF0C\u672A\u4FDD\u7559\u539F\u751F\u8F68\u9053\u6216\u54CD\u5E94\u5F0F\u5C3A\u5BF8\uFF1B\u9700\u8981\u539F\u751F Grid \u65F6\u8BF7\u901A\u8FC7 Design Studio \u5BFC\u5165\u5E76\u4F7F\u7528 Design Bridge\u3002";
    const legacyBorderWarning = "CSS \u8FB9\u6846\u4F7F\u7528\u72EC\u7ACB\u63D2\u4EF6\u7684\u7EDF\u4E00\u5C45\u4E2D\u63CF\u8FB9\u517C\u5BB9\u8F6C\u6362\uFF0C\u672A\u4FDD\u7559\u5404\u4FA7\u5BBD\u5EA6\u3001\u989C\u8272\u6216\u5185\u90E8\u5BF9\u9F50\uFF1B\u9700\u8981\u53EF\u7F16\u8F91\u4FA7\u8FB9\u65F6\u8BF7\u901A\u8FC7 Design Studio \u5BFC\u5165\u5E76\u4F7F\u7528 Design Bridge\u3002";
    const hasCssBorder = (node) => Boolean(node.nodeType && ["top", "right", "bottom", "left"].some((side) => node.border?.[side]?.width > 0 && node.border[side].style !== "none"));
    const legacyFloatWarning = "\u6D6E\u52A8\u5217\u5728\u672C\u72EC\u7ACB\u63D2\u4EF6\u4E2D\u4F7F\u7528\u56FA\u5B9A\u6D4B\u91CF\u5E03\u5C40\uFF0C\u672A\u4FDD\u7559\u767E\u5206\u6BD4\u5217\u6D41\uFF1B\u9700\u8981\u6709\u754C\u53EF\u7F16\u8F91\u5217\u5E03\u5C40\u65F6\u8BF7\u901A\u8FC7 Design Studio \u5BFC\u5165\u5E76\u4F7F\u7528 Design Bridge\u3002";
    const isFloatFallback = (node) => node.codeshellFloatFallback === true || node.nodeType === "container" && node.layout?.hasFloatChildren === true;
    function inspect(node, depth = 0) {
      if (!object3(node) || depth > 60 || ++count > MAX_NODES)
        throw new Error("\u8282\u70B9\u6811\u6700\u591A 3000 \u4E2A\u8282\u70B9\u300160 \u5C42");
      assertNativeTextRangeBoundary(node);
      if (!node.nodeType && !["FRAME", "GROUP", "RECTANGLE", "TEXT", "SVG"].includes(node.type))
        throw new Error(`\u4E0D\u652F\u6301\u8282\u70B9\u7C7B\u578B\uFF1A${String(node.type ?? "unknown").slice(0, 60)}`);
      if (node.nodeType && !["container", "text", "image", "svg"].includes(node.nodeType))
        throw new Error("\u4E0D\u652F\u6301\u7684 DesignNode \u7C7B\u578B");
      const bounds = node.nodeType ? node.bounds : node;
      if (!object3(bounds) || !["width", "height"].every(
        (k) => Number.isFinite(bounds[k]) && bounds[k] >= 0 && bounds[k] <= 2e4
      ))
        throw new Error("\u8282\u70B9\u5BBD\u9AD8\u5FC5\u987B\u5728 0\u201320000 \u4E4B\u95F4");
      if (node.nodeType === "svg" || node.type === "SVG") inertDesignSvg(node.svgContent);
      if (node.children !== void 0 && !Array.isArray(node.children))
        throw new Error("children \u5FC5\u987B\u662F\u6570\u7EC4");
      if (node.codeshellGridFallback === true || node.cssLayout?.["--codeshell-grid-legacy"] === "synthetic")
        warnings.push(legacyGridWarning);
      if (node.codeshellBorderFallback === true || hasCssBorder(node)) warnings.push(legacyBorderWarning);
      if (isFloatFallback(node)) warnings.push(legacyFloatWarning);
      if (typeof node.id === "string" && node.id) reservedIds.add(node.id);
      for (const child of node.children ?? []) inspect(child, depth + 1);
    }
    roots.forEach((root) => inspect(root));
    const gradientPaints = /* @__PURE__ */ new Map();
    const textWhitespace = /* @__PURE__ */ new Map();
    const assignedIds = /* @__PURE__ */ new Set();
    let sourceSerial = 0;
    function retainGradients(node) {
      if (typeof node.id !== "string" || !node.id || assignedIds.has(node.id)) {
        let id;
        do {
          id = `codeshell-source-${sourceSerial++}`;
        } while (reservedIds.has(id));
        node.id = id;
        reservedIds.add(id);
      }
      assignedIds.add(node.id);
      const whitespace = node.nodeType && textWhitespaceSource(node.cssTextWhitespace);
      if (whitespace) textWhitespace.set(node.id, whitespace);
      if (node.nodeType && node.cssBorderRadii) {
        try {
          cssCornerRadii(node.cssBorderRadii);
        } catch (error) {
          node.border ?? (node.border = {});
          node.border.radius = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
          warnings.push(`\u5706\u89D2\u672A\u5BFC\u5165\uFF1A${error.message}\u3002`);
        }
      }
      if (node.nodeType && (node.cssBackground?.["background-image"]?.includes("gradient(") || node.background?.layers?.some((layer) => layer.type?.endsWith("gradient")))) {
        node.background ?? (node.background = { layers: [] });
        node.background.layers = (node.background.layers ?? []).filter((layer) => !layer.type?.endsWith("gradient"));
        try {
          const fillPaints = cssLinearBackgroundPaints(node.cssBackground, node.bounds.width, node.bounds.height);
          gradientPaints.set(node.id, designPaintsToFigma({ fillPaints, ...node.bounds }));
          if (fillPaints.some(cssLinearNeedsNativeWarning))
            warnings.push("CSS \u89D2\u5EA6/\u50CF\u7D20\u8272\u6807\u4EC5\u6309\u5F53\u524D\u5C3A\u5BF8\u521B\u5EFA\u4E3A\u539F\u751F\u6E10\u53D8\uFF0CFigma \u5185\u8C03\u6574\u5C3A\u5BF8\u53EF\u80FD\u6539\u53D8\u5916\u89C2\uFF1B\u8BF7\u901A\u8FC7 Design Studio \u4FDD\u7559\u548C\u7F16\u8F91\u539F\u59CB CSS \u610F\u56FE\u3002");
        } catch (error) {
          warnings.push(`\u6E10\u53D8\u672A\u5BFC\u5165\uFF0C\u4FDD\u7559\u72EC\u7ACB\u80CC\u666F\u8272\uFF1A${error.message}\u3002`);
        }
      }
      for (const child of node.children ?? []) retainGradients(child);
    }
    roots.forEach(retainGradients);
    const hasLegacyGrid = (node) => node.codeshellGridFallback === true || node.cssLayout?.["--codeshell-grid-legacy"] === "synthetic" || (node.children ?? []).some(hasLegacyGrid);
    const hasLegacyBorder = (node) => node.codeshellBorderFallback === true || hasCssBorder(node) || (node.children ?? []).some(hasLegacyBorder);
    const hasLegacyFloat = (node) => isFloatFallback(node) || (node.children ?? []).some(hasLegacyFloat);
    const converted = roots.map((root) => {
      const converted2 = root.nodeType ? FigmaAdapter.toFigmaJSON(root) : root;
      if (hasLegacyGrid(root)) converted2.codeshellGridFallback = true;
      if (hasLegacyBorder(root)) converted2.codeshellBorderFallback = true;
      if (hasLegacyFloat(root)) converted2.codeshellFloatFallback = true;
      return converted2;
    });
    count = 0;
    function normalizeOnce(node) {
      if (gradientPaints.has(node.id)) node.fills = gradientPaints.get(node.id);
      node.name = String(node.name || node.type || "HTML layer").slice(0, 120);
      node.id || (node.id = `html-${serial++}`);
      node.width = Math.max(1, node.width);
      node.height = Math.max(1, node.height);
      if (node.type === "GROUP") {
        node.type = "FRAME";
        node.fills || (node.fills = []);
        node.clipsContent = false;
        warnings.push("GROUP \u4EE5\u53EF\u7F16\u8F91 FRAME \u5BFC\u5165");
      }
      if (node.type === "TEXT" && (typeof node.characters !== "string" || node.characters.length > 1e4))
        throw new Error("\u5355\u4E2A\u6587\u672C\u8282\u70B9\u6700\u591A 10000 \u5B57\u7B26");
      (node.children ?? []).forEach(normalizeOnce);
      retainTextWhitespace(node, textWhitespace.get(node.id), warnings);
    }
    converted.forEach((root) => inspect(root));
    let serial = 0;
    converted.forEach(normalizeOnce);
    return { roots: converted, count, warnings: [...new Set(warnings)] };
  }

  // third-party/html2figma-plugin/integration/code.ts
  var busy = false;
  figma.showUI(__html__, { width: 780, height: 760, themeColors: true });
  async function materializeImages(node, api) {
    const top = node.imageMetadata;
    const fills = [];
    for (const fill of node.fills ?? []) {
      if (fill.type !== "IMAGE") {
        fills.push(fill);
        continue;
      }
      const meta = fill._imageMetadata || top || {};
      const source = meta.base64 || meta.originalUrl || fill._pendingImageUrl || "";
      let image;
      if (meta.isSvg && meta.svgContent) {
        const svg = api.createNodeFromSvg(inertDesignSvg(meta.svgContent));
        try {
          image = api.createImage(await svg.exportAsync({ format: "PNG" }));
        } finally {
          svg.remove();
        }
      } else if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) {
        image = api.createImage(
          ImageCreator.decodeBase64ToBytes(source.slice(source.indexOf(",") + 1))
        );
      } else if (fill.imageHash && typeof api.getImageByHash === "function" && api.getImageByHash(fill.imageHash)) {
        image = { hash: fill.imageHash };
      } else
        throw new Error(
          "\u56FE\u7247\u5FC5\u987B\u968F HTML/JSON \u5185\u5D4C\u6216\u9009\u62E9\u672C\u5730\u6587\u4EF6\uFF1B\u4E0D\u80FD\u4E0B\u8F7D\u5916\u90E8 URL \u6216\u8DE8\u6587\u4EF6 imageHash"
        );
      const clean = {
        type: "IMAGE",
        imageHash: image.hash,
        scaleMode: fill.scaleMode || "FILL"
      };
      for (const key of [
        "opacity",
        "visible",
        "imageTransform",
        "scalingFactor",
        "rotation",
        "filters"
      ])
        if (fill[key] !== void 0) clean[key] = fill[key];
      fills.push(clean);
    }
    if (node.fills) node.fills = fills;
    delete node.imageMetadata;
    delete node.backgroundImageData;
    for (const child of node.children ?? []) await materializeImages(child, api);
  }
  async function preloadFonts(roots, api, warnings) {
    const fallback = { family: "Inter", style: "Regular" };
    await api.loadFontAsync(fallback);
    const loaded = /* @__PURE__ */ new Set(["Inter:Regular"]);
    for (const root of roots)
      for (const font of extractFontsFromJSON(root).values()) {
        try {
          await api.loadFontAsync(font);
          loaded.add(`${font.family}:${font.style}`);
        } catch {
          warnings.push(`\u5B57\u4F53 ${font.family} ${font.style} \u4E0D\u53EF\u7528\uFF0C\u4F7F\u7528 Inter Regular`);
        }
      }
    function normalize(node) {
      if (node.type === "TEXT") {
        if (!node.fontName || !loaded.has(`${node.fontName.family}:${node.fontName.style}`))
          node.fontName = fallback;
        for (const seg of node.styledTextSegments ?? [])
          if (seg.fontName && !loaded.has(`${seg.fontName.family}:${seg.fontName.style}`))
            seg.fontName = fallback;
      }
      (node.children ?? []).forEach(normalize);
    }
    roots.forEach(normalize);
  }
  function assertTextContent(source, created) {
    if (source.type === "TEXT" && typeof source.characters === "string" && source.characters.trim()) {
      if (created?.type !== "TEXT" || created.characters !== source.characters) {
        throw new Error(
          `\u6587\u5B57\u5185\u5BB9\u672A\u5B8C\u6574\u521B\u5EFA\uFF1A${source.name}\u3002\u6E90\u6587\u5B57\u88AB\u66FF\u6362\u3001\u622A\u65AD\u6216\u9057\u6F0F\uFF0C\u672C\u6B21\u5BFC\u5165\u5DF2\u53D6\u6D88\u3002`
        );
      }
    }
    const actualChildren = created?.children ?? [];
    for (let index = 0; index < (source.children?.length ?? 0); index++) {
      assertTextContent(source.children[index], actualChildren[index]);
    }
  }
  figma.ui.onmessage = async (message) => {
    if (message?.type !== "import-design" || typeof message.requestId !== "string" || busy) return;
    busy = true;
    const created = [];
    const selection = [...figma.currentPage.selection];
    const api = new Proxy(figma, {
      get(target, key) {
        const value = target[key];
        if (typeof value !== "function") return value;
        if (["createFrame", "createRectangle", "createText", "createNodeFromSvg"].includes(String(key)))
          return (...args) => {
            const node = value.apply(target, args);
            created.push(node);
            return node;
          };
        return value.bind(target);
      }
    });
    creatorErrors.length = 0;
    try {
      const { roots, count, warnings } = prepareDesignInput(message.designData);
      await preloadFonts(roots, api, warnings);
      for (const root of roots) await materializeImages(root, api);
      const service = new FigmaService(api, {
        autoFocus: false,
        validateNodes: true,
        logOperations: false
      });
      const completed = [];
      let x = figma.viewport.center.x;
      for (const root of roots) {
        const frame = await service.addLayersToFrame(root, null);
        if (creatorErrors.length) throw new Error(`\u56FE\u5C42\u521B\u5EFA\u5931\u8D25\uFF1A${creatorErrors[0]}`);
        assertTextContent(root, frame);
        frame.x = x;
        frame.y = figma.viewport.center.y;
        x += frame.width + 80;
        figma.currentPage.appendChild(frame);
        completed.push(frame);
      }
      figma.currentPage.selection = completed;
      figma.viewport.scrollAndZoomIntoView(completed);
      figma.commitUndo?.();
      figma.ui.postMessage({
        type: "import-success",
        requestId: message.requestId,
        count,
        nodeIds: completed.map((n) => n.id),
        warnings: [
          .../* @__PURE__ */ new Set([
            ...warnings,
            "\u6587\u5B57\u5185\u5BB9\u5DF2\u6838\u5BF9\uFF1B\u5B57\u4F53\u3001\u5BCC\u6587\u672C\u6837\u5F0F\u548C\u590D\u6742\u6548\u679C\u4ECD\u53EF\u80FD\u4E0E\u9884\u89C8\u4E0D\u540C\uFF0C\u8BF7\u68C0\u67E5\u89C6\u89C9\u7ED3\u679C\u3002"
          ])
        ]
      });
      figma.notify(`\u5DF2\u521B\u5EFA ${count} \u4E2A\u53EF\u7F16\u8F91\u56FE\u5C42`);
    } catch (error) {
      const rollbackErrors = [];
      for (const node of created.reverse())
        if (!node.removed) {
          try {
            node.remove();
          } catch (cleanupError) {
            rollbackErrors.push(String(cleanupError));
          }
        }
      try {
        figma.currentPage.selection = selection.filter((n) => !n.removed);
      } catch (selectionError) {
        rollbackErrors.push(String(selectionError));
      }
      figma.ui.postMessage({
        type: "import-error",
        requestId: message.requestId,
        message: (error instanceof Error ? error.message : String(error)) + (rollbackErrors.length ? `\uFF1B\u90E8\u5206\u65B0\u56FE\u5C42\u6E05\u7406\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u672C\u6B21\u5BFC\u5165\uFF1A${rollbackErrors[0]}` : ""),
        rollback: rollbackErrors.length ? "incomplete" : "complete"
      });
    } finally {
      busy = false;
    }
  };
})();
