// Bounded retries are persisted with the source evidence, so process restarts
// neither lose transient failures nor reset an exhausted automatic budget.
export const SOURCE_RETRY_MAX_ATTEMPTS = 3;

const PERMANENT = /(?:_INVALID|_UNSAFE|_TOO_LARGE|_OPTION|_BASIS|_SHORT|SYMBOL_MISMATCH|DIRECTORY_INVALID|UNSUPPORTED)$/u;
const THROTTLE = /(?:429|456|403|RATE.?LIMIT|THROTTL|TOO_MANY_REQUESTS)/iu;

export function sourceRetryErrorCode(error) {
  const code = String(error?.code ?? error?.errorCode ?? error?.reason ?? "SOURCE_ERROR").slice(0, 100);
  const status = Number(error?.status ?? String(error?.message ?? "").match(/\bHTTP\s+(\d{3})\b/iu)?.[1]);
  return /_HTTP$/u.test(code) && Number.isInteger(status) && status >= 100 && status <= 599
    ? `${code}_${status}` : code;
}

export function sourceRetryThrottled(error) {
  return THROTTLE.test(typeof error === "string" ? error : sourceRetryErrorCode(error));
}

function retryDelay(code, attempt) {
  if (THROTTLE.test(code)) return attempt === 1 ? 15 * 60_000 : 30 * 60_000;
  if (/HISTORY_DATE_STALE/u.test(code)) return attempt === 1 ? 5 * 60_000 : 15 * 60_000;
  return attempt === 1 ? 30_000 : 120_000;
}

export function retryAfterFailure(error, previousRetry = null, nowMs = Date.now()) {
  const code = sourceRetryErrorCode(error);
  const previousAttempts = Number.isInteger(previousRetry?.attempts) ? previousRetry.attempts : 0;
  const attempts = Math.min(SOURCE_RETRY_MAX_ATTEMPTS, Math.max(0, previousAttempts) + 1);
  const retryable = !PERMANENT.test(code);
  const exhausted = !retryable || attempts >= SOURCE_RETRY_MAX_ATTEMPTS;
  return {
    attempts, retryable, exhausted,
    firstAttemptAt: previousRetry?.firstAttemptAt ?? new Date(nowMs).toISOString(),
    lastAttemptAt: new Date(nowMs).toISOString(),
    nextRetryAt: exhausted ? null : new Date(nowMs + retryDelay(code, attempts)).toISOString(),
  };
}

export function restoreSourceRetry(record, nowMs = Date.now()) {
  const retry = record?.retry;
  if (retry && Number.isInteger(retry.attempts) && retry.attempts >= 1 && retry.attempts <= SOURCE_RETRY_MAX_ATTEMPTS &&
      typeof retry.retryable === "boolean" && typeof retry.exhausted === "boolean" &&
      Number.isFinite(Date.parse(retry.firstAttemptAt)) && Number.isFinite(Date.parse(retry.lastAttemptAt)) &&
      (retry.nextRetryAt === null || Number.isFinite(Date.parse(retry.nextRetryAt)))) {
    const exhausted = !retry.retryable || retry.attempts >= SOURCE_RETRY_MAX_ATTEMPTS || retry.exhausted;
    return { ...retry, exhausted, nextRetryAt: exhausted ? null : retry.nextRetryAt ?? new Date(nowMs).toISOString() };
  }
  // Legacy files recorded a failed flag/reason but had no retry metadata.
  const savedTime = Date.parse(record?.updatedAt ?? record?.generatedAt);
  const savedCode = record?.reason ?? record?.code ?? "SOURCE_ERROR";
  // The old validator combined stale dates and malformed bars. Fetch once more
  // to classify the evidence; it still passes through today's strict validator.
  const migrated = retryAfterFailure({ code: savedCode === "HISTORY_DATE_OR_BARS_INVALID" ? "HISTORY_DATE_STALE" : savedCode,
    status: record?.statusCode, message: record?.message },
    null, Number.isFinite(savedTime) ? Math.min(savedTime, nowMs) : nowMs);
  if (!Number.isFinite(savedTime) && !migrated.exhausted) migrated.nextRetryAt = new Date(nowMs).toISOString();
  return migrated;
}

export function sourceRetryPending(retry) {
  return Boolean(retry?.retryable && !retry.exhausted);
}

export function sourceRetryDue(retry, nowMs = Date.now()) {
  return sourceRetryPending(retry) && (retry.nextRetryAt === null || Date.parse(retry.nextRetryAt) <= nowMs);
}
