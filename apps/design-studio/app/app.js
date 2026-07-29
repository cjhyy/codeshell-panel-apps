/* Design Studio Panel App runtime. */
/* global document, localStorage, requestAnimationFrame, window */

import {
  alignNodeTrees,
  clipBoundsToClippingAncestors,
  clipNodeBoundsToClippingAncestors,
  descendantIds,
  distributeNodeTrees,
  inheritedNodeRotation,
  moveSelectedNodes,
  normalizeNodeTreeOrder,
  pointInNodeTree,
  pointToParentSpace,
  releaseFrame,
  reparentNode,
  rotateVector,
  snapBoundsToNodes,
  setNodeTreePosition,
  snapValue,
  transformedNodeBoundsInTree,
  visualSelectionBounds,
  wrapNodesInFrame,
} from "./geometry.mjs";
import {
  assertDesignDocumentSize,
  designNodeRemovalIds,
  effectiveDesignNodeOpacity,
  externalComponentInstancesForPage,
  exportDesignSvg,
  isSafeDesignPath,
  isDesignNodeVisible,
  MAX_DESIGN_NODES,
  normalizeDesignDocument,
  normalizeDesignState,
  replaceDesignColor,
  replaceDesignColors,
  renderedDesignInstanceEffectOutsets,
  renderedDesignNodeShadowFilterBounds,
  serializeDesignDocument,
  workspaceVersionChanged,
} from "./document.mjs";
import { chooseRepoDesignFile, DEFAULT_DESIGN_PATH } from "./repository.mjs";
import { auditDesignPages, auditMarkdown, summarizeAudit } from "./audit.mjs";
import { captureWorkspaceHtml, isSafeHtmlImportPath } from "./html-import.mjs";
import {
  applyAutoLayouts,
  createComponentInstance,
  isAutoLayoutContainer,
  isContainerNode,
} from "./layout.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_AGENT_SCREENSHOT_BASE64 = 220_000;
const MAX_AGENT_SCREENSHOT_PIXELS = 2_000_000;
const MAX_AGENT_SCREENSHOT_HEIGHT = 4_096;
const MAX_AGENT_SCREENSHOT_RENDER_MS = 5_000;
const MAX_AGENT_AUDIT_ISSUES = 400;
const MAX_DESIGN_PAGES = 20;
const TOOL_SHORTCUTS = {
  v: "select",
  f: "frame",
  r: "rectangle",
  o: "ellipse",
  t: "text",
  h: "hand",
};
const DEFAULT_PATH = DEFAULT_DESIGN_PATH;
const DEFAULT_COLOR_TOKENS = Object.freeze([
  { name: "Ink", value: "#171717" },
  { name: "Paper", value: "#f7f7f3" },
  { name: "Card", value: "#ffffff" },
  { name: "Accent", value: "#b7ff52" },
  { name: "Blue", value: "#315fda" },
]);

const elements = {
  appShell: document.querySelector(".app-shell"),
  stage: document.querySelector("#stage"),
  scene: document.querySelector("#scene"),
  grid: document.querySelector("#grid"),
  stageWrap: document.querySelector("#stage-wrap"),
  workspace: document.querySelector(".workspace"),
  activePage: document.querySelector("#active-page"),
  addPage: document.querySelector("#add-page"),
  managePages: document.querySelector("#manage-pages"),
  pagesDialog: document.querySelector("#pages-dialog"),
  pagesList: document.querySelector("#pages-list"),
  addPageDialog: document.querySelector("#add-page-dialog"),
  path: document.querySelector("#document-path"),
  repoLinkState: document.querySelector("#repo-link-state"),
  saveState: document.querySelector("#save-state"),
  save: document.querySelector("#save"),
  runAudit: document.querySelector("#run-audit"),
  exportSvg: document.querySelector("#export-svg"),
  openFiles: document.querySelector("#open-files"),
  openHtmlImport: document.querySelector("#open-html-import"),
  openShortcuts: document.querySelector("#open-shortcuts"),
  openAi: document.querySelector("#open-ai"),
  toggleInspector: document.querySelector("#toggle-inspector"),
  filesDialog: document.querySelector("#files-dialog"),
  shortcutsDialog: document.querySelector("#shortcuts-dialog"),
  filesList: document.querySelector("#files-list"),
  workspaceSummary: document.querySelector("#workspace-summary"),
  newDocument: document.querySelector("#new-document"),
  repoFilesTab: document.querySelector("#repo-files-tab"),
  repoFilesList: document.querySelector("#repo-files-list"),
  repoFilesSummary: document.querySelector("#repo-files-summary"),
  refreshRepoFiles: document.querySelector("#refresh-repo-files"),
  repoNewDocument: document.querySelector("#repo-new-document"),
  htmlImportDialog: document.querySelector("#html-import-dialog"),
  htmlImportPath: document.querySelector("#html-import-path"),
  htmlImportRoot: document.querySelector("#html-import-root"),
  htmlImportWidth: document.querySelector("#html-import-width"),
  htmlImportHeight: document.querySelector("#html-import-height"),
  htmlImportStatus: document.querySelector("#html-import-status"),
  runHtmlImport: document.querySelector("#run-html-import"),
  aiDialog: document.querySelector("#ai-dialog"),
  auditDialog: document.querySelector("#audit-dialog"),
  auditSummary: document.querySelector("#audit-summary"),
  auditResults: document.querySelector("#audit-results"),
  saveAuditReport: document.querySelector("#save-audit-report"),
  aiRequest: document.querySelector("#ai-request"),
  aiContextState: document.querySelector("#ai-context-state"),
  submitAi: document.querySelector("#submit-ai"),
  zoomOut: document.querySelector("#zoom-out"),
  zoomIn: document.querySelector("#zoom-in"),
  zoomValue: document.querySelector("#zoom-value"),
  toggleGrid: document.querySelector("#toggle-grid"),
  toggleSnap: document.querySelector("#toggle-snap"),
  selectionSize: document.querySelector("#selection-size"),
  noSelection: document.querySelector("#no-selection"),
  multiSelection: document.querySelector("#multi-selection"),
  multiSelectionCount: document.querySelector("#multi-selection-count"),
  canvasProperties: document.querySelector("#canvas-properties"),
  selectionProperties: document.querySelector("#selection-properties"),
  parentField: document.querySelector("#prop-parent-field"),
  frameSection: document.querySelector("#frame-section"),
  containerSectionLabel: document.querySelector("#container-section-label"),
  clipContentField: document.querySelector("#clip-content-field"),
  clipContentLabel: document.querySelector("#clip-content-label"),
  releaseContainerLabel: document.querySelector("#release-container-label"),
  layoutSection: document.querySelector("#layout-section"),
  containerLayoutControls: document.querySelector("#container-layout-controls"),
  childLayoutControls: document.querySelector("#child-layout-controls"),
  componentSection: document.querySelector("#component-section"),
  componentStatus: document.querySelector("#component-status"),
  paintControls: document.querySelector("#paint-controls"),
  paintlessLayerHint: document.querySelector("#paintless-layer-hint"),
  radiusField: document.querySelector("#radius-field"),
  textSection: document.querySelector("#text-section"),
  shadowSection: document.querySelector("#shadow-section"),
  shadowControls: document.querySelector("#shadow-controls"),
  colorTokens: document.querySelector("#color-tokens"),
  addColorToken: document.querySelector("#add-color-token"),
  layersList: document.querySelector("#layers-list"),
  layerFilter: document.querySelector("#layer-filter"),
  duplicateLayer: document.querySelector("#duplicate-layer"),
  makeComponent: document.querySelector("#make-component"),
  createInstance: document.querySelector("#create-instance"),
  frameSelection: document.querySelector("#frame-selection"),
  groupSelection: document.querySelector("#group-selection"),
  releaseFrame: document.querySelector("#release-frame"),
  toggleLock: document.querySelector("#toggle-lock"),
  toggleVisible: document.querySelector("#toggle-visible"),
  toast: document.querySelector("#toast"),
};

const propertyInputs = {
  name: document.querySelector("#prop-name"),
  x: document.querySelector("#prop-x"),
  y: document.querySelector("#prop-y"),
  width: document.querySelector("#prop-width"),
  height: document.querySelector("#prop-height"),
  text: document.querySelector("#prop-text"),
  fontSize: document.querySelector("#prop-font-size"),
  fontWeight: document.querySelector("#prop-font-weight"),
  fontFamily: document.querySelector("#prop-font-family"),
  fontStyle: document.querySelector("#prop-font-style"),
  lineHeight: document.querySelector("#prop-line-height"),
  letterSpacing: document.querySelector("#prop-letter-spacing"),
  textDecoration: document.querySelector("#prop-text-decoration"),
  textAlign: document.querySelector("#prop-text-align"),
  fill: document.querySelector("#prop-fill"),
  fillColor: document.querySelector("#prop-fill-color"),
  stroke: document.querySelector("#prop-stroke"),
  strokeColor: document.querySelector("#prop-stroke-color"),
  strokeWidth: document.querySelector("#prop-stroke-width"),
  cornerRadius: document.querySelector("#prop-radius"),
  opacity: document.querySelector("#prop-opacity"),
  rotation: document.querySelector("#prop-rotation"),
  parent: document.querySelector("#prop-parent"),
  notes: document.querySelector("#prop-notes"),
  clipContent: document.querySelector("#prop-clip-content"),
  layout: document.querySelector("#prop-layout"),
  layoutWrap: document.querySelector("#prop-layout-wrap"),
  gap: document.querySelector("#prop-layout-gap"),
  rowGap: document.querySelector("#prop-layout-row-gap"),
  columnGap: document.querySelector("#prop-layout-column-gap"),
  padding: document.querySelector("#prop-layout-padding"),
  paddingTop: document.querySelector("#prop-layout-padding-top"),
  paddingRight: document.querySelector("#prop-layout-padding-right"),
  paddingBottom: document.querySelector("#prop-layout-padding-bottom"),
  paddingLeft: document.querySelector("#prop-layout-padding-left"),
  alignItems: document.querySelector("#prop-align-items"),
  justifyContent: document.querySelector("#prop-justify-content"),
  alignContent: document.querySelector("#prop-align-content"),
  gridColumns: document.querySelector("#prop-grid-columns"),
  layoutSizingHorizontal: document.querySelector("#prop-layout-sizing-horizontal"),
  layoutSizingVertical: document.querySelector("#prop-layout-sizing-vertical"),
  layoutPositioning: document.querySelector("#prop-layout-positioning"),
  gridColumnSpan: document.querySelector("#prop-grid-column-span"),
  gridRowSpan: document.querySelector("#prop-grid-row-span"),
  layoutAlign: document.querySelector("#prop-layout-align"),
  shadowEnabled: document.querySelector("#prop-shadow-enabled"),
  shadowColor: document.querySelector("#prop-shadow-color"),
  shadowColorPicker: document.querySelector("#prop-shadow-color-picker"),
  shadowX: document.querySelector("#prop-shadow-x"),
  shadowY: document.querySelector("#prop-shadow-y"),
  shadowBlur: document.querySelector("#prop-shadow-blur"),
  shadowOpacity: document.querySelector("#prop-shadow-opacity"),
};

const canvasInputs = {
  name: document.querySelector("#prop-document-name"),
  width: document.querySelector("#prop-canvas-width"),
  height: document.querySelector("#prop-canvas-height"),
  background: document.querySelector("#prop-canvas-background"),
  backgroundColor: document.querySelector("#prop-canvas-background-color"),
};

let design = createBlankDocument();
let selectedId = null;
let selectedIds = new Set();
let activeTool = "select";
let zoom = 0.7;
const pan = { x: 60, y: 50 };
let interaction = null;
let spacePressed = false;
let showGrid = true;
let snapEnabled = true;
let dirty = true;
let currentModifiedAt = null;
let currentRevision = null;
let currentSourcePath = null;
let currentSourceModifiedAt = null;
let currentSourceRevision = null;
let savedSnapshot = "";
let history = [];
let historyIndex = -1;
let lastAgentTransaction = null;
let agentTransactionSequence = 0;
let agentMutationQueue = Promise.resolve();
let agentMutationActive = false;
let workspaceTransition = Promise.resolve();
let context = { busy: false, trusted: false };
let toastTimer;
let recoveryTimer;
let auditStatusTimer;
let renderedPagesSignature = "";
let copiedNodes = [];
let copiedSelectionIds = new Set();
let copiedDocumentEpoch = null;
let copiedParentFrames = new Map();
let documentEpoch = 0;
let designStateSequence = 0;
let layerFilter = "";
let checkingExternalChange = false;
let lastExternalCheckAt = 0;
let warnedExternalVersion = null;
let fileDiscoveryCache = null;
let fileDiscoveryCachedAt = 0;
let workspaceEpoch = 0;
let contextInitialized = false;
let saveInFlight = null;
let recoveryFailureWarned = false;
let externalSyncTimer = null;
let workspaceInfo = null;
const collapsedLayerIds = new Set();

function scopedStorageKey(base, workspaceRoot = context.cwd ?? "preview") {
  let primary = 2_166_136_261;
  let secondary = 2_654_435_769;
  for (let index = 0; index < workspaceRoot.length; index += 1) {
    const code = workspaceRoot.charCodeAt(index);
    primary = Math.imul(primary ^ code, 16_777_619);
    secondary = Math.imul(secondary ^ code, 2_246_822_519);
    secondary ^= secondary >>> 13;
  }
  const scope = [primary, secondary]
    .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
    .join("");
  return `${base}.${scope}`;
}

function applyContextTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function baseNode(type, overrides = {}) {
  const defaults = {
    id: `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    name:
      type === "frame"
        ? "画板"
        : type === "group"
          ? "图层组"
          : type === "component"
            ? "组件"
            : type === "instance"
              ? "组件实例"
              : type === "rectangle"
                ? "矩形"
                : type === "ellipse"
                  ? "椭圆"
                  : "文字",
    x: 0,
    y: 0,
    width: type === "text" ? 240 : 160,
    height: type === "text" ? 54 : 120,
    fill:
      type === "text"
        ? "#171717"
        : type === "group" || type === "instance"
          ? "transparent"
          : type === "frame" || type === "component"
            ? "#ffffff"
            : "#b7ff52",
    stroke: "transparent",
    strokeWidth: 0,
    opacity: 1,
    rotation: 0,
    cornerRadius: type === "ellipse" ? 999 : ["text", "group", "instance"].includes(type) ? 0 : 12,
    visible: true,
    locked: false,
  };
  if (type === "text") {
    Object.assign(defaults, {
      text: "输入文字",
      fontSize: 32,
      fontWeight: 600,
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontStyle: "normal",
      lineHeight: 1.15,
      letterSpacing: 0,
      textDecoration: "none",
      textAlign: "left",
    });
  } else if (["frame", "component"].includes(type)) {
    defaults.clipContent = true;
  }
  if (isContainerNode({ type })) {
    Object.assign(defaults, {
      layout: "none",
      layoutWrap: "none",
      gap: 0,
      padding: 0,
      alignItems: "start",
      justifyContent: "start",
      alignContent: "start",
      gridColumns: 2,
    });
  }
  return { ...defaults, ...overrides };
}

function createBlankDocument(name = "Repo design") {
  const nodes = [];
  return {
    format: "codeshell.design",
    version: 3,
    name,
    canvas: {
      width: 1280,
      height: 820,
      background: "#f7f7f3",
    },
    tokens: {
      colors: clone(DEFAULT_COLOR_TOKENS),
    },
    activePageId: "page-1",
    pages: [{ id: "page-1", name: "Page 1", nodes }],
    nodes,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function utf8Base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  }
  return window.btoa(binary);
}

function ensureDesignV3() {
  if (design.version !== 3) throw new Error("Design Studio 只支持 CodeShell Design v3");
}

function activeDesignPage(value = design) {
  return value.pages.find((page) => page.id === value.activePageId) ?? null;
}

function syncActivePageNodes(value = design) {
  const page = activeDesignPage(value);
  if (page) page.nodes = value.nodes;
}

function allDesignNodes(value = design) {
  const nodes = [];
  for (const page of value.pages ?? []) {
    nodes.push(...(page.id === value.activePageId ? (value.nodes ?? []) : (page.nodes ?? [])));
  }
  return nodes;
}

function readableDesignPages(value = design) {
  return (value.pages ?? []).map((page) =>
    page.id === value.activePageId ? { ...page, nodes: value.nodes ?? [] } : page,
  );
}

function detachedComponentRenderDocument(documentValue, componentId) {
  return {
    ...documentValue,
    nodes: documentValue.nodes.map((node) => {
      if (node.id !== componentId || !node.parentId) return node;
      const { parentId: _parentId, ...detached } = node;
      return detached;
    }),
  };
}

function auditDocument(value = design) {
  return auditDesignPages(value);
}

function activateDesignPage(pageId) {
  const target = design.pages.find((page) => page.id === pageId);
  if (!target) throw new Error(`页面不存在：${pageId}`);
  if (pageId === design.activePageId) return false;
  syncActivePageNodes();
  design.activePageId = pageId;
  design.nodes = target.nodes;
  clearSelection();
  interaction = null;
  return true;
}

function reflowParent(node) {
  if (design.version !== 3 || !node?.parentId) return false;
  return applyAutoLayouts(design.nodes, new Set([node.parentId]));
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function snapPoint(point, bypass = false) {
  if (!snapEnabled || bypass) return point;
  return { x: snapValue(point.x), y: snapValue(point.y) };
}

function selectedNode() {
  return design.nodes.find((node) => node.id === selectedId) ?? null;
}

function selectedNodes() {
  return design.nodes.filter((node) => selectedIds.has(node.id));
}

function nodeById(id) {
  return design.nodes.find((node) => node.id === id) ?? null;
}

function isEffectivelyVisible(node) {
  return isDesignNodeVisible(design, node);
}

function isNodeEffectivelyLocked(node, nodes) {
  if (node.locked) return true;
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const seen = new Set();
  let parentId = node.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (parent.locked) return true;
    parentId = parent.parentId;
  }
  return false;
}

function isEffectivelyLocked(node) {
  return isNodeEffectivelyLocked(node, design.nodes);
}

function nodeTransform(node, nodes = design.nodes) {
  const transforms = [];
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const ancestors = [];
  const seen = new Set();
  let parentId = node.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = parent.parentId;
  }
  for (const parent of ancestors) {
    if (!parent.rotation) continue;
    transforms.push(
      `rotate(${parent.rotation} ${parent.x + parent.width / 2} ${parent.y + parent.height / 2})`,
    );
  }
  if (node.rotation) {
    transforms.push(
      `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})`,
    );
  }
  return transforms.join(" ");
}

function isAutoLayoutPositionOwned(node) {
  if (!node?.parentId) return false;
  return (
    node.layoutPositioning !== "absolute" &&
    isAutoLayoutContainer(nodeById(node.parentId))
  );
}

function selectedPositionMutableNodes() {
  const selected = selectedNodes();
  const ownedRoots = new Set(
    selected.filter((node) => isAutoLayoutPositionOwned(node)).map((node) => node.id),
  );
  const ownedTreeIds = new Set([...ownedRoots, ...descendantIds(design.nodes, ownedRoots)]);
  return selected.filter((node) => !isEffectivelyLocked(node) && !ownedTreeIds.has(node.id));
}

function selectedTransformNodes() {
  const selected = selectedPositionMutableNodes();
  const transformIds = new Set(selected.map((node) => node.id));
  const selectedContainerIds = new Set(
    selected.filter((node) => isContainerNode(node) && !node.locked).map((node) => node.id),
  );
  for (const id of descendantIds(design.nodes, selectedContainerIds)) transformIds.add(id);
  return design.nodes.filter((node) => transformIds.has(node.id));
}

function visualDeltaForNode(node, delta, movingIds) {
  const inheritedRotation = inheritedNodeRotation(design.nodes, node, movingIds);
  return inheritedRotation ? rotateVector(delta, -inheritedRotation) : delta;
}

function containingFrame(point) {
  return (
    [...design.nodes]
      .reverse()
      .find(
        (node) =>
          isContainerNode(node) &&
          isEffectivelyVisible(node) &&
          !isEffectivelyLocked(node) &&
          pointInNodeTree(design.nodes, node, point),
      ) ?? null
  );
}

function layerEntries() {
  const entries = [];
  const visit = (node, depth) => {
    entries.push({ node, depth });
    if (collapsedLayerIds.has(node.id) && !layerFilter.trim()) return;
    for (const child of [...design.nodes].reverse()) {
      if (child.parentId === node.id) visit(child, depth + 1);
    }
  };
  for (const node of [...design.nodes].reverse()) {
    if (!node.parentId) visit(node, 0);
  }
  return entries;
}

function clearSelection() {
  selectedId = null;
  selectedIds = new Set();
}

function selectOnly(id) {
  selectedId = id;
  selectedIds = new Set(id ? [id] : []);
}

function toggleSelection(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    if (selectedId === id) selectedId = [...selectedIds].at(-1) ?? null;
    return;
  }
  selectedIds.add(id);
  selectedId = id;
}

function serializeDocument(value) {
  return serializeDesignDocument(value);
}

function serializeDesign() {
  return serializeDocument(design);
}

function currentDesignStateRevision() {
  const snapshot = `${workspaceEpoch}\u0000${context.cwd ?? ""}\u0000${elements.path.value}\u0000${serializeDesign()}`;
  let primary = 2_166_136_261;
  let secondary = 2_654_435_769;
  for (let index = 0; index < snapshot.length; index += 1) {
    const code = snapshot.charCodeAt(index);
    primary = Math.imul(primary ^ code, 16_777_619);
    secondary = Math.imul(secondary ^ code, 2_246_822_519);
    secondary ^= secondary >>> 13;
  }
  const digest = [primary, secondary]
    .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
    .join("");
  return `design-state-${workspaceEpoch}-${documentEpoch}-${designStateSequence}-${digest}`;
}

async function settleWorkspaceTransition() {
  let pending;
  do {
    pending = workspaceTransition;
    await pending;
  } while (pending !== workspaceTransition);
}

function updateDirtyState() {
  dirty = serializeDesign() !== savedSnapshot;
  if (warnedExternalVersion) {
    setSaveState(dirty ? "外部变更 · 本地有修改" : "源文件已在外部变更", "error");
  } else if (dirty) setSaveState("有修改", "dirty");
  else setSaveState("已保存", "saved");
}

function setSaveState(message, kind = "idle") {
  elements.saveState.textContent = message;
  elements.saveState.dataset.kind = kind;
}

function setRepoLinkState(message, kind = "idle") {
  if (!elements.repoLinkState) return;
  elements.repoLinkState.textContent = message;
  elements.repoLinkState.dataset.kind = kind;
  const root = context.cwd ?? workspaceInfo?.root;
  elements.repoLinkState.title = root ? `当前 Repo：${root}` : "尚未连接 Repo";
}

function updateRepoLinkState() {
  if (context.trusted !== true) {
    setRepoLinkState("Repo 未连接", "error");
    return;
  }
  const name = workspaceInfo?.name ?? context.cwd?.split("/").filter(Boolean).at(-1) ?? "Repo";
  const branch = workspaceInfo?.gitBranch;
  setRepoLinkState(branch ? `${name} · ${branch}` : name, "linked");
}

function notify(message, kind = "idle") {
  clearTimeout(toastTimer);
  const urgent = kind === "error";
  elements.toast.setAttribute("role", urgent ? "alert" : "status");
  elements.toast.setAttribute("aria-live", urgent ? "assertive" : "polite");
  elements.toast.textContent = message;
  elements.toast.dataset.kind = kind;
  elements.toast.hidden = false;
  toastTimer = setTimeout(
    () => {
      elements.toast.hidden = true;
    },
    kind === "error" ? 5200 : 2600,
  );
}

function canAddNodes(count) {
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    allDesignNodes().length + count > MAX_DESIGN_NODES
  ) {
    notify(`设计文件最多包含 ${MAX_DESIGN_NODES} 个图层`, "error");
    return false;
  }
  return true;
}

function keepValidStructuralMutation(previousDesign, previousSelectedId, previousSelectedIds) {
  try {
    normalizeDesignState(design);
    return true;
  } catch (error) {
    design = normalizeDesignState(previousDesign);
    selectedId = previousSelectedId;
    selectedIds = new Set(previousSelectedIds);
    notify(error instanceof Error ? error.message : "该操作会产生无法安全渲染的设计", "error");
    return false;
  }
}

function recoverySnapshot(workspaceRoot) {
  const requestedPath = elements.path.value.trim();
  const recoveryPath = safeDesignPath(requestedPath)
    ? requestedPath
    : safeDesignPath(currentSourcePath ?? "")
      ? currentSourcePath
      : DEFAULT_PATH;
  const tracksCurrentSource = recoveryPath === currentSourcePath;
  return {
    workspaceRoot,
    path: recoveryPath,
    design: clone(design),
    baseModifiedAt: tracksCurrentSource ? currentModifiedAt : null,
    baseRevision: tracksCurrentSource ? currentRevision : null,
  };
}

function storeRecovery(workspaceRoot, recoveryValue = recoverySnapshot(workspaceRoot)) {
  return hostCall("storage.set", {
    key: scopedStorageKey("recovery", workspaceRoot ?? "preview"),
    value: recoveryValue,
  });
}

async function persistRecovery(workspaceRoot, recoveryValue = recoverySnapshot(workspaceRoot)) {
  try {
    await storeRecovery(workspaceRoot, recoveryValue);
    if ((context.cwd ?? null) === workspaceRoot) recoveryFailureWarned = false;
    return true;
  } catch {
    if ((context.cwd ?? null) === workspaceRoot && !recoveryFailureWarned) {
      recoveryFailureWarned = true;
      notify("本地恢复快照写入失败（可能空间不足）；请尽快保存设计到仓库", "error");
    }
    return false;
  }
}

function queueRecovery() {
  clearTimeout(recoveryTimer);
  const workspaceRoot = context.cwd ?? null;
  const recoveryValue = recoverySnapshot(workspaceRoot);
  recoveryTimer = setTimeout(() => {
    void persistRecovery(workspaceRoot, recoveryValue);
  }, 500);
}

function markChanged(render = true) {
  updateDirtyState();
  queueRecovery();
  if (render) renderAll();
}

function saveUiPreferences() {
  void hostCall("storage.set", {
    key: "uiPreferences",
    value: { showGrid, snapEnabled },
  }).catch(() => undefined);
}

function resetHistory() {
  history = [serializeDesign()];
  historyIndex = 0;
  designStateSequence += 1;
  lastAgentTransaction = null;
}

function commitHistory() {
  const snapshot = serializeDesign();
  if (history[historyIndex] === snapshot) return;
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot);
  if (history.length > 60) history.shift();
  historyIndex = history.length - 1;
  designStateSequence += 1;
}

function restoreHistory(nextIndex) {
  if (nextIndex < 0 || nextIndex >= history.length) return;
  historyIndex = nextIndex;
  design = normalizeDocument(JSON.parse(history[historyIndex]));
  designStateSequence += 1;
  selectedIds = new Set(
    [...selectedIds].filter((id) => design.nodes.some((node) => node.id === id)),
  );
  if (!selectedIds.has(selectedId)) selectedId = [...selectedIds].at(-1) ?? null;
  markChanged();
}

function undo() {
  restoreHistory(historyIndex - 1);
}

function redo() {
  restoreHistory(historyIndex + 1);
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function shouldRenderCanvasLabel(node, options = {}) {
  return (
    options.suppressLabel !== true && zoom >= 0.65 && (!node.parentId || selectedIds.has(node.id))
  );
}

function appendAncestorClipChain(root, node, clipIds, nodes = design.nodes) {
  let content = root;
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const seen = new Set();
  let parentId = node.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    const clipId = clipIds.get(parent.id);
    if (clipId) {
      const clipped = svgElement("g", { "clip-path": `url(#${clipId})` });
      content.append(clipped);
      content = clipped;
    }
    parentId = parent.parentId;
  }
  return content;
}

function renderScene() {
  elements.scene.replaceChildren();
  elements.scene.setAttribute("transform", `translate(${pan.x} ${pan.y}) scale(${zoom})`);

  const artboard = svgElement("rect", {
    x: 0,
    y: 0,
    width: design.canvas.width,
    height: design.canvas.height,
    rx: 2,
    fill: design.canvas.background,
    filter: "url(#artboard-shadow)",
  });
  artboard.dataset.canvas = "true";
  elements.scene.append(artboard);

  const clipIds = new Map();
  const componentClipIds = new Map();
  const shadowIds = new Map();
  const sceneDefs = svgElement("defs");
  const renderNodes = allDesignNodes();
  const renderDocument = { ...design, nodes: renderNodes };
  renderNodes.forEach((node, index) => {
    if (["frame", "component"].includes(node.type) && node.clipContent === true) {
      const id = `frame-clip-${index}`;
      clipIds.set(node.id, id);
      const clipPath = svgElement("clipPath", {
        id,
        clipPathUnits: "userSpaceOnUse",
      });
      const clipRect = svgElement("rect", {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rx: Math.min(node.cornerRadius, node.width / 2, node.height / 2),
      });
      const transform = nodeTransform(node, renderNodes);
      if (transform) clipRect.setAttribute("transform", transform);
      clipPath.append(clipRect);
      sceneDefs.append(clipPath);
    }
    if (node.shadow && node.shadow.opacity > 0 && node.type !== "group") {
      const id = `node-shadow-${index}`;
      const bounds = renderedDesignNodeShadowFilterBounds(renderDocument, node, renderNodes);
      shadowIds.set(node.id, id);
      const filter = svgElement("filter", {
        id,
        filterUnits: "userSpaceOnUse",
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
      filter.append(
        svgElement("feDropShadow", {
          dx: node.shadow.x,
          dy: node.shadow.y,
          stdDeviation: node.shadow.blur / 2,
          "flood-color": node.shadow.color,
          "flood-opacity": node.shadow.opacity,
        }),
      );
      sceneDefs.append(filter);
    }
  });
  renderNodes
    .filter((node) => node.type === "component")
    .forEach((component, componentIndex) => {
      const sourceDocument = detachedComponentRenderDocument(renderDocument, component.id);
      const sourceIds = descendantIds(sourceDocument.nodes, new Set([component.id]));
      sourceIds.add(component.id);
      const sourceClipIds = new Map();
      sourceDocument.nodes.forEach((node, nodeIndex) => {
        if (
          !sourceIds.has(node.id) ||
          !["frame", "component"].includes(node.type) ||
          node.clipContent !== true
        ) {
          return;
        }
        const id = `component-${componentIndex}-clip-${nodeIndex}`;
        sourceClipIds.set(node.id, id);
        const clipPath = svgElement("clipPath", {
          id,
          clipPathUnits: "userSpaceOnUse",
        });
        const clipRect = svgElement("rect", {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          rx: Math.min(node.cornerRadius, node.width / 2, node.height / 2),
        });
        const transform = nodeTransform(node, sourceDocument.nodes);
        if (transform) clipRect.setAttribute("transform", transform);
        clipPath.append(clipRect);
        sceneDefs.append(clipPath);
      });
      componentClipIds.set(component.id, sourceClipIds);
    });
  if (clipIds.size + shadowIds.size > 0) elements.scene.append(sceneDefs);
  for (const node of design.nodes) {
    if (!isEffectivelyVisible(node)) continue;
    elements.scene.append(
      renderNode(node, clipIds, shadowIds, { renderDocument, componentClipIds }),
    );
  }
  const nodes = selectedNodes().filter((node) => isEffectivelyVisible(node));
  if (nodes.length === 1) {
    elements.scene.append(renderSelection(nodes[0], true));
  } else if (nodes.length > 1) {
    for (const node of nodes) elements.scene.append(renderSelection(node, false));
    elements.scene.append(renderMultiSelection(nodes));
  }
  if (interaction?.kind === "marquee") elements.scene.append(renderMarquee(interaction));
  if (interaction?.kind === "move" && interaction.guides?.length) {
    elements.scene.append(renderSmartGuides(interaction.guides));
  }
  renderSelectionSize(nodes);
}

function renderInstanceNode(node, clipIds, shadowIds, options = {}) {
  const renderDocument = options.renderDocument ?? design;
  const renderNodes = renderDocument.nodes;
  const component = renderNodes.find(
    (candidate) => candidate.id === node.componentId && candidate.type === "component",
  );
  const group = svgElement("g");
  group.dataset.nodeId = node.id;
  group.dataset.componentId = node.componentId;
  const content = appendAncestorClipChain(group, node, clipIds, renderNodes);
  const shadowId = shadowIds.get(node.id);
  if (shadowId) content.setAttribute("filter", `url(#${shadowId})`);
  const transform = nodeTransform(node, renderNodes);
  if (transform) content.setAttribute("transform", transform);
  content.setAttribute("opacity", effectiveDesignNodeOpacity(renderDocument, node));
  const instanceStack = options.instanceStack ?? new Set();
  if (
    !component ||
    component.width <= 0 ||
    component.height <= 0 ||
    instanceStack.has(component.id)
  ) {
    const missing = svgElement("rect", {
      x: node.x,
      y: node.y,
      width: Math.max(1, node.width),
      height: Math.max(1, node.height),
      fill: "none",
      stroke: "#ff5c78",
      "stroke-width": 1.5 / zoom,
      "stroke-dasharray": `${6 / zoom} ${4 / zoom}`,
    });
    missing.dataset.nodeId = node.id;
    content.append(missing);
    return group;
  }
  const nextInstanceStack = new Set(instanceStack);
  nextInstanceStack.add(component.id);
  const sourceDocument = detachedComponentRenderDocument(renderDocument, component.id);
  const sourceComponent = sourceDocument.nodes.find((candidate) => candidate.id === component.id);
  const componentClipIds = options.componentClipIds ?? new Map();
  const sourceClipIds = componentClipIds.get(component.id) ?? clipIds;

  const mapped = svgElement("g", {
    transform: `translate(${node.x} ${node.y}) scale(${node.width / component.width} ${
      node.height / component.height
    }) translate(${-component.x} ${-component.y})`,
  });
  const componentDescendantIds = descendantIds(sourceDocument.nodes, new Set([component.id]));
  const sourceNodes = [
    sourceComponent,
    ...sourceDocument.nodes.filter((candidate) => componentDescendantIds.has(candidate.id)),
  ].filter(Boolean);
  for (const sourceNode of sourceNodes) {
    if (!isDesignNodeVisible(sourceDocument, sourceNode)) continue;
    const source = renderNode(sourceNode, sourceClipIds, shadowIds, {
      suppressLabel: true,
      instanceStack: nextInstanceStack,
      renderDocument: sourceDocument,
      componentClipIds,
    });
    source.dataset.nodeId = node.id;
    for (const target of source.querySelectorAll("[data-node-id]")) {
      target.dataset.componentNodeId = target.dataset.nodeId;
      target.dataset.nodeId = node.id;
    }
    mapped.append(source);
  }
  content.append(mapped);
  if (shouldRenderCanvasLabel(node)) {
    const label = svgElement("text", {
      x: node.x,
      y: node.y - 18 / zoom,
      fill: "#a78bfa",
      "font-size": 11 / zoom,
      "font-weight": 650,
      "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
    });
    label.textContent = `◆ ${node.name}`;
    label.dataset.nodeId = node.id;
    content.append(label);
  }
  return group;
}

function renderNode(node, clipIds, shadowIds, options = {}) {
  if (node.type === "instance") return renderInstanceNode(node, clipIds, shadowIds, options);
  const renderDocument = options.renderDocument ?? design;
  const renderNodes = renderDocument.nodes;
  const group = svgElement("g");
  group.dataset.nodeId = node.id;
  const content = appendAncestorClipChain(group, node, clipIds, renderNodes);
  const transform = nodeTransform(node, renderNodes);
  if (transform) content.setAttribute("transform", transform);
  content.setAttribute("opacity", effectiveDesignNodeOpacity(renderDocument, node));

  let visual;
  if (node.type === "ellipse") {
    visual = svgElement("ellipse", {
      cx: node.x + node.width / 2,
      cy: node.y + node.height / 2,
      rx: Math.max(0.5, node.width / 2),
      ry: Math.max(0.5, node.height / 2),
      fill: node.fill,
      stroke: node.stroke,
      "stroke-width": node.strokeWidth,
    });
  } else if (node.type === "text") {
    const textX =
      node.textAlign === "center"
        ? node.x + node.width / 2
        : node.textAlign === "right"
          ? node.x + node.width
          : node.x;
    visual = svgElement("text", {
      x: textX,
      y: node.y,
      fill: node.fill,
      stroke: node.stroke,
      "stroke-width": node.strokeWidth,
      "font-size": node.fontSize,
      "font-weight": node.fontWeight,
      "font-family": node.fontFamily ?? "Inter, ui-sans-serif, system-ui, sans-serif",
      "font-style": node.fontStyle ?? "normal",
      "letter-spacing": node.letterSpacing ?? 0,
      "text-decoration": node.textDecoration ?? "none",
      "dominant-baseline": "hanging",
      "text-anchor":
        node.textAlign === "center" ? "middle" : node.textAlign === "right" ? "end" : "start",
    });
    const lines = String(node.text).split("\n");
    lines.forEach((line, index) => {
      const span = svgElement("tspan", {
        x: textX,
        y: node.y + index * node.fontSize * node.lineHeight,
      });
      span.textContent = line || " ";
      visual.append(span);
    });
  } else if (node.type === "group") {
    visual = svgElement("rect", {
      x: node.x,
      y: node.y,
      width: Math.max(1, node.width),
      height: Math.max(1, node.height),
      fill: "transparent",
      stroke: "transparent",
      "pointer-events": "all",
    });
  } else {
    visual = svgElement("rect", {
      x: node.x,
      y: node.y,
      width: Math.max(1, node.width),
      height: Math.max(1, node.height),
      rx: Math.min(node.cornerRadius, node.width / 2, node.height / 2),
      fill: node.fill,
      stroke: node.stroke,
      "stroke-width": node.strokeWidth,
    });
  }
  visual.dataset.nodeId = node.id;
  const shadowId = shadowIds.get(node.id);
  if (shadowId) visual.setAttribute("filter", `url(#${shadowId})`);
  visual.style.pointerEvents = isNodeEffectivelyLocked(node, renderNodes)
    ? "visiblePainted"
    : "all";
  content.append(visual);

  if (isContainerNode(node) && shouldRenderCanvasLabel(node, options)) {
    const label = svgElement("text", {
      x: node.x,
      y: node.y - 18 / zoom,
      fill: "#8a8a85",
      "font-size": 11 / zoom,
      "font-weight": 600,
      "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
    });
    label.textContent = `${node.type === "component" ? "◇ " : node.type === "group" ? "▣ " : ""}${node.name}`;
    label.dataset.nodeId = node.id;
    content.append(label);
  }
  return group;
}

function renderSelection(node, showHandles) {
  const locked = isEffectivelyLocked(node);
  const overlay = svgElement("g", {
    transform: nodeTransform(node),
  });
  const border = svgElement("rect", {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    fill: "none",
    stroke: locked ? "#ffae52" : "#4f7cff",
    "stroke-width": 1.5 / zoom,
    "stroke-dasharray": locked ? `${5 / zoom} ${3 / zoom}` : "",
    "pointer-events": "none",
  });
  overlay.append(border);
  if (!showHandles || locked || nodeTransform(node) || activeTool !== "select") return overlay;

  const size = 8 / zoom;
  const handles = [
    ["nw", node.x, node.y, "nwse-resize"],
    ["ne", node.x + node.width, node.y, "nesw-resize"],
    ["se", node.x + node.width, node.y + node.height, "nwse-resize"],
    ["sw", node.x, node.y + node.height, "nesw-resize"],
  ];
  for (const [handle, x, y, cursor] of handles) {
    const point = svgElement("rect", {
      x: x - size / 2,
      y: y - size / 2,
      width: size,
      height: size,
      rx: 1.5 / zoom,
      fill: "#ffffff",
      stroke: "#315fda",
      "stroke-width": 1.5 / zoom,
    });
    point.dataset.handle = handle;
    point.style.cursor = cursor;
    overlay.append(point);
  }
  return overlay;
}

function renderMultiSelection(nodes) {
  const bounds = visualSelectionBounds(nodes, design.nodes);
  return svgElement("rect", {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    fill: "none",
    stroke: "#4f7cff",
    "stroke-width": 1.5 / zoom,
    "stroke-dasharray": `${4 / zoom} ${3 / zoom}`,
    "pointer-events": "none",
  });
}

function renderMarquee(state) {
  const x = Math.min(state.start.x, state.current.x);
  const y = Math.min(state.start.y, state.current.y);
  return svgElement("rect", {
    x,
    y,
    width: Math.abs(state.current.x - state.start.x),
    height: Math.abs(state.current.y - state.start.y),
    fill: "#4f7cff",
    "fill-opacity": 0.08,
    stroke: "#6d9cff",
    "stroke-width": 1 / zoom,
    "stroke-dasharray": `${3 / zoom} ${2 / zoom}`,
    "pointer-events": "none",
  });
}

function renderSmartGuides(guides) {
  const group = svgElement("g", { "pointer-events": "none" });
  for (const guide of guides) {
    group.append(
      svgElement("line", {
        x1: guide.axis === "x" ? guide.value : 0,
        x2: guide.axis === "x" ? guide.value : design.canvas.width,
        y1: guide.axis === "y" ? guide.value : 0,
        y2: guide.axis === "y" ? guide.value : design.canvas.height,
        stroke: "#ff4fa3",
        "stroke-width": 1 / zoom,
        "stroke-dasharray": `${4 / zoom} ${3 / zoom}`,
      }),
    );
  }
  return group;
}

function renderSelectionSize(nodes) {
  const bounds = visualSelectionBounds(nodes, design.nodes);
  if (!bounds) {
    elements.selectionSize.hidden = true;
    return;
  }
  const x = pan.x + (bounds.x + bounds.width / 2) * zoom;
  const y = pan.y + (bounds.y + bounds.height) * zoom + 9;
  elements.selectionSize.textContent =
    nodes.length > 1
      ? `${nodes.length} 层 · ${Math.round(bounds.width)} × ${Math.round(bounds.height)}`
      : `${Math.round(bounds.width)} × ${Math.round(bounds.height)}`;
  elements.selectionSize.style.left = `${x}px`;
  elements.selectionSize.style.top = `${y}px`;
  elements.selectionSize.style.transform = "translateX(-50%)";
  elements.selectionSize.hidden = false;
}

function renderProperties() {
  const nodes = selectedNodes();
  const node = selectedNode();
  const single = nodes.length === 1 ? node : null;
  elements.noSelection.hidden = nodes.length !== 0;
  elements.multiSelection.hidden = nodes.length < 2;
  elements.canvasProperties.hidden = nodes.length !== 0;
  elements.selectionProperties.hidden = !single;
  if (nodes.length > 1) {
    elements.multiSelectionCount.textContent = `已选择 ${nodes.length} 个图层`;
    return;
  }
  if (!single) {
    canvasInputs.name.value = design.name;
    canvasInputs.width.value = String(round(design.canvas.width));
    canvasInputs.height.value = String(round(design.canvas.height));
    canvasInputs.background.value = design.canvas.background;
    canvasInputs.backgroundColor.value = design.canvas.background;
    return;
  }

  propertyInputs.name.value = single.name;
  propertyInputs.x.value = String(round(single.x));
  propertyInputs.y.value = String(round(single.y));
  propertyInputs.width.value = String(round(single.width));
  propertyInputs.height.value = String(round(single.height));
  propertyInputs.fill.value = single.fill;
  propertyInputs.stroke.value = single.stroke;
  propertyInputs.strokeWidth.value = String(round(single.strokeWidth));
  propertyInputs.cornerRadius.value = String(round(single.cornerRadius));
  propertyInputs.opacity.value = String(Math.round(single.opacity * 100));
  propertyInputs.rotation.value = String(round(single.rotation));
  propertyInputs.fillColor.value = validHex(single.fill) ? single.fill : "#ffffff";
  propertyInputs.strokeColor.value = validHex(single.stroke) ? single.stroke : "#000000";
  elements.toggleLock.classList.toggle("active", single.locked);
  elements.toggleVisible.classList.toggle("active", single.visible);
  elements.toggleLock.setAttribute("aria-pressed", String(single.locked));
  elements.toggleVisible.setAttribute("aria-pressed", String(single.visible));
  elements.toggleLock.textContent = single.locked ? "解" : "锁";
  elements.toggleVisible.textContent = single.visible ? "眼" : "隐";
  const container = isContainerNode(single);
  const parent = single.parentId ? nodeById(single.parentId) : null;
  const autoLayoutChild = isAutoLayoutContainer(parent);
  const flowLayoutChild = autoLayoutChild && single.layoutPositioning !== "absolute";
  propertyInputs.x.disabled = flowLayoutChild;
  propertyInputs.y.disabled = flowLayoutChild;
  const positionHint = flowLayoutChild
    ? `位置由自动布局容器「${parent.name}」管理`
    : "绝对画布坐标";
  propertyInputs.x.title = positionHint;
  propertyInputs.y.title = positionHint;
  elements.parentField.hidden = false;
  elements.frameSection.hidden = !["frame", "group", "component"].includes(single.type);
  elements.containerSectionLabel.textContent =
    single.type === "component" ? "主组件" : single.type === "group" ? "编组" : "画板";
  elements.clipContentLabel.textContent =
    single.type === "component" ? "裁剪超出组件的内容" : "裁剪超出画板的内容";
  elements.clipContentField.hidden = single.type === "group";
  elements.releaseFrame.hidden = single.type === "component";
  elements.releaseContainerLabel.textContent =
    single.type === "group" ? "解除编组，保留内容" : "解除画板，保留内容";
  propertyInputs.clipContent.checked = single.clipContent === true;
  elements.layoutSection.hidden = !container && !autoLayoutChild;
  elements.containerLayoutControls.hidden = !container;
  elements.childLayoutControls.hidden = !autoLayoutChild;
  if (container) {
    propertyInputs.layout.value = single.layout ?? "none";
    const flexLayout = ["horizontal", "vertical"].includes(single.layout);
    const gridLayout = single.layout === "grid";
    propertyInputs.layoutWrap.closest("label").hidden = !flexLayout;
    propertyInputs.gridColumns.closest("label").hidden = !gridLayout;
    propertyInputs.alignContent.closest("label").hidden =
      !gridLayout && !(flexLayout && single.layoutWrap === "wrap");
    propertyInputs.layoutWrap.value = single.layoutWrap ?? "none";
    propertyInputs.gap.value = String(round(single.gap ?? 0));
    propertyInputs.rowGap.value =
      single.rowGap === undefined ? "" : String(round(single.rowGap));
    propertyInputs.columnGap.value =
      single.columnGap === undefined ? "" : String(round(single.columnGap));
    propertyInputs.padding.value = String(round(single.padding ?? 0));
    propertyInputs.paddingTop.value =
      single.paddingTop === undefined ? "" : String(round(single.paddingTop));
    propertyInputs.paddingRight.value =
      single.paddingRight === undefined ? "" : String(round(single.paddingRight));
    propertyInputs.paddingBottom.value =
      single.paddingBottom === undefined ? "" : String(round(single.paddingBottom));
    propertyInputs.paddingLeft.value =
      single.paddingLeft === undefined ? "" : String(round(single.paddingLeft));
    propertyInputs.alignItems.value = single.alignItems ?? "start";
    propertyInputs.justifyContent.value = single.justifyContent ?? "start";
    propertyInputs.alignContent.value = single.alignContent ?? "start";
    propertyInputs.gridColumns.value = String(single.gridColumns ?? 2);
  }
  if (autoLayoutChild) {
    const horizontalParent = parent.layout === "horizontal";
    propertyInputs.layoutSizingHorizontal.value =
      single.layoutSizingHorizontal ??
      (single.layoutGrow === 1 && horizontalParent
        ? "fill"
        : single.layoutAlign === "stretch" && !horizontalParent
          ? "fill"
          : "fixed");
    propertyInputs.layoutSizingVertical.value =
      single.layoutSizingVertical ??
      (single.layoutGrow === 1 && parent.layout === "vertical"
        ? "fill"
        : single.layoutAlign === "stretch" && horizontalParent
          ? "fill"
          : "fixed");
    propertyInputs.layoutPositioning.value = single.layoutPositioning ?? "auto";
    propertyInputs.gridColumnSpan.value = String(single.gridColumnSpan ?? 1);
    propertyInputs.gridRowSpan.value = String(single.gridRowSpan ?? 1);
    propertyInputs.layoutAlign.value = single.layoutAlign ?? "auto";
    const absoluteLayoutChild = single.layoutPositioning === "absolute";
    propertyInputs.layoutSizingHorizontal.disabled = absoluteLayoutChild;
    propertyInputs.layoutSizingVertical.disabled = absoluteLayoutChild;
    propertyInputs.layoutAlign.disabled = absoluteLayoutChild;
    propertyInputs.gridColumnSpan.closest(".property-grid").hidden =
      parent.layout !== "grid" || absoluteLayoutChild;
  }
  elements.componentSection.hidden = !["frame", "component", "instance"].includes(single.type);
  elements.makeComponent.hidden = single.type !== "frame";
  elements.createInstance.hidden = single.type !== "component";
  if (single.type === "component") {
    const instanceCount = allDesignNodes().filter(
      (candidate) => candidate.type === "instance" && candidate.componentId === single.id,
    ).length;
    elements.componentStatus.textContent = `主组件 · ${instanceCount} 个实例`;
  } else if (single.type === "instance") {
    const source = allDesignNodes().find((candidate) => candidate.id === single.componentId);
    elements.componentStatus.textContent = source
      ? `实例来自 ${source.name}`
      : "实例的主组件不存在";
  } else {
    elements.componentStatus.textContent = "将画板转换为可复用组件";
  }
  const paintlessLayer = ["group", "instance"].includes(single.type);
  elements.paintControls.hidden = paintlessLayer;
  elements.paintlessLayerHint.hidden = !paintlessLayer;
  elements.radiusField.hidden = ["text", "ellipse"].includes(single.type);
  elements.paintlessLayerHint.textContent =
    single.type === "instance"
      ? "实例外观来自主组件；此处可调整整体透明度、旋转与投影。"
      : "编组不绘制自身外观；此处可调整整体透明度与旋转。";
  propertyInputs.parent.replaceChildren();
  const canvasOption = document.createElement("option");
  canvasOption.value = "";
  canvasOption.textContent = "画布（根级）";
  propertyInputs.parent.append(canvasOption);
  const invalidParentIds = new Set([
    single.id,
    ...descendantIds(design.nodes, new Set([single.id])),
  ]);
  for (const frame of design.nodes.filter(
    (candidate) => isContainerNode(candidate) && !invalidParentIds.has(candidate.id),
  )) {
    const option = document.createElement("option");
    option.value = frame.id;
    option.textContent = frame.name;
    propertyInputs.parent.append(option);
  }
  propertyInputs.parent.value = single.parentId ?? "";
  propertyInputs.notes.value = single.notes ?? "";
  const shadowSupported = single.type !== "group";
  elements.shadowSection.hidden = !shadowSupported;
  propertyInputs.shadowEnabled.checked = Boolean(single.shadow);
  elements.shadowControls.hidden = !single.shadow;
  if (single.shadow) {
    propertyInputs.shadowColor.value = single.shadow.color;
    propertyInputs.shadowColorPicker.value = single.shadow.color;
    propertyInputs.shadowX.value = String(round(single.shadow.x));
    propertyInputs.shadowY.value = String(round(single.shadow.y));
    propertyInputs.shadowBlur.value = String(round(single.shadow.blur));
    propertyInputs.shadowOpacity.value = String(Math.round(single.shadow.opacity * 100));
  }

  const isText = single.type === "text";
  elements.textSection.hidden = !isText;
  if (isText) {
    propertyInputs.text.value = single.text;
    propertyInputs.fontSize.value = String(single.fontSize);
    propertyInputs.fontWeight.value = String(single.fontWeight);
    propertyInputs.fontFamily.value =
      single.fontFamily ?? "Inter, ui-sans-serif, system-ui, sans-serif";
    propertyInputs.fontStyle.value = single.fontStyle ?? "normal";
    propertyInputs.lineHeight.value = String(single.lineHeight);
    propertyInputs.letterSpacing.value = String(single.letterSpacing ?? 0);
    propertyInputs.textDecoration.value = single.textDecoration ?? "none";
    propertyInputs.textAlign.value = single.textAlign;
  }
}

function focusLayerRow(id) {
  requestAnimationFrame(() => {
    const row = [...elements.layersList.querySelectorAll(".layer-row")].find(
      (candidate) => candidate.dataset.id === id,
    );
    row?.focus();
  });
}

function toggleNodeVisibility(node) {
  if (!node) return;
  node.visible = !node.visible;
  reflowParent(node);
  commitHistory();
  markChanged();
}

function renderLayers() {
  elements.layersList.replaceChildren();
  const normalizedFilter = layerFilter.trim().toLowerCase();
  const entries = layerEntries().filter(({ node }) => {
    if (!normalizedFilter) return true;
    return [node.name, node.id, node.type, node.notes]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedFilter));
  });
  const rovingId = entries.some(({ node }) => node.id === selectedId)
    ? selectedId
    : entries[0]?.node.id;
  for (const { node, depth } of entries) {
    const row = document.createElement("div");
    row.className = `layer-row${selectedIds.has(node.id) ? " active" : ""}`;
    row.dataset.id = node.id;
    row.dataset.hidden = String(!isEffectivelyVisible(node));
    row.role = "option";
    row.ariaSelected = String(selectedIds.has(node.id));
    row.ariaLabel = `${node.name}，${node.type}，${node.visible ? "可见" : "隐藏"}；按 V 切换显示`;
    row.style.setProperty("--layer-depth", String(depth));
    row.tabIndex = node.id === rovingId ? 0 : -1;

    const hasChildren = design.nodes.some((candidate) => candidate.parentId === node.id);
    const disclosure = document.createElement("button");
    disclosure.className = "layer-disclosure";
    disclosure.type = "button";
    disclosure.tabIndex = -1;
    disclosure.disabled = !hasChildren;
    disclosure.style.visibility = hasChildren ? "visible" : "hidden";
    disclosure.textContent = collapsedLayerIds.has(node.id) ? "›" : "⌄";
    disclosure.title = collapsedLayerIds.has(node.id) ? "展开图层" : "折叠图层";
    disclosure.setAttribute("aria-label", `${disclosure.title}：${node.name}`);
    disclosure.setAttribute("aria-expanded", String(!collapsedLayerIds.has(node.id)));
    disclosure.addEventListener("click", (event) => {
      event.stopPropagation();
      if (collapsedLayerIds.has(node.id)) collapsedLayerIds.delete(node.id);
      else collapsedLayerIds.add(node.id);
      renderLayers();
      focusLayerRow(node.id);
    });
    const kind = document.createElement("span");
    kind.className = "layer-kind";
    kind.textContent =
      node.type === "rectangle"
        ? "▭"
        : node.type === "ellipse"
          ? "○"
          : node.type === "text"
            ? "T"
            : node.type === "group"
              ? "▣"
              : node.type === "component"
                ? "◇"
                : node.type === "instance"
                  ? "◆"
                  : "F";
    const title = document.createElement("span");
    title.className = "layer-title";
    title.textContent = node.name;
    if (node.notes) title.title = node.notes;
    const visibility = document.createElement("button");
    visibility.className = "layer-visibility";
    visibility.type = "button";
    visibility.title = node.visible ? "隐藏图层" : "显示图层";
    visibility.setAttribute("aria-label", `${visibility.title}：${node.name}`);
    visibility.setAttribute("aria-pressed", String(node.visible));
    visibility.tabIndex = -1;
    visibility.textContent = node.visible ? "◉" : "○";
    visibility.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleNodeVisibility(node);
    });
    row.append(disclosure, kind, title, visibility);
    row.addEventListener("click", (event) => {
      if (event.shiftKey) toggleSelection(node.id);
      else selectOnly(node.id);
      setActiveTool("select");
      renderAll();
    });
    row.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "v") {
        event.preventDefault();
        toggleNodeVisibility(node);
        focusLayerRow(node.id);
        return;
      }
      if (hasChildren && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        if (event.key === "ArrowLeft") collapsedLayerIds.add(node.id);
        else collapsedLayerIds.delete(node.id);
        renderLayers();
        focusLayerRow(node.id);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (event.shiftKey) toggleSelection(node.id);
        else selectOnly(node.id);
        renderAll();
        focusLayerRow(node.id);
        return;
      }
      const rows = [...elements.layersList.querySelectorAll(".layer-row")];
      const index = rows.indexOf(row);
      const targetIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : event.key === "ArrowUp"
              ? Math.max(0, index - 1)
              : event.key === "ArrowDown"
                ? Math.min(rows.length - 1, index + 1)
                : -1;
      if (targetIndex < 0 || targetIndex === index) return;
      event.preventDefault();
      const targetId = rows[targetIndex].dataset.id;
      selectOnly(targetId);
      setActiveTool("select");
      renderAll();
      focusLayerRow(targetId);
    });
    elements.layersList.append(row);
  }
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "layers-empty";
    empty.textContent = "没有匹配的图层";
    elements.layersList.append(empty);
  }
}

function renderTokens() {
  elements.colorTokens.replaceChildren();
  for (const [index, token] of (design.tokens?.colors ?? []).entries()) {
    const originalName = token.name;
    const row = document.createElement("div");
    row.className = "color-token-row";

    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "color-token-apply";
    apply.style.background = token.value;
    apply.title = `应用 ${token.name} · ${token.value}`;
    apply.setAttribute("aria-label", apply.title);
    apply.addEventListener("click", () => {
      const nodes = selectedNodes().filter((node) => !isEffectivelyLocked(node));
      if (nodes.length === 0) return notify("先选择一个未锁定图层");
      for (const node of nodes) node.fill = token.value;
      commitHistory();
      markChanged();
    });

    const name = document.createElement("input");
    name.value = token.name;
    name.maxLength = 80;
    name.setAttribute("aria-label", `颜色变量 ${index + 1} 名称`);
    const validTokenName = (candidate) => {
      const normalized = candidate.trim().toLowerCase();
      return (
        normalized.length > 0 &&
        !/[\u0000-\u001f\u007f]/u.test(candidate) &&
        !design.tokens.colors.some(
          (other, candidateIndex) =>
            candidateIndex !== index && other.name.trim().toLowerCase() === normalized,
        )
      );
    };
    name.addEventListener("input", () => {
      const candidate = name.value.slice(0, 80);
      const valid = validTokenName(candidate);
      name.dataset.invalid = String(!valid);
      if (!valid) return;
      token.name = candidate;
      updateDirtyState();
      queueRecovery();
    });
    name.addEventListener("change", () => {
      const candidate = name.value.slice(0, 80).trim();
      if (!validTokenName(candidate)) {
        token.name = originalName;
        name.value = originalName;
        notify("颜色变量名称不能为空、包含控制字符或与现有名称重复", "error");
      } else {
        token.name = candidate;
      }
      name.dataset.invalid = "false";
      commitHistory();
      markChanged();
    });

    const value = document.createElement("input");
    value.value = token.value;
    value.maxLength = 7;
    value.spellcheck = false;
    value.setAttribute("aria-label", `${token.name} 色值`);
    value.addEventListener("input", () => {
      const valid = validHex(value.value);
      value.dataset.invalid = String(!valid);
      if (!valid) return;
      const nextValue = value.value.toLowerCase();
      replaceDesignColor(design, token.value, nextValue);
      token.value = nextValue;
      apply.style.background = token.value;
      updateDirtyState();
      queueRecovery();
      renderScene();
      renderProperties();
    });
    value.addEventListener("change", () => {
      value.value = token.value;
      value.dataset.invalid = "false";
      commitHistory();
      renderTokens();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "color-token-delete";
    remove.textContent = "×";
    remove.title = `删除 ${token.name}`;
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", () => {
      design.tokens.colors.splice(index, 1);
      commitHistory();
      markChanged();
    });
    row.append(apply, name, value, remove);
    elements.colorTokens.append(row);
  }
}

function updateAuditStatus() {
  const summary = summarizeAudit(auditDocument());
  const kind =
    summary.blockingIssueCount > 0 ? "blocking" : summary.warningCount > 0 ? "warning" : "clean";
  elements.runAudit.dataset.kind = kind;
  elements.runAudit.textContent =
    summary.issueCount === 0
      ? "检查 ✓"
      : summary.blockingIssueCount > 0
        ? `检查 · ${summary.blockingIssueCount} 阻塞`
        : `检查 · ${summary.warningCount}`;
  elements.runAudit.title =
    summary.issueCount === 0
      ? "设计检查通过：0 个问题"
      : `${summary.issueCount} 个问题 · ${summary.blockingIssueCount} 个阻塞 · ${summary.errorCount} 个错误 · ${summary.warningCount} 个警告`;
  elements.runAudit.setAttribute("aria-label", elements.runAudit.title);
}

function renderAuditStatus() {
  if (auditStatusTimer !== undefined) return;
  auditStatusTimer = window.setTimeout(() => {
    auditStatusTimer = undefined;
    updateAuditStatus();
  }, 100);
}

function renderPages() {
  const signature = `${design.activePageId}\u0000${design.pages
    .map((page) => `${page.id}\u0000${page.name}`)
    .join("\u0001")}`;
  if (signature !== renderedPagesSignature) {
    elements.activePage.replaceChildren();
    for (const page of design.pages) {
      const option = document.createElement("option");
      option.value = page.id;
      option.textContent = page.name;
      option.title = page.name;
      elements.activePage.append(option);
    }
    renderedPagesSignature = signature;
  }
  elements.activePage.value = design.activePageId;
  elements.activePage.title = `${activeDesignPage()?.name ?? "页面"} · ${design.pages.length} 页`;
  elements.addPage.disabled = design.pages.length >= MAX_DESIGN_PAGES;
  elements.addPage.title =
    design.pages.length >= MAX_DESIGN_PAGES
      ? `设计文件最多 ${MAX_DESIGN_PAGES} 页`
      : "新建设计页面";
}

function validPageName(value) {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value.length <= 120 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function renderPageManager() {
  elements.pagesList.replaceChildren();
  syncActivePageNodes();
  for (const page of design.pages) {
    const row = document.createElement("div");
    row.className = "page-row";
    row.dataset.active = String(page.id === design.activePageId);

    const dot = document.createElement("span");
    dot.className = "page-row-dot";
    dot.setAttribute("aria-hidden", "true");

    const name = document.createElement("input");
    name.value = page.name;
    name.maxLength = 120;
    name.setAttribute("aria-label", `${page.name} 页面名称`);
    name.title = `${page.nodes.length} 个图层`;
    name.addEventListener("change", () => {
      const nextName = name.value.trim();
      if (!validPageName(nextName)) {
        name.value = page.name;
        notify("页面名称必须是 1–120 个安全字符", "error");
        return;
      }
      if (nextName === page.name) return;
      page.name = nextName;
      commitHistory();
      markChanged();
      renderPageManager();
    });
    name.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      name.blur();
    });

    const count = document.createElement("span");
    count.className = "page-row-count";
    count.textContent = `${page.nodes.length} 层`;

    const open = document.createElement("button");
    open.type = "button";
    open.className = "page-row-action";
    open.textContent = page.id === design.activePageId ? "当前" : "打开";
    open.disabled = page.id === design.activePageId;
    open.addEventListener("click", () => {
      if (!activateDesignPage(page.id)) return;
      commitHistory();
      markChanged();
      renderPageManager();
      requestAnimationFrame(fitCanvas);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "page-row-action";
    remove.dataset.danger = "true";
    remove.textContent = "删除";
    remove.disabled = design.pages.length === 1;
    remove.title = design.pages.length === 1 ? "设计文件必须保留至少一页" : `删除 ${page.name}`;
    remove.addEventListener("click", () => deleteDesignPage(page.id));

    row.append(dot, name, count, open, remove);
    elements.pagesList.append(row);
  }
  elements.addPageDialog.disabled = design.pages.length >= MAX_DESIGN_PAGES;
}

function renderAll() {
  renderPages();
  renderScene();
  renderProperties();
  renderLayers();
  renderTokens();
  renderAuditStatus();
  elements.zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  elements.grid.style.display = showGrid ? "" : "none";
  elements.toggleGrid.classList.toggle("active", showGrid);
  elements.toggleGrid.setAttribute("aria-pressed", String(showGrid));
  elements.toggleSnap.classList.toggle("active", snapEnabled);
  elements.toggleSnap.setAttribute("aria-pressed", String(snapEnabled));
  updateCursor();
}

function validHex(value) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function setActiveTool(tool) {
  activeTool = tool;
  for (const button of document.querySelectorAll("[data-tool]")) {
    const active = button.dataset.tool === tool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  updateCursor();
}

function updateCursor() {
  const panning = interaction?.kind === "pan";
  elements.stage.dataset.cursor = panning
    ? "grabbing"
    : activeTool === "hand" || spacePressed
      ? "grab"
      : activeTool === "select"
        ? "select"
        : "crosshair";
}

function documentPoint(event) {
  const rect = elements.stage.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - pan.x) / zoom,
    y: (event.clientY - rect.top - pan.y) / zoom,
  };
}

function pointerDown(event) {
  if (event.button !== 0 && event.button !== 1) return;
  const point = documentPoint(event);
  const handle = event.target.closest?.("[data-handle]")?.dataset.handle;
  const targetId = event.target.closest?.("[data-node-id]")?.dataset.nodeId;
  const shouldPan = activeTool === "hand" || spacePressed || event.button === 1;

  if (shouldPan) {
    interaction = {
      kind: "pan",
      startClient: { x: event.clientX, y: event.clientY },
      startPan: { ...pan },
    };
  } else if (handle && selectedNodes().length === 1 && selectedNode()) {
    const node = selectedNode();
    interaction = {
      kind: "resize",
      handle,
      start: point,
      bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
    };
  } else if (activeTool === "select") {
    if (!targetId) {
      const additive = event.shiftKey;
      const baselineIds = additive ? new Set(selectedIds) : new Set();
      if (!additive) clearSelection();
      interaction = {
        kind: "marquee",
        start: point,
        current: point,
        baselineIds,
      };
      renderAll();
    } else if (event.shiftKey) {
      toggleSelection(targetId);
      renderAll();
      return;
    } else {
      if (!selectedIds.has(targetId)) selectOnly(targetId);
      const node = design.nodes.find((candidate) => candidate.id === targetId);
      const movableNodes = selectedTransformNodes();
      if (node && !isEffectivelyLocked(node) && movableNodes.length > 0) {
        const movingIds = new Set(movableNodes.map((candidate) => candidate.id));
        interaction = {
          kind: "move",
          start: point,
          bounds: visualSelectionBounds(movableNodes, design.nodes),
          origins: new Map(
            movableNodes.map((candidate) => [candidate.id, { x: candidate.x, y: candidate.y }]),
          ),
          movingIds,
          inheritsRotation: movableNodes.some(
            (candidate) => inheritedNodeRotation(design.nodes, candidate, movingIds) !== 0,
          ),
          moved: false,
          guides: [],
        };
      }
      renderAll();
    }
  } else {
    if (!canAddNodes(1)) return;
    const parent = activeTool === "frame" ? null : containingFrame(point);
    const localPoint = pointToParentSpace(point, parent) ?? point;
    const origin = snapPoint(localPoint, event.altKey);
    const node = baseNode(activeTool, {
      x: round(origin.x),
      y: round(origin.y),
      width: activeTool === "text" ? 240 : 1,
      height: activeTool === "text" ? 54 : 1,
      ...(parent ? { parentId: parent.id } : {}),
    });
    design.nodes.push(node);
    if (parent) normalizeNodeTreeOrder(design.nodes);
    if (activeTool === "text") {
      node.text = "输入文字";
      reflowParent(node);
      selectOnly(node.id);
      setActiveTool("select");
      commitHistory();
      markChanged();
      requestAnimationFrame(() => {
        propertyInputs.text.focus();
        propertyInputs.text.select();
      });
      return;
    }
    selectOnly(node.id);
    interaction = {
      kind: "create",
      start: origin,
      nodeId: node.id,
      tool: activeTool,
    };
    renderAll();
  }
  elements.stage.setPointerCapture(event.pointerId);
  updateCursor();
}

function pointerMove(event) {
  if (!interaction) return;
  const point = documentPoint(event);
  if (interaction.kind === "pan") {
    pan.x = interaction.startPan.x + event.clientX - interaction.startClient.x;
    pan.y = interaction.startPan.y + event.clientY - interaction.startClient.y;
    renderScene();
    return;
  }
  if (interaction.kind === "marquee") {
    interaction.current = point;
    const left = Math.min(interaction.start.x, point.x);
    const top = Math.min(interaction.start.y, point.y);
    const right = Math.max(interaction.start.x, point.x);
    const bottom = Math.max(interaction.start.y, point.y);
    const enclosed = design.nodes
      .filter((node) => {
        if (!isEffectivelyVisible(node)) return false;
        const bounds = transformedNodeBoundsInTree(design.nodes, node);
        return (
          bounds &&
          bounds.x >= left &&
          bounds.x + bounds.width <= right &&
          bounds.y >= top &&
          bounds.y + bounds.height <= bottom
        );
      })
      .map((node) => node.id);
    selectedIds = new Set([...interaction.baselineIds, ...enclosed]);
    selectedId = enclosed.at(-1) ?? [...selectedIds].at(-1) ?? null;
    renderAll();
    return;
  }
  if (interaction.kind === "move") {
    const anchorOrigin =
      interaction.origins.get(selectedId) ?? interaction.origins.values().next().value;
    let deltaX = point.x - interaction.start.x;
    let deltaY = point.y - interaction.start.y;
    if (snapEnabled && !event.altKey && anchorOrigin && !interaction.inheritsRotation) {
      deltaX = snapValue(anchorOrigin.x + deltaX) - anchorOrigin.x;
      deltaY = snapValue(anchorOrigin.y + deltaY) - anchorOrigin.y;
    }
    if (snapEnabled && !event.altKey && interaction.bounds && !interaction.inheritsRotation) {
      const stationaryNodes = design.nodes.filter(
        (node) => !interaction.origins.has(node.id) && isEffectivelyVisible(node),
      );
      const stationaryBounds = stationaryNodes.map((node) => ({
        ...transformedNodeBoundsInTree(design.nodes, node),
        id: node.id,
      }));
      const snapped = snapBoundsToNodes(
        interaction.bounds,
        stationaryBounds,
        { x: deltaX, y: deltaY },
        6 / zoom,
      );
      deltaX = snapped.x;
      deltaY = snapped.y;
      interaction.guides = snapped.guides;
    } else {
      interaction.guides = [];
    }
    for (const [nodeId, origin] of interaction.origins) {
      const node = nodeById(nodeId);
      if (!node) continue;
      const nodeDelta = visualDeltaForNode(node, { x: deltaX, y: deltaY }, interaction.movingIds);
      node.x = round(origin.x + nodeDelta.x);
      node.y = round(origin.y + nodeDelta.y);
    }
    interaction.moved =
      interaction.moved ||
      Math.abs(point.x - interaction.start.x) > 0.2 ||
      Math.abs(point.y - interaction.start.y) > 0.2;
  } else if (interaction.kind === "create") {
    const node = selectedNode();
    if (!node) return;
    const parent = node.parentId ? nodeById(node.parentId) : null;
    const localPoint = pointToParentSpace(point, parent) ?? point;
    const snapped = snapPoint(localPoint, event.altKey);
    let endX = snapped.x;
    let endY = snapped.y;
    if (event.shiftKey) {
      const size = Math.max(
        Math.abs(endX - interaction.start.x),
        Math.abs(endY - interaction.start.y),
      );
      endX = interaction.start.x + (endX < interaction.start.x ? -size : size);
      endY = interaction.start.y + (endY < interaction.start.y ? -size : size);
    }
    node.x = round(Math.min(endX, interaction.start.x));
    node.y = round(Math.min(endY, interaction.start.y));
    node.width = round(Math.max(1, Math.abs(endX - interaction.start.x)));
    node.height = round(Math.max(1, Math.abs(endY - interaction.start.y)));
  } else if (interaction.kind === "resize") {
    const node = selectedNode();
    if (!node) return;
    resizeNode(node, snapPoint(point, event.altKey), interaction, event.shiftKey);
  }
  updateDirtyState();
  renderScene();
  renderProperties();
}

function resizeNode(node, point, state, preserveAspect) {
  const minimum = 4;
  const right = state.bounds.x + state.bounds.width;
  const bottom = state.bounds.y + state.bounds.height;
  if (preserveAspect) {
    const anchorX = state.handle.includes("w") ? right : state.bounds.x;
    const anchorY = state.handle.includes("n") ? bottom : state.bounds.y;
    const directionX = state.handle.includes("w") ? -1 : 1;
    const directionY = state.handle.includes("n") ? -1 : 1;
    const aspect = state.bounds.width / state.bounds.height;
    let width = Math.max(minimum, Math.abs(point.x - anchorX));
    let height = Math.max(minimum, Math.abs(point.y - anchorY));
    if (width / height > aspect) height = width / aspect;
    else width = height * aspect;
    node.width = round(width);
    node.height = round(height);
    node.x = round(directionX < 0 ? anchorX - width : anchorX);
    node.y = round(directionY < 0 ? anchorY - height : anchorY);
    return;
  }
  if (state.handle.includes("w")) {
    node.x = round(Math.min(point.x, right - minimum));
    node.width = round(Math.max(minimum, right - point.x));
  }
  if (state.handle.includes("e")) {
    node.width = round(Math.max(minimum, point.x - state.bounds.x));
  }
  if (state.handle.includes("n")) {
    node.y = round(Math.min(point.y, bottom - minimum));
    node.height = round(Math.max(minimum, bottom - point.y));
  }
  if (state.handle.includes("s")) {
    node.height = round(Math.max(minimum, point.y - state.bounds.y));
  }
}

function finishInteraction(pointerId = null) {
  if (!interaction) return;
  const finished = interaction;
  interaction = null;
  if (Number.isInteger(pointerId) && elements.stage.hasPointerCapture(pointerId)) {
    elements.stage.releasePointerCapture(pointerId);
  }
  const node = selectedNode();
  if (finished.kind === "create" && node && (node.width < 4 || node.height < 4)) {
    node.width = finished.tool === "frame" ? 390 : 160;
    node.height = finished.tool === "frame" ? 260 : 120;
  }
  const changed =
    finished.kind === "create" ||
    finished.kind === "resize" ||
    (finished.kind === "move" && finished.moved);
  if (changed) {
    if (node) {
      reflowParent(node);
      if (isContainerNode(node)) applyAutoLayouts(design.nodes, new Set([node.id]));
    }
    commitHistory();
    markChanged(false);
  }
  if (finished.kind === "create") setActiveTool("select");
  renderAll();
}

function pointerUp(event) {
  finishInteraction(event.pointerId);
}

function duplicateSelected() {
  if (selectedIds.size === 0) return;
  const sourceIds = new Set([
    ...selectedIds,
    ...descendantIds(
      design.nodes,
      new Set(
        selectedNodes()
          .filter((node) => isContainerNode(node))
          .map((node) => node.id),
      ),
    ),
  ]);
  const sources = design.nodes.filter((node) => sourceIds.has(node.id));
  if (!canAddNodes(sources.length)) return;
  const previousDesign = clone(design);
  const previousSelectedId = selectedId;
  const previousSelectedIds = new Set(selectedIds);
  const { copies, idMap } = cloneNodeSet(sources, selectedIds);
  design.nodes.push(...copies);
  normalizeNodeTreeOrder(design.nodes);
  applyAutoLayouts(design.nodes, new Set(copies.map((node) => node.parentId).filter(Boolean)));
  if (!keepValidStructuralMutation(previousDesign, previousSelectedId, previousSelectedIds)) {
    renderAll();
    return;
  }
  selectedIds = new Set([...selectedIds].map((id) => idMap.get(id)));
  selectedId = [...selectedIds].at(-1) ?? null;
  commitHistory();
  markChanged();
}

function cloneNodeSet(sources, sourceSelectionIds) {
  const idMap = new Map(
    sources.map((node, index) => [
      node.id,
      `${node.type}-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    ]),
  );
  const copies = sources.map((source) => {
    const copy = clone(source);
    copy.id = idMap.get(source.id);
    if (sourceSelectionIds.has(source.id)) copy.name = `${copy.name} 副本`;
    copy.x += 18;
    copy.y += 18;
    if (copy.parentId && idMap.has(copy.parentId)) copy.parentId = idMap.get(copy.parentId);
    if (copy.componentId && idMap.has(copy.componentId)) {
      copy.componentId = idMap.get(copy.componentId);
    }
    return copy;
  });
  return { copies, idMap };
}

function copySelected() {
  if (selectedIds.size === 0) return;
  const sourceIds = new Set([
    ...selectedIds,
    ...descendantIds(
      design.nodes,
      new Set(
        selectedNodes()
          .filter((node) => isContainerNode(node))
          .map((node) => node.id),
      ),
    ),
  ]);
  copiedNodes = clone(design.nodes.filter((node) => sourceIds.has(node.id)));
  copiedSelectionIds = new Set(selectedIds);
  copiedDocumentEpoch = documentEpoch;
  rememberClipboardParents(copiedNodes);
  notify(
    selectedIds.size === 1 ? `已复制 ${selectedNode().name}` : `已复制 ${selectedIds.size} 个图层`,
  );
}

function rememberClipboardParents(nodes) {
  const copiedIds = new Set(nodes.map((node) => node.id));
  copiedParentFrames = new Map();
  for (const node of nodes) {
    let parentId = node.parentId;
    while (parentId && !copiedIds.has(parentId)) {
      const parent = nodeById(parentId);
      if (!isContainerNode(parent)) break;
      if (!copiedParentFrames.has(parent.id)) {
        copiedParentFrames.set(parent.id, clone(parent));
      }
      parentId = parent.parentId;
    }
  }
}

function pasteCopied() {
  if (copiedNodes.length === 0) return;
  if (!canAddNodes(copiedNodes.length)) return;
  const { copies, idMap } = cloneNodeSet(copiedNodes, copiedSelectionIds);
  const availableComponentIds = new Set([
    ...allDesignNodes()
      .filter((node) => node.type === "component")
      .map((node) => node.id),
    ...copies.filter((node) => node.type === "component").map((node) => node.id),
  ]);
  const missingComponentIds = [
    ...new Set(
      copies
        .filter((node) => node.type === "instance" && !availableComponentIds.has(node.componentId))
        .map((node) => node.componentId),
    ),
  ];
  if (missingComponentIds.length > 0) {
    notify(
      `无法粘贴：目标设计缺少主组件 ${missingComponentIds.join("、")}；请先复制主组件`,
      "error",
    );
    return;
  }
  const previousDesign = clone(design);
  const previousSelectedId = selectedId;
  const previousSelectedIds = new Set(selectedIds);
  const pastedFrameIds = new Set(
    copies.filter((node) => isContainerNode(node)).map((node) => node.id),
  );
  const availableFrameIds = new Set([
    ...design.nodes.filter((node) => isContainerNode(node)).map((node) => node.id),
    ...pastedFrameIds,
  ]);
  const crossDocument = copiedDocumentEpoch !== documentEpoch;
  const clipboardHierarchy = [...copiedParentFrames.values(), ...copies];
  let detached = 0;
  for (const copy of copies) {
    if (
      copy.parentId &&
      (!availableFrameIds.has(copy.parentId) ||
        (crossDocument && !pastedFrameIds.has(copy.parentId)))
    ) {
      if (copiedParentFrames.has(copy.parentId)) {
        if (!reparentNode(clipboardHierarchy, copy.id, null)) delete copy.parentId;
      } else {
        delete copy.parentId;
      }
      detached += 1;
    }
  }
  design.nodes.push(...copies);
  normalizeNodeTreeOrder(design.nodes);
  applyAutoLayouts(design.nodes, new Set(copies.map((node) => node.parentId).filter(Boolean)));
  if (!keepValidStructuralMutation(previousDesign, previousSelectedId, previousSelectedIds)) {
    renderAll();
    return;
  }
  selectedIds = new Set([...copiedSelectionIds].map((id) => idMap.get(id)));
  selectedId = [...selectedIds].at(-1) ?? null;
  copiedNodes = clone(copies);
  copiedSelectionIds = new Set(selectedIds);
  copiedDocumentEpoch = documentEpoch;
  rememberClipboardParents(copiedNodes);
  commitHistory();
  markChanged();
  if (detached > 0) notify(`${detached} 个图层已脱离原文件中的画板`);
}

function deleteSelected() {
  const deletableRootIds = new Set(
    selectedNodes()
      .filter((node) => !isEffectivelyLocked(node))
      .map((node) => node.id),
  );
  syncActivePageNodes();
  const deletableIds = new Set(designNodeRemovalIds(design, design.activePageId, deletableRootIds));
  if (deletableIds.size === 0) return;
  for (const page of design.pages) {
    const affectedParents = new Set(
      page.nodes
        .filter((candidate) => deletableIds.has(candidate.id) && candidate.parentId)
        .map((candidate) => candidate.parentId),
    );
    page.nodes = page.nodes.filter((candidate) => !deletableIds.has(candidate.id));
    applyAutoLayouts(page.nodes, affectedParents);
  }
  design.nodes = activeDesignPage()?.nodes ?? [];
  selectedIds = new Set([...selectedIds].filter((id) => !deletableIds.has(id)));
  selectedId = [...selectedIds].at(-1) ?? null;
  commitHistory();
  markChanged();
}

function frameSelectedNodes() {
  const nodes = selectedNodes();
  if (nodes.length === 0) return;
  if (nodes.some((node) => isContainerNode(node))) {
    notify("装入新画板目前只支持普通图层", "error");
    return;
  }
  if (nodes.some((node) => node.parentId)) {
    notify("新画板必须位于根级；请先释放原容器或把图层移到画布", "error");
    return;
  }
  if (nodes.some((node) => isEffectivelyLocked(node))) {
    notify("请先解锁所选图层", "error");
    return;
  }
  if (!canAddNodes(1)) return;
  ensureDesignV3();
  const frame = baseNode("frame", {
    name: "Selection frame",
    cornerRadius: 16,
    fill: "#ffffff",
    stroke: "#d7d7d1",
    strokeWidth: 1,
  });
  if (!wrapNodesInFrame(design.nodes, selectedIds, frame)) return;
  selectOnly(frame.id);
  commitHistory();
  markChanged();
}

function groupSelectedNodes() {
  const nodes = selectedNodes();
  if (nodes.length === 0) return;
  if (nodes.some((node) => isContainerNode(node) || node.parentId)) {
    notify("编组目前只支持画布上的普通图层", "error");
    return;
  }
  if (nodes.some((node) => isEffectivelyLocked(node))) {
    notify("请先解锁所选图层", "error");
    return;
  }
  if (!canAddNodes(1)) return;
  ensureDesignV3();
  const group = baseNode("group", {
    name: "图层组",
    cornerRadius: 0,
    fill: "transparent",
    padding: 0,
  });
  if (!wrapNodesInFrame(design.nodes, selectedIds, group, 0)) return;
  selectOnly(group.id);
  commitHistory();
  markChanged();
}

function makeSelectedComponent() {
  const frame = selectedNode();
  if (!frame || selectedIds.size !== 1 || frame.type !== "frame") {
    return notify("请先选择一个画板");
  }
  if (frame.locked) return notify("请先解锁画板", "error");
  ensureDesignV3();
  const previousDesign = clone(design);
  const previousSelectedId = selectedId;
  const previousSelectedIds = new Set(selectedIds);
  frame.type = "component";
  frame.name = frame.name.endsWith(" · 组件") ? frame.name : `${frame.name} · 组件`;
  if (!keepValidStructuralMutation(previousDesign, previousSelectedId, previousSelectedIds)) {
    renderAll();
    return;
  }
  commitHistory();
  markChanged();
  notify("已创建主组件；修改它会同步到所有实例");
}

function createSelectedComponentInstance() {
  const component = selectedNode();
  if (!component || selectedIds.size !== 1 || component.type !== "component") {
    return notify("请先选择一个主组件");
  }
  if (!canAddNodes(1)) return;
  ensureDesignV3();
  const previousDesign = clone(design);
  const previousSelectedId = selectedId;
  const previousSelectedIds = new Set(selectedIds);
  const id = `instance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const instance = createComponentInstance(component, id, 32, design.canvas);
  if (!instance) return;
  design.nodes.push(instance);
  normalizeNodeTreeOrder(design.nodes);
  if (!keepValidStructuralMutation(previousDesign, previousSelectedId, previousSelectedIds)) {
    renderAll();
    return;
  }
  selectOnly(instance.id);
  commitHistory();
  markChanged();
  notify(`已创建 ${component.name} 的实例`);
  requestAnimationFrame(fitSelection);
}

function releaseSelectedFrame() {
  const frame = selectedNode();
  if (!frame || selectedIds.size !== 1 || !["frame", "group"].includes(frame.type)) return;
  if (frame.locked) return notify("请先解锁容器", "error");
  const parentId = frame.parentId ?? null;
  const childIds = design.nodes.filter((node) => node.parentId === frame.id).map((node) => node.id);
  if (!releaseFrame(design.nodes, frame.id)) return;
  if (parentId) applyAutoLayouts(design.nodes, new Set([parentId]));
  selectedIds = new Set(childIds);
  selectedId = childIds.at(-1) ?? null;
  commitHistory();
  markChanged();
}

function setOrder(direction) {
  if (!moveSelectedNodes(design.nodes, selectedIds, direction)) return;
  applyAutoLayouts(
    design.nodes,
    new Set(
      selectedNodes()
        .map((node) => node.parentId)
        .filter(Boolean),
    ),
  );
  commitHistory();
  markChanged();
}

function alignSelected(alignment) {
  const ids = new Set(selectedPositionMutableNodes().map((node) => node.id));
  if (!alignNodeTrees(design.nodes, ids, alignment, design.canvas)) return;
  commitHistory();
  markChanged();
}

function distributeSelected(axis) {
  const ids = new Set(selectedPositionMutableNodes().map((node) => node.id));
  const rootCount = [...ids].filter((id) => {
    const node = nodeById(id);
    return node && (!node.parentId || !ids.has(node.parentId));
  }).length;
  if (rootCount < 3) return notify("等距分布至少需要 3 个独立的未锁定图层");
  if (!distributeNodeTrees(design.nodes, ids, axis)) return;
  commitHistory();
  markChanged();
}

function setZoom(next, focalClient) {
  const nextZoom = clamp(next, 0.1, 4);
  const rect = elements.stage.getBoundingClientRect();
  const focal = focalClient ?? {
    x: rect.left + elements.stage.clientWidth / 2,
    y: rect.top + elements.stage.clientHeight / 2,
  };
  const documentX = (focal.x - rect.left - pan.x) / zoom;
  const documentY = (focal.y - rect.top - pan.y) / zoom;
  pan.x = focal.x - rect.left - documentX * nextZoom;
  pan.y = focal.y - rect.top - documentY * nextZoom;
  zoom = nextZoom;
  renderAll();
}

function fitCanvas() {
  const padding = 62;
  const width = Math.max(100, elements.stage.clientWidth - padding * 2);
  const height = Math.max(100, elements.stage.clientHeight - padding * 2);
  zoom = clamp(Math.min(width / design.canvas.width, height / design.canvas.height), 0.1, 2);
  pan.x = (elements.stage.clientWidth - design.canvas.width * zoom) / 2;
  pan.y = (elements.stage.clientHeight - design.canvas.height * zoom) / 2;
  renderAll();
}

function fitSelection() {
  const bounds = visualSelectionBounds(selectedNodes(), design.nodes);
  if (!bounds) {
    fitCanvas();
    return;
  }
  const padding = 96;
  const width = Math.max(100, elements.stage.clientWidth - padding * 2);
  const height = Math.max(100, elements.stage.clientHeight - padding * 2);
  zoom = clamp(
    Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height)),
    0.1,
    4,
  );
  pan.x = elements.stage.clientWidth / 2 - (bounds.x + bounds.width / 2) * zoom;
  pan.y = elements.stage.clientHeight / 2 - (bounds.y + bounds.height / 2) * zoom;
  renderAll();
}

function normalizeDocument(input) {
  return Array.isArray(input?.nodes) ? normalizeDesignState(input) : normalizeDesignDocument(input);
}

function safeDesignPath(value) {
  return isSafeDesignPath(value);
}

function mockHostCall(method, params = {}) {
  const prefix = "codeshell-design-studio:";
  if (method === "storage.get") {
    return Promise.resolve(
      JSON.parse(localStorage.getItem(`${prefix}storage:${params.key}`) || "null"),
    );
  }
  if (method === "storage.set") {
    localStorage.setItem(`${prefix}storage:${params.key}`, JSON.stringify(params.value));
    return Promise.resolve(true);
  }
  if (method === "storage.delete") {
    localStorage.removeItem(`${prefix}storage:${params.key}`);
    return Promise.resolve(true);
  }
  if (method === "workspace.info") {
    return Promise.resolve({
      name: "codeshell",
      root: "/preview/codeshell",
      trusted: true,
      gitBranch: "preview",
    });
  }
  if (method === "workspace.list") {
    const entriesByPath = new Map();
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(`${prefix}file:`)) continue;
      const path = key.slice(`${prefix}file:`.length);
      if (!path.startsWith(`${params.path}/`)) continue;
      const remainder = path.slice(`${params.path}/`.length);
      if (remainder.includes("/")) {
        const directoryName = remainder.split("/")[0];
        const directoryPath = `${params.path}/${directoryName}`;
        entriesByPath.set(directoryPath, {
          name: directoryName,
          path: directoryPath,
          kind: "directory",
        });
        continue;
      }
      const content = localStorage.getItem(key) || "";
      entriesByPath.set(path, {
        name: path.split("/").pop(),
        path,
        kind: "file",
        size: content.length,
        modifiedAt: Date.now(),
      });
    }
    return Promise.resolve({
      path: params.path,
      entries: [...entriesByPath.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      truncated: false,
    });
  }
  if (method === "workspace.readText") {
    const content = localStorage.getItem(`${prefix}file:${params.path}`);
    if (content == null) return Promise.reject(new Error("file not found"));
    const modifiedAt = Number(localStorage.getItem(`${prefix}mtime:${params.path}`)) || Date.now();
    return Promise.resolve({
      path: params.path,
      content,
      size: content.length,
      modifiedAt,
      revision: `preview:${modifiedAt}`,
    });
  }
  if (method === "workspace.writeText") {
    const modifiedAt = Date.now();
    localStorage.setItem(`${prefix}file:${params.path}`, params.content);
    localStorage.setItem(`${prefix}mtime:${params.path}`, String(modifiedAt));
    return Promise.resolve({
      path: params.path,
      size: params.content.length,
      modifiedAt,
      revision: `preview:${modifiedAt}`,
    });
  }
  if (method === "agent.submitPrompt") {
    return Promise.resolve({ accepted: true });
  }
  return Promise.resolve(null);
}

function hostCall(method, params) {
  if (window.codeshellPanel?.call) return window.codeshellPanel.call(method, params);
  return mockHostCall(method, params);
}

function assertWorkspaceEpoch(expectedEpoch) {
  if (workspaceEpoch !== expectedEpoch) {
    throw new Error("工作区已在操作期间切换；旧操作已取消，请在当前仓库重试");
  }
}

async function writeRepoText(path, content, expectedWorkspaceEpoch = workspaceEpoch) {
  let expectedModifiedAt = null;
  let expectedRevision = null;
  try {
    const existing = await hostCall("workspace.readText", { path });
    expectedModifiedAt = existing.modifiedAt;
    expectedRevision = existing.revision;
  } catch {
    // A missing output is created; an unreadable existing output fails the host create-only guard.
  }
  assertWorkspaceEpoch(expectedWorkspaceEpoch);
  const result = await hostCall("workspace.writeText", {
    path,
    content,
    expectedModifiedAt,
    ...(expectedRevision ? { expectedRevision } : {}),
  });
  assertWorkspaceEpoch(expectedWorkspaceEpoch);
  return result;
}

function captureSaveDocument({ quiet = false } = {}) {
  const operationWorkspaceEpoch = workspaceEpoch;
  const operationWorkspaceIdentity = context.cwd ?? null;
  const operationWorkspaceRoot = operationWorkspaceIdentity ?? "preview";
  const path = elements.path.value.trim();
  if (!safeDesignPath(path)) {
    const message = "路径需位于 designs/，并以 .codesign.json 结尾";
    setSaveState("路径无效", "error");
    notify(message, "error");
    throw new Error(message);
  }
  let content;
  let savedDesign;
  try {
    design = normalizeDocument(design);
    assertDesignDocumentSize(design);
    savedDesign = clone(design);
    content = serializeDesign();
  } catch (error) {
    const message = error instanceof Error ? error.message : "设计文件无效";
    setSaveState(message.includes("KiB") ? "文件过大" : "设计无效", "error");
    notify(message, "error");
    throw error;
  }
  return {
    workspaceEpoch: operationWorkspaceEpoch,
    workspaceIdentity: operationWorkspaceIdentity,
    workspaceRoot: operationWorkspaceRoot,
    path,
    content,
    savedDesign,
    stateRevision: currentDesignStateRevision(),
    quiet,
  };
}

async function performSaveDocument(request) {
  const {
    workspaceEpoch: operationWorkspaceEpoch,
    workspaceIdentity: operationWorkspaceIdentity,
    workspaceRoot: operationWorkspaceRoot,
    path,
    content,
    savedDesign,
    quiet,
  } = request;
  assertWorkspaceEpoch(operationWorkspaceEpoch);
  clearTimeout(recoveryTimer);
  elements.save.disabled = true;
  elements.path.disabled = true;
  setSaveState("保存中…", "idle");
  try {
    const replacesCurrentSource = path === currentSourcePath;
    const result = await hostCall("workspace.writeText", {
      path,
      content,
      expectedModifiedAt: replacesCurrentSource ? currentModifiedAt : null,
      ...(replacesCurrentSource && currentRevision ? { expectedRevision: currentRevision } : {}),
    });
    assertWorkspaceEpoch(operationWorkspaceEpoch);
    fileDiscoveryCache = null;
    recoveryFailureWarned = false;
    const stillTargetsSavedPath = elements.path.value.trim() === path;
    if (stillTargetsSavedPath) {
      currentModifiedAt = result.modifiedAt;
      currentRevision = result.revision;
      warnedExternalVersion = null;
      currentSourcePath = path;
      currentSourceModifiedAt = result.modifiedAt;
      currentSourceRevision = result.revision;
      savedSnapshot = content;
      updateDirtyState();
      setRepoLinkState("Repo · 已保存", "linked");
      await hostCall("storage.set", {
        key: scopedStorageKey("lastPath", operationWorkspaceRoot),
        value: { workspaceRoot: operationWorkspaceIdentity, path },
      }).catch(() => undefined);
      assertWorkspaceEpoch(operationWorkspaceEpoch);
      if (dirty) queueRecovery();
      else
        await hostCall("storage.delete", {
          key: scopedStorageKey("recovery", operationWorkspaceRoot),
        }).catch(() => undefined);
      assertWorkspaceEpoch(operationWorkspaceEpoch);
    } else {
      updateDirtyState();
      setSaveState(dirty ? "有修改" : "另存为", dirty ? "dirty" : "idle");
    }
    if (!quiet) notify(`已保存到 ${path}`);
    void refreshRepoFilesPanel({ force: true });
    return { ...result, design: savedDesign };
  } catch (error) {
    if (workspaceEpoch !== operationWorkspaceEpoch) throw error;
    const message = error instanceof Error ? error.message : "保存失败";
    queueRecovery();
    setSaveState("保存失败", "error");
    notify(
      message.includes("changed since")
        ? "文件已在面板外变化。请重新打开，或改一个文件名保存副本。"
        : message,
      "error",
    );
    throw error;
  } finally {
    if (workspaceEpoch === operationWorkspaceEpoch) {
      elements.save.disabled = context.trusted !== true;
      elements.path.disabled = false;
    }
  }
}

function saveDocument(options = {}) {
  let request;
  try {
    request = captureSaveDocument(options);
  } catch (error) {
    return Promise.reject(error);
  }
  const pending = saveInFlight?.workspaceEpoch === workspaceEpoch ? saveInFlight : null;
  if (pending && pending.path === request.path && pending.stateRevision === request.stateRevision) {
    return pending.operation;
  }
  const performCapturedSave = () => performSaveDocument(request);
  const operation = pending
    ? pending.operation.then(performCapturedSave, performCapturedSave)
    : performCapturedSave();
  const entry = {
    workspaceEpoch: request.workspaceEpoch,
    path: request.path,
    stateRevision: request.stateRevision,
    operation,
  };
  saveInFlight = entry;
  const clearInFlight = () => {
    if (saveInFlight === entry) saveInFlight = null;
  };
  void operation.then(clearInFlight, clearInFlight);
  return operation;
}

async function settlePendingSaves() {
  let settledOperation = null;
  while (
    saveInFlight?.workspaceEpoch === workspaceEpoch &&
    saveInFlight.operation !== settledOperation
  ) {
    settledOperation = saveInFlight.operation;
    await settledOperation;
  }
}

async function openDocument(path, { discardChanges = false } = {}) {
  const operationWorkspaceEpoch = workspaceEpoch;
  await settlePendingSaves().catch(() => undefined);
  assertWorkspaceEpoch(operationWorkspaceEpoch);
  const operationWorkspaceIdentity = context.cwd ?? null;
  const operationWorkspaceRoot = operationWorkspaceIdentity ?? "preview";
  if (
    !discardChanges &&
    dirty &&
    !window.confirm("当前设计有未保存修改。确定要放弃这些修改并打开另一个文件吗？")
  ) {
    return false;
  }
  const operationStateRevision = currentDesignStateRevision();
  clearTimeout(recoveryTimer);
  setSaveState("打开中…", "idle");
  try {
    const result = await hostCall("workspace.readText", { path });
    assertWorkspaceEpoch(operationWorkspaceEpoch);
    if (currentDesignStateRevision() !== operationStateRevision) {
      throw new Error("画布在打开文件期间发生了变化；已保留较新的本地状态");
    }
    design = normalizeDocument(JSON.parse(result.content));
    documentEpoch += 1;
    clearSelection();
    currentModifiedAt = result.modifiedAt;
    currentRevision = result.revision;
    warnedExternalVersion = null;
    currentSourcePath = path;
    currentSourceModifiedAt = result.modifiedAt;
    currentSourceRevision = result.revision;
    elements.path.value = path;
    savedSnapshot = serializeDesign();
    resetHistory();
    updateDirtyState();
    setRepoLinkState("Repo · 已打开", "linked");
    renderAll();
    requestAnimationFrame(fitCanvas);
    await hostCall("storage.set", {
      key: scopedStorageKey("lastPath", operationWorkspaceRoot),
      value: { workspaceRoot: operationWorkspaceIdentity, path },
    }).catch(() => undefined);
    assertWorkspaceEpoch(operationWorkspaceEpoch);
    await hostCall("storage.delete", {
      key: scopedStorageKey("recovery", operationWorkspaceRoot),
    }).catch(() => undefined);
    assertWorkspaceEpoch(operationWorkspaceEpoch);
    notify(`已打开 ${path}`);
    void refreshRepoFilesPanel();
    return true;
  } catch (error) {
    if (workspaceEpoch !== operationWorkspaceEpoch) throw error;
    const message = error instanceof Error ? error.message : "打开失败";
    if (dirty && !discardChanges) queueRecovery();
    setSaveState("打开失败", "error");
    notify(message, "error");
    throw error;
  }
}

async function checkExternalChange({ force = false } = {}) {
  if (
    !currentSourcePath ||
    elements.path.value.trim() !== currentSourcePath ||
    checkingExternalChange
  ) {
    return false;
  }
  const operationWorkspaceEpoch = workspaceEpoch;
  const operationDocumentEpoch = documentEpoch;
  const operationStateRevision = currentDesignStateRevision();
  const sourcePath = currentSourcePath;
  const sourceRevision = currentSourceRevision;
  const sourceModifiedAt = currentSourceModifiedAt;
  const now = Date.now();
  if (!force && now - lastExternalCheckAt < 1_500) return false;
  checkingExternalChange = true;
  lastExternalCheckAt = now;
  try {
    const disk = await hostCall("workspace.readText", { path: sourcePath });
    assertWorkspaceEpoch(operationWorkspaceEpoch);
    if (
      operationDocumentEpoch !== documentEpoch ||
      currentSourcePath !== sourcePath ||
      currentSourceRevision !== sourceRevision ||
      currentSourceModifiedAt !== sourceModifiedAt ||
      currentDesignStateRevision() !== operationStateRevision
    ) {
      return false;
    }
    const changed =
      sourceRevision && disk.revision
        ? sourceRevision !== disk.revision
        : sourceModifiedAt != null && Math.abs(sourceModifiedAt - disk.modifiedAt) > 0.001;
    if (!changed) {
      const hadExternalWarning = Boolean(warnedExternalVersion);
      warnedExternalVersion = null;
      if (hadExternalWarning) updateDirtyState();
      return false;
    }
    const externalVersion = disk.revision ?? `mtime:${disk.modifiedAt}`;
    if (!dirty) {
      try {
        const nextDesign = normalizeDocument(JSON.parse(disk.content));
        assertWorkspaceEpoch(operationWorkspaceEpoch);
        if (
          operationDocumentEpoch !== documentEpoch ||
          currentSourcePath !== sourcePath ||
          currentSourceRevision !== sourceRevision ||
          currentSourceModifiedAt !== sourceModifiedAt ||
          currentDesignStateRevision() !== operationStateRevision
        ) {
          return false;
        }
        design = nextDesign;
        documentEpoch += 1;
        clearSelection();
        currentModifiedAt = disk.modifiedAt;
        currentRevision = disk.revision;
        currentSourceModifiedAt = disk.modifiedAt;
        currentSourceRevision = disk.revision;
        warnedExternalVersion = null;
        savedSnapshot = serializeDesign();
        resetHistory();
        updateDirtyState();
        renderAll();
        setRepoLinkState("Repo 已同步", "linked");
        notify(`已同步 Agent 对 ${sourcePath} 的修改`);
        return true;
      } catch (error) {
        warnedExternalVersion = externalVersion;
        setSaveState("Repo 文件无效", "error");
        notify(error instanceof Error ? error.message : "Repo 中的设计文件无效", "error");
        return true;
      }
    }
    if (warnedExternalVersion === externalVersion) return true;
    warnedExternalVersion = externalVersion;
    setSaveState(dirty ? "外部变更 · 本地有修改" : "源文件已在外部变更", "error");
    notify("源文件和本地画布都已变化。请从文件列表重新打开，或改名保存副本。", "error");
    return true;
  } catch {
    // A later explicit open or save surfaces missing/unreadable source details.
    return false;
  } finally {
    checkingExternalChange = false;
  }
}

async function discoverDesignFiles() {
  const operationWorkspaceEpoch = workspaceEpoch;
  const now = Date.now();
  if (fileDiscoveryCache && now - fileDiscoveryCachedAt < 3_000) {
    return fileDiscoveryCache;
  }
  const queue = ["designs"];
  const files = [];
  const maxDirectories = 16;
  const maxFiles = 200;
  let truncated = false;
  let processedDirectories = 0;
  for (
    let index = 0;
    index < queue.length && index < maxDirectories && files.length < maxFiles;
    index += 1
  ) {
    let listing;
    try {
      listing = await hostCall("workspace.list", { path: queue[index] });
    } catch {
      if (queue[index] === "designs") {
        fileDiscoveryCache = { files: [], truncated: false };
        fileDiscoveryCachedAt = Date.now();
        return fileDiscoveryCache;
      }
      truncated = true;
      continue;
    }
    processedDirectories += 1;
    assertWorkspaceEpoch(operationWorkspaceEpoch);
    if (listing?.truncated) truncated = true;
    for (const entry of listing?.entries ?? []) {
      if (entry.kind === "file" && entry.path.endsWith(".codesign.json")) {
        if (files.length < maxFiles) files.push(entry);
        else truncated = true;
      } else if (entry.kind === "directory" && !queue.includes(entry.path)) {
        queue.push(entry.path);
      }
    }
  }
  if (queue.length > maxDirectories || queue.length > processedDirectories) truncated = true;
  assertWorkspaceEpoch(operationWorkspaceEpoch);
  fileDiscoveryCache = {
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    truncated,
  };
  fileDiscoveryCachedAt = Date.now();
  return fileDiscoveryCache;
}

function repoFilesSummary(workspace, discovery) {
  const count = discovery.files.length;
  const repository = workspace?.name || "当前工作区";
  const branch = workspace?.gitBranch ? ` · ${workspace.gitBranch}` : "";
  const trust = workspace?.trusted === false ? " · 只读" : "";
  const truncated = discovery.truncated ? " · 仅显示部分文件" : "";
  return `${repository}${branch}${trust} · ${count} 个设计${truncated}`;
}

function renderDesignFileRows(container, files, { closeDialog = false } = {}) {
  container.replaceChildren();
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "files-empty";
    empty.textContent = "还没有设计文件。保存当前画布即可创建第一个。";
    container.append(empty);
    return;
  }
  const activePath = elements.path.value.trim();
  for (const file of files) {
    const active = file.path === activePath;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-row";
    button.dataset.active = String(active);
    button.role = "option";
    button.ariaSelected = String(active);
    if (active) button.setAttribute("aria-current", "page");
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = active ? "✓" : "D";
    const copy = document.createElement("span");
    copy.className = "file-copy";
    const name = document.createElement("strong");
    name.textContent = (file.name || file.path.split("/").at(-1)).replace(/\.codesign\.json$/u, "");
    const path = document.createElement("span");
    path.textContent = file.path;
    copy.append(name, path);
    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent = `${file.path === DEFAULT_PATH ? "默认 · " : ""}${formatBytes(Number(file.size) || 0)}`;
    button.append(icon, copy, size);
    button.addEventListener("click", () => {
      if (active) return;
      if (closeDialog && elements.filesDialog.open) elements.filesDialog.close();
      void openDocument(file.path)
        .then(() => refreshRepoFilesPanel())
        .catch(() => undefined);
    });
    container.append(button);
  }
}

async function loadDesignFileInventory({ force = false } = {}) {
  if (force) {
    fileDiscoveryCache = null;
    fileDiscoveryCachedAt = 0;
  }
  const operationWorkspaceEpoch = workspaceEpoch;
  const [workspace, discovery] = await Promise.all([
    hostCall("workspace.info", {}),
    discoverDesignFiles(),
  ]);
  assertWorkspaceEpoch(operationWorkspaceEpoch);
  return { workspace, discovery, summary: repoFilesSummary(workspace, discovery) };
}

async function refreshRepoFilesPanel({ force = false } = {}) {
  const operationWorkspaceEpoch = workspaceEpoch;
  elements.repoFilesSummary.textContent = "正在读取 Repo…";
  elements.repoFilesList.replaceChildren();
  try {
    const inventory = await loadDesignFileInventory({ force });
    if (workspaceEpoch !== operationWorkspaceEpoch) return;
    elements.repoFilesSummary.textContent = inventory.summary;
    renderDesignFileRows(elements.repoFilesList, inventory.discovery.files);
  } catch (error) {
    if (workspaceEpoch !== operationWorkspaceEpoch) return;
    elements.repoFilesSummary.textContent = "无法读取 Repo 设计文件";
    const empty = document.createElement("div");
    empty.className = "files-empty";
    empty.textContent = error instanceof Error ? error.message : "读取失败";
    elements.repoFilesList.replaceChildren(empty);
  }
}

async function showFiles() {
  const operationWorkspaceEpoch = workspaceEpoch;
  elements.filesList.replaceChildren();
  elements.workspaceSummary.textContent = "正在读取工作区…";
  elements.filesDialog.showModal();
  try {
    const inventory = await loadDesignFileInventory();
    assertWorkspaceEpoch(operationWorkspaceEpoch);
    elements.workspaceSummary.textContent = inventory.summary;
    renderDesignFileRows(elements.filesList, inventory.discovery.files, { closeDialog: true });
  } catch (error) {
    if (workspaceEpoch !== operationWorkspaceEpoch) {
      if (elements.filesDialog.open) elements.filesDialog.close();
      return;
    }
    elements.workspaceSummary.textContent = "无法读取工作区";
    const empty = document.createElement("div");
    empty.className = "files-empty";
    empty.textContent = error instanceof Error ? error.message : "读取失败";
    elements.filesList.replaceChildren(empty);
  }
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function setHtmlImportStatus(message, kind = "idle") {
  elements.htmlImportStatus.textContent = message;
  elements.htmlImportStatus.dataset.kind = kind;
}

async function replaceDesignWithHtmlImport(
  imported,
  { save = false, recordAgentTransaction = false, sourcePath } = {},
) {
  const nextDesign = normalizeDocument(imported);
  const previous = clone(design);
  const previousSnapshot = serializeDesign();
  const nextSnapshot = serializeDocument(nextDesign);
  if (nextSnapshot === previousSnapshot) {
    let savedResult = null;
    if (save) savedResult = await saveDocument({ quiet: true });
    return {
      path: elements.path.value.trim(),
      sourcePath,
      saved: save,
      noOp: true,
      transactionId: null,
      changedNodeIds: [],
      documentChanged: false,
      nodeCount: allDesignNodes().length,
      activePageNodeCount: design.nodes.length,
      revision: savedResult?.revision ?? currentRevision,
      stateRevision: currentDesignStateRevision(),
      audit: summarizeAudit(auditDocument()),
    };
  }

  const previousHistory = [...history];
  const previousHistoryIndex = historyIndex;
  const previousSelectedId = selectedId;
  const previousSelectedIds = new Set(selectedIds);
  const previousCollapsedLayerIds = new Set(collapsedLayerIds);
  const previousDocumentEpoch = documentEpoch;
  const previousDesignStateSequence = designStateSequence;
  const previousAgentTransaction = lastAgentTransaction;
  const changedNodeIds = new Set([
    ...allDesignNodes(previous).map((node) => node.id),
    ...allDesignNodes(nextDesign).map((node) => node.id),
  ]);

  design = nextDesign;
  documentEpoch += 1;
  clearSelection();
  collapsedLayerIds.clear();
  commitHistory();
  markChanged();
  let savedResult = null;
  if (save) {
    try {
      savedResult = await saveDocument({ quiet: true });
    } catch (error) {
      design = normalizeDesignState(previous);
      history = previousHistory;
      historyIndex = previousHistoryIndex;
      selectedId = previousSelectedId;
      selectedIds = previousSelectedIds;
      collapsedLayerIds.clear();
      for (const id of previousCollapsedLayerIds) collapsedLayerIds.add(id);
      documentEpoch = previousDocumentEpoch;
      designStateSequence = previousDesignStateSequence;
      lastAgentTransaction = previousAgentTransaction;
      markChanged();
      throw error;
    }
  }

  let transactionId = null;
  if (recordAgentTransaction) {
    transactionId = `design-tx-${Date.now().toString(36)}-${++agentTransactionSequence}`;
    lastAgentTransaction = {
      id: transactionId,
      previousSnapshot,
      previousSelectedId,
      previousSelectedIds: [...previousSelectedIds],
      resultSelectedId: null,
      resultSelectedIds: [],
      historyIndex,
      revision: currentRevision,
      stateRevision: currentDesignStateRevision(),
      changedNodeIds: [...changedNodeIds],
    };
  }
  requestAnimationFrame(fitCanvas);
  return {
    path: elements.path.value.trim(),
    sourcePath,
    saved: save,
    noOp: false,
    transactionId,
    changedNodeIds: [...changedNodeIds],
    documentChanged: true,
    nodeCount: allDesignNodes().length,
    activePageNodeCount: design.nodes.length,
    revision: savedResult?.revision ?? currentRevision,
    stateRevision: currentDesignStateRevision(),
    audit: summarizeAudit(auditDocument()),
  };
}

async function importHtmlFromWorkspace({
  sourcePath,
  rootSelector,
  viewportWidth,
  viewportHeight,
  save = false,
  expectedRevision,
  expectedStateRevision,
  recordAgentTransaction = false,
}) {
  if (!isSafeHtmlImportPath(sourcePath)) {
    throw new Error("HTML 路径必须是工作区内安全的相对 .html 文件");
  }
  if (typeof expectedStateRevision !== "string" || !expectedStateRevision) {
    throw new Error("HTML 导入必须基于当前设计状态");
  }
  if (expectedStateRevision !== currentDesignStateRevision()) {
    throw new Error("设计状态已变化；请重新读取后再导入 HTML");
  }
  if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
    throw new Error("设计 revision 已变化；请重新读取后再导入 HTML");
  }
  const operationWorkspaceEpoch = workspaceEpoch;
  const operationStateRevision = currentDesignStateRevision();
  const source = await hostCall("workspace.readText", { path: sourcePath });
  assertWorkspaceEpoch(operationWorkspaceEpoch);
  const captured = await captureWorkspaceHtml({
    sourcePath,
    html: source.content,
    readText: async (path) => {
      const result = await hostCall("workspace.readText", { path });
      assertWorkspaceEpoch(operationWorkspaceEpoch);
      return result;
    },
    rootSelector,
    viewportWidth,
    viewportHeight,
  });
  assertWorkspaceEpoch(operationWorkspaceEpoch);
  if (currentDesignStateRevision() !== operationStateRevision) {
    throw new Error("画布在 HTML 转换期间发生了变化；已保留较新的本地状态");
  }
  return replaceDesignWithHtmlImport(captured, {
    save,
    recordAgentTransaction,
    sourcePath,
  });
}

async function runHtmlImportFromDialog() {
  const sourcePath = elements.htmlImportPath.value.trim();
  const rootSelector = elements.htmlImportRoot.value.trim();
  const viewportWidth = Number(elements.htmlImportWidth.value);
  const viewportHeight = Number(elements.htmlImportHeight.value);
  if (dirty && !window.confirm("HTML 转换会替换当前画布。确定要保留撤销记录并继续吗？")) {
    return;
  }
  elements.runHtmlImport.disabled = true;
  elements.htmlImportDialog.setAttribute("aria-busy", "true");
  setHtmlImportStatus("正在读取 HTML、等待字体与布局稳定…");
  try {
    const result = await importHtmlFromWorkspace({
      sourcePath,
      rootSelector,
      viewportWidth,
      viewportHeight,
      save: false,
      expectedStateRevision: currentDesignStateRevision(),
    });
    elements.htmlImportDialog.close();
    const issueLabel =
      result.audit.issueCount > 0 ? `；检查发现 ${result.audit.issueCount} 个问题` : "";
    notify(
      `已从 ${sourcePath} 转换 ${result.nodeCount} 个图层${issueLabel}；请检查后保存`,
      result.audit.renderSafe ? "idle" : "error",
    );
  } catch (error) {
    setHtmlImportStatus(error instanceof Error ? error.message : "HTML 转换失败", "error");
  } finally {
    elements.runHtmlImport.disabled = context.trusted !== true;
    elements.htmlImportDialog.removeAttribute("aria-busy");
  }
}

function showAudit() {
  const issues = auditDocument();
  const summary = summarizeAudit(issues);
  const totalNodeCount = allDesignNodes().length;
  elements.auditSummary.textContent =
    issues.length === 0
      ? `未发现问题 · ${design.pages.length} 页 · ${totalNodeCount} 个图层`
      : `${summary.issueCount} 个问题 · ${summary.blockingIssueCount} 个阻塞 · ${summary.errorCount} 个错误 · ${summary.warningCount} 个警告`;
  elements.auditResults.replaceChildren();
  if (issues.length === 0) {
    const clean = document.createElement("div");
    clean.className = "audit-clean";
    clean.textContent = "✓ 结构与基础可访问性检查通过";
    elements.auditResults.append(clean);
  } else {
    for (const issue of issues.slice(0, MAX_AGENT_AUDIT_ISSUES)) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "audit-issue";
      item.dataset.severity = issue.severity;
      const dot = document.createElement("span");
      dot.className = "audit-issue-dot";
      const copy = document.createElement("span");
      copy.className = "audit-issue-copy";
      const name = document.createElement("strong");
      const issueNode = allDesignNodes().find((node) => node.id === issue.nodeId);
      name.textContent = `${issue.pageName ?? issue.pageId ?? "当前页"} · ${issueNode?.name ?? issue.nodeId}`;
      const message = document.createElement("span");
      message.className = "audit-issue-message";
      message.textContent = issue.message;
      const meta = document.createElement("span");
      meta.className = "audit-issue-meta";
      const code = document.createElement("code");
      code.textContent = issue.code;
      const status = document.createElement("span");
      status.className = "audit-issue-status";
      status.textContent = issue.blocking ? "阻塞渲染" : "需修复";
      meta.append(code, status);
      copy.append(name, message, meta);
      item.append(dot, copy);
      item.addEventListener("click", () => {
        const pageChanged =
          issue.pageId && issue.pageId !== design.activePageId
            ? activateDesignPage(issue.pageId)
            : false;
        selectOnly(issue.nodeId);
        elements.auditDialog.close();
        if (pageChanged) {
          commitHistory();
          markChanged();
          requestAnimationFrame(fitSelection);
        } else {
          renderAll();
        }
      });
      elements.auditResults.append(item);
    }
    if (issues.length > MAX_AGENT_AUDIT_ISSUES) {
      const truncated = document.createElement("div");
      truncated.className = "audit-truncated";
      truncated.textContent = `还有 ${issues.length - MAX_AGENT_AUDIT_ISSUES} 个问题未在本次列表中展开；修复后再次检查。`;
      elements.auditResults.append(truncated);
    }
  }
  elements.auditDialog.showModal();
}

async function saveAuditReport() {
  const operationWorkspaceEpoch = workspaceEpoch;
  const sourcePath = elements.path.value.trim();
  if (!safeDesignPath(sourcePath)) return notify("先设置有效的设计文件路径", "error");
  elements.saveAuditReport.disabled = true;
  try {
    const saved = await saveDocument({ quiet: true });
    assertWorkspaceEpoch(operationWorkspaceEpoch);
    const issues = auditDocument(saved.design);
    const path = sourcePath.replace(/\.codesign\.json$/, ".audit.md");
    await writeRepoText(
      path,
      auditMarkdown(saved.design, issues, sourcePath),
      operationWorkspaceEpoch,
    );
    elements.auditDialog.close();
    notify(`检查报告已保存到 ${path}`);
  } catch (error) {
    if (workspaceEpoch !== operationWorkspaceEpoch) return;
    notify(error instanceof Error ? error.message : "检查报告保存失败", "error");
  } finally {
    if (workspaceEpoch === operationWorkspaceEpoch) {
      elements.saveAuditReport.disabled = context.trusted !== true;
    }
  }
}

function newDocument() {
  if (dirty && !window.confirm("当前设计有未保存修改。确定要新建设计吗？")) return;
  design = createBlankDocument("Untitled");
  documentEpoch += 1;
  clearSelection();
  collapsedLayerIds.clear();
  currentModifiedAt = null;
  currentRevision = null;
  warnedExternalVersion = null;
  currentSourcePath = null;
  currentSourceModifiedAt = null;
  currentSourceRevision = null;
  elements.path.value = "designs/untitled.codesign.json";
  savedSnapshot = "";
  resetHistory();
  markChanged();
  elements.filesDialog.close();
  void refreshRepoFilesPanel();
  requestAnimationFrame(fitCanvas);
}

function nextPageIdentity() {
  const pageIds = new Set(design.pages.map((page) => page.id));
  const pageNames = new Set(design.pages.map((page) => page.name.toLocaleLowerCase()));
  let number = design.pages.length + 1;
  while (pageIds.has(`page-${number}`) || pageNames.has(`page ${number}`)) number += 1;
  return { id: `page-${number}`, name: `Page ${number}` };
}

function createDesignPage() {
  if (design.pages.length >= MAX_DESIGN_PAGES) {
    notify(`设计文件最多 ${MAX_DESIGN_PAGES} 页`, "error");
    return;
  }
  syncActivePageNodes();
  const page = { ...nextPageIdentity(), nodes: [] };
  design.pages.push(page);
  activateDesignPage(page.id);
  commitHistory();
  markChanged();
  if (elements.pagesDialog.open) renderPageManager();
  notify(`已新建 ${page.name}`);
  requestAnimationFrame(fitCanvas);
}

function deleteDesignPage(pageId) {
  if (design.pages.length === 1) {
    notify("设计文件必须保留至少一页", "error");
    return;
  }
  syncActivePageNodes();
  const pageIndex = design.pages.findIndex((page) => page.id === pageId);
  const page = design.pages[pageIndex];
  if (!page) {
    notify(`页面不存在：${pageId}`, "error");
    return;
  }
  const externalInstanceCount = externalComponentInstancesForPage(design, pageId).length;
  if (externalInstanceCount > 0) {
    notify(`该页面的组件仍有 ${externalInstanceCount} 个跨页实例；请先替换或删除实例`, "error");
    return;
  }
  if (!window.confirm(`确定删除「${page.name}」及其 ${page.nodes.length} 个图层吗？`)) return;
  const deletingActivePage = page.id === design.activePageId;
  design.pages.splice(pageIndex, 1);
  if (deletingActivePage) {
    const nextPage = design.pages[Math.min(pageIndex, design.pages.length - 1)];
    design.activePageId = nextPage.id;
    design.nodes = nextPage.nodes;
    clearSelection();
  }
  commitHistory();
  markChanged();
  renderPageManager();
  notify(`已删除 ${page.name}`);
  if (deletingActivePage) requestAnimationFrame(fitCanvas);
}

async function exportSvg() {
  const operationWorkspaceEpoch = workspaceEpoch;
  const sourcePath = elements.path.value.trim();
  if (!safeDesignPath(sourcePath)) {
    notify("先设置有效的 .codesign.json 路径", "error");
    return;
  }
  const path = sourcePath.replace(/\.codesign\.json$/, ".svg");
  elements.exportSvg.disabled = true;
  try {
    const saved = await saveDocument({ quiet: true });
    assertWorkspaceEpoch(operationWorkspaceEpoch);
    await writeRepoText(path, exportDesignSvg(saved.design), operationWorkspaceEpoch);
    notify(`SVG 已导出到 ${path}`);
  } catch (error) {
    if (workspaceEpoch !== operationWorkspaceEpoch) return;
    const message = error instanceof Error ? error.message : "SVG 导出失败";
    notify(
      message.includes("changed since")
        ? "SVG 已在面板外变化；请检查后重试，避免覆盖他人的版本。"
        : message,
      "error",
    );
  } finally {
    if (workspaceEpoch === operationWorkspaceEpoch) {
      elements.exportSvg.disabled = context.trusted !== true;
    }
  }
}

async function submitToAgent() {
  const operationWorkspaceEpoch = workspaceEpoch;
  const request = elements.aiRequest.value.trim();
  if (!request) return notify("先写下你希望 Agent 做什么", "error");
  if (context.busy) return notify("当前会话正在运行，请稍后再提交", "error");
  elements.submitAi.disabled = true;
  try {
    await saveDocument({ quiet: true });
    assertWorkspaceEpoch(operationWorkspaceEpoch);
    const path = elements.path.value.trim();
    const prompt = [
      "请使用 design-studio:repo-design skill 和 panel-app:design-studio 的结构化工具处理当前仓库设计。",
      `设计源文件：${path}`,
      `先读取元数据与相关子树，再按 edit → validate → screenshot 循环处理 codeshell.design v${design.version}；保持稳定 node id、组件引用、自动布局和确定性 JSON 格式。`,
      "所有嵌套节点的 x/y 都是画布绝对坐标；自动布局容器的流式直接子节点省略 x/y，layoutPositioning:absolute 的子节点仍必须提供 x/y。每个 create_node 必须先选定稳定的小写短横线语义 id。",
      "不要把 SVG 当作源文件。完成前必须达到零校验问题并实际检查完整画布截图；最后总结变更图层、设计理由和实现影响。",
      "",
      `我的要求：${request}`,
    ].join("\n");
    await hostCall("agent.submitPrompt", { prompt });
    assertWorkspaceEpoch(operationWorkspaceEpoch);
    elements.aiDialog.close();
    notify("已交给当前 Agent；文件写入 Repo 后画布会自动同步");
  } catch (error) {
    if (workspaceEpoch !== operationWorkspaceEpoch) return;
    notify(error instanceof Error ? error.message : "提交失败", "error");
  } finally {
    if (workspaceEpoch === operationWorkspaceEpoch) {
      elements.submitAi.disabled = Boolean(context.busy) || context.trusted !== true;
    }
  }
}

function bindPropertyInput(input, update, eventName = "input", layoutEffect = "none") {
  input.addEventListener(eventName, () => {
    const node = selectedNode();
    if (!node || isEffectivelyLocked(node)) return;
    update(node, input.value);
    if (layoutEffect === "size" && isContainerNode(node)) {
      applyAutoLayouts(design.nodes, new Set([node.id, ...(node.parentId ? [node.parentId] : [])]));
    } else if (layoutEffect === "size") {
      reflowParent(node);
    } else if (layoutEffect === "container" && isContainerNode(node)) {
      applyAutoLayouts(design.nodes, new Set([node.id]));
    }
    markChanged();
  });
  input.addEventListener("change", commitHistory);
}

function bindCanvasInput(input, update, eventName = "input") {
  input.addEventListener(eventName, () => {
    update(input.value);
    markChanged();
  });
  input.addEventListener("change", commitHistory);
}

function bindColorTextInput(input, currentValue, update, allowTransparent = false) {
  const isValid = (value) => validHex(value) || (allowTransparent && value === "transparent");
  input.addEventListener("input", () => {
    input.dataset.invalid = String(!isValid(input.value.trim().toLowerCase()));
  });
  input.addEventListener("change", () => {
    const value = input.value.trim().toLowerCase();
    if (!isValid(value)) {
      input.value = currentValue();
      input.dataset.invalid = "false";
      notify(
        allowTransparent ? "请输入六位十六进制色值或 transparent" : "请输入六位十六进制色值",
        "error",
      );
      return;
    }
    update(value);
    input.dataset.invalid = "false";
    commitHistory();
    markChanged();
  });
}

function ensureNodeShadow(node) {
  if (!node || node.type === "group") return null;
  if (!node.shadow) {
    node.shadow = {
      color: "#000000",
      opacity: 0.18,
      x: 0,
      y: 12,
      blur: 32,
    };
  }
  return node.shadow;
}

bindPropertyInput(propertyInputs.name, (node, value) => {
  node.name = value.slice(0, 120) || node.type;
});
bindPropertyInput(propertyInputs.x, (node, value) => {
  setNodeTreePosition(design.nodes, node.id, "x", round(Number(value) || 0));
});
bindPropertyInput(propertyInputs.y, (node, value) => {
  setNodeTreePosition(design.nodes, node.id, "y", round(Number(value) || 0));
});
bindPropertyInput(
  propertyInputs.width,
  (node, value) => {
    node.width = clamp(Number(value) || 1, 1, 20000);
  },
  "input",
  "size",
);
bindPropertyInput(
  propertyInputs.height,
  (node, value) => {
    node.height = clamp(Number(value) || 1, 1, 20000);
  },
  "input",
  "size",
);
bindPropertyInput(
  propertyInputs.parent,
  (node, value) => {
    const previousDesign = clone(design);
    const previousSelectedId = selectedId;
    const previousSelectedIds = new Set(selectedIds);
    const previousParentId = node.parentId ?? null;
    reparentNode(design.nodes, node.id, value || null);
    if (previousParentId) applyAutoLayouts(design.nodes, new Set([previousParentId]));
    reflowParent(node);
    keepValidStructuralMutation(previousDesign, previousSelectedId, previousSelectedIds);
  },
  "change",
);
bindPropertyInput(propertyInputs.notes, (node, value) => {
  const notes = value.slice(0, 2000);
  if (notes) node.notes = notes;
  else delete node.notes;
});
bindPropertyInput(propertyInputs.text, (node, value) => {
  if (node.type === "text") node.text = value.slice(0, 4000);
});
bindPropertyInput(propertyInputs.fontSize, (node, value) => {
  if (node.type === "text") node.fontSize = clamp(Number(value) || 6, 6, 240);
});
bindPropertyInput(
  propertyInputs.fontWeight,
  (node, value) => {
    if (node.type === "text") node.fontWeight = Number(value);
  },
  "change",
);
bindPropertyInput(propertyInputs.fontFamily, (node, value) => {
  if (node.type !== "text") return;
  const family = value.trim().slice(0, 120);
  if (family) node.fontFamily = family;
});
bindPropertyInput(
  propertyInputs.fontStyle,
  (node, value) => {
    if (node.type === "text" && ["normal", "italic"].includes(value)) node.fontStyle = value;
  },
  "change",
);
bindPropertyInput(propertyInputs.lineHeight, (node, value) => {
  if (node.type === "text") node.lineHeight = clamp(finiteOr(value, 1.2), 0.7, 3);
});
bindPropertyInput(propertyInputs.letterSpacing, (node, value) => {
  if (node.type === "text") node.letterSpacing = clamp(finiteOr(value, 0), -20, 100);
});
bindPropertyInput(
  propertyInputs.textDecoration,
  (node, value) => {
    if (node.type === "text" && ["none", "underline", "line-through"].includes(value)) {
      node.textDecoration = value;
    }
  },
  "change",
);
bindPropertyInput(
  propertyInputs.textAlign,
  (node, value) => {
    if (node.type === "text" && ["left", "center", "right"].includes(value)) {
      node.textAlign = value;
    }
  },
  "change",
);
bindColorTextInput(
  propertyInputs.fill,
  () => selectedNode()?.fill ?? "#ffffff",
  (value) => {
    const node = selectedNode();
    if (node && !isEffectivelyLocked(node)) node.fill = value;
  },
  true,
);
bindColorTextInput(
  propertyInputs.stroke,
  () => selectedNode()?.stroke ?? "transparent",
  (value) => {
    const node = selectedNode();
    if (node && !isEffectivelyLocked(node)) node.stroke = value;
  },
  true,
);
bindPropertyInput(propertyInputs.cornerRadius, (node, value) => {
  node.cornerRadius = clamp(Number(value) || 0, 0, 9999);
});
bindPropertyInput(propertyInputs.strokeWidth, (node, value) => {
  node.strokeWidth = clamp(finiteOr(value, 0), 0, 100);
});
bindPropertyInput(propertyInputs.opacity, (node, value) => {
  node.opacity = clamp((Number(value) || 0) / 100, 0, 1);
});
bindPropertyInput(propertyInputs.rotation, (node, value) => {
  node.rotation = clamp(finiteOr(value, 0), -360, 360);
});
propertyInputs.shadowEnabled.addEventListener("change", () => {
  const node = selectedNode();
  if (!node || node.type === "group" || isEffectivelyLocked(node)) return;
  if (propertyInputs.shadowEnabled.checked) ensureNodeShadow(node);
  else delete node.shadow;
  commitHistory();
  markChanged();
});
bindColorTextInput(
  propertyInputs.shadowColor,
  () => selectedNode()?.shadow?.color ?? "#000000",
  (value) => {
    const node = selectedNode();
    if (!node || isEffectivelyLocked(node)) return;
    const shadow = ensureNodeShadow(node);
    if (shadow) shadow.color = value;
  },
);
bindPropertyInput(propertyInputs.shadowColorPicker, (node, value) => {
  const shadow = ensureNodeShadow(node);
  if (shadow) shadow.color = value;
});
bindPropertyInput(propertyInputs.shadowX, (node, value) => {
  const shadow = ensureNodeShadow(node);
  if (shadow) shadow.x = clamp(finiteOr(value, 0), -500, 500);
});
bindPropertyInput(propertyInputs.shadowY, (node, value) => {
  const shadow = ensureNodeShadow(node);
  if (shadow) shadow.y = clamp(finiteOr(value, 0), -500, 500);
});
bindPropertyInput(propertyInputs.shadowBlur, (node, value) => {
  const shadow = ensureNodeShadow(node);
  if (shadow) shadow.blur = clamp(finiteOr(value, 0), 0, 200);
});
bindPropertyInput(propertyInputs.shadowOpacity, (node, value) => {
  const shadow = ensureNodeShadow(node);
  if (shadow) shadow.opacity = clamp(finiteOr(value, 0) / 100, 0, 1);
});
propertyInputs.clipContent.addEventListener("change", () => {
  const node = selectedNode();
  if (!node || !["frame", "component"].includes(node.type) || isEffectivelyLocked(node)) return;
  if (propertyInputs.clipContent.checked) node.clipContent = true;
  else delete node.clipContent;
  commitHistory();
  markChanged();
});
bindPropertyInput(
  propertyInputs.layout,
  (node, value) => {
    if (
      !isContainerNode(node) ||
      !["none", "horizontal", "vertical", "grid"].includes(value)
    ) {
      return;
    }
    ensureDesignV3();
    node.layout = value;
  },
  "change",
  "container",
);
bindPropertyInput(
  propertyInputs.layoutWrap,
  (node, value) => {
    if (!isContainerNode(node) || !["none", "wrap"].includes(value)) return;
    ensureDesignV3();
    node.layoutWrap = value;
  },
  "change",
  "container",
);
bindPropertyInput(
  propertyInputs.gap,
  (node, value) => {
    if (!isContainerNode(node)) return;
    ensureDesignV3();
    node.gap = clamp(finiteOr(value, 0), 0, 2000);
  },
  "input",
  "container",
);
for (const [input, property] of [
  [propertyInputs.rowGap, "rowGap"],
  [propertyInputs.columnGap, "columnGap"],
]) {
  bindPropertyInput(
    input,
    (node, value) => {
      if (!isContainerNode(node)) return;
      ensureDesignV3();
      if (value === "") delete node[property];
      else node[property] = clamp(finiteOr(value, node.gap ?? 0), 0, 2000);
    },
    "input",
    "container",
  );
}
bindPropertyInput(
  propertyInputs.padding,
  (node, value) => {
    if (!isContainerNode(node)) return;
    ensureDesignV3();
    node.padding = clamp(finiteOr(value, 0), 0, 2000);
  },
  "input",
  "container",
);
for (const [input, property] of [
  [propertyInputs.paddingTop, "paddingTop"],
  [propertyInputs.paddingRight, "paddingRight"],
  [propertyInputs.paddingBottom, "paddingBottom"],
  [propertyInputs.paddingLeft, "paddingLeft"],
]) {
  bindPropertyInput(
    input,
    (node, value) => {
      if (!isContainerNode(node)) return;
      ensureDesignV3();
      if (value === "") delete node[property];
      else node[property] = clamp(finiteOr(value, node.padding ?? 0), 0, 2000);
    },
    "input",
    "container",
  );
}
bindPropertyInput(
  propertyInputs.alignItems,
  (node, value) => {
    if (!isContainerNode(node)) return;
    ensureDesignV3();
    node.alignItems = value;
  },
  "change",
  "container",
);
bindPropertyInput(
  propertyInputs.justifyContent,
  (node, value) => {
    if (!isContainerNode(node)) return;
    ensureDesignV3();
    node.justifyContent = value;
  },
  "change",
  "container",
);
bindPropertyInput(
  propertyInputs.alignContent,
  (node, value) => {
    if (!isContainerNode(node)) return;
    ensureDesignV3();
    node.alignContent = value;
  },
  "change",
  "container",
);
bindPropertyInput(
  propertyInputs.gridColumns,
  (node, value) => {
    if (!isContainerNode(node)) return;
    ensureDesignV3();
    node.gridColumns = Math.round(clamp(finiteOr(value, 2), 1, 24));
  },
  "input",
  "container",
);
for (const [input, property] of [
  [propertyInputs.layoutSizingHorizontal, "layoutSizingHorizontal"],
  [propertyInputs.layoutSizingVertical, "layoutSizingVertical"],
]) {
  bindPropertyInput(
    input,
    (node, value) => {
      ensureDesignV3();
      node[property] = value;
      delete node.layoutGrow;
      reflowParent(node);
      if (isContainerNode(node)) applyAutoLayouts(design.nodes, new Set([node.id]));
    },
    "change",
  );
}
bindPropertyInput(
  propertyInputs.layoutPositioning,
  (node, value) => {
    ensureDesignV3();
    node.layoutPositioning = value;
    reflowParent(node);
  },
  "change",
);
for (const [input, property] of [
  [propertyInputs.gridColumnSpan, "gridColumnSpan"],
  [propertyInputs.gridRowSpan, "gridRowSpan"],
]) {
  bindPropertyInput(
    input,
    (node, value) => {
      ensureDesignV3();
      node[property] = Math.round(clamp(finiteOr(value, 1), 1, 24));
      reflowParent(node);
    },
    "input",
  );
}
bindPropertyInput(
  propertyInputs.layoutAlign,
  (node, value) => {
    ensureDesignV3();
    node.layoutAlign = value;
    reflowParent(node);
  },
  "change",
);
bindPropertyInput(
  propertyInputs.fillColor,
  (node, value) => {
    node.fill = value;
  },
  "input",
);
bindPropertyInput(
  propertyInputs.strokeColor,
  (node, value) => {
    node.stroke = value;
    if (node.strokeWidth === 0) node.strokeWidth = 1;
  },
  "input",
);

bindCanvasInput(canvasInputs.name, (value) => {
  design.name = value.slice(0, 120);
});
bindCanvasInput(canvasInputs.width, (value) => {
  design.canvas.width = clamp(finiteOr(value, 1280), 100, 10000);
});
bindCanvasInput(canvasInputs.height, (value) => {
  design.canvas.height = clamp(finiteOr(value, 820), 100, 10000);
});
bindColorTextInput(
  canvasInputs.background,
  () => design.canvas.background,
  (value) => {
    design.canvas.background = value;
  },
);
bindCanvasInput(
  canvasInputs.backgroundColor,
  (value) => {
    design.canvas.background = value;
  },
  "input",
);

for (const button of document.querySelectorAll("[data-tool]")) {
  button.addEventListener("click", () => setActiveTool(button.dataset.tool));
}
for (const button of document.querySelectorAll("[data-align]")) {
  button.addEventListener("click", () => alignSelected(button.dataset.align));
}
for (const button of document.querySelectorAll("[data-order]")) {
  button.addEventListener("click", () => setOrder(button.dataset.order));
}
for (const button of document.querySelectorAll("[data-distribute]")) {
  button.addEventListener("click", () => distributeSelected(button.dataset.distribute));
}
const inspectorTabs = [...document.querySelectorAll(".inspector-tab")];
function activateInspectorTab(button, { focus = false } = {}) {
  for (const tab of inspectorTabs) {
    const active = tab === button;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  document.querySelector("#design-tab").hidden = button.dataset.tab !== "design";
  document.querySelector("#layers-tab").hidden = button.dataset.tab !== "layers";
  elements.repoFilesTab.hidden = button.dataset.tab !== "files";
  if (button.dataset.tab === "files") void refreshRepoFilesPanel();
  if (focus) button.focus();
}
for (const [index, button] of inspectorTabs.entries()) {
  button.addEventListener("click", () => activateInspectorTab(button));
  button.addEventListener("keydown", (event) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const targetIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? inspectorTabs.length - 1
          : delta
            ? (index + delta + inspectorTabs.length) % inspectorTabs.length
            : -1;
    if (targetIndex < 0) return;
    event.preventDefault();
    activateInspectorTab(inspectorTabs[targetIndex], { focus: true });
  });
}

elements.toggleLock.addEventListener("click", () => {
  const node = selectedNode();
  if (!node) return;
  node.locked = !node.locked;
  commitHistory();
  markChanged();
});
elements.toggleVisible.addEventListener("click", () => {
  const node = selectedNode();
  toggleNodeVisibility(node);
});
elements.addColorToken.addEventListener("click", () => {
  if (design.tokens.colors.length >= 32) {
    notify("颜色变量最多 32 个", "error");
    return;
  }
  const usedNames = new Set(design.tokens.colors.map((token) => token.name.toLowerCase()));
  let suffix = design.tokens.colors.length + 1;
  while (usedNames.has(`color ${suffix}`)) suffix += 1;
  const palette = ["#ff6b6b", "#ffca6d", "#6d9cff", "#a8ff3e", "#c99cff"];
  design.tokens.colors.push({
    name: `Color ${suffix}`,
    value: palette[design.tokens.colors.length % palette.length],
  });
  commitHistory();
  markChanged();
});
elements.duplicateLayer.addEventListener("click", duplicateSelected);
elements.frameSelection.addEventListener("click", frameSelectedNodes);
elements.groupSelection.addEventListener("click", groupSelectedNodes);
elements.releaseFrame.addEventListener("click", releaseSelectedFrame);
elements.makeComponent.addEventListener("click", makeSelectedComponent);
elements.createInstance.addEventListener("click", createSelectedComponentInstance);
elements.layerFilter.addEventListener("input", () => {
  layerFilter = elements.layerFilter.value;
  renderLayers();
});
elements.stage.addEventListener("pointerdown", pointerDown);
elements.stage.addEventListener("pointermove", pointerMove);
elements.stage.addEventListener("pointerup", pointerUp);
elements.stage.addEventListener("pointercancel", pointerUp);
elements.stage.addEventListener("dblclick", (event) => {
  const targetId = event.target.closest?.("[data-node-id]")?.dataset.nodeId;
  const node = design.nodes.find((candidate) => candidate.id === targetId);
  if (node?.type !== "text") return;
  selectOnly(node.id);
  document.querySelector('[data-tab="design"]').click();
  renderAll();
  requestAnimationFrame(() => {
    propertyInputs.text.focus();
    propertyInputs.text.select();
  });
});
elements.stage.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      setZoom(zoom * Math.exp(-event.deltaY * 0.006), { x: event.clientX, y: event.clientY });
    } else {
      pan.x -= event.deltaX;
      pan.y -= event.deltaY;
      renderAll();
    }
  },
  { passive: false },
);
elements.zoomOut.addEventListener("click", () => setZoom(zoom / 1.2));
elements.zoomIn.addEventListener("click", () => setZoom(zoom * 1.2));
elements.zoomValue.addEventListener("click", fitCanvas);
elements.toggleGrid.addEventListener("click", () => {
  showGrid = !showGrid;
  saveUiPreferences();
  renderAll();
});
elements.toggleSnap.addEventListener("click", () => {
  snapEnabled = !snapEnabled;
  saveUiPreferences();
  renderAll();
});
elements.activePage.addEventListener("change", () => {
  try {
    if (!activateDesignPage(elements.activePage.value)) return;
    commitHistory();
    markChanged();
    requestAnimationFrame(fitCanvas);
  } catch (error) {
    renderPages();
    notify(error instanceof Error ? error.message : "无法切换页面", "error");
  }
});
elements.addPage.addEventListener("click", createDesignPage);
elements.managePages.addEventListener("click", () => {
  renderPageManager();
  elements.pagesDialog.showModal();
});
elements.addPageDialog.addEventListener("click", createDesignPage);
elements.save.addEventListener("click", () => void saveDocument().catch(() => undefined));
elements.runAudit.addEventListener("click", showAudit);
elements.saveAuditReport.addEventListener("click", () => void saveAuditReport());
elements.exportSvg.addEventListener("click", () => void exportSvg());
elements.openFiles.addEventListener("click", () => void showFiles());
elements.refreshRepoFiles.addEventListener(
  "click",
  () => void refreshRepoFilesPanel({ force: true }),
);
elements.repoNewDocument.addEventListener("click", newDocument);
elements.openHtmlImport.addEventListener("click", () => {
  setHtmlImportStatus("支持本地 CSS、文字、填充、边框、圆角、裁切和单个外投影。");
  elements.htmlImportDialog.showModal();
  elements.htmlImportPath.focus();
});
elements.runHtmlImport.addEventListener("click", () => void runHtmlImportFromDialog());
elements.openShortcuts.addEventListener("click", () => elements.shortcutsDialog.showModal());
elements.newDocument.addEventListener("click", newDocument);
elements.openAi.addEventListener("click", () => elements.aiDialog.showModal());
elements.toggleInspector.addEventListener("click", () => {
  const open = elements.workspace.classList.toggle("inspector-open");
  elements.toggleInspector.setAttribute("aria-expanded", String(open));
  elements.toggleInspector.title = open ? "关闭属性面板" : "打开属性面板";
  elements.toggleInspector.setAttribute("aria-label", elements.toggleInspector.title);
});
elements.submitAi.addEventListener("click", () => void submitToAgent());
elements.path.addEventListener("change", () => {
  const path = elements.path.value.trim();
  if (path !== currentSourcePath) warnedExternalVersion = null;
  currentModifiedAt = path === currentSourcePath ? currentSourceModifiedAt : null;
  currentRevision = path === currentSourcePath ? currentSourceRevision : null;
  if (dirty) queueRecovery();
  setSaveState(dirty ? "有修改" : "另存为", dirty ? "dirty" : "idle");
  void refreshRepoFilesPanel();
});

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;
  if (agentMutationActive) {
    event.preventDefault();
    return;
  }
  const activeTag = document.activeElement?.tagName;
  const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(activeTag);
  const interactive = editing || activeTag === "BUTTON" || activeTag === "A";
  const command = event.metaKey || event.ctrlKey;
  const dialogOpen = Boolean(document.querySelector("dialog[open]"));
  if (dialogOpen) return;
  if (event.code === "Space" && !interactive) {
    spacePressed = true;
    updateCursor();
    event.preventDefault();
  }
  if (command && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveDocument().catch(() => undefined);
    return;
  }
  if (command && event.key.toLowerCase() === "o") {
    event.preventDefault();
    void showFiles();
    return;
  }
  if (command && event.key.toLowerCase() === "z" && !editing) {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (command && event.key.toLowerCase() === "a" && !editing) {
    event.preventDefault();
    selectedIds = new Set(
      design.nodes.filter((node) => isEffectivelyVisible(node)).map((node) => node.id),
    );
    selectedId = [...selectedIds].at(-1) ?? null;
    setActiveTool("select");
    renderAll();
    return;
  }
  if (command && event.key.toLowerCase() === "d" && !editing) {
    event.preventDefault();
    duplicateSelected();
    return;
  }
  if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "g" && !editing) {
    event.preventDefault();
    groupSelectedNodes();
    return;
  }
  if (command && event.altKey && event.key.toLowerCase() === "g" && !editing) {
    event.preventDefault();
    frameSelectedNodes();
    return;
  }
  if (command && event.shiftKey && event.key.toLowerCase() === "g" && !editing) {
    event.preventDefault();
    releaseSelectedFrame();
    return;
  }
  if (command && event.key.toLowerCase() === "c" && !editing && selectedIds.size > 0) {
    event.preventDefault();
    copySelected();
    return;
  }
  if (command && event.key.toLowerCase() === "v" && !editing && copiedNodes.length > 0) {
    event.preventDefault();
    pasteCopied();
    return;
  }
  if (interactive) return;
  if (event.key === "?") {
    elements.shortcutsDialog.showModal();
    return;
  }
  if (event.shiftKey && event.code === "Digit1") {
    event.preventDefault();
    fitCanvas();
    return;
  }
  if (event.shiftKey && event.code === "Digit2") {
    event.preventDefault();
    fitSelection();
    return;
  }
  if (event.key === "Escape") {
    clearSelection();
    setActiveTool("select");
    renderAll();
    return;
  }
  const tool = TOOL_SHORTCUTS[event.key.toLowerCase()];
  if (tool) {
    setActiveTool(tool);
    return;
  }
  const nodes = selectedNodes();
  if ((event.key === "Delete" || event.key === "Backspace") && nodes.length > 0) {
    event.preventDefault();
    deleteSelected();
    return;
  }
  const transformNodes = selectedTransformNodes();
  if (
    transformNodes.length > 0 &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  ) {
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const movingIds = new Set(transformNodes.map((node) => node.id));
    for (const node of transformNodes) {
      const delta = visualDeltaForNode(
        node,
        {
          x: event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0,
          y: event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0,
        },
        movingIds,
      );
      node.x = round(node.x + delta.x);
      node.y = round(node.y + delta.y);
    }
    commitHistory();
    markChanged();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    spacePressed = false;
    updateCursor();
  }
});

window.addEventListener("blur", () => {
  spacePressed = false;
  finishInteraction();
  updateCursor();
});
window.addEventListener("resize", () => renderScene());
window.addEventListener("focus", () => void checkExternalChange());
window.addEventListener("beforeunload", (event) => {
  if (externalSyncTimer) window.clearInterval(externalSyncTimer);
  if (auditStatusTimer !== undefined) window.clearTimeout(auditStatusTimer);
  if (!dirty) return;
  clearTimeout(recoveryTimer);
  const workspaceRoot = context.cwd ?? null;
  void persistRecovery(workspaceRoot, recoverySnapshot(workspaceRoot));
  event.preventDefault();
  event.returnValue = "";
});

function updateContext(next) {
  const wasVisible = context.visible === true;
  const previousWorkspaceRoot = typeof context.cwd === "string" ? context.cwd : null;
  const nextContext =
    next && typeof next === "object" && !Array.isArray(next)
      ? { ...next, busy: next.busy === true, trusted: next.trusted === true }
      : { busy: false, trusted: false };
  const nextWorkspaceRoot = typeof nextContext.cwd === "string" ? nextContext.cwd : null;
  const workspaceChanged = contextInitialized && previousWorkspaceRoot !== nextWorkspaceRoot;
  if (workspaceChanged) {
    clearTimeout(recoveryTimer);
    const previousRecovery = dirty ? recoverySnapshot(previousWorkspaceRoot) : null;
    if (previousRecovery) {
      void storeRecovery(previousWorkspaceRoot, previousRecovery).catch(() => undefined);
    }
    currentModifiedAt = null;
    currentRevision = null;
    currentSourcePath = null;
    currentSourceModifiedAt = null;
    currentSourceRevision = null;
    warnedExternalVersion = null;
    fileDiscoveryCache = null;
    fileDiscoveryCachedAt = 0;
    savedSnapshot = "";
    workspaceEpoch += 1;
    recoveryFailureWarned = false;
    elements.path.disabled = false;
  }
  context = nextContext;
  contextInitialized = true;
  applyContextTheme(context.theme);
  updateRepoLinkState();
  const workspaceUnavailable = context.trusted !== true;
  elements.save.disabled = workspaceUnavailable;
  elements.exportSvg.disabled = workspaceUnavailable;
  elements.openFiles.disabled = workspaceUnavailable;
  elements.refreshRepoFiles.disabled = workspaceUnavailable;
  elements.repoNewDocument.disabled = workspaceUnavailable;
  elements.openHtmlImport.disabled = workspaceUnavailable;
  elements.runHtmlImport.disabled = workspaceUnavailable;
  elements.saveAuditReport.disabled = workspaceUnavailable;
  elements.openAi.disabled = Boolean(context.busy) || workspaceUnavailable;
  elements.submitAi.disabled = Boolean(context.busy) || workspaceUnavailable;
  elements.aiContextState.textContent = context.busy
    ? "当前会话忙碌中"
    : context.trusted === false
      ? "工作区尚未信任"
      : "会话可用";
  if (workspaceChanged) {
    notify(
      dirty
        ? "工作区已切换；当前画布已保留为未保存副本，正在连接新 Repo"
        : "工作区已切换，正在连接新 Repo 的设计文件",
    );
    const expectedWorkspaceEpoch = workspaceEpoch;
    workspaceTransition = initializeWorkspaceDocument(expectedWorkspaceEpoch).catch((error) => {
      if (expectedWorkspaceEpoch !== workspaceEpoch) return;
      resetToRepoBlankDocument();
      setRepoLinkState("Repo 读取失败", "error");
      notify(error instanceof Error ? error.message : "无法读取 Repo 设计文件", "error");
    });
    void workspaceTransition;
  }
  if (!wasVisible && context.visible === true) void checkExternalChange();
  if (wasVisible && context.visible === false && dirty) {
    clearTimeout(recoveryTimer);
    const workspaceRoot = context.cwd ?? null;
    void persistRecovery(workspaceRoot, recoverySnapshot(workspaceRoot));
  }
}

async function restoreRecovery(
  recovery,
  expectedWorkspaceEpoch = workspaceEpoch,
  workspaceRoot = context.cwd ?? null,
) {
  if (
    !recovery ||
    typeof recovery !== "object" ||
    recovery.workspaceRoot !== workspaceRoot ||
    typeof recovery.path !== "string" ||
    !safeDesignPath(recovery.path)
  ) {
    return false;
  }
  const recoveredDesign = normalizeDocument(recovery.design);
  const hasRecoveryBase = Object.prototype.hasOwnProperty.call(recovery, "baseModifiedAt");
  const hasRecoveryRevision = Object.prototype.hasOwnProperty.call(recovery, "baseRevision");
  if (!hasRecoveryBase || !hasRecoveryRevision) {
    throw new Error("恢复快照缺少文件版本守卫");
  }
  if (
    recovery.baseModifiedAt !== null &&
    (typeof recovery.baseModifiedAt !== "number" || !Number.isFinite(recovery.baseModifiedAt))
  ) {
    throw new Error("恢复快照的文件版本无效");
  }
  if (recovery.baseRevision !== null && typeof recovery.baseRevision !== "string") {
    throw new Error("恢复快照的内容版本无效");
  }
  let diskSnapshot = "";
  let diskModifiedAt = null;
  let diskRevision = null;
  let diskFound = false;
  try {
    const disk = await hostCall("workspace.readText", { path: recovery.path });
    assertWorkspaceEpoch(expectedWorkspaceEpoch);
    diskFound = true;
    diskModifiedAt = disk.modifiedAt;
    diskRevision = disk.revision;
    diskSnapshot = serializeDocument(normalizeDocument(JSON.parse(disk.content)));
  } catch {
    // A new unsaved document has no disk baseline yet.
  }
  assertWorkspaceEpoch(expectedWorkspaceEpoch);
  const recoveryBaseChanged = workspaceVersionChanged(
    { modifiedAt: recovery.baseModifiedAt, revision: recovery.baseRevision },
    { found: diskFound, modifiedAt: diskModifiedAt, revision: diskRevision },
  );
  design = recoveredDesign;
  documentEpoch += 1;
  clearSelection();
  currentModifiedAt = hasRecoveryBase ? recovery.baseModifiedAt : diskModifiedAt;
  currentRevision = hasRecoveryRevision
    ? recovery.baseRevision
    : hasRecoveryBase
      ? null
      : diskRevision;
  warnedExternalVersion = recoveryBaseChanged
    ? (diskRevision ?? (diskFound ? `mtime:${diskModifiedAt}` : "missing"))
    : null;
  currentSourcePath = recovery.path;
  currentSourceModifiedAt = currentModifiedAt;
  currentSourceRevision = currentRevision;
  elements.path.value = recovery.path;
  savedSnapshot = diskSnapshot;
  resetHistory();
  updateDirtyState();
  renderAll();
  requestAnimationFrame(fitCanvas);
  if (dirty) {
    notify(
      recoveryBaseChanged
        ? `已恢复 ${recovery.path} 的本地修改，但源文件也已变化；请重新打开或另存副本`
        : `已恢复 ${recovery.path} 的未保存修改`,
      recoveryBaseChanged ? "error" : "idle",
    );
  } else {
    currentModifiedAt = diskModifiedAt;
    currentRevision = diskRevision;
    currentSourceModifiedAt = diskModifiedAt;
    currentSourceRevision = diskRevision;
    warnedExternalVersion = null;
    updateDirtyState();
    await hostCall("storage.delete", {
      key: scopedStorageKey("recovery", workspaceRoot ?? "preview"),
    }).catch(() => undefined);
    assertWorkspaceEpoch(expectedWorkspaceEpoch);
  }
  return true;
}

function resetToRepoBlankDocument() {
  const repoName = workspaceInfo?.name ?? context.cwd?.split("/").filter(Boolean).at(-1) ?? "Repo";
  design = createBlankDocument(`${repoName} design`);
  documentEpoch += 1;
  clearSelection();
  collapsedLayerIds.clear();
  currentModifiedAt = null;
  currentRevision = null;
  currentSourcePath = null;
  currentSourceModifiedAt = null;
  currentSourceRevision = null;
  warnedExternalVersion = null;
  elements.path.value = DEFAULT_PATH;
  savedSnapshot = "";
  resetHistory();
  updateDirtyState();
  renderAll();
  requestAnimationFrame(fitCanvas);
}

async function initializeWorkspaceDocument(expectedWorkspaceEpoch = workspaceEpoch) {
  const initializationWorkspaceIdentity = context.cwd ?? null;
  const workspaceRoot = initializationWorkspaceIdentity ?? "preview";
  if (context.trusted !== true) {
    resetToRepoBlankDocument();
    updateRepoLinkState();
    return;
  }
  const [nextWorkspaceInfo, recovery, lastPath] = await Promise.all([
    hostCall("workspace.info", {}).catch(() => null),
    hostCall("storage.get", {
      key: scopedStorageKey("recovery", workspaceRoot),
    }).catch(() => null),
    hostCall("storage.get", {
      key: scopedStorageKey("lastPath", workspaceRoot),
    }).catch(() => null),
  ]);
  assertWorkspaceEpoch(expectedWorkspaceEpoch);
  workspaceInfo = nextWorkspaceInfo;
  updateRepoLinkState();
  try {
    if (await restoreRecovery(recovery, expectedWorkspaceEpoch, initializationWorkspaceIdentity)) {
      setRepoLinkState("Repo · 已恢复", "linked");
      return;
    }
  } catch {
    assertWorkspaceEpoch(expectedWorkspaceEpoch);
    await hostCall("storage.delete", {
      key: scopedStorageKey("recovery", workspaceRoot),
    }).catch(() => undefined);
  }
  if (
    lastPath &&
    typeof lastPath === "object" &&
    lastPath.workspaceRoot === initializationWorkspaceIdentity &&
    typeof lastPath.path === "string" &&
    safeDesignPath(lastPath.path)
  ) {
    try {
      await openDocument(lastPath.path, { discardChanges: true });
      setRepoLinkState("Repo · 已打开", "linked");
      return;
    } catch {
      if (expectedWorkspaceEpoch !== workspaceEpoch) return;
    }
  }
  const discovery = await discoverDesignFiles();
  assertWorkspaceEpoch(expectedWorkspaceEpoch);
  const initialFile = chooseRepoDesignFile(discovery.files);
  if (initialFile) {
    await openDocument(initialFile.path, { discardChanges: true });
    setRepoLinkState("Repo · 自动打开", "linked");
    return;
  }
  resetToRepoBlankDocument();
  setRepoLinkState("Repo · 新设计", "linked");
  notify("当前 Repo 还没有设计文件；保存后会创建 designs/design.codesign.json");
}

function startExternalSync() {
  if (externalSyncTimer) window.clearInterval(externalSyncTimer);
  externalSyncTimer = window.setInterval(() => {
    if (context.trusted === true && context.visible !== false) {
      void checkExternalChange();
    }
  }, 2_000);
}

function designLayerIndex() {
  return readableDesignPages().flatMap((page) =>
    page.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      parentId: node.parentId ?? null,
      pageId: page.id,
      pageName: page.name,
      visible: node.visible,
      locked: node.locked,
    })),
  );
}

function designNodeSubtree(nodeId, maxDepth = 32) {
  const page = readableDesignPages().find((candidate) =>
    candidate.nodes.some((node) => node.id === nodeId),
  );
  const pageNodes = page?.nodes ?? [];
  const root = pageNodes.find((node) => node.id === nodeId);
  if (!root) throw new Error(`图层不存在：${nodeId}`);
  let descendantsTruncated = false;
  const build = (node, depth = 0) => {
    if (depth > 32) throw new Error("图层嵌套超过 32 层");
    const { parentId: _parentId, ...copy } = clone(node);
    if (isContainerNode(node)) {
      const children = pageNodes.filter((candidate) => candidate.parentId === node.id);
      if (depth >= maxDepth) {
        copy.children = [];
        descendantsTruncated = descendantsTruncated || children.length > 0;
      } else {
        copy.children = children.map((candidate) => build(candidate, depth + 1));
      }
    }
    return copy;
  };
  return {
    pageId: page.id,
    pageName: page.name,
    node: build(root),
    descendantsTruncated,
  };
}

function zeroEffectOutsets() {
  return { left: 0, top: 0, right: 0, bottom: 0 };
}

function renderedNodeEffectBounds(
  documentValue,
  nodes,
  node,
  instanceStack = new Set(),
  availableNodes = allDesignNodes(documentValue),
) {
  const bounds = transformedNodeBoundsInTree(nodes, node);
  if (!bounds) return null;
  const instanceEffectOutsets =
    node.type === "instance"
      ? renderedDesignInstanceEffectOutsets(documentValue, node, instanceStack, availableNodes)
      : zeroEffectOutsets();
  const hasInstanceEffect = Object.values(instanceEffectOutsets).some((value) => value > 0);
  const strokeOutset =
    !["group", "instance"].includes(node.type) &&
    node.stroke !== "transparent" &&
    node.strokeWidth > 0
      ? node.strokeWidth / 2
      : 0;
  const visibleShadow = node.shadow?.opacity > 0 ? node.shadow : null;
  if (!visibleShadow && !hasInstanceEffect && strokeOutset <= 0) {
    return clipNodeBoundsToClippingAncestors(nodes, node);
  }
  const shadowOutset = visibleShadow?.blur * 1.5 || 0;
  const shadowX = visibleShadow?.x || 0;
  const shadowY = visibleShadow?.y || 0;
  const totalRotation = (node.rotation ?? 0) + inheritedNodeRotation(nodes, node);
  const rotatedShadowOffset = totalRotation % 360 === 0 ? 0 : Math.hypot(shadowX, shadowY);
  const rotatedInstanceOutset =
    totalRotation % 360 === 0 ? 0 : Math.max(...Object.values(instanceEffectOutsets));
  const leftOutset = Math.max(
    rotatedInstanceOutset || instanceEffectOutsets.left,
    strokeOutset,
    visibleShadow
      ? strokeOutset + shadowOutset + (rotatedShadowOffset || Math.max(0, -shadowX))
      : 0,
  );
  const topOutset = Math.max(
    rotatedInstanceOutset || instanceEffectOutsets.top,
    strokeOutset,
    visibleShadow
      ? strokeOutset + shadowOutset + (rotatedShadowOffset || Math.max(0, -shadowY))
      : 0,
  );
  const rightOutset = Math.max(
    rotatedInstanceOutset || instanceEffectOutsets.right,
    strokeOutset,
    visibleShadow ? strokeOutset + shadowOutset + (rotatedShadowOffset || Math.max(0, shadowX)) : 0,
  );
  const bottomOutset = Math.max(
    rotatedInstanceOutset || instanceEffectOutsets.bottom,
    strokeOutset,
    visibleShadow ? strokeOutset + shadowOutset + (rotatedShadowOffset || Math.max(0, shadowY)) : 0,
  );
  return clipBoundsToClippingAncestors(nodes, node, {
    x: bounds.x - leftOutset,
    y: bounds.y - topOutset,
    width: bounds.width + leftOutset + rightOutset,
    height: bounds.height + topOutset + bottomOutset,
  });
}

function designScreenshotSource(nodeId, pageId) {
  const readablePages = readableDesignPages();
  const requestedPage =
    typeof pageId === "string" && pageId ? readablePages.find((page) => page.id === pageId) : null;
  if (pageId && !requestedPage) throw new Error(`页面不存在：${pageId}`);
  const nodePage =
    typeof nodeId === "string" && nodeId
      ? readablePages.find((page) => page.nodes.some((node) => node.id === nodeId))
      : null;
  if (nodeId && !nodePage) throw new Error(`图层不存在：${nodeId}`);
  if (requestedPage && nodePage && requestedPage.id !== nodePage.id) {
    throw new Error(`图层 ${nodeId} 不在页面 ${pageId} 中`);
  }
  const page =
    requestedPage ??
    nodePage ??
    readablePages.find((candidate) => candidate.id === design.activePageId);
  if (!page) throw new Error("设计文件没有可截图的活动页面");
  const screenshotDesign = {
    ...design,
    activePageId: page.id,
    nodes: page.nodes,
  };
  if (typeof nodeId !== "string" || !nodeId) {
    return {
      x: 0,
      y: 0,
      width: screenshotDesign.canvas.width,
      height: screenshotDesign.canvas.height,
      nodeId: null,
      pageId: page.id,
      pageName: page.name,
      document: screenshotDesign,
    };
  }
  const node = page.nodes.find((candidate) => candidate.id === nodeId);
  if (!isDesignNodeVisible(screenshotDesign, node)) {
    throw new Error(`图层不可见，无法生成有效截图：${nodeId}`);
  }
  const screenshotNodeIds = new Set([node.id]);
  if (isContainerNode(node) && node.clipContent !== true) {
    for (const id of descendantIds(page.nodes, new Set([node.id]))) screenshotNodeIds.add(id);
  }
  const effectBoundsList = page.nodes
    .filter(
      (candidate) =>
        screenshotNodeIds.has(candidate.id) &&
        candidate.type !== "group" &&
        isDesignNodeVisible(screenshotDesign, candidate),
    )
    .map((candidate) => renderedNodeEffectBounds(screenshotDesign, page.nodes, candidate))
    .filter(Boolean);
  if (effectBoundsList.length === 0) throw new Error(`图层几何无效：${nodeId}`);
  const effectLeft = Math.min(...effectBoundsList.map((bounds) => bounds.x));
  const effectTop = Math.min(...effectBoundsList.map((bounds) => bounds.y));
  const effectRight = Math.max(...effectBoundsList.map((bounds) => bounds.x + bounds.width));
  const effectBottom = Math.max(...effectBoundsList.map((bounds) => bounds.y + bounds.height));
  const effectBounds = {
    x: effectLeft,
    y: effectTop,
    width: effectRight - effectLeft,
    height: effectBottom - effectTop,
  };
  const padding = Math.min(
    24,
    Math.max(8, Math.min(effectBounds.width, effectBounds.height) * 0.04),
  );
  const left = Math.max(0, effectBounds.x - padding);
  const top = Math.max(0, effectBounds.y - padding);
  const right = Math.min(
    screenshotDesign.canvas.width,
    effectBounds.x + effectBounds.width + padding,
  );
  const bottom = Math.min(
    screenshotDesign.canvas.height,
    effectBounds.y + effectBounds.height + padding,
  );
  if (right <= left || bottom <= top) {
    throw new Error(`图层位于画布之外，无法截图：${nodeId}`);
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    nodeId,
    pageId: page.id,
    pageName: page.name,
    document: screenshotDesign,
  };
}

const AGENT_NODE_PATCH_FIELDS = new Set([
  "name",
  "notes",
  "shadow",
  "effectClipping",
  "x",
  "y",
  "width",
  "height",
  "fill",
  "stroke",
  "strokeWidth",
  "opacity",
  "rotation",
  "cornerRadius",
  "visible",
  "locked",
  "clipContent",
  "text",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textDecoration",
  "textMeasurement",
  "textAlign",
  "layout",
  "layoutWrap",
  "gap",
  "rowGap",
  "columnGap",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "alignItems",
  "justifyContent",
  "alignContent",
  "gridColumns",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "layoutPositioning",
  "gridColumnSpan",
  "gridRowSpan",
  "layoutGrow",
  "layoutAlign",
  "componentId",
]);

const AGENT_OPERATION_FIELDS = new Map([
  ["create_node", new Set(["op", "type", "id", "parent_id", "before_id", "properties"])],
  ["update_node", new Set(["op", "node_id", "changes"])],
  ["move_node", new Set(["op", "node_id", "parent_id", "before_id"])],
  ["delete_node", new Set(["op", "node_id"])],
  ["set_document", new Set(["op", "changes"])],
  ["create_page", new Set(["op", "id", "name", "switch"])],
  ["rename_page", new Set(["op", "page_id", "name"])],
  ["set_active_page", new Set(["op", "page_id"])],
  ["delete_page", new Set(["op", "page_id"])],
]);

const AGENT_PAGE_OPERATIONS = new Set([
  "create_page",
  "rename_page",
  "set_active_page",
  "delete_page",
]);
const AGENT_NODE_OPERATIONS = new Set(["create_node", "update_node", "move_node", "delete_node"]);

function applyAgentNodePatch(node, changes, { moveTree = false } = {}) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new Error("changes 必须是对象");
  }
  for (const [key, value] of Object.entries(changes)) {
    if (!AGENT_NODE_PATCH_FIELDS.has(key)) {
      throw new Error(`Agent 不可直接修改图层字段：${key}`);
    }
    if (moveTree && ["x", "y"].includes(key) && Number.isFinite(value)) {
      setNodeTreePosition(design.nodes, node.id, key, value);
    } else if (
      value === null &&
      [
        "notes",
        "shadow",
        "clipContent",
        "layoutWrap",
        "rowGap",
        "columnGap",
        "alignContent",
        "gridColumns",
        "layoutSizingHorizontal",
        "layoutSizingVertical",
        "layoutPositioning",
        "gridColumnSpan",
        "gridRowSpan",
        "layoutGrow",
        "layoutAlign",
      ].includes(key)
    ) {
      delete node[key];
    } else {
      node[key] = value;
    }
  }
}

function applyAgentDocumentTokens(nextTokens) {
  const previousByName = new Map(
    (design.tokens?.colors ?? []).map((token) => [token.name.toLocaleLowerCase(), token]),
  );
  const colorReplacements = new Map();
  for (const token of nextTokens?.colors ?? []) {
    if (typeof token?.name !== "string" || typeof token.value !== "string") continue;
    const previous = previousByName.get(token.name.toLocaleLowerCase());
    if (!previous || !validHex(previous.value) || !validHex(token.value)) continue;
    const previousValue = previous.value.toLowerCase();
    const nextValue = token.value.toLowerCase();
    const existing = colorReplacements.get(previousValue);
    if (existing && existing !== nextValue) {
      throw new Error(
        `颜色变量共享旧色值 ${previousValue}，但目标值不一致；请先拆分图层颜色再重试`,
      );
    }
    colorReplacements.set(previousValue, nextValue);
  }
  replaceDesignColors(design, colorReplacements);
  design.tokens = clone(nextTokens);
}

function removeAgentNode(nodeId) {
  const node = nodeById(nodeId);
  if (!node) throw new Error(`图层不存在：${nodeId}`);
  syncActivePageNodes();
  const removedIds = new Set(designNodeRemovalIds(design, design.activePageId, new Set([node.id])));
  for (const page of design.pages) {
    const affectedParents = new Set(
      page.nodes
        .filter((candidate) => removedIds.has(candidate.id) && candidate.parentId)
        .map((candidate) => candidate.parentId),
    );
    page.nodes = page.nodes.filter((candidate) => !removedIds.has(candidate.id));
    applyAutoLayouts(page.nodes, affectedParents);
  }
  design.nodes = activeDesignPage()?.nodes ?? [];
  return [...removedIds];
}

function moveAgentNode(nodeId, parentId, beforeId) {
  const node = nodeById(nodeId);
  if (!node) throw new Error(`图层不存在：${nodeId}`);
  const targetParentId = typeof parentId === "string" && parentId ? parentId : null;
  if (!reparentNode(design.nodes, node.id, targetParentId)) {
    const currentParentId = node.parentId ?? null;
    if (currentParentId !== targetParentId) {
      throw new Error(`无法把图层 ${nodeId} 移到目标容器`);
    }
  }
  if (typeof beforeId === "string" && beforeId) {
    if (beforeId === node.id) throw new Error("before_id 不能引用正在移动的图层自身");
    const before = nodeById(beforeId);
    if (!before || (before.parentId ?? null) !== (node.parentId ?? null)) {
      throw new Error("before_id 必须是同一父级中的图层");
    }
    const nodeIndex = design.nodes.indexOf(node);
    design.nodes.splice(nodeIndex, 1);
    design.nodes.splice(design.nodes.indexOf(before), 0, node);
  }
  normalizeNodeTreeOrder(design.nodes);
}

async function applyAgentDesignOperations(args) {
  if (args.expected_state_revision !== currentDesignStateRevision()) {
    throw new Error("设计状态已变化；请重新读取元数据后再创建事务");
  }
  if (Object.hasOwn(args, "expected_revision") && args.expected_revision !== currentRevision) {
    throw new Error("设计 revision 已变化；请重新读取元数据后再创建事务");
  }
  if (!Array.isArray(args?.operations) || args.operations.length === 0) {
    throw new Error("operations 必须是非空数组");
  }
  if (args.operations.length > 50) throw new Error("一次最多执行 50 个设计操作");
  const containsPageOperation = args.operations.some((operation) =>
    AGENT_PAGE_OPERATIONS.has(operation?.op),
  );
  const containsNonPageOperation = args.operations.some(
    (operation) => !AGENT_PAGE_OPERATIONS.has(operation?.op),
  );
  const containsNodeOperation = args.operations.some((operation) =>
    AGENT_NODE_OPERATIONS.has(operation?.op),
  );
  if (containsPageOperation && containsNonPageOperation) {
    throw new Error("页面操作必须使用独立事务，不能与节点或文档属性操作混合");
  }
  const previous = clone(design);
  const previousSnapshot = serializeDocument(previous);
  const previousHistory = [...history];
  const previousHistoryIndex = historyIndex;
  const previousSelectedId = selectedId;
  const previousSelectedIds = new Set(selectedIds);
  const previousAgentTransaction = lastAgentTransaction;
  const previousDesignStateSequence = designStateSequence;
  const previousDocumentMetadata = JSON.stringify({
    name: previous.name,
    activePageId: previous.activePageId,
    pages: previous.pages.map((page) => ({ id: page.id, name: page.name })),
    canvas: previous.canvas,
    tokens: previous.tokens,
  });
  const changedIds = new Set();
  const layoutContainerIds = new Set();
  const requestParentReflow = (parentId) => {
    if (typeof parentId === "string" && parentId) layoutContainerIds.add(parentId);
  };
  try {
    ensureDesignV3();
    for (const [index, operation] of args.operations.entries()) {
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
        throw new Error(`操作 ${index + 1} 无效`);
      }
      const allowedFields = AGENT_OPERATION_FIELDS.get(operation.op);
      if (!allowedFields) throw new Error(`不支持的设计操作：${String(operation.op)}`);
      for (const key of Object.keys(operation)) {
        if (!allowedFields.has(key)) {
          throw new Error(`操作 ${index + 1} 不支持字段：${key}`);
        }
      }
      if (
        ["update_node", "move_node", "delete_node"].includes(operation.op) &&
        !isAgentNodeReference(operation.node_id)
      ) {
        throw new Error(`操作 ${index + 1} 的 node_id 必须是 1–160 个安全字符`);
      }
      if (operation.id !== undefined && (typeof operation.id !== "string" || !operation.id)) {
        throw new Error(`操作 ${index + 1} 的 id 必须是非空字符串`);
      }
      if (
        operation.parent_id !== undefined &&
        operation.parent_id !== null &&
        !isAgentNodeReference(operation.parent_id)
      ) {
        throw new Error(`操作 ${index + 1} 的 parent_id 必须是 1–160 个安全字符或 null`);
      }
      if (operation.before_id !== undefined && !isAgentNodeReference(operation.before_id)) {
        throw new Error(`操作 ${index + 1} 的 before_id 必须是 1–160 个安全字符`);
      }
      if (operation.page_id !== undefined && !isAgentStableId(operation.page_id)) {
        throw new Error(`操作 ${index + 1} 的 page_id 必须是有效页面标识符`);
      }
      if (operation.op === "create_node") {
        if (!isAgentStableId(operation.id)) {
          throw new Error(
            `操作 ${index + 1} 的 create_node.id 必须是小写字母开头、最长 64 字符的稳定短横线标识符`,
          );
        }
        if (!V3_AGENT_NODE_TYPES.has(operation.type)) {
          throw new Error(`操作 ${index + 1} 的节点类型无效`);
        }
        if (!Object.hasOwn(operation, "properties")) {
          throw new Error(`操作 ${index + 1} 缺少 properties`);
        }
        if (!canAddNodes(1)) throw new Error(`设计文件最多包含 ${MAX_DESIGN_NODES} 个图层`);
        const requestedId = operation.id;
        if (allDesignNodes().some((candidate) => candidate.id === requestedId)) {
          throw new Error(`图层 ID 已存在：${requestedId}`);
        }
        const node = baseNode(operation.type, { id: requestedId });
        const properties = operation.properties;
        applyAgentNodePatch(node, properties);
        design.nodes.push(node);
        if (operation.parent_id) moveAgentNode(node.id, operation.parent_id, operation.before_id);
        else if (operation.before_id) moveAgentNode(node.id, null, operation.before_id);
        const parent = node.parentId ? nodeById(node.parentId) : null;
        const flowLayoutChild =
          isAutoLayoutContainer(parent) && node.layoutPositioning !== "absolute";
        if (
          flowLayoutChild &&
          (Object.hasOwn(properties, "x") || Object.hasOwn(properties, "y"))
        ) {
          throw new Error(`图层 ${node.id} 将由自动布局容器 ${parent.id} 定位；创建时不要提供 x/y`);
        }
        if (
          !flowLayoutChild &&
          (!Object.hasOwn(properties, "x") || !Object.hasOwn(properties, "y"))
        ) {
          const owner =
            isAutoLayoutContainer(parent) && node.layoutPositioning === "absolute"
              ? `自动布局容器 ${parent.id} 中的绝对子节点`
              : parent
                ? `手工布局容器 ${parent.id}`
                : "画布根级";
          throw new Error(`${owner}中的新图层必须同时提供绝对画布坐标 x 和 y`);
        }
        requestParentReflow(node.parentId);
        if (isAutoLayoutContainer(node)) layoutContainerIds.add(node.id);
        changedIds.add(node.id);
      } else if (operation.op === "update_node") {
        const node = nodeById(operation.node_id);
        if (!node) throw new Error(`图层不存在：${operation.node_id}`);
        const changes = operation.changes;
        const parent = node.parentId ? nodeById(node.parentId) : null;
        const nextPositioning =
          changes?.layoutPositioning === undefined
            ? node.layoutPositioning
            : changes.layoutPositioning;
        if (
          isAutoLayoutContainer(parent) &&
          nextPositioning !== "absolute" &&
          changes &&
          typeof changes === "object" &&
          !Array.isArray(changes) &&
          ("x" in changes || "y" in changes)
        ) {
          throw new Error(
            `图层 ${node.id} 位于自动布局容器 ${parent.id} 中，x/y 由父容器管理；请修改顺序、尺寸或父容器布局属性`,
          );
        }
        applyAgentNodePatch(node, operation.changes, { moveTree: true });
        const changedFields = new Set(Object.keys(changes ?? {}));
        if (
          isContainerNode(node) &&
          [...changedFields].some((field) =>
            [
              "x",
              "y",
              "width",
              "height",
              "layout",
              "layoutWrap",
              "gap",
              "rowGap",
              "columnGap",
              "padding",
              "paddingTop",
              "paddingRight",
              "paddingBottom",
              "paddingLeft",
              "alignItems",
              "justifyContent",
              "alignContent",
              "gridColumns",
              "layoutSizingHorizontal",
              "layoutSizingVertical",
            ].includes(field),
          )
        ) {
          layoutContainerIds.add(node.id);
        }
        if (
          isAutoLayoutContainer(parent) &&
          [...changedFields].some((field) =>
            [
              "width",
              "height",
              "visible",
              "layoutSizingHorizontal",
              "layoutSizingVertical",
              "layoutPositioning",
              "gridColumnSpan",
              "gridRowSpan",
              "layoutGrow",
              "layoutAlign",
            ].includes(field),
          )
        ) {
          requestParentReflow(parent.id);
        }
        changedIds.add(node.id);
      } else if (operation.op === "delete_node") {
        const node = nodeById(operation.node_id);
        requestParentReflow(node?.parentId);
        for (const id of removeAgentNode(operation.node_id)) changedIds.add(id);
      } else if (operation.op === "move_node") {
        if (!Object.hasOwn(operation, "parent_id")) {
          throw new Error(`操作 ${index + 1} 缺少 parent_id；移动到画布根级时请显式使用 null`);
        }
        const node = nodeById(operation.node_id);
        requestParentReflow(node?.parentId);
        moveAgentNode(operation.node_id, operation.parent_id, operation.before_id);
        requestParentReflow(nodeById(operation.node_id)?.parentId);
        changedIds.add(operation.node_id);
      } else if (operation.op === "set_document") {
        const changes = operation.changes;
        if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
          throw new Error("set_document.changes 必须是对象");
        }
        for (const key of Object.keys(changes)) {
          if (!["name", "canvas", "tokens"].includes(key)) {
            throw new Error(`不可修改文档字段：${key}`);
          }
        }
        if (changes.name !== undefined) design.name = changes.name;
        if (changes.canvas !== undefined) design.canvas = { ...design.canvas, ...changes.canvas };
        if (changes.tokens !== undefined) applyAgentDocumentTokens(changes.tokens);
      } else if (operation.op === "create_page") {
        if (!isAgentStableId(operation.id)) {
          throw new Error("create_page.id 必须是小写字母开头的短横线标识符");
        }
        if (design.pages.some((page) => page.id === operation.id)) {
          throw new Error(`页面 ID 已存在：${operation.id}`);
        }
        if (
          typeof operation.name !== "string" ||
          !operation.name.trim() ||
          operation.name.length > 120 ||
          /[\u0000-\u001f\u007f]/u.test(operation.name)
        ) {
          throw new Error("create_page.name 必须是 1–120 个安全字符");
        }
        if (operation.switch !== undefined && typeof operation.switch !== "boolean") {
          throw new Error("create_page.switch 必须是布尔值");
        }
        if (design.pages.length >= MAX_DESIGN_PAGES) {
          throw new Error(`设计文件最多 ${MAX_DESIGN_PAGES} 页`);
        }
        syncActivePageNodes();
        design.pages.push({ id: operation.id, name: operation.name, nodes: [] });
        if (operation.switch !== false) activateDesignPage(operation.id);
      } else if (operation.op === "rename_page") {
        const page = design.pages.find((candidate) => candidate.id === operation.page_id);
        if (!page) throw new Error(`页面不存在：${operation.page_id}`);
        if (
          typeof operation.name !== "string" ||
          !operation.name.trim() ||
          operation.name.length > 120 ||
          /[\u0000-\u001f\u007f]/u.test(operation.name)
        ) {
          throw new Error("rename_page.name 必须是 1–120 个安全字符");
        }
        page.name = operation.name;
      } else if (operation.op === "set_active_page") {
        activateDesignPage(operation.page_id);
      } else if (operation.op === "delete_page") {
        if (design.pages.length === 1) throw new Error("不能删除设计文件中的最后一页");
        const pageIndex = design.pages.findIndex((page) => page.id === operation.page_id);
        if (pageIndex < 0) throw new Error(`页面不存在：${operation.page_id}`);
        syncActivePageNodes();
        const externalInstanceCount = externalComponentInstancesForPage(
          design,
          operation.page_id,
        ).length;
        if (externalInstanceCount > 0) {
          throw new Error(
            `该页面的组件仍有 ${externalInstanceCount} 个跨页实例；请先替换或删除实例`,
          );
        }
        const deletingActivePage = operation.page_id === design.activePageId;
        design.pages.splice(pageIndex, 1);
        if (deletingActivePage) {
          const nextPage = design.pages[Math.min(pageIndex, design.pages.length - 1)];
          design.activePageId = nextPage.id;
          design.nodes = nextPage.nodes;
          clearSelection();
        }
      }
    }
    normalizeNodeTreeOrder(design.nodes);
    applyAutoLayouts(design.nodes, layoutContainerIds);
    design = normalizeDesignState(design);
  } catch (error) {
    design = normalizeDesignState(previous);
    selectedId = previousSelectedId;
    selectedIds = previousSelectedIds;
    lastAgentTransaction = previousAgentTransaction;
    throw error;
  }
  if (serializeDesign() === previousSnapshot) {
    selectedId = previousSelectedId;
    selectedIds = previousSelectedIds;
    lastAgentTransaction = previousAgentTransaction;
    let result = null;
    if (args.save !== false) result = await saveDocument({ quiet: true });
    return {
      path: elements.path.value.trim(),
      saved: args.save !== false,
      noOp: true,
      transactionId: null,
      changedNodeIds: [],
      documentChanged: false,
      nodeCount: allDesignNodes().length,
      activePageNodeCount: design.nodes.length,
      revision: result?.revision ?? currentRevision,
      stateRevision: currentDesignStateRevision(),
      audit: summarizeAudit(auditDocument()),
    };
  }
  if (containsNodeOperation) {
    selectedIds = new Set([...changedIds].filter((id) => nodeById(id)));
    selectedId = [...selectedIds].at(-1) ?? null;
  } else if (design.activePageId === previous.activePageId) {
    selectedIds = new Set([...previousSelectedIds].filter((id) => nodeById(id)));
    selectedId = selectedIds.has(previousSelectedId)
      ? previousSelectedId
      : ([...selectedIds].at(-1) ?? null);
  }
  commitHistory();
  markChanged();
  if (args.save !== false) {
    try {
      await saveDocument({ quiet: true });
    } catch (error) {
      design = normalizeDesignState(previous);
      history = previousHistory;
      historyIndex = previousHistoryIndex;
      selectedId = previousSelectedId;
      selectedIds = previousSelectedIds;
      lastAgentTransaction = previousAgentTransaction;
      designStateSequence = previousDesignStateSequence;
      markChanged();
      throw error;
    }
  }
  const audit = summarizeAudit(auditDocument());
  const previousNodes = new Map(
    allDesignNodes(previous).map((node) => [node.id, JSON.stringify(node)]),
  );
  const actualChangedIds = new Set();
  for (const node of allDesignNodes()) {
    if (previousNodes.get(node.id) !== JSON.stringify(node)) actualChangedIds.add(node.id);
    previousNodes.delete(node.id);
  }
  for (const deletedId of previousNodes.keys()) actualChangedIds.add(deletedId);
  const documentChanged =
    previousDocumentMetadata !==
    JSON.stringify({
      name: design.name,
      activePageId: design.activePageId,
      pages: design.pages.map((page) => ({ id: page.id, name: page.name })),
      canvas: design.canvas,
      tokens: design.tokens,
    });
  const transactionId = `design-tx-${Date.now().toString(36)}-${++agentTransactionSequence}`;
  lastAgentTransaction = {
    id: transactionId,
    previousSnapshot,
    previousSelectedId,
    previousSelectedIds: [...previousSelectedIds],
    resultSelectedId: selectedId,
    resultSelectedIds: [...selectedIds],
    historyIndex,
    revision: currentRevision,
    stateRevision: currentDesignStateRevision(),
    changedNodeIds: [...actualChangedIds],
  };
  return {
    path: elements.path.value.trim(),
    saved: args.save !== false,
    noOp: false,
    transactionId,
    changedNodeIds: [...actualChangedIds],
    documentChanged,
    nodeCount: allDesignNodes().length,
    activePageNodeCount: design.nodes.length,
    revision: currentRevision,
    stateRevision: currentDesignStateRevision(),
    audit,
  };
}

const V3_AGENT_NODE_TYPES = new Set([
  "frame",
  "group",
  "component",
  "instance",
  "rectangle",
  "ellipse",
  "text",
]);
const AGENT_NODE_REFERENCE_PATTERN = /^[^\u0000-\u001f\u007f]{1,160}$/u;
const AGENT_STABLE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

function isAgentNodeReference(value) {
  return typeof value === "string" && AGENT_NODE_REFERENCE_PATTERN.test(value);
}

function isAgentStableId(value) {
  return typeof value === "string" && AGENT_STABLE_ID_PATTERN.test(value);
}

function assertAgentToolArguments(args, allowedKeys, toolName) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`${toolName} 参数必须是对象`);
  }
  for (const key of Object.keys(args)) {
    if (!allowedKeys.has(key)) throw new Error(`${toolName} 不支持参数：${key}`);
  }
}

function enqueueAgentMutation(operation) {
  const run = async () => {
    agentMutationActive = true;
    const activeEditor = document.activeElement;
    if (
      ["INPUT", "TEXTAREA", "SELECT"].includes(activeEditor?.tagName) &&
      typeof activeEditor.blur === "function"
    ) {
      activeEditor.blur();
    }
    finishInteraction();
    const previouslyInert = document.body.inert;
    document.body.inert = true;
    elements.appShell.setAttribute("aria-busy", "true");
    try {
      await settleWorkspaceTransition();
      await settlePendingSaves();
      return await operation();
    } finally {
      agentMutationActive = false;
      document.body.inert = previouslyInert;
      elements.appShell.removeAttribute("aria-busy");
    }
  };
  const result = agentMutationQueue.then(run, run);
  agentMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function settleAgentReadState() {
  await settleWorkspaceTransition();
  await agentMutationQueue;
  await settlePendingSaves().catch(() => undefined);
}

async function rollbackAgentDesign(args) {
  assertAgentToolArguments(args, new Set(["transaction_id", "save"]), "rollback_design");
  if (typeof args.transaction_id !== "string" || !args.transaction_id) {
    throw new Error("rollback_design.transaction_id 必须是非空字符串");
  }
  if (args.save !== undefined && typeof args.save !== "boolean") {
    throw new Error("rollback_design.save 必须是布尔值");
  }
  const transaction = lastAgentTransaction;
  if (!transaction || transaction.id !== args.transaction_id) {
    throw new Error("只能回滚最近一次 use_design 或 import_html 返回的 transactionId");
  }
  if (
    historyIndex !== transaction.historyIndex ||
    history[historyIndex] !== serializeDesign() ||
    currentRevision !== transaction.revision ||
    currentDesignStateRevision() !== transaction.stateRevision
  ) {
    throw new Error("设计已在该事务后发生变化；为避免覆盖新修改，拒绝回滚");
  }
  const transactionHistoryIndex = historyIndex;
  const transactionSelectedId = selectedId;
  const transactionSelectedIds = new Set(selectedIds);
  const transactionDesignStateSequence = designStateSequence;
  const selectionUnchangedSinceTransaction =
    selectedId === transaction.resultSelectedId &&
    selectedIds.size === transaction.resultSelectedIds.length &&
    transaction.resultSelectedIds.every((id) => selectedIds.has(id));
  if (transaction.previousSnapshot !== history[historyIndex]) {
    const previousIndex = history.lastIndexOf(
      transaction.previousSnapshot,
      Math.max(0, historyIndex - 1),
    );
    if (previousIndex < 0) {
      throw new Error("回滚快照已不在本地历史中；为避免覆盖新修改，拒绝回滚");
    }
    restoreHistory(previousIndex);
  }
  if (selectionUnchangedSinceTransaction) {
    selectedIds = new Set(transaction.previousSelectedIds.filter((id) => nodeById(id)));
    selectedId = selectedIds.has(transaction.previousSelectedId)
      ? transaction.previousSelectedId
      : ([...selectedIds].at(-1) ?? null);
    renderAll();
  }
  const rolledBackTransactionId = transaction.id;
  lastAgentTransaction = null;
  let result = null;
  if (args.save !== false) {
    try {
      result = await saveDocument({ quiet: true });
    } catch (error) {
      restoreHistory(transactionHistoryIndex);
      designStateSequence = transactionDesignStateSequence;
      selectedId = transactionSelectedId;
      selectedIds = transactionSelectedIds;
      lastAgentTransaction = transaction;
      renderAll();
      throw error;
    }
  }
  const rollbackAudit = summarizeAudit(auditDocument());
  return {
    path: elements.path.value.trim(),
    rolledBackTransactionId,
    saved: args.save !== false,
    revision: result?.revision ?? currentRevision,
    stateRevision: currentDesignStateRevision(),
    changedNodeIds: transaction.changedNodeIds,
    nodeCount: allDesignNodes().length,
    activePageNodeCount: design.nodes.length,
    audit: rollbackAudit,
  };
}

function registerAgentTools(ready) {
  const register = window.codeshellPanel?.registerTool;
  if (!register) return;
  register("get_design_metadata", async (args = {}) => {
    await ready;
    await settleAgentReadState();
    assertAgentToolArguments(args, new Set(), "get_design_metadata");
    return {
      format: design.format,
      version: design.version,
      path: elements.path.value.trim(),
      name: design.name,
      activePageId: design.activePageId,
      pages: design.pages.map((page) => ({
        id: page.id,
        name: page.name,
        nodeCount: page.id === design.activePageId ? design.nodes.length : page.nodes.length,
      })),
      canvas: clone(design.canvas),
      tokens: clone(design.tokens),
      geometryContract: {
        coordinateSpace: "absolute-canvas",
        manualLayoutPreservesGeometry: true,
        autoLayoutOwnsDirectFlowChildPositions: true,
        autoLayoutFlowChildCoordinates: "resolved-fallback",
        autoLayoutChildSizingAppliesToContainers: true,
        asymmetricPaddingFields: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
        independentGapFields: ["rowGap", "columnGap"],
        independentSizingFields: ["layoutSizingHorizontal", "layoutSizingVertical"],
        supportedLayouts: ["horizontal", "vertical", "grid"],
        supportsWrap: true,
        absoluteChildrenField: "layoutPositioning",
        gridSpanFields: ["gridColumnSpan", "gridRowSpan"],
      },
      selection: [...selectedIds],
      dirty,
      revision: currentRevision,
      stateRevision: currentDesignStateRevision(),
      layers: designLayerIndex(),
    };
  });
  register("search_design_system", async (args = {}) => {
    await ready;
    await settleAgentReadState();
    assertAgentToolArguments(args, new Set(["query", "limit"]), "search_design_system");
    if (
      typeof args.query !== "string" ||
      !args.query.trim() ||
      args.query.length > 120 ||
      /[\u0000-\u001f\u007f]/u.test(args.query)
    ) {
      throw new Error("search_design_system.query 必须是 1–120 个安全字符");
    }
    if (
      args.limit !== undefined &&
      (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50)
    ) {
      throw new Error("search_design_system.limit 必须是 1 到 50 的整数");
    }
    const query = args.query.trim().toLowerCase();
    const limit = args.limit ?? 20;
    const compareText = (left, right) => (left === right ? 0 : left < right ? -1 : 1);
    const rank = (values) => {
      const normalized = values.map((value) => String(value ?? "").toLowerCase());
      if (normalized.some((value) => value === query)) return 3;
      if (normalized.some((value) => value.startsWith(query))) return 2;
      return normalized.some((value) => value.includes(query)) ? 1 : 0;
    };
    const tokens = design.tokens.colors
      .map((token) => ({ ...clone(token), score: rank([token.name, token.value]) }))
      .filter((token) => token.score > 0)
      .sort((left, right) => right.score - left.score || compareText(left.name, right.name))
      .slice(0, limit)
      .map(({ score: _score, ...token }) => token);
    const components = readableDesignPages()
      .flatMap((page) =>
        page.nodes
          .filter((node) => node.type === "component")
          .map((node) => ({
            id: node.id,
            name: node.name,
            notes: node.notes ?? null,
            pageId: page.id,
            pageName: page.name,
            width: node.width,
            height: node.height,
            score: rank([node.id, node.name, node.notes]),
          })),
      )
      .filter((component) => component.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareText(left.name, right.name) ||
          compareText(left.id, right.id),
      )
      .slice(0, limit)
      .map(({ score: _score, ...component }) => component);
    return {
      query: args.query.trim(),
      limit,
      stateRevision: currentDesignStateRevision(),
      tokens,
      components,
    };
  });
  register("get_design_context", async (args = {}) => {
    await ready;
    await settleAgentReadState();
    assertAgentToolArguments(args, new Set(["node_id", "max_depth"]), "get_design_context");
    if (args.node_id !== undefined && !isAgentNodeReference(args.node_id)) {
      throw new Error("get_design_context.node_id 必须是 1–160 个安全字符");
    }
    if (
      args.max_depth !== undefined &&
      (!Number.isInteger(args.max_depth) || args.max_depth < 0 || args.max_depth > 32)
    ) {
      throw new Error("get_design_context.max_depth 必须是 0 到 32 的整数");
    }
    if (typeof args.node_id === "string" && args.node_id) {
      const maxDepth = args.max_depth ?? 32;
      const subtree = designNodeSubtree(args.node_id, maxDepth);
      return {
        path: elements.path.value.trim(),
        activePageId: design.activePageId,
        pageId: subtree.pageId,
        pageName: subtree.pageName,
        coordinateSpace: "absolute-canvas",
        stateRevision: currentDesignStateRevision(),
        maxDepth,
        descendantsTruncated: subtree.descendantsTruncated,
        node: subtree.node,
      };
    }
    return {
      path: elements.path.value.trim(),
      coordinateSpace: "absolute-canvas",
      stateRevision: currentDesignStateRevision(),
      document: JSON.parse(serializeDesign()),
    };
  });
  register("use_design", async (args = {}) => {
    await ready;
    assertAgentToolArguments(
      args,
      new Set(["operations", "save", "expected_revision", "expected_state_revision"]),
      "use_design",
    );
    if (args.save !== undefined && typeof args.save !== "boolean") {
      throw new Error("use_design.save 必须是布尔值");
    }
    if (
      args.expected_revision !== undefined &&
      args.expected_revision !== null &&
      typeof args.expected_revision !== "string"
    ) {
      throw new Error("use_design.expected_revision 必须是字符串或 null");
    }
    if (typeof args.expected_state_revision !== "string" || !args.expected_state_revision) {
      throw new Error(
        "use_design.expected_state_revision 必须是 get_design_metadata 返回的非空字符串",
      );
    }
    return enqueueAgentMutation(() => applyAgentDesignOperations(args));
  });
  register("import_html", async (args = {}) => {
    await ready;
    assertAgentToolArguments(
      args,
      new Set([
        "path",
        "root_selector",
        "viewport_width",
        "viewport_height",
        "save",
        "expected_revision",
        "expected_state_revision",
      ]),
      "import_html",
    );
    if (!isSafeHtmlImportPath(args.path)) {
      throw new Error("import_html.path 必须是工作区内安全的相对 .html 文件");
    }
    if (
      args.root_selector !== undefined &&
      (typeof args.root_selector !== "string" ||
        !args.root_selector.trim() ||
        args.root_selector.length > 200 ||
        /[\u0000-\u001f\u007f]/u.test(args.root_selector))
    ) {
      throw new Error("import_html.root_selector 必须是 1–200 个安全字符");
    }
    for (const [property, value] of [
      ["viewport_width", args.viewport_width],
      ["viewport_height", args.viewport_height],
    ]) {
      if (value !== undefined && (!Number.isInteger(value) || value < 100 || value > 10_000)) {
        throw new Error(`import_html.${property} 必须是 100 到 10000 的整数`);
      }
    }
    if (args.save !== undefined && typeof args.save !== "boolean") {
      throw new Error("import_html.save 必须是布尔值");
    }
    if (
      args.expected_revision !== undefined &&
      args.expected_revision !== null &&
      typeof args.expected_revision !== "string"
    ) {
      throw new Error("import_html.expected_revision 必须是字符串或 null");
    }
    if (typeof args.expected_state_revision !== "string" || !args.expected_state_revision) {
      throw new Error(
        "import_html.expected_state_revision 必须是 get_design_metadata 返回的非空字符串",
      );
    }
    return enqueueAgentMutation(() =>
      importHtmlFromWorkspace({
        sourcePath: args.path,
        rootSelector: args.root_selector ?? "body",
        viewportWidth: args.viewport_width ?? 1_440,
        viewportHeight: args.viewport_height ?? 900,
        save: args.save !== false,
        expectedRevision: Object.hasOwn(args, "expected_revision")
          ? args.expected_revision
          : undefined,
        expectedStateRevision: args.expected_state_revision,
        recordAgentTransaction: true,
      }),
    );
  });
  register("rollback_design", async (args = {}) => {
    await ready;
    return enqueueAgentMutation(() => rollbackAgentDesign(args));
  });
  register("validate_design", async (args = {}) => {
    await ready;
    await settleAgentReadState();
    assertAgentToolArguments(args, new Set(), "validate_design");
    const inspectedDesign = normalizeDesignState(design);
    const issues = auditDocument(inspectedDesign);
    const visibleIssues = issues.slice(0, MAX_AGENT_AUDIT_ISSUES);
    return {
      ...summarizeAudit(issues),
      path: elements.path.value.trim(),
      nodeCount: allDesignNodes(inspectedDesign).length,
      activePageNodeCount: inspectedDesign.nodes.length,
      pageCount: inspectedDesign.pages.length,
      stateRevision: currentDesignStateRevision(),
      issues: visibleIssues,
      truncatedIssueCount: issues.length - visibleIssues.length,
    };
  });
  register("get_design_screenshot", async (args = {}) => {
    await ready;
    await settleAgentReadState();
    assertAgentToolArguments(
      args,
      new Set(["node_id", "page_id", "max_width"]),
      "get_design_screenshot",
    );
    if (args.node_id !== undefined && !isAgentNodeReference(args.node_id)) {
      throw new Error("get_design_screenshot.node_id 必须是 1–160 个安全字符");
    }
    if (args.page_id !== undefined && !isAgentStableId(args.page_id)) {
      throw new Error("get_design_screenshot.page_id 必须是有效页面标识符");
    }
    if (
      args.max_width !== undefined &&
      (typeof args.max_width !== "number" ||
        !Number.isFinite(args.max_width) ||
        args.max_width < 320 ||
        args.max_width > 1_600)
    ) {
      throw new Error("get_design_screenshot.max_width 必须是 320 到 1600 的有限数字");
    }
    const screenshotStateRevision = currentDesignStateRevision();
    const screenshotRevision = currentRevision;
    const source = designScreenshotSource(args?.node_id, args?.page_id);
    const requestedWidth = Number(args?.max_width);
    const maxWidth = Number.isFinite(requestedWidth) ? Math.round(requestedWidth) : 1_200;
    const maximumScale = source.nodeId ? 8 : 1;
    const scale = Math.min(
      maximumScale,
      maxWidth / source.width,
      MAX_AGENT_SCREENSHOT_HEIGHT / source.height,
      Math.sqrt(MAX_AGENT_SCREENSHOT_PIXELS / (source.width * source.height)),
    );
    let width = Math.max(1, Math.round(source.width * scale));
    let height = Math.max(1, Math.round(source.height * scale));
    const svg = exportDesignSvg(source.document);
    const image = new window.Image();
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("设计预览渲染超时")),
        MAX_AGENT_SCREENSHOT_RENDER_MS,
      );
      image.addEventListener(
        "load",
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      image.addEventListener(
        "error",
        () => {
          window.clearTimeout(timer);
          reject(new Error("设计预览渲染失败"));
        },
        { once: true },
      );
      image.src = `data:image/svg+xml;base64,${utf8Base64(svg)}`;
    });
    const canvas = document.createElement("canvas");
    let dataUrl;
    let screenshotAttempts = 0;
    do {
      screenshotAttempts += 1;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器不支持设计预览");
      context.drawImage(
        image,
        source.x,
        source.y,
        source.width,
        source.height,
        0,
        0,
        width,
        height,
      );
      dataUrl = canvas.toDataURL("image/webp", 0.9);
      if (dataUrl.length > MAX_AGENT_SCREENSHOT_BASE64) {
        if (screenshotAttempts >= 12) {
          throw new Error("设计预览图片无法压缩到 Agent 传输上限");
        }
        width = Math.max(1, Math.round(width * 0.8));
        height = Math.max(1, Math.round(height * 0.8));
      }
    } while (dataUrl.length > MAX_AGENT_SCREENSHOT_BASE64);
    const mediaType = dataUrl.slice(5, dataUrl.indexOf(";"));
    if (!["image/png", "image/webp"].includes(mediaType)) {
      throw new Error("浏览器未能生成设计预览图片");
    }
    if (
      currentDesignStateRevision() !== screenshotStateRevision ||
      currentRevision !== screenshotRevision
    ) {
      throw new Error("设计在预览生成期间发生变化；请重新生成截图");
    }
    return {
      kind: "image",
      mediaType,
      data: dataUrl.slice(dataUrl.indexOf(",") + 1),
      width,
      height,
      nodeId: source.nodeId,
      pageId: source.pageId,
      pageName: source.pageName,
      path: elements.path.value.trim(),
      revision: screenshotRevision,
      stateRevision: screenshotStateRevision,
      summary: source.nodeId
        ? `Design preview for ${source.nodeId} on ${source.pageName} · ${width}×${height}`
        : `Design preview for ${source.pageName} · ${width}×${height}`,
    };
  });
  register("save_design", async (args = {}) => {
    await ready;
    assertAgentToolArguments(args, new Set(["expected_state_revision"]), "save_design");
    if (typeof args.expected_state_revision !== "string" || !args.expected_state_revision) {
      throw new Error(
        "save_design.expected_state_revision 必须是 get_design_metadata 返回的非空字符串",
      );
    }
    return enqueueAgentMutation(async () => {
      if (args.expected_state_revision !== currentDesignStateRevision()) {
        throw new Error("设计状态已变化；请重新读取元数据后再保存");
      }
      const result = await saveDocument({ quiet: true });
      renderAll();
      return {
        path: elements.path.value.trim(),
        revision: result.revision,
        stateRevision: currentDesignStateRevision(),
        nodeCount: allDesignNodes(result.design).length,
        activePageNodeCount: result.design.nodes.length,
        audit: summarizeAudit(auditDocument(result.design)),
      };
    });
  });
}

async function initialize() {
  resetHistory();
  renderAll();
  requestAnimationFrame(fitCanvas);
  try {
    if (window.codeshellPanel?.getContext) updateContext(await window.codeshellPanel.getContext());
    else updateContext({ trusted: true, busy: false, cwd: "/preview/codeshell" });
    window.codeshellPanel?.on?.("context.changed", updateContext);
  } catch {
    updateContext({ trusted: false, busy: false });
  }

  const initializationWorkspaceEpoch = workspaceEpoch;
  const uiPreferences = await hostCall("storage.get", { key: "uiPreferences" }).catch(() => null);
  if (initializationWorkspaceEpoch !== workspaceEpoch) return;
  if (uiPreferences && typeof uiPreferences === "object") {
    if (typeof uiPreferences.showGrid === "boolean") showGrid = uiPreferences.showGrid;
    if (typeof uiPreferences.snapEnabled === "boolean") snapEnabled = uiPreferences.snapEnabled;
    renderAll();
  }
  try {
    await initializeWorkspaceDocument(initializationWorkspaceEpoch);
  } catch (error) {
    if (initializationWorkspaceEpoch !== workspaceEpoch) return;
    resetToRepoBlankDocument();
    setRepoLinkState("Repo 读取失败", "error");
    notify(error instanceof Error ? error.message : "无法读取 Repo 设计文件", "error");
  }
  await refreshRepoFilesPanel({ force: true });
  startExternalSync();
}

const initialization = initialize();
registerAgentTools(initialization);
void initialization;
