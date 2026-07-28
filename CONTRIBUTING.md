# Contributing

## Add a Panel App

1. Copy `templates/starter` into `apps/<app-id>`.
2. Update `.codeshell-panel/panel.json`.
3. Keep all executable and renderable assets under `app/`. Schema-v2 apps may
   place manifest-declared read-only Skills under `agent/skills/`.
4. Run `node scripts/validate.mjs`.
5. Install the directory in CodeShell and review every requested Host
   permission before testing it.

App IDs use lowercase letters, digits, and hyphens. The manifest entry must be
a relative HTML path below `app/`.

## System boundary

This repository is exclusively for Desktop Panel Apps. Packages must not
contain Agent Plugin manifests or general capability directories such as:

- `.claude-plugin`
- `.codex-plugin`
- `.codeshell-plugin`
- `.mcp.json`
- `agents`
- `commands`
- `hooks`
- package-root `skills`

Schema v2 may declare structured tools implemented by the sandboxed panel and
Skills at `agent/skills/<id>/SKILL.md`. Agents, Commands, Hooks, MCP servers,
and executable backend code still belong in a separate Agent Plugin.

## Pull requests

Explain the user-visible behavior, list requested Host permissions, and include
the output of `node scripts/validate.mjs`. Quantitative features should document
their assumptions and avoid performance claims.
