# H2F-INTEGRATION-008：先合并原始文字区间，再检查规范预算

真实 Python 官方教程的 html2figma JSON 在工作台标准导入入口被拒绝，提示
`styledTextSegments` 最多64个区间。before 有一个 Text 含81段，after 的三个
Text 含96、65、68段。这些段来自语法高亮，不能删样式、拆成独立 Text、改源 JSON
或栅格化后宣称修复。

[导入器](../../apps/design-studio/app/figma-bridge.mjs) 现在为原始区间单独设置
512段／256KiB输入预算。每段仍须有序、不重叠、落在完整 UTF16 字符边界，所有
可支持字体、颜色、装饰和链接字段先通过原有规范校验。只有相邻且完整可支持样式
完全相同的规范 override 才合并；继承空隙及任何样式差异均保留。随后继续执行
原有64段／32KiB规范范围预算，超过预算明确拒绝，不截断区间。

没有修改 `text-ranges.mjs`、原生规划／观察器、schema 或 Agent manifest 的上限。
规范化来源仍保留全部原始 `styledTextSegments`，不将其替换为合并结果。已有
`sourceUrl` 解析仍会把来源中的相对 hyperlink 规范为绝对 URL；此项既有行为未改，
因此来源按既有 normalize 输出完整精确比较，输入 wrapper 的字节及对象保持不变。

[最小回归](../../tests/apps/design-studio/html2figma-range-budget.test.mjs) 留有65／96段
同样式合并、继承空隙／链接及字重差异、65段不可合并拒绝、513段原始输入拒绝、
256KiB原始字节／32KiB规范字节上限、末段 UTF16 和重叠校验。旧代码6项失败，
新代码6项通过；已登记常规 Design Studio suite。

```sh
node --test tests/apps/design-studio/html2figma-range-budget.test.mjs
node --test tests/apps/design-studio/native-text*.test.mjs tests/apps/design-studio/figma-plugin.test.mjs tests/apps/design-studio/html2figma-json.test.mjs tests/apps/design-studio/html2figma-range-budget.test.mjs tests/apps/design-studio/text-ranges*.test.mjs
node --test --test-concurrency=1 tests/apps/design-studio/figma-workflow-ui.test.mjs
node scripts/validate.mjs
```

本批次相关范围／原生合同／生产 factory 共279项通过，私有 Chromium 工作台流程
10项通过，validate 与 diff check 通过。真实 before／after 完整输入各保留1,127个
节点、421个 Text；分别17,855／17,947个 UTF16 单元的完整文字和每字符有效样式
核对通过，保存／重开精确一致。before 最大 raw81→规范51，after 最大raw96→规范58；
原始来源区间无删减或合并。Node prepare 本批次没有测量字体，不能据此推断字体
可用或像素一致。后续真实 UI 对照由独立验收记录，不与这些合同测试混为一项。

本案修复初次冻结时，工作台直接加载的 app 模块已可执行此修复；当时嵌入 Figma
plugin 的生成包仍需同步。官方只读检查
`node scripts/build-design-studio-figma-plugin.mjs --check` 当时明确报告 stale。
对应生成命令是 `node scripts/build-design-studio-figma-plugin.mjs`，
它会写 `app/figma-plugin/ui.html` 和 `app/figma-plugin/code.js`。独立逐槽内存比较发现
UI adapter 和 TEXT RUNTIME 需要更新，其中 TEXT RUNTIME 是其他候选文字／字体
变更，UI adapter 在本案前也已 stale；不能将整次生成归为本案单独产物。
PAINT／GRID／SPACING 槽已一致。本案修复阶段未写生成文件，也未将旧嵌入包、mock 或
Chromium 流程称为真实 Figma 原生通过。

随后已完成整份未发布候选生成包的[官方同步与验证](../../artifacts/generated-plugin-sync-2026-10-22T05-22-54-180Z-0af9cdfe/README.md)：
先保留旧完整字节和输入哈希，再运行官方生成命令；新 `--check` 通过，相关既有
plugin／v3／UI／native text 合同 **163项通过、0失败、0跳过**。仅 V3 adapter 和
TEXT RUNTIME 两个生成槽变化，其他槽及槽外内容不变，输入哈希前后相同。此同步
包含此前文字／字体合同，不能归为008单独产物，也不代表真实 native Figma 通过。
原始只读 inventory 和下列证据清单保持历史原样；4183 的独立
`app-snapshot-ranges-v2` 仍是生成同步前快照，未被本次同步覆盖。

本地忽略证据位于 `artifacts/html2figma-private-python/`，最终清单为
`H2F-INTEGRATION-008.evidence.20261022.batch.json`；包括红绿日志、真实 prepare
完整结果、按字符样式报告、输入 hash、生成槽只读 inventory 和任务增量 patch。
原始真实 UI 拒绝截图保留在 html2figma 主仓的
`artifacts/fidelity-python-2026-10-22/studio.range-limit-before.jpg`，清单记录其实际路径与 hash。
候选尚未合并、安装或发布；本文不宣称原生 Figma 字体、绘制或最坏范围预算往返验收。
