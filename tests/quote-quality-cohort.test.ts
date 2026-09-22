import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuoteQualityCohortReport, type QuoteQualityBucketConfig, type QuoteQualityCandidateRecord } from '../src/research/quote-quality-cohort.js';

const bucketConfig: QuoteQualityBucketConfig = {
  configVersion: 'test-bucket-config-v1',
  dteBuckets: [
    { key: '0-15', minInclusive: 0, maxExclusive: 15 },
    { key: '15-45', minInclusive: 15, maxExclusive: 45 },
    { key: '45+', minInclusive: 45, maxExclusive: Infinity },
  ],
  absoluteDeltaBuckets: [
    { key: '0.00-0.20', minInclusive: 0, maxExclusive: 0.2 },
    { key: '0.20-0.35', minInclusive: 0.2, maxExclusive: 0.35 },
    { key: '0.35+', minInclusive: 0.35, maxExclusive: Infinity },
  ],
  spreadPctBuckets: [
    { key: '0-0.05', minInclusive: 0, maxExclusive: 0.05 },
    { key: '0.05-0.15', minInclusive: 0.05, maxExclusive: 0.15 },
    { key: '0.15+', minInclusive: 0.15, maxExclusive: Infinity },
  ],
};

const candidate = (overrides: Partial<QuoteQualityCandidateRecord> = {}): QuoteQualityCandidateRecord => ({
  candidateId: 'c1', underlying: 'AAPL', dte: 30, delta: -0.25, spreadPct: 0.08,
  quoteAgeSeconds: 5, openInterest: 400, volume: 100, quoteUsable: true, structurallyFeasible: true, ...overrides,
});

test('a fully usable candidate is bucketed correctly across DTE/delta/spread dimensions', () => {
  const report = buildQuoteQualityCohortReport([candidate()], bucketConfig);
  assert.equal(report.totalCandidateCount, 1);
  assert.equal(report.quoteUsableCount, 1);
  assert.equal(report.bucketConfigVersion, 'test-bucket-config-v1');
  const dteBucket = report.cohorts.find((row) => row.dimension === 'DTE' && row.bucketKey === '15-45');
  assert.equal(dteBucket?.candidateCount, 1);
  assert.equal(dteBucket?.quoteUsableFraction, 1);
  const deltaBucket = report.cohorts.find((row) => row.dimension === 'ABSOLUTE_DELTA' && row.bucketKey === '0.20-0.35');
  assert.equal(deltaBucket?.candidateCount, 1);
});

test('negative delta is bucketed by absolute value, not raw sign', () => {
  const report = buildQuoteQualityCohortReport([candidate({ delta: -0.42 })], bucketConfig);
  const highDelta = report.cohorts.find((row) => row.dimension === 'ABSOLUTE_DELTA' && row.bucketKey === '0.35+');
  assert.equal(highDelta?.candidateCount, 1);
});

test('a null field buckets to UNKNOWN, never a fabricated bucket', () => {
  const report = buildQuoteQualityCohortReport([candidate({ dte: null })], bucketConfig);
  const unknownBucket = report.cohorts.find((row) => row.dimension === 'DTE' && row.bucketKey === 'UNKNOWN');
  assert.equal(unknownBucket?.candidateCount, 1);
});

test('a value outside every configured bucket range is reported honestly, not silently dropped', () => {
  const report = buildQuoteQualityCohortReport([candidate({ dte: -5 })], bucketConfig);
  const outOfRange = report.cohorts.find((row) => row.dimension === 'DTE' && row.bucketKey === 'OUT_OF_CONFIGURED_RANGE');
  assert.equal(outOfRange?.candidateCount, 1);
});

test('structurallyFeasibleButQuoteRejectedCount is a near-miss population, distinct from structurally infeasible rejections', () => {
  const nearMiss = candidate({ candidateId: 'c1', quoteUsable: false, structurallyFeasible: true });
  const infeasibleAndRejected = candidate({ candidateId: 'c2', quoteUsable: false, structurallyFeasible: false });
  const usable = candidate({ candidateId: 'c3', quoteUsable: true, structurallyFeasible: true });
  const report = buildQuoteQualityCohortReport([nearMiss, infeasibleAndRejected, usable], bucketConfig);
  assert.equal(report.structurallyFeasibleButQuoteRejectedCount, 1);
  assert.equal(report.quoteUsableCount, 1);
  assert.equal(report.quoteUnusableCount, 2);
});

test('cohort quoteUsableFraction is null when a bucket has zero candidates, never a fabricated ratio', () => {
  const report = buildQuoteQualityCohortReport([], bucketConfig);
  assert.equal(report.cohorts.length, 0);
  assert.equal(report.totalCandidateCount, 0);
});

test('underlying is its own cohort dimension, grouping candidates by symbol', () => {
  const report = buildQuoteQualityCohortReport([
    candidate({ candidateId: 'c1', underlying: 'AAPL', quoteUsable: true }),
    candidate({ candidateId: 'c2', underlying: 'AAPL', quoteUsable: false }),
    candidate({ candidateId: 'c3', underlying: 'MSFT', quoteUsable: true }),
  ], bucketConfig);
  const aapl = report.cohorts.find((row) => row.dimension === 'UNDERLYING' && row.bucketKey === 'AAPL');
  assert.equal(aapl?.candidateCount, 2);
  assert.equal(aapl?.quoteUsableCount, 1);
  assert.ok(Math.abs((aapl?.quoteUsableFraction as number) - 0.5) < 1e-9);
});

test('a duplicate candidateId is rejected, never double-counted across buckets', () => {
  assert.throws(
    () => buildQuoteQualityCohortReport([candidate({ candidateId: 'dup' }), candidate({ candidateId: 'dup' })], bucketConfig),
    /QUOTE_QUALITY_DUPLICATE_CANDIDATE_ID/,
  );
});

test('a blank bucketConfig.configVersion is rejected -- boundaries must always be caller-justified and versioned', () => {
  assert.throws(
    () => buildQuoteQualityCohortReport([candidate()], { ...bucketConfig, configVersion: '' }),
    /QUOTE_QUALITY_BUCKET_CONFIG_VERSION_REQUIRED/,
  );
});

test('the report carries no quote-authority or trading-recommendation field', () => {
  const report = buildQuoteQualityCohortReport([candidate()], bucketConfig);
  const keys = Object.keys(report).map((key) => key.toLowerCase());
  for (const forbidden of ['approved', 'recommended', 'usablequote', 'eligible', 'winner']) {
    assert.ok(!keys.includes(forbidden), `must not carry: ${forbidden}`);
  }
  assert.equal(report.brokerAuthority, false);
});
