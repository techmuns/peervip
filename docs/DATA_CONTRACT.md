# PeerVIP data contract (v1)

This is the exact JSON shape the Step-1 frontend renders and that Step-2's live
pipeline must produce. Everything the UI shows is driven by these files —
**there is no other source of truth.**

Two file kinds:

- `public/data/index.json` — the catalogue of available reports (drives Home + search).
- `public/data/reports/<slug>.json` — one full report.

---

## `index.json`

```jsonc
{
  "reports": [
    {
      "slug": "laminates",                       // required — matches reports/<slug>.json
      "name": "Laminates (Decorative Laminates)",// required — display name
      "type": "industry",                        // "industry" | "company"
      "query": "laminates",                      // canonical query text
      "seed_company": "Stylam Industries",       // (added in v1) the anchor company; also searchable
      "aliases": ["stylam", "greenlam", "hpl"],  // (added in v1) extra search terms → this report
      "updated_at": "2026-09-28T00:00:00Z",      // ISO-8601
      "peer_count": 12,
      "sample": true
    }
  ]
}
```

**v1 additions vs. the original brief:** `seed_company` and `aliases` on each
entry. Both are optional and used only to make Home search forgiving (so
"Stylam" and "Monolithisch" resolve to their reports). Omitting them still works;
search then matches on `name` / `slug` / `query` only.

---

## `reports/<slug>.json`

```jsonc
{
  "meta": {
    "slug": "laminates",
    "name": "Laminates (Decorative Laminates)",
    "type": "industry",                          // "industry" | "company"
    "query": "laminates",
    "seed_company": "Stylam Industries",
    "segment": "Decorative laminates & surfacing",
    "definition": "Plain one-line description anyone can understand.",
    "generated_at": "2026-09-28T00:00:00Z",
    "sample": true,
    "coverage": { "peers_total": 12, "with_full_financials": 7, "confidence": "medium" }
  },

  "outperformer": {
    "company": "Euro Pratik Sales",
    "bucket": "indian",                          // "indian" | "global" | "private"
    "headline": "Highest margin in the peer set — ~32% EBITDA vs a ~13% peer median",
    "reason": "FREE TEXT — can be ANY driver. Never assume a fixed type.",
    "india_vs_global": "One-line verdict comparing Indian vs global peers."
  },

  "metrics": [
    {
      "key": "ebitda_margin",   // stable id used by current[] and series{}
      "label": "EBITDA margin",
      "unit": "%",              // "%" | "x" | "days" | "Rs Cr" | ""
      "group": "Profitability", // section grouping in the drill-down
      "better": "high",         // "high" | "low" | "neutral"  (neutral = no winner, no green/red)
      "format": "pct1"          // "num0" | "num1" | "num2" | "pct1"
    }
    // … the full metric dictionary (see any seed file for all 26)
  ],

  "peers": {
    "indian": [
      {
        "name": "Stylam Industries",
        "ticker": "STYLAMIND",
        "is_seed": true,                         // the searched/anchor company (optional)
        "business_model": "Manufacturer",        // "Manufacturer" | "Trader-Distributor" | "Importer-Sourcing" | "Integrated" | other
        "products": "Decorative & high-pressure laminates",
        "note": "",
        "country": "India",                      // optional (used mainly for global peers)
        "source": { "label": "Screener", "url": "https://www.screener.in/company/STYLAMIND/" },
        "current": {                             // metric.key → number | null (absent = "—")
          "revenue": 1450, "ebitda_margin": 23.5, "roce": 22.0
          // …any subset of metric keys
        },
        "series": {                              // metric.key → { years[], values[] } (values aligned to years; null allowed)
          "ebitda_margin": { "years": ["FY19","FY20","FY21"], "values": [18, 19, 20] }
        }
      }
    ],
    "global":  [ /* DESCRIPTIVE-ONLY: name, business_model, products, note, country, source — no current/series (global financials are patchy, so globals are landscape context, not benchmarked) */ ],
    "private": [ /* name, business_model, products, note, source only — no current/series */ ]
  },

  "scorecard": {
    "ranking": [
      {
        "company": "Euro Pratik Sales",
        "bucket": "indian",
        "score": 88,                             // 0–100
        "rank": 1,                               // 1 = outperformer
        "strengths": ["EBITDA margin", "ROCE"],  // short chips
        "reason": "FREE TEXT — can say anything."
      }
    ]
  },

  "report": {
    "title": "Laminates — Peer Benchmarking",
    "summary": "Plain-language 1–2 sentence takeaway.",
    "sections": [
      { "title": "The outperformer", "icon": "sparkles", "blocks": [ /* typed blocks, below */ ] }
    ]
  },

  "sources": [ { "label": "Screener — Stylam", "url": "https://www.screener.in/company/STYLAMIND/" } ]
}
```

### Report block types

Each `section.blocks[]` entry is one of these (rendered as sanitized inline SVG / HTML):

| `type`     | Shape |
| ---------- | ----- |
| `callout`  | `{ "type":"callout", "tone":"good\|warn\|info\|bad", "title":"…", "text":"…" }` |
| `kpis`     | `{ "type":"kpis", "items":[ { "label":"…", "value":"32%", "sub":"peer median ~13%" } ] }` |
| `bars`     | `{ "type":"bars", "unit":"%", "items":[ { "label":"Euro Pratik", "value":32 } ] }` (horizontal) |
| `trend`    | `{ "type":"trend", "unit":"%", "years":[…], "series":[ { "label":"Euro Pratik", "values":[…, null allowed] } ] }` |
| `donut`    | `{ "type":"donut", "items":[ { "label":"Manufacturer", "value":4 } ] }` |
| `table`    | `{ "type":"table", "columns":["Company","Revenue"], "rows":[ ["Stylam","1,450"] ] }` |

`section.icon` (optional) ∈ `sparkles, chart, trophy, trend, donut, table, globe, money, flag`.

---

## Invariants the UI relies on

1. **Frontend computes** Median, Average and winner-per-metric from
   `peers[].current` / `peers[].series`. Do **not** pre-compute them in the JSON —
   they'd only risk disagreeing with the tables.
2. **`better` drives everything:** `high` → bigger is better, `low` → smaller is
   better, `neutral` → no winner and no green/red shading (e.g. valuation, ownership).
3. **Missing data is honest.** A `null` or absent `current[key]` renders `—`. A
   series omits or `null`s the years it doesn't have; each line starts where its
   real data starts. Never fabricate to fill a gap.
4. **`outperformer.reason` and `scorecard.ranking[].reason` are open-ended free
   text.** They can describe *any* driver. Nothing in the UI hardcodes, templates
   or assumes a reason type.
5. **Global & private peers are descriptive-only.** Both carry `name`,
   `business_model`, `products`, `note`, `source` (global also `country`) and **no
   `current` / `series`** — global financials are too patchy to benchmark, so both
   buckets are shown for landscape context, not scored. Only the **Indian listed
   set** is benchmarked (medians, green/red, the comparison chart and the scorecard).
