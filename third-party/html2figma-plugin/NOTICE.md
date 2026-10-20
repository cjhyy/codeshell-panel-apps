# html2figma plugin adaptation

Upstream: https://github.com/cjhyy/html2figma
Pinned commit: `ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c`.
Attribution: html2figma contributors.

Original files from `packages/plugin`, `packages/figma`, and `packages/adapter`
are retained byte-for-byte in `upstream/`; `sources.json` records their SHA-256.
The plugin source provides the import-design message/service integration pattern;
the shipped offline adaptation under `integration/` replaces server API conversion,
React UI, network image downloads and settings with embedded browser conversion,
static HTML preview, local selected resources, and bounded validated JSON.
A fixed bundled capture script runs in an opaque iframe under a random nonce CSP;
user HTML scripts are removed and receive no execution permission.
Safe HTML anchor attributes retain authored link-selector styles. Capture frames
are inert, and the reviewed runtime cancels click, auxiliary-click and submit
defaults; retaining an anchor attribute does not authorize navigation or fetching.
It directly bundles upstream FigmaAdapter, FigmaService, NodeCreatorFactory and
creators. The existing CodeShell Design Bridge remains a separate plugin.

Browser DOM conversion and shared helper/types are reused from the separately
inventoried html2figma source snapshot at the same commit. No runtime dependency
on either original checkout or server is required.

This standalone adapter explicitly selects the browser converter's legacy
synthetic Grid rows/cells, with a retained compatibility warning. Its native
adapter does not yet implement native Figma Grid. The separate Design Studio
workbench uses original Grid capture and the v3 Design Bridge for that path;
both build receipts record their Grid capture mode.

The maintained gradient adapter uses bounded structured CSS angle/stop parsing
for an editable native snapshot and reports native resizing limitations. The
separate v3 Design Bridge retains authored geometry intent; the standalone
adapter does not claim responsive CSS gradient semantics inside native Figma.

Upstream package.json and README declare MIT. There is no standalone LICENSE,
COPYING or NOTICE in the pinned upstream tree; the original declarations are
preserved and this notice does not invent an upstream copyright statement.

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

The standalone compatibility adapter retains its existing centered uniform CSS
border conversion and now carries a visible side/alignment loss warning through
preview, downloaded JSON and native creation. Design Studio/Design Bridge uses
the separately maintained bounded inside-side representation.

The standalone float adapter remains measured/manual and retains a visible
percentage-flow loss warning in preview, downloaded JSON and native creation.
Bounded native float-column Grid recovery belongs to Design Studio/Design Bridge.
