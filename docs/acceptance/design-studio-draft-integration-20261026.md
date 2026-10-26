# Design Studio 81 文件开发稿整合与验收：2026-10-26

用户明确选择将旧工作树的约 80 个未提交文件也整理、验收后合并。本轮输入为
`design-studio-html2figma-json-import-20261022/codeshell-panel-apps` 的 `e4a0446`
加 50 个已跟踪文件差异和 31 个新文件。先冻结全部 81 个文件、逐文件 SHA 与 binary
patch，再从刷新后的 `origin/main`（`8e8917f`）建立
`codex/design-studio/draft-integration-20261026` 并三方转入；没有直接覆盖新主线或修改原稿。

输入、原红结果及本轮回执在 ignored
`artifacts/design-studio-draft-integration-20261026/`，清理本轮工作树前归档至稳定
主仓库同名目录。旧工作树继续作为冻结基线保留。既有 004/005/007/008/009/010 和
字体验收文档的“未合并”与历史计数仍是当时记录，本轮最终状态以本记录及精确 SHA
门禁回执为准；不将历史定点通过冒充本次完整通过。

## 整合的能力与保留边界

- 浏览器本地存储改用真实 IndexedDB 事务，对完整设计、页面、来源与资源分片进行
  原子发布和 CAS；保留旧 localStorage 原文及冲突证据。Host 桥存在时沿原调用与失败
  语义运行，不能在 Host 失败后偷偷改存浏览器。128 MiB batch 预算仍然生效。
- 字体能力从实际 SFNT/fvar 或完整固定字节 SHA 取得，不按资源名称猜测变量轴。
  HTML、测量、文档字体与 GPU 使用相同的已证明实例，不伪造静态 700 字体。
- 保留带字体、字号、字重和样式的可编辑文字范围，以及对应逐行布局/测量凭据；
  原 source 字符、范围偏移、资源引用、签名失效和严格 native 子集分别验收。
- raw html2figma JSON 与 report-backed native export 分别准入；不完整/错误位置的
  conversionReport、native exportReport 拒绝整批导入。保留根/局部刚体矩阵、原始
  来源报告及完整附件，不用改坐标或扩大画板掩盖几何问题。
- SVG 图像安全解码、CanvasKit DPR 与侧栏页面数量修复保留原固定输入和原像素断言。
- 主线无限画布、远/负世界坐标、独立画板、浏览器 CSS renderer、紧凑工具栏、文件
  选择器、800ms 自动保存、字体事务及 Figma 来源保护全部保留。两套插件按最终源
  使用官方脚本重新生成，不能选一方的旧 code.js 或嵌入槽。

## 本轮遇到的问题与固定 case

| 问题与触发 | 预期与修复 | 固定回归/证据 |
| --- | --- | --- |
| canonical 与公开 schema 支持 1–240px，但 HTML adapter/native import/属性面板及 legacy HTML 正文/表单仍使用旧 6px 下界 | 4px/1px 不被改成 6px；保持原无效输入默认、上界与显式越界诊断 | adapter 与 native import 小字号 case；`font-size-editor-ui.test.mjs` 经真实属性控件、自动保存、Undo/Redo、远坐标页面重开；`fonts/`、`conversion-*/`、`font-editor/` 保留前源、RED 与 GREEN |
| IDB 已完成后旧 localStorage 写入或作用域检查抛异常 | 不把已发布的新稿回滚为旧画布；保存结果仍明确未确认，并保留竞争的 LS/IDB/history | `browser-store.test.mjs`、`browser-store-ui.test.mjs`；正式 RED 为新稿 2 图层实际回滚为 0。初稿 oracle 误写 1 的输出另存，未计作有效产品 RED。证据 `browser-publication-unknown/` |
| 新 report 预检先于既有复制/序列化限制，对深 metadata 逐层复制完整路径 | 在不改变报告 owner/别名规则或降低输入容量的前提下保持线性遍历，仍正常拒绝旧主线已拒绝的输入 | `conversion-report-budget-review/` 保存约 540KB/60,000 层输入、旧主线约 6ms 拒绝和候选 96MiB/4s 受控未返回的真实 RED；`conversion-report-budget.test.mjs` 保留正常拒绝、旧接受控制和 root/child 别名规则；修复为每层 O(1) linked path，受控入口约 30ms 正常拒绝，未降低预算 |
| 旧测试直接点击原常驻 Save/导入/备份按钮 | 使用当前真实 More 菜单和文件名选择入口，保留数据、revision、附件及备份逐字节断言；旧 reopen 的“一次丢弃确认”改为当前切换前先保存：要求 0 dialog、独立 blank 路径实际持久化且原两节点 principal 不被重写 | browser-store、Figma workflow、native export、conversion report 等 UI 文件；首轮旧 dialog 期望失败日志单独保留 |

字号能力新增后，旧“12px 或 700 字重一律拒绝”的负例已成为支持行为，负例转为
仍不支持的未知属性/原生 750 权重；原失败源与变化理由保留。未改变像素阈值或用
更新快照消除差异。未激活的 mixed-inline planner 仍有自己的保守准入边界，未接入
转换流程，也没有将另一条 promotion 实验的失败 case 当作已通过。

## 完整门禁发现的后续修复

首个冻结提交 `fb88857` 的完整检查确实失败，日志与前后源码 SHA 保留在
`gates/20261026T062954Z/`，对应 GitHub 失败日志保留在 `ci-fb88857/`。
后续修复单独提交、重新冻结验收，不覆盖该失败基线。

| 问题与触发 | 预期与修复 | 固定回归/证据 |
| --- | --- | --- |
| 完整 UI 检查中 fallback-only 字体被统一扩成变量字重范围，公开 family 与私有 glyph fallback 选中了不同实例 | 仅作缺字后备的资源保持原 authored 400；主字体、无 fontRef 主字体与范围主字体仍使用字节证明的变量范围。用途纳入缓存与异步作用域，角色改变重建 face，事务与 lease 恢复保留 | `font-fallback-repair/`；原严格宽度断言保留，actual/reference 均为 344.6127624511719；新增角色切换与 lease 零像素差控制。exchange 从旧单一 400 字符串假设改为精确 Inter SHA、变量范围、loaded face 与原资源来源，保留恢复和首次保存重开断言 |
| report-backed 原生输入的 child absoluteTransform 与已导出 FRAME 容器链冲突，却被当作有效来源 | 拒绝整批并返回 NATIVE_EXPORT_TRANSFORM_INCONSISTENT；按 SDK container parent 规则跳过 Group/Boolean，外部未导出的容器不猜测。保留原固定 0.001 epsilon 和精确 float32 舍入，未引入随坐标放大的容差 | `native-transform-consistency/`、`peer-native-world-contradiction.*`；真实冻结输入与远坐标、嵌套/独立根控制 |
| SDK Group 子节点的 relativeTransform 相对 container，直接按 canonical immediate parent 组合会二次旋转 | 仅 report-backed native 分支从实际绝对矩阵推导临时 immediate-parent 投影；layout 使用实际矩阵与 width/height，原 SDK 矩阵、边界、source/report 逐字保留 | `native-group-projection/`；5 个 RED→GREEN case：世界边界由错误的 (1155,35,60,30) 恢复为 (1170,20,30,60)，含 selected Group、null bounds、保存重开与绑定 no-op；11 文件 CPU 170/170 |
| 大文档门禁仍读旧 localStorage，已迁移 IDB 后等待永远不成立 | 保留原 448396-byte legacy seed 作为真实迁移输入，用真实 browser-store/IDB 验证 principal、分片 revision/mtime 和 recovery；原 LS 文本与 mtime 保持不变 | `large-document-backend/`；702 节点、352/350 分页、原重建/延迟加载/图片字体 GPU/Undo/Redo 断言保留，最终返回 passed:true |
| 新增 IDB 异步探针直接传 page.waitForFunction，首个 Promise resolved false 会提前返回 | 30s 原时限内显式 await 每次 browser probe 的值，捕获实际已提交 recovery 记录，再断言 operations 而非 whole-design | 同目录 v1/v2/v3 与 failed logs 单独保留为验收脚本诊断，不计作产品 RED；async-predicate-control.json 记录实际 Playwright 1.60.0 首次返回 false、attempts=1；第四轮正式大文档检查成功 |

## 实际验收和证据层次

定点浏览器操作都使用私有测试 origin/context，原用户 4190 和旧 IANA 失败数据没有
被清空。旧 IANA wrapper、CSS 和完整资产另做本地冻结备份，不把私有字体提交到 Git。

- 浏览器保存：真实 IndexedDB 事务/完整来源、6MiB 七字体设计保存重开；原始 IANA
  151 节点稿也单独启用并保存重开，字体与来源附件精确相等。
- 属性面板：保留旧实现 4px 被改为 6px 的真实 UI RED；最终 case 要求 GPU 已激活，
  编辑 4→1px 后自动保存、Undo/Redo、重开，世界坐标保持 `(-48000,65000)`。
  初版仅验证表单/数据的输出单独保留，不据此宣称 GPU 画布通过。
- 字体：六文件串行浏览器/GPU批次 34/34、0 skip；两个原始 IANA oracle 实际执行。
  完整稿保持 151 节点/38 Text，其中 34 native、4 原字体缺字回退。不能据此声称
  38/38 native 或整页像素等价。混合字号 SVG/frontend 零像素差及原 advance <0.1px
  阈值保留。
- raw/native 无限坐标组合：`(65000,-35000)` 的世界位置不 rebase；局部/绝对矩阵、
  完整报告、来源绑定 no-op、保存重开均精确核对。
- native 写入使用严格 SDK mock 和冻结真实导出输入分别检查；这些结果不等于本轮
  在真实 Figma 账号新建节点的原生画布验收。

定点验收完成后，对最终冻结提交运行全仓 `npm run check`、真实转换保真与大文档门禁，并保留源码
前后 SHA、退出状态和完整日志。新旧 case 都执行，不覆盖旧失败或降低阈值。
检查通过后正常合入推送 main；当前 GitHub `design-studio-v0.23.0` 的标签与资产不重写。
