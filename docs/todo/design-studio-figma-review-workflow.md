# Design Studio：Figma 交换与设计评审

日期：2026-10-16。实现属于独立 Design Studio Panel；使用既有工作区文件与浏览器
能力，不向 CodeShell Host 增加 Figma 领域规则。

## 产品流程

1. 从 Figma REST API，或随包开发插件的选区／当前页导出取得 JSON。
2. 面板预览转换结果和差异，经“导入到画布”载入可编辑图层。
3. 使用既有画布、属性、自动布局、撤销和 Agent 工具修改设计。
4. 下载转换 JSON，经 Figma 插件创建新的页面；或下载当前页 HTML 原型。
5. 在“讨论”中对页面／稳定图层记录问题、回复、解决，评论独立存入项目文件。

Figma 插件导入创建新页面，避免把旧来源 ID 误当作修改现有节点的授权。转换后基础
节点仍可编辑，但不称为无损同步。面板原生文档继续使用 `.codesign.json`，评论使用
独立 `.comments.json`，不修改 v3 文档结构，也不破坏旧版本读取设计的能力。

## 官方能力与限制

- [Figma 文件 REST API](https://developers.figma.com/docs/rest-api/file-endpoints/)
  可读取设计树；矢量路径与图片字节需要额外请求。REST API 没有通用节点写入接口。
- [Plugin ExportSettings](https://developers.figma.com/docs/plugins/api/ExportSettings/)
  支持 `JSON_REST_V1`，插件可在用户运行时导出选区，无须面板保存访问令牌。
- [Plugin API](https://developers.figma.com/docs/plugins/) 支持创建和修改图层，文字编辑
  需要先[加载字体](https://developers.figma.com/docs/plugins/working-with-text/)。
- [评论 REST API](https://developers.figma.com/docs/rest-api/comments-endpoints/)
  可读写与删除评论，但当前项目评论尚未接入 Figma 账号，不会自动发布出去。

基础转换优先覆盖 Frame、Group、Rectangle、Ellipse、Text、纯色、位置尺寸、文字
样式与水平／垂直自动布局。未知节点或属性明确报告。复杂向量、遮罩、渐变、图片、
混合文字样式、变量绑定、组件实例覆盖、远程组件库和原型交互需要独立适配；不能
从渲染相似推断这些语义已经保留。

## 对标方向

- [FigCraft](https://github.com/storytold/figcraft)：纯 Rust，覆盖 Figma 类布局、
  组件、原型、REST JSON 与 CLI/MCP；官方仍标记 alpha，`.fig` 仅 best effort。
- [Graphite](https://graphite.art/)：Rust 程序化矢量与非破坏编辑，适合参考渲染和
  操作图模型，与 UI 设计协作工具的关注点不同。
- [OpenPencil](https://github.com/open-pencil/open-pencil)：值得参考 `.fig` 兼容、
  AI/MCP 和设计操作能力；主体采用 Vue、CanvasKit、Yoga，桌面使用 Tauri。

当前面板已有布局、资源、持久化、Agent 事务和 HTML 交付。先完善交换与评审能直接
复用这些能力；更换引擎应以大文档交互和绘制性能测量为依据。

## 后续优先级

- 高：真实 Figma 环境中的插件验收；基础转换视觉基准与差异报告；图片与字体资源
  交换；评论随完整备份迁移；评论 Agent 读取／处理工具。
- 中：源文件／节点对应账本、导回前差异预览、逐项确认更新已有节点；混合文字
  样式、矢量与效果；组件／变量／设计 Token 适配。
- 中：显式原型链接和交互模型，响应式断点，HTML 实现中的节点定位与评论锚点。
- 后续：通过官方授权接入 Figma 文件和评论同步；先建立冲突和撤回策略。

## 验证范围

离线检查覆盖转换模型、Figma 插件 API 替身、真实 Chromium 面板交互、导入撤销、
HTML／转换文件下载、评论持久化与并发／切换保护。实际 Figma 桌面／浏览器账户、
开发插件权限、真实字体与复杂设计保真尚需独立验收。本次未连接个人 Figma 账号。

本轮验收：`npm test -- --suite design-studio` 113 项全部通过；`npm run validate`、
`npm run typecheck`、`npm run build:check -- --app design-studio` 与 `git diff --check`
通过。人工查看 Chromium 截图，并核对 390–1500 px 的页面宽度；原触控回归另覆盖
320 px。Design Studio 为原生 `app/` 包，本轮不生成额外构建目录。
