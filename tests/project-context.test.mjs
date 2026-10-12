import assert from "node:assert/strict";
import test from "node:test";
import { projectContextChanged, projectContextKey, projectIdentity } from "../shared/project-context.mjs";

const projectScope = { version: 1, environmentId: "host-A", projectId: "project-A", rootId: "root-A" };
const context = { cwd: "/workspace", sessionId: "chat-A", host: "web", appId: "panel-A", projectScope };

test("execution identity detects same-path, same-session changes to every Host proof field", () => {
  for (const field of ["environmentId", "projectId", "rootId"])
    assert.equal(projectContextChanged(context, { ...context, projectScope: { ...projectScope, [field]: field + "-B" } }), true, field);
  for (const field of ["cwd", "sessionId", "host", "appId"])
    assert.equal(projectContextChanged(context, { ...context, [field]: field + "-B" }), true, field);
  assert.equal(projectContextChanged(context, { ...context, busy: true, theme: "dark", visible: false }), false);
  assert.equal(projectContextChanged(context, { ...context, projectScope: { rootId: "root-A", projectId: "project-A", environmentId: "host-A", version: 1 } }), false);
});

test("complete context losing a project proof or a session clears the old binding", () => {
  for (const value of [null, undefined, {}, { ...projectScope, rootId: "" }, { ...projectScope, version: 2 }])
    assert.equal(projectContextChanged(context, { ...context, projectScope: value }), true);
  const { sessionId, ...withoutSession } = context;
  assert.equal(projectContextChanged(context, withoutSession), true);
});

test("legacy contexts keep the existing draft key and never infer identity from old top-level IDs", () => {
  const legacy = { cwd: "/workspace", sessionId: "chat-A", projectId: "old-ID" };
  assert.equal(projectContextKey(legacy), JSON.stringify(["/workspace", "chat-A"]));
  assert.equal(projectContextChanged(legacy, { ...legacy, projectId: "different" }), false);
  assert.equal(projectContextKey(null), JSON.stringify([null, null]));
});

test("only complete bounded version-one proof is accepted", () => {
  for (const scope of [null, [], {}, { ...projectScope, version: 2 }, ...["", " ", "a".repeat(257), "a\u0000", "a\u007f", 4].map(rootId => ({ ...projectScope, rootId }))])
    assert.equal(projectIdentity(scope), null);
  assert.equal(projectIdentity(projectScope), JSON.stringify([1, "host-A", "project-A", "root-A"]));
});
