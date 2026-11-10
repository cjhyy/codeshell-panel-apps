# Design Studio 吸附网格探针：真实 DPR 与仿真 DPR（2026-11-07）

**结论（已证实）：run4 把差异归因为“Chromium 130 对 148 的版本差异”，这是错的，是混因。** 同一个 Chromium 148，只要把 DSF 从“Playwright 仿真”换成“强制真实 DSF”，结果就和 Electron 130 在真实 DPR2 下的结果一致。GPU 渲染器之前与之逐像素相等的，其实是 **Playwright 仿真 DSF 的行为**（CSS px 布局，变换前在 CSS 网格上吸附）。真实 HiDPI 环境（无论 130 还是 148）按 device 尺度布局，最小单位是 1/128 CSS px，绘制规则与仿真模式不同。

本轮没有改 GPU 或任何 production 代码，没有升级 Host，`goalComplete` 恒为 false。下面附上用于后续 profile 方案的资格数据：模式**可以**在运行时检测出来，但真实 DSF 下的绘制规则**无法**用“CSS 网格 / device 网格”这两个简单模型解释，所以目前**不具备**做 production 适配的资格。

## 工具（`5f5df55c`）

- `scripts/design-studio-snap-probe.mjs`：纯模块。包含 6 个 case：Inter 默认字体、finite、Menlo `>_`、Arial 600 按钮文字、45° 灰色圆角细条、1.26×7.2 小矩形，全部是 canonical codec 文档，带小数相位；3 个相机：z1、z2、fit，pan 都带 .3 的小数。浏览器侧的探针源码在所有环境里完全相同：
  - P1：用普通离屏 DOM 测偏移 0.01、1/128、1/64、0.3、0.51、0.75 的布局位置，分为普通和 `scale(2)` 两组；
  - P2：Canvas2D 在 1x 和 dpr 倍字号下的字体度量；同一份 InterVariable 字节以别名加载；
  - P3：把已安装的 `frontend-export` 生成的 markup 挂到**探针自己创建的 open shadow root** 中，读取布局矩形、基线 marker 和 Range rect。app 的 closed renderer root 不碰，也不开放。

  像素在 Node 侧测量，指标包括 coverage 面积、质心、box-filter 边缘和 50% 边缘。按预登记阈值，同时拟合 css 网格（s=1）和 device 网格（s=dpr）两种模型，阈值为：边缘 ≤0.25 device px，质心 ≤0.15，ink 偏差 ≤3%。这是解释 profile 规则用的门槛，不替代原有的视觉合同。没有用 UA，没有网络，没有 production 调试入口。
- Electron 端是 probe 模式下的 `probe-snap-grid` 步骤；离线端是 `scripts/design-studio-snap-probe-headless.mjs`（`--mode emulated-dsf2|forced-dsf2`）。离线端只服务本仓库 `apps/design-studio/app` 的文件，其余请求一律 abort；使用临时 profile，不读用户 profile；有 120 s watchdog；输出目录必须是仓库外的新目录，文件只新建不覆盖。
- `--design-studio-force-dsf <n>`：只在 probe 模式下可用，通过 owned Electron 自己的 bootstrap 追加开关。
- harness 修正：样本先用闭环滚轮平移到 stage 中心，再以 stage 中心缩放；prompt-strokes 的锚点改为 (108, 56)；被裁切的区域如实报告为 “clipped by the capture”。
- 离线验证：红 68 tests / 61 pass / 7 fail；绿 74/74；`desktop-harness` 87/87；`validate` exit 0。

## 四个环境的实测结果（每个环境一次有界会话，串行执行）

| 环境 | Chromium | `window.devicePixelRatio` | screen | P1 普通布局 | P1 `scale(2)` 内 |
| --- | --- | --- | --- | --- | --- |
| E1 Electron，真实显示 | 130.0.6723.191 | 2，resolution 2dppx | 1512×982 | **1/128 floor** | 局部同为 1/128 |
| E2 Electron + force-dsf 1 | 130.0.6723.191 | **仍是 2** | 1512×982 | 1/128 | 与 E1 逐数相同 |
| E3 headless，仿真 DSF2 | 148.0.7778.96 | 2 | 1024×720 | **1/64 floor** | 不一致（另一种取整） |
| E4 headless，`--force-device-scale-factor=2`，不仿真 | 148.0.7778.96 | 2 | 512×360 | **1/128 floor** | 1/128 |

E2 的强制开关**没有生效**，实测 DPR 仍为 2，所有数据与 E1 相同，所以它不能作为 DSF1 的证据。私有 HOME 已删除，无法回查 bootstrap；按 4 次会话的上限没有重试。DPR1 至今没有实测。

P1 原始值（E1/E4 与 E3 对比）：

| 请求偏移 | E1/E4 | E3 |
| --- | --- | --- |
| 0.01 | 0.0078125 | 0 |
| 0.51 | 0.5078125 | 0.5 |

宽度 10.3 在三个环境都测得 10.296875。

**P2 字体度量（四个环境相同）：**

- Menlo 13：ascent/descent 12/3，26px 时 24/6。
- Arial 14 与 Arial 600 14：13/3，28px 时 **25**/6（不是 26），说明度量取整依赖实际字号尺度。
- app 的 `"Inter"` family 在 E1 为 34/11，而 Inter 字节别名为 31/8。`document.fonts.check` 对两者都返回 true，所以它**不能**证明字体身份。default-inter 在不同环境中解析到的字体不同，z1 时 x 质心相差 5.7 px，因此这个 case 被排除在网格结论之外。

## P3：跨环境的实测 ink 对比（device px，以 E1 为基准）

| case | E4−E1 质心 / 面积（z1、z2、fit） | E3−E1 |
| --- | --- | --- |
| finite | ≤0.007 / ≤0.4% | ≤0.007 / ≤0.4% |
| Menlo `>_` | ≤0.002 / ≤0.5% | y **+1 / +2 / +1** |
| Arial 按钮 | ≤0.010 / ≤0.4% | y **−1 / −2 / −1** |
| 小矩形 | ≤0.04 / −1.9%、0.0%、−2.6% | 面积 **+124% / +128% / +122%** |
| 灰色细条 | ≤0.07 / −0.8%、+0.1%、−11.4% | (+1.38, −0.68) / (+2.69, −1.27) / (+0.79, −0.41) |

E3−E1 恰好就是 run4 中 “GPU − HTML130” 的那组偏移；E4 与 E1 实际相等。所以 **H2（DSF 模式）得到证实，H1（版本）没有得到支持**。

## P3：两种网格模型的拟合（预登记阈值）

- **E3（仿真）：**
  - 小矩形在 z1/z2/fit 都符合 **css** 网格（边缘 0.005–0.007，ink ≤0.4%）；
  - 灰色细条在 z1、z2 符合 css 网格（质心 0.031、0.043），fit 时 ink −10.3%，不符合；
  - 文字只部分符合（Arial z1 符合 device，z2 符合 css；Menlo 两种都不符合）。
- **E1/E4（真实 DSF）：**
  - Menlo 和 Arial 在 z1、fit 符合 **device** 网格（≤0.237），z2 两种都不符合（device 残差 0.31 / 0.44，css 残差 1.9 / 2.0）；
  - finite 只在 fit 时两种都符合；
  - 小矩形和灰色细条**两种模型都不符合**。小矩形的 y 边缘完全没有吸附：z1 时实测 261.40 / 275.80，与精确值 261.4 / 275.8 一致；x 宽约 2.06 device px，精确值是 2.52，质心偏移 +0.15，这些都解释不了。灰色细条 ink 为 −8% 到 −13%。这些不符合项不称为 AA。

## 我实际看过的图

E1、E3、E4 在 z2 下 6 倍放大的裁剪：

- 小矩形：E1 与 E4 一样，都是窄的约 2 px 实心带小数 AA 边；E3 是宽的约 4 px 实心条。
- Menlo `>_`：E1 与 E4 视觉上完全相同，E3 低约 2 device px。

我第一次裁的 Menlo 窗口位置错了，截到的是 finite 文字结尾的 “et”，之后按几何重新计算位置并重裁。其余 PNG 没有逐张看。

## 是否具备进入 production 适配的资格，以及下一轮的最小方案（本批不实施）

- **模式检测：具备。** P1 只需一次普通 DOM 布局探测（0.01 px 偏移测得 0 还是 0.0078125）就能区分“仿真 / CSS 尺度布局”和“真实 / device 尺度布局”。不需要 UA，只在进入画布时测一次，按 DPR 缓存，当 `matchMedia(resolution)` 变化时失效。不要每帧探测。
- **绘制规则：不具备。** 真实 DSF 下，文字在 z1/fit 符合 device 网格，但 z2 有残差；矩形和旋转细条两种模型都不符合（y 不吸附，x 宽度规则未知）。改 GPU 之前，还需要针对 Blink 带小数 translate 的变换层的绘制吸附做更细的探测，例如单轴偏移扫描，以及 translate 为整数和小数的对照。
- SVG、receipt、frontend 的语义都不随 GPU profile 改变。
- **过去的结论需要重新审视：** 此前各轮用 Playwright 仿真 DSF2 得出的“GPU 与 HTML 一致”，只在仿真模式下成立，对真实 HiDPI Host 不成立。是否以真实 DSF 作为 GPU 的目标环境，需要主代理决策。

## 运行记录与清理

```sh
TMPDIR=/tmp/ds-host-harness-tmp npm run test:desktop -- /Users/admin/.codex/worktrees/codeshell-design-fidelity-host-build-20261107 \
  --app design-studio --design-studio-fidelity --design-studio-probe                               # E1：exit 3（probe 模式），25 s，2026-11-07T04:41Z
TMPDIR=/tmp/ds-host-harness-tmp npm run test:desktop -- … --design-studio-probe --design-studio-force-dsf 1   # E2：exit 3，23 s；实测 DPR 仍为 2
TMPDIR=/tmp/ds-host-harness-tmp node scripts/design-studio-snap-probe-headless.mjs --mode emulated-dsf2 --out /tmp/ds-host-harness-tmp/snap-emulated-dsf2   # E3：exit 0，被拦请求 0
TMPDIR=/tmp/ds-host-harness-tmp node scripts/design-studio-snap-probe-headless.mjs --mode forced-dsf2 --out /tmp/ds-host-harness-tmp/snap-forced-dsf2       # E4：exit 0，被拦请求 0
```

- E1 和 E2 的 owned Electron 都已退出，临时 HOME 已删除（`panel-desktop-ipc-*` 不存在）；operator 的 Electron/CodeShell 进程集合在每次运行前后都一致（diff 为空）。headless 结束后没有残留浏览器进程。Panel 的 `apps/` 未改；Host checkout 的 git status 干净。
- 原始数据：
  - E1 报告：`/private/tmp/ds-host-fidelity-1794026461340-8f96893ec824c160.report.json`，bundle 是同名 `.artifacts.bin`（`snap-z1/z2/fit` 三张）；
  - E2：`/private/tmp/ds-host-fidelity-1794026542931-93325161b3c91fe2.report.json`；
  - E3、E4：`/tmp/ds-host-harness-tmp/snap-{emulated,forced}-dsf2/`，包含 `snap-probe.json` 和 PNG；
  - 裁剪图：`/tmp/ds-host-harness-tmp/snap-e1/snap-crops-*/`；
  - 汇总脚本（只读，不在仓库中）：`/tmp/ds-host-harness-tmp/tools/{summarize-snap,cross-env-snap,snap-crops}.mjs`。
