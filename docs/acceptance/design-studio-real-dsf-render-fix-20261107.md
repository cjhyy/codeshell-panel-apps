# Design Studio 真实 HiDPI（真实 DSF）渲染修复（2026-11-07）

**状态：BLOCKED（部分达成）。** 本轮修了 GPU 路线的文字行盒、小矩形和旋转细条的盒/枢轴吸附。真实 Host（Electron 33 / Chromium 130，真实 DPR2，Metal）里，6 个 case × 4 个相机的 GPU 对 HTML 对比从 **4/24 升到 22/24**。仿真 DSF2 修复前后都是 **24/24**，旧 golden 不变。

剩下 2 项是旋转灰色细条在 fit 和小数 pan 下的 ink/质心，仍按严格合同记为 FAIL。原因已用单变量因果实验证实：Chromium 的**页面光栅后端**（GPU raster 对软件 raster），与布局网格无关。同一份 HTML 在两种后端之间自身就超出同一合同，所以不存在能同时满足两种后端的单一绘制路径（§5a）。`goalComplete` 恒为 false。

独立 review 448732e1 已接受 `92940ce6` 的 production 代码。probe 合同里自行加上的“文字 ink 放宽到 4%”已按 review 意见删除，先写红测试再改到绿（§3）。

证据都在任务自有的仓库内副本 `.tmp/real-dsf-evidence/` 中（未提交，`SHA256SUMS` 覆盖每个文件，原始文件保持不变）。下文出现的 `.tmp/real-dsf-evidence/…` 都是相对仓库根的路径。

最终交付说明见 [design-studio-render-fidelity-handoff-20261107.md](design-studio-render-fidelity-handoff-20261107.md)：review 448732e1 判 `15d8cf85` 代码 PASS，有限产品验收为 ACCEPTABLE_WITH_LIMITS，由主代理接受。严格 FAIL 不变。

基线 `de5aaffa`；Host 只读 `19fbe3828`（工作区干净）；Electron 33.4.11 / Chromium 130.0.6723.191；离线对照用 Chromium 148.0.7778.96 headless。

## 1. 被推翻和被证实的假设

| 假设 | 结论 | 证据 |
| --- | --- | --- |
| H1：偏差来自 Chromium 130 和 148 的版本差异（run4 的归因） | **推翻**（上一轮已更正） | 同为 148，强制 DSF 与 Electron 130 逐数一致；仿真 DSF 才与 GPU 一致 |
| H2a：真实 DSF 下按“device 网格”吸附（变换之后取整） | **推翻** | 小矩形与旋转细条都不符合；文字在 z2 有 0.31/0.44 的残差 |
| H2b：真实 DSF 下按“CSS 网格”吸附 | **推翻** | 小矩形宽 2.06 device px，CSS 网格预测是 4 |
| **H3：Blink 把布局整体缩放 s（真实 DSF 时 s=DPR，仿真时 s=1）。LayoutUnit 为 1/64 布局像素，取整发生在变换之前的局部坐标、1/s CSS 网格上；文字在 fontSize×s 下取度量，行盒在物理像素里分配** | **证实** | 见下 |
| H4：fit/小数 pan 下细条和小矩形的剩余 ink 差来自布局 | **推翻**，是光栅后端 | 见 §5 |

H3 的直接核对（录得数据，`tests/apps/design-studio/real-dsf-layout-scale.test.mjs`）：

- **小矩形** 28.3,120.4,1.26×7.2，s=2：
  - 局部物理坐标 56.6→57..59，240.8→241..255，即 CSS 28.5–29.5 × 120.5–127.5。
  - z1 预测 device 77.6–79.6 / 261.6–275.6，E4 实测 77.599–79.607 / 261.601–275.603。
  - z2 预测 134.6–138.6 / 502.6–530.6，实测 134.598–138.607 / 502.600–530.605。
- **文字**：
  - Arial 600 14/1.4，28px 时度量 25/6：floor((39.2+25−6)/2)=29 物理 px，y70 → 140+29=169 → **84.5**。E1/E4 DOM 基线为 84.500003。
  - Menlo 13/1.2，26px 时度量 24/6：141+24=165 → **82.5**。DOM 为 82.500003。
  - 仿真模式（s=1）得 84，旧值不变。
- **旋转细条**：用 s=2 的盒和 LayoutUnit 枢轴预测质心，与 E4 实测差 0.056/0.092/0.020 device px（z1/z2/fit）；s=1 模型差 1.45/3.05/0.92。仿真 E3 下 s=1 模型差 0.031/0.043/0.058。

## 2. 实现原理与位置

范围是两个承担逻辑的小模块，加上两个调用侧的最小接线。没有新 cache，也没有新预算。

- **`apps/design-studio/app/text-line-box.mjs`**
  - `textLineBoxAlphabeticOffset(node, metrics, layoutScale = 1)`（:14-22）：在物理像素里 floor 分配 leading，再 ÷s。
  - `textLineBoxBaselineY(..., { originY, layoutScale = 1 })`（:32-42）：layoutTop 和行高按 1/64 物理 LayoutUnit 累加，在物理像素中 round，再 ÷s。
  - s=1 时与旧公式逐位相同（×1、÷1 都精确），有扫描测试。
  - finite 文本不变：E1/E3/E4 三个环境差异在 1/128 以内。
- **`apps/design-studio/app/canvas/browser-paint-box.mjs`**
  - `browserPaintBoxes(nodes, { layoutScale = 1 })`（:21-23、:86、:134、:145-150、:155）：LayoutUnit 改为 1/(64·s) CSS px，在物理像素取整后 ÷s；旋转枢轴为 `x + w/(2·64·s)`；LAYOUT_MISMATCH 守护按同一量子计算。
  - `blinkLayoutScale(document)`（:159-190）是 P1 profile：
    - 一次离屏 DOM 探测：子元素 left = 1.001/(64·DPR) px；测得 0 判为仿真（s=1），测得 1/(64·DPR) 判为真实（s=DPR）；其他值不猜测，s=1 并带 `reason`。
    - 按 document+DPR 缓存：只在初始化和 DPR 变化时探测，每帧只读 `devicePixelRatio`。不读 UA。
    - 字体加载不改变布局单位；字体度量由已有的 font-epoch 缓存处理。
- **接线 `apps/design-studio/app/canvas/canvaskit-text.mjs`**
  - 场景级 `layoutScale`（:88-89），由 `beginScene(design, { layoutScale })` 设置（:553-）。scale 变化时按内容变化处理：清空 raster plan 和 content bounds，并返回 true，让 node picture 失效。
  - Canvas 度量在 `fontSize×s` 下取（:294、:305）；CK 度量用 `CK.Font(face, fontSize×s)`（:311-322）。
  - raster 签名在 s≠1 时带上 s（:427）。
- **接线 `apps/design-studio/app/canvas/canvaskit-renderer.mjs`**
  - setScene 中取 profile，传给 paint box 和 text（:468-469、:509）；字体重载路径同样传入（:851）。
  - render 时若 DPR 变化导致 scale 改变，用同一份 resources 重建场景后再渲染（:989-992）。
  - stats 新增 `browserLayout`。
  - hitTest 本就使用 `scenePaintBoxes`，因此与绘制一致；shape raster 候选来自同一份 paint box 和 pivot，clip、opacity、手势延迟路径不变。
- **用户数据不变**：`fontFamily` 存值、几何、格式、序列化、frontend/SVG/receipt 都没改；默认渲染器没有切换，Electron 没有升级。

## 3. probe 和 harness（必要改动）

- `scripts/design-studio-snap-probe.mjs`：
  - Inter case 改为 `inter-resource`：用真实的文档字体资源，descriptor 由 app 的 `resource-store` 生成，含 sha256。HTML 的 FontFace 与 GPU 的 resources 使用同一份字节，别名为 `DSSnapProbeInter`，权重 400，与 descriptor 一致，避免两条路线各自合成粗体。记录 load promise、`loadMs` 和 `status`，不依赖 `fonts.check`。
  - 新增 `z1-pan` 相机（pan 13.65/11.85）。
  - `compareGpuToHtml`：同一页面、同一相机，GPU 截图与 HTML 截图逐 case 比较。所有 case 使用同一份严格合同：质心 ≤0.15，50% 边 ≤0.5，ink ±3%，**没有任何放宽**。`92940ce6` 中曾给文字（真实字体）加上 4% 的放宽，review 448732e1 判为不合格。处理过程：先改测试，要求 3%–4% 之间的文字 ink 偏差判 FAIL，红灯输出见 `.tmp/real-dsf-evidence/unit/red-strict-ink.txt`；再删除 `realFontInkBias` 和 `inkReason`，变绿。其他阈值都没动。
  - `snapProbeGpuMountSource`：在探针自有 host 里驱动**已安装的** CanvasKit renderer，结束后 dispose。
  - `GPU_DIAGNOSTIC_VARIANT`：`deviceTextSampling:false`，只作诊断，**不计入**通过数。
- 离线脚本新增 `--app-dir`，可用 `git archive de5aaffa` 的基线 app 做红灯；Electron 的 `probe-snap-grid` 步骤同样采集 GPU 和诊断变体。

## 4. 红 → 绿

### 单元测试（`real-dsf-layout-scale.test.mjs`，5 项）

- 红：先缺 `blinkLayoutScale` 导出（SyntaxError），加惰性桩后为 1 pass / 4 fail。实际值：offset 19≠14.5，矩形 [28,120,2,8]≠[28.5,120.5,1,7]，scale 1≠2，`layoutScale:0` 未抛错。
- 绿：5/5。相关单测 80/80；harness 和 probe 测试 82/82。

### GPU 对 HTML：6 case × {100%, 200%, fit, 小数 pan}

| 环境 | 修复前（de5aaffa） | 修复后 | profile |
| --- | --- | --- | --- |
| 仿真 DSF2，headless 148 | 24/24 | **24/24** | scale 1，quantum 0 |
| 强制 DSF2，headless 148（软件光栅） | 4/24 | 23/24 | scale 2，quantum 1/128 |
| **真实 DPR2，Electron 130 Host（Metal）** | **4/24** | **22/24** | scale 2，quantum 1/128 |

真实 Host 修复前的典型偏差（device px）：

- 文字 y：Inter −3/−6/−2/−3，Menlo +1/+2/+1/+1，Arial −1/−2/−1/−1；
- 小矩形 ink +121% 到 +128%；
- 细条质心 0.89–3.03。

真实 Host 修复后（`.tmp/real-dsf-evidence/electron/e-green/`；表格见 `.tmp/real-dsf-evidence/summaries/gpu-vs-html-e-{red,green}.txt`）：

- 文字 4 case × 4 相机：质心 ≤0.011，50% 边 ≤0.006，ink ≤0.31%（在严格的 3% 以内，删除 4% 放宽不改变任何判定）；
- 小矩形：质心 ≤0.003，ink ≤0.19%；
- 细条：z1 为 0.074 / −0.32%，z2 为 0.088 / −0.13%；**fit 为 −11.50%（FAIL）；z1-pan 质心 0.151、ink −3.92%（FAIL）**。

强制 headless 修复后唯一未通过的是小矩形 fit，ink +4.73%。原因与 §5 同轴：headless 的 HTML 用软件光栅，角像素取乘积 0.16；CanvasKit 用 Ganesh，角像素取 min 0.38。真实 Host 的 HTML 由 GPU 光栅，角像素同为 0.40，所以真实 Host 里这一项通过。

### 我实际看过的图

- `.tmp/real-dsf-evidence/electron/e-green/sbs-z2.png`：z2 下 4 倍放大，上排为红、下排为绿，每格左 HTML、右 GPU。
  - 红：GPU 的 `>_` 偏低，“Continue” 偏高，小矩形约宽 2 倍。
  - 绿：两条路线肉眼一致。
- 另外打印过 z1 小矩形四角的覆盖率矩阵，涉及 headless HTML、headless GPU 和 E1 真实 HTML 三份图。

## 5. 剩余阻塞：旋转细条在 fit 和小数 pan 下（已定位，未修）

诊断变体中，rotated leaf 由 CanvasKit 直接绘制，不走 device shape raster：

| 相机 | 真实 Host：shape raster | 真实 Host：direct | 强制 headless：shape raster | 强制 headless：direct | 仿真：direct |
| --- | --- | --- | --- | --- | --- |
| z1 | 0.074 / −0.32% | 0.001 / −0.29% | PASS | PASS | PASS |
| z2 | 0.088 / −0.13% | 0.000 / −0.30% | 0.000 / 0.00% | PASS | PASS |
| fit | **FAIL −11.50%** | 0.009 / −0.15% | 0.000 / 0.00% | **FAIL +12.71%** | **FAIL +15.47%** |
| z1-pan | **FAIL 0.151 / −3.92%** | 0.000 / −0.09% | 0.000 / 0.00% | **FAIL 0.192** | **FAIL +10.59%** |

结论：

- shape raster 复现的是软件光栅的 AA。真实 Host 中 GPU 路线的面积（13.28）等于 headless 软件光栅的 HTML（13.29）。
- CanvasKit 直接绘制复现的是 Chromium GPU 光栅（Ganesh）的 AA。
- 哪一条对，取决于页面 HTML 实际由哪种后端光栅。这与 P1 测的布局网格是**另一条轴**：真实 DSF 不等于 GPU 光栅，例如 GPU 被列入黑名单的 Host。页面脚本无法观测光栅后端；headless 加 `--enable-gpu-rasterization --force-gpu-rasterization` 也没有改变 HTML 的结果，本地无法复现。
- 我**没有**把它绑定到 layout profile 上，那会是没有因果关系的代理条件。

解除阻塞需要以下两者之一：

上一版这里提议“由 Host 暴露光栅后端”，现已撤回：按 review 要求，不用 `getGPUFeatureStatus`、非 SwiftShader 之类的代理来选后端，也不新增 Host 接口。

单变量因果实验见 §5a。结论是不存在同时满足两种后端的共同修法；剩余项只能由主代理或产品方决策，我没有自行签字。

## 5a. 单变量因果：Chromium 页面光栅后端（本批）

**做法**：同一个 owned Electron 33 / Chromium 130、同一真实 DPR2、同一 Host 19fbe3828，跑两次 probe，唯一差别是第二次加上 `--design-studio-disable-gpu-raster`。

- 这个开关只在 probe 模式可用。它在 owned bootstrap 的静态 import 之后、第一个 top-level await 之前，同步调用 `app.commandLine.appendSwitch("disable-gpu-rasterization")`，实现见 `scripts/design-studio-host-fidelity.mjs` 的 `insertProbeSwitches`。正式 Host 的 flags 和安装都没有改。
- 旧的 force-dsf 开关是在 `await import(preload)` 之后才追加的，这可能就是 E2 无效的原因。现在两者走同一个早期接缝，但 force-dsf 本批没有复测。

**实测的运行时状态**（`.tmp/real-dsf-evidence/summaries/raster-backend.txt`）：

| | 默认运行（`rb-default`） | 关闭 GPU raster（`rb-nogpuraster`） |
| --- | --- | --- |
| 追加开关 | 无 | `readyAtAppend:false`，`hasSwitch:true` |
| GPU 进程 command line 含 `--disable-gpu-rasterization` | false | **true** |
| guest renderer command line 含该开关 | false | false |
| DOM DPR / P1 profile | 2 / scale 2，quantum 1/128 | 2 / scale 2，quantum 1/128 |
| `getGPUFeatureStatus().rasterization`（仅作信息，不当 oracle） | enabled | disabled_software |
| CanvasKit WebGL renderer | ANGLE Metal，Apple M4 Pro | ANGLE Metal，Apple M4 Pro |

**页面 HTML 的实际光栅后端无法直接证明**：页面和 Main 都拿不到它，我们只能确认开关已经生效。下面的“翻转”是对它的行为学证据。

**数据**：每格为质心 / 50% 边 / ink，括号内是 HTML 与 GPU 的最大覆盖率。

| 相机 | case | 默认：P2 | 默认：direct | 关 GPU raster：P2 | 关 GPU raster：direct |
| --- | --- | --- | --- | --- | --- |
| z1（对照） | 细条 | 0.074 / 0.471 / −0.32% | 0.001 / 0.009 / −0.29% | 0.022 / 0.010 / +0.78% | 0.071 / 0.470 / +0.81% |
| z1（对照） | chevron | 0.007 / 0.471 / −0.34% | 0.002 / 0.009 / −0.28% | 0.019 / 0.006 / +0.69% | 0.020 / 0.470 / +0.74% |
| z2（对照） | 细条 | 0.088 / 0.169 / −0.13% | 0.000 / 0.009 / −0.30% | 0.002 / 0.006 / −0.14% | 0.089 / 0.167 / −0.32% |
| z2（对照） | chevron | 0.032 / 0.143 / +0.08% | 0.008 / 0.009 / −0.24% | 0.001 / 0.005 / −0.14% | 0.038 / 0.143 / −0.46% |
| fit | 细条 | **FAIL** 0.072 / 0.221 / **−11.50%**（0.76/0.93） | 0.009 / 0.009 / −0.15%（0.76/0.76） | 0.001 / 0.003 / +0.13%（0.93/0.93） | **FAIL** 0.062 / 0.214 / **+12.98%** |
| fit | chevron | **FAIL** **0.237** / 0.066 / −2.42%（0.67/0.89） | 0.004 / 0.006 / −0.23% | 0.002 / 0.002 / +0.20% | **FAIL** **0.234** / 0.070 / +2.45% |
| z1-pan | 细条 | **FAIL** **0.151** / 0.346 / **−3.92%** | 0.000 / 0.001 / −0.09% | 0.004 / 0.003 / +0.03% | **FAIL** 0.148 / 0.346 / **+4.01%** |
| z1-pan | chevron | 0.142 / 0.265 / −2.97% | 0.010 / 0.008 / −0.20% | 0.007 / 0.003 / −0.07% | **FAIL** **0.158** / 0.265 / +2.78% |

- **预期的翻转发生了**：
  - 默认（GPU raster）下，direct 8/8 通过，P2 有 3 项 FAIL；
  - 关闭 GPU raster 后，P2 8/8 通过，direct 有 4 项 FAIL。
  - 两次运行中，两条 GPU 路线的面积逐数相同（P2 在 fit 下均为 13.28，direct 均为 14.98），所以变化完全来自 HTML。
- **HTML 自己跨后端对比**（`.tmp/real-dsf-evidence/html-vs-html.txt`），用同一份合同：
  - fit 细条 ink −11.62%，最大覆盖率 0.76→0.93；
  - fit chevron 质心 0.237；
  - z1-pan 细条质心 0.147、ink −3.95%；
  - z1 和 z2 在合同内。
  - 也就是说，同一 Chromium、同一份 HTML，在两种光栅后端之间就超出了严格合同。**任何单一的 GPU 绘制路径最多只能满足其中一种后端**，“共同 path / AA 质量 / coverage”式的修法在数学上不成立。因此本批没有写任何 production 代码，也没有做 spike。
- **差异的性质**：几何相同（两种后端下盒子、枢轴、布局 profile 一致），差在亚像素抗锯齿：
  - GPU raster 的边更软更宽，峰值覆盖率更低；
  - 软件 raster 的峰值更高、ink 面积更小。
  - chevron 在 fit 下 0.237 的质心差，也是两条斜线 AA 分布不对称造成的。

**我实际看过的图**（`.tmp/real-dsf-evidence/raster-backend-pairs/`，`manifest.json` 带每个源 artifact 和裁剪的 sha256）：

- `4x-fit-gray-strip-…png`、`4x-fit-chevron-…png`：4 倍下能看出色调差，P2 更深、更锐。默认 HTML 与 direct 一致；关闭 GPU raster 后的 HTML 与 P2 一致。
- `4x-z1-pan-gray-strip-…png`：基本分不出差别。
- `1x-strip-fit-composite.png`：真实 1x 并排（每组依次为默认 HTML、P2、direct、关闭后 HTML；先细条后 chevron）。并排时 P2 略深；单独看不容易察觉。
- 没有看的：`1x-strip-z1-pan-composite.png` 和其余 1x 单张裁剪。

**可能的有限产品验收**（我只提出，不签字）：只限这些节点（45° 圆角细条和 chevron 双条）、这些相位（fit 0.615 和小数 pan 13.65/11.85）、DPR2 真实 Host。

- 理由：差异只在 AA；几何、位置、命中都一致；数值幅度与 HTML 自身跨后端的差异相同；1x 下只有并排才能看出。
- 这 2 项（加上 chevron fit）仍按严格合同记为 FAIL。阈值没有放宽。是否接受由主代理或产品方决定。

## 6. 真实 Host 复验（同一 Host，owned Electron）

完整运行：`.tmp/real-dsf-evidence/electron/e-full/`（原始文件为 `/private/tmp/ds-host-fidelity-1794028263029-8762a17850b245b0.*`），exit 3（因 perf 为 UNVERIFIED，用时 143 s）。

| 场景 | 结果 |
| --- | --- |
| open-without-edit | PASS |
| immediate-click-after-edit（命中） | PASS |
| save-reopen-stable | PASS |
| svg-corner-aa-host | PASS |
| same-camera-visual | EVIDENCE_ONLY |
| low-zoom-fractional-performance | UNVERIFIED（设计如此：renderer 内部计数在已安装 app 中不可观测） |

- **same-camera-visual**：真实 Host 的文字样本 GPU 对 HTML 质心 ≤0.014 device px，ink 0.997–1.006；run4 时为 y ±1–2 px。chevron 和 prompt-strokes 属于描边和矢量，不在本轮范围：
  - chevron：fit 时 ink 0.909，质心 (−0.12, −0.14)；
  - prompt-strokes：@200 时质心 y −0.25。
- **性能**：1200 段文字，小数手势，真实 RAF，同一 CDP 会话：

| | 帧数 | p50 | p95 | max | script | task |
| --- | --- | --- | --- | --- | --- | --- |
| 本轮 | 132 | 8.3 ms | 9.9 ms | 83.5 ms | 108 ms | 303 ms |
| run4（修复前） | 134 | 8.3 ms | 9.7 ms | 76.4 ms | 101 ms | 297 ms |

## 7. 运行与清理

```sh
# 离线（基线 = git archive de5aaffa apps/design-studio/app → /tmp/ds-host-harness-tmp/baseline-de5aaffa）
TMPDIR=/tmp/ds-host-harness-tmp node scripts/design-studio-snap-probe-headless.mjs --mode {emulated,forced}-dsf2 --out /tmp/ds-host-harness-tmp/rdsf/{base,fix,fix2}-{emulated,forced} [--app-dir <baseline>]
# 真实 Host（/tmp/ds-host-harness-tmp/tools/run-electron.sh 包装 npm run test:desktop … --design-studio-fidelity）
rdsf-e-red    --design-studio-probe   # 生产文件临时 checkout HEAD，跑完立即恢复；exit 3，27 s
rdsf-e-green  --design-studio-probe   # exit 3，26 s
rdsf-e-diag   --design-studio-probe   # 加入 direct 诊断变体；exit 3，28 s
rdsf-e-full                           # 完整场景；exit 3，143 s
rb-default      --design-studio-probe                                  # 本批：exit 3，28 s，05:39:01Z
rb-nogpuraster  --design-studio-probe --design-studio-disable-gpu-raster # 本批：exit 3，25 s，05:39:28Z
```

- 每次运行前后，operator 的 Electron/CodeShell 进程集合都一致（20 个 pid，diff 为空）。owned 的 `panel-desktop-ipc-*` HOME 都已删除。
- Host checkout 未改动。没有 push、merge、PR、发布或安装。
- 证据（任务自有、可移植，位于 `.tmp/real-dsf-evidence/`，见其中的 `README.md` 和 `SHA256SUMS`）：
  - `electron/{e-red,e-green,e-diag,e-full,rb-default,rb-nogpuraster}/`：报告、artifact bundle，以及 wrapper 收据（命令、exit、operator 运行前后的进程集合、运行日志）；
  - `headless/`、`unit/`、`gates/`、`summaries/`、`raster-backend-pairs/`、`tools/`（汇总脚本副本）。
  - 原始文件仍在 `/private/tmp/ds-host-fidelity-*` 和 `/tmp/ds-host-harness-tmp/`，未做任何修改。

## 7a. 守门

- `TMPDIR=/tmp/ds-host-harness-tmp npm run validate`：exit 0。
- `TMPDIR=/tmp/ds-host-harness-tmp npm run check`：**exit 0**（2026-11-07T05:14:16Z–05:26:36Z），完整日志见 `.tmp/real-dsf-evidence/gates/check.log`，计数摘要见 `summaries/check-counts.txt`。运行对象是随后原样提交为 `92940ce6` 的工作树代码；提交后只给文档补了守门一节。共 4189 个测试，pass 4180，fail 0，skipped 9；所有检查原样运行，没有关闭任何守门。其中包含 `desktop-harness` 套件，以及 `design-studio` 套件的仿真 DSF golden UI 测试，后者都没有改动。新测试 `real-dsf-layout-scale` 已登记在 `design-studio` 套件中。

## 8. 已知遗留

- 旋转细条（以及实际 chevron）在 fit 和小数 pan 下：光栅后端轴已证实（§5a），按严格合同仍为 FAIL，等待产品决策。
- SVG 4 在 DPR1 下的圆角 FAIL 仍然保留。DPR1 真实 Host 至今没有实测；E2 的 force-dsf 开关当时无效，可能是追加得太晚（§5a），未复测。
- 居中对齐文字的 x 方向 LayoutUnit（`rasterAlignedX`）仍按 1/64 CSS 处理，没有实测，本轮没有改。
- 范围文字（textRanges）、描边、图片、编辑器 overlay 都没有在真实 DSF 下逐项验证。
- 非整数 DPR（如 1.25 或 1.5）的 profile 推导合理（单测覆盖 1.5），但没有实测。
