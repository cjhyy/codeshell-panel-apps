import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupAuditIssues,
  pageAuditIssues,
} from "../../../apps/design-studio/app/audit-review.mjs";

const issue = (id, code = "layout.canvas-overflow", severity = "error", blocking = severity === "error") =>
  Object.freeze({ nodeId: `node-${id}`, code, severity, blocking, message: `Issue ${id}` });

test("audit groups retain complete counts, first-seen order and three representative issues", () => {
  const issues = Object.freeze([
    issue(1),
    issue(2, "a11y.text-contrast", "warning"),
    issue(3, "layout.canvas-overflow", "warning", true),
    issue(4, "layout.canvas-overflow", "error", false),
    issue(5),
    issue(6, "a11y.text-contrast", "warning"),
  ]);
  const groups = groupAuditIssues(issues);
  assert.deepEqual(groups, [
    { code: "layout.canvas-overflow", count: 4, blocking: 4, error: 3, warning: 1,
      examples: [issues[0], issues[2], issues[3]] },
    { code: "a11y.text-contrast", count: 2, blocking: 0, error: 0, warning: 2,
      examples: [issues[1], issues[5]] },
  ]);
  assert.equal(groups.reduce((total, group) => total + group.count, 0), issues.length);
  assert.deepEqual(groupAuditIssues([]), []);
});

test("audit filters combine code and severity while treating every error as blocking", () => {
  const issues = [issue(1), issue(2, "contrast", "warning"), issue(3, "contrast", "warning", true),
    issue(4, "contrast", "error", false)];
  assert.deepEqual(pageAuditIssues(issues, { severity: "blocking" }).issues, [issues[0], issues[2], issues[3]]);
  assert.deepEqual(pageAuditIssues(issues, { code: "contrast", severity: "warning" }).issues, [issues[1], issues[2]]);
  assert.deepEqual(pageAuditIssues(issues, { code: "contrast", severity: "error" }).issues, [issues[3]]);
  assert.deepEqual(pageAuditIssues(issues, { code: "contrast", severity: "blocking" }).issues, [issues[2], issues[3]]);
  assert.deepEqual(pageAuditIssues(issues, { code: "" }).issues, issues);
  assert.equal(pageAuditIssues(issues, { code: "missing" }).total, 0);
});

test("paging beyond the former detail cap visits every matching issue once without changing source order", () => {
  const issues = Object.freeze(Array.from({ length: 1321 }, (_, index) =>
    issue(index, index % 3 === 0 ? "contrast" : "overflow", index % 5 === 0 ? "warning" : "error")));
  const expected = issues.filter((item) => item.code === "overflow" && item.severity === "error");
  const received = [];
  let offset = 0;
  do {
    const page = pageAuditIssues(issues, { code: "overflow", severity: "blocking", offset, limit: 400 });
    assert.equal(page.offset, offset);
    assert.equal(page.limit, 400);
    assert.equal(page.total, expected.length);
    assert.ok(page.issues.length <= 400);
    received.push(...page.issues);
    offset = page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(received, expected);
  assert.equal(new Set(received.map((item) => item.nodeId)).size, expected.length);
  assert.deepEqual(pageAuditIssues(issues, { offset: issues.length + 1, limit: 1 }), {
    issues: [], total: issues.length, offset: issues.length + 1, limit: 1, nextOffset: null,
  });
});

test("empty results, defaults and exact final-page boundaries return an explicit end cursor", () => {
  assert.deepEqual(pageAuditIssues([]), { issues: [], total: 0, offset: 0, limit: 50, nextOffset: null });
  const issues = [issue(1), issue(2), issue(3)];
  assert.equal(pageAuditIssues(issues, { limit: 2 }).nextOffset, 2);
  assert.deepEqual(pageAuditIssues(issues, { offset: 2, limit: 1 }), {
    issues: [issues[2]], total: 3, offset: 2, limit: 1, nextOffset: null,
  });
});

test("invalid issue collections and pagination inputs fail explicitly", () => {
  for (const value of [null, {}, [null], [{ code: "code", severity: "info" }],
    [{ code: "", severity: "error" }], [{ code: "code", severity: "error", blocking: "yes" }]]) {
    assert.throws(() => groupAuditIssues(value), TypeError);
    assert.throws(() => pageAuditIssues(value), TypeError);
  }
  for (const value of [null, [], "all"]) assert.throws(() => pageAuditIssues([], value), TypeError);
  for (const value of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "0", null])
    assert.throws(() => pageAuditIssues([], { offset: value }), RangeError);
  for (const value of [0, -1, 401, 1.5, Infinity, NaN, "50", null])
    assert.throws(() => pageAuditIssues([], { limit: value }), RangeError);
  for (const value of ["unknown", "", null, 1])
    assert.throws(() => pageAuditIssues([], { severity: value }), TypeError);
  for (const value of [null, 1, [], {}])
    assert.throws(() => pageAuditIssues([], { code: value }), TypeError);
});
