# Design Studio 范围文字收尾批：finite 行框、line-through、系统字体下划线（2026-11-07）

**状态：部分修复，不宣告 goal complete，未发布、未安装。等待独立 review（448732e1 的后续验收）。**

原尺寸下可见的 3 个 BLOCKER：

| | 问题 | 结果 |
| --- | --- | --- |
| A | finite + typography 范围比 HTML 高约 6 device px；带 `layoutBaselineSource` 的普通 finite 文字差 1–2 px | **已修复**：真实 Host 100% / fit 均 PASS |
| C | line-through 没有拟合模型，走原生路径，字形偏细 | **已修复**：拟合 24/24 行精确，真实 Host PASS |
| B | 下划线经过 g / p / y（skip-ink） | **仍为 BLOCKER**：没有模型达到 ≤0.5 device px 的采纳门槛，继续走显式的原生回退。这是下一个阻塞点（§4） |

另外：系统字体（Arial）下划线原先被一条没有数据支持的限制送进原生路径，结果被拒绝绘制。现已解除，走 browser 栅格，真实 Host PASS。

## 1. A：HTML 的 finite 搬运条件（共享谓词）

**根因。** 带 finite `layoutBaselineOffset` 的文字，GPU 一律按“历史 hanging 原点 → CSS 行框”搬运来画。但 HTML 导出（`frontend-export.mjs` 的 `finiteTextPaintOffset`）只在一组条件下才这样搬运：

- 无 `layoutBaselineSource`；
- 无旋转；
- 无 typography 范围；
- 垂直约束为 start 且无 top/bottom（无限画布根节点在导出时被固定为 start）；
- 父节点不是 grid 布局；
- 运行时字体已加载。

不满足时，HTML 把文字当普通 CSS 行框排版：元素顶部是 `y`；有来源标记或处于 flow 中时是 `y − layoutBaselineOffset`。GPU 却仍按 hanging 搬运，于是：

- finite + 粗体范围高约 6 device px（离线红：c 2.9–6.2）；
- `layoutBaselineSource: "html"` 的普通 finite 文字差 c 1.0（强制 DSF）/ 2.0（仿真 DSF）。用户要求“有实测偏差才接入”，这一条有。

**实现。**

- `text-line-box.mjs` 新增：
  - `textHtmlFiniteHangingTransport(node, { parent, infiniteRoot })`：静态条件，与导出逐条对应；
  - `textHtmlFiniteLineBoxShift` / `textHtmlFiniteLineBoxNode`。
- `frontend-export` 的 `finiteTextPaintOffset` 改用这个谓词，运行时字体检查保留在导出端。
  - 输出不变，是负对照：`frontend-export` / `text-line-box` / `infinite-exports` / `infinite-layout-baseline` 共 23 个测试全过。
- GPU（`canvaskit-text.mjs`）在 `draw`、`contentBounds` 和 `beginScene` 的场景映射中，把不被搬运的 finite 节点换成“渲染视图”：
  - `y` 换成 HTML 行框顶部，去掉 finite offset；
  - 判定用场景节点（按 id 查找）。渲染器传进来的局部副本里 rotation 为 0、没有 `parentId`，不能拿它判定；
  - 文档节点、`node.y`、offset 和格式都不改写。
- 删除原因码 `finite-typography`：finite + typography 现在与 HTML 一样走行框，范围栅格可用。
- `canvaskit-renderer.mjs`：节点 picture 的 `originPhase` 改为对所有文字生效。原先 finite 文字不按世界原点的小数相位区分缓存；它们的绘制基线同样随相位吸附，小数拖动后可能复用旧 picture。这一处只多出缓存键，不改变像素。

**测试（先红后绿）。**

- `text-html-finite-transport.test.mjs`（新）：谓词逐条对照导出条件；渲染视图不修改文档节点。
- `range-text-raster.test.mjs` 新增软件 CanvasKit 测试：
  - finite + typography 与它的 HTML 行框孪生，像素**逐位相同**，contentBounds 相同；
  - `layoutBaselineSource` 的普通 finite 同样逐位相同；
  - 负对照：被搬运的普通 finite 文字与行框孪生**不同**（原点不动）。

**错误假设（已排除）。** “finite + typography 走原生路径只是字形偏细”——实际是基线模型不同（hanging 搬运 vs 行框），换成栅格前偏差约 6 px。

## 2. C：line-through 模型

**探针。** `tools/deco2-probe.mjs`：Inter 与 Arial，字号 13/14/16/18/20/24，强制与仿真 DSF2，共 24 行。字形透明，只绘装饰；同时记录 Canvas 的 fontBoundingBox 和 x-height、CanvasKit 的 strikeout 度量。

**搜索。** `tools/strike-fit*.mjs`，结果见 `probes/strike-fit3.out.txt`：

- 只看 A/3、2A/3、x-height、T 的各种取整组合，最好误差 1 device px（`strike-fit.mjs`、`strike-fit2.mjs`）；
- 只用 CanvasKit / OS/2 strikeout 位置，仅对 Inter 有数据，最好也是 1 px、2 行不中。

**模型（24/24 行误差为 0）。** 均以 layout px 计：

- top = P − A + round(2A/3 − th/2)
  - P：绘制基线；
  - A：layout 字号（fontSize × s）下 Canvas 的 `fontBoundingBoxAscent`；
  - th = fontSize × s / 10，**不取整**。
- 厚度 = max(1, floor(th))，与下划线同一规则。
- x 范围：run 的 advance 区间，端点吸附到栅格像素。
- 颜色：run 的 fill。
- 绘制顺序：在字形之后（CSS 绘制顺序）。

模型与字体无关，Inter 和 Arial 都适用，不需要按字体的查表。

**保留的回退。** 节点级 line-through 覆盖混合 typography 时（需要装饰盒自身的度量，未测）给出原因码 `line-through-mixed-typography`。自定义装饰、多层填色、描边、bidi 仍按节点回退，不会让整个场景失败。

**测试。** `range-text-decoration.test.mjs`：

- 新增测试：line-through 所在行相对同节点下划线的偏移，等于模型预测值（测试页用相同字节注册 OracleInter 来测 A）；
- 厚度 2 行、颜色为 run 颜色、不超出 run 区间。

## 3. 小修

- **系统字体下划线**：删除 `underline-system-font`。下划线模型在 Inter 和 Arial 上都经过实测；原先 Arial 下划线被送去原生路径，原生路径没有字节就拒绝绘制，所以“GPU 什么都没画”（UNVERIFIED）。新测试：Arial 下划线节点 `rangeRasterNodes = 1`，按 run 颜色绘制。
- **m1**：下划线 x 端点吸附到栅格像素，与颜色边界一致。测试拦截 `fillRect`，按变换换算到 device 空间，所有端点都是整数。
- **原生路径先校验所有行**：`drawTextRanges` 先完成每一行的映射和字体解析，再开始绘制，拒绝时不会留下画了一半的节点。
- **STRONG_RTL** 增加补充平面的 RTL 区段 U+10800–10FFF 和 U+1E800–1EFFF。
  - 测试：Adlam U+1E900、Phoenician U+10900 → `bidi`；
  - 负对照：emoji U+1F600、CJK Ext-B U+20000、Brahmi U+11005 → null；
  - 未重构 bidi 引擎。
- **测试夹具调整**：`text-ranges-renderer` 中的原生 shaping 基准原先依赖 `finite-typography` 才留在原生路径。现在它通过“节点级 line-through + 与基础字重相同的 typography 范围”（`line-through-mixed-typography`）留在原生路径。参考节点由“无范围普通文字”改为“整段单 run 的同一原生段落”，断言不变（像素相同、shaping 相同、颜色变化、拒绝按节点）。
- **Figma 插件包**：`figma-plugin/code.js`、`ui.html` 内嵌了 app 模块，用仓库的构建脚本重新生成（`--check` 通过），只有生成物变化。

## 4. B：skip-ink（仍为 BLOCKER，下一个阻塞点）

**数据。** deco2 探针，Inter + Arial × 6 个字号 × 2 种模式，共 120 个 HTML 断开区间。

| 候选模型 | 结果 | 出处 |
| --- | --- | --- |
| 整数模型：字形墨迹列（栅格 alpha > θ）± T | 120 个中 63 个精确，其余多为 ±1 px，最坏 3.5–4 px | `probes/skipink-grid.out.txt` |
| 亚像素模型：HTML 断开边缘按边缘列覆盖率取小数，墨迹边缘按 alpha 取小数，膨胀量 D 网格搜索 | 最好 D = th（不取整）：p90 0.66、最坏 3.2 device px | `probes/skipink-subpx.out.txt` |
| CanvasKit `getGlyphIntercepts` | 探针中 Canvas 前缀宽度比 HTML 宽约 6.6%，位置随文字逐渐漂移（最坏 16.5 px），未能对齐 | — |

用户的采纳门槛是断开边缘 ≤0.5 device px，三个模型都没达到，因此**没有实现任何 skip-ink 模型**，也没有使用魔数 d。带下行字母的下划线保留显式原生回退（`underline-skip-ink`）；HTML 的 skip-ink 没有关闭。

**下一步建议。** Blink 在 Skia 的 `getIntercepts` 精确轮廓交点上膨胀 min(厚度, 13)，再做 AA clipOut。可用以下两种之一，然后重新验证 ≤0.5：

1. 先查清探针中 6.6% 宽度差的来源（推测是探针 Canvas 的字体或 opsz 设置，生产环境的栅格宽度与 HTML 一致），再用 CanvasKit 交点；
2. 用同一 shaping 的轮廓交点。

另外，`node-underline-mixed` 的原生回退在混合字号时整行偏高约一行（c 10–14），说明原生路径的混合字号基线也需要修。修好 skip-ink 后这一例会回到栅格路径。

## 5. 逐例数据

指标：ink 为墨迹差；c 为质心偏差（device px）。

### 5.1 离线（headless Chromium 148）

数据：`offline/{red,green}-{forced,emulated}`，汇总表 `offline/table.txt`。

| 用例 | 红 强制 100 | 绿 强制 100 | 绿 仿真 100 | 绿 强制 fit | 绿 仿真 fit |
| --- | --- | --- | --- | --- | --- |
| range-finite-typo（finite 粗体） | −15.4% / c 6.22 FAIL | 0.0% / 0.00 PASS | −0.0% / 0.04 PASS | PASS | PASS |
| finite-source-plain | 0.0% / c 1.00 FAIL | 0.0% / 0.01 PASS | 0.0% / 0.01 PASS | PASS | PASS |
| range-line-through | −17.7% / c 1.08 FAIL | −0.0% / 0.01 PASS | −0.0% / 0.05 PASS | PASS | PASS |
| arial-underline | UNVERIFIED（GPU 无墨迹） | 0.0% / 0.04 PASS | 0.1% / 0.07 PASS | PASS | PASS |
| underline-descender-2line | −15.0% / 0.21 FAIL | −15.0% / 0.21 FAIL | −15.3% / 1.23 FAIL | FAIL | FAIL |
| node-underline-mixed | −14.1% / 13.77 FAIL | −14.1% / 13.77 FAIL | −13.1% / 12.64 FAIL | FAIL | FAIL |

其余回归用例（inter-default / inter-bytes / finite-multiline / range-cjk-missing / range-typography / range-underline / range-finite / node-underline-color / range-mixed-multiline）在两种模式下均 PASS。

例外：仿真模式下 `range-multiline` c = 1.01 FAIL。这就是已知的 LH 截断行（仿真 14/1.3 第 1 行，§6）；强制 DSF 和真实 Host 均 PASS。

### 5.2 真实 Host R1

环境：Host 只读 19fbe3828，Electron 33 / Chromium 130，真实 DPR2，平移 .3 小数相位。报告：`electron/rf-r1/*.report.json`。

| 用例 | 100（100b/100c 带） | fit（zoom 0.743） |
| --- | --- | --- |
| range-finite-typo | +0.10% / c 0.004 PASS | +0.35% / 0.024 PASS |
| finite-source-plain | +0.14% / 0.012 PASS | +0.37% / 0.051 PASS |
| range-line-through | +0.26% / 0.028 PASS | +0.66% / 0.040 PASS |
| arial-underline | +0.44% / 0.046 PASS | +0.65% / 0.017 PASS |
| range-mixed-multiline | +0.29% / 0.078 PASS（现在可见） | +0.51% / 0.051 PASS |
| underline-descender-2line | −14.69% / 0.206 **FAIL** | −16.22% / 0.476 **FAIL** |
| node-underline-mixed | −14.13% / 13.79 **FAIL** | −14.08% / 10.97 **FAIL** |

旧的 range 用例和回归用例：

- range-typography / underline / multiline / finite / node-underline-color / cjk-missing / fill-link，以及普通文字、CJK、图片：100 与 fit 全部 PASS。
- 阈值保持原始严格值：ink ±3%、质心 ≤0.15、e50 ≤0.5、线带 RGB 最大差 ≤16。没有放宽到 4/12。

同一次运行中的其他组：

- open-without-edit / immediate-click-after-edit / save-reopen-stable / svg-corner-aa-host 为 PASS；
- low-zoom-fractional-performance 为 UNVERIFIED（安装版观察不到计数器，与之前一致）；
- same-camera-visual 为 EVIDENCE_ONLY；
- 汇总 overall FAIL，`goalComplete = false`，唯一失败组是 coverage-matrix（即上表两个 skip-ink 用例）。

**混合多行。** 原先 100% 时 `.canvas-meta` 压在它上面；那时探针正确地记为 UNVERIFIED，没有算成 PASS。现在把 100% 拆成三个带（中心 y = 190 / 420 / 590），每个用例都在未被遮挡的位置测量。裁切仍按 `comparisonEligible` 判定，被遮挡或被裁切的用例不会算成 PASS。

**原始视觉。** `crops-1x/`，1 图像像素 = 1 device px，无重采样。

- finite 粗体、Source finite、Strike this out、Arial under line：GPU 与 HTML 目视一致。
- Typing gap（skip-ink）：GPU 字形明显偏细偏浅（原生路径）。
- Node Big under：GPU 整行比 HTML 高约一行，下划线偏浅。

## 6. LH（行高 LayoutUnit 取整）

- 真实 Host R1：12 行。其中 10 行用 round 和 trunc 预测的 layout 位置不同，这 10 行实测都等于 trunc，0 行等于 round。绘制基线取整后 12 行中 0 行可区分，真实 Host 上没有可见差异。
- 前批离线数据：仿真 s1、强制 s2 共 36 行中，只有仿真 14/1.3 第 1 行的绘制基线可区分（round 53，trunc 52）；本批离线的 `range-multiline` 仿真 FAIL 就是这一行。
- 本批**未实施** trunc 修复（可选项）。它要求 GPU、SVG、metrics bounds 三处同步，而在真实 Host 上没有可见行。保留为**下一个单点修复**。

## 7. 范围与限制

- 编辑器 textarea 的范围不变（不含范围样式编辑）。小数相位只覆盖 .3（以及前批的 .7），其他相位未测。
- DPR1 未测（没有设备，按约定不再用 flags 尝试）。
- SVG 的 4 个 FAIL 保留，本批没有改 SVG。注意：被 A 转为行框的 finite 节点，SVG 导出和 text-metrics 选择框仍按 hanging 计算。这是已知的不一致，未处理。
- B0 四路 actual-editor 矩阵（`render-fidelity-ui.test.mjs`）不在 `npm run check` 的套件中。本批 variants 页与基线 49ba4273 的结果相同（同样 6 个 `pixel cluster` 失败，见 `gates/b0-variants-*.report.json`）。geometry 页的失败都是非文字节点。
- 本批只用了 1 次真实运行（R1）。它跑的已经是完整 harness（open / hit / save / SVG / perf / LH），而且 R1 之后没有改生产代码（只是把新测试登记进 `tests/suites.mjs`），所以第二次运行没有使用。

## 8. 门禁、证据与提交

- `npm run check` **exit 0**（2026-11-07T09:15:51Z–09:28:23Z，新测试文件已登记进 `tests/suites.mjs` 并实际运行），`npm run validate` **exit 0**。均使用外部 TMPDIR（`/tmp/ds-host-harness-tmp/rf/gates-tmp`），日志在 `gates/check.log`、`gates/validate.log`。14 个改动文件的 SHA 在 `gates/check.files.sha256`，门禁结束后逐一校验，0 个不符。之后只新增了本文档。
- 证据目录 `.tmp/range-final-evidence`：offline、probes、tools、electron（含 wrapper 收据）、crops-1x、gates、`SHA256SUMS`。
- R1 收据：
  - operator 的 Electron 进程在运行前后相同（20 个 PID，无差异）；
  - 自有 IPC HOME 已删除；
  - 退出码 1：harness 发现 FAIL 时就以 1 退出，与报告一致。
- git 可用。本批作为一个本地提交，基线是 49ba4273，未 push，未 merge。
