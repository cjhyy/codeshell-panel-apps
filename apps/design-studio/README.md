# Design Studio Panel App

## 待发布：完整设计备份与恢复

顶栏“备份”可下载包含全部页面、图片和字体字节的完整设计备份（最多 128 MiB）。
尚未查看的索引页面也会加载；缺失或校验失败的资源会使下载失败，不生成缺少资源的包。
导入先显示来源、目标项目、页数和资源数，校验全部内容后由用户确认恢复路径。
恢复按只创建方式写入独立文件，保留当前画布、草稿和已有文件；可从打开文件入口选择
恢复出的副本。资源分片校验并保存后才提交主文件。中途失败可以重试，相同内容复用，
不同内容不覆盖；项目切换和关闭对话框会停止后续操作，已发出的写入仍可能完成。
来源信息仅用于核对，不授予原项目权限，也不把来源路径作为目标写入位置。

旧“草稿备份”可在同一入口选择具体草稿或主程序保存记录。日志内置基础设计时直接
核对重放；引用项目文件时，必须取得与记录的 SHA-256 版本一致的原文件，索引／分片
和图片／字体也逐项校验。基础版本变化、资源缺失、未知操作或记录不匹配时停止；
没有可校验基础版本的旧日志无法可靠重建，仍保留原数据。备份最多包含 256 条草稿，
单条日志最多 100000 个操作，恢复读取最多 128 MiB。校验只读，确认后才恢复为新文件。
“另存为”草稿使用恢复格式 v2 分别记录原基础文件和新保存目标，避免将新文件名
误当成基础设计。原文件版本变化时保留草稿并停止重放；较旧面板会保留不支持的 v2
记录而不解释它。尚未保存过的设计在反复恢复和编辑后仍保留内置基础设计。
完整备份只包含设计文档及其项目图片／字体，不包含其他项目文件。
导入验证不会执行备份中的代码或安装程序。本变更没有新增 Host 权限或发布版本。

真实 Node Host 验收（仅临时目录）：

```sh
node scripts/design-studio-portable-host.mjs /path/to/built/code-shell-server
```

## 待发布：项目恢复草稿的并发保护

支持版本校验的主程序上，自动恢复草稿按读取到的版本保存和删除。另一窗口修改后，
当前画布保留、自动覆盖停止，可下载带项目身份的草稿备份，再明确读取最新恢复记录。
保存响应丢失时先核对记录，不重复提交；读取失败或损坏记录不会被当作空记录覆盖或删除。
切换目录或会话都会停止旧操作，包括多个云端项目都使用 `/workspace` 的情况。
启动时先订阅上下文变化，较新的通知不会被迟到的初始读取覆盖。未确认的旧草稿
按每次项目切换分别保留，备份标明来源会话，不因目录同名互相覆盖，也不写入新项目。
新项目读取期间暂停编辑和自动草稿保存；此时下载备份只包含已确认来源的旧草稿，
不会把尚未切换完成的画布标成新项目。
这些页面内草稿不是持久备份，请在关闭前下载；备份保留操作记录及原项目／文件版本，
引用资源仍属于原项目，不是可独立迁移的完整设计包。旧主程序显示并发保护限制。
设计文件本身仍使用原来的文件版本校验和保存／另存流程。未发布新版本。

开发验收：`node scripts/design-studio-host-storage.mjs /absolute/path/to/built/server-package`
可将当前恢复模块连接到已构建的兼容 `@cjhyy/code-shell-server`，验证真实磁盘上的
并发、重启、项目隔离、撤销和条件删除；只创建并清理自己的临时项目，不启动服务。
该检查需要支持版本存储接口的 Host，不以旧公开包或内存模拟代替实际验收。


Design Studio 0.18 is an Agent-native CodeShell Desktop Panel App. One reviewed
installation contributes both its sandboxed visual editor and a narrow Agent
surface: thirteen declared design/delivery tools plus a repository-design Skill.

## What it does

- Vector canvas with selection, collapsible layer hierarchy, frames, alignment,
  distribution, snapping, rotation, zoom, pan, undo, and redo.
- A Figma-like three-column workspace: persistent pages and layers on the left, canvas in the
  center, and **设计 / 开发 / 文件** inspector tabs on the right.
- A PRD delivery flow that reads workspace Markdown/MDX/text into goals, users, stable requirement
  IDs, screens, acceptance criteria, and constraints before handing the structured brief to the
  current Agent.
- Deterministic Design v3 → HTML generation. Auto Layout becomes Flex/Grid/Wrap, dual-axis
  Hug/Fill/Fixed stays responsive, absolute layout children retain Constraints, and every layer
  keeps `data-codeshell-id` / `data-codeshell-source-id` traceability.
- Same-viewport design/implementation comparison with pixel similarity, changed-pixel ratio,
  stable-ID coverage, per-node geometry/style differences, a three-up preview, and a Markdown
  report written beside the frontend implementation.
- Figma-style horizontal, vertical, wrapped, reverse-flow, and Grid layout with independent
  row/column gaps, asymmetric padding, Baseline alignment, Min/Max bounds, column/row spans,
  dual-axis Hug/Fill/Fixed sizing, and absolute children excluded from flow. Absolute children
  support start, center, end, stretch, and scale Constraints; flow children support CSS-style
  leading auto margin.
- Reusable master components, cross-page/nested instance rendering, cycle-safe composition, and
  bounded acyclic expansion so repeated instances cannot exhaust the canvas or exporter.
- Repository-stable font family, 100–900 weights, italic, letter spacing, text decoration, and
  portable multiline SVG text that does not collapse in native preview renderers.
- Repository-stable drop shadows rendered consistently in canvas screenshots and SVG exports.
- Browser-rendered HTML capture that measures computed layout, typography, borders, clipping,
  shadows, and basic inline SVG rectangles/circles/ellipses; it maps supported CSS Flex/Grid/Wrap
  and absolute-child semantics to editable v3 Auto Layout, preserves form values, wrapping,
  ellipsis, and text baselines, and keeps measured coordinates as exact initial geometry and
  fallback data.
- A guarded **HTML** import dialog and `import_html` Agent tool for workspace-local files: scripts
  and network resources are removed, linked local CSS is inlined, the target viewport is isolated,
  fully offscreen descendants are omitted from the first-screen capture, and the converted document
  remains undoable and revision-guarded. Import results report canonical document bytes for
  performance tracking without treating a Host request budget as a document limit.
- Document color tokens whose UI or Agent edits propagate simultaneously through matching canvas,
  fill, stroke, and shadow colors without corrupting color swaps.
- Deterministic v3 `.codesign.json` documents with a compact page switcher, multi-page editing, and
  deeply nested layers. A logical document has no whole-file byte cap: small designs stay in one
  JSON source, while larger designs keep the same primary path as a checked page index and store
  immutable, content-addressed page objects under `designs/codesign-data/`. Saving reuses unchanged
  pages and commits the primary index only after every changed page object is available. Legacy
  monolithic and `codeshell.design.bundle` documents migrate to the page index on their next save.
- An indexed-page runtime that opens only the active page plus transitive component-provider pages,
  keeps clean pages in a bounded LRU cache, pins dirty pages and their dependencies, and loads a
  requested page on demand. Metadata stays lightweight; full validation and export deliberately
  materialize every page.
- A content-addressed image/font library under `designs/codesign-data/images/` and `fonts/`.
  Documents keep stable `imageRef`/`fontRef` descriptors rather than embedded binary payloads;
  identical bytes reuse the same verified objects. The Agent resource tool accepts small inline
  Base64 or ordered workspace `.txt` chunks, so larger assets do not require larger tool arguments.
- Operation-log undo, redo, and crash recovery. Recovery stores the delta from the last saved
  baseline and spills large logs into checked content-addressed chunks, avoiding repeated
  whole-document snapshots in app storage.
- Automatic binding to the current repository: recovery first, then the repository's last-opened
  design, then `designs/design.codesign.json`, then the newest remaining design, otherwise a blank
  repo document at the default path.
- A repository file tab that lists every `designs/**/*.codesign.json` document, shows the active
  file and file count, and supports one-click switching or explicit refresh without leaving the
  editor.
- Live reload when an Agent or editor changes the active source file and the
  canvas has no conflicting local edits; stale file-open or sync reads cannot overwrite a newer
  in-memory transaction, and an external check started before a local save cannot mistake that
  save for somebody else's edit.
- Reviewable SVG previews and whole-document accessibility/layout audits that identify the page for
  every issue, detect meaningful rounded-corner clipping, and recompute text contrast in each
  component-instance context after scaling and opacity composition.
- Agent-visible page or full-visible-subtree node screenshots from any page, including
  component-master descendant geometry and shadows in instance crops, for an edit → validate →
  inspect → refine loop. Read tools wait for queued saves without mutating the live document, and a
  screenshot fails closed if its source changes during image rendering.
- Optimistic-concurrency checks before overwriting repository files.
- A required live `stateRevision` guard on Agent edits and explicit saves, covering unsaved human
  edits, undo/redo, page switches, `save: false` Agent transactions, and workspace changes.
- Explicit Host permissions for workspace access, app storage, current-session
  context, and optional prompt submission.
- Structured Agent reads, transactional edits, blocking validation, screenshots,
  design-system search across tokens and component masters,
  serialized mutation/read consistency, pending field/drag settlement at the Agent boundary, safe
  latest-transaction rollback, workspace-transition and complete queued UI-save settlement before
  Agent access, temporary interaction locking during Agent writes, user-aware selection
  restoration/preservation, net-zero transactions that cannot replace the latest real rollback
  token, and state-aware serialized saves that cannot silently reuse an older in-flight snapshot or
  be skipped after an earlier save fails.
- Agent page transactions for create, rename, activate, and delete, kept separate from node edits so
  layout work cannot leak across pages. A component-library page cannot be deleted while another
  page still contains instances linked to its masters.
- Visual-region screenshots crop to rendered geometry: rotated node outlines and rounded/rotated
  clipping ancestors are intersected before cropping, clipped descendants and organizational group
  bounds cannot add blank margins, while non-clipped component-master overflow and effects remain
  visible on instance crops.

Nested node geometry uses absolute canvas coordinates. Manual-layout containers preserve
Agent-authored `x/y`; auto-layout containers own direct flow children while
`layoutPositioning: "absolute"` children retain their coordinates. Reflow runs only after relevant
structural, visibility, sizing, or layout-property changes. Direct canvas dragging, nudging,
alignment, and distribution cannot bypass flow ownership. Agent-created
nodes require a stable lowercase, hyphen-separated semantic id so transactions are
reproducible and later operations can address every new node explicitly.

## Install

Open **Extensions → Panel Apps → From folder**, then select this directory.
CodeShell validates `.codeshell-panel/panel.json`, shows a permission review,
and installs it into the independent Panel App registry.

Continue editing this directory in the repository. To load those changes, use
**Extensions → Panel Apps → Update from source** on the Design Studio card,
review the new package digest and permissions, then confirm the update.

Design files belong to the repository that is currently open in CodeShell and
live below `designs/`. They are not shared globally between projects. The panel
header shows the connected repository, and the inspector's **文件** tab keeps
that repository's `.codesign.json` files visible with the current document
highlighted. The top-bar file picker remains available for keyboard-driven
switching.

The optional repository checker is bundled at `app/tools/check-design.mjs`. Run it from the
repository root to make canonical JSON and a zero-warning audit a CI-style gate:

```sh
node examples/panel-apps/design-studio/app/tools/check-design.mjs \
  --strict-audit designs/design.codesign.json
```

Add `--check-svg` when the repository also keeps a sibling generated SVG preview and it must match
the current active page exactly.

The checker resolves indexed and legacy large-document manifests automatically and verifies every
page and referenced resource object's byte length plus complete SHA-256 before normalizing or
auditing the reconstructed v3 document. Do not edit `designs/codesign-data/` objects directly;
save through Design Studio so the primary index changes only after every changed immutable object
is available.

## HTML fidelity fixture

Use the top-bar **HTML** action to convert a workspace-relative `.html` file, or call the
revision-guarded `import_html` Agent tool. The reusable browser capture helper lives at
`app/html-capture.mjs`. The fixture at
`tests/fixtures/design-studio-html-capture/` renders a representative product UI in `mode=source`
and the captured Design SVG in `mode=converted`. Capture both at the same 960×640 viewport and
compare their pixels; the source, converted, and amplified difference images make baseline,
shadow, clipping, and corner errors visible before they reach a real design.

Run the same-browser regression from this collection repository:

```sh
npm run test:fidelity -- --output artifacts/design-studio-html-fidelity
```

The command writes source, measured conversion, reflowed conversion, side-by-side, amplified
pixel-difference, captured/reflowed `.codesign.json`, and JSON report artifacts. The measured
conversion fails unless windowed SSIM is at least `0.99`, pixels changing by more than 8 channel
levels stay at or below `1%`, and pixels changing by more than 24 levels stay at or below `0.6%`.
The fixture must retain at least 20 Auto Layout containers. After resolving those layouts once,
windowed SSIM must remain at least `0.86`, with the changed-pixel ratios at or below `8%` and
`6%`. Both documents must have zero blocking audit issues. The measured-import gate remains strict;
the broader reflow gate allows small browser-to-SVG text and semantic-layout differences while
still rejecting visible structural drift.
Browser-measured text bounds and explicitly clipped imported effects remain tagged in the editable
document so the audit does not replace exact geometry with fallback estimates; real contrast,
layout, and clipping issues still fail validation normally.

The broader offline parity suite adapts 20 representative cases from html2figma's 64-template
catalog and checks each at its import width and after a 760→520 px reflow:

```sh
npm run test:fidelity:cases -- --output artifacts/design-studio-html2figma-cases
```

It covers Hug/Fill/Fixed, Min/Max, reverse flow, Wrap, Grid spans, absolute Constraints,
navigation, cards, forms, tables, inline text, ellipsis, lists, SVG primitives, borders/shadows,
nesting, dashboards, and Baseline alignment. Every case writes
source/converted/diff/side-by-side images, editable design sources, metrics, and audit codes. The
varied suite gates initial SSIM at `0.94`, reflow SSIM at `0.87`,
changed pixels over 24 channel levels at `8%`/`12%`, and blocking issues at zero. See
`tests/fixtures/design-studio-html2figma-cases/README.md` in the collection repository for the
source-to-case coverage matrix.

The reverse delivery gate starts from the captured Design v3 file, generates editable HTML, renders
that HTML, captures it back to Design v3, and measures both pixels and stable layer identities:

```sh
npm run test:fidelity:delivery -- --output artifacts/design-studio-delivery-fidelity
```

The realistic 960×640 fixture requires at least 88% pixel similarity, at most 18% of pixels
changing by more than 24 channel levels, at least 90% stable-ID coverage, and no matched node
drifting more than 24px. Artifacts include the design and frontend screenshots, amplified diff,
side-by-side image, generated HTML, round-trip design, and JSON report.

For manual validation against changing public pages, use the opt-in real-page probe:

```sh
npm run test:fidelity:real -- --output artifacts/design-studio-real-html-fidelity
```

The curated presets exercise a modern Bootstrap page, the dense Hacker News table layout, and a
W3C fixed-position example. Pass `--url`, `--selector`, `--width`, and `--height` to inspect another
page. This network-dependent probe is diagnostic rather than a CI gate.

This path deliberately captures the browser's computed result after fonts and layout settle.
The product importer captures the visible first viewport rather than the root's entire scrolling
height. Partially visible layers retain their measured geometry behind an intentional root clip;
fully offscreen descendants are not serialized. Choose a tighter root selector when the desired
design is one visible region instead of the complete viewport.
Flex rows/columns map reverse direction, Wrap/Wrap Reverse, axis gaps, four-side padding, Baseline,
Min/Max, alignment, distribution, and Fill/Fixed sizing into v3. Grid maps equal computed columns
and row/column spans; direct absolute/fixed children are excluded from flow and retain measured
Constraints. Opaque uniform borders remain editable decorations without forcing a manual-layout
fallback. Unequal Flex grow, floats, unequal Grid tracks, and decoration-heavy controls keep
measured manual geometry.
It is not an HTML parser and does not promise fidelity for unsupported visual primitives such as
raster images, SVG paths, gradients, pseudo-elements, multiple shadows, or four independently
editable corner radii.

## Package boundary

Renderable code lives under `app/`. The declarative Agent contribution lives
under `agent/`: the manifest declares every callable tool, handlers execute
inside the panel sandbox, and the bundled Skill is read-only Markdown. The
installer still rejects traditional plugin backends, hooks, commands, and MCP
configuration, so one install does not collapse the runtime isolation.
