# CodeShell HTML to Figma

独立、离线的 Figma 开发插件。HTML 先生成静态预览，经 html2figma DOM 引擎和原生 Figma adapter 转换，再由上游 FigmaService 创建可编辑 FRAME、TEXT、RECTANGLE、SVG 图层。无需 CodeShell、Node、服务地址、API Key 或 CDN。

## 安装

本包的 `manifest.json` 是开发插件模板，尚未包含 `id`。Figma 要求使用它为你的插件分配的 ID；先完成下列注册步骤，再导入本包。

1. 解压整个 `html-to-figma-plugin` 目录，保留 `manifest.json`、`code.js`、`ui.html`、README 和 NOTICE。
2. 在 **Figma Desktop → Plugins → Development → New Plugin / Create new plugin** 创建一个**带 UI 的插件**，名称可填 **CodeShell HTML to Figma**，选择保存位置。
3. 打开 Figma 刚生成的 `manifest.json`，复制其中 **Figma 分配的 `id` 值**。
4. 编辑本包 `html-to-figma-plugin/manifest.json`，添加 `"id"` 字段并粘贴刚复制的值；保留本包的 `main: "code.js"`、`ui: "ui.html"`、`documentAccess` 和离线 `networkAccess` 设置。不要使用上游插件的 ID，也不要自行编造 ID。
5. 回到 **Plugins → Development → Import plugin from manifest**，选择**已填入该 ID 的本包 `manifest.json`**。若 Figma 已登记了创建时的模板路径，将开发插件导入路径改为本包；运行的文件应是本包 `code.js` 和 `ui.html`。
6. 在目标设计文件运行 **CodeShell HTML to Figma**。

注册和填写 ID 仅需首次安装时完成；更新本包后仍使用同一个 Figma 分配的 ID。源码构建会生成不含 ID 的通用模板，请在用于运行的副本中保留或重新填入你的 ID。

## HTML → 预览 → 图层

粘贴 HTML 或选择 `.html` / `.htm` 文件，设置画布宽高和根选择器，点击 **预览并转换**，检查后点击 **创建可编辑图层**。每次新增独立根节点，不修改原图层；完成后选中新图层，可用 Figma Undo 撤销。

引用本地 CSS、图片、字体时，在「本地 CSS、图片和字体」选择 HTML 所在文件夹，再选择其中的 HTML。相对路径保留，文件不上传。支持内联 CSS、内嵌图片/字体、静态 SVG；不会执行 HTML 脚本或加载远程资源。需要 JS 才渲染的 SPA 应先导出静态 HTML。随机 nonce CSP、无同源权限的 sandbox（只运行内置转换代码）和 Figma `networkAccess: none` 共同限制网络与执行。

## 原生 JSON

切换 **html2figma DesignNode / Figma JSON**，粘贴或选择 JSON。接受单个 DesignNode（`nodeType`）、原生 FigmaJSON（`type`）、根节点数组或 `{ "nodes": [...] }` 包装。预览显示第一个根节点的静态布局；最多导入 20 个根节点。可以下载转换后的 FigmaJSON。

CodeShell v3 文档、设计备份、Figma REST `document` 包装及增量补丁请使用另一个 **CodeShell Design Bridge** 插件；原 Bridge 的工作流保留。

## 范围与限制

- HTML + CSS 最多 512 KiB；JSON 最多 12 MiB；3000 个输入/映射后节点，60 层；画布宽高 100–10000。
- 本地文件选择最多 2000 项；图片/字体单项 8 MiB、合计 12 MiB；图片最多 8192 像素边长、1600 万像素。JSON 图片须内嵌 data URL 或属于当前 Figma 文件的 imageHash；不下载外链。
- 保留上游布局、文字、渐变、阴影、矢量与语义映射能力；复杂 CSS 的结果仍受 html2figma/Figma 表达范围限制，不保证像素完全一致。字体须在 Figma 可用，缺失字体会提示并回退到 Inter Regular；HTML 内嵌字体只用于浏览器预览，不会安装字体。
- 上游 GROUP 适配为 FRAME。HTML 预览是浏览器渲染，JSON 预览是简化布局，不是 Figma 原生渲染。
- 非直角 CSS 渐变与像素色标按当前尺寸创建为可编辑原生渐变，并提示原生改尺寸可能改变外观。保留原始 CSS 角度／单位并继续响应式编辑时，请使用 Design Studio → Design Bridge 的 v3 工作流。
- 本独立插件的 Grid 仍使用上游测量像素的 Flex 行／固定几何兼容路径；预览、下载 JSON 和创建结果会提示原生轨道与响应式尺寸未保留。需要可编辑原生 Grid 时，请通过 Design Studio 的 HTML 导入，再使用 Design Bridge；该路径保留可表达的固定／Flex／Hug 轨道与 Fill 子项。本插件构建回执记录 `legacy-synthetic-with-diagnostics`，工作台浏览器引擎默认保留原 Grid 结构。
- CSS 边框在本独立插件仍使用统一居中描边兼容路径；预览、下载 JSON 和创建结果会提示各侧宽度、颜色与内部对齐未保留。需要可编辑原生侧边时，请使用 Design Studio → Design Bridge；多色侧边可保留在 v3 / SVG / HTML，Figma 原生导出会明确拒绝不支持的多色组合。
- 创建后核对每个非空 TEXT 的完整文字（富文本按完整字符串核对，不重复拼接样式范围）。文字缺失、截断或被替换时，本次导入失败并移除新节点、恢复原选择；上游显式报告的 creator 错误同样回滚。读取/预览不会修改设计。
- 字体、富文本范围样式和复杂效果可能随 Figma 可用能力回退；成功结果会提示检查视觉效果。文字完整性校验不保证每项样式、布局或全部 Figma API 属性完全保真。

## 来源与构建

基于 html2figma commit `ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c`，MIT 声明与完整条款见 `NOTICE.md`。原插件 UI 的 HTML 导入依赖 `/api/convert/html`；此版本用本地预览与内置 DOM 转换替换该服务步骤，实际复用原生 Figma adapter、FigmaService、NodeCreatorFactory 和 creators，不是把 CodeShell Design Bridge 改名。

源码、原文件 SHA-256 清单和离线适配位于仓库 `third-party/html2figma-plugin/`；浏览器引擎来源位于 `third-party/html2figma/`。从仓库独立构建：

```sh
npm ci
node scripts/build-design-studio-html-plugin.mjs
node scripts/build-design-studio-html-plugin.mjs --check
node --test tests/apps/design-studio/html-plugin.test.mjs tests/apps/design-studio/html-plugin-ui.test.mjs
```

测试包含真实 Chromium 插件 iframe + sandbox HTML 预览，以及真实上游服务连接的 fake Figma API 创建/回滚验证。它们不代表真实 Figma 账号内的字体、图层 setter 或渲染验收；本次未写入真实 Figma 文件。
