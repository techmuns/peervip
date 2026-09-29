// industry.js — the "Industry" tab: a visual-first, end-to-end sector read built
// entirely from the peer TRENDS (FY16→now). Every number is aggregated live across
// the Indian listed set, so it recomputes when peers are added/removed. Chart-heavy,
// minimal prose (each chart carries one computed insight line). Exports to PDF via
// the shared #print-region + window.print() mechanism.
import { esc, fmt } from './format.js';
import { makeLine, makeDoughnut, color, destroyChart } from './charts.js';
import { industryLine, leaderShareLine, dispersionLine, revenueShare, thenVsNow } from './compute.js';

const isNum = (v) => typeof v === 'number' && isFinite(v);
const fyLabel = (y) => { const m = /(\d{4})/.exec(String(y || '')); return m ? 'FY' + m[1].slice(-2) : String(y || ''); };

function unitFmt(v, unit) {
  if (!isNum(v)) return '—';
  if (unit === '%') return v.toFixed(1) + '%';
  if (unit === 'x') return v.toFixed(2) + '×';
  if (unit === 'days') return Math.round(v) + ' days';
  if (unit === 'Rs Cr') return Math.abs(v) >= 1000 ? '₹' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k Cr' : '₹' + Math.round(v).toLocaleString('en-US') + ' Cr';
  return fmt(v, 'num1');
}
function firstLast(line) {
  const pts = (line.values || []).map((v, i) => ({ y: line.years[i], v })).filter((o) => isNum(o.v));
  return pts.length >= 2 ? { a: pts[0], b: pts[pts.length - 1], n: pts.length } : null;
}
function cagr(line) {
  const fl = firstLast(line); if (!fl || fl.a.v <= 0 || fl.b.v <= 0) return null;
  const yrs = (parseInt(/(\d{4})/.exec(fl.b.y)[1], 10) - parseInt(/(\d{4})/.exec(fl.a.y)[1], 10)) || 1;
  return +(((fl.b.v / fl.a.v) ** (1 / yrs) - 1) * 100).toFixed(1);
}
function arrowSpan(delta, good) {
  if (delta === 0 || delta == null) return '<span class="text-slate-400">→</span>';
  const up = delta > 0;
  const positive = good === 'neutral' ? null : (good === 'high' ? up : !up);
  const cls = positive === null ? 'text-slate-500' : positive ? 'text-emerald-600' : 'text-rose-500';
  return `<span class="${cls} font-bold">${up ? '▲' : '▼'}</span>`;
}

// Trajectory of an industry line: endpoints + recent-vs-earlier slope, so a finding
// can say "turned up in the last few years" rather than only comparing endpoints.
function traj(line) {
  const pts = (line.values || []).map((v, i) => ({ fy: line.years[i], v })).filter((o) => isNum(o.v));
  if (pts.length < 3) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const mid = pts[Math.max(0, pts.length - 4)]; // ~3 years ago
  return { pts, first, last, mid, windowDelta: last.v - first.v, recentDelta: last.v - mid.v, earlierDelta: mid.v - first.v };
}
const turned = (t) => t && Math.sign(t.recentDelta) !== Math.sign(t.earlierDelta) && Math.abs(t.recentDelta) > 0.5;

/** The report's headline: top ~7 auto-derived findings about what changed and WHY,
 *  reading the whole-history trajectory of the industry medians and linking drivers. */
function buildFindings(peers) {
  const L = (k, kind = 'median') => industryLine(peers, k, kind);
  const F = [];
  const push = (imp, dir, good, title, detail) => { if (detail) F.push({ imp, dir, good, title, detail }); };
  const n0 = (v) => Math.round(v), p1 = (v) => v.toFixed(1);

  // 1) Margins + the raw-material driver (flagship: what changed & why)
  const m = traj(L('ebitda_margin')), rm = traj(L('rm_cost_pct'));
  if (m) {
    const up = m.recentDelta > 0.5, down = m.recentDelta < -0.5;
    let why = '';
    if (rm && up && rm.recentDelta < -0.5) why = `, helped by raw-material costs easing from ${n0(rm.mid.v)}% to ${n0(rm.last.v)}% of sales`;
    else if (rm && down && rm.recentDelta > 0.5) why = `, squeezed by raw-material costs climbing from ${n0(rm.mid.v)}% to ${n0(rm.last.v)}% of sales`;
    const turn = turned(m) ? ` — turning ${up ? 'up' : 'down'} after a softer stretch` : '';
    push(6 + Math.abs(m.windowDelta), up ? 'up' : down ? 'down' : 'flat', up ? 'good' : down ? 'bad' : 'neutral',
      up ? 'Margins are expanding' : down ? 'Margins are under pressure' : 'Margins are holding',
      `Industry EBITDA margin sits at ${n0(m.last.v)}% (${fyLabel(m.first.fy)}: ${n0(m.first.v)}%)${turn}${why}.`);
  }

  // 2) Revenue growth phase — accelerating or cooling
  const rev = L('revenue', 'sum'), rt = traj(rev);
  if (rt) {
    const yrsAll = (parseInt(/(\d{4})/.exec(rt.last.fy)[1], 10) - parseInt(/(\d{4})/.exec(rt.first.fy)[1], 10)) || 1;
    const cagrAll = rt.first.v > 0 ? (((rt.last.v / rt.first.v) ** (1 / yrsAll) - 1) * 100) : null;
    const recentYrs = (parseInt(/(\d{4})/.exec(rt.last.fy)[1], 10) - parseInt(/(\d{4})/.exec(rt.mid.fy)[1], 10)) || 1;
    const cagrRecent = rt.mid.v > 0 ? (((rt.last.v / rt.mid.v) ** (1 / recentYrs) - 1) * 100) : null;
    if (cagrAll != null) {
      const accel = cagrRecent != null && cagrRecent > cagrAll + 1.5, cool = cagrRecent != null && cagrRecent < cagrAll - 1.5;
      push(5.5, accel ? 'up' : cool ? 'down' : 'flat', 'neutral',
        accel ? 'Growth is accelerating' : cool ? 'Growth is cooling' : 'Steady growth',
        `Sector revenue compounded ~${p1(cagrAll)}% a year over ${fyLabel(rt.first.fy)}–${fyLabel(rt.last.fy)}${cagrRecent != null ? `, and ~${p1(cagrRecent)}% in the last ${recentYrs} years` : ''}.`);
    }
  }

  // 3) Returns (ROCE) + its driver (margins vs working capital)
  const roce = traj(L('roce'));
  if (roce) {
    const up = roce.windowDelta > 1, down = roce.windowDelta < -1;
    let why = '';
    if (down && m && m.windowDelta < -1) why = ', tracking the softer margins';
    else if (up && m && m.windowDelta > 1) why = ', in step with wider margins';
    else { const wc = traj(L('ccc')); if (down && wc && wc.windowDelta > 5) why = ', as more cash gets tied up in working capital'; }
    push(4.5 + Math.abs(roce.windowDelta) / 3, up ? 'up' : down ? 'down' : 'flat', up ? 'good' : down ? 'bad' : 'neutral',
      up ? 'Capital efficiency improving' : down ? 'Capital efficiency slipping' : 'Returns steady',
      `Median ROCE is ${n0(roce.last.v)}% (${fyLabel(roce.first.fy)}: ${n0(roce.first.v)}%)${why}.`);
  }

  // 4) Working-capital cycle + receivables/inventory driver
  const ccc = traj(L('ccc'));
  if (ccc && Math.abs(ccc.windowDelta) > 4) {
    const worse = ccc.windowDelta > 0;
    const dd = traj(L('debtor_days')), inv = traj(L('inventory_days'));
    let why = '';
    if (worse && dd && dd.windowDelta > 5) why = `, driven by receivable days stretching (${n0(dd.first.v)}→${n0(dd.last.v)})`;
    else if (worse && inv && inv.windowDelta > 5) why = `, on higher inventory (${n0(inv.first.v)}→${n0(inv.last.v)} days)`;
    push(4, worse ? 'up' : 'down', worse ? 'bad' : 'good',
      worse ? 'Cash cycle is stretching' : 'Working capital tightening',
      `The sector's cash-conversion cycle ${worse ? 'lengthened' : 'shortened'} from ${n0(ccc.first.v)} to ${n0(ccc.last.v)} days${why}.`);
  }

  // 5) Consolidation — leader share
  const ls = leaderShareLine(peers, 'revenue');
  const lt = traj({ years: ls.years, values: ls.top1 });
  if (lt) {
    const con = lt.windowDelta > 2, frag = lt.windowDelta < -2;
    push(3.5, con ? 'up' : frag ? 'down' : 'flat', 'neutral',
      con ? 'The sector is consolidating' : frag ? 'Share is dispersing' : 'Stable market structure',
      `The largest peer holds ${n0(lt.last.v)}% of listed-peer revenue (${fyLabel(lt.first.fy)}: ${n0(lt.first.v)}%) — ${con ? 'the leader is gaining ground' : frag ? 'smaller players are catching up' : 'the pecking order is steady'}.`);
  }

  // 6) Margin dispersion — winners pulling away vs commoditising
  const disp = traj(dispersionLine(peers, 'ebitda_margin'));
  if (disp && disp.first.v > 0) {
    const widen = disp.last.v > disp.first.v * 1.15, narrow = disp.last.v < disp.first.v * 0.85;
    if (widen || narrow) push(3, widen ? 'up' : 'down', 'neutral',
      widen ? 'Winners are pulling away' : 'Margins are converging',
      `The spread in margins across peers has ${widen ? 'widened' : 'narrowed'} (${p1(disp.first.v)}→${p1(disp.last.v)} pts) — ${widen ? 'the strongest are extending their edge' : 'the sector is commoditising'}.`);
  }

  // 7) Leverage
  const de = traj(L('debt_equity'));
  if (de && Math.abs(de.windowDelta) > 0.1) {
    const lever = de.windowDelta > 0;
    push(2.8, lever ? 'up' : 'down', lever ? 'bad' : 'good',
      lever ? 'The sector is adding debt' : 'Balance sheets are deleveraging',
      `Median debt/equity is ${de.last.v.toFixed(2)}× (${fyLabel(de.first.fy)}: ${de.first.v.toFixed(2)}×) — ${lever ? 'leverage is creeping up' : 'the sector is paying down debt'}.`);
  }

  // 8) Capex cycle
  const cwip = traj(L('cwip', 'sum'));
  if (cwip && cwip.first.v > 0) {
    const building = cwip.recentDelta > 0 && cwip.last.v > cwip.first.v * 1.2;
    if (building || cwip.last.v < cwip.first.v * 0.8) push(2.6, building ? 'up' : 'down', 'neutral',
      building ? 'A capex up-cycle' : 'Capex is cooling',
      `Capital-work-in-progress across peers is ${building ? 'rising' : 'easing'} — ${building ? 'capacity is being built, pointing to future supply/growth' : 'expansion has slowed'}.`);
  }

  // 9) Institutional rotation
  const fii = traj(L('fii_holding')), dii = traj(L('dii_holding'));
  if (fii && dii) {
    const diiUp = dii.windowDelta > 1, fiiDown = fii.windowDelta < -1;
    if (diiUp || fiiDown) push(2.4, diiUp ? 'up' : 'down', 'neutral', 'Ownership is rotating',
      `Domestic funds ${diiUp ? `raised holdings to ${n0(dii.last.v)}%` : `hold ${n0(dii.last.v)}%`} while foreign investors ${fiiDown ? `trimmed to ${n0(fii.last.v)}%` : `sit at ${n0(fii.last.v)}%`} — a ${diiUp && fiiDown ? 'clear DII-for-FII rotation' : 'shift in the shareholder base'}.`);
  }

  return F.sort((a, b) => b.imp - a.imp).slice(0, 7);
}

export function renderIndustry(pane, report) {
  const peers = report.peers.indian || [];
  const withData = peers.filter((p) => p.series && Object.keys(p.series).length);
  const name = (report.meta && (report.meta.segment || report.meta.name)) || 'the industry';
  if (withData.length < 2) {
    pane.innerHTML = `<div class="text-center text-slate-400 py-16 text-sm">Need at least two listed peers with trend data to build an industry view.</div>`;
    return;
  }

  // ---- aggregate the sector's trends ----
  const rev = industryLine(peers, 'revenue', 'sum');
  const margin = industryLine(peers, 'ebitda_margin');
  const roce = industryLine(peers, 'roce');
  const ccc = industryLine(peers, 'ccc');
  const rm = industryLine(peers, 'rm_cost_pct');
  const cwip = industryLine(peers, 'cwip', 'sum');
  const fii = industryLine(peers, 'fii_holding');
  const dii = industryLine(peers, 'dii_holding');
  const leader = leaderShareLine(peers, 'revenue');
  const disp = dispersionLine(peers, 'ebitda_margin');
  const share = revenueShare(peers);

  const lastNum = (line) => { const fl = firstLast(line); return fl ? fl.b.v : null; };
  const deltaOf = (line) => { const fl = firstLast(line); return fl ? +(fl.b.v - fl.a.v).toFixed(1) : null; };

  // ---- headline tiles ----
  const revCagr = cagr(rev);
  const tiles = [
    { label: 'Industry revenue', val: unitFmt(lastNum(rev), 'Rs Cr'), sub: `${withData.length} listed peers`, delta: deltaOf(rev), good: 'high' },
    { label: 'Revenue CAGR', val: revCagr == null ? '—' : revCagr + '%', sub: `${rev.years.length ? fyLabel(rev.years[0]) + '–' + fyLabel(rev.years[rev.years.length - 1]) : ''}`, delta: revCagr, good: 'high' },
    { label: 'Median EBITDA margin', val: unitFmt(lastNum(margin), '%'), sub: 'now', delta: deltaOf(margin), good: 'high' },
    { label: 'Median ROCE', val: unitFmt(lastNum(roce), '%'), sub: 'now', delta: deltaOf(roce), good: 'high' },
  ];
  const tileHtml = tiles.map((t) => `
    <div class="rounded-2xl bg-white p-4 border border-slate-100">
      <div class="text-[0.66rem] font-bold uppercase tracking-wide text-slate-400">${esc(t.label)}</div>
      <div class="num font-display text-2xl font-extrabold text-slate-800 mt-1">${esc(t.val)} ${t.delta == null ? '' : arrowSpan(t.delta, t.good)}</div>
      <div class="text-[0.7rem] text-slate-400 mt-0.5">${esc(t.sub)}</div>
    </div>`).join('');

  // ---- then vs now table ----
  const tvnMetrics = ['revenue', 'ebitda_margin', 'pat_margin', 'roce', 'roe', 'ccc', 'rm_cost_pct', 'debt_equity']
    .map((k) => (report.metrics || []).find((m) => m.key === k)).filter(Boolean);
  const tvnRows = tvnMetrics.map((m) => thenVsNow(peers, m)).filter(Boolean).map((r) => {
    const delta = +(r.latestVal - r.avg).toFixed(2);
    return `<tr>
      <td class="pv-col1">${esc(r.label)}</td>
      <td class="num">${esc(unitFmt(r.firstVal, r.unit))}<span class="text-slate-400 text-[0.7rem]"> ${esc(fyLabel(r.firstYear))}</span></td>
      <td class="num">${esc(unitFmt(r.avg, r.unit))}</td>
      <td class="num font-semibold">${esc(unitFmt(r.latestVal, r.unit))}<span class="text-slate-400 text-[0.7rem]"> ${esc(fyLabel(r.latestYear))}</span></td>
      <td style="text-align:center">${arrowSpan(delta, r.better)}</td>
    </tr>`;
  }).join('');

  // ---- structure verdict ----
  const dispFL = firstLast(disp);
  const dispVerdict = dispFL
    ? (dispFL.b.v > dispFL.a.v * 1.1
      ? 'Margins are <b class="text-emerald-700">fanning out</b> — the strong are pulling away (a winner-takes-share market).'
      : dispFL.b.v < dispFL.a.v * 0.9
        ? 'Margins are <b class="text-rose-600">converging</b> — the edge is narrowing (commoditising).'
        : 'Margin spread is broadly <b>stable</b> across the peer set.')
    : '';
  const leadFL = firstLast({ years: leader.years, values: leader.top1 });
  const leadVerdict = leadFL
    ? `Top player holds <b>${leadFL.b.v}%</b> of peer revenue (was ${leadFL.a.v}% in ${fyLabel(leadFL.a.y)}) — ${leadFL.b.v > leadFL.a.v + 2 ? 'consolidating' : leadFL.b.v < leadFL.a.v - 2 ? 'share is dispersing' : 'broadly steady'}.`
    : '';

  const cap = (line, unit) => { const fl = firstLast(line); return fl ? `${unitFmt(fl.a.v, unit)} (${fyLabel(fl.a.y)}) → ${unitFmt(fl.b.v, unit)} (${fyLabel(fl.b.y)})` : '—'; };

  // ---- top findings (the headline: trajectory + why) ----
  const findings = buildFindings(peers);
  const findingsHtml = findings.map((f, i) => {
    const accent = f.good === 'good' ? 'border-emerald-400' : f.good === 'bad' ? 'border-rose-400' : 'border-indigo-300';
    const arrow = f.dir === 'up' ? '▲' : f.dir === 'down' ? '▼' : '→';
    const arrowCls = f.good === 'good' ? 'text-emerald-600' : f.good === 'bad' ? 'text-rose-500' : 'text-slate-400';
    return `<li class="flex gap-3 py-2.5 border-l-2 ${accent} pl-3">
      <span class="shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center num">${i + 1}</span>
      <div class="min-w-0">
        <div class="font-bold text-slate-800 text-sm flex items-center gap-1.5">${esc(f.title)} <span class="${arrowCls}">${arrow}</span></div>
        <div class="text-[0.83rem] text-slate-600 leading-relaxed">${esc(f.detail)}</div>
      </div></li>`;
  }).join('');

  // ---- layout ----
  pane.innerHTML = `
  <div id="print-region" class="pv-industry space-y-5">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h2 class="font-display text-2xl font-extrabold text-slate-800">Industry Research — ${esc(name)}</h2>
        <p class="text-sm text-slate-500 mt-0.5">How the sector has moved across ${rev.years.length ? fyLabel(rev.years[0]) + '–' + fyLabel(rev.years[rev.years.length - 1]) : 'the years'}, from the ${withData.length} benchmarked listed peers. <span class="text-slate-400">A listed-peer proxy — not the whole market.</span></p>
      </div>
      <button data-export-pdf class="no-print pv-focus inline-flex items-center gap-1.5 rounded-xl brand-gradient px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg> Export PDF
      </button>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">${tileHtml}</div>

    <section class="pv-card p-5">
      <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Top findings — what's changed &amp; why</h3>
      <p class="text-xs text-slate-400 mb-3">Auto-read from the whole-history trends across the ${withData.length} peers — the sector's story in seven lines.</p>
      <ol class="space-y-0.5">${findingsHtml || '<li class="text-slate-400 text-sm py-4">Not enough trend history to derive findings.</li>'}</ol>
    </section>

    <section class="pv-card p-5">
      <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">The sector over the years</h3>
      <p class="text-xs text-slate-400 mb-4">Median across peers each year — the shape of the industry.</p>
      <div class="pv-ind-grid grid md:grid-cols-2 gap-5">
        ${chartBlock('rev', 'Industry size (total revenue)', cap(rev, 'Rs Cr'))}
        ${chartBlock('margin', 'Profitability (median EBITDA margin)', cap(margin, '%'))}
        ${chartBlock('roce', 'Capital efficiency (median ROCE)', cap(roce, '%'))}
        ${chartBlock('ccc', 'Working capital (median cash-conversion days)', cap(ccc, 'days'))}
      </div>
    </section>

    <section class="pv-card p-5">
      <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Then vs now</h3>
      <p class="text-xs text-slate-400 mb-3">Where the sector sits today against its long-run average.</p>
      <div class="pv-scroll"><table class="pv-table pv-ind-tvn">
        <thead><tr><th class="pv-col1">Metric</th><th style="text-align:right">Start</th><th style="text-align:right">Avg</th><th style="text-align:right">Now</th><th style="text-align:center">Trend</th></tr></thead>
        <tbody>${tvnRows}</tbody>
      </table></div>
    </section>

    <div class="pv-ind-grid grid lg:grid-cols-2 gap-5">
      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Input-cost pressure</h3>
        <p class="text-xs text-slate-400 mb-3">Median raw-material % of sales — rising squeezes margins.</p>
        ${chartBlock('rm', '', cap(rm, '%'), 210)}
      </section>
      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Who owns the market</h3>
        <p class="text-xs text-slate-400 mb-3">Latest revenue share across the listed peers.</p>
        <div style="height:230px"><canvas data-c="share"></canvas></div>
      </section>
    </div>

    <section class="pv-card p-5">
      <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Is it consolidating or commoditising?</h3>
      <div class="pv-ind-grid grid lg:grid-cols-2 gap-5 mt-2">
        <div>
          <p class="text-xs text-slate-500 mb-2">${leadVerdict}</p>
          ${chartBlock('leader', '', 'Top-1 vs Top-3 share of peer revenue', 210)}
        </div>
        <div>
          <p class="text-xs text-slate-500 mb-2">${dispVerdict}</p>
          ${chartBlock('disp', '', cap(disp, '%') + ' spread', 210)}
        </div>
      </div>
    </section>

    <div class="pv-ind-grid grid lg:grid-cols-2 gap-5">
      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Capex cycle</h3>
        <p class="text-xs text-slate-400 mb-3">Total capital-work-in-progress — capacity being built.</p>
        ${chartBlock('cwip', '', cap(cwip, 'Rs Cr'), 210)}
      </section>
      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Institutional interest</h3>
        <p class="text-xs text-slate-400 mb-3">Median FII &amp; DII holding across peers.</p>
        ${chartBlock('inst', '', `FII ${cap(fii, '%')} · DII ${cap(dii, '%')}`, 210)}
      </section>
    </div>
  </div>`;

  // ---- draw charts (hovers built into makeLine/makeDoughnut) ----
  const C = (k) => pane.querySelector(`[data-c="${k}"]`);
  makeLine(C('rev'), { years: rev.years.map(fyLabel), series: [{ label: 'Total revenue', values: rev.values }], unit: 'Rs Cr', area: true });
  makeLine(C('margin'), { years: margin.years.map(fyLabel), series: [{ label: 'EBITDA margin', values: margin.values }], unit: '%', area: true });
  makeLine(C('roce'), { years: roce.years.map(fyLabel), series: [{ label: 'ROCE', values: roce.values }], unit: '%', area: true });
  makeLine(C('ccc'), { years: ccc.years.map(fyLabel), series: [{ label: 'Cash-conversion days', values: ccc.values }], unit: 'days', area: true });
  makeLine(C('rm'), { years: rm.years.map(fyLabel), series: [{ label: 'Raw material %', values: rm.values }], unit: '%', area: true });
  makeLine(C('leader'), { years: leader.years.map(fyLabel), series: [{ label: 'Top company', values: leader.top1 }, { label: 'Top 3', values: leader.top3 }], unit: '%', area: false });
  makeLine(C('disp'), { years: disp.years.map(fyLabel), series: [{ label: 'Margin spread (std-dev)', values: disp.values }], unit: '%', area: true });
  makeLine(C('cwip'), { years: cwip.years.map(fyLabel), series: [{ label: 'Capital WIP', values: cwip.values }], unit: 'Rs Cr', area: true });
  makeLine(C('inst'), { years: fii.years.map(fyLabel), series: [{ label: 'FII', values: fii.values }, { label: 'DII', values: dii.values }], unit: '%', area: false });
  if (C('share')) makeDoughnut(C('share'), { labels: share.map((r) => r.name), values: share.map((r) => r.value) });

  const btn = pane.querySelector('[data-export-pdf]');
  if (btn) btn.addEventListener('click', () => window.print());
}

function chartBlock(key, title, caption, height = 220) {
  return `<div>
    ${title ? `<div class="text-sm font-bold text-slate-700 mb-1">${esc(title)}</div>` : ''}
    <div style="height:${height}px"><canvas data-c="${esc(key)}"></canvas></div>
    ${caption ? `<div class="text-[0.72rem] text-slate-500 mt-1.5 text-center">${caption}</div>` : ''}
  </div>`;
}

/** Destroy any charts in the industry pane (called on tab switch). */
export function destroyIndustryCharts(pane) {
  pane.querySelectorAll('canvas').forEach((c) => destroyChart(c));
}
