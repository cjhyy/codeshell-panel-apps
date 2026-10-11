# Panel 稳定项目上下文：2026-10-11

Download 和 Video Studio 在同一项目切换聊天后，继续使用项目文件、工程和独立后台任务。
这项行为依赖 Host 新增的可信项目上下文；旧 Host 仍按原来的会话绑定保守处理。
本次仅修改独立 Panel 仓库，未安装到个人项目、修改服务器或发布 Panel 版本。

## Host 契约

Host 在已审阅的 `context.workspace` 权限下提供：

```ts
projectScope: {
  version: 1;
  environmentId: string;
  projectId: string;
  rootId: string;
}
```

三项 ID 必须为非空、有界、无控制字符的字符串。Panel 只比较 Host 提供的完整身份，
不会从路径、页面参数、Session、API 数字或旧的顶层 `projectId` 猜测身份。
实际路径和权限仍由 Host 校验；这些 ID 不作为可直接访问文件的参数。
Host 对同一 guest 的会话敏感方法还必须固定首次真实 Session；会话变化或丢失后永久
拒绝，直到创建新 guest。这个派发屏障防止事件尚未到达 Panel 时，旧意图被改发到新
Session；不能只用客户端读取和事件监听代替 Host 的最终核验。

## 项目与会话边界

- Download 的存储、下载队列、原生进程和任务；Video 的工程、素材和原生任务，
  在完整合法 `projectScope` 不变时允许选择另一聊天。独立 `agent.task.*` 保持项目归属。
- `environmentId`、`projectId`、`rootId`、执行目录、Host 类型、Panel 或数据后端变化后，
  旧页面永久失效。切回原身份不会重新放行旧调用、迟到回执或工具。
- `agent.submitPrompt` 和 `automations.*` 仍属于本页原会话。派发前只读刷新上下文；
  发现会话变化后永久拒绝这些方法，需重开页面。已经派发的迟到回执也不返回给调用方。
  Video 的额度队列在真正调用 Host 前再次检查具体方法，不将排队中的旧意图改发到新会话。
  注册工具保留同步结果和原始错误形态；异步结果成功或失败都在返回前重验项目，
  使现有同步读取工程身份的调用保持兼容。
- 完整上下文丢失或降级项目证明会使页面失效；部分事件没有该字段时沿用现有证明，
  显式空值或非法值仍会失效。Download 只允许读取期间实际发布的新字段覆盖快照，
  避免普通界面事件掩盖完整上下文丢失证明。
- 初次上下文没有有效证明时固定使用旧 Host 的会话屏障，不在本页中途升级。
  原存储键、数据格式和已接收任务保持原项目归属。

数据后端检查复用 Download 既有的存储模式解析；Video 保留原生文档／workspace
文档两种后端的固定选择。切换聊天不会触发数据迁移、重复任务或未确认写入的重放。

## 验证

```sh
npm ci
npm run build -- --app video-studio
npm run check
npm run test:ui:video-download
npm run test:ui:video-studio
npm run test:media:video-studio
```

`npm run check` 最终通过 1867 项，其中 1863 pass、0 fail、4 个既有可选跳过。
Download 独立完整 gate 为 294/294（包含 unit/native/Chromium）；Video 完整 UI
为 505/505，media 为 203/203，均无失败或跳过。Video documents/traffic 为 50/50，
Download binding/storage 为 47/47。原版源码的独立受控回归为 32 项中 18 fail，证明新增稳定
项目边界能捕获原有缺口；该基线不含随后补入的同步工具契约断言。

新增的 2 项受控 Chromium 流程使用实际 Panel 页面：390px Download 在换会话后保存链接，并逐项启动三个原生
后台下载；Video 在换会话后实际编辑并持久保存工程。两者均验证换执行根后切回原根
不能使旧页面重新操作。受控 Host 夹具不代表实体手机、真实服务商或部署验收。

首轮完整 Video UI 发现工具 wrapper 把同步工程读取改成 Promise 的真实回归；
已保留同步结果，补入同步与异步迟到回执契约，再重建安装包并从头跑完上述最终 gate。
失败历史、基线与最终日志均保留在本地交付证据中，没有把中断或失败的运行计为通过。

当前 CI workflow 有 7 个独立 job。本地跑受影响的 package/offline、Download、Video UI
与 media 检查；没有把它们称为全部 CI 已通过，独立 PDF、Design fidelity、Quant UI
仍由真实 CI 执行。本地使用 Node 25.8.1 / npm 11.11.0，不冒充 Ubuntu CI 的 Node 20/22。

本次不增加权限、导航入口或依赖。Video Studio 源码与生成安装包一起提交；
新版 Host 与这批 Panel 同时安装后才能启用稳定项目行为，独立升级任一侧保留旧保护。
