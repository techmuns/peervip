/**
 * lib/screener.mjs — Screener.in client for the research pipeline.
 *
 *  - Public autocomplete search (no auth) to resolve a company's Screener code
 *    and confirm it's listed:  screenerSearch(), resolveScreenerCode().
 *  - Playwright login + per-company page scrape (login unlocks the full ratio
 *    ribbon + Export). Section tables are parsed with cheerio and mapped into
 *    the 26 PeerVIP metric keys as current{} + series{}.
 *
 * Everything is continue-on-error: a failed field is null, a failed company is
 * skipped — one bad peer never aborts the run. Runs inside GitHub Actions where
 * `playwright` and `cheerio` are installed at job start (--no-save).
 */
import * as cheerio from 'cheerio';

const BASE = 'https://www.screener.in';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------------------------------------- search */

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest', Referer: BASE + '/' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) { if (res.status === 429 || res.status >= 500) continue; return null; }
      return await res.json();
    } catch (_) { /* retry */ }
  }
  return null;
}

/** A Screener url path → { code, consolidated } (rejects /company/id/<n>/ variants). */
export function parseCompanyPath(url) {
  const m = String(url || '').match(/\/company\/([^/]+)\/(consolidated\/?)?/i);
  if (!m) return null;
  const code = decodeURIComponent(m[1]);
  if (!code || code.toLowerCase() === 'id') return null;
  return { code, consolidated: !!m[2] };
}

/** Normalized autocomplete results: [{ ticker, code, name, consolidated, url }]. */
export async function screenerSearch(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const data = await getJson(`${BASE}/api/company/search/?q=${encodeURIComponent(q)}&v=3&fts=1`);
  const rows = Array.isArray(data) ? data : [];
  const out = [];
  for (const r of rows) {
    const path = r && parseCompanyPath(r.url);
    const name = r && String(r.name || '').trim();
    // real company rows carry a numeric id; the "Search everywhere" row has id null
    if (path && name && r.id != null) out.push({ ticker: path.code, code: path.code, id: r.id, name, consolidated: path.consolidated, url: String(r.url || '') });
  }
  return out;
}

/**
 * Screener's expandable expense breakdown (no login): Material Cost % per year.
 * Returns { rm_cost_pct, gross_margin, rmSeries } or null. Needs the numeric id.
 */
export async function screenerMaterialCost(companyId) {
  const id = String(companyId == null ? '' : companyId).trim();
  if (!id) return null;
  const data = await getJson(`${BASE}/api/company/${encodeURIComponent(id)}/schedules/?parent=Expenses&section=profit-loss`);
  if (!data || typeof data !== 'object') return null;
  const seriesFrom = (names) => {
    let row = null;
    for (const n of names) if (data[n] && typeof data[n] === 'object') { row = data[n]; break; }
    if (!row) return null;
    const entries = Object.entries(row).filter(([k]) => /\d{4}/.test(k) && !/ttm/i.test(k)).sort((a, b) => periodYear(a[0]) - periodYear(b[0]));
    if (!entries.length) return null;
    const years = entries.map(([k]) => k);
    const values = entries.map(([, v]) => num(v));
    return values.some((v) => v != null) ? { years, values } : null;
  };
  const rmSeries = seriesFrom(['Material Cost %', 'Raw Material Cost %']);
  const mfgSeries = seriesFrom(['Manufacturing Cost %']);
  const empSeries = seriesFrom(['Employee Cost %']);
  const othSeries = seriesFrom(['Other Cost %']);
  const grossSeries = mapSeries(rmSeries, (r) => isNum(r) ? +(100 - r).toFixed(1) : null);
  const rm = lastOf(rmSeries);
  if (rm == null && !mfgSeries && !empSeries && !othSeries) return null;
  const series = {};
  if (rmSeries) series.rm_cost_pct = rmSeries;
  if (grossSeries) series.gross_margin = grossSeries;
  if (mfgSeries) series.manufacturing_cost_pct = mfgSeries;
  if (empSeries) series.employee_cost_pct = empSeries;
  if (othSeries) series.other_cost_pct = othSeries;
  return {
    rm_cost_pct: rm,
    gross_margin: rm != null ? +(100 - rm).toFixed(1) : null,
    rmSeries, // backward-compat
    current: {
      rm_cost_pct: rm,
      gross_margin: rm != null ? +(100 - rm).toFixed(1) : null,
      manufacturing_cost_pct: lastOf(mfgSeries),
      employee_cost_pct: lastOf(empSeries),
      other_cost_pct: lastOf(othSeries),
    },
    series,
  };
}
function periodYear(s) { const m = /(\d{4})/.exec(String(s)); return m ? +m[1] : 0; }

/* ------------------------------------------------- /market industry universe */

/** Plain HTML GET (retries) — for the server-rendered /market pages (no JS). */
async function getText(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*', Referer: BASE + '/' }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) { if (res.status === 429 || res.status >= 500) continue; return null; }
      return await res.text();
    } catch (_) { /* retry */ }
  }
  return null;
}

/** The deepest /market/ industry href from a company page's HTML (title="Industry"). */
export function industryHrefFromHtml(html) {
  const $ = cheerio.load(String(html || ''));
  return industryHref($);
}
function industryHref($) {
  let href = $('a[title="Industry"][href^="/market/"]').first().attr('href') || '';
  if (!href) {
    // fallback: the deepest (= longest) /market/ anchor is the granular industry
    const links = $('a[href^="/market/"]').map((_, a) => String($(a).attr('href') || '')).get();
    href = links.sort((a, b) => b.length - a.length)[0] || '';
  }
  return href || '';
}

/** Fetch a company page (plain, no login) and return its /market industry href. */
export async function getCompanyIndustryHref(code) {
  const c = String(code || '').trim();
  if (!c) return '';
  const html = await getText(`${BASE}/company/${encodeURIComponent(c)}/`);
  return html ? industryHrefFromHtml(html) : '';
}

/**
 * Paginate a Screener /market industry page and collect its whole company
 * universe: [{ name, code, marketCap }]. This is the backstop that guarantees a
 * clearly-classified listed peer is surfaced even when the web reports miss it
 * (a smaller-cap constituent buried on an industry page). Never-fail: returns
 * what it got.
 */
export async function mineIndustryUniverse(marketHref, { maxPages = 6 } = {}) {
  const href = String(marketHref || '').trim();
  if (!href.startsWith('/market/')) return [];
  const out = new Map();
  let totalPages = 1;
  for (let p = 1; p <= maxPages; p++) {
    const html = await getText(`${BASE}${href}${href.includes('?') ? '&' : '?'}page=${p}`);
    if (!html) break;
    const $ = cheerio.load(html);
    const m = $('body').text().match(/page\s+\d+\s+of\s+(\d+)/i);
    if (m) totalPages = Math.min(+m[1], maxPages);
    // The page is already sorted by market cap (desc), so insertion order IS the
    // ranking — more reliable than guessing which column is Mar Cap.
    $('table.data-table tbody tr').each((_, tr) => {
      const a = $(tr).find('a[href^="/company/"]').first();
      const code = (String(a.attr('href') || '').match(/\/company\/([^/]+)/) || [])[1] || '';
      const name = clean(a.text());
      if (!code || !name) return;
      if (!out.has(code)) out.set(code, { name, code });
    });
    if (p >= totalPages) break;
    await sleep(250);
  }
  return [...out.values()];
}

const normName = (s) => String(s || '').toLowerCase().replace(/\b(ltd|limited|industries|india|the|inc|plc|corp|company|co)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Resolve a company name to its best Screener code, or null if not found/listed. */
export async function resolveScreenerCode(name) {
  const results = await screenerSearch(name);
  if (!results.length) return null;
  const want = normName(name);
  let best = results[0], bestScore = -1;
  for (const r of results) {
    const rn = normName(r.name);
    let score = 0;
    if (rn === want) score = 100;
    else if (rn.startsWith(want) || want.startsWith(rn)) score = 70;
    else if (rn.includes(want) || want.includes(rn)) score = 40;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

/* -------------------------------------------------------------- login/page */

/** Log a Playwright page into Screener. Returns true if logged in, false if it
 *  couldn't (missing creds / bad creds) — the caller can still scrape anonymously. */
export async function screenerLogin(page) {
  const email = process.env.SCREENER_EMAIL;
  const password = process.env.SCREENER_PASSWORD;
  if (!email || !password) return false;
  try {
    await page.goto(`${BASE}/login/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.fill('input[name="username"]', email);
    await page.fill('input[name="password"]', password);
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(1500);
    return /\/logout\//.test(await page.content());
  } catch (_) { return false; }
}

/** Load a company page (consolidated first, then standalone) and return its HTML. */
export async function getCompanyHtml(page, code, { consolidated = true } = {}) {
  const paths = consolidated
    ? [`/company/${encodeURIComponent(code)}/consolidated/`, `/company/${encodeURIComponent(code)}/`]
    : [`/company/${encodeURIComponent(code)}/`, `/company/${encodeURIComponent(code)}/consolidated/`];
  for (const p of paths) {
    const url = BASE + p;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => document.querySelectorAll('#top-ratios li').length > 3, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(600);
      // best-effort: expand shareholding sub-rows (pledge lives collapsed)
      try {
        for (const btn of await page.locator('#shareholding button').all().catch(() => [])) {
          await btn.click({ timeout: 1200 }).catch(() => {});
        }
        await page.waitForTimeout(200);
      } catch (_) { /* no expander — fine */ }
      const html = await page.content();
      if (/id=["']top-ratios["']/.test(html)) return { html, url };
    } catch (_) { /* try next path */ }
  }
  return null;
}

/* ---------------------------------------------------------------- parsing */

function num(v) {
  if (v == null) return null;
  let s = String(v).replace(/,/g, '').replace(/[₹%]/g, '').replace(/₹/g, '').trim();
  if (!s || /^(-|—|na|n\/a)$/i.test(s)) return null;
  s = s.replace(/\b(crs?|crores?|rs|inr|x|days?)\b/gi, '').trim();
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** Parse a Screener section table into { periods:[], rows:[{label,values:[]}] }. */
function parseSection($, id) {
  const table = $(`#${id} table`).first();
  if (!table.length) return null;
  const heads = [];
  table.find('thead th').each((_, th) => heads.push(clean($(th).text())));
  const rows = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').map((_, td) => clean($(td).text())).get();
    if (cells.length) rows.push({ label: cells[0], values: cells.slice(1) });
  });
  return { periods: heads.slice(1), rows };
}
function findRow(section, re) { return section && section.rows.find((r) => re.test(r.label)); }

/** Latest non-TTM numeric value of a row. */
function latest(section, re) {
  const row = findRow(section, re);
  if (!row) return null;
  for (let i = row.values.length - 1; i >= 0; i--) {
    const period = section.periods[i] || '';
    if (/ttm/i.test(period)) continue;
    const n = num(row.values[i]);
    if (n != null) return n;
  }
  return null;
}

/** Aligned {years,values} for a row, dropping TTM columns; null if no data. */
function seriesOf(section, re) {
  const row = findRow(section, re);
  if (!row) return null;
  const years = [], values = [];
  section.periods.forEach((p, i) => {
    if (/ttm/i.test(p)) return;
    years.push(p);
    values.push(num(row.values[i]));
  });
  if (!years.length || values.every((v) => v == null)) return null;
  return { years, values };
}

/** Top-ratios ribbon → { label: number|string }. */
function topRatios($) {
  const map = {};
  $('#top-ratios li').each((_, li) => {
    const name = clean($(li).find('.name').text());
    const value = clean($(li).find('.value').text());
    if (name) map[name.toLowerCase()] = value;
  });
  return map;
}
function ribbon(map, re) {
  for (const k of Object.keys(map)) if (re.test(k)) return num(map[k]);
  return null;
}

/** Company description + pros/cons (Stage-0 business understanding seed). */
function profile($) {
  const about = clean($('.company-profile .about, .company-profile p, section#company-info .about').first().text()).slice(0, 1200);
  const pros = $('.pros li').map((_, li) => clean($(li).text())).get().slice(0, 8);
  const cons = $('.cons li').map((_, li) => clean($(li).text())).get().slice(0, 8);
  // Only real company peers (alpha ticker codes), never index/benchmark links
  // (those are numeric /company/1160/ and named "BSE …"/"Nifty …"). Screener's
  // full peer comparison loads via AJAX; this is a WEAK seed — Jina does the
  // real peer discovery, so an empty list here is fine.
  const peers = [];
  $('section#peers a[href^="/company/"]').each((_, a) => {
    const href = String($(a).attr('href') || '');
    const code = (href.match(/\/company\/([^/]+)/) || [])[1] || '';
    const name = clean($(a).text());
    if (/^[A-Za-z][A-Za-z0-9&.\- ]*$/.test(code) && name && !/\b(bse|nse|nifty|sensex|index)\b/i.test(name)) peers.push(name);
  });
  return { about, pros, cons, peers: [...new Set(peers)].slice(0, 20) };
}

function cagr(series, yrs) {
  if (!series || !series.values) return null;
  const v = series.values.filter((x) => typeof x === 'number' && isFinite(x));
  if (v.length < yrs + 1) return null;
  const end = v[v.length - 1], start = v[v.length - 1 - yrs];
  if (!start || start <= 0 || !end || end <= 0) return null;
  return +(((end / start) ** (1 / yrs) - 1) * 100).toFixed(1);
}
function isNum(v) { return typeof v === 'number' && isFinite(v); }
function mapSeries(s, fn) { if (!s || !s.values) return null; const values = s.values.map(fn); return values.some((v) => v != null) ? { years: s.years, values } : null; }
function combineSeries(a, b, fn) {
  if (!a || !a.values) return null;
  const values = a.years.map((y, i) => { const j = b ? b.years.indexOf(y) : -1; return fn(a.values[i], j >= 0 ? b.values[j] : null); });
  return values.some((v) => v != null) ? { years: a.years, values } : null;
}
function avgLastN(s, n) { if (!s || !s.values) return null; const v = s.values.filter(isNum).slice(-n); return v.length ? +(v.reduce((x, y) => x + y, 0) / v.length).toFixed(1) : null; }
const lastOf = (s) => (s ? lastNum(s.values) : null);
// A small "N Years : value" ranges table (Stock Price CAGR, Return on Equity) → { "1 year:": 3, … }.
function rangesTable($, re) {
  let out = {};
  $('table').each((_, t) => {
    if (Object.keys(out).length || !re.test(clean($(t).text()))) return;
    const map = {};
    $(t).find('tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length >= 2) { const k = clean($(tds[0]).text()); if (/\d/.test(k)) map[k.toLowerCase()] = num($(tds[1]).text()); }
    });
    if (Object.keys(map).length) out = map;
  });
  return out;
}
function pickKey(map, re) { for (const k of Object.keys(map)) if (re.test(k)) return map[k]; return null; }

/**
 * Map a company page's HTML into a PeerVIP peer's { current, series, ... }.
 * Every field is best-effort; anything missing stays null (never fabricated).
 */
export function mapCompany(html) {
  const $ = cheerio.load(html);
  const name = clean($('h1').first().text());
  const pl = parseSection($, 'profit-loss');
  const bs = parseSection($, 'balance-sheet');
  const cf = parseSection($, 'cash-flow');
  const ratios = parseSection($, 'ratios');
  const sh = parseSection($, 'shareholding');
  const top = topRatios($);

  // ---- P&L ----
  const salesSeries = pl && seriesOf(pl, /^sales|^revenue|^total revenue/i);
  const opmSeries = pl && seriesOf(pl, /^opm ?%/i);
  const npSeries = pl && seriesOf(pl, /^net profit/i);
  const opSeries = pl && seriesOf(pl, /operating profit/i);
  const epsSeries = pl && seriesOf(pl, /^eps/i);
  const taxSeries = pl && seriesOf(pl, /^tax ?%/i);
  const divPayoutSeries = pl && seriesOf(pl, /dividend payout/i);
  // ---- Ratios ----
  const roceSeries = ratios && seriesOf(ratios, /roce/i);
  const roeSeries = ratios && seriesOf(ratios, /return on equity|^roe/i);
  const debtorSeries = ratios && seriesOf(ratios, /debtor days/i);
  const inventorySeries = ratios && seriesOf(ratios, /inventory days/i);
  const cccSeries = ratios && seriesOf(ratios, /cash conversion/i);
  const payableSeries = ratios && seriesOf(ratios, /days payable|payable days/i);
  const wcSeries = ratios && seriesOf(ratios, /working capital days/i);
  // ---- Balance sheet ----
  const borrowSeries = bs && seriesOf(bs, /^borrowings/i);
  const eqSeries = bs && seriesOf(bs, /equity capital|share capital/i);
  const resSeries = bs && seriesOf(bs, /^reserves/i);
  const totalAssetsSeries = bs && seriesOf(bs, /total assets/i);
  const fixedAssetsSeries = bs && seriesOf(bs, /fixed assets/i);
  const cwipSeries = bs && seriesOf(bs, /cwip|capital work/i);
  const netWorthSeries = combineSeries(eqSeries, resSeries, (e, r) => (isNum(e) || isNum(r)) ? +(((e || 0) + (r || 0))).toFixed(0) : null);
  const deSeries = combineSeries(borrowSeries, netWorthSeries, (b, n) => (isNum(b) && isNum(n) && n > 0) ? +(b / n).toFixed(2) : null);
  const roeCalcSeries = roeSeries || combineSeries(npSeries, netWorthSeries, (np, nw) => (isNum(np) && isNum(nw) && nw > 0) ? +((np / nw) * 100).toFixed(1) : null);
  // ---- Cash flow ----
  const cfoSeries = cf && seriesOf(cf, /cash from operating/i);
  const investSeries = cf && seriesOf(cf, /cash from investing/i);
  const fcfSeries = (cf && seriesOf(cf, /free cash flow/i)) || combineSeries(cfoSeries, investSeries, (c, i) => (isNum(c) && isNum(i)) ? +(c + i).toFixed(0) : null);
  const cfoOpSeries = combineSeries(cfoSeries, opSeries, (c, o) => (isNum(c) && isNum(o) && o !== 0) ? +((c / o) * 100).toFixed(1) : null);
  // ---- Shareholding ----
  const promoterSeries = sh && seriesOf(sh, /promoter/i);
  const fiiSeries = sh && seriesOf(sh, /fiis?|foreign/i);
  const diiSeries = sh && seriesOf(sh, /diis?|domestic/i);
  const publicSeries = sh && seriesOf(sh, /^public/i);
  const pledgeSeries = sh && seriesOf(sh, /pledge/i);
  const shCountSeries = sh && seriesOf(sh, /shareholders/i);

  // PAT margin series = Net Profit / Sales per year (both from P&L).
  let patMarginSeries = null;
  if (salesSeries && npSeries) {
    const values = salesSeries.years.map((y, i) => {
      const s = salesSeries.values[i], np = npSeries.values[i];
      return (typeof s === 'number' && s > 0 && typeof np === 'number') ? +((np / s) * 100).toFixed(1) : null;
    });
    if (values.some((v) => v != null)) patMarginSeries = { years: salesSeries.years, values };
  }

  const salesLatest = pl && latest(pl, /^sales|^revenue|^total revenue/i);
  const npLatest = pl && latest(pl, /^net profit/i);

  let interestCov = null;
  if (pl) {
    const op = latest(pl, /operating profit/i), interest = latest(pl, /^interest/i);
    if (op != null && interest && interest > 0) interestCov = +(op / interest).toFixed(1);
  }
  let pb = ribbon(top, /price to book|p\/b/);
  if (pb == null) { const price = ribbon(top, /current price/); const bv = ribbon(top, /book value/); if (price != null && bv && bv > 0) pb = +(price / bv).toFixed(1); }
  const priceCagr = rangesTable($, /stock price cagr/i);
  const roeRanges = rangesTable($, /return on equity/i);

  const current = {
    revenue: salesLatest,
    rev_growth_1y: salesSeries ? pctChange(salesSeries.values) : null,
    rev_cagr_3y: cagr(salesSeries, 3),
    rev_cagr_5y: cagr(salesSeries, 5),
    net_profit: npLatest,
    operating_profit: lastOf(opSeries),
    eps: lastOf(epsSeries),
    profit_cagr_3y: cagr(npSeries, 3),
    profit_cagr_5y: cagr(npSeries, 5),
    market_cap: ribbon(top, /market cap/),
    gross_margin: null, // filled from the expenses schedule (screenerCostStructure)
    ebitda_margin: opmSeries ? lastNum(opmSeries.values) : ribbon(top, /opm/),
    pat_margin: (salesLatest && npLatest != null && salesLatest > 0) ? +((npLatest / salesLatest) * 100).toFixed(1) : null,
    rm_cost_pct: null, manufacturing_cost_pct: null, employee_cost_pct: null, other_cost_pct: null,
    tax_rate: lastOf(taxSeries),
    roce: ribbon(top, /roce/) ?? lastOf(roceSeries),
    roe: ribbon(top, /roe|return on equity/) ?? lastOf(roeCalcSeries),
    avg_roe_3y: pickKey(roeRanges, /3 ?year/) ?? avgLastN(roeCalcSeries, 3),
    avg_roe_5y: pickKey(roeRanges, /5 ?year/) ?? avgLastN(roeCalcSeries, 5),
    price_cagr_1y: pickKey(priceCagr, /1 ?year/),
    price_cagr_3y: pickKey(priceCagr, /3 ?year/),
    price_cagr_5y: pickKey(priceCagr, /5 ?year/),
    debtor_days: lastOf(debtorSeries),
    inventory_days: lastOf(inventorySeries),
    payable_days: lastOf(payableSeries),
    ccc: cccSeries ? lastNum(cccSeries.values) : (ratios ? latest(ratios, /cash conversion/i) : null),
    wc_days: lastOf(wcSeries),
    debt_equity: lastOf(deSeries) ?? ribbon(top, /debt to equity/),
    interest_coverage: interestCov,
    total_debt: lastOf(borrowSeries),
    net_worth: lastOf(netWorthSeries),
    total_assets: lastOf(totalAssetsSeries),
    fixed_assets: lastOf(fixedAssetsSeries),
    cwip: lastOf(cwipSeries),
    cfo: lastOf(cfoSeries),
    fcf: lastOf(fcfSeries),
    cfo_op: lastOf(cfoOpSeries),
    investing_cf: lastOf(investSeries),
    promoter_holding: promoterSeries ? lastNum(promoterSeries.values) : (sh ? latest(sh, /promoter/i) : null),
    pledge_pct: lastOf(pledgeSeries) ?? (sh ? latest(sh, /pledge/i) : null),
    fii_holding: lastOf(fiiSeries),
    dii_holding: lastOf(diiSeries),
    public_holding: lastOf(publicSeries),
    num_shareholders: lastOf(shCountSeries),
    pe: ribbon(top, /stock p\/e|^p\/e|price to earning/),
    pb,
    dividend_yield: ribbon(top, /dividend yield/),
    dividend_payout: lastOf(divPayoutSeries) ?? (pl ? latest(pl, /dividend payout/i) : null),
  };

  const series = {};
  const put = (k, s) => { if (s && s.years && s.years.length) series[k] = s; };
  put('revenue', salesSeries); put('ebitda_margin', opmSeries); put('pat_margin', patMarginSeries);
  put('net_profit', npSeries); put('operating_profit', opSeries); put('eps', epsSeries); put('tax_rate', taxSeries);
  put('roce', roceSeries); put('roe', roeCalcSeries);
  put('debtor_days', debtorSeries); put('inventory_days', inventorySeries); put('ccc', cccSeries);
  put('payable_days', payableSeries); put('wc_days', wcSeries);
  put('debt_equity', deSeries); put('total_debt', borrowSeries); put('net_worth', netWorthSeries);
  put('total_assets', totalAssetsSeries); put('fixed_assets', fixedAssetsSeries); put('cwip', cwipSeries);
  put('cfo', cfoSeries); put('fcf', fcfSeries); put('cfo_op', cfoOpSeries); put('investing_cf', investSeries);
  put('promoter_holding', promoterSeries); put('fii_holding', fiiSeries); put('dii_holding', diiSeries);
  put('public_holding', publicSeries); put('pledge_pct', pledgeSeries); put('num_shareholders', shCountSeries);
  put('dividend_payout', divPayoutSeries);

  const listed = current.market_cap != null || ribbon(top, /current price/) != null;
  return { name, listed, current, series, industryHref: industryHref($), ...profile($) };
}

function lastNum(arr) { for (let i = arr.length - 1; i >= 0; i--) if (typeof arr[i] === 'number' && isFinite(arr[i])) return arr[i]; return null; }
function pctChange(arr) {
  const v = arr.filter((x) => typeof x === 'number' && isFinite(x));
  if (v.length < 2) return null;
  const a = v[v.length - 2], b = v[v.length - 1];
  return (a && a !== 0) ? +(((b - a) / Math.abs(a)) * 100).toFixed(1) : null;
}

/** Citeable Screener source for a peer. */
export function screenerSource(code) {
  return { label: 'Screener', url: `${BASE}/company/${encodeURIComponent(code)}/` };
}
