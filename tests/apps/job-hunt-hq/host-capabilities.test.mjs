import test from "node:test";
import assert from "node:assert/strict";
import { supportsHostMethod, resumeFileAction } from "../../../apps/job-hunt-hq/app/host-capabilities.mjs";

test("explicit method discovery overrides old and new API versions", () => {
  assert.equal(supportsHostMethod({ apiVersion: 0, availableMethods: ["automations.list"] }, "automations.list"), true);
  assert.equal(supportsHostMethod({ apiVersion: 99, availableMethods: [] }, "credentials.cookies.loginAndSave"), false);
});
test("a modern bridge and web host never guess desktop-only methods", () => {
  for (const context of [{ capabilities: { bridge: { structuredErrors: true } } }, { host: "hub" }, { host: "web" }])
    assert.equal(supportsHostMethod({ ...context, apiVersion: 99 }, "workspace.openPath"), false);
});
test("explicit permission denial takes precedence over advertised methods", () => {
  assert.equal(supportsHostMethod({ permissions: [], availableMethods: ["automations.create"] }, "automations.create"), false);
  assert.equal(supportsHostMethod({ permissions: ["automations.manage"], availableMethods: ["automations.create"] }, "automations.create"), true);
});
test("legacy desktop methods retain their historical minimum versions", () => {
  assert.equal(supportsHostMethod({ apiVersion: 4 }, "credentials.cookies.restore"), true);
  assert.equal(supportsHostMethod({ apiVersion: 4 }, "automations.create"), false);
  assert.equal(supportsHostMethod({ apiVersion: 5 }, "automations.create"), true);
  assert.equal(supportsHostMethod({ apiVersion: 8 }, "workspace.openPath"), false);
  assert.equal(supportsHostMethod({ apiVersion: 9 }, "workspace.openPath"), true);
  assert.equal(supportsHostMethod({ apiVersion: 99 }, "unknown.method"), false);
});
test("file actions use desktop open or browser download and directory listing", () => {
  assert.deepEqual(resumeFileAction({ apiVersion: 9 }, "resume.md", "open"), { kind: "native", method: "workspace.openPath" });
  const web = { apiVersion: 14, availableMethods: ["workspace.readText", "workspace.list"] };
  assert.deepEqual(resumeFileAction(web, "resume.md", "open"), { kind: "download" });
  assert.deepEqual(resumeFileAction(web, "resume.md", "reveal"), { kind: "browse" });
  assert.deepEqual(resumeFileAction(web, "resume.pdf", "open"), { kind: "unavailable" });
  assert.deepEqual(resumeFileAction({ ...web, permissions: [] }, "resume.md", "open"), { kind: "unavailable" });
});
