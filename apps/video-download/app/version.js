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

export function parseGitHubRelease(output) {
  let payload;
  try {
    payload = JSON.parse(String(output || ""));
  } catch {
    return null;
  }
  const tag = typeof payload?.tag_name === "string" ? payload.tag_name.trim() : "";
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/.test(tag)) return null;
  const assets = {};
  for (const raw of Array.isArray(payload?.assets) ? payload.assets : []) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!name || name.length > 255 || name.includes("/") || name.includes("\\")) continue;
    const digest = typeof raw?.digest === "string" ? raw.digest.trim().toLowerCase() : "";
    assets[name] = {
      name,
      sha256: /^sha256:[a-f0-9]{64}$/.test(digest) ? digest.slice("sha256:".length) : "",
    };
  }
  return {
    tag,
    version: normalizedVersion(tag)?.text || null,
    assets,
  };
}

export function parseGitHubLatestRelease(output) {
  return parseGitHubRelease(output)?.version || null;
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
