/**
 * lib/discovery.mjs — WIDE, source-grounded peer-candidate engine.
 *
 * The old discovery was one Bedrock call fed the model's memory + ~6 snippets,
 * targeting "6-10" — it named the famous 3 and stopped. This generates a wide
 * candidate pool from THREE independent sources and unions them, then a cheap
 * shortlist bounds the expensive Screener verification (done by the caller):
 *
 *   PRIMARY   web reports read IN FULL -> a per-source LLM PLAYER LEDGER
 *   SECONDARY Bedrock exhaustive own-knowledge enumeration
 *   BACKSTOP  Screener /market industry universe (paginated) around anchor peers
 *
 * Every candidate carries a real business/segment description (never a bare
 * name). Never-fail: each source degrades independently; no hardcoded names.
 */
import { callClaudeJSON } from './llm.mjs';
import { jinaSearch, jinaRead, jinaConfigured } from './jina.mjs';
import { screenerSearch, getCompanyIndustryHref, mineIndustryUniverse } from './screener.mjs';
import { canonicalModel } from './metrics.mjs';

const CAP = {
  searchQueries: 16, urlsToRead: 8, extractCalls: 8, reportReads: 4,
  anchors: 4, universePages: 6, shortlistIndian: 18, shortlistGlobal: 8, shortlistPrivate: 6,
};
const CHUNK = 30000;
const norm = (s) => String(s || '').toLowerCase().replace(/\b(ltd|limited|inc|plc|corp|corporation|co|company|the|group|industries|india|&)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * @returns { segment, definition, candidates:{ indian:[], global:[], private:[] }, trace }
 * where each candidate = { name, products, segment, note, ticker, code?, marketCap?, sources:[] }
 */
export async function discoverCandidates({ query, understanding }) {
  const trace = { synonyms: [], searches: 0, urls: 0, reads: 0, ledger: 0, enumerated: 0, marketHrefs: [], marketUniverse: 0 };

  // 1) synonym / adjacent-product expansion (one cheap call)
  const S = await expandTerms(query, understanding);
  trace.synonyms = S;

  // 2+3) web reports read IN FULL -> player ledger (PRIMARY)
  let ledger = [];
  let definition = '';
  try {
    const { urls, snippets } = await gatherUrls(S, understanding);
    trace.searches = Math.min(buildQueries(S, understanding).length, CAP.searchQueries) + reportQueries(S, understanding).length;
    trace.urls = urls.length;
    const built = await buildLedger(urls, understanding, snippets);
    ledger = built.ledger; definition = built.definition; trace.reads = built.reads;
  } catch (e) { console.warn('[discovery] web/ledger failed:', e.message); }
  trace.ledger = ledger.length;

  // 4) Bedrock exhaustive enumeration (SECONDARY)
  let enumerated = [];
  try { const en = await enumerate(understanding, S, ledger); enumerated = en.companies; if (!definition) definition = en.definition; }
  catch (e) { console.warn('[discovery] enumeration failed:', e.message); }
  trace.enumerated = enumerated.length;

  // 5) Screener /market industry universe (BACKSTOP)
  let market = [];
  try { const mined = await mineMarkets(ledger, enumerated, understanding); market = mined.universe; trace.marketHrefs = mined.hrefs; trace.marketUniverse = market.length; }
  catch (e) { console.warn('[discovery] market backstop failed:', e.message); }

  // 6) merge -> pool (dedupe by normalized name; merge detail)
  const pool = mergePool(ledger, enumerated, market);

  // 7) cheap shortlist to likely true peers (bounds the Screener verification)
  // For an industry query the segment IS the query; for a company query prefer the
  // discovered product definition (the gate matches a product FAMILY, not a name).
  const segment = understanding.segment || (understanding.isCompany ? (definition || query) : query);
  const candidates = await shortlist(pool, { query, segment, definition, S, understanding });

  return { segment: segment || query, definition, candidates, trace };
}

/* ------------------------------------------------------------ 1) synonyms */
async function expandTerms(query, u) {
  const base = [String(query || '').trim()].filter(Boolean);
  if (!jinaConfigured() && !process.env.BEDROCK_API_KEY) return base;
  try {
    const out = await callClaudeJSON({
      system: 'You expand a product/industry into its synonyms and adjacent product terms for web search. Return STRICT JSON {"terms":["...", ...]} — 4-8 concise terms (materials, product variants, technical names). No prose.',
      user: `Query: ${query}\n${u.about ? 'Seed company About: ' + u.about.slice(0, 400) : ''}\nList synonyms / adjacent product terms (e.g. a query like "solar inverters" -> string inverter, micro-inverter, hybrid inverter, PV inverter, power-conditioning unit).`,
      maxTokens: 500,
    });
    const terms = Array.isArray(out.terms) ? out.terms.map((t) => String(t).trim()).filter(Boolean) : [];
    return [...new Set([...base, ...terms])].slice(0, 8);
  } catch (_) { return base; }
}

/* ------------------------------------------------------ 2) query building */
function buildQueries(S, u) {
  const qs = [];
  for (const t of S) {
    qs.push(`${t} companies`, `${t} manufacturers`, `${t} players`, `${t} peers`, `${t} competitors`,
      `${t} market share leaders`, `${t} top companies`, `${t} companies India listed`,
      `${t} industry report`, `global ${t} manufacturers Japan China Europe`);
  }
  if (u.isCompany && u.seedCompany) qs.push(`${u.seedCompany} competitors`, `${u.seedCompany} peers`, `${u.seedCompany} DRHP competitors`, `${u.seedCompany} annual report peers`);
  return [...new Set(qs)];
}
function reportQueries(S, u) {
  const t = S[0] || u.query;
  return [`${t} industry report filetype:pdf`, `${t} initiating coverage brokerage report pdf`, `${t} India annual report pdf`, `${t} market report players pdf`];
}

async function gatherUrls(S, u) {
  const queries = buildQueries(S, u).slice(0, CAP.searchQueries).concat(reportQueries(S, u));
  const seen = new Map();
  const snippets = [];
  for (const q of queries) {
    let hits = [];
    try { hits = await jinaSearch(q); } catch (_) { hits = []; }
    for (const h of hits) {
      if (!h.url || /youtube|facebook|twitter|instagram|linkedin|\.x\.com/i.test(h.url)) continue;
      if (h.snippet) snippets.push(`${h.title}: ${h.snippet}`);
      const key = h.url.split('#')[0].replace(/\/$/, '');
      if (!seen.has(key)) seen.set(key, { url: h.url, title: h.title, pdf: /\.pdf(\?|#|$)/i.test(h.url), score: scoreUrl(h.url) });
    }
  }
  const ranked = [...seen.values()].sort((a, b) => b.score - a.score);
  return { urls: ranked, snippets: snippets.slice(0, 30) };
}
function scoreUrl(u) {
  const s = u.toLowerCase(); let n = 0;
  if (/drhp|prospectus|redherring|annualreport|investor|initiating-coverage/.test(s)) n += 6;
  if (/\.pdf(\?|#|$)/.test(s)) n += 3;
  if (/moneycontrol|screener|equitymaster|business-standard|livemint|economictimes|trendlyne|marketsmojo|icicidirect|motilaloswal|nuvama/.test(s)) n += 4;
  if (/wikipedia|ibef|imarc|mordor|grandview|researchandmarkets|marketsandmarkets|expertmarket/.test(s)) n += 2;
  return n;
}

/* --------------------------------------------- 3) full-read player ledger */
function chunk(text, size = CHUNK) {
  const s = String(text || ''); if (s.length <= size) return s ? [s] : [];
  const out = []; for (let i = 0; i < s.length; i += size - 1000) { out.push(s.slice(i, i + size)); if (i + size >= s.length) break; } return out;
}
async function buildLedger(urls, u, snippets) {
  const ledger = new Map();
  let reads = 0, extractCalls = 0, definition = '';
  const toRead = urls.slice(0, CAP.urlsToRead);
  for (const item of toRead) {
    if (extractCalls >= CAP.extractCalls) break;
    let md = '';
    try { md = await jinaRead(item.url); } catch (_) { md = ''; }
    if (!md) continue;
    reads++;
    for (const ch of chunk(md).slice(0, 2)) {
      if (extractCalls >= CAP.extractCalls) break;
      extractCalls++;
      try {
        const ext = await extractPlayers(ch, u, item.url);
        if (ext.definition && !definition) definition = ext.definition;
        for (const c of ext.companies) mergeLedger(ledger, c, item.url);
      } catch (e) { console.warn('[discovery] extract failed:', e.message); }
    }
  }
  // fold in snippet-only names cheaply? no — ledger is from full reads. snippets feed enumerate.
  return { ledger: [...ledger.values()], definition, reads, snippets };
}
async function extractPlayers(sourceText, u, url) {
  const system = [
    'You are an equity research analyst. From ONE source document, extract EVERY named company positioned in the industry — market leaders, largest/#1/ranked, and any named maker/importer/distributor/integrated player, ACROSS ALL business models. Use ONLY the source text; do not add outside knowledge; never invent tickers.',
    'Return STRICT JSON only: {"definition":"one plain sentence defining the product/industry (or empty)","companies":[{"name","what_it_does":"concrete: what it makes + segment","listed":true|false|null,"ticker":"NSE symbol or primary-exchange ticker if stated, else empty","position":"market-share/rank/positioning if stated, else empty"}]}',
    'Keep every string single-line; no raw double-quotes inside a value.',
  ].join('\n');
  const user = `Industry / product: ${u.segment || u.query}\nSource: ${url}\n\nSOURCE TEXT:\n${sourceText}`;
  const out = await callClaudeJSON({ system, user, maxTokens: 4000 });
  const companies = Array.isArray(out.companies) ? out.companies : [];
  return { definition: String(out.definition || ''), companies };
}
function mergeLedger(ledger, c, url) {
  const name = String(c && c.name || '').trim();
  if (!name || name.length < 2) return;
  const key = norm(name);
  if (!key) return;
  const cur = ledger.get(key) || { name, products: '', segment: '', note: '', ticker: '', listed: null, sources: new Set() };
  if (!cur.products && c.what_it_does) cur.products = String(c.what_it_does).slice(0, 240);
  if (!cur.note && c.position) cur.note = String(c.position).slice(0, 180);
  if (!cur.ticker && c.ticker) cur.ticker = String(c.ticker).trim();
  if (cur.listed == null && typeof c.listed === 'boolean') cur.listed = c.listed;
  cur.sources.add(url);
  ledger.set(key, cur);
}

/* ------------------------------------------------ 4) Bedrock enumeration */
async function enumerate(u, S, ledger) {
  const ledgerNames = ledger.slice(0, 60).map((c) => c.name).join(', ');
  const system = [
    'You are an equity research analyst. Enumerate for RECALL — name EVERY company you know that makes, imports, sources, distributes, or is integrated into the SAME end-product family, across ALL business models (manufacturer, importer/sourcing, trader-distributor, integrated).',
    'Do NOT stop at a round number: if you know 30+, list 30+. INCLUDE diversified groups that make it as ONE segment (a chemicals major that also makes films). A Screener step verifies each name and drops non-listed/non-matching, so ERR TOWARD INCLUSION.',
    'For each: products = what it makes + its relevant segment; note = positioning; business_model = exactly one of "Manufacturer" | "Trader-Distributor" | "Importer-Sourcing" | "Integrated"; ticker HINT = NSE symbol for India, PRIMARY-exchange ticker for global (e.g. 4188.T not a US OTC/ADR), else empty; region = "indian" or "global"; listed = true|false|null.',
    'Return STRICT JSON only: {"definition":"one plain sentence","companies":[{"name","products","segment","note","business_model","ticker","region","listed"}]}',
  ].join('\n');
  const user = [
    `Product family / query: ${u.query}`,
    `Synonyms / adjacent: ${S.join(', ')}`,
    u.about ? `Seed company About: ${u.about.slice(0, 500)}` : '',
    ledgerNames ? `Names already found in reports (extend well beyond these): ${ledgerNames}` : '',
  ].filter(Boolean).join('\n');
  const out = await callClaudeJSON({ system, user, maxTokens: 5000 });
  const companies = (Array.isArray(out.companies) ? out.companies : []).map((c) => ({
    name: String(c.name || '').trim(), products: String(c.products || c.segment || '').trim(),
    segment: String(c.segment || '').trim(), note: String(c.note || '').trim(),
    business_model: canonicalModel(c.business_model), ticker: String(c.ticker || '').trim(),
    region: /global/i.test(c.region) ? 'global' : 'indian',
    listed: typeof c.listed === 'boolean' ? c.listed : null,
  })).filter((c) => c.name);
  return { definition: String(out.definition || ''), companies };
}

/* --------------------------------------------- 5) Screener /market backstop */
async function mineMarkets(ledger, enumerated, understanding) {
  const hrefs = new Set();
  // The seed company's OWN industry — an AI-free anchor (works even if web +
  // Bedrock are down for a company query).
  if (understanding && understanding.seedCode) {
    try { const href = await getCompanyIndustryHref(understanding.seedCode); if (href) hrefs.add(href); } catch (_) { /* skip */ }
  }
  // anchor names: prefer indian listed with a strong signal (report / Bedrock)
  const anchorNames = [];
  if (understanding && understanding.seedCompany) anchorNames.push(understanding.seedCompany);
  for (const c of [...ledger, ...enumerated]) {
    if (c.region === 'global') continue;
    if (anchorNames.length >= CAP.anchors) break;
    if (!anchorNames.some((n) => norm(n) === norm(c.name))) anchorNames.push(c.name);
  }
  for (const name of anchorNames.slice(0, CAP.anchors)) {
    try {
      const hit = (await screenerSearch(name))[0];
      if (!hit) continue;
      const href = await getCompanyIndustryHref(hit.code);
      if (href) hrefs.add(href);
    } catch (_) { /* skip */ }
  }
  const universe = new Map();
  for (const href of hrefs) {
    try {
      const uni = await mineIndustryUniverse(href, { maxPages: CAP.universePages });
      for (const c of uni) { const k = norm(c.name); if (k && !universe.has(k)) universe.set(k, { name: c.name, code: c.code, marketCap: c.marketCap }); }
    } catch (_) { /* skip */ }
  }
  return { hrefs: [...hrefs], universe: [...universe.values()].map((c, i) => ({ ...c, order: i })) };
}

/* ------------------------------------------------------------ 6) merge pool */
function mergePool(ledger, enumerated, market) {
  const pool = new Map();
  const put = (name, patch) => {
    const key = norm(name); if (!key) return;
    const cur = pool.get(key) || { name, products: '', segment: '', note: '', ticker: '', code: '', business_model: '', order: 1e9, region: '', listed: null, sources: [] };
    for (const k of ['products', 'segment', 'note', 'ticker', 'code', 'business_model']) if (!cur[k] && patch[k]) cur[k] = patch[k];
    if (patch.order != null && patch.order < cur.order) cur.order = patch.order;
    if (!cur.region && patch.region) cur.region = patch.region;
    if (cur.listed == null && patch.listed != null) cur.listed = patch.listed;
    if (patch.source) cur.sources.push(patch.source);
    if (patch.origin) cur.sources.push(patch.origin);
    pool.set(key, cur);
  };
  for (const c of ledger) put(c.name, { products: c.products, note: c.note, ticker: c.ticker, listed: c.listed, region: 'indian', origin: 'report' });
  for (const c of enumerated) put(c.name, { products: c.products || c.segment, segment: c.segment, note: c.note, business_model: c.business_model, ticker: c.ticker, region: c.region, listed: c.listed, origin: 'bedrock' });
  for (const c of market) put(c.name, { code: c.code, order: c.order, region: 'indian', listed: true, origin: 'market' });
  return [...pool.values()];
}

/* -------------------------------------------------------------- 7) shortlist */
async function shortlist(pool, ctx) {
  // Always keep report-named + enumerated (they carry signal + detail); the big
  // /market universe is the noisy part we ask Bedrock to filter to the family.
  const keep = new Map();
  const keyOf = (c) => norm(c.name);
  for (const c of pool) if (c.sources.includes('report') || c.sources.includes('bedrock')) keep.set(keyOf(c), c);

  const marketOnly = pool.filter((c) => c.sources.includes('market') && !keep.has(keyOf(c)));
  if (marketOnly.length) {
    try {
      const names = marketOnly.map((c) => c.name);
      const out = await callClaudeJSON({
        system: 'You filter a list of listed companies to those that plausibly make, sell, import, distribute, or are integrated into a given product family (ANY business model). ERR TOWARD INCLUSION — a Screener business-description check verifies each afterwards. Return STRICT JSON {"keep":["<exact names that plausibly belong>"]}.',
        user: `Product family: ${ctx.segment || ctx.query}\nDefinition: ${ctx.definition || '(n/a)'}\nSynonyms: ${(ctx.S || []).join(', ')}\n\nCandidate companies:\n${names.map((n) => `- ${n}`).join('\n')}`,
        maxTokens: 2000,
      });
      const kept = new Set((Array.isArray(out.keep) ? out.keep : []).map(norm));
      for (const c of marketOnly) if (kept.has(keyOf(c))) keep.set(keyOf(c), c);
    } catch (e) {
      console.warn('[discovery] market shortlist failed, keeping biggest by page order:', e.message);
      for (const c of marketOnly.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9)).slice(0, 20)) keep.set(keyOf(c), c);
    }
  }

  // split by region; rank (report-named first, then Screener market-cap order)
  const rank = (c) => (c.sources.includes('report') ? 3 : c.sources.includes('bedrock') ? 2 : 1);
  const all = [...keep.values()].sort((a, b) => rank(b) - rank(a) || (a.order ?? 1e9) - (b.order ?? 1e9));
  const indian = [], global = [], priv = [];
  for (const c of all) {
    const cand = { name: c.name, products: c.products || c.segment || '', segment: c.segment || '', note: c.note || '', ticker: c.ticker || '', code: c.code || '', business_model: c.business_model || '', order: c.order, sources: [...new Set(c.sources)] };
    if (c.region === 'global') { if (global.length < CAP.shortlistGlobal) global.push(cand); }
    else if (c.listed === false && !c.code) { if (priv.length < CAP.shortlistPrivate) priv.push(cand); }
    else if (indian.length < CAP.shortlistIndian) indian.push(cand);
  }
  return { indian, global, private: priv };
}
