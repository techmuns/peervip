// GET /api/report/<slug>
// Serves the freshly-researched report from KV (instant, before the repo
// redeploys). 404 when absent → the frontend falls back to the committed
// public/data/reports/<slug>.json seed. Never 500.
import { json, kvGet } from '../../_lib/http.js';

export async function onRequestGet({ params, env }) {
  try {
    const slug = String(params.slug || '');
    const raw = await kvGet(env, `report:${slug}`);
    if (raw) {
      return new Response(raw, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    return json({ ok: false, error: 'not found' }, 404);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 404);
  }
}
