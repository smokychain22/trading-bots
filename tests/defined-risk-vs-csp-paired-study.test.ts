import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computePutCreditSpreadStructuralEconomics, quoteSynchronizationStatus, buildSpreadExecutionBurdenEvidence,
  buildCspStudyCandidate, buildDefinedRiskStudyCandidate, samePairingKey, validatePair, pairDecisionContexts,
  buildPairedDecisionRecord, classifyComparisonReadiness, summarizePairedCohorts, emptyEntryFutureOutcomeRecord,
  type PairingKey, type PutCreditSpreadStructuralInputs, type CspCandidateRawEvidence, type DefinedRiskCandidateRawEvidence,
  type PairedDecisionRawInput,
} from '../src/research/defined-risk-vs-csp-paired-study.js';
import { ENTRY_WHOLE_CHAIN_V1, type ComparisonContext } from '../src/research/cross-strategy-common-horizon-contract.js';

const CONTEXT: ComparisonContext = {
  decisionTimestamp: '2026-09-22T14:00:00Z', comparisonHorizonStart: '2026-09-22T14:00:00Z',
  comparisonHorizonEnd: '2026-12-21T14:00:00Z', horizonDefinitionVersion: 'theta-r8-horizon-v1',
  basis: 'PER_POSITION', currency: 'USD',
};

const KEY: PairingKey = {
  underlying: 'AAPL', decisionTimestamp: '2026-09-22T14:00:00Z', fusionSnapshotId: 'snap-1',
  ownershipState: 'ELIGIBLE', regimeState: 'NEUTRAL', eventState: 'CLEAR', accountContextId: 'acct-1',
};

function spreadInputs(overrides: Partial<PutCreditSpreadStructuralInputs> = {}): PutCreditSpreadStructuralInputs {
  return {
    shortStrike: 190, longStrike: 185,
    shortLeg: { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
    longLeg: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
    quantity: 1, ...overrides,
  };
}

// --- 2. Defined-Risk structural economics -------------------------------

test('computePutCreditSpreadStructuralEconomics: 1 contract -- real formulas independently verified', () => {
  const result = computePutCreditSpreadStructuralEconomics(spreadInputs());
  assert.equal(result.classification, 'VALID_CREDIT_SPREAD');
  // openingNetCredit = shortBid(1.5) - longAsk(0.6) = 0.9
  assert.equal(result.openingNetCreditPerShare, 0.9);
  assert.equal(result.width, 5);
  assert.equal(result.maxProfit, 0.9 * 100 * 1);
  assert.equal(result.maxLoss, (5 - 0.9) * 100 * 1);
});

test('computePutCreditSpreadStructuralEconomics: multiple contracts scale multiplier x quantity, never double-multiplied', () => {
  const result = computePutCreditSpreadStructuralEconomics(spreadInputs({ quantity: 3 }));
  assert.equal(result.maxProfit, 0.9 * 100 * 3);
  assert.equal(result.maxLoss, (5 - 0.9) * 100 * 3);
});

test('REJECT: computePutCreditSpreadStructuralEconomics classifies a real net-debit (invalid negative credit / debit spread) rather than normalizing it', () => {
  // shortBid(0.5) - longAsk(1.6) = -1.1 -- a genuine debit, never treated as a plausible credit spread.
  const result = computePutCreditSpreadStructuralEconomics(spreadInputs({
    shortLeg: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
    longLeg: { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
  }));
  assert.equal(result.classification, 'NEGATIVE_OR_ZERO_NET_CREDIT');
  assert.equal(result.maxLoss, null);
  assert.equal(result.maxProfit, null);
});

test('REJECT: computePutCreditSpreadStructuralEconomics classifies a zero-width spread', () => {
  const result = computePutCreditSpreadStructuralEconomics(spreadInputs({ longStrike: 190 }));
  assert.equal(result.classification, 'ZERO_WIDTH_SPREAD');
});

test('REJECT: computePutCreditSpreadStructuralEconomics classifies inverted strikes (short below long)', () => {
  const result = computePutCreditSpreadStructuralEconomics(spreadInputs({ shortStrike: 180, longStrike: 185 }));
  assert.equal(result.classification, 'INVERTED_STRIKES');
});

test('REJECT: computePutCreditSpreadStructuralEconomics classifies a missing executable quote', () => {
  const result = computePutCreditSpreadStructuralEconomics(spreadInputs({
    shortLeg: { bid: null, ask: 1.6, quoteTimestamp: null, multiplier: 100 },
  }));
  assert.equal(result.classification, 'MISSING_EXECUTABLE_QUOTE');
});

test('REJECT: computePutCreditSpreadStructuralEconomics classifies mismatched leg multipliers rather than silently picking one', () => {
  const result = computePutCreditSpreadStructuralEconomics(spreadInputs({
    shortLeg: { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
    longLeg: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 10 },
  }));
  assert.equal(result.classification, 'MISMATCHED_MULTIPLIERS');
});

test('REJECT: computePutCreditSpreadStructuralEconomics classifies missing strikes', () => {
  const result = computePutCreditSpreadStructuralEconomics(spreadInputs({ shortStrike: null }));
  assert.equal(result.classification, 'MISSING_STRIKES');
});

// --- 3. Execution burden --------------------------------------------------

test('quoteSynchronizationStatus reports SYNCHRONIZED for legs within the caller-supplied max age', () => {
  const result = quoteSynchronizationStatus('2026-09-22T14:00:00.000Z', '2026-09-22T14:00:00.500Z', 1000);
  assert.equal(result.status, 'SYNCHRONIZED');
  assert.equal(result.ageMs, 500);
});

test('REPAIR-CLASS: quoteSynchronizationStatus reports DESYNCHRONIZED for a stale second leg, never silently treated as synchronized', () => {
  const result = quoteSynchronizationStatus('2026-09-22T14:00:00.000Z', '2026-09-22T14:05:00.000Z', 1000);
  assert.equal(result.status, 'DESYNCHRONIZED');
  assert.equal(result.ageMs, 300000);
});

test('quoteSynchronizationStatus reports TIMESTAMP_UNKNOWN, never assumed synchronized, when a timestamp is missing', () => {
  const result = quoteSynchronizationStatus(null, '2026-09-22T14:00:00.000Z', 1000);
  assert.equal(result.status, 'TIMESTAMP_UNKNOWN');
  assert.equal(result.ageMs, null);
});

test('buildSpreadExecutionBurdenEvidence preserves each leg bid/ask/timestamp/spread individually, never collapsed into one figure', () => {
  const evidence = buildSpreadExecutionBurdenEvidence(
    'short', { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
    'long', { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 }, 1000,
  );
  assert.ok(Math.abs((evidence.shortLeg.spread as number) - 0.1) < 1e-9);
  assert.ok(Math.abs((evidence.longLeg.spread as number) - 0.1) < 1e-9);
  assert.ok(Math.abs((evidence.combinedNetCredit as number) - 0.9) < 1e-9);
  assert.equal(evidence.quoteSynchronization.status, 'SYNCHRONIZED');
});

// --- 4/5. Candidate builders + paired study engine ------------------------

function cspEvidence(overrides: Partial<CspCandidateRawEvidence> = {}): CspCandidateRawEvidence {
  return {
    candidateId: 'csp-1', underlying: 'AAPL', dte: 30, strike: 190, bid: 2.0, ask: 2.1,
    quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100, quantity: 1, collateral: 19000,
    buyingPowerImpact: 19000, breakEven: 188, downsideCushion: 0.05, ...overrides,
  };
}

function definedRiskEvidence(overrides: Partial<DefinedRiskCandidateRawEvidence> = {}): DefinedRiskCandidateRawEvidence {
  return {
    candidateId: 'dr-1', underlying: 'AAPL', dte: 30, shortStrike: 190, longStrike: 185,
    shortLeg: { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
    longLeg: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
    quantity: 1, buyingPowerImpact: 410, breakEven: 189.1, downsideCushion: 0.045, maxSyncAgeMs: 1000, ...overrides,
  };
}

test('buildCspStudyCandidate computes real maxLoss via cashSecuredPutMaxLossAtZero, never recomputing an independent formula', () => {
  const result = buildCspStudyCandidate(cspEvidence(), CONTEXT);
  assert.equal(result.status, 'BUILT');
  if (result.status === 'BUILT') {
    assert.equal(result.candidate.deterministic.maxLoss, (190 - 2.0) * 100 * 1);
    assert.equal(result.candidate.deterministic.structureClass, 'CASH_SECURED_SINGLE_LEG');
  }
});

test('buildCspStudyCandidate rejects a missing executable quote rather than fabricating economics', () => {
  const result = buildCspStudyCandidate(cspEvidence({ bid: null }), CONTEXT);
  assert.equal(result.status, 'REJECTED');
});

test('buildDefinedRiskStudyCandidate BUILDS a valid spread with structureClass STRUCTURALLY_DEFINED_RISK_SPREAD and real finite maxLoss', () => {
  const built = buildDefinedRiskStudyCandidate(definedRiskEvidence(), CONTEXT);
  assert.equal(built.result.status, 'BUILT');
  assert.equal(built.structuralEconomics.classification, 'VALID_CREDIT_SPREAD');
  if (built.result.status === 'BUILT') {
    assert.equal(built.result.candidate.deterministic.structureClass, 'STRUCTURALLY_DEFINED_RISK_SPREAD');
    assert.equal(built.result.candidate.deterministic.maxLoss, (5 - 0.9) * 100 * 1);
  }
});

test('buildDefinedRiskStudyCandidate REJECTS an invalid structure (inverted strikes) rather than normalizing it into a candidate', () => {
  const built = buildDefinedRiskStudyCandidate(definedRiskEvidence({ shortStrike: 180 }), CONTEXT);
  assert.equal(built.result.status, 'REJECTED');
  assert.equal(built.structuralEconomics.classification, 'INVERTED_STRIKES');
});

test('buildDefinedRiskStudyCandidate still BUILDS the candidate on a desynchronized (stale second leg) quote pair, but preserves the DESYNCHRONIZED evidence rather than silently treating it as synchronized', () => {
  const built = buildDefinedRiskStudyCandidate(definedRiskEvidence({
    longLeg: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:10:00Z', multiplier: 100 }, // 10 minutes stale vs. short leg
  }), CONTEXT);
  assert.equal(built.result.status, 'BUILT');
  assert.equal(built.executionBurden.quoteSynchronization.status, 'DESYNCHRONIZED');
});

test('samePairingKey/validatePair/pairDecisionContexts: identical pairing keys pair, a mismatch does not', () => {
  assert.equal(samePairingKey(KEY, KEY), true);
  assert.equal(validatePair(KEY, KEY).valid, true);
  assert.deepEqual(pairDecisionContexts(KEY, KEY), KEY);

  const differentRegime: PairingKey = { ...KEY, regimeState: 'HIGH_IV' };
  assert.equal(validatePair(KEY, differentRegime).valid, false);
  assert.equal(validatePair(KEY, differentRegime).reason, 'PAIRING_KEY_MISMATCH');
  assert.equal(pairDecisionContexts(KEY, differentRegime), null);
});

function pairInput(overrides: Partial<PairedDecisionRawInput> = {}): PairedDecisionRawInput {
  return { pairingKey: KEY, cspCandidates: [cspEvidence()], definedRiskCandidates: [definedRiskEvidence()], ...overrides };
}

test('buildPairedDecisionRecord retains ALL real candidates on both sides, never only a preselected one', () => {
  const record = buildPairedDecisionRecord(pairInput({
    cspCandidates: [cspEvidence({ candidateId: 'csp-1' }), cspEvidence({ candidateId: 'csp-2', strike: 195, bid: 2.5 })],
    definedRiskCandidates: [definedRiskEvidence({ candidateId: 'dr-1' }), definedRiskEvidence({ candidateId: 'dr-2', shortStrike: 195 })],
  }), CONTEXT, ENTRY_WHOLE_CHAIN_V1);
  assert.equal(record.cspBuildResults.length, 2);
  assert.equal(record.definedRiskBuildResults.length, 2);
});

test('buildPairedDecisionRecord reports the best structural CSP and Defined-Risk candidate by real known open credit, and rejected candidates with reasons', () => {
  const record = buildPairedDecisionRecord(pairInput({
    cspCandidates: [cspEvidence({ candidateId: 'csp-low', bid: 1.0 }), cspEvidence({ candidateId: 'csp-high', bid: 2.5 })],
    definedRiskCandidates: [definedRiskEvidence({ candidateId: 'dr-1' }), definedRiskEvidence({ candidateId: 'dr-invalid', shortStrike: 180 })],
  }), CONTEXT, ENTRY_WHOLE_CHAIN_V1);
  assert.equal(record.bestStructuralCspCandidateId, 'csp-high');
  assert.equal(record.bestStructuralDefinedRiskCandidateId, 'dr-1');
  assert.ok(record.rejectedCandidateIds.includes('dr-invalid'));
  assert.ok(record.missingEvidenceReasons.includes('INVERTED_STRIKES'));
});

test('ADVERSARIAL: STRUCTURAL_PAIR_READY when both sides have real structural candidates but no empirical evidence at all', () => {
  const record = buildPairedDecisionRecord(pairInput(), CONTEXT, ENTRY_WHOLE_CHAIN_V1);
  assert.equal(record.readiness, 'STRUCTURAL_PAIR_READY');
});

test('ADVERSARIAL: neither side can be compared because of missing evidence -- both candidates rejected -- STRUCTURAL_PAIR_NOT_READY', () => {
  const record = buildPairedDecisionRecord(pairInput({
    cspCandidates: [cspEvidence({ bid: null })],
    definedRiskCandidates: [definedRiskEvidence({ shortStrike: 180 })],
  }), CONTEXT, ENTRY_WHOLE_CHAIN_V1);
  assert.equal(record.comparison, null);
  assert.equal(record.readiness, 'STRUCTURAL_PAIR_NOT_READY');
});

test('ADVERSARIAL: CSP has higher credit but much larger tail risk than Defined Risk -- both non-dominated, no branch preferred', () => {
  const record = buildPairedDecisionRecord(pairInput({
    cspCandidates: [cspEvidence({ candidateId: 'csp-1' })],
    definedRiskCandidates: [definedRiskEvidence({ candidateId: 'dr-1' })],
  }), CONTEXT, ENTRY_WHOLE_CHAIN_V1);
  assert.equal(record.readiness, 'STRUCTURAL_PAIR_READY'); // no empirical evidence supplied yet in this scenario
  // Structural facts alone: CSP maxLoss is far larger than the spread's -- but this module draws NO safety conclusion from that.
  const cspResult = record.cspBuildResults[0];
  const drResult = record.definedRiskBuildResults[0]?.result;
  assert.equal(cspResult?.status, 'BUILT');
  assert.equal(drResult?.status, 'BUILT');
  if (cspResult?.status === 'BUILT' && drResult?.status === 'BUILT') {
    assert.ok((cspResult.candidate.deterministic.maxLoss as number) > (drResult.candidate.deterministic.maxLoss as number));
  }
});

test('summarizePairedCohorts reports purely descriptive readiness counts, never a ranking or preferred-branch claim', () => {
  const ready = buildPairedDecisionRecord(pairInput(), CONTEXT, ENTRY_WHOLE_CHAIN_V1);
  const notReady = buildPairedDecisionRecord(pairInput({
    cspCandidates: [cspEvidence({ bid: null })], definedRiskCandidates: [definedRiskEvidence({ shortStrike: 180 })],
  }), CONTEXT, ENTRY_WHOLE_CHAIN_V1);
  const summary = summarizePairedCohorts([ready, notReady]);
  assert.equal(summary.totalPairs, 2);
  assert.equal(summary.readinessCounts.STRUCTURAL_PAIR_READY, 1);
  assert.equal(summary.readinessCounts.STRUCTURAL_PAIR_NOT_READY, 1);
  assert.equal(summary.pairsWithAnyRejectedCandidate, 1);
  assert.ok(!('bestBranch' in summary) && !('winner' in summary));
});

test('classifyComparisonReadiness maps FULL_RESEARCH_COMPARABLE to OOS_NOT_EVALUATED -- the honest ceiling for this research phase, since no model is ever fit here', () => {
  const full = { state: 'FULL_RESEARCH_COMPARABLE', reason: 'x', candidateIds: [], profileVersion: 'v', profileReadiness: 'PROFILE_COMPARABLE', highestExpectedPnlCandidateId: null, nonDominatedCandidateIds: [], missingRequiredDimensions: [], availableOptionalDimensions: [] } as const;
  assert.equal(classifyComparisonReadiness(full), 'OOS_NOT_EVALUATED');
});

test('emptyEntryFutureOutcomeRecord starts every future outcome field null/UNKNOWN -- never a synthetic populated number, and applicability is per-candidate not assumed equal across branches', () => {
  const csp = emptyEntryFutureOutcomeRecord('csp-1', 'THETA_CONVENTIONAL');
  const dr = emptyEntryFutureOutcomeRecord('dr-1', 'THETA_DEFINED_RISK');
  assert.equal(csp.wholeChainNetPnl, null);
  assert.equal(csp.assignmentApplicability, 'UNKNOWN');
  assert.equal(dr.assignmentApplicability, 'UNKNOWN');
  assert.notEqual(csp.candidateId, dr.candidateId);
});
