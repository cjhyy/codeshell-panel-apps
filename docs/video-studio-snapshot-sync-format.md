# Mimi 开放快照同步协议 v1

本文描述视频面板自己的开放同步格式。它使用既有 [`.mimiproject` 完整工程包](video-studio-portable-project-format.md)，不读取剪映私有草稿。工程文档、精确时间、关键帧、字幕、原始素材和全部原始元数据保存在同一个标准 ZIP 内。原始元数据可能包含另一设备的 `sourcePath`；这些字段只是数据，不是本机路径授权，也不用于自动重连。

## 服务边界

第一种实际 provider 是用户选择的同步目录，可以位于 iCloud Drive、其他网盘的本地目录或共享磁盘。面板读写这个已授权目录；文件到另一台设备的传输、登录、加密、下载占位文件和网络重试由对应客户端或文件系统提供。连接本地普通目录本身不意味着跨设备传输，也不意味着面板已连接用户云账户。

目录 provider 是可替换的：其他实现只要保留完整 ZIP 的 SHA-256、不可变快照记录和父关系，即可交换相同数据。没有厂商私有数据库、服务器时间胜出规则或 last-writer-wins 文件。

## 目录布局

```text
<用户选择的同步目录>/
  mimi-sync/v1/
    bundles/<bundle-sha256>.mimiproject
    projects/<sha256-utf8-projectId>/snapshots/<snapshot-sha256>.json
    incoming/<随机 UUID>.mimiproject
    scratch/verify-<随机 UUID>/...
```

只有 `bundles` 和 `projects/.../snapshots` 是需要长期传播的不可变内容。`incoming` 是本次上传的暂存副本；`scratch` 是完整 ZIP 校验的暂存解包。同步软件可以排除两个暂存目录，但不能排除正式 ZIP 或父快照。

没有可覆盖的 `heads.json`。一个工程的全部有效记录中，没有被其他记录列为 parent 的记录就是当前分支头。两个设备同时基于同一个父快照发布，会产生两个头，两份完整版本都保留。审核合并或选择一方后，新快照列出双方的 ID 为 parents；旧快照及 ZIP 不删除。

## 快照记录

```json
{
  "format": "mimi-video-snapshot",
  "formatVersion": 1,
  "id": "<64 个小写十六进制字符>",
  "projectId": "<schema 2 document.id>",
  "bundle": { "sha256": "<完整 ZIP 的 SHA-256>", "bytes": 123456 },
  "parents": ["<父快照 ID，升序、去重>"],
  "deviceId": "<随机 UUID；不是设备硬件标识>",
  "createdAt": "2026-09-16T00:00:00.000Z",
  "note": "工程名及本次操作说明"
}
```

`id` 是移除 `id` 字段后，其余字段规范化 JSON 的 UTF-8 字节的 SHA-256。规范化使用紧凑 JSON、递归按键名排序、数组保持顺序；JSON 字符串及数字按 ECMAScript `JSON.stringify` 编码。格式中的字段名都是 ASCII，数字都是安全整数。父 ID 必须已升序且不重复。时间只用于展示，不能决定覆盖顺序。备注按不可信文本展示。

未知版本、未知字段、无效摘要、重复 parent、自引用、父关系循环、路径字段、访问器、非普通对象和稀疏数组都拒绝。读取记录时同时验证文件名、内容摘要及所属工程。单条记录最多 8 KiB，parents 最多 16，单工程当前实现最多 10000 条记录；超限报错，不返回截断历史。每次历史分页最多 64 条，查询带固定 inventory 摘要；过程中出现新文件会要求刷新，不能悄悄跳过新增记录。

## 完整性、传播与恢复

1. 发布首先取得完整 `.mimiproject` Host 资源；其 SHA 和真实字节数与冻结工程相符。
2. Host 把资源流式物化到随机 `incoming` 文件。面板浏览器不接收原始本机路径。
3. 受审工具重新校验 ZIP 摘要、完整格式清单、全部原始素材的大小、CRC 和 SHA，检查工程 ID。
4. 工程包以原子、禁止覆盖的硬链接发布。快照记录通过独占临时文件、fsync、禁止覆盖链接发布；同摘要同内容重复提交幂等。已有同名不同内容绝不覆盖。
5. 发布子快照前，所有父记录和祖先必须已经到达并通过校验。新记录只在完整 ZIP 发布之后写入。
6. 外部同步软件仍可能以相反顺序传播文件。历史会分别报告缺父、损坏记录、缺 ZIP、ZIP 大小不符和普通文件存在但尚未完整校验。后者称 `present-unverified`，不代表可播放或可导入。
7. 拉取时再次完整验证 ZIP 和素材，再由 Host `resources.capture` 按预期 SHA/bytes 发布本机工程包资源；既有工程包导入任务负责分批发布素材、映射接收设备资源 ID。所有素材就绪后才产生完整候选。
8. 缺失文件可以从仍保有原 ZIP 的设备重发，也可以让同步客户端补齐，之后使用同一快照重新拉取。坏摘要不能通过重命名绕过验证；已经存在的损坏正式对象须从可信副本恢复，面板不自动覆盖它。

ZIP 的现有默认资源上限是 20 GiB，清单内存上限 32 MiB，素材流以有界块读取。原生验证需要额外解包空间，之后删除本次 scratch。当前目录实现要求文件系统支持同卷原子硬链接；不支持时明确失败，不降级成可能覆盖别人的写法。面板不会自动回收正式版本，因此历史不会悄悄丢失。

## Host 授权与任务边界

现有 Host 的 durable `tasks.start` 只支持 sealed job/app-data 目录，不支持用户选择的目录 handle。目录操作因此使用现有受审 `editor-sync` 原生入口：

- `filesystem.pickDirectory` 返回当前面板拥有的临时 handle；UI 只保留 handle 和名称，不保存绝对路径。
- `process.find`、`process.resolveEntry({name:"editor-sync"})` 确认 Node 及已安装入口；`process.spawn` 以目录 handle 为 CWD，`args:[]`，`stdin:"pipe"`。
- 命令 JSON 只包含 action、projectId、摘要、随机 token、分页标识或快照记录，不接受目录、绝对路径、任意相对路径或网络 URL。受审入口只从 sealed CWD 派生上述固定路径。
- `resources.materialize`、`resources.capture` 使用同一目录 handle 和由 SHA/token 派生的相对文件名。Host 校验目录身份和资源字节。
- 请求最多 32 KiB，stdin 分块低于 16 KiB；单次结果最多 224 KiB。浏览器按 process cursor 读取，丢事件、截断、过期进程都报错。普通 API 调用经通用 SDK 限流。
- 对所有受控目录持有身份检查，拒绝符号链接和非普通文件；读写期间再次验证，Linux 通过目录 fd 锚定路径。原生工具不执行 ZIP/manifest 中的任何路径或命令。

这是可取消的受审进程，不冒称 durable 后台队列。重开面板须重新选择目录；无任何 API 绕过授权。发布的不可变快照和持久恢复记录提供重试能力。

## 浏览器 API

```ts
const sync = createEditorSyncBridge(panel);
const directory = await sync.pickDirectory(signal);
const history = await sync.history(directory, projectId, { signal });
const snapshot = await createSnapshot({ projectId, bundle, parents, deviceId, createdAt, note });
await sync.publish(directory, { snapshot, bundle: hostArtifact, receipt }, {
  signal,
  onReceipt: async receipt => { /* 必须先持久保存，再开始物化/发布 */ }
});
const pulled = await sync.readSnapshot(directory, projectId, snapshotId, { signal });
// pulled.bundle.id 是当前 Host 的 resourceId；接 importProjectBundle。
await sync.discardPublication(directory, receipt, { signal });
sync.dispose();
```

`history` 包含完整 `graph`、每条记录的 `bundleState`、损坏记录 `issues` 和分页 inventory。`analyzeSnapshotGraph`、`snapshotRelationship`、`describeWorkingCopy` 都不读文件、不修改工程。

publication receipt 含 snapshot、Host 工程包资源、当前 incoming token 和最多 16 个 superseded tokens，不包含目录路径/handle。`onReceipt` 可异步；它成功后才操作目录。恢复先检查正式对象和暂存对象：已发布直接幂等；缺暂存文件重新物化完全相同的 sealed resource；已有不匹配暂存文件改用新 token，旧文件保留在回执中供明确清理，不覆盖。discard 仅清理回执列出的 incoming 文件，不删除正式版本或 Host 素材。

## 本机状态与审核界面

`EditorSyncUI({panel,tasks,session,replace,assertEditable,onError}).open()` 提供连接、历史、发布、预览、合并取舍和恢复入口。注入的 `replace(document, expectedIdentity)` 拥有保存、归档和 durable 原子替换；同步模块不会维护第二份活动工程文档。

每工程通过 Host `media.document` CAS 保存 `video-studio-sync-<sha256(documentId)>` 状态：设备随机 ID、父快照 IDs、上次内容 hash、待发布 receipt、有限的导入 receipts 和采用结果的 prepared/committed 阶段。状态最多 512 KiB、准备记录最多 16 条；不保存目录 handle、绝对目录或整个工程文档。源 ZIP 和导入任务的 transferId 用于重启恢复，避免重复读取大包。

内容 hash 保留所有可编辑数据；忽略 revision 计数，并在已知字节摘要相同时消除接收设备 resourceId 差异。发布冻结最初文档，后来发生的本机修改仍会显示未发布。采用其他版本之前，UI 要求先把本机修改发布成完整快照。候选载入和采用都核对工程、会话 generation、revision 和工作区。

采用之前先保存 prepared 记录；durable 替换完成后标记 committed，再清临时解包。清理失败时只重试收尾，不再次 replace。重启后若当前内容 hash 已等于候选则识别为已采用；若存储版本/内容已发生其他变化则拒绝自动重放替换。原始快照和被归档的工程不删除。

## 合并语义与明确限制

第一版三方合并单位为工程属性、每个素材、每个完整序列、每个导出预设、production 元数据和各集合顺序。不同实体的单方改动可构成候选；同一完整序列双方同时改变时，即便改的是不同片段，也保留为冲突，用户必须选本机、另一版本或共同起点。界面可查看三份完整记录，任何未选择的冲突都会阻止完成，最后还必须通过完整 schema 2 图验证。

选择一方不是删除另一方；新快照可以用双方为 parents，历史继续保留。不存在共同祖先或存在多个最近共同祖先时，当前 UI 不虚构三方起点，仍允许明确预览/选择完整版本。当前实现不是协同实时编辑，不自动合并同一序列中的剪辑，不注册后台云账户，也不会自动覆盖本机未发布修改。

## 实际验证

`video-studio-editor-sync.test.ts` 验证规范摘要、DAG、9000 层历史、乱序传播和合并冲突。`video-studio-editor-sync-runtime.test.mjs` 使用真实 Node 原生入口、真实标准 ZIP 和两个独立客户端，验证共享目录并发分支、二父合并、跨目录传播、缺包补回、SHA 校验、符号链接拒绝、分页变化以及浏览器 SDK 桥接的回执/取消/重试。`video-studio-editor-sync-ui.test.mjs` 使用真实 Chromium 和 EditorSession，验证审核、CAS 错误、中断、存储失败、重复替换保护及窄屏展示。测试不依赖外网或用户云账户。

## 结构化编辑工具与分页审阅

界面同时提供 `getState({offset?,limit?})` 和 `execute(request, expectedSessionIdentity)`，两者直接使用同一份候选和流程，不通过模拟 DOM 点击实现。`getState` 每页最多 50 项，文字字段最多 200 个 UTF-8 字节并附截断标识，parents 摘要最多 4 个并附总数。响应超过 44 KiB 时自动减少实际 `page.limit`，通过 `page.nextOffset` 继续读取；完整 snapshot ID 始终保留。目录授权 handle/路径不在结构化状态中。

`execute` 支持 connect、refresh、publish、preview、merge、choose、apply、recover。所有这些动作要求 UUID `requestId`，立即返回 operationId，随后查询状态；重复相同 requestId 返回原回执，复用 ID 做不同动作拒绝。当前面板最多保留 1024 条结构化回执，超过时明确报错。单次只运行一个动作；异步载入状态之后和操作开始前都会复核精确 SessionIdentity。publish 冻结完成之后仍允许本机继续编辑。

cancel 必须提供匹配的 operationId，不能取消别人的新操作；已经进入 durable 替换时明确拒绝取消。choose 和 apply 还必须提供当前 `reviewId`，防止用户在不修改当前工程的情况下换了另一份审核方案。

AI 具体选择冲突之前可以调用：

```ts
await ui.inspectConflict({
  expectedReviewId,
  conflictKey,
  side: "base", // 或 left / right
  offset: 0,
  limit: 4096
}, expectedSessionIdentity);
```

该接口只读取已准备好的真实三方冲突实体。返回 `reviewId/conflictKey/side/present/encoding/offset/limit/length/text/nextOffset`；text 是真实 `{present,value?}` JSON 的一段，不是摘要。按 nextOffset 读取全部页面并拼接 JSON，核对 reviewId 和完整 length 后再解析。limit 为 2–4096 个 UTF-16 单位，默认 4096；输出不截开 Unicode 代理项，落在代理项中间的手工 offset 被拒绝。每次读取都复核 reviewId、SessionIdentity 和工作区。仅缓存一个实体 JSON，单实体上限 32 Mi 个 UTF-16 单位，超过时明确失败。

同步采用版本走归档加 Session.replace，会清空当前会话的撤销链。恢复依据保留下来的完整版本快照和归档，不承诺通过 Ctrl-Z 撤销跨版本切换。

prepared 记录之后如本机又发生其他编辑，不能安全重放旧替换。此时可明确选择 `keep-current`：请求必须带 `expectedApplyId`（对应状态中的 pendingApplyId），只清该待采用指针，保留当前工程、全部正式快照和导入 receipts，并将本机标为需要发布。CAS 失败则原指针不变。若记录已经 committed，或当前 hash 正是原候选，优先完成原恢复/清理；仍可准确恢复的 prepared 也不会被误当成无法重放。该动作不删除媒体，不把本机内容虚假标为已同步。
