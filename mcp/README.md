# SoSoFlows MCP server

Bring the SoSoFlows agentic ETF-flow analyst into any MCP client (Claude Desktop, Cursor, Claude Code, or your own agent). It turns SoSoValue spot-ETF flow data into a composite conviction signal, a cross-asset regime read, and a ready-to-sign SoDEX order envelope, all as Model Context Protocol tools.

Part of the [SoSoFlows](https://smartcoded.xyz/sosoflows/) project for the SoSoValue Buildathon.

## Tools

| Tool | What it does |
|---|---|
| `get_etf_flows` | Recent daily spot-ETF net inflow rows for an asset (BTC, ETH, SOL, XRP, ...). US or HK. |
| `get_etf_signal` | The SoSoFlows composite conviction score (0-100), LONG/SHORT/HOLD verdict, 5-factor breakdown, streak, z-score anomaly. |
| `get_cohort_regime` | Classifies the cross-asset regime (risk-on / risk-off / mixed) with a confidence score across BTC, ETH, SOL, XRP. |
| `compare_etf_signals` | Side-by-side conviction signals for 2 to 6 assets, ranked. |
| `list_indices` | SoSoValue SSI on-chain index tickers. |
| `build_sodex_order_envelope` | Prepares a SoDEX order as a complete EIP-712 typed-data envelope (ValueChain chainId 138565) for you to sign in your own wallet. Never signs or submits. |
| `about` | Server info, key status, and the live SoSoFlows surfaces. |

## The signal model

Per asset, a 0-100 composite from five weighted factors:

* direction 30 percent
* momentum 25 percent
* consistency 20 percent
* magnitude 15 percent
* cumulative trend 10 percent

Plus streak detection and a z-score anomaly flag (more than 2 sigma from the 14-day mean). This is the same engine that powers the SoSoFlows dashboard, reimplemented as pure functions.

## Install

```bash
git clone https://github.com/codedforum/sosoflows
cd sosoflows/mcp
npm install
```

## Configure (BYOK)

Set your SoSoValue OpenAPI key so the tools hit live data:

```bash
export SOSO_API_KEY=SOSO-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Get a key at [sosovalue.com/developer](https://sosovalue.com/developer). Without a key the server runs in demo mode against a bundled snapshot, so every tool still returns a sensible result for evaluation. The SoSoValue Demo plan is rate limited, so responses are cached for 6 hours by default.

## Wire into Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sosoflows": {
      "command": "node",
      "args": ["/absolute/path/to/sosoflows/mcp/src/index.js"],
      "env": { "SOSO_API_KEY": "SOSO-xxxx" }
    }
  }
}
```

## Wire into Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sosoflows": {
      "command": "node",
      "args": ["/absolute/path/to/sosoflows/mcp/src/index.js"],
      "env": { "SOSO_API_KEY": "SOSO-xxxx" }
    }
  }
}
```

## Try it

Once wired in, ask your assistant:

* "What is the BTC ETF signal right now?"
* "Is the crypto cohort risk-on or risk-off?"
* "Compare the ETF signals for BTC, ETH, SOL and XRP."
* "Build a SoDEX buy envelope for 250 dollars of ETH."

## Verify it works

```bash
npm run smoke
```

Spins up the server over stdio as a real MCP client and exercises every tool.

## Notes

* The SoDEX envelope tool only prepares the EIP-712 payload. Signing and submission happen in your own wallet. No keys are handled by the server.
* ValueChain testnet uses chainId 138565. The envelope is valid the moment the SoDEX gateway opens.

## License

MIT
