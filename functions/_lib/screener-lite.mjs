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

async function materialCost(companyId) {
  const id = String(companyId == null ? '' : companyId).trim();
  if (!id) return null;
  const data = await getJson(`${BASE}/api/company/${encodeURIComponent(id)}/schedules/?parent=Expenses&section=profit-loss`);
  if (!data || typeof data !== 'object') return null;
  const row = data['Material Cost %'] || data['Raw Material Cost %'];
  if (!row || typeof row !== 'object') return null;
  const entries = Object.entries(row).filter(([k]) => /\d{4}/.test(k)).sort((a, b) => yr(a[0]) - yr(b[0]));
  const rm = lastNum(entries.map(([, v]) => num(v)));
  if (rm == null) return null;
  return { rm_cost_pct: rm, gross_margin: +(100 - rm).toFixed(1) };
}
function yr(s) { const m = /(\d{4})/.exec(String(s)); return m ? +m[1] : 0; }

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

  const html = await getText(`${BASE}/company/${encodeURIComponent(hit.code)}/consolidated/`)
    || await getText(`${BASE}/company/${encodeURIComponent(hit.code)}/`);
  if (!html) return { error: `Could not load Screener page for ${hit.name}.` };

  const pl = sectionTable(html, 'profit-loss');
  const ratios = sectionTable(html, 'ratios');
  const bs = sectionTable(html, 'balance-sheet');
  const sh = sectionTable(html, 'shareholding');
  const top = topRatios(html);

  const salesSeries = pl && seriesOf(pl, /^sales|^revenue|^total revenue/i);
  const opmSeries = pl && seriesOf(pl, /^opm ?%/i);
  const npSeries = pl && seriesOf(pl, /^net profit/i);
  const roceSeries = ratios && seriesOf(ratios, /roce/i);
  const roeSeries = ratios && seriesOf(ratios, /return on equity|^roe/i);
  const debtorSeries = ratios && seriesOf(ratios, /debtor days/i);
  const inventorySeries = ratios && seriesOf(ratios, /inventory days/i);
  const cccSeries = ratios && seriesOf(ratios, /cash conversion/i);
  const promoterSeries = sh && seriesOf(sh, /promoter/i);

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

  let debtEquity = null;
  if (bs) {
    const borrow = latest(bs, /^borrowings/i), eq = latest(bs, /equity capital|share capital/i), res = latest(bs, /^reserves/i);
    const nw = (eq || 0) + (res || 0);
    if (borrow != null && nw > 0) debtEquity = +(borrow / nw).toFixed(2);
  }
  let interestCov = null;
  if (pl) {
    const op = latest(pl, /operating profit/i), interest = latest(pl, /^interest/i);
    if (op != null && interest && interest > 0) interestCov = +(op / interest).toFixed(1);
  }
  let pb = ribbon(top, /price to book|p\/b/);
  if (pb == null) { const price = ribbon(top, /current price/), bv = ribbon(top, /book value/); if (price != null && bv && bv > 0) pb = +(price / bv).toFixed(1); }

  const current = {
    revenue: salesLatest,
    rev_growth_1y: salesSeries ? pctChange(salesSeries.values) : null,
    rev_cagr_3y: cagr(salesSeries, 3),
    rev_cagr_5y: cagr(salesSeries, 5),
    market_cap: ribbon(top, /market cap/),
    gross_margin: null,
    ebitda_margin: opmSeries ? lastNum(opmSeries.values) : ribbon(top, /opm/),
    pat_margin: (salesLatest && npLatest != null && salesLatest > 0) ? +((npLatest / salesLatest) * 100).toFixed(1) : null,
    rm_cost_pct: null,
    roce: ribbon(top, /roce/) ?? (roceSeries ? lastNum(roceSeries.values) : null),
    roe: ribbon(top, /roe|return on equity/) ?? (roeSeries ? lastNum(roeSeries.values) : null),
    debtor_days: debtorSeries ? lastNum(debtorSeries.values) : null,
    inventory_days: inventorySeries ? lastNum(inventorySeries.values) : null,
    payable_days: ratios ? latest(ratios, /days payable|payable days/i) : null,
    ccc: cccSeries ? lastNum(cccSeries.values) : (ratios ? latest(ratios, /cash conversion/i) : null),
    wc_days: ratios ? latest(ratios, /working capital days/i) : null,
    debt_equity: debtEquity ?? ribbon(top, /debt to equity/),
    interest_coverage: interestCov,
    promoter_holding: promoterSeries ? lastNum(promoterSeries.values) : (sh ? latest(sh, /promoter/i) : null),
    pledge_pct: sh ? latest(sh, /pledge/i) : null,
    fii_holding: sh ? latest(sh, /fiis?|foreign/i) : null,
    dii_holding: sh ? latest(sh, /diis?|domestic/i) : null,
    pe: ribbon(top, /stock p\/e|^p\/e|price to earning/),
    pb,
    dividend_yield: ribbon(top, /dividend yield/),
    dividend_payout: pl ? latest(pl, /dividend payout/i) : null,
  };

  // Raw-material % / gross margin from the expenses schedule JSON (best-effort).
  const mc = await materialCost(hit.id).catch(() => null);
  if (mc) { current.rm_cost_pct = mc.rm_cost_pct; current.gross_margin = mc.gross_margin; }

  const series = {};
  const put = (k, s) => { if (s && s.years && s.years.length) series[k] = s; };
  put('revenue', salesSeries); put('ebitda_margin', opmSeries); put('pat_margin', patMarginSeries);
  put('roce', roceSeries); put('roe', roeSeries); put('debtor_days', debtorSeries);
  put('inventory_days', inventorySeries); put('ccc', cccSeries); put('promoter_holding', promoterSeries);

  const listed = current.market_cap != null || ribbon(top, /current price/) != null;
  if (!listed && Object.keys(series).length === 0) return { error: `${hit.name} resolved but no financials could be read.` };

  return {
    name: hit.name,
    ticker: hit.code,
    added_by: 'user',
    business_model: '',
    products: '',
    note: '',
    source: { label: 'Screener', url: `${BASE}/company/${encodeURIComponent(hit.code)}/` },
    current,
    series,
  };
}
