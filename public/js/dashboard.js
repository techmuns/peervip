// dashboard.js — the dashboard view: header + actions, outperformer banner,
// animated tabs, and the Overview / Private tabs. Delegates Indian/Global to
// tables.js, Scorecard to scorecard.js and the one-pager to report.js.
import { esc, fmtDate, fmtCompact, metricMap, bmClass } from './format.js';
import { median } from './compute.js';
import { setupCharts, makeHBar, makeDoughnut, destroyChart } from './charts.js';
import { renderBucketView } from './tables.js';
import { renderScorecard } from './scorecard.js';
import { renderReport } from './report.js';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'indian', label: 'Indian Listed' },
  { key: 'global', label: 'Global Listed' },
  { key: 'private', label: 'Private' },
  { key: 'scorecard', label: 'Scorecard' },
  { key: 'report', label: 'Report' },
];
const BM_BUCKETS = ['Manufacturer', 'Trader-Distributor', 'Importer-Sourcing', 'Integrated'];

export function renderDashboard(appEl, report, { onBack, onRefresh }) {
  setupCharts();
  const mm = metricMap(report.metrics);
  const allPeers = [...(report.peers.indian || []), ...(report.peers.global || []), ...(report.peers.private || [])];

  appEl.innerHTML = `
    <div class="max-w-[110rem] mx-auto px-4 sm:px-6 py-5">
      ${headerHtml(report)}
      ${bannerHtml(report)}
      <div class="pv-tabs mt-6 border-b border-slate-200 overflow-x-auto">
        <div class="flex gap-1 sm:gap-2 min-w-max relative" role="tablist">
          ${TABS.map((t) => `<button class="pv-tab pv-focus px-3 sm:px-4 py-2.5 text-sm font-semibold text-slate-500" role="tab" data-tab="${t.key}">${t.label}</button>`).join('')}
          <span class="pv-tab-underline" style="left:0;width:0"></span>
        </div>
      </div>
      <div id="tab-content" class="py-5"></div>
    </div>`;

  // header actions
  appEl.querySelector('[data-back]').addEventListener('click', onBack);
  appEl.querySelector('[data-excel]').addEventListener('click', async (e) => {
    const btn = e.currentTarget; const old = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = 'Preparing…';
    try { const { exportExcel } = await import('./excel.js'); await exportExcel(report); }
    catch (err) { console.error(err); alert('Could not build the Excel file.'); }
    finally { btn.disabled = false; btn.innerHTML = old; }
  });
  appEl.querySelector('[data-onepager]').addEventListener('click', () => { setTab('report'); setTimeout(() => window.print(), 350); });
  const refreshBtn = appEl.querySelector('[data-refresh]');
  if (refreshBtn) refreshBtn.addEventListener('click', () => { if (onRefresh) onRefresh(report.meta && report.meta.query); });

  const content = appEl.querySelector('#tab-content');
  const underline = appEl.querySelector('.pv-tab-underline');
  const tabButtons = [...appEl.querySelectorAll('[data-tab]')];
  let active = null;

  function moveUnderline(btn) {
    underline.style.left = btn.offsetLeft + 'px';
    underline.style.width = btn.offsetWidth + 'px';
  }

  function setTab(key) {
    if (key === active) return;
    active = key;
    destroyChartsIn(content);
    tabButtons.forEach((b) => {
      const on = b.dataset.tab === key;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) { moveUnderline(b); b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    });
    content.innerHTML = '';
    const pane = document.createElement('div');
    pane.className = 'pv-fade-in';
    content.appendChild(pane);
    renderTab(key, pane, report, mm, allPeers);
  }

  tabButtons.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  window.addEventListener('resize', () => { const on = tabButtons.find((b) => b.dataset.tab === active); if (on) moveUnderline(on); });

  setTab('overview');
}

function renderTab(key, pane, report, mm, allPeers) {
  switch (key) {
    case 'overview': return renderOverview(pane, report, mm, allPeers);
    case 'indian': return renderBucketView(pane, { peers: report.peers.indian || [], report, bucket: 'Indian Listed' });
    case 'global': return renderBucketView(pane, { peers: report.peers.global || [], report, bucket: 'Global Listed' });
    case 'private': return renderPrivate(pane, report);
    case 'scorecard': return renderScorecard(pane, report);
    case 'report': return renderReport(pane, report);
  }
}

// ---------------------------------------------------------------- header
function headerHtml(report) {
  const m = report.meta;
  return `<header class="flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
    <div class="flex items-start gap-3 min-w-0">
      <div class="shrink-0 w-11 h-11 rounded-2xl brand-gradient flex items-center justify-center text-white font-display font-extrabold text-lg shadow-sm">P</div>
      <div class="min-w-0">
        <h1 class="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight truncate">${esc(m.name)}</h1>
        <p class="text-slate-500 text-sm">${esc(m.segment || '')}${m.seed_company ? ` · searched: <span class="font-semibold text-slate-600">${esc(m.seed_company)}</span>` : ''}</p>
        <p class="text-xs text-slate-400 mt-0.5">Updated ${esc(fmtDate(m.generated_at))}${timeAgo(m.generated_at) ? ` <span class="text-slate-400">(${esc(timeAgo(m.generated_at))})</span>` : ''} · ${esc(String((m.coverage && m.coverage.peers_total) || 0))} peers · <span title="peers with full financials / confidence">${esc(String((m.coverage && m.coverage.with_full_financials) ?? '—'))} with financials · confidence ${esc((m.coverage && m.coverage.confidence) || '—')}</span>${m.sample ? ' · <span class="text-amber-600 font-semibold">sample data</span>' : ''}</p>
      </div>
    </div>
    <div class="flex items-center gap-2 shrink-0 flex-wrap">
      <button data-back class="pv-focus inline-flex items-center gap-1.5 rounded-xl bg-white ring-1 ring-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg> Back
      </button>
      <button data-excel class="pv-focus inline-flex items-center gap-1.5 rounded-xl bg-white ring-1 ring-emerald-200 px-3.5 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 transition">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13l6 6M15 13l-6 6"/></svg> Export Excel
      </button>
      <button data-onepager class="pv-focus inline-flex items-center gap-1.5 rounded-xl brand-gradient px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg> One-pager
      </button>
      <button data-refresh title="Re-research this ${esc(report.meta.type === 'company' ? 'company' : 'industry')} with fresh data" class="pv-focus inline-flex items-center gap-1.5 rounded-xl bg-white ring-1 ring-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg> Refresh
      </button>
    </div>
  </header>`;
}

/** Compact "time ago" from an ISO date (returns '' if unknown/future). */
function timeAgo(iso) {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 0) return '';
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// ---------------------------------------------------------------- banner
function bannerHtml(report) {
  const o = report.outperformer;
  if (!o) return '';
  return `<div class="mt-5 rounded-2xl p-[1.5px] brand-gradient shadow-sm">
    <div class="rounded-2xl bg-white px-5 py-4 sm:px-6 sm:py-5">
      <div class="flex flex-col sm:flex-row sm:items-center gap-4">
        <div class="shrink-0 flex items-center gap-3">
          <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center text-2xl shadow-sm">👑</div>
          <div>
            <div class="text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">Outperformer</div>
            <div class="font-display text-xl font-extrabold text-slate-900 leading-tight">${esc(o.company)}</div>
          </div>
        </div>
        <div class="grow min-w-0">
          <p class="text-slate-700 font-medium">${esc(o.headline || '')}</p>
          ${o.reason ? `<p class="text-sm text-slate-500 mt-1 leading-relaxed">${esc(o.reason)}</p>` : ''}
        </div>
        ${o.india_vs_global ? `<div class="shrink-0 sm:max-w-xs">
          <div class="rounded-xl bg-sky-50 ring-1 ring-sky-100 px-3 py-2">
            <div class="text-[0.65rem] font-bold uppercase tracking-wide text-sky-500 mb-0.5">🌍 India vs Global</div>
            <p class="text-xs text-sky-800 leading-snug">${esc(o.india_vs_global)}</p>
          </div>
        </div>` : ''}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- Overview
function renderOverview(pane, report, mm, allPeers) {
  const headline = mm.ebitda_margin || report.metrics.find((m) => m.group === 'Profitability' && m.better !== 'neutral') || report.metrics[0];
  // peers (any bucket) that have the headline metric, sorted best-first
  const withVal = allPeers.filter((p) => p.current && isFinite(p.current[headline.key]))
    .map((p) => ({ name: p.name, value: p.current[headline.key], seed: p.is_seed }))
    .sort((a, b) => headline.better === 'low' ? a.value - b.value : b.value - a.value);
  const medVal = median(withVal.map((d) => d.value));
  const o = report.outperformer || {};
  const hiIdx = withVal.findIndex((d) => d.name === o.company);

  // business-model split
  const counts = {};
  for (const p of allPeers) {
    const key = bmBucket(p.business_model);
    counts[key] = (counts[key] || 0) + 1;
  }
  const bmLabels = Object.keys(counts);
  const bmValues = bmLabels.map((k) => counts[k]);

  pane.innerHTML = `
    <div class="grid gap-5 lg:grid-cols-3">
      <section class="pv-card p-5 lg:col-span-2">
        <div class="flex items-baseline justify-between gap-3 flex-wrap mb-1">
          <h3 class="font-display text-lg font-extrabold text-slate-800">${esc(headline.label)} across peers</h3>
          <span class="text-xs text-slate-400">dashed line = median${medVal != null ? ' (' + esc(fmtCompact(medVal, headline)) + ')' : ''}</span>
        </div>
        <p class="text-xs text-slate-400 mb-3">All peers with data · ${esc(o.company || '')} highlighted in amber</p>
        <div style="height:${Math.max(220, withVal.length * 34 + 40)}px"><canvas data-chart="headline"></canvas></div>
      </section>

      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Business-model split</h3>
        <p class="text-xs text-slate-400 mb-3">How the ${esc(String(allPeers.length))} peers make money</p>
        <div style="height:260px"><canvas data-chart="bm"></canvas></div>
      </section>
    </div>

    <section class="mt-5 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5">
      <div class="flex items-start gap-3">
        <div class="shrink-0 w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center text-lg">🏆</div>
        <div>
          <h3 class="font-display font-extrabold text-emerald-900">${esc(o.company || 'Outperformer')} leads the set</h3>
          <p class="text-sm text-emerald-800/90 mt-1 leading-relaxed max-w-4xl">${esc(o.reason || o.headline || '')}</p>
        </div>
      </div>
    </section>`;

  makeHBar(pane.querySelector('[data-chart="headline"]'), {
    labels: withVal.map((d) => d.name),
    values: withVal.map((d) => d.value),
    medianValue: medVal,
    unit: headline.unit,
    highlightIndex: hiIdx,
  });
  makeDoughnut(pane.querySelector('[data-chart="bm"]'), { labels: bmLabels, values: bmValues });
}

function bmBucket(model) {
  if (!model) return 'Other';
  const first = String(model).split(/[\s(]/)[0];
  const found = BM_BUCKETS.find((b) => first === b || model === b);
  return found || (BM_BUCKETS.includes(first) ? first : 'Other');
}

// ---------------------------------------------------------------- Private
function renderPrivate(pane, report) {
  const peers = report.peers.private || [];
  if (!peers.length) { pane.innerHTML = `<div class="pv-card p-8 text-center text-slate-400">No private peers identified for this set.</div>`; return; }
  const rows = peers.map((p) => `<tr class="border-b border-slate-100 hover:bg-slate-50 transition">
    <td class="px-4 py-3 font-semibold text-slate-800">${esc(p.name)}</td>
    <td class="px-4 py-3"><span class="pv-chip ${bmClass(p.business_model)} px-2 py-0.5 text-[0.7rem]">${esc(p.business_model || '—')}</span></td>
    <td class="px-4 py-3 text-slate-600">${esc(p.products || '—')}</td>
    <td class="px-4 py-3 text-slate-500 text-sm">${esc(p.note || '—')}</td>
    <td class="px-4 py-3 text-sm">${p.source && p.source.url ? `<a href="${esc(p.source.url)}" target="_blank" rel="noopener" class="text-indigo-600 hover:underline">${esc(p.source.label || 'Source')} ↗</a>` : `<span class="text-slate-400">${esc((p.source && p.source.label) || '—')}</span>`}</td>
  </tr>`).join('');
  pane.innerHTML = `
    <div class="pv-card p-5">
      <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Private &amp; unlisted peers</h3>
      <p class="text-xs text-slate-400 mb-4">Financials are not publicly disclosed for these players — shown for completeness of the peer landscape.</p>
      <div class="overflow-x-auto rounded-xl border border-slate-100">
        <table class="w-full text-sm border-collapse min-w-[40rem]">
          <thead><tr class="bg-slate-50 text-slate-500">
            <th class="px-4 py-2.5 text-left font-semibold">Company</th>
            <th class="px-4 py-2.5 text-left font-semibold">Business Model</th>
            <th class="px-4 py-2.5 text-left font-semibold">Products</th>
            <th class="px-4 py-2.5 text-left font-semibold">Note</th>
            <th class="px-4 py-2.5 text-left font-semibold">Source</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- util
function destroyChartsIn(el) { el.querySelectorAll('canvas').forEach((c) => destroyChart(c)); }
