// POST /api/progress   (called by the Action; shared-secret protected)
// Body {slug,stage,state,error?,report?}. Writes KV status:<slug>; if `report`
// is present, also writes KV report:<slug> and marks status done. Never 500.
import { json, kvPut } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  try {
    const secret = request.headers.get('x-progress-secret') || '';
    if (!env.PROGRESS_SECRET || secret !== env.PROGRESS_SECRET) {
      return json({ ok: false, error: 'unauthorized' }, 403);
    }
    let body = {};
    try { body = await request.json(); } catch (_) { /* bad body */ }
    const slug = String((body && body.slug) || '').trim();
    if (!slug) return json({ ok: false, error: 'slug required' }, 400);

    const STATUS_TTL = 3600;        // 1h — progress is short-lived
    const REPORT_TTL = 7 * 24 * 3600; // 7d — the committed file is the durable copy
    if (body.report) {
      await kvPut(env, `report:${slug}`, typeof body.report === 'string' ? body.report : JSON.stringify(body.report), REPORT_TTL);
      await kvPut(env, `status:${slug}`, { state: 'done', stage: 6, ts: Date.now() }, STATUS_TTL);
      return json({ ok: true, stored: 'report' });
    }

    await kvPut(env, `status:${slug}`, {
      state: String(body.state || 'running'),
      stage: Number.isFinite(+body.stage) ? +body.stage : 0,
      error: body.error ? String(body.error) : null,
      ts: Date.now(),
    }, STATUS_TTL);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 200); // never 500
  }
}
