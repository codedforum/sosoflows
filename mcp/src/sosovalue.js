// SoSoValue API client for the MCP server.
// BYOK: reads SOSO_API_KEY from the environment and calls the live SoSoValue
// OpenAPI. If no key is set (or a call fails), it falls back to the bundled
// demo snapshot so every tool still returns something useful offline.
//
// The Demo plan is 10 calls/month, so responses are cached in-memory for the
// process lifetime and (best effort) to a disk cache, mirroring how the
// SoSoFlows dashboard respects the quota.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SOSO_API_BASE || 'https://openapi.sosovalue.com/openapi/v1';
const KEY = process.env.SOSO_API_KEY || '';
const CACHE_TTL_MS = Number(process.env.SOSO_CACHE_TTL_MS || 6 * 60 * 60 * 1000); // 6h
const CACHE_DIR = process.env.SOSO_CACHE_DIR || path.join(HERE, '..', '.cache');

export const ETF_SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'LTC', 'HBAR', 'DOGE', 'LINK', 'AVAX', 'DOT'];
export const COUNTRIES = ['US', 'HK'];

const mem = new Map();

function demo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'sample-flows.json'), 'utf8'));
  } catch { return {}; }
}

function diskGet(key) {
  try {
    const f = path.join(CACHE_DIR, key.replace(/[^a-z0-9_-]/gi, '_') + '.json');
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Date.now() - raw.at < CACHE_TTL_MS) return raw.data;
  } catch {}
  return null;
}

function diskPut(key, data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(CACHE_DIR, key.replace(/[^a-z0-9_-]/gi, '_') + '.json'),
      JSON.stringify({ at: Date.now(), data })
    );
  } catch {}
}

// Low-level GET with caching + graceful fallback. Returns { data, source }.
async function get(endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const key = endpoint + (qs ? '?' + qs : '');

  const m = mem.get(key);
  if (m && Date.now() - m.at < CACHE_TTL_MS) return { data: m.data, source: 'cache' };
  const d = diskGet(key);
  if (d) { mem.set(key, { at: Date.now(), data: d }); return { data: d, source: 'cache' }; }

  if (!KEY) return { data: demoFor(endpoint, params), source: 'demo (no SOSO_API_KEY set)' };

  try {
    const url = `${BASE}/${endpoint}${qs ? '?' + qs : ''}`;
    const res = await fetch(url, {
      headers: { 'x-soso-api-key': KEY, accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    const json = await res.json();
    // SoSoValue wraps payloads as { code, message, data }
    const data = json && Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
    if (json && json.code && json.code !== 0) {
      return { data: demoFor(endpoint, params), source: `demo (api error: ${json.message || json.code})` };
    }
    mem.set(key, { at: Date.now(), data });
    diskPut(key, data);
    return { data, source: 'live' };
  } catch (e) {
    return { data: demoFor(endpoint, params), source: `demo (fetch failed: ${e.message})` };
  }
}

function demoFor(endpoint, params) {
  const all = demo();
  if (endpoint === 'etfs/summary-history') {
    const sym = (params.symbol || 'BTC').toUpperCase();
    const c = (params.country_code || 'US').toUpperCase();
    return (all.flows && all.flows[`${sym}_${c}`]) || [];
  }
  if (endpoint === 'indices') return all.indices || [];
  return all[endpoint] || [];
}

// Public surface used by the tools.
export async function etfFlows(symbol = 'BTC', country = 'US') {
  symbol = String(symbol).toUpperCase();
  country = String(country).toUpperCase();
  const { data, source } = await get('etfs/summary-history', { symbol, country_code: country });
  return { symbol, country, rows: Array.isArray(data) ? data : [], source };
}

export async function indices() {
  const { data, source } = await get('indices', {});
  return { indices: Array.isArray(data) ? data : [], source };
}

export function keyStatus() {
  return KEY ? `live (SOSO_API_KEY set, ${KEY.slice(0, 9)}...)` : 'demo (no SOSO_API_KEY set, using bundled snapshot)';
}
