# 全面板仓库合并核对：2026-10-26

本轮按用户“所有面板的 repo 都合并处理”核对 `codeshell-panel-apps`。
Design Studio、Job Hunt HQ、Quant Lab、Video Download 和 Video Studio 共用该仓库；
Starter 是同仓模板。同级 CodeShell Host、Services 和 html2figma 不是独立面板业务仓库，
本轮没有跨仓修改。

从刷新后的 `origin/main`（`2202581`）建立独立集成工作树和
`codex/panel-shared/consolidate-20261026`。远端没有待合并 PR。不能把“不是主线祖先”
直接当作功能遗漏：历史工作大量使用 cherry-pick、组合提交和后续增强。

## 本轮正常整合

| 范围 | 原提交 | 整合与验收边界 |
| --- | --- | --- |
| Video Studio CLI 媒体闭环 | `090300c`，通过本机主线 `832e5e4` 整合 | 源码、生成包、Skill 和测试一起保留；实际本地素材、渲染、抽帧和可用本地语音走独立媒体验收。README 仍明确待发布，未重复发行 0.8.0。 |
| Design inline text planner | `0e7c14e`、`205751f` | 正常 merge，保留纯 CPU case 和冻结测量输入；没有接入运行转换器，mixed-inline promotion 仍禁用。 |
| Design negative-row source plan | `4ac84d2` | 正常 merge，保留三个 viewport 的固定 JSON、provenance 和回归；positive plan 仍要求 `activation: blocked`，不能计作运行转换通过。 |
| Design native factory 研究记录 | `8859b86`、`f572493`、`b600815` | 正常 merge 文档；`PREPARED_UNARMED` 与未执行原生像素验收的边界照录，原源工作树和外部证据保留。 |

上述合并均使用正常 Git merge，没有用旧工作树覆盖新主线或使用 ours merge 隐藏差异。
两个 planner 的测试均登记在 `tests/suites.mjs`，随全仓检查执行。

## 已在主线的历史工作

- Job Hunt HQ、Quant Lab、shared 和 Video Download 已完成的产品改动已在主线。
  `job-quant` 的 `beb31fb` 是主线祖先。Job 的旧 career/headless/native 支线可由
  patch 等价、重放提交和当前文件逐字节证明覆盖；主线还包含更严格的摘要和输入校验。
- Design 的角半径、block flow、overflow、viewport、native baseline/source、gradient
  和 text ranges 等旧分支，在主线已有对应集成提交。审计对核心源和测试的 Git blob
  进行对照，保留共享入口、生成物与后续修改的差异，避免重复回灌旧版本。
- Video 的多数旧分支按 `video-studio-morning-editing-2026-10-12.md` 分批聚合。
  原 SHA、实际集成点、保留的 case 和当前源均纳入核对；研究 prototype 不当作漏合产品。

## 保留中的开发工作

本节是首次全仓合并时的保留边界。用户随后明确授权继续整理其中的 81 文件开发稿；
后续整合与验收见 [专门记录](design-studio-draft-integration-20261026.md)，不回写本轮历史基线。

- `codex/design-studio/html-inline-promotion-20261021` 的 `2ec13ee` 是明确 WIP：
  两个 strict-zero-pixel case 仍失败，生命周期、字体和资源竞态验证未完成。
  保留原分支/源/失败基线，不把它当作通过验收的转换功能。
- `design-studio-html2figma-json-import-20261022` 工作树另有 81 个未提交文件，
  50 个既有文件与主线不同、31 个新路径。字体、存储、报告等变更仍独立保留；
  没有将其批量 stage 或提交。已冻结路径、状态和 SHA，并备份当前文件与 binary patch。
- `job-quant-24h-20261021` 工作树的 33 个未跟踪规划/验收文件保留原位并备份。
  文档里尚未启动的 24 小时实测，没有在本次合并中改写为完成。
- probe 和 figma-24h 的源工作树及其外部研究证据仍保留，避免破坏冻结 observer 的引用。

详细审计、上述未完成工作的逐文件 SHA/备份、原始测试日志及最终检查回执位于
本机 ignored `artifacts/panel-all-consolidation-20261026/`；清理本轮集成工作树前
归档至稳定主仓库同名目录。旧开发工作树不因本轮主线合并而删除。

## 检查与交付

对最终合并提交运行 `npm run check`，检查源码类型、生成包确定性、插件同步和所有
离线套件；另执行 Video CLI 的真实 FFmpeg/Chromium 媒体 case。缺少可选本地模型时
按现有测试明确 skip，不下载模型或声称该分支通过。原 case、断言和像素阈值保持。

检查回执记录精确 Git SHA、退出状态及检查前后的源码摘要。检查通过后刷新远端，
将经验证的集成结果正常合入并推送 main，再同步干净的本机主线。此前的
`design-studio-v0.23.0` 发行标签及四个资产保持其原来已核验的提交与摘要。
