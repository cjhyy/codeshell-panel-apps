# P1：已安装六 Panel 的真实 Desktop / IPC 验收

本轮补齐可独立运行的 macOS Electron 安装与权限生命周期门禁。**六个真实包的
受控 Desktop 检查通过，不代表六个 Panel 的全部业务、四种部署组合或发布完成。**
旧版本业务数据迁移与回滚另见 [升级回滚记录](https://github.com/cjhyy/codeshell-panel-apps/pull/74)
（独立 PR #74）；这里的候选更新仅在临时副本 HTML 末尾增加注释，版本和权限不变。

## 实际运行路径

`npm run test:desktop -- <已构建 Host checkout> <新建 report.json>` 使用生产
Main、renderer preload、Panel preload、`cspanel://` 协议和 Electron sandboxed
webview。安装、绑定、预览更新、提交更新、历史、审阅恢复和恢复都走真实
`window.codeshell` IPC；Panel 读写走真实 `window.codeshellPanel.callResult`。
没有注入模拟 Panel bridge，也没有手写安装注册表或项目 pin。

安装包来自 `9a714ed42ea1c469859356e8a5f49e9d0a4b2a75`，Video Studio 使用
`panels/video-studio/`。先复制到独立临时稳定来源，再由 Host 审阅安装；不将一次性
任务工作树登记为个人安装来源。两个项目、应用 HOME/userData、Electron 的 home、
downloads、documents、desktop 都是独立目录，启动后回读原生路径逐项核对。

| Panel | 版本 | 真实包模块执行证据 | 公共安装/隔离/失败保全/恢复 |
| --- | --- | --- | --- |
| Design Studio | 0.18.1 | 缩放按钮改变画布缩放标签 | 通过 |
| Job Hunt HQ | 4.1.1 | 简历导航切换活动模块 | 通过 |
| Quant Lab | 0.46.1 | 持仓 tab 改变选中状态 | 通过；使用真实 `visible:false` 生命周期，避免首页自动行情采集 |
| Mimi Download | 0.22.6 | 媒体库 tab 改变选中状态 | 通过；原生版本探测使用下述受控 CLI |
| Video Studio | 0.7.2 | 安装包 main.mjs 实际创建 `#studio` 内 UI | 通过；没有执行媒体处理任务 |
| Starter | 0.1.0 | 点击计数及真实项目路径展示 | 通过；未声明 storage 的调用被拒绝 |

每个包逐项执行：

1. 预览不安装；正式安装的权限与原 manifest 完全一致。B 项目未绑定时 prepare
   被拒绝，正式绑定后解析与 A 相同的原包摘要；两个项目的 webview partition 不同。
2. 两个真实 guest 都获得 Main 决定的项目、权限和可信上下文，Node `process` /
   `require` 不可用。五个有 storage 权限的包走真实磁盘 CAS，同 key 跨 app、跨项目
   隔离；guest 在参数中伪造 B 项目不会改变 A 的实际存储归属。过期 revision 不覆盖。
3. 审阅来源后改变 HTML 字节，实际更新明确返回 `Panel App source changed after
   review`。A/B 原 pin 不变，原 A guest 仍可读取原数据。
4. 重新审阅候选后，将**私有** `.versions/<app-id>` 目录改为只读。Host 完成暂存后
   发布包的真实 `rename` 发生 `EACCES`。恢复目录权限后核对 A/B pin、原 guest 和数据
   仍保持；用同一审阅 token 重试成功。这不是在模拟 API 中抛错。
5. 同版本、不同包摘要只推进 A；旧 A guest 撤权，B 原包 guest 仍可读原项目；A 的
   新 guest 可读原数据。再通过真实历史/权限审阅/恢复 IPC 选择原摘要，实际重载原包。

## 隔离与证据

运行环境：macOS arm64；Electron 33.4.11、其内 Node 20.18.3。脚本由本机
Node 25.8.1 启动。完整机器记录在
[JSON 证据](evidence/p1-panel-desktop-ipc-2026-10-12.json)。

Host 构建来源由负责构建的父任务确认是 `4083718c3e77cc6e629703231d071e646821301d`
（0.9.34）。运行时读取的 Host checkout 已到 `b99bc14d`、source package.json 为
0.9.35；**这两个 source 信息不能当作 out/dist 的构建来源。** 本轮没有构建或清理
共享 out/dist，运行前后检查以下实际字节哈希一致；完整值在 JSON。

| 产物 | SHA-256 前缀 |
| --- | --- |
| Desktop out/main/index.mjs | `9a5dccc07ac70600` |
| Desktop out/preload/index.cjs | `11fdf6200293b5fc` |
| Desktop out/preload/panel-app.cjs | `4d681ecca5a7471d` |
| Desktop out/renderer/index.html | `b6ce785cb9819757` |
| Core dist/panel-apps/installer.js | `802b06ceed09725c` |
| Server dist/panels/runtime-services.js | `2e10a8b144ae2e8f` |

启动前清除继承的 provider 凭据与 Host 配置，只保留工具链/显示/OS 会话白名单。
复用 Host 的 confined fixture、deny-all GUI HTTP guard 与 owned Electron inspector
控制；父 Node 和实际 Main 均有七项负探针回执。只有从本次精确 Electron child
stderr 观测到的 inspector endpoint 可供 Playwright 使用；不放开通用 localhost。
如果出现实际 agent worker，必须先验证该进程的 guard 回执才放行其协议输入。

所有新 Electron session 在 Main 加载前安装 HTTP(S) 请求拒绝器，包的 file/cspanel
资产仍真实加载。Mimi Download 会自动查询本地依赖/公开最新版，故在它实际优先的
私有 userData/bin 放置 curl/wget/yt-dlp CLI fixture：yt-dlp 仅回答版本，网络命令
明确失败；Host 仍执行真实发现、opaque handle、授权与进程生命周期。Quant 使用现有
隐藏生命周期抑制自动采集。不能据此声称真实行情、真实下载或模型处理通过。

macOS harness 只读取默认 Keychain 文件的元数据并在临时 HOME 写私有引用，核对原
默认没有改变；不复制 Keychain、读取用户凭据、创建/解锁 Keychain 或改变 OS 默认。
本轮不配置账号、不提交模型任务。JS HTTP 与 Chromium 请求控制不是 OS 网络沙箱。

## 验证与未覆盖范围

- `npm run check`：1954 项，1950 pass、0 fail、4 项既有可选 runtime/model skip。
- `npm run test:desktop`：6/6，包含每个包的真实暂存发布 `EACCES` 保全。
- `npm run validate`、脚本语法与 `git diff --check` 通过。

当前四组合矩阵仍为部分验收：电脑本地增加上述真实 macOS 壳层/IPC 证据；电脑云端、
手机本地、手机云端不因此升级为完整通过。实体手机、真实配对/部署、真实账号授权、
弱网/通知、完整原生媒体与模型业务、Windows/Linux 壳层和最终发布包仍需对应证据。
安装 API 验证不等同于逐一点击产品安装/恢复对话框的 UI 验收。本轮无产品源或生成包
变更、无权限/版本变化、未发布；最终版本改变包摘要后需重跑此门禁与历史迁移门禁。
