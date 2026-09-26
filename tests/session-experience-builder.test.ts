import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionExperienceFromEvidence, type CycleEvidenceRecord } from '../src/research/session-experience-builder.js';

function cycle(overrides: Partial<CycleEvidenceRecord> = {}): CycleEvidenceRecord {
  return {
    cycleId: 'c1', observedAt: '2026-09-26T14:00:00Z',
    subjectsBySubjectKind: { CONTRACT: 3, Q: 3, H: 0, D: 0, RECOVERY_CC: 0 },
    wasWait: true, futureObservationRecorded: false, outcomeMatured: false, outcomePending: true,
    observationMissed: false, providerFailed: false, identifiable: true, flowCohort: 'FLOW_NEUTRAL',
    wasAssignmentEvent: false, wasRecoveryEvent: false, strategyComparisonPerformed: false, newCalibrationSample: false,
    unresolvedFields: [], ...overrides,
  };
}

test('zero cycles produces the honest empty-state report, real zero counts', () => {
  const result = buildSessionExperienceFromEvidence({ sessionDate: '2026-09-26', generatedAt: '2026-09-26T20:00:00Z', records: [] });
  assert.equal(result.cyclesProcessed, 0);
  assert.equal(result.report.counts.newQSubjects, 0);
  assert.equal(result.report.profitabilityClaimed, false);
});

test('real cycle evidence sums into real counts', () => {
  const result = buildSessionExperienceFromEvidence({
    sessionDate: '2026-09-26', generatedAt: '2026-09-26T20:00:00Z',
    records: [cycle(), cycle({ cycleId: 'c2', wasWait: false, subjectsBySubjectKind: { CONTRACT: 2, Q: 0, H: 2, D: 0, RECOVERY_CC: 0 } })],
  });
  assert.equal(result.report.counts.newContractSubjects, 5);
  assert.equal(result.report.counts.newQSubjects, 3);
  assert.equal(result.report.counts.newHSubjects, 2);
  assert.equal(result.report.counts.waitCount, 1);
});

test('CORE CLAIM: an unresolved field is classified with a real reason, distinct from a measured zero', () => {
  const result = buildSessionExperienceFromEvidence({
    sessionDate: '2026-09-26', generatedAt: '2026-09-26T20:00:00Z',
    records: [cycle({ unresolvedFields: [{ field: 'impliedVolatility', reason: 'PROVIDER_FIELD_ABSENT' }] })],
  });
  assert.equal(result.dataQuality.length, 1);
  assert.equal(result.dataQuality[0]?.avoidability, 'EXTERNAL');
});

test('flow cohort counts are tallied per real cohort string', () => {
  const result = buildSessionExperienceFromEvidence({
    sessionDate: '2026-09-26', generatedAt: '2026-09-26T20:00:00Z',
    records: [cycle({ flowCohort: 'FLOW_STRONG' }), cycle({ cycleId: 'c2', flowCohort: 'FLOW_STRONG' }), cycle({ cycleId: 'c3', flowCohort: null })],
  });
  assert.equal(result.report.counts.flowCohortCounts.FLOW_STRONG, 2);
});
