#!/usr/bin/env node
// scripts/enrich-report.mjs — backfill existing report JSONs with the expanded
// metric set. Re-fetches each Indian peer from Screener (via the dependency-free
// screener-lite extractor) and merges the enriched current{} + series{} in, then
// swaps report.metrics to the current catalog. Global/Private peers are
// descriptive-only and left untouched. Never fabricates: a value the fetch can't
// read keeps whatever the report already had.
//
// Usage:  node scripts/enrich-report.mjs [slug ...]      (default: all reports)
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { METRICS } from '../lib/metrics.mjs';
import { fetchPeer } from '../functions/_lib/screener-lite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public', 'data', 'reports');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mergeCurrent(oldCur, newCur) {
  const out = { ...(oldCur || {}) };
  for (const [k, v] of Object.entries(newCur || {})) if (v != null) out[k] = v;
  return out;
}

async function enrichPeer(peer) {
  // Resolve by the (Screener-canonical) name first, fall back to ticker.
  let res = await fetchPeer(peer.name).catch(() => null);
  if ((!res || res.error) && peer.ticker) res = await fetchPeer(peer.ticker).catch(() => null);
  if (!res || res.error || !res.current) return { ok: false, reason: (res && res.error) || 'no data' };
  const before = Object.values(peer.current || {}).filter((v) => v != null).length;
  peer.current = mergeCurrent(peer.current, res.current);
  peer.series = { ...(peer.series || {}), ...(res.series || {}) };
  const after = Object.values(peer.current).filter((v) => v != null).length;
  return { ok: true, before, after, series: Object.keys(peer.series).length };
}

async function enrichReport(slug) {
  const file = path.join(DIR, `${slug}.json`);
  const report = JSON.parse(await readFile(file, 'utf8'));
  const indian = (report.peers && report.peers.indian) || [];
  console.log(`\n=== ${slug} — ${indian.length} Indian peers ===`);
  for (const peer of indian) {
    const r = await enrichPeer(peer);
    if (r.ok) console.log(`  ✓ ${peer.name}: current ${r.before}→${r.after}, ${r.series} series`);
    else console.log(`  ✗ ${peer.name}: ${r.reason} (kept as-is)`);
    await sleep(400);
  }
  report.metrics = METRICS; // swap in the full catalog verbatim
  // Full ISO timestamp (not date-only) so the frontend's freshness check prefers
  // this enriched seed over an older KV copy that shares the same generated_at.
  if (report.meta) report.meta.enriched_at = new Date().toISOString();
  await writeFile(file, JSON.stringify(report, null, 2) + '\n');
  console.log(`  → wrote ${slug}.json (metrics: ${METRICS.length})`);
}

const args = process.argv.slice(2);
const slugs = args.length ? args : (await readdir(DIR)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
for (const slug of slugs) {
  try { await enrichReport(slug); } catch (e) { console.log(`  !! ${slug} failed: ${e.message}`); }
}
console.log('\nDONE');
