import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyTerminalValuationPitSafety, buildAnalyticalTerminalValuation, buildRealizedTerminalValuation,
  type TerminalValuationEvidenceTimestamps,
} from '../src/research/hold-strike-terminal-valuation-pit-contract.js';

const HORIZON = '2026-09-22T14:00:00Z';

function safeEvidence(overrides: Partial<TerminalValuationEvidenceTimestamps> = {}): TerminalValuationEvidenceTimestamps {
  return {
    underlyingObservedAt: '2026-09-22T13:59:00Z', optionInputsObservedAt: '2026-09-22T13:59:30Z',
    volatilityInputsObservedAt: '2026-09-22T13:58:00Z', eventStateObservedAt: '2026-09-22T13:59:45Z', ...overrides,
  };
}

test('classifyTerminalValuationPitSafety is safe when every evidence timestamp precedes the horizon', () => {
  const result = classifyTerminalValuationPitSafety(HORIZON, safeEvidence());
  assert.equal(result.safe, true);
  assert.deepEqual(result.violatingFields, []);
});

test('classifyTerminalValuationPitSafety is safe at the exact horizon boundary (<=)', () => {
  const result = classifyTerminalValuationPitSafety(HORIZON, safeEvidence({ underlyingObservedAt: HORIZON }));
  assert.equal(result.safe, true);
});

test('REPAIR: classifyTerminalValuationPitSafety flags a future-dated evidence field (today\'s Optionomics surface used to value a historical position), never silently accepted', () => {
  const result = classifyTerminalValuationPitSafety(HORIZON, safeEvidence({ volatilityInputsObservedAt: '2026-09-25T00:00:00Z' }));
  assert.equal(result.safe, false);
  assert.deepEqual(result.violatingFields, ['volatilityInputsObservedAt']);
});

test('REPAIR: classifyTerminalValuationPitSafety treats a MISSING evidence timestamp as a violation, never assumed safe by omission', () => {
  const result = classifyTerminalValuationPitSafety(HORIZON, safeEvidence({ eventStateObservedAt: null }));
  assert.equal(result.safe, false);
  assert.deepEqual(result.violatingFields, ['eventStateObservedAt']);
});

test('classifyTerminalValuationPitSafety reports MULTIPLE violating fields together, never just the first one found', () => {
  const result = classifyTerminalValuationPitSafety(HORIZON, safeEvidence({ underlyingObservedAt: null, optionInputsObservedAt: '2026-10-01T00:00:00Z' }));
  assert.deepEqual([...result.violatingFields].sort(), ['optionInputsObservedAt', 'underlyingObservedAt']);
});

test('buildAnalyticalTerminalValuation returns ANALYTICAL_MTM_AT_HORIZON with a real mark when PIT-safe', () => {
  const record = buildAnalyticalTerminalValuation('chain-1', HORIZON, 'model-v1', ['ev-1'], safeEvidence(), () => 42.5);
  assert.equal(record.terminalValuationProvenance, 'ANALYTICAL_MTM_AT_HORIZON');
  assert.equal(record.analyticalMarkValue, 42.5);
  assert.equal(record.terminalValuationTimestamp, HORIZON);
});

test('REPAIR: buildAnalyticalTerminalValuation returns TERMINAL_VALUATION_NOT_IDENTIFIABLE and NEVER CALLS computeMark when evidence is not PIT-safe', () => {
  let computeMarkCalled = false;
  const record = buildAnalyticalTerminalValuation(
    'chain-1', HORIZON, 'model-v1', ['ev-1'], safeEvidence({ optionInputsObservedAt: '2026-10-01T00:00:00Z' }),
    () => { computeMarkCalled = true; return 999; },
  );
  assert.equal(record.terminalValuationProvenance, 'TERMINAL_VALUATION_NOT_IDENTIFIABLE');
  assert.equal(record.analyticalMarkValue, null);
  assert.equal(record.terminalValuationTimestamp, null);
  assert.equal(computeMarkCalled, false);
});

test('buildRealizedTerminalValuation reports REALIZED with the real realized figure, no analytical machinery involved', () => {
  const record = buildRealizedTerminalValuation('chain-1', HORIZON, -150);
  assert.equal(record.terminalValuationProvenance, 'REALIZED');
  assert.equal(record.analyticalMarkValue, -150);
});
