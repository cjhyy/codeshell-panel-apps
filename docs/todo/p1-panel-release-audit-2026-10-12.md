# P1 六 Panel 发布审计：2026-10-12

本轮基于 Panel `aabba34`，负责工程收尾，不把源码、窄屏 Chromium 或临时 Host
存储检查等同于六 Panel 四组合的全部业务验收。版本提升、正式资产发布和已安装版本
核验由本轮联合发布完成后补记；本文不将未发布内容标为已上线。

## 本轮修复

Design Studio、Job Hunt HQ、Quant Lab 原先只按 `cwd` 和 `sessionId` 换代。
可信 Host 的 `projectScope.environmentId/projectId/rootId` 改变而路径和会话不变时，
旧页面可能继续保留原工程、草稿或迟到回执。本轮三个 Panel 一并比较完整版本 1
项目证明、Host 类型及 Panel ID；身份变化或完整证明丢失时切换到新项目代次。
项目切回后重新读取原项目，不让旧在途操作跨代继续。

- Design 在身份变化时取消手势、保留旧恢复草稿、清理原文档与资源缓存，再读取
  新项目。迟到的恢复写入回执不能更新新画布。
- Job Hunt 同样重新加载新项目自己的草稿、账号、文件和后台任务。完整上下文
  事件不再继承已撤销的旧字段；发现期间较新的事件优先于迟到的初次读取。
- Quant 的暂存回测参数也按完整执行身份区分，避免同路径同会话的新项目复活旧
  参数。新下载备份携带项目证明；已知属于另一项目的同路径备份拒绝导入。旧备份
  沿用既有的显式导入流程，仍需路径匹配，不能据此推断它有可信身份。

Host 项目存储键、项目数据格式、权限和已接收任务归属不变。三个 app/ 都是直接
安装的源码；`shared/project-context.mjs` 通过同步脚本复制到各自包内，默认门禁
检查三份字节一致。Video 的生成安装包保持确定性匹配；本轮未改动 Video 源码。

## 四组合矩阵

每格依次表示 **I 实现 / C 受控验证 / P 真实客户端与部署 / R 本轮发布**。
`△` 表示只有下方列出的部分路径证据；`待` 表示未取得该组合所需的完整证据。
手机的 P 必须来自实体手机，电脑云端的 P 必须来自实际部署；手机本地还需真实
配对链路。`C△` 不代表真实 Relay/Hub、全部业务或逐服务商已通过。

| Panel | 电脑本地 | 电脑云端 | 手机本地 | 手机云端 |
| --- | --- | --- | --- | --- |
| Design Studio | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 |
| Job Hunt HQ | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 |
| Quant Lab | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 |
| Mimi Download | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 |
| Video Studio | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 |
| Starter | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 | I△ / C△ / P待 / R待 |

这里的 C 是复用相同方法的隔离 Host 契约与浏览器入口验证，尚无逐个真实组合的
同版本整套用例运行记录，因此没有一格标为完整通过。历史发布与桌面验证保留其
原日期、版本和范围，不自动覆盖本次候选。

| Panel | 已有实现与本轮可直接复验的部分 | 完整组合仍须取得的证据 |
| --- | --- | --- |
| Design Studio | 真实 Chromium 编辑、窄屏触控/取消、并发恢复、完整/旧备份、新文件恢复、迟到 Agent/HTML/资源/导出保护；真实 Host 临时磁盘恢复与跨目录便携设计 | 已安装候选的 Agent/HTML/资源业务、真实配对/Cloud、实际触摸设备与完整升级回滚 |
| Job Hunt HQ | 草稿/快照分片、旧根迁移、迁移前备份/失败重试、恢复 UI、MD 下载、PDF/语音任务契约、自动化条件写入；真实 Host 临时草稿并发/重启/撤权 | 实际 PDF/语音完整业务、招聘账号授权/定时发现、实体手机及目标部署、旧版本降级复核 |
| Quant Lab | 参数/数据源/关注 CAS、冲突草稿与重读、项目隔离、原生程序/提醒契约、320/390px 保存报告与策略 | 真实行情/模型/自动化与通知、实体手机弱网、全部研究/账本数据升级与旧版本回滚 |
| Mimi Download | 版本化项目存储、执行身份/会话隔离、后台下载/恢复、队列/媒体库/账号/搜索契约 | 逐真实来源下载与登录、实际目录授权/原生运行时、配对/Cloud端到端、旧队列与文件格式升级回滚 |
| Video Studio | 工程迁移/CAS/恢复、录制能力、独立任务、精确媒体时长、编辑/导出/工程交换的已有领域和 UI/media 套件 | 实际摄像头/录屏权限、完整模型处理/云端渲染、实体手机与实际部署；完整安装升级回滚 |
| Starter | 早订阅/迟到上下文、连接失败恢复、320/390/768px 触控尺寸与长路径、本地点击交互 | 已安装候选在四组合的上下文展示、断线重连与真实设备验证；模板不含 Agent 提交流程 |

## 本轮直接证据

运行环境为 macOS arm64、Node 25.8.1、npm 11.11.0、Chromium 148，不冒充 Ubuntu
Node 20/22 CI 或实体手机。下列测试仅使用合成数据与隔离目录，没有安装到个人项目、
读取真实业务账号或付费调用模型。

```sh
npm ci
npx playwright install chromium
npm run check
node --test tests/project-context.test.mjs
node --test tests/apps/quant-lab/execution-binding-ui.test.mjs \
  tests/apps/design-studio/recovery-ui.test.mjs \
  tests/apps/job-hunt-hq/draft-ui.test.mjs
npm run validate
npm run test:ui:quant-lab
npm run test:ui:quant-lab-storage
npm run test:host-storage -- /absolute/path/to/built/codeshell/packages/server
```

- 最终默认检查通过：1954 项，1950 pass、0 fail、4 项既有可选运行时/模型 skip。
  包含六 Panel 已定义的离线门禁、真实 Chromium 领域套件、类型、共享文件一致性和
  Video 确定性安装包检查；并不包含全部独立 UI/media/fidelity/PDF CI job。
- 三个受影响实际页面套件通过 87/87，新增同路径同会话跨证明回归均通过。
  共享身份校验 4/4；`npm run validate` 全部包校验通过。
  随后补入初次空绑定事件的初始化回归，求职完整草稿 UI 43/43 及最终默认门禁通过。
  相同三个新用例在独立临时目录的原始 `aabba34` 源码上均未通过（2 fail、1
  timeout/cancelled）：Design 未换画布，Quant 未加载新参数，Job Hunt 等待旧读取时
  未重载新项目；基线验证未改动当前测试工作树。
- Quant 完整 UI smoke 与独立双设备数据源存储 UI 均通过，包含草稿下载、读取失败
  恢复、未知写入回执只读核对、项目隔离及旧 Host 提示。
- 真实 Host 使用本轮 P0 从 `4083718c` 构建的 server 包（版本 0.9.34）。三个
  `PanelRuntimeServices` 检查全部通过：Design 磁盘并发恢复/重启/撤权/条件删除，
  Design 完整和旧备份/基线校验/源目录删除后恢复/冲突不覆盖，Job Hunt 竞争写入/
  同路径不同 runtime/独立 writer 备份/重启/撤权。包装器给每个子进程临时 HOME
  和 TMPDIR，只传 PATH/LANG、不传 provider 凭据，并禁止 JS HTTP/HTTPS/fetch
  与网络连接入口。它不宣称操作系统级网络沙箱或 Hub/Relay 业务已验收。

## 数据兼容与回滚边界

后续已补 [六 Panel 旧包安装、数据升级与回滚验收](p1-panel-upgrade-rollback-2026-10-12.md)：
真实 Core reviewed install/update、项目精确 pin、真实 Host 临时磁盘以及旧/新领域
模块的 7 个旧包场景全部通过。它补强电脑本地受控集成 C；Desktop 壳层、原生
media.document、实体手机、实际配对和 Cloud 仍未取得完整证据，因此上方四组合
矩阵不提升 P/R，也不把完整业务升级回滚标为结束。

| Panel | 已有兼容和恢复证据 | 本轮回滚含义 |
| --- | --- | --- |
| Design Studio | 旧草稿 v1、save-as v2、分页/资源备份恢复为新文件，失败不覆盖目标 | 本轮只增加执行身份检查，不改项目格式；回退代码会失去新增隔离保护。旧面板对不支持的恢复格式保留原数据；不能用旧面板解释新格式 |
| Job Hunt HQ | v1/旧 A-B 分片迁移前逐字节备份、根条件提交、回执丢失/冲突/失败恢复 | 新分片根索引要求兼容面板；降级先停写并备份，恢复 migration backup 的 previous-root 与引用分片会回到迁移前内容，不能承诺保留升级后的编辑 |
| Quant Lab | 原配置/关注 key 与 JSON 扩展字段保持；新回测备份增加可选项目证明 | 不改变 Host 项目格式；旧备份仍可显式导入。旧代码不会核对新增证明，因此不宜跨项目导入；全部研究和账本的跨版本回滚仍待完整验收 |
| Mimi Download | 原存储 key/JSON 和下载资源引用保留；冲突与未知写入结果停止自动重放 | 本轮无格式变更；完整旧队列/媒体文件/权限升级与降级仍需真实安装记录 |
| Video Studio | 旧 0.5.16/v1 工程确定性迁移、原稿保全、归档恢复、便携包哈希校验 | 旧版本不能直接解释全部 v2 特性；保留原稿/媒体与兼容归档再降级。完整已安装候选的升级回滚仍待 |
| Starter | 无持久业务数据 | 需核对安装更新/权限审阅；无数据迁移 |

发布前应保留每个候选包及 SHA-256、精确 Host/Services/Panel 修订、更新权限审阅
和目标部署恢复记录。真实账号、实体手机、弱网/通知与四组合完整旧数据验收仍是
P1 未完成项；发布修复包不能把这些剩余项改为已完成。
