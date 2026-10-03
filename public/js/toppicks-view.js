// toppicks-view.js — renders report.top_picks: a ranked best-ideas shortlist for the
// industry, each pick with a number-cited thesis, key metrics, a risk and an evidence
// grade. Data is synthesised server-side (lib/toppicks.mjs) from all the report's data
// plus a per-company web search, so this view just lays it out.
import { esc, companyNameHtml } from './format.js';

const evClass = (e) => e === 'A' ? 'bg-emerald-50 text-emerald-700'
  : e === 'B' ? 'bg-indigo-50 text-indigo-700'
  : 'bg-slate-100 text-slate-500';
const evLabel = (e) => e === 'A' ? 'A · numbers + web' : e === 'B' ? 'B · numbers' : 'C · qualitative';

export function renderTopPicks(pane, report) {
  const tp = report.top_picks;
  if (!tp || !Array.isArray(tp.picks) || !tp.picks.length) {
    pane.innerHTML = `<div class="text-center text-slate-400 py-16 text-sm">
      No Top Picks generated for this report yet.<br>
      Hit <span class="font-semibold text-slate-500">Refresh</span> (top-right) to re-research it — the ranked shortlist is built during research.
    </div>`;
    return;
  }

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

  pane.innerHTML = `
    <div class="mb-3">
      <h3 class="font-display text-lg font-extrabold text-slate-800">★ Top Picks</h3>
      <p class="text-xs text-slate-400 mt-0.5">${tp.picks.length} best ideas in this industry, ranked by business quality. Each thesis cites the underlying numbers; the score (0-100) is quality vs the researched set; evidence A/B/C flags how well-backed it is. A data-driven shortlist with risks shown — not investment advice.</p>
    </div>
    <div class="grid gap-3 lg:grid-cols-2">${tp.picks.map(card).join('')}</div>`;
}
