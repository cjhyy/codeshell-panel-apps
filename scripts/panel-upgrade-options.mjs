export const upgradeAppIds = Object.freeze([
  "design-studio", "job-hunt-hq", "quant-lab", "video-download", "video-studio", "starter-panel",
]);

export const upgradeUsage = "Usage: node scripts/check-panel-host-upgrade.mjs <built-server-package-directory> [report.json] [--app <app-id>]";

export function parseUpgradeOptions(args) {
  const [serverRoot, ...rest] = args;
  if (!serverRoot || serverRoot.startsWith("--")) throw Error(upgradeUsage);
  let reportPath;
  let appId;
  if (rest[0] && rest[0] !== "--app") reportPath = rest.shift();
  if (rest.length) {
    if (rest.length !== 2 || rest[0] !== "--app" || !upgradeAppIds.includes(rest[1]))
      throw Error(`${upgradeUsage}\nSupported app IDs: ${upgradeAppIds.join(", ")}`);
    appId = rest[1];
  }
  if (reportPath?.startsWith("--")) throw Error(upgradeUsage);
  return { serverRoot, reportPath, appId };
}
