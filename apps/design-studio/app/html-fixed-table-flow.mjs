import { normalizeDesignDocument } from "./document.mjs";
import { nativeGridPlan, gridFillHugContentHeight } from "./grid.mjs";
import { parseCssColor } from "./html-capture.mjs";
import { createBrowserTextMeasurer, measureFigmaTextDocument } from "./text-metrics.mjs";
import { textLineHeightPixels } from "./text-line-height.mjs";

const sides = ["Top", "Right", "Bottom", "Left"];
const collapsed = (value) => value.replace(/[\t\n\f\r ]+/gu, " ").replace(/^ | $/gu, "");
const pixel = (value) => typeof value === "string" && /^\d+(?:\.\d+)?px$/u.test(value) ? Number.parseFloat(value) : NaN;
const bounded = (value, maximum = 2000) => Number.isFinite(value) && value >= 0 && value <= maximum;
const assert = (condition, message) => { if (!condition) throw Error(message); };
const round = (value) => Math.round(value * 100) / 100;
const styleKeys = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "wordSpacing", "textTransform", "color", "textDecorationLine", "textShadow"];

function indexDocument(value) {
  const nodes = new Map(), parents = new WeakMap();
  const visit = (node, parent) => {
    nodes.set(node.id, node); parents.set(node, parent);
    node.children?.forEach((child) => visit(child, node));
  };
  value.pages.forEach((page) => page.children.forEach((node) => visit(node, null)));
  return { nodes, parentOf: (node) => parents.get(node) };
}

function plainBox(element, browserDocument, { transparent = true } = {}) {
  const view = browserDocument.defaultView, style = view.getComputedStyle(element);
  assert(style.visibility === "visible" && style.opacity === "1" &&
    ["static", "relative"].includes(style.position) &&
    (style.position !== "relative" || ["top", "right", "bottom", "left"].every((key) => style[key] === "auto")) &&
    style.direction === "ltr" && style.writingMode === "horizontal-tb" &&
    style.transform === "none" && ["", "1", "normal"].includes(style.getPropertyValue("zoom")) &&
    ["rotate", "scale", "translate"].every((key) => ["", "none"].includes(style.getPropertyValue(key))) &&
    style.float === "none" && style.clear === "none" && style.columnCount === "auto" && style.columnWidth === "auto" &&
    style.contain === "none" && style.contentVisibility === "visible" &&
    style.filter === "none" && ["", "none"].includes(style.backdropFilter) &&
    style.clipPath === "none" && style.maskImage === "none" &&
    style.boxShadow === "none" && style.mixBlendMode === "normal" &&
    style.borderImageSource === "none" && style.outlineStyle === "none" &&
    style.overflowX === "visible" && style.overflowY === "visible",
  "定位、变换、隐藏、分栏、裁剪或表面效果不在固定两列表格的有界范围内");
  assert(["::before", "::after"].every((pseudo) => ["none", "normal"].includes(view.getComputedStyle(element, pseudo).content)), "生成内容不能当作普通表格单元恢复");
  if (transparent) assert(parseCssColor(style.backgroundColor)?.alpha === 0 && style.backgroundImage === "none", "不透明/图片单元会覆盖原生父层居中描边；保留测量表格");
  return style;
}

function noBorders(style) {
  return sides.every((side) => style[`border${side}Style`] !== "hidden" && pixel(style[`border${side}Width`]) === 0);
}

function unconstrainedBox(element) {
  const styles = element.computedStyleMap?.();
  const value = (key) => styles?.get(key)?.toString();
  return ["min-width", "min-height"].every((key) => ["auto", "0px"].includes(value(key))) &&
    ["max-width", "max-height"].every((key) => value(key) === "none") &&
    value("height") === "auto" && value("aspect-ratio") === "auto";
}

const noAnonymousContent = (element) => [...element.childNodes].every((node) =>
  node.nodeType === 1 || node.nodeType === 8 || node.nodeType === 3 && !collapsed(node.nodeValue));

function typography(element, text, browserDocument) {
  const view = browserDocument.defaultView, style = plainBox(element, browserDocument);
  const font = style.fontFamily.split(",")[0].trim().replace(/^["']|["']$/gu, "");
  assert(style.whiteSpace === "normal" && style.textTransform === "none" &&
    ["normal", "0px"].includes(style.wordSpacing) && style.textIndent === "0px" &&
    ["left", "start"].includes(style.textAlign) && style.textDecorationLine === "none" &&
    style.textShadow === "none" && style.textOverflow === "clip" &&
    ["normal", "0px"].includes(style.letterSpacing) &&
    font === text.fontFamily && Number.parseFloat(style.fontSize) === text.fontSize &&
    Number(style.fontWeight) === text.fontWeight && style.fontStyle === text.fontStyle,
  "单元格文字必须是同一已捕获普通样式，不支持混合、缩进、截断或特殊字距");
  assert(["::first-line", "::first-letter"].every((pseudo) => {
    const variant = view.getComputedStyle(element, pseudo);
    return styleKeys.every((key) => variant[key] === style[key]);
  }), "首行/首字样式不能恢复为单一文字");
  let line;
  try { line = element.computedStyleMap?.().get("line-height"); } catch {}
  assert(line?.unit === "number" && Number.isFinite(line.value) && line.value >= 0.7 && line.value <= 3,
    "表格文字需要当前实际 Element 的有界 CSS number 行高证据");
  return { style, ratio: line.value };
}

function textContent(element, browserDocument) {
  const segments = [""];
  for (const node of element.childNodes) {
    if (node.nodeType === 3) segments[segments.length - 1] += node.nodeValue;
    else if (node.nodeType === 8) continue;
    else {
      assert(node.nodeType === 1 && node.tagName === "BR" && !node.childNodes.length,
        "表格单元只支持普通文本、内部 BR 或已验证的普通 P 层级");
      const style = plainBox(node, browserDocument), parentStyle = browserDocument.defaultView.getComputedStyle(element);
      assert(style.display === "inline" && styleKeys.every((key) => style[key] === parentStyle[key]), "BR 的隐藏/特殊样式未验证");
      segments.push("");
    }
  }
  const normalized = segments.map(collapsed);
  assert(normalized.every((segment) => segment && /[^\t\n\f\r ]/u.test(segment)), "空单元、首尾或连续 BR 的空行行为未验证");
  const source = normalized.join("\n"), raw = segments.join("");
  assert(source.length <= 4000 && raw.length <= 4000, "表格文字超出 4,000 字符边界");
  return { source, raw, segments, brCount: segments.length - 1 };
}

/** A current-capture stage; no serialized flag can activate this promotion. */
export async function promoteHtmlFixedTables(documentValue, {
  browserDocument, elements, sourceTree, canonicalBySource, warn,
}) {
  const sources = [];
  const collect = (source) => {
    if (source.nodeType === "container" && source.cssLayout?.display === "table") sources.push(source);
    source.children?.forEach(collect);
  };
  collect(sourceTree);
  const applied = [];
  for (const source of sources.slice(0, 32)) {
    const original = canonicalBySource.get(source);
    if (!original) {
      warn("html-table-flow-fixed", null, "固定表格缺少当前捕获的一一对应原始节点所有权；保留测量布局，未从字符串 ID 或选择器猜测绑定。");
      continue;
    }
    try {
      const element = elements.get(source.semantic?.semanticId);
      assert(element?.ownerDocument === browserDocument, "表格没有唯一的当前真实 Element 绑定");
      const tableStyle = plainBox(element, browserDocument);
      assert(source.cssLayout["table-layout"] === "fixed" && tableStyle.tableLayout === "fixed" &&
        source.cssLayout["border-collapse"] === "collapse" && tableStyle.borderCollapse === "collapse" &&
        tableStyle.whiteSpace === "normal" &&
        ["0px", "0px 0px"].includes(source.cssLayout["border-spacing"]) &&
        unconstrainedBox(element) && noBorders(tableStyle) && sides.every((side) => pixel(tableStyle[`padding${side}`]) === 0),
      "仅恢复无外框/内缩、零间距的 fixed/collapse 两列表格");
      assert((source.cssLayout.width === "100%" && original.layoutSizingHorizontal === "fill") ||
        (Number.isFinite(pixel(source.cssLayout.width)) && original.layoutSizingHorizontal === "fixed"),
      "表格宽度必须由实际 Fill 关系或显式像素宽度解析，不能用测量宽度冒充声明");
      assert(original.layoutPositioning !== "absolute", "原始普通表格尚无真实父层流关系，不能只恢复内部行而声明完整 Auto Layout");
      for (let ancestor = element.parentElement, depth = 0; ancestor; ancestor = ancestor.parentElement, depth++) {
        assert(depth < 32, "表格祖先超过深度边界");
        const style = browserDocument.defaultView.getComputedStyle(ancestor);
        assert(style.transform === "none" && ["", "normal", "1"].includes(style.getPropertyValue("zoom")) &&
          ["rotate", "scale", "translate"].every((key) => ["", "none"].includes(style.getPropertyValue(key))), "变换或 zoom 祖先无法保持表格的物理尺寸");
      }
      const rows = [...element.children];
      assert(noAnonymousContent(element) && rows.length >= 1 && rows.length <= 64 && source.children?.length === rows.length, "表格需要 1–64 个直接且一致的真实行；匿名内容、分组/额外层级未验证");
      const draftDocument = structuredClone(documentValue), draftIndex = indexDocument(draftDocument), originalIndex = indexDocument(documentValue);
      const table = draftIndex.nodes.get(original.id), texts = [], rowsDraft = [], recovered = [];
      Object.assign(table, { layout: "vertical", layoutSizingVertical: "hug", layoutWrap: "none", gap: 0, rowGap: 0, columnGap: 0, padding: 0, paddingTop: 0, paddingLeft: 0, paddingRight: 0, alignItems: "start", justifyContent: "start" });
      let ruleColor;
      for (let index = 0; index < rows.length; index++) {
        const rowElement = rows[index], rowSource = source.children[index], rowOriginal = canonicalBySource.get(rowSource);
        assert(rowOriginal && rowSource.semantic?.semanticId && elements.get(rowSource.semantic.semanticId) === rowElement &&
          originalIndex.parentOf(rowOriginal) === original, "真实行及其原始父层级必须一一对应");
        const rowStyle = plainBox(rowElement, browserDocument);
        assert(rowStyle.display === "table-row" && rowSource.cssLayout?.display === "table-row" &&
          rowStyle.whiteSpace === "normal" &&
          unconstrainedBox(rowElement) &&
          sides.every((side) => pixel(rowStyle[`padding${side}`]) === 0) &&
          ["Top", "Right", "Left"].every((side) => rowStyle[`border${side}Style`] !== "hidden" && pixel(rowStyle[`border${side}Width`]) === 0), "行分组、边框或内缩不在当前共享边缘模型内");
        const rule = pixel(rowStyle.borderBottomWidth), color = parseCssColor(rowStyle.borderBottomColor);
        assert((rule === 1 && rowStyle.borderBottomStyle === "solid" && color?.alpha === 1) ||
          (rule === 0 && index === rows.length - 1 && rowStyle.borderBottomStyle !== "hidden"), "仅验证统一不冲突的 bottom1 规则，最后一行可无规则");
        if (rule) { assert(!ruleColor || ruleColor === color.hex, "行规则必须使用同一不透明颜色"); ruleColor = color.hex; }
        const row = draftIndex.nodes.get(rowOriginal.id);
        assert(row.width > 40 && row.width <= 20000, "共享仿射轨道需要大于固定轨道总长 40 的有界真实行宽");
        Object.assign(row, { layout: "grid", layoutSizingHorizontal: "fill", layoutSizingVertical: "hug", layoutWrap: "none", gap: 0, rowGap: 0, columnGap: 0, padding: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, alignItems: "start", justifyContent: "start", alignContent: "start", gridColumns: 4, gridRows: 1, gridColumnSizes: [{ type: "flex", value: 0.3 }, { type: "fixed", value: 32 }, { type: "flex", value: 0.7 }, { type: "fixed", value: 8 }], gridRowSizes: [{ type: "hug" }], gridItemsPositioning: "manual", gridAutoTracks: "none" });
        delete row.layoutPositioning;
        delete row.strokeLayoutExcluded;
        if (rule) Object.assign(row, { stroke: color.hex, strokeWidth: 1, strokeAlign: "center", strokeSides: [0, 0, 1, 0].map((width) => ({ width, color: color.hex, opacity: 1 })) });
        rowsDraft.push({ node: row, rule });
        recovered.push({ code: "block-flow-fixed", nodeId: row.id });
        const cells = [...rowElement.children];
        assert(noAnonymousContent(rowElement) && cells.length === 2 && rowSource.children?.length === 2 && row.children?.length === 2, "仅验证 30%+右20 的第一列与 auto 第二列，不能从测量比例拟合其他列数");
        for (let column = 0; column < 2; column++) {
          const cellElement = cells[column], cellSource = rowSource.children[column], cellOriginal = canonicalBySource.get(cellSource);
          assert(cellOriginal && originalIndex.parentOf(cellOriginal) === rowOriginal && elements.get(cellSource.semantic?.semanticId) === cellElement &&
            !["colspan", "rowspan"].some((key) => ![null, "1"].includes(cellElement.getAttribute(key))), "单元格身份、父层级或跨度未验证");
          const style = plainBox(cellElement, browserDocument);
          assert(style.display === "table-cell" && cellSource.cssLayout?.display === "table-cell" && style.verticalAlign === "top" &&
            cellSource.cssLayout.width === (column === 0 ? "30%" : "auto") && style.boxSizing === "content-box" && noBorders(style) &&
            sides.every((side) => pixel(style[`padding${side}`]) === (side === "Right" ? column === 0 ? 20 : 0 : ["Top", "Bottom"].includes(side) ? 10 : 0)) &&
            ["min-width", "min-height"].every((key) => ["auto", "0px"].includes(cellSource.cssLayout[key])) &&
            ["max-width", "max-height"].every((key) => cellSource.cssLayout[key] === "none") && unconstrainedBox(cellElement),
          "单元格需要一致的 content-box 30%/auto、T/B10、第一列右20，且没有约束/竞争边框");
          const cell = draftIndex.nodes.get(cellOriginal.id), top = index === 0 ? 10 : 10.5, bottom = rule ? 10.5 : 10;
          Object.assign(cell, { layout: "vertical", layoutSizingHorizontal: "fill", layoutSizingVertical: "fill", layoutWrap: "none", gap: 0, rowGap: 0, columnGap: 0, padding: 0, paddingTop: top, paddingRight: column === 0 ? 20 : 0, paddingBottom: bottom, paddingLeft: 0, alignItems: "start", justifyContent: "start", gridRowAnchorIndex: 0, gridColumnAnchorIndex: column * 2, gridRowSpan: 1, gridColumnSpan: 2, gridChildHorizontalAlign: "auto", gridChildVerticalAlign: "auto" });
          delete cell.layoutPositioning;
          if ([...cellElement.children].every((child) => child.tagName === "BR")) {
            assert(cell.children?.length === 1 && cell.children[0].type === "text", "普通/BR 单元必须保留唯一原始 Text 节点");
            const text = cell.children[0], content = textContent(cellElement, browserDocument), proof = typography(cellElement, text, browserDocument);
            const logicalTop = cell.y + top, baseline = text.y - logicalTop;
            assert(Number.isFinite(baseline) && Math.abs(baseline) <= 100, "文字行框原点超出有界范围");
            Object.assign(text, { text: content.source, textSource: content.source, textFlow: "wrap", textFlowWidth: cell.width - cell.paddingLeft - cell.paddingRight, width: cell.width - cell.paddingLeft - cell.paddingRight, lineHeight: proof.ratio, layoutSizingHorizontal: "fill", layoutSizingVertical: "hug", layoutAlignSelf: "start", layoutBaselineOffset: round(baseline) });
            delete text.layoutPositioning;
            delete text.lineHeightUnit;
            delete text.textMetrics;
            if (content.source !== content.raw || content.brCount) {
              let notes = {}; try { notes = JSON.parse(text.notes ?? "{}"); } catch {}
              const originalText = { whiteSpace: "normal", rawSource: content.raw, ...(content.brCount ? { brSegments: content.segments } : {}) };
              const receipt = JSON.stringify({ ...notes, htmlTextOriginal: originalText });
              assert(receipt.length <= 2000, "原始字符/BR 收据超过备注预算"); text.notes = receipt;
            }
            texts.push(text);
            recovered.push({ code: "html-plain-text-fixed", nodeId: cell.id });
            if (content.brCount) recovered.push({ code: "rich-text-uniform", nodeId: text.id });
          } else {
            assert([...cellElement.children].length <= 16 && [...cellElement.children].every((child) => child.tagName === "P") &&
              [...cellElement.childNodes].every((child) => child.nodeType === 1 || child.nodeType === 8 || child.nodeType === 3 && !collapsed(child.nodeValue)), "复杂行内或非普通 P 内容未验证");
            assert(cellSource.children?.length === cellElement.children.length && cell.children?.length === cellElement.children.length,
              "每个真实 P 必须对应原始单元中的唯一普通块或合成外距包装框");
            for (const [paragraphIndex, paragraph] of [...cellElement.children].entries()) {
              let paragraphSource = cellSource.children[paragraphIndex];
              const originalChild = cellOriginal.children[paragraphIndex];
              assert(canonicalBySource.get(paragraphSource) === originalChild, "P 普通流节点没有当前捕获所有权");
              if (!paragraphSource.semantic) {
                assert(paragraphSource.name === "margin-wrapper" && paragraphSource.children?.length === 1 && originalChild.children?.length === 1,
                  "P 的额外层级必须是唯一内容的无语义外距包装框");
                paragraphSource = paragraphSource.children[0];
              }
              const paragraphNode = canonicalBySource.get(paragraphSource);
              assert(elements.get(paragraphSource.semantic?.semanticId) === paragraph && paragraphNode?.children?.length === 1 &&
                paragraphNode.children[0].type === "text", "真实 P 与其原始唯一 Text 必须保持一一对应");
              const paragraphStyle = plainBox(paragraph, browserDocument);
              assert(paragraphStyle.display === "block" && paragraph.childElementCount === 0 && noBorders(paragraphStyle) &&
                unconstrainedBox(paragraph) &&
                sides.every((side) => bounded(pixel(paragraphStyle[`margin${side}`]))) &&
                ["Top", "Right", "Left"].every((side) => pixel(paragraphStyle[`margin${side}`]) === 0), "P 需要已验证的普通块流、固定非负下外距和纯文字");
              const content = textContent(paragraph, browserDocument);
              typography(paragraph, paragraphNode.children[0], browserDocument);
              assert(paragraphNode.children[0].textSource === content.source,
                "P 需已通过普通文本恢复，不能使用合成 NBSP 或失效的显示文本");
              assert(paragraphNode.children[0].textMetrics?.fontAvailable === true &&
                paragraphNode.children[0].layoutBaselineSource === "html", "P 的字体/浏览器行框需已通过当前普通流测量证明");
            }
            const first = cell.children?.[0], firstSource = cellSource.children?.[0];
            if (firstSource?.name === "margin-wrapper" && !firstSource.semantic) {
              assert(canonicalBySource.get(firstSource) === cellOriginal.children?.[0] &&
                first?.name === "margin-wrapper" && first.type === "frame" && first.layout === "vertical" &&
                firstSource.children?.length === 1 && first.children?.length === 1 &&
                canonicalBySource.get(firstSource.children[0]) === cellOriginal.children[0].children[0] &&
                elements.get(firstSource.children[0].semantic?.semanticId) === cellElement.children[0] &&
                first.fill === "transparent" && first.strokeWidth === 0 && !first.effects?.length &&
                first.opacity === 1 && first.visible !== false && !first.rotation &&
                ["Left", "Right"].every((side) => (first[`padding${side}`] ?? first.padding ?? 0) === 0),
              "合成外距补偿必须保留无表面包装框与唯一真实 P 的当前捕获身份");
              const leading = first.paddingTop ?? first.padding ?? 0;
              assert([0, 1].includes(leading), "未验证的合成首部外距补偿"); cell.paddingTop -= leading;
            }
          }
        }
      }
      table.paddingBottom = rowsDraft.at(-1).rule ? 0.5 : 0;
      await measureFigmaTextDocument({ nodes: texts }, { browserDocument });
      for (const text of texts) {
        assert(text.textMetrics?.fontAvailable === true, "当前表格字体不可用，不能认证普通文字的内在尺寸");
        text.height = round(text.text.split("\n").length * textLineHeightPixels(text));
      }
      const measurement = createBrowserTextMeasurer(browserDocument);
      try {
        for (const text of texts) {
          measurement.configure(text);
          const logicalY = text.y - text.layoutBaselineOffset;
          if (round(logicalY + measurement.lineBoxOffset(text)) === text.y) text.layoutBaselineSource = "html";
          else throw Error("普通单元的初始文字基线不能由当前浏览器行框模型精确复现");
        }
      } finally { measurement.close(); }
      const observations = [];
      for (const { node: row } of rowsDraft) {
        nativeGridPlan(row, draftIndex.parentOf(row), draftIndex.parentOf);
        const intrinsic = Math.max(...row.children.map((cell) => gridFillHugContentHeight(row, cell, cell.children, table, draftIndex.parentOf)));
        assert(round(intrinsic) === row.height, `当前实际行 ${row.id} 高 ${row.height} 与完整文本/P 流内在高度 ${intrinsic} 不同；不修改源几何以冒充支持`);
        const ideal = [0.3 * row.width + 20, 0.7 * row.width - 20];
        observations.push({ rowId: row.id, sourceWidths: row.children.map((cell) => cell.width), idealWidths: ideal, exact: row.children.every((cell, column) => cell.width === ideal[column]) });
      }
      normalizeDesignDocument(draftDocument);
      // All measurement and admission happened on owned drafts. Commit only
      // corresponding node fields, retaining every original object/child array.
      const commit = (node) => {
        const target = originalIndex.nodes.get(node.id), { children, ...fields } = node;
        for (const key of Object.keys(target)) if (key !== "children" && !Object.hasOwn(fields, key)) delete target[key];
        Object.assign(target, fields); children?.forEach(commit);
      };
      commit(table);
      applied.push({ tableId: table.id, rows: rowsDraft.length, observations, recovered });
      warn("html-table-captured-state", table.id, "已按源声明恢复 fixed/collapse 透明两列表格和完整 P 层级；30%+右20 为共享原生正轨道，半边归属写入有效内缩。保留捕获时媒体状态，分数列宽差异需按原始收据核对。");
    } catch (error) {
      warn("html-table-flow-fixed", original.id, `${error.message}；整张表格保留当前测量布局，未部分提升行或文字。`);
    }
  }
  if (sources.length > 32) warn("html-table-flow-fixed", null, "固定表格规划超过每次 32 张的边界，其余保留测量布局。");
  return applied;
}
