// charts.js — Chart.js v4 global defaults + a small set of on-brand builders.
// Allowed chart types only: line/area, horizontal & vertical bar, doughnut.
// Never scatter/bubble. Depends on the global `Chart` (CDN) + format.js.
import { fmt } from './format.js';

export const PALETTE = [
  '#6366f1', '#ec4899', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6',
  '#ef4444', '#14b8a6', '#f97316', '#a855f7', '#22c55e', '#3b82f6',
];
const GRID = '#eef2f7';
const AXIS = '#94a3b8';

export function color(i) { return PALETTE[i % PALETTE.length]; }

let ready = false;
/** Set global Chart.js defaults once. Safe to call repeatedly. */
export function setupCharts() {
  if (ready || typeof Chart === 'undefined') return;
  ready = true;
  Chart.defaults.font.family = "'Inter', ui-sans-serif, system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#64748b';
  Chart.defaults.borderColor = GRID;
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15,23,42,0.92)';
  Chart.defaults.plugins.tooltip.titleColor = '#fff';
  Chart.defaults.plugins.tooltip.bodyColor = '#e2e8f0';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.tooltip.boxPadding = 5;
  Chart.defaults.plugins.tooltip.usePointStyle = true;
  Chart.defaults.plugins.tooltip.titleFont = { weight: '700', size: 12.5 };
  Chart.defaults.maintainAspectRatio = false;
  Chart.register(medianRefPlugin);
}

// Draws a dashed reference line at a single value on the value axis
// (x for horizontal bars, y otherwise). Configured via options.plugins.medianRef.
const medianRefPlugin = {
  id: 'medianRef',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.value == null || !isFinite(opts.value)) return;
    const { ctx, chartArea: area, scales } = chart;
    const horizontal = chart.options.indexAxis === 'y';
    const scale = horizontal ? scales.x : scales.y;
    if (!scale) return;
    const px = scale.getPixelForValue(opts.value);
    ctx.save();
    ctx.strokeStyle = opts.color || '#475569';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    if (horizontal) { ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); }
    else { ctx.moveTo(area.left, px); ctx.lineTo(area.right, px); }
    ctx.stroke();
    ctx.setLineDash([]);
    // label
    const label = opts.label || ('Median ' + fmt(opts.value, 'num1'));
    ctx.font = "600 11px 'Inter', sans-serif";
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(71,85,105,0.95)';
    if (horizontal) {
      roundRect(ctx, px - tw / 2, area.top - 2, tw, 17, 5); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, px, area.top + 6.5);
    } else {
      roundRect(ctx, area.right - tw - 2, px - 8.5, tw, 17, 5); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, area.right - tw / 2 - 2, px);
    }
    ctx.restore();
  },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function reset(canvas) {
  if (typeof Chart === 'undefined' || !canvas) return false;
  const ex = Chart.getChart(canvas);
  if (ex) ex.destroy();
  return true;
}

function unitTick(unit) {
  return (v) => {
    if (unit === '%') return v + '%';
    if (unit === 'x') return v + 'x';
    return typeof v === 'number' ? v.toLocaleString('en-US') : v;
  };
}
function unitVal(v, unit) {
  const s = fmt(v, unit === 'x' ? 'num2' : 'num1');
  if (unit === '%') return s + '%';
  if (unit === 'x') return s + 'x';
  if (unit === 'days') return s + ' days';
  if (unit) return s + ' ' + unit;
  return s;
}

/** Multi-line chart (all peers as series) with an optional dashed median series. */
export function makeLine(canvas, { years, series, medianValues, unit = '', area = true }) {
  if (!reset(canvas)) return null;
  const datasets = series.map((s, i) => ({
    label: s.label,
    data: s.values,
    borderColor: color(i),
    backgroundColor: area ? hexA(color(i), 0.08) : 'transparent',
    borderWidth: 2.5,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBackgroundColor: color(i),
    pointHoverBorderColor: '#fff',
    pointHoverBorderWidth: 2,
    tension: 0.32,
    fill: area,
    spanGaps: false,
  }));
  if (medianValues) {
    datasets.push({
      label: 'Median', data: medianValues, borderColor: '#475569',
      borderWidth: 2, borderDash: [6, 5], pointRadius: 0, pointHoverRadius: 4,
      tension: 0.32, fill: false, spanGaps: true,
    });
  }
  return new Chart(canvas, {
    type: 'line',
    data: { labels: years, datasets },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true, position: 'bottom',
          labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 14, color: '#475569' },
        },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y == null ? '—' : unitVal(c.parsed.y, unit)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: AXIS } },
        y: { grid: { color: GRID }, border: { display: false }, ticks: { color: AXIS, callback: unitTick(unit) } },
      },
    },
  });
}

/** Horizontal bar across peers with a single dashed median reference line. */
export function makeHBar(canvas, { labels, values, medianValue, unit = '', highlightIndex = -1 }) {
  if (!reset(canvas)) return null;
  const colors = values.map((_, i) => (i === highlightIndex ? '#f59e0b' : color(i)));
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values, backgroundColor: colors, borderRadius: 6, borderSkipped: false,
        maxBarThickness: 26, hoverBackgroundColor: colors.map((c) => hexA(c, 0.85)),
      }],
    },
    options: {
      indexAxis: 'y',
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        medianRef: medianValue == null ? {} : { value: medianValue, label: 'Median ' + unitVal(medianValue, unit) },
        tooltip: { callbacks: { label: (c) => ' ' + unitVal(c.parsed.x, unit) } },
      },
      scales: {
        x: { grid: { color: GRID }, border: { display: false }, ticks: { color: AXIS, callback: unitTick(unit) } },
        y: { grid: { display: false }, ticks: { color: '#334155', font: { weight: '600' } } },
      },
    },
  });
}

/** Doughnut (e.g. business-model split). */
export function makeDoughnut(canvas, { labels, values }) {
  if (!reset(canvas)) return null;
  return new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: labels.map((_, i) => color(i)), borderColor: '#fff', borderWidth: 3, hoverOffset: 6 }] },
    options: {
      cutout: '62%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 12, color: '#475569' } },
        tooltip: { callbacks: { label: (c) => {
          const total = c.dataset.data.reduce((s, v) => s + (v || 0), 0) || 1;
          return ` ${c.label}: ${c.parsed} (${Math.round((c.parsed / total) * 100)}%)`;
        } } },
      },
    },
  });
}

/** Destroy any chart bound to a canvas (call before removing it from the DOM). */
export function destroyChart(canvas) { reset(canvas); }

// hex + alpha -> rgba()
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
