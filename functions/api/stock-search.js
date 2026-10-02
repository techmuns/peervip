// GET /api/stock-search?q=<text> — typeahead for the dashboard's "Add peer" box.
// Proxies the muns birdnest stock search so the MUNS_TOKEN stays server-side, and
// returns a compact [{ code, name, country, industry }] list the dropdown renders.
// Never 500: returns { ok:false, error } so the UI can degrade gracefully.
import { json } from '../_lib/http.js';

const SEARCH_URL = 'https://birdnest.muns.io/stock/search';
const USER_INDEX = 124; // static per the muns API contract

export async function onRequestGet(context) {
  try {
    const q = (new URL(context.request.url).searchParams.get('q') || '').trim();
    if (q.length < 2) return json({ ok: true, results: [] }, 200);

    const token = context.env && context.env.MUNS_TOKEN;
    if (!token) return json({ ok: false, error: 'Stock search is not configured (missing MUNS_TOKEN).' }, 200);

    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { accept: '*/*', Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: q, user_index: USER_INDEX }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return json({ ok: false, error: `Stock search failed (${res.status}).` }, 200);

    const data = await res.json().catch(() => null);
    const raw = (data && data.data && data.data.results) || {};
    // results is { CODE: [country, name, industry] } — flatten to a tidy array.
    const results = Object.entries(raw).map(([code, arr]) => ({
      code,
      country: Array.isArray(arr) ? (arr[0] || '') : '',
      name: Array.isArray(arr) ? (arr[1] || code) : code,
      industry: Array.isArray(arr) ? (arr[2] || '') : '',
    }));
    return json({ ok: true, results }, 200);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 200);
  }
}
