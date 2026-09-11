import assert from 'node:assert/strict';
import test from 'node:test';
import { rankUnderlyingCandidates, type UnderlyingSelectorCandidate } from '../src/theta/underlying-selector-contract.js';

const scores = (value: number | null) => ({ liquidity:value, ownershipSuitability:value, drawdownRecovery:value,
  trendMomentum:value, realizedVolatilitySuitability:value, eventSafety:value, sectorDiversification:value,
  correlationDiversification:value, portfolioCapacity:value, fundamentalQuality:value });
const evidence = (value: number | null) => {
  const item = { provider:'DERIVED' as const, operationAlias:'test', asOf:value === null ? null : '2026-09-12T12:00:00.000Z',
    retrievedAt:'2026-09-12T12:00:01.000Z', state:value === null ? 'UNKNOWN' as const : 'GOOD' as const, modelVersion:'test-v1' };
  return { liquidity:item, ownershipSuitability:item, drawdownRecovery:item, trendMomentum:item,
    realizedVolatilitySuitability:item, eventSafety:item, sectorDiversification:item,
    correlationDiversification:item, portfolioCapacity:item, fundamentalQuality:item };
};
const candidate = (symbol: string, value: number | null, mechanicallyEligible = true): UnderlyingSelectorCandidate => ({
  symbol, featureSnapshotId:`snapshot-${symbol}`, featureSetVersion:'test-v1', mechanicallyEligible,
  hardBlockers:mechanicallyEligible ? [] : ['BROKER_DATA_STALE'], scores:scores(value), scoreProvenance:evidence(value),
});

test('selector ranks the Pareto frontier without arbitrary weights', () => {
  const candidates: UnderlyingSelectorCandidate[] = [
    candidate('B', 0.4),
    candidate('A', 0.8),
  ];
  const result = rankUnderlyingCandidates(candidates);
  assert.deepEqual(result.ranked.map((candidate) => candidate.symbol), ['A', 'B']);
  assert.deepEqual(result.paretoFrontierSymbols, ['A']);
});

test('UNKNOWN scores remain recorded and are never converted to zero', () => {
  const result = rankUnderlyingCandidates([
    candidate('A', null),
    candidate('B', 0.2),
  ]);
  assert.equal(result.unknownScoreFamiliesBySymbol.A.length, 10);
  assert.deepEqual(result.unrankableSymbols, ['A']);
  assert.deepEqual(result.paretoFrontierSymbols, ['B']);
});

test('mechanically blocked underlyings are excluded from ranking', () => {
  const result = rankUnderlyingCandidates([
    candidate('A', 1, false),
  ]);
  assert.deepEqual(result.ranked, []);
});
