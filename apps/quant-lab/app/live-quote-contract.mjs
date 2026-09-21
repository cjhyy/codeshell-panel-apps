// Snapshot transport limits, not exchange daily price limits. New listings and
// corporate actions can legitimately exceed ordinary trading-day percentages.
export const LIVE_QUOTE_LIMITS = Object.freeze({
  changePercent: [-100, 100_000],
  gap: [-100, 100_000],
  fromOpen: [-100, 100_000],
  amplitude: [0, 100_000],
  relativeToMedian: [-100_100, 100_100],
  severity: [0, 100_000],
});

export function liveQuoteNumber(value, field, label = field) {
  const range = LIVE_QUOTE_LIMITS[field];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !range ||
    value < range[0] ||
    value > range[1]
  ) {
    throw new Error(`${label}无效`);
  }
  return value;
}
