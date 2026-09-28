/**
 * scripts/research-peers.mjs — the PeerVIP research pipeline (runs in GitHub
 * Actions). Turns a free-text {query, slug} into a full report JSON in the
 * docs/DATA_CONTRACT.md shape, writes it to public/data (the workflow commits
 * it) and POSTs it to /api/progress so KV serves it instantly.
 *
 * DEEP: Stage-1 peer discovery is GROUNDED in real sources via Jina (search +
 * read), not model memory; the outperformer "why" is grounded too. ROBUST:
 * never-fail — every external call retries then skips; a failed peer keeps
 * blanks; each Bedrock stage degrades gracefully, and if AI is fully down we
 * still write a minimal data-only report. We emit ONLY raw peer numbers + AI
 * text (the frontend computes medians/averages/winners).
 *
 * Stages map to window.PeerVIP.STAGES indices 0..6.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { slugify } from '../lib/slug.mjs';
import { callClaudeJSON } from '../lib/llm.mjs';
import {
  resolveScreenerCode, screenerLogin, getCompanyHtml, mapCompany, screenerSource, screenerMaterialCost,
} from '../lib/screener.mjs';
import { fetchGlobalPeer } from '../lib/global.mjs';
import { jinaSearch, jinaRead, jinaConfigured } from '../lib/jina.mjs';
import { METRICS, METRIC_KEYS, median, canonicalModel } from '../lib/metrics.mjs';

const QUERY = (process.env.QUERY || '').trim();
const SLUG = (process.env.SLUG || '').trim() || slugify(QUERY);
const PROGRESS_URL = (process.env.PROGRESS_URL || '').replace(/\/+$/, '');
const PROGRESS_SECRET = process.env.PROGRESS_SECRET || '';
const REPORTS_DIR = path.resolve('public/data/reports');
const INDEX_FILE = path.resolve('public/data/index.json');

// Guardrails (#7): bound peers and Jina reads per run.
const CAP = { indian: 12, global: 6, private: 5, jinaReads: 6 };
const TOK = { discovery: 3500, scoring: 3500, report: 4500 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let currentStage = 0;
let jinaReadsUsed = 0;
let bedrockCalls = 0, bedrockFails = 0;
const citations = new Set();

async function boundedRead(url) {
  if (jinaReadsUsed >= CAP.jinaReads || !url) return '';
  jinaReadsUsed++;
  const md = await jinaRead(url);
  if (md) citations.add(url);
  return md;
}

async function postProgress(stage, state, extra = {}) {
  currentStage = stage;
  console.log(`[stage ${stage}] ${state}${extra.error ? ' — ' + extra.error : ''}`);
  if (!PROGRESS_URL) return;
  try {
    await fetch(`${PROGRESS_URL}/api/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-progress-secret': PROGRESS_SECRET },
      body: JSON.stringify({ slug: SLUG, stage, state, ...extra }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) { console.warn('postProgress failed:', e.message); }
}

async function main() {
  if (!QUERY) throw new Error('QUERY env is required');
  console.log(`Researching "${QUERY}" -> slug "${SLUG}"  (jina=${jinaConfigured() ? 'on' : 'off'})`);

  const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE || undefined });
  // PW_INSECURE is a local-only test knob (unset in CI) for sandboxes whose proxy
  // intercepts TLS; production runs validate certs normally.
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', ignoreHTTPSErrors: !!process.env.PW_INSECURE });
  const page = await context.newPage();
  try {
    const loggedIn = await screenerLogin(page);
    console.log(loggedIn ? 'Screener: logged in.' : 'Screener: anonymous (no/failed creds).');

    await postProgress(0, 'running');
    const understanding = await understandBusiness(page);

    await postProgress(1, 'running');
    const grounding = await groundDiscovery(understanding);
    const peerPlan = await findPeers(understanding, grounding);

    await postProgress(2, 'running');
    const { indian, movedToPrivate } = await fetchIndianFinancials(page, peerPlan.peers.indian || []);

    await postProgress(3, 'running');
    const global = await fetchGlobalPeers(peerPlan.peers.global || []);

    const privateList = normalizePrivate([...(peerPlan.peers.private || []), ...movedToPrivate]);

    await postProgress(4, 'running');
    const medianTable = computeMedianTable([...indian, ...global]);
    const coverage = {
      peers_total: indian.length + global.length + privateList.length,
      with_full_financials: indian.filter((p) => p.current && p.current.ebitda_margin != null).length,
      confidence: indian.length >= 5 ? 'high' : indian.length >= 3 ? 'medium' : 'low',
    };

    await postProgress(5, 'running');
    const whyGrounding = await groundOutliers({ indian, global }, medianTable);
    const verdict = await scoreOutperformer(understanding, { indian, global, private: privateList }, medianTable, whyGrounding);

    await postProgress(6, 'running');
    const onePager = await buildReport(understanding, { indian, global, private: privateList }, medianTable, verdict);

    const report = assemble({ understanding, peerPlan, indian, global, private: privateList, verdict, onePager, coverage });
    writeOutputs(report);
    await postFinal(report);
    console.log(`Done: ${indian.length} indian, ${global.length} global, ${privateList.length} private. Bedrock ${bedrockCalls - bedrockFails}/${bedrockCalls} ok, jinaReads ${jinaReadsUsed}.`);
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ------------------------------------------------------------- Stage 0 */
async function understandBusiness(page) {
  const seed = await resolveScreenerCode(QUERY).catch(() => null);
  const isCompany = !!seed && closeName(seed.name, QUERY);
  let about = '', pros = [], cons = [], screenerPeers = [], seedCompany = '', seedId = null;
  if (isCompany) {
    seedCompany = seed.name; seedId = seed.id;
    const res = await getCompanyHtml(page, seed.code).catch(() => null);
    if (res) {
      const m = mapCompany(res.html);
      about = m.about || ''; pros = m.pros || []; cons = m.cons || []; screenerPeers = m.peers || [];
    }
  }
  return { query: QUERY, isCompany, seedCompany, seedCode: seed ? seed.code : null, seedId, segment: isCompany ? '' : QUERY, about, pros, cons, screenerPeers };
}

/* ------------------------------------------------------------- Stage 1: grounding */
async function groundDiscovery(u) {
  const subject = u.isCompany ? u.seedCompany : (u.segment || u.query);
  const queries = u.isCompany
    ? [`${u.seedCompany} competitors peers`, `${u.seedCompany} DRHP annual report competitors`, `${subject} listed companies India`, `${subject} global players market share`]
    : [`${subject} listed companies India`, `${subject} global players companies`, `${subject} industry report players market share`, `${subject} manufacturers importers distributors`];
  const snippets = [];
  const urls = [];
  for (const q of queries) {
    const hits = await jinaSearch(q);
    for (const h of hits.slice(0, 4)) { snippets.push(`${h.title}: ${h.snippet}`); if (h.url) urls.push(h.url); }
    if (snippets.length > 24) break;
  }
  // read the most promising 2-3 sources (bounded by the global read cap)
  const seen = new Set();
  const reads = [];
  for (const url of rankUrls(urls)) {
    if (reads.length >= 3) break;
    if (seen.has(url)) continue; seen.add(url);
    const md = await boundedRead(url);
    if (md) reads.push({ url, md: md.slice(0, 6000) });
  }
  return { snippets: snippets.slice(0, 24), reads };
}

function rankUrls(urls) {
  const score = (u) => {
    const s = u.toLowerCase();
    let n = 0;
    if (/drhp|prospectus|redherring|annualreport|investor/.test(s)) n += 5;
    if (/moneycontrol|screener|equitymaster|business-standard|livemint|economictimes|trendlyne|marketsmojo/.test(s)) n += 3;
    if (/wikipedia|ibef|researchandmarkets|mordor|grandview|imarc/.test(s)) n += 2;
    if (/\.pdf$/.test(s)) n += 1;
    return n;
  };
  return [...new Set(urls)].sort((a, b) => score(b) - score(a));
}

/* ------------------------------------------------------------- Stage 1: discovery */
async function findPeers(u, grounding) {
  const system = [
    'You are an equity research analyst building a TRUE peer set for a company or industry, grounded in the sources provided.',
    'TRUE peers = companies in the SAME end-business, INCLUDING different business models — a manufacturer, an importer/sourcing player, a trader-distributor, and an integrated player are ALL peers if they sell the same end-product. An importer with far higher margins than the manufacturers is a CRITICAL include, not an exclude. Do NOT just copy a stock screener\'s peer list; cast a wide net (missing a peer is worse than a marginal include).',
    'Split into Indian listed, Global listed, and Private/unlisted. Classify listed-vs-private correctly (Indian listing is verified on Screener afterwards).',
    'business_model MUST be exactly one of: "Manufacturer", "Trader-Distributor", "Importer-Sourcing", "Integrated" (a parenthetical qualifier is allowed, e.g. "Integrated (backward)").',
    'For each peer, "provenance" = one short line on WHY it is a peer + where you found it (e.g. "named in <source>").',
    'Return STRICT JSON only, no prose:',
    '{"segment":"...","definition":"one plain sentence anyone understands","peers":{"indian":[{"name","ticker","business_model","products","note","provenance"}],"global":[{"name","country","business_model","products","note","provenance"}],"private":[{"name","business_model","products","note","provenance"}]}}',
  ].join('\n');
  const user = [
    `QUERY: ${u.query}`,
    u.isCompany ? `This is a COMPANY. Anchor/seed company: ${u.seedCompany}` : 'This is an INDUSTRY / segment query.',
    u.about ? `\nSeed company "About" (Screener):\n${u.about}` : '',
    u.pros.length ? `\nPros: ${u.pros.join('; ')}` : '',
    u.cons.length ? `\nCons: ${u.cons.join('; ')}` : '',
    grounding.snippets.length ? `\nWeb search snippets:\n${grounding.snippets.map((s) => `- ${s}`).join('\n')}` : '',
    grounding.reads.length ? `\nSource extracts:\n${grounding.reads.map((r) => `From ${r.url}:\n${r.md}`).join('\n\n')}` : '',
    '\nInclude the seed company itself if listed. Aim for 6–12 Indian, 3–6 Global, 2–5 Private peers.',
  ].filter(Boolean).join('\n');

  let out = null;
  try { out = await bedrock({ system, user, maxTokens: TOK.discovery }); } catch (e) { console.warn('discovery failed:', e.message); }
  if (!out || !out.peers) return fallbackPeerPlan(u);

  const clip = (arr, n) => (Array.isArray(arr) ? arr : []).slice(0, n).map((p) => ({
    ...p, business_model: canonicalModel(p.business_model), note: withProvenance(p.note, p.provenance),
  }));
  return {
    segment: out.segment || u.segment || u.query,
    definition: out.definition || '',
    peers: { indian: clip(out.peers.indian, CAP.indian + 3), global: clip(out.peers.global, CAP.global + 3), private: clip(out.peers.private, CAP.private + 3) },
    seedCompany: u.seedCompany, isCompany: u.isCompany,
  };
}

// note is the only rendered free-text field on a peer, so fold provenance in.
function withProvenance(note, provenance) {
  const n = String(note || '').trim(); const p = String(provenance || '').trim();
  if (!p) return n;
  return n ? `${p} · ${n}` : p;
}

function fallbackPeerPlan(u) {
  // AI down: seed the peer set from the seed company + Screener's peer names.
  const indian = [];
  if (u.seedCompany) indian.push({ name: u.seedCompany, business_model: 'Manufacturer', products: '', note: 'seed company' });
  for (const n of u.screenerPeers || []) indian.push({ name: n, business_model: 'Manufacturer', products: '', note: 'Screener peer' });
  return { segment: u.segment || u.query, definition: '', peers: { indian, global: [], private: [] }, seedCompany: u.seedCompany, isCompany: u.isCompany };
}

/* ------------------------------------------------------------- Stage 2 */
async function fetchIndianFinancials(page, plan) {
  const indian = [], movedToPrivate = [];
  const seen = new Set();
  for (const p of plan) {
    if (indian.length >= CAP.indian) break;
    const name = String(p.name || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    try {
      const hit = await resolveScreenerCode(name);
      if (!hit) { movedToPrivate.push(p); continue; }
      const res = await getCompanyHtml(page, hit.code);
      if (!res) { movedToPrivate.push(p); continue; }
      const m = mapCompany(res.html);
      if (!m.listed) { movedToPrivate.push(p); continue; }
      const current = pickMetrics(m.current);
      const series = m.series || {};
      // material cost (gross margin / raw material %) from the schedules endpoint
      try {
        const mc = await screenerMaterialCost(hit.id);
        if (mc) {
          if (current.rm_cost_pct == null) current.rm_cost_pct = mc.rm_cost_pct;
          if (current.gross_margin == null) current.gross_margin = mc.gross_margin;
        }
      } catch (_) { /* optional */ }
      indian.push({
        name: m.name || name,
        ticker: hit.code,
        ...(closeName(hit.name, QUERY) ? { is_seed: true } : {}),
        business_model: canonicalModel(p.business_model),
        products: p.products || '',
        note: p.note || '',
        source: screenerSource(hit.code),
        current, series,
      });
      console.log(`  indian: ${m.name || name} (${hit.code}) ${current.ebitda_margin != null ? '✓' : '~'} ${Object.keys(current).length}/26`);
    } catch (e) {
      console.warn(`  indian ${name} failed: ${e.message}`);
      movedToPrivate.push(p);
    }
    await sleep(300);
  }
  return { indian, movedToPrivate };
}

/* ------------------------------------------------------------- Stage 3 */
async function fetchGlobalPeers(plan) {
  const out = [];
  const seen = new Set();
  for (const p of plan) {
    if (out.length >= CAP.global) break;
    const name = String(p.name || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    let g = { current: {}, series: {}, source: { label: 'web', url: '' } };
    try { g = await fetchGlobalPeer(name); } catch (e) { console.warn(`  global ${name} failed: ${e.message}`); }
    out.push({
      name,
      country: p.country || '',
      business_model: canonicalModel(p.business_model),
      products: p.products || '',
      note: p.note || '',
      source: g.source && g.source.url ? g.source : { label: p.country || 'Web', url: '' },
      current: pickMetrics(g.current || {}),
      series: g.series || {},
    });
    console.log(`  global: ${name} ${g.ticker ? '(' + g.ticker + ')' : ''} ${Object.keys(g.current || {}).length} metrics`);
    await sleep(200);
  }
  return out;
}

function normalizePrivate(plan) {
  const seen = new Set();
  const out = [];
  for (const p of plan) {
    const name = String(p.name || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({
      name,
      business_model: canonicalModel(p.business_model),
      products: p.products || '',
      note: p.note || '',
      source: p.source && p.source.url ? p.source : { label: 'Web', url: '' },
    });
    if (out.length >= CAP.private) break;
  }
  return out;
}

/* ------------------------------------------------------------- Stage 4 */
function computeMedianTable(peers) {
  const table = {};
  for (const k of METRIC_KEYS) table[k] = median(peers.map((p) => (p.current ? p.current[k] : null)));
  return table;
}

/* ------------------------------------------------------------- Stage 5: why-engine grounding */
async function groundOutliers({ indian, global }, medianTable) {
  const peers = [...indian, ...global];
  const names = new Set();
  for (const key of ['ebitda_margin', 'roce', 'rev_cagr_3y', 'pat_margin']) {
    const med = medianTable[key];
    if (med == null) continue;
    for (const p of peers) {
      const v = p.current && p.current[key];
      if (typeof v !== 'number') continue;
      if (v >= med * 1.5 || (med > 0 && v <= med * 0.55)) names.add(p.name);
    }
  }
  const picked = [...names].slice(0, 3);
  const grounded = [];
  for (const name of picked) {
    const hits = await jinaSearch(`why ${name} high margin OR business model competitive advantage`);
    let md = '';
    if (hits[0] && hits[0].url) md = await boundedRead(hits[0].url);
    grounded.push({ name, snippet: (hits[0] && hits[0].snippet) || '', extract: md.slice(0, 3000) });
  }
  return grounded;
}

/* ------------------------------------------------------------- Stage 5: scoring */
async function scoreOutperformer(u, peers, medianTable, whyGrounding) {
  const system = [
    'You are an equity research analyst. From the peer financials + peer medians (+ grounded notes on the outliers), crown ONE outperformer and rank the peer set.',
    'The reason a company outperforms is OPEN-ENDED free text — the ACTUAL driver for THIS company grounded in the sources (asset-light sourcing, pricing power, premium/branded mix, backward/forward integration, export share, cost leadership, distribution moat, working-capital edge, niche product, scale, a one-off, or a mix). NEVER pick from a fixed menu; if there is no clean single driver, say "a mix of factors" honestly.',
    'Score each peer 0–100 across the parameters; rank (1 = outperformer). strengths = the metrics where it clearly leads. Add a short per-peer "reason".',
    'Return STRICT JSON only:',
    '{"outperformer":{"company","bucket":"indian|global|private","headline":"one line","reason":"free text (grounded)","india_vs_global":"one honest line"},"scorecard":{"ranking":[{"company","bucket","score":0-100,"rank","strengths":["..."],"reason":"free text"}]}}',
  ].join('\n');
  const user = [
    `Segment: ${u.segment || QUERY}`,
    `\nPeer medians (context only — do NOT emit): ${compactObj(medianTable)}`,
    `\nPeers:\n${peerTableText(peers)}`,
    whyGrounding.length ? `\nGrounded notes on outliers (from web sources):\n${whyGrounding.map((g) => `- ${g.name}: ${g.snippet}${g.extract ? ' | ' + g.extract.slice(0, 600) : ''}`).join('\n')}` : '',
    '\nCrown the peer whose numbers genuinely stand out, and explain WHY in plain language grounded in the notes above.',
  ].filter(Boolean).join('\n');

  let out = null;
  try { out = await bedrock({ system, user, maxTokens: TOK.scoring }); } catch (e) { console.warn('scoring failed:', e.message); }
  if (!out || !out.outperformer) return fallbackVerdict(peers, medianTable);

  const ranking = Array.isArray(out.scorecard && out.scorecard.ranking) ? out.scorecard.ranking : [];
  ranking.sort((a, b) => (a.rank || 99) - (b.rank || 99));
  ranking.forEach((r, i) => { r.rank = r.rank || i + 1; r.score = clampScore(r.score); r.strengths = Array.isArray(r.strengths) ? r.strengths.slice(0, 6) : []; });
  return { outperformer: out.outperformer, scorecard: { ranking } };
}

function fallbackVerdict(peers, medianTable) {
  // AI down: crown the highest EBITDA-margin peer; honest "mix of factors".
  const all = [...(peers.indian || []), ...(peers.global || [])];
  let best = null;
  for (const p of all) { const v = p.current && p.current.ebitda_margin; if (typeof v === 'number' && (!best || v > best.v)) best = { p, v }; }
  const company = best ? best.p.name : ((all[0] && all[0].name) || '');
  const bucket = best && (peers.global || []).includes(best.p) ? 'global' : 'indian';
  const ranking = all
    .map((p) => ({ p, v: (p.current && p.current.ebitda_margin) }))
    .sort((a, b) => (b.v || -1) - (a.v || -1))
    .map((x, i) => ({ company: x.p.name, bucket: (peers.global || []).includes(x.p) ? 'global' : 'indian', score: Math.max(20, 90 - i * 8), rank: i + 1, strengths: [], reason: 'Ranked by EBITDA margin (automated fallback — AI scoring was unavailable).' }));
  return {
    outperformer: { company, bucket, headline: best ? `Highest EBITDA margin in the set (~${best.v}%)` : 'Peer set assembled', reason: 'a mix of factors (automated fallback — AI reasoning was unavailable this run; re-research to get the grounded driver).', india_vs_global: '' },
    scorecard: { ranking },
  };
}

/* ------------------------------------------------------------- Stage 6 */
async function buildReport(u, peers, medianTable, verdict) {
  const system = [
    'You are writing a plain-language one-pager for a peer-benchmarking dashboard. Output STRICT JSON only.',
    'Use ONLY these block types (exact field names — the renderer is strict): callout{tone:"good|warn|info|bad",title,text}, kpis{items:[{label,value,sub?}]}, bars{unit?,items:[{label,value}]}, trend{unit?,years:[...],series:[{label,values:[...]}]}, donut{items:[{label,value}]}, table{columns:[...],rows:[[...]]}. In a trend block, "years" is the x-axis labels and each series has "label" + a "values" array aligned to years (null allowed).',
    'section.icon is one of: sparkles, chart, trophy, trend, donut, table, globe, money, flag.',
    'Shape: {"report":{"title","summary","sections":[{"title","icon","blocks":[...]}]}}',
    'Make it visual and concrete: an outperformer callout+kpis, a margins/returns bars block, a trend block if trends exist, a business-model donut, and a "peer set at a glance" table. Keep numbers consistent with the data given. No jargon.',
  ].join('\n');
  const user = [
    `Segment: ${u.segment || QUERY}`,
    `Outperformer: ${verdict.outperformer && verdict.outperformer.company} — ${verdict.outperformer && verdict.outperformer.reason}`,
    `\nPeer medians: ${compactObj(medianTable)}`,
    `\nPeers:\n${peerTableText(peers)}`,
  ].join('\n');

  let out = null;
  try { out = await bedrock({ system, user, maxTokens: TOK.report }); } catch (e) { console.warn('report failed:', e.message); }
  const clean = out && out.report ? sanitizeReport(out.report, u) : { title: '', summary: '', sections: [] };
  if (!clean.sections.length) return minimalReport(u, peers, verdict); // never leave the Report tab empty
  return clean;
}

/** Data-only one-pager (no AI) — the Stage-6 fallback. */
function minimalReport(u, peers, verdict) {
  const all = [...(peers.indian || []), ...(peers.global || [])];
  const bars = all.filter((p) => p.current && p.current.ebitda_margin != null)
    .sort((a, b) => b.current.ebitda_margin - a.current.ebitda_margin)
    .slice(0, 10).map((p) => ({ label: p.name, value: p.current.ebitda_margin }));
  const bm = {};
  for (const p of all.concat(peers.private || [])) { const k = bmBucket(p.business_model); bm[k] = (bm[k] || 0) + 1; }
  const rows = all.filter((p) => p.current).slice(0, 12).map((p) => [p.name, fmtNum(p.current.revenue), fmtNum(p.current.ebitda_margin), fmtNum(p.current.roce)]);
  const sections = [];
  sections.push({ title: 'The peer set', icon: 'sparkles', blocks: [{ type: 'callout', tone: 'info', title: verdict.outperformer.company || 'Peer set', text: verdict.outperformer.reason || 'AI narrative was unavailable this run — the tables below are live data. Use Refresh to re-run.' }] });
  if (bars.length) sections.push({ title: 'EBITDA margin across peers', icon: 'chart', blocks: [{ type: 'bars', unit: '%', items: bars }] });
  if (Object.keys(bm).length) sections.push({ title: 'Business-model split', icon: 'donut', blocks: [{ type: 'donut', items: Object.entries(bm).map(([label, value]) => ({ label, value })) }] });
  if (rows.length) sections.push({ title: 'The peer set at a glance', icon: 'table', blocks: [{ type: 'table', columns: ['Company', 'Revenue (Rs Cr)', 'EBITDA %', 'ROCE %'], rows }] });
  return { title: `${titleCase(u.segment || QUERY)} — Peer Benchmarking`, summary: 'Live peer financials from Screener + global sources.', sections };
}

/* ------------------------------------------------------------- assemble / io */
function assemble({ understanding, peerPlan, indian, global, private: priv, verdict, onePager, coverage }) {
  const segment = peerPlan.segment || understanding.segment || QUERY;
  const seedCompany = understanding.seedCompany || (indian[0] && indian[0].name) || '';
  const name = understanding.isCompany && seedCompany ? seedCompany : titleCase(segment);
  return {
    meta: {
      slug: SLUG, name, type: understanding.isCompany ? 'company' : 'industry', query: QUERY,
      seed_company: seedCompany, segment,
      definition: peerPlan.definition || '',
      generated_at: new Date().toISOString(), sample: false, coverage,
    },
    outperformer: {
      company: (verdict.outperformer && verdict.outperformer.company) || (indian[0] && indian[0].name) || '',
      bucket: (verdict.outperformer && verdict.outperformer.bucket) || 'indian',
      headline: (verdict.outperformer && verdict.outperformer.headline) || '',
      reason: (verdict.outperformer && verdict.outperformer.reason) || '',
      india_vs_global: (verdict.outperformer && verdict.outperformer.india_vs_global) || '',
    },
    metrics: METRICS,
    peers: { indian, global, private: priv },
    scorecard: verdict.scorecard || { ranking: [] },
    report: onePager,
    sources: collectSources(indian, global),
  };
}

function writeOutputs(report) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, `${SLUG}.json`), JSON.stringify(report, null, 2) + '\n');
  let index = { reports: [] };
  try { index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch (_) { /* fresh */ }
  if (!Array.isArray(index.reports)) index.reports = [];
  const entry = {
    slug: SLUG, name: report.meta.name, type: report.meta.type, query: QUERY,
    seed_company: report.meta.seed_company,
    aliases: buildAliases(QUERY, report.meta.segment, report.meta.seed_company, [...report.peers.indian, ...report.peers.global, ...report.peers.private]),
    updated_at: report.meta.generated_at, peer_count: report.meta.coverage.peers_total, sample: false,
  };
  const i = index.reports.findIndex((r) => r.slug === SLUG);
  if (i >= 0) index.reports[i] = entry; else index.reports.push(entry);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + '\n');
  console.log(`Wrote reports/${SLUG}.json and index.json`);
}

async function postFinal(report) {
  if (!PROGRESS_URL) return;
  try {
    const res = await fetch(`${PROGRESS_URL}/api/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-progress-secret': PROGRESS_SECRET },
      body: JSON.stringify({ slug: SLUG, stage: 6, state: 'done', report }),
      signal: AbortSignal.timeout(30000),
    });
    console.log(`Posted final report to KV: HTTP ${res.status}`);
  } catch (e) { console.warn('postFinal failed:', e.message); }
}

/* --------------------------------------------------------------- helpers */
async function bedrock(args) { bedrockCalls++; try { return await callClaudeJSON(args); } catch (e) { bedrockFails++; throw e; } }
function pickMetrics(obj) {
  const out = {};
  for (const k of METRIC_KEYS) if (obj && typeof obj[k] === 'number' && isFinite(obj[k])) out[k] = obj[k];
  return out;
}
function clampScore(s) { const n = Number(s); return isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0; }
function closeName(a, b) {
  const na = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nb = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return !!na && !!nb && (na.includes(nb) || nb.includes(na));
}
function titleCase(s) { return String(s || '').replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1)); }
function compactObj(o) { return Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(', '); }
function fmtNum(v) { return (typeof v === 'number' && isFinite(v)) ? String(Math.round(v * 10) / 10) : '—'; }
const BM4 = ['Manufacturer', 'Trader-Distributor', 'Importer-Sourcing', 'Integrated'];
function bmBucket(m) { const f = String(m || '').split(/[\s(]/)[0]; return BM4.includes(f) ? f : 'Other'; }
function peerTableText(peers) {
  const line = (p, bucket) => {
    const cur = p.current || {};
    const nums = METRIC_KEYS.filter((k) => cur[k] != null).map((k) => `${k}=${cur[k]}`).join(', ');
    const trend = Object.keys(p.series || {}).filter((k) => (p.series[k].values || []).some((v) => v != null));
    return `- [${bucket}] ${p.name} (${p.business_model}${p.country ? ', ' + p.country : ''}): ${nums || 'no financials'}${trend.length ? ` | trends: ${trend.join(',')}` : ''}`;
  };
  return [
    ...(peers.indian || []).map((p) => line(p, 'indian')),
    ...(peers.global || []).map((p) => line(p, 'global')),
    ...(peers.private || []).map((p) => `- [private] ${p.name} (${p.business_model}): unlisted, no public financials`),
  ].join('\n');
}
function collectSources(indian, global) {
  const out = [], seen = new Set();
  for (const p of [...indian, ...global]) {
    const s = p.source;
    if (s && s.url && !seen.has(s.url)) { seen.add(s.url); out.push({ label: `${s.label} — ${p.name}`, url: s.url }); }
  }
  for (const url of citations) { if (!seen.has(url)) { seen.add(url); out.push({ label: sourceLabel(url), url }); } }
  out.push({ label: 'Screener.in', url: 'https://www.screener.in/' });
  return out.slice(0, 16);
}
function sourceLabel(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return 'source'; } }
function buildAliases(query, segment, seed, peers) {
  const set = new Set();
  [query, segment, seed].forEach((s) => { if (s) set.add(String(s).toLowerCase()); });
  for (const p of peers) if (p && p.name) set.add(String(p.name).toLowerCase());
  return [...set].slice(0, 24);
}
const ALLOWED_BLOCKS = new Set(['callout', 'kpis', 'bars', 'trend', 'donut', 'table']);
const ALLOWED_ICONS = new Set(['sparkles', 'chart', 'trophy', 'trend', 'donut', 'table', 'globe', 'money', 'flag']);
function normalizeBlock(b) {
  if (!b || !ALLOWED_BLOCKS.has(b.type)) return null;
  if (b.type === 'trend') {
    const years = Array.isArray(b.years) ? b.years : (Array.isArray(b.x) ? b.x : []);
    const series = (Array.isArray(b.series) ? b.series : [])
      .map((s) => ({ label: String(s.label || s.name || ''), values: Array.isArray(s.values) ? s.values : [] }))
      .filter((s) => s.values.some((v) => v != null));
    if (!years.length || !series.length) return null;
    return { type: 'trend', unit: b.unit || '', years, series };
  }
  return b;
}
function sanitizeReport(report, u) {
  const sections = Array.isArray(report.sections) ? report.sections : [];
  const clean = sections.map((s) => ({
    title: String(s.title || ''),
    icon: ALLOWED_ICONS.has(s.icon) ? s.icon : 'chart',
    blocks: (Array.isArray(s.blocks) ? s.blocks : []).map(normalizeBlock).filter(Boolean),
  })).filter((s) => s.blocks.length);
  return { title: String(report.title || `${titleCase(u.segment || QUERY)} — Peer Benchmarking`), summary: String(report.summary || ''), sections: clean };
}

main().catch(async (err) => {
  console.error('FATAL:', err && err.stack ? err.stack : err);
  await postProgress(currentStage, 'failed', { error: String((err && err.message) || 'research failed') });
  process.exit(1);
});
