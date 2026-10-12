# 六 Panel 旧包安装、数据升级与回滚验收

本记录补充 [P1 发布审计](p1-panel-release-audit-2026-10-12.md) 中的升级回滚缺口。
验证对象是仓库内真实历史安装包、当前候选安装包、真实 Core 安装器和真实
`PanelRuntimeServices` 临时磁盘项目。合成数据由对应旧版的领域模块生成或校验，
没有访问私人项目、真实账号、在线下载、模型或付费服务。

这是电脑本地的受控集成证据。除 Starter 外，数据路径调用已安装包内的领域模块；
Video 的旧模型/存储和当前迁移模块从对应包的同一源码修订构建，当前持久化走
真实 Host 授权的 workspace fallback。旧模型与 store 源码还与实际安装 main.mjs
内联 source map 的原始内容逐字节核对。它不覆盖 Desktop iframe/IPC、原生
`media.document` 后端、服务商、实体手机、真实配对或已部署 Cloud，也不将这些
组合标为完成。

## 可复验入口

```sh
npm ci
npx playwright install chromium
npm run test:host-upgrade -- /absolute/path/to/codeshell/packages/server /tmp/panel-upgrade-report.json
```

需要同一 Host checkout 已构建的 server 与相邻 core 包，以及以下历史 Git 对象。
可在运行前获取 Git 历史与 tags；门禁自身不联网。报告路径可选、只允许新建，
记录完整 64 位 packageDigest、历史提交、候选提交、版本、权限增减和逐项覆盖，
并记录实际 Host runtime/Core installer 入口文件的 SHA-256。Host checkout 的
HEAD/manifest 单独标注，不把它们冒称为现有 dist 的构建出处。
临时 HOME、安装目录、项目、Host dataDir 和 Chromium profile 在结束时删除；只
保留指定报告与调用者重定向的日志。子进程不继承 provider 凭据；JS fetch、
HTTP/HTTPS/net/tls 入口被禁止。Chromium 页面请求全部本地截获，现有浏览器
缓存只用于读取可执行文件。这不是操作系统级网络沙箱。

| Panel | 真实旧包来源 | 旧包提交 | 当前候选 |
| --- | --- | --- | --- |
| Design Studio | `design-studio-v0.18.1:apps/design-studio` | `14c9a1819794d7db6ad3d6cbc2df53ec5cfd9f42` | 0.18.1，安装字节不同 |
| Job Hunt HQ | 历史 4.1.0 `apps/job-hunt-hq`；另跑 `job-hunt-hq-v4.1.1` | `4929f80e0e2ae14945fe0533df3bd948f29ccf6e`；`14c9a1819794d7db6ad3d6cbc2df53ec5cfd9f42` | 4.1.1，安装字节不同 |
| Quant Lab | `quant-lab-v0.45.2:apps/quant-lab` | `e99f57c0350c28b41d134dec2e06bd4f76f89c00` | 0.46.1 |
| Mimi Download | `video-download-v0.22.3:apps/video-download` | `a4cab15f1542b606607fe81296db8a9d0b35759c` | 0.22.6 |
| Video Studio | `video-studio-v0.5.12:panels/video-studio` | `2149c34087c5e692abe10ba36fa4082d7a416a34` | 0.7.2 |
| Starter | 历史候选 `57703cbb:templates/starter`，没有发布 tag | `57703cbb75ed44dce004215ad7075480c289becb` | 0.1.0，安装字节不同 |

4.1.0 和 Starter 只称历史仓库包，不冒称公开发行资产。Video 使用 tag 指向的
commit，区分 annotated tag 对象自身的 SHA。脚本固定这些完整提交并核对 tag
解析结果；后续候选版本从当前 manifest 读取，表格是本次运行的版本记录。

## 每份包的实际生命周期

1. 从固定 Git 提交提取旧安装包，通过真实 `previewLocalPanelApp` 与
   `installReviewedLocalPanelApp` 审阅并安装到临时 HOME。
2. 两个临时项目分别绑定旧包的 version/packageDigest。旧项目数据通过真实
   Host storage/workspace 写入，旧模块重新读取并校验。
3. 在相同安装源路径换入当前候选；旧 reviewToken 被拒绝。重新审阅才可更新，
   包字节、版本与权限回执对应。全局安装更新后，两个项目仍选旧 digest。
4. 只把 A 项目的显式 pin 切到候选。旧 scope 的存储访问被拒绝；候选按自己的
   已审阅权限进行迁移、条件保存与重启读取。更新安装权限不等于自动升级所有项目。
5. 归档升级后的内容，按下表恢复旧数据，再从同一 reviewed update 路径安装
   原始旧包。digest 必须与第一次旧安装完全一致，旧解析器重新读取原数据。
6. 再次更新到相同候选 digest，检查升级内容归档仍可读。旧/新包都保留在真实
   package store；卸载后保留字节不会赋予项目运行权限。

安装、更新、项目 pin 与包保留使用真实 Core；数据读写使用真实 server。
数据 scope 在每次调用时检查实际项目 pin 和安装 registry，启动时通过真实
package resolver 核验安装字节。测试没有伪造存储回执或以内存 Map 替换磁盘。

## 数据验证与回滚语义

| Panel | 已覆盖的数据与故障路径 | 此处回滚后保留什么 |
| --- | --- | --- |
| Design | 旧 v3 两页/矩形/PNG 资源分块；候选编辑；旧 revision 写入被拒绝；资源字节哈希不变 | 活动设计恢复到原文；升级设计独立归档，旧解析器也能解释同格式的新设计 |
| Job Hunt | 真实旧 4.1.0 与 tag 4.1.1 A/B writer 生成的大快照；问题素材、职位、简历、版本与未知扩展；新独立分片；第二个新分片写入前注入中断，首片实际落盘而原根/旧读者保持；完整备份根及旧分片逐字节一致 | 原始根和旧分片；旧模块明确拒绝新分片格式。升级快照通过真实完整备份归档，不能承诺旧面板直接解释它 |
| Quant | 旧引擎生成的固定数据/回测结果；实际旧 app 的 scoped key；参数与长期关注 CAS；未知关注扩展；旧账本模块实际写入现金记录；候选追加现金与重启 | 参数/关注/账本及派生缓存恢复原值，升级设置与两笔账本独立归档；旧账本解析器可解释同版本追加记录 |
| Mimi Download | 旧 serializer 写入 v2 队列/历史/实际存在的合成文件；旧 storage.set 到候选 CAS；竞争写拒绝；运行中记录转 interrupted 并暂停；不复用旧目录 handle；文件路径与字节不变 | 原队列和历史恢复，升级库留在独立 storage 备份 key。0.22.3 不含 durable native task 标识，测试不虚构或重启下载任务 |
| Video | 真实旧 0.5.12 模型生成 demo 工程，并由同修订旧 store 保存到 Host；候选 v1→v2；精确 v1 不可变备份；v2 workspace CAS/历史/归档；旧 store 遇 v2 拒绝覆盖 | 旧 fallback key 从未覆盖；旧包读原 v1。v2 索引/数据块和升级归档保留，再升级恢复 v2；不把 v2 直接降级解释为兼容 |
| Starter | 实际旧/新 installed entry 在 Chromium 内读取经项目选择校验的 context 并点击计数；更新/回滚后重复 | 模板没有持久业务数据；只核对安装与交互生命周期，不创造数据迁移场景 |

合成下载文件只验证已有文件没有被升级/回滚修改，不代表来源下载、目录授权、
resource custody 或媒体完整性已验收。Video 使用旧版官方 demo 数据，不覆盖
所有真实摄像/录屏、复杂 v1 多轨及媒体资产迁移；已有 0.5.16 合成 fixture 和
独立 UI/media 测试仍保留其各自范围。

## 运行记录与剩余验收

本轮使用 Panel 候选 `a7324da` 的安装字节、Host `4083718c` 构建的 0.9.34
server/core、macOS arm64、Node 25.8.1、Chromium 148。提供产物的联合发布任务
确认这些 dist 未被后续 fetch/merge/push 改写；Host 源码 checkout 已推进到
`dbd549dd`/0.9.35。因此报告中的 checkout 版本表示当时源 manifest，实际使用
的编译产物按入口文件哈希和上述构建出处记证。

本次 `test:host-upgrade` **7/7 场景通过，覆盖全部六 Panel**；默认 `npm run check`
通过（1,954 tests / 1,950 pass / 0 fail / 4 既有 optional skips），
`node scripts/validate.mjs` 通过。源码与生成 Video 包的确定性检查也在默认门禁中
通过；本次只增加验收脚本/记录，不修改安装包、权限或版本。

完整原始结果保存在 [JSON 包摘要报告](evidence/p1-panel-upgrade-rollback-2026-10-12.json)。
其中记录的是本轮受验的 `a7324da` 安装字节；本文和脚本的后续提交不改变包字节。
报告记录的实际入口摘要为：

- Host runtime：`2e10a8b144ae2e8fd2f8e2ce16165a9081db5c6c4e3d1213eb59def56872314e`
- Core installer：`802b06ceed09725c3b4c2340da52be6a7de28cb122785bdb4b3365a1ad137c4e`

六 Panel 的电脑云端、手机本地和手机云端还需要目标部署/真实配对/实体手机的
同版本执行记录；电脑本地也仍需 Desktop 壳层、原生后端及完整真实业务的安装
升级回滚验收。真实账号/通知、弱网、服务商、外部目录授权、实际媒体/模型任务
仍是外部验收项。本门禁通过后仅补强受控集成 C 的证据，不将四组合的 P/R 改为
已完成，也不自行 bump、tag 或发版。
