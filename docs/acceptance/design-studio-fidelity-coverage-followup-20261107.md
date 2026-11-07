# Design Studio 保真覆盖补测：高风险路径与 DPR1（2026-11-07）

**状态：没有全部达成，不宣告 goal complete。** 本批在真实 Host 上补测了高风险路径，共发现 3 个真实缺陷。每个都先在 owned Electron 实测中定位根因，再按红→绿 TDD 做了最小修复，修复后又在真实 Host 复验通过：

1. 多行 finite 文字在真实 DPR 下偏移；
2. HTML 路线里 `object-fit:cover` 的图片溢出节点框；
3. 内联编辑器的文字整体偏上 1 device px，且字形偏细。

仍有可见差异：带 textRanges 的文字，GPU 渲染明显偏细（ink −17%～−22%）。还有一个功能限制：范围文字只要含有所提供字体缺的字形，整个 GPU 画布就会进入 error（已有提示）。

**受控 DPR1 没有拿到。** 在本机 macOS 上，Electron 33 的 `--force-device-scale-factor=1` 虽然在 ready 之前追加了，也确实出现在 renderer 的命令行里，但 DPR 仍然是 2。所以本批所有 DPR1 项目都是 **UNVERIFIED**。SVG 4 个 DPR1 圆角 FAIL 的历史数值原样保留，没有复现，也没有改成 PASS。

- **基线**：`29833828`。本批的提交见文末 §8。
- **Host**：只读，停在 `19fbe3828`，工作区干净；Electron 33.4.11，Chromium 130.0.6723.191。
- **证据**：都在任务自有的 `.tmp/coverage-followup-evidence/`（未提交，`SHA256SUMS` 见 §7）。

## 1. 受控 DPR1：未达成（UNVERIFIED）

上一轮 E2 的 force-dsf 是在 bootstrap 的 `await import(preload)` 之后才追加的。本批把它改到 `15d8cf85` 中已验证过的早期接缝：静态 import 之后、第一个 await 之前。另外，`--design-studio-force-dsf` 现在也可以用于完整场景，不再限于 probe 模式。

实测结果（`electron/cov-dpr1-full` 和 `electron/cov-dpr1-probe`）：

| 观测项 | 值 |
| --- | --- |
| 追加时机 `readyAtAppend` | false（在 ready 之前） |
| `hasSwitch` | true |
| Main 中 `getSwitchValue` | "1" |
| guest renderer 命令行 | 含 `--force-device-scale-factor=1` |
| GPU 进程命令行 | 不含 |
| guest 的 `window.devicePixelRatio` | **2** |
| `matchMedia(resolution)` | **2dppx** |
| Electron `screen` 的 scaleFactor | **2** |
| 截图与 CSS 的像素比 | **2** |

因此这两次运行**不能**称为受控 DPR1。它们的全部数值与 DPR2 运行一致，只能算作 DPR2 的重复。DPR1 的 SVG 圆角、细条/chevron 和覆盖矩阵仍是 **UNVERIFIED**。

可选方案（未执行，需主代理决定）：

- `webContents.setZoomFactor(0.5)` 能让 DPR 变为 1，但它同时改变 app UI 的布局尺寸，机制是页面缩放而不是显示器缩放，不能等同于 DPR1 显示器；
- 也可以用一台真实的 DPR1 外接显示器。

## 2. 高风险覆盖矩阵（真实 Host，DPR2）

**做法**：

- 文档：一个 8 节点的合成文档，节点都是顶层的。带两个 codec 资源：一份内置 Inter 字节（`builtin-inter-400-normal`，与 Figma 导入时的绑定方式一致），一份 64×32 的合成 PNG。没有网络请求。
- 对比方式：在真实 app 中打开文档，比较 GPU 路线和 app 自己的 browser（HTML/CSS）路线。两条路线读取的是同一份资源字节。
- 相机：约 100% 和 fit，各自都平移到 .3 的小数相位。实测 pan 相位为 x 0.29999、y 0.29999／0.30000。
- 判定：严格合同，质心 ≤0.15 device px，ink ±3%；同时记录 bbox。
- 字体记录：`document.fonts` 的实际条目只有 `Inter`（100–900，已加载，app 用资源字节注册）和 `ck-font-4-0`。另外记录了各字体栈的 Canvas 度量。

| case | 修复前（`cov-dpr2-c`） | 修复后（`cov-dpr2-e`） | 结论 |
| --- | --- | --- | --- |
| inter-default（默认 Inter 栈，无 fontRef） | 100%：0.002 / 0.10%；fit：0.005 / 0.14% | 相同 | PASS |
| inter-bytes（绑定内置字节） | 0.005 / 0.09%；0.006 / 0.14% | 相同 | PASS |
| cjk-center（中英混排，居中） | 0.074 / 0.10%；0.005 / 0.08% | 0.074 / 0.10%；0.002 / 0.21% | PASS |
| cjk-right（右对齐） | 0.006 / 0.16%；0.004 / 0.19% | 相同 | PASS |
| **finite-multiline**（finite，两行，lh 1.3） | **FAIL 1.468**（dy +1.47）；fit **0.471** | 0.012 / 0.17%；0.001 / 0.17% | **已修复** |
| **image-cover** | **FAIL 1.308 / −8.16%**，bbox ±8 px；fit **0.830 / −8.67%** | 0.106 / 0.01%；0.087 / 0.01% | **已修复** |
| image-contain | 0.098 / 0.01%；0.069 / 0.01% | 相同 | PASS |
| **ranges-fill-link**（填色 + 链接范围，内置 Inter） | **FAIL 0.285 / −17.47%**；fit 被 `#selection-size` 遮挡 | **FAIL 0.285 / −17.47%**；fit **1.178 / −22.43%** | **仍为 FAIL**（§4） |

默认 Inter 的说明：

- app 的默认文字 `fontFamily: "Inter, …"` 本身**不会**绑定内置字节。只有 Figma 导入（`prepareBuiltinDesignFontResources`）会生成 `builtin-inter-*` 资源。
- 在本文档里，由于存在一个 family 为 “Inter” 的资源，默认栈也解析到了这份字节：GPU 记录为 `native-missing-glyph` 并按 family 匹配；HTML 的 `document.fonts` 中只有这一个 Inter。
- 所以上表中 inter-default 的 PASS 不代表“没有资源时也解析到内置字节”。在没有资源的文档里，默认 Inter 走系统解析，此前 E1 测得的度量为 34/11，而内置字节为 31/8。这一点仍是事实层面的限制，本批没有改动。

## 3. 本批修复的 3 个缺陷（红 → 绿，真实 Host 复验）

**(a) 多行 finite 文字在真实 DPR 下偏移约 1.5 device px（缺陷位于 production `text-line-box.mjs`，是 `92940ce6` 漏掉的部分）**

- 根因：HTML 导出把元素 top 写成 CSS 值，即 hanging 原点减去 CSS 下的 alphabetic 偏移 14。Blink 在真实 DSF 下按 fontSize×2 排版行盒：28px 时度量为 25/6，floor((36.4+25−6)/2) = 27 物理 px，即 13.5 CSS；再在物理像素中取整。`textFiniteBaselineY` 当时仍按 CSS 尺度计算。
- 单行用例（lh 1.2）中 CSS 与物理计算恰好一致，所以早先的 snap 探针看不出这个问题。
- 离线复现（`offline/finite-*`，强制 DSF2 headless）：0.469 / 1.469，与真实 Host 的 0.471 / 1.468 一致；仿真模式通过。
- 修复：`textFiniteBaselineY(…, { layoutScale, layoutMetrics })` 中，元素 top 仍用 CSS 偏移，行盒和取整改在物理单位上进行。scale 1 时逐位不变。`canvaskit-text.mjs` 中 finite 度量多取一份 fontSize×s 的值；layout scale 变化时会清空缓存。
- 红测试：`real-dsf-layout-scale.test.mjs`，期望 156，修复前实际 157（`unit/red-finite.txt`）。

**(b) HTML 路线和 frontend 导出中，`object-fit:cover` 图片向节点框左右各溢出 8 CSS px（缺陷位于 production `frontend-export.mjs:506`）**

- 根因：每个节点都写了 `overflow:visible`，图片节点也不例外。Chromium 对 `overflow:visible` 的替换元素，会把 cover 超出部分画到框外。
- 1x 实测：browser 路线 ink 列为 47–272，而节点框为 63–255；GPU 路线正确裁切在框内。
- 修复：`object-fit` 为 cover（以及缺省 cover）的图片节点改为 `overflow:hidden`。fill 和 contain 本来就不会溢出，保持原样。
  - 第一版修复曾对所有图片节点都加 `overflow:hidden`，完整 check 第一次运行因此失败（`gates/attempt1-failed/`）：`html-image-border-box.test.mjs` 的 rounded 用例出现 48 个像素差异，因为 overflow 改变了圆角裁切的 AA。
  - 于是收窄到 cover。源页面中的 `<img>` 保留了 UA 默认的 `overflow:clip`，而导出时被改写成 `visible`，这正是 cover 溢出的原因。
  - 真实 Host 复验：`cov-dpr2-d` 和 `cov-dpr2-e` 跑的是第一版；cover 在两版里走同一条路径。contain 在任何修改之前（`cov-dpr2-c`）就已经 PASS，第二版对 contain 恢复成原来的行为。
- 红测试：`frontend-export.test.mjs` 中的像素测试，修复前 cover ink 为 32..143，节点框为 40..136（`unit/red-image-cover.txt`）。
- 这个修复会改变用户导出的 HTML：之前导出的是错误的溢出效果。

**(c) 内联编辑器的文字整体偏上 1 device px，且偏细约 14%（缺陷位于 production `app.js`、`canvas-interaction.mjs`、`style.css`）**

- 根因一：编辑器用一个分数 matrix（261.6, 206.6）定位，整行跳过了布局单位吸附；而 HTML 和 canvas 是先对节点的世界坐标做布局吸附，再施加相机变换。
- 根因二：`style.css:104` 设置了 `body{-webkit-font-smoothing:antialiased}`，textarea 继承了它；而 browser 路线通过 `:host{all:initial}` 重置了这一属性，canvas 文字也不受它影响。
- 修复：
  - 对轴对齐的编辑器，用 `inlineTextEditorPlacement` 把节点原点写成布局 left/top，transform 只保留相机变换（屏幕映射不变，有测试证明）；旋转链保持原来的单一 matrix；
  - `.inline-text-editor` 设置 `-webkit-font-smoothing:auto`。
- 测量方法：只统计字形像素（排除选中框的蓝色），截图期间临时把编辑器的 outline、背景、caret 置为透明，字色设为节点 fill，截图后立即移除这些内联覆盖。
- 修复前（`cov-dpr2-d`）：dy −0.785 / −0.889，ink −13.8% / −14.1%。
- 修复后（`cov-dpr2-e`）：dy 0.000 / 0.000，ink −0.18% / −0.36%。
- **x 方向残差仍然 FAIL**：dx +0.52 / +0.41 device px。旧的 matrix 定位下是 −0.26 / −0.30，也同样 FAIL。textarea 内部文本的横向取整与 HTML 文字的亚像素定位并不完全相同，本批没有继续处理。
- 真实编辑流程：Enter 进入编辑 → 输入 → Cmd+Enter 提交 → #save → 用 codec 读盘 → 重新打开，**PASS**。被编辑节点的几何、textAlign、fontFamily 不变；其余节点逐字节不变；资源分片的 sha 不变。

## 4. 仍存在的显著差异和限制（未修）

- **范围文字 GPU 偏细**：100% 下 ink −17.47%、质心 0.285；fit 下 −22.43%、质心 1.178。
  - 1x 并排可见：GPU 更细更淡。
  - 原因：范围文字必须走 CanvasKit 原生 paragraph 的字形光栅；普通文字走 Chromium 的同族 Canvas 光栅，所以与 HTML 一致。
  - 修复需要改变范围文字的光栅路径，不属于小修，本批没有动。
- **范围文字含所提供字体缺失的字形（例如 Inter 中的中文）时，整个 GPU 画布进入 error**：
  - 真实 Host 实测：`cov-dpr2-b` 的就绪状态为 `rendererStatus:"error"`；
  - 离线复现：`offline/cjk-range-refusal.json`，`TEXT_RANGES_UNSUPPORTED`；
  - 这是已有的显式拒绝，app 会提示“范围文字不支持”，可以切换到 browser 渲染器；但影响范围是整个画布，而不只是该节点。
- **旋转细条和 chevron 的 AA**：DPR2 的数值沿用上一批结果（严格判 FAIL，属于光栅后端轴）；DPR1 未测。
- **内联编辑器 x 残差**：0.41–0.52 device px，见 §3(c)。
- **save-reopen 的一次 UNVERIFIED**：发生在 `cov-dpr2-c`，当时 app 启动时自动打开了最新的 coverage 文档；reload 之后显示的是空白的 `design.codesign.json`（dirty）。
  - 把 coverage 文档的 seed 改为最早写入之后，`cov-dpr2-d` 和 `cov-dpr2-e` 都 PASS；
  - 根因没有确定，所以不认定为产品缺陷，只登记在这里。

## 5. 原尺寸判断的证据边界

- `crops-1x/`：120 张，1 像素等于 1 device px，没有重采样。每张都标明 run、相机、case、路线、zoom、DPR、物理像素尺寸和源 artifact 的 sha256，索引在 `index.md` 和 `index.json`。
- 每个相机都附有完整 stage 的上下文截图，以及编辑器前后的成对截图。
- 我实际看过的图：
  - `offline/1x-before-after-composite.png`：finite 修复前 GPU 偏低约 1–2 px，修复后对齐；cover 修复前 browser 的图片宽到裁剪边缘，修复后与 GPU 等宽；范围文字的 GPU 在两个 run 中都更细；
  - 编辑器 4 倍放大并排图：字形位置肉眼一致，编辑器字形偏淡（修复前）。
- 人眼在 1x 下是否察觉差异，本文不下结论，只给出严格指标、HTML 自身跨后端的差异（上一批），以及原图。
- 如需人工查看，可以按 `tools/run-electron.sh` 的方式另起一个 owned 测试窗口，由用户接管。本批没有保留任何窗口，也没有操作用户当前正在使用的 app。

## 6. 真实 Host 的其他场景（`cov-dpr2-e`，DPR2）

| 场景 | 结果 |
| --- | --- |
| open-without-edit | PASS |
| immediate-click-after-edit | PASS |
| save-reopen-stable | PASS |
| svg-corner-aa-host | PASS（DPR2 下 4 行全部 PASS；DPR1 未测，历史 FAIL 保留） |
| same-camera-visual | EVIDENCE_ONLY |
| perf | UNVERIFIED（设计如此）：133 帧，p50 8.3 ms，p95 9.9 ms，max 83.4 ms，脚本 107 ms |

运行环境与隔离：

- console/network：HTTP 被拒，NativeEntry 自测为 `deny network*`；报告 `blockedRequests` 中没有 Design Studio 发出的外部请求；范围链接为 `https://example.invalid`，只是数据，不会被请求。
- operator：每次运行前后 Electron/CodeShell 进程都是 20 个，diff 为空。
- owned 实例：每次运行后 owned 进程都已退出，`panel-desktop-ipc-*` 为 0。

## 7. 运行、门禁与证据

本批共 7 次 owned 窗口运行，超出了“2–3 次”的预算，原因如实列出：

| run | 结果 |
| --- | --- |
| `cov-dpr2` | 就绪超时，当时没有状态诊断 |
| `cov-dpr2-b` | 加入诊断后定位到范围字形的拒绝 |
| `cov-dpr2-c` | 发现 3 个缺陷 |
| `cov-dpr2-d` | finite 与 image 修复后复验 |
| `cov-dpr2-e` | 编辑器修复后复验 |
| `cov-dpr1-full` | DPR 仍为 2 |
| `cov-dpr1-probe` | DPR 仍为 2 |

- **定向单测**：harness/probe 81/81；editor placement 3/3；frontend-export 与 html-image-border-box 8/8。这些也都包含在完整 check 中。
- **完整 `npm run check`**（TMPDIR 在仓库外）：
  - 第 1 次：exit 1，共 1906 个测试，fail 1（rounded 图片，见 §3(b)），日志在 `gates/attempt1-failed/`。
  - 第 2 次：**exit 0**（2026-11-07T06:35:33Z–06:47:13Z），共 4198 个测试，pass 4189，fail 0，skipped 9。运行对象是 HEAD `29833828` 加上工作树改动：tracked diff 的 sha256 为 `fb36dd8b…`，新测试文件的 sha256 为 `4f17e6ba…`。本批提交的代码与这份 diff 完全相同，提交后只改了文档。
  - 包含 desktop-harness 和 design-studio 套件，没有关闭任何守门。日志在 `gates/check.log`。
- **`npm run validate`**：exit 0，日志在 `gates/validate.log`。
- **证据目录**：`.tmp/coverage-followup-evidence/`，内含：
  - `electron/<run>/`：报告、bundle、wrapper 收据；
  - `offline/`、`unit/`、`crops-1x/`、`tools/`、`gates/`；
  - `SHA256SUMS`：222 个文件，自身的 sha256 为 `bd1dc258af3ad1e7ad15736f4c768e2f886cfe8bff590e8a5f7f0c9d1e93548e`；`shasum -a 256 -c` 全部 OK。

## 8. 与 `29833828` 的差异和交付判断

- **production（只在 `apps/design-studio/app`）**：
  - `text-line-box.mjs`（finite）
  - `canvas/canvaskit-text.mjs`（finite 度量与缓存）
  - `frontend-export.mjs`（图片 overflow）
  - `canvas-interaction.mjs`、`app.js`、`style.css`（编辑器）
- **测试**：`real-dsf-layout-scale`、`frontend-export`、`inline-editor-placement`（新文件，已登记在 design-studio 套件）。
- **harness**：
  - 覆盖矩阵 fixture 与场景；
  - force-dsf 走早期接缝，并允许用于完整场景；
  - 就绪超时时记录状态；
  - Main 记录开关与 displays；
  - `regionInk` 新增 neutralOnly 选项。
- **没有改动的**：作者的设计、几何、fontFamily 存值、格式、Host/Electron、阈值和门禁，原有 FAIL 也没有改成 PASS。
- **“不能有太多样式差异”这个目标，目前仍被以下问题阻挡**：
  - 范围文字偏细（可见）；
  - 含缺字形的范围文字导致整个 GPU 画布 error；
  - DPR1 无法实测；
  - 细条/chevron 的 AA 差异（严格 FAIL）；
  - 编辑器 x 残差（亚像素级）。
- **本批修好的 3 个缺陷**在 DPR2 真实 Host 上已不可测出差异。
