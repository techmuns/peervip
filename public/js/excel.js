// excel.js — client-side XLSX export via ExcelJS (CDN global). Sheets:
//   Current-India, Current-Global, one Trend-<metric> per metric with series,
//   and Scorecard. Bold headers, gridlines OFF, frozen header row + first column,
//   auto-fit columns, and light conditional colour-grading matching the UI.
import { fmt } from './format.js';
import {
  currentValues, medianRow, averageRow, winnersAcross, compositeScores,
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

  if (indian.length) currentSheet(wb, 'Current-India', indian, metrics.filter((m) => !m.trendOnly));

  for (const m of metricsWithSeries(indian, metrics)) trendSheet(wb, m, indian);

  scorecardSheet(wb, report);

  // Global + Private are descriptive-only (name + business), matching the dashboard.
  if (global.length) descriptiveSheet(wb, 'Global peers', global);
  const priv = report.peers.private || [];
  if (priv.length) descriptiveSheet(wb, 'Private peers', priv);

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
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
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
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: years.length + 1 } };
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
  const indian = report.peers.indian || [];
  const winners = winnersAcross([indian], report.metrics.filter((m) => !m.trendOnly));

  styleHeader(ws.addRow(['Metric', 'Winner', 'Value', '', 'Rank', 'Company', 'Score', 'Strengths', 'Reason']));

  // Live ranking over the CURRENT Indian set (so added peers appear, removed ones
  // drop) — AI research score where scored, else scored live from the metrics.
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const aiMap = new Map(((report.scorecard && report.scorecard.ranking) || []).map((r) => [norm(r.company), r]));
  const compMap = new Map(compositeScores(indian, report.metrics).map((s) => [norm(s.name), s.score]));
  const ranking = indian.map((p) => {
    const a = aiMap.get(norm(p.name));
    const score = (a && Number.isFinite(a.score)) ? a.score : (compMap.get(norm(p.name)) ?? 0);
    return { company: p.name, score, strengths: (a && a.strengths) || [], reason: (a && a.reason) || (p.added_by === 'user' ? 'Added by user; scored live from metrics.' : '') };
  }).sort((x, y) => (y.score || 0) - (x.score || 0));
  const rowCount = Math.max(winners.length, ranking.length);
  for (let i = 0; i < rowCount; i++) {
    const w = winners[i];
    const r = ranking[i];
    const left = w ? (w.metric.better === 'neutral' || !w.winner
      ? [w.metric.label, '— no winner —', '']
      : [w.metric.label, w.winner.name, fmt(w.winner.value, w.metric.format) + (w.metric.unit === '%' ? '%' : w.metric.unit === 'x' ? 'x' : '')])
      : ['', '', ''];
    const right = r ? [i + 1, r.company, r.score, (r.strengths || []).join(', '), r.reason || ''] : ['', '', '', '', ''];
    const row = ws.addRow([...left, '', ...right]);
    if (r && i === 0) row.eachCell((c) => { c.font = { bold: true }; });
  }
  ws.getColumn(9).width = 90; // reason
  ws.getColumn(9).alignment = { wrapText: true, vertical: 'top' };
  ws.autoFilter = { from: { row: 1, column: 5 }, to: { row: 1, column: 9 } };
  autofit(ws, { 9: 90, 8: 30 });
}

// ---- Descriptive sheet (Global / Private — name + business, no financials) ----
function descriptiveSheet(wb, name, peers) {
  const ws = wb.addWorksheet(safeName(name), { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  styleHeader(ws.addRow(['Company', 'Country', 'Business Model', 'Products', 'Note', 'Source']));
  for (const p of peers) {
    const row = ws.addRow([p.name, p.country || '', p.business_model || '', p.products || '', p.note || '', (p.source && (p.source.url || p.source.label)) || '']);
    row.getCell(1).font = { bold: true, color: { argb: 'FF1E293B' } };
  }
  ws.getColumn(4).alignment = { wrapText: true, vertical: 'top' };
  ws.getColumn(5).alignment = { wrapText: true, vertical: 'top' };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };
  autofit(ws, { 4: 40, 5: 46, 6: 40 });
}

// ---- helpers ----
function styleHeader(row) {
  row.eachCell((cell) => {
    if (cell.value == null || cell.value === '') return; // skip spacer columns
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = solid('FF4F46E5'); // indigo-600 — colourful, bold headings
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  row.height = 30;
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
