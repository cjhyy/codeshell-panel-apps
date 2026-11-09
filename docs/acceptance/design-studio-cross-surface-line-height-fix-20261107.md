# Design Studio：finite typography 跨渲染面一致性 + 行高 LayoutUnit 取整（2026-11-07）

**状态：** review 的 I1 已在五个渲染面上闭合；行高（LH）取整已按实测规则单点修复；I2 的 ROI 污染已从夹具层面清除。

真实 Host 上 coverage 共 52 行，其中 51 行 PASS。唯一 FAIL 是 `cjk-skip-ink`（100%，c 0.162），原因是 skip-ink 断开边缘差 1 个 device px。严格的“断开边缘 ≤0.5”标准仍未满足，这一项不能被整体 ink PASS 掩盖。

不宣告 goal complete；未发布、未安装、未 push/merge/PR。

**提交情况：**

- 开工时 git 可读：`git status` 只有上一批未提交的 12 个文件和文档，我核对了上一批门禁（check 4215 / 4206 / 9 skip / 0 fail，validate 0）与文件 SHA 均未变化，提交为任务 checkpoint **`bf47f710`**。
- 本批归档时，macOS 再次拒绝访问主仓库 `.git`（`Operation not permitted`）。没有重试，没有绕过。本批改动**未提交**，完整归档在 `changed-files/`：current、baseline-bf47f710、diffs、diffstat。
- 基线来自 git 可读时用 `git worktree add` 在 `bf47f710` 检出的临时副本（`/tmp/ds-host-harness-tmp/cs/base-bf47`）。它在主仓库元数据里的登记，待权限恢复后用 `git worktree prune` 清理。

## 1. I1：无 provenance 的 finite typography 在五个渲染面上一致

**五值探针**（`probes/five-before-*.json`、`five-after-*.json`）：Arial 14/1.3，第 2 行含 18px run，接收数据（receipt）由浏览器实测生成。

| 节点（强制 DSF2，layout px） | DOM paint | GPU 修复前 → 后 | SVG 修复前 → 后 | 墨迹范围 / quality-repair |
| --- | --- | --- | --- | --- |
| 顶层 finite typography | 54, 76 | 54, **80** → 54, 76 | **50.7, 72.9** → 54, 76 | 认证旧 receipt → null；quality 回退到视图原点 (y 40.3, h 50) |
| flow 子节点 finite typography | 37.5, 59.5 | 37.5, **63.5** → 37.5, 59.5 | **37.9, 60.1** → 38, 60 | 认证旧 receipt → null；quality y 24（= y − 3.5） |
| provenance 对照（契约 offset 3.1） | 154, 176 | 153.5, 175.5（不变） | 153.8, 176（不变） | receipt（不变） |

仿真 DSF2：前两种节点修复后五个渲染面完全一致（54/75、38/59）；provenance 对照为 154/175，与 DOM 相同。

**根因**（两处，都已修复）：

1. **SVG 与墨迹范围：** 被 HTML 当作行框排版的 finite typography，SVG 的 typography 分支仍沿用 hanging 收据几何；墨迹范围对 typography 也例外地认证了旧收据。
2. **GPU 第 2 行起偏 +4 px：** 收据中的 `lineOffsets` 是实测的**基线差**（第 i 行基线 − 第 0 行基线，见 `measuredRangeLineGeometry`），不是行顶位置。但 `rangeBaseline` 把它当作行顶，又加了一遍每行混合字号的上升高度。这一问题影响所有带收据的混合 typography 文字，不限于 finite。

**修复：**

- **GPU：** 有收据时，每行 = 第 0 行行框基线 + 实测基线差，只取整一次。没有收据时，每行 = 估算行顶 + 该行的 alpha。
- **SVG：** 有浏览器字体度量时，使用视图 y 加混合字号行框：每个 run 计算 `floor((lh_g + A_g − D_g)/2)`，每行取最大值，s = 1；各行按收据的基线差排列。`resolveTextLineBoxMetrics` 可以按 run 的字体查询，供应方也可以传入函数。没有度量（Node 离线）时保留旧收据几何，并输出 `TEXT_LINE_BOX_SVG_UNMEASURED` 诊断，不会静默错位（已测试）。
- **`measuredTextInkBounds`：** 这类节点返回 null，不认证。
- **quality-repair：** 无墨迹时，回退框的 `base.y = view.y − node.y`，原先漏掉了这个平移。导出测试名 `qualityRepairVisibleBounds`。
- **不变的部分：** provenance 文字（纯文字和 typography）以及被搬运的文字，在 SVG、墨迹范围、GPU 上都保持原样。文档里的 `node.y`、offset、逻辑行高、收据格式都没有改动。

**测试（先红后绿）：** `finite-typography-cross-surface.test.mjs`，DSF1。

- 两种被转换的节点：GPU = SVG = 导出 HTML 的 DOM 基线（逐行）；墨迹范围为 null；quality 结果包含视图平移。
- provenance 对照：SVG 公式与收据认证均不变。
- Node 离线：输出诊断，且保留旧几何。
- 另一个限制：强制 DSF 下，SVG 是与 DSF 无关的 s = 1 文档，flow 节点为 38/60，DOM 为 37.5/59.5，相差 0.5 CSS px，这是导出格式固有的。

## 2. 行高 LayoutUnit 取整：按单位区分（不是一律截断）

**实测**（`probes/lh-unit-probe.out.txt`，Chromium 148，layout scale 为 1 和 2 时结果相同）：同一个数值的行高，在 24 组能区分 round 与 floor 的字号 × 比例组合上：

- **无单位倍数**（导出为 ratio 行高时的写法）：floor 24/24，round 0；
- **px 长度**（`lineHeightUnit: "pixels"` 导出 `Npx`）：round 24/24，floor 0。

这同时解释了两份已有的实测：

- 真实 Host 的 LH 行：14/1.3 为截断（本批 R1 中 12/12 行等于 trunc，0 行等于 round；10 行在 layout 上可区分，0 行在 paint 上可区分）；
- DOM oracle（`text-line-box-origin-ui`）：13.2px 的行距为 13.203125，即四舍五入。

我第一版“一律 floor”的改动被这个 oracle 打红，**按数据回退为按单位区分**。

**修复：** `textLineBoxBaselineY`、`textFiniteBaselineY`、`textLineBoxBaselineAt` 共用 `layoutLineHeight(node, v)`：

- ratio 行高：`floor(v·64 + 1e-7) / 64`；
- pixels 行高：`round(v·64) / 64`。

混合字号多行（无收据时）每行先取整再累加（`precedingLineHeights`）。原点仍用 trunc，负值原点不受影响。GPU 栅格与原生路径、SVG、文字墨迹范围都使用同一规则；frontend 的 CSS 本来就由浏览器处理，没有改动。

**半行距（half-leading）用浮点行高还是截断后行高：** 没有可区分的组合。A、D 都是整数（Canvas 会取整），而 floor64(y) ≥ e 当且仅当 y ≥ e（e 为偶数整数），所以 `floor((lh + A − D)/2)` 在两种取法下恒等。单测对字号 8–40、比例 1–2、四种 A − D 做了穷举扫描验证。因此保持用浮点行高。

**预测表与实际差异**（`probes/lh-predict-fixtures.txt`、`real-dsf-sweep-predict.txt`）：

| 来源 | 预测 | 实际 |
| --- | --- | --- |
| 32 个夹具 JSON + 6 个 harness 夹具中的多行文字 | 仅 s1 有两行变化：`range-multiline` 第 2 行 369→368，`underline-descender-2line` 469→468；s2 行框文字无变化；finite 文字取决于字体 | 离线仿真：两例由 FAIL（c 1.0）变为 PASS；旧规则代码下复现 FAIL |
| `real-dsf-layout-scale` 的 legacy 扫描（420 格） | 恰好 11 格上移 1px，全部在第 ≥1 行，第 0 行从不变化 | 测试改为逐格断言这 11 格 |
| `text-line-box-origin-ui` DOM oracle（1080 行） | px 行高仍取 round，不变 | PASS（第一版一律 floor 时失败 24 行，已按实测修正） |
| B0 四路矩阵 lines/variants 页 | 无变化 | 648 条 unique record 与 bf47f710 完全相同；仍是同样 6 个 `pixel cluster` 失败（与 LH 无关）；只有一个 tile 的渲染计数器不同（cache miss / revision / 耗时） |
| 新增 harness `lh-14-130`（y 680.34375：s2 下第 3 行 trunc 与 round 相差 1 device px） | 旧规则 FAIL，新规则 PASS | 离线：旧规则代码强制 DSF FAIL c 0.27，新规则 PASS；真实 Host 100% PASS c 0.000、fit PASS |

没有任何 golden 文件被重新录制或修改。所有测试改动都在上表中给出了预测和解释。

## 3. I2：ROI 污染

- **用现有原始数据重算**（`probes/roi-recompute.out.txt`）：`node-underline-mixed` 的区域从 [246,576,208,44] 改为 [246,576,208,40]，两者结果**完全相同**（100c：PASS +0.246% / c 0.011；fit：PASS −0.032% / c 0.071）。
- **原因：** 1x 证据显示 `flow-finite` frame 的标签位于 CSS 604–612.5，**在两个区域内部**，与 18px "Big" 的下行字母在纵向上交错。缩小区域会切掉真实的文字像素，按颜色遮罩也无法可靠分离。上一批“标签落在区域外”的描述也不准确，在此更正。
- **清除方式：** 把 flow frame 下移到 y 652，使它的标签（frame 上方约 18–26px）离开 [246,576,208,40]；夹具测试增加断言 `region bottom + 26 ≤ frame.y`。
- **真实 Host R1 的干净区域：** 100% PASS +0.29% / c 0.014，fit PASS +0.54% / c 0.015。1x 裁图中已没有标签（`crops-1x/cs-r1__targets__gpu-left-html-right.png`）。

## 4. 探针可靠性与 CJK

- **字体别名隔离**（单变量事实，不推断 Chrome 内部原因）：强制 DSF2 下，GPU 以 layout 字号测量自己的 `ck-font-*` 别名后，用**同一个别名**排版的 13px HTML 宽度为 95.60（新页面中为 101.15）。而同字节的另一个 FontFace（browser 路由使用自己的 `csbr…-resource-N`）宽度不变，仍为 101.15。回归测试见 `browser-font-alias-isolation.test.mjs`。
- **skip-ink 的 CJK 豁免扩展**（`probes/cjk-range-probe.out.txt`）：U+3200–33FF（㈱㉑㊙㋐㍿㎎）和 U+FE30–FE4F（︳︴﹍﹏）的字形会伸入截线带，但 HTML 都不断开；对照 g/y/j 断开，中 不断开。只补了这两个实测过的块。新增 oracle 用例“㈱ gyp ﹏ jump”，先红后绿。
- **断开边缘与真实 HTML 对比**（单测）：40 个边缘中 31 个精确，max 2、p90 1 device px。**严格 ≤0.5 仍为 FAIL。**
- **真实 Host `cjk-skip-ink`：** 100% 为 FAIL（c 0.162 > 0.15，ink +0.50%）；fit 为 PASS（+1.19% / c 0.098）。差异只出现在下划线的 4 行（47–50）、device 列 131 和 341：两个缺口边缘各宽 1 列。在 1x 下我用肉眼分辨不出，但测量数据明确存在。

## 5. 真实 Host R1（共 2 次额度，用了 1 次）

环境：Host 只读 19fbe3828，Chromium 130，真实 DPR2，平移 .3。

| 用例 | 100% | fit |
| --- | --- | --- |
| range-finite-typo（顶层） | PASS +0.10% / 0.004 | PASS +0.11% / 0.029 |
| flow-finite（provenance 两行 + flow typography 两行，含 18px） | PASS +0.12% / 0.003 | PASS +0.20% / 0.003 |
| finite-source-plain（provenance） | PASS +0.14% / 0.012 | PASS +0.22% / 0.007 |
| lh-14-130 | PASS +0.12% / 0.000 | PASS +0.24% / 0.008 |
| lh-16-135（对照） | PASS +0.14% / 0.013 | PASS +0.20% / 0.005 |
| node-underline-mixed（干净 ROI） | PASS +0.29% / 0.014 | PASS +0.54% / 0.015 |
| range-multiline / underline-descender-2line / range-mixed-multiline | PASS | PASS |
| cjk-skip-ink | **FAIL** +0.50% / 0.162 | PASS +1.19% / 0.098 |

- **其余 coverage 行：** 共 52 行，51 行 PASS。
- **其他组：** open / hit / save / SVG 圆角 PASS；性能 UNVERIFIED（安装版观察不到计数器）；same-camera 为 EVIDENCE_ONLY。
- **编辑器 overlay：** inter-bytes c 0.516、cjk-center c 0.415（x 相位），range-cjk-missing 为 UNVERIFIED（textarea 是纯文本，不显示范围样式）。与之前相同，属于已知的功能边界。
- **LH 实测：** 12/12 行等于 trunc。
- **收据：** operator 的 Electron 进程前后不变（20 个 PID）；自有 HOME 已删除。
- **R2 未使用：** R1 之后没有改动生产代码，而 R1 已经跑了完整的 open/hit/save/SVG/perf。

## 6. 门禁与证据

- `npm run check` **exit 0**（2026-11-07T11:26:39Z–11:39:22Z；4219 项，4210 通过，9 skip，0 失败）。`npm run validate` **exit 0**。均使用外部 TMPDIR。16 个改动文件门禁前后 SHA 0 不符。门禁期间没有修改任何源文件。
- 设计相关测试 1612 项全部通过。B0 lines/variants 前后对比见 §2。
- 证据目录 `.tmp/cross-surface-lh-evidence`：probes、tools、offline（含旧规则对照）、unit（含 B0 报告）、electron（含 wrapper 收据）、crops-1x（原上下文 + 目标对比）、changed-files、gates、`SHA256SUMS`。

## 7. 仍未解决

1. skip-ink 断开边缘严格 ≤0.5 FAIL（max 2、p90 1）；真实 Host 上 `cjk-skip-ink` 100% 仍为 FAIL。
2. provenance finite typography 在强制 DSF 下 GPU 偏高 0.5 layout px（1 device px）。这是契约搬运的原有行为，按要求保持不变，作为数据记录。
3. SVG 的 s = 1 取整在强制 DSF 下与 DOM 差 0.5 CSS px（导出格式固有）。
4. 编辑器 textarea 不支持富样式；x 相位只覆盖 .3 / .7；DPR1 未测；SVG 的 4 个历史 FAIL 与旋转 AA 保留；旋转与 grid 的 finite 节点只有单测覆盖。
