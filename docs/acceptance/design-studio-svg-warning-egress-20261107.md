# Design Studio：SVG 未测量警告出口（2026-11-07）

独立 review 448732e1 的两条意见：

- **Important：** Node 端 SVG diagnostics 没有出口。
- **Minor：** `alphaFor` 把单个度量值套用到所有 run。

本补丁只处理这两条。未开新窗口，未扩大渲染器范围，阈值不变。

**提交情况：** git 元数据仍不可读（macOS `Operation not permitted`），未重试、未绕过，本补丁**未提交**。

- 上一个 checkpoint：`bf47f710`。
- 未提交内容：上轮 cross-surface/LH 的 16 个文件 + 本补丁，相对 `bf47f710` 共 23 个文件。基线、当前文件、diff、SHA 已归档在 `.tmp/svg-diagnostic-egress-evidence/changed-files/`。
- 开工时核对：上轮 16 个文件的 SHA 与其门禁记录一致，0 不符；上轮 check exit 0（4219 项，4210 通过，9 skip），validate 0。

## 1. Important：Node 端无字体度量的诊断变为可见

**问题：** `exportDesignSvg` 只把 `TEXT_LINE_BOX_SVG_UNMEASURED` 写入 `options.diagnostics`，而 CLI（`tools/design-studio.mjs`）和面板（`app.js` 的导出 SVG）都没有传这个数组。结果是，Node agent 导出无 provenance 的 finite + typography 时，会静默使用旧几何（50.7，而浏览器行框是 54）。上一轮文档说“不会静默错位”，这句话是错的，在此更正。

**修复：**

- **新模块 `svg-export-warnings.mjs`：**
  - `svgExportWarnings(diagnostics, { pageId })`：按代码和节点去重，生成 `{ code, severity: "warning", nodeId, pageId, message }`，最多 400 条，超出部分计入 `truncatedWarningCount`；
  - `svgExportWarningNotice`：生成面板提示文字。
- **CLI：** svg 操作创建 diagnostics 数组并传给导出。无 `output` 的结果和带 `output` 的回执里都带 `warnings`；没有未测量时**不出现**这个字段（无噪音）。stdout 仍是单行 JSON，stderr 为空。CLI 版本和格式不变，`validate` 和审计结果都不受影响。
- **面板：** 导出时传入数组。非空时，导出提示（toast，`data-kind="warning"`）在“SVG 已导出到 …”或“已下载 …”后面追加警告。浏览器能测到字体度量时（正常情况）不会出现。
- **文档同步：** `project-runtime/SKILL.md` 的 svg 一行补充说明 `warnings`。

**真实 CLI 输出**（`outputs/cli-example.out.txt`，content 已省略）：

```json
{"ok":true,"result":{"path":"designs/egress.codesign.json","revision":"c051d3bd…","pageId":"main",
 "warnings":[{"code":"TEXT_LINE_BOX_SVG_UNMEASURED","severity":"warning","nodeId":"typo","pageId":"main",
  "message":"No font metrics were available for this text's line box; its SVG baseline is the unmeasured fallback, not a measured browser baseline."}],
 "content":"<1291 chars of SVG>","bytes":1293}}
```

带 `output` 时，回执是 `{…,"warnings":[同上],"output":{"path":"designs/egress.svg","bytes":1293,"revision":"8c92ed9e…"}}`。

**说明：** 在 Node 中，没有收据的普通行框文字本来也是未测量的（SVG 里早就标为 `data-text-line-box="unmeasured"`）。现在它们同样会如实列为 warning，每个节点一条。

## 2. Minor：单个度量值只用于与节点字体完全相同的 run

**问题：** 原先 `textLineBoxMetrics` 传入的是普通值时，所有 run 都用节点字体的度量计算。

**修复：** 普通值只用于字体族、字号、字重、样式都与节点完全相同的 run；其余 run 返回 NaN，节点按未测量处理（输出诊断、保留收据几何），不去猜度量。传入函数时按 run 逐一解析，正常计算。

`text-metrics` 里无用的 `const shift = 0` 已删除，属于纯等价改动。

**字节对比**（`outputs/svg-bytes.out.txt`）：补丁前的代码树（`bf47f710` + 上轮 16 个文件）与当前代码树，对 13 份文档 × {无度量, 普通度量值} 共 26 次导出逐字节比较：

- 21 次完全相同；
- 4 次两边以相同错误拒绝；
- **1 次不同，且属于预期**：无 provenance 的 finite typography 在普通度量值下，旧代码输出 [54, 77]（把节点字体度量套到粗体和 18px run 上），新代码输出 [50.7, 73.5] 并给出诊断。

普通文字、搬运 / provenance finite、只有填色范围的文字、行框 typography 的输出全部逐字节不变。

## 3. 测试（先红后绿）

- `svg-warning-egress.test.mjs`：
  - 真实 CLI 进程，无 output 与有 output 两种情况：warning 可见、每个节点一条（不按 run 或行重复）、可定位到 code / node / page；stdout 为单行 JSON，stderr 为空；
  - 无文字的设计：结果中没有 `warnings` 字段；
  - 普通度量值 vs 函数解析器（`alphaFor`）。
- `exchange-tools-ui.test.mjs`：
  - 新增：没有字体度量时，导出提示显示警告，kind 为 warning，没有页面错误；用补丁前的 `app.js` 跑为红；
  - 原有的小 SVG 导出测试增加断言：正常导出没有警告。
- `text-html-finite-transport` 预测表：`flow-typo` 带粗体 run，改为传入按 run 的解析器，结果仍为 476；普通值的情况由新测试覆盖（480 + 诊断）。

## 4. 原尺寸确认材料（复用已有证据，未新运行）

`.tmp/cross-surface-lh-evidence/user-confirmation/`：

- `cjk-skip-ink-100-paired-1x.png`：GPU / HTML / 差异掩码三行；标签在独立的行里，不覆盖裁图；1 图像像素 = 1 device px，zoom 1，DPR2，未缩放。
- 两张原裁图在并排图中逐字节相同（`paired-check.json`）。
- `README.md`：所有文件的绝对路径、物理像素尺寸、SHA。数据为 c 0.162 > 0.15，严格判定 FAIL；断开边缘 max 2、p90 1。不作“不可见”的结论，需要用户在原尺寸下确认是否接受。

## 5. 门禁

### 5.1 最终集成门禁（2026-11-08，仅运行验证，未改代码）

**环境诊断与根因：** 之前所有“挂起”都是 macOS 系统睡眠造成的。

- 电源日志（`.tmp/svg-egress-final-validation/suite/pmset-sleep-evidence.txt`）显示，机器在接通电源时反复进入 `Maintenance Sleep` / `Sleep Service` 睡眠，每次 908–1065 秒。
- 测试进程在睡眠期间被冻结；唤醒后，它们的计时器（15 秒 CLI 强杀、90 秒测试超时、30 秒 Playwright 等待）立即触发，当时正在运行的那个测试就会失败。
- 之前各次失败的耗时（945–1065 秒）与睡眠时长一致。本次第一次官方 design-studio 运行中，00:25:50 开始的一次 1063 秒睡眠，对应失败测试耗时 1061.8 秒。
- 因此，前面几次失败与本补丁和测试本身都无关。

**其他诊断：**

- 数据卷 98% 已用，剩余 11 GiB；负载约 4–6。
- 本任务没有残留进程（没有 Playwright 浏览器进程）。唯一匹配的进程属于另一个任务的 worktree，未处理。
- 包复制加已安装 CLI 冷启动只需 0.2–0.3 秒，复制本身不慢。

**处理方式：** 门禁命令在 `caffeinate -i -s` 下运行。这只是进程级的电源断言，命令结束即释放；没有修改任何系统设置、安全扫描或权限；所有测试照常完整运行，没有跳过或改动任何测试。

**结果：**

| 运行 | 精确命令 | 时间（UTC） | 结果 |
| --- | --- | --- | --- |
| 定向（串行，每个文件单独一个进程） | `node --test --test-concurrency=1 <file>`，共 6 个文件 | 16:23–16:24 | 69 项全部通过，0 失败 / 0 取消 / 0 跳过。svg-warning-egress 3、text-html-finite-transport 5、finite-typography-cross-surface 2、headless-prototype 7、figma-plugin-ui 11、exchange-tools-ui 41 |
| DS 套件 第 1 次 | `TMPDIR=… npm test -- --suite design-studio` | 16:24:39–16:47:19 | exit 1：1287 通过、1 失败（系统睡眠 1063 秒）、1 跳过；在第一条命令处停止 |
| DS 套件 第 2 次 | `caffeinate -i -s env TMPDIR=… npm test -- --suite design-studio` | 16:48:53–16:57:31 | **exit 0：1543 项，1538 通过，0 失败，0 取消，5 跳过** |
| 完整 check | `caffeinate -i -s env TMPDIR=/tmp/ds-host-harness-tmp/final-validation/check-tmp npm run check` | 16:57:48–17:10:14 | **exit 0：4223 项，4214 通过，0 失败，0 取消，9 跳过** |
| validate | `caffeinate -i -s env TMPDIR=… npm run validate` | 17:10:14–17:10:18 | **exit 0** |

24 个改动文件（相对 `bf47f710`）在门禁前后 SHA-256 完全一致（`gates/check.files.sha256`，0 不符）。完整日志和元数据在 `.tmp/svg-egress-final-validation/`。

### 5.2 此前的失败（保留作历史记录，已由上述根因解释）

结果见 `gates/`，使用外部 TMPDIR。`validate` exit 0。

`npm run check`：

- 第 1 次 exit 1：job-hunt-hq 的单个测试 90 秒超时（本次改动未涉及该应用，上一轮门禁中它 30.6 秒通过）。
- 第 2 次 exit 1：job-hunt-hq 的另外 3 个测试超时（Playwright 导航、CLI 子进程超时）。当时机器负载约 8–12，主要来自系统文件事件服务和终端安全扫描。

- 第 3 次 exit 1（负载 5.2–7.5）：`tests/verify-release-zip.test.mjs` 的 'rejects ZIP path "a//b"' 挂起约 951 秒。

**结论：** 三次运行中，每次都有一个**不同的、与本补丁无关的**测试挂起约 950 秒（job-hunt-hq ×4、release-zip ×1）；这些测试在其他运行中都能通过（例如上一轮完整门禁 4219/0 失败，单独运行也通过）。本补丁 23 个文件中没有任何文件涉及 job-hunt-hq 或 release-zip；门禁前后 SHA 均为 0 不符。

**`npm run check` 在当前环境下没有拿到 exit 0。** 我判断原因在环境，但不能把它算作通过。建议在机器负载正常时再完整重跑一次。

已有的测试数据（如实给出）：
- 预测表修正前，design-studio 全部套件为 1616 通过、1 失败；失败项就是随后修正的预测表测试（`flow-typo`），修正后该文件和相关三个文件的聚焦运行为 10/10 通过。
- 修正后重新跑 design-studio 全部套件：负载约 10 时，在后台时限内被终止，此前 1223 项通过，3 项挂起约 1000 秒（image source bindings / installed frontend schema / plugin file picker）。**没有得到完整计数**，不能声称全部通过。
- `npm run validate` exit 0（加入文档后再跑也是 exit 0）。

三次失败的日志都在 `gates/` 下。
