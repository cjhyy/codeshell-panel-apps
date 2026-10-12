// These are Host-provided execution identities, never paths or access grants.
// Keep legacy keys unchanged when the Host provides no additional proof.
export function projectIdentity(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope) || scope.version !== 1)
    return null;
  const fields = [scope.environmentId, scope.projectId, scope.rootId];
  if (fields.some(value => typeof value !== "string" || !value.trim()
    || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value))) return null;
  return JSON.stringify([1, ...fields]);
}

export function projectContextKey(context = {}) {
  if (!context || typeof context !== "object" || Array.isArray(context)) context = {};
  const key = [context.cwd ?? null, context.sessionId ?? null];
  const identity = projectIdentity(context.projectScope);
  if (identity || context.host != null || context.appId != null)
    key.push(context.host ?? null, context.appId ?? null, identity);
  return JSON.stringify(key);
}

export function projectContextChanged(previous, next) {
  return projectContextKey(previous) !== projectContextKey(next);
}
