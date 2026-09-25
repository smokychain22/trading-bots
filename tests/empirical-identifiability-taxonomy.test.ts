import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIdentifiabilityUse, assertNotShadowClaimingObservedParallel, factualOutcome,
  isUseAllowed, notIdentifiableOutcome, outcomeValueForUse,
} from '../src/research/empirical-identifiability-taxonomy.js';

test('FACTUAL_OBSERVED is eligible for every use, including promotion evidence', () => {
  assert.equal(isUseAllowed('FACTUAL_OBSERVED', 'PROMOTION_EVIDENCE'), true);
  assert.equal(isUseAllowed('FACTUAL_OBSERVED', 'SUPERVISED_TRAINING'), true);
});

test('CORE CLAIM: MODEL_BASED_ESTIMATE is never eligible as ground truth (supervised training or promotion evidence)', () => {
  assert.equal(isUseAllowed('MODEL_BASED_ESTIMATE', 'SUPERVISED_TRAINING'), false);
  assert.equal(isUseAllowed('MODEL_BASED_ESTIMATE', 'PROMOTION_EVIDENCE'), false);
  assert.throws(() => assertIdentifiabilityUse('MODEL_BASED_ESTIMATE', 'SUPERVISED_TRAINING'), /IDENTIFIABILITY_USE_NOT_ALLOWED/);
});

test('CORE CLAIM: NOT_IDENTIFIABLE is eligible for nothing -- retained, never treated as usable outcome truth', () => {
  assert.equal(isUseAllowed('NOT_IDENTIFIABLE', 'RESEARCH_VISUALIZATION'), false);
});

test('a NOT_IDENTIFIABLE outcome structurally carries a null value', () => {
  const outcome = notIdentifiableOutcome<number>();
  assert.equal(outcome.value, null);
});

test('outcomeValueForUse returns null when the use is not allowed for the status, never the raw value', () => {
  const outcome = factualOutcome(42);
  assert.equal(outcomeValueForUse(outcome, 'PROMOTION_EVIDENCE'), 42);
  const modelBased = { status: 'MODEL_BASED_ESTIMATE' as const, value: 99 };
  assert.equal(outcomeValueForUse(modelBased, 'SUPERVISED_TRAINING'), null);
});

test('ADVERSARIAL: a shadow-only prediction can never be labeled OBSERVED_PARALLEL', () => {
  assert.throws(
    () => assertNotShadowClaimingObservedParallel({ status: 'OBSERVED_PARALLEL', wasShadowOnly: true }),
    /SHADOW_PREDICTION_CANNOT_BE_OBSERVED_PARALLEL/,
  );
  assert.doesNotThrow(() => assertNotShadowClaimingObservedParallel({ status: 'OBSERVED_PARALLEL', wasShadowOnly: false }));
});
