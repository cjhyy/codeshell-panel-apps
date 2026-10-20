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
继续验收真实 Figma 400 px 重排和官方 JSON 回到工作台。

官方 Bootstrap Pricing 网页已保存自包含原始 CSS/媒体查询样本（245,389 字节）。
来源和改动回执在主任务 `evidence/web-bootstrap/receipt.json`。
1280×1000 / 768×1000 正式导入初始/同宽重排/窄屏差异为
16.79% / 21.82% / 30.34%；255 个可编辑节点。主要问题是标题与浅色表头、
SVG use 引用丢失、布局重排。对应 `evidence/bootstrap-production/`，
不得将收集模式的退出码当成通过。已分派保持文本与布局的针对性修复。

下一轮工作树：

- `design-studio-html-text-reflow-20261021/codeshell-panel-apps`：plain-text 容器和浏览器实测换行。
- `design-studio-html-paint-fidelity-20261021/codeshell-panel-apps`：真实网页颜色/文字/SVG。
- 主像素脚本新增 portable 资源验证、可配视口与真实浏览器 layout 环境，继续补充回归。
