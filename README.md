# CodeShell Panel Apps

Desktop Panel Apps for [CodeShell](https://github.com/cjhyy/codeshell). A
schema-v2 app may package its sandboxed UI, declared Agent tools, and read-only
Skills behind one reviewed installation. General Agents, Commands, Hooks, MCP
servers, and arbitrary plugin backends remain outside Panel Apps.

## Included apps

| App           | Subdirectory         | Purpose                                                                            |
| ------------- | -------------------- | ---------------------------------------------------------------------------------- |
| Design Studio | `apps/design-studio` | Agent-native, Figma-like repo design with structured tools and v3 JSON/SVG output |
| Quant Lab     | `apps/quant-lab`     | Local-first stock data research, strategy backtesting, and Markdown reports        |
| Starter       | `templates/starter`  | Minimal template for creating another Panel App                                    |

## Install from GitHub

In CodeShell, open **Extensions → Panel Apps → From GitHub**, then enter:

- Repository: `https://github.com/cjhyy/codeshell-panel-apps`
- Branch or tag: `main`
- App subdirectory: `apps/design-studio` or `apps/quant-lab`

You can also paste a complete tree URL and leave the other two fields empty:

- `https://github.com/cjhyy/codeshell-panel-apps/tree/main/apps/design-studio`
- `https://github.com/cjhyy/codeshell-panel-apps/tree/main/apps/quant-lab`

CodeShell clones the source into a temporary directory, validates the package,
shows its Host permissions, and installs an immutable snapshot. After new
commits are pushed, use **Update from source** on the installed app card to
review and apply the new version.

## Repository layout

```text
apps/
  design-studio/
    .codeshell-panel/panel.json
    app/
    agent/skills/
  quant-lab/
    .codeshell-panel/panel.json
    app/
templates/
  starter/
scripts/
  validate.mjs
```

Every Panel App is self-contained. Its manifest lives at
`.codeshell-panel/panel.json`; browser assets live under `app/`. Optional
schema-v2 Skills live at manifest-declared `agent/skills/<id>/SKILL.md` paths,
while tool handlers register through the sandboxed panel bridge.

## Develop

The apps intentionally use browser-native HTML, CSS, and JavaScript, so there is
no dependency installation or bundling step.

```sh
node scripts/validate.mjs
```

For local iteration, clone this repository and use **Choose source folder**.
For remote iteration, push a commit and use **Update from source**.

See [CONTRIBUTING.md](CONTRIBUTING.md) before adding another app.

## Disclaimer

Quant Lab is a research tool, not investment advice. Backtests are simplified
models and do not guarantee real-world execution or returns.

## License

MIT
