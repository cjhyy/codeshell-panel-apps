import assert from "node:assert/strict";

const maxHostSchemaPatternLength = 512;
const maxHostPatternInputLength = 10_000;

// Keep Panel App manifests inside CodeShell's fail-closed regular-expression
// subset. JavaScript can compile a much wider set of patterns than the Host
// intentionally accepts, so package validation must catch this before install.
export function isHostSafeSchemaPattern(pattern) {
  if (typeof pattern !== "string" || pattern.length > maxHostSchemaPatternLength) return false;
  let escaped = false;
  let inCharacterClass = false;
  let variableQuantifiers = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (escaped) {
      if (!inCharacterClass && /[1-9k]/u.test(character)) return false;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[" && !inCharacterClass) {
      inCharacterClass = true;
      continue;
    }
    if (character === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (!inCharacterClass && ["(", ")", "|", "."].includes(character)) return false;
    if (!inCharacterClass && ["*", "+", "?"].includes(character)) {
      variableQuantifiers += 1;
      continue;
    }
    if (!inCharacterClass && character === "{") {
      const closingBrace = pattern.indexOf("}", index + 1);
      if (closingBrace < 0) return false;
      const body = pattern.slice(index + 1, closingBrace);
      const match = /^(\d+)(?:,(\d+))?$/u.exec(body);
      if (!match) return false;
      const minimum = Number(match[1]);
      const maximum = match[2] === undefined ? minimum : Number(match[2]);
      if (
        !Number.isSafeInteger(minimum) ||
        !Number.isSafeInteger(maximum) ||
        minimum > maximum ||
        maximum > maxHostPatternInputLength
      ) {
        return false;
      }
      if (minimum !== maximum) variableQuantifiers += 1;
      index = closingBrace;
      continue;
    }
    if (!inCharacterClass && character === "}") return false;
  }
  if (escaped || inCharacterClass || variableQuantifiers > 1) return false;
  try {
    new RegExp(pattern, "u");
    return true;
  } catch {
    return false;
  }
}

export function assertHostSafeSchemaPatterns(schema, packagePath, toolName, path = "arguments") {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    schema.forEach((value, index) =>
      assertHostSafeSchemaPatterns(value, packagePath, toolName, `${path}[${index}]`),
    );
    return;
  }
  if (Object.prototype.hasOwnProperty.call(schema, "pattern")) {
    assert(
      isHostSafeSchemaPattern(schema.pattern),
      `${packagePath}: ${toolName} has a Host-incompatible JSON Schema pattern at ${path}`,
    );
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key === "pattern") continue;
    assertHostSafeSchemaPatterns(value, packagePath, toolName, `${path}.${key}`);
  }
}
