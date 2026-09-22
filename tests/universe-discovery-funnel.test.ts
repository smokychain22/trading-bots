import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeUniverseFunnel, summarizeStageRates, universeDiscoveryStages, type StageRecord,
} from '../src/research/universe-discovery-funnel.js';

function record(overrides: Partial<StageRecord> = {}): StageRecord {
  return {
    cycleId: 'cycle-1', stage: 'SOURCE_ASSETS', inputCount: 100, outputCount: 100, rejectedCount: 0,
    providerState: 'OK', evidenceState: 'VALID_EMPTY', durationMs: 50, reasonCounts: {}, ...overrides,
  };
}

function fullHealthyFunnel(cycleId = 'cycle-1'): StageRecord[] {
  return universeDiscoveryStages.map((stage, index) => record({
    cycleId, stage, inputCount: 100 - index * 5, outputCount: 100 - (index + 1) * 5, rejectedCount: 5,
  }));
}

test('a fully healthy funnel (every stage has output) reports firstEmptyStage=null', () => {
  const result = analyzeUniverseFunnel('cycle-1', fullHealthyFunnel());
  assert.equal(result.pipelineCoverageComplete, true);
  assert.equal(result.firstEmptyStage, null);
});

test('CORE CLAIM: the first stage (in real pipeline order) with zero output is identified precisely, never guessed', () => {
  const records = universeDiscoveryStages.map((stage) =>
    record({ stage, outputCount: stage === 'LIQUIDITY' ? 0 : 50, inputCount: 50 }));
  const result = analyzeUniverseFunnel('cycle-1', records);
  assert.equal(result.firstEmptyStage, 'LIQUIDITY');
});

test('ADVERSARIAL: missing stage coverage is reported explicitly, never silently guessed as the failing stage', () => {
  const partial = universeDiscoveryStages.slice(0, 3).map((stage) => record({ stage }));
  const result = analyzeUniverseFunnel('cycle-1', partial);
  assert.equal(result.pipelineCoverageComplete, false);
  assert.equal(result.firstEmptyStage, null);
  assert.equal(result.missingStages.length, universeDiscoveryStages.length - 3);
});

test('ADVERSARIAL: a cycleId mismatch across records is rejected, never silently merged', () => {
  assert.throws(() => analyzeUniverseFunnel('cycle-1', [record({ cycleId: 'cycle-2' })]), /UNIVERSE_FUNNEL_CYCLE_ID_MISMATCH/);
});

test('ADVERSARIAL: outputCount+rejectedCount exceeding inputCount is rejected as inconsistent', () => {
  assert.throws(() => analyzeUniverseFunnel('cycle-1', [record({ inputCount: 10, outputCount: 8, rejectedCount: 8 })]), /STAGE_COUNTS_INCONSISTENT/);
});

test('summarizeStageRates computes real empty-universe and provider-failure rates per stage across a batch', () => {
  const cycle1 = fullHealthyFunnel('cycle-1');
  const cycle2 = universeDiscoveryStages.map((stage) => record({
    cycleId: 'cycle-2', stage, outputCount: stage === 'OPTIONABILITY' ? 0 : 10, inputCount: 10,
    evidenceState: stage === 'OPTIONABILITY' ? 'PROVIDER_ERROR' : 'VALID_EMPTY',
  }));
  const summaries = summarizeStageRates([...cycle1, ...cycle2]);
  const optionability = summaries.find((s) => s.stage === 'OPTIONABILITY');
  assert.equal(optionability?.cyclesObserved, 2);
  assert.equal(optionability?.emptyUniverseRate, 0.5);
  assert.equal(optionability?.providerFailureRate, 0.5);
});

test('summarizeStageRates never estimates a rate for a stage with zero observed cycles', () => {
  const summaries = summarizeStageRates([record({ stage: 'SOURCE_ASSETS' })]);
  const unobserved = summaries.find((s) => s.stage === 'CANDIDATE_ASSEMBLY');
  assert.equal(unobserved?.cyclesObserved, 0);
  assert.equal(unobserved?.emptyUniverseRate, 0);
  assert.equal(unobserved?.medianStageLatencyMs, null);
});
