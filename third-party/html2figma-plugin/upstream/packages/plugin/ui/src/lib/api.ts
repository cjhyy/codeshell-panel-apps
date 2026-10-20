/** Convert URL to FigmaJSON via server */
export async function convertUrl(
  serverUrl: string,
  params: { url: string; selector?: string; width?: number; height?: number }
) {
  const res = await fetch(`${serverUrl}/api/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, store: false }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Conversion failed');
  return data.figmaJSON;
}

/** Convert HTML string to FigmaJSON via server */
export async function convertHtml(
  serverUrl: string,
  params: { html: string; selector?: string; width?: number; height?: number }
) {
  const res = await fetch(`${serverUrl}/api/convert/html`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, store: false }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Conversion failed');
  return data.figmaJSON;
}

/** Poll for results (dev mode) */
export async function pollResult(serverUrl: string, mode?: 'queue') {
  const url = mode === 'queue'
    ? `${serverUrl}/api/result?mode=queue`
    : `${serverUrl}/api/result`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Get queue status */
export async function getQueueStatus(serverUrl: string) {
  const res = await fetch(`${serverUrl}/api/queue/status`);
  if (!res.ok) return { length: 0 };
  return res.json();
}

/** Export nodes to server */
export async function exportToServer(serverUrl: string, nodes: any[]) {
  const res = await fetch(`${serverUrl}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes }),
  });
  return res.json();
}
