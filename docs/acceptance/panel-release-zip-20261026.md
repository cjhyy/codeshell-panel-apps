# Release ZIP/tag 本地只读核对：2026-10-26

当前状态（2026-10-27）：原 CC `3e34f601-e67b-4de4-a43f-eba9cf0283f3` 最终独立
组合验收 PASS，完整 check 52/0/0、三 ZIP equal，无 Critical / Important。
受审候选已快进合入本地 main；源码未变，未推送、未发布或执行原生验收。
以下基线与独立实施记录保留为来源历史。
基线 `84348855be8ae4e5a31936b3c2b0d1d21410bd64`，分支
`codex/panel-shared/verify-release-zip-20261026`；全部未提交。未选择六包新版本，
未改 Panel 业务/生成包、workflow、正式 tag、Release 或安装状态。

## 使用合同与包范围

```sh
node scripts/verify-release-zip.mjs --tag video-download-v0.24.1 --zip /private/video-download-0.24.1.zip --dir apps/video-download
node scripts/verify-release-zip.mjs --tag video-studio-v0.8.0 --zip /private/video-studio-0.8.0.zip --dir panels/video-studio
node scripts/verify-release-zip.mjs --tag design-studio-v0.23.0 --zip /private/design-studio-0.23.0.zip --dir apps/design-studio
```

`--dir` 是 **该 tag 内、相对于本仓根目录的安装包路径**。不是本地源目录、ZIP 内
root 参数或输出目录。仅接受 `apps/<name>`、`panels/<name>`、`templates/<name>`；
有 `panel.build.json` 的源项目必须指定对应 `panels/<name>`，不运行 builder。
CLI 仓库固定为脚本所属仓库，不接受任意 `--repo`。`repoRoot` 函数参数只供本地夹具。

包清单依据：`scripts/package-design-studio.mjs` 明确收集 `.codeshell-panel/`、
`agent/`、`app/` 与 `README.md`，不收 `src/public/native/panel.build.json` 等开发文件；
`scripts/build-panels.mjs` / `panel-projects.mjs` 将 Video 生成到 `panels/video-studio`，
并生成 `app/build-manifest.json`。Download tag 的安装目录和实际资产同为这套安装清单。
工具报告 `scope.rule` 和逐项 `excludedTagPaths`，不会忽略 `app/agent` 内业务差异。
未来 packager 改清单时应先扩展此规则和夹具，不能直接把未知打包范围称为通过。

接受平铺，或单层 `<包目录名>/` / `<panel-id>/` root，后者由 manifest 唯一定位。
真实 Download 是 `video-download/` root（44 entries，34 files），Video 平铺（41 files），
Design 是 `design-studio/` root（145 files）。目录记录校验后仅列入 `directories`，
文件逐项比较。其他 root、混入 root 外文件、多个 manifest 不接受。

`git show-ref --verify refs/tags/...` 精确选 tag，使用十六进制对象 ID 解析 commit，
再用 `ls-tree` / `cat-file` 读该 commit；不读当前工作树字节。仅 argv subprocess、
无 shell、无联网，去掉继承 Git/凭据环境并禁止 lazy fetch。缺对象时明确失败，
由操作者另行只读 fetch 准确 tag 后重试。成功 JSON 含 tag object/commit、ZIP SHA、
每文件双方 SHA/大小和 `differences`。不会回显 subprocess stderr、token 或 shell 文本。

- `equal` / exit 0：支持范围内所有安装文件 SHA-256 一致，manifest ID/version 与 tag 一致。
- `different` / exit 1：缺/多/改字节或 manifest 不同。
- `incomplete` / exit 1：tag 缺完整生成包、生成 inventory 或其引用文件/hash；列出
  `generatedIssues` 与可比较文件，缺 tag 字节的文件标为 `unverified`，不能声称完整一致。
- `error` / exit 2：参数、对象、manifest、ZIP、预算或输入变化错误，稳定错误码。

比较的是**解压后文件内容**；ZIP 容器摘要只标识下载资产，不能据此推定容器与某个
重新打包 ZIP 字节相同，也不证明源代码能生成这些包。工具不是安装器，不改正式版本。

## 只读与有限资源

复用锁文件已有 `yauzl 3.4.0`；夹具用已有 `yazl 3.3.1`。没有新依赖或 shell unzip。
ZIP 以 `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` 打开；哈希、yauzl 读取、前后 fstat 和重复
SHA 校验都用同一 fd。不 extract、不执行 ZIP 内容、不写仓库。CRC 采用现有 Video
portable bundle 同款增量算法；yauzl 负责解析和展开大小检查。少量 EOCD 检查只用于
拒绝 ZIP64/分卷，不另写通用解析器。

只支持 store/deflate、UTF-8/ASCII 原名、普通文件/目录和 `0x5455` 时间戳 extra。
明确拒绝 ZIP64、加密、bit-3 data descriptor、其他 extra（含链接元数据）、特殊文件。
这三份正式 ZIP 均没有 bit 3，central extra 仅 `0x5455`，无需扩大支持面。
拒绝穿越/绝对/反斜杠/空段/点段/冒号/Windows 保留名、尾点空格、非 NFC、重复名、
保守 Unicode 大小写别名和文件/目录冲突。校验 local/central 名字、flags、长度、CRC、
压缩类型与不重叠数据范围，流式累计实际展开字节并核对 CRC，不只相信目录大小。

| 预算 | 上限 |
| --- | --- |
| ZIP / 压缩总量 | 各 64 MiB |
| 单项压缩 / 展开 | 32 / 64 MiB |
| 展开总量 / entries | 256 MiB / 4096 |
| 展开/压缩 ratio | 200 |
| Panel/build manifest | 各 1 MiB（Video 实际 panel manifest 311686 bytes） |
| 累计元数据 | 2 MiB |
| 路径 / 单项 extra / comment | 512 / 4096 / 1024 bytes |

ZIP 内容流式 SHA/CRC，仅 manifest 有界收集；Git 每次至多收集一个 64 MiB blob，
不把整包展开到内存。测试只能降低预算，无 CLI 提高预算参数。

## 本次真实只读证据

先 `gh release view <tag> --repo cjhyy/codeshell-panel-apps --json tagName,url,assets`，
从实际 API 回执确认资产 URL/name/size/digest，再 `gh release download <tag> --repo
cjhyy/codeshell-panel-apps --pattern <准确名称> --dir <私有新目录>`。没有猜下载 URL。
三个 tag 均已在本地，无需 fetch。下载及工具原始回执保留在本任务 ignored
`artifacts/verify-release-zip-20261026/`（目录 0700），不会依赖该临时 worktree 作为长期证据。
可移交的[逐文件 JSON](panel-release-zip-20261026.evidence.json)包含 API 资产 URL、
发布摘要和工具全量回执；三份下载 SHA 与 API digest/size 均一致。

| 正式 tag | 精确 commit | ZIP SHA-256 | 内容核对 |
| --- | --- | --- | --- |
| [video-download-v0.24.1](https://github.com/cjhyy/codeshell-panel-apps/releases/tag/video-download-v0.24.1) | `09fd3bd3b0b9c6bb286b54e2f2d7c47a4ac0520c` | `2000d17bc416944e9176e8c7891cea5644d03ac0a5ae9a38354d73250bc69a4e` | 34 files / 0 differences / exit 0 |
| [video-studio-v0.8.0](https://github.com/cjhyy/codeshell-panel-apps/releases/tag/video-studio-v0.8.0) | `7850d680686d62ddc35d539319bf88353a7dc54f` | `7d21e60a3ce56549c8c21a11c7bc922705ceac1e01695a9c993b92b9035af0a8` | 41 files / 0 differences / exit 0 |
| [design-studio-v0.23.0](https://github.com/cjhyy/codeshell-panel-apps/releases/tag/design-studio-v0.23.0) | `2202581190b5b5abe3e1a8124e2a6c36a95b7e4e` | `c8e7790c87e24899aadb7fc78c8a9afe0c54b27660965d083ed421faa633a0d5` | 145 files / 0 differences / exit 0 |

这里只验现成正式包，**不是六包重新 freeze**。基线安装目录仍有同版本 tag 之后的改动，
其逐文件 SHA 对照另列在 JSON `candidateComparisons`，不冒充正式 ZIP 差异：

| 基线 manifest | 同版本 tag / 基线目录差异 |
| --- | --- |
| Design 0.23.0 | 正式 tag 存在；47 个路径变化 |
| Job 5.1.0 | 本地无 `job-hunt-hq-v5.1.0`；未声称正式 ZIP 已验 |
| Quant 0.47.0 | 本地无 `quant-lab-v0.47.0`；未声称正式 ZIP 已验 |
| Download 0.24.1 | 5 个路径变化 |
| Video 0.8.0 | 10 个路径变化；原 gate 的 5 路径假差异已确认为软链依赖环境问题，见下 |
| Starter 0.1.1 | 6 个路径变化；本轮未下载该资产 |

首次软链依赖环境下，`npm run check -- --suite release-zip` 实际 exit 1，**在跑测试之前**报
`video-studio: committed package is stale`。同步检查、插件 checks、CanvasKit、tsc 已先通过。
本任务未改任何 source/build 配置或生成物。断言的 committed(actual) / rebuilt(expected)
有 5 个路径不同：`.codeshell-panel/panel.json`、`app/build-manifest.json`、
`app/tools/editor-runtime.mjs`、`app/tools/editor-sync.mjs`、`app/tools/video-studio.mjs`。
例如 manifest 为 `f87c4081d815643fd01fca65e7b145b5946eeea29ecd1e23f4383ce9d8ecfea8`
vs `27fa187248833f422622d9c2fa3b16e6b0329087b78523aed5c8c51e9174a2ee`。
原日志 `check-release-zip.log` 原样保留。**先前据此判断已提交包过期、建议重建 Video
是错误诊断，现撤回该建议，无需重建 Video。** CC 用 `git archive 8434885` 导出两个
相同基线，在独立 `cp -cR node_modules` 副本下执行
`node scripts/build-panels.mjs --check --app video-studio` exit 0、deterministic matches；
软链依赖下 exit 1、同样 5 路径差异。此受控对照由 CC 独立执行，本任务没有重复导出基线。
原因是 esbuild 解析软链后的真实模块路径改变生成的模块注释，并连带改变摘要清单；
不是已提交生成包过期，也不能与上表真实 tag 目录差异混为一谈。

2026-10-26 I1 整改：确认 `node_modules -> ../../node_modules` 是本任务先前创建的
临时软链，仅 unlink 链接本身，未删除或改写目标；随后用 `/bin/cp -cR` 从 Panel 主
checkout 的 `node_modules` 克隆到本 worktree。目标现在是普通目录，代表依赖文件
字节相同但 inode 不同，不共享可写依赖。隔离 HOME/XDG/TMPDIR、清空继承凭据并以 npm
offline 重跑完整前置门禁加指定 suite：`npm run check -- --suite release-zip`
**exit 0，52 pass / 0 fail / 0 skip**；Video 明确输出
`deterministic, committed package matches source`。没有执行生成包更新。
新日志为 `artifacts/verify-release-zip-20261026/i1-independent-dependencies-20261027/check-release-zip-independent.log`，
SHA-256 为 `e7f9b736a8733b2c0f4a2f8b33b4bf7eaa02812f2370737a06cc02cb7d47618e`；
同目录 `dependency-clone-receipt.json` / `check-receipt.json` 保留精确命令、UTC、环境与
退出码。工具/测试/suite/CONTRIBUTING/package/lock 的保护 SHA 未变，
`git diff --name-only HEAD -- apps panels templates` 前后均为空。当前 JSON 的
`verificationTool.check` 记录整改后结果，`checkHistory` 保留旧失败及诊断更正。

## TDD 与可重复验证

Node 25.8.1 / npm 11.11.0；首次使用的 ignored `node_modules` 软链已在 I1 整改中
替换为本 worktree 独立 clone，后续 check 不再软链复用依赖；没有安装新依赖或应用。
所有 suite 子进程使用新 HOME/XDG/TMPDIR，父环境
以白名单重建，不继承 provider 凭据；npm offline 且关闭更新提示。执行形式如下：

```sh
python3 - <<'PY'
import os, tempfile, subprocess
from pathlib import Path
guard = Path(tempfile.mkdtemp(prefix="panel-release-guard-")).resolve()
for name in ["home", "config", "cache", "data", "tmp"]:
    (guard / name).mkdir(mode=0o700)
env = {"PATH": os.environ["PATH"], "HOME": str(guard/"home"),
       "XDG_CONFIG_HOME": str(guard/"config"), "XDG_CACHE_HOME": str(guard/"cache"),
       "XDG_DATA_HOME": str(guard/"data"), "TMPDIR": str(guard/"tmp"),
       "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
       "npm_config_offline": "true", "npm_config_update_notifier": "false"}
for args in [["npm", "test", "--", "--suite", "release-zip"],
             ["npm", "run", "validate"],
             ["npm", "run", "check", "--", "--suite", "release-zip"]]:
    result = subprocess.run(args, env=env)
    print(args, "exit", result.returncode)
PY
git diff --check
```

| 检查 | 结果 / 原始日志 |
| --- | --- |
| 实现前红灯 | 46 fail / 0 pass，缺工具模块；`tdd-red.log` |
| 第一轮实现 | 44 pass / 2 fail（测试 CLI 路径解码、过小 metadata 预算分类）；修正后 46/46 |
| 只读审阅发现的 partial-generated / Unicode 冲突红灯 | 2 fail / 0 pass；`tdd-scope-red.log` |
| 最终 `npm test -- --suite release-zip` | 52 pass / 0 fail / 0 skip；`tdd-confirmed.log`（此前 `tdd-delivery.log` 亦 52/52） |
| `npm run validate` | 六包及既有包 smoke 通过，exit 0；`validate.log` |
| 首次 `npm run check -- --suite release-zip`（软链依赖） | exit 1，后续 suites 未运行；`check-release-zip.log` 原样保留，I1 已确认是模块路径注释假差异 |
| I1 整改后同一 check（独立依赖 clone） | exit 0；前置同步/插件/CanvasKit/types/确定性包检查通过，52 pass / 0 fail / 0 skip；`i1-independent-dependencies-20261027/check-release-zip-independent.log` |
| `git diff --check` | 通过 |

没有运行全量领域/UI/media/真 Host suite：本次只改只读脚本、测试目录登记和交接文档；
I1 整改已通过完整前置检查，但只选择 release-zip suite，不声称全量 suite 已跑。
52 项包括一致/多缺改、真实两种布局、生成包/缺失/
部分缺失、manifest ID/version、精确 annotated tag 与同名 branch、路径/大小写/链接/
special/DOS label/CRC/local header/extra/ZIP64/descriptor/预算、伪报展开大小和 ZIP 源链接。
有限夹具用 yazl 生成，没有执行 ZIP 内代码。

## 2026-10-27 组合候选回执

目标分支 `codex/panel-shared/release-zip-integration-20261027`，基线
`d15a35bec1910c0a55be7b737a5343314635d4a2`；包含该本地主线已有独立工作。
仅转入原批 4 六个交付文件。历史 `8434885` 目录比较保留原测量，未冒充新候选比较。

依赖由来源的普通 `node_modules` 经 `/bin/cp -cR` 克隆，目标为普通独立目录，
source/target inode 不同；没有依赖软链或可写 dist 链接。以本文件上述白名单配方隔离
HOME/XDG/TMP、清凭据、npm offline，串行执行 `npm run check -- --suite release-zip`：
**exit 0、52 pass / 0 fail / 0 skipped**。完整前置同步、类型与确定性生成包检查通过，
没有更新 Video 生成包；`git diff --exit-code HEAD -- apps panels templates` exit 0。

在同一隔离环境中用本候选 verifier 只读指向来源已有三个 ZIP，使用本文真实 tag/dir
命令；没有复制或下载 ZIP。重新核对 Download / Video / Design 分别 **equal、34 / 41 /
145 files、0 differences**，ZIP 摘要与原记录一致。机器可读精确 tag commit、摘要与
回执摘要已追加到 evidence JSON 的 `integration20261027`，没有重写历史字段。

本轮全部日志、精确 argv、UTC 与依赖克隆回执在本目标 ignored
`artifacts/release-zip-integration-20261027/`；check 日志为
`check-release-zip.log`，三个只读 JSON 回执为 `<panel-id>-verification.log`。
候选冻结阶段仅提交供最终 CC review，不选择版本、不运行远程验收或正式安装、不发版。
该阶段的来源保护与等待 resume 状态保留为历史；当前交付见下节。

## 最终 CC PASS 与本地合并交付

2026-10-27，主代理转交原 CC 最终独立组合验收 PASS：本仓完整
`npm run check -- --suite release-zip` 为52/0/0，三真实 ZIP equal，无 Critical / Important。
刷新 origin 后仍为 `84348855be8ae4e5a31936b3c2b0d1d21410bd64`；合并前 root clean、main 为
`d15a35bec1910c0a55be7b737a5343314635d4a2`，已实际执行
`git merge --ff-only c6dbba4272a7e15de58c46a0624e774c17264aed` 并成功快进本地 main。
基线包含5个其他本地提交，全部保留，因此未 push 任何分支。

本节仅在任务分支提交后再快进 main；最终 main/文档提交 SHA 见外部交付报告。
与受审候选相比只改本文，工具、测试、suite、历史 evidence JSON、apps/panels/templates
均不变，不重复 check，不重建生成包。旧 evidence 的 `integration20261027` 保留为受审
冻结回执。集成 worktree 待主代理退出后处理；dirty 来源 worktree、三个真实 ZIP 与
原始日志/核对回执继续完整保留，未 checkpoint 或清理，未发版或做正式安装验收。
