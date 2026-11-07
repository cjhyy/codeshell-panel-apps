# Design Studio 真实 Host 隔离验收脚本准备（2026-11-07）

**状态：脚本已部分就绪（partial-ready），尚未执行。** 本轮只写了 harness、纯函数和单元测试。没有启动 Electron 或任何 GUI 窗口，没有构建 Host、安装 Panel 或下载 runtime，也没有执行 `--design-studio-fidelity` 入口。下文的场景结论都**没有运行过**，不能当作验收结果。目标没有完成。

- 分支 `codex/design-studio/fidelity-host-harness-20261107`，base `f7425666`，包含 9 轮 production 修复和 SVG 审计。
- 已读 CODESHELL.md、CONTRIBUTING.md（npm）、`scripts/check-panel-desktop.mjs` 及其 cleanup/native helper、R009 和 SVG 语义审计文档。Host 源码只读。
- 只改了本仓库的 tests、scripts 和 docs。没有改 production renderer、Host、其他 Panel、lock、已安装包或用户设计，没有写共享账本，没有 push、merge、PR 或发布。
- 依赖用独立的 `npm ci --cache .tmp/npm-cache --prefer-offline` 安装，exit 0。node_modules 是真实目录，不是 symlink。TMPDIR 设为仓库外的 `/tmp/ds-host-harness-tmp`。

## 获得窗口许可后要运行的命令

运行前由主代理通过 AskUser 取得用户对“打开真实 Host 窗口”的明确许可。CLI flag 只是技术上的 opt-in，不代表用户许可；也没有任何环境变量能开启它或代表许可（单元测试会验证这一点）。

```sh
# 1. 先在获授权的 Host checkout 里另行构建（本脚本绝不代为构建、下载或安装）
# 2. 第三轮复审起（breaking，仅影响本 opt-in）：fidelity 不再接受报告路径。
#    报告和截图 bundle 由 harness 在 root-owned 的系统临时目录里自行创建，启动时打印路径
node scripts/check-panel-desktop.mjs /absolute/path/to/built/codeshell --design-studio-fidelity
# 可选：显式传入一份真实样本（只读：记录 SHA 前后，复制到临时 project，原件不动）
node scripts/check-panel-desktop.mjs /absolute/path/to/built/codeshell --design-studio-fidelity \
  --design-studio-sample /absolute/path/to/sample.codesign.json
```

- 打开 flag 后只跑 `--app design-studio`；传入其他 `--app` 或报告路径都会报错。原有不带 flag 的 Desktop 检查仍然接受 `[new-report.json]`，行为不变。
- 输出：`/private/tmp/ds-host-fidelity-<时间>-<随机>.report.json` 和 `.artifacts.bin`（Linux 为 `/tmp`）。bundle 是按顺序拼接的 PNG；报告里的 `designStudioFidelityOutputs.artifacts` 记录每张图的 `label/offset/length/sha256`，按 offset 和 length 切出即可，切出后的 sha256 应与记录一致。
- 退出码：
  - Host preflight 缺件：2，此时还没有创建临时 HOME，也没有启动任何进程；
  - 通用 Desktop 断言失败：沿用原有行为；
  - fidelity 判为 FAIL：1；
  - 存在 UNVERIFIED、EVIDENCE_ONLY 或未运行的场景：3；
  - 所有场景 PASS：0。由于视觉场景最多只能判 EVIDENCE_ONLY，按当前设计实际上**不可能得到 0**，这是有意的：视觉结果必须人工复核。
- 不传 flag 时，原 `npm run test:desktop` 的行为不变，只多了一步只读 preflight：缺件时明确报出路径并 exit 2，原来是 ENOENT 崩溃。

## 真实 Host 前置条件现状（只读探测，未修复）

2026-11-07 对主 Host checkout `/Users/admin/Documents/个人学习/代码学习/codeshell` 调用了只读的 `preflightPanelDesktopHost`。它只做 stat 和 resolve，不是执行入口；结果在 `.tmp/host-harness/preflight-main-host-readonly.json`。

| 项 | 现状 |
| --- | --- |
| Host 源码 HEAD | `96bf771ca4639e01dd0b0fe1b49b97822626e39a`（2026-11-06 23:41 +0800），desktop `package.json` 为 0.9.52，工作区干净 |
| `packages/desktop/out/{main,preload,renderer}` | 存在，mtime 为 Nov 4 19:33 |
| `packages/core/dist`、`packages/server/dist` | 存在，mtime 为 Nov 6 15:02 |
| `packages/desktop/out/managed-runtimes/node/bin/node` | **缺失**，preflight 结果为 `ok:false` |
| Electron | 存在，`packages/desktop/node_modules/electron` 为 33.4.11，含 dist |
| preflight 警告 | core 和 server 的 dist 比 desktop `out/` 新，Desktop `out/` 可能陈旧 |

结论：用当前主 checkout 跑会在 preflight 阶段 exit 2，不会启动任何进程。要运行，需要另行授权构建一个完整且自洽的 Host（包括 managed runtime），并独立记录它的构建 commit；源码 HEAD 和版本号不能证明 `out/` 是用哪份源码构建的。本脚本不会触碰、构建或修复主 checkout。

## 实现概要

| 文件 | 作用 |
| --- | --- |
| `scripts/design-studio-host-fidelity.mjs` | 纯模块，无顶层副作用，不 import electron、playwright 或 child_process。包含：参数解析和 opt-in 闸门；只读 preflight；样本复制；网络 allowlist；合成 fixture；各场景判定；报告汇总；create-only 输出检查 |
| `scripts/design-studio-host-fidelity-runner.mjs` | 只在 Electron 里执行的步骤。它接收现有 harness 已经拥有的 guest 和 Electron app 句柄，自己不启动任何进程 |
| `scripts/check-panel-desktop.mjs` | 最小扩展。改用共享的参数解析器；preflight 和 create-only 检查放在 `mkdtemp` 之前；fidelity 使用独立的私有 project `desktop-fidelity`，fixture 在启动前写入；场景在原有 owned-cleanup 的 `try/finally` 里执行，位于 design-studio 的 CanvasKit 检查之后、通用 update/restore 之前 |
| `tests/design-studio-host-fidelity.test.mjs` | 33 项单元测试（复审返修后），已登记到 `tests/suites.mjs` 的 `desktop-harness` 套件 |

沿用的现有隔离：私有 mkdtemp HOME、CODE_SHELL_HOME 和 userData，并断言 Electron `app.getPath`；生产 Main/preload 的审阅式安装 IPC；Node HTTP guard；每个 Electron session 都取消 HTTP(S)；NativeEntry 和 managed Node 走 macOS deny(network*)；只向捕获到的 ChildProcess 发信号，确认其退出后才删除 HOME。

fidelity 新增的参照窗口是 owned 的隐藏 `BrowserWindow`：`show:false`、`javascript:false`、`sandbox:true`，使用独立 partition，只允许 `data:`、`blob:`、`about:`，其他请求（包括 `file:` 和 http）全部 cancel 并记录下来，最后在 `finally` 里 destroy。

fixture 是合成的，不复制任何个人稿。字节就是**本仓库 `apps/design-studio/app/document.mjs` 的 canonical 序列化**，与 reviewed install 复制的源码相同，单元测试会验证 `serialize(normalize(bytes)) === bytes`。全部 fixture 只有一页，因为通过 `#active-page` 切换页面会把文档标成 dirty。

| fixture | 内容 |
| --- | --- |
| legacy-receipts | Latin 和 CJK 的旧 hanging receipt：签名里缺少 `line-box-v1` 标记，用 codec 的 `currentTextMetrics` 实测返回 null（即已失效）；有限 offset 5.25 和 0 的有效 receipt；`textFlow:"wrap"` 的旧 receipt；auto-layout 中 `layoutSizingHorizontal:"hug"` 的文字；无 receipt 的 line-box 文字 |
| interaction | `underlay`、`move-target`（绘制在其上方）、`edit-target` 文字 |
| rotation-strips | chevron 由 ±45°、9.6×1.12、r0.56 的灰色细条组成；`>_` 由 ±40°、r0.595 的细条加 `>_` 文字组成；按钮文字 `Continue 继续`（hug）；finite offset 3.5 样例 |
| svg-corner-aa | 两组，按审计中 4 个 FAIL 行的作者几何复刻：1.26×7.2 @ (28.3, 303.4) 和 7.2×1.17 @ (27.4, 97.3)，颜色 `#686e67`，背景 `#f3f4f1`。另一组 x 偏移 120 |
| large-text | 1200 个真实 text 节点，Latin/CJK 混排，字号 12–14，x、y 都带小数相位。逻辑文档 771,985 bytes，超过 Host `workspace.readText` 的 480 KiB，因此用已安装的 index codec（`createDesignIndexPersistencePlan`）写成 manifest（616 bytes）加 2 个页面分片（368,640 和 292,700 bytes，均 ≤360 KiB），见下文 I2 |

## 场景、观测与判定

判定规则：PASS 必须有具体的测量证据。缺少观测或只有一个布尔值时判 UNVERIFIED。性能和视觉没有获批的数值预算，最多判 EVIDENCE_ONLY，不会自动 PASS。汇总里 `goalComplete` 恒为 false。

| # | 场景 | 真实操作与观测 | 判定 | 已知缺口 |
| --- | --- | --- | --- | --- |
| 1 | open-without-edit | 通过 `#open-files` → `#files-dialog .file-row` 真实打开文件；之后不做任何输入，在 ≥2.2 s 内每 250 ms 采一次 `#save-state[data-kind]` 和文本；比较启动前（seed）和之后的文件 sha256、mtime、size；用已安装 codec 记录旧 receipt 是否仍然失效 | 字节、mtime 或 size 变化，或出现 dirty、error、保存中，判 FAIL；观测时长 <2000 ms 判 UNVERIFIED | Host storage 中的 lastPath、recent、recovery 写入不是设计文件字节，不在门禁内 |
| 2 | immediate-click-after-edit | (a) 用 `webContents.sendInputEvent` 真实拖动 `move-target` 到 `underlay` 上方，然后立即点新位置、旧位置和只有 underlay 的区域；(b) 在 inspector 的 `#prop-x` 里输入 120，立即点新、旧位置；(c) 选中文字后按 Enter，用 `insertText` 输入，按 Cmd/Ctrl+Enter 提交，立即点击。选中结果读自 `#layers-list .layer-row[aria-selected=true]` 的 `data-id` | 实际选中与预期不符判 FAIL；提交后到点击 >250 ms、没读到 DOM 选中、或几何没有变化，判 UNVERIFIED。只拿到 engine 的 hitTest id 不算证据 | GPU scene 重建的时序本身不可观测；hitTest 是对缓存几何的同步计算 |
| 3 | low-zoom-fractional-performance | 打开 1200 文字 fixture；用 Ctrl+wheel 缩到 0.3711（以光标为锚的缩放会产生小数 pan）；再做 30 次 wheel pan。真实帧间隔来自 guest 里由测试注入的 rAF 记录器；CPU 时间来自 CDP `Performance.getMetrics` 的 Script、Task、Layout、RecalcStyle 增量 | `renderer: null` 时判 **UNVERIFIED**；帧计时和 CPU 单独记录 | **renderer `stats()` 未暴露**：deviceTextSamplingBuilds、tile builds/hits、renderMode、lastRenderSubmitMs 都没有 DOM 或 window 出口。device sampling miss 和 tile bypass 无法观测，这里没有为此添加 production debug 工具 |
| 4 | save-reopen-stable | 在场景 2 的编辑之后：点 `#save` 两次；用已安装 codec 计算 canonical sha；对 webview 执行 `reload()`（按 lastPath 重新打开），再观测 2.2 s；比较字节、mtime、图层 id 及顺序、`#save-state` | 任何差异判 FAIL；缺少数据判 UNVERIFIED | reload 之后 Host 绑定和 bridge 是否保持未经验证，若失败会记为 UNVERIFIED；保存可能被“保存路径未确认”拦截，结果会如实记录 |
| 5 | same-camera-visual | 在约 100%、约 200%（Ctrl+wheel，最多迭代 6 次，容差 1e-6）和 fit 三档下，对 GPU 和 browser 两种 renderer 分别用 `capturePage` 截取 stage 区域；从 `#stage` 的 2D transform 读取相机。HTML 参照由**已安装包**的 `designFrontendCss`/`renderDesignFrontendPage` 生成，套用同一相机，在同一 Electron/Chromium 的 owned 隐藏窗口里截图。报告记录 chevron、`>_`、button、finite 样例的 device 裁剪框 | 各路线相机一致且截图非空时判 EVIDENCE_ONLY；相机不一致、截图空白或缺少某条路线时判 UNVERIFIED | 应用没有 100%/200% 预设；HTML 参照是隐藏窗口的合成路径，与 webview 可能不同；没有获批的像素阈值 |
| 6 | svg-corner-aa-host | 已安装的 `exportDesignSvg` 输出按原尺寸放进参照窗口截图；用 `tests/apps/design-studio/svg-semantic-metrics.mjs` 的 `compareSvgSemantics`（获批的 fill 合同）判定；GPU 和 browser 在 zoom 1 的截图只按同一 oracle 做描述，不作门禁 | 语义 PASS 映射为 PASS，`FAIL_SVG_GEOMETRY` 映射为 FAIL，其余判 UNVERIFIED | Retina Host 截出来是 DPR2；原来 4 个 FAIL 行是 DPR1/z1，需要 DPR1 显示器才能复现，会在 notes 中注明 |

报告和截图 PNG 都是 create-only，必须在仓库外。每个场景单独 try/catch：harness 步骤出错时该场景记为 UNVERIFIED，并保留错误信息。

## 测试与实际运行

TDD 红→绿的日志在 `.tmp/host-harness/`，不提交。每一轮都是先确认测试失败，再写实现：

| 日志 | 红灯原因 |
| --- | --- |
| `red-1-generic.log` | 模块不存在，`ERR_MODULE_NOT_FOUND` |
| 未单独存 log | fixture 测试报 `TypeError: buildDesignStudioFidelityFixtures is not a function` |
| `red-2-verdicts.log` | 12 pass / 7 fail |
| `red-3-runner.log` | 20 pass / 4 fail（runner 和接线） |
| `red-4-outputs.log` | 24 pass / 1 fail |
| `red-5-svg-geometry.log` | 25 pass / 1 fail（SVG 参照几何映射） |

实际运行过的命令（TMPDIR=/tmp/ds-host-harness-tmp）：

```sh
npm ci --cache .tmp/npm-cache --prefer-offline        # exit 0
node --test tests/design-studio-host-fidelity.test.mjs # 首轮 26/26；复审返修后见文末，数据不沿用
npm run validate                                       # exit 0 (.tmp/host-harness/validate-final.log)
npm test -- --suite desktop-harness                    # 首轮 39/39；复审返修后见文末
node --check scripts/check-panel-desktop.mjs           # syntax ok
```

`desktop-harness` 套件包含 `panel-desktop-cleanup`、`panel-desktop-native-fixture` 和本轮新增的测试。运行前已确认这些测试都不启动 Electron 或浏览器；native-fixture 只在 macOS 上执行 sandbox-exec 网络自检。

单元测试覆盖：

- 默认参数不变；环境变量不能 opt-in；flag 必须带 Host 路径和报告路径，且只接受 `--app design-studio`；
- preflight 准确报告缺件（包括 managed runtime 和 Electron dist），`actionsTaken` 为空，并且不写入 Host；
- 样本复制：前后 SHA 和 mtime 一致，原件 0444 不变；复制期间原件被改动、原件位于 project 内、或给出相对路径时，都会拒绝；
- 外部网络 allowlist；默认 offline catalog 和 package scripts 都不调用 `check-panel-desktop` 或 fidelity；纯模块不 import electron、playwright 或 child_process，也没有顶层副作用；
- fixture 经真实 codec canonical round-trip，且只有一页；
- 6 类判定：缺少观测、只有布尔值、点击太晚、只有 engine hitTest、相机不一致、DPR2 等情况都不会判 PASS；
- 汇总里 `goalComplete` 恒为 false，缺少场景时不能 PASS；
- 没有 opt-in 时 runner 不碰任何句柄；
- 参照窗口在 capture 失败时也会被 destroy，并拒绝 http(s) 和 file；
- 用假 guest 运行时，所有场景都是 UNVERIFIED 或 FAIL，没有 PASS，也不会真实 sleep；
- 静态检查接线：preflight 和 create-only 检查在 `mkdtemp` 之前；runner 位于原 `try/finally` 之内，且受 flag 条件控制。

## 未执行项（全部如实列出）

- **没有执行 `--design-studio-fidelity` 入口，也没有执行任何 Electron、Host 或 GUI 命令。** 6 个场景都没有真实结果。runner 里的 Electron 专属代码（sendInputEvent、capturePage、CDP、BrowserWindow 参照窗口、webview reload）只经过假句柄单测和静态检查，**没有在真实 Electron 中运行过**。选择器、事件语义（例如 Electron `mouseWheel` 的 delta 方向和是否只接受整数、`insertText` 进入 textarea、Cmd+Enter 能否提交）都可能需要在获许可后的首次运行时修正。
- 没有构建 Host 或 managed runtime，也没有安装 Panel，主 Host checkout 没有改动。
- 没有跑 `npm run check` 全仓、Design Studio offline suite（约 1500 项且使用 headless Chromium）、`npm run typecheck`（tsconfig 只覆盖 `apps/*/src`，不包含 scripts）。本轮没有改 production 代码，没有理由重跑大矩阵。
- 没有任何新的截图或像素采集。

## 缺口与风险

- 低 zoom 下 tile cache bypass 和 device sampling 的性能需要一个只读、经过 review 的 stats 出口，现在无法在已安装应用里观测。是否添加这样的出口由主代理决定，本轮没有添加 production debug 工具。
- SVG 的 4 个 DPR1 角 AA FAIL 只能在 DPR1 显示环境下复现；在 Retina 上的结果只能说明 DPR2 下的情况。
- 视觉场景只产出证据，需要人工复核或另定获批的比较门禁。HTML 参照窗口与 webview 的合成路径可能不同。
- 打开 flag 时仍会执行 design-studio 的通用 install/update/restore 流程，会弹出真实窗口，耗时数分钟。必须先获得用户的窗口许可。
- 整体样本的视觉验收仍然是 BLOCKED。安装版仍为 0.23.0。没有宣告目标完成。等待 Codex 6.1-sol 独立只读审查。

## 复审返修（Codex 6.1-sol 审 e2a67e86：BLOCKED，4 Important + 1 Minor）

返修前先核对：HEAD 仍为 `e2a67e86`，工作区除 `.tmp/` 外干净。进程表里的 Electron 属于其他 worktree 和已安装的 app，不是本会话启动的，没有碰。本轮仍然**没有**启动 Electron、GUI、浏览器，没有构建 Host，没有安装 Panel，也没有执行 `check-panel-desktop` 或 fidelity 入口。

先写红测试：`node --test --test-timeout=15000 tests/design-studio-host-fidelity.test.mjs`，结果 33 tests / 18 pass / 14 fail / 1 cancelled（`.tmp/host-harness/review-red.log`）。被 cancel 的是参照窗口挂起用例，原实现没有本地截止，一直挂到 15 s 的 test timeout。第一次不带 `--test-timeout` 运行时，pending-guest 用例让 runner 永久挂起，已手动停止。

| 编号 | 问题 | 修复 | 新测试 |
| --- | --- | --- | --- |
| I1 | `hitTestCanvasNode` 按 `design.nodes` 倒序命中，而 fixture 里 `underlay` 排在 `move-target` 后面。拖到 (440,180) 后，用真实模块实测命中的是 `underlay`，后续 inspector 编辑会改错节点 | 层序改为 `underlay, move-target, edit-target`。新增 `INTERACTION_PLAN`，作为点击坐标和预期 ID 的唯一来源。每次编辑前通过 UI 选中目标，并用 `guardPreEdit` 核对 DOM 选中（必须恰好是目标）和 inspector 几何；不符就**不执行编辑**，判 UNVERIFIED，后续步骤停止。`judgeImmediateClick` 要求 preEdit 证据，且提交后的几何要落在计划容差内（拖动 ±20，其他 ±0.01），否则判 UNVERIFIED。inspector 改成设 x=200，使最终状态不同于基线 | 用 canonical fixture 加真实 `hitTestCanvasNode`，在计划几何及 ±容差两端逐个点击点断言命中 ID；preEdit guard 覆盖选错节点、多选、拖动未发生、未观测 |
| I2 | 1200 文字的单文件 771,985 bytes，超过 Host `readText` 的 480 KiB，场景 3 根本打不开 | 不改 Host 限额。用已安装的 `document-index.mjs` 的 `createDesignIndexPersistencePlan` 生成真实索引：manifest 加 digest 命名的页面分片。runner 和测试都通过 `readFixtureDocument`（真实 `resolveDesignIndexDocument`，含摘要校验）读取。seed 会写入每个文件 | 每个文件都 ≤480 KiB，主文件 ≤384 KiB（应用的单文件上限），分片在 1 B 到 360 KiB 之间；用真实 resolver 重组后与 canonical 逻辑源逐字节一致；≥1000 个 text 节点；篡改一个分片会被摘要校验拒绝 |
| I3 | 输出路径只做了字面 resolve，`stat` 会跟随 symlink | `claimFidelityOutputs`：父目录必须已存在，用 realpath 判断是否在 realpath 后的仓库之外；用 `lstat` 拒绝任何已有条目（包括 dangling symlink）；artifacts 目录用非 recursive 的 `mkdir` 独占创建，遇 EEXIST 即拒绝，再用 lstat 和 realpath 确认是普通目录。报告用 `wx` 写入。截图通过 `writeArtifactPng` 写入，label 白名单，`wx`，不再在 runner 里 mkdir。失败时不删除任何文件 | 真实临时目录下的场景：外部 symlink 指向仓库，确认仓库内什么都没创建；报告和 artifacts 路径上的 dangling symlink，且确认目标未被创建；`beforeCreate` 模拟 TOCTOU 竞争出现的目录；父目录缺失；报告覆盖、截图覆盖、截图 symlink、label 中的 `../` 全部拒绝 |
| I4 | 只要有 `interactionEdited=true` 就继续，save 前重新打开文件，又拿磁盘自己的 canonical 当判据，没有核对预期内容，第二次 save 出错也不算失败；旧稿也能 PASS | 场景顺序改为编辑之后**立即**保存，中间不重新打开。前置条件：三个计划操作全部 PASS，且 `#path` 仍是编辑中的文件，否则不保存，判 UNVERIFIED。流程：第一次 save 必须为 saved → 用已安装 codec 读磁盘，预期节点的 id/text/x/y 要符合，非目标节点保持基线 → webview reload 后逐个点图层行，从 inspector 读出相同的期望值 → 第二次 save 必须为 saved，字节不变，且等于 canonical 序列化 | 负控：保存失败、磁盘仍是旧稿、误改非目标节点、第二次 save 出错、第二次 save 改了字节、reload 后文字不符、canonical 不符、dirty、图层顺序变化 → FAIL；编辑未验证、`editsVerified` 只是布尔值、打开的是其他文件、缺少 reload DOM、缺少第二次 save、磁盘缺节点 → UNVERIFIED |
| M | `until` 在 `await dom()` 返回之后才检查截止时间，pending 的调用永远不会结束；参照窗口的 load 和 capture 也没有本地截止 | `boundedOwnedOperation`：本地截止到期后调用 owned cancel，再在有界时间内等待原操作 settle，仍未 settle 的标记 `unsettled`。所有 guest 相关调用（DOM probe、Main 输入、截图、CDP、reload）的 cancel 都只是 `guest.remove()` 一次，即移除本 harness 自己 attach 的 fidelity guest，之后的场景全部判 UNVERIFIED（aborted）。参照窗口在 Main 内对 load 和 capture 各设本地截止：到期先 destroy owned window 再等 settle，`finally` 必定 destroy；外层 evaluate 另有有界等待。不会 pkill，也不会 kill Host | pending 的假 guest：本地超时、`remove` 恰好调用一次、pending 已 settle、后续场景 aborted、`terminatedGuest:true`；永不 settle 的操作返回 `unsettled` 且不挂起；参照窗口 load 挂起时会被 destroy，且 load 已 settle |

不受影响、已确认保留的行为：未 opt-in 不会启动；缺 managed node 时在 mkdtemp 之前 exit 2；样本只做读取、SHA 和复制；guest 用真实 attach 的 cwd、appId 和 trust；overall 只要有 UNVERIFIED 就不会 PASS；性能 stats 没有出口，仍判 UNVERIFIED；视觉最多 EVIDENCE_ONLY；`goalComplete` 恒为 false。

覆盖说明：open-without-edit 每 250 ms 采样、共 2.2 s，不能证明两次采样之间没有出现过短暂的 dirty；这是覆盖上的局限，没有为此扩展 production 观测。

### 返修后实际运行（TMPDIR=/tmp/ds-host-harness-tmp）

运行前确认 `desktop-harness` 只包含 cleanup、native-fixture 和本文件的单测，均不启动 Electron 或浏览器。

```sh
node --test --test-timeout=15000 tests/design-studio-host-fidelity.test.mjs   # 33/33 pass, exit 0 (.tmp/host-harness/review-green-unit.log)
npm test -- --suite desktop-harness                                           # 46/46 pass, exit 0 (.tmp/host-harness/review-suite-desktop-harness.log)
npm run validate                                                              # exit 0 (.tmp/host-harness/review-validate.log)
```

### 仍未解决或未执行

- 真实 Host 场景仍然**一个都没跑**。主 Host checkout 缺 `out/managed-runtimes/node/bin/node`，preflight 会 exit 2；需要先另行授权构建完整的 Host，并经 AskUser 取得窗口许可。
- runner 的 Electron 专属步骤只在假句柄上测过。以下几点在真实环境中都没有验证：webview reload 后 Host 绑定是否保留；`guest.remove()` 能否让 pending 的 `executeJavaScript` settle；Electron 的 `mouseWheel` 和 `insertText` 语义。
- 低 zoom 的 renderer stats 不可观测，仍判 UNVERIFIED。DPR1 的 SVG 角 AA 需要 DPR1 显示器。视觉结果仅作证据。

## 第三轮复审返修（cf51e8e1：I1、I2 PASS；I3、I4、M BLOCKED）

返修前核对：HEAD 为 `cf51e8e1`，工作区除 `.tmp/` 外干净。本轮仍然**没有**启动 Electron、GUI 或浏览器，没有构建 Host，没有安装 Panel，没有执行任何入口。I1 和 I2 没有重做。

红：`node --test --test-timeout=15000 tests/design-studio-host-fidelity.test.mjs`，40 tests / 27 pass / 12 fail / 1 cancelled（`.tmp/host-harness/review3-red.log`）。cancelled 的是“operation 和 cancel 同时 pending”用例：原实现 `await cancel()` 没有上界，挂到 15 s 才被 test timeout 中止。

### I3：输出改为由真实句柄绑定（breaking，仅影响本 opt-in）

**为什么原来的做法不安全。** Node 没有 `openat`/`mkdirat`。只要按路径写到用户目录下，就存在 check→create 的窗口：在这个窗口里把父目录换成指向仓库的 symlink，`mkdir` 或 `open` 就会在仓库里创建条目。事后再做 lstat、realpath 或比对 dev/ino，最多只能发现问题，无法阻止写入。所以不再提供“用户指定路径加保守检查”这条路，而是缩小输出契约：

1. **输出根只有一个：root-owned 的系统临时目录**。macOS 是 `/private/tmp`，Linux 是 `/tmp`。`verifyRootOwnedOutputRoot` 对路径链上的每一级做 lstat，要求：不是 symlink、是目录、uid 为 0、可被他人写的那一级必须带 sticky 位。本机实测 `/`、`/private` 均为 0755 root，`/private/tmp` 为 1777 root，满足要求。非 root 进程无法替换这条链上的任何一级，所以 check→create 之间不存在可被利用的父目录替换窗口。macOS 上的 `/tmp` 本身是 symlink，会被拒绝；仓库目录、用户目录也会被拒绝；没有这种根的平台直接拒绝运行，不退回较弱的检查。
2. **只在该根下直接创建两个文件，不创建任何目录**。两个文件都用 `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW(|O_CLOEXEC)`、权限 0600 打开，文件名带随机部分。同名条目已存在（包括 dangling symlink 或普通文件）时报 EEXIST，且不会跟随 symlink。如果第二个文件创建失败，只有在路径仍指向我们持有的那个 inode（dev/ino 一致）时，才删除刚创建的第一个文件。
3. **持有句柄，全部写入都经由句柄**。PNG 用带 offset 的 `FileHandle.write` 追加进 bundle；报告只写一次，写后 `sync`；`close` 幂等。之后即使有人对这两个路径做 rename 或换成 symlink，写入仍然落在原 inode 上，不会改写到别处。runner 里已经没有任何按路径的 `writeFile` 或 `mkdir`（有静态测试守护）。
4. check-panel-desktop 在 `mkdtemp` 之前完成 claim；最终报告通过句柄写入；失败路径在 owned cleanup 的 `.finally` 中关闭句柄。不带 flag 的原有 Desktop 检查仍按 `[new-report.json]` 以 `wx` 写入，行为不变。

负控（全部是 `/private/tmp` 里的真实 inode 和 symlink，测试结束后只删除自己创建的条目）：

- 非 root 的 scratch 目录、指向 root 目录的 symlink、macOS 的 `/tmp`、仓库 `.tmp` 都不能作为输出根，`claim({ root: repo })` 也会被拒绝；
- 在预定名称上放一个指向**仓库内 sentinel** 的 dangling symlink，claim 报 EEXIST，sentinel 没有被创建；已存在的普通文件同样报 EEXIST，内容不变，刚创建的另一个文件被撤回；
- claim 之后把报告和 bundle 都 rename 走，原路径换成指向仓库 sentinel 的 symlink，再写两张图和报告：字节全部落在被 rename 走的原文件里（偏移 0/5、长度 5/6、sha 一致），两个仓库 sentinel 都不存在；
- 重复的 label、包含 `../` 的 label、第二次写报告都会被拒绝；
- 创建的条目恰好是两个普通文件，权限 0600，没有目录。

### I4：reload 之后、第二次保存之前加入磁盘快照，且全部采样都纳入判定

- runner 在 reload 并采样约 2.2 s 之后记录一次 `reopenedAfterSampling`（只作描述）；读完 DOM、**紧接第二次 save 之前**再拍 `reopenedBeforeSecondSave`。
- 判据：
  - `reopenedBeforeSecondSave` 必须与第一次保存的文件在 sha、mtime、size 上完全一致，否则判 FAIL。这覆盖了 Codex 给出的反例：reload 曾 dirty → autosave → saved，SHA 不变但 mtime 变了；
  - `reopenSaveStates` 中**任意一个**样本是 dirty、error，或文本显示保存中、自动保存、有修改、失败，都判 FAIL；
  - 样本少于 2 个、样本缺少 kind 或 atMs、观测时长或最大 atMs 不足 2000 ms、缺少快照、缺少采样，都判 UNVERIFIED，绝不默认 PASS。
- 原有判据全部保留：预期内容、reload 后的 DOM、第二次 save 出错。
- 负控：sha 相同但 mtime 变化、reload 改写字节、短暂出现 dirty、“正在自动保存”、只有 1 个样本、时长 1500 ms、样本缺 kind、缺少快照、缺少样本。
- 覆盖局限：采样间隔是 250 ms，抓不到两次采样之间一闪而过的 dirty；但如果那次 dirty 导致了自动保存，会被 mtime 快照抓到。

### M：截止时间同时覆盖 cancel 和 settle，未结清的工作交给 owned cleanup

- `boundedOwnedOperation`：operation 超时之后，cancel 和“等待 operation settle”两件事共用同一个 settle 截止，所以整体在 `timeoutMs + settleTimeoutMs` 内一定返回，即使 operation 和 cancel 都永远挂着。错误对象带 `cleanup: { operationSettled, cancelState }`。当 operation 仍 pending、或 cancel 处于 pending 或 rejected 时，标记 `unsettled`；cancel 失败即使 operation 已经 settle，也算 unsettled。
- `createOwnedGuestCleanup`：runner 的超时路径和 caller 的 finally 共用同一个实例，`guest.remove()` 最多调用一次，并且有界。remove 本身挂住或 reject 时，记为 `pending` 或 `rejected`，置 `requiresOwnedHostCleanup`。这里不单独依赖 remove，因为它走的也是同一条 renderer 通道。
- 参照窗口：外层 evaluate 不再传 noop cancel。evaluate 未结清时，`referenceBound` 记入 `cleanup.unsettled` 并设置 abortReason，后续场景全部判 aborted，不会被吞掉。
- runner 报告 `cleanup: { guest, unsettled, requiresOwnedHostCleanup }`。check-panel-desktop 的 finally 先执行一次有界的 remove；只要存在未结清的工作，就通过句柄写出 partial 报告，然后抛错，交给现有 `cleanupPanelDesktopFixture`（只关闭或信号捕获到的 Electron ChildProcess）。不会 kill 操作者的 Host，也不会 pkill。
- 负控：operation 和 cancel 同时 pending（实测远低于 200 ms 返回）；cancel reject；cancel 失败但 operation 已 settle；remove 挂住时两次调用只执行一次且有界；guest 调用和 remove 同时挂住时 runner 有界返回、其余场景 aborted、`requiresOwnedHostCleanup`；参照窗口 evaluate 永不返回时记为 unsettled（label 为 reference window evaluation，operationSettled 为 false），abortReason 已设置，未运行的场景仍计入 notRun。为了让 runner 单测直接走到参照窗口这一步，新增了测试用的 `onlyScenarios` 筛选；被筛掉的场景在 summary 中计为 notRun，不会被当成 PASS。

### 第三轮实际运行（TMPDIR=/tmp/ds-host-harness-tmp）

```sh
node --test --test-timeout=15000 tests/design-studio-host-fidelity.test.mjs   # 40/40 pass, exit 0 (.tmp/host-harness/review3-green.log)
npm test -- --suite desktop-harness                                           # 53/53 pass, exit 0；套件只含 cleanup/native-fixture/本文件，无 Electron
npm run validate                                                              # exit 0
```

运行后 `/private/tmp` 下没有遗留 `ds-host-fidelity*` 条目，仓库 `.tmp` 下也没有 sentinel。

### 仍然不可实现或未执行

- **跨平台的任意用户路径安全写入**：没有 openat 就做不到，因此已放弃，改为上述 root-owned 根加句柄绑定。Windows 等没有这种根的平台直接拒绝运行。
- **root 或同 uid 的进程**：root 本身不在防护范围内。同 uid 的进程可以 rename 我们创建的文件，但写入仍然落在持有的 inode 上；这类进程本来也能直接写仓库，不属于这条边界要防的对象。
- **真实 Host 场景仍然 0 个运行过**。主 Host checkout 缺 `out/managed-runtimes/node/bin/node`（preflight 会 exit 2），也没有获得窗口许可。性能 stats 没有出口，判 UNVERIFIED；视觉场景最多 EVIDENCE_ONLY；`goalComplete` 恒为 false。以下行为只在假句柄上验证过：`guest.remove()` 在真实 Electron 里能否让挂起的 `executeJavaScript` settle；Main 中 BrowserWindow 被 destroy 后，load 和 capture 是否会 reject。
