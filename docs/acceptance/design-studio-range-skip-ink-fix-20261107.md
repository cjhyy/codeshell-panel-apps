# Design Studio 范围文字收尾：skip-ink 栅格化、原生路径错行、finite SVG 跨渲染面一致（2026-11-07）

**状态：本批的目标可见问题在真实 Host 上全部 PASS；仍有已披露的未达项（§7），不宣告 goal complete。** 未发布、未安装、未 push/merge。

**本批未提交。** 批次中途，macOS 再次拒绝访问 `~/Documents` 下主仓库的 `.git`（`Operation not permitted`）。未绕过、未提权、未改系统设置，也没有反复探测。

- 12 个改动文件已逐一归档：当前文件、基线文件、unified diff、SHA，见 `changed-files/`。
- 基线来源可证明：基线是 git 仍可读时，用 `git worktree add --detach` 在 `4cc3330b` 检出的完整副本（`/tmp/ds-host-harness-tmp/sk/base-wt`）。
- 这个临时 worktree 在主仓库元数据里的登记，要等权限恢复后执行 `git worktree prune` 才能清理。
- 开工时 `git status` 干净（基线 `4cc3330b`），没有发现其他写入者。

## 1. 根因：6.6% 的“Canvas 比 HTML 宽”是探针错误，不是生产问题

旧 skip-ink 探针（`deco2`）中，HTML 的范围宽度比 Canvas 窄约 5.2%。逐个单变量排查（`tools/width-probe.mjs`、`order-probe*.mjs`、`deco2-bisect.mjs`）：

- **以下都不是原因：**
  - 字体字符串（含生产用的别名形式）；
  - `document.fonts` 真实注册（不是 shadow root 里的 `@font-face`）；
  - kerning auto 与 normal（结果相同；none 宽 0.25%）；
  - letterSpacing；
  - viewport 宽度；
  - 是否加载 CanvasKit；
  - FontFace 与 CanvasKit 是否共享同一个 ArrayBuffer。
- **找到的原因：** 用 CDP `CSS.getPlatformFontsForNode` 查到，旧页面里 13px 的 HTML 实际用的是 `InterVariable_opsz1A0000`（opsz = 26 = 13 × 2）。单变量复现：在**强制 DSF2** 下，如果在 HTML 排版**之前**先用 Canvas 以 26px（= 13 × 2）测量 Inter，之后 13px 的 HTML 就会复用 opsz 26 的实例，宽度 101.148 → 95.602（−5.5%）。
  - 先测其他字号，或在仿真 DSF 下，都不会触发。
  - Arial 不是可变字体，不受影响。
  - 旧探针恰好在排版前按 `size × s` 测了 Canvas。
- **处理：**
  - 旧数据中“强制 DSF + Inter”的各行作废，保留在 `probes/old-deco2-forced-VOID/` 只作为错误证据，不再用于拟合。
  - 仿真行与 Arial 行未受影响。
- **修正后的探针（`deco3`）：** layout 尺寸的 Canvas 测量移到单独页面，并在截图之后进行；列宽改大，消除邻列串扰；截图比例取真实 DPR。
  - 48 行（Inter/Arial × 13/14/18/24 × 3 段文字 × 强制/仿真）：HTML 与 Canvas 宽度差最大 1.26e-4（≤0.013%）。
  - 下划线模型和 line-through 模型在干净数据上 **96/96 精确**。
- **对生产的影响：** 生产栅格在 CSS 字号下测量，宽度一直正确。layout 字号下的 Canvas 测量只用于读取纵向度量。真实 Host 的 browser 路由与 GPU 一致，没有观察到这个缓存效应，但它是一个已记录的风险。

## 2. skip-ink 改为在栅格上实现（不再回退原生）

**模型。** 只依据修正后的探针，每个参数都是厚度的简单函数，没有按字体的魔数：

- 截线带：下划线顶部起，高度 th = fontSize / 10 CSS px（不取整），最后一行按所占比例加权；
- 墨迹：**只用该 run 自己的字形**（同字体、同原点单独绘制），alpha > 0.02 的列，左右边缘取小数；
- 膨胀：每个墨迹段左右各扩 D = th；
- 吸附：取整到栅格像素（实测 HTML 的断开边缘是整像素、无抗锯齿）；
- 下划线只画缺口之间的整像素段。

**干净探针的拟合结果**（Inter + Arial，13/14/18/24，三段文字，强制/仿真）：496 个边缘中 392 个精确（79%），最坏 1 px，p90 1 px（`probes/skipink-clean-fit.out.txt`）。

**CanvasKit 精确截线（只作对照）：** 强制 54/62、最坏 2 px；仿真 40/62、最坏 3 px。比栅格 alpha 差，因此不采用。

**CJK（实测规则）：** HTML 在 CJK 字符周围从不断开下划线，包括汉字、平假名、谚文、全角拉丁字母和 CJK 标点，即使用 CJK 字体也一样。拉丁下行字母会断开，即使用 PingFang SC 渲染也会（`probes/cjk-skip-probe.out.txt`）。因此这些字符不计入墨迹。

**节点级下划线覆盖混合字号（实测）：**

- 按纯 CSS 规则，节点级下划线的厚度和位置都来自修饰盒（`probes/node-deco-*.out.txt`）。
- 但 frontend-export 的做法不同：有范围时节点自身的 `text-decoration` 是 `none`，**每个 run 的 span 各自带 `text-decoration-line`**，所以每个 run 都是自己的修饰盒，厚度、位置和截线带都按该 run 的字号计算。
- GPU 保持按 run 计算。中途曾按纯 CSS 规则改为“节点字号”，但真实 app 的 HTML 数据否定了这一做法，已回退。单测 oracle 也改为与导出结构一致。

**断开边缘与真实 HTML 对比**（单测，DPR2 页面，2x 表面）：32 个边缘中 24 个精确，max 2、p90 1 device px。原始数据见 `unit/gap-edges.txt`：

| 用例 | HTML 缺口 | GPU 缺口 |
| --- | --- | --- |
| Inter 两行（第 0 行） | [64,83] [90,104] [156,186] [197,227] [251,264] | [64,84] [89,104] [156,186] [197,227] [250,264] |
| Inter 两行（第 1 行） | [62,76] [198,212] [280,299] | 完全相同 |
| 节点下划线 + 24px run | [119,189] | 完全相同；base 行 [268,269]、run 行 [270..273]，与 HTML 一致 |
| Arial gpy | [147,188] [200,220] [233,252] | [147,189] [200,220] [233,252] |
| CJK 混排 | [130,170] [175,187] [339,352] [408,419] | [129,171] [175,187] [337,352] [408,420] |

**未达项（如实披露）：** 上一批“断开边缘 ≤0.5 device px 才采用”的规则**未满足**（最坏 1–2 px）。本批按你的要求把 skip-ink 改为栅格实现，以严格的逐例指标（ink ±3%、质心 ≤0.15、e50 ≤0.5）判定，阈值没有放宽。单测里的 `worst ≤2`、`exact ≥60%` 只是回归护栏，不是验收阈值。

## 3. 原生回退路径错行

- **根因：** `drawTextRanges` 的 y 用的是普通行框（`paintBaseline` 减去段落基线），混合字号时整行比 HTML 高约一行。
- **修复：** 改用与栅格相同的实测混合字号行框（`rangeBaseline`）。所有行先校验、再绘制；非预期异常照常抛出。
- **测试：** 一个原生节点（节点级 line-through + typography → `line-through-mixed-typography`），三行分别是 18px run、普通行、24px run，y 为小数。三行的段落 paint 基线与真实 DOM 标记基线**逐行相等**（误差 ≤1e-6）。
- 在 `4cc3330b` 上为红。

## 4. finite 文字的 SVG 与墨迹范围（review I1/I2）

**修正上一批的 A：** 带 provenance（`layoutBaselineSource` 为 html/native）的 finite 文字，应保持“实测 offset 的 hanging 搬运”，不应改成重算行框。

- 依据一：`html-import` 只在浏览器实测的行框 offset 能精确复现 y 时，才写入 provenance。因此 `y + hanging` 偏移就是 DOM 基线。
- 依据二：用 Canvas 度量重算行框，在 Times New Roman 12px 上偏 1 px（native line box SVG 像素 oracle：搬运 0 差异；重算 4923 个通道不同）。
- 依据三：混合 typography 的 SVG 像素 oracle 同样要求保持搬运。
- 上一批 `finite-source-plain` 的 c 1/2 来自**无效夹具**：offset 3.5 是随手写的，`html-import` 不会给它 provenance。现改为契约有效值：Arial 14/1.2 实测 2.59375 → 2.5938。

**统一规则**（GPU / SVG / 墨迹范围采用同一个 `textHtmlFiniteLineBoxShift`）：

| 节点 | GPU | SVG | 墨迹范围 |
| --- | --- | --- | --- |
| 被搬运 / 带 provenance（纯文字或 typography） | 保持搬运；provenance + typography 时为首行搬运加实测行偏移，与 SVG 公式一致 | 不变 | 不变 |
| 无 provenance、不被搬运的纯文字（旋转、约束、grid、flow） | HTML 行框：顶部为 y，或 y − offset（flow 与 grid 都算布局所有） | 改为行框 | 不认证（返回 null，调用方用保守估算）：hanging 收据里没有行框度量 |
| 无 provenance 的 finite + typography | 行框 | **仍是收据几何**（按你的要求不二次平移） | 收据几何 |

**SVG 预测表**（`unit/svg-predicted-table.txt`）。每行由公式预测，不是照抄当前输出，实际值逐一相等：

| 节点 | old | 预测 = 实际 |
| --- | --- | --- |
| transported | 50 | 50 |
| source（provenance） | 90 | 90 |
| source-multi | 130, 147 | 130, 147 |
| rotated | 190 | **192** |
| centered | 230 | **232** |
| grid-text | 310 | **309**（grid 子节点由布局所有，顶部为 y − 3.5） |
| flow-source（provenance） | 433, 450 | 433, 450 |
| flow-typo（typography 分支） | 480 | 480 |
| 无限画布根节点（约束被导出钉为 start） | 搬运 | 不变 |

**I2 的覆盖：**

- 新单测覆盖每个分支：谓词 / 视图、SVG 预测表、墨迹范围、GPU 与 SVG 的 provenance typography 一致性。
- 新增 harness 用例 `flow-finite`：一个纵向 frame，包含 provenance 两行子节点（契约 offset 2.7969）和无 provenance 的 typography 子节点。离线两种模式均 PASS，真实 Host 100% 与 fit 均 PASS。
- 旋转和 grid 只有单测与离线覆盖，真实 Host 没有覆盖。
- 收据存值、`node.y`、offset、格式都没有修改；SVG 只出现预测内的变化，没有任何 golden 文件被修改。

## 5. 真实 Host R1

环境：Host 只读 19fbe3828，Electron 33 / Chromium 130，真实 DPR2，平移 .3。报告：`electron/sk-r1/`；1x 带标签裁图：`crops-1x/`。

| 用例 | 100%（各带） | fit（0.701） |
| --- | --- | --- |
| underline-descender-2line（skip-ink） | +0.60% / c 0.056 **PASS**（上批 −14.69% FAIL） | +0.76% / 0.034 PASS |
| node-underline-mixed | +0.25% / 0.011 **PASS**（上批 c 13.79 FAIL） | −0.03% / 0.071 PASS |
| arial-underline | +0.44% / 0.047 PASS | +0.62% / 0.038 PASS |
| finite-source-plain（契约 offset） | +0.14% / 0.012 PASS | +0.18% / 0.028 PASS |
| flow-finite（新） | +0.12% / 0.006 PASS | +0.17% / 0.004 PASS |
| range-finite-typo / line-through / mixed-multiline | PASS | PASS |
| 旧 range 用例、普通文字、CJK、图片 | 全部 PASS | 全部 PASS |

**原始视觉**（`crops-1x/sk-r1__targets__gpu-left-html-right.png`）：7 个目标用例 GPU 与 HTML 目视一致，下划线缺口、24px 下划线、flow 都一致。

- 注意：`node-underline-mixed` 的裁图区域里包含 `flow-finite` frame 的标签（编辑器 UI，灰字）。它在两个路由中完全相同，不会掩盖文字差异，但会稀释该行的百分比。

**其他组：** open-without-edit / immediate-click-after-edit / save-reopen-stable / svg-corner-aa-host 为 PASS；low-zoom 性能为 UNVERIFIED（安装版观察不到计数器）；same-camera 为 EVIDENCE_ONLY。

**coverage-matrix 组仍为 FAIL。** 原因**不是**画布行：画布行在 100% 与 fit 下全部 PASS。原因是编辑器 overlay（textarea 与画布对比）：

- inter-bytes：c 0.516（x 相位）；
- cjk-center：c 0.415（x 相位）；
- range-cjk-missing：textarea 为纯文本，记 UNVERIFIED。

这三项与上一批运行逐字节相同，是已知的 textarea / x 相位限制，属于本批之前就存在的问题。**更正：上一批文档写 coverage-matrix 唯一失败是两个 skip-ink 用例，这不完整；这三项 overlay 当时也已失败。**

**运行收据：** operator 的 Electron 进程前后相同（20 个 PID），自有 HOME 已删除。只用了 1 次真实运行：R1 跑的是完整 harness（含 open/hit/save/SVG/perf/LH），且 R1 之后没有改生产代码，所以第二次运行未使用。

## 6. 离线结果（Chromium 148，`offline/off-table.txt`）

- 强制 DSF：20 个用例 × 100 / fit 全部 PASS（40/40）。
- 仿真 DSF：36/40。唯一失败是 14/1.3 两行文字的第 2 行（`range-multiline`、`underline-descender-2line`，c ≈ 1.0）。这是已知的 LH 截断行，属于行位置问题，不是 skip-ink；真实 Host 上 PASS。

## 7. 仍未解决 / 未覆盖

1. skip-ink 断开边缘最坏 1–2 device px（p90 1）。上一批 ≤0.5 的采纳规则未满足。逐例严格指标在真实 Host 上 PASS。
2. 无 provenance 的 finite + typography：SVG 仍是收据（hanging）几何，GPU 是行框，两者不一致。按你的要求没有二次平移，留作后续。
3. 节点级 line-through 覆盖混合 typography：仍为原生回退（`line-through-mixed-typography`）。原生路径的基线已修正；line-through 自身的位置按 run 不同，没有建模。
4. LH 截断：真实 Host 上 12 行中 10 行 round 与 trunc 的 layout 预测不同，实测全部等于 trunc，0 行在绘制上可区分；仿真 14/1.3 的第 2 行可区分。截断修复是下一个独立单点，本批未混入。
5. 编辑器 textarea 的 overlay 三项 FAIL / UNVERIFIED（见上），未处理。x 相位只覆盖 .3 / .7。
6. DPR1 未测；SVG 的 4 个历史 FAIL 保留；旋转和 grid 的 finite 节点真实 Host 未覆盖。
7. 有一个已记录的风险：强制 DSF 下，若在排版前以 layout 字号用 Canvas 测量可变字体，会影响之后的 HTML（opsz 缓存）。生产中未观察到。

## 8. 门禁与证据

- `npm run check`：
  - 第一次 exit 1：2979 项中失败 1 项，在 `tests/apps/video-download/service.test.mjs` 的“concurrent retries”。这是锁文件竞争（`.write.lock/owner.json` ENOENT），video-download 不在本批改动内；单独重跑 3 次，均为 29/29 通过。日志保留在 `gates/check-run1-exit1-video-download-flake.log`。
  - 完整重跑 **exit 0**（2026-11-07T10:37:31Z–10:50:15Z；4215 项，0 失败，4206 通过，其余为 skip/todo）。
- `npm run validate`：**exit 0**。
- 两次都使用外部 TMPDIR（`/tmp/ds-host-harness-tmp/sk/gates-tmp`）。12 个改动文件在门禁前后做 SHA 校验（`gates/check.files.sha256`），0 个不符。
  - 披露：门禁运行期间，我为了输出预测表，临时给 `text-html-finite-transport.test.mjs` 加过一行只打印、不改断言的日志，随后恢复；恢复后的 SHA 与门禁前记录的值相同。
- 设计相关测试：本批完成后 1609 项全部通过（`unit/ds-suites3.log`）。
- 证据目录 `.tmp/range-skip-ink-evidence`：probes（含作废数据）、tools、offline、unit、electron（含 wrapper 收据）、crops-1x、changed-files（current / baseline-4cc3330b / diffs / diffstat / BASELINE.txt）、gates、`SHA256SUMS`。
