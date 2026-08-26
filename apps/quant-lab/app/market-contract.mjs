const DAY_MS = 86_400_000;

function validDate(value, label = "date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  const instant = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a real calendar date`);
  }
  return instant;
}

function addDays(value, days) {
  const instant = validDate(value);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function calendarDays(from, to) {
  return Math.round((validDate(to).getTime() - validDate(from).getTime()) / DAY_MS);
}

function zonedParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function zonedLocalToUtc(date, hour, minute, timeZone) {
  const [year, month, day] = date.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const correction = desired - represented;
    candidate += correction;
    if (correction === 0) return new Date(candidate);
  }
  throw new Error(`cannot resolve ${date} in ${timeZone}`);
}

function checkpointInstant(date) {
  validDate(date, "checkpointDate");
  return new Date(`${date}T08:30:00.000Z`);
}

export function firstEligibleCheckpoint({ market, observationDate }) {
  validDate(observationDate, "observationDate");
  if (market === "cn") return observationDate;
  if (market === "us" || market === "fx") return addDays(observationDate, 1);
  throw new Error(`unsupported market: ${market}`);
}

export function observationAvailableAt({ market, observationDate }) {
  validDate(observationDate, "observationDate");
  if (market === "cn") return `${observationDate}T07:00:00.000Z`;
  if (market === "us") {
    return zonedLocalToUtc(observationDate, 16, 0, "America/New_York").toISOString();
  }
  if (market === "fx") return `${addDays(observationDate, 1)}T00:00:00.000Z`;
  throw new Error(`unsupported market: ${market}`);
}

export function sourceDateFromTimestamp(timestamp, timeZone) {
  if (typeof timestamp !== "string" || typeof timeZone !== "string") {
    throw new Error("timestamp and timeZone must be strings");
  }
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) throw new Error("timestamp must be a valid instant");
  const parts = zonedParts(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function selectObservation(checkpointDate, observations, { market, syncedAt }) {
  const checkpoint = checkpointInstant(checkpointDate);
  if (!Array.isArray(observations)) throw new Error("observations must be an array");
  let selected = null;
  let selectedAvailableAt = null;
  for (const observation of observations) {
    if (!observation || typeof observation !== "object") throw new Error("observation must be an object");
    validDate(observation.date, "observation.date");
    const availableAt = new Date(
      observationAvailableAt({ market, observationDate: observation.date }),
    );
    if (availableAt > checkpoint) continue;
    if (selected == null || availableAt > selectedAvailableAt) {
      selected = observation;
      selectedAvailableAt = availableAt;
    }
  }
  if (!selected) return null;
  const syncedInstant = new Date(syncedAt);
  if (Number.isNaN(syncedInstant.getTime())) throw new Error("syncedAt must be a valid instant");
  return {
    observation: selected,
    ageCalendarDays: calendarDays(selected.date, checkpointDate),
    provisional: syncedInstant < checkpoint,
    availableAt: selectedAvailableAt.toISOString(),
  };
}
