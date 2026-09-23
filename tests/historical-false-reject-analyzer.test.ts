import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessFalseReject, aggregateFalseRejectDay, type HistoricalCandidateRecord, type CurrentReEvaluationEvidence,
} from '../src/research/historical-false-reject-analyzer.js';

const RECORD: HistoricalCandidateRecord = {
  candidateId: 'AAPL-c1', cycleId: 'cycle-1', asOf: '2026-09-21T14:00:00Z',
  oldDisposition: 'PASS', oldReasons: ['CONTRACT_NOT_EXECUTABLE'],
};

function noEvidence(): CurrentReEvaluationEvidence {
  return {
    reDerivedContract: null, deltaWithinCurrentBands: null, openInterestAboveCurrentFloor: null,
    volumeAboveCurrentFloor: null, ownershipKnownAtAsOf: null, eventStateKnownAtAsOf: null,
    persistedAegisState: null, persistedSizingQty: null, currentPolicyVersion: 'v1',
  };
}

test('no re-derived evidence at all is NOT_IDENTIFIABLE and insufficientHistoricalEvidence, never guessed', () => {
  const result = assessFalseReject(RECORD, noEvidence());
  assert.equal(result.insufficientHistoricalEvidence, true);
  assert.equal(result.counterfactualIdentifiability, 'NOT_IDENTIFIABLE');
  assert.equal(result.changedBecauseOfCodeFix, false);
});

test('stale quote in the re-derived contract keeps STILL_REJECTED and unchangedHardSafety=true', () => {
  const evidence = noEvidence();
  const withStale: CurrentReEvaluationEvidence = {
    ...evidence,
    reDerivedContract: {
      executable: false, nonExecutableReason: 'quote stale', bid: 1.5, ask: 1.6,
      quoteTimestamp: '2026-09-21T13:00:00Z', source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD',
    },
  };
  const result = assessFalseReject(RECORD, withStale);
  assert.equal(result.currentExecutionState, 'STILL_REJECTED');
  assert.ok(result.currentExecutionCauses.includes('QUOTE_STALE'));
  assert.equal(result.unchangedHardSafety, true);
  assert.equal(result.changedBecauseOfCodeFix, false);
});

test('a fully re-evaluated candidate needs explicit release provenance before attributing a code fix', () => {
  const evidence: CurrentReEvaluationEvidence = {
    reDerivedContract: {
      executable: true, nonExecutableReason: null, bid: 1.5, ask: 1.55,
      quoteTimestamp: '2026-09-21T13:59:50Z', source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD',
    },
    deltaWithinCurrentBands: true, openInterestAboveCurrentFloor: true, volumeAboveCurrentFloor: true,
    ownershipKnownAtAsOf: true, eventStateKnownAtAsOf: 'CLEAR',
    persistedAegisState: 'ALLOW_FULL', persistedSizingQty: 1, currentPolicyVersion: 'v2',
  };
  const result = assessFalseReject(RECORD, evidence);
  assert.equal(result.fullyReevaluatedAndEligible, true);
  assert.equal(result.changedBecauseOfCodeFix, false);
  assert.equal(result.unchangedHardSafety, false);
  assert.equal(result.counterfactualIdentifiability, 'OBSERVED');
});

test('a code-fix attribution requires a source change and identical policy version', () => {
  const evidence: CurrentReEvaluationEvidence = {
    ...noEvidence(),
    reDerivedContract: {
      executable: true, nonExecutableReason: null, bid: 1.5, ask: 1.55,
      quoteTimestamp: '2026-09-21T13:59:50Z', source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD',
    },
    deltaWithinCurrentBands: true, openInterestAboveCurrentFloor: true, volumeAboveCurrentFloor: true,
    ownershipKnownAtAsOf: true, eventStateKnownAtAsOf: 'CLEAR',
    persistedAegisState: 'ALLOW_FULL', persistedSizingQty: 1,
    changeAttribution: {
      cause: 'CODE_FIX', oldSourceSha: 'a'.repeat(40), newSourceSha: 'b'.repeat(40),
      oldPolicyVersion: 'v1', newPolicyVersion: 'v1', evidenceId: 'release-diff-1',
    },
  };
  assert.equal(assessFalseReject(RECORD, evidence).changedBecauseOfCodeFix, true);
  const attribution = evidence.changeAttribution;
  assert.ok(attribution);
  assert.throws(() => assessFalseReject(RECORD, {
    ...evidence, changeAttribution: { ...attribution, oldPolicyVersion: 'v0' },
  }), /FALSE_REJECT_CHANGE_ATTRIBUTION_INVALID/);
});

test('ADVERSARIAL: an AEGIS HOLD_ONLY state alone keeps the candidate rejected even if execution/structural pass', () => {
  const evidence: CurrentReEvaluationEvidence = {
    reDerivedContract: {
      executable: true, nonExecutableReason: null, bid: 1.5, ask: 1.55,
      quoteTimestamp: '2026-09-21T13:59:50Z', source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD',
    },
    deltaWithinCurrentBands: true, openInterestAboveCurrentFloor: true, volumeAboveCurrentFloor: true,
    ownershipKnownAtAsOf: true, eventStateKnownAtAsOf: 'CLEAR',
    persistedAegisState: 'HOLD_ONLY', persistedSizingQty: null, currentPolicyVersion: 'v2',
  };
  const result = assessFalseReject(RECORD, evidence);
  assert.equal(result.currentAegisState, 'STILL_REJECTED');
  assert.equal(result.changedBecauseOfCodeFix, false);
  assert.equal(result.unchangedHardSafety, true);
});

test('ADVERSARIAL: this module never estimates a fill -- no field in the output claims a would-have-filled outcome', () => {
  const evidence: CurrentReEvaluationEvidence = {
    reDerivedContract: {
      executable: true, nonExecutableReason: null, bid: 1.5, ask: 1.55,
      quoteTimestamp: '2026-09-21T13:59:50Z', source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD',
    },
    deltaWithinCurrentBands: true, openInterestAboveCurrentFloor: true, volumeAboveCurrentFloor: true,
    ownershipKnownAtAsOf: true, eventStateKnownAtAsOf: 'CLEAR',
    persistedAegisState: 'ALLOW_FULL', persistedSizingQty: 1, currentPolicyVersion: 'v2',
  };
  const result = assessFalseReject(RECORD, evidence);
  assert.ok(!('wouldHaveFilled' in result));
  assert.ok(!('estimatedFillPrice' in result));
  assert.equal(result.currentEconomicState, 'NOT_EVALUATED_THIS_PASS');
});

test('partial real evidence cannot establish candidate eligibility', () => {
  const evidence: CurrentReEvaluationEvidence = {
    ...noEvidence(),
    reDerivedContract: {
      executable: true, nonExecutableReason: null, bid: 1.5, ask: 1.55,
      quoteTimestamp: '2026-09-21T13:59:50Z', source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD',
    },
    deltaWithinCurrentBands: true,
  };
  const result = assessFalseReject(RECORD, evidence);
  assert.equal(result.counterfactualIdentifiability, 'NOT_IDENTIFIABLE');
  assert.equal(result.changedBecauseOfCodeFix, false);
});

test('aggregateFalseRejectDay counts real per-dimension rejections without estimating anything', () => {
  const pass = assessFalseReject(RECORD, {
    reDerivedContract: { executable: true, nonExecutableReason: null, bid: 1.5, ask: 1.55, quoteTimestamp: '2026-09-21T13:59:50Z', source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD' },
    deltaWithinCurrentBands: true, openInterestAboveCurrentFloor: true, volumeAboveCurrentFloor: true,
    ownershipKnownAtAsOf: true, eventStateKnownAtAsOf: 'CLEAR', persistedAegisState: 'ALLOW_FULL', persistedSizingQty: 1, currentPolicyVersion: 'v2',
  });
  const rejected = assessFalseReject({ ...RECORD, candidateId: 'AAPL-c2' }, noEvidence());
  const aggregate = aggregateFalseRejectDay('2026-09-21', [pass, rejected]);
  assert.equal(aggregate.candidatesTotal, 2);
  assert.equal(aggregate.insufficientEvidence, 1);
  assert.equal(aggregate.newlyEligibleUnderCurrentCode, 1);
  assert.equal(aggregate.eligibleButCauseUnattributed, 1);
  assert.equal(aggregate.implementationCausedReject, 0);
});
