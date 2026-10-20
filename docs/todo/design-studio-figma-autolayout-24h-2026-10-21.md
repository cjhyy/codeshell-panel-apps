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

| 样本     | 1280×1000 初始不同像素 | 同宽重排 | 768×1000 重排 |
| -------- | ---------------------: | -------: | ------------: |
| checkout |                 36,031 |  306,642 |       275,986 |
| album    |                117,331 |  338,387 |       354,297 |
| sign-in  |                  4,631 |    7,161 |        90,616 |

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

### 网页 Grid、普通块流、圆角及原生文字新问题（约 02:04）

本阶段已合入（仍在任务分支，未安装/发布/推送主分支）：

- `7b1f87d`：物理 1× 的独立文字采样变体，保留 2×/高缩放主缓存、共享原预算。
  实际画布卡片从 3,750 降到 **276** 个差异像素，最大通道差 9；其中字形 180/max1，
  其余 96 是背景边缘。2× PNG 与原主缓存逐字节相同。不同 GPU 后端仍有严格失败，
  不改像素门限。缓存平移/返回、视口外文本、相位编辑、旋转/实例/DPR 等 15 项检查通过。
- `754026c`（代理 `1d2f3bf`）：维护的浏览器边界保留原始 CSS Grid 子项和 Typed OM 轨道，
  支持有界 FIXED/FLEX/HUG、行流、跨度/锚点/轴对齐。百分比 gap、content-box 100% 溢出、
  部分/混合定位、dense/column、自动重复等有明确诊断。后项失败会清除所有父级 cell 字段，
  不破坏子项自己的嵌套 Grid。独立 HTML 插件仍使用有诊断的旧合成 Flex 行路径；不能将
  工作台的原生 Grid 结论推广给独立插件。111 项代理检查通过。
- `4aabcce`（代理 `7675459`）：普通块流恢复为纵向 Auto Layout，保留折叠间距、安全
  auto 居中、来源路径、边框内容缩进和 content-box min/max。修复尾部空格错误提前换行。
  发现上游将 `max-width:100%` 读成数字 100，原适配器将其当 100px；现按单位捕获，
  不可表示的百分比限制有明确诊断，不再静默使用 100px。72 项代理检查通过。
  合并 Grid/块流冲突保留两条计划，并去重 Typed OM 属性；83 项合并检查全通过。
- `080e4ca`（代理 `283459a`）：可选 `cornerRadii:[TL,TR,BR,BL]` 贯通保存/Schema、
  SVG/祖先裁剪、CanvasKit/图片裁剪、前端 CSS、HTML 捕获、原生创建和来源绑定更新。
  保留旧统一圆角；百分比/椭圆/非均匀变换和原生大圆角表示限制有诊断。独立审查修复
  Schema 条件位置、图片外阴影误裁、统一与等值四元组的假冲突、稀疏数组 NaN 漏洞。
  Chromium SVG/CSS 640/400 各为 0；CK Metal 397/144,000 像素不同/max72，边缘 AA
  仍是严格失败。原生真实圆角及大圆角尚待 root 验收。代理 183+40 项针对性检查通过。
- `129158f`（代理 `71095e2`）：生产像素工具支持显式本地资源文件夹，浏览器参考与生产
  捕获使用同一只读字节快照，保留 512KiB HTML/CSS、8MiB 单项/12MiB 总资源上限，
  拒绝符号链接/路径逃逸。支持自定义根选择器，测试用 `main#app`。9 项检查通过。

真实网页 Grid 验收已完成：run `real-figma-html-v3-1792518820803-ff36a910`，
页面 `62:74` / `CodeShell HTML Acceptance ff36a910 · CodeShell`。
输入是真实 HTML 生产捕获，而非手工规范 Grid fixture。8 个节点，1 个原生 GRID，
初始容器/形状几何差 0。手动修改内部 `main#fixture` 640→400 后，6 个子项仍为
AUTO/FILL，宽度从 192→112；3 FLEX 列和 2 FIXED80 行不变。

- 真实 Figma 1× PNG：640×240 和 400×240，均 **0 差异像素**。
- 官方 JSON 导回：两尺寸的首次显示与再次重排，四次也都 **0 差异像素**、无警告。
- 证据 `evidence/real-figma/html-grid/acceptance-report.json`、各宽度 JSON/SVG/PNG/差异图。
- 限于容器/形状，无文字/图片。已有 `HTML viewport` 是固定包装框，验收改的是内部
  `main#fixture`；没有声称只改 viewport 就自动表达 100% 子宽度。
- 原生 relay 已停，scratch 插件三文件恢复最初备份字节，插件 UI 已关闭。Figma 仍离线
  提示，未声称云端同步成功。

真实普通块流验收：run `real-figma-html-v3-1792519002465-b1460372`，页面 `62:83`。
10 个节点/6 个原生 Auto Layout 容器/2 个可编辑文字层，初始容器/形状几何最大差 0。
文字几何单独记录，不纳入容器通过结论，hanging origin 与原生 line-box top 相差 4.59px。

| 操作                   | 卡片宽/高 | 段落宽/高 | 后续蓝块 y |
| ---------------------- | --------- | --------- | ---------- |
| 初始 640               | 600 / 144 | 576 / 48  | 132        |
| 内框缩至 400           | 360 / 168 | 336 / 72  | 156        |
| 原生改为更长的连续文字 | 360 / 240 | 336 / 144 | 228        |

这些证明真实 Hug/Fill 与改字重排，但没有达到文字像素一致：原生 PNG 差异像素为
4,975 / 5,803 / 11,864；生产浏览器 `prepareFigmaImport`（确实测量 2 个文字）再导 SVG，
分别 9,040 / 9,426 / 18,511。原始 Node 未测量导入结果另存，不能冒充生产 UI。
所有参考/原生/导回和精确管线说明见 `evidence/real-figma/html-block/acceptance-report.json`。
该 relay 也已停止并恢复 scratch 原文件，无活跃临时服务。

本次原生验收进一步发现两项不能忽略的文字问题：

1. 原文存在 `.textSource`，但 `.text` 包含浏览器软换行；插件直接把 `.text` 写入
   `characters`，制造了源文没有的换行，影响后续响应式。已交 `auto_margin_review`
   在新 `native-text-source-20261021` 独立分支修创建/更新/绑定语义，显式换行必须保留。
2. Figma TEXT 的 bbox.y 是行框顶部，当前导入直接当成 SVG hanging origin。
   浏览器测量只调整宽/高，不映射该原点；已交 `linear_gradients_round2` 新独立任务，
   使用字体度量和已有 `layoutBaselineOffset`，不能硬编码某个字体的 4.59px。

复杂网页的块流最终对比（初始 / 同宽重排 / 768 窄屏），与准确 base59 相比，两页重排
回归已因单位修复消除；仍不是严格通过：

| 页面     | 最终像素差异                | 相对 base59 的重排 / 窄屏变化 |
| -------- | --------------------------- | ----------------------------- |
| sign-in  | 4,634 / 4,638 / 13,771      | −2,523 / −1,143（初始 +3）    |
| checkout | 36,031 / 280,778 / 266,419  | −25,864 / −9,567              |
| album    | 117,331 / 228,847 / 307,495 | −109,540 / −46,802            |

剩余例子不是泛称“媒体查询”：Checkout `.row.g-5` 的负外边距仍是测量布局，
768 下源宽 792、规范宽 984；购物车列源为 41.6667%，仍保留捕获时固定 328px，
现有 `css-percentage-size-fixed` 诊断。代理证据有 exact base/new 768 文档与节点框差。

新增公共样本是官方 Pico v2 HTML 和 GOV.UK Check answers：旧内嵌源/原始来源/哈希、失败
尝试均保留；本地资源派生没有改 CSS 规则，两个宽度与旧源截图逐字节等价。
Pico 492 节点/81 警告，基线 24,804 / 30,323 / 107,398；GOV 185 节点/27 警告，
27,203 / 27,410 / 62,622。两者 Flow children became absolute，严格失败。记录在
`evidence/web-corpus/local-assets-harness-summary.json`，没有外部请求或浏览器错误。

最新新回归：`gradient-responsive-angle/source.html`，Fill 子框的固定 45deg 渐变在
640 初始/同宽均 0，400 窄屏却 **22,783** 像素不同/max59。保存的是捕获时归一化 handles，
尺寸改变后物理角度旋转。已交 `native_figma_grid_round2` 新独立 responsive-gradients 任务，
保留可编辑 CSS 意图并诊断原生表示限制，不伪称 Figma handles 能表达所有动态 CSS 行为。

当前合并验证：405 项主测试通过、1 跳过、0 失败；全仓 typecheck、validate、build:check
通过，所有 vendor/两插件输出重建。完整 UI/GPU 门禁正在串行跑，结果待下一条日志记录。
24 小时目标继续 active，截止仍为 2026-10-22 00:31 Asia/Singapore。

### 原生圆角边界、原文修复已实机复验（约 02:20）

完整合并 UI/GPU 门禁已通过 **95 项、1 跳过、0 失败**；此前主门禁 405 项/1 跳过/0 失败。
本地资源工具合并后另跑 9 项全通过。不要重复累加有交集的针对性用例冒充完整门禁。

实际四角验收：

- run `b5fa002e` / 页 `62:100`，5 节点；原生四角 `[8,24,0,16]` 和 `[0,12,28,4]`
  与容器/形状几何保持。640/400 原生 PNG 分别 **174/173** 像素不同，max81；这些点
  都在源圆弧 0.75px 内。官方 JSON 导回后首次显示/重排，两个尺寸的四次比较全部 0。
- run `070ad93c` / 页 `62:106`，100×100 单个 80px 圆角原值仍为 `[80,0,0,0]`；原生
  149 像素/max50，差异也都在源圆弧 0.75px 内，不能声称半边长 50px 的硬钳制。
  导回有 2 像素/max6，严格失败保留。
- run `ce5211cc` / 页 `62:111`，相邻 `[80,80,20,0]` 原值仍保留；原生 264 像素/max189。
  有 34 个差异像素距离 CSS 有效圆弧超过 1px，另有 18 个位于源圆角区域外，因此不只是
  普通边缘舍入。CSS 共同缩放是 `[50,50,12.5,0]`；另一组 `[50,50,20,0]` 参考把最大差
  降为 51，提示真实缩放规则不同，尚不推广成所有半径的完整原生算法。导回 2 像素/max2。
- `78f4188` 据此修正诊断：从“有效半径超过半边长”改为“相邻原值实际需要 CSS 共同缩放”。
  避免单个 80px 的误警告，同时不遗漏 `[80,80,20,0]` 这种有效值均不超过 50 的真问题。
  40 项圆角/原生插件检查通过，生成 UI 一起提交。
- 首次脚本 `a683c097` 因 Freeform 下 authored absolute 子项缺省 inactive FIXED 字段误失败；
  原始失败证据保留，后续脚本按几何和有效 Auto Layout 字段验收，没有放宽像素门限。
- 清晰范围回执在 `evidence/real-figma/corners-native/acceptance-report.json`，包含三个 run、
  原生/导回原始计数及边缘距离分类。所有 relay 已停止，原 scratch 三文件恢复，UI 关闭。

`f48f549`（代理 `2fc91ee`）已合入原生文字原文修复：共享有界文字内容身份辅助函数，
浏览器软换行不再成为 native characters；创建、字体预载、来源绑定冲突/更新和原生
单行省略使用同一逻辑。显式换行/缩进/尾空格保留，直接文字修改不复活旧来源；公开
`use_design` 仅改 text 时同步原文身份，保存重开和导出仍保持修改。
合并时保留圆角 SDK 模拟和原子更新，TEXT runtime 随生成 UI 一起提交。
root 验证：106 项原生/绑定/圆角检查 +3 项内容身份检查 +1 项真实公开工具 UI 检查全通过；
typecheck、validate、两插件确定性输出通过（代理另有 100 项和 3 项 UI 验证）。

实机 run `baa57046` / 新页 `62:116`：相同真实 HTML 输入，10 节点/6 Auto Layout，
初始容器/形状几何差 0；640/400 均独立断言 native characters 等于连续完整原句，没有
源文不存在的换行，始终 FILL/HUG/HEIGHT。段落宽 576→336，高 48→72。
原生 400 PNG 差异从旧 **5,803/max240** 降为 **4,872/max138**，仍是严格失败。
回执 `evidence/real-figma/text-source-fixed/acceptance-report.json` 与新官方 JSON/PNG 均已保存。
新 relay 已停，原 scratch 精确恢复；未更改用户其他文件页或声称已云同步。

待合并中的字体基线代理已用这些新官方 JSON 验证：生产浏览器导回 400 的首次显示/重排
均为 **0/96,000 像素差异**，旧的 1,978 软换行残差消失。该代码尚待独立审查完成，
不能把代理试验当作当前主任务已合入；正在补字体修改时的 offset 刷新与无 Auto Layout
文字路径，避免仅在带 Flow 的 fixture 上正确。新增 textMetrics 可选有界 provenance
字段需与 f48 的 TEXT runtime 合并后重建校验器。

活跃隔离任务：

1. `auto_margin_review`：原文修复已提交，当前只读审查字体基线；已找出无 Auto Layout 的
   root/absolute/manual TEXT 字体编辑刷新缺口及 Node 未测量重排丢 provenance 的问题。
2. `linear_gradients_round2`：`native-text-baseline` 独立分支，字体导出/导入行框映射、字号/
   行高修改和来源绑定逻辑；已有 151 项针对性通过，正在处理审查缺口。该代理工作树的
   无关 Video Studio 完整 build 哈希差异未动，Design Studio app 和插件检查通过；root
   在前一合并基线完整 build:check 通过，等其代码合入后再跑最终组合。
3. `native_figma_grid_round2`：`responsive-gradients` 独立分支，有界结构化 CSS 渐变几何
   意图和 native sourceOnly 保留；原始 45deg Fill 缩窄错误已在代理实测 22,783→0，仍待
   多用例/来源修改冲突/Schema/生成输出和提交。原生表示限制必须如实保留。

下一轮优先：合入经审查的基线及渐变修复，真实 400 文字导回复验、合并门禁；再补
viewport 包装框响应式宽度关系、百分比 Flex 列、负外边距、边框各边/内侧绘制等主要
网页残差。当前任务分支 HEAD 在 f48 之后仅本日志；目标 active，截止不变。

基线代理随后更新方案：只放在测量 receipt 的来源标记无法跨未测量 Node 重排，拟改为
有界 `layoutBaselineSource:'native'` 持久来源，在全体导入文字（含 root/absolute/manual）
进入布局前按实际字体刷新原点；显式换行的单行省略也补真实测试。当前尚未提交，下一轮
按最终经审查代码确认 Schema/来源绑定，不再假定会增加 textMetrics receipt 字段。

### 基线与响应式渐变合并、原文补丁实机核对（约 02:36）

`b754e8b` 已合入代理 `a2fadaa`：原生 TEXT 行框按实际字体映射为 hanging 原点，
持久 `layoutBaselineSource:'native'` 跨保存、未测量 Node 重排和再次浏览器打开；
root/manual/absolute 文字也刷新字体偏移。六个实际字体控件现在触发排版。
绑定按逻辑 y 比较，抵消测量偏移的变化与浮点尾差；自旋转文字和带显式换行的
单行省略保留有界诊断。合并保留 f48 的原文身份与圆角路径，重建全部插件输出。
root 的文字/原生/绑定针对性 **79 项通过**。

新实机 run `325c00e9` / 页 `62:127`，生产 main 来自 b754：相同 HTML 10 节点、
6 Auto Layout，容器/形状几何差 0。标准 `preview-patch` → `apply-patch` 只更新
一个原文图层的 text/textSource，无冲突、无删除；显式换行仍是原生 characters。
640→400 时段落 576×96→336×144，卡片高 192→240，后续色块 y180→228。
官方 JSON 在原始 640、补丁后 640、补丁后 400 三个状态，经生产浏览器导入的首次
显示及重排六次比较全部 **0 像素差异**，无警告/外部请求/浏览器错误。
原生 PNG 与 HTML 400 仍有 **9,389/max178**，未将其冒充零差异。
证据 `evidence/real-figma/text-source-patched/acceptance-report.json`；原 scratch 三文件
精确恢复、relay 关闭、插件关闭，离线云同步未确认。

该补丁脚本最初错误要求 REST 显式包含 inactive AUTO 字段，实际默认 AUTO 被省略，
断言在成功应用后失败；原始预览/应用消息与后续两宽官方导出保留。后续独立核对确认
FILL、原文、有效父布局和流动几何，未来脚本接受省略的默认值并明确拒绝 ABSOLUTE。
未修改生产代码去迎合脚本断言。

`d65e0f2` 已合入代理 `0fd6a68` 的有界 `cssLinear` 结构化意图：当前尺寸求物理角度、
像素/百分比色标，SVG、CanvasKit、采样、前端 CSS 与原生当前尺寸快照共用解析。
45deg Fill 缩窄主例与命名角控制均为 0/0/0；颜色层顺序、透明度、旧 handles 保留。
原生几何修改/层顺序歧义转为 sourceOnly，显式诊断，不复活过期来源；极端新几何
超出现有原生 ±100 handles 子集在转换/预检中拒绝。其他严格量化残差仍完整记录于
`design-studio-responsive-css-gradients-2026-10-21.md`，没有放宽阈值。

组合主门禁在 d65 完成 **440 通过/1 既有跳过/0 失败**，全仓 typecheck、validate、
build:check 及两插件确定性校验通过。root 另发现 HUG 文字字体 setter 会在渐变快照
之后改变原生高度；先以回归证明原实现失败，再在 `d89cb04` 把经预检的渐变求值推迟
到所有排版/尺寸/顺序修改结束，并对字体/文字引起的尺寸变化核对并发 paints/source。
68 项原生/绑定/渐变检查通过；完整组合 UI/GPU 门禁随后完成 **98 通过/1 既有跳过/0 失败**。

新增网页失败用例 `evidence/native-text-ellipsis/source.html`：nowrap+ellipsis 当前仅
裁剪全文，不显示省略号，640 初始/同宽各 328 像素/max240，400 为 377/max240。
独立代理正在补 plain-text 容器、Fill/Hug、原文与前端导出；原始失败证据保留。
另一代理正在补实际 DOM viewport→根节点 Fill 关系，已有 12 组 outer-only 缩窄
严格 0 的浏览器样本，尚未合入，后续仍需真实 Figma 外框缩窄验收。
第三代理转向 GOV.UK 重复出现的 CSS 各边/内侧边框误差，先提出有界可编辑模型。
目标继续 active；24 小时截止仍为 2026-10-22 00:31 Asia/Singapore。

### 最外框驱动的真实 Grid、背景导出修复（约 02:47）

`cf0f9cf` 合入 viewport 代理 `3ec8533`：从实际 DOM 捕获根与包含块关系，
把受支持普通根接到最外框 Fill；保留 body 的固定内边距、固定/最大宽度的安全自动外
边距，以及可证实 100% 高度链。缺少包含块、裁切选择、定位/变换、相对尺寸等情况
明确诊断，旧直接 adapter 调用及 includeViewport:false 保持旧契约。
生产 harness 新增显式 `--resize-mode viewport-only`，旧默认模式保留，报告标明模式。
13 组浏览器样本×初始/重排/外框缩窄全部严格 0，代理 46 项、1 项实际公开 UI 检查通过；
root 合并后 37 项适配器/auto-margin/block/Grid/viewport 检查通过。
真实公共 Checkout/Album 的负外边距、浮动与百分比列等残差仍失败，未改样本 CSS。

首次实机 run `533e6020` / 页 `62:143` 已证明只改外框 640→400 可保持有效
VERTICAL→GRID、主框 Fill 600→360、x20、单元格 274→154，无 ABSOLUTE。
但原生导出最外框 PNG 时，透明 viewport 未携带白色页面背景，640/400 分别有
45,600/31,200 个 RGBA 像素差异；其余布局与颜色、官方导回四次比较均 0。
失败原始 PNG/回执保留在 `evidence/real-figma/viewport-grid/acceptance-report.json`。

`6f65c42` 将生产捕获的明确背景写到 viewport 自身，旧几何调用仍透明。
先新增 transfer 背景断言复现失败，再修复；22 项 viewport/adapter 检查通过。
没有在像素比较中合成白底、忽略 alpha 或放宽阈值。
新实机 run `f8dd5c58` / 页 `62:148`，相同原始 HTML、同样只编辑最外框宽度，
两宽原生 PNG 均 **0 像素差异**；官方 JSON 经生产浏览器导回的首次显示及重排
四次也均 **0**，无警告、外部请求或浏览器错误。
`evidence/real-figma/viewport-grid-fixed/acceptance-report.json` 保存原生几何与完整计数。

另完成实际渐变意图 run `b9da271f` / 页 `62:138`，生产 main 来自 d89：3 个原生
GRADIENT_LINEAR，几何差 0，初始官方导回 640 首次显示/重排均 0；原生 PNG 仍
88,604/max2，严格失败。仅在 Figma 缩到 400 后，固定 200px 的 a 渐变仍 active，
Fill 的 b 从 384→144 后成为 sourceOnly；竖直 100px 色标主框仍可匹配并保持 active。
400 原生 PNG 对 HTML 为 54,389/max60，导回对原生 PNG 为 50,796/max2；导回对原始
CSS 为 22,783/max59。此物理角度限制真实存在，来源提示与 inactive 行为经实机确认，
没有把来源保留冒充原生响应式绘制一致。
完整回执在 `evidence/real-figma/css-gradient-intent/acceptance-report.json`。
以上三个新 relay 全部停止、插件关闭，scratch 原三文件哈希精确恢复，未确认云同步。

接续任务：HTML 省略号代理最终生成内容防护与公开工具复测完成，提交待合入；
negative-main-gap 代理从 6f65 新隔离分支实现有界 nowrap 有符号主间距，再用透明
spacer+Fill/AUTO 真子项表达负水平外边距，避免绝对定位；边框代理最小单色内侧/底边
已为 0/0/0，多色接缝仍有 max1 原始严格失败，正接原生/CanvasKit。目标继续 active。

### HTML 省略号实机、保留空格与字体轮廓探针（约 03:02）

`930ce03` 合入代理 `f4bdc10`：捕获并恢复有界 plain nowrap/pre 文字意图，保留结构
Frame、Fill/Hug、完整可编辑文字；nowrap 按 CSS 折叠的原始空白另存语义备注。
伪元素/表单/列表/混合子元素、特殊书写等情况拒绝覆盖 DOM 原文并明确诊断。
SVG 保留显式空白；前端导出使用完整原文动态截断，vertical Fill 使用 100% 宽度。
root 合并后 54 项针对性检查通过，vendor 与两插件输出重建。

新公开工具 UI 用例最初沿用旧的 main 固定宽度假设，编辑 Fill 子项而保留外框 640，
因此正确重排后文字仍宽 576，并非 336。原失败日志保留；测试改为仅编辑外框，明确
断言 main 仍是 Fill，导入→文字修改→保存→重开→完整 Figma 传输一项真实 UI 通过。

实机 run `17832bd1` / 页 `62:153`，8 节点/6 Auto Layout/2 TEXT：独立断言原生
characters 等于两段完整原句，ENDING/maxLines1、FILL/HUG；逻辑行框几何最大差
0.0038px。仅将外框 640→400，两段文字均 576×24→336×24，未变为 ABSOLUTE。
官方导回两宽首次显示/重排四次均 **0 像素差异**；原生 PNG 640/400 分别
6,768/max210、3,706/max138，仍严格失败，字体残差不隐藏。
回执 `evidence/real-figma/html-ellipsis/acceptance-report.json`；relay/插件关闭且 scratch
原三文件精确恢复。

审查补测 pre+ellipsis 暴露导出 CSS nowrap 折叠空格，以及 measuredEllipsis.trimEnd
删除保留格式前缀空格。代理只读原始失败：普通保留空格前端 5,323/3,125 像素；
200 空格前缀 SVG 各宽/重排 60/max240，前端 4,344/2,609 像素。
root `02f9b68` 修复为 pre、保留已测量前缀全部字符，新增 outer-only 生产 SVG+前端
精确比较先失败后通过。27 项 HTML/字体测量检查及上述公开 UI 一项通过；全仓
typecheck/validate/build:check、vendor/两插件确定性校验通过。

当前合并基线重跑冻结 GOV.UK，185 节点，27203/27203/62622，73 条分项诊断，
仍有 ordinary-flow→absolute，strict=false；无外部请求或浏览器错误。
`evidence/web-corpus/govuk-check-answers/round10-merged-baseline/` 保存原始结果。

字体只读研究确认：所有标题/段落/单行在整数 ±4px 搜索中均以原位置 (0,0) 最优；
不能靠移动文字解决。简单 1/16 覆盖量化仍留下大量 max135–165 差异，未修改渲染器。
固定标题 `62:133` 的原生只读 SVG 轮廓/可编辑 SVG、透明 PNG1x/2x 已通过官方
exportAsync 导出，前后节点/页面/选择元数据完全相同，hasMissingFont=false。
目录 `evidence/native-text-raster-analysis/native-outline-2026-10-20T18-59-58.241Z-9f2eb6cb/`
保留原始字节、设置、SHA 与恢复回执。这是明确标为 productionMainModifiedForReadOnlyProbe
的研究探针，不能冒充未修改生产转换验收。运行时/relay 均退出，原 scratch 哈希恢复。
下一步比较实际轮廓与本地 Arial 字形，尚不把字体名称相同当作字节/轮廓一致的证明。
负主间距及边框分支继续独立实现/检查，目标 active，截止不变。

### 有界负主间距与负水平外边距合并、字形研究（约 03:08）

`ebc9909` 合入代理 `c3cc1d7` + `4781b72`。负间距只在 nowrap 水平/垂直、
非反向且主轴 Fixed/Fill 的验证子集中开放；Grid、交叉轴、Hug 等未验证组合明确拒绝。
普通 auto 宽度负水平外边距使用透明水平 Auto Layout、两端固定 spacer 与真实 Fill
子项表示，保留原行 ID/样式/子树，不把它变成绝对定位。扩展宽度、最小/最大尺寸、
占位位置和 -2000 间距预算在构建包装前检查，超限保留测量几何并诊断。
前端使用主轴末端负 margin，完整子项绘制顺序、隐藏/绝对排除、auto margin 保留。

代理 12 组支持样例 × 首次/重排/仅外框缩窄严格 0；公开 inspector/tool UI 一项通过。
小数边缘样例在三种模式均 **100 个像素/max95**，保留失败和精确 296.5→176.5 的
子项宽度，不取整、不放宽阈值。五个冻结公开网页的 15 个原始计数与同基线均未变化，
整页仍失败，未把局部通过写作整页通过。完整代理回执
`evidence/negative-main-gap/receipt.json` 位于独立代理 worktree 的 evidence 目录。
root 合并后 64 项针对性检查通过（`evidence/round11-negative-merged-targets.log`）。
另用固定种子 20261021 生成 120 组 H/V、负 gap、多个 Fill、min/max、auto margin
组合，独立测量前端 DOM 坐标，未发现大于 0.02px 的几何差异；这是派生压力检查，
不替代原生 Figma 或严格 PNG 验收。脚本/结果在 `evidence/negative-main-gap-geometry/`。

只读字形研究已完成：15 个字符、21 轮廓的原生坐标可由本机 Arial 的推进距离向上
量化为偶数字体单位、隐式二次曲线中点取整的模型解释，最大控制点余差 0.0005px，
处于原生 SVG 小数序列化精度内。末尾漂移为 0.107421875px；空格和最后字符的推进
仍仅为模型预测，不能独立从可见轮廓观察。此模型不是 Figma 内部算法或字体字节一致
的结论。`native-outline-analysis-summary.json`、`advance-table.md` 保留逐字值与 SHA。

即便直接将实际原生轮廓 SVG 交给 Chromium，白底派生比较仍为 1x **752/max50**、
2x **1534/max60**；普通可编辑文字分别为 840/max121、1957/max190。原始透明 PNG
和所有派生/合成比较分开存放；浏览器 CSS 控制对原网页标题裁片严格 0。原生可编辑
SVG baseline18.9336 与轮廓模型19 的连续数值不同，但两者本次 Chromium 栅格相同，
不据此增加位置补偿。原生四文件 SHA 全程未变，未修改产品字体渲染或比较阈值。

Figma 当前官方说明新旧 Auto Layout 版本在内侧描边、Fill 与 padding 上存在差别：
[Use auto layout with CSS Flexbox in mind](https://help.figma.com/hc/en-us/articles/42031586813719-Use-auto-layout-with-CSS-Flexbox-in-mind)。
边框分支先约束到已验证的 INSIDE 投影；另准备仅新建自有研究页的实机语义探针，
验证本地版本的实际行为，不猜测未文档化的 layoutVersion API。目标仍 active，截止不变。

### 边框实机通过、原生设置顺序与负间距反例（约 03:28）

`a5456c4` 合入各边边框代理 `01b9a7d`。可选、严格有界的 strokeSides / strokeAlign
覆盖 codec、公开 schema/工具、比较、调色、SVG、CanvasKit、前端和原生真实侧边权重。
不加入装饰性流子项；不同颜色的原生边框在预检中拒绝，保留可编辑 v3 源。非统一圆角
接合、虚线/低 miter/折叠表格等限制明确保留。独立分支全主门禁 453 通过/1 既有跳过，
root 合并首次主门禁 473 通过/1 跳过，但随后实机暴露了模拟器没有遵守的 API 限制。

实机 run `6ff5dac4` 在全新 Frame 仍为 NONE 时设置 strokesIncludedInLayout=false，
Figma 直接拒绝导入。失败回执保留于 `real-figma/negative-margin-creation-failed/`。
`0118d17` 先补严格原生 setter 模拟使回归失败，再把关闭包含的设置移到启用 H/V/Grid
之后、子项最终 sizing 之前。另补回归发现非活动 flag 引起错误描边冲突、空/零宽描边
阻塞普通 padding 修改，以及 NONE→H/V 激活；依次修复 inactive 的语义比较、有效权重
和激活时的设置，保持已有 active INSIDE included=true 的来源更新。
非活动 NONE 不再把原生描边加进 padding；非零 INSIDE4/padding8 的回归先失败后通过。
80 项针对性检查通过，所有失败日志保留。

修复后的完整组合门禁：**主套件 477 通过/1 既有跳过/0 失败**，
**UI/GPU 101 通过/1 既有跳过/0 失败**；全仓 typecheck、validate、build:check、vendor
和两插件确定性检查通过。日志 `round11-main-final.log` / `round11-ui-final.log` 与
`round11-static-acceptance-receipt.json` 记录当前代码 0118d17，不把早期门禁冒充最终结果。

两个真正使用未改生产 main + 生产 UI 完整备份转换器的实机验收：

- 底边 run `f36f0ac2` / 页 62:268：真实 INSIDE 权重 [0,0,1,0]，4 节点；
  main/两子项 Fill/AUTO，无新增装饰子项。640→仅外框400，子项292→172，几何差0。
- 统一内侧 run `2dfe2711` / 页 62:273：真实 INSIDE 权重 [4,4,4,4]，同样4节点、
  同样 outer-only 缩窄、几何差0。以上两个样例的两宽原生 PNG 均 **0 像素差异**，
  官方导回每宽首次/重排也均0，无警告。各自 acceptance-report.json 和 production-run
  位于 `real-figma/css-border-bottom/`、`real-figma/css-border-uniform/`。
  这不覆盖不同 padding/描边的 Fill 兄弟，也不覆盖整个公开网页。

同一冻结 GOV 网页在最终组合代码重跑：189节点、58警告，严格计数
**23329 / 23329 / 59515**，max255，仍失败；与02f9基线27203/27203/62622相比减少
3874/3874/3107。三个参考 PNG 解码 RGBA 完全相同，所有 HTML/CSS/字体保留，无外部
请求或浏览器错误。`round11-merged-border/paired-baseline-receipt.json` 保存配对证据。
通用 semanticIssues 此次为空不能证明所有原始流恢复；独立浮动列/视口调查仍有局限。

### 原生间距及 Fill 分配的下一轮依据

未改生产 main 的负外边距 run `f830b7d4` 已导入，但真实 Figma 行 x20/width600，
而 CSS/面板要求 x5/width630；两端 spacer 为1，属性 gap 虽为-16，实际间隔却为-1。
原生640 PNG **1500/max189**，官方导回首次1500，面板重排后0，暴露两种布局语义
不一致；这不是成功的原生外边距互换。失败原始输入/官方 JSON/PNG/回执完整保留在
`real-figma/negative-margin-failed/`，没有用重排后的0掩盖首次与实机失败。

仅新建自有研究页的50组探针 `00c34ea1` 比较多个gap、尺寸、形状/透明度、Fill/Fixed、
对齐、setter顺序，以及仅控制外框缩窄再恢复。它明确标为 customMainModifiedForResearch。
1:2不对称 spacer 给出全局-1/-1和Fill599，排除逐邻居-1/-2的假设；Fixed630也仍-1/-1，
排除仅Fill尺寸上限的解释。CENTER 固定630可在600内x-15，但到360仍固定630/x-135，
不能作为响应式替代。四个负 padding setter 均被 Figma 拒绝（必须>=0），其他设置无错。
原页/选择/子项快照不变，原始JSON与白色研究板PNG保留；插件关闭、relay退出且原三
文件哈希完全恢复。分析目录 `evidence/native-negative-spacing-analysis/`。

另一40组真实描边探针 `ca4d104f` 显示，仅 INSIDE+includedtrue 影响自身内容缩进；
CENTER/OUTSIDE不计入本次新建 Frame 的布局。不同 padding/inside描边的 Fill 子项
分配却为290/322而非306/306，includedfalse/true相同；不能仅关闭 inclusion就假定
所有 Fill 兄弟等宽。93个官方 bbox 与实际 getter 一致，40组几何规则残差0；没有从
缺失的 layoutVersion API 推断所有历史文档版本。原始与分析分别保留在
`native-stroke-layout-analysis/`。独立 CSS 最小例也证实当前面板重排的 content-basis
错误，而前端 flex 导出仍严格0；后续代理正先修复独立的有效 padding 分配。

下一步负外边距采用待验证的有界方案：当父框正 inset 足够时，降低父框左右 padding，
再用透明 Fill/Hug 包装补偿未外扩的兄弟，真实行可直接 Fill，无负 gap/ABSOLUTE。
超出该子集的原生导出要在预检明确拒绝；不能静默改 canonical CSS 的数学负间距。
独立浮动列工作使用现有有理比例 Grid 字段，保留媒体查询/视口/原生 bleed 的限制，
尚未合入当前组合。24小时目标继续 active，截止仍为10月22日00:31 Asia/Singapore。

### 浮动百分比列的真实 Grid 互换通过（约 03:36）

`9bc90dc` 合入浮动列代理 `e93176a`。在已测量、同方向、单行、有理百分比的验证子集内，
普通浮动列恢复为原生等权 Grid 轨道、手动跨度与锚点，各列内部保留纵向 Auto Layout。
只移除已证明空白、无绘制、零高的生成 clearfix，原行/列/内容节点与源 ID 均保留。
比例分母最小公倍数有界为24；外边距、shape、clear、变换、min/max、行内环绕等
未验证条件仍拒绝恢复。`float-flow-captured-state` 持续说明媒体查询与浮动换行限制。
root 合并后28项目标检查、2项 standalone UI 检查通过。

随后使用未改生产 main 与生产 UI 完整备份转换器，实际运行冻结 `split-row` HTML：
run `ac66594c` / 页 **62:589**，共7节点，无图片、文字或装饰性子项。
初始640：main padding20，Grid 行宽600、3个 FLEX1轨道、1个 HUG行；两列宽200/400，
跨度1/2、锚点0/1，各列左右 padding15，实际内容宽170/370。
只把最外层视口改为400：行宽360、两列120/240、内容90/210，全部普通子项仍为AUTO，
Grid及列的 Fill/Hug 设置保留，独立 HTML 算术与官方 bbox 最大差异均0。

两宽的 **真实 Figma PNG、官方导回首次、导回后重排，共6次比较全部0像素差异/max0**，
导回无警告。完整报告、原始官方 JSON、冻结 HTML 参考 PNG、生产转换协议与清理回执
位于 `evidence/real-figma/html-float-grid/`。这只证明该冻结浮动列样例，不覆盖文字换行、
媒体断点或整个 GOV 网页。运行插件已关闭、relay进程正常退出，注册三文件字节恢复原样。

### Fill 内容分配合并与 Rectangle 原生对照

`2790a44` 合入独立代理 `04de9bb`：Fill 先均分可用内容空间，再加回各自有效 padding；
min/max 按总限制方向逐步冻结，避免同时冻结相反限制留下未分配空间。
Auto Layout 自身物理 padding 构成实际尺寸下限，但不改写作者的 max 字段，仍保留20000上限。
五组生产 HTML（不等 padding、描边、min、max、max小于inset）×首次/重排/缩窄15次严格0；
独立分支82项目标检查通过。root组合2790a44完整主门禁 **489通过/1既有跳过/0失败**，
UI/GPU门禁 **101通过/1既有跳过/0失败**；typecheck、validate、Design Studio build:check、
vendor和两插件确定性校验通过。`round12-combined-acceptance-receipt.json` 绑定代码SHA及日志。

另实际完成6组 Rectangle Fill研究 `6e301711` / 新页62:569，20个新建自有节点、0接口错误。
H/V两轴 INSIDE4/8 的两个子项宽/高分别302/310；CENTER与OUTSIDE均306/306。
可用空间612，INSIDE内容基数8/16，剩余内容各294；全部18个 scene bbox 与官方 JSON 相同，
六组规则最大几何差异0。该结果独立确认上个提交的 leaf Rectangle basis，不冒充像素验收。
原始与独立分析保留在 `evidence/native-stroke-layout-analysis/`，raw SHA
`478dccebfcee29486641e64766bd37a9d74b07d3aadd4683a12b13b98423625b` 未变。
探针明确为 customMainModifiedForResearch；原页面/选择/子项快照不变，运行已关闭并恢复注册文件。

官方 [REST Node types](https://developers.figma.com/docs/rest-api/file-node-types/)
规定 strokesIncludedInLayout 缺省为false；这与实际 JSON_REST_V1 省略false相符。
它不同于本机新建 Frame 启用 Auto Layout 后 getter 为true的运行时初值，导回时不能混用。
下一独立修改将显式保留已验证 H/V Frame 的 excluded 描边来源；仍在进行的负间距预检、
父 padding 重分配、根滚动视口边界恢复各自保留独立证据。目标继续 active，截止不变。

root另准备并实际执行冻结 CSS“不等padding＋不等inside边框”的未改生产转换。
run `486735d4` / 页62:597，只有 viewport/main/两个横向Auto Layout tile共4节点；
CSS原始padding8/20、inside描边4/8，主框padding8/gap12，独立期望宽290/322。
生产插件却给出286/326，首项宽度断言正确失败；真实640 PNG与官方导回首次均
**1504像素/max217**，当前面板重排后才为0，不把它记作互换成功。
失败后guard拒绝继续仅外框400，因此没有400原生结果。该反例再次确认关闭 inclusion
同时传全部effectivepadding会重复计入兄弟Fill的内容基数，后续要同时正确处理原生标志和rawpadding。
`evidence/real-figma/content-fill-before/` 保存冻结参考、原始官方JSON、生产消息、PNG、
比较与清理回执；插件已关闭、relay正常退出，注册三文件精确恢复。

### 根滚动视口恢复合并与整页复核（约 03:44）

`881688e` 合入独立代理 `bbbcf1d`。只有标准模式的实际 documentElement 滚动根，
gutter:auto/contain:none、零偏移、无水平溢出、clientWidth/Height精确等于inner viewport，
才能把根传播的 auto/scroll 视为已捕获视口边界。祖先宽度、背景、变换等旧守卫保留；
classic占位滚动条、stable/both-edge gutter、body/private滚动/裁切、hidden/clip、
水平溢出、已有滚动偏移和quirks继续拒绝。真实16px classic gutter也在640/400下验证，
不是模拟clientWidth。设计与标准原文链接见 `design-studio-viewport-root-scroll-2026-10-21.md`。
root合并后 viewport/Fill/float 共 **17项目标检查通过**，当前合并没有再次重复完整主/UI门禁；
上一完整门禁对应2790a44。

root再跑完整冻结 GOV：188节点、55条诊断，import/relayout/narrow严格差异为
**23329 / 23329 / 54075**；相比0118d17的23329/23329/59515，初始/同宽未变、
缩窄减少5440，整页仍strict=false。三个reference PNG字节及解码RGBA全部相同，
无外部请求或浏览器错误。`round13-root-scroll/paired-baseline-receipt.json` 记录组合SHA、
原始计数与参考SHA；代理另保留9bc同base只改root scroller的配对证据，避免混淆归因。
恢复了viewport VERTICAL与body横向Fill，原始189→188只来自浮动列移除已证无绘制clearfix。
不据此宣称全部后代或媒体查询响应正确。

只读审计还确认generic semanticIssues仅检查显式absolute，AUTO但parent.layout=none
的普通源节点仍可能冻结。`round12-provisional-flow-audit.json` 保存初步逐节点关系；
已有cssSelector可能匹配多个DOM，因此其中计数不是最终门禁结论。下一独立调查针对
纯文字普通块容器，表格/复杂行内内容仍保持明确限制。描边来源与原生负间距/bleed修复
继续在独立工作树进行，目标active，截止仍为10月22日00:31 Asia/Singapore。

### 原生负间距边界与正 inset 修复（约 04:08）

`2b0039c` 合入 `1662066`：canonical CSS 负 gap 数学保持不变，但原生导出前根据
实际可见 AUTO 子项的最小主轴尺寸检查 Figma 的全局负间距钳制。不能保留的请求在
创建页面前以 `NATIVE_NEGATIVE_SPACING` 拒绝；保留 SVG 结果及原生 unsupported 状态，
不会沿用旧成功文件。官方导回记录有效 gap，源绑定保留原请求；后续改变阈值的编辑
必须预检。依据50组真实探针、270对间距（全局模型残差小于0.00001），并保留固定
原始子树与3阶段 SDK 快照。root97项目标检查及3份生成物校验通过。

`18d63fb` 合入 `bdab914`/`8c54cfe`，`6ff4550` 补组合断言：父框正 padding 足够时，
降低父左右 inset，再为未外扩的普通兄弟添加透明 Fill/Hug 正补偿。真实外扩行直接
Fill，无负 gap、绝对定位或装饰 spacer；零补偿包装直接省略。整个转换先检查节点、
深度、几何、ID与备注预算再事务性应用。原行/子项 own style 与源 ID 不变，未证明的
百分比、分数舍入或父 padding 不足继续保留明确边界。合并后23项相关检查通过。

真实生产转换使用与旧失败 `f830b7d4` 字节完全相同的双侧 -15px HTML，run
`be072c68` / 页 **62:652**，未改生产 main SHA
`2c507f053883f0efd47ab7d8ada55b263b45a36965b76e6b1ff9d03167eb18a3`。
7节点全部普通流：父左右 padding5，真实横行 gap10，宽630→390、两个 Fill 子项
310→190；后续普通块通过左右15的透明纵向补偿框维持 x20、宽600→360。
只改最外层640→400→640，全部独立几何断言差异0，无警告。
两宽真实 PNG、官方首次导回、导回重排共 **6次严格0像素/max0**。
`evidence/real-figma/negative-insets/acceptance-report.json` 保存所有冻结输入、官方原始
JSON、PNG、比较及注册三文件精确恢复凭据，原生页面保留。

两次验收器失败也保留：root 为脚本补恢复保护时漏接 startFlow，首次未启动/导入
Figma；随后一次将官方 JSON 省略的零 padding 当作 undefined 错误，实际页面保留。
修正验收器默认值读取后重跑，未改产品或参考图；都在 failed-attempts 下记录精确恢复。
目标仍 active，截止10月22日00:31 Asia/Singapore。

### 原生描边绘制层次与表格边界研究

新增12组 H/V、INSIDE/CENTER/OUTSIDE、inclusion false/true 的真实白板研究。
`97b0c040` 与 `d7b139e0` 每次14个新建自有节点、0接口错误，原页面/选择快照保持不变。
父 Frame 的描边在贴边不透明子项下方；true INSIDE 会把子项缩入4px，因此边缘显露，
不能误当成绘制顺序变化。两份独立解析几何参考与实际原生 PNG 都严格0/max0。
原始 SHA、生成器、分析、PNG 与清理记录在 `native-stroke-paint-order-analysis/`。
首次 `b0bb8b97` 因接收器残留旧节点数断言失败，未作为已验收原生证据使用。
没有因此全局反转 SVG/前端 Frame 描边顺序。

冻结 GOV 实际 DOM 在7个宽度的 table-cell box 已记录。桌面 content-box 30%+20px、
50%-20px、20% 可由5个正 Grid track与跨度表达；4组极小 collapsed/separate、
content/border-box CPU 构造640→400→640严格0，但原生尚未执行。
不等高不透明单元格控制暴露只用 Hug 会缩短背景、产生大量像素差异；不能靠缩短真实
单元格或固定旧高度宣称支持表格。`table-layout-boundary/native-table-design-findings.md`
保留内在尺寸、分数轨道、原文绑定和共享边界的未解决项，下一探针验证 native HUG/FILL。

### 描边来源保留合并（待本轮真实像素验收）

`46ac3e0` 正常合并 `2477faf`：对已验证 H/V Frame/Component 保留
`strokeLayoutExcluded:true` 来源；CSS effective padding 的普通新副本显式启用原生
inside inclusion，并扣回原始 raw padding。来源排除者显式关闭 inclusion，Fill basis
计入物理描边，canonical child inset不变。标志仅允许 true、inside、H/V Frame/Component；
schema、Host工具、绑定、保存、前端、UI清理规则同时更新。
源补丁先核对最终 layout、inclusion、描边和4侧 raw padding，全部预检后再分阶段写入；
负 gap 阈值也使用最终外框尺寸。独立16组 VM 交叉审查通过，未将 VM 当真实原生证明。
root69项 stroke/native 相关检查通过，实际 inset/float 文件10项通过，3份生成物校验通过。
两次手工命令含不存在测试文件名的日志保留，真实执行总数分别69及4；以随后实际存在
的两个 inset/float 文件10项记录为准。完整主/UI门禁仍以2790a44为最近一次，合并完文本
守卫后将对最终组合重跑。本段不先宣称 CSS Fill 原生像素通过。

真实 CSS Fill 后续 run `a601ac39` / 页 **62:665** 已完成，生产 main SHA
`550d58faac7933b422c73c793c49dd0443f939ef6fd3577b0029ad084c2556ba` 未修改。
与 `486735d4` 完全相同的冻结源码/参考：原始padding8/20、inside描边4/8，
本机显式inclusion=true，实际rawpadding恢复8/20，640宽子项290/322；仅外层400后
170/202，再返回640不变。4节点，没有边框装饰子项、图片或文字，全部普通AUTO。
两宽真实PNG、官方首次导回、导回重排共 **6次严格0像素/max0、0警告**；旧640的
1504/max217由此归零。证据在 `evidence/real-figma/content-fill-after/`。
首次 `69f659e3` 已生成正确290/322，但验收器误把诊断名期望为完整CSS类名；其失败
和精确恢复原样保存，之后只修正层名断言，未改HTML/参考或生产代码。最终运行插件
关闭、relay正常退出，三份注册文件精确恢复，当前owned页62:665/viewport62:666宽640。

### 普通文本来源绑定与交叉审查修复

`cd8908d` 合入 `f1d20a3` 和审查修正 `1c4733e`。捕获时以semanticId→实际Element
保存本地绑定；同Element的容器/文字共享合法，不同Element碰撞才记为歧义。只有没有
精确绑定时才退到唯一CSS选择器，并保留显式诊断，不猜第一个class匹配。
CSS normal只折叠ASCII HTML空白，真实NBSP与原始内容保留；普通单一文本块恢复为
纵向Auto Layout＋Text Fill/Hug，可编辑后重新换行。

受限子集明确排除table/inline/form/pseudo/mixed/隐藏/变换等，审查还复现了遗漏
::first-line lineHeight和calc text-indent被parseFloat误当0的问题。修正后两例都保持
原测量几何并发出html-plain-text-fixed；原有10393/5856像素失败照实保留，没有冒充修好。
独立CPU复核和作者19项import测试通过。冻结GOV同base23329/23329/54075像素未变，
6个原先因重复class被跳过的h2/p恢复流式，188个ID和父关系不变，剩余表格问题未掩盖。
新组合完整门禁正在执行，证据以 `round17-main-combined.log` / `round17-ui-combined.log`
与后续完成回执为准；此处不先记录完成。24小时目标继续active。

### 完整组合门禁、Grid 内在尺寸及新网页（约 04:22）

本轮完整主门禁 **521总数/520通过/1既有跳过/0失败**，131103ms。
首轮UI为101通过/1失败/1跳过，失败断言仍寻找已移除的horizontal margins包装。
`dc030ab` 更新该交互回归：验证真实行直接隶属正inset父框、无旧spacer，清除独立
columnGap后通过inspector把主gap改为-20，实际两Fill子项325/325；wrap/reverse/Hug
非法编辑回滚，工具改-16并只缩外框后，保存重开/原生传输保持x5/宽390、7节点。
首次修订把层级传输误当扁平parentId的断言也保留失败日志，改查真实children层级后
目标1/1通过。随后 **完整UI重跑103总数/102通过/1既有跳过/0失败**，106957ms。
`round17-combined-acceptance-receipt.json` 绑定main/UI实际commit、日志SHA、完整App
文件SHA和静态检查；main之后只有日志文字、注释与该UI测试修订，无产品行为变更。
GPU文字改进控制仍有858像素/max1，不能把回归测试通过当作全网页strict0。

真实独立Grid研究 `289e088a`：8组、7阶段、58个新自有节点、0接口错误，392组
live↔官方bbox逐值相同。HUG行＋全部实际不透明V-FILL单元格，在两种设置顺序下都
保持模式，随真实内容40→80→40增长并缩回，所有单元格背景高度完整；固定500px子项
溢出，未使FLEX轨道按min-content膨胀。正轨道[.3fr,32px,.5fr,.2fr,8px]＋跨度[2,1,2]
在630宽实际209/295/126、390宽137/175/78，原页面/选择/子项ID快照不变。
CPU独立CSS白板参考与7张原生PNG比较为 **0/0/0/240/660/0/0**，max0/0/0/77/76/0/0；
708和483.328125宽严格失败，保留原始浮点与Chrome1/64舍入差异，未四舍五入掩盖。
这是定制main的研究，不是生产表格互换成功；当前Fill/HUG guard尚未放开，代理正拟定
只针对真实嵌套内容的受限模型。全部原始/分析/PNG差图位于
`native-grid-intrinsic-height-analysis/`，插件已关闭、进程正常退出、三注册文件精确恢复。

真实32组Inactive Frame Fill研究 `4221e005`：98个新自有节点、0接口错误，原页面与
选择/子项快照保持不变；raw SHA
`2ece3bfe65c19b266cf76d14aa6dc0861c3b113234a7cc08b0aa9e814ef46a7a`。
水平例640：保留padding8/20的NONE Frame仍306/306，inside描边4/8后302/310；
活动H/V Frame分别294/318、290/322。可用主尺寸极低时，活动excluded inside例下限
24/56；maxB=1却得到556/1、bothmax1为1/1，不能套用浏览器padding下限或假设所有
空间总能重分配。官方/双轴完整独立分析仍在进行，未据此修改全局算法。
研究插件关闭、进程正常退出，注册三文件精确恢复，当前仍62:665/viewport62:666宽640。

另冻结两个官方真实整页，归档原始→资源本地版在1280/768参考均严格0、DOM几何同值，
无未知请求或页面错误：[W3C Blog](https://www.w3.org/blog/) 与
[NHS Check Answers](https://service-manual.nhs.uk/design-example/patterns/check-answers/example)。
生产初次/重排/仅外框缩窄：W3C **445663/445941/141626**（465节点），NHS
**31496/57594/117781**（125节点），均strict=false。NHS原生预检明确拒绝-17被1px
最小AUTO项钳制为-1；W3C仅prepared，均未冒充真实原生执行。
原始URL/HTML/CSS/资源SHA、转换及参考在 `web-corpus/additional-public-pages-summary.json`。

W3C已定位具体解析错误：link stylesheet替换为style时丢失media=print，打印样式误用于
屏幕，隐藏导航/导语/表单/筛选并改黑色。保持同一冻结字节、仅实验保留media后，首次
445663→53958、重排445941→75772，body高度/卡片位置恢复；缩窄141626→234531如实
变差，说明正确屏幕样式还暴露已有响应式问题。独立新工作树正在同时修Panel与维护的
standalone HTML插件，只保留media并加screen/print/视口条件回归，尚未合并本组合。
目标继续active，24小时截止10月22日00:31 Asia/Singapore不变。
