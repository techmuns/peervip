// toppicks-view.js — renders report.top_picks: a ranked best-ideas shortlist for the
// industry. Data is synthesised server-side (lib/toppicks.mjs) from all the report's
// data plus a per-company web search. Two views over the same picks:
//   • Table  — companies as rows, key params as columns, each cell shaded vs the picks'
//              median (Excel-style, honouring each metric's `better`), with live Median
//              & Average rows; a row click expands EVERY parameter vs median & average.
//   • Cards  — the ranked reasoning cards (thesis / key metrics / risk / evidence).
// The numbers come from each pick's full financials, looked up from the researched
// universe (core peers + value-chain players), so the table is internally consistent.
import { esc, fmt, companyNameHtml } from './format.js';
import { medianRow, averageRow, currentValues } from './compute.js';
import { crossClass } from './conditional.js';

const isNum = (v) => typeof v === 'number' && isFinite(v);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const unitOf = (m) => (m && m.unit) ? m.unit : '';

const evClass = (e) => e === 'A' ? 'bg-emerald-50 text-emerald-700'
  : e === 'B' ? 'bg-indigo-50 text-indigo-700'
  : 'bg-slate-100 text-slate-500';
const evLabel = (e) => e === 'A' ? 'A · numbers + web' : e === 'B' ? 'B · numbers' : 'C · qualitative';
const evChip = (e) => e ? `<span class="pv-flag-chip ${evClass(e)}" title="Evidence grade">${esc(evLabel(e))}</span>` : '<span class="text-slate-300">—</span>';

const VIEW_KEY = 'pv-tp-view';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'table'; } catch (_) { return 'table'; } };
const writeView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch (_) { /* private mode */ } };

export function renderTopPicks(pane, report) {
  const tp = report.top_picks;
  if (!tp || !Array.isArray(tp.picks) || !tp.picks.length) {
    pane.innerHTML = `<div class="text-center text-slate-400 py-16 text-sm">
      No Top Picks generated for this report yet.<br>
      Hit <span class="font-semibold text-slate-500">Update</span> or <span class="font-semibold text-slate-500">Rebuild</span> (top-right) — the ranked shortlist is built during research.
    </div>`;
    return;
  }

  // Look up each pick's full financials from the researched universe (core peers +
  // value-chain players + global/private), by ticker then normalised name.
  const pool = [
    ...((report.peers && report.peers.indian) || []),
    ...((report.value_chain && report.value_chain.players) || []),
    ...((report.peers && report.peers.global) || []),
    ...((report.peers && report.peers.private) || []),
  ];
  const byName = new Map(), byTicker = new Map();
  for (const p of pool) {
    if (!p || !p.name) continue;
    const k = norm(p.name); if (k && !byName.has(k)) byName.set(k, p);
    if (p.ticker) { const t = String(p.ticker).toUpperCase(); if (!byTicker.has(t)) byTicker.set(t, p); }
  }
  const rows = tp.picks.map((pk) => {
    const full = (pk.ticker && byTicker.get(String(pk.ticker).toUpperCase())) || byName.get(norm(pk.name)) || null;
    const peer = full ? { ...full } : { name: pk.name, ticker: pk.ticker || '', current: {}, series: {}, source: pk.source || null };
    return { pick: pk, peer };
  });
  const peers = rows.map((r) => r.peer);

  // Columns = comparable metrics (absolute-size / trend-only ones stay out of the wide
  // grid, same rule as the Current tab). The detail panel uses the full catalog.
  const metrics = (report.metrics || []).filter((m) => !m.trendOnly);
  const allMetrics = (report.metrics || []);
  const mRow = medianRow(peers, metrics), aRow = averageRow(peers, metrics);
  const colVals = {}; for (const m of metrics) colVals[m.key] = currentValues(peers, m.key);
  // full-catalog aggregates for the drill-down (includes trend-only magnitudes)
  const mAll = medianRow(peers, allMetrics), aAll = averageRow(peers, allMetrics);
  const colAll = {}; for (const m of allMetrics) colAll[m.key] = currentValues(peers, m.key);

  const view = readView();

  // ---------- Table view ----------
  const groups = [];
  for (const m of metrics) {
    const last = groups[groups.length - 1];
    if (last && last.group === m.group) last.count += 1; else groups.push({ group: m.group, count: 1 });
  }
  const band = `<tr class="pv-group-band"><th class="pv-col1"></th><th></th><th></th>${groups.map((g) => `<th colspan="${g.count}">${esc(g.group || '')}</th>`).join('')}</tr>`;
  const head = `<thead>${band}<tr class="pv-metric-head">
    <th class="pv-col1">Company</th>
    <th class="num" title="Business-quality score (0-100) vs the researched set">Score</th>
    <th title="Evidence grade">Grade</th>
    ${metrics.map((m) => `<th title="${esc(m.label)}${m.unit ? ' (' + esc(m.unit) + ')' : ''}">${esc(m.label)}<span class="pv-th-unit">${esc(unitOf(m))}</span></th>`).join('')}
  </tr></thead>`;

  const body = rows.map((r, idx) => {
    const { pick, peer } = r; const cur = peer.current || {};
    const cells = metrics.map((m) => {
      const v = cur[m.key];
      const { cls, best } = crossClass(v, colVals[m.key], m.better);
      return `<td class="num ${cls} ${best ? 'cf-best' : ''}">${esc(fmt(v, m.format))}</td>`;
    }).join('');
    return `<tr class="pv-row pv-tp-row" data-pick-idx="${idx}" title="Click for every parameter vs median &amp; average">
      <td class="pv-col1">
        <div class="font-semibold text-slate-800 leading-snug"><span class="pv-tp-rank">${pick.rank === 1 ? '👑' : esc(String(pick.rank))}</span>${companyNameHtml(peer)}</div>
        ${pick.role ? `<div class="text-[0.68rem] text-slate-400 leading-tight mt-0.5">${esc(pick.role)}</div>` : ''}
      </td>
      <td class="num font-display font-extrabold brand-text">${esc(String(pick.score))}</td>
      <td>${evChip(pick.evidence)}</td>
      ${cells}
    </tr>`;
  }).join('');

  const refRow = (label, row) => `<tr class="pv-ref"><td class="pv-col1">${label}</td><td></td><td></td>${metrics.map((m) => `<td class="num">${esc(fmt(row[m.key], m.format))}</td>`).join('')}</tr>`;

  const tableHtml = `
    <div class="pv-scroll"><table class="pv-table pv-tp-table">
      ${head}
      <tbody>${body}${refRow('Median', mRow)}${refRow('Average', aRow)}</tbody>
    </table></div>
    <p class="text-[0.72rem] text-slate-400 mt-2">Green = better than the picks shown · red = worse (flipped for “lower is better” like debt &amp; PE). <b>Median &amp; Average</b> are computed live across the Top Picks here. <b>Click any company</b> for every parameter vs median &amp; average. Note: picks span different value-chain roles, so a single median mixes business models — use the per-company detail for a like-for-like read.</p>`;

  // ---------- Cards view ----------
  const card = (p) => `
    <div class="pv-card p-4 sm:p-5">
      <div class="flex items-start gap-3">
        <span class="pv-rank-badge ${p.rank === 1 ? 'is-top' : ''} shrink-0">${p.rank === 1 ? '👑' : esc(String(p.rank))}</span>
        <div class="min-w-0 grow">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="font-display text-base font-extrabold text-slate-800 min-w-0">${companyNameHtml(p)}</div>
            <div class="flex items-center gap-2 shrink-0">
              ${p.evidence ? `<span class="pv-flag-chip ${evClass(p.evidence)}" title="Evidence grade">${esc(evLabel(p.evidence))}</span>` : ''}
              <span class="num text-sm font-display font-extrabold brand-text" title="Business-quality score vs the researched set (0-100)">${esc(String(p.score))}</span>
            </div>
          </div>
          ${p.role ? `<div class="text-[0.72rem] text-slate-400 mt-0.5">${esc(p.role)}</div>` : ''}
          <p class="text-sm text-slate-600 leading-relaxed mt-2">${esc(p.thesis)}</p>
          ${p.key_metrics && p.key_metrics.length ? `<div class="flex flex-wrap gap-1.5 mt-2.5">${p.key_metrics.map((m) => `<span class="pv-chip bg-slate-50 text-slate-600 px-2 py-0.5 text-[0.68rem]">${esc(m)}</span>`).join('')}</div>` : ''}
          ${p.risk ? `<p class="text-[0.78rem] text-rose-600 mt-2"><span class="font-semibold">Risk:</span> ${esc(p.risk)}</p>` : ''}
        </div>
      </div>
    </div>`;
  const cardsHtml = `<div class="grid gap-3 lg:grid-cols-2">${tp.picks.map(card).join('')}</div>`;

  const segBtn = (v, label) => `<button data-tpview="${v}" class="px-3 py-1.5 text-sm font-semibold rounded-lg transition ${view === v ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}">${label}</button>`;

  pane.innerHTML = `
    <div class="mb-3 flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h3 class="font-display text-lg font-extrabold text-slate-800">★ Top Picks</h3>
        <p class="text-xs text-slate-400 mt-0.5">${tp.picks.length} best ideas in this industry, ranked by business quality (score 0-100 vs the researched set). A data-driven shortlist with risks shown — not investment advice.</p>
      </div>
      <div class="inline-flex items-center gap-0.5 rounded-xl bg-slate-100 p-0.5 shrink-0">${segBtn('table', 'Table')}${segBtn('cards', 'Cards')}</div>
    </div>
    <div data-tp-table ${view === 'table' ? '' : 'hidden'}>${tableHtml}</div>
    <div data-tp-cards ${view === 'cards' ? '' : 'hidden'}>${cardsHtml}</div>
    <div data-tp-detail class="mt-4"></div>`;

  // ---------- interactions ----------
  const tableWrap = pane.querySelector('[data-tp-table]');
  const cardsWrap = pane.querySelector('[data-tp-cards]');
  const detailWrap = pane.querySelector('[data-tp-detail]');

  pane.querySelectorAll('[data-tpview]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.getAttribute('data-tpview');
      writeView(v);
      tableWrap.hidden = v !== 'table';
      cardsWrap.hidden = v !== 'cards';
      pane.querySelectorAll('[data-tpview]').forEach((b) => {
        const on = b.getAttribute('data-tpview') === v;
        b.className = `px-3 py-1.5 text-sm font-semibold rounded-lg transition ${on ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`;
      });
      if (v === 'cards') detailWrap.innerHTML = '';
    });
  });

  // Row click (not the Screener name link) → full parameter breakdown vs median & average.
  tableWrap.addEventListener('click', (e) => {
    if (e.target.closest('a')) return; // let the company link open Screener
    const tr = e.target.closest('[data-pick-idx]');
    if (!tr) return;
    const idx = +tr.getAttribute('data-pick-idx');
    tableWrap.querySelectorAll('.pv-tp-row').forEach((row) => row.classList.toggle('is-open', row === tr));
    detailWrap.innerHTML = detailHtml(rows[idx], allMetrics, mAll, aAll, colAll);
    detailWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

/** Per-company drill-down: every parameter the company has, with its value shaded vs the
 *  picks, plus the picks' median & average and a plain better/worse flag. */
function detailHtml(row, allMetrics, mAll, aAll, colAll) {
  const { pick, peer } = row; const cur = peer.current || {};
  const vsCell = (v, med, better) => {
    if (better === 'neutral' || !isNum(v) || !isNum(med)) return '<span class="text-slate-300">—</span>';
    if (v === med) return '<span class="text-slate-400">= median</span>';
    const betterThan = better === 'high' ? v > med : v < med;
    return `<span class="${betterThan ? 'text-emerald-600' : 'text-rose-600'} font-medium">${v > med ? '▲' : '▼'} ${betterThan ? 'better' : 'worse'}</span>`;
  };
  const lines = allMetrics.filter((m) => isNum(cur[m.key])).map((m) => {
    const v = cur[m.key];
    const { cls } = crossClass(v, colAll[m.key], m.better);
    return `<tr>
      <td class="pv-col1">${esc(m.label)}${m.unit ? ` <span class="text-slate-300">${esc(m.unit)}</span>` : ''}</td>
      <td class="num ${cls} font-semibold">${esc(fmt(v, m.format))}</td>
      <td class="num text-slate-500">${esc(fmt(mAll[m.key], m.format))}</td>
      <td class="num text-slate-500">${esc(fmt(aAll[m.key], m.format))}</td>
      <td>${vsCell(v, mAll[m.key], m.better)}</td>
    </tr>`;
  }).join('');

  return `<div class="pv-card p-4 sm:p-5">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <div class="font-display text-base font-extrabold text-slate-800"><span class="pv-tp-rank">${pick.rank === 1 ? '👑' : esc(String(pick.rank))}</span>${companyNameHtml(peer)}</div>
        ${pick.role ? `<div class="text-[0.72rem] text-slate-400 mt-0.5">${esc(pick.role)}</div>` : ''}
      </div>
      <div class="flex items-center gap-2 shrink-0">${evChip(pick.evidence)}<span class="num text-sm font-display font-extrabold brand-text" title="Business-quality score">${esc(String(pick.score))}</span></div>
    </div>
    ${pick.thesis ? `<p class="text-sm text-slate-600 leading-relaxed mt-2">${esc(pick.thesis)}</p>` : ''}
    ${pick.risk ? `<p class="text-[0.78rem] text-rose-600 mt-1.5"><span class="font-semibold">Risk:</span> ${esc(pick.risk)}</p>` : ''}
    <div class="pv-scroll mt-3"><table class="pv-table pv-tp-detail-table">
      <thead><tr><th class="pv-col1">Parameter</th><th class="num">${esc(pick.name)}</th><th class="num">Median</th><th class="num">Average</th><th>vs median</th></tr></thead>
      <tbody>${lines || '<tr><td class="pv-col1 text-slate-400" colspan="5">No comparable figures captured for this company.</td></tr>'}</tbody>
    </table></div>
    <p class="text-[0.72rem] text-slate-400 mt-2">Value shaded vs the Top Picks (green better · red worse). Median &amp; Average are across the Top Picks shown.</p>
  </div>`;
}
