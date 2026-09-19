import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildUnderlyingSelectionShadow, compareUnderlyings, type UnderlyingSelectionEvidence,
} from '../src/research/underlying-selection-shadow.js';

const evidence = (overrides: Partial<UnderlyingSelectionEvidence> = {}): UnderlyingSelectionEvidence => ({
  symbol: 'AAPL', avgDollarVolume: 1_000_000, ownershipAcceptabilityScore: 0.7, daysToNextKnownEvent: 30,
  realizedVolatility: 0.25, optionChainQuoteUsableFraction: 0.9, portfolioConcentrationImpact: 0.05,
  ...overrides,
});

test('compareUnderlyings names the exact dimensions on which A beats B, never a bare boolean', () => {
  const a = evidence({ symbol: 'A', avgDollarVolume: 2_000_000 });
  const b = evidence({ symbol: 'B', avgDollarVolume: 1_000_000 });
  const reasons = compareUnderlyings(a, b);
  assert.ok(reasons.some((reason) => reason.dimension === 'avgDollarVolume' && reason.aValue === 2_000_000));
});

test('compareUnderlyings skips a dimension unknown on either side, never assuming it favors one symbol', () => {
  const a = evidence({ symbol: 'A', daysToNextKnownEvent: null });
  const b = evidence({ symbol: 'B', daysToNextKnownEvent: 5 });
  const reasons = compareUnderlyings(a, b);
  assert.ok(!reasons.some((reason) => reason.dimension === 'daysToNextKnownEvent'));
});

test('a symbol strictly better on every known dimension dominates and removes the other from the nondominated set', () => {
  const better = evidence({ symbol: 'BETTER', avgDollarVolume: 5_000_000, ownershipAcceptabilityScore: 0.9 });
  const worse = evidence({ symbol: 'WORSE', avgDollarVolume: 1_000_000, ownershipAcceptabilityScore: 0.5 });
  const result = buildUnderlyingSelectionShadow({ asOf: '2026-09-19T00:00:00.000Z', candidates: [better, worse], existingV1Winner: 'WORSE' });
  assert.deepEqual(result.nondominatedSymbols, ['BETTER']);
  assert.equal(result.existingV1WinnerIsNondominated, false);
});

test('two symbols each better on a different dimension are both nondominated -- no false elimination', () => {
  const highVolume = evidence({ symbol: 'HIGH_VOLUME', avgDollarVolume: 5_000_000, ownershipAcceptabilityScore: 0.3 });
  const goodOwnership = evidence({ symbol: 'GOOD_OWNERSHIP', avgDollarVolume: 1_000_000, ownershipAcceptabilityScore: 0.9 });
  const result = buildUnderlyingSelectionShadow({
    asOf: '2026-09-19T00:00:00.000Z', candidates: [highVolume, goodOwnership], existingV1Winner: 'HIGH_VOLUME',
  });
  assert.deepEqual([...result.nondominatedSymbols].toSorted(), ['GOOD_OWNERSHIP', 'HIGH_VOLUME']);
  assert.equal(result.existingV1WinnerIsNondominated, true);
});

test('an UNKNOWN dimension on both sides never creates false dominance', () => {
  const a = evidence({ symbol: 'A', portfolioConcentrationImpact: null, avgDollarVolume: 1_000_000, ownershipAcceptabilityScore: 0.5 });
  const b = evidence({ symbol: 'B', portfolioConcentrationImpact: null, avgDollarVolume: 1_000_000, ownershipAcceptabilityScore: 0.5 });
  const result = buildUnderlyingSelectionShadow({ asOf: '2026-09-19T00:00:00.000Z', candidates: [a, b], existingV1Winner: null });
  assert.deepEqual([...result.nondominatedSymbols].toSorted(), ['A', 'B']);
});

test('knownDimensionCount reflects exactly how many of the five dimensions are known for a candidate', () => {
  const partial = evidence({
    symbol: 'PARTIAL', ownershipAcceptabilityScore: null, daysToNextKnownEvent: null, portfolioConcentrationImpact: null,
  });
  const result = buildUnderlyingSelectionShadow({ asOf: '2026-09-19T00:00:00.000Z', candidates: [partial], existingV1Winner: null });
  assert.equal(result.assessments[0]?.knownDimensionCount, 2);
});

test('the module never claims broker authority', () => {
  const result = buildUnderlyingSelectionShadow({ asOf: '2026-09-19T00:00:00.000Z', candidates: [evidence()], existingV1Winner: null });
  assert.equal(result.brokerAuthority, false);
});
