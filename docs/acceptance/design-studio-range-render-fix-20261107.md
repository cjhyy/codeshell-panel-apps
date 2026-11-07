# Design Studio 范围文字渲染修复（2026-11-07）

**状态：部分修复，未全部达成，不宣告 goal complete。** 本批只处理一个根因：范围文字的光栅路径，以及“缺字形让整个 GPU 场景报错”。

在真实 Host（Electron 33.4.11 / Chromium 130.0.6723.191，DPR2，owned 隔离实例）上：

- 填色/链接、含中文缺字形、字重/字号/斜体、跨行、finite 这 5 类范围文字，在 100% 和 fit（.3 小数平移）下，GPU 与 browser 路线全部 PASS，严格合同不变（质心 ≤0.15 device px，ink ±3%）。
- 场景始终 active，中文有墨迹。

仍有以下项目，属于 **BLOCKED / FAIL**：

- 带下划线的范围仍走原生路径，在原尺寸下明显偏细，下划线颜色也不对；
- 仿真模式下的多行行高取整问题（既有缺陷，不只是范围文字）；
- 内联编辑器的 x 残差。

**本地 commit 未完成。** 任务末段，macOS 拒绝本进程访问 `~/Documents`（主仓库 `.git` 所在位置），`git` 返回 “Operation not permitted / not a git repository”，关闭 shell 沙箱后也一样。所有修改仍保留在工作树中，见 §8。

## 1. 根因（独立 review 448732e1 指出，本批已核实）

均位于 `apps/design-studio/app/canvas/canvaskit-text.mjs`：

- **整个场景报错**：`canvasKitTextRangePlan` 会在没有字体、缺字形、多层填色、描边或自定义装饰时 throw；`draw` 在没有字体的范围（827–829）、缺字形（849–859）、`rangeFont`（229–236）处也会 throw。这些异常一路冒到 record/setScene，整块画布变成 `rendererStatus:"error"`。
  - 修复前离线复现：强制 DSF2 与仿真 DSF2 中 `gpuActive:false`，报错 `TEXT_RANGES_UNSUPPORTED: range-cjk-missing`（`offline/red-*`）。
- **范围文字发细**：范围文字一律走原生 paragraph（`drawTextRanges`，776–814），使用 CanvasKit 自己的字形 AA；普通文字走 Canvas2D（`rasterLine`），与 HTML 同一引擎。
- **缓存签名不含范围**：`rasterSignature` 不含 textRanges，范围修改后栅格缓存可能过期。

## 2. 写代码前的离线探针（headless 148，强制 DSF2 与仿真 DSF2，不开窗口）

`tools/range-offline.mjs` 在同一页面中，用相同的资源字节，同时驱动 app 的 browser 渲染器和 CanvasKit 渲染器；另用一个 open root 挂载 HTML 导出，测量每个 run 的 x 与基线。

- **x 位置**：把连续同字体的 run 合成一组，用前缀 `measureText` 预测，与 HTML span 的实测相差 ≤0.013 CSS px，残差来自 LayoutUnit 截断（`offline/base-forced-2/range-offline.json`）。已覆盖的情况：跨颜色边界、weight 700、italic、中文 fallback、换行后的 run。
- **混合字号的基线**：行盒模型为 `max_i floor((lh_i·s + round(A_i) − round(D_i))/2)/s`，字体度量在 size·s 下取。实测：

| 情形 | 强制 DSF2 | 仿真 |
| --- | --- | --- |
| 单字号 | 13.5 | 13.0 |
| 18px 混入 14px | 17.0 | 17.0 |

  预测与实测完全一致（`offline/geo-*`）。
- **中文字体 fallback**：HTML 使用节点自己的 CSS 字体栈；Canvas2D 使用同一个栈时，fallback 字体也相同。离线结果中 range-cjk-missing 的 ink 偏差为 0.00%。这一点没有用 `fonts.check` 来证明。
- **另外发现的既有缺陷，本批未修**：Blink 把行高**截断**到 LayoutUnit，而现有的 `textLineBoxBaselineY` 用的是 round。
  - 10 组 plain div 实测中，凡是 trunc 与 round 结果不同的，实测都等于 trunc（`offline/lh-probe.txt`）。例如仿真模式下 18.2 → 18.1875，强制模式下 36.4 → 2329/128。
  - 影响范围：普通多行文字、SVG 行位置、finite 的第二行之后。
  - 改这个共享函数会改动普通栅格、SVG 和序列化输出，超出本批“只修一个根因、普通文字不变”的约束，所以只登记不修。
- **underline**：Canvas2D 和 DOM 都拿不到下划线的位置和粗细，无法与 HTML 对齐。因此带装饰的范围不走栅格路径（见 §3）。

## 3. 最小修复（只改 `canvaskit-text.mjs` 与 `text-line-box.mjs`）

- **`canvasKitRangeTextRasterFallbackReason` / `canvasKitRangeTextRasterEligible`**：
  - 可以走栅格：填色、链接、family、size、weight、italic 范围。
  - 不走栅格，并记录明确原因（stats 字段 `rangeTextNativeFallbacks`）：
    - 多层填色或描边：`paint-stack-or-stroke`
    - 范围或节点带装饰：`text-decoration`
    - finite 加字体相关范围：`finite-typography`
- **`rasterRangeLine`**：普通文字的 `rasterLine` 保持不动，所以普通文字的像素和签名都不变。新函数与它共用 plan、缓存、64 MiB 共享预算、设备相位采样、手势延迟、字体 epoch 失效机制，不新开预算。
  - 同一行内连续同字体的 run 合成一组整体塑形，跨颜色边界的 kerning 保留；
  - 每个 fill 都绘制整组文字，再按前缀 `measureText` 的区间裁切，首尾不裁切，保留溢出的墨迹；
  - 字体用与 HTML 相同的 `familyCss` / `designResourceFontFamilyCss` / `designFontFamilyCss`；缺失的字形由同一浏览器字体栈 fallback；
  - 不修改文档里的 fontFamily，也不强行绑定内置字体。
- **基线（`rangeBaseline`）**：
  - 只有填色/链接的行：与普通文字共用 `textLineBoxBaselineY`；
  - 含字体相关范围的行：按上面的行盒模型，并使用新增的 `textLineBoxBaselineAt`（text-line-box.mjs）；
  - finite 节点：走 `finiteBaseline`（从原 paintBaseline 中抽出，测量时显式使用 alphabetic）。
- **字体选择**：`rangeRunFace` 与 browser 路线一致——
  - 已提供该 family 的字体但没有对应的字重或样式时，拒绝该节点，不合成、不替代；
  - 没有提供字体的 family，必须在浏览器中可用，否则拒绝，不会静默替换。
- **缓存签名**：带范围的节点，签名中加入 validated textRanges，范围的填色或字重一改，缓存就失效。普通节点的签名字符串不变（条件展开）。
- **`estimatePixels` / `contentBounds`**：为范围栅格单独实现（设备采样候选会自动包含这些节点），并用 try/catch 防止范围拒绝冒到 bounds 计算。
- **按节点降级**：`draw` 中只有 `TEXT_RANGES_UNSUPPORTED` 会被单独处理——记一条 `unsupportedNode(node, "text-ranges-unsupported")`，并写入 `unrenderedByNode`。其他异常照常让场景失败，不做笼统吞掉。被拒绝的节点不绘制，相邻节点照常绘制。

## 4. 红 → 绿

- **新单测 `range-text-raster.test.mjs`（2 项）**：
  - 红：用 HEAD 版 app 跑，模块缺少导出（`unit/red-range-unit.txt`）。
  - 绿：2/2。覆盖资格判定的原因码；软件 CanvasKit + Canvas2D 下中文 fallback 有墨迹且是范围颜色；被拒节点按节点上报、不绘制、相邻节点照常绘制；修改范围填色会使缓存失效、旧颜色不再出现。
- **改写的既有测试**（只改表达方式，保留原意）：
  - `text-ranges-renderer` 的 shaping 基准测试：用“与基础字重相同的 fontWeight”这一不改变度量的方式，让它继续走原生 paragraph；拒绝从 throw 改为按节点上报（新增变量曾与原有的 `before` 重名，已改名）。
  - `text-ranges-typography`：改为在栅格路径上验证——已提供的字重/斜体/family 确实改变了绘制结果；缺失的 family 按节点拒绝、不绘制、不替代。
  - `font-family-renderer` 的 CSS fallback 栈测试：缺字形的范围节点原来期望 throw，现在走范围栅格，使用同一个 fallback 栈，有墨迹、不走原生、不拒绝。
  - `iana-font-oracle`：可变字体 700 范围、无 fontRef 的 base 700 改为在栅格路径上验证，仍断言 WebGL 画布上的 700 字形与 400 不同；静态 400 字体不会凭空获得 700，仍然拒绝，但改为按节点拒绝、不绘制。
  - 这些都是本批明确要求的语义变化（原生改为栅格、throw 改为按节点处理），每处都在测试注释中写明。
- **离线，HEAD 对比修复后**（`offline/red-*` 与 `offline/green-*`）：
  - HEAD：两种模式下整个场景报错。
  - 去掉会让场景报错的节点后，HEAD 的范围 case 全部 FAIL，ink −16% 到 −23%，typography 的质心偏 11–15 device px（`offline/red-subset2-*`）。
  - 修复后：场景 active；除 underline 和“仿真模式下的 multiline”外全部 PASS。
- **测试数**：
  - 相关定向测试 60/60（renderer、cache、real-dsf、line-box、resource-raster）；
  - range 相关 117 项（改写后全部通过）；typography + renderer + range 15/15；
  - font-oracle 5 pass、2 skip（skip 为原有）；harness 71/71。
  - 完整 check 见 §8。
- **emulated 负控**：`render-fidelity-ui` 四路由矩阵不在 check 套件中，单独跑：
  - HEAD 基线本身就是 FAIL，有 38 个 unique 失败；
  - 修复后 37 个，唯一的差别是 `dpr1-zoom1|variants|ranges-plain|gpu` 变为通过，没有新增失败（`offline/render-fidelity-ui/`）。

## 5. 真实 Host（2 次 owned 运行，硬上限 3 次，未用 R3）

| run | 结果 |
| --- | --- |
| R1 `range-r1` | exit 3，154 s。open/hit/save/SVG 都 PASS。coverage 场景因 harness 的 artifact 标签 `coverage-phase-0.25-canvas` 含 “.” 而中止，没有拿到 range 数据。已修复标签，并加了覆盖所有标签模板的回归测试。 |
| R2 `range-r2` | exit 1（覆盖矩阵里有严格 FAIL），159 s。open/hit/save/SVG 都 PASS；perf 131 帧，p50 8.3 ms，p95 9.7 ms，max 93.3 ms，脚本 113 ms（内部统计照旧 UNVERIFIED）。DPR 2，`matchMedia` 2dppx，display scaleFactor 2，没有追加开关。 |

R2 实测：GPU 对 browser，同一相机，严格合同。100% 时 pan 为 11.3/107.3，fit 时 zoom 0.7851、pan 62.3/141.3。

| case | 100% | fit | 场景 / 字体 |
| --- | --- | --- | --- |
| ranges-fill-link | PASS 0.102 / +0.47% | PASS 0.140 / +0.55% | active |
| range-cjk-missing | PASS 0.077 / +0.44% | PASS 0.062 / +0.76% | active；中文由浏览器 fallback 渲染，有墨迹（修复前整个场景报错） |
| range-typography（700、18 混 14、italic） | PASS 0.025 / +0.22% | PASS 0.037 / +0.23% | 提供的 italic 字节已加载（`document.fonts`：Inter normal/italic，ck-font-4-0 normal/italic） |
| range-multiline（lh 1.3，跨换行） | PASS 0.066 / +0.42% | PASS 0.041 / +0.63% | 真实 DPR2 下截断与四舍五入恰好一致；仿真模式下离线结果 FAIL 1.007，属于上面登记的既有缺陷 |
| range-finite | PASS 0.006 / +0.43% | PASS 0.021 / +0.58% | Arial，没有提供字体 |
| **range-underline** | **FAIL 1.207 / −14.32%** | **FAIL 1.643 / −19.80%** | 原生路径（`text-decoration`），**BLOCKED**，见 §6 |
| image-cover-rounded（上一批 overflow 修复与圆角的组合） | PASS 0.091 / −0.02% | PASS 0.071 / −0.01% | 圆角 AA 没有退化 |
| 普通对照（inter-default、inter-bytes、cjk、finite-multiline、image） | 全部 PASS，数值与上一批相同 | 全部 PASS | 普通文字路径未改动 |

- **编辑流程**：真实 UI 中，在范围节点末尾插入 “ ok” → 提交 → 保存 → 用 codec 读盘 → 重新打开，**PASS**。
  - 文字为 `Inter 中文 mixed 字形 ok`；
  - 第一个范围 `{6,8,#b42318}` 原样保留；
  - 末尾的范围从 15..17 延伸到 15..20：在范围末端输入时继承了该范围的样式，这是 app 现有的编辑语义，记录如实。
  - cjk-center 的编辑、其余节点、资源分片都不变。
- **编辑器 x 相位数据**（只采集数据，本批不改编辑器）：

| pan x 相位 | 画布字形左缘 | 编辑器字形左缘 | dx |
| --- | --- | --- | --- |
| 0 | 11.813 | 12.112 | 0.299 |
| .25 | 12.111 | 12.816 | 0.705 |
| .5 | 11.813 | 12.112 | 0.299 |
| .75 | 12.111 | 12.816 | 0.705 |

  - 通过 CDP pierce 拿到了 textarea 内部 editor 的 content quad：x 为 524.296875 / 524.546875 / …，等于节点的屏幕 x。
  - 结论：残差随设备相位交替变化，是字形位置量化方式不同导致的，不是常量偏移，盲目取整修不好。仍为 FAIL，不修。
- **编辑器覆盖层测量对范围节点不适用**：range-cjk-missing 测得 30.17 / +85%。textarea 只显示单色纯文本，而画布上有范围颜色，“只统计中性色像素”的测法因此失效。这一行仍按 FAIL 记录，但含义是“编辑时不显示范围样式”。

## 6. 原尺寸实际看图，以及 BLOCKED 项

我看过的图是 `offline/range-r2-100-gpu-vs-browser-1x.png`：1x 原尺寸，左边 GPU，右边 browser，来自 R2 的 100% 截图。

- 填色/链接、中英混排（中文有颜色）、粗体/大字/斜体、两行文字、finite：两边肉眼一致。
- **underline 一行明显不同**：GPU 的字更细更淡，下划线是深色，而 HTML 的下划线是蓝色（currentColor）。
  - 这是原生 fallback 的问题：`rangeStyle` 只设置了 decoration，没有设置 decorationColor（CanvasKit 默认），字形 AA 也是原生的。
  - 按规则这属于原尺寸可见缺陷，**BLOCKED，不做有限接受**。
  - 下一步最小修法（未实施）：给原生路径设置 decorationColor 为 run 的填色；或者在能从字体表拿到下划线度量后再让它走栅格。

全部 66 张 1x 裁剪及其标签索引在 `crops-1x/index.md`。

## 7. 仍然存在的严格 FAIL / 未覆盖项

- **range-underline**：原生路径偏细，下划线颜色错误（BLOCKED，见 §6）。
- **行高 trunc 与 round**：既有缺陷，在仿真模式下影响普通多行和范围多行文字，未修。
- **编辑器**：x 残差 0.30 / 0.70 device px，随相位交替；编辑时不显示范围样式。
- **上一批遗留，保持不变**：旋转细条和 chevron 的 AA 差异（严格 FAIL）、SVG 4 在 DPR1 下的圆角（DPR1 无法实测）。
- **未覆盖**：描边文字、多层填色加范围（只有按节点拒绝路径做过验证）、自定义下划线偏移/粗细、竖排、超长文本的预算降级在真实 Host 下的表现。

## 8. 门禁、证据与提交状态

- **完整 `npm run check`**（仓库外的 TMPDIR，所有守门照常运行）：
  - 第 1 次：exit 1，`font-family-renderer` 有 1 项失败，原因是旧语义的断言（`gates/attempt1-failed/`）。
  - 第 2 次：exit 1，`iana-font-oracle` 有 3 项失败，原因同上（`gates/attempt2-failed/`）。
  - 第 3 次：**exit 0**（2026-11-07T07:46:16Z–07:58:25Z），共 4201 个测试，pass 4192，fail 0，skipped 9。
  - 由于 git 不可用，被测的 11 个文件逐个记录了 sha256（`gates/check.files.sha256`），check 结束后再次校验，全部一致。
  - R2 之后 production 没有再改动，只改了测试。
- **validate**：exit 0（`gates/validate.log`）。
- **证据**：`.tmp/range-render-evidence/`（任务自有，未提交），包括：
  - `electron/range-r{1,2}/`：报告、bundle、wrapper 收据；
  - `offline/`：红绿结果、几何、行高探针、原尺寸合成图；
  - `unit/`、`crops-1x/`、`tools/`、`gates/`；
  - `SHA256SUMS`。
- **隔离**：两次运行都正常结束——owned 进程退出，`panel-desktop-ipc-*` 为 0，operator 的 20 个进程前后一致。Host 仍为 `19fbe3828`，工作区干净（这是首次检查时的状态；之后因系统权限无法再次核对，见下）。没有 push、merge、发布或安装。
- **提交：未完成（BLOCKED）**：
  - 原因：macOS 拒绝本进程访问 `~/Documents/个人学习/代码学习/codeshell-panel-apps/.git`（“Operation not permitted”，关闭 shell 沙箱后也一样）。worktree 的 gitdir 指向那里，所以所有 git 命令都失败。
  - 修改仍在工作树中，基线为 `71b20017`：
    - production：`apps/design-studio/app/canvas/canvaskit-text.mjs`、`apps/design-studio/app/text-line-box.mjs`
    - harness：`scripts/design-studio-host-fidelity{,-runner}.mjs`
    - 测试：`tests/apps/design-studio/range-text-raster.test.mjs`（新）、`tests/apps/design-studio/text-ranges-renderer.test.mjs`、`tests/apps/design-studio/text-ranges-typography.test.mjs`、`tests/apps/design-studio/font-family-renderer.test.mjs`、`tests/apps/design-studio/iana-font-oracle.test.mjs`、`tests/design-studio-host-fidelity.test.mjs`、`tests/suites.mjs`
    - 本文档
  - 恢复对 `~/Documents` 的访问权限后，就可以做本地提交。
