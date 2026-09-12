import assert from "node:assert/strict";
import { isHostSafeSchemaPattern } from "../../scripts/validation/schema-pattern.mjs";
import { isDirectRun } from "../helpers/direct-run.mjs";

export function runSchemaPatternTests() {
assert.equal(isHostSafeSchemaPattern("^[a-z][a-z0-9-]{0,63}$"), true);
assert.equal(isHostSafeSchemaPattern("^(a+)+$"), false);
assert.equal(isHostSafeSchemaPattern("^a+a+$"), false);
assert.equal(isHostSafeSchemaPattern("^(?:md|mdx|txt)$"), false);
}

if (isDirectRun(import.meta.url)) runSchemaPatternTests();
