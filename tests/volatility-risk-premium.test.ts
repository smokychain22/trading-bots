import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVolatilityRiskPremiumEvidence, buildVolatilityRiskPremiumFromAcceleration } from '../src/research/volatility-risk-premium.js';

const asOf = '2026-09-19T15:00:00.000Z';

test('computes IV-RV, ratio, and variance-space VRP when both inputs are known', () => {
  const evidence = buildVolatilityRiskPremiumEvidence({
    impliedVolatility: 0.30, impliedVolatilitySource: 'test:iv',
    realizedVolatility: 0.20, realizedVolatilitySource: 'test:rv', asOf,
  });
  assert.equal(evidence.state, 'KNOWN');
  assert.ok(Math.abs((evidence.ivMinusRv as number) - 0.10) < 1e-9);
  assert.ok(Math.abs((evidence.ivToRvRatio as number) - 1.5) < 1e-9);
  assert.ok(Math.abs((evidence.varianceRiskPremium as number) - (0.09 - 0.04)) < 1e-9);
  assert.equal(evidence.brokerAuthority, false);
});

test('IV unknown makes the whole evidence UNKNOWN, never a fabricated partial number', () => {
  const evidence = buildVolatilityRiskPremiumEvidence({
    impliedVolatility: null, impliedVolatilitySource: 'test:iv',
    realizedVolatility: 0.20, realizedVolatilitySource: 'test:rv', asOf,
  });
  assert.equal(evidence.state, 'UNKNOWN');
  assert.equal(evidence.ivMinusRv, null);
  assert.equal(evidence.ivToRvRatio, null);
  assert.equal(evidence.varianceRiskPremium, null);
});

test('RV unknown makes the whole evidence UNKNOWN', () => {
  const evidence = buildVolatilityRiskPremiumEvidence({
    impliedVolatility: 0.30, impliedVolatilitySource: 'test:iv',
    realizedVolatility: null, realizedVolatilitySource: 'test:rv', asOf,
  });
  assert.equal(evidence.state, 'UNKNOWN');
});

test('a zero realized volatility makes the ratio null (undefined), never a fabricated infinity, while ivMinusRv/VRP remain computable', () => {
  const evidence = buildVolatilityRiskPremiumEvidence({
    impliedVolatility: 0.10, impliedVolatilitySource: 'test:iv',
    realizedVolatility: 0, realizedVolatilitySource: 'test:rv', asOf,
  });
  assert.equal(evidence.state, 'KNOWN');
  assert.equal(evidence.ivToRvRatio, null);
  assert.ok(Math.abs((evidence.ivMinusRv as number) - 0.10) < 1e-9);
  assert.ok(Math.abs((evidence.varianceRiskPremium as number) - 0.01) < 1e-9);
});

test('a negative VRP (RV exceeds IV) is reported honestly, never clamped to zero -- this is not a trade signal, just arithmetic', () => {
  const evidence = buildVolatilityRiskPremiumEvidence({
    impliedVolatility: 0.15, impliedVolatilitySource: 'test:iv',
    realizedVolatility: 0.40, realizedVolatilitySource: 'test:rv', asOf,
  });
  assert.ok((evidence.ivMinusRv as number) < 0);
  assert.ok((evidence.varianceRiskPremium as number) < 0);
});

test('non-finite inputs (NaN/Infinity) are treated as UNKNOWN, never propagated as a poisoned NaN result', () => {
  const evidence = buildVolatilityRiskPremiumEvidence({
    impliedVolatility: Number.NaN, impliedVolatilitySource: 'test:iv',
    realizedVolatility: 0.2, realizedVolatilitySource: 'test:rv', asOf,
  });
  assert.equal(evidence.state, 'UNKNOWN');
  assert.equal(evidence.ivMinusRv, null);
});

test('buildVolatilityRiskPremiumFromAcceleration defaults to the rv21 horizon and names its source explicitly', () => {
  const evidence = buildVolatilityRiskPremiumFromAcceleration({
    impliedVolatility: 0.25, impliedVolatilitySource: 'test:iv',
    acceleration: { rv5: 0.30, rv21: 0.18, rv63: 0.22 }, asOf,
  });
  assert.equal(evidence.realizedVolatility, 0.18);
  assert.equal(evidence.realizedVolatilitySource, 'volatility-acceleration:rv21');
  assert.equal(evidence.state, 'KNOWN');
});

test('buildVolatilityRiskPremiumFromAcceleration honors an explicit rvHorizon override', () => {
  const evidence = buildVolatilityRiskPremiumFromAcceleration({
    impliedVolatility: 0.25, impliedVolatilitySource: 'test:iv',
    acceleration: { rv5: 0.30, rv21: 0.18, rv63: 0.22 }, rvHorizon: 'rv5', asOf,
  });
  assert.equal(evidence.realizedVolatility, 0.30);
  assert.equal(evidence.realizedVolatilitySource, 'volatility-acceleration:rv5');
});

test('buildVolatilityRiskPremiumFromAcceleration reports UNKNOWN when the requested horizon itself is UNKNOWN', () => {
  const evidence = buildVolatilityRiskPremiumFromAcceleration({
    impliedVolatility: 0.25, impliedVolatilitySource: 'test:iv',
    acceleration: { rv5: null, rv21: null, rv63: null }, asOf,
  });
  assert.equal(evidence.state, 'UNKNOWN');
});
