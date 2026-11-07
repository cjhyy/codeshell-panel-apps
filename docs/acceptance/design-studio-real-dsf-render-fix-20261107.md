# Design Studio 真实 HiDPI（真实 DSF）渲染修复（2026-11-07）

**状态：BLOCKED（部分达成）。** 本轮修了 GPU 路线的文字行盒、小矩形和旋转细条的盒/枢轴吸附。真实 Host（Electron 33 / Chromium 130，真实 DPR2，Metal）里，6 个 case × 4 个相机的 GPU 对 HTML 对比从 **4/24 升到 22/24**。仿真 DSF2 修复前后都是 **24/24**，旧 golden 不变。

剩下 2 项是旋转灰色细条在 fit 和小数 pan 下的 ink/质心。已定位，原因是**页面光栅后端**（Chromium GPU raster 对软件 raster），与布局网格无关。页面侧拿不到这个信号，所以没有改，阻塞原因见下文。`goalComplete` 恒为 false，本轮未经 review。

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
  - `compareGpuToHtml`：同一页面、同一相机，GPU 截图与 HTML 截图逐 case 比较：质心 ≤0.15，50% 边 ≤0.5，ink ±3%；只有文字（真实字体）在超过 3% 时放宽到 4% 并写明理由。
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

真实 Host 修复后（`/private/tmp/ds-host-fidelity-1794028068506-4adf96f8b29f23ef.report.json`）：

- 文字 4 case × 4 相机：质心 ≤0.011，50% 边 ≤0.006，ink ≤0.31%（都在 3% 以内，没有用到 4%）；
- 小矩形：质心 ≤0.003，ink ≤0.19%；
- 细条：z1 为 0.074 / −0.32%，z2 为 0.088 / −0.13%；**fit 为 −11.50%（FAIL）；z1-pan 质心 0.151、ink −3.92%（FAIL）**。

强制 headless 修复后唯一未通过的是小矩形 fit，ink +4.73%。原因与 §5 同轴：headless 的 HTML 用软件光栅，角像素取乘积 0.16；CanvasKit 用 Ganesh，角像素取 min 0.38。真实 Host 的 HTML 由 GPU 光栅，角像素同为 0.40，所以真实 Host 里这一项通过。

### 我实际看过的图

- `rdsf/sbs-z2.png`：z2 下 4 倍放大，上排为红、下排为绿，每格左 HTML、右 GPU。
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

1. Host 向 Panel 暴露光栅后端，例如 Electron `app.getGPUFeatureStatus().gpu_compositing/rasterization`。这需要改 Host，不在本轮范围。
2. 主代理或用户决策：在真实 Host 上 rotated leaf 一律直接绘制。代价是仿真和软件光栅 golden 的 fit 与小数 pan 会回退（见上表）。

## 6. 真实 Host 复验（同一 Host，owned Electron）

完整运行：`/private/tmp/ds-host-fidelity-1794028263029-8762a17850b245b0.report.json`，exit 3（因 perf 为 UNVERIFIED，用时 143 s）。

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
```

- 每次运行前后，operator 的 Electron/CodeShell 进程集合都一致（20 个 pid，diff 为空）。owned 的 `panel-desktop-ipc-*` HOME 都已删除。
- Host checkout 未改动。没有 push、merge、PR、发布或安装。
- 原始数据：
  - 报告与 bundle：`/private/tmp/ds-host-fidelity-1794028027994-…`（红）、`…28068506-…`（绿）、`…28191546-…`（诊断）、`…28263029-…`（完整）；
  - headless 结果：`/tmp/ds-host-harness-tmp/rdsf/`；
  - 汇总工具（只读，不在仓库中）：`/tmp/ds-host-harness-tmp/tools/{cmp-table,e-gpuhtml,diag,strip-area,sbs,analyze-full}.mjs`。

## 7a. 守门

- `TMPDIR=/tmp/ds-host-harness-tmp npm run validate`：exit 0。
- `TMPDIR=/tmp/ds-host-harness-tmp npm run check`：**exit 0**（2026-11-07T05:14:16Z–05:26:36Z）。共 4189 个测试，pass 4180，fail 0，skipped 9；所有检查原样运行，没有关闭任何守门。其中包含 `desktop-harness` 套件，以及 `design-studio` 套件的仿真 DSF golden UI 测试，后者都没有改动。新测试 `real-dsf-layout-scale` 已登记在 `design-studio` 套件中。

## 8. 已知遗留

- 旋转细条在 fit 和小数 pan 下的光栅后端问题（§5，阻塞）。
- SVG 4 在 DPR1 下的圆角 FAIL 仍然保留。DPR1 真实 Host 至今没有实测；E2 的 force-dsf 开关无效。
- 居中对齐文字的 x 方向 LayoutUnit（`rasterAlignedX`）仍按 1/64 CSS 处理，没有实测，本轮没有改。
- 范围文字（textRanges）、描边、图片、编辑器 overlay 都没有在真实 DSF 下逐项验证。
- 非整数 DPR（如 1.25 或 1.5）的 profile 推导合理（单测覆盖 1.5），但没有实测。
