import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessDefinedRiskExpiration, computeDefinedRiskWholeChainAccounting, runDefinedRiskManagementReplay,
  type DefinedRiskManagementReplayInput,
} from '../src/research/defined-risk-management-replay.js';

const AT = '2026-09-25T15:00:00.000Z';

function input(): DefinedRiskManagementReplayInput {
  return {
    sourceSha: 'a'.repeat(40), sourceManifestHash: 'b'.repeat(64), episodeId: 'episode-d-1', chainId: 'chain-d-1',
    evidenceClass: 'DETERMINISTIC_TEST', entryAt: '2026-09-24T15:00:00.000Z',
    entryNetCreditPerShare: 2, multiplier: 100, quantity: 1, entryFeesDollars: 1,
    policy: { version: 'd-replay-policy-v1', maxHoldingMinutes: 10_000, exitDte: 2, maxTailLossDollars: 250 },
    observations: [{
      evidenceId: 'two-leg-close-1', decisionAt: AT, dte: 15,
      shortLeg: { occSymbol: 'SPY261016P00680000', bid: 2.45, ask: 2.5, quoteAt: '2026-09-25T14:59:58.000Z',
        receivedAt: '2026-09-25T14:59:59.000Z', validThrough: '2026-09-25T15:00:30.000Z',
        authority: 'ALPACA_EXECUTABLE_MARKET' },
      longLeg: { occSymbol: 'SPY261016P00675000', bid: 1.5, ask: 1.55, quoteAt: '2026-09-25T14:59:57.000Z',
        receivedAt: '2026-09-25T14:59:59.000Z', validThrough: '2026-09-25T15:00:25.000Z',
        authority: 'ALPACA_EXECUTABLE_MARKET' },
      closeFeesDollars: 1, adverseSlippageDollars: 2,
      hardRiskExitRequired: false, hardRiskAvailableAt: AT,
      eventExitRequired: false, eventAvailableAt: AT, eventValidThrough: '2026-09-25T16:00:00.000Z',
      forecast: null,
    }],
  };
}

test('runs every existing profit challenger against conservative two-leg close economics', () => {
  const result = runDefinedRiskManagementReplay(input());
  assert.equal(result.replay.policies.length, 17);
  const fixed50 = result.replay.policies.find((row) => row.policy === 'FIXED_50');
  assert.equal(fixed50?.terminal, 'ESTIMATED_EXIT');
  // Close debit is (2.50 - 1.50) * 100 = 100. Net is 200 - 1 - 100 - 1 - 2 = 96.
  assert.equal(fixed50?.estimatedAfterCostPnlDollars, 96);
  assert.equal(result.brokerAuthority, false);
});

test('one unqualified or missing leg censors the replay instead of fabricating a spread close', () => {
  const value = input();
  const observation = value.observations[0];
  assert.ok(observation);
  observation.longLeg = { ...observation.longLeg, authority: 'UNQUALIFIED' };
  const result = runDefinedRiskManagementReplay(value);
  assert.equal(result.replay.policies.every((row) => row.terminal === 'CENSORED'), true);
  assert.equal(result.replay.policies[0]?.decisions[0]?.reason, 'EXECUTABLE_CLOSE_EVIDENCE_UNAVAILABLE');
});

test('malformed leg timestamps censor the replay instead of throwing or gaining executable authority', () => {
  const value = input();
  const observation = value.observations[0];
  assert.ok(observation);
  value.observations[0] = {
    ...observation,
    shortLeg: { ...observation.shortLeg, quoteAt: 'not-a-timestamp' },
  };
  const result = runDefinedRiskManagementReplay(value);
  assert.ok(result.replay.policies.every((policy) => policy.terminal === 'CENSORED'));
  assert.ok(result.replay.policies.every((policy) =>
    policy.decisions[0]?.reason === 'EXECUTABLE_CLOSE_EVIDENCE_UNAVAILABLE'));
});

test('expiration states preserve short assignment, long protection, pin risk, and unknown input', () => {
  assert.equal(assessDefinedRiskExpiration({ spot: 685, shortStrike: 680, longStrike: 675, pinBufferDollars: 0.25 }).state,
    'BOTH_OTM_RETAIN_PREMIUM');
  assert.equal(assessDefinedRiskExpiration({ spot: 678, shortStrike: 680, longStrike: 675, pinBufferDollars: 0.25 }).state,
    'SHORT_ITM_LONG_OTM_ASSIGNMENT_WITH_PROTECTION');
  assert.equal(assessDefinedRiskExpiration({ spot: 670, shortStrike: 680, longStrike: 675, pinBufferDollars: 0.25 }).state,
    'BOTH_ITM_DEFINED_MAX_LOSS_REGION');
  assert.equal(assessDefinedRiskExpiration({ spot: 680.1, shortStrike: 680, longStrike: 675, pinBufferDollars: 0.25 }).state,
    'PIN_RISK');
  assert.equal(assessDefinedRiskExpiration({ spot: null, shortStrike: 680, longStrike: 675, pinBufferDollars: 0.25 }).state,
    'UNKNOWN');
});

test('defined-risk close whole-chain cash identity preserves premium, debit, fees, slippage, and capital-days', () => {
  const result = computeDefinedRiskWholeChainAccounting({
    openedAt: '2026-09-20T15:00:00.000Z', closedAt: '2026-09-25T15:00:00.000Z',
    entryNetCreditPerShare: 2, closeNetDebitPerShare: 1, expirationSpot: null,
    shortStrike: 680, longStrike: 675, multiplier: 100, quantity: 1,
    entryFeesDollars: 1, exitFeesDollars: 1, adverseSlippageDollars: 2,
    capitalAtRiskDollars: 500,
  });
  assert.deepEqual(result, {
    entryPremiumDollars: 200, closingDebitDollars: 100,
    shortAssignmentLiabilityDollars: 0, longProtectionValueDollars: 0,
    feesDollars: 2, adverseSlippageDollars: 2, realizedPnlDollars: 96,
    unrealizedPnlDollars: 0, capitalDays: 2500, settlement: 'CLOSED', brokerAuthority: false,
  });
});

test('defined-risk expiration preserves short assignment loss and long protection as separate bounded cash legs', () => {
  const result = computeDefinedRiskWholeChainAccounting({
    openedAt: '2026-09-20T15:00:00.000Z', closedAt: '2026-09-25T15:00:00.000Z',
    entryNetCreditPerShare: 2, closeNetDebitPerShare: null, expirationSpot: 670,
    shortStrike: 680, longStrike: 675, multiplier: 100, quantity: 1,
    entryFeesDollars: 1, exitFeesDollars: 1, adverseSlippageDollars: 2,
    capitalAtRiskDollars: 500,
  });
  assert.equal(result.shortAssignmentLiabilityDollars, 1000);
  assert.equal(result.longProtectionValueDollars, 500);
  assert.equal(result.realizedPnlDollars, -304);
  assert.equal(result.capitalDays, 2500);
  assert.equal(result.settlement, 'EXPIRED');
});

test('defined-risk whole-chain accounting rejects ambiguous or non-finite settlement evidence', () => {
  assert.throws(() => computeDefinedRiskWholeChainAccounting({
    openedAt: '2026-09-20T15:00:00.000Z', closedAt: '2026-09-25T15:00:00.000Z',
    entryNetCreditPerShare: 2, closeNetDebitPerShare: 1, expirationSpot: 670,
    shortStrike: 680, longStrike: 675, multiplier: 100, quantity: 1,
    entryFeesDollars: 1, exitFeesDollars: 1, adverseSlippageDollars: Number.NaN,
    capitalAtRiskDollars: 500,
  }), /SLIPPAGE_INVALID|SETTLEMENT_AMBIGUOUS/);
});
