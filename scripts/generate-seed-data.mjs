// Deterministic seed-data generator for PeerVIP Step 1.
// Produces public/data/index.json and public/data/reports/<slug>.json
// Figures are realistic/representative SAMPLE data (sample:true).
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve(process.argv[2] || 'public/data');
const REPORTS_DIR = path.join(OUT_DIR, 'reports');
fs.mkdirSync(REPORTS_DIR, { recursive: true });

// ---- Deterministic PRNG so regenerating gives identical output ----
function rng(seedStr) {
  let s = 2166136261 >>> 0;
  for (const c of String(seedStr)) { s ^= c.charCodeAt(0); s = Math.imul(s, 16777619) >>> 0; }
  return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
function roundTo(v, step) {
  if (step >= 1) return Math.round(v / step) * step;
  const p = Math.round(1 / step);
  return Math.round(v * p) / p;
}
// Build a plausible year-by-year series that lands exactly on endVal at the last year.
// startFactor > 1 means the metric was higher in the past (improving = decreasing, e.g. WC days).
function series(years, endVal, { startFactor = 0.6, jitter = 0.05, startIdx = 0, round = 0.1, floor = null, seed = 'x' } = {}) {
  const rnd = rng(seed + endVal);
  const n = years.length;
  const startVal = endVal * startFactor;
  const values = [];
  for (let i = 0; i < n; i++) {
    if (i < startIdx) { values.push(null); continue; }
    const span = (n - 1 - startIdx) || 1;
    const t = (i - startIdx) / span;
    let base = startVal + (endVal - startVal) * t;
    base += (rnd() * 2 - 1) * jitter * Math.abs(base || 1);
    let v = i === n - 1 ? endVal : base;
    if (floor != null) v = Math.max(floor, v);
    values.push(roundTo(v, round));
  }
  return { years: years.slice(), values };
}

// Series shape per metric: how it typically trends toward the current value.
const SERIES_SHAPE = {
  revenue:         { startFactor: 0.45, jitter: 0.05, round: 1 },
  ebitda_margin:   { startFactor: 0.82, jitter: 0.06, round: 0.1 },
  pat_margin:      { startFactor: 0.75, jitter: 0.08, round: 0.1 },
  roce:            { startFactor: 0.80, jitter: 0.07, round: 0.1 },
  roe:             { startFactor: 0.82, jitter: 0.07, round: 0.1 },
  debtor_days:     { startFactor: 1.18, jitter: 0.05, round: 1, floor: 1 },
  inventory_days:  { startFactor: 1.15, jitter: 0.05, round: 1, floor: 1 },
  ccc:             { startFactor: 1.22, jitter: 0.05, round: 1, floor: 1 },
  promoter_holding:{ startFactor: 1.00, jitter: 0.012, round: 0.1 },
};
const SERIES_METRICS = Object.keys(SERIES_SHAPE);

function buildSeries(company, years, current, startIdx = 0, only = SERIES_METRICS) {
  const out = {};
  for (const key of only) {
    if (current[key] == null) continue;
    out[key] = series(years, current[key], { ...SERIES_SHAPE[key], startIdx, seed: company + key });
  }
  return out;
}

// ---- The metric dictionary (identical in every report; matches the contract) ----
const METRICS = [
  { key: 'revenue', label: 'Revenue', unit: 'Rs Cr', group: 'Size & Growth', better: 'high', format: 'num0' },
  { key: 'rev_growth_1y', label: 'Rev growth (1Y)', unit: '%', group: 'Size & Growth', better: 'high', format: 'pct1' },
  { key: 'rev_cagr_3y', label: 'Rev CAGR (3Y)', unit: '%', group: 'Size & Growth', better: 'high', format: 'pct1' },
  { key: 'rev_cagr_5y', label: 'Rev CAGR (5Y)', unit: '%', group: 'Size & Growth', better: 'high', format: 'pct1' },
  { key: 'market_cap', label: 'Market cap', unit: 'Rs Cr', group: 'Size & Growth', better: 'neutral', format: 'num0' },
  { key: 'gross_margin', label: 'Gross margin', unit: '%', group: 'Profitability', better: 'high', format: 'pct1' },
  { key: 'ebitda_margin', label: 'EBITDA margin', unit: '%', group: 'Profitability', better: 'high', format: 'pct1' },
  { key: 'pat_margin', label: 'PAT margin', unit: '%', group: 'Profitability', better: 'high', format: 'pct1' },
  { key: 'rm_cost_pct', label: 'Raw material % of sales', unit: '%', group: 'Profitability', better: 'low', format: 'pct1' },
  { key: 'roce', label: 'ROCE', unit: '%', group: 'Returns', better: 'high', format: 'pct1' },
  { key: 'roe', label: 'ROE', unit: '%', group: 'Returns', better: 'high', format: 'pct1' },
  { key: 'debtor_days', label: 'Debtor days', unit: 'days', group: 'Working Capital', better: 'low', format: 'num0' },
  { key: 'inventory_days', label: 'Inventory days', unit: 'days', group: 'Working Capital', better: 'low', format: 'num0' },
  { key: 'payable_days', label: 'Payable days', unit: 'days', group: 'Working Capital', better: 'high', format: 'num0' },
  { key: 'ccc', label: 'Cash conversion cycle', unit: 'days', group: 'Working Capital', better: 'low', format: 'num0' },
  { key: 'wc_days', label: 'Working capital days', unit: 'days', group: 'Working Capital', better: 'low', format: 'num0' },
  { key: 'debt_equity', label: 'Debt / Equity', unit: 'x', group: 'Balance Sheet', better: 'low', format: 'num2' },
  { key: 'interest_coverage', label: 'Interest coverage', unit: 'x', group: 'Balance Sheet', better: 'high', format: 'num1' },
  { key: 'promoter_holding', label: 'Promoter holding', unit: '%', group: 'Ownership', better: 'neutral', format: 'pct1' },
  { key: 'pledge_pct', label: 'Promoter pledge', unit: '%', group: 'Ownership', better: 'low', format: 'pct1' },
  { key: 'fii_holding', label: 'FII holding', unit: '%', group: 'Ownership', better: 'neutral', format: 'pct1' },
  { key: 'dii_holding', label: 'DII holding', unit: '%', group: 'Ownership', better: 'neutral', format: 'pct1' },
  { key: 'pe', label: 'P/E', unit: 'x', group: 'Valuation', better: 'neutral', format: 'num1' },
  { key: 'pb', label: 'P/B', unit: 'x', group: 'Valuation', better: 'neutral', format: 'num1' },
  { key: 'dividend_yield', label: 'Dividend yield', unit: '%', group: 'Valuation', better: 'neutral', format: 'pct1' },
  { key: 'dividend_payout', label: 'Dividend payout', unit: '%', group: 'Valuation', better: 'neutral', format: 'pct1' },
];

const YEARS = ['FY19', 'FY20', 'FY21', 'FY22', 'FY23', 'FY24', 'FY25'];

// =====================================================================
// LAMINATES
// =====================================================================
function laminatesReport() {
  const indianCurrent = {
    'Stylam Industries': { revenue: 1450, rev_growth_1y: 12.3, rev_cagr_3y: 18.0, rev_cagr_5y: 15.5, market_cap: 9000, gross_margin: 45.0, ebitda_margin: 23.5, pat_margin: 14.2, rm_cost_pct: 52.0, roce: 22.0, roe: 18.5, debtor_days: 70, inventory_days: 85, payable_days: 45, ccc: 110, wc_days: 95, debt_equity: 0.15, interest_coverage: 18.0, promoter_holding: 54.0, pledge_pct: 0.0, fii_holding: 6.5, dii_holding: 8.0, pe: 44.0, pb: 7.5, dividend_yield: 0.2, dividend_payout: 8.0 },
    'Greenlam Industries': { revenue: 2400, rev_growth_1y: 15.0, rev_cagr_3y: 16.0, rev_cagr_5y: 12.0, market_cap: 7000, gross_margin: 42.0, ebitda_margin: 12.5, pat_margin: 5.5, rm_cost_pct: 55.0, roce: 13.5, roe: 12.0, debtor_days: 55, inventory_days: 80, payable_days: 50, ccc: 85, wc_days: 78, debt_equity: 0.65, interest_coverage: 6.5, promoter_holding: 51.0, pledge_pct: 0.0, fii_holding: 12.0, dii_holding: 10.0, pe: 55.0, pb: 6.0, dividend_yield: 0.1, dividend_payout: 5.0 },
    'Greenpanel Industries': { revenue: 1600, rev_growth_1y: -5.0, rev_cagr_3y: 8.0, rev_cagr_5y: 10.0, market_cap: 3800, gross_margin: 48.0, ebitda_margin: 14.0, pat_margin: 6.0, rm_cost_pct: 50.0, roce: 11.0, roe: 10.5, debtor_days: 25, inventory_days: 70, payable_days: 30, ccc: 65, wc_days: 60, debt_equity: 0.35, interest_coverage: 8.0, promoter_holding: 56.0, pledge_pct: 0.0, fii_holding: 9.0, dii_holding: 14.0, pe: 30.0, pb: 3.0, dividend_yield: 0.6, dividend_payout: 15.0 },
    'Century Plyboards': { revenue: 3900, rev_growth_1y: 10.0, rev_cagr_3y: 12.0, rev_cagr_5y: 11.0, market_cap: 16000, gross_margin: 44.0, ebitda_margin: 13.5, pat_margin: 7.0, rm_cost_pct: 54.0, roce: 18.0, roe: 16.0, debtor_days: 40, inventory_days: 65, payable_days: 35, ccc: 70, wc_days: 62, debt_equity: 0.25, interest_coverage: 12.0, promoter_holding: 71.0, pledge_pct: 0.0, fii_holding: 8.0, dii_holding: 9.5, pe: 55.0, pb: 8.5, dividend_yield: 0.3, dividend_payout: 12.0 },
    'Archidply Industries': { revenue: 230, rev_growth_1y: 6.0, rev_cagr_3y: 7.0, rev_cagr_5y: 4.0, market_cap: 180, gross_margin: 38.0, ebitda_margin: 8.0, pat_margin: 3.0, rm_cost_pct: 60.0, roce: 10.0, roe: 9.0, debtor_days: 75, inventory_days: 90, payable_days: 60, ccc: 105, wc_days: 95, debt_equity: 0.55, interest_coverage: 3.5, promoter_holding: 60.0, pledge_pct: 5.0, fii_holding: 0.5, dii_holding: 1.0, pe: 18.0, pb: 1.8, dividend_yield: 0.0, dividend_payout: 0.0 },
    'Euro Pratik Sales': { revenue: 320, rev_growth_1y: 28.0, rev_cagr_3y: 32.0, rev_cagr_5y: 30.0, market_cap: 4200, gross_margin: 55.0, ebitda_margin: 32.0, pat_margin: 23.0, rm_cost_pct: 45.0, roce: 38.0, roe: 32.0, debtor_days: 60, inventory_days: 40, payable_days: 55, ccc: 45, wc_days: 40, debt_equity: 0.05, interest_coverage: 45.0, promoter_holding: 70.0, pledge_pct: 0.0, fii_holding: 2.0, dii_holding: 3.0, pe: 42.0, pb: 13.0, dividend_yield: 0.1, dividend_payout: 6.0 },
    'Rushil Decor': { revenue: 800, rev_growth_1y: 9.0, rev_cagr_3y: 14.0, rev_cagr_5y: 12.0, market_cap: 1300, gross_margin: 40.0, ebitda_margin: 11.0, pat_margin: 5.0, rm_cost_pct: 57.0, roce: 12.5, roe: 11.5, debtor_days: 65, inventory_days: 75, payable_days: 40, ccc: 100, wc_days: 88, debt_equity: 0.60, interest_coverage: 4.5, promoter_holding: 58.0, pledge_pct: 8.0, fii_holding: 1.5, dii_holding: 2.5, pe: 25.0, pb: 2.8, dividend_yield: 0.2, dividend_payout: 5.0 },
  };
  const meta = {
    'Stylam Industries': { ticker: 'STYLAMIND', is_seed: true, business_model: 'Manufacturer', products: 'Decorative & high-pressure laminates, exports-led', note: '', startIdx: 0 },
    'Greenlam Industries': { ticker: 'GREENLAM', business_model: 'Manufacturer', products: 'Laminates, veneers, engineered flooring & doors', note: '', startIdx: 0 },
    'Greenpanel Industries': { ticker: 'GREENPANEL', business_model: 'Manufacturer', products: 'MDF, plywood & decorative laminates', note: 'MDF-heavy mix, more cyclical', startIdx: 0 },
    'Century Plyboards': { ticker: 'CENTURYPLY', business_model: 'Integrated', products: 'Plywood, laminates, MDF, particle board', note: 'Largest diversified wood-panel player', startIdx: 0 },
    'Archidply Industries': { ticker: 'ARCHIDPLY', business_model: 'Manufacturer', products: 'Plywood, laminates, decorative veneers', note: 'Small-cap, thin margins', startIdx: 0 },
    'Euro Pratik Sales': { ticker: 'EUROPRATIK', business_model: 'Importer-Sourcing', products: 'Decorative wall panels, laminates (asset-light brand)', note: 'Asset-light branded model; margin outlier', startIdx: 3 },
    'Rushil Decor': { ticker: 'RUSHIL', business_model: 'Manufacturer', products: 'Laminates & MDF boards', note: '', startIdx: 0 },
  };
  const indian = Object.keys(indianCurrent).map((name) => {
    const m = meta[name];
    const cur = indianCurrent[name];
    return {
      name, ticker: m.ticker, ...(m.is_seed ? { is_seed: true } : {}),
      business_model: m.business_model, products: m.products, note: m.note,
      source: { label: 'Screener', url: `https://www.screener.in/company/${m.ticker}/` },
      current: cur,
      series: buildSeries(name, YEARS, cur, m.startIdx || 0),
    };
  });

  const global = [
    { name: 'Wilsonart', country: 'USA', business_model: 'Manufacturer', products: 'HPL, engineered surfaces', source: { label: 'stockanalysis.com', url: '' },
      current: { revenue: 11000, ebitda_margin: 18.0, pat_margin: 8.0, roce: 12.0 }, series: {} },
    { name: 'EGGER Group', country: 'Austria', business_model: 'Integrated', products: 'Wood-based panels, laminate flooring', source: { label: 'Company reports', url: '' },
      current: { revenue: 38000, ebitda_margin: 15.0, pat_margin: 6.5 }, series: {} },
    { name: 'Fletcher Building (Formica)', country: 'New Zealand', business_model: 'Manufacturer', products: 'Laminates (Formica), building products', source: { label: 'stockanalysis.com', url: '' },
      current: { revenue: 42000, ebitda_margin: 10.0, pat_margin: 3.5, roce: 8.0 },
      series: { ebitda_margin: series(YEARS, 10.0, { ...SERIES_SHAPE.ebitda_margin, startIdx: 2, seed: 'FletcherEB' }) } },
  ];

  const priv = [
    { name: 'Merino Industries', business_model: 'Integrated', products: 'Laminates, panels, modular furniture, agri', note: 'Large unlisted, backward-integrated', source: { label: 'Web / news', url: '' } },
    { name: 'Airolam', business_model: 'Manufacturer', products: 'Decorative laminates', note: 'Gujarat-based private manufacturer', source: { label: 'Web', url: '' } },
  ];

  const scorecard = {
    ranking: [
      { company: 'Euro Pratik Sales', bucket: 'indian', score: 88, rank: 1, strengths: ['EBITDA margin', 'ROCE', 'PAT margin', 'Low debt'], reason: 'An asset-light, branded model wins here: Euro Pratik designs and sources decorative panels rather than running heavy laminate presses, so it carries little fixed cost, minimal inventory and almost no debt. That converts into ~32% EBITDA margins and ~38% ROCE — multiples of the peer set — even though its revenue base is a fraction of the manufacturers.' },
      { company: 'Stylam Industries', bucket: 'indian', score: 79, rank: 2, strengths: ['EBITDA margin', 'Export mix', 'Return ratios'], reason: 'Best-in-class among the actual manufacturers: a large export book and a modern single-location plant give Stylam operating leverage and ~23% margins with low leverage.' },
      { company: 'Century Plyboards', bucket: 'indian', score: 74, rank: 3, strengths: ['Scale', 'Brand', 'ROCE'], reason: 'Scale and brand strength across plywood, laminate and MDF underpin steady mid-teens returns, though a broad product mix dilutes blended margins.' },
      { company: 'Greenpanel Industries', bucket: 'indian', score: 62, rank: 4, strengths: ['Gross margin', 'Lean receivables'], reason: 'Tight receivables and healthy gross margins, but an MDF-weighted mix leaves earnings more cyclical than the branded laminate players.' },
      { company: 'Greenlam Industries', bucket: 'indian', score: 60, rank: 5, strengths: ['Revenue scale', 'Category leadership'], reason: 'The largest pure-play laminate maker by revenue, but capex on new capacity and higher leverage have compressed near-term margins and returns.' },
      { company: 'Rushil Decor', bucket: 'indian', score: 48, rank: 6, strengths: ['MDF growth'], reason: 'Growing MDF volumes, yet leverage and single-digit margins keep return ratios below the branded leaders.' },
      { company: 'Archidply Industries', bucket: 'indian', score: 38, rank: 7, strengths: [], reason: 'Sub-scale with thin margins and stretched working capital; needs a step-up in either volumes or mix to close the gap.' },
    ],
  };

  const report = {
    title: 'Laminates — Peer Benchmarking',
    summary: 'Across the decorative-laminate peer set, branded and asset-light models earn dramatically higher margins and returns than the large manufacturers. Euro Pratik is the clear outlier on profitability, while Stylam leads the true manufacturers.',
    sections: [
      { title: 'The outperformer', icon: 'sparkles', blocks: [
        { type: 'callout', tone: 'good', title: 'Euro Pratik Sales', text: 'Crowned on profitability and capital efficiency. Its asset-light, design-and-source model avoids heavy manufacturing capex, so almost every incremental rupee of revenue drops through — ~32% EBITDA margin and ~38% ROCE against a peer median near 13%.' },
        { type: 'kpis', items: [ { label: 'EBITDA margin', value: '32%', sub: 'peer median ~13%' }, { label: 'ROCE', value: '38%', sub: 'best in set' }, { label: 'Debt / Equity', value: '0.05x', sub: 'near debt-free' }, { label: 'PAT margin', value: '23%' } ] },
      ] },
      { title: 'EBITDA margin across peers', icon: 'chart', blocks: [
        { type: 'bars', unit: '%', items: [ { label: 'Euro Pratik', value: 32.0 }, { label: 'Stylam', value: 23.5 }, { label: 'Greenpanel', value: 14.0 }, { label: 'Century Ply', value: 13.5 }, { label: 'Greenlam', value: 12.5 }, { label: 'Rushil Decor', value: 11.0 }, { label: 'Archidply', value: 8.0 } ] },
      ] },
      { title: 'Returns vs the peer set', icon: 'trophy', blocks: [
        { type: 'bars', unit: '%', items: [ { label: 'Euro Pratik (ROCE)', value: 38.0 }, { label: 'Stylam (ROCE)', value: 22.0 }, { label: 'Century Ply (ROCE)', value: 18.0 }, { label: 'Greenlam (ROCE)', value: 13.5 }, { label: 'Rushil (ROCE)', value: 12.5 }, { label: 'Greenpanel (ROCE)', value: 11.0 }, { label: 'Archidply (ROCE)', value: 10.0 } ] },
      ] },
      { title: 'How the margin gap opened up', icon: 'trend', blocks: [
        { type: 'trend', unit: '%', years: YEARS, series: [
          { label: 'Euro Pratik', values: [null, null, null, 25.6, 27.8, 30.1, 32.0] },
          { label: 'Stylam', values: [19.3, 19.9, 21.0, 21.8, 22.6, 23.0, 23.5] },
          { label: 'Greenlam', values: [10.4, 10.8, 11.2, 11.6, 12.0, 12.3, 12.5] },
        ] },
      ] },
      { title: 'Business-model split', icon: 'donut', blocks: [
        { type: 'donut', items: [ { label: 'Manufacturer', value: 4 }, { label: 'Integrated', value: 1 }, { label: 'Importer-Sourcing', value: 1 } ] },
      ] },
      { title: 'The peer set at a glance', icon: 'table', blocks: [
        { type: 'table', columns: ['Company', 'Revenue (Rs Cr)', 'EBITDA %', 'ROCE %'], rows: [
          ['Euro Pratik Sales', '320', '32.0', '38.0'],
          ['Stylam Industries', '1,450', '23.5', '22.0'],
          ['Century Plyboards', '3,900', '13.5', '18.0'],
          ['Greenpanel Industries', '1,600', '14.0', '11.0'],
          ['Greenlam Industries', '2,400', '12.5', '13.5'],
          ['Rushil Decor', '800', '11.0', '12.5'],
          ['Archidply Industries', '230', '8.0', '10.0'],
        ] },
      ] },
      { title: 'India vs Global', icon: 'globe', blocks: [
        { type: 'callout', tone: 'info', title: 'Different games', text: 'Global names (Wilsonart, EGGER, Fletcher Building) are 10–30x the size of the Indian players but earn mid-teens or lower margins. The Indian branded players trade scale for profitability — the reverse of the global majors.' },
      ] },
    ],
  };

  return {
    meta: {
      slug: 'laminates', name: 'Laminates (Decorative Laminates)', type: 'industry', query: 'laminates',
      seed_company: 'Stylam Industries', segment: 'Decorative laminates & surfacing',
      definition: 'Companies that make or sell decorative laminates and surfacing panels used on furniture, walls and interiors.',
      generated_at: '2026-09-28T00:00:00Z', sample: true,
      coverage: { peers_total: indian.length + global.length + priv.length, with_full_financials: indian.length, confidence: 'medium' },
    },
    outperformer: {
      company: 'Euro Pratik Sales', bucket: 'indian',
      headline: 'Highest margin in the peer set — ~32% EBITDA vs a ~13% peer median',
      reason: "Euro Pratik runs an asset-light, branded model: it designs and sources decorative panels instead of operating capital-heavy laminate presses. With little fixed cost, lean inventory and almost no debt, it converts sales into ~32% EBITDA margin and ~38% ROCE — well ahead of every manufacturer in the set, even though its revenue base is far smaller.",
      india_vs_global: 'Indian branded players lead on margins and returns; the global names are far larger but earn mid-teens margins or lower.',
    },
    metrics: METRICS,
    peers: { indian, global, private: priv },
    scorecard,
    report,
    sources: [
      { label: 'Screener — Stylam Industries', url: 'https://www.screener.in/company/STYLAMIND/' },
      { label: 'Screener — Greenlam Industries', url: 'https://www.screener.in/company/GREENLAM/' },
      { label: 'Screener — Century Plyboards', url: 'https://www.screener.in/company/CENTURYPLY/' },
      { label: 'stockanalysis.com — global peers', url: 'https://stockanalysis.com/' },
      { label: 'Company annual reports & investor presentations', url: '' },
    ],
  };
}

// =====================================================================
// REFRACTORIES  (different outperformer reason: niche + backward integration)
// =====================================================================
function refractoriesReport() {
  const indianCurrent = {
    'Monolithisch India': { revenue: 260, rev_growth_1y: 34.0, rev_cagr_3y: 40.0, rev_cagr_5y: 35.0, market_cap: 2100, gross_margin: 42.0, ebitda_margin: 21.0, pat_margin: 14.5, rm_cost_pct: 58.0, roce: 34.0, roe: 27.0, debtor_days: 95, inventory_days: 55, payable_days: 70, ccc: 80, wc_days: 90, debt_equity: 0.10, interest_coverage: 22.0, promoter_holding: 71.0, pledge_pct: 0.0, fii_holding: 1.0, dii_holding: 2.0, pe: 40.0, pb: 9.0, dividend_yield: 0.1, dividend_payout: 5.0 },
    'IFGL Refractories': { revenue: 1450, rev_growth_1y: 8.0, rev_cagr_3y: 10.0, rev_cagr_5y: 9.0, market_cap: 2000, gross_margin: 38.0, ebitda_margin: 12.0, pat_margin: 6.5, rm_cost_pct: 60.0, roce: 14.0, roe: 12.0, debtor_days: 85, inventory_days: 90, payable_days: 65, ccc: 110, wc_days: 100, debt_equity: 0.20, interest_coverage: 9.0, promoter_holding: 74.0, pledge_pct: 0.0, fii_holding: 3.0, dii_holding: 6.0, pe: 20.0, pb: 2.3, dividend_yield: 0.6, dividend_payout: 12.0 },
    'Vesuvius India': { revenue: 1750, rev_growth_1y: 6.0, rev_cagr_3y: 12.0, rev_cagr_5y: 8.0, market_cap: 8000, gross_margin: 40.0, ebitda_margin: 15.0, pat_margin: 9.5, rm_cost_pct: 55.0, roce: 22.0, roe: 17.0, debtor_days: 90, inventory_days: 75, payable_days: 60, ccc: 105, wc_days: 95, debt_equity: 0.0, interest_coverage: 60.0, promoter_holding: 55.0, pledge_pct: 0.0, fii_holding: 5.0, dii_holding: 12.0, pe: 45.0, pb: 7.0, dividend_yield: 0.5, dividend_payout: 20.0 },
    'RHI Magnesita India': { revenue: 3400, rev_growth_1y: 5.0, rev_cagr_3y: 20.0, rev_cagr_5y: 18.0, market_cap: 11000, gross_margin: 36.0, ebitda_margin: 11.5, pat_margin: 5.5, rm_cost_pct: 62.0, roce: 12.5, roe: 10.0, debtor_days: 80, inventory_days: 100, payable_days: 70, ccc: 110, wc_days: 105, debt_equity: 0.15, interest_coverage: 7.5, promoter_holding: 51.0, pledge_pct: 0.0, fii_holding: 6.0, dii_holding: 9.0, pe: 42.0, pb: 3.5, dividend_yield: 0.3, dividend_payout: 10.0 },
    'Dalmia Bharat Refractories': { revenue: 2200, rev_growth_1y: 4.0, rev_cagr_3y: 9.0, rev_cagr_5y: 7.0, market_cap: 2600, gross_margin: 34.0, ebitda_margin: 9.0, pat_margin: 3.5, rm_cost_pct: 64.0, roce: 9.5, roe: 8.0, debtor_days: 100, inventory_days: 95, payable_days: 75, ccc: 120, wc_days: 110, debt_equity: 0.30, interest_coverage: 4.0, promoter_holding: 66.0, pledge_pct: 0.0, fii_holding: 1.5, dii_holding: 4.0, pe: 30.0, pb: 2.0, dividend_yield: 0.2, dividend_payout: 6.0 },
  };
  const meta = {
    'Monolithisch India': { ticker: 'MONOLITH', is_seed: true, business_model: 'Manufacturer (integrated)', products: 'Monolithic (specialty castable) refractories for steel & foundries', note: 'Niche monolithics; backward-integrated on key inputs', startIdx: 2 },
    'IFGL Refractories': { ticker: 'IFGLEXPOR', business_model: 'Manufacturer', products: 'Refractories for steel flow control', note: '', startIdx: 0 },
    'Vesuvius India': { ticker: 'VESUVIUS', business_model: 'Manufacturer', products: 'Flow-control & specialty refractories (MNC arm)', note: '', startIdx: 0 },
    'RHI Magnesita India': { ticker: 'RHIM', business_model: 'Integrated', products: 'Full-range basic & shaped refractories', note: 'Largest by revenue; broad range', startIdx: 0 },
    'Dalmia Bharat Refractories': { ticker: 'DBREL', business_model: 'Manufacturer', products: 'Refractories for steel, cement & glass', note: '', startIdx: 0 },
  };
  const indian = Object.keys(indianCurrent).map((name) => {
    const m = meta[name];
    const cur = indianCurrent[name];
    return {
      name, ticker: m.ticker, ...(m.is_seed ? { is_seed: true } : {}),
      business_model: m.business_model, products: m.products, note: m.note,
      source: { label: 'Screener', url: `https://www.screener.in/company/${m.ticker}/` },
      current: cur,
      series: buildSeries(name, YEARS, cur, m.startIdx || 0),
    };
  });

  const global = [
    { name: 'RHI Magnesita N.V.', country: 'Austria', business_model: 'Integrated', products: 'Global refractory leader, backward-integrated on magnesite', source: { label: 'stockanalysis.com', url: '' },
      current: { revenue: 32000, ebitda_margin: 13.0, pat_margin: 5.0, roce: 11.0 }, series: {} },
    { name: 'Vesuvius plc', country: 'United Kingdom', business_model: 'Manufacturer', products: 'Molten-metal flow engineering & refractories', source: { label: 'stockanalysis.com', url: '' },
      current: { revenue: 18000, ebitda_margin: 14.0, pat_margin: 7.0 }, series: {} },
    { name: 'Krosaki Harima', country: 'Japan', business_model: 'Manufacturer', products: 'Refractories & fine ceramics', source: { label: 'Company reports', url: '' },
      current: { revenue: 12000, ebitda_margin: 12.0 }, series: {} },
  ];

  const priv = [
    { name: 'Calderys India', business_model: 'Manufacturer', products: 'Monolithic refractories & solutions', note: 'Part of global Calderys (private)', source: { label: 'Web / news', url: '' } },
    { name: 'TRL Krosaki Refractories', business_model: 'Integrated', products: 'Basic, shaped & monolithic refractories', note: 'Tata–Krosaki JV, unlisted', source: { label: 'Web', url: '' } },
  ];

  const scorecard = {
    ranking: [
      { company: 'Monolithisch India', bucket: 'indian', score: 86, rank: 1, strengths: ['ROCE', 'Revenue growth', 'Low debt', 'Niche mix'], reason: 'Monolithisch wins on a focused, high-value niche rather than scale. By concentrating on monolithic (castable) refractories and backward-integrating into its key mineral inputs, it holds pricing power in a fragmented segment the majors under-serve. The result is ~34% ROCE and 35%+ revenue CAGR off a small base, with minimal debt — a specialisation-and-integration story, not a cost or sourcing one.' },
      { company: 'Vesuvius India', bucket: 'indian', score: 78, rank: 2, strengths: ['ROCE', 'Debt-free', 'MNC technology'], reason: 'A debt-free balance sheet, parent technology and premium flow-control products deliver ~22% ROCE and the most consistent margins among the larger players.' },
      { company: 'IFGL Refractories', bucket: 'indian', score: 66, rank: 3, strengths: ['Export mix', 'Steady margins'], reason: 'A solid exporter with steady low-teens margins; return ratios are respectable but working capital runs heavy.' },
      { company: 'RHI Magnesita India', bucket: 'indian', score: 60, rank: 4, strengths: ['Scale', 'Product breadth'], reason: 'The revenue leader with the widest range, but a commodity-heavy basic-refractory mix and elevated working capital keep returns in the low teens.' },
      { company: 'Dalmia Bharat Refractories', bucket: 'indian', score: 46, rank: 5, strengths: [], reason: 'Integration is still maturing; thin margins, higher leverage and the longest cash cycle in the set weigh on returns.' },
    ],
  };

  const report = {
    title: 'Refractories — Peer Benchmarking',
    summary: 'In refractories, scale does not equal quality of returns. Monolithisch India, the smallest listed name here, out-earns far larger peers by owning a specialised monolithic niche and integrating backward into raw materials.',
    sections: [
      { title: 'The outperformer', icon: 'sparkles', blocks: [
        { type: 'callout', tone: 'good', title: 'Monolithisch India', text: 'Crowned for capital efficiency and growth. A deliberate focus on monolithic (castable) refractories plus backward integration into key minerals gives it pricing power the volume players lack — ~34% ROCE and 35%+ revenue CAGR from a small base, with almost no debt.' },
        { type: 'kpis', items: [ { label: 'ROCE', value: '34%', sub: 'best in set' }, { label: 'Rev CAGR (5Y)', value: '35%' }, { label: 'EBITDA margin', value: '21%', sub: 'peer median ~12%' }, { label: 'Debt / Equity', value: '0.10x' } ] },
      ] },
      { title: 'ROCE across peers', icon: 'trophy', blocks: [
        { type: 'bars', unit: '%', items: [ { label: 'Monolithisch', value: 34.0 }, { label: 'Vesuvius India', value: 22.0 }, { label: 'IFGL', value: 14.0 }, { label: 'RHI Magnesita', value: 12.5 }, { label: 'Dalmia Bharat', value: 9.5 } ] },
      ] },
      { title: 'Growth vs the field', icon: 'chart', blocks: [
        { type: 'bars', unit: '%', items: [ { label: 'Monolithisch (5Y CAGR)', value: 35.0 }, { label: 'RHI Magnesita', value: 18.0 }, { label: 'Vesuvius India', value: 8.0 }, { label: 'IFGL', value: 9.0 }, { label: 'Dalmia Bharat', value: 7.0 } ] },
      ] },
      { title: 'ROCE, the last few years', icon: 'trend', blocks: [
        { type: 'trend', unit: '%', years: YEARS, series: [
          { label: 'Monolithisch', values: [null, null, 27.2, 29.8, 31.5, 33.0, 34.0] },
          { label: 'Vesuvius India', values: [17.6, 18.0, 18.9, 19.8, 20.6, 21.4, 22.0] },
          { label: 'RHI Magnesita', values: [10.0, 10.4, 10.9, 11.3, 11.8, 12.2, 12.5] },
        ] },
      ] },
      { title: 'Business-model split', icon: 'donut', blocks: [
        { type: 'donut', items: [ { label: 'Manufacturer', value: 3 }, { label: 'Integrated', value: 2 } ] },
      ] },
      { title: 'The peer set at a glance', icon: 'table', blocks: [
        { type: 'table', columns: ['Company', 'Revenue (Rs Cr)', 'EBITDA %', 'ROCE %'], rows: [
          ['RHI Magnesita India', '3,400', '11.5', '12.5'],
          ['Dalmia Bharat Refractories', '2,200', '9.0', '9.5'],
          ['Vesuvius India', '1,750', '15.0', '22.0'],
          ['IFGL Refractories', '1,450', '12.0', '14.0'],
          ['Monolithisch India', '260', '21.0', '34.0'],
        ] },
      ] },
    ],
  };

  return {
    meta: {
      slug: 'refractories', name: 'Refractories', type: 'industry', query: 'refractories',
      seed_company: 'Monolithisch India', segment: 'Industrial refractories (steel, cement, glass)',
      definition: 'Companies that make heat-resistant materials (bricks, castables, flow-control shapes) used to line furnaces in steel, cement and glass plants.',
      generated_at: '2026-09-28T00:00:00Z', sample: true,
      coverage: { peers_total: indian.length + global.length + priv.length, with_full_financials: indian.length, confidence: 'medium' },
    },
    outperformer: {
      company: 'Monolithisch India', bucket: 'indian',
      headline: 'Best returns in the set — ~34% ROCE from a specialised, integrated niche',
      reason: 'Monolithisch outperforms by specialisation, not size. It concentrates on monolithic (castable) refractories and has integrated backward into its key mineral inputs, which gives it pricing power and cost control in a fragmented niche the large players under-serve. That drives ~34% ROCE and 35%+ revenue CAGR from a small base with negligible debt.',
      india_vs_global: 'The global majors are 10–100x larger but earn low-teens margins; India has both commodity-scale players and, in Monolithisch, a high-return specialist.',
    },
    metrics: METRICS,
    peers: { indian, global, private: priv },
    scorecard,
    report,
    sources: [
      { label: 'Screener — Monolithisch India', url: 'https://www.screener.in/company/MONOLITH/' },
      { label: 'Screener — Vesuvius India', url: 'https://www.screener.in/company/VESUVIUS/' },
      { label: 'Screener — RHI Magnesita India', url: 'https://www.screener.in/company/RHIM/' },
      { label: 'stockanalysis.com — global peers', url: 'https://stockanalysis.com/' },
      { label: 'Company annual reports & investor presentations', url: '' },
    ],
  };
}

// ---- write files ----
const laminates = laminatesReport();
const refractories = refractoriesReport();

function peerCount(r) { return r.peers.indian.length + r.peers.global.length + r.peers.private.length; }

const index = {
  reports: [
    { slug: 'laminates', name: laminates.meta.name, type: 'industry', query: 'laminates', seed_company: 'Stylam Industries',
      aliases: ['stylam', 'stylam industries', 'laminates', 'decorative laminates', 'greenlam', 'greenpanel', 'century plyboards', 'euro pratik', 'merino', 'surfacing', 'hpl'],
      updated_at: laminates.meta.generated_at, peer_count: peerCount(laminates), sample: true },
    { slug: 'refractories', name: refractories.meta.name, type: 'industry', query: 'refractories', seed_company: 'Monolithisch India',
      aliases: ['monolithisch', 'monolithisch india', 'refractories', 'refractory', 'vesuvius', 'ifgl', 'rhi magnesita', 'castable', 'monolithics'],
      updated_at: refractories.meta.generated_at, peer_count: peerCount(refractories), sample: true },
  ],
};

fs.writeFileSync(path.join(REPORTS_DIR, 'laminates.json'), JSON.stringify(laminates, null, 2));
fs.writeFileSync(path.join(REPORTS_DIR, 'refractories.json'), JSON.stringify(refractories, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));

console.log('Wrote:');
console.log(' - index.json (' + index.reports.length + ' reports)');
console.log(' - reports/laminates.json (' + peerCount(laminates) + ' peers)');
console.log(' - reports/refractories.json (' + peerCount(refractories) + ' peers)');
