// scorecard.js — Winner-per-metric (live) + Composite ranking that RE-RANKS the
// moment a peer is added or removed. A ranking row's score is the AI research score
// where that company was scored; peers without one (e.g. user-added) are scored live
// from their metrics (average percentile rank vs the current set). Written reasons
// are the AI's where available, else a short data-derived line. Everything reads the
// CURRENT report.peers.indian, so add/remove flows straight through.
import { esc, fmtUnit, companyNameHtml } from './format.js';
import { helpIcon } from './help.js';
import { winnersAcross, compositeScores, rankPosition, median, currentValues } from './compute.js';

const normN = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function renderScorecard(container, report) {
  const indian = report.peers.indian || [];
  const metrics = report.metrics;
  const winners = winnersAcross([indian], metrics.filter((m) => !m.trendOnly));

  const ai = new Map();
  for (const r of (report.scorecard && report.scorecard.ranking) || []) ai.set(normN(r.company), r);
  const comp = new Map(compositeScores(indian, metrics).map((s) => [normN(s.name), s.score]));
  const byName = new Map(indian.map((p) => [normN(p.name), p])); // resolve a winner back to its peer (for the Screener link)

  const ranked = indian.map((p) => {
    const a = ai.get(normN(p.name));
    const score = (a && Number.isFinite(a.score)) ? a.score : (comp.get(normN(p.name)) ?? 0);
    return { p, a, score };
  }).sort((x, y) => (y.score || 0) - (x.score || 0));
  const maxScore = Math.max(100, ...ranked.map((r) => r.score || 0));

  container.innerHTML = `
    <div class="grid gap-5 lg:grid-cols-2 items-start">
      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">🏅 Winner per metric</h3>
        <p class="text-xs text-slate-400 mb-3">Best Indian listed peer for each metric, honouring its “better” direction. Updates live as you add or remove peers.</p>
        <div class="pv-scroll">
          <table class="pv-table" style="min-width:auto;width:100%">
            <thead><tr><th class="pv-col1" style="min-width:11rem">Metric</th><th style="text-align:left">Winner</th><th>Value</th></tr></thead>
            <tbody>${winners.map((w) => winnerRow(w, byName)).join('')}</tbody>
          </table>
        </div>
      </section>

      <section class="pv-card p-5">
        <h3 class="font-display text-lg font-extrabold text-slate-800 mb-1">📊 Composite ranking</h3>
        <p class="text-xs text-slate-400 mb-3">Re-ranks the moment you add or remove a peer. Uses the AI research score where a company was scored; peers you add are scored live from their metrics. Click a row for details.</p>
        <div class="overflow-x-auto rounded-xl">
          <table class="pv-rank w-full">
            <thead><tr><th class="pv-rank-hash">#</th><th style="text-align:left">Company</th><th>Score</th><th aria-hidden="true"></th></tr></thead>
            <tbody>${ranked.length ? ranked.map((r, i) => rankRow(r, i + 1, maxScore, indian, metrics)).join('') : `<tr><td colspan="4" class="text-center text-slate-400 py-8 text-sm">No ranked peers in this set.</td></tr>`}</tbody>
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

function winnerRow({ metric, winner }, byName) {
  if (metric.better === 'neutral' || !winner) {
    return `<tr><td class="pv-col1 text-slate-500">${esc(metric.label)}${helpIcon(metric.key, metric.label)}</td><td class="text-slate-300" style="text-align:left">— no winner —</td><td class="num text-slate-300">—</td></tr>`;
  }
  const peer = (byName && byName.get(normN(winner.name))) || { name: winner.name };
  return `<tr>
    <td class="pv-col1 text-slate-600">${esc(metric.label)}${helpIcon(metric.key, metric.label)}</td>
    <td style="text-align:left">${companyNameHtml(peer, 'font-semibold text-slate-800')}</td>
    <td class="num font-semibold text-emerald-600">${esc(fmtUnit(winner.value, metric))}</td>
  </tr>`;
}

// Metrics where this peer sits in roughly the top quartile vs the current set,
// as display strings — the data-derived strengths for peers with no AI strengths.
function strengthsFor(p, peers, metrics) {
  const cur = p.current || {};
  const arr = [];
  for (const m of metrics) {
    if (m.better === 'neutral') continue;
    const pos = rankPosition(cur[m.key], currentValues(peers, m.key), m.better);
    if (pos != null && pos >= 0.7) arr.push({ m, pos });
  }
  arr.sort((a, b) => b.pos - a.pos);
  return arr.slice(0, 5).map(({ m }) => `${m.label} (${fmtUnit(cur[m.key], m)} vs ${fmtUnit(median(currentValues(peers, m.key)), m)} median)`);
}

function rankRow({ p, a, score }, displayRank, maxScore, peers, metrics) {
  const top = displayRank === 1;
  const pct = Math.round(((score || 0) / maxScore) * 100);
  const strengthList = (a && a.strengths && a.strengths.length) ? a.strengths : strengthsFor(p, peers, metrics);
  const strengths = strengthList.map((s) => `<span class="pv-chip bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[0.68rem]">${esc(s)}</span>`).join(' ');
  const reason = (a && a.reason) ? a.reason
    : (strengthList.length ? `Ranks top-quartile on ${strengthList.length} metric${strengthList.length > 1 ? 's' : ''} vs the current peer set.` : 'Trails the current peer set on most metrics.');
  const added = p.added_by === 'user' ? ' <span class="pv-added" title="Added by you">+you</span>' : '';
  return `<tr class="pv-rank-row" data-rank-row>
      <td class="pv-rank-hash"><span class="pv-rank-badge ${top ? 'is-top' : ''}">${top ? '👑' : displayRank}</span></td>
      <td>${companyNameHtml(p, 'font-semibold text-slate-800')}${added}</td>
      <td class="pv-rank-score"><span class="pv-rank-bar hidden sm:inline-block"><span style="width:${pct}%"></span></span><span class="num font-display font-extrabold ${top ? 'brand-text' : 'text-slate-700'}">${esc(String(score ?? '—'))}</span></td>
      <td class="pv-rank-chevcell"><svg class="pv-rank-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></td>
    </tr>
    <tr data-rank-detail hidden><td colspan="4" class="pv-rank-detail">
      ${strengths ? `<div class="flex flex-wrap gap-1.5 mb-2">${strengths}</div>` : ''}
      <p class="text-sm text-slate-600 leading-relaxed">${esc(reason)}</p>
    </td></tr>`;
}
