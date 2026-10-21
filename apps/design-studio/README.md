# Design Studio Panel App

Design Studio **0.22.0** 提供 HTML → DesignNode → v3 导入、Figma JSON 导入、可编辑设计、带来源校验的增量导回、
多页 HTML 原型和项目评审。原生设计仍使用 v3 `.codesign.json`；16 个声明式 Agent
工具与可视编辑器共用同一份设计、来源和评审数据。本版沿用现有 Host 权限。

文字可选 `textRanges` v1 在同一个 Text 中保存颜色、装饰和链接区间，按完整
`textSource ?? text` 的 UTF16 索引和精确内容签名绑定；不创建绝对定位的文字碎片。
最多64个不重叠区间、32KiB；保留真实空格、NBSP、显式换行，并单独映射显示软换行。
`use_design` 的 `edit_text` 用源索引和明确的插入亲和性更新内容及区间；整段
`update_node` 改文字须带匹配区间，或显式 `textRanges:null` 清除。保存、完整备份、
撤销和重新打开保留同一状态。旧稿未带区间时沿用原有行为。

这项核心合同尚未开启 HTML 混合行内文字提升。SVG 已验证纯色/链接区间的流式排版；
自定义下划线厚度、偏移和 skip-ink 会明确拒绝，避免 SVG 将它们当作 auto 输出。
范围文字暂不接收基础渐变/paint stack 或省略截断；各渲染器和原生出口仍须通过自身
能力检查，不能仅把区间写入元数据后声称绘制或往返成功。

## 0.22：CanvasKit GPU 画布

画布统一使用 CanvasKit 0.42.0（Skia C++ → WebAssembly → WebGL2）。全图概览、
局部缩放和设计编辑都保持 GPU 渲染，主场景及命中检测不创建 SVG 图层。

GPU 场景保留绘制命令，并用 Skia 空间索引裁掉视口外内容。低倍率使用有 64 MiB
预算的 GPU 分块缓存；编辑复用未改变的节点绘制记录、字体和图片。系统文字缓存按
可见范围及实际缩放升级清晰度。平移和缩放复用场景，内容改变使旧分块失效。
选框、手柄、参考线和画板名称由
独立 Canvas 交互层绘制，命中检测使用设计几何、旋转和祖先裁切。文字输入框使用
相同的坐标变换，编辑期间由 GPU 场景隐藏对应文字，避免重影。

运行时完全随包提供，有固定版本、SHA-256 和许可证；不请求额外 Host 权限。
仅在 Host 通过 `capabilities.packageAssets.wasm` 声明包内 Wasm 支持时加载；浏览器
本地模式按实际 WebAssembly/WebGL 能力运行。旧 Host、初始化失败或 GPU 丢失时
明确显示不可用和重试入口，保留设计数据，不会切换到 SVG。需要支持包内 Wasm 的 Host。
设计、保存、撤销、Figma 来源及缺资源提示沿用原有数据，不会由渲染器修改。

Grida 对比原型保留在 [比较工具](../../scripts/design-renderer-compare/README.md)；未装入
正式 Panel。重新核验 CanvasKit 运行时使用 `node scripts/prepare-design-studio-canvaskit.mjs --check`。

## 0.21.2：大型设计交互性能

平移与缩放只在动画帧中更新视口，保留现有图层画面和列表，不再触发整页重绘、设计
检查及原型状态序列化。选框、手柄、画板标签和缺资源提示仍按缩放比例更新，取消手势
恢复原视口。设计编辑继续完整重绘，并在同一帧合并连续拖动的显示更新。

场景绘制及图层列表每次建立共享索引，复用祖先旋转、锁定、裁切和透明度计算；拖动
吸附和框选也共享几何索引。索引不跨编辑缓存，保留全部图层、图层顺序和导出内容。
公开回归使用生成的 1,000/1,208 图层测试稿，检查节点复用、编辑后刷新、跨页组件、
键盘选层以及手势取消。未引入 Rust 或新的 Host 权限。

## 0.21.1：长稿、文字与绘制保真

Figma 长稿按实际可见内容扩展画布，上限 20,000 px；图层位置、尺寸及来源映射保留。
多层纯色、独立透明度和线性渐变现在同时用于面板、SVG、HTML 与 Figma 交换，渐变文字
不再变成透明文字。原稿明确标记为无渲染范围且完全被祖先裁切的离屏分支保留图层和
原始来源，以实际不可见状态导入；没有这项来源证据的裁切仍会报错。

浏览器用最终字体、SVG 字宽和 Canvas 墨迹测量文字，物化软换行并保留完整原文；测量结果与文字、
字体和排版签名一起保存。重开或 Node 校验继续检查这些实测尺寸，修改排版后签名失效，
不会把“已测量”当作跳过校验的理由。离线包提供 Roboto、Inter 和兼容 Font Awesome
5/6 的 Free/Brands 字体资源；其他缺失字体会明确提示回退。字体资源随完整备份保留，
Figma 内仍需相应已安装字体。

检查窗口的 **修复可处理项** 是一次可撤销编辑：扩展未裁切的容器以容纳内容，微调纯色
文字以达到当前背景所需的对比度。它保留文字、图层、裁切和渐变；剩余问题仍会列出，
不会通过降低检查标准清零。修复后需要保存。截图继续限制为 2M 像素、最长 4,096 px；
本地预览允许最多 4 MiB SVG，写入 Host 的 SVG 仍限制 384 KiB。含完整字库的大 SVG
直接下载为文件；也可下载完整备份，或使用包内 CLI 的 `svg` 操作及 `output` 路径生成本地文件。

导入预览优先展示缺图、混合文字等实际转换损失，完整提示数量继续保留；不会因大量
排版提示挤掉关键差异。增量导回省略可证实由父节点平移继承的位置更新，更新预检不
重复携带子树，删除仍保留完整子树冲突校验，以减少大型稿件的传输体积。

## 0.21：独立导入、预检与 HTML to Figma 插件

Figma 导入默认新建独立稿，显示保存路径、转换后的预览及真实 audit；也可明确选择
替换当前画布。已有未保存稿件须先保存或备份。导入中资源或主文件保存失败会恢复
原画布、文件归属和来源绑定；写入回执丢失时只读核对目标，不重复发布主文件。
无法核对时保留当前画布并提示保存状态待确认。已保存但存在阻塞的稿件仍是草稿。

“另存为”保留项目资源、已保存评论、原型和 Figma 来源。新目标不会覆盖已有文件。
检查窗口按原因和严重度筛选，每页 50 条，点击图层会聚焦；Agent 可用
`validate_design(code, severity, offset, limit)` 分页读取全部问题。

16 个 Agent 工具入口保持兼容。`save_design` 的默认行为仍是保存，新增
`action: create|open|save_as`。Figma 新流程先调用
`exchange_figma(action: prepare, source_path, target_path, expected_state_revision)`，
核对返回的 `preparationId`、目标、audit 和差异后，以同一来源及状态调用 import。
准备结果绑定来源内容摘要；来源、目标或画布变化后须重新预检。带阻塞的现代导入
需要明确 `allow_blocking: true` 才能保留草稿。旧的 path-only import 保留替换当前稿件语义。

大 JSON 使用随包的 [prepare-figma CLI](app/tools/prepare-figma.README.md) 自动生成
350 KiB 分片。输入包与目标的 `.figma-source.json` 来源索引必须使用不同名称。
离屏且被祖先裁切的节点不再污染页面原点，真实未裁切越界仍会报告。

新增独立 [CodeShell HTML to Figma](app/html-to-figma-plugin/README.md) 开发插件，
实际复用 html2figma 原生 adapter、FigmaService 与 creators。支持粘贴 HTML、本地 HTML
文件夹及原生 DesignNode/FigmaJSON，先静态预览再创建可编辑图层；无服务地址、API Key
或 CDN 依赖。原有 CodeShell Design Bridge 继续处理 v3、完整备份与来源增量更新。
Figma 插件 ID 由 Figma 分配，安装步骤见插件 README。当前验收包括真实 Chromium
隔离 UI 与 fake Figma API，不代表真实账号内字体与渲染已经验收。

## 0.20 交付：HTML 导入与完整文件直接还原 Figma

顶栏 **HTML** 使用固定版本的 html2figma 浏览器转换器：DOM → DesignNode → v3。
可读取工作区 HTML/CSS 与内嵌资源，或选择一个本地 HTML 文件夹连同图片、字体一起
导入。脚本和网络请求被隔离；找不到本地资源时停止，不能把缺图片的设计当作完整成功。
基础文字、布局、位置和图片成为可编辑图层，稳定 ID 不采用上游随机节点 ID。
导入兼容提示可重新打开 HTML 窗口查看，Agent 工具返回结构化转换报告。

编辑后保存 `.codesign.json`；迁移时使用 **备份 → 下载完整备份**，取得包含图片、字体、
评论、原型及来源数据的一个 JSON 文件。Figma 插件现在直接接受这个完整设计文件，
先校验页面、资源摘要及附件，再还原为新页面和可编辑基础图层。无资源的普通 v3 文件
也可直接读取；有外部资源引用的普通文件会要求完整备份。原有 transfer 和原节点补丁
流程继续可用。完整文件是 v3 设计的完整归档，不是原始 HTML/CSS 的无损归档。

径向渐变、混合富文本、复杂滤镜等超出 v3 的样式会明确给出转换提示；SVG 在面板中保留
自包含资源并可调整位置尺寸。Figma 不能通过插件安装字体文件，会使用已安装字体或
明确提示回退。评论和原型附件会校验，但不自动创建 Figma 云端评论或原型交互。
底层接口、重建方式和验收范围见[转换方案](../../docs/todo/design-studio-html2figma-v3.md)。

## 0.19 交付：完整 Figma 交换、交互原型与项目评审

顶栏 **Figma**（窄屏在“更多设计操作”）支持选择 Figma REST 文件／节点 JSON，
或插件 `JSON_REST_V1` 导出。先显示页数、可编辑图层与转换差异，再导入当前画布；
导入保留撤销记录，不自动覆盖设计文件。单次输入上限 16 MiB，较大的来源应分批
导出选区。支持基础形状、文字、分组、Frame、Auto Layout、约束和包内图片资源。
插件还会导出复杂图层的 PNG 预览与原始 JSON；预览可调整位置尺寸，矢量路径本身
不变成面板原生节点。原始节点属性通过设计旁的 `.figma-source.json` 来源索引保留，
对应内容经摘要校验存放于项目内，保存和重开后继续保留。
来源关系随导入撤销／重做、历史记录淘汰和未保存草稿恢复保留；撤销回普通设计后，
保存与重开不会把旧来源误用于新设计。

编辑后下载 `design.figma-transfer.json`，使用随包的
[Figma 开发插件](app/figma-plugin/README.md) 创建新页面，或预览后更新原节点。面板可分别下载
插件的三个文件；先在 Figma 创建开发插件取得 ID，填入面板后下载完整 manifest，
再将三个文件放入同一目录，在 Figma 开发插件菜单中导入 `manifest.json`。
插件也可将选区／当前页导出为 REST 结构 JSON。转换文件不是 `.fig`，不能直接在
Figma 文件菜单打开。原节点回写只修改画布中明确改变的属性，保留未改动的变量、
组件和复杂内容。插件在预览与应用时分别核对来源冲突；删除需明确勾选核对。
回写完成后从 Figma 导出新的来源包再开始下一轮。项目评论不自动发布到 Figma。
Agent 的 `exchange_figma` 可读写分片交换包，并返回 `storage: "json"` 或
`"multipart"`；后者的项目文件是清单，不能直接在 Figma 插件中选择。面板下载会
生成完整的传输 JSON；Agent 也可读取清单分片并核对字节数与 SHA-256 后组装。

顶栏 **原型** 可把选中图层链接到其他页面、返回或安全 URL，设置起始页和响应式
页面断点，预览并下载全部页面组成的离线 HTML。交互记录保存在 `.prototype.json`，
导出继续保留 `data-codeshell-id`。可选择附带评审评论；未选择时不导出评论内容。
交付页仍提供单页 HTML 生成、Agent 实现与视觉对比，Agent 可通过
`generate_frontend(prototype: true)` 生成完整交互原型。
需要评论时同时传 `include_comments: true`。原型下载可包含全部页面和内嵌图片；
写入项目的 HTML 仍受 Host 单次文本预算约束，较大的离线原型可从面板下载。

顶栏 **讨论** 支持图层／页面评论、回复、解决和重新打开，保存到设计旁的
`<名称>.comments.json`。原评论工具（C）可“保存为评论”，也保留“交给 Agent”。
评论内容作为文本显示，并使用文件版本检查防止覆盖另一窗口的修改；冲突时保留
输入，刷新后重试。评论可交给 Agent；结构化工具支持读取、回复和解决问题。
评论草稿在具备版本存储接口的 Host 上支持重新打开后恢复；另一窗口修改草稿时停止
自动覆盖。浏览器本地模式使用各窗口独立的草稿记录。缺少安全存储能力时明确提示
草稿仅留在当前面板。
v2 完整设计备份包含评论、回复、来源映射、原型与资源；恢复到新路径时统一重命名，
兼容 v1 备份。手动搬动文件时仍需同时移动相应附属数据。
浏览器本地模式的评论保存在该浏览器，连接 Host 后则保存在当前项目。

实现和后续优化见 [Figma 与评论流程](../../docs/todo/design-studio-figma-review-workflow.md)。
真实 Figma 已通过基础往返及 HTML 完整文件还原样本；复杂设计的保真范围、浏览器和
真实 Node Host 证据见[交付验收记录](../../docs/todo/design-studio-completion-audit.md)与
[0.20 转换方案](../../docs/todo/design-studio-html2figma-v3.md)。

以下功能一并纳入 0.19。各小节的验收计数是功能最初落地时的历史记录，
不代表当前测试套件的总数。

## 0.19 交付：画布文字、图层评论与布局控件

创建文字后直接输入；双击文字或选中后按 Enter 可再次编辑，也可使用属性面板的
“在画布编辑文字”。⌘/Ctrl + Enter 或移开焦点提交一次可撤销的修改，Escape 取消。
导入的换行／省略文字使用完整源文编辑；保存会先提交当前缓冲。切换项目时，未保存
的旧文字保留在可下载草稿中，不会写入新项目的同名图层。

评论工具（C）或“评论此图层”会附带页面、稳定图层 ID、父级路径、完整文字、尺寸
与布局上下文，先保存再提交。顶栏 Agent 入口默认关联当前选择，也可改为整个设计。
等待读取／保存期间切换项目、页面、文件或路径，会停止尚未发出的提交；迟到的提交
回执不会关闭后来打开的评论或 Agent 草稿。缺少 Agent 能力时仍可编辑设计，并明确
说明无法提交的原因。

自动布局提供方向按钮、九点对齐、主轴两端分布及当前布局说明。换行、网格、独立
间距／内边距和精细对齐在“高级布局”中，继续使用现有模型与共享下拉控件。锁定
容器禁用布局修改。图层与对齐动作使用带无障碍名称的 SVG 图标。

历史验收：该功能落地时新增 14 项真实 Chromium 交互回归，并与原有恢复／备份／
触控用例一起纳入 `npm test -- --suite design-studio`；可单独运行
`node --test tests/apps/design-studio/polish-ui.test.mjs`。历史分支十文件的逐项整合依据
见 [Design polish 整合记录](../../docs/todo/design-studio-polish-integration.md)。
这些隔离 Host 测试没有调用真实个人项目、账号或付费 Agent。

## 0.19 交付：真实连接状态与本地设计流程

浏览器本地模式明确说明设计与文件只存于此浏览器，保留画布编辑、保存、SVG 导出
与完整备份下载。Agent 提交要求实际 Host 能力与可提交的当前会话；缺少能力时显示
原因并禁用提交，不再模拟成功。支持能力发现的 Host 更新授权后可重新启用提交；
旧 Host 沿用原调用行为。

历史验收：`node --test tests/apps/design-studio/connection-ui.test.mjs` 在手机尺寸以真实
Chromium 触摸创建设计，完成保存、SVG 写入、完整备份下载与重开，另覆盖受限 Host
恢复 Agent 能力后的单次真实桥接调用。当时的恢复／备份／触控组合共 68 项。
浏览器本地保存与隔离 Host 测试不代表真实 Host 安装或 Agent 服务已经验收。

## 0.19 交付：窄屏编辑与触控取消

680px 及以下使用完整宽度的画布；工具栏可打开页面／图层与属性抽屉，二者互斥，
支持关闭按钮与 Escape。“更多设计操作”保留打开文件、HTML 导入、交付、SVG 导出、
设计检查、完整备份和快捷键说明，沿用原操作与 Host 权限。触控工具、图层按钮和
缩放手柄扩大点击区域；文字工具在窄屏直接进入画布文字编辑。

画布拖动只响应发起手势的指针，第二根手指不会移动或结束已有拖动。
系统取消触摸、指针捕获丢失、窗口失焦或 Escape 会恢复本次创建／移动／缩放／平移
之前的状态，不新增撤销记录。已正常结束的操作仍可撤销。当前使用单指工具操作，
缩放通过画布底部按钮完成，未实现双指缩放。
切换页面、设计文件或项目时先取消原设计中的未完成手势；迟到的指针事件不会将旧
坐标或尺寸应用到新设计中的同名图层，原项目保留的草稿也不包含半次拖动。

历史验收：`node --test tests/apps/design-studio/touch-ui.test.mjs` 使用真实 Chromium 触摸
输入覆盖 320／390／620／680px 窄屏操作、SVG 写入、双指归属、系统取消与桌面回归。
浏览器测试使用隔离的内存 Host；不将其视为真实 Host 安装或设备触摸验收。

## 0.19 交付：交付操作的设计归属

PRD／设计提交给 Agent、SVG／前端导出、实现对比和检查报告绑定发起时的项目、设计
实例与保存路径。等待读取或保存期间换文档、切项目或改路径，会取消尚未发出的后续
动作；不能把旧需求交给新设计、继续读取新项目依赖或写入旧报告。已经发出的原项目
写入／提交仍可能完成，请在原项目核对结果后决定是否重试。前端导出回执的状态版本
对应实际生成的源快照；写入期间继续编辑不会把新画布版本冒充为导出内容。

## 0.19 交付：迟到的页面和资源加载

分页校验、图片内容校验、字体加载及页面切换绑定原项目和原文档实例；等待期间切换
项目或新建设计后，旧结果不能更新当前画布、资源缓存或安装旧字体。已经发出的只读
操作可能完成，但其结果不会被应用到新文档。这不代表所有预览／导出控制器已验收。

## 0.19 交付：保存期间继续编辑

保存回执只确认点击保存时捕获的设计。保存期间新增页面、修改已加载页面或加载后
修改其他页面，仍保持未保存状态并生成基于已落盘版本的恢复草稿。分页索引更新会
保留后续编辑的页面记录及顺序；再次保存或重开恢复不会把后续修改当作已保存而清除。

## 0.19 交付：完整设计备份与恢复

顶栏“备份”可下载包含全部页面、图片、字体、已保存评论、来源映射和原型配置的
v2 完整设计备份（最多 128 MiB），并兼容读取较早的 v1 包。
尚未查看的索引页面也会加载；缺失或校验失败的资源会使下载失败，不生成缺少资源的包。
导入先显示来源、目标项目、页数和资源数，校验全部内容后由用户确认恢复路径。
恢复按只创建方式写入独立文件，保留当前画布、草稿和已有文件；可从打开文件入口选择
恢复出的副本。资源分片校验并保存后才提交主文件。中途失败可以重试，相同内容复用，
不同内容不覆盖；项目切换和关闭对话框会停止后续操作，已发出的写入仍可能完成。
来源信息仅用于核对，不授予原项目权限，也不把来源路径作为目标写入位置。

旧“草稿备份”可在同一入口选择具体草稿或主程序保存记录。日志内置基础设计时直接
核对重放；引用项目文件时，必须取得与记录的 SHA-256 版本一致的原文件，索引／分片
和图片／字体也逐项校验。基础版本变化、资源缺失、未知操作或记录不匹配时停止；
没有可校验基础版本的旧日志无法可靠重建，仍保留原数据。备份最多包含 256 条草稿，
单条日志最多 100000 个操作，恢复读取最多 128 MiB。校验只读，确认后才恢复为新文件。
“另存为”草稿使用恢复格式 v2 分别记录原基础文件和新保存目标，避免将新文件名
误当成基础设计。原文件版本变化时保留草稿并停止重放；较旧面板会保留不支持的 v2
记录而不解释它。尚未保存过的设计在反复恢复和编辑后仍保留内置基础设计。
完整备份包含设计文档、已保存的附属数据及项目图片／字体，不包含任意其他项目文件。
评论、来源或原型损坏、不可读、引用分片缺失时停止生成备份；确认不存在的评论会在
备份覆盖记录中明确标记。所有附件在写入前检查格式、摘要、大小和数量；已有不同
内容的目标文件会阻止恢复。导入验证不会执行备份中的代码或安装程序。

真实 Node Host 验收（仅临时目录）：

```sh
node scripts/design-studio-portable-host.mjs /path/to/built/code-shell-server
node scripts/design-studio-exchange-host.mjs /path/to/built/code-shell-server
```

## 0.19 交付：Agent 事务切换项目保护

Agent 编辑、HTML 导入、资源写入及回滚绑定发起时的项目。等待保存或文件分片期间
切换项目会停止旧事务；失败处理不能把旧画布、历史或资源恢复到新项目。排队但未开始
的旧事务也会取消。文件分片写入后的冲突查询仍限定原项目，不能向新项目探测同名文件。
已经发出的原项目写入可能完成；取消后应重新读取原项目，不能把取消当作未落盘的证明。

## 0.19 交付：项目恢复草稿的并发保护

支持版本校验的主程序上，自动恢复草稿按读取到的版本保存和删除。另一窗口修改后，
当前画布保留、自动覆盖停止，可下载带项目身份的草稿备份，再明确读取最新恢复记录。
保存响应丢失时先核对记录，不重复提交；读取失败或损坏记录不会被当作空记录覆盖或删除。
切换目录或会话都会停止旧操作，包括多个云端项目都使用 `/workspace` 的情况。
启动时先订阅上下文变化，较新的通知不会被迟到的初始读取覆盖。未确认的旧草稿
按每次项目切换分别保留，备份标明来源会话，不因目录同名互相覆盖，也不写入新项目。
新项目读取期间暂停编辑和自动草稿保存；此时下载备份只包含已确认来源的旧草稿，
不会把尚未切换完成的画布标成新项目。
这些页面内草稿不是持久备份，请在关闭前下载；备份保留操作记录及原项目／文件版本，
引用资源仍属于原项目，不是可独立迁移的完整设计包。旧主程序显示并发保护限制。
设计文件本身继续使用文件版本校验和保存／另存流程。Figma 导入的未保存草稿会
保留可校验的来源引用，恢复后仍能导回对应的原节点。

开发验收：`node scripts/design-studio-host-storage.mjs /absolute/path/to/built/server-package`
可将当前恢复模块连接到已构建的兼容 `@cjhyy/code-shell-server`，验证真实磁盘上的
并发、重启、项目隔离、撤销和条件删除；只创建并清理自己的临时项目，不启动服务。
该检查需要支持版本存储接口的 Host，不以旧公开包或内存模拟代替实际验收。

Design Studio 0.19 is an Agent-native CodeShell Desktop Panel App. One reviewed
installation contributes both its sandboxed visual editor and a narrow Agent
surface: sixteen declared design/delivery tools plus a repository-design Skill.

## What it does

- Source-bound Figma JSON exchange: import official REST/plugin structures and local image
  assets, edit the supported design model, and export reviewed incremental patches or new-page
  copies through the bundled development plugin. Raw source properties and node identities
  survive saves, reopen, undo/redo and recovery; complex visuals use explicit preview fallbacks.
- Multipage offline HTML prototypes with explicit navigation/back/URL actions, a start page,
  responsive page routes and optional anchored review comments. Prototype configuration persists
  beside the design; ordinary frontend generation remains a single static page.
- Persistent page/layer review threads with replies, resolve/reopen, guarded Agent handoff and
  safe draft recovery. Portable v2 backups validate and carry comments, Figma provenance,
  prototype configuration and resources together, renaming companions on restore.
- Vector canvas with selection, collapsible layer hierarchy, frames, alignment,
  distribution, snapping, rotation, zoom, pan, undo, and redo.
- A Figma-like three-column workspace: persistent pages and layers on the left, canvas in the
  center, and **设计 / 开发 / 文件** inspector tabs on the right.
- A PRD delivery flow that reads workspace Markdown/MDX/text into goals, users, stable requirement
  IDs, screens, acceptance criteria, and constraints before handing the structured brief to the
  current Agent.
- Deterministic Design v3 → HTML generation. Auto Layout becomes Flex/Grid/Wrap, dual-axis
  Hug/Fill/Fixed stays responsive, absolute layout children retain Constraints, and every layer
  keeps `data-codeshell-id` / `data-codeshell-source-id` traceability.
- Same-viewport design/implementation comparison with pixel similarity, changed-pixel ratio,
  stable-ID coverage, per-node geometry/style differences, a three-up preview, and a Markdown
  report written beside the frontend implementation.
- Figma-style horizontal, vertical, wrapped, reverse-flow, and Grid layout with independent
  row/column gaps, asymmetric padding, Baseline alignment, Min/Max bounds, column/row spans,
  dual-axis Hug/Fill/Fixed sizing, and absolute children excluded from flow. Absolute children
  support start, center, end, stretch, and scale Constraints; flow children support CSS-style
  leading auto margin.
- Reusable master components, cross-page/nested instance rendering, cycle-safe composition, and
  bounded acyclic expansion so repeated instances cannot exhaust the canvas or exporter.
- Repository-stable font family, 100–900 weights, italic, letter spacing, text decoration, and
  portable multiline SVG text that does not collapse in native preview renderers.
- Repository-stable drop shadows rendered consistently in canvas screenshots and SVG exports.
- Browser-rendered HTML capture that measures computed layout, typography, borders, clipping,
  shadows, and basic inline SVG rectangles/circles/ellipses; it maps supported CSS Flex/Grid/Wrap
  and absolute-child semantics to editable v3 Auto Layout, preserves form values, wrapping,
  ellipsis, and text baselines, and keeps measured coordinates as exact initial geometry and
  fallback data.
- A guarded **HTML** import dialog and `import_html` Agent tool for workspace-local files: scripts
  and network resources are removed, linked local CSS is inlined, the target viewport is isolated,
  a clipped viewport retains editable descendants, and the converted document remains undoable
  and revision-guarded. Import results report canonical document bytes for
  performance tracking without treating a Host request budget as a document limit.
- Document color tokens whose UI or Agent edits propagate simultaneously through matching canvas,
  fill, stroke, and shadow colors without corrupting color swaps.
- Deterministic v3 `.codesign.json` documents with a compact page switcher, multi-page editing, and
  deeply nested layers. A logical document has no whole-file byte cap: small designs stay in one
  JSON source, while larger designs keep the same primary path as a checked page index and store
  immutable, content-addressed page objects under `designs/codesign-data/`. Saving reuses unchanged
  pages and commits the primary index only after every changed page object is available. Legacy
  monolithic and `codeshell.design.bundle` documents migrate to the page index on their next save.
- An indexed-page runtime that opens only the active page plus transitive component-provider pages,
  keeps clean pages in a bounded LRU cache, pins dirty pages and their dependencies, and loads a
  requested page on demand. Metadata stays lightweight; full validation and export deliberately
  materialize every page.
- A content-addressed image/font library under `designs/codesign-data/images/` and `fonts/`.
  Documents keep stable `imageRef`/`fontRef` descriptors rather than embedded binary payloads;
  identical bytes reuse the same verified objects. The Agent resource tool accepts small inline
  Base64 or ordered workspace `.txt` chunks, so larger assets do not require larger tool arguments.
- Operation-log undo, redo, and crash recovery. Recovery stores the delta from the last saved
  baseline and spills large logs into checked content-addressed chunks, avoiding repeated
  whole-document snapshots in app storage.
- Automatic binding to the current repository: recovery first, then the repository's last-opened
  design, then `designs/design.codesign.json`, then the newest remaining design, otherwise a blank
  repo document at the default path.
- A repository file tab that lists every `designs/**/*.codesign.json` document, shows the active
  file and file count, and supports one-click switching or explicit refresh without leaving the
  editor.
- Live reload when an Agent or editor changes the active source file and the
  canvas has no conflicting local edits; stale file-open or sync reads cannot overwrite a newer
  in-memory transaction, and an external check started before a local save cannot mistake that
  save for somebody else's edit.
- Reviewable SVG previews and whole-document accessibility/layout audits that identify the page for
  every issue, detect meaningful rounded-corner clipping, and recompute text contrast in each
  component-instance context after scaling and opacity composition.
- Agent-visible page or full-visible-subtree node screenshots from any page, including
  component-master descendant geometry and shadows in instance crops, for an edit → validate →
  inspect → refine loop. Read tools wait for queued saves without mutating the live document, and a
  screenshot fails closed if its source changes during image rendering.
- Optimistic-concurrency checks before overwriting repository files.
- A required live `stateRevision` guard on Agent edits and explicit saves, covering unsaved human
  edits, undo/redo, page switches, `save: false` Agent transactions, and workspace changes.
- Explicit Host permissions for workspace access, app storage, current-session
  context, and optional prompt submission.
- Structured Agent reads, transactional edits, blocking validation, screenshots,
  design-system search across tokens and component masters,
  serialized mutation/read consistency, pending field/drag settlement at the Agent boundary, safe
  latest-transaction rollback, workspace-transition and complete queued UI-save settlement before
  Agent access, temporary interaction locking during Agent writes, user-aware selection
  restoration/preservation, net-zero transactions that cannot replace the latest real rollback
  token, and state-aware serialized saves that cannot silently reuse an older in-flight snapshot or
  be skipped after an earlier save fails.
- Agent page transactions for create, rename, activate, and delete, kept separate from node edits so
  layout work cannot leak across pages. A component-library page cannot be deleted while another
  page still contains instances linked to its masters.
- Visual-region screenshots crop to rendered geometry: rotated node outlines and rounded/rotated
  clipping ancestors are intersected before cropping, clipped descendants and organizational group
  bounds cannot add blank margins, while non-clipped component-master overflow and effects remain
  visible on instance crops.

Nested node geometry uses absolute canvas coordinates. Manual-layout containers preserve
Agent-authored `x/y`; auto-layout containers own direct flow children while
`layoutPositioning: "absolute"` children retain their coordinates. Reflow runs only after relevant
structural, visibility, sizing, or layout-property changes. Direct canvas dragging, nudging,
alignment, and distribution cannot bypass flow ownership. Agent-created
nodes require a stable lowercase, hyphen-separated semantic id so transactions are
reproducible and later operations can address every new node explicitly.

## Install

Open **Extensions → Panel Apps → From folder**, then select this directory.
CodeShell validates `.codeshell-panel/panel.json`, shows a permission review,
and installs it into the independent Panel App registry.

Continue editing this directory in the repository. To load those changes, use
**Extensions → Panel Apps → Update from source** on the Design Studio card,
review the new package digest and permissions, then confirm the update.

Design files belong to the repository that is currently open in CodeShell and
live below `designs/`. They are not shared globally between projects. The panel
header shows the connected repository, and the inspector's **文件** tab keeps
that repository's `.codesign.json` files visible with the current document
highlighted. The top-bar file picker remains available for keyboard-driven
switching.

### Headless project CLI

The package-local Node 20.10+ companion at `app/tools/design-studio.mjs` works
without an open webview. The declared `project-runtime` Skill resolves this
project's selected installed package; it does not depend on this development
checkout. `ops` lists the current JSON request schemas:

```sh
node "<selected-package>/app/tools/design-studio.mjs" ops
node "<selected-package>/app/tools/design-studio.mjs" run inspect \
  --project "/absolute/project" --input-file "/absolute/request.json"
```

An inspect request is `{ "path": "designs/design.codesign.json" }`. Operations
include `inspect`, bounded `read`, all-page `validate`, `svg`, static HTML
`frontend`, PRD `brief`, saved-design `compare`, `create`, and `edit`. Create
accepts a complete v3 `document`; edit also requires the exact saved-file
`expected_revision` returned by a read. Both use the shared document codec and
resource verification. They persist actual project source and the same page
index format the Panel can reopen. Existing files cannot be overwritten by
create or export. Edit uses SHA-256 CAS under the Host workspace-write lock
protocol; the primary source commits atomically after its immutable page parts.
The CLI does not touch private Host storage.

Every command prints one JSON envelope with `ok` and `result` or `error`.
Exit codes are 0 success, 2 invalid arguments/design, 3 revision conflict, and
1 other errors. Audit success means the audit ran: require `valid: true` and
zero issue counts when checking design completion. Requests/reconstructed
designs are limited to 16 MiB, project reads to 64 MiB, PRDs to 512 KiB, and
stdout to 1 MiB. Narrow large reads to a page/node, or export to a new artifact.
Symlinks, traversal and hidden project paths are rejected. CLI operations and
Host file commits use owned directory locks with a five-second wait; a crash
may leave a lock requiring verification that no writer is active before removal.

Complete-document edits preserve companion files but do not reconcile comments,
prototype targets or Figma mappings after ID changes. They accept materialized
geometry and do not execute the live editor's Auto Layout operations or undo.
Open the Panel for those workflows, live screenshots, HTML capture/import,
Figma exchange and resource insertion. The CLI reads saved files; unsaved live
canvas state remains in the Panel. See the [Runtime Skill](agent/skills/project-runtime/SKILL.md)
for the operation contract and the required actual Bash workspace protocol probe
before Skill-driven writes on CodeShell 0.9.36 or later.

The optional repository checker is bundled at `app/tools/check-design.mjs`. Run it from the
repository root to make canonical JSON and a zero-warning audit a CI-style gate:

```sh
node examples/panel-apps/design-studio/app/tools/check-design.mjs \
  --strict-audit designs/design.codesign.json
```

Add `--check-svg` when the repository also keeps a sibling generated SVG preview and it must match
the current active page exactly.

The checker resolves indexed and legacy large-document manifests automatically and verifies every
page and referenced resource object's byte length plus complete SHA-256 before normalizing or
auditing the reconstructed v3 document. Do not edit `designs/codesign-data/` objects directly;
save through Design Studio so the primary index changes only after every changed immutable object
is available.

## HTML fidelity fixture

The production fidelity harness (`npm run test:fidelity:production`) requests report-only
capture-local flow obligations. It binds actual source Element identities to canonical nodes
while the capture iframe is alive, then audits each imported/relayout/narrow candidate against
that immutable evidence. Ordinary in-flow relationships must retain an Auto Layout ancestry
path, including only wrapper IDs proven by that capture; NONE hops fail even when SVG pixels
are unchanged. Actual absolute/fixed source children are excluded from their outer flow
relationship, and image/SVG/empty leaves need no child layout. Ambiguous identities and
unsupported inline/table/transform/other source flows remain separately reported as PARTIAL,
so an empty issue list cannot certify complete flow coverage. The evidence is archived as
`flow-obligations.json` and per-mode `flowAudits`, never saved as document admission metadata.
No pixel thresholds are changed. Callers may request this diagnostic with
`captureWorkspaceHtmlResult({ ...options, includeFlowAudit: true })`; ordinary import behavior
is unchanged when the option is absent.

Use the top-bar **HTML** action to convert a workspace-relative `.html` file, or call the
revision-guarded `import_html` Agent tool. Version 0.20 uses `app/html-import.mjs`, the pinned
html2figma runtime and `design-node-adapter.mjs`. The independent measured reference helper
`app/html-capture.mjs` remains available for comparison and the historical fidelity fixture;
its metrics below do not establish fidelity for every html2figma conversion. The fixture at
`tests/fixtures/design-studio-html-capture/` renders a representative product UI in `mode=source`
and the captured Design SVG in `mode=converted`. Capture both at the same 960×640 viewport and
compare their pixels; the source, converted, and amplified difference images make baseline,
shadow, clipping, and corner errors visible before they reach a real design.

Run the same-browser regression from this collection repository:

```sh
npm run test:fidelity -- --output artifacts/design-studio-html-fidelity
```

The command writes source, measured conversion, reflowed conversion, side-by-side, amplified
pixel-difference, captured/reflowed `.codesign.json`, and JSON report artifacts. The measured
conversion fails unless windowed SSIM is at least `0.99`, pixels changing by more than 8 channel
levels stay at or below `1%`, and pixels changing by more than 24 levels stay at or below `0.6%`.
The fixture must retain at least 20 Auto Layout containers. After resolving those layouts once,
windowed SSIM must remain at least `0.86`, with the changed-pixel ratios at or below `8%` and
`6%`. Both documents must have zero blocking audit issues. The measured-import gate remains strict;
the broader reflow gate allows small browser-to-SVG text and semantic-layout differences while
still rejecting visible structural drift.
Browser-measured text bounds and explicitly clipped imported effects remain tagged in the editable
document so the audit does not replace exact geometry with fallback estimates; real contrast,
layout, and clipping issues still fail validation normally.

The broader offline parity suite adapts 20 representative cases from html2figma's 64-template
catalog and checks each at its import width and after a 760→520 px reflow:

```sh
npm run test:fidelity:cases -- --output artifacts/design-studio-html2figma-cases
```

It covers Hug/Fill/Fixed, Min/Max, reverse flow, Wrap, Grid spans, absolute Constraints,
navigation, cards, forms, tables, inline text, ellipsis, lists, SVG primitives, borders/shadows,
nesting, dashboards, and Baseline alignment. Every case writes
source/converted/diff/side-by-side images, editable design sources, metrics, and audit codes. The
varied suite gates initial SSIM at `0.94`, reflow SSIM at `0.87`,
changed pixels over 24 channel levels at `8%`/`12%`, and blocking issues at zero. See
`tests/fixtures/design-studio-html2figma-cases/README.md` in the collection repository for the
source-to-case coverage matrix.

The reverse delivery gate starts from the captured Design v3 file, generates editable HTML, renders
that HTML, captures it back to Design v3, and measures both pixels and stable layer identities:

```sh
npm run test:fidelity:delivery -- --output artifacts/design-studio-delivery-fidelity
```

The realistic 960×640 fixture requires at least 88% pixel similarity, at most 18% of pixels
changing by more than 24 channel levels, at least 90% stable-ID coverage, and no matched node
drifting more than 24px. Artifacts include the design and frontend screenshots, amplified diff,
side-by-side image, generated HTML, round-trip design, and JSON report.

For manual validation against changing public pages, use the opt-in real-page probe:

```sh
npm run test:fidelity:real -- --output artifacts/design-studio-real-html-fidelity
```

The curated presets exercise a modern Bootstrap page, the dense Hacker News table layout, and a
W3C fixed-position example. Pass `--url`, `--selector`, `--width`, and `--height` to inspect another
page. This network-dependent probe is diagnostic rather than a CI gate.

This path deliberately captures the browser's computed result after fonts and layout settle.
The product importer captures the visible first viewport rather than the root's entire scrolling
height. Partially visible layers retain their measured geometry behind an intentional root clip;
fully offscreen descendants are not serialized. Choose a tighter root selector when the desired
design is one visible region instead of the complete viewport.
Document-root auto/scroll overflow can retain ordinary viewport Auto Layout when
standards-mode measurements prove zero scroll offset, no horizontal overflow and
no consumed scrollbar gutter. Independent ancestor clips, classic gutters and
stable gutters retain measured geometry with diagnostics.
Flex rows/columns map reverse direction, Wrap/Wrap Reverse, axis gaps, four-side padding, Baseline,
Min/Max, alignment, distribution, and Fill/Fixed sizing into v3. Grid maps equal computed columns
and row/column spans; direct absolute/fixed children are excluded from flow and retain measured
Constraints. Opaque uniform borders remain editable decorations without forcing a manual-layout
fallback. Unequal Flex grow, unsupported floats, unequal Grid tracks, and decoration-heavy controls keep
measured manual geometry.
It is not an HTML parser and does not promise fidelity for unsupported visual primitives such as
raster images, SVG paths, gradients, pseudo-elements, multiple shadows, or four independently
editable corner radii.

Isolated same-direction percentage float columns can recover a bounded single
native Grid row (at most 24 tracks), with Fill widths and ordinary inner Auto
Layout. Mixed text/shape wrapping and unsupported constraints retain measured
geometry with diagnostics. Every recovered row reports that media queries and
float wrapping are not retained; recapture after a source CSS breakpoint changes.
See `docs/todo/design-studio-floated-columns-2026-10-21.md` for strict source
fixtures and the separate native negative-bleed/viewport limitations.

Plain single-text block/inline-block frames can retain vertical Auto Layout with
exact capture-local source binding even when class selectors repeat. Original
NBSP and ASCII whitespace provenance stay distinct. Ambiguous sources, table or
complex inline content and generated controls retain measured geometry with
diagnostics; see `docs/todo/design-studio-plain-text-flow-2026-10-21.md`.

Ordinary empty blocks retain vertical Auto Layout and physical padding when live
DOM capture proves there is no text, generated content, control or list marker.
They keep their original nodes and can participate in Fill sizing without spacer
layers. Replaced elements, aspect ratios, relative padding/size limits and size
containment retain measured geometry with explicit conversion boundaries.

## Package boundary

Renderable code lives under `app/`. The declarative Agent contribution lives
under `agent/`: the manifest declares every callable tool, handlers execute
inside the panel sandbox, and the bundled Skill is read-only Markdown. The
installer still rejects traditional plugin backends, hooks, commands, and MCP
configuration, so one install does not collapse the runtime isolation.


Solid CSS borders can retain four bounded editable side paints and inside alignment
without adding decorative child layers. Effective border insets count once in Auto
Layout padding and HTML export. Legacy centered strokes keep their existing semantics.
Native Figma supports independent weights with one shared RGB/alpha paint; multicolor
native transfer, unequal rounded side joins and adjacent sides with different alpha
are explicitly rejected or diagnosed. Collapsed table borders retain a diagnosed
measured approximation. Strict border evidence and remaining antialiasing limits are
recorded in `docs/todo/design-studio-css-border-sides-2026-10-21.md`.
