/**
 * lib/global.mjs — best-effort financials for GLOBAL (non-India) listed peers.
 *
 * Resolves a company name to a ticker via Yahoo Finance search, then pulls core
 * fundamentals from quoteSummary. Revenue + market cap are converted to ₹ Crore
 * (rough fixed FX) so they sit on the same axis as the Indian peers. Everything
 * is continue-on-error: any failure returns blanks, so a peer we can't enrich
 * still appears (name/country/model only) — exactly what the contract allows.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// Rough currency → INR (only to place global peers on the ₹ Cr axis; exact FX is
// not the point — relative scale is). 1 crore = 1e7.
const FX = { USD: 83, EUR: 90, GBP: 105, JPY: 0.56, CNY: 11.5, INR: 1, AUD: 55, CAD: 61, CHF: 94, HKD: 10.6, SGD: 62, KRW: 0.062, SEK: 8, NZD: 51, TWD: 2.6, THB: 2.4, IDR: 0.0053 };

async function jget(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) { return null; }
}

async function resolveSymbol(name) {
  const d = await jget(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=6&newsCount=0`);
  const quotes = (d && Array.isArray(d.quotes)) ? d.quotes : [];
  const eq = quotes.find((q) => q && q.quoteType === 'EQUITY' && q.symbol) || quotes.find((q) => q && q.symbol);
  return eq ? { symbol: eq.symbol, exch: eq.exchDisp || '', name: eq.shortname || eq.longname || name } : null;
}

async function summary(symbol) {
  const mods = 'financialData,summaryDetail,defaultKeyStatistics,price,incomeStatementHistory';
  for (const host of ['query1', 'query2']) {
    const d = await jget(`https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${mods}`);
    const r = d && d.quoteSummary && Array.isArray(d.quoteSummary.result) && d.quoteSummary.result[0];
    if (r) return r;
  }
  return null;
}

const val = (o) => (o && typeof o.raw === 'number' && isFinite(o.raw)) ? o.raw : null;
const pct = (o) => { const v = val(o); return v == null ? null : +(v * 100).toFixed(1); };
function toRsCr(v, currency) {
  if (v == null) return null;
  const fx = FX[currency] || FX.USD;
  return Math.round((v * fx) / 1e7);
}

/**
 * Fetch core metrics for a global peer. Returns { current, source, ticker } —
 * `current` holds only the keys we could resolve (rest stay absent → "—").
 */
export async function fetchGlobalPeer(name) {
  const found = await resolveSymbol(name);
  if (!found) return { current: {}, source: { label: 'not found', url: '' }, ticker: null };
  const r = await summary(found.symbol);
  if (!r) return { current: {}, source: { label: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${found.symbol}` }, ticker: found.symbol };

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
  // drop nulls so the contract's "absent = —" holds
  for (const k of Object.keys(current)) if (current[k] == null) delete current[k];

  return { current, source: { label: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${found.symbol}` }, ticker: found.symbol };
}
