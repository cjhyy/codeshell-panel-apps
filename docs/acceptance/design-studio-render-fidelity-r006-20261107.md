# Design Studio 渲染保真 R006（2026-11-07）

**状态：BLOCKED checkpoint。finite24 严格几何与真实文字通过；旋转、frame composite、synthetic 形状及旧 golden 兼容仍有真实阻塞。独立视觉断言 exit1；功能绿不替代视觉通过。**

分支 `codex/design-studio/render-fidelity-r006-20261107`，基线
`84a6e2ac869be1c471dc17bb1e30aa629d82ed25`（包含前五轮）。本轮证据根目录
`/Users/admin/.codex/worktrees/panels-design-render-fidelity-r006/.tmp/render-fidelity-r006/`；
下文证据路径相对于该目录。`.tmp` 不提交。用户指定模型 `gpt-6.1-sol`；三个并行工作者均显式采用该模型。

## 边界、保全与执行

已读 `CODESHELL.md`、`CONTRIBUTING.md`、R005 acceptance、生产 renderer 和现有 harness。
使用用户已指定的独占 worktree/branch/base，没有 fetch、集成或发行操作。
只修改本 worktree 的 Design Studio、必要 tests 和本文档；未改用户稿、Host、其他 Panel、
lock、安装包。未 push、merge、PR、发布、安装、使用凭证、访问用户 tab 或向外部服务写入。
独立 `npm ci --cache .tmp/npm-cache`，没有 node_modules symlink。浏览器实验仅使用专属本地
Chromium 上下文，fixture 外请求拒绝。未重拍旧 baseline。

只读六页源：
`/Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json`，
SHA-256 `91d877f8dbb28dce4c698b850c0db7455be2471c9d052f5cdf138c35f47dfc24`。
`package-lock.json` SHA-256 `8a2b2e40ace2c66133f1b30cae29ff7fe9d535814ded523ec90d43093ba7b7ea`。
R005 旧证据只读：
`/Users/admin/.codex/worktrees/panels-design-render-fidelity-r005/.tmp/render-fidelity-r005/`。

## R6-A：旋转先实验

16 个正交 case 覆盖 ±40/45°、4.2×1 / 3.4×1.19 / 5.1×1.19、x phase
0/.3/.5/.65、absolute/flow；各跑 DPR1/2。使用生产 frontend 与 CanvasKit，
候选仅作用于 scene clone，不写回文档。每 case 保存 computed transform matrix、DOM bbox、
去旋转 clone bbox、覆盖率质心、二阶矩方向和面积。四候选采用门限为质心 ≤.1 device px、
方向 ≤.1°、面积 ±2%，没有为单例调常数。

| 候选 | 规则 | 严格通过 / 32 | 最大质心差 device px | 最大方向差 ° |
| --- | --- | ---: | ---: | ---: |
| a | 精确 current | 0 | 1.476286 | 6.458747 |
| b | LU replay box、绕 LU center 精确旋转、不 snap | 0 | 1.423798 | 6.539592 |
| c | b 整体 translation roundCSS | 0 | .442748 | 2.349885 |
| d | 本地四边先 snap、绕 snapped center | 2 | 1.087457 | 4.610145 |

原始首次实验在 `rotation/spike.json`、逐 DPR source/stats JSON 与 PNG；后续最小反例
单独保留于 `rotation/followup/`，没有覆盖首次四候选结果。去旋转 DOM box 与 LU replay
相同；不能再把当前失败归因于未重放 flex。

最小反例候选 e 将 world translation、局部 width/height 分别 round，保留 LU transform-origin：
32 行中 19 行严格通过，最大质心差 .035860、方向差 1.817906°、面积比 .997024..1.015625。
例如 DPR1/-40°/4.2×1，参考方向 −41.378626°、候选 −43.196532°，仍不能采用。
本轮不实现任何 production rotation 规则，不加入 magic offset 或节点例外修正。

旧 200 行联合 >1 审计不能直接等同每节点真实失败：4 行背景投影污染可清除；196 行仍登记，
其中 176 有可信 isolation，20 full tile 混入另一笔而需重新隔离。旧全部 1,232 行中，
144 full 行不能用于每节点方向，另外 120 isolation 行的宽 ROI 混入非最近祖先背景。
例如 `web-chat-96` 白底祖先从 x16 开始，宽 ROI 从 x15 开始，把外层 `#f5f6f3` 的一条
当低覆盖率目标 ink，reference moment 角由源 40°偏到 11.404748°。

修正 ROI 取 source 旋转 AABB 与原 wide ROI 两端主 ink bbox 的 union，再扩 1 device px
保留 AA；包含实际观测位移，不能截掉真实偏移。新 harness 强制每个旋转节点隔离，保留
`rawWideRotationGeometry` 与有界 ROI。red 两条污染/位移反例失败，green 连同 paint-box
unit 10/10；2px 真实位移仍被拒绝。旧 1,088 isolation 行中仍有 334 行不满足
centroid≤1 / angle≤.5°，不是把真实残差全部解释成测量错误。旧原门禁与 PNG 未改。
证据 `rotation/old-rotation-bounded-union-audit.json`、`rotation/roi-{red,green}.log`。

## R6-B：finite paint baseline

无 typography ranges 的 finite browser raster 使用：

```text
alpha = floor((LH + round(fontAscent) - round(fontDescent))/2)
finitePaintBaseline = round(trunc64(y + hangingToAlphabetic - alpha)
                            + i * round64(LH) + alpha)
```

局部缓存用原 world origin 运输，不写回保存 y、offset 或 format；font epoch 改变会清字体
metrics cache。native resource finite 在 physicalScale≤1 保留原 SkParagraph 像素，>1 时
按既有窄资格和预算使用同 family browser device variant，不经过 Linear master；预算不足
显式 fallback。没有扩大 ranges/decoration 资格。公式包含 LH 累加，但本轮 strict24 验收
仅三个原始单行 finite；未验证的 multiline/ranges 不获得新保真承诺。

浏览器 SVG 在真实 loaded-font metrics 下输出相同 alphabetic paint baseline，并带只读
preview context/signature，供 Node preview 校验精确重放。无 browser/显式 finite context 的
Node SVG 仍输出历史 hanging；metadata 不写入文档格式。

| 节点 | authored y | h2a | alpha | raw alphabetic → CSS paint | DPR2 GPU 旧→新 centroidY |
| --- | ---: | ---: | ---: | --- | --- |
| finite-offset | 150 | 14.3999996185 | 23 | 164.3999996185 → 164 | +1.1810091616 → −.0000639266 |
| finite-offset-negative | 325 | 14.3999996185 | 27 | 339.3999996185 → 339 | +1.1735465933 → +.0003545958 |
| finite-offset-native | 403 | 12.8000001907 | 15 | 415.8000001907 → 416 | +.7760005902 → −.0006519196 |

`finite/red/report.json` 的实际 editor 24 行严格断言 exit1（5 fail），6/6 GPU 旧 crop SHA
与只读 R005 相同；`finite/green-device/report.json` 独立严格断言 exit0（24/24），route error
及 unavailable 均 0。DPR1/z1 三个 GPU crop bytes 全不变；native 残差仍为旧值 −.0365148753。
SVG 所有 centroid residual 为 0。首个 green 初始化失败、随后直接 round native 引起 DPR1
退化的失败日志全部保留；没有把失败结果删除或当通过。

独立 A/B/C 控制把真实 round 与旧采样相位分开：A=HEAD 原 renderer；B=同 raw baseline
仅打开 device path；C=CSSround baseline 与该 device path。用 B−A 独立测相位项，使用
`round(CSSroundAlpha*s)-round(rawAlpha*s)` 预测 C−B，最后对正式 editor 旧→新变化验证。
没有用正式 green 残差拟合预测。

| physicalScale2（DPR2/z1 与 DPR1/z2） | device-only 相位 B−A | 理论 round | 实测 round C−B | 合计预测 |
| --- | ---: | ---: | ---: | ---: |
| positive | −.181073088264 | −1 | −.9999999999997 | −1.181073088264 |
| negative | −.173191997535 | −1 | −.9999999999992 | −1.173191997535 |
| native | −.776652509820 | 0 | 0 | −.776652509820 |

36 个控制 PNG（4matrix×3node×A/B/C）与 12 组预测保存在 `finite/phase-control/`、
`finite/summary.json#/independentControl`。最大纯 GPU round 预测误差 7.96e−13 device px；
正式 editor GPU 合计变化预测误差最大 2.58e−12，满足 .1。DPR1/z1 三项 GPU 变化均 0。
原12项的全部GPU/SVG正式比较另存 `finite-final-prediction.json`：scale≥1 共18行中17行
预测达标；`finite-offset-native` / SVG / DPR1-z2 的旧centroidY=−.9999999999999→0，
先前按native shift0预测的误差为1 device px，**未满足预测条件**。DPR2-z1的同节点旧/新均0。
不能把GPU物理scale2控制外推到SVG hanging的CSS zoom路径；该差异留作真实兼容阻塞，
未加magic修正或重录golden。

兼容不能笼统判 PASS：browser SVG 三节点在所有矩阵的字符串由 hanging 改 measured
alphabetic，并增加 preview context；旧新全文在 `finite/summary.json#/svg`，DPR1/z1 SVG
像素仍不变。physicalScale=.5 的 native bytes 不变，但 positive/negative Arial master
bytes 变化，standalone控制质心变化分别 −.0003072857 / −.4764843287 device px；正式editor旧golden
比较为 −.0003072857 / −.4907181541，两个测量域分列、不混称同数。≥1 的 device-round
公式不证明该 downsampled master。此处明确为未满足的旧 golden 兼容项，未重录基准，
不把 finite24 strict PASS 外推成旧 12 golden 全不变。最终原始12项逐项表如下。

原12项精确比较（`finite12-comparison.json`；无 missing/ambiguous，旧 R005 raw 和 SVG 只读）：

| matrix / 节点 | GPU raw crop bytes 不变 | exact browser SVG string 不变 | 变化裁定 |
| --- | --- | --- | --- |
| dpr1-zoom1 / finite-offset | 是 | 否 | DPR1/z1 像素保持；SVG改measured alphabetic |
| dpr1-zoom1 / finite-offset-negative | 是 | 否 | DPR1/z1 像素保持；SVG改measured alphabetic |
| dpr1-zoom1 / finite-offset-native | 是 | 否 | DPR1/z1 像素保持；SVG改measured alphabetic |
| dpr2-zoom1 / finite-offset | 否 | 否 | scale2变化由独立phase+round预测 |
| dpr2-zoom1 / finite-offset-negative | 否 | 否 | scale2变化由独立phase+round预测 |
| dpr2-zoom1 / finite-offset-native | 否 | 否 | scale2变化由独立phase+round预测 |
| dpr1-zoom2 / finite-offset | 否 | 否 | scale2变化由独立phase+round预测 |
| dpr1-zoom2 / finite-offset-negative | 否 | 否 | scale2变化由独立phase+round预测 |
| dpr1-zoom2 / finite-offset-native | 否 | 否 | scale2变化由独立phase+round预测 |
| dpr1-zoom05 / finite-offset | 否 | 否 | half master bytes变化，兼容未达 |
| dpr1-zoom05 / finite-offset-negative | 否 | 否 | half master bytes变化，兼容未达 |
| dpr1-zoom05 / finite-offset-native | 是 | 否 | native旧master保持；SVG语义变更 |

## R6-C：测量与机械归因

SVG 不再把整数 ink bbox 与小数预测位移直接比较：主判定使用 coverage centroid XY 与
area/height 的积分宽度，预测残差仍 ≤.1 device px；整数 bbox 仅作 ≤1 device px 的栅格
一致性检查。必须独立满足 GPU/HTML 几何及像素条件，未知差异不自动称 AA。
负控注入 .5/1 device px 必须被拒绝。

frame composite 保留原 mismatch mask/runs 与计数；只有所有 mismatch pixel 均被实际
失败 descendant 的 bbox +2 device px 覆盖才标 `DESCENDANT_ATTRIBUTED`，保留原始失败，
不计 frame 自身重复失败、不改称 raw pass。任何未覆盖像素仍是 frame 自身失败。

stroke+shadow 额外制作去 shadow 的 stroke-only isolation，仅用于测 stroke；原始 combined
PNG、pixel gate 和独立 shadow probe 保留。不能用去影图替换真实图宣称整体通过。

旧 raw 离线重算：SVG strict 58 条旧分类全部保留，新增 175，共 233；869 个候选里不能满足
预测的仍红。GPU 原 32 个无 stroke 容器只有 4 条全 mask 被真实失败 descendant bbox+2
覆盖，28 条解释不全。该结论使用最终保守 guard；不能把整组 frame 都说成子节点引起。
新 guard 拒绝用大 composite-only 容器解释祖先，也拒绝清除 frame 自身几何失败。
逐像素 mask/counters 在 `measurement/r005-raw-union/frame-attribution.json`，最终 guard 表为
`measurement/frame-final-guard-summary.json`；只读旧 PNG、未改旧门禁。

shadow 定向实际 editor 8 行（DPR1/2 ×4routes）从 combined contour 8/8 不可用，到 stroke-only
8/8 可用、stroke geometry fail0；DPR2 SVG 原 shadow centroid 差 2.745579 device px 仍独立
保留为真实红。最终 strict4 对应统计仍由 fresh summary 裁定。

```sh
node .tmp/render-fidelity-r006/measurement/red-svg-calibration.mjs
node --test tests/apps/design-studio/render-fidelity-attribution.test.mjs tests/apps/design-studio/render-fidelity-geometry.test.mjs tests/apps/design-studio/render-fidelity-metrics.test.mjs tests/apps/design-studio/rotation-moment-roi.test.mjs
DESIGN_ROTATION_EVIDENCE=.tmp/render-fidelity-r006/rotation/replay node tests/apps/design-studio/rotation-paint-box-spike.mjs
node tests/apps/design-studio/rotation-residual-audit.mjs
node .tmp/render-fidelity-r006/finite/phase-control.mjs
node .tmp/render-fidelity-r006/finite/summarize.mjs
```

SVG classifier red 校准 exit1；随后 36 focused green 包括 X/Y 注入 .5/1 device px 栅格位移、
积分宽度缺陷、单个 mask 逃逸像素拒绝、rotation 背景污染及保留真实 2px 位移。首轮原始
rotation 四候选与追加 e 的 follow-up 分开保留；未重录旧 baseline。
上述为实际历史命令：finite phase-control执行时HEAD正是84a6e2ac。原脚本默认输出已冻结，
提交后重放必须显式固定旧ref为84a6e2ac并使用新输出目录，不能直接重跑覆盖本轮证据。


## 唯一最终采集与有效分母

最终入口 `node --max-old-space-size=8192 .tmp/render-fidelity-r006/run-final-capture.mjs`，
create-only 收据记录每个命令/env/UTC/exit/log SHA，禁止意外重跑。源码冻结后先运行：

```sh
node scripts/build-design-studio-figma-plugin.mjs
node scripts/build-design-studio-figma-plugin.mjs --check
node --max-old-space-size=8192 .tmp/render-fidelity-r006/run-final-capture.mjs
node .tmp/render-fidelity-r006/run-validation.mjs green
```

前两步生成并核验 adapter，未造成 tracked generated output 差异。最终捕获为一份 synthetic、
三份互不重叠的真实页组（web-chat/ios-chat，android-chat/web-panels，ios-panels/android-panels）、
一个七文字 fit isolation。真实每页只采集一次 strict4+fit，三份 raw report/PNG 完整保留，
仅 copy record arrays 并重新计算 unique/counts，不能用 shard 顺序选通过结果。

所有最终主采集命令均为：

```sh
DESIGN_FIDELITY_MODE=diagnostic DESIGN_FIDELITY_ISOLATE_TEXT=1 \
DESIGN_FIDELITY_MATRIX=dpr1-zoom1,dpr2-zoom1,dpr1-zoom2,dpr2-zoom1-fractionalpan,dpr1-fit-view \
DESIGN_FIDELITY_APP_DIR="$PWD/apps/design-studio/app" \
DESIGN_FIDELITY_EVIDENCE="$PWD/.tmp/render-fidelity-r006/<kind>" \
TMPDIR="$PWD/.tmp/render-fidelity-r006/tmp" \
node --max-old-space-size=8192 --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs
```

synthetic 的 `DESIGN_FIDELITY_REAL_FIXTURE/PAGES/TARGET_IDS` 为空；real 三 shard 设置该只读
fixture 路径和上述 disjoint `DESIGN_FIDELITY_PAGES`。fit-isolated 仅 matrix=fit，targets=
`android-chat-5,android-panels-5,android-chat-103,android-chat-46,android-panels-33,web-chat-190,web-panels-193`。
完整展开命令见 `final-capture-receipt.json`。额外只有三个原 finite 的 candidate half-zoom
兼容采集，不重拍任何旧 baseline：

```sh
DESIGN_FIDELITY_MODE=diagnostic DESIGN_FIDELITY_ISOLATE_TEXT=1 \
DESIGN_FIDELITY_MATRIX=dpr1-zoom05 DESIGN_FIDELITY_PAGES=variants \
DESIGN_FIDELITY_TARGET_IDS=finite-offset,finite-offset-negative,finite-offset-native \
DESIGN_FIDELITY_APP_DIR="$PWD/apps/design-studio/app" \
DESIGN_FIDELITY_EVIDENCE="$PWD/.tmp/render-fidelity-r006/finite-half" \
TMPDIR="$PWD/.tmp/render-fidelity-r006/tmp" \
node --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs
```

采集 diagnostic exit0 仅表示成功采集；最终独立断言才决定视觉 PASS/BLOCKED。

最终 strict4 有效分母如下（所有 route 均含 HTML self-reference；own-fill 只排除，不算 pass）：

| 数据 / route | 行 / 有效分母 | own-fill 非pass | 有效gate fail | 有效geometry fail | 有效raw pixel fail | AA-qualified非raw | 有效unavailable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 真实 / gpu | 2544 / 2468 | 76 | 381 | 302 | 449 | 121 | 0 |
| 真实 / browser | 2544 / 2468 | 76 | 0 | 0 | 0 | 0 | 0 |
| 真实 / svg | 2544 / 2468 | 76 | 656 | 753 | 813 | 54 | 0 |
| 真实 / html | 2544 / 2468 | 76 | 0 | 0 | 0 | 0 | 0 |
| synthetic / gpu | 188 / 188 | 0 | 18 | 7 | 20 | 1 | 0 |
| synthetic / browser | 188 / 188 | 0 | 0 | 0 | 0 | 0 | 0 |
| synthetic / svg | 188 / 188 | 0 | 20 | 14 | 20 | 0 | 0 |
| synthetic / html | 188 / 188 | 0 | 0 | 0 | 0 | 0 | 0 |

真实 strict4 共10,176 unique/full行，有效9,872，own-fill排除304；partial/duplicate/missing/unmeasured/font omission均0。
全部真实文字3,712行 gate/geometry/unavailable/route error均0；仍有一条SVG raw pixel diagnostic：
`android-panels-96` / DPR1-z2，30/20,720 mismatch、cluster11，geometry/gate均0，未称raw像素全等。
geometry/raw失败原指标保留，即使SVG有可预测snap解释也不删除；不能混同geometry fail、gate fail和raw pixel fail。
真实strict4 SVG预测分类233（旧58全部保留，新增175）；每项残差≤.1及bbox一致≤1独立检验，非raw pass。
AA-qualified175；832条stroke ring的ring pixel fail为0，但原composite fail397（含排除后有效339）仍保留。
`final-real/summary.json#/ownFillExcludedList`列出全部own-fill机械条件；全五矩阵380条、strict4 304条，均非pass。

frame有效339条原composite red中，154全mask机械归因、185仍有未知像素；13条无自身几何失败的fill容器降重复gate，另有自身几何红的项不清除。
GPU有效138条composite red：66归因、72自身红；SVG201条：88归因、113未知，含自身几何红后115仍gate fail。
GPU原32项fresh匹配32/32，仅4全归因、28仍红；fresh另暴露10条fill composite门禁及34条ring composite门禁。
新composite gate红104条是额外严格归因要求下暴露的原raw残差；逐行旧/新gate、mask、覆盖与未覆盖计数都在
`final-measurement-summary.json#/real`，不是把全部父frame都归因给子节点。

synthetic strict4 752行全部full、unavailable0、route error0；38 gate fail、21 geometry fail、40 raw pixel fail。
其中464文字行仍7 gate fail/3 geometry fail，均为既有GPU ranges-plain与stroke-text，未扩支持：

| 节点 | matrix | route | 剩余门禁 |
| --- | --- | --- | --- |
| ranges-plain | dpr1-zoom1 | gpu | pixel mismatch 0.019827863577863578 > 0.005；pixel cluster 29 > 6 |
| ranges-plain | dpr1-zoom2 | gpu | centroidY -0.7978352875809378 > 0.75；pixel mismatch 0.010939510939510939 > 0.005；pixel cluster 85 > 6 |
| ranges-plain | dpr2-zoom1-fractionalpan | gpu | centroidY -0.7879523376295978 > 0.75；pixel mismatch 0.011754195776118205 > 0.005；pixel cluster 68 > 6 |
| ranges-plain | dpr2-zoom1 | gpu | centroidY -0.7978352875809378 > 0.75；pixel mismatch 0.010939510939510939 > 0.005；pixel cluster 85 > 6 |
| stroke-text | dpr1-zoom2 | gpu | pixel cluster 19 > 6 |
| stroke-text | dpr2-zoom1-fractionalpan | gpu | pixel cluster 18 > 6 |
| stroke-text | dpr2-zoom1 | gpu | pixel cluster 19 > 6 |

synthetic 原16条stroke+shadow unavailable已全部转为可测。完整stroke-only16行中，fractional-pan的GPU/SVG各一行仍有
stroke width差 .488809 device px >.35；原shadow独立保留3条SVG失败：DPR2/z1与DPR1/z2质心差2.745579，
fractional-pan差1.585905，均>1。所有combined pixel和shadow probe保留，未用去影图替代整体图。

真实fit仍只诊断：2,544行，有效2,468；有效geometry fail253、raw pixel fail368、unavailable95，diagnostic failure487。
fit文字928行，geometry fail6、raw pixel fail51、unavailable0。不能称整个fit通过。
fresh指定七文字isolation为28/28，geometry/pixel/failure/unavailable/route error均0；最大device phase residual1.137e−13。

冻结期间唯一文件变化是缓存测试三hunk修订，故原 `captureSourcePreserved=false` 与runner exit1保持原样。
`capture-source-delta-audit.json` 8/8检查确认：全部5个capture子命令exit0，所有production、capture harness/helpers与其他tests完全不变，
原稿与lock不变；唯一变化为 `canvaskit-cache.test.mjs` 已审patch，未被capture入口导入。不是宣称整份source manifest相同。

三shard所有record arrays及12,720个全五矩阵unique keys由 `shard-merge-audit.json` 独立确认完整：raw52、isolation1896、
isolation raw tiles128、composite isolation54；六页实际fit GUI metadata完整列表也在该文件。原合并report的可选
`fitViews`/`summary.compositeIsolations`继承首shard metadata，GUI/composite总数以上述聚合与原shard为准；
所有逐节点有效分母与gate由完整arrays重新计算，原report不改写。

离线裁决命令（不重拍、不覆盖原PNG/report）：

```sh
node --max-old-space-size=8192 .tmp/render-fidelity-r006/summarize-final.mjs final-synthetic
node --max-old-space-size=8192 .tmp/render-fidelity-r006/summarize-final.mjs final-real
node .tmp/render-fidelity-r006/summarize-fit.mjs
node .tmp/render-fidelity-r006/audit-capture-source.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r006/audit-shard-merge.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r006/summarize-measurement-final.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r006/summarize-rotation-final.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r006/make-residual-index.mjs
node --max-old-space-size=8192 .tmp/render-fidelity-r006/compare-finite12.mjs
node .tmp/render-fidelity-r006/compare-finite-prediction.mjs
node .tmp/render-fidelity-r006/assert-final.mjs
```

最后三项中，exact12比较exit1、formal GPU/SVG预测比较exit1、最终独立视觉断言exit1均为保留的真实红。
finite fresh24 strict、9组GPU预测、覆盖完整性、真实文字、route error、fit七文字与保全审计均通过；
失败条件为synthetic strict/text、real strict、一个SVG z2变化未预测、exact12兼容未达、rotation例外超界。

完整残余索引 `final-real/residual-index.json` / `residual-index-summary.json`：10,176 keys无重复/缺失/额外，
含own-fill与diagnostic的未通过登记1,588行，仅排除own-fill后1,284；其中严格有效gate fail1,037，不能混称同一数字。
GPU有效381个gate失败精确分组：302 rotation、72 frame composite、7 geometry-pass pixel-only radius seam。
全量逐项在 `gpu-residual-groups.json`。7个允许登记的1px radius接缝均已过geometry，仍保留原pixel fail如下：

| matrix / 节点 | geometry | raw mismatch ratio | cluster | stroke centroid / width 最大 device px |
| --- | --- | ---: | ---: | --- |
| dpr2-zoom1-fractionalpan / android-chat-53 | PASS | 0.01171113 | 12 | 0.027565 / 0.252995 |
| dpr2-zoom1-fractionalpan / android-chat-6 | PASS | 0.00842993 | 16 | 0.017866 / 0.251535 |
| dpr2-zoom1-fractionalpan / android-panels-6 | PASS | 0.00842993 | 16 | 0.017866 / 0.251535 |
| dpr2-zoom1-fractionalpan / ios-chat-52 | PASS | 0.01171113 | 12 | 0.027565 / 0.252995 |
| dpr2-zoom1-fractionalpan / ios-chat-6 | PASS | 0.00842993 | 16 | 0.017866 / 0.251535 |
| dpr2-zoom1-fractionalpan / ios-panels-6 | PASS | 0.00842993 | 16 | 0.017866 / 0.251535 |
| dpr2-zoom1-fractionalpan / web-chat-42 | PASS | 0.01171113 | 12 | 0.027565 / 0.252995 |


101个1px radius源节点的全登记为1,616行，1,351 strict pass、265未通过；联合1px条件102行超界，
不能把所有圆角残差都当允许的接缝例外。只有上表7个geometry-pass/pixel-only项可按已登记的HTML双阴影接缝解释，仍非raw pass。

最终rotation 77×4矩阵×4routes=1,232行全部逐节点隔离、可测，原wide/bounded矩均保留。628 strict pass、604未通过；
每项centroid≤1且angle≤.5°的例外条件有363行不满足（GPU172/SVG191），其中centroid超界144、angle超界289，原因可重叠。
最大centroid1.453275、angle8.397832°；联合旧1px登记仍196行超界。下文77节点表及`rotation-final-registry.json`
逐行保存source box、每矩阵/route、原始矩、面积比、raw/AA/geometry、例外结果与PNG路径；无一项靠放宽阈值转绿。

严格门限保留：真实文字 3,712 行、0 fail、0 unavailable；GPU/browser shape 的 stroke
centroid/width ≤.35、edge ≤.5 device px；raw pixel 或几何先通过后的 [1,2,1]/4 device AA
0.1% / cluster6 qualified。same-fill unobservable 仅机械排除、不计 pass；1px radius seam
必须 geometry pass 且逐项列出。rotation 候选失败后的例外也要求每项 centroid ≤1 device px、
angle ≤.5°，超界仍 BLOCKED。SVG strict 或可预测 snap；finite24 strict；route error 0。

## 功能验证、实际观察与交付

有意义的专项验证：finite 相关 unit 25/25、UI 6/6；测量 focused 36/36、rotation 小 fixture
4 routes 可测；shadow 8 行 stroke isolation 全可测但真实 SVG shadow 仍红。rotation ROI 与
既有 paint box 合跑 10/10。根协调者补两条归因 guard：大 fill/composite-only 容器不能用
自身大 ink bbox 解释祖先；只有 frame 自身 geometry 已过才可降 pixel gate。相关 19 项全绿。
ROI unit 已纳入 Design Studio 默认 suite，完整 spike 不进入 fullgate 重跑。

```sh
node --test --test-concurrency=1 tests/apps/design-studio/resource-text-raster.test.mjs tests/apps/design-studio/text-line-box.test.mjs tests/apps/design-studio/svg-preview-font-context.test.mjs tests/apps/design-studio/text-origin-compatibility.test.mjs tests/apps/design-studio/text-ranges-svg.test.mjs tests/apps/design-studio/frontend-export.test.mjs
node --test --test-concurrency=1 tests/apps/design-studio/frontend-finite-origin-ui.test.mjs tests/apps/design-studio/text-line-box-ui.test.mjs tests/apps/design-studio/text-line-box-origin-ui.test.mjs
node --test tests/apps/design-studio/rotation-moment-roi.test.mjs tests/apps/design-studio/browser-paint-box.test.mjs
node --test tests/apps/design-studio/render-fidelity-attribution.test.mjs tests/apps/design-studio/rotation-moment-roi.test.mjs
npm test -- --suite design-studio
npm run check
npm run validate
```

finite 相关 UI 的既有默认输出目录仍叫 R001/R002/R005，但均在**当前 R006 worktree** 的
`.tmp` 下；没有写入旧 R005 worktree。专项命令/log 为 `finite/HANDOFF.txt`、
`measurement/handoff.md`、`rotation/handoff.md`；最终fullgate命令/env/时间/exit/log SHA 为
`validation-final-receipt.json`，初次suite红收据单独保留。

初次 `npm test -- --suite design-studio`：1,472 tests、1,465 pass、2 fail、5 skip，exit1，
日志 `design-suite-green.log`（保留原文件名，不把其称绿）。两条失败实际为nodePictureBuilds期望+1而实测+2，
以及native candidate plan旧期望不存在；并非raster miss或active device variant错误。
probe证明高zoom时保守padded bounds可见的native finite和system各获得@8 device picture；1x native仍走native，
只注册@2可选candidate，active device variant仍只有system。修订仅三hunk，增加精确variant断言、保留所有预算和像素门禁。
定向 `--test-name-pattern='visible text gains physical zoom|device glyph phases follow'` 2/2通过。

随后只执行一次完整 `npm run check`（包含完整Design Studio suite），不重复直接suite或大矩阵：

| 最终检查 | tests | pass | fail | skip | exit / log |
| --- | ---: | ---: | ---: | ---: | --- |
| Design Studio suite（full check内） | 1472 | 1467 | 0 | 5 | 0；`check-final.log`对应两批1223/249 |
| 全仓 `npm run check` | 4070 | 4061 | 0 | 9 | 0；`check-final.log` |
| `npm run validate` | — | — | 0 | — | 0；`validate-final.log` |

初次suite收据 `validation-green-receipt.json` 保留exit1；最终唯一check/validate收据为
`validation-final-receipt.json`（check865.212s、validate4.153s）。所有required check均为实际执行，
不是以功能绿代视觉；源文件/lock边界由最终diff与保全收据核验。

实际打开并看到的fresh图：

| 场景 | 路径（证据根目录相对） | 实际观察 |
| --- | --- | --- |
| z2 sidebar/full tile | `real-shard-1/dpr1-zoom2-web-chat-0/{gpu,html}.png` | 主协调者与独立工作者逐张打开；加号/monitor/Skills接近；dropdown chevron接合和褐色>仍有覆盖/粗细差，不能称通过 |
| DPR2 fractional-pan 正常GUI | `real-shard-1/dpr2-zoom1-fractionalpan-web-chat-0/{gpu,browser}-editor-gui.png` | 正文清楚，完整workbench/sidebar/chrome保留；metadata均zoom1、pan40.75/44、DPR2、stage1069×919；一次trusted wheel delta3.25、无截图前校正 |
| 实际fit正常GUI | `real-shard-1/dpr1-fit-view-web-chat-{gpu,browser}-actual-fit-gui.png` | 显示66%，实际zoom.65625、pan62/131.375、stage1069×919；两路正文与布局目视接近，仍按fit诊断红登记 |
| finite DPR2 GUI | `finite/green-device/dpr2-zoom1-variants-0/{gpu,browser}-editor-gui.png` | finite工作者实际打开；三finite文字目视对齐，24行独立几何才是验收依据 |
| rotation小实验 | `rotation/dpr2-html.png`、`rotation/followup/dpr2-e-local-paint-lu-origin.png` | 主协调者实际打开，候选e目视接近但方向门禁明确不合格 |

未逐页肉眼比较其余五页全部GUI与全部1,232个rotation图；其判断依据为上述完整逐项测量。
本会话独立复看记录 `rotation/final-visual-review.txt` 不冒充外部CC签字；最终六页GUI/逐项索引供CC复审，
没有发布或安装后的Host验收。正常GUI仍显示fake Host无Agent会话提示，该fixture不证明真实Host persistence。
没有用裁切/拼图替代正常GUI，亦未用“目视接近”覆盖严格红。

既有 plain ranges / stroked text native、image fit、Node SVG 无浏览器字体测量 fallback 等
继续单列，不扩大本轮支持范围，不作全产品像素承诺。最终仅提交 task-owned checkpoint；
不提交 `.tmp`，不进行发行或安装。视觉最终为 **BLOCKED**；停止在本轮资源检查点，
不扩大框架、追加大矩阵或把例外自动当pass。当前图形路径尚无能跨case满足要求的rotation规则；
frame未知像素、synthetic stroke/shadow及golden相位未知均继续阻塞。
提交SHA与diffstat以最终回复及本地 `delivery-receipt.json` 为准，避免本文档自引用提交SHA。

## 最终77个旋转节点逐项表

来源：`/Users/admin/.codex/worktrees/panels-design-render-fidelity-r006/.tmp/render-fidelity-r006/final-real/strict-audited-report.json`，77节点 × 4严格矩阵 × 4 routes = 1232行。
全部逐节点隔离：是；原wide与bounded矩完整：是；缺行0；不可测0。
strict pass 628/1232；例外条件满足869/1232，超界或不可测/未隔离363。例外仅质心≤1 device px、方向≤.5°，不等于strict或pixel通过。

下表 c=最大质心差(device px)，θ=最大方向差绝对值(°)，A=coverage面积比最小–最大；每route分母4矩阵。原pixel/geometry与两种ROI原始矩逐行保存在`rotation-final-registry.json`。

| 页 / 节点 | 源角° | GPU 最坏 c / θ / A | GPU 例外fail /4 | GPU strict /4 | SVG 最坏 c / θ / A | SVG 例外fail /4 | SVG strict /4 |
| --- | ---: | --- | ---: | ---: | --- | ---: | ---: |
| web-chat / web-chat-96 | 40 | c 0.4154 / θ 0.8512 / A 1.3760–1.4663 | 1 | 0 | c 0.4005 / θ 0.5055 / A 1.3440–1.3563 | 1 | 0 |
| web-chat / web-chat-97 | -40 | c 0.4307 / θ 0.9308 / A 1.3771–1.4929 | 1 | 0 | c 0.3984 / θ 0.5413 / A 1.3455–1.3694 | 1 | 0 |
| web-chat / web-chat-110 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-chat / web-chat-111 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| web-chat / web-chat-160 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-chat / web-chat-161 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| web-chat / web-chat-166 | 45 | c 0.5670 / θ 2.1785 / A 1.0814–1.3111 | 2 | 0 | c 0.5914 / θ 4.2278 / A 1.0012–1.1711 | 1 | 0 |
| web-chat / web-chat-167 | -45 | c 0.5682 / θ 2.2185 / A 1.0779–1.3036 | 2 | 0 | c 0.5914 / θ 4.2679 / A 1.0012–1.1644 | 1 | 0 |
| web-chat / web-chat-170 | 45 | c 0.5670 / θ 2.1785 / A 1.0814–1.3111 | 2 | 0 | c 0.5914 / θ 4.2278 / A 1.0012–1.1711 | 1 | 0 |
| web-chat / web-chat-171 | -45 | c 0.5682 / θ 2.2185 / A 1.0779–1.3036 | 2 | 0 | c 0.5914 / θ 4.2679 / A 1.0012–1.1644 | 1 | 0 |
| web-chat / web-chat-193 | 40 | c 0.6316 / θ 0.7163 / A 0.9481–1.0335 | 1 | 0 | c 0.6370 / θ 2.5452 / A 0.8891–1.0104 | 4 | 0 |
| web-chat / web-chat-194 | -40 | c 1.4216 / θ 4.0040 / A 0.9481–1.0800 | 4 | 0 | c 1.4490 / θ 8.3978 / A 0.8646–0.8952 | 4 | 0 |
| web-chat / web-chat-16 | 40 | c 1.3080 / θ 1.9068 / A 1.3325–1.4621 | 4 | 0 | c 1.3251 / θ 1.1921 / A 1.3048–1.3554 | 4 | 0 |
| web-chat / web-chat-17 | -40 | c 0.2840 / θ 0.6722 / A 1.3010–1.3728 | 1 | 1 | c 0.3040 / θ 0.8393 / A 1.2960–1.3460 | 1 | 0 |
| web-chat / web-chat-31 | 45 | c 0.7069 / θ 0.6683 / A 1.2951–1.4504 | 1 | 0 | c 0.6940 / θ 0.5096 / A 1.2599–1.4173 | 1 | 0 |
| web-chat / web-chat-32 | -45 | c 1.0005 / θ 0.5925 / A 1.2279–1.3930 | 3 | 0 | c 0.9974 / θ 0.4986 / A 1.2041–1.3909 | 0 | 0 |
| web-chat / web-chat-36 | 45 | c 1.1680 / θ 1.8719 / A 0.9975–1.0694 | 4 | 0 | c 1.1584 / θ 1.1843 / A 0.8962–0.9944 | 4 | 0 |
| web-chat / web-chat-37 | -45 | c 0.3522 / θ 0.9995 / A 0.9971–1.0727 | 1 | 0 | c 0.3125 / θ 0.4771 / A 0.9461–0.9978 | 0 | 2 |
| web-chat / web-chat-43 | 45 | c 0.8627 / θ 2.8883 / A 1.3696–1.4253 | 2 | 0 | c 0.7530 / θ 1.6036 / A 1.3088–1.3381 | 1 | 0 |
| web-chat / web-chat-44 | -45 | c 0.8330 / θ 0.3878 / A 1.1697–1.2975 | 0 | 1 | c 0.8876 / θ 0.9910 / A 1.0878–1.2470 | 1 | 0 |
| web-chat / web-chat-55 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-chat / web-chat-56 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| web-chat / web-chat-78 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-chat / web-chat-79 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| web-chat / web-chat-83 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-chat / web-chat-84 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| ios-chat / ios-chat-32 | 40 | c 0.7064 / θ 0.6675 / A 1.0421–1.1477 | 2 | 0 | c 0.7035 / θ 1.2464 / A 1.0365–1.0666 | 1 | 0 |
| ios-chat / ios-chat-33 | -40 | c 0.5865 / θ 0.7793 / A 1.0568–1.1188 | 3 | 1 | c 0.5593 / θ 0.2918 / A 1.0067–1.0403 | 0 | 0 |
| ios-chat / ios-chat-41 | 45 | c 0.7069 / θ 0.6683 / A 1.2951–1.4504 | 1 | 0 | c 0.6940 / θ 0.5096 / A 1.2599–1.4173 | 1 | 0 |
| ios-chat / ios-chat-42 | -45 | c 1.0005 / θ 0.5925 / A 1.2279–1.3930 | 3 | 0 | c 0.9974 / θ 0.4986 / A 1.2041–1.3909 | 0 | 0 |
| ios-chat / ios-chat-46 | 45 | c 1.1680 / θ 1.8719 / A 0.9975–1.0694 | 4 | 0 | c 1.1584 / θ 1.0447 / A 0.8883–0.9944 | 4 | 0 |
| ios-chat / ios-chat-47 | -45 | c 0.3522 / θ 0.9995 / A 0.9971–1.0727 | 1 | 0 | c 0.3125 / θ 0.4771 / A 0.9461–0.9978 | 0 | 2 |
| ios-chat / ios-chat-53 | 45 | c 0.8627 / θ 2.8883 / A 1.3696–1.4253 | 2 | 0 | c 0.7530 / θ 1.6036 / A 1.3088–1.3381 | 1 | 0 |
| ios-chat / ios-chat-54 | -45 | c 0.8330 / θ 0.3878 / A 1.1697–1.2975 | 0 | 1 | c 0.8876 / θ 0.9910 / A 1.0878–1.2470 | 1 | 0 |
| ios-chat / ios-chat-65 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| ios-chat / ios-chat-66 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| ios-chat / ios-chat-77 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| ios-chat / ios-chat-78 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| ios-chat / ios-chat-82 | 40 | c 0.6320 / θ 0.6379 / A 0.9489–1.0340 | 1 | 0 | c 0.6374 / θ 2.4892 / A 0.8891–1.0125 | 4 | 0 |
| ios-chat / ios-chat-83 | -40 | c 1.4229 / θ 3.8284 / A 0.9477–1.0800 | 4 | 0 | c 1.4533 / θ 8.3440 / A 0.8642–0.8968 | 4 | 0 |
| android-chat / android-chat-33 | 40 | c 0.7064 / θ 0.6675 / A 1.0421–1.1477 | 2 | 0 | c 0.7035 / θ 1.2464 / A 1.0365–1.0666 | 1 | 0 |
| android-chat / android-chat-34 | -40 | c 0.5865 / θ 0.7793 / A 1.0568–1.1188 | 3 | 1 | c 0.5593 / θ 0.2918 / A 1.0067–1.0403 | 0 | 0 |
| android-chat / android-chat-42 | 45 | c 0.7069 / θ 0.6683 / A 1.2951–1.4504 | 1 | 0 | c 0.6940 / θ 0.5096 / A 1.2599–1.4173 | 1 | 0 |
| android-chat / android-chat-43 | -45 | c 1.0005 / θ 0.5925 / A 1.2279–1.3930 | 3 | 0 | c 0.9974 / θ 0.4986 / A 1.2041–1.3909 | 0 | 0 |
| android-chat / android-chat-47 | 45 | c 1.1680 / θ 1.8719 / A 0.9975–1.0694 | 4 | 0 | c 1.1584 / θ 1.0447 / A 0.8883–0.9944 | 4 | 0 |
| android-chat / android-chat-48 | -45 | c 0.3522 / θ 0.9995 / A 0.9971–1.0727 | 1 | 0 | c 0.3125 / θ 0.4771 / A 0.9461–0.9978 | 0 | 2 |
| android-chat / android-chat-54 | 45 | c 0.8627 / θ 2.8883 / A 1.3696–1.4253 | 2 | 0 | c 0.7530 / θ 1.6036 / A 1.3088–1.3381 | 1 | 0 |
| android-chat / android-chat-55 | -45 | c 0.8330 / θ 0.3878 / A 1.1697–1.2975 | 0 | 1 | c 0.8876 / θ 0.9910 / A 1.0878–1.2470 | 1 | 0 |
| android-chat / android-chat-66 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| android-chat / android-chat-67 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| android-chat / android-chat-78 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| android-chat / android-chat-79 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| android-chat / android-chat-83 | 40 | c 0.6320 / θ 0.6379 / A 0.9489–1.0340 | 1 | 0 | c 0.6374 / θ 2.4892 / A 0.8891–1.0125 | 4 | 0 |
| android-chat / android-chat-84 | -40 | c 1.4229 / θ 3.8284 / A 0.9477–1.0800 | 4 | 0 | c 1.4533 / θ 8.3440 / A 0.8642–0.8968 | 4 | 0 |
| web-panels / web-panels-99 | 40 | c 0.4154 / θ 0.8512 / A 1.3760–1.4663 | 1 | 0 | c 0.4005 / θ 0.5055 / A 1.3440–1.3563 | 1 | 0 |
| web-panels / web-panels-100 | -40 | c 0.4307 / θ 0.9308 / A 1.3771–1.4929 | 1 | 0 | c 0.3984 / θ 0.5413 / A 1.3455–1.3694 | 1 | 0 |
| web-panels / web-panels-113 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-panels / web-panels-114 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| web-panels / web-panels-163 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-panels / web-panels-164 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| web-panels / web-panels-169 | 45 | c 0.5670 / θ 2.1785 / A 1.0814–1.3111 | 2 | 0 | c 0.5914 / θ 4.2278 / A 1.0012–1.1711 | 1 | 0 |
| web-panels / web-panels-170 | -45 | c 0.5682 / θ 2.2185 / A 1.0779–1.3036 | 2 | 0 | c 0.5914 / θ 4.2679 / A 1.0012–1.1644 | 1 | 0 |
| web-panels / web-panels-173 | 45 | c 0.5670 / θ 2.1785 / A 1.0814–1.3111 | 2 | 0 | c 0.5914 / θ 4.2278 / A 1.0012–1.1711 | 1 | 0 |
| web-panels / web-panels-174 | -45 | c 0.5682 / θ 2.2185 / A 1.0779–1.3036 | 2 | 0 | c 0.5914 / θ 4.2679 / A 1.0012–1.1644 | 1 | 0 |
| web-panels / web-panels-196 | 40 | c 0.6316 / θ 0.7163 / A 0.9481–1.0335 | 1 | 0 | c 0.6370 / θ 2.5452 / A 0.8891–1.0104 | 4 | 0 |
| web-panels / web-panels-197 | -40 | c 1.4216 / θ 4.0040 / A 0.9481–1.0800 | 4 | 0 | c 1.4490 / θ 8.3978 / A 0.8646–0.8952 | 4 | 0 |
| web-panels / web-panels-17 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| web-panels / web-panels-18 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| web-panels / web-panels-36 | 45 | c 1.2028 / θ 1.3865 / A 1.0709–1.1338 | 4 | 0 | c 1.1330 / θ 0.1670 / A 1.0197–1.0687 | 3 | 0 |
| web-panels / web-panels-93 | 45 | c 0.5670 / θ 2.1785 / A 1.0814–1.3111 | 2 | 0 | c 0.5914 / θ 4.2278 / A 1.0012–1.1711 | 1 | 0 |
| web-panels / web-panels-94 | -45 | c 0.5682 / θ 2.2185 / A 1.0779–1.3036 | 2 | 0 | c 0.5914 / θ 4.2679 / A 1.0012–1.1644 | 1 | 0 |
| ios-panels / ios-panels-37 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| ios-panels / ios-panels-38 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| ios-panels / ios-panels-47 | 45 | c 0.5393 / θ 1.4567 / A 1.3158–1.4907 | 3 | 0 | c 0.5279 / θ 0.6242 / A 1.2633–1.4240 | 1 | 0 |
| android-panels / android-panels-38 | 40 | c 1.0787 / θ 2.6961 / A 1.1175–1.2378 | 4 | 0 | c 1.1177 / θ 3.8574 / A 1.0491–1.1137 | 4 | 0 |
| android-panels / android-panels-39 | -40 | c 0.7742 / θ 2.5777 / A 1.1220–1.1979 | 1 | 0 | c 0.7628 / θ 4.1146 / A 1.0431–1.0619 | 4 | 0 |
| android-panels / android-panels-48 | 45 | c 0.5393 / θ 1.4567 / A 1.3158–1.4907 | 3 | 0 | c 0.5279 / θ 0.6242 / A 1.2633–1.4240 | 1 | 0 |

超界分因（每个原因独立计数，同一行可多因）：

- DIRECTION_ABOVE_0_5_DEG: 289
- CENTROID_ABOVE_1_DEVICE_PX: 144

联合旧1px登记分因（bbox/原ink centroid/bounded rotation centroid；不包含方向规则）：

- INK_CENTROID_ABOVE_1_DEVICE_PX: 150
- ROTATION_CENTROID_ABOVE_1_DEVICE_PX: 144
- BBOX_ABOVE_1_DEVICE_PX: 83
