# PeerVIP

**Peer-benchmarking dashboard.** Search any company or industry → PeerVIP finds
its *true* peers (Indian Listed · Global Listed · Private), benchmarks them across
every financial metric with live medians & averages, year-by-year trends, and an
AI-crowned outperformer with a written reason.

> **This repo is Step 1 of 3: the complete, polished frontend, running fully
> offline from committed JSON.** No scrapers, no Playwright, no Bedrock, no
> network calls, no secrets. Two realistic sample reports are seeded so every
> screen renders end-to-end. Step 2 plugs a live pipeline in behind the *same*
> JSON data contract.

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
| **Environment variables / secrets** | *(none in Step 1)* |

Once connected, **every push to `main` auto-builds and deploys** — no manual step
ever again. (Step 2 adds `functions/` for API routes and will introduce build-time
secrets; none are needed now.)

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
functions/
  README.md                  # placeholder — API routes arrive in Step 2
docs/
  DATA_CONTRACT.md           # the precise JSON contract Step 2 must produce
scripts/
  generate-seed-data.mjs     # regenerates the two seed reports (pure Node, no deps)
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

## Step 2 hook

The loading screen's seven stages are the *real* pipeline stages. A live backend
can drive them by setting `window.PeerVIP.autoAdvance = false` and calling
`window.PeerVIP.setStage(i)` / `window.PeerVIP.finish()`. `js/data.js` is the only
place that reads data — repoint it at the live API (same JSON shape) and nothing
else changes.
