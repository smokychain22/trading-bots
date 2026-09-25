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
    persistedAegisState: null, persistedSizingQty: null, currentPolicyVersion: 'v1', releaseProvenance: null,
  };
}

function fullPassEvidence(overrides: Partial<CurrentReEvaluationEvidence> = {}): CurrentReEvaluationEvidence {
  return {
    reDerivedContract: {
      executable: true, nonExecutableReason: null, bid: 1.5, ask: 1.55,
      quoteTimestamp: '2026-09-21T13:59:50Z', source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD',
    },
    deltaWithinCurrentBands: true, openInterestAboveCurrentFloor: true, volumeAboveCurrentFloor: true,
    ownershipKnownAtAsOf: true, eventStateKnownAtAsOf: 'CLEAR',
    persistedAegisState: 'ALLOW_FULL', persistedSizingQty: 1, currentPolicyVersion: 'v2',
    releaseProvenance: null,
    ...overrides,
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

test('CORE CLAIM (corrected 2026-09-25): a full pass WITHOUT release provenance is NEVER attributed to a code fix', () => {
  const result = assessFalseReject(RECORD, fullPassEvidence());
  assert.equal(result.unchangedHardSafety, false);
  assert.equal(result.counterfactualIdentifiability, 'OBSERVED');
  // The candidate genuinely now passes every re-evaluated dimension, but
  // with no release/policy provenance supplied, this must NOT be
  // attributed to a code fix -- market conditions on this re-evaluation
  // may simply differ from the historical session.
  assert.equal(result.changedBecauseOfCodeFix, false);
  assert.equal(result.changedBecauseOfPolicy, false);
});

test('CORE CLAIM: a full pass WITH a real changed release SHA is changedBecauseOfCodeFix=true', () => {
  const result = assessFalseReject(RECORD, fullPassEvidence({
    releaseProvenance: { historicalReleaseSha: 'sha-old', currentReleaseSha: 'sha-new', historicalPolicyVersion: 'v1' },
  }));
  assert.equal(result.changedBecauseOfCodeFix, true);
  assert.equal(result.changedBecauseOfPolicy, false);
});

test('a full pass with an UNCHANGED release SHA but a changed policy version is changedBecauseOfPolicy=true, not a code fix', () => {
  const result = assessFalseReject(RECORD, fullPassEvidence({
    releaseProvenance: { historicalReleaseSha: 'sha-same', currentReleaseSha: 'sha-same', historicalPolicyVersion: 'v1' },
    currentPolicyVersion: 'v2',
  }));
  assert.equal(result.changedBecauseOfCodeFix, false);
  assert.equal(result.changedBecauseOfPolicy, true);
});

test('ADVERSARIAL: a full pass with an unchanged release AND unchanged policy claims neither attribution', () => {
  const result = assessFalseReject(RECORD, fullPassEvidence({
    releaseProvenance: { historicalReleaseSha: 'sha-same', currentReleaseSha: 'sha-same', historicalPolicyVersion: 'v2' },
    currentPolicyVersion: 'v2',
  }));
  assert.equal(result.changedBecauseOfCodeFix, false);
  assert.equal(result.changedBecauseOfPolicy, false);
});

test('ADVERSARIAL: a null historicalReleaseSha (never observed historically) cannot justify a code-fix claim', () => {
  const result = assessFalseReject(RECORD, fullPassEvidence({
    releaseProvenance: { historicalReleaseSha: null, currentReleaseSha: 'sha-new', historicalPolicyVersion: null },
  }));
  assert.equal(result.changedBecauseOfCodeFix, false);
  assert.equal(result.changedBecauseOfPolicy, false);
});

test('ADVERSARIAL: an AEGIS HOLD_ONLY state alone keeps the candidate rejected even if execution/structural pass', () => {
  const evidence = fullPassEvidence({
    persistedAegisState: 'HOLD_ONLY', persistedSizingQty: null,
    releaseProvenance: { historicalReleaseSha: 'sha-old', currentReleaseSha: 'sha-new', historicalPolicyVersion: 'v1' },
  });
  const result = assessFalseReject(RECORD, evidence);
  assert.equal(result.currentAegisState, 'STILL_REJECTED');
  assert.equal(result.changedBecauseOfCodeFix, false);
  assert.equal(result.unchangedHardSafety, true);
});

test('ADVERSARIAL: this module never estimates a fill -- no field in the output claims a would-have-filled outcome', () => {
  const result = assessFalseReject(RECORD, fullPassEvidence());
  assert.ok(!('wouldHaveFilled' in result));
  assert.ok(!('estimatedFillPrice' in result));
  assert.equal(result.currentEconomicState, 'NOT_EVALUATED_THIS_PASS');
});

test('partial real evidence (some dimensions known, some not) yields ESTIMABLE, not OBSERVED', () => {
  const evidence: CurrentReEvaluationEvidence = {
    ...noEvidence(),
    reDerivedContract: {
      executable: true, nonExecutableReason: null, bid: 1.5, ask: 1.55,
      quoteTimestamp: '2026-09-21T13:59:50Z', source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD',
    },
    deltaWithinCurrentBands: true,
  };
  const result = assessFalseReject(RECORD, evidence);
  assert.equal(result.counterfactualIdentifiability, 'ESTIMABLE');
});

test('aggregateFalseRejectDay counts real per-dimension rejections without estimating anything', () => {
  const pass = assessFalseReject(RECORD, fullPassEvidence({
    releaseProvenance: { historicalReleaseSha: 'sha-old', currentReleaseSha: 'sha-new', historicalPolicyVersion: 'v1' },
  }));
  const rejected = assessFalseReject({ ...RECORD, candidateId: 'AAPL-c2' }, noEvidence());
  const aggregate = aggregateFalseRejectDay('2026-09-21', [pass, rejected]);
  assert.equal(aggregate.candidatesTotal, 2);
  assert.equal(aggregate.insufficientEvidence, 1);
  assert.equal(aggregate.newlyEligibleUnderCurrentCode, 1);
});
