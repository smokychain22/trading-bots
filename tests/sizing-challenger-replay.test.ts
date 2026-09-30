import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { replaySizingChallengers, type SizingChallengerInput } from '../src/research/sizing-challenger-replay.js';

function input(): SizingChallengerInput {
  return {
    candidateId: 'test-candidate', snapshotId: 'test-snapshot', asOf: '2026-09-30T15:00:00Z', observedAt: '2026-09-30T14:59:59Z',
    evidenceIds: ['fixture-explicitly-non-empirical'], truthClass: 'NON_EMPIRICAL_TEST_DATA',
    units: 'USD_AND_DECIMAL_FRACTIONS_ANNUALIZED_VOL', equity: 100_000, buyingPower: 100_000,
    collateralPerUnit: 1000, maximumLossPerUnit: 500, stressLossPerUnit: 1000, expectedShortfallPerUnit: 1250,
    annualizedVolatility: 0.4, drawdownFraction: 0.1, correlatedExposureFraction: 0.75, canonicalQuantityCap: 100,
    policy: { version: 'test-experiment-v1', capitalFraction: 0.1, riskBudgetDollars: 5000,
      targetAnnualizedVolatility: 0.2, maximumDrawdownFraction: 0.2, kellyFraction: 0.5,
      maximumKellyEquityFraction: 0.1, minimumOosIndependentN: 100, maximumOosEce: 0.1 },
    kelly: null,
  };
}

function modeledKelly(): NonNullable<SizingChallengerInput['kelly']> {
  // Synthetic metadata exercises the gate only. This fixture isn't real empirical evidence.
  return { probabilityPositive: 0.6, averageWin: 100, averageLoss: 100,
    modelId: 'fixture', modelVersion: 'v1', modelArtifactHash: 'a'.repeat(64), datasetHash: 'b'.repeat(64),
    calibrationArtifactHash: 'c'.repeat(64), validationPolicyVersion: 'test-v1',
    fitEnd: '2026-01-01T00:00:00Z', oosStart: '2026-01-02T00:00:00Z', oosEnd: '2026-08-30T00:00:00Z',
    observedAt: '2026-09-01T00:00:00Z', outcomeDefinition: 'RESOLVED_WHOLE_CHAIN_AFTER_COST',
    calibration: { modelId: 'fixture', modelVersion: 'v1', dataProvenance: 'REAL_EMPIRICAL_DATA', n: 200,
      independentN: 120, ece: 0.05, brierScore: 0.2 } };
}

test('eight sizing challengers execute distinct explicit formulas without changing Production or granting promotion', () => {
  const receipt = replaySizingChallengers({ ...input(), kelly: modeledKelly() });
  assert.equal(receipt.results.length, 8);
  const byMethod = Object.fromEntries(receipt.results.map(row => [row.method, row]));
  for (const [method, quantity] of Object.entries({ FIXED_CAPITAL_FRACTION: 10, FIXED_RISK_BUDGET: 10,
    STRESS_LOSS_BUDGET: 5, EXPECTED_SHORTFALL_BUDGET: 4, VOLATILITY_SCALED: 5,
    DRAWDOWN_SCALED: 5, CORRELATION_SCALED: 2 })) assert.equal(byMethod[method]?.quantity, quantity, method);
  // Binary floating point must never round a fractional contract upward.
  const kelly = byMethod.FRACTIONAL_KELLY;
  assert.ok(kelly?.rawQuantity !== null && kelly?.rawQuantity !== undefined);
  assert.equal(kelly.quantity, Math.floor(kelly.rawQuantity));
  assert.ok(Math.abs(kelly.rawQuantity - 20) < 1e-10);
  assert.equal(receipt.brokerAuthority, false);
  assert.equal(receipt.changesProductionSizing, false);
  assert.equal(receipt.modelPromotion, 'NOT_GRANTED');
  assert.equal(receipt.truthClass, 'NON_EMPIRICAL_TEST_DATA');
  assert.equal(receipt.profitability, 'EMPIRICALLY_UNPROVEN');
  assert.deepEqual(replaySizingChallengers(input()), replaySizingChallengers(input()));
});

test('missing required evidence stays null while measured zero capacity stays zero', () => {
  for (const field of ['buyingPower', 'collateralPerUnit', 'canonicalQuantityCap'] as const) {
    const receipt = replaySizingChallengers({ ...input(), [field]: null });
    assert.ok(receipt.results.every(row => row.quantity === null && row.state === 'BLOCKED_REQUIRED_EVIDENCE'));
  }
  const empty = replaySizingChallengers({ ...input(), buyingPower: 0 });
  assert.ok(empty.results.slice(0, 7).every(row => row.quantity === 0));
  assert.equal(empty.results[7]?.quantity, null);
  const vol = replaySizingChallengers({ ...input(), annualizedVolatility: null });
  assert.equal(vol.results.find(row => row.method === 'VOLATILITY_SCALED')?.quantity, null);
  assert.equal(vol.results.find(row => row.method === 'FIXED_RISK_BUDGET')?.quantity, 10);
});

test('Kelly rejects uncalibrated mismatched immature future and numerically invalid evidence', () => {
  const valid = modeledKelly();
  const variants = [null, { ...valid, calibration: { ...valid.calibration, dataProvenance: 'NON_EMPIRICAL_TEST_DATA' } },
    { ...valid, calibration: { ...valid.calibration, modelVersion: 'wrong' } },
    { ...valid, calibration: { ...valid.calibration, independentN: 99 } },
    { ...valid, calibration: { ...valid.calibration, independentN: 201 } },
    { ...valid, calibration: { ...valid.calibration, ece: 0.11 } },
    { ...valid, oosStart: valid.fitEnd }, { ...valid, observedAt: '2027-01-01T00:00:00Z' },
    { ...valid, averageWin: Number.MIN_VALUE, averageLoss: Number.MAX_VALUE },
    { ...valid, averageWin: Number.MAX_VALUE, averageLoss: Number.MIN_VALUE }];
  for (const kelly of variants) {
    const row = replaySizingChallengers({ ...input(), kelly }).results[7];
    assert.equal(row?.quantity, null);
    assert.ok(row?.reasons.includes('OOS_CALIBRATED_PROBABILITY_AND_PAYOFF_REQUIRED'));
  }
});

test('research boundary rejects malformed units nonfinite inputs unsafe quantities and future evidence', () => {
  for (const bad of [{ equity: NaN }, { buyingPower: Infinity }, { maximumLossPerUnit: -1 },
    { canonicalQuantityCap: Number.MAX_SAFE_INTEGER + 1 }, { equity: '1000' }, { units: 'CENTS' },
    { observedAt: '2027-01-01T00:00:00Z' }]) assert.throws(() => replaySizingChallengers({ ...input(), ...bad }));
  const overflow = replaySizingChallengers({ ...input(), collateralPerUnit: Number.MIN_VALUE });
  assert.ok(overflow.results.every(row => row.quantity === null));
});

test('every challenger respects independent broker and canonical bounds monotonically', () => {
  for (const cap of [0, 1, 2, 5, 10]) {
    const rows = replaySizingChallengers({ ...input(), kelly: modeledKelly(), canonicalQuantityCap: cap, buyingPower: 3500 }).results;
    assert.ok(rows.every(row => row.quantity !== null && Number.isSafeInteger(row.quantity) && row.quantity <= Math.min(cap, 3)));
  }
});

test('offline CLI consumes explicit experiment file and emits a deterministic replay receipt without providers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'theta-sizing-experiment-'));
  try {
    const file = join(directory, 'input.json');
    writeFileSync(file, JSON.stringify(input()));
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'tools/theta-sizing-challengers.ts', file], {
      encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), replaySizingChallengers(input()));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
