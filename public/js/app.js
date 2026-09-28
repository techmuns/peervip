// app.js — entry point + hash router. Screens: Home (search + report cards),
// Loading (staged progress with a setStage() API, elapsed timer, easing bar,
// localStorage resume, Cancel), and Dashboard.
//
// Step 2 hook: the loading pipeline stages are REAL. A live backend can drive
// them by setting `window.PeerVIP.autoAdvance = false` and calling
// `window.PeerVIP.setStage(i)` / `window.PeerVIP.finish()`.
import { loadIndex, loadReport, matchReport } from './data.js';
import { renderDashboard } from './dashboard.js';
import { setupCharts } from './charts.js';
import { esc, fmtDate } from './format.js';

const app = () => document.getElementById('app');
const RUN_KEY = 'peervip:run';

const STAGES = [
  'Understanding the business',
  'Finding true peers (Indian · Global · Private)',
  'Fetching financials from Screener',
  'Fetching global peers',
  'Computing medians & averages',
  'Scoring the outperformer',
  'Building your report',
];

// Public API for Step 2's live pipeline.
window.PeerVIP = { autoAdvance: true, setStage: () => {}, finish: () => {}, STAGES };

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

// ============================================================ HOME
async function renderHome() {
  const el = app();
  el.innerHTML = `
    <div class="min-h-screen">
      <div class="max-w-5xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-16">
        <div class="flex items-center justify-center gap-2.5 mb-8">
          <div class="w-10 h-10 rounded-2xl brand-gradient flex items-center justify-center text-white font-display font-extrabold text-lg shadow-sm">P</div>
          <span class="font-display text-2xl font-extrabold tracking-tight"><span class="text-slate-900">Peer</span><span class="brand-text">VIP</span></span>
        </div>

        <div class="text-center max-w-2xl mx-auto">
          <div class="inline-flex items-center gap-2 rounded-full bg-white ring-1 ring-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 mb-5 pv-fade-in">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> Sample data — live research connects in Step 2
          </div>
          <h1 class="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.1]">
            Find a company's <span class="brand-text">true peers</span>.<br class="hidden sm:block"> Benchmark everything.
          </h1>
          <p class="text-slate-500 mt-4 text-base sm:text-lg">Search any company or industry. PeerVIP splits the field into Indian, Global &amp; Private, benchmarks every metric, and crowns the outperformer — with the reason.</p>
        </div>

        <form data-search class="mt-8 max-w-2xl mx-auto">
          <div class="flex flex-col sm:flex-row gap-3 bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-2">
            <div class="flex items-center gap-2 grow px-3">
              <svg class="text-slate-400 shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
              <input name="q" type="text" autocomplete="off" class="w-full py-2.5 bg-transparent outline-none text-slate-800 placeholder:text-slate-400"
                placeholder="Search any company or industry — Stylam, laminates, Monolithisch..." />
            </div>
            <button type="submit" class="pv-focus shrink-0 inline-flex items-center justify-center gap-2 rounded-xl brand-gradient px-5 py-2.5 font-semibold text-white shadow-sm hover:opacity-95 transition">
              Run Peer Benchmarking
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </button>
          </div>
          <div class="flex flex-wrap gap-2 justify-center mt-3 text-xs text-slate-400">
            <span>Try:</span>
            ${['Stylam', 'laminates', 'Monolithisch', 'refractories'].map((s) => `<button type="button" data-example="${esc(s)}" class="pv-focus rounded-full bg-white ring-1 ring-slate-200 px-2.5 py-1 font-medium text-slate-600 hover:ring-indigo-300 hover:text-indigo-600 transition">${esc(s)}</button>`).join('')}
          </div>
        </form>

        <div class="mt-12">
          <h2 class="font-display text-sm font-bold uppercase tracking-wide text-slate-400 mb-3">Available reports</h2>
          <div data-cards class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div class="text-slate-400 text-sm">Loading reports…</div>
          </div>
        </div>
      </div>
    </div>`;

  // wire search
  const form = el.querySelector('[data-search]');
  form.addEventListener('submit', (e) => { e.preventDefault(); const q = form.q.value.trim(); if (q) go('#/loading?q=' + encodeURIComponent(q)); });
  el.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => { form.q.value = b.dataset.example; form.q.focus(); }));

  // report cards
  const cards = el.querySelector('[data-cards]');
  try {
    indexData = indexData || await loadIndex();
    const reports = indexData.reports || [];
    cards.innerHTML = reports.length ? reports.map(cardHtml).join('') : `<div class="text-slate-400 text-sm">No reports yet.</div>`;
    cards.querySelectorAll('[data-slug]').forEach((c) => c.addEventListener('click', () => go('#/r/' + encodeURIComponent(c.dataset.slug))));
  } catch (e) {
    cards.innerHTML = `<div class="text-rose-500 text-sm">Could not load reports (${esc(e.message)}).</div>`;
  }
}

function cardHtml(r) {
  const typeChip = r.type === 'company' ? 'bg-indigo-50 text-indigo-600' : 'bg-purple-50 text-purple-600';
  return `<button data-slug="${esc(r.slug)}" class="pv-focus text-left pv-card p-5 hover:-translate-y-0.5 hover:shadow-md transition group">
    <div class="flex items-start justify-between gap-2">
      <span class="pv-chip ${typeChip} px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide">${esc(r.type || 'report')}</span>
      ${r.sample ? '<span class="pv-chip bg-amber-50 text-amber-600 px-2 py-0.5 text-[0.6rem] font-bold uppercase">sample</span>' : ''}
    </div>
    <h3 class="font-display text-lg font-extrabold text-slate-900 mt-3 leading-tight group-hover:text-indigo-600 transition">${esc(r.name)}</h3>
    ${r.seed_company ? `<p class="text-xs text-slate-400 mt-0.5">anchor: ${esc(r.seed_company)}</p>` : ''}
    <div class="flex items-center justify-between mt-4 text-xs text-slate-400">
      <span>${esc(String(r.peer_count || 0))} peers · ${esc(fmtDate(r.updated_at))}</span>
      <span class="text-indigo-500 font-semibold inline-flex items-center gap-1">Open <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
    </div>
  </button>`;
}

// ============================================================ LOADING
async function renderLoading(query) {
  const el = app();
  if (!query) { go('#/'); return; }

  // resolve match up-front (so we know where "View Full Dashboard" leads)
  let match = null;
  try { indexData = indexData || await loadIndex(); match = matchReport(query, indexData); } catch (_) { /* offline: no match */ }
  const displayName = match ? match.name : query;

  // resume prior in-flight run for the same query, else start fresh
  let saved = readRun();
  if (!saved || saved.q !== query) {
    saved = { q: query, slug: match ? match.slug : null, name: displayName, startedAt: Date.now(), stageIndex: 0, finished: false };
    writeRun(saved);
  }

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

        <ol class="mt-6 space-y-2.5" data-steps>
          ${STAGES.map((s, i) => stepHtml(s, i)).join('')}
        </ol>

        <div data-result class="mt-6" hidden></div>

        <div class="mt-6 text-center">
          <a data-cancel href="#/" class="text-sm text-slate-400 hover:text-slate-600 transition">Cancel</a>
        </div>
      </div>
    </div>`;

  el.querySelector('[data-cancel]').addEventListener('click', (e) => { e.preventDefault(); stopLoading(); clearRun(); go('#/'); });

  loadingCtrl = createLoadingController(el, { query, match, saved });
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

function createLoadingController(el, { query, match, saved }) {
  const bar = el.querySelector('[data-bar]');
  const pct = el.querySelector('[data-pct]');
  const elapsedEl = el.querySelector('[data-elapsed]');
  const steps = [...el.querySelectorAll('[data-step]')];
  const resultEl = el.querySelector('[data-result]');
  const spinner = el.querySelector('[data-spinner]');

  let progress = 0;
  let stageIndex = saved.stageIndex || 0;
  let finished = !!saved.finished;
  const startedAt = saved.startedAt || Date.now();
  let raf = null, advTimer = null, tick = null;

  function paintSteps() {
    steps.forEach((li, i) => {
      const done = finished || i < stageIndex;
      const activeNow = !finished && i === stageIndex;
      li.classList.toggle('is-active', activeNow);
      li.classList.toggle('text-slate-700', activeNow || done);
      const dot = li.querySelector('.pv-step-dot');
      const check = li.querySelector('.pv-step-check');
      const spin = li.querySelector('.pv-step-spin');
      check.hidden = !done;
      spin.hidden = !activeNow;
      dot.hidden = done || activeNow;
      if (activeNow) { dot.style.borderColor = '#a855f7'; dot.style.color = '#a855f7'; }
    });
  }

  function setStage(i) {
    stageIndex = Math.max(0, Math.min(STAGES.length, i));
    persist();
    paintSteps();
  }

  function persist() { writeRun({ q: query, slug: match ? match.slug : null, name: saved.name, startedAt, stageIndex, finished }); }

  function showResult() {
    spinner.style.animationPlayState = 'paused';
    spinner.style.borderTopColor = '#10b981';
    resultEl.hidden = false;
    if (match) {
      resultEl.innerHTML = `
        <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex flex-col sm:flex-row items-center gap-3 justify-between">
          <p class="text-sm text-emerald-800 font-medium">✅ Report ready for <span class="font-bold">${esc(match.name)}</span>.</p>
          <a data-view href="#/r/${encodeURIComponent(match.slug)}" class="pv-focus inline-flex items-center gap-2 rounded-xl brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition">
            View Full Dashboard
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </a>
        </div>`;
    } else {
      resultEl.innerHTML = `
        <div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
          <p class="text-sm text-amber-800">🔎 <span class="font-semibold">Not cached yet.</span> Live research turns on in the next update — for now, try one of the seeded reports.</p>
          <a href="#/" class="pv-focus inline-flex mt-3 items-center gap-2 rounded-xl bg-white ring-1 ring-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">← Back to search</a>
        </div>`;
    }
  }

  function finish() {
    if (finished) { /* already */ }
    finished = true;
    stageIndex = STAGES.length;
    persist();
    progress = 100;
    bar.style.width = '100%';
    pct.textContent = '100%';
    paintSteps();
    stopTimers();
    showResult();
  }

  function stopTimers() { if (raf) cancelAnimationFrame(raf); if (advTimer) clearTimeout(advTimer); if (tick) clearInterval(tick); raf = advTimer = tick = null; }

  // progress easing toward ~90% + elapsed clock
  function loop() {
    const target = finished ? 100 : 90;
    progress += (target - progress) * 0.05;
    if (progress > 99.5) progress = 99.5;
    bar.style.width = progress.toFixed(1) + '%';
    pct.textContent = Math.round(progress) + '%';
    raf = requestAnimationFrame(loop);
  }
  tick = setInterval(() => { elapsedEl.textContent = ((Date.now() - startedAt) / 1000).toFixed(1) + 's'; }, 100);

  // Step-1 auto-advance (Step 2 sets PeerVIP.autoAdvance=false and calls setStage/finish)
  function scheduleAdvance() {
    if (!window.PeerVIP.autoAdvance || finished) return;
    advTimer = setTimeout(() => {
      if (stageIndex < STAGES.length - 1) { setStage(stageIndex + 1); scheduleAdvance(); }
      else { setStage(STAGES.length - 1); finish(); }
    }, 600 + Math.random() * 400);
  }

  // wire the public API to this controller
  window.PeerVIP.setStage = setStage;
  window.PeerVIP.finish = finish;

  paintSteps();
  if (finished) { showResult(); bar.style.width = '100%'; pct.textContent = '100%'; }
  else { loop(); scheduleAdvance(); }

  return { destroy: stopTimers, setStage, finish };
}

// ============================================================ DASHBOARD
async function renderDashboardRoute(slug) {
  const el = app();
  el.innerHTML = `<div class="min-h-screen flex items-center justify-center"><div class="text-center"><div class="pv-spinner mx-auto mb-4"></div><p class="text-slate-400 text-sm">Loading dashboard…</p></div></div>`;
  try {
    const report = await loadReport(slug);
    clearRun();
    renderDashboard(el, report, { onBack: () => go('#/') });
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
function writeRun(v) { try { localStorage.setItem(RUN_KEY, JSON.stringify(v)); } catch (_) {} }
function clearRun() { try { localStorage.removeItem(RUN_KEY); } catch (_) {} }
