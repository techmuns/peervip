// research.js — thin client for the live pipeline (Pages Functions). The
// loading controller in app.js drives the UI from these.

/** POST /api/research {query} -> { slug, dispatched, manual? }. Throws if the
 *  endpoint is unreachable (offline / no Functions) so the caller can fall back. */
export async function dispatchResearch(query) {
  const res = await fetch('/api/research', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`/api/research HTTP ${res.status}`);
  return res.json();
}

/** GET /api/research-status?slug -> { state, stage, error? }. */
export async function fetchStatus(slug) {
  const res = await fetch(`/api/research-status?slug=${encodeURIComponent(slug)}&_cb=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`/api/research-status HTTP ${res.status}`);
  return res.json();
}
