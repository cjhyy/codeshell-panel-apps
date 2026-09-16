# Mimi 视频工程包开放格式（版本 1）

本格式把 Mimi 视频面板的完整可编辑工程与原始素材保存为一个普通 ZIP 文件。推荐扩展名是 `.mimiproject`，MIME 类型是 `application/zip`。任何支持 ZIP 的工具都可以列出和读取其中的 JSON、媒体文件；格式不绑定云盘、同步供应商或某台设备。

这是本项目自己的公开格式，不是剪映私有草稿格式，也不表示能读取或写入剪映工程。

## 文件布局

```text
manifest.json
media/0123456789abcdef…（64 位小写 SHA-256）
media/abcdef0123456789…（64 位小写 SHA-256）
```

根目录必须有且只有一个 `manifest.json`。其他条目只能是 `media/<sha256>` 普通文件；没有额外的目录条目、绝对路径、路径分隔符转义、符号链接或清单未引用的文件。素材文件没有扩展名，原始媒体字节不转码。素材类型和显示名称来自工程中的素材记录。

版本 1 的读取器接受 STORE（方法 0）与 DEFLATE（方法 8），包括 ZIP64，拒绝加密 ZIP。当前写入器使用 STORE：视频、音频等通常已经压缩，逐字节复制也避免重复压缩的额外成本。ZIP 的 CRC-32 和素材 SHA-256 都要校验。

## 根清单

清单是 UTF-8 JSON 对象，只有以下四个字段：

```json
{
  "format": "mimi-video-project",
  "formatVersion": 1,
  "document": { "schemaVersion": 2, "timebase": 240000 },
  "media": [
    {
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "bytes": 123456,
      "assetIds": ["camera-original", "camera-copy"]
    }
  ]
}
```

上例中的 `document` 只展示版本标记；实际文件必须保存并通过校验的**完整 schema 2 工程**，包括工程 ID、名称、修订号、全部素材、全部序列、当前序列、导出预设以及已有制作注释。工程契约以 [`src/editor/types.ts`](../apps/video-studio/src/editor/types.ts) 和 [`validation.ts`](../apps/video-studio/src/editor/validation.ts) 为准。

- `format` 固定为 `mimi-video-project`。
- `formatVersion` 必须是整数 `1`。未知版本明确拒绝，不猜测兼容方式。未来改变清单含义、素材映射或必需特性时应增加版本，并提供显式迁移。
- `document.timebase` 为每秒 240000 个整数 tick。不得经由旧版 30 fps 模型中转；帧率分子/分母、时间映射、关键帧、字幕词时间、嵌套引用与多机位信息原样保存。
- `media[].sha256` 是文件全部原始字节的 SHA-256，小写十六进制 64 字符。文件名严格从它推导，不接受 `path`、URL 或本地路径字段。
- `media[].bytes` 是原始文件的正整数大小，必须同时匹配 ZIP 解压大小和实际读出的字节数。
- `media[].assetIds` 非空，每个 ID 必须引用工程中的非 `demo` 素材。每个非 `demo` 素材必须且只能绑定一次，包括未在任何时间线使用的素材。
- 一个摘要只有一条记录；内容相同的不同素材、不同源设备资源 ID 共用一个文件，保留各自的素材 ID 与时间线关系。
- 如果工程素材已有 `fingerprint`，它必须匹配这里的 SHA-256。
- 普通对象/密集数组以外的内存输入、未知字段和未知版本不能静默丢弃。反序列化前后都要校验。

本版本只定义完整包，不定义“离线缺项但成功”的状态。缺少或损坏任何必需原始素材必须报告，不能发布残缺包。

## 设备身份与授权

工程内 `asset.id`、片段 ID、序列 ID 是稳定的编辑关系。源设备的 `asset.resourceId` 仅保存原始文档身份，**不能在接收设备直接用作资源权限**。

接收流程必须按此顺序执行：

1. 读取清单，校验整个工程、文件集合、大小、CRC 和 SHA-256。
2. 只在新建的任务私有目录中写入由 SHA-256 推导名称的普通媒体文件。
3. 由接收设备的 Host 发布全部已验证媒体，取得其本地资源 ID。
4. 按摘要建立完整映射，调用 `remapPortableProjectResources(manifest, resources)`。它更新素材的 `resourceId` 和 `fingerprint`，保留素材 ID、片段关系和编辑数据。
5. 完成所有资源发布并检查当前会话身份后，由工作区进行一次原子工程替换。任何一步失败时均不得替换一半工程。
6. 清理临时解包目录；如果取消，按 Host 既有规则处理尚未关联的发布资源。

原生核心不调用 Host、不发布资源、不替换当前工程。它接受的 `sourceRoots`、`workDir`、`inputPath`、`outputPath` 和素材解析器返回路径必须来自 Host 已审查的任务物化适配层，不能取自浏览器请求或 ZIP 清单。核心再次验证目录边界、普通文件和符号链接，文件使用排他创建与受限权限。

工程的自定义 metadata 和制作注释按 schema 保留；任何其中的历史路径、旧代理资源 ID、URL 都只是数据，不能作为导入器的资源授权或文件解析来源。格式不包含服务凭据字段；调用方不应把服务凭据放入工程注释。

## 内置素材与字体

`kind: "demo"` 是已有的程序化示例画面，不含外部媒体文件。工程保留该记录，由面板的示例绘制器处理。内置示例旁白属于普通音频，必须把真实音频字节装入包；原生适配器可从已安装程序的固定白名单文件获取它。

字体名称、文字样式和字幕编辑数据保留。当前 schema 没有自定义字体文件素材类型，因此本版本不打包系统字体、不从字体名称推测任意本地文件，也不承诺不同设备上的字体字形完全一致。自定义字体资源需要未来明确的资源模型与许可处理。

## 容量、取消和完整性

当前实现的默认上限（调用方可以进一步降低）：

| 项目                        |   上限 |
| --------------------------- | -----: |
| 工程素材数 / 唯一媒体文件数 |  10000 |
| `manifest.json` UTF-8 大小  | 32 MiB |
| 单个媒体文件                | 20 GiB |
| 所有展开内容合计，包含清单  | 20 GiB |
| ZIP 文件大小                | 20 GiB |
| 单条目的展开 / 压缩大小比   |   1000 |

这些是当前执行与 Host 发布能力限制，不是 ZIP64 格式的理论容量。旧 schema 2 校验器自身的节点、文字、时长等限制仍然生效。过大的项目明确报错，不能声称已经传输完整项目。

媒体写入、哈希、解压逐文件流式执行，媒体读取块为 128 KiB，解压流按块写盘；不把所有媒体读入内存。清单与验证后的工程对象会驻留内存：清单有 32 MiB 字节限制，工程另受 schema 2 结构限制，因此这不是无限大小 JSON 的流式解析器。

导出先检查全部原始素材，汇总不可用项，再创建临时 ZIP；实际打包时再次核对原始字节，发现文件变化立即失败。最终使用排他、原子发布，不覆盖既有输出。取消和异常会移除临时 ZIP。

导入在写媒体前检查 ZIP 条目数、文件大小和总大小、压缩比、重复名称、文件类型、本地头与中央目录的一致性、数据区重叠和文件集合。解压时继续验证实际大小、CRC 与 SHA-256。失败或取消会删除本次新建的解包目录。未使用通用“解压到任意路径”函数。

摘要用于内容完整性与去重，**不是作者数字签名**。修改文档并重新打包可以得到另一个合法工程包；信任来源和版本冲突应由可替换的同步层管理。

## 核心接口

实现文件：

- [`portable-project.ts`](../apps/video-studio/src/editor/portable-project.ts)：公开常量、清单校验、完整资源映射；浏览器也可使用。
- [`bundle.ts`](../apps/video-studio/native/editor-runtime/bundle.ts)：实际 ZIP 写入和验证导入；只在原生任务执行。

```ts
exportPortableProject({
  document,
  workDir,
  sourceRoots,
  outputPath,
  signal,
  resolveAsset: async (asset, signal) => ({ path, sha256, bytes }),
  limits,
  onProgress,
}); // -> { manifest, path, bytes, sha256 }

importPortableProject({
  inputPath,
  workDir,
  sourceRoots,
  signal,
  limits,
  onProgress,
}); // -> { manifest, document, directory, media: [{ sha256, bytes, assetIds, path }] }

remapPortableProjectResources(manifest, [{ sha256, resourceId: "接收设备发布后的资源 ID" }]); // -> validated EditorDocument
```

`resolveAsset` 的 `sha256`、`bytes` 可省略；提供时必须与实际字节一致。进度阶段为 `checking`、`packing`、`unpacking`，包含已完成条目数、总条目数和阶段字节数。函数接收 `AbortSignal`。常见错误代码包括 `MISSING_MEDIA`（含逐项诊断）、`HASH_MISMATCH`、`INVALID_BUNDLE`、`INVALID_ZIP`、`UNSUPPORTED_BUNDLE_VERSION`、`LIMIT_EXCEEDED`、`OUTPUT_EXISTS`；取消使用 `AbortError`。

ZIP 实现固定使用 [yauzl 3.4.0](https://github.com/thejoshwolfe/yauzl) 与 [yazl 3.3.1](https://github.com/thejoshwolfe/yazl)，源码随原生工具打包，不要求用户设备安装 npm 依赖。

## 验证

- [`video-studio-portable-project.test.ts`](../tests/video-studio-portable-project.test.ts)：清单完整性、严格结构校验与接收设备资源重映射。
- [`video-studio-portable-bundle.test.mjs`](../tests/video-studio-portable-bundle.test.mjs)：真实 MP4/WAV 往返、同源字节去重、独立 Python ZIP 互读、ZIP64、取消清理、哈希/CRC 伪造、危险路径、缺失文件和容量限制。

Host 协议接线、资源发布和工作区原子替换属于调用层；这个原生核心文件本身不会开启网络、执行 ZIP 内代码或建立同步服务。

## 原生任务协议与跨设备接线

已接入安装包的 `editor-runtime` 入口，复用 Host 的通用 `tasks.start` 和资源物化 / 产物发布协议。JSON 请求只包含文档块、资源 ID、摘要、序列 ID 和批次编号；目录参数仍由 Host 注入。

- `stage-resources` 每次至多 128 个原始资源；`stage-document` 使用 512 KiB 块。完整工程使用 **`commit-project`**，不会经过只保留所选序列依赖的普通 `commit`。
- `export-project` 只接受标记为完整工程的冻结快照。它返回标准工程包资源，可交给 Host 的资源导出或任意后续同步适配器。
- `import-project` 只物化一个已授权 ZIP 资源，完整验证后把原始媒体存入当前 Host scope 内的私有暂存目录。根清单单独发布为 JSON 资源；任务结果只返回摘要、大小、资源 ID 和数量，避免把大清单放入 2 MiB 任务请求或 240 KiB 单行回执。
- 浏览器按 32 KiB 读取清单资源并核对 SHA-256，然后调用 `publish-project-media`，每页至多 120 个产物，低于 Host 的 128 个产物上限。每页只包含 SHA、字节数、媒体类型和新资源 ID，不重复携带长文档或素材引用列表。
- 初次验证生成带摘要的独立页索引。后续页只读取该页的小索引和该页媒体，不再解析整个清单，也不读取此前页的媒体或原始 ZIP。
- `project-import-status` 可以恢复已经完整校验的导入，查询时不再次物化原 ZIP。暂存回执绑定源资源、ZIP 摘要及 Host scope，不能改用另一文件或工作区。
- 任务请求键保留成功结果；显式继续会通过 `tasks.retry` 恢复以前可重试的失败 / 取消任务，成功页不重新执行。
- 取消或部分发布失败不会返回可替换的半成品文档。已经完整校验的暂存和 Host 已发布资源可以用于继续；调用方保存 `onImportReceipt` 收到的回执，再传回 `receipt` 即可恢复。
- `discard-project-import` 只清理本次导入的私有暂存，**不删除 Host 发布的素材资源**。通常应在保存、归档旧工程、原子替换全部成功后调用；暂存未释放前可以继续。

浏览器接口位于 [`task-bridge.ts`](../apps/video-studio/src/editor/task-bridge.ts)：

```ts
bridge.stageProject(document, options);
// -> EditorTaskSnapshot，其中 kind === "project"

bridge.exportProjectBundle(document, { ...options, snapshot });
// -> { snapshot, job, bundle: { id, sha256, bytes, mimeType } }

bridge.importProjectBundle(resourceId, {
  ...options,
  receipt, // 继续已有完整校验的导入时提供
  onImportReceipt(receipt) {
    /* 保存用于恢复 */
  },
});
// -> { document, manifest, resources, bundleHash, transferId, receipt }
// document 的全部媒体资源 ID 已映射；还没有替换当前工作区。

bridge.discardProjectImport(receipt);
```

工作区调用层仍负责：上传用户选中的 ZIP、冻结最初会话身份、处理保存 / 归档、最后一次性替换文档，以及把 `bundle.id` 交给用户选择的本地保存或同步服务。本格式保留原工程全部 metadata，包括历史 `sourcePath`，但原生导入器不会据此重连本机文件；所有重映射只依据已经验证并发布的 `media/<sha256>`。

附加验证：[`video-studio-portable-task.test.ts`](../tests/video-studio-portable-task.test.ts) 覆盖大清单、128 资源边界和恢复；[`video-studio-portable-task-runtime.test.mjs`](../tests/video-studio-portable-task-runtime.test.mjs) 覆盖真实 CLI 导出 / 导入 / 120+10 产物发布、固定安装示例旁白、继续时不读取原 ZIP 或前页媒体，以及会话资源与目录约束。
