// help.js — plain-language, jargon-free "how to read this" text for every metric,
// each with a tiny worked example. Keyed by metric key so it works on ANY report
// regardless of when it was generated (it's presentation, not report data).
// Rendered as a small "?" chip next to a heading; the popover shows on hover/focus
// (CSS-only, so it also works on tap — see .pv-help in styles.css).
import { esc } from './format.js';

export const METRIC_HELP = {
  // Size & growth
  revenue: { what: 'Total money the company earned from sales in a year, before any costs are taken out.', eg: '₹1,450 Cr revenue = it sold ₹1,450 crore worth of goods/services that year.' },
  rev_growth_1y: { what: 'How much sales grew versus the year before.', eg: '12% = this year’s sales were 12% bigger than last year’s.' },
  rev_cagr_3y: { what: 'The steady yearly sales-growth rate over the last 3 years (smooths out good and bad years).', eg: '18% = sales grew about 18% every year on average for 3 years.' },
  rev_cagr_5y: { what: 'The steady yearly sales-growth rate over the last 5 years.', eg: '15% = roughly 15% growth every year for 5 years.' },
  net_profit: { what: 'What’s left after ALL costs, interest and tax — the real bottom line.', eg: '₹200 Cr = it kept ₹200 crore after paying for everything.' },
  operating_profit: { what: 'Profit from the core business before interest and tax — how well the actual operations do.', eg: 'High operating profit but low net profit usually means heavy interest/debt eating it up.' },
  eps: { what: 'Profit earned per single share (profit ÷ number of shares).', eg: 'EPS ₹25 = each share earned ₹25 of profit this year.' },
  profit_cagr_3y: { what: 'Steady yearly profit-growth rate over 3 years.', eg: '20% = profit grew about 20% a year for 3 years.' },
  profit_cagr_5y: { what: 'Steady yearly profit-growth rate over 5 years.', eg: '20% = profit grew about 20% a year for 5 years.' },
  market_cap: { what: 'The company’s total value on the stock market = share price × number of shares.', eg: '₹9,000 Cr = buying the whole company at today’s price would cost ₹9,000 crore.' },
  // Profitability
  gross_margin: { what: 'Of every ₹100 of sales, how much is left after the direct cost of making the product. Higher is better.', eg: '45% = ₹45 left from every ₹100 after raw materials.' },
  ebitda_margin: { what: 'Operating profit as a share of sales (before interest, tax, depreciation) — core profitability. Higher is better.', eg: '23% = ₹23 of operating profit per ₹100 of sales.' },
  pat_margin: { what: 'Final profit as a share of sales, after everything. Higher is better.', eg: '14% = ₹14 of net profit per ₹100 sold.' },
  rm_cost_pct: { what: 'How much of sales is eaten up by raw materials. Lower is better.', eg: '52% = ₹52 of every ₹100 goes to raw materials; a jump means input costs are hurting.' },
  manufacturing_cost_pct: { what: 'Factory running costs (power, fuel, job-work) as a share of sales. Lower is better.', eg: '10% = ₹10 of every ₹100 goes to running the plant.' },
  employee_cost_pct: { what: 'Salaries as a share of sales. Lower is leaner — but too low can mean under-investment.', eg: '8% = ₹8 of every ₹100 of sales goes on people.' },
  other_cost_pct: { what: 'All other operating costs (freight, admin, selling) as a share of sales.', eg: '12% = ₹12 of every ₹100 on everything else.' },
  tax_rate: { what: 'Share of profit paid as income tax.', eg: '25% is the normal Indian rate; much lower can be one-off tax benefits.' },
  // Returns
  roce: { what: 'Return on Capital Employed — profit earned for every ₹100 of total capital (debt + equity) the business uses. Higher = more efficient.', eg: '22% = ₹22 of profit a year per ₹100 of capital put to work.' },
  roe: { what: 'Return on Equity — profit for every ₹100 the shareholders own. Higher is better.', eg: '18% = ₹18 of profit a year per ₹100 of shareholders’ money.' },
  avg_roe_3y: { what: 'Average ROE over 3 years — shows if high returns are consistent, not a one-year fluke.', eg: 'A steady 18% beats one great year and two poor ones.' },
  avg_roe_5y: { what: 'Average ROE over 5 years — the longer consistency check.', eg: 'A steady 18% across 5 years signals durable quality.' },
  price_cagr_1y: { what: 'How fast the SHARE PRICE grew over the last year (the stock, not the business).', eg: '30% = the share price is 30% higher than a year ago.' },
  price_cagr_3y: { what: 'How fast the share price grew per year over 3 years.', eg: '30% a year ≈ the price roughly doubled in ~2.5 years.' },
  price_cagr_5y: { what: 'How fast the share price grew per year over 5 years.', eg: '25% a year ≈ the price roughly tripled in ~5 years.' },
  // Working capital
  debtor_days: { what: 'How many days, on average, customers take to pay after a sale. Lower is better.', eg: '70 days = it waits ~70 days to collect cash; rising days = money stuck with customers.' },
  inventory_days: { what: 'How many days stock sits before it’s sold. Lower = faster-moving goods.', eg: '85 days = goods sit about 3 months on average before selling.' },
  payable_days: { what: 'How many days the company takes to pay its suppliers. Higher can be good — it holds its cash longer.', eg: '45 days = it pays suppliers about 45 days after buying.' },
  ccc: { what: 'Cash Conversion Cycle — the gap (in days) between paying for materials and finally getting cash back from customers. Lower is better; negative is excellent. (= debtor + inventory − payable days.)', eg: '110 days = cash is tied up ~110 days each cycle before it comes back.' },
  wc_days: { what: 'Net working-capital days — total cash tied up in day-to-day operations. Lower = less cash stuck in the business.', eg: '95 days = about a quarter of a year’s sales is locked in working capital.' },
  // Balance sheet
  debt_equity: { what: 'How much debt the company uses for every ₹1 of its own money. Lower is safer.', eg: '0.15x = only ₹0.15 of debt per ₹1 of equity (very low); above ~1 is heavy debt.' },
  interest_coverage: { what: 'How many times the yearly profit can cover its interest bill. Higher = safer.', eg: '18x = profit is 18× the interest due; below ~3 starts to look risky.' },
  total_debt: { what: 'Total borrowings the company owes.', eg: 'Watch the trend — steadily rising debt with flat profit is a warning sign.' },
  cwip: { what: 'Capital Work-in-Progress — money already SPENT on plants/factories/assets that are still UNDER construction and not yet finished or earning anything. A big or rising CWIP = heavy expansion in the pipeline that should lift future sales once it goes live; if it stays stuck at the same level for years, the project may be delayed or stalled (cash sunk, nothing earning).', eg: '₹500 Cr CWIP today → expect it to move into “fixed assets” and start adding revenue once the new plant is commissioned. Flat CWIP for 4 years = a red flag of a stuck project.' },
  // Cash flow
  cfo: { what: 'Operating Cash Flow — the ACTUAL cash the core business threw off (not accounting profit). It should broadly track profit over time.', eg: 'Profit looks high but this stays low for years = profits aren’t turning into real cash (a red flag).' },
  fcf: { what: 'Free Cash Flow — cash left after running the business AND paying for new assets. Positive = self-funding; negative = burning cash or investing heavily.', eg: 'Consistently positive FCF = the company funds itself without constantly borrowing.' },
  cfo_op: { what: 'What share of operating profit actually came in as cash. Around 100% is healthy.', eg: '70% = only ₹70 of every ₹100 of “profit” showed up as real cash.' },
  // Ownership
  promoter_holding: { what: 'The share of the company owned by its founders/parent group. Higher often means more skin in the game.', eg: '54% = founders own just over half the company.' },
  pledge_pct: { what: 'The share of the promoters’ OWN stake that is pledged (used as collateral for loans). Lower is better; high pledging is risky.', eg: '0% = no pledging (good); 30%+ = promoters borrowing against their shares — a warning sign.' },
  fii_holding: { what: 'Share owned by Foreign Institutional Investors (overseas funds).', eg: 'Rising FII holding = growing foreign-investor confidence.' },
  dii_holding: { what: 'Share owned by Domestic Institutional Investors (Indian mutual funds, insurers, banks).', eg: 'Rising DII holding = growing confidence from big Indian funds.' },
  public_holding: { what: 'Share owned by the general retail public (small individual investors).', eg: 'A high public holding means ownership is spread across many small investors.' },
  num_shareholders: { what: 'The total COUNT of people/entities holding the stock. A fast-rising count means lots of new small/retail investors piling in (popularity — sometimes hype near market tops); a falling count usually means ownership is consolidating into fewer, larger or institutional hands.', eg: 'Shareholders jumping from 20,000 to 2,00,000 in a year = a flood of new retail investors; pair it with price — a spike alongside a price run-up can signal froth.' },
  // Valuation
  pe: { what: 'Price-to-Earnings — how many years of today’s profit you’re paying for at the current price. Higher = pricier / higher growth expectations. Only compare within the same industry.', eg: 'P/E 44 = you pay 44× one year’s profit for the share.' },
  pb: { what: 'Price-to-Book — the price versus the company’s net asset value on its books. Higher = market values it well above its assets.', eg: 'P/B 7.5 = priced at 7.5× its book (net-asset) value.' },
  dividend_yield: { what: 'Yearly dividend as a share of the price — the cash income you get just for holding the stock.', eg: '0.2% = ₹0.20 a year per ₹100 of share; fast-growing firms usually pay little.' },
  dividend_payout: { what: 'What share of profit is handed out as dividends (the rest is kept and reinvested).', eg: '8% payout = ₹8 of every ₹100 of profit paid out, ₹92 kept to grow the business.' },
};

/**
 * A small "?" help chip for a heading. Returns '' when there's no entry for the key,
 * so it's safe to sprinkle on every heading. The text lives in data-help and is shown
 * by a single shared, screen-positioned tooltip (below) — so it's never clipped by a
 * table's scroll box, and works on hover, keyboard focus and tap.
 */
export function helpIcon(key, label) {
  const h = METRIC_HELP[key];
  if (!h) return '';
  const txt = (label ? label + ' — ' : '') + h.what + (h.eg ? '  Example: ' + h.eg : '');
  return `<span class="pv-help" tabindex="0" role="button" aria-label="How to read ${esc(label || key)}" data-help="${esc(txt)}">?</span>`;
}

// One shared tooltip element, positioned next to whichever .pv-help chip is hovered
// or focused. Registered once at import (ES modules are singletons). Guarded for SSR.
if (typeof document !== 'undefined' && !window.__pvHelpTips) {
  window.__pvHelpTips = true;
  let tip = null;
  const ensure = () => {
    if (!tip) { tip = document.createElement('div'); tip.className = 'pv-help-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    return tip;
  };
  const show = (el) => {
    const t = ensure();
    t.textContent = el.getAttribute('data-help') || '';
    t.classList.add('on');
    const r = el.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    let top = r.bottom + 8;
    if (top + th > window.innerHeight - 8) top = r.top - th - 8; // flip above if no room below
    t.style.left = left + 'px';
    t.style.top = Math.max(8, top) + 'px';
  };
  const hide = () => { if (tip) tip.classList.remove('on'); };
  const chip = (e) => (e.target && e.target.closest ? e.target.closest('.pv-help') : null);
  document.addEventListener('mouseover', (e) => { const el = chip(e); if (el) show(el); });
  document.addEventListener('mouseout', (e) => { const el = chip(e); if (el) hide(); });
  document.addEventListener('focusin', (e) => { const el = chip(e); if (el) show(el); });
  document.addEventListener('focusout', (e) => { const el = chip(e); if (el) hide(); });
  window.addEventListener('scroll', hide, true);
}
