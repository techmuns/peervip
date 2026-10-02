// industry.js — the "Industry" tab: a visual-first sector read built entirely from
// the peer TRENDS. A toggle switches between "Trend" (the last ~5 fiscal years of
// movement, FY21→now) and "This year" (a current-year snapshot). Everything is
// aggregated live across the Indian listed set, recomputed on add/remove peer.
// Minimal prose; each chart carries one computed insight line. PDF via the shared
// #print-region + window.print().
import { esc, fmt, metricMap, companyNameHtml } from './format.js';
import { makeLine, makeDoughnut, makeHBar, destroyChart } from './charts.js';
import { industryLine, leaderShareLine, dispersionLine, revenueShare, median, currentValues, winnerForMetric } from './compute.js';

const isNum = (v) => typeof v === 'number' && isFinite(v);
const WINDOW = 6; // last 6 fiscal years shown = ~5 years of change (FY21→FY26)
const fyLabel = (y) => {
  if (typeof y === 'number' && isFinite(y)) return 'FY' + String(y).slice(-2);
  const m = /(\d{4})/.exec(String(y || '')); return m ? 'FY' + m[1].slice(-2) : String(y || '');
};
function win6(line) {
  if (!line || !line.years) return line;
  return { ...line, years: line.years.slice(-WINDOW), values: (line.values || []).slice(-WINDOW) };
}
function winLeader(ls) {
  if (!ls || !ls.years) return ls;
  return { years: ls.years.slice(-WINDOW), top1: (ls.top1 || []).slice(-WINDOW), top3: (ls.top3 || []).slice(-WINDOW) };
}
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
  const yrs = (fl.b.y - fl.a.y) || 1;
  return +(((fl.b.v / fl.a.v) ** (1 / yrs) - 1) * 100).toFixed(1);
}
function arrowSpan(delta, good) {
  if (delta === 0 || delta == null) return '<span class="text-slate-400">→</span>';
  const up = delta > 0;
  const positive = good === 'neutral' ? null : (good === 'high' ? up : !up);
  const cls = positive === null ? 'text-slate-500' : positive ? 'text-emerald-600' : 'text-rose-500';
  return `<span class="${cls} font-bold">${up ? '▲' : '▼'}</span>`;
}

// Trajectory: endpoints + recent-vs-earlier slope, so a finding can say "turned up
// in the last few years" rather than only comparing endpoints.
function traj(line) {
  const pts = (line.values || []).map((v, i) => ({ fy: line.years[i], v })).filter((o) => isNum(o.v));
  if (pts.length < 3) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const mid = pts[Math.max(0, pts.length - 4)];
  return { pts, first, last, mid, windowDelta: last.v - first.v, recentDelta: last.v - mid.v, earlierDelta: mid.v - first.v };
}
const turned = (t) => t && Math.sign(t.recentDelta) !== Math.sign(t.earlierDelta) && Math.abs(t.recentDelta) > 0.5;

/** Top ~7 auto-derived findings about what changed and WHY (over the shown window). */
function buildFindings(peers) {
  const L = (k, kind = 'median') => win6(industryLine(peers, k, kind));
  const F = [];
  const push = (imp, dir, good, title, detail) => { if (detail) F.push({ imp, dir, good, title, detail }); };
  const n0 = (v) => Math.round(v), p1 = (v) => v.toFixed(1);

  const m = traj(L('ebitda_margin')), rm = traj(L('rm_cost_pct'));
  if (m) {
    const up = m.recentDelta > 0.5, down = m.recentDelta < -0.5;
    let why = '';
    if (rm && up && rm.recentDelta < -0.5) why = `, helped by raw-material costs easing from ${n0(rm.mid.v)}% to ${n0(rm.last.v)}% of sales`;
    else if (rm && down && rm.recentDelta > 0.5) why = `, squeezed by raw-material costs climbing from ${n0(rm.mid.v)}% to ${n0(rm.last.v)}% of sales`;
    const turn = turned(m) ? ' — turning ' + (up ? 'up' : 'down') + ' after a softer stretch' : '';
    push(6 + Math.abs(m.windowDelta), up ? 'up' : down ? 'down' : 'flat', up ? 'good' : down ? 'bad' : 'neutral',
      up ? 'Margins are expanding' : down ? 'Margins are under pressure' : 'Margins are holding',
      `Industry EBITDA margin sits at ${n0(m.last.v)}% (${fyLabel(m.first.fy)}: ${n0(m.first.v)}%)${turn}${why}.`);
  }
  const rt = traj(L('revenue', 'sum'));
  if (rt) {
    const yrsAll = (rt.last.fy - rt.first.fy) || 1;
    const cagrAll = rt.first.v > 0 ? (((rt.last.v / rt.first.v) ** (1 / yrsAll) - 1) * 100) : null;
    const recentYrs = (rt.last.fy - rt.mid.fy) || 1;
    const cagrRecent = rt.mid.v > 0 ? (((rt.last.v / rt.mid.v) ** (1 / recentYrs) - 1) * 100) : null;
    if (cagrAll != null) {
      const accel = cagrRecent != null && cagrRecent > cagrAll + 1.5, cool = cagrRecent != null && cagrRecent < cagrAll - 1.5;
      push(5.5, accel ? 'up' : cool ? 'down' : 'flat', 'neutral',
        accel ? 'Growth is accelerating' : cool ? 'Growth is cooling' : 'Steady growth',
        `Sector revenue compounded ~${p1(cagrAll)}% a year over ${fyLabel(rt.first.fy)}–${fyLabel(rt.last.fy)}${cagrRecent != null ? `, and ~${p1(cagrRecent)}% in the last ${recentYrs} years` : ''}.`);
    }
  }
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
  const lsw = winLeader(leaderShareLine(peers, 'revenue'));
  const lt = traj({ years: lsw.years, values: lsw.top1 });
  if (lt) {
    const con = lt.windowDelta > 2, frag = lt.windowDelta < -2;
    push(3.5, con ? 'up' : frag ? 'down' : 'flat', 'neutral',
      con ? 'The sector is consolidating' : frag ? 'Share is dispersing' : 'Stable market structure',
      `The largest peer holds ${n0(lt.last.v)}% of listed-peer revenue (${fyLabel(lt.first.fy)}: ${n0(lt.first.v)}%) — ${con ? 'the leader is gaining ground' : frag ? 'smaller players are catching up' : 'the pecking order is steady'}.`);
  }
  const disp = traj(win6(dispersionLine(peers, 'ebitda_margin')));
  if (disp && disp.first.v > 0) {
    const widen = disp.last.v > disp.first.v * 1.15, narrow = disp.last.v < disp.first.v * 0.85;
    if (widen || narrow) push(3, widen ? 'up' : 'down', 'neutral',
      widen ? 'Winners are pulling away' : 'Margins are converging',
      `The spread in margins across peers has ${widen ? 'widened' : 'narrowed'} (${p1(disp.first.v)}→${p1(disp.last.v)} pts) — ${widen ? 'the strongest are extending their edge' : 'the sector is commoditising'}.`);
  }
  const de = traj(L('debt_equity'));
  if (de && Math.abs(de.windowDelta) > 0.1) {
    const lever = de.windowDelta > 0;
    push(2.8, lever ? 'up' : 'down', lever ? 'bad' : 'good',
      lever ? 'The sector is adding debt' : 'Balance sheets are deleveraging',
      `Median debt/equity is ${de.last.v.toFixed(2)}× (${fyLabel(de.first.fy)}: ${de.first.v.toFixed(2)}×) — ${lever ? 'leverage is creeping up' : 'the sector is paying down debt'}.`);
  }
  const cwip = traj(L('cwip', 'sum'));
  if (cwip && cwip.first.v > 0) {
    const building = cwip.recentDelta > 0 && cwip.last.v > cwip.first.v * 1.2;
    if (building || cwip.last.v < cwip.first.v * 0.8) push(2.6, building ? 'up' : 'down', 'neutral',
      building ? 'A capex up-cycle' : 'Capex is cooling',
      `Capital-work-in-progress across peers is ${building ? 'rising' : 'easing'} — ${building ? 'capacity is being built, pointing to future supply/growth' : 'expansion has slowed'}.`);
  }
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

  // ---- windowed sector trends (last ~5 fiscal years) ----
  const rev = win6(industryLine(peers, 'revenue', 'sum'));
  const margin = win6(industryLine(peers, 'ebitda_margin'));
  const roce = win6(industryLine(peers, 'roce'));
  const ccc = win6(industryLine(peers, 'ccc'));
  const rm = win6(industryLine(peers, 'rm_cost_pct'));
  const cwip = win6(industryLine(peers, 'cwip', 'sum'));
  const fii = win6(industryLine(peers, 'fii_holding'));
  const dii = win6(industryLine(peers, 'dii_holding'));
  const leader = winLeader(leaderShareLine(peers, 'revenue'));
  const disp = win6(dispersionLine(peers, 'ebitda_margin'));
  const share = revenueShare(peers);
  const cov = margin.coverage || rev.coverage || { min: 0, max: 0 };
  const fyRange = rev.years.length ? `${fyLabel(rev.years[0])}–${fyLabel(rev.years[rev.years.length - 1])}` : 'recent years';

  const lastNum = (line) => { const fl = firstLast(line); return fl ? fl.b.v : null; };
  const deltaOf = (line) => { const fl = firstLast(line); return fl ? +(fl.b.v - fl.a.v).toFixed(1) : null; };
  // How many plottable (non-null) years a line has — a line/caption needs ≥2 to
  // mean anything. With fewer, we show a clean note instead of a broken 1-dot chart.
  const pts = (line) => (line && line.values ? line.values.filter(isNum).length : 0);
  const cap = (line, unit) => { if (pts(line) < 2) return ''; const fl = firstLast(line); return fl ? `${unitFmt(fl.a.v, unit)} (${fyLabel(fl.a.y)}) → ${unitFmt(fl.b.v, unit)} (${fyLabel(fl.b.y)})` : ''; };

  // ---- headline tiles ----
  const revCagr = cagr(rev);
  const tiles = [
    { label: 'Industry revenue', val: unitFmt(lastNum(rev), 'Rs Cr'), sub: `${withData.length} listed peers`, delta: deltaOf(rev), good: 'high' },
    { label: 'Revenue CAGR', val: revCagr == null ? '—' : revCagr + '%', sub: fyRange, delta: revCagr, good: 'high' },
    { label: 'Median EBITDA margin', val: unitFmt(lastNum(margin), '%'), sub: 'now', delta: deltaOf(margin), good: 'high' },
    { label: 'Median ROCE', val: unitFmt(lastNum(roce), '%'), sub: 'now', delta: deltaOf(roce), good: 'high' },
  ];
  const tileHtml = tiles.map((t) => `
    <div class="rounded-2xl bg-white p-4 border border-slate-100">
      <div class="text-[0.66rem] font-bold uppercase tracking-wide text-slate-400">${esc(t.label)}</div>
      <div class="num font-display text-2xl font-extrabold text-slate-800 mt-1">${esc(t.val)} ${t.delta == null ? '' : arrowSpan(t.delta, t.good)}</div>
      <div class="text-[0.7rem] text-slate-400 mt-0.5">${esc(t.sub)}</div>
    </div>`).join('');

  // ---- findings ----
  const findingsHtml = buildFindings(peers).map((f, i) => {
    const accent = f.good === 'good' ? 'border-emerald-400' : f.good === 'bad' ? 'border-rose-400' : 'border-indigo-300';
    const arrow = f.dir === 'up' ? '▲' : f.dir === 'down' ? '▼' : '→';
    const arrowCls = f.good === 'good' ? 'text-emerald-600' : f.good === 'bad' ? 'text-rose-500' : 'text-slate-400';
    return `<li class="flex gap-3 py-2.5 border-l-2 ${accent} pl-3">
      <span class="shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center num">${i + 1}</span>
      <div class="min-w-0"><div class="font-bold text-slate-800 text-sm flex items-center gap-1.5">${esc(f.title)} <span class="${arrowCls}">${arrow}</span></div>
        <div class="text-[0.83rem] text-slate-600 leading-relaxed">${esc(f.detail)}</div></div></li>`;
  }).join('');

  // ---- then vs now (windowed) ----
  const tvnKeys = ['revenue', 'ebitda_margin', 'pat_margin', 'roce', 'roe', 'ccc', 'rm_cost_pct', 'debt_equity'];
  const tvnRows = tvnKeys.map((k) => (report.metrics || []).find((m) => m.key === k)).filter(Boolean).map((mt) => {
    const line = win6(industryLine(peers, mt.key, mt.key === 'revenue' ? 'sum' : 'median'));
    const fl = firstLast(line); if (!fl) return '';
    const pts = line.values.filter(isNum); const avg = pts.reduce((s, v) => s + v, 0) / pts.length;
    return `<tr>
      <td class="pv-col1">${esc(mt.label)}</td>
      <td class="num">${esc(unitFmt(fl.a.v, mt.unit))}<span class="text-slate-400 text-[0.7rem]"> ${esc(fyLabel(fl.a.y))}</span></td>
      <td class="num">${esc(unitFmt(avg, mt.unit))}</td>
      <td class="num font-semibold">${esc(unitFmt(fl.b.v, mt.unit))}<span class="text-slate-400 text-[0.7rem]"> ${esc(fyLabel(fl.b.y))}</span></td>
      <td style="text-align:center">${arrowSpan(+(fl.b.v - avg).toFixed(2), mt.better)}</td>
    </tr>`;
  }).join('');

  // ---- structure verdicts ----
  const dispFL = firstLast(disp);
  const dispVerdict = dispFL ? (dispFL.b.v > dispFL.a.v * 1.1
    ? 'Margins are <b class="text-emerald-700">fanning out</b> — the strong are pulling away (a winner-takes-share market).'
    : dispFL.b.v < dispFL.a.v * 0.9 ? 'Margins are <b class="text-rose-600">converging</b> — the edge is narrowing (commoditising).'
      : 'Margin spread is broadly <b>stable</b> across the peer set.') : '';
  const leadFL = firstLast({ years: leader.years, values: leader.top1 });
  const leadVerdict = leadFL ? `Top player holds <b>${leadFL.b.v}%</b> of peer revenue (was ${leadFL.a.v}% in ${fyLabel(leadFL.a.y)}) — ${leadFL.b.v > leadFL.a.v + 2 ? 'consolidating' : leadFL.b.v < leadFL.a.v - 2 ? 'share is dispersing' : 'broadly steady'}.` : '';

  // ---- current-year snapshot ----
  const curMed = (k) => median(currentValues(peers, k));
  const cake = [
    { label: 'Raw material', v: curMed('rm_cost_pct') },
    { label: 'Manufacturing', v: curMed('manufacturing_cost_pct') },
    { label: 'Employee', v: curMed('employee_cost_pct') },
    { label: 'Other costs', v: curMed('other_cost_pct') },
    { label: 'Operating profit', v: curMed('ebitda_margin') },
  ].filter((s) => isNum(s.v));
  const own = [
    { label: 'Promoters', v: curMed('promoter_holding') },
    { label: 'FIIs', v: curMed('fii_holding') },
    { label: 'DIIs', v: curMed('dii_holding') },
    { label: 'Public', v: curMed('public_holding') },
  ].filter((s) => isNum(s.v));
  const todayKeys = ['gross_margin', 'ebitda_margin', 'pat_margin', 'roce', 'roe', 'ccc', 'debtor_days', 'inventory_days', 'debt_equity', 'dividend_payout'];
  const todayRows = todayKeys.map((k) => (report.metrics || []).find((m) => m.key === k)).filter(Boolean).map((mt) => `
    <div class="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
      <span class="text-slate-500 text-sm">${esc(mt.label)}</span>
      <span class="num font-semibold text-slate-800">${esc(unitFmt(curMed(mt.key), mt.unit))}</span>
    </div>`).join('');
  const conc = leader.top1 && leader.top1.length
    ? `Largest peer <b class="text-slate-800">${leader.top1[leader.top1.length - 1]}%</b> · top 3 <b class="text-slate-800">${leader.top3[leader.top3.length - 1]}%</b> of listed-peer revenue`
    : '';

  // #1 current-year leaderboard — who leads each dimension right now (winnerForMetric honours `better`).
  const mm = metricMap(report.metrics);
  const lbSpec = [
    { cat: 'Biggest', key: 'revenue' }, { cat: 'Most profitable', key: 'ebitda_margin' },
    { cat: 'Best returns', key: 'roce' }, { cat: 'Fastest growing', key: 'rev_growth_1y' },
    { cat: 'Best cash conversion', key: 'cfo_op' }, { cat: 'Leanest balance sheet', key: 'debt_equity' },
  ];
  const byNameInd = new Map(peers.map((p) => [String(p.name || '').toLowerCase().replace(/\s+/g, ' ').trim(), p]));
  const lbHtml = lbSpec.map((x) => {
    const mt = mm[x.key]; if (!mt) return '';
    const w = winnerForMetric(peers, mt); if (!w) return '';
    const wp = byNameInd.get(String(w.name || '').toLowerCase().replace(/\s+/g, ' ').trim()) || { name: w.name };
    return `<div class="flex items-center justify-between gap-3 py-2 border-b border-slate-50 last:border-0">
      <div class="min-w-0"><div class="text-[0.66rem] font-bold uppercase tracking-wide text-slate-400">${esc(x.cat)}</div><div class="font-semibold text-slate-800 truncate">${companyNameHtml(wp)}</div></div>
      <div class="num font-semibold text-slate-700 shrink-0">${esc(unitFmt(w.value, mt.unit))}</div></div>`;
  }).join('');

  // #5 balance-sheet & cash health — how many peers clear each bar this year.
  const withCur = peers.filter((p) => p.current);
  const cnt = (fn) => withCur.filter(fn).length;
  const health = [
    { n: cnt((p) => isNum(p.current.fcf) && p.current.fcf > 0), label: 'Free-cash-flow positive', tone: 'good' },
    { n: cnt((p) => isNum(p.current.debt_equity) && p.current.debt_equity < 0.1), label: 'Debt-light (D/E &lt; 0.1)', tone: 'good' },
    { n: cnt((p) => isNum(p.current.debt_equity) && p.current.debt_equity > 1), label: 'Highly levered (D/E &gt; 1)', tone: 'bad' },
    { n: cnt((p) => isNum(p.current.dividend_payout) && p.current.dividend_payout > 0), label: 'Dividend-payers', tone: 'neutral' },
  ];
  const healthHtml = health.map((h) => {
    const tc = h.tone === 'good' ? 'text-emerald-600' : h.tone === 'bad' ? 'text-rose-500' : 'text-indigo-600';
    return `<div class="flex items-center justify-between py-2 border-b border-slate-50 last:border-0"><span class="text-slate-500 text-sm">${h.label}</span><span class="num font-display font-extrabold ${tc}">${h.n}<span class="text-slate-300 text-sm font-semibold">/${withCur.length}</span></span></div>`;
  }).join('');

  // #6 "where every peer sits" — latest-year bar across peers on a chosen metric.
  const selectable = (report.metrics || []).filter((m) => peers.some((p) => p.current && isNum(p.current[m.key])));
  const defaultBar = selectable.find((m) => m.key === 'ebitda_margin') || selectable.find((m) => m.group === 'Profitability' && m.better !== 'neutral') || selectable[0];

  // ================= layout =================
  pane.innerHTML = `
  <div id="print-region" class="pv-industry space-y-5">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h2 class="font-display text-2xl font-extrabold text-slate-800">Industry Research — ${esc(name)}</h2>
        <p class="text-sm text-slate-500 mt-0.5">The ${withData.length} benchmarked listed peers. <span class="text-slate-400">A listed-peer proxy — not the whole market.</span></p>
      </div>
      <div class="flex items-center gap-2 no-print">
        <div class="inline-flex rounded-xl bg-slate-100 p-1 text-sm font-semibold" role="tablist">
          <button data-ind-view="trend" class="pv-focus rounded-lg px-3.5 py-1.5 transition">Trend</button>
          <button data-ind-view="current" class="pv-focus rounded-lg px-3.5 py-1.5 transition">This year</button>
        </div>
        <button data-export-pdf class="pv-focus inline-flex items-center gap-1.5 rounded-xl brand-gradient px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg> Export PDF
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">${tileHtml}</div>

    <div data-ind-body></div>
  </div>`;

  const body = pane.querySelector('[data-ind-body]');
  const C = (k) => pane.querySelector(`[data-c="${k}"]`);

  const trendHtml = `
    <div class="space-y-5">
      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Top findings — what's changed &amp; why</h3>
        <p class="text-xs text-slate-400 mb-3">Auto-read from the ${fyRange} trends across the peers — the sector's story in seven lines.</p>
        <ol class="space-y-0.5">${findingsHtml || '<li class="text-slate-400 text-sm py-4">Not enough trend history to derive findings.</li>'}</ol>
      </section>

      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">The sector over the years</h3>
        <p class="text-xs text-slate-400 mb-4">Median across peers each fiscal year (${fyRange}) — typically ${cov.min}–${cov.max} of the ${withData.length} peers report each year; fiscal-year-change gaps are bridged so totals aren't dented.</p>
        <div class="pv-ind-grid grid md:grid-cols-2 gap-5">
          ${chartBlock('rev', 'Industry size (total revenue)', cap(rev, 'Rs Cr'))}
          ${chartBlock('margin', 'Profitability (median EBITDA margin)', cap(margin, '%'))}
          ${chartBlock('roce', 'Capital efficiency (median ROCE)', cap(roce, '%'))}
          ${chartBlock('ccc', 'Working capital (median cash-conversion days)', cap(ccc, 'days'))}
        </div>
      </section>

      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Then vs now</h3>
        <p class="text-xs text-slate-400 mb-3">Where the sector sits today against its ${fyRange} average.</p>
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
          <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Capex cycle</h3>
          <p class="text-xs text-slate-400 mb-3">Total capital-work-in-progress — capacity being built.</p>
          ${chartBlock('cwip', '', cap(cwip, 'Rs Cr'), 210)}
        </section>
      </div>

      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Is it consolidating or commoditising?</h3>
        <div class="pv-ind-grid grid lg:grid-cols-2 gap-5 mt-2">
          <div><p class="text-xs text-slate-500 mb-2">${leadVerdict}</p>${chartBlock('leader', '', 'Largest peer vs top 3 combined — share of peer revenue', 210)}</div>
          <div><p class="text-xs text-slate-500 mb-2">${dispVerdict}</p>${chartBlock('disp', '', 'Margin gap: ' + cap(disp, '%'), 210)}</div>
        </div>
      </section>

      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Institutional interest</h3>
        <p class="text-xs text-slate-400 mb-3">Median FII &amp; DII holding across peers.</p>
        ${chartBlock('inst', '', (pts(fii) >= 2 || pts(dii) >= 2) ? `FII ${cap(fii, '%')} · DII ${cap(dii, '%')}` : '', 220)}
      </section>
    </div>`;

  const currentHtml = `
    <div class="space-y-5">
      <div class="pv-ind-grid grid lg:grid-cols-3 gap-5">
        <section class="pv-card p-5 lg:col-span-2">
          <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Sector leaderboard</h3>
          <p class="text-xs text-slate-400 mb-2">Who leads each dimension this year.</p>
          <div>${lbHtml || '<div class="text-slate-400 text-sm py-4">No data.</div>'}</div>
        </section>
        <section class="pv-card p-5">
          <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Balance-sheet &amp; cash health</h3>
          <p class="text-xs text-slate-400 mb-2">How many of the ${withCur.length} peers clear each bar.</p>
          <div>${healthHtml}</div>
        </section>
      </div>

      <section class="pv-card p-5">
        <div class="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h3 class="font-display text-lg font-extrabold text-slate-800">Where every peer sits</h3>
          <label class="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 no-print">Metric
            <select data-ind-metric class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200">
              ${selectable.map((m) => `<option value="${esc(m.key)}" ${defaultBar && m.key === defaultBar.key ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="text-xs text-slate-400 mb-3">Latest reported year across peers · dashed line = industry median.</p>
        <div data-peerbar-box></div>
      </section>

      <div class="pv-ind-grid grid lg:grid-cols-2 gap-5">
        <section class="pv-card p-5">
          <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Market share</h3>
          <p class="text-xs text-slate-400 mb-3">Share of combined peer revenue, latest year.</p>
          <div style="height:250px"><canvas data-c="share"></canvas></div>
          <p class="text-[0.72rem] text-slate-500 mt-2 text-center">${conc}</p>
        </section>
        <section class="pv-card p-5">
          <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Where each ₹100 of sales goes</h3>
          <p class="text-xs text-slate-400 mb-3">Industry-median cost split, latest year (approx).</p>
          <div style="height:250px"><canvas data-c="cake"></canvas></div>
        </section>
      </div>
      <div class="pv-ind-grid grid lg:grid-cols-2 gap-5">
        <section class="pv-card p-5">
          <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">Who owns the sector</h3>
          <p class="text-xs text-slate-400 mb-3">Median shareholding across peers, latest year.</p>
          <div style="height:250px"><canvas data-c="own"></canvas></div>
        </section>
        <section class="pv-card p-5">
          <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">The industry today</h3>
          <p class="text-xs text-slate-400 mb-3">Median across peers, latest reported year.</p>
          <div>${todayRows}</div>
        </section>
      </div>
    </div>`;

  // Draw a line chart, but when fewer than 2 years are plottable (thin peer sets
  // with sparse history — e.g. a 2-peer report's institutional holding) a line is
  // meaningless and renders as a lone dot. Show a clean note (with the single
  // latest value, if any) instead of a broken chart.
  const plotLine = (key, cfg) => {
    const canvas = C(key);
    if (!canvas) return;
    const maxPts = Math.max(0, ...cfg.series.map((s) => s.values.filter(isNum).length));
    if (maxPts >= 2) { makeLine(canvas, cfg); return; }
    const host = canvas.parentElement;
    if (!host) return;
    const bits = cfg.series.map((s) => {
      let i = -1;
      for (let j = 0; j < s.values.length; j++) if (isNum(s.values[j])) i = j;
      return i < 0 ? null : `${esc(s.label)} ${esc(unitFmt(s.values[i], cfg.unit))}${cfg.years[i] ? ` (${esc(cfg.years[i])})` : ''}`;
    }).filter(Boolean);
    host.innerHTML = `<div class="flex h-full flex-col items-center justify-center gap-1.5 text-center px-4">
      <div class="text-xs text-slate-400">Not enough multi-year coverage across these peers to chart a trend.</div>
      ${bits.length ? `<div class="text-sm font-semibold text-slate-600">${bits.join(' · ')}</div>` : ''}
    </div>`;
  };

  function drawTrend() {
    plotLine('rev', { years: rev.years.map(fyLabel), series: [{ label: 'Total revenue', values: rev.values }], unit: 'Rs Cr', area: true });
    plotLine('margin', { years: margin.years.map(fyLabel), series: [{ label: 'EBITDA margin', values: margin.values }], unit: '%', area: true });
    plotLine('roce', { years: roce.years.map(fyLabel), series: [{ label: 'ROCE', values: roce.values }], unit: '%', area: true });
    plotLine('ccc', { years: ccc.years.map(fyLabel), series: [{ label: 'Cash-conversion days', values: ccc.values }], unit: 'days', area: true });
    plotLine('rm', { years: rm.years.map(fyLabel), series: [{ label: 'Raw material %', values: rm.values }], unit: '%', area: true });
    plotLine('cwip', { years: cwip.years.map(fyLabel), series: [{ label: 'Capital WIP', values: cwip.values }], unit: 'Rs Cr', area: true });
    plotLine('leader', { years: leader.years.map(fyLabel), series: [{ label: 'Largest peer', values: leader.top1 }, { label: 'Top 3 combined', values: leader.top3 }], unit: '%', area: false });
    plotLine('disp', { years: disp.years.map(fyLabel), series: [{ label: 'Margin gap across peers', values: disp.values }], unit: '%', area: true });
    plotLine('inst', { years: fii.years.map(fyLabel), series: [{ label: 'FII', values: fii.values }, { label: 'DII', values: dii.values }], unit: '%', area: false });
  }
  function drawCurrent() {
    if (C('share') && share.length) makeDoughnut(C('share'), { labels: share.map((r) => r.name), values: share.map((r) => r.value) });
    if (C('cake') && cake.length) makeDoughnut(C('cake'), { labels: cake.map((s) => s.label), values: cake.map((s) => +s.v.toFixed(1)) });
    if (C('own') && own.length) makeDoughnut(C('own'), { labels: own.map((s) => s.label), values: own.map((s) => +s.v.toFixed(1)) });
    // #6 where every peer sits (latest year) — bar + median, driven by the dropdown.
    const sel = pane.querySelector('[data-ind-metric]');
    const box = pane.querySelector('[data-peerbar-box]');
    const outperf = (report.outperformer && report.outperformer.company) || '';
    const drawBar = (mt) => {
      if (!box || !mt) return;
      const old = box.querySelector('canvas'); if (old) destroyChart(old);
      const rows = peers.filter((p) => p.current && isNum(p.current[mt.key])).map((p) => ({ name: p.name, value: p.current[mt.key] }))
        .sort((a, b) => mt.better === 'low' ? a.value - b.value : b.value - a.value);
      if (!rows.length) { box.innerHTML = '<div class="text-center text-slate-400 py-8 text-sm">No peers carry this metric.</div>'; return; }
      const medVal = median(rows.map((r) => r.value));
      box.innerHTML = `<div style="height:${Math.max(180, rows.length * 34 + 44)}px"><canvas></canvas></div>`;
      makeHBar(box.querySelector('canvas'), {
        labels: rows.map((r) => r.name), values: rows.map((r) => r.value),
        medianValue: medVal, unit: mt.unit, label: mt.label, highlightIndex: rows.findIndex((r) => r.name === outperf),
      });
    };
    if (sel && defaultBar) { drawBar(defaultBar); sel.addEventListener('change', () => drawBar(mm[sel.value] || defaultBar)); }
  }

  const btns = [...pane.querySelectorAll('[data-ind-view]')];
  function show(view) {
    destroyIndustryCharts(body);
    body.innerHTML = view === 'current' ? currentHtml : trendHtml;
    if (view === 'current') drawCurrent(); else drawTrend();
    btns.forEach((b) => {
      const on = b.dataset.indView === view;
      b.classList.toggle('bg-white', on); b.classList.toggle('shadow-sm', on);
      b.classList.toggle('text-indigo-600', on); b.classList.toggle('text-slate-500', !on);
    });
  }
  btns.forEach((b) => b.addEventListener('click', () => show(b.dataset.indView)));
  show('trend');

  const pdf = pane.querySelector('[data-export-pdf]');
  if (pdf) pdf.addEventListener('click', () => window.print());
}

function chartBlock(key, title, caption, height = 220) {
  return `<div>
    ${title ? `<div class="text-sm font-bold text-slate-700 mb-1">${esc(title)}</div>` : ''}
    <div style="height:${height}px"><canvas data-c="${esc(key)}"></canvas></div>
    ${caption ? `<div class="text-[0.72rem] text-slate-500 mt-1.5 text-center">${caption}</div>` : ''}
  </div>`;
}

/** Destroy any charts in the given element (called on view/tab switch). */
export function destroyIndustryCharts(el) {
  if (el) el.querySelectorAll('canvas').forEach((c) => destroyChart(c));
}
