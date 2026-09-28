// scorecard.js — two tables:
//  (a) Winner-per-metric (computed live, respects `better`; neutral metrics have no winner)
//  (b) Composite ranking (scores + strengths + free-text reason come FROM the JSON).
import { esc, fmtUnit } from './format.js';
import { winnersAcross } from './compute.js';

const BUCKET_LABEL = { indian: 'Indian', global: 'Global', private: 'Private' };
const BUCKET_CLS = {
  indian: 'bg-indigo-50 text-indigo-700',
  global: 'bg-sky-50 text-sky-700',
  private: 'bg-fuchsia-50 text-fuchsia-700',
};

export function renderScorecard(container, report) {
  const groups = [report.peers.indian || [], report.peers.global || [], report.peers.private || []];
  const winners = winnersAcross(groups, report.metrics);
  const ranking = (report.scorecard && report.scorecard.ranking) ? [...report.scorecard.ranking].sort((a, b) => (a.rank || 99) - (b.rank || 99)) : [];
  const maxScore = Math.max(100, ...ranking.map((r) => r.score || 0));

  container.innerHTML = `
    <div class="grid gap-5 lg:grid-cols-2 items-start">
      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">🏅 Winner per metric</h3>
        <p class="text-xs text-slate-400 mb-3">Best peer for each metric, honouring its "better" direction. Neutral metrics (valuation, ownership) have no winner.</p>
        <div class="pv-scroll" style="max-height:60vh">
          <table class="pv-table" style="min-width:auto;width:100%">
            <thead><tr><th class="pv-col1" style="min-width:11rem">Metric</th><th style="text-align:left">Winner</th><th>Value</th></tr></thead>
            <tbody>${winners.map(winnerRow).join('')}</tbody>
          </table>
        </div>
      </section>

      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">📊 Composite ranking</h3>
        <p class="text-xs text-slate-400 mb-4">Overall score (0–100) with strengths and the written reason. Scores &amp; reasons are AI-generated (seeded in Step 1).</p>
        <ol class="space-y-3">${ranking.map((r) => rankCard(r, maxScore)).join('')}</ol>
      </section>
    </div>`;
}

function winnerRow({ metric, winner }) {
  if (metric.better === 'neutral' || !winner) {
    return `<tr><td class="pv-col1 text-slate-500">${esc(metric.label)}</td><td class="text-slate-300" style="text-align:left">— no winner —</td><td class="num text-slate-300">—</td></tr>`;
  }
  return `<tr>
    <td class="pv-col1 text-slate-600">${esc(metric.label)}</td>
    <td style="text-align:left"><span class="font-semibold text-slate-800">${esc(winner.name)}</span></td>
    <td class="num font-semibold text-emerald-600">${esc(fmtUnit(winner.value, metric))}</td>
  </tr>`;
}

function rankCard(r, maxScore) {
  const top = r.rank === 1;
  const pct = Math.round(((r.score || 0) / maxScore) * 100);
  const strengths = (r.strengths || []).map((s) => `<span class="pv-chip bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[0.68rem]">${esc(s)}</span>`).join(' ');
  const bcls = BUCKET_CLS[r.bucket] || 'bg-slate-100 text-slate-600';
  return `<li class="rounded-2xl border ${top ? 'border-amber-200 bg-gradient-to-br from-amber-50 to-white ring-1 ring-amber-100' : 'border-slate-100 bg-white'} p-4">
    <div class="flex items-center gap-3">
      <div class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center font-display font-extrabold ${top ? 'brand-gradient text-white' : 'bg-slate-100 text-slate-500'}">${top ? '👑' : esc(String(r.rank || ''))}</div>
      <div class="grow min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-display font-bold text-slate-800">${esc(r.company)}</span>
          <span class="pv-chip ${bcls} px-2 py-0.5 text-[0.65rem] font-semibold">${esc(BUCKET_LABEL[r.bucket] || r.bucket || '')}</span>
        </div>
      </div>
      <div class="shrink-0 text-right">
        <div class="num font-display text-xl font-extrabold ${top ? 'brand-text' : 'text-slate-700'}">${esc(String(r.score ?? '—'))}</div>
        <div class="text-[0.6rem] text-slate-400 -mt-0.5">/ 100</div>
      </div>
    </div>
    <div class="pv-progress-track h-1.5 my-3"><div class="pv-progress-bar h-full" style="width:${pct}%"></div></div>
    ${strengths ? `<div class="flex flex-wrap gap-1.5 mb-2">${strengths}</div>` : ''}
    <p class="text-sm text-slate-600 leading-relaxed">${esc(r.reason || '')}</p>
  </li>`;
}
