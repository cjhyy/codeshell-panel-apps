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
