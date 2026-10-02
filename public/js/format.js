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

/**
 * Fiscal year (integer) from a Screener period label, or null.
 * Buckets differing year-ends by their stated year ("Mar 2016" & "Dec 2016" → 2016)
 * and SKIPS non-annual transition stubs like "Mar 2016 9m" / "Mar 2023 15m", which
 * aren't comparable full-year figures. Lets peers with mismatched fiscal calendars
 * be aligned onto one FY axis.
 */
export function fiscalYear(label) {
  const s = String(label == null ? '' : label);
  if (/\b\d{1,2}\s*m\b/i.test(s)) return null; // 9m / 15m / 18m transition period
  const m = /(\d{4})/.exec(s);
  return m ? parseInt(m[1], 10) : null;
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

/**
 * Screener.in company URL for a peer, or '' when we can't/shouldn't link (foreign
 * listing or unlisted/private — Screener only covers Indian listings). Prefers the
 * pipeline-set source URL; falls back to building one from the ticker.
 */
export function screenerHref(p) {
  if (!p) return '';
  const u = (p.source && p.source.url) || '';
  if (/screener\.in\/company\//i.test(u)) return u;
  const t = p.ticker ? String(p.ticker).trim() : '';
  const ex = String(p.exchange || '');
  const foreign = /NASDAQ|NYSE|LSE|HKEX|SGX|TSX|ASX|TSE|SSE|SZSE|KRX|FRA|AMS|EPA|BIT|OTC|NIKKEI/i.test(ex) || !!p.country;
  if (t && !foreign) return `https://www.screener.in/company/${encodeURIComponent(t)}/`;
  return '';
}

/**
 * A company name as a Screener link (new tab) when we have one, else plain text.
 * stopPropagation keeps a click from also triggering a surrounding row handler
 * (e.g. the drill-down that opens on a table row). `cls` adds extra classes.
 */
export function companyNameHtml(p, cls = '') {
  const name = esc((p && p.name) || '');
  const href = screenerHref(p);
  if (!href) return `<span class="${cls}">${name}</span>`;
  return `<a href="${esc(href)}" target="_blank" rel="noopener" class="pv-clink ${cls}" title="Open ${name} on Screener ↗" onclick="event.stopPropagation()">${name}</a>`;
}
