// Figma Plugin — Commercial Edition
// Handles: URL import, HTML import, JSON import, Dev mode (bidirectional)

import { FigmaService, createFigmaService, extractFontsFromJSON, loadFonts, loadFontsFromJSON } from '@html2figma/figma';
import type { FigmaFrameNode } from '@html2figma/figma';

const figmaAPI = (globalThis as any).figma || (window as any).figma;

// ── State ──────────────────────────────────────────────────────────────
let figmaService: FigmaService;
let isUIOpen = false;

const SETTINGS_KEY = 'h2f-settings';
const DEFAULT_SERVER_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:3000'
  : 'https://api.html2figma.com';

interface PluginMessage {
  type: string;
  data?: any;
}

interface Settings {
  serverUrl: string;
}

// ── FigmaService ───────────────────────────────────────────────────────
async function initService() {
  if (!figmaService) {
    figmaService = createFigmaService(figmaAPI, {
      autoFocus: true,
      validateNodes: true,
      logOperations: true,
      imageProcessing: { enabled: true, maxSize: 2048, quality: 0.9 }
    });
  }
}

// ── UI ─────────────────────────────────────────────────────────────────
async function showUI() {
  if (!isUIOpen) {
    await initService();
    // @ts-ignore  __html__ is injected by build-plugin.js
    figmaAPI.showUI(__html__, { width: 420, height: 620, title: 'Html2Figma' });
    isUIOpen = true;
    // Send saved settings to UI on open
    loadSettings();
  }
}

// ── Settings ───────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const saved = await figmaAPI.clientStorage.getAsync(SETTINGS_KEY);
    const settings: Settings = {
      serverUrl: saved?.serverUrl || DEFAULT_SERVER_URL
    };
    figmaAPI.ui.postMessage({ type: 'settings-loaded', data: settings });
  } catch {
    figmaAPI.ui.postMessage({ type: 'settings-loaded', data: { serverUrl: DEFAULT_SERVER_URL } });
  }
}

async function saveSettings(data: Settings) {
  try {
    await figmaAPI.clientStorage.setAsync(SETTINGS_KEY, data);
    figmaAPI.ui.postMessage({ type: 'settings-saved', data: { ok: true } });
  } catch (err: any) {
    figmaAPI.ui.postMessage({ type: 'settings-saved', data: { ok: false, error: err.message } });
  }
}

// ── Import Single Design ───────────────────────────────────────────────
async function handleImportDesign(data: { designData: any; name?: string }) {
  try {
    let jsonData = data.designData;
    if (typeof jsonData === 'string') jsonData = JSON.parse(jsonData);
    if (!jsonData) throw new Error('No design data provided');

    // Batch check
    if (Array.isArray(jsonData)) {
      await handleBatchImport(jsonData.map((d: any, i: number) => ({
        designData: d,
        name: d.name || `Design ${i + 1}`
      })));
      return;
    }

    await loadFontsFromJSON(figmaAPI, jsonData);
    await initService();

    const rootFrameResult = await figmaService.addLayersToFrame(jsonData as FigmaFrameNode, null);
    const rootFrame = rootFrameResult?.value || rootFrameResult;
    if (!rootFrame?.id) throw new Error('Failed to create root frame');

    // Center in viewport
    const viewport = figmaAPI.viewport.center;
    rootFrame.x = viewport.x - (rootFrame.width || 100) / 2;
    rootFrame.y = viewport.y - (rootFrame.height || 100) / 2;

    figmaAPI.currentPage.appendChild(rootFrame);
    figmaAPI.currentPage.selection = [rootFrame];
    figmaAPI.viewport.scrollAndZoomIntoView([rootFrame]);

    const name = data.name || rootFrame.name || 'Import';
    figmaAPI.notify(`Imported: ${name}`, { timeout: 3000 });
    figmaAPI.ui.postMessage({
      type: 'import-success',
      data: { name, nodeId: rootFrame.id, width: rootFrame.width, height: rootFrame.height }
    });
  } catch (error: any) {
    const msg = error?.message || 'Unknown error';
    figmaAPI.notify('Import failed: ' + msg, { error: true });
    figmaAPI.ui.postMessage({
      type: 'import-error',
      data: { message: msg, name: data.name }
    });
  }
}

// ── Batch Import ───────────────────────────────────────────────────────
async function handleBatchImport(designs: Array<{ designData: any; name?: string }>) {
  const total = designs.length;
  let successful = 0;
  let failed = 0;
  const createdNodes: any[] = [];

  figmaAPI.notify(`Batch importing ${total} design(s)...`, { timeout: 2000 });

  // Collect and load all fonts once
  const allFonts = new Map<string, { family: string; style: string }>();
  for (const { designData } of designs) {
    const fonts = extractFontsFromJSON(designData);
    fonts.forEach((font: { family: string; style: string }, key: string) => allFonts.set(key, font));
  }
  await loadFonts(figmaAPI, Array.from(allFonts.values()));
  await initService();

  const viewport = figmaAPI.viewport.center;
  let currentX = viewport.x;
  const startY = viewport.y;
  const spacing = 300;

  for (let i = 0; i < designs.length; i++) {
    try {
      const { designData, name } = designs[i];
      const rootFrameResult = await figmaService.addLayersToFrame(designData as FigmaFrameNode, null);
      const rootFrame = rootFrameResult?.value || rootFrameResult;
      if (!rootFrame?.id) throw new Error(`Failed to create frame ${i + 1}`);

      rootFrame.x = currentX;
      rootFrame.y = startY;
      figmaAPI.currentPage.appendChild(rootFrame);
      createdNodes.push(rootFrame);
      successful++;

      currentX += (rootFrame.width || 100) + spacing;

      figmaAPI.ui.postMessage({
        type: 'batch-progress',
        data: { current: i + 1, total, name: name || rootFrame.name }
      });
    } catch {
      failed++;
    }
  }

  if (createdNodes.length > 0) {
    figmaAPI.currentPage.selection = createdNodes;
    figmaAPI.viewport.scrollAndZoomIntoView(createdNodes);
  }

  const msg = failed === 0
    ? `Imported all ${successful} design(s)`
    : `Imported ${successful}, ${failed} failed`;
  figmaAPI.notify(msg, { timeout: 4000, error: failed > 0 });
  figmaAPI.ui.postMessage({
    type: 'batch-complete',
    data: { total, successful, failed }
  });
}

// ── Export Selection ────────────────────────────────────────────────────
async function handleExportSelection() {
  try {
    const selection = figmaAPI.currentPage.selection;
    if (selection.length === 0) {
      figmaAPI.ui.postMessage({
        type: 'export-result',
        data: { error: 'No nodes selected' }
      });
      return;
    }

    const serialized = selection.map((node: any) => serializeNode(node));
    figmaAPI.ui.postMessage({
      type: 'export-result',
      data: { nodes: serialized, count: serialized.length }
    });
  } catch (error: any) {
    figmaAPI.ui.postMessage({
      type: 'export-result',
      data: { error: error?.message || 'Export failed' }
    });
  }
}

function serializeNode(node: any): any {
  const result: any = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    visible: node.visible
  };
  if (node.children) {
    result.children = node.children.map((c: any) => serializeNode(c));
  }
  return result;
}

// ── Event Handlers ─────────────────────────────────────────────────────
figmaAPI.on('run', async () => {
  await showUI();
});

figmaAPI.ui.onmessage = async (message: PluginMessage) => {
  try {
    switch (message.type) {
      case 'import-design':
        await handleImportDesign(message.data);
        break;
      case 'batch-import':
        await handleBatchImport(message.data.designs);
        break;
      case 'export-selection':
        await handleExportSelection();
        break;
      case 'save-settings':
        await saveSettings(message.data);
        break;
      case 'load-settings':
        await loadSettings();
        break;
      case 'notify':
        figmaAPI.notify(message.data.message, {
          timeout: message.data.timeout || 3000,
          error: message.data.error || false
        });
        break;
      case 'resize-ui':
        figmaAPI.ui.resize(message.data.width, message.data.height);
        break;
      case 'close-plugin':
        figmaAPI.closePlugin();
        isUIOpen = false;
        break;
      default:
        break;
    }
  } catch (error: any) {
    figmaAPI.notify('Error: ' + (error?.message || 'Unknown'), { error: true });
  }
};

figmaAPI.on('close', () => {
  isUIOpen = false;
});
