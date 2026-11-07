# Design Studio 渲染保真 R008（2026-11-07）

**状态：BLOCKED checkpoint。finite raster halfzoom 两项退化已修复；真实旋转二阶矩、SVG 与 synthetic 残留、native halfzoom 限制仍红。未宣告样本视觉通过或 Goal complete。**

分支 `codex/design-studio/render-fidelity-r008-20261107`，base `981321f4`（含前七轮）。
已读 `CODESHELL.md`、`CONTRIBUTING.md` 和 R007 acceptance；使用用户指定的独占 cwd/branch/base，无 fetch、push、merge、PR、发布或安装。
仅写本 cwd Design Studio、必要 tests/docs 与 `.tmp/render-fidelity-r008/`。未改用户稿、Host、其他 Panel、lock、安装包、共享账本或用户 tab；未使用凭证或外部写入。
依赖用 `npm ci --cache .tmp/npm-cache --prefer-offline` 独立安装，node_modules 非 symlink；未执行 audit fix。浏览器采集仅本地专属 Chromium/context、fixture 外请求拒绝。

旧 R007 raw 只读根目录：`/Users/admin/.codex/worktrees/panels-design-render-fidelity-r007/.tmp/render-fidelity-r007/`。
只有 finite halfzoom 对照读 R006 同类目录的 `finite-half/`；未重拍 baseline、改 golden 或跑大矩阵。
真实六页只读源 `/Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json`，SHA-256 `91d877f8dbb28dce4c698b850c0db7455be2471c9d052f5cdf138c35f47dfc24`。
所有下文新证据相对本 cwd `.tmp/render-fidelity-r008/`，旧图路径标 R007；`.tmp` 不提交。

## 本轮唯一生产改动与 fresh 小采

`apps/design-studio/app/canvas/canvaskit-renderer.mjs` 中 finite raster device-origin admission 从
`physicalScale > 1 || physicalScale === 1 && integerPan` 改成 `physicalScale !== 1 || integerPan`。
`!candidate.legacyOrigin` 的 no-offset 分支不变；native `deviceOnly && scale <= 1` 的旧拒绝语义仍由 `canvaskit-text.mjs` 保持。
scale≥1 的谓词等价；只让 finite RASTER 在 scale<1 使用实际 device phase，避免 2× master 下采样。

定向 renderer 守门红 1 pass/1 fail → 绿 2/2；覆盖 half→1 fractional→1 integer→2→half 的缓存转换、no-offset 与 native 分支。
resource/text-line/origin 相关 unit 13/13。fresh 仅 synthetic `variants` 页、3 finite 节点、DPR1 z.5/z1，共六个 isolation；沿用 runner 固定四 routes，共 24 unique diagnostic rows，route error0、unavailable0。
采集测试 exit0/1 test pass 仅表示完成采集，不表示下面 native 通过。

| 节点 | pre-R006 norm | R006/R007 norm | R008 X / Y / norm（device px） | R008 mismatch / 分母；cluster | mean channel error R006→R008 | 严格 geometry |
| --- | ---: | ---: | --- | --- | --- | --- |
| finite-offset | .1067132331 | .2605731365 | .0009622404 / .0005123982 / .0010901644 | 0 / 5920；0 | 1.3240287162→.0146959459 | 0 fail |
| finite-offset-negative | .3488358543 | .3989017519 | .0022010397 / .0005852470 / .0022775184 | 0 / 6068；0 | 1.5894858273→.0121127225 | 0 fail |
| finite-offset-native | .9592911402 | .9592911402 | .3770931793 / −.8820658851 / .9592911402 | 132 / 3256；34 | 3.7089987715→3.7089987715 | top −2、centroidY −.8821；2 fail |

正/负 Arial 的质心 norm、绝对 Y、max edge、mismatch count/ratio、cluster、mean channel error 相较 R006 与 R007 保存的 pre-R006 指标均不增；两项 centroid≤.5 且 geometry0fail。
三个 HTML reference 完整解码 RGBA 与旧 halfzoom 一致。native 完整 GPU RGBA 与旧 raw 一致，但不满足本轮 .5 centroid，登记 **1 unique `UNCHANGED_NATIVE_HALFZOOM_LIMIT`，BLOCKED**；原 diagnostic geometryFailures=[] 与另算 strict failures 同时保留，未将空数组当 pass。

DPR1/z1 三 GPU isolation 的尺寸、完整解码 RGBA `Buffer.compare`、RGBA SHA 和 ROI crop SHA 全与 R007 原图一致：

| 节点 | 旧/新完整 RGBA SHA-256 |
| --- | --- |
| finite-offset | `fb45f7a537731f1d3ede819a4c4cefa05a82a922d287862f5bc4378e01d107b0` |
| finite-offset-negative | `cc955edc5a37424de43e64c3be4d53ce13c7d23f20f4fd3396d6881046f3316d` |
| finite-offset-native | `19387b85aa0f15488bd7da89c9ce546b027e46ffe10fd87e5881cb8edded4ad2` |

逐指标、old/new 图路径和独立 PNG 重算见 `finite/receipt.json`、`finite/HANDOFF.md`。未覆盖 finite 正负 fill/link ranges 和 multiline GPU/SVG raster parity，不称 finite 全部通过。

## A1：只读 raw 的二阶矩与整数 bbox

对原 coverage covariance 求 `λmajor/minor=(trace±hypot(xx−yy,2xy))/2`，`Leff=sqrt(12λmajor)`、`Teff=sqrt(12λminor)`。
门禁保持 `|ΔL|≤.5`、`|ΔT|≤.35`、centroid≤.5、endpoint≤.5 device px；integer ink bbox 每边差≤1，原 bbox 数值完整保留。
短圆角 strip 的离散 AA 二阶矩是 coverage-equivalent 尺寸，不能直接解释成物理线宽；这个局限不构成豁免，超界仍 BLOCKED。

strict4 真旋转为 77 source nodes×4 matrices×4 routes=1232 unique；全部有 bounded raw moments。GPU 260/308 geometry fail（77 source nodes）：length197、thickness116，交集53；centroid、endpoint、bbox fail均0。
SVG 252/308 geometry fail（74 source nodes）：length69、thickness41、centroid226、integer bbox18，类别可重叠；endpoint0。browser/HTML geometry0fail。

| GPU matrix | geometry fail / 77 |
| --- | ---: |
| DPR1/z1 | 68 |
| DPR1/z2 | 76 |
| DPR2/z1 | 76 |
| DPR2/fractionalpan | 40 |

| GPU device px | min | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| ΔL | .010101 | .577326 | .713086 | .763905 |
| ΔT | .091029 | .326894 | .881497 | 1.013441 |
| centroid | .004871 | .042524 | .110245 | .157821 |
| endpoint | .000236 | .025175 | .090612 | .093556 |

area 最大 `1.22895266` 的 `web-chat-167/171`、`web-panels-170/174`：HTML Teff `1.2072843543`→GPU `2.2000506586`，ΔT `.9927663043`、ΔL `.6202355601`，两门禁均红。
这四项及其余超界逐 node 登记为 Skia subpixel/rounded-strip coverage 限制，**不是 AA pass**。
旧黑色无圆角 spike32/32 在新矩门禁通过（max|ΔL| `.0906494`、max|ΔT| `.0218870`），不能外推真实灰色圆角77节点。

| raster 负控 | 实测 | 结果 |
| --- | --- | --- |
| length +1 device px | ΔL 1.0017406 | ΔL fail |
| thickness +.5 device px | ΔT .4825974 | ΔT fail |
| translation 1 device px | centroid 1.0000000 | centroid fail |
| 30 device px 条 +2° | endpoint .5219971 | endpoint fail |

完整1232项 λ/Leff/Teff、signed/absolute ΔL/ΔT 分布、逐 node/矩阵、raw bbox/area/PNG path 在 `moments/rotation-moments.json`；每个失败 GPU node 的最大值附于本文末。
`moments/real-moment-audited-report.json` 是旧 fresh report 的离线派生，未改变原图或原报告。

## A2：frame own-region 与独立 ring

对所有完整、已独立测量、reference/actual ink bbox 有效的后代，使用两 bbox union +2 device px mask，不论 child pass/fail 或其他 geometry primary 是否可用。
child 独立结果完整保留。frame own fill 在剩余区域用原 shape geometry/pixel gate；stroke ring 完整独测，不应用 descendant mask。
原 composite mismatch runs/counters/PNG 保留；own 子集 mismatch ratio 和 cluster 机械重算，无法从旧 composite 聚合推导的子集 mean channel error 明记 null。
完全 mask 或 fill 无 RGB contrast 记不可观测，不能由 ROI 白色 padding 计 pass。

| 真实 strict4 frame 项 | 分母 / 结果 |
| --- | --- |
| frame unique rows | 1824（456/route） |
| 可观测 own fill | 1184 /1184 pass，geometry0fail |
| fill 不可观测 | 640，其中336有独立 ring，另304为原 same-fill |
| 独立 ring | 832 /832 pass，0 fail |
| frame row 有可测自身 paint | 1520；其中336仅 ring 可测，fill 仍非pass |
| 全无可测 own paint | 304，排除有效分母、不计pass |
| 原有效 composite fail | 265 = GPU64 + SVG201，原数据保留 |

原 GPU64/SVG157 未知 gate 为重复罚，在 own-region 不再阻塞；SVG另44旧已归因。未通过 child 没有因此消失。
masked area 合计 `219912750 device px²`，逐 row remaining ROI coverage `.3315649867.. .9663888889`；每项 maskedPixels、remainingPixels、nominal coverage 与 mask 来源在 `frame/real-frame-own.json`。
171 个透明结构 descendant 加19个既定 same-fill identity 无可独立 ink，保留原因，不记 child pass，也不将它们说成新可见 ink 遗漏。

synthetic frame48：own fill16/16通过、32项fill不可观测但ring仍独测；ring32中22 pass/10 fail（GPU5/SVG5：legacy-parent fractionalpan2、selector四矩阵8）。未在 A2 豁免。
负控：child区域外 frame fill改30channels→mismatch100/3952=`.0253036437`、cluster100 fail；stroke实际移1devicepx→独立 contour centroid1>.35 fail，即便 descendant mask 覆盖全部区域，ring1084 pixels仍独测。
详见 `frame/summary.json`、`negative-controls.json` 与完整两份 `*-frame-own.json`。

## A3：有限分类，不清除 raw

`HTML_DUAL_SHADOW_PHASE` 必须有未改 `frontend-export.mjs` 离线重建的 centered dual-shadow marker/CSS、fractional device phase、三路可测且逐一匹配的 stroke probes；每个 centroid/width 的 GPU–SVG 差≤.1，并有同一项 HTML 同时区别于二者>.1。
这是旧 raw 的 probe 归因与未变源码 CSS proof，**不是 fresh computed CSS 采集**。全部 raw failures 保留；其他 shadow/geometry/text failure 不被这项解释。
数值表附于本文末，完整逐 probe 数值和 CSS 在 `phase/{real,synthetic}.json`。real60组满足机械条件，多数本来通过；只有8个原失败 route rows 标此分类，其中4与既定7 seam重叠，净解释4个SVG残留。synthetic5组/10 route rows，含SVG shadow一行仍有不相关 shadow centroid失败。

SVG precise/rule-e 先撤销旧分类，再按 raw 重算，GPU/HTML geometry/gate/pixel 资格和所有数组必须齐全；缺项不通过。
原123个旋转 rule-e raw prediction residual≤.1仍逐项成立，但仅33个满足新增独立 GPU/HTML资格，90个撤销分类，留红；纯预测另列 `pass:false`，不能替代资格。
real 总266个SVG分类=233轴对齐+33 rule-e；synthetic4个轴对齐。没有 missing-GPU 分类。
其余 ellipse AA 只有 geometry pass 才登记限制：synthetic6项保留raw红为known exception；fractionalpan SVG ellipse自身bbox左右±1超过普通shape .5仍红，不适用旋转bbox规则。

## 分母、剩余红项与不可观测

unique 单位固定为 `(page,node,route,matrix)`；source nodes另行去重，不能将 source-node 数当 comparison 行数相加。
真实 strict4 raw10176；same-fill304不计pass，有效9872。每route raw2544/effective2468；新增frame fill不可观测的336仍有ring，因此不移除其可测ring。
synthetic strict4 raw/effective均752（188/route）。frame own/ring分母另列上表，互相有重叠，不能相加成frame行数。

| 离线阶段 | 真实 unique fail | synthetic unique fail |
| --- | ---: | ---: |
| A1/A3重算、A2 own-region后的门禁残留（raw未改） | 730（GPU267/SVG463） | 38（GPU18/SVG20） |
| 已登记有限分类后的残留 | **719（GPU260/SVG459）** | **23（GPU10/SVG13）** |

真实有限分类集合为7seams +8 A3，交集4，净11；synthetic A3解释9个完整失败行、另1个SVG shadow仅解释stroke，ellipse geometry-pass6项单列限制，故38→23。
这些归因不是重新采集或 raw pixel pass。

| 仍阻塞类别 | unique rows | source nodes | 说明 |
| --- | ---: | ---: | --- |
| 真实 rotation geometry/pixel | 484 | 77 | GPU260，SVG224；raw SVG geometry252中部分有合格 precise prediction分类 |
| 真实 SVG precise 未解释 stroke | 235 | 73 | 不满足逐probe预测/独立资格；未泛化 AA |
| synthetic ellipse geometry | 1 | 1 | SVG DPR2 fractionalpan |
| synthetic SVG round-icon stroke | 4 | 1 | 四矩阵，centroid仍超界 |
| synthetic selector ring | 6 | 1 | GPU/SVG各3；fractionalpan另2有A3有限分类 |
| synthetic SVG shadow / shadow-stack 未覆盖 | 5 | 2 | 原shadow centroid3 + shadow-stack geometry2；不是产品通过 |
| synthetic native ranges 未覆盖 | 4 | 1 | 原生 plain ranges |
| synthetic stroked text 未覆盖 | 3 | 1 | GPU z2、DPR2/z1、fractionalpan |
| fresh native halfzoom 限制 | 1 | 1 | norm .959291，字节未变，非pass |

不可观测原因：304行原 same-fill，19 source nodes；frame另336行fill无contrast/无剩余ink但ring可测，不能称fill通过；actual full-mask负控明确不可观测不pass。
机械 remaining coverage/nominal coverage 和每项原因在 frame JSON，剩余每个 key/failure/PNG path 在 `final-summary.json` 与 `final-{real,synthetic}-rows.json`。

主文字3712 unique gate0、旧finite24 strict geometry0fail、R007主routeerror0作为**历史采集证据保留**；本轮未重拍3712/24或六页大矩阵。
本轮 predicate 等价性与最小 cache/resource 守门检验相关路径不回归；不将历史数据改名fresh，不将离线归因等同重新采集。

## 实际图像观察

根执行者实际打开了下列图；没有操作用户tab，也没有逐页重看其余五页全部GUI：

- `visual/dpr1-zoom{1,2}-{chevron,mark}-gpu-left-html-right-nearest8x.png`：从R007 raw精确RGBA裁切，8×整数复制；GPU左、HTML右。位置/长度方向目视接近，GPU外缘浅色覆盖较宽，DPR1尤明显；不覆盖二阶矩失败。source/crop SHA与坐标在 `visual/receipt.json`。
- R007 `real-shard-1/dpr2-zoom1-fractionalpan-web-chat-0/{gpu,browser}-editor-gui.png`：两路正常GUI布局接近，100%；未据此宣告pixel通过。
- R007 `real-shard-1/dpr1-fit-view-web-chat-{gpu,browser}-actual-fit-gui.png`：66%实际fit，整体布局/正文接近；仍是原fit诊断，未替代全产品验收。
- fresh `finite/capture/dpr1-zoom05-variants-isolation-{finite-offset,finite-offset-native}/{gpu,html}.png`：正项对齐，native字形覆盖明显有差；与数值阻塞一致。

团队的只读交叉检查不是外部 CC 签字；CC 将独立 review。

## 实际命令与验证

```sh
npm ci --cache .tmp/npm-cache --prefer-offline
node --test tests/apps/design-studio/render-fidelity-audit.test.mjs tests/apps/design-studio/render-fidelity-geometry.test.mjs tests/apps/design-studio/rotation-moment-roi.test.mjs
node tests/apps/design-studio/rotation-moment-replay.mjs
node --max-old-space-size=8192 tests/apps/design-studio/render-fidelity-audit.mjs /Users/admin/.codex/worktrees/panels-design-render-fidelity-r007/.tmp/render-fidelity-r007/final-real/report.json .tmp/render-fidelity-r008/moments/real-moment-audited-report.json
node --test tests/apps/design-studio/render-fidelity-frame-own.test.mjs
node --max-old-space-size=4096 tests/apps/design-studio/r008-frame-replay.mjs /Users/admin/.codex/worktrees/panels-design-render-fidelity-r007/.tmp/render-fidelity-r007 .tmp/render-fidelity-r008/frame /Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json
node .tmp/render-fidelity-r008/frame/finalize-fields.mjs
node .tmp/render-fidelity-r008/frame/negative-controls.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r008/replay-phase.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r008/finalize-offline.mjs
```

以上最终exit0仅证明派生/机械守门完成；不代表visual assertion。早期synthetic descriptor/import路径脚手架错误保留日志，未当生产红绿。

唯一 fresh 小采命令：

```sh
DESIGN_FIDELITY_MODE=diagnostic DESIGN_FIDELITY_ISOLATE_TEXT=1 \
DESIGN_FIDELITY_MATRIX=dpr1-zoom05,dpr1-zoom1 DESIGN_FIDELITY_PAGES=variants \
DESIGN_FIDELITY_TARGET_IDS=finite-offset,finite-offset-negative,finite-offset-native \
DESIGN_FIDELITY_REAL_FIXTURE= DESIGN_FIDELITY_APP_DIR="$PWD/apps/design-studio/app" \
DESIGN_FIDELITY_EVIDENCE="$PWD/.tmp/render-fidelity-r008/finite/capture" \
node --max-old-space-size=8192 --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs
node .tmp/render-fidelity-r008/finite/verify.mjs
node --test --test-name-pattern='finite raster halfzoom|finite resource text' tests/apps/design-studio/canvaskit-cache.test.mjs tests/apps/design-studio/resource-text-raster.test.mjs
node --test tests/apps/design-studio/resource-text-raster.test.mjs tests/apps/design-studio/text-line-box.test.mjs tests/apps/design-studio/text-origin-compatibility.test.mjs
```

最终测量守门：`node --test` 五文件（phase-attribution、frame-own、audit、geometry、rotation-moment-roi）19/19，exit0，`focused-final.log`。
功能 suite/check/validate 与最终 assertion 的实际结果如下；专属TMPDIR、时间、exit、完整log SHA由 `validation-receipt.json` 记录。不运行 fidelity screenshot matrix。

首轮 `npm test -- --suite design-studio` 实际 exit1：1488 tests、1480 pass、3 fail、5 skip。
3 fail全为tile-only fixture在halfzoom被新增device phase接管，renderer实际vector而旧测试预期gpu-tiles（tileBuilds/evictions断言也依赖同一前提）。
仅将这三个专测tiles的用例显式设 `deviceTextSampling:false`，保留全部原像素、clip/alpha/shadow、LRU/scene invalidation断言；finite phase新守门仍开启sampling。
`node --test --test-name-pattern='GPU tile cache preserves nonzero|live scene revisions reuse|GPU tile textures obey|finite raster halfzoom' tests/apps/design-studio/canvaskit-cache.test.mjs` 实际4/4、exit0，见 `finite/tile-targeted-green.log`。
随后运行 `node .tmp/render-fidelity-r008/run-validation.mjs final`，实际 `npm run check` 内的完整Design Studio suite为1488 tests、1483 pass、0 fail、5 skip；没有将首轮红日志覆盖或冒称单独suite首次即绿。
该check在Video Download阶段exit1（该块479 tests、455 pass、23 fail、1 cancelled），原因是本轮验证脚手架漏了R007 runner原有的TMPDIR `package.json`边界，Node25将临时CommonJS fixture当ESM。
最小 `require('node:fs')` extensionless fixture在相同目录实测 exit1/`require is not defined`→补 `{"private":true}` 边界后 exit0；证据 `tmp-scope-proof.json`。
只改本cwd临时目录，不修改其他Panel。`node .tmp/render-fidelity-r008/resume-check.mjs` 从失败的Video Download命令起按原 `tests/suites.mjs` catalog续跑全部余下命令，已绿的prefix不重复执行；各命令、时间、exit、SHA在 `check-resume-receipt.json`。
`npm run validate` 单独实际exit0，日志 `validate-final.log`；`validation-receipt.json`保留原suite/check红及validate绿。不能将分段验证描述成一次完整 `npm run check` exit0。
`node --max-old-space-size=8192 .tmp/render-fidelity-r008/finalize-offline.mjs --assert-visual` 实际 exit1：机械合同通过，但从719/23残留及native halfzoom导出的visual assertion为false，状态BLOCKED。

| 最终验证范围 | tests / pass / fail / skip | 实际结果 |
| --- | --- | --- |
| Design Studio（check内完整suite） | 1488 /1483 /0 /5 | 两个catalog命令均通过 |
| 测量守门五文件 | 19 /19 /0 /0 | exit0 |
| tile-cache修订与finite phase定向 | 4 /4 /0 /0 | exit0 |
| 完整check catalog，已绿prefix + 修复TMP后的续跑 | 4086 /4077 /0 /9 | 分段全部通过；不是一次npm check exit0 |
| `npm run validate` | — | exit0 |
| 最终visual assertion | — | exit1，BLOCKED |

check原命令 UTC `2026-11-06T23:52:57.239Z..2026-11-07T00:04:44.734Z`；续跑六命令 `00:05:31.198Z..00:06:54.363Z`；validate `00:04:29.279Z..00:04:32.271Z`。
`complete-check-contract.json` 机械核对prefix+完整原catalog尾段的counts、六项exit和源码冻结；`final-custody.json`核对16个冻结源码/测试/包文件changes=[]、node_modules非symlink、真实六页SHA不变。
lock SHA仍为 `8a2b2e40ace2c66133f1b30cae29ff7fe9d535814ded523ec90d43093ba7b7ea`；生成产物检查通过，无其他Panel变更。`git diff --check`通过。

## 停止点

本轮只交付可复审的 task-owned commit与BLOCKED证据，不继续扩大生产修复或自动开新轮。
未覆盖：finite正负fill/link ranges与multiline GPU/SVG raster parity、native ranges/strokedtext/SVGshadow全产品路径、Node SVG无browser测量central/hanging fallback、ellipse/image fit等。
本轮不具备以“视觉已通过”为前提的真实Host最终验收资格；诊断性隔离Host验证亦未执行。
仍需累计最初base至候选的审查、CC独立review、真实Host隔离验证，以及用户授权的发布/安装；没有更新用户正在使用的0.23.0，没有宣告目标达成。

## A3 原失败项数值表

下表全部 DPR2 fractionalpan；GPU/SVG 每一个匹配probe的 centroid、width 都满足 .1，而非只比较平均。表列 maxima；完整逐probe表仍在phase JSON。

| Dataset / node | 原失败routes | max GPU–SVG | max HTML–GPU | max HTML–SVG |
| --- | --- | ---: | ---: | ---: |
| real / android-chat-6 | GPU、SVG | 0.019878725 | 0.251534825 | 0.248472232 |
| real / android-panels-6 | GPU、SVG | 0.019878725 | 0.251534825 | 0.248472232 |
| real / ios-chat-6 | GPU、SVG | 0.019878725 | 0.251534825 | 0.248472232 |
| real / ios-panels-6 | GPU、SVG | 0.019878725 | 0.251534825 | 0.248472232 |
| synthetic / center-stroke | GPU、SVG | 0.000000000 | 0.500000000 | 0.500000000 |
| synthetic / legacy-parent | GPU、SVG | 0.000000000 | 0.500000000 | 0.500000000 |
| synthetic / legacy-stroke | GPU、SVG | 0.000000000 | 0.500000000 | 0.500000000 |
| synthetic / selector | GPU、SVG | 0.005871527 | 0.247899160 | 0.247899160 |
| synthetic / shadow | GPU、SVG | 0.000000000 | 0.488808985 | 0.488808985 |

## 真实77个旋转GPU节点的逐项上限

每行是四矩阵中失败项的最大绝对 ΔL/ΔT（device px）；这张表是受限登记，未豁免。完整各矩阵和route值见moments JSON。

| GPU failed node | Failed matrices | max abs ΔL | max abs ΔT |
| --- | --- | ---: | ---: |
| android-chat/android-chat-33 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6762288168253736 | 0.6266632952073967 |
| android-chat/android-chat-34 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6958752463288516 | 0.619691870693041 |
| android-chat/android-chat-42 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.7383639101840753 | 0.6383280355669534 |
| android-chat/android-chat-43 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.7256650645615714 | 0.9210231925460888 |
| android-chat/android-chat-47 | dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.5996910511086515 | 0.45434359856480855 |
| android-chat/android-chat-48 | dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.5823382633580643 | 0.4676991993366566 |
| android-chat/android-chat-54 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6692012110701278 | 0.6822193478565342 |
| android-chat/android-chat-55 | dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6243406360633532 | 0.44681595935285223 |
| android-chat/android-chat-66 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| android-chat/android-chat-67 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| android-chat/android-chat-78 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| android-chat/android-chat-79 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| android-chat/android-chat-83 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6480752516771044 | 0.8101258041800989 |
| android-chat/android-chat-84 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6403963975871614 | 0.7765868434731114 |
| android-panels/android-panels-38 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| android-panels/android-panels-39 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| android-panels/android-panels-48 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.7425495329490879 | 0.6315456678503648 |
| ios-chat/ios-chat-32 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6762288168253736 | 0.6266632952073967 |
| ios-chat/ios-chat-33 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6958752463288516 | 0.619691870693041 |
| ios-chat/ios-chat-41 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.7383639101840753 | 0.6383280355669534 |
| ios-chat/ios-chat-42 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.7256650645615714 | 0.9210231925460888 |
| ios-chat/ios-chat-46 | dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.5996910511086515 | 0.45434359856480855 |
| ios-chat/ios-chat-47 | dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.5823382633580643 | 0.4676991993366566 |
| ios-chat/ios-chat-53 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6692012110701278 | 0.6822193478565342 |
| ios-chat/ios-chat-54 | dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6243406360633532 | 0.44681595935285223 |
| ios-chat/ios-chat-65 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| ios-chat/ios-chat-66 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| ios-chat/ios-chat-77 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| ios-chat/ios-chat-78 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| ios-chat/ios-chat-82 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6480752516771044 | 0.8101258041800989 |
| ios-chat/ios-chat-83 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6403963975871614 | 0.7765868434731114 |
| ios-panels/ios-panels-37 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| ios-panels/ios-panels-38 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| ios-panels/ios-panels-47 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.7425495329490879 | 0.6315456678503648 |
| web-chat/web-chat-110 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| web-chat/web-chat-111 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| web-chat/web-chat-16 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.7464537031097596 | 0.6343013292430648 |
| web-chat/web-chat-160 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| web-chat/web-chat-161 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| web-chat/web-chat-166 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6211322825939156 | 1.0134414970748171 |
| web-chat/web-chat-167 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.620235560066206 | 0.9927663043026573 |
| web-chat/web-chat-17 | dpr1-zoom1, dpr2-zoom1-fractionalpan | 0.7639052035460985 | 0.6335925903566437 |
| web-chat/web-chat-170 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6211322825939156 | 1.0134414970748171 |
| web-chat/web-chat-171 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.620235560066206 | 0.9927663043026573 |
| web-chat/web-chat-193 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6460113127971079 | 0.8075042818417324 |
| web-chat/web-chat-194 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6444585126336655 | 0.7786539761312445 |
| web-chat/web-chat-31 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.7383639101840753 | 0.6383280355669534 |
| web-chat/web-chat-32 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.7256650645615714 | 0.9210231925460888 |
| web-chat/web-chat-36 | dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.5996910511086515 | 0.45434359856480855 |
| web-chat/web-chat-37 | dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.5823382633580643 | 0.4676991993366566 |
| web-chat/web-chat-43 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6692012110701278 | 0.6822193478565342 |
| web-chat/web-chat-44 | dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6243406360633532 | 0.44681595935285223 |
| web-chat/web-chat-55 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| web-chat/web-chat-56 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| web-chat/web-chat-78 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| web-chat/web-chat-79 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| web-chat/web-chat-83 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| web-chat/web-chat-84 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| web-chat/web-chat-96 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.667365112912945 | 0.6032539304452549 |
| web-chat/web-chat-97 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6493798194091358 | 0.6177024048238664 |
| web-panels/web-panels-100 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6493798194091358 | 0.6177024048238664 |
| web-panels/web-panels-113 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| web-panels/web-panels-114 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| web-panels/web-panels-163 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| web-panels/web-panels-164 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| web-panels/web-panels-169 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6211322825939156 | 1.0134414970748171 |
| web-panels/web-panels-17 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6657352782812627 | 0.8814965434483164 |
| web-panels/web-panels-170 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.620235560066206 | 0.9927663043026573 |
| web-panels/web-panels-173 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6211322825939156 | 1.0134414970748171 |
| web-panels/web-panels-174 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.620235560066206 | 0.9927663043026573 |
| web-panels/web-panels-18 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6918246418710492 | 0.8804815568711315 |
| web-panels/web-panels-196 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6460113127971079 | 0.8075042818417324 |
| web-panels/web-panels-197 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2 | 0.6444585126336655 | 0.7786539761312445 |
| web-panels/web-panels-36 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.7068807566255249 | 0.4439548745757538 |
| web-panels/web-panels-93 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.6211322825939156 | 1.0134414970748171 |
| web-panels/web-panels-94 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.620235560066206 | 0.9927663043026573 |
| web-panels/web-panels-99 | dpr1-zoom1, dpr2-zoom1, dpr1-zoom2, dpr2-zoom1-fractionalpan | 0.667365112912945 | 0.6032539304452549 |
