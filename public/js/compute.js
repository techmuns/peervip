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
