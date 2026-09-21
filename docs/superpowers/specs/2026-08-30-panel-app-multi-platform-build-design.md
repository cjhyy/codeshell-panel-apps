# Panel App 多端构建与局部重设计

日期：2026-08-30
状态：已确认设计方向，待实施计划

## 1. 决策摘要

Panel App 不做全面重写，也不把问题归因于 `.mjs` 后缀。现有纯领域 `.mjs` 多数内聚且可直接测试；真正需要治理的是：

1. Desktop、Web、Mobile 对宿主能力的访问方式尚未形成稳定边界。
2. `app.js`、部分 `*-ui.mjs` 和 `scripts/validate.mjs` 混合过多职责。
3. 当前测试门禁不足以安全支撑模块迁移。
4. 当前浏览器原生源码与发布产物是同一平面，限制了类型检查、构建期裁剪和多端适配。

采用“折中构建”路线：

- 使用 TypeScript 和轻量构建工具维护源码。
- 不引入 React 等 UI 框架，不引入 Cordis 级插件内核。
- 每个 Panel 的发布产物继续自包含、可离线加载、可按 App 子目录独立安装。
- 安装器永不执行来自 Panel 仓库的构建脚本；构建只发生在开发机和可信 CI。
- 优先级固定为：多端适配 → 维护成本降低 → 基于测量的性能优化。

最终裁决是**局部重设计**，不是全面重设计。

## 2. 现状证据

Claude Code 与 Codex 分别做了只读诊断和独立复审，结论一致：

- `apps/job-hunt-hq/app/app.js` 同时承担持久化、渲染、Agent Tool 注册、输入适配和事件绑定，是职责跨度意义上的 God module，不只是文件较长。
- `scripts/validate.mjs` 将通用包校验和各 App 专用测试集中在一个函数内，并通过扫描 `app.js` 字面量验证工具和选择器；直接移动代码会让门禁失真。
- Quant Lab 的纯领域模块整体优于入口和 UI controller，但未提交的 A 股扩展中，多个 controller 重复实现进程生命周期。
- Codex 发现未提交 Quant Lab 代码存在更高优先级的正确性问题：全局 `process.output/exit` 事件没有在所有 controller 中验证进程归属，一个 controller 可能消费或取消另一个 controller 的进程。
- 当前 Quant UI 测试没有进入默认 CI 主门禁，Job Hunt 也缺少不依赖外部 Desktop 仓库的轻量启动 smoke。
- `.mjs` 代码量不能直接推导性能问题；当前缺少冷启动、解析执行、长任务和内存基线。

当前工作区包含大量 Quant Lab、Video Download 和 validator 未提交改动。实施必须使用隔离 worktree，并把“现有功能修复”和“结构迁移”拆成独立提交。

## 3. 备选路线

### 3.1 保持零构建并小步拆分

优点：改动面最小，保留浏览器原生源码即产物的简单模型。
缺点：多端能力仍主要依赖运行时约定，缺少统一类型边界、构建期裁剪和可重复产物门禁。
结论：可行，但不满足“桌面 + Web + 移动端”作为第一优先级的长期目标。

### 3.2 折中构建，产物继续自包含（采用）

优点：获得 TypeScript、模块边界、构建期验证、source map、动态加载和多端入口，同时保留独立安装与离线运行。
缺点：必须管理 source/artifact 一致性，开发流程增加构建步骤，校验器与安装契约需要升级。
结论：收益和复杂度最匹配当前目标。

### 3.3 全插件化运行时

参考 DeepSeek Harness，把模型、工具、存储、会话、UI 等全部建成可组合插件与 Profile。
优点：组合能力最强。
缺点：Panel App 并不是完整 Agent Runtime；照搬会把大文件问题转换为插件内核、生命周期和配置图复杂度。
结论：不采用。只借鉴能力接缝、多运行模式和 source/artifact 分面。

## 4. 目标架构

### 4.1 仓库结构

迁移完成后的目标结构：

```text
packages/
  panel-sdk/
    src/
      capabilities.ts
      errors.ts
      lifecycle.ts
      process-client.ts

sources/<panel>/              # 开发源码，不属于远程安装根
  entry/
    desktop.ts
    web.ts
    mobile.ts
  host/
    desktop-adapter.ts
    web-adapter.ts
    mobile-adapter.ts
  domain/
  features/
    <feature>/
      controller.ts
      model.ts
      view.ts
      parser.ts
  contracts/
  public/
    index.html
    static/
  panel.json
  agent/
    skills/
  tools/                       # 本轮继续使用原生 Node ESM

apps/<panel>/                  # 构建并提交的完整安装快照
  .codeshell-panel/
    panel.json
  app/
    index.html
    assets/
    tools/
  agent/
    skills/
  README.md
```

`apps/<panel>/app/` 继续满足现有 `panel.json.entry = "app/index.html"` 约定。远程安装地址保持不变，仍指向 `apps/<panel>`；宿主看到的只有静态安装快照，不需要允许 `.ts`、理解 workspace，也不执行 `package.json` 或构建脚本。源码、manifest 和 Skill 的权威副本位于 `sources/<panel>`，构建流水线原子生成完整 `apps/<panel>` 临时快照，验证后才替换受管文件；面向用户的 `README.md` 可作为明确列出的非生成文件保留。

本地开发时，watcher 从 `sources/<panel>` 增量生成 `apps/<panel>`，CodeShell 的 **Choose source folder** 仍选择后者。迁移期允许旧 `app.js/.mjs` 与 `app/generated/` 共存。每次只迁移一个 feature；最终才把整个安装快照交给构建流水线拥有。

### 4.2 Source Plane 与 Artifact Plane

源码平面负责：

- TypeScript 类型检查。
- 单元测试和浏览器测试。
- 多端 adapter 和 feature 组合。
- 生成 manifest 可核验的静态运行闭包。

产物平面负责：

- 独立安装和离线运行。
- 原生 ESM 输出和必要的 code splitting。
- 不包含运行时包管理器、dev server 或外部 workspace import。
- 提供 source map 供开发版本调试；正式发布是否包含 source map 由发布策略控制。

CI 必须执行一次干净构建，并验证工作树中的 `app/` 没有变化。源码与提交产物漂移时禁止合并。

### 4.3 Panel SDK 边界

`panel-sdk` 是轻量、框架无关、构建时依赖。它可以被打入每个 Panel 的静态产物，但不能成为安装后的外部运行时依赖。

首批能力仅包含已存在且跨端确有差异的五类：

```ts
interface HostCapabilities {
  storage: Capability<StorageClient>;
  process: Capability<ProcessClient>;
  tools: Capability<ToolClient>;
  files: Capability<FileClient>;
  system: Capability<SystemClient>;
}

type Capability<T> =
  | { status: "available"; client: T }
  | { status: "unavailable"; reason: CapabilityUnavailableReason };
```

边界规则：

- Feature 只依赖能力接口，不直接访问 `window.codeshellPanel`、Node API、WebSocket 或端类型。
- Adapter 负责把 Desktop bridge、Web RPC 或 Mobile Web API 映射为同一接口。
- 不支持的能力必须显式返回 `unavailable`；禁止通过方法不存在、空对象或异常消息猜测能力。
- 不建立通用 service locator，不允许任意字符串注册能力。
- 新能力只有在至少两个真实消费者需要同一稳定语义时才进入 SDK；复制次数不是唯一判断标准。

### 4.4 三端行为

| 能力 | Desktop | Web | Mobile |
| --- | --- | --- | --- |
| storage | Host 持久化 | 服务端 API，必要时 IndexedDB 缓存 | 服务端 API，必要时 IndexedDB 缓存 |
| process | 本地 Host process | 远程任务；未配置时 unavailable | 远程任务；未配置时 unavailable |
| tools | Desktop bridge | HTTP/WS RPC | HTTP/WS RPC |
| files | 本地选择与路径 | File API、上传与下载 | 相册/拍照、上传与下载 |
| system | 平台信息、通知、打开链接 | 浏览器平台能力 | 触控环境和移动平台能力 |

所有端共享业务模型和 feature。端专属入口只负责组装 adapter、能力降级策略和端级 UI shell，不复制领域逻辑。

## 5. 数据流与生命周期

标准数据流：

```text
User/Event
  -> Feature Controller
  -> typed capability request
  -> Host Adapter
  -> Desktop Host 或 Web/Mobile Server
  -> typed result/event
  -> parser/domain model
  -> feature state
  -> view render
```

### 5.1 进程所有权

`ProcessClient` 必须解决当前未提交 Quant Lab 代码暴露的串扰问题：

- 每次启动创建唯一 owner token，并记录 owner 与 processId 的对应关系。
- controller 只能接收自己 owner 下的 output、exit 和 error。
- foreign event 必须被忽略，不能创建本地记录，更不能触发 cancel。
- bounded output、timeout、cancel、late event 和 dispose 由 `ProcessClient` 统一处理。
- 参数构造、结果 JSON 解析和业务进度语义继续留在 feature 内，不进入通用 client。
- 页面卸载、路由切换、feature 重新初始化和用户取消都必须释放 listener、timer 和 owner。

### 5.2 持久协议

FNV-1a 等影响持久化兼容的算法进入窄 `contracts/` 模块，并使用 golden vectors 验证逐位兼容。`mean`、`round`、`finite`、`cleanText`、`sanitizeBars` 等同名函数当前具有不同失败语义，不合并为宽泛的 `format` 或 `utils` 杂物模块。

## 6. 错误处理和降级

跨端错误使用稳定结构：

```ts
interface PanelError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}
```

规则：

- Adapter 保留机器可判断的 code；Feature 决定业务恢复动作；View 负责本地化用户文案。
- 能力不可用不是异常。Feature 应隐藏入口、提供替代路径或展示明确限制。
- 网络断开、远程任务丢失和页面恢复必须具有确定状态，禁止无限 loading。
- 未知 wire response、持久化输入、用户文件和工具 JSON 在边界校验；同进程内部已类型化数据不重复验证。
- CSP 是独立安全批次。Design Studio 使用 data SVG 和动态样式，不能直接复制其他 App 的策略，必须逐 App 在真实浏览器验证。

## 7. 构建与分发

采用 vanilla TypeScript + Vite 构建浏览器 ESM，不引入 UI 框架。Vite 只处理 `sources/<panel>/entry`、HTML、CSS 和浏览器静态资源；现有 `app/tools/*.mjs` 在本轮保持原生 Node ESM，不纳入浏览器 bundle。将来只有在真实需求要求 Node tool TypeScript 化时，才单独引入 Node 构建面，不预先增加第二套工具链。

构建必须：

1. 保留原生动态 import 与 source map。
2. 生成确定、可审计的运行时文件清单。
3. 不需要在安装端执行。
4. 不改变现有 CSP、相对资源路径和 `app/tools/*.mjs` 的 Node 启动语义。
5. 使用固定依赖版本和锁文件，避免不同环境产生不同 artifact。

构建输出必须原子地写入临时目录，验证后再替换 `app/`。禁止先清空当前可运行产物再开始可能失败的构建。

发布包验收：

- `panel.json.entry` 存在且只能引用 `app/` 内文件。
- 所有运行时 import 都闭合在 App 自身安装目录。
- 不存在 workspace 裸依赖、绝对开发路径或未声明远程脚本。
- manifest 权限与构建前一致，除非该批次明确修改能力。
- 从仅含安装闭包的临时目录也能启动，而不是依赖仓库根目录。

## 8. 测试和门禁

重构前先建立门禁，顺序不可倒置。

### 8.1 静态门禁

- 递归检查所有 `app/**/*.js|mjs`，不再维护手写文件白名单。
- TypeScript strict typecheck。
- 验证浏览器模块图、Node tool 模块图和运行端入口没有越界 import。
- 构建两次并比较运行时清单与内容摘要，排除非确定产物。
- 干净构建后执行 `git diff --exit-code -- apps/*/app`。
- validator 不再只扫描 `app.js` 字面量；工具注册、selector 和 manifest 对应关系基于可解析模块图或显式生成清单。

### 8.2 单元测试

- domain、parser、contract 和错误映射直接测试。
- `ProcessClient` 覆盖并发 owner、foreign output、超限、timeout、cancel、late event、exit 和 dispose。
- 每个 adapter 使用 contract suite，确保相同能力语义。
- 持久协议使用 golden vectors。

### 8.3 浏览器 smoke

- 每个 App 都有不依赖外部 Desktop 仓库的 Host stub。
- Desktop、Web 和 Mobile viewport 至少完成入口启动、主要导航和能力降级 smoke。
- Quant 的真实 DOM 启动 smoke 进入 CI，而不是只做无 HTML 的 selector 检查。
- Job Hunt 先覆盖初始化、持久化 stub、一个核心工作流和 Agent Tool 注册。

### 8.4 端到端测试

依赖真实 Desktop、远程 Server 或外部网络的 E2E 保持独立，不能取代离线 smoke。CI 主门禁只使用可重复的本地 fixture；网络探测保留为 opt-in。

## 9. 性能策略

构建步骤只提供优化工具，不自动证明性能改善。任何性能改动前必须记录：

- 冷启动到首个可交互状态。
- JS 下载/读取字节、parse/evaluate 时间。
- 主线程长任务和峰值内存。
- 首个 feature 的动态加载时间。
- Desktop、普通桌面浏览器和中档移动设备三类环境。

第一阶段只建立基线和回归阈值，不预设绝对数字。基线稳定后，以当前值为参照：关键指标回退超过 10% 且没有说明时阻断；绝对预算由三端实测数据在实施计划的性能批次中确定。

优先优化顺序：

1. 路由级动态 import，避免启动时加载未使用 feature。
2. 去除确认过的重复计算和重复解析。
3. 缩小首屏状态和 DOM 工作量。
4. 有真实证据后再考虑更激进的 chunk、worker 或缓存策略。

禁止仅以文件行数、chunk 数或压缩后字节数作为性能结论。

## 10. 迁移批次

每批次一个独立提交或小型 PR，均可单独回滚。

### 批次 0：隔离与正确性修复

- 在独立 worktree 进行后续工作。
- 先修复未提交 Quant Lab 进程事件串扰，并增加并发归属测试。
- 不抽象 runner，不移动 UI，不改变构建方式。

验收：foreign process event 不进入 controller，不触发 cancel；现有 Quant 门禁通过。
回滚点：只包含进程归属修复和测试的提交。

### 批次 1：补齐现有门禁

- 所有 App 递归语法检查。
- Quant 真实 DOM smoke 纳入 CI。
- Job Hunt 增加 Host stub 启动 smoke。
- 记录现有三端可测性能基线。

验收：在没有产品代码移动的情况下稳定通过。
回滚点：纯测试与 CI 提交。

### 批次 2：Starter 构建 spike

- 在 `templates/starter` 验证 `sources/starter -> apps/starter`、source map、静态资源、原生 Node tool 复制、确定构建和安装闭包。
- 使用 Vite 建立唯一的浏览器构建工具链；Node tool 本轮不转译。
- 定义 `panel-sdk` 的最小 capability 类型，不实现完整业务能力。

验收：从源码构建出的 Starter 能作为独立子目录安装，安装时不需要 Node 或依赖目录。
回滚点：Starter 与构建工具提交，不影响现有 App。

### 批次 3：Host capability seam

- 实现 Desktop/Web/Mobile adapter contract suite。
- 先迁移 storage、system 和 files，再迁移 tools 和 process。
- 不迁移任何大 feature，不重写 UI。

验收：同一 fixture 在三端 adapter 下得到一致领域结果；unavailable 路径可观察。
回滚点：每个 capability 独立提交。

### 批次 4：Quant ProcessClient

- 抽取 owner、output bound、timeout、cancel、late event 和 dispose。
- 每次只迁移一个 controller。
- 参数构造、结果 parser、进度文案留在 feature。

验收：四个 controller 的并发和释放 contract tests 通过，UI 行为不变。
回滚点：每个 controller 可退回其本地实现。

### 批次 5：Validator 分片

- `scripts/validate.mjs` 只保留编排。
- 通用 package 规则、各 App validator、browser smoke 分离。
- 同时消除对 `app.js` 固定文件位置的扫描假设。

验收：迁移前后成功/失败 fixture、退出码和断言集合等价；新增模块化 fixture 能被正确扫描。
回滚点：每个 App validator 独立迁移。

### 批次 6：按 Feature 迁移 App

推荐顺序：Starter → Design Studio 的一个低耦合 feature → Quant 的已测 controller → Job Hunt 纵向切片。Video Download 等当前未提交功能稳定后再进入。

Job Hunt 先提取纯函数簇、输入 normalization 和 prompt builder；不先重写全局 state、renderer 或全部 Tool 注册。

验收：每个 feature 迁移前后 fixture、smoke 和视觉行为一致。
回滚点：一 feature 一提交。

### 批次 7：CSP 与性能优化

- 逐 App 收紧 CSP，并用真实浏览器检查 violation。
- 根据性能基线引入路由级动态 import 和有证据的计算优化。
- 不以重构名义同时修改产品交互。

验收：三端 smoke 无 CSP violation，性能阈值不回退。
回滚点：每个 App 的 CSP 和每项性能优化分别提交。

## 11. 明确不做

- 不全面重写任一 Panel。
- 不引入 React、Vue 或新的状态管理框架。
- 不复制 DeepSeek Harness 的 Cordis 插件内核。
- 不建立跨 Panel 的安装后共享运行时。
- 不创建宽泛的 `utils.ts`、`format.ts` 或 service locator。
- 不在安装阶段执行第三方构建脚本。
- 不在没有实测数据时为“性能”合并语义不同的函数。
- 不把当前未提交 Quant Lab 功能和构建迁移压进同一个提交。

## 12. DeepSeek Harness 参照

参考资料：

- DeepSeek Harness Developer Preview：https://deepseek.com/harness/en/
- 官方仓库：https://github.com/deepseek-ai/deepseek-harness
- 官方架构文档：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md

借鉴：

- 能力由稳定接口、Provider 和 Consumer 构成。
- 不同运行模式通过组合选择能力。
- source plane 与 artifact plane 分离。
- 生命周期注册必须可释放。

不借鉴：

- Everything-is-a-plugin 的全量范围。
- Profile/Bundle/Patch 配置树。
- 面向完整 Agent Runtime 的事件内核和服务容器。

Panel App 的目标是小型、可移植、可独立安装的产品界面；其能力模型应当比 Harness 明显更窄。

## 13. 完成标准

设计完成后的实现必须同时满足：

1. 同一 Panel 业务代码可由 Desktop、Web、Mobile adapter 运行。
2. 不支持的宿主能力具有显式、可测试的降级行为。
3. 每个 App 的 `app/` 是可审计、自包含、可离线安装的静态产物。
4. 安装器不执行构建脚本。
5. 进程事件具有严格 owner 隔离和确定释放。
6. Job Hunt、Quant 和 validator 可按 feature/App 渐进拆分，不需要一次性重写。
7. 源码与提交产物漂移、越界 import、缺失入口和未覆盖 adapter 会被 CI 阻断。
8. 性能优化有三端基线和前后证据。
