// lib/metrics.mjs — the 26-metric dictionary emitted VERBATIM in every report
// (identical to the seeds / docs/DATA_CONTRACT.md). The frontend keys off these;
// ALWAYS include ebitda_margin. Plus a tiny median() for the Stage-4 AI-context
// table (the frontend computes display aggregates itself — this never ships in
// the output JSON).

export const METRICS = [
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

export const METRIC_KEYS = METRICS.map((m) => m.key);
export const CANONICAL_MODELS = ['Manufacturer', 'Trader-Distributor', 'Importer-Sourcing', 'Integrated'];

export function median(arr) {
  const a = (arr || []).filter((v) => typeof v === 'number' && isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : +((a[m - 1] + a[m]) / 2).toFixed(2);
}

/** Normalize any model string to one of the 4 canonical values (keeps a parenthetical). */
export function canonicalModel(s) {
  const raw = String(s || '').trim();
  if (!raw) return 'Manufacturer';
  const head = raw.split(/[\s(]/)[0].toLowerCase();
  const paren = (raw.match(/\(([^)]+)\)/) || [])[1];
  let base = 'Manufacturer';
  if (/import|sourc/.test(raw.toLowerCase())) base = 'Importer-Sourcing';
  else if (/trad|distrib|dealer|retail/.test(raw.toLowerCase())) base = 'Trader-Distributor';
  else if (/integrat/.test(raw.toLowerCase())) base = 'Integrated';
  else if (/manufact|maker|produc/.test(raw.toLowerCase()) || head) base = 'Manufacturer';
  const exact = CANONICAL_MODELS.find((m) => m.toLowerCase() === raw.toLowerCase());
  if (exact) return paren ? `${exact} (${paren})` : exact;
  return paren ? `${base} (${paren})` : base;
}
