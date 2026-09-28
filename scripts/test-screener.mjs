/**
 * scripts/test-screener.mjs — verify Screener login + scrape BEFORE a real run.
 * Resolves a well-known listed company, logs in, scrapes one page, and prints a
 * few mapped metrics. Exits 1 on failure. Runs in the test-creds workflow
 * (playwright + cheerio installed there).
 */
import { chromium } from 'playwright';
import { resolveScreenerCode, screenerLogin, getCompanyHtml, mapCompany } from '../lib/screener.mjs';

const PROBE = process.env.SCREENER_PROBE || 'Stylam Industries';

const browser = await chromium.launch();
const page = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' }).then((c) => c.newPage());
try {
  const loggedIn = await screenerLogin(page);
  console.log(`[test-screener] login: ${loggedIn ? 'OK (full ratios unlocked)' : 'anonymous (set SCREENER_EMAIL/PASSWORD for the full ribbon)'}`);

  const hit = await resolveScreenerCode(PROBE);
  if (!hit) throw new Error(`could not resolve "${PROBE}" on Screener search`);
  console.log(`[test-screener] resolved: ${hit.name} -> ${hit.code}`);

  const res = await getCompanyHtml(page, hit.code);
  if (!res) throw new Error('company page did not load');
  const m = mapCompany(res.html);
  const shown = ['revenue', 'ebitda_margin', 'pat_margin', 'roce', 'roe', 'debtor_days', 'promoter_holding'];
  console.log('[test-screener] sample metrics:');
  for (const k of shown) console.log(`   ${k}: ${m.current[k] ?? '—'}`);
  console.log(`[test-screener] series parsed: ${Object.keys(m.series).join(', ') || 'none'}`);
  if (m.current.ebitda_margin == null && m.current.revenue == null) {
    console.error('[test-screener] WARNING: no core metrics parsed — page layout may have changed or login is required.');
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
