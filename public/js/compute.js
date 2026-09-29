// compute.js — the frontend computes medians, averages and winner-per-metric
// ITSELF from peers[].current and peers[].series, so every table is internally
// consistent. No dependencies.
import { yearSortKey } from './format.js';

function isNum(v) { return typeof v === 'number' && isFinite(v); }

// Trends never show anything before FY2016 (the user's cutoff). yearSortKey
// turns "Mar 2019" / "2022" into a comparable year number.
const MIN_FY = 2016;

/** Numeric values only (drops null / undefined / NaN). */
export function nums(arr) { return (arr || []).filter(isNum); }

export function median(arr) {
  const a = nums(arr).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function average(arr) {
  const a = nums(arr);
  if (!a.length) return null;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

/** Collect the current value of `key` across a list of peers. */
export function currentValues(peers, key) {
  return peers.map((p) => (p.current ? p.current[key] : undefined));
}

/** { key: median } across peers' current values, for every metric. */
export function medianRow(peers, metrics) {
  const row = {};
  for (const m of metrics) row[m.key] = median(currentValues(peers, m.key));
  return row;
}

export function averageRow(peers, metrics) {
  const row = {};
  for (const m of metrics) row[m.key] = average(currentValues(peers, m.key));
  return row;
}

/**
 * Best peer for a metric, respecting `better`. Returns { name, value } or null
 * (null for neutral metrics or when there is no data / no unique direction).
 */
export function winnerForMetric(peers, metric) {
  if (metric.better === 'neutral') return null;
  let best = null;
  for (const p of peers) {
    const v = p.current ? p.current[metric.key] : undefined;
    if (!isNum(v)) continue;
    if (best === null) { best = { name: p.name, value: v }; continue; }
    if (metric.better === 'high' ? v > best.value : v < best.value) best = { name: p.name, value: v };
  }
  return best;
}

/** Winner-per-metric across all buckets combined (for the Scorecard). */
export function winnersAcross(peerGroups, metrics) {
  const all = [].concat(...peerGroups);
  return metrics.map((m) => ({ metric: m, winner: winnerForMetric(all, m) }));
}

/**
 * Normalised position of `value` within `allValues` respecting direction.
 * Returns 1 = best, 0 = worst, 0.5 = only value / all equal, or null when the
 * metric is neutral / value missing.
 */
export function rankPosition(value, allValues, better) {
  if (better === 'neutral' || !isNum(value)) return null;
  const a = nums(allValues);
  if (a.length < 2) return 0.5;
  const min = Math.min(...a), max = Math.max(...a);
  if (max === min) return 0.5;
  const raw = (value - min) / (max - min);
  return better === 'low' ? 1 - raw : raw;
}

/** True when `value` equals the best value in the set for this metric. */
export function isBest(value, allValues, better) {
  if (better === 'neutral' || !isNum(value)) return false;
  const a = nums(allValues);
  if (!a.length) return false;
  const target = better === 'low' ? Math.min(...a) : Math.max(...a);
  return value === target;
}

/**
 * Live composite 0–100 score per peer: the average percentile rank (vs the current
 * peer set, honouring each metric's `better`) across every non-neutral metric the
 * peer has data for. Used to score peers that have no AI research score (e.g. ones
 * the user added), so the scorecard can re-rank the instant a peer is added/removed.
 * Returns [{ name, score, n }] (score null when there's no scorable data).
 */
export function compositeScores(peers, metrics) {
  // Business-quality score: skip neutral metrics, absolute-size (trendOnly) metrics,
  // and market/return metrics explicitly opted out (composite:false).
  const scored = metrics.filter((m) => m.better !== 'neutral' && !m.trendOnly && m.composite !== false);
  const colVals = {};
  for (const m of scored) colVals[m.key] = currentValues(peers, m.key);
  return peers.map((p) => {
    const cur = p.current || {};
    let sum = 0, n = 0;
    for (const m of scored) {
      const pos = rankPosition(cur[m.key], colVals[m.key], m.better);
      if (pos != null) { sum += pos; n += 1; }
    }
    return { name: p.name, score: n ? Math.round((sum / n) * 100) : null, n };
  });
}

// ---- Series helpers (Trends) ----

/** Peers in a bucket that carry a real series for `key`. */
export function peersWithSeries(peers, key) {
  return peers.filter((p) => p.series && p.series[key] && Array.isArray(p.series[key].years) && p.series[key].years.length);
}

/** Union of all year labels across peers for a metric, sorted chronologically. */
export function unionYears(peers, key) {
  const set = new Set();
  for (const p of peersWithSeries(peers, key)) for (const y of p.series[key].years) set.add(y);
  return [...set].filter((y) => yearSortKey(y) >= MIN_FY).sort((a, b) => yearSortKey(a) - yearSortKey(b));
}

/** A peer's value for a given year label within a series (null if absent). */
export function seriesValueAt(peer, key, year) {
  const s = peer.series && peer.series[key];
  if (!s) return null;
  const i = s.years.indexOf(year);
  return i === -1 ? null : (isNum(s.values[i]) ? s.values[i] : null);
}

/** Per-year median/average across peers for a metric series. */
export function seriesAggregate(peers, key, years, kind = 'median') {
  const fn = kind === 'average' ? average : median;
  return years.map((y) => fn(peersWithSeries(peers, key).map((p) => seriesValueAt(p, key, y))));
}

/** Which metrics have at least one peer with series data (for the Trends tab).
 *  `noTrend` metrics are kept out of the trends view (they stay in the Current grid). */
export function metricsWithSeries(peers, metrics) {
  return metrics.filter((m) => !m.noTrend && peersWithSeries(peers, m.key).length > 0);
}

// ============================================================================
// Industry analysis — aggregates ACROSS the peer set, year by year (FY16+).
// Everything below is derived live, so it recomputes when peers are added/removed.
// ============================================================================

/** Industry timeline for a metric: { years, values } aggregated across peers.
 *  kind: 'median' (default) · 'average' · 'sum' (e.g. total industry revenue). */
export function industryLine(peers, key, kind = 'median') {
  const years = unionYears(peers, key);
  const withS = peersWithSeries(peers, key);
  const values = years.map((y) => {
    const vs = withS.map((p) => seriesValueAt(p, key, y)).filter(isNum);
    if (!vs.length) return null;
    if (kind === 'sum') return vs.reduce((a, b) => a + b, 0);
    if (kind === 'average') return vs.reduce((a, b) => a + b, 0) / vs.length;
    return median(vs);
  });
  return { years, values };
}

/** Leader concentration over time: top-1 and top-3 share of summed `key` (revenue). */
export function leaderShareLine(peers, key = 'revenue') {
  const years = unionYears(peers, key);
  const withS = peersWithSeries(peers, key);
  const top1 = [], top3 = [];
  for (const y of years) {
    const vs = withS.map((p) => seriesValueAt(p, key, y)).filter(isNum).sort((a, b) => b - a);
    const total = vs.reduce((a, b) => a + b, 0);
    top1.push(total ? +((vs[0] / total) * 100).toFixed(1) : null);
    top3.push(total ? +((vs.slice(0, 3).reduce((a, b) => a + b, 0) / total) * 100).toFixed(1) : null);
  }
  return { years, top1, top3 };
}

/** Cross-peer spread (std-dev) of a metric per year — widening = winners pulling away. */
export function dispersionLine(peers, key) {
  const years = unionYears(peers, key);
  const withS = peersWithSeries(peers, key);
  const values = years.map((y) => {
    const vs = withS.map((p) => seriesValueAt(p, key, y)).filter(isNum);
    if (vs.length < 2) return null;
    const m = vs.reduce((a, b) => a + b, 0) / vs.length;
    return +Math.sqrt(vs.reduce((a, b) => a + (b - m) ** 2, 0) / vs.length).toFixed(1);
  });
  return { years, values };
}

/** Latest-year revenue share per peer (for the market-share doughnut), largest first. */
export function revenueShare(peers) {
  const rows = peers
    .map((p) => ({ name: p.name, value: (p.current && isNum(p.current.revenue)) ? p.current.revenue : null }))
    .filter((r) => r.value != null)
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  return rows.map((r) => ({ ...r, pct: +((r.value / total) * 100).toFixed(1) }));
}

/** "Then vs now" for one metric: earliest, latest and window-average of the industry line. */
export function thenVsNow(peers, metric) {
  const line = industryLine(peers, metric.key, metric.key === 'revenue' ? 'sum' : 'median');
  const pts = line.values.map((v, i) => ({ y: line.years[i], v })).filter((o) => isNum(o.v));
  if (pts.length < 2) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const avg = pts.reduce((s, o) => s + o.v, 0) / pts.length;
  return {
    key: metric.key, label: metric.label, unit: metric.unit, format: metric.format, better: metric.better,
    firstYear: first.y, firstVal: first.v, latestYear: last.y, latestVal: last.v, avg: +avg.toFixed(2),
  };
}

/** Auto risk-scanner for one company → [{ t, s }] (s: 'high' | 'med'). Pure data rules. */
export function redFlags(peer) {
  const c = peer.current || {}, s = peer.series || {};
  const flags = [];
  const trend = (key) => {
    const v = ((s[key] && s[key].values) || []).filter(isNum);
    return v.length >= 2 ? { first: v[0], last: v[v.length - 1] } : null;
  };
  if (isNum(c.debt_equity) && c.debt_equity > 1) flags.push({ t: `High leverage — debt/equity ${c.debt_equity.toFixed(2)}×`, s: 'high' });
  if (isNum(c.interest_coverage) && c.interest_coverage < 3) flags.push({ t: `Thin interest cover (${c.interest_coverage.toFixed(1)}×)`, s: 'high' });
  if (isNum(c.pledge_pct) && c.pledge_pct > 5) flags.push({ t: `Promoter shares pledged (${Math.round(c.pledge_pct)}%)`, s: 'high' });
  const dd = trend('debtor_days'); if (dd && dd.last > dd.first * 1.25 && dd.last - dd.first > 10) flags.push({ t: `Receivable days rising (${Math.round(dd.first)}→${Math.round(dd.last)})`, s: 'med' });
  const wc = trend('wc_days'); if (wc && wc.last > wc.first * 1.3 && wc.last - wc.first > 15) flags.push({ t: `Working capital stretching (${Math.round(wc.first)}→${Math.round(wc.last)} days)`, s: 'med' });
  if (isNum(c.cfo_op) && c.cfo_op < 70) flags.push({ t: `Weak cash conversion — CFO ${Math.round(c.cfo_op)}% of profit`, s: 'med' });
  if (isNum(c.fcf) && c.fcf < 0) flags.push({ t: `Negative free cash flow`, s: 'med' });
  const em = trend('ebitda_margin'); if (em && em.last < em.first - 3) flags.push({ t: `Margins eroding (${em.first.toFixed(0)}%→${em.last.toFixed(0)}%)`, s: 'med' });
  const ph = trend('promoter_holding'); if (ph && ph.last < ph.first - 3) flags.push({ t: `Promoters trimming stake (${ph.first.toFixed(0)}%→${ph.last.toFixed(0)}%)`, s: 'med' });
  return flags;
}
