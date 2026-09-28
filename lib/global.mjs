/**
 * lib/global.mjs — best-effort financials for GLOBAL (non-India) listed peers.
 *
 * Yahoo Finance is the primary source, using the cookie + crumb handshake bare
 * Yahoo now requires (a plain quoteSummary 401s). Revenue + market cap are
 * converted to ₹ Crore (rough fixed FX) so global peers sit on the same axis as
 * the Indian ones. Continue-on-error throughout: any failure returns blanks, so
 * a peer we can't enrich still appears (name/country/model only).
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FX = { USD: 83, EUR: 90, GBP: 105, JPY: 0.56, CNY: 11.5, INR: 1, AUD: 55, CAD: 61, CHF: 94, HKD: 10.6, SGD: 62, KRW: 0.062, SEK: 8, NZD: 51, TWD: 2.6, THB: 2.4, IDR: 0.0053, BRL: 16, ZAR: 4.5, MXN: 4.8 };

async function raw(url, cookie) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,*/*', ...(cookie ? { Cookie: cookie } : {}) }, signal: AbortSignal.timeout(20000) });
    return res;
  } catch (_) { return null; }
}
async function jget(url, cookie) {
  const res = await raw(url, cookie);
  if (!res || !res.ok) return null;
  try { return await res.json(); } catch (_) { return null; }
}
function collectCookies(res) {
  const list = res && typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

// One cookie+crumb per run, cached.
let _auth = null;
async function yahooAuth() {
  if (_auth) return _auth;
  _auth = (async () => {
    let cookie = '';
    // fc.yahoo.com 404s but sets the A3 cookie the crumb endpoint needs (the
    // A1 cookie on finance.yahoo.com is set on a redirect hop fetch() can't read).
    const seed = await raw('https://fc.yahoo.com/', '');
    if (seed) cookie = collectCookies(seed);
    let crumb = '';
    const cr = await raw('https://query2.finance.yahoo.com/v1/test/getcrumb', cookie);
    if (cr && cr.ok) { crumb = (await cr.text()).trim(); const more = collectCookies(cr); if (more) cookie = [cookie, more].filter(Boolean).join('; '); }
    return { cookie, crumb };
  })().catch(() => ({ cookie: '', crumb: '' }));
  return _auth;
}

async function resolveSymbol(name) {
  const { cookie } = await yahooAuth();
  const d = await jget(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=6&newsCount=0`, cookie);
  const quotes = (d && Array.isArray(d.quotes)) ? d.quotes : [];
  const eq = quotes.find((q) => q && q.quoteType === 'EQUITY' && q.symbol) || quotes.find((q) => q && q.symbol);
  return eq ? { symbol: eq.symbol, name: eq.shortname || eq.longname || name } : null;
}

async function summary(symbol) {
  const { cookie, crumb } = await yahooAuth();
  const mods = 'financialData,summaryDetail,defaultKeyStatistics,price,incomeStatementHistory';
  const c = crumb ? `&crumb=${encodeURIComponent(crumb)}` : '';
  for (const host of ['query1', 'query2']) {
    const d = await jget(`https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${mods}${c}`, cookie);
    const r = d && d.quoteSummary && Array.isArray(d.quoteSummary.result) && d.quoteSummary.result[0];
    if (r) return r;
  }
  return null;
}

const val = (o) => (o && typeof o.raw === 'number' && isFinite(o.raw)) ? o.raw : null;
const pct = (o) => { const v = val(o); return v == null ? null : +(v * 100).toFixed(1); };
function toRsCr(v, ccy) { if (v == null) return null; return Math.round((v * (FX[ccy] || FX.USD)) / 1e7); }

/**
 * Fetch core metrics for a global peer by name. Returns { current, series,
 * source, ticker, country } — `current`/`series` hold only resolved keys.
 */
export async function fetchGlobalPeer(name) {
  const found = await resolveSymbol(name);
  if (!found) return { current: {}, series: {}, source: { label: 'not found', url: '' }, ticker: null };
  const r = await summary(found.symbol);
  const src = { label: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${found.symbol}` };
  if (!r) return { current: {}, series: {}, source: src, ticker: found.symbol };

  const fin = r.financialData || {};
  const sd = r.summaryDetail || {};
  const ks = r.defaultKeyStatistics || {};
  const price = r.price || {};
  const ccy = price.currency || sd.currency || 'USD';

  const current = {
    revenue: toRsCr(val(fin.totalRevenue), ccy),
    rev_growth_1y: pct(fin.revenueGrowth),
    market_cap: toRsCr(val(price.marketCap) ?? val(sd.marketCap), ccy),
    gross_margin: pct(fin.grossMargins),
    ebitda_margin: pct(fin.ebitdaMargins),
    pat_margin: pct(fin.profitMargins),
    roe: pct(fin.returnOnEquity),
    debt_equity: val(fin.debtToEquity) != null ? +(val(fin.debtToEquity) / 100).toFixed(2) : null,
    pe: val(sd.trailingPE) ?? val(ks.forwardPE),
    pb: val(ks.priceToBook),
    dividend_yield: pct(sd.dividendYield),
  };
  for (const k of Object.keys(current)) if (current[k] == null) delete current[k];

  // revenue series from annual income statements (oldest -> newest), in ₹ Cr
  const series = {};
  const hist = r.incomeStatementHistory && Array.isArray(r.incomeStatementHistory.incomeStatementHistory) ? r.incomeStatementHistory.incomeStatementHistory : [];
  if (hist.length) {
    const rows = hist.map((h) => ({ y: (h.endDate && h.endDate.fmt) ? String(h.endDate.fmt).slice(0, 4) : '', rev: toRsCr(val(h.totalRevenue), ccy) })).filter((x) => x.y).reverse();
    if (rows.some((x) => x.rev != null)) series.revenue = { years: rows.map((x) => x.y), values: rows.map((x) => x.rev) };
  }

  return { current, series, source: src, ticker: found.symbol, country: '' };
}
