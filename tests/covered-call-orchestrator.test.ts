import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runCoveredCallOrchestration, type CoveredCallOrchestrationRequest } from '../src/theta/covered-call-orchestrator.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';

const CANDIDATE_PYTHON_PATHS = [
  process.env.PYTHON_EXECUTABLE_FOR_TESTS,
  'C:\\Users\\hp\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
].filter((candidate): candidate is string => candidate !== undefined);

const pythonExecutablePath = CANDIDATE_PYTHON_PATHS.find((candidate) => existsSync(candidate));
const RUNTIME_DIR = path.resolve('bots/theta/quant/runtime');

const bridge = (): PythonBridgeConfig => ({
  pythonExecutablePath: pythonExecutablePath ?? 'python',
  scriptAllowlist: new Map([['coveredCall', path.join(RUNTIME_DIR, 'covered_call_contract.py')]]),
  timeoutMs: 5000,
  maxOutputBytes: 1_000_000,
});

const NOW = new Date().toISOString();
const HASH = 'e'.repeat(64);

const baseRequest = (overrides: Partial<CoveredCallOrchestrationRequest> = {}): CoveredCallOrchestrationRequest => ({
  snapshotId: 'snap-1', fusionSnapshotHash: HASH, timestamp: NOW, chainId: 'chain-1',
  policy: { policyVersion: 'cc-v1', executionCostPerContract: 0.65 },
  candidates: [],
  stock: { shares: 100, economicBasisPerShare: 48, currentPricePerShare: 50, stockEvIfUncapped: 5200 },
  ...overrides,
});

const itRealPythonCodePath = pythonExecutablePath === undefined ? test.skip : test;

itRealPythonCodePath('WAIT is selected by default with no candidates, through the real Python bridge', async () => {
  const receipt = await runCoveredCallOrchestration(bridge(), baseRequest());
  assert.equal(receipt.failClosedReason, null);
  assert.equal(receipt.selectedLabel, 'WAIT');
});

itRealPythonCodePath('a strongly favorable candidate can beat WAIT and SELL_STOCK', async () => {
  const receipt = await runCoveredCallOrchestration(bridge(), baseRequest({
    candidates: [{ strike: 55, dte: 20, creditPerShare: 5.0, multiplier: 100, callAwayRegretPerShare: 0.1, eventRiskPenalty: 0 }],
    stock: { shares: 100, economicBasisPerShare: 48, currentPricePerShare: 50, stockEvIfUncapped: 100 },
  }));
  assert.equal(receipt.selectedLabel.startsWith('SELL_CC'), true);
});

test('an unknown Python model family fails closed to WAIT without spawning any process', async () => {
  const badBridge: PythonBridgeConfig = { ...bridge(), scriptAllowlist: new Map() };
  const receipt = await runCoveredCallOrchestration(badBridge, baseRequest());
  assert.equal(receipt.selectedLabel, 'WAIT');
  assert.notEqual(receipt.failClosedReason, null);
});
