// excel.js — client-side XLSX export via ExcelJS (CDN global). Sheets:
//   Current-India, Current-Global, one Trend-<metric> per metric with series,
//   and Scorecard. Bold headers, gridlines OFF, frozen header row + first column,
//   auto-fit columns, and light conditional colour-grading matching the UI.
import { fmt } from './format.js';
import {
  currentValues, medianRow, averageRow, winnersAcross,
  peersWithSeries, unionYears, seriesValueAt, seriesAggregate, metricsWithSeries,
} from './compute.js';
import { crossFill, trendFill } from './conditional.js';

const NUMFMT = { num0: '#,##0', num1: '#,##0.0', num2: '#,##0.00', pct1: '0.0"%"' };
const HEADER_FILL = 'FFEEF2FF';
const REF_FILL = 'FFE2E8F0';

export async function exportExcel(report) {
  if (typeof ExcelJS === 'undefined') { alert('Excel library not loaded — check your connection and retry.'); return; }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PeerVIP';
  wb.created = new Date();

  const metrics = report.metrics;
  const indian = report.peers.indian || [];
  const global = report.peers.global || [];

  if (indian.length) currentSheet(wb, 'Current-India', indian, metrics);
  if (global.length) currentSheet(wb, 'Current-Global', global, metrics);

  for (const m of metricsWithSeries(indian, metrics)) trendSheet(wb, m, indian);

  scorecardSheet(wb, report);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PeerVIP-${report.meta.slug || 'report'}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---- Current sheet (cross-sectional colour grading) ----
function currentSheet(wb, name, peers, metrics) {
  const ws = wb.addWorksheet(safeName(name), { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
  const header = ['Company', ...metrics.map((m) => m.unit ? `${m.label} (${m.unit})` : m.label), 'Business Model'];
  styleHeader(ws.addRow(header));

  const colVals = {};
  for (const m of metrics) colVals[m.key] = currentValues(peers, m.key);

  for (const p of peers) {
    const cur = p.current || {};
    const row = ws.addRow([p.name, ...metrics.map((m) => valOrBlank(cur[m.key])), p.business_model || '—']);
    metrics.forEach((m, i) => {
      const cell = row.getCell(i + 2);
      cell.numFmt = NUMFMT[m.format] || '#,##0.0';
      cell.alignment = { horizontal: 'right' };
      const argb = crossFill(cur[m.key], colVals[m.key], m.better);
      if (argb) cell.fill = solid(argb);
    });
    row.getCell(1).font = { bold: true, color: { argb: 'FF1E293B' } };
  }
  refRow(ws, 'Median', metrics, medianRow(peers, metrics), true);
  refRow(ws, 'Average', metrics, averageRow(peers, metrics), true);
  autofit(ws);
}

function refRow(ws, label, metrics, data, hasBM) {
  const row = ws.addRow([label, ...metrics.map((m) => valOrBlank(data[m.key])), hasBM ? '' : undefined]);
  row.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FF334155' } }; cell.fill = solid(REF_FILL); });
  metrics.forEach((m, i) => { const c = row.getCell(i + 2); c.numFmt = NUMFMT[m.format] || '#,##0.0'; c.alignment = { horizontal: 'right' }; });
}

// ---- Trend sheet (temporal colour grading) ----
function trendSheet(wb, metric, peers) {
  const ws = wb.addWorksheet(safeName('Trend-' + metric.label), { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
  const years = unionYears(peers, metric.key);
  const rows = peersWithSeries(peers, metric.key);
  styleHeader(ws.addRow(['Company', ...years]));

  for (const p of rows) {
    let prev = null;
    const cells = years.map((y) => valOrBlank(seriesValueAt(p, metric.key, y)));
    const row = ws.addRow([p.name, ...cells]);
    years.forEach((y, i) => {
      const v = seriesValueAt(p, metric.key, y);
      const cell = row.getCell(i + 2);
      cell.numFmt = NUMFMT[metric.format] || '#,##0.0';
      cell.alignment = { horizontal: 'right' };
      const argb = trendFill(v, prev, metric.better);
      if (argb) cell.fill = solid(argb);
      prev = v == null ? prev : v;
    });
    row.getCell(1).font = { bold: true, color: { argb: 'FF1E293B' } };
  }
  const med = seriesAggregate(peers, metric.key, years, 'median');
  const avg = seriesAggregate(peers, metric.key, years, 'average');
  trendRef(ws, 'Median', years, med, metric);
  trendRef(ws, 'Average', years, avg, metric);
  autofit(ws);
}

function trendRef(ws, label, years, vals, metric) {
  const row = ws.addRow([label, ...vals.map(valOrBlank)]);
  row.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FF334155' } }; cell.fill = solid(REF_FILL); });
  years.forEach((y, i) => { const c = row.getCell(i + 2); c.numFmt = NUMFMT[metric.format] || '#,##0.0'; c.alignment = { horizontal: 'right' }; });
}

// ---- Scorecard sheet ----
function scorecardSheet(wb, report) {
  const ws = wb.addWorksheet('Scorecard', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  const groups = [report.peers.indian || [], report.peers.global || [], report.peers.private || []];
  const winners = winnersAcross(groups, report.metrics);

  styleHeader(ws.addRow(['Metric', 'Winner', 'Value', '', 'Rank', 'Company', 'Bucket', 'Score', 'Strengths', 'Reason']));

  const ranking = (report.scorecard && report.scorecard.ranking) ? [...report.scorecard.ranking].sort((a, b) => (a.rank || 99) - (b.rank || 99)) : [];
  const rowCount = Math.max(winners.length, ranking.length);
  for (let i = 0; i < rowCount; i++) {
    const w = winners[i];
    const r = ranking[i];
    const left = w ? (w.metric.better === 'neutral' || !w.winner
      ? [w.metric.label, '— no winner —', '']
      : [w.metric.label, w.winner.name, fmt(w.winner.value, w.metric.format) + (w.metric.unit === '%' ? '%' : w.metric.unit === 'x' ? 'x' : '')])
      : ['', '', ''];
    const right = r ? [r.rank, r.company, cap(r.bucket), r.score, (r.strengths || []).join(', '), r.reason || ''] : ['', '', '', '', '', ''];
    const row = ws.addRow([...left, '', ...right]);
    if (r && r.rank === 1) row.eachCell((c) => { c.font = { bold: true }; });
  }
  ws.getColumn(10).width = 90; // reason
  ws.getColumn(10).alignment = { wrapText: true, vertical: 'top' };
  autofit(ws, { 10: 90, 9: 30 });
}

// ---- helpers ----
function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF3730A3' } };
    cell.fill = solid(HEADER_FILL);
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFC7D2FE' } } };
  });
  row.height = 26;
}
function solid(argb) { return { type: 'pattern', pattern: 'solid', fgColor: { argb } }; }
function valOrBlank(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function safeName(n) { return String(n).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31).trim(); }
function autofit(ws, overrides = {}) {
  ws.columns.forEach((col, idx) => {
    const key = idx + 1;
    if (overrides[key]) { col.width = overrides[key]; return; }
    let max = 8;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value == null ? '' : String(cell.value);
      const len = Math.max(...v.split('\n').map((s) => s.length), 0);
      if (len > max) max = len;
    });
    col.width = Math.min(Math.max(max + 2, 9), 40);
  });
}
