# 剪辑与时间

本页仅说明旧制作工具的 30 fps 兼容读视图。完整新版多轨工程使用 `editor-v2` 技能与 240000 Tick/秒，不能按本页规则投影重建。旧视图固定 30 fps。所有编辑时间使用整数帧，范围为半开区间 `[开始, 结束)`。将转写秒数转换为帧时使用 `round(seconds * 30)`，并把结果限制在素材合法范围；结束帧必须大于开始帧。

| 操作 | 字段与语义 |
| --- | --- |
| `trim` | `{type:"trim", clipId, inFrame, outFrame}`，入出点相对原素材。 |
| `split` | `{type:"split", clipId, atFrame}`，`atFrame` 是原素材的绝对帧，必须在当前片段内部。 |
| `remove` | `{type:"remove", clipId}`，删除一个片段；磁吸模式收拢后续内容，自由模式保留空隙。 |
| `move` | `{type:"move", clipId, toIndex}`，仅磁吸模式；`toIndex` 是移动后的最终零基片段位置。 |
| `video-move` | `{type:"video-move", clipId, startFrame}`，仅自由模式，移动到序列绝对帧，允许留空，拒绝同轨重叠。 |
| `volume` | `{type:"volume", clipId, volume}`，范围 `0..2`，`1` 是原音量。 |
| `add` | `{type:"add", assetId, inFrame?, outFrame?, startFrame?}`，默认追加到序列末尾；自由模式可用 startFrame 指定不与其他片段重叠的位置。 |
| `caption` | `{type:"caption", caption:{id,startFrame,endFrame,text}}`，字幕时间相对当前序列，ID 相同则替换。 |
| `remove-caption` | `{type:"remove-caption", captionId}`。 |
| `settings` | `{type:"settings", name?, width?, height?, timelineMode?:"magnetic"|"free"}`。 |

旧工程默认磁吸排列。`settings.timelineMode:"free"` 保留当前位置并开启自由布局；切回 `magnetic` 会收拢空隙。自由模式的 `clip.startFrame` 是序列绝对帧，片段按时间排序；画面空隙显示黑场，独立音轨保持绝对位置，预览和导出均保留空隙。自由模式裁剪入点时同步调整序列起点、保持原右边界；切分保留两半真实序列位置。

一次修改最多 100 项。一个批次中的操作按顺序执行，整体原子应用，成功只增加一次修订号。未知或越界 ID 会拒绝整个批次。

增加或分割片段产生的新 ID 由工作台分配，不能提前猜测。需要再移动该片段时，先完成这一批操作，重新读取工程，找到返回的真实片段 ID 后再提交后续批次。

现有字幕随其覆盖的原素材片段移动和裁剪：被删除的素材范围会失去对应字幕，后续字幕随磁吸移动，跨片段字幕可能拆成多条。切分本身不改变序列时间。新补入的素材范围不会自动恢复已删除字幕。

从原始转写生成新字幕时，先完成片段顺序和裁剪，再根据最终序列计算字幕位置。磁吸模式下某片段序列起点为此前片段长度之和，自由模式使用其 startFrame；源帧 `s` 在该片段的字幕位置为 `片段序列起点 + s - clip.inFrame`，只保留与 `[clip.inFrame, clip.outFrame)` 相交的文字段。

追加字幕应使用新的有效 ID（字母、数字、连字符、点、下划线或冒号，最长 128 字符），避免覆盖用户已有字幕。润色已有字幕保留其 ID 和时间范围，除非用户同时要求重排。

提交前验证总时长、关键内容是否保留、字幕是否越界，以及新增场景是否真的进入序列。导出前再次读取当前修订号，避免把旧工程版本传给渲染任务。

## 独立音乐与配音轨

`audio-add {assetId,startFrame?,inFrame?,outFrame?,volume?}` 在已有画面序列上添加音频或视频素材的声音，默认从时间轴 0 开始并裁到画面末尾；背景音乐可根据实际试听选较低音量。`audio-trim {clipId,inFrame,outFrame}` 裁源范围，`audio-move {clipId,startFrame}` 移动时间轴位置，`audio-volume {clipId,volume}` 调音量 0..2，`audio-remove {clipId}` 删除音轨。

`audio-split {clipId,atFrame}` 在源绝对帧切分独立音轨，要求 `inFrame < atFrame < outFrame`。左段保留原 ID、入点与序列起点，出点改为 `atFrame`；右段使用新 ID、入点 `atFrame`、原出点，序列起点为 `原 startFrame + atFrame - 原 inFrame`。两段保留原音量，画面、其他音轨及字幕时间不变。若从播放头序列帧切分，先换算 `atFrame = 原 inFrame + 播放头帧 - 原 startFrame`。拆分后重新读取工程获取右段实际 ID，不提前猜测。

独立音轨最多 64 条，必须完整落在画面序列内。画面删除/裁剪/重排会同步移动对应的声音时间区间；被删除的时间会从音轨中裁去，必要时拆成多个片段。`startFrame` 是音轨在序列的位置；`inFrame/outFrame` 是音频源帧。添加/拆分后重新读取实际 clip ID。
