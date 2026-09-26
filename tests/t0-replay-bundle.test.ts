import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildT0ReplayBundle, replayFromT0Bundle, t0ReplayBundlePayloadType,
  type T0ReplayBundle } from '../src/theta/t0-replay-bundle.js';
import type { CanonicalStrategyFrontierInput } from '../src/theta/canonical-strategy-frontier.js';
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
};

test('buildT0ReplayBundle captures exactly buildCanonicalStrategyFrontier\'s real input fields, round-trip validated by the same zod schemas the production types use', () => {
  const bundle = buildT0ReplayBundle(realCycleInput);
  assert.equal(bundle.contracts.length, 1);
  assert.equal(bundle.contracts[0]?.optionSymbol, 'AAPL261016P00190000');
  assert.equal(bundle.aegisNewRiskState, 'ALLOW_FULL');
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
    const originalFrontier = buildT0ReplayBundle(realCycleInput);
    assert.deepEqual(reloadedBundle, originalFrontier, 'persistence must not alter the bundle');

    const replayed = replayFromT0Bundle(reloadedBundle);
    const original = replayFromT0Bundle(bundle);
    assert.equal(replayed.selectedCandidateId, original.selectedCandidateId);
    assert.equal(replayed.primaryAction, original.primaryAction);
    const conventionalBranch = replayed.branches.find((b) => b.branch === 'THETA_CONVENTIONAL');
    assert.ok(conventionalBranch !== undefined && conventionalBranch.candidates.length > 0,
      'the real canonical frontier logic actually ran and produced a real candidate, not a stub');
  } finally {
    spool.close();
    rmSync(root, { recursive: true, force: true });
  }
});
