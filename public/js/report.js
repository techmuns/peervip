// report.js — the one-pager. Renders report.sections[].blocks[] as typed visual
// blocks (kpis / bars / trend / donut / table / callout) using sanitized inline
// SVG (self-contained + print-friendly). "Print / Save as PDF" uses window.print()
// against the #print-region + the print stylesheet — no PDF library.
import { esc, fmt, fmtDate } from './format.js';
import { PALETTE } from './charts.js';

const ICON = {
  sparkles: '✨', chart: '📊', trophy: '🏆', trend: '📈', donut: '🍩',
  table: '📋', globe: '🌍', money: '💰', flag: '🚩',
};

export function renderReport(container, report) {
  const rep = report.report || {};
  const sections = (rep.sections || []).map(sectionHtml).join('');
  container.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap mb-4 no-print">
      <p class="text-sm text-slate-500">A shareable one-pager — every block below prints cleanly.</p>
      <button data-print class="pv-focus inline-flex items-center gap-2 rounded-xl brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
        Print / Save as PDF
      </button>
    </div>

    <div id="print-region" class="pv-fade-in">
      <div class="pv-print-only" style="margin-bottom:14px">
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;color:#0f172a">${esc(rep.title || report.meta.name)}</div>
        <div style="color:#64748b;font-size:12px">PeerVIP · ${esc(report.meta.segment || '')} · Generated ${esc(fmtDate(report.meta.generated_at))}${report.meta.sample ? ' · SAMPLE DATA' : ''}</div>
      </div>

      <div class="pv-card p-6 mb-5 no-print-shadow">
        <div class="grid gap-5 lg:grid-cols-3 items-start">
          <div class="lg:col-span-2">
            <h2 class="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">${esc(rep.title || report.meta.name)}</h2>
            ${rep.summary ? `<p class="text-slate-600 mt-3 leading-relaxed">${esc(rep.summary)}</p>` : ''}
          </div>
          ${coverageStats(report.meta)}
        </div>
      </div>

      <div class="grid gap-5">${sections || emptyState('No report sections in this dataset.')}</div>

      ${sourcesHtml(report.sources)}
    </div>`;

  const btn = container.querySelector('[data-print]');
  if (btn) btn.addEventListener('click', () => window.print());
}

function coverageStats(meta) {
  const cov = (meta && meta.coverage) || {};
  const items = [
    { label: 'Peers', value: cov.peers_total ?? '—' },
    { label: 'With financials', value: cov.with_full_financials ?? '—' },
    { label: 'Confidence', value: cov.confidence ? String(cov.confidence) : '—' },
  ];
  return `<div class="grid grid-cols-3 lg:grid-cols-1 gap-2">
    ${items.map((it) => `<div class="rounded-xl bg-slate-50 px-4 py-3">
      <div class="num font-display text-xl font-extrabold text-slate-800">${esc(String(it.value))}</div>
      <div class="text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400 mt-0.5">${esc(it.label)}</div>
    </div>`).join('')}
  </div>`;
}

function sectionHtml(section) {
  const icon = ICON[section.icon] || '•';
  const blocks = (section.blocks || []).map(blockHtml).join('');
  return `<section class="pv-card p-5 pv-report-section">
    <h3 class="font-display text-lg font-extrabold text-slate-800 mb-3 flex items-center gap-2"><span>${icon}</span>${esc(section.title || '')}</h3>
    <div class="space-y-4">${blocks}</div>
  </section>`;
}

function blockHtml(block) {
  switch (block.type) {
    case 'callout': return calloutBlock(block);
    case 'kpis': return kpisBlock(block);
    case 'bars': return barsBlock(block);
    case 'trend': return trendBlock(block);
    case 'donut': return donutBlock(block);
    case 'table': return tableBlock(block);
    default: return '';
  }
}

// ---- callout ----
function calloutBlock(b) {
  const tones = {
    good: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
    info: 'bg-sky-50 border-sky-200 text-sky-900',
    bad: 'bg-rose-50 border-rose-200 text-rose-900',
  };
  const dot = { good: 'bg-emerald-500', warn: 'bg-amber-500', info: 'bg-sky-500', bad: 'bg-rose-500' };
  const tone = tones[b.tone] || tones.info;
  return `<div class="rounded-xl border ${tone} p-4">
    ${b.title ? `<div class="flex items-center gap-2 font-bold mb-1"><span class="inline-block w-2 h-2 rounded-full ${dot[b.tone] || dot.info}"></span>${esc(b.title)}</div>` : ''}
    <p class="text-sm leading-relaxed opacity-90">${esc(b.text || '')}</p>
  </div>`;
}

// ---- kpis ----
function kpisBlock(b) {
  const items = (b.items || []).map((it, i) => `
    <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
      <div class="num font-display text-2xl font-extrabold" style="color:${PALETTE[i % PALETTE.length]}">${esc(it.value)}</div>
      <div class="text-xs font-semibold text-slate-600 mt-1">${esc(it.label)}</div>
      ${it.sub ? `<div class="text-[0.68rem] text-slate-400">${esc(it.sub)}</div>` : ''}
    </div>`).join('');
  return `<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">${items}</div>`;
}

// ---- bars (horizontal, inline SVG) ----
function barsBlock(b) {
  const items = (b.items || []).filter((it) => isFinite(it.value));
  if (!items.length) return '';
  const W = 720, rowH = 34, padT = 6, padB = 6, labelW = 172, valW = 66;
  const H = padT + padB + items.length * rowH;
  const max = Math.max(...items.map((it) => Math.abs(it.value))) || 1;
  const barMax = W - labelW - valW - 10;
  const rows = items.map((it, i) => {
    const y = padT + i * rowH;
    const w = Math.max(2, (Math.abs(it.value) / max) * barMax);
    const c = PALETTE[i % PALETTE.length];
    return `
      <text x="${labelW - 10}" y="${y + rowH / 2}" text-anchor="end" dominant-baseline="middle" font-size="12.5" font-weight="600" fill="#475569">${esc(clip(it.label, 24))}</text>
      <rect x="${labelW}" y="${y + 7}" width="${w}" height="${rowH - 14}" rx="5" fill="${c}"></rect>
      <text x="${labelW + w + 8}" y="${y + rowH / 2}" dominant-baseline="middle" font-size="12.5" font-weight="700" fill="#334155" class="num">${esc(fmt(it.value, 'num1'))}${esc(unitSuffix(b.unit))}</text>`;
  }).join('');
  return svgWrap(W, H, rows);
}

// ---- trend (multi-line, inline SVG) ----
function trendBlock(b) {
  const years = b.years || [];
  const series = (b.series || []).filter((s) => Array.isArray(s.values));
  if (!years.length || !series.length) return '';
  const W = 720, H = 300, padL = 44, padR = 16, padT = 14, padB = 58;
  const all = series.flatMap((s) => s.values).filter((v) => v != null && isFinite(v));
  if (!all.length) return '';
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  min = Math.min(min, min * 0.98); // small headroom
  const X = (i) => padL + (years.length <= 1 ? 0 : (i / (years.length - 1)) * (W - padL - padR));
  const Y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const gridY = 4;
  let grid = '';
  for (let g = 0; g <= gridY; g++) {
    const val = min + (g / gridY) * (max - min);
    const y = Y(val);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eef2f7"></line>
      <text x="${padL - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="10.5" fill="#94a3b8" class="num">${esc(fmt(val, 'num0'))}</text>`;
  }
  const xlabels = years.map((yr, i) => `<text x="${X(i)}" y="${H - padB + 16}" text-anchor="middle" font-size="10.5" fill="#94a3b8">${esc(yr)}</text>`).join('');

  const lines = series.map((s, si) => {
    const c = PALETTE[si % PALETTE.length];
    let d = '', started = false, lastPt = null;
    s.values.forEach((v, i) => {
      if (v == null || !isFinite(v)) return;
      d += (started ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1) + ' ';
      started = true; lastPt = { x: X(i), y: Y(v) };
    });
    const dot = lastPt ? `<circle cx="${lastPt.x.toFixed(1)}" cy="${lastPt.y.toFixed(1)}" r="3" fill="${c}"></circle>` : '';
    return `<path d="${d.trim()}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>${dot}`;
  }).join('');

  const legend = series.map((s, si) => `<span class="inline-flex items-center gap-1.5 text-xs text-slate-600"><span style="width:9px;height:9px;border-radius:9px;background:${PALETTE[si % PALETTE.length]};display:inline-block"></span>${esc(s.label)}</span>`).join('');

  return `${svgWrap(W, H, grid + xlabels + lines)}
    <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">${legend}</div>`;
}

// ---- donut (inline SVG) ----
function donutBlock(b) {
  const items = (b.items || []).filter((it) => isFinite(it.value) && it.value > 0);
  if (!items.length) return '';
  const total = items.reduce((s, it) => s + it.value, 0) || 1;
  const cx = 90, cy = 90, r = 72, rin = 44;
  let ang = -Math.PI / 2;
  const arcs = items.map((it, i) => {
    const frac = it.value / total;
    const a0 = ang, a1 = ang + frac * Math.PI * 2;
    ang = a1;
    return `<path d="${donutArc(cx, cy, r, rin, a0, a1)}" fill="${PALETTE[i % PALETTE.length]}"></path>`;
  }).join('');
  const legend = items.map((it, i) => `<div class="flex items-center gap-2 text-sm text-slate-600">
      <span style="width:10px;height:10px;border-radius:3px;background:${PALETTE[i % PALETTE.length]};display:inline-block"></span>
      <span class="grow">${esc(it.label)}</span>
      <span class="num font-semibold text-slate-700">${esc(String(it.value))} <span class="text-slate-400">(${Math.round((it.value / total) * 100)}%)</span></span>
    </div>`).join('');
  return `<div class="flex flex-col sm:flex-row items-center gap-5">
    <svg width="180" height="180" viewBox="0 0 180 180" class="shrink-0" role="img" aria-label="Split">${arcs}</svg>
    <div class="grow w-full space-y-1.5">${legend}</div>
  </div>`;
}

// ---- table ----
function tableBlock(b) {
  const cols = b.columns || [];
  const head = `<tr>${cols.map((c, i) => `<th class="px-3 py-2 text-${i === 0 ? 'left' : 'right'} font-semibold text-slate-500 border-b border-slate-200 ${i === 0 ? '' : 'num'}">${esc(c)}</th>`).join('')}</tr>`;
  const rows = (b.rows || []).map((r) => `<tr class="border-b border-slate-100">${r.map((cell, i) => `<td class="px-3 py-2 text-${i === 0 ? 'left font-medium text-slate-700' : 'right num text-slate-600'}">${esc(cell)}</td>`).join('')}</tr>`).join('');
  return `<div class="overflow-x-auto"><table class="w-full text-sm border-collapse"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

// ---- sources ----
function sourcesHtml(sources) {
  if (!sources || !sources.length) return '';
  const items = sources.map((s) => s.url
    ? `<li><a href="${esc(s.url)}" target="_blank" rel="noopener" class="text-indigo-600 hover:underline">${esc(s.label)} ↗</a></li>`
    : `<li class="text-slate-500">${esc(s.label)}</li>`).join('');
  return `<div class="pv-card p-5 mt-5">
    <h3 class="font-display font-bold text-slate-700 mb-2">Sources</h3>
    <ul class="text-sm space-y-1 list-disc list-inside">${items}</ul>
  </div>`;
}

// ---- svg helpers ----
function svgWrap(w, h, inner) {
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" style="max-height:${h}px" role="img">${inner}</svg>`;
}
function polar(cx, cy, r, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
function donutArc(cx, cy, r, rin, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  const [xi1, yi1] = polar(cx, cy, rin, a1), [xi0, yi0] = polar(cx, cy, rin, a0);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} L${xi1.toFixed(2)},${yi1.toFixed(2)} A${rin},${rin} 0 ${large} 0 ${xi0.toFixed(2)},${yi0.toFixed(2)} Z`;
}
function unitSuffix(u) { return u === '%' ? '%' : u === 'x' ? 'x' : u === 'days' ? '' : (u ? '' : ''); }
function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function emptyState(msg) { return `<div class="text-center text-slate-400 py-8 text-sm">${esc(msg)}</div>`; }
