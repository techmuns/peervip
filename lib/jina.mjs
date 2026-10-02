/**
 * lib/jina.mjs — web grounding (search + reader) for the research pipeline.
 *
 * PRIMARY: Jina (JINA_API_KEY) — s.jina.ai search + r.jina.ai reader. Its free tier
 * is generous, so it's tried first and preferred.
 * FALLBACK: Firecrawl (FIRECRAWL_API_KEY) — only used when Jina is unset or a call
 * comes back empty/fails, so it burns as few Firecrawl credits as possible. Search
 * is capped at a small result count and the reader scrapes a single page, matching
 * the pipeline's per-node budget.
 *
 * Never-fail: every call retries a few times then returns []/''. The pipeline still
 * runs with NEITHER key (discovery just leans on the Screener routes instead).
 */
const KEY = process.env.JINA_API_KEY || '';
const FC = process.env.FIRECRAWL_API_KEY || '';
const FC_BASE = process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev';
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

async function postJson(url, headers, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
      if (!res.ok) { if (res.status === 429 || res.status >= 500) continue; return null; }
      return await res.json();
    } catch (_) { /* retry */ }
  }
  return null;
}

/* ----------------------------------------------------------- Firecrawl fallback */
// Credit-frugal: small result limit, SERP-only search (no per-result scraping).
async function firecrawlSearch(query) {
  if (!FC) return [];
  const data = await postJson(`${FC_BASE}/v1/search`, { Authorization: `Bearer ${FC}` }, { query, limit: 6 });
  const rows = data && data.success && Array.isArray(data.data) ? data.data : [];
  return rows.map((r) => ({
    title: String(r.title || '').trim(),
    url: String(r.url || '').trim(),
    snippet: String(r.description || r.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 400),
  })).filter((r) => r.url).slice(0, 10);
}

// One page → markdown. Costs ~1 Firecrawl credit.
async function firecrawlScrape(url) {
  if (!FC) return '';
  const data = await postJson(`${FC_BASE}/v1/scrape`, { Authorization: `Bearer ${FC}` }, { url, formats: ['markdown'], onlyMainContent: true });
  const md = data && data.success && data.data ? data.data.markdown : '';
  return typeof md === 'string' ? md : '';
}

/* ----------------------------------------------------------------- public API */
/**
 * jinaSearch(query) -> [{ title, url, snippet }] (top results). Jina first (no-content
 * mode = titles+urls+snippets, not full pages); Firecrawl search as a fallback.
 */
export async function jinaSearch(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (KEY) {
    const data = await get(`https://s.jina.ai/?q=${encodeURIComponent(q)}`,
      authHeaders({ Accept: 'application/json', 'X-Respond-With': 'no-content' }), { json: true });
    const rows = data && (Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []));
    if (Array.isArray(rows) && rows.length) {
      return rows.map((r) => ({
        title: String(r.title || '').trim(),
        url: String(r.url || r.link || '').trim(),
        snippet: String(r.description || r.snippet || r.content || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      })).filter((r) => r.url).slice(0, 10);
    }
  }
  return firecrawlSearch(q); // Jina unset or empty → Firecrawl (if configured)
}

/** jinaRead(url) -> clean markdown of that page ('' on failure). Jina reader first,
 *  Firecrawl scrape as a fallback. */
export async function jinaRead(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (KEY) {
    const md = await get(`https://r.jina.ai/${u}`, authHeaders({ 'X-Return-Format': 'markdown' }));
    if (typeof md === 'string' && md.trim()) return md;
  }
  return firecrawlScrape(u); // Jina unset or empty → Firecrawl (if configured)
}

/** True when ANY web-grounding provider is configured (Jina or Firecrawl). */
export function jinaConfigured() { return !!KEY || !!FC; }
