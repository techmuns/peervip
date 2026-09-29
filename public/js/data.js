// data.js — the ONLY network ingress for report data.
//   loadIndex()  -> ./data/index.json (committed catalogue)
//   loadReport() -> /api/report/<slug> (live KV, instant) with a committed-seed
//                   fallback to ./data/reports/<slug>.json (G3). API-first so a
//                   freshly-researched slug renders before the repo redeploys.
// Report results are promise-cached with no TTL; evict a slug (or pass {fresh})
// to force a re-fetch of a just-researched report (G5).

const INDEX_URL = './data/index.json';
const apiReportUrl = (slug) => `/api/report/${encodeURIComponent(slug)}?_cb=${Date.now()}`;
const seedReportUrl = (slug) => `./data/reports/${encodeURIComponent(slug)}.json`;

let _indexPromise = null;
const _reportCache = new Map();

export async function loadIndex() {
  if (!_indexPromise) {
    _indexPromise = fetch(INDEX_URL, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`index.json ${r.status}`); return r.json(); })
      .catch((e) => { _indexPromise = null; throw e; });
  }
  return _indexPromise;
}

/** Drop a slug from the in-memory cache (used after a fresh research run). */
export function evictReport(slug) { _reportCache.delete(slug); }

export async function loadReport(slug, { fresh = false } = {}) {
  if (fresh) _reportCache.delete(slug);
  if (_reportCache.has(slug)) return _reportCache.get(slug);
  const p = fetchReport(slug).catch((e) => { _reportCache.delete(slug); throw e; });
  _reportCache.set(slug, p);
  return p;
}

async function fetchReport(slug) {
  // Fetch the live-KV copy (instant, present for freshly-researched slugs) AND the
  // committed seed in parallel, then keep whichever is FRESHER by meta timestamp.
  // The seed wins ties — it's the durable copy (see functions/api/progress.js: KV
  // carries only a 7-day TTL). This way a fresh research run renders instantly from
  // KV before the repo redeploys, while an edited/backfilled seed is never shadowed
  // by a stale KV entry.
  const [kv, seed] = await Promise.all([fetchKV(slug), fetchSeed(slug)]);
  if (kv && seed) return freshness(kv) > freshness(seed) ? kv : seed;
  const r = kv || seed;
  if (!r) throw new Error(`report ${slug} unavailable`);
  return r;
}
async function fetchKV(slug) {
  try { const res = await fetch(apiReportUrl(slug), { cache: 'no-store' }); if (res.ok) return await res.json(); } catch (_) { /* offline / not deployed */ }
  return null;
}
async function fetchSeed(slug) {
  try { const res = await fetch(seedReportUrl(slug), { cache: 'no-cache' }); if (res.ok) return await res.json(); } catch (_) { /* missing seed */ }
  return null;
}
/** Newest meta timestamp on a report (updated_at ▸ enriched_at ▸ generated_at), ms. */
function freshness(r) {
  const m = (r && r.meta) || {};
  let max = 0;
  for (const v of [m.updated_at, m.enriched_at, m.generated_at]) {
    const t = v ? Date.parse(v) : NaN;
    if (isFinite(t) && t > max) max = t;
  }
  return max;
}

const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Resolve a free-text query to the best index entry.
 * Returns { entry, score } — entry is null below the weak threshold (25).
 * 100 exact · 70 prefix (either direction) · 45 substring · 25 shared token.
 * The caller decides: score >= 70 is a STRONG match (open cached); weaker
 * dispatches a fresh research run (G6).
 */
export function matchReport(query, index) {
  const q = norm(query);
  if (!q || !index || !Array.isArray(index.reports)) return { entry: null, score: 0 };
  let best = null;
  let bestScore = 0;
  for (const rep of index.reports) {
    const hay = [rep.name, rep.slug, rep.query, rep.seed_company, ...(rep.aliases || [])]
      .filter(Boolean).map(norm);
    let score = 0;
    for (const h of hay) {
      if (!h) continue;
      if (h === q) score = Math.max(score, 100);
      else if (h.startsWith(q) || q.startsWith(h)) score = Math.max(score, 70);
      else if (h.includes(q) || q.includes(h)) score = Math.max(score, 45);
      else if (tokenOverlap(q, h)) score = Math.max(score, 25);
    }
    if (score > bestScore) { bestScore = score; best = rep; }
  }
  return { entry: bestScore >= 25 ? best : null, score: bestScore };
}

function tokenOverlap(a, b) {
  const at = new Set(a.split(' ').filter((t) => t.length > 2));
  return b.split(' ').some((t) => t.length > 2 && at.has(t));
}
