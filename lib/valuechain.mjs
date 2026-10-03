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
async function webDiscoverNode(industry, node, caps = CAP) {
  if (!jinaConfigured()) return [];
  const kw = node.keywords.slice(0, 3);
  // Multi-route query set following the generic framework (Phases 4B/5/6/8/9/11). The
  // node-type-agnostic listed-player + landscape + authoritative-list queries come first
  // (so normal depth is unchanged); the exchange-filings, orders/news/tenders and
  // primary-document (annual report / investor deck / DRHP) routes are only reached at
  // DEEP depth. caps.nodeQueries decides how many run.
  const queries = [];
  for (const k of kw.slice(0, 2)) queries.push(`${k} companies India listed NSE BSE`);                           // listed players
  queries.push(`${industry} ${node.label} India largest listed companies players operators`);                     // landscape / market share
  queries.push(`${industry} ${node.label} India approved vendor OR manufacturer list OR ALMM OR PLI beneficiary OR market share`); // authoritative lists (Phase 9)
  queries.push(`${kw[0] || node.label} India order OR capacity OR commissioned OR subsidiary site:nseindia.com OR site:bseindia.com`); // exchange filings (Phase 4B)
  queries.push(`${industry} ${node.label} India order win OR contract awarded OR capacity expansion 2025 2026`);   // orders / news / tenders (Phases 8, 11)
  queries.push(`${industry} ${node.label} India annual report OR investor presentation OR DRHP competitors peers`); // primary documents (Phases 5, 6)
  const snippets = []; const urls = new Map();
  for (const q of queries.slice(0, caps.nodeQueries + 1)) {
    let hits = [];
    try { hits = await jinaSearch(q); } catch (_) { hits = []; }
    for (const h of hits) {
      if (h.snippet) snippets.push(`${h.title}: ${h.snippet}`);
      // Weight primary / decision-grade sources (filings, annual reports, investor decks,
      // registries, rating agencies, sector trackers) far above generic pages for reading.
      if (h.url && !/youtube|facebook|twitter|instagram|linkedin/i.test(h.url)) urls.set(h.url, (urls.get(h.url) || 0) + (/\.pdf|annualreport|investor|nseindia|nsearchives|bseindia|sebi|drhp|prospectus|mnre|pib\.gov|crisil|icra|careratings|careedge|ibef|investindia|mercom|jmk/i.test(h.url) ? 3 : 1));
    }
    await sleep(120);
  }
  // read the single best grounding source (report / filing / registry)
  let readText = '';
  const top = [...urls.entries()].sort((a, b) => b[1] - a[1]).slice(0, caps.nodeReads);
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
export async function discoverNodeCandidates(industry, nodes, caps = CAP) {
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
    try { for (const c of await webDiscoverNode(industry, node, caps)) add(c.name, node.key, c.why, 'web'); } catch (_) { /* */ }
    // Route B — Screener keyword search
    for (const kw of node.keywords.slice(0, 3)) {
      let hits = []; try { hits = await screenerSearch(kw); } catch (_) { hits = []; }
      for (const h of (hits || []).slice(0, 4)) if (h && h.name) add(h.name, node.key, '', 'screener');
      await sleep(120);
    }
  }
  return byName;
}

/** Phase 7 — REVERSE-SEARCH THE SUPPLY CHAIN. Start from the major operators and ask
 *  "who supplies / contracts with them?" — a high-yield route for names that per-node
 *  landscape queries miss. Bedrock-extract supplier/participant names from the results.
 *  Deep mode only; empty without Jina. */
async function reverseSupplyDiscover(industry, anchors) {
  if (!jinaConfigured() || !anchors.length) return [];
  const snippets = [];
  for (const a of anchors.slice(0, 3)) {
    for (const q of [`"${a}" supplier OR vendor OR order OR contract ${industry} India`, `"${a}" EPC OR contractor OR component supplier ${industry}`]) {
      let hits = []; try { hits = await jinaSearch(q); } catch (_) { hits = []; }
      for (const h of hits) if (h.snippet) snippets.push(`${h.title}: ${h.snippet}`);
      await sleep(120);
    }
  }
  if (!snippets.length) return [];
  try {
    const out = await callClaudeJSON({
      system: [
        `From web results about suppliers / vendors / contractors to major "${industry}" operators, list EVERY company named that supplies into or operates in this industry (prefer India-relevant; listing is verified later, so do not drop a name for not being called "listed"). Use ONLY the text; never invent. For each: name (as commonly written), why (<=15 words of the actual link seen).`,
        'Return STRICT JSON {"companies":[{"name","why"}]}. Skip purely generic/thematic mentions, not named real companies.',
      ].join('\n'),
      user: `WEB RESULTS:\n${snippets.slice(0, 40).join('\n')}`,
      maxTokens: 1200,
    });
    return (Array.isArray(out.companies) ? out.companies : []).map((c) => ({ name: String(c.name || '').trim(), why: String(c.why || '').trim() })).filter((c) => c.name);
  } catch (_) { return []; }
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

const DK_STOP = new Set(['and', 'the', 'of', 'for', 'to', 'in', 'on', 'a', 'or', 'with', 'value', 'chain', 'node', 'industry', 'companies', 'company', 'sector', 'segment', 'players', 'services']);
/** Fallback keywords from a node label (for additive updates whose stored nodes
 *  predate keyword persistence and whose fresh decompose didn't re-surface the node). */
function deriveKeywords(label) {
  const words = String(label || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter((w) => w && w.length > 2 && !DK_STOP.has(w));
  const uniq = [...new Set(words)].slice(0, 5);
  return uniq.length ? uniq : [String(label || '').trim()].filter(Boolean);
}

/** Build one value-chain player record from a candidate + its classification.
 *  Returns null for cohort-F / directness-0 / unplaced names. Shared by full and
 *  additive modes so their output shape never diverges. */
function buildPlayer(u, c, labelOf) {
  const cohort = c && /^[A-F]$/.test((String(c.cohort || '').trim()[0] || '')) ? String(c.cohort).trim()[0] : '';
  const directness = c && isFinite(+c.directness) ? +c.directness : null;
  let nodeKeys = (c && Array.isArray(c.nodes) ? c.nodes : []).filter((k) => labelOf[k]);
  if (!nodeKeys.length) nodeKeys = (u.node_keys || []).filter((k) => labelOf[k]);
  if (cohort === 'F' || directness === 0 || !nodeKeys.length) return null;
  const sig = c && /^(high|medium|low)$/i.test(String(c.significance || '').trim()) ? String(c.significance).trim().replace(/^./, (m) => m.toUpperCase()) : '';
  const ev = c && /^[A-D]$/.test((String(c.evidence || '').trim()[0] || '')) ? String(c.evidence).trim()[0] : '';
  return {
    name: u.name, ticker: u.ticker, exchange: 'NSE/BSE',
    value_chain_nodes: nodeKeys, cohort, directness,
    ...(sig ? { significance: sig } : {}), ...(ev ? { evidence: ev } : {}),
    role: (c && String(c.role || '').trim()) || '',
    source: u.source || { label: 'Screener', url: u.ticker ? `https://www.screener.in/company/${encodeURIComponent(u.ticker)}/` : '' },
    current: u.current || {}, series: u.series || {},
    ...(u.basis ? { basis: u.basis } : {}),
  };
}

/**
 * Orchestrate. seedPeers = already-scraped core peers (name, ticker, about, current,
 * series) folded in so operators aren't re-fetched/re-discovered.
 *
 * ADDITIVE "update" mode: pass `existing` = the prior report's value_chain
 * ({ nodes, players }). Then the node set is REUSED (never dropped/renamed, so stored
 * classifications stay valid), existing players are KEPT with their numbers refreshed,
 * discovery only FETCHES genuinely-new names, and only those new names are classified.
 * `discovery` = 'deep' runs the framework's FULL multi-route per-node discovery (more
 * queries — exchange filings, orders/news/tenders, primary documents — and more source
 * reads) PLUS a reverse-supply-chain pass, to catch names a normal pass misses. Additive
 * "Update" uses deep so every run digs further. The result can only GROW or refresh —
 * it never regresses.
 *
 * @returns { generated_at, nodes, players } or null.
 */
export async function buildValueChain({ industry, definition, about, seedPeers = [], cap = CAP.fetch, existing = null, discovery = 'normal' }) {
  const additive = !!(existing && Array.isArray(existing.players) && existing.players.length);

  // 1) NODES. Full: decompose fresh. Additive: reuse the existing node set (never
  // drop/rename), recovering keywords from the stored nodes, else a fresh decompose,
  // else derived from the label — and union any genuinely-new nodes.
  let nodes;
  if (existing && Array.isArray(existing.nodes) && existing.nodes.length) {
    const haveKw = existing.nodes.some((n) => Array.isArray(n.keywords) && n.keywords.length);
    const fresh = haveKw ? [] : await decomposeValueChain({ industry, definition, about }).catch(() => []);
    const freshByKey = new Map(fresh.map((n) => [n.key, n]));
    nodes = existing.nodes.map((n) => ({
      key: n.key, label: n.label, use: n.use || (freshByKey.get(n.key) || {}).use || '',
      keywords: (Array.isArray(n.keywords) && n.keywords.length) ? n.keywords
        : ((freshByKey.get(n.key) || {}).keywords || deriveKeywords(n.label)),
    }));
    const existKeys = new Set(existing.nodes.map((n) => n.key));
    for (const f of fresh) if (f.key && !existKeys.has(f.key)) nodes.push(f);
  } else {
    nodes = await decomposeValueChain({ industry, definition, about });
  }
  if (!nodes.length) return null;
  const labelOf = Object.fromEntries(nodes.map((n) => [n.key, n.label]));
  const caps = discovery === 'deep' ? { nodeQueries: 6, nodeReads: 3, fetch: CAP.fetch, marketPages: CAP.marketPages } : CAP;

  // 2) DISCOVER candidates per node across routes.
  const byName = await discoverNodeCandidates(industry, nodes, caps);

  // Backstop route — Screener /market industry universe around an anchor (adds breadth).
  try {
    const anchor = (seedPeers.find((p) => p && p.ticker) || {}).ticker
      || (additive ? (existing.players.find((p) => p && p.ticker) || {}).ticker : '');
    if (anchor) {
      const href = await getCompanyIndustryHref(anchor).catch(() => '');
      if (href) {
        const uni = await mineIndustryUniverse(href, { maxPages: CAP.marketPages }).catch(() => []);
        for (const u of uni) { const k = norm(u.name); if (k && !byName.has(k)) byName.set(k, { name: u.name, nodes: new Set(), why: 'same /market industry', routes: new Set(['market']) }); }
      }
    }
  } catch (_) { /* optional */ }

  // Reverse-supply-chain route (Phase 7) — DEEP only: from the major operators, find who
  // supplies / contracts with them. High yield for names the per-node queries miss.
  if (discovery === 'deep') {
    try {
      const anchors = [...seedPeers, ...(additive ? existing.players : [])]
        .filter((p) => p && p.name).map((p) => p.name).slice(0, 4);
      for (const c of await reverseSupplyDiscover(industry, anchors)) {
        const k = norm(c.name); if (!k) continue;
        if (!byName.has(k)) byName.set(k, { name: c.name, nodes: new Set(), why: c.why, routes: new Set(['reverse']) });
        else byName.get(k).routes.add('reverse');
      }
    } catch (_) { /* optional */ }
  }

  // Names already represented (seed core peers + carried existing players) are not re-fetched.
  const seedByName = new Map();
  for (const p of seedPeers) if (p && p.name) seedByName.set(norm(p.name), p);

  // Additive: carry existing players, refreshing their numbers (from the seed set if
  // the same company, else a no-AI Screener re-fetch). Never dropped.
  const existingByName = new Map();
  const carried = [];
  if (additive) {
    for (const p of existing.players) {
      const k = norm(p.name); if (!k || existingByName.has(k)) continue;
      existingByName.set(k, p);
      const seed = seedByName.get(k);
      let cur = p.current || {}, ser = p.series || {}, src = p.source, basis = p.basis;
      if (seed && seed.current) { cur = seed.current; ser = seed.series || ser; src = seed.source || src; basis = seed.basis || basis; }
      else if (p.ticker) {
        const res = await fetchPeer(p.ticker).catch(() => null);
        if (res && !res.error && res.current) { cur = res.current; ser = res.series || ser; src = res.source || src; basis = res.basis || basis; }
        await sleep(150);
      }
      carried.push({ ...p, current: cur, series: ser, source: src || p.source, ...(basis ? { basis } : {}) });
    }
  }

  // 3) VERIFY + fetch financials for discovered names not already seeded/carried.
  // Most-promising candidates first (web route / multi-route / multi-node) so the
  // fetch budget is never spent on long-tail single-keyword hits first.
  const fetched = [];
  let budget = cap;
  const ranked = [...byName.values()]
    .filter((rec) => !seedByName.has(norm(rec.name)) && !existingByName.has(norm(rec.name)))
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

  // Keep EVERY decomposed node (even with zero listed players). Carry keywords so a
  // later additive update can skip re-decomposing.
  const keptNodes = nodes.map((n) => ({ key: n.key, label: n.label, use: n.use, ...(n.keywords && n.keywords.length ? { keywords: n.keywords } : {}) }));

  if (additive) {
    // Classify ONLY the new names; carried players keep their stored classification.
    let cmap = new Map();
    if (fetched.length) {
      try {
        cmap = await classifyPlayers({ industry, definition, nodes, companies: fetched.map((u) => ({ name: u.name, hintLabels: (u.node_keys || []).map((k) => labelOf[k]).filter(Boolean), why: u.why })) });
      } catch (e) { console.warn('[valuechain] additive classify failed:', e.message); }
    }
    const players = [...carried];
    const seenP = new Set(carried.map((p) => norm(p.name)));
    for (const u of fetched) {
      const k = norm(u.name); if (seenP.has(k)) continue;
      const player = buildPlayer(u, cmap.get(k), labelOf);
      if (player) { players.push(player); seenP.add(k); }
    }
    if (!players.length) return null;
    return { generated_at: new Date().toISOString(), nodes: keptNodes, players };
  }

  // FULL mode (unchanged): fold seed peers into the universe + classify all.
  const universeRaw = [
    ...seedPeers.filter((p) => p && p.ticker).map((p) => ({ name: p.name, ticker: p.ticker, node_keys: [], why: p.about ? String(p.about).slice(0, 160) : '', current: p.current || {}, series: p.series || {}, source: p.source })),
    ...fetched,
  ];
  // De-dupe by normalized name — keep the first (seed entries lead).
  const universe = [];
  const seenU = new Set();
  for (const u of universeRaw) { const k = norm(u.name); if (!k || seenU.has(k)) continue; seenU.add(k); universe.push(u); }
  if (!universe.length) return null;

  let cmap = new Map();
  try {
    cmap = await classifyPlayers({
      industry, definition, nodes,
      companies: universe.map((u) => ({ name: u.name, hintLabels: (u.node_keys || []).map((k) => labelOf[k]).filter(Boolean), why: u.why })),
    });
  } catch (e) { console.warn('[valuechain] classify failed:', e.message); }

  const players = [];
  for (const u of universe) { const player = buildPlayer(u, cmap.get(norm(u.name)), labelOf); if (player) players.push(player); }
  if (!players.length) return null;
  return { generated_at: new Date().toISOString(), nodes: keptNodes, players };
}
