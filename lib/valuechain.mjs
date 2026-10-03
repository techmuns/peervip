/**
 * lib/valuechain.mjs — GENERIC value-chain discovery + classification for ANY industry.
 *
 * Implements docs/peer-research-framework.md as an additive, fail-safe pipeline
 * stage. v2 is WEB-FIRST and multi-route (the v1 shortcut — Screener keyword
 * search only — under-decomposed the chain and under-recalled the names):
 *
 *   1. DECOMPOSE the industry into the FULL value chain (Bedrock), exhaustively —
 *      every economically distinct node from feedstock to end-of-life, before any
 *      company is named. A node is kept even if no listed player is found.
 *   2. DISCOVER listed players PER NODE from the real-world ecosystem via several
 *      independent routes — Jina web search + reading an industry/registry source,
 *      a Bedrock extract of the companies named there, Screener's /market universe,
 *      and Screener keyword search. Screener is ONE route, never the universe.
 *   3. VERIFY by resolving each candidate to its Screener listing + financials.
 *   4. CLASSIFY each into node(s) + directness (1-5, evidence-gated) + cohort (A-F)
 *      + significance (High/Med/Low) + evidence grade (A-D), from the discovered
 *      context — not a one-line description. Drop cohort F / directness 0.
 *
 * report.peers.indian (the benchmarked operator set) is built elsewhere and left
 * untouched. Never throws: the caller wraps it and omits report.value_chain if
 * anything fails, so a run never breaks on this stage. Degrades without Jina
 * (falls back to Screener /market + search).
 */
import { callClaudeJSON } from './llm.mjs';
import { screenerSearch, resolveScreenerCode, getCompanyIndustryHref, mineIndustryUniverse } from './screener.mjs';
import { jinaSearch, jinaRead, jinaConfigured } from './jina.mjs';
import { fetchPeer } from '../functions/_lib/screener-lite.mjs';

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 44);
const norm = (s) => String(s || '').toLowerCase().replace(/\b(ltd|limited|india|industries|technologies|corporation|inc|plc|corp|co|company|the|&)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CAP = { nodeQueries: 3, nodeReads: 2, fetch: 90, marketPages: 4 };

/** 1) DECOMPOSE — the whole chain, exhaustively, before naming companies. */
export async function decomposeValueChain({ industry, definition, about }) {
  const out = await callClaudeJSON({
    system: [
      "You are an industry analyst. Decompose an industry into its COMPLETE economic value chain BEFORE naming any company. Think first-principles: what has to happen from the earliest raw input to the end customer and end-of-life? Break it into the SMALLEST economically distinct commercial activities — each a node where a different kind of business sells a different product/service.",
      'Cover, where they exist: raw feedstock; each intermediate conversion step (do NOT collapse distinct steps — e.g. for solar: polysilicon -> ingots -> wafers -> cells -> modules are FIVE nodes, not one); the components/materials that go into the product; capital equipment to make it; power electronics/controls; balance-of-system; end-use / application equipment and kits built on the product (e.g. for solar: solar water pumps and agri-solar, rooftop/off-grid kits, solar lighting/appliances — give these their OWN node, do not fold them into generic "distribution"); distribution/applications; design/EPC/construction; the core operator/producer/developer layer; asset ownership; enabling infrastructure (grid, storage); services (O&M); and recycling/end-of-life.',
      'Return 12-20 nodes. Order them along the chain. For EACH node: label; use (one line, how to use the bucket for comparison); keywords (4-7 concrete PRODUCT/SERVICE + technical terms a listed supplier in that node is found by — include an authoritative-list term where one exists, e.g. "ALMM", "approved vendor list", "PLI beneficiary"). A node is valid even if no listed company exists for it.',
      'Return STRICT JSON {"nodes":[{"label","use","keywords":["..."]}]}. No prose.',
    ].join('\n'),
    user: `Industry: ${industry}\nDefinition: ${definition || '(n/a)'}${about ? '\nSeed company context: ' + String(about).slice(0, 400) : ''}`,
    maxTokens: 3000,
  });
  const seen = new Set();
  return (Array.isArray(out.nodes) ? out.nodes : []).map((n) => ({
    key: slug(n && n.label), label: String((n && n.label) || '').trim(), use: String((n && n.use) || '').trim(),
    keywords: (Array.isArray(n && n.keywords) ? n.keywords : []).map((k) => String(k).trim()).filter(Boolean).slice(0, 7),
  })).filter((n) => n.key && n.label && !seen.has(n.key) && seen.add(n.key));
}

/** Web route: search + read the best grounding sources for a node, then Bedrock-extract
 *  the companies named there that operate in this node (names + why). Works for operator
 *  / service nodes too, not just manufacturing. Empty without Jina. */
async function webDiscoverNode(industry, node) {
  if (!jinaConfigured()) return [];
  const kw = node.keywords.slice(0, 3);
  const queries = [];
  // node-type-agnostic: "companies/players in India", not only "manufacturers/suppliers",
  // so operator / developer / colocation / services nodes surface their listed names too.
  for (const k of kw.slice(0, 2)) queries.push(`${k} companies India listed NSE BSE`);
  queries.push(`${industry} ${node.label} India largest listed companies players operators`);
  queries.push(`${industry} ${node.label} India approved vendor OR manufacturer list OR ALMM OR market share`);
  const snippets = []; const urls = new Map();
  for (const q of queries.slice(0, CAP.nodeQueries + 1)) {
    let hits = [];
    try { hits = await jinaSearch(q); } catch (_) { hits = []; }
    for (const h of hits) {
      if (h.snippet) snippets.push(`${h.title}: ${h.snippet}`);
      if (h.url && !/youtube|facebook|twitter|instagram|linkedin/i.test(h.url)) urls.set(h.url, (urls.get(h.url) || 0) + (/\.pdf|annualreport|investor|nseindia|bseindia|mnre|crisil|ibef/i.test(h.url) ? 3 : 1));
    }
    await sleep(120);
  }
  // read the single best grounding source (report / filing / registry)
  let readText = '';
  const top = [...urls.entries()].sort((a, b) => b[1] - a[1]).slice(0, CAP.nodeReads);
  for (const [u] of top) { try { readText += '\n' + (await jinaRead(u) || '').slice(0, 12000); } catch (_) { /* skip */ } }
  if (!snippets.length && !readText) return [];
  try {
    const out = await callClaudeJSON({
      system: [
        `From web results about the "${node.label}" node of the "${industry}" value chain, list EVERY company named in the text that GENUINELY operates in THIS node, preferring India-relevant companies (whether or not the text says they are listed — listing is verified in a later step, so do NOT drop a real operator just because the text doesn't call it "listed"). Use ONLY the text given; never invent. For each: name (as commonly written), why (<=15 words of the actual activity/evidence seen).`,
        'Return STRICT JSON {"companies":[{"name","why"}]}. Skip only purely generic/thematic mentions (e.g. "various startups"), not named real companies.',
      ].join('\n'),
      user: `Node keywords: ${node.keywords.join(', ')}\n\nWEB RESULTS:\n${snippets.slice(0, 40).join('\n')}\n\nSOURCE TEXT:\n${readText.slice(0, 14000)}`,
      maxTokens: 1500,
    });
    return (Array.isArray(out.companies) ? out.companies : []).map((c) => ({ name: String(c.name || '').trim(), why: String(c.why || '').trim() })).filter((c) => c.name);
  } catch (_) { return []; }
}

/** 2) DISCOVER candidates per node across routes → unique names with node + why hints. */
export async function discoverNodeCandidates(industry, nodes) {
  const byName = new Map(); // norm -> { name, nodes:Set, why, routes:Set }
  const add = (name, nodeKey, why, route) => {
    const n = String(name || '').trim(); if (!n) return;
    const k = norm(n); if (!k) return;
    if (!byName.has(k)) byName.set(k, { name: n, nodes: new Set(), why: '', routes: new Set() });
    const rec = byName.get(k); rec.nodes.add(nodeKey); rec.routes.add(route);
    if (why && why.length > rec.why.length) rec.why = why;
  };
  for (const node of nodes) {
    // Route A — web (Jina search + read + Bedrock extract)
    try { for (const c of await webDiscoverNode(industry, node)) add(c.name, node.key, c.why, 'web'); } catch (_) { /* */ }
    // Route B — Screener keyword search
    for (const kw of node.keywords.slice(0, 3)) {
      let hits = []; try { hits = await screenerSearch(kw); } catch (_) { hits = []; }
      for (const h of (hits || []).slice(0, 4)) if (h && h.name) add(h.name, node.key, '', 'screener');
      await sleep(120);
    }
  }
  return byName;
}

/** 4) CLASSIFY — node(s) + directness + cohort + significance + evidence, evidence-gated. */
export async function classifyPlayers({ industry, definition, nodes, companies }) {
  const nodeList = nodes.map((n) => `${n.key}=${n.label}`).join('; ');
  const out = await callClaudeJSON({
    system: [
      `Classify each company's role in the "${industry}" value chain by its ACTUAL business, never by theme or name.`,
      `Nodes: ${nodeList}.`,
      'For EACH company return: nodes (array of node keys it genuinely belongs to — a company may span several; [] if not part of this chain); directness (5 ONLY if this chain is a CORE operating business proven by operating capacity/revenue/assets/orders — not merely because a description sounds on-theme; 4 = verified direct supplier with a real order/customer/project; 3 = dedicated strategic vertical/product; 2 = natural supplier, materiality unproven; 1 = thematic; 0 = unrelated); cohort (A true operating peer, B adjacent/large diversified proxy, C picks-and-shovels supplier, D indirect proxy via sub/JV, E emerging/small, F exclude); significance (High/Medium/Low — scale within the node TODAY, independent of directness); evidence (A primary filing/annual report, B investor/industry report, C media/database, D name/description only — grade what the hint actually shows); role (<=12 words).',
      'A "hint" gives what surfaced each company. Judge strictly: do not hand out directness 5 to every on-theme name. Return STRICT JSON {"results":[{"name","nodes":[...],"directness":0-5,"cohort":"A|B|C|D|E|F","significance":"High|Medium|Low","evidence":"A|B|C|D","role"}]}.',
    ].join('\n'),
    user: `Definition: ${definition || '(n/a)'}\n\nCompanies (name — node hints — why/evidence seen):\n${companies.map((c) => `- ${c.name} — ${(c.hintLabels || []).join(', ') || 'n/a'} — ${c.why || 'screener listing'}`).join('\n')}`,
    maxTokens: 8000,
  });
  const map = new Map();
  for (const r of (Array.isArray(out.results) ? out.results : [])) if (r && r.name) map.set(norm(r.name), r);
  return map;
}

/**
 * Orchestrate. seedPeers = already-scraped core peers (name, ticker, about, current,
 * series) folded in so operators aren't re-fetched/re-discovered.
 * @returns { generated_at, nodes, players } or null.
 */
export async function buildValueChain({ industry, definition, about, seedPeers = [], cap = CAP.fetch }) {
  const nodes = await decomposeValueChain({ industry, definition, about });
  if (!nodes.length) return null;
  const labelOf = Object.fromEntries(nodes.map((n) => [n.key, n.label]));

  const byName = await discoverNodeCandidates(industry, nodes);

  // Backstop route — Screener /market industry universe around an anchor (adds breadth).
  try {
    const anchor = (seedPeers.find((p) => p && p.ticker) || {}).ticker;
    if (anchor) {
      const href = await getCompanyIndustryHref(anchor).catch(() => '');
      if (href) {
        const uni = await mineIndustryUniverse(href, { maxPages: CAP.marketPages }).catch(() => []);
        for (const u of uni) { const k = norm(u.name); if (k && !byName.has(k)) byName.set(k, { name: u.name, nodes: new Set(), why: 'same /market industry', routes: new Set(['market']) }); }
      }
    }
  } catch (_) { /* optional */ }

  // Fold seed peers in (no re-fetch); carry any node hints they picked up.
  const seedByName = new Map();
  for (const p of seedPeers) if (p && p.name) seedByName.set(norm(p.name), p);

  // 3) VERIFY + fetch financials for discovered names not already seeded.
  // Resolve the most-promising candidates FIRST — surfaced by the web route, by
  // several routes, or spanning several nodes — so the fetch budget is never spent
  // on long-tail single-keyword hits before a prominent, multiply-corroborated name.
  const fetched = [];
  let budget = cap;
  const ranked = [...byName.values()]
    .filter((rec) => !seedByName.has(norm(rec.name)))
    .map((rec) => ({ rec, score: (rec.routes.has('web') ? 3 : 0) + rec.routes.size + rec.nodes.size }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.rec);
  for (const rec of ranked) {
    if (budget <= 0) break;
    let hit = await resolveScreenerCode(rec.name).catch(() => null);
    if (!hit || !hit.code) continue; // not an Indian-listed company
    budget--;
    let res = await fetchPeer(hit.code).catch(() => null);
    if ((!res || res.error)) res = await fetchPeer(rec.name).catch(() => null);
    if (res && !res.error && res.current) {
      fetched.push({ name: res.name || rec.name, ticker: res.ticker || hit.code, node_keys: [...rec.nodes], why: rec.why, current: res.current, series: res.series || {}, basis: res.basis, source: res.source });
    }
    await sleep(200);
  }

  const universeRaw = [
    ...seedPeers.filter((p) => p && p.ticker).map((p) => ({ name: p.name, ticker: p.ticker, node_keys: [], why: p.about ? String(p.about).slice(0, 160) : '', current: p.current || {}, series: p.series || {}, source: p.source })),
    ...fetched,
  ];
  // De-dupe by normalized name — a company can surface via both the seed set and
  // discovery (or under two spellings); keep the first (seed entries lead).
  const universe = [];
  const seenU = new Set();
  for (const u of universeRaw) { const k = norm(u.name); if (!k || seenU.has(k)) continue; seenU.add(k); universe.push(u); }
  if (!universe.length) return null;

  // 4) classify
  let cmap = new Map();
  try {
    cmap = await classifyPlayers({
      industry, definition, nodes,
      companies: universe.map((u) => ({ name: u.name, hintLabels: (u.node_keys || []).map((k) => labelOf[k]).filter(Boolean), why: u.why })),
    });
  } catch (e) { console.warn('[valuechain] classify failed:', e.message); }

  const players = [];
  for (const u of universe) {
    const c = cmap.get(norm(u.name));
    const cohort = c && /^[A-F]$/.test((String(c.cohort || '').trim()[0] || '')) ? String(c.cohort).trim()[0] : '';
    const directness = c && isFinite(+c.directness) ? +c.directness : null;
    let nodeKeys = (c && Array.isArray(c.nodes) ? c.nodes : []).filter((k) => labelOf[k]);
    if (!nodeKeys.length) nodeKeys = (u.node_keys || []).filter((k) => labelOf[k]);
    if (cohort === 'F' || directness === 0 || !nodeKeys.length) continue;
    const sig = c && /^(high|medium|low)$/i.test(String(c.significance || '').trim()) ? String(c.significance).trim().replace(/^./, (m) => m.toUpperCase()) : '';
    const ev = c && /^[A-D]$/.test((String(c.evidence || '').trim()[0] || '')) ? String(c.evidence).trim()[0] : '';
    players.push({
      name: u.name, ticker: u.ticker, exchange: 'NSE/BSE',
      value_chain_nodes: nodeKeys, cohort, directness,
      ...(sig ? { significance: sig } : {}), ...(ev ? { evidence: ev } : {}),
      role: (c && String(c.role || '').trim()) || '',
      source: u.source || { label: 'Screener', url: u.ticker ? `https://www.screener.in/company/${encodeURIComponent(u.ticker)}/` : '' },
      current: u.current || {}, series: u.series || {},
      ...(u.basis ? { basis: u.basis } : {}),
    });
  }
  if (!players.length) return null;

  // Keep EVERY decomposed node (even with zero listed players — "no clean listed
  // participant found" is a finding, not a reason to drop the node).
  const keptNodes = nodes.map((n) => ({ key: n.key, label: n.label, use: n.use }));
  return { generated_at: new Date().toISOString(), nodes: keptNodes, players };
}
