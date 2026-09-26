import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyAccountDrawdownRegime, type AccountDrawdownRegimeThresholdPolicy,
} from '../src/research/account-drawdown-regime-research.js';

const POLICY: AccountDrawdownRegimeThresholdPolicy = {
  policyVersion: 'test-v1',
  cautionDrawdownFraction: 0.05,
  defensiveDrawdownFraction: 0.10,
  pauseNewRiskDrawdownFraction: 0.20,
};

test('CORE CLAIM: unknown drawdown is never defaulted to NORMAL', () => {
  const result = classifyAccountDrawdownRegime(
    { currentDrawdownFraction: null, trailingLossEpisodeCount: null, asOf: '2026-09-26T00:00:00Z' },
    POLICY,
  );
  assert.equal(result.regime, 'UNKNOWN');
});

test('below every threshold is NORMAL', () => {
  const result = classifyAccountDrawdownRegime(
    { currentDrawdownFraction: 0.01, trailingLossEpisodeCount: 0, asOf: '2026-09-26T00:00:00Z' },
    POLICY,
  );
  assert.equal(result.regime, 'NORMAL');
});

test('exactly at the caution threshold is CAUTION (inclusive boundary)', () => {
  const result = classifyAccountDrawdownRegime(
    { currentDrawdownFraction: 0.05, trailingLossEpisodeCount: 1, asOf: '2026-09-26T00:00:00Z' },
    POLICY,
  );
  assert.equal(result.regime, 'CAUTION');
});

test('above the pause threshold is PAUSE_NEW_RISK', () => {
  const result = classifyAccountDrawdownRegime(
    { currentDrawdownFraction: 0.25, trailingLossEpisodeCount: 3, asOf: '2026-09-26T00:00:00Z' },
    POLICY,
  );
  assert.equal(result.regime, 'PAUSE_NEW_RISK');
});

test('ADVERSARIAL: the classification never returns a field that could be mistaken for broker authority', () => {
  const result = classifyAccountDrawdownRegime(
    { currentDrawdownFraction: 0.5, trailingLossEpisodeCount: 10, asOf: '2026-09-26T00:00:00Z' },
    POLICY,
  );
  assert.ok(!('brokerAuthority' in result) || (result as { brokerAuthority?: unknown }).brokerAuthority === undefined);
  assert.ok(!('sizingOverride' in result));
});
