# Design Studio 渲染保真 R009（2026-11-07）

**状态：真实旋转 AA 的有界 GPU 候选通过；整体样本视觉验收仍 BLOCKED。** 77 个真实旋转 source nodes × 四主矩阵的 GPU/HTML isolation 共 616 unique rows，308 个 GPU comparison 的 geometry/pixel gate 均通过。SVG235 严格语义核验未证明可登记项；其余历史限制没有借本轮抹除。未宣告 Goal complete。

分支 `codex/design-studio/render-fidelity-r009-20261107`，base `b3cfdf572ed10423a625cb6e114b5e73597e3648`（含前八轮）。已读 CODESHELL、CONTRIBUTING(npm)、R008 acceptance、实际 renderer、A1 与 pixel metrics；使用用户指定独占 worktree/base，无 fetch/push/merge/PR/发布/安装。仅改 Design Studio 与必要 tests/docs；未改 Host、其他 Panel、lock、安装包、共享账本、凭证、用户 tab 或用户稿。安装版 0.23.0 未更新。

依赖独立 `npm ci --cache .tmp/npm-cache --prefer-offline` exit0，node_modules 非 symlink。采集仅专属本地 Chromium/context、离线 route；fixture 外请求拒绝。没有全页大矩阵。actual-editor matrix 沿用既有 Chromium 148.0.7778.96 / ANGLE SwiftShader WebGL2 参数，便于与 R008 同路对照；小 spike 与四张实际视觉图使用本地 ANGLE Metal / Apple M4 Pro。此处 GPU 指 CanvasKit WebGL2 路径，不据 SwiftShader 数据声称物理 GPU 性能。全部本轮证据位于本 cwd `.tmp/render-fidelity-r009/`，不提交。

只读真实源：`/Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json`，SHA-256 `91d877f8dbb28dce4c698b850c0db7455be2471c9d052f5cdf138c35f47dfc24`，采集及 replay 后核对未变。旧 R008 raw 仅只读 `/Users/admin/.codex/worktrees/panels-design-render-fidelity-r008/.tmp/render-fidelity-r008/`；其 visual receipt 引用的 R007 PNG 也只读。

## P0 → P1 → P2 实测选择

真实 77 个旋转矩形有 19 个带方向的 [width,height,radius,angle] 签名，不是恰好八种。小 spike 选每种真实小数 position 的代表，另补指定 android-chat-43 重复形状，共 20 cases × DPR1/2 = 每方案 40 comparisons；涵盖 .42/.49/.595 radius、±40/45°、更长的真实 check strip 等。HTML 保留原 ancestry/layout；GPU 使用实际 browserPaintBoxes rule-e box 与 LU pivot。没有改几何或 radius 来抵消 AA。

P0 当前 drawRRect；P1 同圆角几何的原生 CanvasKit SVG-arc Path/drawPath；P2 Canvas2D.roundRect 在真实 device phase 栅格后 1:1 贴回 GPU，不再 GPU 外旋转。

| 方案 | pass | geometry fail | pixel fail | max abs ΔL | max abs ΔT | max centroid | max endpoint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| P0 | 4/40 | 36 | 32 | 0.763705 | 1.003359 | 0.160446 | 0.106467 |
| P1 | 36/40 | 2 | 4 | 0.847722 | 0.131172 | 0.247595 | 0.193433 |
| P2 | 40/40 | 0 | 0 | 0.446925 | 0.159599 | 0.165664 | 0.089561 |

所有单位为 device px。固定 A1 门禁 `|ΔL|≤.5, |ΔT|≤.35, centroid≤.5, endpoint≤.5`；像素沿用 raw 或 geometry-pass AA-qualified 的 mismatch≤.001、cluster≤6。二阶矩、ROI 算法、负控、AA kernel 与门禁均未改。

P1 未够：web-chat-110 DPR1 ΔL −.703432；web-chat-37 DPR1 −.847722；web-chat-32/android-chat-43 DPR2 geometry 过但 raw/既有 AA pixel gate 均失败。因此选择首个全过的 **P2**。完整逐 case geometry/pixel、DOM box/pivot、PNG path 在 `rounded-aa-spike/spike.json`。首次宽 ROI 误纳 ancestor surface 的脚手架结果移至 `rounded-aa-spike-wide-roi-invalid/`，明确无效、不作 GPU 限制证据；修正为既有 rotationMomentRoi 后重采，最终 `rounded-aa-spike-final.log` exit0。早期 Path.addRRect API 错误日志保留。

## 唯一 production 修复及边界

`canvaskit-shape-raster.mjs` 仅接收无 children 的旋转 rectangle/frame/component leaf，原 CSS 尺寸均≤64、single solid fill、无 gradient/shadow/stroke。原 radius 传给 Canvas2D.roundRect；使用实际 rule-e paint box、LU pivot 及完整 ancestor→leaf 旋转链。生成透明 coverage 后上传为 CanvasKit Image，destination 落在整数 device lattice，Nearest 1:1 draw；renderer 在该分支跳过外层 rotateChain，避免双旋转。

ancestor clip、node/ancestor opacity 仍由外层处理；fill opacity 只在 coverage 内处理。author node、editable geometry、hitTest/overlay、HTML/SVG 导出语义未变；文档没有节点转图片。实例重放以 instanceId 明确 bypass P2，保留原路径。

复用既有 device sampling 开关、150ms gesture idle 与 display list 更新时机。手势及中途 chrome repaint 复用旧图，停止后精确重采样。cache key 包含 paint geometry/原 radius、pivot/旋转链、实际 physical scale 与 device pan phase；整数平移复用，fractional phase/zoom 改变替换；每 leaf 至多一张，离屏/场景删除/资源释放/dispose 释放。小图不新增独立无限 cache。

shape reservation 直接计入现有 text **64 MiB** raster 预算；共享总量由 `sharedRasterCacheBytes/sharedRasterReservedBytes/sharedRasterCacheBudgetBytes` 报告。文字 master/quality/device 计划优先，压力时释放 shape 并强制重录；shape 超预算或 raster 不可用则 P0 fallback，记录 `shapeRasterFallbacks`。没有另加 64 MiB。捕获中最大 shape 420 pixels（1680 bytes），最大 text 1,771,824 bytes，最大共享 reservation 1,773,504 bytes。

新增回归证明：原 radii、完整 transform order、整数 pan hit、phase/scale 替换、budget denial/make-image failure/oversize fallback、shared text callback eviction、scene/dispose；真实 renderer 证明 clip、父子 opacity 仅一次、hitTest、文档不变、gesture 无新 build、settled RGBA 与静态一致。共享压力测试填满剩余64MiB、再1pixel拒绝，文字 device admission 释放 shape 并保持自身可用。helper 四项 unit 已接入 Design Studio suite。

## 定向四节点红绿与 77×4 实测

先用当前 production P0 捕获四节点×三矩阵：GPU12/12 red、HTML12 self-pass、route error0/unavailable0。接入 P2 后及最终代码冻结后的重采均 GPU12/12 green，1 raw pixel fail 保留为既有 AA-qualified。下表为冻结代码的有符号 ΔL/ΔT；没有将采集 test exit0 当视觉通过。

| 节点 | matrix | P0 ΔL/ΔT | P2 ΔL/ΔT | gate fail |
| --- | --- | ---: | ---: | ---: |
| android-chat-43 | dpr1-zoom1 | 0.577326/0.921023 | -0.280420/0.141007 | 0 |
| android-chat-43 | dpr1-zoom2 | 0.713086/0.308683 | -0.133207/-0.093549 | 0 |
| android-chat-43 | dpr2-zoom1 | 0.713086/0.308683 | -0.133207/-0.093549 | 0 |
| web-chat-110 | dpr1-zoom1 | 0.435004/0.881497 | -0.289491/0.089050 | 0 |
| web-chat-110 | dpr1-zoom2 | 0.665735/0.331863 | -0.219703/-0.047360 | 0 |
| web-chat-110 | dpr2-zoom1 | 0.665735/0.331863 | -0.219703/-0.047360 | 0 |
| web-chat-167 | dpr1-zoom1 | 0.620236/0.992766 | -0.213907/0.142125 | 0 |
| web-chat-167 | dpr1-zoom2 | 0.580461/0.350317 | -0.151168/-0.113716 | 0 |
| web-chat-167 | dpr2-zoom1 | 0.580461/0.350317 | -0.151168/-0.113716 | 0 |
| web-chat-32 | dpr1-zoom1 | 0.577326/0.921023 | -0.280420/0.141007 | 0 |
| web-chat-32 | dpr1-zoom2 | 0.713086/0.308683 | -0.133207/-0.093549 | 0 |
| web-chat-32 | dpr2-zoom1 | 0.713086/0.308683 | -0.133207/-0.093549 | 0 |

DPR1/z1 web-chat-167 的 HTML Teff 1.207284 → P0 GPU 2.200051 → P2 GPU 1.349409；ΔT .992766 → .142125。root 实际看见的额外外晕明显收窄，与指标相符，仍保留像素 AA 差别。

随后只跑真实77×四矩阵 GPU/HTML isolation。test runner 新增显式 isolation-only/requested routes，跳过 full-page metric tiles、browser/SVG；同 camera 先取未隔离 HTML DOM bounds，再取隔离 bounds 验证 target/ancestors 布局不变，等待原字体就绪。显式断言所有 target 存在，expected616=actual616，missing=[]，unique按(page,node,route,matrix)。308 isolation captures、0 raw全页comparisons、routeerror0、unavailable0、partial0、unmeasured0。

| Matrix | GPU rows | unique fail | raw pixel pass | AA qualified | max abs ΔL | max abs ΔT | max centroid | max endpoint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dpr1-zoom1 | 77 | 0 | 55 | 22 | 0.455736 | 0.177067 | 0.184061 | 0.087424 |
| dpr1-zoom2 | 77 | 0 | 71 | 6 | 0.332451 | 0.122509 | 0.099335 | 0.073909 |
| dpr2-zoom1 | 77 | 0 | 71 | 6 | 0.332451 | 0.122509 | 0.099335 | 0.073909 |
| dpr2-zoom1-fractionalpan | 77 | 0 | 73 | 4 | 0.318355 | 0.147287 | 0.121580 | 0.096148 |

GPU合计270 raw pixel pass +38 AA-qualified =308 gate pass；HTML308 self-comparisons全过。38 raw pixel fail 的原值及PNG保留，不称 raw pixel 一致。四矩阵覆盖有符号逐nodeΔL/ΔT见本文末77行，完整616行、bbox、centroid、endpoint、pixel qualification、raw path见 `rotation77-summary.json` 与 `rotation77/report.json`。采集命令真实exit0、UTC与环境在 `rotation77-command.json`。

77采集与文字预算守门的最后补强有时间重叠；renderer/shape路径不变，所有捕获共享reservation远低64MiB，新增压力分支不适用。没有声称这些raw从开始即冻结到最终文字源码。最终冻结源码hash在 `source-freeze.json`，四指定节点随后对冻结代码重新捕获于 `green-frozen/` 并通过，压力分支另有独立测试。未重复77矩阵消耗预算。

## 实际图像观察与默认像素路径

根执行者实际打开了四张 production 8× nearest 对照（GPU左、HTML右），并只读打开 R008 DPR1/z1 的旧 mark/chevron 对照。新 DPR1/z1 与 z2 的真实 chevron / `>_` 没有旧 drawRRect 那种明显的浅色加胖外晕；两路仍有少量 AA 覆盖差别。本观察仅适用于这些小图，不代表全样本通过。

- `visual/dpr1-zoom1-{mark,chevron}-gpu-left-html-right-nearest8x.png`
- `visual/dpr1-zoom2-{mark,chevron}-gpu-left-html-right-nearest8x.png`
- 对应原像素 `visual/dpr1-zoom{1,2}-{mark,chevron}-{gpu,html}.png`，64×64 viewport raw、crop位置、camera、RGBA/PNG SHA、实际renderer stats见 `visual/receipt.json`。
- 默认真实DPR1/z1 isolation：`rotation77/dpr1-zoom1-web-chat-isolation-web-chat-{167,110,32}/{gpu,html}.png`；z2同路径换 `dpr1-zoom2`。android-chat-43 对应 `...-android-chat-isolation-android-chat-43/`。

visual groups 保留原parent children与ancestor fill/clip/layout：mark=web-chat-99（96/97/98），chevron=web-chat-112（110/111）。每组真实 WebGL2 renderer 两个 shape raster；四小图 pageerror0、外部请求0，未操作用户 tab。

## SVG235：保留精确矢量，严格边界未证明

`r009-svg-semantic-replay.mjs` 只读 R008 `final-real-rows.json`，独立重建 exact-vs-snapped uniform rounded-ring inner/outer contour，逐现存 matched normal 求交。centroid bound 为两对应边界位移的最大值；width bound 为 exact/snapped interval长度变化的绝对值。每个raw字段同时要求 `|SVG−HTML|≤对应bound+.1 devicepx` 且≤.5CSSpx。原 SVG 坐标与 raw 失败不动，CSS dual-shadow proof 来自未改 frontend-export 的离线重建，并非 fresh computed-style。

235旧“stroke”rows实际为156 stroke（41 source nodes）+79 fill-only（32 source nodes）。检查4982 probes/9964 fields：**0/235证明可登记，235保留**。156 stroke rows均有width对应界超限，58另有centroid超限，30另超.5CSS；79 fill-only无stroke probes，记未证明。1674对应界字段超限=151 centroid+1523width；99字段超.5CSS。未匹配的10条旧 rays 保留原因，未计通过。

| Matrix | 原 rows | 合格登记 | 超界/未证明 |
| --- | ---: | ---: | ---: |
| DPR1 z1 | 57 | 0 | 57 |
| DPR1 z2 | 60 | 0 | 60 |
| DPR2 z1 | 60 | 0 | 60 |
| DPR2 fractionalpan | 58 | 0 | 58 |

可证伪例：android-chat-92 DPR1/z1 fraction.375，raw centroid −.6363184152devicepx，独立snap bound .4994475399、加.1允许.5994475399，且超过.5CSS。android-chat-11 fraction.46875 的width .1193713724，独立长度变化 .0004609493、允许.1004609493，仍超界。早期较松的双端点位移和 envelope 曾给87行，只作弃用诊断，未用于登记。

全部逐probe exact/snapped interval、bounds、原 failures/路径在 `svg/semantic-boundary.json`；未证明source identities、最大超界在 `svg/summary.json`，命令receipt与7assert自检在 `svg/command-receipt.json`、`svg/HANDOFF.md`。未将所有SVG无条件排除，也未追求通过破坏矢量坐标实现HTML像素相同。

## 实际命令与验收边界

本轮脚手架最初误启动一次旧四路/full-tile定向命令，发现模式不符后主动中断，`red.log`保留；它不提供通过证据。使用新增 isolation-only 后的 red/green/77均为实际完成命令。check在测试接线收尾前曾主动中断，`check-interrupted-finalization.log`保留，不计通过、不作分段续跑。

最终 `npm run check` **一次完整原样执行 exit0**：4092 tests / 4083 pass / 0 fail / 9 skip / 0 cancelled。Design Studio suite 为1494 /1489 /0 /5；不是分段续跑结果。UTC 2026-11-07T00:23:38.654Z..2026-11-07T00:35:38.719Z，日志 `check.log` SHA-256 `2ca119b5658849993a4642797f4945b2cd627f03fcf67dd5b4b22ecbb94e2fad`。随后 `npm run validate` 实际exit0，UTC 2026-11-07T00:35:38.730Z..2026-11-07T00:35:41.871Z，日志 `validate.log` SHA-256 `194ac30cc931eedfada05c36180fa9b47a3f61e2cc96254f50830a356295b291`。完整 argv、exit、时间、effectiveTmpdir 在 `validation-receipt.json`。该命令继承主机默认 `TMPDIR=/var/folders/1d/6__4f4y51g90nblfptt8s9v80000gn/T/`，仓库外，不创建嵌套type:module CJSfixture，不改应用或其他Panel掩盖环境。

```sh
npm run check
npm run validate
```

定向测量/文字合同组合30/30 pass；shape 两项真实renderer回归2/2 pass；helper四项unit pass；SVG replay self-test七项assert pass。日志分别为 `focused-tests.log`、`shape-regression-frozen.log`、`shape-raster-unit.log`、`svg-self-test-final.log`。

实际定向命令均exit0：

```sh
npm ci --cache .tmp/npm-cache --prefer-offline
node tests/apps/design-studio/rotation-rounded-aa-spike.mjs
node --test tests/apps/design-studio/canvaskit-shape-raster.test.mjs tests/apps/design-studio/render-fidelity-audit.test.mjs tests/apps/design-studio/render-fidelity-geometry.test.mjs tests/apps/design-studio/rotation-moment-roi.test.mjs tests/apps/design-studio/resource-text-raster.test.mjs tests/apps/design-studio/text-line-box.test.mjs tests/apps/design-studio/text-origin-compatibility.test.mjs
node --test --test-name-pattern='shared raster pressure|small rotated leaf sampling' tests/apps/design-studio/canvaskit-cache.test.mjs
node --max-old-space-size=2048 tests/apps/design-studio/r009-svg-semantic-replay.mjs /Users/admin/.codex/worktrees/panels-design-render-fidelity-r008/.tmp/render-fidelity-r008 .tmp/render-fidelity-r009/svg /Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json
node tests/apps/design-studio/r009-svg-semantic-replay.mjs --self-test
node .tmp/render-fidelity-r009/capture-77.mjs
node .tmp/render-fidelity-r009/summarize.mjs
```

采集器实际命令为 `node --max-old-space-size=8192 --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs`；DESIGN_FIDELITY_MODE=diagnostic、ISOLATION_ONLY=1、ROUTES=gpu,html、REAL_FIXTURE上述源、APP_DIR本cwd/app、EVIDENCE本轮目录；定向4ids与77ids、四matrix的完整env/argv在 `rotation77-command.json`（四节点为去除fractionalpan、限定pages及4ids）。诊断test exit0仅表示完成采集，实际visual条件由保留的gate/summary机械复核。

不新增/重拍 finite DPR1 golden 或文字全矩阵，历史证据照旧；未称 finite/plain/range/multiline全部通过。仍未cover：native ranges、stroked text、image-fit、ellipse AA、NodeSVG central、SVG shadow、multiline/plain-range finite/editor。R008 的 SVG rotation 224 unique 残留与 synthetic 23 unique 残留未在本轮重新全面验收；native finite halfzoom norm .959291 的历史限制仍保留，不能用本轮旋转通过覆盖。large文字低zoom cache bypass性能本轮未cover；1208无字fixture不能证明该性能。shared-budget/gesture小回归不是大文档文字性能验收。

本轮有界修复及内部只读review不能替代同CC独立复审、相对最初base的累计code review、真实Host隔离验收；这些仍待执行。整体样本视觉仍BLOCKED，未更新已安装0.23.0，未宣告Goalcomplete。

## 77 source nodes × 四矩阵完整GPU结果

每格为有符号 `ΔL/ΔT` devicepx，保留三位供阅读，完整精度在JSON。`A`标原rawpixel失败、既有geometry-pass AA-qualified；未标者rawpixel通过。每行fail/4均由未放宽的unique gate计算；HTML对应308行均self-pass。

| Source node | DPR1 z1 ΔL/ΔT | DPR1 z2 ΔL/ΔT | DPR2 z1 ΔL/ΔT | DPR2 fractionalpan ΔL/ΔT | GPU fail/4 |
| --- | ---: | ---: | ---: | ---: | ---: |
| android-chat-33 | -0.456/0.047 A | -0.163/-0.025 | -0.163/-0.025 | -0.174/-0.033 | 0 |
| android-chat-34 | -0.382/-0.010 A | -0.166/-0.024 | -0.166/-0.024 | -0.318/-0.041 A | 0 |
| android-chat-42 | -0.311/-0.065 A | -0.218/-0.105 | -0.218/-0.105 | -0.199/-0.047 | 0 |
| android-chat-43 | -0.280/0.141 | -0.133/-0.094 | -0.133/-0.094 | -0.094/-0.109 | 0 |
| android-chat-47 | -0.173/-0.047 | -0.237/0.085 | -0.237/0.085 | -0.181/0.004 | 0 |
| android-chat-48 | -0.199/-0.046 | -0.248/0.102 | -0.248/0.102 | -0.182/0.008 | 0 |
| android-chat-54 | -0.161/-0.001 | -0.039/-0.071 | -0.039/-0.071 | -0.127/0.035 | 0 |
| android-chat-55 | -0.185/-0.057 | -0.165/0.059 | -0.165/0.059 | -0.119/0.009 | 0 |
| android-chat-66 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| android-chat-67 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.160/-0.053 | 0 |
| android-chat-78 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| android-chat-79 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.160/-0.053 | 0 |
| android-chat-83 | -0.076/0.057 | -0.113/-0.050 | -0.113/-0.050 | -0.116/-0.057 | 0 |
| android-chat-84 | -0.081/0.026 | -0.111/-0.061 | -0.111/-0.061 | -0.120/-0.063 | 0 |
| android-panels-38 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| android-panels-39 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.160/-0.053 | 0 |
| android-panels-48 | -0.316/-0.061 | -0.213/-0.106 | -0.213/-0.106 | -0.202/-0.054 | 0 |
| ios-chat-32 | -0.456/0.047 A | -0.163/-0.025 | -0.163/-0.025 | -0.174/-0.033 | 0 |
| ios-chat-33 | -0.382/-0.010 A | -0.166/-0.024 | -0.166/-0.024 | -0.318/-0.041 A | 0 |
| ios-chat-41 | -0.316/-0.055 A | -0.211/-0.087 | -0.211/-0.087 | -0.171/-0.033 | 0 |
| ios-chat-42 | -0.280/0.141 | -0.133/-0.094 | -0.133/-0.094 | -0.094/-0.109 | 0 |
| ios-chat-46 | -0.173/-0.047 | -0.237/0.085 | -0.237/0.085 | -0.181/0.004 | 0 |
| ios-chat-47 | -0.199/-0.046 | -0.248/0.102 | -0.248/0.102 | -0.182/0.008 | 0 |
| ios-chat-53 | -0.161/-0.001 | -0.039/-0.071 | -0.039/-0.071 | -0.127/0.035 | 0 |
| ios-chat-54 | -0.201/-0.054 | -0.161/0.064 | -0.161/0.064 | -0.115/0.015 | 0 |
| ios-chat-65 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| ios-chat-66 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.160/-0.053 | 0 |
| ios-chat-77 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| ios-chat-78 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.160/-0.053 | 0 |
| ios-chat-82 | -0.076/0.057 | -0.113/-0.050 | -0.113/-0.050 | -0.116/-0.057 | 0 |
| ios-chat-83 | -0.081/0.026 | -0.111/-0.061 | -0.111/-0.061 | -0.120/-0.063 | 0 |
| ios-panels-37 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| ios-panels-38 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.160/-0.053 | 0 |
| ios-panels-47 | -0.316/-0.061 | -0.213/-0.106 | -0.213/-0.106 | -0.202/-0.054 | 0 |
| web-chat-110 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| web-chat-111 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.160/-0.053 | 0 |
| web-chat-16 | -0.340/0.004 | 0.062/-0.026 | 0.062/-0.026 | -0.158/-0.049 | 0 |
| web-chat-160 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| web-chat-161 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.160/-0.053 | 0 |
| web-chat-166 | -0.224/0.168 | -0.181/-0.123 | -0.181/-0.123 | -0.174/-0.147 | 0 |
| web-chat-167 | -0.214/0.142 | -0.151/-0.114 | -0.151/-0.114 | -0.166/-0.138 | 0 |
| web-chat-17 | -0.442/0.006 A | -0.332/-0.030 A | -0.332/-0.030 A | -0.167/-0.028 | 0 |
| web-chat-170 | -0.185/0.177 | -0.113/-0.115 | -0.113/-0.115 | -0.122/-0.137 | 0 |
| web-chat-171 | -0.192/0.153 | -0.108/-0.114 | -0.108/-0.114 | -0.114/-0.140 | 0 |
| web-chat-193 | -0.081/0.053 | -0.115/-0.049 | -0.115/-0.049 | -0.116/-0.060 | 0 |
| web-chat-194 | -0.090/0.027 | -0.108/-0.059 | -0.108/-0.059 | -0.116/-0.065 | 0 |
| web-chat-31 | -0.311/-0.065 A | -0.218/-0.105 | -0.218/-0.105 | -0.199/-0.047 | 0 |
| web-chat-32 | -0.280/0.141 | -0.133/-0.094 | -0.133/-0.094 | -0.094/-0.109 | 0 |
| web-chat-36 | -0.173/-0.047 | -0.237/0.085 | -0.237/0.085 | -0.181/0.004 | 0 |
| web-chat-37 | -0.199/-0.046 | -0.248/0.102 | -0.248/0.102 | -0.182/0.008 | 0 |
| web-chat-43 | -0.151/-0.019 | -0.059/-0.093 A | -0.059/-0.093 A | -0.140/0.013 | 0 |
| web-chat-44 | -0.185/-0.057 | -0.165/0.059 | -0.165/0.059 | -0.119/0.009 | 0 |
| web-chat-55 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| web-chat-56 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.160/-0.053 | 0 |
| web-chat-78 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| web-chat-79 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.159/-0.053 | 0 |
| web-chat-83 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| web-chat-84 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.159/-0.053 | 0 |
| web-chat-96 | -0.104/-0.053 | -0.252/-0.059 A | -0.252/-0.059 A | -0.258/-0.062 A | 0 |
| web-chat-97 | -0.111/-0.042 | -0.252/-0.061 A | -0.252/-0.061 A | -0.258/-0.064 | 0 |
| web-panels-100 | -0.111/-0.042 | -0.252/-0.061 A | -0.252/-0.061 A | -0.258/-0.064 | 0 |
| web-panels-113 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| web-panels-114 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.160/-0.053 | 0 |
| web-panels-163 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| web-panels-164 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.160/-0.053 | 0 |
| web-panels-169 | -0.224/0.168 | -0.181/-0.123 | -0.181/-0.123 | -0.174/-0.147 | 0 |
| web-panels-17 | -0.289/0.089 A | -0.220/-0.047 | -0.220/-0.047 | -0.154/-0.050 | 0 |
| web-panels-170 | -0.214/0.142 | -0.151/-0.114 | -0.151/-0.114 | -0.166/-0.138 | 0 |
| web-panels-173 | -0.185/0.177 | -0.113/-0.115 | -0.113/-0.115 | -0.122/-0.137 | 0 |
| web-panels-174 | -0.192/0.153 | -0.108/-0.114 | -0.108/-0.114 | -0.114/-0.140 | 0 |
| web-panels-18 | -0.287/0.105 | -0.199/-0.062 | -0.199/-0.062 | -0.160/-0.053 | 0 |
| web-panels-196 | -0.081/0.053 | -0.115/-0.049 | -0.115/-0.049 | -0.116/-0.060 | 0 |
| web-panels-197 | -0.090/0.027 | -0.108/-0.059 | -0.108/-0.059 | -0.116/-0.065 | 0 |
| web-panels-36 | -0.229/-0.134 | -0.239/0.012 | -0.239/0.012 | -0.154/-0.067 | 0 |
| web-panels-93 | -0.185/0.177 | -0.113/-0.115 | -0.113/-0.115 | -0.122/-0.137 | 0 |
| web-panels-94 | -0.192/0.153 | -0.105/-0.112 | -0.105/-0.112 | -0.112/-0.139 | 0 |
| web-panels-99 | -0.104/-0.053 | -0.252/-0.059 A | -0.252/-0.059 A | -0.258/-0.062 A | 0 |
