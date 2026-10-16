# Design Studio 0.19：Figma 交换、交互原型与设计评审

更新：2026-10-16。实现属于独立 Design Studio Panel，沿用既有工作区文件、存储和
Agent 提交权限。当前交付覆盖 JSON 交换、来源保留、原型、评论及完整迁移；真实
Figma 桌面插件已通过文字与位置的基本往返核对，正式 UI 的 native bridge 回执
兼容已修正并通过 Chromium 回归。真实 Figma 验收不能由浏览器或 API 替身测试替代。
最终发布证据统一记录在[交付验收记录](design-studio-completion-audit.md)。

## 已实现的产品流程

1. 在 Figma 使用[随包开发插件](../../apps/design-studio/app/figma-plugin/README.md)
   导出选区或当前页，取得含原节点、图片字节和复杂图层预览的来源 JSON；也可导入
   官方 REST 文件／节点结构。
2. 在面板 **Figma** 入口检查页面、图层和兼容性提示，再导入为可编辑设计。
3. 使用画布文字、属性、自动布局、撤销／重做或 Agent 事务修改设计。保存、重开、
   长操作历史和未保存草稿恢复均保留对应来源；撤销回普通设计时明确记录没有来源。
4. 下载完整的 `design.figma-transfer.json`，在插件中选择创建新页面，或预览来源
   节点的修改、冲突和删除后更新原设计。完成回写后重新导出 Figma 来源包，再开始
   下一轮修改。
5. 在 **原型** 中配置页面跳转、返回、安全 URL、起始页面和响应式页面断点，预览
   并下载多页离线 HTML；可明确选择包含评审评论。
6. 在 **讨论** 中把问题关联到页面／稳定图层 ID，回复、解决、重新打开或交给 Agent。
   需要迁移时，下载 v2 完整备份并恢复到新设计路径，附属数据一起验证和重命名。

这是一条带来源校验的 JSON 往返流程。转换文件不是二进制 `.fig`；面板也不会把自身
transfer 包当作官方 REST 来源再次导入。导回已有设计通过用户运行的 Figma 插件
完成，项目评论不会自动发布为 Figma 云端评论。

## 来源、原型与评论如何保存

以 `designs/product.codesign.json` 为例：

| 文件                        | 内容与用途                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `product.codesign.json`     | 原生 v3 设计；大文档使用已校验的分页索引。                                              |
| `product.figma-source.json` | 设计版本对应的来源索引，或完整备份恢复出的来源绑定；保留原始属性、稳定 ID、基线和映射。 |
| `product.prototype.json`    | 起始页、显式点击动作、目标页面／URL 和响应式页面断点。                                  |
| `product.comments.json`     | 页面／图层讨论、回复、署名、时间和解决状态。                                            |
| `designs/codesign-data/`    | 经摘要校验的不可变页面、图片、字体、来源、附属文件和恢复分片。                          |

小附属文件直接存为 JSON；较大的内容由同名主文件记录分片路径和摘要。更新主文件
使用 Host 版本校验；分片先写入，最后提交主文件。来源与恢复引用不能成为任意项目
写入路径。手动搬动设计时应同时保留相关附属文件及内容目录；跨项目移动优先使用
完整备份。

v2 完整备份包含全部页面、图片／字体字节、已保存评论及回复、Figma 来源和原型。
附件逐项检查支持的格式、UTF-8 字节数、SHA-256 和数量；恢复前验证全部附件，并
检查目标冲突。恢复生成新路径，重写评论的 `designPath`，主设计最后提交。已有不同
内容的文件会阻止恢复。资源、来源或评论分片缺失、损坏、不可读时停止，而不是下载
一个声称完整却缺数据的包；确实没有评论文件时写入明确的覆盖记录。v1 完整备份和
可验证基线的旧恢复日志仍可读取，旧日志的来源引用也会校验后随恢复保留。

评论文件每次修改先读取最新版本，并以版本条件提交，能够合并另一窗口已经保存的
讨论。评论草稿仅在 Host 声明安全的存储快照／CAS 方法时持久保存；发生并发草稿
冲突会停止自动覆盖并保留当前输入。浏览器本地模式采用独立窗口记录。评论文本和
导出原型里的评审内容使用文本节点显示。

## Agent 与大包交换

0.19 声明 16 个工具。新增 `exchange_figma`、`get_design_comments` 和
`update_design_comments`，既有 `generate_frontend` 增加多页原型和可选评论导出。
修改与交换要求最新 `get_design_metadata.stateRevision`；评论读取返回有界摘要，
完整内容和回复通过稳定讨论 ID 分页读取。把讨论交给 Agent 时先保存当前设计，再
提交页面、图层和讨论上下文；等待期间切换项目或文档会停止后续提交。

`exchange_figma` 的项目输出会返回 `storage: "json"` 或 `"multipart"`。后者的项目
文件是带摘要的分片清单，不能直接作为 Figma transfer 文件选择。面板下载入口会
生成完整传输 JSON；Agent 也可按清单读取相对分片、验证字节数及 SHA-256 后组装。
Agent 导入能够读取同样的分片来源包。导入与导出的逻辑 JSON 上限仍为 16 MiB。

`generate_frontend` 默认生成单页静态 HTML；使用 `prototype: true` 导出完整交互
原型，确实要携带评论时同时传 `include_comments: true`。HTML 中保留稳定图层映射。
面板下载能生成包含内嵌资源的离线 HTML；直接写入项目的 HTML 受 Host 单次文本
预算约束，较大文件应通过下载入口取得。附属文件和 JSON 交换的分片并不使 HTML
清单变成可直接打开的网页。

## 兼容性边界

原生可编辑部分覆盖基础形状、文字、Frame／Group、纯色、基础效果、自动布局、
约束及本地图片资源。未知或近似转换会给出提示。复杂矢量、遮罩、渐变和混合文字
可使用插件导出的图像预览；在面板里能调整预览的位置和尺寸，不等于能编辑其路径
或全部富文本语义。组件、变量、远程库和原始 Figma 特有属性保留在来源中，未改动
的部分可在增量回写中保持；这不表示面板已具有全部 Figma 编辑能力。

插件更新原节点前展示差异，并在应用前再次核对来源属性；删除需单独确认。已有
节点的字体或其他前提不满足时停止相应更新。新页面副本是另一条明确选择的路径，
复杂预览在副本中仍为图片。实际 Figma 字体加载、组件／变量保留和复杂设计视觉
保真，需要真实插件运行和设计样本验证。

面板没有接入 Figma 账号的文件／评论同步，不保存 Figma 访问令牌。本轮没有更换
Rust 渲染引擎。后续引擎选择应依据大文档交互和绘制测量，调研入口保留为
[FigCraft](https://github.com/storytold/figcraft)、[Graphite](https://graphite.art/) 和
[OpenPencil](https://github.com/open-pencil/open-pencil)。

## 当前验证与仍在进行的工作

稳定 `main` 的 `da04251b995bde388eb6b8af0791b924d1aba353`（`da04251`）已将
Design Studio 版本更新为 `0.19.0`。完整功能提交 `0283970` 的 `npm run check` 全部 suites 合计
2432 项通过、4 项跳过、0 项失败，其中 Design Studio 187 项通过；源类型、确定性
构建、包验证与原生包检查通过。完整日志为 `/tmp/design-studio-019-full-check.log`。

离线门禁包含转换模型、严格来源／映射验证、Figma Plugin API 替身，以及真实
Chromium 中的完整面板交互：导入和重开、图层编辑、增量包、评论工具、先保存再
交给 Agent、原型运行、项目切换竞态、嵌套导入撤销／重做、历史淘汰和恢复来源。

```sh
npm test -- --suite design-studio
node --test tests/apps/design-studio/exchange-tools-ui.test.mjs
node scripts/design-studio-exchange-host.mjs /path/to/built/code-shell-server
```

真实 Node Host 检查使用独立 HOME、临时项目和禁止 JavaScript 网络的 worker。
覆盖真实文本预算、CAS 冲突、有效 PNG 分片、来源重开及恢复引用、并发评论、草稿
并发、原型配置、完整备份重命名恢复；删除原临时项目后再重开目标并验证图片摘要。
五组真实 Host 验收均已通过。

最终真实 Electron/Desktop 验收覆盖六面板的安装、sandbox webview、Main/preload
IPC、项目隔离、摘要更新与回滚，六组均通过。报告
`/tmp/design-studio-desktop-019-release-final.json` 记录相同的 `da04251` 提交与
Design Studio `0.19.0`；运行日志为 `/tmp/design-studio-019-desktop-release.log`。
自有 Electron 进程正常退出及临时 HOME 清理均已核实。这些证据来自隔离测试环境，
不等同于个人安装、Figma 桌面插件或真实账号验收，也不构成操作系统级网络隔离证明。

真实 Figma 基本往返已通过：官方来源导出 → 生产面板导入／来源绑定／模型修改 →
零冲突、零删除的补丁预览 → 应用 1 项更新 → 再次官方导出核对。仅在独立验收
文件中新建自有页面与 3 个节点，文字节点 `12:4` 的内容和 x 坐标按预期改变，
来源 ID 保持一致，未修改 marker `12:5` 的完整 JSON 不变。稳定报告为主仓库的
`artifacts/design-studio-figma-plugin/acceptance-runs/real-figma-1792122353371-e26a6ef5/report.json`。
生产插件主程序未修改；本轮由临时 UI 附加自动化通过正常插件消息完成，使用带
nonce 的 loopback 通道，不能当作正式 UI 按钮操作全链通过。此环境中 `fileKey`
不可用，`identity.verified` 为 `false`；插件明确要求用户确认原文件，并按图层 ID
和属性快照核对，未自动确认文件身份。

真实回执显示 native bridge 的 `event.source` 不是 `parent`。正式 UI 现在接受父窗口
或精确官方 Figma origin，并继续核对消息封装、当前请求类型与 generation。新增
真实 Chromium sibling iframe 回归验证官方回执和不可信消息拒绝；修复后的 Design
Studio 测试 188/188 通过，其中插件 UI 6/6。临时服务已退出，附加 UI 与网络权限已移除。
原生 AX 无法可靠触发 Figma iframe 按钮，因此不声称正式 UI 的原生点击全链已验收。

仍在进行：从稳定来源更新个人 CodeShell 安装并核对已安装的 `0.19.0`。
后续应扩展真实冲突拒绝、字体和复杂图层保留样本、设计视觉基准、复杂矢量／富
文本可编辑语义、组件与变量适配；账号授权及云端评论同步另行设计冲突策略。

### 历史初版验收记录（2026-10-16）

以下记录保留初版证据，不代表 0.19 最终测试总数或真实 Figma 端到端结果：初版
`npm test -- --suite design-studio` 113 项通过，`npm run validate`、`npm run typecheck`、
`npm run build:check -- --app design-studio` 与 `git diff --check` 通过；查看 Chromium
截图并核对 390–1500 px 宽度，原触控回归覆盖 320 px。后续新增的来源、原型、恢复
和真实 Host 证据以交付验收记录为准。Design Studio 仍是直接安装的原生 `app/` 包。
