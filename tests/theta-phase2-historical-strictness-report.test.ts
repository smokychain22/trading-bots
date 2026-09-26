import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHistoricalSessionReport, buildAllHistoricalSessionReports } from '../tools/theta-phase2-historical-strictness-report.js';

test('CORE CLAIM: real Sep 16 counts produce a fully-classified, 100% hard-reject report (139 CONTRACT_NOT_EXECUTABLE = 139 total candidates)', () => {
  const report = buildHistoricalSessionReport({
    session: '2026-09-16', totalCandidates: 139, historicallyExecutable: 0, positiveQuantity: 0, contractNotExecutable: 139,
  });
  assert.equal(report.classifiedPopulationReport.totalCandidates, 139);
  assert.equal(report.classifiedPopulationReport.hardRejectRate, 1);
  assert.equal(report.executableZeroQtyUnclassifiableCount, 0);
});

test('CORE CLAIM: Sep 18 real counts -- 765 executable-but-zero-qty candidates are NOT forced through the taxonomy', () => {
  const report = buildHistoricalSessionReport({
    session: '2026-09-18', totalCandidates: 4590, historicallyExecutable: 765, positiveQuantity: 0, contractNotExecutable: 3825,
  });
  assert.equal(report.executableZeroQtyUnclassifiableCount, 765);
  assert.equal(report.executableZeroQtyCauseKnown, false);
  assert.equal(report.aegisStateKnown, false);
  // the classified population is ONLY the 3825 CONTRACT_NOT_EXECUTABLE rows,
  // never the full 4590 -- the 765 unclassifiable rows must never silently
  // enter this report as any real taxonomy cause
  assert.equal(report.classifiedPopulationReport.totalCandidates, 3825);
});

test('ADVERSARIAL: terminal cause for the unclassifiable cohort is always reported as a conclusion, never a fact', () => {
  const report = buildHistoricalSessionReport({
    session: 'x', totalCandidates: 1, historicallyExecutable: 1, positiveQuantity: 0, contractNotExecutable: 0,
  });
  assert.equal(report.terminalCauseEvidenceClass, 'SOURCE_DERIVED_CONCLUSION_NOT_FACT');
});

test('all three real historical sessions produce a report with no fabricated qty/AEGIS/sizing knowledge', () => {
  const reports = buildAllHistoricalSessionReports();
  assert.equal(reports.length, 3);
  for (const report of reports) {
    assert.equal(report.aegisStateKnown, false);
    assert.equal(report.ownershipStateKnown, false);
    assert.equal(report.sizingStateKnown, false);
  }
});
