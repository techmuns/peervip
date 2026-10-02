/**
 * lib/valuechain.mjs — GENERIC value-chain discovery + classification for ANY industry.
 *
 * Implements the framework in docs/peer-research-framework.md as an additive,
 * fail-safe pipeline stage:
 *   1. DECOMPOSE the industry into value-chain nodes (Bedrock) — before naming companies.
 *   2. DISCOVER listed candidates PER NODE via Screener search on each node's product
 *      keywords (source-grounded; not the model's memory).
 *   3. FETCH each candidate's financials (dependency-free screener-lite extractor).
 *   4. CLASSIFY every candidate into node(s) + directness (1-5) + cohort (A-F) (Bedrock).
 *   5. ASSEMBLE report.value_chain = { nodes, players } (drops cohort F / directness 0).
 *
 * The core benchmarked set (report.peers.indian) is built elsewhere and left
 * untouched — this only adds the explorable value-chain universe the dashboard's
 * "Value chain" dropdown reads. Never throws: the caller wraps it and omits
 * report.value_chain if anything fails, so a run never breaks on this stage.
 */
import { callClaudeJSON } from './llm.mjs';
import { screenerSearch } from './screener.mjs';
import { fetchPeer } from '../functions/_lib/screener-lite.mjs';

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const norm = (s) => String(s || '').toLowerCase().replace(/\b(ltd|limited|india|industries|technologies|corporation|inc|plc|corp|co|company|the|&)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 1) Decompose the industry into value-chain nodes, each with search keywords. */
export async function decomposeValueChain({ industry, definition, about }) {
  const out = await callClaudeJSON({
    system: [
      "You are an equity-research analyst. Map an industry's ENTIRE value chain BEFORE naming any company — from raw inputs → intermediate components → capital equipment → design/EPC/construction → the CORE operator/producer layer → software/controls → distribution/logistics → aftermarket → enabling infrastructure. Keep ONLY the nodes that economically exist for THIS industry, named in the industry's own terms.",
      'For EACH node give: label (the node name); use (one line on how to use the bucket for comparison); keywords (3-6 concrete PRODUCT/SERVICE search terms a LISTED supplier in that node would be found by on a stock screener — NOT the industry name). Order nodes from the core operator layer outward. 8-16 nodes.',
      'Return STRICT JSON {"nodes":[{"label","use","keywords":["..."]}]}. No prose.',
    ].join('\n'),
    user: `Industry: ${industry}\nDefinition: ${definition || '(n/a)'}${about ? '\nSeed company: ' + String(about).slice(0, 400) : ''}`,
    maxTokens: 2500,
  });
  const seen = new Set();
  return (Array.isArray(out.nodes) ? out.nodes : []).map((n) => ({
    key: slug(n && n.label), label: String((n && n.label) || '').trim(), use: String((n && n.use) || '').trim(),
    keywords: (Array.isArray(n && n.keywords) ? n.keywords : []).map((k) => String(k).trim()).filter(Boolean).slice(0, 6),
  })).filter((n) => n.key && n.label && !seen.has(n.key) && seen.add(n.key));
}

/** 2) Discover listed candidates per node via Screener search on the node keywords. */
export async function discoverNodeCandidates(nodes, { cap = 60, perTerm = 4 } = {}) {
  const byCode = new Map();
  for (const node of nodes) {
    for (const kw of node.keywords) {
      let hits = [];
      try { hits = await screenerSearch(kw); } catch (_) { hits = []; }
      for (const h of (hits || []).slice(0, perTerm)) {
        if (!h || !h.code) continue;
        const code = String(h.code).toUpperCase();
        if (!byCode.has(code)) byCode.set(code, { code: h.code, name: h.name || h.code, node_keys: new Set(), hits: 0 });
        const rec = byCode.get(code); rec.node_keys.add(node.key); rec.hits++;
      }
      await sleep(120);
    }
  }
  // Prefer candidates surfaced by more node-keywords (stronger signal), then cap.
  return [...byCode.values()]
    .sort((a, b) => b.hits - a.hits)
    .slice(0, cap)
    .map((c) => ({ code: c.code, name: c.name, node_keys: [...c.node_keys] }));
}

/** 4) Classify each company into node(s) + directness + cohort (Bedrock). */
export async function classifyPlayers({ industry, definition, nodes, companies }) {
  const nodeList = nodes.map((n) => `${n.key} = ${n.label}`).join('; ');
  const out = await callClaudeJSON({
    system: [
      `Classify each company's role in the "${industry}" value chain by its ACTUAL business, never by theme.`,
      `Value-chain nodes: ${nodeList}.`,
      'For EACH company return: nodes (array of node keys it genuinely belongs to — [] if it is not part of this industry\'s chain); directness (5 = direct operator of the core asset/service; 4 = verified direct supplier with a real order/customer/project; 3 = dedicated strategic vertical/product; 2 = natural supplier, materiality not proven; 1 = thematic only; 0 = unrelated); cohort (A = true operating peer; B = adjacent/large diversified proxy; C = picks-and-shovels supplier; D = indirect proxy via subsidiary/JV; E = emerging; F = exclude); role (<=12 words: what it does).',
      'A company may span several nodes. A hint is given for the keyword(s) that surfaced each one — use it, but correct it from the real business. Return STRICT JSON {"results":[{"name","nodes":[...],"directness":0-5,"cohort":"A|B|C|D|E|F","role"}]}.',
    ].join('\n'),
    user: `Definition: ${definition || '(n/a)'}\n\nCompanies (name — surfaced-by hints):\n${companies.map((c) => `- ${c.name} — ${(c.hintLabels || []).join(', ') || 'n/a'}`).join('\n')}`,
    maxTokens: 8000,
  });
  const map = new Map();
  for (const r of (Array.isArray(out.results) ? out.results : [])) if (r && r.name) map.set(norm(r.name), r);
  return map;
}

/**
 * Orchestrate the whole stage. `seedPeers` = already-scraped core peers
 * (name, ticker, about, current, series) folded in so operators aren't re-fetched.
 * @returns { generated_at, nodes, players } or null if nothing usable.
 */
export async function buildValueChain({ industry, definition, about, seedPeers = [], cap = 60 }) {
  const nodes = await decomposeValueChain({ industry, definition, about });
  if (!nodes.length) return null;
  const labelOf = Object.fromEntries(nodes.map((n) => [n.key, n.label]));

  const candidates = await discoverNodeCandidates(nodes, { cap });
  // Fold the already-scraped core peers in (no re-fetch); dedupe by code/name.
  const seedByCode = new Map();
  for (const p of seedPeers) if (p && p.ticker) seedByCode.set(String(p.ticker).toUpperCase(), p);
  const seenCode = new Set(), seenName = new Set();
  const fetchList = [];
  for (const p of seedPeers) { if (!p || !p.ticker) continue; const code = String(p.ticker).toUpperCase(); seenCode.add(code); seenName.add(norm(p.name)); }
  for (const c of candidates) {
    const code = String(c.code).toUpperCase();
    if (seenCode.has(code) || seenName.has(norm(c.name))) { // same as a seed peer — just carry its node hints
      const seed = seedByCode.get(code);
      if (seed) seed._node_keys = [...new Set([...(seed._node_keys || []), ...c.node_keys])];
      continue;
    }
    seenCode.add(code); seenName.add(norm(c.name));
    fetchList.push(c);
  }

  // 3) fetch financials for the node candidates (seed peers already have them)
  const fetched = [];
  for (const c of fetchList) {
    let res = await fetchPeer(c.code).catch(() => null);
    if ((!res || res.error) && c.name) res = await fetchPeer(c.name).catch(() => null);
    if (res && !res.error && res.current) {
      fetched.push({ name: res.name || c.name, ticker: res.ticker || c.code, node_keys: c.node_keys, current: res.current, series: res.series || {}, basis: res.basis, source: res.source });
    }
    await sleep(250);
  }

  // Everything we will classify: seed peers (as operators) + fetched node players.
  const universe = [
    ...seedPeers.filter((p) => p && p.ticker).map((p) => ({ name: p.name, ticker: p.ticker, node_keys: p._node_keys || [], current: p.current || {}, series: p.series || {}, source: p.source, about: p.about })),
    ...fetched,
  ];
  if (!universe.length) return null;

  // 5) classify
  let cmap = new Map();
  try {
    cmap = await classifyPlayers({
      industry, definition, nodes,
      companies: universe.map((u) => ({ name: u.name, hintLabels: (u.node_keys || []).map((k) => labelOf[k]).filter(Boolean) })),
    });
  } catch (e) { console.warn('[valuechain] classify failed:', e.message); }

  const players = [];
  for (const u of universe) {
    const c = cmap.get(norm(u.name));
    const cohort = c && /^[A-F]$/.test(String(c.cohort || '').trim()[0] || '') ? String(c.cohort).trim()[0] : '';
    const directness = c && isFinite(+c.directness) ? +c.directness : null;
    let nodeKeys = (c && Array.isArray(c.nodes) ? c.nodes : []).filter((k) => labelOf[k]);
    if (!nodeKeys.length) nodeKeys = (u.node_keys || []).filter((k) => labelOf[k]); // fall back to discovery grounding
    if (cohort === 'F' || directness === 0 || !nodeKeys.length) continue; // drop false peers / unrelated
    players.push({
      name: u.name, ticker: u.ticker, exchange: 'NSE/BSE',
      value_chain_nodes: nodeKeys, cohort, directness,
      role: (c && String(c.role || '').trim()) || '',
      source: u.source || { label: 'Screener', url: u.ticker ? `https://www.screener.in/company/${encodeURIComponent(u.ticker)}/` : '' },
      current: u.current || {}, series: u.series || {},
      ...(u.basis ? { basis: u.basis } : {}),
    });
  }
  if (!players.length) return null;

  const usedKeys = new Set(players.flatMap((p) => p.value_chain_nodes));
  const keptNodes = nodes.filter((n) => usedKeys.has(n.key)).map((n) => ({ key: n.key, label: n.label, use: n.use }));
  return { generated_at: new Date().toISOString(), nodes: keptNodes, players };
}
