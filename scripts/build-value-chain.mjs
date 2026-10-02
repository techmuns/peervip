#!/usr/bin/env node
// scripts/build-value-chain.mjs — attach a value-chain universe to a report.
// Reads scripts/data/<slug>-valuechain.json (the curated node taxonomy + the
// listed players tagged with value-chain node(s), cohort, directness, evidence —
// produced from the research framework), fetches each Indian-listed player's
// financials from Screener (via the dependency-free screener-lite extractor), and
// writes report.value_chain = { nodes, players } onto public/data/reports/<slug>.json.
//
// The core benchmarked set (report.peers.indian) is left untouched — the value
// chain is an additive explorer the dashboard's "Value chain" dropdown reads.
//
// Usage:  node scripts/build-value-chain.mjs data-center
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPeer } from '../functions/_lib/screener-lite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isIndian = (ex) => /NSE|BSE|NSE SM|BS/i.test(String(ex || ''));

async function build(slug) {
  const srcFile = path.join(ROOT, 'scripts', 'data', `${slug}-valuechain.json`);
  const repFile = path.join(ROOT, 'public', 'data', 'reports', `${slug}.json`);
  const src = JSON.parse(await readFile(srcFile, 'utf8'));
  const report = JSON.parse(await readFile(repFile, 'utf8'));

  const players = [];
  console.log(`\n=== ${slug} — ${src.players.length} value-chain players ===`);
  for (const p of src.players) {
    const base = {
      name: p.name, ticker: p.ticker, exchange: p.exchange, role: p.role,
      value_chain_nodes: p.nodes || [], cohort: p.cohort || '', directness: p.directness ?? null,
      evidence: p.evidence || '', note: p.note || '',
      source: p.ticker && isIndian(p.exchange) ? { label: 'Screener', url: `https://www.screener.in/company/${encodeURIComponent(p.ticker)}/` } : { label: 'Web', url: '' },
      current: {}, series: {},
    };
    if (isIndian(p.exchange)) {
      let res = await fetchPeer(p.ticker).catch(() => null);
      if ((!res || res.error) && p.name) res = await fetchPeer(p.name).catch(() => null);
      if (res && !res.error && res.current) {
        base.current = res.current; base.series = res.series || {};
        if (res.basis) base.basis = res.basis;
        if (res.source && res.source.url) base.source = res.source;
        const n = Object.values(res.current).filter((v) => v != null).length;
        console.log(`  ✓ ${p.name} (${p.ticker}) ${n} metrics · ${(p.nodes || []).length} node(s)`);
      } else {
        console.log(`  ✗ ${p.name} (${p.ticker}) — no financials (${(res && res.error) || 'n/a'})`);
      }
      await sleep(300);
    } else {
      console.log(`  • ${p.name} (${p.exchange}) — descriptive only`);
    }
    players.push(base);
  }

  report.value_chain = { generated_at: new Date().toISOString(), nodes: src.nodes, players };
  if (report.meta) report.meta.value_chain_at = report.value_chain.generated_at;
  await writeFile(repFile, JSON.stringify(report, null, 2) + '\n');
  const withFin = players.filter((p) => Object.keys(p.series || {}).length).length;
  console.log(`\n  → wrote ${slug}.json · value_chain: ${players.length} players (${withFin} with financials), ${src.nodes.length} nodes`);
}

const slugs = process.argv.slice(2);
if (!slugs.length) { console.error('usage: node scripts/build-value-chain.mjs <slug> [slug...]'); process.exit(1); }
for (const s of slugs) { try { await build(s); } catch (e) { console.error(`!! ${s}: ${e.message}`); } }
console.log('\nDONE');
