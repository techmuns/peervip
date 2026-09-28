/**
 * scripts/research-peers.mjs — the PeerVIP research pipeline (runs in GitHub
 * Actions). Turns a free-text {query, slug} into a full report JSON in the
 * docs/DATA_CONTRACT.md shape, writes it to public/data (the workflow commits
 * it) and POSTs it to /api/progress so KV serves it instantly.
 *
 * Never-fail: every external call retries then skips; a peer that can't be
 * fetched keeps blanks; on a fatal error we POST {state:'failed', error}. The
 * frontend computes medians/averages/winners — we emit ONLY raw peer numbers +
 * AI verdict/reason/report text (never precomputed aggregates).
 *
 * Stages map to window.PeerVIP.STAGES indices 0..6.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { slugify } from '../lib/slug.mjs';
import { callClaudeJSON } from '../lib/llm.mjs';
import {
  resolveScreenerCode, screenerSearch, screenerLogin, getCompanyHtml, mapCompany, screenerSource,
} from '../lib/screener.mjs';
import { fetchGlobalPeer } from '../lib/global.mjs';
import { METRICS, METRIC_KEYS, median, canonicalModel } from '../lib/metrics.mjs';

const QUERY = (process.env.QUERY || '').trim();
const SLUG = (process.env.SLUG || '').trim() || slugify(QUERY);
const PROGRESS_URL = (process.env.PROGRESS_URL || '').replace(/\/+$/, '');
const PROGRESS_SECRET = process.env.PROGRESS_SECRET || '';
const REPORTS_DIR = path.resolve('public/data/reports');
const INDEX_FILE = path.resolve('public/data/index.json');

const CAP = { indian: 10, global: 5, private: 5 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let currentStage = 0;

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
  console.log(`Researching "${QUERY}" -> slug "${SLUG}"`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });
  const page = await context.newPage();
  let report;
  try {
    const loggedIn = await screenerLogin(page);
    console.log(loggedIn ? 'Screener: logged in.' : 'Screener: anonymous (no/failed creds).');

    // Stage 0 — Understanding the business ------------------------------------
    await postProgress(0, 'running');
    const understanding = await understandBusiness(page);

    // Stage 1 — Finding true peers (Bedrock #1) -------------------------------
    await postProgress(1, 'running');
    const peerPlan = await findPeers(understanding);

    // Stage 2 — Screener financials for Indian peers --------------------------
    await postProgress(2, 'running');
    const { indian, movedToPrivate } = await fetchIndianFinancials(page, peerPlan.peers.indian || []);

    // Stage 3 — Global peers --------------------------------------------------
    await postProgress(3, 'running');
    const global = await fetchGlobalPeers(peerPlan.peers.global || []);

    const privateList = normalizePrivate([...(peerPlan.peers.private || []), ...movedToPrivate]);

    // Stage 4 — Medians (AI context only; NOT emitted) ------------------------
    await postProgress(4, 'running');
    const medianTable = computeMedianTable([...indian, ...global]);
    const coverage = {
      peers_total: indian.length + global.length + privateList.length,
      with_full_financials: indian.filter((p) => p.current && p.current.ebitda_margin != null).length,
      confidence: indian.length >= 4 ? 'medium' : 'low',
    };

    // Stage 5 — Scoring the outperformer (Bedrock #2) -------------------------
    await postProgress(5, 'running');
    const verdict = await scoreOutperformer(understanding, { indian, global, private: privateList }, medianTable);

    // Stage 6 — Building the report (Bedrock #3) ------------------------------
    await postProgress(6, 'running');
    const onePager = await buildReport(understanding, { indian, global, private: privateList }, medianTable, verdict);

    report = assemble({ understanding, peerPlan, indian, global, private: privateList, verdict, onePager, coverage });
    writeOutputs(report);
    await postFinal(report);
    console.log(`Done: ${indian.length} indian, ${global.length} global, ${privateList.length} private.`);
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ------------------------------------------------------------- Stage 0 */
async function understandBusiness(page) {
  const seed = await resolveScreenerCode(QUERY).catch(() => null);
  const isCompany = !!seed && closeName(seed.name, QUERY);
  let about = '', pros = [], cons = [], screenerPeers = [], seedCompany = '';
  if (isCompany) {
    seedCompany = seed.name;
    const res = await getCompanyHtml(page, seed.code).catch(() => null);
    if (res) {
      const m = mapCompany(res.html);
      about = m.about || ''; pros = m.pros || []; cons = m.cons || []; screenerPeers = m.peers || [];
    }
  }
  const segment = isCompany ? '' : QUERY; // Stage 1 fills the segment for a company query
  return { query: QUERY, isCompany, seedCompany, seedCode: seed ? seed.code : null, segment, about, pros, cons, screenerPeers };
}

/* ------------------------------------------------------------- Stage 1 */
async function findPeers(u) {
  const web = await firecrawlSnippets(u).catch(() => []);
  const system = [
    'You are an equity research analyst building a TRUE peer set for a company or industry.',
    'TRUE peers = companies in the SAME end-business, INCLUDING different business models — a manufacturer, an importer/sourcing player, a distributor, and an integrated player are ALL peers if they sell the same end-product. Do NOT just copy a stock screener\'s peer list; cast a wide net (it is worse to miss a peer than to include a marginal one).',
    'Split into Indian listed, Global listed, and Private/unlisted. Classify listed-vs-private correctly (Indian listing is verified on Screener afterwards).',
    'business_model MUST be exactly one of: "Manufacturer", "Trader-Distributor", "Importer-Sourcing", "Integrated" (a parenthetical qualifier is allowed, e.g. "Integrated (backward)").',
    'Return STRICT JSON only, no prose:',
    '{"segment":"...","definition":"one plain sentence anyone understands","peers":{"indian":[{"name","ticker(optional NSE symbol)","business_model","products","note"}],"global":[{"name","country","business_model","products","note"}],"private":[{"name","business_model","products","note"}]}}',
  ].join('\n');
  const user = [
    `QUERY: ${u.query}`,
    u.isCompany ? `This is a COMPANY. Anchor/seed company: ${u.seedCompany}` : 'This is an INDUSTRY / segment query.',
    u.about ? `\nSeed company "About" (from Screener):\n${u.about}` : '',
    u.pros.length ? `\nPros: ${u.pros.join('; ')}` : '',
    u.cons.length ? `\nCons: ${u.cons.join('; ')}` : '',
    u.screenerPeers.length ? `\nScreener's own peer names (WEAK seed — expand well beyond these): ${u.screenerPeers.join(', ')}` : '',
    web.length ? `\nWeb snippets:\n${web.map((w) => `- ${w}`).join('\n')}` : '',
    '\nInclude the seed company itself in the Indian (or Global) list if listed. Aim for 6–10 Indian, 3–6 Global, 2–5 Private peers.',
  ].filter(Boolean).join('\n');

  const out = await callClaudeJSON({ system, user, maxTokens: 4000 });
  const peers = out.peers || {};
  const clip = (arr, n) => (Array.isArray(arr) ? arr : []).slice(0, n).map((p) => ({ ...p, business_model: canonicalModel(p.business_model) }));
  return {
    segment: out.segment || u.segment || u.query,
    definition: out.definition || '',
    peers: { indian: clip(peers.indian, CAP.indian + 2), global: clip(peers.global, CAP.global + 2), private: clip(peers.private, CAP.private + 2) },
    seedCompany: u.seedCompany,
    isCompany: u.isCompany,
  };
}

/* ------------------------------------------------------------- Stage 2 */
async function fetchIndianFinancials(page, plan) {
  const indian = [], movedToPrivate = [];
  let count = 0;
  for (const p of plan) {
    if (count >= CAP.indian) break;
    const name = String(p.name || '').trim();
    if (!name) continue;
    try {
      const hit = await resolveScreenerCode(name);
      if (!hit) { movedToPrivate.push(p); continue; }
      const res = await getCompanyHtml(page, hit.code);
      if (!res) { movedToPrivate.push(p); continue; }
      const m = mapCompany(res.html);
      if (!m.listed) { movedToPrivate.push(p); continue; }
      indian.push({
        name: m.name || name,
        ticker: hit.code,
        ...(closeName(hit.name, QUERY) ? { is_seed: true } : {}),
        business_model: canonicalModel(p.business_model),
        products: p.products || '',
        note: p.note || '',
        source: screenerSource(hit.code),
        current: pickMetrics(m.current),
        series: m.series || {},
      });
      count++;
      console.log(`  indian: ${m.name || name} (${hit.code}) ${m.current.ebitda_margin != null ? '✓' : '~'}`);
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
  for (const p of plan.slice(0, CAP.global)) {
    const name = String(p.name || '').trim();
    if (!name) continue;
    let g = { current: {}, source: { label: 'web', url: '' } };
    try { g = await fetchGlobalPeer(name); } catch (e) { console.warn(`  global ${name} failed: ${e.message}`); }
    out.push({
      name,
      country: p.country || '',
      business_model: canonicalModel(p.business_model),
      products: p.products || '',
      note: p.note || '',
      source: g.source && g.source.url ? g.source : { label: p.country || 'Web', url: '' },
      current: pickMetrics(g.current || {}),
      series: {},
    });
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

/* ------------------------------------------------------------- Stage 5 */
async function scoreOutperformer(u, peers, medianTable) {
  const system = [
    'You are an equity research analyst. From the peer financials + peer medians, crown ONE outperformer and rank the peer set.',
    'The reason a company outperforms is OPEN-ENDED free text — the ACTUAL driver for THIS company (pricing power, premium/branded mix, asset-light sourcing, backward/forward integration, export mix, cost leadership, distribution moat, working-capital edge, niche product, scale, a one-off, or a mix). NEVER pick from a fixed menu; if there is no clean single reason, say "a mix of factors" honestly.',
    'Score each peer 0–100 across the parameters; rank (1 = outperformer). strengths = the metrics where it clearly leads.',
    'Return STRICT JSON only:',
    '{"outperformer":{"company","bucket":"indian|global|private","headline":"one line","reason":"free text","india_vs_global":"one line verdict"},"scorecard":{"ranking":[{"company","bucket","score":0-100,"rank","strengths":["..."],"reason":"free text"}]}}',
  ].join('\n');
  const user = [
    `Segment: ${u.segment || QUERY}`,
    `\nPeer medians (context only): ${compactObj(medianTable)}`,
    `\nPeers:\n${peerTableText(peers)}`,
    '\nCrown the peer whose numbers (margins, returns, growth, efficiency, balance sheet) genuinely stand out, and explain WHY in plain language.',
  ].join('\n');
  const out = await callClaudeJSON({ system, user, maxTokens: 4000 });
  // normalize ranking
  const ranking = Array.isArray(out.scorecard && out.scorecard.ranking) ? out.scorecard.ranking : [];
  ranking.sort((a, b) => (a.rank || 99) - (b.rank || 99));
  ranking.forEach((r, i) => { r.rank = r.rank || i + 1; r.score = clampScore(r.score); r.strengths = Array.isArray(r.strengths) ? r.strengths.slice(0, 6) : []; });
  return { outperformer: out.outperformer || {}, scorecard: { ranking } };
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
  const out = await callClaudeJSON({ system, user, maxTokens: 5000 });
  return sanitizeReport(out.report || {}, u);
}

/* ------------------------------------------------------------- assemble */
function assemble({ understanding, peerPlan, indian, global, private: priv, verdict, onePager, coverage }) {
  const segment = peerPlan.segment || understanding.segment || QUERY;
  const seedCompany = understanding.seedCompany || (indian[0] && indian[0].name) || '';
  const name = understanding.isCompany && seedCompany ? seedCompany : titleCase(segment);
  const sources = collectSources(indian, global);
  const aliases = buildAliases(QUERY, segment, seedCompany, [...indian, ...global, ...priv]);

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
    sources,
  };
}

function writeOutputs(report) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, `${SLUG}.json`), JSON.stringify(report, null, 2) + '\n');
  // upsert index.json
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
  out.push({ label: 'Screener.in', url: 'https://www.screener.in/' });
  return out.slice(0, 12);
}
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
    // tolerate x/name drift; the renderer reads years + series[].label/.values
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
  return {
    title: String(report.title || `${titleCase(u.segment || QUERY)} — Peer Benchmarking`),
    summary: String(report.summary || ''),
    sections: clean,
  };
}
async function firecrawlSnippets(u) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return [];
  const q = `${u.isCompany ? u.seedCompany + ' ' : ''}${u.segment || u.query} competitors peers India and global`;
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: q, limit: 6 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return [];
    const d = await res.json();
    const items = (d && Array.isArray(d.data)) ? d.data : [];
    return items.map((it) => `${it.title || ''}: ${(it.description || '').slice(0, 200)}`).filter(Boolean).slice(0, 6);
  } catch (_) { return []; }
}

main().catch(async (err) => {
  console.error('FATAL:', err && err.stack ? err.stack : err);
  await postProgress(currentStage, 'failed', { error: String((err && err.message) || 'research failed') });
  process.exit(1);
});
