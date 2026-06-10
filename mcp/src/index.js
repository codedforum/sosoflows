#!/usr/bin/env node
// SoSoFlows MCP server.
// Exposes the SoSoFlows agentic ETF-flow toolkit as Model Context Protocol
// tools: live SoSoValue ETF flows, a composite conviction signal, cohort
// regime classification, multi-asset comparison, SSI indices, and a SoDEX
// EIP-712 order envelope builder. Works with Claude Desktop, Cursor, or any
// MCP client over stdio.
//
// Env:
//   SOSO_API_KEY   your SoSoValue OpenAPI key (BYOK). Without it the server
//                  serves the bundled demo snapshot so every tool still works.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { etfFlows, indices, keyStatus, ETF_SYMBOLS } from './sosovalue.js';
import { computeSignal, computeRegime } from './signals.js';
import { buildOrderEnvelope } from './envelope.js';

const COHORT = ['BTC', 'ETH', 'SOL', 'XRP'];
const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

const server = new McpServer({ name: 'sosoflows-mcp', version: '1.0.0' });

server.tool(
  'get_etf_flows',
  'Recent daily spot-ETF net inflow rows for a crypto asset from SoSoValue (date, total_net_inflow, total_value_traded, total_net_assets, cum_net_inflow). Newest first.',
  {
    symbol: z.string().describe('Asset ticker, e.g. BTC, ETH, SOL, XRP'),
    country_code: z.enum(['US', 'HK']).default('US').describe('ETF market, US or HK'),
    limit: z.number().int().min(1).max(60).default(14).describe('How many recent days to return'),
  },
  async ({ symbol, country_code, limit }) => {
    const { rows, source } = await etfFlows(symbol, country_code);
    return ok({ symbol: symbol.toUpperCase(), country_code, source, rows: rows.slice(0, limit) });
  }
);

server.tool(
  'get_etf_signal',
  'Compute the SoSoFlows composite conviction signal (0-100 score, LONG/SHORT/HOLD verdict, 5-factor breakdown, streak, z-score anomaly) for one asset from its ETF net-inflow history.',
  {
    symbol: z.string().describe('Asset ticker, e.g. BTC'),
    country_code: z.enum(['US', 'HK']).default('US'),
  },
  async ({ symbol, country_code }) => {
    const { rows, source } = await etfFlows(symbol, country_code);
    const signal = computeSignal(rows);
    return ok({ symbol: symbol.toUpperCase(), country_code, source, signal });
  }
);

server.tool(
  'get_cohort_regime',
  'Classify the cross-asset regime (risk-on / risk-off / mixed) with a confidence score by scoring BTC, ETH, SOL, and XRP ETF flows together. The macro read that gates trade decisions.',
  { country_code: z.enum(['US', 'HK']).default('US') },
  async ({ country_code }) => {
    const per = {};
    const sources = {};
    for (const sym of COHORT) {
      const { rows, source } = await etfFlows(sym, country_code);
      per[sym] = computeSignal(rows);
      sources[sym] = source;
    }
    const regime = computeRegime(per);
    const verdicts = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { score: v.score, verdict: v.verdict }]));
    return ok({ country_code, regime, per_asset: verdicts, sources });
  }
);

server.tool(
  'compare_etf_signals',
  'Side-by-side composite signals for 2 to 6 assets, ranked by conviction score. Quickly see where the flows are strongest.',
  {
    symbols: z.array(z.string()).min(2).max(6).describe('Tickers, e.g. ["BTC","ETH","SOL"]'),
    country_code: z.enum(['US', 'HK']).default('US'),
  },
  async ({ symbols, country_code }) => {
    const out = [];
    for (const sym of symbols) {
      const { rows } = await etfFlows(sym, country_code);
      const s = computeSignal(rows);
      out.push({ symbol: sym.toUpperCase(), score: s.score, verdict: s.verdict, confidence: s.confidence, last: s.stats?.last, sum7: s.stats?.sum7 });
    }
    out.sort((a, b) => b.score - a.score);
    return ok({ country_code, ranked: out });
  }
);

server.tool(
  'list_indices',
  'List SoSoValue SSI on-chain index tickers (e.g. MAG7.ssi, DEFI.ssi).',
  {},
  async () => {
    const { indices: list, source } = await indices();
    return ok({ source, count: list.length, indices: list });
  }
);

server.tool(
  'build_sodex_order_envelope',
  'Prepare a SoDEX order as a complete EIP-712 typed-data envelope (ValueChain chainId 138565) plus the alpha-sorted canonical payload and a millisecond nonce. Sign it in your own wallet with eth_signTypedData_v4. This tool never signs or submits.',
  {
    symbol: z.string().describe('Asset ticker, e.g. BTC'),
    side: z.enum(['BUY', 'SELL']).default('BUY'),
    sizeUsd: z.number().positive().default(100).describe('Order size in USD'),
    orderType: z.enum(['MARKET', 'LIMIT']).default('MARKET'),
    price: z.number().nonnegative().default(0).describe('Limit price (ignored for MARKET)'),
    account: z.string().default('0x0000000000000000000000000000000000000000').describe('Signer EVM address'),
  },
  async (args) => ok(buildOrderEnvelope(args))
);

server.tool(
  'about',
  'About this server: SoSoFlows, the agentic ETF-flow analyst. Returns the SoSoValue key status and the live SoSoFlows surfaces.',
  {},
  async () => ok({
    name: 'SoSoFlows MCP server',
    what: 'Turns SoSoValue spot-ETF flow data into agentic trading signals and SoDEX order envelopes.',
    soso_api: keyStatus(),
    supported_symbols: ETF_SYMBOLS,
    live_surfaces: {
      dashboard: 'https://smartcoded.xyz/sosoflows/',
      live_agents: 'https://smartcoded.xyz/sosoflows/agents.html',
      reasoning_timeline: 'https://smartcoded.xyz/sosoflows/reasoning.html',
    },
    signal_model: '0-100 composite: direction 30%, momentum 25%, consistency 20%, magnitude 15%, cumulative trend 10%',
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[sosoflows-mcp] ready on stdio ·', keyStatus());
