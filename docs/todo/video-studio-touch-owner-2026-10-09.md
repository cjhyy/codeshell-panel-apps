# Video Studio 多触点手势归属验收（2026-10-09）

时间轴拖动现在由首个触点持有；第二触点不能替换拖动或改变片段选择。
时间轴和画布只响应所属触点的取消、捕获丢失与释放。窗口失焦、Escape、
工程变化和组件销毁仍会取消未完成的手势。

时间轴还会核对打开工程的 generation。即使重新打开的工程具有相同 ID 和
revision，旧手势也不能修改新打开的工程。

## 回归证据

`video-studio-editor-timeline.test.mjs` 和 `video-studio-editor-canvas.test.mjs`
各新增三个场景。真实 Chromium CDP 双触点输入验证：

- 第二触点不改变时间轴选择，取消或丢失捕获也不终止主触点的预览。
- 释放第二触点不提交；释放主触点仅产生一次编辑，一次撤销恢复原状态。
- 主触点取消恢复原数据和画布像素；迟到的释放不产生写入。
- 时间轴打开 generation 变化、画布实际 EditorSession 工程替换后，两个旧触点
  的释放均不能修改后继工程。

事件轨迹核对浏览器实际产生的 `isTrusted` 和 `pointerType="touch"`。单个无关
`pointercancel` 和取消后的迟到释放是明确的合成边界探针；捕获丢失、双触点
按下／移动／释放及整个触摸序列取消由真实浏览器产生。测试没有加入 pinch。

同一份最终测试在隔离的 `a37122ad` 旧源码上为 3 通过／3 失败：第二触点抢占
选择、无关取消丢失画布预览，以及 generation 切换后的旧手势写入。修复后的
时间轴与画布完整浏览器回归为 66／66 通过。

本地使用实际 Node 22.16.0、独立 HOME／USERPROFILE／临时目录，并清除继承的
账号凭据环境。浏览器页面使用本地受控 fixture，不调用真实模型或第三方账号；
这不代表 OS 网络沙箱或实体手机验收。

## 检查

- `npm run typecheck`：通过。
- `npm run build -- --app video-studio`：通过。
- `npm run build:check -- --app video-studio`：确定性生成文件与源码一致。
- `npm run validate`：通过，Video Studio 39 个安装文件。
- `npm test -- --suite video-studio`：1,022 通过、0 失败、4 个可选模型测试跳过。
- `npm run test:ui:video-studio`：482／482 通过，0 失败。

源码与 `panels/video-studio/app/main.mjs`、生成文件清单一起交付。现有 Host 权限和
Panel 版本保持原值；本批没有发布或部署。完整实体手机／本地／Cloud 业务组合、
Web 摄像头／屏幕采集代理及浏览器媒体精确时长仍是独立后续项，不能据此标记
全部跨设备验收完成。
