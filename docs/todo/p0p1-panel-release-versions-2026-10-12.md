# P0/P1 Panel 补丁版本准备

六个独立包各自前移版本，避免已发行 tag 的相同版本对应不同包字节。Video Studio
从 source 正常重建产物，其他包保持各自的发布格式；没有扩大 Host permissions。

| Panel | 本次候选版本 |
| --- | --- |
| Design Studio | 0.18.2 |
| Job Hunt HQ | 4.1.2 |
| Quant Lab | 0.46.2 |
| Video Download | 0.22.7 |
| Video Studio | 0.7.3 |
| Starter Panel | 0.1.1 |

候选首先以 `71770bc` 提交版本变更，再正常合入已完成的 PR #74 / #75，形成
`0754b783d31309142ff55c821ddc110fe356242f`。该组合默认 `npm run check` 为
1,988 tests / 1,984 pass / 0 fail / 4 optional skip，包含 source build-check、包校验、
旧包升级 runner 关闭故障和 Desktop runner 关闭故障回归。源 Video build 已通过。

实际 Core/Main/Hub 安装入口和 Chromium 的历史包升级／回滚七场景全部通过：
Design 0.18.1、Job 4.1.0 / 4.1.1、Quant 0.45.2、Download 0.22.3、Video 0.5.12、
Starter 0.1.0 分别升级到上表候选，回滚后再升级。包括真实旧 writer、数据迁移、
项目 A/B 保全、准确原件备份、旧 parser 再打开与资源字节保留。worker 11628 已退出，
8/8 Chromium 关闭、无 pending launch / active Browser 后才移除私密 HOME。
完整回执：[旧包升级七场景](evidence/p0p1-release-versions-upgrade-2026-10-12.json)。

独立真实 Electron gate 对全部六个候选完成 reviewed install、真实生产
Main/preload/webview/IPC 加载、项目隔离、每包真实 rename EACCES 失败保全、
明确 digest 更新与恢复。捕获的 Electron 12366 正常退出后才移除私密 HOME。
完整回执：[Electron 六包](evidence/p0p1-release-versions-desktop-2026-10-12.json)。
该夹具使用新的私密 HOME、精确网络拒绝和私有 Keychain plist 元数据约束；下载 CLI
为实际运行的合成 executable，Quant 为正常 hidden 生命周期。它不调用真实 provider。

Host checkout 的 source HEAD 为 `b99bc14d`、manifest 为 0.9.35，但本轮没有重建 Host；
冻结产物来自独立确立的 0.9.34 / `4083718c` 构建，六项实际输出 SHA256 均在回执中，
与先前 PR #75 回执相同。不能用 source HEAD / manifest 代替实际产物身份。最后保存回执
和本文的提交只增加证据文档，不改变已测试的六个包字节。

远端 Quant UI 首次在进入浏览器前因固定断言仍为 0.46.1 失败；已将准确版本断言同步
为候选 0.46.2，不放宽比较或删除 gate。该脚本变更也不改变已测试包的字节。

重跑命令（report 路径必须尚不存在）：

```sh
npm run check
PLAYWRIGHT_BROWSERS_PATH=/absolute/browser/cache npm run test:host-upgrade -- /absolute/built/codeshell/packages/server /absolute/new-upgrade-report.json
npm run test:desktop -- /absolute/built/codeshell /absolute/new-desktop-report.json
```

本次为正式发布前的版本与安装／升级验收准备，尚未创建六包 tag 或发布 assets。
完整业务的电脑／实体手机 × 本地／目标云端四组合、真实 provider、目标部署以及正式
安装包最终组合仍各自保留。这里的十三个受控场景不能代替这些验收。
