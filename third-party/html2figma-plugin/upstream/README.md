# HTML2Figma

Convert HTML/DOM to Figma design nodes via a universal DesignNode DSL that preserves HTML/CSS semantics.

## Architecture

```
DOM Element
    |  traverseDOM()
    v
RenderNode (browser-specific, holds DOM refs)
    |  renderToDesignDSL()
    v
DesignNode DSL (universal, serializable JSON)
    |  FigmaAdapter.toFigmaJSON()
    v
FigmaJSON (Figma API structure)
    |  FigmaService.addLayersToFrame()
    v
Figma Canvas
```

## Project Structure

```
packages/
├── shared/     @html2figma/shared    Shared types (DesignNode DSL, Figma types), CSS utils, logger
├── browser/    @html2figma/browser   DOM traversal + DesignNode DSL conversion (lib + standalone IIFE)
├── adapter/    @html2figma/adapter   DesignNode → FigmaJSON adapter (source-only, no build step)
├── figma/      @html2figma/figma     Figma node creation service (FigmaService, NodeCreatorFactory)
├── plugin/     @html2figma/plugin    Production Figma plugin ("Tanka")
└── test/       @html2figma/test      Test web app (localhost:3000) + test Figma plugin
```

## Prerequisites

- Node.js >= 20.9.0
- pnpm >= 8.0.0

```bash
npm install -g pnpm
```

## Installation

```bash
pnpm install
```

## Commands

```bash
# Build
pnpm build                 # Build all packages
pnpm build:browser          # Build browser package (lib)
pnpm build:standalone       # Build standalone IIFE bundle
pnpm build:figma            # Build figma service package
pnpm build:plugin           # Build production Figma plugin
pnpm build:plugin:dev       # Build Figma plugin with localhost sync tools
pnpm build:shared           # Build shared types package
pnpm sync:standalone        # Copy standalone IIFE to test/web/asset/

# Development
pnpm dev                    # Start test dev server on localhost:3000
pnpm dev:web                # Start the Next.js web app

# Test plugin (static build, not HMR — must rebuild manually)
pnpm --filter='@html2figma/test' run build:plugin

# Maintenance
pnpm clean                  # Clean all packages and node_modules
pnpm clean:dist             # Clean dist folders only
pnpm type-check             # Run type checking across all packages
```

## Packages

### @html2figma/shared

Core types and utilities shared across all packages.

- **DesignNode DSL** — universal, serializable format representing visual elements
- **Figma types** — TypeScript definitions for Figma API structures
- **CSS utils** — CSS parsing and value conversion helpers
- **Logger** — configurable logger with per-module filtering

### @html2figma/browser

Browser-side DOM traversal and DesignNode conversion pipeline.

**Stage 1 — Traversal:**
- `traverseDOM(element, options?)` — DOM Element to RenderNode tree

**Stage 2 — Conversion:**
- `renderToDesignDSL(renderNode)` — RenderNode to DesignNode DSL (pure JSON)

**Debug:**
- `renderTreeToJSON(renderNode)` — serialize RenderNode for inspection

**Resolvers:** background, border, effects, layout, positioning, transform, text, images

**Standalone IIFE bundle** (`dist/standalone.iife.js`) exposes `window.Html2Figma`:
- `convert(element)` — Element to FigmaJSON
- `convertToDesignDSL(element)` — Element to DesignNode
- `convertBySelector(selector)` — query selector to FigmaJSON
- `convertPage()` — full page conversion

### @html2figma/adapter

Pure data transformation from DesignNode DSL to Figma JSON. No build step — consumed as source via Vite aliases.

- `FigmaAdapter.toFigmaJSON(designNode)` — main entry point
- Node, layout, style, and text mappers

### @html2figma/figma

Figma Plugin API service layer. Creates actual Figma nodes on canvas.

- `createFigmaService(figmaApi, options)` — factory function
- `FigmaService.addLayersToFrame(figmaJSON, parentFrame)` — renders FigmaJSON to canvas
- Node creators: Frame, Rectangle, Text, Group
- Processors: Style, Layout, Image, Text

### @html2figma/plugin

Production Figma plugin ("Tanka"). Full UI with HTML input, URL import, and live conversion.

### @html2figma/test

Test web application and test Figma plugin for development.

**Web app** (localhost:3000):
- Template selector with categorized HTML test templates
- Live preview, Figma JSON output, DOM render tree, structure analysis
- Source/Standalone mode toggle
- Conversion log download
- **Batch Render** — converts all templates (or by category) and pushes to FIFO queue for plugin consumption
- **Run Tests** — automated 6-check pipeline validation per template (no Figma needed)

**Test plugin:**
- Auto-polls dev server for FigmaJSON data
- Queue-aware: consumes batch queue items with `importInProgress` guard
- Grid layout for batch renders (wraps after 4000px width)

**API endpoints:**

| Endpoint | Method | Description |
|---|---|---|
| `/api/result` | POST | Store single result |
| `/api/result` | GET | Get latest single result |
| `/api/result?mode=queue` | POST | Push to batch queue |
| `/api/result?mode=queue` | GET | Consume (shift) from batch queue |
| `/api/queue/status` | GET | Queue length `{ length }` |
| `/api/log` | POST | Send conversion logs to terminal |

## Dependency Graph

```
@html2figma/shared          (no dependencies)
        |
@html2figma/adapter         (shared)
        |
@html2figma/browser         (shared, adapter)
@html2figma/figma           (shared, adapter)
        |
@html2figma/plugin          (shared, figma, browser)
@html2figma/test            (shared, browser, adapter, figma)
```

## Docs

- [端到端回归闭环方案](docs/e2e-regression-pipeline.md)
- [仓库精简方案](docs/repo-simplification-plan.md)
- [开发准则：浏览器渲染一致性](docs/dev-guidelines.md)

The Next.js web app requires Supabase environment variables. Copy
`packages/web/.env.example` to `packages/web/.env.local` before running it; see
`packages/web/README.md` for setup details.

## License

MIT
