import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyBrokerFact, classifyBrokerFactBatch, type BrokerFactEvidence } from '../src/research/historical-broker-fact-classifier.js';

function fact(overrides: Partial<BrokerFactEvidence> = {}): BrokerFactEvidence {
  return {
    factId: 'fact-1', brokerObjectType: 'ACTIVITY', activityType: 'FILL',
    eventTimestamp: '2026-09-16T14:00:00Z', firstSeenTimestamp: '2026-09-16T14:00:00Z',
    linkedLocalOrderId: null, linkedLocalChainId: null,
    currentBrokerOrderExists: null, currentPositionExists: null, currentUnsettledObligationExists: null,
    cashEffect: null, reconciliationStatus: 'UNKNOWN', ...overrides,
  };
}

test('CORE CLAIM: any true current-exposure signal is CURRENT_ECONOMIC_EXPOSURE, regardless of age', () => {
  const result = classifyBrokerFact(fact({
    firstSeenTimestamp: '2020-01-01T00:00:00Z', currentPositionExists: true,
    currentBrokerOrderExists: false, currentUnsettledObligationExists: false, reconciliationStatus: 'RECONCILED',
  }));
  assert.equal(result.classification, 'CURRENT_ECONOMIC_EXPOSURE');
});

test('ADVERSARIAL: missing current-exposure evidence never defaults to a harmless classification -- UNKNOWN_CURRENT_IMPACT instead', () => {
  const result = classifyBrokerFact(fact());
  assert.equal(result.classification, 'UNKNOWN_CURRENT_IMPACT');
  assert.ok(result.requiredEvidenceMissing.length > 0);
});

test('ADVERSARIAL: age alone (old firstSeenTimestamp) never implies harmlessness without positive evidence', () => {
  const veryOld = classifyBrokerFact(fact({ firstSeenTimestamp: '2010-01-01T00:00:00Z' }));
  const recent = classifyBrokerFact(fact({ firstSeenTimestamp: '2026-09-21T00:00:00Z' }));
  assert.equal(veryOld.classification, 'UNKNOWN_CURRENT_IMPACT');
  assert.equal(recent.classification, 'UNKNOWN_CURRENT_IMPACT');
});

test('all current signals false + UNRECONCILED is a real CURRENT_RECONCILIATION_DEFECT, not history', () => {
  const result = classifyBrokerFact(fact({
    currentBrokerOrderExists: false, currentPositionExists: false, currentUnsettledObligationExists: false,
    reconciliationStatus: 'UNRECONCILED',
  }));
  assert.equal(result.classification, 'CURRENT_RECONCILIATION_DEFECT');
});

test('all current signals false + RECONCILED + real local linkage = HISTORICAL_RECONCILED', () => {
  const result = classifyBrokerFact(fact({
    currentBrokerOrderExists: false, currentPositionExists: false, currentUnsettledObligationExists: false,
    reconciliationStatus: 'RECONCILED', linkedLocalOrderId: 'order-42',
  }));
  assert.equal(result.classification, 'HISTORICAL_RECONCILED');
});

test('all current signals false + RECONCILED + NO local linkage = HISTORICAL_ACCOUNTING_ONLY, distinct from HISTORICAL_RECONCILED', () => {
  const result = classifyBrokerFact(fact({
    currentBrokerOrderExists: false, currentPositionExists: false, currentUnsettledObligationExists: false,
    reconciliationStatus: 'RECONCILED', activityType: 'FEE',
  }));
  assert.equal(result.classification, 'HISTORICAL_ACCOUNTING_ONLY');
});

test('classifyBrokerFactBatch aggregates real per-row classifications, matching the 11-fact real scenario shape', () => {
  const rows: BrokerFactEvidence[] = [
    fact({ factId: 'f1', currentPositionExists: true, currentBrokerOrderExists: false, currentUnsettledObligationExists: false, reconciliationStatus: 'RECONCILED' }),
    fact({ factId: 'f2', currentBrokerOrderExists: false, currentPositionExists: false, currentUnsettledObligationExists: false, reconciliationStatus: 'RECONCILED', linkedLocalOrderId: 'o-1' }),
    fact({ factId: 'f3' }),
  ];
  const summary = classifyBrokerFactBatch(rows);
  assert.equal(summary.totalFacts, 3);
  assert.equal(summary.currentEconomicExposureCount, 1);
  assert.equal(summary.historicalReconciledCount, 1);
  assert.equal(summary.unknownCurrentImpactCount, 1);
});
