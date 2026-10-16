# Design Studio 完成验收账本

用户目标：完整实现 Figma JSON → 面板可编辑设计 → 修改后回到 Figma → HTML 原型，
以及面板内的问题评论。以真实运行和已保存数据为依据，不能用单元测试代替实际 Figma 验收。

## 必须证明的结果

- [x] 读取官方 REST／插件 JSON，导入可编辑图层与 Auto Layout，并明确显示转换差异。
- [x] 图片字节进入项目资源库，保存、重开、备份和重新导出后内容可核对。
- [x] 复杂图层保留原始 JSON 和可见预览；未修改的来源语义不因面板能力不足而消失。
- [x] 来源映射与设计版本绑定，保存失败不会把旧设计绑定到新来源；重开后可生成原节点补丁。
- [x] Figma 插件支持新页面导入、原节点补丁预览、冲突检查和删除确认（API 替身验证）。
- [x] 多页 HTML 原型支持显式链接、返回、安全 URL、键盘操作和响应式页面路由。
- [x] 评论支持页面／图层目标、回复、解决／重开、并发保护和安全草稿恢复。
- [x] Agent 工具可导入／导出 Figma、读取／处理评论、生成交互原型。
- [x] 完整备份携带评论、Figma 来源、原型和资源，验证后恢复为独立副本。
- [x] 验证 Figma 导入的撤销／重做及崩溃草稿恢复后仍选取正确来源映射。
- [x] 补丁字段与 Figma 实际 API 完整核对，包括重排／约束／复杂图片变换的差异说明。
- [ ] 在真实 Figma 桌面端安装开发插件，导出测试设计、面板修改、回写并重新导出核对。
- [ ] 从干净已合并提交完成版本、完整检查、最终真实 Host/Desktop 验收与稳定安装来源更新。

## 已取得的证据

- `exchange-tools-ui.test.mjs`：真实 Chromium 完整应用中的导入保存重开、编辑导出补丁、
  图片来源备份、评论工具、Agent 提交和交互 HTML，12 项通过，包含撤销／重做、未保存来源恢复、历史淘汰和大包分片。
- `figma-plugin.test.mjs`：官方 API 替身中的图片、复杂预览、原节点补丁与两次冲突核对。
- `prototype*.test.mjs`：真实 Chromium 键盘导航、返回、断点和评论文本安全，12 项通过。
- `npm run test:host-storage -- /Users/admin/Documents/个人学习/代码学习/codeshell/packages/server`：
  五组真实 Node Host 存储／运行时验收通过，仅临时目录及隔离环境。
- `npm run test:desktop -- /Users/admin/Documents/个人学习/代码学习/codeshell /tmp/design-studio-desktop-complete-preflight.json`：
  六面板真实安装、sandbox webview、Main/preload IPC、项目隔离、摘要更新和回滚通过。
  此轮为工作树预检，不能代替干净最终提交的发布验收。
- `npm test -- --suite design-studio`：187 项通过；类型、包验证与原生包检查通过。
- `figma-plugin-ui.test.mjs`：5 项真实 Chromium 入口测试通过，包括粘贴与查看 JSON。
- 已登录 Figma 桌面端，在独立验收草稿创建正式开发插件，插件能启动。
  其原生文件选择与菜单自动化存在不稳定行为；尚未完成真实往返验证。

账号连接自动同步、私有 `.fig` 二进制格式和重写 Rust 引擎不属于原请求的 JSON 文件工作流。
原始矢量／变量／组件语义通过来源保留和属性补丁往返；不将 PNG 预览称为原生矢量编辑。
