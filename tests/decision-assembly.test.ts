import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleNewRiskDecision, type CandidateFrontierResult, type NewRiskDecisionInput } from '../src/theta/decision-assembly.js';
import type { NormalizedOptionContract } from '../src/theta/option-contract.js';
import type { AegisAssessmentResponse } from '../src/theta/aegis-contract.js';
import type { SizingResultResponse } from '../src/theta/sizing-contract.js';
import type { ExecutionQualityResponse } from '../src/theta/execution-quality-contract.js';
import type { OwnershipEvaluationResponse } from '../src/theta/ownership-contract.js';
import type { RegimeSnapshotResponse } from '../src/theta/regime-contract.js';

const NOW = new Date().toISOString();

const contract = (overrides: Partial<NormalizedOptionContract> = {}): NormalizedOptionContract => ({
  contractVersion: 'theta-option-contract-v1',
  underlying: 'AAPL',
  optionSymbol: 'AAPL260116P00200000',
  occSymbol: null,
  optionType: 'PUT',
  strike: 200,
  expiration: '2026-01-16',
  dte: 30,
  multiplier: 100,
  underlyingBid: null, underlyingAsk: null, underlyingLast: 209, underlyingReferencePrice: 209, underlyingTimestamp: NOW,
  bid: 3, ask: 3.2, bidSize: null, askSize: null, lastTradePrice: null, lastTradeSize: null,
  quoteTimestamp: NOW, tradeTimestamp: null,
  midpointReference: 3.1, spread: 0.2, spreadPct: 0.064, moneyness: 0.045, distanceToStrikePct: 0.045, breakEven: 197,
  volume: 100, volumeSource: 'ALPACA', openInterest: 500, openInterestSource: 'ALPACA',
  iv: 0.25, delta: -0.2, gamma: null, theta: null, vega: null, rho: null, greeksTimestamp: NOW, greeksSource: 'ALPACA',
  source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD', receivedAt: NOW, dataAgeSeconds: 1,
  executable: true, nonExecutableReason: null,
  ...overrides,
});

const aegis = (state: AegisAssessmentResponse['newRiskState']): AegisAssessmentResponse => ({
  contractVersion: 'theta-aegis-runtime-v1', decisionId: 'd1', snapshotId: 's1', timestamp: NOW, policyVersion: 'v1',
  families: [{ family: 'PER_TRADE', state, reasons: [] }], newRiskState: state, reasons: [],
  permittedActions: ['CLOSE', 'CANCEL', 'BUY_TO_CLOSE', 'RECONCILE', 'REDUCE_POSITION', 'SAFETY_EXIT'],
});

const sizing = (quantity: number): SizingResultResponse => ({
  contractVersion: 'theta-sizing-runtime-v1', decisionId: 'd1', snapshotId: 's1', timestamp: NOW, policyVersion: 'v1',
  quantity, capitalRequired: quantity === 0 ? 0 : quantity * 20000, bindingConstraint: 'RISK_BUDGET', reasons: [],
});

const executionQuality = (action: ExecutionQualityResponse['recommendedAction']): ExecutionQualityResponse => ({
  contractVersion: 'theta-execution-quality-runtime-v2', decisionId: 'd1', snapshotId: 's1', timestamp: NOW, policyVersion: 'v1', positionIntent: 'SELL_TO_OPEN',
  spreadPct: 0.05, fillProbability: 0.8, expectedSlippagePerShare: 0.01,
  acceptable: action === 'SUBMIT', recommendedAction: action, reasons: [],
});

const ownership: OwnershipEvaluationResponse = {
  contractVersion: 'theta-ownership-runtime-v1', snapshotId: 's1', underlyingSymbol: 'AAPL', timestamp: NOW, policyVersion: 'v1',
  ownability: 0.8,
  components: [
    { name: 'LiquidityQuality', value: 1, status: 'TEST', reasons: [] },
    { name: 'StructuralQuality', value: 0.8, status: 'TEST', reasons: [] },
    { name: 'RecoveryQuality', value: 0.7, status: 'TEST', reasons: [] },
    { name: 'TailQuality', value: 0.7, status: 'TEST', reasons: [] },
    { name: 'EventAdjustment', value: 1, status: 'TEST', reasons: [] },
  ],
  thesisInvalidated: false, reasons: [],
};

const regime: RegimeSnapshotResponse = {
  contractVersion: 'theta-regime-runtime-v1', snapshotId: 's1', timestamp: NOW, policyVersion: 'v1',
  trendState: 'BULL', volatilityState: 'NORMAL', eventState: 'NONE', liquidityState: 'NORMAL', stressState: 'NORMAL',
  confidence: 1, reasons: [],
};

const qualifyingCandidate = (id: string, returnPerCapitalDay: number): CandidateFrontierResult => ({
  candidateId: id, contract: contract({ optionSymbol: id }), disposition: 'OPEN_FULL', waitReason: null, rejectionReason: null,
  evNet: 50, returnPerCapitalDay, aegis: aegis('ALLOW_FULL'), sizing: sizing(2), executionQuality: executionQuality('SUBMIT'),
});

const baseInput = (overrides: Partial<NewRiskDecisionInput> = {}): NewRiskDecisionInput => ({
  snapshotId: 'snapshot-1', fusionSnapshotHash: 'a'.repeat(64), timestamp: NOW, underlying: 'AAPL',
  ownership, regime, candidates: [], policyVersion: 'v1',
  modelVersions: { ownership: 'v1', regime: 'v1' }, requiredModelVersions: { ownership: 'v1', regime: 'v1' },
  providerStateGood: true,
  ...overrides,
});

test('a single qualifying candidate is selected with quantity from sizing', () => {
  const decision = assembleNewRiskDecision(baseInput({ candidates: [qualifyingCandidate('C1', 0.002)] }));
  assert.equal(decision.winningAction, 'OPEN_FULL');
  assert.equal(decision.selectedCandidateId, 'C1');
  assert.equal(decision.quantity, 2);
  assert.equal(decision.executionAuthorized, false);
});

test('the highest returnPerCapitalDay candidate wins among multiple qualifiers', () => {
  const decision = assembleNewRiskDecision(baseInput({
    candidates: [qualifyingCandidate('LOW', 0.001), qualifyingCandidate('HIGH', 0.01)],
  }));
  assert.equal(decision.selectedCandidateId, 'HIGH');
});

test('AEGIS HOLD_ONLY disqualifies a candidate even if the frontier said OPEN_FULL', () => {
  const blocked: CandidateFrontierResult = { ...qualifyingCandidate('C1', 0.002), aegis: aegis('HOLD_ONLY') };
  const decision = assembleNewRiskDecision(baseInput({ candidates: [blocked] }));
  assert.equal(decision.winningAction, 'PASS');
  assert.equal(decision.quantity, 0);
});

test('quantity zero from sizing disqualifies a candidate from being selected', () => {
  const zeroQty: CandidateFrontierResult = { ...qualifyingCandidate('C1', 0.002), sizing: sizing(0) };
  const decision = assembleNewRiskDecision(baseInput({ candidates: [zeroQty] }));
  assert.equal(decision.selectedCandidateId, null);
});

test('a non-executable contract disqualifies a candidate regardless of other fields', () => {
  const nonExecutable: CandidateFrontierResult = {
    ...qualifyingCandidate('C1', 0.002),
    contract: contract({ executable: false, nonExecutableReason: 'stale quote' }),
  };
  const decision = assembleNewRiskDecision(baseInput({ candidates: [nonExecutable] }));
  assert.equal(decision.selectedCandidateId, null);
});

test('a WAIT-dispositioned candidate produces WAIT, not PASS, at the decision level', () => {
  const waiting: CandidateFrontierResult = {
    candidateId: 'C1', contract: contract(), disposition: 'WAIT', waitReason: 'WAIT_EVENT', rejectionReason: null,
    evNet: null, returnPerCapitalDay: null, aegis: null, sizing: null, executionQuality: null,
  };
  const decision = assembleNewRiskDecision(baseInput({ candidates: [waiting] }));
  assert.equal(decision.winningAction, 'WAIT');
});

test('no candidates at all produces PASS, never a forced trade', () => {
  const decision = assembleNewRiskDecision(baseInput({ candidates: [] }));
  assert.equal(decision.winningAction, 'PASS');
  assert.equal(decision.quantity, 0);
});

test('bad provider state fails closed with SYSTEM_HOLD, not a strategy veto', () => {
  const decision = assembleNewRiskDecision(baseInput({ providerStateGood: false, candidates: [qualifyingCandidate('C1', 0.002)] }));
  assert.equal(decision.winningAction, 'SYSTEM_HOLD');
  assert.equal(decision.failClosedReason !== null, true);
});

test('model version mismatch fails closed', () => {
  const decision = assembleNewRiskDecision(baseInput({
    modelVersions: { ownership: 'v2', regime: 'v1' },
    candidates: [qualifyingCandidate('C1', 0.002)],
  }));
  assert.equal(decision.winningAction, 'SYSTEM_HOLD');
});

test('missing ownership context fails closed', () => {
  const decision = assembleNewRiskDecision(baseInput({ ownership: null, candidates: [qualifyingCandidate('C1', 0.002)] }));
  assert.equal(decision.winningAction, 'SYSTEM_HOLD');
});

test('a candidate referencing a different underlying fails closed on snapshot consistency', () => {
  const mismatched: CandidateFrontierResult = { ...qualifyingCandidate('C1', 0.002), contract: contract({ underlying: 'MSFT' }) };
  const decision = assembleNewRiskDecision(baseInput({ candidates: [mismatched] }));
  assert.equal(decision.winningAction, 'SYSTEM_HOLD');
});

test('executionAuthorized is always false, even for a winning candidate', () => {
  const decision = assembleNewRiskDecision(baseInput({ candidates: [qualifyingCandidate('C1', 0.002)] }));
  assert.equal(decision.executionAuthorized, false);
});

test('an OPEN_ALTERNATE_EXPIRY candidate qualifies exactly like OPEN_FULL', () => {
  const alternateExpiry: CandidateFrontierResult = { ...qualifyingCandidate('C1', 0.002), disposition: 'OPEN_ALTERNATE_EXPIRY' };
  const decision = assembleNewRiskDecision(baseInput({ candidates: [alternateExpiry] }));
  assert.equal(decision.winningAction, 'OPEN_ALTERNATE_EXPIRY');
  assert.equal(decision.selectedCandidateId, 'C1');
});

test('alternatives array includes every candidate, including disqualified ones', () => {
  const good = qualifyingCandidate('GOOD', 0.01);
  const bad: CandidateFrontierResult = { ...qualifyingCandidate('BAD', 0.001), aegis: aegis('HARD_VETO') };
  const decision = assembleNewRiskDecision(baseInput({ candidates: [good, bad] }));
  assert.equal(decision.alternatives.length, 2);
});

test('an OPEN candidate with UNKNOWN or non-positive economics cannot be selected', () => {
  const unknown: CandidateFrontierResult = { ...qualifyingCandidate('UNKNOWN', 0.01), evNet: null };
  const zeroReturn: CandidateFrontierResult = { ...qualifyingCandidate('ZERO', 0), evNet: 10 };
  const decision = assembleNewRiskDecision(baseInput({ candidates: [unknown, zeroReturn] }));
  assert.equal(decision.selectedCandidateId, null);
  assert.equal(decision.quantity, 0);
});
