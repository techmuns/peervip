// data.js — loads the committed JSON (index + per-report) and resolves a search
// query to a report. In Step 2 the same functions can point at a live pipeline
// behind the identical data contract; nothing else in the UI need change.

const INDEX_URL = './data/index.json';
const reportUrl = (slug) => `./data/reports/${slug}.json`;

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

export async function loadReport(slug) {
  if (_reportCache.has(slug)) return _reportCache.get(slug);
  const p = fetch(reportUrl(slug), { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`${slug}.json ${r.status}`); return r.json(); })
    .catch((e) => { _reportCache.delete(slug); throw e; });
  _reportCache.set(slug, p);
  return p;
}

const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Resolve a free-text query to the best-matching report entry from index.json.
 * Matches against slug, name, query, seed_company and aliases. Returns the entry
 * or null. Deliberately forgiving so "Stylam", "laminates", "Monolithisch" all hit.
 */
export function matchReport(query, index) {
  const q = norm(query);
  if (!q || !index || !Array.isArray(index.reports)) return null;
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
  return bestScore >= 25 ? best : null;
}

function tokenOverlap(a, b) {
  const at = new Set(a.split(' ').filter((t) => t.length > 2));
  return b.split(' ').some((t) => t.length > 2 && at.has(t));
}
