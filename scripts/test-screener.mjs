/**
 * scripts/test-screener.mjs — validate Screener login + parse WITHOUT a full run.
 * Resolves one company (default STYLAMIND), logs in, scrapes + parses, and prints
 * ALL 26 metrics + which series filled + the material-cost enrichment. Run via
 * the test-creds workflow. Exits 1 if core metrics didn't parse.
 */
import { chromium } from 'playwright';
import { resolveScreenerCode, screenerLogin, getCompanyHtml, mapCompany, screenerMaterialCost } from '../lib/screener.mjs';
import { METRIC_KEYS } from '../lib/metrics.mjs';

const PROBE = process.env.SCREENER_PROBE || 'Stylam Industries';

const browser = await chromium.launch();
const page = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' }).then((c) => c.newPage());
try {
  const loggedIn = await screenerLogin(page);
  console.log(`[test-screener] login: ${loggedIn ? 'OK (full ratios unlocked)' : 'anonymous (set SCREENER_EMAIL/PASSWORD for the full ribbon)'}`);

  const hit = await resolveScreenerCode(PROBE);
  if (!hit) throw new Error(`could not resolve "${PROBE}" on Screener search`);
  console.log(`[test-screener] resolved: ${hit.name} -> ${hit.code} (id ${hit.id})`);

  const res = await getCompanyHtml(page, hit.code);
  if (!res) throw new Error('company page did not load');
  const m = mapCompany(res.html);

  const mc = await screenerMaterialCost(hit.id).catch(() => null);
  if (mc) { if (m.current.rm_cost_pct == null) m.current.rm_cost_pct = mc.rm_cost_pct; if (m.current.gross_margin == null) m.current.gross_margin = mc.gross_margin; }
  console.log(`[test-screener] material cost: rm_cost_pct=${mc ? mc.rm_cost_pct : '—'} gross_margin=${mc ? mc.gross_margin : '—'}`);

  console.log('[test-screener] all 26 metrics:');
  let filled = 0;
  for (const k of METRIC_KEYS) { const v = m.current[k]; if (v != null) filled++; console.log(`   ${k.padEnd(18)} ${v == null ? '—' : v}`); }
  console.log(`[test-screener] FILLED: ${filled}/26`);
  console.log(`[test-screener] series: ${Object.keys(m.series).map((k) => `${k}(${m.series[k].years.length})`).join(', ') || 'none'}`);

  if (m.current.ebitda_margin == null && m.current.revenue == null) {
    console.error('[test-screener] WARNING: no core metrics parsed — layout changed or login required.');
    process.exit(1);
  }
  console.log('[test-screener] SUCCESS');
  process.exit(0);
} catch (err) {
  console.error('[test-screener] FAILED');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
} finally {
  await browser.close().catch(() => {});
}
