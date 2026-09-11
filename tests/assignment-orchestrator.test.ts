import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runAssignmentOrchestration, type AssignmentOrchestrationRequest } from '../src/theta/assignment-orchestrator.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';
import type { AssignmentCapacityAssessment } from '../src/theta/account-exposure.js';

// Real end-to-end integration test: spawns the ACTUAL Python
// assignment_contract.py (wrapping the already-tested
// models/assignment_model.py) through the real python-bridge.ts, so a
// pass here proves genuine IPC across the language boundary, not just
// that the TS schema or the Python function are independently correct.
// Synthetic data only; no market/broker I/O.

const CANDIDATE_PYTHON_PATHS = [
  process.env.PYTHON_EXECUTABLE_FOR_TESTS,
  'C:\\Users\\hp\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
].filter((candidate): candidate is string => candidate !== undefined);

const pythonExecutablePath = CANDIDATE_PYTHON_PATHS.find((candidate) => existsSync(candidate));

const RUNTIME_DIR = path.resolve('bots/theta/quant/runtime');

const bridge = (): PythonBridgeConfig => ({
  pythonExecutablePath: pythonExecutablePath ?? 'python',
  scriptAllowlist: new Map([
    ['assignment', path.join(RUNTIME_DIR, 'assignment_contract.py')],
  ]),
  timeoutMs: 5000,
  maxOutputBytes: 1_000_000,
});

const NOW = new Date().toISOString();
const HASH = 'b'.repeat(64);

const capacity = (overrides: Partial<AssignmentCapacityAssessment> = {}): AssignmentCapacityAssessment => ({
  currentPotentialAssignmentCapital: 5_000,
  availableAssignmentCapital: 100_000,
  assignmentCapacityUsedPct: 0.05,
  ...overrides,
});

const baseRequest = (overrides: Partial<AssignmentOrchestrationRequest> = {}): AssignmentOrchestrationRequest => ({
  snapshotId: 'snap-1', fusionSnapshotHash: HASH, timestamp: NOW, chainId: 'chain-1',
  policy: { policyVersion: 'assign-v1', ownershipAcceptabilityFloor: 0.5, tailRiskPenaltyWeight: 1.0 },
  candidate: {
    strike: 50, multiplier: 100, entryPremiumPerShare: 0.60,
    ownershipAcceptability: 0.8, pSevereDrawdown: 0.05,
    mechanicalCloseDebitPerShare: 0.90, capitalCommitted: 5_000, contracts: 1,
  },
  assignmentCapacity: capacity(),
  tickerConcentrationPct: 0.02,
  stockValueAlreadyHeldForUnderlying: 0,
  equity: 100_000,
  providerStateGood: true,
  policyVersion: 'v1', modelVersions: { assignment: 'v1' }, requiredModelVersions: { assignment: 'v1' },
  ...overrides,
});

const itRealPythonCodePath = pythonExecutablePath === undefined ? test.skip : test;

itRealPythonCodePath('ownership-acceptable, capacity-sufficient assignment is accepted end to end through the real Python bridge', async () => {
  const receipt = await runAssignmentOrchestration(bridge(), baseRequest());
  assert.equal(receipt.failClosedReason, null);
  assert.equal(receipt.recommendation, 'ACCEPT_ASSIGNMENT');
  assert.equal(receipt.assignmentFeasible, true);
  assert.equal(receipt.requiredCash, 5_000);
  assert.equal(receipt.resultingShareQuantity, 100);
  assert.equal(receipt.expectedBasisPerShare, 49.4);
});

itRealPythonCodePath('insufficient assignment capacity downgrades ACCEPT_ASSIGNMENT to UNKNOWN rather than proceeding anyway', async () => {
  const receipt = await runAssignmentOrchestration(bridge(), baseRequest({
    assignmentCapacity: capacity({ availableAssignmentCapital: 100 }),
  }));
  assert.equal(receipt.recommendation, 'UNKNOWN');
  assert.equal(receipt.assignmentFeasible, false);
  assert.equal(receipt.reasonCodes.includes('ASSIGNMENT_CAPACITY_INSUFFICIENT'), true);
});

itRealPythonCodePath('unacceptable ownership recommends CLOSE_STOCK through the real Python bridge', async () => {
  const receipt = await runAssignmentOrchestration(bridge(), baseRequest({
    candidate: { ...baseRequest().candidate, ownershipAcceptability: 0.1 },
  }));
  assert.equal(receipt.recommendation, 'CLOSE_STOCK');
  assert.equal(receipt.ownershipAcceptable, false);
});

itRealPythonCodePath('unknown assignment capacity never assumes feasibility', async () => {
  const receipt = await runAssignmentOrchestration(bridge(), baseRequest({
    assignmentCapacity: capacity({ availableAssignmentCapital: null }),
  }));
  assert.equal(receipt.assignmentFeasible, null);
  assert.equal(receipt.reasonCodes.includes('ASSIGNMENT_CAPACITY_UNKNOWN'), true);
});

test('an unknown Python model family fails closed to UNKNOWN without spawning any process', async () => {
  const badBridge: PythonBridgeConfig = { ...bridge(), scriptAllowlist: new Map() };
  const receipt = await runAssignmentOrchestration(badBridge, baseRequest());
  assert.equal(receipt.recommendation, 'UNKNOWN');
  assert.notEqual(receipt.failClosedReason, null);
  assert.equal(receipt.reasonCodes.some((code) => code.startsWith('PIPELINE_STAGE_FAILED')), true);
});

test('a snapshot-hash mismatch fails closed', async () => {
  const receipt = await runAssignmentOrchestration(
    { ...bridge(), scriptAllowlist: new Map() },
    baseRequest({ fusionSnapshotHash: 'c'.repeat(64) }),
  );
  assert.notEqual(receipt.failClosedReason, null);
});
