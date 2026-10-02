import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { shadowIntentQuantity } from '../src/research/postgres-shadow-virtual-trader.js';

import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { paperBootstrapRuntimePolicy } from '../src/theta/paper-bootstrap-runtime-policy.js';
import { defaultShadowCycleConfig } from '../src/theta/theta-shadow-once.js';
import { parseStrategyRoutingResponse } from '../src/theta/strategy-router-contract.js';

// Phase 2 sizing "2 vs 5": thetaQSizingPolicy.concentrationQtyCap (Python candidate-stage
// preliminary cap) used to be the inline literal 2 while the canonical bootstrap policy
// (feeds structuralSizing) says 5. Outcome A: stale duplicate literal. These tests pin the
// single source of truth and prove the candidate-stage quantity cannot move the final size.

const bootstrap = paperBootstrapRuntimePolicy.sizing;
const config = defaultShadowCycleConfig(
  { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'k', apiSecret: 's' },
  null,
  { pythonExecutablePath: 'python', scriptAllowlist: new Map(), timeoutMs: 1_000, maxOutputBytes: 1_000 },
  [],
  'CALLER_MANUAL',
);

test('thetaQSizingPolicy caps equal the single bootstrap policy source (no 2-vs-5 drift)', () => {
  const q = config.thetaQSizingPolicy as Record<string, unknown>;
  assert.equal(q.riskBudgetQtyCap, bootstrap.riskBudgetQuantityCap);
  assert.equal(q.collateralQtyCap, bootstrap.collateralQuantityCap);
  assert.equal(q.concentrationQtyCap, bootstrap.concentrationQuantityCap);
  assert.equal(q.concentrationQtyCap, 5);
});

test('canonical sizingPolicy caps and the Q candidate-stage caps agree on every shared cap', () => {
  const canonical = config.sizingPolicy as Record<string, unknown>;
  const q = config.thetaQSizingPolicy as Record<string, unknown>;
  for (const key of ['riskBudgetQtyCap', 'collateralQtyCap', 'concentrationQtyCap']) {
    assert.equal(q[key], canonical[key], `${key} differs between candidate-stage and canonical policy`);
  }
  assert.equal(canonical.assignmentCapacityQtyCap, bootstrap.assignmentCapacityQuantityCap);
  assert.equal(canonical.tailRiskQtyCap, bootstrap.tailRiskQuantityCap);
  assert.equal(canonical.correlationQtyCap, bootstrap.correlationQuantityCap);
  assert.equal(canonical.liquidityQtyCap, bootstrap.liquidityQuantityCap);
  assert.equal(canonical.reducedStateMultiplier, bootstrap.reducedStateMultiplier);
});

test('theta-shadow-once carries no inline numeric quantity-cap literal (caps derive from the bootstrap policy)', () => {
  const source = readFileSync(path.resolve('src/theta/theta-shadow-once.ts'), 'utf8');
  assert.deepEqual(source.match(/\b\w*Qty\s*Cap\s*:\s*\d+/gi) ?? [], [], 'inline *QtyCap numeric literal');
  assert.deepEqual(source.match(/\b\w*QtyCap\s*:\s*\d+/g) ?? [], [], 'inline *QtyCap numeric literal');
  assert.deepEqual(source.match(/\b\w*QuantityCap\s*:\s*\d+/g) ?? [], [], 'inline *QuantityCap numeric literal');
});

// ---- candidate-stage quantity is never the final broker-facing size ---------------------

function pythonRequest(concentrationQtyCap: number) {
  const candidate = (id: string, ownership: number, strike: number) => ({
    candidateId: id, underlyingSymbol: 'SYN', dte: 45, strike, putDeltaMagnitude: 0.22, spreadPct: 0.03, quoteAgeSeconds: 1,
    openInterest: 200, volume: 50, earningsDistanceDays: 30, multiplier: 100, entryPremiumPerShare: 1.5,
    ownershipAcceptability: ownership, severeDrawdownProbability: 0.1, ivRank: null, brokerAllowedQty: 5, contractIsStandard: true,
  });
  return {
    contractVersion: 'theta-q-runtime-v1', operation: 'evaluateCspCandidates', fusionSnapshotHash: 'a'.repeat(64),
    latticeConfig: { configVersion: 'lattice-v1', minDte: 30, maxDte: 60, deltaBands: [[0.10, 0.20], [0.20, 0.30]],
      minOpenInterest: 50, minVolume: 10, maxSpreadPct: 0.08, earningsExclusionDays: 5 },
    sizingPolicy: { riskLimitVersion: 'risk-v1', maxSpreadPct: 0.08, maxQuoteAgeSeconds: 5, minOpenInterest: 50, minVolume: 10,
      earningsExclusionDays: 5, ownershipAcceptabilityFloor: 0.5, exceptionalUtilityThreshold: 0.9, strongUtilityThreshold: 0.7,
      minimumPositiveEdge: 0.05, riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap },
    costAssumptions: { commissionPerContract: 0.65, feesPerContract: 0.05, estimatedSlippagePerContract: 1, costModelVersion: 'cost-v1' },
    candidates: [candidate('low', 0.6, 50), candidate('high', 0.9, 55)],
  };
}

interface PythonQResponse {
  readonly candidates: readonly {
    readonly candidateId: string; readonly actionFeasible: unknown; readonly ownershipScore: unknown;
    readonly reasons: readonly { readonly code: unknown }[]; readonly quantity: number;
  }[];
  readonly recommendation: { readonly selectedCandidateId: unknown };
}

function runPythonQ(concentrationQtyCap: number): PythonQResponse | null {
  const request = pythonRequest(concentrationQtyCap);
  const contractVersion = (() => {
    const source = readFileSync(path.resolve('bots/theta/quant/runtime/theta_q_contract.py'), 'utf8');
    return /CONTRACT_VERSION\s*=\s*"([^"]+)"/.exec(source)?.[1] ?? request.contractVersion;
  })();
  const result = spawnSync('python', [path.resolve('bots/theta/quant/runtime/theta_q_contract.py')], {
    input: JSON.stringify({ ...request, contractVersion }), encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) return null;
  return JSON.parse(result.stdout) as PythonQResponse;
}

test('Q candidate-stage concentration cap changes only the preliminary receipt quantity, never feasibility or rank', (t) => {
  const two = runPythonQ(2);
  const five = runPythonQ(5);
  if (two === null || five === null) { t.skip('python interpreter unavailable'); return; }
  const view = (response: PythonQResponse) => response.candidates.map((c) => ({
    id: c.candidateId, feasible: c.actionFeasible, ownership: c.ownershipScore, reasons: c.reasons.map((r) => r.code) }));
  assert.deepEqual(view(two), view(five), 'feasibility, ownership and reasons are cap-independent');
  assert.equal(two.recommendation.selectedCandidateId, five.recommendation.selectedCandidateId, 'ranking is cap-independent');
  const qty = (response: PythonQResponse) => {
    const high = response.candidates.find((c) => c.candidateId === 'high');
    assert.ok(high);
    return high.quantity;
  };
  assert.equal(qty(two), 2, 'min(4,3,2,5)');
  assert.equal(qty(five), 3, 'min(4,3,5,5)');
  assert.ok(qty(two) >= 1 && qty(five) >= 1, 'neither value flips feasibility through quantity zero');
});

const NOW = '2026-09-14T15:00:00.000Z';
function putContract() {
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
    optionType: 'PUT', strike: 190, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100,
    underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
    bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
    quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
    openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
    rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2,
  }, NOW);
}
const routing = parseStrategyRoutingResponse({
  contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
  results: ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'].map((strategyFamily) => ({
    strategyFamily, eligible: strategyFamily === 'THETA_Q',
    eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
    reasons: [{ code: 'ROUTE', polarity: 0, detail: 'test' }], policyVersion: 'router-v1' })),
});

test('final structural quantity is independent of any Q candidate-stage quantity and a Q decision can only lower it', () => {
  const sizingPolicy = { riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6,
    tailRiskQtyCap: 3, correlationQtyCap: 3, liquidityQtyCap: 3, reducedStateMultiplier: 0.5 };
  const id = 'THETA_CONVENTIONAL:AAPL261016P00190000';
  const base = { snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'v', stock: null, assignmentCapacityQty: 99,
    aegisNewRiskState: 'ALLOW_FULL' as const, buyingPower: 1_000_000, brokerAllowedQty: 99, sizingPolicy,
    eventState: 'CLEAR' as const, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
    optionomicsContext: { state: 'UNKNOWN' } as const, contracts: [putContract()], routing };
  const sized = (extra: Record<string, unknown> = {}) => {
    const frontier = buildCanonicalStrategyFrontier({ ...base, ...extra } as never);
    return frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates.find((c) => c.candidateId === id)?.sizing.quantity;
  };
  assert.equal(sized(), 3, 'min(4,3,5,6,3,3,3,99,...)');
  // The frontier input has no field for the Q candidate-stage policy at all.
  assert.equal(Object.hasOwn(base, 'thetaQSizingPolicy'), false);
  // Raising/lowering only the *canonical* concentration cap moves it; the Q cap value 2 or 5 cannot.
  assert.equal(sized({ sizingPolicy: { ...sizingPolicy, concentrationQtyCap: 2 } }), 2);
  assert.equal(sized({ sizingPolicy: { ...sizingPolicy, concentrationQtyCap: 5 } }), 3);
  for (const decisionQuantity of [1, 2, 3, 7]) {
    const frontier = buildCanonicalStrategyFrontier({ ...base, thetaQDecision: { snapshotId: 'snap-1', timestamp: NOW,
      underlying: 'AAPL', winningAction: 'OPEN_FULL', selectedCandidateId: 'AAPL261016P00190000', quantity: decisionQuantity } } as never);
    assert.equal(frontier.selectedQuantity, Math.min(3, decisionQuantity), `decision ${decisionQuantity} may only lower`);
  }
});

test('every src reader of the persisted Q candidate-stage quantity is on a pinned research-only allowlist', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.ts$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
  const pattern = /thetaQ\??\.quantity|evaluatedCandidate\??\.quantity|'thetaQ'->>'quantity'/;
  const readers = walk('src').filter((file) => pattern.test(readFileSync(file, 'utf8'))).map((file) => file.split(path.sep).join('/')).sort();
  // Research/shadow only. None of these is the broker-facing Paper plan assembly.
  // postgres-shadow-virtual-trader sizes a virtual (non-broker) intent from min(Q-stage, final canonical) -- SIZE-VT-01 (fixed).
  assert.deepEqual(readers, ['src/research/historical-replay-export.ts', 'src/research/postgres-shadow-virtual-trader.ts']);
  for (const file of readers) assert.ok(!file.startsWith('src/execution/'), file);
  const trader = readFileSync('src/research/postgres-shadow-virtual-trader.ts', 'utf8');
  assert.match(trader, /canonicalSizing'->>'quantity'/, 'the virtual trader must also read the persisted final canonical quantity');
  assert.match(trader, /shadowIntentQuantity\(row\.quantity,row\.canonical_quantity\)/);
});

test('SIZE-VT-01: shadow intent quantity is min(Q-stage, final canonical); unknown final canonical quantity sizes to zero', () => {
  assert.equal(shadowIntentQuantity(3, 1), 1);
  assert.equal(shadowIntentQuantity(1, 3), 1);
  assert.equal(shadowIntentQuantity('2', '2'), 2);
  assert.equal(shadowIntentQuantity(3, 0), 0, 'AEGIS/structural zero stays zero');
  assert.equal(shadowIntentQuantity(3, null), 0, 'legacy row without canonical quantity is UNKNOWN, not the Q-stage size');
  assert.equal(shadowIntentQuantity(3, undefined), 0);
  assert.equal(shadowIntentQuantity(0, 5), 0);
  assert.equal(shadowIntentQuantity(1.5, 5), 0);
});
