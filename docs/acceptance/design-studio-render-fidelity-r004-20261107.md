# Design Studio 渲染保真 R004（2026-11-07）

**状态：BLOCKED；本轮是有界验证与安全增量 checkpoint，不代表严格渲染保真目标完成。**

分支 `codex/design-studio/render-fidelity-r004-20261107`，基线
`c6b3d45e1437f85f0e2a8d1aebaaf793755b8985`（包含前三轮）。固定使用
`gpt-6.1-sol`；三个并行子任务沿用父模型。CC 的 R003 复审规格只读，未写协调账本。
实现安全 checkpoint 为 `20c9e67e4d0eee67a3d47cbba0ef7ebb5ed38b75`（13 文件，+500/−35），
在相关 focused、完整 Design Studio suite、最终 check/validate 通过后本地提交。
本轮原始证据根目录为
`/Users/admin/.codex/worktrees/panels-design-render-fidelity-r004/.tmp/render-fidelity-r004/`，不提交 `.tmp`。

## 修改边界与证据保全

只修改本 cwd 的 Design Studio、相关测试及本文档。独立 `npm ci --cache .tmp/npm-cache`
成功，`node_modules` 不是 symlink。未改 lock、其他 Panel、Host、已安装包或用户稿；未使用用户
tab、凭证、paid/live network fidelity，未 push、PR、merge、发布或安装 Panel。
Chromium 只使用本地包和私有测试上下文；计时不代表物理 GPU 的吞吐量。

真实稿只读路径：
`/Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json`。
其 SHA-256 为 `91d877f8dbb28dce4c698b850c0db7455be2471c9d052f5cdf138c35f47dfc24`。
lock SHA-256 为 `8a2b2e40ace2c66133f1b30cae29ff7fe9d535814ded523ec90d43093ba7b7ea`。
初始保全收据为 `initial-custody.json`；R003 旧 PNG、metrics 和报告始终只读。

## F1：最小六 flex 实验否定通用规则，未合入生产

实验仅尝试去掉 `dynamic-size` 和 `flow-owned` 两个 fallback，复用原有父相对 offset、
1/64 CSS px 局部量化、沿祖先累加与四边 snap 路径。其余旋转、约束、实例、inside-border
路径均保留。没有改 layout、`node.y`、baseline offset、overlay、hit-test 或 opacity。

规范 fixture 包含 row/column × start/center/end 六个 frame，padding 3.17、gap 4.23，
嵌套 hug HMI text/icon（padding 1.35、gap 2.15）、9.85px icon 中的 1.17×7.37px
细条与 cross-axis fill。DPR1/2 × zoom1/2 共 48 个 shape 行。

| 矩阵 | 原版 geometry/pixel fail | 候选 geometry/pixel fail | 候选 raw pass | LAYOUT_MISMATCH |
| --- | --- | --- | --- | --- |
| DPR1 / z1 | 12 / 12 | 2 / 0 | 12 / 12 | 29 / 36 |
| DPR2 / z1 | 12 / 12 | 2 / 2 | 10 / 12 | 29 / 36 |
| DPR1 / z2 | 12 / 12 | 2 / 2 | 10 / 12 | 29 / 36 |
| DPR2 / z2 | 12 / 12 | 2 / 2 | 10 / 12 | 29 / 36 |

候选 48 行仍有 8 geometry fail、6 pixel fail；42 raw pass 不等于 42 完整几何通过。
center/end 四个变体的两个形状都通过，但 start 两个变体的细条在每个矩阵仍失败。
DPR2/z2 的右边差 4 device px、质心差 2 device px；实际打开 GPU/HTML PNG，可见 GPU
start 细条更粗。DPR1/z1 的 raw 邻域像素统计容忍该差异，严格几何正确地拒绝了它。

反例：保存的细条 x=53.370000000000005、width=1.17；DOM x=53.328125、width=1.15625。
候选 GPU paint x=53、width=2，HTML paint x=53、width=1。保存坐标与 DOM 的最大差为
0.059375 CSS px，超过 1/64。该差异先于 paint，不能通过 round、offset 或增宽阈值掩盖。
因此撤回全部 F1 生产和测试目录修改，原 `browser-paint-box.mjs`、单元与 suite 注册恢复原字节；
原单元 5/5 通过。这是明确被实测否定的候选，不是完成的 flow 修复。

证据：`flow-box-red-canonical/`、`flow-box-candidate/`、`flow-box-summary.json`、
`flow-box-conclusion.json` / `.md`、精确撤回 patch `flow-box-candidate.patch`。
`node --test .tmp/render-fidelity-r004/flow-box-spike.mjs` 保留为故意 strict red 的重放入口。
最早 `flow-box-red/` 缺少 hug text 的 `textSource`，单独留下历史记录；上表只用相同规范源的
canonical red/candidate。额外只读复核 R003 六页首 tile 的 730 个未旋转 DOM bbox，
saved/DOM 最大差 0.014375 CSS px、没有超过 1/64 的节点（`frozen-layout-audit.json`）；
这不能外推证明新六 flex 规则成立。

## M1：归因与 guard

guard 使用有限数的 `Math.fround(a) === Math.fround(b)`，没有增加视觉误差阈值。
实测 `28.750001907348633` 与 `28.75` 是相邻 float32，直接 fround 后仍不相等；规格对该
pair 的等值假设不成立。`m1/float32-guard-proof.json` 保存表示证据，
`m1/guard-spec-red.log` 保留最初红测；后续测试将原 pair 作为负控、真正同 float32 的 double
作为正控。旧的缺图没有据此伪补成 pass。

`OWN_FILL_UNOBSERVABLE` 只用于 exact effective background / opacity 同色且没有自己的
stroke/shadow/multipaint 的 fill。机械检查保留颜色，拒绝不明背景、跨祖先填充范围、复杂 opacity、
非相关重叠 paint 等情形；只从有效分母排除，保留原 failure/不可用记录，不计 pass。
frame stroke pixel 改用轮廓 ring ±(W/2 + 1.5) device px，保留 `rawCompositePixel`；
子节点仍分别测量，没有把 composite 子文字统计归给 frame stroke。
SVG 仅在 GPU 与 HTML 已独立通过 geometry 与 raw/qualified pixel、单一可解释形状、
边/质心或 contour centroid/width 的预测 snap 残差全部 ≤0.1 device px 时，标记
`svg-precise-vs-html-snap` diagnostic。其他情况保持严格；该标记和 AA-qualified 都不是 raw pass。

先用 R003 冻结 raw 离线重算，没有重拍基线。其严格四矩阵原始 10,176 行、2,036 gate fail、
305 unavailable 保留在源报告。派生归因结果如下：

| 项目 | 行数或结果 |
| --- | --- |
| exact own-fill 不可观测 | 304（每 route 76）；有效分母 9,872 |
| 有效 unavailable | 1，旧 browser isolation 缺图；仍不可用 |
| frame ring 重算工作量 | 旧六矩阵 312 groups，1,247 个可用 route 行；另 1 行仍缺图 |
| frame raw composite pixel fail | 原 260 保留；ring 不再归入这 260 项子元素像素污染 |
| SVG 严格预测解释 | 11 diagnostic；不计 pass |
| 派生含不可观测 gate fail | 1,765；原始 gate fail 2,036 仍可追溯 |
| 派生有效 gate fail | 1,461：GPU 640 / browser 0 / SVG 821 / HTML 0 |

以上分母调整不是渲染改善或全面验收。离线收据
`m1/r003-offline-attribution.json` / `.log` 保留原统计、逐项变更、807 个 PNG SHA 和源文件未改验证。
初版 27 项 focused harness 测试通过，最终增加原场景背景负控后为 28/28，包含 same-fill
背景覆盖、额外 paint、SVG 额外差异等负控。

最后归因复核发现：隔离会把黑色 sibling 设 opacity 0，不能据该空白背景决定原 white fill
是否不可观测。最小签名修正让单 tile 与 derived composite 的判定均引用 `data.design` 原页节点，
不改任何像素/ROI/geometry/guard。`m1/observability-original-source-boundary.json` 保留反例；
真实六页源穷举只有原 19 个 eligible 节点，隔离没有新增 eligible，已采 classified keys 的原源审计
全部有效。最终 `m1/final-real-observability-source-audit.json` 读取 2,050 份 metrics，复核五矩阵
380 个 unique classified keys（其中 strict 304），380 项均在原源 eligible；invalid/readErrors 均 0。
该修正在采集进行期间落盘，但采集进程已加载旧
harness；本轮计数以原源复核证明等效，不重拍，也不隐瞒该代码/收据版本差异。
最终 focused 日志为 `m1/harness-source-attribution-green.log`。

## P1：小数手势期间复用，停止后恢复精确相位

生产只增加显式 interactive camera 状态：真实 wheel 与 pointer pan 透过 renderer controller
进入 GPU renderer。连续手势及其中的 chrome/selection 重绘复用已保留 picture；最后一个视图
静止 150ms 后进行一次精确 device-phase 重建。普通静态 render 保留原即时精确采样语义，
没有新增第二份 text cache 或放宽既有预算。scene/resize/dispose 取消旧 timer；settle 异常
可通过 controller 错误通路使 surface 失效，standalone stats/后续 render 也会暴露原错误。

原版 4 层、含翻译 instance 的 60 帧 fractional pan + 20 帧 zoom 红测产生 80 次 sampling
picture 重建、240 次 raster miss（`perf/red/frames.json`、`perf-red.log`）。
修复后每个 case 同样 80 帧，DPR2，pan 每帧 `.375/.1875`，zoom 每帧按 `.75` wheel 计算。
最终直接调用生产 renderer 共 720 帧：

| 场景 | layers / text / instance | 手势 builds / misses | settle builds / misses | render CPU p50 / p95 ms |
| --- | --- | --- | --- | --- |
| 小型 instance | 4 / 2 / 1 | 0 / 0 | 1 / 3 | 0.70 / 1.10 |
| web-chat | 199 / 58 / 0 | 0 / 0 | 1 / 58 | 0.60 / 0.80 |
| ios-chat | 104 / 28 / 0 | 0 / 0 | 1 / 28 | 0.70 / 1.40 |
| android-chat | 105 / 28 / 0 | 0 / 0 | 1 / 28 | 0.30 / 1.30 |
| web-panels | 202 / 61 / 0 | 0 / 0 | 1 / 61 | 0.80 / 1.70 |
| ios-panels | 97 / 28 / 0 | 0 / 0 | 1 / 28 | 0.40 / 1.30 |
| android-panels | 100 / 29 / 0 | 0 / 0 | 1 / 29 | 1.10 / 1.60 |
| 原 1208 层 fixture | 1208 / 0 / 0 | 0 / 0 | 0 / 0 | 0.60 / 0.70 |
| 明确派生 text/instance 压力场景 | 1208 / 302 / 1 | 0 / 0 | 1 / 18 | 0.90 / 1.20 |

每帧记录 `deviceTextSamplingBuilds`、`rasterTextCacheMisses`、view、CPU render 时间和预算。
原 1208 层没有文字，不能用其空计数证明文字性能，所以另留同层数派生压力场景；压力场景的
18 次 settle miss 是当时可见文字，不能称为对全部 302 文字的同时 raster 计数。
共享文字预算保持 64 MiB（67,108,864 B），真实页观察峰值 11,853,960 B。
master/device variants 共用该文字预算；原 node-picture 64 MiB、tile 64 MiB / 16MP 及 viewport
16MP 上限也未改，运动期间没有增加独立 gesture cache。这些限额不是总 GPU 进程内存测量。
计时仅为同步提交/文字准备 CPU 时间，不包括 GPU completion、显示 FPS 或实际触控板延迟，
没有 timing 易碎门禁。

真实编辑器另测 80 次 trusted wheel：60 次 DOM delta `.375/.1875` pan、20 次 Ctrl DOM
deltaY `.75` zoom，含一次 chrome redraw。DPR2 的 CDP 输入按 DPR 补偿，真实事件逐项留档；
同样为手势 builds/misses 0/0、settle builds 1。
六页性能序列是直接 renderer 调用，编辑器事件接线由单独测试覆盖，不称为六页物理手势测试。
真实稿 232 个文字全为 Apple/PingFang 字族（400×120、500×68、600×44），没有 Inter/fontRef。
同裸 canvas、Roboto setup、GPU setScene 的只读 CDP 审计实际解析到 Latin `.SF NS`、
CJK PingFangSC Regular/Medium/Semibold（非 custom font）。额外加载本地 Inter variable 前后，
实际 font/PostScript/glyphCount 均相同。`perf/font-path-audit.json` 排除了未加载 Inter 导致这组
性能采样落入另一字族的疑点；这组六页是系统字体性能证据，不能称为默认 Inter 性能。
静止 Retina 与 fresh static PNG 字节一致，SHA-256 同为
`0d4bfa0fcf676938d1ce9ef36bae88ef4641daa8dd1c39a43990f45b73020284`，
没有为性能永久保留运动时的文字重采样。

证据索引 `perf/summary.json`，逐帧 `perf/final-cache/frames.json`，真实事件
`perf/final-ui/trusted-ui.json`。cache/lifecycle 2/2、controller 24/24、trusted UI 1/1 通过。
初次 UI 输入未补偿 DPR 的失败 log 仍保留，最终没有放宽事件值断言。

首轮完整功能 suite 抓到旧 `gpu-renderer-ui` 静态 oracle 在 wheel 后只等两帧，仍处于运动缓存期。
只给 GPU/master 共用对齐函数增加 160ms + 双 RAF 静止等待，所有原 MAE/最大通道/边界断言不变。
focused 复测 GPU MAE 0.002177734375、maximum channel delta 1；master MAE 0.1470458984375。
失败保留于 `design-suite-final.log`，focused 绿为 `perf-static-oracle-green.log`。
视觉采集期间的 delta 仅有这个测试文件及前述 original-source 背景归因签名/负控；生产、像素、
几何与阈值均未变。`post-capture-test-only-delta.json` 保存三个测试目录文件的前后 SHA；
`final-source-manifest.json` 为采集开始清单，`functional-final-source-manifest.json` 为最终清单。
完整功能检查与最终 focused 28/28 共同覆盖这些测试目录修正，不将早先命令伪记为新源码的重跑。

## 最后一次门禁、fit 隔离与 golden

最后只采集一次四严格矩阵（DPR1/z1、DPR2/z1、DPR1/z2、DPR2/z1/fractional pan）与 fit
诊断组：合成稿 259.934s，真实六页 2,977.246s；额外 half 仅测三个 finite 节点，8.949s。
均未重试，也没有重拍 R003 六矩阵 baseline。精确命令、env、UTC、exit 与 log SHA 见
`final-capture-receipt.json`，入口为 `node .tmp/render-fidelity-r004/run-final-capture.mjs`。
三项诊断 capture 的 exit 均为 0，仅表示采集成功。随后只读收据门禁
`node .tmp/render-fidelity-r004/assert-final.mjs` exit 1、状态 **BLOCKED**，详
`strict-visual-final-assertion.json` / `strict-visual-final.log`。下列功能绿不能替代该视觉红。

| 功能命令 | 结果 | wall time | 日志 |
| --- | --- | --- | --- |
| `npm test -- --suite design-studio` | exit 0；1453 tests，1448 pass，0 fail，5 skip | 484.536s | `design-suite-green.log` |
| `npm run check` | exit 0；各批摘要合计 4052 tests，4043 pass，0 fail，9 skip | 702.003s | `check-complete.log` |
| `npm run validate` | exit 0；仓库/package validation | 3.504s | `validate-complete.log` |

5 个 skip 延续既有可选 encoder / portable / private IANA 条件，不作为通过的视觉样本。
原失败 suite 为 1453 tests、1447 pass、1 fail、5 skip；未删除该失败记录。
命令 UTC、exit、log SHA 见 `validation-green-receipt.json`（suite）和
`validation-complete-receipt.json`（check/validate）。
最后补充的原场景背景负控比单独 suite 多 1 项，已由最终完整 check 与 focused 28/28 覆盖；
没有倒改早先 suite 的 test 数。最终 check/validate 在最终 tracked 源码上通过。

首轮 check 在其他 Panel 的 dummy CLI executable 上失败，原因是本轮把 TMPDIR 约束在仓库
`.tmp/t`，无扩展名 CommonJS fixture 继承仓库 `type=module`，报 `require is not defined`。
只增加 `.tmp/t/package.json` 的中性 private package 边界（不强制 type），恢复普通外部临时目录
的 Node 模块探测行为。没有修改其他 Panel。最小红/绿与原失败环境探针通过；
`local-temp-module-boundary.json`、`local-temp-fixture-green.log` 保留证明，
原 `check-green.log` 失败未删除。该环境修正后重新跑完整 check，视觉采集没有重试。

真实六页最后严格四矩阵为 10,176 unique/full 行，partial、duplicate key、unmeasured、font
omission 均 0。下面使用保守 rotated-bounds 复核后的数值；原报告及复核前数值独立保留。

| route | 行数 / 有效分母 | own-fill 排除，非 pass | 含排除项 gate fail / 有效 gate fail | raw pixel fail | AA-qualified，非 raw pass | unavailable / 有效 unavailable |
| --- | --- | --- | --- | --- | --- | --- |
| GPU | 2544 / 2468 | 76 | 716 / 640 | 691 | 87 | 76 / 0 |
| browser | 2544 / 2468 | 76 | 76 / 0 | 0 | 0 | 83 / 7 |
| SVG | 2544 / 2468 | 76 | 897 / 821 | 856 | 60 | 76 / 0 |
| HTML | 2544 / 2468 | 76 | 76 / 0 | 0 | 0 | 76 / 0 |
| 合计 | 10176 / 9872 | 304 | 1765 / 1461 | 1547 | 147 | 311 / 7 |

几何 fail 为 1,645（有效 1,341）；raw pixel fail 的有效数为 1,485。832 个 ring 行的 ring
pixel fail 为 0，但原 frame composite 的 260 fail（GPU 123、SVG 137）完整保留。SVG 的
11 个预测 snap diagnostic 使含排除项 gate fail 从 1,776 到 1,765（有效 1,472 到 1,461），
这些行没有改称 pass。源报告在保守旋转复核前是含排除项 1,690 / 有效 1,386 gate fail，复核
不改变 PNG，只恢复严格旋转 bbox 限制并撤销不满足几何条件的 AA；没有采用 rotated-thin
豁免。五矩阵有 149 个新 bbox failure 没有单节点 isolation（strict 50 / fit 99），因此也不能
把全部计数称为已确认可见缺陷。阈值仍为 stroke centroid/width ≤0.35、edge ≤0.5 device px；
shape 只在 geometry pass 后使用 [1,2,1]/4 AA 的 0.1% / cluster 6，raw 独立保留。

文字选中 3,712 行，已测 3,710 行 gate/geometry 均 0，但 2 个 browser 行不可用，**不能声称
3,712 行全通过**。另保留 1 个 SVG text raw pixel diagnostic（沿用既有诊断语义，没有 blur）。
7 个有效 unavailable 全是 fractional-pan isolation 的严格 float32 transform guard 拒绝，均有
`ROUTE_CAPTURE_FAILED` 机械 reason；这是 route error 未满足 0 的阻塞，不是 GPU 崩溃。

| browser 缺图节点 | 类型 | GPU−browser panX（device px） |
| --- | --- | --- |
| ios-chat-11 | rectangle | +1.9073486328125e−6 |
| ios-chat-36 | text | −5.960464477539063e−8 |
| android-chat-42 | rectangle | −9.5367431640625e−7 |
| android-chat-37 | text | +1.1920928955078125e−7 |
| ios-panels-11 | rectangle | +1.9073486328125e−6 |
| ios-panels-51 | rectangle | −5.960464477539063e−8 |
| android-panels-52 | rectangle | +1.1920928955078125e−7 |

这些差异虽很小，但 fround bits 确实不同；没有引入 ULP/视觉 epsilon 放过 guard。原 R003
离线缺图 1 行仍保留在旧报告，本轮 7 行是不同 keys，不能互借为 pass。逐条 view/float32 bits
见 `final-guard-refusals.json`；主统计见 `final-real/summary.json` 和
`final-real/strict-audited-report.json`。原 full tile 的 partial 316 行与 effective unavailable
282 行也保留在 raw 证据，不能与 selected full isolation 的覆盖口径混用。

R003→R004 相同 10,176 keys 的 crop 对照：10,036 present crops SHA 相同、132 个不同、8 个
absent（旧 1 / 新 7）。132 项全是 frame 的 `isolation-full → full` 证据选择改变；逐条读取
对应 raw metrics，132/132 的全部四 route 原 raw ROI crop SHA 都相同。旧 full ROI 仅因子元素
pixel fail 触发 isolation，新 ring 不再触发；同 selection / 同 phase 的真实 crop 变化为 0。
8 个 absent 不算相同或 pass。`real-r003-crop-comparison.json`、
`real-r003-crop-delta-classification.json` 无 read error。此对照证明本轮静态像素没有在这些
相同 ROI 改变，不证明原差异已修复；2,036→1,461 的数字变化主要是归因口径收敛。

合成稿最后四严格矩阵已采集：752 full 行，42 gate fail（GPU 18 / SVG 24，browser/HTML 0），
16 unavailable，全部为 shadow 的 `STROKE_CONTOUR_VISIBILITY_MISMATCH_OR_TOO_FEW_MATCHED`；
route error、partial、unmeasured、font omission 均 0。464 个 text 行中 7 gate fail 为已知
`ranges-plain` / `stroke-text` native 残留；default Inter / Inter bytes 的 32 strict 行几何、
像素全部通过，不能据此替代 native 残留。合成稿 fit 的 116 text 行 geometry/unavailable 为 0，
known native/finite raw pixel 诊断仍保留。

与 R003 对同 752 keys 的离线比较证明：752/752 crop SHA 和 geometryFailures 数组完全相同。
新增 6 gate fail 全是 selector GPU/SVG 在前三严格矩阵的 ring 分母变化：mismatch/cluster
像素数原样，但检测分母聚焦轮廓后 ratio 越过原 0.1% 阈值。`rawCompositePixel` 与 R003
原 pixel 对象逐字段一致；default/Inter/ranges/stroked-text 的 64 个控制统计均 unchanged。
没有借用粗文字缓存改变静止输出。详 `synthetic-r003-delta.json`。

finite-offset 原 12 golden（3 节点 × DPR1/z1、DPR2/z1、DPR1/z2、half）全部 GPU raw crop SHA
及精确 SVG string 与 R003 相同，`finite12-comparison.json` passed=true；fixture 源也逐字节
相同。这里只补 half 的三个目标节点，不重拍完整 half 或 baseline。这是原有 golden 未退化，
不代表无 source HTML 导入的 8–12px 原点问题通过。

完整真实稿 fit 诊断为 2,544 行 / 有效分母 2,468，geometry fail 360、raw pixel fail 464、
AA-qualified 85、unavailable 169（排除 own-fill 后 93）、diagnostic failure 495。fit 文字
928 行均 available：GPU 232 行中 geometry 5 / raw pixel 2 / diagnostic fail 7；SVG 232 行中
geometry 5 / raw pixel 49 / diagnostic fail 53；browser/HTML 均 0。fit 是诊断，不因 gate 字段
为空而算 pass；下面 28 行 isolation 专门检验指定七个文字本身，口径不同。

fit 七节点为 `android-chat-5`、`android-panels-5`、`android-chat-103`、`android-chat-46`、
`android-panels-33`、`web-chat-190`、`web-panels-193`。本轮 fresh raw 与单节点隔离使用相同
device phase，隔离后 28 个 route 行的 geometry、raw pixel、diagnostic failure、unavailable、
route error 全为零；最大 phase 残差 1.14e−13 device px，DOM geometry 最大变化
0.000034242 CSS px。实际 fit zoom 为 web 0.65625、android-chat 0.8912556171、
android-panels 0.8408071995，未强行改为整数 zoom。

单节点小跑的 fresh raw 复现 3 项 GPU geometry fail 和 2 项 GPU pixel fail，移除无关 sibling
paint 后消失；该小跑没有复现旧 `android-chat-46` / `android-chat-103` 的 GPU geometry fail，
最终完整 fit 则有上述 5 项 GPU geometry fail，故不能说旧七项都已逐个确认为邻居污染。
隔离结果通过目标文字几何要求；整个 fit 仍是诊断组，不声称 parent
composite 或任意尺度全面通过。`m1/fit-isolated/report.json`、
`m1/fit-isolated-summary.json`、`m1/fit-raw-neighbor-diagnostics.json` 保留逐节点和布局证明。

## 实际看图与剩余阻塞

本轮已实际打开 `flow-box-candidate/dpr2-zoom2/gpu.png` 和 `html.png`，确认 start 细条宽度差。
也实际打开最终 `final-real/dpr1-zoom2-web-chat-0/gpu.png` 与 `html.png`：文字目视对齐，
“新对话”加号和 Skills/面板内部细竖条仍有粗细/位置差，不能用大矩阵统计归因为不可见而接受。
实际打开 `perf/final-cache/settled-retina.png` 与 `perf/final-ui/trusted-fractional-ui.png`，
确认三处普通/master/instance 文字清楚；真实 editor GUI 的 fake Host 恢复/Agent 提示仍可见，
不代表 Host persistence 验收。
实际打开最终 `final-real/dpr2-zoom1-fractionalpan-web-chat-0/{gpu,browser}-editor-gui.png`：
两者 zoom1、DPR2、pan40.75/44，真实 DOM wheel deltaX3.25、isTrusted=true，之后未校正对齐，
静止后正文清晰；加号/细图标残留仍可见。metadata 记录 stage1069×919、workbench chrome 保留。
实际打开最终 `final-real/dpr1-fit-view-web-chat-{gpu,browser}-actual-fit-gui.png`：正常 workbench
显示 66%，实际 zoom0.65625、pan62/131.375，正文清楚，GPU/browser 目视相近；保留完整
侧栏/chrome，没有以裁切或缩放拼图代替 GUI。七节点 native-copy contact sheet 与 web-chat-190
也已查看，隔离文字对齐但 parent 灰底差仍可见，未声称 parent composite 字节一致。

F1 通用规则不成立，flow/dynamic fallback 及传播导致的真实细线图标差仍是本轮核心阻塞。
M1d 的指定 pair 也不是同一个 float32，不能用该假设消除 route error。
不将不可观测、diagnostic、unavailable、AA-qualified 或 raw pass 互换成全面通过。
本轮没有扩展 F2 旋转规则，没有为已知差异重新做六矩阵基线。

即使六页局部指标变绿，也不覆盖以下后续问题：无 source HTML 的 finite-offset 导入仍有
8–12px 原点差；plain ranges / stroked text 的 native 路径；odd stroke rounded seam、
ellipse AA、image fit；Node SVG 无测量上下文的 central fallback。既有容差声明逐字节未改，
完整 render-fidelity / long-canvas fixture 源与基线逐字节一致。仓库没有可定位的 `T10` 标识，
本轮未改其既有控制范围，也不新造外部 T10 已独立通过的结论。

## 交接与重放边界

可直接审阅原始 `final-real/report.json`、`final-synthetic/report.json`，以及各自 `summary.json` /
`strict-audited-report.json`；原始 capture 与派生审计分离。`final-capture-receipt.json` 给出唯一
最终采集命令，`strict-visual-final-assertion.json` 给出失败条件，fit 与 finite 收据可独立复核。
小跑 red、撤回 patch、完整逐帧 perf、静止 PNG、失败日志和实际 GUI 均留在证据根，不写入 git。
`final-custody.json` 记录最终只读源、lock、348 文件功能测试清单与提交字节核对，全部一致；
也重验旧 807 PNG 和源报告 SHA，808 项均未变，node_modules 非 symlink。最终交付 SHA
由本轮回复及 `delivery-receipt.json` 给出，避免在文档中自引用其提交 SHA。

本轮保留 P1 生产修复与 M1 最小归因/测试增量；不合入被六 flex 否定的 F1 候选。下一次裁决需
先明确 layout materialization 与 DOM 1/64 差异的处理，以及严格不同 float32 视图的 route guard
策略，再谈细线图标全面验收。本轮已停止大矩阵采集，保留这组有界验证增量供 CC 裁决。
