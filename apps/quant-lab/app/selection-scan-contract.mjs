// Safety bounds protect payload size; recommendation count is a separate
// market-dependent presentation policy. These bounds must never silently
// truncate the provider's industry directory or constituent pages.
export const SELECTION_SCAN_LIMITS = Object.freeze({
  sectors: 256,
  stocks: 6_500,
  membersPerSector: 2_000,
  watchedSectors: 12,
  watchedStocks: 100,
  sectorBatchSize: 8,
  historyNetworkBatchSize: 24,
  announcementBatchSize: 20,
  networkConcurrency: 3,
});
