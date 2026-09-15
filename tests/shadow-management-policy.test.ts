import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleManagementInput } from '../src/theta/management-input-state.js';
import {
  buildShadowManagementPolicyEvidence,
  computeProfitPreservationFeatures,
} from '../src/theta/shadow-management-policy.js';

function state(input: {
  readonly closeAsk: number;
  readonly dte?: number;
  readonly lifecycle?: 'CSP_OPEN' | 'RECOVERY_WAIT';
  readonly eventState?: unknown;
}) {
  const observedAt = '2026-09-15T14:00:00.000Z';
  const dte = input.dte ?? 30;
  const expiration = new Date(Date.parse(observedAt) + dte * 86_400_000).toISOString().slice(0, 10);
  const lifecycle = input.lifecycle ?? 'CSP_OPEN';
  return assembleManagementInput({
    chain_id: '00000000-0000-4000-8000-000000000001', lifecycle_state: lifecycle,
    underlying_id: '00000000-0000-4000-8000-000000000002', underlying: 'AAPL',
    option_leg_id: lifecycle === 'CSP_OPEN' ? '00000000-0000-4000-8000-000000000003' : null,
    option_contract_id: lifecycle === 'CSP_OPEN' ? '00000000-0000-4000-8000-000000000004' : null,
    quantity: lifecycle === 'CSP_OPEN' ? '1' : null, entry_credit_debit: lifecycle === 'CSP_OPEN' ? '200' : null,
    contract_symbol: lifecycle === 'CSP_OPEN' ? 'AAPL261015P00200000' : null,
    option_type: lifecycle === 'CSP_OPEN' ? 'PUT' : null, strike: lifecycle === 'CSP_OPEN' ? '200' : null,
    expiration_date: lifecycle === 'CSP_OPEN' ? expiration : null, multiplier: lifecycle === 'CSP_OPEN' ? '100' : null,
    bid: lifecycle === 'CSP_OPEN' ? input.closeAsk - 0.05 : null,
    ask: lifecycle === 'CSP_OPEN' ? input.closeAsk : null, quote_as_of: observedAt,
    feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '0',
    open_stock_shares: lifecycle === 'RECOVERY_WAIT' ? '100' : '0',
    stock_basis_per_share: lifecycle === 'RECOVERY_WAIT' ? '195' : null,
    realized_stock_pnl: '0', dividends: '0', fees: '0', buying_power: '50000',
    options_buying_power: '40000', account_as_of: observedAt, fusion_snapshot_id: '00000000-0000-4000-8000-000000000005',
    snapshot_json: { underlyingState: { last: 205 }, marketSession: { isOpen: true },
      riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' },
      eventState: input.eventState ?? { state: 'CLEAR' } },
    broker_position: lifecycle === 'RECOVERY_WAIT' ? { currentPrice: 190 } : null,
  }, { managementInputSnapshotId: '00000000-0000-4000-8000-000000000006',
    reconciliationSnapshotId: '00000000-0000-4000-8000-000000000007', observedAt });
}

test('a 10 percent winner is an observation and does not become a close instruction', () => {
  const input = state({ closeAsk: 1.8 });
  const evidence = buildShadowManagementPolicyEvidence(input, {
    peakUnrealizedPnlSinceCapture: 20, captureStartedAt: input.observedAt, previousInput: null,
  });
  assert.equal(evidence.profitPreservation.profitCaptureRatio, 0.1);
  assert.equal(evidence.challengerPolicies.find((item) => item.policy === 'FIXED_25')?.disposition, 'WOULD_HOLD');
  assert.equal(evidence.shadowPreferredAction, null);
  assert.equal(evidence.productionPolicyEvidence, null);
  assert.equal(evidence.executionAuthorized, false);
});

test('a deteriorated 30 percent winner records giveback but still needs a forward model', () => {
  const input = state({ closeAsk: 1.4, eventState: { state: 'EVENT_NEAR' } });
  const evidence = buildShadowManagementPolicyEvidence(input, {
    peakUnrealizedPnlSinceCapture: 100, captureStartedAt: '2026-09-14T14:00:00.000Z',
    previousInput: { ...input, context: { ...input.context, eventState: { state: 'CLEAR' } } },
  });
  assert.equal(evidence.profitPreservation.profitCaptureRatio, 0.3);
  assert.equal(evidence.profitPreservation.profitGiveback, 40);
  assert.equal(evidence.profitPreservation.givebackRatio, 0.4);
  assert.equal(evidence.temporalSignals.eventStateChange, 'CHANGED');
  assert.equal(evidence.challengerPolicies.find((item) => item.policy === 'DYNAMIC_PROFIT_GIVEBACK')?.disposition,
    'BLOCKED_MODEL_REQUIRED');
  assert.equal(evidence.comparisonComplete, false);
  assert.ok(evidence.actionComparisons.every((item) => item.utility === null));
});

test('unknown peak stays unknown instead of becoming zero giveback', () => {
  const input = state({ closeAsk: 1.5 });
  const features = computeProfitPreservationFeatures(input, {
    peakUnrealizedPnlSinceCapture: null, captureStartedAt: null, previousInput: null,
  });
  assert.equal(features.state, 'UNKNOWN');
  assert.equal(features.profitGiveback, null);
  assert.equal(features.givebackRatio, null);
  assert.ok(features.unknownReasons.includes('PEAK_UNREALIZED_PNL_UNKNOWN'));
});

test('full premium capture has zero remaining reward without implying an automatic exit', () => {
  const input = state({ closeAsk: 0 });
  const evidence = buildShadowManagementPolicyEvidence(input, {
    peakUnrealizedPnlSinceCapture: 200, captureStartedAt: input.observedAt, previousInput: null,
  });
  assert.equal(evidence.profitPreservation.remainingRewardUpperBound, 0);
  assert.equal(evidence.shadowPreferredAction, null);
  assert.equal(evidence.executionAuthorized, false);
});

test('zero remaining DTE never divides by zero', () => {
  const base = state({ closeAsk: 1, dte: 0 });
  const input = { ...base, market: { ...base.market, dte: 0 } };
  const features = computeProfitPreservationFeatures(input, {
    peakUnrealizedPnlSinceCapture: 100, captureStartedAt: input.observedAt, previousInput: null,
  });
  assert.equal(features.remainingCapitalDays, null);
  assert.equal(features.remainingRewardPerCapitalDay, null);
  assert.ok(features.unknownReasons.includes('REMAINING_CAPITAL_DAYS_ZERO'));
});

test('assigned stock keeps the three recovery alternatives and fixed option exits are not applicable', () => {
  const input = state({ closeAsk: 0, lifecycle: 'RECOVERY_WAIT' });
  const evidence = buildShadowManagementPolicyEvidence(input, {
    peakUnrealizedPnlSinceCapture: null, captureStartedAt: null, previousInput: null,
  });
  assert.deepEqual(evidence.actionComparisons.map((item) => item.action), ['RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC']);
  assert.equal(evidence.profitPreservation.state, 'NOT_APPLICABLE');
  assert.equal(evidence.challengerPolicies.find((item) => item.policy === 'FIXED_40')?.disposition, 'NOT_APPLICABLE');
});

test('strategy switching always compares stay, switch, and wait with explicit unknown costs', () => {
  const input = state({ closeAsk: 1.2 });
  const evidence = buildShadowManagementPolicyEvidence(input, {
    peakUnrealizedPnlSinceCapture: 80, captureStartedAt: input.observedAt, previousInput: null,
  });
  assert.deepEqual(evidence.strategySwitch.alternatives, ['STAY', 'SWITCH', 'WAIT']);
  assert.equal(evidence.strategySwitch.exitSpreadCost, null);
  assert.equal(evidence.strategySwitch.entrySpreadCost, null);
  assert.ok(evidence.strategySwitch.reasonCodes.includes('SWITCHING_COSTS_REQUIRED'));
});
