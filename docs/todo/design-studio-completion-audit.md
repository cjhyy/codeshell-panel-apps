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
- [x] 从干净已合并提交完成 0.19.0 版本、完整检查及最终真实 Host/Desktop 验收。
- [x] 在真实 Figma 桌面端运行未修改的生产插件主程序，完成官方导出、面板模型修改、补丁预览／应用及重新导出核对（文字与位置样本）。
- [x] 修正真实 Figma native bridge 回执兼容，正式 UI 的导出、预览、错误与 busy 恢复由真实 Chromium 回归验证。
- [ ] 从稳定来源更新个人 CodeShell 安装，并在个人环境核对 0.19.0 的已安装版本。

## 已取得的证据

- 稳定 `main` 提交 `da04251b995bde388eb6b8af0791b924d1aba353`（`da04251`）的
  Design Studio manifest 为 `0.19.0`；该轮 Desktop 报告对应此提交。
- `npm run check` 在 `0283970` 完整功能提交通过：全部离线 suites 合计 2432 项通过、4 项跳过、0 项失败
  （共 2436 项），包含 Design Studio 的 187 项；源类型、确定性构建、包验证及
  原生包检查通过。完整日志：`/tmp/design-studio-019-full-check.log`。
- `exchange-tools-ui.test.mjs`：真实 Chromium 完整应用中的导入保存重开、编辑导出补丁、
  图片来源备份、评论工具、Agent 提交和交互 HTML，12 项通过，包含撤销／重做、未保存来源恢复、历史淘汰和大包分片。
- `figma-plugin.test.mjs`：官方 API 替身中的图片、复杂预览、原节点补丁与两次冲突核对。
- `prototype*.test.mjs`：真实 Chromium 键盘导航、返回、断点和评论文本安全，12 项通过。
- `npm run test:host-storage -- /Users/admin/Documents/个人学习/代码学习/codeshell/packages/server`：
  五组真实 Node Host 存储／运行时验收通过，仅临时目录及隔离环境。
- `npm run test:desktop -- /Users/admin/Documents/个人学习/代码学习/codeshell /tmp/design-studio-desktop-019-release-final.json`：
  六面板真实安装、sandbox webview、Main/preload IPC、项目隔离、摘要更新和回滚通过。
  最终报告记录 `panelCommit: da04251b995bde388eb6b8af0791b924d1aba353`，
  Design Studio `0.19.0`；Electron `33.4.11`、Node `20.18.3`、macOS arm64。
  日志：`/tmp/design-studio-019-desktop-release.log`；报告：
  `/tmp/design-studio-desktop-019-release-final.json`。本轮替代此前的工作树预检证据。
  自有 Electron 进程以 0 退出、临时 HOME 删除已核实，报告的 `cleanup.exited` 与
  `cleanup.homeRemoved` 均为 `true`。这是隔离测试环境中的真实 Desktop 验收，
  个人安装仍未完成。
- native bridge 回执修复后，`npm test -- --suite design-studio` 为 188/188 通过；
  `figma-plugin-ui.test.mjs` 为 6/6，通过真实 sibling iframe 的官方 origin 消息验证
  `event.source !== parent` 的导出、预览、错误及 busy 恢复，同时拒绝不可信来源和无效封装。
- 真实 Figma 桌面插件往返 `PASS`：稳定证据位于主仓库
  `artifacts/design-studio-figma-plugin/acceptance-runs/real-figma-1792122353371-e26a6ef5/report.json`。
  原 `Page 1`（`0:1`）为空，仅新建自有页面 `12:2` 与 3 个节点。真实官方导出后，
  使用生产面板 `prepareFigmaImport`、binding 和 model 模块修改文字与 x 坐标；
  插件预览为 0 冲突、0 删除，应用 1 项更新，再次真实导出核对。
  文字节点 `12:4` 从 `Figma round trip check` 改为 `Edited in Design Studio · e26a6ef5`，
  x 从 140 改为 164，所有来源 ID 保持一致；未修改的 marker `12:5` 完整 JSON 不变。
  生产主程序 SHA-256 为 `f7a11289a2c35e2ece4513025f2904a6d418d98b544e0f0476b74de981f1f620`，
  本轮未修改主程序。自动化只在临时 UI 附加代码中通过带 nonce 的 loopback 通道发送
  正常插件消息；不能据此声称正式 UI 按钮全链已通过。
  此 Desktop 环境无法读取 `fileKey`，预览明确返回 `identity.verified: false`，
  提示用户确认当前原文件，并按图层 ID 与属性快照核对；不声称已自动验证文件身份。
- 临时 loopback 服务已退出，端口不可连接；测试 UI 附加代码及网络权限已移除。
  清理回执保存在同目录 `10-cleanup-receipt.json`。正式 UI SHA-256 为
  `0c741c25c7e84d6d5e78f6af578b170f5ed399f6e2552a3f1cc979051463d014`。
  Figma 原生 AX 无法可靠触发 iframe 按钮，因此本轮不声称正式 UI 的原生鼠标点击已验收。

后续真实样本应继续扩展字体、复杂图层、组件变量和冲突拒绝的视觉基准；本轮实际
Figma 证据限定为上述文字与位置样本，不把 API 替身或 Chromium 测试扩大为全量保真证明。

账号连接自动同步、私有 `.fig` 二进制格式和重写 Rust 引擎不属于原请求的 JSON 文件工作流。
原始矢量／变量／组件语义通过来源保留和属性补丁往返；不将 PNG 预览称为原生矢量编辑。
