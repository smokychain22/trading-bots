import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runCoveredCallManagementOrchestration } from '../src/theta/covered-call-management-orchestrator.js';
import type { ManagementOrchestrationRequest } from '../src/theta/management-orchestrator.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';
import type { AegisAssessmentResponse } from '../src/theta/aegis-contract.js';

// Confirms the semantic mapping over the REAL management_contract.py
// subprocess: an already-open covered-call leg's generic CLOSE/ROLL/
// ASSIGN/EXPIRE/HOLD decision (from the same math already proven for CSP
// legs) is relabeled to CLOSE_CC/ROLL_CC/ALLOW_CALL_AWAY/
// EXPIRE_RETAIN_STOCK/HOLD_CC without any new economics.

const CANDIDATE_PYTHON_PATHS = [
  process.env.PYTHON_EXECUTABLE_FOR_TESTS,
  'C:\\Users\\hp\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
].filter((candidate): candidate is string => candidate !== undefined);

const pythonExecutablePath = CANDIDATE_PYTHON_PATHS.find((candidate) => existsSync(candidate));
const RUNTIME_DIR = path.resolve('bots/theta/quant/runtime');

const bridge = (): PythonBridgeConfig => ({
  pythonExecutablePath: pythonExecutablePath ?? 'python',
  scriptAllowlist: new Map([['management', path.join(RUNTIME_DIR, 'management_contract.py')]]),
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

const baseRequest = (overrides: Partial<ManagementOrchestrationRequest> = {}): ManagementOrchestrationRequest => ({
  snapshotId: 'snap-1', fusionSnapshotHash: HASH, timestamp: NOW, chainId: 'chain-1',
  policy: { policyVersion: 'mgmt-v1', executionCostPerContract: 0.65, capitalDaysPenaltyRate: 0.0001, tailRiskPenaltyWeight: 0.02 },
  context: {
    asOf: NOW,
    // A short call sold against 100 held shares: entry credit collected,
    // current ask is what buying it back would cost.
    openOptionLeg: { entryCreditPerShare: 2.0, currentBidPerShare: 0.2, currentAskPerShare: 0.3, strike: 55, multiplier: 100, dte: 10 },
    rollCandidate: null, assignAlternative: null, redeployAlternative: null,
    capitalCommitted: 5_000, holdForwardValue: null, pSevereDrawdown: 0.05, atExpirationOtm: false,
  },
  aegis: aegis(), executionQuality: null,
  policyVersion: 'v1', modelVersions: { management: 'v1' }, requiredModelVersions: { management: 'v1' },
  providerStateGood: true,
  ...overrides,
});

const itRealPythonCodePath = pythonExecutablePath === undefined ? test.skip : test;

itRealPythonCodePath('a favorable CLOSE on the generic model maps to CLOSE_CC for a covered call leg', async () => {
  const receipt = await runCoveredCallManagementOrchestration(bridge(), baseRequest());
  assert.equal(receipt.underlying.failClosedReason, null);
  assert.equal(receipt.underlying.selectedAction, 'CLOSE');
  assert.equal(receipt.coveredCallAction, 'CLOSE_CC');
});

itRealPythonCodePath('expiring worthless OTM maps to EXPIRE_RETAIN_STOCK', async () => {
  const receipt = await runCoveredCallManagementOrchestration(bridge(), baseRequest({
    context: {
      asOf: NOW,
      openOptionLeg: { entryCreditPerShare: 2.0, currentBidPerShare: 0.02, currentAskPerShare: 0.05, strike: 55, multiplier: 100, dte: 0 },
      rollCandidate: null, assignAlternative: null, redeployAlternative: null,
      capitalCommitted: 5_000, holdForwardValue: null, pSevereDrawdown: 0.05, atExpirationOtm: true,
    },
  }));
  assert.equal(receipt.underlying.selectedAction, 'EXPIRE');
  assert.equal(receipt.coveredCallAction, 'EXPIRE_RETAIN_STOCK');
});

itRealPythonCodePath('no open leg supplied defaults to HOLD_CC, never forcing a trade', async () => {
  const receipt = await runCoveredCallManagementOrchestration(bridge(), baseRequest({
    context: { ...baseRequest().context, openOptionLeg: null },
  }));
  assert.equal(receipt.underlying.selectedAction, 'HOLD');
  assert.equal(receipt.coveredCallAction, 'HOLD_CC');
});
