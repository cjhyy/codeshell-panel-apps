# Design Studio 真实 Host 渲染差异跟进（2026-11-07）

**结论：这次没有改 production。** run3 中 GPU 独有的 4 类偏移（`>_` 文字、按钮文字、旋转细条、chevron）以及小矩形宽高偏差，都已在真实 Electron 中复现，并且用离线的 headless Chromium 148 做了交叉验证。GPU 的输出与 Chromium 148 渲染同一份 HTML 参照**逐像素一致**：质心差 ≤0.05 device px，ink 比约为 1。而 Host 自带的 Electron 33（Chromium 130.0.6723.191）在布局和绘制上与 148 相差约 0.5 world px。

所以根因是 **Chromium 版本差异**，不是 GPU 渲染器实现写错了。要修，就必须决定 GPU 的吸附规则以哪个引擎版本为准，或者做成随引擎变化，这需要主代理决策，不属于最小修复。finite 文字之前看到的 −5/−3 px，已证实只是 Node 生成参照图造成的假差异。目标未完成。

## 范围与环境

| 项 | 值 |
| --- | --- |
| Panel 分支 | `codex/design-studio/fidelity-host-harness-20261107` |
| 起点 | `dc192924` |
| harness 资格修正提交 | `c6ce798d` |
| 本文档提交 | 见 git log |
| Host | `/Users/admin/.codex/worktrees/codeshell-design-fidelity-host-build-20261107`，`19fbe3828`，只读，未改动 |
| 运行时 | Electron 33.4.11，Chromium 130.0.6723.191，Node 20.18.3，darwin arm64 |
| 显示 | guest DPR 2，viewport 1024×720；**DPR1 没有实测** |
| 对照 | headless Chromium 148.0.7778.96（Playwright 1.60），只读本仓库 `apps/design-studio/app` 的文件，其余请求一律 abort，实际被拦请求数 0 |

`apps/` 全程未改（`git diff HEAD -- apps/` 为空）。没有改 Host、其他 Panel、lock 或用户稿，没有 push、merge 或发布，没有调用付费 provider，没有碰用户 tab。

## 一、harness 比较资格修正（`c6ce798d`，不涉及 production）

1. **HTML 参照改在 guest 中生成。** run3 的参照图是在 Node 里用 `frontend-export` 生成的，而 `finiteTextPaintOffset`（`frontend-export.mjs:442-469`）在没有 `document` 时直接返回 0，所以 finite 文字少了浏览器实测的 hanging→alphabetic 偏移。现在参照 HTML 由已安装的 `frontend-export.mjs` 在 guest 页面中、`document.fonts.ready` 之后生成，交给 JS 关闭的 owned 参照窗口栅格化。报告中 `reference.source` 为 `"guest"`，并记录每个字体的 `document.fonts.check` 结果（Menlo 13、Arial 600 14、Arial 14 均为 true）。若参照不是来自 guest，判定函数直接判 UNVERIFIED。
2. **100%/200% 改为按样本锚定缩放。** app 的 Ctrl+wheel 以光标为中心缩放（`setZoom` 的 focal）。现在先 fit，再以样本所在 frame 中心为光标位置闭环缩放到目标，然后对 3 条路线截图。对比只使用样本区域裁剪：区域超出截图、被 DOM 覆盖层遮挡、或与 app 在 canvas 上画的 frame 标签带相交（zoom ≥ 0.65 时，`canvas-interaction.mjs:70-75, 219-226`），都会判为不可比较。整张原图全部保留。
3. **CPU 指标改为单一 CDP 会话。** 整个测量期间只 attach 和 `Performance.enable` 一次，前后各读一次，最后在 finally 中 disable/detach 一次。rAF 间隔分开统计：全程一组，真实 pan+zoom 手势窗口内一组。
4. **文件对话框的重试条件。** 对话框为空，但结构化 `workspace.list` 成功且列表中有目标文件时，等 app 的 3 s 发现缓存过期后重开一次。只有证据确实是 `RATE_LIMITED` 时，才按 Host 给出的 `retryAfterMs` 等待。
5. **只读运行时探针。** 用已安装的纯模块记录：Canvas2D 字体度量、`textLineBoxAlphabeticOffset`/`textLineBoxBaselineY` 的输入与输出，以及 `browserPaintBoxes` 给出的 box、pivot 和 fallback。

离线验证：

- 红：64 tests / 60 pass / 4 fail（`.tmp/host-harness/run3-fix-red.log`）。
- 绿：64/64。
- `npm test -- --suite desktop-harness` 77/77；`npm run validate` exit 0。两者都不启动窗口。

## 二、真实 focus run（run4）

```sh
TMPDIR=/tmp/ds-host-harness-tmp npm run test:desktop -- \
  /Users/admin/.codex/worktrees/codeshell-design-fidelity-host-build-20261107 --app design-studio --design-studio-fidelity
```

- 2026-11-07T04:08:19Z → 04:10:32Z，共 133 s，exit 3（INCOMPLETE）。Panel 为 `c6ce798d15bee1b64200d052d0590d5c63c688e8`。
- 证据文件：
  - 日志 `/tmp/ds-host-harness-tmp/run4/run.log`，sha `734e5ec9…6cc`；
  - FD 报告 `/private/tmp/ds-host-fidelity-1794024500171-a29510ad85bbc758.report.json`，0600，268,984 bytes，sha `36a7087a…0f14`；
  - bundle 为同名 `.artifacts.bin`，0600，1,049,399 bytes，sha `2d96ad1a…86f4`。
- 隔离：
  - app.paths 全部位于私有 `panel-desktop-ipc-*` 目录；
  - NativeEntry 只有 self-test，**没有 codex**；
  - pid 2657 和 2691 的 guard 各 7 次负向探测都通过；
  - 通用闸门 PASS；没有未结清的 owned 工作。
- 清理：回执为 pid 2691，exitCode 0，`homeRemoved:true`。运行后 pid 2657/2691 都已不存在，临时 HOME 已删除；operator 的 Electron/CodeShell 进程集合前后都是 23 个，diff 为空；Panel 和 Host 的 checkout 都干净。

| 场景 | 结果 | 真实证据 |
| --- | --- | --- |
| 低 zoom 1200 文字 | UNVERIFIED（renderer stats 没有出口） | 第 1 次尝试就打开，DOM 中有 **1,200** 个文字图层；zoom 为 **0.3711000085**，pan 为 −481.34 / 166.68；761 ms 的 pan+zoom 手势窗口内有 **92** 个 rAF 间隔，p50 8.3 ms、p95 9.7 ms、max 10.3 ms（全程 134 个间隔，最大 76.4 ms，出现在手势之外）；CPU（单一会话）为 Script **100.8 ms**、Task **297.1 ms**、Layout 0.92 ms、RecalcStyle 1.69 ms |
| 打开旧稿不编辑 | PASS | 打开前后 sha `f292eaf8…`、mtime、size 都不变；2,348 ms 内 10 次采样均为 saved；4 个旧 receipt 保持失效 |
| 拖动/编辑后立即点击 | PASS | 拖动精确落在 x=**400**；新位置、旧位置、只含 underlay 的位置三处点击选中 id 都正确，点击发生在提交后 0–16 ms；inspector 改 x=200 PASS；`insertText` 加 Cmd+Enter 提交 "Edited HMI 已编辑" |
| 保存/重开 | PASS | 两次保存结果都是 saved；reload 后快照与第一次保存一致；reload 后 DOM 中的期望值正确 |
| 同相机截图 | UNVERIFIED | 14 个样本组中 13 个可比较，三条路线的相机和裁剪完全一致。`finite-text@200` 的区域宽 761 px，从 x=256 起超出 986 px 截图，被裁切所以不可比较；判定原因文字写成了“overlaps app overlays []”，这是措辞问题，实际原因是裁切 |
| SVG 4 个几何 | PASS（DPR2） | 导出 SVG 的 oracle 结果与 run3 相同；DPR1 的 4 个 FAIL 是旧合同下的结论，原样保留 |

## 三、像素对比（有效裁剪，device px，GPU 或 browser 减 Chromium 130 HTML）

| 样本 | zoom 1 | zoom 2 | fit 0.615 | 折算 world 偏移 |
| --- | --- | --- | --- | --- |
| finite 文字（对照组） | GPU (0.003, 0)，browser 0 | 不可比较 | GPU (0.01, 0) | **0**（参照改为 guest 生成后差异消失） |
| `>_` 文字 | GPU +0.995 | +1.999 | +1.008 | +0.5 y |
| 按钮文字 | GPU −0.999 | −2.001 | −1.001 | −0.5 y |
| prompt 旋转细条 | GPU (−0.94, −1.02)，ink 0.95 | (−1.98, −2.26) | (−0.65, −0.69)，ink 0.92 | ≈(−0.5, −0.5) |
| chevron | GPU (+1.43, −0.67) | (+2.71, −1.71) | (+0.85, −0.63)，ink 0.90 | ≈(+0.7, −0.4) |
| browser 渲染器（以上全部样本） | 0 | 0 | 0 | 与 Chromium 130 HTML 完全一致 |

偏移随 zoom 成比例变化，换算到 world 坐标是固定值，所以不是 device 相位、AA 或裁剪原点造成的。stage rect 为整数，截图 rect 偏移为 0。

**跨版本验证。** 在同一份参照 HTML、同一相机、DPR 2 下，用 headless Chromium 148 渲染并测同一裁剪区域。每个样本都满足：GPU(130) − HTML(148) ≈ (0, 0)，最大 0.05 px；而 HTML(148) − HTML(130) 恰好等于上表的 GPU 偏移。例如 chevron@100 为 (1.428, −0.664)，`>_`@200 为 (−0.002, 1.999)。

小矩形（1.26×7.2 的竖条，zoom 1）：精确面积 36.29 device px²；HTML148 的 ink 质量为 64.18，GPU130 为 63.97，质心相同；browser130 为 28.02。横条也是同样的规律。

**机制。** Chromium 148 在缩放/DPR transform 之前，按 CSS（world）像素吸附：1.26 world px 变成 2 world px，也就是 4 device px，文字基线取整到整数 world px。Electron 33 的 Chromium 130 则在 DPR 之后按 device 像素吸附：2.52 device px 变成 2。

GPU 渲染器按 148 的规则实现：`text-line-box.mjs` 中 `textLineBoxBaselineY` 以 `Math.round(trunc64(y) + offset)` 计算，结果为整数 world px；`canvas/browser-paint-box.mjs` 中 `browserPaintBoxes` 把旋转 leaf 吸附成整数 world box。

运行时实测数值：

| 节点 | 字体 / 原始几何 | 输入 | 输出 |
| --- | --- | --- | --- |
| prompt-glyph | Menlo 13px | fontBoundingBox ascent 12，descent 3 | alphabeticOffset 12，GPU 基线 world 59（node.y 46.5） |
| button-label | Arial 600 14px | ascent 13，descent 3 | offset 14，基线 60（node.y 46） |
| chevron-upper | 50.6 / 49.42 / 9.6×1.12，45° | — | paint box 51 / 49 / 10×1，pivot (55.797, 49.555) |
| prompt-glyph-stroke-a | 104.42 / 50.49 / 7.8×1.19 | — | 104 / 50 / 8×1，pivot (107.898, 50.594) |

这些数值都与 148 的结果吻合，与 130 不吻合。

我实际看过的 4 倍裁剪图：`prompt-text@200` 的 GPU 与 HTML（GPU 的 `>_` 低约 2 device px）、`chevron@200` 的 GPU 与 HTML（GPU 的两臂在顶点处相接、整体偏右上，HTML 的两臂之间有可见间隙）。其余裁剪图都在证据目录中，没有逐张看过。

## 四、为什么本轮不改 production

最小修复的前提是先确定目标引擎。现状是：GPU 与 148 完全一致，与 Host 的 130 不一致；而 Host 内的 browser 渲染器和 HTML 导出都跑在 130 上。

如果机械地把取整改成 130 的规则，148 那边（headless 测试和 R009 的 77×4 结果）就会出现同样幅度的反向回归，正是要避免的“一边修好、一边改坏”。130 的规则依赖 device 坐标（zoom×DPR），所以修改会同时涉及文字基线、paint box、旋转 leaf raster 这三条路径，并且 cache key 和重新采样都要随相机变化。这超出了“≤2 类最小修复”的范围。

建议由主代理决定：

- 方案 A：以 Host 的 Electron 版本为准，在运行时探测引擎的吸附行为后选用规则；130 和 148 两边都要有回归测试。
- 方案 B：把 Host 的 Electron/Chromium 升级到与 148 吸附行为一致的版本。

在做出决定之前，这些差异作为已定位、未修复的残余保留。

## 五、仍存在的缺口

- **DOM 运行时探针取值为 null。** `#browser-surface [data-codeshell-id=…]` 在 guest 中没有匹配到任何节点，所以本轮没有直接拿到 Chromium 130 的 DOM 文字矩形；版本结论依据的是像素比较加 148 交叉验证。下一步要先查清 browser 渲染器的 DOM 结构（是否在 shadow root 或 iframe 中）。
- `finite-text@200` 的锚点用了 frame 中心而不是区域中心，导致宽区域被裁切；判定原因的措辞也不准确。
- 按钮文字（Arial 600）在 GPU 中的 ink 比 148 和 130 都低约 4%，原因未查。
- renderer stats 没有出口，性能仍判 UNVERIFIED；性能数据只有真实的 rAF 和 CPU 指标，没有预算可以作为判定依据。
- DPR1 没有实测；Design Studio 的大型离线套件和 `npm run check` 都没有运行（本轮没有改 production）。
- 视觉对比仍然只算证据，需要独立 review；`goalComplete` 恒为 false。

## 六、证据目录（仓库外，0600）

- `/tmp/ds-host-harness-tmp/run4/run4-analysis-nsdD2U/`：包含按 sha 核验后解包的原图、4 倍样本裁剪、`measurements.json`、`runtime.json`。
- `/tmp/ds-host-harness-tmp/run4/headless148-wlQioj/`：包含 148 下的参照截图和 `compare.json`。
- `/tmp/ds-host-harness-tmp/run4/headless148-strips-3LsTY6/`：包含 148 下的 SVG fixture 截图和 `strips.json`。
- 脚本（只读，不在仓库中）：`/tmp/ds-host-harness-tmp/tools/analyze-run4.mjs`、`headless148-compare.mjs`、`headless148-strips.mjs`。

## 更正（2026-11-07，见 `design-studio-snap-grid-probe-20261107.md`）

上文把差异归因为“Chromium 版本差异”，这是错误的。当时用来对照的 headless 148 用的是 Playwright 仿真 DSF。同一个 Chromium 148 改用强制真实 DSF2 之后，结果与 Electron 130 在真实 DPR2 下一致：finite、Menlo、Arial、小矩形、细条的质心差都 ≤0.07 device px。因此根因是 **DSF 模式（仿真 vs 真实）**；GPU 之前与之匹配的，是仿真 DSF 的行为。
