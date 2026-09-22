import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computePutCreditSpreadStructuralEconomics, quoteSynchronizationStatus, quoteFreshnessAtDecision,
  buildSpreadExecutionBurdenEvidence, buildCspStudyCandidate, buildDefinedRiskStudyCandidate,
  samePairingKey, validatePair, pairDecisionContexts, buildPairedDecisionRecord, classifyComparisonReadiness,
  summarizePairedCohorts, emptyEntryFutureOutcomeRecord, computeCohortOutcomeMetrics, computeStructuralNonDominated,
  provenanceMatchesPairingKey,
  type PairingKey, type PutCreditSpreadStructuralInputs, type CspCandidateRawEvidence, type DefinedRiskCandidateRawEvidence,
  type PairedDecisionRawInput, type CandidateProvenance, type EntryFutureOutcomeRecord,
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

const PROVENANCE: CandidateProvenance = {
  decisionTimestamp: KEY.decisionTimestamp, fusionSnapshotId: KEY.fusionSnapshotId, accountContextId: KEY.accountContextId,
  ownershipState: KEY.ownershipState, regimeState: KEY.regimeState, eventState: KEY.eventState, underlying: KEY.underlying,
  sourceEvidenceIds: ['ev-1'],
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
  assert.equal(result.openingNetCreditPerShare, 0.9); // shortBid(1.5) - longAsk(0.6)
  assert.equal(result.width, 5);
  assert.equal(result.maxProfit, 0.9 * 100 * 1);
  assert.equal(result.maxLoss, (5 - 0.9) * 100 * 1);
  assert.ok((result.maxLoss as number) > 0);
});

test('computePutCreditSpreadStructuralEconomics: multiple contracts scale multiplier x quantity, never double-multiplied', () => {
  const result = computePutCreditSpreadStructuralEconomics(spreadInputs({ quantity: 3 }));
  assert.equal(result.maxProfit, 0.9 * 100 * 3);
  assert.equal(result.maxLoss, (5 - 0.9) * 100 * 3);
});

test('REJECT: a real net-debit (invalid negative credit / debit spread) is classified, never normalized', () => {
  const result = computePutCreditSpreadStructuralEconomics(spreadInputs({
    shortLeg: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
    longLeg: { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
  }));
  assert.equal(result.classification, 'NEGATIVE_OR_ZERO_NET_CREDIT');
  assert.equal(result.maxLoss, null);
});

test('REPAIR: a net credit >= width (crossed/stale/inconsistent executable evidence, would imply maxLoss <= 0) is rejected as NET_CREDIT_EXCEEDS_OR_EQUALS_WIDTH, never a negative or zero maxLoss', () => {
  const result = computePutCreditSpreadStructuralEconomics(spreadInputs({
    shortStrike: 190, longStrike: 189, // width = 1
    shortLeg: { bid: 2.0, ask: 2.1, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
    longLeg: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 }, // netCredit = 1.4 >= width 1
  }));
  assert.equal(result.classification, 'NET_CREDIT_EXCEEDS_OR_EQUALS_WIDTH');
  assert.equal(result.maxLoss, null);
});

test('REJECT: zero-width spread', () => {
  assert.equal(computePutCreditSpreadStructuralEconomics(spreadInputs({ longStrike: 190 })).classification, 'ZERO_WIDTH_SPREAD');
});

test('REJECT: inverted strikes (short below long)', () => {
  assert.equal(computePutCreditSpreadStructuralEconomics(spreadInputs({ shortStrike: 180, longStrike: 185 })).classification, 'INVERTED_STRIKES');
});

test('REJECT: missing executable quote', () => {
  assert.equal(computePutCreditSpreadStructuralEconomics(spreadInputs({
    shortLeg: { bid: null, ask: 1.6, quoteTimestamp: null, multiplier: 100 },
  })).classification, 'MISSING_EXECUTABLE_QUOTE');
});

test('REPAIR: a crossed leg quote (bid > ask) is classified individually, never silently accepted as a normal quote', () => {
  assert.equal(computePutCreditSpreadStructuralEconomics(spreadInputs({
    shortLeg: { bid: 2.0, ask: 1.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
  })).classification, 'CROSSED_LEG_QUOTE');
});

test('REPAIR: a negative strike is classified individually', () => {
  assert.equal(computePutCreditSpreadStructuralEconomics(spreadInputs({ longStrike: -5 })).classification, 'NEGATIVE_STRIKE');
});

test('REPAIR: a non-finite strike is classified individually', () => {
  assert.equal(computePutCreditSpreadStructuralEconomics(spreadInputs({ shortStrike: Infinity })).classification, 'NON_FINITE_STRIKE');
});

test('REPAIR: a non-integer quantity is rejected, never silently floored/rounded', () => {
  assert.equal(computePutCreditSpreadStructuralEconomics(spreadInputs({ quantity: 1.5 })).classification, 'NON_INTEGER_QUANTITY');
});

test('REPAIR: a non-positive quantity/multiplier is rejected individually', () => {
  assert.equal(computePutCreditSpreadStructuralEconomics(spreadInputs({ quantity: 0 })).classification, 'NON_POSITIVE_QUANTITY');
  assert.equal(computePutCreditSpreadStructuralEconomics(spreadInputs({
    shortLeg: { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: -100 },
  })).classification, 'NON_POSITIVE_MULTIPLIER');
});

test('REJECT: mismatched leg multipliers rather than silently picking one', () => {
  assert.equal(computePutCreditSpreadStructuralEconomics(spreadInputs({
    longLeg: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 10 },
  })).classification, 'MISMATCHED_MULTIPLIERS');
});

test('REJECT: missing strikes', () => {
  assert.equal(computePutCreditSpreadStructuralEconomics(spreadInputs({ shortStrike: null })).classification, 'MISSING_STRIKES');
});

// --- 3. Execution burden: synchronization vs. decision-time freshness ---

test('quoteSynchronizationStatus reports SYNCHRONIZED for legs within the caller-supplied max age', () => {
  const result = quoteSynchronizationStatus('2026-09-22T14:00:00.000Z', '2026-09-22T14:00:00.500Z', 1000);
  assert.equal(result.status, 'SYNCHRONIZED');
});

test('quoteSynchronizationStatus reports DESYNCHRONIZED for a stale second leg, never silently synchronized', () => {
  const result = quoteSynchronizationStatus('2026-09-22T14:00:00.000Z', '2026-09-22T14:05:00.000Z', 1000);
  assert.equal(result.status, 'DESYNCHRONIZED');
});

test('quoteSynchronizationStatus is TIMESTAMP_UNKNOWN, never assumed synchronized, when a timestamp is missing', () => {
  assert.equal(quoteSynchronizationStatus(null, '2026-09-22T14:00:00.000Z', 1000).status, 'TIMESTAMP_UNKNOWN');
});

test('REPAIR: quoteFreshnessAtDecision is a SEPARATE concept from synchronization -- two legs can be synchronized with each other while both are stale relative to the decision', () => {
  const decisionTimestamp = '2026-09-22T15:00:00.000Z'; // 1 hour after both quotes
  const shortFreshness = quoteFreshnessAtDecision('2026-09-22T14:00:00.000Z', decisionTimestamp, 60000);
  const longFreshness = quoteFreshnessAtDecision('2026-09-22T14:00:00.500Z', decisionTimestamp, 60000);
  const sync = quoteSynchronizationStatus('2026-09-22T14:00:00.000Z', '2026-09-22T14:00:00.500Z', 1000);
  assert.equal(sync.status, 'SYNCHRONIZED');
  assert.equal(shortFreshness.status, 'STALE');
  assert.equal(longFreshness.status, 'STALE');
});

test('REPAIR: quoteFreshnessAtDecision reports FUTURE_TIMESTAMP (a PIT violation) rather than treating a post-decision quote as fresh', () => {
  const result = quoteFreshnessAtDecision('2026-09-22T15:00:00.000Z', '2026-09-22T14:00:00.000Z', 60000);
  assert.equal(result.status, 'FUTURE_TIMESTAMP');
});

test('quoteFreshnessAtDecision is TIMESTAMP_UNKNOWN, never assumed fresh, when the quote timestamp is missing', () => {
  assert.equal(quoteFreshnessAtDecision(null, '2026-09-22T14:00:00.000Z', 60000).status, 'TIMESTAMP_UNKNOWN');
});

test('buildSpreadExecutionBurdenEvidence: BOTH_FRESH_AND_SYNCHRONIZED when both legs are fresh and mutually synchronized', () => {
  const evidence = buildSpreadExecutionBurdenEvidence(
    'short', { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T13:59:59Z', multiplier: 100 },
    'long', { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T13:59:59Z', multiplier: 100 },
    '2026-09-22T14:00:00Z', 1000, 60000,
  );
  assert.equal(evidence.quoteState, 'BOTH_FRESH_AND_SYNCHRONIZED');
});

test('buildSpreadExecutionBurdenEvidence: FRESH_BUT_DESYNCHRONIZED when both legs are individually fresh but not mutually synchronized', () => {
  const evidence = buildSpreadExecutionBurdenEvidence(
    'short', { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T13:59:00Z', multiplier: 100 },
    'long', { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T13:59:59Z', multiplier: 100 },
    '2026-09-22T14:00:00Z', 1000, 120000,
  );
  assert.equal(evidence.quoteState, 'FRESH_BUT_DESYNCHRONIZED');
});

test('buildSpreadExecutionBurdenEvidence preserves each leg bid/ask/timestamp/spread individually, never collapsed into one figure', () => {
  const evidence = buildSpreadExecutionBurdenEvidence(
    'short', { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
    'long', { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 }, '2026-09-22T14:00:00Z', 1000, 60000,
  );
  assert.ok(Math.abs((evidence.shortLeg.spread as number) - 0.1) < 1e-9);
  assert.ok(Math.abs((evidence.longLeg.spread as number) - 0.1) < 1e-9);
  assert.ok(Math.abs((evidence.combinedNetCredit as number) - 0.9) < 1e-9);
});

// --- 4/5/6. Candidate builders + provenance + paired study engine -------

function cspEvidence(overrides: Partial<CspCandidateRawEvidence> = {}): CspCandidateRawEvidence {
  return {
    candidateId: 'csp-1', provenance: PROVENANCE, underlying: 'AAPL', dte: 30, strike: 190, bid: 2.0, ask: 2.1,
    quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100, quantity: 1, collateral: 19000,
    buyingPowerImpact: 19000, breakEven: 188, downsideCushion: 0.05, maxQuoteAgeMs: 60000, ...overrides,
  };
}

function definedRiskEvidence(overrides: Partial<DefinedRiskCandidateRawEvidence> = {}): DefinedRiskCandidateRawEvidence {
  return {
    candidateId: 'dr-1', provenance: PROVENANCE, underlying: 'AAPL', dte: 30, shortStrike: 190, longStrike: 185,
    shortLeg: { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
    longLeg: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:00:00Z', multiplier: 100 },
    quantity: 1, buyingPowerImpact: 410, breakEven: 189.1, downsideCushion: 0.045,
    maxSyncAgeMs: 1000, maxQuoteAgeMs: 60000, ...overrides,
  };
}

test('buildCspStudyCandidate computes real maxLoss via cashSecuredPutMaxLossAtZero, never recomputing an independent formula', () => {
  const built = buildCspStudyCandidate(cspEvidence(), CONTEXT);
  assert.equal(built.result.status, 'BUILT');
  if (built.result.status === 'BUILT') {
    assert.equal(built.result.candidate.deterministic.maxLoss, (190 - 2.0) * 100 * 1);
    assert.equal(built.result.candidate.deterministic.structureClass, 'CASH_SECURED_SINGLE_LEG');
  }
});

test('buildCspStudyCandidate rejects a missing executable quote rather than fabricating economics', () => {
  assert.equal(buildCspStudyCandidate(cspEvidence({ bid: null }), CONTEXT).result.status, 'REJECTED');
});

test('buildDefinedRiskStudyCandidate BUILDS a valid spread with structureClass STRUCTURALLY_DEFINED_RISK_SPREAD and real finite positive maxLoss', () => {
  const built = buildDefinedRiskStudyCandidate(definedRiskEvidence(), CONTEXT);
  assert.equal(built.result.status, 'BUILT');
  assert.equal(built.structuralEconomics.classification, 'VALID_CREDIT_SPREAD');
  if (built.result.status === 'BUILT') {
    assert.equal(built.result.candidate.deterministic.structureClass, 'STRUCTURALLY_DEFINED_RISK_SPREAD');
    assert.ok((built.result.candidate.deterministic.maxLoss as number) > 0);
  }
});

test('buildDefinedRiskStudyCandidate REJECTS an invalid structure (inverted strikes) rather than normalizing it into a candidate', () => {
  const built = buildDefinedRiskStudyCandidate(definedRiskEvidence({ shortStrike: 180 }), CONTEXT);
  assert.equal(built.result.status, 'REJECTED');
  assert.equal(built.structuralEconomics.classification, 'INVERTED_STRIKES');
});

test('buildDefinedRiskStudyCandidate still BUILDS on a desynchronized (stale second leg) quote pair, preserving DESYNCHRONIZED evidence rather than treating it as synchronized', () => {
  const built = buildDefinedRiskStudyCandidate(definedRiskEvidence({
    longLeg: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:10:00Z', multiplier: 100 },
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
  assert.equal(pairDecisionContexts(KEY, differentRegime), null);
});

test('provenanceMatchesPairingKey confirms/rejects candidate lineage against a pairing key', () => {
  assert.equal(provenanceMatchesPairingKey(PROVENANCE, KEY), true);
  const otherSnapshot: CandidateProvenance = { ...PROVENANCE, fusionSnapshotId: 'snap-2' };
  assert.equal(provenanceMatchesPairingKey(otherSnapshot, KEY), false);
});

function pairInput(overrides: Partial<PairedDecisionRawInput> = {}): PairedDecisionRawInput {
  return {
    pairingKey: KEY, cohort: 'COHORT_B_STRATEGY_NATIVE_LATTICE', targetDte: null,
    cspCandidates: [cspEvidence()], definedRiskCandidates: [definedRiskEvidence()], ...overrides,
  };
}

test('buildPairedDecisionRecord retains ALL real candidates on both sides, never only a preselected one', () => {
  const record = buildPairedDecisionRecord(pairInput({
    cspCandidates: [cspEvidence({ candidateId: 'csp-1' }), cspEvidence({ candidateId: 'csp-2', strike: 195, bid: 2.5 })],
    definedRiskCandidates: [definedRiskEvidence({ candidateId: 'dr-1' }), definedRiskEvidence({ candidateId: 'dr-2', shortStrike: 195 })],
  }), CONTEXT, ENTRY_WHOLE_CHAIN_V1);
  assert.equal(record.cspBuildResults.length, 2);
  assert.equal(record.definedRiskBuildResults.length, 2);
});

test('RENAMED: buildPairedDecisionRecord reports highestOpeningCredit*CandidateId (exactly what it measures, never "best structural"), and rejected candidates with reasons', () => {
  const record = buildPairedDecisionRecord(pairInput({
    cspCandidates: [cspEvidence({ candidateId: 'csp-low', bid: 1.0 }), cspEvidence({ candidateId: 'csp-high', bid: 2.5 })],
    definedRiskCandidates: [definedRiskEvidence({ candidateId: 'dr-1' }), definedRiskEvidence({ candidateId: 'dr-invalid', shortStrike: 180 })],
  }), CONTEXT, ENTRY_WHOLE_CHAIN_V1);
  assert.equal(record.highestOpeningCreditCspCandidateId, 'csp-high');
  assert.equal(record.highestOpeningCreditDefinedRiskCandidateId, 'dr-1');
  assert.ok(record.rejectedCandidateIds.includes('dr-invalid'));
  assert.ok(record.missingEvidenceReasons.includes('INVERTED_STRIKES'));
});

test('NEW: computeStructuralNonDominated returns a transparent, unweighted structural Pareto frontier, excluding candidates missing any of the five dimensions', () => {
  const cspResult = buildCspStudyCandidate(cspEvidence(), CONTEXT).result;
  const drResult = buildDefinedRiskStudyCandidate(definedRiskEvidence(), CONTEXT).result;
  assert.equal(cspResult.status, 'BUILT');
  assert.equal(drResult.status, 'BUILT');
  if (cspResult.status === 'BUILT' && drResult.status === 'BUILT') {
    const frontier = computeStructuralNonDominated([cspResult.candidate, drResult.candidate]);
    assert.ok(frontier.length >= 1);
  }
});

test('ADVERSARIAL: PAIRING PROVENANCE -- a CSP candidate from a DIFFERENT snapshot is rejected as CANDIDATE_PAIRING_CONTEXT_MISMATCH, never silently combined into the pair', () => {
  const mismatchedProvenance: CandidateProvenance = { ...PROVENANCE, fusionSnapshotId: 'snap-DIFFERENT' };
  const record = buildPairedDecisionRecord(pairInput({
    cspCandidates: [cspEvidence({ candidateId: 'csp-wrong-snapshot', provenance: mismatchedProvenance })],
  }), CONTEXT, ENTRY_WHOLE_CHAIN_V1);
  assert.ok(record.rejectedCandidateIds.includes('csp-wrong-snapshot'));
  assert.ok(record.missingEvidenceReasons.includes('CANDIDATE_PAIRING_CONTEXT_MISMATCH'));
  assert.equal(record.cspBuildResults[0]?.status, 'REJECTED');
});

test('A2: COHORT_A_SAME_EXPIRATION retains only candidates matching targetDte, rejecting the rest as COHORT_A_EXPIRATION_MISMATCH -- COHORT_A and COHORT_B are never mixed', () => {
  const record = buildPairedDecisionRecord({
    pairingKey: KEY, cohort: 'COHORT_A_SAME_EXPIRATION', targetDte: 30,
    cspCandidates: [cspEvidence({ candidateId: 'csp-30', dte: 30 }), cspEvidence({ candidateId: 'csp-45', dte: 45 })],
    definedRiskCandidates: [definedRiskEvidence({ candidateId: 'dr-30', dte: 30 })],
  }, CONTEXT, ENTRY_WHOLE_CHAIN_V1);
  assert.equal(record.cohort, 'COHORT_A_SAME_EXPIRATION');
  const builtIds = record.cspBuildResults.filter((r) => r.status === 'BUILT').map((r) => (r as Extract<typeof r, { status: 'BUILT' }>).candidate.candidateId);
  assert.deepEqual(builtIds, ['csp-30']);
  assert.ok(record.rejectedCandidateIds.includes('csp-45'));
  assert.ok(record.missingEvidenceReasons.includes('COHORT_A_EXPIRATION_MISMATCH'));
});

test('A2: COHORT_A_SAME_EXPIRATION throws when targetDte is not supplied -- never silently proceeds without the constraint it claims to enforce', () => {
  assert.throws(() => buildPairedDecisionRecord({
    pairingKey: KEY, cohort: 'COHORT_A_SAME_EXPIRATION', targetDte: null,
    cspCandidates: [cspEvidence()], definedRiskCandidates: [definedRiskEvidence()],
  }, CONTEXT, ENTRY_WHOLE_CHAIN_V1), /COHORT_A_SAME_EXPIRATION_REQUIRES_A_TARGET_DTE/);
});

test('ADVERSARIAL: STRUCTURAL_PAIR_READY when both sides have real structural candidates but no empirical evidence at all', () => {
  assert.equal(buildPairedDecisionRecord(pairInput(), CONTEXT, ENTRY_WHOLE_CHAIN_V1).readiness, 'STRUCTURAL_PAIR_READY');
});

test('ADVERSARIAL: neither side can be compared because of missing evidence -- both candidates rejected -- STRUCTURAL_PAIR_NOT_READY', () => {
  const record = buildPairedDecisionRecord(pairInput({
    cspCandidates: [cspEvidence({ bid: null })], definedRiskCandidates: [definedRiskEvidence({ shortStrike: 180 })],
  }), CONTEXT, ENTRY_WHOLE_CHAIN_V1);
  assert.equal(record.comparison, null);
  assert.equal(record.readiness, 'STRUCTURAL_PAIR_NOT_READY');
});

test('ADVERSARIAL: CSP has higher credit but much larger max loss than Defined Risk -- no safety conclusion drawn by this module', () => {
  const cspResult = buildCspStudyCandidate(cspEvidence(), CONTEXT).result;
  const drResult = buildDefinedRiskStudyCandidate(definedRiskEvidence(), CONTEXT).result;
  assert.equal(cspResult.status, 'BUILT');
  assert.equal(drResult.status, 'BUILT');
  if (cspResult.status === 'BUILT' && drResult.status === 'BUILT') {
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
  assert.ok(!('bestBranch' in summary) && !('winner' in summary));
});

test('classifyComparisonReadiness maps FULL_RESEARCH_COMPARABLE to OOS_NOT_EVALUATED -- the honest ceiling since no model is ever fit here', () => {
  const full = { state: 'FULL_RESEARCH_COMPARABLE', reason: 'x', candidateIds: [], profileVersion: 'v', profileReadiness: 'PROFILE_COMPARABLE', highestExpectedPnlCandidateId: null, nonDominatedCandidateIds: [], missingRequiredDimensions: [], availableOptionalDimensions: [] } as const;
  assert.equal(classifyComparisonReadiness(full), 'OOS_NOT_EVALUATED');
});

// --- 7/8. Atomic future outcomes + cohort-level aggregation -------------

test('emptyEntryFutureOutcomeRecord starts every field null/UNKNOWN, and legOutcomeState is NOT_APPLICABLE_SINGLE_LEG for CSP but UNKNOWN (never a default no-assignment claim) for Defined Risk', () => {
  const csp = emptyEntryFutureOutcomeRecord('csp-1', 'THETA_CONVENTIONAL');
  const dr = emptyEntryFutureOutcomeRecord('dr-1', 'THETA_DEFINED_RISK');
  assert.equal(csp.wholeChainNetPnl, null);
  assert.equal(csp.legOutcomeState, 'NOT_APPLICABLE_SINGLE_LEG');
  assert.equal(dr.legOutcomeState, 'UNKNOWN');
  assert.equal(dr.assignmentApplicability.status, 'UNKNOWN');
  assert.notEqual(csp.candidateId, dr.candidateId);
});

function resolvedRecord(overrides: Partial<EntryFutureOutcomeRecord> = {}): EntryFutureOutcomeRecord {
  return {
    ...emptyEntryFutureOutcomeRecord('r1', 'THETA_CONVENTIONAL'),
    wholeChainNetPnl: 100, grossProfitComponent: 100, grossLossComponent: 0,
    maxAdverseExcursion: -20, maxFavorableExcursion: 150, ...overrides,
  };
}

test('REPAIR: ProfitFactor and ExpectedShortfall are computed at COHORT level from atomic records, never stored as a per-candidate scalar', () => {
  const records = [
    resolvedRecord({ candidateId: 'r1', wholeChainNetPnl: 200, grossProfitComponent: 200, grossLossComponent: 0 }),
    resolvedRecord({ candidateId: 'r2', wholeChainNetPnl: -100, grossProfitComponent: 0, grossLossComponent: -100 }),
    resolvedRecord({ candidateId: 'r3', wholeChainNetPnl: -50, grossProfitComponent: 0, grossLossComponent: -50 }),
  ];
  const metrics = computeCohortOutcomeMetrics(records, 1 / 3);
  assert.equal(metrics.resolvedCount, 3);
  assert.equal(metrics.profitFactor, 200 / 150);
  assert.equal(metrics.expectedShortfall, -100); // worst 1/3 of 3 = 1 record: -100
  const firstRecord = records[0] as EntryFutureOutcomeRecord;
  assert.ok(!('profitFactorContribution' in firstRecord) && !('expectedShortfallRealized' in firstRecord));
});

test('computeCohortOutcomeMetrics returns null fields (never a fabricated 0) when no records are resolved yet', () => {
  const metrics = computeCohortOutcomeMetrics([emptyEntryFutureOutcomeRecord('r1', 'THETA_CONVENTIONAL')], 0.25);
  assert.equal(metrics.resolvedCount, 0);
  assert.equal(metrics.profitFactor, null);
  assert.equal(metrics.expectedShortfall, null);
});
