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


### media 条件、空区块与 Grid 组合（约 04:44）

`9e26969` 正常合入 media 修复 `1ca320e`：link stylesheet 内联为 style 时保留实际
media 属性，Panel 与维护的 standalone HTML 插件一致处理。screen/print×视口条件、
folder preview 的真实浏览器控制通过，独立审查未发现阻断。W3C同一冻结源的首次
445663→53958、重排445941→75772，但窄屏141626→234531，后者如实保留为回归；
不能把单次屏幕像素改善当作响应式完成。

`6b08d75` 新增捕获时的 cssEmptyBlock 真 DOM 证据：只允许真实无元素子项、无有效
文字、无生成内容的 block/flow-root；匿名文字、伪元素、表单/列表标记不能冒充空框。
受限空块恢复 VERTICAL Auto Layout，有效 padding 含物理边框，源 ID/图层数量不变。
交叉审查实际复现 aspect-ratio auto-height200→1、min-height50%120→1 的问题，最终
guard 拒绝比例尺寸、百分比 padding/min/max、contain 等未建模情况并保留测量几何；
没有直接放开所有空容器。4个生产HTML×SVG三模式共12次strict0，前端2宽共8次0，
padding编辑与保存重开一致；真实DOM证据与负控制也通过。

`53604ce` 正常合入 `5cc5f9f`，Grid新增严格单HUG行＋真实VERTICAL Fill cell＋固定
高度Rectangle内容的内在高度支持；共享测量/布局/原生可表达性检查，导入使用完整子树
预检，拒绝时只清除相应容器/直接关系，不破坏嵌套Grid。固定500px内容允许自然溢出，
HUG内容40→80→40会使整行及不透明Fill背景同步变化，前端真实CSS也可编辑。
Text、跨行、额外padding、约束/描边等尚未放开，没有用旧被拉伸cell高度当Hug依据。
真实fixture同时注明官方JSON缺少Grid数组，补充来自同次live API的生产补全字段，
两份来源分别保留SHA。作者147项/最终45项检查通过；root组合6个真实测试文件
`round19-grid-empty-media-targets.log` **118/118、0失败**。组合typecheck、validate、
三份生成物check、scoped build:check全部通过；尚未把旧完整main/UI门禁冒充本组合。

新实际生产空block验收 `c7c6550a` / 页62:858、viewport62:859：冻结HTML仅把之前
已验收CSSFill的display:flex换为display:block，4节点、0图片文字/额外绘制子项，
两个空块均真正VERTICAL/AUTO Fill；production main SHA
`0295f8273ec3f44cd178771a2d7cdb217648b195dc6b693beeb75888e3a902eb` 未修改。
640子项290/322，仅外框改400后170/202，再回640；官方接口几何delta0。
两宽原生PNG、官方回导、回导重新布局共 **6次changedPixels0/max0、0警告**。
完整源码/参考/PNG/差图/哈希/清理回执在 `evidence/real-figma/empty-block-fill/`。
插件关闭，relay正常exit0，注册code/ui/manifest精确恢复；原页面保留，未删除页面。

原生included min/max控制 `72da637d`：10组40快照/32新自有节点，458数值与224精确
getter检查全部delta0。设置maxB1再minB56会把max自动抬至56，反向设置则把min压至1；
8次相反限制被SDK强制改写。先预留basis、按content cap分配的模型对两批120快照残差0，
但正content minimum、center/end与极小外框前端映射仍未证明。具体可逆限制来源方案在
`inactive-frame-fill-analysis/native-fill-model-design.md`，未据此引入全局新策略。

真实Text Grid研究 `a4e5dd91` 已完成8组×7阶段、58新自有节点，原页面/选择元数据
一致；raw SHA `6dd1cc6d09c5f5d0bd391d538a6255fef61fecadf263cf3f597eb0d072c931d6`。
显式Inter Regular加载在创建新页前完成；内容2→4→2行与仅外框缩放自然执行，待独立
分析高度/换行与两种setter顺序，暂不声称Text Grid生产支持或像素通过。
定制main研究证据在 `native-grid-text-intrinsic-height-analysis/`，与未修改main的上述
生产验收分别记录。研究插件关闭、relay正常exit0、三注册文件精确恢复。
当前仍62:858/viewport62:859宽640。24小时目标持续active，截止10月22日00:31不变。


### 空状态节点真实互转、完整检查及 Bootstrap 样本（约 04:54）

`8301513` 正常合入 `e36636a`：只有真实DOM证明为空、所有背景/边框/阴影/outline/
filter/backdrop/blend/appearance/scrollbar等都明确无绘制的ABS节点，才能不再阻断
旁边的普通 relative z-index 流恢复；节点本身、ID、ABS、几何、可见状态均保留。
两位独立源码审查通过，作者69项CPU检查与root新组合11项检查通过。
W3C导航得到Fill、header恢复Hug，但整页53958/75772/235427，窄屏比234531差896；
冻结media的768也86411→87326差915。此结构改进没有标记整页像素通过。

新真实生产 run `070581c8`，页62:921/viewport62:922：7个实际来源节点含viewport，
其中唯一原生ABS仍为无绘制1×1状态span，普通nav/after全AUTO Fill，header真Hug。
640→400→640只改外框，所有原生/官方几何delta0；两宽原生PNG、导回、导回重排共
**6次changedPixels0/max0、无警告**，证据 `real-figma/empty-overlay/acceptance-report.json`。
main仍为0295f827…未修改，仅生产UI验收桥附加通信；插件关闭、relay正常exit0，三份
已注册文件精确恢复。当前页62:921/viewport62:922宽640，没有删除原页面。

`8301513` 完整组合门禁已完成，运行前后全部app文件SHA相同、HEAD相同：
主测试 **536总/535通过/1既有跳过/0失败**（138705ms），UI测试
**103总/102通过/1既有跳过/0失败**（107643ms）。完整命令、日志SHA、前后文件SHA在
`round20-full-gates-receipt.json`；旧GPU文字858/max1与其它整页差异并未因此宣称解决。

又冻结官方 [Bootstrap Pricing](https://getbootstrap.com/docs/5.3/examples/pricing/) 和
[Checkout](https://getbootstrap.com/docs/5.3/examples/checkout/) 原始HTML/CSS/SVG字节，
仅移除脚本/非绘制链接、替换资源URL，不添加内容/CSS规则或提交表单。1280/768各自
原URL归档重放↔本地资源版严格0像素且DOM几何相同、0未知请求/页面错误。
生产转换（8301513，CPU）Pricing266节点：**62468/71172/196106**像素，原生预检因
-13间距会被1px子项钳制而拒绝；Checkout255节点：**41042/287339/266388**，原生仅
prepared且发现原始流变ABS，均strict=false，尚未真实原生执行。
证据 `web-corpus/bootstrap-pages-result.json`、各自raw/local/receipt/equivalence目录。

Checkout已定位Flex交叉轴margin丢失：原转换在align-items normal/center等非stretch
情况下丢弃cross margin并清空源margin；Typed OM原始16/48px仍在。最小6项固定100px
真实Flex换行复现首次0、重排19840、窄屏25200。准备恢复仅实际语义Flex父框/直接
语义子项的可靠固定px意图，合成margin-wrapper不重复套用；混合主/交叉margin已被
独立审查识别需诊断或另证，百分比子项尺寸仍保持保守。尚未提交此后续产品修改。
24小时目标继续active，截止10月22日00:31 Asia/Singapore不变。


### 固定 px Flex 交叉外边距恢复（约 05:02）

从 Typed OM 意图恢复被原转换清空的直接语义 Flex 子项 margin；仅实际 authored Flex
父框、真实直接子项、固定px、非变换坐标。原来已消费margin的合成包装继续拥有原inset，
不重复加；混合包装丢失的cross margin、非均匀/负/百分比margin、百分比尺寸和自身或
树内祖先transform保留测量fallback并诊断，未扩大为所有CSSmargin支持。
最小before首次0/重排19840/窄屏25200；normal、center、column三组修后SVG三模式
共9次0/max0，正确层级前端2宽共6次0且普通DOM节点均非absolute，保存重开稳定。
38项相关检查通过；补树内transform祖先控制后新文件2/2通过，独立源码审查无阻断。
最初相对margin负控制误要求已有分数光栅差异1240归零，已改查首次↔重排差异严格不变，
该被拒绝控制仍非strict通过，原失败日志保留。

前端normalized flat输入另发现实际缺陷：page.nodes被当作全部roots，CLI前端导出也走
此路径；Hug主框因此无子项、丢失背景1200像素，普通子层变absolute。正确层级输入的
上述6次比较通过；该API/CLI问题已交独立工作树修复，未改调用约定来宣称已解决。
此前空block/空overlay测试用flat输入时背景固定，像素相同不足以证明导出DOM是流式，
后续增加实际DOM父子关系/position断言与真实CLI入口回归。完整原生互转PNG证据不受
此HTML导出入口问题影响。所有before/after/source/frontend失败产物在flex-cross-margins。
已通过完整门禁的203b79d已快进到本地main，主检出干净；未push/发布，尚未更新Host
安装。后续修复继续任务分支，24小时目标仍active。


### FrameNONE、文字 Grid、前端树及反向换行组合（约 05:14）

`a823a30` 合入 `633a1b5`：inactive Frame/Component Fill与Rectangle一样预留真实inside
描边，忽略其失效的历史padding。只有两个空Fill子项、正剩余内容、起始/不换行、无未
验证min/cap/变换且预测尺寸位置与测量一致，才启用新增来源重排；否则保留测量parent
NONE并清理直接Fill关系，嵌套子层自己的布局不受破坏。实际4221 fixture注明live历史
padding与官方REST省略差异，8新测试及10次独立CPU SVG/前端比较0/max0。

`246050e` 合入 `0a1e44a`：单HUG行Grid的真实Fill cell内，可用唯一普通Text HFill/
VHug、原始textSource/wrap和真实测量行盒贡献行高；现有8pass次序解决宽→文字→行
依赖，不改通用Text创建/补丁，不新增格式字段。拒绝混合样式、列表/段落缩进/间距、
截断/大小写转换、描边/约束/跨行等；交叉审查实际抓到lineTypes/lineIndentations遗漏
并补守卫。原始字符和模式完整，153相关CPU检查通过；此时root三项合并124/124通过。
三份生成物check与typecheck通过，合并冲突只在生成UI，由组合源码重建解决。

实际生产 native Grid闭环 `99f44349` / 页62:967、board62:968，main SHA
`ccd322c405d1913bc71f8ce23615c1701de40055e5da73ecded0bfa2f4a71d11` 未修改。
原289e官方JSON＋同次live值通过精确生产supplement保留57真实图层/8Grid/24不透明cell/
24真实Rectangle，没有普通ABS。初始全部行630，只将真实equal-HUG-cellFILL行62:990
改390，再回630；其它7行保持630，所有官方/独立几何delta0。两个状态的原生PNG、
回导SVG、回导重排共 **6次0像素/max0、0警告**；原始研究nativePNG→生产回导nativePNG
另外严格0。参考390仅改独立CSS的这一行width，未改参考颜色/节点/其它尺寸。
证据 `real-figma/native-grid-roundtrip/acceptance-report.json`。插件关闭、relayexit0，
三注册文件精确恢复、锁释放，页面保留。此证明不覆盖之前708/483.328125分数失败。

`2c43b65` 合入 `f8d7a38`：flat Panel/CLI页通过现有repositoryDesignPage重建parentId
层级，当前active.nodes优先，inactive页和已有children契约保留。真实CLI写出的HTML、
API、resize/edit/reopen验证为流式DOM，640差1200/max17→0、400差23200/max233→0；
普通position relative，真实来源ABS保留。作者49CPU检查通过，root组合34/34通过。
此前flat空block/overlay前端测试的像素相同不再被当作层级正确的唯一证据。

扩展Flex控制发现column-reverse全局倒序后再分行，把两列实际ID组交换；重复配色原本
掩盖图像变化，唯一4色的独立控制复现12000像素/max225。`359939b` 合入 `46819b6`：
先按源顺序分行，再逐行倒序副本；测量与应用共用同一分组，wrap-reverse同时翻转行内
cross start/end，不改源数组顺序。72组H/V/方向/对齐/宽度返回的独立CSS↔SVG/前端0，
6个Hug阶段0，4个唯一色生产HTML×3模式0；41相关CPU检查通过。
root重跑实际存在的flex-reverse-wrap与margin两文件 **5/5通过**；第一次误命名只执行2项
的日志保留。margin正向控制扩为9组（含固定height对齐、双reverse、auto cross），SVG
27次和真实层级前端18次0，重开无需重排，祖先transform与丢失包装边界控制保留。

冻结Bootstrap生产复测（246050e）：Pricing仍266节点，62468/70633/196106，原生负gap
仍不支持；Checkout255节点，41042/101882/259945，相比287339重排差异减少185457、
窄屏减少6443，全部strict=false。未重写HTML/CSS/资源或掩盖其它ABS/媒体断点问题。
证据 `web-corpus/bootstrap-pages-after-246050e-result.json`。

实际负padding研究 `e578e56d`：18组38新节点，24次负数side setter全部明确拒绝且
getter未改变；12拒绝case未继续缩放，不能冒充负padding reflow。6个零控制960→400→960
通过，1306数值＋1095精确live/官方检查delta0；独立整数白板3PNG严格0/max0。
此API不能用负padding表达NHS外扩，无新schema/projection改动。插件关闭、relayexit0，
原页面/选择快照完全不变、注册三份精确恢复；证据 `native-negative-padding-analysis/`。
负Grid gap只作低成本边界复核，官方文档明确拒绝负值，不把它作为已支持方案。
当前正执行该6case研究，完成后转向实际文字闭环和多行表格的正向能力证明。
本地main仍203b79d稳定检查点，后续组合尚未推送/发布或更新Host安装。24小时目标active。


### 文字 Grid 真实生产往返与多行能力验证（约 05:25）

`b34b5dc` 完整组合门禁已完成，运行前后全部app文件SHA相同、HEAD相同，两组门禁
使用同一文件快照：主测试 **558总/557通过/1既有跳过/0失败**（161527ms，CPU），
UI **103总/102通过/1既有跳过/0失败**（108280ms，独占图形）。命令、全部SHA、日志
保留于 `round24-{main,ui}-receipt.json` 与 `round24-full-gates-receipt.json`。
此前b34的typecheck、validate、三份生成物check和Design Studio scoped build check均通过。

文字真实生产闭环 `add2958c` / 页63:1039、board63:1040：精确a4e5dd91原生来源与同次
live Grid supplement，经Panel导入、完整portable文件和未改的生产插件main导入，
保留57节点/8Grid/24不透明真实cell/24真实Text；228几何数值、498模式/Grid字段精确相等。
导出的760×1780原生PNG与原研究原生PNG **1,352,800像素全部相同，changedPixels0/max0**，
编码PNG也同SHA `9e4ba502517793449a40c3831820922f38a6fc562ecb178a43f971821ce88f1e`。
生产main仍ccd322c4…，没有新增原生PNG handler、文字替换、尺寸修补或阈值放宽。
证据 `real-figma/native-text-grid-roundtrip/acceptance-report.json`，独立逐字段/解码像素审计
在其 `independent-analysis/`。插件关闭、relay停止，注册三份SHA精确恢复。

独立审计同时发现语义差异：全部24个Text的官方 `style.lineHeightUnit` 从PIXELS变为
FONT_SIZE_%；16px字号时20/30px行高与像素仍相同，但后续字号编辑可能不等价。这是
待修复项，不能将当前结果写成行高单位无损。生产回导后的文字/宽度/字号编辑尚未执行，
浏览器与Figma字体字节/栅格一致性仍未证明。

负Grid gap研究 `4565292e` 实际完成：6case/14新节点，4次负数setter全部明确拒绝且
getter未变，拒绝case不继续resize；零gap的H/V控制960→400→960，Fill尺寸928→368→928、
偏移16。144数值＋342可用官方/live检查delta0，恢复JSON和PNG字节一致。此路不能表达
NHS负外扩，未新增canonical字段。证据 `native-negative-grid-gap-analysis/`；关闭插件、
relayexit0、三份精确恢复，原页/选择未改。

正向多行研究 `c8474231` / 新页64:1097：3case共62新节点含27真实Text；V父框HFixed/
VHug、真实Grid HFill/VHug、3个等比例列/3个HUG行，真实cell H/VFill，Text HFill/VHug。
table分别vertical padding0、padding10、padding10＋仅底INSIDE1/included；cell无padding。
5阶段仅改首Text的2→4→2行字符，外框630→390→630；不修补Text/cell/table高度，不恢复
被API意外改掉的模式。实际0case错误，文字恢复与宽度返回后的官方JSON/PNG均与初始
字节一致。原始live/5次JSON/5张原生PNG在 `native-table-grid-intrinsic-analysis/actual-c8474231/`，
raw SHA `8f3a61ea5653d6925421640d68c85ac4ddbd190f7ca2c3c62896388c24965e7c`。
这是能力研究，自定义研究handler并非生产闭环，尚无CSS/native字体像素结论；详细行高、
Fill、inset对比正在独立分析。插件关闭、relay自然exit0、原页面/选择与三份注册文件恢复。

冻结网页审计另外确认：Bootstrap Pricing为AUTO表格，400px下列宽受内容最小宽度影响，
不能直接将测量比例当固定tracks；28个单元格底边框被现有预处理丢掉前6行24条内部规则。
下一轮先分别解决可靠来源事实与经过真实原生证明的多行布局，不将整页原有非零差异标记通过。
本地检查点仍未push/发布或安装Host。24小时目标继续active，截止10月22日00:31不变。


### 整页新增负样本与原行结构能力（约 05:35）

又冻结官方Bootstrap Cover与Sign-in原始HTML/CSS/SVG，分别原始HTML SHA
`1dfe546d7cc32394a2aff0197b507ff5b4b17da459ee7fe6cc51302396e6988d`、
`977cea03905534c1db195f61c1a5d1b53633432a0a7fe211e91d3cab64f3b327`。
未提交表单或登录。1280/768的原URL归档重放与仅本地URL改写副本均严格0像素、DOM几何
相同、0未知请求/页面错误。生产c7c80b9（app与b34完全相同）CPU转换结果：Cover36节点、
23警告，首次/重排/窄屏 **418868/419472/329391**；Sign-in42节点、16警告，
**4379/4379/14885**；两者native transfer仅prepared，均strict=false、未真实原生执行。
完整输入、PNGs、diff、报告在 `web-corpus/bootstrap-{cover,sign-in}/` 和
`web-corpus/bootstrap-cover-signin-c7c80b9-result.json`。只读CSS核对确认Sign-in h1字号
28px→25.408px，Cover h1 40px→33.52px，Cover原生CSS还有80px inset阴影与文字阴影；
不将这些新失败解释为已支持的Figma响应式字体或阴影。CSS事实在同目录
`bootstrap-cover-signin-css-facts.json`，未改参考样式或字节来得到通过。

c847的最终分析确认15个case-stage几何模型残差0，1200官方/live坐标尺寸delta0，
4120可用字段精确匹配。HUG track的无效value getter实际为1，Inter字体另有
variationSettings，最初假定null/两键fontName的分析草稿和raw均保留；按官方类型语法
区分这些无效/附加字段，不改变像素比较器。90个无字底色带66960像素与作者颜色严格0，
只证明采样覆盖，未声称整张含字白板与CSS一致。

更接近GOV原结构的 `fc6bb994` 实际研究完成，新页64:1159，共68新节点：3个V父框各有
3个真实独立行Grid，每行5条affine轨道、3个真实cell及真实Text，保留行父节点。
前两cell始终right20，三个case分别cell vertical padding0、10、10加每行bottom INSIDE1/
included；五阶段只改原始字符和外框宽度。0case错误，文字与宽度恢复后的原生PNG都与
初始SHA `10d1c9ec677f2c47609d59cd0114fad2d97be66f233c6f3f394bd5dfb8abf7c7` 相同。
raw SHA `bc9cf9a35598a666b0f25ecb6d319ed8e482fdee59af098053c8edae1be181e6`，证据
`native-govuk-row-grid-analysis/actual-fc6bb994/`。插件关闭、relay自然exit0、原页面/选择和
三份注册文件精确恢复。详细模型分析仍在进行，此研究不是生产HTML/Figma闭环。

source精确审查抓到两项不能跳过的差异：冻结GOV实际row border为#cecece，早先口头
#b1b4b6是未经核验的简写错误，原DOM/inventory字节未变；45.5px首行与后续约46px来自
折叠边框分摊，INSIDE1能力样本不能直接证明其CSS映射。实际GOV还有9个链接/隐藏文本
cell和1个多P cell不在17个普通文字候选范围，尚不能宣称整表普通流布局已解决。

已清理本目标14个干净、无untracked/ignored、明确合入main且无活动依赖的旧工作树和
分支；外部evidence父目录全部保留。未合入的旧分支、其它任务、活跃总分支及新产品
工作树保留。详见 `worktree-cleanup-receipt-20261021-0528.json`。
完整门禁后的docs检查点c7c80b9已快进到干净本地main；未push/发布/安装Host。
24小时目标继续active，下一轮为边框捕获与px行高单位的已审查实现、真实编辑及逐像素复核。

### 行高单位、真实字号编辑及半像素边界（约 06:10）

组合 `8df3d224` 已完成 typecheck、validate、三份生成物check、Design Studio scoped build
check与完整门禁：主测试 **573总/572通过/1跳过/0失败**（172710ms，CPU且子进程继承
禁GPU preload）；UI **104总/103通过/1跳过/0失败**（111169ms，独占图形）。两组完整
app快照、各自起止HEAD均相同。证据 `round26-{main,ui}-receipt.json`、完整日志及
`round26-full-gates-receipt.json`。外部门禁工具最初将UI目录中的并发参数误当文件名，
在启动任何UI测试前退出；修正仅证据工具后完整重跑成功，原错误及两版工具SHA均保留。

已合入的底边框捕获 `5db607d` 保留pinned converter原始border字节，只增加有界表格
paint hint，避免修改布局padding/minHeight。早期直接恢复source.border的原型曾将8px
padding错误增为9px，已保留并标记非最终结果。最终Pricing 28条底边保留，节点顺序、
盒子、padding和sizing不变；首次/重排/窄屏像素 **62468/69812/196106**，重排比此前
70633减少821，仍非整页通过。最小不透明表格仍有后续cell遮住居中边框一半的失败，
collapsed-border诊断保留，未宣称CSS折叠边框已经通用支持。

`e277b31` 增加Text专属可选 `lineHeightUnit:"pixels"`，无该字段的旧比例语义保持兼容；
覆盖codec、测量/缓存、SVG/CanvasKit、前端、编辑器、Host编辑契约和Figma来源/增量更新。
`9cc5ae3` 同时修复前端wrap导出把缓存软换行固化为源换行的问题，保留真实原始文本。
有界184项CPU验证及上述完整门禁通过，包括px行高字号编辑、撤销、复制、重开UI检查。
HTML作者行高单位的辨别尚未扩展，不能将所有computed px一律当固定px意图。

真实生产往返 `546bb12c`：新页65:1321/board65:1322，未改生产main
`87a802e163f36d43bbcc9f7fb385969730cfd3ea06ceb8f8c00b984b3d22d093`。
57节点/8Grid/24不透明真实cell/24真实Text，228几何数值和498布局/Grid字段精确一致；
全部24个Text保留原生PIXELS20/30，未再变为FONT_SIZE_%。完整portable文件经生产UI
转换后导入，来源binding noop0；760×1780 **1,352,800像素changed0/max0**，编码PNG与
原始a4e5dd91的SHA仍为 `9e4ba502517793449a40c3831820922f38a6fc562ecb178a43f971821ce88f1e`。
证据 `real-figma/native-text-lineheight-roundtrip/` 包括完整run和独立逐字段/解码RGBA审计。

继续完成真实生产字号编辑 `1e576817`，新页65:1379/board65:1380：先仅用普通生产
preview/apply将一个affine行的3个Text改为旧相对行高控制，另一个等宽行保持PIXELS；
然后仅对这6个原始Text执行fontSize16→24→16，共3个单位操作和6+6个字号操作。
3阶段几何均精确0；像素行高保持20/30，相对控制变为30/45再恢复20/30，原字符、
所有57个ID/层级/布局模式保留，不提交height/sizing修补。初始及恢复的两份原生PNG各
1,352,800像素严格0且同原始SHA。24字号阶段无独立原生参考PNG，不声称该阶段字体
栅格与CSS一致。派生百分比getter作为原值/数学值/差值观察，不虚构PIXELS的百分比
精度保证；物理px、相对控制的请求百分比、几何和像素门槛仍精确。原插件已关闭、relay
exit0、三份注册文件全部恢复固定原始SHA；完整raw在同名primary acceptance-runs，
独立归档分析继续进行。

原生 `7937bd33` 六种stroke alignment/inclusion研究确认：只有INSIDE+included给行高
增加1；CENTER+included不增加0.5布局内边距。5阶段480官方/live坐标尺寸、1575可用
字段精确一致，恢复JSON/PNG字节相同。不能据通用API属性名推断CSS半边框分摊。
CSS独立43状态/47表格状态的实际模型为内容逻辑高度+作者padding+winning top/bottom
边缘各一半，父表再保留外侧半边；真实GOV首行45.5、后续46和外底0.5均未取整。

实际 `f4568ae6` 用CENTER/excluded1、row自身padding0、真实cell有效半边padding、
V父框外底0.5保留完整row/cell/Text层级，3case/68新节点、5个copy/width阶段完成。
330官方/live盒子精确0，5725可用SDK/REST值独立核查；初始、字符恢复和宽度恢复的
完整JSON/live/PNG字节一致。透明cell正例的14550个规则像素为精确#cecece、changed0；
不透明负例8730个预期灰色像素全部不同，证明子背景遮挡仍不能作为CSS通用映射。
第一分析稿180项差异原样保留，均可逐项证明为exact Float32请求值的轨道/颜色getter；
未对几何或像素加容差。40项SDK MIXED/REST默认0的总strokeWeight差异另记，逐侧
weight仍精确。证据 `native-css-collapsed-half-edge-analysis/actual-f4568ae6/`。
这是新页研究handler的能力证明，生产HTML表格提升尚未实施。

新增官方GOV无actions整页，原HTML SHA
`cc6f3cfcc6b632450f1859d14df98b30e84e1e1ad4b43ad0aeb908a9417d7e79`；原归档与本地
副本1280/768均像素0、几何一致、未知请求/页面错误0。8df转换27节点、16警告，
首次/重排/窄屏 **7536/7536/14116**，native仅prepared。只读12状态核查确认两列为
key30%+right20与valueAUTO/right0，窄屏key理想232.4但CSS量化232.390625；当前转换
仍保留1220px宽表和旧值列x416，未恢复真实列关系。根代理目测误判电话/邮箱合行，
已由实际PNG ink233–246与269–285、SVG位置和两个真实P框证伪并纠正，不据此做假修复。

另外冻结官方Bootstrap Headers和Jumbotron，原HTML SHA分别
`f38d7cf025c9192b4f6e07840a5b1854baa7c14a561facd322595798462681f9`、
`3bdb116c4f2bb32d6ff59641592ee95caad382024f60ef894f5947fc223878a3`；1280/768原URL
归档与本地副本严格0。8df首次/重排/窄屏：Headers281节点、100警告，
**309431/589400/370744**；Jumbotron61节点、20警告，**4155/4155/303610**。
后者原生transfer因-13px间距与1px AUTO子项受限明确unsupported；两者均strict=false，
未真实原生执行。完整输入/截图/diff/报告在 `web-corpus/` 对应目录，不隐藏新失败。

已刷新origin且无新main，干净本地main快进到已验证8df；未push、发布或安装Host。
后续为已审查的真实padded行Grid生产能力、CENTER半边模型和HTML行高意图研究。
24小时目标继续active，截止10月22日00:31不变。

### 带内边距的行 Grid 生产宽度闭环（约 06:17）

`fe437e0` 经正常merge形成组合 `3ed99992316091f2eea8b2bb466842df625c4cfe`：仅在
直接V父框固定宽、无循环/旋转/特殊约束的上下文，保留单HUG行内FILL真实cell与单个
普通Text的内在高度关系；cell padding只计一次，inside included底边1只计一次。
父上下文贯穿Panel布局、前端、导入/传输和生产插件预检/创建/收尾，不增持久化标志。
新负例继续拒绝不明宽度、inside excluded和不支持的文字/描边。80项定向CPU检查后，
完整组合主测试 **578总/577通过/1跳过/0失败**（173542ms），UI **104总/103通过/
1跳过/0失败**（108051ms）；typecheck、validate、三份生成物check、scoped build check
均通过。两组完整app快照、起止HEAD均相同；`round27-full-gates-receipt.json` 绑定日志
及各自精确runner源文件SHA。UI运行时原生插件已关闭，主测试仅CPU。

真实生产验收 `9834f4b1`：新页65:1437/board65:1438，生产main
`847ba1a37dee5ba9bcabd7da9bbbbcf1b552826327f64ff40af579a55fa98310` 未修改。
冻结fc6原始官方/live来源经完整portable和生产UI导入，67节点/9个独立行Grid/27真实
cell/27真实Text、初始几何精确0，来源binding noop0。每阶段重新读取来源，再通过普通
preview/apply仅修改3个V父框width630→390→630，共3+3操作；两阶段完整几何精确0，
原Text字符、padding、sizing、Grid/inside included语义保持，不提交后代尺寸或位置修补。
初始和恢复的两张760×1100原生PNG各 **836000像素changed0/max0**，编码SHA均与原
fc6相同 `10d1c9ec677f2c47609d59cd0114fad2d97be66f233c6f3f394bd5dfb8abf7c7`。
这是实际Panel生产宽度更新闭环；仍不是CSS整页或GOV折叠表格通用通过。插件关闭、
relay exit0、固定三份原始注册文件恢复、锁释放，未删除新页。完整raw在同名primary
acceptance-runs，独立文件审计和完整归档现已完成于
`real-figma/native-padded-row-grid-roundtrip/`。独立核对初始268个及两个宽度阶段各268个
几何数值均精确0；同时明确保留94项无可见stroke节点的闲置属性差异：37个INSIDE和
27个OUTSIDE变为CENTER、30个included true变为省略。这些未影响当前paint/布局，
但以后激活描边时的语义尚未保留，不能将这次结果称为全部属性无损；原值/差异列表保留。

1e576817独立审计补充：三个字号阶段另有684几何数值精确0；实际20px/24字号派生
百分比为83.33333587646484，与数学值差2.5431315009427635e-6，逐位等于Math.fround；
72项观察中70精确、2项确证Float32、0项未解释。该派生getter从未作为物理行高或像素
精度门槛，原始值保留；24字号栅格仍不声称与独立CSS参考一致。

新真实Headers失败进一步定位：97.62%的初始差异落在5个inset-shadow分隔带，原诊断
保留。另有头像路径mdo.png实际JPEG；相同JPEG字节/仅文件扩展名不同的独立CPU生产
控制中，.png被错误当PNG拒绝，三模式各1089差异像素；.jpg三模式均0。原网页资产和
参考未改名/重编码，修复在独立分支进行。CENTER半边能力实现和HTML行高意图研究也
在独立分支/证据目录进行，尚未合入该稳定组合。24小时目标继续active。

又清理3个已合入main、包含ignored/untracked检查也为空、且各负责人确认无运行依赖的
旧border、px行高和padded Grid工作树/分支；外部证据父目录全部保留。收据
`worktree-cleanup-receipt-20261021-0619.json`，活跃工作树及未合入的旧分支继续保留。


### 第28轮：CENTER 行、图片 MIME、HTML number 行高与真实多段落（约 06:42）

三个独立修复经正常merge形成 `462e735716f23eb2f2663c741d7a8192573beb4a`，生成文件均由
各自builder重建，未手改生成逻辑。完整主门禁 **593总/592通过/1跳过/0失败**（178858ms），
完整UI **104总/103通过/1跳过/0失败**（112791ms）；合计695通过、2跳过。typecheck、
validate、三份生成物check、Design Studio scoped build check均通过。两组113个app文件
完整快照和起止HEAD相同，`round28-full-gates-receipt.json` 绑定日志、精确runner与原生
清理收据。全库Video Studio的旧构建差异不在本次Design Studio通过范围。

`55ea2f3` 仅放行已由F456实际证明的CENTER/excluded底边1、row padding0、透明真实
cell与单普通Text的Grid内在高度关系；不推广到rectangle、不透明cell或任意CENTER。
实际67节点/9Grid/27Text的五阶段CPU回放、精确规则色正例和不透明负例均保留；前端
非INSIDE独立侧边的拒绝仍明确。新增CENTER生产往返尚未执行，不能以研究handler代替。

`1fbe4b5` 依据有界真实图片字节识别local/data raster MIME，保留原始资源、去重和预算；
SVG/raster混淆继续拒绝，实际SVG声明的栅格不能因猜测而变成额外可见内容。真实mdo.png
的JPEG字节不改名/重编码，最小头像三个模式从各1089差异降到0，25项解码矩阵通过。
整页Headers仍是 **309241/589188/370744**（首次/重排/窄屏，max255），不是整页通过；
两份头像保留、invalid-image诊断消失，主要inset-shadow差异仍存在。

`73d9ea0` 只对实际Element、单一匹配样式和Typed OM unit:number证据保留未取整的
有界CSS比例，adapter、普通文字和pre/nowrap恢复共享决定。真实GOV的Typed OM值
1.3157894897460938不再被geometry helper变为1.32；computed px/%/em等仍保留原回退
并明确作者依赖未证明，不假定所有resolved px为固定行高。继承/var/calc-number、
保存/重开和最小三模式像素0；完整GOV两个页面仍分别28133/28133/63753、
7536/7536/14116，失败不变。另发现并单独保留字号19→24→19时SVG **0→865→0** 的
既存HTML baseline刷新缺失，前端三阶段0；后续独立修复正在验证，不混入本提交。

真实整张无actions双段落Grid研究 `0172eaef` 已完成并关闭，使用新27节点页而不改旧页。
完整DL→4DIV→8DT/DD，DD内真实wrapper(P(Text))+P(Text)、9Text均保留，普通Auto Layout
Fill/Hug依赖不改为绝对定位。电话1→4→1行使P25→100→25、wrapper36→111→36、
contact81→156→81、DL269→344→269；仅改字符或外层width1220→708→1220，未修补
后代高度/模式。160作者纵向数值精确0，5625可用/保护字段独立核查，官方/live盒子0，
22352个规则像素精确RGBA206/206/206/255。初始、字符恢复和宽度恢复的完整SDK/官方
JSON/PNG字节一致；初始PNG SHA `ad97d9ee8c703836c15b412c0c1007afa6cae6ba4b2c9508786b9daa94a8807b`。
原严格报告仍false：45项为9Text×5阶段的SDK fontName额外variationSettings，另32项为
708宽时x/width的原生浮点差异，最大相对理想值2.441406252e-5；无y/height/层级缺失。
与冻结CSS相比key/value宽各差+0.009384155/−0.009368896px，未加容差、偏移或取整。
这不是GDS字体/整页CSS像素通过。完整归档、首次失败与补充独立审计在
`native-table-multi-p-analysis/actual-0172eaef/`，下一步是有界递归V/Hug内在高度，再整体
提升包含contact的DL，不能永久排除最复杂行。补充更正旧8df观察：当前f455/462外层
body/DL/rows已能缩到768/708，尚未恢复的是cell列关系（仍386/834和旧valuex416）。

真实阴影能力 `e57d7a65` 同样完成/关闭：7新节点、5case、3宽度阶段、21导出，几何0，
每个frame恢复的640 PNG字节相同，原页/selection不变。相同CSS参数直接赋原生INNER
不能宣称相同画面：640透明原图Header alpha0.1 **15449/max39**、无fill **30720/max50**、
白不透明控制 **27896/max43**；Cover不透明无边框 **130308/max3**。无fill内区29440像素
原生alpha全0，CSS全部有阴影；有边框顶部中心原生alpha93、CSS60。差异包含真实
遮罩/边框语义，不能靠改blur或偷偷补不透明底消除。两层黑色effect getter次序保留，
不能据黑色图证明任意彩色层的视觉叠放次序。原始32文件、透明PNG和实际白boardPNG
各自保留，分析在 `native-inset-shadow-effects-analysis/analysis-e57d7a65.json`。
两个研究relay均自然exit0，插件已关闭，固定ORIG3三份注册字节恢复、双锁释放，
loopback端口关闭；`round28-native-cleanup-receipt.json` 记录独立复核。

更宽的9834闲置stroke审计在原94项之外加入明确列出的weight等10个REST字段：64个
空strokes节点共640检查，现记录 **152差异**（37 Frame INSIDE→CENTER、27 Text
OUTSIDE→CENTER、58 weight1→0、30 included true→省略）。3个有paint行明确排除。
旧94项窄范围报告不改写，原图0不能证明以后激活描边的语义；候选方案及原始逐字段
清单在 `inactive-stroke-intent-audit/`，尚未实现，不以Figma默认值补猜。

24小时目标仍active，截止10月22日00:31；未push、发布或安装Host。下一批独立分支
继续HTML baseline、真实多段落内在高度和Text shadow；已有所有严格失败继续保留。


第28轮整合后已刷新origin，origin/main仍c7eeee3；干净本地main快进到eaebde2，113个
app文件与462的完整UI门禁快照逐SHA一致。收据 `round28-primary-integration-receipt.json`。
又移除负责人明确确认无依赖、tracked/untracked/ignored均为空且已合入main的CENTER和
MIME两个工作树及分支，不用force，外部证据父目录保留；收据
`worktree-cleanup-receipt-20261021-0643.json`。聚合目标、新内在V-flow、baseline、Text
shadow工作树继续保留；number旧工作树仍被baseline配对证据使用，暂不清理。


### 第29轮：HTML 字体编辑、多段落内在高度和 CENTER 生产像素（约 07:05）

`8be24ee` 增加严格Text专属HTML baseline来源。只有真实绑定的普通/pre/nowrap来源且
浏览器当前line-box模型精确复现初始y才标记；初始几何不变。字号/字体/行高编辑复测
hanging offset、保持逻辑顶边，Node-only保留来源，手工offset编辑退役HTML来源。
原生transfer移除HTML标记但保留物理offset，binding仍比较逻辑y。相同73基底字号
19→24→19的SVG从 **0/865/0 变为0/0/0**，前端原本三个阶段均0；原失败PNG/SVG保留。
3225项冻结GOV几何/baseline字段前后精确一致，实际只标记8/58和2/9Text；整页GOV
失败仍28133/28133/63753和7536/7536/14116，没有扩充到未证明的混合/表格文字。

`970988e` 修复已有canonical Text.shadow前端误用box-shadow，改为字形text-shadow，
形状box-shadow累加保持原行为。15个明确authored overflow-wrap:anywhere的直接DOM
宽度/文案/保存重开比较逐像素0。独立default-normal控制仍有1个case的1像素/max2
差异，原图和 `shadow-fidelity-analysis/frontend-text-shadow/default-wrap-report.json`
保留；没有据此声称HTML text-shadow捕获或SVG/CanvasKit文字阴影已经完整修复。

`4fe3326` 依据实际0172在固定宽度owner内，递归求真实DD→wrapper→P(Text),P(Text)
的V/Hug内在高度，不读旧拉伸cell高度。最多4层/32节点/每层16子项，正有限padding/
gap、无隐藏/绝对/旋转/wrap/reverse/minmax/不支持文字；原direct rectangle guard不扩张。
子树每个Text保留原始native typography拒绝检查。6个新CPU测试和生产VM验证完整26个
canonical节点、文案1→4→1、宽度1220→708→1220、真实字体wrap/保存重开；原32个
小数横向差异与45个font getter额外字段仍在fixture中。1220整数宽SVG和独立无stroke
前端控制为0；新多段落生产插件实际往返尚未执行。HTML Fill-owner祖先证明和whole-DL
提升在下一独立分支，不把DL硬改fixed、不永久排除contact、不以测量宽度证明Fill。

组合 `96113b0c64c56970c8b2a30469c611269b575949` 完整主门禁 **607总/606通过/1跳过/
0失败**（184702ms），完整UI **104总/103通过/1跳过/0失败**（110495ms），合计709通过、
2跳过。typecheck、validate、三份生成物check、Design Studio scoped build check通过；
起止HEAD、113个app文件快照一致。`round29-full-gates-receipt.json` 绑定日志和runner。

使用稳定af07594生产main（SHA1798ec43…）完成真实CENTER往返 **1f0582dd**：新页
66:1539/board66:1540，未改生产main。原F456官方/live来源经完整portable及生产UI导入，
67节点/9Grid/27真实cell/27真实Text、初始及width390/return630全几何精确0；普通生产
preview/apply仅提交3+3个父框width操作，没有后代height/sizing修补。初始和恢复PNG各
760×1100 **836000像素changed0/max0**，编码SHA都与原F456完全相同
`7095cc6c5ef36a8ae77af76ebcb241d038bcfcea3ca210583dc1941eadf55c61`。窄屏PNG未执行，
不声称CSS/GDS/原生字体栅格通用一致。146项无paint闲置align/weight/inclusion差异在
三个阶段明确保留；这不是全部原生属性无损。插件已关闭、relay98138 CtrlC实际exit0、
固定ORIG3恢复、锁释放；新页保留。40文件独立逐字节归档与RGBA/geometry审计在
`real-figma/native-centered-row-grid-roundtrip/`，分析SHA3261d3ed…。

CENTER harness准备阶段的VM不同prototype比较失败和缺失omitted-zero padding负例
均在真实运行前暴露、保留首次源码/日志后修复；不放宽数值比较。最终source37c7b0af…
及19/19纯Node测试由另一代理独立复核，通过后才实际执行；原始失败记录不改写。

新冻结官方GOV任务列表 https://design-system.service.gov.uk/components/task-list/default/，
原HTML SHA `a59615240ec8e503dca4bcf75b7fed9f4e8a4838df424a7d4855d08d39d37003`，
本地副本SHA `a0e849d42cc47f5c929e193c8c650f73fead1c7f668f30d2de667b16ab55e8e6`；
1280/768/400三个宽度原归档对副本均像素0、几何一致、未知请求/错误0。生产af5afac
54节点/17警告，首次/重排/窄屏 **15576/15576/24470 max244**，原生仅prepared且语义
检查明确报普通流子项变为absolute，不能当作合格Auto Layout。新增真实失败保留。
另四个最小控制确认链接变黑发生在sanitizer移除href后使CSS :link失效；直接原始
html2figma捕获为正确蓝色，非链接状态CSS也正确。不是已证实的字体加粗错误，不改
上游文字颜色推断来掩盖。下一独立分支处理保留安全链接状态与无导航捕获，原图/CSS
不改写；任务列表的表格关系仍作为后续普通流工作。

本轮继续保留所有严格失败。24小时目标active，10月22日00:31截止不变；未push、
发布或安装Host。下一批为Fill祖先宽度证明、whole-DL提升、闲置描边完整激活语义、
有序CSS阴影遮罩以及链接选择器捕获。


### 第30轮：Fill 祖先宽度、链接选择器和严格阴影负例（约 07:20）

第29轮已按完整709pass/2skip证据从干净primary main af07594 fast-forward到173436f7；
113个app文件与测试源96113b0完全一致，记录在外部round29-primary-integration-receipt.json。
经各owner确认、clean/ignored/ancestor审计后，不加force清理baseline8be、nested Grid4fe、
Textshadow970和number73四个已合并闲置worktree/分支，外部证据父目录完整保留。

本轮聚合e281da0包含两项独立修复，尚未同步primary：
- 5e328a9通过捕获/运行期实际父对象证明Fixed→多层Fill→Grid的宽度依赖，所有链有界、
  防循环，并拒绝未知祖先、Hug宽度、水平或其他未证明上下文；不从保存的Fill宽度推断。
  真实层级保持、outer-only缩放、嵌套文案编辑、reparent和保存重开均有正负控制。
- bc23c32在脚本隔离的静态捕获中保留安全HTML A[href]原属性，恢复 :link/[href] 样式。
  共用谓词限制HTML命名空间、2048字符、控制字符及协议；不改写到伪造URL。工作台iframe
  保持allow-same-origin无脚本，独立插件保持opaque allow-scripts仅固定nonce脚本；两端都
  inert且capture-phase取消click/auxclick/submit，表单/资源/脚本原边界继续生效。

链接候选48/48相关CPU浏览器测试、静态与三个generated校验通过。首次standalone颜色测试
因VM对象prototype不同而失败，通道数值完全相同；首次日志保留，改为逐通道严格数值比较。
上下文+链接组合9文件169/169通过。完整round30 gate对e281da0所有114app文件保持不变：
主套614项，612pass/1skip/1fail，199385.213417ms；UI104项，103pass/1skip/0fail，
120358.673333ms；typecheck/validate/3generated/Design Studio build check通过。
唯一主套失败是已有970红色零模糊文字阴影四行copy在width400的1px严格差异（max2），
与并行代理原始复现一致。完整失败receipt/log未重写，不能把本轮称为全绿；primary仍停在
上一轮已验证173436f7。后续修复保留该原始case及其严格负例边界，不替换掉失败fixture。

冻结真实网页在相同原始字节、相同字体与截图参考下成对执行：任务列表原/候选首次及重排
15576→14791，768窄屏24470→23685；GOV Check Answers首次及重排31125→30417，窄屏
70084→70083。两页原参考PNG逐字节一致；所有阶段54/188节点的身份、层级、layout、
positioning和几何完全相同，仅5/29项颜色及href语义相关元数据变化。任务列表仍报flow
absolute，检查答案仍被原生负间距预检拒绝，整页均严格失败；没有宣称普通流已修好。
paired-real-web第一版因旧Check Answers receipt使用另一字段名而在运行候选前中止，
首次脚本/log保留；v2绑定既有local-assets-receipt的b2220c13…源hash并使用全新输出目录。

只读对照又确认任务列表真实CSS -webkit-font-smoothing:antialiased，字号/字重均19/400；
源和sanitized computed style完全相同，候选颜色#1a65a6也与源一致，未证明font-weight错误。
保持canonical/字体/坐标不变，SVG wrapper仅应用该原网页设置，14791→7580严格差异；
max244和剩余差异仍保留，0网络请求/错误。此为独立控制实验，尚无产品改动或跨平台/
Figma原生字体栅格一致性声明。原始underline thickness1px/offset2.9982px也尚未保留。
证据在html-link-selector-capture外部父目录的paired-real-web-*、real-task-list-styles-v2.json
和font-smoothing-control.json。下一独立修复先证明字体平滑可保存/渲染语义，再设计原生
无法设置此浏览器属性时的明确诊断和往返元数据边界。

下一真实生产验收计划已冻结：0172多P原始26节点/4Grid/8cell/2P/9Text，普通phone文本
copy1→4→1及单DL width1220→708→1220，禁止后代height/sizing修补。保留原生Float32
与CSS分数差异，固定原PNG ad97d9ee…，未安装或执行新native。当前Figma保留上轮
66:1539/board66:1540；ORIG3已恢复，无native/GPU会话占用。

24小时目标active，截止10月22日00:31不变。未push、发布或安装Host。


### 第31轮：完整普通表格、可编辑阴影和闲置描边（约 07:41）

聚合源5cbc1f294eb9078af8e1b55bf5baa00c487d9078已完成最终组合回归：主套647项，
646pass/1skip/0fail，210100.563458ms；UI107项，106pass/1skip/0fail，119208.425042ms。
合计 **752pass/2skip/0fail**，全部117个app文件在两套前后完全一致，tracked clean、HEAD
不变。typecheck/validate、三个generated check和Design Studio scoped build check均通过。
外部round31-full-gates-receipt.json SHA
`68cd54eb36e3510e0464a7cd07c72f5244e1d7bd9669a58de8d1c85f9017778d`。
功能测试通过不等于所有像素通过：旧红色零模糊Textshadow原fixture未替换，历史0/1px
max2明确作为strictPixelParity:false负例保留；若出现其他坐标/RGBA差异仍失败。此次五个
样本刚好0，不据此抹去此前失败。round30完整失败receipt仍在。

合入d3cc665有序CSS阴影：Text-independent的css-box 1–8层inner/outer可编辑，canonical/
codec/SVG/CanvasKit/frontend/cache/inspector完整贯通；只接受已证明的零spread、颜色/
透明度和几何蒙版组合。实际DOM/frontend受控案例精确0；SVG模糊仍有Header max4、
Cover max1差异，原生Header透明/边框蒙版预检明确拒绝，Cover仅保留可编辑参数并警告
native/CSS kernel不一致，非严格原生像素成功。原生未知INNER仍只留rawsource和诊断，
不伪造native-paint模型或隐形背板。source审查修复document-coordinate gradient paint
server与local shadow-mask混用问题，新增实际渐变控制。

合入f95da42闲置描边：原生strokes:[]的宽度/对齐/完整侧宽和inclusion另存bounded
nativeStrokeInactive，canonical不画出描边；raw缺省与explicitfalse分开，已证明的AUTO
REST缺省使用default:false，NONE不猜默认。未知样式sourceOnly不能仅删标记绕过复制。
自然颜色/宽度/对齐/移除操作在完整draft上验证后提交，inside+included只加/减一次有效
padding；Text OUTSIDE激活先要求自然选择Center。NONE显式inclusion的激活/复制继续
拒绝，允许先变为真正Auto Layout；未省略未知原始样式，未伪造不适用setter。
64实际来源样式有CPU保存/transfer/noop覆盖，40独立CSS↔SVG/frontend像素控制精确0；
此轮真实Figma全属性/激活验收尚未执行，不能说原152/146字段损失已实机归零。

组合审查保留context options{gridParents,copying}，copying只来自可信调用上下文。
去除会只提交5字段的旧阴影stroke wrapper，防止丢metadata/padding；canonical stroke
finaldraft验证CSS mask，nativeEffects仍只在真实native transfer/patch前检验。另验证
当前raw/baseline/after的CSS stack完整性，未声明shadowStack修改不能省略或伪造意图，
两个nativeVM负例证明拒绝后零写入。首次2项组合UI为1pass/1fail，实际诊断发现移除后
applyAllAutoLayouts缺少导入导致撤销历史未提交；补齐导入、保留正常输入/撤销控制后
2/2通过，无额外等待或焦点补丁。原始失败和完整toast/input/trace在外部日志保留。

合入a05755e whole-DL恢复：从真实CSS fixed/collapse、30%+右20/auto、T/B10和透明
表面等1–64行有界语法恢复整表，保留所有行/DT/DD/真实P和已有margin-wrapper。
捕获期onNode只建立原source对象→canonical的WeakMap，P原有普通文字恢复后再规划，
整张owned draft验证/测量/nativeGridPlan通过才一次提交，失败不残留局部layout或文字。
TypedOM height:auto/minmax/aspect/column guards与直接匿名内容反例齐备。5组受控家庭
15次严格像素全0，41 CSS/content负例、显式height floor和晚期atomic失败均覆盖。
冻结GOV No-Actions源26节点保持，加viewport共27；三个状态ABS0、semanticIssues[]，
保留真实P和原始x/y，primitiveText只改为真实Fill/logical linebox。12条精确已恢复
warning ID/code仅成功后退役，原16warning历史保留，4collapsed paint及捕获媒体状态
限制继续可见。整页原7536/7536/14116→候选7536/7536/7541 max95，仍严格失败。
第一条affected命令遗漏CPUpreload被中止，原日志保留，全部owned进程确认关闭；正确
CPU继承rerun通过，无native/GPU或注册插件变更。

最终组合5cbc1f2对冻结Bootstrap成对复测，六张参考PNG逐字节一致、源hash不变：
Headers首次309241→80921，重排589188→360868，768窄屏370744→315545；Cover首次
418868→106413，重排419472→107017，窄屏329391→95557。全页均严格false，0未知
请求/浏览器错误，Headers原生蒙版仍明确unsupported。完整报告和source/converted/diff
PNG在round31-web-shadow-pair，不能把视觉改善当成0像素或原生成功。

新增两个只读结论避免虚假成功：Tasklist两cell真实width:auto，tag有T−2/B−3负margin，
绘制30px但逻辑占位25px；Fill+Hug/Grid1fr+maxcontent虽初始截图0，却已有cellBBox差异，
长tag/Completed文案编辑出现2921/4078像素失败，不能套用固定表格公式。另当前fidelity
检查遗漏nested parent.layout:none：只改嵌套V→NONE而子项仍AUTO，SVG字节相同、旧
semanticIssues仍[]。这些是独立待修能力/检测缺口，不把没有显式ABS当成Auto Layout
证明。外部task-list-flow-analysis及nested-manual-flow-audit保存反例。

0172 multi-P实际生产harness已准备，精确26/4Grid/8cell/2P/9Text五阶段oracle、每阶段
仅一条phone characters或DL owner width更新；18/18纯Node在primary173与组合5cbc
均通过，独立peer clean。source58a36d45…，全部production/page guard仍ROOT_MUST_PIN；
无实际安装/relay/native动作。下一阶段以本轮验证后的稳定primary最终HEAD/main/UI/
manifest固定，再重新核对真实当前页并执行，不从WIP或overlay推断生产版本/原备份。

24小时仍active，截止10月22日00:31不变。未push、发布或安装Host。


### 第32轮：多段落原生生产往返和新网页负例（约 07:55）

稳定primary先从173436f7干净FF到bcbc927，117个app文件与已完整测试5cbc1f2逐字节
一致，752pass/2skip/0fail证据不变；仅journal不同，不重复应用回归。origin/main刷新仍
c7eeee322。round31-primary-integration-receipt.json记录整次集成，无push/发布/Host安装。
随后按owner确认移除5个干净已合入checkout/branch（Fill上下文、链接、CSS阴影、闲置
描边、whole-DL），external父目录和全部证据保留；没有force删除或清理其他未完成分支。

原58a36d45…未装harness先归档，再仅固定稳定bcbc927生产commit、main1473a789…、
UIdc968a66…和manifest7438d5b5…，18/18纯Node和完整prepare-only通过。四个page guard
仍默认不可执行，安装时显式给定经最新CUA核对的真实页和官方receipt SHA；固定ORIG3
从未重新采信overlay。第一实际run8a51c7dc在全新68:1607/board68:1608导入成功：26节点、
4Grid、8cell、2真实P、1原margin-wrapper、9Text，初始几何差异0；DPR1原生PNG816000
pixels changed0/max0，encoded SHA ad97d9ee8c703836c15b412c0c1007afa6cae6ba4b2c9508786b9daa94a8807b。
copy4实际已应用，但harness过严地期待warnings[]，被精确textSource元数据保留提示中止。
该run永久保留FAIL及36个原文件，未重试同一slot或改写状态。另通过真实插件普通导出按钮
保留失败现场官方JSON，独立原0172四行oracle验证26节点几何0、phone自然100px，不能
据此把中断流程改判PASS。

只修改外部v2 harness的预期诊断：仅两个文字stage允许指定phone的精确一条textSource
元数据保留提示，两个width stage仍必须[]，任何额外/错节点/错key诊断或operations!=1
都失败。生产代码1720–1723先写真实characters，1886–1912另存plugin metadata并产生
此提示；独立peer核对after.text/textSource都是4条真实LF、preview无conflict。19/19纯
Node含额外/错误warning负例、v2完整prepare-only通过；其他独立native oracle、PNG、
生命周期/ORIG3/双锁/slot一次性认领全部未改。原v1失败现场、v2精确diff和新旧脚本SHA
保留在native-multi-p-production-preparation，review receipt SHA29d336a5…。

v2新建68:1634/board68:1635，run e2cd2288完成真正生产native→v3保存重开→portable→
普通UIconverter→native与四次普通patch。每次仅一条phone[text,textSource]或DL owner
[width]更新，无创建/删除/child position/height/sizing修补。五阶段26节点的真实几何、
层级、4Grid/8cell/2P/9Text及模式均与冻结0172官方+SDK oracle精确一致，最大几何差异0。
文本一行→四行→一行自然25→100→25；DL1220→708→1220保留原生Float32，窄列真实
475.6000061035156等不取整或向CSS拟合。此次五阶段harness已覆盖的闲置stroke三属性
差异均[]；独立presence-aware审查进一步确认22个闲置节点全部stroke相关字段/缺省在
五态均相同，四个active行的CENTER和[0,0,1,0]侧宽也精确一致。完整raw仍不相同：
HUG轨道value:1省略、SDK mixed行的REST scalar0省略、显式默认/SDK tracks补入，以及
手动PNG导出后board新增exportSettings。返回端没有另一个独立全SDK getter dump，
REST缺省false不升级为显式getter恒等。独立review.json SHAe2d07d8f…，receipt8139705a…；
原始draft遇到HUG/exportSettings而中止的日志也保留，不宣称所有属性完全无损。

初始、copy-returned1220、returned1220三张1360×600原生PNG各816000pixels严格changed0/
max0，三者encoded SHA也均与原0172 ad97d9ee…完全一致。copy4/708仅几何验收，未做
那两态PNG；CSS↔native字体与分数轨道像素仍UNVERIFIED。插件已关闭，已知relay95596
正常exit0，ORIG3三文件精确恢复、双锁不存在，未删原生页。最终report SHA
 e09eaad72fe08bc1b9213f3f2a4f6f39564fd2666bfdeee02b379f1e178ba74b。
完整58文件与第一FAIL36文件逐字节归档到real-figma/native-multi-p-grid-roundtrip，
root-archive-receipt SHAfbccdf8194573fcad9c34d43a4dd8c95ac1e8e9612d05515f8477d0f0d4fe5af。

新增真实官方网页负例：[普通通知栏](https://design-system.service.gov.uk/components/notification-banner/default/)
和[成功通知栏](https://design-system.service.gov.uk/components/notification-banner/success/)。
原HTML/CSS/字体先原字节冻结，再只本地化资源URL、移除脚本；不重写可见内容/CSS。
raw SHA分别f3fd865a…/ac3580aa…，各8响应无fetch错误。稳定bcbc927全部117app文件前后
相同，生产捕获、v3/portable及SVG比较均CPU离线，0未知请求/浏览器错误。1280首次/
重排、768分别5698/5698/5698和9036/9036/9036；新增400宽实际换行控制分别13272/
17133，max均244，全部strictfalse。基线在round32-notification-banners和-400，原RGBA/
source/converted/diff PNG完整。初版外部摘要误读flattened comparison.metrics而漏值，
原摘要保留，baseline-analysis.json从原report精确补全，无像素重跑/结果改写。一次只读
脚本错误把v3 pages树当flat nodes，未启动任何browser；后续按真实children读取。

这两页旧semanticIssues仍[]/nativeTransfer prepared，却真实存在普通P layout:none/
fixed及手动Text（rich-text-uniform/html-plain-text-fixed警告），再次证明需要按真实元素
身份逐层追踪的不可变义务审查；检测修复和peer反例检查仍独立进行。Tasklist普通布局的
AUTO表格内在分列及tag负margin仍不伪装成Fill/Hug/native成功。字体平滑软件对照18例
中既有fallback+显式attached研究注入13/18严格0，其余5各1px/max1；默认supplied字体
真实SkParagraph为0/18，未改产品渲染或偷偷去掉字体资源。所有原字符/LF/NBSP和2x
master负例保留；真实WebGL/缩放/缓存还需独立证明。另窄范围尾部合成NBSP与空伪元素
修复正在独立分支以真实Range和完整无绘制证明验证，尚未合入。

24小时目标仍active，截止10月22日00:31不变。未push、发布或安装Host。
