// peers.js — per-report Add/Remove-peer overlay, persisted in localStorage so a
// user's tweaks to the Indian peer set survive reloads. The committed report is
// never changed on disk; this is a client-side view overlay only.
//   overlay = { added: [<peer objects>], removed: [<peer names>] }

const KEY = (slug) => `peervip:peers:${slug || 'x'}`;
export const normName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function loadOverlay(slug) {
  try {
    const o = JSON.parse(localStorage.getItem(KEY(slug)) || 'null');
    if (o && Array.isArray(o.added) && Array.isArray(o.removed)) return o;
  } catch (_) { /* ignore */ }
  return { added: [], removed: [] };
}

export function saveOverlay(slug, ov) {
  try { localStorage.setItem(KEY(slug), JSON.stringify(ov)); } catch (_) { /* ignore */ }
}

/** Apply the stored overlay to a freshly-loaded report's Indian peers (once). */
export function applyOverlay(report) {
  const slug = report && report.meta && report.meta.slug;
  const ov = loadOverlay(slug);
  const base = (report.peers && report.peers.indian) || [];
  const rm = new Set(ov.removed.map(normName));
  const addedNames = new Set((ov.added || []).map((p) => normName(p.name)));
  report.peers.indian = base
    .filter((p) => !rm.has(normName(p.name)) && !addedNames.has(normName(p.name)))
    .concat(ov.added || []);
  return ov;
}
