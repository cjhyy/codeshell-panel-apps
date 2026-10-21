declare global {
    interface Window {
        Html2Figma: any;
        htmlToFigma: any;
    }
}

import type { FigmaFrameNode, FigmaNode } from '@html2figma/shared';
// Access log state directly via globalThis to avoid Vite module duplication issues.
// The logger in @html2figma/shared stores state on globalThis.__html2figma_log.
function _getLogState() {
    const g = globalThis as any;
    if (!g.__html2figma_log) {
        g.__html2figma_log = { buffer: [], collecting: false, openlog: null };
    }
    return g.__html2figma_log as { buffer: any[]; collecting: boolean };
}
function startLogCollection() {
    const s = _getLogState();
    s.buffer = [];
    s.collecting = true;
}
function stopLogCollection() {
    _getLogState().collecting = false;
}
function exportLogsAsText(): string {
    return _getLogState().buffer.map((entry: any) => {
        const argsStr = entry.args?.length > 0
            ? ' ' + entry.args.map((a: any) => {
                try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); }
                catch { return String(a); }
            }).join(' ')
            : '';
        return `[${entry.timestamp}] [${entry.level}] [${entry.module}] ${entry.message}${argsStr}`;
    }).join('\n');
}
function clearCollectedLogs() {
    _getLogState().buffer = [];
}
import { templates, getTemplateByName } from './templates';
import {
    traverseDOM,
    renderTreeToJSON,
    renderToDesignDSL,
    processImages,
    type RenderNode
} from '@html2figma/browser';
import { FigmaAdapter } from '@html2figma/adapter';
import type { ImageUploadConfig } from '@html2figma/shared';

// Log collection is handled via globalThis — no need to call enableAllModules().
// Collecting mode captures ALL logs regardless of module filter.

/** Whether to use source code (true) or standalone bundle (false) */
let useSourceMode = true;

/** Image processing config — toggled by UI.
 *  proxyEndpoint enables server-side fallback for CORS/403 images. */
let imageConfig: ImageUploadConfig = { mode: 'base64', proxyEndpoint: '/api/image-proxy' };

/**
 * Convert DOM element to FigmaJSON.
 * - Source mode: uses @html2figma/browser source directly (HMR-friendly, with logs)
 * - Standalone mode: uses standalone.iife.js bundle (window.htmlToFigma)
 */
async function htmlToFigmaConvert(element: Element): Promise<any | null> {
    if (useSourceMode) {
        const renderTree = traverseDOM(element);
        if (!renderTree) return null;
        const designNode = renderToDesignDSL(renderTree);
        if (!designNode) return null;
        // Process images (no-op in base64 mode, uploads in upload mode)
        await processImages(designNode, imageConfig);
        return FigmaAdapter.toFigmaJSON(designNode);
    } else {
        return window.htmlToFigma?.(element) ?? null;
    }
}

interface FunctionalConverterOptions {
    scale?: number;
    includeInvisible?: boolean;
    maxDepth?: number;
    includeTextNodes?: boolean;
    preserveWhitespace?: boolean;
    rootFrameName?: string;
    idPrefix?: string;
}

/**
 * Syntax highlight JSON string for display
 */
function syntaxHighlightJSON(json: string | object): string {
    if (typeof json !== 'string') {
        json = JSON.stringify(json, null, 2);
    }
    
    // Escape HTML
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Apply syntax highlighting
    return json.replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        function (match) {
            let cls = 'json-number';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'json-key';
                } else {
                    cls = 'json-string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'json-boolean';
            } else if (/null/.test(match)) {
                cls = 'json-null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
        }
    );
}

interface DemoState {
    selectedElement: Element | null;
    isSelecting: boolean;
    lastConversionResult: FigmaFrameNode | null;
    lastRenderTree: RenderNode | null;
    lastRenderNodeFigma: any | null;  // DesignNode DSL → FigmaNode output
    currentTab: 'html' | 'url';
}

interface BatchResult { name: string; status: 'success' | 'error'; error?: string; nodeCount?: number; }
interface TestCheck { name: string; passed: boolean; error?: string; }
interface TestResult { name: string; category: string; passed: boolean; checks: TestCheck[]; nodeCount?: number; jsonSize?: number; }

class Html2FigmaDemo {
    private state: DemoState = {
        selectedElement: null,
        isSelecting: false,
        lastConversionResult: null,
        lastRenderTree: null,
        lastRenderNodeFigma: null,
        currentTab: 'html'
    };

    private elements = {
        // Tabs
        tabBtns: document.querySelectorAll('.tab-btn') as NodeListOf<HTMLButtonElement>,
        htmlTab: document.getElementById('html-tab') as HTMLDivElement,
        urlTab: document.getElementById('url-tab') as HTMLDivElement,

        // Inputs
        templateSearch: document.getElementById('template-search') as HTMLInputElement,
        templateDropdown: document.getElementById('template-dropdown') as HTMLDivElement,
        templateSelect: document.getElementById('template-select') as HTMLSelectElement,
        htmlInput: document.getElementById('html-input') as HTMLTextAreaElement,
        urlInput: document.getElementById('url-input') as HTMLInputElement,

        // Buttons
        renderHtmlBtn: document.getElementById('render-html-btn') as HTMLButtonElement,
        convertHtmlBtn: document.getElementById('convert-html-btn') as HTMLButtonElement,
        convertAndSyncBtn: document.getElementById('convert-and-sync-btn') as HTMLButtonElement,
        clearHtmlBtn: document.getElementById('clear-html-btn') as HTMLButtonElement,
        loadUrlBtn: document.getElementById('load-url-btn') as HTMLButtonElement,
        convertUrlBtn: document.getElementById('convert-url-btn') as HTMLButtonElement,
        selectElementBtn: document.getElementById('select-element-btn') as HTMLButtonElement,
        clearPreviewBtn: document.getElementById('clear-preview-btn') as HTMLButtonElement,
        copyJsonBtn: document.getElementById('copy-json-btn') as HTMLButtonElement,
        downloadJsonBtn: document.getElementById('download-json-btn') as HTMLButtonElement,
        clearOutputBtn: document.getElementById('clear-output-btn') as HTMLButtonElement,
        copyRenderTreeJsonBtn: document.getElementById('copy-render-tree-json-btn') as HTMLButtonElement,
        copyRenderTreeRawBtn: document.getElementById('copy-render-tree-raw-btn') as HTMLButtonElement,
        clearRenderTreeBtn: document.getElementById('clear-render-tree-btn') as HTMLButtonElement,
        imageModeSelect: document.getElementById('image-mode-select') as HTMLSelectElement,
        syncToFigmaBtn: document.getElementById('sync-to-figma-btn') as HTMLButtonElement,
        copyRenderNodeFigmaBtn: document.getElementById('copy-render-node-figma-btn') as HTMLButtonElement,
        clearRenderNodeFigmaBtn: document.getElementById('clear-render-node-figma-btn') as HTMLButtonElement,
        cancelSelectionBtn: document.getElementById('cancel-selection-btn') as HTMLButtonElement,
        expandAllBtn: document.getElementById('expand-all-btn') as HTMLButtonElement,
        collapseAllBtn: document.getElementById('collapse-all-btn') as HTMLButtonElement,
        clearAnalysisBtn: document.getElementById('clear-analysis-btn') as HTMLButtonElement,
        toggleSourceBtn: document.getElementById('toggle-source-btn') as HTMLButtonElement,
        downloadLogBtn: document.getElementById('download-log-btn') as HTMLButtonElement,

        // Batch & Test
        batchCategorySelect: document.getElementById('batch-category-select') as HTMLSelectElement,
        batchRenderBtn: document.getElementById('batch-render-btn') as HTMLButtonElement,
        runTestsBtn: document.getElementById('run-tests-btn') as HTMLButtonElement,
        batchTestSection: document.getElementById('batch-test-section') as HTMLElement,
        batchTestTitle: document.getElementById('batch-test-title') as HTMLHeadingElement,
        batchTestPanel: document.getElementById('batch-test-panel') as HTMLDivElement,
        closeBatchTestBtn: document.getElementById('close-batch-test-btn') as HTMLButtonElement,

        // Preview and Output
        previewContent: document.getElementById('preview-content') as HTMLDivElement,
        jsonOutput: document.getElementById('json-output') as HTMLPreElement,
        renderTreeOutput: document.getElementById('render-tree-output') as HTMLPreElement,
        renderNodeFigmaOutput: document.getElementById('render-node-figma-output') as HTMLPreElement,
        analysisContent: document.getElementById('analysis-content') as HTMLDivElement,

        // Options
        scaleInput: document.getElementById('scale-input') as HTMLInputElement,
        frameNameInput: document.getElementById('frame-name-input') as HTMLInputElement,
        captureImagesCheckbox: document.getElementById('capture-images-checkbox') as HTMLInputElement,
        includeInvisibleCheckbox: document.getElementById('include-invisible-checkbox') as HTMLInputElement,
        maxDepthInput: document.getElementById('max-depth-input') as HTMLInputElement,

        // Overlays
        loadingOverlay: document.getElementById('loading-overlay') as HTMLDivElement,
        selectionOverlay: document.getElementById('selection-overlay') as HTMLDivElement,

        // Status
        statusText: document.getElementById('status-text') as HTMLSpanElement,
        conversionStats: document.getElementById('conversion-stats') as HTMLSpanElement,
    };

    constructor() {
        this.initializeTemplates();
        this.initializeEventListeners();
        // Only load default HTML if no template was restored from localStorage
        const savedTemplate = localStorage.getItem('html2figma_last_template');
        if (!savedTemplate) {
            this.loadDefaultHTML();
        }
        this.updateStatus('Ready');
    }

    private initializeEventListeners(): void {
        // Tab switching
        this.elements.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab as 'html' | 'url'));
        });

        // HTML tab actions
        this.elements.renderHtmlBtn.addEventListener('click', () => this.renderHTML());
        this.elements.convertHtmlBtn.addEventListener('click', () => this.convertCurrentPreview());
        this.elements.convertAndSyncBtn.addEventListener('click', () => this.convertAndSync());
        this.elements.clearHtmlBtn.addEventListener('click', () => this.clearHTML());

        // URL tab actions
        this.elements.loadUrlBtn.addEventListener('click', () => this.loadURL());
        this.elements.convertUrlBtn.addEventListener('click', () => this.convertCurrentPreview());

        // Preview actions
        this.elements.selectElementBtn.addEventListener('click', () => this.startElementSelection());
        this.elements.clearPreviewBtn.addEventListener('click', () => this.clearPreview());
        this.elements.cancelSelectionBtn.addEventListener('click', () => this.cancelElementSelection());

        // Output actions
        this.elements.copyJsonBtn.addEventListener('click', () => this.copyJSON());
        this.elements.downloadJsonBtn.addEventListener('click', () => this.downloadJSON());
        this.elements.clearOutputBtn.addEventListener('click', () => this.clearOutput());
        
        // Render Tree actions
        this.elements.copyRenderTreeJsonBtn.addEventListener('click', () => this.copyRenderTreeJson());
        this.elements.copyRenderTreeRawBtn.addEventListener('click', () => this.copyRenderTreeRaw());
        this.elements.clearRenderTreeBtn.addEventListener('click', () => this.clearRenderTree());
        
        // Image mode toggle
        this.elements.imageModeSelect.addEventListener('change', () => {
            const mode = this.elements.imageModeSelect.value as 'base64' | 'upload';
            imageConfig = mode === 'upload'
                ? { mode: 'upload', uploadEndpoint: `${location.origin}/api/images`, proxyEndpoint: '/api/image-proxy' }
                : { mode: 'base64', proxyEndpoint: '/api/image-proxy' };
            console.log(`[Image] Mode switched to: ${mode}`);
        });

        // Render Node to Figma actions
        this.elements.syncToFigmaBtn.addEventListener('click', () => this.syncToFigma());
        this.elements.copyRenderNodeFigmaBtn.addEventListener('click', () => this.copyRenderNodeFigma());
        this.elements.clearRenderNodeFigmaBtn.addEventListener('click', () => this.clearRenderNodeFigma());

        // Analysis actions
        this.elements.expandAllBtn.addEventListener('click', () => this.expandAllAnalysis());
        this.elements.collapseAllBtn.addEventListener('click', () => this.collapseAllAnalysis());
        this.elements.clearAnalysisBtn.addEventListener('click', () => this.clearAnalysis());

        // Source/Standalone toggle
        this.elements.toggleSourceBtn.addEventListener('click', () => this.toggleSourceMode());
        this.elements.downloadLogBtn.addEventListener('click', () => this.downloadLogFile());

        // Batch & Test
        this.elements.batchRenderBtn.addEventListener('click', () => this.batchConvertAndSync());
        this.elements.runTestsBtn.addEventListener('click', () => this.runTests());
        this.elements.closeBatchTestBtn.addEventListener('click', () => {
            this.elements.batchTestSection.style.display = 'none';
        });

        // Template search dropdown
        this.initTemplateSearch();

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));

        // Auto-render HTML on input (debounced)
        let htmlInputTimeout: number;
        this.elements.htmlInput.addEventListener('input', () => {
            clearTimeout(htmlInputTimeout);
            htmlInputTimeout  = setTimeout(() => this.renderHTML(), 500) as unknown as number;
        });

        // URL input enter key
        this.elements.urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.loadURL();
            }
        });
    }

    private initializeTemplates(): void {
        // Populate hidden select (backward compat)
        templates.forEach(template => {
            const option = document.createElement('option');
            option.value = template.name;
            option.textContent = `${template.name} - ${template.description}`;
            this.elements.templateSelect.appendChild(option);
        });

        // Restore last selected template from localStorage
        const savedTemplate = localStorage.getItem('html2figma_last_template');
        if (savedTemplate) {
            this.elements.templateSelect.value = savedTemplate;
            this.elements.templateSearch.value = savedTemplate;
            this.loadTemplate();
        }
    }

    private initTemplateSearch(): void {
        const search = this.elements.templateSearch;
        const dropdown = this.elements.templateDropdown;

        const showDropdown = (filter: string) => {
            const q = filter.toLowerCase();
            const items = [{ name: '', desc: 'Custom HTML', category: '' }, ...templates.map(t => ({ name: t.name, desc: t.description, category: t.category }))];
            const filtered = q ? items.filter(t => t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q) || t.category.includes(q)) : items;

            dropdown.innerHTML = '';
            if (filtered.length === 0) {
                dropdown.innerHTML = '<div style="padding:8px 12px;color:#999;font-size:13px;">No matches</div>';
            } else {
                for (const t of filtered) {
                    const div = document.createElement('div');
                    div.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f0f0f0;';
                    div.onmouseenter = () => div.style.background = '#f0f4ff';
                    div.onmouseleave = () => div.style.background = '';
                    if (t.name) {
                        const cat = t.category ? `<span style="color:#999;font-size:11px;margin-left:6px;">[${t.category}]</span>` : '';
                        div.innerHTML = `<b>${t.name}</b>${cat}<br><span style="color:#666;font-size:12px;">${t.desc}</span>`;
                    } else {
                        div.textContent = 'Custom HTML';
                    }
                    div.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        this.selectTemplate(t.name);
                    });
                    dropdown.appendChild(div);
                }
            }
            dropdown.style.display = 'block';
        };

        search.addEventListener('focus', () => showDropdown(search.value));
        search.addEventListener('input', () => showDropdown(search.value));
        search.addEventListener('blur', () => { setTimeout(() => dropdown.style.display = 'none', 150); });
        search.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { dropdown.style.display = 'none'; search.blur(); }
        });
    }

    private selectTemplate(name: string): void {
        this.elements.templateSelect.value = name;
        this.elements.templateSearch.value = name || '';
        this.elements.templateDropdown.style.display = 'none';
        this.loadTemplate();
    }

    private loadTemplate(): void {
        const templateName = this.elements.templateSelect.value;

        if (templateName) {
            localStorage.setItem('html2figma_last_template', templateName);
        } else {
            localStorage.removeItem('html2figma_last_template');
            this.elements.htmlInput.value = '';
            this.clearPreview();
            this.updateStatus('Switched to Custom HTML');
            return;
        }

        const template = getTemplateByName(templateName);
        if (template) {
            this.elements.htmlInput.value = template.html;
            this.renderHTML();
            this.updateStatus(`Loaded template: ${template.name}`);
        }
    }

    private switchTab(tab: 'html' | 'url'): void {
        this.state.currentTab = tab;

        // Update tab buttons
        this.elements.tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // Update tab content
        this.elements.htmlTab.classList.toggle('active', tab === 'html');
        this.elements.urlTab.classList.toggle('active', tab === 'url');

        this.updateStatus(`Switched to ${tab.toUpperCase()} input`);
    }

    private async renderHTML(): Promise<void> {
        const htmlContent = this.elements.htmlInput.value.trim();
        
        if (!htmlContent) {
            this.clearPreview();
            return;
        }

        try {
            this.showLoading('Rendering HTML...');
            this.renderHTMLContent(htmlContent);
            this.updateStatus('HTML rendered successfully');
        } catch (error) {
            console.error('Error rendering HTML:', error);
            this.updateStatus('Error rendering HTML', true);
            this.showError('Failed to render HTML: ' + (error as Error).message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 渲染HTML内容到预览区域，包括body样式
     */
    private renderHTMLContent(htmlContent: string): void {
        // Parse the HTML content
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        
        // Clear previous content
        this.elements.previewContent.innerHTML = '';
        
        // Extract and apply styles from head
        const headStyles = doc.querySelectorAll('style, link[rel="stylesheet"]');
        headStyles.forEach(styleElement => {
            if (styleElement.tagName === 'STYLE') {
                // Clone style element and add to preview
                const clonedStyle = styleElement.cloneNode(true) as HTMLStyleElement;
                this.elements.previewContent.appendChild(clonedStyle);
            } else if (styleElement.tagName === 'LINK') {
                // Clone link element and add to preview
                const clonedLink = styleElement.cloneNode(true) as HTMLLinkElement;
                this.elements.previewContent.appendChild(clonedLink);
            }
        });
        
        // Get body element and its styles
        const bodyElement = doc.body;
        if (bodyElement) {
            // Create a container that mimics the body
            const bodyContainer = document.createElement('div');
            bodyContainer.className = bodyElement.className;
            bodyContainer.setAttribute('data-html2figma-body', 'true');
            
            // Copy all attributes from body to container
            Array.from(bodyElement.attributes).forEach(attr => {
                if (attr.name !== 'class') {
                    bodyContainer.setAttribute(attr.name, attr.value);
                }
            });
            
            // Default white background, then overlay any inline styles from body
            bodyContainer.style.backgroundColor = '#ffffff';
            if (bodyElement.style.cssText) {
                bodyContainer.style.cssText = bodyElement.style.cssText;
                if (!bodyElement.style.backgroundColor && !bodyElement.style.background) {
                    bodyContainer.style.backgroundColor = '#ffffff';
                }
            }
            
            // Copy body content
            bodyContainer.innerHTML = bodyElement.innerHTML;
            
            // Add the body container to preview
            this.elements.previewContent.appendChild(bodyContainer);
        } else {
            // Fallback: treat as fragment
            const container = document.createElement('div');
            container.style.backgroundColor = '#ffffff';
            container.innerHTML = htmlContent;
            this.elements.previewContent.appendChild(container);
        }
    }

    private async loadURL(): Promise<void> {
        const url = this.elements.urlInput.value.trim();
        
        if (!url) {
            this.updateStatus('Please enter a URL', true);
            return;
        }

        try {
            this.showLoading('Loading URL...');
            
            // For demo purposes, we'll use a proxy service or handle CORS
            // In a real implementation, you might need a backend proxy
            const response = await fetch(url, {
                mode: 'cors',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const htmlContent = await response.text();
            
            // Use the common HTML rendering method
            this.renderHTMLContent(htmlContent);
            this.updateStatus('URL loaded successfully');
            
        } catch (error) {
            console.error('Error loading URL:', error);
            this.updateStatus('Error loading URL', true);
            this.showError('Failed to load URL: ' + (error as Error).message + '\n\nThis might be due to CORS restrictions. Try using a CORS-enabled URL or local HTML content.');
        } finally {
            this.hideLoading();
        }
    }

    private startElementSelection(): void {
        this.state.isSelecting = true;
        this.elements.selectionOverlay.classList.remove('hidden');
        this.elements.previewContent.classList.add('selecting');
        
        // Add click listeners to all elements in preview
        this.addSelectionListeners();
        this.updateStatus('Click on any element to select it for conversion');
    }

    private addSelectionListeners(): void {
        const elements = this.elements.previewContent.querySelectorAll('*');
        elements.forEach(element => {
            // Skip style and link elements from selection
            if (element.tagName === 'STYLE' || element.tagName === 'LINK') {
                return;
            }
            element.addEventListener('mouseenter', this.highlightElement);
            element.addEventListener('mouseleave', this.unhighlightElement);
            element.addEventListener('click', this.selectElement);
        });
    }

    private highlightElement = (e: Event): void => {
        if (!this.state.isSelecting) return;
        e.stopPropagation();
        (e.target as Element).classList.add('element-highlight');
    };

    private unhighlightElement = (e: Event): void => {
        if (!this.state.isSelecting) return;
        e.stopPropagation();
        (e.target as Element).classList.remove('element-highlight');
    };

    private selectElement = (e: Event): void => {
        if (!this.state.isSelecting) return;
        e.preventDefault();
        e.stopPropagation();
        
        this.state.selectedElement = e.target as Element;
        this.cancelElementSelection();
        
        // Highlight selected element
        this.elements.previewContent.querySelectorAll('.element-highlight').forEach(el => {
            el.classList.remove('element-highlight');
        });
        this.state.selectedElement.classList.add('element-highlight');
        
        this.updateStatus(`Selected: ${this.state.selectedElement.tagName.toLowerCase()}`);
    };

    private cancelElementSelection(): void {
        this.state.isSelecting = false;
        this.elements.selectionOverlay.classList.add('hidden');
        this.elements.previewContent.classList.remove('selecting');
        
        // Remove selection listeners
        const elements = this.elements.previewContent.querySelectorAll('*');
        elements.forEach(element => {
            // Skip style and link elements
            if (element.tagName === 'STYLE' || element.tagName === 'LINK') {
                return;
            }
            element.removeEventListener('mouseenter', this.highlightElement);
            element.removeEventListener('mouseleave', this.unhighlightElement);
            element.removeEventListener('click', this.selectElement);
        });
    }

    private async convertCurrentPreview(): Promise<void> {
        let targetElement = this.state.selectedElement;
        
        // If no element is selected, find the content element (skip style elements)
        if (!targetElement) {
            // Find the first non-style element in preview content
            const children = Array.from(this.elements.previewContent.children);
            targetElement = children.find(child => 
                child.tagName !== 'STYLE' && 
                child.tagName !== 'LINK'
            ) as Element;
        }
        
        if (!targetElement) {
            this.updateStatus('No content to convert', true);
            return;
        }

        try {
            this.showLoading('Converting to Figma JSON and generating Render Tree...');
            const options = this.getConversionOptions();

            // Start collecting logs for this conversion
            startLogCollection();

            // Convert to Figma JSON (async: may upload images)
            const figmaJson = await htmlToFigmaConvert(targetElement);
            
            if (!figmaJson) {
                throw new Error('Conversion returned null');
            }
            
            this.state.lastConversionResult = figmaJson as FigmaFrameNode;
            this.displayJSON(figmaJson);
            
            // Generate DOM Render Tree
            const renderTree = traverseDOM(targetElement, {
                includeInvisible: options.includeInvisible,
                maxDepth: options.maxDepth,
                includeTextNodes: true,
                preserveWhitespace: false,
                filter: (node) => {
                    // Filter out script and style tags
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const tag = (node as Element).tagName.toLowerCase();
                        return tag !== 'script' && tag !== 'style';
                    }
                    return true;
                }
            });
            
            this.state.lastRenderTree = renderTree;
            this.displayRenderTree(renderTree);
            
            // Convert Render Tree to DesignNode DSL then to FigmaNode
            if (renderTree) {
                const designNode = renderToDesignDSL(renderTree);

                if (designNode) {
                    await processImages(designNode, imageConfig);
                    const figmaNode = FigmaAdapter.toFigmaJSON(designNode);
                    this.state.lastRenderNodeFigma = figmaNode;
                    this.displayRenderNodeFigma(figmaNode);

                    // Send DesignNode DSL to server for inspection
                    this.sendDesignNodeToServer(designNode);
                } else {
                    console.warn('⚠️ DesignNode DSL conversion returned null');
                }
            }
            
            // Generate and display analysis
            this.displayAnalysis(figmaJson as FigmaFrameNode);
            
            // Update stats
            const stats = this.calculateStats(figmaJson as FigmaFrameNode);
            this.elements.conversionStats.textContent = stats;
            
            this.updateStatus('Conversion completed successfully');

            // Stop collecting — send to server so we can see in terminal
            stopLogCollection();
            this.sendLogsToServer();

        } catch (error) {
            console.error('Conversion error:', error);
            stopLogCollection();
            this.sendLogsToServer();
            this.updateStatus('Conversion failed', true);
            this.showError('Conversion failed: ' + (error as Error).message);
        } finally {
            this.hideLoading();
        }
    }

    private getConversionOptions(): FunctionalConverterOptions {
        return {
            scale: parseFloat(this.elements.scaleInput.value) || 1,
            includeInvisible: this.elements.includeInvisibleCheckbox.checked,
            maxDepth: parseInt(this.elements.maxDepthInput.value) || 50,
            idPrefix: 'figma-'
        };
    }

    private displayJSON(json: any): void {
        // Create a copy of the JSON for display, truncating long base64 strings
        const displayJson = this.prepareJsonForDisplay(json);
        const formatted = JSON.stringify(displayJson, null, 2);
        const highlighted = this.syntaxHighlightJSON(formatted);
        this.elements.jsonOutput.innerHTML = highlighted;
    }

    private prepareJsonForDisplay(obj: any): any {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.prepareJsonForDisplay(item));
        }

        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
            if (key === 'base64' && typeof value === 'string' && value.length > 100) {
                // Truncate long base64 strings for display
                result[key] = `${value.substring(0, 50)}...[truncated ${value.length} chars total]...${value.substring(value.length - 20)}`;
            } else if (key === 'svgContent' && typeof value === 'string') {
                // Truncate long SVG content for display to avoid parsing issues
                // Replace double quotes with single quotes to avoid JSON conflicts
                const truncatedContent = value.replace(/"/g, "'");
                result[key] = truncatedContent;
            } else {
                result[key] = this.prepareJsonForDisplay(value);
            }
        }
        return result;
    }

    private syntaxHighlightJSON(json: string): string {
        return json
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
                let cls = 'json-number';
                if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                        cls = 'json-key';
                    } else {
                        cls = 'json-string';
                    }
                } else if (/true|false/.test(match)) {
                    cls = 'json-boolean';
                } else if (/null/.test(match)) {
                    cls = 'json-null';
                }
                return '<span class="' + cls + '">' + match + '</span>';
});    
}

    private calculateStats(figmaJson: FigmaFrameNode): string {
        const countNodes = (node: any): number => {
            let count = 1;
            if (node.children) {
                count += node.children.reduce((sum: number, child: any) => sum + countNodes(child), 0);
            }
            return count;
        };

        const nodeCount = countNodes(figmaJson);
        const jsonSize = JSON.stringify(figmaJson).length;
        
        return `Nodes: ${nodeCount} | Size: ${this.formatBytes(jsonSize)}`;
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    private async copyJSON(): Promise<void> {
        if (!this.state.lastConversionResult) {
            this.updateStatus('No JSON to copy', true);
            return;
        }

        try {
            const jsonText = JSON.stringify(this.state.lastConversionResult, null, 2);
            await navigator.clipboard.writeText(jsonText);
            this.updateStatus('JSON copied to clipboard');
        } catch (error) {
            console.error('Copy failed:', error);
            this.updateStatus('Failed to copy JSON', true);
        }
    }

    private downloadJSON(): void {
        if (!this.state.lastConversionResult) {
            this.updateStatus('No JSON to download', true);
            return;
        }

        const jsonText = JSON.stringify(this.state.lastConversionResult, null, 2);
        const blob = new Blob([jsonText], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'figma-export.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.updateStatus('JSON downloaded');
    }

    private toggleSourceMode(): void {
        useSourceMode = !useSourceMode;
        const btn = this.elements.toggleSourceBtn;
        if (useSourceMode) {
            btn.textContent = 'Source';
            btn.style.background = '#28a745';
            this.updateStatus('Switched to Source mode (HMR, with logs)');
        } else {
            btn.textContent = 'Standalone';
            btn.style.background = '#6c757d';
            this.updateStatus('Switched to Standalone mode (built bundle)');
        }
    }

    private async sendLogsToServer(): Promise<void> {
        const logText = exportLogsAsText();
        if (!logText) return;

        try {
            await fetch('/api/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ logText }),
            });
        } catch (e) {
            console.warn('Failed to send logs to server:', e);
        }
    }

    private async sendDesignNodeToServer(designNode: any): Promise<void> {
        try {
            await fetch('/api/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    logText: JSON.stringify(designNode, null, 2)
                }),
            });
        } catch (e) { /* ignore */ }
    }

    private downloadLogFile(): void {
        const logText = exportLogsAsText();
        if (!logText) {
            console.log('[Log] No logs collected');
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `html2figma-log-${timestamp}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log(`[Log] Downloaded ${logText.split('\n').length} log lines`);
        clearCollectedLogs();
    }

    private clearHTML(): void {
        this.elements.htmlInput.value = '';
        this.clearPreview();
        this.updateStatus('HTML input cleared');
    }

    private clearPreview(): void {
        this.elements.previewContent.innerHTML = '<div class="placeholder"><p>Enter HTML code or URL above to see the preview</p></div>';
        this.state.selectedElement = null;
        this.updateStatus('Preview cleared');
    }

    private clearOutput(): void {
        this.elements.jsonOutput.innerHTML = '<div class="placeholder">Figma JSON will appear here after conversion</div>';
        this.state.lastConversionResult = null;
        this.elements.conversionStats.textContent = '';
        this.clearRenderTree();
        this.clearRenderNodeFigma();
        this.clearAnalysis();
        this.updateStatus('Output cleared');
    }

    private displayRenderTree(renderTree: RenderNode | null): void {
        if (!renderTree) {
            this.clearRenderTree();
            return;
        }

        // Convert render tree to JSON
        const renderTreeJSON = renderTreeToJSON(renderTree, true); // Include styles
        const formatted = JSON.stringify(renderTreeJSON, null, 2);
        const highlighted = this.syntaxHighlightJSON(formatted);
        this.elements.renderTreeOutput.innerHTML = highlighted;
    }

    private async copyRenderTreeJson(): Promise<void> {
        if (!this.state.lastRenderTree) {
            this.updateStatus('No Render Tree to copy', true);
            return;
        }

        try {
            const renderTreeJSON = renderTreeToJSON(this.state.lastRenderTree, true);
            const jsonText = JSON.stringify(renderTreeJSON, null, 2);
            await navigator.clipboard.writeText(jsonText);
            this.updateStatus('Simplified Render Tree JSON copied to clipboard');
        } catch (error) {
            console.error('Copy failed:', error);
            this.updateStatus('Failed to copy Render Tree JSON', true);
        }
    }

    private async copyRenderTreeRaw(): Promise<void> {
        if (!this.state.lastRenderTree) {
            this.updateStatus('No Render Tree to copy', true);
            return;
        }

        try {
            // Serialize the raw render tree with full style information
            const rawTreeJSON = this.serializeRenderTreeRaw(this.state.lastRenderTree);
            const jsonText = JSON.stringify(rawTreeJSON, null, 2);
            await navigator.clipboard.writeText(jsonText);
            this.updateStatus('Raw Render Tree (with full styles) copied to clipboard');
        } catch (error) {
            console.error('Copy failed:', error);
            this.updateStatus('Failed to copy Raw Render Tree', true);
        }
    }

    /**
     * Serialize RenderNode with full CSSStyleDeclaration properties
     */
    private serializeRenderTreeRaw(node: RenderNode): any {
        const result: any = {
            nodeType: node.nodeType,
            visible: node.visible,
        };

        if (node.nodeType === 'element') {
            result.tag = node.tag;
            
            if (node.boundingRect) {
                result.boundingRect = {
                    x: node.boundingRect.x,
                    y: node.boundingRect.y,
                    width: node.boundingRect.width,
                    height: node.boundingRect.height,
                };
            }

            // Serialize full CSSStyleDeclaration
            if (node.computedStyle) {
                const styles: Record<string, string> = {};
                const styleDeclaration = node.computedStyle;
                
                // Get all CSS properties
                for (let i = 0; i < styleDeclaration.length; i++) {
                    const propertyName = styleDeclaration[i];
                    const value = styleDeclaration.getPropertyValue(propertyName);
                    if (value) {
                        styles[propertyName] = value;
                    }
                }
                
                result.computedStyle = styles;
            }
        } else if (node.nodeType === 'text') {
            result.textContent = node.textContent;
        }

        if (node.metadata) {
            result.metadata = node.metadata;
        }

        if (node.children.length > 0) {
            result.children = node.children.map(child => this.serializeRenderTreeRaw(child));
        }

        return result;
    }

    private clearRenderTree(): void {
        this.elements.renderTreeOutput.innerHTML = '<div class="placeholder">DOM Render Tree will appear here after conversion</div>';
        this.state.lastRenderTree = null;
        this.updateStatus('Render Tree cleared');
    }

    private displayRenderNodeFigma(renderNodeFigma: any | null): void {
        if (!renderNodeFigma) {
            this.clearRenderNodeFigma();
            return;
        }

        // Convert to JSON and display
        const formatted = JSON.stringify(renderNodeFigma, null, 2);
        const highlighted = this.syntaxHighlightJSON(formatted);
        this.elements.renderNodeFigmaOutput.innerHTML = highlighted;
    }

    private async copyRenderNodeFigma(): Promise<void> {
        if (!this.state.lastRenderNodeFigma) {
            this.updateStatus('No Render Node to Figma output to copy', true);
            return;
        }

        try {
            const jsonText = JSON.stringify(this.state.lastRenderNodeFigma, null, 2);
            await navigator.clipboard.writeText(jsonText);
            this.updateStatus('Render Node to Figma JSON copied to clipboard');
        } catch (error) {
            console.error('Copy failed:', error);
            this.updateStatus('Failed to copy Render Node to Figma JSON', true);
        }
    }

    private async convertAndSync(): Promise<void> {
        await this.renderHTML();
        await this.convertCurrentPreview();
        await this.syncToFigma();
    }

    private async syncToFigma(): Promise<void> {
        if (!this.state.lastRenderNodeFigma) {
            this.updateStatus('No Figma data to sync. Convert first.', true);
            return;
        }

        try {
            const templateName = (this.elements.templateSelect as HTMLSelectElement).selectedOptions?.[0]?.textContent || 'Custom';
            const response = await fetch('/api/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: templateName,
                    figmaJSON: this.state.lastRenderNodeFigma
                })
            });
            const result = await response.json();
            if (result.ok) {
                this.updateStatus('Synced to Figma! Open the test plugin to import.');
            } else {
                throw new Error(result.error || 'Sync failed');
            }
        } catch (error) {
            console.error('Sync to Figma failed:', error);
            this.updateStatus('Sync failed: ' + (error as Error).message, true);
        }
    }

    private clearRenderNodeFigma(): void {
        this.elements.renderNodeFigmaOutput.innerHTML = '<div class="placeholder">Render Node to Figma output will appear here after conversion</div>';
        this.state.lastRenderNodeFigma = null;
        this.updateStatus('Render Node to Figma output cleared');
    }

    // ========== Batch & Test Methods ==========

    private waitForRender(ms: number = 100): Promise<void> {
        return new Promise(resolve => {
            requestAnimationFrame(() => setTimeout(resolve, ms));
        });
    }

    private countNodes(node: any): number {
        if (!node) return 0;
        let count = 1;
        if (node.children && Array.isArray(node.children)) {
            for (const child of node.children) {
                count += this.countNodes(child);
            }
        }
        return count;
    }

    private showBatchTestPanel(title: string, content: string): void {
        this.elements.batchTestTitle.textContent = title;
        this.elements.batchTestPanel.innerHTML = content;
        this.elements.batchTestSection.style.display = '';
        this.elements.batchTestSection.scrollIntoView({ behavior: 'smooth' });
    }

    private async batchConvertAndSync(): Promise<void> {
        const category = this.elements.batchCategorySelect.value;
        const filtered = category
            ? templates.filter(t => t.category === category)
            : templates;

        if (filtered.length === 0) {
            this.updateStatus('No templates found for selected category', true);
            return;
        }

        this.elements.batchRenderBtn.disabled = true;
        this.elements.runTestsBtn.disabled = true;

        const results: BatchResult[] = [];

        // Show progress panel
        this.showBatchTestPanel('Batch Render', '');

        for (let i = 0; i < filtered.length; i++) {
            const template = filtered[i];

            // Update progress
            const pct = Math.round(((i) / filtered.length) * 100);
            const errorCount = results.filter(r => r.status === 'error').length;
            this.elements.batchTestPanel.innerHTML = `
                <div class="batch-progress-text">${i + 1}/${filtered.length}: ${template.name}${errorCount > 0 ? ` (${errorCount} failed)` : ''}</div>
                <div class="batch-progress-bar"><div class="batch-progress-fill" style="width:${pct}%">${pct}%</div></div>
            `;

            try {
                // Render HTML to preview
                this.renderHTMLContent(template.html);
                await this.waitForRender(100);

                // Find target element
                const children = Array.from(this.elements.previewContent.children);
                const targetElement = children.find(child =>
                    child.tagName !== 'STYLE' && child.tagName !== 'LINK'
                ) as Element | undefined;

                if (!targetElement) {
                    results.push({ name: template.name, status: 'error', error: 'No renderable element' });
                    continue;
                }

                // Convert: traverseDOM → renderToDesignDSL → processImages → toFigmaJSON
                const renderTree = traverseDOM(targetElement);
                if (!renderTree) {
                    results.push({ name: template.name, status: 'error', error: 'traverseDOM returned null' });
                    continue;
                }

                const designNode = renderToDesignDSL(renderTree);
                if (!designNode) {
                    results.push({ name: template.name, status: 'error', error: 'renderToDesignDSL returned null' });
                    continue;
                }

                await processImages(designNode, imageConfig);
                const figmaNode = FigmaAdapter.toFigmaJSON(designNode);
                if (!figmaNode) {
                    results.push({ name: template.name, status: 'error', error: 'toFigmaJSON returned null' });
                    continue;
                }

                const nodeCount = this.countNodes(figmaNode);

                // POST to queue
                const response = await fetch('/api/result?mode=queue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: template.name, figmaJSON: figmaNode })
                });
                const result = await response.json();
                if (!result.ok) throw new Error('Queue POST failed');

                results.push({ name: template.name, status: 'success', nodeCount });
            } catch (error) {
                results.push({ name: template.name, status: 'error', error: (error as Error).message });
            }
        }

        // Show final report
        const successCount = results.filter(r => r.status === 'success').length;
        const errorCount = results.filter(r => r.status === 'error').length;

        let html = `
            <div class="test-summary">
                <span class="summary-total">Total: ${results.length}</span>
                <span class="summary-passed">Queued: ${successCount}</span>
                <span class="summary-failed">Failed: ${errorCount}</span>
            </div>
            <div style="max-height: 400px; overflow-y: auto;">
            <table class="test-report-table">
                <thead><tr><th>#</th><th>Template</th><th>Status</th><th>Nodes</th><th>Error</th></tr></thead>
                <tbody>
        `;
        results.forEach((r, idx) => {
            const statusClass = r.status === 'success' ? 'test-pass' : 'test-fail';
            const statusText = r.status === 'success' ? 'OK' : 'FAIL';
            html += `<tr>
                <td>${idx + 1}</td>
                <td>${r.name}</td>
                <td class="${statusClass}">${statusText}</td>
                <td>${r.nodeCount ?? '-'}</td>
                <td>${r.error || '-'}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';

        this.showBatchTestPanel('Batch Render Results', html);
        this.updateStatus(`Batch complete: ${successCount} queued, ${errorCount} failed`);
        this.elements.batchRenderBtn.disabled = false;
        this.elements.runTestsBtn.disabled = false;
    }

    private async runTests(): Promise<void> {
        this.elements.batchRenderBtn.disabled = true;
        this.elements.runTestsBtn.disabled = true;

        const results: TestResult[] = [];

        this.showBatchTestPanel('Running Tests...', '');

        for (let i = 0; i < templates.length; i++) {
            const template = templates[i];

            // Update progress
            const pct = Math.round(((i) / templates.length) * 100);
            this.elements.batchTestPanel.innerHTML = `
                <div class="batch-progress-text">${i + 1}/${templates.length}: ${template.name}</div>
                <div class="batch-progress-bar"><div class="batch-progress-fill" style="width:${pct}%">${pct}%</div></div>
            `;

            const checks: TestCheck[] = [];
            let nodeCount: number | undefined;
            let jsonSize: number | undefined;

            try {
                // Check 1: HTML renders without exception
                try {
                    this.renderHTMLContent(template.html);
                    await this.waitForRender(100);
                    checks.push({ name: 'HTML Render', passed: true });
                } catch (e) {
                    checks.push({ name: 'HTML Render', passed: false, error: (e as Error).message });
                }

                // Find target
                const children = Array.from(this.elements.previewContent.children);
                const targetElement = children.find(child =>
                    child.tagName !== 'STYLE' && child.tagName !== 'LINK'
                ) as Element | undefined;

                // Check 2: traverseDOM returns non-null
                let renderTree: RenderNode | null = null;
                try {
                    renderTree = targetElement ? traverseDOM(targetElement) : null;
                    checks.push({ name: 'traverseDOM', passed: renderTree !== null, error: renderTree === null ? 'returned null' : undefined });
                } catch (e) {
                    checks.push({ name: 'traverseDOM', passed: false, error: (e as Error).message });
                }

                // Check 3: renderToDesignDSL returns non-null
                let designNode: any = null;
                try {
                    designNode = renderTree ? renderToDesignDSL(renderTree) : null;
                    checks.push({ name: 'renderToDesignDSL', passed: designNode !== null, error: designNode === null ? 'returned null' : undefined });
                } catch (e) {
                    checks.push({ name: 'renderToDesignDSL', passed: false, error: (e as Error).message });
                }

                // Check 4: toFigmaJSON returns non-null
                let figmaNode: any = null;
                try {
                    figmaNode = designNode ? FigmaAdapter.toFigmaJSON(designNode) : null;
                    checks.push({ name: 'toFigmaJSON', passed: figmaNode !== null, error: figmaNode === null ? 'returned null' : undefined });
                } catch (e) {
                    checks.push({ name: 'toFigmaJSON', passed: false, error: (e as Error).message });
                }

                // Check 5: node count > 0
                if (figmaNode) {
                    nodeCount = this.countNodes(figmaNode);
                    checks.push({ name: 'Node Count > 0', passed: nodeCount > 0, error: nodeCount === 0 ? 'zero nodes' : undefined });
                } else {
                    checks.push({ name: 'Node Count > 0', passed: false, error: 'no figma node' });
                }

                // Check 6: Frame has width and height
                if (figmaNode) {
                    const hasSize = (figmaNode.width > 0 || figmaNode.absoluteBoundingBox?.width > 0) &&
                                    (figmaNode.height > 0 || figmaNode.absoluteBoundingBox?.height > 0);
                    checks.push({ name: 'Frame has size', passed: hasSize, error: hasSize ? undefined : `w=${figmaNode.width}, h=${figmaNode.height}` });
                } else {
                    checks.push({ name: 'Frame has size', passed: false, error: 'no figma node' });
                }

                // Compute JSON size
                if (figmaNode) {
                    try { jsonSize = JSON.stringify(figmaNode).length; } catch { /* ignore */ }
                }
            } catch (e) {
                checks.push({ name: 'Unexpected', passed: false, error: (e as Error).message });
            }

            const allPassed = checks.every(c => c.passed);
            results.push({ name: template.name, category: template.category, passed: allPassed, checks, nodeCount, jsonSize });
        }

        // Generate report
        const passedCount = results.filter(r => r.passed).length;
        const failedCount = results.filter(r => !r.passed).length;

        let html = `
            <div class="test-summary">
                <span class="summary-total">Total: ${results.length}</span>
                <span class="summary-passed">Passed: ${passedCount}</span>
                <span class="summary-failed">Failed: ${failedCount}</span>
            </div>
            <div style="max-height: 400px; overflow-y: auto;">
            <table class="test-report-table">
                <thead><tr><th>#</th><th>Template</th><th>Category</th><th>Status</th><th>Checks</th><th>Nodes</th><th>JSON Size</th></tr></thead>
                <tbody>
        `;
        results.forEach((r, idx) => {
            const statusClass = r.passed ? 'test-pass' : 'test-fail';
            const statusText = r.passed ? 'PASS' : 'FAIL';
            const failedChecks = r.checks.filter(c => !c.passed).map(c => `${c.name}: ${c.error}`).join('; ');
            const checksInfo = r.passed ? `${r.checks.length}/${r.checks.length}` : `<span title="${failedChecks}">${r.checks.filter(c => c.passed).length}/${r.checks.length}</span>`;
            const sizeStr = r.jsonSize != null ? `${(r.jsonSize / 1024).toFixed(1)} KB` : '-';
            html += `<tr>
                <td>${idx + 1}</td>
                <td>${r.name}</td>
                <td>${r.category}</td>
                <td class="${statusClass}">${statusText}</td>
                <td>${checksInfo}</td>
                <td>${r.nodeCount ?? '-'}</td>
                <td>${sizeStr}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';

        this.showBatchTestPanel('Test Report', html);
        this.updateStatus(`Tests complete: ${passedCount} passed, ${failedCount} failed`);
        this.elements.batchRenderBtn.disabled = false;
        this.elements.runTestsBtn.disabled = false;
    }

    private loadDefaultHTML(): void {
        // Load the Ruby Jewelry template as default
        const defaultTemplate = getTemplateByName('[Advanced] Ruby Jewelry Landing Page');
        if (defaultTemplate) {
            this.elements.templateSelect.value = defaultTemplate.name;
            this.elements.htmlInput.value = defaultTemplate.html;
            this.renderHTML();
        }
    }


    private handleKeyboardShortcuts(e: KeyboardEvent): void {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 'Enter':
                    e.preventDefault();
                    this.convertCurrentPreview();
                    break;
                case 'r':
                    e.preventDefault();
                    if (this.state.currentTab === 'html') {
                        this.renderHTML();
                    } else {
                        this.loadURL();
                    }
                    break;
            }
        }
        
        if (e.key === 'Escape' && this.state.isSelecting) {
            this.cancelElementSelection();
        }
    }

    private showLoading(message: string): void {
        this.elements.loadingOverlay.classList.remove('hidden');
        this.elements.loadingOverlay.querySelector('p')!.textContent = message;
    }

    private hideLoading(): void {
        this.elements.loadingOverlay.classList.add('hidden');
    }

    private updateStatus(message: string, isError: boolean = false): void {
        this.elements.statusText.textContent = message;
        this.elements.statusText.style.color = isError ? '#dc3545' : '#28a745';
        
        // Reset color after 3 seconds
        setTimeout(() => {
            this.elements.statusText.style.color = '';
        }, 3000);
    }

    private showError(message: string): void {
        alert(message); // In a real app, you'd use a proper modal/toast
    }

    // ========== JSON Analysis Methods ==========

    private displayAnalysis(figmaJson: FigmaFrameNode): void {
        const analysis = this.analyzeJSON(figmaJson);
        const analysisHtml = this.generateAnalysisHTML(analysis);
        this.elements.analysisContent.innerHTML = analysisHtml;
        
        // Add event listeners for collapsible sections
        this.addAnalysisEventListeners();
    }

    private analyzeJSON(figmaJson: FigmaFrameNode): any {
        const analysis = {
            overview: this.getOverviewStats(figmaJson),
            nodeHierarchy: this.analyzeNodeHierarchy(figmaJson),
            fillsAnalysis: this.analyzeFills(figmaJson),
            textAnalysis: this.analyzeText(figmaJson),
            layoutAnalysis: this.analyzeLayout(figmaJson)
        };
        
        return analysis;
    }

    private getOverviewStats(node: any): any {
        const stats = {
            totalNodes: 0,
            nodeTypes: {} as Record<string, number>,
            dimensions: { width: node.width, height: node.height },
            hasGradients: false,
            hasImages: false,
            textNodes: 0,
            maxDepth: 0
        };

        const traverse = (currentNode: any, depth: number = 0) => {
            stats.totalNodes++;
            stats.maxDepth = Math.max(stats.maxDepth, depth);
            
            // Count node types
            stats.nodeTypes[currentNode.type] = (stats.nodeTypes[currentNode.type] || 0) + 1;
            
            // Check for gradients
            if (currentNode.fills) {
                currentNode.fills.forEach((fill: any) => {
                    if (fill.type?.includes('GRADIENT')) {
                        stats.hasGradients = true;
                    }
                    if (fill.type === 'IMAGE') {
                        stats.hasImages = true;
                    }
                });
            }
            
            // Count text nodes
            if (currentNode.type === 'TEXT') {
                stats.textNodes++;
            }
            
            // Traverse children
            if (currentNode.children) {
                currentNode.children.forEach((child: any) => traverse(child, depth + 1));
            }
        };

        traverse(node);
        return stats;
    }

    private analyzeNodeHierarchy(node: any): any {
        const buildHierarchy = (currentNode: any, depth: number = 0): any => {
            const nodeInfo = {
                id: currentNode.id,
                name: currentNode.name,
                type: currentNode.type,
                depth: depth,
                position: { x: currentNode.x, y: currentNode.y },
                size: { width: currentNode.width, height: currentNode.height },
                children: [] as any[]
            };

            if (currentNode.children) {
                nodeInfo.children = currentNode.children.map((child: any) => 
                    buildHierarchy(child, depth + 1)
                );
            }

            return nodeInfo;
        };

        return buildHierarchy(node);
    }

    private analyzeFills(node: any): any {
        const fillsInfo = {
            totalFills: 0,
            solidFills: 0,
            gradientFills: 0,
            imageFills: 0,
            gradientDetails: [] as any[],
            colorPalette: [] as string[]
        };

        const traverse = (currentNode: any) => {
            if (currentNode.fills) {
                currentNode.fills.forEach((fill: any) => {
                    fillsInfo.totalFills++;
                    
                    switch (fill.type) {
                        case 'SOLID':
                            fillsInfo.solidFills++;
                            if (fill.color) {
                                const colorHex = this.rgbToHex(fill.color);
                                if (!fillsInfo.colorPalette.includes(colorHex)) {
                                    fillsInfo.colorPalette.push(colorHex);
                                }
                            }
                            break;
                        case 'GRADIENT_LINEAR':
                        case 'GRADIENT_RADIAL':
                        case 'GRADIENT_ANGULAR':
                        case 'GRADIENT_DIAMOND':
                            fillsInfo.gradientFills++;
                            fillsInfo.gradientDetails.push({
                                type: fill.type,
                                stopsCount: fill.gradientStops?.length || 0,
                                colors: fill.gradientStops?.map((stop: any) => this.rgbToHex(stop.color)) || []
                            });
                            break;
                        case 'IMAGE':
                            fillsInfo.imageFills++;
                            break;
                    }
                });
            }
            
            if (currentNode.children) {
                currentNode.children.forEach((child: any) => traverse(child));
            }
        };

        traverse(node);
        return fillsInfo;
    }

    private analyzeText(node: any): any {
        const textInfo = {
            totalTextNodes: 0,
            fonts: [] as string[],
            fontSizes: [] as number[],
            textLengths: [] as number[],
            alignments: {} as Record<string, number>
        };

        const traverse = (currentNode: any) => {
            if (currentNode.type === 'TEXT') {
                textInfo.totalTextNodes++;
                
                if (currentNode.fontName) {
                    const fontString = `${currentNode.fontName.family} ${currentNode.fontName.style}`;
                    if (!textInfo.fonts.includes(fontString)) {
                        textInfo.fonts.push(fontString);
                    }
                }
                
                if (currentNode.fontSize && !textInfo.fontSizes.includes(currentNode.fontSize)) {
                    textInfo.fontSizes.push(currentNode.fontSize);
                }
                
                if (currentNode.characters) {
                    textInfo.textLengths.push(currentNode.characters.length);
                }
                
                if (currentNode.textAlignHorizontal) {
                    textInfo.alignments[currentNode.textAlignHorizontal] = 
                        (textInfo.alignments[currentNode.textAlignHorizontal] || 0) + 1;
                }
            }
            
            if (currentNode.children) {
                currentNode.children.forEach((child: any) => traverse(child));
            }
        };

        traverse(node);
        textInfo.fontSizes.sort((a, b) => a - b);
        return textInfo;
    }

    private analyzeLayout(node: any): any {
        const layoutInfo = {
            totalFrames: 0,
            totalRectangles: 0,
            cornerRadiusUsage: [] as number[],
            positionDistribution: { x: [] as number[], y: [] as number[] },
            sizeDistribution: { width: [] as number[], height: [] as number[] }
        };

        const traverse = (currentNode: any) => {
            if (currentNode.type === 'FRAME') {
                layoutInfo.totalFrames++;
            } else if (currentNode.type === 'RECTANGLE') {
                layoutInfo.totalRectangles++;
            }
            
            if (currentNode.cornerRadius && currentNode.cornerRadius > 0) {
                layoutInfo.cornerRadiusUsage.push(currentNode.cornerRadius);
            }
            
            if (typeof currentNode.x === 'number') {
                layoutInfo.positionDistribution.x.push(currentNode.x);
            }
            if (typeof currentNode.y === 'number') {
                layoutInfo.positionDistribution.y.push(currentNode.y);
            }
            if (typeof currentNode.width === 'number') {
                layoutInfo.sizeDistribution.width.push(currentNode.width);
            }
            if (typeof currentNode.height === 'number') {
                layoutInfo.sizeDistribution.height.push(currentNode.height);
            }
            
            if (currentNode.children) {
                currentNode.children.forEach((child: any) => traverse(child));
            }
        };

        traverse(node);
        return layoutInfo;
    }

    private generateAnalysisHTML(analysis: any): string {
        return `
            <div class="analysis-sections">
                ${this.generateOverviewSection(analysis.overview)}
                ${this.generateHierarchySection(analysis.nodeHierarchy)}
                ${this.generateFillsSection(analysis.fillsAnalysis)}
                ${this.generateTextSection(analysis.textAnalysis)}
                ${this.generateLayoutSection(analysis.layoutAnalysis)}
            </div>
        `;
    }

    private generateOverviewSection(overview: any): string {
        return `
            <div class="analysis-section" data-section="overview">
                <div class="section-header collapsible">
                    <h3>📊 Overview Statistics</h3>
                    <span class="toggle-icon">▼</span>
                </div>
                <div class="section-content">
                    <div class="stats-grid">
                        <div class="stat-item">
                            <span class="stat-label">Total Nodes:</span>
                            <span class="stat-value">${overview.totalNodes}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Max Depth:</span>
                            <span class="stat-value">${overview.maxDepth}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Dimensions:</span>
                            <span class="stat-value">${overview.dimensions.width} × ${overview.dimensions.height}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Text Nodes:</span>
                            <span class="stat-value">${overview.textNodes}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Has Gradients:</span>
                            <span class="stat-value ${overview.hasGradients ? 'positive' : 'negative'}">${overview.hasGradients ? 'Yes' : 'No'}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Has Images:</span>
                            <span class="stat-value ${overview.hasImages ? 'positive' : 'negative'}">${overview.hasImages ? 'Yes' : 'No'}</span>
                        </div>
                    </div>
                    <div class="node-types">
                        <h4>Node Types Distribution:</h4>
                        ${Object.entries(overview.nodeTypes).map(([type, count]) => 
                            `<div class="node-type-item">
                                <span class="node-type">${type}:</span>
                                <span class="node-count">${count}</span>
                            </div>`
                        ).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    private generateHierarchySection(hierarchy: any): string {
        const renderNode = (node: any): string => {
            const hasChildren = node.children && node.children.length > 0;
            const indent = '  '.repeat(node.depth);
            
            return `
                <div class="hierarchy-node" data-depth="${node.depth}">
                    <div class="node-info">
                        <span class="node-indent">${indent}</span>
                        <span class="node-type-badge ${node.type.toLowerCase()}">${node.type}</span>
                        <span class="node-name">${node.name}</span>
                        <span class="node-details">
                            (${node.size.width}×${node.size.height}) at (${node.position.x}, ${node.position.y})
                        </span>
                    </div>
                    ${hasChildren ? node.children.map((child: any) => renderNode(child)).join('') : ''}
                </div>
            `;
        };

        return `
            <div class="analysis-section" data-section="hierarchy">
                <div class="section-header collapsible">
                    <h3>🏗️ Node Hierarchy</h3>
                    <span class="toggle-icon">▼</span>
                </div>
                <div class="section-content">
                    <div class="hierarchy-tree">
                        ${renderNode(hierarchy)}
                    </div>
                </div>
            </div>
        `;
    }

    private generateFillsSection(fills: any): string {
        return `
            <div class="analysis-section" data-section="fills">
                <div class="section-header collapsible">
                    <h3>🎨 Fills Analysis</h3>
                    <span class="toggle-icon">▼</span>
                </div>
                <div class="section-content">
                    <div class="fills-summary">
                        <div class="fill-stats">
                            <div class="fill-stat">
                                <span class="fill-type">Solid:</span>
                                <span class="fill-count">${fills.solidFills}</span>
                            </div>
                            <div class="fill-stat">
                                <span class="fill-type">Gradient:</span>
                                <span class="fill-count">${fills.gradientFills}</span>
                            </div>
                            <div class="fill-stat">
                                <span class="fill-type">Image:</span>
                                <span class="fill-count">${fills.imageFills}</span>
                            </div>
                        </div>
                        
                        ${fills.colorPalette.length > 0 ? `
                            <div class="color-palette">
                                <h4>Color Palette:</h4>
                                <div class="color-swatches">
                                    ${fills.colorPalette.map((color: string) => 
                                        `<div class="color-swatch" style="background-color: ${color}" title="${color}"></div>`
                                    ).join('')}
                                </div>
                            </div>
                        ` : ''}
                        
                        ${fills.gradientDetails.length > 0 ? `
                            <div class="gradient-details">
                                <h4>Gradient Details:</h4>
                                ${fills.gradientDetails.map((gradient: any, index: number) => `
                                    <div class="gradient-item">
                                        <span class="gradient-type">${gradient.type}</span>
                                        <span class="gradient-stops">${gradient.stopsCount} stops</span>
                                        <div class="gradient-colors">
                                            ${gradient.colors.map((color: string) => 
                                                `<div class="gradient-color" style="background-color: ${color}" title="${color}"></div>`
                                            ).join('')}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    private generateTextSection(text: any): string {
        return `
            <div class="analysis-section" data-section="text">
                <div class="section-header collapsible">
                    <h3>📝 Text Analysis</h3>
                    <span class="toggle-icon">▼</span>
                </div>
                <div class="section-content">
                    <div class="text-stats">
                        <div class="stat-item">
                            <span class="stat-label">Text Nodes:</span>
                            <span class="stat-value">${text.totalTextNodes}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Unique Fonts:</span>
                            <span class="stat-value">${text.fonts.length}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Font Sizes:</span>
                            <span class="stat-value">${text.fontSizes.join(', ')}px</span>
                        </div>
                    </div>
                    
                    ${text.fonts.length > 0 ? `
                        <div class="fonts-list">
                            <h4>Fonts Used:</h4>
                            ${text.fonts.map((font: string) => 
                                `<div class="font-item">${font}</div>`
                            ).join('')}
                        </div>
                    ` : ''}
                    
                    ${Object.keys(text.alignments).length > 0 ? `
                        <div class="text-alignments">
                            <h4>Text Alignments:</h4>
                            ${Object.entries(text.alignments).map(([alignment, count]) => 
                                `<div class="alignment-item">
                                    <span class="alignment">${alignment}:</span>
                                    <span class="count">${count}</span>
                                </div>`
                            ).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    private generateLayoutSection(layout: any): string {
        return `
            <div class="analysis-section" data-section="layout">
                <div class="section-header collapsible">
                    <h3>📐 Layout Analysis</h3>
                    <span class="toggle-icon">▼</span>
                </div>
                <div class="section-content">
                    <div class="layout-stats">
                        <div class="stat-item">
                            <span class="stat-label">Frames:</span>
                            <span class="stat-value">${layout.totalFrames}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Rectangles:</span>
                            <span class="stat-value">${layout.totalRectangles}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Corner Radius Used:</span>
                            <span class="stat-value">${layout.cornerRadiusUsage.length > 0 ? 'Yes' : 'No'}</span>
                        </div>
                    </div>
                    
                    ${layout.cornerRadiusUsage.length > 0 ? `
                        <div class="corner-radius-info">
                            <h4>Corner Radius Values:</h4>
                            <div class="radius-values">
                                ${[...new Set(layout.cornerRadiusUsage)].map(radius => 
                                    `<span class="radius-value">${radius}px</span>`
                                ).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    private addAnalysisEventListeners(): void {
        const collapsibleHeaders = this.elements.analysisContent.querySelectorAll('.section-header.collapsible');
        collapsibleHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const section = header.parentElement;
                const content = section?.querySelector('.section-content');
                const icon = header.querySelector('.toggle-icon');
                
                if (content && icon) {
                    const contentEl = content as HTMLElement;
                    const isExpanded = contentEl.style.display !== 'none';
                    contentEl.style.display = isExpanded ? 'none' : 'block';
                    icon.textContent = isExpanded ? '▶' : '▼';
                }
            });
        });
    }

    private expandAllAnalysis(): void {
        const contents = this.elements.analysisContent.querySelectorAll('.section-content');
        const icons = this.elements.analysisContent.querySelectorAll('.toggle-icon');
        
        contents.forEach(content => {
            (content as HTMLElement).style.display = 'block';
        });
        
        icons.forEach(icon => {
            icon.textContent = '▼';
        });
        
        this.updateStatus('All analysis sections expanded');
    }

    private collapseAllAnalysis(): void {
        const contents = this.elements.analysisContent.querySelectorAll('.section-content');
        const icons = this.elements.analysisContent.querySelectorAll('.toggle-icon');
        
        contents.forEach(content => {
            (content as HTMLElement).style.display = 'none';
        });
        
        icons.forEach(icon => {
            icon.textContent = '▶';
        });
        
        this.updateStatus('All analysis sections collapsed');
    }

    private clearAnalysis(): void {
        this.elements.analysisContent.innerHTML = '<div class="placeholder">JSON structure analysis will appear here after conversion</div>';
        this.updateStatus('Analysis cleared');
    }

    private rgbToHex(rgb: { r: number; g: number; b: number }): string {
        const toHex = (c: number) => {
            const hex = Math.round(c * 255).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
    }
}

// Initialize the demo when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new Html2FigmaDemo();
});

// Hot module replacement for development
if (import.meta.hot) {
    import.meta.hot.accept();
}
