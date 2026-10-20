# Panel App Starter

这是最小可运行的 CodeShell Panel App 模板，适合直接复制到你的 repo 中维护。

## 创建自己的面板

1. 复制整个 `starter` 文件夹。
2. 修改 `.codeshell-panel/panel.json` 中的 `id`、`title`、`version` 和权限。
3. 在 `app/` 中维护 HTML、JavaScript、CSS 和静态资源。
4. 打开 CodeShell 的 **扩展 → Panel Apps → 选择源码文件夹**，选择复制后的目录。
5. 审查权限并安装。安装后，从右侧面板的 `+` 菜单打开它。

也可以将目录推送到公开 GitHub 仓库，然后使用 **从 GitHub**。如果 Panel App
位于 monorepo 中，同时填写分支/标签和面板子目录；CodeShell 会先临时拉取，
再显示同一套权限及文件审查。

开发过程中继续修改原始文件夹。需要加载新版本时，回到 Panel Apps 管理页，
在应用卡片上点击 **从源码更新**，审查变更后应用；不需要再次选择目录。

Schema v2 可以在 `agent.skills` 声明只读的 `agent/skills/<id>/SKILL.md`；
模板已经声明 Runtime Skill。Panel App 包不能包含 Agents、Commands、Hooks、
MCP 或普通 Plugin manifest。完整格式和 Host API 见
[CodeShell Panel App 文档](https://github.com/cjhyy/codeshell/blob/main/docs/panel-apps.md)。

模板先订阅项目上下文，再读取初始状态，避免切换项目时被旧响应覆盖。
工作区路径可悬停查看全文，窄屏不横向溢出；未授权和连接失败分别显示真实状态。
点击计数只演示当前页面交互，关闭后重置，不申请持久存储权限。

## CLI 示例

不打开面板也可以运行安装包里的 Node CLI：

```sh
node /path/to/package/app/tools/starter.mjs ops
node /path/to/package/app/tools/starter.mjs context --project /path/to/project
node /path/to/package/app/tools/starter.mjs counter --input-file request.json
```

`request.json` 示例：`{"value":0,"amount":2}`。CLI 与按钮复用 `app/counter.mjs`，
输出单行 JSON，失败时返回非零退出码。计数不持久化，也不会同步到已打开的面板。
复制模板后，同时更新 manifest ID 和 Runtime Skill 中的 ID、入口及领域操作。
后续添加数据写入时，应定义项目文件协议、原子写与并发冲突处理；不要猜测 Host 私有路径。
