import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDirectRun } from "../../helpers/direct-run.mjs";

// These application assertions were extracted unchanged from scripts/validate.mjs.
export async function runPackageContract({ root, manifest, html, packagePath }) {
    const appScript = await readFile(join(root, "app", "app.js"), "utf8");
    const queriedIds = [...appScript.matchAll(/document\.querySelector\("#([a-z0-9-]+)"\)/g)].map(
      (match) => match[1],
    );
    const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const moduleOrder = ["today", "stock", "holdings", "watch", "research", "news", "notes"];

    assert.equal(manifest.schemaVersion, 2, `${packagePath}: investment research requires schemaVersion 2`);
    assert.equal(manifest.id, "quant-lab", `${packagePath}: installed app id must stay stable`);
    assert.equal(manifest.version, "0.46.1", `${packagePath}: investment desk version mismatch`);
    assert.deepEqual(
      manifest.title,
      { default: "投资工作台", en: "Investment Desk", "zh-CN": "投资工作台" },
      `${packagePath}: investment desk display name mismatch`,
    );
    assert.deepEqual(
      manifest.permissions,
      [
        "context.session",
        "context.workspace",
        "workspace.info",
        "workspace.read",
        "workspace.write",
        "external.open",
        "storage",
        "agent.submitPrompt",
        "agent.task",
        "automations.manage",
        "notifications.send",
        "process",
      ],
      `${packagePath}: M4 permissions must include only the implemented Host surface`,
    );
    assert.deepEqual(manifest.agent.tools.map((tool) => [tool.name, tool.readOnly]), [["get_portfolio_context", true], ["import_portfolio_snapshot", false]]);
    assert.deepEqual(manifest.agent.skills, ["agent/skills/investment-research/SKILL.md", "agent/skills/portfolio-management/SKILL.md", "agent/skills/project-runtime/SKILL.md"]);
    assert.deepEqual(
      [...html.matchAll(/data-module-tab="([a-z]+)"/g)].map((match) => match[1]),
      moduleOrder,
      `${packagePath}: top-level module tabs must keep the product order`,
    );
    assert.deepEqual(
      [...html.matchAll(/<section[^>]+data-module="([a-z]+)"/g)].map((match) => match[1]),
      moduleOrder,
      `${packagePath}: module panels must match the navigation order`,
    );
    assert.equal(
      [...html.matchAll(/<h1\b/g)].length,
      moduleOrder.length,
      `${packagePath}: every module needs exactly one h1`,
    );
    assert.equal(new Set(htmlIds).size, htmlIds.length, `${packagePath}: DOM ids must be unique`);
    for (const id of queriedIds) {
      assert(htmlIds.includes(id), `${packagePath}: missing #${id}`);
    }
    assert.doesNotMatch(
      `${html}\n${appScript}`,
      /不建议使用|考虑买入持有|投入真钱|小仓位试跑/u,
      `${packagePath}: research output must describe evidence, not investment actions`,
    );
  }

if (isDirectRun(import.meta.url)) {
  const { validatePackage } = await import("../../../scripts/validation/package.mjs");
  await runPackageContract(await validatePackage("apps/quant-lab"));
  console.log("✓ quant-lab package contract");
}
