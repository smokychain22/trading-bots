import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateEconomicCompleteness } from '../src/research/economic-completeness-gate.js';

const AT = '2026-09-21T14:00:00Z';

test('CORE CLAIM (the review\'s central finding, now closed): a required field that is null because the producer was never wired is REJECTED, not silently accepted', () => {
  const result = evaluateEconomicCompleteness({
    datasetId: 'row-1', observedAt: AT,
    fields: [
      { fieldPath: 'marketMarkPrice', value: null, state: 'FIELD_PRODUCER_NOT_WIRED', required: true },
      { fieldPath: 'impliedVolatility', value: null, state: 'FIELD_PROVIDER_MISSING', required: true },
      { fieldPath: 'underlyingPrice', value: null, state: 'FIELD_PROVIDER_MISSING', required: true },
    ],
  });
  assert.equal(result.outcome, 'DATASET_INCOMPLETE');
  assert.deepEqual(result.rejectedFields.sort(), ['impliedVolatility', 'marketMarkPrice', 'underlyingPrice']);
});

test('a required field that is null for a LEGITIMATE reason (not applicable / counterfactual) is accepted', () => {
  const result = evaluateEconomicCompleteness({
    datasetId: 'row-2', observedAt: AT,
    fields: [
      { fieldPath: 'assignmentState', value: null, state: 'FIELD_NOT_APPLICABLE', required: true },
      { fieldPath: 'rejectedCandidateOutcome', value: null, state: 'FIELD_COUNTERFACTUAL_NOT_IDENTIFIABLE', required: true },
    ],
  });
  assert.equal(result.outcome, 'ACCEPTED');
  assert.equal(result.rejectedFields.length, 0);
});

test('a non-required field being null never rejects the row, regardless of its state', () => {
  const result = evaluateEconomicCompleteness({
    datasetId: 'row-3', observedAt: AT,
    fields: [{ fieldPath: 'impliedVolatility', value: null, state: 'FIELD_PRODUCER_NOT_WIRED', required: false }],
  });
  assert.equal(result.outcome, 'ACCEPTED');
});

test('a present (non-null) value never contributes an unknown entry or a rejection, whatever state was declared', () => {
  const result = evaluateEconomicCompleteness({
    datasetId: 'row-4', observedAt: AT,
    fields: [{ fieldPath: 'marketMarkPrice', value: 2.05, state: 'FIELD_PRESENT_VALID', required: true }],
  });
  assert.equal(result.outcome, 'ACCEPTED');
  assert.equal(result.unknowns.length, 0);
});

test('ADVERSARIAL: declaring FIELD_PRESENT_VALID with a null value is an internal inconsistency, not silently accepted', () => {
  assert.throws(() => evaluateEconomicCompleteness({
    datasetId: 'row-5', observedAt: AT,
    fields: [{ fieldPath: 'marketMarkPrice', value: null, state: 'FIELD_PRESENT_VALID', required: true }],
  }), /ECONOMIC_COMPLETENESS_STATE_VALUE_MISMATCH/);
});

test('every non-legitimate null field produces a real classified unknown entry, reusing the shared taxonomy', () => {
  const result = evaluateEconomicCompleteness({
    datasetId: 'row-6', observedAt: AT,
    fields: [{ fieldPath: 'impliedVolatility', value: null, state: 'FIELD_DERIVATION_NOT_IMPLEMENTED', required: false }],
  });
  assert.equal(result.unknowns.length, 1);
  assert.equal(result.unknowns[0]?.reason, 'DERIVATION_NOT_IMPLEMENTED');
});
