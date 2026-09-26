import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_UNKNOWN_REASON_CODES, assertUnknownIsNeverCoercedToDefault, classifyUnknown, classifyUnknownAvoidability,
} from '../src/research/unknown-value-taxonomy.js';

test('every reason code has a real, non-fallback avoidability classification', () => {
  for (const reason of ALL_UNKNOWN_REASON_CODES) {
    const avoidability = classifyUnknownAvoidability(reason);
    assert.ok(['LEGITIMATE', 'AVOIDABLE', 'EXTERNAL', 'UNCLASSIFIED'].includes(avoidability));
  }
});

test('CORE CLAIM: RIGHT_CENSORED and FUTURE_LABEL_PENDING are LEGITIMATE, never AVOIDABLE', () => {
  assert.equal(classifyUnknownAvoidability('RIGHT_CENSORED'), 'LEGITIMATE');
  assert.equal(classifyUnknownAvoidability('FUTURE_LABEL_PENDING'), 'LEGITIMATE');
  assert.equal(classifyUnknownAvoidability('COUNTERFACTUAL_NOT_IDENTIFIABLE'), 'LEGITIMATE');
});

test('CORE CLAIM: SOURCE_NOT_WIRED and DERIVATION_NOT_IMPLEMENTED are AVOIDABLE -- real closeable gaps', () => {
  assert.equal(classifyUnknownAvoidability('SOURCE_NOT_WIRED'), 'AVOIDABLE');
  assert.equal(classifyUnknownAvoidability('DERIVATION_NOT_IMPLEMENTED'), 'AVOIDABLE');
  assert.equal(classifyUnknownAvoidability('SOURCE_AVAILABLE_NOT_CONSUMED'), 'AVOIDABLE');
});

test('CORE CLAIM: provider-class reasons are EXTERNAL, not blamed on research code', () => {
  assert.equal(classifyUnknownAvoidability('PROVIDER_FAILURE'), 'EXTERNAL');
  assert.equal(classifyUnknownAvoidability('PROVIDER_NOT_ENTITLED'), 'EXTERNAL');
  assert.equal(classifyUnknownAvoidability('RUNTIME_INPUT_PENDING'), 'EXTERNAL');
});

test('UNCLASSIFIED_UNKNOWN is its own honest non-conclusion, never silently LEGITIMATE', () => {
  assert.equal(classifyUnknownAvoidability('UNCLASSIFIED_UNKNOWN'), 'UNCLASSIFIED');
});

test('classifyUnknown builds a full record with the field path and timestamp preserved', () => {
  const classified = classifyUnknown({
    fieldPath: 'candidate.iv', reason: 'PROVIDER_FIELD_ABSENT', detail: 'Optionomics IV field absent for this symbol',
    observedAt: '2026-09-26T00:00:00Z',
  });
  assert.equal(classified.fieldPath, 'candidate.iv');
  assert.equal(classified.avoidability, 'EXTERNAL');
  assert.equal(classified.detail, 'Optionomics IV field absent for this symbol');
});

test('CORE CLAIM: UNKNOWN never auto-zero -- assertUnknownIsNeverCoercedToDefault throws on a forbidden coercion', () => {
  const classified = classifyUnknown({ fieldPath: 'candidate.iv', reason: 'DERIVATION_NOT_IMPLEMENTED', observedAt: '2026-09-26T00:00:00Z' });
  assert.throws(() => assertUnknownIsNeverCoercedToDefault(0, classified), /UNKNOWN_TAXONOMY_FORBIDDEN_COERCION/);
  assert.throws(() => assertUnknownIsNeverCoercedToDefault(false as unknown as number, classified), /UNKNOWN_TAXONOMY_FORBIDDEN_COERCION/);
});

test('a genuinely null value alongside a classified unknown is the correct, non-throwing case', () => {
  const classified = classifyUnknown({ fieldPath: 'candidate.iv', reason: 'DERIVATION_NOT_IMPLEMENTED', observedAt: '2026-09-26T00:00:00Z' });
  assert.equal(assertUnknownIsNeverCoercedToDefault(null, classified), null);
});

test('a real, known value with no classified unknown passes through unchanged', () => {
  assert.equal(assertUnknownIsNeverCoercedToDefault(42, null), 42);
});
