import assert from "node:assert/strict";
import test from "node:test";
import { parseUpgradeOptions, upgradeAppIds } from "../scripts/panel-upgrade-options.mjs";

test("upgrade gate defaults to the complete catalog and accepts an explicit report", () => {
  assert.deepEqual(parseUpgradeOptions(["/built/server"]), {
    serverRoot: "/built/server", reportPath: undefined, appId: undefined,
  });
  assert.deepEqual(parseUpgradeOptions(["/built/server", "/new/report.json"]), {
    serverRoot: "/built/server", reportPath: "/new/report.json", appId: undefined,
  });
});

test("targeted upgrade requires one supported explicit app and preserves the report", () => {
  for (const appId of upgradeAppIds) {
    assert.deepEqual(parseUpgradeOptions(["/built/server", "--app", appId]), {
      serverRoot: "/built/server", reportPath: undefined, appId,
    });
    assert.deepEqual(parseUpgradeOptions(["/built/server", "/new/report.json", "--app", appId]), {
      serverRoot: "/built/server", reportPath: "/new/report.json", appId,
    });
  }
  for (const args of [[], ["--app", "starter-panel"], ["server", "--app"],
    ["server", "--app", "unknown"], ["server", "--skip"],
    ["server", "report", "extra"], ["server", "--app", "starter-panel", "--app", "design-studio"]])
    assert.throws(() => parseUpgradeOptions(args), /Usage:/);
});
