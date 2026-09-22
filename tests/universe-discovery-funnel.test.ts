import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeUniverseFunnel, summarizeStageRates, productionUniverseStageOrder, type CycleScopedStageDiagnostic,
} from '../src/research/universe-discovery-funnel.js';

function record(overrides: Partial<CycleScopedStageDiagnostic> = {}): CycleScopedStageDiagnostic {
  return {
    cycleId: 'cycle-1', stage: 'SOURCE_ASSETS', inputCount: 100, outputCount: 100, rejectedCount: 0,
    providerState: 'READY', durationMs: 50, reasonCounts: {}, ...overrides,
  };
}

function fullHealthyFunnel(cycleId = 'cycle-1'): CycleScopedStageDiagnostic[] {
  return productionUniverseStageOrder.map((stage, index) => record({
    cycleId, stage, inputCount: 100 - index * 5, outputCount: 100 - (index + 1) * 5, rejectedCount: 5,
  }));
}

test('the exact real 4-stage Production set is accepted (type-level guarantee, re-confirmed at runtime)', () => {
  assert.deepEqual([...productionUniverseStageOrder], ['SOURCE_ASSETS', 'EXCHANGE_FILTER', 'STOCK_BARS', 'OPTIONABILITY']);
});

test('a fully healthy funnel (every stage has output) reports firstEmptyStage=null', () => {
  const result = analyzeUniverseFunnel('cycle-1', fullHealthyFunnel());
  assert.equal(result.pipelineCoverageComplete, true);
  assert.equal(result.firstEmptyStage, null);
});

test('CORE CLAIM: the first real stage with zero output is identified precisely, never guessed', () => {
  const records = productionUniverseStageOrder.map((stage) =>
    record({ stage, outputCount: stage === 'STOCK_BARS' ? 0 : 50, inputCount: 50 }));
  const result = analyzeUniverseFunnel('cycle-1', records);
  assert.equal(result.firstEmptyStage, 'STOCK_BARS');
});

test('CORE CLAIM: zero output at SOURCE_ASSETS under a healthy provider is reported as a real stage fact, not silently converted to "no opportunity"', () => {
  const records = productionUniverseStageOrder.map((stage) =>
    record({ stage, inputCount: stage === 'SOURCE_ASSETS' ? 50 : 0, outputCount: 0, providerState: 'READY' }));
  const result = analyzeUniverseFunnel('cycle-1', records);
  assert.equal(result.firstEmptyStage, 'SOURCE_ASSETS');
  assert.equal(result.firstEmptyStageIsProviderFailure, false);
  // The result object itself has no "noOpportunity"/"systemReady" field --
  // that interpretation is structurally not this module's to make.
  assert.ok(!('noOpportunity' in result));
  assert.ok(!('systemReady' in result));
});

test('ADVERSARIAL: provider/auth failure at a stage is distinguished from a genuine VALID_EMPTY/READY zero', () => {
  const providerFailRecords = productionUniverseStageOrder.map((stage) =>
    record({ stage, outputCount: stage === 'STOCK_BARS' ? 0 : 50, providerState: stage === 'STOCK_BARS' ? 'INVALID_AUTH' : 'READY' }));
  const healthyEmptyRecords = productionUniverseStageOrder.map((stage) =>
    record({ stage, outputCount: stage === 'STOCK_BARS' ? 0 : 50, providerState: stage === 'STOCK_BARS' ? 'VALID_EMPTY' : 'READY' }));
  const providerFail = analyzeUniverseFunnel('cycle-1', providerFailRecords);
  const healthyEmpty = analyzeUniverseFunnel('cycle-2', healthyEmptyRecords.map((r) => ({ ...r, cycleId: 'cycle-2' })));
  assert.equal(providerFail.firstEmptyStageIsProviderFailure, true);
  assert.equal(healthyEmpty.firstEmptyStageIsProviderFailure, false);
});

test('ADVERSARIAL: missing stage coverage is reported explicitly, never silently guessed as the failing stage', () => {
  const partial = productionUniverseStageOrder.slice(0, 2).map((stage) => record({ stage }));
  const result = analyzeUniverseFunnel('cycle-1', partial);
  assert.equal(result.pipelineCoverageComplete, false);
  assert.equal(result.firstEmptyStage, null);
  assert.equal(result.missingStages.length, 2);
});

test('ADVERSARIAL: a cycleId mismatch across records is rejected, never silently merged', () => {
  assert.throws(() => analyzeUniverseFunnel('cycle-1', [record({ cycleId: 'cycle-2' })]), /UNIVERSE_FUNNEL_CYCLE_ID_MISMATCH/);
});

test('ADVERSARIAL: outputCount+rejectedCount exceeding inputCount is rejected as inconsistent', () => {
  assert.throws(() => analyzeUniverseFunnel('cycle-1', [record({ inputCount: 10, outputCount: 8, rejectedCount: 8 })]), /STAGE_COUNTS_INCONSISTENT/);
});

test('a healthy complete stage remains semantically distinct from a provider-failed stage even when both later stages are empty', () => {
  const healthy = analyzeUniverseFunnel('cycle-1', productionUniverseStageOrder.map((stage) =>
    record({ stage, outputCount: 0, providerState: 'VALID_EMPTY' })));
  const failed = analyzeUniverseFunnel('cycle-2', productionUniverseStageOrder.map((stage) =>
    record({ cycleId: 'cycle-2', stage, outputCount: 0, providerState: 'PROVIDER_ERROR' })));
  assert.equal(healthy.firstEmptyStageIsProviderFailure, false);
  assert.equal(failed.firstEmptyStageIsProviderFailure, true);
});

test('summarizeStageRates computes real empty-output and provider-failure rates SEPARATELY per stage', () => {
  const cycle1 = fullHealthyFunnel('cycle-1');
  const cycle2 = productionUniverseStageOrder.map((stage) => record({
    cycleId: 'cycle-2', stage, outputCount: stage === 'OPTIONABILITY' ? 0 : 10, inputCount: 10,
    providerState: stage === 'OPTIONABILITY' ? 'PROVIDER_ERROR' : 'READY',
  }));
  const summaries = summarizeStageRates([...cycle1, ...cycle2]);
  const optionability = summaries.find((s) => s.stage === 'OPTIONABILITY');
  assert.equal(optionability?.cyclesObserved, 2);
  assert.equal(optionability?.emptyOutputRate, 0.5);
  assert.equal(optionability?.providerFailureRate, 0.5);
  assert.ok(!('combinedFailureRate' in (optionability as object)));
});

test('summarizeStageRates never estimates a rate for a stage with zero observed cycles', () => {
  const summaries = summarizeStageRates([record({ stage: 'SOURCE_ASSETS' })]);
  const unobserved = summaries.find((s) => s.stage === 'OPTIONABILITY');
  assert.equal(unobserved?.cyclesObserved, 0);
  assert.equal(unobserved?.emptyOutputRate, 0);
  assert.equal(unobserved?.medianStageLatencyMs, null);
});
