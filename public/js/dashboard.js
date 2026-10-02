// dashboard.js — the dashboard view: header + actions, outperformer banner,
// animated tabs, and the Overview + Global/Private tabs. Delegates the Indian
// numbers table to tables.js, Scorecard to scorecard.js, Industry to industry.js.
import { esc, fmtDate, fmtCompact, metricMap, bmClass } from './format.js';
import { median, compositeScores, redFlags, revenueShare } from './compute.js';
import { setupCharts, makeHBar, makeDoughnut, destroyChart } from './charts.js';
import { renderBucketView } from './tables.js';
import { renderScorecard } from './scorecard.js';
import { renderIndustry } from './industry.js';
import { applyOverlay } from './peers.js';

const normN = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'indian', label: 'Indian Listed' },
  { key: 'external', label: 'Global & Private' },
  { key: 'scorecard', label: 'Scorecard' },
  { key: 'industry', label: 'Industry' },
];
const BM_BUCKETS = ['Manufacturer', 'Trader-Distributor', 'Importer-Sourcing', 'Integrated'];

export function renderDashboard(appEl, report, { onBack, onRefresh }) {
  setupCharts();
  const overlay = applyOverlay(report); // user Add/Remove-peer overlay (localStorage)
  const editCtx = { slug: report.meta && report.meta.slug, overlay };
  editCtx.refreshBanner = () => {
    const b = appEl.querySelector('[data-banner]');
    if (b) b.innerHTML = bannerHtml(report);
  };
  const mm = metricMap(report.metrics);
  const allPeers = [...(report.peers.indian || []), ...(report.peers.global || []), ...(report.peers.private || [])];

  appEl.innerHTML = `
    <div class="max-w-[110rem] mx-auto px-4 sm:px-6 py-5">
      ${headerHtml(report)}
      <div data-banner>${bannerHtml(report)}</div>
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
    renderTab(key, pane, report, mm, allPeers, editCtx);
  }

  tabButtons.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  // Web fonts (Plus Jakarta Sans) load async and change tab widths, so the
  // underline measured at first paint can be off — realign once fonts are ready.
  const realignUnderline = () => { const on = tabButtons.find((b) => b.dataset.tab === active); if (on) moveUnderline(on); };
  window.addEventListener('resize', realignUnderline);
  window.addEventListener('load', realignUnderline);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(realignUnderline);
  setTimeout(realignUnderline, 250);

  setTab('overview');
}

function renderTab(key, pane, report, mm, allPeers, editCtx) {
  switch (key) {
    case 'overview': return renderOverview(pane, report, mm, allPeers);
    case 'industry': return renderIndustry(pane, report);
    case 'indian': return renderBucketView(pane, { peers: report.peers.indian || [], report, bucket: 'Indian Listed', edit: editCtx });
    case 'external': return renderExternalPeers(pane, report);
    case 'scorecard': return renderScorecard(pane, report);
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
  const raw = report.outperformer;
  if (!raw) return '';
  const indian = report.peers.indian || [];
  const present = raw.company && indian.some((p) => normN(p.name) === normN(raw.company));
  let o = raw, live = false;
  if (!present && indian.length) {
    const s = compositeScores(indian, report.metrics).filter((x) => x.score != null).sort((a, b) => b.score - a.score)[0];
    if (s) { o = { company: s.name, headline: 'Top of your current peer set by the live composite score', reason: '', india_vs_global: '' }; live = true; }
  }
  return `<div class="mt-5 rounded-2xl p-[1.5px] brand-gradient shadow-sm">
    <div class="rounded-2xl bg-white px-5 py-4 sm:px-6 sm:py-5">
      <div class="flex flex-col sm:flex-row sm:items-center gap-4">
        <div class="shrink-0 flex items-center gap-3">
          <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center text-2xl shadow-sm">👑</div>
          <div>
            <div class="text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">${live ? 'Top of your set' : 'Outperformer'}</div>
            <div class="font-display text-xl font-extrabold text-slate-900 leading-tight">${esc(o.company)}</div>
          </div>
        </div>
        <div class="grow min-w-0">
          <p class="text-slate-800 font-semibold leading-snug">${esc(o.headline || '')}</p>
          ${o.reason ? `<p class="text-sm text-slate-600 mt-1 leading-relaxed">${esc(o.reason)}</p>` : ''}
          ${live ? `<p class="text-[0.7rem] text-slate-400 mt-1">The AI's original crowned pick was removed — this is the current leader by the live score.</p>` : ''}
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
  allPeers = [...(report.peers.indian || []), ...(report.peers.global || []), ...(report.peers.private || [])]; // fresh after Add/Remove
  const finPeers = report.peers.indian || []; // Indian listed = the benchmarked set
  const o = report.outperformer || {};

  // metrics at least one Indian peer has data for — the dropdown choices
  const selectable = report.metrics.filter((m) => finPeers.some((p) => p.current && isFinite(p.current[m.key])));
  const defaultMetric = (mm.ebitda_margin && selectable.includes(mm.ebitda_margin) ? mm.ebitda_margin : null)
    || selectable.find((m) => m.group === 'Profitability' && m.better !== 'neutral')
    || selectable[0] || report.metrics[0];

  const counts = { indian: (report.peers.indian || []).length, global: (report.peers.global || []).length, private: (report.peers.private || []).length };
  const bm = {};
  for (const p of allPeers) { const k = bmBucket(p.business_model); bm[k] = (bm[k] || 0) + 1; }
  const bmRows = Object.entries(bm).sort((a, b) => b[1] - a[1]).map(([k, n]) => `
    <div class="flex items-center justify-between py-1">
      <span class="pv-chip ${bmClass(k)} px-2 py-0.5 text-[0.68rem]">${esc(k)}</span>
      <span class="num font-semibold text-slate-700">${n}</span>
    </div>`).join('');

  // Overview extras: auto red-flag scanner + market-share doughnut (from the trends).
  const flagged = finPeers.map((p) => ({ p, flags: redFlags(p) })).sort((a, b) => b.flags.length - a.flags.length);
  const totalFlags = flagged.reduce((s, f) => s + f.flags.length, 0);
  const rfHtml = flagged.map(({ p, flags }) => {
    const high = flags.some((f) => f.s === 'high');
    const badge = flags.length === 0
      ? '<span class="pv-flag-clean">✓ clean</span>'
      : `<span class="pv-flag-badge ${high ? 'pv-flag-high' : 'pv-flag-med'}">⚑ ${flags.length}</span>`;
    const chips = flags.length ? `<div class="flex flex-wrap gap-1 mt-1">${flags.map((f) => `<span class="pv-flag-chip ${f.s === 'high' ? 'pv-flag-high' : 'pv-flag-med'}">${esc(f.t)}</span>`).join('')}</div>` : '';
    return `<div class="py-2 border-b border-slate-50 last:border-0">
      <div class="flex items-center justify-between gap-2"><span class="font-semibold text-slate-800 text-sm truncate">${esc(p.name)}</span>${badge}</div>${chips}</div>`;
  }).join('');
  const share = revenueShare(finPeers);

  pane.innerHTML = `
    <div class="grid gap-5 lg:grid-cols-3">
      <section class="pv-card p-5 lg:col-span-2">
        <div class="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h3 class="font-display text-lg font-extrabold text-slate-800">Compare peers</h3>
          <label class="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">Metric
            <select data-metric-select class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200">
              ${selectable.map((m) => `<option value="${esc(m.key)}" ${m.key === defaultMetric.key ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="text-xs text-slate-400 mb-3" data-chart-note></p>
        <div data-chart-box></div>
      </section>

      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-3">Peer landscape</h3>
        <div class="grid grid-cols-3 gap-2 mb-4">
          <div class="rounded-xl bg-indigo-50 p-3 text-center"><div class="num font-display text-2xl font-extrabold text-indigo-600">${counts.indian}</div><div class="text-[0.6rem] font-semibold uppercase tracking-wide text-indigo-400 mt-0.5">Indian</div></div>
          <div class="rounded-xl bg-sky-50 p-3 text-center"><div class="num font-display text-2xl font-extrabold text-sky-600">${counts.global}</div><div class="text-[0.6rem] font-semibold uppercase tracking-wide text-sky-400 mt-0.5">Global</div></div>
          <div class="rounded-xl bg-fuchsia-50 p-3 text-center"><div class="num font-display text-2xl font-extrabold text-fuchsia-600">${counts.private}</div><div class="text-[0.6rem] font-semibold uppercase tracking-wide text-fuchsia-400 mt-0.5">Private</div></div>
        </div>
        <div class="text-[0.7rem] font-bold uppercase tracking-wide text-slate-400 mb-1">Business model</div>
        ${bmRows}
      </section>
    </div>

    <div class="grid gap-5 lg:grid-cols-3 mt-5">
      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Market share</h3>
        <p class="text-xs text-slate-400 mb-3">Share of combined peer revenue (latest year).</p>
        <div style="height:250px"><canvas data-chart="share"></canvas></div>
      </section>
      <section class="pv-card p-5 lg:col-span-2">
        <div class="flex items-center justify-between gap-2 mb-1">
          <h3 class="font-display text-lg font-extrabold text-slate-800">Red flags</h3>
          <span class="text-xs font-semibold text-slate-400">${totalFlags} flag${totalFlags === 1 ? '' : 's'} · auto-scanned from the trends</span>
        </div>
        <p class="text-xs text-slate-400 mb-2">Risk signals pulled straight from the data — riskiest first.</p>
        <div class="max-h-[22rem] overflow-y-auto pr-1">${rfHtml || '<div class="text-slate-400 text-sm py-6 text-center">No peers to scan.</div>'}</div>
      </section>
    </div>`;

  const box = pane.querySelector('[data-chart-box]');
  const note = pane.querySelector('[data-chart-note]');
  const sel = pane.querySelector('[data-metric-select]');

  const drawChart = (metric) => {
    const old = box.querySelector('canvas');
    if (old) destroyChart(old);
    const withVal = finPeers.filter((p) => p.current && isFinite(p.current[metric.key]))
      .map((p) => ({ name: p.name, value: p.current[metric.key] }))
      .sort((a, b) => metric.better === 'low' ? a.value - b.value : b.value - a.value);
    const medVal = median(withVal.map((d) => d.value));
    const hiIdx = withVal.findIndex((d) => d.name === o.company);
    note.innerHTML = `${withVal.length} Indian listed peers · dashed line = median${medVal != null ? ' (' + esc(fmtCompact(medVal, metric)) + ')' : ''}${hiIdx >= 0 ? ' · ' + esc(o.company) + ' in amber' : ''}`;
    if (!withVal.length) { box.innerHTML = `<div class="text-center text-slate-400 py-10 text-sm">No Indian peers carry this metric.</div>`; return; }
    box.innerHTML = `<div style="height:${Math.max(200, withVal.length * 34 + 40)}px"><canvas data-chart="headline"></canvas></div>`;
    makeHBar(box.querySelector('[data-chart="headline"]'), {
      labels: withVal.map((d) => d.name),
      values: withVal.map((d) => d.value),
      medianValue: medVal, unit: metric.unit, label: metric.label, highlightIndex: hiIdx,
    });
  };

  drawChart(defaultMetric);
  sel.addEventListener('change', () => drawChart(mm[sel.value] || defaultMetric));

  const shareCanvas = pane.querySelector('[data-chart="share"]');
  if (shareCanvas && share.length) makeDoughnut(shareCanvas, { labels: share.map((r) => r.name), values: share.map((r) => r.value) });
}

function bmBucket(model) {
  if (!model) return 'Other';
  const first = String(model).split(/[\s(]/)[0];
  const found = BM_BUCKETS.find((b) => first === b || model === b);
  return found || (BM_BUCKETS.includes(first) ? first : 'Other');
}

// ------------------------------------------------- Global + Private (one tab, dropdown)
function renderExternalPeers(pane, report) {
  const buckets = {
    global: {
      peers: report.peers.global || [],
      title: 'Global Listed peers',
      subtitle: 'Global financials come back patchy, so these are shown by name and business for landscape context — not benchmarked. The numbers table focuses on the Indian listed set.',
    },
    private: {
      peers: report.peers.private || [],
      title: 'Private & unlisted peers',
      subtitle: 'Financials are not publicly disclosed for these players — shown for completeness of the peer landscape.',
    },
  };
  // Default to whichever bucket actually has peers (prefer Global).
  const start = buckets.global.peers.length || !buckets.private.peers.length ? 'global' : 'private';
  pane.innerHTML = `
    <div class="flex items-center gap-2 mb-4">
      <span class="text-xs font-semibold text-slate-500">Show</span>
      <select data-ext-select class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200">
        <option value="global">Global Listed (${buckets.global.peers.length})</option>
        <option value="private">Private &amp; unlisted (${buckets.private.peers.length})</option>
      </select>
    </div>
    <div data-ext-body></div>`;
  const sel = pane.querySelector('[data-ext-select]');
  const body = pane.querySelector('[data-ext-body]');
  sel.value = start;
  const draw = (k) => { const b = buckets[k]; renderDescriptive(body, b.peers, { title: b.title, subtitle: b.subtitle }); };
  draw(start);
  sel.addEventListener('change', () => draw(sel.value));
}

// ------------------------------------------------- Descriptive (Global + Private)
function renderDescriptive(pane, peers, { title, subtitle }) {
  if (!peers.length) { pane.innerHTML = `<div class="pv-card p-8 text-center text-slate-400">No ${esc(title.toLowerCase())} in this set.</div>`; return; }
  const rows = peers.map((p) => `<tr class="border-b border-slate-100 hover:bg-slate-50 transition">
    <td class="px-4 py-3 font-semibold text-slate-800">${esc(p.name)}${p.country ? ` <span class="text-[0.7rem] font-medium text-slate-400">${esc(p.country)}</span>` : ''}</td>
    <td class="px-4 py-3"><span class="pv-chip ${bmClass(p.business_model)} px-2 py-0.5 text-[0.7rem]">${esc(p.business_model || '—')}</span></td>
    <td class="px-4 py-3 text-slate-600">${esc(p.products || '—')}</td>
    <td class="px-4 py-3 text-slate-500 text-sm">${esc(p.note || '—')}</td>
    <td class="px-4 py-3 text-sm">${p.source && p.source.url ? `<a href="${esc(p.source.url)}" target="_blank" rel="noopener" class="text-indigo-600 hover:underline">${esc(p.source.label || 'Source')} ↗</a>` : `<span class="text-slate-400">${esc((p.source && p.source.label) || '—')}</span>`}</td>
  </tr>`).join('');
  pane.innerHTML = `
    <div class="pv-card p-5">
      <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">${esc(title)}</h3>
      <p class="text-xs text-slate-400 mb-4">${esc(subtitle)}</p>
      <div class="overflow-x-auto rounded-xl">
        <table class="w-full text-sm border-collapse min-w-[44rem]">
          <thead><tr class="bg-slate-50 text-slate-600 text-left">
            <th class="px-4 py-2.5 font-bold">Company</th>
            <th class="px-4 py-2.5 font-bold">Business Model</th>
            <th class="px-4 py-2.5 font-bold">Products</th>
            <th class="px-4 py-2.5 font-bold">Note</th>
            <th class="px-4 py-2.5 font-bold">Source</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- util
function destroyChartsIn(el) { el.querySelectorAll('canvas').forEach((c) => destroyChart(c)); }
