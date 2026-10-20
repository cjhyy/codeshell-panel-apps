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
