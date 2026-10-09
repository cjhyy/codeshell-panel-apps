// Modern method discovery is authoritative. API versions are only a fallback
// for older desktop Hosts that did not publish either methods or bridge limits.
const legacyMethods = {
  "external.open": [1, "external.open"],
  "workspace.list": [1, "workspace.read"],
  "workspace.readText": [1, "workspace.read"],
  "workspace.openPath": [9, "workspace.read"],
  "workspace.revealPath": [9, "workspace.read"],
  "workspace.exportPdf": [3, "workspace.write"],
  "credentials.cookies.list": [4, "credentials.cookies"],
  "credentials.cookies.loginAndSave": [4, "credentials.cookies"],
  "credentials.cookies.restore": [4, "credentials.cookies"],
  ...Object.fromEntries(["list", "create", "update", "pause", "resume", "delete", "runNow"]
    .map(action => [`automations.${action}`, [5, "automations.manage"]])),
  ...Object.fromEntries(["createUnique", "updateIfRevision", "deleteIfRevision"]
    .map(action => [`automations.${action}`, [Infinity, "automations.manage"]])),
};

export function supportsHostMethod(context, method) {
  const legacy = legacyMethods[method];
  const permission = legacy?.[1];
  if (Array.isArray(context?.permissions) && permission && !context.permissions.includes(permission))
    return false;
  if (Array.isArray(context?.availableMethods)) return context.availableMethods.includes(method);
  // A modern bridge with incomplete discovery must not guess desktop methods.
  if (context?.capabilities?.bridge || context?.host === "hub" || context?.host === "web") return false;
  return Boolean(legacy && Number(context?.apiVersion || 0) >= legacy[0]);
}

export function resumeFileAction(context, path, action) {
  const method = action === "reveal" ? "workspace.revealPath" : "workspace.openPath";
  if (supportsHostMethod(context, method)) return { kind: "native", method };
  if (action === "reveal" && supportsHostMethod(context, "workspace.list")) return { kind: "browse" };
  if (/\.md$/i.test(path) && supportsHostMethod(context, "workspace.readText")) return { kind: "download" };
  return { kind: "unavailable" };
}
