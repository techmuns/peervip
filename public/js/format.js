// format.js — number formatting + tiny DOM/string helpers. No dependencies.

const DASH = '—';

/** HTML-escape untrusted strings before inserting into innerHTML. */
export function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a string for use inside an HTML attribute value. */
export function escAttr(v) { return esc(v); }

function isNum(v) { return typeof v === 'number' && isFinite(v); }

// Grouped thousands with a fixed number of decimal places.
function grouped(n, dp) {
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/**
 * Format a raw metric value per a format code.
 * Codes: num0, num1, num2, pct1 (percentages are stored as plain numbers, e.g. 23.5 => "23.5").
 * Returns "—" for null/undefined/non-finite.
 */
export function fmt(value, format = 'num1') {
  if (!isNum(value)) return DASH;
  switch (format) {
    case 'num0': return grouped(value, 0);
    case 'num1': return grouped(value, 1);
    case 'num2': return grouped(value, 2);
    case 'pct1': return value.toFixed(1);
    default: return grouped(value, 1);
  }
}

/** Value + unit for display (e.g. "23.5%", "1,450 Rs Cr", "0.15x"). */
export function fmtUnit(value, metric) {
  const s = fmt(value, metric.format);
  if (s === DASH) return DASH;
  const u = metric.unit || '';
  if (u === '%') return s + '%';
  if (u === 'x') return s + 'x';
  if (u === 'days') return s + ' days';
  if (u) return s + ' ' + u;
  return s;
}

/** Short label for a KPI value with unit inline. */
export function fmtCompact(value, metric) {
  if (!isNum(value)) return DASH;
  if (metric.unit === '%') return fmt(value, 'pct1') + '%';
  if (metric.unit === 'x') return fmt(value, metric.format) + 'x';
  if (metric.unit === 'Rs Cr' && Math.abs(value) >= 1000) {
    return '₹' + (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k Cr';
  }
  if (metric.unit === 'Rs Cr') return '₹' + fmt(value, 'num0') + ' Cr';
  return fmtUnit(value, metric);
}

export { DASH };

/** Build a lookup { key: metric } from the metrics array. */
export function metricMap(metrics) {
  const m = {};
  for (const met of metrics) m[met.key] = met;
  return m;
}

/** Sort helper for FY-style year labels ("FY19".."FY25") — falls back to string compare. */
export function yearSortKey(y) {
  const m = /(\d{2,4})/.exec(String(y));
  return m ? parseInt(m[1], 10) : 0;
}

/** Human date, e.g. "28 Sep 2026". */
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Business-model pill class (matches styles.css bm-* rules). */
export function bmClass(model) {
  if (!model) return 'bm-default';
  const key = String(model).split(/[\s(]/)[0]; // "Manufacturer (integrated)" -> "Manufacturer"
  const known = ['Manufacturer', 'Trader-Distributor', 'Importer-Sourcing', 'Integrated'];
  return known.includes(key) ? 'bm-' + key : 'bm-default';
}
