// SoSoFlows signal engine · reimplemented from the dashboard's composite model.
// Turns a SoSoValue ETF net-inflow series into a 0-100 conviction score, a
// LONG / SHORT / HOLD verdict, a 5-factor breakdown, streak, and z-score anomaly.
// Pure functions · no I/O · deterministic.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// smooth 0..100 around 50 from a normalized ratio in roughly [-1, 1]
const score100 = (ratio) => clamp(50 + 50 * Math.tanh(ratio), 0, 100);

// rows: newest-first array of { total_net_inflow, cum_net_inflow }
export function computeSignal(rows) {
  const flows = rows.map((r) => Number(r.total_net_inflow) || 0);
  const cum = rows.map((r) => Number(r.cum_net_inflow) || 0);
  if (flows.length < 2) {
    return { score: 50, verdict: 'HOLD', confidence: 0, factors: {}, note: 'insufficient history' };
  }

  const last = flows[0];
  const slice = (n) => flows.slice(0, Math.min(n, flows.length));
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const sum7 = sum(slice(7));
  const win30 = slice(30);
  const sum30 = sum(win30);
  const avg30 = sum30 / win30.length;
  const win14 = slice(14);
  const positives14 = win14.filter((x) => x > 0).length;

  // scale guards (USD magnitudes are large) · normalize by the typical daily size
  const scale = Math.max(1, Math.abs(avg30) || 0, ...win14.map(Math.abs)) || 1;

  // 1 · direction (30%) · net 7d flow direction & weight
  const dir = score100(sum7 / (Math.abs(avg30) * 7 || scale * 7));
  // 2 · momentum (25%) · actual 7d vs the 30d-implied 7d expectation (sum30/4 ≈ 7.5d)
  const expect7 = sum30 / 4;
  const mom = score100((sum7 - expect7) / (Math.abs(expect7) || scale));
  // 3 · consistency (20%) · share of last 14d that were inflows
  const consistency = (positives14 / win14.length) * 100;
  // 4 · magnitude (15%) · latest day vs 30d average
  const mag = score100((last - avg30) / (Math.abs(avg30) || scale));
  // 5 · cumulative trend (10%) · 7d change in cumulative net inflow
  const cumTrend = cum.length > 7 ? cum[0] - cum[7] : sum7;
  const cumScore = score100(cumTrend / (Math.abs(cum[0]) * 0.02 || scale * 7));

  const factors = {
    direction: round(dir),
    momentum: round(mom),
    consistency: round(consistency),
    magnitude: round(mag),
    cumulative_trend: round(cumScore),
  };
  const score = round(
    0.30 * dir + 0.25 * mom + 0.20 * consistency + 0.15 * mag + 0.10 * cumScore
  );

  const verdict = score >= 66 ? 'LONG' : score <= 34 ? 'SHORT' : 'HOLD';
  const confidence = round(Math.abs(score - 50) * 2); // 0 at neutral, 100 at extremes

  // streak: consecutive same-sign days from newest
  let streak = 0;
  const sign0 = Math.sign(last);
  if (sign0 !== 0) { for (const f of flows) { if (Math.sign(f) === sign0) streak++; else break; } }

  // z-score anomaly: last vs 14d mean/std
  const mean14 = sum(win14) / win14.length;
  const sd14 = Math.sqrt(sum(win14.map((x) => (x - mean14) ** 2)) / win14.length) || 1;
  const z = (last - mean14) / sd14;
  const anomaly = Math.abs(z) > 2;

  return {
    score, verdict, confidence, factors,
    streak: { days: streak, kind: sign0 > 0 ? 'inflow' : sign0 < 0 ? 'outflow' : 'flat' },
    anomaly: { is_anomaly: anomaly, z_score: round(z, 2) },
    stats: { last: round(last), sum7: round(sum7), avg30: round(avg30), cum_net: round(cum[0]) },
  };
}

// cohort regime across multiple assets' signals
export function computeRegime(perAsset) {
  const entries = Object.entries(perAsset).filter(([, s]) => s && s.score != null);
  if (!entries.length) return { regime: 'unknown', confidence: 0, members: 0 };
  const scores = entries.map(([, s]) => s.score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const bull = entries.filter(([, s]) => s.score >= 55).length;
  const bear = entries.filter(([, s]) => s.score <= 45).length;
  let regime = 'mixed';
  if (bull > bear && avg >= 55) regime = 'risk-on';
  else if (bear > bull && avg <= 45) regime = 'risk-off';
  const lopsided = Math.abs(bull - bear) / entries.length; // 0..1
  const confidence = round(clamp((lopsided * 70) + (Math.abs(avg - 50) / 50) * 30, 0, 100));
  return {
    regime, confidence, avg_score: round(avg),
    bullish: bull, bearish: bear, members: entries.length,
  };
}

function round(x, d = 0) { const p = 10 ** d; return Math.round((Number(x) || 0) * p) / p; }
