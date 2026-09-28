// GET /api/research-status?slug=<slug>
// Returns KV status:<slug> ({state,stage,error?}); if report:<slug> exists,
// forces state 'done'. Never 500.
import { json, kvGet } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  try {
    const slug = new URL(request.url).searchParams.get('slug');
    if (!slug) return json({ state: 'unknown' });

    if (await kvGet(env, `report:${slug}`)) return json({ state: 'done', stage: 6 });

    const raw = await kvGet(env, `status:${slug}`);
    if (!raw) return json({ state: 'unknown' });
    try { return json(JSON.parse(raw)); } catch (_) { return json({ state: 'unknown' }); }
  } catch (e) {
    return json({ state: 'unknown', error: String((e && e.message) || e) });
  }
}
