/**
 * lib/llm.mjs — the ONLY place the pipeline talks to Claude.
 *
 * Calls Claude on AWS Bedrock through the raw Converse HTTPS endpoint using
 * global `fetch` — no AWS SDK, no SigV4. Auth is a Bedrock API key passed as a
 * bearer token (copied from paramemo/industryresearch, which run this in prod).
 *
 * Env (missing/empty values fall back to defaults):
 *   BEDROCK_API_KEY    required — throws if missing
 *   BEDROCK_REGION     default "us-east-1"
 *   BEDROCK_MODEL_IDS  comma list; falls through the chain on 400/403/404,
 *                      retries 429/5xx. Model ids are config only — never hard-code.
 */

const REGION = process.env.BEDROCK_REGION || 'us-east-1';
const MODELS = (process.env.BEDROCK_MODEL_IDS
  || 'anthropic.claude-sonnet-5,us.anthropic.claude-sonnet-5,us.anthropic.claude-sonnet-4-5-20250929-v1:0')
  .split(',').map((s) => s.trim()).filter(Boolean);
const TIMEOUT_MS = Number(process.env.BEDROCK_TIMEOUT_MS) || 240000;
const ROUNDS = Number(process.env.BEDROCK_ROUNDS) || 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call Claude once (Bedrock Converse) and return the concatenated text of every
 * `text` content block. Walks the model fallback chain, retrying transient
 * failures (429/5xx/network) across several patient waves before giving up.
 * Throws with the last error so a wrong region/key/model is debuggable.
 */
export async function callClaude({ system, user, maxTokens = 8000, temperature = 0 }) {
  const apiKey = process.env.BEDROCK_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('BEDROCK_API_KEY is not set (used as a bearer token for Bedrock).');
  }
  const body = JSON.stringify({
    system: [{ text: String(system || '') }],
    messages: [{ role: 'user', content: [{ text: String(user ?? '') }] }],
    inferenceConfig: { temperature, maxTokens },
  });

  let lastErr = 'no attempt';
  for (let round = 0; round < ROUNDS; round++) {
    for (const model of MODELS) {
      const url = `https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(model)}/converse`;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
          body,
          signal: ctl.signal,
        });
        if (res.status === 429 || res.status >= 500) { lastErr = `HTTP ${res.status} (busy)`; continue; }
        if ([400, 403, 404].includes(res.status)) { lastErr = `HTTP ${res.status} ${(await res.text()).slice(0, 160)}`; continue; }
        if (res.status !== 200) { lastErr = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`; continue; }
        const data = await res.json();
        const parts = data && data.output && data.output.message && data.output.message.content;
        const text = Array.isArray(parts) ? parts.map((p) => (p && p.text) || '').join('') : '';
        if (text) return text;
        lastErr = 'empty response';
      } catch (err) {
        lastErr = err && err.name === 'AbortError' ? `timed out after ${TIMEOUT_MS}ms` : `network: ${(err && err.message) || err}`;
      } finally {
        clearTimeout(timer);
      }
    }
    if (round < ROUNDS - 1) {
      console.warn(`[llm] all models busy (${lastErr}); wave ${round + 1}/${ROUNDS} — waiting…`);
      await sleep(Math.min(60000, 4000 * 2 ** round));
    }
  }
  throw new Error(`Bedrock exhausted after ${ROUNDS} waves — last: ${lastErr}`);
}

/**
 * Call Claude and robustly parse a single JSON object from the reply.
 * Slices to the outermost { … } (ignoring ```json fences / prose), tries a
 * direct parse, then a light local repair, then one Claude repair call.
 */
export async function callClaudeJSON({ system, user, maxTokens = 8000 }) {
  const raw = await callClaude({ system, user, maxTokens });
  const candidate = sliceToObject(raw);
  if (candidate == null) throw new Error(`callClaudeJSON: no JSON object in reply.\n${raw.slice(0, 800)}`);

  const direct = tryParse(candidate);
  if (direct.ok) return direct.value;

  const repaired = tryParse(repairJson(candidate));
  if (repaired.ok) { console.warn('[llm] recovered via local JSON repair.'); return repaired.value; }

  console.warn(`[llm] JSON parse failed (${direct.error}); asking Claude to repair…`);
  try {
    const fixedRaw = await callClaude({
      system: 'You are a JSON repair tool. The user gives text meant to be ONE JSON object but it fails to parse — usually an unescaped double-quote or a raw newline inside a string value. Return ONLY the corrected, strictly valid JSON object: keep all data, change as little as possible to make it parse. No prose, no markdown, no code fences.',
      user: candidate,
      maxTokens,
    });
    const fixed = tryParse(sliceToObject(fixedRaw) || '');
    if (fixed.ok) { console.warn('[llm] recovered via repair call.'); return fixed.value; }
  } catch (e) { console.warn(`[llm] repair call failed: ${e.message}`); }

  throw new Error(`callClaudeJSON: JSON.parse failed after repair (${direct.error}).\nStarts:\n${candidate.slice(0, 800)}`);
}

function sliceToObject(raw) {
  const text = String(raw).trim();
  const first = text.indexOf('{');
  if (first === -1) return null;
  const last = text.lastIndexOf('}');
  return last > first ? text.slice(first, last + 1) : text.slice(first);
}
function tryParse(s) { try { return { ok: true, value: JSON.parse(s) }; } catch (e) { return { ok: false, error: e.message }; } }

function balancedClose(s) {
  const stack = []; let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  while (stack.length) out += (stack.pop() === '{' ? '}' : ']');
  return out;
}
function repairJson(s) {
  let t = String(s).replace(/[\u0000-\u001F]/g, ' ');
  t = t.replace(/,(\s*[}\]])/g, '$1');
  t = balancedClose(t);
  t = t.replace(/,(\s*[}\]])/g, '$1');
  return t;
}

export function llmConfig() { return { region: REGION, models: MODELS, count: MODELS.length }; }
