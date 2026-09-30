import assert from 'node:assert/strict';
import test from 'node:test';
import { buildV19EvidenceCertification, proveDecisionDataRoute, v19RequiredEvidenceFiles,
  v19RequiredTestFiles } from '../src/operations/v19-evidence-certification.js';
import { decisionDataRoutes } from '../src/operations/v18-final-acceptance.js';

const sourceSha = 'f'.repeat(40);
const passingInput = () => ({ sourceSha, sourceClean: true, runtimeReceiptHash: 'a'.repeat(64), runtimeAlignmentState: 'ALIGNED' as const,
  fileAuditFailures: [] as string[], testResults: Object.fromEntries(v19RequiredTestFiles.map((file) => [file, true])),
  unknownAuditPass: true, regressionAuditPass: true });

test('declared routes cannot certify dynamic producers or consumers through a synthetic marker round-trip', () => {
  const proofs = decisionDataRoutes.map((item) => proveDecisionDataRoute(item.feature, sourceSha));
  assert.equal(proofs.length, 21);
  assert.ok(proofs.every((item) => item.state === 'NOT_PROVEN' && item.runtimeProven === false));
  assert.ok(proofs.every(item => !Object.hasOwn(item, 'markerHash')));
});

test('legacy file booleans and declared matrix states cannot self-certify V19', () => {
  const receipt = buildV19EvidenceCertification(passingInput());
  assert.equal(receipt.MATRIX_CELLS_TOTAL, 105);
  assert.equal(receipt.MATRIX_CELLS_WITHOUT_EVIDENCE, 105);
  const cells = Object.values(receipt.strategyMatrix).flatMap((row) => Object.values(row));
  assert.ok(cells.every((cell) => cell.dimensionTestIds.length > 0));
  assert.ok(cells.every((cell) => cell.dimensionTestIds.every((file) => cell.testIds.includes(file))));
  assert.equal(receipt.DATA_ROUTES_WITHOUT_DYNAMIC_PROOF, 21);
  assert.equal(receipt.AEGIS_UNPROVEN_SCENARIOS, receipt.AEGIS_SCENARIOS_TOTAL);
  assert.equal(receipt.SIZING_UNPROVEN_SCENARIOS, receipt.SIZING_SCENARIOS_TOTAL);
  assert.equal(receipt.MANAGEMENT_UNPROVEN_SCENARIOS, receipt.MANAGEMENT_SCENARIOS_TOTAL);
  assert.equal(receipt.WHOLE_CHAIN_UNPROVEN_SCENARIOS, receipt.WHOLE_CHAIN_SCENARIOS_TOTAL);
  assert.deepEqual(receipt.CODE_SOLVABLE, []);
  assert.equal(receipt.FINAL_CERTIFICATION, 'NOT_PROVEN');
  assert.equal(receipt.GENERIC_WAIT, null);
  assert.equal(receipt.GENERIC_DECISION_UNKNOWN, null);
  assert.ok(cells.every(cell => cell.state === 'DECLARED_NOT_PROVEN' && !cell.runtimeProven));
  assert.equal(receipt.PROFITABILITY_WINNER, null);
  assert.equal(receipt.SHADOW_COMPARATOR_BROKER_AUTHORITY, false);
});

test('a failed test, missing call-path file, unknown audit, or unexplained stale worker becomes an exact code-solvable blocker', () => {
  const failedTest = v19RequiredTestFiles[0]; assert.ok(failedTest);
  const missingFile = v19RequiredEvidenceFiles.find((file) => file.startsWith('src/')); assert.ok(missingFile);
  const input = passingInput();
  const receipt = buildV19EvidenceCertification({ ...input, runtimeAlignmentState: 'MISALIGNED',
    unknownAuditPass: false, fileAuditFailures: [missingFile],
    testResults: { ...input.testResults, [failedTest]: false } });
  assert.equal(receipt.FINAL_CERTIFICATION, 'FAIL');
  assert.ok(receipt.CODE_SOLVABLE.some((item) => item === `SOURCE_OR_CALL_PATH_MISSING:${missingFile}`));
  assert.ok(receipt.CODE_SOLVABLE.some((item) => item === `REGRESSION:${failedTest}`));
  assert.ok(receipt.CODE_SOLVABLE.includes('UNKNOWN_AUDIT_FAILED'));
  assert.ok(receipt.CODE_SOLVABLE.includes('CURRENT_WORKER_RUNTIME_ROUTE_NOT_ALIGNED'));
});

test('a locked worker intentionally offline behind governed runtime admission is external, not code-solvable', () => {
  const receipt = buildV19EvidenceCertification({ ...passingInput(), runtimeAlignmentState: 'EXTERNAL_BLOCKED' });
  assert.deepEqual(receipt.CODE_SOLVABLE, []);
  assert.deepEqual(receipt.EXTERNAL_RUNTIME_BLOCKERS,
    ['CURRENT_WORKER_LOCKED_OFFLINE_AWAITING_GOVERNED_RUNTIME_ADMISSION']);
  assert.equal(receipt.FINAL_CERTIFICATION, 'NOT_PROVEN');
});

test('scenario evidence requires a uniquely executed passing case and cannot inherit skipped or failed companions', () => {
  const event = { file: 'tests/aegis-alpaca-iv-stress.test.ts',
    name: 'twenty independent same-cohort sessions support the detector', state: 'PASS' as const };
  const state = (events: Parameters<typeof buildV19EvidenceCertification>[0]['executedTests']) =>
    buildV19EvidenceCertification({ ...passingInput(), executedTests: events }).scenarioResults
      .find(row => row.id === 'IV_STRESS');
  assert.equal(state([event])?.state, 'PASS');
  assert.equal(state([event])?.runtimeProven, false);
  assert.equal(state([{ ...event, state: 'SKIPPED' }])?.state, 'NOT_PROVEN');
  assert.equal(state([{ ...event, state: 'TODO' }])?.state, 'NOT_PROVEN');
  assert.equal(state([event, { ...event, name: `${event.name} duplicate` }])?.state, 'NOT_PROVEN');
  assert.equal(state([event, { ...event, name: 'companion', state: 'FAIL' }])?.state, 'FAIL');
  assert.equal(state([{ ...event, file: 'tests/another.test.ts' }])?.state, 'NOT_PROVEN');
});

test('provider limits are separated by Paper criticality', () => {
  const receipt = buildV19EvidenceCertification(passingInput());
  assert.equal(receipt.PAPER_CRITICAL_PROVIDER_LIMITATION_COUNT, 2);
  assert.deepEqual(receipt.OPTIONAL_RESEARCH_PROVIDER_LIMITATIONS.toSorted(),
    ['FUNDAMENTAL_QUALITY', 'SECTOR', 'UNUSUAL_ACTIVITY']);
  assert.equal(receipt.OPTIONAL_RESEARCH_PROVIDER_LIMITATION_COUNT, 3);
});
