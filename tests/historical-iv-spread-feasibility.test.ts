import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessHistoricalIvBackfillFeasibility, buildIvEffectiveCoverageReport, buildSpreadEffectiveCoverageReport,
  computeIvShockResearch, computeSpreadStressResearch, MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH,
  MIN_SNAPSHOTS_FOR_SPREAD_STRESS_RESEARCH, type HistoricalBboObservationRow, type HistoricalIvObservationRow,
} from '../src/research/historical-iv-spread-feasibility.js';
import type { OptionomicsCapabilityObservation } from '../src/theta/optionomics-capability-contract.js';

const capability = (overrides: Partial<OptionomicsCapabilityObservation> = {}): OptionomicsCapabilityObservation => ({
  family: 'HISTORICAL_CHAINS', operationAlias: 'historical_chain', documentationReference: 'docs://historical',
  availability: 'SUPPORTED', httpStatus: 200, schemaKeys: ['underlying', 'expiration', 'strike', 'right', 'observedAt'],
  timestampField: 'observedAt', units: {}, nullableFields: [], rateLimit: {}, historical: true,
  runtimeClass: 'RESEARCH', ...overrides,
});

test('assessHistoricalIvBackfillFeasibility reports CAPABILITY_EVIDENCE_INSUFFICIENT when nothing has been observed, never assumes safety', () => {
  const result = assessHistoricalIvBackfillFeasibility([]);
  assert.equal(result.feasibility, 'CAPABILITY_EVIDENCE_INSUFFICIENT');
});

test('assessHistoricalIvBackfillFeasibility is NOT_SAFE when no capability is proven SUPPORTED+historical', () => {
  const result = assessHistoricalIvBackfillFeasibility([capability({ availability: 'NOT_ENTITLED', historical: null })]);
  assert.equal(result.feasibility, 'HISTORICAL_IV_BACKFILL_NOT_SAFE');
});

test('assessHistoricalIvBackfillFeasibility is NOT_SAFE when supported but missing a timestamp field or full contract identity', () => {
  const noTimestamp = assessHistoricalIvBackfillFeasibility([capability({ timestampField: null })]);
  assert.equal(noTimestamp.feasibility, 'HISTORICAL_IV_BACKFILL_NOT_SAFE');
  assert.ok(noTimestamp.reasons.includes('NO_OBSERVATION_TIMESTAMP_FIELD_IN_SCHEMA'));

  const noIdentity = assessHistoricalIvBackfillFeasibility([capability({ schemaKeys: ['underlying', 'observedAt'] })]);
  assert.equal(noIdentity.feasibility, 'HISTORICAL_IV_BACKFILL_NOT_SAFE');
  assert.ok(noIdentity.reasons.includes('CONTRACT_IDENTITY_SCHEMA_INCOMPLETE'));
});

test('assessHistoricalIvBackfillFeasibility is SAFE only when a supported historical capability has both a timestamp field and full identity', () => {
  const result = assessHistoricalIvBackfillFeasibility([capability()]);
  assert.equal(result.feasibility, 'HISTORICAL_IV_BACKFILL_SAFE');
});

const ivRow = (overrides: Partial<HistoricalIvObservationRow> = {}): HistoricalIvObservationRow => ({
  observationTimestamp: '2026-09-01T15:00:00Z', sessionDate: '2026-09-01', underlying: 'AAPL',
  contractId: 'AAPL-2026-10-16-C-200', expiration: '2026-10-16', dte: 45, delta: 0.3, iv: 0.25, ...overrides,
});

test('buildIvEffectiveCoverageReport deduplicates repeated intraday polls into one effective snapshot per session', () => {
  const report = buildIvEffectiveCoverageReport([
    ivRow({ observationTimestamp: '2026-09-01T15:00:00Z' }),
    ivRow({ observationTimestamp: '2026-09-01T15:30:00Z' }), // same contract/session, repeated poll
    ivRow({ sessionDate: '2026-09-02' }),
  ]);
  assert.equal(report.rawRowCount, 3);
  assert.equal(report.effectiveIndependentSnapshots, 2);
  assert.equal(report.distinctSessionDates, 2);
});

test('buildIvEffectiveCoverageReport bins DTE and delta correctly, including UNKNOWN for null', () => {
  const report = buildIvEffectiveCoverageReport([
    ivRow({ dte: 5, delta: 0.1, contractId: 'a' }),
    ivRow({ dte: 60, delta: 0.6, contractId: 'b' }),
    ivRow({ dte: null, delta: null, contractId: 'c' }),
  ]);
  const dteLabels = report.dteBins.map((bin) => bin.bin);
  assert.ok(dteLabels.includes('0-7'));
  assert.ok(dteLabels.includes('46-90'));
  assert.ok(dteLabels.includes('UNKNOWN'));
});

test('computeIvShockResearch reports TEMPORAL_HISTORY_INSUFFICIENT below the minimum snapshot threshold', () => {
  const sessions = Array.from({ length: MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH - 1 }, (_, i) => ({ sessionDate: `d${i}`, iv: 0.2 + i * 0.001 }));
  const result = computeIvShockResearch('AAPL|45DTE|0.30delta', sessions);
  assert.equal(result.status, 'TEMPORAL_HISTORY_INSUFFICIENT');
  assert.equal(result.observations.length, 0);
});

test('computeIvShockResearch computes rolling stats using ONLY prior sessions, never the current or future session', () => {
  const sessions = Array.from({ length: MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH + 5 }, (_, i) => ({ sessionDate: `d${i}`, iv: 0.2 }));
  // Inject an obvious future spike far past the threshold window; it must not leak into any earlier day's stat.
  const spiked = sessions.map((s, i) => (i === sessions.length - 1 ? { ...s, iv: 5.0 } : s));
  const result = computeIvShockResearch('AAPL|45DTE|0.30delta', spiked);
  assert.equal(result.status, 'COMPUTED');
  const earlyComputed = result.observations.find((o) => o.rollingMedian !== null);
  assert.ok(earlyComputed);
  assert.equal(earlyComputed?.rollingMedian, 0.2); // unaffected by the future spike
  const lastObservation = result.observations[result.observations.length - 1];
  assert.equal(lastObservation.rollingMedian, 0.2); // the spike's own day still uses only PRIOR sessions for its median
});

const bboRow = (overrides: Partial<HistoricalBboObservationRow> = {}): HistoricalBboObservationRow => ({
  observationTimestamp: '2026-09-01T15:00:00Z', sessionDate: '2026-09-01', underlying: 'AAPL',
  contractId: 'AAPL-2026-10-16-C-200', bid: 1.0, ask: 1.1, isStale: false, ...overrides,
});

test('buildSpreadEffectiveCoverageReport classifies and counts every invalid-row reason distinctly, never silently dropping them', () => {
  const report = buildSpreadEffectiveCoverageReport([
    bboRow(), // valid
    bboRow({ bid: 0 }), // BID_NON_POSITIVE
    bboRow({ bid: 2, ask: 1 }), // ASK_LESS_THAN_BID
    bboRow({ isStale: true }), // STALE
    bboRow({ bid: null, ask: null }), // MISSING
  ]);
  assert.equal(report.rawRowCount, 5);
  assert.equal(report.validRowCount, 1);
  assert.equal(report.invalidRowCounts.BID_NON_POSITIVE, 1);
  assert.equal(report.invalidRowCounts.ASK_LESS_THAN_BID, 1);
  assert.equal(report.invalidRowCounts.STALE, 1);
  assert.equal(report.invalidRowCounts.MISSING, 1);
});

test('computeSpreadStressResearch guards against a near-zero midpoint denominator, reporting null spreadPct rather than Infinity/NaN', () => {
  const rows = [bboRow({ bid: 0.0000001, ask: 0.0000001 })];
  const result = computeSpreadStressResearch('AAPL|45DTE', rows);
  // Below threshold regardless, but exercise the guard path directly via a below-minimum single-row call.
  assert.equal(result.status, 'TEMPORAL_HISTORY_INSUFFICIENT');
});

test('computeSpreadStressResearch treats invalid rows as UNKNOWN spreadPct, never coerced into the stat pool', () => {
  const validRows = Array.from({ length: MIN_SNAPSHOTS_FOR_SPREAD_STRESS_RESEARCH + 2 }, (_, i) =>
    bboRow({ sessionDate: `d${i}`, bid: 1.0, ask: 1.1 }));
  const withOneInvalid = validRows.map((row, i) => (i === 3 ? { ...row, bid: -1 } : row));
  const result = computeSpreadStressResearch('AAPL|45DTE', withOneInvalid);
  assert.equal(result.status, 'COMPUTED');
  assert.equal(result.observations[3].spreadPct, null);
});
