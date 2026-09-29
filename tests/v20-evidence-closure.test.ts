import assert from 'node:assert/strict';
import test from 'node:test';
import { buildV20EvidenceClosure, criticalDimensionProbeSpecs, crossStrategyProbeSpecs,
  realDataRouteProbeSpecs, strategyCapabilityProbeIds, strategyIdentityProbeSpecs,
  selectSuccessfulExactCiRun, v18CoverageProbeSpecs,
  type ExecutedNamedTest } from '../src/operations/v20-evidence-closure.js';
import { v19ScenarioEvidence } from '../src/operations/v19-evidence-certification.js';

const key = (file: string, id: string) => `${file}#${id}`;
const allSpecs = [...realDataRouteProbeSpecs, ...crossStrategyProbeSpecs, ...v18CoverageProbeSpecs,
  ...v19ScenarioEvidence.map((item) => ({ ...item, sourceFile: item.testFile })),
  ...Object.values(strategyIdentityProbeSpecs), ...Object.values(criticalDimensionProbeSpecs)];
const passingTests = Object.fromEntries(allSpecs.map((item) => [key(item.testFile, item.testId), {
  testFile: item.testFile, testId: item.testId, exists: true, executed: true, passed: true, skipped: false,
} satisfies ExecutedNamedTest]));
const passingInput = () => ({ sourceSha: 'a'.repeat(40), workerSha: 'a'.repeat(40), exactCi: '123', sourceClean: true,
  namedTests: passingTests, v19MatrixProbePass: Object.fromEntries(strategyCapabilityProbeIds.map((id) => [id, true])),
  genericEngineeringUnknown: 0, genericDecisionUnknown: 0, genericWait: 0,
  runtimeAligned: true, liveValuesCurrent: false, ownerPaperAuthorized: false });

test('V20 coverage is derived from executed named evidence and leaves no code-solvable blocker', () => {
  const receipt = buildV20EvidenceClosure(passingInput());
  assert.equal(receipt.SELF_DECLARED_TRUTH_FIELDS, 0);
  assert.equal(receipt.SYNTHETIC_ONLY_ROUTE_PROOFS, 0);
  assert.equal(receipt.REAL_DATA_ROUTES_PASS, 21);
  assert.equal(receipt.STRATEGY_CAPABILITY_PROBES_PASS, 65);
  assert.equal(receipt.CROSS_STRATEGY_PROBES_PASS, 11);
  assert.ok(receipt.coverageMap.every((item) => item.STATE === 'PASS' && item.TEST_OR_RUNTIME_PROOF?.executed));
  assert.deepEqual(receipt.CODE_SOLVABLE, []);
  assert.equal(receipt.V20_FINAL_EVIDENCE_CERTIFICATION, 'PASS');
  assert.equal(receipt.READY_FOR_FIRST_PAPER, 'NO');
});

test('missing, skipped, failed, synthetic-only, or generic evidence becomes a precise blocker', () => {
  const input = passingInput();
  const route = realDataRouteProbeSpecs[0]; assert.ok(route);
  const namedTests = { ...input.namedTests, [key(route.testFile, route.testId)]: {
    testFile: route.testFile, testId: route.testId, exists: true, executed: false, passed: false, skipped: true,
  } };
  const receipt = buildV20EvidenceClosure({ ...input, namedTests, genericWait: 1 });
  assert.ok(receipt.CODE_SOLVABLE.includes(`REAL_DATA_ROUTE_UNPROVEN:${route.id}`));
  assert.ok(receipt.CODE_SOLVABLE.includes('GENERIC_WAIT:1'));
  assert.ok(receipt.SYNTHETIC_ONLY_ROUTE_PROOFS >= 1);
  assert.equal(receipt.V20_FINAL_EVIDENCE_CERTIFICATION, 'FAIL');
});

test('Paper-critical provider limits remain separate and prevent first-Paper readiness', () => {
  const receipt = buildV20EvidenceClosure({ ...passingInput(), liveValuesCurrent: true, ownerPaperAuthorized: true });
  assert.ok(receipt.PROVIDER_LIMITED.PAPER_CRITICAL.length > 0);
  assert.equal(receipt.PAPER_CRITICAL_PROVIDER_READINESS, 'PROVIDER_LIMITED');
  assert.equal(receipt.READY_FOR_FIRST_PAPER, 'NO');
});

test('exact CI evidence selects only a completed successful run for the exact source SHA', () => {
  assert.equal(selectSuccessfulExactCiRun([
    { databaseId: 10, status: 'completed', conclusion: 'success', headSha: 'other' },
    { databaseId: 11, status: 'in_progress', conclusion: '', headSha: 'target' },
    { databaseId: 12, status: 'completed', conclusion: 'failure', headSha: 'target' },
    { databaseId: 13, status: 'completed', conclusion: 'success', headSha: 'target' },
  ], 'target'), '13');
});

test('exact CI evidence remains unverified when no exact successful run exists', () => {
  assert.equal(selectSuccessfulExactCiRun([
    { databaseId: 10, status: 'completed', conclusion: 'success', headSha: 'other' },
  ], 'target'), null);
});
