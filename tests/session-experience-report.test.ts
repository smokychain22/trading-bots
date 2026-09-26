import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmptySessionExperienceReport, buildSessionExperienceReport } from '../src/research/session-experience-report.js';

test('CORE CLAIM: an empty session honestly reports zero counts, not fabricated activity', () => {
  const report = buildEmptySessionExperienceReport('2026-09-26', '2026-09-26T23:00:00Z');
  assert.equal(report.counts.newQSubjects, 0);
  assert.equal(report.counts.waitCount, 0);
  assert.equal(Object.keys(report.counts.flowCohortCounts).length, 0);
});

test('the report never claims profitability, structurally', () => {
  const report = buildEmptySessionExperienceReport('2026-09-26', '2026-09-26T23:00:00Z');
  assert.equal(report.profitabilityClaimed, false);
});

test('real counts are honored when supplied', () => {
  const report = buildSessionExperienceReport({
    sessionDate: '2026-09-26', generatedAt: '2026-09-26T23:00:00Z',
    counts: { newQSubjects: 12, waitCount: 40, assignmentEvents: 1 },
  });
  assert.equal(report.counts.newQSubjects, 12);
  assert.equal(report.counts.waitCount, 40);
  assert.equal(report.counts.newHSubjects, 0);
});
