// GET /api/peer?name=<company> — benchmark ONE listed company on demand for the
// dashboard's "Add peer" control. Resolves the name on Screener, scrapes its page
// and maps it into the PeerVIP peer shape. Never 500: returns { ok:false, error }.
import { json } from '../_lib/http.js';
import { fetchPeer } from '../_lib/screener-lite.mjs';

export async function onRequestGet(context) {
  try {
    const name = (new URL(context.request.url).searchParams.get('name') || '').trim();
    if (!name) return json({ ok: false, error: 'name required' }, 400);
    const peer = await fetchPeer(name);
    if (!peer || peer.error) return json({ ok: false, error: (peer && peer.error) || 'Not found.' }, 200);
    return json({ ok: true, peer }, 200);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 200);
  }
}
