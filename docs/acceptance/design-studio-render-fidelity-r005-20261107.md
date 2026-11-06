# Design Studio 渲染保真 R005（2026-11-07）

**状态：BLOCKED checkpoint。受限 flex 重放与摄像机小测已绿，finite-offset 的 DPR2 严格几何及真实形状残差仍红。最终独立断言 exit 1，不代表整体像素一致。**

分支 `codex/design-studio/render-fidelity-r005-20261107`，基线
`437d13796ff564e9c98d982d6501281484847563`，已包含前四轮。原始证据根目录为
`/Users/admin/.codex/worktrees/panels-design-render-fidelity-r005/.tmp/render-fidelity-r005/`。
下文的相对证据路径均相对于该目录；`.tmp` 不提交。

## 边界与保全

本轮只修改当前 worktree 的 Design Studio、必要测试与本文档。独立
`npm ci --cache .tmp/npm-cache` 的输出保存在 `npm-ci.log`；依赖未使用其他 worktree 的
symlink。未改用户稿、Host、其他 Panel、安装包或 lock；未 push、PR、merge main、发布、
安装或使用凭证、用户 tab、外部写入。私有 Chromium 上下文只服务本地 fixture 与 GPU 测试。

真实六页只读源为
`/Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json`，
SHA-256 `91d877f8dbb28dce4c698b850c0db7455be2471c9d052f5cdf138c35f47dfc24`。
lock SHA-256 为 `8a2b2e40ace2c66133f1b30cae29ff7fe9d535814ded523ec90d43093ba7b7ea`。
R004 `.tmp/render-fidelity-r004/` 的原数据与撤回 patch 保持只读；未重拍旧的大 baseline。
最终采集入口记录采集前后源文件清单、原稿与 lock 校验、每条命令的 env/UTC/exit/log SHA；
入口使用 create-only 收据防止意外重复执行。

首轮功能 suite 在生成的 Figma adapter stale 检查失败（1214 tests、1212 pass、1 fail、
1 skip，后续批未执行），保留 `design-suite-final.log`。按仓库脚本
`node scripts/build-design-studio-figma-plugin.mjs` 同步当前任务内 `app/figma-plugin/ui.html`
的生成 adapter，focused `figma-plugin-v3.test.mjs` 为 9/9。没有改生成器、安装或发行包。
该文件在视觉采集期间变化，原始 `captureSourcePreserved=false` 不改写；
`capture-source-delta-audit.json` 独立核对仅生成槽变化、其他 renderer/source/test 不变与
生成器 `--check`，不能把该例外描述为整份 source manifest 相同。

## 摄像机：共享一次可信 wheel，保持精确 float32 guard

旧七个 browser 缺图的 GPU/browser transform 确实不是相同 float32。例如旧
`ios-chat-11` 的 panX 为 `13.750000953674316` / `13.75`，bits 分别为
`0x415c0001` / `0x415c0000`。本轮没有增加 epsilon，也没有绕过
`Math.fround(a) === Math.fround(b)`。

`render-fidelity-ui` 每个 page/matrix 只发送一次 trusted wheel，在同一 editor load 内
切换 GPU/browser 完成截图；后续 tile 和 paint-only isolation 重用实际测得的摄像机位移。
小 fixture 的新断言先在旧路径红：观察到 6 次 wheel、要求 1 次；修后 1 次，raw 与
isolation 两个 route pair 的 float32 camera 均完全相同。不是靠视觉容差接受不同位值。

R004 七个缺图节点的定向复测涉及四页、11 个 raw/isolation capture：每页恰 1 次 wheel，
11 个 GPU/browser camera pair 全等，route error 与 unavailable 均 0。该组仍有 4 个视觉
gate fail，不能把摄像机修复称为 28 个 route 行的全面视觉通过。逐条旧 bits、新 camera、
输入次数与原始结果见 `camera/summary.json`，PNG/metrics 在 `camera/{red,green,r004-seven-green}/`。

## F1：逐项 LayoutUnit 重放，四边 snap

`canvas/browser-paint-box.mjs` 在呈现层以整数 LayoutUnit 重放受限 flex，然后统一四边 snap。
固定长度、padding、gap 每项先 `trunc(v*64)`；center 对剩余整数 LayoutUnit 除 2 后再次
截断。`layout.mjs` 与保存坐标、baseline offset、format 均未修改；hit-test、overlay 和缓存
仍沿用既有文档坐标。clip、stroke、fill 继续使用同一呈现 box。

本轮先核对旧 flow spike 的保存值与 36 个 DOM bbox，再加入 Node 单元证明。以
`horizontal-start` 为例：frame x=`20.34375`；hug x=`23.5`、width=`36.671875`、
height=`17.078125`；icon x=`48.984375`、y=`27.109375`；thin x=`53.328125`、
y=`28.25`、width=`1.15625`、height=`7.359375`；fill x=`64.390625`、
stretch height=`129.53125`。它们与原 DOM 逐项相同，不能用保存的 float 累加替代。
`flow36-replay.json` 的 36 行 delta 全为 0。

hug 文字宽度另用 loaded Arial 的小数宽度复核：保存 `37.5781`，DOM `37.578125`，
`ceil64(savedWidth)=37.578125`，canvas 原宽 `37.57261657714844`。
证据 `camera/flex-review-probe.json` 保留父 computed padding/gap/align/justify、DOM、兄弟
saved/DOM 与 raw remaining LayoutUnits；没有猜测新的 floor。

六个 row/column × start/center/end frame，含嵌套 hug text/icon、细条及 cross-axis fill，
在三个主矩阵及额外 DPR2/z2 的结果如下。每个矩阵 12 个 thin/fill shape 行；48 行全部为
raw pixel pass，未借 AA qualified 消除 geometry failure。

| 矩阵 | shape 行 | geometry fail | raw pass | replay/DOM 最大差 |
| --- | ---: | ---: | ---: | ---: |
| DPR1 / z1 | 12 | 0 | 12 | 0 CSS px |
| DPR2 / z1 | 12 | 0 | 12 | 0 CSS px |
| DPR1 / z2 | 12 | 0 | 12 | 0 CSS px |
| DPR2 / z2 | 12 | 0 | 12 | 0 CSS px |

原旧规则的 red 保存在 `box-unit-red.log`；最终 Node 单元 8/8、四个 GPU UI case 4/4，
合跑 12/12，命令为
`node --test tests/apps/design-studio/browser-paint-box.test.mjs tests/apps/design-studio/flex-paint-box-ui.test.mjs`，
日志 `box-unit-final.log`、`flow-final-green.log`。每个矩阵的完整 layout、raw
pixel、geometry、renderer stats 与 PNG 保存在 `flow-box/<matrix>/`。重放不改变 fixture
保存值的断言也通过。

只读冻结 DOM 审计覆盖六页 730 个无旋转 bbox：supported replay 730/730，最大 delta 0，
该分母的 `fallbackByReason={}`。这包含纯布局计算成功的 text bbox，不等于所有节点都走
shape paint snap。六页 807 个输入节点的 paint eligibility 统计如下：

| 页 | 输入 | eligible paint box | changed | paint fallback |
| --- | ---: | ---: | ---: | --- |
| web-chat | 199 | 115 | 38 | rotated 26；unsupported-type 58 |
| ios-chat | 104 | 62 | 13 | rotated 14；unsupported-type 28 |
| android-chat | 105 | 63 | 13 | rotated 14；unsupported-type 28 |
| web-panels | 202 | 124 | 39 | rotated 17；unsupported-type 61 |
| ios-panels | 97 | 66 | 12 | rotated 3；unsupported-type 28 |
| android-panels | 100 | 68 | 12 | rotated 3；unsupported-type 29 |
| 合计 | 807 | 498 | 127 | rotated 77；unsupported-type 232 |

这些 fallback 保留原路径，不计为视觉通过。730 bbox 的逐项 saved/replay/DOM 与上述 paint
stats 见 `frozen-layout-audit.json`；重放命令 `node .tmp/render-fidelity-r005/audit-layout.mjs`。

支持范围限 horizontal/vertical、fixed/hug、padding/gap、start/center/end、父 cross-axis
stretch 与 cross-axis fill=content dimension。`layoutAlignSelf` 的显式覆盖在小实验中发现
DOM 语义不一致，保留 `self-alignment-unverified`：3 个反例均 fallback，其余 7 个 supported
box 与 DOM 全等，见 `camera/flex-review-fallback-green.json`。

安全拒绝原因仍显式保留：`main-axis-flex-grow`、`dynamic-size`、`wrap`、`grid`、
`justify-content`（含 space-between）、`rotated`、`reverse`、`negative-gap`、
`cross-alignment`、`self-alignment-unverified`、`intrinsic-image`、约束、size-limits、
layout-margin、inside-border/stroke-sides、instance/referenced-component、无效或循环父子关系。
祖先/子尺寸/兄弟尺寸拒绝会带原原因传播。负小数 world phase 仍为
`negative-world-phase-unverified`。replay 与 saved 任一项差 >0.25 CSS px 时返回
`LAYOUT_MISMATCH`；0.25 是重放安全护栏，没有放宽视觉阈值。

## finite-offset：HTML 原点大差修正，DPR2 严格残差仍阻塞

`frontend-export.mjs` 对无 `layoutBaselineSource` 的有限 offset 文字，仅在浏览器 loaded-font
测量上下文中运输 hanging origin 到 CSS line box：

```text
d = (node.y + hangingToAlphabetic) - textLineBoxAlphabeticOffset - Tcss
absolute: Tcss = node.y，修 rendered top
flow:     Tcss = node.y - layoutBaselineOffset，设置 relative top:d
```

不改文档或 GPU/SVG 的 finite-origin 语义。Node 无测量上下文保持 diagnostic。范围限默认或
start 的 absolute、horizontal/vertical flow；显式 top/bottom 约束、其他 vertical constraint、
rotation、改变 typography 的 ranges 及已有 HTML/native source 不套用该修正。

旧 absolute/flow × DPR1/2 的 12 行全部严格红；Arial 在 DPR1 的质心原差 9 / 13 device px。
修后 3 finite × absolute/vertical/horizontal × DPR1/2 共 18 行公式全部匹配；DPR1 9/9
严格几何通过，DPR2 仍有 6 行 Arial 的 HTML/SVG 质心差约 −1 device px，未改 .75 阈值。
24 个 markup 负控证明已 verified HTML/native 与未验证范围保留原 CSS 语义。相关五文件
功能小测 21/21 通过，视觉结果独立记为 false，见 `finite/summary.json` 与
`finite/functional/metrics.json`。功能绿不能替代严格视觉红。

另用实际 editor 对三个原 finite 节点 × DPR1/2 × 四 routes 采集 24 行，route error 与
unavailable 均 0，但五个严格 geometry failure 如下；完整原始 delta、pixel ratio/cluster
保存在 `finite/gpu/strict-geometry.json`。

| DPR2 / z1 节点 | route | centroidY 差（device px） | 现行判定 |
| --- | --- | ---: | --- |
| finite-offset | GPU | +1.1810091616381442 | >0.75，fail |
| finite-offset-negative | GPU | +1.1735465933220937 | >0.75，fail |
| finite-offset-native | GPU | +0.7760005902200078 | >0.75，fail |
| finite-offset | SVG | +1.0000000000000213 | >0.75，fail |
| finite-offset-negative | SVG | +1 | >0.75，fail |

独立红断言命令 `node .tmp/render-fidelity-r005/finite/assert-strict-geometry.mjs` 实跑 exit 1，
保留 `finite/gpu/strict-geometry-assertion.log`。因此尚未达到用户要求的 synthetic 3 finite ×
DPR1/2 严格几何全绿。没有通过 snap 或改阈值
掩盖残差。旧 GPU/SVG 12 golden 的逐 byte/String 比较另由最终 `finite12-comparison.json`
裁定，保留 golden 也不能证明 corrected HTML 已严格通过。

## 手势 1.1×：Linear 改善运动旧 bitmap，静止 golden 不变

只将 `canvaskit-text.mjs` 的 device image filter 改为 Linear，沿用 R004 的 gesture/settle
生命周期与缓存预算。DPR2 的普通/master/translated instance 三处文字做一次 1.1× interactive
zoom，先以私有拦截候选核对，再对实际生产源码重跑；最终 `intercepted=0`。

| 手势 frame 与 fresh static 的比较 | 旧 Nearest | 生产 Linear |
| --- | ---: | ---: |
| mean absolute channel error | 0.3897464583333333 | 0.340848125 |
| maximum channel delta | 240 | 193 |
| different channels / 4,800,000 | 31,184 | 53,041 |
| 手势 sampling builds / raster misses 增量 | 0 / 0 | 0 / 0 |

Linear 会把覆盖分散到更多 AA 通道；表中的 different-channel 数没有改称 raw pass。
210ms settle 后两方案均与各自 fresh Retina render 逐 byte 一致，且跨旧/新方案的 settled
SHA-256 同为 `da191ebf7b03a58acde69549be8eb35972d62ede02fad1050767f12efc9e0bb8`。
实际生产手势图也与已审查 Linear candidate 逐 byte 一致，七条离线断言全部成立。

证据为 `gesture/{preproduction-nearest-vs-private-linear,summary,final-assertion}.json` 与
`gesture/*zoom1.1*.png`。重放命令：
`node .tmp/render-fidelity-r005/gesture-check.mjs`，
`node .tmp/render-fidelity-r005/assert-gesture.mjs`。
两次临时 harness 的初始失误（误要求 sampling counter 必加 1；读取已呈现清空的 canvas
buffer）保存在 `gesture/initial-*.json`，最终改为验证现有至多一次 settle 并在 redraw 后取
PNG。没有以这些 harness 失误证明产品红。

实际已打开旧 Nearest、Linear gesture 与 settled 图，旧图笔画边缘有可见阶梯，Linear 较平滑。
这是一组 1.1× 旧 bitmap 复用截图与 settle golden 的有界结论；没有重做旧 720-frame/80-wheel
性能序列，也不将同步 CPU timing 称为 FPS 或物理 GPU completion。

## 最终唯一采集与断言

阈值沿用原值：真实文字要求 3,712 行、0 fail、0 unavailable；GPU/browser shape 的
stroke centroid/width ≤0.35、edge ≤0.5 device px。shape 必须先 geometry pass，再接受
raw pixel pass，或 device [1,2,1]/4 AA 的 0.1% / cluster 6 qualified；原 raw 指标完整保留。
`OWN_FILL_UNOBSERVABLE` 仅在既有 exact same-fill 机械条件成立时排除有效分母、逐项列出，
不计 pass。SVG 保持 strict，或独立满足预测 snap 解释 ≤0.1 device px；route error 要求 0。
rotated thin / 1px radius seam 只能逐项登记并检验 ≤1 device px，不增加其他豁免。

最终入口 `node .tmp/render-fidelity-r005/run-final-capture.mjs` 仅执行一次，依次执行：
synthetic 与真实六页的 strict4 + fit diagnostic、仅三 finite 的 half golden、指定七文字的
fit isolation。strict4 为 DPR1/z1、DPR2/z1、DPR1/z2、DPR2/z1/fractional-pan；没有重拍
huge baseline。MODE=diagnostic 的 exit 0 只表示采集成功，最终按收据独立裁决。

```sh
node --max-old-space-size=8192 .tmp/render-fidelity-r005/summarize-final.mjs final-synthetic
node --max-old-space-size=8192 .tmp/render-fidelity-r005/summarize-final.mjs final-real
node .tmp/render-fidelity-r005/summarize-fit.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r005/compare-finite12.mjs
node .tmp/render-fidelity-r005/audit-capture-source-delta.mjs
node .tmp/render-fidelity-r005/assert-final.mjs
```

四个 capture 子命令均 exit 0：synthetic 253.424s、真实六页 3008.494s、finite half
9.663s、fit isolation 24.860s。runner 最终 exit 1 是因为清单检测到生成 adapter 的变化；
原始 `captureSourcePreserved=false` 保留。独立 source-delta audit 13/13 通过，严格确认唯一
变化是 `app/figma-plugin/ui.html` 的生成槽，生成器与其他 renderer/source/test 均不变，
原稿与 lock SHA 不变。不是重拍或改写采集收据。

`node .tmp/render-fidelity-r005/assert-final.mjs` 实跑 exit 1，最终状态 **BLOCKED**。
五个失败条件为 synthetic effective gate、synthetic primary availability、synthetic text
geometry/gate、real effective gate、finite HTML 独立严格几何。coverage、真实文字、两组
route errors、fit isolation、finite12 与生成差异独立审计均通过。
`strict-visual-final-assertion.json` 与 `.log` 保留完整断言，diagnostic 采集成功不等于视觉通过。

真实 strict4 为 10,176 unique/full 行，partial/duplicate/missing/unmeasured/font omission 均 0；
原始 `report.json` 与保守旋转复核后的 `strict-audited-report.json` 分别保留。有效分母 9,872，
仅 exact own-fill 的 304 行排除且不计 pass；其完整 key/颜色/机械条件列表在
`final-real/summary.json#/ownFillExcludedList`（五矩阵 380、strict4 304），没有新增豁免。

| route | 行 / 有效分母 | own-fill 非 pass | 含排除 gate fail / 有效 gate fail | geometry fail / 有效 | raw pixel fail / 有效 | AA-qualified，非 raw pass | unavailable / 有效 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GPU | 2544 / 2468 | 76 | 411 / 335 | 372 / 296 | 467 / 449 | 127 | 76 / 0 |
| browser | 2544 / 2468 | 76 | 76 / 0 | 76 / 0 | 0 / 0 | 0 | 76 / 0 |
| SVG | 2544 / 2468 | 76 | 840 / 764 | 813 / 737 | 856 / 816 | 70 | 76 / 0 |
| HTML | 2544 / 2468 | 76 | 76 / 0 | 76 / 0 | 0 / 0 | 0 | 76 / 0 |
| 合计 | 10176 / 9872 | 304 | 1403 / 1099 | 1337 / 1033 | 1323 / 1265 | 197 | 304 / 0 |

832 个 frame ring 行的 ring pixel fail 为 0；原 composite pixel fail 233（GPU96/SVG137）
仍完整保留。58 个 SVG ≤0.1px predicted-snap diagnostic 将有效 gate fail 从 1157 到 1099，
它们没有改称 raw pass。AA-qualified 197 同样不是 raw pass。

真实文字 3,712 行的 gate/geometry/unavailable/route error 均为 0。仍有一条 SVG raw pixel
诊断：`android-panels-96`、DPR1/z2，mismatch30/20720、cluster11、geometry failure为空；
沿用 SVG text pixel diagnostic 语义，不能声称所有文字 raw 像素相同。六个 fractional-pan
page/matrix 各恰一次 trusted wheel，其余24 page/matrix为0；所有 route error为0。

synthetic strict4 为 752 full 行、42 gate fail（GPU18/SVG24）、20 geometry fail、49 raw
pixel fail、1 AA-qualified、16 unavailable，route error/partial/missing/font omission均0。
16项 unavailable全为shadow contour匹配不足；464 text行仍7 gate fail、3 geometry fail、
17 raw pixel fail，已有 ranges/stroked native问题未修。finite另有48 diagnostic行，本轮独立
24行严格复核仍5 fail，没有让旧 diagnostic 字段绕过本轮 finite 验收。

真实 fit 仍是诊断：2544行、有效2468，geometry fail333（有效257）、raw pixel fail380
（有效363）、AA-qualified64、有效 unavailable91、diagnostic failure443；928 text行
geometry fail10、raw pixel fail51、unavailable0。不能把整页fit冒称通过。指定七文字的本轮
fresh isolation为28/28，geometry/raw pixel/diagnostic failure/unavailable/route error均0；
最大device phase残差1.1368683772161603e-13，最大DOM布局变化0.000034241106107 CSS px。
证据 `fit-isolated-summary.json`；旧R004结果未借作本轮pass。

| 最终项目 | 结果 | 精确数量 / 证据 |
| --- | --- | --- |
| 真实 strict4 / 3,712 文字 | gate/geometry 0 fail、0 unavailable；shape有效 gate fail1099 | `final-real/summary.json` |
| synthetic strict4 | 752 full 行；42 gate fail、16 unavailable、0 route error | `final-synthetic/summary.json` |
| fit 指定七文字 / 28 routes | fresh 28/28，通过独立几何/像素断言 | `fit-isolated-summary.json`；不得借旧 R004 pass |
| finite GPU/SVG 12 golden | 12/12 GPU raw crop SHA 与精确 SVG string 不变 | `finite12-comparison.json` |
| `npm test -- --suite design-studio` | exit 0；1463 tests、1458 pass、0 fail、5 skip | `design-suite-green.log`；488.503s |
| `npm run check` | exit 0；4061 tests、4052 pass、0 fail、9 skip | `check-green.log`；703.188s |
| `npm run validate` | exit 0 | `validate-green.log`；3.338s |

已实际打开 `final-real/dpr1-zoom2-web-chat-0/{gpu,html}.png`，侧栏加号、monitor 与 Skills 细条目视对齐。
该 full tile 的 `web-chat-114/115`（加号）、`105/106/107`（monitor）、`137/138/139`
（Skills）GPU geometry failure 均为空、raw mismatch ratio 均为 0。旋转 chevron 仍可见细微差异：
同 tile 的 `web-chat-110/111` 尚有约 0.9224 / 1.0549 device px 的 centroid 差与角度 failure；
这些是 full tile 观察，最终按 isolation/保守审计记录裁决，不豁免 >1 的项。
已实际打开 `final-real/dpr2-zoom1-fractionalpan-web-chat-0/{gpu,browser}-editor-gui.png`：
正文清楚，普通 workbench/chrome 保留，侧栏加号、monitor 和 Skills 目视接近，旋转细节仍待 CC。
两份 metadata 的 view 精确一致：DPR2、zoom1、pan40.75/44、stage1069×919；同一 trusted DOM
wheel deltaX=3.25（CDP6.5）、isTrusted=true，只发一次、截图前未校正。fake Host 的 Agent
提示仍可见，这不是 Host persistence 验收。
已实际打开 `final-real/dpr1-fit-view-web-chat-{gpu,browser}-actual-fit-gui.png`：正常 workbench
显示66%，实际zoom0.65625、pan62/131.375、stage1069×919；正文清楚，GPU/browser目视相近，
完整侧栏/chrome保留。没有用裁切或拼图代替实际GUI，也不据目视接近把fit诊断改判通过。已有 finite 小测
实看记录见 `finite/summary.json.visualReview`：大位移明显收敛，但 Arial 的约 1 device px
残差继续严格红，不因目视接近改判。

## 剩余问题与交付

本轮有证据支持 F1 受限 subset 的修复和一次 camera challenge 共享；finite HTML 的原点大差
收敛，但 DPR2 的严格残差是明确阻塞。rotated 77/chevron、odd-width radius seam、ellipse
AA、plain ranges / stroked text native、image fit、Node SVG 无测量上下文的 central fallback
仍不能称已全修。730 个冻结 bbox 全等、功能 suite 全绿或 finite12 不变，都不能外推为整个
产品全像素一致。

完整剩余项索引为 `final-real/residual-index.json` / `residual-index-summary.json`，含全部
原 raw/qualified/geometry failures、route PNG path 与缺失检查。严格 keys 10,176 项无重复、
无缺失、无额外项。包括 own-fill 与 diagnostic 的未通过登记1462行，有效未通过登记1158行；
它包含59个 diagnostic failure/解释项，口径比有效 gate fail1099更严格，不混称同一数字。

77个旋转源节点登记1232个route/matrix行：严格通过650、未通过582；bbox+ink centroid+
rotation centroid均≤1device px的1032行，超过1的200行。101个1px stroke圆角源节点登记
1616行：严格通过1445、未通过171；bbox/ink centroid与contour centroid/width联合≤1的1514行，
超过1的102行。全部可测，无缺失；≤1仅登记，角度仍单列原0.5°条件，没有把它用作自动豁免。
最初仅contour注册的派生版另保留为`residual-index-contour-only*`，最终以联合条件索引为准。

GPU有效335项残留的精确分组：296旋转项全部有geometry failure；7项1px圆角stroke仅pixel
失败；32项`visible-composite-fill-with-descendant-occlusion` frame仅pixel失败。所有已测
非旋转GPU项的有效geometry failure为0，但这些39项pixel失败仍留在门禁。
逐项见`final-real/gpu-residual-groups.json`，没有把composite失败改为own-fill排除。

待CC：复看上述z2加号/Skills/monitor改善与旋转chevron；核DPR2 fractional-pan共享camera和
正常fit GUI；裁定无source finite修正后仍红的DPR2 paint相位；复核77旋转/1px圆角索引中
超过1device px的项及32个frame composite像素残留。既有native ranges、ellipse AA、image
fit、Node SVG fallback继续登记，不宣称本轮修复。

交付仅包含12个任务文件的本地checkpoint commit（源码、必要tests、生成adapter与本文档）；
提交SHA和完整diffstat见最终回复及本地`delivery-receipt.json`，避免文档自引用提交SHA。
`.tmp`不提交。最终功能收据为`validation-green-receipt.json`；最终视觉收据仍为BLOCKED。
