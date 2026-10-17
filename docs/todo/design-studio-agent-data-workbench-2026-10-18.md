# Design Studio：以设计数据支持 AI 的面板重构方案

日期：2026-10-18。状态：技术方案，尚未实施。

依据：Panel Apps 本地 `main` 的 `db37b886`（Design Studio 0.22.0），以及 CodeShell Host 的 `dc2b3d4c7`。当前本地 Panel Apps `main` 比 `origin/main` 领先 72 个提交，本方案按用户正在使用的本地实现分析。方案分支从已刷新的 `origin/main` 建立后，快进到该本地基线；没有改动或发布这些既有功能。

## 1. 产品方向

**设计面板负责让人和 AI 共同查看、表达和修改设计；AI 根据设计数据、用户要求和实际项目编写实现。**

用户说“把这个页面实现到项目里”时，面板应提供页面、选区、节点树、布局、视觉参考、素材和讨论；AI 自己读取代码库，决定复用哪些组件、怎样组织代码、使用什么框架以及怎样验证。用户说“解释这个布局”时，同样的数据也应支持只读回答，不要求进入生成或编辑流程。

判断一个功能是否属于面板，可以看它回答的是什么问题：

| 问题 | 责任归属 |
| --- | --- |
| 当前设计有哪些页面、节点、素材、尺寸、布局和交互关系？ | 面板的数据协议 |
| 这个设计怎么显示、选择、拖动、编辑和保存？ | 面板编辑器与运行时 |
| 怎样避免 AI 覆盖人工刚改的内容？ | 面板事务与版本协议 |
| 应该生成 HTML、React、Vue，还是接入现有组件？ | 当前聊天里的 AI，依据项目与用户要求决定 |
| PRD 怎么拆、先做什么、设计是否满意、实现怎样验收？ | AI 与用户的任务约定；需要时使用可选 Skill |

面板仍然需要确定性的布局、渲染、数据校验和事务。应移除的是替用户和 AI 决定交付方式的固定产品流程。

## 2. 当前偏差在哪里

偏差贯穿 UI、Agent 工具、CLI 和提示词，不能只隐藏按钮。

| 当前实现 | 问题 | 调整 |
| --- | --- | --- |
| 顶栏 HTML、HTML 导入窗口；`import_html` | 默认把网页理解限定为 HTML → DesignNode → v3 | 从主面板与默认工具面移除。AI 按任务自行读取网页、代码或截图，再写设计数据 |
| “交付”窗口；`generate_frontend`；CLI `frontend` | 输出限定 `.html`，实现由固定 exporter 决定 | 移除默认前端生成路径，AI 直接写目标项目代码 |
| PRD 解析、`read_product_brief`、CLI `brief` | 固定识别需求章节、猜优先级，并规定交付顺序 | PRD 保持普通项目文件，由 AI 阅读、理解和追问 |
| `compare_frontend`、固定 HTML 对比流程 | 依赖反向捕获及同 ID 节点匹配，内置固定通过标准 | AI 使用真实项目预览和浏览器截图验证；面板提供设计参考与诊断事实 |
| “修复可处理项” | 自动扩容器、改文字颜色，可能改变用户表达 | 移除默认一键修复，保留问题位置和测量值，AI 用普通设计事务修改 |
| HTML 原型下载、Figma 插件下载及四步交换引导 | 面板逐渐成为多种转换器和交付向导的集合 | 保留已有交互与来源数据；格式交换作为独立、按需适配器，退出主面板默认流程 |
| `submitAgentRequest` 与 `repo-design` Skill | 即便用户只问布局，也被引向固定编辑、零问题校验与截图闭环 | 改成用户原话与设计引用；Skill 只说明数据、操作和冲突处理 |

源码依据：

- [index.html](../../apps/design-studio/app/index.html)：71 行 HTML 入口，1035 行起交付窗口，1378 行自动修复入口。
- [app.js](../../apps/design-studio/app/app.js)：4294 行 `generateFrontendFile`，4530 行 `compareFrontendFile`，4878 行 `importHtmlFromWorkspace`，5502 行 `submitAgentRequest`。
- [frontend-export.mjs](../../apps/design-studio/app/frontend-export.mjs)：351 行起固定 DOM 映射，447 行 `exportDesignFrontend`。
- [product-brief.mjs](../../apps/design-studio/app/product-brief.mjs)、[quality-repair.mjs](../../apps/design-studio/app/quality-repair.mjs) 和 [product-delivery-loop.md](../../apps/design-studio/agent/skills/repo-design/references/product-delivery-loop.md)：固定需求解释、修复和交付策略。

旧转换代码不需要在第一步全部删除；可以暂留未注册的兼容模块，之后拆为独立可选适配器或删除。不能仅把它们挪进同一个默认 CLI/Skill，继续要求 AI 调用。

## 3. 面板收敛后的形态

默认界面围绕设计本身组织：

- 顶栏：文件、保存、撤销/重做、缩放、交给 AI。
- 左侧：页面、图层、组件与素材。
- 中间：画布、选择和直接编辑。
- 右侧：属性；按需查看评论、设计诊断与来源信息。
- 文件菜单：新建、打开、另存为、完整备份/恢复；必要的图片/SVG 设计快照可留在这里。

取消 HTML、交付、前端生成、实现对比和固定原型导出入口；Figma 的来源与绑定仍随文档保存，复杂交换操作交给独立适配器。原型中的跳转、起始页、断点等作为设计意图数据保留，不再绑定某一种 HTML runtime。

“交给 AI”只需要选择范围并输入要求。默认范围是当前选区，没有选区时是当前页面；用户可改为整个设计。提交内容展示文件、页面与选区摘要，不提供“转 React/转 HTML”等预置转换模式。

首期就取消当前“提交前一律保存”的行为：结束正在输入的文字编辑、捕获当前设计目标与版本，再通过已有 `agent.submitPrompt` 交给当前聊天。默认引用 `live` 状态，只读提问不落盘；需要持久化时，沿用明确的保存或设计写入操作。提示词只描述引用、版本与用户原话。

未保存画布的引用必须标明 `live` 来源及 stateRevision。首期至少核对引用的文档与当前版本，拒绝过期目标；面板关闭或版本失效后，应提示重新取上下文。只有明确捕获为 `saved` 的引用才走对应磁盘快照，不能悄悄把未保存设计换成磁盘中的旧设计。

## 4. 复用现有能力，补齐数据出口

### 已有基础

保留 v3 `.codesign.json`、稳定节点 ID、分页索引、内容寻址资源、CanvasKit 画布、布局引擎、撤销和恢复机制；不为这次瘦身另造设计格式。

| 已有入口 | 继续承担的职责 |
| --- | --- |
| `get_design_metadata` | 文件、页面目录、tokens、资源描述、选区、dirty、磁盘 revision 与 live stateRevision |
| `get_design_context` | 按页面/节点读取事实，限制深度并说明截断 |
| `search_design_system` | 查找现有组件与颜色信息 |
| `get_design_screenshot` | 页面或局部的设计视觉参考 |
| `use_design` | 有版本前置条件的节点/页面/文档事务、布局求值、变更回执 |
| `validate_design` | 数据及设计诊断，支持按原因、严重度分页 |
| `save_design`、`rollback_design` | 保存、文件管理与有限范围的事务回滚 |
| 资源写入、评论读写 | 共享素材和讨论数据 |
| 包内 CLI + Runtime Skill | 关闭面板后读取、校验和 CAS 修改已保存设计 |

实现主要位于 [app.js](../../apps/design-studio/app/app.js) 的 7527、8248、8682、8818、9095、9134 行起，以及 [CLI](../../apps/design-studio/app/tools/design-studio.mjs)。

### 拟新增或扩展

下面是目标协议，均不应作为当前已完成能力对外宣传。

**A. 中性的设计引用。** 在原有提交 prompt 中携带一个小 JSON 数据段，不要求新增 Host 的结构化附件协议：

```json
{
  "format": "codeshell.design-reference",
  "version": 1,
  "source": "live",
  "designPath": "designs/home.codesign.json",
  "pageId": "home",
  "nodeIds": ["hero"],
  "revision": "<已有磁盘 SHA-256；新稿为 null>",
  "stateRevision": "<捕获的 live 版本>"
}
```

引用只定位数据，不携带访问权限。实际项目、会话、包版本及授权沿用 Host 上下文和 `projectScope`。数据段必须被标为设计数据，节点文字、notes、评论都不能变成可执行指令。工具调用时重新核对目标文件与版本，跨项目或跨文档切换后拒绝旧引用。

**B. 一致的按需读取。** 扩展现有 context 工具，按需带出相关 components、asset descriptors、comments、prototype 和 source mapping；可复用已有评论工具，不把所有附件塞进每次响应。添加可选版本前置条件，结果显示 `truncated`、剩余数量或稳定 cursor。

当前主文件 revision/live stateRevision 不覆盖独立评论、原型和来源 sidecar。目标上下文须记录本次读取涉及的主文档版本及各附件 revision/hash，附件缺失也有明确标识；通过读取前后复核建立一致性，变化则重读，不宣称已有跨文件原子快照。cursor 绑定这组组合版本；附件损坏或不可读不能当作没有数据。

布局上下文同时提供布局约束与已求值的绝对几何，标明坐标系。AI 可以据此重新组织响应式代码，不要求复制画布坐标。当前 tokens 是命名颜色值，节点没有完整语义 token 引用；先如实提供数据，语义 token 体系另行设计。

**C. 素材读取与落地。** 新增 `get_design_resource` / CLI `resource` 能力。live 工具返回 descriptor、引用它的设计版本和包内 CLI 调用信息；二进制落地由项目选定包的 CLI 完成：读取已保存设计和资源分片，按 resource ID 校验字节数、摘要与 MIME，以原子创建方式写到项目内的目标文件。已有相同摘要可复用，不同内容报冲突；遵循现有 workspace-write protocol，返回目标路径与写入回执。

当前 `workspace.writeText` 不能直接落地二进制，因此不承诺 live handler 凭现有权限写图片/字体。需要使用尚未保存的资源时，先通过明确的设计保存操作得到对应快照，再提取；不能拿旧磁盘资源冒充当前素材。图片和字体不进入普通 context 的 Base64 大字段。

Design Studio 素材目前保存在自己的 `codesign-data` 分片中，不等同于 Host 资源库。由包内模块封装重建和校验，AI 不需要了解私有分片布局；不能假设 Host `resources.materialize` 直接识别这些 ID。

**D. 视觉参考的来源。** 截图增加 renderer、设计版本、裁切区域、缩放和输出尺寸。现有 Agent 截图走 SVG → Image → 2D canvas，与当前 GPU 画布并非同一路；首期准确标注，后续复用编辑器 renderer。真实网页实现由普通浏览器能力截图，设计快照与网页截图的来源分别记录。

**E. 检查事实与任务判断分开。** schema 错误、悬空引用、资源损坏继续作为硬约束；裁切、溢出、文字测量、对比度等返回证据、受影响节点及严重度。是否接受某项设计诊断由任务意图决定，不以“所有 warning 清零”约束每一个任务。移除自动修复不应降低原有校验或删除问题记录。

**F. 写入仍由事务承载。** 沿用 `expected_state_revision`、`expected_revision`、原子回退、布局求值与 undo。超时或丢失回执不代表没有写入：先读版本和事务状态核对，再决定下一步，不自动重放旧 patch。后续为持久修改增加可查询的 request ID/receipt；不把当前只保留最近一次事务的 rollback 描述为完整操作日志。

## 5. AI 如何完成工作

以“把选中的首页实现进现有项目”为例：

1. 面板提交选区引用与用户原话，通过现有通道进入当前聊天。
2. AI 按需读取设计结构、视觉参考、素材及明确的交互说明，同时检查项目文件、组件、路由和构建约定。
3. AI 自己决定实现方式，使用普通文件工具编辑项目。可以写 React/Vue/HTML 或其他适合该项目的代码；输出路径不受面板 `.html` 规则限制。
4. AI 用项目本身的运行、测试与浏览器能力检查实现，结合设计参考说明必要偏差。节点与 DOM 的映射可以作为可选调试信息，不能成为实现验收的前提。
5. 只有用户要求修改设计时，AI 才调用设计事务；需要记录讨论时，按任务更新相关评论。

面板不启动另一套固定“生成前端”Agent，不注入 PRD 优先级，也不要求每次任务先把实现转回设计格式。Skill 说明“数据怎么读、图怎么取、事务怎么提交”，任务策略由当前聊天、项目规则与用户要求决定。

## 6. 代码分层与 Host 边界

优先从现有代码抽离职责，避免新建独立服务或再造一套运行时：

| 层 | 内容 | 调用方 |
| --- | --- | --- |
| 文档与数据模块 | v3 codec、页面索引、资源、评论、交互关系、来源绑定 | UI、工具、CLI |
| 设计运行时 | 布局、事务、诊断、共享渲染能力 | UI、live 工具、逐步适配的 CLI |
| 数据适配层 | 上下文裁剪、引用核对、素材提取、预算与结果封装 | live 工具、CLI |
| 编辑器 UI | 画布交互、属性、选区、用户输入 | 人 |
| Runtime Skill | 能力发现、数据约定、工具用法、版本冲突处理 | AI |
| 可选格式适配器 | 显式选择的旧 HTML/Figma 交换工具 | 有该格式需求的任务 |

`applyAgentDesignOperations` 当前依赖约一万行 `app.js` 中的状态。逐步提取可注入文档、存储和资源访问器的共享模块，再让 live 与 CLI 调用它；不要让 CLI 模拟 DOM，也不要让面板直接执行 AI 生成的代码。

CLI 当前 `read` 虽能裁剪返回值，仍先完整重建文档与资源，超过 16 MiB 会失败；需要改为真正按页和依赖读取。当前 `edit` 是完整文档 CAS，不具有 live 增量事务、自动布局修改、截图、评论和资源插入的同等能力。后续按实际需要补齐，并通过能力发现说明差异。

统一的是领域操作语义，不能混同两种状态：live 操作校验画布 stateRevision 及磁盘 revision；CLI 操作已保存快照，只校验磁盘 revision。外部文件更新时，dirty 画布保留草稿并显式处理冲突，不能自动用磁盘版本覆盖人工未保存内容。

**首期无需改 Host。** 现有 `Panel(list/tools/invoke)`、项目选定包的 Skill、JSON/图片返回、`agent.submitPrompt`、项目文件读写及 CAS 足够承载这次调整。领域逻辑继续归 Panel 包。

Host 实际限制需要沿用：schema v2 最多 16 个声明工具；Desktop 调用参数 64 KiB、结果 256 KiB，普通调用默认 15 秒。按最窄传输预算裁剪，给图片编码和 JSON 封装留余量，不提高 Host 限额来掩盖全量取数。

`Panel.invoke` 当前会打开并调用 live webview，并非 headless。无面板场景使用项目选定包的 CLI + Runtime Skill，并遵循已有 workspace-write protocol。通用 headless Panel executor 若有多个真实需求，再作为独立 Host 课题；本方案不依赖它。

Host 核对位置：`packages/core/src/tool-system/builtin/panel.ts`、`packages/core/src/panel-apps/manifest.ts`、`packages/core/src/skills/scanner.ts`、`packages/desktop/src/renderer/panels/AgentPanelHost.ts`、`packages/desktop/src/main/panel-app-bridge.ts`。

## 7. 实施顺序

| 阶段 | 改动 | 完成标准 |
| --- | --- | --- |
| P0：先纠正产品方向 | 删除默认转换/交付/自动修复入口；停止注册 `import_html`、`generate_frontend`、`compare_frontend`、`read_product_brief`；从 CLI 默认 ops 移除 `frontend/brief/compare`，同步移除 Skill 强制路径；修改 manifest 文案与提交 prompt；取消强制保存，核对 live 引用目标与版本 | 同一份设计能用于解释、设计修改、现有项目实现，不要求调用转换器；只读提交不落盘；保存、备份和已有数据保持可读 |
| P1：补齐 AI 所需数据 | 设计引用、跨读取版本核对、附件按需读取、素材提取、截图来源与预算；把保存快照 CLI 读取改为按页加载 | AI 不解析内部资源分片、不猜交互、不把截断结果当完整数据；真实项目实现可引用原始素材 |
| P2：合并运行时语义 | 提取共享事务；CLI 增量修改与布局求值；按需增加离线渲染及持久事务回执 | 已保存设计在关闭面板后也能按相同领域规则修改和验证；live/磁盘冲突不覆盖人工草稿 |

P0 是一个可以独立交付的边界调整，不等待 P2 完成。P1 的素材出口优先于新增转换功能。每阶段在 `codeshell-panel-apps` 独立任务分支实施，按受影响范围运行包校验、离线套件和真实 UI 用例；涉及 CLI 时增加脱离开发仓库的打包执行检查。

## 8. 兼容与验收

不迁移 v3、不丢弃现有 `.comments.json`、`.prototype.json`、`.figma-source.json`、资源、分页索引与恢复草稿；完整备份继续保存这些数据。旧 HTML 产物仍是普通项目文件，可以交给 AI 使用。

工具表和 Skill 必须同步调整。旧 Panel 工具从 manifest 发现结果移除，旧调用按现有未知工具机制失败，调用方重新发现工具；README/Skill 提供迁移映射。旧 CLI 子命令可暂留只返回迁移错误的入口，但不出现在默认 ops，也不执行转换。历史文档保留为历史记录，当前 README/manifest/Skill 不再继续宣传固定前端流水线。独立适配器只能由任务明确选择，不能被默认 Skill 自动串回。

实施验收使用以下场景，不能仅证明按钮消失：

1. 同一设计分别实现到已有 React 与 Vue 测试项目，全程不调用上述转换工具，不为框架增加面板按钮或 Host 代码。
2. 用户仅问“解释这个布局”，AI 只读回答，不产生设计或代码写入。
3. 用户要求修改选区，AI 读取局部上下文并提交普通事务，画布更新且可撤销；人工先行编辑后，旧版本提交被拒绝。
4. 图片、字体与复杂来源保留，缺失资源明确失败；已有多页、评论、交互关系和备份可以重开。
5. 大型设计可按页/节点和素材 ID 取数，截断有标识；切换文档、项目或版本后，旧引用和 cursor 失效。
6. 关闭面板后，CLI 可以读取已保存设计；P2 再验收增量修改和布局一致性，不提前宣称截图及全部 live 能力已实现。
7. 实现验证检查真实运行项目；不以同一个转换器生成再反解的结果证明还原度。

本方案的核心交付标准是：**面板增加一种新的设计数据能力时，AI 能自然利用它；AI 要换一种实现方式时，不需要面板再增加一个固定功能。**
