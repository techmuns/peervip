// functions/_lib/screener-lite.mjs — dependency-free single-company Screener
// fetch for the on-demand "Add peer" endpoint. NO cheerio (Pages Functions have
// no npm build step here), so the HTML is parsed with tolerant string/regex ops.
// Runs unchanged in a Cloudflare Pages Function AND in Node (for local testing).
// Mirrors lib/screener.mjs mapCompany's metric mapping; every field is best-effort
// and stays null when absent (never fabricated).

const BASE = 'https://www.screener.in';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(600 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest', Referer: BASE + '/' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) { if (res.status === 429 || res.status >= 500) continue; return null; }
      return await res.json();
    } catch (_) { /* retry */ }
  }
  return null;
}
async function getText(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(600 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*', Referer: BASE + '/' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) { if (res.status === 429 || res.status >= 500) continue; return null; }
      return await res.text();
    } catch (_) { /* retry */ }
  }
  return null;
}

/* ---------------------------------------------------------------- parsing */
function stripTags(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&rsquo;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ').trim();
}
function num(v) {
  if (v == null) return null;
  let s = String(v).replace(/,/g, '').replace(/[₹%]/g, '').trim();
  if (!s || /^(-|—|na|n\/a)$/i.test(s)) return null;
  s = s.replace(/\b(crs?|crores?|rs|inr|x|days?)\b/gi, '').trim();
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function lastNum(arr) { for (let i = arr.length - 1; i >= 0; i--) if (typeof arr[i] === 'number' && isFinite(arr[i])) return arr[i]; return null; }
function pctChange(arr) {
  const v = arr.filter((x) => typeof x === 'number' && isFinite(x));
  if (v.length < 2) return null;
  const a = v[v.length - 2], b = v[v.length - 1];
  return (a && a !== 0) ? +(((b - a) / Math.abs(a)) * 100).toFixed(1) : null;
}
function cagr(series, yrs) {
  if (!series || !series.values) return null;
  const v = series.values.filter((x) => typeof x === 'number' && isFinite(x));
  if (v.length < yrs + 1) return null;
  const end = v[v.length - 1], start = v[v.length - 1 - yrs];
  if (!start || start <= 0 || !end || end <= 0) return null;
  return +(((end / start) ** (1 / yrs) - 1) * 100).toFixed(1);
}

// One Screener section's <table> → { periods:[], rows:[{label, values:[]}] }.
function sectionTable(html, id) {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return null;
  const tStart = html.indexOf('<table', i);
  if (tStart < 0) return null;
  const tEnd = html.indexOf('</table>', tStart);
  if (tEnd < 0) return null;
  const table = html.slice(tStart, tEnd + 8);
  const heads = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1]));
  const rows = [];
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
    if (tds.length) rows.push({ label: tds[0], values: tds.slice(1) });
  }
  return { periods: heads.slice(1), rows };
}
// The pre-rendered YEARLY shareholding table (<div id="yearly-shp">) — annual
// snapshots (Mar 2017 … Mar 2026) rather than the last ~12 quarters. Same shape
// as sectionTable so seriesOf/latest work unchanged.
function yearlyShpTable(html) {
  const i = String(html).indexOf('<div id="yearly-shp"');
  if (i < 0) return null;
  const tStart = html.indexOf('<table', i);
  if (tStart < 0) return null;
  const tEnd = html.indexOf('</table>', tStart);
  if (tEnd < 0) return null;
  const table = html.slice(tStart, tEnd + 8);
  const heads = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1]));
  const rows = [];
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
    if (tds.length) rows.push({ label: tds[0], values: tds.slice(1) });
  }
  return { periods: heads.slice(1), rows };
}
// Keep one point per fiscal year (drops a trailing latest-quarter column).
function annualize(s) {
  if (!s || !s.years) return null;
  const years = [], values = [], seen = new Set();
  s.years.forEach((y, i) => {
    const k = (String(y).match(/(\d{4})/) || [])[1];
    if (!k || seen.has(k)) return;
    seen.add(k); years.push(y); values.push(s.values[i]);
  });
  return years.length ? { years, values } : null;
}
function findRow(section, re) { return section && section.rows.find((r) => re.test(r.label)); }
function latest(section, re) {
  const row = findRow(section, re);
  if (!row) return null;
  for (let i = row.values.length - 1; i >= 0; i--) {
    if (/ttm/i.test(section.periods[i] || '')) continue;
    const n = num(row.values[i]);
    if (n != null) return n;
  }
  return null;
}
function seriesOf(section, re) {
  const row = findRow(section, re);
  if (!row) return null;
  const years = [], values = [];
  section.periods.forEach((p, i) => { if (/ttm/i.test(p)) return; years.push(p); values.push(num(row.values[i])); });
  if (!years.length || values.every((v) => v == null)) return null;
  return { years, values };
}

// #top-ratios ribbon → { "market cap": "1,415 Cr.", ... }. Strips inner tags per <li>.
function topRatios(html) {
  const i = html.indexOf('id="top-ratios"');
  if (i < 0) return {};
  const end = html.indexOf('</ul>', i);
  const block = html.slice(i, end < 0 ? i + 6000 : end);
  const map = {};
  for (const li of block.match(/<li[\s\S]*?<\/li>/gi) || []) {
    const name = stripTags((li.match(/class="name"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '');
    if (!name) continue;
    const whole = stripTags(li);
    const val = whole.toLowerCase().startsWith(name.toLowerCase()) ? whole.slice(name.length).trim() : whole;
    map[name.toLowerCase()] = val;
  }
  return map;
}
function ribbon(map, re) { for (const k of Object.keys(map)) if (re.test(k)) return num(map[k]); return null; }

// Expenses schedule JSON → per-component cost-% series {rm, mfg, emp, oth}.
async function costStructure(companyId) {
  const id = String(companyId == null ? '' : companyId).trim();
  if (!id) return null;
  const data = await getJson(`${BASE}/api/company/${encodeURIComponent(id)}/schedules/?parent=Expenses&section=profit-loss`);
  if (!data || typeof data !== 'object') return null;
  const seriesFrom = (names) => {
    let row = null;
    for (const n of names) if (data[n] && typeof data[n] === 'object') { row = data[n]; break; }
    if (!row) return null;
    const entries = Object.entries(row).filter(([k]) => /\d{4}/.test(k) && !/ttm/i.test(k)).sort((a, b) => yr(a[0]) - yr(b[0]));
    if (!entries.length) return null;
    const years = entries.map(([k]) => k);
    const values = entries.map(([, v]) => num(v));
    return values.some((v) => v != null) ? { years, values } : null;
  };
  return {
    rm: seriesFrom(['Material Cost %', 'Raw Material Cost %']),
    mfg: seriesFrom(['Manufacturing Cost %']),
    emp: seriesFrom(['Employee Cost %']),
    oth: seriesFrom(['Other Cost %']),
  };
}
function yr(s) { const m = /(\d{4})/.exec(String(s)); return m ? +m[1] : 0; }
function isNum(v) { return typeof v === 'number' && isFinite(v); }

// Map a series element-wise into a new series (null when nothing survives).
function mapSeries(s, fn) {
  if (!s || !s.values) return null;
  const values = s.values.map(fn);
  return values.some((v) => v != null) ? { years: s.years, values } : null;
}
// Combine two aligned-by-year-label series (b matched to a's year labels).
function combineSeries(a, b, fn) {
  if (!a || !a.values) return null;
  const values = a.years.map((y, i) => { const j = b ? b.years.indexOf(y) : -1; return fn(a.values[i], j >= 0 ? b.values[j] : null); });
  return values.some((v) => v != null) ? { years: a.years, values } : null;
}
function avgLastN(s, n) {
  if (!s || !s.values) return null;
  const v = s.values.filter(isNum).slice(-n);
  return v.length ? +(v.reduce((x, y) => x + y, 0) / v.length).toFixed(1) : null;
}
// A small "N Years : value" ranges table (Stock Price CAGR etc.) → { "1 year:": 3, ... }.
function rangesByTitle(html, re) {
  for (const tbl of String(html).match(/<table[\s\S]*?<\/table>/gi) || []) {
    if (!re.test(stripTags(tbl))) continue;
    const map = {};
    for (const tr of tbl.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
      if (cells.length >= 2 && /\d/.test(cells[0])) map[cells[0].toLowerCase()] = num(cells[1]);
    }
    if (Object.keys(map).length) return map;
  }
  return {};
}
function pickKey(map, re) { for (const k of Object.keys(map)) if (re.test(k)) return map[k]; return null; }

// How many fiscal-year columns a page's P&L carries (excludes TTM) — a proxy for
// how much annual history an accounting basis has, used to pick the richer page.
function plYearSpan(html) {
  const pl = sectionTable(html, 'profit-loss');
  if (!pl) return 0;
  return pl.periods.filter((p) => /\d{4}/.test(p) && !/ttm/i.test(p)).length;
}

/* -------------------------------------------------------------- resolve + map */
const normName = (s) => String(s || '').toLowerCase().replace(/\b(ltd|limited|industries|india|the|inc|plc|corp|company|co)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function resolveCode(name) {
  const data = await getJson(`${BASE}/api/company/search/?q=${encodeURIComponent(String(name || '').trim())}&v=3&fts=1`);
  const rows = Array.isArray(data) ? data : [];
  const cands = [];
  for (const r of rows) {
    const m = String(r && r.url || '').match(/\/company\/([^/]+)\/(consolidated\/?)?/i);
    if (m && m[1] && m[1].toLowerCase() !== 'id' && r.name && r.id != null) {
      cands.push({ code: decodeURIComponent(m[1]), id: r.id, name: String(r.name).trim(), consolidated: !!m[2] });
    }
  }
  if (!cands.length) return null;
  const want = normName(name);
  let best = cands[0], bestScore = -1;
  for (const c of cands) {
    const rn = normName(c.name);
    let score = 0;
    if (rn === want) score = 100;
    else if (rn.startsWith(want) || want.startsWith(rn)) score = 70;
    else if (rn.includes(want) || want.includes(rn)) score = 40;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/** Fetch one listed company by name → PeerVIP peer shape, or { error }. */
export async function fetchPeer(name) {
  const q = String(name || '').trim();
  if (!q) return { error: 'name required' };
  const hit = await resolveCode(q);
  if (!hit) return { error: `No listed company found on Screener for "${q}".` };

  // Screener reports on two accounting bases: CONSOLIDATED (whole group, incl.
  // subsidiaries) and STANDALONE (parent only). Consolidated is normally the
  // better view — but a company that only STARTED consolidating recently (e.g.
  // E2E Networks, which got a subsidiary in FY26) has just 1–2 years on its
  // /consolidated/ page while its full 2015+ history lives on standalone.
  // Fetching consolidated-first and using it blindly truncated EVERY trend for
  // such peers to that stub. Fix: fetch BOTH, then keep the basis whose P&L has
  // more fiscal years (tie → consolidated, the richer basis), so each trend goes
  // back as far as Screener actually has data — one consistent basis, never mixed.
  const consUrl = `${BASE}/company/${encodeURIComponent(hit.code)}/consolidated/`;
  const stdUrl = `${BASE}/company/${encodeURIComponent(hit.code)}/`;
  const consHtml = await getText(consUrl);
  const stdHtml = await getText(stdUrl);
  let html, basis, sourceUrl;
  if (consHtml && stdHtml) {
    const useStd = plYearSpan(stdHtml) > plYearSpan(consHtml);
    html = useStd ? stdHtml : consHtml;
    basis = useStd ? 'standalone' : 'consolidated';
    sourceUrl = useStd ? stdUrl : consUrl;
  } else {
    html = consHtml || stdHtml;
    basis = consHtml ? 'consolidated' : 'standalone';
    sourceUrl = consHtml ? consUrl : stdUrl;
  }
  if (!html) return { error: `Could not load Screener page for ${hit.name}.` };

  const pl = sectionTable(html, 'profit-loss');
  const ratios = sectionTable(html, 'ratios');
  const bs = sectionTable(html, 'balance-sheet');
  const cf = sectionTable(html, 'cash-flow');
  const sh = sectionTable(html, 'shareholding');
  const top = topRatios(html);

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
  // ROE isn't in the anonymous ratios table — synthesize from net profit ÷ net worth.
  const roeCalcSeries = roeSeries || combineSeries(npSeries, netWorthSeries, (np, nw) => (isNum(np) && isNum(nw) && nw > 0) ? +((np / nw) * 100).toFixed(1) : null);
  // ---- Cash flow ----
  const cfoSeries = cf && seriesOf(cf, /cash from operating/i);
  const investSeries = cf && seriesOf(cf, /cash from investing/i);
  const fcfSeries = (cf && seriesOf(cf, /free cash flow/i)) || combineSeries(cfoSeries, investSeries, (c, i) => (isNum(c) && isNum(i)) ? +(c + i).toFixed(0) : null);
  const cfoOpSeries = combineSeries(cfoSeries, opSeries, (c, o) => (isNum(c) && isNum(o) && o !== 0) ? +((c / o) * 100).toFixed(1) : null);
  // ---- Shareholding (YEARLY snapshots for trends; quarterly for pledge/current) ----
  const shy = yearlyShpTable(html) || sh;
  const promoterSeries = annualize(seriesOf(shy, /promoter/i));
  const fiiSeries = annualize(seriesOf(shy, /fiis?|foreign/i));
  const diiSeries = annualize(seriesOf(shy, /diis?|domestic/i));
  const publicSeries = annualize(seriesOf(shy, /^public/i));
  const pledgeSeries = sh && seriesOf(sh, /pledge/i);
  const shCountSeries = annualize(seriesOf(shy, /shareholders/i));

  let patMarginSeries = null;
  if (salesSeries && npSeries) {
    const values = salesSeries.years.map((y, i) => {
      const s = salesSeries.values[i], np = npSeries.values[i];
      return (typeof s === 'number' && s > 0 && typeof np === 'number') ? +((np / s) * 100).toFixed(1) : null;
    });
    if (values.some((v) => v != null)) patMarginSeries = { years: salesSeries.years, values };
  }

  // Cost structure (raw-material / mfg / employee / other %) from the expenses schedule.
  const cs = await costStructure(hit.id).catch(() => null);
  const rmSeries = cs && cs.rm;
  const grossSeries = mapSeries(rmSeries, (r) => isNum(r) ? +(100 - r).toFixed(1) : null);
  const mfgSeries = cs && cs.mfg, empSeries = cs && cs.emp, othSeries = cs && cs.oth;

  const salesLatest = pl && latest(pl, /^sales|^revenue|^total revenue/i);
  const npLatest = pl && latest(pl, /^net profit/i);

  let interestCov = null;
  if (pl) {
    const op = latest(pl, /operating profit/i), interest = latest(pl, /^interest/i);
    if (op != null && interest && interest > 0) interestCov = +(op / interest).toFixed(1);
  }
  let pb = ribbon(top, /price to book|p\/b/);
  if (pb == null) { const price = ribbon(top, /current price/), bv = ribbon(top, /book value/); if (price != null && bv && bv > 0) pb = +(price / bv).toFixed(1); }
  const priceCagr = rangesByTitle(html, /stock price cagr/i);
  const roeRanges = rangesByTitle(html, /return on equity/i);

  const lastOf = (s) => (s ? lastNum(s.values) : null);
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
    gross_margin: lastOf(grossSeries),
    ebitda_margin: opmSeries ? lastNum(opmSeries.values) : ribbon(top, /opm/),
    pat_margin: (salesLatest && npLatest != null && salesLatest > 0) ? +((npLatest / salesLatest) * 100).toFixed(1) : null,
    rm_cost_pct: lastOf(rmSeries),
    manufacturing_cost_pct: lastOf(mfgSeries),
    employee_cost_pct: lastOf(empSeries),
    other_cost_pct: lastOf(othSeries),
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
    promoter_holding: (sh ? latest(sh, /promoter/i) : null) ?? lastOf(promoterSeries),
    pledge_pct: lastOf(pledgeSeries) ?? (sh ? latest(sh, /pledge/i) : null),
    fii_holding: (sh ? latest(sh, /fiis?|foreign/i) : null) ?? lastOf(fiiSeries),
    dii_holding: (sh ? latest(sh, /diis?|domestic/i) : null) ?? lastOf(diiSeries),
    public_holding: (sh ? latest(sh, /^public/i) : null) ?? lastOf(publicSeries),
    num_shareholders: (sh ? latest(sh, /shareholders/i) : null) ?? lastOf(shCountSeries),
    pe: ribbon(top, /stock p\/e|^p\/e|price to earning/),
    pb,
    dividend_yield: ribbon(top, /dividend yield/),
    dividend_payout: lastOf(divPayoutSeries) ?? (pl ? latest(pl, /dividend payout/i) : null),
  };

  const series = {};
  const put = (k, s) => { if (s && s.years && s.years.length) series[k] = s; };
  put('revenue', salesSeries); put('ebitda_margin', opmSeries); put('pat_margin', patMarginSeries);
  put('net_profit', npSeries); put('operating_profit', opSeries); put('eps', epsSeries); put('tax_rate', taxSeries);
  put('gross_margin', grossSeries); put('rm_cost_pct', rmSeries);
  put('manufacturing_cost_pct', mfgSeries); put('employee_cost_pct', empSeries); put('other_cost_pct', othSeries);
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
  if (!listed && Object.keys(series).length === 0) return { error: `${hit.name} resolved but no financials could be read.` };

  return {
    name: hit.name,
    ticker: hit.code,
    added_by: 'user',
    business_model: '',
    products: '',
    note: '',
    basis, // 'consolidated' | 'standalone' — which Screener basis the trends came from
    source: { label: 'Screener', url: sourceUrl },
    current,
    series,
  };
}
