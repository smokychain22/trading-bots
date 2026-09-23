import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeAegisBaselineProgress } from '../src/theta/aegis-baseline-progress.js';

function assessment(signal: 'IV' | 'SPREAD', state: string, rawN: number, sessionN: number) {
  return { underlying: 'SPY', optionSymbol: 'SPY260925P00600000', currentFeed: 'INDICATIVE',
    dteBucket: 'DTE_1_7', moneynessBucket: 'ATM_0_3PCT',
    maturity: { state, evidence: { rawN, sessionN, effectiveN: sessionN }, temporalSpanDays: 1 },
    ...(signal === 'IV' ? { currentIv: 0.2 } : { currentRelativeSpread: 0.04 }) };
}

test('missing persisted assessments remain not observed', () => {
  const receipt = summarizeAegisBaselineProgress({ decisionAsOf: null, riskState: null, regimeState: null });
  assert.equal(receipt.state, 'AEGIS_BASELINE_NOT_OBSERVED');
  assert.equal(receipt.gap.state, 'NOT_OBSERVED');
});

test('zero history is visible and cannot become ready', () => {
  const receipt = summarizeAegisBaselineProgress({ decisionAsOf: '2026-09-23T14:00:00.000Z',
    riskState: { alpacaContractIvStress: { assessmentsByContract: { a: assessment('IV', 'BASELINE_NOT_STARTED', 0, 0) } },
      spreadStress: { assessmentsByContract: { a: assessment('SPREAD', 'BASELINE_NOT_STARTED', 0, 0) } } },
    regimeState: { aegisGapStressAssessment: { state: 'READY', stressGapDetected: false } } });
  assert.equal(receipt.state, 'AEGIS_BASELINE_NOT_STARTED');
  assert.equal(receipt.cohorts.length, 2);
  assert.ok(receipt.cohorts.every((item) => item.nextMaturityRequirement === 'FIRST_SOURCE_PROVEN_SESSION'));
});

test('one ready signal cannot make aggregate baseline ready', () => {
  const receipt = summarizeAegisBaselineProgress({ decisionAsOf: '2026-09-23T14:00:00.000Z',
    riskState: { alpacaContractIvStress: { assessmentsByContract: { a: assessment('IV', 'DETECTOR_READY', 30, 20) } } },
    regimeState: { aegisGapStressAssessment: { state: 'READY', stressGapDetected: false } } });
  assert.equal(receipt.state, 'AEGIS_BASELINE_PARTIAL');
});
