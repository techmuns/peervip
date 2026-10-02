// app.js — entry point + hash router. Screens: Home (search + report cards),
// Loading (LIVE staged progress driven by the pipeline via polling, with an
// error state, elapsed timer, easing bar, localStorage resume, Cancel), and
// Dashboard.
//
// Live wiring (Step 2): on Run, a STRONG index match opens the cached report;
// anything weaker POSTs /api/research and drives the loading screen from
// /api/research-status polling (window.PeerVIP.autoAdvance=false). On done it
// loads /api/report and navigates to #/r/<slug>; on failed it calls
// window.PeerVIP.fail(). Offline / no-Functions degrades gracefully.
import { loadIndex, loadReport, matchReport } from './data.js';
import { dispatchResearch, fetchStatus } from './research.js';
import { renderDashboard } from './dashboard.js';
import { setupCharts } from './charts.js';
import { esc, fmtDate } from './format.js';

const app = () => document.getElementById('app');
const RUN_KEY = 'peervip:run';
const POLL_MS = 2500;
const MAX_POLL_MS = 20 * 60 * 1000; // never spin forever — a slow run (Bedrock throttling) can take 12+ min (#4)

const STAGES = [
  'Understanding the business',
  'Finding true peers (Indian · Global · Private)',
  'Fetching financials from Screener',
  'Fetching global peers',
  'Computing medians & averages',
  'Scoring the outperformer',
  'Building your report',
];

// Public API — the live pipeline drives these while the loading route is mounted.
window.PeerVIP = { autoAdvance: true, setStage: () => {}, finish: () => {}, fail: () => {}, STAGES };

let indexData = null;
let loadingCtrl = null;

document.addEventListener('DOMContentLoaded', () => { setupCharts(); route(); });
window.addEventListener('hashchange', route);

function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function stopLoading() { if (loadingCtrl) { loadingCtrl.destroy(); loadingCtrl = null; } }

async function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  if (path !== '/loading') stopLoading();

  if (path === '/' || path === '') return renderHome();
  if (path === '/loading') return renderLoading(decodeURIComponent(params.get('q') || ''));
  if (path.startsWith('/r/')) return renderDashboardRoute(decodeURIComponent(path.slice(3)));
  return renderHome();
}

/**
 * Run decision (G6): a STRONG index match (score >= 70) opens the cached
 * dashboard; anything weaker dispatches a fresh research run via the loading
 * screen. The closest weak match (if any) is stashed so the loading screen can
 * offer it as a shortcut.
 */
// Refresh / re-research: always dispatch a fresh run (bypass the strong-match
// cache) and show the live loading screen again (#6).
function refreshResearch(query) {
  if (!query) return;
  writeRun({ q: query, slug: null, name: query, weak: null, startedAt: Date.now(), stageIndex: 0, finished: false, dispatched: false });
  go('#/loading?q=' + encodeURIComponent(query));
}

async function runQuery(query) {
  if (!query) return;
  let index = null;
  try { index = indexData = indexData || await loadIndex(); } catch (_) { /* offline */ }
  const { entry, score } = matchReport(query, index || {});
  if (entry && score >= 70) { go('#/r/' + encodeURIComponent(entry.slug)); return; }
  const weak = entry ? { slug: entry.slug, name: entry.name } : null;
  writeRun({ q: query, slug: null, name: query, weak, startedAt: Date.now(), stageIndex: 0, finished: false, dispatched: false });
  go('#/loading?q=' + encodeURIComponent(query));
}

// ============================================================ HOME
const I_SEARCH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>';
const I_CHART = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l3-4 3 2 4-6"/></svg>';
const I_ARROW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

async function renderHome() {
  const el = app();
  el.innerHTML = `
    <div class="min-h-screen">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-16">
        <div class="flex items-center justify-center gap-2.5 mb-8">
          <div class="w-10 h-10 rounded-2xl brand-gradient flex items-center justify-center text-white font-display font-extrabold text-lg shadow-sm">P</div>
          <span class="font-display text-2xl font-extrabold tracking-tight"><span class="text-slate-900">Peer</span><span class="brand-text">VIP</span></span>
        </div>

        <div class="text-center max-w-2xl mx-auto">
          <h1 class="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.1]">
            Find a company's <span class="brand-text">true peers</span>.<br class="hidden sm:block"> Benchmark everything.
          </h1>
          <p class="text-slate-500 mt-4 text-base sm:text-lg">Search any company or industry. PeerVIP splits the field into Indian, Global &amp; Private and benchmarks every metric — then crowns the outperformer, with the reason.</p>
        </div>

        <form data-search class="mt-8 max-w-2xl mx-auto flex flex-col sm:flex-row gap-3">
          <div class="pv-ac-wrap">
            <div class="pv-searchbar">
              <span class="text-slate-400 shrink-0">${I_SEARCH}</span>
              <input name="q" type="text" autocomplete="off" aria-label="Search a company or industry"
                placeholder="Type a company or industry — solar energy, data center, Waaree…" />
            </div>
          </div>
          <button type="submit" class="pv-focus shrink-0 inline-flex items-center justify-center gap-2 rounded-xl brand-gradient px-5 py-3 font-semibold text-white shadow-sm hover:opacity-95 transition">
            Research it ${I_ARROW}
          </button>
        </form>
        <p class="text-center text-xs text-slate-400 mt-3">Try “solar energy”, “data center”, or any stock — or pick a past run from the suggestions to open it instantly.</p>

        <div class="mt-12">
          <div class="flex items-center justify-between mb-2 px-1">
            <h2 class="font-display text-sm font-bold uppercase tracking-wide text-slate-400">Your research</h2>
            <span data-runs-count class="text-xs text-slate-400"></span>
          </div>
          <div class="pv-card overflow-x-auto">
            <table class="pv-runs" data-runs><tbody><tr><td class="p-6 text-sm text-slate-400">Loading your research…</td></tr></tbody></table>
          </div>
        </div>
      </div>
    </div>`;

  const form = el.querySelector('[data-search]');
  const input = form.querySelector('input[name=q]');
  const acWrap = form.querySelector('.pv-ac-wrap');
  form.addEventListener('submit', (e) => { e.preventDefault(); runQuery(input.value.trim()); });

  const tableEl = el.querySelector('[data-runs]');
  const countEl = el.querySelector('[data-runs-count]');
  try {
    indexData = indexData || await loadIndex();
    const runs = (indexData.reports || [])
      .filter((r) => !r.sample)
      .slice()
      .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    tableEl.innerHTML = runsTableHtml(runs);
    countEl.textContent = runs.length ? `${runs.length} run${runs.length > 1 ? 's' : ''}` : '';
    tableEl.querySelectorAll('[data-slug]').forEach((tr) => tr.addEventListener('click', () => go('#/r/' + encodeURIComponent(tr.dataset.slug))));
  } catch (e) {
    tableEl.innerHTML = `<tbody><tr><td class="p-6 text-sm text-rose-500">Could not load your research (${esc(e.message)}).</td></tr></tbody>`;
  }

  attachAutocomplete(input, acWrap, () => indexData,
    (r) => go('#/r/' + encodeURIComponent(r.slug)),
    (q) => runQuery(q));
  input.focus();
}

function runsTableHtml(runs) {
  if (!runs.length) {
    return `<tbody><tr><td class="p-6 text-sm text-slate-400">No research yet — search above to run your first peer benchmarking.</td></tr></tbody>`;
  }
  const rows = runs.map((r) => {
    const anchor = r.seed_company && r.seed_company !== r.name ? `anchor: ${esc(r.seed_company)} · ` : '';
    const ta = timeAgo(r.updated_at);
    return `<tr data-slug="${esc(r.slug)}">
      <td>
        <div class="pv-runs-name">${esc(r.name)}</div>
        <div class="pv-runs-sub">${anchor}${esc(r.query || r.slug)}</div>
      </td>
      <td class="pv-runs-num">${esc(String(r.peer_count || 0))}</td>
      <td><span class="text-slate-600">${esc(fmtDate(r.updated_at))}</span>${ta ? ` <span class="pv-runs-sub">· ${esc(ta)}</span>` : ''}</td>
      <td style="text-align:right">
        <span class="pv-focus inline-flex items-center gap-1.5 rounded-lg brand-gradient px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-95 transition whitespace-nowrap">View <span class="hidden sm:inline">full dashboard</span>${I_ARROW}</span>
      </td>
    </tr>`;
  }).join('');
  return `<thead><tr>
      <th>Report</th>
      <th class="pv-runs-num">Peers</th>
      <th>Last updated</th>
      <th></th>
    </tr></thead><tbody>${rows}</tbody>`;
}

function timeAgo(iso) {
  const then = new Date(iso || 0).getTime();
  if (!isFinite(then) || !then) return '';
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return Math.floor(m) + 'm ago';
  const h = m / 60; if (h < 24) return Math.floor(h) + 'h ago';
  const d = h / 24; if (d < 30) return Math.floor(d) + 'd ago';
  const mo = d / 30; if (mo < 12) return Math.floor(mo) + 'mo ago';
  return Math.floor(d / 365) + 'y ago';
}

// Top matches from the committed catalogue (the user's own past runs).
function suggestReports(query, index, limit = 6) {
  const q = String(query || '').toLowerCase().trim();
  if (!q || !index || !Array.isArray(index.reports)) return [];
  const scored = [];
  for (const r of index.reports) {
    if (r.sample) continue;
    const hay = [r.name, r.slug, r.query, r.seed_company, ...(r.aliases || [])].filter(Boolean).map((s) => String(s).toLowerCase());
    let score = 0;
    for (const h of hay) {
      if (h === q) score = Math.max(score, 100);
      else if (h.startsWith(q) || q.startsWith(h)) score = Math.max(score, 70);
      else if (h.includes(q)) score = Math.max(score, 45);
      else if (q.length > 2 && h.split(/\s+/).some((t) => t.length > 2 && q.includes(t))) score = Math.max(score, 25);
    }
    if (score >= 25) scored.push({ r, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.r);
}

// Autocomplete dropdown: past runs first, then a "Research <q>" fresh-run row.
function attachAutocomplete(input, wrap, getIndex, onPick, onRun) {
  let items = [];
  let active = -1;
  let dd = null;
  let timer = null;
  const isOpen = () => !!dd;
  function close() { if (dd) { dd.remove(); dd = null; } active = -1; }
  function render() {
    const q = input.value.trim();
    if (dd) dd.remove();
    dd = document.createElement('div');
    dd.className = 'pv-ac-dropdown';
    const itemsHtml = items.map((r, i) => `
      <div class="pv-ac-item ${i === active ? 'is-active' : ''}" data-i="${i}">
        <span class="pv-ac-ico">${I_CHART}</span>
        <span class="pv-ac-body">
          <span class="pv-ac-name">${esc(r.name)}</span>
          <span class="pv-ac-meta">${esc(String(r.peer_count || 0))} peers · updated ${esc(timeAgo(r.updated_at) || fmtDate(r.updated_at))}</span>
        </span>
        <span class="pv-ac-open">Open</span>
      </div>`).join('');
    const runHtml = q ? `
      <div class="pv-ac-item pv-ac-run ${active === items.length ? 'is-active' : ''}" data-run="1">
        <span class="pv-ac-ico">${I_SEARCH}</span>
        <span class="pv-ac-body">
          <span class="pv-ac-name">Research “${esc(q)}”</span>
          <span class="pv-ac-meta">Run a fresh peer benchmarking</span>
        </span>
      </div>` : '';
    dd.innerHTML = itemsHtml + runHtml;
    dd.querySelectorAll('[data-i]').forEach((node) => node.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(items[+node.dataset.i]); close(); }));
    const runNode = dd.querySelector('[data-run]');
    if (runNode) runNode.addEventListener('mousedown', (e) => { e.preventDefault(); onRun(input.value.trim()); close(); });
    wrap.appendChild(dd);
  }
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (timer) clearTimeout(timer);
    if (q.length < 2) { items = []; close(); return; }
    timer = setTimeout(() => { items = suggestReports(q, getIndex(), 6); active = -1; render(); }, 160);
  });
  input.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    const total = items.length + (input.value.trim() ? 1 : 0);
    if (e.key === 'ArrowDown') { e.preventDefault(); active = total ? (active + 1) % total : -1; render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = total ? (active - 1 + total) % total : -1; render(); }
    else if (e.key === 'Enter') {
      if (active >= 0) { e.preventDefault(); if (active < items.length) onPick(items[active]); else onRun(input.value.trim()); close(); }
    } else if (e.key === 'Escape') { close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  return { close };
}

function cardHtml(r) {
  const typeChip = r.type === 'company' ? 'bg-indigo-50 text-indigo-600' : 'bg-purple-50 text-purple-600';
  return `<button data-slug="${esc(r.slug)}" class="pv-focus text-left pv-card p-5 hover:-translate-y-0.5 hover:shadow-md transition group">
    <div class="flex items-start justify-between gap-2">
      <span class="pv-chip ${typeChip} px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide">${esc(r.type || 'report')}</span>
      ${r.sample ? '<span class="pv-chip bg-amber-50 text-amber-600 px-2 py-0.5 text-[0.6rem] font-bold uppercase">sample</span>' : '<span class="pv-chip bg-emerald-50 text-emerald-600 px-2 py-0.5 text-[0.6rem] font-bold uppercase">live</span>'}
    </div>
    <h3 class="font-display text-lg font-extrabold text-slate-900 mt-3 leading-tight group-hover:text-indigo-600 transition">${esc(r.name)}</h3>
    ${r.seed_company ? `<p class="text-xs text-slate-400 mt-0.5">anchor: ${esc(r.seed_company)}</p>` : ''}
    <div class="flex items-center justify-between mt-4 text-xs text-slate-400">
      <span>${esc(String(r.peer_count || 0))} peers · ${esc(fmtDate(r.updated_at))}</span>
      <span class="text-indigo-500 font-semibold inline-flex items-center gap-1">Open <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
    </div>
  </button>`;
}

// ============================================================ LOADING (live)
async function renderLoading(query) {
  stopLoading();
  const el = app();
  if (!query) { go('#/'); return; }

  // closest weak match (for the "open closest match" shortcut) + display name
  let saved = readRun();
  if (!saved || saved.q !== query) saved = { q: query, slug: null, name: query, weak: null, startedAt: Date.now(), stageIndex: 0, finished: false, dispatched: false };
  if (!saved.weak) {
    try { indexData = indexData || await loadIndex(); const m = matchReport(query, indexData); if (m.entry) saved.weak = { slug: m.entry.slug, name: m.entry.name }; } catch (_) { /* offline */ }
  }
  writeRun(saved);
  const displayName = saved.weak ? saved.weak.name : query;

  el.innerHTML = `
    <div class="min-h-screen flex items-center justify-center px-4 py-10">
      <div class="w-full max-w-2xl pv-card p-6 sm:p-8 pv-fade-in">
        <div class="flex items-center gap-4">
          <div class="pv-spinner shrink-0" data-spinner></div>
          <div class="min-w-0">
            <h1 class="font-display text-xl sm:text-2xl font-extrabold text-slate-900 truncate">Researching <span class="brand-text">${esc(displayName)}</span></h1>
            <p class="text-sm text-slate-400">Building the peer set and benchmarking every metric…</p>
          </div>
          <div class="ml-auto text-right shrink-0">
            <div class="num font-display text-2xl font-extrabold text-slate-800" data-pct>0%</div>
            <div class="text-xs text-slate-400"><span class="num" data-elapsed>0.0s</span> elapsed</div>
          </div>
        </div>

        <div class="pv-progress-track h-2.5 mt-5"><div class="pv-progress-bar" data-bar style="width:0%"></div></div>

        <ol class="mt-6 space-y-2.5" data-steps>${STAGES.map((s, i) => stepHtml(s, i)).join('')}</ol>

        <div data-weak class="mt-3 text-center text-xs" hidden></div>
        <div data-result class="mt-6" hidden></div>

        <div class="mt-6 text-center">
          <a data-cancel href="#/" class="text-sm text-slate-400 hover:text-slate-600 transition">Cancel</a>
        </div>
      </div>
    </div>`;

  el.querySelector('[data-cancel]').addEventListener('click', (e) => { e.preventDefault(); stopLoading(); clearRun(); go('#/'); });

  loadingCtrl = createLoadingController(el, { query, saved });
}

function stepHtml(label, i) {
  return `<li class="pv-step flex items-center gap-3 text-slate-400" data-step="${i}">
    <span class="pv-step-dot shrink-0 w-6 h-6 rounded-full border-2 border-slate-200 bg-white flex items-center justify-center text-[0.7rem] font-bold text-slate-300">${i + 1}</span>
    <span class="text-sm font-medium">${esc(label)}</span>
    <span class="ml-auto pv-step-check text-emerald-500" hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
    </span>
    <span class="ml-auto pv-step-spin" hidden><span class="inline-block w-3.5 h-3.5 rounded-full border-2 border-indigo-200 border-t-indigo-500" style="animation:pv-spin .8s linear infinite"></span></span>
  </li>`;
}

function createLoadingController(el, { query, saved }) {
  const bar = el.querySelector('[data-bar]');
  const pct = el.querySelector('[data-pct]');
  const elapsedEl = el.querySelector('[data-elapsed]');
  const steps = [...el.querySelectorAll('[data-step]')];
  const resultEl = el.querySelector('[data-result]');
  const weakEl = el.querySelector('[data-weak]');
  const spinner = el.querySelector('[data-spinner]');

  let progress = 0;
  let stageIndex = saved.stageIndex || 0;
  let finished = false;
  let done = false;
  let slug = saved.slug || null;
  const weak = saved.weak || null;
  const startedAt = saved.startedAt || Date.now();
  let raf = null, tick = null, poll = null;

  window.PeerVIP.autoAdvance = false;
  window.PeerVIP.setStage = setStage;
  window.PeerVIP.finish = () => finishLive(slug);
  window.PeerVIP.fail = failCard;

  function paintSteps() {
    steps.forEach((li, i) => {
      const isDone = done || i < stageIndex;
      const activeNow = !done && i === stageIndex;
      li.classList.toggle('is-active', activeNow);
      li.classList.toggle('text-slate-700', activeNow || isDone);
      const dot = li.querySelector('.pv-step-dot');
      li.querySelector('.pv-step-check').hidden = !isDone;
      li.querySelector('.pv-step-spin').hidden = !activeNow;
      dot.hidden = isDone || activeNow;
      if (activeNow) { dot.style.borderColor = '#a855f7'; dot.style.color = '#a855f7'; }
    });
  }
  function setStage(i) { stageIndex = Math.max(0, Math.min(STAGES.length - 1, i | 0)); persist(); paintSteps(); }
  function persist() { writeRun({ q: query, slug, name: saved.name, weak, startedAt, stageIndex, finished, dispatched: !!slug }); }

  function loop() {
    const target = done ? 100 : 90;
    progress += (target - progress) * 0.045;
    if (progress > 99 && !done) progress = 99;
    bar.style.width = progress.toFixed(1) + '%';
    pct.textContent = Math.round(progress) + '%';
    raf = requestAnimationFrame(loop);
  }

  function stopTimers() { if (raf) cancelAnimationFrame(raf); if (tick) clearInterval(tick); if (poll) clearTimeout(poll); raf = tick = poll = null; }

  function showWeakLink() {
    if (!weak || done || finished) { weakEl.hidden = true; return; }
    weakEl.hidden = false;
    weakEl.innerHTML = `<a href="#/r/${encodeURIComponent(weak.slug)}" class="text-slate-400 hover:text-indigo-600 transition">Open closest cached match: <span class="font-semibold">${esc(weak.name)}</span> →</a>`;
  }

  // ---- polling (with a hard cap so it never spins forever) ----
  async function onTimeout(s) {
    stopTimers();
    // the run may have finished while we waited — try the report before failing
    try { await loadReport(s, { fresh: true }); location.hash = '#/r/' + encodeURIComponent(s); }
    catch (_) { failCard('Still working — this run is taking longer than usual (a busy AI backend can stretch it past ' + Math.round(MAX_POLL_MS / 60000) + ' minutes). It keeps running in the background and will appear on your home page when it finishes — reopen it from there, or hit Try again.'); }
  }
  function startPolling(s) {
    slug = s; persist();
    const step = async () => {
      if (Date.now() - startedAt > MAX_POLL_MS) { await onTimeout(s); return; }
      try {
        const st = await fetchStatus(s);
        if (st && (st.state === 'done')) { finishLive(s); return; }
        if (st && st.state === 'failed') { failCard(st.error || 'Research failed.'); return; }
        if (st && Number.isFinite(+st.stage)) setStage(+st.stage);
      } catch (_) { /* transient — keep polling */ }
      poll = setTimeout(step, POLL_MS);
    };
    step();
  }

  async function finishLive(s) {
    if (finished) return;
    finished = true; done = true; slug = s; stageIndex = STAGES.length; persist();
    stopTimers();
    progress = 100; bar.style.width = '100%'; pct.textContent = '100%'; paintSteps();
    spinner.style.animationPlayState = 'paused'; spinner.style.borderTopColor = '#10b981';
    weakEl.hidden = true;
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex flex-col sm:flex-row items-center gap-3 justify-between">
        <p class="text-sm text-emerald-800 font-medium">✅ Report ready — opening…</p>
        <a data-view href="#/r/${encodeURIComponent(s)}" class="pv-focus inline-flex items-center gap-2 rounded-xl brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition">
          View Full Dashboard
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </a>
      </div>`;
    resultEl.querySelector('[data-view]').addEventListener('click', (e) => { e.preventDefault(); location.hash = '#/r/' + encodeURIComponent(s); });
    // G2: navigate to the freshly-researched slug directly (not a captured match).
    try { await loadReport(s, { fresh: true }); location.hash = '#/r/' + encodeURIComponent(s); }
    catch (e) { failCard('The report was generated but could not be loaded: ' + e.message); }
  }

  function failCard(message) {
    if (done) return;
    done = true; finished = false; stopTimers();
    spinner.style.animationPlayState = 'paused'; spinner.style.borderTopColor = '#ef4444';
    steps.forEach((li) => { li.querySelector('.pv-step-spin').hidden = true; });
    weakEl.hidden = true;
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <div class="rounded-xl border border-rose-200 bg-rose-50 p-4">
        <p class="text-sm text-rose-800 font-semibold mb-1">⚠️ Research didn't finish</p>
        <p class="text-sm text-rose-700/90">${esc(message || 'Something went wrong.')}</p>
        <div class="flex flex-wrap gap-2 mt-3">
          <button data-retry class="pv-focus inline-flex items-center gap-2 rounded-xl brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition">Try again</button>
          <a href="#/" class="pv-focus inline-flex items-center gap-2 rounded-xl bg-white ring-1 ring-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">← Back to search</a>
          ${weak ? `<a href="#/r/${encodeURIComponent(weak.slug)}" class="pv-focus inline-flex items-center gap-2 rounded-xl bg-white ring-1 ring-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">Open closest match</a>` : ''}
        </div>
      </div>`;
    resultEl.querySelector('[data-retry]').addEventListener('click', () => {
      writeRun({ q: query, slug: null, name: query, weak, startedAt: Date.now(), stageIndex: 0, finished: false, dispatched: false });
      go('#/loading?q=' + encodeURIComponent(query));
    });
  }

  function showUnavailable(message) {
    done = true; stopTimers();
    spinner.style.animationPlayState = 'paused'; spinner.style.borderTopColor = '#f59e0b';
    steps.forEach((li) => { li.querySelector('.pv-step-spin').hidden = true; });
    weakEl.hidden = true;
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
        <p class="text-sm text-amber-800">${esc(message)}</p>
        <div class="flex flex-wrap gap-2 justify-center mt-3">
          ${weak ? `<a href="#/r/${encodeURIComponent(weak.slug)}" class="pv-focus inline-flex items-center gap-2 rounded-xl brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition">Open closest match: ${esc(weak.name)}</a>` : ''}
          <a href="#/" class="pv-focus inline-flex items-center gap-2 rounded-xl bg-white ring-1 ring-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">← Back to search</a>
        </div>
      </div>`;
  }

  // ---- start ----
  async function start() {
    tick = setInterval(() => { elapsedEl.textContent = ((Date.now() - startedAt) / 1000).toFixed(1) + 's'; }, 100);
    loop();
    paintSteps();
    showWeakLink();

    if (slug) { startPolling(slug); return; } // resume an in-flight run

    try {
      const r = await dispatchResearch(query);
      if (r && r.slug && r.dispatched) { startPolling(r.slug); return; }
      // Function reachable but not configured to dispatch.
      showUnavailable((r && r.manual) || 'Live research isn\'t configured on this deployment yet.');
    } catch (_) {
      // No Functions / offline (e.g. plain static hosting) — degrade gracefully.
      showUnavailable(weak
        ? 'Live research isn\'t available here. You can open the closest cached report instead.'
        : 'Live research isn\'t available on this deployment. Try one of the seeded reports on the home page.');
    }
  }

  start();
  return { destroy: stopTimers };
}

// ============================================================ DASHBOARD
async function renderDashboardRoute(slug) {
  const el = app();
  el.innerHTML = `<div class="min-h-screen flex items-center justify-center"><div class="text-center"><div class="pv-spinner mx-auto mb-4"></div><p class="text-slate-400 text-sm">Loading dashboard…</p></div></div>`;
  try {
    const report = await loadReport(slug);
    clearRun();
    renderDashboard(el, report, { onBack: () => go('#/'), onRefresh: (q) => refreshResearch(q || (report.meta && report.meta.query) || slug) });
    window.scrollTo(0, 0);
  } catch (e) {
    el.innerHTML = `<div class="min-h-screen flex items-center justify-center px-4">
      <div class="pv-card p-8 text-center max-w-md">
        <div class="text-4xl mb-3">🗂️</div>
        <h1 class="font-display text-xl font-extrabold text-slate-800">Report not found</h1>
        <p class="text-slate-500 text-sm mt-2">Couldn't load <span class="font-mono">${esc(slug)}</span> (${esc(e.message)}).</p>
        <a href="#/" class="pv-focus inline-flex mt-4 items-center gap-2 rounded-xl brand-gradient px-4 py-2 text-sm font-semibold text-white">← Back to search</a>
      </div>
    </div>`;
  }
}

// ============================================================ run persistence
function readRun() { try { return JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); } catch (_) { return null; } }
function writeRun(v) { try { localStorage.setItem(RUN_KEY, JSON.stringify(v)); } catch (_) { /* ignore */ } }
function clearRun() { try { localStorage.removeItem(RUN_KEY); } catch (_) { /* ignore */ } }
