function normalizedVersion(value) {
  const match = /^v?(\d{4})\.(\d{1,2})\.(\d{1,2})(?:\.([0-9]+))?(?:[-+][0-9A-Za-z.-]+)?$/.exec(
    String(value || "").trim(),
  );
  if (!match) return null;
  return {
    text: [match[1], match[2].padStart(2, "0"), match[3].padStart(2, "0"), match[4]]
      .filter(Boolean)
      .join("."),
    parts: match.slice(1, 5).map((part) => Number(part || 0)),
  };
}

export function parseYtDlpVersionOutput(output) {
  for (const line of String(output || "").split(/\r?\n/)) {
    const parsed = normalizedVersion(line);
    if (parsed) return parsed.text;
  }
  return null;
}

export function parseGitHubLatestRelease(output) {
  let payload;
  try {
    payload = JSON.parse(String(output || ""));
  } catch {
    return null;
  }
  return normalizedVersion(payload?.tag_name)?.text || null;
}

export function compareYtDlpVersions(installed, latest) {
  const left = normalizedVersion(installed);
  const right = normalizedVersion(latest);
  if (!left || !right) return null;
  for (let index = 0; index < Math.max(left.parts.length, right.parts.length); index += 1) {
    const difference = (left.parts[index] || 0) - (right.parts[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export function shouldOfferSetup({
  dependenciesChecked,
  hasYtDlp,
  hasFfmpeg,
  installedYtDlpVersion,
  latestYtDlpVersion,
}) {
  if (!dependenciesChecked) return false;
  return (
    !hasYtDlp ||
    !hasFfmpeg ||
    compareYtDlpVersions(installedYtDlpVersion, latestYtDlpVersion) === -1
  );
}
