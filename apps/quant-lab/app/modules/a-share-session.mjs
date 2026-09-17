function validInstant(value) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error("A 股交易时钟无效");
  return instant;
}

export function chinaMarketClock(nowInput = new Date()) {
  const now = validInstant(nowInput);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  const weekday = !["Sat", "Sun"].includes(values.weekday);
  return Object.freeze({
    date: `${values.year}-${values.month}-${values.day}`,
    minutes,
    seconds: Number(values.second),
    weekday,
    open: weekday && ((minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60)),
    settling: weekday && minutes > 15 * 60 && minutes < 15 * 60 + 10,
  });
}

export function displayedAShareSessionPhase(snapshot, nowInput = new Date()) {
  const phase = snapshot?.session?.phase;
  const clock = chinaMarketClock(nowInput);
  if (typeof snapshot?.marketDate === "string" && clock.date !== snapshot.marketDate) return "previous-close";
  if (phase !== "intraday") return phase;
  if (clock.date !== snapshot?.marketDate || !clock.weekday || clock.minutes <= 15 * 60) return phase;
  return clock.minutes < 15 * 60 + 10 ? "settling" : "close-pending";
}

export function nextAShareCloseProbeAt(nowInput = new Date(), { hour = 15, minute = 12 } = {}) {
  const now = validInstant(nowInput);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error("A 股盘后探测时间无效");
  }
  const { date } = chinaMarketClock(now);
  const [year, month, day] = date.split("-").map(Number);
  for (let offset = 0; offset <= 8; offset += 1) {
    // Asia/Shanghai has a fixed UTC+8 offset and no daylight-saving time.
    const calendarDay = new Date(Date.UTC(year, month - 1, day + offset, 12));
    const target = new Date(Date.UTC(year, month - 1, day + offset, hour - 8, minute));
    const weekday = calendarDay.getUTCDay();
    if (weekday === 0 || weekday === 6 || target.getTime() <= now.getTime()) continue;
    return target;
  }
  throw new Error("无法计算下一次 A 股盘后探测时间");
}

export function aShareCloseProbeRetryMs(snapshot, nowInput = new Date(), networkVerified = true) {
  const clock = chinaMarketClock(nowInput);
  const insideRetryWindow = clock.weekday && clock.minutes >= 15 * 60 + 12 && clock.minutes < 17 * 60;
  if (!insideRetryWindow) return null;
  if (!networkVerified) return 15 * 60 * 1_000;
  return snapshot?.marketDate === clock.date && snapshot?.session?.provisional === true
    ? 15 * 60 * 1_000
    : null;
}
