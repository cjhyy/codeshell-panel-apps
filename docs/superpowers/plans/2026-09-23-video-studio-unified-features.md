# Video Studio：功能迁出旧视图与易用性修复

日期：2026-09-23。分支 `codex/video-studio/unified-features`。

## 背景与根因

`EditorDocument`（schema 2）经 `EditorSession` + `EditorOperation` 编辑，是唯一权威工程。左侧功能页（字幕、口播、粗剪加入成片、配音替换、AI 规则草案/导入方案/自动制作）仍在 `projectLegacyView()`（`src/editor/legacy-adapter.ts`）生成的 schema-1 `Project` 上计算，并经 `main.ts` 的 `commit/edit/saveProject → applyLegacyProjectChange` 写回。

投影以 30fps 整帧（8000 ticks）表达时间。任何片段的起点、时长或源点不是 8000 的倍数（真实素材几乎都是），或出现附加画面轨、文字、变速、转场、嵌套序列，该片段就被排除，视图 `timelineComplete=false`；此时修改已有行一律抛「旧视图未包含全部片段…」。结果：真实素材在这些功能页中“看不到素材”、按钮变灰或点击后报错。

目标：各功能直接读写 `EditorDocument`，统一使用 `main.ts` 的 `applyEditorDurable(operations, identity, label)`（身份校验 + `reconcileEditorProduction` + `dispatchDurable`，单次撤销），不再经过旧投影写回。

## 全局约定

- TDD：先写失败测试并确认失败原因正确，再实现。
- 测试运行：
  - `.test.ts`：`node scripts/run-typescript-tests.mjs tests/<file>.test.ts`；新增文件必须加入 `package.json` 的 `test:video-studio` 列表。
  - 浏览器 `.test.mjs`：`node --test tests/<file>.test.mjs`；新增文件加入 `test:ui:video-studio`。
  - 每个任务结束：`npm run typecheck`、相关测试、`npm run build -- --app video-studio`、`npm run build:check -- --app video-studio`。
- 源码与生成的 `panels/video-studio/` 必须同一提交（CONTRIBUTING.md）。不要直接编辑生成文件。
- 仅显式 `git add` 自己的文件；工作树中的 `node_modules` 是符号链接，不可提交。
- 提交信息结尾：`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- 回归用例必须同时覆盖：真实素材（时长不是整帧，`projectLegacyView(doc).timelineComplete === false` 先断言）与多轨工程。
- 文案面向用户，不出现“旧视图”“新版时间线工具”“Host”等内部术语。

## 第一阶段：止血

### T1 导入提示自动消失（已完成）
### T2 缺少 Host 方法时说明具体方法（已完成）

### T3 语音转写就绪提示与检测
- 现状：`main.ts:~4650`、`production.ts:~1039/1054`、`rough-cut-ai.ts:~365`、`automatic.ts:~177` 提示「请在制作与录音中配置 Whisper」，该设置不存在。原生检测（`native/media/media-runtime.ts:~497-521`）要求 `~/.cache/whisper/base.pt` 与可执行 `whisper --help`；`native/media/media-processors.ts:~142-155` 只在 `process.env.PATH` 查找，macOS GUI 进程 PATH 常不含 Homebrew。模型缺失时 `media-cli.ts:~124-132` 把含 `/` 的错误替换为笼统文案。
- 做法：
  1. 共享常量文案（production.ts 导出）：「本机语音转写未就绪：需要安装 openai-whisper（whisper 命令）并准备 base 模型 ~/.cache/whisper/base.pt。安装后点“重新检测”，或先导入 SRT。」替换上述所有位置。
  2. 原生状态返回 `transcription.reason: "executable-missing" | "model-missing" | "executable-failed"`，界面按原因说明缺什么。
  3. 可执行查找额外搜索 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin`（参照 `hyperframes-adapter.ts:~205`），ffmpeg/uv 同理。
  4. `media-cli.ts` 的错误替换保留具体原因（不要因包含 `/` 就吞掉；仍需避免泄露绝对路径时，只替换 home 前缀为 `~`）。
  5. 字幕面板与任务页能力卡显示状态和「重新检测」按钮（调用 `production.refreshStatus()` 后刷新能力）。

## 第二阶段：功能迁出旧视图

### T4 字幕页改由新版字幕面板承载
- 现状：左栏字幕页（`views.ts:~307-343`、`caption-controls.ts`、`main.ts` 的 `captionDialog`、`add-caption`/`import-srt`/`#srt-input`/`[data-edit-caption]`/`caption-style`/`transcribe`/`captions-from-transcript` 处理）全部基于旧投影；“更多工具 → 语音字幕”的 `EditorCaptionsUI`（`editor/captions-ui.ts`、`caption-controller.ts`、`captions.ts`、`caption-services.ts`）可用，但两边互相看不见。
- 做法：
  1. `EditorCaptionsUI` 增加 `presentation: "dialog" | "inline"` 与 `mount(host)`（把常驻根节点移入宿主，库面板 innerHTML 重建时状态与焦点保留）。两处入口共享同一个实例：字幕页内嵌显示；“更多工具 → 语音字幕”切到字幕页。
  2. `editor/captions.ts` 新增：
     - `listCaptions(doc, sequenceId)`：所有文字轨上 role 为字幕的片段，按时间排序，不含标题。
     - `planAddCaption(doc, sequenceId, {start, duration?, text, trackId?, idFactory?})`：默认 3 秒，限制在序列时长内，复用 `captionTrack()`/`textClip()`。
     - `planCaptionTiming(doc, sequenceId, clipId, {start, end})`：解除 `sourceBinding`（同 `planDetachCaptions`），移动用 `clip.move`，缩短用 `trimClip`（会过滤逐词时间），延长用 `clip.update`；拒绝锁定轨与 `end<=start`。
     - `planRemoveCaptions(doc, sequenceId, clipIds)`：拒绝锁定轨。
     - 界面输入按序列帧率吸附（`snapToFrame`）；已有非整帧值不拒绝。
  3. 新文件 `editor/caption-presets.ts`：`captionPresetStyle`、`planCaptionPreset(doc, sequenceId, preset)`；把 `legacy-adapter.ts:~180` 的 `captionTemplate` 移过来共用；保留每条字幕的 animation/words/translation，并同步 `production.legacyCaptionStyle`。
  4. `caption-controller.ts` 增加 `add()`、`updateTiming()`、`remove()`、`applyPreset()`，沿用 `updateText` 的模式。`EditorWorkspace` 增加公开 `currentTime(): Tick`，用于「在播放头添加字幕」。
  5. 字幕页只渲染宿主 `<div id="caption-panel-host">`；删除旧字幕对话框、处理函数、`caption-controls.ts`、`production-ui.captionsFromTranscript`、`views.ts` 中旧字幕时间轨（死代码）与旧计数。导出对话框「保存 SRT」改用 `exportEditorSrt(doc, activeSequenceId)`，无字幕时禁用。配音「从字幕填入文案」改读 `listCaptions`。
  6. 转写完成后直接提供「生成字幕」动作，不再自动跳到任务页。
- 测试（先失败）：`tests/video-studio-editor-captions.test.ts` 真实素材、多轨、时间规则三组；`tests/video-studio-editor-captions-ui.test.mjs` 内嵌模式添加/改时间/删除各为一次撤销；`tests/video-studio-editor-main.test.mjs` 真实素材 + 第二画面轨工程：字幕页列出已有字幕、添加、导入并导出 SRT、无错误提示，“语音字幕”入口显示同样内容。改写依赖旧 DOM 的旧测试（`video-studio-editor-main.test.mjs:~724` 的 `#caption-form`、`video-studio-ui.test.mjs:~379-399` 的 `.transcript-item`、`video-studio-caption-style.test.ts`）。
- 风险：本人录音草稿字幕（`draftCaptionIds` 为旧别名）在新面板中以「临时字幕」标记；删除后对齐流程需容忍缺失 ID（加测试）。编辑字幕会把已批准配音退回审阅，这是正确的，界面需说明。

### T5 口播删减改在新版工程上计算
- 现状：`spoken-ui.ts:~56-65` 只看旧投影主轨；`spoken-edit.ts:~237` 自由模式直接拒绝；`main.ts:~1059-1075` 经 `saveProject` 写回。
- 做法：新模块 `editor/spoken-edits.ts`：
  - `detectSpokenRanges(source)`：从 `spoken-edit.ts:~135-213` 移入的纯检测逻辑，常量改为 ticks（pad 40000，最小片段 48000）。
  - `locateSourceRange(doc, sequenceId, assetId, range)`：在任意轨上找 `assetId` 匹配的媒体片段，用 `editor/time.ts` 的源时间→片段时间映射（支持变速、倒放）得到时间线范围；嵌套序列/多机位内的片段标为不可操作（「请在对应序列内精剪」）。
  - `findEditorSpokenCandidates(doc, sequenceId, identity, sources)`、`planSpokenCuts(doc, sequenceId, ranges, {scope: "program" | "linked", idFactory})`、`planEditorSpokenEdit(...)`。
  - 删减规则：合并范围；受影响集合包含所属片段、其链接组/分组伙伴（增强/分离音频是不同素材但时间映射相同的链接片段）、`program` 范围内所有相交片段；绑定字幕由 `splitClip/trimClip/clip.remove` 级联处理。预检：触及转场、锁定轨、跨切点的分组、剩余片段短于 0.2 秒、操作数超过约 2000，报错且不写入。从后往前处理：整段覆盖则移除，边缘则 `trimClip`，中间则 `splitClip` + `trimClip`；再对 `start >= b` 的范围内片段发一次 `clip.move(-(b-a))`；标记同步平移/删除。最后校验序列时长正好减少 `removed`。
  - 默认 `program` 范围（两种时间线模式都适用，不再要求磁吸）；界面提供「仅口播及关联轨」选项（`linked`）。
  - `SpokenContext` 改为 `document()/sequenceId()/identity()`；`main.ts` 用 `applyEditorDurable` 应用，保留 `aiApplying` 保护。旧 `spoken-edit.ts` 仅保留类型后删除其余。
- 测试（先失败）：新 `tests/video-studio-editor-spoken.test.ts`：真实素材（时长 `10*T+1234`，自由序列）；多轨（V1、链接增强音频 A2、跨越切点的 B-roll V2、背景音乐 A3、绑定字幕、标记）同步切分平移且一次撤销还原；`linked` 不动 V2/A3；2 倍速与倒放；转场/锁定/过短/过期身份原子失败；已批准配音退回审阅。更新 `tests/video-studio-spoken-ui.test.mjs`；`video-studio-editor-main.test.mjs` 增加真实素材口播应用无报错用例。

### T6 粗剪「加入成片」按播放头放置
- 现状：`rough-cut-ui.ts:~1122-1128/1253-1260` → `rough-cut.ts:~233 roughCutOperations`（旧 `add`/`audio-add`）→ `main.ts:~2063 appendToTimeline`。落点来自投影时长（忽略被排除片段，可能叠在真实片段上），源尾被取整丢失。
- 做法：新模块 `editor/rough-cut-placement.ts`：`findFreeTrack`（从 `workspace-ui.ts:~577` 私有 `track()` 提取并共用）、`planRoughCutPlacement(doc, sequenceId, cuts, {at?, anchor?: "playhead"|"end", videoTrackId?, audioTrackId?, idFactory})`。源范围 `inFrame*8000`；`outFrame === floor(asset.duration/8000)` 时用 `asset.duration` 保留真实尾部；`constantTimeMap`，其余默认同 `addAsset`。视频/音频各自游标从播放头（默认）或目标轨末尾开始；磁吸轨把 `at` 吸附到最近片段边界并先整体后移；非磁吸轨目标区间有片段则找/建空轨。保留 1000 段/2000 片段上限；去掉“音频必须在画面长度内”。`RoughCutContext.appendToTimeline(ops)` 改为 `placeCuts(cutIds, anchor)`；`main.ts` 应用后选中并定位到第一个新片段。删除 `roughCutOperations`、`appendToTimeline`，并检查 `main.ts:~2058` 的调用方。
- 测试（先失败）：新 `tests/video-studio-editor-rough-cut-placement.test.ts`：真实素材保留尾部；磁吸插入后移后续块；自由模式占用时建新轨；视频音频分游标。更新 `tests/video-studio-rough-cut-ui.test.mjs`。

### T7 配音替换不依赖旧投影
- 现状：`editor/voiceover-publication.ts:~123-139` 用旧投影 `audioClips` 找替换目标；目标以旧 `AudioClip` 捕获（`voiceover-ui.ts:~303/534`、`main.ts:~3613`、`production.ts:~1127/473`）。
- 做法：`VoiceoverReplaceTarget {sequenceId, clipId, trackId, assetId, start, duration, timeMap}`；`captureReplaceTarget(doc, sequenceId, clipId)`；`resolveReplaceTarget(doc, target | legacyAudioClip, sequenceId)`。旧 `AudioClip`（已持久化的绑定）经别名解析（新 `editor/legacy-aliases.ts` 提取 `legacy-adapter.ts:~99` 的 `resolveLegacyClipId`，不做投影）后按 ticks 精确比较；新目标深度比较 trackId/assetId/start/duration/timeMap。`VoiceoverPublication.placement` 与 `JobBinding` 校验（`production.ts:~452,473`）加 `replaceTarget`；`createVoiceover` 通过 `callbacks.verifyReplaceTarget` 校验。移除 `voiceover-publication.ts` 对 `projectLegacyView` 的依赖及 `voiceover.ts:~37-44` 的 `replaceClip` 旧路径。
- 测试（先失败）：`tests/video-studio-voiceover-publication.test.ts`：原配音素材 `3*T+777`（被投影排除）可替换；多轨第二音轨目标可替换；已持久化旧 `AudioClip` 目标经别名仍可替换。

### T8 AI 规则草案与导入方案在新版工程上生成与应用
- 做法：
  1. 新文件 `editor/proposal.ts`：`EditorProposal {title, explanation, origin: "local"|"import"|"agent"|"automatic", identity, sequenceId, labels, operations: EditorOperation[], projectId?, requestToken?}`。提供时用 `applyEditorOperations` 试运行；审阅区显示序列前后时长、各轨片段数和标签；身份变化即标为过期，不静默变基；应用时再次校验身份，加 `reconcileEditorProduction`，`dispatchDurable(..., "agent")`，一次撤销。
  2. 把 `agent-tools.ts:~1160-1168` `apply_editor_edit` 的步骤编译循环提取为导出的 `compileEditorSteps(doc, steps, factory)`，工具、提案和导入共用。
  3. `quickPlan`（`main.ts:~2815`）改在新版文档上计算：主轨（磁吸轨或第一画面轨）按 start 排序，限制 `snapToFrame(15*240000, frameRate)`，越界片段 keep-left（磁吸时 ripple），其后的片段移除。按钮可用性改由新版文档的主轨片段数决定（`views.ts:~434/457`）。
  4. 导入方案（`main.ts:~3348`）接受新版格式 `{title, explanation, editor: {steps}}`；旧格式经新 `editor/legacy-plan.ts` 的 `translateLegacyOperations(doc, sequenceId, ops, factory)` 翻译：ID 必须能在当前旧视图中对应，否则明确报错并建议使用新版格式。trim→timing keep，split→split，remove→remove，move toIndex→磁吸插入边界的 move，video-move→move，volume→clip.update（可写时），caption 编辑→clip.update，remove-caption→clip.remove；新增类/注释类（add、audio-add、新 caption、workflow、rough-cuts、settings 名称尺寸）仍经 `applyLegacyProjectChange`（该路径在视图不完整时对新增行可用），`settings.timelineMode` → `planTimelineArrangement`。
  5. `edit()` 改用翻译器，从而修复片段属性里的裁剪/删除/移动按钮。
- 测试（先失败）：新 `tests/video-studio-editor-legacy-plan.test.ts`（真实素材：快速草案在帧对齐的 15 秒处结束主轨、绑定字幕被裁、叠加轨不变；多轨：旧 `[trim, remove, move toIndex]` 只 ripple 主轨；引用被排除 ID 明确报错；add/workflow 在不完整视图上可用；过期 baseRevision 被拒）；`video-studio-editor-main.test.mjs`：非整帧多轨文档中快速草案按钮可用，应用后保存、单次撤销、重载保持；粘贴导入同样；更新 `video-studio-ui.test.mjs` 中提案相关断言。

### T9 自动制作使用新版编辑工具
- 现状：旧写入工具只接受当前自动制作请求（`main.ts:~4426 assertRequest`，`automatic.ts:~29-34` token 仅在 agent 阶段）；`{editor}` 分支在自动制作期间被 `assertEditorEditable`（`main.ts:~1451-1458`，经 `authorize` `main.ts:~4848`）拒绝；自动任务技能列表（`automatic.ts:~320-327`）不含 editor-v2；`read_video_project` 不返回限制信息。
- 做法：
  1. `EditorAgentAuthorization` 增加 `grant?: {projectId, requestToken}`，由 `apply_editor_edit` 与剪贴板流程的 `editor.grant` 解析；分离、增强、同步、打包、对齐与 `render_editor_sequence` 带 grant 时拒绝（自动制作中导出仍用旧 `render_video_project`，它导出完整新版序列且完成检测依赖它）。新增 `context.assertStillAuthorized?(request)`，在 `dispatchDurable` 前调用。
  2. `main.ts` 的 `authorize`：有 grant 时校验 `automatic.isCurrentRequest(grant)` 与项目 ID，`automatic.assertToolAllowed("apply_editor_edit")`，`assertProductionPublicationEditable()`（不加自动锁），叙述模式下若编辑会使已确认录音失效则拒绝；无 grant 保持原锁。
  3. `automatic.ts`：`assertToolAllowed` 在 produce/workflow/draft 模式允许 `apply_editor_edit`，initialize 不允许，narration 仅在不使批准失效时允许；技能列表加入 `editor-v2`；提示词说明 grant 用法与导出方式。
  4. 自动制作的 `apply` 处理（`main.ts:~4513`）非叙述模式改用 `translateLegacyOperations`。
  5. `read_video_project`（`main.ts:~4347`）增加 `legacyView: {sequenceId, timelineComplete, renderSafe, restrictions(前 50 条 {code, clipId?, assetId?, excluded}), restrictionCount}` 与 `editorIdentity`。
  6. `panel.json`：`apply_video_edit` editor 分支增加可选 `grant`（additionalProperties:false）；`propose_video_edit` 改为 oneOf 增加 editor 形式；`read_video_project` 描述写明新字段。技能：`video-workflow/SKILL.md:~28,37`、`video-production/SKILL.md:~10`、`editor-v2` 增加「自动制作授权」一节。删除仅测试使用的 `registerEditorAgentTools`（同时删对应测试用例）。
- 测试（先失败）：`tests/video-studio-editor-agent-tools.test.ts`（grant 原样传给 authorize；未知字段仍拒绝；sync/portable/render 带 grant 拒绝；`assertStillAuthorized` 撤销时修订不变；schema 与 panel.json 一致）；`tests/video-studio-production-tools.test.ts`（`legacyViewSummary` 有界）；`video-studio-editor-main.test.mjs`（自动制作期间：正确 grant 成功；无 grant 报「自动制作正在处理」；过期/他项目 token 拒绝；initialize 拒绝；手动编辑仍锁定；`agent.task.start` 的 skills 含 `video-studio:editor-v2`；`read_video_project` 显示 `timelineComplete:false`）。

### T10 本人录音草稿与自动制作叙述/草稿模式
- 评估 `main.ts:~4440-4590`、`narration.ts:~265`、`narration-alignment.ts:~74` 与自动制作 narration/draft 模式对旧投影的依赖。迁移到新版文档（草稿字幕用 `planAddCaption`/`planTranscriptCaptions`，对齐只改文字片段时间），或在视图不完整时给出明确原因并禁用对应动作。先写真实素材回归测试。

### T11 旧投影残留提示
- 所有仍依赖旧投影的动作，在 `legacyView.timelineComplete === false` 时提前禁用并显示 `restrictions` 汇总的面向用户原因；去掉旧画布「请在素材页查看完整成片」等指向不存在位置的文案；AI 页「BROWSER DEMO」卡只在浏览器预览显示；连接但存储非持久时不渲染两个 ask-ai 按钮。

## 第三阶段：易用性

### T12 素材加入时间线的默认落点与文字入口
- 素材卡「＋」默认接在主画面轨末尾（音频接在第一音轨末尾）；拖放仍按落点。
- 工具栏提供直接的「添加文字」：在播放头处、放在最上层可见轨（不被视频遮挡）；原「＋文字」若只是新建空轨，改名为「新建文字轨」。时间线文字片段显示文字内容而非固定「文字」。

### T13 操作反馈与入口
- 磁吸主轨拖动无效时给提示；禁用按钮给出原因（title/说明）；过期 toast 清理；状态栏片段数读新版文档；导出完成后任务页状态即时刷新。
- 时间线工具栏显示「磁吸 / 自由」切换（复用 `timing-ui.ts:~633` 的排列逻辑）。
- 新建工程按钮带文字并在有未保存修改时确认；去掉重复撤销入口；颜色字段提供取色器（`<input type=color>` 与文本同步）；录制无设备时中文提示。
- 序列名随工程名初始化（新建时）。

### T14 时间线密度与窄屏布局
- 默认轨道高度收紧，900 高度下至少显示 5 条轨；分界线有明确可见手柄。
- ≤640px：预览、时间线优先；素材库/属性改为抽屉或标签切换；播放控制不压住其他内容；底部状态栏不遮时间线。以 600×900 截图验收。

## 收尾
- 更新 README、TODO.md（如实标注状态）、`docs/todo/video-studio-unified-workspace.md` 进度；版本号升级；`npm run check`、`npm run test:ui:video-studio`、`npm run test:media:video-studio`（如本机具备条件）；合并前刷新 origin/main。
