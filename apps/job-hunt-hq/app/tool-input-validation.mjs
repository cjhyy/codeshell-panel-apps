// Both entry points use the manifest as their input contract. This implements
// the bounded JSON Schema subset used by this Panel, without a Host dependency.
export function validatePanelToolInput(schema, value, path = "input") {
  const fail = message => { throw new Error(`${path}: ${message}`); };
  const matches = child => { try { validatePanelToolInput(child, value, path); return true; } catch { return false; } };
  if (schema.anyOf && !schema.anyOf.some(matches)) fail("does not match any allowed shape");
  if (schema.oneOf && schema.oneOf.filter(matches).length !== 1) fail("must match exactly one allowed shape");
  if (schema.not && matches(schema.not)) fail("contains an excluded combination");
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) fail("invalid enum value");
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const isType = type => type === "null" ? value === null : type === "array" ? Array.isArray(value)
    : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
      : type === "integer" ? Number.isInteger(value) : type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === type;
  if (types.length && !types.some(isType)) fail(`expected ${types.join(" or ")}`);
  if (typeof value === "string") {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) fail("string is too short");
    if (schema.maxLength !== undefined && length > schema.maxLength) fail("string is too long");
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) fail("string does not match pattern");
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail("number is too small");
    if (schema.maximum !== undefined && value > schema.maximum) fail("number is too large");
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail("array is too short");
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail("array is too long");
    if (schema.items) value.forEach((item, index) => validatePanelToolInput(schema.items, item, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties || {}, key)) validatePanelToolInput(schema.properties[key], item, `${path}.${key}`);
      else if (schema.additionalProperties === false) fail(`unknown field ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validatePanelToolInput(schema.additionalProperties, item, `${path}.${key}`);
    }
  }
  return value;
}
