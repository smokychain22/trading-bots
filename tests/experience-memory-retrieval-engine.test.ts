import assert from 'node:assert/strict';
import test from 'node:test';
import { isEligibleHistoricalExperience, retrieveSimilarSituations, type HistoricalEpisodeRecord, type SimilarityQuery } from '../src/research/experience-memory-retrieval-engine.js';

function episode(overrides: Partial<HistoricalEpisodeRecord> = {}): HistoricalEpisodeRecord {
  return {
    episodeId: 'e1', chainId: 'chain-1', strategy: 'THETA_CONVENTIONAL',
    labelAvailableAt: '2026-09-01T00:00:00Z', regime: 'LOW_VOL', flowCohort: 'FLOW_NEUTRAL',
    afterCostOutcome: 50, wasAssignment: false, wasTailEvent: false, isWaitOutcome: false,
    similarityFeatures: { iv: 0.3, delta: 0.2 }, ...overrides,
  };
}

function query(overrides: Partial<SimilarityQuery> = {}): SimilarityQuery {
  return {
    queryDecisionId: 'q1', decisionAt: '2026-09-26T00:00:00Z', similarityDefinitionVersion: 'v1',
    queryFeatures: { iv: 0.3, delta: 0.2 }, regime: 'LOW_VOL', flowCohort: 'FLOW_NEUTRAL', maxDistance: 0.1,
    ...overrides,
  };
}

test('CORE CLAIM: an episode with no labelAvailableAt is never eligible historical experience', () => {
  assert.equal(isEligibleHistoricalExperience(episode({ labelAvailableAt: null }), '2026-09-26T00:00:00Z'), false);
});

test('CORE CLAIM: an episode whose label became available AFTER the query decision time is excluded -- anti-leakage', () => {
  assert.equal(isEligibleHistoricalExperience(episode({ labelAvailableAt: '2026-10-01T00:00:00Z' }), '2026-09-26T00:00:00Z'), false);
});

test('an episode with a real, strictly-earlier label is eligible', () => {
  assert.equal(isEligibleHistoricalExperience(episode(), '2026-09-26T00:00:00Z'), true);
});

test('an empty corpus produces the honest empty report, not an error', () => {
  const report = retrieveSimilarSituations(query(), []);
  assert.equal(report.similarEpisodeCount, 0);
  assert.equal(report.independentEpisodeCount, 0);
});

test('CORE CLAIM: a future-labeled episode never contributes to retrieval even if otherwise a perfect match', () => {
  const futureEpisode = episode({ labelAvailableAt: '2026-12-01T00:00:00Z' });
  const report = retrieveSimilarSituations(query(), [futureEpisode]);
  assert.equal(report.similarEpisodeCount, 0);
});

test('a real, eligible, close match is retrieved and reported per-strategy, never combined into one score', () => {
  const report = retrieveSimilarSituations(query(), [episode()]);
  assert.equal(report.similarEpisodeCount, 1);
  assert.equal(report.independentEpisodeCount, 1);
  const q = report.perStrategy.find((s) => s.strategy === 'THETA_CONVENTIONAL');
  assert.equal(q?.episodeCount, 1);
  assert.equal(q?.meanAfterCostOutcome, 50);
});

test('a distant match beyond maxDistance is excluded', () => {
  const distant = episode({ similarityFeatures: { iv: 0.9, delta: 0.9 } });
  const report = retrieveSimilarSituations(query(), [distant]);
  assert.equal(report.similarEpisodeCount, 0);
});
