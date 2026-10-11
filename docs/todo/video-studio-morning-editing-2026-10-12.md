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
