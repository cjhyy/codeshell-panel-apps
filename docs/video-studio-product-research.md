# 视频工作台：产品调研与实现进展

调研日期：2026-09-08。资料来自产品官方页面与帮助中心，访问日期均为当日；这是公开功能核查，未登录付费账户进行性能、中文识别或导出质量实测。页面未给出明确发布日期的，不推断发布时间。

本次用户请求是优化面板仓库结构，并参考当前 AI 视频剪辑产品实现一个视频工作台版本。CodeShell 中的 `docs/todo/video-studio-panel.md` 是 2026-09-07 的讨论稿，提供工程模型和 Host 边界背景；其中分阶段计划与验收设想不等于本次已经实现或必须全部同时完成的能力。

## 官方产品的共同做法与差异

| 产品 | 已核查的工作流 | 对 CodeShell V1 的启发 |
| --- | --- | --- |
| Descript | 导入素材后围绕转写文本剪辑，编辑文字联动媒体；Underlord 接受自然语言要求并在工程中执行编辑。官方入门指引建议说明受众、时长、节奏和用途。 | 文稿应该是时间轴的另一种入口；AI 请求带上选中片段、目标时长和工程状态。为人保留直接编辑入口。 |
| CapCut | 脚本生成、素材组合、字幕等能力最终进入多轨编辑器继续替换、微调；长视频转短视频产品从长素材提取候选片段，再进行包装与导出。 | 快捷任务围绕“教程精简”“竖版片段”“字幕整理”；比例、长度、字幕样式作为显式参数，生成结果仍能编辑。 |
| Adobe Premiere | Media Intelligence 以描述搜索素材；Text-Based Editing 从转写建立和调整粗剪；Generative Extend 在时间轴中扩展片段。 | AI 功能嵌入素材检索、剪辑、交付等具体步骤。搜索结果和建议必须有源素材与时间位置，不停留在对话回答。 |
| VEED | Magic Cut 选择片段后分析口播，去停顿、口头词等；结果先预览，可以手工调整、撤销，再导出。当前帮助文档标注该工具仅支持英语。 | 采用“分析结果 → 逐项审阅 → 应用 → 撤销”的闭环；中文能力必须单独验证，不能从海外产品宣传推定。 |
| Runway | Aleph 2.0 通过编辑参考帧和提示改变现有视频内容，例如背景、服装、光照；官方 Workflows 用节点组合可重复的生成流程。 | 生成式画面修改与时间轴剪辑是不同能力。以后可把生成任务的结果作为新素材导入，V1 无需实现节点画布或镜头重绘。 |

官方来源：

- Descript：[视频编辑产品页](https://www.descript.com/video-editing)、[Underlord 入门指引](https://www.descript.com/blog/article/underlord-ai-video-editor-primer)。
- CapCut：[Script to Video 的多轨后续编辑](https://www.capcut.com/tools/script-to-video-maker)、[AI Shorts Maker](https://www.capcut.com/resource/ai-shorts-maker)。
- Adobe：[Premiere AI 编辑功能](https://www.adobe.com/products/premiere/ai-video-editing.html)。
- VEED：[Magic Cut 操作与限制](https://support.veed.io/en/articles/11589317-how-to-use-our-magic-cut-tool)。
- Runway：[Aleph 2.0 提示指南](https://help.runwayml.com/hc/en-us/articles/52150503729171-Aleph-2-0-Prompting-Guide)、[Workflows 简介](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)。

## 补充核验：完整工作台的能力覆盖

2026-09-08 补充。下表是官方公开工作流核验，不代表已购买套餐实测，也不是本次交付完成表。`未确认` 表示本次来源不足，不能解释为产品没有此能力。云端成片、保存工程、上传恢复、渲染任务恢复是不同能力；没有明确文档时，不把“云导出”写成断点续渲染。

| 能力 | Descript | CapCut | VEED | Adobe Premiere / Firefly | Riverside |
| --- | --- | --- | --- | --- | --- |
| 录制入口 | 编辑器录音、摄像头、屏幕；桌面系统声音与网页标签声音有区别 [D1] | 网页录屏、素材导入；桌面/网页能力需分别核验 [C1] | 网页摄像头/屏幕录制，进入编辑器 [V1] | Premiere 原声轨编辑；本表未确认集成屏幕录制 | 在线录制与分轨素材，进入编辑器 [R1][R2] |
| 文稿剪辑 | 改文字联动音画 [D2] | 转写与时间轴联动剪切 [C1] | Magic Cut 整理口播；任意文稿操作与桌面 NLE 的等价性未确认 [V1] | 按时间码选取/重排文本生成粗剪；最终字幕另生成 [A1] | 每个词和停顿可作为编辑入口 [R1] |
| 口头词 / 停顿 | 去口头词、缩短词间空隙 [D2] | 转写中检测与移除，需逐项复听 [C1][C2] | Magic Cut；当前帮助页明确仅英语 [V2] | 文字/口头词/停顿筛选与批量删除 [A2] | 去口头词、静音；处理后仍可编辑 [R1][R3] |
| 降噪 / 响度 | Studio Sound，保留人工调整 [D2] | 降噪与响度归一化 [C2] | Clean Audio 去噪并平衡音量；免费账户仅一次，付费档完整访问 [V3] | Enhance Speech；与音量混音分别处理 [A3] | Magic Audio 与单轨音量/静音控制 [R1][R3] |
| TTS / 原声 | AI 声音/修补文字与原录音 [D2] | TTS/配音及原声轨 [C1][C2] | TTS、旁白与音乐可加入工程 [V1] | Firefly Generate Speech 是另一产品入口，可下载后用于剪辑 [A4] | AI Voice 与原始分轨录音 [R2][R3] |
| 字幕 / 重构 / 短片 | 字幕模板、社交短片 [D2] | 自动字幕、自动重构、长转短；语言/端/套餐存在差异 [C1][C3] | 字幕与包装；主体跟随不由本次来源推断 [V1] | 转写后字幕、Auto Reframe [A1][A3] | 字幕、Magic Clips 与版式 [R1][R3] |
| 可恢复的制作与导出 | 工程编辑、云端渲染分享页；断点续渲染未确认 [D3] | 可编辑工程及参数化本地导出；中断续渲染未确认 [C2] | 工程继续编辑、MP3/MP4 输出；断点续渲染未确认 [V1] | Media Encoder 独立队列有状态、暂停/重新排队；不是所有编码器均能从中断帧续算 [A5] | 原始轨与编辑结果分别保留；MP4/WAV/MP3 输出；断点续渲染未确认 [R2] |

来源（均为厂商官方）：

- [D1 编辑器录制](https://help.descript.com/hc/en-us/articles/10165880081293)、[D2 产品工作流](https://www.descript.com/tour)、[D3 云端分享页与导出](https://help.descript.com/hc/en-us/articles/10255817744653-Publish-content-with-Descript-web-links)。
- [C1 文稿剪辑](https://www.capcut.com/tools/video-transcript-editing)、[C2 音频修补与降噪/响度](https://www.capcut.com/tools/overdub-audio-with-ai)、[C3 AI 工具与重构](https://www.capcut.com/resource/capcut-ai)。
- [V1 录制、去口头词与导出](https://www.veed.io/tools/filler-remover)、[V2 Magic Cut 限制](https://support.veed.io/en/articles/11589317-how-to-use-our-magic-cut-tool)、[V3 Clean Audio](https://support.veed.io/en/articles/11662250-how-to-use-the-clean-audio-tool)。
- [A1 文稿剪辑边界](https://helpx.adobe.com/uk/premiere/desktop/edit-projects/edit-video-using-text-based-editing/overview-of-text-based-editing.html)、[A2 删除停顿](https://helpx.adobe.com/premiere/desktop/edit-projects/edit-video-using-text-based-editing/detect-and-delete-pauses-in-transcripts.html)、[A3 Premiere AI 能力](https://www.adobe.com/products/premiere/ai-video-editing.html)、[A4 Firefly 配音](https://helpx.adobe.com/uk/firefly/web/work-with-audio-and-video/work-with-audio/generate-speech-from-text.html)、[A5 Media Encoder 队列参考](https://helpx.adobe.com/content/dam/help/en/pdf/mediaencoder_reference.pdf)。
- [R1 编辑器](https://riverside.fm/video-editor)、[R2 原始轨与导出格式](https://support.riverside.com/hc/en-us/articles/5260131045917-Video-and-audio-file-formats-Overview)、[R3 AI 工具](https://support.riverside.com/hc/en-us/articles/13315511579037-AI-Tools-Overview)。

本次工程优先补齐录制/导入、带证据的文稿剪辑、可审阅口头词与停顿、确定性降噪与响度、真实配音、字幕包装、工程版本和可重试后台导出。模型降噪、语义最佳片段、主体自动跟随必须有实际处理器才可宣称支持。生成镜头、商业素材托管、数字人、多人云录制及整套协作平台不自动纳入本次必做；这里参考的是制作链的完整性，不宣称与任何一家产品全面等价。

### 配音运行方式

- [edge-tts](https://github.com/rany2/edge-tts) 是第三方客户端，调用 Edge 在线声音，无需 API key；安装成功不代表在线服务可达，也不构成微软官方 API 承诺。
- 本地 [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx) 使用单独模型、声音和语音前端；本机已有 HyperFrames 的 v1.0 缓存可经大小/哈希核验后复用。准备完成后本地推理无需网络。声音质量、中文与混合语言需要实际短句验收，不能把能产生 WAV 等同于所有语言效果合格。

当前处理器固定 `edge-tts 7.2.8`、`kokoro-onnx 0.6.1`、`misaki[zh] 0.9.4`、`soundfile 0.14.0`、`onnxruntime 1.29.0`，使用独立 Python 3.12 环境，安装器依赖 Host 已有的 `uv`、Python 3.12、FFmpeg/ffprobe。首版安装器明确支持 macOS/Linux 的 ARM64/x64；其他平台报告不可用，不假装安装成功。包及依赖下载量是估计值，模型文件按固定大小和 SHA-256 验证。

| 实际使用资源 | 固定文件大小 | 许可 / 发布源 |
| --- | ---: | --- |
| Kokoro **v1.0** ONNX（不是 v1.1-zh） | `325,532,387` 字节，约 310.45 MiB | [kokoro-onnx model-files-v1.1 发布资源](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1)；模型 Apache-2.0，运行库 MIT，见 [官方许可说明](https://github.com/thewh1teagle/kokoro-onnx#license) |
| `voices-v1.0.bin` | `28,214,398` 字节，约 26.91 MiB | 同一固定发布版，来源于 Kokoro 声音包；具体声音说明见 [模型作者声音清单](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) |

本机真实验收：Edge 获取 322 个声音，中文 Xiaoxiao 输出 4.344 秒、PCM RMS 0.0964；Kokoro 对当前安装前端开放 36 个中英文声音，`zf_xiaobei` 输出 3.499 秒、PCM RMS 0.1154。两者输出均为 48 kHz 单声道 PCM WAV；0.5/2 倍语速实际改变时长、损坏缓存重生成、取消清理与普通文案隔离测试通过。Kokoro 合成进程显式禁用网络连接。该数量是当次验收快照，Edge 在线目录以后可能变化；RMS 证明输出非静音，不是主观音质排名。

## V1 原始取舍

以下为基于调研的产品判断，不是上述厂商的承诺。

以下保留最初 V1 的设计判断，当前实现已进一步接通持久制作。实际交付以 [Video Studio README](../apps/video-studio/README.md) 为准：新增 Host 原文件库、代理预览、真实静音/镜头检测、本地转写、关键帧多模态工具、独立音乐轨、跨重启工程版本、HyperFrames 场景和后台 MP4。自动制作使用随包 Skill，通过同一原子操作层保存版本并执行；用户明确只需方案时仍可使用审阅流程。当前 0.4 已加入逐项采纳、本人录制、原声优化与引擎安装；主体跟随、任意镜头重绘与通用语义素材搜索仍未实现。

首个场景选择录屏教程与口播整理。核心操作链为：**导入真实媒体 → 播放定位 → 切分 / 裁剪 / 排序 → 编辑字幕 → 请求 AI 建议 → 检查并应用 → 保存可编辑工程 → 导出支持的结果**。以能反复修改的工程为中心，优先打通已有素材的编辑。

界面建议分成左侧素材 / 文稿，中间预览，右侧片段属性 / AI 建议，下方时间轴。顶栏明确工程名、保存状态、撤销 / 重做和导出。空工程提示导入；示例工程必须标记“示例”，样例转写与建议不能混入真实素材。

| V1 功能 | 可检查的完成结果 |
| --- | --- |
| 媒体导入与预览 | 素材名称、实际时长、播放与定位；失效或未授权素材能重新关联。 |
| 基础剪辑 | 片段保留源入点 / 出点；切分、裁剪、重排实际改变播放顺序，撤销恢复原状态。 |
| 文稿与字幕 | 导入有时间戳的 SRT 或人工编辑字幕；点击文字定位画面，字幕编辑明确区分“改字幕”和“删除对应音画”。 |
| AI 协作 | 将选区、片段 ID、工程版本、用户目标送入现有 Agent；返回具体操作或待审建议，执行后工程和预览同步更新。 |
| 建议审阅 | 展示操作原因、受影响片段、源时间范围和预期时长变化；支持逐项应用、跳过及整批撤销。 |
| 工程与交付 | 持久化工程及编辑历史；工程 JSON、SRT、视频渲染分别显示实际支持情况和结果路径。 |

工程建议使用版本号与明确时间单位；人工与 Agent 共用同一操作层，批量操作校验 `baseRevision`，过期计划不能覆盖新的人工编辑。读工程、读选区、修改片段、改字幕、提交建议和导出应形成清晰的工具契约。生成短版时建立独立版本，保留原工程。

## 能力真实性与后续接入

- **真实 AI 与规则工具分开标识。** 固定规则清理、等时切分、预置建议可以存在，但应叫“规则建议”或“示例”；不得模拟进度后宣称已完成 AI 分析。
- **没有带时间戳的转写，就不宣称文字剪辑已识别语音。** 可以先导入 SRT 或人工标注；纯文本不能自动冒充词级时间对齐结果。没有实际检测结果，也不能声称找到静音、重复演示或最佳片段。
- **Agent 输出仍需验证。** 操作必须引用现有素材 / 片段、有效时间范围和当前版本；模型响应失败时保留工程并展示可重试状态。多轮提示、片段检索、版本检查比一个“自动成片”按钮更适合 V1。
- **只对真实导出结果显示成功。** 下载工程或生成渲染计划不等于导出 MP4；若使用浏览器录制导出，应标出真实容器、实时耗时与面板需要保持打开的限制；当前 Host 已接入持久后台 MP4，界面只在任务成功并返回实际资产时显示完成。
- **Host 缺口是工程依赖。** 讨论稿提及的大文件授权、Range 播放、长媒体时间戳转写、关闭面板后持续导出，需要根据实际 API 核验并逐项实现。面板包不应偷偷带入任意后台服务，或将整段视频打包为 JSON / Base64 绕过媒体边界。0.4 录制使用 Host 授权、限额与顺序验证的 32 KiB 分块写入，再做真实媒体探测。
- **延后镜头生成与复杂智能重构。** HyperFrames 参数化章节/解释场景现已接通。通用视觉语义检索、主体跟随和镜头重绘仍未实现；关键帧与转写支持的是本次素材的有证据剪辑判断，不等于这些完整产品能力。

最小回归场景：导入一段真实录屏，剪成三个片段、调整顺序并修改字幕，检查音画和字幕定位；撤销并恢复，保存后重开；让 Agent 修改同一个工程，核对操作记录；导出并实际播放支持的文件。另测素材缺失、无转写、过期 AI 计划和导出失败，保证界面不误报成功。
