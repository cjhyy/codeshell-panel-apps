# Design Studio：Figma / Auto Layout 24 小时优化

用户授权：持续对标 Figma，网页与设计工作台/Figma 往返转换，逐像素比较，
普通流布局保留 Auto Layout，不以绝对定位伪造还原。

- 开始：2026-10-21 00:31 Asia/Singapore。
- 截止：2026-10-22 00:31 Asia/Singapore（2026-10-21 16:31 UTC）。
- 主工作树：`/Users/admin/.codex/worktrees/design-studio-figma-24h-20261021/codeshell-panel-apps`。
- 分支：`codex/design-studio/figma-autolayout-24h-20261021`。
- 自动跟进：本聊天 heartbeat `figma-auto-layout-24`，30 分钟间隔。截止后停用。
- 安装/发布从稳定合并来源进行，不能让用户面板依赖临时工作树。

## 本轮发现与基线

现有 `html-fidelity`、`html2figma-cases`、`real-html-fidelity` 和 delivery 像素脚本
使用 `html-capture.mjs` 中的旧测量转换器。正式 HTML 导入默认走
`captureWorkspaceHtmlResult` → html2figma → `designNodeToV3`，必须另外验收。
旧 `real-html-fidelity` 仅因执行异常失败，没有像素阈值；delivery 允许最高 24 px
几何误差，不能据此声称 1 px 还原。

原结构比较器在相同坐标下会忽略文字内容、Auto Layout 和尺寸模式变化，错误返回通过。
本轮提交 `08fc4ab` 修复该盲区，包含默认值等价和流布局顺序回归。

正式导入基线证据：
`/Users/admin/.codex/worktrees/design-studio-figma-24h-20261021/evidence/baseline/`。
每个样例保留 HTML、v3、插件 transfer、原图、转换图和 6 倍增强差异图。

| 样例         |    初始不同像素 | 同宽重排不同像素 | 400 px 窄屏不同像素 |
| ------------ | --------------: | ---------------: | ------------------: |
| flex-fill    |               0 | 46,720 / 153,600 |     27,520 / 96,000 |
| nested-card  | 6,633 / 153,600 |  6,633 / 153,600 |     11,585 / 96,000 |
| flex-margins |               0 | 20,000 / 153,600 |     20,000 / 96,000 |

这表明首屏坐标吻合不代表编辑或重排正确。已确认显式固定交叉轴尺寸被 stretch 拉伸，
以及 HTML 尺寸意图与旧 Figma sizing 字段丢失。nested-card 文字还存在垂直基线误差。

## 持续工作队列

1. 合并并验证 HTML CSS Typed OM 尺寸意图、hug/fill/fixed 和交叉轴固定尺寸修复。
2. 合并并验证 Figma 旧 sizing 导入、绝对覆盖层无效 FILL 和单项 stretch 覆盖修复。
3. 正式导入像素脚本以零不同像素为默认门禁；`--record-only` 仅收集失败证据。
   原始不同像素计数不受容差影响。增加文字/换行、margin、Grid、wrap、SVG、图片和真实网页。
4. 修复 SVG 文字基线及窄屏文本重排差异；逐项比较，不降低阈值掩盖问题。
5. 使用真实本地 Figma 插件创建本任务新页面，导出官方 JSON 验证往返语义和几何。
   模拟插件测试、UI 转换器验证、真实 Figma 执行分别记录。
6. 检查正式面板编辑体验与组件/约束能力缺口，优先用户可观察的变形与丢失。
7. 每轮保存可复现证据与任务提交，适当回归通过后再集成。到截止停止新增功能并交付。

## 本地真实 Figma 入口

已通过 CUA 看到打开的验收文件 `CodeShell Design Studio 验收 2026-10-16`，
文件 key `fWRwpU21A8KKdTPM8cRs0R`；此前验收页面为
`CodeShell HTML Acceptance 6d740ada · CodeShell`。禁止覆盖旧图层，使用新页面。

既有未纳入 Git 的验收工具在稳定仓：
`artifacts/design-studio-figma-plugin/html-v3-acceptance-harness.mjs` 与
`bridge-acceptance-harness.mjs`。注册开发插件目录为同级
`CodeShell Bridge Acceptance`，ID `1692755466277882578`。
之前真实验收的 HTML 全部依赖 absolute，不能证明 Auto Layout 或逐像素达标。
当前 Figma 显示断线提示，需要如实记录同步状态。

## 本轮检查

- 新逐像素比较测试：3/3 通过，覆盖仅一个像素/通道变化、alpha、容差和尺寸不一致。
- 结构比较代理：28/28 相关回归、包校验通过。
- 24 小时目标仍在进行；不得将阶段结果描述为已完成 Figma 对标或全部 1 px 达标。

## 第一轮修复与真实验收（截至 00:48）

已整合到主任务分支：结构比较 `0510b97`、正式像素脚本 `0c37e38`、
Figma sizing `56d372d`、CSS Auto Layout `4820dae`、文字基线 `b3e6a60`、
真实 Figma 初始 Frame 尺寸恢复 `61e5d9d`。

- Flex fill 与 margin 两例：640 px 导入、640 px 重排、400 px 重排，全部 0 个差异像素。
- nested-card：原宽差异由 6,633 降至 96；96 个全是矩形背景小数边缘的抗锯齿，
  最大通道差 10，字形像素完全一致；400 px 仍有 6,293 个差异，正在修复换行。
- 多字体独立回归：明显位移像素归零，精确比较仍有 32 个轻微边缘差异，不能声称严格全零。
- 串行 Design Studio 全套阶段检查：主阶段 344 通过/1 可选跳过，UI 阶段
  88 通过/1 可选跳过；0 失败。该次基于 `b3e6a60`；随后 `61e5d9d` 的
  bridge/plugin/binding 70 项针对性测试通过。
- 独立工作树 `npm ci --ignore-scripts` 安装所锁依赖；未改动稳定主仓的 node_modules。

真实 Figma 第一次 Auto Layout 验收暴露出模拟测试遗漏：设置 `layoutMode` 时，Figma
先按默认 AUTO 主轴收缩 Frame，640 → 584（恰为两子项宽度之和），之后设置 FIXED
使错误宽度固化；填充子项 484 → 428。修复在配置布局之后、设置子项 FILL 之前恢复
源尺寸；最终自身 HUG/FILL 仍在后续设置。新增模拟原生即时重排的测试复现并锁定该错误。

第二次真实 Figma 验收通过，官方 JSON 4 图层，1 个原生水平 Auto Layout，
FILL 子项保留，全部几何最大误差 0 px；仅创建本任务新页面，无删除操作。
真实页面为 `59:22` / `CodeShell HTML Acceptance f272303c · CodeShell`，
主 Frame `59:24`。Figma 仍显示断线提示，因此不声称已完成云同步。

未修改生产 main；临时 UI 仅附加 nonce localhost 消息驱动，调用正常生产导入/导出协议。
两轮 relay 均已结束，临时 UI 及网络权限已移除，保留 cleanup 回执：
稳定仓 `artifacts/design-studio-figma-plugin/acceptance-runs/` 下
`real-figma-html-v3-1792514468793-d5f7b7d4`（复现失败）与
`real-figma-html-v3-1792514700655-f272303c`（修复通过）。

真实 Figma UI 1x PNG 导出原宽 `640×240`，严格 RGBA 比较 153,600 像素全部相同。
证据：主任务 `evidence/real-figma/native-flex-fill-640.png`、
`native-flex-fill-640-diff.png`、`native-flex-fill-640-pixel-report.json`。
真实 Figma 原生控件将父 Frame 缩窄到 400 px，再以 1x PNG 导出，96,000 个像素
全部相同；固定子项仍 100 px，FILL 子项正确吸收剩余宽度。官方 640 px JSON
经正式 `importFigmaJson` 导回工作台并导出 SVG，再截图比较仍为 0 个差异像素，
水平 Auto Layout / fixed / fill 均保留。此真实样例仅含形状，没有验证文字/图片。
清晰范围回执为 `evidence/real-figma/acceptance-report.json`；旧 relay 模板原始报告
仍有未使用的 title/PNG 字段，不能据此声称本轮测试了它们。临时插件最后已恢复
逐字节原始备份，回执 `plugin-restored-receipt.json`。

官方 Bootstrap Pricing 网页已保存自包含原始 CSS/媒体查询样本（245,389 字节）。
来源和改动回执在主任务 `evidence/web-bootstrap/receipt.json`。
1280×1000 / 768×1000 正式导入初始/同宽重排/窄屏差异为
16.79% / 21.82% / 30.34%；255 个可编辑节点。主要问题是标题与浅色表头、
SVG use 引用丢失、布局重排。对应 `evidence/bootstrap-production/`，
不得将收集模式的退出码当成通过。已分派保持文本与布局的针对性修复。

浅色表头原因已确认并修复：CSS `rgba(33,37,41,.03)` 先前丢失 alpha 变成深色，
现在沿用 v3 `fillPaints` 保留透明度，文本仍可编辑；最小卡片严格 RGBA 差异为 0。
任务提交 `93d39e8`。SVG 的本地 symbol 引用独立修复中。

像素采集显式等待字体与两帧绘制；原生 authored absolute/fixed 覆盖层按源样式清点，
不误报为转换把正常流布局降级。新增完整生产管线 overlay 回归 0 像素通过。

下一轮工作树：

- `design-studio-html-text-reflow-20261021/codeshell-panel-apps`：plain-text 容器和浏览器实测换行。
- `design-studio-html-paint-fidelity-20261021/codeshell-panel-apps`：真实网页颜色/文字/SVG。
- 主像素脚本新增 portable 资源验证、可配视口与真实浏览器 layout 环境，继续补充回归。

## 第二轮（文字编辑、实际画布与原生 Figma 文字）

`06f5556` 已修复普通文字块的 Hug/Fill、真实字体换行、同宽文字/字重变化、
Hug 标签变宽及祖先/后续内容重新排版。保留既有字段，仅增加可选文字测量来源签名；
Node 无真实测量器时仍明确采用估算，像素门禁在浏览器中实际排版。
全部三样例初始/同宽/400 px 结果：两个纯布局样例始终 0；文字卡片始终
96 像素、最大通道差 10（源 CSS 与 SVG 背景矩形的小数边缘抗锯齿），
不再因窄屏出现明显文字位移。证据 `evidence/phase2-fidelity/`。

`01a612d` 修复独立审查发现的 STRETCH 语义分叉：插件与编辑器对 fixed/hug +
self:auto 维持一致，CSS 确定尺寸通过显式 self:start 避免拉伸。
16 组横纵/尺寸/对齐组合对照编辑器结果，71 项插件相关回归通过。

正式工作台默认使用 **CanvasKit WebGL2**，没有 SVG 场景作为默认后备。
因此已增加使用隔离内存 Host、真实面板 UI、DPR=1/zoom=1/整数 pan 的实际画布对照：
两个纯布局样例 0 像素；文字卡片 4,120 像素不同，最大通道差 240，
排除外围 2 px 后仍相同，非编辑器边框。画布 SVG 数 0，工作区写入数 0。
证据和复现脚本在 `evidence/ui-renderer-parity/`，渲染器修复中。

真实 Figma 文字卡片也已创建本任务新页 `CodeShell HTML Acceptance 24697ffd · CodeShell`，
12 图层含 4 个文字，原生 1x PNG 仍有 4,443 / 153,600 像素不同，最大通道差 240。
所有容器几何与方向/尺寸关系保留，文字自身使用 Figma 行框；v3 的文字 y 为 SVG hanging
锚点，两者不能直接用同一 y 断言比较。Figma 原生 Hug 字宽也与浏览器小数宽度存在差异。
采集工具还曾错误比较官方省略的默认 gap undefined 与 0，原始失败保留用于改进工具。
逐像素失败是真实的，不能因为容器几何通过就忽略。

该次原生证据：`evidence/real-figma/native-nested-card-640.png`、差异图、
像素报告、`text-07-official-source-after.json`、`text-region-diagnostic.json` 和
`text-native-boundary.json`。relay 已停止、临时网络权限已移除、原 scratch 插件恢复。
下一轮应分清字体版本/字宽、文字行框、Skia 与浏览器抗锯齿，优先修复可观察偏移，
不得靠固定宽度或光栅化把 Hug 文字伪装成原生匹配。

第二轮集成后的 targeted 81/81、validate、typecheck、build:check 和两插件确定性检查通过。
等待 SVG 引用修复和实际 CanvasKit 文字修复后，再跑完整串行 Design Studio 门禁。

## 第三轮与后续工作入口

- `24f10c5`：SVG href/xlink 引用链、符号定义、XML 命名空间和 currentColor 保留。
  真实 HTML → v3 → portable → 插件 UI 资源转换的最小样例严格 0 像素差异。
- `74e668c`：内部 CSS opacity 冻结到 SVG；根 opacity 只由 v3 图层应用一次。
  包含分组、path、use、外部 symbol 定义的透明叠加回归从 1,728 像素降为 0。
- `82e0887`：CanvasKit 系统字体的 Canvas2D 测量/缓存绘制显式使用 normal 字偶距。
  原默认 auto 在标题测量得到 240 px，与 SVG 的 239.109375 px 不同。
  原始 Canvas2D 与 SVG 标题直接对照现在为 0 像素差；GPU 保持原 2× 缓存质量后，
  全卡片差异 4,120 → 3,750，最大通道差 240 → 101，平均 RGBA 误差
  0.7141 → 0.3432。仍非严格全零，不改变设计几何或字体来掩盖采样差异。

第三轮串行完整 Design Studio 门禁基于 `24f10c5`：主阶段 355 通过/1 可选跳过，
UI 阶段 88 通过/1 可选跳过，合计 443 通过/2 跳过/0 失败。
随后两个 scoped 修复：GPU UI/cache 11/11；SVG runtime/import/adapter/HTML plugin
针对性检查通过。最终日志在主任务父目录：`combined-design-final.log`、
`gpu-kerning-final.log`、`svg-opacity-final.log` 与 `checkpoint-*.log`。
两插件和 vendor 可独立确定性重建，未编辑任何用户已有设计或生产安装。

Bootstrap 初始基线与 SVG 修复后的严格像素比例：

| 状态             | 初始基线 | alpha + SVG 修复后 |
| ---------------- | -------: | -----------------: |
| 1280 px 初始导入 |   16.79% |             12.80% |
| 1280 px 同宽重排 |   21.82% |             19.70% |
| 768 px 重排      |   30.34% |             28.75% |

较大剩余差异包括 CSS 渐变/各边描边/阴影与表格或普通块流的布局语义；
不能只挑简单零误差样例替代这个真实网页门禁。证据 `evidence/bootstrap-after-svg/`。

下一次继续的明确优先事项：

1. 可编辑线性渐变：现有 v3、Figma 插件、CanvasKit 都支持 GRADIENT_LINEAR，
   HTML 适配器却仍降级纯色。Bootstrap body 使用到 100 px 的渐变，
   上游 parser 丢失了 px stop 单位；在维护的 integration 边界保留原始 CSS，
   按 box 尺寸生成精确 handles/百分比或像素 stops/alpha/层次。禁止光栅化背景。
2. Figma 原生 GRID：官方现有 GridTrackSize、gridColumnSizes/gridRowSizes、
   gridItemsPositioning ROW_AUTO_FLOW 能表达规则 Grid。现有 bridge/plugin
   仍主动转固定几何；先核对当前实际 API，再对可表示子集保留原生 Grid，真实验收。
   官方入口：`https://developers.figma.com/docs/plugins/api/GridTrackSize/`、
   `https://developers.figma.com/docs/plugins/api/properties/nodes-griditemspositioning/`。
3. 修复实际工作台 GPU 字形缓存的采样相位/抗锯齿差异，保留可编辑文字，
   不通过降低严格门禁阈值宣称成功。已有变体数据在
   `evidence/ui-renderer-parity/text-context-variants.json`。
4. 扩展真实网页到 Grid、wrap、表单、导航、混合文字，区分语义问题与渲染器 AA。
5. 继续真实 Figma 文字验证，区分字体版本/原生 Hug 宽度取整与行框/字形来源。
6. 完成最终集成与稳定安装验证后，才清理本任务已整合的工作树；不要清理其他任务。

当前任务源码仍在隔离分支，未发布、未更新生产安装。24 小时目标保持 active，
下一次不要重新开始或重复复制旧工作树；读最新日志和 Git 后继续尚未完成的队列。

## 第四轮：原生渐变、自动外边距和扩大网页样本

`a079292`（代理原提交 `5a4550d`）保留可编辑 CSS linear-gradient：维护的捕获边界
保留原始计算 CSS，转换 px/%/隐含色标、物理角度、非正方形方向、透明端点与图层顺序。
同时补上独立 HTML-to-Figma 插件入口；未修改固定版本上游源码。独立审查修复了
缺失/重复源 ID 使渐变串到其他节点的问题。

- 精确样例 480×360：初始/同宽重排 172,800 像素全部相同；该样例没有验证缩窄。
- Bootstrap Pricing 255 个可编辑节点，初始/同宽/768 px 差异由
  12.80% / 19.70% / 28.75% 降为 **4.87% / 11.77% / 21.39%**。
- 平滑透明渐变仍有 20,268 像素不同，最大通道差 1；严格门禁 `passed:false`，
  没有降低阈值或把透明色标预合成为不可再编辑的纯色。
- 61 项定向测试、typecheck、validate、三个确定性构建和 Design Studio build:check 通过。
  代理工作树的全仓 build:check 报无关 Video Studio 生成哈希差异，未改动那些文件；
  最终集成后应在主任务独立依赖环境重新检查。
- 证据：`evidence/html-linear-gradients/receipt.json`、`exact/`、`smooth-alpha/`，
  以及 `evidence/bootstrap-after-gradients/`。

`cbc33e0`（原提交 `9d7058d`）修复可表达的 CSS 自动外边距。固定版本上游会先把
已解析为像素的 auto margin 包进静态 padding，单纯在适配器改 alignSelf 仍会冻结位置。
现在有界恢复原始子项，主轴单项自动外边距保留父布局对齐，交叉轴使用透明的垂直/水平
Auto Layout 包装框，保留内容最小尺寸，避免溢出时向 cross-start 错移。
不支持的多项、混合非零或特殊换行组合继续明确诊断。

独立审查找到并修复了 root-relative 坐标重复相加、包装框克隆绕过源图重复引用检查、
以及交叉轴直接 center/end 导致溢出错误；原始图先执行有界引用/深度/数量校验。
14 个真实浏览器最小布局的导入/同宽/400 px，42 张转换图严格零像素差；另有坐标/图校验
回归。合计适配器/HTML/新用例 30/30 通过，validate 与 diff 检查通过。
包装框最小尺寸来自导入时内容；动态 Hug 内容修改仍需核对/同步这个派生最小值，
已有针对性诊断，不能据此声称所有 CSS margin 或任意编辑都已完全等价。

真实 Figma 本轮页面 `CodeShell HTML Acceptance d3faaaca · CodeShell`：4 个形状/容器节点、
2 个原生 Auto Layout，包含 300 px 子项在 240 px 父级中溢出。官方 JSON 几何最大差 0。
原生 1× PNG 640×240 严格比较 153,600 像素全同；官方 JSON 导回工作台后，初始和重排
仍全部相同。证据 `evidence/real-figma/auto-margin-acceptance-report.json`，包含原生图、
差异图、往返文件和清理回执。只覆盖形状，没有文字或图片；Figma 仍提示离线未同步。
relay `real-figma-html-v3-1792516785957-d3faaaca` 已停止，临时权限移除，scratch 插件三个
文件恢复原始备份，插件 UI 已关闭。

新增官方 Bootstrap 结算、相册、登录三种静态自包含网页。CSS、媒体查询、图片原字节
保留，移除脚本/主题菜单、未提交任何表单；每份保存 URL、哈希、原 HTML 和准备回执。
证据入口 `evidence/prepare-web-corpus.mjs`、`evidence/web-corpus/<id>/receipt.json`。
原始基线均使用正式导入而非旧转换器：

| 样本 | 1280×1000 初始不同像素 | 同宽重排 | 768×1000 重排 |
| --- | ---: | ---: | ---: |
| checkout | 36,031 | 306,642 | 275,986 |
| album | 117,331 | 338,387 | 354,297 |
| sign-in | 4,631 | 7,161 | 90,616 |

自动外边距修复后 sign-in 窄屏降至 **14,914**；初始与同宽暂不变，普通块流仍有
`Flow children became absolute`，边框/圆角/表单样式也未完全保留。不要把新样本的
收集模式退出码当成达标。

当前并行工作：

1. `native_figma_grid_round2`：原生 GRID、可选规范轨道/锚点/尺寸/流向、官方 JSON 往返。
   独立审查已找出并修复/跟进：不可信巨大 span 的放置循环、跨 HUG+FLEX 的固有尺寸、
   重叠 HUG span 的批量分配、小于 1 的 fr 总和。代理完成后必须实际 Figma 验收；
   `/tmp/codeshell-native-grid-{manual,flow}.codesign.json` 是阶段 fixture，最终版本由代理更新。
2. `linear_gradients_round2` 已转 GPU 采样独立任务，拥有干净工作树
   `design-studio-gpu-text-sampling-20261021/codeshell-panel-apps`（基于 5546e07）。
   查设备采样相位，保留高缩放质量/缓存预算/旋转与实例语义，禁止随意降 AA 门禁。
3. 下一项真实网页优先补普通块流和不均匀 margin、各角圆角/各边描边，继续真实 Figma
   渐变/文字核对。源文档和可编辑关系必须与像素证据一起检查。

第四轮工作仍在隔离分支，未发布/未安装，目标保持 active。截止时间仍为
2026-10-22 00:31 Asia/Singapore，不能提前标记完成。

### 原生 Grid 集成及真实 API 新发现（约 01:35）

`17850af`（原提交 `ea176eb`）已集成：可选有界 Grid 轨道/行数/流向/锚点/轴对齐，
共享布局与 CSS 导出、原生 Figma GRID 创建、官方 JSON 补充真实 API 字段、公共编辑工具。
独立审查实测并修复跨度未校验导致的循环、HUG/FLEX 跨列、重叠 HUG 跨列的顺序依赖、
小于 1 的 fr 总和、自动行增删。139 项相关测试、7 项生产 UI、6 项 CLI 和构建/类型/校验通过。
明确诊断 FILL 与 HUG 轨道固有尺寸循环、带空隙的手动自动行、来源绑定 Grid 属性补丁等限制。
`f0ddad6` 补齐集成后独立 HTML 插件的生成依赖；13 项插件测试通过。主任务环境全仓
typecheck、validate、build:check 均通过，之前代理的无关 Video Studio 哈希差异未复现。

真实 API fixture 从 `tests/fixtures/design-studio-native-grid/source.mjs` 派生，先执行规范重排，
再通过生产插件导入；这两例不是网页捕获，不能与 HTML 生产像素用例混淆。

- 手动：run `real-figma-html-v3-1792517353573-53908e65`，页面 `62:50`。
- 自动行流：run `real-figma-html-v3-1792517389124-3571b180`，页面 `62:56`。
- 两例均有原生 Grid、3 列 FIXED100/FLEX1/FLEX2、固定与 Hug 行、跨两列、独立轴对齐，
  官方字段匹配；4 个容器/形状几何最大误差 0；第 5 个是原生 Hug 文字，内容/结构保留，
  未把其字体测量差纳入几何通过结论。官方 JSON 导回仍为 grid，无警告。
- 隐藏 flow：run `real-figma-html-v3-1792517416323-ec153941`，真实 Figma 跳过首个隐藏
  span2 项，实际只需 1 行。旧计划仍计 2 行，原始验收失败；导回还因隐藏项官方锚点
  `-1/-1` 被误判而丢失 Grid。真实 JSON 已发给代理修复。隐藏层保留原始 inactive sizing
  的现代/旧字段差异，不能推断“再显示时 FILL 恢复”等未经实机观察的行为。
- 隐藏样例原生 1× PNG 440×128 与规范 SVG 图像 **56,320 像素全部相同**，仍同时记结构
  往返失败；这再次证明像素通过不等于布局语义通过。

证据都在 `evidence/real-figma/native-grid/`，有三个输入、原始官方 JSON/报告、清理回执。
`roundtrip-pre-hidden-fix.json` 保留回导失败。三个 relay 均已停止，scratch 三文件再次
恢复原始备份，插件 UI 已关闭；后续不要误以为还有活跃 relay。

真实渐变也已创建任务新页 `CodeShell HTML Acceptance 44d34d69 · CodeShell`，
run `real-figma-html-v3-1792517049937-44d34d69`。3 个原生 GRADIENT_LINEAR 层与几何保留，
但原生 PNG 有 **89,119 / 153,600** 像素不同，最大通道差 2，平均 RGBA 误差 0.2718。
这是严格失败；不能把此前 Chromium SVG 的零差异推广为真实 Figma 渐变也全零。
证据 `evidence/real-figma/gradient-native/native-report.json`、原始 JSON/HTML、PNG/差异图。
relay 已停、临时权限移除，未修改原有用户页面。

真实 HTML 等宽 Grid 新门禁：`evidence/html-grid-native/source.html`，640 px / 400 px，
初始/同宽 0，缩窄 **37,760** 像素错误；没有警告。固定版本上游已把原 Grid 改写为
vertical + `grid-row` horizontal 框，行框和 auto 子项的宽度被固定。下一项需在维护边界
保留 CSS 轨道与 Fill 意图，再做网页 → 原生 Grid → 官方 JSON → 工作台的完整验收。

仍在进行：原生隐藏 Grid 修复；普通块流（代理正在补 text-metrics 末尾空格换行修复）；
GPU 的有界物理 1× 设备采样变体。GPU 试验把字形差异降到 180 个/max1，其余 96 个为
已知背景边缘；所有不适用变换仍需使用保留的 2×/高缩放主缓存，尚待代理提交。

### 隐藏 Grid 已完成真实往返修复（约 01:40）

`381213f`（代理原提交 `f58d619`）已集成隐藏 Grid 修复，103 项针对性检查通过。
原始官方隐藏锚点 `-1/-1` 仅留在来源绑定，不进入规范字段；所有隐藏输入仍先校验有界
span/锚点，再排除其占用。原生创建用临时有界放置保留隐藏跨度与位置，最终只计算可见行。
新增仓库 fixture 只保留本任务合成 Grid 子树，删除了账号、文件和其他页面上下文。

重测 run `real-figma-html-v3-1792517820440-82fe2bdd`，新页 `62:68` / `82fe2bdd`：

- 官方仍是原生 ROW_AUTO_FLOW + ROWS，3 列、1 个 FIXED40 行，5 层含 1 个隐藏层；
  可见容器/形状几何最大差 0。
- 原生导出 440×128 PNG，**56,320 像素全同**。
- 官方 JSON 导回仍是 Grid，无警告；首次显示与再次规范重排也各为 **0 差异像素**。
- 清晰范围回执：`evidence/real-figma/native-grid/hidden-flow-fixed-acceptance-report.json`。
  fixture 为规范/native API 生成，未声称网页捕获；文字不在本例中。自动行预期独立指定
  为 1，不能拿原始声明 `gridRows:2` 当动态实际行数。隐藏项 inactive sizing 未做显隐切换
  验收，不推断显示时 FILL 的恢复行为。
- 所有 relay 已停止，原 scratch 插件三文件恢复，插件 UI 关闭。新 PNG 和官方 JSON
  都已存入主任务 evidence，后续可直接读取，无需重做旧用例。

当前主任务 HEAD 在 `381213f` 之后只有本日志改动；最新编译基线通过 typecheck、validate、
全仓 build:check，三个插件/vendor 确定性输出已检查（隐藏修复后的独立 HTML 插件也未过期）。
完整 Design Studio 串行门禁等下列合并后再跑，避免读到并行编辑中的源码。

活跃代理/所有权：

1. `native_figma_grid_round2` 现在拥有新的 HTML Grid 工作树
   `design-studio-html-grid-boundary-20261021/codeshell-panel-apps`，基于 `381213f`，
   分支 `codex/design-studio/html-grid-boundary-20261021`。在维护的转换边界恢复原始 Grid
   子项/轨道（上游不可改），处理适配器 Grid 分支/sizing()；与块流代理约定不交叉。
2. `auto_margin_review` 已转实现普通块流，工作树
   `design-studio-html-block-flow-20261021/codeshell-panel-apps`，基于 `59c3179`。
   不碰 Grid 分支/sizing()，已有初步 sign-in 全流布局结果；修真实测量器在行尾空格上
   错误提前换行的问题，允许修改 `text-metrics.mjs`，保留源字符和显式换行语义。
3. `linear_gradients_round2` 正实现 GPU 的独立物理 1× 变体，工作树
   `design-studio-gpu-text-sampling-20261021/codeshell-panel-apps`，基于 `5546e07`。
   保留 2×/高缩放主缓存，非整数平移/缩放、旋转/实例用主缓存；设备变体共用原预算，
   有容量压力时先放弃变体。已测主缓存缩放到 4× 输出不变、移动相位不累积缓存、DPR2。
   最后还在修离开视口导致 active 集合变化、全场景/瓦片反复重建的性能问题，补多文字
   平移/返回计数回归。精确 RGBA 结果需按 GPU 后端记录；强制 ANGLE 与默认 Vulkan 的
   舍入也不同，不能把某个后端单标题零差异推广为全部字体/驱动都零。

主分支和生产安装仍未改动，24 小时目标继续 active，截止时间不变。
