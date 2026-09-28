/**
 * lib/jina.mjs — grounding via Jina (search + reader). Bearer auth with
 * JINA_API_KEY. Never-fail: every call retries a few times then returns []/''
 * so the pipeline still runs without the key (search needs it; the reader works
 * keyless at a lower rate limit).
 */
const KEY = process.env.JINA_API_KEY || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authHeaders(extra = {}) {
  const h = { ...extra };
  if (KEY) h.Authorization = `Bearer ${KEY}`;
  return h;
}

async function get(url, headers, { json = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      if (!res.ok) { if (res.status === 429 || res.status >= 500) continue; return null; }
      return json ? await res.json() : await res.text();
    } catch (_) { /* retry */ }
  }
  return null;
}

/**
 * jinaSearch(query) -> [{ title, url, snippet }] (top results). Uses
 * X-Respond-With: no-content so it returns titles+urls+snippets, not full pages.
 */
export async function jinaSearch(query) {
  const q = String(query || '').trim();
  if (!q || !KEY) return [];
  const data = await get(`https://s.jina.ai/?q=${encodeURIComponent(q)}`,
    authHeaders({ Accept: 'application/json', 'X-Respond-With': 'no-content' }), { json: true });
  const rows = data && (Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []));
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    title: String(r.title || '').trim(),
    url: String(r.url || r.link || '').trim(),
    snippet: String(r.description || r.snippet || r.content || '').replace(/\s+/g, ' ').trim().slice(0, 400),
  })).filter((r) => r.url).slice(0, 10);
}

/** jinaRead(url) -> clean markdown of that page ('' on failure). */
export async function jinaRead(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  const md = await get(`https://r.jina.ai/${u}`, authHeaders({ 'X-Return-Format': 'markdown' }));
  return typeof md === 'string' ? md : '';
}

export function jinaConfigured() { return !!KEY; }
