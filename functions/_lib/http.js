// functions/_lib/http.js — shared helpers for the Pages Functions.
// (_lib is underscore-prefixed so Pages routing ignores it; the route files
// import from here.)

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

/** KV get — tolerant of a missing binding so the site still works before KV is wired. */
export async function kvGet(env, key) {
  try { if (env && env.PEERVIP_KV) return await env.PEERVIP_KV.get(key); } catch (_) { /* ignore */ }
  return null;
}

/** KV put — best-effort; never throws. `ttlSeconds` (>=60) sets an expiry. */
export async function kvPut(env, key, value, ttlSeconds) {
  try {
    if (env && env.PEERVIP_KV) {
      const opts = (ttlSeconds && ttlSeconds >= 60) ? { expirationTtl: Math.floor(ttlSeconds) } : undefined;
      await env.PEERVIP_KV.put(key, typeof value === 'string' ? value : JSON.stringify(value), opts);
    }
  } catch (_) { /* ignore */ }
}
