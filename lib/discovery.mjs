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
  anchors: 4, universePages: 6, shortlistIndian: 26, shortlistGlobal: 8, shortlistPrivate: 6,
  // /market bootstrap: turn product WORDS into Screener name hits -> industry anchors.
  marketTerms: 8, marketHitsPerTerm: 4, marketIndustries: 6, marketUniverseMax: 220,
};
const CHUNK = 30000;
// Words too generic to be a useful Screener name fragment (they match nothing or everything).
const STOP = new Set(['the', 'and', 'for', 'with', 'into', 'from', 'india', 'indian', 'listed', 'company', 'companies', 'material', 'materials', 'product', 'products', 'grade', 'based', 'type', 'used', 'high', 'thin', 'global', 'market', 'industry', 'sector', 'making', 'maker', 'makers']);
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
  try { const mined = await mineMarkets(ledger, enumerated, understanding, S, query); market = mined.universe; trace.marketHrefs = mined.hrefs; trace.marketUniverse = market.length; }
  catch (e) { console.warn('[discovery] market backstop failed:', e.message); }

  // 6) merge -> pool (dedupe by normalized name; merge detail)
  const pool = mergePool(ledger, enumerated, market);

  // 7) cheap shortlist to likely true peers (bounds the Screener verification)
  // For an industry query the segment IS the query; for a company query prefer the
  // discovered product definition (the gate matches a product FAMILY, not a name).
  const segment = understanding.segment || (understanding.isCompany ? (definition || query) : query);
  const candidates = await shortlist(pool, { query, segment, definition, S, understanding });

  return { segment: segment || query, definition, synonyms: S, candidates, trace };
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
    'List BOTH Indian-listed makers AND global makers — do NOT stop at the global specialists; a niche/specialty grade usually sits inside a broader material industry (e.g. a capacitor-grade film sits within the general polyester/BOPET/BOPP film industry), so name that broader industry\'s listed makers too.',
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

/**
 * Product WORDS from the query + synonyms, usable as Screener NAME fragments.
 * Screener's search matches company NAMES (not descriptions), and real makers
 * often carry the product word in their name (a maker of "… films" or of
 * "… polyesters"), so a word search reaches a listed maker whose /market
 * industry page then yields the WHOLE listed universe — even for an ambiguous
 * industry query with no seed company to anchor on.
 */
function marketSearchTerms(query, S) {
  const words = new Set();
  for (const t of [query, ...(S || [])]) {
    for (const w of String(t || '').split(/[^a-z0-9]+/i)) {
      const x = w.trim().toLowerCase();
      if (x.length >= 4 && !STOP.has(x)) words.add(x);
    }
  }
  return [...words];
}

/* --------------------------------------------- 5) Screener /market backstop */
async function mineMarkets(ledger, enumerated, understanding, S, query) {
  // Each anchor href carries a weight = how many independent signals point at it;
  // we mine the best-supported industries first (the product industry outranks a
  // stray media/other industry an ambiguous word also hit).
  const hrefWeight = new Map();
  const bump = (href, w) => { if (href) hrefWeight.set(href, (hrefWeight.get(href) || 0) + w); };
  const directHits = new Map(); // name-fragment hits added straight to the pool (name+code)

  // The seed company's OWN industry — an AI-free anchor (company query).
  if (understanding && understanding.seedCode) {
    try { bump(await getCompanyIndustryHref(understanding.seedCode), 3); } catch (_) { /* skip */ }
  }
  // (a) anchors from strong-signal Indian candidate names. Prefer Bedrock's
  // enumerated names over the raw web ledger — for an ambiguous query the ledger
  // can be polluted (e.g. movie companies for "films"), and a polluted anchor
  // would weight the WRONG industry; the enumerated makers point at the right one.
  const anchorNames = [];
  if (understanding && understanding.seedCompany) anchorNames.push(understanding.seedCompany);
  for (const c of [...enumerated, ...ledger]) {
    if (c.region === 'global') continue;
    if (anchorNames.length >= CAP.anchors) break;
    if (!anchorNames.some((n) => norm(n) === norm(c.name))) anchorNames.push(c.name);
  }
  for (const name of anchorNames.slice(0, CAP.anchors)) {
    try { const hit = (await screenerSearch(name))[0]; if (hit) bump(await getCompanyIndustryHref(hit.code), 2); }
    catch (_) { /* skip */ }
  }
  // (b) BOOTSTRAP: product WORDS -> Screener name hits -> their industries. This
  // grounds an ambiguous industry query (no seed) into the right listed universe.
  for (const term of marketSearchTerms(query, S).slice(0, CAP.marketTerms)) {
    let hits = [];
    try { hits = await screenerSearch(term); } catch (_) { hits = []; }
    for (const h of hits.slice(0, CAP.marketHitsPerTerm)) {
      if (!directHits.has(h.code)) directHits.set(h.code, { name: h.name, code: h.code });
      try { bump(await getCompanyIndustryHref(h.code), 1); } catch (_) { /* skip */ }
    }
  }

  // Mine the best-supported industries first, bounded by count AND total size.
  // Key the universe by Screener CODE so a name-fragment hit and the same company
  // mined from its industry page collapse to one entry (no duplicate peers).
  const hrefs = [...hrefWeight.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, CAP.marketIndustries);
  const universe = new Map();
  for (const h of directHits.values()) if (h.code && !universe.has(h.code)) universe.set(h.code, { name: h.name, code: h.code });
  for (const href of hrefs) {
    if (universe.size >= CAP.marketUniverseMax) break;
    try {
      const uni = await mineIndustryUniverse(href, { maxPages: CAP.universePages });
      for (const c of uni) { if (c.code && !universe.has(c.code)) universe.set(c.code, { name: c.name, code: c.code }); }
    } catch (_) { /* skip */ }
  }
  return { hrefs, universe: [...universe.values()].map((c, i) => ({ ...c, order: i })) };
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
  // Bound the candidate pool and split by region. There is deliberately NO lossy
  // LLM keep-filter for listed peers: a Screener CODE already means verified-
  // listed, and Stage-2's business-match gate (which reads each company's real
  // Screener About) is the AUTHORITATIVE family filter — a second keep-filter only
  // risks DROPPING real makers (it intermittently dropped Cosmo First). Instead the
  // Indian shortlist is filled in TWO deterministic phases so BOTH kinds of true
  // peer survive:
  //   1) every model-NAMED maker (report/Bedrock) — this is the only way a real
  //      peer that Screener classes OUTSIDE the product's industries reaches the
  //      set (e.g. SRF, under chemicals, not the film industries);
  //   2) then the top verified-listed /market makers by market-cap order within
  //      the best-matched industry (e.g. Cosmo First at order ~10).
  // Private-destined names (unlisted, no code) never reach the gate; they are
  // bounded here and the caller's filterPrivateFamily drops off-family noise.
  const privateDestined = (c) => c.region !== 'global' && c.listed === false && !c.code;
  const strong = (c) => c.sources.includes('report') || c.sources.includes('bedrock');
  const rank = (c) => (c.code ? 4 : 0) + (c.sources.includes('bedrock') ? 2 : 0) + (c.sources.includes('report') ? 1 : 0);
  const byRankOrder = (a, b) => rank(b) - rank(a) || (a.order ?? 1e9) - (b.order ?? 1e9);
  const byOrder = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9);
  const cand = (c) => ({ name: c.name, products: c.products || c.segment || '', segment: c.segment || '', note: c.note || '', ticker: c.ticker || '', code: c.code || '', business_model: c.business_model || '', order: c.order, sources: [...new Set(c.sources)] });

  const keyOf = (c) => norm(c.name);
  const indian = []; const seen = new Set();
  const addIndian = (c) => { const k = keyOf(c); if (k && !seen.has(k) && indian.length < CAP.shortlistIndian) { seen.add(k); indian.push(cand(c)); } };
  const listedIndian = pool.filter((c) => c.region !== 'global' && !privateDestined(c));
  for (const c of listedIndian.filter(strong).sort(byRankOrder)) addIndian(c);        // phase 1: named makers (guaranteed)
  for (const c of listedIndian.filter((c) => !strong(c)).sort(byOrder)) addIndian(c);  // phase 2: top /market makers by cap

  const global = [], priv = [];
  for (const c of pool.filter((c) => c.region === 'global').sort(byRankOrder)) { if (global.length < CAP.shortlistGlobal) global.push(cand(c)); }
  for (const c of pool.filter(privateDestined).sort(byRankOrder)) { if (priv.length < CAP.shortlistPrivate) priv.push(cand(c)); }
  return { indian, global, private: priv };
}
