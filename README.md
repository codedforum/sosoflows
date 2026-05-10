# SoSoFlows

Agentic ETF flow analyst built on the SoSoValue API. Wave 1 submission for the [SoSoValue Buildathon](https://app.akindo.io/wave-hacks/JBEQXgN4Zi2jA3wA).

**Live demo:** https://smartcoded.xyz/sosoflows/

## What it does

Spot ETF inflow data is the cleanest read on real institutional positioning across BTC, ETH, SOL, and XRP. SoSoFlows pulls it from SoSoValue, runs a deterministic 7d-vs-prior-7d signal engine per asset, and writes a plain-English daily brief so a one-person operator gets institutional-grade context without 8 tabs and a Bloomberg subscription.

## Wave 1 features

- Real SoSoValue API integration via a server-side whitelisted PHP proxy
- Coverage of 4 spot ETF symbols (BTC, ETH, SOL, XRP) across US and HK markets
- Per-asset Signal-to-Action card (bullish, bearish, fading, neutral) with reasoning + recommended action
- Daily Brief panel - synthesized cross-asset summary, regenerated every 6 hours
  - Static mode: deterministic summary from cached data, works without an LLM key
  - Groq mode: drop a Groq API key on the server to enable Llama 3.3 70B-generated briefs
- 30-day net inflow chart per asset
- Recent 14-day rows table
- SSI on-chain index references (live on Base via SSI Protocol)
- Aggressive disk caching to respect Demo plan rate limits (10 calls per month, 1 RPM)

## Architecture

```
Browser (vanilla JS)
    |
    v
api.php  (whitelisted proxy, 7-day disk cache)
    |
    v
openapi.sosovalue.com/openapi/v1/etfs/summary-history

Browser (Daily Brief card)
    |
    v
ai.php  (reads cached series, writes 6-hour-cached brief)
    |
    +-- static mode: deterministic summary from stats
    +-- groq mode:   POST api.groq.com/openai/v1/chat/completions
```

No client framework. No build step. PHP + vanilla JS + Geist font.

## Files

| File | Role |
|---|---|
| `index.html` | Single-page dashboard, vanilla JS, Geist + Geist Mono |
| `api.php` | SoSoValue API proxy with whitelist + 7-day disk cache |
| `ai.php` | Daily Brief generator, supports static and Groq modes |
| `.htaccess` | Override parent rewrites, deny dotfile access |
| `.api-key` | server-side SoSoValue API key (NOT in this repo) |
| `.groq-key` | optional Groq API key (NOT in this repo) |
| `.cache/` | disk cache directory, created at runtime |

## Setup

1. Drop the files into a directory served by Apache + PHP 7.4+.
2. Place your SoSoValue API key in `.api-key` (chmod 600).
3. (Optional) Place a Groq API key in `.groq-key` to enable AI-generated daily briefs.
4. Make sure the server can write to `.cache/` (the proxy creates it on first call).
5. Open `index.html` in a browser. First load fetches data from upstream and caches it locally.

## API endpoints used

- `GET /etfs/summary-history?symbol={BTC|ETH|SOL|XRP}&country_code={US|HK}&limit=60` - daily ETF flow rows
- `GET /indices` - SSI ticker list (currently hardcoded to save Demo plan calls)

## Roadmap

- **Wave 1 (current):** concept + early prototype, this submission
- **Wave 2:** SoDEX testnet integration. Each signal card links to a one-click trade flow. Add SSI rebalance correlation overlay.
- **Wave 3:** risk control layer, confirmation modals, deployable Telegram bot version using the same agent core.

## Judging fit

| Weight | Criterion | How SoSoFlows hits it |
|---|---|---|
| 30% | User Value and Practical Impact | Plain-English daily briefs replace 30 minutes of cross-tab research for a retail or solo operator |
| 25% | Functionality and Working Demo | Live demo at smartcoded.xyz/sosoflows/, real data, no mocks |
| 20% | Logic, Workflow, Product Design | Three-layer flow: data fetch + caching, deterministic signal engine, brief synthesis |
| 15% | Data and API Integration | Genuine SoSoValue API integration via whitelisted proxy, respects Demo plan limits |
| 10% | UX and Clarity | Single dashboard, clear hierarchy, dark theme, no learning curve |

## License

MIT

## Built by

[@smartcoded](https://x.com/smartcoded) - Wave 1 SoSoValue Buildathon, May 2026
