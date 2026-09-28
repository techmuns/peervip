// conditional.js — Excel-like light tints. Two flavours:
//  * cross-sectional (current tables): shade a cell by how it compares to peers
//    for that metric, respecting `better`; the best cell is flagged for a crown.
//  * temporal (trend tables): green if the year moved in the good direction vs
//    the prior year, red if worse.
// Exposes both CSS class names (DOM) and ARGB fills (Excel export).
import { rankPosition, isBest } from './compute.js';

function isNum(v) { return typeof v === 'number' && isFinite(v); }

// class <-> Tailwind hex, kept in one place so DOM and Excel stay identical.
const LEVEL = {
  2:  { cls: 'cf-p2', argb: 'FFD1FAE5' },
  1:  { cls: 'cf-p1', argb: 'FFECFDF5' },
  0:  { cls: 'cf-z',  argb: 'FFFFFBEB' },
  '-1': { cls: 'cf-n1', argb: 'FFFFF1F2' },
  '-2': { cls: 'cf-n2', argb: 'FFFFE4E6' },
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Cross-sectional bucket level (-2..2) for a value, or null when neutral/missing. */
export function crossLevel(value, allValues, better) {
  const pos = rankPosition(value, allValues, better);
  if (pos == null) return null;
  return clamp(Math.round((pos - 0.5) * 4), -2, 2);
}

/** { cls, best } for a current-table data cell. */
export function crossClass(value, allValues, better) {
  const lvl = crossLevel(value, allValues, better);
  if (lvl == null) return { cls: '', best: false };
  return { cls: LEVEL[lvl].cls, best: isBest(value, allValues, better) };
}

/** ARGB fill for the same cell in Excel (or null). Best cell gets the strong emerald. */
export function crossFill(value, allValues, better) {
  const lvl = crossLevel(value, allValues, better);
  if (lvl == null) return null;
  if (isBest(value, allValues, better)) return 'FFA7F3D0'; // emerald-200, a touch stronger
  return LEVEL[lvl].argb;
}

function trendDir(curr, prev, better) {
  if (better === 'neutral' || !isNum(curr) || !isNum(prev)) return { improved: 0, strong: false };
  const delta = curr - prev;
  if (delta === 0) return { improved: 0, strong: false };
  const goodSign = better === 'high' ? 1 : -1;
  const improved = Math.sign(delta) === goodSign ? 1 : -1;
  const base = Math.abs(prev) > 1e-9 ? Math.abs(delta) / Math.abs(prev) : Math.abs(delta);
  return { improved, strong: base >= 0.1 };
}

/** CSS class for a trend cell relative to its prior year (or ''). */
export function trendClass(curr, prev, better) {
  const { improved, strong } = trendDir(curr, prev, better);
  if (!improved) return '';
  if (improved > 0) return strong ? 'cf-up2' : 'cf-up';
  return strong ? 'cf-down2' : 'cf-down';
}

/** ARGB fill for a trend cell in Excel (or null). */
export function trendFill(curr, prev, better) {
  const { improved, strong } = trendDir(curr, prev, better);
  if (!improved) return null;
  if (improved > 0) return strong ? 'FFD1FAE5' : 'FFECFDF5';
  return strong ? 'FFFFE4E6' : 'FFFFF1F2';
}
