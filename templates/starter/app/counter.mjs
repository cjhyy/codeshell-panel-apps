// Keep domain behavior usable by both the webview and the installed Node CLI.
export function incrementCount(value, amount = 1) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !Number.isSafeInteger(value + amount)
  ) {
    throw Object.assign(new Error("value and amount must be nonnegative safe integers"), {
      code: "INVALID_ARGUMENT",
    });
  }
  return value + amount;
}
