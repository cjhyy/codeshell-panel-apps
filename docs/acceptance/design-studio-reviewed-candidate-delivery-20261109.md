# Design Studio reviewed candidate 本地交付（2026-11-09）

本次归档既有修复，不新增产品改动或视觉实验。任务分支为 `codex/design-studio/fidelity-host-harness-20261107`，提交前 HEAD 为 `bf47f7109724789802473e0817505dc6a11475e6`；下列 25 个任务文件与启动清单完全一致，另加本说明。没有发布、安装、合并、push、Host 写入或用户稿件操作；持久 goal 的状态仍由根代理管理。

## 用户接受与源码身份

用户原话 **“感觉看起来还好 可以接受”**，只对应当前原尺寸图（左 GPU、右 inline editor）。约 **0.2628186 device px** 残差不再阻塞这一处观感验收；不扩展到 fit、skip-ink、旋转 AA 或真实 DPR1。原 **strict FAIL（≤0.15 device px / ink ±3%）**、run9 **UNVERIFIED** 原样保留。

- [Host 用户接受记录][acceptance]、[用户所看原尺寸图][comparison]、[run9 原报告][run9]、[Host 根 RESULT][host-result]。
- 本次只读核验：当前 Panel 的 **158/158 文件**匹配 run9 `instrumentation.sourceInventory`；实测副本 **158/158**匹配 `outputInventory`。两者仅 `app.js`、`canvas/canvaskit-text.mjs`、`canvas/canvaskit-renderer.mjs`、`renderer-controller.mjs` 四个 private hook 文件不同；用既有 `prepare-instrumented-panel.mjs` 纯内存重放逐字节匹配，四个原 SHA 全部一致。没有把副本覆盖到 source。
- 原报告 SHA-256：`9da71035c53c4afed214496dcf47742fbde762855c12a28fe188a618cfb9e8e6`；对照图：`d7771ae32ba43e5cd1d6f43e8ba5355ebb847046d25e4977b2de0ef8ef4a2a90`。原 GPU/editor PNG 与 crop-index 的 SHA 也匹配。因此当前产品源码可绑定用户所看的图，但实测运行带 private hooks，并非未经插桩的生产运行。
- [本次身份收据](../../.tmp/candidate-delivery-20261109/identity.json)、[25 文件 SHA 清单](../../.tmp/candidate-delivery-20261109/task-files.sha256)。清单文本 SHA-256：`1f6ddf9e49874a4ca226ea1f36bad4440b553a1fd241e096e8efde01052d9792`。

## 改善、review 与真实 Host 证据

既有修复统一非 provenance finite typography 的跨表面原点、混合字体基线及 LU 行高；Node SVG 未测量回退现在经 CLI/Panel warning 明示，普通字体度量只用于字体完全匹配的 run。字体别名隔离和干净 ROI 有回归覆盖。inline y 偏上／文字过淡的修复已在基线 HEAD，当前 `app.js` diff 仅接 SVG warning，不能记作本次新增 editor 修复。

[跨表面验收](design-studio-cross-surface-line-height-fix-20261107.md)记录真实 Host R1 的 open/hit/save/SVG 圆角 PASS、coverage 51/52 PASS，以及 finite/LH 修复用例；不据此宣称全像素 PASS。run9 的[补充收据][supplemental]证明普通 paint 与颜色往返，H0/H1 整图及 PNG 字节不变，未证明 glyph cache 重建。原清理收据为 child exit 0、owned 5 / remaining 0、HOME 已删除，属于历史运行证据。

独立 CC 最终提交复审：job `cc-hl3o0wcn3`（session `067aa930-e88f-4cc7-95d8-cd23b6a4d08d`）逐段审查 `e10eac15` 的 diff，未发现 Critical/Important，允许按本说明范围作为已验证修复候选交付；[完整原始回报](../../.tmp/candidate-delivery-20261109/cc-final-review.raw.json)已归档。非阻断 follow-up 保留：旧/外部收据缺 `lineOffsets` 时的 SVG 混合字号健壮性、行高注释、layoutScale 2 的 DOM 单测，以及保守墨迹边界的已知取舍。本地可追溯旧 review `448732e1` 及 [Node SVG Important／混合 metric Minor 的修复](design-studio-svg-warning-egress-20261107.md)，不把旧提交的 PASS 冒充当前 25 文件签字。Host 接受记录另记 CC session `52c8963a-1e8c-4ac4-9dfa-e65227db3722` / job `cc-gjqda3pzq` 对 paint 分支收拢无 Critical/Important。本轮分工只读复查未发现新增可见阻断问题。

## 历史门禁绑定（本次没有重跑应用测试）

最终 CC 复审后，根代理执行 `shasum -c .tmp/candidate-delivery-20261109/task-files.sha256`：**25/25 文件匹配，exit 0**，补齐复审者未自行重算的磁盘身份环节。本次重算历史归档 SHA **91/91**、门禁后快照 **24/24**一致。门禁时清单的 **22 个非文档文件全部匹配当前内容**；唯一变化的 SVG 说明只追加最终门禁记录／历史段标题，第 25 项 CJK followup 也是纯文档。按 CONTRIBUTING，本轮仅审阅文档 diff/链接，无需重跑应用套件。旧 SVG 说明 §5.2 的失败叙述是历史，最终结果以其 §5.1 及下表为准。

| 历史门禁（2026-11-07 UTC／本地 11-08） | 收据结果 |
| --- | --- |
| `npm run check` | 4223 tests，4214 pass，0 fail，9 skip，exit 0；包含 panel-cli 6/6 |
| `npm test -- --suite design-studio` | 1543 tests，1538 pass，0 fail，5 skip，exit 0 |
| 六文件定向运行 | 69/69，exit 0 |
| `npm run validate`、文档后 validate | exit 0 |

精确命令、时间、日志与内容身份见[本次历史收据核验](../../.tmp/candidate-delivery-20261109/historical-gates.json)和[原门禁目录](../../.tmp/svg-egress-final-validation/)。这些数字均来自历史日志，没有新增 Host build、run10、窗口或视觉探针。

## 剩余边界

- **可见功能／几何限制：** textarea 仍不支持富样式；provenance finite typography 在强制 DSF 下既有 0.5 layout px 偏差、SVG 取整与 DOM 的既有 0.5 CSS px 差异保留。当前被接受的图未发现新的可见阻断，不替其他场景作观感结论。
- **局部严格像素差异：** 当前 inline x 约 0.2628 device px 已获这一处观感接受，严格判定仍 FAIL；CJK skip-ink 的 c 0.162、断口 max 2 / p90 1 仍 FAIL，未获这次接受；既有 fit、旋转 AA 和 SVG FAIL 仍保留，不能从局部接受推导整体 PASS。参见 [CJK followup](design-studio-cjk-skip-gap-followup-20261107.md)。
- **未覆盖／未证：** run9 只覆盖 `inter-bytes/left/100%/phase0/DPR2`，当前接受不覆盖 fit 或其他相位；真实 DPR1 未测，旋转/grid finite 仅单测，性能仍 UNVERIFIED，glyph cache 重建未证。历史有限 fit PASS 不等于整体 fit 验收。

## 精确任务文件（另加本说明）

```text
apps/design-studio/agent/skills/project-runtime/SKILL.md
apps/design-studio/app/app.js
apps/design-studio/app/canvas/canvaskit-text.mjs
apps/design-studio/app/document.mjs
apps/design-studio/app/figma-plugin/ui.html
apps/design-studio/app/quality-repair.mjs
apps/design-studio/app/svg-export-warnings.mjs
apps/design-studio/app/text-line-box.mjs
apps/design-studio/app/text-metrics.mjs
apps/design-studio/app/tools/design-studio.mjs
scripts/design-studio-host-fidelity-runner.mjs
scripts/design-studio-host-fidelity.mjs
tests/apps/design-studio/browser-font-alias-isolation.test.mjs
tests/apps/design-studio/exchange-tools-ui.test.mjs
tests/apps/design-studio/finite-typography-cross-surface.test.mjs
tests/apps/design-studio/range-text-decoration.test.mjs
tests/apps/design-studio/real-dsf-layout-scale.test.mjs
tests/apps/design-studio/svg-warning-egress.test.mjs
tests/apps/design-studio/text-html-finite-transport.test.mjs
tests/apps/design-studio/text-line-box.test.mjs
tests/design-studio-host-fidelity.test.mjs
tests/suites.mjs
docs/acceptance/design-studio-cjk-skip-gap-followup-20261107.md
docs/acceptance/design-studio-cross-surface-line-height-fix-20261107.md
docs/acceptance/design-studio-svg-warning-egress-20261107.md
```

以下 Host 链接及 `.tmp` 收据为本机保留证据，不随提交复制或删除。

[acceptance]: /Users/admin/Documents/个人学习/代码学习/codeshell/.tmp/design-studio-inline-editor-x-candidate/actual-app-onecase/USER-ACCEPTANCE.md
[comparison]: /Users/admin/Documents/个人学习/代码学习/codeshell/.tmp/design-studio-inline-editor-x-candidate/actual-app-onecase/run9-analysis/pixels/gpu-editor-current-1x.png
[run9]: /Users/admin/Documents/个人学习/代码学习/codeshell/.tmp/design-studio-inline-editor-x-candidate/actual-app-onecase/actual-run-9/report.json
[host-result]: /Users/admin/Documents/个人学习/代码学习/codeshell/.tmp/design-studio-inline-editor-x-candidate/RESULT.md
[supplemental]: /Users/admin/Documents/个人学习/代码学习/codeshell/.tmp/design-studio-inline-editor-x-candidate/actual-app-onecase/run9-analysis/SUPPLEMENTAL.json
