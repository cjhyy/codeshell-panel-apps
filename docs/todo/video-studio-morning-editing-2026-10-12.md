# Video Studio 持续优化：2026-10-12 上午

用户目标：检查视频剪辑面板与剪映相比的实际体验缺口，持续优化至
Asia/Singapore 2026-10-12 11:00。截止后停止新增范围，完成已开始的验证并汇报。

## 工作位置和延续方式

- 集成工作树：`/Users/admin/.codex/worktrees/video-studio-morning-editing/codeshell-panel-apps`
- 集成分支：`codex/video-studio/morning-editing-polish`，基线 `origin/main` 的 `1a03992`。
- 手势代理：`/Users/admin/.codex/worktrees/video-studio-gesture-polish/codeshell-panel-apps`，
  `codex/video-studio/gesture-polish`。
- 播放代理：`/Users/admin/.codex/worktrees/video-studio-preview-polish/codeshell-panel-apps`，
  `codex/video-studio/preview-polish`。
- 同步切分代理：`/Users/admin/.codex/worktrees/video-studio-linked-split/codeshell-panel-apps`，
  `codex/video-studio/linked-split`。
- 本聊天每整点自动跟进，automation ID `11`，最后一次为 11:00。已有运行中的工作不重复启动。
- 当前 goal 已由用户 `/goal` 建立，不重复创建；11:00 前不因完成某一批改动而宣告整个 goal 完成。

所有面板业务改动位于此仓库。保留用户工程及其他任务的工作树。
源代码和统一构建的 `panels/video-studio/` 输出一起提交；代理只提交源代码和测试，
由集成工作树构建。按照仓库指引在集成前刷新 `origin/main` 并验证。

## 第一批：日常剪辑连续性

1. 时间轴缩放：连续拖动原生滑杆；保持可见播放头或当前视图中心；
   Ctrl/⌘ 滚轮保持鼠标所指时间；加减键和按钮；Shift 滚轮横向导航。
2. 手势：Alt 临时关闭吸附，保持逐帧量化，松键恢复；框选使用实际片段几何。
3. 播放：同一工程身份暂停/继续保留解码器，避免重复准备首帧；
   工程修订、序列切换、取消和打开代次变化正确失效。
4. 同步切分：关联画面/音轨、多选片段按 S 同步切分，绑定字幕不重复处理；
   左右分组分离、右半段继续选择、整次撤销及锁轨拒绝。

进度（01:10）：以上已合入本任务工作树。追加拖动/裁剪无效目标的提前反馈，
以及真实 PCM 混音的削波提示（预览、导出进度、已成功导出记录）。
尚未合入 main、发布或更新用户安装。没有修改用户工程，也没有调用付费模型。

交叉检查修正两处边界：

- 暂停续播复用缓存，但同一工程修订内重新关联素材也会失效旧解码器、声音和提示；
  用真实绿色视频替换为蓝色视频验证。
- 同步切分后的右侧关联分区会继续分离未来片段的额外 group/link 标签，
  防止立即 Delete 或微移误操作播放头左侧片段；来源绑定字幕本身不扩大选择。

正在开发的下一批：

- 手势反馈的重规划合并到每帧一次，最终松手仍完整校验；
  初测 1000 片段移动校验约 11.5ms、裁剪约 15ms，5000 片段约 55/76ms，
  不能宣称长工程已流畅。
- 字幕字面查找、前后定位及批量替换，保留未保存草稿并一次撤销。
- 预览原始/半/四分之一质量：先验证合成与画布坐标契约，不能影响工程/导出尺寸。

代理增量分支还有 `codex/video-studio/drag-feedback`、
`codex/video-studio/audio-overload`、`codex/video-studio/caption-find`。
已集成提交通过 cherry-pick --no-commit 合并，后续只挑选代理新增提交，
不要重复挑选其依赖提交。音频警告整合时 `refreshMedia()` 已补清理。

## 后续候选（须结合真实代码与操作验证后实施）

- 拖动/裁剪提前显示无效目标及原因，避免松手才发现锁轨、碰撞或越源裁剪。
- 字幕改错字不必丢弃整条逐字时间；查找替换、按光标拆句与合并。
- 预览质量选择：项目已有 1080p 代理，仍需评估全尺寸画布合成的成本。
- 工具可发现性、导出前实际兼容性反馈及长工程交互性能。

这些是候选，不能当作已实现的功能或承诺与剪映完全等价。

## 验证记录

- 初始时间轴浏览器回归：60/60 通过。
- 完整浏览器回归 519 项：518 通过，唯一失败是快捷键说明旧断言禁止 Alt；
  已更新断言并独立复测通过。
- 当前合并后的时间轴、工作台、导出任务 UI：167/167 通过。
- 当前 Video Studio 离线套件：1033 项（1030 通过、3 项可选环境跳过）；
  native voice 6 项（5 通过、1 项可选模型跳过）；workspace documents 5/5。
- typecheck、构建、确定性 build:check、validate 通过，包 39 文件。
- 完整真实媒体回归已通过 213/213，日志 `/tmp/video-studio-morning-media.log`。
- 新一批整合后须再次构建并验证，刷新并正常合并最新 origin/main；
  已正常合并上游 b85dfc8（稳定工程上下文），生成冲突已按源重新构建。

## 第二批及持续工作（凌晨）

- 草稿 PR 已建立并附加本聊天：<https://github.com/cjhyy/codeshell-panel-apps/pull/70>。
  最终完成前持续更新，不代表已经发布或更新用户安装。
- 合上游后的主入口 UI 59/59 及离线套件通过。
- 已集成字幕字面查找/替换、前后定位和范围；替换走候选预览、一次 durable apply，
  受影响行的未保存文字/时间草稿在预览前与应用前都受保护；其他草稿保留。
  查找导航以原始 tick 精确定位，main.ts 已转发 exact 参数。
- 已集成手势规划每帧合并及移除冗余 clone，最终释放和静止 Alt 仍同步完整校验。
  同机 11 次采样中位：1000 片段移动 11.8→9.1ms、裁剪 15.9→14.0ms；
  5000 片段移动 56.0→42.4ms、裁剪 76.2→62.3ms，仍不能承诺 60fps。
- 合并后的字幕/时间轴浏览器回归 103/103 通过。

正在开展：

- 字幕批量性能，`codex/video-studio/caption-replace-batching`：1000 条批量替换初测
  12.81s，正去除每条字幕反复全图验证。1000 字幕整页刷新约 158ms 含布局，
  后续再评估稳定行。
- 预览质量代理：原始/半/四分之一合成，默认原始，保持逻辑坐标；不得缩小导出。
- 范围导出根工作树：
  `/Users/admin/.codex/worktrees/video-studio-range-export/codeshell-panel-apps`，
  `codex/video-studio/range-export`，已有 UI、batch、receipt 范围绑定，尚未全部提交；
  contract 提交 3d645a1。native/bridge 由 `codex/video-studio/range-export-native` 完成。
  按现有范围标记导出，范围外素材仍保守完整准备并提示成本。
  保留原始序列及全混音，编码时裁音频、原 tick 求画面；不能使用临时 compound 包装：
  它会重置 ducking attack，实测前 10ms BGM RMS 变为原混音切片的 3.63 倍，
  半透明背景也与导出 matting 不一致。失败实验已从源代码移除。

11:00 截止要求仍有效；不要因任何一批提交完成而提前标记整个 goal 完成。

## 第二批整合验证（01:40 左右）

- 集成源包含范围导出（3d645a1 + 404b1fc + 41b8a3a）、预览质量 1ff784b、
  字幕批量 d1caacad 与稳定字幕行 a83ca475；尚在本任务分支，PR70未同步新批次。
- 范围导出保持原始document/sequence/hash，音频截取完整48kHz混音的半开区间：
  ceil(start/5) 至 ceil((start+duration)/5)，输出帧数为ceil(duration * fps)。
  1tick零原样本区间补静音；范围过载警告和成片回执绑定同一range。
  全混音缓存不会重启ducking；nested/sourceBinding字幕、转场和透明背景原窗口
  与范围输出10帧RGB逐字节一致。范围外素材仍完整准备，UI说明时间成本。
- 字幕1000条替换planner 12.81s→约30ms；真实DOM端到端preview/apply/undo约
  146/354/189ms。无关刷新1000行含布局中位158.4→62.6ms，行本体29.8→14.5ms，
  布局约85→0.4ms。整批替换全部行变化仍需重建，不承诺此处同倍速提升。
- 预览质量默认原始，只降低合成buffer，不改工程/导出/逻辑画布坐标。
  1080p单调色图层同机中位97.4/25.5/6.6ms；4K 394.0/98.7/24.9ms，
  仅合成，不包含解码和原有代理准备。证据位于
  `/Users/admin/.codex/visualizations/2026/10/12/video-studio-preview-quality/`。
- 本批 typecheck/build/build:check/validate通过，完整离线1074项：1071通过、
  3可选环境跳过；native voice 5通过1可选跳过；workspace documents5/5。
  完整真实媒体222/222通过。完整UI回归545/545通过，日志
  `/tmp/video-studio-morning-second-ui.log`；媒体日志同前缀`-media.log`。

下一批并行工作：

- root：词间标点/空白更正仅在原词内容及顺序完全可核对时保留真实词时间，
  词内容变化、原对齐不完整、数值/撇号/连字符等歧义继续清除；旧译文总是清除。
  独立分支`codex/video-studio/caption-punctuation`，以694517f作为d1依赖。
- linked_split：逐帧workspace四次clone整文档造成1000片段约12ms、合法5000片段
  （活动2000）约49ms的同步UI回调；采用帧内快照、prepared canvas evaluator、
  静态inspector不重建、轻量history文档id改善；不得破坏public read复制隔离。
- media_audit：评估画面快速对齐到画布的六个动作，纯planner+inspector，
  保留动画关键帧，锁轨/转场/蒙版等歧义整批拒绝并解释，不改canvas-ui。
- editing_audit：先审计字幕光标拆句/相邻合并现状和安全语义，再实现有限范围。

11:00截止和goal/automation11仍然有效。未发布、未修改用户工程或调用付费模型。

## 第三批整合（02:00 左右）

- 第二批已在 e2d68f1 提交并推送 PR70。相同 HEAD 的 PR CI 全绿；push CI
  唯一失败是千条字幕真实 click 的 4s 超时（已进入 performing click），并非断言失败。
  仅该大型用例把 apply click 等待设为15s，保留原始点击、存储、一次撤销断言；本机复测通过。
- 已集成 440c813 标点保留、72a1589 帧回调、0a2acda/aa92ace 属性代际隔离、
  f2e02a4 字幕行代际隔离、8c9ec6f 六向对齐及 b751eb9 导出历史范围文字。
  代际合并后再补旧对齐按钮失效、时钟变化只刷新按钮不丢属性草稿、工程名草稿隔离。
- 标点保留要求原文/新文完整覆盖同一串真实词，Unicode字母/数字/组合符拼词、
  数字分隔、撇号/连字/斜线及新词均保守清除旧对齐；不会根据文字推算词时间。
- 帧内共享一个 detached snapshot，只用于同步只读UI，finally释放；public read仍复制。
  Canvas evaluator按document/revision/generation/sequence缓存；动画属性仍随seek刷新。
  合并后真实Chromium合法5000片段（活动2000）frame mean8.85ms/p9512.20ms，
  seek8.74ms；仅同步界面，不包含解码或完整播放。1000片段frame1.71ms/seek2.14ms。
- 快速左/右/上/下/水平/垂直对齐使用旋转裁切后画框，多选逐个对齐、一个原子undo；
  仅更新相应位置轴当前关键帧。锁轨、隐藏、活动区间、蒙版、叠放字幕、转场歧义给原因。
- 恢复的范围导出历史仍显示精确区间，1tick显示0–0.000004秒，非法范围不伪造标题。
- 本批167/167相关UI通过，1088离线项1085通过3可选跳过，native voice5通过1跳过，
  workspace documents5/5；标点扩展37/37再验通过。typecheck/build/build:check/validate通过。
  日志 `/tmp/video-studio-morning-third-ui.log` 与 `-unit.log`。

后续并行：字幕光标分句/相邻合并、长时间线磁吸扫描优化、59.94fps WebM帧率量化修复。
新源改动后需再生成installable包；11:00时停止增加范围，完成必要校验、正常合并和交付。

## 第四批固定代码（02:15 左右）

- 第三批38cb7d1已推送，push/PR两套CI共14个checks全部通过。
- 新增量8139933消除磁吸块反复排序与线性查找，并合并相同delta的移动组件；
  既有完整输入/最终图校验次数不变。root复跑合法5000片段：连续磁吸移动74.43ms、
  裁切79.23ms，含间隙磁吸移动170.85ms、裁切81.08ms，自由移动42.70ms/裁切63.52ms。
  机器并发负载会影响结果；这不是60fps保证。22单测+99真实UI通过。
- efdfb3e与2a0b99b加入光标分句/手动分割时间、两条同轨相邻字幕合并。
  有可证明的真实词边界取右首词.start；无可靠词边界必须显式给时间，完全不按字数估时。
  文本按caret原样切片，Unicode grapheme不能拆开；手动时间保持tick精度。
  预览前和应用前保护所有受影响草稿，durable一次提交/撤销及旁白审批回退同步。
  翻译元数据、关键帧/淡入/打字机、不连续绑定和不同样式关联保守拒绝并解释。
- 来源切片逐嵌套stage证明正向map段、单一逆映射及保存source/provenance边界，
  拒绝2x整数取整造成范围扩大和正端点但内部反向循环的两个审查反例。
  同工程修订查找导航重新取当前tick；排队导航、分句/合并和await seek后的选择
  均受session/generation/sequence所有权约束。最新字幕47单测、44完整字幕UI通过。
  合并前相关caption/inspector70UI及caption/clip/session/narration/history123单测也通过。
  420px真实Chromium视觉检查无溢出，证据
  `/Users/admin/.codex/visualizations/2026/10/12/video-studio-caption-sentences/`。
- cee45e1修复WebM59.94帧周期纳秒量化误拒及24h NTSC末帧上取整误拒，仍拒绝
  错误率/avg与nominal冲突/额外整帧。7项含真实编码检查与15渲染媒体回归通过。
- 本批typecheck/build/build:check/validate/diffcheck通过，源与installable包同步。
  固定此批后将再跑完整UI/媒体/离线，不在其运行中改变被测源。

下一轮分工：media_audit跨序列剪贴板与durable cut/paste/duplicate；editing_audit
其他属性面板代际隔离；linked_split只做owned preview能力原型/反例/性能评估，尚未改正式API。
11:00截止和automation11有效，goal继续active，不提前完成。

## 第四批完整验证（02:25 左右）

- 固定提交a31c7a7完成完整UI581/581、真实媒体223/223。
  离线1103项：1100通过、3可选环境跳过；native voice5通过1可选模型跳过，
  workspace documents5/5。三份完整日志分别为
  `/tmp/video-studio-morning-fourth-full-ui.log`、`-media.log`、`-unit.log`。
- 最新origin/main仍为b85dfc8，无需重复合并。第三批38cb7d1的14项CI均通过；
  第四批将同步到PR70，之后继续增量工作。
- 已交付待整合21f09a5：跨序列按完整同类轨序位粘贴（含侧链引用），
  剪切按钮及durable cut/paste/duplicate；保存失败保留工程、选择和原剪贴板。
  独立88时间轴UI、71workspace UI、107相关单测及主入口帮助验证通过。
- 新任务codex/video-studio/editor-scope-fences已证明旧时间/序列/机位/标记控件的
  5个代际反例，正在补修复与异步回调隔离；preview-endurance审查真实资源释放。
- owned-gesture-preview原型对合法5000片段的自由移动约42→25ms、裁切64→25ms，
  首次factory约24–30ms；私有validated/frozen base每次clone并完整最终图验证。
  正式实现仅在真实workspace带identity的手势中启用；公共API输入/最终验证保留，
  empty操作结果仍复制隔离。等正式实现验证、审查后整合，不能当作已发布性能。
- root独立codex/video-studio/track-confirm-scope复现4项删轨确认反例：
  同ID/rev重新打开、未render的generation/revision变化、同trackID切序列。
  旧确认必须失效且不能绕过当前确认；正在修复，不修改完整回归被测a31源码。

11:00截止仍有效。未发布、未安装新版本；不改变用户工程、不调用付费模型。

## 第五批整合验证（02:37 左右）

- 已整合21f09a5跨序列剪贴板、80300cf/94babb3其他面板代际与切序列异步隔离、
  8fd92ff私有手势快照、8fbda07删轨确认隔离、1a4664d真实预览耐久回归。
  冲突只在共用fixture、追加测试及timeline import/render，保留每批新增行为与反例。
- 第五批相关UI279/279（timeline/timing/workspace/sequences/multicam/main），
  媒体链81/81（preview/pool/compositor/render），领域142/142；完整离线1112项，
  1109通过3可选跳过、native voice5通过1可选跳过、workspace documents5/5。
  typecheck/build/build:check/validate/diffcheck通过，生成包39文件同步。
- 合并后的真实Chromium5000片段：prepareMove24.78ms/prepareTrim29.85ms，
  持续ownedMove26.25ms/ownedTrim25.08ms，public free42.53/64.47ms。
  私有能力仅用于有identity的拖动预览，最终公共session提交仍完整校验。
- 18次真实play/pause/seek/quality后资源基线稳定；refresh/同ID打开/dispose后
  VideoFrame、video、ownedURL、compositor surface、connectedAudio、activeReads全0。
  PCM stream各dispose一次，AudioContext closed，无重复或借用URL误撤销。
  仅说明可观测资源释放，不能推出浏览器RSS或系统解码器GC时刻。
- 追加审查发现timeline-media仅按docID/rev缓存，真实红→蓝视频同ID/rev重开
  会保留旧缩略图；同代际refreshMedia也未刷新时间线缓存，正在单独修复。
- SRT文件读取已证实旧慢文件覆盖新快文件的P2，正在隔离文件选择顺序、取消、
  工程/序列/轨道/修订；不新增VTT功能。静音轨音量调整无提示的P2正在补UI原因。
- root新树codex/video-studio/color-clipboard补当前调色复制/多选粘贴与明确重置，
  只复制真实当前值，目标既有动画仅写当前关键帧；尚未交付，需视觉/领域/UI验证。

本聊天仍持续工作至11:00，不提前结束goal；automation11保留。

## 第六批整合验证（03:03 左右）

- 已整合b2ad2d2、dd141e9/f59f6b4、b5b4f52、c91eec9、c385188：
  时间轴媒体代际/资源重连缓存、SRT读取顺序与可重新导出的分隔行保护、
  静音/零轨道音量原因、当前调色复制/批量粘贴/明确重置、冻结导出批次归属。
- 调色复制使用与实际画面相同的resolveColor，包括自定义缓动过冲钳制；
  只取当前已保存数值，保留目标动画其余关键帧，曲线/HSL整体替换，批量一次撤销。
  真实原生输入复现paste/reset失焦先重建面板造成首击丢失；修复后首击执行所选操作，
  不另存未提交调色草稿。280/360px真实视觉检查无横向溢出，root已查看截图。
- SRT只允许可无歧义重读的cue正文，归一CRLF/CR和外围空白后拒绝中间空白行，
  提示具体字幕序号；不改工程正文、不伪造词时间/来源。真实下载再导入毫秒范围一致。
  旧文件慢读、取消/关闭/换轨/换序列/修订/新generation结果和错误均不覆盖新预览。
- 同ID/rev恢复的真实红→蓝视频缩略图与波形缓存已隔离；refreshMedia同代际资源重连
  会清理时间轴缓存并重新绘制。迟到owned resolver释放自己的URL，不撤销借用URL。
- 冻结批次只豁免同工程普通revision变化，绝不豁免session/documentId/generation。
  失败后恢复/切工程及第一项await期间切工程的六项真实replace回归，均不再提交下一项；
  已接受任务不重复提交或自动取消。旧快照的普通revision重试语义保留。
- 整合UI297/297，加归属修复后的完整workspace80/80；媒体链73/73；领域109/109。
  完整离线1119项：1116通过3可选跳过，native voice5通过1可选跳过，workspace docs5/5。
  typecheck/build/build:check/validate/diffcheck通过，39文件生成包同步。
  日志`/tmp/video-studio-morning-sixth-{ui,media,domain,workspace,unit}.log`。
- 第五批b5f0197的push/PR两套CI14项已全部通过。最新origin/main仍为b85dfc8。
  本批固定后继续完整UI/媒体回归，独立树继续精确定位、导出实际输出摘要和快捷操作审查。
- 时间轴warm scroll热点已定位partial audio compile。拒绝仅凭可伪造identity/rev的cache：
  会漏拒非法source bounds、缺trackId及getter。descriptor精确比较护栏只改善13.2→10.7ms，
  跨root退化13.1→24.6ms且增加5.33MB，故不纳入产品；研究分支61f7bea留可重跑证据。
  owned snapshot能力仍在独立原型阶段，尚未承诺或交付新性能。

11:00截止与automation11继续有效；未发布、未安装，不提前结束goal。

## 第六批完整验证与后续审查（03:12 左右）

- 固定提交edfa791的完整UI666/666、真实媒体228/228全部通过。
  日志`/tmp/video-studio-morning-sixth-full-{ui,media}.log`，测试期间未修改被测源。
- 已交付独立e4c0316导出实际输出摘要，与首次提交共用readSelection，显示真正生效的
  帧率/分辨率/容器/编码/范围/成片数。固定预设不会展示成禁用自定义字段的旧帧率。
  84 workspace UI、16相关单测及390/620px真实视觉检查通过；root已查看长名称截图。
- 已交付独立6b19747精确定位：点击当前时间，输入秒数或从0开始的帧序号，暂停播放并
  滚入可见范围，保持选择与工程历史。真实NTSC帧时钟、1tick与分钟进位、越界拒绝、
  输入单位转换、取消、恢复/切序列/空序列均覆盖。17时间单测、232相关UI通过；
  opaque iframe中的Enter定向回归通过。独立5项键盘/280/390/620px视觉复核无P1/P2，
  root已查看`video-studio-playhead-review/`截图。
- 新P1已在真正EditorSession.replace复现：focused轨道名称/音量未提交草稿被render移除
  触发原生change，继任工程错误追加重命名/调整音量保存。editing_audit独立修复轨道输入
  所有权、重建guard及合法同scope草稿保留；此问题尚未整合修复，不能称已解决。
- owned timeline-media原型same-root warm14.0→0.20ms、跨root/切序列约13ms、首次与heap
  基本持平，单plan约22.8KiB。公共恶意输入与伪/失效cap拒绝、外部dispose及canvas重入
  继续审查；尚未纳入正式产品代码。

goal仍active至11:00，automation11继续保留。

## 第七批整合验证（03:18 左右）

- e4c0316导出实际输出摘要和6b19747精确播放头定位已整合，浏览器workspace/timeline/main
  合计242/242通过；领域34项中33通过、1可选环境跳过；完整离线1121项中1118通过、
  3可选跳过，native voice5通过1可选跳过，workspace docs5/5。
  日志`/tmp/video-studio-morning-seventh-{ui,domain,unit}.log`。
- 第六批edfa791的push和PR两套CI均已完成且全部成功，完整本地UI666/666与媒体228/228
  作为当前已通过基线保留。第七批受影响测试期间被测源码固定。
- README补充未发布功能的实际入口和使用限制，保持0.7.2版本，不声称已更新设备安装。
- 轨道草稿P1独立修复定向8项通过，完整回归尚在运行；owned timeline-media原型20项及
  独立13项边界复核无阻断，已批准四文件最小正式实现，研究提交ff32d42不直接纳入产品。

继续优化至11:00，未发布、未安装、未提前完成goal。

## 第八批整合验证（03:38 左右）

- 已整合1ce6ab8轨道输入归属、52c8357轨道按钮首击、c36f8c0导出序列名称、
  2e42e4e片段菜单及b66a946短屏键盘滚动、49e8cb0 owned timeline-media正式实现。
  所有delta无冲突合并后，冻结源码完成affected UI331/331、完整真实媒体228/228、
  完整离线1124项中1121通过3可选跳过；native voice5通过1可选跳过、workspace docs5/5。
  typecheck/build/build:check/validate39通过。
  日志`/tmp/video-studio-morning-eighth-{ui,media,unit,typecheck,build,build-check,validate}.log`。
- 轨道输入在同scope普通revision保留真实DOM祖先及IME；恢复、换代、换序列、旧重挂
  控件均不写入后继工程。合法草稿与静音/隐藏/锁定/删除/排序各自可撤销；原生首击
  不再被失焦重建吞掉。真实autosave失败遵循dirty/retry，未扩展存储协议。
- 菜单显示打开时精确播放头并用该时点执行粘贴/切分/左右裁剪，所有所选片段需跨过
  播放头才允许左右裁剪。复用原planner与锁轨/来源字幕/磁吸检查。
  独立复核发现短屏End只改变焦点不滚动，已修为仅调整菜单scrollTop；原280/390/620×340
  三项失败全部复验通过，其他独立12项无P1/P2。root已查看280px菜单截图。
- 导出记录冻结工程/序列/预设名称及精确范围，700字加载上限覆盖三个合法200字名称；
  缺失旧名称仅显示真实sequence ID。29 jobs及3 actual main回归、长名390/620px截图通过，
  root已查看390px截图。第七批b2b0e7b的push/PR两套CI均成功。
- owned快照完整校验并冻结私有图，公共render/prepareEvaluator/compileAudioPlan的完整
  验证保留。真正#private单plan、generation/revision/seq/root/loader失效、reset/refresh/
  dispose/observer与canvas重入均有正式生产回归；独立6项真实媒体复核无阻断。
  合法5000片段生产采样：同可见roots14.0→0.4ms，跨roots14.0→14.0、切序列13.7→13.7；
  首次factory33.3ms，冷首帧60.2vs42.8ms（增加17.4ms的明确取舍）。这些仅media渲染
  成本，不包含session.read及时间轴DOM/layout，不能宣称整次滚动或冷启动提速。
- 后续独立已复现：轨道草稿→首次clip拖动/标尺seek会被旧revision gesture取消；
  长按S/Delete/剪切会反复报错，长按原位复制/分组会重复新增undo。均在独立树修复中，
  此批未包含，不能称已解决。真实workspace滚动总成本也正在独立分解审查。

11:00截止和automation11保留，goal仍active。


## 第九批整合验证（03:55 左右）

- 第八批1eb1af9完整UI717项中715通过；两项失败仅旧library菜单文案及默认聚焦删除
  断言与已扩展菜单不符。本地与push CI均仅这两项失败，媒体及offline CI成功。
  89d5251把真实键盘删除改为从默认复制项End/ArrowUp导航，保留素材完整、资源不删、
  one undo及窄屏键盘断言，独立library16/16通过。不能把此前715/717写成全部通过。
- 已整合114f7a8长按一次性快捷键guard、e5e0834轨道草稿到首次选择/拖动/标尺seek、
  f55ffe6时间轴媒体DOM批处理、89d5251旧菜单集成回归。冻结TS后的timeline/workspace/
  timeline-media/library/main合计361/361通过；完整offline1124项中1121通过3可选跳过、
  native voice5通过1可选跳过、workspace docs5/5；typecheck/build/build:check/validate39通过。
  日志`/tmp/video-studio-morning-ninth-{ui,unit,typecheck,build,build-check,validate}.log`。
- 轨道输入先按既有planner结束IME/提交合法草稿，再以fresh DOM/身份/锁轨开始原手势，
  不放宽gesture revision fence。保存等待期间缓存最新move和首次up；取消、隐藏、blur、
  dispose、换代/切序列、同pointerId晚回调不触及新gesture。等待时暂禁zoom/fit；第二次
  物理点击不覆写首次up。无效输入/异步失败保留同scope可纠正草稿；真实autosave仍dirty/
  retry。独立12项真实Chromium边界复核无P1/P2，227项代理回归通过。
- 长按S/Delete/Backspace/Ctrl或Cmd C/X/V/D/G仅首keydown执行；松开再按可继续。逐帧
  定位、移动、输入Backspace及连续undo/redo保留repeat；原生repeat事件及异步cut有回归。
- scheduleMedia先读完可见clip几何，再批量插入canvas。保留原96条strip上限、顺序、
  裁切、高度、hidden/audio/lock及全部取消/身份路径；无Map、长期cache或新public API。
  新真实5000片段回归在旧源失败（append后264次几何读），正式源通过，含横/纵滚、
  zoom、390px、96预算及真实红蓝媒体/声音像素。独立source复核无阻断。
- 闲时正式f55ffe6同机12sample中位：32轨横滚RecalcStyle22.491→3.460ms，
  纵滚27.814→3.917ms；128轨横滚92.752→13.085ms，纵滚113.513→14.064ms。
  对应RAF128轨横125.4→39.4ms、纵157.2→48.8ms。横滚两次read仍约25.6ms、
  纵滚一次read12.8ms；重叠指标不能相加，含frame等待wallMs不能当用户延迟。
  证据/可重跑脚本已保留到
  `/Users/admin/.codex/visualizations/2026/10/12/video-studio-scroll-layout/`。
- 下一批真实审计：属性/轨道草稿→首次canvas move/resize/crop被吞；非法/异步失败
  草稿还会被随后的canvas编辑覆盖。29项actualworkspace复现后批准局部beforeGesture
  owner finish hook，不扩存储协议；尚未整合。标记同ID导航丢未提交名称/备注、off-frame
  范围定位被帧量化也在独立最小修复。后台revision标记草稿的冲突契约仍只审计。

11:00截止和automation11继续保留，goal仍active；未发布、未安装。

## 第十批整合验证（04:26 左右）

- 第九批9d3c566完整浏览器760/760通过，push与PR两套CI均成功。日志
  `/tmp/video-studio-morning-ninth-full-ui.log`。先前两个旧菜单断言的失败已真实修复。
- 已整合deb95c0标记导航、93568be时间轴render到RAF快照移交、9057579画布草稿边界。
  冻结源码的timeline/timeline-media/workspace/canvas/inspector合计419/419通过；
  offline1124项中1121通过3可选跳过、native voice5通过1可选跳过、workspace docs5/5。
  typecheck/build/build:check/validate39全部通过。日志
  `/tmp/video-studio-morning-tenth-{affected-ui,offline,typecheck,build,build-check,validate}.log`。
- 属性与轨道合法草稿先按原planner提交，再继续同一次画布move/resize/crop，分别可撤销；
  保存引起原handle位置变化时保留用户原pointer delta，fresh geometry不重新命中其他图层。
  非法或异步失败保留可纠正草稿；取消、scope/time/selection/viewport变化、dispose同步
  重入、原生双触、首次release与旧finally新capture均有回归。独立最终16项复核无P1/P2。
  局部finish hook只证明合法dispatch完成，真实autosave仍沿用dirty/retry。
- 同ID标记导航保留connected form、名称/备注/时间草稿与IME；范围起止定位精确到原tick，
  最后边界仍限制在序列范围内。20项代理回归和390px视觉复核通过；root已查看
  `/Users/admin/.codex/visualizations/2026/10/12/video-studio-marker-navigation/`。
- 横滚只将显式prepareMediaSnapshot且身份/序列完整匹配的render快照移交一个RAF；
  公共可变context、vertical/resize/refreshMedia仍fresh-read，不按可伪造identity信任缓存。
  独立实际5000片段横/纵滚及真实像素回归覆盖，旧源多一次全文read的断言真实失败。
  闲时32/128轨横滚全文read25.5/25.6→12.9/12.5ms，RAF15.0/39.4→2.1/26.3ms；
  纵滚基本不变。证据`video-studio-scroll-layout/handoff.{mjs,json}`已持久保存；
  排除decode，不把frame等待wall time当交互延迟。
- 后续独立进行：声音淡入淡出手柄7项UI和32项clip-edits领域测试已过，独立真实PCM
  与既有fade字段逐样本差0、390/280原生触屏操作通过，尚未整合。Inspector草稿→
  首次timeline gesture同根因已复现并在修复；标记背景revision草稿和转场操作另树进行。
  Canvas空白/非手柄选择仍有草稿丢失，已明确记录后续最小修复，不冒称本批覆盖。

继续优化至11:00；goal及automation11保持active，未发布、未安装。
