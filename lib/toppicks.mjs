/**
 * lib/toppicks.mjs — the "Top Picks" synthesis layer.
 *
 * From everything a report already knows about each company (current metrics +
 * multi-year trajectory + shareholding + red flags + value-chain role) PLUS a fresh
 * open-web search per candidate, it produces a ranked 10-15 best-ideas shortlist,
 * each with a NUMBER-CITED thesis, a key risk and an evidence grade.
 *
 * Two transparent passes:
 *   1. QUANT — a business-quality score (percentile rank across the non-neutral,
 *      non-size metrics, honouring each metric's `better`, minus light red-flag
 *      penalties). Mirrors the dashboard's composite score. Shortlists + seeds a prior.
 *   2. LLM — reads each shortlisted company's full data profile + web snippets and
 *      writes the grounded reason, re-ordering on the evidence and trimming to the
 *      strongest 10-15. Every claim must trace to a provided number or snippet.
 *
 * Candidate pool = the core benchmarked peers + the value-chain players (with
 * financials), so a strong supplier/operator from the value chain can make the list.
 *
 * report.top_picks = { generated_at, picks: [ { rank, name, ticker, score, thesis,
 *   key_metrics:[string], risk, evidence:'A|B|C', role, source:{label,url} } ] }
 *
 * Additive + fail-safe: the caller wraps it; the report ships without top_picks if
 * anything fails. Needs Bedrock; web context degrades gracefully without Jina.
 */
import { callClaudeJSON } from './llm.mjs';
import { jinaSearch, jinaConfigured } from './jina.mjs';
import { METRICS } from './metrics.mjs';

const norm = (s) => String(s || '').toLowerCase()
  .replace(/\b(ltd|limited|india|industries|technologies|corporation|inc|plc|corp|co|company|the|and|&)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isNum = (v) => typeof v === 'number' && isFinite(v);

// Metrics that drive the business-quality score (mirror of the frontend composite):
// skip neutral, absolute-size (trendOnly) and opted-out market/return metrics.
const SCORE_METRICS = METRICS.filter((m) => m.better !== 'neutral' && !m.trendOnly && m.composite !== false);

/** Percentile (0..1) of v within the pool's values, honouring `better`. */
function rankPos(v, vals, better) {
  if (!isNum(v)) return null;
  const a = vals.filter(isNum);
  if (a.length < 2) return null;
  const worse = a.filter((x) => (better === 'high' ? x < v : x > v)).length;
  return worse / (a.length - 1);
}

/** Business-quality score per candidate, 0-100, best-first. */
function quantScore(pool) {
  const col = {};
  for (const m of SCORE_METRICS) col[m.key] = pool.map((p) => (p.current || {})[m.key]).filter(isNum);
  return pool.map((p) => {
    const cur = p.current || {};
    let sum = 0, n = 0;
    for (const m of SCORE_METRICS) { const pos = rankPos(cur[m.key], col[m.key], m.better); if (pos != null) { sum += pos; n += 1; } }
    let score = n ? (sum / n) * 100 : 0;
    if (isNum(cur.pledge_pct) && cur.pledge_pct > 0) score -= 4;      // promoter pledging
    if (isNum(cur.debt_equity) && cur.debt_equity > 1) score -= 4;    // heavy leverage
    if (isNum(cur.cfo_op) && cur.cfo_op < 60) score -= 3;             // weak cash conversion
    if (isNum(cur.fcf) && cur.fcf < 0) score -= 2;                    // burning cash
    return { peer: p, score: Math.max(0, Math.round(score)), n };
  }).sort((a, b) => b.score - a.score);
}

/** Direction of a multi-year series: rising / falling / flat / ''. */
function traj(p, key) {
  const s = p.series && p.series[key];
  const vals = s && Array.isArray(s.values) ? s.values.filter(isNum) : [];
  if (vals.length < 2) return '';
  const first = vals[0], last = vals[vals.length - 1];
  if (last > first * 1.05) return 'rising';
  if (last < first * 0.95) return 'falling';
  return 'flat';
}

/** Compact one-line data profile for the LLM. */
function profile(p) {
  const c = p.current || {};
  const m = [];
  const push = (lbl, k, suf = '') => { if (isNum(c[k])) m.push(`${lbl} ${c[k]}${suf}`); };
  push('Rev(Cr)', 'revenue'); push('RevCAGR3Y', 'rev_cagr_3y', '%'); push('ProfitCAGR3Y', 'profit_cagr_3y', '%');
  push('EBITDAm', 'ebitda_margin', '%'); push('PATm', 'pat_margin', '%'); push('ROCE', 'roce', '%'); push('ROE', 'roe', '%');
  push('D/E', 'debt_equity'); push('IntCov', 'interest_coverage'); push('CFO/OP', 'cfo_op', '%');
  push('Promoter', 'promoter_holding', '%'); push('Pledge', 'pledge_pct', '%'); push('FII', 'fii_holding', '%'); push('DII', 'dii_holding', '%');
  push('PE', 'pe'); push('MCap(Cr)', 'market_cap');
  const tr = [['rev', 'revenue'], ['margin', 'ebitda_margin'], ['roce', 'roce']]
    .map(([lbl, k]) => { const t = traj(p, k); return t ? `${lbl} ${t}` : ''; }).filter(Boolean);
  const parts = [`${p.name}${p.ticker ? ' (' + p.ticker + ')' : ''}`, m.join(', ')];
  if (tr.length) parts.push('Trend: ' + tr.join(', '));
  if (p.value_chain_nodes && p.value_chain_nodes.length) parts.push('Value-chain: ' + p.value_chain_nodes.join(', '));
  if (p.role) parts.push('Role: ' + String(p.role).slice(0, 80));
  return parts.join(' | ');
}

/** A few fresh web snippets for a company (open web search; '' without Jina). */
async function webContext(name, industry) {
  if (!jinaConfigured()) return '';
  let hits = [];
  try { hits = await jinaSearch(`${name} ${industry} results order book capacity expansion outlook`); } catch (_) { /* */ }
  return hits.slice(0, 4).map((h) => `${h.title}: ${h.snippet}`).join(' · ').replace(/\s+/g, ' ').slice(0, 600);
}

/**
 * @returns { generated_at, picks } or null.
 */
export async function buildTopPicks({ industry, definition, indian = [], valueChain = null, cap = 15 }) {
  const seen = new Set(); const pool = [];
  for (const p of [...indian, ...((valueChain && valueChain.players) || [])]) {
    if (!p || !p.name) continue;
    const hasFin = p.current && Object.values(p.current).some((v) => isNum(v));
    if (!hasFin) continue;
    const k = norm(p.name); if (!k || seen.has(k)) continue; seen.add(k); pool.push(p);
  }
  if (pool.length < 3) return null;

  const ranked = quantScore(pool);
  const shortlist = ranked.slice(0, Math.min(18, ranked.length));

  // Open-web search per shortlisted candidate (snippets — fast, within the run budget).
  const web = {};
  for (const s of shortlist) { web[norm(s.peer.name)] = await webContext(s.peer.name, industry); await sleep(120); }

  const out = await callClaudeJSON({
    system: [
      `You are an equity analyst building a "Top Picks" shortlist for the "${industry}" industry. From the candidates below pick the ${Math.min(cap, 15)} BEST stocks as long-term business-quality ideas and RANK them best-first.`,
      'For EACH pick return: thesis (<=45 words that CITE the actual numbers from its profile — e.g. "ROCE 28%, rev CAGR 22%, D/E 0.1, promoter 60%" — never vague adjectives alone); key_metrics (3-5 "Label: value" strings, the figures that justify the pick); risk (<=20 words, the single biggest concern); evidence (A = strong numbers AND a corroborating web fact; B = strong numbers only; C = thin/qualitative); role (<=10 words: what it does / value-chain position).',
      'Ground EVERY claim ONLY in the provided data profile and web snippets — never invent a number, order win or capacity. Favour durable quality (growth + margins + returns + clean balance sheet + sound ownership) over size alone; a weak balance sheet or heavy pledging should pull a name down. A quant score (0-100 business quality vs peers) precedes each candidate as a prior — respect it but you may re-order on the evidence, and you need not include all candidates.',
      'Return STRICT JSON {"picks":[{"name","thesis","key_metrics":["..."],"risk","evidence":"A|B|C","role"}]} best-first. No prose.',
    ].join('\n'),
    user: `Definition: ${definition || '(n/a)'}\n\nCandidates ([quant score] · data profile · WEB snippets):\n`
      + shortlist.map((s) => `[${s.score}] ${profile(s.peer)}${web[norm(s.peer.name)] ? '\n  WEB: ' + web[norm(s.peer.name)] : ''}`).join('\n\n'),
    maxTokens: 8000,
  });

  const byName = new Map(shortlist.map((s) => [norm(s.peer.name), s]));
  const picks = [];
  const used = new Set();
  for (const r of (Array.isArray(out.picks) ? out.picks : [])) {
    if (!r || !r.name) continue;
    const s = byName.get(norm(r.name)); if (!s) continue;
    if (used.has(norm(r.name))) continue; used.add(norm(r.name));
    const p = s.peer;
    picks.push({
      rank: picks.length + 1,
      name: p.name, ticker: p.ticker || '', score: s.score,
      thesis: String(r.thesis || '').trim(),
      key_metrics: (Array.isArray(r.key_metrics) ? r.key_metrics : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 6),
      risk: String(r.risk || '').trim(),
      evidence: /^[A-C]$/.test((String(r.evidence || '').trim()[0] || '')) ? String(r.evidence).trim()[0] : '',
      role: String(r.role || '').trim(),
      source: (p.source && p.source.url) ? p.source : (p.ticker ? { label: 'Screener', url: `https://www.screener.in/company/${encodeURIComponent(p.ticker)}/` } : null),
    });
    if (picks.length >= cap) break;
  }
  if (!picks.length) return null;
  return { generated_at: new Date().toISOString(), picks };
}
