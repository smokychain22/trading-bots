import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQFilterAnalysis, qGateRegistry } from '../src/theta/q-filter-analysis.js';
import { buildQEntryFunnel, type QFunnelCandidateFacts, type QEntryFunnelPolicy } from '../src/theta/q-entry-funnel.js';

const policy: QEntryFunnelPolicy = {
  minDte: 20, maxDte: 60, deltaBands: [[0.1, 0.3]], minOpenInterest: 50, minVolume: 10,
  maxSpreadPct: 0.2, candidateQuoteMaxAgeSeconds: 30, staleQuoteMinimumSeconds: 30,
  earningsExclusionDays: 3, aegisTickerSoftCapPct: 0.15, aegisHardCapMultiplier: 1.5,
  reducedStateMultiplier: 0.5,
  quantityCaps: { RISK_BUDGET: 5, COLLATERAL_CAP: 5, CONCENTRATION_CAP: 5,
    ASSIGNMENT_CAPACITY_CAP: 5, TAIL_RISK_CAP: 5, CORRELATION_CAP: 5, LIQUIDITY_CAP: 5 },
};

function candidate(id: string, overrides: Partial<QFunnelCandidateFacts> = {}): QFunnelCandidateFacts {
  return {
    candidateId: id, optionSymbol: id, optionType: 'PUT', occSymbol: id, multiplier: 100,
    strike: 10, dte: 30, delta: -0.2, spreadPct: 0.1, openInterest: 100, volume: 20,
    bid: 1, ask: 1.1, quoteAgeSeconds: 1, quoteSource: 'ALPACA', quoteTimestamp: '2026-10-01T15:00:00Z', executable: true,
    nonExecutableCauses: [], earningsDistanceSessions: null, eventState: 'CLEAR', finalist: true,
    entryBasis: 'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED', aegisState: 'ALLOW_FULL', aegisReasons: [],
    finalQuantity: 1, finalQuantityBinding: 'RISK_BUDGET',
    ...overrides,
  };
}

const account = { equity: 100_000, buyingPower: 100_000,
  instrumentApproval: { state: 'APPROVED' as const, reason: null } };

test('marginal analysis distinguishes unique blockers from interacting gates', () => {
  const receipt = buildQEntryFunnel({ policy, account, candidates: [
    candidate('unique-volume', { volume: 0 }),
    candidate('wide-and-thin', { spreadPct: 0.5, openInterest: 0 }),
    candidate('accepted'),
  ] });
  const analysis = buildQFilterAnalysis(receipt);
  const volume = analysis.marginalGates.find((gate) => gate.stageId === 'VOLUME');
  const spread = analysis.marginalGates.find((gate) => gate.stageId === 'SPREAD');
  assert.equal(volume?.singleGateRemovalEligibleCount, 1);
  assert.equal(spread?.singleGateRemovalEligibleCount, 0);
  assert.equal(spread?.coFailingCandidateCount, 1);
  assert.equal(analysis.gateInteractions['OPEN_INTEREST+SPREAD'], 1);
  assert.equal(analysis.empiricalState, 'READY_FOR_DATA');
  assert.equal(analysis.executionAuthorized, false);
  assert.equal(qGateRegistry.find((gate) => gate.stageId === 'AEGIS')?.role, 'HARD_SAFETY');
});

test('regret uses only valid matured labels and keeps modeled evidence separate', () => {
  const receipt = buildQEntryFunnel({ policy, account, candidates: [
    candidate('rejected', { volume: 0 }), candidate('accepted'),
  ] });
  const analysis = buildQFilterAnalysis(receipt, [
    { candidateId: 'rejected', decisionAt: '2026-10-01T15:00:00Z', labelAvailableAt: '2026-10-02T20:00:00Z',
      identifiability: 'OBSERVED_PARALLEL', afterCostPnl: 25, tailLossAvoided: 0 },
    { candidateId: 'accepted', decisionAt: '2026-10-01T15:00:00Z', labelAvailableAt: '2026-10-02T20:00:00Z',
      identifiability: 'ESTIMABLE', afterCostPnl: -5, tailLossAvoided: null },
    { candidateId: 'bad-time', decisionAt: '2026-10-02T15:00:00Z', labelAvailableAt: '2026-10-01T20:00:00Z',
      identifiability: 'OBSERVED_PARALLEL', afterCostPnl: 99, tailLossAvoided: 0 },
  ]);
  const volume = analysis.regretByGate.find((gate) => gate.stageId === 'VOLUME');
  assert.equal(volume?.resolvedOutcomeCount, 1);
  assert.equal(volume?.profitableRejectedCount, 1);
  assert.equal(volume?.falseRejectRate, 1);
  assert.equal(analysis.acceptedResolvedCount, 1);
  assert.equal(analysis.acceptedBadCount, 1);
  assert.equal(analysis.labelsRejected, 1);
  assert.equal(analysis.empiricalState, 'DATA_ACCUMULATING');
});

test('duplicate candidate labels fail rather than inflating the denominator', () => {
  const receipt = buildQEntryFunnel({ policy, account, candidates: [candidate('rejected', { volume: 0 })] });
  const label = { candidateId: 'rejected', decisionAt: '2026-10-01T15:00:00Z', labelAvailableAt: '2026-10-02T20:00:00Z',
    identifiability: 'OBSERVED_PARALLEL' as const, afterCostPnl: 25, tailLossAvoided: 0 };
  assert.throws(() => buildQFilterAnalysis(receipt, [label, label]), /Q_FILTER_DUPLICATE_LABEL/);
});
