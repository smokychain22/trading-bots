import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecoveryState } from '../src/theta/recovery-state.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';

const state = (overrides: Record<string, unknown> = {}) => assembleManagementInput({
  chain_id: 'chain', lifecycle_state: 'RECOVERY_WAIT', underlying_id: 'underlying', underlying: 'AAPL',
  option_leg_id: null, option_contract_id: null, quantity: '0',
  entry_credit_debit: null, contract_symbol: null, option_type: null, strike: null,
  expiration_date: null, multiplier: null, bid: null, ask: null, quote_as_of: null,
  feed: null, quote_quality: null, realized_option_pnl: '0', open_stock_shares: '100',
  stock_basis_per_share: '195', realized_stock_pnl: '0', dividends: '0', fees: '0',
  buying_power: '50000', options_buying_power: '40000', account_as_of: '2026-09-12T14:00:00.000Z', fusion_snapshot_id: 'fusion',
  snapshot_json: { underlyingState: { last: 180 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
  broker_position: { currentPrice: 180 },
  ...overrides,
}, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: '2026-09-12T14:00:00.000Z' });

test('computes distance-to-basis and drawdown honestly from known stock basis and mark', () => {
  const recovery = buildRecoveryState(state());
  assert.ok(recovery.distanceToBasisFraction !== null && recovery.distanceToBasisFraction < 0);
  assert.equal(recovery.drawdownFraction, recovery.distanceToBasisFraction);
});

test('never fabricates a recovery probability, recovery time, or further-downside estimate', () => {
  const recovery = buildRecoveryState(state());
  assert.equal(recovery.recoveryProbabilityEstimate, null);
  assert.equal(recovery.expectedRecoveryTimeDays, null);
  assert.equal(recovery.furtherDownsideEstimate, null);
});

test('capital-days and opportunity cost stay UNKNOWN without caller-supplied entry data, and are named as required', () => {
  const recovery = buildRecoveryState(state());
  assert.equal(recovery.capitalDaysSoFar, null);
  assert.equal(recovery.capitalOpportunityCostDollars, null);
  assert.ok(recovery.dataCompleteness.requiresCallerInput.some((field) => field.startsWith('assignedAtObservedAt')));
  assert.ok(recovery.dataCompleteness.requiresCallerInput.some((field) => field.startsWith('annualOpportunityCostRate')));
});

test('computes capital-days and opportunity cost honestly when the caller supplies entry data and a justified rate', () => {
  const recovery = buildRecoveryState(state(), '2026-08-13T14:00:00.000Z', 0.05);
  assert.ok(recovery.capitalDaysSoFar !== null && recovery.capitalDaysSoFar > 0);
  assert.ok(recovery.capitalOpportunityCostDollars !== null && recovery.capitalOpportunityCostDollars > 0);
});

test('a position at or above basis reports no drawdown', () => {
  const recovery = buildRecoveryState(state({ snapshot_json: { underlyingState: { last: 200 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } }, broker_position: { currentPrice: 200 } }));
  assert.ok(recovery.distanceToBasisFraction !== null && recovery.distanceToBasisFraction > 0);
  assert.equal(recovery.drawdownFraction, null);
});
