// tables.js — the Indian/Global bucket tabs: a "Current <-> Trends" toggle over
//  * Current: one wide data-grid (frozen company col, sticky header, cross-sectional
//    conditional formatting + best-in-column crown, pinned Median/Average rows,
//    row click -> drill-down panel).
//  * Trends: foldable sections (one per metric with series), companies as rows and
//    years as columns (like-for-like), temporal conditional formatting, and a
//    per-section Table <-> Charts sub-toggle (Chart.js multi-line + dashed median).
import { esc, fmt, bmClass } from './format.js';
import {
  currentValues, medianRow, averageRow,
  peersWithSeries, unionYears, seriesValueAt, seriesAggregate, metricsWithSeries,
} from './compute.js';
import { crossClass, trendClass } from './conditional.js';
import { makeLine, destroyChart } from './charts.js';
import { openDrilldown } from './drilldown.js';

/** Render a bucket tab (peers + Current/Trends toggle) into `container`. */
export function renderBucketView(container, { peers, report, bucket }) {
  destroyBucketCharts(container);
  if (!peers.length) {
    container.innerHTML = emptyState(`No ${bucket} peers in this report.`);
    return;
  }
  const state = { view: 'current' };

  container.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap mb-4">
      <div class="inline-flex rounded-xl bg-slate-100 p-1 text-sm font-semibold" role="tablist" aria-label="View">
        <button data-view="current" class="pv-focus rounded-lg px-4 py-1.5 transition" role="tab">Current</button>
        <button data-view="trends"  class="pv-focus rounded-lg px-4 py-1.5 transition" role="tab">Trends</button>
      </div>
      <p class="text-xs text-slate-400">${peers.length} peers · click any row for a full profile</p>
    </div>
    <div data-pane="current"></div>
    <div data-pane="trends" hidden></div>`;

  const paneCurrent = container.querySelector('[data-pane="current"]');
  const paneTrends = container.querySelector('[data-pane="trends"]');
  paneCurrent.innerHTML = currentTableHtml(peers, report);
  renderTrends(paneTrends, peers, report);
  wireRowClicks(paneCurrent, peers, report);

  const setView = (v) => {
    state.view = v;
    paneCurrent.hidden = v !== 'current';
    paneTrends.hidden = v !== 'trends';
    container.querySelectorAll('[data-view]').forEach((b) => {
      const on = b.dataset.view === v;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.classList.toggle('bg-white', on);
      b.classList.toggle('shadow-sm', on);
      b.classList.toggle('text-indigo-600', on);
      b.classList.toggle('text-slate-500', !on);
    });
  };
  container.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  setView('current');
}

/** Destroy any Chart.js instances inside a container (call before discarding it). */
export function destroyBucketCharts(container) {
  container.querySelectorAll('canvas').forEach((c) => destroyChart(c));
}

// ---------------------------------------------------------------- Current
function currentTableHtml(peers, report) {
  const metrics = report.metrics;
  const mRow = medianRow(peers, metrics);
  const aRow = averageRow(peers, metrics);
  // per-metric value arrays for conditional formatting (relative to shown peers)
  const colVals = {};
  for (const m of metrics) colVals[m.key] = currentValues(peers, m.key);

  const head = `<thead><tr>
    <th class="pv-col1">Company</th>
    ${metrics.map((m) => `<th title="${esc(m.label)}${m.unit ? ' (' + esc(m.unit) + ')' : ''}">${esc(m.label)}<span class="pv-th-unit">${esc(unitLabel(m))}</span></th>`).join('')}
    <th style="text-align:center">Business<br>Model</th>
  </tr></thead>`;

  const body = peers.map((p, idx) => {
    const cur = p.current || {};
    const cells = metrics.map((m) => {
      const v = cur[m.key];
      const { cls, best } = crossClass(v, colVals[m.key], m.better);
      const crown = best ? '<span class="pv-crown" title="Best in peer set">▲</span>' : '';
      return `<td class="num ${cls} ${best ? 'cf-best' : ''}">${esc(fmt(v, m.format))}${crown}</td>`;
    }).join('');
    return `<tr class="pv-row" data-peer-idx="${idx}">
      <td class="pv-col1">
        <div class="font-semibold text-slate-800 flex items-center gap-1.5">${esc(p.name)}${p.is_seed ? '<span class="text-amber-500" title="Searched company">★</span>' : ''}</div>
        <div class="text-[0.7rem] text-slate-400 num">${esc(p.ticker || p.country || '')}</div>
      </td>
      ${cells}
      <td style="text-align:center"><span class="pv-chip ${bmClass(p.business_model)} px-2 py-0.5 text-[0.68rem]">${esc(p.business_model || '—')}</span></td>
    </tr>`;
  }).join('');

  const refRow = (label, row) => `<tr class="pv-ref">
    <td class="pv-col1">${label}</td>
    ${metrics.map((m) => `<td class="num">${esc(fmt(row[m.key], m.format))}</td>`).join('')}
    <td></td>
  </tr>`;

  return `<div class="pv-scroll"><table class="pv-table">
    ${head}
    <tbody>${body}${refRow('Median', mRow)}${refRow('Average', aRow)}</tbody>
  </table></div>
  <p class="text-[0.72rem] text-slate-400 mt-2">Green = better vs peers · red = worse · <span class="pv-crown">▲</span> best in column. Median &amp; Average computed live from the table.</p>`;
}

function wireRowClicks(pane, peers, report) {
  pane.querySelectorAll('tr.pv-row').forEach((tr) => {
    tr.addEventListener('click', () => {
      const p = peers[Number(tr.dataset.peerIdx)];
      if (p) openDrilldown(p, report);
    });
  });
}

// ---------------------------------------------------------------- Trends
function renderTrends(pane, peers, report) {
  const metrics = metricsWithSeries(peers, report.metrics);
  if (!metrics.length) { pane.innerHTML = emptyState('No multi-year series available for these peers yet.'); return; }

  pane.innerHTML = `<div class="space-y-3">${metrics.map((m, i) => trendSectionHtml(m, i === 0)).join('')}</div>
    <p class="text-[0.72rem] text-slate-400 mt-3">Each series starts where its real data begins — blank cells are genuinely missing, never fabricated. Green/red shade each year vs the prior year in the good direction.</p>`;

  // wire each section
  metrics.forEach((m) => {
    const sec = pane.querySelector(`[data-metric="${m.key}"]`);
    const inner = sec.querySelector('[data-inner]');
    const mode = { current: 'table' };
    const render = () => {
      destroyChart(inner.querySelector('canvas'));
      if (mode.current === 'table') inner.innerHTML = trendTableHtml(peers, report, m);
      else { inner.innerHTML = `<div class="h-72 sm:h-80"><canvas></canvas></div>`; buildTrendChart(inner.querySelector('canvas'), peers, report, m); }
      sec.querySelectorAll('[data-tmode]').forEach((b) => {
        const on = b.dataset.tmode === mode.current;
        b.classList.toggle('bg-white', on); b.classList.toggle('shadow-sm', on);
        b.classList.toggle('text-indigo-600', on); b.classList.toggle('text-slate-500', !on);
      });
    };
    sec.querySelectorAll('[data-tmode]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      mode.current = b.dataset.tmode; render();
    }));
    // render table lazily on first open (and immediately for the first, open section)
    let built = false;
    const ensure = () => { if (!built) { built = true; render(); } };
    const details = sec;
    details.addEventListener('toggle', () => { if (details.open) ensure(); });
    if (details.open) ensure();
  });
}

function trendSectionHtml(metric, open) {
  return `<details class="pv-fold pv-card overflow-hidden" data-metric="${esc(metric.key)}" ${open ? 'open' : ''}>
    <summary class="flex items-center justify-between gap-3 px-4 py-3">
      <span class="flex items-center gap-2 min-w-0">
        <svg class="pv-chev shrink-0 text-slate-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        <span class="font-display font-bold text-slate-800 truncate">${esc(metric.label)}</span>
        <span class="text-[0.68rem] text-slate-400 hidden sm:inline">${esc(metric.group)}${metric.unit ? ' · ' + esc(metric.unit) : ''}</span>
      </span>
      <span class="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold shrink-0">
        <button data-tmode="table" class="pv-focus rounded-md px-2.5 py-1 transition">Table</button>
        <button data-tmode="charts" class="pv-focus rounded-md px-2.5 py-1 transition">Charts</button>
      </span>
    </summary>
    <div class="px-4 pb-4" data-inner></div>
  </details>`;
}

function trendTableHtml(peers, report, metric) {
  const key = metric.key;
  const rows = peersWithSeries(peers, key);
  const years = unionYears(peers, key);
  if (!years.length) return emptyState('No series for this metric.');

  const head = `<thead><tr><th class="pv-col1">Company</th>${years.map((y) => `<th style="text-align:right">${esc(y)}</th>`).join('')}</tr></thead>`;

  const bodyRow = (p) => {
    let prev = null;
    const cells = years.map((y) => {
      const v = seriesValueAt(p, key, y);
      const cls = trendClass(v, prev, metric.better);
      prev = v == null ? prev : v; // compare to most recent real prior year
      return `<td class="num ${cls}">${esc(fmt(v, metric.format))}</td>`;
    }).join('');
    return `<tr><td class="pv-col1"><span class="font-semibold text-slate-800">${esc(p.name)}</span>${p.is_seed ? ' <span class="text-amber-500">★</span>' : ''}</td>${cells}</tr>`;
  };

  const med = seriesAggregate(peers, key, years, 'median');
  const avg = seriesAggregate(peers, key, years, 'average');
  const refRow = (label, vals) => `<tr class="pv-ref"><td class="pv-col1">${label}</td>${vals.map((v) => `<td class="num">${esc(fmt(v, metric.format))}</td>`).join('')}</tr>`;

  return `<div class="pv-scroll" style="max-height:56vh"><table class="pv-table">
    ${head}<tbody>${rows.map(bodyRow).join('')}${refRow('Median', med)}${refRow('Average', avg)}</tbody>
  </table></div>`;
}

function buildTrendChart(canvas, peers, report, metric) {
  const key = metric.key;
  const years = unionYears(peers, key);
  const rows = peersWithSeries(peers, key);
  const series = rows.map((p) => ({ label: p.name, values: years.map((y) => seriesValueAt(p, key, y)) }));
  const medianValues = seriesAggregate(peers, key, years, 'median');
  makeLine(canvas, { years, series, medianValues, unit: metric.unit, area: false });
}

// ---------------------------------------------------------------- shared
function unitLabel(m) {
  if (!m.unit) return '';
  if (m.unit === '%') return '%';
  if (m.unit === 'x') return '×';
  return m.unit;
}
function emptyState(msg) {
  return `<div class="text-center text-slate-400 py-12 text-sm">${esc(msg)}</div>`;
}
