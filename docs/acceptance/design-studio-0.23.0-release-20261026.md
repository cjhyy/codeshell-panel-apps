# Design Studio 0.23.0 合并发布记录

用户明确要求合并并发布面板仓库。本轮从刷新后的 `origin/main`（`7850d68`）建立
`codex/design-studio/release-0.23.0-20261026`，正常合并 `855f6ed` 及其前置
`afae05a`。没有用旧工作树覆盖当前主线；本机 `main` 上未推送的视频工作台
`090300c` 不属于本次发行源码。

本版包含简化工具栏、可搜索文件切换、800ms 自动保存、独立画板和无限工作区。
旧稿可显式启用无限模式，保留图层坐标、层级、稳定 ID 和 Figma 来源。位置安全预算
仍为 ±1,000,000，单画板尺寸最多 20,000；全局文档宽高只作为空导出的 fallback。

## 主线能力保留与组合回归

合并时保留主线的浏览器 HTML/CSS 渲染、原生文字范围/准入/字体事务、Grid、描边、
圆角、阴影栈、精度和来源校验。Figma 测试保留主线完整前缀，再追加原无限模式测试；
自包含插件由当前源重新生成，不选择一方的旧生成物。

| 组合问题 | 触发和预期 | 稳定 case |
| --- | --- | --- |
| 像素行高与内容 bounds | 无限页不能再次把 pixel 行高乘以字号 | `infinite-canvas-release-compat.test.mjs` |
| 独立描边/阴影/文字范围 | 透明基础填色仍应包含独立描边、阴影栈和区间填色的真实可见内容 | 同上 |
| 远坐标文字基线 | 主线基线刷新在无限页使用位置预算；旧有限页继续拒绝超旧预算 | `infinite-layout-baseline.test.mjs` |
| 浏览器世界原点 | 活画布使用源世界坐标、透明工作区；便携导出仍按内容原点平移。负坐标、65000 正坐标、hit、真实 Frame clip 和 CSS flow 分别核对 | `infinite-browser-renderer.test.mjs`、`infinite-exports.test.mjs` |
| 字体失败与文件切换 | 先保存当前编辑；目标文件字体解码失败时恢复原稿及路径，保留选择器并允许同一行修正后重试 | `file-switcher-ui.test.mjs` |
| Browser Fit 与异步加载 | 使用实际 CSS 几何适应内容/选区；主动 Fit 可等待首次加载，用户平移后普通重绘不能重置视口 | `infinite-canvas-ui.test.mjs` |

原无限画布 case 及旧失败基线约定见
[无限画布回归记录](design-studio-infinite-canvas-20261023.md)，工作台/自动保存约定见
[工作台回归记录](design-studio-workspace-20261023.md)。新增输入均为固定本地 fixture，
没有依赖在线网页或实时字体。仅修改预期确实变化的无限模式行为，没有用更新快照或
降低阈值处理非预期差异。

本地 `artifacts/design-studio-release-0.23.0-20261026/` 保留模型、布局/渲染及文件切换的
源 SHA、旧失败结果、完整日志和实际截图。导出补充证据另在
`artifacts/design-studio-0.23.0/merge-exports/`。

额外核对主线 custom underline ±100px offset / 100px thickness：自动 bounds 和显式
大 viewport 都以 `TEXT_RANGES_SVG_UNSUPPORTED_DECORATION` 明确拒绝，未产生 SVG。
这属于保留的出口能力边界，没有按理论风险扩大 bounds 或声称该 SVG 能力已实现。
输入与回执保留在 `artifacts/design-studio-0.23.0/custom-underline-svg-preflight/`。

## 原主线 CI 失败的修复

检查 `7850d68` 的真实 Linux CI（run `39929370423`）发现两个失败 job：
Design Studio fidelity 的百分比圆角转换异常，以及 offline job 的六个字体/像素 case。
原日志保留在 `ci-baseline/`，没有将它们当作本轮新回归或通过结果。

- 百分比圆角现在按原始 border box 分轴解析，只接受可精确表达的圆形半径；
  椭圆、复杂表达式和未知尺寸继续明确拒绝。原 fidelity fixture 与阈值不变。
  最小 `%` 与等价 `px` 控制新增在 `percentage-circle.html` 和圆角回归中，旧完整源码、
  失败日志与实际 PNG/JSON 保留在 `percentage-corners/`。
- 五个 DOM 编辑后的像素比对增加共享的真实字体加载屏障。受控慢字体 case 证实
  `fonts.ready` 可能已返回，而新 Inter face 仍未加载；屏障等待明确字体加载、布局与
  两个 paint 帧。原输入、逐像素断言与阈值保持不变。失败保留两张 PNG、HTML、
  字体状态及差异范围，Linux job 会上传这些合成 fixture 证据。
- 原生文字基线测试保留原五种字体、0.02 几何阈值和零像素差断言。独立、未注册的
  `local("Georgia")` FontFace 探针判断系统条件：可用时仍要求无回退；不可用时必须
  精确报告唯一的 Georgia fallback，其他四字体仍须可用。包内 Roboto 和故意缺字体
  控制继续执行，不安装私有字体、不忽略其他诊断。

本机定点通过不代替 Linux 缺字体分支与像素验收；候选分支仍须经过真实远端 CI。

首个候选 `2491172` 的本地完整门禁及 Linux fidelity job 发现新增像素行高 UI case
仍点击旧常驻 `#save`；大文档脚本也保留相同旧入口。两处改为正常打开“更多”菜单
再保存，原内容/重开断言不变。`toolbar-entry/` 保留原脚本、隐藏按钮实际失败和
定点成功日志；702 节点、分片重开、内容地址图片/字体及操作日志恢复全部通过。

## 发布门禁与资产

发布前运行仓库要求的 `npm run check`、包校验与受影响的 Design Studio fidelity 检查。
从通过检查的干净合并提交打包，保留 `release.json` 的源提交和逐文件 SHA；正式目录和
面板 ZIP 使用官方 Core 的只读 preflight，发布后重新下载资产核对摘要。

预检使用官方已发布 Core `0.9.46`，不使用未发布 Host 源替代。目录与 ZIP 的 id、
版本、7 项权限、16 个工具、2 个 Skill 及 `reviewToken` 一致。仓库旧开发依赖
`0.9.23` 尚不允许 `.wasm` 资产，不能把它的预检结果当作本版安装兼容证明；
本版仍要求支持包内 Wasm 的 Host，没有隐藏扩展名或绕过安装器规则。

GitHub 资产为 Design Studio 面板 ZIP、HTML to Figma 开发插件 ZIP、`release.json` 和
`SHA256SUMS`。本次 GitHub 发布不等于 Figma Community 上架，也不修改用户已安装的
面板或 Figma 账号。
