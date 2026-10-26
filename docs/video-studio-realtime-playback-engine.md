# 视频工作台实时播放引擎：技术方案

状态：**草案，待评审**（2026-10-26）。基线：`codeshell-panel-apps` `e2b391f`，视频工作台 0.8.0 源码。

参照对象是 CapCut Web 的做法：WebCodecs 硬件解码原片、自管解码与帧缓存、按音频时钟调度画面、实时混音，预览与导出共用同一套合成逻辑。本方案只改面板，不需要新的 Host 能力，也不改工程格式。

## 1. 现状与问题

首次点击播放前，面板要依次完成：

| # | 步骤 | 位置 | 读写成本 |
| --- | --- | --- | --- |
| 1 | 原片 SHA-256 | `native/editor-runtime/runtime.ts:354` | 读整片一遍 |
| 2 | ffprobe 逐帧扫描时间戳 | `native/editor-runtime/proxy.ts:290` | 解码整片一遍 |
| 3 | libx264 转 ≤1080p 预览代理 | `proxy.ts:322` | 解码 + 编码一遍 |
| 4 | 复扫代理时间戳并比对 | `proxy.ts:355` | 解码代理一遍 |
| 5 | 再次校验原片 SHA-256 | `runtime.ts:371` | 读整片一遍 |
| 6 | 整条序列离线混音 | `src/main.ts:6307` → `editor-audio-renderer.ts` | 完整解码所有发声源 |

上面 1–5 对**每个视频**都执行，浏览器能直接解码的 H.264 1080p 也不例外。上一轮修复（`918336e`）只是把范围缩小到当前画面里的视频，没有去掉这些步骤。

播放过程中还有两个影响流畅度的问题：

- **每帧都要寻帧**：`EditorPreview.play` 每到一帧就调用 `EditorMediaPool.prepare`（`preview.ts:351`），对暂停中的 `<video>` 设置 `currentTime`，等 `seeked` 后再取 `VideoFrame`（`media-pool.ts:551`），视频元素从不真正播放。Chromium 每次寻帧都要从前一个关键帧重新解码（**待 M0 实测确认**），而代理沿用 x264 默认 GOP（约 250 帧）。
- **切点卡顿**：`prepare` 会释放不在当前画面的解码实例（`media-pool.ts:595`），下一段素材要到切点才新建 `<video>` 并等待首帧。

另外，调色与部分混合模式走 `getImageData → CPU 逐像素 → putImageData`（`compositor.ts:325`、`:468`），1080p 每帧要处理约 8 MB 像素数据。

## 2. 目标与非目标

**目标**

| 指标 | 目标值（M1 Pro / 16 GB，1080p30 工程） |
| --- | --- |
| 兼容原片首次点击播放到出画 | P50 < 500 ms，P95 < 1.5 s |
| 已打开工程再次播放 | P50 < 150 ms |
| 两轨 1080p H.264 无调色，连续播放 60 s | 丢帧 < 0.5 % |
| 剪辑切点 | 不出现 > 1 帧的停顿 |
| 修改音量 / 声像 / 淡入淡出后听到变化 | < 100 ms，无需重新准备 |
| 不兼容素材（ProRes 等） | 只有它所在的时间段等待代理，其余照常播放 |
| 导出结果 | 与现状逐帧一致（M5 之前导出路径不变） |

**非目标**：HDR / 广色域预览（与导出一致，仍拒绝）；云端或远程 Host 播放（`resources.preview` 现状不变）；工程格式变更；重写导出管线。

## 3. 从 CapCut 方案里取什么

| CapCut Web 做法 | 我们的取舍 |
| --- | --- |
| C++ 引擎编译为 WebAssembly | **不取**。我们的求值器、合成器、混音计划本来就是 TS，重写没有收益 |
| WebCodecs 硬件解码原片，不先转码 | **取**。核心改动 |
| 自管 demux、解码队列、帧缓存，连续播放一路往前解 | **取**。用 Mediabunny（纯 TS，零依赖）做 demux，WebCodecs 解码 |
| 播放以音频时钟为准，画面跟不上就丢帧或保持上一帧 | **取** |
| 实时混音（在 WASM 里混） | **取**。改为在 AudioWorklet 里混，复用 `audio-plan.ts` 的计算 |
| 预览与导出同一引擎 | **已有**：`render-entry.ts` 与预览共用 `FrameCompositor` / `EditorMediaPool`。M5 再考虑导出也换新解码器 |
| GPU 合成与特效 | **推迟**。先测量；GPU 输出与现有 Canvas2D 像素不一致，会牵动导出一致性 |

## 4. 总体架构

```
             ┌──────────────── EditorPreview（保留 API）────────────────┐
             │                                                          │
 文档/序列 ──► Evaluator（现有） ──► PlaybackScheduler ──► FrameCompositor（现有）──► canvas
             │                       ▲   │ 主时钟 = AudioContext.currentTime
             │                       │   ▼
             │        VideoSourceManager ── 每个片段实例一个 SourceDecoder
             │          │  direct：Mediabunny UrlSource(Range) → VideoDecoder → 帧环形缓存
             │          │  proxy ：同上，读代理文件（仅在原片不可解时）
             │          └  legacy：现有 EditorMediaPool（解码失败的兜底）
             │
             │        AudioEngine ── AudioWorklet 混音器
             │          ├ 实时声道：Mediabunny AudioDecoder 按段解码 → 增益/声像/淡入淡出
             │          └ 预渲染声道：原生渲染该声道的 PCM 段（变调、闪避）
             │
             └── ReadinessTracker ── 每个素材的状态 → 时间线状态条
                       └ 后台：指纹校验、代理生成、时间戳检查（都不阻塞播放）
```

`EditorPreview` 的公开方法（`setDocument`、`seek`、`play`、`pause`、`captureFrame`、`previewDraft`）保持不变，`EditorWorkspace` 与 `main.ts` 的调用方式基本不动。`prepareAudio` 回调在 M2 之后退化为“只准备预渲染声道”。

## 5. 视频：源选择与解码

### 5.1 源选择（每个素材一次，结果缓存）

1. 用 `resourcePreviewUrl` 取得原片地址（`external-` / `asset-` 都支持；Host 端已支持 Range，见 `codeshell/packages/server/src/panels/runtime.test.ts` 的 Range 用例）。
2. Mediabunny `Input({ source: new UrlSource(url), formats: ALL_FORMATS })` 读容器头，取主视频轨的 `getDecoderConfig()`、旋转角和首帧时间。
3. 用 `VideoDecoder.isConfigSupported(config)` 判断能否解码，`hardwareAcceleration: "prefer-hardware"`。
4. 按同一套规则判定（复用 `describeEditorVideo` 的判断，HDR / 透明通道仍拒绝）：

| 结果 | 条件 | 播放源 |
| --- | --- | --- |
| `direct` | 可解码、SDR、尺寸 ≤ 4096（硬解可放宽到 8192） | 原片 |
| `proxy-required` | 容器或编码不可解（ProRes、DNxHD、部分 AVI/MPEG-2） | 后台生成代理，只有用到它的时间段等待 |
| `rejected` | HDR、透明、非直角旋转等导出也拒绝的情况 | 与现在相同的错误提示 |

`direct` 素材**不再生成预览代理**。只有当性能监测（§6.3）发现某素材持续丢帧，比如 4K 多层叠加时，才在后台为它生成代理，生成好之后切换过去。

### 5.2 SourceDecoder：帧缓存解码器

每个可见的片段实例对应一个 `SourceDecoder`，与现在每实例一个 `<video>` 的语义一致：

- **连续播放**：维护一个按时间戳排序的 `VideoFrame` 环形缓存，预解码到播放头前方 `max(0.5 s, 8 帧)`，同时受字节预算约束（默认全局 384 MB，按 `codedWidth × codedHeight × 1.5` 估算）。播放头后方的帧立即 `close()`。
- **精确取帧** `frameAt(tick)`：缓存命中就直接返回；否则用 demuxer 找 ≤ 目标的关键帧，`decoder.reset()` 后从关键帧解码到目标，丢弃前面的帧。命中规则与现在 `seekVideo` 相同：`timestamp ≤ t < timestamp + duration`。精度语义因此与现状一致，暂停、拖动、截 PNG 都用这条路径。
- **拖动播放头**：只保留最新目标。先显示最近关键帧（快），解到目标后再替换（与 CapCut、Premiere 的拖动手感一致）。
- **切点预热**：调度器在切点前 2 s 用求值器向前看（把 `editorPreviewVideoPlan` 推广为按时间窗口列出即将出现的实例），提前建好 `SourceDecoder` 并解码到入点帧。
- **解码器数量**：硬件解码器数量有限，全局上限默认 8 个活动实例，超出时按最久未用释放；预热实例优先级最低。
- **失败兜底**：解码器 `error` 或 `isConfigSupported` 与实际结果不符时，该素材降级为 `proxy-required`，本次播放回退到现有 `EditorMediaPool` 路径。`media-pool.ts` 在 M5 之前保持原样，导出仍在用它。

### 5.3 时间、颜色、方向

- **时间**：WebCodecs 时间戳单位是微秒；编辑器 tick 为 1/240000 s，`tick = round(µs × 0.24)`。首帧时间不为 0 的素材，用 demuxer 给出的首帧时间作为原点（对应现在的 `sourceOriginSeconds`）。导出路径目前拒绝“首帧晚于素材起点”的情况，因此预览照常播放，同时由后台检查（§7）标出“导出前需要整理”，不阻塞播放。
- **颜色**：`VideoDecoderConfig.colorSpace` 可以覆盖容器标记。未标记的素材按 `describeEditorVideo` 的假设填写（SD 用 smpte170m，其余 bt709），预览和导出的色彩假设因此一致。
- **方向与像素比**：旋转角由 Mediabunny 给出，在 `SourceSurface` 适配层绘制时套变换；非方形像素按 `displayWidth / displayHeight` 处理。合成器仍按素材的显示尺寸布局，`fitVisualSource` 不变。

## 6. 播放调度

### 6.1 时钟

工程有声音时，主时钟是 `AudioContext.currentTime`；没有声音时用 `performance.now()`。这与现有逻辑相同。区别在于时钟**不再等画面**：

```
rAF:
  t = clock()
  frame = evaluator.evaluate(seq, snap(t))
  for layer in frame.media:
    surface[layer] = decoder[layer.instance].latestAtOrBefore(layer.sourceTime)   // 同步，不等待
  compositor.draw(canvas, frame, surface, resolution)
  scheduler.feed(t + lookahead)   // 通知各解码器往前解、预热下一段
```

### 6.2 跟不上时怎么办

- 某一层缺当前帧：先保持该层上一帧并计一次迟到帧。
- 连续缺帧超过 200 ms，或刚开播 / 刚跳转后首帧未就绪：进入缓冲状态，挂起 AudioContext，画面和声音同时停住，等就绪后一起恢复。沿用现有 `onBuffering` 回调。
- 首帧规则：点击播放后**只等起点画面的所有可见层和起点处 0.5 s 的声音**，其余边播边解。

### 6.3 观测

每次播放记录：从点击到出画的耗时、各素材首帧解码耗时、迟到帧和丢帧数、缓冲次数与时长、活动解码器数量和缓存字节数。开发模式下显示一个浮层；正式版通过已有的 Host 执行观测上报发送汇总。§5.1 的“持续丢帧就生成代理”也依据这组数据。

## 7. 素材就绪与后台任务

每个素材有一个就绪状态：`direct`、`proxy-generating`、`proxy-ready`、`proxy-required`、`rejected`、`changed`。时间线上方加一条细状态条（参照 Premiere 的渲染条）：

- 绿色：原片直放或代理已就绪；
- 黄色：正在后台生成代理（播放可能卡顿，但不阻塞）；
- 红色：素材不可解，代理就绪前该时间段显示占位画面，并在状态栏说明原因。

后台任务（低优先级，最多同时 2 个，沿用 `EditorSourcePreviews` 的队列）：

- **指纹校验**：Host 的 `resources.preview` 授权就是播放时的读取凭据；SHA-256 校验移到后台。发现变化时停止播放，标为 `changed`，提示重新连接。导出路径仍然完整校验。
- **时间戳与导出可行性检查**：复用现有的 native inspect；结果只作提示。
- **代理生成**（只针对 `proxy-required` 和性能降级的素材）：去掉复扫一遍，改为在编码时用 `-stats_enc_post`（FFmpeg 6.0+） 输出帧时间并与原片扫描结果比对；原片扫描改为读包级时间戳（`-show_packets`，不解码）；macOS 上优先使用 `hevc/h264_videotoolbox` 硬件解码。关键帧间隔设为 `-g 30`，旧播放路径兜底时寻帧也会更快。

## 8. 音频：实时混音

### 8.1 两层声道

`compileAudioPlan` 已经把序列编成一组声道（lane），每条声道带分段（span）、各级增益和声像、淡入淡出、音量曲线、播放速率、变调和闪避。按声道分两层：

| 层 | 条件 | 处理 |
| --- | --- | --- |
| 实时 | `playbackRate ∈ {1, -1}`，`pitchSemitones = 0`，不参与闪避 | 浏览器解码源 PCM，在 AudioWorklet 里实时计算增益、声像和淡入淡出 |
| 预渲染 | 变速保持音高（`atempo` WSOLA）、变调、闪避 | 原生渲染器只渲染**这一条声道**、**从播放头开始的一段**（先 10 s，后台继续往后），作为一路已混好的输入送进混音器 |

常见工程（原声 + 配音 + 背景音乐，调过音量和淡入淡出）全部属于实时层，播放前不需要任何原生任务。

### 8.2 混音器

- **AudioWorklet 混音器**：一个 `AudioWorkletProcessor`，输入是各声道按 128 帧块推送的 PCM，输出立体声。增益、声像、淡入淡出与音量曲线的计算**复用 `audio-plan.ts` 中原生渲染器用的那几个纯函数**（`sampleAudioLane` 等），预览与导出的结果因此在采样级别一致；不同的只有重采样。
- **PCM 供给**：主线程（M4 起改到 Worker）用 Mediabunny 的 `AudioBufferSink` 按段解码，保持播放头前方 2 s 的数据，经 `MessagePort` 转移 `Float32Array`。只有当面板被跨源隔离（crossOriginIsolated）时，才改用 `SharedArrayBuffer` 环形缓冲。
- **重采样**：非 48 kHz 的源在解码侧用带窗 sinc 重采样到 48 kHz，原生侧用的是 `aresample`。预览允许这一点差异。
- **编辑即时生效**：文档变化时重新编译计划，把新计划发给混音器，用 10 ms 交叉淡化切换。改音量、声像、淡入淡出因此不再触发重新准备；现在的“调音试听”修正声道机制在 M2 之后可以下线。
- **浏览器解不了的音频**（AC-3、部分 PCM 变体等）：退回原生解码，按段生成 PCM 缓存，与现有源 PCM 缓存共用。

### 8.3 与现有缓存的关系

- 导出继续使用原生完整混音，规则不变，已有的混音复用逻辑也不变。
- 波形继续由原生生成（`analyzeWaveform`）。

## 9. 导出一致性

- M1–M4 期间，导出路径（原生 + 无头 Chrome `render-entry` + 无损 VP9 代理 + `EditorMediaPool`）**完全不动**，`render-entry.ts` 不引用新解码器。
- 新解码器的 `frameAt` 必须通过逐帧一致性测试：在同一时刻与现有 `seekVideo` 取到的帧时间戳相同、像素差在阈值内。夹具覆盖：29.97 fps CFR、MediaRecorder VFR WebM、带 B 帧的 H.264、iPhone HEVC（旋转 90°、edit list）、首帧非零、SD 未标色彩。
- 实时混音必须通过声道级对比测试：同一计划下，实时层的输出与原生渲染器的输出（去掉重采样差异后）误差 < −90 dBFS。
- **M5（可选）**：导出改为从新解码器顺序解码，省去无损 VP9 中间件，换成顺序解码，导出会明显变快。前提是通过上述全部一致性测试，并在 golden 夹具上逐帧比对。

## 10. 依赖

- **Mediabunny**：MPL-2.0（文件级 copyleft；不修改源码直接打包没有额外义务，修改它的文件则要公开这些修改），纯 TypeScript、零依赖，支持 MP4/MOV/WebM/MKV/MPEG-TS/WAV/MP3/Ogg/FLAC 的 demux，并且支持基于 Range 的 `UrlSource`。2026-10-26 查到的最新版为 1.62.1（发布于 2026-10-22）；落地时**固定一个至少发布两周的精确版本**，作为 `apps/video-studio` 的运行时依赖由 esbuild 打包。打包体积需要在 M1 实测（可按需 tree-shake 格式）。
- 宿主环境：Desktop 使用 Electron 33（Chromium 130）。WebCodecs、AudioWorklet、macOS HEVC 硬件解码均可用；Windows 的 HEVC 取决于硬件，由 `isConfigSupported` 判定。

## 11. 分期

| 阶段 | 内容 | 预估 | 出口条件 |
| --- | --- | --- | --- |
| **M0 测量** | 给现有路径加分段计时（§1 的 1–6 步、每帧 `draw` 耗时）；在 5 个夹具工程上记录基线；验证面板沙箱里 Worker、AudioWorklet、`blob:` 模块能否加载；实测 Chromium 连续寻帧的成本 | 1 天 | **基线已测**（2026-10-26），见 [`video-studio-playback-baseline.md`](video-studio-playback-baseline.md)；沙箱加载验证仍待做 |
| **M1 视频直放** | Mediabunny 接入；`SourceDecoder` 帧缓存、精确取帧、切点预热；`PlaybackScheduler` 不再逐帧等待；源选择与旧播放路径兜底；`prepareVideoForPreview` 只对 `proxy-required` 素材调用 | 1–1.5 周 | §2 中视频相关指标达标；逐帧一致性测试通过 |
| **M2 实时混音** | AudioWorklet 混音器；实时层与预渲染层；编辑即时生效；`prepareAudio` 退化为只准备预渲染声道 | 1.5–2 周 | 声道级对比测试通过；调音即时生效 |
| **M3 后台就绪** | `ReadinessTracker` 与状态条；指纹校验和导出可行性检查移到后台；代理生成提速 | 1 周 | 不兼容素材只影响它所在的时间段 |
| **M4 性能深化（按 M0–M3 数据决定）** | 解码与 PCM 供给移入 Worker；调色和混合模式改为 GPU（WebGL2）实现，只在预览使用时须给出与导出的像素差上限 | 视数据而定 | — |
| **M5 导出共用（可选）** | 见 §9 | 1–2 周 | golden 逐帧比对通过 |

各阶段可以单独发布；M1 完成后就能获得大部分体感收益。

## 12. 风险与待验证

| 风险 | 应对 |
| --- | --- |
| 面板沙箱的 CSP 不允许 `blob:` Worker 或 AudioWorklet 模块 | M0 先验证；不行的话 AudioWorklet 模块作为独立浏览器入口打包（`panel.build.json` 已支持 `browserEntries`），再不行就退回 Web Audio 节点图（实时层仍可用，曲线插值与原生会略有差异） |
| 硬件解码器数量和 GPU 内存耗尽 | 全局实例上限 + 字节预算 + 每帧及时 `close()`；在测试里统计泄漏的 `VideoFrame` |
| iPhone MOV 的 edit list、首帧非零、B 帧重排序 | 纳入逐帧一致性夹具；Mediabunny 处理不对时按素材降级为代理 |
| 未标色彩的素材预览与导出色差 | 用 `VideoDecoderConfig.colorSpace` 套用与导出相同的假设 |
| 远程 / 云端 Host 没有 `resources.preview` | 与现状相同，不在本方案范围 |
| 实时混音与导出不一致 | 共用 `audio-plan.ts` 纯函数 + 声道级对比测试；带变调和闪避的声道走原生渲染 |
| 新旧两条路径并存，维护成本上升 | 旧 `EditorMediaPool` 只保留给导出和兜底；M5 通过后评估下线 |

## 附：本方案依据的现状代码

- 播放循环：`apps/video-studio/src/editor/preview.ts`（`play`、`draw`）
- 解码与寻帧：`apps/video-studio/src/editor/media-pool.ts`（`seekVideo`、`EditorMediaPool.prepare`）
- 预览代理：`apps/video-studio/native/editor-runtime/proxy.ts`（`prepareEditorProxy`）
- 准备流程：`apps/video-studio/src/main.ts`（`prepareAudio` 回调）、`src/editor/task-bridge.ts`
- 混音计划与渲染：`src/editor/audio-plan.ts`、`native/media/editor-audio-renderer.ts`、`src/editor/stream-audio.ts`
- 导出渲染入口：`src/editor/render-entry.ts`、`native/media/editor-frame-renderer.ts`
- 范围准备的既有约束：[`video-studio-bounded-range-preparation.md`](video-studio-bounded-range-preparation.md)
