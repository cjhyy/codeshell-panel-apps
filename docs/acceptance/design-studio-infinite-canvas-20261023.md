# Design Studio 无限画布回归记录

用户要求：工作区像 Figma 一样允许多个画板自由摆放，不再受整份文档宽高限制；
修复须保留稳定 case，并重跑相关旧回归。

本轮从最新 `origin/main`（`13d591c`）建立独立任务分支，并并入上一轮工作台和自动
保存提交 `afae05a`。主仓库的 Video Studio 未提交修改、旧 HTML 保真工作树和旧浏览器
origin 数据没有移入本轮代码。

## 数据与兼容约定

- 新建稿默认 `canvas.mode: "infinite"`，顶层 Frame 直接作为独立画板，没有新增一层
  巨大的根画板。旧稿缺省 mode 的 canonical 序列化与有限画布行为保持不变。
- 旧稿一键启用无限模式，只改变 mode，保留坐标、父子关系、稳定 ID 与 Figma 来源。
  支持撤销、重做、自动保存、单文件与 indexed 文档重开。
- 无限模式只移除文档级 overflow。画板自身裁切、父级越界、文字墨迹和结构检查仍执行。
- 世界位置有独立 ±1,000,000 数值预算，单图层/画板尺寸仍最多 20,000。手势、属性编辑、
  键盘移动、组件实例、对齐及分布必须保持可保存状态；不能只让 codec 接受新坐标。
- 内容 bounds 聚合可见绘制、描边、阴影、实例效果与祖先裁切，保留负 origin；导出与
  截图不修改源坐标。HTML/原型仅在输出容器中偏移原点，Figma 继续使用源世界坐标。

## 稳定 case

| Case | 触发和预期 | 回归文件（`tests/apps/design-studio/`） |
| --- | --- | --- |
| IC-01 新建与旧稿升级 | 默认无限、隐藏全局宽高；升级不包装/平移旧图层；撤销、保存和重开保留状态 | `infinite-canvas-ui.test.mjs` |
| IC-02 世界位置与保存 | 负坐标与超出旧 20,000 范围的多个画板自由移动，子树位置差不变；重开和适应全部内容正确 | `infinite-canvas.test.mjs`、`infinite-canvas-ui.test.mjs` |
| IC-03 实际 GPU | 正负 350,000 位置仍绘制，画板子裁切、缓存失效和透明工作区背景正确 | `infinite-canvas-renderer-ui.test.mjs` |
| IC-04 内容范围导出 | SVG/HTML/原型包含负坐标、远画板、阴影；每页使用自己的 origin 和尺寸，后代 Frame 约束不退化 | `infinite-canvas.test.mjs`、`infinite-exports.test.mjs`、`infinite-exports-ui.test.mjs` |
| IC-05 截图 | 负坐标画板及 padding 保留；完整大范围截图使用受限输出像素，不分配整个世界大小的位图 | `infinite-canvas-ui.test.mjs` |
| IC-06 几何与质量 | 根单选对齐不参照整个工作区；实例不夹回旧文档；画板外修复保留真实 Frame 裁切与锁定检查 | `infinite-canvas-geometry.test.mjs`、`infinite-canvas-quality-repair.test.mjs` |
| IC-07 低缩放手势 | 创建、缩放、拖动、属性编辑和键盘移动不会产生超数值预算的不可保存几何；整树共同提交或拒绝 | `infinite-canvas-gestures-ui.test.mjs` |
| IC-08 Indexed 与来源 | 启用模式不重写未变页面分片，不改变来源映射；Undo/Redo、保存重开后 Figma 无误报 patch | `infinite-canvas-index-ui.test.mjs` |
| IC-09 插件与 Host schema | 实际 Figma 插件完整导入和增量 patch 接受同一坐标预算；旧 bounded 与越预算输入仍拒绝 | `infinite-canvas.test.mjs`、`figma-plugin.test.mjs` |
| IC-10 祖孙多选与分布 | 同时选择祖先/后代只移动一次，分布预算预检覆盖整棵树；不允许部分提交 | `infinite-canvas-geometry.test.mjs` |
| IC-11 首次保存和旧 UI | 新无限空稿首次保存后仍能提交原 AI 请求；无限模式没有全局越界，旧固定稿仍保留完整问题分页 | 旧 `connection-ui.test.mjs`、`exchange-tools-ui.test.mjs` |
| IC-12 手势末尾自动布局 | 靠近世界位置上限，扩大末端对齐画板会令子节点越界时，整个手势回滚，不产生无效历史或不可保存稿 | `infinite-canvas-gestures-ui.test.mjs` |
| IC-13 文字可见范围 | 自然行宽于文字图层时，SVG 保留完整实际墨迹；有效/失效测量回执、旋转、阴影与真实 Frame 裁切分别验证，旧固定稿输出不变 | `infinite-canvas.test.mjs`、`infinite-exports-ui.test.mjs`、`infinite-text-bounds.fixture.mjs` |

最小冻结输入位于 `infinite-canvas.fixture.mjs`、`fixtures/infinite-canvas.mjs` 和
`infinite-exports.fixture.mjs`。浏览器 case 明确 viewport、字体/图片条件，没有依赖在线
网页。旧 bounded 控制 case 保留；预期改变只针对显式 infinite 模式。

## 证据保留

本地 `artifacts/infinite-canvas-20261023/` 保留源 SHA、旧输入、旧失败基线、全部原始日志
与实际前后截图。子目录为 `model/`、`exports/`、`geometry-renderer/`、`workbench-ui/`。
旧断言在冻结 `afae05a` 完整源码上运行，不用新结果覆盖旧结果。

联调中错误的测试前提也保留并区别记录：早期 root UI fixture 缺少 Frame 的 gap 等必填
字段，随后 mock Host 未声明 Wasm 能力导致无法进入拖动；这些属于测试 setup 错误，
不算产品 RED。修正完整 fixture 和真实 GPU 能力后，四项交互 case 全部通过。

低缩放检查暴露了真实数值风险：普通屏幕拖动会变成数十万世界单位，必须在创建/缩放
期间限制单画板尺寸，并对整个移动子树原子校验。修复前后的 case 单独保留。

属性布局另有两个真实 case：在世界坐标边缘增大 padding 不得把后代排到预算外；同一
焦点中先输入合法值、再输入非法值，回滚后保留的合法值仍必须正常记录，Undo 能回到
此前状态。各次 RED/GREEN、只读 VM 诊断和完整源码快照分别保留在 geometry-renderer。

首轮完整运行 `final-20261023T060402Z/` 保留 2 个旧 UI 失败及全部冻结源码摘要：新空稿
canvas 的对象键顺序与保存规范化结果不一致，导致 AI 提交把首次保存误认为内容变化；
已统一初始 canonical 顺序，原提交断言不变。旧审计分页 case 则隐含“Figma 导入仍为
固定稿”的前提；现先确认无限导入全局越界为零，再正常打开一份仅去掉 mode 的固定稿
副本，保留原 125 条问题、50 条分页、分组及定位全部断言。没有降低阈值或跳过旧 case。

随后 `final-20261023T061041Z/` 完整通过：Design Studio 503 项（501 通过、2 个原有可选
跳过），Panel CLI 6 项通过；插件包同步、typecheck、构建、构建一致性、validate 和
diff 检查均通过，运行前后源码 SHA 一致。该轮保留为收尾审查前的完整基线。

收尾审查另发现手势本身合法、但 mouseup 自动布局可使后代越世界预算。IC-12 使用
x=999800、width=150、末端对齐的真实 Frame，拖宽到 350 会把子节点排至非法位置。
保留实际 GPU RED，修复后整页布局与该次手势共同回滚，前一个合法修改仍正常 Undo；
本次与原 9 项手势 case 共 10 项通过，证据追加至 `geometry-renderer/manifest.v5.json`。

IC-13 用固定本地 Roboto、32px、20 个 M 实测：图层宽 100，实际 advance 558.75、墨迹宽
553.453px。旧默认 SVG 只剩 915 个黑像素；显式大 viewport 控制为 5263。修复后默认
SVG 同为 5263，完整保留尾部。已有 GPU 绘制及真实 Frame 裁切在修复前后均正确，因此
没有为理论风险改写渲染器。无限输出使用有效文字墨迹回执；无回执时按自然行保守估算，
按原图层 pivot 处理旋转并应用祖先裁切；文字阴影 filter 同步覆盖墨迹。物理 PNG、
字体 SHA、完整 RED/GREEN 与源码快照保留在 `text-ink/`，不覆盖前次结果。

## 最终回归

最终冻结运行 `artifacts/infinite-canvas-20261023/final-20261023T062142Z/`：

- `npm test -- --suite design-studio`：507 项，505 通过、0 失败、2 个原有可选跳过。
  两个跳过仍为未准备的官方 Grida encoder 和未提供的外部 portable 样本；本轮新增
  case 全部执行，没有新增跳过。
- `npm test -- --suite panel-cli`：6 项全部通过。
- 插件自包含包 `--check`、`npm run typecheck`、Design Studio build / build:check、
  `npm run validate` 与 `git diff --check` 均通过。
- `source-before.json` / `source-after.json` 的应用和测试 SHA 全部一致；
  `result.json` 记录 `unchanged: true`。本节和下方人工验收记录在该轮之后补写，
  不再修改应用或回归输入。

## 实际界面验收

新版预览为 `http://127.0.0.1:4190/`，使用新的浏览器 origin，没有改写旧 4188 数据。
通过正常工具栏和属性界面创建三个根级画板：

| 画板 | 最终位置 | 尺寸 |
| --- | --- | --- |
| 首页 | (-400, -80) | 320 × 640 |
| 详情页 | (0, 0) | 320 × 640 |
| 设置页 | (472, 16) | 320 × 560 |

设置页先位于 (400, -40)，通过真实画布拖动到 (472, 16)；未调用隐藏状态修改接口。
正常等待编辑自动保存显示“已保存”后刷新页面，三个画板仍在，首页负坐标和设置页
拖动后坐标逐一核对一致。重开后工作区自动适应全部内容，保留 GPU 与独立画板背景。
`manual-preview/` 保留空白、保存前、重开后的截图和完整 AX 状态；最终示例为
`03-reopened-negative.png`。该示例只使用本地创建的空画板。

## 验收范围

分项包含真实隔离 Chromium 与 GPU 像素、文件 CAS、单文件/索引/分片数据以及实际插件
代码的 fake Figma API。浏览器预览的数据仅在该浏览器，Host 项目存储和真实 Figma
账号验收仍有各自边界；本轮没有发布或安装新版本。
