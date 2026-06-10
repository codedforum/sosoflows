// End-to-end smoke test: spins up the server over stdio as a real MCP client,
// lists the tools, and calls each one. Runs in demo mode (no SOSO_API_KEY).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'src', 'index.js');

const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`TOOLS (${tools.length}):`, tools.map((t) => t.name).join(', '));

const firstText = (r) => r.content?.find((c) => c.type === 'text')?.text || '';
const calls = [
  ['about', {}],
  ['get_etf_flows', { symbol: 'BTC', country_code: 'US', limit: 3 }],
  ['get_etf_signal', { symbol: 'BTC' }],
  ['get_cohort_regime', { country_code: 'US' }],
  ['compare_etf_signals', { symbols: ['BTC', 'ETH', 'SOL', 'XRP'] }],
  ['list_indices', {}],
  ['build_sodex_order_envelope', { symbol: 'BTC', side: 'BUY', sizeUsd: 250 }],
];

let pass = 0;
for (const [name, args] of calls) {
  try {
    const r = await client.callTool({ name, arguments: args });
    const txt = firstText(r);
    JSON.parse(txt); // must be valid JSON
    let head = '';
    if (name === 'get_cohort_regime') head = ' regime=' + JSON.parse(txt).regime?.regime;
    if (name === 'get_etf_signal') head = ' score=' + JSON.parse(txt).signal?.score + ' ' + JSON.parse(txt).signal?.verdict;
    if (name === 'compare_etf_signals') head = ' top=' + JSON.parse(txt).ranked?.[0]?.symbol;
    if (name === 'build_sodex_order_envelope') head = ' nonce=' + JSON.parse(txt).nonce;
    console.log(`  OK  ${name}${head}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}
console.log(`\n${pass}/${calls.length} tool calls passed`);
await client.close();
process.exit(pass === calls.length ? 0 : 1);
