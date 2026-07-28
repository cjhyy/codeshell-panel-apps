# CodeShell Panel Apps

Independent desktop Panel Apps for [CodeShell](https://github.com/cjhyy/codeshell).
This repository contains UI applications only. It does not register Skills,
Agents, Commands, Hooks, MCP servers, or other Agent Plugin capabilities.

## Included apps

| App           | Subdirectory         | Purpose                                                                            |
| ------------- | -------------------- | ---------------------------------------------------------------------------------- |
| Design Studio | `apps/design-studio` | Figma-like, repository-native visual design with deterministic JSON and SVG output |
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
  quant-lab/
    .codeshell-panel/panel.json
    app/
templates/
  starter/
scripts/
  validate.mjs
```

Every Panel App is self-contained. Its manifest lives at
`.codeshell-panel/panel.json`; browser assets live under `app/` beside the
declared HTML entry.

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
