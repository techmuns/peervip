// tables.js — the Indian/Global bucket tabs: a "Current <-> Trends" toggle over
//  * Current: one wide data-grid (frozen company col, sticky header, cross-sectional
//    conditional formatting + best-in-column crown, pinned Median/Average rows,
//    row click -> drill-down panel).
//  * Trends: foldable sections (one per metric with series), companies as rows and
//    years as columns (like-for-like), temporal conditional formatting, and a
//    per-section Table <-> Charts sub-toggle (Chart.js multi-line + dashed median).
import { esc, fmt, bmClass, companyNameHtml } from './format.js';
import { helpIcon } from './help.js';
import {
  currentValues, medianRow, averageRow,
  peersWithSeries, unionYears, seriesValueAt, seriesAggregate, metricsWithSeries,
} from './compute.js';
import { crossClass, trendClass } from './conditional.js';
import { destroyChart } from './charts.js';
import { openDrilldown } from './drilldown.js';
import { saveOverlay, normName } from './peers.js';

/** Render a bucket tab (peers + Current/Trends toggle) into `container`.
 *  When `edit` is passed (Indian tab), an Add-peer form + per-row Remove appear;
 *  changes update report.peers.indian + the persisted overlay and re-render. */
export function renderBucketView(container, { peers, report, bucket, edit }) {
  destroyBucketCharts(container);
  const editable = !!edit;
  if (!peers.length && !editable) {
    container.innerHTML = emptyState(`No ${bucket} peers in this report.`);
    return;
  }
  const state = { view: 'current', node: 'core' };
  // Value-chain explorer: present only when the report carries a value_chain
  // universe (built generically by the research pipeline for any industry).
  const vc = (report.value_chain && Array.isArray(report.value_chain.players) && report.value_chain.players.length) ? report.value_chain : null;
  function hasFin(p) { return (p && (Object.keys(p.series || {}).length || Object.values(p.current || {}).some((v) => v != null))) ? 1 : 0; }
  const nodeCount = (key) => vc ? vc.players.filter((p) => (p.value_chain_nodes || []).includes(key)).length : 0;
  const vcAllCount = vc ? new Set(vc.players.map((p) => normName(p.name))).size : 0; // unique across all nodes

  container.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap mb-3">
      <div class="flex items-center gap-2 flex-wrap">
        <div class="inline-flex rounded-xl bg-slate-100 p-1 text-sm font-semibold" role="tablist" aria-label="View">
          <button data-view="current" class="pv-focus rounded-lg px-4 py-1.5 transition" role="tab">Current</button>
          <button data-view="trends"  class="pv-focus rounded-lg px-4 py-1.5 transition" role="tab">Trends</button>
        </div>
        ${vc ? `<label class="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">Value chain
          <select data-vc-select class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200">
            <option value="core">★ Core peers (benchmarked)</option>
            <option value="all">🗂 All value-chain companies (${vcAllCount})</option>
            ${vc.nodes.map((n) => `<option value="${esc(n.key)}">${esc(n.label)} (${nodeCount(n.key)})</option>`).join('')}
          </select></label>` : ''}
      </div>
      ${editable
        ? `<form data-addpeer class="flex items-center gap-2">
             <div class="relative" data-addwrap>
               <input name="pname" class="pv-add-input" placeholder="Search a stock to add…" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-label="Search a stock to add" />
               <div data-addresults class="pv-add-results" role="listbox" hidden></div>
             </div>
             <button type="submit" class="pv-add-btn">+ Add peer</button>
           </form>`
        : `<p class="text-xs text-slate-400">${peers.length} peers · click any row for a full profile</p>`}
    </div>
    <div data-vc-note class="text-xs text-slate-500 mb-3" hidden></div>
    ${editable ? `<div data-addstatus class="text-xs mb-3" hidden></div>` : ''}
    <div data-pane="current"></div>
    <div data-pane="trends" hidden></div>`;

  const paneCurrent = container.querySelector('[data-pane="current"]');
  const paneTrends = container.querySelector('[data-pane="trends"]');
  const vcNote = container.querySelector('[data-vc-note]');
  const addForm = container.querySelector('[data-addpeer]');

  const rerender = () => renderBucketView(container, { peers: report.peers.indian || [], report, bucket, edit });
  const onRemove = editable ? (name) => {
    const p = (report.peers.indian || []).find((x) => x.name === name);
    report.peers.indian = (report.peers.indian || []).filter((x) => x.name !== name);
    if (p && p.added_by === 'user') edit.overlay.added = edit.overlay.added.filter((a) => normName(a.name) !== normName(name));
    else if (!edit.overlay.removed.some((n) => normName(n) === normName(name))) edit.overlay.removed.push(name);
    saveOverlay(edit.slug, edit.overlay);
    rerender();
    if (edit.refreshBanner) edit.refreshBanner();
  } : null;
  // Remove inside a value-chain NODE view: hide a distorting player (e.g. a large
  // diversified company whose consolidated numbers don't reflect this single node).
  // Persisted per-report in the overlay; re-renders just the node view.
  const onRemoveVc = editable ? (name) => {
    edit.overlay.vcRemoved = edit.overlay.vcRemoved || [];
    if (!edit.overlay.vcRemoved.some((n) => normName(n) === normName(name))) edit.overlay.vcRemoved.push(name);
    saveOverlay(edit.slug, edit.overlay);
    fillPanes();
  } : null;

  // Which players the panes show: the benchmarked core set, or one value-chain node
  // (sorted so names with financials and higher directness lead).
  function activeSet() {
    if (state.node === 'core' || !vc) return peers;
    const rm = new Set(((editable && edit.overlay.vcRemoved) || []).map(normName));
    const seen = new Set();
    // 'all' = every value-chain company across all nodes; otherwise one node
    const inScope = state.node === 'all' ? vc.players : vc.players.filter((p) => (p.value_chain_nodes || []).includes(state.node));
    return inScope
      // hide user-removed players, and de-dupe a name that appears in several nodes / twice (keep first)
      .filter((p) => { const k = normName(p.name); if (rm.has(k) || seen.has(k)) return false; seen.add(k); return true; })
      .slice().sort((a, b) => (hasFin(b) - hasFin(a)) || ((b.directness || 0) - (a.directness || 0)));
  }

  function fillPanes() {
    destroyBucketCharts(container);
    const isCore = state.node === 'core' || !vc;
    const set = activeSet();
    const canEditCore = editable && isCore;    // core: add + remove benchmarked peers
    const showRemove = editable;               // node views also let you hide a distorting player
    if (!set.length) {
      paneCurrent.innerHTML = emptyState(canEditCore ? 'No peers left — add one by name above, or reload to restore the original set.' : 'No listed players in this value-chain node (or all hidden — reload the page to restore).');
      paneTrends.innerHTML = '';
    } else {
      paneCurrent.innerHTML = currentTableHtml(set, report, showRemove);
      renderTrends(paneTrends, set, report);
      wireRowClicks(paneCurrent, set, report, showRemove ? (isCore ? onRemove : onRemoveVc) : null);
    }
    if (addForm) addForm.style.display = isCore ? '' : 'none'; // adding a peer stays core-only
    if (vcNote && state.node === 'all' && vc) {
      vcNote.hidden = false;
      vcNote.innerHTML = `<span class="font-semibold text-slate-600">All value-chain companies</span> — ${set.length} unique listed player${set.length === 1 ? '' : 's'} across every node (de-duplicated). Click × in Current to hide one.`;
    } else if (vcNote) {
      const node = isCore ? null : vc.nodes.find((n) => n.key === state.node);
      if (node) { vcNote.hidden = false; vcNote.innerHTML = `<span class="font-semibold text-slate-600">${esc(node.label)}</span> — ${set.length} listed player${set.length === 1 ? '' : 's'}.${node.use ? ` ${esc(node.use)}` : ''}`; }
      else { vcNote.hidden = true; vcNote.innerHTML = ''; }
    }
    applyView();
  }

  function applyView() {
    paneCurrent.hidden = state.view !== 'current';
    paneTrends.hidden = state.view !== 'trends';
    container.querySelectorAll('[data-view]').forEach((b) => {
      const on = b.dataset.view === state.view;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.classList.toggle('bg-white', on);
      b.classList.toggle('shadow-sm', on);
      b.classList.toggle('text-indigo-600', on);
      b.classList.toggle('text-slate-500', !on);
    });
  }

  container.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; applyView(); }));
  const vcSelect = container.querySelector('[data-vc-select]');
  if (vcSelect) vcSelect.addEventListener('change', () => { state.node = vcSelect.value; fillPanes(); });
  if (editable) wireAddPeer(container, report, edit, rerender);

  fillPanes();
}

// Add-peer form: a live stock-search typeahead (muns API via /api/stock-search)
// to pick the right listing, then fetch its financials on demand from /api/peer.
function wireAddPeer(container, report, edit, rerender) {
  const form = container.querySelector('[data-addpeer]');
  const statusEl = container.querySelector('[data-addstatus]');
  if (!form) return;
  const input = form.pname;
  const results = form.querySelector('[data-addresults]');
  const setStatus = (msg, tone) => {
    const col = tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-600' : 'text-slate-500';
    statusEl.hidden = !msg;
    statusEl.className = `text-xs mb-3 ${col}`;
    statusEl.textContent = msg || '';
  };

  const closeMenu = () => { if (results) { results.hidden = true; results.innerHTML = ''; } input.setAttribute('aria-expanded', 'false'); };

  // Fetch one company's financials by name/ticker and fold it into the set.
  const addPeer = async (query, label) => {
    const q = String(query || '').trim();
    if (!q) return;
    closeMenu();
    const btn = form.querySelector('button[type="submit"]');
    const old = btn.textContent; btn.disabled = true; btn.textContent = 'Adding…';
    setStatus(`Fetching ${label || q} from Screener…`, 'info');
    let res = null;
    try { res = await (await fetch('/api/peer?name=' + encodeURIComponent(q))).json(); } catch (_) { res = null; }
    btn.disabled = false; btn.textContent = old;
    if (!res || !res.ok || !res.peer) { setStatus((res && res.error) || 'Could not fetch that company — check the name and try again.', 'bad'); return; }
    const peer = res.peer; peer.added_by = 'user';
    if ((report.peers.indian || []).some((x) => normName(x.name) === normName(peer.name))) { setStatus(`${peer.name} is already in the set.`, 'warn'); input.value = ''; return; }
    edit.overlay.removed = edit.overlay.removed.filter((n) => normName(n) !== normName(peer.name));
    edit.overlay.added = [...edit.overlay.added.filter((a) => normName(a.name) !== normName(peer.name)), peer];
    saveOverlay(edit.slug, edit.overlay);
    report.peers.indian = [...(report.peers.indian || []), peer];
    input.value = '';
    rerender();
    if (edit.refreshBanner) edit.refreshBanner();
  };

  // ---- live typeahead ----
  let seq = 0; // guards against out-of-order responses
  const renderMenu = (rows) => {
    if (!results) return;
    if (!rows.length) { closeMenu(); return; }
    results.innerHTML = rows.map((r, i) => `
      <button type="button" class="pv-add-item" role="option" data-i="${i}" data-code="${esc(r.code)}" data-name="${esc(r.name)}">
        <div class="flex items-baseline justify-between gap-2">
          <span class="truncate">${esc(r.name)}</span>
          <span class="pv-add-code">${esc(r.code)}</span>
        </div>
        <div class="pv-add-meta truncate">${esc([r.country, r.industry].filter(Boolean).join(' · ') || '—')}</div>
      </button>`).join('');
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    results.querySelectorAll('[data-code]').forEach((el) => el.addEventListener('click', () => {
      // Prefer the Screener-style code (unambiguous); fall back to the name.
      addPeer(el.dataset.code || el.dataset.name, el.dataset.name);
    }));
  };

  let debounce = null;
  const search = async (q) => {
    const mine = ++seq;
    let res = null;
    try { res = await (await fetch('/api/stock-search?q=' + encodeURIComponent(q))).json(); } catch (_) { res = null; }
    if (mine !== seq) return; // a newer keystroke superseded this one
    if (!res || !res.ok) { closeMenu(); if (res && res.error) setStatus(res.error, 'warn'); return; }
    renderMenu(res.results || []);
  };

  input.addEventListener('input', () => {
    const q = input.value.trim();
    setStatus('');
    clearTimeout(debounce);
    if (q.length < 2) { closeMenu(); return; }
    debounce = setTimeout(() => search(q), 220);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  // close the menu when focus/click leaves the search box
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) closeMenu(); });

  form.addEventListener('submit', (e) => { e.preventDefault(); addPeer(input.value, input.value.trim()); });
}

/** Destroy any Chart.js instances inside a container (call before discarding it). */
export function destroyBucketCharts(container) {
  container.querySelectorAll('canvas').forEach((c) => destroyChart(c));
}

// ---------------------------------------------------------------- Current
function currentTableHtml(peers, report, editable) {
  // Absolute-magnitude / trend-only metrics live in the Trends tab, not this
  // wide cross-sectional grid (keeps it readable and off the composite score).
  const metrics = (report.metrics || []).filter((m) => !m.trendOnly);
  const mRow = medianRow(peers, metrics);
  const aRow = averageRow(peers, metrics);
  // per-metric value arrays for conditional formatting (relative to shown peers)
  const colVals = {};
  for (const m of metrics) colVals[m.key] = currentValues(peers, m.key);

  // group band: one spanning header per metric group (Size & Growth, Profitability, …)
  const groups = [];
  for (const m of metrics) {
    const last = groups[groups.length - 1];
    if (last && last.group === m.group) last.count += 1;
    else groups.push({ group: m.group, count: 1 });
  }
  const band = `<tr class="pv-group-band">
    <th class="pv-col1"></th>
    ${groups.map((g) => `<th colspan="${g.count}">${esc(g.group)}</th>`).join('')}
    <th></th>
  </tr>`;

  const head = `<thead>${band}<tr class="pv-metric-head">
    <th class="pv-col1">Company</th>
    ${metrics.map((m) => `<th title="${esc(m.label)}${m.unit ? ' (' + esc(m.unit) + ')' : ''}">${esc(m.label)}${helpIcon(m.key, m.label)}<span class="pv-th-unit">${esc(unitLabel(m))}</span></th>`).join('')}
    <th style="text-align:center">Business<br>Model</th>
  </tr></thead>`;

  const body = peers.map((p, idx) => {
    const cur = p.current || {};
    const cells = metrics.map((m) => {
      const v = cur[m.key];
      const { cls, best } = crossClass(v, colVals[m.key], m.better);
      return `<td class="num ${cls} ${best ? 'cf-best' : ''}">${esc(fmt(v, m.format))}</td>`;
    }).join('');
    const remove = editable ? `<button data-remove="${esc(p.name)}" title="Remove ${esc(p.name)}" aria-label="Remove ${esc(p.name)}" class="pv-remove">×</button>` : '';
    const added = p.added_by === 'user' ? '<span class="pv-added" title="Added by you">+you</span>' : '';
    return `<tr class="pv-row" data-peer-idx="${idx}">
      <td class="pv-col1">
        <div class="font-semibold text-slate-800 leading-snug">${remove}${companyNameHtml(p)}${p.is_seed ? ' <span class="text-amber-500" title="Searched company">★</span>' : ''}${added}</div>
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
  <p class="text-[0.72rem] text-slate-400 mt-2">Green = better than peers · red = worse (flipped for “lower is better” metrics like debt &amp; days). Median &amp; Average are computed live from the table.</p>`;
}

function wireRowClicks(pane, peers, report, onRemove) {
  pane.querySelectorAll('tr.pv-row').forEach((tr) => {
    tr.addEventListener('click', () => {
      const p = peers[Number(tr.dataset.peerIdx)];
      if (p) openDrilldown(p, report);
    });
  });
  if (onRemove) pane.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); onRemove(b.dataset.remove); }));
}

// ---------------------------------------------------------------- Trends
function renderTrends(pane, peers, report) {
  const metrics = metricsWithSeries(peers, report.metrics);
  if (!metrics.length) { pane.innerHTML = emptyState('No multi-year series available for these peers yet.'); return; }

  pane.innerHTML = `<div class="space-y-3">${metrics.map((m) => trendSectionHtml(m, true)).join('')}</div>
    <p class="text-[0.72rem] text-slate-400 mt-3">Each series starts where its real data begins (FY16 onward) — blank cells are genuinely missing, never fabricated. Green shades a year that improved vs the prior year, red a year that worsened (flipped for “lower is better” metrics).</p>`;

  metrics.forEach((m) => {
    const sec = pane.querySelector(`[data-metric="${m.key}"]`);
    const inner = sec.querySelector('[data-inner]');
    let built = false;
    const ensure = () => { if (!built) { built = true; inner.innerHTML = trendTableHtml(peers, report, m); } };
    sec.addEventListener('toggle', () => { if (sec.open) ensure(); });
    if (sec.open) ensure();
  });
}

function trendSectionHtml(metric, open) {
  return `<details class="pv-fold pv-card overflow-hidden" data-metric="${esc(metric.key)}" ${open ? 'open' : ''}>
    <summary class="flex items-center justify-between gap-3 px-4 py-3">
      <span class="flex items-center gap-2 min-w-0">
        <svg class="pv-chev shrink-0 text-slate-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        <span class="font-display font-bold text-slate-800 truncate">${esc(metric.label)}</span>${helpIcon(metric.key, metric.label)}
        <span class="text-[0.68rem] text-slate-400 hidden sm:inline">${esc(metric.group)}${metric.unit ? ' · ' + esc(metric.unit) : ''}</span>
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
    return `<tr><td class="pv-col1">${companyNameHtml(p, 'font-semibold text-slate-800')}${p.is_seed ? ' <span class="text-amber-500">★</span>' : ''}</td>${cells}</tr>`;
  };

  const med = seriesAggregate(peers, key, years, 'median');
  const avg = seriesAggregate(peers, key, years, 'average');
  const refRow = (label, vals) => `<tr class="pv-ref"><td class="pv-col1">${label}</td>${vals.map((v) => `<td class="num">${esc(fmt(v, metric.format))}</td>`).join('')}</tr>`;

  return `<div class="pv-scroll"><table class="pv-table">
    ${head}<tbody>${rows.map(bodyRow).join('')}${refRow('Median', med)}${refRow('Average', avg)}</tbody>
  </table></div>`;
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
