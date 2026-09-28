/**
 * scripts/test-global.mjs — validate global-peer enrichment (Yahoo crumb+cookie)
 * WITHOUT a full run. Prints what we got for one company (default: Advanced
 * Drainage Systems / WMS). No creds needed. Run via the test-creds workflow.
 */
import { fetchGlobalPeer } from '../lib/global.mjs';

const PROBE = process.env.GLOBAL_PROBE || 'Advanced Drainage Systems';

try {
  const g = await fetchGlobalPeer(PROBE);
  console.log(`[test-global] "${PROBE}" -> ticker ${g.ticker || '(unresolved)'}`);
  const keys = Object.keys(g.current || {});
  console.log(`[test-global] metrics (${keys.length}):`);
  for (const k of keys) console.log(`   ${k.padEnd(16)} ${g.current[k]}`);
  console.log(`[test-global] revenue series: ${g.series && g.series.revenue ? g.series.revenue.years.join(', ') : 'none'}`);
  console.log(`[test-global] source: ${g.source && g.source.url}`);
  if (!g.ticker) { console.error('[test-global] WARNING: could not resolve a ticker (Yahoo search).'); process.exit(1); }
  if (!keys.length) { console.error('[test-global] WARNING: ticker resolved but no metrics (crumb/cookie or rate limit). Global peers will be name-only.'); process.exit(1); }
  console.log('[test-global] SUCCESS');
  process.exit(0);
} catch (err) {
  console.error('[test-global] FAILED');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}
