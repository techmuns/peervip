// drilldown.js — right-hand side panel with a peer's full profile + mini
// trend sparklines (self-contained inline SVG, so opening/closing is cheap).
import { esc, fmtUnit, metricMap } from './format.js';

const root = () => document.getElementById('drilldown-root');
let escHandler = null;

/** Open the drill-down for a peer within a report. */
export function openDrilldown(peer, report) {
  const mm = metricMap(report.metrics);
  const r = root();
  r.innerHTML = panelHtml(peer, report, mm);
  r.classList.add('pv-dd-open');
  document.body.style.overflow = 'hidden';

  const close = () => closeDrilldown();
  r.querySelector('[data-dd-close]').addEventListener('click', close);
  r.querySelector('.pv-dd-backdrop').addEventListener('click', close);
  escHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escHandler);
}

export function closeDrilldown() {
  const r = root();
  r.classList.remove('pv-dd-open');
  document.body.style.overflow = '';
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
  setTimeout(() => { if (!r.classList.contains('pv-dd-open')) r.innerHTML = ''; }, 320);
}

function panelHtml(peer, report, mm) {
  const cur = peer.current || {};
  const groups = [];
  const seen = new Set();
  for (const m of report.metrics) {
    if (seen.has(m.group)) continue;
    seen.add(m.group);
    groups.push(m.group);
  }

  const kpiGroups = groups.map((g) => {
    const rows = report.metrics.filter((m) => m.group === g).map((m) => {
      const v = cur[m.key];
      return `<div class="flex items-center justify-between py-1">
        <span class="text-slate-500">${esc(m.label)}</span>
        <span class="num font-semibold ${v == null ? 'text-slate-300' : 'text-slate-800'}">${esc(fmtUnit(v, m))}</span>
      </div>`;
    }).join('');
    return `<div class="mb-3">
      <div class="text-[0.7rem] font-bold uppercase tracking-wide text-slate-400 mb-1">${esc(g)}</div>
      <div class="text-[0.82rem] divide-y divide-slate-100">${rows}</div>
    </div>`;
  }).join('');

  const sparks = report.metrics
    .filter((m) => peer.series && peer.series[m.key] && peer.series[m.key].values.some((x) => x != null))
    .map((m) => sparkRow(peer.series[m.key], m)).join('');

  const src = peer.source && peer.source.url
    ? `<a href="${esc(peer.source.url)}" target="_blank" rel="noopener" class="text-indigo-600 hover:underline">${esc(peer.source.label || 'Source')} ↗</a>`
    : `<span class="text-slate-400">${esc((peer.source && peer.source.label) || '—')}</span>`;

  return `
  <div class="pv-dd-backdrop"></div>
  <aside class="pv-dd-panel" role="dialog" aria-label="${esc(peer.name)} profile">
    <div class="brand-gradient text-white px-5 py-4 flex items-start justify-between">
      <div>
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="font-display text-lg font-extrabold leading-tight">${esc(peer.name)}</h2>
          ${peer.is_seed ? '<span class="pv-chip bg-white/20 text-white text-[0.65rem] px-2 py-0.5">★ Searched</span>' : ''}
        </div>
        <div class="text-white/85 text-sm mt-0.5">
          ${peer.ticker ? `<span class="num">${esc(peer.ticker)}</span> · ` : ''}${esc(peer.business_model || '')}${peer.country ? ' · ' + esc(peer.country) : ''}
        </div>
      </div>
      <button data-dd-close aria-label="Close" class="pv-focus rounded-lg p-1.5 hover:bg-white/20 transition -mr-1 -mt-1">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>

    <div class="overflow-y-auto px-5 py-4 grow">
      ${peer.products ? `<p class="text-sm text-slate-600 mb-1"><span class="font-semibold text-slate-700">Products:</span> ${esc(peer.products)}</p>` : ''}
      ${peer.note ? `<p class="text-sm text-slate-500 mb-3 italic">${esc(peer.note)}</p>` : '<div class="mb-2"></div>'}
      <p class="text-xs text-slate-500 mb-4">Source: ${src}</p>

      ${sparks ? `<div class="mb-5">
        <div class="text-[0.7rem] font-bold uppercase tracking-wide text-slate-400 mb-2">Trends</div>
        <div class="grid grid-cols-1 gap-2">${sparks}</div>
      </div>` : ''}

      <div class="text-[0.7rem] font-bold uppercase tracking-wide text-slate-400 mb-2">All metrics</div>
      ${kpiGroups}
    </div>
  </aside>`;
}

function sparkRow(series, metric) {
  const pts = series.years.map((y, i) => ({ y, v: series.values[i] })).filter((p) => p.v != null);
  const last = pts.length ? pts[pts.length - 1].v : null;
  const first = pts.length ? pts[0].v : null;
  let arrow = '';
  if (pts.length >= 2 && first != null && last != null) {
    const up = last > first;
    const good = metric.better === 'neutral' ? null : (metric.better === 'high' ? up : !up);
    const cls = good === null ? 'text-slate-400' : good ? 'text-emerald-600' : 'text-rose-500';
    arrow = `<span class="${cls} text-xs font-bold">${up ? '▲' : '▼'}</span>`;
  }
  return `<div class="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
    <div class="grow min-w-0">
      <div class="text-[0.72rem] text-slate-500 truncate">${esc(metric.label)}</div>
      <div class="num text-sm font-semibold text-slate-800">${esc(fmtUnit(last, metric))} ${arrow}</div>
    </div>
    <div class="pv-spark shrink-0">${sparkSvg(series.values)}</div>
  </div>`;
}

/** Tiny sparkline for a values array (nulls skipped). */
export function sparkSvg(values, w = 116, h = 34) {
  const pts = values.map((v, i) => ({ i, v })).filter((p) => p.v != null && isFinite(p.v));
  if (pts.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const xs = values.length - 1;
  const vs = pts.map((p) => p.v);
  let min = Math.min(...vs), max = Math.max(...vs);
  if (max === min) { max += 1; min -= 1; }
  const pad = 3;
  const X = (i) => pad + (i / xs) * (w - 2 * pad);
  const Y = (v) => h - pad - ((v - min) / (max - min)) * (h - 2 * pad);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const area = `${d} L${X(pts[pts.length - 1].i).toFixed(1)},${h - pad} L${X(pts[0].i).toFixed(1)},${h - pad} Z`;
  const rising = vs[vs.length - 1] >= vs[0];
  const stroke = rising ? '#6366f1' : '#ec4899';
  const gid = 'sg' + Math.random().toString(36).slice(2, 8);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${stroke}" stop-opacity="0.22"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${X(pts[pts.length - 1].i).toFixed(1)}" cy="${Y(pts[pts.length - 1].v).toFixed(1)}" r="2.6" fill="${stroke}"/>
  </svg>`;
}
