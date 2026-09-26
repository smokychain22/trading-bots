import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSelectionBiasReceipt, isDsrApplicableTargetKind } from '../src/research/selection-bias-receipt.js';

function baseInput(overrides: Partial<Parameters<typeof buildSelectionBiasReceipt>[0]> = {}) {
  return {
    researchCampaignId: 'camp1', returnNormalizationVersion: 'capital-at-risk-normalized-v1',
    numberOfTrials: 3, trialIdentities: ['t1', 't2', 't3'],
    dsr: { deflatedSharpeRatio: 0.4, expectedMaxSharpeUnderNull: 0.3, pValue: 0.2 },
    pbo: { probabilityOfBacktestOverfitting: 0.3, numberOfCombinatorialSplits: 10 },
    inputDatasetHash: 'h1', dependencyGroupingVersion: 'dg1', codeSha: 'sha1', createdAt: '2026-09-25T00:00:00Z', ...overrides,
  };
}

test('a well-formed receipt with matching trial counts builds successfully', () => {
  const receipt = buildSelectionBiasReceipt(baseInput());
  assert.equal(receipt.numberOfTrials, 3);
});

test('CORE CLAIM: discarded trials must remain counted -- trial identity count must equal numberOfTrials', () => {
  assert.throws(() => buildSelectionBiasReceipt(baseInput({ numberOfTrials: 5 })), /SELECTION_BIAS_TRIAL_COUNT_MISMATCH/);
});

test('ADVERSARIAL: duplicate trial identities are rejected', () => {
  assert.throws(() => buildSelectionBiasReceipt(baseInput({ trialIdentities: ['t1', 't1', 't3'] })), /SELECTION_BIAS_DUPLICATE_TRIAL_IDENTITY/);
});

test('ADVERSARIAL: raw unnormalized returns cannot be silently used -- a normalization version is required', () => {
  assert.throws(() => buildSelectionBiasReceipt(baseInput({ returnNormalizationVersion: '' })), /SELECTION_BIAS_RETURN_NORMALIZATION_REQUIRED/);
});

test('DSR is scoped to continuous-return series, not rare binary-event targets', () => {
  assert.equal(isDsrApplicableTargetKind('CONTINUOUS_RETURN_SERIES'), true);
  assert.equal(isDsrApplicableTargetKind('RARE_BINARY_EVENT'), false);
});
