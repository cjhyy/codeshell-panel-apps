/*! html2figma browser runtime; MIT declared upstream. See html2figma-NOTICE.md. */
function createRuntime(realm) {
"use strict";
var html2figmaCore = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // third-party/html2figma/integration/entry.ts
  var entry_exports = {};
  __export(entry_exports, {
    convert: () => convert
  });

  // third-party/html2figma/upstream/packages/browser/traverser/visibility.ts
  function hasValidTextContent(textNode, preserveWhitespace) {
    const content = textNode.textContent || "";
    if (preserveWhitespace) {
      return content.length > 0;
    }
    return content.trim().length > 0;
  }
  function isElementVisible(element, computedStyle) {
    if (computedStyle.display === "none") {
      return false;
    }
    return true;
  }

  // third-party/html2figma/upstream/packages/browser/traverser/pseudo.ts
  function capturePseudoElement(element, pseudo) {
    try {
      const style = realm.getComputedStyle(element, pseudo);
      const content = style.getPropertyValue("content");
      if (!content || content === "none" || content === "normal") return null;
      const display = style.getPropertyValue("display");
      if (display === "none") return null;
      let textContent = "";
      if (content.startsWith('"') && content.endsWith('"')) {
        textContent = content.slice(1, -1);
      } else if (content.startsWith("'") && content.endsWith("'")) {
        textContent = content.slice(1, -1);
      }
      const isUrlContent = content.includes("url(");
      const parentRect = element.getBoundingClientRect();
      const rawWidth = style.getPropertyValue("width");
      const rawHeight = style.getPropertyValue("height");
      const width = parseFloat(rawWidth) || 0;
      const height = parseFloat(rawHeight) || 0;
      const hasExplicitWidth = rawWidth && rawWidth !== "auto" && rawWidth !== "none";
      const hasExplicitHeight = rawHeight && rawHeight !== "auto" && rawHeight !== "none";
      const w = hasExplicitWidth ? width : width || parentRect.width;
      const h = hasExplicitHeight ? height : height || parentRect.height;
      const position = style.getPropertyValue("position");
      let x = parentRect.left;
      let y = parentRect.top;
      if (position === "absolute" || position === "fixed") {
        const cssTop = style.getPropertyValue("top");
        const cssBottom = style.getPropertyValue("bottom");
        const cssLeft = style.getPropertyValue("left");
        const cssRight = style.getPropertyValue("right");
        if (cssLeft && cssLeft !== "auto") {
          x = parentRect.left + parseFloat(cssLeft);
        } else if (cssRight && cssRight !== "auto") {
          x = parentRect.right - parseFloat(cssRight) - w;
        }
        if (cssTop && cssTop !== "auto") {
          y = parentRect.top + parseFloat(cssTop);
        } else if (cssBottom && cssBottom !== "auto") {
          y = parentRect.bottom - parseFloat(cssBottom) - h;
        }
      }
      const pseudoRect = {
        x,
        y,
        width: w,
        height: h,
        left: x,
        top: y,
        right: x + w,
        bottom: y + h,
        toJSON: () => ({})
      };
      if (textContent || isUrlContent) {
        const renderNode = {
          nodeType: textContent ? "text" : "element",
          tag: pseudo === "::before" ? "::before" : "::after",
          textContent: textContent || void 0,
          computedStyle: style,
          boundingRect: pseudoRect,
          children: [],
          domNode: element,
          // pseudo-elements don't have their own DOM node
          visible: true,
          metadata: { isPseudoElement: true, pseudo }
        };
        return renderNode;
      }
      if (width > 0 || height > 0) {
        const renderNode = {
          nodeType: "element",
          tag: pseudo === "::before" ? "::before" : "::after",
          computedStyle: style,
          boundingRect: pseudoRect,
          children: [],
          domNode: element,
          visible: true,
          metadata: { isPseudoElement: true, pseudo }
        };
        return renderNode;
      }
    } catch {
    }
    return null;
  }

  // third-party/html2figma/upstream/packages/browser/traverser/form.ts
  var CHROME_ACCENT = "rgb(2, 101, 220)";
  var CHROME_BORDER = "rgb(118, 118, 118)";
  var CHROME_TRACK = "rgb(218, 220, 224)";
  var TEXT_INPUT_TYPES = /* @__PURE__ */ new Set([
    "text",
    "email",
    "url",
    "search",
    "tel",
    "number",
    ""
  ]);
  var BUTTON_INPUT_TYPES = /* @__PURE__ */ new Set(["button", "submit", "reset"]);
  function injectFormContent(element, renderNode) {
    const tag = element.tagName.toLowerCase();
    if (tag === "input") {
      injectInputContent(element, renderNode);
    } else if (tag === "select") {
      injectSelectContent(element, renderNode);
    } else if (tag === "textarea") {
      injectTextareaContent(element, renderNode);
    }
  }
  function injectInputContent(input, renderNode) {
    const type = (input.type || "text").toLowerCase();
    if (TEXT_INPUT_TYPES.has(type)) {
      if (input.value) {
        pushFormTextChild(input, input.value, realm.getComputedStyle(input), renderNode);
      } else if (input.placeholder) {
        pushFormTextChild(input, input.placeholder, getPlaceholderStyle(input), renderNode);
      }
    } else if (type === "password") {
      if (input.value) {
        pushFormTextChild(input, "\u2022".repeat(input.value.length), realm.getComputedStyle(input), renderNode);
      } else if (input.placeholder) {
        pushFormTextChild(input, input.placeholder, getPlaceholderStyle(input), renderNode);
      }
    } else if (BUTTON_INPUT_TYPES.has(type)) {
      if (input.value) {
        pushFormTextChild(input, input.value, realm.getComputedStyle(input), renderNode);
      }
    } else if (type === "checkbox") {
      injectCheckboxContent(input, renderNode);
    } else if (type === "radio") {
      injectRadioContent(input, renderNode);
    } else if (type === "range") {
      injectRangeContent(input, renderNode);
    }
  }
  function injectSelectContent(select, renderNode) {
    const text = select.options[select.selectedIndex]?.text;
    if (text) {
      const style = realm.getComputedStyle(select);
      pushFormTextChild(select, text, style, renderNode);
      pushSelectChevron(select, style, renderNode);
    }
  }
  function pushSelectChevron(element, baseStyle, parentRenderNode) {
    const rect = element.getBoundingClientRect();
    const chevronSize = 16;
    const cx = rect.right - chevronSize / 2 - 8;
    const cy = rect.top + (rect.height - chevronSize) / 2;
    const chevronRect = makeDOMRect(cx, cy, chevronSize, chevronSize);
    parentRenderNode.children.push({
      nodeType: "text",
      tag: "#form-text",
      textContent: ">",
      computedStyle: createStyleProxy(baseStyle, {
        "text-align": "center",
        "position": "absolute"
      }),
      boundingRect: chevronRect,
      children: [],
      domNode: element,
      visible: true,
      metadata: { isFormContent: true, rotation: 90, positioning: "absolute" }
    });
  }
  function injectTextareaContent(textarea, renderNode) {
    if (textarea.value) {
      pushFormTextChild(textarea, textarea.value, realm.getComputedStyle(textarea), renderNode);
    } else if (textarea.placeholder) {
      pushFormTextChild(textarea, textarea.placeholder, getPlaceholderStyle(textarea), renderNode);
    }
  }
  function injectCheckboxContent(input, renderNode) {
    const checked = input.checked;
    const rect = input.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) || 14;
    const boxRect = makeDOMRect(rect.left, rect.top, size, size);
    const base = realm.getComputedStyle(input);
    const boxStyle = createStyleProxy(base, {
      ...checked ? { ...NO_BORDER, "background-color": CHROME_ACCENT } : {
        ...solidBorder("2px", CHROME_BORDER),
        "background-color": "rgb(255, 255, 255)"
      },
      "border-top-left-radius": "2px",
      "border-top-right-radius": "2px",
      "border-bottom-right-radius": "2px",
      "border-bottom-left-radius": "2px",
      "display": "flex",
      "justify-content": "center",
      "align-items": "center",
      "overflow": "visible",
      "position": "static",
      "opacity": "1"
    });
    const box = {
      nodeType: "element",
      tag: "#form-checkbox",
      computedStyle: boxStyle,
      boundingRect: boxRect,
      children: [],
      domNode: input,
      visible: true,
      metadata: { isFormContent: true }
    };
    if (checked) {
      box.children.push({
        nodeType: "text",
        tag: "#form-text",
        textContent: "\u2713",
        computedStyle: createStyleProxy(base, {
          "color": "rgb(255, 255, 255)",
          "font-size": `${Math.round(size * 0.75)}px`,
          "font-weight": "700",
          "line-height": `${size}px`,
          "text-align": "center",
          "position": "static"
        }),
        boundingRect: boxRect,
        children: [],
        domNode: input,
        visible: true,
        metadata: { isFormContent: true }
      });
    }
    renderNode.children.push(box);
  }
  function injectRadioContent(input, renderNode) {
    const checked = input.checked;
    const rect = input.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) || 14;
    const halfSize = Math.round(size / 2);
    const outerRect = makeDOMRect(rect.left, rect.top, size, size);
    const base = realm.getComputedStyle(input);
    const outerStyle = createStyleProxy(base, {
      ...solidBorder("2px", checked ? CHROME_ACCENT : CHROME_BORDER),
      ...circleRadius(halfSize),
      "background-color": "rgb(255, 255, 255)",
      "display": "flex",
      "justify-content": "center",
      "align-items": "center",
      "overflow": "visible",
      "position": "static",
      "opacity": "1"
    });
    const outer = {
      nodeType: "element",
      tag: "#form-radio",
      computedStyle: outerStyle,
      boundingRect: outerRect,
      children: [],
      domNode: input,
      visible: true,
      metadata: { isFormContent: true }
    };
    if (checked) {
      const dotSize = Math.round(size * 0.4);
      const dotOffset = Math.round((size - dotSize) / 2);
      const dotRect = makeDOMRect(rect.left + dotOffset, rect.top + dotOffset, dotSize, dotSize);
      const dotHalf = Math.round(dotSize / 2);
      outer.children.push({
        nodeType: "element",
        tag: "#form-radio-dot",
        computedStyle: createStyleProxy(base, {
          ...NO_BORDER,
          ...circleRadius(dotHalf),
          "background-color": CHROME_ACCENT,
          "display": "block",
          "position": "static",
          "overflow": "visible",
          "opacity": "1"
        }),
        boundingRect: dotRect,
        children: [],
        domNode: input,
        visible: true,
        metadata: { isFormContent: true }
      });
    }
    renderNode.children.push(outer);
  }
  function injectRangeContent(input, renderNode) {
    const rect = input.getBoundingClientRect();
    const base = realm.getComputedStyle(input);
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    const val = parseFloat(input.value) || 0;
    const ratio = Math.max(0, Math.min(1, (val - min) / (max - min)));
    const trackH = 8;
    const trackRadius = `${trackH / 2}px`;
    const thumbSize = 16;
    const trackY = rect.top + (rect.height - trackH) / 2;
    const trackW = rect.width;
    const filledW = trackW * ratio;
    if (filledW > 0) {
      renderNode.children.push({
        nodeType: "element",
        tag: "#form-range-filled",
        computedStyle: createStyleProxy(base, {
          ...NO_BORDER,
          "background-color": CHROME_ACCENT,
          "border-top-left-radius": trackRadius,
          "border-top-right-radius": ratio >= 1 ? trackRadius : "0px",
          "border-bottom-left-radius": trackRadius,
          "border-bottom-right-radius": ratio >= 1 ? trackRadius : "0px",
          "display": "block",
          "position": "absolute",
          "overflow": "visible",
          "opacity": "1"
        }),
        boundingRect: makeDOMRect(rect.left, trackY, filledW, trackH),
        children: [],
        domNode: input,
        visible: true,
        metadata: { isFormContent: true }
      });
    }
    const remainW = trackW - filledW;
    if (remainW > 0) {
      renderNode.children.push({
        nodeType: "element",
        tag: "#form-range-track",
        computedStyle: createStyleProxy(base, {
          ...NO_BORDER,
          "background-color": CHROME_TRACK,
          "border-top-left-radius": ratio <= 0 ? trackRadius : "0px",
          "border-top-right-radius": trackRadius,
          "border-bottom-left-radius": ratio <= 0 ? trackRadius : "0px",
          "border-bottom-right-radius": trackRadius,
          "display": "block",
          "position": "absolute",
          "overflow": "visible",
          "opacity": "1"
        }),
        boundingRect: makeDOMRect(rect.left + filledW, trackY, remainW, trackH),
        children: [],
        domNode: input,
        visible: true,
        metadata: { isFormContent: true }
      });
    }
    const thumbX = rect.left + filledW - thumbSize / 2;
    const thumbY = rect.top + (rect.height - thumbSize) / 2;
    renderNode.children.push({
      nodeType: "element",
      tag: "#form-range-thumb",
      computedStyle: createStyleProxy(base, {
        "background-color": CHROME_ACCENT,
        ...circleRadius(thumbSize / 2),
        ...solidBorder("1px", "rgba(0, 0, 0, 0.1)"),
        "display": "block",
        "position": "absolute",
        "overflow": "visible",
        "opacity": "1"
      }),
      boundingRect: makeDOMRect(thumbX, thumbY, thumbSize, thumbSize),
      children: [],
      domNode: input,
      visible: true,
      metadata: { isFormContent: true }
    });
  }
  function pushFormTextChild(element, text, style, parentRenderNode) {
    parentRenderNode.children.push({
      nodeType: "text",
      tag: "#form-text",
      textContent: text,
      computedStyle: style,
      boundingRect: element.getBoundingClientRect(),
      children: [],
      domNode: element,
      visible: true,
      metadata: { isFormContent: true }
    });
  }
  function getPlaceholderStyle(element) {
    const elementStyle = realm.getComputedStyle(element);
    const placeholderStyle = realm.getComputedStyle(element, "::placeholder");
    return createStyleProxy(elementStyle, {
      "color": placeholderStyle.color || elementStyle.color
    });
  }
  function makeDOMRect(x, y, w, h) {
    return {
      x,
      y,
      width: w,
      height: h,
      left: x,
      top: y,
      right: x + w,
      bottom: y + h,
      toJSON: () => ({})
    };
  }
  var NO_BORDER = {
    "border-top-width": "0px",
    "border-right-width": "0px",
    "border-bottom-width": "0px",
    "border-left-width": "0px",
    "border-top-style": "none",
    "border-right-style": "none",
    "border-bottom-style": "none",
    "border-left-style": "none"
  };
  function solidBorder(width, color) {
    return {
      "border-top-width": width,
      "border-right-width": width,
      "border-bottom-width": width,
      "border-left-width": width,
      "border-top-style": "solid",
      "border-right-style": "solid",
      "border-bottom-style": "solid",
      "border-left-style": "solid",
      "border-top-color": color,
      "border-right-color": color,
      "border-bottom-color": color,
      "border-left-color": color
    };
  }
  function circleRadius(r) {
    const v = `${r}px`;
    return {
      "border-top-left-radius": v,
      "border-top-right-radius": v,
      "border-bottom-left-radius": v,
      "border-bottom-right-radius": v
    };
  }
  function createStyleProxy(base, overrides) {
    const camelOverrides = {};
    for (const [key, val] of Object.entries(overrides)) {
      camelOverrides[key] = val;
      camelOverrides[kebabToCamel(key)] = val;
    }
    const handler = {
      get(target, prop) {
        if (typeof prop === "string" && prop in camelOverrides) {
          return camelOverrides[prop];
        }
        if (prop === "getPropertyValue") {
          return (name) => {
            if (name in overrides) return overrides[name];
            const camel = kebabToCamel(name);
            if (camel in camelOverrides) return camelOverrides[camel];
            return target.getPropertyValue(name);
          };
        }
        const value = target[prop];
        if (typeof value === "function") return value.bind(target);
        return value;
      }
    };
    return new Proxy(base, handler);
  }
  function kebabToCamel(s) {
    return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  // third-party/html2figma/upstream/packages/browser/traverser/list.ts
  function injectListMarker(element, renderNode) {
    const style = renderNode.computedStyle;
    if (!style) return;
    const display = style.getPropertyValue("display");
    if (display !== "list-item") return;
    const listStyleType = style.getPropertyValue("list-style-type");
    if (!listStyleType || listStyleType === "none") return;
    const markerText = generateMarkerText(listStyleType, element);
    if (!markerText) return;
    renderNode.metadata = {
      ...renderNode.metadata,
      listMarker: markerText,
      listStylePosition: style.getPropertyValue("list-style-position") || "outside"
    };
  }
  function generateMarkerText(type, element) {
    switch (type) {
      case "disc":
        return "\u2022";
      // •
      case "circle":
        return "\u25E6";
      // ◦
      case "square":
        return "\u25AA";
      // ▪
      case "decimal":
        return `${getListItemIndex(element)}.`;
      case "decimal-leading-zero": {
        const idx = getListItemIndex(element);
        return `${idx < 10 ? "0" : ""}${idx}.`;
      }
      case "lower-alpha":
      case "lower-latin":
        return `${toLetter(getListItemIndex(element), false)}.`;
      case "upper-alpha":
      case "upper-latin":
        return `${toLetter(getListItemIndex(element), true)}.`;
      case "lower-roman":
        return `${toRoman(getListItemIndex(element), false)}.`;
      case "upper-roman":
        return `${toRoman(getListItemIndex(element), true)}.`;
      case "cjk-decimal":
      case "cjk-ideographic":
      case "trad-chinese-informal":
        return `${toCJKDecimal(getListItemIndex(element))}\u3001`;
      default:
        return "\u2022";
    }
  }
  function getListItemIndex(element) {
    const valueAttr = element.getAttribute("value");
    if (valueAttr != null) {
      const parsed = parseInt(valueAttr, 10);
      if (!isNaN(parsed)) return parsed;
    }
    const parent = element.parentElement;
    let start = 1;
    if (parent && parent.tagName.toLowerCase() === "ol") {
      const startAttr = parent.getAttribute("start");
      if (startAttr) {
        const parsed = parseInt(startAttr, 10);
        if (!isNaN(parsed)) start = parsed;
      }
    }
    let index = 0;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.tagName.toLowerCase() === "li") index++;
      sibling = sibling.previousElementSibling;
    }
    return start + index;
  }
  function toLetter(n, upper) {
    let result = "";
    while (n > 0) {
      n--;
      result = String.fromCharCode((upper ? 65 : 97) + n % 26) + result;
      n = Math.floor(n / 26);
    }
    return result || (upper ? "A" : "a");
  }
  function toRoman(n, upper) {
    const values = [1e3, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
    const symbols = ["m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"];
    let result = "";
    for (let i = 0; i < values.length; i++) {
      while (n >= values[i]) {
        result += symbols[i];
        n -= values[i];
      }
    }
    return upper ? result.toUpperCase() : result;
  }
  function toCJKDecimal(n) {
    const digits = ["\u3007", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u4E03", "\u516B", "\u4E5D"];
    if (n <= 0) return digits[0];
    if (n < 10) return digits[n];
    if (n < 100) {
      const tens = Math.floor(n / 10);
      const ones = n % 10;
      return (tens > 1 ? digits[tens] : "") + "\u5341" + (ones > 0 ? digits[ones] : "");
    }
    return String(n).split("").map((d) => digits[parseInt(d)]).join("");
  }

  // third-party/html2figma/upstream/packages/shared/utils.ts
  var _idCounter = 0;
  function generateId(prefix = "node") {
    const timestamp = Date.now();
    const counter = ++_idCounter;
    const random = Math.random().toString(36).substring(2, 7);
    return `${prefix}_${timestamp}_${counter}_${random}`;
  }
  function normalizeWhitespace(text, parentElement, isFirstNode = false, isLastNode = false) {
    const computedStyle = realm.getComputedStyle(parentElement);
    const whiteSpace = computedStyle.whiteSpace;
    switch (whiteSpace) {
      case "pre":
        return text;
      case "pre-wrap":
        return text;
      case "pre-line":
        let result = text.replace(/[ \t]+/g, " ");
        result = result.replace(/[ \t]*\n[ \t]*/g, "\n");
        return result;
      case "nowrap":
      case "normal":
      default:
        let normalized = text.replace(/[\s\n\r\t]+/g, " ");
        const hasTrailingSpace = /\s$/.test(normalized);
        if (isFirstNode) {
          normalized = normalized.replace(/^\s+/, "");
        }
        if (isLastNode) {
          normalized = normalized.replace(/\s+$/, "");
        }
        if (hasTrailingSpace && normalized.length > 0) {
          normalized = normalized + "\xA0";
        }
        return normalized;
    }
  }

  // third-party/html2figma/upstream/packages/shared/css-utils.ts
  function parsePx(value) {
    if (!value) return 0;
    const match = value.match(/^(-?\d+(?:\.\d+)?)(px|em|rem|%)?$/);
    if (!match) return 0;
    return parseFloat(match[1]);
  }
  function parseAngle(value) {
    if (!value) return 0;
    if (value.endsWith("deg")) {
      return parseFloat(value);
    } else if (value.endsWith("rad")) {
      return parseFloat(value) * (180 / Math.PI);
    } else if (value.endsWith("grad")) {
      return parseFloat(value) * (180 / 200);
    } else if (value.endsWith("turn")) {
      return parseFloat(value) * 360;
    }
    return parseFloat(value) || 0;
  }
  function parseTransformOrigin(origin, boundingRect) {
    const parts = origin.split(" ");
    let x = boundingRect.width / 2;
    let y = boundingRect.height / 2;
    const parseOriginValue = (value, dimension) => {
      if (value.includes("%")) {
        return parseFloat(value) / 100 * dimension;
      } else if (value.includes("px")) {
        return parseFloat(value);
      } else if (value === "left" || value === "top") {
        return 0;
      } else if (value === "right" || value === "bottom") {
        return dimension;
      } else if (value === "center") {
        return dimension / 2;
      }
      return parseFloat(value) || 0;
    };
    if (parts.length >= 1) {
      x = parseOriginValue(parts[0], boundingRect.width);
    }
    if (parts.length >= 2) {
      y = parseOriginValue(parts[1], boundingRect.height);
    }
    return { x, y };
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

  // third-party/html2figma/integration/shared.ts
  var silent = Object.freeze({
    info() {
    },
    warn() {
    },
    error() {
    },
    debug() {
    }
  });
  function createLogger(..._arguments) {
    return silent;
  }

  // third-party/html2figma/upstream/packages/browser/traverser/text.ts
  var logger = createLogger("NodeTraverser" /* NODE_TRAVERSER */);
  function removeRotationFromMatrix(matrixStr) {
    const match = matrixStr.match(/matrix\(([^)]+)\)/);
    if (!match) return "none";
    const vals = match[1].split(",").map((v) => parseFloat(v.trim()));
    if (vals.length !== 6) return "none";
    const [a, b, c, d, e, f] = vals;
    const sx = Math.sqrt(a * a + b * b);
    const sy = Math.sqrt(c * c + d * d);
    const det = a * d - b * c;
    const adjustedSy = det < 0 ? -sy : sy;
    return `matrix(${sx}, 0, 0, ${adjustedSy}, ${e}, ${f})`;
  }
  function computeAncestorScale(element) {
    let sx = 1, sy = 1;
    let el = element;
    while (el) {
      const t = realm.getComputedStyle(el).transform;
      if (t && t !== "none") {
        const match = t.match(/matrix\(([^)]+)\)/);
        if (match) {
          const vals = match[1].split(",").map((v) => parseFloat(v.trim()));
          if (vals.length === 6) {
            sx *= Math.sqrt(vals[0] ** 2 + vals[1] ** 2);
            sy *= Math.sqrt(vals[2] ** 2 + vals[3] ** 2);
          }
        }
      }
      el = el.parentElement;
    }
    return { x: sx, y: sy };
  }
  function getUntransformedRangeRect(range, textNode) {
    let ancestor = textNode.parentElement;
    const saved = [];
    while (ancestor) {
      const t = realm.getComputedStyle(ancestor).transform;
      if (t && t !== "none") {
        saved.push({ el: ancestor, value: ancestor.style.transform });
        ancestor.style.transform = removeRotationFromMatrix(t);
      }
      ancestor = ancestor.parentElement;
    }
    if (saved.length > 0) {
      void saved[0].el.offsetHeight;
    }
    const rect = range.getBoundingClientRect();
    for (const s of saved) {
      s.el.style.transform = s.value;
    }
    return rect;
  }
  function detectLineBreaksWithMapping(textNode, originalText, normalizedText) {
    if (!normalizedText || normalizedText.length === 0) {
      return [];
    }
    const whiteSpace = realm.getComputedStyle(textNode.parentElement).whiteSpace;
    if (whiteSpace === "pre" || whiteSpace === "pre-wrap") {
      return detectLineBreaks(textNode, normalizedText);
    }
    if (originalText === normalizedText) {
      return detectLineBreaks(textNode, normalizedText);
    }
    const lines = aggregateTextLinesByCharPosition(textNode, originalText);
    if (lines.length <= 1) {
      return [];
    }
    const indexMap = /* @__PURE__ */ new Map();
    let normalizedIdx = 0;
    let inWhitespace = false;
    let hasSeenNonWhitespace = false;
    for (let i = 0; i < originalText.length; i++) {
      const char = originalText[i];
      const isWhitespace = /[\s\n\r\t]/.test(char);
      if (isWhitespace) {
        if (!hasSeenNonWhitespace) {
          continue;
        }
        if (!inWhitespace) {
          indexMap.set(i, normalizedIdx);
          normalizedIdx++;
          inWhitespace = true;
        } else {
          indexMap.set(i, normalizedIdx - 1);
        }
      } else {
        hasSeenNonWhitespace = true;
        indexMap.set(i, normalizedIdx);
        normalizedIdx++;
        inWhitespace = false;
      }
    }
    const lineBreaks = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      let firstNonWhitespaceIdx = line.startIndex;
      for (let j = line.startIndex; j < line.endIndex; j++) {
        if (!/[\s\n\r\t]/.test(originalText[j])) {
          firstNonWhitespaceIdx = j;
          break;
        }
      }
      const normalizedBreakPos = indexMap.get(firstNonWhitespaceIdx);
      if (normalizedBreakPos !== void 0) {
        if (lineBreaks.length === 0 || lineBreaks[lineBreaks.length - 1] !== normalizedBreakPos) {
          lineBreaks.push(normalizedBreakPos);
        }
      }
    }
    return lineBreaks.sort((a, b) => a - b);
  }
  function aggregateTextLinesByCharPosition(textNode, text) {
    if (!text || text.length === 0) {
      return [];
    }
    const range = realm.document.createRange();
    const charPositions = [];
    try {
      let hasTransformedAncestor = false;
      let el = textNode.parentElement;
      while (el) {
        const t = realm.getComputedStyle(el).transform;
        if (t && t !== "none") {
          hasTransformedAncestor = true;
          break;
        }
        el = el.parentElement;
      }
      const saved = [];
      if (hasTransformedAncestor) {
        let anc = textNode.parentElement;
        while (anc) {
          const t = realm.getComputedStyle(anc).transform;
          if (t && t !== "none") {
            saved.push({ el: anc, value: anc.style.transform });
            anc.style.transform = removeRotationFromMatrix(t);
          }
          anc = anc.parentElement;
        }
        void saved[0].el.offsetHeight;
      }
      for (let i = 0; i < text.length; i++) {
        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          continue;
        }
        charPositions.push({
          char: text[i],
          index: i,
          rect,
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right
        });
      }
      for (const s of saved) {
        s.el.style.transform = s.value;
      }
      if (charPositions.length === 0) {
        return [];
      }
      const lines = [];
      let currentLine = [];
      let currentLineTop = charPositions[0].top;
      for (const charPos of charPositions) {
        const isNewLine = Math.abs(charPos.top - currentLineTop) > 2;
        if (isNewLine && currentLine.length > 0) {
          lines.push(createLineFromChars(currentLine, text));
          currentLine = [charPos];
          currentLineTop = charPos.top;
        } else {
          currentLine.push(charPos);
        }
      }
      if (currentLine.length > 0) {
        lines.push(createLineFromChars(currentLine, text));
      }
      return lines;
    } finally {
      range.detach();
    }
  }
  function createLineFromChars(chars, fullText) {
    const startIndex = chars[0].index;
    const endIndex = chars[chars.length - 1].index + 1;
    const lineText = fullText.substring(startIndex, endIndex);
    const top = Math.min(...chars.map((c) => c.top));
    const bottom = Math.max(...chars.map((c) => c.bottom));
    const left = Math.min(...chars.map((c) => c.left));
    const right = Math.max(...chars.map((c) => c.right));
    const width = right - left;
    const height = bottom - top;
    return {
      text: lineText,
      startIndex,
      endIndex,
      top,
      bottom,
      left,
      right,
      width,
      height
    };
  }
  function detectLineBreaks(textNode, text) {
    const lines = aggregateTextLinesByCharPosition(textNode, text);
    if (lines.length <= 1) {
      return [];
    }
    const lineBreaks = [];
    for (let i = 1; i < lines.length; i++) {
      lineBreaks.push(lines[i].startIndex);
    }
    return lineBreaks;
  }
  function insertLineBreaks(text, lineBreaks) {
    if (lineBreaks.length === 0) {
      return text;
    }
    let result = "";
    let lastIndex = 0;
    for (const breakIndex of lineBreaks) {
      result += text.substring(lastIndex, breakIndex) + "\n";
      lastIndex = breakIndex;
    }
    result += text.substring(lastIndex);
    return result;
  }
  function splitTextIntoSegments(textNode, text, lineBreaks, parentRect) {
    if (!text || text.length === 0) {
      return [];
    }
    const segments = [];
    const range = realm.document.createRange();
    try {
      if (lineBreaks.length === 0) {
        range.selectNodeContents(textNode);
        const rect = getUntransformedRangeRect(range, textNode);
        segments.push({
          text,
          x: rect.left,
          // Absolute coordinates (relative to viewport)
          y: rect.top,
          // Absolute coordinates (relative to viewport)
          width: rect.width,
          height: rect.height,
          startIndex: 0,
          endIndex: text.length
        });
        return segments;
      }
      let startIndex = 0;
      const breakPoints = [...lineBreaks, text.length];
      for (const endIndex of breakPoints) {
        if (startIndex >= endIndex) {
          startIndex = endIndex;
          continue;
        }
        const segmentText = text.substring(startIndex, endIndex);
        if (segmentText.trim().length === 0) {
          startIndex = endIndex;
          continue;
        }
        range.setStart(textNode, startIndex);
        range.setEnd(textNode, endIndex);
        const rect = getUntransformedRangeRect(range, textNode);
        if (rect.width > 0 && rect.height > 0) {
          segments.push({
            text: segmentText,
            x: rect.left,
            // Absolute coordinates (relative to viewport)
            y: rect.top,
            // Absolute coordinates (relative to viewport)
            width: rect.width,
            height: rect.height,
            startIndex,
            endIndex
          });
        }
        startIndex = endIndex;
      }
    } finally {
      range.detach();
    }
    return segments;
  }
  function analyzeTextNode(textNode, parentElement, parentComputedStyle) {
    const textContent = textNode.textContent || "";
    const siblings = Array.from(parentElement.childNodes);
    const nodeIndex = siblings.indexOf(textNode);
    const isFirstTextNode = nodeIndex === 0;
    const isLastTextNode = nodeIndex === siblings.length - 1;
    const parentDisplay = realm.getComputedStyle(parentElement).display;
    const parentIsFlexOrGrid = parentDisplay === "flex" || parentDisplay === "inline-flex" || parentDisplay === "grid" || parentDisplay === "inline-grid";
    const nextSiblingNode = nodeIndex < siblings.length - 1 ? siblings[nodeIndex + 1] : null;
    const nextSiblingIsBlock = !parentIsFlexOrGrid && nextSiblingNode?.nodeType === realm.Node.ELEMENT_NODE ? (() => {
      const d = realm.getComputedStyle(nextSiblingNode).display;
      return d === "block" || d === "flex" || d === "grid" || d === "inline-flex" || d === "inline-grid" || d === "table";
    })() : false;
    const effectiveIsLast = isLastTextNode || parentIsFlexOrGrid || nextSiblingIsBlock;
    const normalizedText = normalizeWhitespace(
      textContent,
      parentElement,
      isFirstTextNode,
      effectiveIsLast
    );
    if (normalizedText === "") {
      return null;
    }
    const range = realm.document.createRange();
    range.selectNodeContents(textNode);
    const boundingRect = getUntransformedRangeRect(range, textNode);
    range.detach();
    if (boundingRect.width <= 0 || boundingRect.height <= 0) {
      return null;
    }
    return {
      textNode,
      originalText: textContent,
      normalizedText,
      parentElement,
      parentComputedStyle,
      boundingRect,
      isFirstTextNode,
      isLastTextNode
    };
  }
  function replaceLeadingTrailingSpaces(text) {
    if (!text) return text;
    let result = text.replace(/^( +)/, (match) => "\xA0".repeat(match.length));
    result = result.replace(/( +)$/, (match) => "\xA0".repeat(match.length));
    return result;
  }
  function mapNormalizedToOriginalIndices(normalizedText, originalText, normalizedIndices) {
    const indexMap = /* @__PURE__ */ new Map();
    let normalizedPos = 0;
    let inWhitespace = false;
    for (let originalPos = 0; originalPos < originalText.length; originalPos++) {
      const char = originalText[originalPos];
      const isWhitespace = /\s/.test(char);
      if (isWhitespace) {
        if (!inWhitespace) {
          if (normalizedPos < normalizedText.length && /\s/.test(normalizedText[normalizedPos])) {
            indexMap.set(normalizedPos, originalPos);
            normalizedPos++;
          }
          inWhitespace = true;
        }
      } else {
        indexMap.set(normalizedPos, originalPos);
        normalizedPos++;
        inWhitespace = false;
      }
    }
    indexMap.set(normalizedText.length, originalText.length);
    return normalizedIndices.map((normalizedIdx) => {
      const originalIdx = indexMap.get(normalizedIdx);
      if (originalIdx === void 0) {
        logger.warn("[mapNormalizedToOriginalIndices] Unable to map index:", normalizedIdx);
        return normalizedIdx;
      }
      return originalIdx;
    });
  }
  function preprocessTextNode(metadata, mode) {
    const { textNode, originalText, normalizedText, parentElement } = metadata;
    const parentStyle = parentElement ? realm.getComputedStyle(parentElement) : null;
    const whiteSpace = parentStyle?.whiteSpace || "";
    if (whiteSpace && whiteSpace.startsWith("pre")) {
      if (mode === "insert") {
        return replaceLeadingTrailingSpaces(normalizedText);
      }
    }
    const writingMode = parentStyle?.writingMode || "";
    if (writingMode === "vertical-rl" || writingMode === "vertical-lr") {
      if (mode === "insert") {
        return replaceLeadingTrailingSpaces(normalizedText);
      }
    }
    const lineBreaks = detectLineBreaksWithMapping(textNode, originalText, normalizedText);
    logger.info(`[Text] lineBreaks detected: [${lineBreaks.join(",")}] for "${normalizedText.substring(0, 60)}"`);
    if (mode === "insert") {
      let result = lineBreaks.length > 0 ? insertLineBreaks(normalizedText, lineBreaks) : normalizedText;
      result = replaceLeadingTrailingSpaces(result);
      return result;
    } else {
      const parentRect = parentElement.getBoundingClientRect();
      const originalLineBreaks = mapNormalizedToOriginalIndices(normalizedText, originalText, lineBreaks);
      const segments = splitTextIntoSegments(textNode, originalText, originalLineBreaks, parentRect);
      const normalizedSegments = segments.map((segment, index) => {
        const normalizedStart = index === 0 ? 0 : lineBreaks[index - 1];
        const normalizedEnd = index < lineBreaks.length ? lineBreaks[index] : normalizedText.length;
        let normalizedSegmentText = normalizedText.substring(normalizedStart, normalizedEnd);
        normalizedSegmentText = replaceLeadingTrailingSpaces(normalizedSegmentText);
        return {
          ...segment,
          text: normalizedSegmentText,
          // Use processed text
          startIndex: normalizedStart,
          endIndex: normalizedEnd
        };
      });
      return normalizedSegments;
    }
  }
  function hasMultipleInlineElements(parentElement) {
    const children = Array.from(parentElement.childNodes);
    let inlineElementCount = 0;
    for (const child of children) {
      if (child.nodeType === realm.Node.ELEMENT_NODE) {
        const style = realm.getComputedStyle(child);
        const display = style.display;
        if (display === "inline" || display === "inline-block" || display === "inline-flex") {
          inlineElementCount++;
          if (inlineElementCount > 1) {
            return true;
          }
        }
      } else if (child.nodeType === realm.Node.TEXT_NODE) {
        const textContent = child.textContent || "";
        if (textContent.trim().length > 0) {
          inlineElementCount++;
          if (inlineElementCount > 1) {
            return true;
          }
        }
      }
    }
    return false;
  }
  function traverseTextNode(textNode, depth, options) {
    if (!options.includeTextNodes) {
      return null;
    }
    if (depth > options.maxDepth) {
      return null;
    }
    if (options.filter && !options.filter(textNode, depth)) {
      return null;
    }
    if (!hasValidTextContent(textNode, options.preserveWhitespace)) {
      return null;
    }
    let computedStyle;
    if (!textNode.parentElement) {
      return null;
    }
    computedStyle = realm.getComputedStyle(textNode.parentElement);
    const ancestorScale = computeAncestorScale(textNode.parentElement);
    const hasAncestorScale = Math.abs(ancestorScale.x - 1) > 1e-3 || Math.abs(ancestorScale.y - 1) > 1e-3;
    const enablePreprocess = options.enableTextPreprocess !== false;
    if (enablePreprocess) {
      const metadata = analyzeTextNode(textNode, textNode.parentElement, computedStyle);
      if (!metadata) {
        return null;
      }
      const hasMultipleInlines = hasMultipleInlineElements(textNode.parentElement);
      const preprocessMode = hasMultipleInlines ? "split" : "insert";
      logger.info(`[Text] mode=${preprocessMode} parent=<${textNode.parentElement.tagName.toLowerCase()}> original="${metadata.originalText.substring(0, 60)}" normalized="${metadata.normalizedText.substring(0, 60)}"`);
      if (preprocessMode === "insert") {
        const processedText = preprocessTextNode(metadata, "insert");
        logger.info(`[Text] insert result: "${processedText.substring(0, 80)}" hasLineBreaks=${processedText.includes("\n")}`);
        let boundingRect2;
        try {
          const range = realm.document.createRange();
          range.selectNodeContents(textNode);
          boundingRect2 = getUntransformedRangeRect(range, textNode);
        } catch (e) {
          logger.warn("Unable to get text boundingRect, using parent element:", e);
          if (textNode.parentElement) {
            boundingRect2 = textNode.parentElement.getBoundingClientRect();
          }
        }
        const renderNode2 = {
          nodeType: "text",
          textContent: processedText,
          boundingRect: boundingRect2,
          children: [],
          domNode: textNode,
          visible: true,
          computedStyle
        };
        if (options.extractMetadata) {
          renderNode2.metadata = options.extractMetadata(textNode);
        }
        if (hasAncestorScale) {
          renderNode2.metadata = { ...renderNode2.metadata, ancestorScale };
        }
        return renderNode2;
      } else {
        const segments = preprocessTextNode(metadata, "split");
        logger.info(`[Text] split result: ${segments.length} segments`, segments.map((s) => ({ text: s.text.substring(0, 40), x: s.x, y: s.y, w: s.width, h: s.height })));
        if (segments.length === 0) {
          return null;
        }
        const renderNodes = segments.map((segment, index) => {
          const segmentRect = {
            x: segment.x,
            y: segment.y,
            width: segment.width,
            height: segment.height,
            left: segment.x,
            top: segment.y,
            right: segment.x + segment.width,
            bottom: segment.y + segment.height,
            toJSON: () => ({})
          };
          const isLastSegment = index === segments.length - 1;
          const renderNode2 = {
            nodeType: "text",
            textContent: segment.text,
            boundingRect: segmentRect,
            children: [],
            domNode: textNode,
            visible: true,
            computedStyle,
            metadata: {
              segmentIndex: index,
              totalSegments: segments.length,
              startIndex: segment.startIndex,
              endIndex: segment.endIndex,
              isTextSegment: true,
              hasLineBreakAfter: !isLastSegment,
              // All segments except the last have a line break after
              ...hasAncestorScale ? { ancestorScale } : {}
            }
          };
          if (options.extractMetadata) {
            const userMetadata = options.extractMetadata(textNode);
            if (userMetadata) {
              renderNode2.metadata = { ...renderNode2.metadata, ...userMetadata };
            }
          }
          return renderNode2;
        });
        return renderNodes;
      }
    }
    let boundingRect;
    try {
      const range = realm.document.createRange();
      range.selectNodeContents(textNode);
      boundingRect = getUntransformedRangeRect(range, textNode);
    } catch (e) {
      logger.warn("Unable to get boundingRect, using parent element:", e);
      if (textNode.parentElement) {
        boundingRect = textNode.parentElement.getBoundingClientRect();
      }
    }
    const renderNode = {
      nodeType: "text",
      textContent: textNode.textContent || "",
      boundingRect,
      children: [],
      domNode: textNode,
      visible: true,
      computedStyle
    };
    if (options.extractMetadata) {
      renderNode.metadata = options.extractMetadata(textNode);
    }
    if (hasAncestorScale) {
      renderNode.metadata = { ...renderNode.metadata, ancestorScale };
    }
    return renderNode;
  }

  // third-party/html2figma/upstream/packages/browser/traverser/semanticId.ts
  var MAX_SELECTOR_CLASSES = 3;
  var idCache = /* @__PURE__ */ new WeakMap();
  function buildSegment(el) {
    const explicitId = el.getAttribute("data-semantic-id");
    if (explicitId) return explicitId;
    const htmlId = el.id;
    if (htmlId) return `#${htmlId}`;
    const component = el.getAttribute("data-component");
    if (component) {
      const idx2 = getSiblingIndex(el);
      return idx2 > 0 ? `${component}:${idx2}` : component;
    }
    const tag = el.tagName.toLowerCase();
    const classes = getClassSelector(el);
    const idx = getSiblingIndex(el);
    const suffix = idx > 0 ? `:${idx}` : "";
    return `${tag}${classes}${suffix}`;
  }
  function buildSemanticId(el, root) {
    const cached = idCache.get(el);
    if (cached) return cached;
    const segments = [];
    let current = el;
    let prefix = "";
    while (current && current !== root) {
      if (current.nodeType !== realm.Node.ELEMENT_NODE) break;
      if (current !== el) {
        const ancestorCached = idCache.get(current);
        if (ancestorCached) {
          prefix = ancestorCached;
          break;
        }
      }
      segments.unshift(buildSegment(current));
      const hasAnchor = current.id || current.getAttribute("data-semantic-id");
      if (hasAnchor && current !== el) break;
      current = current.parentElement;
    }
    const ownPath = segments.join(" > ");
    const result = prefix ? `${prefix} > ${ownPath}` : ownPath;
    idCache.set(el, result);
    return result;
  }
  function extractSemanticInfo(el, root) {
    const semanticId = buildSemanticId(el, root);
    const info = { semanticId };
    const attributes = extractAttributes(el);
    if (attributes) info.attributes = attributes;
    const classList = getClassList(el);
    if (classList.length > 0) info.classList = classList;
    const cssSelector = buildCssSelector(el);
    if (cssSelector) info.cssSelector = cssSelector;
    const component = extractComponentInfo(el);
    if (component) info.component = component;
    const file = el.getAttribute("data-component-file");
    if (file) {
      info.sourceLocation = { file };
      const line = el.getAttribute("data-component-line");
      if (line) info.sourceLocation.line = parseInt(line, 10);
    }
    return info;
  }
  function getClassList(el) {
    if (!el.className || typeof el.className !== "string") return [];
    return el.className.trim().split(/\s+/).filter(Boolean);
  }
  function getClassSelector(el) {
    const classes = getClassList(el);
    if (classes.length === 0) return "";
    return "." + classes.slice(0, 2).join(".");
  }
  function getSiblingIndex(el) {
    const parent = el.parentElement;
    if (!parent) return 0;
    const tag = el.tagName;
    const sameTags = Array.from(parent.children).filter((c) => c.tagName === tag);
    if (sameTags.length <= 1) return 0;
    return sameTags.indexOf(el);
  }
  function extractAttributes(el) {
    const attrs = {};
    let hasAny = false;
    if (el.id) {
      attrs.id = el.id;
      hasAny = true;
    }
    const dataAttrs = {};
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("data-") && !attr.name.startsWith("data-semantic-") && !attr.name.startsWith("data-component")) {
        dataAttrs[attr.name] = attr.value;
      }
    }
    if (Object.keys(dataAttrs).length > 0) {
      attrs.dataAttributes = dataAttrs;
      hasAny = true;
    }
    const ariaAttrs = {};
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("aria-")) {
        ariaAttrs[attr.name] = attr.value;
      }
    }
    if (Object.keys(ariaAttrs).length > 0) {
      attrs.ariaAttributes = ariaAttrs;
      hasAny = true;
    }
    const href = el.getAttribute("href");
    if (href) {
      attrs.href = href;
      hasAny = true;
    }
    const src = el.getAttribute("src");
    if (src) {
      attrs.src = src;
      hasAny = true;
    }
    const alt = el.getAttribute("alt");
    if (alt) {
      attrs.alt = alt;
      hasAny = true;
    }
    const type = el.getAttribute("type");
    if (type) {
      attrs.type = type;
      hasAny = true;
    }
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) {
      attrs.placeholder = placeholder;
      hasAny = true;
    }
    return hasAny ? attrs : void 0;
  }
  function extractComponentInfo(el) {
    const name = el.getAttribute("data-component");
    if (!name) return void 0;
    const info = { name };
    const framework = el.getAttribute("data-component-framework");
    if (framework && ["react", "vue", "svelte", "html"].includes(framework)) {
      info.framework = framework;
    }
    const props = {};
    let hasProps = false;
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("data-prop-")) {
        const propName = attr.name.slice("data-prop-".length);
        props[propName] = attr.value;
        hasProps = true;
      }
    }
    if (hasProps) info.props = props;
    return info;
  }
  function buildCssSelector(el) {
    if (el.id) return `#${el.id}`;
    const tag = el.tagName.toLowerCase();
    const classes = getClassList(el);
    if (classes.length > 0) {
      return `${tag}.${classes.slice(0, MAX_SELECTOR_CLASSES).join(".")}`;
    }
    const parent = el.parentElement;
    if (parent) {
      const idx = Array.from(parent.children).indexOf(el) + 1;
      return `${tag}:nth-child(${idx})`;
    }
    return tag;
  }

  // third-party/html2figma/upstream/packages/browser/traverser/core.ts
  var DEFAULT_OPTIONS = {
    includeInvisible: false,
    maxDepth: Infinity,
    includeTextNodes: true,
    preserveWhitespace: false
  };
  function traverseElement(element, depth, options) {
    if (depth > options.maxDepth) {
      return null;
    }
    const tagName = element.tagName.toLowerCase();
    if (tagName === "option" || tagName === "optgroup") {
      return null;
    }
    if (options.filter && !options.filter(element, depth)) {
      return null;
    }
    const computedStyle = realm.getComputedStyle(element);
    const visible = isElementVisible(element, computedStyle);
    if (!visible && !options.includeInvisible) {
      return null;
    }
    const boundingRect = element.getBoundingClientRect();
    let originalRect;
    const transform = computedStyle.transform;
    if (transform && transform !== "none" && element instanceof realm.HTMLElement) {
      originalRect = {
        x: element.offsetLeft,
        y: element.offsetTop,
        width: element.offsetWidth,
        height: element.offsetHeight
      };
    }
    const renderNode = {
      nodeType: "element",
      tag: element.tagName.toLowerCase(),
      computedStyle,
      boundingRect,
      children: [],
      domNode: element,
      visible,
      originalRect
    };
    if (options.extractMetadata) {
      renderNode.metadata = options.extractMetadata(element);
    }
    const semantic = extractSemanticInfo(element);
    if (!renderNode.metadata) renderNode.metadata = {};
    renderNode.metadata.semantic = semantic;
    const beforeNode = capturePseudoElement(element, "::before");
    if (beforeNode) {
      renderNode.children.push(beforeNode);
    }
    for (let i = 0; i < element.childNodes.length; i++) {
      const childNode = element.childNodes[i];
      const childRenderNode = traverseNode(childNode, depth + 1, options);
      if (childRenderNode) {
        if (Array.isArray(childRenderNode)) {
          renderNode.children.push(...childRenderNode);
        } else {
          renderNode.children.push(childRenderNode);
        }
      }
    }
    injectFormContent(element, renderNode);
    injectListMarker(element, renderNode);
    const afterNode = capturePseudoElement(element, "::after");
    if (afterNode) {
      renderNode.children.push(afterNode);
    }
    return renderNode;
  }
  function traverseNode(node, depth, options) {
    if (node.nodeType === realm.Node.ELEMENT_NODE) {
      return traverseElement(node, depth, options);
    } else if (node.nodeType === realm.Node.TEXT_NODE) {
      return traverseTextNode(node, depth, options);
    }
    return null;
  }
  function traverseDOM(rootElement, options = {}) {
    const mergedOptions = {
      ...DEFAULT_OPTIONS,
      ...options,
      enableTextPreprocess: options.enableTextPreprocess !== false
      // Default: enabled
    };
    return traverseElement(rootElement, 0, mergedOptions);
  }

  // third-party/html2figma/upstream/packages/browser/converter/utils.ts
  var colorCache = /* @__PURE__ */ new Map();
  function parseColor(colorString) {
    if (!colorString || colorString === "transparent" || colorString === "none" || colorString === "initial" || colorString === "inherit") {
      return null;
    }
    if (colorCache.has(colorString)) {
      const cached = colorCache.get(colorString);
      return cached ? { ...cached } : null;
    }
    const result = parseColorUncached(colorString);
    colorCache.set(colorString, result);
    return result;
  }
  function parseColorUncached(colorString) {
    const rgbaMatch = colorString.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (rgbaMatch) {
      return {
        r: parseInt(rgbaMatch[1]),
        g: parseInt(rgbaMatch[2]),
        b: parseInt(rgbaMatch[3]),
        a: rgbaMatch[4] !== void 0 ? parseFloat(rgbaMatch[4]) : 1,
        raw: colorString
      };
    }
    const rgbSpaceMatch = colorString.match(/rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+%?))?\s*\)/);
    if (rgbSpaceMatch) {
      let alpha = 1;
      if (rgbSpaceMatch[4] !== void 0) {
        alpha = rgbSpaceMatch[4].endsWith("%") ? parseFloat(rgbSpaceMatch[4]) / 100 : parseFloat(rgbSpaceMatch[4]);
      }
      return {
        r: parseInt(rgbSpaceMatch[1]),
        g: parseInt(rgbSpaceMatch[2]),
        b: parseInt(rgbSpaceMatch[3]),
        a: alpha,
        raw: colorString
      };
    }
    if (colorString.startsWith("#")) {
      const hex = colorString.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          return { r, g, b, a, raw: colorString };
        }
      }
      if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const a = hex.length === 8 ? parseInt(hex.substr(6, 2), 16) / 255 : 1;
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          return { r, g, b, a, raw: colorString };
        }
      }
    }
    try {
      const div = realm.document.createElement("div");
      div.style.color = colorString;
      realm.document.body.appendChild(div);
      const computed = realm.getComputedStyle(div).color;
      realm.document.body.removeChild(div);
      const match = computed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
      if (match) {
        return {
          r: parseInt(match[1]),
          g: parseInt(match[2]),
          b: parseInt(match[3]),
          a: match[4] !== void 0 ? parseFloat(match[4]) : 1,
          raw: colorString
        };
      }
    } catch {
    }
    return null;
  }
  function parseSpacing(computedStyle, prefix) {
    return {
      top: parsePx(computedStyle[`${prefix}-top`] || computedStyle[`${prefix}Top`] || "0"),
      right: parsePx(computedStyle[`${prefix}-right`] || computedStyle[`${prefix}Right`] || "0"),
      bottom: parsePx(computedStyle[`${prefix}-bottom`] || computedStyle[`${prefix}Bottom`] || "0"),
      left: parsePx(computedStyle[`${prefix}-left`] || computedStyle[`${prefix}Left`] || "0")
    };
  }
  function isTransparent(color) {
    if (!color) return true;
    return color.a === 0;
  }
  function getStyle(styles, ...keys) {
    for (const key of keys) {
      if (styles[key]) return styles[key];
    }
    return "";
  }
  function extractUrlFromCss(cssValue) {
    if (!cssValue || !cssValue.includes("url(")) {
      return null;
    }
    const match = cssValue.match(/url\s*\(\s*['"]?([^'")\s]+)['"]?\s*\)/i);
    return match ? match[1] : null;
  }
  function computedStyleToRecord(computedStyle) {
    const result = {};
    for (let i = 0; i < computedStyle.length; i++) {
      const property = computedStyle[i];
      const value = computedStyle.getPropertyValue(property);
      if (value && value !== "initial" && value !== "inherit" && value !== "unset") {
        result[property] = value;
      }
    }
    const explicitProps = ["-webkit-line-clamp", "-webkit-box-orient", "border-spacing"];
    for (const prop of explicitProps) {
      if (!(prop in result)) {
        const val = computedStyle.getPropertyValue(prop);
        if (val && val !== "none" && val !== "initial" && val !== "inherit" && val !== "unset") {
          result[prop] = val;
        }
      }
    }
    return result;
  }
  function visualBounds(node) {
    const b = node.bounds;
    if (b.width > 0 && b.height > 0) return b;
    const children = node.children;
    if (!children || children.length === 0) return b;
    let minX = b.x, minY = b.y;
    let maxX = b.x + b.width, maxY = b.y + b.height;
    for (const child of children) {
      if (child.positioning?.mode === "fixed") continue;
      const cb = visualBounds(child);
      const cx = b.x + cb.x;
      const cy = b.y + cb.y;
      minX = Math.min(minX, cx);
      minY = Math.min(minY, cy);
      maxX = Math.max(maxX, cx + cb.width);
      maxY = Math.max(maxY, cy + cb.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  function unionBounds(nodes) {
    if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      const vb = visualBounds(node);
      minX = Math.min(minX, vb.x);
      minY = Math.min(minY, vb.y);
      maxX = Math.max(maxX, vb.x + vb.width);
      maxY = Math.max(maxY, vb.y + vb.height);
    }
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  // third-party/html2figma/upstream/packages/browser/converter/resolvers/style.ts
  var logger2 = createLogger("NodeTraverser" /* NODE_TRAVERSER */);
  function resolveBackground(styles, elementBounds) {
    const layers = [];
    const bgColor = styles["background-color"] || styles["backgroundColor"];
    if (bgColor) {
      const color = parseColor(bgColor);
      if (color && !isTransparent(color)) {
        layers.push({ type: "color", color });
      }
    }
    const bgImage = styles["background-image"] || styles["backgroundImage"] || "";
    const bgValue = styles["background"] || "";
    const imageSource = bgImage !== "none" ? bgImage : bgValue;
    if (imageSource && imageSource !== "none") {
      logger2.info(`[Background] imageSource="${imageSource.substring(0, 120)}" bgSize=${styles["background-size"]} bgPos=${styles["background-position"]} bgRepeat=${styles["background-repeat"]}`);
      const imageLayers = splitBackgroundLayers(imageSource);
      const bgSizes = splitBackgroundLayers(styles["background-size"] || styles["backgroundSize"] || "");
      const bgPositions = splitBackgroundLayers(styles["background-position"] || styles["backgroundPosition"] || "");
      const bgRepeats = splitBackgroundLayers(styles["background-repeat"] || styles["backgroundRepeat"] || "");
      for (let i = imageLayers.length - 1; i >= 0; i--) {
        const perLayerStyles = {
          ...styles,
          "background-size": bgSizes[i] || bgSizes[0] || "auto",
          "background-position": bgPositions[i] || bgPositions[0] || "0% 0%",
          "background-repeat": bgRepeats[i] || bgRepeats[0] || "repeat"
        };
        const layer = parseSingleBackgroundLayer(imageLayers[i], perLayerStyles, elementBounds);
        if (layer) {
          const extra = layer.type === "image" ? ` url=${layer.url?.substring(0, 80)} size=${JSON.stringify(layer.size)} repeat=${layer.repeat}` : "";
          logger2.info(`[Background] parsed layer[${i}]: type=${layer.type}${extra}`);
          layers.push(layer);
        }
      }
    }
    if (layers.length > 0) {
      logger2.info(`[Background] resolved ${layers.length} layers: [${layers.map((l) => l.type).join(", ")}]`);
    }
    return { layers };
  }
  function splitBackgroundLayers(value) {
    const layers = [];
    let current = "";
    let depth = 0;
    for (const char of value) {
      if (char === "(") {
        depth++;
        current += char;
      } else if (char === ")") {
        depth--;
        current += char;
      } else if (char === "," && depth === 0) {
        if (current.trim()) layers.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current.trim()) layers.push(current.trim());
    return layers;
  }
  function parseSingleBackgroundLayer(layer, styles, elementBounds) {
    if (layer.includes("linear-gradient")) {
      return parseLinearGradient(layer);
    }
    if (layer.includes("radial-gradient")) {
      return parseRadialGradient(layer);
    }
    if (layer.includes("conic-gradient")) {
      return parseConicGradient(layer);
    }
    if (layer.includes("url(")) {
      return parseBackgroundImage(layer, styles, elementBounds);
    }
    const color = parseColor(layer);
    if (color && !isTransparent(color)) {
      return { type: "color", color };
    }
    return null;
  }
  function parseLinearGradient(value) {
    const match = value.match(/linear-gradient\((.+)\)/);
    if (!match) return null;
    const content = match[1];
    let angle = 180;
    let stopsStr = content;
    const dirMatch = content.match(/^(to\s+\w+(?:\s+\w+)?|-?[\d.]+(?:deg|rad|grad|turn))\s*,\s*/);
    if (dirMatch) {
      const dir = dirMatch[1];
      stopsStr = content.slice(dirMatch[0].length);
      if (dir.startsWith("to ")) {
        angle = directionToAngle(dir);
      } else {
        angle = parseAngle(dir);
      }
    }
    const stops = parseGradientStops(stopsStr);
    if (stops.length < 2) return null;
    return { type: "linear-gradient", angle, stops };
  }
  function parseRadialGradient(value) {
    const match = value.match(/radial-gradient\((.+)\)/);
    if (!match) return null;
    const content = match[1];
    let shape = "ellipse";
    let position = { x: 0.5, y: 0.5 };
    let stopsStr = content;
    const shapeMatch = content.match(
      /^(?:(circle|ellipse)\s+)?(?:(?:closest-side|closest-corner|farthest-side|farthest-corner|[\d.]+(?:px|%|em|rem|vh|vw)?(?:\s+[\d.]+(?:px|%|em|rem|vh|vw)?)?)\s+)?(?:at\s+([\d.]+%?)\s+([\d.]+%?))?\s*,\s*/
    );
    if (!shapeMatch) {
      const simpleMatch = content.match(/^(circle|ellipse)?\s*(?:at\s+([\d.]+%?)\s+([\d.]+%?))?\s*,\s*/);
      if (simpleMatch) {
        if (simpleMatch[1]) shape = simpleMatch[1];
        if (simpleMatch[2]) position.x = parseFloat(simpleMatch[2]) / 100;
        if (simpleMatch[3]) position.y = parseFloat(simpleMatch[3]) / 100;
        stopsStr = content.slice(simpleMatch[0].length);
      }
    } else {
      if (shapeMatch[1]) shape = shapeMatch[1];
      if (shapeMatch[2]) position.x = parseFloat(shapeMatch[2]) / 100;
      if (shapeMatch[3]) position.y = parseFloat(shapeMatch[3]) / 100;
      stopsStr = content.slice(shapeMatch[0].length);
    }
    const stops = parseGradientStops(stopsStr);
    if (stops.length < 2) return null;
    return { type: "radial-gradient", shape, position, stops };
  }
  function parseConicGradient(value) {
    const match = value.match(/conic-gradient\((.+)\)/);
    if (!match) return null;
    const content = match[1];
    let angle = 0;
    let position = { x: 0.5, y: 0.5 };
    let stopsStr = content;
    const prefixMatch = content.match(/^(?:from\s+([\d.]+(?:deg|rad|turn)))?\s*(?:at\s+([\d.]+%?)\s+([\d.]+%?))?\s*,\s*/);
    if (prefixMatch) {
      if (prefixMatch[1]) angle = parseAngle(prefixMatch[1]);
      if (prefixMatch[2]) position.x = parseFloat(prefixMatch[2]) / 100;
      if (prefixMatch[3]) position.y = parseFloat(prefixMatch[3]) / 100;
      stopsStr = content.slice(prefixMatch[0].length);
    }
    const stops = parseGradientStops(stopsStr);
    if (stops.length < 2) return null;
    return { type: "conic-gradient", angle, position, stops };
  }
  function parseGradientStops(stopsStr) {
    const stops = [];
    const parts = splitBackgroundLayers(stopsStr);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      const posMatch = part.match(/^(.+?)\s+([\d.]+%?)$/);
      let colorStr = part;
      let position;
      if (posMatch) {
        colorStr = posMatch[1].trim();
        const posValue = posMatch[2];
        position = posValue.includes("%") ? parseFloat(posValue) / 100 : parseFloat(posValue);
      }
      const color = parseColor(colorStr);
      if (color) {
        stops.push({
          position: position !== void 0 ? position : i / Math.max(1, parts.length - 1),
          color
        });
      }
    }
    return stops;
  }
  function resolveBackgroundSizeDimension(val, containerDim) {
    if (val === "auto") return 0;
    if (val.includes("%")) {
      const pct = parseFloat(val) / 100;
      return containerDim ? Math.round(pct * containerDim) : 0;
    }
    return parsePx(val);
  }
  function splitSpaceTokens(value) {
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
      } else if (/\s/.test(char) && depth === 0) {
        if (current.trim()) tokens.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current.trim()) tokens.push(current.trim());
    return tokens;
  }
  function parseBackgroundImage(layer, styles, elementBounds) {
    const url = extractUrlFromCss(layer);
    if (!url) return null;
    const bgSize = styles["background-size"] || styles["backgroundSize"] || "auto";
    let size;
    if (bgSize === "cover") size = "cover";
    else if (bgSize === "contain") size = "contain";
    else if (bgSize === "auto" || bgSize === "auto auto") size = "auto";
    else {
      const parts = bgSize.split(/\s+/);
      const w = resolveBackgroundSizeDimension(parts[0] || "0", elementBounds?.width);
      const h = resolveBackgroundSizeDimension(parts[1] || parts[0] || "0", elementBounds?.height);
      if (w === 0 && h === 0) size = "auto";
      else size = { width: w, height: h };
    }
    const bgPos = styles["background-position"] || styles["backgroundPosition"] || "0% 0%";
    const posParts = splitSpaceTokens(bgPos);
    const imgW = typeof size === "object" && size.width > 0 ? size.width : void 0;
    const imgH = typeof size === "object" && size.height > 0 ? size.height : void 0;
    const availW = elementBounds?.width && imgW ? elementBounds.width - imgW : void 0;
    const availH = elementBounds?.height && imgH ? elementBounds.height - imgH : void 0;
    const posX = parseBackgroundPositionValue(posParts[0] || "0%", availW);
    const posY = parseBackgroundPositionValue(posParts[1] || posParts[0] || "0%", availH);
    const repeat = styles["background-repeat"] || styles["backgroundRepeat"] || "repeat";
    return {
      type: "image",
      url,
      size,
      position: { x: posX, y: posY },
      repeat
    };
  }
  function parseBackgroundPositionValue(val, availableDim) {
    const keywordMap = {
      "left": 0,
      "top": 0,
      "center": 0.5,
      "right": 1,
      "bottom": 1
    };
    if (keywordMap[val] !== void 0) return keywordMap[val];
    if (val.startsWith("calc(")) {
      const match = val.match(/calc\((.+)\)/);
      if (match) {
        const inner = match[1].trim();
        const calcMatch = inner.match(/^([\d.]+)%\s*([+-])\s*([\d.]+)(?:px)?$/);
        if (calcMatch) {
          const pct = parseFloat(calcMatch[1]) / 100;
          const op = calcMatch[2];
          const px = parseFloat(calcMatch[3]);
          if (availableDim != null && availableDim > 0) {
            return pct * availableDim + (op === "-" ? -px : px);
          }
          return pct;
        }
      }
      return 0;
    }
    if (val.includes("%")) return parseFloat(val) / 100;
    if (val.endsWith("px")) return parsePx(val);
    return parseFloat(val) || 0;
  }
  function directionToAngle(dir) {
    const map = {
      "to top": 0,
      "to top right": 45,
      "to right": 90,
      "to bottom right": 135,
      "to bottom": 180,
      "to bottom left": 225,
      "to left": 270,
      "to top left": 315
    };
    return map[dir] ?? 180;
  }
  var ZERO_COLOR = { r: 0, g: 0, b: 0, a: 0 };
  function zeroBorderSide() {
    return { width: 0, style: "none", color: { ...ZERO_COLOR } };
  }
  function resolveBorder(styles) {
    const parseSide = (side) => {
      const width = parsePx(styles[`border-${side}-width`] || "0");
      const styleVal = styles[`border-${side}-style`] || "none";
      const colorStr = styles[`border-${side}-color`] || "";
      const color = parseColor(colorStr) || { ...ZERO_COLOR };
      if (width <= 0 || styleVal === "none") {
        return zeroBorderSide();
      }
      return { width, style: styleVal, color };
    };
    const parseRadius = (key) => {
      return parsePx(styles[key] || "0");
    };
    return {
      top: parseSide("top"),
      right: parseSide("right"),
      bottom: parseSide("bottom"),
      left: parseSide("left"),
      radius: {
        topLeft: parseRadius("border-top-left-radius"),
        topRight: parseRadius("border-top-right-radius"),
        bottomRight: parseRadius("border-bottom-right-radius"),
        bottomLeft: parseRadius("border-bottom-left-radius")
      }
    };
  }
  function resolveEffects(styles) {
    return {
      boxShadows: parseBoxShadows(styles["box-shadow"] || styles["boxShadow"] || ""),
      filters: parseFilterList(styles["filter"] || ""),
      backdropFilters: parseFilterList(styles["backdrop-filter"] || styles["backdropFilter"] || ""),
      blendMode: styles["mix-blend-mode"] || styles["mixBlendMode"] || void 0
    };
  }
  function parseBoxShadows(value) {
    if (!value || value === "none") return [];
    const shadows = [];
    const parts = splitBackgroundLayers(value);
    for (const part of parts) {
      const shadow = parseSingleBoxShadow(part.trim());
      if (shadow) shadows.push(shadow);
    }
    return shadows;
  }
  function parseSingleBoxShadow(value) {
    const inset = value.includes("inset");
    const cleaned = value.replace(/inset/g, "").trim();
    const tokens = [];
    let current = "";
    let depth = 0;
    for (const char of cleaned) {
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
    const color = parseColor(colorStr) || { r: 0, g: 0, b: 0, a: 0.25 };
    return {
      inset,
      offsetX: lengths[0],
      offsetY: lengths[1],
      blurRadius: lengths[2] || 0,
      spreadRadius: lengths[3] || 0,
      color
    };
  }
  function parseFilterList(value) {
    if (!value || value === "none") return void 0;
    const effects = [];
    const regex = /(\w[\w-]*)\(([^)]+)\)/g;
    let match;
    while ((match = regex.exec(value)) !== null) {
      const type = match[1];
      const val = match[2].trim();
      switch (type) {
        case "blur":
          effects.push({ type: "blur", value: parsePx(val) });
          break;
        case "brightness":
        case "contrast":
        case "grayscale":
        case "invert":
        case "saturate":
        case "sepia":
          effects.push({ type, value: parseFloat(val) });
          break;
        case "hue-rotate":
          effects.push({ type: "hue-rotate", value: parseAngle(val) });
          break;
        case "drop-shadow":
          effects.push({ type: "drop-shadow", value: val });
          break;
      }
    }
    return effects.length > 0 ? effects : void 0;
  }

  // third-party/html2figma/upstream/packages/browser/converter/resolvers/layout.ts
  function resolveLayout(styles) {
    const rawDisplay = getStyle(styles, "display");
    const display = normalizeDisplay(rawDisplay);
    const textAlignVal = getStyle(styles, "text-align", "textAlign");
    const textAlign = textAlignVal === "center" ? "center" : textAlignVal === "right" || textAlignVal === "end" ? "right" : void 0;
    const lineClampStr = getStyle(styles, "-webkit-line-clamp", "webkitLineClamp");
    const lineClamp = lineClampStr ? parseInt(lineClampStr, 10) : void 0;
    const hasLineClamp = lineClamp != null && lineClamp > 0;
    const effectiveDisplay = hasLineClamp ? "block" : display;
    const tableSpacing = resolveTableSpacing(styles, rawDisplay);
    const borderCollapse = (rawDisplay === "table" || rawDisplay === "inline-table") && getStyle(styles, "border-collapse", "borderCollapse") === "collapse";
    const verticalAlign = resolveVerticalAlign(styles, rawDisplay);
    return {
      display: effectiveDisplay,
      textAlign,
      lineClamp: hasLineClamp ? lineClamp : void 0,
      verticalAlign,
      flex: resolveFlexInfo(styles, effectiveDisplay),
      grid: resolveGridInfo(styles, effectiveDisplay),
      float: normalizeFloat(getStyle(styles, "float")),
      clear: normalizeClear(getStyle(styles, "clear")),
      padding: parseSpacing(styles, "padding"),
      margin: parseSpacing(styles, "margin"),
      sizing: resolveSizing(styles),
      tableSpacing,
      borderCollapse: borderCollapse || void 0
    };
  }
  function resolvePositioning(styles) {
    const mode = normalizePosition(getStyle(styles, "position"));
    const result = { mode };
    if (mode !== "static") {
      const offsets = {};
      const top = getStyle(styles, "top");
      const right = getStyle(styles, "right");
      const bottom = getStyle(styles, "bottom");
      const left = getStyle(styles, "left");
      if (top && top !== "auto") offsets.top = parsePx(top);
      if (right && right !== "auto") offsets.right = parsePx(right);
      if (bottom && bottom !== "auto") offsets.bottom = parsePx(bottom);
      if (left && left !== "auto") offsets.left = parsePx(left);
      if (Object.keys(offsets).length > 0) {
        result.offsets = offsets;
      }
    }
    const zIndex = getStyle(styles, "z-index", "zIndex");
    if (zIndex && zIndex !== "auto") {
      result.zIndex = parseInt(zIndex, 10);
    }
    return result;
  }
  function resolveTransform(styles, boundingRect) {
    const transform = getStyle(styles, "transform");
    const writingMode = getStyle(styles, "writing-mode", "writingMode");
    const isVerticalWriting = writingMode === "vertical-rl" || writingMode === "vertical-lr";
    if ((!transform || transform === "none") && !isVerticalWriting) return void 0;
    const result = {};
    if (isVerticalWriting) {
      result.rotation = writingMode === "vertical-rl" ? 90 : -90;
      result.writingModeRotation = true;
    }
    const funcRegex = /(\w+)\(([^)]+)\)/g;
    let match;
    while ((match = funcRegex.exec(transform)) !== null) {
      const fn = match[1];
      const args = match[2].split(",").map((s) => s.trim());
      switch (fn) {
        case "matrix":
          if (args.length === 6) {
            result.matrix = args.map(Number);
            const [a, b, c, d] = result.matrix;
            const scaleX = Math.sqrt(a * a + b * b);
            const scaleY = Math.sqrt(c * c + d * d);
            if (Math.abs(scaleX - 1) > 1e-3 || Math.abs(scaleY - 1) > 1e-3) {
              result.scale = { x: scaleX, y: scaleY };
            }
            const rotation = Math.atan2(b, a) * (180 / Math.PI);
            if (Math.abs(rotation) > 0.1) {
              result.rotation = rotation;
            }
          }
          break;
        case "rotate":
          result.rotation = parseAngle(args[0]);
          break;
        case "scale":
          const sx = parseFloat(args[0]) || 1;
          const sy = args[1] ? parseFloat(args[1]) || 1 : sx;
          result.scale = { x: sx, y: sy };
          break;
        case "scaleX":
          result.scale = { x: parseFloat(args[0]) || 1, y: result.scale?.y ?? 1 };
          break;
        case "scaleY":
          result.scale = { x: result.scale?.x ?? 1, y: parseFloat(args[0]) || 1 };
          break;
        case "translate": {
          const tx = parsePx(args[0]);
          const ty = args[1] ? parsePx(args[1]) : 0;
          result.translate = { x: tx, y: ty };
          break;
        }
        case "translateX":
          result.translate = { x: parsePx(args[0]), y: result.translate?.y ?? 0 };
          break;
        case "translateY":
          result.translate = { x: result.translate?.x ?? 0, y: parsePx(args[0]) };
          break;
      }
    }
    const originStr = getStyle(styles, "transform-origin", "transformOrigin");
    if (originStr) {
      const fakeRect = { left: 0, top: 0, right: boundingRect.width, bottom: boundingRect.height, width: boundingRect.width, height: boundingRect.height };
      const origin = parseTransformOrigin(originStr, fakeRect);
      result.origin = origin;
    }
    if (Object.keys(result).length === 0) return void 0;
    return result;
  }
  function resolveFlexItem(styles) {
    const grow = parseFloat(getStyle(styles, "flex-grow", "flexGrow") || "0");
    const shrink = parseFloat(getStyle(styles, "flex-shrink", "flexShrink") || "1");
    const basisStr = getStyle(styles, "flex-basis", "flexBasis") || "auto";
    const alignSelf = getStyle(styles, "align-self", "alignSelf") || void 0;
    const orderStr = getStyle(styles, "order");
    const order = orderStr ? parseInt(orderStr, 10) : 0;
    const basis = basisStr === "auto" ? "auto" : parsePx(basisStr);
    const isDefault = grow === 0 && shrink === 1 && basis === "auto" && (!alignSelf || alignSelf === "auto") && order === 0;
    if (isDefault) return void 0;
    return {
      grow,
      shrink,
      basis,
      alignSelf: alignSelf === "auto" ? void 0 : alignSelf,
      order: order !== 0 ? order : void 0
    };
  }
  function normalizeDisplay(value) {
    const map = {
      "block": "block",
      "inline": "inline",
      "inline-block": "inline-block",
      "flex": "flex",
      "inline-flex": "inline-flex",
      "grid": "grid",
      "inline-grid": "inline-grid",
      "none": "none",
      "list-item": "block",
      "table": "block",
      "table-row": "block",
      "table-cell": "block",
      "-webkit-box": "block"
      // Legacy flexbox used for -webkit-line-clamp text truncation
    };
    return map[value] || "block";
  }
  function normalizePosition(value) {
    const valid = ["static", "relative", "absolute", "fixed", "sticky"];
    return valid.includes(value) ? value : "static";
  }
  function normalizeFloat(value) {
    if (value === "left" || value === "right") return value;
    return "none";
  }
  function normalizeClear(value) {
    if (value === "left" || value === "right" || value === "both") return value;
    return "none";
  }
  function resolveFlexInfo(styles, display) {
    if (display !== "flex" && display !== "inline-flex") return void 0;
    const direction = getStyle(styles, "flex-direction", "flexDirection") || "row";
    const wrap = getStyle(styles, "flex-wrap", "flexWrap") || "nowrap";
    const justifyContent = getStyle(styles, "justify-content", "justifyContent") || "flex-start";
    const alignItems = getStyle(styles, "align-items", "alignItems") || "stretch";
    const alignContent = getStyle(styles, "align-content", "alignContent") || void 0;
    const rowGapStr = getStyle(styles, "row-gap", "rowGap");
    const colGapStr = getStyle(styles, "column-gap", "columnGap");
    const gapStr = getStyle(styles, "gap");
    let rowGap = 0;
    let colGap = 0;
    if (gapStr && gapStr !== "normal") {
      const parts = gapStr.split(/\s+/);
      rowGap = parsePx(parts[0]);
      colGap = parts[1] ? parsePx(parts[1]) : rowGap;
    }
    if (rowGapStr && rowGapStr !== "normal") rowGap = parsePx(rowGapStr);
    if (colGapStr && colGapStr !== "normal") colGap = parsePx(colGapStr);
    return {
      direction,
      wrap,
      justifyContent,
      alignItems,
      alignContent,
      gap: { row: rowGap, column: colGap }
    };
  }
  function resolveGridInfo(styles, display) {
    if (display !== "grid" && display !== "inline-grid") return void 0;
    const rowGapStr = getStyle(styles, "row-gap", "rowGap");
    const colGapStr = getStyle(styles, "column-gap", "columnGap");
    const gapStr = getStyle(styles, "gap");
    let rowGap = 0;
    let colGap = 0;
    if (gapStr && gapStr !== "normal") {
      const parts = gapStr.split(/\s+/);
      rowGap = parsePx(parts[0]);
      colGap = parts[1] ? parsePx(parts[1]) : rowGap;
    }
    if (rowGapStr && rowGapStr !== "normal") rowGap = parsePx(rowGapStr);
    if (colGapStr && colGapStr !== "normal") colGap = parsePx(colGapStr);
    return {
      templateColumns: getStyle(styles, "grid-template-columns", "gridTemplateColumns") || "none",
      templateRows: getStyle(styles, "grid-template-rows", "gridTemplateRows") || "none",
      gap: { row: rowGap, column: colGap },
      autoFlow: getStyle(styles, "grid-auto-flow", "gridAutoFlow") || void 0,
      justifyItems: getStyle(styles, "justify-items", "justifyItems") || void 0,
      alignItems: getStyle(styles, "align-items", "alignItems") || void 0
    };
  }
  function resolveTableSpacing(styles, rawDisplay) {
    if (!rawDisplay || !rawDisplay.startsWith("table")) return void 0;
    if (rawDisplay !== "table" && rawDisplay !== "inline-table") return void 0;
    const spacing = getStyle(styles, "border-spacing", "borderSpacing");
    if (!spacing) return void 0;
    const parts = spacing.trim().split(/\s+/);
    const column = parsePx(parts[0]);
    const row = parts[1] ? parsePx(parts[1]) : column;
    if (column === 0 && row === 0) return void 0;
    return { row, column };
  }
  function resolveVerticalAlign(styles, rawDisplay) {
    if (rawDisplay !== "table-cell") return void 0;
    const va = getStyle(styles, "vertical-align", "verticalAlign");
    if (va === "middle") return "middle";
    if (va === "bottom") return "bottom";
    return void 0;
  }
  function resolveSizing(styles) {
    const minWidth = parsePx(getStyle(styles, "min-width", "minWidth") || "0");
    const maxWidth = parsePx(getStyle(styles, "max-width", "maxWidth") || "0");
    const minHeight = parsePx(getStyle(styles, "min-height", "minHeight") || "0");
    const maxHeight = parsePx(getStyle(styles, "max-height", "maxHeight") || "0");
    const boxSizing = getStyle(styles, "box-sizing", "boxSizing") || "content-box";
    const hasConstraints = minWidth > 0 || maxWidth > 0 || minHeight > 0 || maxHeight > 0;
    if (!hasConstraints && boxSizing === "content-box") return void 0;
    return {
      minWidth: minWidth > 0 ? minWidth : void 0,
      maxWidth: maxWidth > 0 ? maxWidth : void 0,
      minHeight: minHeight > 0 ? minHeight : void 0,
      maxHeight: maxHeight > 0 ? maxHeight : void 0,
      boxSizing
    };
  }

  // third-party/html2figma/upstream/packages/browser/converter/resolvers/text.ts
  var logger3 = createLogger("NodeTraverser" /* NODE_TRAVERSER */);
  function resolveTextStyle(styles) {
    const fontFamily = getStyle(styles, "font-family", "fontFamily") || "sans-serif";
    const fontSize = parsePx(getStyle(styles, "font-size", "fontSize") || "16px");
    const fontWeight = getStyle(styles, "font-weight", "fontWeight") || "400";
    const fontStyle = normalizeFontStyle(getStyle(styles, "font-style", "fontStyle"));
    const color = parseColor(getStyle(styles, "color")) || { r: 0, g: 0, b: 0, a: 1 };
    const textAlign = normalizeTextAlign(getStyle(styles, "text-align", "textAlign"));
    const verticalAlign = getStyle(styles, "vertical-align", "verticalAlign") || void 0;
    const textDecoration = normalizeTextDecoration(getStyle(styles, "text-decoration", "textDecoration", "text-decoration-line", "textDecorationLine"));
    const textTransform = normalizeTextTransform(getStyle(styles, "text-transform", "textTransform"));
    const lineHeight = resolveLineHeight(getStyle(styles, "line-height", "lineHeight"), fontSize);
    const letterSpacing = resolveLetterSpacing(getStyle(styles, "letter-spacing", "letterSpacing"));
    const whiteSpace = getStyle(styles, "white-space", "whiteSpace") || void 0;
    const wordBreak = getStyle(styles, "word-break", "wordBreak") || void 0;
    const textOverflow = normalizeTextOverflow(getStyle(styles, "text-overflow", "textOverflow"));
    const maxLinesStr = getStyle(styles, "-webkit-line-clamp", "webkitLineClamp");
    const maxLines = maxLinesStr ? parseInt(maxLinesStr, 10) : void 0;
    const textShadow = parseTextShadow(getStyle(styles, "text-shadow", "textShadow"));
    return {
      fontFamily: cleanFontFamily(fontFamily),
      fontSize: Math.max(fontSize, 1),
      fontWeight,
      fontStyle,
      color,
      textAlign,
      verticalAlign,
      textDecoration,
      textTransform,
      lineHeight,
      letterSpacing,
      whiteSpace,
      wordBreak,
      textOverflow: textOverflow || void 0,
      maxLines: maxLines && maxLines > 0 ? maxLines : void 0,
      textShadow: textShadow.length > 0 ? textShadow : void 0
    };
  }
  function sanitizeTextContent(text, whiteSpace) {
    if (!text) return "";
    let result = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
    if (whiteSpace && whiteSpace.startsWith("pre")) {
      result = result.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      return result;
    }
    result = result.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    result = result.split("\n").map((line) => line.replace(/[ \t]+/g, " ").replace(/^ +| +$/g, "")).join("\n");
    logger3.info(`[sanitizeText] in="${text.substring(0, 60)}" out="${result.substring(0, 60)}" hasLF=${result.includes("\n")}`);
    return result;
  }
  function cleanFontFamily(fontFamily) {
    const first = fontFamily.split(",")[0].trim().replace(/['"]/g, "");
    return first || "sans-serif";
  }
  function normalizeFontStyle(value) {
    if (value === "italic") return "italic";
    if (value === "oblique") return "oblique";
    return "normal";
  }
  function normalizeTextAlign(value) {
    if (value === "center") return "center";
    if (value === "right" || value === "end") return "right";
    if (value === "justify") return "justify";
    return "left";
  }
  function normalizeTextDecoration(value) {
    if (!value || value === "none") return "none";
    if (value.includes("underline")) return "underline";
    if (value.includes("line-through")) return "line-through";
    if (value.includes("overline")) return "overline";
    return "none";
  }
  function normalizeTextTransform(value) {
    if (value === "uppercase") return "uppercase";
    if (value === "lowercase") return "lowercase";
    if (value === "capitalize") return "capitalize";
    return "none";
  }
  function normalizeTextOverflow(value) {
    if (value === "ellipsis") return "ellipsis";
    if (value === "clip") return "clip";
    return void 0;
  }
  function resolveLineHeight(value, fontSize) {
    if (!value || value === "normal") {
      return { value: 0, unit: "normal" };
    }
    if (value.endsWith("px")) {
      return { value: parseFloat(value), unit: "px" };
    }
    if (value.endsWith("%")) {
      return { value: parseFloat(value), unit: "%" };
    }
    const multiplier = parseFloat(value);
    if (!isNaN(multiplier)) {
      return { value: multiplier * 100, unit: "%" };
    }
    return { value: 0, unit: "normal" };
  }
  function resolveLetterSpacing(value) {
    if (!value || value === "normal") {
      return { value: 0, unit: "px" };
    }
    if (value.endsWith("em")) {
      return { value: parseFloat(value), unit: "em" };
    }
    return { value: parsePx(value), unit: "px" };
  }
  function parseTextShadow(value) {
    if (!value || value === "none") return [];
    const shadows = [];
    const parts = splitBackgroundLayers(value);
    for (const part of parts) {
      const tokens = part.trim().split(/\s+/);
      const lengths = [];
      let colorStr = "";
      for (const token of tokens) {
        if (token.match(/^-?[\d.]+px$/) || token.match(/^-?[\d.]+$/)) {
          lengths.push(parseFloat(token));
        } else {
          colorStr += (colorStr ? " " : "") + token;
        }
      }
      if (lengths.length >= 2) {
        const color = parseColor(colorStr) || { r: 0, g: 0, b: 0, a: 0.5 };
        shadows.push({
          inset: false,
          offsetX: lengths[0],
          offsetY: lengths[1],
          blurRadius: lengths[2] || 0,
          spreadRadius: 0,
          color
        });
      }
    }
    return shadows;
  }

  // third-party/html2figma/upstream/packages/browser/converter/resolvers/image.ts
  function resolveImageInfo(domNode, styles) {
    const imgElement = resolveImgElement(domNode);
    const src = imgElement.src || imgElement.getAttribute("src") || "";
    const alt = imgElement.alt || imgElement.getAttribute("alt") || void 0;
    const width = imgElement.naturalWidth || imgElement.width || void 0;
    const height = imgElement.naturalHeight || imgElement.height || void 0;
    const objectFit = normalizeObjectFit(getStyle(styles, "object-fit", "objectFit"));
    return {
      src,
      alt,
      width,
      height,
      objectFit
    };
  }
  function resolveImgElement(domNode) {
    const element = domNode;
    if (element.tagName?.toLowerCase() === "picture") {
      const img = element.querySelector("img");
      if (img) return img;
    }
    return element;
  }
  function imageToBase64(element) {
    try {
      if (!element.complete || element.naturalWidth === 0) {
        return void 0;
      }
      const canvas = realm.document.createElement("canvas");
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return void 0;
      ctx.drawImage(element, 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      return void 0;
    }
  }
  function normalizeObjectFit(value) {
    const valid = ["fill", "contain", "cover", "none", "scale-down"];
    return valid.includes(value) ? value : "fill";
  }

  // third-party/html2figma/upstream/packages/browser/converter/nodeBuilder.ts
  function determineNodeType(node) {
    if (node.nodeType === "text") return "text";
    const tag = (node.tag || "").toLowerCase();
    if (tag === "img") return "image";
    if (tag === "svg") return "svg";
    if (tag === "picture" || tag === "video" || tag === "canvas") return "image";
    return "container";
  }
  function getRole(tag) {
    const roleMap = {
      "button": "button",
      "a": "button",
      "input": "input",
      "textarea": "input",
      "select": "input",
      "img": "image",
      "svg": "svg",
      "video": "video",
      "canvas": "image",
      "hr": "separator",
      "fieldset": "fieldset",
      "legend": "legend"
    };
    return roleMap[tag];
  }
  function resolveOpacity(styles) {
    const visibility = styles["visibility"];
    if (visibility === "hidden") return 0;
    const opacity = parseFloat(styles["opacity"] || "1");
    return isNaN(opacity) ? 1 : opacity;
  }
  function buildBounds(node, baseX, baseY, transform) {
    if (!node.boundingRect) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    if (node.originalRect && transform) {
      const sx = transform.scale?.x ?? 1;
      const sy = transform.scale?.y ?? 1;
      const w = node.originalRect.width * sx;
      const h = node.originalRect.height * sy;
      const \u03B8 = (transform.rotation ?? 0) * Math.PI / 180;
      const cos\u03B8 = Math.cos(\u03B8);
      const sin\u03B8 = Math.sin(\u03B8);
      const aabbCx = node.boundingRect.left + node.boundingRect.width / 2;
      const aabbCy = node.boundingRect.top + node.boundingRect.height / 2;
      const tx = aabbCx - cos\u03B8 * w / 2 + sin\u03B8 * h / 2;
      const ty = aabbCy - sin\u03B8 * w / 2 - cos\u03B8 * h / 2;
      return { x: tx - baseX, y: ty - baseY, width: w, height: h };
    }
    if (transform?.writingModeRotation && transform.rotation) {
      const w = node.boundingRect.height;
      const h = node.boundingRect.width;
      const \u03B8 = transform.rotation * Math.PI / 180;
      const cos\u03B8 = Math.cos(\u03B8);
      const sin\u03B8 = Math.sin(\u03B8);
      const aabbCx = node.boundingRect.left + node.boundingRect.width / 2;
      const aabbCy = node.boundingRect.top + node.boundingRect.height / 2;
      const tx = aabbCx - cos\u03B8 * w / 2 + sin\u03B8 * h / 2;
      const ty = aabbCy - sin\u03B8 * w / 2 - cos\u03B8 * h / 2;
      return { x: tx - baseX, y: ty - baseY, width: w, height: h };
    }
    return {
      x: node.boundingRect.left - baseX,
      y: node.boundingRect.top - baseY,
      width: node.boundingRect.width,
      height: node.boundingRect.height
    };
  }
  function buildName(node) {
    if (node.nodeType === "text") {
      const text = (node.textContent || "").trim().substring(0, 30);
      return text || "#text";
    }
    const tag = node.tag || "div";
    if (node.domNode instanceof realm.Element) {
      const el = node.domNode;
      const id = el.id;
      const cls = el.className && typeof el.className === "string" ? el.className.split(" ")[0] : "";
      if (id) return `${tag}#${id}`;
      if (cls) return `${tag}.${cls}`;
    }
    return tag;
  }
  function buildContainerNode(node, baseX, baseY, includeRawStyles) {
    const styles = getStyles(node);
    const tag = node.tag || "div";
    const opacity = resolveOpacity(styles);
    const flexItem = resolveFlexItem(styles);
    const bgClip = styles["background-clip"] || styles["backgroundClip"] || styles["-webkit-background-clip"] || styles["webkitBackgroundClip"] || "";
    let background = resolveBackground(styles, node.boundingRect);
    if (bgClip === "text") {
      const colorLayers = background.layers.filter((l) => l.type === "color");
      background = { layers: colorLayers };
    }
    const transformInfo = resolveTransform(styles, node.boundingRect || { width: 0, height: 0 });
    const layout = resolveLayout(styles);
    const result = {
      id: generateId("c"),
      name: buildName(node),
      tag,
      role: getRole(tag),
      nodeType: "container",
      bounds: buildBounds(node, baseX, baseY, transformInfo),
      visible: node.visible,
      opacity,
      positioning: resolvePositioning(styles),
      transform: transformInfo,
      flexItem,
      children: [],
      layout,
      background,
      border: resolveBorder(styles),
      effects: resolveEffects(styles),
      overflow: resolveOverflow(styles)
    };
    if (bgClip === "padding-box" || bgClip === "content-box") {
      result.backgroundClip = bgClip;
    }
    detectGradientBorder(result, background, styles);
    const display = styles["display"] || "";
    const isInlineContainer = display === "inline" || display === "inline-block" || display === "inline-flex";
    const hasTextChildren = node.children.some((c) => c.nodeType === "text");
    if (hasTextChildren || isInlineContainer || bgClip === "text") {
      result.textStyle = resolveTextStyle(styles);
      if (bgClip === "text") {
        const fullBg = resolveBackground(styles, node.boundingRect);
        const gradientLayers = fullBg.layers.filter((l) => l.type !== "color");
        if (gradientLayers.length > 0) {
          result.textStyle.gradientFill = gradientLayers;
        }
      }
    }
    if (tag === "ul" || tag === "ol") {
      result.listStyleType = styles["list-style-type"] || (tag === "ol" ? "decimal" : "disc");
    } else if (tag === "li") {
      result.listStyleType = styles["list-style-type"] || void 0;
    }
    if (node.metadata?.listMarker) {
      result.listMarker = node.metadata.listMarker;
    }
    if (node.metadata?.semantic) {
      result.semantic = node.metadata.semantic;
    }
    if (tag === "hr" && result.bounds.height < 1) {
      result.bounds.height = 1;
    }
    applyTransformScale(result, transformInfo);
    if (includeRawStyles) {
      result.rawStyles = styles;
    }
    return result;
  }
  function applyTransformScale(node, transform) {
    if (!transform?.scale) return;
    const sx = transform.scale.x;
    const sy = transform.scale.y;
    if (Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3) return;
    const p = node.layout.padding;
    p.top = p.top * sy;
    p.bottom = p.bottom * sy;
    p.left = p.left * sx;
    p.right = p.right * sx;
    const m = node.layout.margin;
    m.top = m.top * sy;
    m.bottom = m.bottom * sy;
    m.left = m.left * sx;
    m.right = m.right * sx;
    if (node.layout.flex) {
      node.layout.flex.gap.row = node.layout.flex.gap.row * sy;
      node.layout.flex.gap.column = node.layout.flex.gap.column * sx;
    }
    if (node.layout.grid) {
      node.layout.grid.gap.row = node.layout.grid.gap.row * sy;
      node.layout.grid.gap.column = node.layout.grid.gap.column * sx;
    }
    const b = node.border;
    b.top.width = b.top.width * sy;
    b.bottom.width = b.bottom.width * sy;
    b.left.width = b.left.width * sx;
    b.right.width = b.right.width * sx;
    const s = (sx + sy) / 2;
    const r = b.radius;
    r.topLeft = r.topLeft * s;
    r.topRight = r.topRight * s;
    r.bottomRight = r.bottomRight * s;
    r.bottomLeft = r.bottomLeft * s;
    for (const shadow of node.effects.boxShadows) {
      shadow.offsetX = shadow.offsetX * sx;
      shadow.offsetY = shadow.offsetY * sy;
      shadow.blurRadius = shadow.blurRadius * s;
      shadow.spreadRadius = shadow.spreadRadius * s;
    }
  }
  function buildTextNode(node, parentNode, baseX, baseY, includeRawStyles) {
    const isPseudoElement = node.metadata?.isPseudoElement === true;
    const isFormContent = node.metadata?.isFormContent === true;
    const useOwnStyle = (isPseudoElement || isFormContent) && node.computedStyle;
    const styleSource = useOwnStyle ? getStyles(node) : parentNode ? getStyles(parentNode) : {};
    const content = sanitizeTextContent(node.textContent || "", styleSource["white-space"]);
    const tag = isPseudoElement || isFormContent ? node.tag || "#text" : parentNode?.tag || "#text";
    const opacity = resolveOpacity(styleSource);
    const result = {
      id: generateId("t"),
      name: content.substring(0, 30) || "#text",
      tag,
      role: "text",
      nodeType: "text",
      bounds: buildBounds(node, baseX, baseY),
      visible: node.visible,
      opacity,
      positioning: node.metadata?.positioning ? { mode: node.metadata.positioning } : isPseudoElement || isFormContent ? resolvePositioning(styleSource) : { mode: "static" },
      transform: node.metadata?.rotation != null ? { rotation: node.metadata.rotation } : void 0,
      content,
      textStyle: resolveTextStyle(styleSource)
    };
    const ancestorScale = node.metadata?.ancestorScale;
    if (ancestorScale) {
      result.textStyle.fontSize = result.textStyle.fontSize * ancestorScale.x;
      if (result.textStyle.lineHeight && result.textStyle.lineHeight.unit !== "normal") {
        result.textStyle.lineHeight = {
          ...result.textStyle.lineHeight,
          value: result.textStyle.lineHeight.value * ancestorScale.y
        };
      }
      if (result.textStyle.letterSpacing && result.textStyle.letterSpacing.value !== 0) {
        result.textStyle.letterSpacing = {
          ...result.textStyle.letterSpacing,
          value: result.textStyle.letterSpacing.value * ancestorScale.x
        };
      }
    }
    const bgClip = styleSource["background-clip"] || styleSource["backgroundClip"] || styleSource["-webkit-background-clip"] || styleSource["webkitBackgroundClip"] || "";
    if (bgClip === "text") {
      const bg = resolveBackground(styleSource);
      const gradientLayers = bg.layers.filter((l) => l.type !== "color");
      const colorLayers = bg.layers.filter((l) => l.type === "color");
      if (gradientLayers.length > 0) {
        result.textStyle.gradientFill = gradientLayers;
      }
      if (colorLayers.length > 0) {
        result.background = { layers: colorLayers };
      }
    } else if (isPseudoElement) {
      const bg = resolveBackground(styleSource);
      if (bg.layers.length > 0) {
        result.background = bg;
      }
      const border = resolveBorder(styleSource);
      if (border.top.width > 0 || border.right.width > 0 || border.bottom.width > 0 || border.left.width > 0) {
        result.border = border;
      }
    }
    if (node.metadata?.hasLineBreakAfter === true) {
      result.hasLineBreakAfter = true;
    }
    const semanticSource = isPseudoElement || isFormContent ? node : parentNode;
    if (semanticSource?.metadata?.semantic) {
      result.semantic = semanticSource.metadata.semantic;
    }
    if (includeRawStyles) {
      result.rawStyles = styleSource;
    }
    return result;
  }
  function buildImageNode(node, baseX, baseY, includeRawStyles) {
    const styles = getStyles(node);
    const opacity = resolveOpacity(styles);
    const imageInfo = resolveImageInfo(node.domNode, styles);
    const imgEl = resolveImgElement(node.domNode);
    if (imgEl instanceof realm.HTMLImageElement) {
      const b64 = imageToBase64(imgEl);
      if (b64) imageInfo.base64 = b64;
    }
    const transformInfo = resolveTransform(styles, node.boundingRect || { width: 0, height: 0 });
    const margin = parseSpacing(styles, "margin");
    if (transformInfo?.scale) {
      const sx = transformInfo.scale.x;
      const sy = transformInfo.scale.y;
      if (margin.top || margin.bottom) {
        margin.top *= sy;
        margin.bottom *= sy;
      }
      if (margin.left || margin.right) {
        margin.left *= sx;
        margin.right *= sx;
      }
    }
    const verticalAlign = styles["vertical-align"] || styles["verticalAlign"] || void 0;
    const result = {
      id: generateId("i"),
      name: buildName(node),
      tag: node.tag || "img",
      role: "image",
      nodeType: "image",
      bounds: buildBounds(node, baseX, baseY, transformInfo),
      visible: node.visible,
      opacity,
      positioning: resolvePositioning(styles),
      transform: transformInfo,
      margin: margin.top || margin.right || margin.bottom || margin.left ? margin : void 0,
      verticalAlign,
      imageData: imageInfo,
      border: resolveBorder(styles),
      effects: resolveEffects(styles)
    };
    if (node.metadata?.semantic) {
      result.semantic = node.metadata.semantic;
    }
    if (includeRawStyles) {
      result.rawStyles = styles;
    }
    return result;
  }
  function buildSVGNode(node, baseX, baseY, includeRawStyles) {
    const styles = getStyles(node);
    const opacity = resolveOpacity(styles);
    let svgContent = "";
    if (node.domNode instanceof realm.Element) {
      svgContent = resolveSvgColors(node.domNode);
    }
    const transformInfo = resolveTransform(styles, node.boundingRect || { width: 0, height: 0 });
    const svgMargin = parseSpacing(styles, "margin");
    if (transformInfo?.scale) {
      const sx = transformInfo.scale.x;
      const sy = transformInfo.scale.y;
      if (svgMargin.top || svgMargin.bottom) {
        svgMargin.top *= sy;
        svgMargin.bottom *= sy;
      }
      if (svgMargin.left || svgMargin.right) {
        svgMargin.left *= sx;
        svgMargin.right *= sx;
      }
    }
    const svgVerticalAlign = styles["vertical-align"] || styles["verticalAlign"] || void 0;
    const result = {
      id: generateId("s"),
      name: buildName(node),
      tag: "svg",
      role: "svg",
      nodeType: "svg",
      bounds: buildBounds(node, baseX, baseY, transformInfo),
      visible: node.visible,
      opacity,
      positioning: resolvePositioning(styles),
      transform: transformInfo,
      margin: svgMargin.top || svgMargin.right || svgMargin.bottom || svgMargin.left ? svgMargin : void 0,
      verticalAlign: svgVerticalAlign,
      svgContent,
      background: resolveBackground(styles, node.boundingRect),
      border: resolveBorder(styles),
      effects: resolveEffects(styles)
    };
    if (node.metadata?.semantic) {
      result.semantic = node.metadata.semantic;
    }
    if (includeRawStyles) {
      result.rawStyles = styles;
    }
    return result;
  }
  var SVG_SHAPE_SELECTOR = "path,circle,rect,line,polyline,polygon,ellipse";
  function resolveSvgColors(svgEl) {
    const clone = svgEl.cloneNode(true);
    const svgFill = svgEl.getAttribute("fill");
    if (svgFill === "currentColor") {
      const svgCs = realm.getComputedStyle(svgEl);
      const resolved = svgCs.getPropertyValue("color");
      if (resolved) {
        clone.setAttribute("fill", resolved);
      }
    }
    const origShapes = Array.from(svgEl.querySelectorAll(SVG_SHAPE_SELECTOR));
    const cloneShapes = Array.from(clone.querySelectorAll(SVG_SHAPE_SELECTOR));
    origShapes.forEach((orig, i) => {
      const cloneEl = cloneShapes[i];
      if (!cloneEl) return;
      const cs = realm.getComputedStyle(orig);
      const stroke = cs.getPropertyValue("stroke");
      if (stroke && stroke !== "none") {
        cloneEl.setAttribute("stroke", stroke);
      }
      const shapeFill = cloneEl.getAttribute("fill");
      if (shapeFill === "currentColor") {
        const fill = cs.getPropertyValue("fill");
        if (fill && fill !== "none") cloneEl.setAttribute("fill", fill);
        return;
      }
      if (!shapeFill) {
        const fill = cs.getPropertyValue("fill");
        if (fill && fill !== "none" && fill !== "rgb(0, 0, 0)") {
          cloneEl.setAttribute("fill", fill);
        }
      }
    });
    return clone.outerHTML;
  }
  function getStyles(node) {
    if (!node.computedStyle) return {};
    return computedStyleToRecord(node.computedStyle);
  }
  function resolveOverflow(styles) {
    const values = [styles["overflow"], styles["overflow-x"], styles["overflow-y"]].filter(Boolean);
    if (values.includes("hidden")) return "hidden";
    if (values.includes("scroll")) return "scroll";
    if (values.includes("auto")) return "auto";
    return "visible";
  }
  function detectGradientBorder(result, background, styles) {
    const border = result.border;
    const hasBorderWidth2 = border.top.width > 0 || border.right.width > 0 || border.bottom.width > 0 || border.left.width > 0;
    if (!hasBorderWidth2) return;
    const allTransparent = border.top.color.a === 0 && border.right.color.a === 0 && border.bottom.color.a === 0 && border.left.color.a === 0;
    if (!allTransparent) return;
    const bgClipRaw = styles["background-clip"] || styles["backgroundClip"] || "";
    const clipValues = splitBackgroundLayers(bgClipRaw);
    if (clipValues.length < 2) return;
    const hasPaddingBox = clipValues.some((v) => v.trim() === "padding-box");
    const hasBorderBox = clipValues.some((v) => v.trim() === "border-box");
    if (!hasPaddingBox || !hasBorderBox) return;
    const bgImageRaw = styles["background-image"] || styles["backgroundImage"] || "";
    const imageLayers = splitBackgroundLayers(bgImageRaw);
    if (imageLayers.length < 2) return;
    const borderGradients = [];
    const keepLayers = [];
    const colorLayers = background.layers.filter((l) => l.type === "color");
    const gradientImageLayers = background.layers.filter((l) => l.type !== "color");
    for (let gi = 0; gi < gradientImageLayers.length; gi++) {
      const cssIndex = imageLayers.length - 1 - gi;
      const clip = cssIndex >= 0 && cssIndex < clipValues.length ? clipValues[cssIndex].trim() : "border-box";
      if (clip === "border-box") {
        borderGradients.push(gradientImageLayers[gi]);
      } else {
        keepLayers.push(gradientImageLayers[gi]);
      }
    }
    if (borderGradients.length === 0) return;
    const meaningfulGradients = borderGradients.filter((layer) => {
      if (layer.type !== "linear-gradient" && layer.type !== "radial-gradient") return true;
      const stops = layer.stops;
      if (!stops || stops.length < 2) return false;
      const first = stops[0].color;
      return stops.some(
        (s) => s.color.r !== first.r || s.color.g !== first.g || s.color.b !== first.b || s.color.a !== first.a
      );
    });
    if (meaningfulGradients.length > 0) {
      result.borderGradientLayers = meaningfulGradients;
    }
    result.background = { layers: [...colorLayers, ...keepLayers] };
    result.backgroundClip = "padding-box";
  }

  // third-party/html2figma/upstream/packages/browser/converter/effectResolver.ts
  function inlineTextWrapperEffect(textNode) {
    const hasBackground = textNode.background && textNode.background.layers.length > 0;
    const hasBorder = textNode.border && hasBorderWidth(textNode.border);
    if (!hasBackground && !hasBorder) {
      return textNode;
    }
    const wrapper = {
      id: textNode.id + "_wrapper",
      name: textNode.name + "_wrapper",
      tag: textNode.tag,
      role: "container",
      nodeType: "container",
      bounds: { ...textNode.bounds },
      visible: textNode.visible,
      opacity: textNode.opacity,
      positioning: { ...textNode.positioning },
      transform: textNode.transform ? { ...textNode.transform } : void 0,
      children: [textNode],
      layout: {
        display: "flex",
        flex: {
          direction: "row",
          wrap: "nowrap",
          justifyContent: "center",
          alignItems: "center",
          gap: { row: 0, column: 0 }
        },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      background: textNode.background || { layers: [] },
      border: textNode.border || zeroBorder(),
      effects: { boxShadows: [] },
      overflow: "visible"
    };
    textNode.background = void 0;
    textNode.border = void 0;
    textNode.bounds = {
      x: 0,
      y: 0,
      width: textNode.bounds.width,
      height: textNode.bounds.height
    };
    textNode.positioning = { mode: "static" };
    return wrapper;
  }
  function centerTextInVisualContainer(container) {
    const hasBg = container.background && container.background.layers.length > 0 && container.background.layers.some((l) => l.type === "color" ? l.color.a > 0 : true);
    const hasBrd = container.border && hasBorderWidth(container.border);
    if (!hasBg && !hasBrd) return;
    if (container.children.length === 0) return;
    const allText = container.children.every((c) => c.nodeType === "text");
    if (!allText) return;
    if (container.tag === "textarea") return;
    const display = container.layout.display;
    if (display === "flex" || display === "inline-flex") {
      if (container.layout.flex) {
        container.layout.flex.alignItems = "center";
      }
      return;
    }
    const isInline = display === "inline" || display === "inline-block";
    const isFormElement = container.tag === "button" || container.tag === "input";
    const textAlign = container.layout.textAlign;
    const hasTextCenter = textAlign === "center";
    const isBlock = display === "block";
    const needsBlockCenter = isBlock && (isFormElement || hasTextCenter);
    if (!isInline && !needsBlockCenter) return;
    container.layout.display = isInline ? "inline-flex" : "flex";
    let justifyContent = "flex-start";
    if (textAlign === "center" || isFormElement) justifyContent = "center";
    else if (textAlign === "right") justifyContent = "flex-end";
    container.layout.flex = {
      direction: "row",
      wrap: "nowrap",
      justifyContent,
      alignItems: "center",
      gap: { row: 0, column: 0 }
    };
  }
  function hasBorderWidth(border) {
    return border.top.width > 0 || border.right.width > 0 || border.bottom.width > 0 || border.left.width > 0;
  }
  function zeroBorder() {
    const side = { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } };
    return {
      top: { ...side },
      right: { ...side },
      bottom: { ...side },
      left: { ...side },
      radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }
    };
  }

  // third-party/html2figma/upstream/packages/browser/converter/postprocess/absolutePosition.ts
  function relativeizeAbsoluteChildren(container) {
    const parentX = container.bounds.x;
    const parentY = container.bounds.y;
    for (const child of container.children) {
      if (child.positioning.mode === "absolute") {
        child.bounds = {
          ...child.bounds,
          x: child.bounds.x - parentX,
          y: child.bounds.y - parentY
        };
      }
    }
  }
  function hoistFixedElements(root) {
    const fixedElements = [];
    collectAndRemoveFixed(root, fixedElements, true);
    if (fixedElements.length === 0) return;
    pruneEmptyContainers(root);
    fixedElements.sort(
      (a, b) => (a.positioning.zIndex ?? 0) - (b.positioning.zIndex ?? 0)
    );
    root.children.push(...fixedElements);
  }
  function collectAndRemoveFixed(container, collected, isRoot) {
    const remaining = [];
    for (const child of container.children) {
      if (!isRoot && child.positioning.mode === "fixed") {
        collected.push(child);
      } else {
        remaining.push(child);
        if (child.nodeType === "container") {
          collectAndRemoveFixed(child, collected, false);
        }
      }
    }
    if (!isRoot) {
      container.children = remaining;
    }
  }
  function pruneEmptyContainers(container) {
    for (const child of container.children) {
      if (child.nodeType === "container") {
        pruneEmptyContainers(child);
      }
    }
    container.children = container.children.filter((child) => {
      if (child.nodeType !== "container") return true;
      const c = child;
      return !(c.name === "margin-wrapper" && c.children.length === 0);
    });
  }
  function relativizeAllFlowCoordinates(root) {
    _relativizeRecursive(root, root.bounds.x, root.bounds.y);
  }
  function _relativizeRecursive(container, containerAbsX, containerAbsY) {
    for (const child of container.children) {
      if (child.positioning.mode === "fixed") {
        if (child.nodeType === "container") {
          _relativizeRecursive(child, child.bounds.x, child.bounds.y);
        }
        continue;
      }
      if (child.positioning.mode === "absolute") {
        const childAbsX2 = child.bounds.x + containerAbsX;
        const childAbsY2 = child.bounds.y + containerAbsY;
        if (child.nodeType === "container") {
          _relativizeRecursive(child, childAbsX2, childAbsY2);
        }
        continue;
      }
      const childAbsX = child.bounds.x;
      const childAbsY = child.bounds.y;
      child.bounds = {
        ...child.bounds,
        x: childAbsX - containerAbsX,
        y: childAbsY - containerAbsY
      };
      if (child.nodeType === "container") {
        _relativizeRecursive(child, childAbsX, childAbsY);
      }
    }
  }

  // third-party/html2figma/upstream/packages/browser/converter/postprocess/inlineGroup.ts
  function detectVerticalAlignCenter(children) {
    return children.some((child) => {
      if (child.verticalAlign === "middle") return true;
      if (child.nodeType === "text") {
        return child.textStyle.verticalAlign === "middle";
      }
      return false;
    });
  }
  function getHorizontalMargin(node, side) {
    if (node.nodeType === "container") {
      return node.layout.margin?.[side] || 0;
    }
    return node.margin?.[side] || 0;
  }
  function isInlineNode(node) {
    if (node.bounds.width === 0 && node.bounds.height === 0) return false;
    if (node.nodeType === "text") return true;
    if (node.nodeType === "container") {
      const display = node.layout.display;
      return display === "inline" || display === "inline-block" || display === "inline-flex";
    }
    if (node.nodeType === "svg" || node.nodeType === "image") return true;
    return false;
  }
  function applyInlineGaps(children) {
    if (children.length <= 1) return children;
    const result = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      let gapBefore = 0;
      if (i > 0) {
        const prev = children[i - 1];
        gapBefore = Math.round(child.bounds.x - (prev.bounds.x + prev.bounds.width));
        if (gapBefore < 0) gapBefore = 0;
        if (gapBefore === 0) {
          const prevMarginRight = getHorizontalMargin(prev, "right");
          const childMarginLeft = getHorizontalMargin(child, "left");
          gapBefore = Math.max(0, prevMarginRight + childMarginLeft);
        }
      }
      if (child.nodeType === "container") {
        const c = child;
        c.layout.margin = { ...c.layout.margin, left: 0, right: 0 };
      } else if (child.margin) {
        child.margin = { ...child.margin, left: 0, right: 0 };
      }
      if (gapBefore > 0) {
        result.push(createInlineMarginWrapper(child, gapBefore, 0));
      } else {
        result.push(child);
      }
    }
    return result;
  }
  function createInlineRunWrapper(inlineNodes) {
    const wrappedChildren = applyInlineGaps(inlineNodes);
    const bounds = unionBounds(inlineNodes);
    const alignItems = detectVerticalAlignCenter(inlineNodes) ? "center" : "baseline";
    return {
      id: generateId("inline"),
      name: "inline-group",
      tag: "div",
      role: "container",
      nodeType: "container",
      bounds,
      visible: true,
      opacity: 1,
      positioning: { mode: "static" },
      children: wrappedChildren,
      layout: {
        display: "flex",
        flex: {
          direction: "row",
          wrap: "wrap",
          justifyContent: "flex-start",
          alignItems,
          gap: { row: 0, column: 0 }
        },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      background: { layers: [] },
      border: {
        top: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        right: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        bottom: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        left: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }
      },
      effects: { boxShadows: [] },
      overflow: "visible"
    };
  }
  function createInlineMarginWrapper(child, marginLeft, marginRight) {
    return {
      id: generateId("margin"),
      name: "margin-wrapper",
      tag: "div",
      role: "container",
      nodeType: "container",
      bounds: {
        x: child.bounds.x - marginLeft,
        y: child.bounds.y,
        width: child.bounds.width + marginLeft + marginRight,
        height: child.bounds.height
      },
      visible: true,
      opacity: 1,
      positioning: { mode: "static" },
      children: [child],
      layout: {
        display: "flex",
        flex: {
          direction: "row",
          wrap: "nowrap",
          justifyContent: "flex-start",
          alignItems: "center",
          gap: { row: 0, column: 0 }
        },
        padding: { top: 0, right: marginRight, bottom: 0, left: marginLeft },
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      background: { layers: [] },
      border: {
        top: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        right: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        bottom: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        left: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }
      },
      effects: { boxShadows: [] },
      overflow: "visible"
    };
  }
  function groupInlineChildren(container) {
    const display = container.layout.display;
    if (display === "flex" || display === "inline-flex" || display === "grid" || display === "inline-grid" || display === "inline") {
      return container.children;
    }
    const allChildren = container.children;
    const absoluteChildren = allChildren.filter((c) => c.positioning?.mode === "absolute");
    const children = allChildren.filter((c) => c.positioning?.mode !== "absolute");
    if (children.length <= 1) return allChildren;
    const hasInline = children.some(isInlineNode);
    const hasBlock = children.some((c) => !isInlineNode(c));
    if (!hasInline) {
      return allChildren;
    }
    if (hasInline && !hasBlock) {
      const alignItems = detectVerticalAlignCenter(children) ? "center" : "baseline";
      const wrap = container.layout.lineClamp ? "nowrap" : "wrap";
      container.layout.display = "flex";
      container.layout.flex = {
        direction: "row",
        wrap,
        justifyContent: "flex-start",
        alignItems,
        gap: { row: 0, column: 0 }
      };
      const result2 = applyInlineGaps(children);
      return [...result2, ...absoluteChildren];
    }
    const result = [];
    let currentInlineRun = [];
    for (const child of children) {
      if (isInlineNode(child)) {
        currentInlineRun.push(child);
      } else {
        if (currentInlineRun.length > 0) {
          result.push(createInlineRunWrapper(currentInlineRun));
          currentInlineRun = [];
        }
        result.push(child);
      }
    }
    if (currentInlineRun.length > 0) {
      result.push(createInlineRunWrapper(currentInlineRun));
    }
    return [...result, ...absoluteChildren];
  }

  // third-party/html2figma/upstream/packages/browser/converter/postprocess/richText.ts
  var logger4 = createLogger("NodeTraverser" /* NODE_TRAVERSER */);
  function getLineHeightPx(style) {
    const lh = style.lineHeight;
    if (lh.unit === "px" && lh.value > 0) return lh.value;
    if (lh.unit === "%" && lh.value > 0) return lh.value / 100 * style.fontSize;
    return style.fontSize * 1.2;
  }
  function mapTextAlignToJustify(textAlign) {
    if (textAlign === "center") return "center";
    if (textAlign === "right") return "flex-end";
    return "flex-start";
  }
  function splitByGaps(children) {
    const rows = clusterIntoLineRows(children);
    if (rows.length === 1) {
      const sorted = rows[0].childIndices;
      const groups = [];
      let currentGroup = {
        startIndex: sorted[0],
        children: [children[sorted[0]]],
        gapBefore: 0
      };
      for (let i = 1; i < sorted.length; i++) {
        const prevChild = children[sorted[i - 1]];
        const currChild = children[sorted[i]];
        const prevRight = prevChild.bounds.x + prevChild.bounds.width;
        const gap = currChild.bounds.x - prevRight;
        if (gap > 1) {
          groups.push(currentGroup);
          currentGroup = {
            startIndex: sorted[i],
            children: [currChild],
            gapBefore: gap
          };
        } else {
          currentGroup.children.push(currChild);
        }
      }
      groups.push(currentGroup);
      return groups;
    }
    return [{ startIndex: 0, children: [...children], gapBefore: 0 }];
  }
  function createHorizontalGapWrapper(child, gapLeft) {
    const zeroBorderSide2 = { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } };
    return {
      id: generateId("gap"),
      name: "gap-wrapper",
      tag: "div",
      role: "container",
      nodeType: "container",
      bounds: {
        x: child.bounds.x - gapLeft,
        y: child.bounds.y,
        width: child.bounds.width + gapLeft,
        height: child.bounds.height
      },
      visible: true,
      opacity: 1,
      positioning: { mode: "static" },
      children: [child],
      layout: {
        display: "flex",
        flex: {
          direction: "row",
          wrap: "nowrap",
          justifyContent: "flex-start",
          alignItems: "center",
          gap: { row: 0, column: 0 }
        },
        padding: { top: 0, right: 0, bottom: 0, left: Math.round(gapLeft) },
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      background: { layers: [] },
      border: {
        top: { ...zeroBorderSide2 },
        right: { ...zeroBorderSide2 },
        bottom: { ...zeroBorderSide2 },
        left: { ...zeroBorderSide2 },
        radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }
      },
      effects: { boxShadows: [] },
      overflow: "visible"
    };
  }
  function stripTrailingNewlines(textNode) {
    if (!textNode.content?.includes("\n")) return;
    textNode.content = textNode.content.replace(/\n/g, "");
    if (textNode.styledSegments) {
      let offset = 0;
      for (const seg of textNode.styledSegments) {
        const cleanText = (seg.text || "").replace(/\n/g, "");
        seg.text = cleanText;
        seg.start = offset;
        offset += cleanText.length;
        seg.end = offset;
      }
    }
  }
  function isTextOnlyNode(node) {
    if (node.nodeType === "text") return true;
    if (node.nodeType === "image" || node.nodeType === "svg") return false;
    if (node.nodeType === "container") {
      const container = node;
      if (hasVisualStyling(container)) return false;
      const display = container.layout.display;
      const isInlineDisplay = display === "inline" || display === "inline-block";
      const isTextWrapper = display === "flex" && container.children.length === 1 && container.children[0].nodeType === "text";
      if (!isInlineDisplay && !isTextWrapper) return false;
      return container.children.every(isTextOnlyNode);
    }
    return false;
  }
  function hasVisualStyling(container) {
    if (container.background && container.background.layers.length > 0) {
      const hasVisibleBg = container.background.layers.some((layer) => {
        if (layer.type === "color") return layer.color.a > 0;
        return true;
      });
      if (hasVisibleBg) return true;
    }
    if (container.border) {
      const b = container.border;
      if (b.top.width > 0 || b.right.width > 0 || b.bottom.width > 0 || b.left.width > 0) {
        return true;
      }
    }
    return false;
  }
  function isVisualInlineWrapper(node) {
    if (node.nodeType !== "container") return false;
    const container = node;
    if (!hasVisualStyling(container)) return false;
    const display = container.layout.display;
    const isFlexWrapper = display === "flex" && container.children.length === 1 && container.children[0].nodeType === "text";
    const isInline = display === "inline" || display === "inline-block" || display === "inline-flex";
    return isFlexWrapper || isInline;
  }
  function extractTextSegments(node) {
    if (node.nodeType === "text") {
      const textNode = node;
      if (!textNode.content) return [];
      return [{
        text: textNode.content,
        style: textNode.textStyle,
        tag: textNode.tag,
        hasLineBreakAfter: textNode.hasLineBreakAfter === true
      }];
    }
    if (node.nodeType === "container") {
      const container = node;
      const tag = container.tag;
      const containerStyle = container.textStyle;
      const hasReliableContainerStyle = !!containerStyle;
      logger4.info(`[RichText] extractTextSegments container tag=${tag} hasTextStyle=${hasReliableContainerStyle}${containerStyle ? ` fontStyle=${containerStyle.fontStyle} color=r${containerStyle.color.r},g${containerStyle.color.g},b${containerStyle.color.b}` : ""}`);
      let href;
      if (tag === "a") {
        href = container.semantic?.attributes?.href || void 0;
      }
      if (container.children.length === 0) return [];
      const segments = [];
      for (let i = 0; i < container.children.length; i++) {
        const child = container.children[i];
        if (child.nodeType === "text") {
          const textChild = child;
          if (textChild.content) {
            const isPseudo = textChild.tag === "::before" || textChild.tag === "::after";
            const resolvedStyle = isPseudo ? textChild.textStyle : hasReliableContainerStyle ? containerStyle : textChild.textStyle;
            segments.push({
              text: textChild.content,
              style: resolvedStyle,
              tag: isPseudo ? textChild.tag : tag,
              href,
              hasLineBreakAfter: textChild.hasLineBreakAfter === true
            });
          }
        } else {
          const childSegments = extractTextSegments(child);
          segments.push(...childSegments);
        }
      }
      return segments;
    }
    return [];
  }
  function clusterIntoLineRows(children) {
    const rows = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const cTop = child.bounds.y;
      const cBottom = cTop + child.bounds.height;
      const cMid = (cTop + cBottom) / 2;
      let matched;
      for (const row of rows) {
        const rMid = (row.top + row.bottom) / 2;
        if (cMid >= row.top && cMid <= row.bottom || // child mid inside row
        rMid >= cTop && rMid <= cBottom) {
          matched = row;
          break;
        }
      }
      if (matched) {
        matched.childIndices.push(i);
        matched.top = Math.min(matched.top, cTop);
        matched.bottom = Math.max(matched.bottom, cBottom);
      } else {
        rows.push({ top: cTop, bottom: cBottom, childIndices: [i] });
      }
    }
    rows.sort((a, b) => a.top - b.top);
    for (const row of rows) {
      row.childIndices.sort((a, b) => children[a].bounds.x - children[b].bounds.x);
    }
    return rows;
  }
  function mergeChildrenSubset(children, parentTag, parentOpacity, skipLineBreaks = false) {
    logger4.info(`[RichText] mergeChildrenSubset: ${children.length} children skipLineBreaks=${skipLineBreaks}`);
    const lineRows = clusterIntoLineRows(children);
    const rawSegments = [];
    for (let rowIdx = 0; rowIdx < lineRows.length; rowIdx++) {
      const row = lineRows[rowIdx];
      for (let ci = 0; ci < row.childIndices.length; ci++) {
        const childIdx = row.childIndices[ci];
        const child = children[childIdx];
        const segments = extractTextSegments(child);
        rawSegments.push(...segments);
        if (ci < row.childIndices.length - 1) {
          const nextChildIdx = row.childIndices[ci + 1];
          const nextChild = children[nextChildIdx];
          const currentRight = child.bounds.x + child.bounds.width;
          const gap = nextChild.bounds.x - currentRight;
          if (gap > 1 && rawSegments.length > 0) {
            const lastSeg = rawSegments[rawSegments.length - 1];
            rawSegments.push({
              text: "\xA0",
              style: lastSeg.style,
              tag: lastSeg.tag
            });
          }
        }
      }
      if (!skipLineBreaks && rowIdx < lineRows.length - 1 && rawSegments.length > 0) {
        rawSegments[rawSegments.length - 1].hasLineBreakAfter = true;
      }
    }
    if (skipLineBreaks) {
      for (const seg of rawSegments) {
        seg.hasLineBreakAfter = false;
      }
    }
    if (rawSegments.length === 0) return null;
    let fullText = "";
    const styledSegments = [];
    for (const seg of rawSegments) {
      if (!seg.text) continue;
      const start = fullText.length;
      fullText += seg.text;
      if (seg.hasLineBreakAfter) {
        fullText += "\n";
      }
      const end = fullText.length;
      styledSegments.push({
        start,
        end,
        text: seg.hasLineBreakAfter ? seg.text + "\n" : seg.text,
        style: seg.style,
        tag: seg.tag,
        href: seg.href
      });
    }
    if (!fullText || styledSegments.length === 0) return null;
    for (const seg of styledSegments) {
      logger4.info(`[RichText] segment [${seg.start}-${seg.end}] "${seg.text?.substring(0, 20)}" tag=${seg.tag} fontStyle=${seg.style.fontStyle} color=r${seg.style.color.r},g${seg.style.color.g},b${seg.style.color.b}`);
    }
    const baseStyle = styledSegments[0].style;
    const mergedBounds = unionBounds(children);
    return {
      id: generateId("rt"),
      name: fullText.substring(0, 30) || "#text",
      tag: parentTag,
      role: "text",
      nodeType: "text",
      bounds: mergedBounds,
      visible: true,
      opacity: parentOpacity,
      positioning: { mode: "static" },
      content: fullText,
      textStyle: baseStyle,
      styledSegments
    };
  }
  function tryMergeInlineTextRun(container, context) {
    let allChildren = container.children;
    let absoluteChildren = allChildren.filter((c) => c.positioning?.mode === "absolute");
    let children = allChildren.filter((c) => c.positioning?.mode !== "absolute");
    if (children.length <= 1 && (children.length === 0 || children[0].nodeType !== "container")) {
      return null;
    }
    if (children.length === 1 && children[0].nodeType === "container") {
      const only = children[0];
      const d = only.layout.display;
      if ((d === "inline" || d === "inline-block") && !hasVisualStyling(only)) {
        const innerChildren = only.children.filter((c) => c.positioning?.mode !== "absolute");
        const innerAbsolute = only.children.filter((c) => c.positioning?.mode === "absolute");
        const hasGradientChild = innerChildren.some((c) => {
          if (c.nodeType !== "container") return false;
          const cont = c;
          return cont.children.some((ch) => {
            if (ch.nodeType !== "text") return false;
            const t = ch;
            return t.textStyle?.gradientFill && t.textStyle.gradientFill.length > 0;
          });
        });
        if (innerChildren.length >= 2 && hasGradientChild) {
          const justify = mapTextAlignToJustify(container.layout.textAlign);
          container.layout.display = "flex";
          container.layout.flex = {
            direction: "row",
            wrap: "nowrap",
            justifyContent: justify,
            alignItems: "center",
            gap: { row: 0, column: 0 }
          };
          for (const c of innerChildren) {
            c.positioning = { mode: "static" };
            if (c.nodeType === "container") {
              const cont = c;
              for (const ch of cont.children) {
                if (ch.nodeType === "text") {
                  const t = ch;
                  if (t.textStyle) {
                    const figmaH = getLineHeightPx(t.textStyle) * (t.content || "").split("\n").length;
                    if (figmaH > cont.bounds.height) {
                      cont.bounds = { ...cont.bounds, height: figmaH };
                    }
                  }
                }
              }
            }
          }
          const gapped = applyInlineGaps(innerChildren);
          container.children = [...gapped, ...absoluteChildren];
          return [...gapped, ...absoluteChildren];
        }
        if (innerChildren.length >= 2) {
          children = innerChildren;
          absoluteChildren = [...absoluteChildren, ...innerAbsolute];
          allChildren = [...children, ...absoluteChildren];
          container.children = allChildren;
        } else {
          return null;
        }
      } else {
        return null;
      }
    }
    const display = container.layout.display;
    if (display === "flex" || display === "inline-flex" || display === "grid" || display === "inline-grid") {
      return null;
    }
    if (display === "inline" || display === "inline-block") {
      return null;
    }
    const allTextOnly = children.every(isTextOnlyNode);
    const hasInlineElement = children.some((c) => c.nodeType === "container");
    const hasLineClamp = container.layout.lineClamp != null && container.layout.lineClamp > 0;
    logger4.info(`[RichText] DEBUG lineClamp container="${container.name}" display=${display} lineClamp=${container.layout.lineClamp} hasLineClamp=${hasLineClamp}`);
    if (allTextOnly && hasInlineElement) {
      const groups = splitByGaps(children);
      if (groups.length === 1) {
        const merged = mergeChildrenSubset(children, container.tag, container.opacity, hasLineClamp);
        return merged ? [merged, ...absoluteChildren] : null;
      }
      logger4.info(`[RichText] full merge with gaps: ${groups.length} groups`);
      const newChildren2 = [];
      for (const group of groups) {
        let node;
        if (group.children.length >= 2) {
          const merged = mergeChildrenSubset(
            group.children,
            container.tag,
            container.opacity,
            hasLineClamp
          );
          node = merged || group.children[0];
        } else {
          node = group.children[0];
        }
        if (group.gapBefore > 0) {
          newChildren2.push(createHorizontalGapWrapper(node, group.gapBefore));
        } else {
          newChildren2.push(node);
        }
      }
      const justify = mapTextAlignToJustify(container.layout.textAlign);
      container.layout.display = "flex";
      container.layout.flex = {
        direction: "row",
        wrap: "nowrap",
        justifyContent: justify,
        alignItems: "baseline",
        gap: { row: 0, column: 0 }
      };
      return [...newChildren2, ...absoluteChildren];
    }
    const allMergeable = children.every((c) => isTextOnlyNode(c) || isVisualInlineWrapper(c));
    if (!allMergeable) return null;
    const textOnlyFlags = children.map(isTextOnlyNode);
    const runs = [];
    let i = 0;
    while (i < children.length) {
      const isText = textOnlyFlags[i];
      let j = i + 1;
      while (j < children.length && textOnlyFlags[j] === isText) j++;
      runs.push({ start: i, end: j, textOnly: isText });
      i = j;
    }
    logger4.info(`[RichText] partial merge: ${runs.length} runs: ${runs.map((r) => `[${r.start}-${r.end}) ${r.textOnly ? "text" : "visual"}`).join(", ")}`);
    const hasTextRun = runs.some((r) => r.textOnly);
    if (!hasTextRun) return null;
    const lineRows = clusterIntoLineRows(children);
    const isSingleLine = lineRows.length <= 1;
    const newChildren = [];
    for (const run of runs) {
      if (!run.textOnly) {
        for (let k = run.start; k < run.end; k++) {
          newChildren.push(children[k]);
        }
      } else if (run.end - run.start >= 2) {
        const runChildren = children.slice(run.start, run.end);
        if (isSingleLine) {
          const merged = mergeChildrenSubset(runChildren, container.tag, container.opacity);
          if (merged) {
            newChildren.push(merged);
          } else {
            newChildren.push(...runChildren);
          }
        } else {
          const runLineRows = clusterIntoLineRows(runChildren);
          for (const row of runLineRows) {
            const rowChildren = row.childIndices.map((idx) => runChildren[idx]);
            if (rowChildren.length >= 2) {
              const merged = mergeChildrenSubset(
                rowChildren,
                container.tag,
                container.opacity
              );
              if (merged) {
                stripTrailingNewlines(merged);
                newChildren.push(merged);
              } else {
                newChildren.push(...rowChildren);
              }
            } else {
              newChildren.push(rowChildren[0]);
            }
          }
        }
      } else {
        newChildren.push(children[run.start]);
      }
    }
    logger4.info(`[RichText] partial merge: ${newChildren.length} children, ${lineRows.length} line(s), mode=${isSingleLine ? "flex-row" : "absolute"}`);
    if (isSingleLine) {
      const justify = mapTextAlignToJustify(container.layout.textAlign);
      container.layout.display = "flex";
      container.layout.flex = {
        direction: "row",
        wrap: "nowrap",
        justifyContent: justify,
        alignItems: "center",
        gap: { row: 0, column: 0 }
      };
      for (const child of newChildren) {
        child.positioning = { mode: "static" };
      }
      const gapped = applyInlineGaps(newChildren);
      newChildren.length = 0;
      newChildren.push(...gapped);
    } else {
      const parentX = container.bounds.x;
      const parentY = container.bounds.y;
      logger4.info(`[RichText] partial merge parent bounds: x=${parentX}, y=${parentY}, w=${container.bounds.width}, h=${container.bounds.height}`);
      for (const child of newChildren) {
        const origX = child.bounds.x;
        const origY = child.bounds.y;
        child.positioning = { mode: "absolute" };
        child.bounds = {
          ...child.bounds,
          x: child.bounds.x - parentX,
          y: child.bounds.y - parentY
        };
        logger4.info(`[RichText] partial merge child "${child.name?.substring(0, 20)}" orig=(${origX}, ${origY}) -> relative=(${child.bounds.x}, ${child.bounds.y}) size=${child.bounds.width}x${child.bounds.height}`);
      }
      for (const child of newChildren) {
        if (child.nodeType === "text") {
          const textChild = child;
          const lineHeightPx = getLineHeightPx(textChild.textStyle);
          const browserHeight = child.bounds.height;
          const content = textChild.content || "";
          const numLines = (content.match(/\n/g)?.length || 0) + 1;
          const figmaHeight = numLines * lineHeightPx;
          if (figmaHeight > browserHeight) {
            const yOffset = (figmaHeight - browserHeight) / 2;
            child.bounds.y -= yOffset;
            logger4.info(`[RichText] text lineHeight adjust: "${child.name?.substring(0, 20)}" lineHeight=${lineHeightPx.toFixed(1)}px, lines=${numLines}, browserH=${browserHeight.toFixed(1)}, figmaH=${figmaHeight.toFixed(1)}, yOffset=-${yOffset.toFixed(1)}`);
          }
        }
      }
      if (!container.layout.sizing) {
        container.layout.sizing = { boxSizing: "border-box" };
      }
      container.layout.sizing.minHeight = container.bounds.height;
    }
    return [...newChildren, ...absoluteChildren];
  }

  // third-party/html2figma/upstream/packages/browser/converter/postprocess/marginCollapse.ts
  var logger5 = createLogger("NodeTraverser" /* NODE_TRAVERSER */);
  function getNodeMargin(node) {
    if (node.nodeType === "container") {
      return node.layout.margin;
    }
    return node.margin || { top: 0, right: 0, bottom: 0, left: 0 };
  }
  function clearNodeMargin(node) {
    if (node.nodeType === "container") {
      node.layout.margin = { top: 0, right: 0, bottom: 0, left: 0 };
    } else if (node.margin) {
      node.margin = void 0;
    }
  }
  function createMarginWrapper(child, padding, parentFlex, rawMargin) {
    const layout = parentFlex ? {
      display: "flex",
      flex: {
        direction: parentFlex.direction,
        wrap: "nowrap",
        justifyContent: "flex-start",
        alignItems: parentFlex.alignItems,
        gap: { row: 0, column: 0 }
      },
      padding,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    } : {
      display: "block",
      padding,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    };
    let boundsWidth;
    let boundsHeight;
    if (rawMargin) {
      boundsWidth = Math.max(1, child.bounds.width + rawMargin.left + rawMargin.right);
      boundsHeight = Math.max(1, child.bounds.height + rawMargin.top + rawMargin.bottom);
    } else {
      boundsWidth = child.bounds.width + padding.left + padding.right;
      boundsHeight = child.bounds.height + padding.top + padding.bottom;
    }
    return {
      id: generateId("margin"),
      name: "margin-wrapper",
      tag: "div",
      role: "container",
      nodeType: "container",
      bounds: {
        x: child.bounds.x - padding.left,
        y: child.bounds.y - padding.top,
        width: boundsWidth,
        height: boundsHeight
      },
      visible: true,
      opacity: 1,
      positioning: { mode: "static" },
      children: [child],
      layout,
      background: { layers: [] },
      border: {
        top: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        right: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        bottom: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        left: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }
      },
      effects: { boxShadows: [] },
      overflow: "visible"
    };
  }
  var NEGATIVE_MARGIN_THRESHOLD = -3;
  function convertToAbsoluteWithPlaceholder(child, margins, container) {
    const flowWidth = Math.max(1, child.bounds.width + Math.min(0, margins.left) + Math.min(0, margins.right));
    const flowHeight = Math.max(1, child.bounds.height + Math.min(0, margins.top) + Math.min(0, margins.bottom));
    logger5.info("[convertToAbsoluteWithPlaceholder]", child.name, {
      margins,
      childBounds: child.bounds,
      flowSize: { w: flowWidth, h: flowHeight }
    });
    const placeholder = {
      id: generateId("neg-placeholder"),
      name: "neg-margin-placeholder",
      tag: "div",
      role: "container",
      nodeType: "container",
      bounds: {
        x: child.bounds.x,
        y: child.bounds.y,
        width: flowWidth,
        height: flowHeight
      },
      visible: true,
      opacity: 0,
      positioning: { mode: "static" },
      children: [],
      layout: {
        display: "block",
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      background: { layers: [] },
      border: {
        top: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        right: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        bottom: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        left: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
        radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }
      },
      effects: { boxShadows: [] },
      overflow: "visible"
    };
    child.positioning = { mode: "absolute" };
    child.bounds = {
      ...child.bounds,
      x: child.bounds.x - container.bounds.x,
      y: child.bounds.y - container.bounds.y
    };
    return { placeholder, absoluteChild: child };
  }
  function hasSignificantNegativeMargin(margin) {
    return margin.top <= NEGATIVE_MARGIN_THRESHOLD || margin.bottom <= NEGATIVE_MARGIN_THRESHOLD || margin.left <= NEGATIVE_MARGIN_THRESHOLD || margin.right <= NEGATIVE_MARGIN_THRESHOLD;
  }
  function collapseMargins(container) {
    const display = container.layout.display;
    const isFlex = display === "flex" || display === "inline-flex" || display === "grid" || display === "inline-grid";
    const tag = container.tag;
    if (tag === "tr" || tag === "thead" || tag === "tbody" || tag === "tfoot" || tag === "table" || tag === "th" || tag === "td") {
      return;
    }
    if (isFlex) {
      logger5.info("[collapseMargins] flex path", container.name, "display=" + display);
      collapseFlexMargins(container);
      return;
    }
    const children = container.children;
    if (children.length === 0) return;
    logger5.info("[collapseMargins] block path", container.name, "display=" + display, "children=" + children.length);
    const borderTop = container.border?.top?.width || 0;
    const paddingTop = container.layout.padding?.top || 0;
    const containerContentTop = container.bounds.y + borderTop + paddingTop;
    const flowChildren = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.positioning?.mode === "absolute" || child.positioning?.mode === "fixed") continue;
      flowChildren.push({ index: i, node: child });
    }
    if (flowChildren.length === 0) return;
    const newChildren = [];
    let deferredGap = 0;
    for (let i = 0; i < children.length; i++) {
      const current = children[i];
      if (current.positioning?.mode === "absolute" || current.positioning?.mode === "fixed") {
        newChildren.push(current);
        continue;
      }
      const flowIdx = flowChildren.findIndex((fc) => fc.index === i);
      const currentMargin = getNodeMargin(current);
      if (hasSignificantNegativeMargin(currentMargin)) {
        logger5.info("[collapseMargins] negative margin child \u2192 absolute", current.name, currentMargin);
        if (current.nodeType === "container") {
          const c = current;
          c.layout.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        }
        clearNodeMargin(current);
        const { placeholder, absoluteChild } = convertToAbsoluteWithPlaceholder(
          current,
          currentMargin,
          container
        );
        newChildren.push(placeholder);
        newChildren.push(absoluteChild);
        continue;
      }
      const ml = Math.max(0, currentMargin.left);
      const mr = Math.max(0, currentMargin.right);
      const hasNegativeH = currentMargin.left < 0 || currentMargin.right < 0;
      let gapAbove = deferredGap;
      deferredGap = 0;
      if (flowIdx === 0 && current.nodeType !== "text" && !container.layout.lineClamp) {
        gapAbove += Math.max(0, Math.round(current.bounds.y - containerContentTop));
      }
      let gapBelow = 0;
      if (flowIdx >= 0 && flowIdx < flowChildren.length - 1) {
        const next = flowChildren[flowIdx + 1].node;
        const currentBottom = current.bounds.y + current.bounds.height;
        const gap = Math.max(0, Math.round(next.bounds.y - currentBottom));
        if (gap > 0 && !(current.nodeType === "text" && next.nodeType === "text")) {
          if (current.bounds.height === 0) {
            deferredGap += gap;
          } else {
            gapBelow = gap;
          }
        }
      }
      const needsWrapper = ml > 0 || mr > 0 || gapAbove > 0 || gapBelow > 0;
      logger5.info("[collapseMargins] child", current.name, "nodeType=" + current.nodeType, "flowIdx=" + flowIdx, { ml, mr, gapAbove, gapBelow, needsWrapper });
      if (current.nodeType === "container") {
        const c = current;
        c.layout.margin = { ...c.layout.margin, top: 0, bottom: 0 };
      }
      if (needsWrapper) {
        clearNodeMargin(current);
        const rawMargin = hasNegativeH ? { left: currentMargin.left, right: currentMargin.right, top: 0, bottom: 0 } : void 0;
        newChildren.push(createMarginWrapper(current, {
          top: gapAbove,
          right: mr,
          bottom: gapBelow,
          left: ml
        }, void 0, rawMargin));
      } else {
        newChildren.push(current);
      }
    }
    container.children = newChildren;
  }
  function collapseFlexMargins(container) {
    const children = container.children;
    if (children.length === 0) return;
    const parentFlex = container.layout.flex;
    const newChildren = [];
    for (const child of children) {
      if (child.positioning?.mode === "absolute" || child.positioning?.mode === "fixed") {
        newChildren.push(child);
        continue;
      }
      const childMargin = getNodeMargin(child);
      if (hasSignificantNegativeMargin(childMargin)) {
        logger5.info("[collapseFlexMargins] negative margin child \u2192 absolute", child.name, childMargin);
        clearNodeMargin(child);
        const { placeholder, absoluteChild } = convertToAbsoluteWithPlaceholder(
          child,
          childMargin,
          container
        );
        newChildren.push(placeholder);
        newChildren.push(absoluteChild);
        continue;
      }
      let mt = Math.max(0, childMargin.top);
      let mb = Math.max(0, childMargin.bottom);
      let ml = Math.max(0, childMargin.left);
      let mr = Math.max(0, childMargin.right);
      if (parentFlex) {
        const isRow = parentFlex.direction === "row" || parentFlex.direction === "row-reverse";
        const align = parentFlex.alignItems;
        if (align && align !== "stretch") {
          if (isRow) {
            mt = 0;
            mb = 0;
          } else {
            ml = 0;
            mr = 0;
          }
        }
      }
      const hasNegative = childMargin.top < 0 || childMargin.right < 0 || childMargin.bottom < 0 || childMargin.left < 0;
      if (mt > 0 || mr > 0 || mb > 0 || ml > 0) {
        clearNodeMargin(child);
        newChildren.push(createMarginWrapper(child, {
          top: mt,
          right: mr,
          bottom: mb,
          left: ml
        }, parentFlex, hasNegative ? childMargin : void 0));
      } else {
        clearNodeMargin(child);
        newChildren.push(child);
      }
    }
    container.children = newChildren;
  }

  // third-party/html2figma/upstream/packages/browser/converter/postprocess/stackingOrder.ts
  function sortByStackingOrder(container) {
    if (!container.children || container.children.length <= 1) return;
    const hasRelative = container.children.some((c) => c.positioning.mode === "relative");
    const hasStatic = container.children.some((c) => c.positioning.mode === "static");
    const needsSorting = container.children.some((child) => {
      const mode = child.positioning.mode;
      if (mode === "absolute" || mode === "fixed") return true;
      if (mode === "relative" && child.positioning.zIndex !== void 0) return true;
      return false;
    }) || hasRelative && hasStatic;
    if (!needsSorting) return;
    promoteRelativeChildren(container);
    sortAutoLayoutStackingOrder(container);
  }
  function promoteRelativeChildren(container) {
    const parentX = container.bounds.x;
    const parentY = container.bounds.y;
    const infos = container.children.map((child, i) => {
      const mode = child.positioning.mode;
      const zIndex = child.positioning.zIndex;
      return {
        child,
        domIndex: i,
        isRelative: mode === "relative",
        isRelativeWithZ: mode === "relative" && zIndex !== void 0,
        zIndex
      };
    });
    const staticBounds = infos.filter((i) => i.child.positioning.mode === "static").map((i) => i.child.bounds);
    const promotedChildren = [];
    const newChildren = [];
    for (const info of infos) {
      const promoteWithZ = info.isRelativeWithZ && needsPromotion(info, infos);
      const promoteAuto = info.isRelative && !info.isRelativeWithZ && staticBounds.some((sb) => boundsOverlap(info.child.bounds, sb));
      if (!promoteWithZ && !promoteAuto) {
        newChildren.push(info.child);
        continue;
      }
      const child = info.child;
      const placeholder = {
        id: generateId("z-placeholder"),
        name: "z-index-placeholder",
        tag: "div",
        role: "container",
        nodeType: "container",
        bounds: { ...child.bounds },
        visible: true,
        opacity: 0,
        positioning: { mode: "static" },
        children: [],
        layout: {
          display: "block",
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          margin: { top: 0, right: 0, bottom: 0, left: 0 }
        },
        background: { layers: [] },
        border: {
          top: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
          right: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
          bottom: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
          left: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }
        },
        effects: { boxShadows: [] },
        overflow: "visible"
      };
      newChildren.push(placeholder);
      child.bounds = {
        ...child.bounds,
        x: child.bounds.x - parentX,
        y: child.bounds.y - parentY
      };
      child.positioning = {
        ...child.positioning,
        mode: "absolute"
      };
      promotedChildren.push(child);
    }
    container.children = [...newChildren, ...promotedChildren];
  }
  function needsPromotion(target, allChildren) {
    const z = target.zIndex ?? 0;
    if (z !== 0) return true;
    const hasAbsFixed = allChildren.some((info) => {
      const mode = info.child.positioning.mode;
      return mode === "absolute" || mode === "fixed";
    });
    return hasAbsFixed;
  }
  function sortAutoLayoutStackingOrder(container) {
    const flowEntries = [];
    const absEntries = [];
    container.children.forEach((child, i) => {
      const mode = child.positioning.mode;
      const zIndex = child.positioning.zIndex;
      const isOutOfFlow2 = mode === "absolute" || mode === "fixed";
      if (isOutOfFlow2) {
        absEntries.push({ child, domIndex: i, zLevel: zIndex ?? 0 });
      } else {
        const isPositioned = mode === "relative" || mode === "sticky";
        flowEntries.push({ child, domIndex: i, zLevel: isPositioned ? 0 : -0.5 });
      }
    });
    if (absEntries.length === 0) return;
    absEntries.sort((a, b) => a.zLevel - b.zLevel || a.domIndex - b.domIndex);
    const result = [];
    let absIdx = 0;
    for (let flowIdx = 0; flowIdx <= flowEntries.length; flowIdx++) {
      while (absIdx < absEntries.length) {
        const abs = absEntries[absIdx];
        if (flowIdx < flowEntries.length) {
          const flow = flowEntries[flowIdx];
          if (abs.zLevel < flow.zLevel || abs.zLevel === flow.zLevel && abs.domIndex < flow.domIndex) {
            result.push(abs.child);
            absIdx++;
            continue;
          }
        } else {
          result.push(abs.child);
          absIdx++;
          continue;
        }
        break;
      }
      if (flowIdx < flowEntries.length) {
        result.push(flowEntries[flowIdx].child);
      }
    }
    container.children = result;
  }
  function boundsOverlap(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  // third-party/html2figma/upstream/packages/browser/converter/postprocess/gridLayout.ts
  function parseTrackSizes(template) {
    if (!template || template === "none") return [];
    return template.trim().split(/\s+/).map((v) => parseFloat(v));
  }
  function groupChildrenIntoRows(children) {
    if (children.length === 0) return [];
    const sorted = [...children].sort(
      (a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x
    );
    const rows = [];
    let currentRowY = sorted[0].bounds.y;
    let currentRow = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const child = sorted[i];
      if (Math.abs(child.bounds.y - currentRowY) <= 3) {
        currentRow.push(child);
      } else {
        rows.push(currentRow);
        currentRow = [child];
        currentRowY = child.bounds.y;
      }
    }
    rows.push(currentRow);
    return rows;
  }
  function isSimpleGrid(flowChildren, columnCount, colWidths) {
    const rows = groupChildrenIntoRows(flowChildren);
    const maxColWidth = Math.max(...colWidths);
    for (let i = 0; i < rows.length; i++) {
      const isLastRow = i === rows.length - 1;
      const count = rows[i].length;
      if (!isLastRow && count !== columnCount) return false;
      if (count > columnCount) return false;
      for (const child of rows[i]) {
        if (child.bounds.width > maxColWidth * 1.3) return false;
      }
      if (!isLastRow && i + 1 < rows.length) {
        const nextRowY = rows[i + 1][0].bounds.y;
        for (const child of rows[i]) {
          if (child.bounds.y + child.bounds.height > nextRowY + 3) return false;
        }
      }
    }
    return true;
  }
  function mapJustifyItems(value) {
    switch (value) {
      case "center":
        return "center";
      case "end":
      case "flex-end":
      case "right":
        return "flex-end";
      case "start":
      case "flex-start":
      case "left":
        return "flex-start";
      default:
        return "stretch";
    }
  }
  function mapAlignItems(value) {
    switch (value) {
      case "center":
        return "center";
      case "end":
      case "flex-end":
        return "flex-end";
      case "start":
      case "flex-start":
        return "flex-start";
      default:
        return "stretch";
    }
  }
  var emptyBorder = {
    top: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
    right: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
    bottom: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
    left: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
    radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }
  };
  var zeroPadding = { top: 0, right: 0, bottom: 0, left: 0 };
  function makeWrapper(id, name, bounds, children, direction, justifyContent, alignItems, gap) {
    return {
      id,
      name,
      tag: "div",
      role: "container",
      nodeType: "container",
      bounds,
      visible: true,
      opacity: 1,
      positioning: { mode: "static" },
      children,
      layout: {
        display: "flex",
        flex: {
          direction,
          wrap: "nowrap",
          justifyContent,
          alignItems,
          gap
        },
        padding: zeroPadding,
        margin: zeroPadding
      },
      background: { layers: [] },
      border: emptyBorder,
      effects: { boxShadows: [] },
      overflow: "visible"
    };
  }
  function absoluteFallback(container, flowChildren, absoluteChildren) {
    const parentX = container.bounds.x;
    const parentY = container.bounds.y;
    for (const child of flowChildren) {
      child.positioning = { ...child.positioning, mode: "absolute" };
      child.bounds = {
        ...child.bounds,
        x: child.bounds.x - parentX,
        y: child.bounds.y - parentY
      };
    }
    container.layout.display = "block";
    container.layout.grid = void 0;
    container.children = [...flowChildren, ...absoluteChildren];
  }
  function createGridCell(child, cellWidth, cellHeight, justifyItems, alignItems) {
    const flooredWidth = Math.floor(cellWidth);
    const flooredHeight = Math.floor(cellHeight);
    const isStretchH = justifyItems === "stretch";
    const isStretchV = alignItems === "stretch";
    if (isStretchH && isStretchV) {
      child.bounds = { ...child.bounds, width: flooredWidth, height: flooredHeight };
      return child;
    }
    const cellBounds = {
      x: child.bounds.x,
      y: child.bounds.y,
      width: flooredWidth,
      height: flooredHeight
    };
    if (isStretchH) {
      child.bounds = { ...child.bounds, width: flooredWidth };
    }
    if (isStretchV) {
      child.bounds = { ...child.bounds, height: flooredHeight };
    }
    return makeWrapper(
      generateId("grid-cell"),
      "grid-cell",
      cellBounds,
      [child],
      "row",
      // horizontal direction for justify-items mapping
      justifyItems,
      alignItems,
      { row: 0, column: 0 }
    );
  }
  function createGridRowWrapper(children, colWidths, rowHeight, columnGap, justifyItems, alignItems) {
    const cells = [];
    for (let i = 0; i < children.length; i++) {
      const cellWidth = colWidths[i] ?? colWidths[colWidths.length - 1] ?? children[i].bounds.width;
      const cell = createGridCell(children[i], cellWidth, rowHeight, justifyItems, alignItems);
      cells.push(cell);
    }
    const rowWidth = colWidths.slice(0, children.length).reduce((a, b) => a + b, 0) + Math.max(0, children.length - 1) * columnGap;
    const rowBounds = {
      x: cells[0]?.bounds.x ?? 0,
      y: cells[0]?.bounds.y ?? 0,
      width: rowWidth,
      height: rowHeight
    };
    return makeWrapper(
      generateId("grid-row"),
      "grid-row",
      rowBounds,
      cells,
      "row",
      "flex-start",
      "stretch",
      { row: 0, column: columnGap }
    );
  }
  function convertToFlexRow(container, flowChildren, absoluteChildren, colWidths, rowHeight, columnGap, justifyItems, alignItems) {
    const cells = [];
    for (let i = 0; i < flowChildren.length; i++) {
      const cellWidth = colWidths[i] ?? colWidths[colWidths.length - 1] ?? flowChildren[i].bounds.width;
      const cell = createGridCell(flowChildren[i], cellWidth, rowHeight, justifyItems, alignItems);
      cells.push(cell);
    }
    container.layout.display = "flex";
    container.layout.flex = {
      direction: "row",
      wrap: "nowrap",
      justifyContent: "flex-start",
      alignItems: "stretch",
      gap: { row: 0, column: columnGap }
    };
    container.layout.grid = void 0;
    container.children = [...cells, ...absoluteChildren];
  }
  function convertToFlexColumn(container, flowChildren, absoluteChildren, rowGap) {
    container.layout.display = "flex";
    container.layout.flex = {
      direction: "column",
      wrap: "nowrap",
      justifyContent: "flex-start",
      alignItems: "stretch",
      gap: { row: rowGap, column: 0 }
    };
    container.layout.grid = void 0;
    container.children = [...flowChildren, ...absoluteChildren];
  }
  function convertToNestedFlex(container, flowChildren, absoluteChildren, columnCount, colWidths, rowHeights, rowGap, columnGap, justifyItems, alignItems) {
    const rows = [];
    for (let i = 0; i < flowChildren.length; i += columnCount) {
      rows.push(flowChildren.slice(i, i + columnCount));
    }
    const rowWrappers = rows.map((row, rowIdx) => {
      const rowHeight = rowHeights[rowIdx] ?? rowHeights[rowHeights.length - 1] ?? unionBounds(row).height;
      return createGridRowWrapper(row, colWidths, rowHeight, columnGap, justifyItems, alignItems);
    });
    container.layout.display = "flex";
    container.layout.flex = {
      direction: "column",
      wrap: "nowrap",
      justifyContent: "flex-start",
      alignItems: "stretch",
      gap: { row: rowGap, column: 0 }
    };
    container.layout.grid = void 0;
    container.children = [...rowWrappers, ...absoluteChildren];
  }
  function restructureGrid(container) {
    const display = container.layout.display;
    if (display !== "grid" && display !== "inline-grid") return;
    if (!container.children.length) return;
    const templateColumns = container.layout.grid?.templateColumns;
    if (!templateColumns || templateColumns === "none") return;
    const colWidths = parseTrackSizes(templateColumns);
    const columnCount = colWidths.length;
    if (columnCount === 0) return;
    const templateRows = container.layout.grid?.templateRows ?? "none";
    const rowHeights = parseTrackSizes(templateRows);
    const rowGap = container.layout.grid?.gap.row ?? 0;
    const columnGap = container.layout.grid?.gap.column ?? 0;
    const justifyItems = mapJustifyItems(container.layout.grid?.justifyItems);
    const alignItems = mapAlignItems(container.layout.grid?.alignItems);
    const isOutOfFlow2 = (c) => c.positioning?.mode === "absolute" || c.positioning?.mode === "fixed";
    const absoluteChildren = container.children.filter(isOutOfFlow2);
    const flowChildren = container.children.filter((c) => !isOutOfFlow2(c));
    if (flowChildren.length === 0) return;
    if (!isSimpleGrid(flowChildren, columnCount, colWidths)) {
      absoluteFallback(container, flowChildren, absoluteChildren);
      return;
    }
    if (columnCount === 1) {
      convertToFlexColumn(container, flowChildren, absoluteChildren, rowGap);
      return;
    }
    if (flowChildren.length <= columnCount) {
      const rowHeight = rowHeights[0] ?? unionBounds(flowChildren).height;
      convertToFlexRow(container, flowChildren, absoluteChildren, colWidths, rowHeight, columnGap, justifyItems, alignItems);
      return;
    }
    convertToNestedFlex(
      container,
      flowChildren,
      absoluteChildren,
      columnCount,
      colWidths,
      rowHeights,
      rowGap,
      columnGap,
      justifyItems,
      alignItems
    );
  }

  // third-party/html2figma/upstream/packages/browser/converter/postprocess/tableLayout.ts
  var TABLE_TAGS = /* @__PURE__ */ new Set(["table"]);
  var TABLE_SECTION_TAGS = /* @__PURE__ */ new Set(["thead", "tbody", "tfoot"]);
  var TABLE_ROW_TAG = "tr";
  var TABLE_CELL_TAGS = /* @__PURE__ */ new Set(["td", "th"]);
  function isContainer(node) {
    return node.nodeType === "container";
  }
  function isOutOfFlow(node) {
    return node.positioning?.mode === "absolute" || node.positioning?.mode === "fixed";
  }
  function mapVerticalAlign(tag, node) {
    const va = node.layout.verticalAlign;
    if (va === "middle") return "center";
    if (va === "bottom") return "flex-end";
    return "flex-start";
  }
  function collectRows(tableContainer) {
    const rows = [];
    for (const child of tableContainer.children) {
      if (!isContainer(child)) continue;
      if (child.tag === TABLE_ROW_TAG) {
        rows.push(child);
      } else if (TABLE_SECTION_TAGS.has(child.tag)) {
        for (const sectionChild of child.children) {
          if (isContainer(sectionChild) && sectionChild.tag === TABLE_ROW_TAG) {
            rows.push(sectionChild);
          }
        }
      }
    }
    return rows;
  }
  function getCells(row) {
    return row.children.filter((c) => {
      if (isOutOfFlow(c)) return false;
      return true;
    });
  }
  function isSimpleTable(rows) {
    if (rows.length === 0) return false;
    const cellCounts = rows.map((r) => getCells(r).length);
    const firstCount = cellCounts[0];
    for (const count of cellCounts) {
      if (count !== firstCount) return false;
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const nextRowY = rows[i + 1].bounds.y;
      const cells = getCells(rows[i]);
      for (const cell of cells) {
        if (cell.bounds.y + cell.bounds.height > nextRowY + 3) return false;
      }
    }
    if (firstCount > 0) {
      const avgWidth = rows[0].bounds.width / firstCount;
      for (const row of rows) {
        for (const cell of getCells(row)) {
          if (cell.bounds.width > avgWidth * 1.5) return false;
        }
      }
    }
    return true;
  }
  function convertSimpleTable(container, rows, spacing) {
    const rowWrappers = [];
    let rowGap = spacing.row;
    if (rows.length >= 2) {
      const gaps = [];
      for (let i = 0; i < rows.length - 1; i++) {
        const gap = Math.round(rows[i + 1].bounds.y - (rows[i].bounds.y + rows[i].bounds.height));
        if (gap > 0) gaps.push(gap);
      }
      if (gaps.length > 0) {
        rowGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      }
    }
    let colGap = spacing.column;
    if (rows.length > 0) {
      const firstCells = getCells(rows[0]);
      if (firstCells.length >= 2) {
        const gaps = [];
        for (let i = 0; i < firstCells.length - 1; i++) {
          const gap = Math.round(firstCells[i + 1].bounds.x - (firstCells[i].bounds.x + firstCells[i].bounds.width));
          if (gap > 0) gaps.push(gap);
        }
        if (gaps.length > 0) {
          colGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
        }
      }
    }
    for (const row of rows) {
      const cells = getCells(row);
      const absCells = row.children.filter(isOutOfFlow);
      for (const cell of cells) {
        if (isContainer(cell) && TABLE_CELL_TAGS.has(cell.tag)) {
          const va = mapVerticalAlign(cell.tag, cell);
          cell.layout.display = "flex";
          cell.layout.flex = {
            direction: "column",
            wrap: "nowrap",
            justifyContent: va === "center" ? "center" : va === "flex-end" ? "flex-end" : "flex-start",
            alignItems: "stretch",
            gap: { row: 0, column: 0 }
          };
        }
      }
      row.layout.display = "flex";
      row.layout.flex = {
        direction: "row",
        wrap: "nowrap",
        justifyContent: "flex-start",
        alignItems: "stretch",
        gap: { row: 0, column: colGap }
      };
      row.children = [...cells, ...absCells];
      rowWrappers.push(row);
    }
    const absChildren = container.children.filter(isOutOfFlow);
    container.layout.display = "flex";
    container.layout.flex = {
      direction: "column",
      wrap: "nowrap",
      justifyContent: "flex-start",
      alignItems: "stretch",
      gap: { row: rowGap, column: 0 }
    };
    container.children = [...rowWrappers, ...absChildren];
  }
  function absoluteFallback2(container, rows) {
    const parentX = container.bounds.x;
    const parentY = container.bounds.y;
    const allCells = [];
    for (const row of rows) {
      for (const cell of row.children) {
        if (!isOutOfFlow(cell)) {
          cell.positioning = { ...cell.positioning, mode: "absolute" };
          cell.bounds = {
            ...cell.bounds,
            x: cell.bounds.x - parentX,
            y: cell.bounds.y - parentY
          };
        }
        allCells.push(cell);
      }
    }
    const absChildren = container.children.filter(isOutOfFlow);
    container.layout.display = "block";
    container.children = [...allCells, ...absChildren];
  }
  var ZERO_BORDER_SIDE = { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } };
  function deduplicateCollapsedBorders(rows) {
    const totalRows = rows.length;
    for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
      const cells = getCells(rows[rowIdx]);
      const totalCols = cells.length;
      const isLastRow = rowIdx === totalRows - 1;
      for (let colIdx = 0; colIdx < totalCols; colIdx++) {
        const cell = cells[colIdx];
        if (!isContainer(cell)) continue;
        const isLastCol = colIdx === totalCols - 1;
        if (!isLastCol) {
          cell.border = { ...cell.border, right: { ...ZERO_BORDER_SIDE } };
        }
        if (!isLastRow) {
          cell.border = { ...cell.border, bottom: { ...ZERO_BORDER_SIDE } };
        }
      }
    }
  }
  function processTable(container) {
    const rows = collectRows(container);
    if (rows.length === 0) return;
    const spacing = container.layout.borderCollapse ? { row: 0, column: 0 } : container.layout.tableSpacing ?? { row: 0, column: 0 };
    if (isSimpleTable(rows)) {
      convertSimpleTable(container, rows, spacing);
    } else {
      absoluteFallback2(container, rows);
    }
    if (container.layout.borderCollapse) {
      deduplicateCollapsedBorders(rows);
    }
  }
  function restructureTable(container) {
    for (const child of container.children) {
      if (isContainer(child)) {
        restructureTable(child);
      }
    }
    if (TABLE_TAGS.has(container.tag)) {
      processTable(container);
    }
    if (TABLE_SECTION_TAGS.has(container.tag)) {
      const rows = container.children.filter(
        (c) => isContainer(c) && c.tag === TABLE_ROW_TAG
      );
      if (rows.length > 0) {
        const spacing = container.layout.tableSpacing ?? { row: 0, column: 0 };
        if (isSimpleTable(rows)) {
          convertSimpleTable(container, rows, spacing);
        } else {
          absoluteFallback2(container, rows);
        }
      }
    }
  }

  // third-party/html2figma/upstream/packages/browser/converter/postprocess/floatLayout.ts
  function detectFloatContainer(container) {
    const display = container.layout.display;
    if (display === "flex" || display === "inline-flex" || display === "grid" || display === "inline-grid") {
      return;
    }
    for (const child of container.children) {
      if (child.nodeType === "container" && child.layout.float && child.layout.float !== "none") {
        container.layout.hasFloatChildren = true;
        return;
      }
    }
  }
  function adjustFloatSiblings(container) {
    if (!container.layout.hasFloatChildren) return;
    const floats = [];
    for (const child of container.children) {
      if (child.nodeType !== "container") continue;
      const c = child;
      if (!c.layout.float || c.layout.float === "none") continue;
      floats.push({
        right: c.bounds.x + c.bounds.width + c.layout.margin.right,
        left: c.bounds.x - c.layout.margin.left,
        top: c.bounds.y,
        bottom: c.bounds.y + c.bounds.height,
        side: c.layout.float
      });
    }
    if (floats.length === 0) return;
    for (const child of container.children) {
      if (child.nodeType === "container") {
        const c = child;
        if (c.layout.float && c.layout.float !== "none") continue;
      }
      for (const float of floats) {
        const childTop = child.bounds.y;
        const childBottom = child.bounds.y + child.bounds.height;
        if (childBottom <= float.top || childTop >= float.bottom) continue;
        if (float.side === "left") {
          const shift = float.right - child.bounds.x;
          if (shift > 0) {
            child.bounds = {
              ...child.bounds,
              x: child.bounds.x + shift,
              width: Math.max(0, child.bounds.width - shift)
            };
            if (child.nodeType === "container") {
              shiftFlowDescendants(child, shift, 0);
            }
          }
        } else {
          const childRight = child.bounds.x + child.bounds.width;
          const overflow = childRight - float.left;
          if (overflow > 0) {
            child.bounds = {
              ...child.bounds,
              width: Math.max(0, child.bounds.width - overflow)
            };
          }
        }
      }
    }
  }
  function shiftFlowDescendants(container, dx, dy) {
    for (const child of container.children) {
      if (child.positioning.mode === "absolute" || child.positioning.mode === "fixed") {
        continue;
      }
      child.bounds = {
        ...child.bounds,
        x: child.bounds.x + dx,
        y: child.bounds.y + dy
      };
      if (child.nodeType === "container") {
        shiftFlowDescendants(child, dx, dy);
      }
    }
  }

  // third-party/html2figma/upstream/packages/browser/converter/postprocess/expandCollapsed.ts
  var COLLAPSED_THRESHOLD = 1;
  function expandCollapsedContainers(root) {
    _expandRecursive(root);
  }
  function _expandRecursive(container) {
    for (const child of container.children) {
      if (child.nodeType === "container") {
        _expandRecursive(child);
      }
    }
    if (container.bounds.width > COLLAPSED_THRESHOLD || container.bounds.height > COLLAPSED_THRESHOLD) {
      return;
    }
    if (container.overflow !== "visible") {
      return;
    }
    const flowChildren = container.children.filter(
      (ch) => ch.positioning?.mode !== "absolute" && ch.positioning?.mode !== "fixed"
    );
    if (flowChildren.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ch of flowChildren) {
      const b = ch.bounds;
      if (b.width === 0 && b.height === 0) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    if (!isFinite(minX) || !isFinite(minY)) return;
    const expandedW = maxX - minX;
    const expandedH = maxY - minY;
    if (expandedW <= COLLAPSED_THRESHOLD && expandedH <= COLLAPSED_THRESHOLD) return;
    container.bounds = {
      x: container.bounds.x + minX,
      y: container.bounds.y + minY,
      width: expandedW,
      height: expandedH
    };
    for (const ch of container.children) {
      ch.bounds = {
        ...ch.bounds,
        x: ch.bounds.x - minX,
        y: ch.bounds.y - minY
      };
    }
  }

  // third-party/html2figma/upstream/packages/browser/converter/convert.ts
  var logger6 = createLogger("NodeTraverser" /* NODE_TRAVERSER */);
  function renderToDesignDSL(renderNode, options = {}) {
    logger6.info("[convert] renderToDesignDSL called");
    const {
      includeRawStyles = false,
      scale = 1,
      maxDepth = 100
    } = options;
    let baseX = 0;
    let baseY = 0;
    if (renderNode.boundingRect) {
      baseX = renderNode.boundingRect.left;
      baseY = renderNode.boundingRect.top;
    }
    const context = {
      baseX,
      baseY,
      scale,
      maxDepth,
      includeRawStyles,
      depth: 0
    };
    const result = convertNode(renderNode, null, context);
    if (result && result.nodeType === "container") {
      hoistFixedElements(result);
      relativizeAllFlowCoordinates(result);
      expandCollapsedContainers(result);
      adjustAllFieldsetLegends(result);
    }
    return result;
  }
  function convertNode(node, parentNode, context) {
    if (context.depth > context.maxDepth) return null;
    if (!node.visible) return null;
    const nodeType = determineNodeType(node);
    switch (nodeType) {
      case "text":
        return convertTextNode(node, parentNode, context);
      case "image":
        return convertImageNode(node, context);
      case "svg":
        return convertSVGNode(node, context);
      case "container":
        return convertContainerNode(node, context);
      default:
        return null;
    }
  }
  function convertTextNode(node, parentNode, context) {
    const textNode = buildTextNode(
      node,
      parentNode,
      context.baseX,
      context.baseY,
      context.includeRawStyles
    );
    if (!textNode.content) return null;
    return inlineTextWrapperEffect(textNode);
  }
  function convertImageNode(node, context) {
    return buildImageNode(
      node,
      context.baseX,
      context.baseY,
      context.includeRawStyles
    );
  }
  function convertSVGNode(node, context) {
    return buildSVGNode(
      node,
      context.baseX,
      context.baseY,
      context.includeRawStyles
    );
  }
  function convertContainerNode(node, context) {
    const container = buildContainerNode(
      node,
      context.baseX,
      context.baseY,
      context.includeRawStyles
    );
    if (node.children && node.children.length > 0) {
      const childContext = {
        ...context,
        depth: context.depth + 1
      };
      const children = [];
      for (const child of node.children) {
        const converted = convertNode(child, node, childContext);
        if (converted) {
          children.push(converted);
        }
      }
      container.children = children;
      mergeListItems(container);
      if (container.layout.lineClamp) {
        propagateLineClamp(container, container.layout.lineClamp);
      }
      sortByFlexOrder(container);
      relativeizeAbsoluteChildren(container);
      detectFloatContainer(container);
      adjustFloatSiblings(container);
      restructureGrid(container);
      restructureTable(container);
      if (!container.layout.hasFloatChildren) {
        const mergedChildren = tryMergeInlineTextRun(container, context);
        if (mergedChildren) {
          container.children = mergedChildren;
        }
        container.children = groupInlineChildren(container);
        logger6.info("[convert] before collapseMargins", container.name, "display=" + container.layout.display, "children=" + container.children.length);
        collapseMargins(container);
      }
      sortByStackingOrder(container);
      centerTextInVisualContainer(container);
    }
    return container;
  }
  function sortByFlexOrder(container) {
    const display = container.layout.display;
    if (display !== "flex" && display !== "inline-flex" && display !== "grid" && display !== "inline-grid") return;
    const children = container.children;
    if (children.length <= 1) return;
    const hasOrder = children.some(
      (c) => c.positioning?.mode !== "absolute" && c.positioning?.mode !== "fixed" && c.flexItem?.order !== void 0
    );
    if (!hasOrder) return;
    const indexed = children.map((child, i) => ({ child, domIndex: i }));
    const absFixed = [];
    const flow = [];
    for (const entry of indexed) {
      const mode = entry.child.positioning?.mode;
      if (mode === "absolute" || mode === "fixed") {
        absFixed.push(entry);
      } else {
        flow.push(entry);
      }
    }
    flow.sort((a, b) => {
      const orderA = a.child.flexItem?.order ?? 0;
      const orderB = b.child.flexItem?.order ?? 0;
      return orderA - orderB || a.domIndex - b.domIndex;
    });
    const result = [];
    let flowIdx = 0;
    for (let i = 0; i < children.length; i++) {
      const mode = children[i].positioning?.mode;
      if (mode === "absolute" || mode === "fixed") {
        result.push(children[i]);
      } else {
        result.push(flow[flowIdx++].child);
      }
    }
    container.children = result;
  }
  function adjustAllFieldsetLegends(container) {
    for (const child of container.children) {
      if (child.nodeType === "container") {
        adjustAllFieldsetLegends(child);
      }
    }
    if (container.tag !== "fieldset") return;
    const legendIdx = container.children.findIndex(
      (c) => c.nodeType === "container" && c.tag === "legend"
    );
    if (legendIdx === -1) return;
    const legend = container.children[legendIdx];
    const borderWidth = container.border?.top?.width ?? 0;
    legend.positioning = { ...legend.positioning, mode: "absolute" };
    legend.bounds = {
      ...legend.bounds,
      y: -(legend.bounds.height / 2) + borderWidth / 2
    };
    if (!legend.background?.layers?.length) {
      legend.background = {
        layers: [{
          type: "color",
          color: { r: 255, g: 255, b: 255, a: 1 }
        }]
      };
    }
  }
  function mergeListItems(container) {
    const tag = container.tag;
    if (tag !== "ul" && tag !== "ol") return;
    const children = container.children;
    if (children.length === 0) return;
    const listStyleType = container.listStyleType || (tag === "ol" ? "decimal" : "disc");
    if (listStyleType === "none") return;
    const liItems = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.positioning?.mode === "absolute" || child.positioning?.mode === "fixed") continue;
      if (child.nodeType !== "container") return;
      const li = child;
      if (li.tag !== "li") return;
      if (liHasVisualStyling(li)) return;
      const textNode = extractSingleTextNode(li);
      if (!textNode) return;
      liItems.push({ text: textNode, li });
    }
    if (liItems.length === 0) return;
    const isNativeUnordered = listStyleType === "disc";
    const isNativeOrdered = listStyleType === "decimal";
    const useNativeList = isNativeUnordered || isNativeOrdered;
    const baseStyle = liItems[0].text.textStyle;
    let fullText = "";
    const segments = [];
    for (let i = 0; i < liItems.length; i++) {
      const { text, li } = liItems[i];
      let prefix = "";
      if (!useNativeList) {
        const marker = li.listMarker;
        if (marker) {
          prefix = marker + " ";
        }
      }
      const lineStart = fullText.length;
      fullText += prefix;
      if (text.styledSegments && text.styledSegments.length > 0) {
        if (prefix) {
          segments.push({
            start: lineStart,
            end: lineStart + prefix.length,
            text: prefix,
            style: text.textStyle
          });
        }
        for (const seg of text.styledSegments) {
          segments.push({
            ...seg,
            start: lineStart + prefix.length + seg.start,
            end: lineStart + prefix.length + seg.end,
            text: seg.text
          });
        }
        fullText += text.content;
      } else {
        fullText += text.content;
        segments.push({
          start: lineStart,
          end: fullText.length,
          text: prefix + text.content,
          style: text.textStyle
        });
      }
      if (i < liItems.length - 1) {
        fullText += "\n";
      }
    }
    const mergedText = {
      id: generateId("lt"),
      name: fullText.substring(0, 30),
      tag,
      role: "text",
      nodeType: "text",
      bounds: { ...container.bounds },
      visible: true,
      opacity: container.opacity,
      positioning: { mode: "static" },
      content: fullText,
      textStyle: baseStyle,
      styledSegments: segments.length > 1 ? segments : void 0,
      // Only use Figma native list for disc/decimal
      listType: useNativeList ? isNativeOrdered ? "ordered" : "unordered" : void 0
    };
    container.children = [mergedText];
  }
  function liHasVisualStyling(li) {
    const bg = li.background;
    if (bg?.layers && bg.layers.length > 0) {
      for (const layer of bg.layers) {
        if (layer.type === "color") {
          const { r, g, b, a } = layer.color;
          if (a > 0.01 && !(r === 0 && g === 0 && b === 0 && a < 0.05)) return true;
        }
        if (layer.type !== "color") return true;
      }
    }
    const border = li.border;
    if (border) {
      const sides = [border.top, border.right, border.bottom, border.left];
      for (const side of sides) {
        if (side && side.width > 0 && side.color) {
          const { a } = side.color;
          if (a > 0.01) return true;
        }
      }
    }
    return false;
  }
  function extractSingleTextNode(li) {
    const flowChildren = li.children.filter(
      (c) => c.positioning?.mode !== "absolute" && c.positioning?.mode !== "fixed"
    );
    if (flowChildren.length === 1 && flowChildren[0].nodeType === "text") {
      return flowChildren[0];
    }
    if (flowChildren.length === 1 && flowChildren[0].nodeType === "container") {
      return extractSingleTextNode(flowChildren[0]);
    }
    return null;
  }
  function propagateLineClamp(container, lineClamp) {
    for (const child of container.children) {
      if (child.nodeType === "text") {
        const text = child;
        if (!text.textStyle.maxLines) {
          text.textStyle.maxLines = lineClamp;
        }
      } else if (child.nodeType === "container") {
        const childContainer = child;
        if (!childContainer.layout.lineClamp) {
          propagateLineClamp(childContainer, lineClamp);
        }
      }
    }
  }

  // third-party/html2figma/integration/grid.ts
  function renderPreservingGrid(tree, options) {
    const grids = /* @__PURE__ */ new Map();
    const prune = (node) => {
      if (node.nodeType === "element" && ["grid", "inline-grid"].includes(node.computedStyle?.display ?? "") && node.metadata?.semantic) {
        grids.set(node.metadata.semantic, node);
        return { ...node, children: [] };
      }
      return { ...node, children: node.children.map(prune) };
    };
    const result = renderToDesignDSL(prune(tree), options);
    const restore = (node) => {
      if (node.nodeType !== "container") return;
      const original = node.semantic && grids.get(node.semantic);
      if (original) {
        const rect = original.boundingRect;
        const local = buildContainerNode(original, rect?.left ?? 0, rect?.top ?? 0, false);
        node.children = original.children.flatMap((child) => {
          const converted = child.nodeType === "text" ? buildTextNode(
            child,
            original,
            child.boundingRect?.left ?? 0,
            child.boundingRect?.top ?? 0,
            options.includeRawStyles
          ) : renderPreservingGrid(child, options);
          if (!converted) return [];
          if (converted.nodeType === "text" && !converted.content) return [];
          converted.bounds.x += (child.boundingRect?.left ?? 0) - (rect?.left ?? 0) - local.bounds.x;
          converted.bounds.y += (child.boundingRect?.top ?? 0) - (rect?.top ?? 0) - local.bounds.y;
          return [converted];
        });
        const flow = node.children.filter((child) => !["absolute", "fixed"].includes(child.positioning.mode)).sort((left, right) => (left.flexItem?.order ?? 0) - (right.flexItem?.order ?? 0));
        let index = 0;
        node.children = node.children.map(
          (child) => ["absolute", "fixed"].includes(child.positioning.mode) ? child : flow[index++]
        );
      } else for (const child of node.children) restore(child);
    };
    if (result) restore(result);
    return result;
  }

  // third-party/html2figma/integration/svg.ts
  var SVG_NS = "http://www.w3.org/2000/svg";
  var XLINK_NS = "http://www.w3.org/1999/xlink";
  var XMLNS_NS = "http://www.w3.org/2000/xmlns/";
  var MAX_ELEMENTS = 2e3;
  var MAX_REFERENCES = 256;
  var MAX_DEPTH = 32;
  var MAX_BYTES = 1024 * 1024;
  var allowed = new Set(
    "svg g path rect circle ellipse line polyline polygon defs clipPath mask linearGradient radialGradient stop pattern text tspan title desc metadata filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feMorphology feTurbulence feDisplacementMap use symbol".toLowerCase().split(" ")
  );
  var fragment = /^#([a-z0-9_.:-]+)$/iu;
  function captureStandaloneSvg(source) {
    const ownerDocument = source.ownerDocument;
    const view = ownerDocument.defaultView;
    if (!view || source.namespaceURI !== SVG_NS || source.localName !== "svg")
      throw Error("SVG \u6355\u83B7\u9700\u8981\u6D3B\u52A8\u6587\u6863\u5185\u7684 SVG \u6839\u8282\u70B9");
    const clones = /* @__PURE__ */ new Map();
    const ids = /* @__PURE__ */ new Map();
    const completed = /* @__PURE__ */ new Set();
    const active = /* @__PURE__ */ new Set();
    let elementCount = 0;
    let referenceCount = 0;
    let bytes = 0;
    const account = (value) => {
      bytes += new TextEncoder().encode(value).length;
      if (bytes > MAX_BYTES) throw Error("\u72EC\u7ACB SVG \u8D85\u8FC7 1 MiB \u4E0A\u9650");
    };
    const reference = (value) => {
      const match = fragment.exec(value.trim());
      if (!match) throw Error("SVG \u5F15\u7528\u5FC5\u987B\u662F\u540C\u4E00\u6587\u6863\u5185\u7684 #id\uFF0C\u4E0D\u80FD\u52A0\u8F7D\u5916\u90E8\u8D44\u6E90");
      return match[1];
    };
    const references = (element) => {
      const ids2 = [];
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on") || name === "src" || name === "xml:base")
          throw Error(`SVG \u4E0D\u5141\u8BB8 ${attribute.name} \u5C5E\u6027`);
        if (name === "href" || name === "xlink:href") ids2.push(reference(attribute.value));
        for (const url of attribute.value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/giu))
          ids2.push(reference(url[1] ?? url[2] ?? url[3]));
        if (/\\|@import|(?:javascript|vbscript|data|file)\s*:/iu.test(attribute.value))
          throw Error("SVG \u4E0D\u5141\u8BB8\u6D3B\u52A8\u6837\u5F0F\u6216\u5916\u90E8\u8D44\u6E90");
      }
      if (element.localName === "use" && !element.hasAttribute("href") && !element.hasAttributeNS(XLINK_NS, "href"))
        throw Error("SVG use \u7F3A\u5C11\u540C\u4E00\u6587\u6863\u5185\u7684 #id \u5F15\u7528");
      return ids2;
    };
    const cloneTree = (original, depth = 0) => {
      const existing = clones.get(original);
      if (existing) return existing;
      if (depth > MAX_DEPTH || ++elementCount > MAX_ELEMENTS)
        throw Error("\u72EC\u7ACB SVG \u6700\u591A 2000 \u4E2A\u5143\u7D20\u53CA 32 \u5C42\u5D4C\u5957");
      if (original.namespaceURI !== SVG_NS || !allowed.has(original.localName.toLowerCase()))
        throw Error(`SVG \u4E0D\u5141\u8BB8 ${original.localName} \u5143\u7D20`);
      references(original);
      const id = original.getAttribute("id");
      if (id && ids.has(id) && ids.get(id) !== original) throw Error(`SVG ID \u91CD\u590D\uFF1A${id}`);
      if (id) ids.set(id, original);
      const clone = original.cloneNode(false);
      clones.set(original, clone);
      account(original.localName);
      for (const attribute of [...original.attributes]) account(attribute.name + attribute.value);
      for (const child of [...original.childNodes]) {
        if (child.nodeType === 1) clone.append(cloneTree(child, depth + 1));
        else if (child.nodeType === 3) {
          account(child.textContent ?? "");
          clone.append(child.cloneNode(false));
        }
      }
      return clone;
    };
    const root = cloneTree(source);
    root.setAttributeNS(XMLNS_NS, "xmlns", SVG_NS);
    root.setAttributeNS(XMLNS_NS, "xmlns:xlink", XLINK_NS);
    const defs = ownerDocument.createElementNS(SVG_NS, "defs");
    const attachDefinitions = () => {
      if (!defs.childNodes.length || defs.parentNode) return;
      if (++elementCount > MAX_ELEMENTS) throw Error("\u72EC\u7ACB SVG \u6700\u591A 2000 \u4E2A\u5143\u7D20");
      root.prepend(defs);
    };
    const resolve = (id, depth) => {
      if (active.has(id)) throw Error(`SVG \u5F15\u7528\u5305\u542B\u5FAA\u73AF\uFF1A#${id}`);
      if (completed.has(id)) return;
      if (depth > MAX_DEPTH || ++referenceCount > MAX_REFERENCES)
        throw Error("\u72EC\u7ACB SVG \u6700\u591A 256 \u9879\u5F15\u7528\u53CA 32 \u5C42\u5F15\u7528\u94FE");
      const original = ownerDocument.getElementById(id);
      if (!original) throw Error(`SVG \u7F3A\u5C11\u540C\u4E00\u6587\u6863\u5185\u7684\u5F15\u7528\uFF1A#${id}`);
      active.add(id);
      if (!clones.has(original)) defs.append(cloneTree(original));
      inspect(original, depth);
      active.delete(id);
      completed.add(id);
    };
    const inspect = (original, depth) => {
      for (const id of references(original)) resolve(id, depth + 1);
      for (const child of [...original.children]) inspect(child, depth);
    };
    inspect(source, 0);
    attachDefinitions();
    const properties = [
      "color",
      "fill",
      "fill-opacity",
      "fill-rule",
      "stroke",
      "stroke-opacity",
      "stroke-width",
      "stroke-linecap",
      "stroke-linejoin",
      "stroke-miterlimit",
      "stroke-dasharray",
      "stroke-dashoffset",
      "clip-rule",
      "clip-path",
      "mask"
    ];
    const freeze = (original, insideDefinition) => {
      const definition = insideDefinition || ["defs", "symbol"].includes(original.localName);
      if (!definition) {
        const clone = clones.get(original);
        const computed = view.getComputedStyle(original);
        for (const property of properties) {
          const value = computed.getPropertyValue(property);
          if (!value) continue;
          clone.style.removeProperty(property);
          clone.setAttribute(property, value);
        }
        references(clone);
      }
      for (const child of [...original.children]) freeze(child, definition);
    };
    freeze(source, false);
    for (const clone of [...clones.values()]) for (const id of references(clone)) resolve(id, 0);
    attachDefinitions();
    for (const [original, clone] of clones) {
      clone.style.removeProperty("opacity");
      if (original === source) clone.removeAttribute("opacity");
      else clone.setAttribute("opacity", view.getComputedStyle(original).opacity);
    }
    const serialized = new realm.XMLSerializer().serializeToString(root);
    if (new TextEncoder().encode(serialized).length > MAX_BYTES)
      throw Error("\u72EC\u7ACB SVG \u8D85\u8FC7 1 MiB \u4E0A\u9650");
    return serialized;
  }

  // third-party/html2figma/integration/entry.ts
  function captureLayoutValues(tree) {
    const values = /* @__PURE__ */ new Map();
    const visit = (node) => {
      if (node.nodeType === "element" && node.metadata?.semantic) {
        try {
          const style = node.domNode.computedStyleMap?.();
          if (style) {
            const properties = [
              "width",
              "border-collapse",
              "border-image-source",
              "height",
              "min-width",
              "max-width",
              "min-height",
              "max-height",
              "flex-basis",
              "margin-top",
              "margin-right",
              "margin-bottom",
              "margin-left",
              "grid-template-columns",
              "grid-template-rows",
              "grid-template-areas",
              "grid-auto-columns",
              "grid-auto-rows",
              "grid-auto-flow",
              "grid-column-start",
              "grid-column-end",
              "grid-row-start",
              "grid-row-end",
              "justify-items",
              "align-items",
              "justify-self",
              "align-self",
              "justify-content",
              "align-content",
              "writing-mode",
              "direction",
              "order",
              "z-index",
              "aspect-ratio",
              "row-gap",
              "column-gap",
              "box-sizing",
              "display",
              "position",
              "top",
              "right",
              "bottom",
              "left",
              "float",
              "shape-outside",
              "clear",
              "column-count"
            ];
            const record = {};
            for (const property of properties) {
              const value = style.get(property)?.toString();
              if (value) record[property] = value;
            }
            values.set(node.metadata.semantic, record);
          }
        } catch {
        }
        if (["grid", "inline-grid"].includes(node.computedStyle?.display ?? "") && !values.get(node.metadata.semantic)?.["grid-template-columns"])
          values.set(node.metadata.semantic, { "--codeshell-grid-intent": "unavailable" });
      }
      for (const child of node.children) visit(child);
    };
    visit(tree);
    return values;
  }
  function convert(root, options) {
    const tree = traverseDOM(root, { maxDepth: options.maxDepth });
    if (!tree) return null;
    const values = captureLayoutValues(tree);
    const svgResources = /* @__PURE__ */ new Map();
    const backgrounds = /* @__PURE__ */ new Map();
    const gridSources = /* @__PURE__ */ new Set();
    const corners = /* @__PURE__ */ new Map();
    const textIntents = /* @__PURE__ */ new Map();
    const captureSvg = (node) => {
      if (node.nodeType === "element" && node.metadata?.semantic && node.domNode instanceof realm.Element && !node.metadata.isPseudoElement && !node.metadata.isFormContent)
        options.onElement?.(node.metadata.semantic.semanticId ?? "", node.domNode);
      if (node.metadata?.semantic && ["grid", "inline-grid"].includes(node.computedStyle?.display ?? ""))
        gridSources.add(node.metadata.semantic);
      if (node.tag === "svg" && node.metadata?.semantic && node.domNode instanceof realm.Element)
        svgResources.set(node.metadata.semantic, captureStandaloneSvg(node.domNode));
      if (node.nodeType === "element" && node.metadata?.semantic && node.computedStyle)
        corners.set(node.metadata.semantic, ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"].map((property) => node.computedStyle.getPropertyValue(property)));
      if (node.nodeType === "element" && node.metadata?.semantic && node.computedStyle && node.domNode instanceof realm.Element && (node.domNode.childElementCount === 0 && ["nowrap", "pre"].includes(node.computedStyle.whiteSpace) || node.computedStyle.textOverflow !== "clip")) {
        const style = node.computedStyle;
        textIntents.set(node.metadata.semantic, {
          rawSource: node.domNode.textContent ?? "",
          whiteSpace: style.whiteSpace,
          childElements: String(node.domNode.childElementCount),
          generatedContent: String(Boolean(node.metadata.listMarker || node.children.some((child) => child.metadata?.isPseudoElement || child.metadata?.isFormContent))),
          textOverflow: style.textOverflow,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          writingMode: style.writingMode,
          direction: style.direction,
          lineHeight: style.lineHeight,
          textIndent: style.textIndent,
          wordSpacing: style.wordSpacing,
          textTransform: style.textTransform
        });
      }
      if (node.nodeType === "element" && node.metadata?.semantic && node.computedStyle?.getPropertyValue("background-image").includes("gradient(")) {
        const background = {};
        for (const property of [
          "background-image",
          "background-color",
          "background-size",
          "background-position",
          "background-repeat",
          "background-origin",
          "background-clip",
          "background-blend-mode",
          "background-attachment",
          "border-top-width",
          "border-right-width",
          "border-bottom-width",
          "border-left-width"
        ]) background[property] = node.computedStyle.getPropertyValue(property);
        backgrounds.set(node.metadata.semantic, background);
      }
      for (const child of node.children) captureSvg(child);
    };
    captureSvg(tree);
    const result = options.preserveGrid ? renderPreservingGrid(tree, options) : renderToDesignDSL(tree, options);
    const attach = (node) => {
      const cssLayout = node.nodeType !== "text" && node.semantic && values.get(node.semantic);
      if (cssLayout && Object.keys(cssLayout).length > 0) node.cssLayout = cssLayout;
      if (!options.preserveGrid && node.nodeType === "container" && node.semantic && gridSources.has(node.semantic))
        node.cssLayout = { ...node.cssLayout, "--codeshell-grid-legacy": "synthetic" };
      if (node.nodeType === "container" && node.semantic && textIntents.has(node.semantic))
        node.cssText = textIntents.get(node.semantic);
      if (node.nodeType !== "text" && node.semantic && corners.has(node.semantic))
        node.cssBorderRadii = corners.get(node.semantic);
      if (node.nodeType !== "text" && node.semantic && backgrounds.has(node.semantic))
        node.cssBackground = backgrounds.get(node.semantic);
      if (node.nodeType === "svg" && node.semantic && svgResources.has(node.semantic))
        node.svgContent = svgResources.get(node.semantic);
      if (node.nodeType === "container") for (const child of node.children) attach(child);
    };
    if (result) attach(result);
    return result;
  }
  return __toCommonJS(entry_exports);
})();

return html2figmaCore;
}

export const HTML2FIGMA_PROVENANCE = Object.freeze({"engine":"html2figma","upstreamCommit":"ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c","sourceTreeSha256":"d633595f846eb0b645988568914f269a0d19743d09348ad02a0275f0eb6d48f2","integrationVersion":2,"gridCaptureDefault":"original-items","legacyGridOption":"preserveGrid:false"});

export function convertToDesignDSL(root, options = {}) {
  const realm = root?.ownerDocument?.defaultView;
  if (!realm || !(root instanceof realm.Element) || root.ownerDocument !== realm.document)
    throw new TypeError("html2figma requires an Element with its own live document realm");
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("html2figma options must be an object");
  const maxDepth = options.maxDepth ?? 100;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 100)
    throw new RangeError("html2figma maxDepth must be an integer from 0 to 100");
  if (options.preserveGrid !== undefined && typeof options.preserveGrid !== "boolean")
    throw new TypeError("html2figma preserveGrid must be a boolean");
  if (options.onElement !== undefined && typeof options.onElement !== "function")
    throw new TypeError("html2figma onElement must be a function");
  const runtime = createRuntime(realm);
  return runtime.convert(root, { includeRawStyles: options.includeRawStyles !== false, maxDepth, preserveGrid: options.preserveGrid !== false, onElement: options.onElement });
}
