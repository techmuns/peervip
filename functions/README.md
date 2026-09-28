# Cloudflare Pages Functions

Live API for PeerVIP (Step 2). All routes are same-origin, bind a KV namespace
**`PEERVIP_KV`**, and never return 500 (errors come back as friendly JSON).

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/research` | POST `{query}` | Owns slug creation (`slugify`), fires the GitHub Actions `research.yml` via `workflow_dispatch`, seeds `status:<slug>` in KV, returns `{slug, dispatched}`. If GitHub env is missing, returns `{dispatched:false, manual}`. |
| `/api/research-status?slug=` | GET | Returns `status:<slug>` (`{state,stage,error?}`); forces `done` if `report:<slug>` exists. |
| `/api/progress` | POST | Called by the Action (header `x-progress-secret`). Writes `status:<slug>`; if `report` is present, stores `report:<slug>` and marks `done`. |
| `/api/report/<slug>` | GET | Serves `report:<slug>` from KV (instant, pre-redeploy); 404 → frontend falls back to the committed `public/data/reports/<slug>.json` seed. |

Shared code lives in `functions/_lib/` (underscore-prefixed → not routed):
`slug.js` (kept identical to `lib/slug.mjs`) and `http.js` (`json`, `kvGet`, `kvPut`).

**Bindings / env** (Cloudflare Pages → Settings): KV namespace `PEERVIP_KV`;
vars `GH_DISPATCH_TOKEN`, `GH_OWNER`, `GH_REPO`, `GH_REF`, `PROGRESS_SECRET`.
See the repo README's **Go live** section for the full list and how to mint the PAT.
