# PeerVIP

**Peer-benchmarking dashboard.** Search any company or industry → PeerVIP finds
its *true* peers (Indian Listed · Global Listed · Private), benchmarks them across
every financial metric with live medians & averages, year-by-year trends, and an
AI-crowned outperformer with a written reason.

> **Live (Step 2).** A real search now runs end-to-end: type a company or
> industry → a Cloudflare Pages Function dispatches a GitHub Actions run that
> researches the peer set (Screener via Playwright + global sources + 2–3 Claude
> calls on AWS Bedrock) → the loading screen shows live per-stage progress → the
> report is served from KV and rendered at `#/r/<slug>`. The two committed sample
> reports remain the **offline fallback**, and the frontend still renders 100%
> from the same JSON data contract. See **[Go live](#go-live)** for the one-time
> secrets/bindings setup.

---

## Tech & constraints

- **Static site, no build step.** Plain HTML + vanilla ES-module JS. No framework, no bundler.
- **CDN libraries only:** [Tailwind (Play CDN)](https://cdn.tailwindcss.com),
  [Chart.js v4](https://cdn.jsdelivr.net/npm/chart.js@4),
  [ExcelJS 4.4.0](https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js),
  Google Fonts (Inter + Plus Jakarta Sans).
- **Web root is `public/`.** All data is committed JSON under `public/data/`.
- Light, colourful, premium theme; responsive down to phone width (wide tables
  scroll horizontally, 16px side gutters, no full-page horizontal scroll).

## Run it locally

No install, no build — just serve the `public/` folder with any static server:

```bash
# Python
python3 -m http.server 8000 --directory public
# …or Node
npx serve public
```

Then open <http://localhost:8000> (use a server, not `file://`, so `fetch()` of the JSON works).

## Deploy — Cloudflare Pages (configure once, auto-deploys forever)

The site is static, so deployment is a **one-time** connection. In the Cloudflare
dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick this repo
and set:

| Setting | Value |
| --- | --- |
| **Production branch** | `main` |
| **Build command** | *(leave empty — none)* |
| **Build output directory** | `public` |
| **Environment variables / secrets** | *(see [Go live](#go-live) for live research)* |

Once connected, **every push to `main` auto-builds and deploys** — no manual step
ever again. Cloudflare Pages auto-detects `functions/` and serves the API routes;
the static seeds remain the offline fallback. The site works with no config
(seeded reports only); the [Go live](#go-live) bindings turn on live research.

## Project structure

```
public/
  index.html                 # shell: design tokens, fonts, CDN libs, #app root
  css/styles.css             # background glow, sticky data-grid, CF tints, tabs, print
  js/
    app.js                   # entry + hash router; Home + Loading screens; setStage() API
    dashboard.js             # dashboard shell: header, outperformer banner, tabs, Overview, Private
    tables.js                # Current wide table + Trends foldable sections (+ Table↔Charts)
    drilldown.js             # right-hand company profile panel + inline-SVG sparklines
    scorecard.js             # winner-per-metric (computed) + composite ranking (from JSON)
    report.js                # one-pager: typed visual blocks (SVG) + Print/Save-as-PDF
    excel.js                 # multi-sheet ExcelJS export (client-side)
    charts.js                # Chart.js defaults + line/hbar/doughnut builders + median line plugin
    compute.js               # medians, averages, winner-per-metric, series helpers (frontend-computed)
    conditional.js           # Excel-like conditional-formatting tints (DOM classes + Excel ARGB)
    format.js                # number formatting, escaping, small helpers
    data.js                  # loads index.json + report JSON; resolves a search query to a report
  data/
    index.json               # list of available reports (+ search aliases)
    reports/
      laminates.json         # rich seed (Stylam anchor, Euro Pratik = margin outperformer)
      refractories.json      # smaller seed (Monolithisch anchor; a different outperformer reason)
    research.js              # live pipeline client: dispatch + status polling
functions/                   # Cloudflare Pages Functions (live API; binds PEERVIP_KV)
  api/
    research.js              # POST {query} -> slugify + workflow_dispatch + KV status
    research-status.js       # GET ?slug -> KV status (done when report exists)
    progress.js              # POST (secret) -> KV status / report (called by the Action)
    report/[slug].js         # GET -> KV report:<slug> (404 -> seed fallback)
  _lib/{slug.js,http.js}     # shared (slug.js identical to lib/slug.mjs)
lib/                         # Node libs for the pipeline (run in GitHub Actions)
  llm.mjs                    # Bedrock Converse + callClaudeJSON (repair + model fallback)
  screener.mjs               # Screener search/login + cheerio parse -> 26 metric keys
  global.mjs                 # global peers via Yahoo Finance (FX -> ₹ Cr), best-effort
  metrics.mjs                # the 26-metric dictionary (verbatim) + median + canonicalModel
  slug.mjs                   # slugify (identical to functions/_lib/slug.js)
scripts/
  research-peers.mjs         # the 7-stage pipeline (Screener + global + 3 Bedrock calls)
  test-bedrock.mjs           # cred check: Bedrock connectivity
  test-screener.mjs          # cred check: Screener login + scrape
  generate-seed-data.mjs     # regenerates the two seed reports (pure Node, no deps)
.github/workflows/
  research.yml               # workflow_dispatch: run pipeline + commit report/index
  test-creds.yml             # manual: validate Bedrock + Screener creds
docs/DATA_CONTRACT.md        # the precise JSON contract the pipeline produces
.gitignore
```

Regenerate the seed JSON at any time (deterministic output):

```bash
node scripts/generate-seed-data.mjs   # writes public/data/index.json + reports/*.json
```

## The data contract

`public/data/reports/<slug>.json` is the single source of truth the UI renders.
See **[docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md)** for the full, precise shape
Step 2's pipeline must produce. Key rules:

- The **frontend computes** medians, averages and winner-per-metric itself from
  `peers[].current` and `peers[].series`, so every table is internally consistent.
- The **outperformer verdict, scorecard scores and reason text come from the JSON**
  (AI-generated in Step 2; seeded now).
- `metric.better ∈ {high, low, neutral}` drives conditional formatting and winners
  (`neutral` = no winner, no green/red).
- Values may be `null`/absent (rendered `—`, never invented); series start where
  real data starts (blank where missing, never fabricated).
- **The reason a company outperforms is open-ended free text** — it can be any
  driver (sourcing model, pricing power, integration, working-capital efficiency,
  niche, scale, a one-off, …). Nothing in the UI hardcodes a reason type.

## How live research works

```
Browser  ──POST /api/research {query}──▶  Pages Function
                                          · slugify(query) -> slug
                                          · workflow_dispatch research.yml {query, slug}
                                          · KV status:<slug> = {starting}
                                          ◀── {slug}
Browser  ──poll /api/research-status?slug (every 2.5s)──▶  KV status  ──▶ setStage(i)

GitHub Action (research.yml, ~minutes)   scripts/research-peers.mjs
   stage 0 Understanding      ─┐
   stage 1 Find true peers     │  each stage POSTs /api/progress {slug,stage} (shared secret)
   stage 2 Screener financials │  → KV status:<slug>
   stage 3 Global peers        │
   stage 4 Medians (AI ctx)    │
   stage 5 Score outperformer  │
   stage 6 Build report       ─┘  POST /api/progress {report}  → KV report:<slug>, status done
                                   + commit public/data/reports/<slug>.json + index.json (redeploy)

Browser  status=done ──▶ loadReport(slug) (/api/report -> KV, instant) ──▶ #/r/<slug>
```

The frontend **computes** medians/averages/winners itself, so the pipeline emits
only raw peer numbers + the AI's verdict/reason/report text (never precomputed
aggregates). The outperformer reason is open-ended free text.

## Go live

Live research is **off until you add the secrets/bindings below** — one-time, then
every search is automatic. The site works without them (seeded reports + a friendly
"live research isn't configured" note).

### 1. GitHub → repo **Secrets** (Settings → Secrets and variables → Actions)

| Secret | For | Notes |
| --- | --- | --- |
| `BEDROCK_API_KEY` | Claude on AWS Bedrock | Bedrock API key (used as a bearer token) |
| `BEDROCK_REGION` | Bedrock | e.g. `us-east-1` (default if unset) |
| `BEDROCK_MODEL_IDS` | Bedrock | *optional* comma list; default is a Sonnet chain |
| `SCREENER_EMAIL` | Screener login | unlocks the full ratio ribbon + export |
| `SCREENER_PASSWORD` | Screener login | |
| `PROGRESS_URL` | progress callbacks | your Pages origin, e.g. `https://peervip.pages.dev` |
| `PROGRESS_SECRET` | authenticates `/api/progress` | any random string (same value on Pages) |
| `FIRECRAWL_API_KEY` | web snippets for peer discovery | *optional* |

### 2. Cloudflare Pages → project **Settings**

- **KV** → create a namespace, bind it to the Pages project as **`PEERVIP_KV`**
  (Settings → Functions → KV namespace bindings).
- **Environment variables** (Settings → Environment variables, Production):

  | Var | Value |
  | --- | --- |
  | `GH_DISPATCH_TOKEN` | a fine-grained GitHub PAT (see below) |
  | `GH_OWNER` | `techmuns` |
  | `GH_REPO` | `peervip` |
  | `GH_REF` | `main` |
  | `PROGRESS_SECRET` | **same value** as the GitHub secret |

### 3. Mint the `GH_DISPATCH_TOKEN` PAT

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** →
Generate new token → **Resource owner:** `techmuns`, **Repository access:** only
`techmuns/peervip`, **Permissions → Repository → Actions: Read and write**. Copy the
token into the Pages `GH_DISPATCH_TOKEN` var. (This is the only credential that lets
the Function start a research run.)

### 4. Validate before a real run

GitHub → **Actions → "Test credentials" → Run workflow**. It runs
`scripts/test-bedrock.mjs` (prints a Bedrock reply) and `scripts/test-screener.mjs`
(logs in + scrapes a sample company) so you can confirm creds without a full run.

Then search anything on the site — the loading screen drives from real stages and
the dashboard renders live data.
