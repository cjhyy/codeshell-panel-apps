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


## 第十一批整合验证

- 第十批90142aa完整浏览器843/843通过，push与PR两套CI均成功。
  日志`/tmp/video-studio-morning-tenth-full-ui.log`。
- 此批源码整合79f3e0c音频fade手柄、0a783fc7属性到timeline gesture、d77cfe9快捷键
  说明、effdcc10转场pair连续编辑、f7a30ce标记背景revision草稿，以及8a61d86画布
  selection-only草稿与fresh render身份边界。代理依赖905/4738/ed479未重复挑选。
- 声音淡入/淡出手柄只改当前clip的既有fade字段；分组、链接、磁吸邻居、source map、
  音量与pan保持。逐帧键盘/Shift十帧/Home/End、最终release坐标、一次undo、无操作
  不新增历史、取消与异步失败有回归。短于48px的片段需先缩放或使用音频属性。
  独立48kHz真实PCM与同字段原混音逐样本差0，重叠fade和非整帧边界、静音及nested
  parent均通过；390/280px原生触屏实际改变120000tick并可取消。截图、JSON和可重跑
  脚本保留于`/Users/admin/.codex/visualizations/2026/10/12/video-studio-audio-fades/`。
- 属性有效草稿先finish，再以原点击的clip/handle/ruler/fade语义开始timeline gesture；
  失败保留correctable draft。等待时保留首次up/latest move，取消、二次触摸、scope/
  selection/time/viewport变化均不回放旧intent。begin/select/focus同步重入及旧finisher
  不能采用新gesture，独立29项复核通过；代理最终冻结389/389受影响UI通过。
- Canvas空白及crop/mask非手柄选择复用相同finish边界；成功后fresh解析原目标ID，仅
  改选择，不建立gesture；无draft同步路径保留。locked图层可选择但不可修改；原目标
  移除不重新命中其他图层。fresh render期间同步dispatch/selection/dispose会取消旧
  intent，避免用旧几何覆盖新revision。正式48新增回归、代理245/245受影响UI及独立
  19/19实际Chromium检查通过；905基线valid/invalid选择6项及render重入3项实际失败。
- 转场添加/调整/撤销后保持同一仍相邻pair，选择、seq/gen或相邻关系改变时再回退。
  删除只使用已有转场kind/duration，不受未填写duration输入影响。代理184 UI+22领域
  测试通过，280/360px截图已持久查看；Inspector草稿到首转场button仍是下一批，不能
  将此批pair保持写成该问题已修。
- 标记原生IME及dirty/new form在普通外部revision保持connected DOM；旧save不自动
  换成新身份，用户显式选择载入最新或保存当前草稿。fresh save要求目标六字段仍等于
  baseline，修改/删除/同ID碰撞禁止覆盖或复活。gen/seq/目标变化不复用；A→B→A旧
  detached form及read中同步选B再commitA两项独立P2已修并通过。代理142 UI+4领域
  测试与390px视觉复核通过。
- root离线1126项：1123通过、3可选跳过；native voice5通过1可选模型跳过；workspace
  docs5/5。领域clip-edits/timing-edits/markers58/58，main快捷键说明1/1通过。
  最终冻结timeline/timeline-media/workspace/canvas/inspector/timing六文件UI541/541通过；
  typecheck/build/build:check/validate39均通过。日志
  `/tmp/video-studio-morning-eleventh-{affected-ui,offline,typecheck,build,build-check,validate}.log`。

继续至11:00；goal与automation11保持active，未发布、未安装。


## 第十二批整合验证

- 第十一批891f048本地完整浏览器945/945通过，push CI成功；PR UI首次944/945，
  旧素材批量删除一项等待完成超时。本地该项独立复跑1/1通过，PR失败job重跑成功
  （attempt 2）；首次失败仍如实保留。第十一批媒体/offline等其余CI均通过。
- 本批源码整合5556a63属性到首次timeline控制、ae53820属性到转场动作、32ea556
  其余Timing提交按钮与已实证错误边界、1c9acaf主界面保存通知读取合并，以及17bae58
  同步selection views读取合并。依赖b175/63ba未重复挑选。
- timeline控制先捕获typed action/track intent，合法属性finish与首次primary release
  均完成后，再用fresh owner/button执行原动作；取消、第二触点、scope/time/viewport
  变化不回放旧intent。copy/duplicate/mute/lock/delete/add-track/magnetic等真实首击
  基线失败已修。私有匹配先筛DOM后对单个候选fresh校验，避免5000clip多轨重复clone。
  代理timeline/workspace377/377及独立mouse/async/sync拒绝复核通过。
- 转场add/adjust/remove与恒速、倒放、定格、左右保留、应用分段曲线、整理画面轨，
  先捕获raw选项/clock/曲线快照，再finish属性并fresh规划；两次修改各自可撤销。
  no-draft仍同步dispatch。曲线Apply直接读取本页尚未change的原生输入，非法值保留
  可纠正草稿。native排列select、曲线导航/节点增删未纳入此批finisher范围。
  最终代理timing/workspace/inspector315/315通过；真实baseline七类draft首击均失败，
  no-draft七类均通过，不能把baseline未涉及的入口宣称已修。
- 独立实际复核发现并修复两项P2：初次fresh read同步切序列后，旧warning不得写到
  后继序列；异步finish完成时单次read故障必须释放自己的owner/fieldset并报告，
  不留下未处理拒绝或清掉新owner。固定97dd源的独立10/10通过，最终curve仅4行
  输入采集增量独立源审通过，未回退这些边界。
- main保存状态通知先检查完整identity签名，未变时不再复制工程；revision更新只读
  一次并把该detached document用于数量及导出按钮。默认helper调用仍fresh read。
  62项main完整UI及typecheck通过，另2项durable持有阶段/同步read重入实际回归通过。
  工程改名仍有原shell完整重绘所需的独立helper读取；不宣称消除全部保存开销。
- selection/frame同步只读批次共享一个detached document，borrow每次核对id/gen/rev/
  sequence/selected IDs/time/disposed，try/finally恢复，公共Session.read继续独立clone。
  代理workspace282/282、16新实际边界及独立源码复核通过。5000片段合法分序列后，
  闲时同选择selection36.3→10.4ms、begin44.9→18.5ms（p9551.7→19.8）；
  换选择40.6→14.4/48.7→22.7ms，读取分别4→1、5→2。首次移动planner仍约39ms，
  不宣称收益；完整草稿flow仅减少本批次三读。详见
  [可复跑脚本与测量边界](../video-studio-selection-read-benchmark.md)，before/after JSON
  随提交保存。测量只含UI/规划，不含媒体解码或播放帧率。
- 根最终冻结timeline/workspace/timing/inspector/main五文件UI683/683通过，typecheck、
  build、build:check及validate39均通过；source与生成安装包同步提交。
  日志`/tmp/video-studio-morning-twelfth-{affected-ui,typecheck,build,build-check,validate}.log`。
  此批未改领域/渲染/原生工具，离线与媒体仍以前一批成功结果为基线；完整浏览器与
  推送CI随后继续检查，不能提前宣称通过。播放follow及Timing边界裁剪另树后续处理。

继续优化至11:00；goal与automation11保持active，未发布、未安装。


## 第十二批后续完整验收与第十三批整合

- 固定c20b847第十二批本地完整浏览器1090/1090通过，日志
  `/tmp/video-studio-morning-twelfth-full-ui.log`；本批push与PR两套CI均已成功，
  PR38176269720与push38176265917对应同一c20b847源。
- 第十三批源码整合7a9be71播放跟随、59e7990 Timing裁剪边界保护、99c3d57固定片段
  音量手柄。b175等依赖未重复挑选；测试append冲突逐项核对并保留两边新增用例。
- 播放跟随只改时间轴视图：播放头出界时翻页到当前页四分之一位置，页内帧不重读工程
  或重建时间轴；手动横滚暂停本轮，显式恢复或暂停重播会重新跟随。选区、工程和历史
  保持，暂停seek不移动视图；菜单、gesture及未完成输入期间不翻页，toolbar控制在
  280/390px原生横滚后仍可见可点。独立发现并修复旧scroll事件跨episode再次暂停的新
  轮次；替换scroller前同步真实offset并更新虚拟窗口。代理最终471/471、typecheck、
  8目标及独立6项通过；两个队列反例旧源0/2，新源2/2。相关日志
  `/tmp/video-studio-playback-follow-{final-ui,final-typecheck,queued-baseline,final-targeted}.log`。
- Timing左右保留统一要求每个所选片段strict inside，边界/外部禁用及显示原因，提交
  时fresh重新核对捕获的clock及选择。原先在片段起点“保留左侧”会删掉整段的实证
  P2已关闭；通用range planner的remove语义保持。clock-only刷新保留其他Timing草稿
  DOM。代理329/329、14实际回归、typecheck及独立49行源审通过。
- 固定音量手柄仅写当前clip既有audio.volume，0–400%，垂直1px=1%，键盘1%/Shift10%
  及Home/End，44px握柄保持在长片段可见左侧；不足68px提示放大。自动化音量只读，
  不覆盖用户曲线或裁剪生成的曲线。保留pan/fades/pitch/ducking/time map/group。
  拖动只预览音量线，保存后再试听，不宣称实时试听。选择固定音量时用DOM线替换
  canvas旧线；取消选择/自动化后恢复canvas线，waveform source缓存保持。
  代理timeline/workspace479/479、media47/47、领域11/11、真实PCM20/20、最终18目标
  与typecheck通过；首次旧媒体新增轮询predicate曾失败，修测试后全47通过，生产源
  未改。独立源审通过。50%音量每个真实浮点sample等于原样本*0.5。
- 根最终五文件affected UI684/684、完整真实媒体229/229通过；offline1129项：1126通过、
  3可选跳过，native voice5通过1可选跳过，workspace docs5/5。typecheck/build/确定性
  build:check/validate39通过，source与安装包同步。日志
  `/tmp/video-studio-morning-thirteenth-{affected-ui,media,offline,typecheck,build,build-check,validate}.log`。
  第十三批a6b0c2c完整浏览器1129/1129通过，日志
  `/tmp/video-studio-morning-thirteenth-full-ui.log`，663486ms。push38177820166和
  PR38177825026仍在运行。后续方向呈现、关键帧定位及属性到◇/◆衔接均先在独立树开发。

继续优化至11:00；goal与automation11保持active，未发布、未安装。

## 第十四批：变速信息、关键帧操作与历史提示

- 纯新增量15fa8f9、712f554、4cf3d8c、63cfa9d、8b8772b整合；既有父依赖没有重复挑选。
  关键帧两处源码冲突保留各自token、finisher自身signal及过期owner清理；workspace
  append测试先核对incoming以parent开头再追加，保留当前已有用例。
- 播放方向检查每段来源时间变化，区分正放、倒放、静帧、往返及含静帧段；混合选择
  使用逐片段反转说明，倒放选择提供恢复正放。曲线来源范围显示真实素材或子序列上限，
  原生输入max与展示一致；多机位保留同步时钟约束，不使用错误的统一最短素材上限。
  输入修正后清除旧customValidity，最终仍由fresh planner校验。
- 关键帧每行可精确定位；保留原tick，末端定位至duration−1，真实预览及时间轴reveal
  同步。锁轨仅提供当前展开属性、individual及当前20行的只读定位。定位先完成合法
  草稿，目标时间被改动后要求重新定位，不使用排序后的旧行号跳到其他关键帧。
- ◇/◆首击先完成合法参数草稿，再执行点击时原来的增删意图，各自可撤销；旧版本原生
  blur重建DOM会丢掉第一击的2个实证回归已修。取点击时最新精确clock，静态Inspector
  DOM无需重建也不会沿用旧播放位置。无效草稿保留，旧owner/重复/换代/锁轨隔离。
- 两类关键帧动作互斥，render在public read及clock getter前后核对两种owner，旧外层
  read不能取消或重建新动作。独立源码复核无阻断；四组实际组合4/4通过，涵盖双向
  pending互斥、旧abort finisher后新selection及read/clock同步重入，日志
  `/tmp/video-studio-keyframe-combined-review.log`。
- Undo/redo提示显示实际下一项历史名称，状态读取仅返回字符串，不复制工程；失败的
  durable proposal及未提交候选不提前改变提示。独立history/session28/28、Workspace
  435/435及类型检查通过；真实两次属性修改、两次撤销/重做对应名称与实际结果一致。
- 根合并源码typecheck、Inspector/Timing74/74、Workspace462/462（合计受影响UI536/536）、
  offline1126通过3可选跳过、native voice5通过1可选跳过、workspace docs5/5、build/
  build:check/validate39均通过；源码及生成安装包同步。日志
  `/tmp/video-studio-morning-fourteenth-{inspector-timing-ui,workspace-ui,offline,typecheck,build,build-check,validate}.log`。
  渲染及原生工具未改，真实媒体基线为第十三批229/229；本批完整浏览器随后检查。

第十四批完整浏览器1173/1173通过，668014ms，日志
`/tmp/video-studio-morning-fourteenth-full-ui.log`。第十三批PR38177825026通过；
push38177820166首次仅素材批量删除UI超时，其余job通过，已要求仅重跑失败job。
同一素材用例本地独立检查也曾复现，不能仅凭重跑绿色认定修复。进一步使用真实
pointer down → production restoreManagedMedia → pointer up稳定复现全选及删除
两项丢失点击；背景列表重建会卸下按住的按钮。正在独立树修复此确定交互，原CI
具体interleaving尚未精确归因。旧测试的timeout与retry保持不变。

后续CI状态：第十四批push38179099798和PR38179103057均通过；第十三批push
38177820166的失败UI job在attempt2通过。重跑通过不代替上述确定交互的修复。

## 第十五批：拖动读数、偏好与序列删除

- 已挑选纯新增量6b87b83、3194e00、fe3bcff、a518dd0、b501b90、c8ffd2a、c48f54a。
- 拖动读数从已校验operation计划投影当前anchor的开始、结束和时长，显示磁吸
  收拢后的真实结果；取消、无效计划或身份变化时隐藏。没有额外复制工程、重复
  planner或全量应用；六位小数秒区分原始tick。390px读数可换行。
- 预览质量偏好跨workspace重挂载串行保存，迟到读取不能暂停用户已经开始的播放；
  偏好失败不阻塞工程保存。还在检查Host仅读取成功而写入失败的浏览器fallback。
- 有片段或标记的序列删除先显示实际名称、直接内容数量和时长供确认；空序列
  保持直接删除。精确revision及工程/代际/管理目标/当前序列变化使旧确认失效；
  失败保留同scope重试，成功只撤销一次。代理23/23 UI、类型及独立源审通过。
- 根初轮组合目标33/33、Timing领域24/24、typecheck通过。日志
  `/tmp/video-studio-morning-fifteenth-{integration-targets,timing-domain,pre-typecheck}.log`。
- 已追加纯新增量a518dd0、b501b90。素材按钮按住期间只延后同scope的呈现刷新，
  工程持久化继续；revision、代际、选择、搜索或筛选变化立即取消旧动作，原生
  keyboard不受影响，touch兼容click有限等待。代理完整素材库30/30及typecheck通过，
  原生down/恢复/up双红已双绿，最终独立源审通过。
- 当前展开属性支持按播放头精确定位上／下一个关键帧，可跨20行分页而不翻页，
  锁轨保留只读入口。使用点击时clock及fresh keys，末端duration−1不重复跳同一点；
  草稿合法完成后目标时间被修改则需重试。代理最终37/37目标与typecheck通过，
  affected521/521在最终一行dispose guard之前通过；根须验证最终集成源。
- 已追加纯新增量c8ffd2a、c48f54a。适合所选片段（Shift+F）按fresh精确所选范围
  计算缩放及水平位置，沿总像素预算cap；不seek/select/apply。复用现有pendingControl，
  Inspector或原生IME轨名草稿首击保存后继续视图意图，invalid保留。播放中沿现
  手动滚动语义暂停本轮跟随，避免下一frame把所选范围立即拉回。代理641/641
  affected在最终follow一行之前通过，最终24目标、类型及独立源审通过。
- 偏好沿原key兼容旧number，Host与浏览器副本用{value,updatedAt}选择最新有效值；
  本机立即保存，Host按队列顺序写入。两方向单边写失败reload已实证绿；迟到读取
  发现未来旧clock时重新保存本页明确选择。损坏时间戳、NaN或不支持quality不恢复。
  代理Main72/72在最终Date有效域一行前通过，最终8目标和typecheck通过。
- Timeline/Workspace追加测试冲突按base prefix验证后保留双方新增内容；Timeline
  另外保留3处UTF-8/fitView/disabled fixture增量。待根最终统一回归和构建后交付，
  不变更0.7.2版本、工程格式、Host权限或用户安装。

根最终源码已冻结并构建，typecheck、offline1128通过3可选跳过、native voice5通过
1可选跳过、workspace docs5/5、build/build:check/validate39通过。完整浏览器
1243/1243通过，711999ms，日志`/tmp/video-studio-morning-fifteenth-full-ui.log`；其他日志
`/tmp/video-studio-morning-fifteenth-{offline,typecheck,build,build-check,validate}.log`。
源与生成安装包同步提交；origin/main刷新仍为b85dfc8，尚未向用户安装或发布。

另在独立separable-color-grading树评估RGB调色：只对无hue/saturation/HSL变化的
通道独立操作用256×3 byte lookup。505设置、3,232,505像素初轮Chromium逐byte相同；
初轮opaque4K基础268→19.4ms、RGB曲线649.3→19ms，只是调色计算，不是预览FPS。
独立透明/稀疏阈值采样和源码复核无阻断，小型透明图额外成本最高约0.025ms/调用。
颜色领域11/11、类型及完整真实媒体229/229通过（162735ms，
`/tmp/video-studio-color-lut-media.log`）。尚未挑选到集成树，后续须单帧compositor
组合验收及生成包检查，不能把候选当作交付。候选923d813已保存可复跑script和
JSON原始交错样本：505设置、3,232,505像素相同，18组真实单帧compositor的最后
完整像素均相同。4K全质量基础224.2→43.7ms、RGB曲线700.8→43.5ms；但非eligible
饱和度对照707.9→757.8ms（约7%退化），不能声称HSL未受影响。继续验证独立HSL
曲线refs外提和合法色带wrap简化后的组合；测量不含解码、音频、UI或代理准备。

窄窗时间轴真实审计6/6通过：280/390px native move及左右trim，边缘自动横滚超过
300px、NTSC最后松手额外13px坐标与Alt策略、一次提交/撤销、关联及绑定字幕移动、
ghost最终style和停止均正确，未因没有发现问题而改源。
日志`/tmp/video-studio-narrow-autoscroll-audit.log`。

继续优化至11:00；goal与automation11保持active，未发布、未安装。


## 第十六批源码冻结：当前成片 PNG、字幕精确定位与调色

- 已整合纯新增量923d813+其唯一子增量73ce93e、f874824、45afc4a；不重复ea659cd，
  已被末帧一行修复替代的e79也未挑选。RGB/HSL组合源1debc256与独立复核一致。
- 保存已应用画面PNG沿现Preview精确seek、媒体池、合成器及Main下载函数，不另建
  renderer或导出工程。按当前预览质量保存，明确尺寸并暂停播放；受管属性/轨名合法
  草稿首击完成后再取帧，无效草稿保留纠正，未应用Timing及工程名草稿保持。
  目标解码完成、renderedTime、generation、doc/seq/quality全部核对后才编码；晚到
  PNG在工程、选择、时间、质量、source preview、隐藏或dispose变化后丢弃。
  首版真实pending新红图片时直接canvas下载会拿旧4386B demo，精确取帧后为新243B
  红图；代理最终Main/Workspace/Preview affected579/579、30目标及类型通过。
- 末尾13tick反例：PNG正确保存80013，但随后同clock刷新原先会floor回80000。
  仅将capture目标标为exactPlayhead，真实同clock与1/2质量刷新仍80013红色；1目标
  与类型通过，独立最终源审无阻断。280/390入口可见可点、能自然换行。
- 字幕行时间原先默认floor：start240013时实际compositor的text layers为空，clock
  240000；查找下一条则精确240013并出现该字幕。只改row seek exact，保留既有
  owner与迟到选择保护；普通、锁轨、被父序列引用的子序列三个真实回归均保持原
  tick、选中和工程/history不改。代理CaptionsUI71/71、5目标与类型通过。
- Workspace append冲突按parent完整prefix核对，保留既有15批、字幕及PNG新增用例；
  fixture两组imports/CSS/下载捕获逐项合并。源码播放分支同时保留quality用户交互
  标志和PNG取消，不把两个生命周期二选一。
- 根组合又实证一处提示交互：quality偏好恢复0.5、解码仍pending时，PNG标题仍称
  320×180，实际160×90。取消与尺寸提示刷新集中到既有setPreviewQuality helper，
  原native change重复块移除；1红→1绿，并验证最终PNG尺寸/红像素。日志
  `/tmp/video-studio-frame-png-quality-integration-{red,green}.log`。
- RGB可分离处理仅在无hue/saturation/HSL、至少1024pixels时构造调用内3×256 byte
  LUT，保持gain/对比亮度/clamp/master/channel/round顺序与alpha=0原RGB。HSL只外提
  本次调用的curve refs，并对合法色带hue简化重复mod；越界/NaN直接caller沿旧wrap
  路径，mutable下次调用重读，没有全局缓存或新增拒绝规则。
- 组合领域13/13、type、完整媒体229/229通过（153706ms）；126设置774144pixels对
  f72 scalar逐byte相同。最终Chromium固定基准505设置3232505pixels+所有单帧最终
  composite逐byte相同；原3preset各11交错样本，新增HSL各5，24色带只测1080。
  raw饱和度1080 200.2→183.2ms，4K799.7→732；单帧全质量179.6→161.7及724.8→658.4。
  6色带单帧1080 338.3→283.5、4K1330.4→1119.9；24色带+曲线1080 944.2→697.6。
  最终各测量case均改善，修正此前RGB-only对照约7%退化；旧report完整保留，未覆盖。
  RGB-only及最终组合JSON分别为docs/video-studio-color-{lut,combined}-benchmark.json，
  可用scripts/bench-video-studio-color.mjs复跑，记录source/script/browser/system及
  全部样本。计时排除素材解码、音频、UI、代理准备，不能当作整体预览FPS。

根冻结源typecheck、build/build:check/validate39通过；offline1131通过3可选跳过，
native voice5通过1可选跳过，workspace docs5/5。真实媒体230/230通过，154531ms，
日志`/tmp/video-studio-morning-sixteenth-media.log`；完整浏览器1278/1278通过，728362ms，
日志`/tmp/video-studio-morning-sixteenth-full-ui.log`。
PNG+quality最终独立真实组合4/4通过，核对Workspace c3e25e5及Preview b1f547f一致：
held toBlob与晚quality、自动恢复quarter后pending decode、旧blob不清新owner、末尾
80013tick与质量刷新均正确。日志`/tmp/video-studio-png-quality-independent-review.log`。
未变更0.7.2版本、工程格式、Host权限或用户安装。继续优化至11:00。

第十五批4aa201a的push CI38182467460初次全部7jobs成功；PR CI38182471609出现
两个超时：Video Studio library multi-select删除等待、另一面板Design Studio的
native touch取消等待。根16整套UI包含前者且绿，不能据此宣称Linux PR失败已修复；
后者不属于本轮Video Studio领域1131项。已派独立调查，保留原log与具体因果边界，
不通过盲目重跑掩盖，最终交付仍须最新head门禁。
