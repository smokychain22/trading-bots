import assert from 'node:assert/strict';
import test from 'node:test';
import { buildV19EvidenceCertification, proveDecisionDataRoute, v19RequiredEvidenceFiles,
  v19RequiredTestFiles } from '../src/operations/v19-evidence-certification.js';
import { decisionDataRoutes } from '../src/operations/v18-final-acceptance.js';

const sourceSha = 'f'.repeat(40);
const passingInput = () => ({ sourceSha, sourceClean: true, runtimeReceiptHash: 'a'.repeat(64), runtimeAligned: true,
  fileAuditFailures: [] as string[], testResults: Object.fromEntries(v19RequiredTestFiles.map((file) => [file, true])),
  unknownAuditPass: true, regressionAuditPass: true });

test('all decision routes carry a unique value through producer, normalizer, orchestrator, and intended consumer', () => {
  const proofs = decisionDataRoutes.map((item) => proveDecisionDataRoute(item.feature, sourceSha));
  assert.equal(proofs.length, 21);
  assert.ok(proofs.every((item) => item.state === 'PASS' && item.unrelatedConsumerRejected));
  assert.equal(new Set(proofs.map((item) => item.markerHash)).size, proofs.length);
});

test('V19 certification is derived from executed evidence with no uncovered matrix cell or scenario', () => {
  const receipt = buildV19EvidenceCertification(passingInput());
  assert.equal(receipt.MATRIX_CELLS_TOTAL, 105);
  assert.equal(receipt.MATRIX_CELLS_WITHOUT_EVIDENCE, 0);
  const cells = Object.values(receipt.strategyMatrix).flatMap((row) => Object.values(row));
  assert.ok(cells.every((cell) => cell.dimensionTestIds.length > 0));
  assert.ok(cells.every((cell) => cell.dimensionTestIds.every((file) => cell.testIds.includes(file))));
  assert.equal(receipt.DATA_ROUTES_WITHOUT_DYNAMIC_PROOF, 0);
  assert.equal(receipt.AEGIS_UNPROVEN_SCENARIOS, 0);
  assert.equal(receipt.SIZING_UNPROVEN_SCENARIOS, 0);
  assert.equal(receipt.MANAGEMENT_UNPROVEN_SCENARIOS, 0);
  assert.equal(receipt.WHOLE_CHAIN_UNPROVEN_SCENARIOS, 0);
  assert.deepEqual(receipt.CODE_SOLVABLE, []);
  assert.equal(receipt.FINAL_CERTIFICATION, 'PASS');
  assert.equal(receipt.PROFITABILITY_WINNER, null);
  assert.equal(receipt.SHADOW_COMPARATOR_BROKER_AUTHORITY, false);
});

test('a failed test, missing call-path file, unknown audit, or stale worker becomes an exact code-solvable blocker', () => {
  const failedTest = v19RequiredTestFiles[0]; assert.ok(failedTest);
  const missingFile = v19RequiredEvidenceFiles.find((file) => file.startsWith('src/')); assert.ok(missingFile);
  const input = passingInput();
  const receipt = buildV19EvidenceCertification({ ...input, runtimeAligned: false,
    unknownAuditPass: false, fileAuditFailures: [missingFile],
    testResults: { ...input.testResults, [failedTest]: false } });
  assert.equal(receipt.FINAL_CERTIFICATION, 'FAIL');
  assert.ok(receipt.CODE_SOLVABLE.some((item) => item === `SOURCE_OR_CALL_PATH_MISSING:${missingFile}`));
  assert.ok(receipt.CODE_SOLVABLE.some((item) => item === `REGRESSION:${failedTest}`));
  assert.ok(receipt.CODE_SOLVABLE.includes('UNKNOWN_AUDIT_FAILED'));
  assert.ok(receipt.CODE_SOLVABLE.includes('CURRENT_WORKER_RUNTIME_ROUTE_NOT_ALIGNED'));
});

test('provider limits are separated by Paper criticality', () => {
  const receipt = buildV19EvidenceCertification(passingInput());
  assert.equal(receipt.PAPER_CRITICAL_PROVIDER_LIMITATION_COUNT, 2);
  assert.deepEqual(receipt.OPTIONAL_RESEARCH_PROVIDER_LIMITATIONS.toSorted(),
    ['FUNDAMENTAL_QUALITY', 'MOMENTUM', 'SECTOR', 'UNUSUAL_ACTIVITY']);
  assert.equal(receipt.OPTIONAL_RESEARCH_PROVIDER_LIMITATION_COUNT, 4);
});
