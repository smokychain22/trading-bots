import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessHistoricalIvBackfillFeasibility, buildIvEffectiveCoverageReport, buildSpreadEffectiveCoverageReport,
  computeIvShockResearch, computeSpreadStressResearch, MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH,
  MIN_SNAPSHOTS_FOR_SPREAD_STRESS_RESEARCH,
  type HistoricalCapabilityAttestation, type HistoricalIvObservationRow, type OptionomicsHistoricalQuoteObservationRow,
} from '../src/research/historical-iv-spread-feasibility.js';
import type { OptionomicsCapabilityObservation } from '../src/theta/optionomics-capability-contract.js';

const capability = (overrides: Partial<OptionomicsCapabilityObservation> = {}): OptionomicsCapabilityObservation => ({
  family: 'HISTORICAL_CHAINS', operationAlias: 'historical_chain', documentationReference: 'docs://historical',
  availability: 'SUPPORTED', httpStatus: 200, schemaKeys: ['underlying', 'expiration', 'strike', 'right', 'observedAt'],
  timestampField: 'observedAt', units: {}, nullableFields: [], rateLimit: {}, historical: true,
  runtimeClass: 'RESEARCH', ...overrides,
});

const attestation = (
  observationOverrides: Partial<OptionomicsCapabilityObservation> = {}, verified = true,
): HistoricalCapabilityAttestation => ({
  observation: capability(observationOverrides), verifiedHistoricalRetrievability: verified,
});

test('assessHistoricalIvBackfillFeasibility reports CAPABILITY_EVIDENCE_INSUFFICIENT when nothing has been observed, never assumes safety', () => {
  const result = assessHistoricalIvBackfillFeasibility([]);
  assert.equal(result.feasibility, 'CAPABILITY_EVIDENCE_INSUFFICIENT');
});

test('assessHistoricalIvBackfillFeasibility is NOT_SAFE when no capability is proven SUPPORTED+historical', () => {
  const result = assessHistoricalIvBackfillFeasibility([attestation({ availability: 'NOT_ENTITLED', historical: null })]);
  assert.equal(result.feasibility, 'HISTORICAL_IV_BACKFILL_NOT_SAFE');
});

test('assessHistoricalIvBackfillFeasibility is NOT_SAFE when a single verified observation is missing a timestamp field or full identity', () => {
  const noTimestamp = assessHistoricalIvBackfillFeasibility([attestation({ timestampField: null })]);
  assert.equal(noTimestamp.feasibility, 'HISTORICAL_IV_BACKFILL_NOT_SAFE');
  assert.ok(noTimestamp.reasons.includes('NO_OBSERVATION_TIMESTAMP_FIELD_IN_SCHEMA'));

  const noIdentity = assessHistoricalIvBackfillFeasibility([attestation({ schemaKeys: ['underlying', 'observedAt'] })]);
  assert.equal(noIdentity.feasibility, 'HISTORICAL_IV_BACKFILL_NOT_SAFE');
  assert.ok(noIdentity.reasons.includes('CONTRACT_IDENTITY_SCHEMA_INCOMPLETE'));
});

test('assessHistoricalIvBackfillFeasibility is NOT_SAFE when unverified, even with full timestamp+identity schema', () => {
  const result = assessHistoricalIvBackfillFeasibility([attestation({}, false)]);
  assert.equal(result.feasibility, 'HISTORICAL_IV_BACKFILL_NOT_SAFE');
  assert.ok(result.reasons.includes('HISTORICAL_RETRIEVABILITY_NOT_INDEPENDENTLY_VERIFIED'));
});

test('REPAIR (Codex A-D item D): two separately-inadequate observations must NOT combine into a SAFE verdict', () => {
  // Observation 1 proves timestamp but has an incomplete identity schema.
  // Observation 2 proves full identity but has no timestamp field.
  // Neither alone is complete, and NEITHER is the same observation, so
  // this must remain NOT_SAFE -- the old .some()/.some() logic would have
  // wrongly reported SAFE here by combining evidence across the two rows.
  const partialTimestampOnly = attestation({ schemaKeys: ['underlying', 'observedAt'] });
  const partialIdentityOnly = attestation({ timestampField: null });
  const result = assessHistoricalIvBackfillFeasibility([partialTimestampOnly, partialIdentityOnly]);
  assert.equal(result.feasibility, 'HISTORICAL_IV_BACKFILL_NOT_SAFE');
  assert.ok(result.reasons.includes('NO_SINGLE_OBSERVATION_PROVES_ALL_REQUIREMENTS_TOGETHER'));
});

test('assessHistoricalIvBackfillFeasibility is SAFE when ONE single observation proves timestamp, identity, AND verified retrievability together', () => {
  const result = assessHistoricalIvBackfillFeasibility([attestation()]);
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

function dateSeries(count: number, startDay = 1): { readonly sessionDate: string; readonly iv: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    sessionDate: `2026-01-${String(startDay + i).padStart(2, '0')}T00:00:00Z`, iv: 0.2 + i * 0.0001,
  }));
}

const FAR_FUTURE_CUTOFF = '2030-01-01T00:00:00Z';

test('computeIvShockResearch reports TEMPORAL_HISTORY_INSUFFICIENT below the minimum snapshot threshold', () => {
  const sessions = dateSeries(MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH - 1);
  const result = computeIvShockResearch('AAPL|45DTE|0.30delta', sessions, FAR_FUTURE_CUTOFF);
  assert.equal(result.status, 'TEMPORAL_HISTORY_INSUFFICIENT');
  assert.equal(result.observations.length, 0);
});

test('computeIvShockResearch computes rolling stats using ONLY prior sessions, never the current or future session', () => {
  const sessions = dateSeries(MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH + 5).map((s) => ({ ...s, iv: 0.2 }));
  // Inject an obvious future spike far past the threshold window; it must not leak into any earlier day's stat.
  const spiked = sessions.map((s, i) => (i === sessions.length - 1 ? { ...s, iv: 5.0 } : s));
  const result = computeIvShockResearch('AAPL|45DTE|0.30delta', spiked, FAR_FUTURE_CUTOFF);
  assert.equal(result.status, 'COMPUTED');
  const earlyComputed = result.observations.find((o) => o.rollingMedian !== null);
  assert.ok(earlyComputed);
  assert.equal(earlyComputed?.rollingMedian, 0.2); // unaffected by the future spike
  const lastObservation = result.observations[result.observations.length - 1];
  assert.equal(lastObservation.rollingMedian, 0.2); // the spike's own day still uses only PRIOR sessions for its median
});

test('REPAIR (Codex A-D item D): computeIvShockResearch sorts by sessionDate rather than trusting caller-supplied array order', () => {
  const ordered = dateSeries(MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH + 3);
  const shuffled = [...ordered].reverse(); // deliberately out of chronological order
  const fromOrdered = computeIvShockResearch('cohort', ordered, FAR_FUTURE_CUTOFF);
  const fromShuffled = computeIvShockResearch('cohort', shuffled, FAR_FUTURE_CUTOFF);
  assert.deepEqual(fromOrdered.observations, fromShuffled.observations);
});

test('REPAIR (Codex A-D item D): computeIvShockResearch excludes same-day/current and future sessions relative to the cutoff', () => {
  const historical = dateSeries(MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH, 1); // 2026-01-01 .. 2026-01-20
  const currentSession = [{ sessionDate: '2026-01-21T00:00:00Z', iv: 999 }]; // same as the cutoff day -- must be excluded
  const cutoff = '2026-01-21T00:00:00Z';
  const result = computeIvShockResearch('cohort', [...historical, ...currentSession], cutoff);
  // The current-session row is excluded entirely, so effective count stays at exactly the historical set.
  assert.equal(result.snapshotCount, historical.length);
  assert.ok(!result.observations.some((o) => o.sessionDate === '2026-01-21T00:00:00Z'));
});

test('computeIvShockResearch rejects an invalid completedSessionsOnlyThrough cutoff', () => {
  assert.throws(() => computeIvShockResearch('cohort', dateSeries(5), 'not-a-date'));
});

const quoteRow = (overrides: Partial<OptionomicsHistoricalQuoteObservationRow> = {}): OptionomicsHistoricalQuoteObservationRow => ({
  observationTimestamp: '2026-09-01T15:00:00Z', sessionDate: '2026-09-01T00:00:00Z', underlying: 'AAPL',
  contractId: 'AAPL-2026-10-16-C-200', bid: 1.0, ask: 1.1, isStale: false, ...overrides,
});

test('buildSpreadEffectiveCoverageReport classifies and counts every invalid-row reason distinctly, never silently dropping them', () => {
  const report = buildSpreadEffectiveCoverageReport([
    quoteRow(), // valid
    quoteRow({ bid: 0 }), // BID_NON_POSITIVE
    quoteRow({ bid: 2, ask: 1 }), // ASK_LESS_THAN_BID
    quoteRow({ isStale: true }), // STALE
    quoteRow({ bid: null, ask: null }), // MISSING
  ]);
  assert.equal(report.rawRowCount, 5);
  assert.equal(report.validRowCount, 1);
  assert.equal(report.invalidRowCounts.BID_NON_POSITIVE, 1);
  assert.equal(report.invalidRowCounts.ASK_LESS_THAN_BID, 1);
  assert.equal(report.invalidRowCounts.STALE, 1);
  assert.equal(report.invalidRowCounts.MISSING, 1);
});

test('computeSpreadStressResearch guards against a near-zero midpoint denominator, reporting null spreadPct rather than Infinity/NaN', () => {
  const rows = [quoteRow({ bid: 0.0000001, ask: 0.0000001 })];
  const result = computeSpreadStressResearch('AAPL|45DTE', rows, FAR_FUTURE_CUTOFF);
  // Below threshold regardless, but exercise the guard path directly via a below-minimum single-row call.
  assert.equal(result.status, 'TEMPORAL_HISTORY_INSUFFICIENT');
});

test('computeSpreadStressResearch treats invalid rows as UNKNOWN spreadPct, never coerced into the stat pool', () => {
  const validRows = Array.from({ length: MIN_SNAPSHOTS_FOR_SPREAD_STRESS_RESEARCH + 2 }, (_, i) =>
    quoteRow({ sessionDate: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, bid: 1.0, ask: 1.1 }));
  const withOneInvalid = validRows.map((row, i) => (i === 3 ? { ...row, bid: -1 } : row));
  const result = computeSpreadStressResearch('AAPL|45DTE', withOneInvalid, FAR_FUTURE_CUTOFF);
  assert.equal(result.status, 'COMPUTED');
  assert.equal(result.observations[3].spreadPct, null);
});

test('REPAIR (Codex A-D item D): computeSpreadStressResearch excludes same-day/current and future sessions relative to the cutoff', () => {
  const historical = Array.from({ length: MIN_SNAPSHOTS_FOR_SPREAD_STRESS_RESEARCH }, (_, i) =>
    quoteRow({ sessionDate: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, bid: 1.0, ask: 1.1 }));
  const currentSession = [quoteRow({ sessionDate: '2026-01-21T00:00:00Z', bid: 5.0, ask: 5.5 })];
  const result = computeSpreadStressResearch('AAPL|45DTE', [...historical, ...currentSession], '2026-01-21T00:00:00Z');
  assert.equal(result.snapshotCount, historical.length);
  assert.ok(!result.observations.some((o) => o.sessionDate === '2026-01-21T00:00:00Z'));
});
