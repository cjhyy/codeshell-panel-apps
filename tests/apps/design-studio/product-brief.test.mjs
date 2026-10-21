import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { parseProductBrief, productBriefPrompt } from "../../../apps/design-studio/app/product-brief.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { plainFixture } from "./fixtures/figma-plugin-v3.mjs";

const fixture = await readFile(
  new URL("../../fixtures/design-studio-product-brief/checkout.md", import.meta.url),
  "utf8",
);
const requirements = (items) => `# Product\n\n## Requirements\n${items.map((item) => `- ${item}`).join("\n")}\n`;
const explicitIds = ["req-sign-in", "req-orders-view"];

test("authored requirement IDs survive insertion, reorder, translation and priority edits", () => {
  const original = parseProductBrief(fixture, { path: "docs/PRD.md" });
  assert.deepEqual(original.requirements.map((item) => item.id), [
    ...explicitIds,
    "req-03-p2-remember-the-last-route",
  ]);
  const changed = parseProductBrief(requirements([
    "P1 A new unrelated requirement",
    "[id:req-orders-view] P0 Display order details acceptance: Keep the order number.",
    "[id:req-sign-in] P2 使用邮箱登录 验收：进入首页。",
  ]));
  assert.deepEqual(changed.requirements.slice(1).map((item) => item.id), [...explicitIds].reverse());
  assert.equal(changed.requirements[1].priority, "P0");
  assert.equal(changed.requirements[2].priority, "P2");
  assert.equal(changed.requirements[2].statement, "使用邮箱登录");
  assert.deepEqual(changed.requirements[2].acceptanceCriteria, ["进入首页。"]);
  assert.deepEqual(original.requirements[0].acceptanceCriteria, ["A valid account reaches Home."]);
  assert.deepEqual(original.requirements[1].acceptanceCriteria, ["展示订单编号。"]);
});

test("exact authored IDs are independent of Unicode headings, list numbering and newline style", () => {
  for (const heading of ["Requirements", "需求", "功能范围"]) {
    const brief = parseProductBrief(`# 产品\r\n## ${heading}\r\n1. [ID:req-sign-in] [P0] 邮箱登录\r\n2. [id:req-orders-view] 查看订单\r\n`);
    assert.deepEqual(brief.requirements.map((item) => item.id), explicitIds);
    assert.equal(brief.requirements[0].statement, "邮箱登录");
    assert.equal(brief.requirements[0].priority, "P0");
  }
  const maximum = `r${"x".repeat(63)}`;
  assert.equal(parseProductBrief(requirements([`[id:${maximum}] A statement`])).requirements[0].id, maximum);
});

test("authored IDs retain exact bytes under English, Chinese and Turkish process locales", () => {
  const moduleUrl = new URL("../../../apps/design-studio/app/product-brief.mjs", import.meta.url).href;
  const program = `import { parseProductBrief } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(parseProductBrief(process.argv[1]).requirements.map(item => item.id)));`;
  for (const locale of ["en_US.UTF-8", "zh_CN.UTF-8", "tr_TR.UTF-8"]) {
    const source = requirements(["[id:req-sign-in] P0 Invite İpek", "[id:req-orders-view] 查看订单"]);
    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", program, source], {
      encoding: "utf8",
      env: { ...process.env, LANG: locale, LC_ALL: locale },
    });
    assert.deepEqual(JSON.parse(output), explicitIds, locale);
  }
});

test("brief prompts and saved canonical notes keep references to the same authored requirements", () => {
  const brief = parseProductBrief(fixture, { path: "docs/PRD.md" });
  const prompt = productBriefPrompt(brief, { designPath: "designs/checkout.codesign.json" });
  for (const id of explicitIds) assert.match(prompt, new RegExp(`${id} \\[P[0-3]\\]`, "u"));
  assert.doesNotMatch(prompt, /\[id:/u, "declaration syntax is not duplicated into the requirement statement");
  const document = plainFixture();
  const notes = `PRD docs/PRD.md: ${brief.requirements.slice(0, 2).map((item) => item.id).join(", ")}`;
  document.pages[0].children[0].notes = notes;
  const saved = serializeDesignDocument(normalizeDesignDocument(document));
  const reopened = normalizeDesignDocument(JSON.parse(saved));
  assert.equal(reopened.pages[0].nodes[0].notes, notes);
  const transfer = createFigmaTransfer(reopened);
  assert.equal(transfer.pages[0].children[0].notes, notes);
  const reordered = parseProductBrief(requirements([
    "[id:req-orders-view] 修改订单页面的描述",
    "A new requirement",
    "[id:req-sign-in] Modify sign-in copy",
  ]));
  const available = new Set(reordered.requirements.map((item) => item.id));
  assert.ok(explicitIds.every((id) => available.has(id)), "existing notes references still resolve after PRD edits");
});

test("legacy positional IDs retain their exact existing bytes and documented reorder limitation", () => {
  const brief = parseProductBrief(requirements([
    "P0 Sign in with email acceptance: Reach Home.",
    "P1 查看订单详情",
    "搜索订单",
  ]));
  assert.deepEqual(brief.requirements, [
    { id: "req-01-p0-sign-in-with-email", priority: "P0", statement: "Sign in with email", acceptanceCriteria: ["Reach Home."] },
    { id: "req-02-p1", priority: "P1", statement: "查看订单详情", acceptanceCriteria: [] },
    { id: "req-03-item", priority: "P1", statement: "搜索订单", acceptanceCriteria: [] },
  ]);
  const changed = parseProductBrief(requirements(["A new requirement", "P0 Sign in with email"]));
  assert.equal(changed.requirements[1].id, "req-02-p0-sign-in-with-email");
  assert.notEqual(changed.requirements[1].id, brief.requirements[0].id);
});

test("an author can explicitly retain an old reference without rewriting saved notes", () => {
  const old = parseProductBrief(requirements(["P0 Sign in with email"])).requirements[0];
  const notes = `docs/PRD.md: ${old.id}`;
  const changed = parseProductBrief(requirements([
    "An unrelated new item",
    `[id:${old.id}] P0 更新登录说明`,
  ]));
  assert.equal(changed.requirements[1].id, old.id);
  assert.ok(notes.includes(changed.requirements[1].id));
  assert.deepEqual(Object.keys(changed.requirements[1]), ["id", "priority", "statement", "acceptanceCriteria"]);
});

test("invalid or ambiguous authored declarations fail before returning a partial brief", () => {
  for (const item of [
    "[id:] Statement",
    "[id:Req-login] Statement",
    "[id:1login] Statement",
    "[id:req_login] Statement",
    "[id:req.login] Statement",
    "[id:req login] Statement",
    "[id: req-login] Statement",
    "[id:req-login ] Statement",
    "[id:需求] Statement",
    "[id:req-login",
    "[id:req-login]Statement",
    "[id:req-login]",
    "[id:req-login] P0",
    "[id:req-login] [id:req-other] Statement",
    `[id:r${"x".repeat(64)}] Statement`,
  ]) assert.throws(() => parseProductBrief(requirements([item])), /显式需求 ID/u, item);
});

test("authored IDs reject duplicate declarations and collisions with legacy generated IDs", () => {
  for (const items of [
    ["[id:req-login] Sign in", "[id:req-login] 登录"],
    ["[id:req-02-p1-view-orders] Sign in", "P1 View orders"],
    ["P1 View orders", "[id:req-01-p1-view-orders] Sign in"],
    ["[id:req-login] Sign in", ...Array.from({ length: 99 }, (_, i) => `Other ${i}`), "[id:req-login] Outside returned limit"],
  ]) assert.throws(() => parseProductBrief(requirements(items)), /重复|冲突/u);
});

test("the existing no-requirements-section fallback also retains authored IDs", () => {
  const brief = parseProductBrief("# Product\n- [id:req-login] Sign in\n- Legacy task\n");
  assert.deepEqual(brief.requirements.map((item) => item.id), ["req-login", "req-02-legacy-task"]);
  assert.equal(brief.requirements[0].statement, "Sign in");
  assert.throws(() => parseProductBrief("# Product\n- [id:req-login] First\n- [id:req-login] Second\n"), /重复|冲突/u);
});

test("annotated task items retain authored IDs through checkbox toggles and reordering", () => {
  for (const checkbox of ["[ ]", "[x]", "[X]"]) {
    const brief = parseProductBrief(requirements([
      `${checkbox} [id:req-sign-in] P0 Must sign in acceptance: Reach Home.`,
      `${checkbox} [id:req-orders-view] P1 查看订单`,
    ]));
    assert.deepEqual(brief.requirements.map((item) => item.id), explicitIds);
    assert.equal(brief.requirements[0].statement, "Must sign in");
    assert.equal(brief.requirements[0].priority, "P0");
    assert.deepEqual(brief.requirements[0].acceptanceCriteria, ["Reach Home."]);
    const changed = parseProductBrief(requirements([
      "A new item",
      `[X] [id:req-orders-view] 更新订单说明`,
      `[ ] [id:req-sign-in] P2 Change sign-in copy`,
    ]));
    assert.deepEqual(changed.requirements.slice(1).map((item) => item.id), [...explicitIds].reverse());
  }
  const inferred = parseProductBrief("# Tasks\n- [x] [id:req-sign-in] Sign in\n");
  assert.equal(inferred.requirements[0].id, "req-sign-in");
});

test("unannotated task items preserve legacy ID, statement and priority bytes", () => {
  for (const [checkbox, id] of [
    ["[ ]", "req-01-p0-must-sign-in"],
    ["[x]", "req-01-x-p0-must-sign-in"],
    ["[X]", "req-01-x-p0-must-sign-in"],
  ]) {
    assert.deepEqual(parseProductBrief(requirements([
      `${checkbox} P0 Must sign in acceptance: Reach Home.`,
    ])).requirements[0], {
      id,
      priority: "P0",
      statement: `${checkbox} P0 Must sign in`,
      acceptanceCriteria: ["Reach Home."],
    });
  }
});

test("annotated task declarations reject invalid IDs, duplicates and legacy collisions", () => {
  for (const checkbox of ["[ ]", "[x]", "[X]"]) {
    for (const declaration of ["[id:] Text", "[id:Invalid] Text", "[id:req_login] Text", "[id:req-login", "[id:req-login]", "[id:req-login] P0"]) {
      assert.throws(() => parseProductBrief(requirements([`${checkbox} ${declaration}`])), /显式需求 ID/u);
    }
    for (const items of [
      [`${checkbox} [id:req-login] First`, "[id:req-login] Second"],
      ["[id:req-login] First", `${checkbox} [id:req-login] Second`],
      [`${checkbox} [id:req-02-p1-view-orders] First`, "P1 View orders"],
      ["[ ] P0 Must sign in", `${checkbox} [id:req-01-p0-must-sign-in] Second`],
    ]) assert.throws(() => parseProductBrief(requirements(items)), /重复|冲突/u);
  }
});
