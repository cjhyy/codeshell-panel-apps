# Panel 工具契约

使用 `Panel` 调用 video-studio 的下列工具。以本次工具返回的能力与字段为准；若旧版面板缺少工具，说明当前能力，不编造替代调用。工程素材 ID 与 Host 持久素材 ID 可能不同，始终使用对应工具返回的映射。

| 工具                   | 参数                                                                                                                                          | 用途                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `read_video_project`   | `{}`                                                                                                                                          | 读取当前工程、`requestToken`、播放位置、素材与可用能力。工程身份为 `project.id`，修订号为 `project.revision`。 |
| `prepare_video_assets` | `{projectId: string, requestToken: string, assetIds: string[], transcribe?: boolean}`                                                         | 为选定工程素材创建预处理任务。根据返回值保存任务 ID；只对真实已导入素材调用。                                  |
| `get_video_jobs`       | `{jobIds?: string[]}`                                                                                                                         | 查询制作任务；传本次任务 ID 避免无关记录。                                                                     |
| `get_video_transcript` | `{assetId: string, offset?: number, limit?: number}`                                                                                          | 分页读取素材转写。时间戳是该素材源文件中的秒数，不是剪辑后序列位置。                                           |
| `create_video_scene`   | `{projectId: string, requestToken: string, title: string, subtitle?: string, durationSeconds?: number, background?: string, accent?: string}` | 创建并真实渲染 HyperFrames 场景，返回制作任务。颜色使用 `#RRGGBB`，长度以用户目标为准。                        |
| `apply_video_edit`     | `{projectId: string, requestToken: string, baseRevision: number, title: string, operations: EditOperation[]}`                                 | 自动制作模式下保存版本并原子应用修改。身份、令牌和修订号都必须来自本次工程读取。                               |
| `render_video_project` | `{projectId: string, requestToken: string, baseRevision: number}`                                                                             | 导出当前版本的 MP4。结果通过制作任务返回。                                                                     |
| `propose_video_edit`   | 与 `apply_video_edit` 相同，可含 `explanation: string`                                                                                        | 仅提交待审阅方案，适用于用户要求先确认或当前只开放提案能力。                                                   |

`get_video_jobs` 的任务状态为 `queued`、`running`、`succeeded`、`failed` 或 `cancelled`。只有 `succeeded` 才读取 `result` 作为产物；失败看 `error`，取消不能报告成功。一次任务查询可以包含多个 ID。先完成独立的内容准备，再间隔查询；不要把等待写成数百次快速重复调用。

所有写工具（预处理、创建场景、生成配音、应用剪辑、导出、提案）必须带入刚读取的 `projectId` 与本次 `requestToken`，不能复用旧任务或旧工程的令牌；应用/提案/导出另需匹配 `baseRevision`。身份错误时重新读取并检查任务是否仍有效，不盲目改字段重放。

新素材生成和导入可能更新工程修订号。在生成任务完成后重新读取工程，再计算需要提交的剪辑操作。不要假设所有任务完成顺序与提交顺序一致。

如果当前工具只支持参数化标题场景，就使用该能力。已有 HyperFrames 工程导入、复杂解释场景或额外场景参数必须等当前工具实际开放相应字段后再使用，不向 `create_video_scene` 传未经支持的目录或 HTML。

## 视觉证据与分析

`inspect_video_frame({assetId,seconds?:number})` 返回实际 JPEG 图像内容（最长边 640 像素），秒数相对源素材。图片用 0 秒。先检查少量代表性关键帧，再按用户目标细看相关片段；不要逐帧扫描整条视频。

`get_video_analysis({assetId,kind:'silence'|'scenes',offset?,limit?})` 分页返回真实能量静音区间或镜头切点，时间为源秒。`total` 表示总数。检测结果提供候选位置，不能独立证明语义或剪辑价值。

`create_video_scene` 还支持 `kind:'chapter'|'explainer'`（默认 chapter）和 `bullets:string[]`（最多 4 条，每条最多 140 字）。解释场景可用要点，所有标题与数据应有依据。

## 自动制作的恢复

初始化与全流程入口分别加载 `video-init` 和 `video-workflow`，由技能读取已有准备结果并按内容需要补充预处理/转写，不在开始时一律转写全部素材。模型每轮最多 20 次交互。后台场景和导出任务已提交时，可以说明它们仍在进行，工作台会跟踪结果。若上一轮等待耗尽预算，工作台会在任务完成后以同一目标继续，最多三轮。继续时先读取当前工程、制作单和任务，复用已有场景和编辑，禁止重复导出已经成功的同一版本。初始化保存制作单后结束；无制作单、无待处理任务而结束 Agent 会报告初始化未完成。

## 真实文字配音

- `get_video_voices({})` 返回 `{available,engine?,defaultVoiceId?,reason?,voices:[{id,name,language}],defaultModelId?,models:[{id,name,provider,available,reason?,voices,defaultVoiceId?,maxTextLength,supportsInstructions,supportsVoiceCloning?}]}`。模型和音色必须取自工具目录；换模型后重新选择对应声音。默认模型来自 defaultModelId。Audio8 / Qwen 条目由面板本地运行环境检查得到，不依赖 Host 内置模型；缺失或不可用时保留具体 reason，不能编造可用状态。
- `create_video_voiceover({projectId,requestToken,text,modelId?,voiceId?,rate?,instructions?,referenceAssetId?,referenceText?})` 提交持久配音任务；文案不超过模型 maxTextLength 与 5000 字的较小值，语速 0.5–2。仅 supportsInstructions 为真时传入风格说明。身份字段必须匹配本次自动任务。
- 成功结果包含 `asset`、`inspection.durationSeconds`、`speech:{text,voiceId,engine,modelId?,instructions?,referenceAssetId?,referenceText?,rate}`。工作台将真实音频加入工程素材库。重新读取工程后用 `audio-add` 加入独立轨道，语音 `volume:1`；此工具不自动裁剪或放置语音。先根据真实时长安排画面，保留完整句尾。
- 配音是实际音频素材，可预览、混入 MP4，也可单独保存音频。它没有真实 ASR 词级时间戳，不得将合成文本声称为精确转写。

## 录制、原声与配音引擎

- `get_video_voices {}`：模型与声音目录，也包含固定引擎的安装/验证状态及 online/offline 模式。
- `setup_video_tts {projectId,requestToken,providerId}`：providerId 为 edge-tts、kokoro、audio8-tts 或 qwen3-tts，返回任务；等待完成后刷新声音目录。Audio8 / Qwen 是面板管理的本地引擎，通过通用进程接口运行，关闭面板会中断任务，重开可重试。qwen3-tts 是 Apple Silicon Mac 本地本人声音克隆；使用 `create_video_voiceover` 时指定 `modelId: "qwen3-tts"`、`voiceId: "reference"`、当前工程中 3–30 秒本人音频的 `referenceAssetId` 和对应逐字稿 `referenceText`，要新读的 `text` 最多 2000 字。详细安装流程见 tts-setup。
- `enhance_video_audio {projectId,requestToken,assetId,preset?,denoise?,normalize?}`：preset 为 light/balanced，返回完整优化音频任务，不自动改音轨。结果入库后复用源片段的时间范围并静音原声。
- `set_video_script {projectId,requestToken,baseRevision,text,finish?}`：保存润色文稿，保留原录音；仅文稿任务可 finish:true 停止制作循环。

## 初始化声音专用工具

- `extract_video_reference({projectId,requestToken,assetId,inFrame,outFrame})`：从用户指定的工程音频/视频素材中提取 3–30 秒实际 WAV；区间为 30 fps 源半开整数帧。等待任务成功后按 result.asset.id 对应工程 mediaId，取得新音频的工程 ID。只保存素材，不入轨。
- `prepare_video_voice({projectId,requestToken,text,modelId,voiceId?,rate?,instructions?,referenceAssetId?,referenceText?})`：最多 120 字短试听，默认语速 1，输出与 create_video_voiceover 相同的 asset/inspection/speech；始终只保存素材。初始化只允许用户配置中的模型、参考录音、实际逐字稿与短文，不允许完整旁白。
- `audio8-tts` 和 `qwen3-tts` 都接受 `voiceId:"reference"`、3–30 秒完整音频、最多 1000 字实际逐字稿，完整配音文案最多 2000 字。粗剪标记没有生成参考文件，必须先执行提取。
- 初始化最后保存 initialized workflow 会结束任务，安装/提取/短试听要在此之前完成。安装成功而缺录音时保留安装，记录下一步，不能声称本人音色就绪。
