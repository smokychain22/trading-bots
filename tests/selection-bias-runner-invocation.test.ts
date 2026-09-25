import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { FilterInteractionTrialLedger } from '../src/research/filter-interaction-registry.js';
import {
  buildCampaignRequestFromInteractionLedger, invokeSelectionBiasRunner, type SelectionBiasRunnerInvocationConfig,
} from '../src/research/selection-bias-runner-invocation.js';

// Real end-to-end integration test: spawns the ACTUAL
// bots/theta/quant/research/selection_bias_runner.py, so a pass proves
// genuine IPC across the language boundary, not just that the TS/Python
// sides are independently correct. Synthetic fixture return series only.

const CANDIDATE_PYTHON_PATHS = [
  process.env.PYTHON_EXECUTABLE_FOR_TESTS,
  'C:\\Users\\hp\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
].filter((candidate): candidate is string => candidate !== undefined);

const pythonExecutablePath = CANDIDATE_PYTHON_PATHS.find((candidate) => existsSync(candidate));
const itRealPythonCodePath = pythonExecutablePath === undefined ? test.skip : test;

const config = (): SelectionBiasRunnerInvocationConfig => ({
  pythonExecutablePath: pythonExecutablePath ?? 'python',
  quantWorkingDirectory: path.resolve('bots/theta/quant'),
  timeoutMs: 10_000,
});

function fixtureSeries(): Readonly<Record<string, readonly number[]>> {
  return {
    'FLOW_X_REGIME::0': [0.01, 0.02, -0.01, 0.015, 0.03, -0.005, 0.02, 0.01],
    'FLOW_X_IV_RV::0': [0.005, -0.01, 0.02, -0.005, 0.01, 0.0, 0.015, -0.02],
    'EVENT_X_DTE::0': [-0.01, 0.0, 0.01, -0.02, 0.005, 0.01, -0.015, 0.02],
  };
}

itRealPythonCodePath('CORE CLAIM (closure item 1): a registered interaction trial genuinely increments the runner nTrials input', async () => {
  const ledger = new FilterInteractionTrialLedger();
  ledger.register('FLOW_X_REGIME', true, '2026-09-26T00:00:00Z');
  ledger.register('FLOW_X_IV_RV', true, '2026-09-26T00:00:00Z');
  ledger.register('EVENT_X_DTE', true, '2026-09-26T00:00:00Z');

  const request = buildCampaignRequestFromInteractionLedger({
    researchCampaignId: 'campaign-interaction-closure',
    returnNormalizationVersion: 'capital-day-return-v1',
    ledger, trialReturnSeries: fixtureSeries(),
    inputDatasetHash: 'a'.repeat(64), dependencyGroupingVersion: 'theta-dependence-grouping-v1', codeSha: 'b'.repeat(40),
  });
  assert.equal(request.trialIdentities.length, ledger.numberOfTrials());

  const result = await invokeSelectionBiasRunner(config(), request);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.receipt.numberOfTrials, 3);
    assert.equal(result.receipt.numberOfTrials, ledger.numberOfTrials());
    assert.equal(result.receipt.trialIdentities.length, ledger.numberOfTrials());
    assert.ok(result.receipt.dsr.deflatedSharpeRatio >= 0 && result.receipt.dsr.deflatedSharpeRatio <= 1);
  }
});

itRealPythonCodePath('registering a fourth trial changes the real receipt numberOfTrials to 4', async () => {
  const ledger = new FilterInteractionTrialLedger();
  ledger.register('FLOW_X_REGIME', true, '2026-09-26T00:00:00Z');
  ledger.register('FLOW_X_IV_RV', true, '2026-09-26T00:00:00Z');
  ledger.register('EVENT_X_DTE', true, '2026-09-26T00:00:00Z');
  ledger.register('TREND_X_VOLATILITY', true, '2026-09-26T00:00:00Z');

  const request = buildCampaignRequestFromInteractionLedger({
    researchCampaignId: 'campaign-interaction-closure-2',
    returnNormalizationVersion: 'capital-day-return-v1',
    ledger, trialReturnSeries: { ...fixtureSeries(), 'TREND_X_VOLATILITY::0': [0.02, 0.01, -0.01, 0.03, 0.0, 0.01, -0.02, 0.015] },
    inputDatasetHash: 'a'.repeat(64), dependencyGroupingVersion: 'theta-dependence-grouping-v1', codeSha: 'b'.repeat(40),
  });

  const result = await invokeSelectionBiasRunner(config(), request);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.receipt.numberOfTrials, 4);
});

test('CORE CLAIM: an empty ledger cannot construct a campaign request -- no phantom zero-trial invocation', () => {
  const ledger = new FilterInteractionTrialLedger();
  assert.throws(() => buildCampaignRequestFromInteractionLedger({
    researchCampaignId: 'c', returnNormalizationVersion: 'capital-day-return-v1', ledger, trialReturnSeries: {},
    inputDatasetHash: 'a'.repeat(64), dependencyGroupingVersion: 'v1', codeSha: 'b'.repeat(40),
  }), /EMPTY_LEDGER/);
});

test('a ledger trial with no matching return series is rejected before invocation', () => {
  const ledger = new FilterInteractionTrialLedger();
  ledger.register('FLOW_X_REGIME', true, '2026-09-26T00:00:00Z');
  assert.throws(() => buildCampaignRequestFromInteractionLedger({
    researchCampaignId: 'c', returnNormalizationVersion: 'capital-day-return-v1', ledger, trialReturnSeries: {},
    inputDatasetHash: 'a'.repeat(64), dependencyGroupingVersion: 'v1', codeSha: 'b'.repeat(40),
  }), /MISSING_SERIES_FOR_TRIAL/);
});
