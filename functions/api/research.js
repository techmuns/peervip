// POST /api/research {query}
// Owns slug creation; fires a GitHub Actions workflow_dispatch to run the
// research pipeline; seeds KV status; returns {slug, dispatched}. Never 500.
import { json, kvPut, kvGet } from '../_lib/http.js';
import { slugify } from '../_lib/slug.js';

const COOLDOWN_MS = 5 * 60 * 1000; // don't re-dispatch a run already in flight

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    let query = '';
    try { const body = await request.json(); query = String((body && body.query) || '').trim(); } catch (_) { /* bad body */ }
    if (!query) return json({ ok: false, error: 'query required' }, 400);

    const slug = slugify(query);
    const token = env.GH_DISPATCH_TOKEN;
    const owner = env.GH_OWNER;
    const repo = env.GH_REPO;
    const ref = env.GH_REF || 'main';

    if (!token || !owner || !repo) {
      return json({ ok: true, slug, dispatched: false, manual: manualSteps(query, owner, repo) });
    }

    // Guardrail: if a run for this slug is already in flight (< 5 min, not
    // done/failed), don't spam another workflow_dispatch — return the live one.
    try {
      const raw = await kvGet(env, `status:${slug}`);
      if (raw) {
        const s = JSON.parse(raw);
        const inFlight = s && s.state && s.state !== 'done' && s.state !== 'failed';
        if (inFlight && (Date.now() - (s.ts || 0)) < COOLDOWN_MS) {
          return json({ ok: true, slug, dispatched: true, cooldown: true });
        }
      }
    } catch (_) { /* fall through to dispatch */ }

    await kvPut(env, `status:${slug}`, { state: 'starting', stage: 0, ts: Date.now() }, 3600);

    const api = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/research.yml/dispatches`;
    try {
      const res = await fetch(api, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'peervip-pages-function',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref, inputs: { query, slug } }),
      });
      if (res.status === 204) return json({ ok: true, slug, dispatched: true, ref });
      const detail = (await res.text()).slice(0, 200);
      return json({ ok: true, slug, dispatched: false, error: `GitHub API HTTP ${res.status}`, detail, manual: manualSteps(query, owner, repo) });
    } catch (e) {
      return json({ ok: true, slug, dispatched: false, error: String((e && e.message) || e), manual: manualSteps(query, owner, repo) });
    }
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 200); // never 500
  }
}

function manualSteps(query, owner, repo) {
  const where = owner && repo ? `github.com/${owner}/${repo}` : 'the repo';
  return `Live research isn't fully configured on this deployment. To research "${query}" manually: open ${where} → Actions → "Research peers" → Run workflow, and enter "${query}". It takes a few minutes; the dashboard shows it once the run finishes.`;
}
