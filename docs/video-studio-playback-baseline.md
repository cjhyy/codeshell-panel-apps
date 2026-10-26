# 视频工作台播放基线（M0 实测）

测量日期：2026-10-26。代码基线：`e2b391f`。原始数据：[`video-studio-playback-baseline.json`](video-studio-playback-baseline.json)。
方案见 [`video-studio-realtime-playback-engine.md`](video-studio-realtime-playback-engine.md)。

环境：Apple M4 Pro / 24 GB；Electron 33.4.11（Chrome 130.0.6723.191），与 Desktop 相同；系统 FFmpeg 8.1.1（运行时同样从 `PATH` 调用）；
WebCodecs 对照使用 mediabunny 1.61.3。所有原生步骤直接调用面板源码（`prepareEditorProxy`、`fileHash`、
`renderEditorAudio`），浏览器步骤直接调用 `loadDecodedVideo` / `seekVideo` / `applyColorToRgba`。文件读取
都走热缓存，冷盘的哈希会更慢。

## 素材

| 编号 | 内容 | 编码 | 尺寸 | 时长 | 大小 |
| --- | --- | --- | --- | --- | --- |
| a | 录屏教程转码 | H.264 High，GOP 60 | 1920×1080 30p | 300 s | 48 MB |
| b | MV 转码（模拟 iPhone） | HEVC（VideoToolbox） | 3840×2160 23.976p | 60 s | 325 MB |
| c | YouTube MV 原片 | AV1 | 3840×2160 23.976p | 134 s | 182 MB |
| d | TikTok 原片 | HEVC，VFR | 1080×1080 ≈43.6p | 132 s | 16 MB |
| e | YouTube 教程原片（音频测试） | VP9 + Opus | 1920×1080 | 取 1800 s | 471 MB |

## 1. 首次播放前的代理准备（`prepare-video`，预览代理）

| 素材 | 合计 | 逐帧扫描 | x264 编码 | 复扫 + 代理哈希 | 原片哈希 ×2 |
| --- | --- | --- | --- | --- | --- |
| a 1080p H.264 5 min | **23.3 s** | 11.9 s | 5.2 s | 6.1 s | 0.05 s |
| b 4K HEVC 1 min | **54.1 s** | 43.6 s | 7.7 s | 2.5 s | 0.3 s |
| c 4K AV1 2.2 min | **75.7 s** | 60.5 s | 9.7 s | 5.3 s | 0.2 s |
| d 1080² HEVC 2.2 min | **13.8 s** | 7.6 s | 2.1 s | 4.0 s | 0.03 s |

逐帧扫描（`ffprobe -show_entries frame=…`）在单核上把整片解码一遍，占总时长的 50–80%。哈希在热缓存下可以忽略。

## 2. 导出级代理被用于预览（缺陷）

`prepare-source-video` 调用 `prepareEditorProxy` 时没有传 `purpose`，默认按 `"export"` 生成**全分辨率无损 VP9 4:4:4**
（`native/editor-runtime/runtime.ts:363`）。以下三处走这条路径，并把结果直接交给播放器：

- 播放前预热“接下来的视频”（`src/main.ts` `warmUpcomingVideo`）；
- 播放中遇到未准备的视频时，`resolveEditorAsset` 的兜底分支；
- 首次播放之后时间线缩略图条（`timeline-media.ts:187` → `resolveEditorAsset`）。

| 素材 b（4K HEVC 1 min） | 预览代理 | 导出级代理 |
| --- | --- | --- |
| 生成耗时 | 54 s | **745.7 s**（编码 521 s，复扫 180 s） |
| 文件大小 | 65 MB | **2.63 GB** |
| 播放器逐帧寻帧 | 55 ms/帧 | **1792 ms/帧（0.6 fps）** |
| `play()` 首帧 | 158 ms | 2170 ms |

## 3. 播放：逐帧寻帧 vs 真正播放 vs WebCodecs

每项从第 30 秒起测 90 帧（寻帧）或 4 秒（播放、解码）。

| 源 | 逐帧寻帧（现行播放方式）| 实时倍数 | `play()` 实际帧率 / 丢帧 | WebCodecs 顺序解码 | WebCodecs 随机定位 |
| --- | --- | --- | --- | --- | --- |
| a 原片 | 15.1 ms | 2.21× | 30.3 fps / 0 | 1596 fps（53×） | 30 ms |
| a 预览代理 | **77.7 ms** | **0.43×** | 30.5 fps / 0 | 968 fps | 75 ms |
| b 原片 | 20.4 ms | 2.05× | 24.3 fps / 0 | 425 fps（17.5×） | 40 ms |
| b 预览代理 | 55.5 ms（p95 132） | **0.75×** | 24.5 fps / 0 | 497 fps | 127 ms |
| c 原片 | 113 ms | 0.37× | 24.3 fps / 0 | 207 fps（8.5×） | 145 ms |
| c 预览代理 | 55.2 ms（p95 133） | **0.76×** | 24.3 fps / 0 | 499 fps | 134 ms |
| d 原片 | 9.1 ms | 2.51× | 47.8 fps / 0 | 1569 fps（33×） | 93 ms |
| d 预览代理 | 34.9 ms | **0.66×** | 48.0 fps / 0 | 2266 fps | 49 ms |

关键帧间隔对照（同一段 1080p，60 s，x264 ultrafast）：

| 代理 | 逐帧寻帧 | 实时倍数 |
| --- | --- | --- |
| GOP 250（现行默认） | 77.6 ms | 0.43× |
| GOP 30 | **8.8 ms** | **3.78×** |
| VideoToolbox 编码，GOP 30 | 9.6 ms | 3.49× |

结论：Chromium 每次寻帧都从前一个关键帧重新解码，耗时随帧在 GOP 中的位置增长。预览代理沿用默认 GOP 250，
所以**代理就绪后，现行播放方式在所有素材上都达不到实时**；而对同样这些原片，`play()` 全部实时、0 丢帧，
首帧 85–200 ms。

## 4. 调色

1920×1080 一次 `getImageData → applyColorToRgba → putImageData`（亮度、对比度、饱和度各调一点）：
**平均 112 ms，p95 128 ms**。任一可见图层带调色时，播放上限约 9 fps，与解码方式无关。

## 5. 预览混音（`prepare-audio`）

工程：原片（含原声）整段 + 背景音乐（AV1 MV 的音轨）循环铺满，音量 0.3，淡入淡出各 1 s。

| 工程 | 冷启动合计 | 解码 | 混音 | 只改原声音量后重新准备 |
| --- | --- | --- | --- | --- |
| 5 min | **22.9 s** | 0.7 s | 22.1 s | **22.8 s** |
| 30 min | **141.1 s** | 3.4 s | 137.6 s | **137.3 s** |

60 s 工程的 CPU 采样：`PcmStore.integer` 自身占 **50%**，`PcmStore.file` 占 10%。每个采样、每个声道都要
拼一次 `${path}\0${block}` 字符串，再对 Map 做一次删除和插入来维持 LRU 顺序；实际的增益和声像计算
（`sampleAudioLane` 等）合计约 15%。

## 卡点排序

| # | 卡点 | 影响 | 便宜的修法 | 根本解法（方案章节） |
| --- | --- | --- | --- | --- |
| 1 | 预热、兜底、缩略图走导出级代理 | 4K 每分钟 12 分钟 + 2.6 GB；用上后 0.6 fps | `prepare-source-video` 传 `"preview"` | §5 原片直放 |
| 2 | 首次播放等代理 | 13–76 s | 逐帧扫描改读包级时间戳（需验证 VFR 等价） | §5 原片直放 |
| 3 | 逐帧寻帧 + GOP 250 | 代理就绪后仍只有 0.43–0.76× 实时 | 预览代理 `-g 30`（约 5–9 倍） | §6 播放调度 / WebCodecs |
| 4 | 混音簿记开销 | 5 min 工程 23 s，改音量全部重来 | `PcmStore` 按声道缓存当前块，去掉逐采样的字符串与 Map 操作 | §8 实时混音 |
| 5 | 调色 CPU 逐像素 | 带调色时 ≤ 9 fps | — | M4 GPU 合成 |

## 前三项修复后的复测（2026-10-26）

分支 `claude/video-studio/playback-quick-fixes-20261026`。同一台机器、同一批素材、同一套脚本。

修改：

1. `prepare-source-video` 改为生成预览代理（`runtime.ts`），预热、兜底和缩略图不再生成导出级代理。它与 `prepare-video` 用同一份配方，因此共用同一份缓存。
2. 预览代理关键帧间隔改为 30（`proxy.ts`，配方版本 `editor-sdr-preview-v2-gop30`，旧缓存自动失效）。
3. `PcmStore` 对连续读取同一块的情况直接返回，不再逐采样拼键、维护 LRU（`editor-audio-renderer.ts`）。

| 指标 | 修复前 | 修复后 | 变化 |
| --- | --- | --- | --- |
| 预热 / 兜底 / 缩略图代理，4K 1 min | 745.7 s，2.63 GB | 50.6 s，67 MB（与预览代理同一份缓存） | **约 15 倍更快，体积为 1/39** |
| 播放器用上述代理时的逐帧寻帧 | 1792 ms（0.6 fps） | 11.4 ms（3.65× 实时） | **约 157 倍** |
| 逐帧寻帧，a 1080p | 77.7 ms（0.43×） | 8.8 ms（3.79×） | 8.8 倍 |
| 逐帧寻帧，b 4K HEVC | 55.5 ms（0.75×） | 11.4 ms（3.65×） | 4.9 倍 |
| 逐帧寻帧，c 4K AV1 | 55.2 ms（0.76×） | 11.5 ms（3.64×） | 4.8 倍 |
| 逐帧寻帧，d 1080² HEVC | 34.9 ms（0.66×） | 5.3 ms（4.36×） | 6.6 倍 |
| 预览混音，5 min 工程 | 22.9 s（改音量 22.8 s） | 6.8 s（改音量 6.6 s） | 3.4 倍 |
| 预览混音，30 min 工程 | 141.1 s（改音量 137.3 s） | 40.4 s（改音量 37.7 s） | 3.5 倍 |
| 首次播放等代理（a / b / c / d） | 23.3 / 54.1 / 75.7 / 13.8 s | 23.4 / 50.6 / 77.8 / 15.2 s | 不变（预期：未改扫描） |
| 预览代理体积，a 1080p 5 min | 109 MB | 144 MB | +32%（GOP 30 的代价） |

仍然存在的卡点：首次播放等代理（卡点 2，需原片直放或改扫描方式）；预览混音仍是整条序列、
改音量要全部重来（卡点 4 的根本解法是实时混音）；调色 CPU（卡点 5）。

## 复现

测试脚本未入库（路径写死）。如需复现：用 esbuild 按 `platform: "node"` 打包，直接调用上述面板函数；
浏览器部分在 Desktop 自带的 Electron 里加载一个本地 HTTP 页面（支持 Range），逐项调用 `loadDecodedVideo`、
`seekVideo`、`play()` + `requestVideoFrameCallback`，以及 mediabunny 的 `VideoSampleSink`。
