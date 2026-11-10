# Design Studio SVG 精确矢量语义审计（2026-11-07）

**状态：SVG 语义验证未全部通过。235 行中 231 PASS、4 FAIL，没有不可观测、数据缺失、采样污染或不支持的行。** 156 行 stroke（41 个 source node）全部通过，4,992 个 probe 全部通过；79 行 fill（32 个 source node）中 75 PASS、4 FAIL。4 个 FAIL 都是 DPR1/z1 下小于 2 device px 宽的方角细条 fill，导出的 SVG 几何与作者一致。在与原采集一致的页面条件下重渲（只省略了 font-face CSS），4 行的 PNG 逐字节复现；不含 Design Studio 代码的手写 `<rect>` 也能复现同样的覆盖偏差（web-chat-107 差约 0.0022 px²，实际 0.00218237）；同一页面改用 `--disable-gpu` 参数后，这 4 行全部 PASS。**证据强烈支持：主要原因是该采集配置下 Chromium 栅格化的角像素 AA，而不是 SVG 导出几何。** 但本轮没有取到实际的栅格后端（chrome://gpu 不可访问，参数本身不能证明后端），也没有确定精确的实现，所以不声称“确定是 GPU 或 CPU”。**没有修改任何 production 文件。** 返修补了真实修改 SVG markup 的负控（10 个浏览器栅格，在一致的采集条件下全部按预期拒绝或通过）。旧规则的结果（0/235）照原样保留，没有改成 pass。真实 Host 隔离验收仍未获许可，**不宣告 Goal complete**。

分支 `codex/design-studio/render-fidelity-svg-audit-20261107`，base `34f77a958be78e87d557a8e2d4455079d05b4f26`。已读 CODESHELL.md 与 CONTRIBUTING.md（npm）。本轮只新增 tests/docs，并在 `tests/suites.mjs` 的 Design Studio 套件里登记一行。没有改 Host、其他 Panel、lock、安装包、用户稿或协调账本；没有 push、merge、PR、发布或安装；没有启动 Electron、构建 Host 或打开任何窗口。只用了一个专属 headless Chromium 做下文的独立复现：离线运行，只允许 `data:` 请求，不碰用户 tab。依赖用 `npm ci --cache .tmp/npm-cache --prefer-offline` 安装，exit 0，node_modules 不是 symlink。全部证据放在本 cwd 的 `.tmp/svg-audit/final/`，不提交。

## 获批产品合同与旧规则的差异

主代理批准的合同：

- SVG 保留作者给出的精确矢量几何。验收时直接和原设计的解析轮廓比较，HTML 不再是唯一基准。
- stroke：每个 probe 的 coverage centroid 和 coverage integral width，误差都要 ≤ **0.35 device px**。
- fill：coverage centroid（二维欧氏距离）、integral width、integral height，误差都要 ≤ **0.5 device px**。
- SVG−HTML 原始差异只作描述性报告，全部保留，不当门禁，也不隐藏。旧门禁结果不得改成 pass。
- “声明了精确语义”不能代替验证：只要实际栅格化后的 SVG 偏离作者几何，就记为 FAIL。

旧规则 `|SVG−HTML| ≤ snap bound + 0.1 devicepx 且总量 ≤ 0.5 CSS px` 本身数学上自相矛盾：snap bound 可以接近 0.5 CSS px，再加上 AA 必然超出总上限；HTML 用双 box-shadow 合成的曲线 AA seam 又会让 width 系统性偏细约 0.25 device px。新合同不再用 HTML 当参照物，直接拿 SVG 和作者几何比。旧规则的 R009 结果 `boundedRows 0/235`（`/Users/admin/.codex/worktrees/panels-design-render-fidelity-r009/.tmp/render-fidelity-r009/svg/summary.json`，SHA-256 `916ce0a5dc98d0dc9170be78460e241e5afd01139c7cde036b0fb3a9a41a29b2`）没有改动，也没有被重新解释成 pass；新 receipt 里的 `oldRuleRetained` 原样引用了它。

## 方法

### 独立的解析 oracle

新文件 `tests/apps/design-studio/svg-semantic-metrics.mjs` 不 import 任何模块，单元测试会静态检查这一点。它只根据作者字段生成 device 坐标下的精确面积覆盖（exact-area box-filter coverage）：

- 形状：轴对齐、统一圆角的矩形。centered stroke 的内外轮廓用精确平行偏移：r>0 时外半径为 r+d；r=0 时按 SVG 的 miter 规则保留尖角；内偏移超过半径时变成尖角。祖先 `clipContent` 矩形一并求交。
- 积分：每个像素行在各矩形的上下边、圆弧起止处切开。直线段在 x 方向用区间重叠、在 y 方向用段高，精确积分；圆弧段在 y 方向取 64 个中点子行，x 方向仍然精确。单测验证：矩形面积误差 <2e-3，圆角面积 wh−(4−π)r²，环面积等于中心周长×线宽。
- 不支持的语义直接返回 `UNSUPPORTED_GEOMETRY`，不会拿相近的形状凑数：旋转、椭圆、per-corner radii、inside/outside stroke、opacity<1、阴影或 paint stack、自带 fill 的描边、渐变背景。235 行里一条都没有遇到。

oracle 不调用 `exportDesignSvg`、frontend-export、browser paint boxes 或任何 renderer。作者的绝对几何来自文档模型 `normalizeDesignDocument`：原始 backup 是嵌套树，需要先展平并解析布局；而这一步正是所有 renderer 共同的输入，不属于被测的 SVG 绘制路径。每行都断言这份几何与 R008 采集时记录的 `row.geometry` 完全相等。

### 测量算子

- RGBA → coverage：在 sRGB 前景/背景混合直线上做最小二乘投影。source-over 合成对 coverage 是线性的，所以这一投影成立。离开这条直线超过 8 个 8-bit 单位的像素算外来颜色，即“采样污染”，不计入 pass，也不计入 fail。本轮 SVG 像素的最大残差是 0.65。
- stroke：在作者中心轮廓上按等弧长取 32 个点，沿外法线做 bilinear 采样，步长 1/16，用梯形积分。width = ∫α ds，centroid = ∫sα ds / width。向内积分到 medial depth，即满足 sdf(p−tn) = −t 的最大 t；向外积分到 w/2+3 px。
- fill：mass、面积 centroid，以及最大的整行和整列 coverage 积分。只有当 fill 的竖向范围包含至少一整行像素时，最大整行积分才直接等于 integral width；integral height 同理看整列。如果只有一个方向能直接测，另一个方向取 mass/直接值。两个方向都不能直接测时，box filter 只能确定 w·h，w 和 h 无法分开识别，这种情况记为 UNOBSERVABLE。本轮的分布是：63 行两个方向都能直接测，8 行只有 height 能直接测，8 行只有 width 能直接测，0 行两个都不能测。

### 门禁怎样处理 blur 和曲线（数学说明）

门禁量 = measure(SVG 栅格) − measure(作者几何的精确面积栅格)，两边用同一个算子。

**适用范围需要收窄。** 只有 coverage 积分（stroke width、fill mass、整行或整列积分）对 coverage 是线性的。centroid 是两个线性量的比值；fill 的 integral 尺寸取 max 后，在单向可测时还要除以 mass，两者都不是线性的；oracle 的圆弧部分又是 64 子行的数值积分，本身有离散误差。因此下面说的“两边相同、差值抵消”，只对线性的积分量严格成立，对 centroid 和 integral 尺寸只是近似。另外，门禁只看 probe 的 centroid/width 和 fill 的 centroid/W/H，**并不验证完整轮廓**。Codex 给出的反例：作者是 20×20、r=5 的 fill，实际渲染成 r=0。本轮复算，面积多出约 21.46 px²（本次相位为 21.457），但三个门禁量都 PASS（`final-r2/counterexample.log`）。这是现有合同的覆盖边界，本轮按要求没有为了它新增指标或改动阈值。

- **blur**：对于直边，任何对称、归一化的模糊核卷积都会保留沿法线的覆盖积分（零阶矩）和质心（一阶矩），前提是积分窗口完整覆盖模糊支撑。box filter 加 bilinear 重建相当于先后做 box 卷积和 tent 卷积，所以 AA 带来的模糊不会让 width 或 centroid 产生偏差。单测用 [1,2,1]⊗[1,2,1]/16 模糊验证，直边上的误差约为 0；只有在角附近，窗口会被 medial axis 截断，误差 ≤0.08。
- **曲线**：在弧上，像素足印沿切向的方差约为 1/4 device px²，会让径向质心产生约 1/(8R) 的二阶偏差，R 是曲率半径。这个偏差只取决于几何和算子，与被测栅格无关，所以对线性积分量来说两边相同、在差值里抵消；对 centroid 这类比值量只是近似抵消。为了透明，算子自身的偏差单独报告：stroke 的 oracle centroid 与解析值 0 最多相差 0.219，width 与 sw 最多相差 0.147（device px，出现在小半径弧上）。如果不做 oracle 校正，直接拿 SVG 和解析值 0 / sw 比，stroke 最大误差是 centroid 0.206、width 0.218，也在 0.35 以内。fill 的“整行积分”在圆角处小于 w，最多小 0.351；所以 fill 门禁必须和 oracle 比，不能和名义 w 比。
- 单个 probe 的分辨率：直边约 ±0.01；在半径 ≤3 px 的紧弧上，真实的 ±0.5 线宽变化会被测成 0.43–0.62，因为两种几何下算子偏差不同。这仍然高于 0.35，负控仍然被拒绝。

### 状态分类

| 状态 | 含义 | 是否计入 pass |
| --- | --- | --- |
| `PASS` | 所有可观测字段都在合同内；stroke 至少 16/32 个 probe 通过，且没有 probe fail；该行的 coverage 合成扰动负控全部被拒绝 | 是 |
| `FAIL_SVG_GEOMETRY` | 有可观测字段超出合同 | 否 |
| `SAMPLE_CONTAMINATED` | 外来颜色导致可用 probe 不足 | 否 |
| `DATA_MISSING` | 测量窗口超出 capture，或 PNG 缺失 | 否 |
| `UNOBSERVABLE` | 前景色等于背景色、fill 被 clip 掉、w/h 无法分开识别，或某个负控没被拒绝 | 否 |
| `UNSUPPORTED_GEOMETRY` | 超出 oracle 的语义范围（见上） | 否 |

背景色来自最近一个有实色 fill 的祖先；如果没有，就用 canvas 背景。每行都检查这个祖先在扣掉自身描边之后，是否完整覆盖测量窗口（圆角也算在内）。235 行涉及 37 种 owner/背景组合，全部满足。透明 fill 或与背景同色的 fill 会单独列为 UNOBSERVABLE：本轮 0 行，所有行的前景色都与背景色不同。

## TDD：测量本身的测试

`tests/apps/design-studio/svg-semantic-metrics.test.mjs` 共 14 项，已登记进 `tests/suites.mjs` 的 design-studio 套件，结果 14/14 pass（`metrics-test.log`）。测试形状直接取自 235 行里的真实尺寸和小数相位：14.4×12.6 r1.8 环、5.4 圆环、DPR2 下 sw2 的环、4.8×1.12 细条、25.2×2.52 胶囊、7.2×2.7 r.9。

- 精确面积；弧上和平边上的 medial depth。
- 正控：作者栅格 → 8-bit RGBA → PASS，32/32 probe 通过，误差 <0.02；对称 AA 模糊仍然 PASS。
- **负控**：整体位移 1 device px（x、y、−y）必须拒绝；单边移动 1 px 必须拒绝；stroke 宽 ±0.5 必须拒绝（实测 0.43–0.62）；fill 宽 ±1、高 +1、平移 1 必须拒绝；0.25 位移必须仍然 PASS，证明门禁不是一律拒绝。
- coverage 合成扰动负控（不是独立的 SVG 输入）：对 coverage 做整像素平移；在 coverage 上叠加解析的 +0.5 线宽带、+1 宽/高带。
- 外来颜色记为 contaminated，不计入 pass，也不计入 fail；前景等于背景、前景色缺失、被 clip 掉、超出 capture、椭圆、旋转、inside stroke，都返回显式的非 pass 状态。
- 祖先 clip 是 oracle 的一部分：clip 掉一半的环如果按未 clip 的作者几何去测，必须 FAIL。

返修新增了 `tests/apps/design-studio/svg-semantic-audit.test.mjs`，也登记进了套件。它在内存里构造一个真实形状的行（android-chat-11 尺寸），SVG 完全没有墨迹，然后走完整的 `auditRow → summarizeAudit` 流程。修复前这个测试是红的：32 个 probe 都是 FAIL 之后，汇总阶段抛出 `TypeError: Cannot read properties of undefined (reading 'centroid')`（`final-r2/zero-red.log`）。修复后测试变绿，验证了以下几点：

- 该行仍然是 FAIL，32/32 probe 都是 FAIL；
- 缺失的 centroid 记为 null，被排除在汇总之外，而不是被当成 0；
- width 作为有限的失败字段，会进入最大误差统计；
- 汇总中 FAIL 和 PASS 的计数都正确。

修法是每个字段只在“存在且是有限数”的 probe 上分别汇总。

**红→绿证据**（`mutation-red.log`）：放宽 tolerance 到 2 px，6 项测试变红；把 stroke centroid 恒置 0，3 项变红；去掉 fill height 检查，1 项变红；去掉 stroke 污染检查，1 项变红。每次突变之后都恢复原文件，并用 `cmp` 确认逐字节相同。需要说明的是，metrics 模块的初稿写在测试之前；红灯是用上述突变证明的，不是先写失败测试再实现。

## 结果：235 行逐项

| Matrix | 行 | stroke 行 | fill 行 | PASS | FAIL | 不可观测/缺失/污染/不支持 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DPR1 z1 | 57 | 33 | 24 | 53 | 4 | 0 |
| DPR1 z2 | 60 | 41 | 19 | 60 | 0 | 0 |
| DPR2 z1 | 60 | 41 | 19 | 60 | 0 | 0 |
| DPR2 fractionalpan | 58 | 41 | 17 | 58 | 0 | 0 |
| 合计 | 235 | 156 | 79 | **231** | **4** | 0 |

- 有效分母（PASS + FAIL）为 235/235。73 个 source node 中有 69 个在所有出现的 matrix 下都通过；未全过的是 `web-chat-107`、`web-panels-110`、`web-chat-138`、`web-panels-141`。
- 旧规则统计到 4,982 个已匹配 probe 和 10 条不可用射线；新算子对 156 行 × 32 个法线全部测到，共 4,992 个，全部 PASS。新算子不再要求“最近的连续区段”，向内用 medial depth 截断，所以没有不可用射线。与旧数据里存的 SVG 自身 probe 值对比（同样 32 个等弧长点、同样的索引），差值最多为 centroid 0.054、width 0.029。两套实现的步长和分段方式不同，这个一致性只作描述。
- **coverage 合成扰动负控**：这一组的做法是对真实 SVG 的 coverage 做整像素平移，或叠加 `oracle(changed)−oracle(authored)`，属于合成扰动，不是独立的真实 SVG 输入；真实输入负控见下一节。结果：在 235 行实际 SVG coverage 上，x 平移 1 px 和 y 平移 1 px 各 235/235 被拒绝；156 行 stroke 的 +0.5 宽和单边 +1 各 156/156 被拒绝；79 行 fill 的宽 +1 和高 +1 各 79/79 被拒绝。没有任何一行因为负控失效而被降级。
- **最大误差**（device px，均为 SVG 减 oracle）：
  - stroke centroid 0.0777：`web-panels-13` DPR1/z2，fraction 0.75，`/Users/admin/.codex/worktrees/panels-design-render-fidelity-r007/.tmp/render-fidelity-r007/real-shard-2/dpr1-zoom2-web-panels-isolation-web-panels-13/svg.png`。
  - stroke width 0.1030：`android-panels-47` DPR1/z1，fraction 0.59375，`.../real-shard-3/dpr1-zoom1-android-panels-isolation-android-panels-47/svg.png`。
  - fill centroid 0.1203：`web-chat-127` DPR1/z1，`.../real-shard-1/dpr1-zoom1-web-chat-isolation-web-chat-127/svg.png`。
  - 通过行中的 fill width 最大 0.413（`web-chat-115` 和 `web-panels-118`，DPR1/z1，11.2×1.12 r0.56），height 最大 0.439（`web-chat-127` 和 `web-panels-130`，1.17×5.4）。这些行通过了，但余量很小，误差来源与下文 4 个 FAIL 相同。
  - 失败行：fill width 0.679（`web-chat-107` 和 `web-panels-110`），fill height 0.697（`web-chat-138` 和 `web-panels-141`）。

## 4 个 FAIL 的根因

| Row | 作者 CSS | 可直接测的方向 | 误差 | SVG PNG SHA-256 |
| --- | --- | --- | --- | --- |
| web-chat-138 / web-panels-141 DPR1z1 | 1.26×7.2 @ (28.3,303.4) r0 `#686e67` | 仅 width | height +0.697，width −0.008，centroid 0.012，mass +0.812 px² | `394d00ad…6607` |
| web-chat-107 / web-panels-110 DPR1z1 | 7.2×1.17 @ (27.4,97.3) r0 `#686e67` | 仅 height | width +0.679，height +0.026，centroid 0.023，mass +1.002 px² | `a27d439e…662b` |

原始路径分别在 `/Users/admin/.codex/worktrees/panels-design-render-fidelity-r007/.tmp/render-fidelity-r007/real-shard-{1,2}/dpr1-zoom1-{web-chat,web-panels}-isolation-<id>/svg.png`。

1. **导出的几何是精确的。** `exportDesignSvg` 对这些节点输出 `<rect data-node-id="web-chat-138" x="28.3" y="303.4" width="1.26" height="7.2" rx="0" fill="#686e67" …/>`。查看这段输出只是为了定位根因，oracle 并不调用它。
2. **偏差只出现在角像素。** 内部像素和直边像素与精确面积一致：web-chat-138 的列覆盖分别是 0.69/0.70 和 0.56/0.56；width、centroid 与作者几何一致。偏差只在 x、y 两个方向都只部分覆盖的角像素上：覆盖值接近 min(xcov, ycov)，明显偏离精确面积 xcov·ycov。对全部 57 行方角 fill 逐像素拟合，min 模型的最大偏差是 0.104（4 个失败行仍有约 0.0235 和 0.0300 的像素残差），乘积模型的最大偏差是 0.264。**min 模型只是一个拟合，不是精确机制**（`corner-aa-mechanism.json/.log`）。细条的短边不足 2 px，长轴两端的每个像素都是“角像素”，于是长轴的覆盖积分被放大：mass 多出 0.81–1.00 px²，除以短边后表现为 integral 增大 0.68–0.70。
3. **用独立手写 SVG 做简化复现**（`repro-chromium.json/.log`，Chromium 148.0.7778.96，headless，只走 `data:`）。每个 case 使用审计行精确的 device 坐标、填充色和背景色。**注意：这组复现的条件与真实采集不同**，是 40×40 viewport、偏移 0、`<svg>` 直接放在 body 里；与原采集一致条件下的复现见下一节。

| 配置 | case | 元素 | mass − 精确面积 | 与精确面积的最大像素差 | 与角 min 模型的最大像素差 |
| --- | --- | --- | ---: | ---: | ---: |
| 旧采集参数 `--enable-webgl --enable-unsafe-swiftshader --use-angle=swiftshader` | web-chat-138 | rect | **+0.8124**（审计 +0.8124） | 0.2275 | 0.0235 |
| 同上 | web-chat-107 | rect | **+0.9998**（审计 +1.0020） | 0.2180 | 0.0300 |
| 同上 | android-chat-35（通过行） | rect | **+0.3580**（审计 +0.3580） | 0.1416 | 0.0807 |
| 同上 | web-chat-138 / web-chat-107 / android-chat-35 | path | +0.8124 / +0.5407 / +0.3580 | 0.2275 / 0.2158 / 0.1416 | 0.0235 / 0.3522 / 0.0807 |
| `--disable-gpu` | web-chat-138 / web-chat-107 / android-chat-35 | rect | +0.0452 / +0.0446 / +0.0402 | **0.0035 / 0.0032 / 0.0061** | 0.22 / 0.19 / 0.14 |
| `--disable-gpu` | web-chat-138 / web-chat-107 / android-chat-35 | path | −0.2378 / +0.6072 / +0.0103 | 0.0626 / 0.0500 / 0.0028 | 0.28 / 0.17 / 0.14 |

在旧采集参数下，不含任何 Design Studio 代码的手写 `<rect>` 复现出审计测到的覆盖量偏差：web-chat-138 为 0.8124，web-chat-107 差约 0.0022 px²（实际 0.00218237），android-chat-35 为 0.3580。像素与角 min 模型的残差为 0.0235 / 0.0300 / 0.0807。使用 `--disable-gpu` 参数时，`<rect>` 每个像素与精确面积的差都 ≤0.0061。参数名不能证明实际后端，所以本文只说“该参数配置”，不说“CPU 栅格”。改写成 `<path>` 不是修复：GPU 下 web-chat-107 仍多出 0.54，CPU 下 path 分别是 −0.24、+0.61、+0.01，结果随配置和形状变化，其中两个 case 偏离精确面积比 CPU `<rect>` 更大。

**分类：** 这是栅格化后的 SVG 真实偏离了作者 coverage，所以保持 FAIL，不改写成 pass，也不加宽阈值。证据强烈支持主要原因是该配置下 Chromium 栅格化的角像素 AA，而不是 SVG 模块：导出几何精确；纯 Chromium 能复现；同页面同 markup 换一组启动参数，结果就从 FAIL 变成 PASS。但本轮**没有确定**实际后端是 GPU 还是 CPU，也没有确定精确的 AA 实现。按照禁止条件，不能为了让 SVG 达标去改 HTML 或 GPU，也不应该改采集参数；同时 SVG 模块里没有可以做的最小修复：改写成 `<path>` 结果不稳定，GPU 下 web-chat-107 仍多出 0.54，而且还会丢掉 `<rect>` 在下游编辑器里的语义。因此没有改 production。如果产品上要消除这个偏差，需要由主代理决定以下方向之一：调查并约束导出/预览的栅格配置，或者为亚 2px 细条另立 AA 合同。这两个都超出本次的有界任务。同样的角 AA 模型也影响前面提到的余量很小的通过行（0.30–0.44）。

四类根因计数：SVG 模块真实错误 0；该配置下的渲染器 AA（证据强烈支持，后端未确认）4（全部 FAIL）；采样污染 0；数据缺失 0。另有不可观测 0、不支持 0。

## 返修：真实 SVG markup 负控与一致条件复现

脚本是 `tests/apps/design-studio/svg-semantic-markup-controls.mjs`。它复用 R007 采集的做法：对同一个 per-page design 先做 `isolateFidelityDesign`，再用 `exportDesignSvg` 导出；页面是 1600×1000 viewport、DPR1，`#export-world` 放在 left/top 32px，变换为 `scale(zoom) translate(-tile)`，`<svg>` 放在 `designPageBounds` 位置；截图 clip 为 32,32 加 tile 尺寸；启动参数与原 report 相同，即 `--enable-webgl --enable-unsafe-swiftshader --use-angle=swiftshader`。唯一的省略是 font-face CSS（只影响文字，被测对象是矩形）。为了证明条件一致：**8 个未修改的重渲 PNG 都与旧 `svg.png` 逐字节相同**，SHA 相同，差异字节数为 0。

然后真的去改目标元素的 SVG markup，交给 Chromium 栅格化，再用**未修改的作者 oracle** 判定。oracle 不参与生成这些输入：

| Row (DPR1/z1) | 改动后的 markup | 状态 | 误差（device px） |
| --- | --- | --- | --- |
| android-chat-11 | 原样 | PASS | max\|Δc\| .051，max\|Δw\| .052 |
| android-chat-11 | `stroke-width="1.5"` | **FAIL** 32/32 probe | max\|Δw\| .511 |
| android-chat-92（5.4 圆环） | 原样 | PASS | .057 / .054 |
| android-chat-92 | `stroke-width="1.5"` | **FAIL** 32/32 | max\|Δw\| .628 |
| android-chat-35（4.8×1.12） | 原样 | PASS | W .302 |
| android-chat-35 | `width="5.8"` | **FAIL** | W 1.302，c .566 |
| android-chat-35 | `height="2.12"` | **FAIL** | H 1.004 |
| android-chat-93（7.2×2.7 r.9） | 原样 | PASS | W .070 |
| android-chat-93 | `width="8.2"` | **FAIL** | W 1.074 |
| android-chat-93 | `height="3.7"` | **FAIL** | H .987 |

4 个 FAIL 行在一致条件下的重渲结果：PNG 与旧 capture 逐字节相同，判定仍是 FAIL，误差与审计完全一致（web-chat-138/web-panels-141 的 H +.6966；web-chat-107/web-panels-110 的 W +.6787）。同一页面、同一 markup，只把启动参数换成 `--disable-gpu`（视为参数变体，后端未验证），这 4 行 **PASS**：H 或 W 误差 ≤.0063，mass 差约 .045。

后端证据：WebGL 的 unmasked renderer 是 `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)`，这只说明 WebGL 走 SwiftShader，**不能证明页面合成或栅格的后端**。`chrome://gpu` 在 headless 中返回 `net::ERR_FAILED`，**未取到**。

结果：`.tmp/svg-audit/final-r2/markup/markup-controls.json`（SHA-256 `929711938a0ece76f5185213b8cc2e8b1b4eefa893773a8d7688620bc00ec250`）以及每张 PNG。这里只为 DPR1/z1 的少数行做了真实 markup 负控，没有覆盖全部 235 行。

## 与 HTML 的描述性差异（非门禁）

- 旧数据中 SVG−HTML 的原始差异全部保留：stroke centroid 最大 **0.636 CSS px**（`android-chat-92`、`ios-chat-91`、`web-chat-72` 一类），stroke width 最大 0.338 CSS px；fill 的整数 bbox 边最多差 1 device px，centroid 最多差 0.500 CSS px。
- 用同一算子测 HTML capture 相对作者几何的差异，仅作描述：stroke centroid 最大 0.680 CSS px，width 最大 0.269 CSS px；fill centroid 最大 0.430，width 最大 1.040，height 最大 0.880 CSS px。按 SVG 的合同算，HTML 只有 6/235 达标。这反映的是 HTML 路线有意做的 device-pixel paint-box 吸附（例如 web-chat-138 在 HTML 中被画成 2×8 个整像素），**不据此判定 HTML 有缺陷**，也没有为此修改 HTML。

## 未覆盖项

- 235 行里没有旋转圆角或椭圆，所以 oracle 对它们显式返回 UNSUPPORTED，不计入 pass。R008 中 SVG rotation 的 224 条 unique 残留和 synthetic 的 23 条残留，本轮都没有重新验收。
- 系统字体 NodeSVG central fallback、原生 range、stroked text、SVG shadow、image-fit、opacity<1 组、渐变 paint、per-corner/per-side、inside/outside stroke：本轮都没有覆盖，也没有扩展字体解析。
- 没有重新拍摄任何矩阵，只复用旧 raw。新的浏览器运行只有两类：上面的最小复现（条件不同），以及返修中一致条件下的 14 张截图（8 张原样、6 张改过 markup）加 4 张 `--disable-gpu` 变体。
- 470 张 PNG 实际位于 `/Users/admin/.codex/worktrees/panels-design-render-fidelity-r007/.tmp/render-fidelity-r007/`，经 R008 rows 的路径引用。“采样污染 0”是本审计脚本算出的结果，独立 review 没有重算像素。
- 真实 Host 隔离窗口验收没有获得许可，未执行。整体样本的视觉验收仍然是 BLOCKED。安装版仍是 0.23.0。

## 实际命令与日志

```sh
npm ci --cache .tmp/npm-cache --prefer-offline                       # exit 0, .tmp/svg-audit/npm-ci.log
node --test tests/apps/design-studio/svg-semantic-metrics.test.mjs   # 14/14 pass, exit 0
node tests/apps/design-studio/r009-svg-semantic-replay.mjs --self-test   # 旧 7 assert 仍 pass, exit 0
node --max-old-space-size=4096 tests/apps/design-studio/svg-semantic-audit.mjs \
  /Users/admin/.codex/worktrees/panels-design-render-fidelity-r008/.tmp/render-fidelity-r008 \
  .tmp/svg-audit/final/replay \
  /Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json \
  /Users/admin/.codex/worktrees/panels-design-render-fidelity-r009/.tmp/render-fidelity-r009/svg/summary.json   # exit 0
node .tmp/svg-audit/repro-chromium.mjs .tmp/svg-audit/final/repro-chromium.json   # exit 0（独立复现，不提交）
node .tmp/svg-audit/final/minmodel.mjs                                # exit 0（角 AA 机制拟合，不提交）
# 返修
node --test tests/apps/design-studio/svg-semantic-audit.test.mjs     # 修复前 exit 1：TypeError（zero-red.log）；修复后与 metrics 一起 15/15
node --max-old-space-size=4096 tests/apps/design-studio/svg-semantic-audit.mjs \
  /Users/admin/.codex/worktrees/panels-design-render-fidelity-r008/.tmp/render-fidelity-r008 .tmp/svg-audit/final-r2/replay \
  /Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json \
  /Users/admin/.codex/worktrees/panels-design-render-fidelity-r009/.tmp/render-fidelity-r009/svg/summary.json   # exit 0
node tests/apps/design-studio/svg-semantic-markup-controls.mjs \
  /Users/admin/.codex/worktrees/panels-design-render-fidelity-r008/.tmp/render-fidelity-r008 \
  /Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json .tmp/svg-audit/markup   # exit 0
node .tmp/svg-audit/final-r2/counterexample.mjs                       # Codex 反例复算，exit 0
```

套件与 validate 的结果见文末“验证运行”一节。

返修后重跑的 replay 与原结果相比，235 行的 status 和误差数值完全相同（0 行有差异）；变化只有改名（`syntheticCoverageControls`）和 zero-coverage 分支的字段。新的输出是 `.tmp/svg-audit/final-r2/replay/svg-semantic-audit.json`（SHA-256 `14bf2d91e0be5fea4386f34b6b9958c404a175a1e754b78269b4cb0fed2a6689`），summary 是 `5849a7d51292dd39b5036c2f5a7a95b31c1270303f3edad632ea16a6b9d8b202`。

首轮完整的 235 行逐 probe 记录（含 oracle 与实际的 centroid/width、残差、负控结果、旧值一致性、HTML 描述、PNG SHA-256）保存在 `.tmp/svg-audit/final/replay/svg-semantic-audit.json`（SHA-256 `a82d771e42e4729eb3dc666b18f0a8633bd5f495a77bb45569fe9f8d7ca4bc85`），汇总在 `summary.json`（`058527e5b1d731a4d92424ac45afcc4d0f9a56bd2003134f325f2048e126bc5a`）。命令的 argv、UTC 时间与 exit 记录在 `command-receipt.json`；其中失败过的尝试（zsh 没有拆分命令字符串导致 exit 127；复制脚本后相对 import 层级错误；repro 首版的 web-chat-107 坐标手误）都已注明，并记录了重跑结果。输入未被改动：R008 `final-real-rows.json` 的 SHA-256 是 `ddd8971939b771a6423f53cb67c58d4de632806a2add7825749ae9a4b3ec37a9`，真实稿的 SHA-256 在运行前后都是 `91d877f8dbb28dce4c698b850c0db7455be2471c9d052f5cdf138c35f47dfc24`（由脚本断言）。共读取 470 张 PNG（235 张 SVG + 235 张 HTML），只读。

## 73 source nodes × 四矩阵逐项结果

stroke 格式为 `状态 max|Δcentroid|/max|Δwidth|`（取 32 个 probe 中的最大值）；fill 格式为 `状态 Δcentroid/|ΔW|/|ΔH|`。单位都是 device px，都是 SVG 减 oracle。`P` 表示 PASS，**F** 表示 FAIL；空格表示该行不在 235 之内。

| Source node | kind | authored CSS | DPR1 z1 | DPR1 z2 | DPR2 z1 | DPR2 fracpan |
| --- | --- | --- | --- | --- | --- | --- |
| android-chat-11 | stroke | 14.4×12.6 r1.8 sw1 | P .051/.052 | P .032/.068 | P .032/.068 | P .048/.028 |
| android-chat-35 | fill | 4.8×1.12 r0 | P .065/.302/.004 | P .029/.040/.013 | P .029/.040/.013 | P .059/.036/.012 |
| android-chat-53 | stroke | 10.2×12.75 r4.25 sw1 | P .053/.073 | P .056/.066 | P .056/.066 | P .059/.044 |
| android-chat-88 | fill | 12.6×1.26 r0.63 |  |  |  | P .000/.151/.020 |
| android-chat-91 | stroke | 14.4×10.8 r1.8 sw1 | P .051/.084 | P .039/.050 | P .039/.050 | P .047/.039 |
| android-chat-92 | stroke | 5.4×5.4 r2.7 sw1 | P .057/.054 | P .042/.062 | P .042/.062 | P .056/.075 |
| android-chat-93 | fill | 7.2×2.7 r0.9 | P .014/.070/.013 | P .013/.025/.025 | P .013/.025/.025 |  |
| android-panels-11 | stroke | 14.4×12.6 r1.8 sw1 | P .051/.052 | P .032/.068 | P .032/.068 | P .048/.028 |
| android-panels-34 | stroke | 12.8×8.8 r1.6 sw1 | P .067/.067 | P .078/.090 | P .078/.090 | P .029/.040 |
| android-panels-47 | stroke | 9.9×9.9 r4.95 sw1 | P .041/.103 | P .051/.067 | P .051/.067 | P .037/.058 |
| android-panels-54 | fill | 8×1.3 r0 |  | P .010/.000/.023 | P .010/.000/.023 | P .020/.000/.023 |
| ios-chat-10 | stroke | 14.4×12.6 r1.8 sw1 | P .051/.052 | P .032/.068 | P .032/.068 | P .048/.028 |
| ios-chat-34 | fill | 4.8×1.12 r0 | P .065/.302/.004 | P .029/.040/.013 | P .029/.040/.013 | P .059/.036/.012 |
| ios-chat-52 | stroke | 10.2×12.75 r4.25 sw1 | P .053/.073 | P .056/.066 | P .056/.066 | P .059/.044 |
| ios-chat-87 | fill | 12.6×1.26 r0.63 |  |  |  | P .000/.151/.020 |
| ios-chat-90 | stroke | 14.4×10.8 r1.8 sw1 | P .051/.084 | P .039/.050 | P .039/.050 | P .047/.039 |
| ios-chat-91 | stroke | 5.4×5.4 r2.7 sw1 | P .057/.054 | P .042/.062 | P .042/.062 | P .056/.075 |
| ios-chat-92 | fill | 7.2×2.7 r0.9 | P .014/.070/.013 | P .013/.025/.025 | P .013/.025/.025 |  |
| ios-panels-10 | stroke | 14.4×12.6 r1.8 sw1 | P .051/.052 | P .032/.068 | P .032/.068 | P .048/.028 |
| ios-panels-33 | stroke | 12.8×8.8 r1.6 sw1 | P .067/.067 | P .078/.090 | P .078/.090 | P .029/.040 |
| ios-panels-46 | stroke | 9.9×9.9 r4.95 sw1 | P .041/.103 | P .051/.067 | P .051/.067 | P .037/.058 |
| ios-panels-53 | fill | 8×1.3 r0 |  | P .010/.000/.023 | P .010/.000/.023 | P .020/.000/.023 |
| web-chat-1 | stroke | 14.4×12.6 r1.8 sw1 | P .051/.052 | P .032/.068 | P .032/.068 | P .048/.028 |
| web-chat-105 | stroke | 14.4×9.9 r1.8 sw1 | P .050/.071 | P .042/.072 | P .042/.072 | P .047/.058 |
| web-chat-106 | fill | 1.26×2.7 r0 | P .005/.006/.393 |  |  | P .015/.020/.037 |
| web-chat-107 | fill | 7.2×1.17 r0 | **F** .023/.679/.026 | P .008/.025/.025 | P .008/.025/.025 |  |
| web-chat-115 | fill | 11.2×1.12 r0.56 | P .000/.413/.006 | P .000/.108/.008 | P .000/.108/.008 |  |
| web-chat-119 | stroke | 14.4×11.7 r2.7 sw1 | P .026/.071 | P .038/.081 | P .038/.081 | P .046/.039 |
| web-chat-120 | fill | 1.26×2.7 r0 | P .086/.007/.396 |  |  |  |
| web-chat-121 | fill | 7.2×1.08 r0 |  | P .005/.028/.034 | P .005/.028/.034 |  |
| web-chat-126 | stroke | 14.4×14.4 r7.2 sw1 |  | P .028/.013 | P .028/.013 | P .059/.070 |
| web-chat-127 | fill | 1.17×5.4 r0 | P .120/.019/.439 |  |  |  |
| web-chat-132 | stroke | 14.4×9.9 r1.8 sw1 | P .052/.071 | P .043/.074 | P .043/.074 | P .047/.060 |
| web-chat-133 | fill | 5.4×2.7 r0.9 | P .027/.085/.012 |  |  | P .030/.013/.036 |
| web-chat-137 | stroke | 12.6×12.6 r2.7 sw1 | P .032/.020 | P .046/.061 | P .046/.061 | P .046/.041 |
| web-chat-138 | fill | 1.26×7.2 r0 | **F** .012/.008/.697 |  |  |  |
| web-chat-143 | stroke | 14.4×14.4 r1.8 sw1 |  | P .023/.025 | P .023/.025 | P .025/.089 |
| web-chat-145 | fill | 7.2×1.17 r0 |  | P .035/.036/.034 | P .035/.036/.034 | P .020/.036/.034 |
| web-chat-149 | stroke | 12.6×12.6 r3.6 sw1 |  | P .038/.047 | P .038/.047 | P .073/.051 |
| web-chat-150 | stroke | 5.4×5.4 r2.7 sw1 | P .020/.040 | P .020/.033 | P .020/.033 | P .035/.078 |
| web-chat-156 | stroke | 12.8×8.8 r1.6 sw1 | P .067/.067 | P .078/.090 | P .078/.090 | P .029/.040 |
| web-chat-18 | fill | 5.4×1.26 r0 | P .049/.212/.009 | P .055/.013/.044 | P .055/.013/.044 | P .028/.013/.044 |
| web-chat-42 | stroke | 10.2×12.75 r4.25 sw1 | P .053/.073 | P .056/.066 | P .056/.066 | P .059/.044 |
| web-chat-68 | fill | 12.6×1.26 r0.63 |  |  |  | P .000/.151/.020 |
| web-chat-71 | stroke | 14.4×10.8 r1.8 sw1 | P .051/.084 | P .039/.050 | P .039/.050 | P .047/.039 |
| web-chat-72 | stroke | 5.4×5.4 r2.7 sw1 | P .057/.054 | P .042/.062 | P .042/.062 | P .056/.075 |
| web-chat-73 | fill | 7.2×2.7 r0.9 | P .014/.072/.013 | P .013/.025/.025 | P .013/.025/.025 |  |
| web-chat-98 | fill | 6×1.4 r0 | P .014/.000/.027 | P .005/.000/.013 | P .005/.000/.013 | P .011/.005/.013 |
| web-panels-1 | stroke | 14.4×12.6 r1.8 sw1 | P .051/.052 | P .032/.068 | P .032/.068 | P .048/.028 |
| web-panels-101 | fill | 6×1.4 r0 | P .014/.000/.027 | P .005/.000/.013 | P .005/.000/.013 | P .011/.005/.013 |
| web-panels-108 | stroke | 14.4×9.9 r1.8 sw1 | P .050/.071 | P .042/.072 | P .042/.072 | P .047/.058 |
| web-panels-109 | fill | 1.26×2.7 r0 | P .005/.006/.393 |  |  | P .015/.020/.037 |
| web-panels-110 | fill | 7.2×1.17 r0 | **F** .023/.679/.026 | P .008/.025/.025 | P .008/.025/.025 |  |
| web-panels-118 | fill | 11.2×1.12 r0.56 | P .000/.413/.006 | P .000/.108/.008 | P .000/.108/.008 |  |
| web-panels-122 | stroke | 14.4×11.7 r2.7 sw1 | P .026/.070 | P .036/.080 | P .036/.080 | P .046/.039 |
| web-panels-123 | fill | 1.26×2.7 r0 | P .087/.008/.396 |  |  |  |
| web-panels-124 | fill | 7.2×1.08 r0 |  | P .006/.031/.033 | P .006/.031/.033 |  |
| web-panels-129 | stroke | 14.4×14.4 r7.2 sw1 |  | P .028/.013 | P .028/.013 | P .059/.070 |
| web-panels-13 | stroke | 12.8×8.8 r1.6 sw1 | P .067/.067 | P .078/.090 | P .078/.090 | P .029/.040 |
| web-panels-130 | fill | 1.17×5.4 r0 | P .120/.019/.439 |  |  |  |
| web-panels-135 | stroke | 14.4×9.9 r1.8 sw1 | P .052/.071 | P .043/.074 | P .043/.074 | P .047/.060 |
| web-panels-136 | fill | 5.4×2.7 r0.9 | P .027/.085/.012 |  |  | P .030/.013/.036 |
| web-panels-140 | stroke | 12.6×12.6 r2.7 sw1 | P .032/.020 | P .046/.061 | P .046/.061 | P .046/.041 |
| web-panels-141 | fill | 1.26×7.2 r0 | **F** .012/.008/.697 |  |  |  |
| web-panels-146 | stroke | 14.4×14.4 r1.8 sw1 |  | P .023/.025 | P .023/.025 | P .026/.090 |
| web-panels-148 | fill | 7.2×1.17 r0 | P .051/.238/.009 | P .035/.038/.033 | P .035/.038/.033 | P .019/.038/.033 |
| web-panels-152 | stroke | 12.6×12.6 r3.6 sw1 |  | P .038/.047 | P .038/.047 | P .073/.051 |
| web-panels-153 | stroke | 5.4×5.4 r2.7 sw1 | P .020/.040 | P .020/.033 | P .020/.033 | P .035/.078 |
| web-panels-159 | stroke | 12.8×8.8 r1.6 sw1 | P .067/.067 | P .078/.090 | P .078/.090 | P .029/.040 |
| web-panels-35 | stroke | 8.8×8.8 r4.4 sw1 | P .018/.032 | P .034/.044 | P .034/.044 | P .033/.058 |
| web-panels-40 | stroke | 19.2×19.2 r2.4 sw1 |  | P .020/.015 | P .020/.015 | P .020/.038 |
| web-panels-42 | fill | 9.6×1.56 r0 | P .050/.038/.002 | P .019/.009/.006 | P .019/.009/.006 | P .029/.014/.006 |
| web-panels-62 | stroke | 19.2×16.8 r2.4 sw1 |  | P .028/.066 | P .028/.066 | P .046/.034 |

## 验证运行

```sh
npm test -- --suite design-studio   # exit 0；UTC 2026-11-07T01:08:19Z..01:16:46Z
npm run validate                    # exit 0；UTC 2026-11-07T01:11:27Z..01:11:30Z
```

- Design Studio 套件分两个命令组：1255 tests / 1254 pass / 1 skip，以及 253 tests / 249 pass / 4 skip。合计 **1508 / 1503 pass / 0 fail / 5 skip**，比 R009 的 1494/1489 多出本轮新增的 14 项；日志中可以看到新增的测试名。日志 `.tmp/svg-audit/final/suite.log`，SHA-256 `6cb93830db2c589911a6d5086665e8c224d244283fb58a850be27d75b1cb5886`。
- `validate.log` 的 SHA-256 是 `194ac30cc931eedfada05c36180fa9b47a3f61e2cc96254f50830a356295b291`。
- 两条命令都继承主机默认的 `TMPDIR=/var/folders/1d/6__4f4y51g90nblfptt8s9v80000gn/T/`，位于仓库之外。
- 本轮只改 tests/docs，production 零改动，**没有运行完整的 `npm run check`**，不声称跑过。

### 返修后的验证运行

```sh
npm test -- --suite design-studio   # exit 0；UTC 2026-11-07T01:28:07Z..01:36:28Z
npm run validate                    # exit 0；UTC 2026-11-07T01:36:28Z..01:36:31Z
```

- 两个命令组分别是 1256 / 1255 pass / 1 skip 和 253 / 249 pass / 4 skip，合计 **1509 / 1504 pass / 0 fail / 5 skip**，比上轮多出新增的 zero-coverage 回归 1 项。
- 日志：`.tmp/svg-audit/final-r2/suite.log`，SHA-256 `8cd667685dcd327ae954f56466ae761a84881474f09e86944dae0e599a08a2ed`；`validate.log` 的 SHA-256 是 `194ac30cc931eedfada05c36180fa9b47a3f61e2cc96254f50830a356295b291`。
- `TMPDIR` 是仓库外的 `/var/folders/1d/6__4f4y51g90nblfptt8s9v80000gn/T/`。
- 本轮只改 tests/docs，**没有运行完整的 `npm run check`**。
