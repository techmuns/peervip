# Peer Research Framework — finding the true listed players across any industry's value chain

This is the **generic** method PeerVIP research follows for **any** industry (not just
data centers). When a user searches an industry — or searches a stock and clicks
**Research** (which first resolves that stock's *true* industry) — the pipeline must
reconstruct the industry's value chain first, then find listed players inside each
node, verify each one, and classify it. It must never start from "stocks related to X."

It is the distilled version of the manual research that produced the Data Center
worked example (`scripts/data/data-center-valuechain.json`), generalized so the
pipeline applies the same discipline to chemicals, defence, hospitals, semis,
renewables, logistics, packaging, pharma, auto components, etc.

## Core principle (mandatory order)

> INDUSTRY → VALUE CHAIN → SUB-SEGMENTS → PRODUCTS/SERVICES → COMPANIES →
> LISTING STATUS → PRIMARY EVIDENCE → MATERIALITY → PEER CLASSIFICATION.

Reconstruct the value chain **before** naming a single company, so existing stock
lists, SEO rankings and broker coverage don't bias the universe from the start.

## Phase 1 — Reconstruct the value chain (no company names yet)

Ask: *what has to happen from the earliest input to the customer's consumption?*
Build only the economically real nodes for this specific industry. A generic
template of layers to consider (keep the ones that exist, name them in the
industry's own terms):

1. Raw inputs / resources (commodities, feedstock, land, energy, IP)
2. Intermediate materials / components / consumables
3. Capital equipment (machinery, test equipment, electrical/mechanical, automation)
4. Design / engineering / consulting
5. Construction / project execution (EPC, civil, system integration, commissioning)
6. **Core production / operator layer** — who owns/operates the primary asset or service
7. Software / controls / digital infrastructure (monitoring, cybersecurity, analytics)
8. Distribution / logistics / warehousing
9. Aftermarket / servicing / spares
10. Enabling infrastructure (utilities, testing, certification, financing, compliance, recycling)

Triangulate the chain from several independent sources (institutional/brokerage
sector reports, rating-agency & consulting reports, industry-association material,
the annual reports and DRHPs of unquestioned pure-plays, and global leaders'
investor decks — these often describe the chain most clearly).

## Phase 2 — Discover companies per node (multiple independent routes)

Build a keyword dictionary per node (industry terms, product terms, technical terms,
customer terms, project terms: capacity/plant/campus/order/contract/tender/EPC/
commissioned). Then discover via, in rough priority:

- Exchange filings keyword search (`site:nsearchives.nseindia.com "<product>"`, orders, subsidiaries, commencement of operations)
- Institutional sector reports' supplier/market-share/landscape tables
- DRHP/RHP prospectuses (industry structure, competitors, listed peers, market share) — discovery only, verify independently
- Reverse supply-chain: start from a major operator → "who supplies them?" → then "who else do those suppliers sell to?"
- Tenders / procurement awards (GeM, CPPP, PSU/railway portals) — an **awarded** contract is strong evidence
- Screeners / news / YouTube / forums — **discovery engines only, never proof**

A candidate surfacing through several independent routes deserves more weight.

## Phase 3 — Verify and classify each candidate

A source can *discover* a company but never *qualify* it. Promote a company only
after a primary/credible source shows the actual connection (order, revenue,
capacity, customer, dedicated product/segment). For each candidate record identity
(exact name, listed?, exchange, symbol, operating entity vs parent), value-chain
node(s), the evidence, the economic reality (operating / contracted / under
construction / announced / aspirational — never summed together), materiality
(industry revenue %, order book, capacity — or explicitly "not disclosed"; never
fabricated), and ownership (subsidiary/JV/associate + %).

### Directness score (1–5)

| Level | Meaning |
|---|---|
| 5 | Direct operator — owns/operates the core asset/service; dedicated segment |
| 4 | Verified direct supplier/participant — actual industry order/customer/project/revenue |
| 3 | Dedicated strategic exposure — explicit vertical / specialist product / order pipeline |
| 2 | Natural supplier — products objectively used by the industry, materiality not yet proven |
| 1 | Thematic beneficiary — could benefit if the industry grows; **not** a true peer |
| 0 | False positive — superficial/outdated/unsupported; exclude |

### Evidence grade (A–D)

A = primary exchange/company filing or annual report · B = strong company/institutional
supporting evidence · C = secondary media/discovery · D = no decision-grade primary
source captured this pass (flag, don't silently drop).

### Peer cohort (never collapse into one "peer list")

- **A — True operating peers**: same core activity, comparable model → valuation comps
- **B — Adjacent operating players / large diversified proxies**: same layer, different economics/maturity
- **C — Verified picks-and-shovels suppliers**: sell equipment/components/services into the industry
- **D — Indirect listed proxies**: parent owns a sub/JV/associate in the industry
- **E — Emerging / possible exposure**
- **F — Excluded / false peers** (keep an exclusion log with the reason)

> **Caution:** "peer" ≠ "value-chain participant." Never value an operator against a
> cable/transformer/cooling/telecom supplier using one blended multiple. Each
> value-chain node is its own same-node comparison set.

## Source hierarchy (evidence backbone)

1. **Primary / decision-grade** — exchange filings, regulatory filings, annual reports, audited financials, investor presentations, official press releases, earnings-call commentary, DRHP/RHP, a customer's own announcement naming the supplier/project
2. **Strong independent** — government publications, tender/award documents, regulator data, rating-agency reports, industry-association docs, institutional brokerage research
3. **Reputable secondary** — major financial newspapers, specialist trade press (trace claims back to a primary source)
4. **Discovery only** — screeners, aggregators, blogs, SEO lists, YouTube, social (ideas, never proof)

A company's Level 4–5 inclusion should rest on A-grade evidence. Do **not** rank the
universe by market cap — economic directness first; market cap/liquidity/valuation
only afterwards.

## Output data contract (what the pipeline emits)

The pipeline attaches this to the report so the dashboard's **Value chain** dropdown
(Indian Listed tab) can render any industry:

```jsonc
report.value_chain = {
  "generated_at": "<ISO>",
  "nodes": [ { "key": "<slug>", "label": "<node name>", "use": "<how to use this bucket>" } ],
  "players": [
    {
      "name": "...", "ticker": "...", "exchange": "NSE/BSE",
      "value_chain_nodes": ["<node key>", ...],   // a company may span several nodes
      "cohort": "A|B|C|D|E|F", "directness": 1-5, "evidence": "A|B|C|D",
      "role": "<one-line what it does>", "note": "<what we found / why included>",
      "source": { "label": "Screener", "url": "..." },
      "current": { /* metric map */ }, "series": { /* trend map */ }
    }
  ]
}
```

`report.peers.indian` stays the **clean benchmarked operating set** (cohort A, high
directness) that the Overview / Scorecard / Industry tabs use — the value chain is an
additive explorer, so the core comparison is never contaminated by supplier multiples.

## Pipeline stages (generic, per industry)

1. Resolve the query to its **true industry** (for a stock query, read the company's
   business first, then classify the industry — don't trust the ticker's sector label).
2. **Decompose** the value chain into nodes (Phase 1) with a short keyword set each.
3. **Discover** listed candidates per node (Phase 2) across the independent routes.
4. **Scrape + verify** each candidate (Screener financials + primary-evidence check).
5. **Classify** each into node(s) + directness + cohort + evidence (Phase 3).
6. **Assemble** `report.value_chain` + keep `report.peers.indian` = cohort-A operators.
7. Retain important **private / foreign** players as descriptive context (not in the
   listed investable set) so market-share and structure aren't distorted.
