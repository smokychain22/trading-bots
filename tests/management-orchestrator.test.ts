import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runManagementOrchestration, type ManagementOrchestrationRequest } from '../src/theta/management-orchestrator.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';
import type { AegisAssessmentResponse } from '../src/theta/aegis-contract.js';

// Real end-to-end integration test: spawns the ACTUAL Python
// management_contract.py (wrapping the already-tested
// models/management_action_value.py) through the real python-bridge.ts,
// so a pass here proves genuine IPC across the language boundary for the
// management path -- not just that the TS schema or the Python function
// are independently correct. Synthetic data only; no market/broker I/O.

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
  ]),
  timeoutMs: 5000,
  maxOutputBytes: 1_000_000,
});

const NOW = new Date().toISOString();
const HASH = 'a'.repeat(64);

const aegis = (state: AegisAssessmentResponse['newRiskState']): AegisAssessmentResponse => ({
  contractVersion: 'theta-aegis-runtime-v1', decisionId: 'd1', snapshotId: 's1', timestamp: NOW, policyVersion: 'v1',
  families: [{ family: 'PER_TRADE', state, reasons: [] }], newRiskState: state, reasons: [],
  permittedActions: ['CLOSE', 'CANCEL', 'BUY_TO_CLOSE', 'RECONCILE', 'REDUCE_POSITION', 'SAFETY_EXIT'],
});

const baseRequest = (overrides: Partial<ManagementOrchestrationRequest> = {}): ManagementOrchestrationRequest => ({
  snapshotId: 'snap-1', fusionSnapshotHash: HASH, timestamp: NOW, chainId: 'chain-1',
  policy: { policyVersion: 'mgmt-v1', executionCostPerContract: 0.65, capitalDaysPenaltyRate: 0.0001, tailRiskPenaltyWeight: 0.02 },
  context: {
    asOf: NOW,
    openOptionLeg: { entryCreditPerShare: 4.5, currentBidPerShare: 1.0, currentAskPerShare: 1.2, strike: 500, multiplier: 100, dte: 10 },
    rollCandidate: null, assignAlternative: null, redeployAlternative: null,
    capitalCommitted: 50_000, holdForwardValue: null, pSevereDrawdown: 0.05, atExpirationOtm: false,
  },
  aegis: aegis('ALLOW_FULL'), executionQuality: null,
  policyVersion: 'v1', modelVersions: { management: 'v1' }, requiredModelVersions: { management: 'v1' },
  providerStateGood: true,
  ...overrides,
});

const itRealPythonCodePath = pythonExecutablePath === undefined ? test.skip : test;

itRealPythonCodePath('a favorable CLOSE flows end to end through the real Python bridge into a confirmed receipt', async () => {
  const receipt = await runManagementOrchestration(bridge(), baseRequest());
  assert.equal(receipt.failClosedReason, null);
  assert.equal(receipt.selectedAction, 'CLOSE');
  assert.ok(receipt.holdAdvantage === null || typeof receipt.holdAdvantage === 'number');
  assert.equal(receipt.executionAuthorized, false);
});

itRealPythonCodePath('a HARD_VETO from AEGIS blocks a real ROLL decision -- exit supremacy does not apply to entering new risk', async () => {
  const receipt = await runManagementOrchestration(bridge(), baseRequest({
    context: {
      asOf: NOW,
      openOptionLeg: { entryCreditPerShare: 4.5, currentBidPerShare: 1.0, currentAskPerShare: 1.2, strike: 500, multiplier: 100, dte: 10 },
      rollCandidate: { newStrike: 490, newDte: 30, newCreditPerShare: 5.0, estimatedFutureValue: 100 },
      assignAlternative: null, redeployAlternative: null,
      capitalCommitted: 50_000, holdForwardValue: null, pSevereDrawdown: 0.05, atExpirationOtm: false,
    },
    aegis: aegis('HARD_VETO'),
  }));
  assert.equal(receipt.selectedAction, 'HOLD');
  assert.equal(receipt.reasonCodes.includes('AEGIS_BLOCKS_NEW_RISK_MANAGEMENT_ACTION'), true);
});

itRealPythonCodePath('an invalid fusionSnapshotHash from the caller fails closed rather than being silently coerced', async () => {
  const receipt = await runManagementOrchestration(bridge(), baseRequest({ fusionSnapshotHash: 'not-a-hash' }));
  assert.equal(receipt.selectedAction, 'HOLD');
  assert.notEqual(receipt.failClosedReason, null);
});

test('an unknown Python model family fails closed to HOLD without spawning any process', async () => {
  const badBridge: PythonBridgeConfig = { ...bridge(), scriptAllowlist: new Map() };
  const receipt = await runManagementOrchestration(badBridge, baseRequest());
  assert.equal(receipt.selectedAction, 'HOLD');
  assert.notEqual(receipt.failClosedReason, null);
  assert.equal(receipt.reasonCodes.some((code) => code.startsWith('PIPELINE_STAGE_FAILED')), true);
});
