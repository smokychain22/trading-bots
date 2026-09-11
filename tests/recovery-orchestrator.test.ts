import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runRecoveryOrchestration, type RecoveryOrchestrationRequest } from '../src/theta/recovery-orchestrator.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';

const CANDIDATE_PYTHON_PATHS = [
  process.env.PYTHON_EXECUTABLE_FOR_TESTS,
  'C:\\Users\\hp\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
].filter((candidate): candidate is string => candidate !== undefined);

const pythonExecutablePath = CANDIDATE_PYTHON_PATHS.find((candidate) => existsSync(candidate));
const RUNTIME_DIR = path.resolve('bots/theta/quant/runtime');

const bridge = (): PythonBridgeConfig => ({
  pythonExecutablePath: pythonExecutablePath ?? 'python',
  scriptAllowlist: new Map([
    ['recovery', path.join(RUNTIME_DIR, 'recovery_contract.py')],
    ['coveredCall', path.join(RUNTIME_DIR, 'covered_call_contract.py')],
  ]),
  timeoutMs: 5000,
  maxOutputBytes: 1_000_000,
});

const NOW = new Date().toISOString();
const HASH = 'f'.repeat(64);

const baseRequest = (overrides: Partial<RecoveryOrchestrationRequest> = {}): RecoveryOrchestrationRequest => ({
  snapshotId: 'snap-1', fusionSnapshotHash: HASH, timestamp: NOW, chainId: 'chain-1',
  policy: { policyVersion: 'recovery-v1', maxWaitDays: 20 },
  candidate: {
    daysInRecovery: 5, thesisInvalidated: false,
    coveredCallPolicy: null, coveredCallCandidates: [], stock: null,
  },
  ...overrides,
});

const itRealPythonCodePath = pythonExecutablePath === undefined ? test.skip : test;

itRealPythonCodePath('within bound, no CC candidates supplied, continues waiting through the real Python bridge', async () => {
  const receipt = await runRecoveryOrchestration(bridge(), baseRequest());
  assert.equal(receipt.failClosedReason, null);
  assert.equal(receipt.action, 'RECOVERY_WAIT');
  assert.equal(receipt.coveredCallDecision, null);
});

itRealPythonCodePath('thesis invalidation is a hard exit through the real Python bridge', async () => {
  const receipt = await runRecoveryOrchestration(bridge(), baseRequest({
    candidate: { ...baseRequest().candidate, thesisInvalidated: true },
  }));
  assert.equal(receipt.action, 'SELL_STOCK');
});

itRealPythonCodePath('bound exceeded forces SELL_STOCK through the real Python bridge', async () => {
  const receipt = await runRecoveryOrchestration(bridge(), baseRequest({
    candidate: { ...baseRequest().candidate, daysInRecovery: 25 },
  }));
  assert.equal(receipt.action, 'SELL_STOCK');
  assert.equal(receipt.boundExceeded, true);
});

itRealPythonCodePath('a genuinely favorable CC candidate is derived from the real covered-call frontier, not invented, before recovery compares it', async () => {
  const receipt = await runRecoveryOrchestration(bridge(), baseRequest({
    candidate: {
      daysInRecovery: 5, thesisInvalidated: false,
      coveredCallPolicy: { policyVersion: 'cc-v1', executionCostPerContract: 0.65 },
      coveredCallCandidates: [{ strike: 55, dte: 20, creditPerShare: 5.0, multiplier: 100, callAwayRegretPerShare: 0.1, eventRiskPenalty: 0 }],
      stock: { shares: 100, economicBasisPerShare: 48, currentPricePerShare: 50, stockEvIfUncapped: 100 },
    },
  }));
  assert.equal(receipt.action, 'SELL_CC');
  assert.ok(receipt.coveredCallDecision !== null);
  assert.equal(receipt.coveredCallDecision?.selectedLabel.startsWith('SELL_CC'), true);
});

itRealPythonCodePath('an unfavorable CC frontier does not force SELL_CC', async () => {
  const receipt = await runRecoveryOrchestration(bridge(), baseRequest({
    candidate: {
      daysInRecovery: 5, thesisInvalidated: false,
      coveredCallPolicy: { policyVersion: 'cc-v1', executionCostPerContract: 0.65 },
      coveredCallCandidates: [{ strike: 55, dte: 20, creditPerShare: null, multiplier: 100, callAwayRegretPerShare: null, eventRiskPenalty: null }],
      stock: { shares: 100, economicBasisPerShare: 48, currentPricePerShare: null, stockEvIfUncapped: null },
    },
  }));
  assert.equal(receipt.action, 'RECOVERY_WAIT');
});

test('partialSellStockModeled is always false -- never fabricated', async () => {
  const receipt = await runRecoveryOrchestration(bridge(), baseRequest());
  assert.equal(receipt.partialSellStockModeled, false);
});

test('an unknown Python model family fails closed to UNKNOWN, never a silent RECOVERY_WAIT', async () => {
  const badBridge: PythonBridgeConfig = { ...bridge(), scriptAllowlist: new Map() };
  const receipt = await runRecoveryOrchestration(badBridge, baseRequest());
  assert.equal(receipt.action, 'UNKNOWN');
  assert.notEqual(receipt.failClosedReason, null);
});
