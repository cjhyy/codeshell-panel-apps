# Video Studio 素材粗剪

本次借鉴 LosslessCut 的素材筛选方式：先在源素材中标记要保留的范围，整理成片段清单，再按顺序加入成片。LosslessCut 的官方工作流使用 I/O 设置入点和出点，以片段清单组织顺序，并提供反选范围功能。[官方工作流](https://github.com/mifi/lossless-cut/blob/master/docs/index.md#usage-typical-workflow)

## 本次范围

- **源素材标段**：源播放器与成片预览分别控制播放位置。标记使用素材自身的起止位置，不因成片已有剪辑发生位移；选区可保存、命名、启用或停用。
- **反选保留**：对当前素材已启用片段的并集取补集，结果仍是一份明确的保留清单。重叠或相邻范围先合并，其他素材的清单保持原顺序。
- **顺序入轨**：确认后才把选定片段加入成片；视频追加到画面末尾，音频从现有独立音轨最晚终点连续排列。画面不足以容纳音频时，整批操作失败并提示先添加或延长画面。源文件和粗剪清单不因此被消耗。
- **保存与撤销**：粗剪清单随工程保存；修改清单、分割和加入成片均沿用工程的原子编辑与撤销流程。未使用粗剪的旧工程仍可正常打开。
- **CSV 交接**：导出当前素材启用的片段，按清单顺序写出起点秒数、终点秒数、名称三列，供 LosslessCut 导入后继续处理。

## CSV 格式约定

导出 UTF-8、逗号分隔、无表头的 `.csv`，时间由工程帧数换算为秒，保留小数精度。名称可以包含中文、逗号、换行和双引号；字段使用 CSV 引号规则，内部双引号写成两个双引号。

LosslessCut 文档示例采用无表头三列；当前源码的导入器同时接受无表头和 `Start,End,Name` 表头，其默认导出会添加该表头。本次提供的是 **LosslessCut 兼容 CSV**，不要求与其默认导出文本完全相同。[官方 CSV 说明](https://github.com/mifi/lossless-cut/blob/master/docs/index.md#csv-files) · [官方解析与导出实现](https://github.com/mifi/lossless-cut/blob/master/src/renderer/src/edlFormats.ts)

## 导出边界

本次交付素材标段、顺序入轨及 CSV 清单交接；CSV 不包含媒体，也不会产出裁剪后的视频文件。成片仍使用 Video Studio 现有渲染流程，不能称为“无损视频导出”。真正的无损剪切需要复制原始编码流，其切点通常受关键帧限制；LosslessCut 官方也明确说明，切点可能提前，Smart Cut 尚有兼容性限制。[官方切点限制](https://github.com/mifi/lossless-cut/blob/master/docs/troubleshooting.md#cutting-times-are-not-accurate)

验收示例：60 秒源素材保留 `[5,10)` 与 `[20,30)`，清单总长为 15 秒；反选得到 `[0,5)`、`[10,20)`、`[30,60)`，总长为 45 秒。标段和切换源素材不会改动已经排好的成片。
