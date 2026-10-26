# Design Studio 工作台与自动保存回归记录

用户问题：顶栏按钮过多、文件切换不清楚，且恢复草稿被误认为主文件自动保存。
本轮在 origin/main `13d591c` 新建独立任务工作树；没有复制旧保真工作树的未提交修改。

## 行为与边界

- 顶栏保留文件名、保存状态、交付、AI、更多。页面管理移到左栏，低频操作使用原按钮
  和原事件进入更多菜单，避免动态 Figma、讨论、原型、另存为按钮产生重复入口。
- 文件选择支持名字/完整路径搜索、项目内最近打开顺序、方向键/Enter。成功才关闭，
  失败可在原行重试。最近记录只影响排序，不作为文件版本或保存基线。
- 普通编辑 800ms 后写入主文件。切换文件/新建设计先等待正在执行的保存，再保存最新
  编辑。保存使用原来的 CAS、资源和来源绑定发布协议；失败保留原稿。
- 工作区、文档或路径改变后，旧计时器和旧回执不能影响新稿。初稿保持 create-only；
  手改路径需显式保存确认。编辑事务、导入和拖动期间不发布中间状态。
- 浏览器仅保存到该浏览器；Host 项目文件和浏览器本地存储分别验收。本轮未新增权限。

## 稳定 case 与保留的失败基线

| Case | 触发与预期 | 仓库中的回归 |
| --- | --- | --- |
| WS-01 顶栏简化 | 1200/800/390px；更多内的实际按钮可打开原功能，键盘关闭及焦点返回正常 | `toolbar-ui.test.mjs`；讨论/原型旧 UI suite |
| WS-02 文件导航 | 同名不同路径可辨别，大小写搜索、最近顺序、项目隔离，打开失败可重试 | `file-navigation.test.mjs`、`file-switcher-ui.test.mjs` |
| WS-03 主文件自动保存 | 编辑不点保存，主文件更新；重开仍是新内容；浏览器本地同样通过 | `document-autosave.test.mjs`、`autosave-ui.test.mjs` |
| WS-04 保存与切换竞争 | 保存期间继续编辑，切文件前必须保存较新内容；失败禁止切换 | `autosave-ui.test.mjs` |
| WS-05 作用域与路径 | 切项目不发送旧稿；手改路径不自动写入；已有默认文件不被初稿替换 | `autosave-ui.test.mjs` |
| WS-06 撤销回空稿 | 首次保存后 Undo 回原始空稿，仍须更新已有主文件 | `autosave-ui.test.mjs` |
| WS-07 同内容竞争创建 | 另一写入者创建相同内容后返回明确冲突，自动保存不能收养该基线并覆盖后续修改 | `autosave-ui.test.mjs` |
| WS-08 异步索引打开 | 加载目标分片时退出选择器并编辑，迟到读取不能覆盖新编辑 | `file-switcher-ui.test.mjs` |
| WS-09 活动手势切文件 | resize 尚未结束时打开文件；先回滚手势，再保存有效稿，不因 autosave deferred 拒绝打开 | 旧 `touch-ui.test.mjs` 原有断言 |
| WS-10 新建设计 | 当前修改先保存，失败保留原稿与文件选择器，不弹丢弃提示 | `file-switcher-ui.test.mjs` |
| WS-11 加载期间恢复草稿 | 资源读取期间编辑并发生主保存失败，或 lastPath 回执迟到时已换稿；旧打开流程不能删除新的完整恢复草稿 | `autosave-ui.test.mjs` |
| WS-12 导航取消旧 AI 提交 | 新建/切文件等待保存期间，旧关联 AI 请求不能抢先继续提交 | 旧 `recovery-ui.test.mjs` 的 late delivery 断言 |

所有文件均位于 `tests/apps/design-studio/`；新增测试已登记到 `tests/suites.mjs`，
真实 Chromium 测试使用串行浏览器组。旧断言没有通过更新快照或降低阈值绕过。

本地证据保留在忽略的 `artifacts/`，不覆盖旧结果：

- `autosave-20261023/`：旧 app 同断言 6 RED/12 control；另外保留空稿 Undo 和同内容
  创建竞争的独立 RED，以及实现阶段冻结 20/20 GREEN。
- `toolbar-20261023/`：旧顶栏与动态按钮 RED；桌面/手机截图及 18 项相关 UI GREEN。
- `workspace-simplicity-20261023/`：旧文件导航 3 RED 与首轮 7 GREEN，人工浏览器截图。
- `toolbar-review-autosave-20261023/`：索引分片读取期间编辑被覆盖的原始反例。
- `autosave-20261023/open-recovery-*/`：两项实际 recovery 由完整稿件变成 undefined 的
  RED，以及同断言 22/22 GREEN。
- `workspace-simplicity-20261023/final-20261023T051858Z/`：首轮完整门禁保存冻结源码
  SHA；首阶段 338 项中 336 PASS、1 既有可选 SKIP、1 late agent delivery FAIL。
  该失败触发 WS-12 产品修复，不通过修改旧断言放行。
- `workspace-simplicity/legacy-ui-20261023T050401265907Z/`：旧菜单操作适配前后的日志，
  包含曾出现的初始化超时与未完成手势失败；失败记录保留，不作为最终通过结果。

旧基线可由 `git show 13d591c:apps/design-studio/app/app.js` 获取；文件选择器基线还应
冻结同一提交的 `index.html`、`style.css`。新测试的 `DESIGN_STUDIO_AUTOSAVE_OLD_APP_JS`
和 `DESIGN_STUDIO_FILE_SWITCH_OLD_ROOT` 允许对冻结源码运行相同断言。

## 旧回归的前提调整

菜单搬动后，旧 UI 测试先展开更多，再操作原按钮；不强制点击隐藏元素。
两个恢复草稿 case 必须保持“只有恢复草稿、没有主文件”的原场景；自动保存使旧 setup
不再满足该前提，因此只在这两个 fixture 的主文件 publication 之前注入受控写入失败，
并确认自动保存确实尝试写入、主文件仍不存在。原 CAS、备份、重载、embedded baseline
断言完整保留。恢复基线等待失败保存与完整 journal 就绪后捕获，避免截取中间来源状态。

## 人工验收与范围

在独立 `http://127.0.0.1:4188/` 浏览器 origin 上，通过正常界面改名、等待自动保存、
刷新、新建第二稿、搜索和切回第一稿；刷新与切回后的设计名称正确，状态显示已保存。
未读取或替换用户既有 origin 的设计数据。截图位于
`artifacts/workspace-simplicity-20261023/manual-preview/`。

本轮是源码与本地预览验收；没有将该工作树安装为正式 Panel，也不代表真实 Host 或
Figma 帐号内的验收。正式安装应使用集成后的稳定来源。

## 最终门禁

`npm run typecheck`、`npm run build -- --app design-studio`、
`npm run build:check -- --app design-studio`、`npm run validate` 均通过。
这些检查保存在 `artifacts/workspace-simplicity-20261023/final-20261023T052141Z/`。

`npm test -- --suite design-studio` 最终通过：两组共 **450 项，448 PASS、0 FAIL、
2 既有可选 SKIP**。跳过项分别需要另行准备的 Grida encoder 和外部完整设计样本，
本轮新增 case 没有跳过。`git diff --check` 通过。
最终日志与全部输入前后 SHA 位于
`artifacts/workspace-simplicity-20261023/final-20261023T052504Z/`；测试期间无源码漂移，
应用源码与前一次构建/静态检查完全相同。

前一完整运行的唯一剩余失败是 WS-02 测试在路径刚更新时读取 recents，此时文件选择器
仍在等待打开流程结束。最终只增加等待选择器关闭的公开完成边界，严格排序和项目隔离
断言未变；原失败保留在 `final-20261023T052141Z/`，最终重跑确认修复。

并行编辑阶段的一次连接标签文案改动曾短暂引用不存在的 `bridge` 变量，已改用现有
`window.codeshellPanel?.call`。早期六项初始化超时未输出 pageerror，不能据此独立认定
原因；原日志保留，冻结源码的完整门禁中这些测试全部通过。
