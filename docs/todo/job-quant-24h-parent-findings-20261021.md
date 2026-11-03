# 主代理实现中独立检查（待修复/复核）

以下针对实现中的草稿，不代表最终实现仍有此问题。CC 验收和后续修复应重新运行用例。

## P1 · 求职日报重复嵌入证据导致结果膨胀

`buildJobResearchDigest` 为每个岗位嵌入完整 `jobEvidenceComparison`；后者每条 JD 再复制命中的完整证据，并保留全部 evidence。同一证据按岗位数×JD行数复制。

已用纯合成数据实测：12个岗位、每个20行JD、20条已确认经历、每条480字符，报告JSON **2,916,433 bytes**，Markdown仅5,923 bytes。该规模未超过业务记录数上限，但会超过结构化工具/CLI的合理读取预算。

建议日报只含有上限的证据摘要/ID和少量原句；完整单岗位对照按明确ID读取。规定字段/单条/整份报告预算，测试常见多岗位+长资料输入，必要时截取原文子串并标注省略。不得仅等最终JSON超限失败，也不要通过隐藏已确认资料来伪装资料不足。

复现：

```js
const quote = 'Node.js '.repeat(60);
const snapshot = {
  careerEpisodes: Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, status: 'confirmed', myRole: quote })),
  jobs: Array.from({ length: 12 }, (_, i) => ({ id: `j${i}`, company: 'Fixture', title: 'Engineer', description: Array.from({ length: 20 }, () => 'Node.js 开发与维护').join('\n') })),
};
Buffer.byteLength(JSON.stringify(buildJobResearchDigest(snapshot, { now: '2026-10-21T03:30:00Z' })));
```

## P2 · 无岗位时错误报告没有候选人资料

草稿的 `profile.status` 由 `ranked.some(item => item.fit.evidence.length)` 派生。候选人已经有确认资料但暂无岗位时，ranked为空，会错误写“尚无明确已确认的候选人资料”。应独立从候选人记录推导资料状态；新增“有资料、无岗位”的用例。

03:47Z复核：上述12岗位证据用例已降为65,037 bytes，有资料无岗位也返回evidence_available，说明这两种情况已修。但公司sources仍整批复制进日报JSON和Markdown：50岗位×每份60条来源（各字段均在save_job_research上限内）报告11,884,787 bytes，Markdown4,020,173 bytes。即使缩小到12岗位也仍约2.85MB。应对日报公司来源、变化/排除记录及所有长字段分别设展示预算/省略计数，并保留按jobId读取完整资料的路径。复现摘要见docs/validation/job-quant-24h-20261021/parent-digest-boundary.json。不要以已修复字面证据重复为由忽略该剩余输出边界。

## 确认的正向行为

- 未将旧Agent分数作为新的可信匹配概率。
- 在招证据文案明确是Agent提交且需复核；CLI未伪装自己抓取/核验网页。
- UI以文本方式显示外来内容，当前片段未引入HTML注入。

## P2 · 量化新手报告首屏仍暴露公式和未解释术语

主代理已在CodeShell Browser Runtime实际打开本地开发预览，点击“研究”→“应用预设”→“一键生成白话报告”，确认按钮可生成报告（合成520根，展示本金100000、期末161762.73、最差峰谷损失14408.02，并明确样本外未跑）。这只是开发预览，不是已安装Desktop包验收。

实际呈现为一大段原始Markdown文本，含`#`、`##`、`**`，默认正文包含`shares×成交价`、`入场价/(1+s)`、`fnv1a32`以及未解释的bps。用户的核心要求是“目前量化看不明白”。建议默认先显示4句白话/简短卡片：按什么规则买卖、模拟赚亏多少、从最高点最多亏多少、比一直持有如何及验证够不够；来源/完整依据和公式放到可展开详情。手续费同时给百分比或说明1bps=0.01%，策略名字给自然语言释义。必须保留合成数据和证据不足提示，不能为易读而掩盖限制。CLI可保留完整结构与Markdown，审计口径不丢失。

## P1 · 新增求职浏览器回归尚未通过

主代理在外层运行真实 Chromium：`node --test tests/apps/job-hunt-hq/headless-parity.test.mjs`，终态 **exit 1，8 pass / 2 fail**。新增 direct/sharded 两种 `shared job research CLI/Panel parity and evidence UI` 在第367行点击 `[data-view-target="research"]` 超时，元素不可见。此前的写入、CLI/Panel一致性和今日摘要断言已通过。应从当前可见界面的真实导航进入岗位调研，并验证用户能到达；不要强制点击隐藏元素或删去覆盖。

独立量化浏览器回归 `node scripts/quant-lab-ui.mjs` 终态 **exit 0**。两份原始日志和实际退出码收据位于 `docs/validation/job-quant-24h-20261021/parent-parity.log`、`parent-parity.receipt.json`、`parent-quant-ui.log`、`parent-quant-ui.receipt.json`。这是实现进行中检查，后续修改后仍需针对最终版本复测。

## 后续主代理复核（以这些新证据为准）

- 公司来源相同50×60夹具现在为306,790 bytes（Markdown126,473），每份显示3条并标记省略57条；见parent-digest-boundary-fixed.json。
- 可见岗位研究导航加入后，headless-parity真实Chromium重跑10/10、exit0；见parent-parity-rerun.log和receipt。后续完整求职套件亦374/374、exit0（parent-job-final.log和receipt）。
- 投资完整领域套件233/233、exit0，既有16条工作流脚本也通过；见parent-quant-final.log和receipt。单独量化UI最终回归仍在运行，尚不能视为通过。
- 主代理在CodeShell Browser Runtime重开本地预览，实际应用SMA预设并生成了五段白话卡片，含明确合成与样本不足提示；源码详情使用默认折叠details。结构化读取确认内容可用。Host vision返回“当前模型不支持视觉输入”，没有取得像素视觉验收，不冒充已安装Desktop验收。
- 控制器已从稳定目录实际启动，真实Claude与Codex受限兼容调用均返回READY。代码验收/修复控制器不是市场监控，也不会把code pass当部署或整个Goal完成。

03:52Z：独立最终量化UI回归 `node scripts/quant-lab-ui.mjs` 已完成 **exit0**；见parent-quant-ui-final.log及receipt。浏览器卡片生成、旧报告失效、项目切换清空等真实交互均已跑过。完整领域套件结束后实现者又调整了观察模块的终态时间记录；该共享模块应单独重跑其测试并同步拷贝校验，不能把此前结果当覆盖后续变化。

03:54Z：观察模块最后改动单独重跑9/9、exit0；包validate也exit0，00-parent-receipts.json汇总了真实终态。仍有一个日报输出边界：normalizeJobApplication保留legacy公司/标题/URL原始长字段，日报ranked与leads也未截取。合成12岗位每份company/title/url各50,000字符，输入快照1,801,248bytes（低于读取16MiB上限），日报3,624,129bytes。请在日报展示层同时截取这些字段、ID/日期/线索missingFields，标记省略，不改原始个人快照；整份日报应有可验证的总展示预算。公司sources的预算已修，无需回退。

## P1 · 可复用安装包不能把本次任务日期当永久能力截止

两个安装包的observation-runner拷贝和shared源把OBSERVATION_DEADLINE永久写死2026-10-22。quant headless真实CLI测试用默认deadline创建计划，因此明天之后所有默认plan都会失败，公开observe能力也永久不可用。请把可复用模块改为“每个计划自createdAt起最多24小时”的校验，默认now+24h；既有计划到期仍严格停，不允许改plan延长。**本次开发控制器和本次实际观察计划继续显式固定2026-10-22T03:08:05Z，不延长用户这一轮授权。** 增加系统日期跨过本次截止后仍能创建新的独立有界计划的回归。CLI文档区分可复用能力和本次任务日期，不要发布明天失效的默认示例。共享源/两个拷贝需同步，父代理可在实现结束后负责根目录同步和测试。

04:03Z主代理已修复最后两项：legacy日报字段/ID/日期/线索及展示岗位的变化排除已截取并标记；confirmed资料无岗位保留。通用观察计划默认创建后24h、可指定更早时间，加载时重验createdAt与deadline差；新增2027年时钟回归。本次稳定开发控制器截止未动，仍2026-10-22T03:08:05Z。独立末次领域组合、求职真实浏览器parity、日报最终回归、CLI门禁、validate均exit0，详见00-parent-receipts.json latestFinalChanges。源码现冻结交CC代码验收；旧IMPLEMENTATION.md中的“固定截止”仅描述初稿，以下修订覆盖它。

04:12Z：真实CC首轮changes_requested指出legacy核验checkedUrl未截取，已由受限Codex repair修复，仅日报展示与对应legacy回归改动；原个人快照不变。主代理独立重跑9/9、exit0。夹具仅清理EOF空白，staged diff-check过，产品提交6049efd。请CC复核该具体发现；安装后的Quant0.47.0已选中、ops/presets成功，但用户现有market-raw CSV尚需按原字段格式正确导出，未冒充研究成功。

## CC aggregate budget repair — 2026-10-21T04:23:37.099Z

Actual second Codex repair is complete. I reviewed the two-file diff: shared confirmed evidence is emitted once, job references use evidence IDs, the UTF-8 total JSON plus standalone Markdown is capped at 256 KiB, lower-ranked entries are omitted with explicit counts, source snapshot remains unchanged, and format=json/markdown now changes output. Parent-run targeted tests 34/34 and browser/CLI parity 10/10 passed (completed subprocess receipts, not implementer claims). Final full Job suite and CLI/package preflight follow. Review source against the saved original plan and requirements; deployment remains separate.

Final full Job candidate beb31fb completed parent validation: suite exit 0; CLI six-app discovery 6/6 passed, package validate exit 0. Exact counts in 00-final-validation.md. Job stable package refreshed outside the disposable worktree; 94-file source/package equality and public Core preview succeeded. Deployment still awaits actual added-permission review; Quant is already installed and actual UI/917-bar history report verified separately.
