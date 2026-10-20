# html2figma browser source

The browser conversion code is copied without edits from html2figma commit
`ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c`. `sources.json` records every original
file's bytes and SHA-256, plus a SHA-256 of that inventory. The source snapshot
does not include the server, extension, Figma adapter, plugin, image upload
handlers, dependencies, or untracked files from the original checkout.

The upstream root and package manifests and README declare the MIT license.
Those original declarations are retained under `upstream/`. The pinned upstream
tree contains no standalone LICENSE, COPYING, or NOTICE file; this notice does
not invent an upstream copyright statement. Attribution: html2figma contributors.

The local integration is under `integration/`. It selects only
`traverseDOM` → `renderToDesignDSL` and replaces the upstream shared logger with
silent functions, so importing the runtime creates no global logger or console
output. The builder rewrites DOM globals to the caller root's own window. A
fresh static function closure is created on every conversion; no eval, injected
script, shared current-window state, host-global monkey patch, network request,
or server codec is involved.

Rebuild from this repository alone:

```sh
node scripts/build-html2figma-browser.mjs
node scripts/build-html2figma-browser.mjs --check
```

`build.json` records the esbuild version, original-source inventory hash, exact
bundle hash, and input files. The installable ESM is
`apps/design-studio/app/vendor/html2figma-browser.mjs`; it requires no runtime
imports or local source checkout. The caller owns safe HTML rendering, resource
loading, input bounds, and adapter validation. This module measures an existing
DOM; it does not itself create or load HTML documents.

The integration also records CSS Typed OM width, height, flex basis, and margins
as `cssLayout` on element-backed DesignNodes. These values retain `auto`,
percentages and intrinsic sizing keywords separately from the upstream measured
pixel bounds. Anonymous text never inherits its parent's box sizing. Browsers
without CSS Typed OM retain the original measured conversion. The v3 adapter
uses this metadata for editable Hug/Fill/Fixed sizing, definite cross-axis sizes,
and main-axis auto margins. Uniform nonnegative flex margins become container
insets and item/line gaps; unsupported nonuniform or negative margins retain a
conversion diagnostic rather than claiming preserved Auto Layout behavior.

An element-backed `cssEmptyBlock: true` hint records a live empty ordinary block:
no child elements, only collapsible ASCII whitespace, and no generated before,
after, form, or list-marker content. The v3 adapter can retain its padding as
vertical Auto Layout without mistaking an empty converted child list for proof
that captured text was absent. Intrinsic controls and replaced elements remain
measured; the hint does not modify the immutable upstream source or DOM.

Grid capture keeps original direct items outside the upstream synthetic Flex
row/cell postprocessor. Each item still uses the pinned converter, with measured
parent-relative bounds; anonymous text retains its actual parent's text style.
Typed OM separately retains track definitions, row flow, numeric lines/spans,
item alignment, gaps, box sizing, and original `auto` dimensions. The v3 adapter
supports up to 24 tracks per axis: fixed px, `minmax(0, Nfr)`, bounded integer
`repeat`, and `max-content` Hug tracks. Bare `fr` requires a zero automatic
minimum. Automatic row flow and spans, or uniformly explicit positive row/column
lines, preserve native Grid placement; auto-sized stretched children become Fill.
Pure implicit Hug rows can grow with native automatic rows. Other implicit row
patterns retain measured counts with an explicit editing diagnostic.

Unsupported Grid intent retains the original measured items and a diagnostic:
percentage tracks/gaps, nonzero `minmax` minima, named/negative lines or areas,
auto-fit/auto-fill, dense/column flow, mixed/partial explicit placement, track
distribution, intrinsic stretch cycles, relative offsets/transformed flow items,
anonymous text line boxes, shrink-to-fit constraints, and automatic image aspect
ratios during Fill resizing. Missing Typed OM is diagnosed rather than treating
resolved pixel tracks as authored fixed tracks. Track strings, repeat expansion,
and placement loops are bounded before native layout construction. Semantics
follow the [CSS Grid specification](https://www.w3.org/TR/css-grid/); native
interchange also respects Figma's Grid/Hug/Fill limitations.

The standalone HTML-to-Figma plugin explicitly selects `preserveGrid:false`:
its pinned native adapter still expects the legacy synthetic Flex rows/cells.
That path carries a visible Grid fallback warning through preview, downloaded
JSON, and import. The workbench uses the default original-Grid capture and its
separate v3 Design Bridge creates supported native Figma Grid layouts. Both
build receipts record their selected Grid capture mode.

Inline SVG resources are serialized from detached clones with explicit SVG and
XLink namespaces. Same-document `#id` references, including chained `use`, paint,
and clipping definitions, are copied into the resource; the measured document
is unchanged. The visible SVG's paint context preserves inherited `currentColor`.
External, missing, or cyclic references, duplicate IDs, and active SVG content fail
before import. Each resource is bounded to 2,000 elements, 256 referenced IDs,
32 nesting/reference levels, and 1 MiB; the normal inert SVG and portable-resource
validators still run afterward. This does not add remote resource loading.

## MIT license terms

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

The maintained capture also retains shape-outside to bound isolated percentage
float-column recovery. Design Studio can project a proven single row onto existing
native Grid tracks/spans; no media-query or general float wrapping engine is added.

The maintained wrapper optionally reports real source elements to its caller for
capture-local semantic identity. Design Studio uses those in-memory bindings for
bounded plain block text recovery when class selectors repeat; DOM objects are
never serialized. Duplicate identities retain the unique-selector fallback and
an explicit diagnostic. Original ASCII whitespace and NBSP remain distinct.
