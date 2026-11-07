# Design Studio 范围文字装饰（underline / line-through）修复（2026-11-07）

**状态：部分修复，未全部达成，不宣告 goal complete。**

- 已修复：原尺寸下可见的范围下划线问题——不带下行字母的下划线现在走 browser 栅格；节点级下划线内含彩色 run 的情况也已修复。真实 Host（Electron 33 / Chromium 130，DPR2）中，100% 与 fit（.3 小数平移）均 PASS，严格合同不变。
- 已补上 review 的 I1、M1、M2。
- 仍为 **BLOCKED / FAIL**（原尺寸可见）：
  - 下划线经过下行字母（skip-ink）、line-through：这两种继续走原生路径，装饰颜色已修正，但字形仍偏细；
  - finite 文字加字体相关范围：原生路径，原尺寸下明显偏高、偏细。

**仍未提交**：macOS 继续拒绝访问 `~/Documents` 下的 git 元数据。本批只检查了一次，没有重复探测，也没有提权或改动系统设置。修改留在工作树中，完整的 diff 和 SHA 见 §8。

## 1. review 修复

- **I1：新栅格路径的跨颜色塑形**
  - 新测试 `range-text-decoration.test.mjs` 覆盖 AVATAR、office（fi）、é（e + 组合符）、NBSP + LF 四种文本，均断言 `rangeRasterNodes = 1`、`nativeTextNodes = 0`。
  - 发现并修复一个真实缺陷：颜色边界处的裁切边在小数位置，有抗锯齿，导致覆盖率变化（AVATAR 有 84 个像素的 alpha 不同）。现在内部边界吸附到栅格像素，每个像素只由一种颜色绘制一次。
  - 改为“同色范围”后，每个像素的 alpha 与普通文字**逐位相同**。
  - 换成不同颜色时，墨迹 mask 相同、run 区间外的 alpha 逐位相同、颜色只出现在该 run 的区间内。run 内的 alpha 会随颜色变化，这是 Skia 按亮度调整的文字对比度（HTML 也一样），不是几何差异。
  - 原有 native weight400 的 shaping 基准测试保留，没有拿它代替对新路径的测试。
- **M1**：所有行的布局、字体解析和装饰判定都在绘制前完成。第二行被拒绝时，第一行不会先画出来（已测：被拒节点完全没有墨迹，只记一条 `text-ranges-unsupported`）。
- **M2**：含强 RTL 字符时，原因码为 `bidi`，走原生路径或按节点拒绝，不按逻辑前缀裁切。非预期的异常照常抛出。

## 2. 装饰模型（全部来自实测，没有魔数）

探针：`tools/deco-probe.mjs`。headless Chromium 148，强制 DSF2 与仿真 DSF2；字号 13 / 14 / 18 / 24；用真实的 frontend 导出，Inter 字节以 FontFace 注册到 `document.fonts`。

- 第一次探针结果作废：shadow root 内的 `@font-face` 不会注册字体，实际渲染成了衬线字体（`offline/forced`、`offline/emulated`）。这一版只用于发现问题，修正后的 Inter 数据在 `offline/inter-*`。
- 方法：同一节点各渲染一份“带装饰”和一份“去掉装饰的孪生”，两者覆盖率相减，得到只属于装饰的像素。

**下划线：8 个数据点全部精确吻合**（2 种模式 × 4 个字号）。设 th = fontSize × layoutScale / 10，P 为吸附后的绘制基线：

- 下划线顶 = P + max(1, ceil(th/2))
- 下划线厚度 = max(1, floor(th))

| | 13 | 14 | 18 | 24 |
| --- | --- | --- | --- | --- |
| 强制 DSF2：间距 / 厚度（device px） | 2 / 2 | 2 / 2 | 2 / 3 | 3 / 4 |
| 仿真 DSF2：间距 / 厚度（CSS px） | 1 / 1 | 1 / 1 | 1 / 1 | 2 / 2 |

- 换成衬线 fallback 字体，偏移和厚度完全相同。这说明 Blink 的 auto 装饰厚度取 font-size/10，而不是字体 post 表里的值。CanvasKit 的 `Font.getMetrics()` 能给出 underline/strikeout 的位置和厚度（14px 时为 0.957 / 2.379 / 0.957 / −4.587），但实测并不用到它们。
- x 范围等于该 run 的 advance 区间（span rect，例如 109.86–297.11 实测为 110–297 device px）。
- 颜色：节点级下划线下面的红色 run，下划线也是红色 (180,35,24) = #b42318，即**每段用自己 run 的颜色**。

**line-through：没有拟合，不实现。** 相对 P 的顶部位置：

| | 13 | 14 | 18 | 24 |
| --- | --- | --- | --- | --- |
| 强制（device px） | −10 | −10 | −13 | −18 |
| 仿真（CSS px） | −6 | −6 | −8 | −10 |

试过 ascent/3、ascent/3 + 厚度/2、字体 strikeout 位置、x-height，都至少在一个字号上残差 > 0.25 device px，因此保持原生路径。

**skip-ink：没有建模。** Inter 14px 的下划线在 g 的下行笔画前约 3 device px 处断开。我写的“间隔与字形墨迹”自动拟合前后不一致，不足以支持 Blink intercept + dilation 的完整实现。因此只要下划线 run 的字形墨迹会伸入下划线带（`actualBoundingBoxDescent` > 间距），就按节点走原生路径，原因码 `underline-skip-ink`，不会让整个节点报错。

## 3. 实现（只改 `apps/design-studio/app/canvas/canvaskit-text.mjs`）

- **静态原因码**（`canvasKitRangeTextRasterFallbackReason`）：
  - `bidi`
  - `decoration-custom`（自定义粗细、偏移或 skip-ink）
  - `line-through-unfitted`
  - `paint-stack-or-stroke`
  - `finite-typography`
  - auto 下划线本身可以走栅格。
- **运行时原因码**（`rangeDecorationFallbackReason`）：
  - `underline-system-font`：没有提供字体字节；
  - `underline-skip-ink`：有下行笔画。
- **栅格绘制**：先按吸附后的边界分色绘制字形，再按 §2 的模型画下划线矩形——每个 run 用自己的区间和颜色，相邻 run 的下划线自然相连。行的 bounds 已包含下划线。
- **原生 fallback**：`rangeStyle` 设置 `decorationColor` 为 run 的颜色（原来是默认黑色）。字形粗细没有改善，不算作 PASS。
- **未改动**：普通文字路径和签名、SVG、receipt、序列化、64 MiB 共享预算、缓存失效（textRanges 已计入签名）、设备相位采样。

## 4. 测试（红 → 绿）

- **`range-text-decoration.test.mjs`（3 项）**：
  - 红：3/3 FAIL（`unit/red-decoration.txt`）——reason 仍为 `text-decoration`、AVATAR 有 84 个像素 alpha 不同、下划线节点没有走栅格。
  - 绿：3/3（`unit/green-decoration.txt`）。
  - I1 测试第一版有两处错误，都已改正：一是用不同颜色去比 alpha，二是 NBSP + LF 用了单行区间。改正理由写在测试注释中。
- **`range-text-raster.test.mjs`**：原因码改为新语义（`line-through-unfitted`、`decoration-custom`）。
- **离线 GPU 对 HTML**（`offline/offline2-*`，两种模式 × 100% / fit）：
  - range-underline 与 node-underline-color 从 FAIL（上一批 −14.7%）变为 **PASS**，质心 ≤0.024，|ink| ≤0.02%；
  - 上一批的 5 个范围 case、CJK、圆角 cover 图片均没有回退；
  - range-mixed-multiline **PASS**——它走的是栅格而不是原生，“混合字号多行仍是原生”这一预设不成立，在此更正；
  - 预期的原生 FAIL：underline-descender-2line（−15% / −20%）、line-through（−17.7% / −22.6%）、finite-typo（质心 2.9–6.2）；
  - 仿真模式下的 range-multiline 仍 FAIL 1.006，原因是下面 §6 的行高问题。

## 5. 真实 Host（硬上限 2 次，只用了 R1）

R1 `deco-r1`：exit 1（覆盖矩阵中有严格 FAIL），159 s。

- 环境：DPR 2，`matchMedia` 为 2dppx，scaleFactor 2，没有追加任何开关。
- open / hit / save / SVG：全部 PASS。
- perf：132 帧，p50 8.3 ms，p95 9.8 ms，max 83.3 ms，脚本 108 ms；内部统计仍为 UNVERIFIED。

R1 跑的就是最终代码，之后只改了测试登记和文档，所以 R2 没有使用。覆盖矩阵结果（质心 device px / ink）：

| case | 100% | fit | 说明 |
| --- | --- | --- | --- |
| **range-underline** | **PASS** 0.019 / +0.28% | **PASS** 0.019 / +0.37% | 上一批 R2 为 FAIL −14.3% |
| **node-underline-color** | **PASS** 0.009 / +0.33% | **PASS** 0.022 / +0.43% | 每段下划线用 run 颜色 |
| underline-descender-2line | FAIL 0.206 / −14.69% | FAIL 1.220 / −20.09% | 原生（`underline-skip-ink`），颜色正确，字形偏细 |
| range-line-through | FAIL 1.112 / −17.55% | FAIL 1.219 / −22.54% | 原生（`line-through-unfitted`），颜色正确 |
| range-finite-typo | FAIL 6.197 / −15.27% | FAIL 3.937 / −20.26% | 原生（`finite-typography`），原尺寸下明显偏高、偏细 |
| range-mixed-multiline | UNVERIFIED（被 `.canvas-meta` 覆盖） | PASS 0.061 / +0.32% | 栅格 |
| 上一批范围 case、CJK、圆角图片、普通对照 | 全部 PASS | 全部 PASS | 数值与上一批一致 |

- **编辑流程**：在范围节点末尾插入 “ ok” → 保存 → 读盘 → 重开，PASS，范围保留。
- **编辑器覆盖层**：普通文字仍为 FAIL（x 残差 0.52 / 0.41）。范围节点标为 `not-applicable`（UNVERIFIED）。对用户的影响是：**编辑范围文字时，输入框只显示单色纯文本，看不到范围的颜色和字重。**
- **编辑器 x 相位**：随相位交替为 0.30 / 0.70 device px（上一批已测），本批不修。

## 6. 行高截断：先期证据（本批不修）

`offline/lh-table-offline.jsonl` 与 R1 的 `coverage-matrix.lineHeightEvidence`：

- 用例为 Arial 14/1.3 与 16/1.35，各 6 行，top 相位 .3。
- 仿真 s1、强制 s2、真实 Host s2 三种环境中，实测的 layout 基线 **24 + 12 行全部等于截断（trunc）预测**，没有一行等于四舍五入（round）预测。
- 绘制基线有差异的行：仿真 14/1.3 第 1 行，round 得 53，trunc 得 52。其余行（含真实 Host 的 12 行）在这次采样里取整后相同。
- 结论：把 `textLineBoxBaselineY`、`textFiniteBaselineY`、`textLineBoxBaselineAt` 中行高的 LayoutUnit 取整由 round 改为 trunc，是一个数据完全支持的单点修复。但它会改变 SVG 行位置以及普通多行文字的像素；git 不可用，无法单独提交。因此把它归档为**下一批的明确小修**，没有“永远不做”。
- 不改 node.y、作者的逻辑行高、格式或 receipt。

## 7. 仍然存在的 FAIL / BLOCKED

- underline 经过下行字母（skip-ink 未建模）、line-through（没有拟合）：原生路径，颜色已正确，字形偏细——**BLOCKED**。
- finite 加字体相关范围：原生路径，原尺寸下明显偏移——**BLOCKED**（之前没有暴露，本批新发现）。
- 行高截断：既有缺陷，数据已经完备，下一批单点修复。
- 编辑器：x 残差（随相位交替）；编辑范围文字时不显示样式（N/A）。
- 上一批遗留：旋转细条和 chevron 的 AA、SVG 4 在 DPR1 下的圆角（无 DPR1 设备）。
- range-mixed-multiline 在真实 Host 100% 下被 overlay 遮挡，未验证。

## 8. 门禁、证据与提交状态

- **完整 `npm run check`**：TMPDIR 在仓库外，守门全部照常运行。**exit 0**（2026-11-07T08:23:26Z–08:35:17Z），共 4204 个测试，pass 4195，fail 0，skipped 9。被测的 12 个文件逐个记录了 sha256（`gates/check.files.sha256`），check 结束后复核一致。
- **validate**：exit 0（`gates/validate.log`）。
- **基线 diff**（`baseline-diffs/`）：
  - 4 个被修改的既有测试，与 5 个独立 worktree（r006–r009、svg-audit）中逐字节相同的副本做 diff。这 5 个副本是 `71b20017` 之前创建的，**无法用 git 证明它们与 71b20017 相同**，只能算佐证。
  - 两个生产文件与 `git archive 71b20017` 的快照做 diff，这份快照是上一批在权限丢失之前生成的。
  - scripts 与 suites 没有独立的基线副本，无法给出可证明的 diff，如实标注。
- **证据目录** `.tmp/range-decoration-evidence/`：
  - `electron/deco-r1/`：报告、bundle、wrapper；
  - `offline/`：装饰探针、Inter 版探针、离线 GPU 对 HTML、行高表、原尺寸合成图；
  - `crops-1x/`：86 张，带标签；
  - `unit/`、`tools/`、`gates/`、`baseline-diffs/`；
  - `SHA256SUMS`。
- **隔离**：R1 结束后 owned 进程已退出，`panel-desktop-ipc-*` 为 0，operator 的 20 个进程前后一致。没有 push、merge、发布或安装。
