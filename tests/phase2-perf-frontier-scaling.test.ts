import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Bounded candidate stress for buildCanonicalStrategyFrontier. Pure/offline: contracts are synthesized and pre-normalized,
// so only the frontier is timed. Scaling is judged by an operation-count-free proxy (wall-clock ratio) with generous
// bounds so the test is stable on slow CI yet still detects a pathological blow-up.

const NOW = '2026-09-14T15:00:00.000Z';
// All within the Conventional DTE lattice relative to NOW so every synthetic contract becomes a candidate.
const dates = ['2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13'];
const osi = (expiration: string, strike: number) =>
  `SYN${expiration.slice(2, 4)}${expiration.slice(5, 7)}${expiration.slice(8, 10)}P${String(Math.round(strike * 1000)).padStart(8, '0')}`;

function makeContracts(count: number): NormalizedOptionContract[] {
  const out: NormalizedOptionContract[] = [];
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < count; i += 1) {
    const expiration = dates[i % dates.length];
    assert.ok(expiration !== undefined);
    const strike = 50 + Math.floor(i / dates.length) * 0.5;
    const symbol = osi(expiration, strike);
    const bid = Math.max(0.05, Math.round(rand() * 400) / 100);
    out.push(normalizeOptionContract({
      source: 'ALPACA', underlying: 'SYN', optionSymbol: symbol, occSymbol: symbol, optionType: 'PUT', strike, expiration,
      asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200,
      underlyingTimestamp: NOW, bid, ask: bid + 0.05 + rand() * 0.1, bidSize: 20, askSize: 18, lastTradePrice: bid, lastTradeSize: 1,
      quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 10 + Math.floor(rand() * 500), volumeSource: 'ALPACA',
      openInterest: 50 + Math.floor(rand() * 2000), openInterestSource: 'OPTIONOMICS', iv: 0.2 + rand() * 0.3,
      delta: -(0.05 + rand() * 0.4), gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: NOW,
      greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30,
      maxSpreadPctForExecutable: 0.5,
    }, NOW));
  }
  return out;
}

const routing = (eligible: readonly StrategyFamily[]) => parseStrategyRoutingResponse({
  contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
  results: (['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'] as StrategyFamily[]).map((strategyFamily) => ({
    strategyFamily, eligible: eligible.includes(strategyFamily),
    eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
    reasons: [{ code: 'R', polarity: 0, detail: 'perf' }], policyVersion: 'router-v1' })),
});
const base = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1', stock: null,
  assignmentCapacityQty: 2, aegisNewRiskState: 'ALLOW_FULL' as const, buyingPower: 100_000, brokerAllowedQty: 10,
  sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3, assignmentCapacityQtyCap: 3,
    tailRiskQtyCap: 2, correlationQtyCap: 2, liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0, optionomicsContext: { state: 'UNKNOWN' } as const,
};
const run = (contracts: NormalizedOptionContract[], eligible: readonly StrategyFamily[]) => {
  const started = performance.now();
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts, routing: routing(eligible) } as never);
  return { frontier, ms: performance.now() - started };
};
const best = (contracts: NormalizedOptionContract[], eligible: readonly StrategyFamily[], repeats = 2) => {
  let result = run(contracts, eligible);
  for (let i = 1; i < repeats; i += 1) { const next = run(contracts, eligible); if (next.ms < result.ms) result = next; }
  return result;
};

test('frontier is correct and bounded at 500 / 2000 / 5000 contracts: every in-lattice contract yields exactly one Q candidate', () => {
  for (const n of [500, 2000, 5000]) {
    const { frontier, ms } = run(makeContracts(n), ['THETA_Q']);
    const qBranch = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL');
    assert.ok(qBranch);
    const q = qBranch.candidates;
    assert.equal(q.length, n);
    assert.equal(new Set(q.map((c) => c.candidateId)).size, n, 'candidate ids are unique');
    assert.ok(ms < 60_000, `n=${n} took ${ms.toFixed(0)}ms`);
    assert.equal(frontier.executionAuthorized, false);
  }
});

test('runtime scaling for the Paper (Conventional) branch is not worse than modestly super-linear in practice', () => {
  const small = makeContracts(500);
  const large = makeContracts(5000);
  run(small, ['THETA_Q']); // warm up the JIT so the small sample is not inflated by compilation
  const a = best(small, ['THETA_Q']);
  const b = best(large, ['THETA_Q']);
  const ratio = b.ms / Math.max(a.ms, 1);
  // 10x the candidates: linear ~10x, quadratic ~100x. Measured ~9x. The bound of 50x leaves headroom for CI noise while
  // failing any genuinely quadratic regression (e.g. a per-candidate rebuild or unsorted pairwise scan).
  console.log(`frontier scaling Q-only: 500=${a.ms.toFixed(1)}ms 5000=${b.ms.toFixed(1)}ms ratio=${ratio.toFixed(1)}x`);
  assert.ok(ratio < 50, `10x candidates cost ${ratio.toFixed(1)}x (measured ~9x; a quadratic blow-up would be ~100x)`);
  assert.ok(b.ms < 30_000, `5000 contracts took ${b.ms.toFixed(0)}ms`);
});

test('serialized payload grows linearly: bytes per candidate stay flat, no per-candidate duplication of shared context', () => {
  const sizes = [500, 2000, 5000].map((n) => {
    const { frontier } = run(makeContracts(n), ['THETA_Q']);
    const qBranch = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL');
    assert.ok(qBranch);
    const q = qBranch.candidates;
    // Measured on the Conventional branch alone: the research-only defined-risk branch is a fixed 1,000-structure bound.
    const bytes = Buffer.byteLength(JSON.stringify(q));
    return { n, bytesPerCandidate: bytes / n, witnessMax: Math.max(...q.map((c) => c.dominatedBy.length)) };
  });
  for (const row of sizes) assert.ok(row.witnessMax <= 32, `dominance witnesses are bounded: ${row.witnessMax}`);
  const per = sizes.map((row) => row.bytesPerCandidate);
  assert.ok(Math.max(...per) / Math.min(...per) < 1.6, `bytes per candidate drifted: ${per.map((v) => v.toFixed(0)).join(', ')}`);
  console.log(`frontier payload bytes/candidate: ${per.map((v) => v.toFixed(0)).join(' / ')}`);
});

test('the shared optionomics context and routing payload are carried once per frontier, not once per candidate', () => {
  const marker = 'PHASE2_PERF_SHARED_CONTEXT_MARKER_'.repeat(20);
  const contracts = makeContracts(500);
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts, routing: routing(['THETA_Q']),
    optionomicsContext: { marker } } as never);
  const text = JSON.stringify(frontier);
  assert.equal(text.split(marker).length - 1, 1, 'shared context appears exactly once');
});

test('candidate-bearing branches over a large chain stay bounded: defined-risk pairing is capped, not O(n^2)', () => {
  const { frontier, ms } = run(makeContracts(2000), ['THETA_D']);
  const d = frontier.branches.find((b) => b.branch === 'THETA_DEFINED_RISK');
  assert.ok(d);
  assert.ok(d.candidates.length <= 1_000, `defined-risk structures bounded at 1000, got ${d.candidates.length}`);
  assert.ok(ms < 30_000);
});

test('no per-candidate provider call: the frontier module is synchronous and imports no provider, network or database surface', () => {
  const source = readFileSync('src/theta/canonical-strategy-frontier.ts', 'utf8');
  assert.doesNotMatch(source, /\bawait\b|\basync\b|\bfetch\s*\(|new Promise|setTimeout|\bhttp/i);
  const imports = [...source.matchAll(/^\s*(?:import|\} from)[^'"\n]*['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? '');
  for (const spec of imports) assert.doesNotMatch(spec, /alpaca-provider|optionomics|postgres|pg$|node:https?|node:net|storage\//, spec);
  assert.equal(typeof buildCanonicalStrategyFrontier(
    { ...base, contracts: makeContracts(5), routing: routing(['THETA_Q']) } as never).then, 'undefined', 'returns a value, not a promise');
});

test('direct provider-calling modules do not call providers inside candidate loops of the frontier-adjacent pure modules', () => {
  for (const path of ['src/theta/secured-contract-capacity.ts', 'src/theta/capital-budget-evidence.ts',
    'src/theta/adaptive-decision-brain.ts', 'src/theta/strategy-package.ts']) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /\bawait\b|\bfetch\s*\(|alpaca-provider|\bnew Promise/, path);
  }
});
