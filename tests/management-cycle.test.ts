import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runThetaManagementCycle, routeForLifecycleState, type ManagementCycleCandidate } from '../src/theta/management-cycle.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';
import type { ManagementOrchestrationRequest } from '../src/theta/management-orchestrator.js';
import type { AssignmentOrchestrationRequest } from '../src/theta/assignment-orchestrator.js';
import type { RecoveryOrchestrationRequest } from '../src/theta/recovery-orchestrator.js';
import type { AegisAssessmentResponse } from '../src/theta/aegis-contract.js';

const CANDIDATE_PYTHON_PATHS = [
  process.env.PYTHON_EXECUTABLE_FOR_TESTS,
  'C:\\Users\\hp\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
].filter((candidate): candidate is string => candidate !== undefined);

const pythonExecutablePath = CANDIDATE_PYTHON_PATHS.find((candidate) => existsSync(candidate));
const RUNTIME_DIR = path.resolve('bots/theta/quant/runtime');

const bridge = (): PythonBridgeConfig => ({
  pythonExecutablePath: pythonExecutablePath ?? 'python',
  scriptAllowlist: new Map([
    ['management', path.join(RUNTIME_DIR, 'management_contract.py')],
    ['assignment', path.join(RUNTIME_DIR, 'assignment_contract.py')],
    ['recovery', path.join(RUNTIME_DIR, 'recovery_contract.py')],
    ['coveredCall', path.join(RUNTIME_DIR, 'covered_call_contract.py')],
  ]),
  timeoutMs: 5000,
  maxOutputBytes: 1_000_000,
});

const NOW = new Date().toISOString();
const HASH = 'a'.repeat(64);

const aegis = (): AegisAssessmentResponse => ({
  contractVersion: 'theta-aegis-runtime-v1', decisionId: 'd1', snapshotId: 's1', timestamp: NOW, policyVersion: 'v1',
  families: [{ family: 'PER_TRADE', state: 'ALLOW_FULL', reasons: [] }], newRiskState: 'ALLOW_FULL', reasons: [],
  permittedActions: ['CLOSE', 'CANCEL', 'BUY_TO_CLOSE', 'RECONCILE', 'REDUCE_POSITION', 'SAFETY_EXIT'],
});

const cspRequest = (chainId: string): ManagementOrchestrationRequest => ({
  snapshotId: 'snap-1', fusionSnapshotHash: HASH, timestamp: NOW, chainId,
  policy: { policyVersion: 'mgmt-v1', executionCostPerContract: 0.65, capitalDaysPenaltyRate: 0.0001, tailRiskPenaltyWeight: 0.02 },
  context: {
    asOf: NOW,
    openOptionLeg: { entryCreditPerShare: 4.5, currentBidPerShare: 1.0, currentAskPerShare: 1.2, strike: 500, multiplier: 100, dte: 10 },
    rollCandidate: null, assignAlternative: null, redeployAlternative: null,
    capitalCommitted: 50_000, holdForwardValue: null, pSevereDrawdown: 0.05, atExpirationOtm: false,
  },
  aegis: aegis(), executionQuality: null,
  policyVersion: 'v1', modelVersions: { management: 'v1' }, requiredModelVersions: { management: 'v1' },
  providerStateGood: true,
});

const assignmentRequest = (chainId: string): AssignmentOrchestrationRequest => ({
  snapshotId: 'snap-1', fusionSnapshotHash: HASH, timestamp: NOW, chainId,
  policy: { policyVersion: 'assign-v1', ownershipAcceptabilityFloor: 0.5, tailRiskPenaltyWeight: 1.0 },
  candidate: {
    strike: 50, multiplier: 100, entryPremiumPerShare: 0.60,
    ownershipAcceptability: 0.8, pSevereDrawdown: 0.05,
    mechanicalCloseDebitPerShare: 0.90, capitalCommitted: 5_000, contracts: 1,
  },
  assignmentCapacity: { currentPotentialAssignmentCapital: 5_000, availableAssignmentCapital: 100_000, assignmentCapacityUsedPct: 0.05 },
  tickerConcentrationPct: 0.02, stockValueAlreadyHeldForUnderlying: 0, equity: 100_000,
  providerStateGood: true, policyVersion: 'v1', modelVersions: { assignment: 'v1' }, requiredModelVersions: { assignment: 'v1' },
});

const recoveryRequest = (chainId: string): RecoveryOrchestrationRequest => ({
  snapshotId: 'snap-1', fusionSnapshotHash: HASH, timestamp: NOW, chainId,
  policy: { policyVersion: 'recovery-v1', maxWaitDays: 20 },
  candidate: { daysInRecovery: 5, thesisInvalidated: false, coveredCallPolicy: null, coveredCallCandidates: [], stock: null },
});

const coveredCallManagementRequest = (chainId: string): ManagementOrchestrationRequest => ({
  snapshotId: 'snap-1', fusionSnapshotHash: HASH, timestamp: NOW, chainId,
  policy: { policyVersion: 'mgmt-v1', executionCostPerContract: 0.65, capitalDaysPenaltyRate: 0.0001, tailRiskPenaltyWeight: 0.02 },
  context: {
    asOf: NOW,
    openOptionLeg: { entryCreditPerShare: 2.0, currentBidPerShare: 0.2, currentAskPerShare: 0.3, strike: 55, multiplier: 100, dte: 10 },
    rollCandidate: null, assignAlternative: null, redeployAlternative: null,
    capitalCommitted: 5_000, holdForwardValue: null, pSevereDrawdown: 0.05, atExpirationOtm: false,
  },
  aegis: aegis(), executionQuality: null,
  policyVersion: 'v1', modelVersions: { management: 'v1' }, requiredModelVersions: { management: 'v1' },
  providerStateGood: true,
});

const candidate = (overrides: Partial<ManagementCycleCandidate>): ManagementCycleCandidate => ({
  chainId: 'chain-1', lifecycleState: 'CSP_OPEN', csp: null, assignment: null, recovery: null, coveredCall: null,
  ...overrides,
});

test('routing table maps each documented lifecycle state to its route', () => {
  assert.equal(routeForLifecycleState('CSP_OPEN'), 'SHORT_PUT');
  assert.equal(routeForLifecycleState('ROLL_DECISION'), 'ASSIGNMENT_PENDING');
  assert.equal(routeForLifecycleState('STOCK_HELD'), 'STOCK_RECOVERY');
  assert.equal(routeForLifecycleState('RECOVERY_WAIT'), 'STOCK_RECOVERY');
  assert.equal(routeForLifecycleState('CC_OPEN'), 'COVERED_CALL');
  assert.equal(routeForLifecycleState('CALL_AWAY'), 'CLOSED');
  assert.equal(routeForLifecycleState('CLOSED'), 'CLOSED');
});

test('an unrouted lifecycle state fails closed to UNKNOWN rather than guessing', () => {
  assert.equal(routeForLifecycleState('WAIT'), 'UNKNOWN');
  assert.equal(routeForLifecycleState('CSP_PROPOSED'), 'UNKNOWN');
});

const itRealPythonCodePath = pythonExecutablePath === undefined ? test.skip : test;

itRealPythonCodePath('a mixed batch of chains routes each into its correct real orchestrator', async () => {
  const results = await runThetaManagementCycle(bridge(), [
    candidate({ chainId: 'csp-1', lifecycleState: 'CSP_OPEN', csp: cspRequest('csp-1') }),
    candidate({ chainId: 'assign-1', lifecycleState: 'ROLL_DECISION', assignment: assignmentRequest('assign-1') }),
    candidate({ chainId: 'recovery-1', lifecycleState: 'RECOVERY_WAIT', recovery: recoveryRequest('recovery-1') }),
    candidate({ chainId: 'cc-1', lifecycleState: 'CC_OPEN', coveredCall: coveredCallManagementRequest('cc-1') }),
    candidate({ chainId: 'closed-1', lifecycleState: 'CLOSED' }),
  ]);

  assert.equal(results.length, 5);

  const byChain = new Map(results.map((r) => [r.chainId, r]));

  assert.equal(byChain.get('csp-1')?.route, 'SHORT_PUT');
  assert.equal(byChain.get('csp-1')?.shortPut?.selectedAction, 'CLOSE');
  assert.equal(byChain.get('csp-1')?.failClosedReason, null);

  assert.equal(byChain.get('assign-1')?.route, 'ASSIGNMENT_PENDING');
  assert.equal(byChain.get('assign-1')?.assignmentPending?.recommendation, 'ACCEPT_ASSIGNMENT');

  assert.equal(byChain.get('recovery-1')?.route, 'STOCK_RECOVERY');
  assert.equal(byChain.get('recovery-1')?.stockRecovery?.action, 'RECOVERY_WAIT');

  assert.equal(byChain.get('cc-1')?.route, 'COVERED_CALL');
  assert.equal(byChain.get('cc-1')?.coveredCall?.coveredCallAction, 'CLOSE_CC');

  assert.equal(byChain.get('closed-1')?.route, 'CLOSED');
  assert.equal(byChain.get('closed-1')?.failClosedReason, null);
});

test('a route missing its required context fails closed rather than throwing or guessing', async () => {
  const results = await runThetaManagementCycle(bridge(), [
    candidate({ chainId: 'no-context', lifecycleState: 'CSP_OPEN', csp: null }),
  ]);
  assert.equal(results.length, 1);
  assert.notEqual(results[0].failClosedReason, null);
  assert.equal(results[0].shortPut, null);
});

test('an unrouted lifecycle state produces a fail-closed UNKNOWN result, never an execution attempt', async () => {
  const results = await runThetaManagementCycle(bridge(), [
    candidate({ chainId: 'wait-1', lifecycleState: 'WAIT' }),
  ]);
  assert.equal(results[0].route, 'UNKNOWN');
  assert.notEqual(results[0].failClosedReason, null);
});
