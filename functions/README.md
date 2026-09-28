# Cloudflare Pages Functions

_API routes arrive in Step 2._

This directory is a placeholder. In **Step 2**, the live research pipeline
(Screener scraping via Playwright, global-peer sourcing, and Claude-on-Bedrock
reasoning) will be exposed here as [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)
— e.g. `functions/api/report/[slug].js` — behind the **exact same JSON data
contract** the Step-1 frontend already consumes from `public/data/`.

Nothing here runs in Step 1: the site is fully static and reads committed JSON.
