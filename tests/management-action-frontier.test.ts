import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementActionFrontier } from '../src/theta/management-action-frontier.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';

const state = (lifecycleState: string) => assembleManagementInput({
  chain_id: 'chain', lifecycle_state: lifecycleState, underlying: 'AAPL', option_leg_id: 'leg', quantity: '1',
  entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200',
  expiration_date: '2026-10-16', multiplier: '100', bid: '1', ask: '1.1', quote_as_of: '2026-09-12T14:00:00.000Z',
  feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '0', open_stock_shares: lifecycleState === 'RECOVERY_WAIT' ? '100' : '0',
  stock_basis_per_share: lifecycleState === 'RECOVERY_WAIT' ? '195' : null, realized_stock_pnl: '0', dividends: '0', fees: '0',
  buying_power: '50000', options_buying_power: '40000', fusion_snapshot_id: 'fusion',
  snapshot_json: { riskState: { assignmentCapacity: 1 }, eventState: { state: 'CLEAR' } },
  broker_position: lifecycleState === 'RECOVERY_WAIT' ? { currentPrice: 190 } : null,
}, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: '2026-09-12T14:00:00.000Z' });

test('CSP management enumerates the full required action surface', () => {
  const frontier = buildManagementActionFrontier(state('CSP_OPEN'));
  assert.deepEqual(frontier.actions.map((action) => action.action),
    ['HOLD', 'CLOSE_FULL', 'ROLL', 'LET_EXPIRE', 'ACCEPT_ASSIGNMENT', 'REDEPLOY']);
  assert.equal(frontier.selectedAction, 'HOLD');
  assert.equal(frontier.secondBestAction, null);
  assert.ok(frontier.actions.find((action) => action.action === 'ROLL')?.blockers.includes('EMPIRICAL_ACTION_EV_UNKNOWN'));
});

test('assigned stock compares recovery wait, stock sale, and covered call without forcing a CC', () => {
  const frontier = buildManagementActionFrontier(state('RECOVERY_WAIT'));
  assert.deepEqual(frontier.actions.map((action) => action.action), ['RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC']);
  assert.equal(frontier.selectedAction, 'RECOVERY_WAIT');
  assert.equal(frontier.actions.find((action) => action.action === 'SELL_CC')?.utility, null);
});

test('covered call management exposes hold, close, roll, and call-away', () => {
  const frontier = buildManagementActionFrontier(state('CC_OPEN'));
  assert.deepEqual(frontier.actions.map((action) => action.action), ['HOLD_CC', 'CLOSE_CC', 'ROLL_CC', 'ALLOW_CALL_AWAY']);
  assert.equal(frontier.selectedAction, 'HOLD_CC');
});
