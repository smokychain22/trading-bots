import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildT0ReplayBundle, classifyT0ReplayBundleBuildError, replayFromT0Bundle, t0ReplayBundlePayloadType,
  type T0ReplayBundle } from '../src/theta/t0-replay-bundle.js';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontierInput } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import { LocalEvidenceSpool } from '../src/theta/local-evidence-spool.js';

// Phase 1 Zero-Unknown Reclosure Pass 3 continuation (items 17, 24-25).
// The real, exhaustive T0 source search for the Sep24 episode
// (no-submit-7981e31e-367c-49f6-99b7-f6b2de657e27) is documented in
// t0-replay-bundle.ts's own module comment and in
// THETA_T0_RECONSTRUCTION_LEDGER.md: every persisted payload for that
// cycle is a deliberately coarse, sanitized summary, never the raw
// contracts/routing/optionomicsContext buildCanonicalStrategyFrontier
// needs. That historical episode is honestly
// NOT_RECONSTRUCTABLE_FROM_PERSISTED_T0 -- this test instead proves the
// FUTURE fix works: a bundle built from a representative real-shaped cycle
// (SYNTHETIC_FIXTURE_MATCHING_REAL_SHAPE, never claimed as the real Sep24
// data), persisted through the exact same LocalEvidenceSpool envelope
// mechanism, reloaded, and replayed through the real
// buildCanonicalStrategyFrontier -- zero provider calls, zero mocked
// decision logic.
const NOW = '2026-09-14T15:00:00.000Z';

function contract(overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}): NormalizedOptionContract {
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
    optionType: 'PUT', strike: 190, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100,
    underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
    bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
    quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
    openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
    rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2, ...overrides,
  }, NOW);
}

function routing(eligible: readonly StrategyFamily[]) {
  const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
  return parseStrategyRoutingResponse({
    contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
    results: families.map((strategyFamily) => ({
      strategyFamily, eligible: eligible.includes(strategyFamily),
      eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
      reasons: [{ code: eligible.includes(strategyFamily) ? 'ROUTE_APPLICABLE' : 'ROUTE_NOT_APPLICABLE', polarity: 0, detail: 'test route' }],
      policyVersion: 'router-v1',
    })),
  });
}

const realCycleInput: CanonicalStrategyFrontierInput = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1',
  contracts: [contract()], routing: routing(['THETA_Q']),
  stock: null, assignmentCapacityQty: 2, aegisNewRiskState: 'ALLOW_FULL',
  buyingPower: 100_000, eventState: null, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' },
  brokerAllowedQty: 3,
  brokerAllowedQtyByCandidateId: { 'THETA_CONVENTIONAL:AAPL261016P00190000': 1 },
  sizingPolicy: { policyVersion: 'sizing-v1', riskBudgetQtyCap: 4, collateralQtyCap: 3,
    concentrationQtyCap: 2, assignmentCapacityQtyCap: 2, tailRiskQtyCap: 2,
    correlationQtyCap: 2, liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  openingCostPolicy: { commissionPerContract: 0.65, feesPerContract: 0.05,
    estimatedSlippagePerContract: 1, costModelVersion: 'test-cost-v1' },
  aegisNewRiskStateByCandidateId: { 'THETA_CONVENTIONAL:AAPL261016P00190000': 'ALLOW_REDUCED' },
  aegisBindingReasonsByCandidateId: { 'THETA_CONVENTIONAL:AAPL261016P00190000': ['CANDIDATE_LIMIT'] },
  entryEligibilityByOptionSymbol: { AAPL261016P00190000: {
    basis: 'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED', paperBootstrapPolicyVersion: 'bootstrap-v1',
    paperBootstrapAllowedUnknownComponents: ['EXPECTED_AFTER_COST_EV'],
    paperBootstrapReasonCodes: ['BOUNDED_PAPER_BOOTSTRAP'],
  } },
  thetaQCandidateEvaluationByOptionSymbol: { AAPL261016P00190000: {
    state: 'EVALUATED_FEASIBLE', reasonCode: null,
  } },
  thetaQDecision: {
    snapshotId: 'snap-1', timestamp: NOW, underlying: 'AAPL', winningAction: 'OPEN_REDUCED',
    selectedCandidateId: 'AAPL261016P00190000', quantity: 1,
  },
};

test('buildT0ReplayBundle captures exactly buildCanonicalStrategyFrontier\'s real input fields, round-trip validated by the same zod schemas the production types use', () => {
  const bundle = buildT0ReplayBundle(realCycleInput);
  assert.equal(bundle.contracts.length, 1);
  assert.equal(bundle.contracts[0]?.optionSymbol, 'AAPL261016P00190000');
  assert.equal(bundle.aegisNewRiskState, 'ALLOW_FULL');
  assert.equal(bundle.aegisNewRiskStateByCandidateId?.['THETA_CONVENTIONAL:AAPL261016P00190000'], 'ALLOW_REDUCED');
  assert.equal(bundle.thetaQCandidateEvaluationByOptionSymbol?.AAPL261016P00190000?.state, 'EVALUATED_FEASIBLE');
  assert.equal(bundle.openingCostPolicy?.costModelVersion, 'test-cost-v1');
  assert.equal(bundle.thetaQDecision?.winningAction, 'OPEN_REDUCED');
});

test('REAL_CANONICAL_BRAIN_REPLAY: a bundle built, persisted, and reloaded through the real LocalEvidenceSpool mechanism replays to the real, same-shape frontier -- zero provider calls', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-t0-replay-'));
  const spool = new LocalEvidenceSpool(join(root, 'spool.sqlite'));
  try {
    const bundle = buildT0ReplayBundle(realCycleInput);
    const sha = '1234567890abcdef1234567890abcdef12345678';
    spool.append({
      decisionCycleId: 'cycle-t0-replay-test', snapshotId: bundle.snapshotId, decisionAsOf: NOW, sourceSha: sha,
      workerId: 'test-worker', sequenceNumber: 0, payloadType: t0ReplayBundlePayloadType, payload: bundle,
      providerObservedAt: {}, receivedAt: NOW, computedAt: NOW,
    });
    const reloaded = spool.listByPayloadType(t0ReplayBundlePayloadType, 10);
    assert.equal(reloaded.length, 1);
    const reloadedBundle = reloaded[0]?.payload as T0ReplayBundle;
    const originalBundle = buildT0ReplayBundle(realCycleInput);
    assert.deepEqual(reloadedBundle, originalBundle, 'persistence must not alter the bundle');

    const replayed = replayFromT0Bundle(reloadedBundle);
    const original = buildCanonicalStrategyFrontier(realCycleInput);
    assert.equal(replayed.selectedCandidateId, original.selectedCandidateId);
    assert.equal(replayed.primaryAction, original.primaryAction);
    assert.equal(replayed.selectedQuantity, original.selectedQuantity);
    assert.equal(replayed.contentHash, original.contentHash);
    const conventionalBranch = replayed.branches.find((b) => b.branch === 'THETA_CONVENTIONAL');
    assert.ok(conventionalBranch !== undefined && conventionalBranch.candidates.length > 0,
      'the real canonical frontier logic actually ran and produced a real candidate, not a stub');
  } finally {
    spool.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// Phase 1 Zero-Unknown Reclosure Pass 3 continuation (item 5): a too-large
// bundle must never be silently omitted -- it must be classified as an
// explicit, deterministic evidence gap.
test('a too-large bundle is never silently omitted: it throws a deterministic, classifiable error', () => {
  const manyContracts = Array.from({ length: 20_000 }, (_, index) => contract({
    optionSymbol: `AAPL261016P${String(100_000 + index).padStart(8, '0')}`,
    occSymbol: `AAPL261016P${String(100_000 + index).padStart(8, '0')}`, strike: 100 + index,
  }));
  const oversizedInput: CanonicalStrategyFrontierInput = { ...realCycleInput, contracts: manyContracts };
  assert.throws(() => buildT0ReplayBundle(oversizedInput), /T0_REPLAY_BUNDLE_TOO_LARGE:\d+/);
  try {
    buildT0ReplayBundle(oversizedInput);
    assert.fail('expected buildT0ReplayBundle to throw for an oversized bundle');
  } catch (error) {
    const classified = classifyT0ReplayBundleBuildError(error);
    assert.equal(classified.reason, 'TOO_LARGE');
    assert.ok(typeof classified.byteSize === 'number' && classified.byteSize > 0);
  }
});

test('a genuine build failure (invalid input) is classified BUILD_FAILED, distinct from TOO_LARGE', () => {
  const invalidInput = { ...realCycleInput, aegisNewRiskState: 'NOT_A_REAL_STATE' } as unknown as CanonicalStrategyFrontierInput;
  try {
    buildT0ReplayBundle(invalidInput);
    assert.fail('expected buildT0ReplayBundle to throw for an invalid aegisNewRiskState');
  } catch (error) {
    const classified = classifyT0ReplayBundleBuildError(error);
    assert.equal(classified.reason, 'BUILD_FAILED');
    assert.equal(classified.byteSize, null);
  }
});

test('T0 rejects unknown sizing settings instead of silently stripping an unused authority', () => {
  const invalidInput = {
    ...realCycleInput,
    sizingPolicy: { ...realCycleInput.sizingPolicy, maximumTickerAllocationPct: 0.5 },
  } as unknown as CanonicalStrategyFrontierInput;
  assert.throws(() => buildT0ReplayBundle(invalidInput), /unrecognized_keys/i);
});

test('T0 rejects unknown or invalid opening-cost settings', () => {
  const extra = { ...realCycleInput, openingCostPolicy: {
    ...realCycleInput.openingCostPolicy, ungovernedRebate: 1,
  } } as unknown as CanonicalStrategyFrontierInput;
  assert.throws(() => buildT0ReplayBundle(extra), /unrecognized_keys/i);
  const negative = { ...realCycleInput, openingCostPolicy: {
    commissionPerContract: 0.65, feesPerContract: 0.05,
    estimatedSlippagePerContract: -1, costModelVersion: 'bad-cost-v1',
  } } as CanonicalStrategyFrontierInput;
  assert.throws(() => buildT0ReplayBundle(negative));
});

test('T0 rejects non-finite supplementary context before persistence', () => {
  const invalidInput = {
    ...realCycleInput,
    optionomicsContext: { state: 'READY', iv: Number.NaN },
  } as unknown as CanonicalStrategyFrontierInput;
  assert.throws(() => buildT0ReplayBundle(invalidInput));
});

test('T0 replay is stable under candidate reorder and uses no provider surface', () => {
  const second = contract({ optionSymbol: 'AAPL261016P00185000', occSymbol: 'AAPL261016P00185000', strike: 185 });
  const bundle = buildT0ReplayBundle({ ...realCycleInput, contracts: [contract(), second] });
  const reordered: T0ReplayBundle = { ...bundle, contracts: [...bundle.contracts].reverse() };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('NETWORK_FORBIDDEN_DURING_T0_REPLAY'); }) as typeof fetch;
  try {
    assert.equal(replayFromT0Bundle(reordered).contentHash, bundle.expectedFrontierContentHash);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('T0 replay rejects duplicated, missing and tampered candidate inputs', () => {
  const second = contract({ optionSymbol: 'AAPL261016P00185000', occSymbol: 'AAPL261016P00185000', strike: 185 });
  const bundle = buildT0ReplayBundle({ ...realCycleInput, contracts: [contract(), second] });
  const firstContract = bundle.contracts[0];
  assert.ok(firstContract !== undefined);
  assert.throws(() => replayFromT0Bundle({ ...bundle, contracts: [...bundle.contracts, firstContract] }),
    /T0_REPLAY_CONTRACT_INPUT_HASH_MISMATCH/);
  assert.throws(() => replayFromT0Bundle({ ...bundle, contracts: bundle.contracts.slice(1) }),
    /T0_REPLAY_CONTRACT_INPUT_HASH_MISMATCH/);
  const costTamper = { commissionPerContract: 0.65, feesPerContract: 0.05, estimatedSlippagePerContract: 2, costModelVersion: 'tampered-cost-v2' };
  // current bundles carry a whole-bundle integrity hash: any tampered field is rejected by it first
  assert.throws(() => replayFromT0Bundle({ ...bundle, strategyVersion: 'tampered-policy-version' }), /T0_REPLAY_BUNDLE_CONTENT_HASH_MISMATCH/);
  assert.throws(() => replayFromT0Bundle({ ...bundle, openingCostPolicy: costTamper }), /T0_REPLAY_BUNDLE_CONTENT_HASH_MISMATCH/);
  // a bundle persisted before the integrity hash existed is still protected by the frontier hash
  const legacy = { ...bundle, bundleContentHash: undefined };
  assert.throws(() => replayFromT0Bundle({ ...legacy, strategyVersion: 'tampered-policy-version' }), /T0_REPLAY_FRONTIER_HASH_MISMATCH/);
  assert.throws(() => replayFromT0Bundle({ ...legacy, openingCostPolicy: costTamper }), /T0_REPLAY_FRONTIER_HASH_MISMATCH/);
});

test('new T0 bundles require an input hash while historical v2 bundles remain replayable', () => {
  const bundle = buildT0ReplayBundle(realCycleInput);
  assert.equal(bundle.contractVersion, 'theta-t0-replay-bundle-v3');
  assert.match(bundle.inputContractsHash ?? '', /^[0-9a-f]{64}$/);
  assert.throws(() => replayFromT0Bundle({ ...bundle, inputContractsHash: undefined }),
    /T0_REPLAY_CONTRACT_INPUT_HASH_REQUIRED/);
  assert.match(bundle.bundleContentHash ?? '', /^[0-9a-f]{64}$/, 'new bundles always carry the whole-bundle integrity hash');
  const oldBundle = { ...bundle, contractVersion: 'theta-t0-replay-bundle-v2' as const,
    inputContractsHash: undefined, bundleContentHash: undefined };
  assert.equal(replayFromT0Bundle(oldBundle).contentHash, bundle.expectedFrontierContentHash);
});

test('T0 preserves an originally observed duplicate while the frontier counts one option idea', () => {
  const one = contract();
  const bundle = buildT0ReplayBundle({ ...realCycleInput, contracts: [one, one] });
  assert.equal(bundle.contracts.length, 2);
  const frontier = replayFromT0Bundle(bundle);
  assert.equal(frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL')?.candidateCount, 1);
});

test('T0 rejects future observations and unknown router strategies before replay', () => {
  const future = contract({ quoteTimestamp: '2026-09-14T15:00:01.000Z' });
  assert.throws(() => buildT0ReplayBundle({ ...realCycleInput, contracts: [future] }), /future evidence/);
  const bundle = buildT0ReplayBundle(realCycleInput);
  const unknownStrategy = structuredClone(bundle) as unknown as Record<string, unknown>;
  const route = unknownStrategy.routing as { results: Array<{ strategyFamily: string }> };
  const firstRoute = route.results[0];
  assert.ok(firstRoute !== undefined);
  firstRoute.strategyFamily = 'THETA_UNKNOWN';
  assert.throws(() => replayFromT0Bundle(unknownStrategy as unknown as T0ReplayBundle));
});

test('RISK-CAP-01: riskCapacityQtyByCandidateId round-trips through the bundle and replays to the identical hash; a legacy bundle without it still replays', () => {
  const withCapacity: CanonicalStrategyFrontierInput = { ...realCycleInput,
    riskCapacityQtyByCandidateId: { 'THETA_CONVENTIONAL:AAPL261016P00190000': 1, 'THETA_CONVENTIONAL:OTHER': null } };
  const bundle = buildT0ReplayBundle(withCapacity);
  assert.deepEqual(bundle.riskCapacityQtyByCandidateId, withCapacity.riskCapacityQtyByCandidateId);
  assert.equal(replayFromT0Bundle(JSON.parse(JSON.stringify(bundle)) as T0ReplayBundle).contentHash, bundle.expectedFrontierContentHash);
  const legacy = buildT0ReplayBundle(realCycleInput);
  assert.ok(!('riskCapacityQtyByCandidateId' in legacy), 'absent field stays absent (archived-bundle shape unchanged)');
  assert.equal(replayFromT0Bundle(JSON.parse(JSON.stringify(legacy)) as T0ReplayBundle).contentHash, legacy.expectedFrontierContentHash);
});
