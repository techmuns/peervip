// scorecard.js — two tables:
//  (a) Winner-per-metric (computed live over the Indian benchmarked set; respects `better`)
//  (b) Composite ranking as a compact, click-to-expand table (scores + strengths +
//      free-text reason come FROM the JSON). Globals are descriptive-only elsewhere,
//      so the benchmarking ranking is the Indian listed set.
import { esc, fmtUnit } from './format.js';
import { winnersAcross } from './compute.js';

export function renderScorecard(container, report) {
  const indian = report.peers.indian || [];
  const winners = winnersAcross([indian], report.metrics);
  let ranking = (report.scorecard && report.scorecard.ranking ? report.scorecard.ranking : [])
    .filter((r) => r.bucket === 'indian')
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  if (!ranking.length && report.scorecard && report.scorecard.ranking) {
    ranking = [...report.scorecard.ranking].sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  const maxScore = Math.max(100, ...ranking.map((r) => r.score || 0));

  container.innerHTML = `
    <div class="grid gap-5 lg:grid-cols-2 items-start">
      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">🏅 Winner per metric</h3>
        <p class="text-xs text-slate-400 mb-3">Best Indian listed peer for each metric, honouring its “better” direction. Neutral metrics (valuation, ownership) have no winner.</p>
        <div class="pv-scroll" style="max-height:60vh">
          <table class="pv-table" style="min-width:auto;width:100%">
            <thead><tr><th class="pv-col1" style="min-width:11rem">Metric</th><th style="text-align:left">Winner</th><th>Value</th></tr></thead>
            <tbody>${winners.map(winnerRow).join('')}</tbody>
          </table>
        </div>
      </section>

      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">📊 Composite ranking</h3>
        <p class="text-xs text-slate-400 mb-3">Overall score (0–100) for the Indian listed set. Click a row for its strengths and the written reason. Scores &amp; reasons are AI-generated.</p>
        <div class="overflow-x-auto rounded-xl">
          <table class="pv-rank w-full">
            <thead><tr>
              <th class="pv-rank-hash">#</th>
              <th style="text-align:left">Company</th>
              <th>Score</th>
              <th aria-hidden="true"></th>
            </tr></thead>
            <tbody>${ranking.length ? ranking.map((r, i) => rankRow(r, i + 1, maxScore)).join('') : `<tr><td colspan="4" class="text-center text-slate-400 py-8 text-sm">No ranked peers in this dataset.</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    </div>`;

  container.querySelectorAll('[data-rank-row]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const det = tr.nextElementSibling;
      const open = tr.classList.toggle('is-open');
      if (det && det.hasAttribute('data-rank-detail')) det.hidden = !open;
    });
  });
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

function rankRow(r, displayRank, maxScore) {
  const top = displayRank === 1;
  const pct = Math.round(((r.score || 0) / maxScore) * 100);
  const strengths = (r.strengths || []).map((s) => `<span class="pv-chip bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[0.68rem]">${esc(s)}</span>`).join(' ');
  return `<tr class="pv-rank-row" data-rank-row>
      <td class="pv-rank-hash"><span class="pv-rank-badge ${top ? 'is-top' : ''}">${top ? '👑' : displayRank}</span></td>
      <td><span class="font-semibold text-slate-800">${esc(r.company)}</span></td>
      <td class="pv-rank-score">
        <span class="pv-rank-bar hidden sm:inline-block"><span style="width:${pct}%"></span></span>
        <span class="num font-display font-extrabold ${top ? 'brand-text' : 'text-slate-700'}">${esc(String(r.score ?? '—'))}</span>
      </td>
      <td class="pv-rank-chevcell"><svg class="pv-rank-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></td>
    </tr>
    <tr data-rank-detail hidden><td colspan="4" class="pv-rank-detail">
      ${strengths ? `<div class="flex flex-wrap gap-1.5 mb-2">${strengths}</div>` : ''}
      <p class="text-sm text-slate-600 leading-relaxed">${esc(r.reason || '')}</p>
    </td></tr>`;
}
