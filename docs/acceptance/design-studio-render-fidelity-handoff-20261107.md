# Design Studio 渲染保真：最终交付说明（2026-11-07）

**这是一个“有限边界”的修复候选，不是正式发布。** 它解决的是“真实 HiDPI Host 里 GPU 画布和 HTML 有明显样式差异”这个问题，但并不像素级一致（not pixel-perfect），也**不代表所有绘制路径都已通过**。下面列出的严格 FAIL 全部保留。独立 review 448732e1 的结论是：代码 PASS，无 Critical/Important；有限产品验收为 ACCEPTABLE_WITH_LIMITS。

> 后续补测（高风险路径与 DPR1，修复 3 个真实缺陷，DPR1 未能受控）见 [design-studio-fidelity-coverage-followup-20261107.md](design-studio-fidelity-coverage-followup-20261107.md)；下文是 `29833828` 时的状态。

## 1. 版本与提交链

- **分支**：`codex/design-studio/fidelity-host-harness-20261107`（只是本地一次性 worktree，没有 push）。
- **提交链**：`7864c26b`（main 上 PR #93 的 merge，作为基线）→ 29 个本地提交 → 最终候选为本说明所在的提交。
  - `464203c4`…`f7425666`：此前各轮的保真修复与审计。
  - `e2a67e86`…`de5aaffa`：真实 Host harness、探针和归因。
  - **`92940ce6`：本任务的核心 production 修复**（真实 DSF 下的布局网格）。
  - `15d8cf85`：严格合同（删除 4% 放宽）和光栅后端探针。
  - 本说明所在的提交：只改文档。
- **完整 `npm run check`**：上一次跑在 2026-11-07T05:14–05:26Z，对象是随后**原样提交为 `92940ce6` 的工作树代码**。exit 0，共 4189 个测试，pass 4180，fail 0，skipped 9。之后的 `15d8cf85` 和本提交没有改 production，**没有再跑全仓 check**，只跑了定向门禁（§6）。

## 2. 改了什么（production，只在 `92940ce6`）

在真实 DSF 下，Chromium 会按 DPR 放大布局：LayoutUnit 为 1/64 物理 px，盒子和文字基线在 CSS 变换之前按物理像素取整，行盒的字体度量取自 fontSize×DPR。GPU 画布原先模仿的是仿真 DSF（Playwright）的 CSS 像素规则。

修复的做法是：先用一次离屏 DOM 探测判断当前是真实还是仿真布局（`blinkLayoutScale`），然后让文字行盒、小矩形和旋转图形的盒子与枢轴跟随这个网格。仿真模式（scale 1）的输出逐位不变。

涉及文件：

- `apps/design-studio/app/text-line-box.mjs`
- `apps/design-studio/app/canvas/browser-paint-box.mjs`
- 接线：`apps/design-studio/app/canvas/canvaskit-text.mjs`、`apps/design-studio/app/canvas/canvaskit-renderer.mjs`

作者的设计稿、`fontFamily` 存值、文档几何、格式、序列化、SVG/frontend/receipt 都没有改；默认渲染器没有切换，Electron 没有升级。

## 3. 真实 Host 结果（已构建的 Host `19fbe3828`，Electron 33.4.11 / Chromium 130，真实 DPR2，owned 隔离实例）

- **功能**：open、命中（hit）、save/reopen、SVG 圆角在 Host 中 **PASS**。
- **性能**：1200 段文字，小数手势，真实 RAF，同一 CDP 会话：
  - p50 8.3 ms，p95 约 9.9 ms，max 83.5 ms，脚本 CPU 108 ms；
  - 修复前为 p95 9.7 ms、max 76.4 ms、脚本 101 ms；
  - renderer 内部统计（采样构建、tile 等）在已安装 app 中不可观测，状态为 **UNVERIFIED**。
- **GPU 对 HTML**：6 case × 100%/200%/fit/小数 pan，严格合同为质心 ≤0.15，50% 边 ≤0.5，ink ±3%：
  - 真实 DPR2：**4/24 → 22/24**；
  - 仿真 DSF2：修复前后都是 **24/24**（不变）；
  - 文字：质心 ≤0.011，ink ≤0.31%；
  - 小矩形：质心 ≤0.003，ink ≤0.19%。
- **修复前后截图**：[真实 Host z2 4×，上排修复前、下排修复后，每格左 HTML 右 GPU](../../.tmp/real-dsf-evidence/electron/e-green/sbs-z2.png)。修复前 GPU 的 `>_` 偏低、“Continue” 偏高、小矩形宽约一倍；修复后两条路线一致。

## 4. 严格 FAIL（全部保留，阈值未放宽）

| 项目 | 数值 | 状态 |
| --- | --- | --- |
| 45° 圆角灰色细条，fit 0.615（真实 Host） | ink −11.50% | FAIL |
| 同一细条，小数 pan 13.65/11.85（真实 Host） | 质心 0.151，ink −3.92% | FAIL |
| 实际 chevron 双条，fit（真实 Host） | 质心 0.237 | FAIL |
| 小矩形 fit，强制 DSF headless（软件光栅） | ink +4.73% | FAIL |
| SVG 4，DPR1 圆角 | — | FAIL，DPR1 真实 Host 未实测 |

**有限验收的依据**（主代理接受的边界）：只限上面这些节点和相位。单变量实验中，只给同一个 owned Electron 加 `--disable-gpu-rasterization`，结果翻转：

- 关掉 GPU raster 后，HTML 自己在 fit 下的细条 ink 就变化了 −11.62%；
- 两种光栅后端下，GPU 画布始终分别只能匹配其中一种。

所以剩余差异来自亚像素抗锯齿，几何、位置和命中都一致。这**不等于“已经完全没有差异”**。1x 原尺寸下差异能否被人眼察觉，本任务**不做判断**，请看原图：

- 1x 合成图：[fit](../../.tmp/real-dsf-evidence/raster-backend-pairs/1x-strip-fit-composite.png)、[小数 pan](../../.tmp/real-dsf-evidence/raster-backend-pairs/1x-strip-z1-pan-composite.png)；
- 逐格标签：[composite-index.md](../../.tmp/real-dsf-evidence/raster-backend-pairs/composite-index.md)（含 route、backend、DPR、zoom 和源 PNG 哈希）。

这些文件用看图工具按 100% 打开即可，不需要普通浏览器。

## 5. 未覆盖（没有在真实 DSF 下验证）

- 范围文字（textRanges）
- 描边文字和各类描边
- 图片 fit
- 编辑器 overlay
- 居中对齐文字的 x 方向 LayoutUnit
- 多行 finite 文字
- instance 回退路径
- 非整数 DPR（如 1.25、1.5）
- DPR1 真实 Host

## 6. 门禁与证据

- **本批**（只改测试和文档）：
  - probe/harness 单测 79/79；
  - `desktop-harness` 套件 92/92；
  - `validate` exit 0；
  - 交付前在最终工作树上又重跑了上述三项（文档改动之后），结果追加在 `.tmp/real-dsf-evidence-verify-20261107.log`。
- **证据归档**：`.tmp/real-dsf-evidence/`，任务自有的副本，未提交；原始文件不变，变更历史见 `CHANGELOG.md`。
  - `SHA256SUMS`（v1，216 个文件，sha256 `342d9a98…829da8`）：独立逐条重算结果为 216 OK / 0 mismatch / 0 missing，`shasum -c` exit 0。
  - `SHA256SUMS.v2`（221 个文件，只是在 v1 基础上新增）：全部 OK。
  - 校验收据：`.tmp/real-dsf-evidence-verify-20261107.log`（归档内也有一份较早的快照）。
- **详细技术记录**：[design-studio-real-dsf-render-fix-20261107.md](design-studio-real-dsf-render-fix-20261107.md)。

## 7. 隔离与安装状态

- **真实 Host 运行**：全部是 owned 隔离 Electron。本修复与因果批次共 6 次：`e-red`、`e-green`、`e-diag`、`e-full`、`rb-default`、`rb-nogpuraster`，收据见归档的 `electron/*/wrapper/`。更早的 run1–run4 和 E1/E2，其清理记录在各自的验收文档中。
  - 每次结束时 owned 进程都已退出，临时 HOME（`panel-desktop-ipc-*`）都已删除；
  - operator 的 Electron/CodeShell 进程集合在每次运行前后都一致；
  - Host checkout 停在 `19fbe3828`，工作区干净。
- **正式安装没有更新**：本任务没有安装、发布、merge 或 push。用户正式安装的版本（任务输入称为 0.23.0）未被触碰，其版本号本任务没有核实。
- **候选怎么用**：它只存在于本地一次性 worktree，用户不应依赖这个 worktree。要进入正式版本，需要走正常的集成、review、发布和安装流程。
